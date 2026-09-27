# ADR-0002：调度协议建立在 PostgreSQL 上，WebSocket 只做唤醒

- 状态：已接受（2026-09-27），认领 SQL 的实现细节待 Phase 0 验证后补记
- 关联：《方案》4.6、4.9；`docs/phase0/protocol.md` §4

## 背景

守护进程跑在用户的电脑上，网络会断、进程会崩、机器会睡眠。运行的分配必须做到：一条运行只被一个守护进程认领一次；守护进程消失后运行能被回收或重投；服务端多实例时不需要额外的协调服务。NocoBase 3 的实时通道是服务端单向推送、单进程内存实现，没有确认与离线补发；队列插件是作业队列，不是带租约的工作认领。

## 决定

1. 运行队列就是 `runs` 表。待处理运行的唯一性靠部分唯一索引 `(agentId, subjectType, subjectId, threadScope) WHERE status IN (queued, deferred, dispatched)`。
2. 认领用一条原生 SQL：`UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`，在事务内执行，认领即写 45 秒准备租约并签发运行令牌。NocoBase 的查询构建器不支持行锁语法，所以通过 `connection.client()` 拿到底层 Knex 执行；这是本项目唯一允许使用原生 SQL 的地方之一，集中在 `server/modules/run/claim.sql.ts`。
3. 状态全部经 HTTP：注册、心跳、认领、续租、开始、事件、完成、失败、取消确认。WebSocket 只推送"有活了"和"请求取消"两种提示，丢失提示只影响延迟，不影响正确性；守护进程保留 15 秒轮询兜底。
4. 生存判定与超时（沿用 Multica 被验证过的数字）：心跳 15 秒；150 秒无心跳判离线；准备租约 45 秒；`dispatched` 5 分钟未开始判失败；运行中的运行只在运行时离线超过 3 小时后才判失败；排队中的运行不因时间过期。
5. 只对瞬时故障自动重试（运行时离线、守护进程重启回收、超时、模型服务网络故障），默认最多 2 次执行；会污染会话的失败强制新会话。

## 理由

- PostgreSQL 的 `SKIP LOCKED` 是成熟的工作队列原语，不引入 Redis 或消息中间件也能保证"恰好一次认领"。
- 把正确性放在 HTTP + 数据库上，让实时通道可以是尽力而为的，这样 NocoBase 现有的实时能力就够用；多实例时只需要把唤醒提示扇出到其他实例（Phase 2 用 Redis）。
- 数字沿用 Multica，是因为它们经过五万用户的检验；本项目没有理由从零调参。

## 后果

- 生产数据库必须是 PostgreSQL；SQLite 只用于本地开发且认领测试会被跳过。
- 原生 SQL 与逻辑表名的映射（camelCase → snake_case）要在测试里锁定，防止迁移改名后 SQL 失效。
- 清扫器每 30 秒跑一次；多实例时需要锁（Phase 2）。

## 验证记录（2026-09-27，Phase 0）

- `db.transaction(async (connection) => …)` 里 `await connection.client()` 返回的就是事务的 Knex 对象（`isTransaction === true`），原生 SQL 随事务回滚；有测试锁定。
- 10 个并发认领争 5 条排队运行：恰好 5 条被认领、各一次、令牌唯一（`tests/logic/np-claim.test.ts`）。
- **补充决定**：仅靠 `SKIP LOCKED` 不能在并发下保证"每 Agent 并发上限"与"同 Agent 同任务一个活动运行"，认领前先按运行时取 `pg_advisory_xact_lock`；去掉该锁的变异测试会失败。代价是同一运行时的认领串行化，对单机守护进程没有影响。
- 认领延迟（入队到守护进程认领，唤醒路径）：23–68 毫秒；受并发上限排队的运行约 1.9 秒。
- `x-api-key` 可在 `/ws` 上认证并订阅用户主题，实测通过。
