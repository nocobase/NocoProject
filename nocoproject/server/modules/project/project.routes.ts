import type { AuthEnv } from '@nocobase/app-plugin-authentication';
import type { Hono } from 'hono';

import { npRouter, readJson } from '../shared/http.js';
import type { CreateProjectInput, ProjectService } from './project.service.js';

/** `/np/projects` (browser). Authentication is installed by the owning contribution. */
export function createProjectRoutes(projects: ProjectService): Hono<AuthEnv> {
  const routes = npRouter<AuthEnv>();
  routes.get('/', async (context) =>
    context.json({ data: await projects.list() }),
  );
  routes.post('/', async (context) => {
    const project = await projects.create(
      await readJson<CreateProjectInput>(context),
    );
    return context.json({ data: project }, 201);
  });
  return routes;
}
