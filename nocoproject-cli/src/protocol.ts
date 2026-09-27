/**
 * NocoProject 协议类型（Phase 0，protocolVersion 1）。
 *
 * 这是服务端、守护进程 / CLI、前端三方的共同契约。守护进程包里有一份同内容副本
 * （nocoproject-cli/src/protocol.ts）；改这里必须同步改那里，并更新 docs/phase0/protocol.md。
 */

export const PROTOCOL_VERSION = 1 as const;

// ---------- 状态目录 ----------

export type StatusCategory = 'unstarted' | 'started' | 'done' | 'closed';

export type BuiltInStatusKey =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'blocked'
  | 'done'
  | 'cancelled';

export interface StatusCatalogEntry {
  readonly key: string;
  readonly category: StatusCategory;
  readonly agentWritable: boolean;
}

export interface StatusTransition {
  readonly from: string;
  readonly to: string;
}

export type IssuePriority = 'urgent' | 'high' | 'medium' | 'low' | 'none';

export type ExecutorType = 'user' | 'agent' | 'none';

export type ActorType = 'user' | 'agent' | 'system';

// ---------- 运行 ----------

export type RunStatus =
  | 'queued'
  | 'deferred'
  | 'dispatched'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type PlatformFailureReason =
  | 'runtimeOffline'
  | 'queuedExpired'
  | 'runtimeRecovery'
  | 'environmentPrepareFailed'
  | 'cancelled'
  | 'timeout'
  | 'agentBlocked'
  | 'apiInvalidRequest';

export type AgentFailureReason =
  | 'agentError.providerAuth'
  | 'agentError.providerQuota'
  | 'agentError.providerRateLimit'
  | 'agentError.providerServerError'
  | 'agentError.providerNetwork'
  | 'agentError.modelUnavailable'
  | 'agentError.contextOverflow'
  | 'agentError.missingConfig'
  | 'agentError.missingExecutable'
  | 'agentError.versionUnsupported'
  | 'agentError.processFailure'
  | 'agentError.emptyOutput'
  | 'agentError.agentTimeout'
  | 'agentError.unknown';

export type FailureReason = PlatformFailureReason | AgentFailureReason;

export const RETRYABLE_FAILURE_REASONS: readonly FailureReason[] = [
  'runtimeOffline',
  'runtimeRecovery',
  'timeout',
  'agentError.providerNetwork',
];

export const SESSION_POISONING_FAILURE_REASONS: readonly FailureReason[] = [
  'agentError.contextOverflow',
  'apiInvalidRequest',
];

export type RunTriggerType =
  | 'assign'
  | 'statusChange'
  | 'mention'
  | 'reply'
  | 'comment'
  | 'retry';

export type RunEventType =
  | 'text'
  | 'thinking'
  | 'toolUse'
  | 'toolResult'
  | 'status'
  | 'error';

export interface RunEventInput {
  readonly seq: number;
  readonly type: RunEventType;
  readonly tool?: string;
  readonly content?: string;
  readonly input?: unknown;
  readonly output?: string;
  readonly truncated?: boolean;
  readonly at: string;
}

export interface RunUsageInput {
  readonly provider: string;
  readonly model?: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
}

// ---------- 守护进程接口 ----------

export type AgentProvider = 'claude' | 'opencode' | 'codex' | 'echo';

export interface RuntimeCapabilities {
  readonly resume: boolean;
  readonly steering: boolean;
}

export interface DaemonRegisterRequest {
  readonly daemonId: string;
  readonly deviceName: string;
  readonly version: string;
  readonly protocolVersion: number;
  readonly runtimes: readonly {
    readonly provider: AgentProvider;
    readonly version: string;
    readonly capabilities: RuntimeCapabilities;
  }[];
}

export interface DaemonRegisterResponse {
  readonly runtimes: readonly { readonly id: string; readonly provider: AgentProvider }[];
  readonly serverTime: string;
  readonly protocolVersion: number;
  readonly pollIntervalMs: number;
  readonly heartbeatIntervalMs: number;
}

export interface DaemonHeartbeatRequest {
  readonly daemonId: string;
  readonly runtimeIds: readonly string[];
}

export interface DaemonClaimRequest {
  readonly daemonId: string;
  readonly slots: readonly { readonly runtimeId: string; readonly free: number }[];
}

export interface ClaimedTriggerComment {
  readonly id: string;
  readonly authorName: string;
  readonly content: string;
  readonly parentId: string | null;
  readonly rootId: string;
}

