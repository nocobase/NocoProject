# Phase 1 迭代 4 契约：设计先行流程、项目经理、统一新建任务

> 在 Phase 0 协议与迭代 1–3 协议之上追加。类型写在 `server/modules/shared/protocol.phase1-iter4.ts`（`protocol.ts` 末尾 `export *`；服务端专用组合类型进 `protocol.phase1-iter4-server.ts`，CLI 用 `pnpm sync-protocol` 复制，脚本要同时处理 iter4）。路径前缀 `/api/np`。
> 背景：产品负责人在 dogfooding 中提出：(1) 任务应能先做需求分析与方案设计、人审核讨论后再开发；(2) 需要一个知道所有项目、随时能问、任务完成后做总结的"项目经理"Agent，跑在 dev 机器的 OpenCode 上（DeepSeek V4.1 Flash，high 推理）；(3) 添加任务默认借助 AI 整理，可切换手动，一条与多条统一入口。

## A. 数据模型追加（迁移 `2026100100001_np_phase1_iter4`）

| 表 | 追加 |
|---|---|
| `issues` | `process('direct' \| 'design_first'，默认 direct)`、`designApprovedAt`(可空)、`designApprovedById`(可空) |
| `comments` | `kind` 允许新值 `'proposal'`（设计方案）；不改列 |
| `agents` | `kind('coder' \| 'manager'，默认 coder)`、`reasoningEffort('minimal' \| 'low' \| 'medium' \| 'high' \| 'max'，可空)` |
| `systemSettings.settings` | `defaultProcess: 'auto' \| 'direct' \| 'design_first'`（默认 auto）、`pmAgentId: string \| null`、`retrospectiveOnDone: boolean`（默认 true） |
| `workflowTemplates.definition` | 默认模板与"验收审批"模板加两个内置状态：`analysis`（分析中，category started，在 todo 之后）、`proposal_review`（方案待审，category started，在 analysis 之后）；转换见 §B |

种子 `2026100100002_np_iter4_workflow_statuses`：给已有模板追加两个状态与转换（幂等）。

## B. 设计先行流程（process = design_first）

**选择**：`POST /np/issues` 与批量录入接受 `process`；缺省按 `settings.defaultProcess`：`direct` / `design_first` 直接用；`auto` → 服务端分类器 `intake/process-classifier.ts`：先启发式（描述 ≥ 600 字、含"设计 / 方案 / 架构 / 重构 / 迁移 / 新模块 / 调研"、有子任务意图 → design_first；标题以 fix / 修复 / 改文案开头、描述 < 200 字 → direct），LLM 可用时用一次直接模型调用二分类（30 秒超时回退启发式）。分类结果写活动 `process_selected`（details.by = 'user' | 'heuristic' | 'ai'）。任务详情与列表带 `process`；`PATCH /np/issues/:id { process }` 只在状态为 backlog / todo 时允许（否则 409 `PROCESS_LOCKED`）。

**状态与转换**（模板 definition）：

```
todo → analysis           actors: agent, user      仅 design_first
analysis → proposal_review actors: agent, user
proposal_review → analysis actors: user, system    （打回）
proposal_review → in_progress actors: system, user （批准）
analysis / proposal_review → blocked actors: agent, user
todo → in_progress        actors: agent（direct）；design_first 且未批准 → 403 DESIGN_NOT_APPROVED
```

服务端在 `issue/status.ts` 之外加 `process` 门：`process = design_first` 且 `designApprovedAt` 为空时，Agent 写 `in_progress` 被拒（403 `DESIGN_NOT_APPROVED`）；人可以强行写（视为跳过设计，活动 `design_skipped`）。

**方案文档**：Agent 用 `POST /np/agent/issues/:id/design-proposal { content }` 写一条 `kind='proposal'` 的顶层评论（Markdown，模板：需求理解 / 方案 / 影响范围 / 风险与待定 / 验证计划），返回评论；然后把状态改为 `proposal_review`。进入 `proposal_review` 时给负责人 decision `design_review`（dedupeKey `user:<owner>:design_review:<issueId>`，payload：proposalCommentId、summary(前 300 字)、actions）。

**决定**：`POST /np/issues/:id/design/approve { comment? }` → `designApprovedAt/ById`，状态 `in_progress`（system actor，经门禁），活动 `design_approved`，触发执行者运行（trigger.type `designApproved`，合并规则照旧）；`POST /np/issues/:id/design/request-changes { comment }` → 顶层评论（触发执行者）+ 状态 `analysis`，活动 `design_changes_requested`。两者都 resolve 决定卡。讨论用普通评论（进入 `proposal_review` 后的顶层评论照常唤醒执行者，Agent 回复修订方案再次 `proposal_review` 时决定卡合并更新）。

**简报**（design_first 且未批准）：`## Design first` 段：先分析再提方案，用 `nocoproject issue design-proposal <编号> --content-file F` 提交，改状态 `proposal_review` 后结束本轮；**批准前不要改代码、不要提 PR**；被打回时按评论修订整篇方案。批准后的运行（trigger `designApproved`）开场句："方案已批准，按方案实现"。

**前端**：新建任务对话框"流程"选择（自动 / 直接开发 / 先出方案）；详情标题旁 `process` 徽标；"等你决定"区块渲染方案正文（`kind='proposal'` 的最新评论，Markdown）+ 动作"批准进入开发 / 打回修改"；时间线里 proposal 评论用带"方案"标签的卡片；看板出现 分析中 / 方案待审 两列（项目里没有 design_first 任务时隐藏这两列）。

