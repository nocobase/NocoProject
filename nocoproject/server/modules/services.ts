/**
 * Wires every NocoProject module service from its dependencies.
 *
 * The provider (`server/providers/np.ts`) binds these to container tokens; tests build them directly against a real
 * database. Cross-module references that would form a cycle (issue → trigger → run → trigger for retries) are
 * resolved lazily through the `services` object. The transaction runner hands every transaction's domain events,
 * before commit (`shared/db.ts`), first to the approval gate (a status that moved cancels stale requests) and then to
 * the notification module.
 *
 * Iteration 2 adds the injectable edges tests replace: the secret box, the GitHub client, the AI intake parser and
 * the approval gateway (the "替换检查清单" test runs the suite with an in-memory gateway). Iteration 3 adds the
 * knowledge base, the acceptance metrics and the delivery decisions (`createIteration3Services`).
 */
import type { DatabaseManager } from '@nocobase/db';
import type { IdGeneratorService } from '@nocobase/snowflake';

import {
  createAgentService,
  type AgentService,
} from './agent/agent.service.js';
import {
  createAgentEnvService,
  type AgentEnvService,
} from './agent/env.service.js';
import { createDbApprovalGateway } from './approval/approval.gateway.js';
import {
  createReactionService,
  type ReactionService,
} from './collaboration/reaction.service.js';
import {
  createGitConnectionService,
  type GitConnectionService,
} from './git/connection.service.js';
import {
  createFetchGitHubClient,
  type GitHubClient,
} from './git/github-client.js';
import {
  createPullRequestService,
  type PullRequestService,
} from './git/pull-request.service.js';
import {
  createWebhookService,
  type WebhookService,
} from './git/webhook.service.js';
import type { AiIntakeParser } from './intake/ai-parser.js';
import { createHeuristicIntakeParser } from './intake/heuristic-parser.js';
import {
  createIntakeService,
  type IntakeService,
} from './intake/intake.service.js';
import {
  createDeliveryService,
  type DeliveryService,
} from './issue/delivery.service.js';
import { findIssue } from './issue/issue.records.js';
import {
  createKnowledgeService,
  type KnowledgeService,
} from './knowledge/knowledge.service.js';
import {
  createMetricsService,
  type MetricsService,
} from './metrics/metrics.service.js';
import type { ApprovalGateway, ApprovalHooks } from './shared/approval.js';
import { resolveApproverIds } from './shared/authz.js';
import {
  createSecretBox,
  resolveSecretKey,
  type SecretBox,
} from './shared/crypto.js';
import type { Tx } from './shared/db.js';
import type { DomainEvent } from './shared/events.js';
import {
  createSkillService,
  type SkillService,
} from './skill/skill.service.js';
import {
  createWorkspaceSettingsService,
  type WorkspaceSettingsService,
} from './system/settings.admin.js';
import {
  createUsageService,
  type UsageService,
} from './usage/usage.service.js';
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
  // Iteration 2.
  readonly approvals: ApprovalGateway;
  readonly gitConnections: GitConnectionService;
  readonly pullRequests: PullRequestService;
  readonly webhooks: WebhookService;
  readonly intake: IntakeService;
  readonly reactions: ReactionService;
  readonly agentEnv: AgentEnvService;
  readonly skills: SkillService;
  readonly usage: UsageService;
  readonly workspaceSettings: WorkspaceSettingsService;
  // Iteration 3.
  readonly knowledge: KnowledgeService;
  readonly metrics: MetricsService;
  readonly deliveries: DeliveryService;
}

/** What an alternative approval gateway gets to build itself (tests: the in-memory double). */
export interface ApprovalGatewayContext {
  readonly tx: TxRunner;
  readonly hooks: () => ApprovalHooks;
}

export interface NpServiceDeps {
  readonly database: DatabaseManager;
  readonly idGenerator: IdGeneratorService;
  readonly bus?: DomainEventBus;
  /** Defaults to a random process-local key (tests); the provider passes the configured one. */
  readonly secrets?: SecretBox;
  /** Defaults to the fetch-based client. */
  readonly github?: GitHubClient;
  /** The AI intake parser; null or absent = heuristic only. */
  readonly aiIntake?: AiIntakeParser | null;
  /** Whether an LLM service is configured (`ai.llmServices` not empty). */
  readonly aiConfigured?: () => boolean;
  /** Replaces the database approval gateway (the replacement checklist test). */
  readonly approvalGateway?: (
    context: ApprovalGatewayContext,
  ) => ApprovalGateway;
}

