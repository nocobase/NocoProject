# Phase 1 迭代 2 契约：交付链路

> 在 `docs/phase0/protocol.md`、`docs/phase1/protocol-iteration-1.md` 之上追加，不推翻。类型写在新文件 `server/modules/shared/protocol.phase1-iter2.ts`（`protocol.ts` 末尾 `export * from './protocol.phase1-iter2.js'`），CLI 复制两个文件。路径前缀仍是 `/api/np`，成功 `{ data }`，失败 `{ code, message }`。
> 术语沿用迭代 1：`terminal` = done 或 closed 分类；`dormant` = backlog 或 terminal。
> 本轮主题：任务从"Agent 交付"走到"合并入主干"的完整链路，加上批量录入、审批门禁（临时实现）、富文本、表情与线程、环境变量、技能、用量、会话模式 v1，以及迭代 1 的遗留项。

## A. 数据模型追加（迁移 `2026092900001_np_phase1_iter2`）

新表（雪花字符串 id，带 createdAt/updatedAt）：

| 表 | 字段 | 约束 |
|---|---|---|
| `gitConnections` | provider('github'), name, apiBaseUrl(默认 `https://api.github.com`), tokenEncrypted(可空), webhookSecretEncrypted(可空), createdById, lastEventAt(可空) | 迭代 2 只允许一行（provider 唯一） |
| `pullRequests` | connectionId(可空), repo('owner/name'), number(int), url, title, state('open' \| 'closed' \| 'merged'), draft(bool), headRef, baseRef, headSha, authorLogin, additions, deletions, changedFiles, mergeableState(可空), ciState('pending' \| 'success' \| 'failure' \| null), mergedAt, closedAt, snapshotAt | unique(repo, number) |
| `issuePullRequests` | issueId, pullRequestId, linkedByType('user' \| 'agent' \| 'system'), linkedById(可空), autoCompleteDisabled(bool 默认 false) | unique(issueId, pullRequestId) |
| `webhookDeliveries` | provider, deliveryId, receivedAt | unique(provider, deliveryId)；只保留 7 天（sweeper 顺手清） |
| `approvalRequests` **@temporary(nocobase-official)** | issueId, fromStatus, toStatus, requestedByType('user' \| 'agent'), requestedById, requestedRunId(可空), approverUserIds(json string[]), status('pending' \| 'approved' \| 'rejected' \| 'cancelled'), decidedById, decidedAt, comment | index(issueId, status)；同一任务同一 toStatus 只能有一条 pending |
| `commentReactions` | commentId, userId, emoji(string 32) | unique(commentId, userId, emoji) |
| `agentEnvVars` | agentId, name, valueEncrypted, updatedById | unique(agentId, name) |
| `agentEnvAudits` | agentId, userId, action('reveal' \| 'set' \| 'delete'), names(json string[]) | index(agentId, createdAt) |
| `skills` | name, slug, description, content(SKILL.md 正文，Markdown), source('manual' \| 'import'), createdById | unique(slug) |
| `skillFiles` | skillId, path, content | unique(skillId, path)；每技能 ≤ 20 个文件，每个 ≤ 64 KB |
| `agentSkills` | agentId, skillId | unique(agentId, skillId) |
| `intakeBatches` | createdById, projectId(可空), source('paste' \| 'issue'), rawContent, parser('ai' \| 'heuristic'), status('draft' \| 'confirmed' \| 'cancelled' \| 'reverted'), aiSessionId(可空), confirmedAt | index(createdById, createdAt) |
| `intakeDrafts` | batchId, position(int), parentPosition(int 可空), fields(json，见 §C), validation(json { errors: string[] }), createdIssueId(可空) | unique(batchId, position) |

列追加：

| 表 | 追加 |
|---|---|
| `issues` | executionMode('task' \| 'session'，默认 task)、originType('manual' \| 'intake' \| 'agent'，默认 manual，Agent 建的子任务回填 agent)、originId(可空) |
| `comments` | 若尚无：resolvedAt、resolvedById |
| `systemSettings.settings` | `prMergedStatus`（已有，`'none'` 表示不改）、`modelPrices: ModelPrice[]`（默认空）、`intakeParser: 'auto' \| 'heuristic'`（默认 auto） |
| `workflowTemplates.definition.transitions[]` | 可选 `approval: { approvers: ('owner' \| 'projectLead' \| 'admin')[] }` |

