# TestPilot Phase 0 — storage, persistence, and migration audit

English | [中文](storage-persistence-audit.zh.md)

This audit records where a TestPilot record can live, what the harness guarantees about it, and what TestPilot must supply itself. It covers the storage hub, the domain data form, the JSON and SQLite backends, the session event log, and the attachment store. Every claim carries a file path and a line number.

## Scope and verdict

| Question | Answer |
|---|---|
| Does the harness already have a durable home for TestProject, TestPlan, TestCase, TestRun, and TestResult? | Yes: the storage hub plus the domain data form, with two shipped backends. |
| Does a domain record carry its own version? | No. A domain carries a unit-level version stamp, and there is no value-migration runner. |
| Is the session log a substitute for the domain? | No. The session log is an append-only event stream with no authoritative in-memory state and no change event. |
| Can two processes write one domain? | Not safely. The storage layer has no cross-process write ownership; the session layer does. |
| Does the storage layer collect anything on its own? | No. Retention and collection are TestPilot's responsibility. |
| Is a run a session event? | No. A run outlives the agent that started it and must stay queryable after every agent is gone. |

## The storage hub

`packages/storage/storage/src/index.ts:1` states the hub's own contract in the first paragraph: it is a named backend registry plus mounted data-form facilities, and the hub itself performs no IO — backends own the media, data forms own the semantics.

| Public member | Purpose | Evidence |
|---|---|---|
| `ctx.storage.backend` | the named backend table; multiple backends stay mounted side by side | `packages/storage/storage/src/index.ts:49` |
| `ctx.storage.mount(form, facility)` | mounts one data form and returns the disposer that unmounts it | `packages/storage/storage/src/index.ts:64` |
| `ctx.storage.form(form)` | resolves one mounted data form; throws `form-not-mounted` when it is absent | `packages/storage/storage/src/index.ts:82` |
| `ctx.storage.domain` | the domain data form, present once the domain layer plugin is loaded | `packages/storage/storage/src/index.ts:90` |

Routing is not in the hub. `packages/storage/storage/src/registry.ts:9` says which backend serves which consumer is the consumer's own configuration — the domain layer's route table — and never a hub-global choice. The hub therefore holds two tables and no policy: names to backends, and form names to facilities.

Backend registration is an effect, not a state mutation with a lifetime of its own. `packages/storage/storage/src/registry.ts:25` returns the disposer that removes the name, and the disposer is guarded so that a stale disposer firing after a re-registration cannot remove the successor. Disposal does not close the backend; the owning plugin closes it after unregistering.

The backend-facing unit descriptor is where the version policy lives. `packages/storage/storage/src/backend.ts:47` declares it.

| Field | Meaning | Evidence |
|---|---|---|
| `version` | the current unit format version, stamped on initial materialization and on subsequent mutations | `packages/storage/storage/src/backend.ts:51` |
| `compatibleVersions` | older unit versions whose stored records the owner vouches are still readable under the current schemas | `packages/storage/storage/src/backend.ts:75` |
| `layout` | `single` keeps the whole unit in one document; `per-record` keeps each record in its own document | `packages/storage/storage/src/backend.ts:64` |

`packages/storage/storage/src/backend.ts:56` explains why `per-record` exists: a unit whose records are large or sparse never rewrites the rest on one write, and an unaccepted document reads as absent instead of rejecting the whole unit.

The hub's error vocabulary is a closed set of eight codes (`packages/storage/storage/src/error.ts:7`): `backend-not-found`, `form-not-mounted`, `duplicate-backend`, `duplicate-mount`, `version-mismatch`, `malformed-medium`, `unknown-state`, and `closed`. `unknown-state` is the one that changes control flow: it means the readable or durable state of a unit is no longer knowable, so every later operation on that unit rejects until it is closed (`packages/storage/storage/src/backend.ts:122`).

## The storage domain

### Declaring a domain

