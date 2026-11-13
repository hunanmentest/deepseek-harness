# TestPilot Phase 0 — architecture decision records

English | [中文](architecture-decisions.zh.md)

Fourteen records settle the architecture of TestPilot. Each states the background, the repository facts that constrain it, the options considered, the decision, the rejected options with their reasons, the risks it carries, how it will be verified, and what it means for the later phases.

A record whose evidence is a design inference rather than a verified fact says so. Two records are **blocked**: they name a question that the audit could not settle from the repository, and Phase 1 must settle it before the work it governs may begin.

## ADR-001 — Package group and release strategy

**Background.** TestPilot needs a home in the workspace, a name that survives promotion, and a publication policy that keeps it out of the shipped product.

**Repository facts.** `packages/experimental/AGENTS.md:6` requires a new experimental package to be named `@deepseek-ai/dsh-<name>` without the `experimental` prefix and to be registered in `EXPERIMENTAL_PACKAGE_NAME_EXCEPTIONS` in `scripts/experimental-package-policy.ts`. `scripts/check-workspace-constraints.ts:433-443` rejects the prefixed form for any new directory and rejects a missing registry entry. The legacy list at `scripts/experimental-package-policy.ts:36-79` already holds both browser packages and must not grow. `packages/experimental/AGENTS.md:7` makes publication public by default.

**Options.** A release-group package; an experimental package with the legacy prefixed name; an experimental package with an unprefixed name registered in the exceptions map.

**Decision.** An experimental package at `packages/experimental/testpilot`, named `@deepseek-ai/dsh-testpilot`, registered in the exceptions map, published publicly.

**Rejected.** The release-group option, because TestPilot has no product owner and no shipped surface yet. The legacy-prefixed option, because the prefix must be renamed on promotion and that breaks every import and configuration that names the package.

**Risks.** The registry entry is a hard gate; a missing entry fails `pnpm run constraints`. The package name is permanent unless the package is renamed at promotion.

**Verification.** `pnpm run constraints` accepts the new directory; `pnpm run verify-default-product-isolation` reports no experimental package in the shipped composition.

**Impact on later phases.** Phase 1 creates the package. Phase 6 revisits the classification when the platform has a named owner.

## ADR-002 — Profile and bundle assembly

**Background.** TestPilot must be installable and switchable without becoming part of the shipped product.

**Repository facts.** A profile is a directory under the harness home holding `package.json` with `dsh.profile.bundles` plus a `cordis.patch.yml` (`packages/boot/app-boot/src/profile.ts:39,42`). A bundle is an npm package whose only content is a patch document (`packages/bundle/base/package.json:34-38`). The root include carries only a path and patches; every plugin row arrives from a patch layer's `insert` (`packages/boot/app-boot/src/index.ts:790-798`). Layer order is bundle, profile patch, home patch, `--patch` overlay, telemetry (`packages/boot/app-boot/src/profile-context.ts:74-85`). `dsh plugin --profile <name> add <package>` activates a layer only for a package that declares `dsh.bundle`; an ordinary plugin installs as a dependency and never becomes a row (`packages/boot/plugin-manager/src/operations.ts:108-121`).

**Options.** A bundle that carries the capability; an ordinary plugin mounted by a shipped bundle; a library imported by another package.

**Decision.** TestPilot ships as a bundle with a `cordis.patch.yml` that inserts its own plugin rows, and is never inserted by a shipped bundle. A user enables it by adding its bundle to a profile's `dsh.profile.bundles`, or by `dsh plugin --profile <name> add @deepseek-ai/dsh-testpilot`.

**Rejected.** Mounting TestPilot from a shipped bundle, because `scripts/verify-default-product-isolation.ts:182-227` scans the effective rows of the shipped composition and would reject the experimental dependency. The library option, because a library has no plugin surface and cannot be mounted.

**Risks.** A bundle needs its own `locale/*.json` for the plugin manager to offer it, and its icon. HMR replaces a bundle by disposing the old entry and restarting the new one (`packages/boot/hmr/src/index.ts:930-990`), so a browser provider that TestPilot mounted must survive that replacement.

**Verification.** The REAL-composition test boots a profile through the Loader and asserts the browser tools are absent by default and present after the bundle is enabled.