种子 `2026092900002_np_workflow_with_approval`：第二个非默认模板"软件开发（验收审批）"，与默认模板相同但 `in_review → done`（actors user）带 `approval: { approvers: ['projectLead', 'owner'] }`。项目可通过 `PATCH /np/projects/:id { workflowId }` 选用（迭代 1 列已存在，本轮开放写入；改模板时若任务处于新模板没有的状态则 409 `WORKFLOW_STATUS_CONFLICT`）。

## B. 加密与密钥

`server/modules/shared/crypto.ts`：AES-256-GCM，密文格式 `v1:<iv b64>:<tag b64>:<data b64>`。密钥来源：环境变量 `NOCOPROJECT_SECRET_KEY`（32 字节 hex 或 base64）；未设置时用 `sha256(auth.secret + ':nocoproject')` 派生并在启动日志 warn 一次（开发用，生产必须显式配置）。密钥只在 `crypto.ts` 内读取；服务只调用 `encrypt/decrypt`。任何接口都不回显 token、webhook secret；环境变量只在 `reveal` 接口回显并留审计。

## C. GitHub 集成

**连接配置**（owner/admin）：

```
GET  /np/integrations/github        → { configured, apiBaseUrl, tokenSet, webhookSecretSet, webhookUrl, lastEventAt }
PUT  /np/integrations/github        { apiBaseUrl?, token?, webhookSecret? }   （字段缺省 = 不变；空串 = 清除）
POST /np/integrations/github/test   → { ok, login, scopes? }  （用 token 调 GET /user；未配 token 409 GITHUB_NOT_CONFIGURED）
```

`webhookUrl` = `${publicOrigin}/np/webhooks/github`（`publicOrigin` 来自 `app.publicOrigin` 配置，缺省用请求的 origin）。

**Webhook**（`defineRootRoutes`，公开路由，注释说明原因）：`POST /np/webhooks/github`。用原始 body 校验 `X-Hub-Signature-256`（HMAC-SHA256，`timingSafeEqual`）；未配置 secret 或签名不符 401 `INVALID_SIGNATURE`；`X-GitHub-Delivery` 重复投递 200 `{ duplicate: true }` 不重复处理；`ping` 返回 200。处理事件：

| 事件 | 处理 |
|---|---|
| `pull_request`（opened / edited / synchronize / reopened / ready_for_review / converted_to_draft / closed） | upsert `pullRequests`；按关联规则关联任务；`closed && merged` → 合并流程 |
| `check_suite`（completed）、`status` | 按 headSha 更新 `ciState`（success / failure / pending） |
| 其他 | 200 忽略 |

**关联规则**（服务端 `git/link-rules.ts`，纯函数，单测）：按顺序取第一条命中：headRef 形如 `agent/<slug>/<identifier>`（`identifier` 小写，如 `np-12`）→ 该任务；标题、body、headRef 中出现任务编号（`\bNP-\d+\b`，前缀取系统设置，大小写不敏感）→ 全部命中的任务（去重，最多 5 条）；没有命中则只存 PR 不关联。关联时 `linkedByType='system'`，活动 `pr_linked`，推 `np:issues`。

**合并流程**：PR 合并后，对每条关联任务：未到终态、且该任务所有未 `autoCompleteDisabled` 的关联 PR 都已 merged → 按 `settings.prMergedStatus` 改状态（`'none'` 不改；系统 actor，不经审批门禁，`AGENT_TRANSITIONS` 不限制），活动 `pr_merged`（details: repo, number），收件箱 info `pr_merged` 给订阅者；已到终态只写活动。PR 转为 ready（非 draft、open）且任务执行者是 Agent → 负责人 decision `pr_review`（"PR 待合并"，dedupeKey `user:<owner>:pr_review:<issueId>`），PR 合并或关闭时自动 resolve。

**浏览器接口**：

