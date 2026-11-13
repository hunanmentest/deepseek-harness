# TestPilot Phase 0 — Evidence and observability audit

English | [中文](evidence-observability-audit.zh.md)

This audit records what the harness can store as evidence, what it reports about a run, and what it does not have. It covers work package A12 of the Phase 0 plan and reads only the code in this tree. Every claim carries a file path and a line number.

## Attachments

The attachment store is content-addressed. A reference carries an id, never a path or a bearer URL.

| Element | Rule | Evidence |
|---|---|---|
| Media types | The raster image vocabulary is exactly PNG, JPEG, WebP, and GIF | `packages/attachment/attachment/src/types.ts:8` |
| Image reference | An opaque storage id, the media type verified from the stored bytes, the exact encoded byte length, and the intrinsic width and height | `packages/attachment/attachment/src/types.ts:11-32` |
| File reference | A content-addressed id that is the sha256 digest of exactly the stored bytes, plus a sanitized display filename; the id is never a filesystem path or a bearer URL | `packages/attachment/attachment/src/types.ts:34-46` |
| Limits | The deployment-resolved limits are per-image bytes, images per message, aggregate message bytes, intrinsic pixels, per-side dimension, and the accepted media types | `packages/attachment/attachment/src/types.ts:73-82` |

Defaults bound an image upload.

| Limit | Default | Evidence |
|---|---|---|
| Bytes per image | 50 MiB | `packages/attachment/attachment-local/src/index.ts:33-34` |
| Images per message | 20 | `packages/attachment/attachment-local/src/index.ts:35-36` |
| Aggregate bytes per message | 200 MiB | `packages/attachment/attachment-local/src/index.ts:37-38` |
| Intrinsic pixels | 64,000,000 | `packages/attachment/attachment-local/src/index.ts:39-40` |
| Per-side dimension | 65,535 px | `packages/attachment/attachment-local/src/index.ts:41-46` |

Admission and commit are separate steps.

| Rule | Detail | Evidence |
|---|---|---|
| Canonical base64 | An upload must be canonical base64; a non-canonical form is rejected before decoding | `packages/attachment/attachment/src/admission.ts:14-28` |
| Batch shape | A batch is validated in full before any member is saved, and members are then committed one at a time in input order | `packages/attachment/attachment/src/index.ts:101-123` |
| Files have no limits | A file carries no admission limits at all: any byte content and length is accepted and stored byte-for-byte | `packages/attachment/attachment/src/index.ts:208-222` |
| Streaming needs backpressure | A streamed file commit and a streamed file read must apply backpressure and must not collect the complete file in memory | `packages/attachment/attachment/src/index.ts:224-257` |
| Orphaned objects | A storage failure returns no partial references, but already published content-addressed objects may stay unreachable until a future retention policy collects them | `packages/attachment/attachment/src/index.ts:93-97` |

On disk, the local backend stores objects below a versioned root with a two-level content-addressed sharding.

| Element | Rule | Evidence |
|---|---|---|
| Root | `join(dshHome, 'attachments', 'v1')` | `packages/attachment/attachment-local/src/index.ts:180` |
| File path | The digest names a directory so the sanitized display name stays the stored leaf name, giving two levels of sharding under `files` | `packages/attachment/attachment-local/src/file-store.ts:75` |

## Deliverables

Two packages deliver artifacts, and neither copies a file's contents.

The `present` tool declares existing files as final deliverables.

| Element | Rule | Evidence |
|---|---|---|
| Tool | Registered as `present`, a scoped tool inside its owning Session | `packages/deliverables/tool-present/src/index.ts:38` |
| Parameters | Only `path` and `description`; the tool declares files and never copies their contents | `packages/deliverables/tool-present/src/index.ts:53` |
| Path rules | The target must be an existing regular file; a directory, a missing path, or a non-regular file rejects | `packages/deliverables/tool-present/src/index.ts:88-95` |
| Event | A successful result appends a `deliverables/presented` event carrying the turn, the call id, and the file list | `packages/deliverables/tool-present/src/index.ts:106-108` |
| Event shape | The event carries `turn`, `callId`, and `files`, each file carrying a path and an optional description | `packages/deliverables/tool-present/src/types.ts:11-17` |

