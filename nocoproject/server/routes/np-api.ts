/**
 * NocoProject browser API (protocol.md §3, iteration-1 contract §B–§H):
 * `/api/np/{me,members,workflows,projects,labels,issues,inbox,agents,runtimes,runs}`.
 *
 * Every prefix is mounted behind its own guard: a run token is refused with 403 before the session lookup,
 * `auth.required()` answers 401 for anonymous callers, and `ensureMember` bootstraps the caller's members row. The
 * application-level rules (who may see and change what) are enforced by the services through `shared/authz.ts`.
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
import { createLabelRoutes } from '../modules/label/label.routes.js';
import {
  createMemberRoutes,
  ensureMember,
} from '../modules/member/member.routes.js';
import {
  createInboxRoutes,
  createSubscriptionRoutes,
} from '../modules/notification/inbox.routes.js';
import { createProjectRoutes } from '../modules/project/project.routes.js';
import { createRunRoutes } from '../modules/run/run.routes.js';
import { createRuntimeRoutes } from '../modules/runtime/runtime.routes.js';
import { createSubtaskRoutes } from '../modules/subtask/subtask.routes.js';
import { createWorkflowRoutes } from '../modules/workflow/workflow.routes.js';
import { guarded, npRouter, rejectRunTokens } from '../modules/shared/http.js';
import type { MeResponse } from '../modules/shared/protocol.js';
import {
  npAgentServiceToken,
  npCommentServiceToken,
  npDependencyServiceToken,
  npInboxServiceToken,
  npLabelServiceToken,
  npMemberServiceToken,
  npProposalServiceToken,
  npWorkflowServiceToken,
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
    const members = container.resolve(npMemberServiceToken);
    const inbox = container.resolve(npInboxServiceToken);
    const guard = [rejectRunTokens(), auth.required(), ensureMember(members)];
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
    router.route('/np/members', guarded(guard, createMemberRoutes(members)));
    router.route(
      '/np/workflows',
      guarded(
        guard,
        createWorkflowRoutes(container.resolve(npWorkflowServiceToken)),
      ),
    );
    router.route(
      '/np/projects',
      guarded(
        guard,
        createProjectRoutes(container.resolve(npProjectServiceToken)),
      ),
    );
    router.route(
      '/np/labels',
      guarded(guard, createLabelRoutes(container.resolve(npLabelServiceToken))),
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
        createSubtaskRoutes({
          dependencies: container.resolve(npDependencyServiceToken),
          proposals: container.resolve(npProposalServiceToken),
        }),
        createSubscriptionRoutes(inbox),
      ),
    );
    router.route('/np/inbox', guarded(guard, createInboxRoutes(inbox)));
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
