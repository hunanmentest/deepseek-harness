/**
 * Drives every model-facing tool through the real executor: the plugin is
 * mounted on a genuine cordis Context with the real tool registry and native
 * executor, and each call goes through executeToolFixture. Covers the tool
 * execute bodies' success and refusal paths, the approval-audit wiring of
 * apply(), and the degraded health reporting.
 */
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as TestPilot from '../src/index.ts'
import { createRun, planId, transitionRun } from '../src/domain.ts'
import type { Config } from '../src/config.ts'
import type { EvidenceLink, ProjectId } from '../src/types.ts'

type Reply<T = unknown> = { ok: boolean; data: T; error: { code: string; message: string } | null }

async function mount(overrides: Partial<Config> = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-testpilot-exec-'))
  const ctx = new Context()
  onTestFinished(() => rm(dataDir, { recursive: true, force: true }))
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  const config: Config = {
    dataDir,
    allowedOrigins: ['https://example.com'],
    policyVersion: '1',
    approvalTtlMs: 900_000,
    snapshotTtlMs: 300_000,
    workerPoolSize: 2,
    retentionDays: 30,
    metricsEnabled: true,
    ...overrides,
  }
  await ctx.plugin(TestPilot, config)
  return { ctx, dataDir }
}

let sequence = 0
function call(ctx: Context, name: string, args: unknown) {
  return executeToolFixture(ctx, {
    signal: new AbortController().signal,
    callId: ToolCallId(`exec-${++sequence}`),
    name,
    arguments: args,
  })
}

/** The canonical tool value declared by every testpilot tool is a JSON string. */
function toolText(result: { readonly value: unknown }): string {
  if (typeof result.value !== 'string') throw new Error('expected a string tool value')
  return result.value
}

async function body(ctx: Context, name: string, args: unknown): Promise<Reply> {
  const result = await call(ctx, name, args)
  expect(result.isError).toBe(false)
  return JSON.parse(toolText(result)) as Reply
}

async function refuse(ctx: Context, name: string, args: unknown): Promise<string> {
  const reply = await body(ctx, name, args)
  expect(reply.ok).toBe(false)
  expect(reply.error).not.toBeNull()
  return reply.error?.code ?? ''
}

