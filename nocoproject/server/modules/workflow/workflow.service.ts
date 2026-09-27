/**
 * Workflow templates (docs/phase1/iteration-1-contract.md §C). Iteration 1 only reads them: the seed writes the
 * default "软件开发" template and a project without `workflowId` uses it.
 *
 * Compiled views are cached in memory per template id, and the project → template mapping per project id. The
 * project service invalidates a project's entry when its `workflowId` changes; `invalidate()` drops everything
 * (template edits arrive in iteration 3). The cache is per process, like the rest of the in-process state.
 */
import type { Conn, TxRunner } from '../shared/db.js';
import { bool, fromJson, iso, str } from '../shared/db.js';
import { notFound } from '../shared/errors.js';
import type { Workflow, WorkflowDefinition } from '../shared/protocol.js';
import {
  BUILTIN_DEFINITION,
  builtinWorkflow,
  compileWorkflow,
  type WorkflowView,
} from '../issue/status.js';

export interface WorkflowService {
  list(): Promise<Workflow[]>;
  get(id: string): Promise<Workflow>;
  /** The view for a project (its template, or the default one); `null` means "no project". */
  forProject(conn: Conn, projectId: string | null): Promise<WorkflowView>;
  forIssue(
    conn: Conn,
    issue: { readonly projectId: string | null },
  ): Promise<WorkflowView>;
  defaultView(conn: Conn): Promise<WorkflowView>;
  invalidateProject(projectId: string): void;
  invalidate(): void;
}

function isDefinition(value: unknown): value is WorkflowDefinition {
  const candidate = value as Partial<WorkflowDefinition> | null;
  return (
    !!candidate &&
    Array.isArray(candidate.statuses) &&
    Array.isArray(candidate.transitions)
  );
}

export function mapWorkflow(row: Record<string, unknown>): Workflow {
  const definition = fromJson<unknown>(row.definition);
  return {
    id: str(row.id) ?? '',
    name: str(row.name) ?? '',
    isDefault: bool(row.isDefault),
    definition: isDefinition(definition)
      ? {
          ...definition,
          childBatchDoneWakesParentExecutor:
            definition.childBatchDoneWakesParentExecutor !== false,
        }
      : BUILTIN_DEFINITION,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function createWorkflowService(deps: { tx: TxRunner }): WorkflowService {
  const views = new Map<string, WorkflowView>();
  const projectTemplate = new Map<string, string | null>();
  let defaultId: string | null = null;

  async function loadView(conn: Conn, id: string): Promise<WorkflowView> {
    const cached = views.get(id);
    if (cached) return cached;
    const row = await conn.query
      .selectFrom('workflowTemplates')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw notFound('Workflow');
    const view = compileWorkflow(mapWorkflow(row));
    views.set(id, view);
    return view;
  }

  async function defaultView(conn: Conn): Promise<WorkflowView> {
    if (defaultId) return loadView(conn, defaultId);
    const row = await conn.query
      .selectFrom('workflowTemplates')
      .selectAll()
      .where('isDefault', '=', true)
      .orderBy('createdAt', 'asc')
      .executeTakeFirst();
    if (!row) return compileWorkflow(builtinWorkflow());
    const view = compileWorkflow(mapWorkflow(row));
    defaultId = view.workflow.id;
    views.set(defaultId, view);
    return view;
  }

  async function forProject(
    conn: Conn,
    projectId: string | null,
  ): Promise<WorkflowView> {
    if (!projectId) return defaultView(conn);
    let templateId = projectTemplate.get(projectId);
    if (templateId === undefined) {
      const row = await conn.query
        .selectFrom('projects')
        .select('workflowId')
        .where('id', '=', projectId)
        .executeTakeFirst();
      templateId = row ? str(row.workflowId) : null;
      projectTemplate.set(projectId, templateId);
    }
    if (!templateId) return defaultView(conn);
    try {
      return await loadView(conn, templateId);
    } catch {
      // A project pointing at a missing template falls back to the default rather than breaking every request.
      return defaultView(conn);
    }
  }

  return {
    async list() {
      const rows = await deps.tx
        .read()
        .query.selectFrom('workflowTemplates')
        .selectAll()
        .orderBy('isDefault', 'desc')
        .orderBy('name', 'asc')
        .execute();
      return rows.map(mapWorkflow);
    },
    async get(id) {
      return (await loadView(deps.tx.read(), id)).workflow;
    },
    forProject,
    forIssue: (conn, issue) => forProject(conn, issue.projectId),
    defaultView,
    invalidateProject(projectId) {
      projectTemplate.delete(projectId);
    },
    invalidate() {
      views.clear();
      projectTemplate.clear();
      defaultId = null;
    },
  };
}
