# NocoProject 协议：Phase 1 迭代 1（服务端实现，权威）

> 在 `docs/phase0/protocol.md` 之上追加；契约见 `iteration-1-contract.md`。本文记录服务端实际实现的请求 / 响应形状和与契约的出入，类型在 `server/modules/shared/protocol.ts` 的两段 "Phase 1 迭代 1"（契约类型 + "服务端实现补充的响应形状"）。路径前缀仍是 `/api/np`，成功 `{ data }`，失败 `{ code, message }`。

## 1. 通用约定

- 浏览器接口的每个前缀：拒绝运行令牌（403）→ `auth.required()`（401）→ `ensureMember`（首个登录用户成为 owner，其余首次访问成为 member）。守护进程接口也经过 `ensureMember`。
- 权限（`shared/authz.ts`）：违规 403 `{ code: 'FORBIDDEN' }`；看不到的任务 / 项目 404 `NOT_FOUND`（不泄露存在）。
- 日期字段（`startDate` / `dueDate`，任务与项目）是 `YYYY-MM-DD` 字符串（存为 `string(10)`），非法 400 `INVALID_DATE`。
- 实时：用户主题 `np:inbox`，载荷 `{ kind: 'inbox.changed' }`（收件人的收件箱有变化时推送）。其余主题不变；标签删除、依赖增删、建议决定都会推 `np:issues`。

## 2. 成员

