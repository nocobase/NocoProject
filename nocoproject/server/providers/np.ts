/**
 * NocoProject provider: binds every module service to its token, connects domain events to realtime topics, registers
 * the `np-members`, `np-settings` and `np-github` settings items with the authorization plugin (titles are
 * i18n keys in the application namespace), and runs the run sweeper every 30 seconds (which also purges old webhook
 * delivery records).
 *
 * Iteration 2: the secret key for stored secrets comes from the `nocoproject` configuration section
 * (`NOCOPROJECT_SECRET_KEY`), falling back to a key derived from `auth.secret` with a warning; the AI intake parser is
 * built from the AI employee plugin's agent factory when that plugin is registered.
 *
 * Page grants for the NocoProject pages (and `read` on the settings items) are given to the default `member`
 * permission set once, by the seeds `2026092800003_np_member_page_grants`, `2026092900003_np_iter2_page_grants` and
 * `2026092900004_np_github_settings_grant`, so administrators can still edit them.
 */
import {
  agentServiceFactoryToken,
  aiConversationsManagerToken,
  type AIApplicationConfig,
} from '@nocobase/app-plugin-ai-employee/server';
import type { AuthConfig } from '@nocobase/app-plugin-authentication/server';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import { idGeneratorToken } from '@nocobase/app-server/id-generator';
import { loggingToken } from '@nocobase/app-server/logging';
import { realtimeServiceToken } from '@nocobase/app-server/realtime';
import { createCronJobManager, type CronJobManager } from '@nocobase/cron';
import { databaseManagerToken } from '@nocobase/db';
import { APP_NS } from '@nocobase/i18n';
import {
  createServiceToken,
  ServiceProvider,
  type ServiceToken,
} from '@nocobase/service-provider';

import type { NocoProjectConfig } from '../config/nocoproject.js';
import type { AgentService } from '../modules/agent/agent.service.js';
import type { AgentEnvService } from '../modules/agent/env.service.js';
import type { ReactionService } from '../modules/collaboration/reaction.service.js';
import type { GitConnectionService } from '../modules/git/connection.service.js';
import type { PullRequestService } from '../modules/git/pull-request.service.js';
import type { WebhookService } from '../modules/git/webhook.service.js';
import {
  createAiIntakeParser,
  type AiIntakeParser,
} from '../modules/intake/ai-parser.js';
import type { IntakeService } from '../modules/intake/intake.service.js';
import type { ApprovalGateway } from '../modules/shared/approval.js';
import {
  createSecretBox,
  resolveSecretKey,
  type SecretBox,
} from '../modules/shared/crypto.js';
import type { SkillService } from '../modules/skill/skill.service.js';
import type { WorkspaceSettingsService } from '../modules/system/settings.admin.js';
import type { UsageService } from '../modules/usage/usage.service.js';
import type { CommentService } from '../modules/collaboration/comment.service.js';
import type { IssueQueries } from '../modules/issue/issue.queries.js';
import type { IssueService } from '../modules/issue/issue.service.js';
import type { LabelService } from '../modules/label/label.service.js';
import type { MemberService } from '../modules/member/member.service.js';
import type { InboxService } from '../modules/notification/inbox.service.js';
import type { AgentIssueService } from '../modules/subtask/agent-issue.service.js';
import type { DependencyService } from '../modules/subtask/dependency.service.js';
import type { ProposalService } from '../modules/subtask/proposal.service.js';
import type { WorkflowService } from '../modules/workflow/workflow.service.js';
import type { ProjectService } from '../modules/project/project.service.js';
import type { ClaimService } from '../modules/run/claim.service.js';
import type { RunRecoveryService } from '../modules/run/failure.js';
import type { RunEventService } from '../modules/run/run-events.js';
import type { RunQueries } from '../modules/run/run.queries.js';
import type { RunService } from '../modules/run/run.service.js';
import {
  SWEEP_CRON_TIME,
  type SweeperService,
} from '../modules/run/sweeper.js';
import type { RunTokenService } from '../modules/run/token.js';
import type { RuntimeService } from '../modules/runtime/runtime.service.js';
import { createNpServices, type NpServices } from '../modules/services.js';
import { createDomainEventBus } from '../modules/shared/events.js';
import {
  connectRealtime,
  type NpRealtimeTopics,
} from '../modules/shared/realtime-bridge.js';
import type { TriggerService } from '../modules/trigger/trigger.service.js';

