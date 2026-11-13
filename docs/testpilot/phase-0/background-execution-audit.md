# TestPilot Phase 0 — background execution: jobs, workflow, PTC, and subagents

English | [中文](background-execution-audit.zh.md)

This audit records the four background facilities the harness already provides, what each one requires, and which of them a deterministic test executor may reuse. It covers the Jobs registry, the Workflow engine, the PTC runtime, and the subagent tree. Every claim carries a file path and a line number.

## Scope and verdict

| Question | Answer |
|---|---|
| Which facility may a deterministic test executor reuse? | `ctx.subprocess`, because it is the only seam with a managed-range quiescence contract. |
| Which facility must it not reuse? | PTC, Jobs, Workflow, and Subagent, each for a different stated reason. |
| Does a background execution unit need a live Agent? | No. `ctx.subprocess` has no Agent concept at all. |
| Where must approval happen? | Before the work enters the background, inside the initiating Agent's own turn. |
| What is the deterministic approval policy? | `ApprovalPolicy = 'never'`, decided inside the service before any dispatch. |
| Does a crashed worker stay recoverable? | Yes, and the guarantee comes from `ctx.subprocess`, not from PTC. |

## The four background facilities

| Question | Jobs | Workflow | PTC | Subagent |
|---|---|---|---|---|
| What it is | a registry of background producers under one owner | an engine that runs a model-authored script | a runtime that evaluates a program in an isolated substrate | the mechanism that creates another Agent |
| What it executes | a producer's own work | `agent()` calls and the script's combinators | a program plus its bindings | a full model turn |
| Needs a live Agent | yes for an owned job | yes; `parent: Agent` is a required field | no | yes; the exact live parent |
| Concurrency ceiling | 10 active jobs per owner | `min(16, cores - 2)` concurrent agents, 1000 in total | one run at a time per state owner | 8 live children per subagent tree |
| Cancellation | the producer's `cancel` hook, then the `stopping` state | `cancel()` aborts the run and its children | an abort signal that resolves the run with `abort` | `interrupt()` is fire-and-return |
| Resource ownership | the registry owns identity, state, and the output ring; the producer owns execution resources | the holder owns the run and must call `dispose()` | the runtime owns the substrate and must terminate and await in-flight runs | the manager owns the activation and its capacity slot |
| Failure expression | a settled record with a status and a detail | `result` never rejects; the outcome is in `stopReason` | `error.kind` on a resolved result | a child result carrying a stop reason |

The failure row is the one that separates these facilities from each other, and from what a test runner needs. A test failure must be distinguishable from an infrastructure failure, from a cancellation, and from a timeout. Only PTC makes that distinction explicit, and it does so for a different purpose.

## Jobs

### The abstract seam

`packages/jobs/jobs/src/index.ts:89` is the abstract registry. Its semantics are stated as a list of rules an implementation must honour.

| Rule | Statement | Evidence |
|---|---|---|
| Owner and service disposal | cancel live work and await compliant producers; a throwing teardown cancel force-fails only the record, and such settlements announce `cause: 'teardown'` | `packages/jobs/jobs/src/index.ts:58` |
| Owner fencing | owned-job access is fenced by the owner's session id; ids are predictable, so authorization rather than secrecy is the boundary | `packages/jobs/jobs/src/index.ts:63` |
| Settlement | first-wins: one terminal record, released waiters, then one round of contained event delivery, even against a late producer outcome | `packages/jobs/jobs/src/index.ts:65` |
| `start` admission | refuses work while no attached job controller serves the spec's owner, so a producer cannot start work that owner cannot collect or stop | `packages/jobs/jobs/src/index.ts:73` |
| Retention | bounded; appends past the live cap drop the oldest retained bytes, and a reader below the retained window gets a lossy read rather than an error | `packages/jobs/jobs/src/index.ts:84` |

The producer contract is small and strict.

| Member | Rule | Evidence |
|---|---|---|
| `owner` | the owner's live Agent must be the one currently registered under that id; its disposal cancels and awaits the job, and omitting the owner creates an unowned job open to any caller until service disposal | `packages/jobs/jobs/src/types.ts:186` |
| `cancel(reason?)` | must be synchronous, idempotent, and eventually settle `done`; throws propagate | `packages/jobs/jobs/src/types.ts:160` |
| `done` | resolves after the producer releases its resources, not merely when the work finishes, and must not reject | `packages/jobs/jobs/src/types.ts:165` |
| `run(job)` | called once with the job's producer face after preflight; a throw leaves nothing registered, and the producer must clean up any partially started resources | `packages/jobs/jobs/src/types.ts:206` |

