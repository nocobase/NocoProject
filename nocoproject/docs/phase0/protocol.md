# NocoProject 协议（Phase 0 版）

本文档是服务端、守护进程 / CLI、前端三方的共同契约。类型定义见 `server/modules/shared/protocol.ts`（守护进程包中有一份同内容的副本 `nocoproject-cli/src/protocol.ts`）。

所有接口挂在应用 `/api` 下，路径前缀 `np`（例如 `<APP_BASE_PATH>/api/np/issues`）。JSON 请求与响应；成功返回 `{ data: ... }`，失败返回 `{ code: 'SOME_CODE', message: '...' }` 与相应状态码。ID 是字符串（NocoBase 雪花 ID）。时间是 ISO 8601 字符串。

## 0. 身份与认证

| 调用方 | 凭据 | 服务端解析 |
|---|---|---|
| 浏览器 | 登录会话 Cookie | `auth.required()` |
| 守护进程 | NocoBase API Key（`x-api-key`），Phase 0 用运行时所有者自己的 Key | `auth.required()`，`ownerUserId` = Key 所有者 |
| Agent（在运行中的编码工具进程里通过 CLI 调用） | 运行令牌 `npr_<40 hex>`，`Authorization: Bearer npr_...` | 自建中间件：查 `runTokens.hash`，未过期、未吊销、运行未终态；解析出 `{ runId, agentId, actorUserId, issueId }` |

运行令牌在认领成功时签发，只对该运行有效，运行终态后失效，最长 24 小时。

## 1. 领域对象（Phase 0 字段）

```
Issue        id, number, identifier("NP-12"), title, description(markdown), statusKey, priority,
             ownerUserId, executorType('user'|'agent'|'none'), executorId, parentIssueId, projectId,
             revision, lastActivityAt, createdById, createdAt, updatedAt
Comment      id, issueId, authorType('user'|'agent'|'system'), authorId, content(markdown), kind('comment'|'system'),
             parentId, rootId(线程根评论 id，顶层评论为自身), sourceRunId, createdAt, updatedAt
Activity     id, issueId, actorType, actorId, action, details, createdAt            @temporary
Agent        id, name, description, ownerUserId, instructions, runtimeId, provider, model,
             maxConcurrentRuns(默认 6), access('ownerOnly'|'everyone'), archivedAt, createdAt, updatedAt
Runtime      id, daemonId, provider, name, kind('personal'|'server'), ownerUserId, visibility('private'|'public'),
             status('online'|'offline'), lastSeenAt, version(注册时上报的工具版本), capabilities(json), deviceInfo(json),
             createdAt, updatedAt
Run          id, agentId, runtimeId, kind('issue'), status, priority, attempt, maxAttempts, retryOfRunId,
             subjectType('issue'), subjectId, threadScope, actorUserId, ownerUserId, fireAt(deferred 的触发时间),
             leaseExpiresAt, dispatchedAt, startedAt, finishedAt, failureReason, failureDetail,
             cancelRequestedAt, cancelledById, resultSummary, providerSessionId, workDir, createdAt, updatedAt
RunTrigger   id, runId, type, commentId, payload, createdById, createdAt
RunSession   id, agentId, runtimeId, subjectType, subjectId, providerSessionId, workDir, poisoned, lastRunId
RunEvent     id, runId, seq, type, tool, content, input(json), output, truncated, at
RunUsage     id, runId, provider, model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens
RunToken     id, hash, runId, agentId, actorUserId, expiresAt, revokedAt, createdAt
Project      id, name, description, createdAt, updatedAt
SystemSettings  单行：issuePrefix('NP'), issueCounter
```

### 1.1 状态目录（Phase 0 固定）

| key | category |
|---|---|
| backlog | unstarted |
| todo | unstarted |
| in_progress | started |
| in_review | started |
| blocked | started |
| done | done |
| cancelled | closed |

Agent 允许写的转换（服务端强制）：`todo|blocked → in_progress`、`in_progress → in_review`、`in_progress → blocked`。人可以写任意转换。

### 1.2 运行状态

