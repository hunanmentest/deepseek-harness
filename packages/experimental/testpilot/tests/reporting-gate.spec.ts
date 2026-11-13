import { describe, expect, it } from 'vitest'
import { createRun, planId, projectId, recordCaseResult, transitionRun } from '../src/domain.ts'
import { DEFAULT_THRESHOLDS, evaluateQualityGate, gateExitCode } from '../src/quality-gate.ts'
import { renderAllReports, renderReport } from '../src/reporting.ts'
import type { CaseResult, CasePriority, EvidenceLink, TestRun } from '../src/types.ts'

function baseRun(): TestRun {
  const created = createRun({
    projectId: projectId(), planId: planId(), mode: 'full', commitSha: null,
    configDigest: 'digest', policyVersion: '1',
  }, 1_000)
  if (!created.ok) throw new Error('fixture run failed')
  return created.value
}

function settled(status: 'passed' | 'failed', result: CaseResult): TestRun {
  const running = transitionRun(baseRun(), 'running', 2_000)
  if (!running.ok) throw new Error('fixture transition failed')
  const withResult = recordCaseResult(running.value, result, 2_500)
  if (!withResult.ok) throw new Error('fixture result failed')
  const done = transitionRun(withResult.value, status, 3_000)
  if (!done.ok) throw new Error('fixture settle failed')
  return done.value
}

function result(overrides: Partial<CaseResult> = {}): CaseResult {
  return {
    caseId: 'case_<script>' as CaseResult['caseId'], status: 'passed', startedAtMs: 2_000,
    finishedAtMs: 2_500, durationMs: 500, failureClass: null, evidenceIds: ['ev_1'], error: null,
    ...overrides,
  }
}

function evidence(run: TestRun): EvidenceLink {
  return { id: 'ev_1', runId: run.id, caseId: 'case_1' as EvidenceLink['caseId'], kind: 'screenshot', attachmentId: 'att_1', byteSize: 42, sha256: 'deadbeef', createdAtMs: 2_600 }
}

describe('quality gate', () => {
  it('passes a settled run whose cases have evidence', () => {
    const run = settled('passed', result())
    const gate = evaluateQualityGate({ run, thresholds: DEFAULT_THRESHOLDS, priorities: {}, nowMs: 4_000, durationMs: 7 })
    expect(gate.verdict).toBe('pass')
    expect(gate.reasons).toEqual([])
    expect(gate.durationMs).toBe(7)
    expect(gateExitCode(gate.verdict)).toBe(0)
  })

  it('fails on a settled failure, a P0 failure and an unsettled run', () => {
    const failedRun = settled('failed', result({ status: 'failed', error: 'expected 200' }))
    expect(evaluateQualityGate({ run: failedRun, thresholds: DEFAULT_THRESHOLDS, priorities: {}, nowMs: 4_000, durationMs: 0 }).verdict).toBe('fail')
    const p0 = settled('passed', result({ status: 'failed' }))
    const priorities: Record<string, CasePriority> = { 'case_<script>': 'P0' }
    const gate = evaluateQualityGate({ run: p0, thresholds: DEFAULT_THRESHOLDS, priorities, nowMs: 4_000, durationMs: 0 })
    expect(gate.verdict).toBe('fail')
    expect(gate.reasons.some(reason => reason.includes('P0'))).toBe(true)
    expect(evaluateQualityGate({ run: baseRun(), thresholds: DEFAULT_THRESHOLDS, priorities: {}, nowMs: 4_000, durationMs: 0 }).verdict).toBe('fail')
  })

  it('warns when evidence is missing and never calls it a pass', () => {
    const run = settled('passed', result({ evidenceIds: [] }))
    const gate = evaluateQualityGate({ run, thresholds: DEFAULT_THRESHOLDS, priorities: {}, nowMs: 4_000, durationMs: 0 })
    expect(gate.verdict).toBe('warn')
    expect(gate.reasons.some(reason => reason.includes('evidence'))).toBe(true)
    expect(gateExitCode('warn')).toBe(0)
    expect(gateExitCode('warn', true)).toBe(1)
    expect(gateExitCode('fail')).toBe(1)
  })
})

describe('reports', () => {
  const run = settled('passed', result())
  const gate = evaluateQualityGate({ run, thresholds: DEFAULT_THRESHOLDS, priorities: {}, nowMs: 4_000, durationMs: 5 })
  const input = { run, project: null, gate, evidence: [evidence(run)], generatedAtMs: 5_000 }

  it('renders four formats from one authoritative run', () => {
    const all = renderAllReports(input)
    expect(Object.keys(all).sort()).toEqual(['html', 'json', 'junit', 'markdown'])
    expect(renderReport('json', input)).toBe(all.json)
    expect(JSON.parse(all.json).ok).toBe(true)
    expect(JSON.parse(all.json).data.run.id).toBe(run.id)
    expect(all.junit).toContain('<testsuite')
    expect(all.junit).toContain('tests="1"')
    expect(all.markdown).toContain('## Case results')
    expect(all.html).toContain('<!doctype html>')
    expect(all.html).toContain('TestPilot run report')
  })

  it('escapes dynamic text in HTML and JUnit', () => {
    const all = renderAllReports(input)
    expect(all.html).not.toContain('<script>')
    expect(all.html).toContain('&lt;script&gt;')
    expect(all.junit).toContain('&lt;script&gt;')
    expect(all.html).toContain('Configuration digest')
  })

  it('states missing evidence instead of implying collection succeeded', () => {
    const empty = { ...input, evidence: [] }
    expect(renderReport('json', empty)).toContain('"evidenceMissing": true')
    expect(renderReport('html', empty)).toContain('did not succeed')
    expect(renderReport('markdown', empty)).toContain('did not succeed')
  })

  it('renders a failure element and a skipped element in JUnit', () => {
    const withFailure = settled('failed', result({ status: 'failed', error: 'oops & <bad>', failureClass: 'assertion' }))
    const body = renderReport('junit', { ...input, run: withFailure })
    expect(body).toContain('<failure')
    expect(body).toContain('oops &amp; &lt;bad&gt;')
    const skipped = settled('passed', result({ status: 'skipped' }))
    expect(renderReport('junit', { ...input, run: skipped })).toContain('<skipped/>')
  })
})
