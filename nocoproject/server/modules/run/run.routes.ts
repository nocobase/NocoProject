import type { AuthEnv } from '@nocobase/app-plugin-authentication';
import type { Hono } from 'hono';

import { npRouter, queryInt, sessionActor } from '../shared/http.js';
import type { RunRecoveryService } from './failure.js';
import type { RunEventService } from './run-events.js';
import type { RunQueries } from './run.queries.js';
import type { RunService } from './run.service.js';

/** `/np/runs` (browser): run detail, event log, stop and retry. */
export function createRunRoutes(deps: {
  runs: RunService;
  queries: RunQueries;
  events: RunEventService;
  recovery: RunRecoveryService;
}): Hono<AuthEnv> {
  const routes = npRouter<AuthEnv>();
  routes.get('/:id', async (context) =>
    context.json({ data: await deps.queries.detail(context.req.param('id')) }),
  );
  routes.get('/:id/events', async (context) => {
    const { data, last } = await deps.events.list(
      context.req.param('id'),
      queryInt(context, 'since'),
    );
    return context.json({ data, last });
  });
  routes.post('/:id/cancel', async (context) =>
    context.json({
      data: await deps.runs.requestCancel(
        sessionActor(context),
        context.req.param('id'),
      ),
    }),
  );
  routes.post('/:id/retry', async (context) =>
    context.json(
      {
        data: await deps.recovery.retry(
          sessionActor(context),
          context.req.param('id'),
        ),
      },
      201,
    ),
  );
  return routes;
}