`packages/storage/storage-domain/src/spec.ts:1` states the rule the whole layer rests on: a spec object is the single source of a domain's identity, layout, and record schemas, and record schemas are zod. `defineDomain` pins the literal types and validates the fields (`packages/storage/storage-domain/src/spec.ts:107`), so a misconfigured domain fails loud at the owning package's module load, before any medium is touched.

| Field | Meaning | Evidence |
|---|---|---|
| `name` | the domain name; it must match `UNIT_NAME_RE` and doubles as the backend unit name | `packages/storage/storage-domain/src/spec.ts:37` |
| `version` | the current domain format version; reads enforce it according to the selected layout | `packages/storage/storage-domain/src/spec.ts:39` |
| `layout` | `single` or `per-record` | `packages/storage/storage-domain/src/spec.ts:47` |
| `compatibleVersions` | older domain versions whose stored records the current record schemas also accept | `packages/storage/storage-domain/src/spec.ts:56` |
| `invalidRecords` | `backup-and-skip`, for domains whose records are disposable derived data | `packages/storage/storage-domain/src/spec.ts:67` |
| `global` | the optional global singleton slot, with its schema and its pre-first-write value | `packages/storage/storage-domain/src/spec.ts:69` |
| `tables` | the table declarations, keyed by table name | `packages/storage/storage-domain/src/spec.ts:71` |

`domainTable<K, V>(schema)` declares one table and attaches a phantom compile-time key type (`packages/storage/storage-domain/src/spec.ts:91`). The key type never exists at runtime; keys are plain strings on the medium.

Four validations fire at load time and each one has a reason.

| Validation | Rule | Evidence |
|---|---|---|
| version | must be a non-negative integer | `packages/storage/storage-domain/src/spec.ts:111` |
| `compatibleVersions` | every entry must be a non-negative integer strictly below the current version | `packages/storage/storage-domain/src/spec.ts:114` |
| global schema | must not accept `null`, because `null` is the medium's "never written" sentinel and a stored `null` could not round-trip | `packages/storage/storage-domain/src/spec.ts:140` |
| `invalidRecords` | only `backup-and-skip` is accepted, and only for disposable derived data; the default is to reject the whole open | `packages/storage/storage-domain/src/spec.ts:57` |

The `backup-and-skip` path moves the offending record's document aside, logs the concrete failure with its cause, and continues with the record absent (`packages/storage/storage-domain/src/index.ts:131`). A backend with no document to move falls back to the rejecting default, and the global slot always rejects.

### The write chain and its ordering

`packages/storage/storage-domain/src/domain.ts:1` states the ordering contract that makes the domain layer usable as a durable record store: every write queues on the domain's single chain, awaits backend durability first, then mutates memory, then emits `domain/changed`. A rejected backend write leaves memory untouched, so reads never disagree with the medium. The chain itself is one promise tail (`packages/storage/storage-domain/src/domain.ts:167`).

| Primitive | Semantics | Evidence |
|---|---|---|
| `put(key, value)` | overwrite; the value is the full new record, with no partial merge | `packages/storage/storage-domain/src/domain.ts:340` |
| `delete(key)` | resolves `true` when the record existed and `false` when it was already absent; the absent case writes nothing and emits nothing | `packages/storage/storage-domain/src/domain.ts:348` |
| `deleteMany(keys)` | one job on the write chain and one backend call; resolves the number of keys that existed and were removed | `packages/storage/storage-domain/src/domain.ts:360` |
| `update(key, fn)` | atomic read-modify-write; `fn` sees the value current at its queue slot, and a missing key rejects with `missing-key` | `packages/storage/storage-domain/src/domain.ts:375` |
| `close()` | rejects new writes immediately, drains already-queued writes whose events still emit, releases the backend unit, then frees the domain name | `packages/storage/storage-domain/src/domain.ts:251` |