```
GET    /np/issues/:id/pull-requests                      → IssuePullRequestView[]（详情里也带 pullRequests）
POST   /np/issues/:id/pull-requests   { url }            → 用 token 拉取 PR（`GET /repos/{owner}/{repo}/pulls/{n}`）后关联；无 token 409 GITHUB_NOT_CONFIGURED；URL 非法 400 INVALID_PR_URL
DELETE /np/issues/:id/pull-requests/:prId                → 解除关联（不删 PR 行）
PATCH  /np/issues/:id/pull-requests/:prId  { autoCompleteDisabled }
POST   /np/issues/:id/pull-requests/:prId/refresh        → 重新拉取快照（含 mergeable、CI）
```

**Agent 回写**（运行令牌）：`POST /np/agent/issues/:id/pull-requests { url }`（`linkedByType='agent'`；无 token 时只按 URL 解析 repo/number 建最小 PR 行，state open，等 webhook 补全），`GET /np/agent/issues/:id/pull-requests`。

**CLI**：`nocoproject pr link <url> [--issue <id>]`、`nocoproject pr list [--issue <id>] --json`。简报 `## Repositories` 追加："提交后用 `gh pr create --title "<identifier>: ..."`，然后 `nocoproject pr link <url>`；分支名已含任务编号，服务端也会自动关联"。

## D. 审批门禁 **@temporary(nocobase-official)**

接口 `server/modules/shared/approval.ts`（枚举 `APPROVAL_STATUSES`、`ApproverRole`、`ApprovalGateway`），实现 `server/modules/approval/`（`approvalRequests` 表 + 审批人解析）。业务模块只依赖接口；测试里另有 `MemoryApprovalGateway` 跑同一套用例（第 8 章"替换检查清单"）。

```ts
interface ApprovalGateway {
  gate(input: { issue, fromStatus, toStatus, actor }): Promise<{ kind: 'pass' } | { kind: 'pending'; requestId: string }>;
  approve(requestId, actor, comment?): Promise<ApprovalRequest>;
  reject(requestId, actor, comment?): Promise<ApprovalRequest>;
  listForIssue(issueId): Promise<ApprovalRequest[]>;
  listPending(userId): Promise<ApprovalRequest[]>;
}
```

规则：
- 状态机在应用转换前调用 `gate`。转换没有 `approval` → pass；actor 是 system → pass；actor 自己就是审批人（负责人 / 项目 lead / admin 按 approvers 解析）→ pass 并写活动 `approval_self`；否则创建 pending 请求，状态不变，活动 `approval_requested`，审批人各一条 decision `approval_pending`（dedupeKey `user:<uid>:approval_pending:<issueId>`）。
- 同一任务同一 toStatus 已有 pending → 409 `APPROVAL_PENDING`。任务状态被别的路径改掉、或任务终态 → 未决请求 `cancelled`。
- approve：由系统以"代表审批人"应用转换（活动 `approval_approved`，statusChange 活动的 actor 记审批人），请求者是成员 → info `approval_decided`；reject：状态不变，活动 `approval_rejected`（details.comment），请求者是成员 → info `approval_decided`；请求者是 Agent → 给任务负责人 info；两者都 resolve 审批人的决定卡。
- 审批人解析：`owner` → 任务负责人；`projectLead` → 项目 lead（无项目或无 lead 跳过）；`admin` → 所有 owner/admin 成员。解析为空 → pass 并写活动 `approval_no_approver`。

接口：`GET /np/approvals?status=pending`（当前用户待审）、`POST /np/approvals/:id/approve|reject { comment? }`（非审批人 403）。`PATCH /np/issues/:id { statusKey }` 命中门禁时返回 **202** `{ data: { issue（未变）, pendingApproval: ApprovalRequest } }`；Agent 路由 `POST /np/agent/issues/:id/status` 同样 202，CLI 打印 "approval pending (request <id>)"，回声 Agent 把它当成功。任务详情追加 `approvals: ApprovalRequest[]`（未决 + 最近 5 条已决）。

## E. 批量录入（intake）

