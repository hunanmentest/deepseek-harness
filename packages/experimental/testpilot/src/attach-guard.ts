/** Attach endpoint protocol and host checks (ADR-010). @module */

import { URL } from 'node:url'
import { isPrivateHost } from './origin-allowlist.ts'

export interface AttachVerdict {
  readonly allowed: boolean
  readonly reason: string
}

const SUPPORTED_PROTOCOLS: readonly string[] = ['http:', 'https:', 'ws:', 'wss:']
const METADATA_HOSTS: readonly string[] = [
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.internal',
  'metadata.goog',
  'metadata',
]

function deny(reason: string): AttachVerdict {
  return { allowed: false, reason }
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '').replace(/^\[/, '').replace(/\]$/, '')
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host.endsWith('.localhost') ||
    host === '::1' || host === '0:0:0:0:0:0:0:1' ||
    /^127\./.test(host) || /^::ffff:127\./.test(host)
}

function isMetadataHost(host: string): boolean {
  return METADATA_HOSTS.includes(host)
}

/** Loopback needs allowLoopback; private and metadata hosts are never attachable. */
export function checkAttachEndpoint(raw: unknown, options?: {
  readonly allowLoopback?: boolean
  readonly allowedHosts?: readonly string[]
}): AttachVerdict {
  if (typeof raw !== 'string' || raw.trim().length === 0) return deny('invalid-endpoint-input')
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return deny('malformed-url')
  }
  if (!SUPPORTED_PROTOCOLS.includes(parsed.protocol)) return deny('unsupported-protocol')
  if (parsed.username.length > 0 || parsed.password.length > 0) return deny('embedded-credentials')
  if (parsed.hostname.endsWith('.')) return deny('trailing-dot-host')
  const host = normalizeHost(parsed.hostname)
  if (host.length === 0) return deny('missing-hostname')
  if (host.includes('xn--') || /[^\x00-\x7f]/.test(host)) return deny('idn-host-rejected')
  if (isMetadataHost(host)) return deny('metadata-endpoint-rejected')
  if (isPrivateHost(host)) {
    if (!isLoopbackHost(host)) return deny('private-host-not-allowed')
    if (options?.allowLoopback !== true) return deny('loopback-not-allowed')
  }
  const allowedHosts = options?.allowedHosts
  if (allowedHosts !== undefined) {
    const normalized = allowedHosts
      .filter((item): item is string => typeof item === 'string')
      .map(normalizeHost)
    if (normalized.length === 0 || !normalized.includes(host)) return deny('host-not-allowlisted')
  }
  return { allowed: true, reason: 'allowed' }
}
