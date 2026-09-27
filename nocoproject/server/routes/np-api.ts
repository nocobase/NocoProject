/**
 * NocoProject browser API (protocol.md §3): `/api/np/{me,projects,issues,agents,runtimes,runs}`.
 *
 * Every prefix is mounted behind its own guard: a run token is refused with 403 before the session lookup, then
 * `auth.required()` answers 401 for anonymous callers. Phase 0 only distinguishes "signed in".
 */
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';

import { createAgentRoutes } from '../modules/agent/agent.routes.js';
import { createCommentRoutes } from '../modules/collaboration/comment.routes.js';
import { createIssueRoutes } from '../modules/issue/issue.routes.js';
import { createProjectRoutes } from '../modules/project/project.routes.js';
import { createRunRoutes } from '../modules/run/run.routes.js';
import { createRuntimeRoutes } from '../modules/runtime/runtime.routes.js';
import { guarded, npRouter, rejectRunTokens } from '../modules/shared/http.js';
import type { MeResponse } from '../modules/shared/protocol.js';
import {
  npAgentServiceToken,
  npCommentServiceToken,
  npIssueQueriesToken,
  npIssueServiceToken,
  npProjectServiceToken,
  npRunEventServiceToken,
  npRunQueriesToken,
  npRunRecoveryServiceToken,
  npRunServiceToken,
  npRuntimeServiceToken,
} from '../providers/np.js';

export const npApiRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const { container } = app;
    const auth = container.resolve(authenticationToken);
    const guard = [rejectRunTokens(), auth.required()];
    const router = new Hono();

    const me = npRouter<AuthEnv>();
    me.get('/', (context) => {
      const { user } = context.get('auth')!;
      const data: MeResponse = {
        userId: user.id,
        name: user.name || user.email,
      };
      return context.json({ data });
    });

    router.route('/np/me', guarded(guard, me));
    router.route(
      '/np/projects',
      guarded(
        guard,
        createProjectRoutes(container.resolve(npProjectServiceToken)),
      ),
    );
    router.route(
      '/np/issues',
      guarded(
        guard,
        createIssueRoutes({
          issues: container.resolve(npIssueServiceToken),
          queries: container.resolve(npIssueQueriesToken),
        }),
        createCommentRoutes(container.resolve(npCommentServiceToken)),
      ),
    );
    router.route(
      '/np/agents',
      guarded(guard, createAgentRoutes(container.resolve(npAgentServiceToken))),
    );
    router.route(
      '/np/runtimes',
      guarded(
        guard,
        createRuntimeRoutes(container.resolve(npRuntimeServiceToken)),
      ),
    );
    router.route(
      '/np/runs',
      guarded(
        guard,
        createRunRoutes({
          runs: container.resolve(npRunServiceToken),
          queries: container.resolve(npRunQueriesToken),
          events: container.resolve(npRunEventServiceToken),
          recovery: container.resolve(npRunRecoveryServiceToken),
        }),
      ),
    );
    return router;
  });
