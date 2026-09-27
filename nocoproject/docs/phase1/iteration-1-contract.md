# Phase 1 迭代 1 契约

> 在 `docs/phase0/protocol.md` 之上追加，不推翻。类型追加在 `server/modules/shared/protocol.ts` 的 "Phase 1 迭代 1" 段落。路径前缀仍是 `/api/np`。
> 术语：`terminal` = 状态分类为 done 或 closed；`dormant` = backlog 或 terminal。

## A. 数据模型追加

新表（逻辑名 camelCase，字符串雪花 id，带 createdAt/updatedAt）：

| 表 | 字段 | 约束 |
|---|---|---|
| `members` | userId, role('owner' \| 'admin' \| 'member'), joinedAt | unique(userId) |
| `projectMembers` | projectId, userId, role('lead' \| 'member') | unique(projectId,userId) |
| `projectResources` | projectId, type('gitRepo'), ref(json: {url, defaultRef}), label, position | index(projectId) |
| `workflows` | name, isDefault(bool), definition(json，见 §C) | 只有一条 isDefault |
| `issueLabels` | name, color(string，语义色名 'gray' \| 'red' \| 'orange' \| 'yellow' \| 'green' \| 'blue' \| 'purple') | unique(name) |
| `issueLabelLinks` | issueId, labelId | unique(issueId,labelId) |
| `issueDependencies` | issueId, dependsOnIssueId, type('blockedBy' \| 'relatedTo'), createdByType, createdById | unique(issueId,dependsOnIssueId,type)；禁止自指与直接互指 |
| `executorProposals` | issueId, proposedAgentId, proposedByAgentId, sourceRunId, status('pending' \| 'accepted' \| 'rejected' \| 'autoAccepted'), decidedById, decidedAt, reason | index(issueId,status) |
| `issueSubscribers` | issueId, userId, reason('creator' \| 'owner' \| 'executor' \| 'commenter' \| 'mentioned' \| 'manual'), unsubscribedAt | unique(issueId,userId) |
| `inboxItems` | userId, kind('decision' \| 'info'), type(见 §E), issueId, title, body, actorType, actorId, actorName, count(int，合并次数), dedupeKey, readAt, archivedAt, resolvedAt, payload(json) | index(userId,kind,archivedAt)；unique(dedupeKey) where resolvedAt is null（PostgreSQL 部分索引，其他方言跳过） |
| `agentAccessGrants` | agentId, userId | unique(agentId,userId) |
| `agentDelegationGrants` | agentId, targetAgentId, grantedById | unique(agentId,targetAgentId) |

列追加：

| 表 | 追加 |
|---|---|
| `projects` | visibility('everyone' \| 'members'，默认 everyone), leadUserId, status('planned' \| 'in_progress' \| 'paused' \| 'completed' \| 'cancelled'，默认 planned), priority, startDate, dueDate, workflowId(可空，空即默认模板) |
| `issues` | stage(int，可空), startDate, dueDate, autoExecuteSubtasks(bool，默认取系统设置), suggestedExecutorAgentId(可空) |
| `agents` | access 改为 'ownerOnly' \| 'specificUsers' \| 'everyone'（迁移把旧值原样保留） |
| `runs`、`runSessions` | branchName(可空), repoUrl(可空) |
| `systemSettings.settings` | json 里新增 `autoExecuteSubtasksDefault: false`、`prMergedStatus: 'done'`（迭代 2 用） |

## B. 成员、角色与权限规则

**成员引导**：`/np/*` 的任何已登录请求先经过 `ensureMember`：`members` 为空时把调用者写成 owner；已登录但无成员行的写成 member。

**页面授权**：非 root 用户也要能打开 `np-issues`、`np-agents`、`np-runtimes`、新增的 `np-inbox`、`np-projects` 页。服务端在 Provider `boot()` 里把这些 page 资源授予 NocoBase 权限集 `member`（配置里的 `defaultSet`），或在种子里授予；必须用一个新注册的普通用户实测。成员设置页是 settings 路由，资源 `settings:np-members`，只授予 owner/admin（通过应用层 `members.role` 判断，settings 项注册后授予全员可见，服务端接口再按角色拒绝）。

**应用层规则**（服务端 `shared/authz.ts` 统一实现，路由调用；前端只做隐藏）：

