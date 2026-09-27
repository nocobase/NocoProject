/**
 * Phase 1 sections of the runtime brief (contract §I): Project Context, Repositories,
 * Sub-issues and Parent coordination. Pure string builders.
 */
import type { ClaimedRunV1 } from '../run-context.js';
import { branchNameFor } from '../repo/naming.js';

export type Phase1BriefInput = Pick<ClaimedRunV1, 'agent' | 'issue' | 'project' | 'session'>;

export function phase1Commands(key: string): string[] {
  return [
    `- \`nocoproject issue create --title "..." [--description-file ./sub.md] [--stage N] [--blocked-by NP-1,NP-2] [--executor self|none|<agentId>] [--priority p] [--label a,b] --json\` — create a sub-issue of ${key}`,
    `- \`nocoproject issue children ${key} --json\` — list its sub-issues (stage, status, how many blockers each waits on)`,
    '- `nocoproject issue dependency add|remove <issue> --blocked-by <other> --json` — manage blocked-by dependencies',
    '- `nocoproject project get --json` — the project and its repositories',
    '- `nocoproject repo checkout <url> [--ref <ref>] [--fresh] --json` — check out a project repository (see Repositories)',
  ];
}

export function projectSection(input: Phase1BriefInput): string[] {
  const lines = ['## Project Context', ''];
  const project = input.project;
  if (project) {
    lines.push(`This issue belongs to the project **${project.name}** (id \`${project.id}\`).`, '');
    lines.push(project.description?.trim() || '(no project description)');
  } else {
    lines.push('This issue is not in a project.');
  }
  const parent = input.issue.parent;
  if (parent) {
    const stage = input.issue.stage === null || input.issue.stage === undefined ? '' : ` (stage ${input.issue.stage})`;
    lines.push('', `${input.issue.identifier} is a sub-issue${stage} of ${parent.identifier} "${parent.title}". Read the parent for the overall plan: \`nocoproject issue get ${parent.identifier} --json\`.`);
  }
  return lines;
}

export function repositoriesSection(input: Phase1BriefInput): string[] {
  const key = input.issue.identifier;
  const resources = input.project?.resources ?? [];
  const lines = ['## Repositories', ''];
  if (resources.length === 0) {
    lines.push('No repositories are attached to this issue’s project, so `repo checkout` is not available.');
    return lines;
  }
  lines.push('Project repositories (only these can be checked out):', '');
  for (const r of resources) lines.push(`- \`${r.url}\`${r.defaultRef ? ` (default ref \`${r.defaultRef}\`)` : ''}`);
  const branch = input.session.branchName ?? branchNameFor(input.agent.name, key);
  lines.push(
    '',
    `Check one out with \`nocoproject repo checkout <url> --json\`. It creates a git worktree at \`$NOCOPROJECT_WORKDIR/<repo name>/\` on the branch \`${branch}\` and prints its path; later runs of ${key} resume the same branch. \`--ref <ref>\` picks another base, \`--fresh\` discards this checkout and restarts the branch from the base.`,
    '',
    '- Work and commit only inside that worktree, on that branch. Do not switch branches there and do not touch the shared clone cache under `~/.nocoproject/repos`.',
    '- When the work is ready for review, push with `git push -u origin HEAD`.',
    `- Open a pull request with \`gh pr create\`; the title must contain ${key} (for example \`${key}: <summary>\`). Link the PR in your delivery comment.`,
  );
  const previous = input.session.branchName;
  if (previous) {
    lines.push(`- The previous run of ${key} worked on branch \`${previous}\`${input.session.repoUrl ? ` of \`${input.session.repoUrl}\`` : ''}; \`repo checkout\` resumes it.`);
  }
  return lines;
}

function delegationLine(input: Phase1BriefInput): string {
  const targets = input.agent.delegationTargets ?? [];
  if (targets.length === 0) return 'You have no delegation list, so naming any other agent always creates a proposal.';
  const list = targets.map((t) => `${t.name} (\`${t.id}\`)`).join(', ');
  return `Your delegation list (these start without approval): ${list}.`;
}

export function subIssuesSection(input: Phase1BriefInput): string[] {
  const key = input.issue.identifier;
  const auto = input.issue.autoExecuteSubtasks === true;
  return [
    '## Sub-issues',
    '',
    'Split work into sub-issues only when it is genuinely separable: independent parts, parts for other agents, or ordered phases. Do small tasks yourself.',
    '',
    `- \`nocoproject issue create --title "..." --description-file ./sub.md --json\` creates a sub-issue of ${key}. Its owner is ${key}'s owner.`,
    '- `--stage N` puts sub-issues into ordered batches: a sub-issue does not start until every sibling with a lower stage is done.',
    '- `--blocked-by NP-1,NP-2` makes it wait for specific issues; it starts on its own once they are done.',
    `- \`--executor self\` asks for you to execute it. Auto-execute sub-issues is **${auto ? 'on' : 'off'}** for ${key}: ${
      auto
        ? 'you become the executor and it runs automatically once it is unblocked.'
        : 'it becomes a proposal that the owner must accept before it runs.'
    }`,
    `- \`--executor <agentId>\` proposes another agent; the owner must accept it unless that agent is in your delegation list. ${delegationLine(input)}`,
    '- `--executor none` (the default) leaves it unassigned for a human.',
    '- Never @-mention other agents to hand off work; create sub-issues instead.',
    `- After creating sub-issues, post a comment on ${key} that lists them and explains the plan, and keep ${key} \`in_progress\` while they run: you are woken when a batch finishes.`,
  ];
}

export function parentCoordinationSection(key: string): string[] {
  return [
    '## Parent coordination',
    '',
    `When you are woken because a batch of ${key}'s sub-issues finished:`,
    '',
    `1. Run \`nocoproject issue children ${key} --json\` and read the finished sub-issues (\`issue get\`, \`issue comment list\`) for their results.`,
    '2. Adjust the plan if needed: create follow-up sub-issues, add or remove dependencies.',
    '3. Later stages start on their own once unblocked; do not re-create them. Post a short progress comment.',
    `4. When every sub-issue is done, check the combined result, post a summary comment on ${key} and set it to \`in_review\`.`,
  ];
}