**Impact on later phases.** Phase 1 delivers the bundle and its composition test. Phase 6 may add the bundle to `OPTIONAL_BUNDLES` once the platform ships.

## ADR-003 — Browser provider and browser adapter boundary

**Background.** Three browser providers exist. TestPilot must work with all of them and must not fork the browser stack.

**Repository facts.** `BrowserUseRegistry` in `packages/browser-use/browser-use/src/index.ts:35-45` holds one provider slot and refuses a second registration. `SessionResources` in `packages/experimental/browser-use-runtime/src/index.ts:60-197` keys ownership by the live agent, serializes operations per agent, and closes resources on disposal. `mountSessionMcp` in `packages/experimental/browser-use-runtime/src/mcp.ts:102-220` performs discovery during serial `agent/created` and enforces that a browser tool belongs to the calling session. The Playwright provider passes `--browser chromium --isolated` (`packages/experimental/browser-use-playwright-mcp/src/index.ts:35-42`); the Chrome DevTools provider passes `--no-usage-statistics` and `--isolated` (`packages/experimental/browser-use-chrome-devtools-mcp/src/index.ts:28-36`); the Stagehand provider builds its own native runtime and its own tool definitions (`packages/experimental/browser-use-stagehand-native/src/index.ts:24-70`).

**Options.** TestPilot registers its own browser provider; TestPilot drives whichever provider the deployment mounts; TestPilot reimplements browser control.

**Decision.** TestPilot drives whichever provider the deployment mounts, through the `ctx.browserUse` registration surface and the tool registry. It defines no browser object and no browser operation.

**Rejected.** Registering its own provider, because the registry holds one slot and TestPilot would displace the deployment's provider. Reimplementing browser control, because two browser resource managers in one process would each own a browser and neither could reason about the other's lifecycle.

**Risks.** The three providers expose different tool sets, so a capability that one provider has and another lacks must be detected rather than assumed. Stagehand's provider requires its own model configuration and does not use the MCP tool bridge at all.

**Verification.** A test asserts that TestPilot's tools resolve against the provider the composition mounts, and a separate test covers the case where a required capability is absent.

**Impact on later phases.** Phase 1 must express every browser requirement as a capability check rather than a tool name.

## ADR-004 — MCP tools and deterministic execution

**Background.** The plan separates exploratory browsing from deterministic execution. The audit measured the actual upstream surface.

**Repository facts.** The pinned upstream server advertises 24 tools, of which 16 carry `readOnlyHint: false` and one is arbitrary code execution; the measurement is recorded in the [MCP contract audit](mcp-contract-audit.md). The upstream publishes a risk label per tool, and `packages/mcp/mcp-client/src/tools.ts` does not read it, so the label never reaches the harness registry. The bridge registers tools under `mcp__<serverName>__<rawName>` and normalizes results (`packages/mcp/mcp-client/src/tools.ts:91-97`).

**Options.** Deterministic cases call the MCP tools directly; deterministic cases use a TestPilot-owned execution contract; the harness carries the upstream annotations forward.

**Decision.** Exploratory browsing uses the MCP tools. Deterministic execution uses a TestPilot-owned contract with its own inputs, assertions, timeouts, retries, and results. Risk classification reads the tool arguments, and the upstream per-tool label is recorded where it can be obtained without a shared-contract change.

**Rejected.** Calling the MCP tools from a deterministic case, because 16 of the 24 mutate remote state and the upstream owner disclaims schema stability, so a recorded case would neither be reproducible nor safe to replay. Adding a field to `ToolDefinition` in `packages/core/tools`, because that is a public contract change requiring an upgrade guide, a type acknowledgement, and an update to every consumer, and because the argument already carries the actual target of the action.

**Risks.** A test plan that names upstream tools inherits their instability. The upstream label is available only where the provider exposes it, so classification must have an argument-based fallback.

**Verification.** Phase 1 adds a test that a deterministic case records its inputs and its assertion outcome, and that a case whose upstream tool disappears fails validation rather than silently passing.

**Impact on later phases.** Phase 2 defines the execution contract. Phase 3 generates cases in that contract, so the contract must exist before generation begins.

## ADR-005 — Agent, session, test run, and worker lifetimes

**Background.** The plan states that a test run is not a session. The audit confirms this and finds the worker question is the open one.

