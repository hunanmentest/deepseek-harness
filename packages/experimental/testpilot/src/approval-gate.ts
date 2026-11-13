/** Run-scoped approval grants; one approval covers one run (ADR-011). @module */

import { randomUUID } from 'node:crypto'
import { stableDigest } from './domain.ts'
import { isHighRisk } from './risk.ts'
import type { RiskVerdict } from './risk.ts'

export interface ApprovalGrant {
  readonly grantId: string
  readonly runId: string
  readonly projectId: string
  readonly policyVersion: string
  readonly parameterDigest: string
  readonly issuedAtMs: number
  readonly expiresAtMs: number
  readonly nonce: string
  readonly consumedAtMs: number | null
  readonly revokedAtMs: number | null
}

/** Secret-free decision event; the host maps it onto its own audit store. */
export interface ApprovalAuditEvent {
  readonly atMs: number
  readonly action: 'issue' | 'consume' | 'revoke' | 'assert'
  readonly outcome: 'granted' | 'allowed' | 'denied'
  readonly runId: string
  readonly grantId: string
  readonly tool: string
  readonly code: string
}

export interface ApprovalGate {
  issue(input: {
    runId: string
    projectId: string
    policyVersion: string
    parameters: unknown
    ttlMs: number
    nowMs?: number
  }): ApprovalGrant
  consume(grantId: string, expected: { runId: string; parameters: unknown; nowMs?: number }):
    | { ok: true; grant: ApprovalGrant }
    | { ok: false; code: string; message: string }
  revoke(grantId: string, nowMs?: number): boolean
  assertAllowed(call: {
    grantId: string
    runId: string
    tool: string
    args: unknown
    verdict: RiskVerdict
    nowMs?: number
  }): { ok: true } | { ok: false; code: string; message: string }
  active(nowMs?: number): readonly ApprovalGrant[]
}

type Denied = { ok: false; code: string; message: string }
type GrantResult = { ok: true; grant: ApprovalGrant } | Denied

