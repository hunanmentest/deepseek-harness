# TestPilot 阶段 0 — 架构决策记录

[English](architecture-decisions.md) | 中文

十四条记录确定了 TestPilot 的架构。每一条都陈述背景、约束它的仓库事实、已考虑的方案、决策、被否决的方案及其理由、它承担的风险、验证方式，以及它对后续阶段意味着什么。

证据属于设计推断而非已验证事实的记录会明确说明这一点。有两条记录**处于阻塞**状态：它们指出了审计无法从仓库中解决的问题，阶段 1 必须在它所管辖的工作开始之前解决它。

## ADR-001 — 包分组与发布策略

**背景。** TestPilot 需要在工作区中有一个立足点、一个在晋级之后依然成立的名称，以及一项把它挡在已发布产品之外的发布策略。

**仓库事实。** `packages/experimental/AGENTS.md:6` 要求新的实验包命名为 `@deepseek-ai/dsh-<name>` 且不带 `experimental` 前缀，并登记到 `scripts/experimental-package-policy.ts` 的 `EXPERIMENTAL_PACKAGE_NAME_EXCEPTIONS` 中。`scripts/check-workspace-constraints.ts:433-443` 拒绝任何新目录使用带前缀的形式，并拒绝缺失的登记条目。`scripts/experimental-package-policy.ts:36-79` 处的遗留清单已经容纳两个浏览器包，且不得增长。`packages/experimental/AGENTS.md:7` 规定默认公开发布。

**可选方案。** 一个发布组包；一个带遗留前缀名称的实验包；一个不带前缀名称并登记在例外映射表中的实验包。

**采用方案。** 位于 `packages/experimental/testpilot` 的实验包，命名为 `@deepseek-ai/dsh-testpilot`，登记在例外映射表中，并公开发布。

**不采用方案。** 发布组方案，因为 TestPilot 既没有产品负责人，也还没有已发布的对外界面。遗留前缀方案，因为前缀在晋级时必须改名，而改名会破坏每一处引用该包的 import 与配置。

**风险。** 登记条目是一道硬性门禁；缺少条目会让 `pnpm run constraints` 失败。除非在晋级时给包改名，否则包名是永久的。

**验证方式。** `pnpm run constraints` 接受该新目录；`pnpm run verify-default-product-isolation` 报告已发布组合中没有实验包。

**对后续阶段的影响。** 阶段 1 创建该包。阶段 6 在平台有了明确负责人之后重新审视该分类。

## ADR-002 — Profile 与 bundle 的组装

**背景。** TestPilot 必须可安装、可切换，同时不成为已发布产品的一部分。

**仓库事实。** profile 是 harness home 下的一个目录，持有带 `dsh.profile.bundles` 的 `package.json` 以及一份 `cordis.patch.yml`（`packages/boot/app-boot/src/profile.ts:39,42`）。bundle 是一个 npm 包，其唯一内容是一份 patch 文档（`packages/bundle/base/package.json:34-38`）。根 include 只携带路径与 patch；每一行插件都来自某个 patch 层的 `insert`（`packages/boot/app-boot/src/index.ts:790-798`）。层的顺序是 bundle、profile patch、home patch、`--patch` 覆盖层、遥测（`packages/boot/app-boot/src/profile-context.ts:74-85`）。`dsh plugin --profile <name> add <package>` 只会为声明了 `dsh.bundle` 的包激活一层；普通插件作为依赖安装，永不成为一行（`packages/boot/plugin-manager/src/operations.ts:108-121`）。

**可选方案。** 承载该能力的 bundle；由已发布 bundle 挂载的普通插件；被其他包导入的库。

**采用方案。** TestPilot 以 bundle 形式发布，带一份插入自身插件行的 `cordis.patch.yml`，并且永不由已发布的 bundle 插入。用户通过把它的 bundle 加入某个 profile 的 `dsh.profile.bundles`，或通过 `dsh plugin --profile <name> add @deepseek-ai/dsh-testpilot` 来启用它。

**不采用方案。** 从已发布 bundle 挂载 TestPilot，因为 `scripts/verify-default-product-isolation.ts:182-227` 会扫描已发布组合的有效行，并因此拒绝这个实验依赖。库方案，因为库没有插件界面，无法被挂载。

