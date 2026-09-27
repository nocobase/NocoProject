# NocoProject 协议：Phase 1 迭代 2（服务端实现，权威）

> 在 `docs/phase0/protocol.md`、`docs/phase1/protocol-iteration-1.md` 之上追加；契约见 `iteration-2-contract.md`。本文记录服务端实际实现的请求 / 响应形状和与契约的出入。类型：契约类型在 `server/modules/shared/protocol.phase1-iter2.ts`（CLI 复制这一份），依赖迭代 1 服务端补充形状的组合类型（`IssueV2`、`IssueDetailV2`、`AgentListItemV2` 等）在 `protocol.phase1-iter2-server.ts`（CLI 不复制）；两者都由 `protocol.ts` 末尾 `export *`。路径前缀仍是 `/api/np`，成功 `{ data }`，失败 `{ code, message }`。

## 1. 通用约定

- 新的浏览器前缀 `/np/{integrations,approvals,intake,comments,skills,usage,settings}` 与已有前缀同一个守卫：运行令牌 403 → `auth.required()` 401 → `ensureMember`。
- 新错误类型：上游（GitHub）失败 502 `GITHUB_REQUEST_FAILED`；GitHub 拒绝令牌 409 `GITHUB_AUTH_FAILED`；GitHub 找不到 PR 404 `GITHUB_NOT_FOUND`。
- 软删除：`issues.deletedAt`（只有批量录入撤回会写）。被软删除的任务在所有查找、列表、计数、阻塞判定里都不存在（404）。
- 任务行（`IssueV2` = `IssueV1` + `executionMode: 'task' | 'session'`、`originType: 'manual' | 'intake' | 'agent'`、`originId`）。`originId`：intake → 批次 id；agent → 创建它的运行 id；迁移给迭代 1 的 Agent 子任务回填 `originType = 'agent'`（`originId` 为空）。
- 收件箱：`payload` 总是带 `identifier`、`issueTitle`；各类型追加字段见 §9。`GET /np/inbox` 的项类型为 `InboxItemV2`（`type` 含迭代 2 的四种）。

## 2. 加密与配置

- `shared/crypto.ts`：AES-256-GCM，密文 `v1:<iv b64>:<tag b64>:<data b64>`。
- 密钥：配置段 `nocoproject.secretKey`（环境变量 `NOCOPROJECT_SECRET_KEY`，64 位 hex 或 32 字节 base64；新增 `server/config/nocoproject.ts`）；未设置时用 `sha256(auth.secret + ':nocoproject')` 派生，并在服务构建时 warn 一次。非法密钥启动时报错。
- 接口永不回显 GitHub 令牌、webhook secret；环境变量只在 `reveal` 与认领载荷里出现明文。

## 3. GitHub 集成

### 3.1 连接（owner/admin，其余 403）

| 接口                                                                  | 成功                                                                                                                                                |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /np/integrations/github`                                         | `GitConnectionView = { configured, apiBaseUrl, tokenSet, webhookSecretSet, webhookUrl, lastEventAt }`（`configured` = 已设置令牌）                  |
| `PUT /np/integrations/github { apiBaseUrl?, token?, webhookSecret? }` | `GitConnectionView`；字段缺省不变，空串清除（`apiBaseUrl` 空串 = 默认 `https://api.github.com`）；`apiBaseUrl` 须为 http(s)，否则 400 `INVALID_URL` |
| `POST /np/integrations/github/test`                                   | `{ ok: true, login, scopes }`；无令牌 409 `GITHUB_NOT_CONFIGURED`                                                                                   |

`webhookUrl` = `${app.publicOrigin || 请求 origin}${publicBasePath}/np/webhooks/github`（开发机为 `http://127.0.0.1:13001/main/np/webhooks/github`）。

### 3.2 Webhook（根路由，公开）

`POST /np/webhooks/github`（实际地址带部署基路径，如 `/main/np/webhooks/github`；不在 `/api` 下）。

