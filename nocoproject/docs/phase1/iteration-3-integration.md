# Phase 1 迭代 3 集成记录（2026-09-27）

> 产品负责人验收迭代 2 后点名的八项改进（知识库、验收指标、工作流可视化、菜单分组、决定项直接可操作、批量录入收进任务页、设置进前台、界面打磨与性能），三个并行子任务交付后由主会话集成。服务端细节见 `server-notes-iteration-3.md` 与 `protocol-iteration-3.md`。

## 1. 联调结论

`e2e-iter3.mjs` 五组用例全部通过（真实开发服务器 + 本机守护进程）：

| 链路 | 验证内容 | 结果 |
|---|---|---|
| 知识库 | 项目 lead 建文档、普通成员改 403、`expectedVersion` 冲突 409、版本历史、项目详情列出文档、成员建系统级文档 403；回声 Agent 用 `kb get` 读到正文，`kb propose` 提出新文档；建议进 lead 的决定卡并带 `accept` 动作，一键接受后生成新文档、卡片解决、来源任务记 `knowledge_proposed` / `knowledge_updated` | 通过 |
| 验收指标 | `GET /np/metrics` 六个分组齐全、可靠性含运行数与认领延迟、阈值与状态返回、阈值可改、成员按可见任务过滤 | 通过 |
| 分页 | 列表游标 5 条一页遍历不重不漏；看板 `columnLimit` 与单列续页；详情 `activitiesNextCursor` 与活动分页接口 | 通过 |
| 决定项动作 | `review_requested` 卡自带 accept / requestChanges（needsComment）；"打回"写评论、状态回 in_progress、唤醒执行者再次交付；"验收"进 done 并记 `delivery_accepted`；旧决定项在读取时也补齐 actions | 通过 |
| 工作流 | 列表带 `projectCount` | 通过 |

另外在本轮接通了两项真实服务：
- **DeepSeek V4.1 Flash**（`config.yml` `ai.llmServices`，key 在 `.env`）。插件的工具式结构化输出让模型乱答（空列表或编造），改为直接模型调用（`llmProviderManager.getLLMService` + `provider.invoke`）并要求回 JSON、服务端用 Zod 校验，真实解析 5 条草稿含父子、优先级、标签、阶段，3.6 秒。
- **GitHub** 连接已由产品负责人配置令牌；Webhook 需要公网可达，改用 `gh webhook forward` 转发到本机（待运行）。

浏览器逐页核对：侧边栏按方案 §3.1 分组（收件箱、我的任务；工作；Agent 团队；报表；设置）；收件箱决定卡直接显示验收 / 打回 / 打开；我的任务、知识库、报表（六类指标卡 + 阈值徽标）、设置各标签页、工作流模板可视化（状态流 + 转换矩阵 + 规则 + 使用项目数）、任务详情三栏、批量录入抽屉、GitHub 标签页的密钥显示 / 复制、浅色主题，宽度与结构一致。

## 2. 集成时修的问题

| 问题 | 修法 |
|---|---|
| AI 解析经插件 agent 返回空或编造 | 见上：直接模型调用 + JSON 回复 + Zod 校验（`providers/np.ts`、`intake/ai-parser.ts`） |
| `.env` 首次创建触发完整重启后端口回到 13000 | `.env` 固定 `APP_SERVER_PORT=13001` |
| CLI 复制协议文件时带上服务端专用导出 | `sync-protocol.mjs` 同时处理 iter2 / iter3 的 `-server` 行 |

## 3. 测试

| 套件 | 结果 |
|---|---|
| `nocoproject` 全量 `vitest run` | 99 个文件 743 个用例通过（迭代 2 是 87 / 660） |
| 其中服务端 `tests/logic/np-*` | 37 个文件 323 个用例；性能夹具 2000 任务 / 5000 活动：列表 9 ms、看板 18 ms、详情 22 ms、游标全量遍历 307 ms |
| 前端子集 | 47 个文件 367 个用例 |
| `nocoproject-cli` | 15 个文件 158 个用例 |
| typecheck、eslint `--max-warnings 0`、prettier | 通过 |

## 4. 决定与缺口

- **workspace 化推迟**：在仓库副本上验证可行，但切换要停开发服务、把 lockfile 提到根目录、删掉应用自己的 workspace 文件，且 NocoBase 构建只打包根下一层的包（要用 `protocol/` 而不是 `packages/protocol/`），Dockerfile 与模板升级技能也假设应用目录是 pnpm 根。步骤在 `workspace.md`，等 dogfooding 开始后单独安排。根目录已有 `pnpm-workspace.yaml`、`.pnpmfile.cjs`（阻止根目录 install）、`packages/protocol` 占位；类型共享继续用 `pnpm sync-protocol`。
- 服务端 9 条出入见 `protocol-iteration-3.md` 末节：列表按 `updatedAt` 排序（评论不再把任务顶上去）、命中门禁的交付验收返回 202、验收评论不触发运行、`agent_blocked` 卡在成员回复后解决。
- 前端未做：评论分页、滚动到底自动加载（用按钮）、项目详情的知识库文档列表、知识库"显示归档"开关；成员在设置页看到只读的工作流与标签标签页（契约只写通用与成员）。
- 指标说明 tooltip 无内容（服务端只回数字，口径在协议文档 §3）。
- 未在真实 GitHub 上联调（等 webhook 转发跑起来）。