| 接口                                       | 成功                                         | 说明                                                                                                                                 |
| ------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /np/members`                          | `Member[]` = `{ userId, name, email, role }` | 列出所有未禁用、未删除的用户；没有 `members` 行的按 `member` 显示（尚未访问过的用户也能被选为负责人）                                |
| `PATCH /np/members/:userId { role }`       | `Member`                                     | 只有 owner/admin；授予或撤销 owner 只有 owner；最后一个 owner 降级 409 `LAST_OWNER`；目标无成员行时创建；非法角色 400 `INVALID_ROLE` |
| `GET /np/me/preferences`                   | `{ inboxChime }`                             | 当前登录成员自己的偏好（NP-108）。`inboxChime`：待决定数增加时浏览器响一声，默认 `true`，存在 `members.inboxChime`，跟着账号走       |
| `PATCH /np/me/preferences { inboxChime? }` | `{ inboxChime }`                             | 只改自己的、只改给出的字段；任何成员都能改；`inboxChime` 不是布尔值时 400 `INVALID_PREFERENCES`                                      |

设置项 `settings:np-members`（动作 `read`）由 Provider 注册（工作区分区 `nocoproject`，挂在 administration 下）；种子 `2026092800003_np_member_page_grants` 把 `page:np-issues|np-agents|np-runtimes|np-inbox|np-projects` 的 `access` 和 `settings:np-members` 的 `read` 追加到默认权限集 `member`（只追加缺失项，只执行一次，管理员之后可在授权后台修改）。

## 3. 工作流模板

表名是 **`workflowTemplates`**（物理 `workflow_templates`）；契约写的 `workflows` 已被工作流插件占用。

| 接口                    | 成功                         |
| ----------------------- | ---------------------------- |
| `GET /np/workflows`     | `Workflow[]`（默认模板在前） |
| `GET /np/workflows/:id` | `Workflow`；不存在 404       |

默认模板 id 为 `default`，名称"软件开发"，定义与契约 §C 一致。`statusCatalog`（含 `agentWritable`）与 `agentTransitions`（通配符按目录展开成具体的 from→to）由任务所属项目的模板计算，无项目用默认模板；用于任务详情、认领载荷、`/np/agent/context`、Agent 改状态校验、人改状态校验（`user` 的转换，默认 `*→*`）。模板按 id 缓存在进程内，项目改 `workflowId` 时失效。

## 4. 任务

### 4.1 列表与看板

`GET /np/issues?statusKey=&projectId=&q=&labelId=&ownerUserId=&executorId=&parentIssueId=&view=`

- `parentIssueId=none` 只返回顶层任务；其余筛选如名。看不到的私有项目的任务被排除。
- 行 = `IssueListItemV1` = Phase 0 `IssueListItem` + `stage, startDate, dueDate, autoExecuteSubtasks, suggestedExecutorAgentId, labels: Label[], projectName, subtaskCount, blockedCount`。
- `view=board` → `{ data: { groups: [{ statusKey, issues: IssueListItemV1[] }] } }`：列是 `projectId` 对应模板（无则默认模板）的状态顺序；目录外的状态追加在末尾。

### 4.2 详情 `GET /np/issues/:id` → `IssueDetailV1`

Phase 0 字段 + `agentTransitions`、`subtasks: SubtaskSummary[]`（按编号）、`blockedBy` / `blocks: IssueDependency[]`（两个方向，`type` 区分 blockedBy / relatedTo）、`blockers: Blocker[]`（当前阻塞原因：`reason: 'dependency' | 'stage'`）、`proposals: ExecutorProposal[]`（本任务**及其直接子任务**的建议，父任务据此"全部确认"）、`subscribers: [{ userId, name, reason }]`（未退订的）、`labels`、`parent: { id, identifier, title } | null`、`project: { id, name } | null`。

### 4.3 创建与修改

`POST /np/issues` 追加：`stage`、`startDate`、`dueDate`、`labelIds[]`、`autoExecuteSubtasks`（缺省取系统设置 `autoExecuteSubtasksDefault`）、`parentIssueId`（未给 `projectId` 时继承父任务项目）、`blockedBy[]`（id 或编号）、`start`。响应 201 `{ data: IssueV1 }`。

`PATCH /np/issues/:id` 追加：`stage`、`startDate`、`dueDate`、`labelIds[]`（整组替换）、`autoExecuteSubtasks`、`parentIssueId`（不能是自己或自己的后代）、`projectId`（目标项目须可见）、`start`。

`start: false`（暂不开始）：只改字段，不触发 `assign` / `statusChange` 入队。

新增活动 `action`：`stage_changed`、`start_date_changed`、`due_date_changed`、`auto_execute_changed`、`parent_changed`、`project_changed`（项目删除时 `details.reason = 'projectDeleted'`）、`labels_changed { added, removed }`、`subtask_added`（写在父任务上）、`dependency_added` / `dependency_removed`、`proposal_created` / `proposal_auto_accepted` / `proposal_accepted` / `proposal_rejected`、`run_deferred_blocked { agentId, triggerType, blockers: [{ issueId, identifier, reason }] }`；`executor_changed` 由建议触发时带 `details.trigger`。

### 4.4 依赖、建议、订阅

| 接口                                                                   | 成功                                                                         | 说明                                                                                                                                                               |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /np/issues/:id/dependencies { dependsOnIssueId, type? }`         | 201 `IssueDependency`                                                        | 两个任务都须可见；自指 400 `INVALID_DEPENDENCY`，直接互指 / 成环 400 `DEPENDENCY_CYCLE`，链太深 400 `DEPENDENCY_TOO_DEEP`，重复 409 `DEPENDENCY_EXISTS`            |
| `DELETE /np/issues/:id/dependencies/:dependencyId`                     | `{ ok: true }`                                                               | `:dependencyId` 也可以是被依赖任务的 id / 编号                                                                                                                     |
| `DELETE /np/issues/:id/dependencies?dependsOnIssueId=`                 | `{ ok: true }`                                                               | 与 Agent 接口同形；删掉最后一个阻塞时按放行规则启动                                                                                                                |
| `POST /np/issues/:id/proposals/:proposalId/accept\|reject { reason? }` | `ExecutorProposal`                                                           | `:id` 是建议所在任务或其父任务；确认者须能调用目标 Agent（403）；已决定 409 `PROPOSAL_DECIDED`；确认后同一任务的其他待定建议置 rejected（`reason = 'superseded'`） |
| `POST /np/issues/:parentId/proposals/accept-all`                       | `{ accepted: ExecutorProposal[], skipped: [{ proposalId, code, message }] }` | 逐条确认（每条一个保存点），无权的记入 `skipped` 而不整体失败                                                                                                      |
| `POST /np/issues/:id/subscribe` / `unsubscribe`                        | `{ subscribed: boolean }`                                                    |                                                                                                                                                                    |

## 5. 收件箱