```
POST  /np/intake/batches            { source: 'paste', rawContent, projectId? }   → { batch, drafts, parser }
POST  /np/intake/batches            { source: 'issue', issueId }                  → 把任务描述拆成子任务草稿（parentPosition 全空，confirm 时挂到该任务下）
GET   /np/intake/batches?mine=1     → IntakeBatch[]（最近 50）
GET   /np/intake/batches/:id        → { batch, drafts }
PUT   /np/intake/batches/:id/drafts { drafts: IntakeDraftInput[] }                → 整体替换并重新校验 → { drafts }
POST  /np/intake/batches/:id/confirm { ownerUserId?（默认录入者）, defaultExecutor?: ExecutorInput }  → { issues: IssueRef[] }
POST  /np/intake/batches/:id/cancel
POST  /np/intake/batches/:id/revert → 撤回：本批创建的、没有任何运行的任务软删除（deletedAt）；有运行的保留 → { reverted: string[], kept: string[] }
```

`fields`：`{ title, description?, priority?, labels?: string[], stage?: number \| null, executor?: ExecutorInput \| null, ownerUserId?: string \| null }`。校验：title 必填 ≤ 200；parentPosition 必须指向更小的 position 且不成环；stage 只对有 parent 的行有效；executor 为 Agent 时录入者必须 `canInvoke`。

**解析器** `intake/parser.ts` 接口 `IntakeParser.parse({ rawContent, project, workflow, labels }) → IntakeDraftInput[]`：
- `AiIntakeParser`：`ai.llmServices` 非空且 `settings.intakeParser='auto'` 时使用。用 `agentServiceFactoryToken.createAgent({ sessionId, actor: 调用者, tools: [] })` + Zod `responseFormat`（drafts 数组）一次 invoke，系统提示给出项目名 / 描述、可用标签、优先级枚举、"按依赖分 stage、子需求用 parentPosition"规则；30 秒超时或失败 → 回退启发式并把 `parser='heuristic'`、`batch.parseError` 记进响应（不失败）。
- `HeuristicIntakeParser`：无 LLM 时使用。规则：`#`/`##` 标题行 = 父任务；`-`/`*`/`1.` 列表行 = 任务，缩进 ≥ 2 空格 = 上一条非缩进行的子任务；`[urgent] [high] [medium] [low]`、`!!`/`!` 映射优先级；`#tag` 变标签；`@stage2`/`(stage 2)` 变 stage；空行分隔的普通段落每段一条；CSV（首行含 `title`）按列读。纯函数，单测覆盖每条规则。

确认创建：父先子后，`originType='intake'`、`originId=batchId`、创建者 = 录入者、活动 `issue_created`（details.intakeBatchId）；执行者是 Agent 的按迭代 1 规则入队（受阻塞判定）；`intakeBatches.status='confirmed'`。前端页 `/intake`（侧栏"批量录入"），项目页"批量添加"带 `?project=`。

## F. 表情与线程解决

```
POST   /np/comments/:id/reactions { emoji }   DELETE /np/comments/:id/reactions/:emoji
POST   /np/comments/:id/resolve   POST /np/comments/:id/unresolve      （只对线程根评论；能看到任务的成员）
```

固定表情集 `REACTION_EMOJIS = ['👍','👀','🎉','❤️','🚀','😄','🤔','👎']`，其他 400 `INVALID_EMOJI`。评论行追加 `reactions: [{ emoji, count, userIds }]`、`resolvedAt`、`resolvedByName`；活动 `thread_resolved` / `thread_unresolved`；推 `np:issues`。Agent 视图的评论列表标出 `resolved: true`，简报里已解决线程默认不带入（只带未解决的 + 触发线程）。

## G. Agent 环境变量与审计

```
GET    /np/agents/:id/env            → [{ name, updatedAt, updatedByName }]（不含值）
PUT    /np/agents/:id/env            { vars: [{ name, value }] }   → upsert（Agent 所有者、owner/admin）
DELETE /np/agents/:id/env/:name
POST   /np/agents/:id/env/reveal     → [{ name, value }]（owner/admin；审计 reveal）
GET    /np/agents/:id/env/audits     → AgentEnvAudit[]（最近 100，owner/admin）
```

