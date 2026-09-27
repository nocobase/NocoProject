/**
 * Issue writes: create (atomic numbering), optimistic update, and the in-transaction helpers the subtask, intake and
 * git modules compose (insert, assign an agent, system status writes). Status writes other than a field edit live in
 * `issue.status.ts`.
 *
 * Every write records activities and emits `issue.changed` plus an `issue.created` / `issue.updated` event for the
 * notification module. Human writes are authorized here (`shared/authz.ts`, `issue.fields.ts`), pass the approval
 * gate when they change the status (iteration 2), and are handed to the trigger service in the same transaction.
 */
import type { Actor, ActivityRecorder } from '../shared/activity.js';
import type { ApprovalGateway } from '../shared/approval.js';
import {
  requireInvokeAgent,
  requireVisibleIssue,
  viewerOf,
  type Viewer,
} from '../shared/authz.js';
import type { Tx, TxRunner } from '../shared/db.js';
import { now } from '../shared/db.js';
import { conflict, invalid } from '../shared/errors.js';
import type { IdSource } from '../shared/ids.js';
import type {
  ApprovalRequest,
  CreateIssueRequestV2,
  ExecutionMode,
  IssueOriginType,
  IssuePriority,
  IssueV1,
  IssueV2,
  Phase1RunTriggerType,
  TriggeredRun,
  UpdateIssueRequestV2,
} from '../shared/protocol.js';
import type { UserDirectory } from '../shared/users.js';
import { EXECUTION_MODES } from '../shared/protocol.js';
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
import { eventActor, emitUpdate } from './issue.events.js';
import { findIssue, isIssuePriority } from './issue.records.js';
import {
  agentSetStatus,
  applyApprovedTransition,
  gateTransition,
  resetAbandonedIssue,
  systemSetStatus,
  type IssueStatusResult,
} from './issue.status.js';
import { DEFAULT_STATUS } from './status.js';

export { eventActor } from './issue.events.js';
export type { IssueStatusResult } from './issue.status.js';

export interface IssueService {
  create(actor: Actor, input: CreateIssueRequestV2): Promise<IssueV2>;
  /** `patch` without the approval outcome (the issue is unchanged when the status change waits for approval). */
  update(
    actor: Actor,
    idOrKey: string,
    patch: UpdateIssueRequestV2,
  ): Promise<IssueV2>;
  /** The browser PATCH: a status change that needs approval leaves the whole patch unapplied (202). */
  patch(
    actor: Actor,
    idOrKey: string,
    patch: UpdateIssueRequestV2,
  ): Promise<IssueStatusResult>;
  /** An agent (run token) moving the issue along its workflow's agent transitions. Never enqueues for itself. */
  agentSetStatus(
    actor: Actor,
    idOrKey: string,
    statusKey: string,
  ): Promise<IssueV2>;
  /** `agentSetStatus` with the approval outcome (the agent route answers 202 when it is pending). */
  agentSetStatusGated(
    actor: Actor,
    idOrKey: string,
    statusKey: string,
  ): Promise<IssueStatusResult>;
  /** in_progress → todo when a run failed and nothing else is active on the issue. */
  resetAbandonedIssue(tx: Tx, issueId: string): Promise<boolean>;
  /** A system status write inside `tx` (merged pull request): not gated, not limited by agent transitions. */
  systemSetStatus(
    tx: Tx,
    issueId: string,
    target: string,
    details: Readonly<Record<string, unknown>>,
  ): Promise<IssueV2 | null>;
  /** Applies an approved request inside `tx` on the approver's behalf. */
  applyApprovedTransition(
    tx: Tx,
    request: ApprovalRequest,
    approver: Actor,
  ): Promise<void>;
  /** Inserts a validated issue (numbering, activity, labels) inside `tx`. */
  insertIssue(tx: Tx, actor: Actor, values: NewIssue): Promise<IssueV2>;
  /** Sets an agent executor inside `tx` and runs the assign rule with the given trigger type. */
  assignAgentInTx(
    tx: Tx,
    issue: IssueV1,
    agentId: string,
    actor: Actor,
    triggerType: 'assign' | 'proposalAccepted',
  ): Promise<{ issue: IssueV2; triggered: TriggeredRun[] }>;
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
  /** Iteration 2 (default task / manual / null). */
  readonly executionMode?: ExecutionMode;
  readonly originType?: IssueOriginType;
  readonly originId?: string | null;
  /** Extra details on the `issue_created` activity (e.g. `intakeBatchId`). */
  readonly activityDetails?: Readonly<Record<string, unknown>>;
}