| 情况                                                                                             | 响应                                                                                                      |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| 未配置 secret、缺签名、签名不符（`X-Hub-Signature-256`，原始 body 的 HMAC-SHA256，常量时间比较） | 401 `INVALID_SIGNATURE`                                                                                   |
| 缺 `X-GitHub-Delivery`                                                                           | 400 `MISSING_DELIVERY`                                                                                    |
| 重复投递                                                                                         | 200 `{ data: { duplicate: true } }`，不做任何处理                                                         |
| 其他                                                                                             | 200 `{ data: { ok: true, event, ignored } }`（`ping` → `ignored: false`；不处理的事件 → `ignored: true`） |

投递记录与处理在同一事务：处理失败时记录回滚，GitHub 重投会再处理。`webhookDeliveries` 保留 7 天，由 Provider 的清扫定时任务删除。

事件：`pull_request`（opened / edited / synchronize / reopened / ready_for_review / converted_to_draft / closed）→ upsert PR、按关联规则关联；首次变为 merged → 合并流程；首次变为 closed（未合并）→ 解决 `pr_review`；open 且非 draft：`opened` / `reopened` / `ready_for_review` 对所有关联任务、其他动作只对本次新关联的任务发 `pr_review`。`check_suite`（completed）按 `head_sha` 写 `ciState`（success / neutral / skipped → success，其余结论 → failure）；`status` 按 `sha` 写（pending / success；failure / error → failure）。

关联规则（`git/link-rules.ts`，纯函数）：与契约相同；编号前缀取 `systemSettings.issuePrefix`，结果统一写成设置里的前缀写法（`np-12` → `NP-12`）。关联只增不减（webhook 不会解除已有关联）；新关联写活动 `pr_linked`（details: pullRequestId, repo, number, url, linkedByType）。

合并流程：对每个关联任务——未到终态、至少有一个未 `autoCompleteDisabled` 的关联 PR、且这些 PR 全部 merged、`prMergedStatus` 不是 `'none'` 且在任务模板里 → 系统写状态（活动 `status_changed` 的 actor 为 system，details 带 `reason: 'prMerged', repo, number, url`）；都会写活动 `pr_merged`（details: repo, number, url, pullRequestId, statusChangedTo）并给订阅者 `pr_merged`。

### 3.3 任务上的 PR（浏览器，能看到任务的成员）