| 接口                                                                          | 成功                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /np/inbox?kind=decision\|info&archived=false&resolved=&issueId=&cursor=` | `{ data: InboxItem[], unread: { decision, info }, nextCursor: string \| null }`（`unread`、`nextCursor` 与 `data` 同级；`issueId` 只列关于该任务的项，2026-09-27 界面改版加入，供任务页「等你决定」） |
| `GET /np/inbox/unread-count`                                                  | `{ data: { decision, info } }`                                                                                                                                                                        |
| `GET /np/inbox/pending-count`                                                 | `{ data: { decision } }`（未解决、未归档的待决定项，已读也算；导航收件箱角标用，NP-107 加入）                                                                                                         |
| `POST /np/inbox/:id/read\|unread\|archive\|unarchive`                         | `InboxItem`；不是自己的 404                                                                                                                                                                           |
| `POST /np/inbox/read-all { kind? }`（请求体可省略）                           | `{ data: { unread: { decision, info } } }`                                                                                                                                                            |

- 按 `updatedAt` 倒序，每页 50；`archived` 默认 false；`resolved` 不传则都返回。未读数 = 未读、未归档、未解决。
- 合并：同 `dedupeKey` 且未解决的项 `count + 1`（若已归档则从 1 重新计），标题 / 正文 / actor / payload 替换，置未读并取消归档。`dedupeKey = user:<userId>:<type>:<issueId>`，`proposal_pending` 为 `user:<owner>:proposal:<parentIssueId>`。
- `title` = `<编号> <任务标题>`；`body` 是英文兜底句，前端应按 `type` + `payload` 本地化。`payload`：`review_requested`/`status_changed` `{ from, to }`；`agent_blocked`/`run_failed` `{ runId, agentId, reason }`（Agent 改 blocked 时为 `{ from, to }`）；`proposal_pending` `{ parentIssueId, pending, lastProposalId }`；`batch_done` `{ stage, childIssueIds }`；`dependency_released` `{ releasedBy, releasedByIdentifier }`；`commented`/`mentioned` `{ commentId }`（描述中 @ 无 payload）；`owner_assigned` `{ from }`（变更时）。
- 自动处理：状态离开 in_review → `review_requested` 解决；状态变为非 blocked → `agent_blocked` 解决；父任务下没有待定建议 → `proposal_pending` 解决；任务进入 in_review 或终态 → 其 `run_failed` 归档。
- 收件人细则：Agent 改 in_review / blocked 时负责人只收 decision，不再收同一变化的 `status_changed`；`system` 的状态变化（失败回退）不发 `status_changed`；Agent 建子任务不发 `owner_assigned`；被 @ 的成员收 `mentioned` 而不是 `commented`；自动订阅不覆盖用户的退订，负责人（`owner`）与手动订阅除外。

## 6. 项目与标签

| 接口                                                                                                           | 成功                                                                                                        | 权限                                                                                      |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `GET /np/projects`                                                                                             | `ProjectListItem[]` = `ProjectV1` + `leadName, memberCount, issueCounts: { total, done, byStatus }`         | 私有项目只对成员、lead、owner/admin 可见                                                  |
| `POST /np/projects { name, description?, visibility?, leadUserId?, status?, startDate?, dueDate?, priority? }` | 201 `ProjectDetail`                                                                                         | 任何成员；创建者成为成员，未指定时 lead = 创建者                                          |
| `GET /np/projects/:id`                                                                                         | `ProjectDetail` = 列表行 + `members: ProjectMember[]`, `resources: ProjectResource[]`, `workflow: Workflow` | 不可见 404                                                                                |
| `PATCH /np/projects/:id`（上述字段 + `workflowId`）                                                            | `ProjectDetail`                                                                                             | lead 或 owner/admin                                                                       |
| `DELETE /np/projects/:id`                                                                                      | `{ ok: true }`                                                                                              | owner/admin；任务 `projectId` 置空（revision + 1、写活动），删除成员与资源                |
| `POST /np/projects/:id/members { userId, role? }` / `DELETE .../members/:userId`                               | `ProjectMember[]`（全部成员）                                                                               | lead 或 owner/admin；移除当前 `leadUserId` 409 `LEAD_MEMBER`                              |
| `POST /np/projects/:id/resources { type: 'gitRepo', url, defaultRef?, label? }`                                | 201 `ProjectResource`                                                                                       | 同上；`url` 须以 `https://` `http://` `ssh://` `git@` `file://` 开头（400 `INVALID_URL`） |
| `PATCH /np/projects/:id/resources/:rid { url?, defaultRef?, label?, position? }` / `DELETE`                    | `ProjectResource` / `{ ok: true }`                                                                          | 同上                                                                                      |
| `GET /np/labels`、`POST { name, color? }`、`PATCH /:id`、`DELETE /:id`                                         | `Label[]` / 201 `Label` / `Label` / `{ ok: true }`                                                          | 任何成员；重名 409 `LABEL_EXISTS`；颜色非法 400 `INVALID_COLOR`                           |

