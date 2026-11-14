import { describe, expect, it } from 'vitest'
import { createSnapshotRegistry } from '../src/snapshot-registry.ts'
import { validateLocator } from '../src/locator-validator.ts'

function capture(registry: ReturnType<typeof createSnapshotRegistry>, refs: Record<string, string> = { '@e1': 'Submit button' }) {
  const result = registry.capture({ runId: 'run_1', agentId: 'agent_1', refs })
  if (!result.ok) throw new Error(`fixture capture failed: ${result.error.code}`)
  return result.value
}

describe('snapshot registry', () => {
  it('versions snapshots per run and keeps identity and expiry', () => {
    const registry = createSnapshotRegistry(1_000)
    const first = capture(registry)
    const second = capture(registry, { '@e2': 'Cancel link' })
    expect(first.version).toBe(1)
    expect(second.version).toBe(2)
    expect(first.agentId).toBe('agent_1')
    expect(first.expiresAtMs).toBeGreaterThan(first.capturedAtMs)
    expect(registry.size(Date.now())).toBe(2)
    expect(registry.list()).toHaveLength(2)
    expect(registry.get(first.id, Date.now()).ok).toBe(true)
  })

  it('rejects malformed capture input', () => {
    const registry = createSnapshotRegistry(1_000)
    expect(registry.capture({ runId: '', agentId: 'a', refs: {} }).ok).toBe(false)
    expect(registry.capture({ runId: 'run_1', agentId: '', refs: {} }).ok).toBe(false)
    expect(registry.capture({ runId: 'run_1', agentId: 'a', refs: { 'bad': 'x' } }).ok).toBe(false)
    const many: Record<string, string> = {}
    for (let i = 0; i < 501; i++) many[`@e${i}`] = 'x'
    expect(registry.capture({ runId: 'run_1', agentId: 'a', refs: many }).ok).toBe(false)
  })

  it('rejects missing and expired snapshots, prunes them and invalidates explicitly', () => {
    const registry = createSnapshotRegistry(1_000)
    const record = capture(registry)
    expect(registry.get('snap_missing', Date.now()).ok).toBe(false)
    expect(registry.get(record.id, Date.now() + 5_000).ok).toBe(false)
    expect(registry.size(Date.now() + 5_000)).toBe(0)
    const another = capture(registry)
    expect(registry.prune(Date.now())).toBe(0)
    expect(registry.prune(Date.now() + 5_000)).toBe(1)
    expect(registry.get(another.id, Date.now()).ok).toBe(false)
    const third = capture(registry)
    expect(registry.invalidate(third.id)).toBe(true)
    expect(registry.invalidate(third.id)).toBe(false)
  })
})

describe('locator validator', () => {
  it('resolves a live ref owned by the same agent', () => {
    const registry = createSnapshotRegistry(1_000)
    const record = capture(registry)
    const result = validateLocator(registry, { snapshotId: record.id, ref: '@e1', agentId: 'agent_1' }, Date.now())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.description).toBe('Submit button')
      expect(result.value.version).toBe(1)
    }
  })

  it('rejects malformed refs, cross identity, absent refs and unsafe descriptions', () => {
    const registry = createSnapshotRegistry(1_000)
    const record = capture(registry)
    const at = Date.now()
    expect(validateLocator(registry, { snapshotId: record.id, ref: 'e1', agentId: 'agent_1' }, at).ok).toBe(false)
    expect(validateLocator(registry, { snapshotId: record.id, ref: '@e1', agentId: 'agent_2' }, at).ok).toBe(false)
    expect(validateLocator(registry, { snapshotId: record.id, ref: '@e9', agentId: 'agent_1' }, at).ok).toBe(false)
    expect(validateLocator(registry, { snapshotId: 'snap_missing', ref: '@e1', agentId: 'agent_1' }, at).ok).toBe(false)
    const unsafe = createSnapshotRegistry(1_000)
    const bad = capture(unsafe, { '@e1': '<script>alert(1)</script>' })
    expect(validateLocator(unsafe, { snapshotId: bad.id, ref: '@e1', agentId: 'agent_1' }, at).ok).toBe(false)
    const empty = createSnapshotRegistry(1_000)
    const blank = capture(empty, { '@e1': '' })
    expect(validateLocator(empty, { snapshotId: blank.id, ref: '@e1', agentId: 'agent_1' }, at).ok).toBe(false)
  })
})
