# TestPilot 阶段 1 — 打包与发布

本文列出 `@deepseek-ai/dsh-testpilot` 以公开 bundle 形态发布前的门禁、载荷核对、安装与回滚、环境限制、账号移交与恢复步骤。命令取自根 `../../../package.json` 的 `scripts`，发布链的四条命令另核对 `.github/workflows/release.yml` 与 `release-publish.yml` 的实际调用形式；未在树中核实的项标注「待核实」。契约口径见 [SPEC.md](SPEC.md)，骨架与冻结契约的差异见 [CONTRACT-CHANGES.md](CONTRACT-CHANGES.md)，查监控见 [MONITORING.md](MONITORING.md)。

## 三条发布硬门禁

- **运行时**：根清单声明 `engines.node >=24.9.0`（`package.json:9`），当前开发树实测 `Node v22.22.2` 与 `pnpm 11.28.5`，`pnpm 11.28.5` 与 `packageManager`（`package.json:7`）一致。**发布门禁必须在 Node 24.9.0 或更高版本重跑，当前环境结果只能作为开发证据。**[阶段 0 测试基线](../phase-0/testing-baseline.zh.md) 把被审计树修正到 `v24.18.0` 后重跑过能力套件，那一轮结果不覆盖阶段 1 新增的包。
- **覆盖率**：`pnpm run test:coverage` 是唯一带 `--coverage` 的覆盖率门禁，CI 以 `pnpm run check:ci:coverage` 编排它（`scripts/run-gates.ts:725-759`、`.github/workflows/ci.yml:196`）。`pnpm run test` 只跑 `vitest run`，`pnpm run test:docs` 只跑 `doc-quick` 的文档门禁，两者都不产生包源码覆盖率结论。ADR-014 的断言是按文件计、包源码百分之百（[SPEC.md](SPEC.md) 第 10 节）。
- **构建顺序**：`pnpm run build:check` 必须紧跟一次最新的 `pnpm run build:artifacts`。`build:check` 的两个聚合检查 `needs: []`，只读当前已存在的声明（`scripts/build.ts:107-116`、`:79`）；在旧产物上单独运行会读到上一轮声明并给出假绿。

## 发布前门禁清单

