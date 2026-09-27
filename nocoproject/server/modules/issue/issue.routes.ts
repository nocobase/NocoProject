import type { AuthEnv } from '@nocobase/app-plugin-authentication';
import type { Hono } from 'hono';

import { npRouter, queryText, readJson, sessionActor } from '../shared/http.js';
import type {
  CreateIssueRequest,
  UpdateIssueRequest,
} from '../shared/protocol.js';
import type { IssueQueries } from './issue.queries.js';
import type { IssueService } from './issue.service.js';

/** `/np/issues` (browser). `:id` accepts an issue id or its identifier (`NP-12`). */
export function createIssueRoutes(deps: {
  issues: IssueService;
  queries: IssueQueries;
}): Hono<AuthEnv> {
  const routes = npRouter<AuthEnv>();
  routes.get('/', async (context) =>
    context.json({
      data: await deps.queries.list({
        statusKey: queryText(context, 'statusKey'),
        projectId: queryText(context, 'projectId'),
        q: queryText(context, 'q'),
      }),
    }),
  );
  routes.post('/', async (context) => {
    const issue = await deps.issues.create(
      sessionActor(context),
      await readJson<CreateIssueRequest>(context),
    );
    return context.json({ data: issue }, 201);
  });
  routes.get('/:id', async (context) =>
    context.json({ data: await deps.queries.detail(context.req.param('id')) }),
  );
  routes.patch('/:id', async (context) => {
    const issue = await deps.issues.update(
      sessionActor(context),
      context.req.param('id'),
      await readJson<UpdateIssueRequest>(context),
    );
    return context.json({ data: issue });
  });
  return routes;
}
