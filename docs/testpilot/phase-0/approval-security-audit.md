# TestPilot Phase 0 — approval, permission, and credential audit

English | [中文](approval-security-audit.zh.md)

This audit records what the harness enforces when an action needs a decision, and what it does not enforce about secrets. The plan requires risky browser actions to be approved before they occur and requires form passwords to reach a page without reaching the model. Both requirements land on existing seams with different shapes.

## The approval service

`packages/interaction/user-approval/src/index.ts:242` is `request(req: ApprovalRequest)`. The request carries the agent, the tool name, an optional call id, an optional reason, and an optional signal.

The first thing `request` does is check the turn precondition. `packages/interaction/user-approval/src/index.ts:244` throws when the session's projected state does not have an open turn, and the throw happens before anything is appended to the log. The message names the reason: the `approval/asked` and `approval/decided` audit pair must be turn-enclosed, and a bare event between turns is crash-tail garbage on reload (`packages/interaction/user-approval/src/index.ts:245`).

| Order | Step | Evidence |
|---|---|---|
| 1 | the turn precondition is checked, and a violation throws before any append | `packages/interaction/user-approval/src/index.ts:244` |
| 2 | the request id is minted | `packages/interaction/user-approval/src/index.ts:251` |
| 3 | `approval/asked` is appended | `packages/interaction/user-approval/src/index.ts:252` |
| 4 | the decision is reached | `packages/interaction/user-approval/src/index.ts:258` |
| 5 | `approval/decided` is appended | `packages/interaction/user-approval/src/index.ts:259` |

The outcome vocabulary is closed (`packages/interaction/user-approval/src/types.ts:32`): `'allowed-once'`, `'rejected'`, `'cancelled'`, and `'unavailable'`. Only `allowed-once` grants execution.

The `'never'` policy is decided inside the service rather than inside a listener. `packages/interaction/user-approval/src/index.ts:296` explains why: a listener registered with `prepend: true` after this service mounts would sit ahead of any gate listener, so a listener-shaped gate cannot keep the promise that `'never'` rejects deterministically regardless of registration order. The check is at `packages/interaction/user-approval/src/index.ts:301`.

Every failure mode closes the question rather than opening the caller's tool call. `packages/interaction/user-approval/src/index.ts:306` enters the promise chain before dispatching, so a listener that throws synchronously lands in the same rejection path as an asynchronous one. A missing or throwing answerer yields `'unavailable'` (`packages/interaction/user-approval/src/index.ts:317`), and a return value outside the closed vocabulary is normalized to `'unavailable'` (`packages/interaction/user-approval/src/index.ts:314`).

## The approval answerer waterfall

The `approval/request` event is a waterfall (`packages/interaction/user-approval/src/types.ts:87`). The service dispatches it scoped to the request's own agent: `packages/interaction/user-approval/src/index.ts:307` calls `this.ctx.waterfall(scopeTarget(req.agent, req.agent), 'approval/request', req, …)`. An agent-scoped answerer therefore sees only the requests for the agent it owns.

`displayReason` is presentation only. `packages/interaction/user-approval/src/types.ts:73` states it is never persisted in the approval audit events, while `reason` is the asker's own audited explanation.

The audit pair is two log-only session events. They are declared in `packages/interaction/user-approval/src/types.ts:44` and `packages/interaction/user-approval/src/types.ts:55`.

| Event | Fields | Nature |
|---|---|---|
| `approval/asked` | `id`, `toolName`, optional `callId`, optional `reason` | log-only audit; not a surface event |
| `approval/decided` | `id`, `outcome` | log-only audit; exactly one per ask |

## The ask and never policies

`packages/interaction/user-approval/src/index.ts:68` declares the policy union `'ask' | 'never'`, and `packages/interaction/user-approval/src/index.ts:71` lists both values for validation and advertisement.

| Policy | Behaviour | Evidence |
|---|---|---|
| `ask` | delegate to the composed answerers; with none composed the chain falls through to `'unavailable'` | `packages/interaction/user-approval/src/index.ts:62` |
| `never` | never prompt anyone; every ask resolves `'rejected'` deterministically, decided inside the service | `packages/interaction/user-approval/src/index.ts:64`, `packages/interaction/user-approval/src/index.ts:301` |

