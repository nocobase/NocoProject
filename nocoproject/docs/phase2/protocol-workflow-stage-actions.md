# NocoProject 协议：Phase 2 工作流阶段动作（服务端实现，权威）

> NP-77 方案第 2 版 stage 1（NP-81）。在 Phase 1 迭代 1–4 协议之上追加。契约类型在 `server/modules/shared/protocol.phase2-workflow.ts`（CLI 用 `pnpm sync-protocol` 复制），组合了服务端形状的 `IssueDetailV5Paged` 在 `protocol.phase2-workflow-server.ts`（CLI 不复制）；两者都由 `protocol.ts` 末尾 `export *`。路径前缀 `/api/np`，成功 `{ data }`，失败 `{ code, message }`（Phase 2 起可带 `details`）。模板提议 / 修订 / 写接口与 CLI 命令是 stage 2，界面是 stage 3。

## 1. 数据模型

迁移 `2026100200001_np_phase2_stage_actions`：

- `executorProposals.proposedByAgentId` 改为可空（工作流建议没有提议 Agent）；加 `source`（varchar 16，非空，默认 `'agent'`，值 `agent` / `workflow`）与 `stageStatusKey`（varchar 32，可空）。`status` 新值 `'superseded'` 不改列。
- 新表 `issueChecklistItems`：`id`、`issueId`、`statusKey`（32）、`itemKey`（64）、`label`（text）、`required`（bool）、`position`（int）、`checkedByType`（`user` / `agent`，可空）、`checkedById`（64，可空）、`checkedAt`、`createdAt`、`updatedAt`；唯一索引 `np_issue_checklist_items_unique (issueId, statusKey, itemKey)`。
- `down`：删表、删 `source = 'workflow'` 的建议、删两列、`proposedByAgentId` 恢复非空。
- `systemSettings.settings` 新键 `stageRunLimit`（默认 3）、`stageRunWindowHours`（默认 24），不改列。

## 2. 模板定义

`WorkflowStatusDefinitionV5.onEnter?: StageAction[]`（旧定义没有它，行为不变；两个种子模板不加动作）：

| type              | 字段                                                           | 类别                       |
| ----------------- | -------------------------------------------------------------- | -------------------------- |
| `notifyOwner`     | `message?`（≤ 500）                                            | 进入效果                   |
| `runExecutor`     | `agentId?`（空 = 当前 Agent 执行者）、`instruction?`（≤ 4000） | 进入效果                   |
| `suggestExecutor` | `agentId`、`reason?`                                           | 进入效果                   |
| `checklist`       | `items: { key, label, required }[]`（1–20 项）                 | 进入效果                   |
| `requirePrMerged` | `minCount?`（1–20，默认 1）                                    | 进入条件                   |
| `automation`      | `workflowKey`                                                  | 预留，校验拒绝，运行时跳过 |

指令模板变量只有 `{{issue.identifier}}`、`{{issue.title}}`、`{{from}}`、`{{to}}`、`{{owner.name}}`（花括号内可有空白）。

### 2.1 定义校验（`workflow/workflow.validate.ts`）

`validateWorkflowDefinition(definition, { base?, agentExists? })` 返回 `{ ok: true, definition }` 或 `{ ok: false, issues: [{ path, message }] }`；`assertValidWorkflow` 抛 400 `INVALID_WORKFLOW`，`details.issues` 列出全部问题（`path` 形如 `statuses[3].onEnter[0].agentId`）。stage 2 的提议与接受各跑一次，`base` 传当前修订。

- 结构（Zod，未知字段拒绝）；状态 ≤ 40、转换 ≤ 200、每个状态动作 ≤ 10。
- 9 个内置状态（`BUILTIN_STATUS_CATEGORIES`：7 个核心 + `analysis`、`proposal_review`）必须都在、`builtIn: true`、分类固定；自定义 key `^[a-z][a-z0-9_]{1,31}$`、不重复、不能 `builtIn: true`；`base` 里已有的状态分类不可改。
- 转换两端是已有状态或 `*`；Agent 不能写 done / closed 分类状态，也不能以 `*` 为目标；每个状态都要有人可走的出边（或有人的 `* → *`）。
- 动作：每个状态最多一个清单，清单项 key `^[a-z0-9][a-z0-9_-]{0,63}$` 状态内唯一；`runExecutor` / `suggestExecutor` 不能挂在 done / closed 分类状态；指令模板只允许白名单变量；`agentExists` 给出时，引用的 Agent 必须存在且未归档；`automation` 拒绝。

