/** Origin allowlist with per-hop redirect checks (ADR-010). @module */

import { URL } from 'node:url'

export interface OriginVerdict {
  readonly allowed: boolean
  readonly reason: string
  readonly normalized: string | null
}

export interface OriginPolicy {
  check(rawUrl: unknown): OriginVerdict
  checkRedirect(fromRaw: unknown, toRaw: unknown): OriginVerdict
  readonly entries: readonly string[]
}

const HTTP_PROTOCOLS: readonly string[] = ['http:', 'https:']
const METADATA_HOSTS: readonly string[] = [
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.internal',
  'metadata.goog',
  'metadata',
]

/** Private, loopback, link-local and cloud-metadata hosts are reported by one predicate. */
export function isPrivateHost(host: string): boolean {
  const value = host.trim().toLowerCase().replace(/\.$/, '').replace(/^\[/, '').replace(/\]$/, '')
  if (value.length === 0) return true
  if (value === 'localhost' || value.endsWith('.localhost')) return true
  if (value.endsWith('.internal') || value.endsWith('.local') || value.endsWith('.localdomain')) return true
  if (value === '0.0.0.0' || value === '::' || value === '::1' || value === '0:0:0:0:0:0:0:1') return true
  if (METADATA_HOSTS.includes(value)) return true
  if (/^127\./.test(value) || /^0\./.test(value) || /^10\./.test(value)) return true
  if (/^192\.168\./.test(value) || /^169\.254\./.test(value)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(value)) return true
  if (/^(fc|fd)[0-9a-f]*:/.test(value) || /^fe[89ab][0-9a-f]*:/.test(value)) return true
  if (/^::ffff:(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(value)) return true
  return false
}

function isMetadataHost(host: string): boolean {
  return METADATA_HOSTS.includes(host.trim().toLowerCase().replace(/\.$/, ''))
}

interface NormalizedOk {
  readonly ok: true
  readonly reason: 'allowed'
  readonly origin: string
}

interface NormalizedBad {
  readonly ok: false
  readonly reason: string
  readonly origin: string | null
}

/** A pass verdict always carries its normalized origin; failures may or may not. */
type Normalized = NormalizedOk | NormalizedBad

/** Rejects credentials, non-http(s), trailing dots, IDN and metadata hosts before matching. */
function normalize(raw: unknown): Normalized {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, reason: 'invalid-url-input', origin: null }
  }
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, reason: 'malformed-url', origin: null }
  }
  if (!HTTP_PROTOCOLS.includes(parsed.protocol)) {
    return { ok: false, reason: 'unsupported-protocol', origin: null }
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return { ok: false, reason: 'embedded-credentials', origin: parsed.origin }
  }
  const host = parsed.hostname
  if (host.endsWith('.')) return { ok: false, reason: 'trailing-dot-host', origin: parsed.origin }
  if (host.includes('xn--') || /[^\x00-\x7f]/.test(host)) {
    return { ok: false, reason: 'idn-host-rejected', origin: parsed.origin }
  }
  if (isMetadataHost(host)) {
    return { ok: false, reason: 'metadata-endpoint-rejected', origin: parsed.origin }
  }
  return { ok: true, reason: 'allowed', origin: parsed.origin }
}

/** Empty or wholly invalid configuration rejects every navigation. */
export function createOriginPolicy(allowedOrigins: readonly string[]): OriginPolicy {
  const entries: string[] = []
  for (const raw of allowedOrigins) {
    const normalized = normalize(raw)
    if (!normalized.ok) continue
    if (!entries.includes(normalized.origin)) entries.push(normalized.origin)
  }
  const frozen: readonly string[] = Object.freeze([...entries])

  function checkOne(rawUrl: unknown): OriginVerdict {
    if (frozen.length === 0) {
      return { allowed: false, reason: 'empty-allowlist-fail-closed', normalized: null }
    }
    const normalized = normalize(rawUrl)
    if (!normalized.ok) {
      return { allowed: false, reason: normalized.reason, normalized: normalized.origin }
    }
    if (!frozen.includes(normalized.origin)) {
      return { allowed: false, reason: 'origin-not-allowlisted', normalized: normalized.origin }
    }
    return { allowed: true, reason: 'allowed', normalized: normalized.origin }
  }

  return {
    check(rawUrl: unknown): OriginVerdict {
      return checkOne(rawUrl)
    },

    /** Both hops must be allowlisted; a redirect never inherits the source's permission. */
    checkRedirect(fromRaw: unknown, toRaw: unknown): OriginVerdict {
      const from = checkOne(fromRaw)
      if (!from.allowed) {
        return { allowed: false, reason: `redirect-source:${from.reason}`, normalized: from.normalized }
      }
      const to = checkOne(toRaw)
      if (!to.allowed) {
        return { allowed: false, reason: `redirect-target:${to.reason}`, normalized: to.normalized }
      }
      return { allowed: true, reason: 'allowed', normalized: to.normalized }
    },

    entries: frozen,
  }
}