| 动作 | 允许 |
|---|---|
| 看任务 | 任务无项目，或项目 visibility=everyone，或调用者是该私有项目成员，或 owner/admin |
| 建任务、评论、改标题描述优先级日期标签执行者状态（非终态） | 能看到该任务的成员 |
| 改负责人 | 当前负责人、项目 lead、owner/admin |
| 写 done / cancelled | 任务负责人、项目 lead、owner/admin |
| 分配、@、确认建议给某 Agent | 调用者对该 Agent 有访问权：ownerOnly → Agent 所有者；specificUsers → 所有者或名单内；everyone → 所有成员 |
| 建 Agent | 运行时是自己的，或运行时 visibility=public |
| 改 Agent、访问范围、委派名单 | Agent 所有者、owner/admin |
| 建项目 | 任何成员 |
| 改项目、项目成员、资源 | 项目 lead、owner/admin |
| 删项目 | owner/admin |
| 运行时改 visibility | 运行时所有者 |
| 成员角色 | owner/admin 改 admin/member；只有 owner 能授予或撤销 owner；最后一个 owner 不能被降级 |

违规返回 403 `{ code: 'FORBIDDEN', message }`；看不到的任务返回 404（不泄露存在）。

## C. 工作流模板（迭代 1 只有默认模板，可读不可编辑）

```jsonc
definition = {
  "statuses": [ { "key": "backlog", "name": "Backlog", "category": "unstarted", "color": "gray", "builtIn": true }, ... 7 个内置 ],
  "transitions": [
    { "from": "*", "to": "*", "actors": ["user"] },                     // 人可任意
    { "from": "todo", "to": "in_progress", "actors": ["agent"] },
    { "from": "blocked", "to": "in_progress", "actors": ["agent"] },
    { "from": "in_progress", "to": "in_review", "actors": ["agent"] },
    { "from": "in_progress", "to": "blocked", "actors": ["agent"] },
    { "from": "in_progress", "to": "todo", "actors": ["system"] },    // 失败回退
    { "from": "*", "to": "done", "actors": ["system"] }                 // 迭代 2 PR 合并
  ],
  "childBatchDoneWakesParentExecutor": true
}
```

种子 `2026092800002_np_default_workflow` 写入名为"软件开发"的默认模板。`status.ts` 改为从模板读取（缓存 + 变更失效）；`statusCatalog` 与 `agentTransitions` 从项目的模板计算（无项目用默认模板）。

接口：`GET /np/workflows` → `{ data: Workflow[] }`；`GET /np/workflows/:id`。

## D. 子任务、依赖、批次、放行、批次完成

**阻塞判定** `isBlocked(issue)`：存在 `blockedBy` 依赖且目标未到终态；或 `stage` 非空且同父任务下存在 `stage` 更小且未到终态的兄弟。

**触发模块规则追加**（见 `docs/phase0/protocol.md` §2 表）：

| 动作 | 结果 |
|---|---|
| 任何本应入队的触发，但 `isBlocked(issue)` | 不入队；写活动 `run_deferred_blocked`（details: blockers[]）；不建运行 |
| 某任务进入终态 | 对每个直接依赖它的任务、以及同父下一批次的兄弟：若不再阻塞、执行者是 Agent、状态是 todo → 入队 `dependencyReleased`（actorUserId = 该任务负责人）；执行者为空 → 收件箱 info `dependency_released` 给负责人 |
| 某子任务进入终态，且同批次（无批次则全部）子任务全部终态 | 父任务负责人收件箱 info `batch_done`；父执行者是 Agent 且父状态非 dormant 且模板 `childBatchDoneWakesParentExecutor` → 入队 `childBatchDone`（actorUserId = 父负责人；合并规则照旧） |
| 负责人确认执行者建议 | 设执行者 → 走 `assign` 规则，trigger.type = `proposalAccepted` |

**Agent 建子任务**（`POST /np/agent/issues`，运行令牌）：

