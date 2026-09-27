// @vitest-environment node
/**
 * The three NocoProject route contributions, built through their real factories with test doubles: authentication
 * boundaries (anonymous 401, run token 403 on the browser and daemon surfaces), daemon run ownership, run-token
 * authentication on the agent API, and domain error mapping.
 */
import { describe, expect, it, vi } from 'vitest';
import { authenticationToken } from '@nocobase/app-plugin-authentication';
import type { Application } from '@nocobase/app-server/application';
import type { AppApiRouteContribution } from '@nocobase/app-server/router';
import { ServiceContainer } from '@nocobase/service-provider';
import type { MiddlewareHandler } from 'hono';

import { conflict } from '../../server/modules/shared/errors.ts';
import {
  npAgentServiceToken,
  npClaimServiceToken,
  npCommentServiceToken,
  npIssueQueriesToken,
  npIssueServiceToken,
  npProjectServiceToken,
  npRunEventServiceToken,
  npRunQueriesToken,
  npRunRecoveryServiceToken,
  npRunServiceToken,
  npRunTokenServiceToken,
  npRuntimeServiceToken,
} from '../../server/providers/np.ts';
import { npAgentRoutes } from '../../server/routes/np-agent.ts';
import { npApiRoutes } from '../../server/routes/np-api.ts';
import { npDaemonRoutes } from '../../server/routes/np-daemon.ts';
import routes from '../../server/routes/index.ts';

const RUN_TOKEN = `npr_${'a'.repeat(40)}`;

/** Signed in when the request carries `x-test-user`; otherwise the plugin's 401. */
const testAuth = {
  required: (): MiddlewareHandler => async (context, next) => {
    const userId = context.req.header('x-test-user');
    if (!userId)
      return context.json(
        { code: 'UNAUTHORIZED', message: 'Authentication required' },
        401,
      );
    context.set('auth', {
      user: {
        id: userId,
        name: `User ${userId}`,
        email: `${userId}@example.com`,
      },
      session: {},
    });
    await next();
  },
  optional: (): MiddlewareHandler => async (_context, next) => next(),
};

function createDoubles() {
  const issues = {
    create: vi.fn(),
    update: vi.fn(async () => {
      throw conflict('REVISION_CONFLICT', 'Issue is at revision 3.');
    }),
    agentSetStatus: vi.fn(
      async (_actor: unknown, id: string, statusKey: string) => ({
        id,
        statusKey,
      }),
    ),
  };
  const issueQueries = {
    list: vi.fn(async () => [{ id: 'i1', identifier: 'NP-1' }]),
    detail: vi.fn(),
    forAgent: vi.fn(async (id: string) => ({
      id: id === 'NP-1' ? 'i1' : id,
      identifier: 'NP-1',
    })),
    agentContext: vi.fn(async (auth: { runId: string }) => ({
      run: { id: auth.runId },
    })),
  };
  const comments = {
    create: vi.fn(async () => ({ comment: { id: 'c1' }, triggered: [] })),
    listForAgent: vi.fn(async () => []),
  };
  const runtimes = {
    register: vi.fn(async () => ({ runtimes: [] })),
    heartbeat: vi.fn(async () => 1),
    deregister: vi.fn(async () => 1),
    list: vi.fn(async () => []),
    runAccess: vi.fn(async (runId: string) =>
      runId === 'mine' ? 'ok' : runId === 'theirs' ? 'forbidden' : 'notFound',
    ),
  };
  const runs = {
    daemonStatus: vi.fn(async () => ({
      status: 'running',
      cancelRequested: false,
    })),
    extendLease: vi.fn(),
  };
  const runTokens = {
    verify: vi.fn(async (token: string) =>
      token === RUN_TOKEN
        ? { runId: 'r1', agentId: 'a1', actorUserId: 'u1', issueId: 'i1' }
        : null,
    ),
  };
  const claims = { claim: vi.fn(async () => ({ runs: [] })) };
  return { issues, issueQueries, comments, runtimes, runs, runTokens, claims };
}

