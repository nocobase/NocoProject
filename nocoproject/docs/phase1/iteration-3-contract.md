# Phase 1 迭代 3 契约：打磨与自用前置

> 在 Phase 0 协议、迭代 1 / 2 协议之上追加。类型写在 `server/modules/shared/protocol.phase1-iter3.ts`（`protocol.ts` 末尾 `export *`；服务端专用组合类型进 `protocol.phase1-iter3-server.ts`，CLI 用 `pnpm sync-protocol` 复制）。路径前缀 `/api/np`。
> 本轮目标：进入 dogfooding 前把产品负责人点名的八项做掉——知识库、验收指标采集、工作流模板可视化、菜单按设计分组、收件箱决定项直接可操作、批量录入收进任务页、设置进前台、界面整体打磨与性能；workspace 化由主会话在集成时切换（B 只做准备）。
> 术语沿用前两轮。

## A. 数据模型追加（迁移 `2026093000001_np_phase1_iter3`）

| 表 | 字段 | 约束 |
|---|---|---|
| `knowledgeDocs` | projectId(可空 = 系统级), title, slug, summary(≤ 300), content(Markdown), version(int 从 1), updatedByType('user' \| 'agent'), updatedById, archivedAt | unique(projectId, slug)（projectId 空用 `''` 归一）；index(projectId) |
| `knowledgeDocVersions` | docId, version, title, content, summary, authorType('user' \| 'agent' \| 'system'), authorId, sourceRunId(可空), proposalId(可空), note | unique(docId, version) |
| `knowledgeProposals` | docId(可空 = 新建文档), projectId(可空), title, slug(新建时), summary, content, reason(≤ 500，Agent 说明为什么要改), proposedByAgentId, sourceRunId, sourceIssueId, status('pending' \| 'accepted' \| 'rejected'), decidedById, decidedAt, comment | index(status, projectId) |

列追加：`issues` 增加 index(projectId, statusKey, updatedAt)、index(ownerUserId, statusKey)、index(executorType, executorId, statusKey)；`activities` 增加 index(issueId, createdAt desc)；`inboxItems` 增加 index(userId, kind, resolvedAt, createdAt desc)。

种子 `2026093000002_np_iter3_page_grants`：给默认权限集 `member` 追加页面 `np-my-issues`、`np-knowledge`、`np-reports`、`np-config` 的 `access`。原 `settings:np-members|np-github|np-settings` 设置项不再注册（前端撤掉 `defineSettingsRoutes` 块），服务端接口权限不变。

## B. 知识库 v0（`server/modules/knowledge/`）

**定位**：项目或系统级的 Markdown 文档，人写、人维护，Agent 按需读取；Agent 只能"建议更新"，进负责人的"待我决定"。这就是知识积累的流程：任务做完 → Agent 把发现的约定 / 坑 / 决策写成建议 → 项目 lead（无项目时 owner/admin）确认 → 生成新版本。

浏览器接口（能看到项目的成员可读；写：项目 lead、owner/admin，系统级文档只有 owner/admin）：

```
GET    /np/knowledge?projectId=&q=            → KnowledgeDocSummary[]（不含 content；projectId 缺省 = 全部可见 + 系统级）
POST   /np/knowledge   { projectId?, title, slug?, summary?, content }
GET    /np/knowledge/:id                       → { doc, versions: KnowledgeVersionSummary[], proposals: KnowledgeProposal[](pending) }
PATCH  /np/knowledge/:id  { title?, summary?, content?, note?, expectedVersion }   → 新版本；版本冲突 409 KNOWLEDGE_VERSION_CONFLICT
GET    /np/knowledge/:id/versions/:version    → KnowledgeDocVersion（含 content）
POST   /np/knowledge/:id/archive | unarchive
GET    /np/knowledge/proposals?status=pending  → 当前用户可决定的建议
POST   /np/knowledge/proposals/:id/accept { comment? }   → 应用为新版本（或新建文档），活动写在来源任务上 `knowledge_updated`
POST   /np/knowledge/proposals/:id/reject { comment? }
```

Agent 接口（运行令牌，只能访问运行所属项目 + 系统级）：

```
GET  /np/agent/knowledge                 → KnowledgeDocSummary[]
GET  /np/agent/knowledge/:idOrSlug       → { doc }（含 content）
POST /np/agent/knowledge/proposals { docId? | title+slug?, projectId?（默认运行所属项目）, summary?, content, reason }  → KnowledgeProposal
```

