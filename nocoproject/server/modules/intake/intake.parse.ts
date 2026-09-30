/**
 * Running the intake parsers (moved out of `intake.service.ts` for NP-78): the AI parser when it is available and
 * allowed, else — or when it fails or finds nothing — the heuristic, and the parser input (project, workflow and
 * labels) the AI parser is given.
 */
import type { Conn } from '../shared/db.js';
import type { AiFeatureKey, AiModelRef } from '../shared/protocol.js';
import { str } from '../shared/db.js';
import type { WorkflowService } from '../workflow/workflow.service.js';
import { readAiFeature } from './ai-features.js';
import type { IntakeDeps } from './intake.service.js';
import type { IntakeParseInput, IntakeParseOutcome } from './parser.js';

function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, 500) || 'The AI parser failed.';
}

/** NP-205: a batch split from an issue is the AI breakdown; every other batch is the new issue AI draft tab. */
export function featureOf(sourceIssueId: string | null): AiFeatureKey {
  return sourceIssueId ? 'breakdownAi' : 'intakeAi';
}

/**
 * The AI parser is registered and the feature's settings allow a model call: it is on, its parser is `auto` and an LLM
 * service is configured (NP-120: refine too). `model` is the model to call.
 */
export async function aiState(
  deps: IntakeDeps,
  conn: Conn,
  key: AiFeatureKey,
): Promise<{ enabled: boolean; model: AiModelRef | null }> {
  const state = await readAiFeature(
    deps.settings,
    deps.aiModels,
    deps.aiConfigured,
    conn,
    key,
  );
  return { enabled: deps.ai !== null && state.useModel, model: state.model };
}

export async function aiEnabled(
  deps: IntakeDeps,
  conn: Conn,
  key: AiFeatureKey,
): Promise<boolean> {
  return (await aiState(deps, conn, key)).enabled;
}

/** Runs the AI parser when it is available and allowed, falling back to the heuristic (never failing). */
export async function parseIntake(
  deps: IntakeDeps,
  conn: Conn,
  input: IntakeParseInput,
  userId: string,
  key: AiFeatureKey,
): Promise<IntakeParseOutcome> {
  let parseError: string | null = null;
  let aiSessionId: string | null = null;
  const state = await aiState(deps, conn, key);
  if (deps.ai && state.enabled) {
    try {
      const result = await deps.ai.parseAs(
        { ...input, model: state.model },
        userId,
      );
      aiSessionId = result.sessionId || null;
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

export async function parseInput(
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