The `workspace-changes` plugin summarizes what a turn changed.

| Element | Rule | Evidence |
|---|---|---|
| Host service | The Host exposes `summary` and `diff` for a Session and event sequence | `packages/deliverables/workspace-changes/src/index.ts:116-120` |
| Subscription | The plugin observes `turn/start`, `tool/result`, and `turn/end` | `packages/deliverables/workspace-changes/src/index.ts:145-153` |
| Lifetime | A summary lives only until its Session is disposed; the `session/disposed` event forgets it | `packages/deliverables/workspace-changes/src/index.ts:9`, `packages/deliverables/workspace-changes/src/index.ts:154` |
| Temporary copies | Scratch directories are created below the platform temporary root | `packages/deliverables/workspace-changes/src/index.ts:136`, `packages/deliverables/workspace-changes/src/recorder.ts:270` |
| Summary shape | The summary carries the turn, the working directory, the changed files in display order, the complete file count, the added and deleted line counts, and the optional git snapshot ids | `packages/deliverables/workspace-changes/src/types.ts:23-41` |

## Telemetry

The OTel entry offers two independent channels, and neither shares state with the other.

| Channel | Scope | Evidence |
|---|---|---|
| `createEventReporter` | An ordinary-event channel with count-based batching; the injected consumer must drain it during its fiber disposal | `packages/telemetry/otel/src/index.ts:22` |
| `createSessionLogReporter` | A byte-bounded Session-log channel; authorization and redaction precede reporting | `packages/telemetry/otel/src/index.ts:30` |

The product-event contract forbids content, and the attributes carry no automatic identity.

| Rule | Detail | Evidence |
|---|---|---|
| Body | The body is a human-readable summary; it is never a prompt, a response, a credential, or file contents | `packages/telemetry/otel/src/event-log.ts:20` |
| Attributes | The attributes are the business fields the caller selected; there is no automatic device or account identity | `packages/telemetry/otel/src/event-log.ts:26` |
| Forwarding | The product telemetry backend forwards only the fields the caller chose | `packages/host/product-telemetry-otel/src/index.ts:118-120` |

The Session-log channel serializes the whole event and refuses an oversized record.

| Rule | Detail | Evidence |
|---|---|---|
| Payload | The whole event is JSON-serialized into the `content` attribute | `packages/telemetry/otel/src/session-log.ts:216` |
| Byte ceiling | The collector request ceiling is 4,000,000 uncompressed bytes | `packages/telemetry/otel/src/session-log.ts:12` |
| Over-limit | A record above the ceiling is rejected whole; its content is never truncated | `packages/telemetry/otel/src/session-log.ts:102-105` |
| Transport | The transport does not inherit ambient credentials | `packages/telemetry/otel/src/transport.ts:45-61` |
| Queue | A full queue drops the record with a warning | `packages/telemetry/otel/src/session-log.ts:89-92` |

The capture side owns the redaction extension point, and it ships no rules.

| Element | Rule | Evidence |
|---|---|---|
| Extension point | The `session-telemetry/record` waterfall is the redaction extension point; this package ships no rules of its own | `packages/session/session-telemetry/src/index.ts:44` |
| No listener | The innermost `next()` passes the record through unchanged, so with no listener mounted records reach the backend exactly as captured | `packages/session/session-telemetry/src/index.ts:26-39` |
| Record contract | A record carries a source event, a channel, a time, a pre-mapped severity, an identity attribute set, and the payload | `packages/session/session-telemetry/src/index.ts:65-91` |
| Execution point | The waterfall runs at capture time, inside the coordinator's containment | `packages/session/session-telemetry/src/coordinator.ts:206` |
| Fail-closed | A throwing listener withholds that one record and never reaches the agent loop | `packages/session/session-telemetry/src/coordinator.ts:246-252` |
| Capture mode | Capture either follows live events or reads the canonical log only when requested | `packages/session/session-telemetry/src/coordinator.ts:30` |
| Identity attributes | The identity attribute set is minimal and omits anything recoverable from the body | `packages/session/session-telemetry/src/coordinator.ts:291-305` |