**Repository facts.** Agent creation runs a setup callback, publishes a commit, and only then announces the agent; a setup failure rolls the scope back (`packages/core/agent/src/index.ts:100-140`). `agent/created` is a serial event (`packages/core/agent/src/index.ts:564`). The session log is an append-only event log from which model history is derived (`packages/session/session-persistence/src/index.ts:124-143`). The approval service rejects a request whose session has no open turn (`packages/interaction/user-approval/src/index.ts:244-250`), and the open turn exists only between `turn/start` and `turn/end`.

**Options.** A test run is a session; a test run is a domain record; the worker is an agent; the worker is a subprocess.

**Decision.** A test run is a domain record that outlives the agent that started it. The worker is a managed subprocess, not an agent and not a subagent.

**Rejected.** A test run as a session, because the session log is a conversation record with a turn-scoped approval model, and a test run needs to survive its agent and to be queried across runs. The worker as a subagent, because `packages/subagent/subagent/src/index.ts:275-277` requires an exact live parent agent and `packages/subagent/subagent/src/activation.ts:23-34` rejects rather than queues when the pool is full.

**Risks.** A worker without an agent has no turn, so it cannot ask for approval. This is recorded as a blocker in ADR-011 and resolved there rather than here.

**Verification.** A test asserts that a test run survives the disposal of the agent that started it and remains queryable.

**Impact on later phases.** Phase 2 builds the worker on `ctx.subprocess` and must not assume an agent is present.

## ADR-006 — Reuse of jobs, workflow, and PTC

**Background.** The repository has four background facilities. TestPilot needs one for deterministic execution.

**Repository facts.** Jobs is a registry with a bounded output ring; an owned job requires a live agent and a mounted controller (`packages/jobs/jobs-local/src/index.ts:216-221,372-383`), and its state machine has five states. Workflow runs a script inside a PTC process and each step is a subagent (`packages/workflow/workflow-ptc/src/host.ts:200-227`); a failing child is reduced to `null` rather than failing the run (`packages/workflow/workflow-ptc/src/runtime.ts:207-222`). PTC runs a program in a separate process (`packages/ptc-runtime/ptc-runtime-node/src/index.ts:28`) and treats the program as a hostile peer (`packages/ptc-runtime/ptc-runtime/src/index.ts:102-108`); its failure kinds are a field on a resolved result (`packages/ptc-runtime/ptc-runtime/src/types.ts:157-181`). `ctx.subprocess` is the only seam whose `terminate()` and `waitForExit()` observe the same managed range (`packages/subprocess/subprocess/src/types.ts:187,195`).

**Options.** Reuse PTC; reuse Jobs; reuse Workflow; reuse `ctx.subprocess` and own the lifecycle.

**Decision.** TestPilot owns the test-execution lifecycle and uses `ctx.subprocess` as its process primitive. It uses no part of PTC, Jobs, or Workflow as a lifecycle manager.

**Rejected.** PTC, because it executes model-written programs, its result shape is meant for model self-correction, and it refuses concurrent runs for one state owner. Jobs, because an owned job forces a live agent and its five-state machine cannot express a per-case outcome. Workflow, because its step failure is reduced to `null`, while a test failure must stay distinguishable.

**Risks.** On a platform without a native managed range, the containment degrades and surviving descendants are not guaranteed to be terminated (`packages/subprocess/subprocess-local/src/index.ts:273-290`). TestPilot must state that limit.

**Verification.** Phase 2 adds a test that a crashed worker is reaped and that its resources are released, and a test that the containment mode is reported rather than assumed.

**Impact on later phases.** Phase 2 implements the worker pool on this decision. Phase 4 exploration reuses the same worker boundary.

## ADR-007 — Data persistence and migration

**Background.** TestPilot stores projects, plans, cases, runs, and results. The audit examined what the repository provides.

**Repository facts.** `dsh-storage` is a hub that routes a name to a backend (`packages/storage/storage/src/registry.ts:9-12`); `dsh-storage-domain` declares record schemas with zod and maintains authoritative in-memory state behind a single write chain that persists before it mutates memory and then emits the change (`packages/storage/storage-domain/src/domain.ts:1-9`). A domain spec carries a version and a set of compatible versions (`packages/storage/storage-domain/src/spec.ts:39,56`), but a record carries no version and there is no value-migration runner (`docs/subsystems/storage.md:108,110`). The JSON backend stores files and publishes them atomically (`packages/storage/storage-json/src/atomic.ts:24-40`); the SQLite backend uses the built-in `node:sqlite` driver and commits data with its version stamp in one transaction (`packages/storage/storage-sqlite/src/unit.ts:147-159`), and its physical schema version is only ever rejected, never migrated (`packages/storage/storage-sqlite/src/schema.ts:18,55`). Neither the storage layer nor the attachment layer has a retention mechanism (`packages/storage/storage/src/backend.ts:88-168`).