**风险。** 一个 bundle 需要自己的 `locale/*.json` 才能被插件管理器提供，还需要自己的图标。HMR 通过释放旧条目并重启新条目来替换 bundle（`packages/boot/hmr/src/index.ts:930-990`），因此由 TestPilot 挂载的浏览器提供方必须能在那次替换中存活。

**验证方式。** REAL-composition 测试通过 Loader 启动一个 profile，并断言浏览器工具默认不存在、在启用该 bundle 后存在。

**对后续阶段的影响。** 阶段 1 交付该 bundle 及其组合测试。阶段 6 可以在平台发布之后把该 bundle 加入 `OPTIONAL_BUNDLES`。

## ADR-003 — 浏览器提供方与浏览器适配器边界

**背景。** 存在三个浏览器提供方。TestPilot 必须与三者都能工作，且不得分叉浏览器栈。

**仓库事实。** `packages/browser-use/browser-use/src/index.ts:35-45` 中的 `BrowserUseRegistry` 只持有一个提供方槽位，并拒绝第二次注册。`packages/experimental/browser-use-runtime/src/index.ts:60-197` 中的 `SessionResources` 以实时 agent 为键确定所有权、按 agent 串行化操作，并在释放时关闭资源。`packages/experimental/browser-use-runtime/src/mcp.ts:102-220` 中的 `mountSessionMcp` 在串行的 `agent/created` 期间执行发现，并强制浏览器工具归属于调用方 session。Playwright 提供方传入 `--browser chromium --isolated`（`packages/experimental/browser-use-playwright-mcp/src/index.ts:35-42`）；Chrome DevTools 提供方传入 `--no-usage-statistics` 与 `--isolated`（`packages/experimental/browser-use-chrome-devtools-mcp/src/index.ts:28-36`）；Stagehand 提供方构建自己的原生运行时与自己的工具定义（`packages/experimental/browser-use-stagehand-native/src/index.ts:24-70`）。

**可选方案。** TestPilot 注册自己的浏览器提供方；TestPilot 驱动部署所挂载的任一提供方；TestPilot 重新实现浏览器控制。

**采用方案。** TestPilot 驱动部署所挂载的任一提供方，通过 `ctx.browserUse` 注册面与工具注册表进行。它不定义任何浏览器对象，也不定义任何浏览器操作。

**不采用方案。** 注册自己的提供方，因为注册表只持有一个槽位，而 TestPilot 会挤掉部署的提供方。重新实现浏览器控制，因为一个进程内的两个浏览器资源管理器会各自持有一个浏览器，谁也无法推断对方的生命周期。

**风险。** 三个提供方暴露不同的工具集，因此某项能力在一个提供方存在而在另一个缺失时必须被检测出来，而不能假定。Stagehand 的提供方需要自己的模型配置，并且完全不使用 MCP 工具桥。

**验证方式。** 一个测试断言 TestPilot 的工具能针对组合所挂载的提供方解析，另一个测试覆盖所需能力缺失的情形。

**对后续阶段的影响。** 阶段 1 必须把每一项浏览器需求表达为能力检查，而不是工具名。

## ADR-004 — MCP 工具与确定性执行

**背景。** 计划把探索式浏览与确定性执行分开。审计测量了实际的上游接口面。

**仓库事实。** 固定版本的上游 server 通告了 24 个工具，其中 16 个带有 `readOnlyHint: false`，还有一个是任意代码执行；该测量记录在 [MCP 契约审计](mcp-contract-audit.zh.md) 中。上游为每个工具发布一个风险标签，而 `packages/mcp/mcp-client/src/tools.ts` 不读取它，因此该标签永远到不了 harness 注册表。该桥接以 `mcp__<serverName>__<rawName>` 注册工具并归一化结果（`packages/mcp/mcp-client/src/tools.ts:91-97`）。

**可选方案。** 确定性用例直接调用 MCP 工具；确定性用例使用 TestPilot 自有的执行约定；harness 把上游标注向前传递。

**采用方案。** 探索式浏览使用 MCP 工具。确定性执行使用 TestPilot 自有的约定，它有自己的输入、断言、超时、重试与结果。风险分类读取工具参数，而上游的逐工具标签在无需改动共享约定即可获得的地方被记录下来。

