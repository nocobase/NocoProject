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
  'assign' | 'statusChange' | 'mention' | 'reply' | 'comment' | 'retry';

export type RunEventType =
  'text' | 'thinking' | 'toolUse' | 'toolResult' | 'status' | 'error';

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
  readonly runtimes: readonly {
    readonly id: string;
    readonly provider: AgentProvider;
  }[];
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
  readonly slots: readonly {
    readonly runtimeId: string;
    readonly free: number;
  }[];
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
  readonly executor: {
    readonly type: ExecutorType;
    readonly id: string | null;
    readonly name: string | null;
  };
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

export type IssuesTopicPayload = {
  readonly kind: 'issue.changed';
  readonly issueId: string;
};
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

// ---------- 界面接口（浏览器，protocol.md 第 3 节） ----------
//
// 服务端 Phase 0 实现时补充的响应形状（只增不改）。守护进程不使用这些类型。

export type AgentAccess = 'ownerOnly' | 'everyone';
export type RuntimeKind = 'personal' | 'server';
export type RuntimeVisibility = 'private' | 'public';
export type RuntimeStatus = 'online' | 'offline';
export type CommentKind = 'comment' | 'system';

/** 失败响应体：`{ code, message }` 与相应 HTTP 状态码 */
export interface ApiErrorBody {
  readonly code: string;
  readonly message: string;
}

export interface MeResponse {
  readonly userId: string;
  readonly name: string;
}

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ExecutorInput {
  readonly type: ExecutorType;
  readonly id?: string | null;
}

