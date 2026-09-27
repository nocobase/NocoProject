/**
 * Batch intake (docs/phase1/iteration-2-contract.md §E): paste text (or split an issue's description), review the
 * drafts, confirm them into issues, and revert a confirmed batch.
 *
 * A batch belongs to the member who entered it; only they (or an owner/admin) may edit, confirm, cancel or revert
 * it. Confirming creates parents before children (`intake.confirm.ts`); reverting soft-deletes the issues it created
 * that never had a run and keeps the others.
 */
import type { Actor, ActivityRecorder } from '../shared/activity.js';
import {
  canSeeProject,
  isAdmin,
  requireVisibleIssue,
  viewerOf,
  type Viewer,
} from '../shared/authz.js';
import type { Conn, Tx, TxRunner } from '../shared/db.js';
import { now, str } from '../shared/db.js';
import { conflict, invalid, notFound } from '../shared/errors.js';
import type { IdSource } from '../shared/ids.js';
import type {
  ConfirmIntakeRequest,
  ConfirmIntakeResponse,
  CreateIntakeBatchRequest,
  CreateIntakeBatchResponse,
  IntakeBatch,
  IntakeBatchDetail,
  IntakeDraft,
  RevertIntakeResponse,
} from '../shared/protocol.js';
import type { UserDirectory } from '../shared/users.js';
import type { SettingsService } from '../system/settings.service.js';
import type { TriggerService } from '../trigger/trigger.service.js';
import type { WorkflowService } from '../workflow/workflow.service.js';
import type { IssueService } from '../issue/issue.service.js';
import type { AiIntakeParser } from './ai-parser.js';
import { confirmBatch } from './intake.confirm.js';
import {
  draftsOf,
  findBatch,
  mapBatch,
  replaceDrafts,
  setBatchStatus,
} from './intake.records.js';
import { validateDrafts } from './intake.validation.js';
import type {
  IntakeParseInput,
  IntakeParseOutcome,
  IntakeParser,
} from './parser.js';

const MAX_RAW_CONTENT = 200_000;
const LIST_LIMIT = 50;

export interface IntakeService {
  create(
    actor: Actor,
    input: CreateIntakeBatchRequest,
  ): Promise<CreateIntakeBatchResponse>;
  list(actor: Actor, mine: boolean): Promise<IntakeBatch[]>;
  get(actor: Actor, id: string): Promise<IntakeBatchDetail>;
  putDrafts(actor: Actor, id: string, drafts: unknown): Promise<IntakeDraft[]>;
  confirm(
    actor: Actor,
    id: string,
    input: ConfirmIntakeRequest,
  ): Promise<ConfirmIntakeResponse>;
  cancel(actor: Actor, id: string): Promise<IntakeBatch>;
  revert(actor: Actor, id: string): Promise<RevertIntakeResponse>;
}

export interface IntakeDeps {
  readonly tx: TxRunner;
  readonly ids: IdSource;
  readonly users: UserDirectory;
  readonly activity: ActivityRecorder;
  readonly settings: SettingsService;
  readonly workflows: WorkflowService;
  readonly issues: () => IssueService;
  readonly triggers: () => TriggerService;
  readonly heuristic: IntakeParser;
  /** Present when the AI employee plugin is registered. */
  readonly ai: AiIntakeParser | null;
  /** True when `ai.llmServices` is not empty. */
  readonly aiConfigured: () => boolean;
}

function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, 500) || 'The AI parser failed.';
}

/** Runs the AI parser when it is available and allowed, falling back to the heuristic (never failing). */
export async function parseIntake(
  deps: IntakeDeps,
  conn: Conn,
  input: IntakeParseInput,
  userId: string,
): Promise<IntakeParseOutcome> {
  let parseError: string | null = null;
  let aiSessionId: string | null = null;
  const useAi =
    deps.ai !== null &&
    deps.aiConfigured() &&
    (await deps.settings.read(conn)).intakeParser === 'auto';
  if (useAi && deps.ai) {
    try {
      const result = await deps.ai.parseAs(input, userId);
      aiSessionId = result.sessionId;
      if (result.drafts.length > 0)
        return {
          drafts: result.drafts,
          parser: 'ai',
          parseError: null,
          aiSessionId,
        };
      parseError = 'The AI parser returned no drafts.';
    } catch (error) {
      parseError = errorMessage(error);
    }
  }
  return {
    drafts: await deps.heuristic.parse(input),
    parser: 'heuristic',
    parseError,
    aiSessionId,
  };
}