**不采用方案。** 在确定性用例中调用 MCP 工具，因为 24 个工具中有 16 个会改变远端状态，而上游所有者不承诺 schema 稳定，因此记录下来的用例既不可复现，也不适合重放。给 `packages/core/tools` 的 `ToolDefinition` 增加字段，因为那是一次公共约定变更，需要升级指南、类型确认，以及对每一个消费者的更新，而且参数本身已经承载了动作的实际目标。

**风险。** 点名上游工具的测试计划会继承它们的不稳定性。上游标签只在提供方暴露它的地方可得，因此分类必须有基于参数的兜底。

**验证方式。** 阶段 1 增加一个测试，验证确定性用例记录下它的输入与断言结果，并验证上游工具消失时该用例在验证阶段失败而不是静默通过。

**对后续阶段的影响。** 阶段 2 定义执行约定。阶段 3 在该约定中生成用例，因此约定必须在生成开始之前就已存在。

## ADR-005 — Agent、session、测试运行与 worker 的生命周期

**背景。** 计划指出一次测试运行不是一个 session。审计确认了这一点，并发现 worker 问题是那个尚未解决的问题。

**仓库事实。** agent 创建会运行一个 setup 回调、发布一次 commit，然后才宣告该 agent；setup 失败会回滚作用域（`packages/core/agent/src/index.ts:100-140`）。`agent/created` 是串行事件（`packages/core/agent/src/index.ts:564`）。session 日志是一个仅追加的事件日志，模型历史由它派生（`packages/session/session-persistence/src/index.ts:124-143`）。审批服务会拒绝没有开启轮次的 session 所发起的请求（`packages/interaction/user-approval/src/index.ts:244-250`），而开启的轮次只存在于 `turn/start` 与 `turn/end` 之间。

**可选方案。** 测试运行是一个 session；测试运行是一条域记录；worker 是一个 agent；worker 是一个子进程。

**采用方案。** 测试运行是一条域记录，它比启动它的 agent 活得更久。worker 是一个受管子进程，既不是 agent，也不是 subagent。

**不采用方案。** 把测试运行当作 session，因为 session 日志是一份带轮次范围审批模型的对话记录，而测试运行需要在它的 agent 之后存活，并且要能跨运行被查询。把 worker 当作 subagent，因为 `packages/subagent/subagent/src/index.ts:275-277` 要求存在一个精确的实时父 agent，而 `packages/subagent/subagent/src/activation.ts:23-34` 在池满时直接拒绝而不是排队。

**风险。** 没有 agent 的 worker 没有轮次，因此无法请求审批。这一点被记录为 ADR-011 中的阻塞项，并在那里解决，而不是在这里。

**验证方式。** 一个测试断言测试运行在启动它的 agent 被释放后依然存活，并且仍可被查询。

**对后续阶段的影响。** 阶段 2 基于 `ctx.subprocess` 构建 worker，且不得假定存在 agent。

## ADR-006 — 对 jobs、workflow 与 PTC 的复用

**背景。** 仓库有四个后台设施。TestPilot 的确定性执行需要其中之一。

**仓库事实。** Jobs 是一个带有限输出环的注册表；一个归属 job 需要一个实时 agent 和一个已挂载的 controller（`packages/jobs/jobs-local/src/index.ts:216-221,372-383`），它的状态机有五个状态。Workflow 在一个 PTC 进程内运行脚本，每一步都是一个 subagent（`packages/workflow/workflow-ptc/src/host.ts:200-227`）；失败的子步骤被归约为 `null`，而不是让整次运行失败（`packages/workflow/workflow-ptc/src/runtime.ts:207-222`）。PTC 在一个独立进程中运行程序（`packages/ptc-runtime/ptc-runtime-node/src/index.ts:28`），并把该程序视为敌意对等者（`packages/ptc-runtime/ptc-runtime/src/index.ts:102-108`）；它的失败种类是已解析结果上的一个字段（`packages/ptc-runtime/ptc-runtime/src/types.ts:157-181`）。`ctx.subprocess` 是唯一一个其 `terminate()` 与 `waitForExit()` 观察同一受管范围的接缝（`packages/subprocess/subprocess/src/types.ts:187,195`）。

