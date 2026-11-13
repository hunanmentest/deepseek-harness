# TestPilot Phase 0 — Web platform integration audit

English | [中文](web-platform-integration-audit.zh.md)

This audit records the Host, Client, and Remote API surfaces TestPilot must build on. It covers work package A11 of the Phase 0 plan and reads only the code in this tree. Every claim carries a file path and a line number.

## The Host HTTP service

`packages/host/webserver` is a `node:http` route registrar. It serves no files and holds no business logic: the composing application owns dist serving, and Electron uses `file://` plus IPC instead (`packages/host/webserver/src/index.ts:4-6`).

It offers four extension seats.

| Seat | Registration API | Behavior | Evidence |
|---|---|---|---|
| Named route | `register()` with a handler | The handler owns the full response lifecycle and may hold the response open, for example for SSE | `packages/host/webserver/src/index.ts:52-58`, `packages/host/webserver/src/index.ts:445-452` |
| Named Fetch resource | `register()` with a `resource` | A `WebResource` maps a Fetch `Request` to a `Response` and also answers in-process reads | `packages/host/webserver/src/index.ts:60-74`, `packages/host/webserver/src/index.ts:445-452` |
| WebSocket upgrade | `registerUpgrade()` | An exact-path upgrade whose handler owns protocol negotiation and the upgraded socket | `packages/host/webserver/src/index.ts:454-466` |
| Fallback | `registerFallback()` | One owner answers every request no named route matches; a second registration throws | `packages/host/webserver/src/index.ts:468-483` |

Route matching is ordered: exact match first, then the longest matching prefix, then the fallback (`packages/host/webserver/src/index.ts:646-664`).

Several properties constrain what a TestPilot HTTP surface may assume.

| Property | Rule | Evidence |
|---|---|---|
| In-process read | `readResource()` computes the same response an HTTP request would receive, without an HTTP exchange | `packages/host/webserver/src/index.ts:485-510` |
| No admission inside the read | `readResource()` checks no cookie, Host, or Origin; the caller admits the reader before reading | `packages/host/webserver/src/index.ts:486-499` |
| Bind address | The listen address must be a concrete IPv4 or IPv6 literal of one local interface | `packages/host/webserver/src/index.ts:96-107` |
| Wildcard refusal | An unspecified address is rejected at load, because binding every interface would expose remote code execution to the network | `packages/host/webserver/src/index.ts:358-366` |
| TLS is all or nothing | An unreadable or empty TLS file, invalid PEM, or a mismatched key rejects initialization rather than falling back to HTTP | `packages/host/webserver/src/index.ts:109-118`, `packages/host/webserver/src/index.ts:278-289` |
| Compression | Gzip is skipped for `text/event-stream` responses | `packages/host/webserver/src/index.ts:248` |
| Index injection | The `webserver/index-inject` event collects structured index rows for the Peer a page speaks for | `packages/host/webserver/src/index.ts:44`, `packages/host/webserver/src/index.ts:725-740` |

## The API Gateway

`packages/api/gateway` hard-depends on the Typert registry and the remote access service; neither is optional (`packages/api/gateway/src/index.ts:214-215`). It serves two planes.

| Plane | Carrier | Endpoint | Evidence |
|---|---|---|---|
| Unary call | The Connection service's RPC route | `/api` | `packages/api/gateway/src/index.ts:248-254` |
| Streaming call | The Gateway's own WebSocket mux | `/api/remote.mux` | `packages/api/gateway/src/index.ts:255-324`, `packages/api/gateway/src/stream-protocol.ts:7` |

The two planes are not interchangeable. A stream method opened through the unary carrier fails with `gateway/signature-invalid`, and a unary method opened through the stream carrier fails the same way (`packages/api/gateway/src/index.ts:429-435`, `packages/api/gateway/src/index.ts:463-470`).

The Gateway also owns two internal endpoints for forwarded events: `$events` carries the event stream and `$events/result` returns one Client event outcome (`packages/api/gateway/src/stream-protocol.ts:10`, `packages/api/gateway/src/stream-protocol.ts:13`).

Event forwarding is access-controlled before delivery.

| Rule | Detail | Evidence |
|---|---|---|
| Whole notification or nothing | A non-owner receives an entire notification or nothing; the payload is never trimmed, and a notification with invalid resources reaches no non-owner | `packages/api/gateway/src/index.ts:615-637` |
| Scoped events need an Agent identity | A scoped Remote event without a non-empty Agent identity is rejected | `packages/api/gateway/src/index.ts:639-645` |
| Only the owner answers | Only an owner Peer may answer a forwarded Remote event, and only for its own client generation | `packages/api/gateway/src/index.ts:502-504` |
| Authorization precedes lookup | Access is decided before lookup resolution, so a refused call activates nothing | `packages/api/gateway/src/index.ts:802-826` |

## The three controllers

Each controller is a `TypertRemoteService` with its own Remote namespace, and each registers its own resource kind.

