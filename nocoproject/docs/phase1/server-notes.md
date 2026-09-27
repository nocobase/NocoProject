# Phase 1 迭代 1 服务端说明

服务端子任务（A）的交付记录。接口形状与出入以 `protocol-iteration-1.md` 为准。

## 1. 交付内容

| 位置                                                         | 内容                                                                                                                                                                                                                                   |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database/main/migrations/2026092800001_np_phase1_iter1.ts`  | 12 张新表（`workflowTemplates` 代替契约的 `workflows`）、`projects`/`issues`/`runs`/`runSessions`/`systemSettings` 追加列、PostgreSQL 部分唯一索引 `np_inbox_items_dedupe_unique`、`np_workflow_templates_default_unique`；完整 `down` |
| `database/main/seeds/2026092800002_np_default_workflow.ts`   | 默认模板"软件开发"（id `default`），已存在默认模板则不动                                                                                                                                                                               |
| `database/main/seeds/2026092800003_np_member_page_grants.ts` | 给默认权限集 `member` 追加 NocoProject 页面的 `access` 与 `settings:np-members` 的 `read`；无授权表时跳过                                                                                                                              |
| `server/modules/shared/authz.ts`                             | 应用层权限规则（可见性、负责人、终态、Agent 调用、项目管理）                                                                                                                                                                           |
| `server/modules/shared/db.ts`                                | `createTxRunner` 的 `beforeCommit` 钩子：事务内把领域事件交给通知模块                                                                                                                                                                  |
| `server/modules/shared/events.ts`（`@temporary`）            | 新增 `issue.created/updated`、`comment.created`、`run.failed`、`proposal.*`、`issue.batchDone`、`issue.dependencyReleased`、`inbox.changed`                                                                                            |
| `server/modules/shared/validate.ts`                          | 字段校验                                                                                                                                                                                                                               |
| `server/modules/member/`                                     | 成员引导、列表、角色                                                                                                                                                                                                                   |
| `server/modules/workflow/`                                   | 模板读取与缓存；`issue/status.ts` 改为编译模板得到目录与转换                                                                                                                                                                           |
| `server/modules/project/`                                    | 项目、成员、资源、计数（`project.records.ts` 另含认领载荷的项目块）                                                                                                                                                                    |
| `server/modules/label/`                                      | 标签与任务标签                                                                                                                                                                                                                         |
| `server/modules/issue/`                                      | `issue.fields.ts`（字段校验 + 字段级权限）、服务、查询（列表 / 看板 / 详情 / Agent 视图）                                                                                                                                              |
| `server/modules/subtask/`                                    | 阻塞判定、依赖（含环检测）、建议、Agent 建子任务                                                                                                                                                                                       |
| `server/modules/trigger/`                                    | 阻塞门控、`release.ts`（放行与批次完成）                                                                                                                                                                                               |
| `server/modules/notification/`                               | 订阅与收件箱存储、事件→收件人、收件箱接口                                                                                                                                                                                              |
| `server/modules/agent/`、`runtime/`、`run/`                  | Agent 访问级别与委派、运行时可见性、认领载荷扩展、`branchName`/`repoUrl`                                                                                                                                                               |
| `server/providers/np.ts`、`server/routes/np-*.ts`            | 新 token、`np:inbox` 主题、`np-members` 设置项注册、新路由                                                                                                                                                                             |
| `tests/logic/np-*.test.ts`                                   | 见 §2                                                                                                                                                                                                                                  |

## 2. 验证（2026-09-27 本机）

| 命令                                                                                           | 结果                                                                                                                                              |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm nocobase db apply`（开发库）                                                             | 迁移 batch 3 执行；两个种子执行；默认模板与 member 页面授权已写入（第一次因 `workflows` 表名冲突失败并整体回滚，改名后成功；没有用到 redo/reset） |
| 迁移 up / down                                                                                 | 临时 schema 中分批验证：Phase 0 一批、迭代 1 一批，rollback 只撤迭代 1，列与表恢复；`np-migration.test.ts` 覆盖整批 up/down 与部分索引            |
| `pnpm exec tsc -p tsconfig.server.json --noEmit`、`-p tsconfig.node.json`                      | 通过（`pnpm typecheck` 的 client 部分当时有前端进行中的错误，与服务端无关）                                                                       |
| `pnpm exec eslint --max-warnings 0` + `prettier --check`（改动的 server/tests 文件）           | 通过                                                                                                                                              |
| `pnpm exec vitest run tests/logic/np-`                                                         | 15 个文件 145 个用例通过（含前端的 `np-client-*`）                                                                                                |
| `pnpm exec vitest run tests/logic/client-routes.test.ts tests/logic/app-server.test.ts`        | 32 个用例通过                                                                                                                                     |
| `NOCOBASE_STRICT_STARTUP=true NOCOBASE_DEV_ALLOW_MULTIPLE=true APP_SERVER_PORT=13090 pnpm dev` | 3.4 秒就绪；healthz 200；`/np/issues`、`/np/inbox` 401；`/np/agent/context` 401；随后结束。13001 上原有开发服务器热重载后同样正常                 |

