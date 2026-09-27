/**
 * Turns domain events into subscriptions and inbox items (docs/phase1/iteration-1-contract.md §E). It runs inside the
 * transaction that produced the events (`createTxRunner`'s `beforeCommit` hook), so an inbox item exists exactly when
 * the change that caused it does.
 *
 * | type                | kind     | recipient          | when                                                      |
 * | ------------------- | -------- | ------------------ | --------------------------------------------------------- |
 * | review_requested    | decision | owner              | an agent moves the issue to in_review                     |
 * | agent_blocked       | decision | owner              | an agent moves it to blocked, or a run fails agentBlocked |
 * | proposal_pending    | decision | parent owner       | an executor proposal is left pending (one card per parent) |
 * | batch_done          | info     | parent owner       | a batch of sub-issues is terminal                         |
 * | dependency_released | info     | owner              | nothing blocks the issue any more and it has no executor  |
 * | run_failed          | info     | subscribers        | a run failed for good (no retry)                          |
 * | owner_assigned      | info     | new owner          | the owner changed (not for agent-created sub-issues)      |
 * | executor_assigned   | info     | executor (member)  | the executor became a member                              |
 * | mentioned           | info     | mentioned member   | `mention://user/<id>` in a comment or the description     |
 * | commented           | info     | subscribers        | a new comment (mentioned members get `mentioned` instead) |
 * | status_changed      | info     | subscribers        | status changed by a user or an agent (not by the system)  |
 *
 * Nobody is notified of their own action. Decision items resolve when the matching action is done (status leaves
 * in_review / blocked; every proposal on the parent decided); `run_failed` items are archived when the issue reaches
 * in_review or a terminal status. Every recipient gets `inbox.changed` (realtime `np:inbox`).
 */
import type { Tx } from '../shared/db.js';
import { str, unique } from '../shared/db.js';
import type { DomainEvent, EventActor } from '../shared/events.js';
import type { IdSource } from '../shared/ids.js';
import type { InboxItemType, InboxKind, IssueV1 } from '../shared/protocol.js';
import type { UserDirectory } from '../shared/users.js';
import { findIssue } from '../issue/issue.records.js';
import { agentNames } from '../run/run.queries.js';
import type { WorkflowService } from '../workflow/workflow.service.js';
import {
  activeSubscribers,
  archiveRunFailed,
  dedupeKey,
  deliver,
  resolveItems,
  subscribe,
} from './inbox.store.js';

export interface NotificationService {
  process(tx: Tx, events: readonly DomainEvent[]): Promise<void>;
}

export interface NotificationDeps {
  readonly ids: IdSource;
  readonly users: UserDirectory;
  readonly workflows: WorkflowService;
}

interface Notice {
  readonly type: InboxItemType;
  readonly kind: InboxKind;
  readonly body: string;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly dedupeKey?: string;
}

/** Per-transaction state: the recipients touched and a name cache. */
class Round {
  readonly touched = new Set<string>();
  private readonly names = new Map<string, string | null>();

  constructor(
    readonly tx: Tx,
    readonly deps: NotificationDeps,
  ) {}

  async actorName(actor: EventActor): Promise<string | null> {
    if (actor.type === 'system' || !actor.id) return null;
    const key = `${actor.type}:${actor.id}`;
    if (!this.names.has(key)) {
      const map =
        actor.type === 'agent'
          ? await agentNames(this.tx.conn, [actor.id])
          : await this.deps.users.names(this.tx.conn, [actor.id]);
      this.names.set(key, map.get(actor.id) ?? null);
    }
    return this.names.get(key) ?? null;
  }

  async existingUsers(
    ids: readonly (string | null | undefined)[],
  ): Promise<string[]> {
    const names = await this.deps.users.names(this.tx.conn, ids);
    return unique(ids).filter((id) => names.has(id));
  }

  /** Delivers to each recipient except the actor. */
  async notify(
    issue: IssueV1,
    recipients: readonly (string | null | undefined)[],
    actor: EventActor,
    notice: Notice,
  ): Promise<void> {
    const actorName = await this.actorName(actor);
    for (const userId of unique(recipients)) {
      if (actor.type === 'user' && actor.id === userId) continue;
      this.touched.add(
        await deliver(this.tx, this.deps.ids, {
          userId,
          kind: notice.kind,
          type: notice.type,
          issueId: issue.id,
          title: `${issue.identifier} ${issue.title}`,
          body: notice.body,
          actorType: actor.type,
          actorId: actor.id,
          actorName,
          dedupeKey:
            notice.dedupeKey ?? dedupeKey(userId, notice.type, issue.id),
          payload: notice.payload ?? null,
        }),
      );
    }
  }

  async subscribe(
    issueId: string,
    userIds: readonly (string | null | undefined)[],
    reason: Parameters<typeof subscribe>[4],
  ): Promise<void> {
    for (const userId of unique(userIds))
      await subscribe(this.tx, this.deps.ids, issueId, userId, reason);
  }

  touch(userIds: readonly string[]): void {
    for (const userId of userIds) this.touched.add(userId);
  }
}

const SYSTEM: EventActor = { type: 'system', id: null };

