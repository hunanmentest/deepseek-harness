# TestPilot 阶段 0 — 包分类、发布与文档审计

[English](package-release-audit.md) | 中文

本审计记录一个新的 TestPilot 包在本仓库中被分类、发布、版本化与文档化所必须满足的条件。它替代此前的依赖审计，其内容已被本文吸收并扩充。

## 包分类与命名

`packages/experimental/` 下的包只有在完整公共契约均为实验性或仅内部可用时才属于此处；发布包内部的实验选项仍留在其所属的产品角色中（`packages/experimental/AGENTS.md:5`）。TestPilot 的契约整体为实验性，因此该包组是正确的归属。

| 规则 | 要求 | 证据 |
|---|---|---|
| 名称 | `@deepseek-ai/dsh-testpilot`，绝不是 `@deepseek-ai/dsh-experimental-testpilot` | `packages/experimental/AGENTS.md:6` |
| 登记 | 该目录必须出现在 `EXPERIMENTAL_PACKAGE_NAME_EXCEPTIONS` 中 | `packages/experimental/AGENTS.md:6`，`scripts/experimental-package-policy.ts:8-30` |
| 遗留前缀 | 保留带前缀名称的目录列表不得增长 | `scripts/experimental-package-policy.ts:36-79` |
| 发布 | 省略 `private`，设置 `publishConfig.access: public` | `packages/experimental/AGENTS.md:7` |
| 私有例外 | `PRIVATE_EXPERIMENTAL_PACKAGE_DIRECTORIES` 为空，因此没有实验包是私有的 | `scripts/experimental-package-policy.ts:113` |
| 标准 | 实验身份不豁免任何工程、安全、文档、生命周期、测试或快照要求 | `packages/experimental/AGENTS.md:9` |
| 晋级 | 发布不等于晋级；晋级把包移到产品角色包组，且对无前缀名称保留 npm 名称并移除登记条目 | `packages/experimental/AGENTS.md:10` |

登记是被强制执行的，而非建议。`scripts/check-workspace-constraints.ts` 拒绝遗留列表之外任何目录使用带前缀的形式，也拒绝清单名称与登记条目不一致的目录（`scripts/check-workspace-constraints.ts:433-444`）。因此新包需要在自身目录之外做两处改动：清单名称与登记条目。

## 依赖隔离

实验包组之外的发布包与应用，不得在 `dependencies`、`optionalDependencies` 或 `peerDependencies` 中具名任何实验包（`packages/experimental/AGENTS.md:8`）。该规则由默认产品隔离检查在 CI 中强制执行，覆盖传递安装、运行时导入与已发布组合（`scripts/verify-default-product-isolation.ts:112-119`，`scripts/verify-default-product-isolation.ts:156-181`，`scripts/verify-default-product-isolation.ts:182-227`）。

对 TestPilot 而言，实际后果狭窄而机械：根 `package.json` 只能把 `@deepseek-ai/dsh-testpilot` 命名为 `devDependency`，与它已经命名浏览器包的方式相同（`package.json:235-237`）。产品组合通过在某个 patch 层中按名称挂载该包来使用它，而不是依赖它。

实验包可以依赖发布包，也可以互相依赖（`packages/experimental/AGENTS.md:8`）。因此 TestPilot 依赖存储域、附件存储、工具注册表、作用域原语与浏览器注册面，而不依赖任何会把浏览器提供方拖入自身依赖图的东西。

## 依赖版本

TestPilot 所针对构建的十五个工作区包全部使用工作区版本 `0.2.2-rc.2`：

| 包 | npm 名称 | 版本 | 证据 |
|---|---|---|---|
| 工作区根 | `@deepseek-ai/dsh-root` | `0.2.2-rc.2` | `package.json:3` |
| 浏览器注册面 | `@deepseek-ai/dsh-browser-use` | `0.2.2-rc.2` | `packages/browser-use/browser-use/package.json:4` |
| 浏览器运行时 | `@deepseek-ai/dsh-experimental-browser-use-runtime` | `0.2.2-rc.2` | `packages/experimental/browser-use-runtime/package.json:4` |
| 被审计的浏览器提供方 | `@deepseek-ai/dsh-experimental-browser-use-playwright-mcp` | `0.2.2-rc.2` | `packages/experimental/browser-use-playwright-mcp/package.json:4` |
| MCP 传输与工具 | `@deepseek-ai/dsh-mcp-client` | `0.2.2-rc.2` | `packages/mcp/mcp-client/package.json:4` |
| 工具注册表 | `@deepseek-ai/dsh-tools` | `0.2.2-rc.2` | `packages/core/tools/package.json:4` |
| 作用域注册 | `@deepseek-ai/dsh-scope` | `0.2.2-rc.2` | `packages/core/scope/package.json:4` |
| agent 身份 | `@deepseek-ai/dsh-agent` | `0.2.2-rc.2` | `packages/core/agent/package.json:4` |
| 轮次生命周期 | `@deepseek-ai/dsh-agent-loop` | `0.2.2-rc.2` | `packages/core/agent-loop/package.json:4` |
| 审批接口 | `@deepseek-ai/dsh-user-approval` | `0.2.2-rc.2` | `packages/interaction/user-approval/package.json:4` |
| 工具超时策略 | `@deepseek-ai/dsh-tool-call-timeout-policy` | `0.2.2-rc.2` | `packages/guard/timeout-policy/package.json:4` |
| 文件影响策略 | `@deepseek-ai/dsh-sandbox-policy` | `0.2.2-rc.2` | `packages/sandbox/sandbox-policy/package.json:4` |
| 持久化域记录 | `@deepseek-ai/dsh-storage-domain` | `0.2.2-rc.2` | `packages/storage/storage-domain/package.json:4` |
| 持久化图像存储 | `@deepseek-ai/dsh-attachment` | `0.2.2-rc.2` | `packages/attachment/attachment/package.json:4` |
| session 派生状态 | `@deepseek-ai/dsh-session-projection` | `0.2.2-rc.2` | `packages/session/session-projection/package.json:4` |

