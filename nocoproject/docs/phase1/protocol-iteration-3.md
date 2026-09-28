# NocoProject 协议：Phase 1 迭代 3（服务端实现，权威）

> 在 Phase 0、迭代 1 / 2 协议之上追加；契约见 `iteration-3-contract.md`。本文记录服务端实际实现的请求 / 响应形状和与契约的出入。类型：契约类型在 `server/modules/shared/protocol.phase1-iter3.ts`（CLI 用 `pnpm sync-protocol` 复制；只引用 `protocol.ts` 与 `protocol.phase1-iter2.ts`，已单独试编译通过），组合了迭代 2 服务端形状的 `IssueDetailV3`、`IssueListPageV3`、`BoardGroupV3Server`、`DeliveryResultV3` 在 `protocol.phase1-iter3-server.ts`（CLI 不复制）。两者都由 `protocol.ts` 末尾 `export *`。路径前缀 `/api/np`，成功 `{ data }`，失败 `{ code, message }`。

## 1. 数据模型与种子

- 迁移 `2026093000001_np_phase1_iter3`：`knowledgeDocs`、`knowledgeDocVersions`、`knowledgeProposals` 三张表（字段见契约 §A）+ `knowledgeProposals.baseVersion`（契约外，建议写成时的文档版本）；系统级文档的 `projectId` 存 `''`（接口返回 null），唯一索引 `np_knowledge_docs_project_slug_unique(project_id, slug)` 因此也覆盖系统级。索引：`np_issues_project_status_updated_idx`、`np_issues_owner_status_idx`、`np_issues_executor_status_idx`、`np_issues_updated_idx(updated_at, id)`（契约外，默认列表排序用）、`np_activities_issue_created_idx(issue_id, created_at)`、`np_inbox_items_user_kind_resolved_idx(user_id, kind, resolved_at, created_at)`。`down` 反向删除全部。
- 种子 `2026093000002_np_iter3_page_grants`：默认权限集 `member` 追加页面 `np-my-issues`、`np-knowledge`、`np-reports`、`np-config` 的 `access`（只追加缺的）。
- Provider 不再注册设置项 `np-members`、`np-settings`、`np-github`（NocoBase 设置壳里不再出现），成员 / 设置 / GitHub 接口仍各自要求 owner/admin；旧授权留在权限集里，无害。

## 2. 知识库（`server/modules/knowledge/`）

权限：能看到项目的成员可读项目文档，任何成员可读系统级文档；项目文档的写（建、改、归档）与建议决定：项目 lead（`leadUserId` 或 lead 成员）与 owner/admin；系统级只有 owner/admin。看不到 → 404；无权写 → 403 `FORBIDDEN`。所属项目已删除的文档视为不存在。