/** One approval covers one run; per-dispatch checks never consume the grant; read-only calls are only audited. */
export function createApprovalGate(options?: {
  readonly clock?: () => number
  readonly onAudit?: (event: ApprovalAuditEvent) => void
}): ApprovalGate {
  const grants = new Map<string, ApprovalGrant>()
  const clock = options?.clock ?? ((): number => Date.now())
  const onAudit = options?.onAudit

  function at(explicit: number | undefined): number {
    if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit
    try {
      const value = clock()
      return Number.isFinite(value) ? value : Date.now()
    } catch {
      // A broken injected clock falls back to the system clock; decisions stay fail-closed.
      return Date.now()
    }
  }

  /** Unbindable parameters receive a digest that can never match a real call. */
  function digestOf(parameters: unknown): string {
    try {
      return stableDigest(parameters)
    } catch {
      return `unbindable:${randomUUID()}`
    }
  }

  function record(event: ApprovalAuditEvent): void {
    if (onAudit === undefined) return
    try {
      onAudit(event)
    } catch {
      // An audit subscriber failure is isolated from the decision that produced it.
    }
  }

  function deny(
    atMs: number,
    action: ApprovalAuditEvent['action'],
    runId: string,
    grantId: string,
    tool: string,
    code: string,
    message: string,
  ): Denied {
    record({ atMs, action, outcome: 'denied', runId, grantId, tool, code })
    return { ok: false, code, message }
  }

  /**
   * Non-mutating per-dispatch validation. `parameters` is the run-level binding object
   * produced by grantParameters() (the SPEC's spec_digest): runId, workspaceId, projectId,
   * planId, mode, commitSha and configDigest (which carries policyVersion). Its digest
   * therefore covers workspaceId, projectId and policyVersion without extra call fields.
   * It is not browser tool args. The live dispatch path in src/policy.ts validates via
   * active() plus an explicit field match.
   */
  function validateGrant(
    grantId: string,
    runId: string,
    parameters: unknown,
    atMs: number,
    action: ApprovalAuditEvent['action'],
    tool: string,
  ): GrantResult {
    const grant = grants.get(grantId)
    if (grant === undefined) {
      return deny(atMs, action, runId, grantId, tool, 'missing-grant', 'No approval grant exists for this id')
    }
    if (grant.revokedAtMs !== null) {
      return deny(atMs, action, runId, grantId, tool, 'revoked', 'The approval grant has been revoked')
    }
    if (atMs >= grant.expiresAtMs) {
      return deny(atMs, action, runId, grantId, tool, 'expired', 'The approval grant has expired')
    }
    if (grant.runId !== runId) {
      return deny(atMs, action, runId, grantId, tool, 'mismatch', 'The approval grant belongs to another run')
    }
    if (grant.parameterDigest !== digestOf(parameters)) {
      return deny(atMs, action, runId, grantId, tool, 'mismatch', 'The run binding differs from the approved parameters')
    }
    return { ok: true, grant }
  }

  /** Run-start compare-and-mark; a spent nonce cannot start a second run. */
  function consumeInternal(
    grantId: string,
    runId: string,
    parameters: unknown,
    atMs: number,
  ): GrantResult {
    const validated = validateGrant(grantId, runId, parameters, atMs, 'consume', '')
    if (!validated.ok) return validated
    if (validated.grant.consumedAtMs !== null) {
      return deny(atMs, 'consume', runId, grantId, '', 'consumed',
        'The approval nonce has already been spent to start a run')
    }
    const consumed: ApprovalGrant = { ...validated.grant, consumedAtMs: atMs }
    grants.set(grantId, consumed)
    record({ atMs, action: 'consume', outcome: 'allowed', runId, grantId, tool: '', code: 'ok' })
    return { ok: true, grant: consumed }
  }

  return {
    issue(input): ApprovalGrant {
      const atMs = at(input.nowMs)
      const ttlMs = Number.isFinite(input.ttlMs) && input.ttlMs > 0 ? input.ttlMs : 0
      const bindingValid = input.runId.trim().length > 0 &&
        input.projectId.trim().length > 0 &&
        input.policyVersion.trim().length > 0
      const grant: ApprovalGrant = {
        grantId: randomUUID(),
        runId: input.runId,
        projectId: input.projectId,
        policyVersion: input.policyVersion,
        parameterDigest: bindingValid ? digestOf(input.parameters) : `unbindable:${randomUUID()}`,
        issuedAtMs: atMs,
        expiresAtMs: atMs + ttlMs,
        nonce: randomUUID(),
        consumedAtMs: null,
        revokedAtMs: null,
      }
      grants.set(grant.grantId, grant)
      record({
        atMs, action: 'issue', outcome: 'granted',
        runId: grant.runId, grantId: grant.grantId, tool: '', code: 'ok',
      })
      return grant
    },

    consume(grantId, expected) {
      return consumeInternal(grantId, expected.runId, expected.parameters, at(expected.nowMs))
    },

    revoke(grantId, nowMs): boolean {
      const grant = grants.get(grantId)
      if (grant === undefined || grant.revokedAtMs !== null) return false
      const atMs = at(nowMs)
      grants.set(grantId, { ...grant, revokedAtMs: atMs })
      record({
        atMs, action: 'revoke', outcome: 'denied',
        runId: grant.runId, grantId, tool: '', code: 'revoked',
      })
      return true
    },

    /** One approval covers one run: validate the live grant per dispatch without spending it. */
    assertAllowed(call) {
      const atMs = at(call.nowMs)
      if (!isHighRisk(call.verdict)) {
        record({
          atMs, action: 'assert', outcome: 'allowed',
          runId: call.runId, grantId: call.grantId, tool: call.tool, code: 'read-only-allowed',
        })
        return { ok: true }
      }
      if (call.grantId.trim().length === 0) {
        return deny(atMs, 'assert', call.runId, call.grantId, call.tool, 'high-risk-requires-grant',
          'A high-risk browser call requires a run-scoped approval grant')
      }
      const result = validateGrant(call.grantId, call.runId, call.args, atMs, 'assert', call.tool)
      if (!result.ok) return result
      record({
        atMs, action: 'assert', outcome: 'allowed',
        runId: call.runId, grantId: call.grantId, tool: call.tool, code: 'grant-valid',
      })
      return { ok: true }
    },

    active(nowMs): readonly ApprovalGrant[] {
      const atMs = at(nowMs)
      return [...grants.values()]
        .filter(grant => grant.revokedAtMs === null && grant.expiresAtMs > atMs)
        .map(grant => ({ ...grant }))
    },
  }
}
