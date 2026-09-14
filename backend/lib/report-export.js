'use strict';

// ============================================================================
// report-export.js — informe Markdown/HTML a partir de la sesión
//
// Los hallazgos llegan con la forma de la tabla `findings`
// (`type` / `summary` / `severity` / `details`), no con la forma del informe.
// `normalizeFinding` hace de traductor: convierte cada fila en algo legible
// (título, descripción, activo afectado, evidencia, recomendación) en lugar de
// volcar un JSON crudo — que es lo que salía antes cuando `details` era un
// objeto.
//
// Los hallazgos de cámaras expuestas (`camera-exposed`) llevan además su
// apéndice propio: son metadatos de índices públicos, no explotaciones, y el
// informe debe decirlo tal cual.
// ============================================================================

function asArray(value) {
  if (value == null || value === '') return [];
  return Array.isArray(value) ? value.filter((v) => v != null && v !== '') : [value];
}

function safeJson(text) {
  if (typeof text !== 'string') return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

const DETAIL_SKIP = new Set(['module', 'semantics', 'source', 'sessionTarget', 'links', 'reproduce', 'nextSteps']);

function humanizeValue(value) {
  const list = asArray(value);
  if (!list.length) return '';
  if (list.length === 1 && typeof list[0] !== 'object') return String(list[0]);
  return list.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ');
}

/** Detalle genérico (nuclei, pipeline, osint…): pares clave/valor legibles. */
function describeDetails(details) {
  const rec = details && typeof details === 'object' ? details : {};
  const lines = [];
  for (const [key, value] of Object.entries(rec)) {
    if (DETAIL_SKIP.has(key)) continue;
    const text = humanizeValue(value);
    if (!text) continue;
    lines.push(`- **${key}:** ${text}`);
  }
  return lines.join('\n');
}

function isCameraFinding(f, details) {
  return f.type === 'camera-exposed' || (details && details.module === 'camaras-expuestas');
}

/** Descripción legible de un hallazgo nacido en «Cámaras Expuestas». */
function describeCameraFinding(f, details) {
  const d = details || {};
  const lines = [];
  lines.push(`**Asset:** ${d.asset || f.asset || '—'}  `);
  lines.push(`**Origen:** ${d.source || 'internetdb.shodan.io'} (${d.semantics || 'public-index-metadata'})  `);
  lines.push(`**Confianza:** ${d.score != null ? `${d.score}/100 · ${d.confidence || ''}` : '—'}  `);
  lines.push(`**Estado de verificación:** ${d.verification || 'candidato-no-verificado'}  `);
  lines.push('');
  if (asArray(d.ports).length) lines.push(`- **Puertos observados:** ${asArray(d.ports).join(', ')}`);
  if (asArray(d.cameraPorts).length) lines.push(`- **Puertos de cámara:** ${asArray(d.cameraPorts).join(', ')}`);
  if (asArray(d.cpes).length) lines.push(`- **CPEs:** ${asArray(d.cpes).join(' | ')}`);
  if (asArray(d.tags).length) lines.push(`- **Tags:** ${asArray(d.tags).join(', ')}`);
  if (asArray(d.hostnames).length) lines.push(`- **Hostnames:** ${asArray(d.hostnames).join(', ')}`);
  if (asArray(d.vulns).length) lines.push(`- **CVEs asociados en el índice:** ${asArray(d.vulns).join(', ')}`);
  if (asArray(d.reasons).length) {
    lines.push('');
    lines.push('**Por qué el motor lo marcó:**');
    lines.push(...asArray(d.reasons).map((r) => `- ${r}`));
  }
  if (d.links && typeof d.links === 'object') {
    const links = Object.entries(d.links).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
    if (links.length) { lines.push(''); lines.push(`**Enlaces:** ${links.join(' · ')}`); }
  }
  if (d.scopeNote) { lines.push(''); lines.push(`> ${d.scopeNote}`); }
  return lines.join('\n');
}

function collectEvidence(f, details) {
  const out = [];
  for (const e of asArray(f.evidence)) out.push(String(e));
  for (const e of asArray(details && details.evidence)) out.push(String(e));
  return [...new Set(out)];
}

function collectCommands(details) {
  return asArray(details && details.reproduce).map(String);
}

/**
 * Traduce una fila de `findings` a la forma que espera el informe.
 * Acepta tanto objetos `details` ya parseados (db.getFindings) como strings.
 */
function normalizeFinding(f) {
  const row = f && typeof f === 'object' ? f : {};
  const details = typeof row.details === 'string' ? safeJson(row.details) : (row.details && typeof row.details === 'object' ? row.details : {});
  const camera = isCameraFinding(row, details);
  const severity = String(row.severity || 'info').toLowerCase();

  const description = row.description
    || (camera ? describeCameraFinding(row, details) : describeDetails(details))
    || 'No description provided.';

  return {
    id: row.id,
    type: row.type || (camera ? 'camera-exposed' : 'finding'),
    name: row.name || row.title || row.summary || 'Finding',
    severity,
    affected: row.affected || details.asset || details.ip || details.url || '—',
    url: row.url || details.url || '',
    status: row.status || (camera ? 'candidato-no-verificado' : ''),
    description,
    recommendation: row.recommendation || details.recommendation || '',
    evidence: collectEvidence(row, details),
    commands: collectCommands(details),
    cves: asArray(row.cve || row.cves || details.vulns).map(String),
    score: details.score,
    confidence: details.confidence,
    ports: asArray(details.ports),
    camera,
    createdAt: row.created_at || row.createdAt || '',
  };
}

function normalizeFindings(findings) {
  return (Array.isArray(findings) ? findings : []).map(normalizeFinding);
}

/** Apéndice con la tabla de exposición: activo, puntuación, puertos y CVEs. */
function cameraAppendix(findings) {
  const items = findings.filter((f) => f.camera);
  if (!items.length) return '';
  let md = '## Appendix A — Public-index exposure (cameras)\n\n';
  md += 'These findings come from **public scan indexes** (Shodan InternetDB and similar): they are ';
  md += '**candidates, not confirmed vulnerabilities**. No stream was opened, no credentials were tried ';
  md += 'and the suite never contacted the targets. Verify each asset before reporting.\n\n';
  md += '| Asset | Severity | Score | Camera ports | CVEs in index | Evidence |\n';
  md += '|---|---|---|---|---|---|\n';
  for (const f of items) {
    const evidence = f.evidence.length ? f.evidence.map((e) => `\`${e}\``).join('<br>') : '—';
    md += `| ${f.affected} | ${f.severity} | ${f.score != null ? f.score : '—'} | ${f.ports.length ? f.ports.join(', ') : '—'} | ${f.cves.length ? f.cves.join(', ') : '—'} | ${evidence} |\n`;
  }
  md += '\n';
  const withCves = items.filter((f) => f.cves.length);
  if (withCves.length) {
    md += `**CVE cross-reference (${withCves.length} asset(s) with CVEs in the index):**\n\n`;
    for (const f of withCves) md += `- ${f.affected}: ${f.cves.join(', ')}\n`;
    md += '\n';
  }
  md += '**Reproduce the index data (read-only, no contact with the asset):**\n\n';
  for (const f of items.slice(0, 10)) {
    md += `- ${f.affected}: \`curl -s https://internetdb.shodan.io/${f.affected} | jq .\`\n`;
  }
  if (items.length > 10) md += `- …and ${items.length - 10} more in the evidence files.\n`;
  md += '\n';
  return md;
}

// Alcance de la sesión: array, string JSON ('[]') o lista separada por comas.
// Sin esto, una sesión cruda de la BD ('[]'.length === 2) entraba en la rama
// del array y tumbaba el informe con «forEach is not a function».
function scopeList(session) {
  const raw = session && session.scope;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      try { const parsed = JSON.parse(trimmed); return Array.isArray(parsed) ? parsed.filter(Boolean) : []; } catch { return []; }
    }
    return trimmed.split(',').map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

function generateMarkdown(session, findings, reports) {
  const now = new Date().toISOString().split('T')[0];
  const list = normalizeFindings(findings);
  const bySeverity = (sev) => list.filter((f) => f.severity === sev);
  const critical = bySeverity('critical');
  const high = bySeverity('high');
  const medium = bySeverity('medium');
  const low = bySeverity('low');
  const info = list.filter((f) => !['critical', 'high', 'medium', 'low'].includes(f.severity));
  const cameras = list.filter((f) => f.camera);
  const withEvidence = list.filter((f) => f.evidence.length);

  let md = '';
  md += `# Penetration Test Report\n\n`;
  md += `**Target:** ${session.target}\n`;
  md += `**Date:** ${now}\n`;
  md += `**Tester:** ${session.tester || 'N/A'}\n\n`;
  md += `---\n\n`;

  md += `## Executive Summary\n\n`;
  md += `This report presents the findings of a penetration test conducted against **${session.target}**. `;
  md += `A total of **${list.length}** findings were identified across all severity levels`;
  md += withEvidence.length ? `, **${withEvidence.length}** of them with evidence on disk.\n\n` : `.\n\n`;
  md += `| Severity | Count |\n`;
  md += `|----------|-------|\n`;
  md += `| Critical | ${critical.length} |\n`;
  md += `| High     | ${high.length} |\n`;
  md += `| Medium   | ${medium.length} |\n`;
  md += `| Low      | ${low.length} |\n`;
  md += `| Info     | ${info.length} |\n\n`;

  if (cameras.length) {
    md += `> **${cameras.length} finding(s) come from public scan indexes** (exposed camera candidates). `;
    md += `They are exposure indicators pending verification — see Appendix A before reporting them.\n\n`;
  }

  md += `## Scope\n\n`;
  md += `The following targets and assets were tested:\n\n`;
  const scope = scopeList(session);
  if (scope.length) {
    scope.forEach((s) => { md += `- ${s}\n`; });
  } else {
    md += `- ${session.target}\n`;
  }
  md += `\n`;

  md += `## Methodology\n\n`;
  md += `The assessment followed standard penetration testing methodology:\n\n`;
  md += `1. **Reconnaissance** - Passive and active information gathering\n`;
  md += `2. **Scanning** - Service and vulnerability scanning\n`;
  md += `3. **Exploitation** - Attempted exploitation of discovered vulnerabilities\n`;
  md += `4. **Post-Exploitation** - Impact assessment and privilege escalation\n`;
  md += `5. **Reporting** - Documentation and recommendations\n\n`;

  if (reports && reports.length) {
    md += `## Scan Reports\n\n`;
    reports.forEach(r => {
      md += `### ${r.name || 'Scan'}\n\n`;
      md += `${r.summary || r.output || 'No summary available.'}\n\n`;
    });
  }

  md += `## Findings\n\n`;
  const severitySections = [
    { label: 'Critical', items: critical },
    { label: 'High', items: high },
    { label: 'Medium', items: medium },
    { label: 'Low', items: low },
    { label: 'Informational', items: info }
  ];

  severitySections.forEach(({ label, items }) => {
    if (!items.length) return;
    md += `### ${label} Severity\n\n`;
    items.forEach((f, i) => {
      md += `#### ${i + 1}. ${f.name}\n\n`;
      if (f.id) md += `**ID:** ${f.id}  \n`;
      if (f.type) md += `**Type:** ${f.type}  \n`;
      md += `**Severity:** ${f.severity.toUpperCase()}  \n`;
      if (f.affected && f.affected !== '—') md += `**Affected:** ${f.affected}  \n`;
      if (f.status) md += `**Status:** ${f.status}  \n`;
      if (f.url) md += `**URL:** ${f.url}  \n`;
      if (f.cves.length) md += `**CVEs (index):** ${f.cves.join(', ')}  \n`;
      if (f.createdAt) md += `**Detected:** ${f.createdAt}  \n`;
      md += `\n${f.description}\n\n`;
      if (f.recommendation) {
        md += `**Recommendation:** ${f.recommendation}\n\n`;
      }
      if (f.evidence.length || f.commands.length) {
        md += `<details><summary>Evidence</summary>\n\n`;
        if (f.evidence.length) {
          md += `Evidence files:\n\n\`\`\`\n${f.evidence.join('\n')}\n\`\`\`\n\n`;
        }
        if (f.commands.length) {
          md += `Reproduce:\n\n\`\`\`bash\n${f.commands.join('\n')}\n\`\`\`\n\n`;
        }
        md += `</details>\n\n`;
      }
    });
  });

  md += `## Recommendations\n\n`;
  md += `Based on the findings, the following actions are recommended:\n\n`;
  if (critical.length) md += `- **Immediate:** Address all critical severity findings\n`;
  if (high.length) md += `- **Short-term:** Remediate high severity findings within 30 days\n`;
  if (medium.length) md += `- **Medium-term:** Plan fixes for medium severity findings within 90 days\n`;
  if (low.length || info.length) md += `- **Long-term:** Review low severity and informational findings as part of security best practices\n`;
  if (cameras.length) md += `- **Exposure candidates:** confirm ownership and close the public exposure of the ${cameras.length} camera candidate(s) listed in Appendix A\n`;
  md += `\n`;

  md += cameraAppendix(list);

  md += `## Timeline\n\n`;
  md += `| Phase | Status |\n`;
  md += `|-------|--------|\n`;
  md += `| Reconnaissance | Completed |\n`;
  md += `| Scanning | Completed |\n`;
  md += `| Exploitation | Completed |\n`;
  md += `| Reporting | Completed |\n\n`;

  md += `---\n\n`;
  md += `*Report generated on ${now} by knk-suite*\n`;
  return md;
}

// Escapa el texto que va dentro de <pre>, <code> y celdas.
function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Orden de los reemplazos: primero lo más específico (#### antes de ##, tablas
// antes de los párrafos) y los párrafos AL FINAL. Al revés, cada título
// precedido de una línea en blanco quedaba dentro de un <p> y el informe HTML
// salía sin encabezados ni tablas.
function toHTML(md) {
  let html = md;

  html = html.replace(/^```(\w*)\n([\s\S]*?)```/gm, (_, lang, code) => {
    return `<pre><code class="language-${lang}">${escapeHtml(code)}</code></pre>`;
  });

  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

  html = html.replace(new RegExp('\\*\\*(.+?)\\*\\*', 'g'), '<strong>$1</strong>');
  html = html.replace(new RegExp('\\*(.+?)\\*', 'g'), '<em>$1</em>');

  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');

  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  html = html.replace(/^\|(.+)\|\n\|[-| ]+\|\n((?:\|.+\|\n?)+)/gm, (_, header, rows) => {
    const ths = header.split('|').map(h => `<th>${h.trim()}</th>`).join('');
    const bodyRows = rows.trim().split('\n').map(row => {
      const tds = row.split('|').map(d => `<td>${d.trim()}</td>`).join('');
      return `<tr>${tds}</tr>`;
    }).join('');
    return `<table><thead><tr>${ths}</tr></thead><tbody>${bodyRows}</tbody></table>`;
  });

  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  html = html.replace(/<details><summary>(.+?)<\/summary>([\s\S]*?)<\/details>/g, '<details><summary>$1</summary>$2</details>');

  html = html.replace(/\n\n+/g, '</p><p>');
  return `<p>${html}</p>`;
}

function generateHTML(session, findings, reports) {
  const md = generateMarkdown(session, findings, reports);
  const body = toHTML(md);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pentest Report - ${session.target}</title>
<style>
  @media print {
    body { font-size: 11pt; }
    .no-print { display: none; }
    pre { page-break-inside: avoid; }
    h2, h3, h4 { page-break-after: avoid; }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Courier New', monospace;
    background: #0a0a0f;
    color: #e0e0e0;
    line-height: 1.6;
    padding: 40px;
    max-width: 900px;
    margin: 0 auto;
  }
  h1 {
    color: #00ff88;
    font-size: 2em;
    border-bottom: 2px solid #00ff88;
    padding-bottom: 10px;
    margin-bottom: 20px;
    text-shadow: 0 0 10px rgba(0, 255, 136, 0.3);
  }
  h2 {
    color: #00ccff;
    font-size: 1.5em;
    margin-top: 30px;
    margin-bottom: 15px;
    border-left: 4px solid #00ccff;
    padding-left: 12px;
  }
  h3 {
    color: #ff6600;
    font-size: 1.2em;
    margin-top: 20px;
    margin-bottom: 10px;
  }
  h4 {
    color: #ff3366;
    font-size: 1.1em;
    margin-top: 15px;
    margin-bottom: 8px;
  }
  p { margin-bottom: 12px; }
  strong { color: #ffffff; }
  a { color: #00ff88; text-decoration: none; }
  a:hover { text-decoration: underline; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 15px 0;
    background: #111118;
  }
  th {
    background: #1a1a2e;
    color: #00ccff;
    padding: 10px 15px;
    text-align: left;
    border: 1px solid #333;
  }
  td {
    padding: 8px 15px;
    border: 1px solid #333;
  }
  tr:nth-child(even) { background: #0d0d14; }
  pre {
    background: #111118;
    border: 1px solid #333;
    border-left: 4px solid #ff3366;
    padding: 15px;
    overflow-x: auto;
    margin: 10px 0;
    font-size: 0.9em;
  }
  code {
    font-family: 'Courier New', monospace;
    color: #ff6600;
  }
  li {
    margin-left: 20px;
    margin-bottom: 5px;
  }
  blockquote {
    margin: 10px 0;
    padding: 8px 12px;
    border-left: 3px solid #ff6600;
    background: #0d0d14;
    color: #ffb37a;
  }
  details {
    margin: 10px 0;
    padding: 10px;
    background: #0d0d14;
    border: 1px solid #333;
    border-radius: 4px;
  }
  summary {
    cursor: pointer;
    color: #00ccff;
    font-weight: bold;
  }
  hr {
    border: none;
    border-top: 1px solid #333;
    margin: 30px 0;
  }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

module.exports = { generateMarkdown, generateHTML, toHTML, normalizeFinding, normalizeFindings, cameraAppendix, describeCameraFinding };
