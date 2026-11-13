---
description: "Optional Web quality platform bundle with isolated evidence, run-scoped approval, origin and attach policy, quality gates, reports and health metrics."
kind: "package-bundle"
---

# @deepseek-ai/dsh-testpilot

English | [中文](README.zh.md)

## Summary

TestPilot is an optional bundle that contributes one plugin row. It owns test projects, plans, runs, cases and results, a versioned snapshot registry, a locator validator, risk classification, a run-scoped approval gate, an origin and attach policy, evidence references, a deterministic quality gate, four report formats and health metrics. No shipped bundle inserts the row, so default profiles have none of its tools until the bundle is added.

## Use this package

```sh
dsh plugin --profile web add @deepseek-ai/dsh-testpilot
dsh --profile web --dump-config
```

The patch inserts one row with id `testpilot`. Enable, disable or reconfigure that row from the Plugins page or a profile `cordis.patch.yml`; a patch replaces the whole `config` of the row.

| Config | Default | Contract |
| --- | --- | --- |
| `dataDir` | `''` | Durable store root. Empty selects `<cwd>/.testpilot`. JSON documents are written atomically through a unique sibling and renamed into place. |
| `allowedOrigins` | `[]` | Origins the browser may reach. Empty rejects every navigation (fail closed). Redirects are checked hop by hop by TestPilot. |
| `policyVersion` | `'1'` | Stamped into runs and grants. Changing it invalidates grants issued under an older policy. |
| `approvalTtlMs` | `900000` | Lifetime of one run-scoped grant. |
| `snapshotTtlMs` | `300000` | Lifetime of one snapshot reference. |
| `workerPoolSize` | `2` | Bounded case worker pool size. Declarative until the worker pool ships. |
| `retentionDays` | `30` | Retention window used by `purgeExpiredRuns`. |
| `metricsEnabled` | `true` | Collect counters, structured log lines and audit entries. |

Model-facing tools are `testpilot_project_create`, `testpilot_project_list`, `testpilot_run_start`, `testpilot_run_get`, `testpilot_run_list`, `testpilot_snapshot_capture`, `testpilot_locator_check`, `testpilot_gate_evaluate`, `testpilot_report_get`, `testpilot_evidence_list`, `testpilot_metrics` and `testpilot_status`. Long operations return a queued run immediately; progress is read back through `testpilot_run_get`.

## Understand the implementation

`src/types.ts` holds types only. `src/domain.ts` owns identity, canonical digests and the forward-only run state machine. `src/snapshot-registry.ts` and `src/locator-validator.ts` bind refs to a live snapshot and an agent identity. `src/risk.ts`, `src/approval-gate.ts`, `src/origin-allowlist.ts` and `src/attach-guard.ts` are pure policy modules with no host imports. `src/store.ts` is the durable boundary; `src/observability.ts`, `src/quality-gate.ts`, `src/reporting.ts` and `src/retention.ts` are pure consumers of domain records. `src/index.ts` is the only module that imports Cordis and the tool registry, and it is a named-export function plugin with no default export.

The approval model resolves [ADR-011](../../docs/testpilot/phase-0/architecture-decisions.zh.md#adr-011--approval-credentials-and-high-risk-operations): a grant is issued when a run starts, binds to `runId`, `projectId`, `policyVersion` and a SHA-256 parameter digest, expires, is revoked on completion, and cannot be replayed. A worker is a `ctx.subprocess` child and never needs an agent turn.

## Model Experience

### Tool schemas

#### What the model sees

Twelve `testpilot_*` schemas join prompt assembly from the generated [tool catalog](../../docs/tool-catalog.md), each with a short description of the operation, typed parameters and one canonical JSON string as its value. Long operations return `{ "ok": true, "data": { "runId": "...", "status": "queued" } }` immediately rather than waiting for a suite to finish.

#### Token effect

Conditional: the schemas are present only while the bundle is enabled. Each call contributes one result string; `testpilot_report_get` can return a full report, so callers choose the format and the report is stored under the run rather than repeated in history.

#### KV Cache effect

Append-only while the bundle stays enabled: the schema block is a stable prefix, and results append. Enabling or disabling the bundle, or changing `policyVersion`, replaces that prefix and invalidates reuse of requests assembled before the change.

### Gate reasons and missing evidence

#### What the model sees

`testpilot_gate_evaluate` and `testpilot_report_get` state each reason for a `warn` or `fail` verdict and state explicitly when evidence collection did not succeed. No report describes a probabilistic root cause as a confirmed fact.

#### Token effect

Conditional on the run being evaluated; bounded by the number of case results and reasons.

#### KV Cache effect

Independent: each report is a fresh request result and does not rewrite an earlier prefix.

## Known Limitations and Deferred Work

- **Domain storage** — records use an atomic JSON store under `dataDir`, not a `dsh-storage` domain. [ADR-007](../../docs/testpilot/phase-0/architecture-decisions.zh.md) selects the domain form; migration to two domains, one of them `per-record`, belongs to Phase 2. `upgradeRunRecord` supplies the one-shot v1-to-v2 step that the current store needs.
- **Workers and execution** — no browser worker pool, Playwright adapter, fixture manager, retry policy or explorer is shipped. `workerPoolSize` is declarative. Phase 1 deliberately excludes them until the approval decision is settled.
- **Origin boundary** — the allowlist checks each redirect hop in TestPilot, but the upstream provider's own allowed-origins option does not cover redirects and neither is a security boundary until the redirect test records the observed behaviour. Private hosts and cloud metadata addresses are refused by the attach guard.
- **Evidence** — binary evidence is referenced by `EvidenceLink` and kept out of domain records; an external attachment store and its quota are not wired in this phase. Reports list missing kinds instead of implying collection succeeded.
- **Coverage and accessibility** — requirement-to-test traceability produces links, not code coverage. No axe scan, visual baseline or flaky detector is shipped.
- **Governance** — no RBAC, remote stream, client module or Web UI card. Audit entries are append-only within one activation and are not yet durable across reloads.
- **Runtime** — the development tree runs Node v22.22.2 while the root manifest declares `>=24.9.0`; publication gates must be rerun on the declared runtime.
