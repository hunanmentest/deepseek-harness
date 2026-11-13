# TestPilot 阶段 0 — agent、session 与工具生命周期审计

[English](session-tool-lifecycle-audit.md) | 中文

本审计记录 TestPilot 所依赖的生命周期对象：agent 如何创建与回滚、session 如何跨进程存活、工具调用在哪里可以被拦下、以及哪些后台设施需要实时 agent。每条结论都带有文件路径与行号。

## Agent 创建与恢复

`packages/core/agent/src/index.ts:101` 声明了 `CreateAgentOptions` 的 `setup` 契约（该字段本身在 `packages/core/agent/src/index.ts:120`）。工厂先铸造一个作用域上下文，进入 session store，完成 `session/created`，运行 `setup` 回调，在注册表发布之前可选地立即调用 setup 的同步 `commit()`，然后才宣告 agent。通过该作用域上下文注册的一切——作用域工具、提示词段与变量、`restrict()`、监听器、被等待的子插件——都在 `agent/created` 触发之前与首次提示词组装之前存在（`packages/core/agent/src/index.ts:109`）。

| 条件 | 结果 | 证据 |
|---|---|---|
| `setup` 正常返回 | agent 被发布，然后被宣告 | `packages/core/agent/src/index.ts:106` |
| `setup` 返回一个 `AgentSetupCommit` | 工厂在每次 setup 的 await 全部落定之后、紧邻注册表发布之前调用 `commit()` | `packages/core/agent/src/index.ts:106` |
| `setup` 抛出或拒绝 | 作用域回滚；创建永不被宣告 | `packages/core/agent/src/index.ts:113` |
| `commit()` 抛出 | 作用域回滚；创建永不被宣告 | `packages/core/agent/src/index.ts:113` |
| owner 在 setup 期间被释放 | 作用域回滚；创建永不被宣告 | `packages/core/agent/src/index.ts:113` |
| 以上任一情形 | 已提交的 session 事件仍然保留 | `packages/core/agent/src/index.ts:114` |

`packages/core/agent/src/index.ts:564` 通过 `this.ctx.serial(entry.carrier, 'agent/created', …)` 派发 `agent/created`。因此该事件是串行的：工厂在释放排队工作之前会等待每一个 `agent/created` 监听器。`packages/core/agent/src/runtime-types.ts:291` 中的声明给出载荷 `{ agent: Agent; source: SessionStartSource; signal?: AbortSignal }`，并标注 `@mode serial`。

对 TestPilot 的推论既窄又可测：在 agent 创建之后才开始首个浏览器动作的测试，可以依赖浏览器工具已经注册，因为注册发生在 `setup` 内部，而宣告发生在它之后。

`packages/core/agent/src/index.ts:143` 的 `ResumeAgentOptions.setup` 为恢复路径携带同一份契约。持久化先被加载，重建的 session 被进入并宣告，新的作用域世界在 agent 被注册之前完成组装。

## Session 持久化

session 日志是追加式事件日志，模型历史由 `SessionEvent` 流派生，而不是单独存储。`packages/session/session-persistence/src/index.ts:124` 陈述了每个后端共享的存储语义。

| 保证 | 陈述 | 证据 |
|---|---|---|
| 连续序号 | 事件自 seq 0 起连续，且永不改写 | `packages/session/session-persistence/src/index.ts:127` |
| 撕裂尾巴 | 撕裂的物理尾巴永不返回给读取方，并由写入路径在首次追加之前截断 | `packages/session/session-persistence/src/index.ts:128` |
| 未知词汇 | 读取只校验当前格式的记录，并以失败关闭的方式拒绝未知词汇 | `packages/session/session-persistence/src/index.ts:130` |
| 持久化屏障 | `append` 以尽力而为方式持久化；`flush`——按句柄或服务级——才是屏障 | `packages/session/session-persistence/src/index.ts:131` |
| 新鲜度 | 一旦 `append` 或 `flush` 落定，此后开始的读取至少能观察到该前缀 | `packages/session/session-persistence/src/index.ts:141` |

