# TestPilot Phase 0 — source audit and technical baseline

English | [中文](README.zh.md)

TestPilot is a web quality platform to be built inside the DeepSeek Harness. Phase 0 is a read-only audit: it establishes what the harness already provides, what TestPilot must add, and which questions remain open before implementation begins. It develops no TestPilot feature and changes no production code.

## Verdict

Phase 0 is **not accepted**. The audit covers all fourteen work packages and records fourteen architecture decisions, but two of them are blocked and the plan's own acceptance checklist is not yet met. The reasoning is in [Phase 0 acceptance](phase-0-acceptance.md).

The single decision that gates the rest — how a background worker obtains an approval context — is recorded as blocked in [ADR-011](architecture-decisions.md#adr-011--approval-credentials-and-high-risk-operations), because the repository's approval service rejects any request whose session has no open turn.

## What the audit established

| Finding | Consequence for TestPilot |
|---|---|
| The browser stack already exists and is well covered | TestPilot adds a test domain, not a browser stack |
| The upstream MCP server advertises 24 tools, 16 of which mutate remote state | The tool contract is measured, not assumed |
| The upstream publishes a risk label per tool and the harness bridge discards it | Risk classification must be built, and the discarded label is worth recovering |
| A test run is not a session | The domain model belongs in a storage domain |
| The approval seam requires an open turn | A background worker cannot use it directly, which is the blocking question |
| The origin allowlist is implemented upstream but disabled here, and does not cover redirects | The mechanism is known; the guarantee is not |
| `ctx.subprocess` is the only seam with a managed-range quiescence contract | The worker is a subprocess, not a subagent, a job, or a workflow step |
| The repository has no report, trace, or video facility | Evidence is attachment references plus domain records |
| The unit and real-Chromium baselines are green | 290 unit tests and 2 browser tests pass |

## The audit documents

| Work package | Document | Contents |
|---|---|---|
| A01 | [Repository audit](repository-audit.md) | workspace state, environment, package placement, naming rules |
| A02 | [Profile, bundle, and loader audit](profile-bundle-integration-audit.md) | profile layers, bundle format, loader replacement, product isolation |
| A03 | [Browser provider audit](browser-provider-audit.md) | registration, runtime ownership, provider lifecycle |
| A04 | [MCP contract audit](mcp-contract-audit.md) | the measured 24-tool contract and the annotations gap |
| A05 | [Agent, session, and tool lifecycle audit](session-tool-lifecycle-audit.md) | agent, session, and tool ownership, and the worker lifecycle |
| A06 | [Approval and credentials audit](approval-security-audit.md) | the approval seam, its turn precondition, and the credential boundary |
| A07 | [Execution isolation audit](execution-isolation-audit.md) | network, process, file, and attach boundaries, and the threat model |
| A08 | [Storage and persistence audit](storage-persistence-audit.md) | the domain layer, both backends, and the version chain |
| A09 | [Background execution audit](background-execution-audit.md) | jobs, workflow, PTC, subagent, and subprocess compared |
| A10 | [Project ownership audit](project-ownership-audit.md) | workspace identity, the one-owner rule, and remote access |
| A11 | [Web platform integration audit](web-platform-integration-audit.md) | host service, gateway, controllers, and the client module system |
| A12 | [Evidence and observability audit](evidence-observability-audit.md) | attachments, deliverables, telemetry, and what does not exist |
| A13 | [Testing baseline](testing-baseline.md) | every command executed and every result |
| A14 | [Package release audit](package-release-audit.md) | classification, publication, versions, and documentation duties |

Two documents sit above the work packages: the [architecture decisions](architecture-decisions.md), which records ADR-001 through ADR-014, and the [Phase 0 acceptance](phase-0-acceptance.md), which applies the plan's checklist to the evidence.

## Evidence convention

Every claim in these documents carries one of the plan's four source levels:

| Level | Meaning |
|---|---|
| Verified | read from the source, configuration, or documentation in this tree, or measured by running it |
| To verify | related code exists, but the full call chain was not read |
| Design inference | a proposal derived from the existing architecture |
| New design | a capability TestPilot itself must add |

A "verified" claim was confirmed against the files present in this tree and, where the claim is behavioral, against a command that was actually executed and whose result is recorded in the [testing baseline](testing-baseline.md).

## Phase 1 boundary

Phase 1 delivers the browser foundation and the safety mechanisms: a test project and case domain, a snapshot registry, a locator validator, a risk classification, an approval gate, an origin allowlist with a redirect test, an attach-endpoint host check, and evidence stored through the attachment store.

Phase 1 does not deliver the worker pool, the test report, or the failure analysis. It may not begin the worker implementation before the approval decision in ADR-011 is settled.

## Further Exploration

- [Architecture decisions](architecture-decisions.md) — the fourteen records this audit settles.
- [Phase 0 acceptance](phase-0-acceptance.md) — the criteria and the remaining blockers.
- [Testing baseline](testing-baseline.md) — the commands behind every result.
