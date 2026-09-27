/**
 * Issue writes: create (atomic numbering), optimistic update, agent status transitions, and the system reset of an
 * abandoned in-progress issue. Every write records an activity and emits `issue.changed`; human writes are handed to
 * the trigger service in the same transaction.
 */
import type { Actor, ActivityRecorder } from '../shared/activity.js';
import { SYSTEM_ACTOR } from '../shared/activity.js';
import type { Conn, Tx, TxRunner } from '../shared/db.js';
import { now } from '../shared/db.js';
import { conflict, forbidden, invalid, notFound } from '../shared/errors.js';
import type { IdSource } from '../shared/ids.js';
import type {
  CreateIssueRequest,
  ExecutorInput,
  ExecutorType,
  Issue,
  UpdateIssueRequest,
} from '../shared/protocol.js';
import type { UserDirectory } from '../shared/users.js';
import type { SettingsService } from '../system/settings.service.js';
import type { TriggerService } from '../trigger/trigger.service.js';
import { ACTIVE_STATUSES } from '../run/run.records.js';
import { findIssue, isIssuePriority, mapIssue } from './issue.records.js';
import {
  DEFAULT_STATUS,
  isAgentTransitionAllowed,
  isKnownStatus,
} from './status.js';

const MAX_TITLE_LENGTH = 500;

export interface IssueService {
  create(actor: Actor, input: CreateIssueRequest): Promise<Issue>;
  update(
    actor: Actor,
    idOrKey: string,
    patch: UpdateIssueRequest,
  ): Promise<Issue>;
  /** An agent (run token) moving the issue along `AGENT_TRANSITIONS`. Never triggers runs. */
  agentSetStatus(
    actor: Actor,
    idOrKey: string,
    statusKey: string,
  ): Promise<Issue>;
  /** in_progress → todo when a run failed and nothing else is active on the issue. */
  resetAbandonedIssue(tx: Tx, issueId: string): Promise<boolean>;
}

export interface IssueDeps {
  readonly tx: TxRunner;
  readonly ids: IdSource;
  readonly users: UserDirectory;
  readonly activity: ActivityRecorder;
  readonly settings: SettingsService;
  readonly triggers: () => TriggerService;
}

interface ResolvedExecutor {
  readonly executorType: ExecutorType;
  readonly executorId: string | null;
}

