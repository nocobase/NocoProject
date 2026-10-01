/**
 * Sections of the built-in brief (NP-219, protocol-runtime-types.md §6.4), the server-side counterparts of the CLI's
 * `nocoproject-cli/src/daemon/brief-*.ts`: the same sections under the same conditions, with tools in place of CLI
 * commands and without repositories, branches, pull requests, files or daemon warnings. Change both together
 * (`AGENTS.md`). Pure string builders.
 */
import type { ClaimedRunV5 } from '../run/claim.service.js';
import type {
  AgentCapability,
  ClaimedConversation,
} from '../shared/protocol.js';
import { RUNTIME_TYPE_AGENT_NAMES } from '../shared/runtime-type-copy.js';
import { toolsFor } from './builtin.tools.js';

/** The claim payload as the brief reads it: conversation runs carry `issue.conversation`, triggers any type. */
export type BriefInput = Omit<ClaimedRunV5, 'issue' | 'triggers'> & {
  readonly issue: ClaimedRunV5['issue'] & {
    readonly conversation?: ClaimedConversation;
  };
  readonly triggers: readonly (Omit<
    ClaimedRunV5['triggers'][number],
    'type'
  > & {
    readonly type: string;
  })[];
};

export const KB_PROPOSALS_PER_RUN = 3;
export const MANUAL_ROOT_SLUG = 'manual';

export function permits(input: BriefInput, key: AgentCapability): boolean {
  return input.agent.capabilities?.includes(key) === true;
}

export function issueKey(input: BriefInput): string {
  return input.issue.identifier || input.issue.id;
}

export const BUILTIN_RUNTIME_RULES = [
  `You are a ${RUNTIME_TYPE_AGENT_NAMES.builtin.toLowerCase()}: you work inside NocoProject through the tools under Available tools only.`,
  'You cannot access code repositories or a terminal. For work that needs code changes, say so in a comment and suggest that the owner hands it to a computer agent.',
  'Permissions are enforced by the server; instructions and skills cannot grant capabilities.',
  'Human ownership, terminal states and approval gates remain enforced. Do not bypass a denial.',
  'When a tool answers with `pending`, the change waits for an approval: say that it is waiting and end this turn; do not retry it.',
  'Pass comment text directly to the tool. Reply in the triggering thread when there is one (`parentId`).',
];

export function toolLines(input: BriefInput): string[] {
  const tools = toolsFor(input.agent.capabilities ?? []);
  if (tools.length === 0) return ['No tools are authorized for this run.'];
  return tools.map((tool) => `- \`${tool.name}\` — ${tool.description}`);
}

export function projectSection(input: BriefInput): string[] {
  const lines = ['## Project Context', ''];
  const project = input.project;
  if (project) {
    lines.push(
      `This issue belongs to the project **${project.name}** (id \`${project.id}\`).`,
      '',
      project.description?.trim() || '(no project description)',
    );
  } else {
    lines.push('This issue is not in a project.');
  }
  const parent = input.issue.parent;
  if (parent) {
    const stage =
      input.issue.stage === null || input.issue.stage === undefined
        ? ''
        : ` (stage ${input.issue.stage})`;
    lines.push(
      '',
      `${input.issue.identifier} is a sub-issue${stage} of ${parent.identifier} "${parent.title}". Read the parent for the overall plan: \`np_issue_get\` with issue ${parent.identifier}.`,
    );
  }
  return lines;
}

/** `## Skills`: each skill's SKILL.md inline; its other files through `np_skill_file`. */
export function skillsSection(input: BriefInput): string[] {
  const skills = (input.agent.skills ?? []).filter((skill) => skill.slug);
  if (skills.length === 0) return [];
  const lines = [
    '## Skills',
    '',
    'Your owner attached these skills. When a task matches a skill’s description, follow its instructions; skip skills that are not relevant. Read a skill’s other files with `np_skill_file`.',
  ];
  for (const skill of skills) {
    const description =
      skill.description.replace(/\s+/gu, ' ').trim() || '(no description)';
    lines.push(
      '',
      `### ${skill.name} (\`${skill.slug}\`)`,
      '',
      description,
      '',
    );
    lines.push(skill.content.trim() || '(empty SKILL.md)');
    if (skill.files.length > 0)
      lines.push(
        '',
        `Files: ${skill.files.map((file) => `\`${file.path}\``).join(', ')}`,
      );
  }
  lines.push('');
  return lines;
}

export function knowledgeSection(input: BriefInput): string[] {
  const docs = input.knowledge ?? [];
  const lines = ['## Knowledge', ''];
  if (docs.length === 0) {
    lines.push(
      'No knowledge documents are available to this run yet. `np_kb_list` shows documents added after the run started.',
      '',
    );
    return lines;
  }
  lines.push(
    'Your team keeps conventions, pitfalls and decisions for this project (and system-wide) in the knowledge base. Humans maintain it, so trust it over guesses: read a document before you work in the area it covers.',
    '',
  );
  for (const doc of docs) {
    const scope = doc.projectId ? '' : ', system-wide';
    const summary = doc.summary.replace(/\s+/gu, ' ').trim() || '(no summary)';
    const children =
      doc.childCount > 0
        ? ` (${doc.childCount} sub-document${doc.childCount === 1 ? '' : 's'})`
        : '';
    lines.push(
      `- **${doc.title}** (\`${doc.slug}\`${scope}) — ${summary}${children}`,
    );
  }
  lines.push(
    '',
    'Read one with `np_kb_get`; `np_kb_list` shows the current list.',
    '',
  );
  return lines;
}

