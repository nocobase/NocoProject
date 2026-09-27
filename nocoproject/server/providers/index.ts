import type { ApplicationServiceProviderConstructor } from '@nocobase/app-server/application';

import NpProvider from './np.js';

export {
  npAgentServiceToken,
  npClaimServiceToken,
  npCommentServiceToken,
  npIssueQueriesToken,
  npIssueServiceToken,
  npProjectServiceToken,
  npRunEventServiceToken,
  npRunQueriesToken,
  npRunRecoveryServiceToken,
  npRunServiceToken,
  npRunTokenServiceToken,
  npRuntimeServiceToken,
  npServicesToken,
  npSweeperServiceToken,
  npTriggerServiceToken,
} from './np.js';

const serviceProviders: readonly ApplicationServiceProviderConstructor[] = [
  // NocoProject Phase 0 modules (server/modules/*): services, realtime topics, run sweeper.
  NpProvider,
];

export default serviceProviders;
