# TestPilot Phase 0 — package classification, release, and documentation audit

English | [中文](package-release-audit.zh.md)

This audit records what a new TestPilot package must satisfy to be classified, published, versioned, and documented in this repository. It replaces the earlier dependency audit, whose content is absorbed and extended here.

## Package classification and naming

A package under `packages/experimental/` belongs there only when its complete public contract is experimental or internal-only; an experimental option inside a release package stays with its owning product role (`packages/experimental/AGENTS.md:5`). TestPilot's contract is experimental in full, so the group is the right one.

| Rule | Requirement | Evidence |
|---|---|---|
| Name | `@deepseek-ai/dsh-testpilot`, never `@deepseek-ai/dsh-experimental-testpilot` | `packages/experimental/AGENTS.md:6` |
| Registry | the directory must appear in `EXPERIMENTAL_PACKAGE_NAME_EXCEPTIONS` | `packages/experimental/AGENTS.md:6`, `scripts/experimental-package-policy.ts:8-30` |
| Legacy prefixes | the list of directories that keep the prefixed name must not grow | `scripts/experimental-package-policy.ts:36-79` |
| Publication | omit `private`, set `publishConfig.access: public` | `packages/experimental/AGENTS.md:7` |
| Private exceptions | `PRIVATE_EXPERIMENTAL_PACKAGE_DIRECTORIES` is empty, so no experimental package is private | `scripts/experimental-package-policy.ts:113` |
| Standards | experimental status relaxes no engineering, security, documentation, lifecycle, testing, or snapshot requirement | `packages/experimental/AGENTS.md:9` |
| Promotion | publishing does not promote; promotion moves the package to a product-role group and, for an unprefixed name, keeps the npm name and drops the registry entry | `packages/experimental/AGENTS.md:10` |

The registry entry is enforced, not advisory. `scripts/check-workspace-constraints.ts` rejects the prefixed form for any directory outside the legacy list, and rejects a directory whose manifest name does not match its registry entry (`scripts/check-workspace-constraints.ts:433-444`). A new package therefore needs two edits outside its own directory: the manifest name and the registry entry.

## Dependency isolation

Release packages and apps outside the experimental group must not name an experimental package in `dependencies`, `optionalDependencies`, or `peerDependencies` (`packages/experimental/AGENTS.md:8`). The rule is enforced in CI through the default-product isolation check, which covers transitive installation, runtime imports, and shipped compositions (`scripts/verify-default-product-isolation.ts:112-119`, `scripts/verify-default-product-isolation.ts:156-181`, `scripts/verify-default-product-isolation.ts:182-227`).

The practical consequence for TestPilot is narrow and mechanical: the root `package.json` may name `@deepseek-ai/dsh-testpilot` only as a `devDependency`, the way it already names the browser packages (`package.json:235-237`). A product composition mounts the package by name in a patch layer instead of depending on it.

Experimental packages may depend on release packages and on each other (`packages/experimental/AGENTS.md:8`). TestPilot therefore depends on the storage domain, the attachment store, the tool registry, the scope primitive, and the browser registration surface, and on nothing that would pull a browser provider into its own dependency graph.

## Dependency versions

The fifteen workspace packages TestPilot builds against all carry the workspace version `0.2.2-rc.2`:

| Package | npm name | Version | Evidence |
|---|---|---|---|
| workspace root | `@deepseek-ai/dsh-root` | `0.2.2-rc.2` | `package.json:3` |
| browser registration surface | `@deepseek-ai/dsh-browser-use` | `0.2.2-rc.2` | `packages/browser-use/browser-use/package.json:4` |
| browser runtime | `@deepseek-ai/dsh-experimental-browser-use-runtime` | `0.2.2-rc.2` | `packages/experimental/browser-use-runtime/package.json:4` |
| browser provider under audit | `@deepseek-ai/dsh-experimental-browser-use-playwright-mcp` | `0.2.2-rc.2` | `packages/experimental/browser-use-playwright-mcp/package.json:4` |
| MCP transport and tools | `@deepseek-ai/dsh-mcp-client` | `0.2.2-rc.2` | `packages/mcp/mcp-client/package.json:4` |
| tool registry | `@deepseek-ai/dsh-tools` | `0.2.2-rc.2` | `packages/core/tools/package.json:4` |
| scoped registration | `@deepseek-ai/dsh-scope` | `0.2.2-rc.2` | `packages/core/scope/package.json:4` |
| agent identity | `@deepseek-ai/dsh-agent` | `0.2.2-rc.2` | `packages/core/agent/package.json:4` |
| turn lifecycle | `@deepseek-ai/dsh-agent-loop` | `0.2.2-rc.2` | `packages/core/agent-loop/package.json:4` |
| approval seam | `@deepseek-ai/dsh-user-approval` | `0.2.2-rc.2` | `packages/interaction/user-approval/package.json:4` |
| tool timeout policy | `@deepseek-ai/dsh-tool-call-timeout-policy` | `0.2.2-rc.2` | `packages/guard/timeout-policy/package.json:4` |
| file-effect policy | `@deepseek-ai/dsh-sandbox-policy` | `0.2.2-rc.2` | `packages/sandbox/sandbox-policy/package.json:4` |
| durable domain records | `@deepseek-ai/dsh-storage-domain` | `0.2.2-rc.2` | `packages/storage/storage-domain/package.json:4` |
| durable image storage | `@deepseek-ai/dsh-attachment` | `0.2.2-rc.2` | `packages/attachment/attachment/package.json:4` |
| session-derived state | `@deepseek-ai/dsh-session-projection` | `0.2.2-rc.2` | `packages/session/session-projection/package.json:4` |

