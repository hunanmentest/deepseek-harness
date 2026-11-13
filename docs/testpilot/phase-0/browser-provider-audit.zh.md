# TestPilot 阶段 0 — 浏览器提供方审计

[English](browser-provider-audit.md) | 中文

本审计自注册表向上阅读浏览器能力。它记录仓库已经具备的机制，因为 TestPilot 必须在这些机制之上构建，而不是与之并行。

## 注册面

`packages/browser-use/browser-use/src/index.ts` 把 `BrowserUseRegistry` 定义为注册名为 `browserUse` 的 Cordis `Service`。它的全部状态是单个字段 `registration: BrowserUseProviderName | undefined`。

`register(name)` 在已有注册时抛出 `browser use provider "<name>" is already registered`，即使名称重复也不例外。否则它返回 `ctx.effect(() => { ... }, 'browserUse.register()')`，其 disposer 会清空该字段。由于该槽位由 Cordis effect 持有，卸载所属插件会自动释放注册，且重复的 disposer 无法移除后续的注册。

该服务不持有浏览器对象、操作接口、资源生命周期或提供方选择器。`packages/browser-use/browser-use/README.md` 陈述了这一契约，源码也与之相符。

因此 TestPilot 没有理由再实现一套注册表。它在拥有提供方时调用 `ctx.browserUse.register(...)`，在驱动已有提供方时消费现有注册。

## 共享运行时

`packages/experimental/browser-use-runtime/src/index.ts` 定义了 `SessionResources<T>`，即每个浏览器提供方都使用的资源管理器。

所有权以实时 `Agent` 对象为键，而非持久化会话 id。`available(agent)` 在以下情形返回 false：运行时正在释放、该 agent 已被释放、`ctx.get('agents')?.get(agent.id) !== agent`，或独占资源已被另一个 agent 持有。`entry(agent)` 对同样的条件抛出 `Session is not a live browser owner`，并在独占资源被占用时抛出 `attached browser is already reserved by another Session`。

每个条目拥有一个 `AbortController`、一个获取 promise `ready` 和一条操作链 `tail`。`run(agent, signal, operation)` 追加到 `tail`，因此同一 agent 的操作按序执行，其他 agent 独立推进。该链独立于调用方观察到的错误来跟踪结算，使失败的调用不会阻塞队列。

取消通过 `AbortSignal.any` 把调用方的 signal 与条目的 controller 组合起来。原因是 `kind: 'disposed'` 的取消会把 owner 标记为已释放，并立即启动 `closeEntry`，早于 agent handle 等待空闲。`closeEntry` 中止 controller、等待获取完成、关闭资源，然后才等待 `tail`，因此传输层关闭可以中断不支持 abort 的上游调用。关闭失败会保留条目并拒绝释放，从而保持独占所有权，而不是静默放弃。

`dispose()` 用 `Promise.allSettled` 关闭每个条目，把失败聚合为 `AggregateError`，之后才执行 owner 清理。因此关闭失败会阻断提供方的卸载。

## MCP 挂载助手

`packages/experimental/browser-use-runtime/src/mcp.ts` 导出 `mountSessionMcp(ctx, options)`，这是提供方用于为每个实时 agent 拥有一个 MCP server 的接口。

顺序是固定的：

1. `ctx.get('workingDirectory')` 必须存在，否则在任何浏览器资源注册之前即抛出。
2. `ctx.browserUse.register(...)` 在 `ctx.effect` 生成器内预留唯一的提供方槽位。
3. `SessionResources` 以提供方的 `label` 与 `exclusive` 标志构造。
4. 带 `prepend: true` 的 `ctx.on('agent/created', ...)` 计算 agent 状态，等待 `resources.get(agent, signal)`，并把客户端记录为 `ready`。
5. `ctx.on('tools/execute', ...)` 通过 `resources.run(agent, exec.signal, ...)` 执行浏览器工具调用，从而按 agent 串行化，并在调用期间把组合后的 signal 换到执行对象上。
6. `ctx.on('system-prompt/assemble', ...)` 在 agent 不拥有连接时移除 `mcp:<name>` 段。
7. 卸载时设置 `stopping = true`，等待 `resources.dispose()`，并清空客户端映射。

每作用域 `tools/execute` 处理器内的所有权检查，在另一 agent 的作用域中注册的工具被不同 agent 执行时抛出 `browser tool belongs to another Session`。外层处理器重复该检查，并在执行 agent 未知或非 `ready` 时抛出。

## Playwright MCP 提供方

`packages/experimental/browser-use-playwright-mcp/src/index.ts` 是一个函数插件，导出 `name`、`inject`、`Config` 和 `apply`，没有默认导出，这正是 `packages/AGENTS.md` 要求的形态。

`apply` 校验配置，用 `import.meta.resolve('@playwright/mcp/package.json')` 解析固定的 CLI 入口，把每个继承的 `PLAYWRIGHT_MCP_*` 变量清空为空字符串，并在 `process.execPath` 下启动 server。

| 模式 | 传给上游 server 的参数 |
|---|---|
| `launch` | `--browser chromium --isolated`，当 `headless` 为 true 时附加 `--headless`，配置了时附加 `--executable-path <path>` |
| `attach` | `--browser chromium --cdp-endpoint <endpoint>` |

`exclusive` 仅在 `attach` 模式下为 `true`。`mountSessionMcp` 通过 MCP client 配置接收 `reconnect: { enabled: false }` 与 `failOnStartupError: true`，因此已退出的 browser server 不会被静默替换。

`validateBrowserMcpConfig` 接受 `http:`、`https:`、`ws:` 和 `wss:` endpoint，并拒绝任何含空白的 endpoint。它不检查主机，因此 `attach` endpoint 可以指向进程可达的任何主机。

## 仓库未提供的能力

| 能力 | 仓库中的状态 |
|---|---|
| TestPilot 的项目、计划、用例、运行或结果模型 | 不存在 |
| 带版本与 TTL 的快照注册表 | 不存在 |
| 定位器有效性检查 | 不存在 |
| 浏览器操作的风险分类 | 不存在 |
| 导航策略或域名白名单 | 不存在 |
| Worker 池与按用例隔离 | 不存在 |
| 测试报告生成 | 不存在 |

Playwright MCP 提供方是浏览器操作面，不是测试引擎。它能让模型调用上游工具；但它不提供可复现的输入、断言、超时、重试、结果持久化或报告。

## 延伸阅读

- [MCP 契约审计](mcp-contract-audit.zh.md) — 上游 server 实际通告的工具。
- [agent、session 与工具生命周期审计](session-tool-lifecycle-audit.zh.md) — agent、session 与测试运行的关系。
- [执行隔离审计](execution-isolation-audit.zh.md) — 提供方未约束的部分。
