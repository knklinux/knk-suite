'use strict';

// ============================================================================
// KNK SUITE v2 — Generador de reportes (evidencia estricta)
// ============================================================================

const { reportReadiness, verdictToText } = require('./gates');

function slugify(s) {
  return String(s || 'sin-titulo').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function generateReport(meta) {
  const v = reportReadiness(meta);
  if (!v.sendable) return { allowed: false, report: null, json: null, blockers: verdictToText(v) };

  const json = {
    id: `KNK-${Date.now().toString(36).toUpperCase()}`,
    titulo: meta.title || 'Sin título',
    programa: meta.program || '—',
    asset: meta.asset || '—',
    tipo: meta.bugType || '—',
    cwe: meta.cwe || '—',
    cvss: meta.cvss || '—',
    severidad: meta.severidad || '—',
    impacto: meta.impact || '—',
    remediacion: meta.remediation || '—',
    pasos: meta.steps || [],
    evidencia: meta.evidence || [],
    reproducible: meta.reproducibleCount || 0,
    fecha: new Date().toISOString(),
    estado: 'borrador',
    userAgent: meta.userAgent || '',
    programaUrl: meta.programUrl || '',
    scopeDocumentado: meta.scopeDocumentado || '',
    screenshotsPath: meta.screenshotsPath || '',
    requestResponsePath: meta.requestResponsePath || '',
  };

  const lines = [
    `# Reporte de bug bounty — ${json.titulo}`,
    '',
    '## Datos del hallazgo',
    `- **Programa:** ${json.programa}`,
    `- **URL del programa:** ${json.programaUrl || '—'}`,
    `- **Asset/endpoint:** ${json.asset}`,
    `- **Tipo de bug:** ${json.tipo}`,
    `- **CWE:** ${json.cwe}`,
    `- **Severidad/CVSS:** ${json.severidad} (${json.cvss})`,
    '',
    '## Scope documentado',
    json.scopeDocumentado || '—',
    '',
    '## User-Agent utilizado',
    `\`${json.userAgent || 'no especificado'}\``,
    '',
    '## Resumen',
    json.impacto,
    '',
    '## Pasos de reproducción',
    ...(json.pasos.length ? json.pasos : ['(PENDIENTE — obligatorio)']).map((s, i) => `${i + 1}. ${s}`),
    '',
    '## Impacto',
    json.impacto,
    '',
    '## Evidencia adjunta (OBLIGATORIO)',
    ...(json.evidencia.length ? json.evidencia : ['❌ SIN EVIDENCIA — el reporte será rechazado']).map(e => `- [ ] ${e}`),
    '',
    '## Screenshots',
    `Ruta: ${json.screenshotsPath || '❌ NO ADJUNTOS — Obligatorio: screenshot del exploit, screenshot del impacto, screenshot de la respuesta'}`,
    '',
    '## Request/Response reproducible',
    `Ruta: ${json.requestResponsePath || '❌ NO ADJUNTO — Obligatorio: curl o raw HTTP que el triager pueda copiar y pegar'}`,
    '',
    '## Remediation',
    json.remediacion || '—',
    '',
    '---',
    `*Generado por knk-suite v2 | Reproducido: ${json.reproducible}x | ${json.fecha}*`,
    '',
    '> ⚠️  CHECKLIST antes de enviar:',
    '> - [ ] Screenshot del exploit ejecutándose',
    '> - [ ] Screenshot del impacto (datos expuestos, callback, etc.)',
    '> - [ ] Request/Response HTTP reproducible (curl copiable)',
    '> - [ ] PoC reproducido al menos 2 veces',
    '> - [ ] Dentro del scope documentado del programa',
    '> - [ ] Sin PII real (solo cuentas de prueba propias)',
  ];

  return { allowed: true, report: lines.join('\n'), json, blockers: null };
}

function writeReport(workspaceDir, json) {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(workspaceDir, 'reportes');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slugify(json.titulo)}.json`);
  fs.writeFileSync(file, JSON.stringify(json, null, 2), 'utf8');
  return file;
}

/**
 * Exporta el reporte a HTML autocontenido (imprimible a PDF desde el navegador).
 */
function writeReportHtml(workspaceDir, json) {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(workspaceDir, 'reportes');
  fs.mkdirSync(dir, { recursive: true });
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const steps = (Array.isArray(json.pasos) && json.pasos.length ? json.pasos : []).map(s => `<li>${esc(s)}</li>`).join('') || '<li>(PENDIENTE — pasos obligatorios)</li>';
  const ev = (Array.isArray(json.evidencia) && json.evidencia.length ? json.evidencia : []).map(e => `<li>${esc(e)}</li>`).join('') || '<li>❌ SIN EVIDENCIA</li>';
  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>${esc(json.titulo)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;color:#111}h1{font-size:1.6rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.4rem .6rem;text-align:left}th{background:#f4f4f4}</style>
</head><body>
<h1>${esc(json.titulo)}</h1>
<table>
<tr><th>Programa</th><td>${esc(json.programa)}</td></tr>
<tr><th>Asset</th><td>${esc(json.asset)}</td></tr>
<tr><th>Tipo / CWE / CVSS</th><td>${esc(json.tipo)} / ${esc(json.cwe)} / ${esc(json.cvss)}</td></tr>
<tr><th>Severidad</th><td>${esc(json.severidad)}</td></tr>
<tr><th>Scope documentado</th><td>${esc(json.scopeDocumentado)}</td></tr>
<tr><th>User-Agent</th><td><code>${esc(json.userAgent)}</code></td></tr>
</table>
<h2>Resumen / Impacto</h2><p>${esc(json.impacto)}</p>
<h2>Pasos de reproducción</h2><ol>${steps}</ol>
<h2>Evidencia</h2><ul>${ev}</ul>
<h2>Material de apoyo</h2>
<p>Screenshots: ${esc(json.screenshotsPath || '❌')}</p>
<p>Request/Response: ${esc(json.requestResponsePath || '❌')}</p>
<h2>Remediación</h2><p>${esc(json.remediacion)}</p>
<hr><p><em>Generado por knk-suite v2.1 | Reproducido ${json.reproducible || 0}x | ${json.fecha}</em></p>
</body></html>`;
  const file = path.join(dir, `${slugify(json.titulo)}.html`);
  fs.writeFileSync(file, html, 'utf8');
  return file;
}

/**
 * Diff simple entre dos versiones de un reporte (campos añadidos/cambiados/eliminados).
 */
function diffReports(before, after) {
  const a = before || {};
  const b = after || {};
  const changed = [];
  const added = [];
  const removed = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const av = JSON.stringify(a[key]);
    const bv = JSON.stringify(b[key]);
    if (a[key] === undefined && b[key] !== undefined) added.push(key);
    else if (a[key] !== undefined && b[key] === undefined) removed.push(key);
    else if (av !== bv) changed.push(key);
  }
  return { changed, added, removed, summary: `${changed.length} cambiados, ${added.length} añadidos, ${removed.length} eliminados` };
}

module.exports = { generateReport, writeReport, writeReportHtml, diffReports, slugify };