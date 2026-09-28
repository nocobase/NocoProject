# Dogfooding 环境（2026-09-27 起）

NocoProject 的开发从此在 NocoProject 自己里进行。本文记录常驻服务、接入方式和"什么放哪里"的约定；变更时同步更新。

## 常驻服务

2026-09-28 起应用部署在 ali-agents 服务器：`https://project.nocobase.cn/main`（国内机器用 Tailscale 地址 `http://100.89.167.29:13001/main`）。布局、发布（`pnpm deploy:server`）、回滚与日志见 [deploy.md](deploy.md)。

| 机器                 | 守护进程                                                                                                                                  | 连接地址                           | 日志                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------- |
| ali-agents（服务器） | systemd 用户服务 `nocoproject-daemon`（claude、codex、opencode，`--max-concurrent 3`：服务器 4 核 7G 还要跑应用），适合服务端与迁移类任务 | Tailscale 地址                     | `journalctl --user -u nocoproject-daemon`                                   |
| 开发机 zhou-air      | launchd `ai.nocobase.nocoproject-daemon`，等服务器健康检查通过后启动，显式 Node 24 路径（`/opt/homebrew/opt/node@24/bin`）                | `https://project.nocobase.cn/main` | `~/Library/Logs/nocoproject/daemon.log`                                     |
| dev（主力开发机）    | systemd 用户服务 `nocoproject-daemon`：claude（主力开发）与 opencode（项目经理），不跑 codex                                              | Tailscale 地址                     | `journalctl --user -u nocoproject-daemon`、`~/.nocoproject/logs/daemon.log` |

开发机上原来的 `ai.nocobase.nocoproject-dev`（`pnpm dev`）与 `-webhook`（`gh webhook forward`）已停用，plist 仍在 `~/Library/LaunchAgents/`。本机开发需要时手动 `pnpm dev`，它连的是本机的开发库，不是服务器的数据。

## 接入其他电脑

1. `npm i -g https://project.nocobase.cn/main/assets/cli/nocoproject-cli-0.3.0.tgz`（国内机器把地址换成 `http://100.89.167.29:13001/main`）。安装包随应用部署，不需要 GitHub 账号；“添加电脑”页面按当前访问的地址生成这条命令。
2. 在界面生成 API Key，`nocoproject login --server https://project.nocobase.cn/main --api-key-stdin`；国内机器改用 `http://100.89.167.29:13001/main`（需要在 Tailscale 里）。已登录的机器换服务器只要改 `~/.nocoproject/config.json` 的 `serverUrl` 再重启守护进程。
3. 装好编码工具并登录，`nocoproject daemon start`。
4. CLI 升级后每台机器都要重新执行第 1 步的安装命令（新版本号），然后 `nocoproject daemon stop && nocoproject daemon start`；版本不一致时 Agent 会找不到简报里的命令。

## 在终端里以本人身份用（CLI 用户模式，0.3.0 起）

登录过的电脑上，人和他在终端里驱动的 Claude Code / Codex 可以用 `nocoproject user …` 以本人身份查任务、建任务（详见 CLI README 的 "User mode"）：

1. `ncp user whoami` 确认 Key 属于谁、连的是哪台服务器。
2. `ncp user skill install` 把 `nocoproject-user` skill 装到 `~/.claude/skills/` 与 `~/.codex/skills/`，本机 Agent 就知道怎么用这组命令。CLI 升级后重新执行一次（内容有改动时加 `--force`）。
3. 常用：`ncp user issues`（我负责的）、`ncp user issue NP-12`、`ncp user inbox`、`ncp user create --title … --project … --executor <Agent>`、`ncp user comment NP-12 --content-file reply.md`、`ncp user status NP-12 in_review`；都支持 `--json`。

- 操作记在你名下，活动流标"通过 CLI"。用这组命令把任务派给系统里的 Agent 算你本人的操作，不算"Agent 触发 Agent"。
- 系统派发的运行里（带 `NOCOPROJECT_TOKEN`）这组命令一律拒绝；运行用 `nocoproject issue …`。