async function onIssueCreated(
  round: Round,
  event: Extract<DomainEvent, { type: 'issue.created' }>,
): Promise<void> {
  const issue = await findIssue(round.tx.conn, event.issueId);
  if (!issue) return;
  const { actor } = event;
  if (actor.type === 'user')
    await round.subscribe(issue.id, [actor.id], 'creator');
  await round.subscribe(issue.id, [issue.ownerUserId], 'owner');
  const executorUser = issue.executorType === 'user' ? issue.executorId : null;
  await round.subscribe(issue.id, [executorUser], 'executor');
  const mentioned = await round.existingUsers(event.mentionedUserIds);
  await round.subscribe(issue.id, mentioned, 'mentioned');
  if (actor.type === 'user')
    await round.notify(issue, [issue.ownerUserId], actor, {
      type: 'owner_assigned',
      kind: 'info',
      body: 'You were made the owner.',
    });
  await round.notify(issue, [executorUser], actor, {
    type: 'executor_assigned',
    kind: 'info',
    body: 'You were assigned as the executor.',
  });
  await round.notify(issue, mentioned, actor, {
    type: 'mentioned',
    kind: 'info',
    body: 'You were mentioned in the description.',
  });
}

async function onStatusChanged(
  round: Round,
  issue: IssueV1,
  actor: EventActor,
  status: { from: string; to: string },
): Promise<void> {
  const { tx } = round;
  const view = await round.deps.workflows.forIssue(tx.conn, issue);
  if (status.from === 'in_review' && status.to !== 'in_review')
    round.touch(
      await resolveItems(tx, { type: 'review_requested', issueId: issue.id }),
    );
  if (status.to !== 'blocked')
    round.touch(
      await resolveItems(tx, { type: 'agent_blocked', issueId: issue.id }),
    );
  if (status.to === 'in_review' || view.isTerminal(status.to))
    round.touch(await archiveRunFailed(tx, issue.id));
  const deciders: string[] = [];
  if (actor.type === 'agent' && issue.ownerUserId) {
    if (status.to === 'in_review' || status.to === 'blocked') {
      deciders.push(issue.ownerUserId);
      await round.notify(issue, [issue.ownerUserId], actor, {
        type: status.to === 'in_review' ? 'review_requested' : 'agent_blocked',
        kind: 'decision',
        body:
          status.to === 'in_review'
            ? 'The agent delivered and asks for review.'
            : 'The agent is blocked and needs you.',
        payload: { from: status.from, to: status.to },
      });
    }
  }
  if (actor.type === 'system') return;
  const subscribers = (await activeSubscribers(tx.conn, issue.id)).filter(
    (userId) => !deciders.includes(userId),
  );
  await round.notify(issue, subscribers, actor, {
    type: 'status_changed',
    kind: 'info',
    body: `Status changed from ${status.from} to ${status.to}.`,
    payload: { from: status.from, to: status.to },
  });
}

async function onIssueUpdated(
  round: Round,
  event: Extract<DomainEvent, { type: 'issue.updated' }>,
): Promise<void> {
  const issue = await findIssue(round.tx.conn, event.issueId);
  if (!issue) return;
  const { actor, changes } = event;
  if (changes.owner?.to) {
    await round.subscribe(issue.id, [changes.owner.to], 'owner');
    await round.notify(issue, [changes.owner.to], actor, {
      type: 'owner_assigned',
      kind: 'info',
      body: 'You were made the owner.',
      payload: { from: changes.owner.from },
    });
  }
  if (changes.executor?.to.type === 'user' && changes.executor.to.id) {
    await round.subscribe(issue.id, [changes.executor.to.id], 'executor');
    await round.notify(issue, [changes.executor.to.id], actor, {
      type: 'executor_assigned',
      kind: 'info',
      body: 'You were assigned as the executor.',
    });
  }
  if (changes.mentionedUserIds?.length) {
    const mentioned = await round.existingUsers(changes.mentionedUserIds);
    await round.subscribe(issue.id, mentioned, 'mentioned');
    await round.notify(issue, mentioned, actor, {
      type: 'mentioned',
      kind: 'info',
      body: 'You were mentioned in the description.',
    });
  }
  if (changes.status)
    await onStatusChanged(round, issue, actor, changes.status);
}

async function onComment(
  round: Round,
  event: Extract<DomainEvent, { type: 'comment.created' }>,
): Promise<void> {
  const issue = await findIssue(round.tx.conn, event.issueId);
  if (!issue) return;
  const { actor } = event;
  if (actor.type === 'user')
    await round.subscribe(issue.id, [actor.id], 'commenter');
  const mentioned = await round.existingUsers(event.mentionedUserIds);
  await round.subscribe(issue.id, mentioned, 'mentioned');
  const payload = { commentId: event.commentId };
  await round.notify(issue, mentioned, actor, {
    type: 'mentioned',
    kind: 'info',
    body: 'You were mentioned in a comment.',
    payload,
  });
  const subscribers = (await activeSubscribers(round.tx.conn, issue.id)).filter(
    (userId) => !mentioned.includes(userId),
  );
  await round.notify(issue, subscribers, actor, {
    type: 'commented',
    kind: 'info',
    body: 'New comment.',
    payload,
  });
}