async function build(
  contribution: AppApiRouteContribution<Application>,
  doubles = createDoubles(),
) {
  const container = new ServiceContainer();
  container.instance(authenticationToken, testAuth as never);
  container.instance(npProjectServiceToken, {
    list: async () => [],
    create: vi.fn(),
  } as never);
  container.instance(npIssueServiceToken, doubles.issues as never);
  container.instance(npIssueQueriesToken, doubles.issueQueries as never);
  container.instance(npCommentServiceToken, doubles.comments as never);
  container.instance(npAgentServiceToken, { list: async () => [] } as never);
  container.instance(npRuntimeServiceToken, doubles.runtimes as never);
  container.instance(npRunServiceToken, doubles.runs as never);
  container.instance(npRunQueriesToken, {} as never);
  container.instance(npRunEventServiceToken, {
    list: async () => ({ data: [], last: -1 }),
  } as never);
  container.instance(npRunRecoveryServiceToken, {} as never);
  container.instance(npClaimServiceToken, doubles.claims as never);
  container.instance(npRunTokenServiceToken, doubles.runTokens as never);
  const router = await contribution.createRouter({
    container,
    publicBasePath: '/main',
  } as unknown as Application);
  return { router, doubles };
}

const signedIn = { 'x-test-user': 'u1' };
const withRunToken = { authorization: `Bearer ${RUN_TOKEN}` };
const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

describe('NocoProject route registration', () => {
  it('registers the three contributions under /api', () => {
    expect(routes).toEqual(
      expect.arrayContaining([npApiRoutes, npDaemonRoutes, npAgentRoutes]),
    );
    for (const contribution of [npApiRoutes, npDaemonRoutes, npAgentRoutes])
      expect(contribution.scope).toBe('api');
  });
});

describe('browser API /np/*', () => {
  it.each([
    '/np/me',
    '/np/projects',
    '/np/issues',
    '/np/issues/NP-1',
    '/np/agents',
    '/np/runtimes',
    '/np/runs/r1',
  ])('answers 401 to an anonymous GET %s', async (path) => {
    const { router } = await build(npApiRoutes);
    const response = await router.request(path);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('answers 403 to a run token, even alongside a session', async () => {
    const { router } = await build(npApiRoutes);
    for (const headers of [withRunToken, { ...withRunToken, ...signedIn }]) {
      const response = await router.request('/np/issues', { headers });
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        code: 'RUN_TOKEN_FORBIDDEN',
      });
    }
  });

  it('returns the signed-in user from /np/me', async () => {
    const { router } = await build(npApiRoutes);
    const response = await router.request('/np/me', { headers: signedIn });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { userId: 'u1', name: 'User u1' },
    });
  });

  it('passes list filters and maps domain conflicts to 409', async () => {
    const { router, doubles } = await build(npApiRoutes);
    const list = await router.request('/np/issues?statusKey=todo&q=bug', {
      headers: signedIn,
    });
    expect(list.status).toBe(200);
    expect(doubles.issueQueries.list).toHaveBeenCalledWith({
      statusKey: 'todo',
      projectId: null,
      q: 'bug',
    });

    const patch = await router.request('/np/issues/i1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...signedIn },
      body: JSON.stringify({ title: 'x', revision: 1 }),
    });
    expect(patch.status).toBe(409);
    await expect(patch.json()).resolves.toEqual({
      code: 'REVISION_CONFLICT',
      message: 'Issue is at revision 3.',
    });
  });

  it('rejects a non-JSON body with 400', async () => {
    const { router } = await build(npApiRoutes);
    const response = await router.request('/np/issues/i1/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...signedIn },
      body: 'not json',
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'INVALID_JSON',
    });
  });

  it('passes the caller as the comment author', async () => {
    const { router, doubles } = await build(npApiRoutes);
    const response = await router.request(
      '/np/issues/NP-1/comments',
      json({ content: 'hi' }, signedIn),
    );
    expect(response.status).toBe(201);
    expect(doubles.comments.create).toHaveBeenCalledWith(
      { type: 'user', id: 'u1' },
      'NP-1',
      { content: 'hi' },
    );
  });
});

