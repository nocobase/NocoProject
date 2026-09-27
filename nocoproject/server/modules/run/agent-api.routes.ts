import type { Context, Hono, MiddlewareHandler } from 'hono';

import type { CommentService } from '../collaboration/comment.service.js';
import type { IssueQueries } from '../issue/issue.queries.js';
import type { IssueService } from '../issue/issue.service.js';
import type { Actor } from '../shared/activity.js';
import { NpError } from '../shared/errors.js';
import {
  bearerRunToken,
  errorBody,
  npRouter,
  queryInt,
  queryText,
  readJson,
} from '../shared/http.js';
import type { CreateCommentRequest } from '../shared/protocol.js';
import type { RunAuth, RunTokenService } from './token.js';

export interface RunTokenEnv {
  Variables: { runAuth: RunAuth };
}

/**
 * Run-token authentication for the agent API: `Authorization: Bearer npr_…`, not revoked, not expired, run not
 * terminal. Anything else is 401.
 */
export function runTokenAuth(
  tokens: RunTokenService,
): MiddlewareHandler<RunTokenEnv> {
  return async (context, next) => {
    const token = bearerRunToken(context);
    const auth = token ? await tokens.verify(token) : null;
    if (!auth) {
      return context.json(
        errorBody('INVALID_RUN_TOKEN', 'A valid run token is required.'),
        401,
      );
    }
    context.set('runAuth', auth);
    await next();
  };
}

function agentActor(context: Context<RunTokenEnv>): Actor {
  const auth = context.get('runAuth');
  return { type: 'agent', id: auth.agentId, runId: auth.runId };
}

/**
 * `/np/agent/*` (protocol.md §5). Reads may address any issue; writes are limited to the issue of the token's run.
 */
export function createAgentApiRoutes(deps: {
  issues: IssueService;
  queries: IssueQueries;
  comments: CommentService;
}): Hono<RunTokenEnv> {
  const routes = npRouter<RunTokenEnv>();

  async function requireRunIssue(
    context: Context<RunTokenEnv>,
  ): Promise<string> {
    const issue = await deps.queries.forAgent(context.req.param('id') ?? '');
    if (issue.id !== context.get('runAuth').issueId) {
      throw new NpError(
        'forbidden',
        'ISSUE_NOT_IN_RUN',
        'A run token may only write to its own issue.',
      );
    }
    return issue.id;
  }

  routes.get('/context', async (context) =>
    context.json({
      data: await deps.queries.agentContext(context.get('runAuth')),
    }),
  );
  routes.get('/issues/:id', async (context) =>
    context.json({
      data: await deps.queries.forAgent(context.req.param('id')),
    }),
  );
  routes.get('/issues/:id/comments', async (context) =>
    context.json({
      data: await deps.comments.listForAgent(context.req.param('id'), {
        since: queryText(context, 'since'),
        rootsOnly: ['1', 'true'].includes(
          queryText(context, 'rootsOnly') ?? '',
        ),
        thread: queryText(context, 'thread'),
        tail: queryInt(context, 'tail'),
      }),
    }),
  );
  routes.post('/issues/:id/comments', async (context) => {
    const issueId = await requireRunIssue(context);
    const result = await deps.comments.create(
      agentActor(context),
      issueId,
      await readJson<CreateCommentRequest>(context),
    );
    return context.json({ data: result.comment }, 201);
  });
  routes.post('/issues/:id/status', async (context) => {
    const issueId = await requireRunIssue(context);
    const body = await readJson<{ statusKey: string }>(context);
    return context.json({
      data: await deps.issues.agentSetStatus(
        agentActor(context),
        issueId,
        body.statusKey,
      ),
    });
  });
  return routes;
}
