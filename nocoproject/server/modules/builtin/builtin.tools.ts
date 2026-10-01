/**
 * The `np_*` tools of built-in runs (NP-219, protocol-runtime-types.md §7): each one is a request to the agent API
 * (`/api/np/agent/*`) that the CLI command of the same capability makes, with the arguments as fields instead of flags
 * and files. `np_skill_file` is the only local one: it reads an attached skill's file from the claim payload.
 *
 * `issue` defaults to the run's own issue, which is the only one most writes may touch (`ISSUE_NOT_IN_RUN`).
 */
import { z } from 'zod';

import { AGENT_TOOLS, type AgentCapability } from '../shared/protocol.js';

export interface AgentApiRequest {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Relative to `/np/agent`. */
  readonly path: string;
  readonly query?: Readonly<
    Record<string, string | number | boolean | undefined>
  >;
  readonly body?: unknown;
}

export interface ToolContext {
  /** The run's issue: its identifier, or its id for a project manager conversation. */
  readonly issue: string;
}

export interface BuiltinToolSpec {
  readonly name: string;
  readonly capability: AgentCapability;
  /** One line for the model and the brief. */
  readonly description: string;
  readonly schema: z.ZodObject;
  /** The agent API request, or `local` for a tool answered from the claim payload. */
  readonly request: (
    args: Record<string, unknown>,
    context: ToolContext,
  ) => AgentApiRequest | 'local';
}

const enc = encodeURIComponent;
const issueArg = z
  .string()
  .optional()
  .describe('Issue id or identifier (defaults to the issue of this run)');
const text = (description: string) => z.string().describe(description);
const optionalText = (description: string) =>
  z.string().optional().describe(description);

/** A string argument (validated by the tool's schema; anything else reads as empty). */
function arg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value : '';
}

function issueOf(args: Record<string, unknown>, context: ToolContext): string {
  return enc(
    typeof args.issue === 'string' && args.issue ? args.issue : context.issue,
  );
}

function get(path: string, query?: AgentApiRequest['query']): AgentApiRequest {
  return { method: 'GET', path, query };
}

function post(path: string, body: unknown): AgentApiRequest {
  return { method: 'POST', path, body };
}

/** `params` minus `issue` (the path names it). */
function rest(args: Record<string, unknown>, ...keys: string[]) {
  return Object.fromEntries(
    Object.entries(args).filter(([key]) => !['issue', ...keys].includes(key)),
  );
}

const contextTools: BuiltinToolSpec[] = [
  {
    name: 'np_context',
    capability: 'context.read',
    description:
      'Read the run context: the issue, its project and status catalog.',
    schema: z.object({}),
    request: () => get('/context'),
  },
  {
    name: 'np_issue_get',
    capability: 'context.read',
    description:
      'Read an issue with its status, owner, executor and description.',
    schema: z.object({ issue: issueArg }),
    request: (args, context) => get(`/issues/${issueOf(args, context)}`),
  },
  {
    name: 'np_comment_list',
    capability: 'context.read',
    description:
      'List the comments of an issue (oldest first), optionally one thread or the latest few.',
    schema: z.object({
      issue: issueArg,
      thread: optionalText('Root comment id: only that thread'),
      tail: z.number().int().optional().describe('Only the last N comments'),
      rootsOnly: z.boolean().optional().describe('Only top-level comments'),
    }),
    request: (args, context) =>
      get(`/issues/${issueOf(args, context)}/comments`, {
        thread: args.thread as string | undefined,
        tail: args.tail as number | undefined,
        rootsOnly: args.rootsOnly === true ? 'true' : undefined,
      }),
  },
  {
    name: 'np_issue_children',
    capability: 'context.read',
    description:
      'List the sub-issues of an issue with their stage, status and blockers.',
    schema: z.object({ issue: issueArg }),
    request: (args, context) =>
      get(`/issues/${issueOf(args, context)}/children`),
  },
  {
    name: 'np_attachment_text',
    capability: 'context.read',
    description: 'Read the extracted text of a file attached to an issue.',
    schema: z.object({ issue: issueArg, fileId: text('Attachment id') }),
    request: (args, context) =>
      get(
        `/issues/${issueOf(args, context)}/attachments/${enc(arg(args, 'fileId'))}/text`,
      ),
  },
  {
    name: 'np_kb_list',
    capability: 'context.read',
    description: 'List the knowledge documents this run can read.',
    schema: z.object({ q: optionalText('Search text') }),
    request: (args) => get('/knowledge', { q: args.q as string | undefined }),
  },
  {
    name: 'np_kb_get',
    capability: 'context.read',
    description: 'Read a knowledge document’s Markdown by slug or id.',
    schema: z.object({ slug: text('Document slug or id') }),
    request: (args) => get(`/knowledge/${enc(arg(args, 'slug'))}`),
  },
  {
    name: 'np_workflow_list',
    capability: 'context.read',
    description:
      'List the workflow templates (the run project’s is marked usedByRunProject).',
    schema: z.object({}),
    request: () => get('/workflows'),
  },
  {
    name: 'np_workflow_get',
    capability: 'context.read',
    description:
      'Read a workflow template with its whole definition and revision.',
    schema: z.object({ template: text('Template id') }),
    request: (args) => get(`/workflows/${enc(arg(args, 'template'))}`),
  },
  {
    name: 'np_skill_file',
    capability: 'context.read',
    description:
      'Read a file attached to one of your skills (listed under Skills).',
    schema: z.object({
      skill: text('Skill slug'),
      path: text('File path inside the skill'),
    }),
    request: () => 'local',
  },
];