describe('tool execution', () => {
  it('runs one project from creation to reports, metrics and health', async () => {
    const { ctx, dataDir } = await mount()
    const created = await body(ctx, 'testpilot_project_create', {
      workspaceId: 'ws-1',
      name: 'Checkout',
      rootPath: join(dataDir, 'app'),
      baseUrl: 'https://example.com',
      workspaceRoot: dataDir,
      allowedOrigins: ['https://example.com'],
    })
    expect(created.ok).toBe(true)
    const project = created.data as { id: string }
    expect(project.id.startsWith('proj_')).toBe(true)
    expect((await body(ctx, 'testpilot_project_list', {})).data).toHaveProperty('projects')

    const started = await body(ctx, 'testpilot_run_start', {
      projectId: project.id,
      planId: 'plan_1',
      mode: 'smoke',
      commitSha: '0123456',
    })
    const run = started.data as { runId: string; grantId: string; expiresAtMs: number; status: string }
    expect(run.status).toBe('queued')
    expect(run.expiresAtMs).toBeGreaterThan(0)
    expect((await body(ctx, 'testpilot_run_get', { runId: run.runId })).ok).toBe(true)
    expect((await body(ctx, 'testpilot_run_list', {})).ok).toBe(true)

    const captured = await body(ctx, 'testpilot_snapshot_capture', {
      runId: run.runId,
      agentId: 'agent-1',
      refsJson: '{"@e1":"submit button"}',
    })
    const snapshot = captured.data as { id: string }
    expect(snapshot.id.startsWith('snap_')).toBe(true)

    // A read-only call without a url passes without origin or attach checks;
    // a url-bearing call is cross-origin by design and needs the grant below.
    const read = await body(ctx, 'testpilot_locator_check', {
      snapshotId: snapshot.id, ref: '@e1', agentId: 'agent-1', runId: run.runId,
      tool: 'browser_snapshot',
    })
    expect((read.data as { policy: { code: string } }).policy.code).toBe('allowed')

    // A high-risk call is covered by the run-scoped grant issued at run start.
    const evaluated = await body(ctx, 'testpilot_locator_check', {
      snapshotId: snapshot.id, ref: '@e1', agentId: 'agent-1', runId: run.runId,
      tool: 'browser_evaluate', url: 'https://example.com', grantId: run.grantId,
    })
    expect((evaluated.data as { policy: { code: string } }).policy.code).toBe('allowed-with-grant')

    // Seed one durable evidence link the way the storage layer persists it.
    const link: EvidenceLink = {
      id: 'ev_1', runId: run.runId as EvidenceLink['runId'], caseId: 'case_1' as EvidenceLink['caseId'],
      kind: 'screenshot', attachmentId: 'att_1', byteSize: 42, sha256: 'deadbeef', createdAtMs: 1,
    }
    await mkdir(join(dataDir, 'evidence'), { recursive: true })
    await writeFile(join(dataDir, 'evidence', `${link.id}.json`), JSON.stringify(link), 'utf8')

    const gated = await body(ctx, 'testpilot_gate_evaluate', { runId: run.runId, warnAsFailure: true })
    const gate = gated.data as { gate: { verdict: string }; exitCode: number; formats: string[] }
    expect(gate.gate.verdict).toBe('fail')
    expect(gate.exitCode).toBe(1)
    expect(gate.formats).toEqual(['json', 'junit', 'html', 'markdown'])
    expect((await body(ctx, 'testpilot_gate_evaluate', { runId: run.runId })).ok).toBe(true)

    for (const format of ['json', 'junit', 'html', 'markdown']) {
      const report = await call(ctx, 'testpilot_report_get', { runId: run.runId, format })
      expect(toolText(report).length).toBeGreaterThan(0)
    }
    expect((await call(ctx, 'testpilot_report_get', { runId: run.runId })).value).toBeTypeOf('string')

    const evidence = await body(ctx, 'testpilot_evidence_list', { runId: run.runId })
    expect((evidence.data as { missing: string[] }).missing).toEqual(['console', 'network', 'trace'])

    const metrics = await body(ctx, 'testpilot_metrics', {})
    expect((metrics.data as { definitions: Record<string, string> }).definitions.runSuccessRate).toContain('runsCompleted')

    // A settled run on disk exercises the not-active arm of the health filter.
    const settled = createRun({
      projectId: project.id as ProjectId, planId: planId(), mode: 'full', commitSha: null,
      configDigest: 'digest', policyVersion: '1',
    }, 1)
    if (!settled.ok) throw new Error('fixture run failed')
    const finished = transitionRun(settled.value, 'passed', 2)
    if (!finished.ok) throw new Error('fixture settle failed')
    await writeFile(join(dataDir, 'runs', `${finished.value.id}.json`), JSON.stringify(finished.value), 'utf8')

    const status = await body(ctx, 'testpilot_status', {})
    const health = (status.data as { health: { ok: boolean; activeGrants: number; storeReady: boolean; snapshots: number } }).health
    expect(health.ok).toBe(true)
    expect(health.storeReady).toBe(true)
    expect(health.activeGrants).toBe(1)
    expect(health.snapshots).toBe(1)
  })

  it('refuses malformed project, run, snapshot and report requests without throwing', async () => {
    const { ctx, dataDir } = await mount()
    const created = await body(ctx, 'testpilot_project_create', {
      workspaceId: 'ws-1', name: 'Checkout', rootPath: join(dataDir, 'app'),
      baseUrl: 'https://example.com', workspaceRoot: dataDir,
    })
    const project = created.data as { id: string }

    expect(await refuse(ctx, 'testpilot_project_create', {
      workspaceId: ' ', name: 'x', rootPath: dataDir, baseUrl: 'https://example.com', workspaceRoot: dataDir,
    })).toBe('invalid-workspace')
    expect(await refuse(ctx, 'testpilot_project_create', {
      workspaceId: 'ws', name: ' ', rootPath: dataDir, baseUrl: 'https://example.com', workspaceRoot: dataDir,
    })).toBe('invalid-name')
    expect(await refuse(ctx, 'testpilot_project_create', {
      workspaceId: 'ws', name: 'x', rootPath: 'relative/path', baseUrl: 'https://example.com', workspaceRoot: dataDir,
    })).toBe('invalid-root')
    expect(await refuse(ctx, 'testpilot_project_create', {
      workspaceId: 'ws', name: 'x', rootPath: dataDir, baseUrl: 'ftp://example.com', workspaceRoot: dataDir,
    })).toBe('invalid-base-url')
    expect(await refuse(ctx, 'testpilot_project_create', {
      workspaceId: 'ws', name: 'x', rootPath: join(tmpdir(), 'elsewhere'), baseUrl: 'https://example.com', workspaceRoot: dataDir,
    })).toBe('outside-workspace')

    expect(await refuse(ctx, 'testpilot_run_start', { projectId: 'proj_missing', planId: 'plan_1' })).toBe('project-not-found')
    expect((await body(ctx, 'testpilot_run_start', { projectId: project.id, planId: 'plan_1', commitSha: 'not-hex' })).ok).toBe(false)
    expect(await refuse(ctx, 'testpilot_run_get', { runId: 'run_missing' })).toBe('run-not-found')
    expect(await refuse(ctx, 'testpilot_gate_evaluate', { runId: 'run_missing' })).toBe('run-not-found')
    expect(await refuse(ctx, 'testpilot_report_get', { runId: 'run_missing', format: 'json' })).toBe('report-not-found')

    expect(await refuse(ctx, 'testpilot_snapshot_capture', { runId: 'run_x', agentId: 'a', refsJson: 'not json' })).toBe('invalid-refs-json')
    expect(await refuse(ctx, 'testpilot_snapshot_capture', { runId: 'run_x', agentId: 'a', refsJson: '[]' })).toBe('invalid-refs')
    expect(await refuse(ctx, 'testpilot_snapshot_capture', { runId: 'run_x', agentId: 'a', refsJson: '{"@e1": 5}' })).toBe('invalid-refs')
    expect((await body(ctx, 'testpilot_snapshot_capture', { runId: 'run_x', agentId: 'a', refsJson: '{"bad":"x"}' })).ok).toBe(false)
  })

  it('denies policy violations through locator_check with audited refusals', async () => {
    const { ctx, dataDir } = await mount()
    const created = await body(ctx, 'testpilot_project_create', {
      workspaceId: 'ws-1', name: 'Checkout', rootPath: join(dataDir, 'app'),
      baseUrl: 'https://example.com', workspaceRoot: dataDir,
    })
    const project = created.data as { id: string }
    const started = await body(ctx, 'testpilot_run_start', { projectId: project.id, planId: 'plan_1' })
    const run = started.data as { runId: string; grantId: string }
    const captured = await body(ctx, 'testpilot_snapshot_capture', { runId: run.runId, agentId: 'agent-1', refsJson: '{"@e1":"submit"}' })
    const snapshot = captured.data as { id: string }
    const valid = { snapshotId: snapshot.id, ref: '@e1', agentId: 'agent-1', runId: run.runId }

    // A low-risk call without a url passes without origin or attach checks.
    const lowRisk = await body(ctx, 'testpilot_locator_check', { ...valid, tool: 'browser_click' })
    expect((lowRisk.data as { policy: { code: string } }).policy.code).toBe('allowed')
    expect(await refuse(ctx, 'testpilot_locator_check', { ...valid, tool: 'browser_click', url: 'https://evil.test' })).toBe('origin-denied')
    expect(await refuse(ctx, 'testpilot_locator_check', { ...valid, tool: 'browser_attach' })).toBe('attach-denied')
    expect(await refuse(ctx, 'testpilot_locator_check', { ...valid, tool: 'browser_evaluate' })).toBe('high-risk-requires-grant')
    expect(await refuse(ctx, 'testpilot_locator_check', { ...valid, tool: 'browser_evaluate', grantId: 'grant_bogus' })).toBe('grant-invalid')
    expect(await refuse(ctx, 'testpilot_locator_check', { ...valid, tool: 'browser_click', url: 'https://example.com', attachEndpoint: 'http://127.0.0.1:9222' })).toBe('attach-denied')
    expect(await refuse(ctx, 'testpilot_locator_check', { ...valid, tool: 'browser_click', runId: 'run_missing' })).toBe('run-not-found')
    expect((await body(ctx, 'testpilot_locator_check', { ...valid, ref: '@e9', tool: 'browser_click' })).ok).toBe(false)
    expect((await body(ctx, 'testpilot_locator_check', { ...valid, snapshotId: 'snap_missing', tool: 'browser_click' })).ok).toBe(false)
    // A run whose project record has disappeared from the store is refused, not guessed.
    await rm(join(dataDir, 'projects', `${project.id}.json`), { force: true })
    expect(await refuse(ctx, 'testpilot_locator_check', { ...valid, tool: 'browser_click' })).toBe('project-not-found')
  })

  it('isolates a durable audit write failure from the decision that produced it', async () => {
    const { ctx, dataDir } = await mount()
    // A file where the audit directory belongs makes every durable audit write
    // fail while every other store operation keeps working.
    await writeFile(join(dataDir, 'audit'), 'not a directory', 'utf8')
    const created = await body(ctx, 'testpilot_project_create', {
      workspaceId: 'ws-1', name: 'Checkout', rootPath: join(dataDir, 'app'),
      baseUrl: 'https://example.com', workspaceRoot: dataDir,
    })
    const project = created.data as { id: string }
    const started = await body(ctx, 'testpilot_run_start', { projectId: project.id, planId: 'plan_1' })
    expect(started.ok).toBe(true)
    // A run with no evidence yet still evaluates and records the missing-evidence metric.
    const gated = await body(ctx, 'testpilot_gate_evaluate', { runId: (started.data as { runId: string }).runId })
    expect(gated.ok).toBe(true)
    const auditPath = await stat(join(dataDir, 'audit'))
    expect(auditPath.isFile()).toBe(true)
  })

  it('reports degraded health for an empty allowlist and disabled metrics', async () => {
    const { ctx } = await mount({ allowedOrigins: [], metricsEnabled: false })
    const status = await body(ctx, 'testpilot_status', {})
    const health = (status.data as { health: { ok: boolean; reasons: string[] } }).health
    expect(health.ok).toBe(false)
    expect(health.reasons).toHaveLength(2)
  })
})
