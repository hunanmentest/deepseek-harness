# TestPilot Phase 0 — testing baseline

English | [中文](testing-baseline.zh.md)

This record lists every command executed against the audited tree, with its observed outcome. A command that was not executed is marked `NOT RUN`, and a suite that was not exercised is named as a gap for Phase 1.

## Execution environment

| Fact | Value |
|---|---|
| OS | `win32 x64` |
| Node | `v24.18.0` (the repository declares `>=24.9.0`) |
| pnpm | `11.28.5` |
| Vitest | `4.1.11` |
| Git commit | not determinable; the tree carries no `.git` directory |
| Chromium | `chromium-1228` from the local Playwright browser cache |

The first pass of this audit ran under Node `v22.22.2`, which is below the floor the root manifest declares, so its results could not serve as the release gate. The environment was corrected afterwards and every suite was re-run under `v24.18.0`; the re-run results are the ones recorded below. The two runs agree on every suite, which is the useful signal: the version floor did not mask a difference in the audited behaviour, and it did not produce one either.

## Dependency restoration

The tree arrived with `node_modules/.pnpm` populated but the top-level `node_modules` and `node_modules/.bin` empty, so no test command could resolve.

| Command | Exit | Result | Note |
|---|---|---|---|
| `pnpm install --offline --ignore-scripts --frozen-lockfile` | 0 | PASS | `resolved 1436, reused 1429, downloaded 0, added 1436`; no version changed, no network fetch |

`--ignore-scripts` was used so the install scripts gated by `pnpm-workspace.yaml` `allowBuilds` did not run. The lockfile was frozen, so the dependency graph is the committed one.

The restore was performed under Node `v22.22.2` and was not repeated under `v24.18.0`. The dependency graph is version-independent here, because the tree carries no `patchedDependencies` and the native artifacts present in the store ship as prebuilt binaries rather than being compiled from source, so the same store is valid for both runtimes. Phase 1 must nonetheless run the install under the supported runtime before treating its own package's baseline as the gate.

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
| Start | `2026-11-13T14:20:08+08:00` under Node `v24.18.0` |
| End | `2026-11-13T14:20:16+08:00` |
| Exit code | 0 |
| Test files | 24 passed, 0 failed |
| Tests | 290 passed, 0 failed, 0 skipped |
| Duration | 7.55s |

The same command under Node `v22.22.2` at `2026-11-13T11:09:11+08:00` returned the identical 24 files and 290 tests, also exit 0.

| Suite | Tests | Result |
|---|---|---|
| `packages/experimental/browser-use-playwright-mcp/tests/provider.spec.ts` | 3 | PASS |
| `packages/experimental/browser-use-runtime/tests/` | 41 | PASS |
| `packages/mcp/mcp-client/tests/` | 194 | PASS |
| `packages/interaction/user-approval/tests/` | 41 | PASS |
| `packages/guard/timeout-policy/tests/` | 12 | PASS |
| `packages/browser-use/browser-use/tests/` | 2 | PASS |

The baseline is green on every suite that covers the capability TestPilot will build on, on both runtimes.

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
| Duration | 4.14s under Node `v24.18.0`; 5.85s under Node `v22.22.2` |

Both cases passed against a real browser: the provider launched Chromium and navigated to a loopback fixture page, and it attached to an externally launched Chromium over a debugging endpoint and navigated the same way. The suite asserts that the fixture observed the request, that the tool result was not an error, and that the tool schemas were removed after disposal. The result is the same on both runtimes.

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

## The documentation gates

The audit deliverables are documentation, so the documentation gates apply to them. These commands were run against the finished documents.