/** A status that moved (or became terminal) cancels the issue's stale approval requests. */
async function cancelStaleApprovals(
  services: NpServices,
  tx: Tx,
  events: readonly DomainEvent[],
): Promise<void> {
  for (const event of events) {
    if (event.type !== 'issue.updated' || !event.changes.status) continue;
    const issue = await findIssue(tx.conn, event.issueId);
    if (!issue) continue;
    const view = await services.workflows.forIssue(tx.conn, issue);
    await services.approvals.cancelStale(
      tx,
      issue.id,
      issue.statusKey,
      view.isTerminal(issue.statusKey),
    );
  }
}

/** What the approval gateway calls back into (applying an approved transition, resolving approvers). */
function approvalHooksOf(services: NpServices): ApprovalHooks {
  return {
    applyTransition: (unit, request, approver) =>
      services.issues.applyApprovedTransition(unit, request, approver),
    resolveApprovers: (unit, issue, roles) =>
      resolveApproverIds(unit.conn, issue, roles),
  };
}

export function createNpServices(deps: NpServiceDeps): NpServices {
  // Filled in below; the lazy getters are only called at request time, after construction completes.
  const services = {} as { -readonly [K in keyof NpServices]: NpServices[K] };

  const bus = deps.bus ?? createDomainEventBus();
  const tx = createTxRunner(deps.database, bus, async (unit, events) => {
    await cancelStaleApprovals(services, unit, events);
    await services.notifications.process(unit, events);
  });
  const secrets = deps.secrets ?? createSecretBox(resolveSecretKey({}));
  const github = deps.github ?? createFetchGitHubClient();
  const approvalHooks = () => approvalHooksOf(services);
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
      approvals: () => services.approvals,
    }),
    issueQueries: createIssueQueries({
      tx,
      users,
      workflows,
      settings,
      comments: () => services.comments,
      approvals: () => services.approvals,
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
    claims: createClaimService({
      tx,
      ids,
      users,
      workflows,
      secrets,
      knowledge: () => services.knowledge,
    }),
    runTokens: createRunTokenService({ tx }),
    sweeper: createSweeperService(failureDeps),
    ...createIteration2Services(
      { deps, tx, ids, users, activity, settings, workflows, secrets, github },
      services,
      approvalHooks,
    ),
    ...createIteration3Services(
      { tx, ids, users, activity, settings, workflows },
      services,
    ),
  } satisfies NpServices);

  return services;
}

interface Iteration2Inputs {
  readonly deps: NpServiceDeps;
  readonly tx: TxRunner;
  readonly ids: ReturnType<typeof createIdSource>;
  readonly users: ReturnType<typeof createUserDirectory>;
  readonly activity: ReturnType<typeof createActivityRecorder>;
  readonly settings: SettingsService;
  readonly workflows: WorkflowService;
  readonly secrets: SecretBox;
  readonly github: GitHubClient;
}

/** The iteration 2 modules (git, approval, intake, reactions, env, skills, usage, workspace settings). */
function createIteration2Services(
  input: Iteration2Inputs,
  services: NpServices,
  hooks: () => ApprovalHooks,
) {
  const {
    deps,
    tx,
    ids,
    users,
    activity,
    settings,
    workflows,
    secrets,
    github,
  } = input;
  const flow = { activity, settings, workflows, issues: () => services.issues };
  return {
    approvals: deps.approvalGateway
      ? deps.approvalGateway({ tx, hooks })
      : createDbApprovalGateway({ tx, ids, users, activity, hooks }),
    gitConnections: createGitConnectionService({ tx, ids, secrets, github }),
    pullRequests: createPullRequestService({
      tx,
      ids,
      users,
      activity,
      secrets,
      github,
    }),
    webhooks: createWebhookService({ ...flow, tx, ids, secrets }),
    intake: createIntakeService({
      tx,
      ids,
      users,
      activity,
      settings,
      workflows,
      issues: () => services.issues,
      triggers: () => services.triggers,
      heuristic: createHeuristicIntakeParser(),
      ai: deps.aiIntake ?? null,
      aiConfigured: deps.aiConfigured ?? (() => false),
    }),
    reactions: createReactionService({ tx, ids, activity }),
    agentEnv: createAgentEnvService({ tx, ids, users, secrets }),
    skills: createSkillService({ tx, ids, users }),
    usage: createUsageService({ tx, settings }),
    workspaceSettings: createWorkspaceSettingsService({
      tx,
      settings,
      workflows,
    }),
  };
}

/** The iteration 3 modules (knowledge, acceptance metrics, delivery decisions). */
function createIteration3Services(
  input: Omit<Iteration2Inputs, 'deps' | 'secrets' | 'github'>,
  services: NpServices,
) {
  const { tx, ids, users, activity, settings, workflows } = input;
  return {
    knowledge: createKnowledgeService({ tx, ids, users, activity }),
    metrics: createMetricsService({
      tx,
      settings,
      workflows,
      usage: () => services.usage,
    }),
    deliveries: createDeliveryService({
      tx,
      activity,
      workflows,
      issues: () => services.issues,
      comments: () => services.comments,
    }),
  };
}