`queued → dispatched → running → completed | failed | cancelled`；`deferred`（等待 `fireAt`）→ `queued`。

失败原因码：平台侧 `runtimeOffline | queuedExpired | runtimeRecovery | environmentPrepareFailed | cancelled | timeout | agentBlocked | apiInvalidRequest`；工具侧 `agentError.providerAuth | providerQuota | providerRateLimit | providerServerError | providerNetwork | modelUnavailable | contextOverflow | missingConfig | missingExecutable | versionUnsupported | processFailure | emptyOutput | agentTimeout | unknown`。

可自动重试：`runtimeOffline | runtimeRecovery | timeout | agentError.providerNetwork`。默认 `maxAttempts = 2`，`providerNetwork` 为 3。会话污染（`contextOverflow | apiInvalidRequest`）时重试强制新会话（`runSessions.poisoned = true`）。

## 2. 触发规则（Phase 0 子集）

`trigger` 模块是唯一创建运行的地方。

| 动作 | 结果 |
|---|---|
| 人把执行者设为 Agent，且任务状态不是 backlog/done/cancelled | 入队，`threadScope = null`，trigger.type = `assign` |
| 人把任务从 backlog 移到其他非终态，且执行者是 Agent | 入队，trigger.type = `statusChange` |
| 人发评论并 @Agent（`[@Name](mention://agent/<id>)`） | 每个被 @ 的 Agent 各一次入队，`threadScope = 线程根评论 id`，type = `mention` |
| 人回复 Agent 的评论（无显式 @） | 路由给该评论（直接父评论）的 Agent，`threadScope = 线程根评论 id`，type = `reply` |
| 人发顶层评论（无 @），执行者是 Agent | 路由给执行者，`threadScope = null`（与 assign 同一轮合并），type = `comment` |
| 评论以 `/note` 开头 | 不触发 |
| Agent 的评论 | 永不触发（其中的 @ 只是文本） |
| 运行失败且原因可重试 | 新建运行，`retryOfRunId`，`attempt + 1`，沿用原运行的触发（评论）并追加 type = `retry` |
| 界面点"重试"（运行已终态） | 新建运行（`attempt = 1`），`retryOfRunId`，type = `retry`，`payload.manual = true` |

已归档的 Agent 不会被入队（@ 已归档 Agent 只是文本）。

**合并**：入队时若已存在同 `(agentId, subjectType, subjectId, threadScope)` 的 `queued|deferred|dispatched` 运行，则不新建，只追加一条 `runTriggers` 到该运行（触发评论汇集到同一轮）。若存在 `running` 的运行，则新建一条 `queued` 运行，它会等前一条结束后才被认领（认领条件排除同 Agent 同任务已有活动运行）。

每次运行记录 `actorUserId`（触发的人）与 `ownerUserId`（任务负责人）。

## 3. 界面接口（浏览器，会话认证）

```
GET    /np/me                                  → { data: { userId, name } }
GET    /np/projects                            → { data: Project[] }
POST   /np/projects        { name, description }
GET    /np/issues?statusKey=&projectId=&q=     → { data: IssueListItem[] }（含 owner/executor 名称、活动运行数）
POST   /np/issues          { title, description?, priority?, projectId?, ownerUserId?（默认自己）, executor?: { type, id } }
GET    /np/issues/:id                          → { data: IssueDetail }（issue + comments(扁平) + activities + runs(摘要) + statusCatalog）
PATCH  /np/issues/:id      { title?, description?, statusKey?, priority?, ownerUserId?, executor?, revision }
                                               → 409 REVISION_CONFLICT 当 revision 不匹配
POST   /np/issues/:id/comments  { content, parentId? }   → { data: { comment, triggered: [{ agentId, runId }] } }
GET    /np/agents                              → { data: Agent[] }（含运行时在线状态、活动运行数）
POST   /np/agents          { name, description?, instructions, runtimeId, provider, model?, maxConcurrentRuns?, access? }
PATCH  /np/agents/:id
GET    /np/runtimes                            → { data: Runtime[] }
GET    /np/runs/:id                            → { data: Run }（含 triggers）
GET    /np/runs/:id/events?since=<seq>         → { data: RunEvent[], last: seq }
POST   /np/runs/:id/cancel
POST   /np/runs/:id/retry                      → { data: Run }（新运行）
```