### The local implementation

`packages/jobs/jobs-local/src/index.ts` is the shipped implementation, and its limits are the concrete numbers a test runner would hit.

| Property | Value | Evidence |
|---|---|---|
| Active job ceiling | 10 per exact owner | `packages/jobs/jobs-local/src/index.ts:34` |
| Live ring retention | 256 KiB per job | `packages/jobs/jobs-local/src/index.ts:37` |
| Settled ring retention | 16 KiB | `packages/jobs/jobs-local/src/index.ts:40` |
| `start` admission | the controller check comes first, then the per-owner active count, then the id allocation | `packages/jobs/jobs-local/src/index.ts:214` |
| Producer start | `run` is called synchronously, before the job is registered | `packages/jobs/jobs-local/src/index.ts:252` |
| Owner resolution | the owner session must currently have a live agent, or the call throws `JOB_OWNER_NOT_LIVE` | `packages/jobs/jobs-local/src/index.ts:372` |
| Kill | cancel first, so a throw leaves lifecycle state unchanged, and only then set `stopping` | `packages/jobs/jobs-local/src/index.ts:495` |
| Settlement | first-wins; the waiters are released before the `settled` event is emitted | `packages/jobs/jobs-local/src/index.ts:614` |
| Owner disposal | cancel and await every job of that owner, then drop the records | `packages/jobs/jobs-local/src/index.ts:666` |
| Service disposal | cancel all, await settlement, drop every record, then detach the owner effects | `packages/jobs/jobs-local/src/index.ts:685` |

The status vocabulary has exactly five values: `running`, `stopping`, `completed`, `killed`, and `failed` (`packages/jobs/jobs/src/view.ts:19`). A producer reports three of them (`packages/jobs/jobs/src/types.ts:71`).

### Model-visible tools and completion notices

| Tool | Purpose | Evidence |
|---|---|---|
| `job_output` | read a background job's output, optionally waiting for it to finish | `packages/jobs/tool-jobs/src/index.ts:433` |
| `job_list` | list the jobs visible to the caller | `packages/jobs/tool-jobs/src/index.ts:548` |
| `job_kill` | request cancellation of a background job | `packages/jobs/tool-jobs/src/index.ts:570` |

Completion delivery is the pattern worth borrowing. `packages/jobs/tool-jobs/src/index.ts:370` is the delivery function: a settlement with `cause: 'teardown'` or with no owner is not delivered at all, and the destination is the agent currently registered for the owner session. When the owner is idle and a wakeup budget allows it, the notice is a `followup` that wakes the driver; otherwise it degrades to an `inject` that queues model-facing context without waking it (`packages/jobs/tool-jobs/src/index.ts:398`). A settlement the model already collected is not delivered twice (`packages/jobs/tool-jobs/src/index.ts:424`).

## Workflow

### The engine seam

`packages/workflow/workflow/src/index.ts:157` is the abstract engine. Its contract states three things a consumer may rely on: a live run is holder-owned, its result never rejects, and disposal waits for script and child cleanup. Lifecycle listener failures are contained and logged rather than propagated (`packages/workflow/workflow/src/index.ts:175`).

The start request carries the parent as a required field. `packages/workflow/workflow/src/runtime-types.ts:31` declares `parent: Agent`, and `packages/workflow/workflow/src/runtime-types.ts:17` gives the reason: every `agent()` spawned by the script is attributed to that live Agent. The run handle itself is `packages/workflow/workflow/src/runtime-types.ts:40`.

### The PTC-backed implementation

`packages/workflow/workflow-ptc/src/index.ts:134` is the shipped engine. The script is compiled into a PTC program and runs in its own Node process, and the host resolves the limits before publishing the run.

| Limit | Value | Evidence |
|---|---|---|
| Concurrent agents | `min(16, cores - 2)` when the configured value is zero | `packages/workflow/workflow-ptc/src/index.ts:142` |
| Total agent calls | 1000 | `packages/workflow/workflow-ptc/src/index.ts:109` |
| Items per combinator call | 4096 | `packages/workflow/workflow-ptc/src/index.ts:110` |
| Host-side preflight | the body is parsed and discarded; nothing executes | `packages/workflow/workflow-ptc/src/index.ts:55` |
| Deadline | `timeoutMs: null`, so the program has no time limit of its own | `packages/workflow/workflow-ptc/src/host.ts:298` |

