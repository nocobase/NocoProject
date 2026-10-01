// @vitest-environment node
/**
 * NP-219 built-in executor (protocol-runtime-types.md §6, §8) on PostgreSQL, with doubles of the AI plugin's catalog
 * and agent engine and the real agent API in process: claim → tool call (a comment) → complete with usage; refused
 * tools; approval gates; cancel and timeout; failure mapping and retries; unavailable runtimes; recovery after a
 * restart; two executors never run one run twice.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ALICE,
  BOB,
  buildServices,
  createAgent,
  mention,
  openNpTestDatabase,
  registerRuntime,
  resetData,
  rows,
  runRows,
  setRole,
} from './np-harness.ts';
import {
  aborted,
  createBuiltinAgent,
  enableBuiltin,
  fakeAi,
  fakeEngine,
  testAgentApi,
  type FakeAi,
  type FakeEngine,
} from './np-builtin-harness.ts';
import { BUILTIN_DEFINITION } from '../../server/modules/issue/status.ts';
import type { NpServices } from '../../server/modules/services.ts';
import type { AgentCapability } from '../../server/modules/shared/protocol.capabilities.ts';

const opened = await openNpTestDatabase('np_t_builtin_executor');
const skipped = 'skip' in opened;
if (skipped) console.warn(opened.skip);
const db = opened as Exclude<typeof opened, { skip: string }>;
afterAll(() => (skipped ? undefined : db.close()));

let services: NpServices;
let ai: FakeAi;
let engine: FakeEngine;

function build(config: { timeoutSeconds?: number } = {}): NpServices {
  const holder: { built?: NpServices } = {};
  const result = buildServices(db.database, {
    builtinAi: ai.source,
    builtinEngine: () => engine.source(),
    agentApi: () => testAgentApi(holder.built!),
    builtinConfig: config,
    builtinTimers: { leaseMs: 50, cancelPollMs: 20 },
    onBuiltinError: (error) => {
      throw error;
    },
  }).services;
  holder.built = result;
  return result;
}

beforeEach(async () => {
  if (skipped) return;
  await resetData(db);
  ai = fakeAi();
  engine = fakeEngine(() => services.builtinToolbox);
  services = build();
  await setRole(db, ALICE, 'owner');
  await setRole(db, BOB, 'member');
});

async function askHelper(
  capabilities: readonly AgentCapability[] = ['context.read', 'comment.create'],
  issueInput: Record<string, unknown> = {},
) {
  const runtimeId = await enableBuiltin(services, ALICE);
  const helper = await createBuiltinAgent(services, ALICE, runtimeId, {
    capabilities,
  });
  const issue = await services.issues.create(ALICE, {
    title: 'What is open?',
    ...issueInput,
  });
  await services.comments.create(ALICE, issue.id, {
    content: `${mention(helper, 'Helper')} what is still open here?`,
  });
  return { runtimeId, helper, issue };
}

async function onlyRun() {
  const [run] = await runRows(db);
  return run!;
}

describe.skipIf(skipped)('built-in runs', () => {
  it('claims the run, lets the model comment through a tool, completes it with usage and resumes the session', async () => {
    const { runtimeId, helper, issue } = await askHelper();
    engine.script = async function* ({ tool }) {
      yield { type: 'content', content: 'Let me ' };
      yield { type: 'content', content: 'check.' };
      yield { type: 'tool_calls', toolCalls: [] } as never;
      const reply = await tool('np_comment_add', {
        content: 'Two items are open.',
      });
      expect(reply.status).toBe('success');
      yield { type: 'reasoning', action: 'start' };
      yield { type: 'reasoning', action: 'content', content: 'done thinking' };
      yield { type: 'reasoning', action: 'stop' };
      yield { type: 'content', content: 'Answered in a comment.' };
    };
    await services.builtinExecutor.drain();

    const run = await onlyRun();
    expect(run).toMatchObject({
      status: 'completed',
      runtime_type: 'builtin',
      result_summary: 'Answered in a comment.',
      provider_session_id: 'session-1',
      accepts_input: false,
    });
    const [request] = engine.requests;
    expect(request).toMatchObject({
      userId: ALICE.id,
      roles: ['np-owner'],
      llmService: 'deepseek',
      model: 'deepseek-flash',
    });
    expect(request!.tools).toContain('np_comment_add');
    expect(request!.tools).not.toContain('np_issue_status');
    expect(request!.systemPrompt).toContain('built-in agent');
    expect(request!.systemPrompt).not.toContain('nocoproject issue');
    expect(request!.turnPrompt).toContain('what is still open here?');
    expect(engine.sessions[0]).toMatchObject({
      userId: ALICE.id,
      title: `NocoProject · ${issue.identifier} What is open?`,
    });

    const comments = await rows(
      db,
      'comments',
      'issue_id = ? AND author_type = ?',
      [issue.id, 'agent'],
    );
    expect(
      comments.map((row) => [row.author_id, row.content, row.source_run_id]),
    ).toEqual([[helper, 'Two items are open.', run.id]]);
    const events = await rows(db, 'run_events', 'run_id = ? ORDER BY seq', [
      run.id,
    ]);
    expect(events.map((event) => event.type)).toEqual([
      'text',
      'toolUse',
      'toolResult',
      'thinking',
      'text',
    ]);
    expect(events[0]!.content).toBe('Let me check.');
    expect(events[1]).toMatchObject({ tool: 'np_comment_add' });
    expect(JSON.stringify(events)).not.toContain('npr_');
    expect(await rows(db, 'run_usage', 'run_id = ?', [run.id])).toMatchObject([
      {
        provider: 'deepseek',
        model: 'deepseek-flash',
        input_tokens: 120,
        output_tokens: 30,
        cache_read_tokens: 10,
      },
    ]);
    // The token is revoked and the session is gone: the tool refuses afterwards.
    expect(
      await services.builtinToolbox.invoke('session-1', 'np_comment_add', {
        content: 'x',
      }),
    ).toMatchObject({
      status: 'error',
      content: expect.stringContaining('CAPABILITY_DENIED'),
    });
    const [runtime] = await rows(db, 'runtimes', 'id = ?', [runtimeId]);
    expect(runtime!.last_seen_at).not.toBeNull();

    // The next turn on the same issue resumes the plugin conversation.
    await services.comments.create(ALICE, issue.id, {
      content: `${mention(helper, 'Helper')} and now?`,
    });
    await services.builtinExecutor.drain();
    expect(engine.sessions).toHaveLength(1);
    expect(engine.requests[1]!.sessionId).toBe('session-1');
    expect(engine.requests[1]!.turnPrompt).toContain('Session: resumed.');
  });

  it('refuses tools outside the run’s capabilities, both in the tool box and on the server', async () => {
    const { helper, issue } = await askHelper([
      'context.read',
      'comment.create',
    ]);
    engine.script = async function* ({ tool }) {
      expect(
        (await tool('np_issue_status', { statusKey: 'done' })).content,
      ).toMatch(/^CAPABILITY_DENIED/u);
      // Revoked while running: the server's capability check refuses.
      await db.knex.raw(
        `UPDATE "${db.schema}".agents SET capabilities = '["context.read"]' WHERE id = ?`,
        [helper],
      );
      expect((await tool('np_comment_add', { content: 'hi' })).content).toMatch(
        /^CAPABILITY_DENIED/u,
      );
      // Another issue is not the run's own.
      const other = await services.issues.create(ALICE, { title: 'Other' });
      expect(
        (await tool('np_issue_get', { issue: other.identifier })).status,
      ).toBe('success');
      yield { type: 'content', content: 'Could not comment.' };
    };
    await services.builtinExecutor.drain();
    expect((await onlyRun()).status).toBe('completed');
    expect(
      await rows(db, 'comments', 'issue_id = ? AND author_type = ?', [
        issue.id,
        'agent',
      ]),
    ).toEqual([]);
  });

  it('answers pending when a status change waits for an approval', async () => {
    await db.knex.raw(
      `INSERT INTO "${db.schema}".workflow_templates (id, name, is_default, definition, created_at, updated_at)
       VALUES ('gated', 'Gated', false, ?, now(), now()) ON CONFLICT (id) DO NOTHING`,
      [
        JSON.stringify({
          ...BUILTIN_DEFINITION,
          transitions: [
            { from: '*', to: '*', actors: ['user'] },
            {
              from: 'in_progress',
              to: 'in_review',
              actors: ['agent'],
              approval: { approvers: ['owner'] },
            },
          ],
        }),
      ],
    );
    const project = await services.projects.create(ALICE, {
      name: 'Gated',
      leadUserId: ALICE.id,
    });
    await services.projects.update(ALICE, project.id, { workflowId: 'gated' });
    let answer = '';
    engine.script = async function* ({ tool }) {
      answer = (await tool('np_issue_status', { statusKey: 'in_review' }))
        .content;
      yield { type: 'content', content: 'Waiting for approval.' };
    };
    const { issue } = await askHelper(
      ['context.read', 'comment.create', 'issue.status.write'],
      {
        projectId: project.id,
        statusKey: 'in_progress',
      },
    );
    await services.builtinExecutor.drain();
    expect(JSON.parse(answer)).toMatchObject({ pending: true });
    expect(
      (await services.issueQueries.detail(ALICE, issue.id)).issue.statusKey,
    ).toBe('in_progress');
  });

  it('stops on cancel and on timeout, without retrying a timeout', async () => {
    await askHelper();
    engine.script = async function* ({ request }) {
      yield { type: 'content', content: 'Working…' };
      await aborted(request.signal);
    };
    const draining = services.builtinExecutor.drain();
    for (let i = 0; i < 100 && (await onlyRun()).status !== 'running'; i += 1)
      await new Promise((resolve) => setTimeout(resolve, 10));
    await services.runs.requestCancel(ALICE, String((await onlyRun()).id));
    await draining;
    expect(await onlyRun()).toMatchObject({
      status: 'cancelled',
      failure_reason: 'cancelled',
    });

    await resetData(db);
    await setRole(db, ALICE, 'owner');
    services = build({ timeoutSeconds: 1 });
    await askHelper();
    await services.builtinExecutor.drain();
    const runs = await runRows(db);
    expect(runs.map((run) => [run.status, run.failure_reason])).toEqual([
      ['failed', 'timeout'],
    ]);
  });

  it('maps plugin errors to failure reasons, retries what may change and marks provider faults', async () => {
    const { runtimeId } = await askHelper();
    engine.script = async function* () {
      yield { type: 'content', content: '' };
      throw Object.assign(new Error('provider failed'), {
        code: 'PROVIDER_ERROR',
        rootMessage: '401 Incorrect API key provided',
      });
    };
    await services.builtinExecutor.drain();
    expect(
      (await runRows(db)).map((run) => [run.status, run.failure_reason]),
    ).toEqual([['failed', 'agentError.providerAuth']]);
    const [runtime] = await rows(db, 'runtimes', 'id = ?', [runtimeId]);
    expect(runtime).toMatchObject({
      status: 'offline',
      status_reason: 'check_failed',
    });

    // A step-limit failure is retried once; a successful retry clears check_failed.
    await db.knex.raw(`DELETE FROM "${db.schema}".runs`);
    const issue = await services.issues.create(ALICE, { title: 'Again' });
    const [helper] = await rows(db, 'agents', "runtime_type = 'builtin'");
    let attempt = 0;
    engine.script = async function* () {
      attempt += 1;
      if (attempt === 1)
        throw Object.assign(new Error('too many steps'), {
          code: 'GRAPH_RECURSION_ERROR',
        });
      yield { type: 'content', content: 'Second time lucky.' };
    };
    await services.comments.create(ALICE, issue.id, {
      content: `${mention(String(helper!.id))} go`,
    });
    await services.builtinExecutor.drain();
    expect(
      (await runRows(db)).map((run) => [
        run.attempt,
        run.status,
        run.failure_reason,
      ]),
    ).toEqual([
      [1, 'failed', 'agentError.stepLimit'],
      [2, 'completed', null],
    ]);
    const [recovered] = await rows(db, 'runtimes', 'id = ?', [runtimeId]);
    expect(recovered).toMatchObject({ status: 'online', status_reason: null });
  });

  it('fails at once with builtinUnavailable when the service is gone, and on an empty answer', async () => {
    await askHelper();
    ai.catalog = { services: [], enabled: [] };
    await services.builtinExecutor.drain();
    expect(engine.requests).toEqual([]);
    expect(await onlyRun()).toMatchObject({
      status: 'failed',
      failure_reason: 'builtinUnavailable',
      failure_detail: 'service_removed',
    });

    await resetData(db);
    await setRole(db, ALICE, 'owner');
    ai = fakeAi();
    services = build();
    await askHelper();
    engine.script = async function* () {
      // Nothing at all.
    };
    engine.usage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      reported: false,
    };
    await services.builtinExecutor.drain();
    const runs = await runRows(db);
    expect(runs.map((run) => run.failure_reason)).toEqual([
      'agentError.emptyOutput',
      'agentError.emptyOutput',
    ]);
    const events = await rows(db, 'run_events', 'run_id = ? ORDER BY seq', [
      runs[0]!.id,
    ]);
    expect(events.map((event) => event.type)).toContain('status');
  });

  it('recovers a run its process lost and never runs one run twice across executors', async () => {
    const { helper } = await askHelper();
    const [run] = await runRows(db);
    await db.knex.raw(
      `UPDATE "${db.schema}".runs SET status = 'running', started_at = now(), lease_expires_at = now() - interval '2 minutes' WHERE id = ?`,
      [run!.id],
    );
    const swept = await services.sweeper.sweep(new Date());
    expect(swept.builtinRecovered).toBe(1);
    expect(
      (await runRows(db)).map((row) => [row.status, row.failure_reason]),
    ).toEqual([
      ['failed', 'runtimeRecovery'],
      ['queued', null],
    ]);
    await services.builtinExecutor.drain();

    // Three more issues; two executors drain at once.
    for (const title of ['A', 'B', 'C']) {
      const issue = await services.issues.create(ALICE, { title });
      await services.comments.create(ALICE, issue.id, {
        content: `${mention(helper)} ${title}`,
      });
    }
    const before = engine.requests.length;
    const other = build();
    await Promise.all([
      services.builtinExecutor.drain(),
      other.builtinExecutor.drain(),
    ]);
    expect(engine.requests.length - before).toBe(3);
    expect(
      new Set(engine.requests.slice(before).map((request) => request.sessionId))
        .size,
    ).toBe(3);
    expect(
      (await runRows(db)).filter((row) => row.status === 'completed'),
    ).toHaveLength(4);
  });

  it('leaves daemons and computer agents alone', async () => {
    const computer = await registerRuntime(services, ALICE);
    const coder = await createAgent(
      services,
      ALICE,
      computer.runtimeId,
      'Coder',
    );
    const issue = await services.issues.create(ALICE, { title: 'Code it' });
    await services.comments.create(ALICE, issue.id, {
      content: `${mention(coder)} please`,
    });
    await services.builtinExecutor.drain();
    expect(engine.requests).toEqual([]);
    expect((await onlyRun()).status).toBe('queued');
  });
});
