import { describe, expect, it } from 'vitest'
import { createApprovalGate } from '../src/approval-gate.ts'
import { classifyToolCall, isHighRisk, UPSTREAM_TOOL_RISKS } from '../src/risk.ts'
import { createOriginPolicy, isPrivateHost } from '../src/origin-allowlist.ts'
import { checkAttachEndpoint } from '../src/attach-guard.ts'
import { buildEvidenceBundle, createEvidenceRef, redactText } from '../src/evidence.ts'
import { evaluateAction, grantParameters } from '../src/policy.ts'
import { createRun, planId, projectId } from '../src/domain.ts'
import type { RiskVerdict } from '../src/risk.ts'
import type { EvidenceRef } from '../src/evidence.ts'

const high: RiskVerdict = { tool: 'browser_evaluate', risk: 'code-execution', highRisk: true, reasons: ['code-argument'] }
const read: RiskVerdict = { tool: 'browser_snapshot', risk: 'read', highRisk: false, reasons: [] }

describe('risk classification', () => {
  it('covers the measured upstream surface and fails closed on unknown tools', () => {
    expect(Object.keys(UPSTREAM_TOOL_RISKS).length).toBeGreaterThanOrEqual(24)
    expect(UPSTREAM_TOOL_RISKS.browser_snapshot).toBe('read')
    expect(UPSTREAM_TOOL_RISKS.browser_navigate).toBe('navigate')
    expect(UPSTREAM_TOOL_RISKS.browser_click).toBe('mutate')
    expect(UPSTREAM_TOOL_RISKS.browser_close).toBe('destructive')
    expect(UPSTREAM_TOOL_RISKS.browser_evaluate).toBe('code-execution')
    expect(classifyToolCall('browser_unknown', {}).risk).toBe('destructive')
    expect(classifyToolCall('browser_unknown', {}).reasons).toContain('unknown-tool')
    expect(classifyToolCall('', {}).reasons).toContain('invalid-tool')
    expect(classifyToolCall(42, {}).risk).toBe('destructive')
    expect(isHighRisk(high)).toBe(true)
    expect(isHighRisk(read)).toBe(false)
  })

  it('upgrades code arguments, script URLs and cross-origin targets without echoing argument text', () => {
    expect(classifyToolCall('browser_click', { code: 'alert(1)' }).risk).toBe('code-execution')
    expect(classifyToolCall('browser_click', { url: 'javascript:alert(1)' }).risk).toBe('code-execution')
    expect(classifyToolCall('browser_click', { url: 'https://elsewhere.test/x' }).highRisk).toBe(true)
    const verdict = classifyToolCall('browser_click', { url: 'https://elsewhere.test/SECRET-PAYLOAD' })
    expect(JSON.stringify(verdict)).not.toContain('SECRET-PAYLOAD')
    expect(classifyToolCall('browser_snapshot', 'not-an-object').reasons).toContain('invalid-args')
    // An unparseable url argument is skipped; a non-http url never becomes cross-origin.
    expect(classifyToolCall('browser_click', { url: ':: not a url ::' }).risk).toBe('mutate')
    expect(classifyToolCall('browser_click', { url: 'ftp://example.test/x' }).highRisk).toBe(false)
  })
})