Both policies are published to the model as a runtime-context entry with distinct sentences, one for each policy (`packages/interaction/user-approval/src/index.ts:74`, `packages/interaction/user-approval/src/index.ts:76`).

## UI and ACP answers

The ACP bridge answers approvals and nothing else. `packages/acp/acp/src/index.ts:158` registers an `approval/request` listener that offers exactly two options: `allow-once` and `reject-once` (`packages/acp/acp/src/index.ts:166`). The bridge never infers a durable grant from an unknown client response (`packages/acp/acp/src/index.ts:156`), and it maps anything other than `allow-once` to `'rejected'` (`packages/acp/acp/src/index.ts:174`).

Free-form questions take a separate path. `packages/interaction/user-questions/src/index.ts:169` is the `answer` remote endpoint: it resolves the pending question, validates that the batch names each question exactly once, and steers the reply into the agent. Two restrictions apply. The caller must be the exact live calling agent (`packages/interaction/user-questions/src/index.ts:139`), and a caller whose session origin is `subagent` is refused with `DELEGATED_CALLER` (`packages/interaction/user-questions/src/index.ts:144`).

## Credential references

The credential seam has two key spaces, and they cannot collide. `packages/credentials/credentials/src/types.ts:14` declares `CredentialRef` as a nominal reference to one credential: a POSIX-style environment-variable name. `packages/credentials/credentials/src/types.ts:29` declares `CredentialKey` as the address of a stored record, `<scope>/<id>`. The `/` keeps the two grammars disjoint (`packages/credentials/credentials/src/types.ts:26`).

The local provider writes plaintext. `packages/credentials/credentials-local/src/index.ts:61` names the file `.credentials.yaml` under the harness home, and `packages/credentials/credentials-local/src/index.ts:717` writes it with mode `0600` and directory mode `0700`. There is no encryption; the protection is the file mode alone. `packages/credentials/credentials-local/src/index.ts:450` renders a reference value straight into the document.

Reading back is masked. `packages/credentials/credentials-local/src/index.ts:522` keeps the provider identifier and a short prefix and suffix, and masks everything between, provided at least eight code points stay hidden; otherwise it masks the whole value. `packages/credentials/credentials-local/src/index.ts:650` is the `describe()` path that returns only the masked form.

Resolution precedence is file, then environment, then dotenv. `packages/credentials/credentials-local/src/index.ts:638` reads the stored value first, `packages/credentials/credentials-local/src/index.ts:641` falls back to the inherited environment, and `packages/credentials/credentials-local/src/index.ts:643` falls back to the `.env` file. The dotenv fallback is explicitly below the managed store, never above it (`packages/credentials/credentials-local/src/index.ts:578`).

## The boundary of secret handling

The `${credential:REF}` template exists in exactly one place. `packages/mcp/mcp-client/src/templates.ts:14` defines the token pattern, and `packages/mcp/mcp-client/src/credentials.ts:83` resolves it — but only across MCP transport strings: the stdio command, args, env, and cwd, or the HTTP url and headers (`packages/mcp/mcp-client/src/credentials.ts:83`, `packages/mcp/mcp-client/src/credentials.ts:94`).

There is no general non-MCP injection channel. A credential reference is a transport-string mechanism for reaching an MCP server, not a general secret-substitution facility that a tool body or a form filler could use.

Redaction is narrower than the injection. The MCP client's redact covers error diagnostics (`packages/mcp/mcp-client/src/tools.ts:163`) and the text of an `isError` result (`packages/mcp/mcp-client/src/tools.ts:160`). It does not cover a successful result, a `structuredContent` payload, or the return value of `resources/read` (`packages/mcp/mcp-client/src/connection.ts:375`).

Template expansion is off unless it is turned on. `packages/mcp/mcp-client/src/index.ts:172` and `packages/mcp/mcp-client/src/index.ts:185` default `expandTemplates` to `false` for both transports. The MCP manager forces it to `true` for every server it manages (`packages/mcp/mcp-manager/src/index.ts:578`).