```
{ title, description?, parentIssueId?（默认运行所属任务）, stage?, blockedBy?: string[]（id 或 identifier）, priority?, labels?: string[]（名称，不存在则创建）,
  executor?: 'self' | 'none' | <agentId>（默认 'none'） }
```
- 负责人 = 父任务负责人；创建者 = Agent；`autoExecuteSubtasks` 继承父任务。
- `executor: 'self'`：父任务 `autoExecuteSubtasks=true` → 执行者 = 该 Agent，按 §2 规则入队（受阻塞判定）；否则执行者为空，写 `executorProposals(proposedAgentId=self, status=pending)` 并把 `suggestedExecutorAgentId` 设为自己。
- `executor: <其他 agentId>`：该 Agent 的委派名单包含目标 → `autoAccepted`，执行者 = 目标，入队；否则 `pending` 建议。
- 每个待确认建议给父任务负责人一条 decision 收件箱项 `proposal_pending`，`dedupeKey = user:<owner>:proposal:<parentIssueId>`，多条建议合并为一张卡（count 递增）。

**建议的确认与驳回**：`POST /np/issues/:id/proposals/:proposalId/accept|reject { reason? }`；批量 `POST /np/issues/:parentId/proposals/accept-all`。确认者对目标 Agent 必须有访问权。

**依赖接口**：`POST /np/issues/:id/dependencies { dependsOnIssueId, type }`、`DELETE /np/issues/:id/dependencies/:dependencyId`。禁止环（沿 blockedBy 做 DFS，深度上限 100）。

任务详情追加：`subtasks: SubtaskSummary[]`（id, identifier, title, statusKey, stage, executorName, blockedCount）、`blockedBy: [{ dependencyId, issueId, identifier, title, statusKey }]`、`blocks: [...]`、`proposals: ExecutorProposal[]`、`subscribers: [{ userId, name, reason }]`、`labels: Label[]`、`parent: { id, identifier, title } | null`、`project: { id, name } | null`。

## E. 订阅与收件箱

**自动订阅**：创建者、负责人（含更换后的新负责人）、执行者是成员时、评论者、在描述或评论中被 @ 的成员（`[@Name](mention://user/<userId>)`）。`POST /np/issues/:id/subscribe|unsubscribe`。

**收件箱类型**：

| type | kind | 收件人 | 何时 |
|---|---|---|---|
| review_requested | decision | 负责人 | Agent 把状态改为 in_review |
| agent_blocked | decision | 负责人 | Agent 把状态改为 blocked，或运行以 agentBlocked 失败 |
| proposal_pending | decision | 父任务负责人 | 执行者建议 |
| batch_done | info | 父任务负责人 | 子任务批次完成 |
| dependency_released | info | 负责人 | 阻塞解除但无执行者 |
| run_failed | info | 订阅者 | 运行最终失败（无重试） |
| owner_assigned | info | 新负责人 | 负责人变更 |
| executor_assigned | info | 执行者（成员） | 执行者设为成员 |
| mentioned | info | 被 @ 的成员 | 评论或描述 @ |
| commented | info | 订阅者 | 新评论 |
| status_changed | info | 订阅者 | 状态变化 |

规则：自己的动作不通知自己；`dedupeKey = user:<userId>:<type>:<issueId>`，未处理（`resolvedAt` 为空）的同 key 项合并（count+1、更新 body 与时间、置未读）；任务进入 in_review 或终态时其 `run_failed` 自动归档；decision 项在对应动作完成后（验收：状态离开 in_review；建议：全部决定；blocked：状态离开 blocked）自动 `resolvedAt`。

接口：`GET /np/inbox?kind=decision|info&archived=false&cursor=` → `{ data: InboxItem[], unread: { decision, info } }`；`POST /np/inbox/:id/read|unread|archive|unarchive`；`POST /np/inbox/read-all { kind? }`；`GET /np/inbox/unread-count`。实时：用户主题 `np:inbox` 载荷 `{ kind: 'inbox.changed' }`（在 Provider 里 `defineTopic('np:inbox', { audience: 'user' })`）。

## F. 项目