The third-party versions that determine the browser contract:

| Package | Version | Note | Evidence |
|---|---|---|---|
| `@playwright/mcp` | `0.0.80` | pinned exactly in the provider's manifest | `packages/experimental/browser-use-playwright-mcp/package.json:36` |
| `playwright` | `1.63.0-alpha-2026-08-31` | the upstream server's own dependency | `pnpm-lock.yaml:28930` |
| `playwright-core` | `1.63.0-alpha-2026-08-31` | holds the upstream CLI and request interception | `pnpm-lock.yaml:28931` |
| `@modelcontextprotocol/client` | `2.2.0` | the SDK the harness uses | `packages/mcp/mcp-client/package.json:53` |

`@playwright/mcp` is pinned exactly and declares the prerelease `playwright` line itself, so the upstream browser behaviour is tied to a prerelease runtime. That is why the provider's README disclaims any stability promise for the tool schemas.

The Node and pnpm versions the tree runs under are `v22.22.2` and `11.28.5`; the Node version is below the `>=24.9.0` the root manifest declares (`package.json:9`). The mismatch did not prevent installation or any baseline test, but the tree was not exercised on the declared runtime, so Phase 1 must re-run the baseline on Node 24.9 or later before its results count as the release gate.

## Dependencies TestPilot should not add

| Candidate | Why not |
|---|---|
| `playwright` or `@playwright/test` | the upstream server already owns the browser; a second copy creates a second browser runtime and a second version line to maintain |
| `@playwright/test` as a test runner | the harness's Vitest configuration is the test runner; a second runner falls outside the repository's coverage gate |
| a database driver | `dsh-storage` ships `storage-json` and `storage-sqlite`, and the domain layer routes to them by configuration |
| an HTTP client for the browser | the browser's traffic leaves through the browser process, not through a harness client |
| a worker pool library | `packages/subprocess` already owns child-process execution; a separate pool would duplicate it |

The repository rule is that a third-party dependency must be checked against the existing package manifests first, and an unverified dependency must not be added.

## Candidates that need verification before use

| Candidate | Question |
|---|---|
| a snapshot-diff or locator library | whether the harness's own utilities already cover the need; `packages/util` must be checked before adding a package |
| a reporting library | whether the report is a set of records in a storage domain, which needs no library at all |
| a test-data generator | whether the domain model plus the storage domain is sufficient for Phase 2 |

## Manifest requirements

The reference manifest for an experimental package in this group is `packages/experimental/browser-use-playwright-mcp/package.json`. A new package follows its shape:

| Field | Requirement | Evidence |
|---|---|---|
| `name` | `@deepseek-ai/dsh-testpilot` | `packages/experimental/browser-use-playwright-mcp/package.json:2` |
| `version` | the workspace version | `packages/experimental/browser-use-playwright-mcp/package.json:4` |
| `publishConfig` | `{ "access": "public" }`, with no `private` field | `packages/experimental/browser-use-playwright-mcp/package.json:5-7` |
| `license` | `MIT`, matching the repository license | `packages/experimental/browser-use-playwright-mcp/package.json:33` |
| `repository` | the repository URL with the package's own `directory` | `packages/experimental/browser-use-playwright-mcp/package.json:8-12` |
| `exports` | `.` with `types` and `default`, plus `./src/*`, `./package.json`, and `./locale/*.json` | `packages/experimental/browser-use-playwright-mcp/package.json:16-24` |
| `files` | `locale/*.json`, `lib/index.js`, the declaration and map globs, `lib/**/*.js.map`, and `src` | `packages/experimental/browser-use-playwright-mcp/package.json:25-32` |