| 接口                                                                | 成功                                                                                                                                                      |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /np/issues/:id/pull-requests`                                  | `IssuePullRequestView[]`（按关联时间）                                                                                                                    |
| `POST /np/issues/:id/pull-requests { url }`                         | 201 `IssuePullRequestView`（已关联也 201，幂等）；URL 非法 400 `INVALID_PR_URL`；无令牌 409 `GITHUB_NOT_CONFIGURED`；快照含 `mergeableState` 与 `ciState` |
| `DELETE /np/issues/:id/pull-requests/:prId`                         | `{ ok: true }`；活动 `pr_unlinked`；PR 行保留；未关联 404                                                                                                 |
| `PATCH /np/issues/:id/pull-requests/:prId { autoCompleteDisabled }` | `IssuePullRequestView`                                                                                                                                    |
| `POST /np/issues/:id/pull-requests/:prId/refresh`                   | `IssuePullRequestView`（重新拉取快照与 CI）                                                                                                               |

`IssuePullRequestView = PullRequest & { linkedBy: { type: 'user' \| 'agent' \| 'system', id, name }, autoCompleteDisabled, linkedAt? }`（`linkedAt` 服务端总是返回）。任务详情带 `pullRequests`。

### 3.4 Agent 回写（运行令牌）

- `POST /np/agent/issues/:id/pull-requests { url }`：只能写运行所属任务（否则 403 `ISSUE_NOT_IN_RUN`）；新关联 201、已关联 200，`{ data: IssuePullRequestView }`；URL 非法 400 `INVALID_PR_URL`。有令牌且 GitHub 可读 → 完整快照；否则建最小行（state open，等 webhook 补全）。新关联且 PR open 非 draft、任务执行者是 Agent → 负责人 `pr_review`。
- `GET /np/agent/issues/:id/pull-requests` → `IssuePullRequestView[]`（读范围同 §8）。

## 4. 审批门禁（`@temporary(nocobase-official)` 的实现 + 稳定接口）

- 接口 `shared/approval.ts`：`ApprovalGateway { gate(input, tx), approve, reject, listForIssue, listPending, cancelStale }` 与 `ApprovalHooks { applyTransition, resolveApprovers }`。`gate` 的结果是 `{ kind: 'pass', reason: 'none' | 'system' | 'self' | 'noApprover' } | { kind: 'pending', requestId, request }`。
- 实现 `approval/approval.gateway.ts`（`DbApprovalGateway`，表 `approvalRequests`，PostgreSQL 部分唯一索引 `np_approval_requests_pending_unique` 保证同一任务同一目标状态只有一条 pending）。
- 模板转换可带 `approval: { approvers: ('owner' | 'projectLead' | 'admin')[] }`；同一 from→to→actor 命中多条转换时角色合并，任一条带 `approval` 即需审批。
- 规则与契约一致；另外：需审批的转换即使目标是终态，没有终态写权限的成员也可以发起（结果是 pending），不再 403。
- `PATCH /np/issues/:id { statusKey, ... }` 命中门禁：**202** `{ data: StatusChangePendingResponse = { issue（未变，完整 IssueV2）, pendingApproval: ApprovalRequest } }`，**整个 PATCH 都不生效**（同一请求里的其它字段也不写）。`POST /np/agent/issues/:id/status` 同样 202 同形。
- `GET /np/approvals?status=pending` → `ApprovalRequest[]`（当前用户可审的；`status` 只支持 pending，其余 400 `INVALID_STATUS`）。
- `POST /np/approvals/:id/approve|reject { comment? }`（body 可省略）→ `ApprovalRequest`；非审批人 403 `FORBIDDEN`；已决定 / 已取消 409 `APPROVAL_DECIDED`；approve 时任务已不在 fromStatus 409 `APPROVAL_STALE`；不存在 404。
- 同一任务同一 toStatus 已有 pending → 409 `APPROVAL_PENDING`。任务状态被任何路径改变（含终态）→ 其 fromStatus 不再匹配的未决请求（终态时全部）置 `cancelled`（在提交前的钩子里做），审批人的决定卡同时解决。
- `ApprovalRequest` = 契约字段 + `issueIdentifier`、`issueTitle`、`requestedByName`、`decidedByName`、`updatedAt`。
- 批准后状态变化的活动 `status_changed` 的 actor 是审批人，details 带 `approvalRequestId`；随后照常走触发规则（离开 backlog 的 `statusChange` 等）。
- 活动：`approval_requested`（details: from, to, requestId, approverUserIds）、`approval_self`、`approval_no_approver`（details: approvers）、`approval_approved` / `approval_rejected`（details: requestId, from, to, comment）。
- 任务详情 `approvals`：未决（新在前）+ 最近 5 条已决。
- 种子 `2026092900002_np_workflow_with_approval`：模板 id **`software-with-approval`**，名称"软件开发（验收审批）"。项目 `PATCH /np/projects/:id { workflowId }`（lead 或 owner/admin）；项目里有任务处于新模板没有的状态 → 409 `WORKFLOW_STATUS_CONFLICT`（`workflowId: null` 按默认模板检查）。

## 5. 批量录入

| 接口                                                                     | 成功                                                                                                                |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `POST /np/intake/batches { source: 'paste', rawContent, projectId? }`    | **201** `{ batch, drafts, parser }`；`rawContent` 必填 ≤ 200000；`projectId` 须可见（400 `INVALID_PROJECT`）        |
| `POST /np/intake/batches { source: 'issue', issueId }`                   | 201 同上；`issueId` 可为编号；解析任务描述，草稿 `parentPosition` 全为 null，确认时挂到该任务下；项目取该任务的项目 |
| `GET /np/intake/batches?mine=1`                                          | `IntakeBatch[]`（最近 50；不带 `mine=1` 时 owner/admin 看全部，其余成员仍只看自己的）                               |
| `GET /np/intake/batches/:id`                                             | `{ batch, drafts }`                                                                                                 |
| `PUT /np/intake/batches/:id/drafts { drafts }`                           | `{ drafts }`（整体替换、重新校验；只在 `draft` 状态）                                                               |
| `POST /np/intake/batches/:id/confirm { ownerUserId?, defaultExecutor? }` | `{ issues: [{ id, identifier, title }] }`（body 可省略）                                                            |
| `POST /np/intake/batches/:id/cancel`                                     | `IntakeBatch`（只在 `draft`）                                                                                       |
| `POST /np/intake/batches/:id/revert`                                     | `{ reverted: string[], kept: string[] }`（只在 `confirmed`）                                                        |

- 批次只有录入者与 owner/admin 能看和操作，其他人 404。状态不对 409 `INTAKE_STATE_CONFLICT`。
- `IntakeBatch` = 契约字段 + `sourceIssueId`、`parseError`、`updatedAt`。
- 校验：结构问题（不是数组、position 缺失 / 重复 / 非正整数、超过 500 条、缺 fields）整体 400 `INVALID_DRAFTS`；其余逐条写进 `validation.errors`（英文句子，前端原样展示）：`title is required`、`title is longer than 200 characters`、`parentPosition must point to an earlier draft`、`parentPosition N does not exist`、`stage must be an integer between 0 and 1000`、`stage only applies to a sub-task`、`priority must be urgent, high, medium, low or none`、`labels must be up to 20 names of at most 64 characters`、`the executor agent does not exist`、`you do not have access to the executor agent`、`the executor user does not exist`、`the owner does not exist`、`description must be text`。有任何错误时 confirm 400 `INTAKE_INVALID`；没有草稿也 400 `INTAKE_INVALID`。
- 确认：先按 position 顺序全部插入（父先子后；`originType = 'intake'`、`originId = batchId`、`createdById` = 录入者、状态 todo、`autoExecuteSubtasks` 取系统默认、标签按名称查找或新建），全部插入后才对执行者是 Agent 的任务跑触发规则（后面批次的兄弟已存在，被阻塞的记 `run_deferred_blocked`）。负责人：草稿 `ownerUserId` > 请求 `ownerUserId` > 录入者；执行者：草稿 `executor` > `defaultExecutor` > 无。源任务上写活动 `intake_confirmed { intakeBatchId, count }`。
- 撤回：本批创建的任务里没有任何运行的 → `deletedAt`，活动 `intake_reverted`；有运行的保留；源任务上也写 `intake_reverted { reverted, kept }`。
- 解析器：`ai.llmServices` 非空、`settings.intakeParser = 'auto'`、AI 员工插件已注册 → AI（会话归录入者，Agent 不带工具、`roles: []`、非 root，30 秒 `AbortSignal` + 超时竞速）；失败、超时或返回空 → 回退启发式，`batch.parseError` 记原因。AI 的草稿会重新编号、丢弃不向前指的 parent、丢弃无 parent 行的 stage。启发式规则见 `intake/heuristic-parser.ts` 文件头（额外：`#`–`######` 都算标题；`!!` = urgent、`!` = high，须独立成词；`[ ]`/`[x]` 复选框前缀去掉；标题超过 200 字截断并把全文放进描述首行；CSV 支持 `title, description, priority, labels（; 或 | 分隔）, stage, parent（= 前面某行的标题）`）。