export interface ClaimedRun {
  readonly run: {
    readonly id: string;
    readonly agentId: string;
    readonly runtimeId: string;
    readonly attempt: number;
    readonly priority: number;
    readonly createdAt: string;
  };
  readonly token: string;
  readonly agent: {
    readonly id: string;
    readonly name: string;
    readonly instructions: string;
    readonly provider: AgentProvider;
    readonly model: string | null;
  };
  readonly issue: {
    readonly id: string;
    readonly identifier: string;
    readonly title: string;
    readonly statusKey: string;
    readonly ownerName: string;
  };
  readonly statusCatalog: readonly StatusCatalogEntry[];
  readonly agentTransitions: readonly StatusTransition[];
  readonly triggers: readonly {
    readonly type: RunTriggerType;
    readonly comment?: ClaimedTriggerComment;
  }[];
  readonly session: {
    readonly providerSessionId: string | null;
    readonly workDir: string | null;
    readonly fresh: boolean;
  };
  readonly server: { readonly url: string; readonly protocolVersion: number };
  readonly leaseSeconds: number;
}

export interface DaemonClaimResponse {
  readonly runs: readonly ClaimedRun[];
}

export interface DaemonStartRequest {
  readonly providerSessionId?: string;
  readonly workDir: string;
}

export interface DaemonEventsRequest {
  readonly events: readonly RunEventInput[];
}

export interface DaemonRunStatusResponse {
  readonly status: RunStatus;
  readonly cancelRequested: boolean;
}

export interface DaemonCompleteRequest {
  readonly providerSessionId?: string;
  readonly workDir: string;
  readonly summary?: string;
  readonly usage?: RunUsageInput;
}

export interface DaemonFailRequest {
  readonly reason: FailureReason;
  readonly detail?: string;
  readonly providerSessionId?: string;
  readonly workDir?: string;
  readonly sessionPoisoned?: boolean;
}

/** 守护进程订阅的用户主题 `np:daemon` 上的载荷 */
export type DaemonWakeupPayload =
  | { readonly kind: 'workAvailable'; readonly runtimeId: string }
  | { readonly kind: 'cancelRequested'; readonly runId: string };

// ---------- Agent 回写接口 ----------

export interface IssueForAgent {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly description: string;
  readonly statusKey: string;
  readonly priority: IssuePriority;
  readonly ownerName: string;
  readonly executor: { readonly type: ExecutorType; readonly id: string | null; readonly name: string | null };
}

export interface CommentForAgent {
  readonly id: string;
  readonly authorType: ActorType;
  readonly authorName: string;
  readonly content: string;
  readonly parentId: string | null;
  readonly rootId: string;
  readonly createdAt: string;
}

export interface AgentContextResponse {
  readonly run: { readonly id: string };
  readonly agent: { readonly id: string; readonly name: string };
  readonly issue: IssueForAgent;
  readonly statusCatalog: readonly StatusCatalogEntry[];
  readonly agentTransitions: readonly StatusTransition[];
}

// ---------- 浏览器实时主题 ----------

export const REALTIME_TOPICS = {
  issues: 'np:issues',
  agents: 'np:agents',
  daemon: 'np:daemon',
  run: (runId: string): string => `np:run:${runId}`,
} as const;

export type IssuesTopicPayload = { readonly kind: 'issue.changed'; readonly issueId: string };
export type AgentsTopicPayload = { readonly kind: 'agents.changed' };
export type RunTopicPayload =
  | { readonly kind: 'run.events'; readonly last: number }
  | { readonly kind: 'run.status'; readonly status: RunStatus };

// ---------- 运行令牌 ----------

export const RUN_TOKEN_PREFIX = 'npr_' as const;
export const RUN_TOKEN_TTL_SECONDS = 24 * 60 * 60;
export const CLAIM_LEASE_SECONDS = 45;
export const RUNTIME_OFFLINE_AFTER_SECONDS = 150;
export const DISPATCHED_TIMEOUT_SECONDS = 300;
export const RUNTIME_RECONNECT_GRACE_SECONDS = 3 * 60 * 60;

/** CLI 在这些环境变量存在时自动以运行令牌模式工作 */
export const RUN_ENV = {
  serverUrl: 'NOCOPROJECT_SERVER_URL',
  token: 'NOCOPROJECT_TOKEN',
  runId: 'NOCOPROJECT_RUN_ID',
  agentId: 'NOCOPROJECT_AGENT_ID',
  issueId: 'NOCOPROJECT_ISSUE_ID',
  issueKey: 'NOCOPROJECT_ISSUE_KEY',
} as const;
