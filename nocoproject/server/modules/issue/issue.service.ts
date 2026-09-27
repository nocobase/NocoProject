/**
 * Issue writes: create (atomic numbering), optimistic update, agent status transitions, the system reset of an
 * abandoned in-progress issue, and the in-transaction helpers the subtask module composes (insert, assign an agent).
 *
 * Every write records activities and emits `issue.changed` plus an `issue.created` / `issue.updated` event for the
 * notification module. Human writes are authorized here (`shared/authz.ts`, `issue.fields.ts`) and handed to the
 * trigger service in the same transaction.
 */
import type { Actor, ActivityRecorder } from '../shared/activity.js';
import { SYSTEM_ACTOR } from '../shared/activity.js';
import {
  requireInvokeAgent,
  requireVisibleIssue,
  viewerOf,
  type Viewer,
} from '../shared/authz.js';
import type { Tx, TxRunner } from '../shared/db.js';
import { now } from '../shared/db.js';
import { conflict, forbidden, invalid, notFound } from '../shared/errors.js';
import type { EventActor, IssueChangeSet } from '../shared/events.js';
import type { IdSource } from '../shared/ids.js';
import type {
  CreateIssueRequestV1,
  IssuePriority,
  IssueV1,
  Phase1RunTriggerType,
  TriggeredRun,
  UpdateIssueRequestV1,
} from '../shared/protocol.js';
import type { UserDirectory } from '../shared/users.js';
import {
  stringList,
  validateBoolean,
  validateDate,
  validateStage,
} from '../shared/validate.js';
import type { SettingsService } from '../system/settings.service.js';
import type { TriggerService } from '../trigger/trigger.service.js';
import type { WorkflowService } from '../workflow/workflow.service.js';
import { parseUserMentions } from '../collaboration/mentions.js';
import { requireLabels, setIssueLabels } from '../label/label.service.js';
import { ACTIVE_STATUSES } from '../run/run.records.js';
import { insertDependency } from '../subtask/dependency.service.js';
import {
  computeChanges,
  newMentions,
  resolveExecutor,
  resolveOwner,
  resolveParent,
  resolveProject,
  validateStatus,
  validateTitle,
  type ResolvedExecutor,
} from './issue.fields.js';
import { findIssue, isIssuePriority, mapIssue } from './issue.records.js';
import { DEFAULT_STATUS } from './status.js';

export interface IssueService {
  create(actor: Actor, input: CreateIssueRequestV1): Promise<IssueV1>;
  update(
    actor: Actor,
    idOrKey: string,
    patch: UpdateIssueRequestV1,
  ): Promise<IssueV1>;
  /** An agent (run token) moving the issue along its workflow's agent transitions. Never enqueues for itself. */
  agentSetStatus(
    actor: Actor,
    idOrKey: string,
    statusKey: string,
  ): Promise<IssueV1>;
  /** in_progress → todo when a run failed and nothing else is active on the issue. */
  resetAbandonedIssue(tx: Tx, issueId: string): Promise<boolean>;
  /** Inserts a validated issue (numbering, activity, labels) inside `tx`. */
  insertIssue(tx: Tx, actor: Actor, values: NewIssue): Promise<IssueV1>;
  /** Sets an agent executor inside `tx` and runs the assign rule with the given trigger type. */
  assignAgentInTx(
    tx: Tx,
    issue: IssueV1,
    agentId: string,
    actor: Actor,
    triggerType: 'assign' | 'proposalAccepted',
  ): Promise<{ issue: IssueV1; triggered: TriggeredRun[] }>;
}

export interface NewIssue {
  readonly title: string;
  readonly description: string;
  readonly statusKey: string;
  readonly priority: IssuePriority;
  readonly ownerUserId: string | null;
  readonly executor: ResolvedExecutor;
  readonly parentIssueId: string | null;
  readonly projectId: string | null;
  readonly stage: number | null;
  readonly startDate: string | null;
  readonly dueDate: string | null;
  readonly autoExecuteSubtasks: boolean;
  readonly suggestedExecutorAgentId?: string | null;
  readonly labelIds: readonly string[];
  /** `issues.createdById` (a user id; null for agent-created issues). */
  readonly createdById: string | null;
}