`name` 满足 `^[A-Z_][A-Z0-9_]*$`，`NOCOPROJECT_*`、`PATH`、`HOME`、`SHELL` 保留 400 `RESERVED_ENV_NAME`；值 ≤ 8 KB。set / delete 写审计（names 列表）。认领载荷 `agent.env: Record<string,string>`（解密后，只走守护进程路由）。守护进程：注入工具进程环境（保留名跳过），把所有值加入事件脱敏表（值长度 ≥ 6 才脱敏，避免把 `1` 之类全替换掉），`context.json` **不写** env。

## H. 技能

```
GET/POST /np/skills            PATCH/DELETE /np/skills/:id        GET /np/skills/:id → { skill, files }
PUT      /np/skills/:id/files  { files: [{ path, content }] }     （整体替换；path 相对、禁止 `..`）
```

`slug` 由 name 生成（小写、连字符，唯一）；任何成员可读，创建者与 owner/admin 可改；`DELETE` 时解除所有 Agent 挂载。`agents` 增加 `skillIds[]`（PATCH/GET）；认领载荷 `agent.skills: [{ id, slug, name, description, content, files: [{ path, content }] }]`。守护进程：每轮写 `<workDir>/.nocoproject/skills/<slug>/SKILL.md` 与文件（整目录重建）；Claude Code 适配器另把它们复制到 `<workDir>/.claude/skills/<slug>/`（Claude Code 原生发现）；简报 `## Skills` 列出每个技能的名称、描述、路径，并说明"需要时读 SKILL.md"。前端 `/skills`、`/skills/:id`（名称、描述、SKILL.md 编辑器、文件列表可增删改）、Agent 详情技能多选。

## I. 用量统计

```
GET /np/usage?from=YYYY-MM-DD&to=YYYY-MM-DD&groupBy=agent|issue|project|day|model&projectId=&agentId=
  → { rows: UsageRow[], totals: UsageRow }
UsageRow = { key, name, runs, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, estimatedCost: number | null }
GET   /np/settings          → WorkspaceSettings（含 modelPrices）    PATCH /np/settings（owner/admin）
```

`ModelPrice = { provider, model（glob，如 `claude-*`）, inputPerM, outputPerM, cacheReadPerM, cacheWritePerM }`（美元 / 百万 token）；没有匹配价格的行 `estimatedCost=null`，totals 只加有价格的并带 `pricedRuns`。可见性：普通成员只能看自己有权看到的任务的用量（按任务可见性过滤）；owner/admin 全部。任务详情右栏"用量"= 该任务所有运行合计。前端页 `/usage`（侧栏"用量统计"）：日期范围（默认 30 天）、分组标签、表格、合计行；设置页 `/settings/nocoproject`（owner/admin）：`prMergedStatus`、`autoExecuteSubtasksDefault`、`intakeParser`、`modelPrices` 表格编辑。

## J. 会话模式 v1（运行中插话 = 下一轮输入）

- `PATCH /np/issues/:id { executionMode }`，活动 `execution_mode_changed`；认领载荷 `issue.executionMode`。
- 服务端行为不变：运行中的新评论合并进排队运行，本轮结束立即认领（Phase 0 已有）。补一条：会话模式下 `GET /np/issues/:id/runs` 与详情带 `queuedRun: { id, triggerCount } | null`（排队中的那条），前端显示"本轮结束后发送（N 条）"。
- 守护进程：会话模式的简报开头改为对话式（"你在和负责人实时对话，简短回复，不要每轮都写总结报告；工作目录与会话续接"），触发列表不变；完成时不要求 in_review（人会自己切状态）。
- 前端：任务详情右栏"执行面板"在会话模式下展开为对话窗：实时事件流（复用 `np:run:<id>` 与运行记录组件）、底部输入框（发送 = 顶层评论，支持 @ 与 `/note`）、运行中提示排队；切换模式的开关在属性面板，切换写活动。

## K. 迭代 1 遗留项（本轮必须收掉）

服务端：
- Agent 读接口（`GET /np/agent/issues/:id`、comments、children）按运行所属任务的可见范围限制：只能读同项目（或无项目）的任务，否则 404。
- `/np/runs/:id`、events、cancel、retry 按任务可见性检查（404）。
- 新增 `blockedBy` 依赖时，若被阻塞任务有 `queued` 运行（未 dispatched）→ 取消（failureReason `blocked`，活动 `run_deferred_blocked`）；已 dispatched/running 不动。
- 设置项标题与分区标题本地化（用 i18n key）。
- 收件箱正文改为结构化：`payload` 里带渲染所需字段，`body` 保留英文兜底。

