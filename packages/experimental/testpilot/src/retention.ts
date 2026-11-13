/** Retention and one-shot record upgrade; the storage layer provides neither (ADR-007, ADR-012). @module */

import { ok, err } from './domain.ts'
import type { Result, TestRun } from './types.ts'
import type { TestPilotStore } from './store.ts'

export interface PurgeResult {
  readonly deleted: readonly string[]
  readonly kept: number
  readonly cutoffMs: number
}

/** Delete a run together with its gate and reports; evidence references stay in the domain record. */
export async function purgeExpiredRuns(store: TestPilotStore, nowMs: number, retentionDays: number): Promise<PurgeResult> {
  const cutoffMs = nowMs - retentionDays * 86_400_000
  const runs = await store.listRuns()
  const deleted: string[] = []
  let kept = 0
  for (const run of runs) {
    const settledAt = run.finishedAtMs ?? run.updatedAtMs
    if (settledAt <= cutoffMs) {
      await store.deleteRun(run.id)
      deleted.push(run.id)
    } else {
      kept++
    }
  }
  return { deleted, kept, cutoffMs }
}

export const RUN_RECORD_VERSION = 2
export const COMPATIBLE_RUN_VERSIONS: readonly number[] = [1]

/** Reject a future or unlisted format instead of silently downgrading it. */
export function assertRunVersion(version: unknown): Result<number> {
  const corr = 'retention'
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return err('invalid-version', 'record version must be an integer', corr)
  }
  if (version > RUN_RECORD_VERSION) return err('future-version', `record version ${version} is newer than ${RUN_RECORD_VERSION}`, corr)
  if (version !== RUN_RECORD_VERSION && !COMPATIBLE_RUN_VERSIONS.includes(version)) {
    return err('incompatible-version', `record version ${version} has no upgrade path`, corr)
  }
  return ok(version)
}

/** One-shot v1 to v2 upgrade: add optional fields with defaults, never reinterpret existing values. */
export function upgradeRunRecord(raw: unknown): Result<TestRun> {
  const corr = 'upgrade'
  if (raw === null || typeof raw !== 'object') return err('invalid-record', 'run record must be an object', corr)
  const record = raw as Record<string, unknown>
  const version = assertRunVersion(record.schemaVersion ?? 1)
  if (!version.ok) return version
  if (typeof record.id !== 'string' || typeof record.projectId !== 'string' || typeof record.planId !== 'string') {
    return err('invalid-record', 'run id, projectId and planId must be strings', corr)
  }
  const results = Array.isArray(record.results) ? record.results : []
  return ok({
    id: record.id as TestRun['id'],
    projectId: record.projectId as TestRun['projectId'],
    planId: record.planId as TestRun['planId'],
    status: typeof record.status === 'string' ? record.status as TestRun['status'] : 'queued',
    mode: typeof record.mode === 'string' ? record.mode as TestRun['mode'] : 'full',
    commitSha: typeof record.commitSha === 'string' ? record.commitSha : null,
    configDigest: typeof record.configDigest === 'string' ? record.configDigest : 'unknown',
    policyVersion: typeof record.policyVersion === 'string' ? record.policyVersion : '1',
    createdAtMs: typeof record.createdAtMs === 'number' ? record.createdAtMs : 0,
    updatedAtMs: typeof record.updatedAtMs === 'number' ? record.updatedAtMs : 0,
    finishedAtMs: typeof record.finishedAtMs === 'number' ? record.finishedAtMs : null,
    results: results as TestRun['results'],
    correlationId: typeof record.correlationId === 'string'
      ? record.correlationId as TestRun['correlationId']
      : `corr_${record.id}` as TestRun['correlationId'],
  })
}