## 看效果：本机预览与截图

Agent 跑在谁的电脑上，就在那台电脑的检出里看效果；服务器上跑的是最近一次部署的 main，不能用来验证分支。

- `pnpm build && pnpm screenshots`：用这份检出的构建产物起一个一次性预览（独立 SQLite、演示数据、`scripts/preview-server.ts`），Playwright 登录后把主要页面在 compact / default × 浅 / 深四种组合下各截一张到 `output/screenshots/<页面>.<预设>-<模式>.png`（`e2e/screenshots.test.ts`）。构建约 1 分钟，截图约 1 分钟。
- `pnpm preview`：只起预览（`http://127.0.0.1:13100/main`，nocobase / admin123），自己在浏览器里看；`NP_PREVIEW_PORT`、`NP_PREVIEW_DIR`（设了就保留数据）、`NP_PREVIEW_SEED=0`（不灌演示数据）。
- 截哪些页面用 `NP_SCREENSHOT_PAGES="name=/path,..."` 指定（`{issue}`、`{project}` 替换成演示数据里的第一个 id），组合用 `NP_SCREENSHOT_THEMES` 指定；已有预览在跑时直接复用。
- 前端任务的交付说明必须附截图（至少改动页面的四种组合），附不了就写"未在浏览器验证"和原因。CI 的 app 作业也跑一遍并把 `screenshots` 作为 artifact 挂在运行记录上，负责人验收时可直接看。
- 首次要装浏览器：`pnpm exec playwright install chromium`（Linux 加 `--with-deps`）。

## 什么放哪里

| 内容                                           | 位置                                                                                                                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 代码规范、模块结构、界面规则                   | 仓库：`AGENTS.md`、`client/pages/np/README.md`、`nocosolution/frontend/nocobase3-frontend-best-practices.md`、`nocosolution/frontend/nocosolution-frontend-standard.md` |
| 方案、阶段文档、ADR                            | 仓库：根目录方案 md、`docs/phase*`、`docs/adr`                                                                                                                          |
| 环境事实、工作约定、坑与决策、验收标准、路线图 | NocoProject 知识库：系统级《团队工作约定》；项目级《开发环境与命令》《已知坑与决策》《验收标准》《路线图与已知缺口》                                                    |
| 一类事怎么做                                   | NocoProject 技能：《NocoProject 交付流程》《前端页面开发》《服务端模块开发》《文档同步》，挂给所有 Agent                                                                |
| Agent 的角色与底线                             | Agent 指令：Opus 主力（可委派 Sonnet）、Sonnet 承接小任务、Codex 小改动；项目经理（`kind = manager`，dev 的 OpenCode + DeepSeek V4.1 Flash high）只读、回答、总结       |
| 待办                                           | NocoProject 任务（批量录入）                                                                                                                                            |

## GitHub

- CI：`.github/workflows/ci.yml`（`changes` 判断改了哪些目录；`app` 带 PostgreSQL 服务容器；`cli`；`deploy`），按下一节的规则只跑需要的部分。分支保护在私有仓库需要 GitHub Pro，未开启；合并前看 PR 上的检查结果。
- Webhook：仓库设置里的正式 webhook（id 686895797）推到 `https://project.nocobase.cn/main/np/webhooks/github`，事件 `pull_request`、`check_suite`、`status`；secret 与“设置 → GitHub”里保存的一致，原件在开发机 `~/.nocoproject/github-webhook-secret`（600）。投递记录：`gh api repos/zhouyanliang/NocoProject/hooks/686895797/deliveries`。
- 发布：合并到 main 后 CI 通过即自动部署到服务器（部署前备份、失败自动回滚，见 [deploy.md](deploy.md)）。Agent 只到开 PR 为止，不部署。
- 合并 PR 由负责人做；合并后 webhook 把任务改为 done（`prMergedStatus`）。