规则：同一文档同一运行只能有一条 pending 建议（重复 409 `KNOWLEDGE_PROPOSAL_PENDING`）；决定人 = 项目 lead（无 lead 或系统级 → owner/admin）；决定卡 `knowledge_proposal`（decision，dedupeKey `user:<uid>:knowledge_proposal:<proposalId>`，payload：proposalId, docId, docTitle, projectId, projectName, reason, summary, issueId, identifier, isNew）；建议来源任务写活动 `knowledge_proposed`；接受 / 驳回后 resolve 并给来源任务负责人 info `knowledge_decided`。认领载荷 `knowledge: [{ id, slug, title, summary, projectId }]`（索引，不带正文）；项目详情追加 `knowledgeDocs: KnowledgeDocSummary[]`。

## C. 验收指标采集（`server/modules/metrics/`）

`GET /np/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD&projectId=` → `MetricsReport`（owner/admin 全量；成员按可见任务过滤）。六类按总纲 10.2，每项给值与计算口径：

| 类 | 字段 | 口径 |
|---|---|---|
| 采用 adoption | `activeWeeks`, `activeDays`, `issuesCreated`, `activeMembers` | 有任务创建或评论或运行的周 / 天数；创建任务数；有动作的成员数 |
| AI 承担率 aiShare | `deliveredByAgent`, `deliveredTotal`, `share` | 期间进入 done 的任务里执行者是 Agent 的占比（按 statusChange 活动的时间） |
| 信任 trust | `proposalAcceptRate`（执行者建议接受 / 决定数）, `reviewPassRate`（in_review → done 的次数 / in_review 离开的次数）, `approvalApproveRate`, `reworkRate`（in_review → in_progress 占比） | 决定"建议"能否放宽为"自动"的依据 |
| 可靠 reliability | `runs`, `failedRuns`, `failuresByReason: Record<string, number>`, `claimLatencyP50Ms`, `claimLatencyP95Ms`（createdAt → dispatchedAt）, `runDurationP50Ms`, `lostRuns`（状态卡在 dispatched/running 超过 3 小时的数量） | 无丢失是硬指标 |
| 成本 cost | `inputTokens`, `outputTokens`, `estimatedCost`, `costPerDeliveredIssue`, `byAgent: [{agentId, name, cost}]` | 复用 usage 服务 |
| 人的负担 humanLoad | `decisionsCreated`, `decisionsResolved`, `decisionResolveP50Ms`, `openDecisions`, `byType: Record<InboxItemType, number>` | 决定卡创建到 resolvedAt |

另返回 `thresholds`（来自 `settings.metricThresholds`，默认：aiShare ≥ 0.5、proposalAcceptRate ≥ 0.7、claimLatencyP50Ms ≤ 3000、lostRuns = 0、decisionResolveP50Ms ≤ 24h）与每项 `status: 'ok' | 'warn' | 'n/a'`。`PATCH /np/settings` 接受 `metricThresholds`。

## D. 列表分页与性能

- `GET /np/issues`：`cursor`（不透明字符串）、`limit`（默认 50，≤ 100），响应 `{ data, nextCursor }`；排序固定 `updatedAt desc, id desc`（`sort=created` 可选）。看板 `view=board`：每列最多 `columnLimit`（默认 50），组带 `hasMore`、`nextCursor`；追加 `GET /np/issues?view=board&statusKey=<key>&cursor=` 只取一列。
- `GET /np/issues/:id` 的 `activities` 只返回最新 50 条 + `activitiesNextCursor`；`GET /np/issues/:id/activities?cursor&limit`（含评论，与详情同一种 timeline 项）。`comments` 保持完整返回（线程需要），但 > 200 条时按 `commentsNextCursor` 分页。
- `GET /np/inbox` 已有 cursor；`GET /np/knowledge`、`/np/skills`、`/np/projects` 保持整表（数量小）。
- 索引见 §A。服务端对 `GET /np/issues` 加简单的耗时日志（> 500 ms warn）。
- 大数据量夹具：`tests/logic/np-perf.test.ts` 造 2000 条任务、200 个子任务、5000 条活动，断言列表 / 看板 / 详情请求 < 300 ms（本机），并跑分页游标遍历一致性。