### 3.1 响应形状（权威，类型见 `protocol.ts` 的"界面接口"一节）

`:id` 处的任务既可以是 id，也可以是编号（`NP-12`，不区分大小写）。

| 接口 | 成功 | 说明 |
|---|---|---|
| `GET /np/me` | 200 `{ data: { userId, name } }` | `name` 为空时回退为邮箱 |
| `GET /np/projects` / `POST` | 200 `{ data: Project[] }` / 201 `{ data: Project }` | |
| `GET /np/issues` | 200 `{ data: IssueListItem[] }` | 每行 = `Issue` + `ownerName`、`executorName`（无则 null）、`activeRunCount`（该任务 dispatched\|running 的运行数）；按 `lastActivityAt` 倒序，最多 500；`q` 匹配标题或编号（PostgreSQL 上区分大小写） |
| `POST /np/issues` | 201 `{ data: Issue }` | 界面不传 `ownerUserId` 时负责人 = 调用者；可选 `statusKey`（默认 `todo`）；带 Agent 执行者且状态不是 backlog/done/cancelled 时立即触发 assign |
| `GET /np/issues/:id` | 200 `{ data: { issue, comments, activities, runs, statusCatalog } }` | `issue` 同列表行；`comments` 为扁平数组（按 createdAt 升序，每条带 `authorName`、`parentId`、`rootId`，前端自行组线程）；`activities` 每条带 `actorName`、`action`、`details`；`runs` 最近 50 条摘要，每条带 `agentName`、`triggerType`（第一条触发的类型）、`status`、`attempt`、`threadScope`、`failureReason`、`createdAt/startedAt/finishedAt` |
| `PATCH /np/issues/:id` | 200 `{ data: Issue }` | 必须带 `revision`；不匹配 → 409 `{ code: 'REVISION_CONFLICT' }`；没有实际变化时原样返回、不加 revision |
| `POST /np/issues/:id/comments` | 201 `{ data: { comment, triggered: [{ agentId, runId }] } }` | `triggered` 里的 runId 可能是被合并进的已有运行 |
| `GET /np/agents` | 200 `{ data: AgentListItem[] }` | `Agent` + `runtimeName`、`runtimeOnline`（boolean）、`activeRunCount`（dispatched\|running） |
| `POST /np/agents` / `PATCH /np/agents/:id` | 201 / 200 `{ data: Agent }` | `provider` 必须与运行时的 provider 一致（否则 400 `PROVIDER_MISMATCH`）；PATCH 可带 `archived: boolean` |
| `GET /np/runtimes` | 200 `{ data: Runtime[] }` | `Runtime` + `ownerName`、顶层 `version`、`online`（status=online 且 150 秒内有心跳） |
| `GET /np/runs/:id` | 200 `{ data: RunDetail }` | `Run` + `agentName`、`triggers`、`usage` |
| `GET /np/runs/:id/events` | 200 `{ data: RunEvent[], last }` | 首次请求不带 `since`；`since` 为已有的最大 seq；每次最多 1000 条；无新事件时 `last = since`（首次为 -1） |
| `POST /np/runs/:id/cancel` | 200 `{ data: Run }` | queued/deferred 直接 cancelled；dispatched/running 置 `cancelRequestedAt` 并唤醒守护进程，等 cancel-ack |
| `POST /np/runs/:id/retry` | 201 `{ data: Run }` | 仅终态运行，否则 409 `RUN_STATE_CONFLICT` |

活动 `action` 取值：`issue_created`、`title_changed`、`description_changed`、`status_changed`、`priority_changed`、`owner_changed`、`executor_changed`、`comment_added`。状态、优先级、负责人的 `details` 为 `{ from, to }`；执行者为 `{ from: { type, id }, to: { type, id } }`；Agent 写入的活动 `details.runId` 为运行 id；运行失败导致的 in_progress→todo 回退由 `system` 写入，`details.reason = 'runFailed'`。