## CI 与 Actions 额度

仓库私有，GitHub 托管 runner 按分钟计费，免费额度用完后作业会在几秒内失败，也拿不到日志。2026-09-28 用完过一次：当时每个 PR 要跑两遍 `app`（PR 上一遍、合并到 main 又一遍，各约 13 分钟，大头是 vitest 的 8 分多钟），加上 `cli` 和部署，一个 PR 合并下来约 32 分钟。为此定下这几条规则：

- **只改文档不跑 CI。** 所有 `.md`、根目录的 `.html`、`docs/`、`nocoproject/docs/`、`Multica_调研/`、`nocosolution` 子模块指针、`.agents/`、`.claude/`，改动全在这些路径里时整个 workflow 不触发，也不部署。`nocoproject/index.html` 是构建入口，不在其中。
- **按目录跑作业。** 只改 `nocoproject-cli/` 不跑 `app`，只改 `nocoproject/` 不跑 `cli`；改 `.github/workflows/` 两个都跑。
- **截图只在界面有改动时跑。** 改到 `nocoproject/{client,e2e,public}/` 才装浏览器、截图、挂 `screenshots` artifact。纯服务端的 PR 没有截图，交付说明照常按"前端任务附截图"的规则走。
- **main 上不重跑测试。** PR 的检查跑在"分支与 main 合并后"的提交上，所以合并后 main 的推送只做类型检查和 lint（`cli` 只做 tsc 和构建），通过后部署；只改 CLI 也照常部署（安装包随应用构建）。合并前如果 main 已经前进了很多，在 PR 上点"Update branch"让检查重跑一遍再合。
- **完整检查手动跑。** Actions 页选 CI → Run workflow，选分支，跑全部测试和截图，不看改动路径：`gh workflow run ci.yml --ref <分支>`。
- **每个作业有超时**（changes 5、app 25、cli 10、deploy 20 分钟），卡住的作业不会一直计费。
- **额度又不够时：** 提交信息里写 `[skip ci]` 可以跳过这次推送的 CI，但部署也一起跳过，需要本地验证后手动 `pnpm deploy:server`（[deploy.md](deploy.md)）。Agent 不要自己加 `[skip ci]`，由负责人决定。
- **自托管 runner：** `app` 与 `cli` 的 `runs-on` 读仓库变量 `CI_RUNNER`，没设就用 `ubuntu-latest`。在自托管机器上注册好 runner 后，把变量设成它的标签（例如 `self-hosted`）就切过去，不用改 workflow；删掉变量就切回来。`deploy` 始终在 GitHub 托管机器上跑。自托管机器要预装 Docker（服务容器用）和 Playwright 的系统依赖（workflow 只在托管机器上加 `--with-deps`）。

## 设置

- 模型价格（美元 / 百万 token）：Opus 5.5 输入 4、输出 20、缓存读 0.2；Sonnet 5 输入 2、输出 10；DeepSeek Flash 输入 0.14、输出 0.28。
- 指标阈值：AI 承担率 ≥ 0.5、建议接受率 ≥ 0.7、认领延迟 P50 ≤ 3 s、丢运行 0、决定处理 P50 ≤ 24 h。

## 工作流程（迭代 4 起）

- 新建任务：默认"AI 整理"标签（描述或粘贴 → 草稿 → 创建），手动标签备用；流程字段"自动"由分类器判定。
- 先出方案的任务：Agent 提交方案 → 负责人在收件箱或任务页"批准进入开发 / 打回修改" → 批准后 Agent 才能进入开发。
- 项目经理：侧栏"项目经理"随时提问（按你的可见范围回答）；任务 done 后自动写一条总结备注并建议知识库更新（设置 → 通用可关）。
- 已知边界：Agent 与守护进程同一用户运行，能读到本机的 API key；简报与指令已禁止，根本隔离在 Phase 2。
