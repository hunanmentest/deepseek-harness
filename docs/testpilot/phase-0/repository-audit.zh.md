# TestPilot 阶段 0 — 仓库与包架构审计

[English](repository-audit.md) | 中文

本审计记录 TestPilot 实施方案所依赖的仓库状态、工作区布局与包放置规则。以下每条事实均从工作树读取而来，没有一项沿用方案自身的摘要。

## 审计目标与本地状态

审计在 `C:\code\deepseek-harness-master` 的工作树上执行。该树带有 Git 目录，但本次审计首次读取时并无任何 commit：`git rev-parse HEAD` 以退出码 128 失败，报 `fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree`，且 `git status` 报告尚无 commit。其后一个后台 fetch 填充了对象库，此后 `git rev-parse HEAD` 可以解析，`git status` 报告除本次审计自身的输出目录外工作树干净。因此在撰写本审计时，方案中命名的 commit 基准无法与该树核对，而随后落地的那个 fetch 并不属于被审计的状态。

| 事实 | 值 | 观察方式 |
|---|---|---|
| Git 元数据 | 存在，但审计时无可解析的 commit | `git rev-parse HEAD` 退出码 128 |
| 方案声明的基准 | 一个具名的上游 commit | 无法与被审计的树核对 |
| 根包名 | `@deepseek-ai/dsh-root` | `package.json:2` |
| 根包版本 | `0.2.2-rc.2` | `package.json:3` |
| 包管理器 | `pnpm@11.28.5` | `package.json:7` |
| Node | `v22.22.2` | `node --version` |
| 声明的 Node 下限 | `>=24.9.0` | `package.json:9` |
| 平台 | `win32 x64` | `node -p "process.platform + ' ' + process.arch"` |

由此产生两个后果。方案中的 commit 无法与本工作树核对，因此本次审计中的每条"已核实"都表示"在当前存在的文件中已验证"，而非"已在方案的基准 commit 上验证"。本地 Node 版本低于根 `package.json` 在 `engines` 中要求的 `>=24.9.0`；工作区仍能正常安装与测试，但环境并非清单所声明的环境。

在这次 fetch 之后，仓库历史又被本次审计之外的一次操作改写。方案中点名的 commit 已不在对象库中，承载同一个上游合并的 commit 变成了另一个对象，而本次审计自己的文档目录被作为本地 commit 提交在它之上。被审计的内容不受影响，因为上面每条结论都是从工作树的文件读出的，而不是从某个 commit 读出的，且工作树中被跟踪的源码在整个过程中没有变化。当前本地状态是：一个承载同一合并消息的上游跟踪 commit，一个存放本次审计文档的本地 commit，以及对任何被跟踪源码文件的零改动。

## 工作区布局

根 `package.json` 与 `pnpm-workspace.yaml` 一致声明工作区覆盖 `vendor/*`、`packages/*/*`、`native/system`、`native/system/packages/*`、`apps/*`、`benchmarks`、`website` 和 `python/sdk-runtime`（`package.json:11-18`，`pnpm-workspace.yaml:1-18`）。`packages/*/*` 是新 TestPilot 包必须采用的形状，因为它把一个包放在一个产品组内。

`packages/README.md` 的包组表与磁盘上的目录完全一致：表中列出 53 个包组，磁盘上有 53 个包组目录，两侧都没有缺项（`packages/README.md:29-83`）。承载 TestPilot 所触及包的包组如下，表中给出每个包组拥有的包数量：

| 包组 | 包数量 | 与 TestPilot 相关的内容 |
|---|---|---|
| `browser-use` | 1 | `browser-use` |
| `experimental` | 63 | `browser-use-runtime`、`browser-use-playwright-mcp`、`browser-use-chrome-devtools-mcp`、`browser-use-stagehand-native` |
| `mcp` | 3 | `mcp-client`、`mcp-manager`、`mcp-resources` |
| `interaction` | 5 | `user-approval`、`permission-presets`、`tool-ask-user`、`user-questions`、`commands` |
| `guard` | 2 | `timeout-policy`、`repeat-tool-reminder` |
| `sandbox` | 4 | `sandbox`、`sandbox-local`、`sandbox-policy`、`sandbox-windows-acl` |
| `core` | 10 | `agent`、`agent-loop`、`tools`、`scope`、`session`、`system-prompt`、`tool-executor-native`、`tool-executor-ptc` |
| `session` | 22 | `session-persistence`、`session-projection`、`working-directory`、`session-format-*` |
| `storage` | 4 | `storage`、`storage-domain`、`storage-json`、`storage-sqlite` |
| `attachment` | 2 | `attachment`、`attachment-local` |
| `subprocess` | 3 | `subprocess`、`subprocess-local`、`win32-process` |
| `util` | 23 | `http-proxy`、`official-bundles`、`home-paths`、`package-manifest` |
| `boot` | 6 | `app-boot`、`cmdline`、`hmr`、`plugin-manager`、`plugin-market`、`config-editor` |
| `bundle` | 6 | `base`、`web-app`、`headless`、`sdk-app`、`sdk-minimal`、`acp-app` |
| `jobs` | 3 | `jobs`、`jobs-local`、`tool-jobs` |
| `workflow` | 3 | `workflow`、`workflow-ptc`、`tool-workflow` |
| `ptc-runtime` | 2 | `ptc-runtime`、`ptc-runtime-node` |
| `workspace` | 1 | `workspace` |
| `identity` | 1 | `anonymous-user-id` |
| `api` | 9 | `gateway`、`remote-access`、`session-controller`、`workspace-controller` |
| `host` | 9 | `webserver`、`frontend-static`、`plugin-inventory` |
| `client` | 72 | `modules`、`locale`、`ui-*` 展示层包 |
| `credentials` | 4 | `credentials`、`credentials-local`、`authorization`、`deepseek-account` |
| `deliverables` | 3 | `deliverable-file-references`、`tool-present`、`workspace-changes` |
| `telemetry` | 1 | `otel` |