Two failure modes are separated deliberately. An ordinary backend rejection leaves memory unchanged, so the domain stays usable. A backend that reports `unknown-state` quarantines the whole domain: reads and later writes reject with that error, and only `close()` still works (`packages/storage/storage-domain/src/domain.ts:283`, `packages/storage/storage-domain/src/domain.ts:303`). The quarantine is per domain, not per table.

### Change events and errors

`packages/storage/storage-domain/src/events.ts:11` defines the change payload, and `packages/storage/storage-domain/src/events.ts:34` closes it as a union on the operation discriminant.

| Field | Meaning | Evidence |
|---|---|---|
| `domain` | the owning domain name | `packages/storage/storage-domain/src/events.ts:13` |
| `table` | the table name; `''` for a global-singleton write | `packages/storage/storage-domain/src/events.ts:15` |
| `key` | the record key; `''` for a global-singleton write | `packages/storage/storage-domain/src/events.ts:17` |
| `operation` | `put` or `deleted`; there is no other value | `packages/storage/storage-domain/src/events.ts:22` |
| `value` | the new snapshot on a `put`; absent on a delete | `packages/storage/storage-domain/src/events.ts:24` |

The event never carries the old value. A diffing consumer keeps its own previous snapshot, because the payload is the new state at emission, not a delta.

The domain error vocabulary has five codes (`packages/storage/storage-domain/src/error.ts:7`): `already-open`, `facet-unsupported`, `invalid-record`, `missing-key`, and `closed`. `invalid-record` is the only one that carries a location, and the location names the offending table and key (`packages/storage/storage-domain/src/error.ts:15`). Backend failures pass through unchanged: `packages/storage/storage-domain/src/error.ts:29` states that the domain layer does not rewrap them, so a consumer can still switch on `version-mismatch` or `unknown-state` directly.

### Opening a domain

`packages/storage/storage-domain/src/index.ts:103` is the open sequence, and each step fails the whole call.

| Step | Failure code | Evidence |
|---|---|---|
| the name is already open or reserved | `already-open` | `packages/storage/storage-domain/src/index.ts:104` |
| the resolved backend name is not registered | `backend-not-found`, passed through from the hub | `packages/storage/storage-domain/src/index.ts:110` |
| the routed backend has no `kv` facet | `facet-unsupported` | `packages/storage/storage-domain/src/index.ts:112` |
| the unit opens against the stored stamp | `version-mismatch` or `malformed-medium`, passed through | `packages/storage/storage-domain/src/index.ts:117` |
| a stored record fails its zod schema | `invalid-record` with the table and key, unless `backup-and-skip` applies | `packages/storage/storage-domain/src/index.ts:126` |
| the global value fails its schema | `invalid-record` for the global slot | `packages/storage/storage-domain/src/index.ts:151` |

The route is resolved per domain, not globally: `packages/storage/storage-domain/src/index.ts:109` reads `this.config.routes?.[spec.name] ?? this.config.backend`, so one plugin configuration can send one domain to SQLite and another to the JSON tree.

Concurrent opens of the same domain name fail loud. The facility reserves a name before the awaits begin (`packages/storage/storage-domain/src/index.ts:70`), and the reservation is released unconditionally on any failure (`packages/storage/storage-domain/src/index.ts:171`).

### What the domain layer does not provide

| Capability | Status | Evidence |
|---|---|---|
| Cross-table transactions | absent; each write targets one table or the global slot | `packages/storage/storage-domain/README.md:147` |
| Secondary indexes | absent | `packages/storage/storage-domain/README.md:147` |
| Multi-segment keys | absent | `packages/storage/storage-domain/README.md:147` |
| Value-migration runner | absent; `compatibleVersions` admits older data for the current decoder, and the consumer converts values when it rewrites selected records | `packages/storage/storage-domain/README.md:148` |
| Record-level version field | absent; a unit stamp cannot distinguish different meanings of identical fields in mixed rows | `docs/subsystems/storage.md:100` |
| Cross-process change push | absent; `domain/changed` is an in-process event | `packages/storage/storage-domain/README.md:146` |

