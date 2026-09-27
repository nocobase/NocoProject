import type { Application } from '@nocobase/app-server/application';
import type { AppRouteContribution } from '@nocobase/app-server/router';

import { npAgentRoutes } from './np-agent.js';
import { npApiRoutes } from './np-api.js';
import { npDaemonRoutes } from './np-daemon.js';

const routes: readonly AppRouteContribution<Application>[] = [
  // NocoProject (docs/phase0/protocol.md, docs/phase1/protocol-iteration-1.md): browser, daemon, agent write-back.
  npApiRoutes,
  npDaemonRoutes,
  npAgentRoutes,
];

export default routes;
