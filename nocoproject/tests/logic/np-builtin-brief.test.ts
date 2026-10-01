// @vitest-environment node
/**
 * NP-219 built-in brief (protocol-runtime-types.md §6.4): the sections of the CLI's runtime brief in the same order
 * and under the same conditions, tools in place of commands, nothing about repositories, terminals, files or the
 * daemon; the project manager brief and the turn prompt. When the CLI brief gains or loses a section, this list and
 * `builtin/builtin.brief*.ts` change with it.
 */
import { describe, expect, it } from 'vitest';

import { buildBuiltinBrief } from '../../server/modules/builtin/builtin.brief.ts';
import type { BriefInput } from '../../server/modules/builtin/builtin.brief-sections.ts';
import type { AgentCapability } from '../../server/modules/shared/protocol.capabilities.ts';

function fixture(
  capabilities: readonly AgentCapability[],
  extra: { conversation?: boolean; fresh?: boolean } = {},
): BriefInput {
  return {
    run: {
      id: 'run-1',
      agentId: 'a1',
      runtimeId: 'rt1',
      attempt: 1,
      priority: 0,
      createdAt: '2026-10-01T00:00:00Z',
    },
    token: 'npr_secret',
    agent: {
      id: 'a1',
      name: 'Helper',
      instructions: 'Answer briefly.',
      capabilities,
      configurationRevision: 3,
      taskInstructions: 'Summarize the issue.',
      commandDescriptions: [],
      provider: 'nocobase-ai',
      model: null,
      delegationTargets: [{ id: 'a2', name: 'Coder' }],
      env: {},
      skills: [
        {
          id: 's1',
          slug: 'triage',
          name: 'Triage',
          description: 'How to triage',
          content: 'Label everything.',
          files: [{ path: 'labels.md', content: '# Labels' }],
        },
      ],
      kind: extra.conversation ? 'manager' : 'coder',
      reasoningEffort: null,
    },
    issue: {
      id: 'i1',
      identifier: extra.conversation ? '' : 'NP-7',
      title: 'Broken login',
      statusKey: 'in_progress',
      ownerName: 'Alice',
      parent: { id: 'i0', identifier: 'NP-6', title: 'Auth' },
      stage: null,
      autoExecuteSubtasks: false,
      projectId: 'p1',
      executionMode: 'task',
      pullRequests: [],
      process: 'direct',
      designApprovedAt: null,
      designProposal: null,
      originType: extra.conversation ? 'pm' : 'manual',
      checklist: {
        statusKey: 'in_progress',
        items: [
          {
            itemKey: 'tests',
            label: 'Tests pass',
            required: true,
            checked: false,
          },
        ],
      },
      attachments: [{ id: 'f1', filename: 'log.txt' }],
      ...(extra.conversation
        ? {
            conversation: {
              id: 'i1',
              agentSource: 'system',
              confirmAll: false,
              budget: { used: 0, limit: 2 },
              asker: {
                userId: 'u-alice',
                name: 'Alice',
                role: 'owner',
                projects: [{ id: 'p1', name: 'Web' }],
                ownedOpen: 3,
                ownedInProgress: 1,
                pendingDecisions: 0,
                locale: 'zh-CN',
              },
            },
          }
        : {}),
    },
    project: {
      id: 'p1',
      name: 'Web',
      description: 'The web app.',
      resources: [
        {
          type: 'gitRepo',
          url: 'https://github.com/x/web',
          defaultRef: 'main',
        },
      ],
    },
    statusCatalog: [],
    agentTransitions: [{ from: 'in_progress', to: 'in_review' }],
    triggers: [
      {
        type: 'comment',
        comment: {
          id: 'c1',
          authorName: 'Alice',
          content: 'Why does login fail?',
          parentId: null,
          rootId: 'c1',
        },
      },
    ],
    session: {
      providerSessionId: null,
      workDir: null,
      fresh: extra.fresh ?? true,
      branchName: null,
      repoUrl: null,
    },
    server: { url: '', protocolVersion: 2 },
    leaseSeconds: 45,
    knowledge: [
      {
        id: 'k1',
        slug: 'manual',
        title: 'Manual',
        summary: 'User manual',
        projectId: null,
        childCount: 4,
      },
      {
        id: 'k2',
        slug: 'pitfalls',
        title: 'Pitfalls',
        summary: 'Known pitfalls',
        projectId: 'p1',
        childCount: 0,
      },
    ],
  } as unknown as BriefInput;
}