**Options.** Session events; a storage domain; a separate database.

**Decision.** TestPilot's records live in a `dsh-storage` domain. Project, plan, and case records share one domain; run and result records use a second domain with the per-record layout, because that layout never rewrites the rest of the unit on one write (`packages/storage/storage/src/backend.ts:56-64`). Schema evolution follows the repository's two precedents: prefer optional fields with defaults, and when the meaning changes, raise the version and keep the previous stamp in the compatible set (`packages/schedule/schedule/src/storage.ts:62-66`, `packages/workspace/workspace/src/spec.ts:57-65`). An incompatible change carries its own one-time upgrade step, because the storage layer provides none.

**Rejected.** Session events, because the log is a conversation record with a turn-scoped model and is replayed as model history. A separate database, because the repository already ships a domain layer with a durable write chain, and a second store would duplicate it.

**Risks.** Storage has no cross-process lock, so two processes writing one domain must bring their own. The storage layer has no retention mechanism, so TestPilot must build one.

**Verification.** Phase 2 writes a run, closes the domain, reopens it, and asserts the record and its version stamp survive; a second test asserts that an incompatible change is refused until its upgrade step runs.

**Impact on later phases.** Phase 2 implements the domain. Phase 5 writes failure analyses into the same domain. Phase 6 needs the retention policy this record defers to Phase 2.

## ADR-008 — Ownership of a test project

**Background.** A test project must belong to something, and two projects must not see each other.

**Repository facts.** A workspace is a stable identity for an existing directory; its identifier is a random identifier and its path is canonical and never rewritten after creation (`packages/workspace/workspace/src/types.ts:16,73-78`). Uniqueness is decided by canonical path equality (`packages/workspace/workspace/src/paths.ts:39-51`). Session membership is checked by comparing the session's realpath against the workspace path (`packages/workspace/workspace/src/entity.ts:110-150`), and a one-owner invariant is enforced at startup: one path belongs to one workspace and one session is accounted by one workspace (`packages/workspace/workspace/src/index.ts:766-807`). The remote access decision is made per method and per resource, and the gateway decides access before it resolves the resource, so a refused call activates nothing (`packages/api/gateway/src/index.ts:802-826`).

**Options.** A test project is a workspace; a test project is an independent top-level record with a workspace reference; a test project is a session.

**Decision.** A test project is an independent domain record that carries a workspace identifier, and its directory must be a descendant of that workspace's canonical path. A run belongs to a project.

**Rejected.** A test project as a workspace, because a workspace is a directory identity and a project also carries a base URL, a test policy, and a case inventory. A project inside the workspace's session list, because that list is a session ledger whose membership rule reads the session header's working directory, and whose one-owner invariant would be broken by a non-session member.

**Risks.** A project whose directory moves outside its workspace cannot be validated by path. The anonymous installation identity is an analytics identifier and is not an ownership boundary (`packages/identity/anonymous-user-id/src/index.ts:5-9`).

**Verification.** Phase 1 adds a test that a project outside its workspace is refused, and that a remote caller without a policy for the project resource is refused before the record is loaded.

**Impact on later phases.** Phase 1 defines the project record. Phase 6 adds the permission and audit surfaces over it.

## ADR-009 — Web host, client, and remote API

**Background.** A web platform needs a way to show progress and to survive a page refresh.

