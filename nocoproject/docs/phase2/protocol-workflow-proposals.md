# NocoProject 协议：Phase 2 工作流模板提议（服务端实现，权威）

> NP-77 方案第 2 版 stage 2（NP-82）：模板修改由 Agent 提议、人决定。在 `protocol-workflow-stage-actions.md`（stage 1）之上追加。契约类型在 `server/modules/shared/protocol.phase2-workflow-proposals.ts`（CLI 用 `pnpm sync-protocol` 复制），由 `protocol.ts` 末尾 `export *`。路径前缀 `/api/np`，成功 `{ data }`，失败 `{ code, message }`，可带 `details`。界面（收件箱决定卡、模板页修订历史）是 stage 3。

## 1. 数据模型

迁移 `2026100500001_np_phase2_workflow_proposals`：

- `workflowTemplates` 加 `revision`（int，非空，默认 1；每次生效 + 1）与 `isSystem`（bool，非空，默认 false）。
- 新表 `workflowTemplateRevisions`：`id`、`templateId`、`revision`、`name`、`definition`（json）、`proposalId`（可空）、`note`（text，可空）、`createdByType`（`user` / `agent` / `system`）、`createdById`、`createdAt`；唯一索引 `np_workflow_template_revisions_unique (templateId, revision)`。
- 新表 `workflowProposals`：`id`、`templateId`（改现有：目标模板；复制：接受后填新模板 id）、`copyFromId`（复制的来源，改现有为 null）、`name`（可空）、`definition`、`baseDefinition`、`baseName`、`baseRevision`（提交时的快照，差异摘要按它计算）、`reason`、`proposedByAgentId`、`sourceRunId`、`sourceIssueId`、`status`（`pending` / `accepted` / `rejected` / `stale`）、`decidedById`、`decidedAt`、`comment`、`resultRevision`、`createdAt`、`updatedAt`；索引 `(status, templateId)`、`(sourceRunId, status)`。
- `down`：删两张表与两列。

种子 `2026100500002_np_system_workflows` 把 `default`、`software-with-approval` 标为 `isSystem = true`（幂等）。

## 2. 模板形状

`GET /np/workflows`、`GET /np/workflows/:id` 的行是 `WorkflowListItemV5`：在原有字段上追加 `revision`、`isSystem`；`definition` 是 `WorkflowDefinitionV5`（可带 `onEnter`）。

## 3. Agent 接口（运行令牌）

| 接口                                 | 说明                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `GET /np/agent/workflows`            | `AgentWorkflowListItem[]`：全部模板，`usedByRunProject` 标出运行所在项目正在用的那个 |
| `GET /np/agent/workflows/:id`        | `AgentWorkflowListItem`；不存在 404                                                  |
| `POST /np/agent/workflows/proposals` | `AgentWorkflowProposalRequest` → 201 `WorkflowProposal`                              |

请求体：`templateId`（改现有）与 `copyFrom`（复制后新建）二选一（否则 400 `INVALID_TARGET`）；`name` 复制时必填、改现有时可选（改名），1–100 字（400 `INVALID_NAME`）；`definition` 是整份新定义；`reason` 必填 ≤ 500 字（400 `INVALID_REASON`）。

提交时按顺序检查，不通过什么都不写：

1. 模板存在（404）；改现有时不能是系统模板（409 `WORKFLOW_SYSTEM_TEMPLATE`，只能复制）。
2. stage 1 的定义校验（`workflow.validate.ts`；改现有时以当前定义为 `base`，引用的 Agent 必须存在且未归档）：400 `INVALID_WORKFLOW`，`details.issues` 列出全部问题。
3. 兼容性（仅改现有）：删掉的状态上还有任务（使用该模板的项目，默认模板含未指定模板的项目）→ 409 `WORKFLOW_STATUS_CONFLICT`，`details: WorkflowStatusConflictDetails`（每个状态的总数与各项目计数）。
4. 同一运行对同一模板（复制：同一来源）已有待定提议 → 409 `WORKFLOW_PROPOSAL_PENDING`。
5. 改现有且定义与名称都没变 → 400 `WORKFLOW_UNCHANGED`。

通过后：写提议（快照当前定义、名称、修订），来源任务记活动 `workflow_proposed { proposalId, kind, templateId, copyFromId, name }`，发 `workflow.proposed` → 每个 owner/admin 收到 `workflow_proposal` 决定卡（`dedupeKey = user:<uid>:workflow_proposal:<proposalId>`；payload：`proposalId`、`kind`、`templateId`、`templateName`、`copyFromId`、`reason`、`changes`（差异计数）、`issueId`；actions：`accept`、`reject`（可选留言）、`open`）。

Agent 没有任何直接写模板的接口。

## 4. 浏览器接口（会话）

