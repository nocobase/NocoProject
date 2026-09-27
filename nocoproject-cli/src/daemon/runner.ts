/**
 * Orchestrates one claimed run: lease renewal → environment → brief → prompt →
 * start → adapter → event stream → complete / fail / cancel-ack.
 */
import { HttpError, isTransient } from '../api/client.js';
import type {
  ClaimedRun,
  DaemonCompleteRequest,
  DaemonFailRequest,
  DaemonRunStatusResponse,
  DaemonStartRequest,
  FailureReason,
  RunEventInput,
} from '../protocol.js';
import { SESSION_POISONING_FAILURE_REASONS } from '../protocol.js';
import { withRetry } from '../util/backoff.js';
import type { Logger } from '../util/log.js';
import { forgetSecret, redactText, registerSecret } from '../util/redact.js';
import type { AgentAdapter, RunResult, RunSpec } from './adapters/types.js';
import { nowIso } from './adapters/types.js';
import { buildBrief, buildTurnPrompt, writeBrief } from './brief.js';
import { classifyFailure } from './classify.js';
import { buildAgentEnv, prepareRunEnvironment, type RunEnvironment } from './env.js';
import { EventStreamer } from './stream.js';
import { CancelWatcher, IdleWatchdog, type StopReason } from './watchdog.js';

export interface RunnerApi {
  lease(runId: string): Promise<unknown>;
  start(runId: string, body: DaemonStartRequest): Promise<unknown>;
  events(runId: string, body: { events: readonly RunEventInput[] }): Promise<unknown>;
  status(runId: string): Promise<DaemonRunStatusResponse>;
  complete(runId: string, body: DaemonCompleteRequest): Promise<unknown>;
  fail(runId: string, body: DaemonFailRequest): Promise<unknown>;
  cancelAck(runId: string): Promise<unknown>;
}

export interface RunnerDeps {
  readonly api: RunnerApi;
  readonly adapter: AgentAdapter;
  readonly serverUrl: string;
  readonly workspacesRoot: string;
  readonly binDir?: string;
  readonly idleWatchdogMs: number;
  readonly leaseIntervalMs?: number;
  readonly cancelPollMs?: number;
  readonly flushIntervalMs?: number;
  readonly logger: Logger;
  /** Registers a handler for WS `cancelRequested`; returns an unregister function. */
  readonly onCancelSignal?: (runId: string, handler: () => void) => () => void;
  /** Aborted when the daemon shuts down. */
  readonly shutdownSignal?: AbortSignal;
}

export type RunOutcome =
  | { readonly kind: 'completed' }
  | { readonly kind: 'failed'; readonly reason: FailureReason }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'abandoned'; readonly why: string };

const MAX_DETAIL = 4000;
const MAX_SUMMARY = 2000;

const reportRetry = { attempts: 5, baseMs: 500, maxMs: 8000, shouldRetry: isTransient } as const;

function startLeaseRenewal(deps: RunnerDeps, runId: string): () => void {
  const timer = setInterval(() => {
    deps.api.lease(runId).catch((error: unknown) => deps.logger.warn('lease renewal failed', { runId, error: (error as Error).message }));
  }, deps.leaseIntervalMs ?? 15_000);
  return () => clearInterval(timer);
}

interface AgentAttempt {
  readonly result: RunResult;
  readonly stopReason?: StopReason | 'shutdown';
  readonly idle: boolean;
}

async function runAgent(deps: RunnerDeps, spec: RunSpec, streamer: EventStreamer): Promise<AgentAttempt> {
  const log = deps.logger;
  let handle;
  try {
    handle = await deps.adapter.start(spec, { log: (line) => log.debug(line, { runId: spec.runId }) });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    const reason = err.code === 'ENOENT' ? 'agentError.missingExecutable' : undefined;
    return { result: { exitCode: null, errorText: err.message, classifiedFailure: reason, visibleEvents: 0 }, idle: false };
  }
  let stopReason: StopReason | 'shutdown' | undefined;
  const kill = (): void => void handle.kill();
  const watchdog = new IdleWatchdog(deps.idleWatchdogMs, () => {
    log.warn('agent idle watchdog fired; killing agent', { runId: spec.runId, idleMs: deps.idleWatchdogMs });
    kill();
  });
  const cancel = new CancelWatcher({
    runId: spec.runId,
    intervalMs: deps.cancelPollMs,
    getStatus: (id) => deps.api.status(id),
    logger: log,
    onStop: (reason, status) => {
      stopReason ??= reason;
      log.info('stopping agent', { runId: spec.runId, reason, status });
      kill();
    },
  });
  const unhook = deps.onCancelSignal?.(spec.runId, () => cancel.trigger());
  const onShutdown = (): void => {
    stopReason ??= 'shutdown';
    kill();
  };
  deps.shutdownSignal?.addEventListener('abort', onShutdown, { once: true });
  watchdog.start();
  cancel.start();
  try {
    for await (const event of handle.events) {
      streamer.push(event);
      watchdog.touch();
    }
    const result = await handle.result;
    return { result, stopReason, idle: watchdog.hasFired };
  } finally {
    watchdog.stop();
    cancel.stop();
    unhook?.();
    deps.shutdownSignal?.removeEventListener('abort', onShutdown);
  }
}

function decideFailure(attempt: AgentAttempt): FailureReason | null {
  const r = attempt.result;
  if (attempt.idle) return 'agentError.agentTimeout';
  if (r.classifiedFailure) return r.classifiedFailure;
  const ok = r.exitCode === 0 && !r.errorText;
  if (ok && r.visibleEvents > 0) return null;
  return classifyFailure({
    errorText: r.errorText,
    exitCode: r.exitCode,
    signal: r.signal,
    emptyOutput: ok && r.visibleEvents === 0,
  });
}