The last two rows are the ones that shape the evolution procedure. A domain record has no version of its own, and the storage layer will not rewrite an incompatible value for a consumer.

## The two backends

### The JSON backend is files, not memory

`packages/storage/storage-json/src/index.ts:1` describes the backend as one human-readable document per unit under a configured root, published by atomic rewrite. The root has no default on purpose (`packages/storage/storage-json/src/index.ts:22`): a `process.cwd()` fallback would scatter unit files wherever the process happened to start, so an assembly states the location explicitly.

| Layout | Path shape | Key rule | Evidence |
|---|---|---|---|
| `single` | `<root>/<name>.json` | keys stay opaque | `packages/storage/storage-json/src/single-unit.ts:34` |
| `per-record` | `<root>/<name>/<table>/<key>.json` | a key becomes a path segment and must match `[a-zA-Z0-9_-]+` | `packages/storage/storage-json/src/per-record-unit.ts:57` |

The publish protocol is write a same-directory temporary file, fsync it, then rename over the target (`packages/storage/storage-json/src/atomic.ts:24`). Rename is an atomic replace on POSIX and on Windows, and last-write-wins is correct here because a unit file has exactly one writer per process. The parent directory is fsynced on POSIX after the rename, so the new entry is crash-durable.

The two layouts differ in what they hold in memory. A `single` unit keeps the whole unit in memory as the authoritative state and rewrites the entire file on every write, including a batch delete (`packages/storage/storage-json/src/single-unit.ts:77`). A `per-record` unit holds no state of its own — the directory is the state — and `loadAll` re-reads the tree (`packages/storage/storage-json/src/per-record-unit.ts:1`). That difference is why a failed `single` publish must roll memory back: the memory is authoritative, so a rejected write must not survive there or ride along with the next publish (`packages/storage/storage-json/src/single-unit.ts:83`, `packages/storage/storage-json/src/single-unit.ts:108`).

Version stamps are treated differently by the two layouts, and the difference is a design choice rather than an accident.

| Case | `single` layout | `per-record` layout |
|---|---|---|
| the stored stamp is outside the accepted set | the whole open rejects with `version-mismatch` | the document reads as an absent record |
| one document is malformed | the whole open rejects with `malformed-medium` | the document reads as an absent record |
| a document is damaged during a run | not applicable | `backupRecord` moves it to `<key>.json.bak.<timestamp>`, and the moved file no longer ends in `.json`, so every later read ignores it while the bytes stay on disk |

The evidence for those three rows is `packages/storage/storage-json/src/format.ts:66`, `packages/storage/storage-json/src/format.ts:117`, and `packages/storage/storage-json/src/per-record-unit.ts:305`.

### The SQLite backend

`packages/storage/storage-sqlite/src/schema.ts:9` imports `DatabaseSync` from `node:sqlite`. There is no third-party driver in this package; the backend runs on the Node built-in.

| Property | Value | Evidence |
|---|---|---|
| Physical layout version | `STORAGE_SQLITE_SCHEMA_VERSION = 1`, stored in `PRAGMA user_version` | `packages/storage/storage-sqlite/src/schema.ts:20` |
| Relationship to a unit version | orthogonal; the unit's own version is stamped per unit in the `units` row | `packages/storage/storage-sqlite/src/schema.ts:15` |
| Physical schema change | reject only; this unreleased format has no migrations, so any other stamped version rejects | `packages/storage/storage-sqlite/src/schema.ts:18` |
| First write | the data and the version stamp commit in one transaction | `packages/storage/storage-sqlite/src/unit.ts:152` |
| Rollback also fails | the unit reports `unknown-state` and the backend must be closed and reopened | `packages/storage/storage-sqlite/src/unit.ts:160` |
| Journal mode | `wal` by default; `memory` and `off` are excluded because they drop journal durability | `packages/storage/storage-sqlite/src/schema.ts:26` |
| In-memory database | `:memory:` opens an in-process database | `packages/storage/storage-sqlite/src/index.ts:26` |