| 顺序 | 命令（根 `package.json` 的 `scripts`） | 检查内容 | 失败定位 |
| --- | --- | --- | --- |
| 1 | `pnpm install`（前置步骤，不是 script） | 恢复锁文件固定的依赖图；离线基线用 `pnpm install --offline --ignore-scripts --frozen-lockfile` | 顶层 `node_modules/.bin` 为空时任何 `pnpm run` 都解析不到命令，按测试基线的依赖恢复一节重跑安装（[测试基线](../phase-0/testing-baseline.zh.md) 第 20-30 行） |
| 2 | `pnpm run constraints` → `tsx scripts/check-workspace-constraints.ts` | 工作区约束：实验包名例外登记、遗留前缀清单、私有字段与发布选择 | 登记条目在 `scripts/experimental-package-policy.ts:30`；拒绝信息指名目录（`scripts/check-workspace-constraints.ts:433-444`） |
| 3 | `pnpm run verify-default-product-isolation` → `tsx scripts/verify-default-product-isolation.ts` | 默认产品组合不含 TestPilot 的插件行与十二个工具 | 扫描已发布组合的有效行；命中说明某个已发布 bundle 插入了这个实验依赖 |
| 4 | `pnpm run typecheck` → `tsx scripts/build.ts --scope typecheck` | TypeScript 聚合检查（host 与 client 两面） | 输出指名 face 与项目引用 |
| 5 | `pnpm run lint` → `tsx scripts/compile-referenced-projects.ts host-contracts && npm run lint:contracts-ready` | oxlint 全树检查 | 报错带文件路径与规则 id |
| 6 | `pnpm run build:artifacts` → `tsx scripts/build.ts --scope artifacts` | 生成 lib、bundle 与 web 产物；发布链使用 `pnpm run build:artifacts --profile official`（`.github/workflows/release.yml:159`） | 先修 native addon 与 host 编译错误；这一步失败时不运行第 7 步 |
| 7 | `pnpm run build:check` → `tsx scripts/build.ts --scope check` | 对第 6 步产物做聚合检查 | 先重跑第 6 步；单独重跑本条不构成门禁 |
| 8 | `pnpm run test:coverage` → `pnpm run build:native-system && vitest run --coverage` | CI 覆盖率门禁，按文件计、包源码百分之百 | `coverage/` 被 `.gitignore` 忽略；失败输出指名未覆盖文件与行 |
| 9 | `pnpm run check:ci:coverage` → `tsx scripts/run-gates.ts ci-coverage` | CI 编排：`build:native-system`、`test:coverage` 或 `test:coverage:partitioned`、`coverage-exempt-heavy` | 叶子门禁 id 见 `scripts/run-gates.ts:725-759`，按 id 定位 |
| 10 | `pnpm run hygiene` → `tsx scripts/run-gates.ts hygiene` | 工程卫生：`publint`、`constraints`、`verify-default-product-isolation`、`verify-package-dependencies`、`verify-dsh-package-licenses`、`verify-node-next-types` 等 | 叶子门禁 id 见 `scripts/run-gates.ts:813-831`；`publint` 在带产物依赖时核对 `exports` 与 `files` |
| 11 | `pnpm run publint` → `tsx scripts/publint-all.ts` | 打包清单的 `exports`、`files`、`main`、`types` 与 `lib/` 是否一致 | 报错指名字段；缺 `lib/index.js` 先补第 6 步 |
| 12 | `pnpm run test:docs` → `tsx scripts/run-gates.ts doc-quick` | 文档快门禁，阶段 0 记录为 21 个门禁通过 | 叶子包含 `verify-md-wrap`、`verify-md-links`、`verify-doc-refs`、`verify-package-paths`、`verify-concrete-terms`、`verify-translation-pairing`（测试基线的文档门禁一节） |
| 13 | `pnpm run doc-sync` → `tsx scripts/run-gates.ts doc-sync` | 完整文档同步：`doc-typecheck`、`docs:build`、`verify-tool-catalog`、`verify-config-catalog`、`verify-md-links`、`verify-type-equiv` 等 | 叶子门禁 id 见 `scripts/run-gates.ts:834-885`；新增文档的相对链接必须能解析 |
| 14 | `pnpm run check:i18n` → `tsx scripts/run-gates.ts i18n`；`pnpm run verify-locale-metadata` → `tsx scripts/verify-locale-metadata.ts` | locale 元数据字段覆盖与已发布语言集合 | 集合在 `scripts/shipped-locales.ts:2`；缺字段或多余语言在此报错 |
| 15 | `pnpm run verify-package-meta` → `tsx scripts/verify-package-meta.ts` | 图标、locale 元数据、`exports` 资源与发布选择 | 图标是清单顶层 `icon: "./icon.svg"` 的自包含 SVG；报错指名资源路径 |
| 16 | `pnpm run verify-package-dependencies` → `tsx scripts/verify-package-dependencies.ts` | 依赖声明与冻结规则的符合性 | 「阶段 1 不新增任何第三方依赖」见 [包发布审计](../phase-0/package-release-audit.zh.md) 第 146 行；裁决 C 决定移除新增第三方依赖、组合测试改用纯文本断言（[CONTRACT-CHANGES.md](CONTRACT-CHANGES.md) 变更 5），落地由工程侧执行，发布前以本条与第 2 条的实测输出为准，不以只读观察代替门禁结论 |
| 17 | `pnpm run release:verify --family dsh` → `tsx scripts/release/verify.ts --family dsh` | 版本基线、发布顺序可表达、`private` 缺失校验；发布态校验 `GITHUB_REF` 属于 `dsh-v*` tag | `scripts/release/verify.ts:73-115`；`RELEASE_PUBLISH=true` 时才检查 tag，可显式 `--skip-tag-check` 绕过（`.github/workflows/release-publish.yml:82`） |
| 18 | `pnpm run release:pack --family dsh --out dist/npm` → `tsx scripts/release/pack.ts --family dsh --out dist/npm` | 从同一提交产出全部 tarball，记录发布顺序，逐包校验载荷与打包清单 | `scripts/release/pack.ts:29-67`；`DshFamily.validatePayload` 只对 `@deepseek-ai/dsh` 生效（`scripts/release/families.ts:396-407`），`validatePackedManifest` 校验打包清单里 `@deepseek-ai/dsh*` 依赖范围等于该成员版本（`families.ts:415-427`） |
| 19 | `pnpm run release:verify-packed-install --family dsh --from dist/npm` → `tsx scripts/release/verify-packed-install.ts` | tarball 安装后的入口可运行 | 调用形式见 `.github/workflows/release.yml:183` |
| 20 | `pnpm run release:publish --family dsh --from dist/npm` → `tsx scripts/release/publish.ts` | 按每个包与注册表比对后发布：同 integrity 跳过、异 integrity 报错 | `scripts/release/publish.ts:1-12`；发布只在 GitHub Actions 中执行（`scripts/release/verify.ts:5`），载荷拒绝不重试 |