describe('daemon API /np/daemon/*', () => {
  it('answers 401 to anonymous and 403 to a run token', async () => {
    const { router } = await build(npDaemonRoutes);
    expect((await router.request('/np/daemon/register', json({}))).status).toBe(
      401,
    );
    expect(
      (await router.request('/np/daemon/runs/claim', json({}))).status,
    ).toBe(401);
    expect((await router.request('/np/daemon/runs/mine/status')).status).toBe(
      401,
    );
    const tokenResponse = await router.request(
      '/np/daemon/heartbeat',
      json({}, withRunToken),
    );
    expect(tokenResponse.status).toBe(403);
  });

  it('only lets the owner of the run runtime act on a run', async () => {
    const { router, doubles } = await build(npDaemonRoutes);
    expect(
      (
        await router.request('/np/daemon/runs/mine/status', {
          headers: signedIn,
        })
      ).status,
    ).toBe(200);
    const theirs = await router.request('/np/daemon/runs/theirs/status', {
      headers: signedIn,
    });
    expect(theirs.status).toBe(403);
    await expect(theirs.json()).resolves.toMatchObject({
      code: 'RUN_NOT_OWNED',
    });
    expect(
      (
        await router.request('/np/daemon/runs/missing/status', {
          headers: signedIn,
        })
      ).status,
    ).toBe(404);
    expect(doubles.runtimes.runAccess).toHaveBeenCalledWith('theirs', 'u1');
  });

  it('claims for the key owner with the public server URL', async () => {
    const { router, doubles } = await build(npDaemonRoutes);
    const body = { daemonId: 'd1', slots: [{ runtimeId: 'rt1', free: 2 }] };
    const response = await router.request(
      'http://localhost/np/daemon/runs/claim',
      json(body, signedIn),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { runs: [] } });
    expect(doubles.claims.claim).toHaveBeenCalledWith(
      'u1',
      body,
      'http://localhost/main',
    );
    expect(doubles.runtimes.runAccess).not.toHaveBeenCalled();
  });
});

describe('agent API /np/agent/*', () => {
  it('answers 401 without a run token, with a session, or with an unknown token', async () => {
    const { router } = await build(npAgentRoutes);
    expect((await router.request('/np/agent/context')).status).toBe(401);
    expect(
      (await router.request('/np/agent/context', { headers: signedIn })).status,
    ).toBe(401);
    const unknown = await router.request('/np/agent/context', {
      headers: { authorization: `Bearer npr_${'b'.repeat(40)}` },
    });
    expect(unknown.status).toBe(401);
    await expect(unknown.json()).resolves.toMatchObject({
      code: 'INVALID_RUN_TOKEN',
    });
  });

  it('serves the run context for a valid token', async () => {
    const { router } = await build(npAgentRoutes);
    const response = await router.request('/np/agent/context', {
      headers: withRunToken,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { run: { id: 'r1' } },
    });
  });

  it('writes comments as the run agent and only to the run issue', async () => {
    const { router, doubles } = await build(npAgentRoutes);
    const ok = await router.request(
      '/np/agent/issues/NP-1/comments',
      json({ content: 'done' }, withRunToken),
    );
    expect(ok.status).toBe(201);
    expect(doubles.comments.create).toHaveBeenCalledWith(
      { type: 'agent', id: 'a1', runId: 'r1' },
      'i1',
      {
        content: 'done',
      },
    );
    const other = await router.request(
      '/np/agent/issues/i2/status',
      json({ statusKey: 'in_review' }, withRunToken),
    );
    expect(other.status).toBe(403);
    await expect(other.json()).resolves.toMatchObject({
      code: 'ISSUE_NOT_IN_RUN',
    });
  });

  it('does not leak its middleware onto /np/agents', async () => {
    const { router } = await build(npAgentRoutes);
    // Not a route of this contribution: no run-token 401 from the /np/agent guard.
    expect((await router.request('/np/agents')).status).toBe(404);
  });
});