export const npServicesToken: ServiceToken<NpServices> =
  createServiceToken<NpServices>('nocoproject/services');
export const npProjectServiceToken: ServiceToken<ProjectService> =
  createServiceToken<ProjectService>('nocoproject/project-service');
export const npIssueServiceToken: ServiceToken<IssueService> =
  createServiceToken<IssueService>('nocoproject/issue-service');
export const npIssueQueriesToken: ServiceToken<IssueQueries> =
  createServiceToken<IssueQueries>('nocoproject/issue-queries');
export const npCommentServiceToken: ServiceToken<CommentService> =
  createServiceToken<CommentService>('nocoproject/comment-service');
export const npAgentServiceToken: ServiceToken<AgentService> =
  createServiceToken<AgentService>('nocoproject/agent-service');
export const npRuntimeServiceToken: ServiceToken<RuntimeService> =
  createServiceToken<RuntimeService>('nocoproject/runtime-service');
export const npTriggerServiceToken: ServiceToken<TriggerService> =
  createServiceToken<TriggerService>('nocoproject/trigger-service');
export const npRunServiceToken: ServiceToken<RunService> =
  createServiceToken<RunService>('nocoproject/run-service');
export const npRunRecoveryServiceToken: ServiceToken<RunRecoveryService> =
  createServiceToken<RunRecoveryService>('nocoproject/run-recovery-service');
export const npRunEventServiceToken: ServiceToken<RunEventService> =
  createServiceToken<RunEventService>('nocoproject/run-event-service');
export const npRunQueriesToken: ServiceToken<RunQueries> =
  createServiceToken<RunQueries>('nocoproject/run-queries');
export const npClaimServiceToken: ServiceToken<ClaimService> =
  createServiceToken<ClaimService>('nocoproject/claim-service');
export const npRunTokenServiceToken: ServiceToken<RunTokenService> =
  createServiceToken<RunTokenService>('nocoproject/run-token-service');
export const npSweeperServiceToken: ServiceToken<SweeperService> =
  createServiceToken<SweeperService>('nocoproject/sweeper-service');
export const npWorkflowServiceToken: ServiceToken<WorkflowService> =
  createServiceToken<WorkflowService>('nocoproject/workflow-service');
export const npMemberServiceToken: ServiceToken<MemberService> =
  createServiceToken<MemberService>('nocoproject/member-service');
export const npLabelServiceToken: ServiceToken<LabelService> =
  createServiceToken<LabelService>('nocoproject/label-service');
export const npDependencyServiceToken: ServiceToken<DependencyService> =
  createServiceToken<DependencyService>('nocoproject/dependency-service');
export const npProposalServiceToken: ServiceToken<ProposalService> =
  createServiceToken<ProposalService>('nocoproject/proposal-service');
export const npAgentIssueServiceToken: ServiceToken<AgentIssueService> =
  createServiceToken<AgentIssueService>('nocoproject/agent-issue-service');
export const npInboxServiceToken: ServiceToken<InboxService> =
  createServiceToken<InboxService>('nocoproject/inbox-service');
export const npApprovalGatewayToken: ServiceToken<ApprovalGateway> =
  createServiceToken<ApprovalGateway>('nocoproject/approval-gateway');
export const npGitConnectionServiceToken: ServiceToken<GitConnectionService> =
  createServiceToken<GitConnectionService>(
    'nocoproject/git-connection-service',
  );
export const npPullRequestServiceToken: ServiceToken<PullRequestService> =
  createServiceToken<PullRequestService>('nocoproject/pull-request-service');
export const npWebhookServiceToken: ServiceToken<WebhookService> =
  createServiceToken<WebhookService>('nocoproject/webhook-service');
export const npIntakeServiceToken: ServiceToken<IntakeService> =
  createServiceToken<IntakeService>('nocoproject/intake-service');
export const npReactionServiceToken: ServiceToken<ReactionService> =
  createServiceToken<ReactionService>('nocoproject/reaction-service');
export const npAgentEnvServiceToken: ServiceToken<AgentEnvService> =
  createServiceToken<AgentEnvService>('nocoproject/agent-env-service');
export const npSkillServiceToken: ServiceToken<SkillService> =
  createServiceToken<SkillService>('nocoproject/skill-service');