**可选方案。** 复用 PTC；复用 Jobs；复用 Workflow；复用 `ctx.subprocess` 并自行拥有生命周期。

**采用方案。** TestPilot 自己拥有测试执行的生命周期，并以 `ctx.subprocess` 作为它的进程原语。它不把 PTC、Jobs 或 Workflow 的任何部分当作生命周期管理器。

**不采用方案。** PTC，因为它执行的是模型编写的程序，它的结果形态是为模型自我纠错而设计的，而且它拒绝同一个 state owner 的并发运行。Jobs，因为归属 job 强制要求一个实时 agent，而它的五状态机无法表达逐用例的结果。Workflow，因为它的步骤失败被归约为 `null`，而测试失败必须保持可区分。

**风险。** 在没有原生受管范围的平台上，containment 会退化，存活的后代进程不保证被终止（`packages/subprocess/subprocess-local/src/index.ts:273-290`）。TestPilot 必须说明这一限制。

**验证方式。** 阶段 2 增加一个测试，验证崩溃的 worker 被回收且其资源被释放，并验证 containment 模式是被报告出来的而不是被假定的。

**对后续阶段的影响。** 阶段 2 基于这一决策实现 worker 池。阶段 4 的探索复用同一条 worker 边界。

## ADR-007 — 数据持久化与迁移

**背景。** TestPilot 存储项目、计划、用例、运行与结果。审计考察了仓库提供了什么。

**仓库事实。** `dsh-storage` 是一个把名称路由到后端的 hub（`packages/storage/storage/src/registry.ts:9-12`）；`dsh-storage-domain` 用 zod 声明记录 schema，并在一条单一写入链之后维护权威的内存状态，该链先持久化再修改内存，然后发出变更（`packages/storage/storage-domain/src/domain.ts:1-9`）。域 spec 带一个版本和一组兼容版本（`packages/storage/storage-domain/src/spec.ts:39,56`），但记录不带版本，也没有值迁移运行器（`docs/subsystems/storage.md:108,110`）。JSON 后端存储文件并原子地发布它们（`packages/storage/storage-json/src/atomic.ts:24-40`）；SQLite 后端使用内置的 `node:sqlite` 驱动，并在一个事务中连同其版本戳一起提交数据（`packages/storage/storage-sqlite/src/unit.ts:147-159`），而它的物理 schema 版本只会被拒绝，从不被迁移（`packages/storage/storage-sqlite/src/schema.ts:18,55`）。存储层与附件层都没有保留机制（`packages/storage/storage/src/backend.ts:88-168`）。

**可选方案。** session 事件；一个存储域；一个独立数据库。

**采用方案。** TestPilot 的记录存放在一个 `dsh-storage` 域中。项目、计划与用例记录共用一个域；运行与结果记录使用第二个域并采用逐记录布局，因为该布局在一次写入时从不重写该单元的其余部分（`packages/storage/storage/src/backend.ts:56-64`）。schema 演进遵循仓库的两个先例：优先使用带默认值的可选字段；当含义变化时，提升版本并把旧的版本戳保留在兼容集合中（`packages/schedule/schedule/src/storage.ts:62-66`，`packages/workspace/workspace/src/spec.ts:57-65`）。不兼容的变更自带一次性升级步骤，因为存储层不提供任何升级。

**不采用方案。** session 事件，因为该日志是一份带轮次范围模型的对话记录，并被当作模型历史重放。独立数据库，因为仓库已经发布了带持久写入链的域层，第二个存储只会重复它。

**风险。** 存储没有跨进程锁，因此两个进程写入同一个域必须自带锁。存储层没有保留机制，因此 TestPilot 必须自己建一个。

**验证方式。** 阶段 2 写入一次运行，关闭该域，重新打开它，并断言该记录及其版本戳依然存在；第二个测试断言不兼容的变更在其升级步骤运行之前会被拒绝。

**对后续阶段的影响。** 阶段 2 实现该域。阶段 5 把失败分析写入同一个域。阶段 6 需要本记录推迟到阶段 2 的保留策略。

## ADR-008 — 测试项目的归属

**背景。** 一个测试项目必须归属于某个东西，而且两个项目不能看到彼此。