两个种子模板与 `BUILTIN_DEFINITION` 都通过校验（测试覆盖）。

## 3. 转换顺序

人 PATCH（`issues.patch`）、Agent 写状态（`POST /np/agent/issues/:id/status`）都走 `transitionPipeline`：

```
canTransition（Agent；人的在字段校验里）→ 设计门禁（Agent）→ 进入条件 → 审批门禁 → 写入 → 进入效果
```

- 进入条件（`workflow/stage-guards.ts`）在事务内检查，不通过什么都不改：
  - 目标状态有 `requirePrMerged`：任务关联的已合并 PR 数 < `minCount` → 409 `STAGE_PR_NOT_MERGED`；
  - 离开的状态有未勾的必填清单项，且目标不是 `closed` 分类 → 409 `CHECKLIST_INCOMPLETE`。
- 系统写（PR 合并流程 `systemSetStatus`、设计决定的 `writeStatusInTx`）不检查进入条件；运行失败回退 `in_progress → todo` 既不检查也不跑效果。
- 审批通过后应用（`applyApprovedTransition`）再检查一次。不满足时 `ApprovalHooks.applyTransition` 返回 `{ applied: false, code, message }`，网关把请求置为 `cancelled`（作废，状态枚举不变），记活动 `approval_stale { requestId, from, to, code, message }`，发 `approval.decided`（`cancelled`，审批卡片结束）与 `approval.stale`；`approve` 正常返回（200，`status: 'cancelled'`），任务状态不变。内存替身 `tests/logic/np-approval-memory.ts` 同样处理。

## 4. 进入效果（`workflow/stage-actions.ts`）

由 `triggers().onStatusChanged` 在同一事务内调用（所有经 `writeStatus` 或浏览器 PATCH 的状态变化）。离开某状态时，该状态未决定的工作流建议先置 `superseded`（`reason: 'stageLeft'`，发 `proposal.decided`，决定卡结束）。然后按定义顺序执行目标状态的效果，每个效果包在 savepoint 里：抛异常只回滚该效果自己的写入与事件，记 `stage_action_failed { action, statusKey, error }`，其余效果继续、转换照常生效。

| 动作              | 行为                                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `notifyOwner`     | 事件 `issue.stageEntered` → 负责人收件箱 `stage_entered`（info；负责人自己改的不通知）                                                                                                                                                                                                                                                                             |
| `runExecutor`     | 预设 `agentId` 且与当前执行者不同：负责人能调用该 Agent → 设为执行者（活动 `executor_changed { trigger: 'stageEntered' }`）；不能 → 降级为 `suggestExecutor`（`stage_action_skipped { reason: 'ownerCannotInvoke', downgradedTo, proposalId }`）。然后以负责人名义入队 `stageEntered` 运行，`payload = { from, to, instruction }`（渲染后的指令，无模板为 null）。 |
| `suggestExecutor` | 生成 `source = workflow`、`proposedByAgentId = null`、`stageStatusKey` 的待定建议；决定卡挂在任务自己上（不是父任务），负责人一键采纳走现有 `accept`（`proposalAccepted` 运行）。                                                                                                                                                                                  |
| `checklist`       | 按定义生成快照行；重新进入保留已有行及勾选状态，只补新增项。                                                                                                                                                                                                                                                                                                       |

