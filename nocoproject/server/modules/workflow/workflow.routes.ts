import type { AuthEnv } from '@nocobase/app-plugin-authentication';
import type { Hono } from 'hono';

import { npRouter } from '../shared/http.js';
import type { WorkflowService } from './workflow.service.js';

/** `/np/workflows` (browser, read-only in iteration 1). */
export function createWorkflowRoutes(
  workflows: WorkflowService,
): Hono<AuthEnv> {
  const routes = npRouter<AuthEnv>();
  routes.get('/', async (context) =>
    context.json({ data: await workflows.list() }),
  );
  routes.get('/:id', async (context) =>
    context.json({ data: await workflows.get(context.req.param('id')) }),
  );
  return routes;
}
