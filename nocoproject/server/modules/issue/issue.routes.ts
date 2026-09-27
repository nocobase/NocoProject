import type { AuthEnv } from '@nocobase/app-plugin-authentication';
import type { Context, Hono } from 'hono';

import { npRouter, queryText, readJson, sessionActor } from '../shared/http.js';
import type {
  CreateIssueRequestV2,
  StatusChangePendingResponse,
  UpdateIssueRequestV2,
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
 * `{ data: { groups: [{ statusKey, issues }] } }`; an issue the caller cannot see is 404. `PATCH` answers 202
 * `{ data: { issue, pendingApproval } }` when the status change waits for approval (iteration 2 §D), and
 * `GET /:id/runs` answers `{ data: RunSummary[], queuedRun }` (§J).
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
      await readJson<CreateIssueRequestV2>(context),
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
    const result = await deps.issues.patch(
      sessionActor(context),
      context.req.param('id'),
      await readJson<UpdateIssueRequestV2>(context),
    );
    if (result.pendingApproval) {
      const data: StatusChangePendingResponse = {
        issue: result.issue,
        pendingApproval: result.pendingApproval,
      };
      return context.json({ data }, 202);
    }
    return context.json({ data: result.issue });
  });
  routes.get('/:id/runs', async (context) =>
    context.json(
      await deps.queries.runs(sessionActor(context), context.req.param('id')),
    ),
  );
  return routes;
}
