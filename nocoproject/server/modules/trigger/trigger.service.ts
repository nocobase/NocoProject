/**
 * Trigger rules (protocol.md §2). This is the only module that creates runs: every call to `run.enqueue` is here.
 *
 * | Change                                                              | Result                                   |
 * | ------------------------------------------------------------------- | ---------------------------------------- |
 * | Human sets the executor to an agent, status not backlog/done/cancel | enqueue, scope null, `assign`            |
 * | Human moves the issue out of backlog to a non-terminal status       | enqueue for the agent executor, `statusChange` |
 * | Human comment mentioning agents                                     | one enqueue per agent, scope = thread root, `mention` |
 * | Human reply (no mention) to an agent's comment                      | that agent, scope = thread root, `reply` |
 * | Human top-level comment (no mention), executor is an agent          | the executor, scope null, `comment`      |
 * | Comment starting with `/note`                                       | nothing                                  |
 * | Agent-authored comment                                              | nothing (mentions are plain text)        |
 * | Run failed with a retryable reason, attempts left                   | new run, `retryOfRunId`, `retry`         |
 *
 * Coalescing into an existing pending run, and "a running run makes the new one wait", are enforced by
 * `run.enqueue` and the claim SQL.
 */
import type { Actor } from '../shared/activity.js';
import type { Tx } from '../shared/db.js';
import { fromJson, str, unique } from '../shared/db.js';
import type {
  Comment,
  FailureReason,
  Issue,
  Run,
  TriggeredRun,
} from '../shared/protocol.js';
import { parseMentions, isNote } from '../collaboration/mentions.js';
import { runPriorityOf } from '../issue/issue.records.js';
import { isDormantStatus, isTerminalStatus } from '../issue/status.js';
import type {
  EnqueueResult,
  RunService,
  TriggerRecordInput,
} from '../run/run.service.js';

export interface IssueChange {
  readonly before: Issue | null;
  readonly after: Issue;
  readonly actor: Actor;
}

export interface CommentChange {
  readonly comment: Comment;
  readonly issue: Issue;
  /** The direct parent comment, when this is a reply. */
  readonly parent: Comment | null;
  readonly actor: Actor;
}

export interface TriggerService {
  /** A human created or updated an issue (creation passes `before: null`). */
  onIssueChanged(tx: Tx, change: IssueChange): Promise<TriggeredRun[]>;
  onCommentCreated(tx: Tx, change: CommentChange): Promise<TriggeredRun[]>;
  /** Automatic retry of a failed run (called by the failure handler). */
  retryFailedRun(
    tx: Tx,
    failed: Run,
    maxAttempts: number,
    reason: FailureReason,
  ): Promise<EnqueueResult | null>;
  /** Manual retry from the browser. */
  manualRetry(tx: Tx, run: Run, actor: Actor): Promise<EnqueueResult>;
}

export interface TriggerDeps {
  readonly runs: () => RunService;
}

async function activeAgentIds(
  tx: Tx,
  ids: readonly string[],
): Promise<Set<string>> {
  const wanted = unique(ids);
  if (wanted.length === 0) return new Set();
  const rows = await tx.conn.query
    .selectFrom('agents')
    .select('id')
    .where('id', 'in', wanted)
    .where('archivedAt', 'is', null)
    .execute();
  return new Set(rows.map((row) => String(row.id as string)));
}

function issueRunBase(issue: Issue, actor: Actor) {
  return {
    subjectId: issue.id,
    actorUserId: actor.type === 'user' ? actor.id : null,
    ownerUserId: issue.ownerUserId,
    priority: runPriorityOf(issue.priority),
  };
}

async function enqueueFor(
  deps: TriggerDeps,
  tx: Tx,
  target: {
    issue: Issue;
    actor: Actor;
    agentId: string;
    threadScope: string | null;
  },
  trigger: TriggerRecordInput,
): Promise<TriggeredRun | null> {
  const { issue, actor, agentId, threadScope } = target;
  if (!(await activeAgentIds(tx, [agentId])).has(agentId)) return null;
  const result = await deps.runs().enqueue(tx, {
    ...issueRunBase(issue, actor),
    agentId,
    threadScope,
    triggers: [
      { ...trigger, createdById: actor.type === 'user' ? actor.id : null },
    ],
  });
  return { agentId, runId: result.runId };
}

