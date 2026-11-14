/** Model-facing tools. One canonical JSON string per tool; long work returns immediately. @module */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { correlationId, createProject, createRun, validateProjectAgainstWorkspace } from './domain.ts'
import { configDigest } from './config.ts'
import type { Config } from './config.ts'
import { validateLocator } from './locator-validator.ts'
import type { SnapshotRegistry } from './snapshot-registry.ts'
import type { TestPilotStore } from './store.ts'
import type { Observability } from './observability.ts'
import { deriveRates, METRIC_DEFINITIONS } from './observability.ts'
import type { ApprovalGate } from './approval-gate.ts'
import type { OriginPolicy } from './origin-allowlist.ts'
import { evaluateAction, grantParameters } from './policy.ts'
import { DEFAULT_THRESHOLDS, evaluateQualityGate, gateExitCode } from './quality-gate.ts'
import { renderAllReports } from './reporting.ts'
import type { HealthStatus, PlanId } from './types.ts'

export interface ToolServices {
  readonly config: Config
  readonly dataDir: string
  readonly digest: string
  readonly store: TestPilotStore
  readonly observability: Observability
  readonly snapshots: SnapshotRegistry
  readonly approvals: ApprovalGate
  readonly origins: OriginPolicy
  readonly now: () => number
}

function reply(data: unknown): string {
  return JSON.stringify({ ok: true, data, error: null })
}

function refuse(code: string, message: string, corr: string): string {
  return JSON.stringify({ ok: false, data: null, error: { code, message, retryable: false, correlationId: corr } })
}

