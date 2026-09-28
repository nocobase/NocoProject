# NocoProject 协议：Phase 1 迭代 4（服务端实现，权威）

> 在 Phase 0、迭代 1–3 协议之上追加；契约见 `iteration-4-contract.md`。本文记录服务端实际实现的请求 / 响应形状和与契约的出入。类型：契约类型在 `server/modules/shared/protocol.phase1-iter4.ts`（CLI 用 `pnpm sync-protocol` 复制；只引用 `protocol.ts`、`protocol.phase1-iter2.ts`、`protocol.phase1-iter3.ts`），组合了服务端形状的 `IssueV4`、`IssueListItemV4`、`IssueDetailV4`、`IssueForAgentV4`、`AgentListItemV4`、`DesignDecisionResultV4`、`PmIssueDetailV4` 在 `protocol.phase1-iter4-server.ts`（CLI 不复制）。两者都由 `protocol.ts` 末尾 `export *`。路径前缀 `/api/np`，成功 `{ data }`，失败 `{ code, message }`。

## 1. 数据模型与种子

- 迁移 `2026100100001_np_phase1_iter4`：`issues.process`（varchar 16，非空，默认 `'direct'`）、`issues.designApprovedAt`（timestamptz，可空）、`issues.designApprovedById`（varchar 64，可空）；`agents.kind`（varchar 16，非空，默认 `'coder'`）、`agents.reasoningEffort`（varchar 16，可空）。`comments.kind` 新值 `'proposal'` 与 `systemSettings.settings` 新键不改列。`down` 删除这五列。
- 种子 `2026100100002_np_iter4_workflow_statuses`：给默认模板（`isDefault` 的行与 id `default`）和 `software-with-approval` 追加状态 `analysis`（Analysis，started，orange，在 todo 后）、`proposal_review`（Proposal Review，started，purple，在 analysis 后）与转换（幂等：已有同 key 状态、同 from/to/actors 转换不再加）：

  ```
  todo → analysis                agent, user
  analysis → proposal_review     agent, user
  proposal_review → analysis     user, system
  proposal_review → in_progress  system, user
  analysis → blocked             agent, user
  proposal_review → blocked      agent, user
  blocked → analysis             agent          （契约外，见 §7.3）
  ```

  `issue/status.ts` 的 `BUILTIN_DEFINITION`（库里没有默认模板时用）同步了这些状态与转换。

- 种子 `2026100100003_np_iter4_page_grants`：默认权限集 `member` 追加页面 `np-pm` 的 `access`（只追加缺的）。
- 三个文件写入前已是 prettier 格式；开发库由开发服务器热重载执行，`pnpm nocobase db apply` 报告 `Executed: none`（迁移与前两个种子）/ 执行了 grants 种子，无 checksum 警告。

## 2. 设计先行流程

### 2.1 选择 process

任务行（列表、看板、详情、写接口的返回）都带 `process`、`designApprovedAt`、`designApprovedById`；`originType` 可为 `'pm'`。

