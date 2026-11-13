# TestPilot 阶段 0 — Profile、bundle 与 loader 集成审计

[English](profile-bundle-integration-audit.md) | 中文

本审计记录一个包如何成为运行中的组合：profile 目录、patch 分层、bundle 是什么、插件管理器如何处理已安装的包、loader 如何替换变更后的代码，以及哪些规则把实验能力挡在已发布产品之外。

## Profile 目录

Profile 是名为 `$DSH_HOME/profiles/<name>` 的目录，其中 home 依次由显式配置、`$DSH_HOME`、默认的 `~/.dsh` 解析而来（`packages/util/home-paths/src/index.ts:135-136`，`packages/boot/app-boot/src/profile.ts:39`，`packages/boot/app-boot/src/profile.ts:165-171`）。该目录持有两个对组合而言要紧的文件：

| 文件 | 内容 | 证据 |
|---|---|---|
| `package.json` | profile 清单，其中含 `dsh.profile.bundles`，即有序的 bundle 层列表 | `packages/boot/app-boot/src/profile.ts:5-8` |
| `cordis.patch.yml` | 用户自己的 patch 层，在每个 bundle 层之后应用 | `packages/boot/app-boot/src/profile.ts:41-42` |

该清单同时承载 profile 的树外插件依赖。bundle 列表决定存在哪些层，依赖列表决定 loader 能解析出什么。

## Patch 分层顺序

`readProfilePatches` 以固定顺序组装完整的 patch 列表，该顺序即组合契约（`packages/boot/app-boot/src/profile-context.ts:74-85`）：

| 顺序 | 层 | 来源 |
|---|---|---|
| 1 | bundle 层，按 `dsh.profile.bundles` 顺序 | `packages/boot/app-boot/src/profile-context.ts:75-76` |
| 2 | profile 自己的 `cordis.patch.yml` | `packages/boot/app-boot/src/profile-context.ts:77` |
| 3 | home 级 patch | `packages/boot/app-boot/src/profile-context.ts:78` |
| 4 | `--patch` 覆盖层 | `packages/boot/app-boot/src/profile-context.ts:79` |
| 5 | 遥测退出 patch，当组合携带遥测行时 | `packages/boot/app-boot/src/profile-context.ts:81-83` |

靠后的层获胜。一个 patch 要么替换某行的整个 `config`，要么插入新行；一行的身份是它的 `id`，因此某一层用该 id 寻址更早层留下的行。

承载这一切的根 Include 只有两个配置字段：`path` 与 `patches`（`packages/boot/app-boot/src/index.ts:790-798`）。它自身没有任何插件行。运行中 profile 里的每一个插件行都来自某个 patch 层的 `insert` 操作——`packages/bundle/base/cordis.patch.yml` 正是这样一次 insert，施加于空的 profile 根之上，`llm`、`tools`、`session`、`sandbox` 等基础行都由它而来。

## Bundle 是什么

Bundle 是一个声明了 `dsh.bundle.patch` 字段、且在运行时没有其它实质内容的 npm 包。该字段就是全部契约：它给出该 bundle 作为一层所贡献的 patch 文件，或一份有序的 patch 文件列表。

| Bundle | 声明 | 证据 |
|---|---|---|
| `dsh-base` | 一个 patch 文件，`./cordis.patch.yml` | `packages/bundle/base/package.json:34-38` |
| `dsh-web-app` | 五个 patch 文件，即 bundle patch 加四个 preset patch | `packages/bundle/web-app/package.json:49-59` |
| `dsh-sdk-minimal` | 一个 patch 文件；它是那个刻意的例外，拥有自己完整的显式树，且不施加 `dsh-base` | `packages/bundle/sdk-minimal/package.json:34-38`，`packages/bundle/sdk-minimal/cordis.patch.yml:2` |

Bundle 贡献配置行，而不是服务。它没有插件类，没有 `inject`，也没有自己的服务；它各行中具名的包才提供运行时。相应地，`dsh-base` 把这些行包作为普通依赖列出（`packages/bundle/base/package.json:39-139`）。

## 插件管理器如何处理已安装的包

`dsh plugin --profile <name> add <package>` 把包安装进 profile 目录，然后重新协调 bundle 选择（`packages/boot/plugin-manager/src/operations.ts:96-128`）。该协调区分两类已安装的包：

| 已安装的包声明 | 结果 | 证据 |
|---|---|---|
| `dsh.bundle` | 其 patch 文件被加载，其名称被追加到 `dsh.profile.bundles`——它成为一个组合层 | `packages/boot/plugin-manager/src/operations.ts:108-121` |
| 未声明 `dsh.bundle` | 它作为普通依赖被安装，管理器会警告它不是 profile 层 | `packages/boot/plugin-manager/src/operations.ts:109-112` |

这一区分正是 TestPilot 所关心的：作为依赖安装的包是可被解析的，但永不被激活。只有声明了 `dsh.bundle` 的包才贡献行。

## Loader 如何替换变更后的代码

磁盘上发生变化后，HMR 服务重新协调 profile（`packages/boot/hmr/src/index.ts:930-990`）。顺序如下：

