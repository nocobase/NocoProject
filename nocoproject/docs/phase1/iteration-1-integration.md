# Phase 1 迭代 1 集成记录（2026-09-27）

> 三个并行子任务（服务端 / 守护进程与 CLI / 前端）各自交付后，由主会话做集成联调。服务端实现细节见 `server-notes.md` 与 `protocol-iteration-1.md`。

## 1. 联调结论

用真实开发服务器（13001，PostgreSQL）+ 本机守护进程（回声、OpenCode、Codex 三个运行时）跑 `e2e-iter1.mjs` 五组用例，全部通过：

| 链路 | 验证内容 | 结果 |
|---|---|---|
| 权限边界 | 新注册普通成员：私有项目的任务与项目 404、列表不泄露；不能改他人任务负责人、不能给他人任务写 done、自己的任务可以；不能改成员角色、不能改非自己 lead 的项目；加入项目成员后可见；`ownerOnly` 的 Agent 对成员 `canInvoke=false` 且分配 403；`start:false` 只改字段不入队 | 通过 |
| 子任务与批次 | 父任务（`autoExecuteSubtasks=true`）由回声 Agent 拆成 stage 1/2 两个子任务；stage 2 不入队并记 `run_deferred_blocked`、列出 stage 阻塞者；stage 1 done 后 stage 2 以 `dependencyReleased` 放行；两批全部 done 后父执行者被 `childBatchDone` 唤醒并交付 in_review；负责人收到 `batch_done` 与 `review_requested` | 通过 |
| 执行者建议 | 父任务开关关闭时 `--executor self` 变成 pending 建议，子任务无执行者、`suggestedExecutorAgentId` 指向该 Agent，负责人收到合并的 `proposal_pending` 卡；对 Agent 无访问权的成员确认 403；确认后子任务以 `proposalAccepted` 运行；卡片自动解决 | 通过 |
| 仓库 checkout | 项目挂 gitRepo 资源，Agent 通过 `repo checkout` 在裸仓缓存 + worktree 上提交，分支 `agent/echo/np-N` 记录到 `runs.branchName/repoUrl` 并显示在运行卡片；不在资源清单里的 URL 退出码 5，运行以失败结束 | 通过 |
| 收件箱 | `owner_assigned`、`mentioned`、未读计数、已读 / 归档 / 全部已读、不通知自己 | 通过 |

界面在浏览器实测：看板（拖拽、空列投放、移出 backlog 的"确认开始"弹窗）、任务详情（子任务分组、依赖、建议卡、订阅、执行日志分支）、收件箱两栏、项目列表与详情（资源、成员、可见性）、Agent 详情（访问范围、委派名单）、成员设置页。

## 2. 集成时修的问题

| 问题 | 修法 |
|---|---|
| 回声 Agent 被 `childBatchDone` 唤醒时又按 `[echo:subtasks=N]` 再拆一遍，父任务永远到不了 in_review | 唤醒轮先 `issue children`：已有子任务则不再拆，全部终态才写 in_review（`echo-agent.ts`，e2e 测试补两轮） |
| 看板拖到空列无效：`closestCorners` 下高而空的列输给原列里最近的卡片 | `boardCollisionDetection` = `pointerWithin` 优先、回退 `closestCorners`（`board-model.ts`） |
| 运行摘要（`RunSummary`）没有分支字段，分支名只在库里 | `run.queries.ts` 补 `branchName/repoUrl`，协议类型与 CLI 副本同步，执行日志卡片显示分支 |

## 3. 测试

| 套件 | 结果 |
|---|---|
| `nocoproject` 全量 `vitest run` | 64 个文件 479 个用例；全量并行时偶发 1 个超时（`client-routes` 加载全部页面 30 秒、`client-theme`、`client-settings` 各出现过一次），单独重跑均通过，属于机器负载导致 |
| `nocoproject` 服务端 `tests/logic/np-*` | 177 个用例通过（真实 PostgreSQL） |
| `nocoproject-cli` | 13 个文件 126 个用例通过；Codex 真机测试另跑通过 |
| `pnpm typecheck`、eslint `--max-warnings 0`、prettier | 通过 |

## 4. 与契约的出入与已知缺口

服务端 14 条出入记录在 `protocol-iteration-1.md` §11，其中前端与 CLI 需要知道的：`workflows` 表名为 `workflowTemplates`；日期存 `YYYY-MM-DD` 字符串；`GET /np/members` 列出所有用户；owner/admin 能看到所有私有项目但没有额外的 Agent 访问权；建议可在父任务或子任务上确认；@ 无权访问的 Agent 会被 403（`/note` 例外）。

留给后续迭代：
- Agent 读接口与 `/np/runs/*` 未按私有项目做可见性限制。
- 新增阻塞依赖不撤回已排队的运行。
- 收件箱正文是英文兜底，前端按 `type + payload` 渲染。
- 项目与标签没有实时主题；设置项标题未本地化；模板只读。
- 前端未做：删除项目入口、编辑 / 排序仓库资源、导航上的收件箱未读角标、标签选色、主新建任务弹窗的负责人选择与"确认开始"。
- `protocol.ts` 已到 1115 行，迭代 3 做 pnpm workspace 化时拆包。
- 分支只在守护进程本机的裸仓缓存里，推送与 PR 在迭代 2（GitHub 集成）。