```
GET    /np/projects                         → ProjectListItem[]（含 issueCounts: { total, done, byStatus }, leadName, memberCount, visibility）
POST   /np/projects   { name, description?, visibility?, leadUserId?, startDate?, dueDate?, priority? }
GET    /np/projects/:id                     → ProjectDetail（+ members[], resources[], workflow）
PATCH  /np/projects/:id
DELETE /np/projects/:id                     （任务解除关联，不删任务）
POST   /np/projects/:id/members { userId, role }   DELETE /np/projects/:id/members/:userId
POST   /np/projects/:id/resources { type:'gitRepo', url, defaultRef?, label? }   PATCH/DELETE /np/projects/:id/resources/:rid
GET    /np/members                          → [{ userId, name, email, role }]   （成员选择器用；任何成员可读）
PATCH  /np/members/:userId { role }        （规则见 §B）
GET    /np/labels  POST /np/labels { name, color }  PATCH/DELETE /np/labels/:id
```
任务列表 `GET /np/issues` 追加筛选 `projectId`、`labelId`、`ownerUserId`、`executorId`、`parentIssueId`、`view=board`（返回按状态分组 `{ groups: [{ statusKey, issues[] }] }`）。

## G. 任务字段

`PATCH /np/issues/:id` 追加：`stage`、`startDate`、`dueDate`、`labelIds[]`、`autoExecuteSubtasks`、`parentIssueId`、`projectId`（改项目要求对目标项目可见）。`POST /np/issues` 追加同样字段与 `blockedBy[]`。

**确认开始**：把执行者设为 Agent，或把任务移出 backlog 且执行者是 Agent 时，请求可带 `start: false` 表示"暂不开始"（只改字段不入队）；默认 `true`。前端弹窗里展示 `autoExecuteSubtasks` 开关并随请求提交。

## H. Agent

`agents.access` 三档；`POST/PATCH /np/agents/:id` 接受 `access`、`accessUserIds[]`、`delegationTargetIds[]`。`GET /np/agents` 每行追加 `canInvoke`（当前用户是否有访问权）、`ownerName`、`delegationTargets: [{ id, name }]`、`accessUserIds`。执行者选择器用 `canInvoke` 禁用无权项；服务端在分配、@、确认建议时强制。

## I. 守护进程与 CLI

**认领载荷追加**（`ClaimedRun`）：
```
project: { id, name, description, resources: [{ type:'gitRepo', url, defaultRef }] } | null
issue: + { parent: { id, identifier, title } | null, stage, autoExecuteSubtasks, projectId }
agent: + { delegationTargets: [{ id, name }] }
session: + { branchName, repoUrl }
```
守护进程在启动工具前把认领载荷的这些部分写入 `<workDir>/.nocoproject/context.json`（0600），并注入 `NOCOPROJECT_WORKDIR=<workDir>`。

**仓库 checkout**（由 CLI 执行，不经守护进程 RPC）：`nocoproject repo checkout <url> [--ref <ref>] [--fresh] [--json]`
- `url` 必须在 `context.json` 的项目资源里（大小写不敏感、忽略 `.git` 后缀），否则退出码 5 `REPO_NOT_ALLOWED`。
- 裸仓缓存 `~/.nocoproject/repos/<sha1(url)>.git`（`git clone --bare` 或 `git fetch --prune`）。
- 工作树放在 `$NOCOPROJECT_WORKDIR/<repoName>/`：`git worktree add`。分支 `agent/<agentSlug>/<issueIdentifier 小写>`；分支已存在（同任务续接）则 checkout 它并 `merge --ff-only` 上游 ref 失败时不合并只提示；`--fresh` 删除已有工作树重新来。
- 完成后写 `<workDir>/.nocoproject/checkout.json`：`{ url, ref, branchName, path }`；标准输出打印路径；`--json` 输出同一对象。
- 守护进程在完成/失败回报时读取 `checkout.json`，把 `branchName`、`repoUrl` 放进 `DaemonCompleteRequest` / `DaemonFailRequest`；服务端存到 `runs` 与 `runSessions`。
- git 身份：不改全局；若工作树内没有 user.name/email，用 `git config --worktree` 设为 `NocoProject Agent <agent@nocoproject.local>`。

**CLI 追加**（运行令牌模式）：
```
nocoproject issue create --title T [--description-file F | --description D] [--parent ID] [--stage N] [--blocked-by ID,ID] [--executor self|none|<agentId>] [--priority p] [--label a,b] --json
nocoproject issue children <issue> --json            → 子任务列表（含 stage、statusKey、blockedCount）
nocoproject issue dependency add <issue> --blocked-by <other>   |  remove <issue> --blocked-by <other>
nocoproject project get --json                        → context.json 里的项目与资源
nocoproject repo checkout ...
```
对应服务端 Agent 回写接口：`POST /np/agent/issues`（§D）、`GET /np/agent/issues/:id/children`、`POST/DELETE /np/agent/issues/:id/dependencies`、`GET /np/agent/context` 追加 `project`。