**Repository facts.** The host HTTP service is a route registrar with no file serving and no business logic (`packages/host/webserver/src/index.ts:5-6`); a wildcard bind address is rejected at load time (`packages/host/webserver/src/index.ts:96-107`). The gateway has two planes: unary calls over the connection's `/api` route and streaming over its own WebSocket multiplex at `/api/remote.mux` (`packages/api/gateway/src/index.ts:248-254,255-324`). The repository has no server-sent-event client path; the only occurrence of that content type is a compression exclusion (`packages/host/webserver/src/index.ts:248`). A follow stream sends the current full snapshot as the first frame of each connection and then deltas, and a stream with a cursor resumes from an absolute offset (`packages/api/job-controller/src/observe.ts:47-70`). The client-side projection store is in memory and is lost on refresh (`packages/api/session-controller/src/client/sessions/projection-store.ts:92-97`). Remote method types are generated from the host model and merged into the client type map, and a client contribution is refused at mount time unless every field has a strict codec (`packages/api/gateway/src/client/index.ts:302,803-818`).

**Options.** Server-sent events; polling; a remote stream over the existing multiplex; a separate web application.

**Decision.** TestPilot exposes its run state as a remote stream over the existing multiplex, following the pattern of the job and workspace controllers, and it is a client module in the same package that hosts the capability, not a separate application. The run record is a domain record, so a refresh reopens the stream and receives the current state as the baseline.

**Rejected.** Server-sent events, because the client path does not exist and the multiplex already provides reconnection and snapshot semantics. Polling, because it would not deliver a prompt baseline after a refresh. A separate web application, because the browser module graph is composed by the host, so an independent front end could not enter it.

**Risks.** A remote endpoint without a generated strict definition falls back to a source marker path that cannot restore the erased object constraints (`packages/api/gateway/src/index.ts:401-416`).

**Verification.** Phase 6 adds a test that a client which reconnects receives the current run state without a gap, and that a contribution missing a strict codec is refused.

**Impact on later phases.** Phase 1 designs the domain so the later stream can carry it. Phase 6 implements the client module and the remote namespace.

## ADR-010 — Browser network egress and worker isolation

**Background.** The plan requires a domain allowlist and states that the browser must not be able to reach unintended hosts. The audit located the enforcement point and its limits.

**Repository facts.** The pinned upstream server implements origin options through the browser context's request interception, registering a catch-all aborting route and then re-registering the allowed origins to continue. The same upstream's command-line help states that the option does not serve as a security boundary and does not affect redirects. The provider passes neither option (`packages/experimental/browser-use-playwright-mcp/src/index.ts:35-42`). The repository contains no private-address or cloud-metadata-address guard. The scrubbed child environment removes credential-shaped and harness-prefixed names but does not restrict the addresses a child may reach (`packages/subprocess/subprocess/src/index.ts:54,73-87`).

**Options.** Rely on the upstream origin option; add an egress proxy in front of the browser; rely on the upstream option plus a per-operation check; accept the host's reach.

**Decision.** TestPilot passes the origin option through the provider for the per-project allowlist and treats it as one layer. It additionally checks the target of a navigation before dispatching the browser call. It does not describe the allowlist as a security boundary until a test shows what happens to a redirect that crosses it.

**Rejected.** Relying on the upstream option alone, because its own documentation disclaims both the boundary claim and redirect coverage. An egress proxy, because the browser's own traffic would have to be routed through it and that is a deployment concern this phase cannot verify.

**Risks.** A redirect that crosses the allowlist may still be followed. The upstream origin option is implemented in the browser context, so a request that never reaches the context is outside it.

**Verification.** Phase 1 adds a test that navigates to an allowed origin, follows a redirect to a disallowed origin, and records the observed behavior; the result becomes the documented limit.

**Impact on later phases.** Phase 1 implements the allowlist and the redirect test. Phase 4 exploration inherits the same policy and must not widen it.

## ADR-011 — Approval, credentials, and high-risk operations

**Background.** A risky action must be approved before it happens, and a test must be able to use credentials without leaking them.

**Repository facts.** The approval service rejects a request whose session has no open turn, before appending anything (`packages/interaction/user-approval/src/index.ts:244-250`), and only `allowed-once` grants execution (`packages/interaction/user-approval/src/types.ts:32`). The `never` policy is decided inside the service so that it holds regardless of registration order (`packages/interaction/user-approval/src/index.ts:296-301`). Credentials exist in two key spaces and the local provider stores them in plaintext under a file-permission guard with no encryption (`packages/credentials/credentials-local/src/index.ts:61,451,717`); the credential reference form is resolved at runtime, and the templated form is implemented only for MCP transport strings (`packages/mcp/mcp-client/src/credentials.ts:83-94`). The MCP redaction covers error diagnostics and failed result text but not successful results (`packages/mcp/mcp-client/src/tools.ts:159-163`). The repository's high-risk precedents are the sandbox-mode and approval-policy combination presets (`packages/interaction/permission-presets/src/index.ts:182-191`) and the risk-tiered review gate (`packages/experimental/auto-review/src/index.ts:67-69`); there is no declarative registry that marks a tool as risky (`packages/core/tools/src/contracts.ts:375-379`).