## 6. 表情与线程解决

| 接口                                          | 成功                                                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `POST /np/comments/:id/reactions { emoji }`   | 该评论的 `CommentReaction[]`（重复添加无副作用）                                                          |
| `DELETE /np/comments/:id/reactions/:emoji`    | 同上（emoji 需 URL 编码；不存在也 200）                                                                   |
| `POST /np/comments/:id/resolve` / `unresolve` | `{ commentId, resolvedAt, resolvedById }`（只对线程根，否则 400 `NOT_THREAD_ROOT`；重复调用不重复写活动） |

- 表情固定集合 `REACTION_EMOJIS`，其余 400 `INVALID_EMOJI`；看不到任务的评论 404。
- 评论行（详情 `comments`）= `CommentV2`：`reactions`（按固定顺序）、`resolvedAt`、`resolvedById`、`resolvedByName`（只在线程根有值）。
- Agent 评论列表每行带 `resolved`（所在线程已解决）；新增查询参数 `excludeResolved=1` 去掉已解决线程（`thread` 指定的线程除外）。认领载荷里的触发评论总是带入（它们就是触发线程）。

## 7. Agent 环境变量、技能

### 7.1 环境变量

| 接口                                                 | 成功                                                       | 权限                      |
| ---------------------------------------------------- | ---------------------------------------------------------- | ------------------------- |
| `GET /np/agents/:id/env`                             | `AgentEnvVarView[] = [{ name, updatedAt, updatedByName }]` | Agent 所有者、owner/admin |
| `PUT /np/agents/:id/env { vars: [{ name, value }] }` | 同上（upsert 后的全部）                                    | 同上                      |
| `DELETE /np/agents/:id/env/:name`                    | `{ ok: true }`；不存在 404                                 | 同上                      |
| `POST /np/agents/:id/env/reveal`                     | `[{ name, value }]`                                        | owner/admin               |
| `GET /np/agents/:id/env/audits`                      | `AgentEnvAudit[]`（最近 100，新在前；带 `userName`）       | owner/admin               |

