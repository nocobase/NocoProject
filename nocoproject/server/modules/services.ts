/**
 * Wires every NocoProject module service from its dependencies.
 *
 * The provider (`server/providers/np.ts`) binds these to container tokens; tests build them directly against a real
 * database. Cross-module references that would form a cycle (issue → trigger → run → trigger for retries) are
 * resolved lazily through the `services` object.
 */
import type { DatabaseManager } from '@nocobase/db';
import type { IdGeneratorService } from '@nocobase/snowflake';

import {
  createAgentService,
  type AgentService,
} from './agent/agent.service.js';
import {
  createCommentService,
  type CommentService,
} from './collaboration/comment.service.js';
import {
  createIssueQueries,
  type IssueQueries,
} from './issue/issue.queries.js';
import {
  createIssueService,
  type IssueService,
} from './issue/issue.service.js';
import {
  createProjectService,
  type ProjectService,
} from './project/project.service.js';
import { createClaimService, type ClaimService } from './run/claim.service.js';
import {
  createRunRecoveryService,
  type FailureDeps,
  type RunRecoveryService,
} from './run/failure.js';
import {
  createRunEventService,
  type RunEventService,
} from './run/run-events.js';
import { createRunQueries, type RunQueries } from './run/run.queries.js';
import { createRunService, type RunService } from './run/run.service.js';
import { createSweeperService, type SweeperService } from './run/sweeper.js';
import { createRunTokenService, type RunTokenService } from './run/token.js';
import {
  createRuntimeService,
  type RuntimeService,
} from './runtime/runtime.service.js';
import { createActivityRecorder } from './shared/activity.js';
import { createTxRunner, type TxRunner } from './shared/db.js';
import { createDomainEventBus, type DomainEventBus } from './shared/events.js';
import { createIdSource } from './shared/ids.js';
import { createUserDirectory } from './shared/users.js';
import {
  createSettingsService,
  type SettingsService,
} from './system/settings.service.js';
import {
  createTriggerService,
  type TriggerService,
} from './trigger/trigger.service.js';

export interface NpServices {
  readonly bus: DomainEventBus;
  readonly tx: TxRunner;
  readonly settings: SettingsService;
  readonly projects: ProjectService;
  readonly issues: IssueService;
  readonly issueQueries: IssueQueries;
  readonly comments: CommentService;
  readonly agents: AgentService;
  readonly runtimes: RuntimeService;
  readonly triggers: TriggerService;
  readonly runs: RunService;
  readonly runRecovery: RunRecoveryService;
  readonly runEvents: RunEventService;
  readonly runQueries: RunQueries;
  readonly claims: ClaimService;
  readonly runTokens: RunTokenService;
  readonly sweeper: SweeperService;
}

export interface NpServiceDeps {
  readonly database: DatabaseManager;
  readonly idGenerator: IdGeneratorService;
  readonly bus?: DomainEventBus;
}

export function createNpServices(deps: NpServiceDeps): NpServices {
  const bus = deps.bus ?? createDomainEventBus();
  const tx = createTxRunner(deps.database, bus);
  const ids = createIdSource(deps.idGenerator);
  const users = createUserDirectory();
  const activity = createActivityRecorder(ids);
  const settings = createSettingsService();

  // Filled in below; the lazy getters are only called at request time, after construction completes.
  const services = {} as { -readonly [K in keyof NpServices]: NpServices[K] };

  const failureDeps: FailureDeps = {
    tx,
    ids,
    collaborators: () => ({
      scheduleRetry: (unit, failed, maxAttempts, reason) =>
        services.triggers.retryFailedRun(unit, failed, maxAttempts, reason),
      resetAbandonedIssue: (unit, issueId) =>
        services.issues.resetAbandonedIssue(unit, issueId),
    }),
  };

  Object.assign(services, {
    bus,
    tx,
    settings,
    projects: createProjectService({ tx, ids }),
    issues: createIssueService({
      tx,
      ids,
      users,
      activity,
      settings,
      triggers: () => services.triggers,
    }),
    issueQueries: createIssueQueries({
      tx,
      users,
      comments: () => services.comments,
    }),
    comments: createCommentService({
      tx,
      ids,
      users,
      activity,
      triggers: () => services.triggers,
    }),
    agents: createAgentService({ tx, ids }),
    runtimes: createRuntimeService({ tx, ids, users }),
    triggers: createTriggerService({ runs: () => services.runs }),
    runs: createRunService({ tx, ids }),
    runRecovery: createRunRecoveryService({
      ...failureDeps,
      manualRetry: (unit, run, actor) =>
        services.triggers.manualRetry(unit, run, actor),
    }),
    runEvents: createRunEventService({ tx, ids }),
    runQueries: createRunQueries({ tx }),
    claims: createClaimService({ tx, ids, users }),
    runTokens: createRunTokenService({ tx }),
    sweeper: createSweeperService(failureDeps),
  } satisfies NpServices);

  return services;
}
