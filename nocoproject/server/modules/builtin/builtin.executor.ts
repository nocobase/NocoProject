/**
 * The built-in executor (NP-219, protocol-runtime-types.md §6): runs built-in agents in the application process,
 * through the AI plugin, never through a daemon.
 *
 * - **Claim** (`builtin.claim.ts`) when `builtin.workAvailable` fires, on every sweeper tick and at start, while this
 *   process runs fewer than `maxConcurrent` built-in runs (each agent's `maxConcurrentRuns` holds as well).
 * - **Execute**: start the run (`acceptsInput` false), keep its lease, check the runtime (§4.2 configuration reasons;
 *   unavailable fails at once with `builtinUnavailable`, nothing waits), build the same claim payload a daemon gets,
 *   resume or create the plugin conversation, brief (`builtin.brief.ts`), run the agent with this run's tools and
 *   mirror its stream into run events. Cancellation (polled), the timeout and shutdown stop it through one
 *   `AbortSignal`.
 * - **Finish**: usage from the conversation's messages (`runUsage`, or a `status` event saying none was reported),
 *   then `complete` with the last text as summary, or `fail` with the reason of `classifyBuiltinError` (retries and
 *   session poisoning follow `run/failure.ts`); provider faults mark the runtime `check_failed`.
 * - A run lost with its process (restart) keeps a running status with an expiring lease; the sweeper fails it with
 *   `runtimeRecovery`, which is retried. Tool calls made before that may happen twice.
 */
import type { ClaimDeps } from '../run/claim.service.js';
import { buildClaimedRun } from '../run/claim.service.js';
import type { RunRecoveryService } from '../run/failure.js';
import type { RunEventService } from '../run/run-events.js';
import { findRun, transitionRun } from '../run/run.records.js';
import { insertRunUsage, type RunService } from '../run/run.service.js';
import type { BuiltinAiSource } from '../runtime/builtin-ai.js';
import { usableService } from '../runtime/builtin-ai.js';
import {
  builtinState,
  loadCatalog,
  recordBuiltinRunOutcome,
} from '../runtime/builtin-runtime.js';
import type { TxRunner } from '../shared/db.js';
import { addSeconds, isPostgres, now, num, str } from '../shared/db.js';
import type { IdSource } from '../shared/ids.js';
import { PROTOCOL_VERSION } from '../shared/protocol.js';
import { buildBuiltinBrief } from './builtin.brief.js';
import type { BriefInput } from './builtin.brief-sections.js';
import { claimBuiltinInTx } from './builtin.claim.js';
import type { BuiltinEngineSource } from './builtin.engine.js';
import {
  classifyBuiltinError,
  type BuiltinFailure,
} from './builtin.failure.js';
import { createStreamRecorder } from './builtin.stream.js';
import type { BuiltinToolbox, RunEventDraft } from './builtin.toolbox.js';
import { toolsFor } from './builtin.tools.js';

/** The lease a running built-in run keeps (seconds) and how often it is renewed (ms). */
export const BUILTIN_LEASE_SECONDS = 45;
const LEASE_RENEW_MS = 15_000;
const CANCEL_POLL_MS = 5_000;
const TITLE_MAX = 100;

export interface BuiltinExecutorConfig {
  /** Built-in runs this process executes at once (`nocoproject.builtin.maxConcurrent`, default 4). */
  readonly maxConcurrent: number;
  /** Wall-clock limit of one run (`nocoproject.builtin.timeoutSeconds`, default 600). */
  readonly timeoutSeconds: number;
}

export const DEFAULT_BUILTIN_CONFIG: BuiltinExecutorConfig = {
  maxConcurrent: 4,
  timeoutSeconds: 600,
};

export interface BuiltinExecutorDeps {
  readonly tx: TxRunner;
  readonly ids: IdSource;
  readonly claim: ClaimDeps;
  readonly runs: RunService;
  readonly recovery: RunRecoveryService;
  readonly events: RunEventService;
  readonly ai: BuiltinAiSource;
  readonly engine: BuiltinEngineSource;
  readonly toolbox: BuiltinToolbox;
  readonly config?: Partial<BuiltinExecutorConfig>;
  /** Test hook: shorter timers. */
  readonly timers?: {
    readonly leaseMs?: number;
    readonly cancelPollMs?: number;
  };
  readonly onError?: (error: unknown, message: string) => void;
}

export interface BuiltinExecutor {
  /** Claims what this process may run now and executes it in the background. */
  kick(): void;
  /** Claims and executes until nothing is claimable and nothing runs (tests, start). */
  drain(): Promise<void>;
  /** Stops the runs in progress (they fail with `runtimeRecovery`) and claims nothing more. */
  close(): Promise<void>;
}

type StopReason = 'cancel' | 'timeout' | 'shutdown';

interface Active {
  readonly controller: AbortController;
  stopped: StopReason | null;
  readonly done: Promise<void>;
}

function titleOf(payload: BriefInput): string {
  const subject = payload.issue.conversation
    ? payload.issue.title
    : `${payload.issue.identifier} ${payload.issue.title}`;
  return `NocoProject · ${subject}`.slice(0, TITLE_MAX);
}