The two version stamps answer different questions, and conflating them is the usual mistake. `PRAGMA user_version` describes the table layout of the database file. The `units.version` column describes the format of one unit's records. Bumping the unit version does not require a new physical layout, and a new physical layout does not change how any unit's records are read.

### Backend comparison

| Question | JSON backend | SQLite backend |
|---|---|---|
| What is the medium | a file-tree root holding one document per unit | one database file hosting every routed unit |
| Where a unit version lives | in the document header for `single`, in each record document for `per-record` | in the `units` row, beside the `PRAGMA user_version` physical stamp |
| What an unaccepted version does | `single` rejects with `version-mismatch`; `per-record` reads the document as absent | the unit rejects with `version-mismatch` |
| How one write is published | one atomic whole-file replacement | one transaction per write or batch |
| What a failed publish leaves | the previous file, except after a directory-fsync failure that can arrive after the replacement | the previous data and stamp, unless the rollback itself fails |
| Cross-process write ownership | none beyond whatever the caller supplies | SQLite's own file locking |
| Best fit for TestPilot | a human-readable plan tree and a per-record result tree | one file holding both the plan and the run history |

The last row is a judgement, not a fact from the source. The distinguishing facts are that a `per-record` write rewrites one document instead of the whole unit, and that SQLite commits a write and its version stamp together.

## Session persistence and the version chain

The session log is the other durable store in the harness, and it is shaped differently from the domain layer. It is append-only, and the model history is derived from the `SessionEvent` stream rather than stored separately.

| Property | Statement | Evidence |
|---|---|---|
| Current format version | `SESSION_FORMAT_VERSION = 4` | `packages/core/session/src/types.ts:90` |
| Migration shape | adjacent only; a declaration whose `to` is not `from + 1` is rejected | `packages/session/session-format/src/chain.ts:30` |
| Chain completeness | a complete chain from version 0 to the current version is required, or the build throws | `packages/session/session-format/src/chain.ts:65` |
| Newer stored format | refused; a stored version above the current one rejects | `packages/session/session-format/src/chain.ts:81` |
| Event log | contiguous from seq 0 and never rewritten | `packages/session/session-persistence/src/index.ts:127` |
| Torn tail | never returned to a reader, and truncated by the write path before its first append | `packages/session/session-persistence/src/index.ts:128` |
| Unknown vocabulary | reads validate current-format records only and refuse unknown vocabulary fail-closed | `packages/session/session-persistence/src/index.ts:130` |
| Durability barrier | `append` persists best-effort; `flush`, per handle or service-wide, is the barrier | `packages/session/session-persistence/src/index.ts:131` |
| Cross-process write ownership | a kernel-level lock: `flock(2)` on POSIX, a named kernel semaphore on Windows | `packages/session/session-persistence-jsonl/src/lease.ts:3` |

The lock is the one cross-process write mechanism in this part of the harness. `packages/session/session-persistence-jsonl/src/lease.ts:70` is the acquire path, and contention maps to `SessionAlreadyOwnedError`. The kernel releases the lock when the holder's descriptor closes, including on process death, and there is deliberately no expiry, because an expiry could expropriate a stalled writer whose resumed appends would tear the log (`packages/session/session-persistence-jsonl/src/lease.ts:11`).

Two consequences for TestPilot. A checkpoint that must survive a crash has to await `flush`; awaiting `append` alone is not a durability claim. And a domain record that must be visible to a second process cannot rely on `domain/changed`, which is an in-process event.

## Two precedents to copy

The harness already contains two worked examples of a domain that changed shape without a migration runner. They are the templates for TestPilot's own evolution procedure.

### Precedent one: schedule

`packages/schedule/schedule/src/storage.ts:134` declares the schedule domain at version 2 with `compatibleVersions: [1]`, and `packages/schedule/schedule/src/storage.ts:62` declares the version-2 task schema so that it still accepts version-1 rows. New metadata is optional on disk, normal decoding does not write, and the next edit or delivery writes the current shape. One schema, two accepted generations, one bumped stamp.