| 步骤 | 动作 | 证据 |
|---|---|---|
| 1 | 比较已加载模块与磁盘，找出过期模块 | `packages/boot/hmr/src/index.ts:942-950` |
| 2 | 规划替换，然后 `stopPlanned` 过期清单、逐出模块、从注册表删除插件，并等待其 fiber | `packages/boot/hmr/src/index.ts:953-958`，`packages/boot/hmr/src/index.ts:879-886` |
| 3 | `recomposeProfile` 发布运行时解析，把该代施加到根 Include，并重启此前在运行的条目 | `packages/boot/hmr/src/index.ts:974`，`packages/boot/app-boot/src/index.ts:307-329` |
| 4 | 逐出本次重组合所丢弃映射之下的模块 | `packages/boot/hmr/src/index.ts:979-982` |

并非每个变更模块都能被替换。位于宿主自身静态图中的模块，或其插件不由 Loader 条目拥有的模块，会带着旧代码继续加载，并被报告为 pending（`packages/boot/hmr/src/index.ts:812-858`）。用户看到的警告会明确点名这些模块（`packages/boot/hmr/src/index.ts:401`）。

## 默认产品隔离

实验包不得出现在默认产品中：不得出现在其安装中，不得出现在其运行时导入中，也不得出现在其已发布的组合中。该规则及其理由记录在隔离说明中（[默认产品隔离](../../../.agents/notes/implemented/process/2026-09-12-default-product-experimental-isolation.zh.md)），并由 `scripts/verify-default-product-isolation.ts` 在 CI 中强制执行。

| 检查 | 遍历什么 | 证据 |
|---|---|---|
| 依赖图 | 默认产品的依赖闭包；其中任何位置出现实验包即为失败 | `scripts/verify-default-product-isolation.ts:112-119` |
| 运行时导入 | 默认产品每个源文件的运行时 import 说明符 | `scripts/verify-default-product-isolation.ts:156-181` |
| 已发布组合 | 每个已发布 bundle patch 与 preset 组合出的行 | `scripts/verify-default-product-isolation.ts:182-227` |
| bundle patch | 默认闭包中每个包的 patch 文件 | `scripts/verify-default-product-isolation.ts:301` |
| preset | 每个已发布的 agent preset patch | `scripts/verify-default-product-isolation.ts:265-267` |
| 可选 bundle | 唯一声明的例外：`OPTIONAL_BUNDLES` 中的 bundle 以关闭状态发布 | `scripts/verify-default-product-isolation.ts:84-103` |

`OPTIONAL_BUNDLES` 豁免是实验能力在不加入默认组合的前提下抵达安装的唯一途径。其每个条目都必须是 `apps/cli` 的运行时依赖，必须声明 `dsh.bundle.patch`，并且必须导出图标与 `./locale/*.json` 展示元数据（`scripts/verify-default-product-isolation.ts:89-102`）。

已发布的 profile 模板是规则的另一半。`PROFILE_TEMPLATES` 指明每个已发布 profile 叠加哪些 bundle（`packages/util/official-bundles/src/bundles.ts:10-26`），`DEFAULT_PROFILE_BUNDLES` 指明 `dsh plugin` init 为没有已发布模板的名称使用哪个 bundle（`packages/util/official-bundles/src/bundles.ts:45`）。

## TestPilot 如何在不触碰已发布默认的前提下开启

证据支持一条路径，正是隔离规则为之而建的那条：

| 步骤 | 动作 | 约束 |
|---|---|---|
| 1 | 以实验包形式发布 TestPilot，它声明带自己 patch 文件的 `dsh.bundle` | 该包不出现在任何已发布 bundle 的 `cordis.patch.yml` 中 |
| 2 | 把它排除在 `PROFILE_TEMPLATES` 与 `DEFAULT_PROFILE_BUNDLES` 之外 | 没有已发布 profile 叠加它 |
| 3 | 把它排除在 `apps/web` 模块图之外 | `apps/web/index.html:16` 加载客户端入口，隔离检查会遍历它可达的每个模块（`scripts/verify-default-product-isolation.ts:269-290`） |
| 4 | 让用户把它安装进某个 profile，安装会把它追加到该 profile 的 `dsh.profile.bundles` | profile 自己的 `cordis.patch.yml` 随后可用 id 寻址它的各行 |

结果是一种能力：在每个已发布默认中关闭，且只在请求它的那个 profile 中开启。

## 真实组合测试路径

面向产品的插件需要一个非单元的 REAL-composition 测试：通过 Loader 与 app 或进程启动一个测试专用的 `cordis.yml`，只 mock 外部服务与不确定性输入，并断言模型可见、持久化或用户可见的输出（`packages/AGENTS.md:7`，`docs/testing.md:39`）。手写的 `ctx.plugin(...)` 测试套件不满足该政策。

两个现有实验包展示了这种形态：

| 范例 | 它证明什么 | 证据 |
|---|---|---|
| `personalized-recommendations` | 一个 bundle 的各行以各自的 id 被寻址，并通过真实 Loader 与 HMR 切换共享的卡片服务与各项功能 | `packages/experimental/personalized-recommendations/tests/bundle.spec.ts:69-113` |
| `plugin-recommendations` | 一项能力经真实 Loader 与 HMR 队列启用，涵盖 normal 与 consumer-unload 两个场景 | `packages/experimental/plugin-recommendations/tests/loader-composition.spec.ts:36-124` |

两者都构建一个临时 home，写入 profile 目录，启动它，并针对活的组合断言，而不是针对桩件断言。

## 延伸阅读

- [仓库审计](repository-audit.zh.md) — 工作区状态与包放置规则。
- [包发布审计](package-release-audit.zh.md) — 新包的命名、发布与文档义务。
- [阶段 0 验收](phase-0-acceptance.zh.md) — 本审计支撑的检查表。