**仓库事实。** workspace 是某个已存在目录的稳定身份；它的标识符是随机标识符，它的路径是规范化的，且创建之后从不被改写（`packages/workspace/workspace/src/types.ts:16,73-78`）。唯一性由规范路径相等决定（`packages/workspace/workspace/src/paths.ts:39-51`）。session 成员关系通过比较 session 的 realpath 与 workspace 路径来检查（`packages/workspace/workspace/src/entity.ts:110-150`），并且在启动时强制一条单一所有者不变式：一个路径只属于一个 workspace，一个 session 只由一个 workspace 记账（`packages/workspace/workspace/src/index.ts:766-807`）。远程访问决策按方法、按资源作出，网关在解析资源之前就决定访问，因此被拒绝的调用不会激活任何东西（`packages/api/gateway/src/index.ts:802-826`）。

**可选方案。** 测试项目是一个 workspace；测试项目是一条带 workspace 引用的独立顶层记录；测试项目是一个 session。

**采用方案。** 测试项目是一条独立的域记录，它携带一个 workspace 标识符，且它的目录必须是该 workspace 规范路径的后代。一次运行属于一个项目。

**不采用方案。** 把测试项目当作 workspace，因为 workspace 是目录身份，而项目还携带一个 base URL、一份测试策略和一份用例清单。把项目放进 workspace 的 session 列表，因为该列表是一份 session 账本，其成员规则读取 session 头的 working directory，而它的单一所有者不变式会被非 session 成员破坏。

**风险。** 目录移出其 workspace 的项目无法通过路径校验。匿名安装身份是一个分析标识符，不构成所有权边界（`packages/identity/anonymous-user-id/src/index.ts:5-9`）。

**验证方式。** 阶段 1 增加一个测试，验证位于其 workspace 之外的项目被拒绝，并验证缺少该项目资源策略的远程调用者在记录被加载之前就被拒绝。

**对后续阶段的影响。** 阶段 1 定义项目记录。阶段 6 在其上增加权限与审计界面。

## ADR-009 — Web 宿主、客户端与远程 API

**背景。** web 平台需要一种展示进度并在页面刷新后存活的方式。

**仓库事实。** 宿主 HTTP 服务是一个路由登记器，没有文件服务，也没有业务逻辑（`packages/host/webserver/src/index.ts:5-6`）；通配绑定地址在加载时就被拒绝（`packages/host/webserver/src/index.ts:96-107`）。网关有两个平面：走连接 `/api` 路由的一元调用，以及走它自己的 `/api/remote.mux` WebSocket mux 上的流式传输（`packages/api/gateway/src/index.ts:248-254,255-324`）。仓库没有 SSE 客户端路径；该内容类型唯一出现的地方是一处压缩排除（`packages/host/webserver/src/index.ts:248`）。follow 流把当前的完整快照作为每个连接的首帧发送，然后发送增量，而带游标的流从绝对偏移处恢复（`packages/api/job-controller/src/observe.ts:47-70`）。客户端侧的投影存储位于内存中，刷新即丢失（`packages/api/session-controller/src/client/sessions/projection-store.ts:92-97`）。远程方法类型由宿主模型生成并合并进客户端类型映射，客户端贡献在挂载时会被拒绝，除非每个字段都有严格 codec（`packages/api/gateway/src/client/index.ts:302,803-818`）。

**可选方案。** SSE；轮询；在现有多路复用之上的远程流；一个独立的 web 应用。

**采用方案。** TestPilot 把它的运行状态作为现有 mux 之上的远程流暴露出来，遵循 job 与 workspace controller 的既有模式，并且它是承载该能力的同一个包中的一个客户端模块，而不是一个独立应用。运行记录是一条域记录，因此刷新会重新打开该流并把当前状态作为基线接收。

**不采用方案。** SSE，因为客户端路径不存在，而且 mux 已经提供了重连与快照语义。轮询，因为它在刷新之后无法及时给出基线。独立的 web 应用，因为浏览器模块图由宿主组合，一个独立前端无法进入其中。

**风险。** 没有生成的严格定义的远程端点会退回到一条源码标记路径，而该路径无法恢复被擦除的对象约束（`packages/api/gateway/src/index.ts:401-416`）。

**验证方式。** 阶段 6 增加一个测试，验证重连的客户端不出现空隙地接收到当前运行状态，并验证缺少严格 codec 的贡献被拒绝。