export interface IssueDeps {
  readonly tx: TxRunner;
  readonly ids: IdSource;
  readonly users: UserDirectory;
  readonly activity: ActivityRecorder;
  readonly settings: SettingsService;
  readonly workflows: WorkflowService;
  readonly triggers: () => TriggerService;
  readonly approvals: () => ApprovalGateway;
}

async function insertIssue(
  deps: IssueDeps,
  tx: Tx,
  actor: Actor,
  input: NewIssue,
): Promise<IssueV2> {
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
      executionMode: input.executionMode ?? 'task',
      originType: input.originType ?? 'manual',
      originId: input.originId ?? null,
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
    details: { ...input.activityDetails, identifier },
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
  return (await findIssue(tx.conn, id)) as IssueV2;
}

/** Validation that needs no database (fails before a transaction starts). */
function validateCreate(input: CreateIssueRequestV2): void {
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
  if (
    input.executionMode !== undefined &&
    !EXECUTION_MODES.includes(input.executionMode)
  )
    throw invalid(
      'INVALID_EXECUTION_MODE',
      'executionMode must be task or session.',
    );
}

async function resolveNewIssue(
  deps: IssueDeps,
  tx: Tx,
  viewer: Viewer,
  input: CreateIssueRequestV2,
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
    executionMode: input.executionMode ?? 'task',
  };
}

async function create(
  deps: IssueDeps,
  actor: Actor,
  input: CreateIssueRequestV2,
): Promise<IssueV2> {
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

async function update(
  deps: IssueDeps,
  actor: Actor,
  idOrKey: string,
  patch: UpdateIssueRequestV2,
): Promise<IssueStatusResult> {
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
    if (typeof values.statusKey === 'string') {
      const pending = await gateTransition(
        deps,
        tx,
        before,
        values.statusKey,
        actor,
        view,
      );
      if (pending) return { issue: before, pendingApproval: pending };
    }
    const labelChange = labelIds
      ? await setIssueLabels(tx, deps.ids, before.id, labelIds)
      : { added: [], removed: [] };
    if (labelChange.added.length || labelChange.removed.length)
      activities.push({ action: 'labels_changed', details: labelChange });
    if (activities.length === 0)
      return { issue: before, pendingApproval: null };
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
    const after = (await findIssue(tx.conn, before.id)) as IssueV2;
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
    return { issue: after, pendingApproval: null };
  });
}

async function assignAgentInTx(
  deps: IssueDeps,
  tx: Tx,
  issue: IssueV1,
  agentId: string,
  actor: Actor,
  triggerType: Phase1RunTriggerType & ('assign' | 'proposalAccepted'),
): Promise<{ issue: IssueV2; triggered: TriggeredRun[] }> {
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
  const after = (await findIssue(tx.conn, issue.id)) as IssueV2;
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
    update: async (actor, idOrKey, patch) =>
      (await update(deps, actor, idOrKey, patch)).issue,
    patch: (actor, idOrKey, patch) => update(deps, actor, idOrKey, patch),
    agentSetStatus: async (actor, idOrKey, statusKey) =>
      (await agentSetStatus(deps, actor, idOrKey, statusKey)).issue,
    agentSetStatusGated: (actor, idOrKey, statusKey) =>
      agentSetStatus(deps, actor, idOrKey, statusKey),
    resetAbandonedIssue: (tx, issueId) =>
      resetAbandonedIssue(deps, tx, issueId),
    systemSetStatus: (tx, issueId, target, details) =>
      systemSetStatus(deps, tx, issueId, target, details),
    applyApprovedTransition: (tx, request, approver) =>
      applyApprovedTransition(deps, tx, request, approver),
    insertIssue: (tx, actor, values) => insertIssue(deps, tx, actor, values),
    assignAgentInTx: (tx, issue, agentId, actor, triggerType) =>
      assignAgentInTx(deps, tx, issue, agentId, actor, triggerType),
  };
}
