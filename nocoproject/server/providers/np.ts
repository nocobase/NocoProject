/**
 * NocoProject provider: binds every module service to its token, connects domain events to realtime topics, registers
 * the `np-members` settings item with the authorization plugin, and runs the run sweeper every 30 seconds.
 *
 * Page grants for the NocoProject pages (and `read` on `np-members`) are given to the default `member` permission set
 * once, by the seed `2026092800003_np_member_page_grants`, so administrators can still edit them.
 */
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import { idGeneratorToken } from '@nocobase/app-server/id-generator';
import { loggingToken } from '@nocobase/app-server/logging';
import { realtimeServiceToken } from '@nocobase/app-server/realtime';
import { createCronJobManager, type CronJobManager } from '@nocobase/cron';
import { databaseManagerToken } from '@nocobase/db';
import {
  createServiceToken,
  ServiceProvider,
  type ServiceToken,
} from '@nocobase/service-provider';

import type { AgentService } from '../modules/agent/agent.service.js';
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

/** The settings item the members settings page declares (`settings:np-members`). */
export const NP_MEMBERS_SETTINGS_ID = 'np-members';

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
        title: 'NocoProject',
        parent: 'administration',
      });
    authz.settings.add({
      id: NP_MEMBERS_SETTINGS_ID,
      title: 'Members',
      actions: [{ name: 'read', title: 'Open' }],
    });
    authz.ui.place(
      { type: 'settings', id: NP_MEMBERS_SETTINGS_ID },
      { section: 'nocoproject' },
    );
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
      await this.app.container.resolve(npSweeperServiceToken).sweep(new Date());
    } catch (error) {
      this.logError(error, 'NocoProject sweeper pass failed.');
    } finally {
      this.sweeping = false;
    }
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