- 名称 `^[A-Z_][A-Z0-9_]*$` 且 ≤ 128（400 `INVALID_ENV_NAME`）；`NOCOPROJECT_*`、`PATH`、`HOME`、`SHELL` 400 `RESERVED_ENV_NAME`；值 ≤ 8 KB（UTF-8 字节，400 `INVALID_ENV_VALUE`）；一次最多 100 个、同名重复 400。set / delete / reveal 都写审计。

### 7.2 技能

| 接口                                                        | 成功                                      |
| ----------------------------------------------------------- | ----------------------------------------- |
| `GET /np/skills`                                            | `Skill[]`（按名称）                       |
| `POST /np/skills { name, description?, content?, source? }` | 201 `SkillDetail = { skill, files }`      |
| `GET /np/skills/:id`                                        | `SkillDetail`                             |
| `PATCH /np/skills/:id { name?, description?, content? }`    | `SkillDetail`                             |
| `DELETE /np/skills/:id`                                     | `{ ok: true }`（同时解除所有 Agent 挂载） |
| `PUT /np/skills/:id/files { files: [{ path, content }] }`   | `SkillDetail`（整体替换）                 |

- `Skill` = 契约字段 + `createdByName`、`fileCount`、`agentCount`、`canEdit`。任何成员可读、可建；创建者与 owner/admin 可改删（403）。
- `slug`：名称 NFKD 去音标、小写、非 `[a-z0-9]` 变连字符，最长 64，空则 `skill`，重复加 `-2`、`-3`…；**改名不改 slug**（守护进程目录名稳定）。
- 文件：≤ 20 个（400 `TOO_MANY_FILES`），每个 ≤ 64 KB（400 `FILE_TOO_LARGE`）；路径相对、用 `/`、无空段 / `.` / `..`、无盘符 / 反斜杠，且不能是 `SKILL.md`（400 `INVALID_SKILL_PATH`）。
- Agent：`POST/PATCH /np/agents` 接受 `skillIds[]`（整组替换，不存在的 id 400 `INVALID_SKILL`）；行（`AgentListItemV2`）追加 `skillIds`、`skills: [{ id, name, slug }]`。

## 8. 用量、设置、会话模式、遗留项