async function parseInput(
  conn: Conn,
  workflows: WorkflowService,
  projectId: string | null,
  rawContent: string,
) {
  const project = projectId
    ? await conn.query
        .selectFrom('projects')
        .select(['name', 'description'])
        .where('id', '=', projectId)
        .executeTakeFirst()
    : null;
  const view = await workflows.forProject(conn, projectId);
  const labels = await conn.query
    .selectFrom('issueLabels')
    .select('name')
    .orderBy('name', 'asc')
    .execute();
  return {
    rawContent,
    project: project
      ? { name: str(project.name) ?? '', description: str(project.description) }
      : null,
    workflow: {
      name: view.workflow.name,
      statuses: view.catalog.map((entry) => entry.key),
    },
    labels: labels.map((row) => str(row.name) ?? ''),
  };
}

async function source(
  conn: Conn,
  viewer: Viewer,
  input: CreateIntakeBatchRequest,
): Promise<{
  rawContent: string;
  projectId: string | null;
  sourceIssueId: string | null;
}> {
  if (input?.source === 'issue') {
    if (typeof input.issueId !== 'string' || !input.issueId)
      throw invalid('INVALID_FIELD', 'issueId is required for source issue.');
    const issue = await requireVisibleIssue(conn, viewer, input.issueId);
    return {
      rawContent: issue.description,
      projectId: issue.projectId,
      sourceIssueId: issue.id,
    };
  }
  if (input?.source !== 'paste')
    throw invalid('INVALID_FIELD', 'source must be paste or issue.');
  if (typeof input.rawContent !== 'string' || !input.rawContent.trim())
    throw invalid('INVALID_FIELD', 'rawContent is required.');
  if (input.rawContent.length > MAX_RAW_CONTENT)
    throw invalid('INVALID_FIELD', 'rawContent is too long.');
  const projectId = input.projectId ?? null;
  if (projectId !== null) {
    const exists = await conn.query
      .selectFrom('projects')
      .select('id')
      .where('id', '=', projectId)
      .exists();
    if (!exists || !(await canSeeProject(conn, viewer, projectId)))
      throw invalid('INVALID_PROJECT', 'projectId does not exist.');
  }
  return { rawContent: input.rawContent, projectId, sourceIssueId: null };
}

