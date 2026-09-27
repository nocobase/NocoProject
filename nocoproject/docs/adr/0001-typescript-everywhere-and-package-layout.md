# ADR-0001：全栈 TypeScript 与包布局

- 状态：已接受（2026-09-27）
- 关联：《NocoProject 产品与技术方案》4.2、7.1

## 背景

Multica 用 Go 写服务端与守护进程，前端用 TypeScript。NocoProject 建在 NocoBase 3（Node/TypeScript）上，团队是 NocoBase 团队。守护进程要在开发者电脑和团队服务器上长期运行、驱动外部编码工具进程、管理 git 工作树。

## 决定

1. 服务端、前端、守护进程与 CLI 全部用 TypeScript；守护进程要求 Node 22 以上。
2. 守护进程与 CLI 是一个独立的 npm 包 `nocoproject-cli`，提供 `nocoproject` 与 `ncp` 两个命令，一个二进制既是用户 CLI、也是守护进程、也是 Agent 在运行中回写用的工具。
3. Phase 0 里该包放在应用目录的同级目录（`NocoProject/nocoproject-cli`），协议类型文件 `protocol.ts` 在服务端（`server/modules/shared/protocol.ts`）和 CLI（`src/protocol.ts`）各有一份，以服务端为准、复制同步，并由文档 `docs/phase0/protocol.md` 约束。Phase 1 迁入 pnpm workspace 后改为共享包。
4. 分发方式：npm 全局安装为主；单文件二进制（esbuild 打包 + Node 单文件可执行）作为补充，Phase 1 验证。

## 理由

- 单一语言：协议类型可共享，一个人能同时改服务端和守护进程，代码评审不需要两套技能。
- NocoBase 应用模板对 `dependencies` 与 `devDependencies` 的部署语义有严格要求，守护进程放在应用包里会把 `ws`、`commander` 等带进服务端部署；独立包更干净。
- Go 的优势（静态单文件、进程管理）对 Phase 0 不关键；如果 Phase 1 的打包验证失败，可以只把守护进程换成 Go，协议不变。

## 后果

- 需要维护两份协议类型直到 monorepo 化；用文档和评审保证一致。
- Windows 支持依赖 Node 的进程与信号语义，需要在 Phase 1 专门验证。