| 接口                               | 规则                                                                                                                                                                                                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /np/issues { process? }`     | `direct` / `design_first` → 用它（by `user`）；缺省或 `null` 或 `auto` → `settings.defaultProcess`：`direct` / `design_first` 直接用（by `default`），`auto` → 分类器（by `heuristic` 或 `ai`）。其它值 400 `INVALID_PROCESS`。分类在事务之前做（模型调用最多 30 秒）。 |
| `PATCH /np/issues/:id { process }` | 只接受 `direct` / `design_first`（`auto` 400 `INVALID_PROCESS`）；值变化且状态不是 backlog / todo → 409 `PROCESS_LOCKED`                                                                                                                                                |
| 活动 `process_selected`            | 创建：`{ process, by, rule? }`（`rule` 只在 by = heuristic 且命中规则时）；PATCH：`{ process, from, by: 'user' }`                                                                                                                                                       |
| Agent 建的子任务、项目经理对话     | `direct`，不写 `process_selected`                                                                                                                                                                                                                                       |

分类器 `intake/process-classifier.ts`：启发式按顺序——描述 ≥ 600 字 → design_first（`long_description`）；标题以 fix / fixes / fixed / hotfix / bugfix / typo / 修复 / 改文案 开头且描述 < 200 字 → direct（`fix_prefix`）；含 设计 / 方案 / 架构 / 重构 / 迁移 / 新模块 / 调研，或 design / architecture / refactor / migrate / migration / new module / research / investigate / RFC / spike → design_first（`keyword`）；含 子任务 / 拆分 / 分解 / subtask / break down，或描述里有 ≥ 3 个列表项 → design_first（`subtasks`）；都不中 → direct（rule null）。**只有都不中**且配置了 LLM 服务时，才做一次直接模型调用（与 AI 录入同一个 `AiAgentFactory`，回 `{"process":"direct"|"design_first"}`），30 秒超时、失败或读不出答案回退启发式的 direct。

### 2.2 设计门

Agent 写状态（`POST /np/agent/issues/:id/status`）在转换检查之后、审批门之前再过一道门（`issue/process.ts`）：

| 情形                                                                  | 结果                         |
| --------------------------------------------------------------------- | ---------------------------- |
| 目标 `in_progress`、`process = design_first`、`designApprovedAt` 为空 | 403 `DESIGN_NOT_APPROVED`    |
| 目标 `analysis`、`process = direct`                                   | 403 `TRANSITION_NOT_ALLOWED` |
| 目标 `proposal_review`、任务还没有方案评论                            | 409 `PROPOSAL_REQUIRED`      |

成员 `PATCH { statusKey: 'in_progress' }` 在未批准的 design_first 任务上照常生效，并写活动 `design_skipped { from }`（不设置 `designApprovedAt`）。

### 2.3 方案

`POST /np/agent/issues/:id/design-proposal { content }`（运行令牌；`:id` 必须是运行自己的任务，否则 403 `ISSUE_NOT_IN_RUN`）→ **201** `{ data: CommentV2 }`：顶层评论，`kind = 'proposal'`，作者是 Agent（`sourceRunId` = 运行），不触发任何人。`content` 缺失 / 空白 / 超过 200000 字 → 400 `INVALID_CONTENT`。design_first 任务还在 todo 时先改为 `analysis`（Agent 身份，`status_changed.details.reason = 'designProposed'`）。活动 `design_proposed { commentId, runId }`；事件 `design.proposed`（任务正处于 proposal_review 时刷新决定卡，见 §2.5）。方案之后由 Agent 自己改状态为 `proposal_review`。

最新方案（`kind = 'proposal'` 的最新评论）：`DesignProposal = { commentId, content, createdAt }`，出现在认领载荷 `issue.designProposal`、任务详情 `issue.designProposal`、PM 详情 `issue.designProposal`（没有时 null）。评论列表 / 时间线里的方案评论 `kind: 'proposal'`。

### 2.4 决定

| 接口                                                             | 权限                                                               | 成功                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /np/issues/:id/design/approve { comment? }`（body 可省略） | 负责人、项目 lead、owner/admin（否则 403 `FORBIDDEN`）；看不到 404 | 200 `{ data: DesignDecisionResult }`：写 `designApprovedAt/ById`；有评论时写一条顶层评论（**不单独触发**）；工作流有 in_progress 且任务不在终态 → 改为 `in_progress`（`status_changed.details.reason = 'designApproved'`，活动的 actor 是批准人，不经审批门）；活动 `design_approved { from, to, commentId, proposalCommentId }`；执行者是 Agent 时入队 `designApproved`（scope null，合并规则照旧，触发记录带 `commentId` = 批准评论，所以认领载荷里这条触发带 `comment`） |
| `POST /np/issues/:id/design/request-changes { comment }`         | 能看到任务的成员                                                   | 200 `{ data: DesignDecisionResult }`：已批准的先清掉 `designApprovedAt/ById`；工作流有 analysis → 改为 `analysis`（`reason = 'designChangesRequested'`）；再写顶层评论（照常触发：执行者 Agent 收到 `comment` 运行）；活动 `design_changes_requested { from, to, commentId }`                                                                                                                                                                                               |

`DesignDecisionResult = { issue: 完整任务行, comment: CommentV2 | null, triggered: TriggeredRun[] }`。两者共同的错误：非 design_first 409 `NOT_DESIGN_FIRST`；approve 已批准 409 `DESIGN_ALREADY_APPROVED`；request-changes 缺评论 400 `INVALID_COMMENT`；评论超过 200000 字 400 `INVALID_COMMENT`。两者都发 `design.decided`，解决该任务全部 `design_review` 卡。

