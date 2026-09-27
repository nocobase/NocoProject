import type { AuthEnv } from '@nocobase/app-plugin-authentication';
import type { Hono } from 'hono';

import { npRouter } from '../shared/http.js';
import type { RuntimeService } from './runtime.service.js';

/** `/np/runtimes` (browser). */
export function createRuntimeRoutes(runtimes: RuntimeService): Hono<AuthEnv> {
  const routes = npRouter<AuthEnv>();
  routes.get('/', async (context) =>
    context.json({ data: await runtimes.list() }),
  );
  return routes;
}
