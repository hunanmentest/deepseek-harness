# TestPilot Phase 0 — agent, session, and tool lifecycle audit

English | [中文](session-tool-lifecycle-audit.zh.md)

This audit records the lifecycle objects TestPilot depends on: how an agent is created and rolled back, how a session survives a process restart, where a tool call can be stopped before it runs, and which background facilities require a live agent. Every claim carries a file path and a line number.

## Agent creation and recovery

`packages/core/agent/src/index.ts:101` declares the `setup` contract of `CreateAgentOptions` (the field itself is at `packages/core/agent/src/index.ts:120`). The factory mints a scoped context, enters the session store, completes `session/created`, runs the `setup` callback, optionally invokes the setup's synchronous `commit()` immediately before registry publication, and only then announces the agent. Everything registered through the scoped context — scoped tools, prompt sections and variables, `restrict()`, listeners, awaited child plugins — exists before `agent/created` fires and before the first prompt assembly (`packages/core/agent/src/index.ts:109`).

| Condition | Outcome | Evidence |
|---|---|---|
| `setup` returns normally | the agent is published and then announced | `packages/core/agent/src/index.ts:106` |
| `setup` returns an `AgentSetupCommit` | the factory invokes `commit()` after every setup await settles and immediately before registry publication | `packages/core/agent/src/index.ts:106` |
| `setup` throws or rejects | the scope rolls back; creation is never announced | `packages/core/agent/src/index.ts:113` |
| `commit()` throws | the scope rolls back; creation is never announced | `packages/core/agent/src/index.ts:113` |
| the owner is disposed mid-setup | the scope rolls back; creation is never announced | `packages/core/agent/src/index.ts:113` |
| any of the above | already committed session events remain stored | `packages/core/agent/src/index.ts:114` |

`packages/core/agent/src/index.ts:564` dispatches `agent/created` through `this.ctx.serial(entry.carrier, 'agent/created', …)`. The event is therefore serial: the factory awaits every `agent/created` listener before releasing queued work. The declaration in `packages/core/agent/src/runtime-types.ts:291` carries the payload `{ agent: Agent; source: SessionStartSource; signal?: AbortSignal }` and is marked `@mode serial`.

The consequence for TestPilot is narrow and testable: a test that begins its first browser action after agent creation may rely on the browser tools already being registered, because registration happens inside `setup` and announcement happens after it.

`ResumeAgentOptions.setup` in `packages/core/agent/src/index.ts:143` carries the same contract for the resume path. Persistence is loaded first, the reconstructed session is entered and announced, and the fresh scoped world is composed before the agent is registered.

## Session persistence

The session log is an append-only event log, and the model history is derived from the `SessionEvent` stream rather than stored separately. `packages/session/session-persistence/src/index.ts:124` states the storage semantics every backend shares.

| Guarantee | Statement | Evidence |
|---|---|---|
| contiguous sequence | events are contiguous from seq 0 and never rewritten | `packages/session/session-persistence/src/index.ts:127` |
| torn tail | a torn physical tail is never returned to a reader and is truncated by the write path before its first append | `packages/session/session-persistence/src/index.ts:128` |
| unknown vocabulary | reads validate current-format records only and refuse unknown vocabulary fail-closed | `packages/session/session-persistence/src/index.ts:130` |
| durability barrier | `append` persists best-effort; `flush` — per handle or service-wide — is the barrier | `packages/session/session-persistence/src/index.ts:131` |
| freshness | once an `append` or `flush` resolves, reads started afterwards observe at least that prefix | `packages/session/session-persistence/src/index.ts:141` |

Two of these rows are load-bearing for a test runner. Because `append` is best-effort and `flush` is the barrier (`packages/session/session-persistence/src/index.ts:131`), a TestPilot checkpoint that must survive a crash has to await `flush` explicitly; awaiting `append` alone is not a durability claim. Because reads refuse unknown vocabulary fail-closed (`packages/session/session-persistence/src/index.ts:130`), a session written by a newer harness is unreadable rather than silently lossy.

The JSONL backend implements the append with an `'a'` open mode and an explicit `sync()` at `packages/session/session-persistence-jsonl/src/index.ts:1416`. On a partial write or a sync failure it restores the previous size before rethrowing, because the unchanged cursor will retry the batch and leftover partial bytes would create duplicate sequence numbers (`packages/session/session-persistence-jsonl/src/index.ts:1432`, `packages/session/session-persistence-jsonl/src/index.ts:1443`).

Cross-process write exclusivity is a kernel-level lock, not an application lock. `packages/session/session-persistence-jsonl/src/lease.ts:2` describes it: POSIX takes a non-blocking `flock(2)` on `session.lock` beside the log, and Windows holds a named kernel semaphore derived from that path — never a file lock or handle. The acquire path is `packages/session/session-persistence-jsonl/src/lease.ts:70`; contention maps to `SessionAlreadyOwnedError`, and the kernel releases the lock when the holder's descriptor closes, including on process death (`packages/session/session-persistence-jsonl/src/lease.ts:8`). There is deliberately no expiry, because an expiry could expropriate a stalled writer whose resumed appends would tear the log (`packages/session/session-persistence-jsonl/src/lease.ts:11`).