**对后续阶段的影响。** 阶段 1 设计该域，使后续的流能够承载它。阶段 6 实现客户端模块与远程命名空间。

## ADR-010 — 浏览器网络出口与 worker 隔离

**背景。** 计划要求一份域名白名单，并声明浏览器不得触达非预期主机。审计定位了强制点及其边界。

**仓库事实。** 固定版本的上游 server 通过浏览器上下文的请求拦截实现来源选项，注册一条兜底的中止路由，然后重新注册允许的来源以继续。同一个上游的命令行帮助声明该选项不构成安全边界，也不影响重定向。提供方两个选项都没有传（`packages/experimental/browser-use-playwright-mcp/src/index.ts:35-42`）。仓库不含私有地址或云元数据地址的防护。被清理过的子进程环境移除了形似凭据的名称与带 harness 前缀的名称，但不限制子进程可以触达的地址（`packages/subprocess/subprocess/src/index.ts:54,73-87`）。

**可选方案。** 依赖上游的来源选项；在浏览器前加一个出口代理；依赖上游选项加上逐次操作的检查；接受宿主的可达范围。

**采用方案。** TestPilot 通过提供方为按项目的白名单传入来源选项，并把它当作一层防护。它还会在派发浏览器调用之前检查导航的目标。在有测试展示跨越白名单的重定向会发生什么之前，它不把该白名单描述为安全边界。

**不采用方案。** 只依赖上游选项，因为它自己的文档同时免除了边界主张与重定向覆盖。出口代理，因为浏览器自身的流量必须经由它路由，而那是本阶段无法验证的部署关注点。

**风险。** 跨越白名单的重定向仍可能被跟随。上游的来源选项是在浏览器上下文中实现的，因此从未到达该上下文的请求不在其覆盖范围内。

**验证方式。** 阶段 1 增加一个测试，导航到一个允许的来源，跟随一次到不允许来源的重定向，并记录观察到的行为；该结果成为成文的边界。

**对后续阶段的影响。** 阶段 1 实现该白名单与重定向测试。阶段 4 的探索继承同一策略，且不得放宽它。

## ADR-011 — 审批、凭据与高风险操作

**背景。** 一个有风险的动作必须在发生之前获得批准，而测试必须能在不泄漏凭据的前提下使用凭据。

**仓库事实。** 审批服务会拒绝没有开启轮次的 session 所发起的请求，且这一拒绝发生在追加任何内容之前（`packages/interaction/user-approval/src/index.ts:244-250`），并且只有 `allowed-once` 才授予执行权（`packages/interaction/user-approval/src/types.ts:32`）。`never` 策略在服务内部决定，因此无论注册顺序如何都成立（`packages/interaction/user-approval/src/index.ts:296-301`）。凭据存在于两个键空间，本地提供方在文件权限防护下以明文存储它们且没有加密（`packages/credentials/credentials-local/src/index.ts:61,451,717`）；凭据引用形式在运行时解析，而模板化形式只为 MCP 传输字符串实现（`packages/mcp/mcp-client/src/credentials.ts:83-94`）。MCP 脱敏覆盖错误诊断与失败的结果文本，但不覆盖成功的结果（`packages/mcp/mcp-client/src/tools.ts:159-163`）。仓库的高风险先例是沙箱模式与审批策略的组合预设（`packages/interaction/permission-presets/src/index.ts:182-191`）以及按风险分级的评审闸门（`packages/experimental/auto-review/src/index.ts:67-69`）；不存在把某个工具标记为有风险的声明式注册表（`packages/core/tools/src/contracts.ts:375-379`）。

**可选方案。** 在 agent 的轮次内批准；在整次运行开始前批准整次运行；让 worker 通过一个 session 发起询问。

**采用方案。** **阻塞。** 审计确定了调用链，但没有确定后台 worker 走的是哪一条分支。

三种设计各有代价。在 agent 的轮次内批准原样复用既有的接缝，但把风险闸门与 loop 的轮次耦合起来。在整次运行开始前批准整次运行需要一个带过期时间的自有授权记录。给 worker 一个带轮次语义的 session，等于赋予一个后台进程一个它本来并不需要的概念。