The shipped OpenTelemetry session backend defaults to feedback-only sharing.

| Rule | Detail | Evidence |
|---|---|---|
| Default mode | `FEEDBACK_ONLY` | `packages/session/session-telemetry-otel/src/index.ts:37` |
| Authorization | Only an explicit feedback event of the same Session authorizes replay; fork seeds do not | `packages/session/session-telemetry-otel/src/index.ts:43-51` |
| Identity | The OTLP resource carries the anonymous user id, not an account identity | `packages/session/session-telemetry-otel/src/index.ts:198` |

## Capabilities that do not exist

This repository has no HTML report facility, no Playwright trace artifact, and no video recording facility.

| Capability | Status | Evidence |
|---|---|---|
| HTML report | absent; no report package exists and no report renderer is registered | the `packages/` tree contains no report, trace, or video package |
| Playwright trace | absent; no `trace.zip` is produced anywhere in `packages/` | the `packages/` tree contains no trace-writing code |
| Video recording | absent; no recorder is registered in the browser or inspector packages | the `packages/` tree contains no video writer |
| Inspector | The inspector performs live CDP observation only; it publishes captured fetch observations to the Inspector Worker and never writes a trace artifact to disk | `packages/experimental/inspector/src/shared/network/observation.ts:1`, `packages/experimental/inspector/src/host/inspection/network.ts:5-7` |

## Answers

**The evidence model splits structured evidence from binary evidence.**

| Kind | Where it lives | What the domain record holds | Evidence |
|---|---|---|---|
| Structured evidence: run, case, assertion, conclusion | A storage domain record | The whole record | The Workspace domain shows the shape: a `defineDomain` spec with one table and a version (`packages/workspace/workspace/src/spec.ts:76-84`) |
| Binary evidence: screenshot, trace, video | The attachment store | An `attachmentId` reference only | The reference carries an id and metadata, never the bytes and never a path (`packages/attachment/attachment/src/types.ts:11-46`) |

The precedent is the MCP bridge. An image block in an MCP result is decoded, admitted against the model's declared input modalities, and stored through the attachment store; the model then receives an attachment reference, and the raw bytes stay on the program side (`packages/mcp/mcp-client/src/tools.ts:333-338`, `packages/mcp/mcp-client/src/tools.ts:371-403`).

The `workspace-changes` precedent shows why a summary is not a report. Its summary is served only while its Session lives and is forgotten when the Session is disposed (`packages/deliverables/workspace-changes/src/index.ts:9`, `packages/deliverables/workspace-changes/src/index.ts:154`), so it does not survive as a long-lived report.

**An HTML report is a file in the attachment store, referenced from the domain.** It is not a new storage subsystem.

| Step | Rule | Evidence |
|---|---|---|
| Store | The report is committed as a verbatim file, so it carries no admission limit and is stored byte-for-byte | `packages/attachment/attachment/src/index.ts:208-222` |
| Reference | The domain record holds only the content-addressed `attachmentId` | `packages/attachment/attachment/src/types.ts:39-46` |
| Retrieve | An authenticated HTTP read returns the file, with `Content-Security-Policy: sandbox; default-src 'none'` on the response | `packages/api/session-controller/src/media-references.ts:17-24`, `packages/api/session-controller/src/media-references.ts:26-67` |
| Render | The client may render the document inside a sandboxed iframe whose bootstrap injects the bytes into an opaque origin | `packages/client/ui-sidebar-documentpreview/src/client/html/bootstrap.ts:24-46` |

**Retention must be built by TestPilot.** Neither the storage layer nor the attachment layer has one.