A package that declares a bundle adds the `dsh` field with `bundle.patch` naming its patch file (`packages/bundle/base/package.json:34-38`).

## Documentation requirements

`packages/AGENTS.md:27-29` sets three obligations a new package must meet:

| Obligation | Requirement | Evidence |
|---|---|---|
| README currency | the package README and the JSDoc contracts are updated in the same commit as the behaviour | `packages/AGENTS.md:27` |
| Model Experience | the README documents model, token, and KV-cache effects in the canonical Model Experience format | `packages/AGENTS.md:28` |
| Known Limitations | durable consumer gaps and non-obvious maintainer constraints live under `## Known Limitations and Deferred Work` | `packages/AGENTS.md:29` |

The cookbook's four steps cover the rest (`docs/cookbook/adding-a-package.md`):

| Step | Requirement | Evidence |
|---|---|---|
| 1 | create the package: `package.json`, `tsconfig.json`, `src/index.ts`, the locale files, and the README | `docs/cookbook/adding-a-package.md:7-23` |
| 2 | register it in the root configs: the tsconfig aggregate entry, and the group README row | `docs/cookbook/adding-a-package.md:31-40` |
| 3 | decide the topology: name the role that exists, and pick the singular or plural `ctx` key to match | `docs/cookbook/adding-a-package.md:42-50` |
| 4 | write the package README in the canonical Model Experience format | `docs/cookbook/adding-a-package.md:74-110` |

A new package belongs to exactly one tsconfig aggregate, never both (`docs/cookbook/adding-a-package.md:36`), and the experimental group README carries a row for it in the package table (`packages/experimental/README.md:35`).

## Locale files

A package that shows up in the plugin manager needs display metadata. The convention is one JSON file per shipped language under `locale/`, with `en.json` as the discovery entry and the same fields in every file (`docs/cookbook/adding-a-package.md:114-141`).

The reference package carries seven languages — `en`, `zh`, `ja`, `es`, `fr`, `de`, `ru` — under `packages/experimental/browser-use-playwright-mcp/locale/`, each holding a `meta` object with `title` and `description`. The shipped-language set is fixed in the repository (`scripts/shipped-locales.ts:2`), and the locale metadata check verifies that every file present in a language covers every field the English or Chinese file carries (`scripts/verify-locale-metadata.ts:17-30`).

## Frozen Phase 1 file and dependency list

The Phase 1 boundary is fixed in the acceptance document (`docs/testpilot/phase-0/phase-0-acceptance.md:95-108`). The file list below is what the new package contributes for that phase, and it is frozen at the eight items the acceptance table names.

| Phase 1 item | File inside the package | Basis |
|---|---|---|
| a `TestProject` and `TestCase` domain | `src/domain.ts` | ADR-003 |
| a snapshot registry with version, identity, and TTL | `src/snapshot-registry.ts` | ADR-005 |
| a locator validator that refuses a stale reference | `src/locator-validator.ts` | ADR-005 |
| a risk classification over the measured 24 tools | `src/risk.ts` | ADR-008 |
| an approval gate that runs before the browser call | `src/approval-gate.ts` | ADR-004 |
| an origin allowlist passed to the provider, with a redirect test | `src/origin-allowlist.ts` and `tests/origin-allowlist.spec.ts` | ADR-006 |
| an attach-endpoint host check | `src/attach-guard.ts` | the execution isolation audit's attach section |
| evidence stored through the attachment store | `src/evidence.ts` | ADR-009 |

The dependencies Phase 1 may declare are the workspace packages the eight items need, and nothing else: `@deepseek-ai/dsh-storage-domain`, `@deepseek-ai/dsh-attachment`, `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-scope`, `@deepseek-ai/dsh-agent`, `@deepseek-ai/dsh-user-approval`, `@deepseek-ai/dsh-browser-use`, and `@deepseek-ai/dsh-mcp-client`. The provider packages are deliberately absent: the browser provider is the deployment's choice, and TestPilot reaches it through the `ctx.browserUse` registration surface (`packages/browser-use/browser-use/README.md:34`).

Phase 1 adds no third-party dependency, and it delivers no worker pool, no test report, and no failure analysis (`docs/testpilot/phase-0/phase-0-acceptance.md:108`).

## Further Exploration

- [Repository audit](repository-audit.md) — the workspace state and the package placement rules.
- [Profile, bundle, and loader audit](profile-bundle-integration-audit.md) — how the package becomes a composition layer.
- [Phase 0 acceptance](phase-0-acceptance.md) — the acceptance tables and the open blockers.