### Host bindings and failure layering

`packages/workflow/workflow-ptc/src/host.ts:178` defines the five JSON bindings the guest may call: `begin`, `startChild`, `childResult`, `disposeChild`, and `progress`. `startChild` is a subagent, not a process: it calls `this.subagents.startActivation` with `parent: this.parent` (`packages/workflow/workflow-ptc/src/host.ts:200`), so a workflow child is a full Agent.

Cancellation is first-wins: the first call records the reason and aborts the controller, and later calls return without changing anything (`packages/workflow/workflow-ptc/src/host.ts:151`).

The script runs inside a PTC process's own `vm` context (`packages/workflow/workflow-ptc/src/runtime.ts:83`), and the `agent()` hook distinguishes two failure classes that matter to a test runner.

| Failure | Layer | Behaviour | Evidence |
|---|---|---|---|
| The child agent itself failed | recoverable | the hook returns `null` and the script keeps running | `packages/workflow/workflow-ptc/src/runtime.ts:221` |
| The provider broke | fatal | the hook throws, and the run stops | `packages/workflow/workflow-ptc/src/runtime.ts:196` |
| A `parallel()` thunk threw | recoverable | the item becomes `null` | `packages/workflow/workflow-ptc/src/runtime.ts:285` |
| A `pipeline()` stage threw | recoverable | the item becomes `null` and its remaining stages are skipped | `packages/workflow/workflow-ptc/src/runtime.ts:311` |
| A fatal error inside a combinator | fatal | it propagates and kills the whole script | `packages/workflow/workflow-ptc/src/runtime.ts:304` |

The recoverable class is the problem for TestPilot. A single child failure collapses to `null`, so the script cannot tell a failed child from a child that produced an empty result.

## PTC

### The abstract seam

`packages/ptc-runtime/ptc-runtime/src/index.ts:109` is the abstract runtime. Its contract states that implementations must treat programs as hostile peers, isolate distinct state owners, and terminate and await in-flight runs during disposal (`packages/ptc-runtime/ptc-runtime/src/index.ts:102`). The `isolation` member is a lowercase descriptor of the execution substrate — `worker-thread`, `process`, or `container` — and is informational rather than a security claim (`packages/ptc-runtime/ptc-runtime/src/index.ts:122`). `release(owner)` releases an owner's retained environment (`packages/ptc-runtime/ptc-runtime/src/index.ts:142`).

A run never rejects. The failure taxonomy is a closed set of eight kinds on a resolved result.

| Kind | Meaning | Evidence |
|---|---|---|
| `exception` | the program threw or failed to parse or transform | `packages/ptc-runtime/ptc-runtime/src/types.ts:141` |
| `timeout` | an implementation-owned budget expired | `packages/ptc-runtime/ptc-runtime/src/types.ts:142` |
| `abort` | the request's `signal` fired | `packages/ptc-runtime/ptc-runtime/src/types.ts:143` |
| `worker-exit` | the execution substrate died without settling | `packages/ptc-runtime/ptc-runtime/src/types.ts:144` |
| `invalid-output` | the completion value was not lossless JSON | `packages/ptc-runtime/ptc-runtime/src/types.ts:145` |
| `output-limit` | the serialized outer logs, value, or diagnostic exceeded the configured cap | `packages/ptc-runtime/ptc-runtime/src/types.ts:146` |
| `protocol` | the program sent invalid or over-budget control traffic | `packages/ptc-runtime/ptc-runtime/src/types.ts:147` |
| `sandbox-unavailable` | the required confinement could not be established | `packages/ptc-runtime/ptc-runtime/src/types.ts:148` |

`packages/ptc-runtime/ptc-runtime/src/types.ts:157` states the rule that makes this usable at all: an error is a field on a resolved result, never a rejection of `run()`. Reporting a failed program is the caller's job, not an exception path. The abort semantics are in `packages/ptc-runtime/ptc-runtime/src/types.ts:110`: the runtime stops the program hard, even mid-loop, and in-flight binding calls remain the caller's to settle.

### The Node implementation

`packages/ptc-runtime/ptc-runtime-node/src/index.ts:28` declares `isolation = 'process'`.