`scripts/run-gates.ts` 不落盘报告文件，门禁结论以进程 stdout 与退出码为准；`coverage/` 是 Vitest 产物且被 `.gitignore` 忽略。发布链的第 17 至 20 步以 `--family dsh` 与 `--out dist/npm` 的形式在工作流中调用，不是 `package.json` 里不带参数的脚本别名。

## 发布载荷核对

清单字段取自 `packages/experimental/testpilot/package.json`，实测文件与目录取自本树。

| 字段 | 当前取值 | 依据 |
| --- | --- | --- |
| `name` | `@deepseek-ai/dsh-testpilot` | `package.json:2`；命名例外登记在 `scripts/experimental-package-policy.ts:30`；根 `package.json:238` 以 `devDependency` 具名它 |
| `version` | `0.2.2-rc.2` | 与根 `package.json:3` 一致；`DshFamily.verifyVersions` 要求全家族共享一个版本（`scripts/release/families.ts:364-369`）；`pnpm run release:dsh` 执行版本提升（`scripts/release/bump.ts:6-15`），tag 由人工在提交合并后创建，CI 不写仓库 |
| `private` 与 `publishConfig` | 无 `private`；`publishConfig.access: public` | `package.json:5-8`、`packages/experimental/AGENTS.md:7`；`release:verify` 的 `verifyPublishable` 拒绝 `private: true`（`scripts/release/verify.ts:44-49`） |
| `license` / `repository` | `MIT`；仓库 URL 加 `directory: packages/experimental/testpilot` | `package.json:9-13,38` |
| `exports` | `.` 带 `types` 与 `default`；`./src/*`、`./package.json`、`./cordis.patch.yml`、`./locale/*.json` | `package.json:17-26` |
| `files` | `icon.svg`、`locale/*.json`、`docs`、`lib/index.js`、`cordis.patch.yml`、`lib/types/**/*.d.ts`、`lib/types/**/*.d.ts.map`、`lib/**/*.js.map`、`src` | `package.json:27-37` |
| `icon` | `./icon.svg`，一份自包含 SVG | `package.json:5`；由 `pnpm run verify-package-meta` 校验 |
| `dsh.bundle.patch` | `./cordis.patch.yml` | `package.json:64-68`；patch 以一条 `- insert:` 行按 `id: testpilot` 挂入组合，八项 `config` 与 `src/config.ts:27-36` 的 schema 一致 |

| 载荷项 | 当前树内容 | 核对动作 |
| --- | --- | --- |
| `cordis.patch.yml` | 一条 `id: testpilot` 插入行，八项 `config` | 与 `src/config.ts:27-36` 逐项比对；`dsh --profile <name> --dump-config` 读组合后的行 |
| `locale/*.json` | `en`、`zh`、`ja`、`es`、`fr`、`de`、`ru`、`pt` 八份 | 与 `scripts/shipped-locales.ts:2` 的 `SHIPPED_LOCALE_IDS` 一致；跑 `pnpm run verify-locale-metadata` 与 `pnpm run check:i18n` |
| `icon.svg` | 546 字节自包含 SVG | `pnpm run verify-package-meta` |
| `docs/` | `DETAIL.md`、`DETAIL.zh.md` | `pnpm run verify-translation-pairing` |
| `lib/` | `lib/index.js`、类型声明与 source map | `lib/` 在 `.gitignore` 中，打包前由 `pnpm run build:artifacts` 生成；`pnpm run publint` 核对 |
| `src` 与 `tests/` | `src/` 在 `files` 白名单内，`tests/` 不在 | 发布载荷不含测试文件 |
| npm 固定发布项 | `package.json`、`README*`、`LICENSE*` | `scripts/release/bump.ts:24-25` 记录 npm 无论 `files` 都发布这三类 |

载荷里不出现 secret、临时测试数据与用户 artifact：清单没有凭据字段，[SPEC.md](SPEC.md) 第 1 节写「凭据不进模型可见内容、不进日志」，`.gitignore` 忽略 `.env`、`*.tsbuildinfo`、`coverage/`、`tmp/`、`/dist/`、`pnpm-debug.log`；`tests/` 不在 `files` 白名单。`dataDir` 为空时解析到启动进程 cwd 下的 `<cwd>/.testpilot`（`src/config.ts:39-41`），运行时记录写在 `dataDir` 的 `projects/`、`runs/`、`gates/`、`evidence/`、`audit/`、`reports/` 键空间（`src/store.ts:121-141`），不在包的 `files` 白名单内；发布前确认包目录里没有 `.testpilot/`、`*.log` 与 `.<uuid>.tmp` 残留（`src/store.ts:65`）。实际根目录从 `testpilot_status.health.dataDir` 读，见 [MONITORING.md](MONITORING.md)。

