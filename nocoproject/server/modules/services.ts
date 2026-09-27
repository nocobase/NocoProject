/**
 * Wires every NocoProject module service from its dependencies.
 *
 * The provider (`server/providers/np.ts`) binds these to container tokens; tests build them directly against a real
 * database. Cross-module references that would form a cycle (issue → trigger → run → trigger for retries) are
 * resolved lazily through the `services` object. The transaction runner hands every transaction's domain events to
 * the notification module before commit (`shared/db.ts`).
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
  createLabelService,
  type LabelService,
} from './label/label.service.js';
import {
  createMemberService,
  type MemberService,
} from './member/member.service.js';
import {
  createInboxService,
  type InboxService,
} from './notification/inbox.service.js';
import {
  createNotificationService,
  type NotificationService,
} from './notification/notification.service.js';
import {
  createAgentIssueService,
  type AgentIssueService,
} from './subtask/agent-issue.service.js';
import {
  createDependencyService,
  type DependencyService,
} from './subtask/dependency.service.js';
import {
  createProposalService,
  type ProposalService,
} from './subtask/proposal.service.js';
import {
  createWorkflowService,
  type WorkflowService,
} from './workflow/workflow.service.js';
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
  readonly workflows: WorkflowService;
  readonly members: MemberService;
  readonly labels: LabelService;
  readonly dependencies: DependencyService;
  readonly proposals: ProposalService;
  readonly agentIssues: AgentIssueService;
  readonly inbox: InboxService;
  readonly notifications: NotificationService;
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
  // Filled in below; the lazy getters are only called at request time, after construction completes.
  const services = {} as { -readonly [K in keyof NpServices]: NpServices[K] };

  const bus = deps.bus ?? createDomainEventBus();
  const tx = createTxRunner(deps.database, bus, (unit, events) =>
    services.notifications.process(unit, events),
  );
  const ids = createIdSource(deps.idGenerator);
  const users = createUserDirectory();
  const activity = createActivityRecorder(ids);
  const settings = createSettingsService();
  const workflows = createWorkflowService({ tx });

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
    workflows,
    members: createMemberService({ tx, ids }),
    labels: createLabelService({ tx, ids }),
    dependencies: createDependencyService({
      tx,
      ids,
      activity,
      triggers: () => services.triggers,
    }),
    proposals: createProposalService({
      tx,
      ids,
      activity,
      issues: () => services.issues,
    }),
    agentIssues: createAgentIssueService({
      tx,
      ids,
      activity,
      workflows,
      issues: () => services.issues,
      queries: () => services.issueQueries,
      triggers: () => services.triggers,
    }),
    inbox: createInboxService({ tx, ids }),
    notifications: createNotificationService({ ids, users, workflows }),
    projects: createProjectService({ tx, ids, users, activity, workflows }),
    issues: createIssueService({
      tx,
      ids,
      users,
      activity,
      settings,
      workflows,
      triggers: () => services.triggers,
    }),
    issueQueries: createIssueQueries({
      tx,
      users,
      workflows,
      comments: () => services.comments,
    }),
    comments: createCommentService({
      tx,
      ids,
      users,
      activity,
      triggers: () => services.triggers,
    }),
    agents: createAgentService({ tx, ids, users }),
    runtimes: createRuntimeService({ tx, ids, users }),
    triggers: createTriggerService({
      runs: () => services.runs,
      workflows,
      activity,
    }),
    runs: createRunService({ tx, ids }),
    runRecovery: createRunRecoveryService({
      ...failureDeps,
      manualRetry: (unit, run, actor) =>
        services.triggers.manualRetry(unit, run, actor),
    }),
    runEvents: createRunEventService({ tx, ids }),
    runQueries: createRunQueries({ tx }),
    claims: createClaimService({ tx, ids, users, workflows }),
    runTokens: createRunTokenService({ tx }),
    sweeper: createSweeperService(failureDeps),
  } satisfies NpServices);

  return services;
}
