import type { Application } from '@nocobase/app-server/application';
import type { AppRouteContribution } from '@nocobase/app-server/router';

import { npAgentRoutes } from './np-agent.js';
import { npApiRoutes } from './np-api.js';
import { npDaemonRoutes } from './np-daemon.js';

const routes: readonly AppRouteContribution<Application>[] = [
  // NocoProject Phase 0 (docs/phase0/protocol.md): browser §3, daemon §4, agent write-back §5.
  npApiRoutes,
  npDaemonRoutes,
  npAgentRoutes,
];

export default routes;