`issueCounts.done` 统计分类为 `done` 的状态。

## 7. Agent 与运行时

- `GET /np/agents` / `GET /np/agents/:id`（新增）→ `AgentListItemV1` = Phase 0 行 + `access: 'ownerOnly' | 'specificUsers' | 'everyone'`、`canInvoke`、`canEdit`（新增，所有者或 owner/admin）、`ownerName`、`delegationTargets: [{ id, name }]`、`accessUserIds`。
- `POST` / `PATCH /np/agents/:id` 接受 `access`、`accessUserIds[]`、`delegationTargetIds[]`（都是整组替换）；响应改为 `AgentListItemV1`（Phase 0 为 `Agent`，字段是其超集）。
- 规则：绑定的运行时须是自己的或 public（403）；只有所有者或 owner/admin 能改（403）；新增委派目标要求调用者能调用该目标（403），不能委派给自己（400 `INVALID_DELEGATION`）。
- 访问：ownerOnly → 所有者；specificUsers → 所有者或名单内；everyone → 所有成员；归档的 Agent 不可调用。owner/admin **不**因角色获得调用权。在分配执行者、评论 @（`/note` 评论除外）、确认建议时强制。
- `PATCH /np/runtimes/:id { visibility: 'private' | 'public' }`（新增）：只有运行时所有者。

## 8. Agent 回写接口（运行令牌）

写范围：评论与状态仍只限运行所属任务；建子任务和依赖增删限运行所属任务**及其后代**（403 `ISSUE_NOT_IN_RUN`）。

| 接口                                                                                  | 成功                                                                                                                     |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `POST /np/agent/issues`（`AgentCreateIssueRequest`）                                  | 201 `{ data: { issue, proposal, triggered, blocked } }`                                                                  |
| `GET /np/agent/issues/:id/children`                                                   | `SubtaskSummary[]`                                                                                                       |
| `POST /np/agent/issues/:id/dependencies { dependsOnIssueId \| blockedBy, type? }`     | 201 `IssueDependency`                                                                                                    |
| `DELETE /np/agent/issues/:id/dependencies?dependsOnIssueId=<id\|编号>&type=blockedBy` | `{ ok: true }`（CLI 用法）                                                                                               |
| `DELETE /np/agent/issues/:id/dependencies/:dependencyIdOrIssue`                       | `{ ok: true }`                                                                                                           |
| `GET /np/agent/context`                                                               | `AgentContextResponseV1`：Phase 0 + `project: ClaimedProject \| null`，`issue` 为 `IssueForAgentV1`                      |
| `GET /np/agent/issues/:id`                                                            | `IssueForAgentV1` = Phase 0 + `parentIssueId, parent, projectId, stage, autoExecuteSubtasks, labels: string[], blockers` |

`POST /np/agent/issues` 的 `issue` 是完整任务行（`IssueV1`）合并 `IssueForAgentV1`（同名字段一致），CLI 读 `Issue` 字段或 Agent 视图字段都可以；`proposal` 为待定或 `autoAccepted` 的建议，否则 null；`triggered` 是入队结果；`blocked` 表示创建时已被阻塞。子任务：负责人 = 父任务负责人、项目与 `autoExecuteSubtasks` 继承父任务、状态 `todo`、`labels` 按名称查找不存在则创建（gray）、`blockedBy` 接受 id 或编号、`issues.createdById` 为 null（创建者见活动 `issue_created` 的 actor = Agent）。`executor` 规则同契约 §D；自己执行或委派接受时以父任务负责人身份入队 `assign`（`payload.createdByAgentId`、`payload.sourceRunId`）。

