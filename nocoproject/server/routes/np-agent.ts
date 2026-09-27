/**
 * NocoProject agent write-back API (protocol.md §5): `/api/np/agent/*`, authenticated only by a run token
 * (`Authorization: Bearer npr_…`). Sessions and API keys are not accepted here: the caller is the agent of one run.
 */
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';

import {
  createAgentApiRoutes,
  runTokenAuth,
} from '../modules/run/agent-api.routes.js';
import { guarded } from '../modules/shared/http.js';
import {
  npAgentIssueServiceToken,
  npCommentServiceToken,
  npIssueQueriesToken,
  npIssueServiceToken,
  npPullRequestServiceToken,
  npRunTokenServiceToken,
} from '../providers/np.js';

export const npAgentRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const { container } = app;
    const router = new Hono();
    router.route(
      '/np/agent',
      guarded(
        [runTokenAuth(container.resolve(npRunTokenServiceToken))],
        createAgentApiRoutes({
          issues: container.resolve(npIssueServiceToken),
          queries: container.resolve(npIssueQueriesToken),
          comments: container.resolve(npCommentServiceToken),
          agentIssues: container.resolve(npAgentIssueServiceToken),
          pullRequests: container.resolve(npPullRequestServiceToken),
        }),
      ),
    );
    return router;
  });