describe('run-scoped approval gate', () => {
  const binding = { runId: 'run_1', projectId: 'proj_1', mode: 'full' }
  function gate() {
    return createApprovalGate({ clock: () => 1_000, onAudit: () => {} })
  }
  function issued() {
    return gate().issue({ runId: 'run_1', projectId: 'proj_1', policyVersion: '1', parameters: binding, ttlMs: 5_000, nowMs: 1_000 })
  }

  it('binds a grant to its run parameters and stamps an expiry and nonce', () => {
    const grant = issued()
    expect(grant.grantId).toBeTypeOf('string')
    expect(grant.nonce).toBeTypeOf('string')
    expect(grant.expiresAtMs).toBe(6_000)
    expect(grant.parameterDigest).toHaveLength(64)
    expect(grant.consumedAtMs).toBeNull()
  })

  it('keeps one grant usable across a whole run after the run-start nonce is spent', () => {
    const gate = createApprovalGate({ clock: () => 1_000 })
    const grant = gate.issue({ runId: 'run_1', projectId: 'proj_1', policyVersion: '1', parameters: binding, ttlMs: 5_000, nowMs: 1_000 })
    expect(gate.consume(grant.grantId, { runId: 'run_1', parameters: binding, nowMs: 1_100 }).ok).toBe(true)
    expect(gate.consume(grant.grantId, { runId: 'run_1', parameters: binding, nowMs: 1_200 }).ok).toBe(false)
    expect(gate.active(1_300)).toHaveLength(1)
    const call = { grantId: grant.grantId, runId: 'run_1', tool: 'browser_evaluate', args: binding, verdict: high, nowMs: 1_400 }
    expect(gate.assertAllowed(call).ok).toBe(true)
    expect(gate.assertAllowed(call).ok).toBe(true)
  })

  it('denies missing, mismatched, revoked, expired and read-only-free paths', () => {
    const gate = createApprovalGate({ clock: () => 1_000 })
    const grant = gate.issue({ runId: 'run_1', projectId: 'proj_1', policyVersion: '1', parameters: binding, ttlMs: 5_000, nowMs: 1_000 })
    const base = { grantId: grant.grantId, runId: 'run_1', tool: 'browser_evaluate', args: binding, verdict: high, nowMs: 1_500 }
    expect(gate.assertAllowed({ ...base, grantId: '' }).ok).toBe(false)
    expect(gate.assertAllowed({ ...base, args: { ...binding, mode: 'smoke' } }).ok).toBe(false)
    expect(gate.assertAllowed({ ...base, runId: 'run_2' }).ok).toBe(false)
    expect(gate.assertAllowed({ ...base, nowMs: 9_000 }).ok).toBe(false)
    expect(gate.assertAllowed({ ...base, verdict: read }).ok).toBe(true)
    expect(gate.revoke(grant.grantId, 1_600)).toBe(true)
    expect(gate.revoke(grant.grantId, 1_700)).toBe(false)
    expect(gate.active(1_800)).toHaveLength(0)
    expect(gate.assertAllowed(base).ok).toBe(false)
    expect(gate.consume('grant_missing', { runId: 'run_1', parameters: binding, nowMs: 1_000 }).ok).toBe(false)
  })

  it('falls back to the system clock when no clock, a non-finite clock or a throwing clock is supplied', () => {
    const before = Date.now()
    const defaults = createApprovalGate()
    expect(defaults.issue({ runId: 'run_1', projectId: 'proj_1', policyVersion: '1', parameters: binding, ttlMs: 1_000 }).issuedAtMs)
      .toBeGreaterThanOrEqual(before)
    const nan = createApprovalGate({ clock: () => Number.NaN })
    expect(nan.issue({ runId: 'run_1', projectId: 'proj_1', policyVersion: '1', parameters: binding, ttlMs: 1_000 }).issuedAtMs)
      .toBeGreaterThanOrEqual(before)
    const throwing = createApprovalGate({ clock: () => { throw new Error('clock broke') } })
    expect(throwing.issue({ runId: 'run_1', projectId: 'proj_1', policyVersion: '1', parameters: binding, ttlMs: 1_000 }).issuedAtMs)
      .toBeGreaterThanOrEqual(before)
    const explicit = createApprovalGate({ clock: () => 5_000 })
    expect(explicit.issue({ runId: 'run_1', projectId: 'proj_1', policyVersion: '1', parameters: binding, ttlMs: 1_000, nowMs: Number.NaN }).issuedAtMs)
      .toBe(5_000)
  })

  it('never issues a matching digest for unbindable parameters', () => {
    const gate = createApprovalGate({ clock: () => 1_000 })
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const grant = gate.issue({ runId: 'run_1', projectId: 'proj_1', policyVersion: '1', parameters: circular, ttlMs: 5_000, nowMs: 1_000 })
    expect(grant.parameterDigest).toMatch(/^unbindable:/)
    expect(gate.consume(grant.grantId, { runId: 'run_1', parameters: circular, nowMs: 1_100 }))
      .toMatchObject({ ok: false, code: 'mismatch' })
    const unbindableBinding = gate.issue({ runId: '', projectId: '', policyVersion: '', parameters: binding, ttlMs: 1_000, nowMs: 1_000 })
    expect(unbindableBinding.parameterDigest).toMatch(/^unbindable:/)
  })

  it('issues grants that are born expired for a non-positive ttl and clocks consume from the injected clock', () => {
    const gate = createApprovalGate({ clock: () => 1_000 })
    const grant = gate.issue({ runId: 'run_1', projectId: 'proj_1', policyVersion: '1', parameters: binding, ttlMs: 0, nowMs: 1_000 })
    expect(grant.expiresAtMs).toBe(grant.issuedAtMs)
    expect(gate.assertAllowed({ grantId: grant.grantId, runId: 'run_1', tool: 'browser_evaluate', args: binding, verdict: high }))
      .toMatchObject({ ok: false, code: 'expired' })
    expect(gate.consume(grant.grantId, { runId: 'run_1', parameters: binding }))
      .toMatchObject({ ok: false, code: 'expired' })
  })
})

