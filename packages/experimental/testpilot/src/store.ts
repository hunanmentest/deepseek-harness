/** Durable run, project, gate, audit and report records over a real key-value adapter. @module */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type {
  AuditEntry, EvidenceLink, QualityGate, TestProject, TestRun,
} from './types.ts'

export interface StoreAdapter {
  read(key: string): Promise<string | null>
  write(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
  list(prefix: string): Promise<readonly string[]>
  ready(): Promise<boolean>
}

export interface TestPilotStore {
  readonly ready: () => Promise<boolean>
  readonly putProject: (value: TestProject) => Promise<void>
  readonly getProject: (id: string) => Promise<TestProject | null>
  readonly listProjects: () => Promise<readonly TestProject[]>
  readonly putRun: (value: TestRun) => Promise<void>
  readonly getRun: (id: string) => Promise<TestRun | null>
  readonly listRuns: () => Promise<readonly TestRun[]>
  readonly putGate: (value: QualityGate) => Promise<void>
  readonly getGate: (runId: string) => Promise<QualityGate | null>
  readonly putEvidence: (value: EvidenceLink) => Promise<void>
  readonly listEvidence: (runId: string) => Promise<readonly EvidenceLink[]>
  readonly appendAudit: (value: AuditEntry) => Promise<void>
  readonly listAudit: () => Promise<readonly AuditEntry[]>
  readonly putReport: (runId: string, format: string, body: string) => Promise<void>
  readonly getReport: (runId: string, format: string) => Promise<string | null>
  readonly deleteRun: (runId: string) => Promise<void>
}

const KEY_RE = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9_-]*$/

/** Keys stay inside the root; ids never become path components without validation. */
function assertKey(key: string): void {
  if (!KEY_RE.test(key)) throw new Error(`invalid store key: ${key}`)
}

/** Atomic JSON documents: write a unique sibling, then rename into place. */
export function createFileAdapter(rootDir: string): StoreAdapter {
  const root = resolve(rootDir)
  return {
    async ready(): Promise<boolean> {
      await mkdir(root, { recursive: true })
      return true
    },
    async read(key): Promise<string | null> {
      assertKey(key)
      try {
        return await readFile(join(root, `${key}.json`), 'utf8')
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw cause
      }
    },
    async write(key, value): Promise<void> {
      assertKey(key)
      const target = join(root, `${key}.json`)
      await mkdir(join(root, key.slice(0, key.indexOf('/'))), { recursive: true })
      const temp = `${target}.${randomUUID()}.tmp`
      await writeFile(temp, value, 'utf8')
      try {
        await rename(temp, target)
      } catch (cause) {
        await rm(temp, { force: true })
        throw cause
      }
    },
    async remove(key): Promise<void> {
      assertKey(key)
      await rm(join(root, `${key}.json`), { force: true })
    },
    async list(prefix): Promise<readonly string[]> {
      if (!/^[a-z][a-z0-9-]*$/.test(prefix)) throw new Error(`invalid store prefix: ${prefix}`)
      try {
        const names = await readdir(join(root, prefix))
        return names.filter(name => name.endsWith('.json')).map(name => `${prefix}/${name.slice(0, -5)}`)
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw cause
      }
    },
  }
}

/** In-memory adapter for unit tests and read-only health checks. */
export function createMemoryAdapter(): StoreAdapter {
  const values = new Map<string, string>()
  return {
    ready: () => Promise.resolve(true),
    read: key => Promise.resolve(values.get(key) ?? null),
    write: (key, value) => {
      values.set(key, value)
      return Promise.resolve()
    },
    remove: (key) => {
      values.delete(key)
      return Promise.resolve()
    },
    list: prefix => Promise.resolve([...values.keys()].filter(key => key.startsWith(`${prefix}/`))),
  }
}

/** Parse one stored document; an absent document or an explicit null body both yield null. */
function parseRecord(raw: string | null): unknown {
  if (raw === null) return null
  return JSON.parse(raw)
}

/** One authoritative store behind the tools; all durable state passes through it. */
export function createStore(adapter: StoreAdapter): TestPilotStore {
  async function getAll<T>(prefix: string): Promise<readonly T[]> {
    const keys = await adapter.list(prefix)
    const values: T[] = []
    for (const key of keys) {
      const value = parseRecord(await adapter.read(key)) as T | null
      if (value !== null) values.push(value)
    }
    return values
  }
  return {
    ready: () => adapter.ready(),
    putProject: value => adapter.write(`projects/${value.id}`, JSON.stringify(value)),
    getProject: async (id) => {
      const raw = await adapter.read(`projects/${id}`)
      return parseRecord(raw) as TestProject | null
    },
    listProjects: () => getAll<TestProject>('projects'),
    putRun: value => adapter.write(`runs/${value.id}`, JSON.stringify(value)),
    getRun: async (id) => {
      const raw = await adapter.read(`runs/${id}`)
      return parseRecord(raw) as TestRun | null
    },
    listRuns: () => getAll<TestRun>('runs'),
    putGate: value => adapter.write(`gates/${value.runId}`, JSON.stringify(value)),
    getGate: async (runId) => {
      const raw = await adapter.read(`gates/${runId}`)
      return parseRecord(raw) as QualityGate | null
    },
    putEvidence: value => adapter.write(`evidence/${value.id}`, JSON.stringify(value)),
    listEvidence: async runId => (await getAll<EvidenceLink>('evidence')).filter(item => item.runId === runId),
    appendAudit: value => adapter.write(`audit/${value.id}`, JSON.stringify(value)),
    listAudit: () => getAll<AuditEntry>('audit'),
    putReport: (runId, format, body) => adapter.write(`reports/${runId}_${format}`, body),
    getReport: async (runId, format) => await adapter.read(`reports/${runId}_${format}`),
    deleteRun: async (runId) => {
      await adapter.remove(`runs/${runId}`)
      await adapter.remove(`gates/${runId}`)
      for (const format of ['json', 'junit', 'html', 'markdown']) {
        await adapter.remove(`reports/${runId}_${format}`)
      }
    },
  }
}