其中两行对测试运行器是承重的。因为 `append` 是尽力而为而 `flush` 才是屏障（`packages/session/session-persistence/src/index.ts:131`），必须在崩溃后存活的 TestPilot 检查点必须显式等待 `flush`；仅等待 `append` 不构成持久性主张。因为读取以失败关闭的方式拒绝未知词汇（`packages/session/session-persistence/src/index.ts:130`），由更新版 harness 写入的 session 是不可读的，而不是静默有损的。

JSONL 后端以 `'a'` 打开模式与显式 `sync()` 实现追加（`packages/session/session-persistence-jsonl/src/index.ts:1416`）。在部分写入或 sync 失败时，它在重新抛出之前恢复先前的大小，因为未改变的光标会重试该批次，而残留的部分字节会造成重复序号（`packages/session/session-persistence-jsonl/src/index.ts:1432`、`packages/session/session-persistence-jsonl/src/index.ts:1443`）。

跨进程写独占是内核级锁，不是应用级锁。`packages/session/session-persistence-jsonl/src/lease.ts:2` 描述了它：POSIX 在日志旁的 `session.lock` 上取非阻塞 `flock(2)`，Windows 持有由该路径派生的命名内核信号量——绝不使用文件锁或句柄。获取路径是 `packages/session/session-persistence-jsonl/src/lease.ts:70`；争用映射为 `SessionAlreadyOwnedError`，而当持有者的描述符关闭时内核释放该锁，包括进程死亡的情形（`packages/session/session-persistence-jsonl/src/lease.ts:8`）。这里刻意没有过期机制，因为过期可能侵占一个停滞的写入方，而它恢复后的追加会撕裂日志（`packages/session/session-persistence-jsonl/src/lease.ts:11`）。

当前格式版本是 `SESSION_FORMAT_VERSION = 4`（`packages/core/session/src/types.ts:90`）。迁移是仅相邻的链：`packages/session/session-format/src/chain.ts:30` 拒绝任何 `to` 不等于 `from + 1` 的声明，`packages/session/session-format/src/chain.ts:65` 要求从版本 0 到当前版本存在完整的链，否则抛出 `SessionFormatUnsupportedMigrationError`。因此，写 session 事件的 TestPilot 读取方不得假定自己的格式版本。

## 工具注册表

`packages/core/tools/src/index.ts:106` 用 `ScopedLayers` 持有注册表的各项贡献，因此每个作用域贡献自己的 `ToolLayer`，而作用域范围的变更会发出 `tools/change`。`packages/core/tools/src/index.ts:65` 展示了层的形状：一个 `ToolLayer` 持有具名工具注册与匿名编译后的限制。

`packages/core/tools/src/index.ts:162` 的 `restrict()` 收窄调用方 agent 作用域的全局工具集。它拒绝空过滤器（`packages/core/tools/src/index.ts:169`），拒绝来自无作用域上下文的调用（`packages/core/tools/src/index.ts:164`），并返回解除该限制的精确 disposer（`packages/core/tools/src/index.ts:160`）。

作用域键来自 `packages/core/scope/src/index.ts:137`（`createScope`）、`packages/core/scope/src/index.ts:154`（`scopeOf`）与 `packages/core/scope/src/index.ts:170`（`scopeTarget`）。`scopeTarget` 构造一个载体，其过滤器全局接纳未打标签的监听器，并接纳键匹配或其任一祖先的已打标签监听器（`packages/core/scope/src/index.ts:160`）。事件沿链向上流动，绝不向下（`packages/core/scope/src/index.ts:164`）。

## 工具管线

管线有三个 waterfall 阶段。每个都是带作用域过滤派发的 Cordis 事件。

| 阶段 | 事件 | 位置 | 用途 |
|---|---|---|---|
| pre-execute | `tools/pre-execute` | `packages/core/tools/src/pipeline.ts:201` | 在派发前允许、拒绝、取消或询问 |
| execute | `tools/execute` | `packages/core/tools/src/pipeline.ts:307` | 包裹派发的超时、重试或指标 |
| post-execute | `tools/post-execute` | `packages/core/tools/src/pipeline.ts:496` | 接受、替换、增强或阻断归一化结果 |

事件声明分别在 `packages/core/tools/src/events.ts:18`、`packages/core/tools/src/events.ts:29` 与 `packages/core/tools/src/events.ts:41`；注册表变更通知是 `packages/core/tools/src/events.ts:56`。

