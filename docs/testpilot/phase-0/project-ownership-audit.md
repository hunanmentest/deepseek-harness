# TestPilot Phase 0 — Project ownership audit

English | [中文](project-ownership-audit.zh.md)

This audit answers one question for TestPilot: where a test project belongs, what identity the harness gives an installation, and how a remote caller is allowed to reach a project. It covers work package A10 of the Phase 0 plan and reads only the code in this tree. Every claim carries a file path and a line number.

## Workspace identity

A Workspace is a stable id over one existing directory. The id is a generated uuid, never the path, because path normalization rewrites paths and a reference anchor must stay stable (`packages/workspace/workspace/src/types.ts:16`).

| Property | Rule | Evidence |
|---|---|---|
| Identity | Generated uuid, never the path | `packages/workspace/workspace/src/types.ts:16` |
| Path | The `fs.realpath` canon of the path given at create time; trailing slashes, `..`, and symlinks all resolved | `packages/workspace/workspace/src/types.ts:73-78` |
| Path lifetime | Never rewritten afterwards, even when the directory disappears | `packages/workspace/workspace/src/types.ts:73-78` |
| Title | Defaults to the final path segment; duplicates are allowed | `packages/workspace/workspace/src/types.ts:80` |
| Session account | An ordered candidate account of `SessionId`, filtered synchronously on read | `packages/workspace/workspace/src/types.ts:89-100` |

Path validation has three layers, and the same canon serves all of them.

| Rule | Detail | Evidence |
|---|---|---|
| Fully qualified only | A relative path is rejected before `realpath` can resolve it against the Host cwd or the current Windows drive | `packages/workspace/workspace/src/paths.ts:16-23` |
| One uniqueness canon | Uniqueness is string equality of canonicalized paths, so a symlink to an existing Workspace's directory collides | `packages/workspace/workspace/src/paths.ts:39-51` |
| Canonicalization | `realpathNormalize` is the only implementation, and attach-time session `cwd` checks go through it | `packages/workspace/workspace/src/paths.ts:52-57` |

## The registry

The durable registry is a storage domain record, not a file tree.

| Element | Content | Evidence |
|---|---|---|
| Record schema | `path`, `title`, `sessionIds`, and two ISO-8601 timestamps; `path` is the canon stamped at create | `packages/workspace/workspace/src/spec.ts:24-30` |
| Global state | `workspaceIds` is the authoritative display order; `archivedSessionIds` and `pinnedSessionIds` are registry-global sets layered over Workspace accounting | `packages/workspace/workspace/src/spec.ts:57-65` |
| Domain spec | `defineDomain` with one `workspaces` table plus the bootstrap/order singleton, at version 2 | `packages/workspace/workspace/src/spec.ts:76-84` |
| Required dependencies | The registry injects `storageDomain` and `sessionPersistence`; the persistence dependency is mandatory so an unavailable peer can never be mistaken for an empty history | `packages/workspace/workspace/src/index.ts:186-187` |

Creation is canonicalize, verify, then reuse.

| Step | Rule | Evidence |
|---|---|---|
| Canonicalize | The given path goes through `realpathNormalize` first | `packages/workspace/workspace/src/index.ts:254-255` |
| Must exist | A path that is not an existing directory rejects | `packages/workspace/workspace/src/index.ts:256-258` |
| Idempotent reuse | Repeated calls for the same canonical path return the existing entity without changing its title | `packages/workspace/workspace/src/index.ts:238-244` |

Startup reconstructs the registry from persisted session headers.

| Step | Rule | Evidence |
|---|---|---|
| Reverse grouping | Stored headers are grouped by canonical path, and each group becomes one Workspace with its newest session first | `packages/workspace/workspace/src/index.ts:672-764` |
| Recovery | A stored Workspace whose path matches a group absorbs the historical sessions that are not yet accounted | `packages/workspace/workspace/src/index.ts:719-735` |
| Order | The global order is rebuilt from the group newest-activity times, with the previous order as the tiebreaker | `packages/workspace/workspace/src/index.ts:737-757` |

## The one-owner invariant

Two rules are enforced at startup and are the reason a test project cannot simply be another kind of session entry.

| Rule | Failure | Evidence |
|---|---|---|
| One Workspace per path | A canonical path claimed by two Workspaces is an inconsistent domain and aborts startup | `packages/workspace/workspace/src/index.ts:785-795` |
| One Workspace per session | A session accounted by two Workspaces is an inconsistent domain and aborts startup | `packages/workspace/workspace/src/index.ts:796-805` |

Session membership is decided by the session's own header, not by the Workspace's wish.

| Rule | Detail | Evidence |
|---|---|---|
| Candidate filter | Reading `sessionIds` filters by canonical-cwd index synchronously; a filtered candidate is never returned and the change is not persisted | `packages/workspace/workspace/src/entity.ts:102-104` |
| Attach validation | A new session's header `cwd` must resolve to an existing directory whose realpath equals the Workspace path, otherwise the attach rejects without writing | `packages/workspace/workspace/src/entity.ts:110-150` |
| Rejection reasons | A header without `cwd`, a `cwd` that does not resolve, and a `cwd` that is not a directory are three distinct rejections | `packages/workspace/workspace/src/entity.ts:116-144` |

