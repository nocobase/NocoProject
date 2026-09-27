import type { AuthEnv } from '@nocobase/app-plugin-authentication';
import type { Context, Hono } from 'hono';

import { npRouter, queryText, readJson, sessionActor } from '../shared/http.js';
import type {
  CreateIssueRequestV1,
  UpdateIssueRequestV1,
} from '../shared/protocol.js';
import type { IssueListFilter, IssueQueries } from './issue.queries.js';
import type { IssueService } from './issue.service.js';

function listFilter(context: Context): IssueListFilter {
  return {
    statusKey: queryText(context, 'statusKey'),
    projectId: queryText(context, 'projectId'),
    q: queryText(context, 'q'),
    labelId: queryText(context, 'labelId'),
    ownerUserId: queryText(context, 'ownerUserId'),
    executorId: queryText(context, 'executorId'),
    parentIssueId: queryText(context, 'parentIssueId'),
  };
}

/**
 * `/np/issues` (browser). `:id` accepts an issue id or its identifier (`NP-12`). `GET /?view=board` answers
 * `{ data: { groups: [{ statusKey, issues }] } }`; an issue the caller cannot see is 404.
 */
export function createIssueRoutes(deps: {
  issues: IssueService;
  queries: IssueQueries;
}): Hono<AuthEnv> {
  const routes = npRouter<AuthEnv>();
  routes.get('/', async (context) => {
    const actor = sessionActor(context);
    const filter = listFilter(context);
    return context.json({
      data:
        queryText(context, 'view') === 'board'
          ? await deps.queries.board(actor, filter)
          : await deps.queries.list(actor, filter),
    });
  });
  routes.post('/', async (context) => {
    const issue = await deps.issues.create(
      sessionActor(context),
      await readJson<CreateIssueRequestV1>(context),
    );
    return context.json({ data: issue }, 201);
  });
  routes.get('/:id', async (context) =>
    context.json({
      data: await deps.queries.detail(
        sessionActor(context),
        context.req.param('id'),
      ),
    }),
  );
  routes.patch('/:id', async (context) => {
    const issue = await deps.issues.update(
      sessionActor(context),
      context.req.param('id'),
      await readJson<UpdateIssueRequestV1>(context),
    );
    return context.json({ data: issue });
  });
  return routes;
}
