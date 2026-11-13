/** Versioned, identity-bound, expiring snapshot references (ADR-004). @module */

import { newId, ok, err } from './domain.ts'
import type { Result, SnapshotId } from './types.ts'

export interface SnapshotRecord {
  readonly id: SnapshotId
  readonly runId: string
  readonly agentId: string
  readonly version: number
  readonly capturedAtMs: number
  readonly expiresAtMs: number
  readonly refs: Readonly<Record<string, string>>
}

export interface CaptureInput {
  readonly runId: string
  readonly agentId: string
  readonly refs: Readonly<Record<string, string>>
}

export interface SnapshotRegistry {
  capture(input: CaptureInput): Result<SnapshotRecord>
  get(id: string, nowMs: number): Result<SnapshotRecord>
  invalidate(id: string): boolean
  prune(nowMs: number): number
  size(nowMs: number): number
  list(): readonly SnapshotRecord[]
}

/** Owning instance for all live snapshot state; no module-level shared state. */
export function createSnapshotRegistry(ttlMs: number): SnapshotRegistry {
  const records = new Map<string, SnapshotRecord>()
  const versions = new Map<string, number>()
  const now = (): number => Date.now()

  function live(record: SnapshotRecord, atMs: number): boolean {
    return record.expiresAtMs > atMs
  }

  return {
    capture(input): Result<SnapshotRecord> {
      const id = newId<'CorrelationId'>('corr')
      if (input.runId.trim().length === 0) return err('invalid-run', 'runId must be a non-empty string', id)
      if (input.agentId.trim().length === 0) return err('invalid-agent', 'agentId must be a non-empty string', id)
      const keys = Object.keys(input.refs)
      if (keys.length > 500) return err('snapshot-too-large', 'a snapshot holds at most 500 refs', id)
      for (const key of keys) {
        if (!/^@e\d+$/.test(key)) return err('invalid-ref', `snapshot ref ${key} must match @eN`, id)
      }
      const atMs = now()
      const version = (versions.get(input.runId) ?? 0) + 1
      versions.set(input.runId, version)
      const record: SnapshotRecord = {
        id: newId<'SnapshotId'>('snap'),
        runId: input.runId,
        agentId: input.agentId,
        version,
        capturedAtMs: atMs,
        expiresAtMs: atMs + ttlMs,
        refs: { ...input.refs },
      }
      records.set(record.id, record)
      return ok(record)
    },
    get(id, nowMs): Result<SnapshotRecord> {
      const corr = newId<'CorrelationId'>('corr')
      const record = records.get(id)
      if (record === undefined) return err('snapshot-not-found', `snapshot ${id} does not exist`, corr)
      if (!live(record, nowMs)) {
        records.delete(id)
        return err('snapshot-expired', `snapshot ${id} expired`, corr)
      }
      return ok(record)
    },
    invalidate(id): boolean {
      return records.delete(id)
    },
    prune(nowMs): number {
      let removed = 0
      for (const [id, record] of [...records]) {
        if (!live(record, nowMs)) {
          records.delete(id)
          removed++
        }
      }
      return removed
    },
    size(nowMs): number {
      return [...records.values()].filter(record => live(record, nowMs)).length
    },
    list(): readonly SnapshotRecord[] {
      return [...records.values()]
    },
  }
}