## Archive admission

Archiving a session consults the composed providers first, so a running turn is never orphaned by an archive.

| Event | Mode and purpose | Evidence |
|---|---|---|
| `workspace/session-activity` | Waterfall. A listener prepends its own activity entries; the registry's innermost callback returns an empty list, and any non-empty result refuses the archive without a write | `packages/workspace/workspace/src/index.ts:129-132` |
| `workspace/session-stop` | Parallel. Cancels the session's running work through the same cancel paths a user's own stop uses | `packages/workspace/workspace/src/index.ts:147` |
| `workspace/session-archived` | Parallel. Admits follow-up work after durable archival and after the stop requests | `packages/workspace/workspace/src/index.ts:156` |
| `workspace/session-unarchiving` | Parallel. Cancels or settles archive follow-up work before the session becomes available again | `packages/workspace/workspace/src/index.ts:163` |

The activity vocabulary is an empty extensible union. This package declares no family; each provider merges its own key from a module both its Host and Client faces import, so a consumer sees exactly the keys its program compiled (`packages/workspace/workspace/src/types.ts:30-42`).

## Anonymous installation identity

The anonymous user id is a random uuid persisted as a bare line in `.anonymous-user-id` inside the harness home resolved by `resolveDshHome` (`$DSH_HOME` > `~/.dsh`).

| Property | Rule | Evidence |
|---|---|---|
| Scope | Scoped to the harness home, not the machine: every process sharing one `$DSH_HOME` reports the same id, and deleting the file mints a fresh identity on the next launch | `packages/identity/anonymous-user-id/src/index.ts:5-9` |
| Derivation | Never derived from the hostname, network address, git remote, or any other identifying source | `packages/identity/anonymous-user-id/src/index.ts:5-9` |
| File format | One file named `.anonymous-user-id`, holding one bare UUID line and no wrapper format | `packages/identity/anonymous-user-id/src/index.ts:29`, `packages/identity/anonymous-user-id/src/index.ts:31` |
| Memoization | The result is memoized per resolved file path, so one process touches the disk once | `packages/identity/anonymous-user-id/src/index.ts:42`, `packages/identity/anonymous-user-id/src/index.ts:98` |
| Concurrent first launch | The file is created with the exclusive `wx` flag; the loser rereads the winner's id | `packages/identity/anonymous-user-id/src/index.ts:68-99` |
| Write failure | Persistence is best-effort: a write failure still returns a usable id so feedback and telemetry are never blocked | `packages/identity/anonymous-user-id/src/index.ts:81-96` |

**Conclusion.** The anonymous id is an identifier for telemetry and feedback. It is not an authorization credential: it carries no secret, it is readable by anything that can read the harness home, and nothing in the Remote access path consults it.

## Remote access

The access decision is method-level and resource-level at the same time.

| Element | Rule | Evidence |
|---|---|---|
| Action shape | A method-level action is the canonical `<namespace>/<method>` endpoint | `packages/api/remote-access/src/types.ts:22-26` |
| Resource shape | A resource-level check names a kind and an id | `packages/api/remote-access/src/types.ts:59-67` |
| Owner | The owner principal is always allowed, and so is the `remoteAccess/follow` action every Peer reads its own snapshot with | `packages/api/remote-access/src/index.ts:202` |
| No policy | A principal kind with no registered policy is denied with reason `no-allow` | `packages/api/remote-access/src/index.ts:203-204` |
| Policy failure | When `bindings()`, a condition, or `explain()` throws, the decision is `policy-failed`, logged once per policy until the next `invalidate()` | `packages/api/remote-access/src/index.ts:205-206`, `packages/api/remote-access/src/index.ts:379-385` |
| Registration | Exactly one policy per non-owner principal kind; a second registration for the same kind throws | `packages/api/remote-access/src/index.ts:153-166` |
| List filtering | A Remote method filters its own result items through `allows()`, which re-reads the policy's bindings on every check | `packages/api/remote-access/src/index.ts:235-244` |
| Snapshot | The page baseline plus a stream of `upsert` and `remove` frames after each invalidation | `packages/api/remote-access/src/index.ts:269-299` |
| Page injection | The access snapshot of the Peer a page speaks for is injected into every rendered index | `packages/api/remote-access/src/index.ts:138-142` |
| Policy contract | Every member of the business-side policy answers synchronously from state the business package holds in memory | `packages/api/remote-access/src/types.ts:89-104` |
| Frame types | One generation opens with one baseline; an owner baseline is the only frame of its generation | `packages/api/remote-access/src/types.ts:138-143` |