阶段 1 必须记录它采用哪一种设计，并连同「一次批准永不授予永久授权」这条规则一起记录，而且在此之前不得实现 worker。审批检查本身运行在工具执行路径中、在浏览器调用之前，因为那条路径正是一个抛出异常的监听器阻止派发的地方（`packages/core/tools/src/pipeline.ts:307`）。

**不采用方案。** worker 直接调用审批服务，因为轮次前置条件会在任何应答者被咨询之前就拒绝它。

**风险。** 凭据在静态存储中是明文，因此「未持久化」只对模型可见与 session 可见的界面成立。一个把密码注入浏览器表单的测试需要一条不经过模型可见内容的凭据路径，而仓库在 MCP 之外不提供这样的路径。

**验证方式。** 阶段 1 增加一个测试，验证没有可用批准时高风险的浏览器调用被拒绝、拒绝发生在派发之前，并验证审计对被写入。

**对后续阶段的影响。** 阶段 2 为其 worker 继承审批上下文。阶段 5 只读取证据，从不需要批准。

## ADR-012 — 证据、附件与报告的生命周期

**背景。** 一个测试结果携带证据。证据必须被存储、被引用，并最终被丢弃。

**仓库事实。** 图像附件按内容寻址，带有四种类型的媒体白名单以及字节数、数量与像素上限（`packages/attachment/attachment/src/types.ts:8,73-82`；`packages/attachment/attachment-local/src/index.ts:33-46`）；文件附件按摘要内容寻址，自身不带接纳上限（`packages/attachment/attachment/src/index.ts:208-222`）。MCP 桥接已经把图像结果投影为附件引用，使模型看到的是引用而不是字节（`packages/mcp/mcp-client/src/tools.ts:333-338`）。交付物工具记录一条路径和一段描述，不复制任何内容（`packages/deliverables/tool-present/src/index.ts:53,106-108`）。workspace-changes 摘要只存活到 session 被释放为止（`packages/deliverables/workspace-changes/src/index.ts:9,154`）。仓库没有报告、trace 或视频设施。

**可选方案。** 把证据存在域里；把证据存为附件；把证据存在 session 日志里；生成一份报告文档。

**采用方案。** 结构化证据，也就是运行、用例、断言与结果，存放在域里。二进制证据，也就是截图、trace 与视频，存放在附件存储中，并从域里被引用。报告是附件存储中的一个文件，由客户端渲染，并解析其中的引用。

**不采用方案。** 把二进制证据放进域里，因为域的值是不透明的 JSON，而 JSON 后端在一次写入时重写整个文件，因此内嵌的图像会让每次写入都重写整条记录。把证据放进 session 日志，因为 session 日志是模型可见的对话历史。在运行时把报告生成进 session，因为 workspace-changes 的先例表明 session 作用域的产物会随 session 一起消失。

**风险。** 附件层对文件附件不施加任何限制，因此 TestPilot 必须自定配额。两层都没有保留机制，因此 TestPilot 必须自己建一个，并决定一条域记录及其附件如何被一并丢弃。

**验证方式。** 阶段 2 存储一条带证据引用的结果，关闭并重新打开该域，并断言该引用仍能解析到已存储的内容。

**对后续阶段的影响。** 阶段 5 读取证据以做失败分析。阶段 6 增加保留策略。

## ADR-013 — 并发、取消、恢复与回收

**背景。** 一次测试运行持有浏览器、进程与记录。每一个都必须被释放。

**仓库事实。** 浏览器运行时按 agent 串行化操作，并把调用方的取消与所有者的 controller 合并，在等待操作尾部之前先关闭资源，从而让一次传输层关闭能够中断没有 abort 支持的工作（`packages/experimental/browser-use-runtime/src/index.ts:107-132,185-195`）。关闭失败会保留所有权而不是释放它（`packages/experimental/browser-use-runtime/src/index.ts:323`）。子进程接缝让终止具备幂等性，并让退出等待整个受管范围（`packages/subprocess/subprocess/src/types.ts:187,195`），而本地实现会在宽限期之后从礼貌信号升级为强制终止（`packages/subprocess/subprocess-local/src/spawn.ts:360-376`）。存储域按域串行化写入，并在介质状态变得未知时把自己隔离（`packages/storage/storage-domain/src/domain.ts:283-309`）。

