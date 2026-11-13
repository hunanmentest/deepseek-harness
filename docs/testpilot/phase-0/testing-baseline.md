# TestPilot Phase 0 — testing baseline

English | [中文](testing-baseline.zh.md)

This record lists every command executed against the audited tree, with its observed outcome. A command that was not executed is marked `NOT RUN`, and a suite that was not exercised is named as a gap for Phase 1.

## Execution environment

| Fact | Value |
|---|---|
| OS | `win32 x64` |
| Node | `v22.22.2` (the repository declares `>=24.9.0`) |
| pnpm | `11.28.5` |
| Vitest | `4.1.11` |
| Git commit | not determinable; the tree carries no `.git` directory |
| Chromium | `chromium-1228` from the local Playwright browser cache |

## Dependency restoration

The tree arrived with `node_modules/.pnpm` populated but the top-level `node_modules` and `node_modules/.bin` empty, so no test command could resolve.

| Command | Exit | Result | Note |
|---|---|---|---|
| `pnpm install --offline --ignore-scripts --frozen-lockfile` | 0 | PASS | `resolved 1436, reused 1429, downloaded 0, added 1436`; no version changed, no network fetch |

`--ignore-scripts` was used so the install scripts gated by `pnpm-workspace.yaml` `allowBuilds` did not run. The lockfile was frozen, so the dependency graph is the committed one.

## The unit baseline

One command ran the whole related surface:

```sh
node_modules/.bin/vitest run \
  packages/experimental/browser-use-playwright-mcp/tests/provider.spec.ts \
  packages/experimental/browser-use-runtime/tests/ \
  packages/mcp/mcp-client/tests/ \
  packages/interaction/user-approval/tests/ \
  packages/guard/timeout-policy/tests/ \
  packages/browser-use/browser-use/tests/
```

| Field | Value |
|---|---|
| Start | `2026-11-13T11:09:11+08:00` |
| End | `2026-11-13T11:09:21+08:00` |
| Exit code | 0 |
| Test files | 24 passed, 0 failed |
| Tests | 290 passed, 0 failed, 0 skipped |
| Duration | 8.60s |

| Suite | Tests | Result |
|---|---|---|
| `packages/experimental/browser-use-playwright-mcp/tests/provider.spec.ts` | 3 | PASS |
| `packages/experimental/browser-use-runtime/tests/` | 41 | PASS |
| `packages/mcp/mcp-client/tests/` | 194 | PASS |
| `packages/interaction/user-approval/tests/` | 41 | PASS |
| `packages/guard/timeout-policy/tests/` | 12 | PASS |
| `packages/browser-use/browser-use/tests/` | 2 | PASS |

The baseline is green on every suite that covers the capability TestPilot will build on.

## The upstream browser baseline

The provider's real-Chromium suite is gated on `DSH_BROWSER_EXECUTABLE` and self-skips without it. The local Playwright browser cache provided a Chromium build, so the suite ran rather than skipped.

```sh
DSH_BROWSER_EXECUTABLE="C:/Users/hunan/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe" \
  node_modules/.bin/vitest run --config vitest.e2e.config.ts \
  packages/experimental/browser-use-playwright-mcp/tests/upstream.e2e.ts
```

| Field | Value |
|---|---|
| Exit code | 0 |
| Test files | 1 passed |
| Tests | 2 passed |
| Duration | 5.85s |

Both cases passed against a real browser: the provider launched Chromium and navigated to a loopback fixture page, and it attached to an externally launched Chromium over a debugging endpoint and navigated the same way. The suite asserts that the fixture observed the request, that the tool result was not an error, and that the tool schemas were removed after disposal.

## What the existing suites already prove

| Behaviour | Suite |
|---|---|
| The provider starts the pinned CLI with the expected arguments and clears ambient `PLAYWRIGHT_MCP_*` variables | `provider.spec.ts` |
| A malformed attach endpoint is rejected before any browser resource is registered | `provider.spec.ts` |
| A second registration is refused and a disposer releases the slot | `registry.spec.ts` |
| Concurrent acquisition yields one resource, and a failed acquisition is released for another session | `resources.spec.ts` |
| Operations for one session are serialized while another proceeds, and cancelled queued work is skipped | `resources.spec.ts` |
| A failed close retains exclusive ownership | `resources.spec.ts` |
| Tool discovery completes before the first model request | `mcp.spec.ts` |
| A browser tool owned by another session is refused, and inherited browser instructions are withheld | `mcp.spec.ts` |
| Cancellation during discovery closes the process and releases the attachment | `mcp.spec.ts` |
| A failed discovery rolls back and an unload interrupt stops the child | `mcp.spec.ts` |
| A disposed agent releases its browser before the agent reaches idle | `agent-disposal.spec.ts` |
| The MCP client registers, unregisters, and re-syncs tools across a connection generation | `mcp-client.spec.ts`, `generation.spec.ts` |
| The MCP client's tool names are namespaced and its results are normalized | `tool-definition.spec.ts`, `protocol.spec.ts` |
| An approval request outside an open turn is refused before anything is appended | `approval.spec.ts` |
| A missing answerer fails closed to `unavailable`, and the audit pair is written | `approval.spec.ts` |
| The policy is `never` rejects deterministically | `approval.spec.ts` |
| A tool that declares a timeout is replaced with a `TOOL_TIMEOUT` result | `timeout-policy.spec.ts` |

## Gaps Phase 1 must close

| Gap | Why it matters |
|---|---|
| No test covers a domain allowlist at the browser's egress point | the enforcement location is known but the behaviour is unverified |
| No test covers a redirect crossing an allowed origin | the upstream owner states the option does not affect redirects |
| No test covers an attach endpoint naming an unintended host | the current validation accepts any host |
| No test covers an MCP tool call whose risk requires approval | the approval path and the browser path are not yet joined |
| No test covers a test run surviving the agent that started it | the storage-domain choice is unexercised |
| No test covers a snapshot registry's version or TTL behaviour | the capability does not exist |
| No test covers a stale locator being refused | the capability does not exist |
| No test covers a worker crash being recovered | the capability does not exist |

## Commands not run

| Command | Status | Reason |
|---|---|---|
| `pnpm run test` | NOT RUN | the full repository suite; the baseline was scoped to the capability under audit |
| `pnpm run test:coverage` | NOT RUN | the CI coverage gate; Phase 1 must satisfy it for the new package |
| `pnpm run typecheck` | NOT RUN | no source was changed |
| `pnpm run lint` | NOT RUN | no source was changed |
| `pnpm run build` | NOT RUN | no source was changed |
| `pnpm run doc-sync` | NOT RUN | run after the documentation is written; its result is reported in the acceptance document |
| `pnpm run constraints` | NOT RUN | it runs after the new package is added |
| `pnpm run test:expected`, `test:snapshot`, `test:web` | NOT RUN | unrelated surfaces |

The Node version shortfall means the baseline must be re-run on Node 24.9 or later before Phase 1 treats it as the release gate.

## Further Exploration

- [Browser provider audit](browser-provider-audit.md) — the code behind the passing suites.
- [Execution isolation audit](execution-isolation-audit.md) — the gaps the baseline does not cover.
- [Phase 0 acceptance](phase-0-acceptance.md) — the criteria this baseline feeds.
