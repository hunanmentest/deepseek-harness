import { describe, expect, it, onTestFinished } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createFileAdapter, createMemoryAdapter, createStore } from '../src/store.ts'
import { createProject, createRun, planId } from '../src/domain.ts'
import type { AuditEntry, EvidenceLink, QualityGate, TestRun } from '../src/types.ts'

function project() {
  const created = createProject({
    workspaceId: 'ws-1', name: 'Checkout', rootPath: resolve('/tmp/ws/app'),
    baseUrl: 'https://example.com', allowedOrigins: [], policyVersion: '1',
  }, 1_000)
  if (!created.ok) throw new Error('fixture project failed')
  return created.value
}

function run(projectIdValue: TestRun['projectId']): TestRun {
  const created = createRun({
    projectId: projectIdValue, planId: planId(), mode: 'full', commitSha: null,
    configDigest: 'digest', policyVersion: '1',
  }, 2_000)
  if (!created.ok) throw new Error('fixture run failed')
  return created.value
}

const p = project()
const r = run(p.id)

function gate(): QualityGate {
  return { runId: r.id, verdict: 'pass', reasons: [], evaluatedAtMs: 3_000, durationMs: 5, thresholds: { maxFailureRate: 0, minEvidenceRate: 1, requireP0Pass: true } }
}

function evidence(): EvidenceLink {
  return { id: 'ev_1', runId: r.id, caseId: 'case_1' as EvidenceLink['caseId'], kind: 'screenshot', attachmentId: 'att_1', byteSize: 128, sha256: 'abc', createdAtMs: 3_000 }
}

function audit(): AuditEntry {
  return { id: 'audit_1', atMs: 3_000, actor: 'model', action: 'run.start', outcome: 'allowed', correlationId: 'corr_1', detail: 'start' }
}

describe('memory store', () => {
  it('round-trips every durable record and filters evidence by run', async () => {
    const store = createStore(createMemoryAdapter())
    expect(await store.ready()).toBe(true)
    await store.putProject(p)
    expect(await store.getProject(p.id)).toEqual(p)
    expect(await store.listProjects()).toHaveLength(1)
    expect(await store.getProject('proj_missing')).toBeNull()
    await store.putRun(r)
    expect(await store.getRun(r.id)).toEqual(r)
    expect(await store.listRuns()).toHaveLength(1)
    expect(await store.getRun('run_missing')).toBeNull()
    await store.putGate(gate())
    expect(await store.getGate(r.id)).toEqual(gate())
    expect(await store.getGate('run_missing')).toBeNull()
    await store.putEvidence(evidence())
    expect(await store.listEvidence(r.id)).toHaveLength(1)
    expect(await store.listEvidence('run_other')).toHaveLength(0)
    await store.appendAudit(audit())
    expect(await store.listAudit()).toHaveLength(1)
  })

  it('stores reports verbatim and deletes a run with its gate and reports', async () => {
    const store = createStore(createMemoryAdapter())
    await store.putReport(r.id, 'html', '<html>report</html>')
    expect(await store.getReport(r.id, 'html')).toBe('<html>report</html>')
    expect(await store.getReport(r.id, 'json')).toBeNull()
    await store.putRun(r)
    await store.putGate(gate())
    for (const format of ['json', 'junit', 'html', 'markdown']) await store.putReport(r.id, format, format)
    await store.deleteRun(r.id)
    expect(await store.getRun(r.id)).toBeNull()
    expect(await store.getGate(r.id)).toBeNull()
    expect(await store.getReport(r.id, 'html')).toBeNull()
  })
})

describe('file adapter', () => {
  it('writes JSON documents atomically, reads them back and leaves no temp files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-testpilot-store-'))
    onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
    const adapter = createFileAdapter(root)
    expect(await adapter.ready()).toBe(true)
    const store = createStore(adapter)
    await store.putProject(p)
    await store.putRun(r)
    await store.putGate(gate())
    await store.putEvidence(evidence())
    await store.appendAudit(audit())
    await store.putReport(r.id, 'markdown', '# report')
    expect(await store.getProject(p.id)).toEqual(p)
    expect(await store.getRun(r.id)).toEqual(r)
    expect(await store.getGate(r.id)).toEqual(gate())
    expect(await store.listEvidence(r.id)).toHaveLength(1)
    expect(await store.listAudit()).toHaveLength(1)
    expect(await store.getReport(r.id, 'markdown')).toBe('# report')
    const raw = await readFile(join(root, 'projects', `${p.id}.json`), 'utf8')
    expect(JSON.parse(raw)).toEqual(p)
    const files = await readdir(join(root, 'projects'))
    expect(files.some(name => name.endsWith('.tmp'))).toBe(false)
    expect(await adapter.list('missing')).toEqual([])
    expect(await adapter.read('projects/proj_missing')).toBeNull()
    await adapter.remove(`projects/${p.id}`)
    expect(await store.getProject(p.id)).toBeNull()
    await store.deleteRun(r.id)
    expect(await store.getRun(r.id)).toBeNull()
  })

  it('rejects keys and prefixes that would escape the root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-testpilot-keys-'))
    onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
    const adapter = createFileAdapter(root)
    await expect(adapter.read('../secrets')).rejects.toThrow(/invalid store key/)
    await expect(adapter.write('projects/../secrets', '{}')).rejects.toThrow(/invalid store key/)
    await expect(adapter.remove('/etc/passwd')).rejects.toThrow(/invalid store key/)
    await expect(adapter.list('../')).rejects.toThrow(/invalid store prefix/)
  })

  it('surfaces filesystem failures and skips null documents in aggregates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-testpilot-fail-'))
    onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
    const adapter = createFileAdapter(root)
    const store = createStore(adapter)
    await adapter.ready()
    // A document that parses to null is skipped by list aggregates.
    await adapter.write('projects/ghost', 'null')
    expect(await store.listProjects()).toEqual([])
    // A file where a directory belongs makes list() fail instead of guessing.
    await writeFile(join(root, 'gates'), 'not a directory', 'utf8')
    await expect(adapter.list('gates')).rejects.toThrow()
    // A directory where a document belongs makes read() fail...
    await mkdir(join(root, 'runs', 'collide.json'), { recursive: true })
    await expect(adapter.read('runs/collide')).rejects.toThrow()
    // ...and write() removes its temp file before surfacing the rename failure.
    await expect(adapter.write('runs/collide', '{}')).rejects.toThrow()
    const temps = (await readdir(join(root, 'runs'))).filter(name => name.endsWith('.tmp'))
    expect(temps).toEqual([])
  })
})