| Controller | Namespace | Resource kind | Endpoints | Evidence |
|---|---|---|---|---|
| Workspace | `workspace` | `workspace`, with a `workspaceId` wire field | Unary create, initializeDefault, rename, delete, insertBefore, insertSessionBefore, archiveSession, unarchiveSession, pinSession, unpinSession; one `follow` stream | `packages/api/workspace-controller/src/index.ts:72`, `packages/api/workspace-controller/src/index.ts:73`, `packages/api/workspace-controller/src/index.ts:90-199`, `packages/api/workspace-controller/src/index.ts:205-260` |
| Job | `job` | none registered by this package | `list` streams the whole-set roster; `follow` streams one job's output and supports resume from an absolute byte offset; `kill` cancels one job | `packages/api/job-controller/src/index.ts:59`, `packages/api/job-controller/src/index.ts:75-78`, `packages/api/job-controller/src/index.ts:90-96`, `packages/api/job-controller/src/index.ts:109-127` |
| Session | `session` | `session`, resolved through a resolve function | The full endpoint set is listed in the generated client declaration | `packages/api/session-controller/src/index.ts:179`, `packages/api/session-controller/src/index.ts:191`, `packages/api/session-controller/lib/typert.remote-client.d.ts:19-45` |

The Workspace feed is the reference shape for a baseline-plus-increment stream.

| Part | Rule | Evidence |
|---|---|---|
| Baseline | The complete current projection is read synchronously from the registry: all active Workspaces plus the archived and pinned Session identities | `packages/api/workspace-controller/src/feed.ts:75-99` |
| Increments | Later frames come from the storage domain's `domain/changed` event: upserts, removals, order changes, archive-set changes, pin-set changes | `packages/api/workspace-controller/src/feed.ts:101-142` |

The Job follow stream adds resume semantics: the request carries an optional absolute byte offset, and the stream starts at the oldest retained byte when it is absent (`packages/api/job-controller/src/types.ts:56-60`).

## The Typert type boundary

Typert is where a Remote method's type becomes a wire contract.

| Element | Rule | Evidence |
|---|---|---|
| Declaration | The `@Remote` decorator marks a public instance method and writes a versioned descriptor onto the class | `packages/typert/protocol/src/index.ts:282-300`, `packages/typert/protocol/src/index.ts:404` |
| Descriptor model | The generator's model records service, namespace, method, mode, invocation kind, parameters, uplink, cancellation, and result boundary | `packages/typert/generator/src/model.ts:129-158` |
| Client declaration | The generator emits the Client-side declaration from the Host FaceModel, headed by a do-not-edit banner | `packages/typert/generator/src/emitter.ts:372-442`, `packages/typert/generator/src/emitter.ts:387` |
| Module merge | The emitted declaration merges into the `TypertRemoteMap` and `TypertRemoteNamespaceMap` interfaces by module augmentation | `packages/typert/generator/src/emitter.ts:403-433` |
| Strict codecs | The emitter generates a strict codec for every boundary | `packages/typert/generator/src/emitter.ts:1154` |
| Two codecs per parameter | Each parameter yields both a `codec` and a `strictCodec` | `packages/typert/generator/src/emitter.ts:335-344` |
| Mount is strict | The client refuses to mount a generated Remote whose parameters lack a strict codec | `packages/api/gateway/src/client/index.ts:302`, `packages/api/gateway/src/client/index.ts:803-818` |
| Host-side matching | The Host matches the exact declared parameter set and validates each present argument once through its codec | `packages/api/gateway/src/index.ts:1630`, `packages/api/gateway/src/index.ts:1665` |
| SRC fallback | The fallback path for a method carrying only a source marker derives its parameters from the JavaScript signature and gives every boundary the `src-json` codec, so the erased object constraints cannot be recovered | `packages/api/gateway/src/index.ts:385-386`, `packages/api/gateway/src/index.ts:401-416`, `packages/api/gateway/src/index.ts:954-961`, `packages/api/gateway/src/index.ts:1010` |

## The Client plugin system

The browser half of a package is a separate entry point, and the node half exists only to make the package an ordinary Loader row. `packages/client/ui-jobs` shows the split: the node half is a no-op body (`packages/client/ui-jobs/src/index.ts:1-9`), and the browser half carries the whole feature, including its locale dictionaries and its slot registration (`packages/client/ui-jobs/src/client/index.ts:1-53`).

| Rule | Detail | Evidence |
|---|---|---|
| Declaration | A package declares its browser half through `dsh.client`, parsed by one validator shared by the node-half scan and the roster generator | `packages/client/modules/src/client/manifest.ts:173-193` |
| Platform filter | A package whose `platform` is not `web` never enters the browser graph | `packages/client/modules/src/index.ts:905` |
| Required export | A declared package must export a `./client` bundle; the absence is a loud failure | `packages/client/modules/src/index.ts:203-214`, `packages/client/modules/src/index.ts:906-909` |
| Graph shape | The composed graph carries entries, batches with a bootstrap or application phase, and a revision anchor | `packages/client/modules/src/client/manifest.ts:52-107` |
| Bundle route | The bundles and package assets are served under one prefix route | `packages/client/modules/src/index.ts:705` |
| Boot injection | The boot script and the `__DSH_BOOT__` global are injected into every rendered index | `packages/client/modules/src/index.ts:602-637`, `packages/client/modules/src/index.ts:710-712` |