| 接口                                                                             | 成功                                                                                                                                                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /np/knowledge?projectId=&q=&includeArchived=1`                              | `KnowledgeDocSummary[]`（按标题；`projectId` 缺省 = 可见项目 + 系统级，`projectId=none` = 只系统级；`q` 不区分大小写匹配标题 / slug / 摘要；默认不含归档）               |
| `POST /np/knowledge { projectId?, title, slug?, summary?, content }`             | **201** `KnowledgeDocDetail`；slug 缺省由标题派生（重名加 `-2`…，派生不出时 `doc`），显式 slug 重名 409 `KNOWLEDGE_SLUG_TAKEN`；项目不存在或不可见 400 `INVALID_PROJECT` |
| `GET /np/knowledge/:id`                                                          | `KnowledgeDocDetail = { doc, versions（新在前，无正文）, proposals（该文档 pending，新在前） }`                                                                          |
| `PATCH /np/knowledge/:id { title?, summary?, content?, note?, expectedVersion }` | `KnowledgeDocDetail`；缺 `expectedVersion` 400 `VERSION_REQUIRED`；不一致 409 `KNOWLEDGE_VERSION_CONFLICT`；归档中 409 `KNOWLEDGE_ARCHIVED`；内容没变不产生新版本        |
| `GET /np/knowledge/:id/versions/:version`                                        | `KnowledgeDocVersion`（含正文）；不存在 404                                                                                                                              |
| `POST /np/knowledge/:id/archive` / `unarchive`                                   | `KnowledgeDocDetail`（幂等）                                                                                                                                             |
| `GET /np/knowledge/proposals?status=pending`                                     | 当前用户可决定的 pending 建议 `KnowledgeProposal[]`（新在前）；其它 status 400 `INVALID_STATUS`                                                                          |
| `POST /np/knowledge/proposals/:id/accept` / `reject { comment? }`（body 可省略） | `KnowledgeProposal`；已决定 409 `KNOWLEDGE_PROPOSAL_DECIDED`；非决定人 403；新建文档的建议其项目已删 409 `KNOWLEDGE_PROPOSAL_STALE`                                      |

校验：title ≤ 200、summary ≤ 300、content ≤ 200000、note / comment ≤ 500、slug `^[a-z0-9][a-z0-9-]{0,63}$`（400 `INVALID_TITLE` / `INVALID_SUMMARY` / `INVALID_CONTENT` / `INVALID_NOTE` / `INVALID_COMMENT` / `INVALID_SLUG`）。

`KnowledgeDocSummary` = 契约字段 + `projectName`、`updatedByName`、`pendingProposalCount`、`canEdit`、`createdAt`、`updatedAt`（`summary` 为空串而不是 null）。`KnowledgeProposal` = 契约字段 + `docTitle`、`projectName`、`isNew`、`baseVersion`、`proposedByAgentName`、`sourceIssueIdentifier`、`decidedByName`、`canDecide`、`updatedAt`；更新现有文档的建议 `title` 为空串（= 不改标题）。

Agent 接口（运行令牌；范围 = 运行所属任务的项目 + 系统级；归档文档不可见）：

| 接口                                                                                                   | 成功                                                                              |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `GET /np/agent/knowledge`                                                                              | `KnowledgeDocSummary[]`（项目文档在前、系统级在后，各按标题；`canEdit` 恒 false） |
| `GET /np/agent/knowledge/:idOrSlug`                                                                    | `{ doc: KnowledgeDoc }`；slug 先找项目再找系统级；范围外 / 归档 404               |
| `POST /np/agent/knowledge/proposals { docId? , title?, slug?, projectId?, summary?, content, reason }` | **201** `KnowledgeProposal`（`canDecide` false）                                  |

建议规则：`docId`（id 或 slug）指向范围内文档，否则必须有 `title`（slug 缺省派生）；新建时 `projectId` 缺省 = 运行项目，`null` = 系统级，其它项目 403 `FORBIDDEN`；范围内已有同 slug 文档 409 `KNOWLEDGE_SLUG_TAKEN`（请改用 `docId`）；同一文档（或同一新 slug）同一运行已有 pending 409 `KNOWLEDGE_PROPOSAL_PENDING`；`reason` 必填 ≤ 500（400 `INVALID_REASON`）。提出后：来源任务活动 `knowledge_proposed { proposalId, docId, title, isNew }`（actor 为 Agent，带 runId），决定人收到决定项（§5）。接受：写新版本（作者 = 提出建议的 Agent，版本行带 `sourceRunId`、`proposalId`、`note` = 决定评论；标题 / 摘要为空时沿用原值），新建时生成文档（slug 重名自动加后缀）并回填 `proposal.docId`；来源任务活动 `knowledge_updated { proposalId, docId, version, title, isNew }`（actor 为决定人）。驳回不写活动。

认领载荷追加 `knowledge: ClaimedKnowledgeDoc[] = [{ id, slug, title, summary, projectId }]`（顺序同 Agent 列表，不含正文与归档）。项目详情 `GET /np/projects/:id` 追加 `knowledgeDocs: KnowledgeDocSummary[]`（该项目自己的未归档文档，不含系统级）。

## 3. 验收指标（`server/modules/metrics/`）

`GET /np/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD&projectId=` → `MetricsReport = { from, to, projectId, generatedAt, adoption, aiShare, trust, reliability, cost, humanLoad, thresholds, statuses }`。日期为 UTC，`to` 含当天；缺省最近 30 天，范围 ≤ 366 天、from ≤ to（否则 400 `INVALID_RANGE`；格式错 400 `INVALID_DATE`）。范围 = 未软删除的任务；owner/admin 全量，成员去掉看不到的私有项目的任务；`projectId` 只取该项目。数值都是纯数字（无数据时比率 / 分位数为 null），口径：

| 字段                                                    | 口径                                                                                                                                                                                          |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adoption.activeDays` / `activeWeeks`                   | 期间有任务创建、评论或（任务）运行创建的 UTC 日数 / ISO 周数                                                                                                                                  |
| `adoption.issuesCreated`                                | 期间创建的任务数（不含项目经理对话，NP-100）                                                                                                                                                  |
| `adoption.activeMembers`                                | 期间在活动流里有动作（actor 为 user）的不同成员数                                                                                                                                             |
| `aiShare.deliveredTotal` / `deliveredByAgent` / `share` | 期间 `status_changed` 进入 done 分类状态（所有模板里 category = done 的键）的不同任务数；其中当前执行者是 Agent 的数；比值                                                                    |
| `trust.proposalAcceptRate`                              | 期间决定的执行者建议：accepted / (accepted + rejected)（autoAccepted 不计）                                                                                                                   |
| `trust.reviewPassRate` / `reworkRate`                   | 期间离开 in_review 的状态变化里：进入 done 分类的占比 / 回到 in_progress 的占比                                                                                                               |
| `trust.approvalApproveRate`                             | 期间决定的审批：approved / (approved + rejected)                                                                                                                                              |
| `reliability.runs` / `failedRuns` / `failuresByReason`  | 期间创建的任务运行数；其中 failed 数；按 `failureReason`（空为 `unknown`）                                                                                                                    |
| `reliability.claimLatencyP50Ms` / `P95Ms`               | createdAt → dispatchedAt（最近秩分位数）                                                                                                                                                      |
| `reliability.runDurationP50Ms`                          | completed / failed 运行 startedAt → finishedAt                                                                                                                                                |
| `reliability.lostRuns`                                  | 期间创建、当前仍 dispatched / running 且最后进展（startedAt ?? dispatchedAt ?? createdAt）早于 3 小时前                                                                                       |
| `cost.*`                                                | `usage` 服务 `groupBy=agent` 同一范围：`inputTokens`、`outputTokens`、`estimatedCost`（无价格为 null）、`costPerDeliveredIssue` = 成本 / deliveredTotal、`byAgent: [{ agentId, name, cost }]` |
| `humanLoad.decisionsCreated` / `byType`                 | 期间创建的决定项（按类型计数）                                                                                                                                                                |
| `humanLoad.decisionsResolved` / `decisionResolveP50Ms`  | 期间解决的决定项；createdAt → resolvedAt 的中位数                                                                                                                                             |
| `humanLoad.openDecisions`                               | 截至期末创建、仍未解决且未归档的决定项                                                                                                                                                        |

