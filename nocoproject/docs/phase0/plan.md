# Phase 0：技术验证

> 对应《NocoProject 产品与技术方案》第 6 章 Phase 0。目标不是做产品，而是把三件最不确定的事跑通，为 Phase 1 扫清架构风险。

## 要验证的三件事

1. **认领协议能在 NocoBase 数据层上落地。** 部分唯一索引、`FOR UPDATE SKIP LOCKED` 认领、租约、心跳、失败判定、重试，全部跑在真实 PostgreSQL 上并有并发测试。
2. **编码工具适配器可行。** 统一的适配器接口；Claude Code 适配器（stream-json，用录制夹具测试，本机没有 claude 命令）；OpenCode 适配器（本机已安装，做真机验证）；回声适配器（脚本化假工具，给自动化端到端测试用）。
3. **端到端闭环。** 建任务 → 执行者选 Agent → 守护进程认领 → 工具在本机启动 → Agent 用 `nocoproject` CLI 评论回写并改状态 → 界面通过实时通道看到。

## 范围内

| 部分 | 内容 |
|---|---|
| 服务端 | `system / project / issue / collaboration / agent / runtime / run / trigger` 八个模块的最小实现；三组 HTTP 接口（界面、守护进程、Agent 回写）；实时主题；清扫器；协议测试 |
| 守护进程与 CLI | 独立包 `nocoproject-cli`：登录（API Key）、注册、心跳、WS 唤醒 + 轮询、批量认领、租约、环境目录、简报写入、适配器、事件批传、取消、完成/失败回报；Agent 用的 `issue`/`comment`/`status` 子命令 |
| 前端 | 任务列表、任务详情（描述、评论、活动流、执行日志、实时刷新）、Agent 列表与创建、运行时列表、运行记录弹窗 |
| 文档 | 协议文档、三条 ADR、Phase 0 结论 |

## 范围外（Phase 1 再做）

看板拖拽、工作流模板、子任务与依赖、批量录入、收件箱、项目资源与仓库 checkout、权限细化（Phase 0 只区分"已登录"）、Codex 适配器、容器隔离、多实例。

## 验收标准

- 在真实 PostgreSQL 上，10 个并发认领请求争抢 5 条排队运行，恰好 5 条被认领、每条只被认领一次。
- 守护进程离线 150 秒后运行时显示离线；准备阶段超过租约未续期的运行被重新投递；`dispatched` 超过 5 分钟判失败。
- 回声适配器端到端测试全绿：任务创建到界面看到 Agent 评论，全程无人工操作。
- OpenCode 真机跑通一次同样的闭环（需要本机 OpenCode 已登录；未登录则记录为未验证）。
- Claude Code 适配器对录制夹具的解析测试通过：文本、思考、工具调用、工具结果、会话 ID、结果与用量。
- 认领延迟（入队到守护进程收到）中位数小于 3 秒。

## 分工（三个并行子任务）

| 子任务 | 目录 | 契约 |
|---|---|---|
| A 服务端 | `nocoproject/server/modules/*`、`database/main/migrations`、`tests/` | `docs/phase0/protocol.md` + `server/modules/shared/protocol.ts` |
| B 守护进程与 CLI | `nocoproject-cli/`（应用目录的同级目录） | 同上，类型文件复制为 `nocoproject-cli/src/protocol.ts` |
| C 前端 | `nocoproject/client/pages/np/*`、`client/routes.ts`、`client/locales` | `docs/phase0/protocol.md` 第 3 节界面接口 |

三者只通过协议文档耦合。协议变更先改文档和类型文件，再改实现。

## 目录约定（与方案 4.4 一致，并遵守模板的组合根）

```
server/
  modules/
    shared/         protocol.ts（契约类型）、events.ts（领域事件总线，@temporary）、activity.ts（@temporary）、ids.ts
    system/         settings.service.ts
    project/        project.service.ts、project.routes.ts
    issue/          issue.service.ts、status.ts（状态目录与允许的转换）、issue.routes.ts
    collaboration/  comment.service.ts、mentions.ts、comment.routes.ts
    agent/          agent.service.ts、agent.routes.ts
    runtime/        runtime.service.ts、runtime.routes.ts、daemon.routes.ts
    run/            run.service.ts（入队/认领/租约/完成/失败/重试）、claim.sql.ts、sweeper.ts、run.routes.ts、agent-api.routes.ts、token.ts
    trigger/        trigger.service.ts（唯一能创建运行的地方）
  providers/index.ts   注册各模块的 Provider（组合根）
  routes/index.ts      注册各模块的路由（组合根）
```

标记规则：临时实现的文件和表在文件头写 `// @temporary(nocobase-official): 待替换为 NocoBase 官方 <能力>`。