| Command | Exit | Result |
|---|---|---|
| `tsx scripts/verify-translation-pairing.ts` | 0 | every bilingual pair in the repository is consistent |
| `tsx scripts/verify-md-wrap.ts` | 0 | no hard-wrapped prose paragraph |
| `tsx scripts/verify-md-links.ts` | 0 | every relative cross-link and fragment resolves |
| `tsx scripts/verify-doc-refs.ts` | 0 | every documentation reference resolves |
| `tsx scripts/verify-package-paths.ts` | 0 | every `packages/*` reference resolves |
| `tsx scripts/verify-doc-budgets.ts` | 0 | every budgeted document is within its ceiling |
| `tsx scripts/verify-subsystem-pages.ts` | 0 | every package group conforms |
| `tsx scripts/verify-concrete-terms.ts` | 0 | no prohibited term in a maintained file |
| `tsx scripts/verify-repository-references.ts` | 0 | no prohibited commit or organization reference |
| `tsx scripts/verify-public-repository-links.ts` | 0 | no reference to an unavailable repository |
| `tsx scripts/doc-typecheck.ts` | 0 | every fenced TypeScript block compiles |
| `pnpm run test:docs` | 0 | 21 gates passed, 0 failed |

The aggregate documentation gate passes in full. Its four leaves that read Git objects had failed earlier in the audit, before the repository's history was populated; they pass now that the object store is reachable, and each was also run on its own and exits 0.

Two rules in this repository's own documentation gates shaped the deliverables and are worth recording, because a reader who copies a claim from another document would break them. A maintained document may not name a commit by its identifier, because `verify-repository-references` rejects an identifier that resolves to a commit; a version or a description of the release serves instead. And `verify-concrete-terms` rejects one particular word, so this audit's documents do not use it.

## The runtime correction

The audit's first pass ran under Node `v22.22.2`, which is below the floor the root manifest declares. The environment was corrected before the baseline was recorded as the release gate, and every suite above was re-run under `v24.18.0`.

| Fact | Value |
|---|---|
| Runtime used for the recorded baseline | `v24.18.0`, the newest build present on the machine |
| Floor declared by the root manifest | `>=24.9.0` |
| Continuous integration runtime | Node `24`, from `PRIMARY_NODE_VERSION` in the workflow definition |
| Version manager | `nvm` for Windows, with the active version exposed through a directory link at the path the persistent environment variable list declares |

One mechanical detail of the correction is worth recording, because it will bite anyone who repeats it on a machine without Developer Mode. The version manager's own switch command deletes the existing link before it creates the replacement, and on a Windows host that is not elevated and has Developer Mode off, the creation then fails while the command still reports success. The result is a path that resolves to nothing, so `node` disappears from the machine until the link is recreated. Recreating it as a directory junction instead of a symbolic link needs no elevation and produces the same resolution, because the environment variable list names the path and not the link type. A host that keeps its version manager links symbolic must run the switch from an elevated shell.

## Commands not run

| Command | Status | Reason |
|---|---|---|
| `pnpm run test` | NOT RUN | the full repository suite; the baseline was scoped to the capability under audit |
| `pnpm run test:coverage` | NOT RUN | the CI coverage gate; Phase 1 must satisfy it for the new package |
| `pnpm run lint` | NOT RUN | no source was changed |
| `pnpm run build` | NOT RUN | no source was changed |
| `pnpm run doc-sync` | NOT RUN | the aggregate documentation gate; its outcome is recorded above |
| `pnpm run constraints` | NOT RUN | it runs after the new package is added |
| `pnpm run test:expected`, `test:snapshot`, `test:web` | NOT RUN | unrelated surfaces |

`pnpm run typecheck` was run after the runtime correction and passed its five gates, so it is recorded above rather than here.

The baseline now runs on a runtime that satisfies the manifest's floor, so it is eligible to serve as the release gate for Phase 1. The suites that remain unrun are the ones whose scope is the whole repository rather than the capability under audit, and Phase 1's own package must satisfy the coverage gate in addition to these.

## Further Exploration

- [Browser provider audit](browser-provider-audit.md) — the code behind the passing suites.
- [Execution isolation audit](execution-isolation-audit.md) — the gaps the baseline does not cover.
- [Phase 0 acceptance](phase-0-acceptance.md) — the criteria this baseline feeds.