前端：
- 导航"收件箱"未读角标（decision 数，实时 `np:inbox`）。
- 删除项目（详情页"更多"菜单，二次确认）；仓库资源编辑与排序（PATCH 已有）。
- 标签选色（7 色）。
- 主"新建任务"弹窗：负责人选择器、执行者为 Agent 时"确认开始"、项目预选、`executionMode`。
- 收件箱卡片按 `type + payload` 本地化渲染。

## L. 守护进程与 CLI 汇总

- 认领载荷追加（`ClaimedRunPhase2Extras`）：`agent.env`、`agent.skills`、`issue.executionMode`、`issue.pullRequests: [{ number, url, state }]`。
- `context.json` 追加 `issue.executionMode`、`issue.pullRequests`，不含 env。
- 新子命令：`pr link`、`pr list`；`issue status` 处理 202。
- 简报：`## Skills`、PR 段落、会话模式开场、已解决线程不带入。
- Claude Code：本机无 `claude` 命令，真机校验以夹具为准，`claude.live.test.ts` 在缺少命令时 skip 并在报告里注明。
- 回声 Agent 指令追加：`[echo:pr=<url>]`（调用 `pr link`）、`[echo:status=<key>]`（尝试写某状态并接受 202）、`[echo:env=<NAME>]`（把该环境变量的值写进回复，用来验证注入与脱敏）、`[echo:skill=<slug>]`（读 `.nocoproject/skills/<slug>/SKILL.md` 首行写进回复）。

## M. 类型与常量（`protocol.phase1-iter2.ts`）

`GitConnectionView`、`PullRequest`、`IssuePullRequestView`（PR + linkedBy + autoCompleteDisabled）、`ApprovalStatus`、`ApproverRole`、`ApprovalRequest`、`CommentReaction`、`REACTION_EMOJIS`、`AgentEnvVarView`、`AgentEnvAudit`、`Skill`、`SkillFile`、`SkillDetail`、`IntakeBatch`、`IntakeDraft`、`IntakeDraftInput`、`IntakeDraftFields`、`UsageRow`、`UsageGroupBy`、`ModelPrice`、`ExecutionMode`、`ClaimedRunPhase2Extras`、`AgentPullRequestLinkRequest`；`InboxItemType` 追加 `approval_pending | approval_decided | pr_review | pr_merged`；`RunFailureReason` 追加 `blocked`；活动 action 追加 `pr_linked | pr_unlinked | pr_merged | approval_requested | approval_approved | approval_rejected | approval_self | approval_no_approver | thread_resolved | thread_unresolved | execution_mode_changed | env_changed | skills_changed | intake_confirmed | intake_reverted`；`REALTIME_TOPICS` 不变。

## N. 分工

| 子任务 | 交付 | 章节 |
|---|---|---|
| A 服务端 | 迁移与种子；crypto；GitHub 连接、Webhook、关联规则、合并流程、PR 接口；审批网关（临时实现 + Memory 替身测试）；intake（两种解析器）；表情与线程；环境变量与审计；技能；用量与设置；会话模式字段；遗留项；认领载荷扩展；`protocol.phase1-iter2.ts` | A–K、M |
| B 守护进程与 CLI | env 注入与脱敏；技能落盘（含 Claude Code 目录）；`pr link/list`；`issue status` 202；简报新段落；会话模式开场；context.json 追加；回声指令；Claude live 测试 skip 策略 | C、G、H、J、L |
| C 前端 | TipTap 富文本（描述与评论，Markdown 往返、@、`/note`）；PR 卡片与手动关联；审批卡与 `/approvals` 入口（收件箱决定项）；批量录入页；表情与线程折叠；Agent 环境变量与技能挂载；技能页；用量页与设置页；会话模式面板；GitHub 连接设置页；遗留项 | C–K |

顺序约束同迭代 1：三方只通过本契约耦合；服务端实现有出入时写进 `protocol-iteration-2.md` §"与契约的出入"，并通知另外两方。