const workspaceTools: BuiltinToolSpec[] = [
  ['np_pm_projects', 'List the projects the asker can see.', '/pm/projects'],
  [
    'np_pm_agents',
    'List the agents (the executor roster) the asker can see.',
    '/pm/agents',
  ],
].map(([name, description, path]) => ({
  name: name,
  capability: 'workspace.read' as const,
  description: description,
  schema: z.object({}),
  request: () => get(path),
}));

workspaceTools.push(
  {
    name: 'np_pm_issues',
    capability: 'workspace.read',
    description: 'Search the issues the asker can see.',
    schema: z.object({
      projectId: optionalText('Project id'),
      statusKey: optionalText('Status key'),
      ownerUserId: optionalText('Owner user id'),
      executorId: optionalText('Executor id'),
      q: optionalText('Search text'),
      updatedSince: optionalText('ISO date'),
      limit: z.number().int().optional(),
      cursor: optionalText('Next page cursor'),
    }),
    request: (args) => get('/pm/issues', args as AgentApiRequest['query']),
  },
  {
    name: 'np_pm_issue',
    capability: 'workspace.read',
    description:
      'Read any issue the asker can see, with comments, activities, runs and pull requests.',
    schema: z.object({ issue: text('Issue id or identifier') }),
    request: (args) => get(`/pm/issues/${enc(arg(args, 'issue'))}`),
  },
  {
    name: 'np_pm_inbox',
    capability: 'workspace.read',
    description: 'List the asker’s pending inbox items.',
    schema: z.object({ kind: optionalText('decision or notification') }),
    request: (args) =>
      get('/pm/inbox', { kind: args.kind as string | undefined }),
  },
  {
    name: 'np_pm_metrics',
    capability: 'workspace.read',
    description: 'Read the acceptance metrics report.',
    schema: z.object({
      from: optionalText('YYYY-MM-DD'),
      to: optionalText('YYYY-MM-DD'),
      projectId: optionalText('Project id'),
    }),
    request: (args) => get('/pm/metrics', args as AgentApiRequest['query']),
  },
  {
    name: 'np_pm_knowledge',
    capability: 'workspace.read',
    description: 'List knowledge documents across the asker’s projects.',
    schema: z.object({
      projectId: optionalText('Project id'),
      q: optionalText('Search text'),
    }),
    request: (args) => get('/pm/knowledge', args as AgentApiRequest['query']),
  },
  {
    name: 'np_pm_runs',
    capability: 'workspace.read',
    description: 'List the runs of an issue.',
    schema: z.object({
      issueId: text('Issue id'),
      runtimeType: optionalText('computer or builtin'),
    }),
    request: (args) => get('/pm/runs', args as AgentApiRequest['query']),
  },
  {
    name: 'np_pm_run_events',
    capability: 'workspace.read',
    description: 'Read the latest events of a run.',
    schema: z.object({
      runId: text('Run id'),
      limit: z.number().int().optional(),
    }),
    request: (args) =>
      get(`/pm/runs/${enc(arg(args, 'runId'))}/events`, {
        limit: args.limit as number | undefined,
      }),
  },
  {
    name: 'np_pm_prs',
    capability: 'workspace.read',
    description: 'List the pull requests of an issue with CI and mergeability.',
    schema: z.object({ issueId: text('Issue id') }),
    request: (args) =>
      get('/pm/pull-requests', { issueId: arg(args, 'issueId') }),
  },
);