错误码（状态码）：`UNAUTHORIZED`(401)、`RUN_TOKEN_FORBIDDEN`(403)、`NOT_FOUND`(404)、`INVALID_JSON` 及各字段的 `INVALID_*`(400)、`REVISION_CONFLICT`(409)、`RUN_STATE_CONFLICT`(409)、`INTERNAL_ERROR`(500)。以 Cookie 会话发起的写请求还要经过认证插件的 Origin 校验（浏览器自动满足；否则 403 `INVALID_CSRF_ORIGIN`）。

## 4. 守护进程接口（`x-api-key`）

```
POST /np/daemon/register
     { daemonId, deviceName, version, runtimes: [{ provider, version, capabilities: { resume: bool, steering: bool } }] }
  →  { data: { runtimes: [{ id, provider }], serverTime, protocolVersion: 1, pollIntervalMs: 15000, heartbeatIntervalMs: 15000 } }
     同 (daemonId, provider) 重复注册返回原 id 并更新版本与能力；ownerUserId = Key 所有者；kind 默认 personal。

POST /np/daemon/heartbeat   { daemonId, runtimeIds: string[] }        → { data: { ok: true } }
POST /np/daemon/deregister  { daemonId }                               → 运行时置 offline

POST /np/daemon/runs/claim  { daemonId, slots: [{ runtimeId, free: number }] }
  →  { data: { runs: ClaimedRun[] } }
     ClaimedRun = {
       run: { id, agentId, runtimeId, attempt, priority, createdAt },
       token: 'npr_...',                       // 运行令牌，只在这里返回一次
       agent: { id, name, instructions, provider, model },
       issue: { id, identifier, title, statusKey, ownerName },   // 正文不内联，让 Agent 用 CLI 拉
       statusCatalog: [{ key, category, agentWritable: bool }],
       agentTransitions: [{ from, to }],
       triggers: [{ type, comment?: { id, authorName, content, parentId, rootId } }],   // 触发评论原文内联
       session: { providerSessionId?, workDir?, fresh: bool },   // 上次会话；fresh=true 表示不要续接
       server: { url, protocolVersion: 1 },
       leaseSeconds: 45
     }
     认领 SQL（PostgreSQL）：一个事务内
       UPDATE runs SET status='dispatched', dispatched_at=now(), lease_expires_at=now()+45s, runtime_id=$rt
       WHERE id = (SELECT r.id FROM runs r JOIN agents a ON a.id=r.agent_id
                   WHERE r.status='queued' AND a.runtime_id=$rt AND a.archived_at IS NULL
                     AND NOT EXISTS (SELECT 1 FROM runs x WHERE x.agent_id=r.agent_id AND x.subject_type=r.subject_type
                                     AND x.subject_id=r.subject_id AND x.status IN ('dispatched','running'))
                     AND (SELECT count(*) FROM runs y WHERE y.agent_id=r.agent_id AND y.status IN ('dispatched','running')) < a.max_concurrent_runs
                   ORDER BY r.priority DESC, r.created_at ASC, r.id ASC
                   FOR UPDATE OF r SKIP LOCKED LIMIT 1)
       RETURNING *
     每个 free 槽位执行一次直到没有行返回。NocoBase 查询构建器没有 FOR UPDATE SKIP LOCKED，用 `await connection.client()` 拿 Knex 在事务内执行 raw SQL。
     令牌在同一事务内写入 runTokens（只存 hash）。

POST /np/daemon/runs/:id/lease                 → 续租 45 秒（仅 dispatched）；请求体 `{}`；返回 { data: Run }
POST /np/daemon/runs/:id/start  { providerSessionId?, workDir }   → dispatched → running
POST /np/daemon/runs/:id/events { events: [{ seq, type, tool?, content?, input?, output?, truncated?, at }] }
     type ∈ text | thinking | toolUse | toolResult | status | error；seq 单调递增，重复 seq 幂等忽略；每批 ≤ 200 条，正文每条 ≤ 64KB（超出截断并 truncated=true）
GET  /np/daemon/runs/:id/status                → { data: { status, cancelRequested: bool } }
POST /np/daemon/runs/:id/complete { providerSessionId?, workDir, summary?, usage?: { provider, model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } }
POST /np/daemon/runs/:id/fail     { reason, detail?, providerSessionId?, workDir?, sessionPoisoned?: bool }
     服务端据 reason 决定是否自动重试；失败且任务 in_progress 且无其他活动运行且无待重试 → 任务回到 todo。
POST /np/daemon/runs/:id/cancel-ack            → 守护进程确认已杀进程；运行置 cancelled
```