export const npUsageServiceToken: ServiceToken<UsageService> =
  createServiceToken<UsageService>('nocoproject/usage-service');
export const npWorkspaceSettingsServiceToken: ServiceToken<WorkspaceSettingsService> =
  createServiceToken<WorkspaceSettingsService>(
    'nocoproject/workspace-settings-service',
  );

/** The settings item the members settings page declares (`settings:np-members`). */
export const NP_MEMBERS_SETTINGS_ID = 'np-members';
/** Iteration 2: workspace settings (`/settings/nocoproject`) and the GitHub connection page. */
export const NP_SETTINGS_SETTINGS_ID = 'np-settings';
export const NP_GITHUB_SETTINGS_ID = 'np-github';

/**
 * Titles are keys in the application's locale (`client/locales/en-US.ts` `navigation.*`, the same keys the settings
 * routes use), translated where they are shown (iteration 2 §K).
 */
const title = (key: string) => ({ key, ns: APP_NS });

/** Binds a module token to the member of `NpServices` it exposes. */
function bindModule<K extends keyof NpServices>(
  container: Application['container'],
  token: ServiceToken<NpServices[K]>,
  member: K,
): void {
  container.singleton(
    token,
    (resolver) => resolver.resolve(npServicesToken)[member],
  );
}

export default class NpProvider extends ServiceProvider<Application> {
  public readonly name: string = 'nocoproject/np';

  private cron: CronJobManager | undefined;
  private topics: NpRealtimeTopics | undefined;
  private sweeping = false;

  public override register(): void {
    const { container } = this.app;
    container.singleton(npServicesToken, (resolver) =>
      createNpServices({
        database: resolver.resolve(databaseManagerToken),
        idGenerator: resolver.resolve(idGeneratorToken),
        bus: createDomainEventBus((error) =>
          this.logError(error, 'NocoProject domain event listener failed.'),
        ),
        secrets: this.secretBox(),
        aiIntake: this.aiIntakeParser(),
        aiConfigured: () =>
          (this.app.config.get<AIApplicationConfig>('ai')?.llmServices
            ?.length ?? 0) > 0,
      }),
    );
    bindModule(container, npProjectServiceToken, 'projects');
    bindModule(container, npIssueServiceToken, 'issues');
    bindModule(container, npIssueQueriesToken, 'issueQueries');
    bindModule(container, npCommentServiceToken, 'comments');
    bindModule(container, npAgentServiceToken, 'agents');
    bindModule(container, npRuntimeServiceToken, 'runtimes');
    bindModule(container, npTriggerServiceToken, 'triggers');
    bindModule(container, npRunServiceToken, 'runs');
    bindModule(container, npRunRecoveryServiceToken, 'runRecovery');
    bindModule(container, npRunEventServiceToken, 'runEvents');
    bindModule(container, npRunQueriesToken, 'runQueries');
    bindModule(container, npClaimServiceToken, 'claims');
    bindModule(container, npRunTokenServiceToken, 'runTokens');
    bindModule(container, npSweeperServiceToken, 'sweeper');
    bindModule(container, npWorkflowServiceToken, 'workflows');
    bindModule(container, npMemberServiceToken, 'members');
    bindModule(container, npLabelServiceToken, 'labels');
    bindModule(container, npDependencyServiceToken, 'dependencies');
    bindModule(container, npProposalServiceToken, 'proposals');
    bindModule(container, npAgentIssueServiceToken, 'agentIssues');
    bindModule(container, npInboxServiceToken, 'inbox');
    bindModule(container, npApprovalGatewayToken, 'approvals');
    bindModule(container, npGitConnectionServiceToken, 'gitConnections');
    bindModule(container, npPullRequestServiceToken, 'pullRequests');
    bindModule(container, npWebhookServiceToken, 'webhooks');
    bindModule(container, npIntakeServiceToken, 'intake');
    bindModule(container, npReactionServiceToken, 'reactions');
    bindModule(container, npAgentEnvServiceToken, 'agentEnv');
    bindModule(container, npSkillServiceToken, 'skills');
    bindModule(container, npUsageServiceToken, 'usage');
    bindModule(container, npWorkspaceSettingsServiceToken, 'workspaceSettings');
  }