const headings = (text: string) =>
  text.split('\n').filter((line) => /^#{1,3} /u.test(line));

const ALL: AgentCapability[] = [
  'context.read',
  'workspace.read',
  'comment.create',
  'knowledge.propose',
  'subtask.create',
  'dependency.write',
  'issue.status.write',
  'design.propose',
  'checklist.write',
  'workflow.propose',
];

describe('built-in brief', () => {
  it('has the CLI brief’s task sections, in order, with tools instead of commands', () => {
    const { systemPrompt } = buildBuiltinBrief(fixture(ALL));
    expect(headings(systemPrompt)).toEqual([
      '# NocoProject Agent Runtime',
      '## Instructions from your owner',
      '## Task instructions',
      '## Runtime rules',
      '## Available tools',
      '## Project Context',
      '## Skills',
      '### Triage (`triage`)',
      '## Knowledge',
      '## Sub-issues',
      '## Parent coordination',
      '## Capture learnings',
      '## Stage checklist',
      '## Changing a workflow template',
      '## Status Rules',
    ]);
    expect(systemPrompt).toContain('a built-in agent');
    expect(systemPrompt).toContain(
      'cannot access code repositories or a terminal',
    );
    expect(systemPrompt).toContain('- `np_comment_add` — ');
    expect(systemPrompt).toContain('- `np_issue_status` — ');
    expect(systemPrompt).toContain('Label everything.');
    expect(systemPrompt).toContain('`labels.md`');
    expect(systemPrompt).toContain('- `in_progress` → `in_review`');
    // Nothing a built-in run cannot do or use.
    for (const absent of [
      'nocoproject ',
      'repo checkout',
      '--content-file',
      'gh pr create',
      'pr link',
      'daemon',
      'Repositories',
      'npr_secret',
    ])
      expect(systemPrompt).not.toContain(absent);
  });

  it('leaves out what the capabilities do not allow', () => {
    const { systemPrompt, turnPrompt } = buildBuiltinBrief(
      fixture(['context.read']),
    );
    expect(headings(systemPrompt)).toEqual([
      '# NocoProject Agent Runtime',
      '## Instructions from your owner',
      '## Task instructions',
      '## Runtime rules',
      '## Available tools',
      '## Project Context',
      '## Skills',
      '### Triage (`triage`)',
      '## Knowledge',
      '## Status Rules',
    ]);
    expect(systemPrompt).not.toContain('np_comment_add');
    expect(systemPrompt).toContain('No status changes are authorized.');
    expect(turnPrompt).toContain(
      'No comment writing is authorized for this run.',
    );
  });

  it('builds the turn prompt like the CLI', () => {
    const { turnPrompt } = buildBuiltinBrief(fixture(ALL, { fresh: false }));
    expect(turnPrompt.split('\n')).toEqual([
      'You are working on issue NP-7 "Broken login".',
      'It is a sub-issue of NP-6 "Auth".',
      'It has 1 attached file (log.txt): read their text with `np_attachment_text`.',
      'Run: run-1. Read the issue with `np_issue_get` and the comments with `np_comment_list`.',
      '[NEW COMMENT] from Alice (reply with parentId c1):',
      '> Why does login fail?',
      'Session: resumed.',
      'When done, deliver your result with `np_comment_add` with parentId c1.',
    ]);
  });

  it('builds the project manager brief for conversation runs', () => {
    const { systemPrompt, turnPrompt } = buildBuiltinBrief(
      fixture(
        [
          'context.read',
          'workspace.read',
          'comment.create',
          'knowledge.propose',
          'member.act',
        ],
        {
          conversation: true,
        },
      ),
    );
    expect(headings(systemPrompt)).toEqual([
      '# NocoProject Agent Runtime',
      '## Runtime rules',
      '## Project manager',
      '## Available tools',
      '## Task instructions',
      '## Knowledge',
      '## Skills',
      '### Triage (`triage`)',
      '## Asker',
      '## Personal preferences',
    ]);
    expect(systemPrompt).toContain('Direct-write budget: 0/2.');
    expect(systemPrompt).toContain('`np_pm_plan_create`');
    expect(systemPrompt).not.toContain('Read-only repositories');
    expect(turnPrompt).toContain(
      'This is a fresh session. First read the conversation history with `np_comment_list`.',
    );
    expect(turnPrompt).toContain('Do not change the conversation status.');
  });
});
