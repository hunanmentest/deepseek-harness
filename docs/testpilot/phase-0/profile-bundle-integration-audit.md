# TestPilot Phase 0 — profile, bundle, and loader integration audit

English | [中文](profile-bundle-integration-audit.zh.md)

This audit records how a package becomes a running composition: the profile directory, the patch layers, what a bundle is, what the plugin manager does with an installed package, how the loader replaces changed code, and which rules keep an experimental capability out of the shipped product.

## The profile directory

A profile is a directory named `$DSH_HOME/profiles/<name>`, where the home is resolved from an explicit configuration, then `$DSH_HOME`, then the default `~/.dsh` (`packages/util/home-paths/src/index.ts:135-136`, `packages/boot/app-boot/src/profile.ts:39`, `packages/boot/app-boot/src/profile.ts:165-171`). The directory holds two files that matter to composition:

| File | Content | Evidence |
|---|---|---|
| `package.json` | the profile manifest, including `dsh.profile.bundles`, the ordered list of bundle layers | `packages/boot/app-boot/src/profile.ts:5-8` |
| `cordis.patch.yml` | the user's own patch layer, applied after every bundle layer | `packages/boot/app-boot/src/profile.ts:41-42` |

The manifest also carries the profile's out-of-tree plugin dependencies. The bundle list is what decides which layers exist; the dependency list is what decides what the loader can resolve.

## Patch layer order

`readProfilePatches` assembles the complete patch list in a fixed order, and the order is the composition contract (`packages/boot/app-boot/src/profile-context.ts:74-85`):

| Order | Layer | Source |
|---|---|---|
| 1 | bundle layers, in `dsh.profile.bundles` order | `packages/boot/app-boot/src/profile-context.ts:75-76` |
| 2 | the profile's own `cordis.patch.yml` | `packages/boot/app-boot/src/profile-context.ts:77` |
| 3 | the home-level patch | `packages/boot/app-boot/src/profile-context.ts:78` |
| 4 | the `--patch` overlays | `packages/boot/app-boot/src/profile-context.ts:79` |
| 5 | the telemetry opt-out patch, when the composition carries the telemetry row | `packages/boot/app-boot/src/profile-context.ts:81-83` |

Later layers win. A patch either replaces a row's whole `config` or inserts new rows, and a row's identity is its `id`, so a layer addresses an earlier layer's row by that id.

The root Include that carries all of this holds only two config fields: `path` and `patches` (`packages/boot/app-boot/src/index.ts:790-798`). It has no plugin rows of its own. Every plugin row in a running profile arrives through a patch layer's `insert` operation — `packages/bundle/base/cordis.patch.yml` is one such insert, applied over the empty profile root, and it is where the base rows such as `llm`, `tools`, `session`, and `sandbox` come from.

## What a bundle is

A bundle is an npm package that declares a `dsh.bundle.patch` field and nothing else of runtime significance. The field is the whole contract: it names the patch file, or an ordered list of patch files, that the bundle contributes as a layer.

| Bundle | Declaration | Evidence |
|---|---|---|
| `dsh-base` | one patch file, `./cordis.patch.yml` | `packages/bundle/base/package.json:34-38` |
| `dsh-web-app` | five patch files, the bundle patch plus four preset patches | `packages/bundle/web-app/package.json:49-59` |
| `dsh-sdk-minimal` | one patch file; it is the deliberate exception that owns its complete explicit tree and does not apply `dsh-base` | `packages/bundle/sdk-minimal/package.json:34-38`, `packages/bundle/sdk-minimal/cordis.patch.yml:2` |

A bundle contributes configuration rows, not services. It has no plugin class, no `inject`, and no service of its own; the packages it names in its rows supply the runtime. `dsh-base` accordingly lists its row packages as ordinary dependencies (`packages/bundle/base/package.json:39-139`).

## What the plugin manager does with an installed package

`dsh plugin --profile <name> add <package>` installs the package into the profile directory and then reconciles the bundle selection (`packages/boot/plugin-manager/src/operations.ts:96-128`). The reconciliation distinguishes two kinds of installed package:

| Installed package declares | Result | Evidence |
|---|---|---|
| `dsh.bundle` | its patch files are loaded, and its name is appended to `dsh.profile.bundles` — it becomes a composition layer | `packages/boot/plugin-manager/src/operations.ts:108-121` |
| no `dsh.bundle` | it is installed as a plain dependency and the manager warns that it is not a profile layer | `packages/boot/plugin-manager/src/operations.ts:109-112` |

This is the distinction that matters for TestPilot: a package installed as a dependency is reachable but never activated. Only a package that declares `dsh.bundle` contributes rows.

## How the loader replaces changed code

The HMR service reconciles a profile after a change on disk (`packages/boot/hmr/src/index.ts:930-990`). The sequence is:

| Step | Action | Evidence |
|---|---|---|
| 1 | compare the loaded modules with disk to find the stale ones | `packages/boot/hmr/src/index.ts:942-950` |
| 2 | plan the replacement, then `stopPlanned` expires the manifests, evicts the modules, deletes the plugins from the registry, and awaits their fibers | `packages/boot/hmr/src/index.ts:953-958`, `packages/boot/hmr/src/index.ts:879-886` |
| 3 | `recomposeProfile` publishes the runtime resolution, applies the generation to the root Include, and restarts the entries that had been running | `packages/boot/hmr/src/index.ts:974`, `packages/boot/app-boot/src/index.ts:307-329` |
| 4 | evict the modules below the mappings the recomposition dropped | `packages/boot/hmr/src/index.ts:979-982` |

Not every changed module can be replaced. A module in the host's own static graph, or one whose plugin is not owned by a Loader entry, stays loaded with its previous code and is reported as pending (`packages/boot/hmr/src/index.ts:812-858`). The warning the user sees names those modules explicitly (`packages/boot/hmr/src/index.ts:401`).

## Default product isolation

An experimental package must not appear in the default product: not in its installation, not in its runtime imports, and not in its shipped compositions. The rule and its rationale are recorded in the isolation note ([default product isolation](../../../.agents/notes/implemented/process/2026-09-12-default-product-experimental-isolation.md)), and it is enforced in CI by `scripts/verify-default-product-isolation.ts`.

| Check | What it traverses | Evidence |
|---|---|---|
| dependency graph | the default product's dependency closure; an experimental package anywhere in it is a failure | `scripts/verify-default-product-isolation.ts:112-119` |
| runtime imports | the runtime import specifiers of every default-product source | `scripts/verify-default-product-isolation.ts:156-181` |
| shipped compositions | the composed rows of every shipped bundle patch and preset | `scripts/verify-default-product-isolation.ts:182-227` |
| bundle patches | the patch files of every package in the default closure | `scripts/verify-default-product-isolation.ts:301` |
| presets | every shipped agent preset patch | `scripts/verify-default-product-isolation.ts:265-267` |
| optional bundles | the one declared exception: a bundle in `OPTIONAL_BUNDLES` is shipped switched off | `scripts/verify-default-product-isolation.ts:84-103` |

The `OPTIONAL_BUNDLES` exemption is the only way an experimental capability reaches the installation without joining a default composition. Each entry in it must be a runtime dependency of `apps/cli`, must declare `dsh.bundle.patch`, and must export an icon and `./locale/*.json` display metadata (`scripts/verify-default-product-isolation.ts:89-102`).

The shipped profile templates are the other half of the rule. `PROFILE_TEMPLATES` names the bundles each shipped profile stacks (`packages/util/official-bundles/src/bundles.ts:10-26`), and `DEFAULT_PROFILE_BUNDLES` names the bundle a `dsh plugin` init uses for a name with no shipped template (`packages/util/official-bundles/src/bundles.ts:45`).

## How TestPilot turns on without touching a shipped default

The evidence supports one route, and it is the route the isolation rules were built for:

| Step | Action | Constraint |
|---|---|---|
| 1 | ship TestPilot as an experimental package that declares `dsh.bundle` with its own patch file | the package stays out of every shipped bundle's `cordis.patch.yml` |
| 2 | keep it out of `PROFILE_TEMPLATES` and out of `DEFAULT_PROFILE_BUNDLES` | no shipped profile stacks it |
| 3 | keep it out of the `apps/web` module graph | `apps/web/index.html:16` loads the client entry, and the isolation check traverses every module it reaches (`scripts/verify-default-product-isolation.ts:269-290`) |
| 4 | let a user install it into a profile, which appends it to that profile's `dsh.profile.bundles` | the profile's own `cordis.patch.yml` can then address its rows by id |

The result is a capability that is off in every shipped default and on in exactly the profile that asks for it.

## The real-composition test path

A product-visible plugin needs a non-unit REAL-composition test: boot a test-only `cordis.yml` through the Loader and the app or process, mock only external services and nondeterministic inputs, and assert model-visible, durable, or user-visible output (`packages/AGENTS.md:7`, `docs/testing.md:39`). Hand-built `ctx.plugin(...)` suites do not satisfy the policy.

Two existing experimental packages show the shape:

| Example | What it proves | Evidence |
|---|---|---|
| `personalized-recommendations` | a bundle's rows are addressed by their own ids and switch the shared card service and each feature, through the real Loader and HMR | `packages/experimental/personalized-recommendations/tests/bundle.spec.ts:69-113` |
| `plugin-recommendations` | a capability enables through the real Loader and HMR queue, in the normal and consumer-unload scenarios | `packages/experimental/plugin-recommendations/tests/loader-composition.spec.ts:36-124` |

Both build a temporary home, write a profile directory, boot it, and assert against the live composition rather than against a stub.

## Further Exploration

- [Repository audit](repository-audit.md) — the workspace state and the package placement rules.
- [Package release audit](package-release-audit.md) — naming, publication, and documentation duties for the new package.
- [Phase 0 acceptance](phase-0-acceptance.md) — the checklist this audit feeds.