以上 `runs/:id/*` 只接受该运行所在运行时的守护进程（Key 所有者 = runtime.ownerUserId），否则 403 `RUN_NOT_OWNED`；运行不存在 404。

守护进程接口的约定（服务端 Phase 0 实现）：

- `register` 带 `protocolVersion`；与服务端不同时 426 `{ code: 'PROTOCOL_MISMATCH' }`。同一 `daemonId` 已被别的用户注册时 403 `RUNTIME_NOT_OWNED`。
- `heartbeat` 或 `runs/claim` 里出现服务端不认识的运行时（不存在，或不属于这个 `daemonId`）→ 404 `{ code: 'RUNTIME_NOT_FOUND' }`，守护进程据此重新注册；运行时属于别的用户 → 403 `RUNTIME_NOT_OWNED`。`deregister` 对未知 daemonId 返回 200。
- 认领同时视为该运行时的心跳（`lastSeenAt` 刷新、置 online）。每个槽位单次最多认领 32 条。认领只在 PostgreSQL 上可用（其他方言 400 `UNSUPPORTED_DIALECT`）。
- 认领在协议 SQL 之前先取 `pg_advisory_xact_lock(hashtext('np:claim:' || runtimeId))`：只靠 `SKIP LOCKED`，两个并发认领可能各锁住同一 Agent 的不同排队运行，彼此看不到对方未提交的 dispatched，从而突破"同 Agent 同任务只有一个活动运行"和 `max_concurrent_runs`。Agent 的运行只会被它自己的运行时认领，所以按运行时串行化即可，不同运行时之间仍然并行。
- 合并进 `dispatched` 运行的新触发不会出现在已经发出的认领载荷里（Agent 用 `comment list` 补读）。
- 租约过期被清扫器重新排队的运行，其旧运行令牌立即吊销；再次认领签发新令牌。
- `lease`/`start`/`complete`/`fail`/`cancel-ack` 与运行当前状态不符时 409 `RUN_STATE_CONFLICT`；`start` 对已 running、`complete` 对已 completed、`fail` 对已 failed、`cancel-ack` 对已 cancelled 幂等返回。这些接口都返回 `{ data: Run }`；`status` 返回 `{ data: { status, cancelRequested } }`。
- `events` 返回 `{ data: { accepted, last } }`（`accepted` 为本批新写入条数，`last` 为该运行已存储的最大 seq）；超过 200 条整批拒绝 400 `BATCH_TOO_LARGE`；`content` 和 `output` 各自超过 64KB（UTF-8 字节）截断并置 `truncated = true`。
- `fail.reason` 不在失败原因码表里时按 `agentError.unknown` 记录。守护进程使用的码：空闲看门狗 `agentError.agentTimeout`，守护进程关闭时中断的运行 `runtimeRecovery`（可重试），找不到工具可执行文件 `agentError.missingExecutable`。
- `ClaimedRun.server.url` 由请求来源 + `APP_BASE_PATH` 组成，守护进程可忽略，使用自己配置的地址（`nocoproject login --server <origin + APP_BASE_PATH>`，不含 `/api`）。

### 4.1 唤醒与轮询