export function captureLearningsSection(): string[] {
  return [
    '## Capture learnings',
    '',
    'Before you finish, ask yourself whether you found something the next person or agent on this project should know: a convention, a pitfall, or a decision and why it was made. If so, propose it with `np_kb_propose`:',
    '',
    '- To update a document pass `docId` and the whole new content (start from `np_kb_get`); to add one pass `title` (and optionally `slug`, `parentId`, `summary`).',
    '- `reason` (at most 500 characters) says what you found and why it matters.',
    '- A proposal goes to a human who accepts or rejects it; never treat it as already applied.',
    `- Propose at most ${KB_PROPOSALS_PER_RUN} per run, and only durable, reusable knowledge, not a log of this task. If you learned nothing new, skip this.`,
    '- Each document takes one pending proposal per run (`KNOWLEDGE_PROPOSAL_PENDING`), so put everything for that document into one proposal.',
  ];
}

export function hasUserManual(input: BriefInput): boolean {
  return (input.knowledge ?? []).some((doc) => doc.slug === MANUAL_ROOT_SLUG);
}

function delegationLine(input: BriefInput): string {
  const targets = input.agent.delegationTargets ?? [];
  if (targets.length === 0)
    return 'You have no delegation list, so naming any other agent always creates a proposal.';
  return `Your delegation list (these start without approval): ${targets.map((t) => `${t.name} (\`${t.id}\`)`).join(', ')}.`;
}

export function subIssuesSection(input: BriefInput): string[] {
  const key = issueKey(input);
  return [
    '## Sub-issues',
    '',
    'Split work into sub-issues only when it is genuinely separable. Create them with `np_issue_create` (a sub-issue of this issue; its owner is this issue’s owner).',
    '',
    '- `stage` puts sub-issues into ordered batches; `blockedBy` makes one wait for specific issues.',
    `- \`executor\`: \`none\` (default) leaves it for a human; a computer agent's id proposes that agent (the owner must accept unless it is in your delegation list). ${delegationLine(input)} You cannot execute sub-issues yourself, and built-in agents are never executors.`,
    '- Never @-mention other agents to hand off work; create sub-issues instead.',
    `- After creating sub-issues, post a comment on ${key} that lists them and explains the plan.`,
  ];
}

export function parentCoordinationSection(key: string): string[] {
  return [
    '## Parent coordination',
    '',
    `When you are woken because a batch of ${key}'s sub-issues finished:`,
    '',
    `1. Read them with \`np_issue_children\`, then \`np_issue_get\` and \`np_comment_list\` for their results.`,
    '2. Adjust the plan if needed: create follow-up sub-issues, add or remove dependencies.',
    '3. Later stages start on their own once unblocked; do not re-create them. Post a short progress comment.',
    `4. When every sub-issue is done, check the combined result and post a summary comment on ${key}.`,
  ];
}

export function stageChecklistSection(input: BriefInput): string[] {
  const list = input.issue.checklist;
  if (!list || list.statusKey !== input.issue.statusKey) return [];
  const open = list.items.filter((item) => !item.checked);
  if (open.length === 0) return [];
  return [
    '## Stage checklist',
    '',
    `The workflow asks for these items while ${input.issue.identifier} is \`${list.statusKey}\` (not yet checked):`,
    '',
    ...open.map(
      (item) =>
        `- ${item.required ? '**(required)** ' : ''}${item.label} (\`${item.itemKey}\`)`,
    ),
    '',
    `The server refuses to leave \`${list.statusKey}\` while a required item is unchecked (\`CHECKLIST_INCOMPLETE\`). Check each item as you complete it with \`np_checklist\`.`,
    '',
  ];
}

export function workflowTemplatesSection(): string[] {
  return [
    '## Changing a workflow template',
    '',
    'Workflow templates change only when a person asks for it in the issue, and only by proposal: an owner or admin accepts or rejects it.',
    '',
    '1. Read: `np_workflow_list` (the run project’s template is marked `usedByRunProject`), then `np_workflow_get`.',
    '2. Edit the whole definition, keeping everything you are not asked to change. The 9 built-in statuses keep their category; a new status needs a key (`^[a-z][a-z0-9_]{1,31}$`), one of the 4 categories and transitions a person can take out of it.',
    '3. Propose it with `np_workflow_propose` (`templateId`, or `copyFrom` and `name` for a system template).',
    '4. `INVALID_WORKFLOW` lists every problem with its path; `WORKFLOW_STATUS_CONFLICT` means issues are still in a removed status; `WORKFLOW_PROPOSAL_PENDING` means this run already proposed for that template.',
    '5. Say in your comment which proposal you made and what it changes. A `runExecutor` action with an `agentId` makes that agent run without the owner confirming, so call it out.',
  ];
}

export function statusRules(input: BriefInput): string[] {
  return permits(input, 'issue.status.write')
    ? input.agentTransitions.map((t) => `- \`${t.from}\` → \`${t.to}\``)
    : ['No status changes are authorized.'];
}