/** Register every tool as a reversible effect of the plugin fiber. */
export function registerTestPilotTools(ctx: Context, services: ToolServices): void {
  const { store, observability, snapshots, approvals, origins, config } = services
  const now = services.now

  ctx.tools.register(defineTool({
    name: 'testpilot_project_create',
    description: 'Create a TestPilot project bound to a workspace directory. The project root must stay inside the workspace.',
    parameters: {
      workspaceId: { type: 'string', required: true, description: 'Owning workspace identifier.' },
      name: { type: 'string', required: true, description: 'Human-readable project name.' },
      rootPath: { type: 'string', required: true, description: 'Absolute project directory.' },
      baseUrl: { type: 'string', required: true, description: 'Base URL under test, http or https.' },
      workspaceRoot: { type: 'string', required: true, description: 'Absolute workspace root that must contain rootPath.' },
      allowedOrigins: { type: 'array', items: { type: 'string' }, description: 'Optional per-project origin list.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const corr = correlationId()
      const created = createProject({
        workspaceId: args.workspaceId,
        name: args.name,
        rootPath: args.rootPath,
        baseUrl: args.baseUrl,
        allowedOrigins: args.allowedOrigins ?? config.allowedOrigins,
        policyVersion: config.policyVersion,
      }, now())
      if (!created.ok) return refuse(created.error.code, created.error.message, corr)
      const checked = validateProjectAgainstWorkspace(created.value, args.workspaceRoot)
      if (!checked.ok) return refuse(checked.error.code, checked.error.message, corr)
      await store.putProject(checked.value)
      observability.audit({ actor: 'model', action: 'project.create', outcome: 'allowed', correlationId: corr, detail: checked.value.id })
      return reply(checked.value)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'testpilot_project_list',
    description: 'List stored TestPilot projects.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { return reply({ projects: await store.listProjects() }) },
  }))

  ctx.tools.register(defineTool({
    name: 'testpilot_run_start',
    description: 'Queue a test run and issue its expiring run-scoped approval grant. Returns immediately; poll testpilot_run_get.',
    parameters: {
      projectId: { type: 'string', required: true, description: 'Existing project id.' },
      planId: { type: 'string', required: true, description: 'Plan id whose cases will run.' },
      mode: { type: 'string', enum: ['full', 'smoke', 'risk_based'], description: 'Selection mode; defaults to full.' },
      commitSha: { type: 'string', description: 'Commit under test, 7 to 64 hex characters.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const corr = correlationId()
      const project = await store.getProject(args.projectId)
      if (project === null) return refuse('project-not-found', `project ${args.projectId} does not exist`, corr)
      const created = createRun({
        projectId: project.id,
        planId: args.planId as PlanId,
        mode: args.mode ?? 'full',
        commitSha: args.commitSha ?? null,
        configDigest: services.digest,
        policyVersion: config.policyVersion,
      }, now())
      if (!created.ok) return refuse(created.error.code, created.error.message, corr)
      await store.putRun(created.value)
      const grant = approvals.issue({
        runId: created.value.id,
        projectId: project.id,
        policyVersion: config.policyVersion,
        parameters: grantParameters(created.value, project.workspaceId),
        ttlMs: config.approvalTtlMs,
        nowMs: now(),
      })
      observability.record('run_started')
      observability.audit({ actor: 'model', action: 'run.start', outcome: 'allowed', correlationId: corr, detail: `run ${created.value.id} grant ${grant.grantId}` })
      return reply({ runId: created.value.id, status: created.value.status, grantId: grant.grantId, expiresAtMs: grant.expiresAtMs })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'testpilot_run_get',
    description: 'Read one durable test run, its status and case results.',
    parameters: { runId: { type: 'string', required: true, description: 'Run id.' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const run = await store.getRun(args.runId)
      return run === null ? refuse('run-not-found', `run ${args.runId} does not exist`, correlationId()) : reply(run)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'testpilot_run_list',
    description: 'List stored test runs with their current status.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { return reply({ runs: await store.listRuns() }) },
  }))

  ctx.tools.register(defineTool({
    name: 'testpilot_snapshot_capture',
    description: 'Register a versioned, expiring page snapshot and its @eN element refs for one run and agent.',
    parameters: {
      runId: { type: 'string', required: true, description: 'Owning run id.' },
      agentId: { type: 'string', required: true, description: 'Agent identity that owns the refs.' },
      refsJson: { type: 'string', required: true, description: 'JSON object mapping @eN to an element description.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute(args) {
      const corr = correlationId()
      let parsed: unknown
      try { parsed = JSON.parse(args.refsJson) } catch { return Promise.resolve(refuse('invalid-refs-json', 'refsJson must be valid JSON', corr)) }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return Promise.resolve(refuse('invalid-refs', 'refsJson must describe an object', corr))
      }
      const refs: Record<string, string> = {}
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value !== 'string') return Promise.resolve(refuse('invalid-refs', 'every ref description must be a string', corr))
        refs[key] = value
      }
      const captured = snapshots.capture({ runId: args.runId, agentId: args.agentId, refs })
      return Promise.resolve(captured.ok ? reply(captured.value) : refuse(captured.error.code, captured.error.message, corr))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'testpilot_locator_check',
    description: 'Validate a snapshot ref and evaluate origin, attach, risk and approval policy before any browser call.',
    parameters: {
      snapshotId: { type: 'string', required: true, description: 'Live snapshot id.' },
      ref: { type: 'string', required: true, description: 'Element ref such as @e3.' },
      agentId: { type: 'string', required: true, description: 'Agent identity owning the snapshot.' },
      runId: { type: 'string', required: true, description: 'Run id carrying the approval grant.' },
      tool: { type: 'string', required: true, description: 'Browser tool about to be dispatched.' },
      url: { type: 'string', description: 'Navigation target, checked against the origin allowlist.' },
      redirectTo: { type: 'string', description: 'Observed redirect target, checked hop by hop.' },
      attachEndpoint: { type: 'string', description: 'CDP or attachment endpoint, checked for private and metadata hosts.' },
      grantId: { type: 'string', description: 'Run-scoped grant id for a high-risk action.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const corr = correlationId()
      const atMs = now()
      const locator = validateLocator(snapshots, { snapshotId: args.snapshotId, ref: args.ref, agentId: args.agentId }, atMs)
      if (!locator.ok) return refuse(locator.error.code, locator.error.message, corr)
      const run = await store.getRun(args.runId)
      if (run === null) return refuse('run-not-found', `run ${args.runId} does not exist`, corr)
      const project = await store.getProject(run.projectId)
      if (project === null) return refuse('project-not-found', `project ${run.projectId} does not exist`, corr)
      const decision = evaluateAction({ approvals, origins, policyVersion: config.policyVersion }, {
        runId: args.runId,
        projectId: run.projectId,
        tool: args.tool,
        args: { ref: args.ref, url: args.url ?? null },
        url: args.url ?? null,
        redirectTo: args.redirectTo ?? null,
        attachEndpoint: args.attachEndpoint ?? null,
        grantId: args.grantId ?? null,
        binding: grantParameters(run, project.workspaceId),
        nowMs: atMs,
      })
      observability.audit({
        actor: 'model', action: `action.${args.tool}`,
        outcome: decision.allowed ? 'allowed' : 'denied',
        correlationId: corr, detail: decision.auditDetail,
      })
      if (decision.code === 'origin-denied' || decision.code === 'attach-denied') observability.record(decision.code === 'origin-denied' ? 'origin_denied' : 'approval_denied')
      if (!decision.allowed && decision.code.startsWith('grant')) observability.record('approval_denied')
      observability.log({ level: decision.allowed ? 'info' : 'warn', event: 'policy.decision', correlationId: corr, runId: args.runId, caseId: null, policyVersion: config.policyVersion, durationMs: null, detail: decision.reason })
      return decision.allowed
        ? reply({ locator: locator.value, policy: { code: decision.code, risk: decision.risk, reason: decision.reason } })
        : refuse(decision.code, decision.reason, corr)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'testpilot_gate_evaluate',
    description: 'Evaluate the deterministic quality gate for a run and store JSON, JUnit, HTML and Markdown reports.',
    parameters: {
      runId: { type: 'string', required: true, description: 'Run id to evaluate.' },
      warnAsFailure: { type: 'boolean', description: 'Treat a warn verdict as CI exit code 1.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const corr = correlationId()
      const run = await store.getRun(args.runId)
      if (run === null) return refuse('run-not-found', `run ${args.runId} does not exist`, corr)
      const started = now()
      const gate = evaluateQualityGate({ run, thresholds: DEFAULT_THRESHOLDS, priorities: {}, nowMs: now(), durationMs: 0 })
      const evidence = await store.listEvidence(run.id)
      const reports = renderAllReports({ run, project: await store.getProject(run.projectId), gate, evidence, generatedAtMs: now() })
      for (const [format, body] of Object.entries(reports)) {
        await store.putReport(run.id, format, body)
      }
      await store.putGate(gate)
      observability.record('gate_evaluated')
      observability.record('gate_duration', now() - started)
      if (evidence.length === 0) observability.record('evidence_missing')
      return reply({ gate, exitCode: gateExitCode(gate.verdict, args.warnAsFailure ?? false), formats: Object.keys(reports) })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'testpilot_report_get',
    description: 'Read a stored report for one run in JSON, JUnit, HTML or Markdown format.',
    parameters: {
      runId: { type: 'string', required: true, description: 'Run id.' },
      format: { type: 'string', enum: ['json', 'junit', 'html', 'markdown'], description: 'Report format; defaults to json.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute(args) {
      const format = args.format ?? 'json'
      return store.getReport(args.runId, format).then(body =>
        body === null
          ? refuse('report-not-found', `no ${format} report for ${args.runId}; run testpilot_gate_evaluate first`, correlationId())
          : body)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'testpilot_evidence_list',
    description: 'List evidence references for a run and name the kinds that were not collected.',
    parameters: { runId: { type: 'string', required: true, description: 'Run id.' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const items = await store.listEvidence(args.runId)
      const required = ['screenshot', 'console', 'network', 'trace']
      const present = new Set(items.map(item => item.kind))
      return reply({ evidence: items, missing: required.filter(kind => !present.has(kind)) })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'testpilot_metrics',
    description: 'Read counters, derived rates, P95 duration and the exact definition of each metric.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute() {
      const snapshot = observability.snapshot(now())
      return Promise.resolve(reply({
        snapshot,
        rates: deriveRates(snapshot),
        runDurationP95Ms: observability.percentile(95),
        definitions: METRIC_DEFINITIONS,
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'testpilot_status',
    description: 'Report plugin health, configuration digest, live grants, snapshots and active runs.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() {
      const atMs = now()
      const runs = await store.listRuns()
      const activeRuns = runs.filter(run => run.status === 'queued' || run.status === 'running').length
      const reasons: string[] = []
      if (config.allowedOrigins.length === 0) reasons.push('origin allowlist is empty: every navigation is refused')
      if (!config.metricsEnabled) reasons.push('metrics collection is disabled')
      const health: HealthStatus = {
        ok: reasons.length === 0,
        plugin: '@deepseek-ai/dsh-testpilot',
        policyVersion: config.policyVersion,
        configDigest: configDigest(config),
        dataDir: services.dataDir,
        storeReady: await store.ready(),
        activeRuns,
        activeGrants: approvals.active(atMs).length,
        snapshots: snapshots.size(atMs),
        checkedAtMs: atMs,
        reasons,
      }
      return reply({ health, projects: runs.length, logs: observability.logs().length, auditEntries: observability.auditTrail().length })
    },
  }))
}