`packages/core/tools/src/pipeline.ts:201` 正是审批能够插入到浏览器调用之前的确切位置。该闸门解析为 `PreToolDecision`，而 kind 为 `ask` 的决定在 `packages/core/tools/src/pipeline.ts:205` 被路由到 `this.serviceAsk(exec, gate)`。`packages/core/tools/src/pipeline.ts:440` 实现该调用：它用 `ctx.get('approval')` 读取审批服务，在没有组合任何服务时降级为拒绝（`packages/core/tools/src/pipeline.ts:445`），在执行没有可用于路由的 agent 时同样降级（`packages/core/tools/src/pipeline.ts:451`），并把四种结果一一映射（`packages/core/tools/src/pipeline.ts:466`）。

决定类型本身是 `packages/core/tools/src/contracts.ts:375`。它的四个变体是 `allow`、`deny`、`cancel` 与 `ask`；没有任何变体携带风险等级。

## 工具超时与取消

`packages/guard/timeout-policy/src/index.ts:25` 拥有代码 `TOOL_TIMEOUT`，它同时用作内部的 deadline 分类与替换结果上的结构化错误码。替换结果是一个 `isError` 结果，其 `content` 是面向模型的消息，其 `error.info.code` 是同一个常量（`packages/guard/timeout-policy/src/index.ts:46`）。

该包装器在委托前后换入换出信号。它保存上游信号（`packages/guard/timeout-policy/src/index.ts:65`），安装派生出的 deadline（`packages/guard/timeout-policy/src/index.ts:66`），并在 `finally` 块中恢复调用方自己的信号（`packages/guard/timeout-policy/src/index.ts:78`），使 post-execute 监听器永远看不到已中止的超时信号。它仅在自己的计时器触发时替换工具自身的中止结果，并按代码加以界定，从而让嵌套的外层 deadline 被读作普通的上游取消（`packages/guard/timeout-policy/src/index.ts:73`）。

没有声明 `timeoutMs` 的工具不会获得 deadline，被原样委托（`packages/guard/timeout-policy/src/index.ts:59`）。

## Agent initiator scope

`packages/AGENTS.md:8` 陈述了这条规则：initiator 拥有的私有链先派生，再捕获。在 `ctx.agents.withInitiator()` 之下，owner 在每个编排入口取回 `Agent`，派生出 `agent.session`，并让操作局部的辅助函数闭包捕获它。`Agent` 与 `Session` 在生命周期、session 日志、服务、授权、worker/进程、持久化与线路接口上保持显式。

对 TestPilot 而言，这是"worker 能否触达 session 日志"的分界。捕获了 initiator 的 session 的后台 worker 保留了追加 session 事件与开启轮次的能力；只持有 `Context` 的 worker 两者都没有。

## TestRun 不是 Session

测试运行是领域记录，不是 session 事件。它比启动它的 agent 活得更久，包含多个用例，并且必须在任何 agent 消失之后很久仍可被检索。

`packages/storage/storage-domain/src/domain.ts:1` 陈述了域运行时的顺序契约：每次写入先等待后端持久化，再修改内存，然后发出 `domain/changed`。被拒绝的后端写入不改变内存，而报告 `unknown-state` 的后端会隔离该域，使读取与后续写入在关闭前一律拒绝（`packages/storage/storage-domain/src/domain.ts:6`）。

这个顺序正是测试结果所需的。session 日志的形状正相反：它是只追加的，其持久化屏障是一次显式的 `flush`（`packages/session/session-persistence/src/index.ts:131`），既没有权威的内存状态，也没有变更事件。

| 事实 | 归属 | 原因 |
|---|---|---|
| 测试项目的配置 | 存储域 | 持久的领域状态，不是对话 |
| 测试计划及其用例 | 存储域 | 持久的领域状态 |
| 测试运行及其状态 | 存储域 | 必须在启动它的 agent 之外存续 |
| 用例结果及其断言结论 | 存储域 | 必须能跨运行检索 |
| 截图 | 附件存储 | 二进制内容有独立的持久化存储 |
| 高风险动作的审批决定 | session 日志 | 该审计对已经是仅日志的 session 事件 |
| 关于测试的对话 | session 日志 | 普通对话 |