核对命令按下列顺序执行，全部来自上表或工作流：`pnpm run publint`、`pnpm run verify-package-meta`、`pnpm run check:i18n`、`pnpm run release:verify --family dsh`、`pnpm run release:pack --family dsh --out dist/npm`、`pnpm run release:verify-packed-install --family dsh --from dist/npm`。`scripts/release/pack.ts:52` 用 `pnpm --dir <directory> pack --pack-destination <destination>` 产出 tarball，`dist/npm/` 里的文件名与内容就是载荷清单；`validatePayload` 不覆盖 TestPilot 的 `files`／`exports`／`icon`／`locale`，这几项由 `publint`、`verify-package-meta`、`check:i18n` 与 `verify-packed-install` 覆盖。

**可选旁路（需用户明示授权，本树不擅自执行）**：`pnpm --dir packages/experimental/testpilot pack --dry-run`。待核实：仓库脚本与 `.github/workflows` 未调用该形式，`pnpm pack` 的 `--dry-run` 参数在 pnpm 11.28.5 下未在本树验证；[PROJECT_STATE.md](../PROJECT_STATE.md):31 把它列为下一步。未经用户明示授权不执行该命令，以 `release:pack` 产出的 `dist/npm/` tarball 清单作为载荷核对依据。

## 安装、禁用、回滚与升级

安装与验证：

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-testpilot
dsh --profile <name> --dump-config
```

`dsh plugin --profile <name> <args...>` 在 profile 目录内把 `<args...>` 转发给 pnpm，首次使用初始化 profile 并以 `@deepseek-ai/dsh-base` 作为第一个组合包（`apps/cli/reference/README.zh.md:85`、[打包与安装插件](../../user/develop/basic/publish.zh.md) 第 77-118 行）。`@deepseek-ai/dsh-testpilot` 的清单声明 `dsh.bundle.patch`，因此 `dsh plugin` 把它追加进 `dsh.profile.bundles` 并贡献一层配置；没有 `dsh.bundle` 声明的包只作为普通依赖保留，打印一次性警告，不激活任何层。层顺序是 bundle 层（按 `dsh.profile.bundles` 顺序，`@deepseek-ai/dsh-base` 在前）、profile 的 `cordis.patch.yml`、home 的 `$DSH_HOME/cordis.patch.yml`、按 argv 顺序的每个 `--patch` overlay（publish.zh.md:120-129）。后应用的层按行胜出，patch 替换目标行的整个 `config` 值，不做深度合并。`--dump-config` 打印组合后的配置树并注释每行由哪个文件提供，`--dump-default-config` 只打印组合包各层，dump 初始化缺失的 profile 文件、不求值 `!!js`、带应用参数时拒绝调用（`apps/cli/reference/README.zh.md:48-60`）。核对输出里存在 `# == @deepseek-ai/dsh-testpilot` 层与 `id: testpilot` 行，再核对八项 `config` 与 `cordis.patch.yml` 一致；启动后用 `testpilot_status` 核对 `plugin`、`configDigest`、`dataDir` 与 `storeReady`。

禁用：在 profile 的 `cordis.patch.yml` 写一条按 `id: testpilot` 寻址的覆盖行并置 `disabled: true`（[组合与 HMR](../../cordis-tutorial/06-composition-and-hmr.zh.md):16,19）。`disabled: true` 保留条目、卸载插件，改回原值后插件与等待它的插件重新加载；`disabled` 接受布尔值、null 与表达式标记（`apps/cli/reference/README.zh.md:64`）。profile 或 home 中普通 patch 的编辑经热重载生效，组合包成员变化才需要重启 profile（`apps/cli/reference/README.zh.md:99`）。若同一覆盖行还要改 `config`，必须重述该行需要的每一个键（publish.zh.md:131-134）。Plugins 页面也提供启用、禁用与重配这一行的入口（`packages/experimental/testpilot/README.zh.md:21`）。

回滚：

```sh
dsh plugin --profile <name> remove @deepseek-ai/dsh-testpilot
dsh --profile <name> --dump-config
dsh --profile <name>
```