跳过原因（`stage_action_skipped.details.reason`）：`noAgentExecutor`、`agentUnavailable`、`noOwner`、`ownerCannotInvoke`、`selfTriggered`（Agent 自己进入会唤醒自己的阶段）、`alreadyExecutor`、`duplicate`（同 Agent 已有待定建议）、`notImplemented`。前三个与 `ownerCannotInvoke` 以及 `stage_action_failed`、`stage_action_suppressed` 发 `issue.stageActionReported` → 负责人 `stage_action_problem`（info）；`selfTriggered`、`alreadyExecutor`、`duplicate` 不通知。成功记 `stage_action_applied { action, statusKey, ... }`（`runExecutor` 带 `agentId`、`runId`；`suggestExecutor` 带 `proposalId`；`checklist` 带 `added`）。

防循环：同一任务同一状态在 `stageRunWindowHours` 内已有 `stageRunLimit` 条 `runExecutor` 的 `stage_action_applied` → 记 `stage_action_suppressed { agentId, limit, windowHours }` 并通知负责人。`PATCH /np/settings` 可改（owner/admin；`stageRunLimit` 1–100、`stageRunWindowHours` 1–720 的整数，否则 400 `INVALID_FIELD`），`GET` 返回两项。

## 5. 检查清单接口

| 接口                                                                    | 说明                                                                             |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `GET /np/issues/:id/checklists`                                         | `{ data: IssueChecklist[] }`：当前状态在前，其余按生成顺序；看不到任务 404       |
| `PATCH /np/issues/:id/checklists/:statusKey/items/:itemKey { checked }` | `{ data: IssueChecklist }`；`checked` 不是布尔 400 `INVALID_FIELD`；没有该项 404 |
| `GET /np/agent/issues/:id/checklists`                                   | 同上，可读范围与 Agent 读任务相同                                                |
| `PATCH /np/agent/issues/:id/checklists/:statusKey/items/:itemKey`       | 只能写运行自己的任务（否则 403 `ISSUE_NOT_IN_RUN`）；勾选人记为该 Agent          |

`IssueChecklist = { statusKey, current, complete, items: [{ itemKey, label, required, checked, checkedByType, checkedById, checkedByName, checkedAt }] }`。每次勾选 / 取消记 `checklist_item_checked` / `checklist_item_unchecked { statusKey, itemKey, label, required, position }`。

## 6. 认领载荷与简报

- `issue.checklist`：当前状态的 `IssueChecklist`，没有清单为 null。简报（CLI `daemon/brief-workflow.ts`）在有未勾项时加 `## Stage checklist`，列出未勾项（必填加粗标注）并说明离开前必须勾完。
- `triggers[].stage`：`stageEntered` 触发带 `{ from, to, instruction }`。轮次提示写“进入了哪个阶段”，有指令时加一段“Stage instruction (阶段指令)”。
- 勾选清单的 CLI 命令在 stage 2（`nocoproject issue checklist`）；在此之前简报让 Agent 在交付评论里写明完成了哪些项。

## 7. 其它形状变化

- 执行者建议（任务详情 `proposals`、`accept` / `reject` / `accept-all`、Agent 建子任务的 `proposal`）是 `ExecutorProposalV5`：追加 `source`、`stageStatusKey`，`proposedByAgentId` / `proposedByAgentName` 可为 null，`status` 可为 `superseded`。`superseded` 不计入“执行者建议接受率”（指标只数 accepted / rejected）。
- 领域事件：`proposal.created.proposedByAgentId` 可为 null、追加 `source`；新增 `issue.stageEntered`、`issue.stageActionReported`、`approval.stale`。
- 收件箱类型追加 `stage_entered`、`stage_action_problem`、`approval_stale`（`InboxItemTypeV5`）。
- 触发类型追加 `stageEntered`（`RunTriggerTypeV5`）。

## 8. 与方案的出入

- 审批作废：方案写“置 stale”。审批状态枚举按网关约定不可改，实现为 `cancelled` + 活动 `approval_stale` + `approval_stale` 通知（审批人与请求人，决定的审批人本人除外）。
- 创建任务时直接落在带动作的状态不触发进入效果（不是状态变化）。
- `runExecutor` 在 Agent 自己把任务推进到会唤醒自己的阶段时跳过（`selfTriggered`），与“Agent 写状态不为自己入队”一致。