describe('origin and attach policy', () => {
  it('fails closed on an empty allowlist and checks both redirect hops', () => {
    expect(createOriginPolicy([]).check('https://example.com').reason).toBe('empty-allowlist-fail-closed')
    const policy = createOriginPolicy(['https://example.com'])
    expect(policy.check('https://example.com/path').allowed).toBe(true)
    expect(policy.check('https://evil.test').reason).toBe('origin-not-allowlisted')
    expect(policy.checkRedirect('https://example.com', 'https://evil.test').reason).toContain('redirect-target')
    expect(policy.checkRedirect('https://evil.test', 'https://example.com').reason).toContain('redirect-source')
    expect(policy.checkRedirect('https://example.com', 'https://example.com').allowed).toBe(true)
    expect(policy.entries).toEqual(['https://example.com'])
    expect(createOriginPolicy(['https://a.test', 'https://a.test', 'ftp://bad']).entries).toEqual(['https://a.test'])
  })

  it('rejects malformed, credential-bearing, non-http and private hosts', () => {
    const policy = createOriginPolicy(['https://example.com', 'ftp://bad', 'https://user:pw@example.com', ''])
    expect(policy.check('not a url').reason).toBe('malformed-url')
    expect(policy.check('ftp://example.com').reason).toBe('unsupported-protocol')
    expect(policy.check('https://user:pw@example.com').reason).toBe('embedded-credentials')
    expect(policy.check('https://example.com./').reason).toBe('trailing-dot-host')
    expect(policy.check('https://xn--mnchen-3ya.com').reason).toBe('idn-host-rejected')
    expect(policy.check('https://xn--example.com').reason).toBe('malformed-url')
    expect(policy.check('http://169.254.169.254/latest').reason).toBe('metadata-endpoint-rejected')
    expect(policy.check(null).reason).toBe('invalid-url-input')
    expect(isPrivateHost('127.0.0.1')).toBe(true)
    expect(isPrivateHost('10.1.2.3')).toBe(true)
    expect(isPrivateHost('172.16.0.1')).toBe(true)
    expect(isPrivateHost('192.168.1.1')).toBe(true)
    expect(isPrivateHost('169.254.169.254')).toBe(true)
    expect(isPrivateHost('metadata.google.internal')).toBe(true)
    expect(isPrivateHost('8.8.8.8')).toBe(false)
    expect(isPrivateHost('')).toBe(true)
    expect(isPrivateHost('localhost')).toBe(true)
    expect(isPrivateHost('app.localhost')).toBe(true)
    expect(isPrivateHost('db.internal')).toBe(true)
    expect(isPrivateHost('printer.local')).toBe(true)
    expect(isPrivateHost('host.localdomain')).toBe(true)
    expect(isPrivateHost('0.0.0.0')).toBe(true)
    expect(isPrivateHost('::')).toBe(true)
    expect(isPrivateHost('::1')).toBe(true)
    expect(isPrivateHost('[::1]')).toBe(true)
    expect(isPrivateHost('[0.0.0.0]')).toBe(true)
    expect(isPrivateHost('fd00::1')).toBe(true)
    expect(isPrivateHost('fe80::1')).toBe(true)
    expect(isPrivateHost('::ffff:127.0.0.1')).toBe(true)
  })

  it('allows loopback only when explicitly requested and never allows metadata endpoints', () => {
    expect(checkAttachEndpoint('http://127.0.0.1:9222').reason).toBe('loopback-not-allowed')
    expect(checkAttachEndpoint('http://127.0.0.1:9222', { allowLoopback: true }).allowed).toBe(true)
    expect(checkAttachEndpoint('http://10.0.0.5:9222', { allowLoopback: true }).reason).toBe('private-host-not-allowed')
    expect(checkAttachEndpoint('http://169.254.169.254').reason).toBe('metadata-endpoint-rejected')
    expect(checkAttachEndpoint('file:///tmp/x').reason).toBe('unsupported-protocol')
    expect(checkAttachEndpoint('https://user:pw@host.test').reason).toBe('embedded-credentials')
    expect(checkAttachEndpoint('https://example.test', { allowedHosts: ['other.test'] }).reason).toBe('host-not-allowlisted')
    expect(checkAttachEndpoint('https://example.test', { allowedHosts: ['example.test'] }).allowed).toBe(true)
    expect(checkAttachEndpoint(null).reason).toBe('invalid-endpoint-input')
    expect(checkAttachEndpoint('https://xn--nxasmq6b.test').reason).toBe('idn-host-rejected')
    expect(checkAttachEndpoint('https://xn--host.test').reason).toBe('malformed-url')
    expect(checkAttachEndpoint('https://example.test./').reason).toBe('trailing-dot-host')
    expect(checkAttachEndpoint('http://user@127.0.0.1:9222').reason).toBe('embedded-credentials')
  })
})

