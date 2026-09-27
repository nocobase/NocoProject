# Phase 1 迭代 3 服务端说明

服务端子任务（A）的交付记录。接口形状与出入以 `protocol-iteration-3.md` 为准。

## 1. 交付内容

| 位置                                                                                              | 内容                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database/main/migrations/2026093000001_np_phase1_iter3.ts`                                       | 知识库三张表、分页索引；完整 `down`                                                                                                                                                                                                                                                         |
| `database/main/seeds/2026093000002_np_iter3_page_grants.ts`                                       | `member` 权限集追加 `np-my-issues`、`np-knowledge`、`np-reports`、`np-config` 页面 access                                                                                                                                                                                                   |
| `server/modules/shared/protocol.phase1-iter3.ts`、`protocol.phase1-iter3-server.ts`               | 迭代 3 类型（前者 CLI 复制）                                                                                                                                                                                                                                                                |
| `server/modules/shared/pagination.ts`                                                             | 不透明游标 `[时间, id]` 与 limit 截断                                                                                                                                                                                                                                                       |
| `server/modules/shared/events.ts`                                                                 | `knowledge.proposed`、`knowledge.decided`、`delivery.decided`                                                                                                                                                                                                                               |
| `server/modules/knowledge/`                                                                       | `knowledge.access.ts`（读写 / 决定权限、决定人、Agent 范围）、`knowledge.records.ts`（映射、slug、校验）、`knowledge.write.ts`（新文档 / 新版本）、`knowledge.service.ts`（文档、Agent 读、认领索引）、`knowledge.proposals.ts`（建议、决定）、`knowledge.routes.ts`（浏览器 + Agent 路由） |
| `server/modules/metrics/`                                                                         | `metrics.collect.ts`（六类原始数据与口径）、`metrics.service.ts`（范围、阈值、状态、成本经 usage 服务）、`metrics.routes.ts`                                                                                                                                                                |
| `server/modules/issue/issue.list.ts`、`issue.timeline.ts`、`delivery.service.ts`                  | 列表 / 看板游标分页（`withNames` 移到这里）、活动分页、交付接受 / 请求修改；`issue.queries.ts` 改为组合它们，`issue.routes.ts` 加分页参数、活动 / 评论分页、交付接口与慢请求日志                                                                                                            |
| `server/modules/issue/issue.service.ts`、`collaboration/comment.service.ts`                       | `patch(…, outer?)`、`create(…, { outer, trigger })` 以便交付接口在一个事务里组合；评论分页 `pageForIssue`                                                                                                                                                                                   |
| `server/modules/notification/inbox.actions.ts`、`knowledge-notices.ts`                            | 读取时计算 `payload.actions`；知识库与交付事件的收件箱映射；`inbox.store.ts` 的 `resolveItems` 可按用户、`resolveByDedupeSuffix`；`notification.service.ts` 的 `agent_blocked` 在回复 / 换执行者时解决                                                                                      |
| `server/modules/system/settings.*`                                                                | `metricThresholds`（默认、合并、校验）                                                                                                                                                                                                                                                      |
| `server/modules/workflow/workflow.service.ts`                                                     | `projectCount`                                                                                                                                                                                                                                                                              |
| `server/modules/run/claim.service.ts`                                                             | 认领载荷 `knowledge`（`ClaimedRunV3`）                                                                                                                                                                                                                                                      |
| `server/modules/project/project.routes.ts`                                                        | 详情 `knowledgeDocs`                                                                                                                                                                                                                                                                        |
| `server/modules/services.ts`、`server/providers/{np,index}.ts`、`server/routes/np-{api,agent}.ts` | 新服务与 token（`npKnowledgeServiceToken`、`npMetricsServiceToken`、`npDeliveryServiceToken`）、新前缀 `/np/knowledge`、`/np/metrics`、`/np/agent/knowledge*`；不再注册三个设置项                                                                                                           |
| `tests/logic/`                                                                                    | 见 §2                                                                                                                                                                                                                                                                                       |

## 2. 验证（2026-09-27 本机）

| 命令                                                                                 | 结果                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 开发库迁移                                                                           | 开发服务器热重载时自动执行了迁移与种子（文件写入前已是 prettier 格式，之后未改）；`pnpm nocobase db apply` 报告 `Executed: none`，无 checksum 警告；库里核对了表、索引与 `member` 权限集 |
| `pnpm exec tsc -p tsconfig.server.json --noEmit`、`-p tsconfig.node.json --noEmit`   | 通过                                                                                                                                                                                     |
| eslint `--max-warnings 0`、prettier（本轮改动的全部 server / database / tests 文件） | 通过；另用 `max-lines-per-function 120` / `max-lines 500` 检查本轮文件通过                                                                                                               |
| `pnpm exec vitest run tests/logic/np-`                                               | 37 个文件 323 个用例通过（含前端 `np-client-*` 当前状态）                                                                                                                               |
| CLI 副本                                                                             | `protocol.ts` + `phase1-iter2` + `phase1-iter3`（去掉 server 行）单独 `tsc --strict` 通过；CLI 已同步的副本与服务端一致                                                                  |
| 开发服务器 13001                                                                     | 新前缀匿名 401；`/np/agent/knowledge` 伪造运行令牌 401                                                                                                                                   |
| 性能（`np-perf`，中位数）                                                            | 列表 9 ms、成员列表 8、项目 + 状态 5、搜索 4、按创建 9、看板 18、成员项目看板 23、看板单列 8、详情（3000 活动 300 评论）22、活动页 8；全量游标遍历 2200 条 307 ms                        |

新测试：

- `np-knowledge.test.ts`（2）：CRUD、slug、版本冲突、归档、系统级权限、私有项目可见性、项目详情 `knowledgeDocs`。
- `np-knowledge-agent.test.ts`（3）：认领索引与 Agent 范围、建议规则（重复 / 缺 reason / 越权项目 / slug 冲突）、决定卡与 actions、接受成新版本、驳回、系统级建议给 owner/admin 并建文档。
- `np-metrics.test.ts`（5）：纯函数（分位数、ISO 周、状态、范围）、六类指标的固定答案、成员过滤与项目过滤、阈值 PATCH 校验 / 权限 / 合并与状态变化。
- `np-pagination.test.ts`（5）：列表游标顺序与并列 id、`sort=created`、limit / 游标错误、筛选 + 私有项目、看板列与单列加载、详情活动 / 评论分页、工作流 `projectCount`。
- `np-inbox-actions.test.ts`（7）：各类型 actions（纯）、已解决只剩导航、交付接受（不触发运行）、审批 202、请求修改（触发运行）、`agent_blocked` 回复 / 换执行者、旧行读取时补 actions。
- `np-perf.test.ts`（2）：大夹具计时（预算 1000 ms、目标 300 ms、日志输出）与全量游标遍历一致性。
- 调整：`np-harness.ts`（迭代 3 表的 truncate）、`np-iter3-harness.ts`（新增：真实路由 + 伪登录、Agent 知识库路由、批量任务夹具）、`np-routes-harness.ts` / `np-routes.test.ts`（列表走 `page`、新 token 替身）、`np-migration.test.ts`（迭代 3 表 / 索引、单独回滚迭代 3、2 + 3 同批回滚）、`np-members-app.test.ts`（新页面授权、设置项不再注册、列表 `nextCursor`）、`np-usage.test.ts`（设置视图带 `metricThresholds`）。

## 3. 设计要点

- **知识库只经服务**：认领载荷、项目详情、通知都不读知识库表——认领与项目详情调 `KnowledgeService`，通知靠事件里带齐的载荷字段。
- **动作在读取时计算**：`inbox.actions.ts` 是纯函数，`mapInboxItems` 调用；旧行、`mark` 的返回都带 actions，不需要回填。
- **交付一事务**：`IssueService.patch` 与 `CommentService.create` 接受外层事务，门禁、触发规则、通知在同一次提交里完成；`delivery.decided` 让通知模块解决 `review_requested`（审批待定时状态不变，也要解决）。
- **分页**：键集分页，`withNames` 每页固定查询数；看板一次性给所有列做名称装配。
- **指标**：每个查询都用 `issues` 子查询限定范围（未删除 + 项目 + 可见性），成本复用 usage 服务（同一可见性与价格规则）。

## 4. 已知缺口

- 迁移里 `desc` 被构建器忽略（见协议 §8.2），功能等价，未再改已执行的迁移。
- 未用真实会话对开发服务器做写操作联调（本会话没有可用的测试账号凭据），交给主会话的集成脚本。
- 被删除项目的知识文档不会被清理（只是不再出现）；知识库没有实时主题，来源任务收到 `issue.changed`、决定人收到 `np:inbox`。
- 指标没有缓存，范围很大时每次请求都全量扫描期间内的活动 / 运行 / 收件箱（当前数据量下毫秒级）。
- `project.service.ts`、`protocol.ts` 仍超过 500 行（迭代 1 起）。
