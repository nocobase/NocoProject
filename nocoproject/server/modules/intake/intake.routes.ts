import type { AuthEnv } from '@nocobase/app-plugin-authentication';
import type { Hono } from 'hono';

import { NpError } from '../shared/errors.js';
import { npRouter, sessionActor } from '../shared/http.js';
import type { IntakeBatchAttachmentsField } from '../shared/protocol.js';
import type { IntakeService } from './intake.service.js';

/**
 * `/np/intake/batches`: read-only since NP-186. The AI draft tab, the draft editor, refine and confirm are retired and
 * answer 410 `INTAKE_RETIRED`; `GET /batches/:id` still shows a batch from before. The batch's
 * `attachments[].contentUrl` gets the application's base path.
 */
export function createIntakeRoutes(
  intake: IntakeService,
  publicBasePath?: string,
): Hono<AuthEnv> {
  const base = (publicBasePath ?? '').replace(/\/+$/u, '');
  const withBase = <T extends IntakeBatchAttachmentsField>(view: T): T => ({
    ...view,
    attachments: view.attachments.map((file) => ({
      ...file,
      contentUrl: `${base}${file.contentUrl}`,
    })),
  });
  const routes = npRouter<AuthEnv>();
  routes.get('/batches/:id', async (context) =>
    context.json({
      data: withBase(
        await intake.get(sessionActor(context), context.req.param('id')),
      ),
    }),
  );
  const retired = () => {
    throw new NpError(
      'gone',
      'INTAKE_RETIRED',
      'AI intake is retired; ask the project manager to plan the work instead.',
    );
  };
  routes.post('/batches', retired);
  routes.put('/batches/:id/drafts', retired);
  routes.post('/batches/:id/refine', retired);
  routes.post('/batches/:id/confirm', retired);
  routes.post('/batches/:id/cancel', retired);
  return routes;
}
