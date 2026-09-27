# Dogfooding 环境（2026-09-27 起）

NocoProject 的开发从此在 NocoProject 自己里进行。本文记录常驻服务、接入方式和"什么放哪里"的约定；变更时同步更新。

## 常驻服务（开发机 zhou-air，launchd 用户级服务）

| 服务 | Label | 内容 | 日志 |
|---|---|---|---|
| 开发服务器 | `ai.nocobase.nocoproject-dev` | `pnpm dev`，`http://127.0.0.1:13001/main`（`.env` 固定 `APP_SERVER_PORT=13001`），局域网与 Tailscale 地址同样可用 | `~/Library/Logs/nocoproject/dev.log` |
| 守护进程 | `ai.nocobase.nocoproject-daemon` | 等开发服务器就绪后启动 `nocoproject daemon start --providers claude,codex,opencode` | `~/Library/Logs/nocoproject/daemon.log` |
| Webhook 转发 | `ai.nocobase.nocoproject-webhook` | `gh webhook forward` 把 GitHub 的 PR / CI 事件转发到本机；secret 在 `~/.nocoproject/github-webhook-secret`（600） | `~/Library/Logs/nocoproject/webhook.log` |

plist 在 `~/Library/LaunchAgents/`，用显式 Node 24 路径（`/opt/homebrew/opt/node@24/bin`），不要用登录 shell（会选到旧版 Node）。管理：`launchctl bootout gui/$(id -u)/<label>`、`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/<label>.plist`。

## 接入其他电脑

1. `gh release download cli-v0.2.0 --repo zhouyanliang/NocoProject --pattern '*.tgz' && npm i -g ./nocoproject-cli-0.2.0.tgz`（CLI 未发布到 npm，安装包挂在 GitHub Release）。
2. 在界面生成 API Key，`nocoproject login --server http://<开发机地址>:13001/main --api-key-stdin`。远程机器用 Tailscale 地址（开发机 `100.82.49.7`）。
3. 装好编码工具并登录，`nocoproject daemon start`。
4. 服务端升级后每台机器都要升级 CLI（新 Release 的 tgz，`npm i -g`），然后 `nocoproject daemon stop && nocoproject daemon start`；版本不一致时 Agent 会找不到简报里的命令。

## 什么放哪里

| 内容 | 位置 |
|---|---|
| 代码规范、模块结构、界面规则 | 仓库：`AGENTS.md`、`client/pages/np/README.md`、`docs/design/ui-design.md` |
| 方案、阶段文档、ADR | 仓库：根目录方案 md、`docs/phase*`、`docs/adr` |
| 环境事实、工作约定、坑与决策、验收标准、路线图 | NocoProject 知识库：系统级《团队工作约定》；项目级《开发环境与命令》《已知坑与决策》《验收标准》《路线图与已知缺口》 |
| 一类事怎么做 | NocoProject 技能：《NocoProject 交付流程》《前端页面开发》《服务端模块开发》《文档同步》，挂给所有 Agent |
| Agent 的角色与底线 | Agent 指令：Opus 主力（可委派 Sonnet）、Sonnet 承接小任务、Codex 小改动；项目经理（`kind = manager`，dev 的 OpenCode + DeepSeek V4.1 Flash high）只读、回答、总结 |
| 待办 | NocoProject 任务（批量录入） |

## GitHub

- CI：`.github/workflows/ci.yml`（`app` 带 PostgreSQL 服务容器；`cli`），每次推送与 PR 都跑。分支保护在私有仓库需要 GitHub Pro，未开启；合并前看 PR 上的检查结果。
- 合并 PR 由负责人做；合并后 webhook 把任务改为 done（`prMergedStatus`）。

## 设置

- 模型价格（美元 / 百万 token）：Opus 5.5 输入 4、输出 20、缓存读 0.2；Sonnet 5 输入 2、输出 10；DeepSeek Flash 输入 0.14、输出 0.28。
- 指标阈值：AI 承担率 ≥ 0.5、建议接受率 ≥ 0.7、认领延迟 P50 ≤ 3 s、丢运行 0、决定处理 P50 ≤ 24 h。

## 工作流程（迭代 4 起）

- 新建任务：默认"AI 整理"标签（描述或粘贴 → 草稿 → 创建），手动标签备用；流程字段"自动"由分类器判定。
- 先出方案的任务：Agent 提交方案 → 负责人在收件箱或任务页"批准进入开发 / 打回修改" → 批准后 Agent 才能进入开发。
- 项目经理：侧栏"项目经理"随时提问（按你的可见范围回答）；任务 done 后自动写一条总结备注并建议知识库更新（设置 → 通用可关）。
- 已知边界：Agent 与守护进程同一用户运行，能读到本机的 API key；简报与指令已禁止，根本隔离在 Phase 2。
