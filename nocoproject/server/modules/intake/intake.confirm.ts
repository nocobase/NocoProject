/**
 * Confirming an intake batch (docs/phase1/iteration-2-contract.md §E): the drafts are validated again, then every
 * issue is inserted parents first (`originType = 'intake'`, `originId = batchId`, creator = the member who entered
 * the batch, activity `issue_created` with `intakeBatchId`). Only after all of them exist do the trigger rules run for
 * those executed by an agent, so a later stage sees its earlier siblings and is deferred as blocked.
 */
import type { Actor } from '../shared/activity.js';
import {
  requireInvokeAgent,
  requireVisibleIssue,
  viewerOf,
} from '../shared/authz.js';
import type { Tx } from '../shared/db.js';
import { now } from '../shared/db.js';
import { invalid } from '../shared/errors.js';
import type {
  ConfirmIntakeRequest,
  ConfirmIntakeResponse,
  ExecutorInput,
  IntakeBatch,
  IssueV2,
} from '../shared/protocol.js';
import {
  resolveExecutor,
  resolveOwner,
  validateTitle,
} from '../issue/issue.fields.js';
import { issueRef } from '../issue/issue.records.js';
import { DEFAULT_STATUS } from '../issue/status.js';
import { ensureLabelsByName } from '../label/label.service.js';
import { draftsOf, setBatchStatus } from './intake.records.js';
import type { IntakeDeps } from './intake.service.js';
import { validateDrafts } from './intake.validation.js';

async function executorFor(
  deps: IntakeDeps,
  tx: Tx,
  creatorId: string,
  input: ExecutorInput | null | undefined,
) {
  if (!input) return { executorType: 'none' as const, executorId: null };
  const executor = await resolveExecutor(tx.conn, deps.users, input);
  if (executor.executorType === 'agent' && executor.executorId)
    await requireInvokeAgent(tx.conn, creatorId, executor.executorId);
  return executor;
}

export async function confirmBatch(
  deps: IntakeDeps,
  tx: Tx,
  actor: Actor,
  batch: IntakeBatch,
  input: ConfirmIntakeRequest,
): Promise<ConfirmIntakeResponse> {
  const creatorId = batch.createdById;
  const creator: Actor = { type: 'user', id: creatorId };
  const drafts = await draftsOf(tx.conn, batch.id);
  const validated = await validateDrafts(
    {
      conn: tx.conn,
      users: deps.users,
      creatorId,
      underIssue: !!batch.sourceIssueId,
    },
    drafts.map(({ position, parentPosition, fields }) => ({
      position,
      parentPosition,
      fields,
    })),
  );
  const firstError = validated.find((draft) => draft.errors.length > 0);
  if (firstError)
    throw invalid(
      'INTAKE_INVALID',
      `Draft ${firstError.position}: ${firstError.errors.join('; ')}.`,
    );
  if (validated.length === 0)
    throw invalid('INTAKE_INVALID', 'The batch has no drafts.');
  const defaultOwner =
    input.ownerUserId === undefined || input.ownerUserId === null
      ? creatorId
      : await resolveOwner(tx.conn, deps.users, input.ownerUserId);
  const sourceIssue = batch.sourceIssueId
    ? await requireVisibleIssue(
        tx.conn,
        await viewerOf(tx.conn, creator),
        batch.sourceIssueId,
      )
    : null;
  const { autoExecuteSubtasksDefault } = await deps.settings.read(tx.conn);
  const created = new Map<number, IssueV2>();
  for (const draft of validated) {
    const parent =
      draft.parentPosition !== null
        ? (created.get(draft.parentPosition) ?? null)
        : sourceIssue;
    const fields = draft.fields;
    const issue = await deps.issues().insertIssue(tx, creator, {
      title: validateTitle(fields.title),
      description: fields.description ?? '',
      statusKey: DEFAULT_STATUS,
      priority: fields.priority ?? 'none',
      ownerUserId: fields.ownerUserId ?? defaultOwner,
      executor: await executorFor(
        deps,
        tx,
        creatorId,
        fields.executor ?? input.defaultExecutor,
      ),
      parentIssueId: parent?.id ?? null,
      projectId: parent ? parent.projectId : batch.projectId,
      stage: parent && typeof fields.stage === 'number' ? fields.stage : null,
      startDate: null,
      dueDate: null,
      autoExecuteSubtasks: autoExecuteSubtasksDefault,
      labelIds: fields.labels?.length
        ? await ensureLabelsByName(tx, deps.ids, fields.labels)
        : [],
      createdById: creatorId,
      originType: 'intake',
      originId: batch.id,
      activityDetails: { intakeBatchId: batch.id },
    });
    created.set(draft.position, issue);
    await tx.conn.query
      .updateTable('intakeDrafts')
      .set({ createdIssueId: issue.id, updatedAt: now() })
      .where('batchId', '=', batch.id)
      .where('position', '=', draft.position)
      .execute();
  }
  for (const issue of created.values())
    if (issue.executorType === 'agent')
      await deps
        .triggers()
        .onIssueChanged(tx, { before: null, after: issue, actor: creator });
  await setBatchStatus(tx, batch.id, 'confirmed', { confirmedAt: now() });
  if (sourceIssue)
    await deps.activity.record(tx.conn, {
      issueId: sourceIssue.id,
      actor,
      action: 'intake_confirmed',
      details: { intakeBatchId: batch.id, count: created.size },
    });
  return { issues: Array.from(created.values()).map(issueRef) };
}