**Options.** Approve inside the agent's turn; approve the whole run before it starts; let the worker ask through a session.

**Decision.** **Blocked.** The audit established the call chain but not which branch the background worker uses.

The three designs have different costs. Approving inside the agent's turn reuses the existing seam unchanged but couples the risk gate to the loop's turn. Approving a whole run before it starts needs its own grant record with an expiry. Giving the worker a session with turn semantics grants a background process a concept it otherwise does not need.

Phase 1 must record which design it adopts, together with the rule that one approval never grants a permanent authorization, and must not implement the worker before it does. The approval check itself runs in the tool execution path, before the browser call, because that path is where a throwing listener prevents the dispatch (`packages/core/tools/src/pipeline.ts:307`).

**Rejected.** A worker calling the approval service directly, because the turn precondition rejects it before any answerer is consulted.

**Risks.** Credentials are plaintext at rest, so "not persisted" holds only for the model-visible and session-visible surfaces. A test that injects a password into a browser form needs a credential path that does not pass through model-visible content, and the repository provides no such path outside MCP.

**Verification.** Phase 1 adds a test that a high-risk browser call is refused when no approval is available, that the refusal precedes the dispatch, and that the audit pair is written.

**Impact on later phases.** Phase 2 inherits the approval context for its worker. Phase 5 reads evidence only and never needs approval.

## ADR-012 — Evidence, attachment, and report lifetimes

**Background.** A test result carries evidence. The evidence must be stored, referenced, and eventually discarded.

**Repository facts.** An image attachment is content-addressed with a four-type media whitelist and byte, count, and pixel limits (`packages/attachment/attachment/src/types.ts:8,73-82`; `packages/attachment/attachment-local/src/index.ts:33-46`); a file attachment is content-addressed by digest and carries no admission limit of its own (`packages/attachment/attachment/src/index.ts:208-222`). The MCP bridge already projects an image result into an attachment reference so that the model sees a reference rather than the bytes (`packages/mcp/mcp-client/src/tools.ts:333-338`). The deliverables tool records a path and a description and copies no content (`packages/deliverables/tool-present/src/index.ts:53,106-108`). The workspace-changes summary lasts only until the session is disposed (`packages/deliverables/workspace-changes/src/index.ts:9,154`). The repository has no report, trace, or video facility.

**Options.** Store evidence in the domain; store evidence as attachments; store evidence in the session log; generate a report document.

**Decision.** Structured evidence, that is runs, cases, assertions, and outcomes, lives in the domain. Binary evidence, that is screenshots, traces, and videos, lives in the attachment store and is referenced from the domain. A report is a file in the attachment store that the client renders, resolving the references inside it.

**Rejected.** Binary evidence in the domain, because a domain value is opaque JSON and the JSON backend rewrites the whole file on one write, so an embedded image would make every write rewrite the entire record. Evidence in the session log, because the session log is the model-visible conversation history. Generating the report at run time into the session, because the workspace-changes precedent shows that session-scoped artifacts disappear with the session.

**Risks.** The attachment layer applies no limit to file attachments, so TestPilot must impose its own quota. Neither layer has a retention mechanism, so TestPilot must build one and decide how a domain record and its attachments are discarded together.

**Verification.** Phase 2 stores a result with an evidence reference, closes and reopens the domain, and asserts the reference still resolves to the stored content.

**Impact on later phases.** Phase 5 reads evidence for failure analysis. Phase 6 adds the retention policy.

## ADR-013 — Concurrency, cancellation, recovery, and reclamation

**Background.** A test run holds browsers, processes, and records. Every one of them must be released.

