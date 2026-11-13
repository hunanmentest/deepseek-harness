# TestPilot Phase 0 — repository and package architecture audit

English | [中文](repository-audit.zh.md)

This audit records the repository state, the workspace layout, and the package placement rules that the TestPilot implementation plan depends on. Every fact below was read from the working tree; nothing is carried over from the plan's own summary.

## Audit target and local state

The audit ran against the working tree at `C:\code\deepseek-harness-master`. The tree carries a Git directory, but the first read of it during this audit found no commit: `git rev-parse HEAD` exited 128 with `fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree`, and `git status` reported no commits yet. A background fetch later populated the object store, after which `git rev-parse HEAD` resolved and `git status` reported the tree clean apart from the audit's own output directory. The plan's named commit baseline therefore could not be checked against the tree while the audit was being written, and the fetch that later landed was not part of the audited state.

| Fact | Value | How it was observed |
|---|---|---|
| Git metadata | present, but no reachable commit at audit time | `git rev-parse HEAD` exits 128 |
| Plan's stated baseline | a named upstream commit | not verifiable against the audited tree |
| Root package name | `@deepseek-ai/dsh-root` | `package.json:2` |
| Root package version | `0.2.2-rc.2` | `package.json:3` |
| Package manager | `pnpm@11.28.5` | `package.json:7` |
| Node | `v22.22.2` | `node --version` |
| Declared Node floor | `>=24.9.0` | `package.json:9` |
| Platform | `win32 x64` | `node -p "process.platform + ' ' + process.arch"` |

Two consequences follow. The commit named in the plan cannot be confirmed against this tree, so every "verified" claim in this audit means "verified in the files present", not "verified at the plan's baseline commit". The local Node version is below the `>=24.9.0` the root `package.json` requires under `engines`; the workspace still installs and tests cleanly, but the environment is not the one the manifest declares.

The repository's history changed again after that fetch, by an operation outside this audit. The plan's named commit is no longer present in the object store, the commit that carries the same upstream merge is now a different object, and this audit's own document directory was committed as a local commit on top of it. The audited content is unaffected, because every claim above was read from the working tree's files rather than from a commit, and the working tree's tracked sources were unchanged throughout. The current local state is one upstream-tracking commit carrying the same merge message, one local commit holding this audit's documents, and no modification to any tracked source file.

## Workspace layout

The root `package.json` and `pnpm-workspace.yaml` agree that the workspace covers `vendor/*`, `packages/*/*`, `native/system`, `native/system/packages/*`, `apps/*`, `benchmarks`, `website`, and `python/sdk-runtime` (`package.json:11-18`, `pnpm-workspace.yaml:1-18`). `packages/*/*` is the shape a new TestPilot package must take, because it places one package inside one product group.

The `packages/README.md` group table and the directories on disk agree exactly: 53 groups listed, 53 group directories present, no group missing from either side (`packages/README.md:29-83`). The groups that carry the packages TestPilot touches, with the count of packages each one holds:

| Group | Packages | TestPilot-relevant contents |
|---|---|---|
| `browser-use` | 1 | `browser-use` |
| `experimental` | 63 | `browser-use-runtime`, `browser-use-playwright-mcp`, `browser-use-chrome-devtools-mcp`, `browser-use-stagehand-native` |
| `mcp` | 3 | `mcp-client`, `mcp-manager`, `mcp-resources` |
| `interaction` | 5 | `user-approval`, `permission-presets`, `tool-ask-user`, `user-questions`, `commands` |
| `guard` | 2 | `timeout-policy`, `repeat-tool-reminder` |
| `sandbox` | 4 | `sandbox`, `sandbox-local`, `sandbox-policy`, `sandbox-windows-acl` |
| `core` | 10 | `agent`, `agent-loop`, `tools`, `scope`, `session`, `system-prompt`, `tool-executor-native`, `tool-executor-ptc` |
| `session` | 22 | `session-persistence`, `session-projection`, `working-directory`, `session-format-*` |
| `storage` | 4 | `storage`, `storage-domain`, `storage-json`, `storage-sqlite` |
| `attachment` | 2 | `attachment`, `attachment-local` |
| `subprocess` | 3 | `subprocess`, `subprocess-local`, `win32-process` |
| `util` | 23 | `http-proxy`, `official-bundles`, `home-paths`, `package-manifest` |
| `boot` | 6 | `app-boot`, `cmdline`, `hmr`, `plugin-manager`, `plugin-market`, `config-editor` |
| `bundle` | 6 | `base`, `web-app`, `headless`, `sdk-app`, `sdk-minimal`, `acp-app` |
| `jobs` | 3 | `jobs`, `jobs-local`, `tool-jobs` |
| `workflow` | 3 | `workflow`, `workflow-ptc`, `tool-workflow` |
| `ptc-runtime` | 2 | `ptc-runtime`, `ptc-runtime-node` |
| `workspace` | 1 | `workspace` |
| `identity` | 1 | `anonymous-user-id` |
| `api` | 9 | `gateway`, `remote-access`, `session-controller`, `workspace-controller` |
| `host` | 9 | `webserver`, `frontend-static`, `plugin-inventory` |
| `client` | 72 | `modules`, `locale`, `ui-*` presentation packages |
| `credentials` | 4 | `credentials`, `credentials-local`, `authorization`, `deepseek-account` |
| `deliverables` | 3 | `deliverable-file-references`, `tool-present`, `workspace-changes` |
| `telemetry` | 1 | `otel` |