The current format version is `SESSION_FORMAT_VERSION = 4` (`packages/core/session/src/types.ts:90`). Migration is an adjacent-only chain: `packages/session/session-format/src/chain.ts:30` rejects any declaration whose `to` is not `from + 1`, and `packages/session/session-format/src/chain.ts:65` requires a complete chain from version 0 to the current version or throws `SessionFormatUnsupportedMigrationError`. A TestPilot reader that writes session events must therefore not assume a format version of its own.

## Tool registry

`packages/core/tools/src/index.ts:106` holds the registry's contributions in `ScopedLayers`, so each scope contributes its own `ToolLayer` and a scope-wide change emits `tools/change`. `packages/core/tools/src/index.ts:65` shows the layer shape: one `ToolLayer` carries the named tool registrations and the anonymous compiled restrictions.

`restrict()` at `packages/core/tools/src/index.ts:162` narrows the global tool set for the calling agent scope. It rejects an empty filter (`packages/core/tools/src/index.ts:169`), rejects a call from an unscoped context (`packages/core/tools/src/index.ts:164`), and returns the exact disposer that lifts the restriction (`packages/core/tools/src/index.ts:160`).

Scope keys come from `packages/core/scope/src/index.ts:137` (`createScope`), `packages/core/scope/src/index.ts:154` (`scopeOf`), and `packages/core/scope/src/index.ts:170` (`scopeTarget`). `scopeTarget` builds a carrier whose filter admits untagged listeners globally and tagged listeners for a matching key or any ancestor (`packages/core/scope/src/index.ts:160`). Events flow up the chain, never down (`packages/core/scope/src/index.ts:164`).

## Tool pipeline

The pipeline has three waterfall stages. Each is a Cordis event with a scope-filtered dispatch.

| Stage | Event | Position | Purpose |
|---|---|---|---|
| pre-execute | `tools/pre-execute` | `packages/core/tools/src/pipeline.ts:201` | allow, deny, cancel, or ask before dispatch |
| execute | `tools/execute` | `packages/core/tools/src/pipeline.ts:307` | around-dispatch timeout, retry, or metrics |
| post-execute | `tools/post-execute` | `packages/core/tools/src/pipeline.ts:496` | accept, replace, enrich, or block a normalized result |

The event declarations are `packages/core/tools/src/events.ts:18`, `packages/core/tools/src/events.ts:29`, and `packages/core/tools/src/events.ts:41`; the registry change notification is `packages/core/tools/src/events.ts:56`.

`packages/core/tools/src/pipeline.ts:201` is the exact position where an approval can be inserted before a browser call. The gate resolves to a `PreToolDecision`, and a decision of kind `ask` is routed to `this.serviceAsk(exec, gate)` at `packages/core/tools/src/pipeline.ts:205`. `packages/core/tools/src/pipeline.ts:440` implements that call: it reads the approval service with `ctx.get('approval')`, degrades to a denial when no service is composed (`packages/core/tools/src/pipeline.ts:445`) or when the execution has no agent to route through (`packages/core/tools/src/pipeline.ts:451`), and maps the four outcomes one-to-one (`packages/core/tools/src/pipeline.ts:466`).

The decision type itself is `packages/core/tools/src/contracts.ts:375`. Its four variants are `allow`, `deny`, `cancel`, and `ask`; no variant carries a risk level.

## Tool timeout and cancellation

`packages/guard/timeout-policy/src/index.ts:25` owns the code `TOOL_TIMEOUT`, used both as the internal deadline classification and as the structured error code on the replacement result. The replacement result is an `isError` result whose `content` is the model-facing message and whose `error.info.code` is the same constant (`packages/guard/timeout-policy/src/index.ts:46`).

The wrapper swaps the signal in and out around the delegate. It saves the upstream signal (`packages/guard/timeout-policy/src/index.ts:65`), installs the derived deadline (`packages/guard/timeout-policy/src/index.ts:66`), and restores the caller's own signal in a `finally` block (`packages/guard/timeout-policy/src/index.ts:78`) so post-execute listeners never see the already-aborted timeout signal. It replaces the tool's own abort result only when its own timer fired, scoped by code so that a nested outer deadline reads as an ordinary upstream cancel (`packages/guard/timeout-policy/src/index.ts:73`).

A tool with no declared `timeoutMs` gets no deadline and is delegated unchanged (`packages/guard/timeout-policy/src/index.ts:59`).

## Agent initiator scope

`packages/AGENTS.md:8` states the rule: initiator-owned private chains derive, then capture. Under `ctx.agents.withInitiator()`, the owner recovers the `Agent` at each orchestration entry, derives `agent.session`, and lets operation-local helpers close over it. `Agent` and `Session` stay explicit at lifecycle, session-log, service, authority, worker/process, persistence, and wire interfaces.