export interface IssueDeps {
  readonly tx: TxRunner;
  readonly ids: IdSource;
  readonly users: UserDirectory;
  readonly activity: ActivityRecorder;
  readonly settings: SettingsService;
  readonly workflows: WorkflowService;
  readonly triggers: () => TriggerService;
}

export function eventActor(actor: Actor): EventActor {
  return { type: actor.type, id: actor.id };
}

async function insertIssue(
  deps: IssueDeps,
  tx: Tx,
  actor: Actor,
  input: NewIssue,
): Promise<IssueV1> {
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
      title: input.title,
      description: input.description,
      statusKey: input.statusKey,
      priority: input.priority,
      ownerUserId: input.ownerUserId,
      ...input.executor,
      parentIssueId: input.parentIssueId,
      projectId: input.projectId,
      stage: input.stage,
      startDate: input.startDate,
      dueDate: input.dueDate,
      autoExecuteSubtasks: input.autoExecuteSubtasks,
      suggestedExecutorAgentId: input.suggestedExecutorAgentId ?? null,
      revision: 1,
      lastActivityAt: timestamp,
      createdById: input.createdById,
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
  if (input.parentIssueId) {
    await deps.activity.record(tx.conn, {
      issueId: input.parentIssueId,
      actor,
      action: 'subtask_added',
      details: { issueId: id, identifier },
    });
    tx.emit({ type: 'issue.changed', issueId: input.parentIssueId });
  }
  if (input.labelIds.length > 0)
    await setIssueLabels(tx, deps.ids, id, input.labelIds);
  tx.emit({ type: 'issue.changed', issueId: id });
  tx.emit({
    type: 'issue.created',
    issueId: id,
    actor: eventActor(actor),
    mentionedUserIds: parseUserMentions(input.description),
  });
  return (await findIssue(tx.conn, id)) as IssueV1;
}

/** Validation that needs no database (fails before a transaction starts). */
function validateCreate(input: CreateIssueRequestV1): void {
  validateTitle(input?.title);
  if (input.priority !== undefined && !isIssuePriority(input.priority))
    throw invalid('INVALID_PRIORITY', 'priority is not valid.');
  if (input.description !== undefined && typeof input.description !== 'string')
    throw invalid('INVALID_DESCRIPTION', 'description must be a string.');
  if (input.stage !== undefined) validateStage(input.stage);
  if (input.startDate !== undefined) validateDate(input.startDate, 'startDate');
  if (input.dueDate !== undefined) validateDate(input.dueDate, 'dueDate');
  if (input.autoExecuteSubtasks !== undefined)
    validateBoolean(input.autoExecuteSubtasks, 'autoExecuteSubtasks');
  if (input.blockedBy !== undefined) stringList(input.blockedBy, 'blockedBy');
  if (input.labelIds !== undefined) stringList(input.labelIds, 'labelIds');
}

async function resolveNewIssue(
  deps: IssueDeps,
  tx: Tx,
  viewer: Viewer,
  input: CreateIssueRequestV1,
): Promise<NewIssue> {
  const conn = tx.conn;
  const parent =
    input.parentIssueId === undefined || input.parentIssueId === null
      ? null
      : await resolveParent(conn, viewer, input.parentIssueId, null);
  const projectId =
    input.projectId === undefined
      ? (parent?.projectId ?? null)
      : await resolveProject(conn, viewer, input.projectId);
  const view = await deps.workflows.forProject(conn, projectId);
  const executor = input.executor
    ? await resolveExecutor(conn, deps.users, input.executor)
    : { executorType: 'none' as const, executorId: null };
  if (executor.executorType === 'agent' && executor.executorId)
    await requireInvokeAgent(conn, viewer.userId, executor.executorId);
  const statusKey =
    input.statusKey === undefined
      ? DEFAULT_STATUS
      : validateStatus(view, input.statusKey);
  return {
    title: validateTitle(input.title),
    description: input.description ?? '',
    statusKey,
    priority: input.priority ?? 'none',
    ownerUserId:
      input.ownerUserId === undefined
        ? viewer.userId
        : await resolveOwner(conn, deps.users, input.ownerUserId),
    executor,
    parentIssueId: parent?.id ?? null,
    projectId,
    stage: input.stage === undefined ? null : validateStage(input.stage),
    startDate: validateDate(input.startDate ?? null, 'startDate'),
    dueDate: validateDate(input.dueDate ?? null, 'dueDate'),
    autoExecuteSubtasks:
      input.autoExecuteSubtasks ??
      (await deps.settings.read(conn)).autoExecuteSubtasksDefault,
    labelIds: await requireLabels(
      conn,
      input.labelIds ? stringList(input.labelIds, 'labelIds') : [],
    ),
    createdById: viewer.userId,
  };
}

