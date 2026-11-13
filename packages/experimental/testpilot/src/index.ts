/**
 * TestPilot bundle plugin: one named-export function plugin contributing the
 * model-facing quality tools. No default export; the Loader reads `inject`.
 * @module @deepseek-ai/dsh-testpilot
 */

import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { configDigest, resolveDataDir } from './config.ts'
import type { Config as TestPilotConfig } from './config.ts'
import { createApprovalGate } from './approval-gate.ts'
import type { ApprovalAuditEvent } from './approval-gate.ts'
import type { AuditEntry } from './types.ts'
import { createOriginPolicy } from './origin-allowlist.ts'
import { createFileAdapter, createStore } from './store.ts'
import { createObservability } from './observability.ts'
import { createSnapshotRegistry } from './snapshot-registry.ts'
import { registerTestPilotTools } from './tools.ts'

export { Config, configDigest, resolveDataDir } from './config.ts'
export type { Config as TestPilotConfigShape } from './config.ts'
export { createApprovalGate } from './approval-gate.ts'
export { createOriginPolicy } from './origin-allowlist.ts'
export { classifyToolCall, isHighRisk } from './risk.ts'

/** Cordis identity; the bundle patch addresses this row by id. */
export const name = 'testpilot'

/** The tool registry is the only host service this plugin requires. */
export const inject = ['tools']

/**
 * Map one approval-gate decision event onto the run-domain audit record
 * (ADR-011): the run id becomes the correlation id, the gate outcome becomes
 * the audit outcome, and code plus tool form a secret-free detail line.
 */
export function approvalAuditRecord(event: ApprovalAuditEvent): Omit<AuditEntry, 'id' | 'atMs'> {
  return {
    actor: 'approval-gate',
    action: `approval.${event.action}`,
    outcome: event.outcome === 'denied' ? 'denied' : 'allowed',
    correlationId: event.runId,
    detail: `${event.code} ${event.tool}`.trim(),
  }
}

/**
 * Assemble the durable store, policy modules and tool registrations. Every
 * registration is an effect of this fiber, so unloading the bundle removes it.
 * @param ctx - plugin context carrying the tool registry.
 * @param config - validated deployment choices.
 */
export async function apply(ctx: Context, config: TestPilotConfig): Promise<void> {
  const dataDir = resolveDataDir(config, resolve(process.cwd()))
  const store = createStore(createFileAdapter(dataDir))
  await store.ready()
  const observability = createObservability(config.metricsEnabled)
  // ADR-011: approval decisions are audited into the run domain. The same
  // entry reaches the in-memory trail (readable through testpilot_status)
  // and the durable store; a durable-write failure never blocks a decision.
  const approvals = createApprovalGate({
    onAudit: (event) => {
      const entry = observability.audit(approvalAuditRecord(event))
      void store.appendAudit(entry).catch(() => {
        // Durable audit is best-effort at decision time; the in-memory
        // trail above already holds the event for health inspection.
      })
    },
  })
  registerTestPilotTools(ctx, {
    config,
    dataDir,
    digest: configDigest(config),
    store,
    observability,
    snapshots: createSnapshotRegistry(config.snapshotTtlMs),
    approvals,
    origins: createOriginPolicy(config.allowedOrigins),
    now: () => Date.now(),
  })
}