For TestPilot this is the difference between a worker that can reach the session log and one that cannot. A background worker that captures the initiator's session keeps the ability to append session events and to open a turn; a worker that holds only a `Context` has neither.

## TestRun is not a Session

A test run is a domain record, not a session event. It outlives the agent that started it, contains many cases, and must be queryable long after any agent is gone.

`packages/storage/storage-domain/src/domain.ts:1` states the domain runtime's ordering contract: every write awaits backend durability first, then mutates memory, then emits `domain/changed`. A rejected backend write leaves memory untouched, and a backend that reports `unknown-state` quarantines the domain so reads and later writes reject until close (`packages/storage/storage-domain/src/domain.ts:6`).

The ordering is what a test result needs. The session log has the opposite shape: it is append-only and its durability barrier is an explicit `flush` (`packages/session/session-persistence/src/index.ts:131`), with no in-memory authoritative state and no change event.

| Fact | Owner | Reason |
|---|---|---|
| a test project's configuration | the storage domain | durable domain state, not conversation |
| a test plan and its cases | the storage domain | durable domain state |
| a test run and its status | the storage domain | must survive the agent that started it |
| a case result and its assertion outcome | the storage domain | must be queryable across runs |
| a screenshot | the attachment store | binary content has its own durable store |
| the approval decision for a risky action | the session log | the audit pair is already a log-only session event |
| the conversation about a test | the session log | ordinary dialogue |

## Background execution and the Agent requirement

Three background facilities require a live agent, and one does not.

| Facility | Requirement | Evidence |
|---|---|---|
| subagent | requires the exact live parent agent; a stale or replaced parent object is refused | `packages/subagent/subagent/src/index.ts:275` |
| workflow | `parent: Agent` is a required field of the run options | `packages/workflow/workflow/src/runtime-types.ts:30` |
| owned background job | the owner session must currently have a live instance; that instance's disposal cancels and drops the job | `packages/jobs/jobs-local/src/index.ts:372` |
| subprocess | needs no agent: `ctx.subprocess` is a service the runtime acquires by spec | `packages/subprocess/subprocess/src/index.ts:124` |

The subprocess case is the important one for TestPilot. `packages/subprocess/subprocess/src/index.ts:160` declares `spawn(spec: SubprocessSpawnSpec)`, and the spec carries argv, directory, stdio dispositions, grace, cancellation, and environment — no agent anywhere in it. A TestPilot worker can therefore run a child process without an agent, but it cannot obtain an approval context, because the approval seam is agent-scoped.

## Worker lifecycle and resource ownership

`packages/subprocess/subprocess/src/types.ts:187` declares `terminate()` as idempotent, a no-op once the managed range is gone, and also triggered by the spec's abort signal. `packages/subprocess/subprocess/src/types.ts:195` declares `waitForExit(signal?)`: it waits until the same managed range is empty, not just until the spawned command reports its outcome, so surviving work remains observable.

The local implementation stages termination as TERM, then a grace period, then KILL (`packages/subprocess/subprocess-local/src/spawn.ts:365`). The grace timer fires `SIGKILL` after `spec.graceMs` (`packages/subprocess/subprocess-local/src/spawn.ts:372`). The grace timer is deliberately not cleared on cleanup, because forced termination must still reach range survivors after the spawned command settles (`packages/subprocess/subprocess-local/src/spawn.ts:426`).

Ownership is released only once the whole managed range is gone, not at direct-child settlement, so a TERM-trapping helper that outlives the leader stays owned and can still be escalated (`packages/subprocess/subprocess-local/src/index.ts:233`).

Containment has three tiers, selected per launch (`packages/subprocess/subprocess-local/src/index.ts:250`).

| Tier | Platform | Mechanism | Evidence |
|---|---|---|---|
| `linux-scope` | Linux | a user-systemd scope, killed with `systemctl kill --kill-who=all` | `packages/subprocess/subprocess-local/src/index.ts:255`, `packages/subprocess/subprocess-local/src/linux-scope.ts:321` |
| `windows-job` | Windows | a Job Object, when the runner is probeable | `packages/subprocess/subprocess-local/src/index.ts:265` |
| `fallback` | any | weaker containment, with an explicit warning | `packages/subprocess/subprocess-local/src/index.ts:269` |

The fallback warning is unconditional and names the exact gap: descendants that escape the process group or the direct-parent tree are not guaranteed to terminate or to delay `waitForExit()` (`packages/subprocess/subprocess-local/src/index.ts:288`). On macOS the stated reason is that the platform has no supported persistent process-range owner (`packages/subprocess/subprocess-local/src/index.ts:280`).

A TestPilot worker that promises "the browser is closed when the run ends" must not promise it on a platform that selected the fallback tier.

## Further Exploration

- [Approval and security audit](approval-security-audit.md) — the approval seam and the credential boundary.
- [Execution isolation audit](execution-isolation-audit.md) — process containment and network egress.
- [MCP contract audit](mcp-contract-audit.md) — the tool list the browser provider advertises.
- [Phase 0 acceptance](phase-0-acceptance.md) — the checks that gate Phase 1.