### Precedent two: workspace

`packages/workspace/workspace/src/spec.ts:57` declares the workspace global state, and two of its fields carry a default so that records written before those fields existed still parse (`packages/workspace/workspace/src/spec.ts:62`). The domain itself is declared at version 2 (`packages/workspace/workspace/src/spec.ts:76`), and the consumer opens it through `ctx.storageDomain.open`, closes it as its own effect, and takes the typed table and global handles (`packages/workspace/workspace/src/index.ts:215`).

The workspace is also the precedent for the consumer side of the contract: the owning package owns the open handle and its teardown, and the facility closes only the domains a consumer left open.

## Attachments

Binary evidence does not belong in a domain record. The attachment store exists for it, and it has its own admission rules.

| Limit | Default | Evidence |
|---|---|---|
| Accepted media types | png, jpeg, webp, gif | `packages/attachment/attachment/src/types.ts:8` |
| Maximum encoded bytes per image | 50 MiB | `packages/attachment/attachment-local/src/index.ts:34` |
| Maximum images per message | 20 | `packages/attachment/attachment-local/src/index.ts:36` |
| Maximum aggregate image bytes per message | 200 MiB | `packages/attachment/attachment-local/src/index.ts:38` |
| Maximum intrinsic pixels per image | 64,000,000 | `packages/attachment/attachment-local/src/index.ts:40` |
| Maximum pixels on one side | 65,535 | `packages/attachment/attachment-local/src/index.ts:46` |
| File uploads, any format | no admission limit at all | `packages/attachment/attachment/src/index.ts:210` |

The limit structure itself is `packages/attachment/attachment/src/types.ts:74`. The last row is the one that needs a TestPilot-side answer: `packages/attachment/attachment/src/index.ts:208` states that files carry no admission limits, that any byte content and length is accepted, and that the stored object is the exact submitted bytes. A video recording therefore passes the attachment layer whatever its size.

Two reference shapes exist. `ImageAttachmentRef` (`packages/attachment/attachment/src/types.ts:11`) describes one immutable normalized raster, with its media type verified from the stored bytes. `FileAttachmentRef` (`packages/attachment/attachment/src/types.ts:39`) describes one verbatim stored file, and its `attachmentId` is the sha256 digest of exactly those bytes.

The store is content-addressed with a two-level shard: `packages/attachment/attachment-local/src/store.ts:53` derives `objects/<first two hex characters>/<sha256>`. An upload is validated before it is stored, and the wire form must be canonical base64 (`packages/attachment/attachment/src/admission.ts:15`).

## Where TestPilot records live

### The storage choice

TestProject, TestPlan, TestCase, TestRun, and TestResult belong to `dsh-storage` and `dsh-storage-domain`, and they do not belong to the session event log. Two existing consumers show the shape of the decision.

`packages/workspace/workspace/src/spec.ts:76` declares a domain for the workspace registry, and `packages/workspace/workspace/src/index.ts:215` opens it through `ctx.storageDomain.open`, holds the typed handles, and closes it as its own effect. `packages/schedule/schedule/src/storage.ts:134` declares the schedule domain and routes it to a named backend.

The session log is the wrong home for the same reason a test run is not a session: the session log has no authoritative in-memory state, its barrier is an explicit `flush`, and it has no change event to query. A test plan must be read as a whole, mutated field by field, and survive the agent that wrote it.

The recommended split follows the two declared layouts (`packages/storage/storage/src/backend.ts:64`).

```text
testpilot_plan   layout=single       tables: projects, plans, cases
testpilot_run    layout=per-record   tables: runs, results
```

The plan domain holds the authored artifacts — small, read together, and cheap to rewrite as a whole. The run domain holds the execution artifacts — large, written one at a time, and disposable individually, which is exactly the case `per-record` exists for. Routing the two to different backends is possible and costs nothing: the route table is per domain (`packages/storage/storage-domain/src/index.ts:109`).