Each group directory carries a `README.md` that owns its package map and a `README.zh.md` counterpart; the group README is the canonical index for that group's contents.

## Package naming and the directory diagram

The plan's directory diagram disagrees with the tree in three places. Each disagreement is a path that does not exist in the form the diagram gives it.

| Plan's path | Actual path | Why the plan's form is wrong |
|---|---|---|
| a top-level `http-proxy` package directory | `packages/util/http-proxy` | the `util` group owns low-level utilities; no group-level `http-proxy` directory exists |
| a top-level `filesystem` directory | `packages/fs/` | the filesystem capability family is the `fs` group; no group-level `filesystem` directory exists |
| `packages/core/session` | `packages/session/` | the session data plane is its own group; `packages/core/session` is the single append-only session-log package inside the `core` group |

The third case is the one that costs the most if taken literally: `packages/core/session` exists, but it is one package — `@deepseek-ai/dsh-session`, the append-only `SessionEvent` log — and not the session group (`packages/core/session/package.json:2`, `packages/session/README.md:9`).

## Dependency state

`node_modules` was present but incomplete: the `node_modules/.pnpm` store held 1436 package directories, while the top-level `node_modules` directory held only `.pnpm`, with no linked dependency directories and no `.bin` entries. `pnpm exec vitest` could not resolve.

`pnpm install --offline --ignore-scripts --frozen-lockfile` restored every link from the local store. The command reported `resolved 1436, reused 1429, downloaded 0, added 1436` and exited 0, so no package version changed and no network fetch occurred. `--ignore-scripts` avoided the install scripts that `pnpm-workspace.yaml` gates through `allowBuilds` (`pnpm-workspace.yaml:31`). A second run of the same command reported `Scope: all 398 workspace projects` and `Already up to date`, confirming the restored tree matches the lockfile.

## Repository constraints that bind a new package

`packages/AGENTS.md` requires a package to default-export its service class or named-export `name`/`inject`/`Config`/`apply`, to place tests under `tests/` rather than `src/__tests__/`, to extend `tsconfig.base.json` with `rootDir: src` and `outDir: lib/types`, and to register in exactly one tsconfig aggregate (`packages/AGENTS.md:5-6`, `packages/AGENTS.md:24-26`). It also requires a product-visible plugin to carry a REAL-composition test that boots `cordis.yml` through the Loader, and requires registry contributions to prove disposal through the HMR-safety test (`packages/AGENTS.md:7`, `packages/AGENTS.md:19`).

`packages/experimental/AGENTS.md` states that a package under `packages/experimental/` joins the dsh release family by default: it must omit `private` and set `publishConfig.access: public` (`packages/experimental/AGENTS.md:7`). A new experimental package must be named `@deepseek-ai/dsh-<name>` without the `experimental` prefix, and its directory must be registered in `EXPERIMENTAL_PACKAGE_NAME_EXCEPTIONS` in `scripts/experimental-package-policy.ts` (`packages/experimental/AGENTS.md:6`). `scripts/check-workspace-constraints.ts` rejects the prefixed form for any directory outside `LEGACY_PREFIXED_EXPERIMENTAL_PACKAGE_DIRECTORIES`, and that list must not grow (`scripts/check-workspace-constraints.ts:438-443`, `scripts/experimental-package-policy.ts:36-79`).

The root `AGENTS.md` forbids launching anything other than a `dsh` profile, forbids modifying the Agent Loop to bypass an extension point, and requires every externally perceptible breaking change to be recorded in an upgrade guide immediately.

## Where TestPilot's code belongs

The evidence supports one new package under the experimental group, named `@deepseek-ai/dsh-testpilot`, registered in `EXPERIMENTAL_PACKAGE_NAME_EXCEPTIONS` for the directory `packages/experimental/testpilot`.

A single package is enough for Phase 1 and Phase 2. The domain model, the snapshot registry, the locator validator, the orchestrator, and the worker all share one storage domain, one approval seam, and one tool-registration surface, and the repository's own rule is to keep business rules in their own package and to attach them through a registration surface (`packages/AGENTS.md:14`). Splitting the domain model from the execution engine would add a dependency edge between two experimental packages without producing a separately consumable capability.

The package must not depend on a specific browser provider. The browser providers are peers behind the `ctx.browserUse` registration surface; a package that depends on one provider cannot work with the others (`packages/browser-use/browser-use/README.md:34`).

The package name and the registration are the only two entries the new directory adds to the repository's control files. Everything else the package needs — the tsconfig aggregate entry, the group README row, the locale files — follows from the ordinary package checklist (`docs/cookbook/adding-a-package.md:31-40`).

## Further Exploration

- [Profile, bundle, and loader audit](profile-bundle-integration-audit.md) — how a package becomes a composition layer.
- [Package release audit](package-release-audit.md) — naming, publication, versions, and documentation duties.
- [Phase 0 acceptance](phase-0-acceptance.md) — the checklist this audit feeds.