**Repository facts.** The browser runtime serializes operations per agent and joins the caller's cancellation with the owner's controller, closing the resource before awaiting the operation tail so that a transport closure interrupts work that has no abort support (`packages/experimental/browser-use-runtime/src/index.ts:107-132,185-195`). A failed close retains ownership rather than releasing it (`packages/experimental/browser-use-runtime/src/index.ts:323`). The subprocess seam makes termination idempotent and makes exit wait for the whole managed range (`packages/subprocess/subprocess/src/types.ts:187,195`), and the local implementation escalates from a polite signal to a hard kill after the grace period (`packages/subprocess/subprocess-local/src/spawn.ts:360-376`). The storage domain serializes writes per domain and quarantines itself when the medium's state becomes unknown (`packages/storage/storage-domain/src/domain.ts:283-309`).

**Options.** Serialize all test cases; run cases in parallel with a bounded pool; run cases without a bound.

**Decision.** Test cases run in parallel within a bounded pool whose size is configuration. A case owns its browser resource and its worker process, and both are released when the case settles. A worker that does not settle within its budget is terminated and its range awaited. A case that fails never leaves a resource behind, and a failed close retains ownership and fails the run rather than silently leaking.

**Rejected.** Serial execution, because it would make a suite's duration the product of its slowest cases. Unbounded parallelism, because each case holds a browser and a process, and the repository's own browser runtime has no per-deployment concurrency limit.

**Risks.** Cancellation cannot undo an action already delivered to the browser, so a cancelled case may leave the remote system changed. On a platform without a native managed range, surviving descendants are not guaranteed to be terminated.

**Verification.** Phase 2 adds a test that a cancelled case releases its browser and its worker, that a crashed worker is reaped, and that a failed close fails the run.

**Impact on later phases.** Phase 4 exploration uses the same pool. Phase 6 reports pool saturation rather than queueing without bound.

## ADR-014 — Tests, continuous integration, and quality gates

**Background.** The repository treats test evidence as a release gate, and a new package must satisfy it.

**Repository facts.** The coverage gate is per file at one hundred percent over the package sources (`package.json` declares `test:coverage` as the coverage command). A product-visible plugin requires a non-unit composition test that boots a configuration file through the loader (`packages/AGENTS.md:7`; `docs/testing.md:39`), and the strongest existing example is `packages/experimental/personalized-recommendations/tests/bundle.spec.ts`. Registry contributions must prove disposal through the hot-reload safety test (`packages/AGENTS.md:19`). Documentation gates run as an aggregate (`package.json` declares `test:docs` and `doc-sync`).

**Options.** Unit tests only; unit tests plus a composition test; unit tests plus a composition test plus a real-browser test.

**Decision.** TestPilot ships unit tests for its own logic, a composition test that boots a profile through the loader and asserts the default-off behavior, a real-browser test that exercises a live browser, and a disposal test for every registry contribution. The baseline for the existing capability is recorded in the [testing baseline](testing-baseline.md).

**Rejected.** Unit tests only, because they cannot show that the plugin activates correctly in a real composition or that it stays out of the shipped default. A real-browser test only, because it is slow and cannot isolate a specific failure.

**Risks.** The composition test must not depend on a network credential or a real provider. The real-browser test needs a browser installation, so it must skip cleanly when none is present, as the upstream browser suite does.

**Verification.** The package's own gates run before the phase is claimed complete, and the real-browser test is exercised at least once in the environment that will host it.

**Impact on later phases.** Each later phase adds its own tests to the same gate set. Phase 6 adds the end-to-end suite.

## Records that remain open

| Question | Why it is open | Owner |
|---|---|---|
| How a background worker obtains an approval context | the approval seam requires an open turn, which a worker does not have | Phase 1, ADR-011 |
| What happens to a redirect that crosses the allowed origins | the upstream owner states the origin option does not affect redirects | Phase 1, ADR-010 |
| Whether the harness carries the upstream per-tool risk label | depends on the cost of a shared-contract change in the core tools package | Phase 1, ADR-004 |
| Which storage backend serves the test domain | the domain layer routes by configuration, and both backends ship | Phase 2, ADR-007 |
| The retention policy for results and their evidence | neither the storage layer nor the attachment layer provides one | Phase 2, ADR-012 |

## Further Exploration

- [Phase 0 acceptance](phase-0-acceptance.md) — which records block Phase 1.
- [Execution isolation audit](execution-isolation-audit.md) — the evidence behind ADR-006, ADR-010, and ADR-013.
- [Approval and credentials audit](approval-security-audit.md) — the evidence behind ADR-011.
