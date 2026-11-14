import { describe, expect, it } from 'vitest'
import { createObservability, deriveRates, METRIC_DEFINITIONS } from '../src/observability.ts'
import { assertRunVersion, purgeExpiredRuns, upgradeRunRecord } from '../src/retention.ts'
import { createMemoryAdapter, createStore } from '../src/store.ts'
import { createRun, planId, projectId } from '../src/domain.ts'
import type { TestRun } from '../src/types.ts'

function run(atMs: number): TestRun {
  const created = createRun({
    projectId: projectId(), planId: planId(), mode: 'full', commitSha: null,
    configDigest: 'digest', policyVersion: '1',
  }, atMs)
  if (!created.ok) throw new Error('fixture run failed')
  return created.value
}

describe('observability', () => {
  it('counts events, derives rates and computes P95 without inventing values', () => {
    const obs = createObservability(true)
    obs.record('run_started')
    obs.record('run_started')
    obs.record('run_completed')
    obs.record('run_failed')
    obs.record('case_total', 4)
    obs.record('case_failed')
    obs.record('evidence_collected', 3)
    obs.record('evidence_missing')
    obs.record('approval_denied')
    obs.record('origin_denied')
    obs.record('gate_evaluated')
    obs.record('gate_duration', 12)
    for (const value of [10, 20, 30, 40, 100]) obs.record('duration', value)
    const snapshot = obs.snapshot(5_000)
    const rates = deriveRates(snapshot)
    expect(snapshot.runsStarted).toBe(2)
    expect(rates.runSuccessRate).toBe(0.5)
    expect(rates.evidenceRate).toBe(0.75)
    expect(rates.caseFailureRate).toBe(0.25)
    expect(obs.percentile(95)).toBe(100)
    expect(METRIC_DEFINITIONS.runSuccessRate).toContain('runsCompleted')
  })

  it('returns zero rates and a zero percentile with no data', () => {
    const obs = createObservability(true)
    const rates = deriveRates(obs.snapshot(0))
    expect(Object.values(rates).every(value => value === 0)).toBe(true)
    expect(obs.percentile(95)).toBe(0)
  })

  it('does not collect counters when metrics are disabled', () => {
    const obs = createObservability(false)
    obs.record('run_started')
    obs.record('duration', 99)
    expect(obs.snapshot(0).runsStarted).toBe(0)
    expect(obs.percentile(95)).toBe(0)
  })

  it('flattens log lines, caps retained lines and writes an immutable audit trail', () => {
    const obs = createObservability(true)
    const line = obs.log({ level: 'warn', event: 'policy.decision', correlationId: 'corr_1', runId: null, caseId: null, policyVersion: '1', durationMs: null, detail: 'first\nsecond' })
    expect(line.detail).toBe('first second')
    expect(line.ts).toBeTypeOf('number')
    for (let i = 0; i < 1001; i++) obs.log({ level: 'debug', event: 'tick', correlationId: 'c', runId: null, caseId: null, policyVersion: '1', durationMs: null, detail: 'x' })
    expect(obs.logs()).toHaveLength(1000)
    const entry = obs.audit({ actor: 'model', action: 'run.start', outcome: 'denied', correlationId: 'corr_2', detail: 'a\nb' })
    expect(entry.id.startsWith('audit_')).toBe(true)
    expect(entry.detail).toBe('a b')
    expect(obs.auditTrail()).toHaveLength(1)
  })
})

describe('retention', () => {
  it('accepts the current and one compatible version, rejects everything else', () => {
    expect(assertRunVersion(2).ok).toBe(true)
    expect(assertRunVersion(1).ok).toBe(true)
    expect(assertRunVersion(3).ok).toBe(false)
    expect(assertRunVersion(0).ok).toBe(false)
    expect(assertRunVersion('2').ok).toBe(false)
  })

  it('upgrades a v1 record with defaults and never reinterprets existing fields', () => {
    const current = run(1_000)
    const upgraded = upgradeRunRecord({ schemaVersion: 1, id: current.id, projectId: current.projectId, planId: current.planId, status: 'passed' })
    expect(upgraded.ok).toBe(true)
    if (upgraded.ok) {
      expect(upgraded.value.commitSha).toBeNull()
      expect(upgraded.value.configDigest).toBe('unknown')
      expect(upgraded.value.policyVersion).toBe('1')
      expect(upgraded.value.status).toBe('passed')
      expect(upgraded.value.correlationId).toBe(`corr_${current.id}`)
    }
    expect(upgradeRunRecord(null).ok).toBe(false)
    expect(upgradeRunRecord({ schemaVersion: 3 }).ok).toBe(false)
    expect(upgradeRunRecord({ schemaVersion: 2, id: 1 }).ok).toBe(false)
  })

  it('treats a record without a schema version as v1 and defaults every missing field', () => {
    const implicit = upgradeRunRecord({ id: 'run_z', projectId: 'proj_z', planId: 'plan_z' })
    expect(implicit.ok).toBe(true)
    if (implicit.ok) {
      expect(implicit.value.status).toBe('queued')
      expect(implicit.value.mode).toBe('full')
      expect(implicit.value.results).toEqual([])
      expect(implicit.value.correlationId).toBe('corr_run_z')
    }
  })

  it('keeps every field of a complete record that already carries them', () => {
    const full = upgradeRunRecord({
      schemaVersion: 1, id: 'run_x', projectId: 'proj_x', planId: 'plan_x', status: 'running',
      mode: 'smoke', commitSha: 'abc1234', configDigest: 'd1', policyVersion: '9',
      createdAtMs: 1, updatedAtMs: 2, finishedAtMs: 3, results: [], correlationId: 'corr_x',
    })
    expect(full.ok).toBe(true)
    if (full.ok) {
      expect(full.value.status).toBe('running')
      expect(full.value.mode).toBe('smoke')
      expect(full.value.commitSha).toBe('abc1234')
      expect(full.value.configDigest).toBe('d1')
      expect(full.value.policyVersion).toBe('9')
      expect(full.value.createdAtMs).toBe(1)
      expect(full.value.updatedAtMs).toBe(2)
      expect(full.value.finishedAtMs).toBe(3)
      expect(full.value.correlationId).toBe('corr_x')
      expect(full.value.results).toEqual([])
    }
  })

  it('purges settled runs past the window and keeps recent ones', async () => {
    const store = createStore(createMemoryAdapter())
    const old = { ...run(1_000), status: 'passed' as const, finishedAtMs: 1_000, updatedAtMs: 1_000 }
    const unFinished = { ...run(2_000), status: 'queued' as const, finishedAtMs: null, updatedAtMs: 2_000 }
    const recent = { ...run(2_900_000_000), status: 'passed' as const, finishedAtMs: 2_900_000_000, updatedAtMs: 2_900_000_000 }
    await store.putRun(old)
    await store.putRun(unFinished)
    await store.putRun(recent)
    await store.putGate({ runId: old.id, verdict: 'pass', reasons: [], evaluatedAtMs: 1_000, durationMs: 1, thresholds: { maxFailureRate: 0, minEvidenceRate: 1, requireP0Pass: true } })
    const result = await purgeExpiredRuns(store, 3_000_000_000, 30)
    expect(result.deleted).toEqual([old.id, unFinished.id])
    expect(result.kept).toBe(1)
    expect(result.cutoffMs).toBe(3_000_000_000 - 30 * 86_400_000)
    expect(await store.getRun(old.id)).toBeNull()
    expect(await store.getGate(old.id)).toBeNull()
    expect(await store.getRun(recent.id)).not.toBeNull()
  })
})