export interface Issue {
  readonly id: string;
  readonly number: number;
  readonly identifier: string;
  readonly title: string;
  readonly description: string;
  readonly statusKey: string;
  readonly priority: IssuePriority;
  readonly ownerUserId: string | null;
  readonly executorType: ExecutorType;
  readonly executorId: string | null;
  readonly parentIssueId: string | null;
  readonly projectId: string | null;
  readonly revision: number;
  readonly lastActivityAt: string;
  readonly createdById: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IssueListItem extends Issue {
  readonly ownerName: string | null;
  readonly executorName: string | null;
  /** dispatched | running 的运行数 */
  readonly activeRunCount: number;
}

export interface Comment {
  readonly id: string;
  readonly issueId: string;
  readonly authorType: ActorType;
  readonly authorId: string | null;
  readonly authorName: string;
  readonly content: string;
  readonly kind: CommentKind;
  readonly parentId: string | null;
  /** 线程根评论 id（顶层评论为自身 id） */
  readonly rootId: string;
  readonly sourceRunId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** @temporary(nocobase-official): 待替换为 NocoBase 官方 活动流与变更事件 */
export interface Activity {
  readonly id: string;
  readonly issueId: string;
  readonly actorType: ActorType;
  readonly actorId: string | null;
  readonly actorName: string;
  readonly action: string;
  readonly details: Readonly<Record<string, unknown>> | null;
  readonly createdAt: string;
}

export interface RunSummary {
  readonly id: string;
  readonly agentId: string;
  readonly agentName: string;
  /** 第一条触发的类型 */
  readonly triggerType: RunTriggerType | null;
  readonly status: RunStatus;
  readonly attempt: number;
  readonly threadScope: string | null;
  readonly failureReason: string | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export interface IssueDetail {
  readonly issue: IssueListItem;
  /** 扁平列表，按 createdAt 升序；线程由 parentId / rootId 组织 */
  readonly comments: readonly Comment[];
  readonly activities: readonly Activity[];
  readonly runs: readonly RunSummary[];
  readonly statusCatalog: readonly StatusCatalogEntry[];
}

export interface CreateIssueRequest {
  readonly title: string;
  readonly description?: string;
  readonly priority?: IssuePriority;
  readonly projectId?: string | null;
  /** 默认当前用户 */
  readonly ownerUserId?: string | null;
  readonly executor?: ExecutorInput;
  /** 默认 todo（服务端补充的可选字段） */
  readonly statusKey?: string;
}

export interface UpdateIssueRequest {
  readonly title?: string;
  readonly description?: string;
  readonly statusKey?: string;
  readonly priority?: IssuePriority;
  readonly ownerUserId?: string | null;
  readonly executor?: ExecutorInput;
  readonly revision: number;
}

export interface CreateCommentRequest {
  readonly content: string;
  readonly parentId?: string | null;
}

export interface TriggeredRun {
  readonly agentId: string;
  readonly runId: string;
}

export interface CreateCommentResponse {
  readonly comment: Comment;
  readonly triggered: readonly TriggeredRun[];
}

export interface Agent {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly ownerUserId: string;
  readonly instructions: string;
  readonly runtimeId: string | null;
  readonly provider: AgentProvider;
  readonly model: string | null;
  readonly maxConcurrentRuns: number;
  readonly access: AgentAccess;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentListItem extends Agent {
  readonly runtimeName: string | null;
  readonly runtimeOnline: boolean;
  /** dispatched | running 的运行数 */
  readonly activeRunCount: number;
}

export interface CreateAgentRequest {
  readonly name: string;
  readonly description?: string | null;
  readonly instructions: string;
  readonly runtimeId: string;
  readonly provider: AgentProvider;
  readonly model?: string | null;
  readonly maxConcurrentRuns?: number;
  readonly access?: AgentAccess;
}

export interface UpdateAgentRequest {
  readonly name?: string;
  readonly description?: string | null;
  readonly instructions?: string;
  readonly runtimeId?: string;
  readonly provider?: AgentProvider;
  readonly model?: string | null;
  readonly maxConcurrentRuns?: number;
  readonly access?: AgentAccess;
  /** true 归档，false 取消归档 */
  readonly archived?: boolean;
}

export interface Runtime {
  readonly id: string;
  readonly daemonId: string;
  readonly provider: AgentProvider;
  readonly name: string;
  readonly kind: RuntimeKind;
  readonly ownerUserId: string;
  readonly ownerName: string | null;
  readonly visibility: RuntimeVisibility;
  readonly status: RuntimeStatus;
  /** status === 'online' 且 lastSeenAt 在 150 秒内 */
  readonly online: boolean;
  readonly lastSeenAt: string | null;
  readonly version: string | null;
  readonly capabilities: RuntimeCapabilities | null;
  readonly deviceInfo: Readonly<Record<string, unknown>> | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Run {
  readonly id: string;
  readonly agentId: string;
  readonly runtimeId: string | null;
  readonly kind: 'issue';
  readonly status: RunStatus;
  readonly priority: number;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly retryOfRunId: string | null;
  readonly subjectType: 'issue';
  readonly subjectId: string;
  readonly threadScope: string | null;
  readonly actorUserId: string | null;
  readonly ownerUserId: string | null;
  readonly fireAt: string | null;
  readonly leaseExpiresAt: string | null;
  readonly dispatchedAt: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly failureReason: FailureReason | null;
  readonly failureDetail: string | null;
  readonly cancelRequestedAt: string | null;
  readonly cancelledById: string | null;
  readonly resultSummary: string | null;
  readonly providerSessionId: string | null;
  readonly workDir: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RunTriggerItem {
  readonly id: string;
  readonly type: RunTriggerType;
  readonly commentId: string | null;
  readonly payload: Readonly<Record<string, unknown>> | null;
  readonly createdById: string | null;
  readonly createdAt: string;
}

export interface RunDetail extends Run {
  readonly agentName: string;
  readonly triggers: readonly RunTriggerItem[];
  readonly usage: readonly RunUsageInput[];
}

export interface RunEvent {
  readonly id: string;
  readonly runId: string;
  readonly seq: number;
  readonly type: RunEventType;
  readonly tool: string | null;
  readonly content: string | null;
  readonly input: unknown;
  readonly output: string | null;
  readonly truncated: boolean;
  readonly at: string;
}

/** GET /np/runs/:id/events 的完整响应体（`last` 与 `data` 同级） */
export interface RunEventsResponse {
  readonly data: readonly RunEvent[];
  readonly last: number;
}

/** POST /np/daemon/runs/:id/events 的响应 */
export interface DaemonEventsResponse {
  readonly accepted: number;
  readonly last: number;
}

/** 每批事件上限与单条正文上限（超出截断并 truncated=true） */
export const RUN_EVENTS_MAX_BATCH = 200;
export const RUN_EVENT_MAX_CONTENT_BYTES = 64 * 1024;