**Codex 适配器**：本机 Codex 0.154 有 `codex exec [PROMPT]` 非交互模式与 `codex exec resume <sessionId> [PROMPT]`。优先用 `exec`：核实 JSON 事件输出参数（`--json` 或等价）、会话 id 的获取方式、无人值守参数（`-s danger-full-access` 与免审批参数）、`-m` 模型；把真实输出录成夹具。若 `exec` 拿不到结构化事件流再退回 `codex app-server`。简报文件是 `AGENTS.md`。

**简报追加章节**：`## Repositories`（资源清单、checkout 命令、分支规则、PR 用 `gh pr create` 且标题含任务编号）、`## Project Context`（名称、描述）、`## Sub-issues`（何时拆、`--stage`/`--blocked-by`、`--executor self` 的含义与父任务开关、指定其他 Agent 会变成建议、不要 @ 其他 Agent）、`## Parent coordination`（作为父任务执行者被 `childBatchDone` 唤醒时：读子任务、调整、推进、全部完成后写 in_review 并总结）。每轮提示对 `childBatchDone` / `dependencyReleased` 触发给出对应开场句。

## J. 前端（迭代 1）

优先级从高到低：
1. **看板** `/issues?view=board`：列 = 项目（或默认）模板的状态；`@dnd-kit/core` + `@dnd-kit/sortable`（加到 devDependencies）；拖拽 → PATCH statusKey；转换非法（403 TRANSITION_NOT_ALLOWED 或 409）弹回并 toast；移出 backlog 且执行者是 Agent → "确认开始"弹窗（列出 Agent、`autoExecuteSubtasks` 开关、"开始 / 暂不开始"）。列表与看板切换按钮，筛选进 URL 查询串。
2. **任务详情升级**：子任务区（列表、阶段分组、"等待 N 项前置"、新建子任务弹窗含 stage/blockedBy/executor）、依赖区（添加/移除，选择器搜索任务）、标签、日期、负责人选择器（`GET /np/members`）、执行者选择器按 `canInvoke` 禁用、执行者建议卡（逐条或全部确认、驳回）、订阅按钮与订阅者头像、父任务面包屑、项目选择。分配 Agent 时弹"确认开始"。
3. **收件箱** `/inbox`：两个标签"待我决定 / 通知"，未读数，卡片点开到任务，右键或按钮：已读/未读/归档；顶部"全部已读"。实时 `np:inbox`。导航标题 Inbox/收件箱，图标 Inbox。
4. **项目** `/projects`、`/projects/:id`（按状态分列的任务 + 右栏：状态、优先级、负责人、日期、进度条、描述、资源（添加 gitRepo）、成员与可见性）、`/projects/new`。
5. **Agent 详情** `/agents/:id`：编辑指令、模型、并发、访问范围（三档 + 成员多选）、委派名单（Agent 多选）、运行时。
6. **成员设置** `/settings/members`：列表 + 角色下拉（按规则禁用）。
7. Phase 0 遗留：运行记录里命令直接可见（工具行显示 `input.command` 摘要）；DataTable 去掉"selected"计数（在 `client/components/data-table.tsx` 加 `showSelectedCount` 开关，默认保持原样）；失败原因码翻译；`/issues` 的搜索与状态筛选进 URL。

## K. 类型与常量

追加到 `protocol.ts`（服务端为准，复制到 CLI）：`MemberRole`、`ProjectVisibility`、`ProjectStatus`、`LabelColor`、`DependencyType`、`ProposalStatus`、`SubscriptionReason`、`InboxKind`、`InboxItemType`、`WorkflowDefinition`、`Label`、`IssueDependency`、`ExecutorProposal`、`InboxItem`、`ProjectResource`、`ProjectMember`、`AgentCreateIssueRequest`、`ClaimedProject`、`RunTriggerType` 增加 `dependencyReleased | childBatchDone | proposalAccepted`、`RUN_ENV.workDir = 'NOCOPROJECT_WORKDIR'`、`DaemonCompleteRequest/DaemonFailRequest` 增加 `branchName? repoUrl?`。
