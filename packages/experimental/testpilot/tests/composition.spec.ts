/**
 * Real composition: the plugin is mounted on a genuine cordis Context carrying
 * the real tool registry, and the model-facing `testpilot_*` tools must appear
 * and disappear with the plugin fiber. Static assertions pin the publishable
 * bundle contract (manifest, patch row, locales, icon, no default export).
 */
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { approvalAuditRecord, Config, inject, name, apply } from '../src/index.ts'
import * as TestPilot from '../src/index.ts'
import type { ApprovalAuditEvent } from '../src/approval-gate.ts'

const packageDir = fileURLToPath(new URL('..', import.meta.url))

/** The exact model-facing surface the bundle patch promises. */
const EXPECTED_TOOLS = [
  'testpilot_project_create',
  'testpilot_project_list',
  'testpilot_run_start',
  'testpilot_run_get',
  'testpilot_run_list',
  'testpilot_snapshot_capture',
  'testpilot_locator_check',
  'testpilot_gate_evaluate',
  'testpilot_report_get',
  'testpilot_evidence_list',
  'testpilot_metrics',
  'testpilot_status',
]

function validConfig(dataDir: string) {
  return Config({
    dataDir,
    allowedOrigins: [],
    policyVersion: '1',
    approvalTtlMs: 900_000,
    snapshotTtlMs: 300_000,
    workerPoolSize: 2,
    retentionDays: 30,
    metricsEnabled: true,
  })
}

describe('publishable bundle contract (static)', () => {
  it('declares a public npm package with the patch as its only bundle content', async () => {
    const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8')) as Record<string, unknown>
    expect(manifest.name).toBe('@deepseek-ai/dsh-testpilot')
    expect(manifest).not.toHaveProperty('private')
    expect((manifest.publishConfig as Record<string, unknown>).access).toBe('public')
    expect((manifest.dsh as { bundle: { patch: string } }).bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.main).toBe('lib/index.js')
    expect(manifest.type).toBe('module')
    const dependencies = manifest.dependencies as Record<string, string>
    expect(Object.keys(dependencies)).toEqual(['@deepseek-ai/schemastery'])
  })

  it('inserts exactly one plugin row and rewrites nothing else', async () => {
    const patch = await readFile(join(packageDir, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('- id: testpilot')
    expect(patch).toContain("name: '@deepseek-ai/dsh-testpilot'")
    expect(patch).toContain('- insert:')
    expect(patch).not.toMatch(/^\s*-\s*(replace|remove|insert_after|insert_before):/m)
  })

  it('ships eight locales whose detail pointers resolve to real docs', async () => {
    const localeDir = join(packageDir, 'locale')
    const files = (await readdir(localeDir)).filter(f => f.endsWith('.json')).sort()
    expect(files).toEqual(['de.json', 'en.json', 'es.json', 'fr.json', 'ja.json', 'pt.json', 'ru.json', 'zh.json'])
    for (const file of files) {
      const parsed = JSON.parse(await readFile(join(localeDir, file), 'utf8')) as { meta: { title: string } }
      expect(parsed.meta.title.length).toBeGreaterThan(0)
    }
    const english = JSON.parse(await readFile(join(localeDir, 'en.json'), 'utf8')) as { meta: { detail: string } }
    const chinese = JSON.parse(await readFile(join(localeDir, 'zh.json'), 'utf8')) as { meta: { detail: string } }
    const detailFiles = [english.meta.detail, chinese.meta.detail]
    for (const detail of detailFiles) {
      await stat(join(packageDir, detail))
    }
    await stat(join(packageDir, 'icon.svg'))
  })

  it('exposes the cordis plugin identity as named exports and no default export', () => {
    expect(name).toBe('testpilot')
    expect(inject).toContain('tools')
    expect(apply).toBeTypeOf('function')
    expect(Config).toBeDefined()
    expect((TestPilot as { default?: unknown }).default).toBeUndefined()
  })
})

describe('approval audit wiring (ADR-011)', () => {
  it('maps every gate event onto a run-domain audit record without secrets', () => {
    const denied: ApprovalAuditEvent = {
      atMs: 1_000, action: 'assert', outcome: 'denied',
      runId: 'run_1', grantId: 'grant_1', tool: 'browser_click', code: 'expired',
    }
    expect(approvalAuditRecord(denied)).toEqual({
      actor: 'approval-gate',
      action: 'approval.assert',
      outcome: 'denied',
      correlationId: 'run_1',
      detail: 'expired browser_click',
    })
    const granted: ApprovalAuditEvent = {
      atMs: 1_000, action: 'issue', outcome: 'granted',
      runId: 'run_2', grantId: 'grant_2', tool: '', code: 'ok',
    }
    const record = approvalAuditRecord(granted)
    expect(record.outcome).toBe('allowed')
    expect(record.detail).toBe('ok')
  })
})

describe('real cordis composition', () => {
  it('contributes exactly the twelve model tools and withdraws them on unload', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'testpilot-composition-'))
    onTestFinished(() => rm(dataDir, { recursive: true, force: true }))
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    expect(ctx.tools.schemas().filter(schema => schema.name.startsWith('testpilot_'))).toEqual([])

    const fiber = await ctx.plugin(TestPilot, validConfig(dataDir))
    const mounted = ctx.tools.schemas().map(schema => schema.name)
      .filter(toolName => toolName.startsWith('testpilot_')).sort()
    expect(mounted).toEqual([...EXPECTED_TOOLS].sort())

    await fiber.dispose()
    const after = ctx.tools.schemas().filter(schema => schema.name.startsWith('testpilot_'))
    expect(after).toEqual([])
  })
})