async function onRunFailed(
  round: Round,
  event: Extract<DomainEvent, { type: 'run.failed' }>,
): Promise<void> {
  if (!event.final) return;
  const issue = await findIssue(round.tx.conn, event.issueId);
  if (!issue) return;
  const actor: EventActor = { type: 'agent', id: event.agentId };
  const payload = {
    runId: event.runId,
    agentId: event.agentId,
    reason: event.reason,
  };
  const deciders: string[] = [];
  if (event.reason === 'agentBlocked' && issue.ownerUserId) {
    deciders.push(issue.ownerUserId);
    await round.notify(issue, [issue.ownerUserId], actor, {
      type: 'agent_blocked',
      kind: 'decision',
      body: 'The agent stopped because it is blocked.',
      payload,
    });
  }
  const subscribers = (await activeSubscribers(round.tx.conn, issue.id)).filter(
    (userId) => !deciders.includes(userId),
  );
  await round.notify(issue, subscribers, actor, {
    type: 'run_failed',
    kind: 'info',
    body: `A run failed (${event.reason}).`,
    payload,
  });
}

async function pendingProposalCount(tx: Tx, parentId: string): Promise<number> {
  const children = await tx.conn.query
    .selectFrom('issues')
    .select('id')
    .where('parentIssueId', '=', parentId)
    .execute();
  const ids = unique([parentId, ...children.map((row) => str(row.id))]);
  const rows = await tx.conn.query
    .selectFrom('executorProposals')
    .select('id')
    .where('issueId', 'in', ids)
    .where('status', '=', 'pending')
    .execute();
  return rows.length;
}

async function onProposal(
  round: Round,
  event: Extract<
    DomainEvent,
    { type: 'proposal.created' | 'proposal.decided' }
  >,
): Promise<void> {
  const anchorId = event.parentIssueId ?? event.issueId;
  const anchor = await findIssue(round.tx.conn, anchorId);
  if (!anchor) return;
  const pending = await pendingProposalCount(round.tx, anchor.id);
  if (event.type === 'proposal.decided') {
    if (pending === 0)
      round.touch(
        await resolveItems(round.tx, {
          type: 'proposal_pending',
          issueId: anchor.id,
        }),
      );
    return;
  }
  if (!anchor.ownerUserId) return;
  await round.notify(
    anchor,
    [anchor.ownerUserId],
    { type: 'agent', id: event.proposedByAgentId },
    {
      type: 'proposal_pending',
      kind: 'decision',
      body: `${pending} executor proposal(s) waiting for your decision.`,
      payload: {
        parentIssueId: anchor.id,
        pending,
        lastProposalId: event.proposalId,
      },
      dedupeKey: `user:${anchor.ownerUserId}:proposal:${anchor.id}`,
    },
  );
}

async function onBatchDone(
  round: Round,
  event: Extract<DomainEvent, { type: 'issue.batchDone' }>,
): Promise<void> {
  const parent = await findIssue(round.tx.conn, event.parentIssueId);
  if (!parent?.ownerUserId) return;
  await round.notify(parent, [parent.ownerUserId], SYSTEM, {
    type: 'batch_done',
    kind: 'info',
    body:
      event.stage === null
        ? 'All sub-issues are finished.'
        : `Stage ${event.stage} of the sub-issues is finished.`,
    payload: { stage: event.stage, childIssueIds: event.childIssueIds },
  });
}

async function onDependencyReleased(
  round: Round,
  event: Extract<DomainEvent, { type: 'issue.dependencyReleased' }>,
): Promise<void> {
  const issue = await findIssue(round.tx.conn, event.issueId);
  if (!issue?.ownerUserId) return;
  const releasedBy = await findIssue(round.tx.conn, event.releasedBy);
  await round.notify(issue, [issue.ownerUserId], SYSTEM, {
    type: 'dependency_released',
    kind: 'info',
    body: 'Nothing blocks this issue any more; it has no executor yet.',
    payload: {
      releasedBy: event.releasedBy,
      releasedByIdentifier: releasedBy?.identifier ?? null,
    },
  });
}

async function handle(round: Round, event: DomainEvent): Promise<void> {
  switch (event.type) {
    case 'issue.created':
      return onIssueCreated(round, event);
    case 'issue.updated':
      return onIssueUpdated(round, event);
    case 'comment.created':
      return onComment(round, event);
    case 'run.failed':
      return onRunFailed(round, event);
    case 'proposal.created':
    case 'proposal.decided':
      return onProposal(round, event);
    case 'issue.batchDone':
      return onBatchDone(round, event);
    case 'issue.dependencyReleased':
      return onDependencyReleased(round, event);
    default:
      return;
  }
}

export function createNotificationService(
  deps: NotificationDeps,
): NotificationService {
  return {
    async process(tx, events) {
      const round = new Round(tx, deps);
      for (const event of events) await handle(round, event);
      for (const userId of round.touched)
        tx.emit({ type: 'inbox.changed', userId });
    },
  };
}
