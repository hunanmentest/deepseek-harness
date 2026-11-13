/** Risk classes and verdicts for the upstream browser tool surface (ADR-004). @module */

import { URL } from 'node:url'

export type RiskClass = 'read' | 'navigate' | 'mutate' | 'destructive' | 'code-execution'

export interface RiskVerdict {
  readonly tool: string
  readonly risk: RiskClass
  readonly highRisk: boolean
  readonly reasons: readonly string[]
}

/** @playwright/mcp@0.0.80 measured tool list plus same-capability aliases; absent names fail closed. */
export const UPSTREAM_TOOL_RISKS: Readonly<Record<string, RiskClass>> = {
  browser_snapshot: 'read',
  browser_take_screenshot: 'read',
  browser_console_messages: 'read',
  browser_network_requests: 'read',
  browser_network_request: 'read',
  browser_wait_for: 'read',
  browser_find: 'read',
  browser_generate_locator: 'read',
  browser_navigate: 'navigate',
  browser_navigate_back: 'navigate',
  browser_tabs: 'navigate',
  browser_click: 'mutate',
  browser_type: 'mutate',
  browser_fill_form: 'mutate',
  browser_press_key: 'mutate',
  browser_hover: 'mutate',
  browser_drag: 'mutate',
  browser_select_option: 'mutate',
  browser_handle_dialog: 'mutate',
  browser_file_upload: 'mutate',
  browser_drop: 'mutate',
  browser_resize: 'mutate',
  browser_pdf_save: 'mutate',
  browser_close: 'destructive',
  browser_install: 'destructive',
  browser_evaluate: 'code-execution',
  browser_run_code: 'code-execution',
  browser_run_code_unsafe: 'code-execution',
}

const HIGH_RISK_CLASSES: readonly RiskClass[] = ['destructive', 'code-execution']
const CODE_ARGUMENT_KEYS: readonly string[] = ['code', 'script', 'function']
const URL_ARGUMENT_KEYS: readonly string[] = ['url', 'target']
const SCRIPT_PROTOCOLS: readonly string[] = ['javascript:', 'data:', 'vbscript:']

type UrlShape = 'none' | 'cross-origin' | 'script-url'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasAnyKey(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some(key => Object.prototype.hasOwnProperty.call(record, key))
}

/** Only the shape of a URL is inspected; argument text is never echoed into a verdict. */
function inspectUrls(record: Record<string, unknown>): UrlShape {
  let shape: UrlShape = 'none'
  for (const key of URL_ARGUMENT_KEYS) {
    const raw = record[key]
    if (typeof raw !== 'string') continue
    let parsed: URL
    try {
      parsed = new URL(raw)
    } catch {
      continue
    }
    if (SCRIPT_PROTOCOLS.includes(parsed.protocol)) return 'script-url'
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0) {
      shape = 'cross-origin'
    }
  }
  return shape
}

/** High risk derives from the class, never from a caller-controlled flag alone. */
export function isHighRisk(verdict: RiskVerdict): boolean {
  return verdict.highRisk || HIGH_RISK_CLASSES.includes(verdict.risk)
}

/** Classify one browser call; reasons are stable codes that never contain argument text. */
export function classifyToolCall(tool: unknown, args: unknown): RiskVerdict {
  if (typeof tool !== 'string' || tool.trim().length === 0) {
    return { tool: '<invalid-tool>', risk: 'destructive', highRisk: true, reasons: ['invalid-tool'] }
  }
  const known = UPSTREAM_TOOL_RISKS[tool]
  if (known === undefined) {
    return { tool, risk: 'destructive', highRisk: true, reasons: ['unknown-tool'] }
  }
  const record = isRecord(args) ? args : {}
  const reasons: string[] = []
  if (!isRecord(args)) reasons.push('invalid-args')
  let risk: RiskClass = known
  if (hasAnyKey(record, CODE_ARGUMENT_KEYS)) {
    risk = 'code-execution'
    reasons.push('code-argument')
  }
  const shape = inspectUrls(record)
  if (shape === 'script-url') {
    risk = 'code-execution'
    reasons.push('script-url-argument')
  } else if (shape === 'cross-origin') {
    reasons.push('cross-origin-argument')
  }
  return {
    tool,
    risk,
    highRisk: HIGH_RISK_CLASSES.includes(risk) || shape === 'cross-origin',
    reasons: [...new Set(reasons)],
  }
}
