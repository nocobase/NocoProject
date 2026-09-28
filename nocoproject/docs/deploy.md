# 部署：ali-agents 服务器

2026-09-28 起，NocoProject 的正式环境（dogfooding、测试、日常使用）在 ali-agents 服务器上，开发机不再常驻开发服务器。

## 地址

| 用途                       | 地址                                 | 说明                                                                 |
| -------------------------- | ------------------------------------ | -------------------------------------------------------------------- |
| 浏览器、海外机器的守护进程 | `https://project.nocobase.cn/main`   | Caddy 反代，证书自动签发；`*.nocobase.cn` 泛解析到服务器             |
| 国内机器（dev）的守护进程  | `http://100.89.167.29:13001/main`    | 服务器的 Tailscale 地址。国内连公网域名的 443 会被重置，走 Tailscale |
| SSH                        | `ssh ali-agents-ts`（用户 `agents`） | `~/.ssh/config` 里的别名，经 Tailscale                               |

自助注册已关闭（`auth.emailAndPassword.disableSignUp: true`），成员由管理员在“设置 → 成员”添加。

## 服务器上的布局（`/home/agents/nocoproject`）

| 路径 / 名称                                     | 内容                                                                                                      |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `config.yml`（600）                             | 应用配置，从开发机的 config.yml 迁来，沿用 `auth.secret` 与 `session.secret`（API Key、加密的密钥依赖它） |
| `app.env`（600）                                | 容器环境变量：`DEEPSEEK_API_KEY`，以及生成 PostgreSQL 容器时用的 `DB_PASSWORD`                            |
| `storage/`                                      | 挂到容器 `/app/storage`（日志、上传）                                                                     |
| `pgdata/`                                       | PostgreSQL 数据目录                                                                                       |
| `build/`                                        | 部署脚本上传的 `dist/` 与 Dockerfile，镜像在这里构建                                                      |
| 容器 `nocoproject-postgres`                     | `postgres:16`，库 `nocoproject`、用户 `nocoproject`，只在 docker 网络 `nocoproject` 内可见                |
| 容器 `nocoproject-app`                          | 镜像 `nocoproject:<提交>`，只监听 `100.89.167.29:13001`；`--restart unless-stopped`                       |
| `~/.nocobase/proxy/caddy/nocoproject/app.caddy` | `project.nocobase.cn` 站点。服务器的 Caddy 由 nb CLI 管理，主配置按 `*/app.caddy` 导入这个目录            |
| systemd 用户服务 `nocoproject-daemon`           | 服务器自己的守护进程（claude、codex、opencode），CLI 装在 `~/.local`                                      |

Docker 是 rootless 的：容器以 `--user 0:0` 运行，对应宿主机的 `agents` 用户，才能读写挂载的文件；同一端口不能同时绑两个地址，所以应用只绑 Tailscale 地址，Caddy 也反代到这个地址。

## 发布新版本

**自动：** 推到 main（合并 PR）后，CI 的 `app` 与 `cli` 通过，`deploy` 作业就在 GitHub 的机器上构建 `linux-x64` 的 `dist/`，打成 tar 经 SSH 传给服务器的 `np-deploy`（镜像标签是 7 位提交号）。结果在 Actions 运行记录和仓库的 production 环境里看，失败时 GitHub 发邮件。main 上的 CI 运行不会被新推送取消，部署作业串行排队。

- 部署密钥：仓库 secret `NP_DEPLOY_SSH_KEY`（私钥）与 `NP_DEPLOY_KNOWN_HOSTS`（服务器主机指纹），走公网 `agents@47.236.77.169`。服务器 `~/.ssh/authorized_keys` 里这把公钥带 `command="/home/agents/nocoproject/bin/np-ci-deploy",restrict`，只能执行 `deploy <提交号>`，不能开 shell、转发端口。
- 换密钥：`ssh-keygen -t ed25519` 生成新的一对，替换 authorized_keys 里注释为 `github-actions deploy zhouyanliang/NocoProject` 的那行，再 `gh secret set NP_DEPLOY_SSH_KEY < 私钥`，删掉本地私钥。

**手动（应急、或同步服务器脚本）：** 在开发机的 `nocoproject/` 目录，检出要发布的提交：

