import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import {
  caseId, correlationId, createProject, createRun, err, newId, ok, planId, projectId,
  recordCaseResult, stableDigest, transitionRun, validateProjectAgainstWorkspace,
} from '../src/domain.ts'
import { configDigest, resolveDataDir, Config } from '../src/config.ts'
import type { Config as ConfigShape } from '../src/config.ts'
import type { TestRun } from '../src/types.ts'

const config: ConfigShape = {
  dataDir: '', allowedOrigins: ['https://example.com'], policyVersion: '1',
  approvalTtlMs: 900_000, snapshotTtlMs: 300_000, workerPoolSize: 2,
  retentionDays: 30, metricsEnabled: true,
}

function project(root = resolve('/tmp/ws/app')) {
  const created = createProject({
    workspaceId: 'ws-1', name: 'Checkout', rootPath: root,
    baseUrl: 'https://example.com', allowedOrigins: ['https://example.com'], policyVersion: '1',
  }, 1_000)
  if (!created.ok) throw new Error('fixture project failed')
  return created.value
}

function run(): TestRun {
  const created = createRun({
    projectId: project().id, planId: planId(), mode: 'full', commitSha: 'abcdef1234567',
    configDigest: configDigest(config), policyVersion: '1',
  }, 2_000)
  if (!created.ok) throw new Error('fixture run failed')
  return created.value
}

describe('identity and results', () => {
  it('issues unguessable unique ids with a stable prefix', () => {
    expect(projectId().startsWith('proj_')).toBe(true)
    expect(projectId()).not.toBe(projectId())
    expect(caseId().startsWith('case_')).toBe(true)
    expect(correlationId().startsWith('corr_')).toBe(true)
    expect(newId<'X'>('snap').startsWith('snap_')).toBe(true)
  })

  it('wraps success and failure in one Result shape', () => {
    expect(ok(7)).toEqual({ ok: true, value: 7 })
    expect(err('bad', 'reason', 'corr_1')).toEqual({
      ok: false, error: { code: 'bad', message: 'reason', retryable: false, correlationId: 'corr_1' },
    })
    expect(err('busy', 'retry', 'corr_2', true)).toMatchObject({ ok: false })
  })

  it('hashes canonically regardless of key order', () => {
    expect(stableDigest({ a: 1, b: [2, { d: 4, c: 3 }] })).toBe(stableDigest({ b: [2, { c: 3, d: 4 }], a: 1 }))
    expect(stableDigest({ a: 1 })).not.toBe(stableDigest({ a: 2 }))
  })

  it('derives a stable configuration digest and resolves the default data dir', () => {
    const literal: ConfigShape = {
      dataDir: '', allowedOrigins: ['https://example.com'], policyVersion: '1',
      approvalTtlMs: 900_000, snapshotTtlMs: 300_000, workerPoolSize: 2,
      retentionDays: 30, metricsEnabled: true,
    }
    expect(configDigest(config)).toBe(configDigest(literal))
    const versioned: ConfigShape = {
      dataDir: '', allowedOrigins: ['https://example.com'], policyVersion: '2',
      approvalTtlMs: 900_000, snapshotTtlMs: 300_000, workerPoolSize: 2,
      retentionDays: 30, metricsEnabled: true,
    }
    expect(configDigest(config)).not.toBe(configDigest(versioned))
    expect(resolveDataDir(config, '/workspace')).toBe('/workspace/.testpilot')
    const relocated: ConfigShape = {
      dataDir: '/data/tp', allowedOrigins: ['https://example.com'], policyVersion: '1',
      approvalTtlMs: 900_000, snapshotTtlMs: 300_000, workerPoolSize: 2,
      retentionDays: 30, metricsEnabled: true,
    }
    expect(resolveDataDir(relocated, '/workspace')).toBe('/data/tp')
    expect(Config).toBeDefined()
  })
})

