/** Deterministic, explainable quality gate; AI analysis never decides the verdict alone. @module */

import type { CasePriority, GateThresholds, GateVerdict, QualityGate, TestRun } from './types.ts'

export const DEFAULT_THRESHOLDS: GateThresholds = {
  maxFailureRate: 0,
  minEvidenceRate: 1,
  requireP0Pass: true,
}

export interface GateInput {
  readonly run: TestRun
  readonly thresholds: GateThresholds
  readonly priorities: Readonly<Record<string, CasePriority>>
  readonly nowMs: number
  readonly durationMs: number
}

/** Evaluate a settled run. Every non-pass verdict carries the reason that produced it. */
export function evaluateQualityGate(input: GateInput): QualityGate {
  const { run, thresholds, priorities, nowMs, durationMs } = input
  const reasons: string[] = []
  let verdict: GateVerdict = 'pass'
  const promote = (next: GateVerdict, reason: string): void => {
    reasons.push(reason)
    if (next === 'fail' || (next === 'warn' && verdict === 'pass')) verdict = next
  }
  if (run.status === 'passed' || run.status === 'failed') {
    const settled = run.results.filter(result => result.status !== 'pending' && result.status !== 'running')
    const failed = settled.filter(result => result.status === 'failed')
    const withEvidence = settled.filter(result => result.evidenceIds.length > 0)
    const failureRate = settled.length === 0 ? 0 : failed.length / settled.length
    const evidenceRate = settled.length === 0 ? 0 : withEvidence.length / settled.length
    if (run.status !== 'passed') promote('fail', `run ${run.id} settled as ${run.status}`)
    if (thresholds.requireP0Pass && failed.some(result => priorities[result.caseId] === 'P0')) {
      promote('fail', 'a P0 case failed')
    }
    if (failureRate > thresholds.maxFailureRate) {
      promote('fail', `case failure rate ${failureRate.toFixed(3)} exceeds ${thresholds.maxFailureRate}`)
    }
    if (evidenceRate < thresholds.minEvidenceRate) {
      promote('warn', `evidence rate ${evidenceRate.toFixed(3)} is below ${thresholds.minEvidenceRate}`)
    }
    if (failed.some(result => result.evidenceIds.length === 0)) {
      promote('warn', 'at least one failed case has no evidence reference')
    }
  } else {
    promote('fail', `run ${run.id} is not settled (${run.status})`)
  }
  return {
    runId: run.id,
    verdict,
    reasons,
    evaluatedAtMs: nowMs,
    durationMs,
    thresholds,
  }
}

/** Stable CI exit codes: 0 pass, 1 fail, 2 warn when warnings are fatal. */
export function gateExitCode(verdict: GateVerdict, warnAsFailure = false): number {
  if (verdict === 'fail') return 1
  if (verdict === 'warn' && warnAsFailure) return 1
  return 0
}
