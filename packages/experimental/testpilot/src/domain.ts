/** Domain construction, identity and the run state machine. @module */

import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, relative, resolve } from 'node:path'
import type {
  Brand, CaseId, CaseResult, CorrelationId, DomainError, PlanId, ProjectId,
  Result, RunId, RunMode, RunStatus, TestProject, TestRun,
} from './types.ts'

/** Create an unguessable, non-sequential identifier for one domain entity. */
export function newId<T extends string>(prefix: string): Brand<T> {
  return `${prefix}_${randomUUID()}` as Brand<T>
}

export function correlationId(): CorrelationId {
  return newId<'CorrelationId'>('corr')
}

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function err(code: string, message: string, id: string, retryable = false): Result<never> {
  const error: DomainError = { code, message, retryable, correlationId: id }
  return { ok: false, error }
}

/** Canonicalize a value so equal inputs hash equally regardless of key insertion order. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
      .map(key => [key, canonical((value as Record<string, unknown>)[key])]))
  }
  return value
}

/** SHA-256 over canonical JSON; binds approvals and configuration snapshots to their inputs. */
export function stableDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

/** Projects, plans and runs keep their own identity namespaces. */
export const projectId = (): ProjectId => newId<'ProjectId'>('proj')
export const planId = (): PlanId => newId<'PlanId'>('plan')
export const runId = (): RunId => newId<'RunId'>('run')
export const caseId = (): CaseId => newId<'CaseId'>('case')

export interface CreateProjectInput {
  readonly workspaceId: string
  readonly name: string
  readonly rootPath: string
  readonly baseUrl: string
  readonly allowedOrigins: readonly string[]
  readonly policyVersion: string
}

/** Build a project record; path and URL shape are checked before any identifier is issued. */
export function createProject(input: CreateProjectInput, nowMs: number): Result<TestProject> {
  const id = correlationId()
  if (input.workspaceId.trim().length === 0) return err('invalid-workspace', 'workspaceId must be a non-empty string', id)
  if (input.name.trim().length === 0) return err('invalid-name', 'project name must be a non-empty string', id)
  if (!isAbsolute(input.rootPath)) return err('invalid-root', 'project rootPath must be absolute', id)
  if (!/^https?:\/\//i.test(input.baseUrl)) return err('invalid-base-url', 'baseUrl must use http or https', id)
  if (input.policyVersion.trim().length === 0) return err('invalid-policy', 'policyVersion must be a non-empty string', id)
  return ok({
    id: projectId(),
    workspaceId: input.workspaceId,
    name: input.name,
    rootPath: resolve(input.rootPath),
    baseUrl: input.baseUrl,
    allowedOrigins: [...input.allowedOrigins],
    policyVersion: input.policyVersion,
    createdAtMs: nowMs,
  })
}

/** A project directory must stay inside the workspace that owns it (ADR-008). */
export function validateProjectAgainstWorkspace(project: TestProject, workspaceRoot: string): Result<TestProject> {
  const id = correlationId()
  const delta = relative(resolve(workspaceRoot), resolve(project.rootPath))
  if (delta.startsWith('..') || isAbsolute(delta)) {
    return err('outside-workspace', 'project rootPath is outside its workspace', id)
  }
  return ok(project)
}

export interface CreateRunInput {
  readonly projectId: ProjectId
  readonly planId: PlanId
  readonly mode: RunMode
  readonly commitSha: string | null
  readonly configDigest: string
  readonly policyVersion: string
}

/** A run is a durable domain record that outlives the agent that started it (ADR-005). */
export function createRun(input: CreateRunInput, nowMs: number): Result<TestRun> {
  const id = correlationId()
  if (input.commitSha !== null && !/^[0-9a-fA-F]{7,64}$/.test(input.commitSha)) {
    return err('invalid-commit', 'commitSha must be 7 to 64 hexadecimal characters', id)
  }
  if (input.configDigest.trim().length === 0) return err('invalid-config', 'configDigest must be a non-empty string', id)
  return ok({
    id: runId(),
    projectId: input.projectId,
    planId: input.planId,
    status: 'queued',
    mode: input.mode,
    commitSha: input.commitSha,
    configDigest: input.configDigest,
    policyVersion: input.policyVersion,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    finishedAtMs: null,
    results: [],
    correlationId: id,
  })
}

const TERMINAL: readonly RunStatus[] = ['passed', 'failed', 'cancelled', 'timed_out']

/** Forward-only transitions; a settled run never returns to an active state. */
export function transitionRun(run: TestRun, next: RunStatus, nowMs: number): Result<TestRun> {
  const id = run.correlationId
  if (run.status === next) return ok(run)
  if (TERMINAL.includes(run.status)) return err('run-settled', `run ${run.id} is already ${run.status}`, id)
  if (run.status === 'queued' && next !== 'running' && !TERMINAL.includes(next)) {
    return err('invalid-transition', `queued cannot become ${next}`, id)
  }
  if (run.status === 'running' && !TERMINAL.includes(next)) {
    return err('invalid-transition', `running cannot become ${next}`, id)
  }
  const settled = TERMINAL.includes(next)
  return ok({ ...run, status: next, updatedAtMs: nowMs, finishedAtMs: settled ? nowMs : null })
}

/** Attach one case result; duplicate case ids and writes to settled runs are rejected. */
export function recordCaseResult(run: TestRun, result: CaseResult, nowMs: number): Result<TestRun> {
  const id = run.correlationId
  if (TERMINAL.includes(run.status)) return err('run-settled', `run ${run.id} is already ${run.status}`, id)
  if (run.results.some(existing => existing.caseId === result.caseId)) {
    return err('duplicate-case', `case ${result.caseId} already has a result`, id)
  }
  return ok({ ...run, results: [...run.results, result], updatedAtMs: nowMs })
}
