// @vitest-environment node
/**
 * NP-219 (protocol-runtime-types.md §6.7, §7): the built-in tool table agrees with `AGENT_TOOLS` and with the agent
 * API's capability routes (each tool's request needs exactly its own capability), capabilities a built-in agent cannot
 * hold have no tools, and the plugin's error codes map onto the documented failure reasons.
 */
import { describe, expect, it } from 'vitest';

import { classifyBuiltinError } from '../../server/modules/builtin/builtin.failure.ts';
import {
  BUILTIN_TOOLS,
  toolsFor,
} from '../../server/modules/builtin/builtin.tools.ts';
import { routeCapability } from '../../server/modules/run/agent-capability-routes.ts';
import {
  AGENT_CAPABILITIES,
  AGENT_TOOLS,
  BUILTIN_UNSUPPORTED_CAPABILITIES,
} from '../../server/modules/shared/protocol.ts';

const SAMPLE = {
  issue: 'NP-7',
  issueId: 'i1',
  runId: 'r1',
  planId: 'p1',
  fileId: 'f1',
  slug: 'pitfalls',
  template: 'default',
  status: 'in_review',
  item: 'tests',
  checked: true,
  statusKey: 'in_review',
  content: 'x',
  reason: 'y',
  title: 't',
  type: 'issue.create',
  params: {},
  ops: [],
  definition: {},
  blockedBy: 'NP-8',
  skill: 's',
  path: 'p',
};

describe('built-in tools', () => {
  it('lists every tool of AGENT_TOOLS once, under its own capability', () => {
    const named = Object.entries(AGENT_TOOLS).flatMap(([capability, names]) =>
      names.map((name) => [name, capability]),
    );
    expect(named.map(([name]) => name).sort()).toEqual(
      BUILTIN_TOOLS.map((tool) => tool.name).sort(),
    );
    for (const [name, capability] of named)
      expect(BUILTIN_TOOLS.find((tool) => tool.name === name)?.capability).toBe(
        capability,
      );
    for (const capability of BUILTIN_UNSUPPORTED_CAPABILITIES)
      expect(AGENT_TOOLS[capability]).toEqual([]);
    expect(toolsFor([...AGENT_CAPABILITIES]).length).toBe(BUILTIN_TOOLS.length);
  });

  it('maps each tool to an agent API route of its capability', () => {
    for (const tool of BUILTIN_TOOLS) {
      const request = tool.request(SAMPLE, { issue: 'NP-7' });
      if (request === 'local') {
        expect(tool.name).toBe('np_skill_file');
        continue;
      }
      expect({
        tool: tool.name,
        capability: routeCapability(request.method, request.path),
      }).toEqual({ tool: tool.name, capability: tool.capability });
      // Every tool's schema accepts the sample (extra keys are stripped; a sub-issue waits for a list).
      const sample =
        tool.name === 'np_issue_create'
          ? { ...SAMPLE, blockedBy: ['NP-8'] }
          : SAMPLE;
      expect({
        tool: tool.name,
        ok: tool.schema.safeParse(sample).success,
      }).toEqual({
        tool: tool.name,
        ok: true,
      });
    }
  });

  it('defaults the issue to the run’s own', () => {
    const add = BUILTIN_TOOLS.find((tool) => tool.name === 'np_comment_add')!;
    expect(add.request({ content: 'hi' }, { issue: 'NP-3' })).toEqual({
      method: 'POST',
      path: '/issues/NP-3/comments',
      body: { content: 'hi' },
    });
  });
});

describe('classifyBuiltinError', () => {
  const provider = (rootMessage: string) => ({
    code: 'PROVIDER_ERROR',
    rootMessage,
  });
  it.each([
    [
      { code: 'CONFIGURATION_ERROR', message: 'no model' },
      'builtinUnavailable',
      true,
    ],
    [
      provider('401 Incorrect API key provided'),
      'agentError.providerAuth',
      true,
    ],
    [provider('Insufficient balance'), 'agentError.providerQuota', true],
    [provider('429 Too Many Requests'), 'agentError.providerRateLimit', false],
    [
      provider('fetch failed: ECONNREFUSED'),
      'agentError.providerNetwork',
      true,
    ],
    [
      provider('The model `x` does not exist'),
      'agentError.modelUnavailable',
      false,
    ],
    [
      provider("This model's maximum context length is 64000"),
      'agentError.contextOverflow',
      false,
    ],
    [provider('502 Bad Gateway'), 'agentError.providerServerError', true],
    [provider('something else'), 'agentError.unknown', false],
    [{ code: 'GRAPH_RECURSION_ERROR' }, 'agentError.stepLimit', false],
    [{ code: 'EMPTY_RESPONSE' }, 'agentError.emptyOutput', false],
    [new Error('boom'), 'agentError.unknown', false],
  ])('maps %o to %s', (error, reason, runtimeFault) => {
    expect(classifyBuiltinError(error)).toMatchObject({
      kind: 'failed',
      reason,
      runtimeFault,
    });
  });

  it('poisons the session on a context overflow and tells cancel, timeout and shutdown apart', () => {
    expect(
      classifyBuiltinError(provider('maximum context length exceeded')),
    ).toMatchObject({ poisoned: true });
    const abortedError = { code: 'ABORTED' };
    expect(classifyBuiltinError(abortedError, 'cancel')).toEqual({
      kind: 'cancelled',
    });
    expect(classifyBuiltinError(abortedError, 'timeout')).toMatchObject({
      reason: 'timeout',
    });
    expect(classifyBuiltinError(abortedError, 'shutdown')).toMatchObject({
      reason: 'runtimeRecovery',
    });
    expect(classifyBuiltinError(abortedError)).toMatchObject({
      reason: 'runtimeRecovery',
    });
  });
});