async function resolveExecutor(
  conn: Conn,
  users: UserDirectory,
  input: ExecutorInput,
): Promise<ResolvedExecutor> {
  if (!input || typeof input !== 'object')
    throw invalid('INVALID_EXECUTOR', 'executor must be { type, id }.');
  if (input.type === 'none') return { executorType: 'none', executorId: null };
  const id = typeof input.id === 'string' ? input.id : '';
  if (!id) throw invalid('INVALID_EXECUTOR', 'executor.id is required.');
  if (input.type === 'agent') {
    const agent = await conn.query
      .selectFrom('agents')
      .select(['id', 'archivedAt'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!agent || agent.archivedAt)
      throw invalid('INVALID_EXECUTOR', 'executor agent does not exist.');
    return { executorType: 'agent', executorId: id };
  }
  if (input.type === 'user') {
    if (!(await users.exists(conn, id)))
      throw invalid('INVALID_EXECUTOR', 'executor user does not exist.');
    return { executorType: 'user', executorId: id };
  }
  throw invalid(
    'INVALID_EXECUTOR',
    'executor.type must be user, agent or none.',
  );
}

async function resolveOwner(
  conn: Conn,
  users: UserDirectory,
  ownerUserId: unknown,
): Promise<string | null> {
  if (ownerUserId === null) return null;
  if (
    typeof ownerUserId !== 'string' ||
    !(await users.exists(conn, ownerUserId))
  ) {
    throw invalid('INVALID_OWNER', 'ownerUserId does not exist.');
  }
  return ownerUserId;
}

function validateTitle(title: unknown): string {
  if (typeof title !== 'string' || title.trim() === '')
    throw invalid('INVALID_TITLE', 'title is required.');
  if (title.length > MAX_TITLE_LENGTH)
    throw invalid('INVALID_TITLE', 'title is too long.');
  return title.trim();
}

function validateStatus(statusKey: unknown): string {
  if (typeof statusKey !== 'string' || !isKnownStatus(statusKey)) {
    throw invalid('INVALID_STATUS', 'statusKey is not in the status catalog.');
  }
  return statusKey;
}

/** Validated column changes for a patch, plus one activity per changed field. */
async function computeChanges(
  deps: IssueDeps,
  conn: Conn,
  before: Issue,
  patch: UpdateIssueRequest,
): Promise<{
  values: Record<string, unknown>;
  activities: { action: string; details: Record<string, unknown> }[];
}> {
  const values: Record<string, unknown> = {};
  const activities: { action: string; details: Record<string, unknown> }[] = [];
  const change = (field: keyof Issue, action: string, value: unknown) => {
    if (before[field] === value) return;
    values[field] = value;
    activities.push({ action, details: { from: before[field], to: value } });
  };
  if (patch.title !== undefined)
    change('title', 'title_changed', validateTitle(patch.title));
  if (patch.description !== undefined) {
    if (typeof patch.description !== 'string')
      throw invalid('INVALID_DESCRIPTION', 'description must be a string.');
    if (patch.description !== before.description) {
      values.description = patch.description;
      activities.push({ action: 'description_changed', details: {} });
    }
  }
  if (patch.statusKey !== undefined)
    change('statusKey', 'status_changed', validateStatus(patch.statusKey));
  if (patch.priority !== undefined) {
    if (!isIssuePriority(patch.priority))
      throw invalid('INVALID_PRIORITY', 'priority is not valid.');
    change('priority', 'priority_changed', patch.priority);
  }
  if (patch.ownerUserId !== undefined) {
    change(
      'ownerUserId',
      'owner_changed',
      await resolveOwner(conn, deps.users, patch.ownerUserId),
    );
  }
  if (patch.executor !== undefined) {
    const next = await resolveExecutor(conn, deps.users, patch.executor);
    if (
      next.executorType !== before.executorType ||
      next.executorId !== before.executorId
    ) {
      values.executorType = next.executorType;
      values.executorId = next.executorId;
      activities.push({
        action: 'executor_changed',
        details: {
          from: { type: before.executorType, id: before.executorId },
          to: { type: next.executorType, id: next.executorId },
        },
      });
    }
  }
  return { values, activities };
}

async function create(
  deps: IssueDeps,
  actor: Actor,
  input: CreateIssueRequest,
): Promise<Issue> {
  const title = validateTitle(input?.title);
  const statusKey =
    input.statusKey === undefined
      ? DEFAULT_STATUS
      : validateStatus(input.statusKey);
  const priority = input.priority ?? 'none';
  if (!isIssuePriority(priority))
    throw invalid('INVALID_PRIORITY', 'priority is not valid.');
  if (
    input.description !== undefined &&
    typeof input.description !== 'string'
  ) {
    throw invalid('INVALID_DESCRIPTION', 'description must be a string.');
  }
  return deps.tx.run(async (tx) => {
    const ownerUserId =
      input.ownerUserId === undefined
        ? actor.id
        : await resolveOwner(tx.conn, deps.users, input.ownerUserId);
    const executor = input.executor
      ? await resolveExecutor(tx.conn, deps.users, input.executor)
      : { executorType: 'none' as const, executorId: null };
    const projectId = input.projectId ?? null;
    if (
      projectId &&
      !(await tx.conn.query
        .selectFrom('projects')
        .select('id')
        .where('id', '=', projectId)
        .exists())
    ) {
      throw invalid('INVALID_PROJECT', 'projectId does not exist.');
    }
    const { number, identifier } = await deps.settings.allocateIssueNumber(
      tx.conn,
    );
    const id = deps.ids.next();
    const timestamp = now();
    await tx.conn.query
      .insertInto('issues')
      .values({
        id,
        number,
        identifier,
        title,
        description: input.description ?? '',
        statusKey,
        priority,
        ownerUserId,
        ...executor,
        parentIssueId: null,
        projectId,
        revision: 1,
        lastActivityAt: timestamp,
        createdById: actor.id,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .execute();
    await deps.activity.record(tx.conn, {
      issueId: id,
      actor,
      action: 'issue_created',
      details: { identifier },
    });
    const issue = (await findIssue(tx.conn, id)) as Issue;
    await deps
      .triggers()
      .onIssueChanged(tx, { before: null, after: issue, actor });
    tx.emit({ type: 'issue.changed', issueId: id });
    return issue;
  });
}

async function update(
  deps: IssueDeps,
  actor: Actor,
  idOrKey: string,
  patch: UpdateIssueRequest,
): Promise<Issue> {
  if (!Number.isInteger(patch?.revision))
    throw invalid('REVISION_REQUIRED', 'revision is required.');
  return deps.tx.run(async (tx) => {
    const before = await findIssue(tx.conn, idOrKey);
    if (!before) throw notFound('Issue');
    if (before.revision !== patch.revision) {
      throw conflict(
        'REVISION_CONFLICT',
        `Issue is at revision ${before.revision}.`,
      );
    }
    const { values, activities } = await computeChanges(
      deps,
      tx.conn,
      before,
      patch,
    );
    if (activities.length === 0) return before;
    const timestamp = now();
    const result = await tx.conn.query
      .updateTable('issues')
      .set({
        ...values,
        revision: before.revision + 1,
        updatedAt: timestamp,
        lastActivityAt: timestamp,
      })
      .where('id', '=', before.id)
      .where('revision', '=', patch.revision)
      .execute();
    if ((result.updatedCount ?? 0) === 0)
      throw conflict('REVISION_CONFLICT', 'Issue was changed concurrently.');
    for (const activity of activities) {
      await deps.activity.record(tx.conn, {
        issueId: before.id,
        actor,
        ...activity,
      });
    }
    const after = (await findIssue(tx.conn, before.id)) as Issue;
    await deps.triggers().onIssueChanged(tx, { before, after, actor });
    tx.emit({ type: 'issue.changed', issueId: before.id });
    return after;
  });
}

async function agentSetStatus(
  deps: IssueDeps,
  actor: Actor,
  idOrKey: string,
  statusKey: string,
): Promise<Issue> {
  const target = validateStatus(statusKey);
  return deps.tx.run(async (tx) => {
    const before = await findIssue(tx.conn, idOrKey);
    if (!before) throw notFound('Issue');
    if (before.statusKey === target) return before;
    if (!isAgentTransitionAllowed(before.statusKey, target)) {
      throw forbidden(
        'TRANSITION_NOT_ALLOWED',
        `Agents may not move an issue from ${before.statusKey} to ${target}.`,
      );
    }
    const timestamp = now();
    await tx.conn.query
      .updateTable('issues')
      .set({
        statusKey: target,
        revision: before.revision + 1,
        updatedAt: timestamp,
        lastActivityAt: timestamp,
      })
      .where('id', '=', before.id)
      .execute();
    await deps.activity.record(tx.conn, {
      issueId: before.id,
      actor,
      action: 'status_changed',
      details: { from: before.statusKey, to: target },
    });
    tx.emit({ type: 'issue.changed', issueId: before.id });
    return (await findIssue(tx.conn, before.id)) as Issue;
  });
}

async function resetAbandonedIssue(
  deps: IssueDeps,
  tx: Tx,
  issueId: string,
): Promise<boolean> {
  const row = await tx.conn.query
    .selectFrom('issues')
    .selectAll()
    .where('id', '=', issueId)
    .executeTakeFirst();
  if (!row) return false;
  const issue = mapIssue(row);
  if (issue.statusKey !== 'in_progress') return false;
  const busy = await tx.conn.query
    .selectFrom('runs')
    .select('id')
    .where('subjectType', '=', 'issue')
    .where('subjectId', '=', issueId)
    .where('status', 'in', ACTIVE_STATUSES)
    .exists();
  if (busy) return false;
  const timestamp = now();
  await tx.conn.query
    .updateTable('issues')
    .set({
      statusKey: 'todo',
      revision: issue.revision + 1,
      updatedAt: timestamp,
      lastActivityAt: timestamp,
    })
    .where('id', '=', issueId)
    .where('statusKey', '=', 'in_progress')
    .execute();
  await deps.activity.record(tx.conn, {
    issueId,
    actor: SYSTEM_ACTOR,
    action: 'status_changed',
    details: { from: 'in_progress', to: 'todo', reason: 'runFailed' },
  });
  tx.emit({ type: 'issue.changed', issueId });
  return true;
}

export function createIssueService(deps: IssueDeps): IssueService {
  return {
    create: (actor, input) => create(deps, actor, input),
    update: (actor, idOrKey, patch) => update(deps, actor, idOrKey, patch),
    agentSetStatus: (actor, idOrKey, statusKey) =>
      agentSetStatus(deps, actor, idOrKey, statusKey),
    resetAbandonedIssue: (tx, issueId) =>
      resetAbandonedIssue(deps, tx, issueId),
  };
}
