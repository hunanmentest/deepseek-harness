/** Rejects stale, cross-identity or unsafe locator references before a browser call. @module */

import { newId, ok, err } from './domain.ts'
import type { Result } from './types.ts'
import type { SnapshotRegistry } from './snapshot-registry.ts'

export interface LocatorRef {
  readonly snapshotId: string
  readonly ref: string
  readonly agentId: string
}

export interface ValidatedLocator {
  readonly snapshotId: string
  readonly ref: string
  readonly description: string
  readonly version: number
}

const UNSAFE = /javascript:|data:text\/html|<script|onerror\s*=|eval\(/i

/** Resolve a ref against a live snapshot owned by the same agent. */
export function validateLocator(registry: SnapshotRegistry, ref: LocatorRef, nowMs: number): Result<ValidatedLocator> {
  const corr = newId<'CorrelationId'>('corr')
  if (!/^@e\d+$/.test(ref.ref)) return err('invalid-ref', 'locator ref must match @eN', corr)
  const snapshot = registry.get(ref.snapshotId, nowMs)
  if (!snapshot.ok) return snapshot
  if (snapshot.value.agentId !== ref.agentId) {
    return err('cross-identity', 'locator snapshot belongs to another agent', corr)
  }
  const description = snapshot.value.refs[ref.ref]
  if (description === undefined) return err('ref-not-in-snapshot', `ref ${ref.ref} is absent from the snapshot`, corr)
  if (description.length === 0 || description.length > 512 || /[\u0000-\u001f]/.test(description) || UNSAFE.test(description)) {
    return err('unsafe-description', 'snapshot description is empty, oversized or unsafe', corr)
  }
  return ok({
    snapshotId: snapshot.value.id,
    ref: ref.ref,
    description,
    version: snapshot.value.version,
  })
}