  /** The key for stored secrets (see `shared/crypto.ts`); warns once when it is derived from `auth.secret`. */
  private secretBox(): SecretBox {
    const config = this.app.config;
    return createSecretBox(
      resolveSecretKey(
        {
          secretKey: config.get<NocoProjectConfig>('nocoproject')?.secretKey,
          authSecret: config.get<AuthConfig>('auth')?.secret,
        },
        (message) => this.logWarning(message),
      ),
    );
  }

  /**
   * The AI intake parser over the AI employee plugin: a conversation owned by the member, then a fixed agent with no
   * tools, run as that member (no roles, not root). Null when the plugin is not registered.
   */
  private aiIntakeParser(): AiIntakeParser | null {
    const { container } = this.app;
    if (
      !container.has(agentServiceFactoryToken) ||
      !container.has(aiConversationsManagerToken)
    )
      return null;
    const logger = container.has(loggingToken)
      ? container.resolve(loggingToken).getLogger('nocoproject')
      : undefined;
    return createAiIntakeParser({
      createSession: async (userId, sessionTitle) =>
        (
          await container
            .resolve(aiConversationsManagerToken)
            .create({ userId, title: sessionTitle })
        ).sessionId,
      createAgent: async ({ sessionId, userId, systemPrompt }) => {
        const agent = await container
          .resolve(agentServiceFactoryToken)
          .createAgent({
            sessionId,
            systemPrompt,
            tools: [],
            actor: { id: userId, roles: [], isRoot: false },
            runtime: { logger: logger as never },
          });
        return {
          invoke: async (request) => await agent.invoke(request),
        };
      },
    });
  }

  public override async boot(): Promise<void> {
    const { container } = this.app;
    this.registerSettingsItem();
    if (!container.has(realtimeServiceToken)) return;
    this.topics = connectRealtime(
      container.resolve(realtimeServiceToken),
      container.resolve(npServicesToken).bus,
    );
  }

  /**
   * `settings:np-members` (contract §B): every member may open the page (granted by the seed); the members API
   * itself only lets owners and admins change roles. Re-registering an identical item is a no-op.
   */
  private registerSettingsItem(): void {
    const { container } = this.app;
    if (!container.has(authorizationToken)) return;
    const authz = container.resolve(authorizationToken);
    if (!authz.ui.sections.has('nocoproject'))
      authz.ui.sections.add({
        name: 'nocoproject',
        title: title('navigation.nocoproject'),
        parent: 'administration',
      });
    const items = [
      { id: NP_MEMBERS_SETTINGS_ID, key: 'navigation.members' },
      { id: NP_SETTINGS_SETTINGS_ID, key: 'navigation.nocoproject' },
      { id: NP_GITHUB_SETTINGS_ID, key: 'navigation.github' },
    ];
    for (const item of items) {
      authz.settings.add({
        id: item.id,
        title: title(item.key),
        actions: [{ name: 'read', title: 'Open' }],
      });
      authz.ui.place(
        { type: 'settings', id: item.id },
        { section: 'nocoproject' },
      );
    }
  }

  public override async start(): Promise<void> {
    this.cron = createCronJobManager();
    this.cron.addJob({
      cronTime: SWEEP_CRON_TIME,
      onTick: () => void this.sweep(),
    });
    this.cron.start();
  }

  public override async shutdown(): Promise<void> {
    this.cron?.close();
    this.cron = undefined;
    this.topics?.close();
    this.topics = undefined;
  }

  /** The cron tick: resolve the sweeper and run one pass, never overlapping a pass still in progress. */
  private async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const now = new Date();
      await this.app.container.resolve(npSweeperServiceToken).sweep(now);
      await this.app.container.resolve(npWebhookServiceToken).purge(now);
    } catch (error) {
      this.logError(error, 'NocoProject sweeper pass failed.');
    } finally {
      this.sweeping = false;
    }
  }

  private logWarning(message: string): void {
    const { container } = this.app;
    if (container.has(loggingToken)) {
      container.resolve(loggingToken).getLogger('nocoproject').warn(message);
      return;
    }
    console.warn(message);
  }

  private logError(error: unknown, message: string): void {
    const { container } = this.app;
    if (container.has(loggingToken)) {
      container
        .resolve(loggingToken)
        .getLogger('nocoproject')
        .error({ err: error }, message);
      return;
    }
    console.error(message, error);
  }
}
