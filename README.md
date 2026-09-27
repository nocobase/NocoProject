# NocoProject

NocoProject 是一个基于 NocoBase 3、用于人与 Agent 协同的项目管理系统。

仓库包含两个主要包：

- [`nocoproject/`](./nocoproject/)：NocoBase 3 应用，包含 Web 界面、服务端、数据库迁移和应用测试。
- [`nocoproject-cli/`](./nocoproject-cli/)：本地守护进程与 CLI，负责领取项目运行、启动 Coding Agent，并提供 `nocoproject issue` 等命令。

## 开发环境

需要 Node.js 24 或更高版本（CLI 本身要求 Node.js 22 或更高版本）和 pnpm 11。

### NocoBase 应用

```bash
cd nocoproject
pnpm install
pnpm nocobase config init   # 首次运行时生成 config.yml
pnpm nocobase config check
```

运行测试、类型检查和开发服务：

```bash
pnpm test
pnpm typecheck
pnpm dev                   # 启动 API 与 Vite 开发服务器
```

构建并启动生产服务：

```bash
pnpm build
pnpm start
```

### 守护进程与 CLI

```bash
cd nocoproject-cli
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

构建完成后可登录应用并以前台方式启动守护进程：

```bash
node dist/cli.js login --server http://127.0.0.1:13000/main --api-key <NocoBase API key>
node dist/cli.js daemon start --foreground
```

也可以使用 `npm link` 将构建出的 `nocoproject` 命令加入 `PATH`。守护进程会根据本机已安装的 Claude Code、OpenCode 或 Codex 运行时领取任务；完整命令说明见 [`nocoproject-cli/README.md`](./nocoproject-cli/README.md)。

## 文档入口

所有方案与阶段文档位于 [`nocoproject/docs/`](./nocoproject/docs/)：

- **方案与决策**：[`adr/`](./nocoproject/docs/adr/)，包括 TypeScript 与包布局、PostgreSQL 分发协议、临时实现边界、触发源约束等 ADR。
- **Phase 0**：[`phase0/plan.md`](./nocoproject/docs/phase0/plan.md)、[`phase0/protocol.md`](./nocoproject/docs/phase0/protocol.md)、[`phase0/server-notes.md`](./nocoproject/docs/phase0/server-notes.md)、[`phase0/conclusion.md`](./nocoproject/docs/phase0/conclusion.md)。
- **Phase 1 总体与工作区**：[`phase1/plan.md`](./nocoproject/docs/phase1/plan.md)、[`phase1/workspace.md`](./nocoproject/docs/phase1/workspace.md)。
- **Phase 1 迭代文档**：[`phase1/iteration-1-contract.md`](./nocoproject/docs/phase1/iteration-1-contract.md)、[`phase1/iteration-1-integration.md`](./nocoproject/docs/phase1/iteration-1-integration.md)、[`phase1/iteration-2-contract.md`](./nocoproject/docs/phase1/iteration-2-contract.md)、[`phase1/iteration-2-integration.md`](./nocoproject/docs/phase1/iteration-2-integration.md)、[`phase1/iteration-3-contract.md`](./nocoproject/docs/phase1/iteration-3-contract.md)、[`phase1/iteration-3-integration.md`](./nocoproject/docs/phase1/iteration-3-integration.md)。
- **协议与服务端记录**：[`phase1/protocol-iteration-1.md`](./nocoproject/docs/phase1/protocol-iteration-1.md)、[`phase1/protocol-iteration-2.md`](./nocoproject/docs/phase1/protocol-iteration-2.md)、[`phase1/protocol-iteration-3.md`](./nocoproject/docs/phase1/protocol-iteration-3.md) 及对应的 `server-notes*.md`。
