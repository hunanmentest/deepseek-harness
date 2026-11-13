/** Domain vocabulary for TestPilot. Types only, no runtime code. @module */

export type Brand<T extends string> = string & { readonly __brand: T }
export type ProjectId = Brand<'ProjectId'>
export type PlanId = Brand<'PlanId'>
export type RunId = Brand<'RunId'>
export type CaseId = Brand<'CaseId'>
export type GrantId = Brand<'GrantId'>
export type SnapshotId = Brand<'SnapshotId'>
export type CorrelationId = Brand<'CorrelationId'>

export interface DomainError {
  readonly code: string
  readonly message: string
  readonly retryable: boolean
  readonly correlationId: string
}

export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export type RunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'cancelled' | 'timed_out'
export type CaseStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'cancelled'
export type RunMode = 'full' | 'smoke' | 'risk_based'
export type CasePriority = 'P0' | 'P1' | 'P2'
export type GateVerdict = 'pass' | 'warn' | 'fail'
export type ReportFormat = 'json' | 'junit' | 'html' | 'markdown'

export interface TestProject {
  readonly id: ProjectId
  readonly workspaceId: string
  readonly name: string
  readonly rootPath: string
  readonly baseUrl: string
  readonly allowedOrigins: readonly string[]
  readonly policyVersion: string
  readonly createdAtMs: number
}

export interface TestCase {
  readonly id: CaseId
  readonly projectId: ProjectId
  readonly planId: PlanId
  readonly title: string
  readonly priority: CasePriority
  readonly steps: readonly string[]
  readonly expected: string
  readonly snapshotId: string | null
}

export interface TestPlan {
  readonly id: PlanId
  readonly projectId: ProjectId
  readonly version: number
  readonly requirementRefs: readonly string[]
  readonly caseIds: readonly CaseId[]
  readonly createdAtMs: number
  readonly approvedAtMs: number | null
}

export interface CaseResult {
  readonly caseId: CaseId
  readonly status: CaseStatus
  readonly startedAtMs: number
  readonly finishedAtMs: number | null
  readonly durationMs: number | null
  readonly failureClass: string | null
  readonly evidenceIds: readonly string[]
  readonly error: string | null
}

export interface TestRun {
  readonly id: RunId
  readonly projectId: ProjectId
  readonly planId: PlanId
  readonly status: RunStatus
  readonly mode: RunMode
  readonly commitSha: string | null
  readonly configDigest: string
  readonly policyVersion: string
  readonly createdAtMs: number
  readonly updatedAtMs: number
  readonly finishedAtMs: number | null
  readonly results: readonly CaseResult[]
  readonly correlationId: CorrelationId
}

export interface EvidenceLink {
  readonly id: string
  readonly runId: RunId
  readonly caseId: CaseId
  readonly kind: string
  readonly attachmentId: string
  readonly byteSize: number
  readonly sha256: string
  readonly createdAtMs: number
}

export interface GateThresholds {
  readonly maxFailureRate: number
  readonly minEvidenceRate: number
  readonly requireP0Pass: boolean
}

export interface QualityGate {
  readonly runId: RunId
  readonly verdict: GateVerdict
  readonly reasons: readonly string[]
  readonly evaluatedAtMs: number
  readonly durationMs: number
  readonly thresholds: GateThresholds
}

export interface AuditEntry {
  readonly id: string
  readonly atMs: number
  readonly actor: string
  readonly action: string
  readonly outcome: 'allowed' | 'denied'
  readonly correlationId: string
  readonly detail: string
}

export interface MetricSnapshot {
  readonly atMs: number
  readonly runsStarted: number
  readonly runsCompleted: number
  readonly runsFailed: number
  readonly casesTotal: number
  readonly casesFailed: number
  readonly evidenceCollected: number
  readonly evidenceMissing: number
  readonly approvalDenials: number
  readonly originDenials: number
  readonly gateEvaluations: number
  readonly gateDurationMsTotal: number
  readonly durationsMs: readonly number[]
}

export interface HealthStatus {
  readonly ok: boolean
  readonly plugin: string
  readonly policyVersion: string
  readonly configDigest: string
  readonly dataDir: string
  readonly storeReady: boolean
  readonly activeRuns: number
  readonly activeGrants: number
  readonly snapshots: number
  readonly checkedAtMs: number
  readonly reasons: readonly string[]
}