- `GET /np/usage?from=&to=&groupBy=&projectId=&agentId=&issueId=` → `{ rows: UsageRow[], totals: UsageRow & { pricedRuns } }`。日期是 UTC 的 `YYYY-MM-DD`，按用量记录（`runUsage.createdAt`）过滤，缺省最近 30 天（含今天），范围最多 366 天（400 `INVALID_RANGE`）；`groupBy` 缺省 `agent`（非法 400 `INVALID_GROUP_BY`）。行的 `key`：agent → Agent id、issue → 任务 id（name = "编号 标题"）、project → 项目 id 或 `none`、day → 日期、model → 模型或 `unknown`。价格：第一条 provider 匹配（`*` 或相同，不区分大小写）且模型 glob 匹配（不区分大小写）的 `ModelPrice`；行内部分记录有价格时 `estimatedCost` 是有价格部分之和，全部无价格才是 null。day 分组按日期升序，其余按 token 总数降序。可见性：非 owner/admin 排除看不到的私有项目的任务。`issueId` 过滤是契约外的补充。
- 任务详情 `usage`：该任务全部运行的合计（`key` = 任务 id，`name` = 编号，带 `pricedRuns`）。
- `GET /np/settings` → `WorkspaceSettingsView = { autoExecuteSubtasksDefault, prMergedStatus, modelPrices, intakeParser, issuePrefix, canEdit }`（任何成员）；`PATCH /np/settings`（owner/admin，其余 403）同名字段可选；`prMergedStatus` 须为 `'none'` 或默认模板里的状态（400 `INVALID_STATUS`）；`modelPrices` 最多 100 条，`provider`/`model` 必填，四个价格为 ≥ 0 的数（缓存价可省略，按 0；400 `INVALID_MODEL_PRICE`）。
- 会话模式：`PATCH /np/issues/:id { executionMode }`（非法 400 `INVALID_EXECUTION_MODE`），活动 `execution_mode_changed { from, to }`。`GET /np/issues/:id/runs` → `{ data: RunSummary[], queuedRun: { id, triggerCount } | null }`（`queuedRun` 与 `data` 同级）；详情也带 `queuedRun`。`queuedRun` = 最早的 queued / deferred 运行，任务模式下也会返回。
- Agent 读接口（`GET /np/agent/issues/:id`、`/comments`、`/children`、`/pull-requests`）：只能读运行所属任务、同项目的任务、无项目的任务，其余 404 `NOT_FOUND`。
- `/np/runs/:id`、`/events`、`/cancel`、`/retry`：看不到运行所属任务 → 404（不存在同样 404）。
- 新增 `blockedBy` 依赖（浏览器与 Agent 接口）后任务确实被阻塞 → 其 queued / deferred 运行置 `cancelled`、`failureReason = 'blocked'`，活动 `run_deferred_blocked { agentId, runId, withdrawn: true, triggerType, blockers }`；dispatched / running 不动；依赖目标已终态或 `relatedTo` 不撤回。
- 设置项：Provider 注册 `np-members`、`np-settings`、`np-github`，分区 `nocoproject`；标题是应用命名空间（`APP_NS`）的 i18n key：分区 `navigation.nocoproject`，项 `navigation.members` / `navigation.nocoproject` / `navigation.github`（与前端设置路由的导航 key 相同）；动作标题仍是 `Open`。
- 种子 `2026092900003_np_iter2_page_grants` 给默认权限集 `member` 追加页面 `np-intake`、`np-skills`、`np-usage`、`np-approvals` 的 access 与设置项的 read；`2026092900004_np_github_settings_grant` 把其中临时的 `np-integrations` 换成 `np-github`。

## 9. 收件箱追加类型与结构化载荷

| type               | kind     | 收件人                               | payload（另有 `identifier`、`issueTitle`）                                                      | dedupeKey                               |
| ------------------ | -------- | ------------------------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------- |
| `approval_pending` | decision | 每个审批人                           | `requestId, fromStatus, toStatus, requestedByName`                                              | `user:<uid>:approval_pending:<issueId>` |
| `approval_decided` | info     | 请求者（成员）；Agent 请求时给负责人 | `requestId, decision: 'approved' \| 'rejected', fromStatus, toStatus, comment, requestedByType` | 默认                                    |
| `pr_review`        | decision | 负责人                               | `pullRequestId, repo, number, url`                                                              | `user:<owner>:pr_review:<issueId>`      |
| `pr_merged`        | info     | 订阅者                               | `repo, number, url, statusChangedTo`                                                            | 默认                                    |

`approval_pending` 在请求被决定或取消时解决；`pr_review` 在 PR 合并或关闭时解决。迭代 1 类型的载荷追加：`owner_assigned` 的 `fromName`；`mentioned` 的 `source: 'description' | 'comment'`；`mentioned` / `commented`（评论）的 `excerpt`（评论前 200 字）；`run_failed` / `agent_blocked`（运行失败）的 `agentName`。

## 10. 认领载荷（`ClaimedRunV2 = ClaimedRunV1 & ClaimedRunPhase2Extras`，只走守护进程路由）

- `agent.env: Record<string, string>`：解密后的环境变量（保留名跳过；解不开的值跳过）；无变量时 `{}`。
- `agent.skills: ClaimedSkill[] = [{ id, slug, name, description, content, files: [{ path, content }] }]`，按 slug 排序；`content` 原样（可能没有 YAML front matter）。
- `issue.executionMode`、`issue.pullRequests: [{ number, url, state }]`（按关联时间）。
- Agent 视图（`GET /np/agent/issues/:id`、`/context` 的 issue）追加 `executionMode`、`pullRequests`（同上形状）。