守护进程用同一个 API Key 连接 `<APP_BASE_PATH>/ws`（请求头带 `x-api-key`，不带 Origin 或 Origin 与服务端同源），订阅用户主题 `np:daemon`。已在运行中的开发服务器上用 `ws` 客户端实测：有效 Key → `subscribed`；无 Key 或无效 Key → `{ type: 'error', code: 'AUTHENTICATION_REQUIRED' }`（连接本身仍会建立，守护进程据此回退为只轮询）。服务端在以下时刻 `publishFor(runtime.ownerUserId, payload)`：

```
{ kind: 'workAvailable', runtimeId }         入队后
{ kind: 'cancelRequested', runId }           界面点停止后
```

守护进程收到 `workAvailable` 立即认领；无论是否收到，每 `pollIntervalMs` 轮询认领一次。心跳每 15 秒一次 HTTP。

### 4.2 服务端清扫器（每 30 秒）

- 运行时 `lastSeenAt` 早于 150 秒 → `offline`。
- `dispatched` 且 `leaseExpiresAt` 已过 → 回到 `queued`（重新投递），`attempt` 不变。
- `dispatched` 超过 5 分钟 → `failed(runtimeRecovery)` 并按重试规则处理。
- `running` 且运行时离线超过 3 小时 → `failed(runtimeOffline)`。
- `deferred` 且 `fireAt` 已到 → `queued`。
- `queued` 且运行时已被删除 → `failed(queuedExpired)`。"运行时已删除"按 Agent 当前的 `runtimeId` 判断（认领 SQL 也按它 JOIN）。

执行顺序：离线判定 → dispatched 超 5 分钟 → 租约过期重排 → running 孤儿 → deferred 到期 → queued 过期。5 分钟规则先于租约规则：一直续租却始终没 start 的运行是准备失败，而不是认领丢失。每一步都是带状态条件的更新，与守护进程的调用并发也不会写坏状态。

## 5. Agent 回写接口（运行令牌）

```
GET  /np/agent/context                          → { data: { run: { id }, agent: { id, name }, issue: IssueForAgent, statusCatalog, agentTransitions } }
GET  /np/agent/issues/:id                       → { data: IssueForAgent }（identifier, title, description, statusKey, priority, ownerName, executor）
GET  /np/agent/issues/:id/comments?since=<iso>&rootsOnly=&thread=<id>&tail=<n>
POST /np/agent/issues/:id/comments  { content, parentId? }   → 作者 = 该运行的 Agent，sourceRunId = 运行；不触发任何 Agent
POST /np/agent/issues/:id/status    { statusKey }            → 只允许 agentTransitions；否则 403 TRANSITION_NOT_ALLOWED
```

任何以运行令牌访问界面接口或守护进程接口的请求返回 403（`RUN_TOKEN_FORBIDDEN`，在会话校验之前判定）。

补充约定（服务端 Phase 0 实现）：

- 令牌缺失、未知、过期、吊销或运行已终态 → 401 `{ code: 'INVALID_RUN_TOKEN' }`。会话 Cookie 和 API Key 在这里不被接受。
- `:id` 可以是 id 或编号（`NP-12`，不区分大小写）。读接口可以读任何任务；写接口（`comments`、`status`）只允许写该运行的任务，否则 403 `ISSUE_NOT_IN_RUN`。
- `comments` 查询参数：`since`（ISO 时间，只返回之后创建的）、`rootsOnly=true`（也接受 `1`）、`thread=<根评论 id>`、`tail=<n>`（结果的最后 n 条）；返回 `{ data: CommentForAgent[] }`，按 createdAt 升序。
- `POST comments` 返回 201 `{ data: Comment }`；`POST status` 返回 `{ data: Issue }`，状态已是目标值时原样返回。

## 6. 实时主题（浏览器）

| 主题 | audience | 载荷 | 含义 |
|---|---|---|---|
| `np:issues` | public | `{ kind: 'issue.changed', issueId }` | 任务、评论、活动、运行摘要有变化，客户端重新拉取 |
| `np:run:<runId>` | public | `{ kind: 'run.events', last: seq }` 或 `{ kind: 'run.status', status }` | 运行有新事件或状态变化 |
| `np:agents` | public | `{ kind: 'agents.changed' }` | Agent 或运行时状态变化 |
| `np:daemon` | user | 见 4.1 | 守护进程唤醒 |