Two extension styles exist inside a browser half.

| Style | Rule | Evidence |
|---|---|---|
| Slot injection | A UI plugin injects into an existing named slot and registers its component there | `packages/client/ui-jobs/src/client/index.ts:35-52` |
| Resource | One resource is one address of the form `dsh-resource://<type>/…`; the first frame carries the current value and every later frame carries one change | `packages/client/resources/src/client/contract.ts:1-16`, `packages/client/resources/src/client/contract.ts:60-62`, `packages/client/resources/src/client/contract.ts:71-85` |

## Answers

**Progress subscription goes over the Remote stream carrier, not SSE.** The domain push path in this repository is the Gateway's WebSocket mux. `text/event-stream` appears in the gzip exclusion (`packages/host/webserver/src/index.ts:248`), in the development-only plugin-graph channel (`packages/client/hmr/src/index.ts:168`, `packages/client/hmr/src/client/index.ts:31`), and in upstream LLM and mock servers (`packages/llm/llm-deepseek/src/adapter.ts:146`). None of them is the client push path for domain state.

**The TestPilot Web UI is the `./client` half of the same package.** It is one client module, not a second package and not a standalone front-end application, because the boot graph is composed by the Host and a package enters it only through its `dsh.client` declaration and its `./client` export (`packages/client/modules/src/index.ts:905`, `packages/client/modules/src/index.ts:906-909`).

**State restoration after a browser refresh needs no new mechanism.** The existing mechanism already provides a Host-authoritative baseline plus increments.

| Mechanism | Rule | Evidence |
|---|---|---|
| Generation baseline | A Remote stream opens its generation with the current complete snapshot as its first frame | `packages/api/workspace-controller/src/feed.ts:88-99`, `packages/api/job-controller/src/index.ts:90-96` |
| Exactly one opening snapshot | The protocol layer rejects a stream that emits more than one opening snapshot, or an update before its opening snapshot | `packages/api/gateway/src/client/snapshot-stream.ts:76-88` |
| Cursor resume | A stream client passes its cursor back as `from`, and the Host resumes from that absolute offset | `packages/api/job-controller/src/types.ts:56-60` |
| Loss is marked | When the ring buffer has evicted the bytes between the requested offset and the delivered chunks, the frame carries `lossy` instead of silently dropping data | `packages/api/job-controller/src/types.ts:84-85` |

Browser-local storage is not an alternative. The client projection store is in-memory, so a refresh loses it (`packages/api/session-controller/src/client/sessions/projection-store.ts:92-97`). A TestRun therefore has to be a Host-persisted domain record, and the client reads it back through the same baseline-plus-increment protocol.

**A new TestPilot Remote API must come from the Typert generator as a strict definition.** The SRC marker fallback exists, but it derives parameters from the JavaScript signature and gives every boundary the `src-json` codec, so the erased object constraints are gone (`packages/api/gateway/src/index.ts:954-961`), and the client refuses to mount a descriptor without a strict codec anyway (`packages/api/gateway/src/client/index.ts:803-818`).

## What TestPilot must not assume

| Assumption | Status |
|---|---|
| The Host web server serves the app's files | false; it registers routes only, and the composing application owns dist serving (`packages/host/webserver/src/index.ts:4-6`) |
| A wildcard bind address is acceptable | false; it is rejected at load because it would expose remote code execution to the network (`packages/host/webserver/src/index.ts:358-366`) |
| A missing TLS file downgrades the listener to HTTP | false; initialization rejects instead (`packages/host/webserver/src/index.ts:278-289`) |
| A unary call can be opened over the stream carrier | false; the two carriers reject each other's method mode (`packages/api/gateway/src/index.ts:463-470`) |
| A denied call can still resolve a lookup | false; access precedes lookup resolution (`packages/api/gateway/src/index.ts:802-826`) |
| A non-owner receives a trimmed event payload | false; it receives the whole notification or nothing (`packages/api/gateway/src/index.ts:615-637`) |
| A standalone front-end package can join the boot graph | false; only a `dsh.client` package exporting `./client` enters it (`packages/client/modules/src/index.ts:906-909`) |
| Browser-local storage can restore state after a refresh | false; the client projection store is in-memory (`packages/api/session-controller/src/client/sessions/projection-store.ts:92-97`) |
| A source-marker-only Remote method keeps its object constraints | false; the fallback gives every boundary the `src-json` codec (`packages/api/gateway/src/index.ts:1010`) |

## Further Exploration

- [Project ownership audit](project-ownership-audit.md) — where a test project belongs and how a remote caller reaches it.
- [Evidence and observability audit](evidence-observability-audit.md) — how a test run's evidence is stored and retrieved.
- [Phase 0 acceptance](phase-0-acceptance.md) — the criteria and the open blockers.
