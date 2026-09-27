# Phase 0 服务端说明

服务端子任务（A）的交付记录：做了什么、怎么验证的、和协议的出入、还没做的。协议本身以 `protocol.md` 和 `server/modules/shared/protocol.ts` 为准。

## 1. 交付内容

| 位置                                                                               | 内容                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `database/main/migrations/2026092700001_np_phase0.ts`                              | 13 张表、全部索引；PostgreSQL 上用原生 SQL 建部分唯一索引 `np_runs_pending_unique`；完整 `down`                                                                                                              |
| `database/main/seeds/2026092700002_np_system_settings.ts`                          | `systemSettings` 单行 `{ id: 'default', issuePrefix: 'NP', issueCounter: 0 }`，已存在则不动                                                                                                                  |
| `server/modules/shared/`                                                           | `protocol.ts`（补了界面接口类型）、`errors.ts`、`db.ts`（事务 + 提交后发事件）、`events.ts` / `activity.ts`（`@temporary`）、`ids.ts`、`users.ts`、`http.ts`（错误映射、运行令牌拦截）、`realtime-bridge.ts` |
| `server/modules/{system,project,issue,collaboration,agent,runtime,run,trigger}/`   | 各模块的 service 与 routes；`run/` 下另有 `claim.sql.ts`、`claim.service.ts`、`failure.ts`、`run-events.ts`、`sweeper.ts`、`token.ts`、`sessions.ts`                                                         |
| `server/modules/services.ts`                                                       | 组装所有服务（Provider 和测试共用）                                                                                                                                                                          |
| `server/providers/np.ts`、`server/providers/index.ts`                              | 各模块 token、实时主题、30 秒清扫器（`@nocobase/cron`）                                                                                                                                                      |
| `server/routes/np-api.ts`、`np-daemon.ts`、`np-agent.ts`、`server/routes/index.ts` | 三组路由贡献                                                                                                                                                                                                 |
| `tests/logic/np-*.test.ts`、`tests/logic/np-harness.ts`                            | 路由测试与真实 PostgreSQL 集成测试（`np-client-*` 是前端的，不属于这里）                                                                                                                                     |
| `package.json` / `pnpm-lock.yaml`                                                  | `@nocobase/cron` 从 devDependencies 移到 dependencies（服务端运行时导入）；锁文件只改了 importer 一处，`pnpm install --frozen-lockfile --offline` 通过，node_modules 未变                                    |
| `AGENTS.md`                                                                        | 新增 "NocoProject server modules" 一节                                                                                                                                                                       |

## 2. 验证

全部在 2026-09-27 本机执行。