### 2.5 决定卡 `design_review`

| type            | kind     | 收件人                                                | payload（另有 identifier、issueTitle、actions）                                                                   | dedupeKey                              |
| --------------- | -------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `design_review` | decision | 负责人（负责人自己把状态改为 proposal_review 时不发） | `proposalCommentId`（最新方案，没有时 null）、`summary`（方案前 300 字）、`from`（进入前的状态；方案刷新时 null） | `user:<owner>:design_review:<issueId>` |

- 进入 `proposal_review` 时发卡（负责人不再收到同一次状态变化的 `status_changed`）；处于 proposal_review 时 Agent 再提方案 → 同一张卡合并（count + 1、重新未读、payload 换成新方案）。
- 状态离开 `proposal_review`、approve、request-changes 都解决卡。
- actions：

| key              | kind      | method | path                                     | 其它                                            |
| ---------------- | --------- | ------ | ---------------------------------------- | ----------------------------------------------- |
| `approve`        | primary   | POST   | `/np/issues/<id>/design/approve`         | `commentField: 'comment'`（可选评论）           |
| `requestChanges` | secondary | POST   | `/np/issues/<id>/design/request-changes` | `needsComment: true`, `commentField: 'comment'` |
| `open`           | secondary | GET    | `/issues/<编号>`                         | `opensIssue: true`                              |

已解决的卡只剩 `open`。

### 2.6 认领载荷与 Agent 视图

认领载荷（`ClaimedRunPhase4Extras`）：`agent.kind`、`agent.reasoningEffort`；`issue.process`、`issue.designApprovedAt`、`issue.designProposal`、`issue.originType`（契约外，`'pm'` = 对话任务）。触发类型追加 `designApproved`、`retrospective`（`RunTriggerTypePhase1Iter4`）。`GET /np/agent/issues/:id` 与 `/context` 的 `issue` 追加 `process`、`designApprovedAt`。

## 3. 项目经理

### 3.1 Agent 字段

`POST / PATCH /np/agents` 接受 `kind`（`coder` | `manager`，默认 coder；其它 400 `INVALID_KIND`）与 `reasoningEffort`（`minimal` | `low` | `medium` | `high` | `max` | null；其它 400 `INVALID_REASONING_EFFORT`）；列表 / 详情行带这两个字段。

`kind = 'manager'` 的 Agent 不能做普通任务的执行者：建任务、PATCH 执行者、Agent 建子任务（`executor: self` / 委派）、接受执行者建议、批量录入确认 → 400 `MANAGER_NOT_EXECUTOR`；批量录入草稿校验给出 `a project manager agent cannot execute issues`。例外：PM 对话任务（`originType = 'pm'`）自己的执行者变更，与 PM 的总结运行（不改执行者）。

### 3.2 设置

`GET /np/settings` 追加 `defaultProcess`（默认 `'auto'`）、`pmAgentId`（默认 null）、`retrospectiveOnDone`（默认 true）；`PATCH`（owner/admin）：`defaultProcess` 必须是 auto / direct / design_first（400 `INVALID_FIELD`）；`pmAgentId` 必须是 null 或未归档的 manager Agent（400 `INVALID_PM_AGENT`）；`retrospectiveOnDone` 布尔（400 `INVALID_FIELD`）。

### 3.3 对话

| 接口                       | 成功                                                                             |
| -------------------------- | -------------------------------------------------------------------------------- |
| `GET /np/pm/conversation`  | `{ data: PmConversationResponse }`；当前用户还没有对话 404 `NOT_FOUND`           |
| `POST /np/pm/conversation` | 200 `{ data: PmConversationResponse }`：找到或创建（幂等，按用户加 advisory 锁） |