决定浏览器契约的第三方版本：

| 包 | 版本 | 说明 | 证据 |
|---|---|---|---|
| `@playwright/mcp` | `0.0.80` | 在提供方清单中精确固定 | `packages/experimental/browser-use-playwright-mcp/package.json:36` |
| `playwright` | `1.63.0-alpha-2026-08-31` | 上游 server 自身的依赖 | `pnpm-lock.yaml:28930` |
| `playwright-core` | `1.63.0-alpha-2026-08-31` | 承载上游 CLI 与请求拦截 | `pnpm-lock.yaml:28931` |
| `@modelcontextprotocol/client` | `2.2.0` | harness 所用的 SDK | `packages/mcp/mcp-client/package.json:53` |

`@playwright/mcp` 被精确固定，且自身声明了预发布的 `playwright` 版本线，因此上游浏览器行为绑定在预发布运行时上。这正是提供方的 README 拒绝为工具 schema 提供任何稳定性承诺的原因。

该树运行时的 Node 与 pnpm 版本分别是 `v22.22.2` 与 `11.28.5`；Node 版本低于根清单声明的 `>=24.9.0`（`package.json:9`）。这一不匹配并未妨碍安装或任何基线测试，但该树并非在声明的运行时上被执行，因此阶段 1 必须在 Node 24.9 或更高版本上重跑基线，其结果才能作为发布门禁。

## TestPilot 不应新增的依赖

| 候选 | 为何不要 |
|---|---|
| `playwright` 或 `@playwright/test` | 上游 server 已经拥有该浏览器；第二份副本会产生第二个浏览器运行时和第二条需要维护的版本线 |
| 以 `@playwright/test` 作为测试运行器 | harness 的 Vitest 配置就是测试运行器；第二个运行器不在仓库的覆盖率门禁范围内 |
| 数据库驱动 | `dsh-storage` 提供 `storage-json` 与 `storage-sqlite`，域层按配置路由到它们 |
| 面向浏览器的 HTTP 客户端 | 浏览器的流量经由浏览器进程离开，而非经由 harness 客户端 |
| worker 池库 | `packages/subprocess` 已经拥有子进程执行；独立的池会造成重复 |

仓库规则是：第三方依赖必须先与既有包清单核对，未经核实的依赖不得加入。

## 使用前需先验证的候选

| 候选 | 问题 |
|---|---|
| 快照比对或定位器库 | harness 自身的工具是否已经覆盖该需求；加入包之前必须检查 `packages/util` |
| 报告库 | 报告是否就是存储域中的一组记录，那样根本不需要库 |
| 测试数据生成器 | 域模型加上存储域对阶段 2 是否已经足够 |

## 清单要求

本包组中实验包的参考清单是 `packages/experimental/browser-use-playwright-mcp/package.json`。新包沿用其形态：

| 字段 | 要求 | 证据 |
|---|---|---|
| `name` | `@deepseek-ai/dsh-testpilot` | `packages/experimental/browser-use-playwright-mcp/package.json:2` |
| `version` | 工作区版本 | `packages/experimental/browser-use-playwright-mcp/package.json:4` |
| `publishConfig` | `{ "access": "public" }`，且没有 `private` 字段 | `packages/experimental/browser-use-playwright-mcp/package.json:5-7` |
| `license` | `MIT`，与仓库许可证一致 | `packages/experimental/browser-use-playwright-mcp/package.json:33` |
| `repository` | 仓库 URL 加该包自身的 `directory` | `packages/experimental/browser-use-playwright-mcp/package.json:8-12` |
| `exports` | 带 `types` 与 `default` 的 `.`，加上 `./src/*`、`./package.json` 与 `./locale/*.json` | `packages/experimental/browser-use-playwright-mcp/package.json:16-24` |
| `files` | `locale/*.json`、`lib/index.js`、声明与映射的 glob、`lib/**/*.js.map` 以及 `src` | `packages/experimental/browser-use-playwright-mcp/package.json:25-32` |

