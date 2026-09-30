import type { AgentEntryBindings } from './agent-capabilities.js';
/**
 * Browser-side types for Phase 1 iteration 2 (`docs/phase1/iteration-2-contract.md` §C–§K, §M).
 *
 * Copied from the contract rather than imported from `server/modules/shared/protocol.phase1-iter2.ts`, for the same
 * reason as `types.ts`: the client tsconfig must not reach into `server/`. Fields the contract states only in prose
 * are optional, and the normalizers in `api-iter2.ts` accept the plausible envelopes.
 */
import type { ActorType } from './types.js';
import type { MetricThresholds } from './types-iter3.js';
import type { SignalKindInfo, SignalRules } from './types-signals.js';
import type { WorkspaceSettingsPhase1Iter4 } from './types-iter4.js';

export type ExecutionMode = 'task' | 'session';

// ---------- §C GitHub ----------

export interface GitConnectionView {
  readonly configured: boolean;
  readonly apiBaseUrl: string;
  readonly tokenSet: boolean;
  readonly webhookSecretSet: boolean;
  readonly webhookUrl: string;
  readonly lastEventAt: string | null;
}

/** `PUT /np/integrations/github`: a missing field keeps its value, an empty string clears it. */
export interface GitConnectionInput {
  readonly apiBaseUrl?: string;
  readonly token?: string;
  readonly webhookSecret?: string;
}

export interface GitConnectionTestResult {
  readonly ok: boolean;
  readonly login?: string | null;
  readonly scopes?: readonly string[] | string | null;
}

export type PullRequestState = 'open' | 'closed' | 'merged';
export type CiState = 'pending' | 'success' | 'failure';

export interface PullRequest {
  readonly id: string;
  readonly connectionId?: string | null;
  readonly repo: string;
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly state: PullRequestState;
  readonly draft: boolean;
  readonly headRef?: string | null;
  readonly baseRef?: string | null;
  readonly headSha?: string | null;
  readonly authorLogin?: string | null;
  readonly additions?: number | null;
  readonly deletions?: number | null;
  readonly changedFiles?: number | null;
  readonly mergeableState?: string | null;
  readonly ciState?: CiState | null;
  readonly mergedAt?: string | null;
  readonly closedAt?: string | null;
  readonly snapshotAt?: string | null;
}

/** A PR linked to an issue: the PR plus who linked it and the auto-complete opt-out. */
export interface IssuePullRequestView extends PullRequest {
  /** Who linked it (the server's shape); `linkedByType` / `linkedByName` are read as a flat fallback. */
  readonly linkedBy?: {
    readonly type: ActorType;
    readonly id: string | null;
    readonly name: string | null;
  } | null;
  readonly linkedByType?: ActorType;
  readonly linkedByName?: string | null;
  readonly autoCompleteDisabled: boolean;
  readonly linkedAt?: string | null;
  /** NP-85: whether the viewer may merge (issue owner, project lead, owner/admin); absent on older servers = no. */
  readonly viewerCanMerge?: boolean;
  /** NP-85: the head commit's latest Actions run and its `screenshots` artifact. */
  readonly ciRunUrl?: string | null;
  readonly screenshotsUrl?: string | null;
}

/** What a PR card shows as its state badge; a draft is only a draft while open. */
export type PullRequestBadgeState = 'open' | 'draft' | 'merged' | 'closed';

// ---------- §D approvals ----------

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type ApproverRole = 'owner' | 'projectLead' | 'admin';

export interface ApprovalRequest {
  readonly id: string;
  readonly issueId: string;
  readonly issueIdentifier?: string | null;
  readonly issueTitle?: string | null;
  readonly fromStatus: string;
  readonly toStatus: string;
  readonly requestedByType: 'user' | 'agent';
  readonly requestedById: string;
  readonly requestedByName?: string | null;
  readonly requestedRunId?: string | null;
  readonly approverUserIds: readonly string[];
  readonly approverNames?: readonly string[] | null;
  readonly status: ApprovalStatus;
  readonly decidedById?: string | null;
  readonly decidedByName?: string | null;
  readonly decidedAt?: string | null;
  readonly comment?: string | null;
  readonly createdAt: string;
}

// ---------- §F reactions ----------