Client-side masking changes display only. `packages/client/ui-secret-mask/src/client/index.ts:1` states that masking changes only the drawn text; the message text, copy actions, and model input keep the original characters.

## What this means for a test environment

The reference form is usable. A TestPilot configuration can name `${credential:REF}` and the configuration surface shows only the masked form.

Two properties do not hold.

| Claim | Verdict | Evidence |
|---|---|---|
| "the secret never touches disk" | false at the storage layer: the local provider writes plaintext to `.credentials.yaml`, and a `.env` file is a live fallback source | `packages/credentials/credentials-local/src/index.ts:717`, `packages/credentials/credentials-local/src/index.ts:582` |
| "the secret never reaches the model" | false as stated: masking is display-only, and MCP redaction does not cover successful results or `resources/read` | `packages/client/ui-secret-mask/src/client/index.ts:1`, `packages/mcp/mcp-client/src/connection.ts:375` |

A third property is missing rather than false. There is no channel that injects a secret into a browser form while keeping it out of the model context. If TestPilot must type a password into a page, it has to build that channel itself, outside the model-visible transcript.

## Precedents for high-risk approval

The repository contains two precedents for deciding that an action needs a decision. Neither is a per-tool risk registry.

The first combines a sandbox mode with an approval policy. `packages/interaction/permission-presets/src/index.ts:58` declares a preset as a `sandbox` value plus an `approval` value. The default table binds `workspace-write` to `ask` (`packages/interaction/permission-presets/src/index.ts:184`) and `danger-full-access` to `never` (`packages/interaction/permission-presets/src/index.ts:188`). The `auto` preset is a fixed bundle of `danger-full-access` and `ask` (`packages/interaction/permission-presets/src/index.ts:83`). Selecting a preset writes the sandbox mode and the approval policy through their own setters (`packages/interaction/permission-presets/src/index.ts:398`). The sandbox mode vocabulary is `read-only`, `workspace-write`, and `danger-full-access` (`packages/sandbox/sandbox/src/index.ts:38`), and escalation is a strictly widening ladder from `read-only` through `workspace-write` to `danger-full-access` (`packages/sandbox/sandbox/src/escalation.ts:64`); the escalation itself is an execution-time check against the call's effective mode, not a schema constraint (`packages/sandbox/sandbox/src/escalation.ts:212`).

The second is a language-model risk review. `packages/experimental/auto-review/src/index.ts:67` defines three classes and classifies by the actual effect of the pending action, never by the tool name, message tone, or claimed intention. Medium requires an explicit current authorization; high must always be denied even when a user explicitly requests the action (`packages/experimental/auto-review/src/index.ts:69`). A denied call whose session pins the `never` policy becomes a denial (`packages/experimental/auto-review/src/index.ts:770`), and a denied call under an interactive policy becomes an ask, expressed as `PreToolDecision{ kind: 'ask' }` (`packages/experimental/auto-review/src/index.ts:712`).

The gap between them is the thing TestPilot must build. `packages/core/tools/src/contracts.ts:375` declares `PreToolDecision` with exactly four variants — `allow`, `deny`, `cancel`, and `ask` — and no risk level, no tool name, and no policy field. The registry therefore holds nothing from which a risk could be read. The MCP bridge drops the upstream annotations before the registry sees them, as the MCP contract audit records.

A declarative registry that names a tool and assigns it a risk class does not exist in this repository. TestPilot must add one, and it must decide whether it lives on the shared tool contract or inside TestPilot's own composition.

## Further Exploration

- [Execution isolation audit](execution-isolation-audit.md) — what an approved action can still reach.
- [Agent, session, and tool lifecycle audit](session-tool-lifecycle-audit.md) — the pipeline position an approval occupies.
- [MCP contract audit](mcp-contract-audit.md) — the measured tool list and its discarded labels.
- [Architecture decisions](architecture-decisions.md) — the approval decision and its cost.