## E. 收件箱决定项直接可操作

每条 `decision` 项的 `payload.actions: InboxAction[]` 由服务端给出（前端不再按类型硬编码），`InboxAction = { key, label(i18n key), kind: 'primary' | 'secondary' | 'danger', method, path, body?, needsComment?: boolean, opensIssue?: boolean }`：

| type | actions |
|---|---|
| review_requested | `accept`（POST `/np/issues/:id/deliveries/accept`，可带 comment）、`requestChanges`（POST `/np/issues/:id/deliveries/request-changes`，needsComment）、`open` |
| agent_blocked | `reply`（POST `/np/issues/:id/comments`，needsComment，body.content）、`reassign`（opensIssue）、`open` |
| proposal_pending | `acceptAll`（POST `/np/issues/:id/proposals/accept-all`）、`open`（逐条在详情） |
| approval_pending | `approve` / `reject`（POST `/np/approvals/:id/approve|reject`，reject needsComment） |
| batch_done | `open` |
| pr_review | `openPr`（外链 url）、`open` |
| knowledge_proposal | `accept` / `reject`（§B） |

新接口：`POST /np/issues/:id/deliveries/accept { comment? }` = 写 done（经门禁；命中审批返回 202）+ 可选评论 + resolve 决定项；`POST /np/issues/:id/deliveries/request-changes { comment }` = 评论（顶层，触发执行者下一轮）+ 状态 in_progress（人可写）+ resolve。所有决定项在动作完成后 `resolvedAt` 置位并推 `np:inbox`。

## F. 工作流模板可视化（只读）

`GET /np/workflows` 每行追加 `projectCount`、`isDefault`；`GET /np/workflows/:id` 返回 `definition` 原样。前端 `/config/workflows`、`/config/workflows/:id`：状态序列按分类着色的横向流程（backlog → todo → in_progress → in_review → done，blocked / cancelled 旁支），转换矩阵表（行 from、列 to，格子里人 / Agent / 系统图标，带审批的格子加"审批"角标），审批规则列表，"N 个项目在用"。不做编辑。

## G. 菜单、设置进前台、批量录入收进任务页（前端）

侧边栏按方案 §3.1 分组（`client/routes.ts` 用导航分组）：

```
收件箱                 /inbox（决定 / 通知；/inbox/approvals 并入决定列表，路由保留跳转）
我的任务               /my-issues（标签：我负责的 / 我执行的；同一列表组件，筛选进 URL）
── 工作
任务                   /issues（列表 / 看板；"新建任务"分裂按钮：新建 / 批量录入 → 覆盖式抽屉 /issues/intake）
项目                   /projects
── Agent 团队
Agent                  /agents
运行时                 /runtimes
技能                   /skills
知识库                 /knowledge
── 
报表                   /reports（标签：指标 / 用量）
设置                   /config（标签页：通用 / 成员 / 工作流模板 / 标签 / GitHub；页面 id `np-config`，非 owner/admin 只看得到通用的只读值与成员列表）
```

撤掉：独立 `/intake` 与 `/usage` 页面（路由改为重定向到新位置）、`defineSettingsRoutes` 里的三项（NocoBase 系统设置壳里不再出现成员 / GitHub / NocoProject）。项目详情"批量添加"打开同一个抽屉并预选项目。

## H. 界面整体打磨（前端，与 G 一起做，主会话按截图验收）

统一规则，写进 `client/pages/np/README.md` 供后续遵守：