const writeTools: BuiltinToolSpec[] = [
  {
    name: 'np_comment_add',
    capability: 'comment.create',
    description:
      'Post a Markdown comment; pass parentId (a root comment id) to reply in a thread.',
    schema: z.object({
      issue: issueArg,
      content: text('Markdown content'),
      parentId: optionalText('Root comment id of the thread to reply in'),
    }),
    request: (args, context) =>
      post(`/issues/${issueOf(args, context)}/comments`, rest(args)),
  },
  {
    name: 'np_kb_propose',
    capability: 'knowledge.propose',
    description:
      'Propose a knowledge change: docId to update a document (whole new content), or title to add one.',
    schema: z.object({
      docId: optionalText('Slug or id of the document to update'),
      title: optionalText('Title of a new document'),
      slug: optionalText('Slug of a new document'),
      parentId: optionalText('Parent document (slug or id) of a new document'),
      summary: optionalText('One-line summary'),
      content: text('The whole Markdown content'),
      reason: text(
        'What you found and why it matters (at most 500 characters)',
      ),
    }),
    request: (args) => post('/knowledge/proposals', args),
  },
  {
    name: 'np_issue_create',
    capability: 'subtask.create',
    description: 'Create a sub-issue of this issue.',
    schema: z.object({
      title: text('Title'),
      description: optionalText('Markdown description'),
      parentIssueId: optionalText('Parent issue (defaults to this issue)'),
      stage: z.number().int().optional().describe('Ordered batch number'),
      blockedBy: z.array(z.string()).optional().describe('Issues it waits for'),
      priority: optionalText('urgent, high, medium, low or none'),
      labels: z.array(z.string()).optional(),
      executor: optionalText('self, none (default) or a computer agent id'),
    }),
    request: (args) => post('/issues', args),
  },
  {
    name: 'np_dependency_add',
    capability: 'dependency.write',
    description: 'Make an issue wait for (be blocked by) another issue.',
    schema: z.object({
      issue: issueArg,
      blockedBy: text('The issue it waits for'),
    }),
    request: (args, context) =>
      post(`/issues/${issueOf(args, context)}/dependencies`, {
        dependsOnIssueId: args.blockedBy,
        type: 'blockedBy',
      }),
  },
  {
    name: 'np_dependency_remove',
    capability: 'dependency.write',
    description: 'Remove a blocked-by dependency.',
    schema: z.object({
      issue: issueArg,
      blockedBy: text('The issue it waited for'),
    }),
    request: (args, context) => ({
      method: 'DELETE',
      path: `/issues/${issueOf(args, context)}/dependencies`,
      query: {
        dependsOnIssueId: arg(args, 'blockedBy'),
        type: 'blockedBy',
      },
    }),
  },
  {
    name: 'np_issue_status',
    capability: 'issue.status.write',
    description:
      'Change the issue status (only the transitions under Status rules).',
    schema: z.object({ issue: issueArg, statusKey: text('Target status key') }),
    request: (args, context) =>
      post(`/issues/${issueOf(args, context)}/status`, {
        statusKey: args.statusKey,
      }),
  },
  {
    name: 'np_design_proposal',
    capability: 'design.propose',
    description:
      'Submit (or resubmit) the whole design proposal of a design-first issue.',
    schema: z.object({
      issue: issueArg,
      content: text('The whole proposal in Markdown'),
    }),
    request: (args, context) =>
      post(`/issues/${issueOf(args, context)}/design-proposal`, {
        content: args.content,
      }),
  },
  {
    name: 'np_checklist',
    capability: 'checklist.write',
    description: 'Check or uncheck an item of a workflow stage checklist.',
    schema: z.object({
      issue: issueArg,
      status: text('Status key of the checklist'),
      item: text('Item key'),
      checked: z.boolean(),
    }),
    request: (args, context) => ({
      method: 'PATCH',
      path: `/issues/${issueOf(args, context)}/checklists/${enc(arg(args, 'status'))}/items/${enc(arg(args, 'item'))}`,
      body: { checked: args.checked === true },
    }),
  },
  {
    name: 'np_workflow_propose',
    capability: 'workflow.propose',
    description:
      'Propose a whole workflow template definition for an owner or admin to accept.',
    schema: z.object({
      templateId: optionalText('Template to change'),
      copyFrom: optionalText('System template to copy instead'),
      name: optionalText('Name of the copy'),
      definition: z
        .record(z.string(), z.unknown())
        .describe('The whole definition'),
      reason: text('Why'),
    }),
    request: (args) => post('/workflows/proposals', args),
  },
];

