import type { AuthEnv } from '@nocobase/app-plugin-authentication';
import type { Hono } from 'hono';

import { invalid } from '../shared/errors.js';
import { npRouter, queryText, readJson, sessionActor } from '../shared/http.js';
import type {
  ConfirmIntakeRequest,
  CreateIntakeBatchRequest,
  PutIntakeDraftsRequest,
} from '../shared/protocol.js';
import type { IntakeService } from './intake.service.js';

function optionalBody<T>(text: string): T {
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw invalid('INVALID_JSON', 'Request body must be JSON.');
  }
}

/** `/np/intake/batches` (browser, contract §E). */
export function createIntakeRoutes(intake: IntakeService): Hono<AuthEnv> {
  const routes = npRouter<AuthEnv>();
  routes.post('/batches', async (context) =>
    context.json(
      {
        data: await intake.create(
          sessionActor(context),
          await readJson<CreateIntakeBatchRequest>(context),
        ),
      },
      201,
    ),
  );
  routes.get('/batches', async (context) =>
    context.json({
      data: await intake.list(
        sessionActor(context),
        ['1', 'true'].includes(queryText(context, 'mine') ?? ''),
      ),
    }),
  );
  routes.get('/batches/:id', async (context) =>
    context.json({
      data: await intake.get(sessionActor(context), context.req.param('id')),
    }),
  );
  routes.put('/batches/:id/drafts', async (context) => {
    const body = await readJson<PutIntakeDraftsRequest>(context);
    return context.json({
      data: {
        drafts: await intake.putDrafts(
          sessionActor(context),
          context.req.param('id'),
          body.drafts,
        ),
      },
    });
  });
  routes.post('/batches/:id/confirm', async (context) =>
    context.json({
      data: await intake.confirm(
        sessionActor(context),
        context.req.param('id'),
        optionalBody<ConfirmIntakeRequest>(await context.req.text()),
      ),
    }),
  );
  routes.post('/batches/:id/cancel', async (context) =>
    context.json({
      data: await intake.cancel(sessionActor(context), context.req.param('id')),
    }),
  );
  routes.post('/batches/:id/revert', async (context) =>
    context.json({
      data: await intake.revert(sessionActor(context), context.req.param('id')),
    }),
  );
  return routes;
}