`PmConversationResponse = { issueId, identifier, agentId }`。没有可用的项目经理（`pmAgentId` 未设、Agent 不存在 / 已归档 / 不是 manager）时两者都是 409 `PM_NOT_CONFIGURED`。创建的任务：标题 `项目经理 · <用户名>`、无项目、`executionMode = 'session'`、执行者 = pmAgentId、负责人 = 当前用户、`originType = 'pm'`、状态 todo、process direct；**创建不入队运行**，用户在上面发的评论照常触发（`comment`，actorUserId = 该用户）。`pmAgentId` 换了之后再 GET / POST，对话的执行者改为新 Agent（活动 `executor_changed { reason: 'pmAgentChanged' }`，不入队）。

对话任务只有负责人能看到：其他成员详情 404、不出现在任何列表 / 看板里；其它运行的 Agent 读接口也 404。

### 3.4 项目经理读接口（运行令牌）

只有 `kind = 'manager'` 的 Agent（否则 403 `MANAGER_ONLY`）；运行没有 `actorUserId` 时 403 `FORBIDDEN`。全部经浏览器侧的服务、以提问者（运行的 `actorUserId`）身份读取，可见性与该成员在界面上一致。

| 接口                                                                                             | 成功                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /np/agent/pm/projects`                                                                      | `{ data: ProjectListItem[] }`                                                                                                                                                           |
| `GET /np/agent/pm/issues?projectId&statusKey&ownerUserId&executorId&q&updatedSince&limit&cursor` | `{ data: IssueListItemV4[], nextCursor }`（同 `GET /np/issues` 的分页与排序）；`ownerUserId=me` = 提问者；`updatedSince` 是 ISO 时间或 `7d` / `24h` / `30m`（其它 400 `INVALID_QUERY`） |
| `GET /np/agent/pm/issues/:idOrIdentifier`                                                        | `{ data: PmIssueDetail = { issue（列表行 + description + designProposal）, comments（最近 50，升序）, activities（最近 50，升序）, runs, pullRequests, subtasks, usage } }`；看不到 404 |
| `GET /np/agent/pm/inbox?kind=decision`                                                           | `{ data: InboxItemV4[], unread, nextCursor }`：提问者**未解决**的收件箱项，`kind` 缺省 decision（`info` 也可）                                                                          |
| `GET /np/agent/pm/metrics?from&to&projectId`                                                     | `{ data: MetricsReport }`（同 `GET /np/metrics`，按提问者过滤）                                                                                                                         |
| `GET /np/agent/pm/knowledge?projectId&q`                                                         | `{ data: KnowledgeDocSummary[] }`（同 `GET /np/knowledge`：可见项目 + 系统级）                                                                                                          |

### 3.5 总结（retrospective）

任务进入 done 分类状态（从非终态进入；cancelled 不算）时，满足全部条件则触发模块直接入队项目经理运行：`settings.retrospectiveOnDone` 为真；`settings.pmAgentId` 指向未归档的 manager Agent；任务 `originType` 不是 `pm`；执行者是 PM 以外的 Agent，或曾有 PM 以外的 Agent 在这个任务上运行过。运行：`agentId = pmAgentId`、subject = 该任务、`threadScope = 'retro'`、`actorUserId` = 把它改为 done 的成员（系统改的，如 PR 合并，= 任务负责人）、触发 `retrospective { from, to, doneBy: { type, id } }`（不受阻塞检查）。

PM 在运行里用普通 Agent 接口写 `/note` 评论（Agent 的 `/note` 不产生任何通知）。运行完成时（`POST /np/daemon/runs/:id/complete`），若它有 `retrospective` 触发且写过 `/note`，在任务上记活动 `retrospective_done { commentId（最新那条 /note）, runId }`（actor 为 PM）；没写 note 不记。

## 4. 批量录入

`POST /np/intake/batches` 追加 `process?: 'auto' | 'direct' | 'design_first'`（其它 400 `INVALID_PROCESS`）：写进每条没有 `process` 的草稿的 `fields.process`。草稿 `fields.process`（`IntakeDraftFieldsV4`）可逐条改（`PUT /np/intake/batches/:id/drafts`），非法值在 `validation.errors` 里给 `process must be auto, direct or design_first`。确认时每条按 §2.1 选择（`auto` / 缺省 → `settings.defaultProcess` → **只用启发式**，不逐条调模型），写 `process_selected`（actor = 录入人）。

## 5. 类型

`protocol.phase1-iter4.ts`：`IssueProcess`、`ISSUE_PROCESSES`、`DefaultProcess`、`DEFAULT_PROCESSES`、`ProcessSelectedBy`、`STATUS_ANALYSIS`、`STATUS_PROPOSAL_REVIEW`、`PROCESS_EDITABLE_STATUSES`、`IssuePhase4Fields`、`IssuePhase4Input`、`CommentKindPhase1Iter4`、`CommentKindV4`、`AgentDesignProposalRequest`、`DESIGN_PROPOSAL_MAX`、`DesignProposal`、`DesignApproveRequest`、`DesignRequestChangesRequest`、`DesignDecisionResult<T>`、`DesignReviewPayload`、`DESIGN_REVIEW_SUMMARY_LENGTH`、`AgentKind`、`AGENT_KINDS`、`ReasoningEffort`、`REASONING_EFFORTS`、`AgentPhase4Fields`、`AgentPhase4Input`、`RunTriggerTypePhase1Iter4`、`RunTriggerTypeV4`、`RETROSPECTIVE_THREAD_SCOPE`、`ClaimedRunPhase4Extras`、`IssueForAgentPhase4Fields`、`PmConversationResponse`、`PmIssueListQuery`、`PmIssueRow`、`PmIssueListPage<T>`、`PmIssueDetail<T>`、`PmProjectList`、`PM_DETAIL_TAIL`、`WorkspaceSettingsPhase4Fields`、`WorkspaceSettingsViewV4`、`UpdateWorkspaceSettingsRequestV4`、`IntakeDraftFieldsV4`、`CreateIntakeBatchRequestV4`、`InboxItemTypePhase1Iter4`（`'design_review'`）、`InboxItemTypeV4`、`InboxItemV4`、`ActivityActionPhase1Iter4`、错误码常量（`ERROR_PROCESS_LOCKED`、`ERROR_DESIGN_NOT_APPROVED`、`ERROR_PROPOSAL_REQUIRED`、`ERROR_NOT_DESIGN_FIRST`、`ERROR_DESIGN_ALREADY_APPROVED`、`ERROR_MANAGER_NOT_EXECUTOR`、`ERROR_MANAGER_ONLY`、`ERROR_PM_NOT_CONFIGURED`）。

`protocol.phase1-iter4-server.ts`：`IssueV4`、`IssueListItemV4`、`IssueDetailV4`、`IssueDetailV4Paged`、`CreateIssueRequestV4`、`UpdateIssueRequestV4`、`IssueForAgentV4`、`AgentListItemV4`、`CreateAgentRequestV4`、`UpdateAgentRequestV4`、`DesignDecisionResultV4`、`PmIssueDetailV4`。

`ActivityActionPhase1Iter4 = 'process_selected' | 'design_skipped' | 'design_proposed' | 'design_approved' | 'design_changes_requested' | 'retrospective_done'`。

## 6. 错误码一览（本轮新增）

`INVALID_PROCESS`（400）、`PROCESS_LOCKED`（409）、`DESIGN_NOT_APPROVED`（403）、`PROPOSAL_REQUIRED`（409）、`NOT_DESIGN_FIRST`（409）、`DESIGN_ALREADY_APPROVED`（409）、`INVALID_CONTENT`（400）、`ISSUE_NOT_IN_RUN`（403，design-proposal 指向别的任务）、`INVALID_KIND` / `INVALID_REASONING_EFFORT`（400）、`MANAGER_NOT_EXECUTOR`（400）、`MANAGER_ONLY`（403）、`PM_NOT_CONFIGURED`（409）、`INVALID_PM_AGENT`（400）。

## 7. 与契约的出入

1. **类型**：同迭代 2 / 3 分两个文件；原联合类型不改，另给 `…V4`。唯一的"改"：`protocol.phase1-iter2.ts` 的 `IssueOriginType` 追加 `'pm'`（契约要求 originType 增加 pm；交叉类型无法放宽已有字段）。`CommentV2.kind` 的类型仍是 `CommentKind`，实际值可能是 `'proposal'`（见 `CommentKindV4`）。
2. **process 选择**：`process_selected.details.by` 多一个值 `'default'`（`settings.defaultProcess` 直接给出 direct / design_first 时），启发式命中时带 `rule`，PATCH 带 `from`。模型**只在启发式没有命中任何规则时**调用（"先启发式"），避免每次建任务都等模型；是否调用只看是否配置了 LLM 服务（与 `intakeParser` 设置无关）。批量录入只用启发式。`POST /np/issues` 接受显式 `process: 'auto'`。
3. **转换**：种子多加 `blocked → analysis`（agent）：否则在分析阶段阻塞的 Agent 解除阻塞后只能回 in_progress，而设计门会拒绝。
4. **方案**：Agent 改 `proposal_review` 前必须已有方案（409 `PROPOSAL_REQUIRED`）；design_first 任务在 todo 时提交方案会先自动进入 analysis（Agent 仍可先自己改 analysis，回声 Agent 就是这样做的）。方案接口不限制 process（direct 任务上也只是一条方案评论）。
5. **决定**：approve 需要负责人 / 项目 lead / owner/admin；request-changes 任何能看到任务的成员（与交付的 accept / request-changes 一致）。approve 从任意非终态直接写 in_progress（不检查转换、不经审批门，活动 actor 为批准人）；批准评论不单独触发运行，而是挂在 `designApproved` 触发上。request-changes 会清掉已有的批准。重复批准 409 而不是幂等返回。
6. **决定卡**：除"进入 proposal_review"外，处于 proposal_review 时再提交方案也会合并刷新卡（契约写的"再次 proposal_review 时"在状态不变时无法发生）。卡在状态离开 proposal_review 时也会解决。
7. **项目经理对话**：`GET` 只查找（没有时 404），`POST` 查找或创建（契约写"GET 同"，按前端要求改为只查）；没有可用 PM 时两者 409，即使已有旧对话。响应多 `identifier`、`agentId`。对话任务只对负责人可见（详情、列表、看板、Agent 读接口）：PM 以提问者的可见范围回答，答复不能让别人看到。`pmAgentId` 变更后对话执行者跟随。
8. **PM 读接口**：`/pm/issues/:id` 多 `usage` 与 `issue.designProposal`；`/pm/inbox` 返回 `{ data, unread, nextCursor }`（与 `GET /np/inbox` 同形，只含未解决项）；`updatedSince` 接受相对时长；运行没有提问者时 403。
9. **总结**：只在 done 分类（不含 cancelled），且从非终态进入时触发；"执行者曾是 Agent" 的判断 = 当前执行者是 PM 以外的 Agent，或有 PM 以外的 Agent 在该任务上跑过运行。PM Agent 已归档或不是 manager 时不触发。系统改为 done（PR 合并）时 actorUserId = 任务负责人。`retrospective_done` 只在运行写过 `/note` 时记录。"PM 的备注不产生通知"实现为：任何 Agent 的 `/note` 评论都不产生收件箱项。
10. **Agent 字段**：服务端不限制 manager Agent 改任务状态 / 建子任务（简报约束）；把已有任务的执行者 Agent 改成 manager 不被拒绝（之后对这些任务再分配时才会 400）。
11. **页面授权**：契约没有写，新增种子 `2026100100003_np_iter4_page_grants` 给 `member` 追加 `np-pm`（前端 `/pm` 页面的 authz）。
12. **认领载荷**：`issue.originType` 为契约外字段（守护进程可据此区分对话任务）。

## 8. 任务附件（NP-78）

文件存在 Drive 的 disk 上（`nocoproject.attachmentDisk`，默认 `local` = `storage/`），元数据在 `npFiles`（`2026100400001_np_attachments`：`@nocobase/app-plugin-file` 要求的 9 列 + `uploadedById`、`issueId`）。每行记住自己的 `disk` / `key`，默认 disk 换成 S3 兼容的 OSS 后旧文件照常读取。架构选择见 ADR-0005。

| 接口                                            | 说明                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/npFiles:uploadOne`                   | 文件插件的上传路由（multipart，字段 `file`，每次一个）。浏览器守卫（拒绝运行令牌 403、未登录 401、`ensureMember`）。请求体上限 `attachmentMaxFileSize`（默认 20 MiB）+ 64 KiB，超出 413 `BODY_TOO_LARGE`。答 `{ data: { record } }`，`record.contentUrl` 已带应用前缀；文件未挂任务，`uploadedById` 由上传 Policy 从会话用户写入。资源上不开放其它 action。 |
| `GET /uploads/np/<uuid>.<ext>`                  | 文件插件的内容路由（`stream`，`Content-Disposition: attachment`，`Cache-Control: private, no-store`）。前置守卫：未登录 401、运行令牌 403；看不到 → 404（挂了任务 = 任务可见性，未挂 = 仅上传者）。                                                                                                                                                         |
| `GET /np/issues/:id/attachments`                | `IssueAttachment[]`（按上传时间）。任务不可见 404。                                                                                                                                                                                                                                                                                                         |
| `POST /np/issues/:id/attachments` `{ fileIds }` | 挂上调用者自己上传、尚未挂任务的文件（1–10 个），答挂后的列表；其它 id 400 `INVALID_ATTACHMENT`，整批不生效。记 `attachment_added`（`details.filenames`）。                                                                                                                                                                                                 |
| `DELETE /np/issues/:id/attachments/:fileId`     | 204。上传者、任务负责人、项目负责人、owner/admin；其他人 403，不在该任务上 404。删行后按行的 disk/key 尽力删对象（失败只记日志），记 `attachment_removed`（`details.filename`）。                                                                                                                                                                           |
| `POST /np/issues` `attachmentIds?`              | 同上规则，在建任务的事务里挂上；不合法则整个创建 400。                                                                                                                                                                                                                                                                                                      |