## C. 项目经理 Agent（kind = manager）

**定位**：系统里的一个 Agent（不是本地个人工具），跑在任一运行时（本期用 dev 的 OpenCode，模型 `deepseek/deepseek-flash`，`reasoningEffort='high'`）。它不写代码，只读全局、回答问题、做总结与知识建议。权限与提问者绑定：所有跨项目读取都按运行的 `actorUserId` 的可见范围过滤。

**Agent 字段**：`kind`、`reasoningEffort`（`POST/PATCH /np/agents`）。`kind='manager'` 的 Agent 不能被设为普通任务的执行者（400 `MANAGER_NOT_EXECUTOR`），只能作为对话任务与总结运行的执行者。守护进程适配器映射推理强度：opencode `--variant <effort>`；codex `-c model_reasoning_effort="<effort>"`；claude 若 `claude --help` 有 `--effort` 则传，否则忽略。

**对话**：`POST /np/pm/conversation` → 为当前用户找到或创建一条无项目任务（标题"项目经理 · <用户名>"，`executionMode='session'`，执行者 = `settings.pmAgentId`，负责人 = 该用户，`originType='pm'`），返回 `{ issueId }`；`GET /np/pm/conversation` 同。前端侧栏在"我的任务"下加"项目经理"（icon `BotMessageSquare`），`/pm` 直接渲染该任务的会话面板（全宽、无属性栏）。未设置 `pmAgentId` 时页面提示去设置。

**Agent 读接口**（运行令牌；仅 `kind='manager'`，否则 403 `MANAGER_ONLY`；可见性按 actorUserId）：

```
GET /np/agent/pm/projects                       → ProjectListItem[]
GET /np/agent/pm/issues?projectId&statusKey&ownerUserId&executorId&q&updatedSince&limit&cursor → { data, nextCursor }
GET /np/agent/pm/issues/:idOrIdentifier         → { issue, comments(最近 50), activities(最近 50), runs(摘要), pullRequests, subtasks }
GET /np/agent/pm/inbox?kind=decision            → 提问者的待决定项
GET /np/agent/pm/metrics?from&to&projectId      → MetricsReport
GET /np/agent/pm/knowledge?projectId&q          → KnowledgeDocSummary[]（全部可见项目 + 系统级）
```

**CLI**：`nocoproject pm projects --json`、`pm issues [--project] [--status] [--owner me] [--q] [--since 7d] --json`、`pm issue <id> --json`、`pm inbox --json`、`pm metrics [--from --to] --json`、`pm knowledge [--project] --json`。简报（manager kind）：`## Project manager` 段（角色、用提问者的语言回答、引用任务编号、不改任务状态、不 @ 任何 Agent、需要写入知识库用 `kb propose`、结论先行）。

**任务完成后的总结（retrospective）**：`settings.retrospectiveOnDone && pmAgentId` 时，任务进入 done 且执行者曾是 Agent → 触发模块创建 PM 运行（trigger.type `retrospective`，subject = 该任务，threadScope `retro`，actorUserId = 把它改为 done 的人）。PM 在该运行里读取任务全貌（`pm issue`），写一条 `/note`（内部备注，不触发任何人）：做了什么、耗时与用量、值得沉淀的约定或坑、规范是否需要更新；对应内容用 `kb propose` 提交（进项目 lead 的决定）。活动 `retrospective_done`。PM 的备注不产生通知。

**前端**：Agent 表单加"类型"（编码 / 项目经理）与"推理强度"；设置 → 通用加"项目经理 Agent"选择与"任务完成后自动总结"开关；任务详情时间线里 retrospective 备注带"总结"标签。

## D. 统一新建任务

一个"新建任务"对话框（`/issues/new`，项目页与看板"+"都走它）两个标签页：
- **AI 整理**（默认）：一个文本框（"描述需求，或粘贴需求清单、会议纪要"）+ 项目选择 → "整理"→ 草稿表（复用批量录入的表格：标题、优先级、标签、阶段、父子、执行者、流程）→ 确认创建（1 条或多条）。后端复用 `POST /np/intake/batches`（新增 `process` 字段透传）。
- **手动**：现有表单（标题、描述、负责人、执行者、优先级、项目、流程、会话模式）。
记住上次用的标签页（localStorage）。`/issues/intake` 与项目页"批量添加"重定向到此对话框的 AI 标签页并预填项目。侧栏无"批量录入"。

## E. 分工

| 子任务 | 交付 | 章节 |
|---|---|---|
| A 服务端 | 迁移与种子；process 分类器与门；design-proposal 接口与决定卡与动作；Agent kind / reasoningEffort；PM 对话与读接口；retrospective 触发；设置；`protocol.phase1-iter4*.ts`；`protocol-iteration-4.md`、`server-notes-iteration-4.md`；测试 | A、B、C |
| B 守护进程与 CLI | `issue design-proposal`、`pm *` 子命令；推理强度映射；简报 Design first / Project manager 段；回声指令 `[echo:design]`（提方案并 proposal_review）、`[echo:pm=question]`；sync-protocol 处理 iter4 | B、C |
| C 前端 | 统一新建任务对话框；流程选择与徽标；方案卡与决定动作；看板新列；`/pm` 会话页；Agent 表单与设置项；时间线标签 | B、C、D |
| D 文档 | 《NocoBase 3 前端交互最佳实践》与《NocoSolution 前端标准》（见产品负责人要求：只写结果，不写过程） | — |

三方只通过本契约耦合；出入写进 `protocol-iteration-4.md` 末节。
