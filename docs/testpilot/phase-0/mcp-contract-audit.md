# TestPilot Phase 0 — MCP contract audit

English | [中文](mcp-contract-audit.zh.md)

This audit records the tool contract the pinned upstream server actually advertises. The list was measured by starting `@playwright/mcp@0.0.80` over stdio with the same arguments the provider uses, calling `initialize` and `tools/list`, and reading the response. No tool name, parameter, or result shape in this document is transcribed from documentation.

## How the measurement was made

The probe started the upstream server with `--browser chromium --isolated --headless --executable-path <local Chromium>`, connected an MCP client over stdio, and called `tools/list`. The server advertised 24 tools.

| Fact | Value |
|---|---|
| Server package | `@playwright/mcp@0.0.80` |
| Underlying runtime | `playwright@1.63.0-alpha-2026-08-31` |
| MCP SDK | `@modelcontextprotocol/client@2.2.0` |
| Advertised tools | 24 |
| Server capabilities | `tools` only; no `resources`, `prompts`, `logging`, or `completions` |

The server advertised no resources or prompts in this configuration. The harness's resource helpers `list_mcp_resources`, `list_mcp_resource_templates`, and `read_mcp_resource` live in `packages/mcp/mcp-resources`, not in the browser provider, so they remain available but had no browser server to address in this measurement.

## The advertised tool list

Every tool carries `additionalProperties: false` and a JSON Schema from the upstream server.

| Tool | Required parameters | Optional parameters | `readOnlyHint` | `destructiveHint` |
|---|---|---|---|---|
| `browser_close` | — | — | false | true |
| `browser_resize` | `width`, `height` | — | false | true |
| `browser_console_messages` | `level` | `all`, `filename` | true | false |
| `browser_handle_dialog` | `accept` | `promptText` | false | true |
| `browser_evaluate` | `function` | `element`, `target`, `filename` | false | true |
| `browser_file_upload` | — | `paths` | false | true |
| `browser_drop` | `target` | `element`, `paths`, `data` | false | true |
| `browser_find` | — | `text`, `regex` | true | false |
| `browser_fill_form` | `fields` | — | false | true |
| `browser_press_key` | `key` | — | false | true |
| `browser_type` | `target`, `text` | `element`, `submit`, `slowly` | false | true |
| `browser_navigate` | `url` | — | false | true |
| `browser_navigate_back` | — | — | false | true |
| `browser_network_requests` | `static` | `filter`, `filename` | true | false |
| `browser_network_request` | `index` | `part`, `filename` | true | false |
| `browser_run_code_unsafe` | — | `code`, `filename` | false | true |
| `browser_take_screenshot` | `scale` | `element`, `target`, `type`, `filename`, `fullPage` | true | false |
| `browser_snapshot` | — | `target`, `filename`, `depth`, `boxes` | true | false |
| `browser_click` | `target` | `element`, `doubleClick`, `button`, `modifiers` | false | true |
| `browser_drag` | `startTarget`, `endTarget` | `startElement`, `endElement` | false | true |
| `browser_hover` | `target` | `element` | false | true |
| `browser_select_option` | `target`, `values` | `element` | false | true |
| `browser_tabs` | `action` | `index`, `url` | false | true |
| `browser_wait_for` | — | `time`, `text`, `textGone` | true | false |

Two schema quirks matter for a deterministic test engine. `browser_console_messages` requires `level` and `browser_network_requests` requires `static` although both are semantically optional, and `browser_take_screenshot` requires `scale` although the upstream default would suffice. A test plan that names these tools must supply those fields, or the upstream server rejects the call.

## What the plan's assumptions missed

The plan states that the tool directory "is not the eight APIs TestPilot defines itself" and that the upstream set may change with the pinned dependency. The measurement confirms the second point and corrects the first: the upstream server advertises 24 tools, and the risk profile of those tools is materially broader than a click-and-read surface.

| Plan expectation | Measurement |
|---|---|
| A small fixed tool set | 24 tools, 7 read-only, 16 mutating, 1 arbitrary code execution |
| Tool schemas not fixed by the provider | confirmed; schemas come from the upstream server per tool |
| Risk classification is a new TestPilot responsibility | confirmed and sharpened: the upstream already labels every tool with `readOnlyHint` and `destructiveHint`, and those labels are dropped before the model sees the tool |

## The annotations gap

The upstream server publishes MCP tool annotations: `title`, `readOnlyHint`, `destructiveHint`, and `openWorldHint`. `packages/mcp/mcp-client/src/tools.ts` does not read them. `createMcpToolDefinition` copies `name`, `description`, `inputSchema`, `outputSchema`, and `execution.taskSupport`, and nothing else. A search of `packages/mcp/mcp-client/src` and `packages/core/tools/src` for `annotations`, `readOnlyHint`, `destructiveHint`, and `openWorldHint` returns no code that reads them.

The information is therefore available upstream but absent from the harness's tool registry. This is the single most useful finding for TestPilot's risk classification: the upstream already computes a risk label for every browser tool, and the bridge discards it.

Two consequences follow. TestPilot cannot classify risk from `ctx.tools` alone, because the registry holds no such field. And because `ToolDefinition` in `packages/core/tools/src/contracts.ts` has no annotation or risk field, a classifier that needs one either reads the upstream schema directly or the harness gains a field on the shared contract.

| Option | Consequence |
|---|---|
| TestPilot classifies by tool name | Depends on a 24-entry list owned by an upstream package; the provider's own README already disclaims stability for tool schemas |
| TestPilot classifies by tool arguments | Sees the effect the model intends, including the URL in `browser_navigate` and the paths in `browser_file_upload` |
| The harness carries upstream annotations on `ToolDefinition` | Changes a shared public contract in `packages/core/tools`, which the repository's own rule requires an upgrade guide and a type acknowledgement for |

## Result projection

`packages/mcp/mcp-client/src/tools.ts` converts an MCP result into the harness's content vocabulary. Text blocks are joined with newlines. An `image` block is decoded and stored through the attachment store, and the model receives an attachment reference; a refusal projects text of the form `[image unavailable: <mime>; <reason>; raw image data remains available to programmatic callers]`.

An MCP result with `isError: true` is thrown rather than returned, so the tool runtime records a failure. Image admission requires an attachment store, a resolvable model route, and a model whose declared `inputModalities` include `image`; any of those missing produces the text diagnostic instead of an image.

`projectContent` returns the prepared projection only when the canonical value and the fallback content both match the recorded execution exactly, so a policy replacement that changed the result is preserved.

## What TestPilot must not assume

| Assumption | Status |
|---|---|
| A fixed set of eight browser APIs | false; 24 tools are advertised |
| Upstream tool names are stable | false; the provider README disclaims schema stability |
| The tool registry carries risk information | false; upstream annotations are dropped at the bridge |
| A tool call is idempotent | false for 16 of 24 tools; `browser_navigate`, `browser_click`, `browser_type`, and `browser_fill_form` change remote state |
| A cancelled call leaves no trace | false; the upstream server keeps the browser alive and the browser keeps the state |
| Resource helpers reach the browser server | false in this configuration; the server advertised no resources, and the helpers live in `dsh-mcp-resources` |

## Further Exploration

- [Browser provider audit](browser-provider-audit.md) — where the provider starts the server.
- [Execution isolation audit](execution-isolation-audit.md) — what the advertised tools can reach.
- [Architecture decisions](architecture-decisions.md) — the decisions this measurement settles.