## 9. 守护进程

- 认领载荷（`ClaimedRunV1 = ClaimedRun & ClaimedRunPhase1Extras`）：`project`、`issue.{ parent, stage, autoExecuteSubtasks, projectId }`、`agent.delegationTargets`、`session.{ branchName, repoUrl }`；`statusCatalog` / `agentTransitions` 来自任务的模板。`session.branchName` / `repoUrl` 即使 `fresh = true`（会话被污染）也返回上次记录的值。
- `complete` / `fail` 接受可选 `branchName`、`repoUrl`（包括守护进程关闭时的 `runtimeRecovery` 失败回报），写入 `runs` 和 `runSessions`；空字符串忽略。

## 10. 触发规则追加（见 Phase 0 §2）

| 动作                                                                                                                            | 结果                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 任何新触发（assign、statusChange、mention、reply、comment、dependencyReleased、childBatchDone、proposalAccepted），但任务被阻塞 | 不建运行、不存触发；活动 `run_deferred_blocked`。重试（自动 / 手动）不受阻塞判定                                                                                                                   |
| 任务进入终态                                                                                                                    | 依赖它的任务、同父更大 stage 的兄弟：不再阻塞且执行者是 Agent、状态 todo → `dependencyReleased`（actorUserId = 该任务负责人，payload `{ releasedBy }`）；执行者为空 → 负责人 `dependency_released` |
| 删除依赖后不再阻塞                                                                                                              | 同上（`releasedBy` = 被删依赖指向的任务）                                                                                                                                                          |
| 子任务进入终态且同批次（同 stage；子任务无 stage 时为全部子任务）都已终态                                                       | 父负责人 `batch_done`；父执行者是 Agent、父非 dormant、模板开关开 → `childBatchDone`（payload `{ stage, childIssueIds }`，按原合并规则并入父任务待处理运行）                                       |
| 确认建议                                                                                                                        | 设执行者并走 assign 规则，trigger.type = `proposalAccepted`                                                                                                                                        |
| Agent 建子任务且执行者已确定                                                                                                    | assign，actorUserId = 负责人                                                                                                                                                                       |

## 11. 与契约的出入

1. 表 `workflows` → `workflowTemplates`（名字冲突）。
2. 日期列是 `string(10)`（`YYYY-MM-DD`），避免 `date` 类型的时区换算。
3. `systemSettings.settings` 是新加的 json 列（Phase 0 没有 `settings` 列）；迁移给已有行回填默认值，缺失时服务按默认值读。
4. `GET /np/members` 列出所有用户（没有成员行的按 member），而不只 `members` 表里的。
5. owner/admin 看得到所有私有项目（契约"看任务"一行如此），但调用 Agent 仍按 Agent 访问级别，不因角色放宽。
6. 标签任何成员都能增删改（契约未规定）。
7. 项目未指定 lead 时，lead = 创建者；创建者自动成为项目成员。
8. 子任务的 `issues.createdById` 为 null（该列存用户 id），"创建者 = Agent" 体现在活动里。
9. 接受建议的 `:id` 可以是子任务或父任务；`accept-all` 部分成功，无权的列入 `skipped`。
10. 评论 @ 无权 Agent 时整条评论 403（`/note` 评论例外），而不是静默不触发。
11. `status_changed` 不对 `system` 动作发送；负责人对 Agent 的 in_review / blocked 只收 decision；Agent 建子任务不发 `owner_assigned`。
12. 新增接口（契约未列）：`GET /np/agents/:id`、`PATCH /np/runtimes/:id`、`GET /np/inbox` 的 `resolved` 与 `nextCursor`、`DELETE /np/issues/:id/dependencies?dependsOnIssueId=`。
13. `POST/PATCH /np/agents` 的响应从 `Agent` 变为 `AgentListItemV1`（超集）。
14. `protocol.ts` 的 Phase 0 类型只改了一处：`AgentContextResponse` 追加可选 `project`（CLI 要求）；其余新类型都在文件末尾追加。`protocol.ts` 因此超过 800 行（契约段落在此之前已使其超过）。