### The evolution procedure

| Situation | Procedure | Evidence |
|---|---|---|
| A new optional field | extend the same schema and give the field a default, so records written before it still parse | `packages/workspace/workspace/src/spec.ts:62` |
| A new required field, or a field whose meaning changed | bump `version`, move the old version into `compatibleVersions`, and make the current schemas accept both generations | `packages/schedule/schedule/src/storage.ts:135` |
| A change old readers cannot decode | ship an explicit, recoverable upgrade step that runs before the new schema opens the unit | `docs/subsystems/storage.md:110` |
| Table removal, or a change of layout | requires its own retention and upgrade policy; a compatible stamp alone defines neither | `docs/subsystems/storage.md:108` |

The order of preference is therefore: optional field with a default first, then version plus `compatibleVersions` for a change that old readers can still decode, and only then an incompatible change, which must carry a one-shot, recoverable upgrade step of its own. Because there is no migration runner, a domain that skipped a version must still accept the oldest stamp it claims to support: `docs/subsystems/storage.md:110` states that a reader accepting stamp 2 must also accept stamp 1 for users who skipped version 2 entirely.

### Large files

| Artifact | Reference | Store | Evidence |
|---|---|---|---|
| Screenshot | `ImageAttachmentRef` | the attachment store, as a normalized raster | `packages/attachment/attachment/src/types.ts:11` |
| Video recording | `FileAttachmentRef` | the attachment store, byte for byte | `packages/attachment/attachment/src/types.ts:39` |
| Either, referenced from a domain record | the reference object only | the bytes stay in the attachment store | `packages/attachment/attachment/src/types.ts:34` |

A domain record stores the reference, never the bytes. Two reasons make that non-negotiable. The JSON `single` layout republishes the whole file on every write (`packages/storage/storage-json/src/single-unit.ts:77`), so a base64 payload in a record makes each write rewrite every payload in the domain. And the attachment layer enforces no file-size limit, so the quota for a video has to be TestPilot's own, applied before the write.

## Concurrency, retention, and collection

| Question | Answer | Evidence |
|---|---|---|
| Two tasks in one process writing one domain | safe; one write chain per domain, and `update` runs at its chain slot | `packages/storage/storage-domain/src/domain.ts:167` |
| Two processes writing one domain | not safe; the storage layer has no cross-process write ownership | `packages/storage/storage-domain/README.md:146` |
| Atomic batch delete | available; `deleteMany` is one job on the write chain and one backend call | `packages/storage/storage-domain/src/domain.ts:360` |
| Retention or collection in the storage layer | absent; the unit contract has no list, sweep, age, or retention member | `packages/storage/storage/src/backend.ts:88` |
| Retention or collection in the attachment layer | absent; published objects may stay unreachable until a future retention policy collects them | `packages/attachment/attachment/src/index.ts:95` |
| The one related primitive | `backupRecord` moves one document aside and preserves its bytes for inspection | `packages/storage/storage/src/backend.ts:153` |

A TestPilot run writes to the run domain from one worker process, so the process-local guarantee is enough for the common case. Two workers writing the same domain need a lock TestPilot supplies itself. The only kernel-level write exclusivity in this part of the harness belongs to the session layer (`packages/session/session-persistence-jsonl/src/lease.ts:3`), and it guards a session artifact directory, not a storage domain.

Because neither layer collects anything, TestPilot owns the whole retention story: which runs are eligible for collection, which attachment objects a collected run releases, and what the object sharding makes cheap to find.

## Further Exploration

- [Session, tool, and worker lifecycle audit](session-tool-lifecycle-audit.md) — agent and session ownership, and why a test run is not a session.
- [Background execution audit](background-execution-audit.md) — the seams a test worker may and may not reuse.
- [Phase 0 acceptance](phase-0-acceptance.md) — the criteria and the open blockers.
