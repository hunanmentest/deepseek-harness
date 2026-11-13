# TestPilot 阶段 1 — 冻结技术契约

本文冻结阶段 1 的包形态、配置、存储、源文件、模型可见工具、可观测性、报告、门禁、保留与升级，以及 ADR-010 的重定向边界。[ADR-011-resolution.md](ADR-011-resolution.md) 解除了阶段 0 的审批阻塞，本契约承接它的授权记录与校验规则。阶段 1 的交付边界由 [阶段 0 验收](../phase-0/phase-0-acceptance.zh.md#阶段-1-边界) 给定，八个源文件由 [包发布审计](../phase-0/package-release-audit.zh.md#冻结的阶段-1-文件与依赖清单) 冻结。裁决 C 之后实现口径以已落地的骨架为准，变更及理由登记在 [CONTRACT-CHANGES.md](CONTRACT-CHANGES.md)，本契约随之修正措辞。

## 1. 约束

| 类别 | 数字与边界 | 证据 |
|---|---|---|
| 规模 | 上游 server 实测通告 24 个工具，其中 7 个只读、16 个改变远端状态、1 个任意代码执行；TestPilot 模型可见工具 12 个，按方案 12.1 的 8–12 上限收敛；一次运行携带一份参数摘要；证据配额属阶段 2 候选 | 已核实：`mcp-contract-audit.zh.md:9,16,60`、`packages/experimental/testpilot/src/tools.ts:45-308` |
| 延迟 | `approvalTtlMs` 默认 900000 毫秒，`snapshotTtlMs` 默认 300000 毫秒；派发前检查不引入额外网络往返；远程流沿用 mux 的「首帧完整快照 + 增量」语义 | 已核实：`architecture-decisions.zh.md:157`（ADR-009）、`packages/experimental/testpilot/src/config.ts:31-32` |
| 成本 | 不新增第三方依赖，不新增浏览器运行时副本，不新增测试运行器，不新增数据库驱动；阶段 1 存储落在 `dataDir` 下的原子 JSON 文件，不接线 `dsh-storage` 后端 | 已核实：`package-release-audit.zh.md:66-76,146`、`packages/experimental/testpilot/src/store.ts:44-88` |
| 合规 | 采集字段逐项说明必要性；凭据不进模型可见内容、不进日志；数据留在本地 `dataDir` 的原子 JSON 文件，二进制证据只以 `EvidenceLink` 引用，不跨境、不上传第三方；删除链路可追 | 设计推断，依据已核实的归属与附件边界：`architecture-decisions.zh.md:139-151`（ADR-008）、`:213-229`（ADR-012） |
| 团队能力 | 沿用 cordis、schemastery、Vitest、tsdown 与 `pnpm run doc-sync`；Node 24.9.0 或更高版本上重跑基线才作为发布门禁 | 已核实：`adding-a-package.md:163-172`、`package-release-audit.zh.md:64` |

## 2. 包名与 bundle 形态

包名为 `@deepseek-ai/dsh-testpilot`，位于 `packages/experimental/testpilot`，版本随工作区 `0.2.2-rc.2`，`publishConfig.access` 为 `public` 且不带 `private`，登记到 `scripts/experimental-package-policy.ts` 的 `EXPERIMENTAL_PACKAGE_NAME_EXCEPTIONS`，根 `package.json` 以 `devDependency` 具名它。已核实：`architecture-decisions.zh.md:13-23`（ADR-001）、`package-release-audit.zh.md:11-27,33-51`。

清单声明 `dsh.bundle.patch: "./cordis.patch.yml"`，`exports["./cordis.patch.yml"]` 指向该文件，`files` 收录 `cordis.patch.yml`。已核实：`packages/bundle/base/package.json:16-38`、`packages/experimental/testpilot/package.json:17-37,65-69`。`cordis.patch.yml` 用 `- insert:` 下的一条插件行把 TestPilot 挂进组合：

```yaml
- insert:
    - id: testpilot
      name: '@deepseek-ai/dsh-testpilot'
      config:
        dataDir: ''
        allowedOrigins: []
        policyVersion: '1'
        approvalTtlMs: 900000
        snapshotTtlMs: 300000
        workerPoolSize: 2
        retentionDays: 30
        metricsEnabled: true
```

行的形态（`- insert:`、`id`、`name`、`config`）已核实于 `packages/bundle/headless/cordis.patch.yml:14-25` 与 `packages/bundle/sdk-minimal/cordis.patch.yml:5-9`；这一行的内容与 `config` 取值已核实于 `packages/experimental/testpilot/cordis.patch.yml:1-13`。插件的注入键由 `src/index.ts:28` 的 `inject = ['tools']` 给定，工具注册表是它唯一依赖的宿主服务；`approval`（`packages/interaction/user-approval/src/index.ts:27`）、`browserUse`（ADR-003）、`subprocess`（ADR-006）三项 ctx 键名虽已核实存在于仓库，阶段 1 的插件并不注入它们，浏览器能力的接入归阶段 2。

层顺序是 bundle、profile patch、home patch、`--patch` 覆盖层、遥测；`dsh plugin --profile <name> add @deepseek-ai/dsh-testpilot` 只为声明了 `dsh.bundle` 的包激活一层。TestPilot 不由任何已发布 bundle 插入，`scripts/verify-default-product-isolation.ts` 扫描已发布组合的有效行并拒绝这个实验依赖。已核实：`architecture-decisions.zh.md:31-43`（ADR-002）。

bundle 自带 `locale/*.json`，七种已发布语言各一份，以 `en.json` 为发现入口；图标走清单顶层的 `icon: "./icon.svg"`，是一份自包含 SVG，随 `files` 发布。全包只用这一份图标资源，不引入第二套图标库，不以 emoji 承担功能图标，图标不采用渐变方案。已核实：`adding-a-package.md:139-150`、`package-release-audit.zh.md:123-127`、`architecture-decisions.zh.md:39`（ADR-002）。

阶段 0 冻结的八个允许依赖是 `@deepseek-ai/dsh-storage-domain`、`@deepseek-ai/dsh-attachment`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-scope`、`@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-user-approval`、`@deepseek-ai/dsh-browser-use` 与 `@deepseek-ai/dsh-mcp-client`（`package-release-audit.zh.md:144`，已核实）。骨架的运行时依赖是 `@deepseek-ai/schemastery`、`@deepseek-ai/cordis` 与 `@deepseek-ai/dsh-tools`，其余工作区包出现在 `devDependencies` 供组合测试使用（`packages/experimental/testpilot/package.json:39-63`，已核实）。裁决 C 决定移除新增第三方依赖、组合测试改用纯文本断言，「阶段 1 不新增任何第三方依赖」这条冻结规则保持成立（`package-release-audit.zh.md:146`）；落地核对见 [CONTRACT-CHANGES.md](CONTRACT-CHANGES.md) 附录。浏览器提供方包被刻意排除，浏览器能力的接入归阶段 2。

## 3. 插件形态与 ctx 键

阶段 1 的插件是具名导出的函数插件：`src/index.ts:25` 导出 `name = 'testpilot'`，`src/index.ts:28` 声明 `inject = ['tools']`，`apply(ctx, config)` 在 `src/index.ts:36-51` 装配存储、策略模块与工具注册，没有 default export，也不声明 Cordis `Context` 键。已核实：`packages/experimental/testpilot/src/index.ts:24-36`、`README.md:38`。插件行按 `id: testpilot` 寻址，`ctx.testpilot` 在阶段 1 的实现中不存在。

单数 `ctx.testpilot` 与 `TestPilotService` 的命名结论保留为阶段 2 候选：引入跨插件可访问的 Service 时按它落地，声明形态为 `declare module '@deepseek-ai/cordis' { interface Context { testpilot: TestPilotService } }`（设计推断，形态已核实于 `packages/interaction/user-approval/src/index.ts:25-29`）。

命名取 `Service`：`docs/cookbook/adding-a-package.md:70` 把它定义为「拥有一整个内聚领域服务，且没有更锋利的角色能诚实地描述它」，TestPilot 同时承载项目、计划、用例、运行、结果、审批、白名单与证据，正是这一形态。它不是 `Registry`，不注册任意实现集合（`adding-a-package.md:58`）；不是 `Store`，它还校验状态机、仲裁授权、派发工作（`adding-a-package.md:55`）；不是 `Runtime`，运行的派发、取消与进程生命周期归 `ctx.subprocess` 与 ADR-013 的有界池，不由这个键承担（`architecture-decisions.zh.md:103,239`）。单数与角色数一致（`adding-a-package.md:50`），包名 `dsh-testpilot` 是单一连写词，键沿用 `testpilot`，不拆成 `testPilot` 以免同一能力出现两种拼写。命名取稳定当前职责，不命名第一个实现、不命名可能的扩展、不命名 Cordis 基类（`adding-a-package.md:48`）。两张数据表是这个键的内部数据，不是它暴露给组合的命名成员集合，因此不采用复数键。

不复用 `ctx.approval`（`packages/interaction/user-approval/src/index.ts:27`，已核实），不新增任何复数键，不为 host 与 client 声明同一个键的两种形态（`adding-a-package.md:50`）。

## 4. Config 字段与默认值

| 字段 | 类型 | 默认值 | 取值范围 | 何时改 |
|---|---|---|---|---|
| `dataDir` | string | `''` | 空选择 `<cwd>/.testpilot`；否则为持久化根目录 | 部署要求把记录放到指定卷 |
| `allowedOrigins` | string[] | `[]` | 规范化主机名列表；空拒绝一切导航（fail closed） | 项目需要访问 CDN 或子域 |
| `policyVersion` | string | `'1'` | 单调递增的版本串 | 风险策略变更，让旧授权失效 |
| `approvalTtlMs` | number | `900000` | ≥ 1000 毫秒 | 套件时长超过 15 分钟窗口 |
| `snapshotTtlMs` | number | `300000` | ≥ 1000 毫秒 | 快照引用存活窗口过长或过短 |
| `workerPoolSize` | number | `2` | `1`–`16` | 有界池饱和，报告饱和而不是无界排队（ADR-013:247） |
| `retentionDays` | number | `30` | ≥ 1 天 | 留存期由合规要求改写 |
| `metricsEnabled` | boolean | `true` | `true` / `false` | 部署关闭计数器、结构化日志与审计采集 |

以上八个字段与默认值已核实于 `packages/experimental/testpilot/src/config.ts:27-36` 与 `README.md:23-32`。`policyVersion` 保留可配，因为它同时进入 `configDigest()`（`src/config.ts:44-52`）与授权校验（`src/policy.ts:83`），比 `src/risk.ts` 的模块常量更适合一个可发布 bundle：部署改策略版本即让旧授权失效，无需改代码重新发版。

阶段 2 候选配置，论证保留不删除：`attachHostAllowlist`（空即拒绝所有 attach endpoint，对应 `src/attach-guard.ts` 的主机白名单）、`evidenceQuotaBytes`（默认 26214400，范围 1048576–104857600，超配额返回拒绝而不静默截断）、`caseTimeoutMs`（默认 120000，范围 10000–600000，慢用例结算预算）、`reportFormats`（`['json','junit','html','markdown']` 的非空子集，下游只需要部分格式时启用）、`logLevel`（`info`，排障期提高细粒度）。冻结契约里的 `runAuthorizationTtlMs`、`originAllowlist`、`evidenceRetentionDays` 分别由骨架的 `approvalTtlMs`、`allowedOrigins`、`retentionDays` 吸收；`originAllowlist` 空值的语义从「只放行项目 base URL 主机」改为「拒绝一切导航，fail closed」（`README.md:26`），后者更严格，保留。

默认值由 schema 在激活时一次解析：`Config` 用 `Schema.object` 声明八个字段的缺省与取值范围（`src/config.ts:27-36`），Loader 校验后把已解析的 Config 交给 `apply()`，执行路径不接受未校验输入。字段缺省、取值范围与「何时改」都写在这一个 schema 里，不散落到执行逻辑。配置错误在加载时立即失败，错误信息指名字段名、期望范围与实际值：缺失引用不静默跳过，类型不对不兜底成默认值，路径冲突不自动换值。

校验只放在九个边界：Config 解析、浏览器工具参数、域记录读取、上游 MCP 工具返回、附件内容、子进程退出结果、远程流帧、环境变量、文件路径。同进程内由类型系统保证的调用不加运行时校验，也不加兜底默认值；这类校验会掩盖真实缺陷。九类边界的划分是设计推断，其中子进程环境清理凭据名（`packages/subprocess/subprocess/src/index.ts:54,73-87`）与项目目录路径校验（`architecture-decisions.zh.md:139-151`，ADR-008）已核实存在。骨架已在 Config 解析（`src/config.ts:27-36`）、文件路径（`src/store.ts:37-42` 的 `assertKey`、`src/domain.ts` 的项目根目录校验）、记录读取（`src/store.ts:103-106`）与工具参数解析（`src/tools.ts:150-160` 的 `refsJson`）四处落地；其余边界随阶段 2 能力补齐。

TestPilot 不覆盖 `ctx.approval` 的 policy。`never` 在审批服务内部决定（`packages/interaction/user-approval/src/index.ts:293-301`，已核实），headless 与 CI 部署因此不产生授权记录，高风险调用在派发前被拒。

## 5. 持久化形态

阶段 1 实现以骨架为准：`src/store.ts` 定义 `StoreAdapter` 与 `TestPilotStore`，`createFileAdapter(dataDir)` 把每条记录写成 `dataDir` 下 `prefix/id.json` 的原子 JSON 文档——先写带 `randomUUID()` 的唯一临时文件，再 `rename` 到位（`src/store.ts:44-73`，已核实）。键空间按资源分包：`projects`、`runs`、`gates`、`evidence`、`audit`、`reports`（`src/store.ts:121-141`，已核实）；`apply()` 通过 `resolveDataDir` 取根目录并等待 `store.ready()`（`src/index.ts:37-39`）。包 README 的 Known Limitations 已登记这一点，并把双域迁移归到阶段 2（`README.md:74`、`README.zh.md:74`）。

下表是 ADR-007 选定的双域目标形态，阶段 2 迁移；阶段 1 不接线 `dsh-storage`。

| 域 | 名称 | 布局 | 记录 |
|---|---|---|---|
| 项目域 | `testpilot.projects` | 整域 | `TestProject`、`TestPlan`、`TestCase` |
| 运行域 | `testpilot.runs` | 逐记录 | `TestRun`、`TestResult`、`RunAuthorization`、`AuditEvent` |

两个域的名称是设计推断；「名称路由到后端」的 hub 机制、域 spec 的版本与兼容版本、逐记录布局在一次写入时不重写该单元其余部分、以及存储层没有保留机制，均已核实于 `architecture-decisions.zh.md:121-133`（ADR-007）与 `packages/storage/storage/src/backend.ts:56-64,88-168`。后端选择随阶段 2 的双域迁移一起决定，[阶段 0 未解决问题表](../phase-0/architecture-decisions.zh.md#尚未解决的问题) 把这项留给阶段 2。下列三段的记录字段是双域目标的布局论证；阶段 1 实际记录类型见 `src/types.ts:30-153`（已核实），差异登记在 [CONTRACT-CHANGES.md](CONTRACT-CHANGES.md) 附录。

项目域：`TestProject` 带 `id`、`workspace_id`、`directory`、`base_url`、`policy`、`created_at`、`updated_at`、`deleted_at`；`directory` 必须是该 workspace 规范路径的后代（`architecture-decisions.zh.md:143`，ADR-008，已核实）。`TestPlan` 带 `id`、`project_id`、`workspace_id`、`case_ids`、`snapshot_registry_version`。`TestCase` 带 `id`、`project_id`、`workspace_id`、`plan_id`、`steps`、`locator_refs`；`steps` 是 ADR-004 确定性执行约定的输入、断言、超时与重试（`architecture-decisions.zh.md:71`，已核实）。

运行域：`TestRun` 带 `id`、`project_id`、`workspace_id`、`status`、`spec_digest`、`authorization_ref`、`policy_version`、`containment_mode`、`started_at`、`finished_at`；`containment_mode` 是被报告出来而不是被假定的降级状态（`architecture-decisions.zh.md:113`，ADR-006，已核实）。`TestResult` 逐用例一条，带 `run_id`、`case_id`、`outcome`、`assertions`、`evidence_refs`、`duration_ms`、`failure_kind`。`RunAuthorization` 的字段见 [ADR-011-resolution.md](ADR-011-resolution.md)。`AuditEvent` 逐条追加，带 `run_id`、`kind`、`tool_name`、`target_digest`、`approval_request_id`、`at`、`detail`。逐记录布局承接结果、授权与审计的高频追加；把这些记录放进整域布局会让每次写入重写整个文件（`architecture-decisions.zh.md:125`，已核实）。

归属维度是 `workspace_id` 与 `project_id`，每张业务记录都带，查询条件由访问层统一注入，业务代码不手写归属条件；列表查询一律带作用域。索引落在 `workspace_id` + `project_id`、`project_id` + `plan_id`、`run_id` + `case_id` 与软删除过滤上，MVP 不建复合索引之外的优化。阶段 1 的 `TestProject` 带 `workspaceId`（`src/types.ts:32`，已核实），`TestRun` 只带 `projectId`；`workspaceId` 的运行级绑定由后端按裁决 C 追加，登记在 [CONTRACT-CHANGES.md](CONTRACT-CHANGES.md)。金额表示法不适用：TestPilot 不收款、不记录金额；若商业化进入本平台，金额一律整数分、服务端计算、不信任前端传值。

写操作的边界以 `src/store.ts` 的单键原子写为准：一次 `adapter.write` 要么把一份完整 JSON 文档 `rename` 到位，要么留下可清理的临时文件（`src/store.ts:61-73`，已核实）。三条边界保留为阶段 2 双域约束：批准与授权记录、运行起始状态在同一条链一次提交；用例结果与其证据引用写在同一条记录一次提交，不拆成两次写；授权撤销与拒绝审计各自单条追加，不改写原记录。

RPO 与 RTO 由交付总监裁定为单机本地原子 JSON 档：RPO = 0，每次写入原子落盘（`src/store.ts:61-73` 的唯一临时文件加 `rename`，已核实），不依赖外部服务；RTO = 一次进程重启加一次 `store.ready()`（`src/store.ts:48-51` 建目录、`src/index.ts:39` 等待，已核实）。[假设] 该档以单机单进程、无并发写入者为前提，可由业务方推翻；两个进程写同一 `dataDir` 时没有跨进程锁（ADR-007:129，已核实），需自带锁或改用阶段 2 的双域后端。备份范围六类：`dataDir` 下的记录文件、证据附件、profile patch 与 Config、凭据、保留清理任务、上游 MCP server 与浏览器提供方版本。恢复路径：由部署维护者在记录版本被拒绝或证据引用大面积失效时，先停写入、备份 `dataDir` 与附件目录、按 `upgradeRunRecord` 的一次性步骤重放（`README.md:74`）、重启并等待 `store.ready()`、最后核对记录数与证据引用可解析率。

## 6. 八个冻结源文件

| 文件 | 职责 | 导出契约 | 失败语义 |
|---|---|---|---|
| `src/domain.ts` | 两个域的 spec、版本与兼容集合，以及七类记录类型 | `PROJECTS_DOMAIN`、`RUNS_DOMAIN`、`projectSchema`、`planSchema`、`caseSchema`、`runSchema`、`resultSchema`、`authorizationSchema`、`auditEventSchema`；类型 `TestProject`、`TestPlan`、`TestCase`、`TestRun`、`TestResult`、`RunAuthorization`、`AuditEvent` | 缺 `workspace_id` 或 `project_id` 的记录写入前被拒；目录不在 workspace 规范路径后代的项目被拒 |
| `src/snapshot-registry.ts` | 带版本、身份与 TTL 的快照注册表 | `SnapshotRegistry`、`SnapshotEntry`、`register()`、`get()`、`list()`、`prune()` | 过期条目 `get()` 返回拒绝，不静默回退 |
| `src/locator-validator.ts` | 拒绝过期引用的定位器校验器 | `validateLocator()`、`LocatorRef`、`ValidationResult` | 过期、身份不符或版本不符判为 `stale`，用例在验证阶段失败而不是静默通过（`architecture-decisions.zh.md:77`，ADR-004） |
| `src/risk.ts` | 覆盖实测 24 个工具的风险分类 | `RISK_POLICY_VERSION`、`classify()`、`RiskClass` | 按工具参数分类、工具名兜底，上游标注可得处记录（`architecture-decisions.zh.md:71-75`，ADR-004）；未知工具归最高风险类 |
| `src/approval-gate.ts` | 在浏览器调用之前运行的审批门禁 | `installApprovalGate()`、`check()`、`GateDecision` | 无批准、过期、撤销、摘要不符、nonce 重放、策略变更或 run_id 错配时抛异常阻止派发并追加 `AuditEvent` |
| `src/origin-allowlist.ts` | 传给提供方的来源白名单与派发前导航目标检查 | `resolveOrigins()`、`assertNavigationTarget()` | 不在白名单的目标在派发前被拒；上游 allowed-origins 不覆盖重定向，TestPilot 逐跳检查，见第 12 节 |
| `src/attach-guard.ts` | attach endpoint 主机检查 | `assertAttachHost()`、`AttachHostVerdict` | 私有地址、回环、云元数据与非白名单主机被拒；仓库自身不含这类防护（`architecture-decisions.zh.md:175`，ADR-010） |
| `src/evidence.ts` | 通过附件存储保存证据并回填引用 | `storeEvidence()`、`resolveEvidence()`、`EvidenceRef` | 超配额返回拒绝、不静默截断；附件不可解析时结果保留引用并标注失效 |
| `tests/origin-allowlist.spec.ts` | 导航到允许来源、跟随到不允许来源的重定向，记录观察行为 | 一个组合测试 | 观察结果成为 README 的成文边界（`architecture-decisions.zh.md:185`，ADR-010） |

八个文件与一个测试文件的清单已核实于 `package-release-audit.zh.md:133-142`；表内所有导出符号是冻结时的设计推断。裁决 C 以骨架实现为准，实现侧的文件清单、导出符号与测试文件跟本表的差异登记在 [CONTRACT-CHANGES.md](CONTRACT-CHANGES.md) 附录，本契约不凭空声称这些符号已存在。文件按单一职责切分，单文件不超过 300 行，入口只做装配，按资源分包。

## 7. 模型可见工具清单

方案 12.1 把工具目录分成 Project、Planning、Execution、Exploration、Quality、Intelligence、Evidence 七组，并给出 8–12 个的上限；七组分组由交付总监提供，阶段 0 对它的转述「不是 TestPilot 自定义的八个 API」已核实于 `mcp-contract-audit.zh.md:56`。实测 24 个上游工具之后，阶段 1 收敛到 12 个 `testpilot_*` 工具，取 Project、Execution、Quality、Evidence 与可观测性五组能力，正好落在上限；骨架的重心在 Execution、Quality、Evidence 与可观测性，Project 只保留创建与列出两个最薄入口。

| 分组 | 工具 | 作用 |
|---|---|---|
| Project | `testpilot_project_create` | 创建绑定 workspace 目录的项目 |
| Project | `testpilot_project_list` | 列出已存项目 |
| Execution | `testpilot_run_start` | 排队一次运行并签发带有效期的 run-scoped 授权 |
| Execution | `testpilot_run_get` | 读取一次运行、状态与逐用例结果 |
| Execution | `testpilot_run_list` | 列出已存运行 |
| Quality | `testpilot_snapshot_capture` | 登记带版本与有效期的页面快照及其 `@eN` 引用 |
| Quality | `testpilot_locator_check` | 校验快照引用，并在浏览器调用前评估来源、attach、风险与授权策略 |
| Quality | `testpilot_gate_evaluate` | 评估确定性质量门禁并存入四种报告 |
| Evidence | `testpilot_report_get` | 读取一次运行的 JSON、JUnit、HTML 或 Markdown 报告 |
| Evidence | `testpilot_evidence_list` | 列出证据引用并点名未采集的种类 |
| 可观测性 | `testpilot_metrics` | 读取计数器、派生比率、P95 与每个指标的定义 |
| 可观测性 | `testpilot_status` | 报告插件健康、配置摘要、存活授权、快照与活跃运行 |

十二个工具已核实于 `packages/experimental/testpilot/src/tools.ts:45-308`、`README.md:34`、`README.zh.md:34`。Planning、Exploration 与 Intelligence 三组能力在阶段 1 未实现，一律不进工具 schema：方案禁止「把未实现功能放进工具 Schema 后返回成功」，冻结契约里曾列出的 `testpilot_plan_create`、`testpilot_case_record`、`testpilot_case_list`、`testpilot_result_get`、`testpilot_run_cancel`、`testpilot_report_render`、`testpilot_evidence_get` 因此移入阶段 2 候选，论证不删除。

收敛的理由是实测结果：上游 24 个工具中 16 个改变远端状态、1 个是任意代码执行 `browser_run_code_unsafe`，上游所有者不承诺 schema 稳定（`mcp-contract-audit.zh.md:42,60,90-95`，已核实），照搬会把这份不稳定性带进模型可见面。探索式浏览仍走 MCP 工具，确定性执行使用 TestPilot 自有约定（ADR-004:71，已核实），因此这十二个工具是测试领域工具，不是浏览器操作工具；`browser_run_code_unsafe` 永不进入 TestPilot 的工具清单。风险分类读工具参数而不是背一份 24 条名称表（ADR-004:71-75）。增删工具需改本契约并同步推进 `policyVersion`。

## 8. 可观测性

结构化日志字段为 `ts`、`level`、`component`、`trace_id`、`workspace_id`、`project_id`、`run_id`、`case_id`、`event`、`duration_ms`。禁止写入的字段：`nonce` 原值、凭据、cookie、token、完整请求体；日志不写 session 日志，因为那是模型可见的对话历史（ADR-012:223，已核实）。脱敏口径是字段白名单，不是事后过滤。

metrics：`testpilot_runs_total{outcome}`、`testpilot_cases_total{outcome}`、`testpilot_case_duration_ms`（直方图）、`testpilot_worker_pool_in_use`、`testpilot_approval_denied_total{reason}`、`testpilot_authorization_expired_total`、`testpilot_evidence_bytes_total`、`testpilot_attachment_quota_rejected_total`、`testpilot_redirect_crossed_total`。最后一项承载 ADR-010 的重定向观察计数。

审计：`AuditEvent` 逐条追加到运行域，`kind` 取 `granted`、`denied`、`expired`、`revoked`、`replayed`、`spec_mismatch`、`policy_changed`、`tool_missing`；字段为 `run_id`、`workspace_id`、`project_id`、`kind`、`tool_name`、`target_digest`、`approval_request_id`、`at`、`detail`。写入方是 TestPilot 的写入链，不是 agent；agent 的 `approval/asked` 与 `approval/decided` 留在启动 session 的日志（`packages/interaction/user-approval/src/index.ts:252-259`，已核实），两套靠 `approval_request_id` 与 `run_id` 关联，不合并。审计记录不暴露给任何工具入参，任何工具都不能按 id 更新或删除它。

健康检查 `health()` 返回 `{ status, domains, attachment, approval, browserUse, subprocess, activeRuns, oldestAuthorizationExpiresAt }`，`status` 取 `ok`、`degraded`、`unavailable`。`degraded` 的条件：写入链隔离、附件配额将满、审批服务不可用（fail-closed）、浏览器提供方缺失所需能力（ADR-003:57）、containment 降级（ADR-006:111）。`unavailable` 时拒绝启动新运行，不降级执行。本节全部字段为冻结时的设计推断；实现侧的指标名与定义以 `src/observability.ts` 的 `METRIC_DEFINITIONS`、`src/types.ts:125-153` 的 `MetricSnapshot` 与 `HealthStatus` 为准，差异登记在 [CONTRACT-CHANGES.md](CONTRACT-CHANGES.md) 附录。

## 9. 报告格式

四种格式由一份规范化的 `ReportModel` 生成，不是四套数据模型。`ReportModel` 字段：`run_id`、`workspace_id`、`project_id`、`generated_at`、`policy_version`、`summary`（`total`、`passed`、`failed`、`skipped`、`duration_ms`）、`cases[]`（`case_id`、`outcome`、`assertions`、`duration_ms`、`evidence_refs`、`failure_kind`）、`evidence_index`、`redirect_observations[]`。`failure_kind` 取 `assertion`、`timeout`、`locator_stale`、`tool_missing`、`worker_crash`、`approval_denied`、`origin_blocked`、`quota_exceeded`；测试失败保持可区分，不归约为 `null`（ADR-006:109，已核实）。

JSON 是 `ReportModel` 的直接序列化，字段名 snake_case，供机器消费。JUnit 用 `<testsuites>` / `<testsuite>` / `<testcase>`，`<failure>` 承载 `failure_kind` 与断言，供 CI 消费，只含证据引用路径、不含二进制。HTML 是自包含单文件，由客户端渲染，证据通过附件引用解析，不用内联脚本读取外部资源，配合 `default-src 'self'` 的 CSP。Markdown 是人类可读摘要加逐用例表格，证据以引用列出。报告是附件存储中的一个文件，由客户端渲染并解析其中的引用（ADR-012:221，已核实）；结构化证据在域、二进制证据在附件（ADR-012:221-223，已核实）。阶段 1 冻结四种格式的字段契约；骨架已通过 `renderAllReports()`（`src/reporting.ts`）与 `testpilot_gate_evaluate`、`testpilot_report_get` 生产并读取四种报告，`ReportModel` 的字段论证保留为格式契约，实现字段差异见 [CONTRACT-CHANGES.md](CONTRACT-CHANGES.md) 附录。

## 10. 质量门禁

| 门禁 | 断言 | 证据 |
|---|---|---|
| 覆盖率 | 按文件计、包源码百分之百，`pnpm run test:coverage` | 已核实：`architecture-decisions.zh.md:253`（ADR-014） |
| REAL-composition | 通过 Loader 启动 profile，断言默认组合里不存在 TestPilot 的插件行与工具，启用该 bundle 后存在 | 已核实：`architecture-decisions.zh.md:41,257`、`profile-bundle-integration-audit.zh.md:102` |
| 真实浏览器 | 操作真实浏览器；无浏览器安装时干净跳过 | 已核实：`architecture-decisions.zh.md:257,261` |
| 释放测试 | 每一项注册表贡献证明热重载时的释放行为 | 已核实：`architecture-decisions.zh.md:253`、`packages/AGENTS.md:19` |
| 审批门禁 | 无批准时高风险调用被拒、拒绝发生在派发之前、审计被写入；六项授权绑定各有拒绝用例 | 已核实：`architecture-decisions.zh.md:209`（ADR-011） |
| 重定向 | 导航到允许来源并跟随到不允许来源的重定向，记录观察行为 | 已核实：`architecture-decisions.zh.md:185`、`phase-0-acceptance.zh.md:81` |
| 越权 | workspace A 的调用者访问 workspace B 的项目，在记录加载之前被拒 | 已核实：`architecture-decisions.zh.md:149`（ADR-008）、`packages/api/gateway/src/index.ts:802-826` |
| 证据往返 | 写入带证据引用的结果，重启进程并等待 `store.ready()`，引用仍能解析 | 已核实：`architecture-decisions.zh.md:227`（ADR-012）、`packages/experimental/testpilot/src/store.ts:48-51` |
| 组合与发布 | `pnpm run constraints`、`pnpm run verify-default-product-isolation`、`pnpm run verify-package-meta`、`pnpm run check:i18n` | 已核实：`architecture-decisions.zh.md:23`、`adding-a-package.md:139,160` |
| 工程链 | `pnpm run typecheck`、`pnpm run lint`、`pnpm run build`、`pnpm run hygiene`、`pnpm run test:docs`、`pnpm run doc-sync` | 已核实：`adding-a-package.md:163-172`、`architecture-decisions.zh.md:253` |
| 运行时基线 | Node 24.9.0 或更高版本上重跑基线，结果才作为发布门禁 | 已核实：`package-release-audit.zh.md:64` |

命令输出记入测试基线（`phase-0/README.zh.md:59`，已核实）。明确不做：阶段 1 不交付 worker 池、失败分析与浏览器 worker 驱动；报告生成器与确定性质量门禁已随骨架落地（`src/reporting.ts`、`src/quality-gate.ts`）；不改 `packages/core/tools` 的 `ToolDefinition`（ADR-004:73）；不改既有浏览器核心包，来源选项加入提供方自己的参数构造，提供方无法修改时改用共享注册面挂载（`phase-0-acceptance.zh.md:87`）；不新增第三方依赖（`package-release-audit.zh.md:146`）；不新增带 `experimental` 前缀的包名（ADR-001）。

## 11. 保留策略与一次性升级

存储层与附件层都没有保留机制（`architecture-decisions.zh.md:121,225`，ADR-007 与 ADR-012，已核实），TestPilot 自建。记录按 `retentionDays` 默认保留 30 天，由 `src/retention.ts` 的 `purgeExpiredRuns` 执行（`README.md:31`、`README.zh.md:31`，已核实）；附件配额 `evidenceQuotaBytes` 属阶段 2 候选，阶段 1 不接线外部附件存储（`README.md:77`）。删除走 `store.deleteRun()`：移除 run、gate 与四种报告记录（`src/store.ts:135-141`，已核实），逐层追加墓碑记录，不做物理级联删除。

| 采集字段 | 不采会怎样 |
|---|---|
| `workspace_id`、`project_id` | 跨项目串数据，越权查询无法在查询条件里被挡住 |
| `directory` | 项目可指向 workspace 之外的目录 |
| `base_url` | 来源白名单失去解析基准 |
| `spec_digest` | 一次批准可被挪到另一组参数上 |
| `approval_request_id` | 两套审计无法对账 |
| `evidence_refs` | 报告无法解析证据 |
| `nonce` | 授权记录可被复制到另一次运行 |

不采集凭据明文、密码、cookie、完整请求体，也不把匿名安装身份当作所有权边界（`architecture-decisions.zh.md:147`，ADR-008，已核实）。数据留在本地 `dataDir` 的原子 JSON 文件，不跨境、不上传第三方。

阶段 1 的一次性升级由 `upgradeRunRecord` 提供 v1 到 v2 的记录步骤（`README.md:74`，已核实）。域 spec 提升版本的三步论证保留为阶段 2 双域迁移约束：expand 让新 spec 把旧版本戳加入兼容集合、新增字段一律带默认值的可选字段，旧代码能读新记录；migrate 让一次性升级步骤读取全部旧记录、补齐新字段、以新版本戳重写，幂等键为记录 id 加目标版本，执行前备份目录，执行后核对记录数与版本戳；contract 在确认无旧读者之后另一次发布把旧版本戳移出兼容集合，删字段与改类型单独发布、不与其他变更同批。依据：域 spec 带版本与兼容集合（`packages/storage/storage-domain/src/spec.ts:39,56`）、记录不带版本且没有值迁移运行器（`docs/subsystems/storage.md:108,110`）、SQLite 物理 schema 版本只会被拒绝从不被迁移（`packages/storage/storage-sqlite/src/schema.ts:18,55`）、可选字段与兼容集合的先例在 `packages/schedule/schedule/src/storage.ts:62-66` 与 `packages/workspace/workspace/src/spec.ts:57-65`（均见 ADR-007:125，已核实）。不兼容变更在其升级步骤运行之前被拒绝（ADR-007:131）。

## 12. ADR-010 重定向边界的成文结论

上游来源选项在浏览器上下文的请求拦截里实现：注册一条兜底的中止路由，再重新注册允许的来源以继续；同一个上游的命令行帮助声明该选项不构成安全边界，也不影响重定向；提供方两个选项都没有传。仓库不含私有地址或云元数据地址的防护，被清理过的子进程环境移除凭据名与带 harness 前缀的名称，却不限制子进程能触达的地址。已核实：`architecture-decisions.zh.md:175-183`（ADR-010）、`packages/experimental/browser-use-playwright-mcp/src/index.ts:35-42`、`packages/subprocess/subprocess/src/index.ts:54,73-87`。

1. 上游 allowed-origins 选项不覆盖重定向，也不是安全边界。包 README 的 Known Limitations 已按这一口径成文（`README.md:76`、`README.zh.md:76`、`docs/DETAIL.md:13`、`docs/DETAIL.zh.md:13`，已核实），在真实浏览器测试记录观察结果之前不改变它。
2. TestPilot 通过 `checkRedirect()` 逐跳检查重定向目标（`src/policy.ts:59-64`、`src/tools.ts:177`，已核实）。该检查覆盖每一跳，但在真实浏览器测试记录观察结果之前同样不构成安全边界；跨越允许来源的重定向不再按「直接被跟随」描述，而是按逐跳检查处理。
3. 重定向测试导航到一个允许的来源、跟随一次到不允许来源的重定向、记录观察到的行为，结果成为成文边界（ADR-010:185、`phase-0-acceptance.zh.md:81`，已核实）。
4. 补偿控制有两处：`src/origin-allowlist.ts` 在派发浏览器调用之前检查导航目标，`src/attach-guard.ts` 拒绝私有地址、`127/8`、`169.254/16` 云元数据与 `10/8`、`172.16/12`、`192.168/16` 段的 attach endpoint。网段清单是设计推断。
5. 未到达浏览器上下文的请求不在来源选项覆盖范围内（ADR-010:183，已核实）。attach endpoint 与子进程直接发出的网络调用不算已受保护。
6. 阶段 4 的探索继承同一策略且不得放宽（ADR-010:187，已核实）。
7. 白名单参数加入提供方自己的参数构造；提供方无法修改时，TestPilot 改为通过共享注册面挂载自己的提供方（`phase-0-acceptance.zh.md:87`，已核实）。

## 13. 冻结决策、人话与改的代价

| 决定 | 选了什么 | 一句话人话 | 改的代价 |
|---|---|---|---|
| 审批 | 整次运行开始前批准 + run-scoped 授权记录 | 用户在跑之前看一遍完整参数批一次，跑的过程中不再弹窗 | 高：后补要改 worker 的执行模型与数据模型 |
| 运行身份 | 运行是一条持久化记录，worker 是 `ctx.subprocess` 子进程 | 关掉对话之后测试结果还在，能翻旧账 | 高：改成 session 会推翻持久化边界 |
| 存储 | 阶段 1 的 `dataDir` 原子 JSON，阶段 2 迁移到双域逐记录布局 | 每写一条结果不会把整个文件重写一遍 | 中：换存储要改所有写入链 |
| 归属 | 每张业务记录带 `workspace_id` 与 `project_id`，查询由访问层注入 | 别人改个 id 看不到你的项目 | 高：后补要改所有表与查询 |
| 工具面 | 12 个自有领域工具，浏览器操作不进模型可见面 | 模型看到的是「建项目、跑用例、看结果、查监控」，不是 24 个上游按钮 | 中：增删工具要同步推进策略版本 |
| 白名单 | 上游 allowed-origins 不覆盖重定向，TestPilot 逐跳检查 | 直接访问和跳板都查，但在重定向测试记录观察结果前都不算安全边界 | 中：真正的边界需要出口代理，那是部署关注点 |
| 报告 | 一份格式契约生成四种格式，骨架已落地生产与读取 | 一套数据，CI 读 JUnit、人看 HTML | 低：格式契约变更只影响序列化器 |
| 配置 | 八个字段、schema 一次解析、加载即失败 | 配错了当场报错，不会悄悄按默认值跑 | 低：加字段只需改一处 |
| RPO / RTO | 单机原子 JSON 档，RPO = 0，RTO = 一次重启加 `store.ready()` | 写进去就不丢，重启一下就能接着用 | 中：改成多进程写入要补跨进程锁 |

高代价决定在阶段 1 冻结，不留给阶段 2 返工。

## 14. 能力缝三角闭合

| 能力 | 定义 | 实现 | 消费者 | 默认值 | 失败语义 |
|---|---|---|---|---|---|
| 审批授权 | `RunAuthorization` 与 `check()` | `src/approval-gate.ts` | 浏览器调用派发前的工具执行路径 | 无可用批准 | 过期、撤销、摘要不符、nonce 重放抛异常阻止派发并追加审计 |
| 存储 | `PROJECTS_DOMAIN`、`RUNS_DOMAIN`（阶段 2 目标） | `src/store.ts` 的 `StoreAdapter` 与 `createFileAdapter`（已核实） | 项目创建、用例记录、运行结算、报告 | `dataDir` 空即 `<cwd>/.testpilot` | 单键原子写失败时抛错，不留下半份文档 |
| 附件证据 | `storeEvidence()`、`resolveEvidence()` | `src/evidence.ts` 与 `EvidenceLink`（`src/types.ts:89-98`，已核实） | 结果写入与报告渲染 | 证据引用，不接线外部附件存储 | 引用不可解析时标注失效，不静默丢用例 |
| 来源白名单 | `resolveOrigins()`、`assertNavigationTarget()` | `src/origin-allowlist.ts` | 导航派发前检查 | 空即拒绝一切导航（fail closed） | 不在白名单派发前拒绝；上游不覆盖重定向，TestPilot 逐跳检查 |
| 风险分类 | `classify()`、`RISK_POLICY_VERSION` | `src/risk.ts` | 审批门禁判定高风险调用 | 未知工具归最高风险类 | 上游工具消失时用例在验证阶段失败 |
| 快照引用 | `SnapshotRegistry`、`validateLocator()` | `src/snapshot-registry.ts`、`src/locator-validator.ts` | 用例记录与重放 | TTL 由 `snapshotTtlMs` | 过期引用判 `stale`，用例失败 |
| attach 主机 | `assertAttachHost()` | `src/attach-guard.ts` | 提供方 attach 参数构造 | 空即拒绝所有 | 私有、元数据、非白名单主机被拒 |
| 报告 | `ReportModel` 与四种序列化器 | `src/reporting.ts` 的 `renderAllReports()` 与 `src/quality-gate.ts`（已核实） | `testpilot_gate_evaluate`、`testpilot_report_get` | 四种格式全开 | 证据引用不可解析时标注失效，不静默丢用例 |
| 可观测性 | `MetricSnapshot`、`HealthStatus` | `src/observability.ts`（已核实） | `testpilot_metrics`、`testpilot_status` | `metricsEnabled` 为 true | 采集关闭时状态给出理由，不静默降级 |

表内每一项都有定义、实现与真实消费者；实现侧的文件名与导出符号以 [CONTRACT-CHANGES.md](CONTRACT-CHANGES.md) 附录的对账为准，冻结表中的设计推断符号不凭空声称已存在。没有消费者的预留接口不写进本契约。

## 15. 端到端验证

```sh
pnpm install
pnpm run constraints
pnpm run verify-default-product-isolation
pnpm run typecheck && pnpm run lint && pnpm run build
pnpm run test:coverage
pnpm run test:docs && pnpm run doc-sync
pnpm run verify-package-meta && pnpm run check:i18n
```

断言序列：通过 Loader 启动启用该 bundle 的 profile，断言默认组合里不存在 `testpilot` 插件行与十二个工具、启用后存在；在开启轮次内批准一次运行，断言 `dataDir` 下出现 run 记录与审计条目、高风险浏览器调用通过；撤销授权后断言下一次高风险调用在派发之前被拒；导航到允许来源并跟随到不允许来源的重定向，记录观察行为；写入带证据引用的结果、重启进程并等待 `store.ready()`，断言引用仍能解析；用 workspace A 的调用者访问 workspace B 的项目，断言在记录加载之前被拒；无浏览器安装时真实浏览器测试干净跳过。门禁全绿且上述断言成立，才算本契约兑现。实现与本契约冲突时先改本契约，再改代码。

## 16. 证据约定

标注「已核实」的主张附本树文件路径与行号，或引用阶段 0 审计中已带行号的结论；标注「设计推断」的主张是 TestPilot 新增契约，仓库内不存在对应 API。这与 [阶段 0 的证据约定](../phase-0/README.zh.md#证据约定) 一致：本契约把「待核实」与「新增设计」都归到「设计推断」下，不把未读完整调用链的推断写成已核实，不凭空声称任何仓库 API 存在。方案 12.1 的七组分组与 8–12 上限由交付总监提供，阶段 0 对它的转述已核实于 `mcp-contract-audit.zh.md:56`；裁决 C 的契约变更登记在 [CONTRACT-CHANGES.md](CONTRACT-CHANGES.md)。未使用用户知识库（连接器不可用），技术判断以本树源码与阶段 0 审计为准。