声明为 bundle 的包还要加上 `dsh` 字段，其中 `bundle.patch` 指出它的 patch 文件（`packages/bundle/base/package.json:34-38`）。

## 文档要求

`packages/AGENTS.md:27-29` 设定了新包必须满足的三项义务：

| 义务 | 要求 | 证据 |
|---|---|---|
| README 时效 | 包 README 与 JSDoc 契约与行为在同一提交中更新 | `packages/AGENTS.md:27` |
| Model Experience | README 以规范的 Model Experience 格式记录模型、token 与 KV-cache 影响 | `packages/AGENTS.md:28` |
| Known Limitations | 持久的消费者缺口与不明显的维护者约束置于 `## Known Limitations and Deferred Work` 之下 | `packages/AGENTS.md:29` |

手册的四个步骤覆盖其余部分（`docs/cookbook/adding-a-package.md`）：

| 步骤 | 要求 | 证据 |
|---|---|---|
| 1 | 创建该包：`package.json`、`tsconfig.json`、`src/index.ts`、locale 文件与 README | `docs/cookbook/adding-a-package.md:7-23` |
| 2 | 在根配置中登记它：tsconfig 聚合条目，以及包组 README 行 | `docs/cookbook/adding-a-package.md:31-40` |
| 3 | 决定拓扑：命名真实存在的角色，并选择与之匹配的单数或复数 `ctx` 键 | `docs/cookbook/adding-a-package.md:42-50` |
| 4 | 以规范的 Model Experience 格式撰写包 README | `docs/cookbook/adding-a-package.md:74-110` |

新包恰好属于一个 tsconfig 聚合，绝不同时属于两个（`docs/cookbook/adding-a-package.md:36`），且实验包组 README 在其包表中为它保留一行（`packages/experimental/README.md:35`）。

## Locale 文件

需要出现在插件管理器中的包需要展示元数据。约定是 `locale/` 下每个已发布语言一个 JSON 文件，以 `en.json` 为发现入口，每个文件承载相同字段（`docs/cookbook/adding-a-package.md:114-141`）。

参考包携带七种语言——`en`、`zh`、`ja`、`es`、`fr`、`de`、`ru`——位于 `packages/experimental/browser-use-playwright-mcp/locale/`，每个文件都持有带 `title` 与 `description` 的 `meta` 对象。已发布语言集合在仓库中固定（`scripts/shipped-locales.ts:2`），locale 元数据检查验证某个语言中存在的每个文件都覆盖了英文或中文文件所携带的每个字段（`scripts/verify-locale-metadata.ts:17-30`）。

## 冻结的阶段 1 文件与依赖清单

阶段 1 的边界在验收文档中固定（`docs/testpilot/phase-0/phase-0-acceptance.md:95-108`）。下面的文件清单是新包为该阶段贡献的内容，并冻结在验收表所列的八项上。

| 阶段 1 项目 | 包内文件 | 依据 |
|---|---|---|
| `TestProject` 与 `TestCase` 域 | `src/domain.ts` | ADR-003 |
| 带版本、身份与 TTL 的快照注册表 | `src/snapshot-registry.ts` | ADR-005 |
| 拒绝过期引用的定位器校验器 | `src/locator-validator.ts` | ADR-005 |
| 覆盖实测 24 个工具的风险分类 | `src/risk.ts` | ADR-008 |
| 在浏览器调用之前运行的审批门禁 | `src/approval-gate.ts` | ADR-004 |
| 传给提供方的来源白名单，附重定向测试 | `src/origin-allowlist.ts` 与 `tests/origin-allowlist.spec.ts` | ADR-006 |
| attach endpoint 主机检查 | `src/attach-guard.ts` | 执行隔离审计的 attach 一节 |
| 通过附件存储保存的证据 | `src/evidence.ts` | ADR-009 |

阶段 1 可以声明的依赖，是这八项所需的那些工作区包，别无其它：`@deepseek-ai/dsh-storage-domain`、`@deepseek-ai/dsh-attachment`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-scope`、`@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-user-approval`、`@deepseek-ai/dsh-browser-use` 与 `@deepseek-ai/dsh-mcp-client`。提供方包被刻意排除：浏览器提供方是部署的选择，TestPilot 经由 `ctx.browserUse` 注册面触达它（`packages/browser-use/browser-use/README.md:34`）。

阶段 1 不新增任何第三方依赖，也不交付 worker 池、测试报告或失败分析（`docs/testpilot/phase-0/phase-0-acceptance.md:108`）。

## 延伸阅读

- [仓库审计](repository-audit.zh.md) — 工作区状态与包放置规则。
- [Profile、bundle 与 loader 审计](profile-bundle-integration-audit.zh.md) — 该包如何成为组合层。
- [阶段 0 验收](phase-0-acceptance.zh.md) — 验收表与开放的阻塞项。
