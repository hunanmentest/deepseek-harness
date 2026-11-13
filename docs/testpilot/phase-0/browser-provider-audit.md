# TestPilot Phase 0 — browser provider audit

English | [中文](browser-provider-audit.zh.md)

This audit reads the browser capability from the registry upward. It records what the repository already does, because TestPilot must build on those mechanisms rather than beside them.

## The registration surface

`packages/browser-use/browser-use/src/index.ts` defines `BrowserUseRegistry` as a Cordis `Service` registered under the name `browserUse`. Its entire state is one field, `registration: BrowserUseProviderName | undefined`.

`register(name)` throws `browser use provider "<name>" is already registered` when a registration exists, even for a repeated name. It otherwise returns `ctx.effect(() => { ... }, 'browserUse.register()')`, whose disposer clears the field. Because the slot is held by a Cordis effect, unloading the owning plugin releases the registration automatically, and a second disposer cannot remove a later registration.

The service holds no browser object, no operation interface, no resource lifecycle, and no provider selector. `packages/browser-use/browser-use/README.md` states this contract, and the source confirms it.

TestPilot therefore has no reason to build a second registry. It calls `ctx.browserUse.register(...)` when it owns a provider, or consumes an existing registration when it drives one.

## The shared runtime

`packages/experimental/browser-use-runtime/src/index.ts` defines `SessionResources<T>`, the resource manager every browser provider uses.

Ownership is keyed by the live `Agent` object, not by a durable session id. `available(agent)` returns false when the runtime is disposing, when the agent was already disposed, when `ctx.get('agents')?.get(agent.id) !== agent`, or when an exclusive resource is already held by another agent. `entry(agent)` throws `Session is not a live browser owner` for the same conditions, and throws `attached browser is already reserved by another Session` when an exclusive resource is taken.

Each entry owns one `AbortController`, one acquisition promise `ready`, and one operation chain `tail`. `run(agent, signal, operation)` appends to `tail`, so operations for one agent execute in order while other agents proceed independently. The chain tracks settlement independently of a caller observing its error, which keeps a failed call from stalling the queue.

Cancellation combines the caller's signal with the entry's controller through `AbortSignal.any`. A cancellation whose reason carries `kind: 'disposed'` marks the owner as disposed and starts `closeEntry` immediately, before the agent handle waits for idle. `closeEntry` aborts the controller, awaits the acquisition, closes the resource, and only then awaits `tail`, so a transport closure can interrupt an upstream call that has no abort support. A failed close retains the entry and rejects disposal, preserving exclusive ownership rather than silently releasing it.

`dispose()` closes every entry with `Promise.allSettled`, aggregates the failures into an `AggregateError`, and only then runs the owner cleanups. A failed close therefore blocks the provider's unload.

## The MCP mounting helper

`packages/experimental/browser-use-runtime/src/mcp.ts` exports `mountSessionMcp(ctx, options)`, which is the seam a provider uses to own an MCP server per live agent.

The sequence is fixed:

1. `ctx.get('workingDirectory')` must exist, or the call throws before any browser resource is registered.
2. `ctx.browserUse.register(...)` reserves the single provider slot inside a `ctx.effect` generator.
3. `SessionResources` is constructed with the provider's `label` and `exclusive` flag.
4. `ctx.on('agent/created', ...)` with `prepend: true` computes the agent's state, awaits `resources.get(agent, signal)`, and records the client as `ready`.
5. `ctx.on('tools/execute', ...)` runs browser tool calls through `resources.run(agent, exec.signal, ...)`, which serializes them per agent and swaps the combined signal onto the execution for the duration of the call.
6. `ctx.on('system-prompt/assemble', ...)` removes the `mcp:<name>` section when the agent does not own a connection.
7. Unload sets `stopping = true`, awaits `resources.dispose()`, and clears the client map.

The ownership check inside the per-scope `tools/execute` handler throws `browser tool belongs to another Session` when a tool registered in another agent's scope is executed with a different agent. The outer handler repeats the check and throws when the executing agent is unknown or not `ready`.

## The Playwright MCP provider

`packages/experimental/browser-use-playwright-mcp/src/index.ts` is a function plugin exporting `name`, `inject`, `Config`, and `apply`, with no default export, which is the shape `packages/AGENTS.md` requires.

`apply` validates the configuration, resolves the pinned CLI entry with `import.meta.resolve('@playwright/mcp/package.json')`, clears every inherited `PLAYWRIGHT_MCP_*` variable by setting it to the empty string, and starts the server under `process.execPath`.

| Mode | Arguments passed to the upstream server |
|---|---|
| `launch` | `--browser chromium --isolated`, plus `--headless` when `headless` is true, plus `--executable-path <path>` when configured |
| `attach` | `--browser chromium --cdp-endpoint <endpoint>` |

`exclusive` is `true` only in `attach` mode. `mountSessionMcp` receives `reconnect: { enabled: false }` and `failOnStartupError: true` through the MCP client configuration, so a browser server that dies is not silently replaced.

`validateBrowserMcpConfig` accepts `http:`, `https:`, `ws:`, and `wss:` endpoints and rejects any endpoint containing whitespace. It does not check the host, so an `attach` endpoint may name any host the process can reach.

## What the repository does not provide

| Capability | State in the repository |
|---|---|
| TestPilot project, plan, case, run, or result model | absent |
| Snapshot registry with version and TTL | absent |
| Locator validity check | absent |
| Risk classification of browser operations | absent |
| Navigation policy or domain allowlist | absent |
| Worker pool and per-case isolation | absent |
| Test report generation | absent |

The Playwright MCP provider is a browser-operation surface, not a test engine. It lets a model call upstream tools; it does not provide reproducible inputs, assertions, timeouts, retries, result persistence, or reports.

## Further Exploration

- [MCP contract audit](mcp-contract-audit.md) — the tools the upstream server actually advertises.
- [Agent, session, and tool lifecycle audit](session-tool-lifecycle-audit.md) — how an agent, a session, and a test run relate.
- [Execution isolation audit](execution-isolation-audit.md) — what the provider does not constrain.
