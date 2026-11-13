/** The single pre-dispatch policy point: origin, attach, risk and run-scoped grant. @module */

import { stableDigest } from './domain.ts'
import { classifyToolCall, isHighRisk } from './risk.ts'
import type { ApprovalGate } from './approval-gate.ts'
import type { OriginPolicy } from './origin-allowlist.ts'
import { checkAttachEndpoint } from './attach-guard.ts'
import type { RiskClass } from './risk.ts'
import type { TestRun } from './types.ts'

/** Fields a run-scoped grant binds to; the same object is used at issue and at every check. */
export function grantParameters(run: TestRun, workspaceId: string): Readonly<Record<string, string | null>> {
  return {
    runId: run.id,
    workspaceId,
    projectId: run.projectId,
    planId: run.planId,
    mode: run.mode,
    commitSha: run.commitSha,
    configDigest: run.configDigest,
  }
}

export interface ActionRequest {
  readonly runId: string
  readonly projectId: string
  readonly tool: string
  readonly args: unknown
  readonly url: string | null
  readonly redirectTo: string | null
  readonly attachEndpoint: string | null
  readonly grantId: string | null
  readonly binding: unknown
  readonly nowMs: number
}

export interface PolicyDecision {
  readonly allowed: boolean
  readonly code: string
  readonly reason: string
  readonly risk: RiskClass
  readonly auditDetail: string
}

export interface PolicyServices {
  readonly approvals: ApprovalGate
  readonly origins: OriginPolicy
  readonly policyVersion: string
}

/**
 * Evaluate one browser action before dispatch. Read-only calls still pass through
 * origin checks; high-risk calls need a live, unexpired, unrevoked grant whose
 * digest, project, policy and run all match. The check never consumes the grant,
 * so one approval covers one run without becoming a permanent authorization.
 */
export function evaluateAction(services: PolicyServices, request: ActionRequest): PolicyDecision {
  const verdict = classifyToolCall(request.tool, request.args)
  const base = { risk: verdict.risk }
  if (request.url !== null) {
    const origin = request.redirectTo === null
      ? services.origins.check(request.url)
      : services.origins.checkRedirect(request.url, request.redirectTo)
    if (!origin.allowed) {
      return { ...base, allowed: false, code: 'origin-denied', reason: origin.reason, auditDetail: `origin denied for ${request.tool}` }
    }
  }
  const needsAttach = /attach|cdp|endpoint/i.test(request.tool) || request.attachEndpoint !== null
  if (needsAttach) {
    const attach = request.attachEndpoint === null
      ? { allowed: false, reason: 'attach endpoint missing' }
      : checkAttachEndpoint(request.attachEndpoint)
    if (!attach.allowed) {
      return { ...base, allowed: false, code: 'attach-denied', reason: attach.reason, auditDetail: `attach denied for ${request.tool}` }
    }
  }
  if (!isHighRisk(verdict)) {
    return { ...base, allowed: true, code: 'allowed', reason: 'read or low-risk action', auditDetail: `allowed ${request.tool}` }
  }
  if (request.grantId === null) {
    return { ...base, allowed: false, code: 'high-risk-requires-grant', reason: 'high-risk action needs a run-scoped grant', auditDetail: `denied ${request.tool} without grant` }
  }
  const digest = stableDigest(request.binding)
  const grants = services.approvals.active(request.nowMs)
  const match = grants.find(grant => grant.grantId === request.grantId
    && grant.runId === request.runId
    && grant.projectId === request.projectId
    && grant.policyVersion === services.policyVersion
    && grant.parameterDigest === digest
    && grant.revokedAtMs === null)
  if (match === undefined) {
    return { ...base, allowed: false, code: 'grant-invalid', reason: 'no matching live grant for this run and parameter digest', auditDetail: `denied ${request.tool} with invalid grant` }
  }
  return { ...base, allowed: true, code: 'allowed-with-grant', reason: `risk ${verdict.risk} covered by grant ${match.grantId}`, auditDetail: `allowed ${request.tool} under grant ${match.grantId}` }
}