async function create(
  deps: IntakeDeps,
  actor: Actor,
  input: CreateIntakeBatchRequest,
): Promise<CreateIntakeBatchResponse> {
  const conn = deps.tx.read();
  const viewer = await viewerOf(conn, actor);
  const origin = await source(conn, viewer, input);
  const outcome = await parseIntake(
    deps,
    conn,
    await parseInput(conn, deps.workflows, origin.projectId, origin.rawContent),
    viewer.userId,
  );
  // A batch split from an issue hangs every draft directly under that issue.
  const parsed = origin.sourceIssueId
    ? outcome.drafts.map((draft) => ({ ...draft, parentPosition: null }))
    : outcome.drafts;
  const id = deps.ids.next();
  await deps.tx.run(async (tx) => {
    const drafts = await validateDrafts(
      {
        conn: tx.conn,
        users: deps.users,
        creatorId: viewer.userId,
        underIssue: !!origin.sourceIssueId,
      },
      parsed,
    );
    const timestamp = now();
    await tx.conn.query
      .insertInto('intakeBatches')
      .values({
        id,
        createdById: viewer.userId,
        projectId: origin.projectId,
        source: origin.sourceIssueId ? 'issue' : 'paste',
        sourceIssueId: origin.sourceIssueId,
        rawContent: origin.rawContent,
        parser: outcome.parser,
        parseError: outcome.parseError,
        status: 'draft',
        aiSessionId: outcome.aiSessionId,
        confirmedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .execute();
    await replaceDrafts(tx, deps.ids, id, drafts);
  });
  const read = deps.tx.read();
  return {
    batch: await findBatch(read, id),
    drafts: await draftsOf(read, id),
    parser: outcome.parser,
  };
}

/** The batch, if the caller entered it or is an owner/admin (404 otherwise, so other members' batches do not leak). */
async function ownBatch(
  conn: Conn,
  actor: Actor,
  id: string,
): Promise<{ batch: IntakeBatch; viewer: Viewer }> {
  const viewer = await viewerOf(conn, actor);
  const batch = await findBatch(conn, id);
  if (batch.createdById !== viewer.userId && !isAdmin(viewer))
    throw notFound('Intake batch');
  return { batch, viewer };
}

function requireStatus(
  batch: IntakeBatch,
  status: IntakeBatch['status'],
): void {
  if (batch.status !== status)
    throw conflict(
      'INTAKE_STATE_CONFLICT',
      `The batch is ${batch.status}; expected ${status}.`,
    );
}

async function revert(
  deps: IntakeDeps,
  tx: Tx,
  actor: Actor,
  batch: IntakeBatch,
): Promise<RevertIntakeResponse> {
  const created = (await draftsOf(tx.conn, batch.id))
    .map((draft) => draft.createdIssueId)
    .filter((issueId): issueId is string => !!issueId);
  const reverted: string[] = [];
  const kept: string[] = [];
  for (const issueId of created) {
    const hasRun = await tx.conn.query
      .selectFrom('runs')
      .select('id')
      .where('subjectId', '=', issueId)
      .exists();
    if (hasRun) {
      kept.push(issueId);
      continue;
    }
    const row = await tx.conn.query
      .selectFrom('issues')
      .select(['revision', 'parentIssueId', 'deletedAt'])
      .where('id', '=', issueId)
      .executeTakeFirst();
    if (!row || row.deletedAt) continue;
    const timestamp = now();
    await tx.conn.query
      .updateTable('issues')
      .set({
        deletedAt: timestamp,
        revision: Number(row.revision) + 1,
        updatedAt: timestamp,
      })
      .where('id', '=', issueId)
      .execute();
    await deps.activity.record(tx.conn, {
      issueId,
      actor,
      action: 'intake_reverted',
      details: { intakeBatchId: batch.id },
    });
    tx.emit({ type: 'issue.changed', issueId });
    const parentId = str(row.parentIssueId);
    if (parentId) tx.emit({ type: 'issue.changed', issueId: parentId });
    reverted.push(issueId);
  }
  if (batch.sourceIssueId)
    await deps.activity.record(tx.conn, {
      issueId: batch.sourceIssueId,
      actor,
      action: 'intake_reverted',
      details: {
        intakeBatchId: batch.id,
        reverted: reverted.length,
        kept: kept.length,
      },
    });
  await setBatchStatus(tx, batch.id, 'reverted');
  return { reverted, kept };
}

export function createIntakeService(deps: IntakeDeps): IntakeService {
  return {
    create: (actor, input) => create(deps, actor, input),
    async list(actor, mine) {
      const conn = deps.tx.read();
      const viewer = await viewerOf(conn, actor);
      let query = conn.query.selectFrom('intakeBatches').selectAll();
      if (mine || !isAdmin(viewer))
        query = query.where('createdById', '=', viewer.userId);
      const rows = await query
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .limit(LIST_LIMIT)
        .execute();
      return rows.map(mapBatch);
    },
    async get(actor, id) {
      const conn = deps.tx.read();
      const { batch } = await ownBatch(conn, actor, id);
      return { batch, drafts: await draftsOf(conn, id) };
    },
    async putDrafts(actor, id, drafts) {
      return deps.tx.run(async (tx) => {
        const { batch, viewer } = await ownBatch(tx.conn, actor, id);
        requireStatus(batch, 'draft');
        const validated = await validateDrafts(
          {
            conn: tx.conn,
            users: deps.users,
            creatorId: batch.createdById || viewer.userId,
            underIssue: !!batch.sourceIssueId,
          },
          drafts,
        );
        await replaceDrafts(tx, deps.ids, id, validated);
        await tx.conn.query
          .updateTable('intakeBatches')
          .set({ updatedAt: now() })
          .where('id', '=', id)
          .execute();
        return draftsOf(tx.conn, id);
      });
    },
    async confirm(actor, id, input) {
      return deps.tx.run(async (tx) => {
        const { batch } = await ownBatch(tx.conn, actor, id);
        requireStatus(batch, 'draft');
        return confirmBatch(deps, tx, actor, batch, input ?? {});
      });
    },
    async cancel(actor, id) {
      await deps.tx.run(async (tx) => {
        const { batch } = await ownBatch(tx.conn, actor, id);
        requireStatus(batch, 'draft');
        await setBatchStatus(tx, id, 'cancelled');
      });
      return findBatch(deps.tx.read(), id);
    },
    async revert(actor, id) {
      return deps.tx.run(async (tx) => {
        const { batch } = await ownBatch(tx.conn, actor, id);
        requireStatus(batch, 'confirmed');
        return revert(deps, tx, actor, batch);
      });
    },
  };
}