## 11. 与契约的出入

1. 迭代 2 的组合类型拆成两个文件：契约类型在 `protocol.phase1-iter2.ts`（只引用 CLI 副本也有的类型，CLI 可直接复制，已试编译通过），依赖迭代 1 服务端补充形状的 `IssueV2`、`IssueListItemV2`、`IssueDetailV2`、`IssueForAgentV2`、`AgentListItemV2`、`CreateAgentRequestV2`、`UpdateAgentRequestV2`、`UpdateIssueRequestV2` 在 `protocol.phase1-iter2-server.ts`（CLI 不复制）。
2. 契约 §M 的"追加"没有改 `protocol.ts` 的原联合类型，而是单独的 `InboxItemTypePhase1Iter2`、`RunFailureReasonPhase1Iter2`、`ActivityActionPhase1Iter2`，并提供合并类型 `InboxItemTypeV2`、`InboxItemV2`、`FailureReasonV2`（按 CLI 要求）。
3. 迁移追加契约外的列：`issues.deletedAt`（撤回的软删除，契约提到 deletedAt 但表里没有）、`intakeBatches.sourceIssueId`（source = issue 的源任务）、`intakeBatches.parseError`；`gitConnections`、`webhookDeliveries`、`approvalRequests` 等新表都带 createdAt/updatedAt。`systemSettings.settings` 的 `modelPrices` / `intakeParser` 没有在迁移里回填，服务按默认值读。
4. `ApprovalGateway.gate` 多一个 `tx` 参数与 `approval`（转换的审批配置）输入，结果多 `reason` 与 `request`；接口多 `cancelStale`；另有 `ApprovalHooks`（`applyTransition`、`resolveApprovers`）供任何实现使用。
5. 命中门禁时整个 PATCH 不生效（不只是状态）。需审批的终态转换允许没有终态写权限的成员发起。
6. `approval_self` / `approval_no_approver` / `approval_requested` / `approval_approved` / `approval_rejected` 活动由数据库网关写（属于临时实现），内存替身不写。取消的请求不写活动。
7. 模板 id 为 `software-with-approval`（契约未定）。
8. 设置项 id 为 `np-settings` 与 `np-github`（按前端路由）；页面授权另有 `np-intake`、`np-skills`、`np-usage`、`np-approvals`（最后一个前端未使用，无害）。审批页在前端是 `/inbox/approvals`，沿用 `np-inbox` 授权。
9. 契约外的接口 / 参数：`GET /np/issues/:id/runs`（契约提到但迭代 1 没有这个接口，本轮新增）、`GET /np/usage` 的 `issueId`、Agent 评论列表的 `excludeResolved`、webhook 缺 delivery id 的 400 `MISSING_DELIVERY`。
10. 环境变量 `env_changed`、技能 `skills_changed` 活动没有写：活动表按任务存，Agent 与技能没有任务；环境变量的变更记在审计表，技能变更只推 `np:agents`。
11. webhook 响应沿用 `{ data }` 包装：重复投递为 `{ data: { duplicate: true } }`。
12. `queuedRun` 在任务模式下也返回（契约写的是会话模式下带）；前端只在会话模式展示即可。
13. 浏览器手动关联已关联的 PR 仍返回 201（幂等）；Agent 接口按 CLI 要求区分 201 / 200。手动关联一个已经 merged 的 PR 不会触发合并流程（合并流程只由 webhook 的合并事件触发）。
14. `IssuePullRequestView.linkedAt` 在类型里是可选（服务端总是返回），以兼容 CLI 的测试替身。
15. `ClaimedRun` 的触发评论总是带入，即使所在线程已解决（它们就是触发线程）；"已解决线程默认不带入"由守护进程读评论时用 `excludeResolved=1` 或 `resolved` 标记实现。
16. `project.service.ts`（迭代 1 已 578 行，本轮 +7）与 `protocol.ts` 仍超过 500 行；`protocol.phase1-iter2.ts` 546 行（纯类型，契约要求集中在一个文件）。