新测试：

- `np-subtasks.test.ts`：阻塞不入队并记活动、终态放行 `dependencyReleased`、无执行者通知负责人、批次（stage）放行、`childBatchDone` 唤醒并合并进待处理运行、父 dormant 不唤醒、`start: false`、删除依赖放行、自指 / 互指 / 传递环、子任务摘要与看板分组。
- `np-proposals.test.ts`：通过真实运行令牌和 Agent 路由建子任务（负责人、stage、标签、阻塞、children、CLI 式删除依赖、树外 403）；`self` 开关开 / 关；委派名单内自动接受、名单外建议并合并父负责人卡片、逐条与全部确认后卡片解决；无 Agent 访问权的用户确认 403、`accept-all` 记入 skipped、驳回后再确认 409。
- `np-inbox.test.ts`：自动订阅、不通知自己、退订与 @、合并计数 / 归档后重计、review 决策与解决、agentBlocked 与 run_failed、可重试失败不通知、进入 in_review 归档 run_failed、分页、全部已读、`inbox.changed` 事件。
- `np-authz.test.ts`：私有项目 404 与列表过滤、加成员后可见；负责人 / 终态规则（含项目 lead）；成员角色（admin 不能授 owner、最后一个 owner）；首个成员为 owner；Agent 访问级别（分配、@、`/note` 例外、canInvoke）；运行时绑定与可见性、委派目标校验；项目 / 资源 / 标签 / 删除项目解除关联 / 非法日期；项目模板改变目录与 Agent 转换。
- `np-members-app.test.ts`（整个应用，SQLite）：新注册普通用户的权限快照含 5 个页面与 `np-members`，`/np/issues` 200，成员列表角色正确，改角色 403，看不到私有项目。
- 旧测试随接口调整：`np-claim`（session 多两个字段）、`np-triggers`（`detail` 需要调用者）、`np-routes`（新 token 替身、新路由、CLI 形式的删除依赖）、`np-daemon-auth`（抽出 `np-app-harness.ts`）。

## 3. 设计要点

- **通知在事务内**：服务只 `tx.emit(event)`；`createTxRunner` 在最外层事务提交前把事件交给 `notification.service.ts`，订阅与收件箱写入和引起它的变更同进退；之后事件照旧提交后发到总线（实时）。没有任何服务直接写收件箱。
- **触发只在 trigger 模块**：`release.ts` 属于 trigger 模块，入队函数由 `trigger.service.ts` 传入。
- **阻塞门控在 `enqueueFor`**：所有新触发都经过它；重试不经过。
- **缓存**：模板视图与项目→模板映射在进程内缓存；成员引导对已见过的用户缓存。

## 4. 已知缺口

- Agent 读接口（`GET /np/agent/issues/:id` 等）仍可读任何任务，未按私有项目限制。
- 运行记录接口（`/np/runs/:id`、取消、重试）未做可见性检查（只要求登录）。
- 已排队的运行不会因新增阻塞依赖而撤回；执行者改走也不取消旧 Agent 的排队运行（Phase 0 遗留）。
- 收件箱正文是英文兜底，未走服务端 i18n；前端按 `type` + `payload` 本地化。
- `np:inbox` 以外没有项目 / 标签的实时主题（前端需在操作后自行刷新）。
- 设置项和分区标题是纯字符串（未本地化）。
- 迭代 1 模板只读：没有编辑接口，缓存失效只由项目 `workflowId` 变更触发。
- 成员引导缓存是进程内的；多实例部署下角色读取仍查库，不受影响。