async function create(
  deps: IssueDeps,
  actor: Actor,
  input: CreateIssueRequestV1,
): Promise<IssueV1> {
  validateCreate(input);
  return deps.tx.run(async (tx) => {
    const viewer = await viewerOf(tx.conn, actor);
    const values = await resolveNewIssue(deps, tx, viewer, input);
    const issue = await insertIssue(deps, tx, actor, values);
    for (const target of input.blockedBy ?? []) {
      let dependsOn: IssueV1;
      try {
        dependsOn = await requireVisibleIssue(tx.conn, viewer, target);
      } catch {
        throw invalid(
          'INVALID_DEPENDENCY',
          `blockedBy ${target} does not exist.`,
        );
      }
      await insertDependency(tx, deps, {
        issue,
        dependsOn,
        type: 'blockedBy',
        actor,
      });
    }
    await deps.triggers().onIssueChanged(tx, {
      before: null,
      after: issue,
      actor,
      start: input.start,
    });
    return issue;
  });
}

function changeSet(
  before: IssueV1,
  after: IssueV1,
  mentionedUserIds: string[],
): IssueChangeSet {
  return {
    ...(before.statusKey !== after.statusKey
      ? { status: { from: before.statusKey, to: after.statusKey } }
      : {}),
    ...(before.ownerUserId !== after.ownerUserId
      ? { owner: { from: before.ownerUserId, to: after.ownerUserId } }
      : {}),
    ...(before.executorType !== after.executorType ||
    before.executorId !== after.executorId
      ? {
          executor: {
            from: { type: before.executorType, id: before.executorId },
            to: { type: after.executorType, id: after.executorId },
          },
        }
      : {}),
    ...(mentionedUserIds.length > 0 ? { mentionedUserIds } : {}),
  };
}

async function update(
  deps: IssueDeps,
  actor: Actor,
  idOrKey: string,
  patch: UpdateIssueRequestV1,
): Promise<IssueV1> {
  if (!Number.isInteger(patch?.revision))
    throw invalid('REVISION_REQUIRED', 'revision is required.');
  return deps.tx.run(async (tx) => {
    const viewer = await viewerOf(tx.conn, actor);
    const before = await requireVisibleIssue(tx.conn, viewer, idOrKey);
    if (before.revision !== patch.revision) {
      throw conflict(
        'REVISION_CONFLICT',
        `Issue is at revision ${before.revision}.`,
      );
    }
    const projectId =
      patch.projectId === undefined ? before.projectId : patch.projectId;
    const view = await deps.workflows.forProject(tx.conn, projectId);
    const { values, activities, labelIds } = await computeChanges(
      { conn: tx.conn, users: deps.users, viewer, before, view },
      patch,
    );
    const labelChange = labelIds
      ? await setIssueLabels(tx, deps.ids, before.id, labelIds)
      : { added: [], removed: [] };
    if (labelChange.added.length || labelChange.removed.length)
      activities.push({ action: 'labels_changed', details: labelChange });
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
    const after = (await findIssue(tx.conn, before.id)) as IssueV1;
    const triggers = deps.triggers();
    await triggers.onIssueChanged(tx, {
      before,
      after,
      actor,
      start: patch.start,
    });
    await triggers.onStatusChanged(tx, { before, after, actor });
    emitUpdate(
      tx,
      before,
      after,
      actor,
      newMentions(before.description, after.description),
    );
    for (const parentId of [before.parentIssueId, after.parentIssueId])
      if (parentId) tx.emit({ type: 'issue.changed', issueId: parentId });
    return after;
  });
}