`thresholds` 来自 `settings.metricThresholds`（缺的键取默认 `{ aiShare: 0.5, proposalAcceptRate: 0.7, claimLatencyP50Ms: 3000, lostRuns: 0, decisionResolveP50Ms: 86400000 }`）；`statuses: Record<'aiShare' | 'proposalAcceptRate' | 'claimLatencyP50Ms' | 'lostRuns' | 'decisionResolveP50Ms', 'ok' | 'warn' | 'n/a'>`：前两个 ≥ 阈值为 ok，后三个 ≤ 阈值为 ok，值为 null 为 n/a（方向常量 `METRIC_THRESHOLD_DIRECTIONS`）。

设置：`GET /np/settings` 追加 `metricThresholds`（`WorkspaceSettingsViewV3`）；`PATCH /np/settings { metricThresholds: Partial<MetricThresholds> }`（owner/admin）与已存值合并；未知键、非数、负数、比率 > 1 → 400 `INVALID_THRESHOLDS`。

## 4. 分页与性能

- `GET /np/issues` → `{ data: IssueListItemV2[], nextCursor }`（`nextCursor` 与 `data` 同级，null = 最后一页）。`limit` 默认 50，超出 [1, 100] 截到边界，非整数 400 `INVALID_QUERY`；`cursor` 不透明，非法 400 `INVALID_CURSOR`；排序固定 `updatedAt desc, id desc`，`sort=created` 为 `createdAt desc, id desc`。原有筛选（statusKey、projectId、q、labelId、ownerUserId、executorId、parentIssueId）照旧。
- `GET /np/issues?view=board` → `{ data: { groups: [{ statusKey, issues, hasMore, nextCursor }] } }`：列 = 项目模板目录 + 可见任务实际出现的其它状态；每列 `columnLimit`（默认 50，≤ 100；也接受 `limit`）。`view=board&statusKey=<key>&cursor=` 只返回那一列（`groups` 只有一个元素），用该列的 `nextCursor` 继续。
- `GET /np/issues/:id`：`activities` 只含最新 50 条（升序）+ `activitiesNextCursor`；`comments` ≤ 200 条时完整、否则最新 200 条（升序）+ `commentsNextCursor`（否则 null）。
- `GET /np/issues/:id/activities?cursor&limit` → `ActivityPage = { data: Activity[]（升序）, nextCursor }`；`GET /np/issues/:id/comments?cursor&limit` → `CommentPage = { data: CommentV2[], nextCursor }`。一页是"比游标更早的最新 limit 条"（默认 50，≤ 200），`nextCursor` 取再早一页。评论也作为 `comment_added` 活动出现在活动流里（`details.commentId`）。看不到任务 404。
- `GET /np/issues` 超过 500 ms 记 warn 日志（`nocoproject` logger）。
- 游标按毫秒时间戳比较；应用写入的时间都是毫秒精度。