export const REACTION_EMOJIS = [
  '👍',
  '👀',
  '🎉',
  '❤️',
  '🚀',
  '😄',
  '🤔',
  '👎',
] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export interface CommentReaction {
  readonly emoji: string;
  readonly count: number;
  readonly userIds: readonly string[];
}

// ---------- §G environment variables ----------

export interface AgentEnvVarView {
  readonly name: string;
  readonly updatedAt: string | null;
  readonly updatedByName: string | null;
}

export interface AgentEnvVarValue {
  readonly name: string;
  readonly value: string;
}

export type AgentEnvAuditAction = 'reveal' | 'set' | 'delete';

export interface AgentEnvAudit {
  readonly id: string;
  readonly agentId: string;
  readonly userId: string;
  readonly userName?: string | null;
  readonly action: AgentEnvAuditAction;
  readonly names: readonly string[];
  readonly createdAt: string;
}

// ---------- §H skills ----------

export interface Skill {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly content?: string;
  readonly source?: 'manual' | 'import';
  readonly createdById?: string | null;
  readonly createdByName?: string | null;
  readonly canEdit?: boolean;
  readonly fileCount?: number;
  readonly agentCount?: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface SkillFile {
  readonly id?: string;
  readonly path: string;
  readonly content: string;
}

/** An agent the skill is mounted on, visible to every member. */
export interface SkillAgentRef {
  readonly id: string;
  readonly name: string;
}

export interface SkillDetail {
  readonly skill: Skill;
  readonly files: readonly SkillFile[];
  readonly agents: readonly SkillAgentRef[];
}

export interface SkillInput {
  readonly name?: string;
  readonly description?: string | null;
  readonly content?: string;
}

// ---------- §I usage and settings ----------

export type UsageGroupBy =
  'agent' | 'issue' | 'project' | 'day' | 'model' | 'actor' | 'conversation';

export interface UsageRow {
  readonly key: string;
  readonly name: string | null;
  readonly runs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly estimatedCost: number | null;
  /** Totals only: how many runs had a price. */
  readonly pricedRuns?: number;
}

export interface UsageResponse {
  readonly rows: readonly UsageRow[];
  readonly totals: UsageRow;
}

export interface UsageQuery {
  readonly from: string;
  readonly to: string;
  readonly groupBy: UsageGroupBy;
  readonly projectId?: string;
  readonly agentId?: string;
  readonly issueId?: string;
}

export interface ModelPrice {
  readonly provider: string;
  readonly model: string;
  readonly inputPerM: number;
  readonly outputPerM: number;
  readonly cacheReadPerM: number;
  readonly cacheWritePerM: number;
}

/** `GET /np/settings`. Only the fields the settings page edits are typed; the rest is carried through untouched. */
export interface WorkspaceSettings {
  readonly agentEntries?: AgentEntryBindings;
  readonly prMergedStatus?: string;
  readonly autoExecuteSubtasksDefault?: boolean;
  readonly modelPrices?: readonly ModelPrice[];
  readonly issuePrefix?: string;
  /** Iteration 3 §C: the targets the acceptance metrics are held to. */
  readonly metricThresholds?: MetricThresholds;
  // Iteration 4 §A: the default process, the project manager agent and the retrospective switch.
  readonly defaultProcess?: WorkspaceSettingsPhase1Iter4['defaultProcess'];
  readonly pmAgentId?: WorkspaceSettingsPhase1Iter4['pmAgentId'];
  readonly retrospectiveOnDone?: WorkspaceSettingsPhase1Iter4['retrospectiveOnDone'];
  /** Phase 2 signals: which kinds wake the executor agent, and the kinds the server can report. */
  readonly signalRules?: SignalRules;
  readonly signalKinds?: readonly SignalKindInfo[];
  /** Whether the viewer may change the settings (owner/admin). */
  readonly canEdit?: boolean;
  readonly [key: string]: unknown;
}

export type WorkspaceSettingsInput = Partial<
  Pick<
    WorkspaceSettings,
    | 'prMergedStatus'
    | 'autoExecuteSubtasksDefault'
    | 'modelPrices'
    | 'metricThresholds'
    | 'defaultProcess'
    | 'agentEntries'
    | 'pmAgentId'
    | 'retrospectiveOnDone'
    | 'signalRules'
  >
>;

// ---------- §J session mode ----------

export interface QueuedRun {
  readonly id: string;
  readonly triggerCount: number;
}
