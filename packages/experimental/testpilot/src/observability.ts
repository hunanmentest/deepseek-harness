/** Structured logs, counters, audit trail and metric definitions (方案 §20). @module */

import { newId } from './domain.ts'
import type { AuditEntry, MetricSnapshot } from './types.ts'

export type MetricEvent =
  | 'run_started' | 'run_completed' | 'run_failed' | 'case_total' | 'case_failed'
  | 'evidence_collected' | 'evidence_missing' | 'approval_denied' | 'origin_denied'
  | 'gate_evaluated' | 'duration' | 'gate_duration'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogLine {
  readonly ts: number
  readonly level: LogLevel
  readonly event: string
  readonly correlationId: string
  readonly runId: string | null
  readonly caseId: string | null
  readonly policyVersion: string
  readonly durationMs: number | null
  readonly detail: string
}

export interface Observability {
  readonly record: (event: MetricEvent, value?: number) => void
  readonly snapshot: (nowMs: number) => MetricSnapshot
  readonly log: (line: Omit<LogLine, 'ts'>) => LogLine
  readonly logs: () => readonly LogLine[]
  readonly audit: (entry: Omit<AuditEntry, 'id' | 'atMs'>) => AuditEntry
  readonly auditTrail: () => readonly AuditEntry[]
  readonly percentile: (p: number) => number
}

/** Metric definitions; rates are computed from counters, never invented as achievements. */
export const METRIC_DEFINITIONS: Readonly<Record<string, string>> = {
  runSuccessRate: 'runsCompleted / (runsCompleted + runsFailed), zero when no run settled',
  evidenceRate: 'evidenceCollected / (evidenceCollected + evidenceMissing), zero when nothing was requested',
  caseFailureRate: 'casesFailed / casesTotal, zero when no case settled',
  gateDurationP95Ms: '95th percentile of recorded gate durations in milliseconds',
  runDurationP95Ms: '95th percentile of recorded run durations in milliseconds',
  approvalDenialRate: 'approvalDenials / runsStarted',
  originDenialRate: 'originDenials / runsStarted',
}

/** All counters and retained lines belong to one activation instance. */
export function createObservability(enabled: boolean): Observability {
  const counters: Record<MetricEvent, number> = {
    run_started: 0, run_completed: 0, run_failed: 0, case_total: 0, case_failed: 0,
    evidence_collected: 0, evidence_missing: 0, approval_denied: 0, origin_denied: 0,
    gate_evaluated: 0, duration: 0, gate_duration: 0,
  }
  const durations: number[] = []
  const gateDurations: number[] = []
  const lines: LogLine[] = []
  const auditEntries: AuditEntry[] = []

  return {
    record(event, value = 1): void {
      if (!enabled) return
      counters[event] += value
      if (event === 'duration' && Number.isFinite(value)) durations.push(value)
      if (event === 'gate_duration' && Number.isFinite(value)) gateDurations.push(value)
    },
    snapshot(nowMs): MetricSnapshot {
      return {
        atMs: nowMs,
        runsStarted: counters.run_started,
        runsCompleted: counters.run_completed,
        runsFailed: counters.run_failed,
        casesTotal: counters.case_total,
        casesFailed: counters.case_failed,
        evidenceCollected: counters.evidence_collected,
        evidenceMissing: counters.evidence_missing,
        approvalDenials: counters.approval_denied,
        originDenials: counters.origin_denied,
        gateEvaluations: counters.gate_evaluated,
        gateDurationMsTotal: gateDurations.reduce((sum, value) => sum + value, 0),
        durationsMs: [...durations],
      }
    },
    log(line): LogLine {
      const entry: LogLine = { ...line, ts: Date.now(), detail: line.detail.replace(/[\r\n]+/g, ' ').slice(0, 512) }
      lines.push(entry)
      if (lines.length > 1000) lines.shift()
      return entry
    },
    logs: () => [...lines],
    audit(entry): AuditEntry {
      const record: AuditEntry = {
        ...entry,
        id: newId<'CorrelationId'>('audit'),
        atMs: Date.now(),
        detail: entry.detail.replace(/[\r\n]+/g, ' ').slice(0, 512),
      }
      auditEntries.push(record)
      return record
    },
    auditTrail: () => [...auditEntries],
    percentile(p): number {
      const sorted = [...durations].sort((a, b) => a - b)
      if (sorted.length === 0) return 0
      const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
      const value = sorted[Math.max(0, index)]
      /* v8 ignore next -- the clamped index always resolves inside the sorted list; the fallback only satisfies noUncheckedIndexedAccess */
      return value ?? 0
    },
  }
}

/** Rates derived from one snapshot; a missing denominator yields zero, not a fabricated value. */
export function deriveRates(snapshot: MetricSnapshot): Readonly<Record<string, number>> {
  const settled = snapshot.runsCompleted + snapshot.runsFailed
  const requested = snapshot.evidenceCollected + snapshot.evidenceMissing
  return {
    runSuccessRate: settled === 0 ? 0 : snapshot.runsCompleted / settled,
    evidenceRate: requested === 0 ? 0 : snapshot.evidenceCollected / requested,
    caseFailureRate: snapshot.casesTotal === 0 ? 0 : snapshot.casesFailed / snapshot.casesTotal,
    approvalDenialRate: snapshot.runsStarted === 0 ? 0 : snapshot.approvalDenials / snapshot.runsStarted,
    originDenialRate: snapshot.runsStarted === 0 ? 0 : snapshot.originDenials / snapshot.runsStarted,
  }
}