事件只是失效信号，HTTP 为准。`np:run:<runId>` 不注册（一个运行一个主题），未注册主题按 public 处理。同一事务产生的重复信号在同一个 microtask 内合并；信号在事务提交之后才发出。

## 7. 简报与每轮提示（守护进程生成）

**简报**写入工作目录的 `CLAUDE.md`（claude）或 `AGENTS.md`（opencode、codex、echo），标记块：

```
<!-- BEGIN NOCOPROJECT-RUNTIME (auto-managed; do not edit) -->
# NocoProject Agent Runtime
## Background Task Safety      本轮结束即终止；不要后台挂起；不要 watch CI；不要杀 nocoproject 守护进程
## Agent Identity              名称、ID、instructions 原文
## Available Commands          nocoproject issue get <id> --json / comment list / comment add --content-file / status <key>
## Workflow                    1 读任务 2 补读评论 3 开始产出即 status in_progress 4 用 comment add 交付到 --parent 5 交付后 in_review；卡住 blocked 并留言；只答疑不改状态
## Status Rules                只列 agentTransitions
## Output                      永远用 --content-file，文件放在工作目录里
<!-- END NOCOPROJECT-RUNTIME -->
```

标记块之外的内容不动；再次运行时原地替换标记块。

**每轮提示**（作为工具的用户消息）：

```
You are working on issue NP-12 "标题".
Run: <runId>. Read the issue first: `nocoproject issue get NP-12 --json`
Then catch up on comments: `nocoproject issue comment list NP-12 --json`
[NEW COMMENT] from <人名> (reply with --parent <rootId>):
> 触发评论原文
Session: <fresh | resumed>.
When done, deliver via `nocoproject issue comment add NP-12 --content-file ./reply.md --parent <rootId>`.
```

环境变量注入：`NOCOPROJECT_SERVER_URL`、`NOCOPROJECT_TOKEN`（运行令牌）、`NOCOPROJECT_RUN_ID`、`NOCOPROJECT_AGENT_ID`、`NOCOPROJECT_ISSUE_ID`、`NOCOPROJECT_ISSUE_KEY`。CLI 在这些变量存在时自动以运行令牌模式工作。

## 8. 适配器接口（守护进程内部）

```ts
interface AgentAdapter {
  readonly provider: 'claude' | 'opencode' | 'codex' | 'echo';
  detect(): Promise<{ version: string; path: string } | null>;
  capabilities(): { resume: boolean; steering: boolean; briefFile: 'CLAUDE.md' | 'AGENTS.md' };
  start(spec: RunSpec, io: RunIO): Promise<RunHandle>;
}
interface RunSpec { runId; workDir; prompt; env: Record<string,string>; model?: string; resumeSessionId?: string }
interface RunHandle { events: AsyncIterable<AgentEvent>; kill(): Promise<void>; result: Promise<RunResult> }
type AgentEvent = { type: 'text'|'thinking'|'toolUse'|'toolResult'|'status'|'error'; ... ; at: string }
interface RunResult { exitCode; sessionId?; usage?; errorText?; classifiedFailure?: FailureReason }
```

Claude Code 启动命令（与 Multica 一致）：
`claude -p <prompt> --output-format stream-json --input-format stream-json --verbose --permission-mode bypassPermissions [--model m] [--resume <sessionId>]`

OpenCode 启动命令：`opencode run --format json [--session <id>] [--model m] <prompt>`（守护进程子任务负责核实当前版本的实际参数与输出格式）。

Echo 适配器：一个 Node 脚本模拟工具：读 prompt，调用 `nocoproject issue get`、`status in_progress`、`comment add`、`status in_review`，输出几条 JSON 事件。用于自动化端到端测试。

## 9. 版本

`protocolVersion = 1`。守护进程注册时上报自己的协议版本；不匹配时服务端返回 `426 PROTOCOL_MISMATCH`，守护进程停止认领并在日志和运行时页提示升级。