| Property | Statement | Evidence |
|---|---|---|
| Isolation | one Node process per program environment | `packages/ptc-runtime/ptc-runtime-node/src/index.ts:28` |
| Service disposal | the service effect drains: every live run is aborted and awaited, and the execution resources are disposed | `packages/ptc-runtime/ptc-runtime-node/src/index.ts:47` |
| Policy change | a new run waits for the previous policy's process cleanup before it is admitted | `packages/ptc-runtime/ptc-runtime-node/src/index.ts:133` |
| State ownership | one managed process holds all mutable program state | `packages/ptc-runtime/ptc-runtime-node/src/worker.ts:40` |
| Concurrent runs | the same state owner refuses a concurrent run | `packages/ptc-runtime/ptc-runtime-node/src/worker.ts:82` |
| Process creation | the worker process is created through `ctx.subprocess.spawn` | `packages/ptc-runtime/ptc-runtime-node/src/worker.ts:329` |
| Process death | the run fails with `worker-exit` | `packages/ptc-runtime/ptc-runtime-node/src/worker.ts:416` |
| Termination | `terminate()` is idempotent and reuses one shared promise | `packages/ptc-runtime/ptc-runtime-node/src/worker.ts:251` |
| Pipe drain | termination awaits both the command's outcome and the managed range emptying | `packages/ptc-runtime/ptc-runtime-node/src/output-stream.ts:38` |

The last row is the precise reason PTC inherits its recovery guarantee. `packages/ptc-runtime/ptc-runtime-node/src/output-stream.ts:43` awaits `handle.done` and `handle.waitForExit()` together, and `waitForExit` waits until the whole managed range is empty, not merely until the spawned command reports its outcome (`packages/subprocess/subprocess/src/types.ts:195`). The containment and the quiescence come from the subprocess seam; PTC only turns a crash into a decidable `error.kind === 'worker-exit'`.

## Subagent

`packages/subagent/subagent/src/index.ts:194` is the runtime, and it is the facility that most looks like a test worker without being one.

| Property | Value | Evidence |
|---|---|---|
| Live child ceiling | 8 by default | `packages/subagent/subagent/src/index.ts:197` |
| Delegation depth | 1 by default | `packages/subagent/subagent/src/index.ts:196` |
| Start requirement | the parent must be the exact live agent currently registered under that id, or the call throws `UNAUTHORIZED` | `packages/subagent/subagent/src/index.ts:275` |
| `interrupt()` | fire-and-return: the cancel signal is issued before the call returns, but the target may keep running until it observes the signal | `packages/subagent/subagent/src/index.ts:392` |
| `drainDescendants()` | closes admission and stops all instances in the selected subagent trees, then awaits pending startup and cleanup | `packages/subagent/subagent/src/index.ts:404` |

Capacity is shared, not per parent. `packages/subagent/subagent/src/activation.ts:14` declares the pool as process-local capacity shared by every member of a subagent tree, and `packages/subagent/subagent/src/manager.ts:791` keeps one pool per tree root. Exceeding it is a refusal, not a queue: `packages/subagent/subagent/src/activation.ts:23` throws `ACTIVATION_LIMIT_REACHED` when the pool is full. The tree root owns the shared capacity (`packages/subagent/subagent/src/activation.ts:51`).

The stop reason of a child comes from the child's own log. `packages/subagent/subagent/src/lifecycle.ts:81` folds the epoch's own session events to decide it, and `packages/subagent/subagent/src/lifecycle.ts:104` returns `error` for a reason it cannot name — because treating an unnameable reason as success would report failed work as completed. Deriving the reason from the disposal path instead would report the same failure as a completion.

## What a deterministic test executor should reuse

### Why PTC does not fit

PTC is built for model-authored programs that may misbehave. `packages/ptc-runtime/ptc-runtime/src/index.ts:106` requires implementations to treat programs as hostile peers. Its failure semantics are self-correcting: the failure message is written to be fed back to a model (`packages/ptc-runtime/ptc-runtime/src/types.ts:153`). And the same state owner refuses a concurrent run (`packages/ptc-runtime/ptc-runtime-node/src/worker.ts:82`), which is a constraint a test suite with parallel cases would fight. A deterministic executor needs the opposite: a failure that is a result to be asserted on, not a self-correction prompt.

### Why Jobs does not fit