| Layer | Status | Evidence |
|---|---|---|
| Attachment store | No retention mechanism exists; a failed commit may leave published objects unreachable until a future retention policy collects them | `packages/attachment/attachment/src/index.ts:93-97` |
| Storage domain | The domain layer offers tables, a global singleton, and change events; it carries no expiry or collection policy | `packages/workspace/workspace/src/spec.ts:76-84` |

**Redaction in this tree is narrow, and it is not a secret firewall.**

| Mechanism | What it covers | Evidence |
|---|---|---|
| MCP redact | A narrow filter over the text of an error diagnostic and of an `isError` result; it does not cover a successful result, `structuredContent`, or the value of a `resources/read` return | `packages/mcp/mcp-client/src/tools.ts:159-163`, `packages/mcp/mcp-client/src/credentials.ts:34-36` |
| Session telemetry redact | An extension point that ships zero rules, so the exported data is as clean as the rules a deployment mounts | `packages/session/session-telemetry/src/index.ts:44` |
| Client secret mask | A display-only mask: it changes the drawn text while the message text, the copy actions, and the model input keep the original characters | `packages/client/ui-secret-mask/src/client/index.ts:1-6` |

**AI failure analysis reads attachment references and structured records only.**

| Rule | Detail | Evidence |
|---|---|---|
| Readable | The analysis may read the domain's structured records and the attachment references those records carry | `packages/attachment/attachment/src/types.ts:11-46` |
| Not readable | The analysis must not read the credential store; the credential provider resolves values behind the MCP template binding, which is the only component that touches them | `packages/mcp/mcp-client/src/credentials.ts:55-95` |
| Grounded | An analysis conclusion must be able to cite real execution evidence, so a conclusion without a record or a reference behind it does not qualify | The attachment id is a content-addressed digest of exactly the stored bytes (`packages/attachment/attachment/src/types.ts:34-46`) |

## What TestPilot must not assume

| Assumption | Status |
|---|---|
| The attachment store can hold a video | false; the media vocabulary is PNG, JPEG, WebP, and GIF, and a video would have to be stored as a verbatim file (`packages/attachment/attachment/src/types.ts:8`) |
| A file upload is size-limited like an image | false; files carry no admission limits at all (`packages/attachment/attachment/src/index.ts:208-222`) |
| An attachment reference points at a path | false; the reference carries a content-addressed id and never a filesystem path or a bearer URL (`packages/attachment/attachment/src/types.ts:34-46`) |
| A failed attachment commit leaves nothing behind | false; published objects may stay unreachable until a retention policy collects them (`packages/attachment/attachment/src/index.ts:93-97`) |
| `present` copies a deliverable's contents | false; it declares a path and a description (`packages/deliverables/tool-present/src/index.ts:53`) |
| A workspace-changes summary outlives its Session | false; `session/disposed` forgets it (`packages/deliverables/workspace-changes/src/index.ts:154`) |
| Product telemetry may carry a prompt or a response | false; the body contract forbids it (`packages/telemetry/otel/src/event-log.ts:20`) |
| An oversized session-log record is truncated | false; the whole record is rejected (`packages/telemetry/otel/src/session-log.ts:102-105`) |
| Session telemetry redacts by itself | false; the extension point ships zero rules (`packages/session/session-telemetry/src/index.ts:44`) |
| The client secret mask protects the model input | false; it changes only the drawn text (`packages/client/ui-secret-mask/src/client/index.ts:1-6`) |
| The harness can produce an HTML report or a trace artifact | false; no such facility exists, and the inspector only observes live (`packages/experimental/inspector/src/host/inspection/network.ts:5-7`) |
| Attachments expire on their own | false; TestPilot must build retention (`packages/attachment/attachment/src/index.ts:93-97`) |

## Further Exploration

- [Project ownership audit](project-ownership-audit.md) — where a test project and its records belong.
- [Web platform integration audit](web-platform-integration-audit.md) — how a client reads the run state back.
- [Phase 0 acceptance](phase-0-acceptance.md) — the criteria and the open blockers.
