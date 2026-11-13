# TestPilot Phase 0 — acceptance

English | [中文](phase-0-acceptance.zh.md)

This document records whether Phase 0 meets the plan's acceptance checklist, and states the boundary for Phase 1.

## Verdict

**Phase 0 is not accepted.** All fourteen work packages are audited and fourteen architecture decisions are recorded, but the plan's acceptance checklist is not met. Two decisions are blocked, and one condition — the worker and agent lifecycle relationship — has moved but not closed.

The audit itself is complete. What is missing is not evidence but decisions that the plan requires before Phase 1 begins.

## Acceptance checklist

| # | Condition | Status | Evidence |
|---|---|---|---|
| 1 | All fourteen work packages complete | met | fourteen audit documents, one per work package |
| 2 | All relevant source directories verified | met | each document cites verified file paths and line numbers |
| 3 | All key APIs and types have source evidence | met | the tool contract was additionally measured against a running server |
| 4 | Fourteen decisions confirmed or explicitly marked blocked | met | ADR-001 through ADR-014; ADR-011 is marked blocked |
| 5 | The browser provider reuse boundary is determined | met | ADR-003 |
| 6 | The test run persistence method is determined | met | ADR-007 |
| 7 | The worker lifecycle and isolation boundary are determined | met | ADR-005 and ADR-006 |
| 8 | The profile and bundle integration method is determined | met | ADR-002 |
| 9 | The host, client, and remote API boundaries are determined | met | ADR-009 |
| 10 | The permission and security policy is determined | met | ADR-010; the approval branch in ADR-011 is blocked |
| 11 | The evidence storage and redaction policy is determined | met | ADR-012 |
| 12 | The existing test baseline is recorded | met | [testing baseline](testing-baseline.md) |
| 13 | The local user modification protection plan is confirmed | met | no tracked source file was modified; the only local change is this audit's own document directory |
| 14 | The Phase 1 new-file and dependency lists are frozen | met | [package release audit](package-release-audit.md) |

## The work packages

| # | Work package | Document | Status |
|---|---|---|---|
| A01 | Repository and package architecture | [repository audit](repository-audit.md) | complete |
| A02 | Cordis, profile, bundle, and loader | [profile, bundle, and loader audit](profile-bundle-integration-audit.md) | complete |
| A03 | Browser provider and runtime | [browser provider audit](browser-provider-audit.md) | complete |
| A04 | MCP contract and resources | [MCP contract audit](mcp-contract-audit.md) | complete |
| A05 | Agent, session, and tool lifecycle | [session and tool lifecycle audit](session-tool-lifecycle-audit.md) | complete |
| A06 | Approval, permission, and credentials | [approval and credentials audit](approval-security-audit.md) | complete |
| A07 | Sandbox, subprocess, and network egress | [execution isolation audit](execution-isolation-audit.md) | complete |
| A08 | Storage, persistence, and migration | [storage and persistence audit](storage-persistence-audit.md) | complete |
| A09 | Jobs, workflow, and PTC | [background execution audit](background-execution-audit.md) | complete |
| A10 | Workspace, identity, and ownership | [project ownership audit](project-ownership-audit.md) | complete |
| A11 | Host, client, and remote API | [web platform integration audit](web-platform-integration-audit.md) | complete |
| A12 | Evidence, attachment, and telemetry | [evidence and observability audit](evidence-observability-audit.md) | complete |
| A13 | Test infrastructure and quality gates | [testing baseline](testing-baseline.md) | complete |
| A14 | Package classification and release | [package release audit](package-release-audit.md) | complete |

## The blocking conditions

The plan lists seven conditions that bar entry into Phase 1.