An owned job requires a live owner Agent: `packages/jobs/jobs/src/types.ts:186` states the owner's live Agent must be the one currently registered under that id, and `packages/jobs/jobs-local/src/index.ts:372` refuses with `JOB_OWNER_NOT_LIVE` when the session has no live instance. The state machine has five values and no room for a per-case result (`packages/jobs/jobs/src/view.ts:19`). The concurrency ceiling is 10 active jobs per owner (`packages/jobs/jobs-local/src/index.ts:34`), which caps a parallel suite at a number unrelated to the suite's own plan. And `start` refuses work while no attached job controller serves the owner (`packages/jobs/jobs/src/index.ts:73`), which couples the test runner's composition to a model-facing controller.

### Why Workflow does not fit

Every step of a workflow script is an `agent()` call (`packages/workflow/workflow-ptc/src/runtime.ts:86`), so a workflow run costs model turns for work that is deterministic. The parent Agent is mandatory (`packages/workflow/workflow/src/runtime-types.ts:31`), and a single child failure collapses to `null` (`packages/workflow/workflow-ptc/src/runtime.ts:221`) — which directly contradicts the requirement that a test failure be distinguishable from an empty result.

### Why Subagent does not fit

A subagent is another Agent (`packages/subagent/subagent/src/index.ts:194`). It runs a full model turn, it needs the exact live parent (`packages/subagent/subagent/src/index.ts:275`), and its capacity is a shared refusal rather than a schedule (`packages/subagent/subagent/src/activation.ts:23`). A test case that must produce a deterministic assertion cannot be a model turn.

### What to reuse: `ctx.subprocess`

The subprocess seam is the one facility whose contract matches a deterministic worker.

| Property | Statement | Evidence |
|---|---|---|
| Agent concept | none; the spawn spec carries argv, cwd, stdio, grace, a signal, and the environment | `packages/subprocess/subprocess/src/types.ts:77` |
| Termination | `terminate()` is idempotent, a no-op once the managed range is gone, and also triggered by the spec's abort signal | `packages/subprocess/subprocess/src/types.ts:187` |
| Quiescence | `waitForExit()` waits until the whole managed range is empty, so surviving work stays observable | `packages/subprocess/subprocess/src/types.ts:195` |
| Containment | three tiers, selected per launch, with an explicit warning naming the gap on the weakest tier | `packages/subprocess/subprocess-local/src/index.ts:250` |

The containment tiers matter for a promise like "the browser is closed when the run ends". On the weakest tier, descendants that escape the process group or the direct-parent tree are not guaranteed to terminate (`packages/subprocess/subprocess-local/src/index.ts:288`).

## Approval and the background worker

`ctx.subprocess` has no Agent concept, so a background execution unit does not need a live Agent. That is the good news and the source of the constraint: the approval seam is agent-scoped, so a worker that is not an agent cannot ask.

| Rule | Consequence for TestPilot | Evidence |
|---|---|---|
| Approval is granted inside the initiating Agent's turn | the request rejects when no turn is open, so the decision must be made before the work enters the background; the worker only executes already-approved actions | `packages/interaction/user-approval/src/index.ts:244` |
| A worker that needs new approval must return to a live Agent | the Jobs completion-notice channel is exactly that pattern: a user message delivered to the owner's inbox | `packages/jobs/tool-jobs/src/index.ts:384` |
| The delivery modes | `followup` wakes an idle driver; `inject` queues context for the next step without waking it | `packages/core/agent/src/runtime-types.ts:252` |
| The deterministic policy | `ApprovalPolicy = 'never'`; every ask resolves `rejected` deterministically, with no answerer involved | `packages/interaction/user-approval/src/index.ts:64` |
| Where it is decided | inside the service, before any dispatch, so a listener cannot reorder the outcome | `packages/interaction/user-approval/src/index.ts:296` |

The `never` policy is the right choice for a CI-shaped run for three reasons that the source states rather than implies. It decides in the service, so the outcome does not depend on any answerer being composed. It decides before dispatch, so registration order cannot change the result. And it is deterministic, so a test run does not branch on whether a human was present.

A worker still needs the ability to report upward. The Jobs completion notice is the model of that: the producer's outcome becomes a user message and is delivered to the owner's inbox, either as a wakeup when the owner is idle (`packages/jobs/tool-jobs/src/index.ts:398`) or as a queued injection otherwise.

## Further Exploration

- [Session, tool, and worker lifecycle audit](session-tool-lifecycle-audit.md) — agent ownership, and the worker lifecycle the subprocess seam provides.
- [Storage, persistence, and migration audit](storage-persistence-audit.md) — where a test run's records live and how they evolve.
- [Phase 0 acceptance](phase-0-acceptance.md) — the criteria and the open blockers.
