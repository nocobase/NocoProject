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
  npWorkflowServiceToken,
  npMemberServiceToken,
  npLabelServiceToken,
  npDependencyServiceToken,
  npProposalServiceToken,
  npAgentIssueServiceToken,
  npInboxServiceToken,
  NP_MEMBERS_SETTINGS_ID,
  NP_SETTINGS_SETTINGS_ID,
  NP_GITHUB_SETTINGS_ID,
  npApprovalGatewayToken,
  npGitConnectionServiceToken,
  npPullRequestServiceToken,
  npWebhookServiceToken,
  npIntakeServiceToken,
  npReactionServiceToken,
  npAgentEnvServiceToken,
  npSkillServiceToken,
  npUsageServiceToken,
  npWorkspaceSettingsServiceToken,
} from './np.js';

const serviceProviders: readonly ApplicationServiceProviderConstructor[] = [
  // NocoProject modules (server/modules/*): services, realtime topics, np-members settings item, run sweeper.
  NpProvider,
];

export default serviceProviders;