/** Members' role keys for the plugin actor (`np-owner` / `np-admin` / `np-member`); never root. */
async function rolesOf(tx: TxRunner, userId: string): Promise<string[]> {
  const row = await tx
    .read()
    .query.selectFrom('members')
    .select('role')
    .where('userId', '=', userId)
    .executeTakeFirst();
  const role = str(row?.role);
  return role ? [`np-${role}`] : [];
}

async function nextSeq(tx: TxRunner, runId: string): Promise<number> {
  const row = await tx
    .read()
    .query.selectFrom('runEvents')
    .select('seq')
    .where('runId', '=', runId)
    .orderBy('seq', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row?.seq === null || row?.seq === undefined ? 0 : num(row.seq) + 1;
}

function sinkFor(deps: BuiltinExecutorDeps, runId: string, start: number) {
  let seq = start;
  return async (events: readonly RunEventDraft[]) => {
    if (events.length === 0) return;
    const at = new Date().toISOString();
    const batch = events.map((event) => ({ ...event, seq: seq++, at }));
    await deps.events.append(runId, batch);
  };
}

export function createBuiltinExecutor(
  deps: BuiltinExecutorDeps,
): BuiltinExecutor {
  const config = { ...DEFAULT_BUILTIN_CONFIG, ...deps.config };
  const active = new Map<string, Active>();
  let closed = false;
  let claiming: Promise<void> | null = null;
  const report = (error: unknown, message: string) =>
    deps.onError?.(error, message);

  async function setLease(runId: string): Promise<void> {
    await transitionRun(deps.tx.read(), runId, ['running'], {
      leaseExpiresAt: addSeconds(now(), BUILTIN_LEASE_SECONDS),
    });
  }

  async function fail(
    runId: string,
    runtimeId: string | null,
    failure: Extract<BuiltinFailure, { kind: 'failed' }>,
    sessionId: string | null,
  ): Promise<void> {
    await deps.recovery.fail(runId, {
      reason: failure.reason as never,
      detail: failure.detail,
      sessionPoisoned: failure.poisoned,
      ...(sessionId ? { providerSessionId: sessionId } : {}),
    });
    if (failure.runtimeFault)
      await recordBuiltinRunOutcome(deps.tx, runtimeId, false);
  }

  async function execute(
    runId: string,
    token: string,
    entry: Active,
  ): Promise<void> {
    await deps.runs.start(runId, { acceptsInput: false } as never);
    await setLease(runId);
    const run = await findRun(deps.tx.read(), runId);
    if (!run) return;
    const record = sinkFor(deps, runId, await nextSeq(deps.tx, runId));
    const catalog = await loadCatalog(deps.ai);
    const engine = deps.engine();
    const runtime = run.runtimeId
      ? await deps.tx
          .read()
          .query.selectFrom('runtimes')
          .selectAll()
          .where('id', '=', run.runtimeId)
          .executeTakeFirst()
      : undefined;
    const state = runtime ? builtinState(runtime, catalog) : null;
    const reason =
      !runtime || !engine
        ? 'plugin_missing'
        : state?.statusReason === 'check_failed'
          ? null
          : (state?.statusReason ?? null);
    const service =
      catalog && runtime
        ? usableService(catalog, str(runtime.llmService))
        : null;
    if (reason || !service || !engine || !run.actorUserId) {
      const detail =
        reason ?? (run.actorUserId ? 'no_enabled_model' : 'no actor');
      await record([
        { type: 'error', content: `builtinUnavailable: ${detail}` },
      ]);
      await fail(
        runId,
        run.runtimeId,
        {
          kind: 'failed',
          reason: 'builtinUnavailable',
          detail,
          poisoned: false,
          runtimeFault: false,
        },
        null,
      );
      return;
    }
    const payload = (await buildClaimedRun(
      deps.claim,
      runId,
      token,
      { url: '', protocolVersion: PROTOCOL_VERSION },
      null,
    )) as unknown as BriefInput | null;
    if (!payload)
      throw new Error('The run’s claim payload could not be built.');
    const userId = run.actorUserId;
    let sessionId: string | null = payload.session.providerSessionId;
    const startedAt = new Date();
    const timers: ReturnType<typeof setInterval>[] = [];
    const tools = toolsFor(payload.agent.capabilities ?? []).map(
      (tool) => tool.name,
    );
    try {
      sessionId ??= await engine.createSession({
        userId,
        title: titleOf(payload),
      });
      const brief = buildBuiltinBrief(payload);
      deps.toolbox.attach(sessionId, {
        runId,
        token,
        issue: payload.issue.identifier || payload.issue.id,
        tools: new Set(tools),
        skills: payload.agent.skills ?? [],
        record,
      });
      const stop = (why: StopReason) => {
        if (entry.stopped) return;
        entry.stopped = why;
        entry.controller.abort(why);
      };
      timers.push(
        setTimeout(() => stop('timeout'), config.timeoutSeconds * 1000),
        setInterval(() => {
          void setLease(runId).catch((error: unknown) =>
            report(error, 'Built-in run lease renewal failed.'),
          );
        }, deps.timers?.leaseMs ?? LEASE_RENEW_MS),
        setInterval(() => {
          void findRun(deps.tx.read(), runId)
            .then((current) => {
              if (current?.cancelRequestedAt) stop('cancel');
            })
            .catch(() => undefined);
        }, deps.timers?.cancelPollMs ?? CANCEL_POLL_MS),
      );
      const recorder = createStreamRecorder(record, new Set(tools));
      const model = payload.agent.model ?? service.enabledModels[0].value;
      for await (const event of engine.run({
        sessionId,
        userId,
        roles: await rolesOf(deps.tx, userId),
        llmService: service.llmService,
        model,
        systemPrompt: brief.systemPrompt,
        tools,
        turnPrompt: brief.turnPrompt,
        signal: entry.controller.signal,
      })) {
        await recorder.accept(event);
        if (entry.stopped) break;
      }
      await recorder.finish();
      if (entry.stopped) throw new Error(`Run stopped: ${entry.stopped}.`);
      if (!recorder.produced)
        throw Object.assign(new Error('The model returned no content.'), {
          code: 'EMPTY_RESPONSE',
        });
      const usage = await usageOf(engine, record, {
        userId,
        sessionId,
        since: startedAt,
      });
      await deps.runs.complete(runId, {
        summary: recorder.summary,
        providerSessionId: sessionId,
        usage: { provider: service.provider, model, ...usage },
      } as never);
      // The run is complete; the runtime's status is bookkeeping and must not fail it.
      await recordBuiltinRunOutcome(deps.tx, run.runtimeId, true).catch(
        (error: unknown) =>
          report(error, 'Built-in runtime status update failed.'),
      );
    } catch (error) {
      for (const timer of timers) clearInterval(timer);
      const cancelRequested = (await findRun(deps.tx.read(), runId))
        ?.cancelRequestedAt;
      const failure = classifyBuiltinError(
        error,
        cancelRequested ? 'cancel' : entry.stopped,
      );
      if (failure.kind === 'cancelled') {
        await deps.runs.cancelAck(runId);
        return;
      }
      await record([
        { type: 'error', content: `${failure.reason}: ${failure.detail}` },
      ]).catch(() => undefined);
      if (sessionId) {
        const usage = await usageOf(engine, record, {
          userId,
          sessionId,
          since: startedAt,
        });
        await deps.tx.run((tx) =>
          insertRunUsage(tx.conn, deps.ids, runId, {
            provider: service.provider,
            model: payload.agent.model ?? service.enabledModels[0].value,
            ...usage,
          }),
        );
      }
      await fail(runId, run.runtimeId, failure, sessionId);
    } finally {
      for (const timer of timers) clearInterval(timer);
      if (sessionId) deps.toolbox.detach(sessionId);
    }
  }

  async function claimMore(): Promise<void> {
    while (!closed && active.size < config.maxConcurrent) {
      if (!isPostgres(deps.tx.read())) return;
      const claimed = await deps.tx.run((tx) => claimBuiltinInTx(tx, deps.ids));
      if (!claimed) return;
      const entry = {
        controller: new AbortController(),
        stopped: null,
      } as Active & { done: Promise<void> };
      (entry as { done: Promise<void> }).done = execute(
        claimed.runId,
        claimed.token,
        entry,
      )
        .catch(async (error: unknown) => {
          report(error, 'Built-in run failed unexpectedly.');
          await deps.recovery
            .fail(claimed.runId, {
              reason: 'agentError.unknown',
              detail: String((error as Error)?.message ?? error),
            } as never)
            .catch(() => undefined);
        })
        .finally(() => {
          active.delete(claimed.runId);
          if (!closed) kick();
        });
      active.set(claimed.runId, entry);
    }
  }

  function kick(): void {
    if (closed || claiming) return;
    claiming = claimMore()
      .catch((error: unknown) =>
        report(error, 'Claiming built-in runs failed.'),
      )
      .finally(() => {
        claiming = null;
      });
  }

  return {
    kick,
    async drain() {
      for (;;) {
        kick();
        await claiming;
        if (active.size === 0) return;
        await Promise.all([...active.values()].map((entry) => entry.done));
      }
    },
    async close() {
      closed = true;
      await claiming;
      for (const entry of active.values()) {
        entry.stopped = 'shutdown';
        entry.controller.abort('shutdown');
      }
      await Promise.all([...active.values()].map((entry) => entry.done));
    },
  };
}

async function usageOf(
  engine: ReturnType<BuiltinEngineSource> & object,
  record: (events: readonly RunEventDraft[]) => Promise<void>,
  input: { userId: string; sessionId: string; since: Date },
) {
  const usage = await engine.usage(input).catch(() => null);
  if (!usage?.reported)
    await record([
      {
        type: 'status',
        content: 'The model service reported no usage for this run.',
      },
    ]).catch(() => undefined);
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadTokens: usage?.cacheReadTokens ?? 0,
    cacheWriteTokens: 0,
  };
}