| # | Condition | Status |
|---|---|---|
| 1 | The browser resource ownership cannot be established | cleared — ownership is the live agent object, enforced by the shared runtime and covered by its own tests |
| 2 | Cross-session tool call isolation cannot be confirmed | cleared — the scoped execution handler enforces it and is covered |
| 3 | The worker and agent lifecycle relationship cannot be established | **partially cleared** — the worker is a subprocess and needs no agent, but the approval question it raises remains |
| 4 | Dangerous-operation approval cannot be shown to precede the operation | **not cleared** — the seam exists and its ordering inside a turn is established, but the background branch is undefined |
| 5 | The network access enforcement point cannot be identified | cleared — the enforcement point is the upstream browser-context request interception; what remains is its redirect coverage |
| 6 | The new package cannot be guaranteed to satisfy the experimental package policy | cleared — the naming, registry entry, and publication rules are identified |
| 7 | The boundary between existing tests and local user modifications cannot be confirmed | cleared — no tracked source file was modified, and the only local change is this audit's own document directory |

Conditions 3 and 4 share a root cause: the approval service requires an open turn, and a background worker has none.

## The decision that blocks the rest

Three records reduce to one question: **how does a background worker obtain a valid approval context?**

The approval service rejects a request whose session has no open turn, before any answerer is consulted. A worker that runs a case outside an agent's turn therefore cannot use the service at all.

The [approval and credentials audit](approval-security-audit.md) sets out three designs with their costs: approving inside the agent's turn, approving a whole run before it starts, or giving the worker a session with turn semantics. The choice determines the worker's execution model, and the worker's execution model determines the process isolation Phase 2 needs, so it cannot be deferred past Phase 1.

Phase 1 must record this as a settled decision with an acceptance criterion and must not begin implementing the worker before it does.

## The second open item: redirect coverage

The upstream owner states that the origin options do not affect redirects and are not a security boundary. The enforcement location is known, so the plan's fifth condition is cleared, but the guarantee is not.

Phase 1 must add a test that navigates to an allowed origin, follows a redirect to a disallowed origin, and records the observed behavior. Until that test exists, the package README must state that the allowlist does not cover redirects.

## Phase 1 boundary

Phase 1 may begin once the approval decision in ADR-011 is settled. It may not begin the worker implementation before it is.

Phase 1 does not modify the existing browser core packages. The origin option must be added to the provider's own argument construction, and that change belongs to the provider's package rather than to TestPilot; if the provider cannot be changed, TestPilot must mount its own provider through the shared registration surface.

Phase 1 delivers:

| Item | Basis |
|---|---|
| A test project and case domain | ADR-007, ADR-008 |
| A snapshot registry with version, identity, and expiry | ADR-004 |
| A locator validator that refuses a stale reference | ADR-004 |
| A risk classification over the measured tools | ADR-004, ADR-011 |
| An approval gate that runs before the browser call | ADR-011 |
| An origin allowlist passed to the provider, with a redirect test | ADR-010 |
| An attach-endpoint host check | ADR-010 |
| Evidence stored through the attachment store | ADR-012 |

Phase 1 does not deliver a worker pool, a test report, or a failure analysis. Those belong to later phases.

## Audit status summary

| Plan item | Status |
|---|---|
| Local workspace Git state verified | done — no tracked source file was modified, and the only local change is this audit's own document directory |
| Local Node and pnpm environment verified | done — Node below the declared floor, which Phase 1 must correct before the baseline is the release gate |
| Every relevant package audited file by file | done for the packages that determine the design |
| Actual MCP tool list and schemas obtained | done — 24 tools measured against the running server |
| Actual Chromium launch verified | done — the upstream suite passed in launch and attach modes |
| Network egress and allowlist enforcement verified | partially done — the location is identified; redirect coverage is not verified |
| Worker process isolation verified | done — the managed-range contract is identified, and the degraded-containment limit is recorded |
| Local test baseline executed | done — 290 unit tests and 2 real-Chromium tests, all passing |
| Phase 0 final acceptance | not granted — two decisions remain blocked |

## Further Exploration

- [Architecture decisions](architecture-decisions.md) — the fourteen records this acceptance applies.
- [Approval and credentials audit](approval-security-audit.md) — the question that blocks Phase 1.
- [Testing baseline](testing-baseline.md) — the commands behind the acceptance table.
