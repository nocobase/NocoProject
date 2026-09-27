# Workspace 化：准备记录与切换步骤（Phase 1 迭代 3 §I）

> 子任务 B 交付。本轮只做准备，**没有切换**：仓库根目录多了几份文件，`nocoproject/`、`nocoproject-cli/` 仍各自是独立的 pnpm 根（各自的 `pnpm-workspace.yaml`、锁文件和 `node_modules`），行为与之前完全一样。切换由主会话在三方交付后按第 4 节执行。

## 1. 本轮新增的文件（都在仓库根目录，未移动任何现有文件）

| 文件                  | 作用                                                                                                                                                                                                                                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm-workspace.yaml` | `packages: [nocoproject, nocoproject-cli, packages/*]`，外加 `verifyDepsBeforeRun: false`（原因见 2.4）。pnpm、Vite、vitest 都只认**最近的** `pnpm-workspace.yaml`，所以在两个子目录里跑的命令看不到它。                                                                                                                                     |
| `.pnpmfile.cjs`       | 切换前的护栏：在根目录 `pnpm install` 会在解析阶段直接报错退出（`readPackage` 钩子里抛错，什么都还没链接）；根目录 `pnpm run` 不受影响（只加载、不调用钩子）。设 `NOCOPROJECT_WORKSPACE_CUTOVER=1` 可以放行一次试验。切换时删除。                                                                                                            |
| `package.json`        | `private`，`packageManager: pnpm@11.7.0`；脚本 `typecheck` / `test` / `build` 用 `pnpm --dir <包> run …` 逐包执行（`--dir` 让 pnpm 以子目录为根，不会触发根安装）。                                                                                                                                                                          |
| `packages/protocol/`  | `@nocoproject/protocol`（`private`）：`exports` / `types` 指向 `./src/index.ts`（开发期直接吃 TS 源码）；`publishConfig.exports` 指向 `./dist/*`、`build` = `tsc -p tsconfig.build.json`（`nocobase build` 需要，见 2.5）；`src/index.ts` 是占位：`ProtocolPackageMarker` 类型 + `PROTOCOL_PACKAGE_MARKER` 常量；`.gitignore` 忽略 `dist/`。 |

两个包的 `package.json` **没有**加 `@nocoproject/protocol: workspace:*`，根目录**没有**执行 `pnpm install`——原因见第 2 节；等价的完整验证在一份副本里做了（第 3 节）。

已在真实仓库确认：根目录 `pnpm typecheck` 只是转到两个包里执行，前后 `nocoproject/node_modules/.modules.yaml`、`nocoproject-cli/node_modules/.modules.yaml` 的修改时间不变，根目录没有生成 `node_modules` 或锁文件；13001 上的开发服务器没有被碰。

## 2. 为什么本轮不在原地 install（实测出来的问题）

在仓库副本（源码全量拷贝，不含 `node_modules`）里按"根 workspace + 两个包加 `workspace:*` + 根目录 `pnpm install`"做了一遍，结论：

### 2.1 根安装会忽略子目录的锁文件和设置

- 根安装只读根目录的 `pnpm-workspace.yaml`：`nocoproject/pnpm-workspace.yaml` 里的 `allowBuilds`（`better-sqlite3`、`esbuild`…）、`trustLockfile`、`strictDepBuilds`、`minimumReleaseAgeExclude` 不生效，`.npmrc` 里的 `@nocobase:registry` 也要放到根目录。
- 子目录的 `pnpm-lock.yaml` 被忽略、全部重新解析：`--offline` 直接失败（`ERR_PNPM_NO_OFFLINE_META`），联网解析后应用的 125 个直接依赖里有 34 个解析结果变了，例如 `@tanstack/react-query` 5.103.3 → 5.104.0，`@nocobase/db` / `@nocobase/app-server` 等丢掉了 `better-sqlite3` 这个可选 peer。
- **办法（已验证）**：把 `nocoproject/pnpm-lock.yaml` 复制成根锁文件，把 importer `.` 改名为 `nocoproject` 再安装——应用侧解析结果与原锁文件逐项一致（唯一差别是新增的 `@nocoproject/protocol: link:../packages/protocol`），20 秒装完，CLI 的少量依赖照常解析。

### 2.2 子目录的 `pnpm-workspace.yaml` 与根 workspace 不能共存

- 根安装后依赖都在根目录的 `node_modules/.pnpm`。只要 `nocoproject/pnpm-workspace.yaml` 还在，Vite 的 `searchForWorkspaceRoot` 就停在 `nocoproject/`，默认 `server.fs.allow` 不含根目录：用同一份应用做的 Vite 开发服务器探针，`/@fs/<root>/node_modules/.pnpm/react@19.3.0/…/index.js` 和 `/@fs/<root>/packages/protocol/src/index.ts` 都是 **403**；删掉子目录那份文件后都是 200。`tests/logic/client-routes.test.ts` 同理直接失败（`Cannot find module '/@fs/…/@nocobase/dev-config/dist/vitest/react-setup.js'`）。**也就是说，如果在原地做根安装而不删子目录的文件，正在跑的开发服务器会拿不到任何依赖。**
- 子目录有自己的 `pnpm-workspace.yaml` 时它是独立根，`workspace:*` 在里面解析不了：`nocoproject-cli` 里任何会校验依赖的命令（pnpm 11 默认在 `pnpm exec` / `pnpm run` 前检查依赖，CLI 没关掉）都会去装依赖并报 `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`；`nocoproject` 里的 `pnpm install` 同样失败。所以切换前不能给两个包加 `workspace:*`。

### 2.3 原地安装会重排 `nocoproject/node_modules`

根安装把 `nocoproject/node_modules` 改成指向根目录虚拟仓库的链接；`pnpm dev` 监视 `package.json`、锁文件和安装状态，会在安装静默后重启本地服务。另外本轮 C 子任务正在改 `nocoproject/package.json` / 锁文件（新增 `react-virtuoso`），同时做根安装会互相覆盖。

### 2.4 根目录 `pnpm run` 会顺手触发根安装

在一个小副本里验证：根目录有 `pnpm-workspace.yaml` 但没写 `verifyDepsBeforeRun: false` 时，在根目录跑 `pnpm build` 会先执行一次根 `pnpm install`（建出根锁文件和各包 `node_modules`）。所以根文件里写了 `verifyDepsBeforeRun: false`，并加了 `.pnpmfile.cjs` 护栏（`preinstall` 脚本拦不住：它在链接之后才运行，实测无效）。

### 2.5 `nocobase build` 对 workspace 依赖的要求（生产构建）

`@nocobase/app-cli` 1.0.0-beta.6 的 `build`：

1. 先跑 `pnpm --filter nocoproject^... build`（"Build server workspace dependencies"）：应用依赖的每个 workspace 包都必须有 `build` 脚本，否则 `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT` 整个构建失败。
2. 服务端代码对协议包是**值导入**（`RUN_TOKEN_PREFIX`、`EXECUTION_MODES`、`REACTION_EMOJIS`、`CLAIM_LEASE_SECONDS`、`KNOWLEDGE_NOTE_MAX` 等），所以 `@nocoproject/protocol` 必须在应用的 `dependencies`（放 `devDependencies` 时 "Verify server dependencies" 报 `imported by server code but not in this application's "dependencies"`）。
3. `dependencies` 里的 workspace 包会被**内置（vendor）**进 `dist/vendor/<name>`（拷贝包的 `dist/`，`exports` 取 `publishConfig.exports`），前提是 `listWorkspacePackages` 能找到它：它只扫描应用上一级目录下**一层**的子目录（祖父目录名为 `packages` 时才扫两层）。所以：
   - `packages/protocol` **找不到**：`Generated dist/package.json with … 0 vendored workspace packages`，随后去 npm 拉 `@nocoproject/protocol` → `ERR_PNPM_FETCH_404`，构建失败。
   - 放在仓库根的 `protocol/`（与 `nocoproject/` 同级）**可以**：`1 vendored workspace packages`，"Verify server dependencies" 通过，`dist/` 里的服务端 `import('./server/modules/shared/ids.js')` 能拿到协议包的常量。

→ **切换时要把包从 `packages/protocol` 挪到 `protocol/`**（本轮按契约建在 `packages/protocol`，不在本轮挪，是因为它没有任何使用方）。

## 3. 验证记录（仓库副本，根 workspace 已切换、探针导入已加）

副本 = `nocoproject/`、`nocoproject-cli/` 源码 + 本轮的根文件；根锁文件按 2.1 从应用锁文件播种；删除了两个子目录的 `pnpm-workspace.yaml`（设置合并到根）；两个包加 `@nocoproject/protocol: workspace:*`；探针：`client/routes.ts` 与 `server/modules/shared/ids.ts` 值导入 + 类型导入占位常量，CLI 的 `src/version.ts` 与一个测试文件同样导入。

| 检查                                                                                   | 结果                                                                                                                       |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 根目录 `pnpm install --prefer-offline`                                                 | 20 s；应用 `postinstall`（`nocobase skills sync`）照常执行；只有 peer 警告                                                 |
| 应用 `pnpm typecheck`（三个 tsconfig）                                                 | 通过；`tsc --listFilesOnly` 确认 `tsconfig.json` 与 `tsconfig.server.json` 都读到了 `packages/protocol/src/index.ts`       |
| 应用 `vitest run tests/logic/client-routes.test.ts`                                    | 5/5 通过（子目录 `pnpm-workspace.yaml` 还在时失败，见 2.2）                                                                |
| 应用 `vitest run`（全量）                                                              | 87 个文件 / 660 个用例通过                                                                                                 |
| `vite build`                                                                           | 通过，占位常量被内联进产物                                                                                                 |
| Vite 开发服务器 `/@fs` 探针                                                            | 协议源码与 `.pnpm` 依赖均 200（子目录文件在时 403）                                                                        |
| `tsx` 加载 `server/modules/shared/ids.ts`                                              | 拿到常量（`nocobase dev` 的服务端走 tsx）                                                                                  |
| 应用 `pnpm build`（`nocobase build`）                                                  | 包在 `packages/protocol`：失败（2.5）；挪到 `protocol/`、有 `build` 脚本、进 `dependencies` 后通过，产物服务端能导入内置包 |
| `pnpm nocobase locales check` 等命令                                                   | 能正常运行，结果与原仓库一致（`LOCALES_MISMATCH` 是现存状态，与本轮无关）                                                  |
| CLI `tsc --noEmit` / `pnpm build`（tsup） / `vitest run --exclude "**/*.live.test.ts"` | 通过（16 个文件 / 159 个用例，含探针测试）；tsup 把包内联进单文件产物                                                      |
| 根目录 `pnpm -r run typecheck`                                                         | 三个包都通过                                                                                                               |

探针只存在于副本里，真实仓库没有加过。

## 4. 切换步骤（主会话执行）

前提：三方交付已合并、工作区干净；**先停掉 13001 上的开发服务器**，确认没有别的会话在装依赖。

```bash
cd /Users/zhou/claude/NocoProject

# 1. 包挪到 nocobase build 能内置的位置（2.5）
git mv packages/protocol protocol && rmdir packages 2>/dev/null
#    pnpm-workspace.yaml 的 packages 改为: nocoproject / nocoproject-cli / protocol

# 2. 设置合并到根，删掉子目录的 workspace 文件与护栏
#    把 nocoproject/pnpm-workspace.yaml 的全部设置（allowBuilds、verifyDepsBeforeRun、trustLockfile、
#    strictDepBuilds、minimumReleaseAgeExclude）追加到根 pnpm-workspace.yaml（CLI 的 allowBuilds 是其子集）
git rm nocoproject/pnpm-workspace.yaml nocoproject-cli/pnpm-workspace.yaml .pnpmfile.cjs
cp nocoproject/.npmrc .npmrc               # @nocobase:registry 等；保留应用那份：nocobase build 在 dist/ 里安装时是独立根（副本验证时两份都在）

# 3. 播种根锁文件，保持应用的解析结果（2.1）
cp nocoproject/pnpm-lock.yaml pnpm-lock.yaml
sed -i '' 's/^  \.:$/  nocoproject:/' pnpm-lock.yaml   # importers 下唯一的 "  .:" 行
git rm nocoproject/pnpm-lock.yaml nocoproject-cli/pnpm-lock.yaml

# 4. 协议文件搬进包（-server 两份也一起搬：它们只相对引用其他协议文件，原样可用）
for f in protocol.ts protocol.phase1-iter2.ts protocol.phase1-iter2-server.ts \
         protocol.phase1-iter3.ts protocol.phase1-iter3-server.ts; do
  git mv nocoproject/server/modules/shared/$f protocol/src/$f
done
printf "export * from './protocol.js';\n" > protocol/src/index.ts   # 覆盖占位
```

5. 依赖声明：`nocoproject/package.json` 的 **`dependencies`**（服务端值导入）加 `"@nocoproject/protocol": "workspace:*"`；`nocoproject-cli/package.json` 的 `devDependencies` 加同一行（tsup 打包进单文件）。
6. 改导入（服务端与测试）：`from '../shared/protocol.js'`（103 处）、`from './protocol*.js'`（`shared/` 内 20 余处）、`from '../modules/shared/protocol.js'`、测试里的 `'../../server/modules/shared/protocol.ts'`（9 处）统一改为 `'@nocoproject/protocol'`，例如：

   ```bash
   cd nocoproject
   grep -rlE "shared/protocol|'\./protocol" server tests database cli | xargs perl -pi -e \
     "s#(from |import\()'(?:\.{1,2}/)+(?:server/)?(?:modules/)?(?:shared/)?protocol(?:\.phase1-iter\d(?:-server)?)?\.(?:js|ts)'#\$1'\@nocoproject/protocol'#g"
   ```

   前端 `client/pages/np/types*.ts` 目前是**复制**协议联合类型（注释写明原因：客户端 tsconfig 不能引到 `server/`）。有了包之后可以改为 `import type … from '@nocoproject/protocol'`（已验证客户端 tsconfig 与 Vite 都能解析），可在切换后逐步替换，不是切换的必需步骤。

7. CLI：`git rm src/protocol.ts src/protocol.phase1-iter2.ts src/protocol.phase1-iter3.ts scripts/sync-protocol.mjs`，删掉 `package.json` 的 `sync-protocol` 脚本；`src/` 与 `tests/` 里的 `'../protocol.js'`（22 处）、`'../../protocol.js'`（6 处）、`'./protocol.js'`（5 处）改为 `'@nocoproject/protocol'`：

   ```bash
   cd nocoproject-cli
   grep -rlE "protocol(\.phase1-iter\d)?\.js'" src tests | xargs perl -pi -e \
     "s#from '(?:\.{1,2}/)+protocol(?:\.phase1-iter\d)?\.js'#from '\@nocoproject/protocol'#g"
   ```

8. 根 `package.json` 的脚本改为 `pnpm -r --workspace-concurrency=1 run typecheck|test|build`（这样也会跑协议包的 `typecheck`）；CLI 的 `test` 如需排除 live 测试，在 CLI 自己的脚本里处理。
9. 根目录 `pnpm install`，然后：根 `pnpm typecheck`；`pnpm --dir nocoproject exec vitest run`；`pnpm --dir nocoproject build`（确认输出 `1 vendored workspace packages` 与 "Verify server dependencies" 通过）；`pnpm --dir nocoproject-cli build` 与 `exec vitest run --exclude "**/*.live.test.ts"`。
10. 启动开发服务器，改一下 `protocol/src/` 里的类型，确认前端热更新与服务端重启（见第 5 节未验证项）。
11. 文档：`nocoproject/AGENTS.md`（"NocoProject server modules" 一段里的协议文件位置与"CLI 复制"说法）、`nocoproject-cli/README.md`（`sync-protocol` 与 `src/protocol*.ts` 的说明）、`docs/phase0/protocol.md` 与各轮 `protocol-iteration-*.md` 开头的类型位置；`AGENTS.md` 里要求"改协议先改 `server/modules/shared/protocol.ts`"的地方改成 `protocol/src/`。

## 5. 风险与未验证项

- **Docker 构建**：`nocoproject/Dockerfile` 在应用目录里 `pnpm install --frozen-lockfile`；切换后应用目录没有锁文件，构建上下文要改成仓库根（或用 `pnpm deploy --filter nocoproject`）。未验证。
- **模板升级**：`nocobase-app-upgrade` 默认应用根就是包管理根；切换后 pnpm 设置与锁文件在仓库根，升级合并 `pnpm-workspace.yaml` 时要改根目录那份。
- **开发期监视**：`pnpm dev` 按应用目录监视 `package.json`、锁文件和安装状态，锁文件挪到根后，依赖变更可能不再自动重启服务端；`protocol/src/` 在应用根之外，Vite 对根外被导入文件的热更新、服务端 tsx 监视是否覆盖它，都没有在真实开发服务器上验证（第 4 步 10 要看）。
- **内置规则依赖实现细节**：`listWorkspacePackages` 的"上一级目录扫一层"是 `@nocobase/app-cli` 1.0.0-beta.6 的行为，升级 app-cli 后要复查；协议包必须保留 `build` 脚本和 `publishConfig.exports`，`dist/` 由 `nocobase build` 的第一步自动构建。
- **不播种锁文件**会让依赖版本漂移，并丢掉 `better-sqlite3` 这个 peer（SQLite 测试夹具依赖它）。
- 引擎：应用要求 Node ≥ 24，CLI ≥ 22；根 `package.json` 不声明 `engines`。本机全局 pnpm 是 12.6.0，根与应用都通过 `packageManager` 固定到 11.7.0（corepack）。
- 协议包的 `typescript` 用 CLI 的 `~5.9.3`（只做 `tsc` 产出 `dist/`）；应用用 TS 6，类型检查仍由各自的 tsconfig 做。