The Gateway enforces the order of the two checks. Access precedes lookup resolution, so a refused call activates nothing: no receiver context is resolved, no parameter is decoded for dispatch, and no service is touched (`packages/api/gateway/src/index.ts:802-826`).

## Where a TestProject belongs

**TestProject belongs under a Workspace, with `workspaceId` as the owning foreign key.** It should not be a new top-level container.

| Reason | Detail | Evidence |
|---|---|---|
| A Workspace is already the directory container | The Workspace is a stable id over one existing directory whose path is the unique canon of that directory | `packages/workspace/workspace/src/types.ts:62-78` |
| The repository's ownership model is a resource kind plus an id | The Workspace controller registers `workspace` as a Typert resource kind with a `workspaceId` wire field, and every other controller does the same for its own kind | `packages/api/workspace-controller/src/index.ts:73` |
| Nesting is expressed by foreign key | The registry's own schema stores `sessionIds` inside the Workspace record rather than nesting Workspace records inside Session records | `packages/workspace/workspace/src/spec.ts:24-30` |

**A TestProject is not a Session, and must not be pushed into `workspace.sessionIds`.**

| Reason | Detail | Evidence |
|---|---|---|
| The field is typed for sessions | `sessionIds` is `readonly SessionId[]` | `packages/workspace/workspace/src/types.ts:100` |
| The field is a candidate ledger | It is the ordered candidate account of sessions, filtered synchronously on read | `packages/workspace/workspace/src/types.ts:89-100` |
| Membership reads the session header | Attach validation compares the session header's `cwd` realpath against the Workspace path, so a non-session record can never satisfy it | `packages/workspace/workspace/src/entity.ts:110-150` |
| The invariant is enforced at startup | A session accounted by two Workspaces aborts startup, so a second owner of the same id is a hard failure, not a tolerated state | `packages/workspace/workspace/src/index.ts:796-805` |

**Recommended shape.** TestProject is its own domain record with its own table, and every record carries a `workspaceId: WorkspaceId` foreign key.

```ts
interface TestProjectRecord {
  workspaceId: WorkspaceId
  path: string
  title: string
  createdAt: string
}
```

The ownership check is a path containment rule expressed in the same canon the Workspace already uses: the project's directory must canonicalize to a path below the owning Workspace's canonical path. The same `realpathNormalize` serves both sides of the comparison, so a symlink out of the Workspace directory fails the check the same way it fails the Workspace uniqueness check (`packages/workspace/workspace/src/paths.ts:52-57`).

## Isolation between projects

Isolation between projects is not a property of the project record. It is enforced by two mechanisms that already exist.

| Mechanism | How it isolates | Evidence |
|---|---|---|
| Resource-level decision | A non-owner call is allowed only when, on every listed resource, some binding of the principal's policy names that resource, has a role listing the action, and has no condition or a condition that allows | `packages/api/remote-access/src/index.ts:186-222` |
| Authorization before resolution | The Gateway decides access before it resolves any lookup parameter or receiver context, so a refused call for one project activates nothing that could reach another | `packages/api/gateway/src/index.ts:802-826` |

TestPilot therefore has a concrete obligation: it must register its own resource kind and its own policy, because a kind with no policy is denied with `no-allow` for every non-owner principal (`packages/api/remote-access/src/index.ts:203-204`). The Workspace controller's own `follow` stream shows the shape: it filters both the Workspaces and the Sessions inside a delivered Workspace through `access.allows()` (`packages/api/workspace-controller/src/index.ts:205-260`).

## What TestPilot must not assume

| Assumption | Status |
|---|---|
| A Workspace id is its path | false; the id is a generated uuid and the path is a separate, immutable canon (`packages/workspace/workspace/src/types.ts:16`) |
| A project can live outside its Workspace's directory | false under the recommended rule; containment is checked in the same canon (`packages/workspace/workspace/src/paths.ts:52-57`) |
| A project can be added to `workspace.sessionIds` | false; that field is a session candidate ledger typed `SessionId[]` (`packages/workspace/workspace/src/types.ts:100`) |
| The anonymous user id identifies the installation for access control | false; it is a telemetry and feedback label with no secret and no access role (`packages/identity/anonymous-user-id/src/index.ts:5-9`) |
| A new resource kind works without a policy | false; without a policy every non-owner call on it is denied with `no-allow` (`packages/api/remote-access/src/index.ts:203-204`) |
| Archiving a session always succeeds | false; a non-empty activity result refuses the archive without a write (`packages/workspace/workspace/src/index.ts:129-132`) |
| A second owner of one session id is tolerated | false; the inconsistency aborts startup (`packages/workspace/workspace/src/index.ts:796-805`) |

## Further Exploration

- [Phase 0 acceptance](phase-0-acceptance.md) — the criteria and the open blockers.
- [Storage and persistence audit](storage-persistence-audit.md) — the storage domain layer a TestProject record would sit in.
- [Web platform integration audit](web-platform-integration-audit.md) — how a project reaches a remote caller.
