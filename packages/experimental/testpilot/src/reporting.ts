/** JSON, JUnit, HTML and Markdown reports; all dynamic text is escaped. @module */

import type { EvidenceLink, QualityGate, ReportFormat, TestProject, TestRun } from './types.ts'

export interface ReportInput {
  readonly run: TestRun
  readonly project: TestProject | null
  readonly gate: QualityGate | null
  readonly evidence: readonly EvidenceLink[]
  readonly generatedAtMs: number
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function iso(atMs: number): string {
  return new Date(atMs).toISOString()
}

/** ToolResponse-shaped JSON: one canonical value, stable error slot. */
function jsonReport(input: ReportInput): string {
  return JSON.stringify({
    ok: true,
    data: {
      run: input.run,
      project: input.project,
      gate: input.gate,
      evidence: input.evidence,
      generatedAt: iso(input.generatedAtMs),
      evidenceMissing: input.evidence.length === 0,
    },
    error: null,
  }, null, 2)
}

function junitReport(input: ReportInput): string {
  const { run } = input
  const failures = run.results.filter(result => result.status === 'failed').length
  const cases = run.results.map((result) => {
    const failure = result.status === 'failed'
      ? `<failure message="${escapeXml(result.error ?? 'case failed')}">${escapeXml(result.failureClass ?? 'unclassified')}</failure>`
      : ''
    const skipped = result.status === 'skipped' ? '<skipped/>' : ''
    return `<testcase name="${escapeXml(result.caseId)}" classname="${escapeXml(run.planId)}" time="${((result.durationMs ?? 0) / 1000).toFixed(3)}">${failure}${skipped}</testcase>`
  }).join('\n    ')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="TestPilot" tests="${run.results.length}" failures="${failures}" time="${((run.finishedAtMs ?? run.updatedAtMs) - run.createdAtMs) / 1000}">\n  <testsuite name="${escapeXml(run.planId)}" tests="${run.results.length}" failures="${failures}">\n    ${cases}\n  </testsuite>\n</testsuites>\n`
}

function htmlReport(input: ReportInput): string {
  const { run, gate } = input
  const verdict = gate?.verdict ?? 'not-evaluated'
  const rows = run.results.map(result => `<tr><td>${escapeHtml(result.caseId)}</td><td>${escapeHtml(result.status)}</td><td>${result.durationMs ?? '—'}</td><td>${escapeHtml(result.failureClass ?? '—')}</td><td>${result.evidenceIds.length}</td></tr>`).join('')
  const reasons = (gate?.reasons ?? ['No gate evaluation is stored for this run.'])
    .map(reason => `<li>${escapeHtml(reason)}</li>`).join('')
  const evidence = input.evidence.length === 0
    ? '<li>Evidence collection did not succeed; this report does not claim otherwise.</li>'
    : input.evidence.map(item => `<li>${escapeHtml(item.kind)} — ${escapeHtml(item.attachmentId)} (${item.byteSize} bytes)</li>`).join('')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TestPilot run ${escapeHtml(run.id)}</title>
<style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f5f6f8;color:#1c2330;font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:1080px;margin:0 auto;padding:32px 24px 72px}header{border-bottom:1px solid #d8dde6;padding-bottom:20px;margin-bottom:28px}
h1{font-size:28px;line-height:1.2;margin:0 0 8px}h2{font-size:18px;margin:32px 0 12px}.meta{color:#5b6577;font-size:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:20px 0}
.card{background:#fff;border:1px solid #dfe3ea;border-radius:10px;padding:16px}.card b{display:block;font-size:24px;line-height:1.3}
.badge{display:inline-block;padding:4px 12px;border-radius:999px;font-weight:600;font-size:13px}
.pass{background:#e6f4ea;color:#137333}.warn{background:#fef3d7;color:#8a5a00}.fail{background:#fde8e8;color:#a4262c}.idle{background:#eceff4;color:#495266}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dfe3ea;border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:10px 14px;border-bottom:1px solid #edf0f4;font-size:14px}th{background:#f0f2f6;font-weight:600}
ul{margin:8px 0;padding-left:22px}footer{margin-top:40px;color:#6b7484;font-size:13px}
</style></head><body><div class="wrap">
<header><h1>TestPilot run report</h1><div class="meta">Run ${escapeHtml(run.id)} · project ${escapeHtml(run.projectId)} · plan ${escapeHtml(run.planId)} · generated ${escapeHtml(iso(input.generatedAtMs))}</div></header>
<div class="grid">
<div class="card">Status<b>${escapeHtml(run.status)}</b></div>
<div class="card">Gate <span class="badge ${escapeHtml(verdict === 'pass' ? 'pass' : verdict === 'warn' ? 'warn' : verdict === 'fail' ? 'fail' : 'idle')}">${escapeHtml(verdict)}</span></div>
<div class="card">Cases<b>${run.results.length}</b></div>
<div class="card">Evidence<b>${input.evidence.length}</b></div>
</div>
<h2>Gate reasons</h2><ul>${reasons}</ul>
<h2>Case results</h2><table><thead><tr><th>Case</th><th>Status</th><th>Duration (ms)</th><th>Failure class</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Evidence</h2><ul>${evidence}</ul>
<footer>Configuration digest ${escapeHtml(run.configDigest)} · policy ${escapeHtml(run.policyVersion)} · commit ${escapeHtml(run.commitSha ?? 'none')}</footer>
</div></body></html>\n`
}

function markdownReport(input: ReportInput): string {
  const { run, gate } = input
  const rows = run.results.map(result => `| ${result.caseId} | ${result.status} | ${result.durationMs ?? '—'} | ${result.failureClass ?? '—'} | ${result.evidenceIds.length} |`).join('\n')
  const reasons = (gate?.reasons ?? ['No gate evaluation is stored for this run.']).map(reason => `- ${reason}`).join('\n')
  return `# TestPilot run ${run.id}\n\nStatus: ${run.status} · Gate: ${gate?.verdict ?? 'not-evaluated'} · Generated: ${iso(input.generatedAtMs)}\n\nProject: ${run.projectId} · Plan: ${run.planId} · Commit: ${run.commitSha ?? 'none'}\n\n## Gate reasons\n\n${reasons}\n\n## Case results\n\n| Case | Status | Duration (ms) | Failure class | Evidence |\n| --- | --- | --- | --- | --- |\n${rows}\n\n## Evidence\n\n${input.evidence.length === 0 ? 'Evidence collection did not succeed; this report does not claim otherwise.' : input.evidence.map(item => `- ${item.kind}: ${item.attachmentId} (${item.byteSize} bytes)`).join('\n')}\n`
}

/** Render one report format. Unknown formats are rejected rather than silently downgraded. */
export function renderReport(format: ReportFormat, input: ReportInput): string {
  switch (format) {
    case 'json': return jsonReport(input)
    case 'junit': return junitReport(input)
    case 'html': return htmlReport(input)
    case 'markdown': return markdownReport(input)
  }
}

export function renderAllReports(input: ReportInput): Readonly<Record<ReportFormat, string>> {
  return {
    json: renderReport('json', input),
    junit: renderReport('junit', input),
    html: renderReport('html', input),
    markdown: renderReport('markdown', input),
  }
}