async function prepare(deps: RunnerDeps, claimed: ClaimedRun): Promise<{ env: RunEnvironment; spec: RunSpec }> {
  const caps = deps.adapter.capabilities();
  const env = prepareRunEnvironment(deps.workspacesRoot, claimed, caps.resume);
  writeBrief(env.workDir, caps.briefFile, buildBrief(claimed));
  const prompt = buildTurnPrompt(claimed, { resumed: Boolean(env.resumeSessionId) });
  const agentEnv = buildAgentEnv({ serverUrl: deps.serverUrl, token: claimed.token, claimed, binDir: deps.binDir });
  const spec: RunSpec = {
    runId: claimed.run.id,
    workDir: env.workDir,
    logsDir: env.logsDir,
    prompt,
    env: agentEnv,
    model: claimed.agent.model ?? undefined,
    resumeSessionId: env.resumeSessionId,
  };
  return { env, spec };
}

/** Executes a claimed run end to end. Never throws. */
export async function executeRun(claimed: ClaimedRun, deps: RunnerDeps): Promise<RunOutcome> {
  const runId = claimed.run.id;
  const log = deps.logger.child(`run:${runId}`);
  registerSecret(claimed.token);
  const stopLease = startLeaseRenewal(deps, runId);
  try {
    let prepared: { env: RunEnvironment; spec: RunSpec };
    try {
      prepared = await prepare(deps, claimed);
    } catch (error) {
      log.error('environment preparation failed', { error: (error as Error).message });
      await report(deps, log, runId, 'fail', { reason: 'environmentPrepareFailed', detail: redactText((error as Error).message) });
      return { kind: 'failed', reason: 'environmentPrepareFailed' };
    }
    const { env, spec } = prepared;
    try {
      await withRetry(() => deps.api.start(runId, { providerSessionId: spec.resumeSessionId, workDir: env.workDir }), reportRetry);
    } catch (error) {
      log.warn('could not mark run as started; abandoning', { error: (error as Error).message });
      return { kind: 'abandoned', why: (error as Error).message };
    }
    stopLease();
    log.info('agent starting', { provider: deps.adapter.provider, workDir: env.workDir, resume: spec.resumeSessionId ?? 'fresh' });
    return await runAndReport(deps, log, claimed, env, spec);
  } finally {
    stopLease();
    forgetSecret(claimed.token);
  }
}

async function runAndReport(deps: RunnerDeps, log: Logger, claimed: ClaimedRun, env: RunEnvironment, spec: RunSpec): Promise<RunOutcome> {
  const runId = claimed.run.id;
  const streamer = new EventStreamer(deps.api, runId, { logger: log, flushIntervalMs: deps.flushIntervalMs });
  streamer.push({ type: 'status', content: `Starting ${deps.adapter.provider} in ${env.workDir}${spec.resumeSessionId ? ` (resuming ${spec.resumeSessionId})` : ''}`, at: nowIso() });
  let attempt = await runAgent(deps, spec, streamer);
  if (attempt.result.resumeRejected && !attempt.stopReason) {
    log.warn('provider rejected the session resume; retrying once with a fresh session');
    streamer.push({ type: 'status', content: 'Previous session could not be resumed; starting a fresh session', at: nowIso() });
    attempt = await runAgent(deps, { ...spec, resumeSessionId: undefined }, streamer);
  }
  const r = attempt.result;
  const failure = attempt.stopReason ? null : decideFailure(attempt);
  streamer.push({ type: 'status', content: `Agent exited (code ${r.exitCode ?? 'none'}${r.signal ? `, signal ${r.signal}` : ''})`, at: nowIso() });
  await streamer.close();

  if (attempt.stopReason === 'cancelRequested') {
    await report(deps, log, runId, 'cancelAck', undefined);
    return { kind: 'cancelled' };
  }
  if (attempt.stopReason === 'runTerminal') return { kind: 'abandoned', why: 'run became terminal on the server' };
  if (attempt.stopReason === 'shutdown') {
    const body = { reason: 'runtimeRecovery' as const, detail: 'daemon shut down while the agent was running', providerSessionId: r.sessionId, workDir: env.workDir };
    await report(deps, log, runId, 'fail', body);
    return { kind: 'failed', reason: 'runtimeRecovery' };
  }
  if (!failure) {
    const summary = r.summary ? redactText(r.summary).slice(0, MAX_SUMMARY) : undefined;
    await report(deps, log, runId, 'complete', { providerSessionId: r.sessionId, workDir: env.workDir, summary, usage: r.usage });
    log.info('run completed');
    return { kind: 'completed' };
  }
  const detail = redactText(r.errorText || (attempt.idle ? `no agent output for ${deps.idleWatchdogMs}ms` : 'agent produced no output')).slice(-MAX_DETAIL);
  const body: DaemonFailRequest = {
    reason: failure,
    detail,
    providerSessionId: r.sessionId,
    workDir: env.workDir,
    sessionPoisoned: SESSION_POISONING_FAILURE_REASONS.includes(failure),
  };
  await report(deps, log, runId, 'fail', body);
  log.warn('run failed', { reason: failure });
  return { kind: 'failed', reason: failure };
}

type ReportKind = 'complete' | 'fail' | 'cancelAck';

async function report(deps: RunnerDeps, log: Logger, runId: string, kind: ReportKind, body: unknown): Promise<void> {
  try {
    await withRetry(() => {
      if (kind === 'complete') return deps.api.complete(runId, body as DaemonCompleteRequest);
      if (kind === 'fail') return deps.api.fail(runId, body as DaemonFailRequest);
      return deps.api.cancelAck(runId);
    }, reportRetry);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : undefined;
    log.error(`reporting ${kind} failed`, { status, error: (error as Error).message });
  }
}