- **AI 整理带附件**（迁移 `2026100400002_np_file_intake_batch`：`npFiles.intakeBatchId`）：`POST /np/intake/batches` 追加 `attachmentIds?`（调用者自己上传、未挂任务、未进其它批次，1–10 个；否则 400 `INVALID_ATTACHMENT`，批次不创建）。文件跟着批次走，全部先放进第一条顶层草稿的 `fields.attachmentIds`；草稿的 `fields.attachmentIds` 可随 `PUT …/drafts` 在草稿之间移动（格式不对进 `validation.errors`）。批次详情与创建响应追加 `attachments: IntakeBatchAttachment[]`（`contentUrl` 带应用前缀，确认后带 `issueId`）。确认时（在触发运行之前）每个文件挂到它所在草稿建出的任务，不在任何草稿里的挂到第一个建出的任务，记 `attachment_added`。批次还是草稿时文件不算孤儿；批次取消 / 已确认后仍未挂的，照常 24 小时后清理。批次里的文件不能再用 `POST /np/issues/:id/attachments` 挂到别处。
- 前端：三处上传（AI 整理、手动新建、任务详情附件卡）都支持选择、拖入、粘贴；AI 整理和手动新建把文件粘贴或拖进描述框即上传，详情页拖到或粘贴到附件卡上即上传。`FileUploadField`（应用自有的 Registry 副本）为此加了 `ref` 句柄 `addFiles(files)`，升级 Registry 时要保留。
- Agent 读任务（`IssueForAgentV4`，claim 载荷与 `GET /np/agent/issues/:id`）多 `attachments: { filename, mimeType, size }[]`，本期不提供内容下载。
- sweeper 每轮清理创建超过 24 小时仍未挂任务的上传（行 + 对象，每轮最多 200 个）。
- 写操作发 `issue.changed`（详情页实时刷新），不产生收件箱项。
- 类型：`IssueAttachment`、`AttachFilesRequest`、`IntakeBatchAttachment`、`IntakeBatchAttachmentsField`、`CreateIssueAttachmentFields`、`AgentAttachmentInfo`、`IssueForAgentAttachmentFields`、`MAX_ATTACHMENTS_PER_REQUEST`、`ERROR_INVALID_ATTACHMENT`；`ActivityActionPhase1Iter4` 追加 `'attachment_added' | 'attachment_removed'`。
- 配置：`NOCOPROJECT_ATTACHMENT_DISK`、`NOCOPROJECT_ATTACHMENT_MAX_FILE_SIZE`（字节）。单次挂载上限是常量 10（`MAX_ATTACHMENTS_PER_REQUEST`）。前端的单文件大小检查按默认 20 MiB，改了服务端上限时服务端仍以 413 为准。
- 未实现：评论附件、富文本内嵌图片、Agent 下载内容、Range/206、内容嗅探与病毒扫描。