`remove` 同时移除依赖与对应的层（publish.zh.md:118、`apps/cli/reference/README.zh.md:85`）。正在运行的 profile 保留本次启动时的组合包集合，因此回滚前先停止该 profile 的运行实例并备份 `dataDir`，回滚后必须重启该 profile。重启后用 `--dump-config` 确认 `@deepseek-ai/dsh-testpilot` 层与 `id: testpilot` 行消失；必需插件激活失败时 CLI 先输出失败插件与原始堆栈，末尾 `Full diagnostics:` 指向 `$DSH_HOME/logs/startup-<timestamp>-<uuid>.log`（`apps/cli/reference/README.zh.md:74-81`）。最后核对 `runs/` 记录数与证据引用可解析率。版本回退可用 `dsh plugin --profile <name> add @deepseek-ai/dsh-testpilot@<version>`，待核实：版本 spec 由转发给 pnpm 的 `add` 处理，`apps/cli/reference/README.zh.md` 未单独举例，执行前用 `dsh plugin --profile <name> add --help` 核对。

升级与配置兼容：`dsh plugin --profile <name> update @deepseek-ai/dsh-testpilot` 是转发的 pnpm 子命令（`apps/cli/reference/README.zh.md:85`），每次成功运行后按当前安装状态重算 `dsh.profile.bundles`，添加、移除或更新组合包后须重启 profile（`apps/cli/reference/README.zh.md:99`）。升级后用 `dsh --profile <name> --dump-config` 重看 `id: testpilot` 行；profile 覆盖行替换整份 `config`，旧覆盖行缺的新键不会被补齐，须重述整份 `config`。`policyVersion` 变更使旧策略下签发的授权失效（`packages/experimental/testpilot/README.zh.md:27`、`src/config.ts:44-52`、`src/policy.ts:83`）；`configDigest()` 覆盖 `allowedOrigins`、`policyVersion`、`approvalTtlMs`、`snapshotTtlMs`、`workerPoolSize`、`retentionDays`，不覆盖 `dataDir` 与 `metricsEnabled`，升级前后用 `testpilot_status.health.configDigest` 比对（`src/tools.ts:301`）。

format 迁移：`src/retention.ts:31-45` 定义 `RUN_RECORD_VERSION = 2` 与 `COMPATIBLE_RUN_VERSIONS = [1]`，`assertRunVersion()` 拒绝未来版本与不在兼容集合内的版本，不静默降级；`upgradeRunRecord()` 提供 v1 到 v2 的一次性步骤，只补带默认值的可选字段（`:48-75`）。`src/store.ts:103-106` 的 `parse()` 读取记录时只做 `JSON.parse`，不调用版本断言，因此阶段 1 的记录版本核对是部署维护者的手动步骤，不是自动迁移；域 spec 的 expand／migrate／contract 三步属阶段 2 双域迁移约束（[SPEC.md](SPEC.md) 第 11 节）。包 README 自认当前记录使用 `dataDir` 下的原子 JSON 存储、不是 `dsh-storage` 域，双域迁移归阶段 2（`packages/experimental/testpilot/README.zh.md:74`）。CLI 选项位置另有成文迁移：旧脚本写 `dsh plugin add <package> --profile <name>` 会因 `required option '--profile <name>' not specified` 失败，把 `--profile <name>` 移到所有 pnpm 参数之前（[升级指南](../../upgrade-guide/v0.2.1-alpha.1/plugin-option-placement/guide.zh.md):12-20）。

## 环境限制

当前开发树实测 `Node v22.22.2` 与 `pnpm 11.28.5`；`package.json:9` 声明 `>=24.9.0`，包 README 的 Known Limitations 记录同一不匹配（`packages/experimental/testpilot/README.zh.md:80`）。**发布门禁必须在 Node 24.9.0 或更高版本重跑，当前环境结果只能作为开发证据。**[阶段 0 测试基线](../phase-0/testing-baseline.zh.md) 在 `v24.18.0` 下重跑过被审计树的能力套件，并说明依赖恢复仍需在受支持的运行时下重做；那一轮记录里 `pnpm run test:coverage`、`pnpm run constraints`、`pnpm run build`、`pnpm run doc-sync` 均为 `NOT RUN`（第 156-168 行），不构成阶段 1 包的门禁证据。CI 使用 Node 24（测试基线第 151 行的 `PRIMARY_NODE_VERSION`）。

## 账号移交与恢复

