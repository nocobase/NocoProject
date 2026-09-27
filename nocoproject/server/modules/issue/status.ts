/**
 * Status catalog and transitions, derived from a workflow template (docs/phase1/iteration-1-contract.md §C).
 *
 * A `WorkflowView` is the compiled form of one template: its catalog (with `agentWritable`), the transitions agents
 * may write, and the category predicates the trigger rules use (`terminal` = done | closed, `dormant` = backlog or
 * terminal). The workflow service (`workflow/workflow.service.ts`) builds and caches one per template and picks the
 * project's template, or the default template for issues without a project.
 */
import type {
  StatusCatalogEntry,
  StatusCategory,
  StatusTransition,
  TransitionActor,
  TransitionApproval,
  Workflow,
  WorkflowDefinition,
  WorkflowTransitionDefinitionV2,
} from '../shared/protocol.js';

/** The status new issues start in. */
export const DEFAULT_STATUS = 'todo';

/**
 * Used when the database holds no default template (the seed normally writes it). Same as the seeds, including the
 * iteration 4 design-first statuses and transitions (`2026100100002_np_iter4_workflow_statuses`).
 */
export const BUILTIN_DEFINITION: WorkflowDefinition = {
  statuses: [
    {
      key: 'backlog',
      name: 'Backlog',
      category: 'unstarted',
      color: 'gray',
      builtIn: true,
    },
    {
      key: 'todo',
      name: 'Todo',
      category: 'unstarted',
      color: 'blue',
      builtIn: true,
    },
    {
      key: 'analysis',
      name: 'Analysis',
      category: 'started',
      color: 'orange',
      builtIn: true,
    },
    {
      key: 'proposal_review',
      name: 'Proposal Review',
      category: 'started',
      color: 'purple',
      builtIn: true,
    },
    {
      key: 'in_progress',
      name: 'In Progress',
      category: 'started',
      color: 'yellow',
      builtIn: true,
    },
    {
      key: 'in_review',
      name: 'In Review',
      category: 'started',
      color: 'purple',
      builtIn: true,
    },
    {
      key: 'blocked',
      name: 'Blocked',
      category: 'started',
      color: 'red',
      builtIn: true,
    },
    {
      key: 'done',
      name: 'Done',
      category: 'done',
      color: 'green',
      builtIn: true,
    },
    {
      key: 'cancelled',
      name: 'Cancelled',
      category: 'closed',
      color: 'gray',
      builtIn: true,
    },
  ],
  transitions: [
    { from: '*', to: '*', actors: ['user'] },
    { from: 'todo', to: 'in_progress', actors: ['agent'] },
    { from: 'blocked', to: 'in_progress', actors: ['agent'] },
    { from: 'in_progress', to: 'in_review', actors: ['agent'] },
    { from: 'in_progress', to: 'blocked', actors: ['agent'] },
    { from: 'in_progress', to: 'todo', actors: ['system'] },
    { from: '*', to: 'done', actors: ['system'] },
    { from: 'todo', to: 'analysis', actors: ['agent', 'user'] },
    { from: 'analysis', to: 'proposal_review', actors: ['agent', 'user'] },
    { from: 'proposal_review', to: 'analysis', actors: ['user', 'system'] },
    { from: 'proposal_review', to: 'in_progress', actors: ['system', 'user'] },
    { from: 'analysis', to: 'blocked', actors: ['agent', 'user'] },
    { from: 'proposal_review', to: 'blocked', actors: ['agent', 'user'] },
    { from: 'blocked', to: 'analysis', actors: ['agent'] },
  ],
  childBatchDoneWakesParentExecutor: true,
};

export interface WorkflowView {
  readonly workflow: Workflow;
  readonly catalog: readonly StatusCatalogEntry[];
  /** Concrete from → to pairs an agent may write (wildcards expanded over the catalog). */
  readonly agentTransitions: readonly StatusTransition[];
  isKnown(key: string): boolean;
  category(key: string): StatusCategory | null;
  /** done | closed */
  isTerminal(key: string): boolean;
  /** backlog or terminal: assigning an agent does not start work. */
  isDormant(key: string): boolean;
  isDone(key: string): boolean;
  canTransition(from: string, to: string, actor: TransitionActor): boolean;
  /**
   * Iteration 2: the approval a transition needs, or null. When several transitions match (e.g. `* → *` and
   * `in_review → done`), their approver roles are combined; any one of them with `approval` makes it required.
   */
  approvalFor(
    from: string,
    to: string,
    actor: TransitionActor,
  ): TransitionApproval | null;
}

function matches(pattern: string, key: string): boolean {
  return pattern === '*' || pattern === key;
}

function expandTransitions(
  definition: WorkflowDefinition,
  keys: readonly string[],
  actor: TransitionActor,
): StatusTransition[] {
  const result: StatusTransition[] = [];
  for (const transition of definition.transitions) {
    if (!transition.actors.includes(actor)) continue;
    for (const from of keys) {
      if (!matches(transition.from, from)) continue;
      for (const to of keys) {
        if (from === to || !matches(transition.to, to)) continue;
        if (!result.some((item) => item.from === from && item.to === to))
          result.push({ from, to });
      }
    }
  }
  return result;
}

export function compileWorkflow(workflow: Workflow): WorkflowView {
  const { definition } = workflow;
  const categories = new Map<string, StatusCategory>(
    definition.statuses.map((status) => [status.key, status.category]),
  );
  const keys = Array.from(categories.keys());
  const agentTransitions = expandTransitions(definition, keys, 'agent');
  const agentWritable = new Set(agentTransitions.map((item) => item.to));
  const catalog = keys.map((key) => ({
    key,
    category: categories.get(key) as StatusCategory,
    agentWritable: agentWritable.has(key),
  }));
  const category = (key: string) => categories.get(key) ?? null;
  const isTerminal = (key: string) => {
    const value = category(key);
    return value === 'done' || value === 'closed';
  };
  return {
    workflow,
    catalog,
    agentTransitions,
    isKnown: (key) => categories.has(key),
    category,
    isTerminal,
    isDormant: (key) => key === 'backlog' || isTerminal(key),
    isDone: (key) => category(key) === 'done',
    canTransition(from, to, actor) {
      if (!categories.has(to)) return false;
      return definition.transitions.some(
        (transition) =>
          transition.actors.includes(actor) &&
          matches(transition.from, from) &&
          matches(transition.to, to),
      );
    },
    approvalFor(from, to, actor) {
      const roles = new Set<TransitionApproval['approvers'][number]>();
      let required = false;
      for (const transition of definition.transitions as readonly WorkflowTransitionDefinitionV2[]) {
        if (
          !transition.approval ||
          !transition.actors.includes(actor) ||
          !matches(transition.from, from) ||
          !matches(transition.to, to)
        )
          continue;
        required = true;
        for (const role of transition.approval.approvers ?? []) roles.add(role);
      }
      return required ? { approvers: Array.from(roles) } : null;
    },
  };
}

/** A template-shaped value for the built-in definition. */
export function builtinWorkflow(): Workflow {
  const epoch = new Date(0).toISOString();
  return {
    id: 'builtin',
    name: '软件开发',
    isDefault: true,
    definition: BUILTIN_DEFINITION,
    createdAt: epoch,
    updatedAt: epoch,
  };
}