function emitUpdate(
  tx: Tx,
  before: IssueV1,
  after: IssueV1,
  actor: Actor,
  mentionedUserIds: string[] = [],
): void {
  tx.emit({ type: 'issue.changed', issueId: after.id });
  const changes = changeSet(before, after, mentionedUserIds);
  if (Object.keys(changes).length > 0)
    tx.emit({
      type: 'issue.updated',
      issueId: after.id,
      actor: eventActor(actor),
      changes,
    });
}

async function agentSetStatus(
  deps: IssueDeps,
  actor: Actor,
  idOrKey: string,
  statusKey: string,
): Promise<IssueV1> {
  return deps.tx.run(async (tx) => {
    const before = await findIssue(tx.conn, idOrKey);
    if (!before) throw notFound('Issue');
    const view = await deps.workflows.forIssue(tx.conn, before);
    const target = validateStatus(view, statusKey);
    if (before.statusKey === target) return before;
    if (!view.canTransition(before.statusKey, target, 'agent')) {
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
    const after = (await findIssue(tx.conn, before.id)) as IssueV1;
    await deps.triggers().onStatusChanged(tx, { before, after, actor });
    emitUpdate(tx, before, after, actor);
    return after;
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
  const after = (await findIssue(tx.conn, issueId)) as IssueV1;
  emitUpdate(tx, issue, after, SYSTEM_ACTOR);
  return true;
}

async function assignAgentInTx(
  deps: IssueDeps,
  tx: Tx,
  issue: IssueV1,
  agentId: string,
  actor: Actor,
  triggerType: Phase1RunTriggerType & ('assign' | 'proposalAccepted'),
): Promise<{ issue: IssueV1; triggered: TriggeredRun[] }> {
  const executor = await resolveExecutor(tx.conn, deps.users, {
    type: 'agent',
    id: agentId,
  });
  const timestamp = now();
  await tx.conn.query
    .updateTable('issues')
    .set({
      ...executor,
      revision: issue.revision + 1,
      updatedAt: timestamp,
      lastActivityAt: timestamp,
    })
    .where('id', '=', issue.id)
    .execute();
  await deps.activity.record(tx.conn, {
    issueId: issue.id,
    actor,
    action: 'executor_changed',
    details: {
      from: { type: issue.executorType, id: issue.executorId },
      to: { type: 'agent', id: agentId },
      trigger: triggerType,
    },
  });
  const after = (await findIssue(tx.conn, issue.id)) as IssueV1;
  const triggered = await deps.triggers().onIssueChanged(tx, {
    before: issue,
    after,
    actor,
    assignTriggerType: triggerType,
    onBehalfOfUserId: actor.type === 'user' ? null : after.ownerUserId,
  });
  emitUpdate(tx, issue, after, actor);
  return { issue: after, triggered };
}

export function createIssueService(deps: IssueDeps): IssueService {
  return {
    create: (actor, input) => create(deps, actor, input),
    update: (actor, idOrKey, patch) => update(deps, actor, idOrKey, patch),
    agentSetStatus: (actor, idOrKey, statusKey) =>
      agentSetStatus(deps, actor, idOrKey, statusKey),
    resetAbandonedIssue: (tx, issueId) =>
      resetAbandonedIssue(deps, tx, issueId),
    insertIssue: (tx, actor, values) => insertIssue(deps, tx, actor, values),
    assignAgentInTx: (tx, issue, agentId, actor, triggerType) =>
      assignAgentInTx(deps, tx, issue, agentId, actor, triggerType),
  };
}