发布链只在 GitHub Actions 中执行：`publishConfig.access: public` 决定公开可见，`RELEASE_PUBLISH=true` 与 `GITHUB_REF` 的 `dsh-v*` tag 驱动 `release:verify` 的发布态校验（`scripts/release/verify.ts:98-105`），`release:publish` 按每个包与注册表比对后发布（`scripts/release/publish.ts:1-12`），版本提升的提交由人工打 tag、CI 不写仓库（`scripts/release/bump.ts:14-15`）。

| 移交项 | 当前归属证据 | 接手后核对动作 |
| --- | --- | --- |
| `@deepseek-ai` 的 npm 发布凭据与自动化 token | 工作流以环境变量注入，树内不含密钥（`.gitignore` 忽略 `.env`）；具体凭据名待核实 | 在新账号下重跑 `pnpm run release:verify --family dsh` 与 `release:pack`，确认可解析到注册表 |
| 仓库写权限与 `dsh-v*` tag 创建权 | `scripts/release/bump.ts:14-15` | 由接手人创建 tag 并核对 tag 名属于家族 |
| `dist/npm/` 制品与发布顺序文件 | `scripts/release/pack.ts:20` 默认输出 `dist/npm`，`PUBLISH_ORDER_FILE` 由 `scripts/release/tarball.ts` 引入（pack.ts:17） | 保留同一提交的 tarball；重复发布同一 integrity 会跳过（`scripts/release/publish.ts:9-12`） |
| profile 与 `$DSH_HOME` 目录所有权 | `apps/cli/reference/README.zh.md:74-81` 的启动诊断日志落在 `$DSH_HOME/logs/` | 跑一次 `dsh --profile <name> --dump-config`，确认组合层与安装来源 |
| `dataDir` 记录与证据附件 | `src/config.ts:39-41`、`src/store.ts:121-141` | 按下列恢复步骤备份并核对 |

恢复步骤按 [SPEC.md](SPEC.md) 第 5 节：先停止运行中的 profile 进程，避免新写入与恢复过程交错；备份六类资产（`dataDir` 下的记录文件、证据附件、profile patch 与 Config、凭据、保留清理任务、上游 MCP server 与浏览器提供方版本）；记录版本被拒绝或证据引用大面积失效时按 `upgradeRunRecord()` 的一次性步骤重放，执行前保留备份；重启进程并等待 `store.ready()`（`src/index.ts:39`、`src/store.ts:48-51`）；最后核对 `runs/` 记录数、`reports/` 四种格式齐全与证据引用可解析率，并用 `testpilot_status` 确认 `storeReady: true` 与 `ok: true`。

| 项 | 裁定 | 依据 | 前提 |
| --- | --- | --- | --- |
| RPO | 0 | 每次写入通过唯一临时文件加 `rename` 原子落盘（`src/store.ts:61-73`），不依赖外部服务 | [假设] 单机单进程、无并发写入者；可由业务方推翻 |
| RTO | 一次进程重启加一次 `store.ready()` | `src/store.ts:48-51` 建目录、`src/index.ts:39` 等待 | 同上 |

两个进程写同一 `dataDir` 时没有跨进程锁（ADR-007:129，[SPEC.md](SPEC.md) 第 5 节引述），需自带锁或改用阶段 2 的双域后端；推翻该档会连带改部署形态与备份策略。`src/retention.ts` 只提供过期清理，本树没有自动备份脚本与恢复演练记录（待核实）；`dataDir` 的备份由部署维护者按六类资产执行，每季度至少一次真实恢复演练，演练日期写进交付说明，没有演练过的备份不算备份。

合规前置：npm 公开包本身不触发 ICP 备案。若该 bundle 随对外站点分发，域名备案、隐私政策与用户协议、网络日志留存不少于 6 个月、删除与注销入口由宿主承担。TestPilot 阶段 1 的数据留在本地 `dataDir` 的原子 JSON 文件，不跨境、不上传第三方（[SPEC.md](SPEC.md) 第 11 节），不提供 Web UI、RBAC、远程流与日志留存（`packages/experimental/testpilot/README.zh.md:79`）；这些缺口在交付时逐项告知用户，不默认发布即合规。

## 边界

阶段 1 不提供自动备份、告警规则文件、Prometheus exporter、持久化日志与跨重启审计，归属与查法见 [MONITORING.md](MONITORING.md)。`pnpm pack --dry-run` 是需用户明示授权的可选旁路，本树未执行。本文只记录当前树可读到的命令与路径，门禁结论以 Node 24.9+ 上的实际输出为准。