## 5. 收件箱直接操作与交付

每条收件箱项在读取时计算 `payload.actions: InboxAction[]`（旧行也有）：`{ key, label: 'np.inboxActions.<key>', kind, method: 'GET' | 'POST', path, body?, needsComment?, commentField?, opensIssue?, external? }`。POST 的 `path` 相对 `/api`；GET 是应用内路由（`/issues/<编号>`、`/knowledge/<docId>`）或 `external` 时的外部 URL；需要评论时评论放在 `body[commentField ?? 'comment']`。已解决的项只保留 GET 动作；没有任务的项没有动作。

| type               | actions                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| review_requested   | `accept`（POST `/np/issues/<id>/deliveries/accept`，可带 comment）、`requestChanges`（POST `…/deliveries/request-changes`，needsComment）、`open` |
| agent_blocked      | `reply`（POST `/np/issues/<id>/comments`，needsComment，`commentField: 'content'`）、`reassign`（GET，opensIssue）、`open`                        |
| proposal_pending   | `acceptAll`（POST `/np/issues/<parentIssueId>/proposals/accept-all`）、`open`                                                                     |
| approval_pending   | `approve`、`reject`（POST `/np/approvals/<requestId>/approve                                                                                      | reject`，reject needsComment，kind danger）、`open`       |
| batch_done         | `open`                                                                                                                                            |
| pr_review          | `openPr`（GET 外部 url，external）、`open`                                                                                                        |
| knowledge_proposal | `accept`、`reject`（POST `/np/knowledge/proposals/<proposalId>/accept                                                                             | reject`，可带 comment）、`openDoc`（有 docId 时）、`open` |
| 其它（含 info）    | `open`（`knowledge_decided` 另有 `openDoc`）                                                                                                      |

交付接口（能看到任务的成员；同一事务）：

