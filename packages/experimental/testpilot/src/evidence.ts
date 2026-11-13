/** Domain evidence references, text redaction and bundle assembly (ADR-012). @module */

import { createHash, randomUUID } from 'node:crypto'

export interface EvidenceRef {
  readonly id: string
  readonly kind: 'screenshot' | 'trace' | 'video' | 'console' | 'network' | 'report' | 'assertion'
  readonly attachmentId: string
  readonly byteSize: number
  readonly sha256: string
  readonly createdAtMs: number
  readonly runId: string
  readonly caseId: string
  readonly redacted: boolean
}

export interface EvidenceBundle {
  readonly runId: string
  readonly caseId: string
  readonly refs: readonly EvidenceRef[]
  readonly missing: readonly string[]
}

const ALL_KINDS: readonly EvidenceRef['kind'][] = [
  'screenshot', 'trace', 'video', 'console', 'network', 'report', 'assertion',
]
const TEXT_KINDS: readonly EvidenceRef['kind'][] = ['console', 'network', 'report', 'assertion']
const SHA256_RE = /^[0-9a-fA-F]{64}$/

interface RedactRule {
  readonly pattern: RegExp
  readonly replacement: string
}

/** Matches become fixed placeholders; no source text or source length is retained. */
const REDACT_RULES: readonly RedactRule[] = [
  {
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
    replacement: '[REDACTED:private-key]',
  },
  {
    pattern: /Bearer\s+[a-z0-9._~+/=-]+/i,
    replacement: '[REDACTED:bearer]',
  },
  {
    pattern: /(\b(?:["'])?authorization(?:["'])?\s*[:=]\s*)([^\r\n]+)/i,
    replacement: '$1[REDACTED:authorization]',
  },
  {
    pattern: /(\b(?:["'])?set-cookie(?:["'])?\s*[:=]\s*)([^\r\n]+)/i,
    replacement: '$1[REDACTED:set-cookie]',
  },
  {
    pattern: /(?<!set-)(\b(?:["'])?cookie(?:["'])?\s*[:=]\s*)([^\r\n]+)/i,
    replacement: '$1[REDACTED:cookie]',
  },
  {
    pattern: /(\b(?:["'])?api[_-]?key(?:["'])?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}\]]+)/i,
    replacement: '$1[REDACTED:api_key]',
  },
  {
    pattern: /(\b(?:["'])?(?:(?:access|refresh|id|auth)[_-]?)?token(?:["'])?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}\]]+)/i,
    replacement: '$1[REDACTED:token]',
  },
  {
    pattern: /(\b(?:["'])?(?:pass(?:word)?|pwd|secret)(?:["'])?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}\]]+)/i,
    replacement: '$1[REDACTED:password]',
  },
  {
    pattern: /\b(?:4\d{12}(?:\d{3})?|5[1-5]\d{14}|3[47]\d{13}|6(?:011|5\d{2})\d{12})\b/,
    replacement: '[REDACTED:credit-card]',
  },
  {
    pattern: /\b(?:\d{4}[ -]){2,3}\d{1,4}\b/,
    replacement: '[REDACTED:credit-card]',
  },
]

/** Deterministic redaction of credential-shaped text; extra patterns are applied last. */
export function redactText(text: string, extraPatterns?: readonly RegExp[]): string {
  let output = text
  for (const rule of REDACT_RULES) {
    output = output.replace(new RegExp(rule.pattern.source, `${rule.pattern.flags}g`), rule.replacement)
  }
  for (const extra of extraPatterns ?? []) {
    if (!(extra instanceof RegExp)) continue
    const flags = `${extra.flags.replace(/[gy]/g, '')}g`
    output = output.replace(new RegExp(extra.source, flags), '[REDACTED:custom]')
  }
  return output
}

function containsSensitive(content: Uint8Array): boolean {
  const text = Buffer.from(content).toString('utf8')
  return REDACT_RULES.some(rule => rule.pattern.test(text))
}

/**
 * Binary evidence stays in attachment storage; only its digest and reference enter the domain.
 * `byteSize` is taken from the measured content. `redacted` marks a text reference whose
 * content matched a sensitive pattern; the host must redact those bytes before persisting them.
 */
export function createEvidenceRef(input: Omit<EvidenceRef, 'id' | 'createdAtMs' | 'sha256' | 'redacted'> & {
  content: Uint8Array
  nowMs?: number
}): EvidenceRef {
  const explicit = input.nowMs
  const createdAtMs = typeof explicit === 'number' && Number.isFinite(explicit) ? explicit : Date.now()
  return {
    id: randomUUID(),
    kind: input.kind,
    attachmentId: input.attachmentId,
    byteSize: input.content.byteLength,
    sha256: createHash('sha256').update(input.content).digest('hex'),
    createdAtMs,
    runId: input.runId,
    caseId: input.caseId,
    redacted: TEXT_KINDS.includes(input.kind) && containsSensitive(input.content),
  }
}

/** Cross-scope, malformed or absent evidence is reported in `missing`, never treated as collected. */
export function buildEvidenceBundle(
  runId: string,
  caseId: string,
  refs: readonly EvidenceRef[],
  required: readonly EvidenceRef['kind'][],
): EvidenceBundle {
  const valid = refs.filter(ref =>
    ref.runId === runId &&
    ref.caseId === caseId &&
    ref.attachmentId.trim().length > 0 &&
    Number.isInteger(ref.byteSize) && ref.byteSize >= 0 &&
    SHA256_RE.test(ref.sha256) &&
    ALL_KINDS.includes(ref.kind),
  )
  const present = new Set<EvidenceRef['kind']>(valid.map(ref => ref.kind))
  const missing: string[] = []
  for (const kind of required) {
    if (ALL_KINDS.includes(kind) && present.has(kind)) continue
    if (!missing.includes(kind)) missing.push(kind)
  }
  return { runId, caseId, refs: [...valid], missing }
}