```bash
pnpm deploy:server
```

`scripts/server/` 里的脚本只由手动部署同步到服务器，改了它们要手动部署一次（或 `NP_DEPLOY_SCRIPTS_ONLY=1 pnpm deploy:server`）。

`scripts/deploy-server.sh` 按 `linux-x64` / Node 24 构建 `dist/`，rsync 到服务器，用仓库的 Dockerfile（`DIST=prebuilt`）打镜像 `nocoproject:<短提交号>`，替换应用容器并等健康检查通过。约 3 分钟；替换期间服务中断约 30 秒，守护进程会自动重连。迁移随应用启动自动执行。`NP_DEPLOY_SKIP_BUILD=1` 复用已有的 linux-x64 构建。

CLI 安装包随应用发布：每次 `pnpm build` 在客户端构建之后执行 `scripts/pack-cli.sh`（`cli/nocoproject-build.ts` 声明的构建钩子），把同级的 `nocoproject-cli` 打包到 `dist/client/assets/cli/nocoproject-cli-<版本>.tgz`。应用在公网与 Tailscale 地址下都提供 `/main/assets/cli/…`，其他电脑用 `npm i -g <地址>` 安装，不需要 GitHub 账号；“添加电脑”页面按访问地址生成这条命令。应用只对 `/assets/*` 提供静态文件，且按一年 immutable 缓存，所以文件名带版本号。打包失败则构建失败；服务器上的 `np-deploy` 在产物里找不到安装包时拒绝部署。

发布新版 CLI：同时改 `nocoproject-cli/package.json`、`nocoproject-cli/tests/cli.test.ts` 与 `client/pages/np/constants.ts` 的 `CLI_VERSION`（不一致时构建与 `tests/logic/np-cli-installer.test.ts` 都会失败），然后部署；各机器重新执行安装命令并重启守护进程。

服务器端的步骤在 `scripts/server/np-deploy`（部署时同步到 `~/nocoproject/bin/`，`NP_DEPLOY_SCRIPTS_ONLY=1 pnpm deploy:server` 只同步脚本）：先把数据库备份到 `~/nocoproject/backups/pre-deploy-<时间>-<提交>.dump`（留最近 10 份），再打镜像、替换容器、等健康检查；3 分钟内不健康就自动换回上一个镜像并以非零退出。自动回滚不回退数据库迁移，迁移出错时用这份备份恢复。同一时间只允许一个部署。

回滚到更早的版本：服务器保留最近 3 个镜像（`docker images nocoproject`），`ssh ali-agents-ts '~/nocoproject/bin/np-deploy <旧标签>'` 直接用那个镜像替换容器（同样先备份、失败回滚）；更早的版本先检出那个提交再 `pnpm deploy:server`。

## 备份

- 每次部署前一份（见上）。
- 每日一份：systemd 用户定时器 `nocoproject-backup.timer`（UTC 19:30，即北京时间 03:30）运行 `~/nocoproject/bin/np-backup`，写 `~/nocoproject/backups/daily-<日期>.dump`，保留 14 天。
- 恢复：`docker exec -i nocoproject-postgres pg_restore -U nocoproject -d nocoproject --clean --if-exists < <备份文件>`，然后 `docker restart nocoproject-app`。备份只在这台服务器上，重要节点前可以 scp 一份到别处。

## 常用操作

```bash
ssh ali-agents-ts 'docker logs --tail 100 nocoproject-app'
ssh ali-agents-ts 'systemctl --user status nocoproject-daemon; journalctl --user -u nocoproject-daemon -n 50'
ssh ali-agents-ts 'docker exec nocoproject-postgres pg_dump -U nocoproject -Fc nocoproject' > nocoproject.dump
```

改 `config.yml` 后 `docker restart nocoproject-app`。

## 迁移记录（2026-09-28）

开发机 `demo-postgres` 的 `nocoproject` 库以 `pg_dump -Fc --no-owner --no-acl` 整库迁入；GitHub 改为仓库正式 webhook 直接推到公网地址（见 dogfooding.md）；开发机的 launchd 开发服务器与 webhook 转发已停用（plist 仍在 `~/Library/LaunchAgents/`，需要时可以重新加载，开发机的库没有删除）。