async function onIssueChanged(
  deps: TriggerDeps,
  tx: Tx,
  { before, after, actor }: IssueChange,
): Promise<TriggeredRun[]> {
  if (actor.type !== 'user') return [];
  if (after.executorType !== 'agent' || !after.executorId) return [];
  const executorChanged =
    !before ||
    before.executorType !== 'agent' ||
    before.executorId !== after.executorId;
  let type: 'assign' | 'statusChange' | null = null;
  if (executorChanged && !isDormantStatus(after.statusKey)) {
    type = 'assign';
  } else if (
    before &&
    before.statusKey === 'backlog' &&
    after.statusKey !== 'backlog' &&
    !isTerminalStatus(after.statusKey)
  ) {
    type = 'statusChange';
  }
  if (!type) return [];
  const triggered = await enqueueFor(
    deps,
    tx,
    { issue: after, actor, agentId: after.executorId, threadScope: null },
    {
      type,
      payload:
        type === 'statusChange'
          ? { from: before?.statusKey ?? null, to: after.statusKey }
          : null,
    },
  );
  return triggered ? [triggered] : [];
}

async function onCommentCreated(
  deps: TriggerDeps,
  tx: Tx,
  { comment, issue, parent, actor }: CommentChange,
): Promise<TriggeredRun[]> {
  // Agent-authored (and system) comments never trigger; mentions in them are plain text.
  if (actor.type !== 'user' || comment.authorType !== 'user') return [];
  if (isNote(comment.content)) return [];
  const route = (
    agentId: string,
    threadScope: string | null,
    type: 'mention' | 'reply' | 'comment',
  ) =>
    enqueueFor(
      deps,
      tx,
      { issue, actor, agentId, threadScope },
      { type, commentId: comment.id },
    );

  const mentioned = parseMentions(comment.content);
  if (mentioned.length > 0) {
    const results: TriggeredRun[] = [];
    for (const agentId of mentioned) {
      const triggered = await route(agentId, comment.rootId, 'mention');
      if (triggered) results.push(triggered);
    }
    return results;
  }
  let triggered: TriggeredRun | null = null;
  if (parent) {
    if (parent.authorType === 'agent' && parent.authorId) {
      triggered = await route(parent.authorId, comment.rootId, 'reply');
    }
  } else if (issue.executorType === 'agent' && issue.executorId) {
    triggered = await route(issue.executorId, null, 'comment');
  }
  return triggered ? [triggered] : [];
}

async function retryFailedRun(
  deps: TriggerDeps,
  tx: Tx,
  failed: Run,
  maxAttempts: number,
  reason: FailureReason,
): Promise<EnqueueResult | null> {
  if (failed.attempt >= maxAttempts) return null;
  if (!(await activeAgentIds(tx, [failed.agentId])).has(failed.agentId))
    return null;
  // Carry the original triggers so the retry sees the same comments, then mark it as a retry.
  const original = await tx.conn.query
    .selectFrom('runTriggers')
    .select(['type', 'commentId', 'payload', 'createdById'])
    .where('runId', '=', failed.id)
    .orderBy('createdAt', 'asc')
    .execute();
  const carried: TriggerRecordInput[] = original
    .filter((row) => row.type !== 'retry')
    .map((row) => ({
      type: str(row.type) as TriggerRecordInput['type'],
      commentId: str(row.commentId),
      payload: fromJson<Record<string, unknown>>(row.payload),
      createdById: str(row.createdById),
    }));
  return deps.runs().enqueue(tx, {
    agentId: failed.agentId,
    subjectId: failed.subjectId,
    threadScope: failed.threadScope,
    actorUserId: failed.actorUserId,
    ownerUserId: failed.ownerUserId,
    priority: failed.priority,
    attempt: failed.attempt + 1,
    maxAttempts,
    retryOfRunId: failed.id,
    triggers: [
      ...carried,
      { type: 'retry', payload: { retryOfRunId: failed.id, reason } },
    ],
  });
}

async function manualRetry(
  deps: TriggerDeps,
  tx: Tx,
  run: Run,
  actor: Actor,
): Promise<EnqueueResult> {
  const userId = actor.type === 'user' ? actor.id : null;
  return deps.runs().enqueue(tx, {
    agentId: run.agentId,
    subjectId: run.subjectId,
    threadScope: run.threadScope,
    actorUserId: userId ?? run.actorUserId,
    ownerUserId: run.ownerUserId,
    priority: run.priority,
    retryOfRunId: run.id,
    triggers: [
      {
        type: 'retry',
        payload: { retryOfRunId: run.id, manual: true },
        createdById: userId,
      },
    ],
  });
}

export function createTriggerService(deps: TriggerDeps): TriggerService {
  return {
    onIssueChanged: (tx, change) => onIssueChanged(deps, tx, change),
    onCommentCreated: (tx, change) => onCommentCreated(deps, tx, change),
    retryFailedRun: (tx, failed, maxAttempts, reason) =>
      retryFailedRun(deps, tx, failed, maxAttempts, reason),
    manualRetry: (tx, run, actor) => manualRetry(deps, tx, run, actor),
  };
}
