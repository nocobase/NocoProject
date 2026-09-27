/**
 * NocoProject Phase 0 provider: binds every module service to its token, connects domain events to realtime topics,
 * and runs the run sweeper every 30 seconds.
 */
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
  }

  public override async boot(): Promise<void> {
    const { container } = this.app;
    if (!container.has(realtimeServiceToken)) return;
    this.topics = connectRealtime(
      container.resolve(realtimeServiceToken),
      container.resolve(npServicesToken).bus,
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
