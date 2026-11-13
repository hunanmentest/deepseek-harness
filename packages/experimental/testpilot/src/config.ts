/** Plugin configuration and the digest that binds a run to its policy snapshot. @module */

import Schema from '@deepseek-ai/schemastery'
import { stableDigest } from './domain.ts'

/** Deployment choices for one TestPilot activation. */
export interface Config {
  /** Directory for the durable run store. Empty selects `<cwd>/.testpilot`. */
  dataDir: string
  /** Origins the browser may reach; empty rejects every navigation. */
  allowedOrigins: string[]
  /** Version stamped into approval grants and runs; changing it invalidates old grants. */
  policyVersion: string
  /** Lifetime of one run-scoped approval grant, in milliseconds. */
  approvalTtlMs: number
  /** Lifetime of one snapshot reference, in milliseconds. */
  snapshotTtlMs: number
  /** Bounded case worker pool size; declarative until the worker pool ships in Phase 2. */
  workerPoolSize: number
  /** Retention window for runs, results and reports, in days. */
  retentionDays: number
  /** Collect counters and health metrics. */
  metricsEnabled: boolean
}

/** Validated at activation by the Loader. */
export const Config: Schema<Config> = Schema.object({
  dataDir: Schema.string().default(''),
  allowedOrigins: Schema.array(Schema.string()).default([]),
  policyVersion: Schema.string().default('1'),
  approvalTtlMs: Schema.number().min(1000).default(900_000),
  snapshotTtlMs: Schema.number().min(1000).default(300_000),
  workerPoolSize: Schema.number().min(1).max(16).default(2),
  retentionDays: Schema.number().min(1).default(30),
  metricsEnabled: Schema.boolean().default(true),
})

/** Resolve the storage root without writing outside the configured directory. */
export function resolveDataDir(config: Config, cwd: string): string {
  return config.dataDir.trim().length === 0 ? `${cwd}/.testpilot` : config.dataDir
}

/** Stable identity of the configuration and policy snapshot carried by every run. */
export function configDigest(config: Config): string {
  return stableDigest({
    allowedOrigins: [...config.allowedOrigins].sort(),
    policyVersion: config.policyVersion,
    approvalTtlMs: config.approvalTtlMs,
    snapshotTtlMs: config.snapshotTtlMs,
    workerPoolSize: config.workerPoolSize,
    retentionDays: config.retentionDays,
  })
}