| 命令                                                                                                                  | 结果                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm nocobase db apply`（开发库 `nocoproject`）                                                                      | 迁移与种子执行成功                                                                                                                                                         |
| `pnpm nocobase collections generate`                                                                                  | 生成 13 个 Collection 产物，字段名与查询一致                                                                                                                               |
| `pnpm nocobase db redo --force`                                                                                       | 迁移重构（拆函数，schema 不变）后重跑一次；NocoProject 表当时全空                                                                                                          |
| `pnpm typecheck`                                                                                                      | 通过                                                                                                                                                                       |
| `pnpm exec eslint --max-warnings 0 <改动的 server/database/tests 文件>`                                               | 通过                                                                                                                                                                       |
| `pnpm exec prettier --check <同上>`                                                                                   | 通过                                                                                                                                                                       |
| `pnpm exec vitest run tests/logic/np-`                                                                                | 8 个文件 81 个用例通过（其中 6 个文件是服务端的，2 个 `np-client-*` 是前端的）                                                                                             |
| `pnpm exec vitest run tests/logic/client-routes.test.ts tests/logic/app-server.test.ts tests/logic/lifecycle.test.ts` | 35 个用例通过                                                                                                                                                              |
| `NOCOBASE_STRICT_STARTUP=true NOCOBASE_DEV_ALLOW_MULTIPLE=true APP_SERVER_PORT=13090 pnpm dev`                        | 3.2 秒就绪；`/main/api/healthz` 200；`/main/api/np/issues` 401；`/main/api/np/agent/context` 401 `INVALID_RUN_TOKEN`；`/main/api/np/daemon/register` 401；随后整组进程结束 |

冒烟用了 `NOCOBASE_DEV_ALLOW_MULTIPLE` 和 13090 端口，是因为 09:46 起已经有一个开发服务器（PID 38618，13001 端口，不是本任务启动的）占着这个应用目录的锁。那个服务器在路由接入后热重载成功，同样返回 healthz 200、`/api/np/issues` 401；没有停它。

集成测试覆盖（真实 PostgreSQL，库 `nocoproject_test`，每个文件一个 schema，可并行）：

- 迁移：up 后表与索引齐全（含部分唯一索引）；部分唯一索引确实拦住第二条 pending 运行；种子重复执行不改数据；rollback 清干净；再 up 成功。
- 认领：10 个并发认领争 5 条排队运行 → 恰好 5 条、各一次、令牌唯一、库里只存哈希；两个 Agent 下 10 个并发 `claimOne` 不重复；`maxConcurrentRuns` 与"同 Agent 同任务一个活动运行"在并发下成立；持有一个未提交的认领事务时，第二个认领会等待并在提交后拿不到（去掉 advisory lock 这条用例会失败，已做变异验证）；归档 Agent 不被认领；未知运行时 404 `RUNTIME_NOT_FOUND`，别人的运行时 403。
- 清扫器：150 秒离线；租约过期重排且 attempt 不变、令牌吊销、可再次认领；续租中的不动；dispatched 超 5 分钟 → `failed(runtimeRecovery)` + 重试；运行时离线超 3 小时的 running → `failed(runtimeOffline)` + 重试；deferred 到期转 queued；运行时被删 → `failed(queuedExpired)`。
- 触发：设 Agent 执行者入队、backlog 不入队、离开 backlog 入队（statusChange）、换执行者入队；@ 两个 Agent 各一条、scope = 根评论、同线程再 @ 合并追加触发；Agent 评论与 `/note` 永不触发（去掉 `/note` 判断用例会失败，已做变异验证）；回复 Agent 评论路由给它；顶层评论合并进 assign 运行；running 时新评论新建一条排队运行并等待。
- 其他：编号在 8 个并发创建下连续唯一；过期 revision 409；Agent 状态转换只允许协议里的四条；可重试失败重试并带上原触发，次数封顶；不可重试失败把 in_progress 退回 todo；污染的会话下次认领 `fresh`；取消（排队直接取消、执行中等 ack）；事件按 seq 幂等、64KB 截断、超 200 条拒绝；令牌在运行终态后失效。
- 整个应用（SQLite 临时库，真实认证和 API Key 插件）：`x-api-key` 能访问 `/np/me` 和守护进程接口；426 `PROTOCOL_MISMATCH`；未知守护进程心跳 404；API Key 的 WebSocket 连接能订阅 `np:daemon`，建任务指派 Agent 后收到 `workAvailable`；运行令牌访问界面/守护进程接口 403。

## 3. `/ws` 上的 `x-api-key`（守护进程依赖此结论）

结论：可用。

- 代码路径：`@nocobase/app-server` 的 `createRealtimeWebSocketHandler` 对升级请求调用 `realtimePrincipalResolverToken`；认证插件注册的解析器调用 `auth.getSession(request.headers)`；Better Auth 的 api-key 插件在 `enableSessionForAPIKeys`（`apiKey()` 默认开启）下用 `x-api-key` 伪造会话。Origin 检查只拒绝"带 Origin 且与服务端不同源"的握手，Node 客户端默认不带 Origin。
- 实测（开发服务器 13001，`ws@8` 客户端，登录种子管理员、临时建 Key，测完删除 Key 并登出）：带 Key 订阅 `np:daemon` → `subscribed`；不带 Key、或 Key 无效 → 连接建立，但订阅返回 `{ type: 'error', code: 'AUTHENTICATION_REQUIRED' }`；Key 删除后 `/np/me` 401。
- 注意：Node 24 自带的 `WebSocket` 不能设置请求头，守护进程要用 `ws` 包。

## 4. 事务内的 Knex（认领 SQL 依赖此结论）

结论：`db.transaction(async (connection) => …)` 里 `await connection.client()` 返回的就是这个事务的 Knex 事务对象（`isTransaction === true`），raw SQL 与 QueryAdapter 写入同进退。

- 依据：`@nocobase/db` 的 `KnexDatabaseConnection.transaction()` 用 `client.transaction(trx => …)` 并以 `trx` 构造一个新的连接对象交给回调，其 `client()` 返回 `trx`。
- 测试：`np-claim.test.ts` 第一个用例断言事务内 `isTransaction` 为 true、事务外为 false，并验证通过 raw client 写入的行随事务回滚消失。
- 事务内再调用 `connection.transaction()` 得到保存点；入队时用它包住 INSERT，撞上部分唯一索引不会中止外层事务。

## 5. 与协议的出入

全部已写回 `protocol.md`，类型已写回 `protocol.ts`（只增不改；守护进程的副本 `nocoproject-cli/src/protocol.ts` 没有改，守护进程用到的类型没有变化，新增的只是界面接口类型和两个常量）。

1. 表字段补充：`comments.rootId`（插入时确定线程根）、`runs.fireAt`（协议里 deferred 需要，但字段表漏了）、`runtimes.version`（注册要"更新版本"）。
2. 认领在协议 SQL 之前加了按运行时的 `pg_advisory_xact_lock`，原因见 `protocol.md` §4 与 `claim.sql.ts` 注释；SQL 本身逐字保留，只多了 `updated_at = now()`。
3. 触发规则的线程范围：`reply` 用线程根，`comment`（顶层评论给执行者）用 null，与 assign 合并。重试运行沿用原运行的触发。手动重试也是 `retry` 类型、`payload.manual = true`、`attempt = 1`。
4. 界面接口：`comments` 改为扁平数组（协议原写"树"；前端按 `parentId` 组线程）；`activeRunCount` 统计 dispatched|running；列表/详情/Agent/运行时的附加字段、活动 `action` 命名、错误码见 §3.1；`POST /np/issues` 可选 `statusKey`（默认 todo）。
5. 守护进程接口：未知运行时 404 `RUNTIME_NOT_FOUND`（守护进程据此重注册）；事件接口返回 `{ accepted, last }`、超 200 条整批 400；状态冲突 409 `RUN_STATE_CONFLICT`；未知失败码记为 `agentError.unknown`。
6. Agent 回写接口：写操作只能针对令牌所属运行的任务（403 `ISSUE_NOT_IN_RUN`）；401 码为 `INVALID_RUN_TOKEN`。
7. 清扫器规则的执行顺序与"运行时已删除"的判定口径见 `protocol.md` §4.2。

## 6. 已知缺口与注意事项

- **种子校验和告警**：种子执行后我把 `run({ repository })` 改成了 `run(context)`（lint 规则 `unbound-method`，行为不变），开发库启动和 `db apply` 会提示该种子校验和变化。按规范这类不改行为的变化用 `pnpm nocobase db repair` 对齐，但它在非终端下需要 `--force`，CLI 规范要求这个参数由人来加，所以没有执行。请在终端里跑一次 `pnpm nocobase db repair`（先 `--dry-run` 确认只列出这一个种子）。
- **开发库的 `system_settings` 目前为空**：`db redo` 重建了表但不会重跑种子。第一次建任务时服务会补上这一行（前缀 NP、从 1 开始），行为与种子一致。
- 权限只区分"已登录"。`agents.access` 已存储但不校验（Phase 1 TODO，已在 `agent.service.ts` 注明）；任何登录用户可以看、改、取消任何任务和运行。
- 执行者从 Agent 改走时，不会自动取消该 Agent 已排队的运行。
- 合并进 `dispatched` 运行的新评论不会出现在已发出的认领载荷里，Agent 需自己 `comment list`（协议如此）。
- 清扫器按单实例设计；多实例会重复调度（状态更新本身是带条件的，不会写坏）。
- `q` 搜索在 PostgreSQL 上区分大小写；列表最多 500 条，无分页。
- 认领仅支持 PostgreSQL；SQLite 上应用能启动、迁移能跑，但认领返回 400 `UNSUPPORTED_DIALECT`。
- 域事件总线与实时推送是进程内的：不跨实例，重启丢失；实时消息只是失效信号。
- 没有验证：认领延迟中位数（需要守护进程端到端）、真实的端到端闭环（守护进程 + 前端 + 服务端一起跑），以及 MySQL 等其他方言。
- 测试库 `nocoproject_test` 留在 `demo-postgres` 容器里，测试会反复重建其中的 `np_t_*` schema。