| 接口                                      | 权限                    | 说明                                                                                       |
| ----------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| `GET /np/workflows/proposals/:id`         | 成员                    | `WorkflowProposal`；看不到的来源任务不返回编号；`canDecide` 仅 owner/admin 且待定时为 true |
| `POST /np/workflows/proposals/:id/accept` | owner/admin（否则 403） | 请求体可省略，`{ comment? }`（≤ 2000，400 `INVALID_COMMENT`）                              |
| `POST /np/workflows/proposals/:id/reject` | owner/admin             | 同上                                                                                       |
| `GET /np/workflows/:id/revisions`         | 成员                    | `WorkflowRevision[]`，新在前                                                               |
| `PUT /np/workflows/:id`                   | owner/admin，无界面     | `UpdateWorkflowRequest { definition, revision, name?, note? }` → `WorkflowListItemV5`      |

接受：

- 已决定 → 409 `WORKFLOW_PROPOSAL_DECIDED`。
- 改现有且模板当前修订 ≠ `baseRevision` → 提议置 `stale`（发 `workflow.decided`，决定卡结束，负责人收到结果），响应 409 `WORKFLOW_PROPOSAL_STALE`；Agent 需基于最新版重提。
- 再跑一次校验与兼容性检查（例如提交后又有任务进入了要删的状态 → 409 `WORKFLOW_STATUS_CONFLICT`，提议保持待定）。
- 改现有：模板写入新定义（名称可改），`revision + 1`（按 `revision` 乐观锁更新）；该模板第一次修改时先补一条基线快照（原定义，`createdByType = system`），再写新修订快照（作者记为提议 Agent，`note` 为理由）。复制：新建模板（`isSystem = false`、`isDefault = false`、修订 1）并写快照。
- 提议置 `accepted`、`resultRevision`、`templateId`；来源任务记活动 `workflow_updated { proposalId, kind, templateId, name, revision }`；发 `workflow.decided` 与 `workflow.changed`；事务提交后 `WorkflowService.invalidate()`，使用该模板的项目立即按新规则（只影响之后的转换，已有审批请求、清单、建议不变）。

驳回：置 `rejected`、记留言，发 `workflow.decided`。

`workflow.decided` → 决定卡结束；来源任务负责人收到 `workflow_decided`（info；payload：`proposalId`、`kind`、`templateId`、`templateName`、`decision`（`accepted` / `rejected` / `stale`）、`revision`、`comment`）。不自动唤醒 Agent（与知识库提议一致）。

管理员直接写 `PUT /np/workflows/:id`：系统模板 409 `WORKFLOW_SYSTEM_TEMPLATE`；缺 `revision` 400 `REVISION_REQUIRED`；修订不符 409 `REVISION_CONFLICT`；校验与兼容性同上；写修订快照（作者为该用户，`proposalId = null`），发 `workflow.changed`，提交后清缓存。

## 5. 差异摘要 `WorkflowDiff`

相对提议的基准定义（复制：来源模板）计算，纯函数 `workflow/workflow.diff.ts`：

- `statuses`：`added` / `removed`（`{ key, name, category }`）、`changed`（名称、颜色）、`order`（两边都有的状态顺序变了）。
- `transitions`：按 `from → to` 对比，同一对的多条合并（角色取并集，审批人取并集，没有审批为 null）；`added` / `removed` / `changed`（`actors`、`approvers`）。
- `actions`：每个状态的进入动作按整条动作（规范化 JSON，多重集）对比的 `added` / `removed`。
- `runExecutorAgents`：新定义里所有带 `agentId` 的 `runExecutor`（`statusKey`、`agentId`、`agentName`、`isNew`），单独高亮——进入该阶段会免负责人确认地唤醒该 Agent。
- `childBatchDoneWakesParentExecutor`、`name` 的变化；`empty`：完全相同。

## 6. 领域事件

- `workflow.proposed { proposalId, kind, templateId, templateName, copyFromId, reason, changes, issueId, deciderUserIds, actor }`
- `workflow.decided { proposalId, kind, templateId, templateName, decision, revision, comment, issueId, actor }`
- `workflow.changed { templateId, revision, actor }`（提议接受或管理员直接写；目前没有订阅者）

## 7. CLI

`nocoproject workflow list | get [<template>] [--definition] | propose (<template> | --copy-from <template> --name N) --definition-file F --reason R`，`nocoproject issue checklist [issue] [check|uncheck <item>]`；错误的 `details` 在文本输出里逐行打印，`--json` 原样带出。简报（编码 Agent）加 `## Changing a workflow template`；`## Stage checklist` 改为让 Agent 用 `issue checklist ... check` 勾选。见 `nocoproject-cli/README.md`。

## 8. 与方案的出入

- 活动与收件箱类型：方案只列了 `workflow_proposal` 决定卡与“结果通知”，结果通知实现为 `workflow_decided`（含 `stale`）。
- 提议作废（`stale`）作为提议状态落库，而不是只返回 409：决定人与来源任务负责人都能看到它为什么没生效。
- 新增 400 `WORKFLOW_UNCHANGED`（改现有但什么都没变），避免空提议进入收件箱。
- “默认模板改指向某个自定义模板（同样走提议）”不在本 stage 范围内，未实现。
