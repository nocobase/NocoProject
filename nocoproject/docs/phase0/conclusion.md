# Phase 0 结论

> 日期：2026-09-27。对应 `docs/phase0/plan.md` 的验收标准。三个并行子任务（服务端、守护进程与 CLI、前端）各自的交付说明见 `server-notes.md`、`../../../nocoproject-cli/README.md` 与前端报告；本文只记录集成联调的结果与对 Phase 1 的影响。

## 1. 验收结果

| 验收项 | 结果 | 证据 |
|---|---|---|
| 10 个并发认领争 5 条排队运行，恰好 5 条各一次 | 通过 | `tests/logic/np-claim.test.ts`（真实 PostgreSQL） |
| 150 秒无心跳判离线；租约过期重投；dispatched 超 5 分钟判失败 | 通过 | `tests/logic/np-sweeper.test.ts` |
| 回声适配器端到端全程无人工操作 | 通过 | 集成联调：建任务 → 68 毫秒后守护进程认领 → 618 毫秒后完成，评论、状态、活动、12 条事件全部正确 |
| OpenCode 真机闭环 | 通过 | 模型 `deepseek/deepseek-flash`，9 秒完成，回写一段评论并推到 `in_review` |
| Claude Code 适配器夹具解析 | 通过（夹具为手写，待真机校验） | `nocoproject-cli/tests`，本机无 `claude` 命令 |
| 认领延迟中位数 < 3 秒 | 通过 | 5 条并发任务：前 3 条 23–27 毫秒，后 2 条因并发上限 3 排队约 1.9 秒 |

补充验证：
- `/note` 评论不触发；`@Echo` 评论触发一次运行，Agent 的回复落在提及评论的线程内（`parentId` = 提及评论）。
- 守护进程通过 `x-api-key` 连接 `/ws` 并订阅 `np:daemon` 成功，唤醒即认领（日志 `reason=workAvailable`）。
- 守护进程退出时注销运行时，界面运行时列表随即显示离线。
- 界面目测（1360 宽）：任务列表、任务详情（活动流、线程回复、属性栏、执行日志、触发预览）、运行记录弹窗、Agent 列表、运行时列表均正常渲染。

## 2. 三个技术风险的结论

1. **认领协议能在 NocoBase 数据层上落地。** `db.transaction` 回调里 `connection.client()` 就是事务的 Knex，原生 `FOR UPDATE SKIP LOCKED` 与事务同进退。一个额外发现：仅靠 `SKIP LOCKED` 不能保证"每 Agent 并发上限"和"同 Agent 同任务只一个活动运行"这两条规则在并发下成立，需要在认领前按运行时加 `pg_advisory_xact_lock`；已有变异测试锁定这一点。
2. **适配器接口可行。** 一个接口、三个实现（Claude Code、OpenCode、回声）。OpenCode 的两个真实坑已处理：模型服务报错时它会无限重试且不输出，需要监听 stderr 并主动杀进程；它从 `PWD` 取项目目录，必须为每个子进程重置 `PWD` 并传 `--dir`。
3. **端到端闭环成立。** 人的动作 → 触发模块 → 队列 → 唤醒 → 认领 → 简报 + 每轮提示 → 工具进程 → CLI 回写 → 领域事件 → 实时失效信号 → 界面刷新，整条链路的每一环都有测试或联调证据。

## 3. 数字

| 指标 | 值 |
|---|---|
| 入队到守护进程认领（唤醒路径） | 23–68 毫秒 |
| 回声 Agent 一轮总耗时 | 618 毫秒 |
| OpenCode 一轮总耗时（deepseek-flash） | 约 9 秒 |
| 服务端测试 | 81 个用例（6 个文件真实 PostgreSQL） |
| 守护进程测试 | 88 个用例 + 1 个可选真机用例 |
| 前端测试 | 43 个用例 |
| CLI 打包体积 | `dist/cli.js` 1.06 MB（单文件，zod 占大头） |

## 4. 发现的问题与 Phase 1 待办

| 类别 | 事项 |
|---|---|
| 需要人操作 | 在终端里执行 `pnpm nocobase db repair`（先 `--dry-run`）对齐种子校验和；服务端子任务因规范不允许自加 `--force` 而未执行 |
| 权限 | Phase 0 只区分"已登录"；`agents.access` 已存储未校验；任何登录用户可改任何任务 |
| 触发 | 执行者从 Agent 改走时不取消其排队运行；合并进已认领运行的评论不在认领载荷里（协议如此，Agent 需自行 `comment list`） |
| 界面 | 运行记录弹窗里工具调用行默认折叠，命令应直接可见；DataTable 底部"0 of N selected"多余；失败原因码未翻译；搜索与筛选未进 URL |
| 守护进程 | Claude Code 夹具需用真实会话校验；`commander`/`ws`/`zod` 已打进包仍列为依赖，可改 devDependencies；未验证 Windows |
| 服务端 | 清扫器按单实例设计；域事件与实时推送进程内；`q` 搜索区分大小写、无分页；仅 PostgreSQL 支持认领 |
| 工程 | 协议类型在服务端与 CLI 各一份（ADR-0001），Phase 1 迁入 pnpm workspace 后共享；应用目录尚未初始化 git 仓库 |

## 5. 对方案的影响

- 方案 4.6 的认领协议补一条：按运行时的事务级咨询锁。已写入 ADR-0002。
- 方案 4.7 的适配器接口保持不变；OpenCode 的启动参数写进协议 §8。
- Phase 1 可以直接在这套模块骨架上继续，不需要返工。