const memberTools: BuiltinToolSpec[] = [
  {
    name: 'np_pm_act',
    capability: 'member.act',
    description:
      'Perform one operation in the asker’s name; the server may answer PLAN_REQUIRED.',
    schema: z.object({
      type: text('Operation type, e.g. issue.create'),
      params: z
        .record(z.string(), z.unknown())
        .describe('Operation parameters'),
      ref: optionalText('Local reference'),
    }),
    request: (args) => post('/pm/act', { op: args }),
  },
  {
    name: 'np_pm_plan_create',
    capability: 'member.act',
    description:
      'Submit an operation plan (title, summary, 1–50 ops) for the asker to review and execute.',
    schema: z.object({
      title: text('Plan title'),
      summary: optionalText('Summary'),
      ops: z
        .array(z.record(z.string(), z.unknown()))
        .describe('Operations: type, params, ref'),
    }),
    request: (args) => post('/pm/plans', args),
  },
  {
    name: 'np_pm_plan_get',
    capability: 'member.act',
    description: 'Read a plan of this conversation.',
    schema: z.object({ planId: text('Plan id') }),
    request: (args) => get(`/pm/plans/${enc(arg(args, 'planId'))}`),
  },
  {
    name: 'np_pm_plan_discard',
    capability: 'member.act',
    description: 'Discard a pending or failed plan.',
    schema: z.object({ planId: text('Plan id') }),
    request: (args) =>
      post(`/pm/plans/${enc(arg(args, 'planId'))}/discard`, {}),
  },
  {
    name: 'np_pm_title',
    capability: 'member.act',
    description:
      'Set the conversation title (at most 40 characters) unless the human edited it.',
    schema: z.object({ title: text('Title') }),
    request: (args) => post('/pm/conversation/title', { title: args.title }),
  },
];

export const BUILTIN_TOOLS: readonly BuiltinToolSpec[] = [
  ...contextTools,
  ...workspaceTools,
  ...writeTools,
  ...memberTools,
];

const BY_NAME = new Map(BUILTIN_TOOLS.map((tool) => [tool.name, tool]));

export function toolSpec(name: string): BuiltinToolSpec | undefined {
  return BY_NAME.get(name);
}

/** The tools a run's capability set allows, in `AGENT_TOOLS` order. */
export function toolsFor(
  capabilities: readonly AgentCapability[],
): BuiltinToolSpec[] {
  return capabilities.flatMap((capability) =>
    (AGENT_TOOLS[capability] ?? []).flatMap((name) => BY_NAME.get(name) ?? []),
  );
}