describe('projects', () => {
  it('creates a project with a canonical absolute root', () => {
    const value = project()
    expect(value.name).toBe('Checkout')
    expect(value.id.startsWith('proj_')).toBe(true)
    expect(value.createdAtMs).toBe(1_000)
  })

  it('rejects every malformed project input', () => {
    const base = { workspaceId: 'ws-1', name: 'Checkout', rootPath: resolve('/tmp/ws/app'), baseUrl: 'https://example.com', allowedOrigins: [], policyVersion: '1' }
    expect(createProject({ ...base, workspaceId: ' ' }, 0).ok).toBe(false)
    expect(createProject({ ...base, name: '' }, 0).ok).toBe(false)
    expect(createProject({ ...base, rootPath: 'relative/path' }, 0).ok).toBe(false)
    expect(createProject({ ...base, baseUrl: 'ftp://example.com' }, 0).ok).toBe(false)
    expect(createProject({ ...base, policyVersion: '' }, 0).ok).toBe(false)
  })

  it('keeps a project inside its owning workspace', () => {
    expect(validateProjectAgainstWorkspace(project(), resolve('/tmp/ws')).ok).toBe(true)
    expect(validateProjectAgainstWorkspace(project(resolve('/tmp/other/app')), resolve('/tmp/ws')).ok).toBe(false)
  })
})

describe('runs', () => {
  it('queues a run with its configuration digest and correlation id', () => {
    const value = run()
    expect(value.status).toBe('queued')
    expect(value.results).toEqual([])
    expect(value.configDigest).toBe(configDigest(config))
  })

  it('rejects an invalid commit and an empty config digest', () => {
    const base = { projectId: project().id, planId: planId(), mode: 'full' as const, commitSha: null, configDigest: 'digest', policyVersion: '1' }
    expect(createRun({ ...base, commitSha: 'not-hex' }, 0).ok).toBe(false)
    expect(createRun({ ...base, configDigest: '' }, 0).ok).toBe(false)
  })

  it('moves forward only and never reopens a settled run', () => {
    const queued = run()
    const started = transitionRun(queued, 'running', 3_000)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const passed = transitionRun(started.value, 'passed', 4_000)
    expect(passed.ok).toBe(true)
    if (!passed.ok) return
    expect(passed.value.finishedAtMs).toBe(4_000)
    expect(transitionRun(passed.value, 'running', 5_000).ok).toBe(false)
    expect(transitionRun(queued, 'running', 3_000).ok).toBe(true)
    expect(transitionRun(queued, 'queued', 3_000).ok).toBe(true)
    expect(transitionRun(queued, 'passed', 3_000).ok).toBe(true)
    expect(transitionRun(started.value, 'queued', 3_000).ok).toBe(false)
    expect(transitionRun(queued, 'unknown' as TestRun['status'], 0).ok).toBe(false)
  })

  it('records one result per case and refuses writes to settled runs', () => {
    const active = transitionRun(run(), 'running', 3_000)
    if (!active.ok) throw new Error('fixture transition failed')
    const result = {
      caseId: planId() as unknown as TestRun['results'][number]['caseId'],
      status: 'failed' as const, startedAtMs: 3_000, finishedAtMs: 3_100,
      durationMs: 100, failureClass: 'assertion', evidenceIds: ['ev_1'], error: 'expected 200',
    }
    const withResult = recordCaseResult(active.value, result, 3_200)
    expect(withResult.ok).toBe(true)
    if (!withResult.ok) return
    expect(withResult.value.results).toHaveLength(1)
    expect(recordCaseResult(withResult.value, result, 3_300).ok).toBe(false)
    const settled = transitionRun(withResult.value, 'failed', 3_400)
    if (!settled.ok) throw new Error('fixture settle failed')
    expect(recordCaseResult(settled.value, { ...result, caseId: planId() as unknown as TestRun['results'][number]['caseId'] }, 3_500).ok).toBe(false)
  })
})
