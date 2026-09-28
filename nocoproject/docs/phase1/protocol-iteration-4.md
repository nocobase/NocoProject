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

`ActivityActionPhase1Iter4 = 'process_selected' | 'design_skipped' | 'design_proposed' | 'design_approved' | 'design_changes_requested' | 'retrospective_done' | 'pr_merge_requested'`。

NP-85 追加（§8）：`PullRequestMergeBlocker`、`PullRequestMergeKeepReason`、`PullRequestMergeOutcome`、`PullRequestMergePreflight`、`MergePullRequestRequest`、`MergePullRequestResponse`、`IssuePullRequestPhase4Fields`、`IssuePullRequestViewV4`、`InboxActionV4`、`ERROR_PR_NOT_MERGEABLE`、`ERROR_PR_CHANGED`、`ERROR_GITHUB_MERGE_FORBIDDEN`。

## 6. 错误码一览（本轮新增）

`INVALID_PROCESS`（400）、`PROCESS_LOCKED`（409）、`DESIGN_NOT_APPROVED`（403）、`PROPOSAL_REQUIRED`（409）、`NOT_DESIGN_FIRST`（409）、`DESIGN_ALREADY_APPROVED`（409）、`INVALID_CONTENT`（400）、`ISSUE_NOT_IN_RUN`（403，design-proposal 指向别的任务）、`INVALID_KIND` / `INVALID_REASONING_EFFORT`（400）、`MANAGER_NOT_EXECUTOR`（400）、`MANAGER_ONLY`（403）、`PM_NOT_CONFIGURED`（409）、`INVALID_PM_AGENT`（400）；NP-85：`INVALID_EXPECTED_HEAD`（400）、`PR_NOT_MERGEABLE` / `PR_CHANGED` / `GITHUB_MERGE_FORBIDDEN`（409）。

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

## 8. 在任务页与收件箱合并 PR（NP-85）

迁移 `2026100200001_np_pr_merge`：`pullRequests` 加 `ciRunUrl`、`screenshotsUrl`（text，可空）。

### 8.1 权限

任务负责人、项目负责人（`leadUserId` 或 `projectMembers.role = lead`）、owner/admin（`authz.canMergePullRequest`，与写终态同一组人）。其他成员 403 `FORBIDDEN`；看不到的任务 404；未登录 401；运行令牌在 `/np/*` 上一律 403 `RUN_TOKEN_FORBIDDEN`（`rejectRunTokens`），服务层对非 user actor 也返回 403。

### 8.2 接口

- `GET /np/issues/:id/pull-requests/:prId/merge` → `PullRequestMergePreflight`：`{ blocker, method: 'squash', headSha, baseRef, commitTitle, statusAfter: { statusKey, statusName, keepReason } }`。每次都向 GitHub 取 PR 与检查的最新状态并写回快照。`blocker` 为 null 表示可以合并，否则按顺序取第一个：`merged` / `closed` / `draft` / `conflicts`（`mergeable === false` 或 `mergeable_state = dirty`）/ `computing`（`mergeable === null`）/ `ciPending` / `ciFailed` / `ciMissing`（没有任何 commit status 或 check suite）/ `notConfigured`（没有令牌）。`statusAfter.keepReason`：`terminal`（任务已是终态）/ `setting`（`prMergedStatus = none`）/ `optedOut`（本 PR 关闭了自动完成）/ `otherPrs`（还有未合并的计数 PR）。
- `POST /np/issues/:id/pull-requests/:prId/merge`，请求体 `{ expectedHeadSha }`（缺省 400 `INVALID_EXPECTED_HEAD`）→ `{ merged: true, sha }`。重做一遍 preflight 检查（GitHub 最新状态）；有 blocker 时 409 `PR_NOT_MERGEABLE`，`details.blocker` 写明原因；head 与 `expectedHeadSha` 不同时 409 `PR_CHANGED`。然后 `PUT /repos/{repo}/pulls/{n}/merge`（`merge_method: squash`、`sha: head`、`commit_title: "<标题> (#<编号>)"`），令牌取自“设置 → GitHub”。GitHub 的返回：403 / 404 → 409 `GITHUB_MERGE_FORBIDDEN`（令牌缺少 Contents 与 Pull requests 写权限）；401 → 409 `GITHUB_AUTH_FAILED`；405 → 409 `PR_NOT_MERGEABLE`（`blocker: 'protected'`，分支保护）；409 → 409 `PR_CHANGED`；其他 → 502 `GITHUB_REQUEST_FAILED`。错误不带 GitHub 的原文与令牌。
- 成功时记活动 `pr_merge_requested`（actor = 当前用户，`details: { pullRequestId, repo, number, url, sha, method: 'squash' }`），emit `issue.changed`。**不改任务状态，也不改 PR 行的 state**：任务由 GitHub 的 `pull_request closed` webhook 走现有合并流程（§C `merge-flow.ts`）改为 `settings.prMergedStatus`。
- 错误体新增可选字段 `details`（`ApiErrorBody.details`），目前只有 `PR_NOT_MERGEABLE` 使用。

### 8.3 列表与收件箱

- `GET /np/issues/:id/pull-requests`、任务详情 `pullRequests[]`、link / refresh / PATCH 的返回每项追加（`IssuePullRequestViewV4`）：`viewerCanMerge`（当前用户能否合并；Agent 与 PM 读接口恒为 false）、`ciRunUrl`（head 提交最新一次 Actions 运行）、`screenshotsUrl`（该运行名为 `screenshots` 且未过期的 artifact 的网页地址）。两个链接由 REST 刷新（link、refresh、preflight）写入；`check_suite` completed 的 webhook 处理完成后，在事务外用令牌补取一次（失败忽略）；`pull_request` webhook 带来新 head 时清空。
- 未解决的 `pr_review` 卡片，收件人能合并时 `payload.actions` 在 `openPr` 前加 `merge`（kind primary，POST 上面的合并路径，`confirm: 'prMerge'`、`pullRequestId`，按已存快照给 `disabledReason`），此时 `openPr` 降为 secondary。客户端遇到 `confirm: 'prMerge'` 打开确认框（先 GET preflight），不直接 POST。`InboxActionV4` 描述这几个字段。

### 8.4 与方案的出入

1. **REST 刷新不再把打开的 PR 写成 merged / closed**（refresh 与 preflight 调 `upsertPullRequest(…, { keepOpenState: true })`）：webhook 以“状态从 open 变为 merged”为触发，若在 webhook 之前先被刷新写成 merged，任务就不会自动完成。代价：没有配置 webhook 时，刷新也看不到合并 / 关闭（preflight 仍会返回 `merged` / `closed`）。
2. `statusAfter` 多 `statusName`（工作流模板里的状态名，前端优先用本地化状态名）。
3. PR 卡片上的置灰原因只按快照判断，不含 `computing`（快照没有 `mergeable`）。
