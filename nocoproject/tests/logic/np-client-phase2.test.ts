// @vitest-environment node

/**
 * Pure helpers behind NP-77 stage 3 in the browser: the `workflow_proposal` decision card's default actions and
 * sentence, its inbox link, and the stage-action hover detail on the workflow template page.
 */
import { describe, expect, it } from 'vitest';

import { stageActionDetail } from '../../client/pages/np/config/workflow-model.js';
import { readInboxActions } from '../../client/pages/np/inbox/decision-actions.js';
import { inboxBodyText } from '../../client/pages/np/inbox/inbox-text.js';
import { inboxItemLink } from '../../client/pages/np/inbox/inbox-model.js';
import type { StageAction } from '../../client/pages/np/types-phase2.js';

describe('workflow_proposal decision card', () => {
  it('defaults to accept / reject / open when the server sends no actions', () => {
    const actions = readInboxActions({
      kind: 'decision',
      type: 'workflow_proposal',
      issueId: '12',
      payload: { proposalId: 'p1' },
    } as never);
    expect(actions.map((action) => [action.key, action.path])).toEqual([
      ['accept', '/np/workflows/proposals/p1/accept'],
      ['reject', '/np/workflows/proposals/p1/reject'],
      ['open', undefined],
    ]);
    expect(actions[0].kind).toBe('primary');
    expect(actions[1].kind).toBe('danger');
    // Reject may carry a comment, but does not require one (the server's comment is optional).
    expect(actions[1].needsComment).toBeFalsy();
  });

  it('has no actions without a proposal id and no issue to open', () => {
    expect(
      readInboxActions({
        kind: 'decision',
        type: 'workflow_proposal',
        issueId: null,
        payload: {},
      } as never),
    ).toEqual([]);
  });

  it('localizes the list sentence from the template name', () => {
    expect(
      inboxBodyText(
        {
          type: 'workflow_proposal',
          payload: { templateName: 'Default' },
          actorName: 'Echo',
        } as never,
        (key) => key,
        (reason) => reason,
      ),
    ).toEqual({
      key: 'np.inboxBody.workflow_proposal',
      values: { actor: 'Echo', template: 'Default' },
    });
    expect(
      inboxBodyText(
        { type: 'workflow_proposal', payload: {}, actorName: 'Echo' } as never,
        (key) => key,
        (reason) => reason,
      ),
    ).toBeNull();
  });

  it('localizes the decided sentence by outcome, including stale', () => {
    for (const decision of ['accepted', 'rejected', 'stale'] as const) {
      expect(
        inboxBodyText(
          {
            type: 'workflow_decided',
            payload: { templateName: 'Default', decision },
            actorName: null,
          } as never,
          (key) => key,
          (reason) => reason,
        ),
      ).toEqual({
        key: `np.inboxBody.workflow_${decision}`,
        values: { actor: '', template: 'Default' },
      });
    }
  });

  it('links to the template when known, else the templates list', () => {
    expect(
      inboxItemLink({
        type: 'workflow_proposal',
        issueId: null,
        payload: { templateId: 't1' },
      } as never),
    ).toBe('/config/workflows/t1');
    expect(
      inboxItemLink({
        type: 'workflow_proposal',
        issueId: null,
        payload: {},
      } as never),
    ).toBe('/config/workflows');
    // A proposal with a source issue links there first, like every other decision.
    expect(
      inboxItemLink({
        type: 'workflow_proposal',
        issueId: 'i1',
        payload: { templateId: 't1' },
      } as never),
    ).toBe('/issues/i1');
  });
});

describe('stage action hover detail', () => {
  const agentName = (id: string): string | null =>
    id === 'a1' ? 'Echo' : null;

  it('describes each action type, resolving the agent name when known', () => {
    const cases: readonly [StageAction, string, Record<string, unknown>][] = [
      [{ type: 'notifyOwner' }, 'notifyOwner', {}],
      [
        { type: 'notifyOwner', message: 'hi' },
        'notifyOwnerMessage',
        { message: 'hi' },
      ],
      [{ type: 'runExecutor' }, 'runExecutorCurrent', {}],
      [
        { type: 'runExecutor', agentId: 'a1' },
        'runExecutorAgent',
        { agent: 'Echo' },
      ],
      [
        { type: 'runExecutor', agentId: 'gone' },
        'runExecutorAgent',
        { agent: 'gone' },
      ],
      [
        { type: 'suggestExecutor', agentId: 'a1' },
        'suggestExecutor',
        { agent: 'Echo' },
      ],
      [
        {
          type: 'checklist',
          items: [{ key: 'a', label: 'A', required: true }],
        },
        'checklist',
        { count: 1 },
      ],
      [{ type: 'requirePrMerged' }, 'requirePrMerged', { count: 1 }],
      [
        { type: 'requirePrMerged', minCount: 3 },
        'requirePrMerged',
        { count: 3 },
      ],
      [{ type: 'automation', workflowKey: 'w1' }, 'automation', {}],
    ];
    for (const [action, key, values] of cases) {
      expect(stageActionDetail(action, agentName)).toEqual({ key, values });
    }
  });
});