**可选方案。** 串行执行所有测试用例；在有界池中并行运行用例；不设上界地运行用例。

**采用方案。** 测试用例在一个大小由配置决定的有界池中并行运行。一个用例拥有自己的浏览器资源与自己的 worker 进程，二者在该用例结算时释放。未在预算内结算的 worker 会被终止，并等待其范围。失败的用例绝不留下资源，而关闭失败会保留所有权并让运行失败，而不是静默泄漏。

**不采用方案。** 串行执行，因为那会让一个套件的时长等于其最慢用例之积。不设上界的并行，因为每个用例都持有一个浏览器和一个进程，而仓库自身的浏览器运行时没有按部署的并发上限。

**风险。** 取消无法撤销已经投递给浏览器的动作，因此被取消的用例可能让远端系统保持已更改的状态。在没有原生受管范围的平台上，存活的后代进程不保证被终止。

**验证方式。** 阶段 2 增加一个测试，验证被取消的用例释放其浏览器与 worker、崩溃的 worker 被回收，以及关闭失败会让运行失败。

**对后续阶段的影响。** 阶段 4 的探索使用同一个池。阶段 6 报告池饱和，而不是无界排队。

## ADR-014 — 测试、持续集成与质量门禁

**背景。** 仓库把测试证据当作发布门禁，而新包必须满足它。

**仓库事实。** 覆盖率门禁按文件计，在包源码上要求百分之百（`package.json` 把 `test:coverage` 声明为覆盖率命令）。面向产品的插件需要一个非单元的组合测试，通过 loader 启动一份配置文件（`packages/AGENTS.md:7`；`docs/testing.md:39`），而现存最强的例子是 `packages/experimental/personalized-recommendations/tests/bundle.spec.ts`。注册表贡献必须通过热重载安全测试证明其释放行为（`packages/AGENTS.md:19`）。文档门禁以聚合方式运行（`package.json` 声明了 `test:docs` 与 `doc-sync`）。

**可选方案。** 只有单元测试；单元测试加一个组合测试；单元测试加一个组合测试加一个真实浏览器测试。

**采用方案。** TestPilot 为自己的逻辑发布单元测试，一个通过 loader 启动 profile 并断言默认关闭行为的组合测试，一个操作真实浏览器的真实浏览器测试，以及为每一项注册表贡献准备的释放测试。现有能力的基线记录在 [测试基线](testing-baseline.zh.md) 中。

**不采用方案。** 只有单元测试，因为它们无法展示插件在真实组合中正确激活，也无法展示它留在已发布的默认组合之外。只有真实浏览器测试，因为它很慢，且无法隔离某个具体失败。

**风险。** 组合测试不得依赖网络凭据或真实提供方。真实浏览器测试需要浏览器安装，因此在没有安装时必须干净地跳过，就像上游的浏览器套件那样。

**验证方式。** 在宣称该阶段完成之前，该包自身的门禁先运行，而且真实浏览器测试至少在将要承载它的环境中被执行一次。

**对后续阶段的影响。** 每个后续阶段都把自己的测试加入同一套门禁。阶段 6 增加端到端套件。

## 尚未解决的问题

| 问题 | 为何仍未解决 | 归属 |
|---|---|---|
| 后台 worker 如何获得审批上下文 | 审批接缝要求一个开启的轮次，而 worker 没有 | 阶段 1，ADR-011 |
| 跨越允许来源的重定向会发生什么 | 上游所有者声明来源选项不影响重定向 | 阶段 1，ADR-010 |
| harness 是否承载上游的逐工具风险标签 | 取决于在核心工具包中做共享约定变更的代价 | 阶段 1，ADR-004 |
| 哪个存储后端服务测试域 | 域层按配置路由，而且两个后端都已发布 | 阶段 2，ADR-007 |
| 结果及其证据的保留策略 | 存储层与附件层都不提供 | 阶段 2，ADR-012 |

## 延伸阅读

- [阶段 0 验收](phase-0-acceptance.zh.md) —— 哪些记录阻塞阶段 1。
- [执行隔离审计](execution-isolation-audit.zh.md) —— ADR-006、ADR-010 与 ADR-013 背后的证据。
- [审批与凭据审计](approval-security-audit.zh.md) —— ADR-011 背后的证据。
