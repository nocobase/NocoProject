# Phase 1 迭代 2 集成记录（2026-09-27）

> 三个并行子任务（服务端 / 守护进程与 CLI / 前端）交付后由主会话集成联调。服务端实现细节见 `server-notes-iteration-2.md` 与 `protocol-iteration-2.md`（§11 列出 16 条与契约的出入）。

## 1. 联调结论

真实开发服务器（13001，PostgreSQL）+ 本机守护进程（回声、OpenCode、Codex）跑 `e2e-iter2.mjs` 九组用例，全部通过：

| 链路 | 验证内容 | 结果 |
|---|---|---|
| GitHub | 设置 webhook secret 后不回显；成员读连接配置 403；错签名 / 缺签名 401；`ping` 200；`pull_request opened` 按分支名 `agent/echo/np-N` 自动关联；重复投递 `duplicate: true`；负责人收到 `pr_review` 决定项；`status` 事件写 CI；合并事件把任务改为 done、PR 状态 merged、活动 `pr_merged`、`pr_review` 自动解决；无令牌手动关联 409 `GITHUB_NOT_CONFIGURED` | 通过 |
| 审批门禁（临时实现） | 项目切到"软件开发（验收审批）"模板；负责人自己写 done 直接通过并记 `approval_self`；非审批人成员写 done 得 202、状态不变、详情列出待审、活动 `approval_requested`、重复请求 409；审批人收到 `approval_pending`；非审批人批准 403；`GET /np/approvals` 列出待审；批准后转换生效、活动 `approval_approved`、请求者收到 `approval_decided`、决定卡解决；驳回路径状态不变并记 `approval_rejected` | 通过 |
| 批量录入 | 启发式解析：`#` 标题成父任务、列表行成任务、缩进成子任务、`[high]` / `#auth` / `@stage1` 识别；空标题被校验标红；确认创建 6 条（父先子后，`originType=intake`）；撤回软删除全部无运行的任务 | 通过 |
| 表情与线程 | 成员点 👍、集合外表情 400、计数可见、解决线程写 `resolvedAt` 与活动、取消表情 | 通过 |
| 环境变量 | 保留名 400；列表只有名字；成员 reveal 403；admin reveal 得到值并留审计（set + reveal）；回声 Agent 在回复里写出了注入的值，而运行事件里该值已脱敏 | 通过 |
| 技能 | 建技能与文件、`..` 路径 400、挂到 Agent；回声 Agent 从 `.nocoproject/skills/<slug>/SKILL.md` 读到正文 | 通过 |
| 用量与设置 | admin 设模型价格、成员改设置 403；按 Agent 分组有回声行且成本已估算；按天分组带合计 | 通过 |
| 会话模式 | 创建即 session；运行中评论进入 `queuedRun`；本轮结束后第二轮自动执行；切回任务模式记活动 | 通过 |
| 迭代 1 遗留 | 私有项目任务的运行列表对非成员 404；回声并发设为 1 并用睡眠运行占住后，新增阻塞依赖把排队中的运行撤回为 `cancelled / blocked` | 通过 |

界面在浏览器实测：任务详情的 PR 卡片（merged、+10/−2、CI、自动完成开关）、审批活动、"AI 拆解"入口、右栏用量与会话模式开关；批量录入页；技能详情（SKILL.md 与文件编辑）；用量页（按 Agent、有成本列）；Agent 详情的技能多选、环境变量与审计；GitHub 与 NocoProject 设置页。

## 2. 集成时修的问题

| 问题 | 修法 |
|---|---|
| `protocol.ts` 末尾多了服务端专用的 `export * from './protocol.phase1-iter2-server.js'`，CLI 复制后编译失败 | CLI 增加 `scripts/sync-protocol.mjs`（`pnpm sync-protocol`）：复制两个共享文件并去掉那一行 |
| `POST /np/issues` 忽略 `executionMode`（只有 PATCH 支持） | 服务端补 `CreateIssueRequestV2`，创建时写入并校验 |
| 集成脚本两处错误预期：让 Agent 写 done 触发门禁（Agent 本就不能写 done），启发式解析把 `#` 标题算成父任务（契约如此） | 改脚本：门禁用非审批人成员触发；期望 6 条草稿 |

## 3. 测试

| 套件 | 结果 |
|---|---|
| `nocoproject` 全量 `vitest run` | 87 个文件 660 个用例通过（迭代 1 是 64 / 479） |
| 其中服务端 `tests/logic/np-*` | 31 个文件 297 个用例（含前端 `np-client-*`） |
| `nocoproject-cli` | 14 个文件 146 个用例通过；`claude.live.test.ts` 因本机无 `claude` 命令跳过 |
| `pnpm typecheck`、eslint `--max-warnings 0`、prettier | 通过 |

## 4. 与契约的出入与已知缺口

服务端 16 条出入见 `protocol-iteration-2.md` §11。集成后需要记住的：
- 类型分两个文件：`protocol.phase1-iter2.ts`（CLI 复制）与 `protocol.phase1-iter2-server.ts`（服务端组合类型，CLI 不复制）；迭代 3 做 workspace 化时合并成共享包。
- 命中门禁的 PATCH 整体不生效；审批是单人决定，任一审批人批准即生效。
- webhook 地址带部署基路径（开发机 `/main/np/webhooks/github`），不在 `/api` 下。
- 手动关联已合并的 PR 不触发合并流程；CI 只取 combined status 与 check suite。
- `env_changed` / `skills_changed` 没有活动（活动挂任务），环境变量有审计表。
- 富文本保存会把部分 Markdown 规范化（`_x_` → `*x*` 等）；会话面板只显示顶层评论与实时轮次。
- 未在真实 GitHub 与真实 LLM 上跑过（本机无令牌、无 LLM）；AI 解析器用假工厂测试，线上走启发式。
- 撤回的任务仍出现在旧收件箱项里（点开 404）。
- 分支不推送、`gh pr create` 依赖运行时机器上的 `gh` 登录。
- 迁移文件在开发库执行后被 prettier 重排过，`db repair` 会对齐两条 checksum（`2026092900001_np_phase1_iter2` 与 Phase 0 的 `2026092900002_np_system_settings`），需要人在终端执行。