每个包组目录都带有一份拥有该组包清单的 `README.md` 及其 `README.zh.md` 对应文件；包组 README 是该组内容的规范索引。

## 包命名与目录图

方案的目录图与工作树在三处不一致。每一处都是方案给出的形式在树中不存在的路径。

| 方案的路径 | 实际路径 | 方案形式错在哪里 |
|---|---|---|
| 顶层的 `http-proxy` 包目录 | `packages/util/http-proxy` | `util` 包组拥有底层工具；不存在组级的 `http-proxy` 目录 |
| 顶层的 `filesystem` 目录 | `packages/fs/` | 文件系统能力族是 `fs` 包组；不存在组级的 `filesystem` 目录 |
| `packages/core/session` | `packages/session/` | session 数据平面自成一个包组；`packages/core/session` 是 `core` 包组内单个追加式 session 日志包 |

第三种情况若照字面执行代价最大：`packages/core/session` 确实存在，但它只是一个包——`@deepseek-ai/dsh-session`，即追加式 `SessionEvent` 日志——而不是 session 包组（`packages/core/session/package.json:2`，`packages/session/README.md:9`）。

## 依赖状态

`node_modules` 存在但不完整：`node_modules/.pnpm` 存储持有 1436 个包目录，而顶层 `node_modules` 目录只有 `.pnpm`，既没有依赖目录链接，也没有 `.bin` 条目。`pnpm exec vitest` 无法解析。

`pnpm install --offline --ignore-scripts --frozen-lockfile` 从本地存储恢复了全部链接。该命令报告 `resolved 1436, reused 1429, downloaded 0, added 1436` 并以 0 退出，因此没有包版本变化，也没有网络下载。使用 `--ignore-scripts` 是为了避开 `pnpm-workspace.yaml` 通过 `allowBuilds` 管控的安装脚本（`pnpm-workspace.yaml:31`）。再次运行同一命令报告 `Scope: all 398 workspace projects` 与 `Already up to date`，确认恢复后的树与锁文件一致。

## 约束新包的仓库规则

`packages/AGENTS.md` 要求包默认导出其服务类，或具名导出 `name`/`inject`/`Config`/`apply`；测试放在 `tests/` 而非 `src/__tests__/`；继承 `tsconfig.base.json`，设置 `rootDir: src` 与 `outDir: lib/types`；并注册到恰好一个 tsconfig 聚合中（`packages/AGENTS.md:5-6`，`packages/AGENTS.md:24-26`）。它还要求面向产品的插件具备一个 REAL-composition 测试，通过 Loader 启动 `cordis.yml`；并要求注册表贡献通过 HMR 安全测试证明其释放行为（`packages/AGENTS.md:7`，`packages/AGENTS.md:19`）。

`packages/experimental/AGENTS.md` 规定 `packages/experimental/` 下的包默认加入 dsh 发布家族：必须省略 `private` 并设置 `publishConfig.access: public`（`packages/experimental/AGENTS.md:7`）。新的实验包必须命名为不带 `experimental` 前缀的 `@deepseek-ai/dsh-<name>`，且其目录必须登记在 `scripts/experimental-package-policy.ts` 的 `EXPERIMENTAL_PACKAGE_NAME_EXCEPTIONS` 中（`packages/experimental/AGENTS.md:6`）。`scripts/check-workspace-constraints.ts` 会拒绝任何不在 `LEGACY_PREFIXED_EXPERIMENTAL_PACKAGE_DIRECTORIES` 中的目录使用带前缀的形式，而该列表不得增长（`scripts/check-workspace-constraints.ts:438-443`，`scripts/experimental-package-policy.ts:36-79`）。

根 `AGENTS.md` 禁止启动 `dsh` profile 以外的任何程序，禁止修改 Agent Loop 以绕过扩展点，并要求每个对外可见的破坏性变更立即记录在升级指南中。

## TestPilot 代码的归属

证据支持在实验组下新增一个包，命名为 `@deepseek-ai/dsh-testpilot`，并在 `EXPERIMENTAL_PACKAGE_NAME_EXCEPTIONS` 中为目录 `packages/experimental/testpilot` 登记。

对阶段 1 与阶段 2 而言，一个包已经足够。领域模型、快照注册表、定位器校验器、编排器与 worker 共用同一个存储域、同一个审批接口和同一个工具注册面；仓库自身的规则是把业务规则留在独立的包中，并通过注册面接入（`packages/AGENTS.md:14`）。把领域模型与执行引擎拆开，会在两个实验包之间增加一条依赖边，却不产生可独立消费的能力。

该包不得依赖某一个具体的浏览器提供方。浏览器提供方是 `ctx.browserUse` 注册面之后的同级实现；依赖其中某一个提供方的包，无法与其它提供方共同工作（`packages/browser-use/browser-use/README.md:34`）。

包名与登记是新目录对仓库控制文件仅有的两处新增。该包所需的其他一切——tsconfig 聚合条目、包组 README 行、locale 文件——都遵循普通的包检查清单（`docs/cookbook/adding-a-package.md:31-40`）。

## 延伸阅读

- [Profile、bundle 与 loader 审计](profile-bundle-integration-audit.zh.md) — 一个包如何成为组合层。
- [包发布审计](package-release-audit.zh.md) — 命名、发布、版本与文档义务。
- [阶段 0 验收](phase-0-acceptance.zh.md) — 本审计支撑的检查表。
