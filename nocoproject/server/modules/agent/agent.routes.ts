import type { AuthEnv } from '@nocobase/app-plugin-authentication';
import type { Hono } from 'hono';

import { npRouter, readJson, sessionActor } from '../shared/http.js';
import type {
  CreateAgentRequest,
  UpdateAgentRequest,
} from '../shared/protocol.js';
import type { AgentService } from './agent.service.js';

/** `/np/agents` (browser). */
export function createAgentRoutes(agents: AgentService): Hono<AuthEnv> {
  const routes = npRouter<AuthEnv>();
  routes.get('/', async (context) =>
    context.json({ data: await agents.list() }),
  );
  routes.post('/', async (context) => {
    const agent = await agents.create(
      sessionActor(context),
      await readJson<CreateAgentRequest>(context),
    );
    return context.json({ data: agent }, 201);
  });
  routes.patch('/:id', async (context) => {
    const agent = await agents.update(
      sessionActor(context),
      context.req.param('id'),
      await readJson<UpdateAgentRequest>(context),
    );
    return context.json({ data: agent });
  });
  return routes;
}