| 接口                                                                | 成功                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /np/issues/:id/deliveries/accept { comment? }`（body 可省略） | 200 `{ data: DeliveryResult = { issue, pendingApproval: null, comment } }`；写 done（模板没有 `done` 时取第一个 done 分类状态，都没有 409 `NO_DONE_STATUS`），走与 PATCH 相同的权限与审批门禁；命中审批 **202**（`issue` 未变、`pendingApproval` 为请求）。评论只记录、**不触发** Agent；活动 `delivery_accepted { from, to, commentId, pendingApprovalId }` |
| `POST /np/issues/:id/deliveries/request-changes { comment }`        | 200 / 202 同形；缺评论 400 `INVALID_COMMENT`；模板有 in_progress 且任务不在其上时先改为 in_progress，再写顶层评论（照常触发执行者下一轮）；活动 `changes_requested`                                                                                                                                                                                          |

两者都发 `delivery.decided`，任务的 `review_requested` 决定项全部解决（审批待定时也解决）并推 `np:inbox`。其它决定项的解决：`agent_blocked` 在成员回复（非 `/note`）时解决该成员的卡、执行者变更时全部解决（迭代 3 新增）；`proposal_pending` 全部建议决定后、`approval_pending` 决定或取消后、`pr_review` 合并或关闭后、`knowledge_proposal` 决定后解决。

新收件箱类型：

| type                 | kind     | 收件人                                                                     | payload（另有 identifier、issueTitle、actions）                                      | dedupeKey                                    |
| -------------------- | -------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------- |
| `knowledge_proposal` | decision | 项目 lead（`leadUserId` + lead 成员）；无 lead 或系统级 → 全部 owner/admin | proposalId, docId, docTitle, projectId, projectName, reason, summary, issueId, isNew | `user:<uid>:knowledge_proposal:<proposalId>` |
| `knowledge_decided`  | info     | 来源任务负责人（决定人本人不收）                                           | proposalId, docId, docTitle, decision, version, comment                              | 默认                                         |

## 6. 工作流模板

`GET /np/workflows` 每行与 `GET /np/workflows/:id` 追加 `projectCount`（默认模板含未指定模板的项目）；`isDefault` 与 `definition`（原样）已有。

## 7. 类型

`protocol.phase1-iter3.ts`：知识库（`KnowledgeDocSummary`、`KnowledgeDoc`、`KnowledgeDocVersion`、`KnowledgeVersionSummary`、`KnowledgeProposal`、`KnowledgeProposalStatus`、`KnowledgeDocDetail`、请求类型、`ClaimedKnowledgeDoc`、`ClaimedRunPhase3Extras`、长度常量）、指标（`MetricsReport` 与六个分组接口、`MetricThresholds`、`MetricStatus`、`DEFAULT_METRIC_THRESHOLDS`、`METRIC_THRESHOLD_KEYS`、`METRIC_THRESHOLD_DIRECTIONS`、`WorkspaceSettingsViewV3`、`UpdateWorkspaceSettingsRequestV3`）、分页（`IssueListPage<T>`、`BoardGroupV3<T>`、`IssueBoardResponseV3<T>`、`ActivityPage`、`CommentPage`、`IssueDetailPaging`、分页常量）、收件箱（`InboxAction`、`InboxItemTypePhase1Iter3`、`InboxItemTypeV3`、`InboxItemV3`）、交付（`AcceptDeliveryRequest`、`RequestChangesRequest`、`DeliveryResult`）、`WorkflowListItem`、`ProjectDetailV3`、`ActivityActionPhase1Iter3`。

## 8. 与契约的出入

1. 类型分两个文件（同迭代 2）：分页类型是泛型，默认元素 `IssueListRow = IssueListItemV1 & IssuePhase2Fields`（= 服务端 `IssueListItemV2`），因此 CLI 副本不依赖服务端文件；服务端组合类型在 `protocol.phase1-iter3-server.ts`。原联合类型未改，另给 `InboxItemTypeV3` / `InboxItemV3`。
2. 迁移追加 `knowledgeProposals.baseVersion` 与索引 `np_issues_updated_idx(updated_at, id)`、`np_knowledge_proposals_doc_status_idx`。契约写的 `activities (issueId, createdAt desc)` 与 `inboxItems (…, createdAt desc)`：迁移构建器忽略了 `desc`，库里是升序 btree；PostgreSQL 对 `ORDER BY … DESC` 反向扫描，效果相同。迁移已在开发库执行，未再修改。
3. 系统级文档 `knowledgeDocs.projectId` 存 `''`（契约"projectId 空用 '' 归一"的实现方式），接口一律返回 null；`knowledgeProposals.projectId` 存真正的 null。
4. 列表排序按契约改为 `updatedAt desc`（迭代 2 是 `lastActivityAt desc`）：只加评论不改 `updatedAt`，因此只有评论的任务不会被顶到前面。
5. 看板单列加载的响应仍是 `{ groups: [一列] }`；`columnLimit` 上限 100，也接受 `limit`。
6. 详情评论超过 200 条时给最新 200 条，线程根可能落在更早的一页；新增 `GET /np/issues/:id/comments?cursor&limit` 取更早的评论（契约只说按 `commentsNextCursor` 分页）。活动分页项就是 `Activity`（评论以 `comment_added` 活动出现），没有另造合并的时间线类型。
7. 指标值是纯数字，口径不随响应返回（见 §3，前端用 i18n 展示）；`statuses` 只针对五个有阈值的指标。成员看到的 `humanLoad` 是其可见任务上所有人的决定项（不只自己的）。`lostRuns` 只统计期间创建的运行。
8. `InboxAction.method` 只有 `GET`（导航）/ `POST`；契约外字段 `commentField`、`external`；`approval_pending` 额外有 `open`，`knowledge_proposal` 额外有 `openDoc`、`open`；info 类型也给 `open`。`agent_blocked` 的 `reply` / `reassign` 完成后决定项解决（新行为：成员非 `/note` 评论解决自己的卡，执行者变更解决全部）。
9. 接受交付时的评论**不触发**运行（交付已结束，避免唤醒 Agent）；请求修改时先改状态再评论。交付接口的 202 响应里 `review_requested` 也已解决（审批人另收 `approval_pending`）。
10. 知识库写接口（POST / PATCH / archive）返回 `KnowledgeDocDetail`（契约未写）；`GET /np/knowledge` 增加 `projectId=none` 与 `includeArchived=1`；Agent 新建建议与已有 slug 冲突返回 409 `KNOWLEDGE_SLUG_TAKEN`（不自动转成更新）；服务端不限制每次运行的建议条数（"最多 3 条"由简报约束）。驳回不写活动。所属项目被删除的文档不再出现（视为不存在）。
11. 工作流 `GET /np/workflows/:id` 同样带 `projectCount`。
12. 服务端文件：`project.service.ts`（迭代 1 起 585 行）未改；`knowledgeDocs` 在项目路由里组合知识库服务。
