# TestPilot

TestPilot is an optional Web quality platform bundle. It contributes structured test projects, plans, runs and cases, a snapshot registry with identity and expiry, a locator validator that rejects stale references, risk classification for the measured upstream browser tools, a run-scoped approval gate for high-risk actions, an origin and attach policy, evidence references, a quality gate, four report formats, and health metrics.

Enable it with `dsh plugin --profile web add @deepseek-ai/dsh-testpilot` and check the result with `dsh --profile web --dump-config`. No shipped bundle inserts TestPilot, so a default profile has none of its tools until the bundle is added. Configuration is a single patch row addressed by the id `testpilot`.

### What you can check

`testpilot_status` reports health, configuration digest and counters. `testpilot_metrics` reports run success rate, evidence collection rate, approval denials, origin denials and gate duration. `testpilot_run_get` reads durable run state and `testpilot_report_get` reads JSON, JUnit, HTML or Markdown reports, while `testpilot_gate_evaluate` produces and stores the gate verdict behind those reports. `testpilot_evidence_list` lists evidence references and names every missing kind explicitly.

### Boundaries

The origin allowlist checks each redirect hop in TestPilot, but the upstream browser provider's own allowed-origins option does not cover redirects; neither mechanism is a security boundary until the redirect test records the observed behaviour. High-risk actions need a run-scoped grant that expires, binds to a parameter digest and cannot be replayed; the grant never becomes a permanent authorization. Binary evidence is referenced by the domain and stored outside it; a report states missing evidence instead of implying collection succeeded. TestPilot does not drive a browser worker in this phase and does not claim code coverage from scenario counts.

See `docs/testpilot/phase-1/RELEASE.md` and `docs/testpilot/phase-1/MONITORING.md` for publication gates and metric definitions.