## 后台执行与 Agent 要求

三个后台设施需要实时 agent，一个不需要。

| 设施 | 要求 | 证据 |
|---|---|---|
| subagent | 需要确切的实时父 agent；失效或被替换的父对象会被拒绝 | `packages/subagent/subagent/src/index.ts:275` |
| workflow | `parent: Agent` 是运行选项的必填字段 | `packages/workflow/workflow/src/runtime-types.ts:30` |
| 归属的后台 job | 归属 session 当前必须有一个实时实例；该实例被释放会取消并丢弃该 job | `packages/jobs/jobs-local/src/index.ts:372` |
| subprocess | 不需要 agent：`ctx.subprocess` 是运行时按 spec 获取的服务 | `packages/subprocess/subprocess/src/index.ts:124` |

对 TestPilot 而言 subprocess 才是关键的那一项。`packages/subprocess/subprocess/src/index.ts:160` 声明 `spawn(spec: SubprocessSpawnSpec)`，而该 spec 携带 argv、目录、stdio 配置、宽限期、取消信号与环境——其中任何位置都没有 agent。因此 TestPilot worker 可以在没有 agent 的情况下运行子进程，但它无法获得审批上下文，因为审批接缝是按 agent 分域的。

## Worker 生命周期与资源所有权

`packages/subprocess/subprocess/src/types.ts:187` 声明 `terminate()` 是幂等的，在受管范围消失后是空操作，并且也会由 spec 的中止信号触发。`packages/subprocess/subprocess/src/types.ts:195` 声明 `waitForExit(signal?)`：它等待同一受管范围变空，而不只是等到被启动的命令报告其结果，因此存活下来的工作仍然可被观察。

本地实现把终止分阶段为 TERM、一个宽限期、再到 KILL（`packages/subprocess/subprocess-local/src/spawn.ts:365`）。宽限计时器在 `spec.graceMs` 之后触发 `SIGKILL`（`packages/subprocess/subprocess-local/src/spawn.ts:372`）。该宽限计时器在清理时被刻意不清除，因为强制终止仍必须覆盖到被启动命令落定之后的范围存活者（`packages/subprocess/subprocess-local/src/spawn.ts:426`）。

所有权只在整个受管范围消失之后释放，而不是在直接子进程落定时释放，因此一个捕获 TERM 而比领导者活得更久的辅助进程仍被持有，并且仍可被升级处置（`packages/subprocess/subprocess-local/src/index.ts:233`）。

containment 有三档，每次启动时选取（`packages/subprocess/subprocess-local/src/index.ts:250`）。

| 档位 | 平台 | 机制 | 证据 |
|---|---|---|---|
| `linux-scope` | Linux | 一个 user-systemd scope，用 `systemctl kill --kill-who=all` 终止 | `packages/subprocess/subprocess-local/src/index.ts:255`、`packages/subprocess/subprocess-local/src/linux-scope.ts:321` |
| `windows-job` | Windows | 一个 Job Object，前提是该 runner 可被探测 | `packages/subprocess/subprocess-local/src/index.ts:265` |
| `fallback` | 任意 | 更弱的 containment，并附带明确警告 | `packages/subprocess/subprocess-local/src/index.ts:269` |

fallback 警告是无条件的，并指明了确切的缺口：逃出进程组或直接父子树的子孙不被保证终止，也不被保证延迟 `waitForExit()`（`packages/subprocess/subprocess-local/src/index.ts:288`）。在 macOS 上，陈述的理由是该平台没有受支持的持久进程范围所有者（`packages/subprocess/subprocess-local/src/index.ts:280`）。

承诺"运行结束时浏览器已关闭"的 TestPilot worker，在选中了 fallback 档位的平台上不得作出该承诺。

## 延伸阅读

- [审批与安全审计](approval-security-audit.zh.md) — 审批接缝与凭据边界。
- [执行隔离审计](execution-isolation-audit.zh.md) — 进程 containment 与网络出口。
- [MCP 契约审计](mcp-contract-audit.zh.md) — 浏览器提供方通告的工具列表。
- [阶段 0 验收](phase-0-acceptance.zh.md) — 作为阶段 1 门禁的检查。