1. 每个页面只用 `PageContainer` + `PageHeader`（标题、一句描述、右侧主操作），页面级不设 `max-w-*`；表单与对话框内容才限宽（`max-w-2xl`）。删除现有页面上的 `max-w-*` / `mx-auto`。
2. 列表页统一：工具栏（搜索 + 筛选 + 视图切换）在左，主按钮在右；`DataTable` 密度一致；空状态用 `Empty`；加载用 `Skeleton`。
3. 详情页三栏：主栏 `flex-1 min-w-0`，右栏固定 `w-80`，窄屏折叠为单栏；区块统一为 `Card`（标题 + 右上角操作），区块间距一致。
4. 标识统一：任务编号 `font-mono text-xs`、状态徽标只用 `NpStatusBadge`（颜色来自状态目录）、优先级图标一致、Agent / 成员头像一致（同一个 `NpActorAvatar`）。
5. 每个写操作有 toast；破坏性操作走 `AlertDialog`；错误信息本地化。
6. 参考 `client/pages/reference/examples`（orders、team-settings、inbox、dashboard）对齐结构；组件 API 以 `client/pages/reference/components` 为准。
7. 键盘：`C` 新建任务、`⌘K` 打开搜索（搜索任务标题 / 编号，`GET /np/issues?q=`，结果可回车打开）、`⌘Enter` 发送评论。
8. 长列表虚拟滚动：活动流（`react-virtuoso`，新增依赖）、任务列表 > 200 行、看板列 > 100 张；分页用 §D 的游标，"加载更多"或滚动到底自动加载（TanStack `useInfiniteQuery`）。
9. 深色 / 浅色两套都检查；中英文都检查（`locale-coverage` 测试）。

交付时附一张"页面 × 规则"自查表放在报告里；主会话会逐页截图对照。

## I. 守护进程与 CLI

- 新子命令：`nocoproject kb list --json`、`kb get <slug|id> [--json]`（正文到标准输出）、`kb propose (--doc <slug|id> | --title T [--slug s]) --content-file F --reason R [--summary S] --json`。
- 认领载荷 `knowledge` → `context.json.knowledge`；简报 `## Knowledge`：列出文档（标题、slug、摘要）与 `kb get` 用法；`## Capture learnings`：任务结束前，若发现了新的约定 / 坑 / 决策，用 `kb propose` 提交（不要直接改文档），一次运行最多 3 条。
- 回声指令：`[echo:kb=<slug>]`（把文档首行写进回复）、`[echo:kb-propose=<title>]`（提一条建议）。
- **workspace 化准备**（不切换）：根目录 `pnpm-workspace.yaml`（`nocoproject`、`nocoproject-cli`、`packages/*`）、`packages/protocol/package.json`（`@nocoproject/protocol`，`exports` 指向 `src/index.ts`，`private: true`）、根 `package.json`（`private`，脚本 `test`、`typecheck` 逐包执行）；用一个占位类型验证应用（vite、tsx、tsc）与 CLI（tsup、vitest）都能解析 workspace 的 TS 源码包；写 `docs/phase1/workspace.md` 记录切换步骤（移动 `protocol*.ts` → `packages/protocol/src/`，改 import 为 `@nocoproject/protocol`，删除 `sync-protocol`）。**不要移动现有文件**，主会话在三方交付后执行切换。
- Claude Code：仍以夹具为准；live 测试保持 skip。

## J. 类型与常量（`protocol.phase1-iter3.ts`）

`KnowledgeDocSummary`、`KnowledgeDoc`、`KnowledgeDocVersion`、`KnowledgeVersionSummary`、`KnowledgeProposal`、`KnowledgeProposalStatus`、`ClaimedKnowledgeDoc`、`MetricsReport`（六个分组接口 + `thresholds` + `statuses`）、`MetricThresholds`、`InboxAction`、`IssueListPage = { data, nextCursor }`、`BoardGroupV3 = { statusKey, issues, hasMore, nextCursor }`、`ActivityPage`、`InboxItemTypePhase1Iter3 = 'knowledge_proposal' | 'knowledge_decided'`、`ActivityActionPhase1Iter3 = 'knowledge_proposed' | 'knowledge_updated' | 'delivery_accepted' | 'changes_requested'`。

## K. 分工

| 子任务 | 交付 | 章节 |
|---|---|---|
| A 服务端 | 迁移与种子；知识库模块与 Agent 接口；指标模块；分页与索引与性能测试；收件箱 actions 与交付接口；工作流 projectCount；认领载荷 knowledge；`protocol.phase1-iter3*.ts`；`protocol-iteration-3.md`、`server-notes-iteration-3.md` | A–F、J |
| B 守护进程与 CLI | kb 子命令；简报两节；context.json；回声指令；workspace 化准备与 `workspace.md` | I、J |
| C 前端 | 菜单分组与新页面（我的任务、知识库、报表、设置前台）；批量录入抽屉；工作流可视化；收件箱直接操作；分页与虚拟滚动；全站打磨与 README 规则；`client/pages/np/README.md` | E–H |

三方只通过本契约耦合；出入写进 `protocol-iteration-3.md` 末节并通知主会话。