describe('evidence', () => {
  it('redacts credentials, private keys and cards without retaining source text', () => {
    expect(redactText('Bearer abc.def-ghi')).toContain('[REDACTED:bearer]')
    expect(redactText('password=hunter2')).toContain('[REDACTED:password]')
    expect(redactText('api_key: "xyz"')).toContain('[REDACTED:api_key]')
    expect(redactText('cookie: session=abc')).toContain('[REDACTED:')
    expect(redactText('4111111111111111')).toContain('[REDACTED:credit-card]')
    const key = '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----'
    expect(redactText(key)).not.toContain('secret')
    expect(redactText('INTERNAL-42', [/INTERNAL-\d+/])).toContain('[REDACTED:custom]')
    expect(redactText('INTERNAL-42', [null as unknown as RegExp])).toBe('INTERNAL-42')
  })

  it('stores only a reference with a digest and reports missing kinds', () => {
    const ref = createEvidenceRef({
      kind: 'console', attachmentId: 'att_1', content: Buffer.from('password=hunter2'),
      runId: 'run_1', caseId: 'case_1', nowMs: 1_000,
    })
    expect(ref.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(ref.byteSize).toBe(16)
    expect(ref.redacted).toBe(true)
    expect(ref.createdAtMs).toBe(1_000)
    const crossScope = { ...ref, id: 'other', runId: 'run_2' } satisfies EvidenceRef
    const malformed = { ...ref, id: 'bad', sha256: 'nope' } satisfies EvidenceRef
    const bundle = buildEvidenceBundle('run_1', 'case_1', [ref, crossScope, malformed], ['screenshot', 'console', 'network'])
    expect(bundle.refs).toHaveLength(1)
    expect(bundle.missing).toEqual(['screenshot', 'network'])
  })

  it('timestamps new evidence from the system clock and deduplicates required kinds', () => {
    const before = Date.now()
    const ref = createEvidenceRef({
      kind: 'screenshot', attachmentId: 'att_2', content: Buffer.from('pixels'),
      runId: 'run_1', caseId: 'case_1',
    })
    expect(ref.createdAtMs).toBeGreaterThanOrEqual(before)
    const duplicated = buildEvidenceBundle('run_1', 'case_1', [ref], ['screenshot', 'screenshot'])
    expect(duplicated.missing).toEqual([])
    const duplicatedMissing = buildEvidenceBundle('run_1', 'case_1', [], ['trace', 'trace'])
    expect(duplicatedMissing.missing).toEqual(['trace'])
  })
})

describe('pre-dispatch policy', () => {
  const created = createRun({
    projectId: projectId(), planId: planId(), mode: 'full', commitSha: null,
    configDigest: 'digest', policyVersion: '1',
  }, 1_000)
  if (!created.ok) throw new Error('fixture run failed')
  const run = created.value
  const binding = grantParameters(run, 'ws-1')
  const approvals = createApprovalGate({ clock: () => 1_000 })
  const origins = createOriginPolicy(['https://example.com'])
  const grant = approvals.issue({ runId: run.id, projectId: run.projectId, policyVersion: '1', parameters: binding, ttlMs: 5_000, nowMs: 1_000 })
  const services = { approvals, origins, policyVersion: '1' }
  const base = {
    runId: run.id, projectId: run.projectId, args: {}, url: null as string | null,
    redirectTo: null as string | null, attachEndpoint: null as string | null,
    grantId: null as string | null, binding, nowMs: 1_000,
  }

  it('allows a low-risk call and denies high risk without a grant', () => {
    expect(evaluateAction(services, { ...base, tool: 'browser_snapshot' }).code).toBe('allowed')
    expect(evaluateAction(services, { ...base, tool: 'browser_evaluate' }).code).toBe('high-risk-requires-grant')
    expect(evaluateAction(services, { ...base, tool: 'browser_evaluate', grantId: grant.grantId }).code).toBe('allowed-with-grant')
    expect(evaluateAction(services, { ...base, tool: 'browser_evaluate', grantId: grant.grantId, nowMs: 9_000 }).code).toBe('grant-invalid')
  })

  it('denies origin, redirect and attach violations before any browser call', () => {
    expect(evaluateAction(services, { ...base, tool: 'browser_snapshot', url: 'https://evil.test' }).code).toBe('origin-denied')
    expect(evaluateAction(services, { ...base, tool: 'browser_snapshot', url: 'https://example.com', redirectTo: 'https://evil.test' }).code).toBe('origin-denied')
    expect(evaluateAction(services, { ...base, tool: 'browser_attach' }).code).toBe('attach-denied')
    expect(evaluateAction(services, { ...base, tool: 'browser_snapshot', attachEndpoint: 'http://127.0.0.1:9222' }).code).toBe('attach-denied')
  })

  it('allows an allowlisted navigation and a cross-origin redirect that stays inside the allowlist', () => {
    expect(evaluateAction(services, { ...base, tool: 'browser_snapshot', url: 'https://example.com' }).code).toBe('allowed')
    expect(evaluateAction(services, { ...base, tool: 'browser_snapshot', url: 'https://example.com', redirectTo: 'https://example.com' }).code).toBe('allowed')
  })

  it('admits a public attach endpoint and covers the subsequent call with the grant', () => {
    expect(evaluateAction(services, {
      ...base, tool: 'browser_attach', attachEndpoint: 'https://chrome.test:9222', grantId: grant.grantId,
    }).code).toBe('allowed-with-grant')
  })
})
