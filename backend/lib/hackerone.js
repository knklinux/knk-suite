'use strict';

// ============================================================================
// KNK SUITE v2.1 — Integración HackerOne (segura y manual)
// HackerOne es una SPA: el scope NO se scrapea automáticamente.
// Este módulo: 1) parsea el texto de scope pegado por el operador,
// 2) construye un borrador de reporte con el formato H1,
// 3) genera el checklist de envío. NO realiza llamadas a la API de H1.
// El envío real se hace manualmente desde la UI con revisión humana.
// ============================================================================

const net = require('./net');

/**
 * Parsea texto de scope pegado desde la pestaña "Scope" de HackerOne.
 * Acepta líneas como: *.example.com, example.com, https://app.example.com, !out.example.com
 * @param {string} text
 * @returns {{ inScope: string[], outOfScope: string[] }}
 */
function parseScopeText(text) {
  const inScope = new Set();
  const outOfScope = new Set();
  for (const raw of String(text || '').split(/[\n,;]+/)) {
    let line = raw.trim().toLowerCase();
    if (!line) continue;
    let excluded = false;
    if (line.startsWith('!')) { excluded = true; line = line.slice(1).trim(); }
    line = line.replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].replace(/\.$/, '');
    if (!line || line.length < 4) continue;
    if (!/^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(line)) continue;
    (excluded ? outOfScope : inScope).add(line);
  }
  return { inScope: [...inScope], outOfScope: [...outOfScope] };
}

/**
 * Construye el cuerpo de un reporte con el formato que espera HackerOne.
 * @param {object} json - reporte generado por report.generateReport()
 * @returns {string} markdown listo para pegar en H1
 */
function buildDraft(json) {
  const steps = Array.isArray(json.pasos) && json.pasos.length
    ? json.pasos.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '(PENDIENTE — pasos de reproducción obligatorios)';
  return [
    `## Summary`,
    ``,
    `**Asset:** ${json.asset || '—'}`,
    `**Tipo:** ${json.tipo || '—'} | **CWE:** ${json.cwe || '—'} | **CVSS:** ${json.cvss || '—'}`,
    ``,
    json.impacto || '(PENDIENTE — resumen del impacto)',
    ``,
    `## Steps To Reproduce`,
    ``,
    steps,
    ``,
    `## Impact`,
    ``,
    json.impacto || '(PENDIENTE — impacto real demostrado)',
    ``,
    `## Supporting Material`,
    ``,
    `- Screenshots: ${json.screenshotsPath || '⚠️ OBLIGATORIO — adjuntar capturas del exploit e impacto'}`,
    `- Request/Response reproducible: ${json.requestResponsePath || '⚠️ OBLIGATORIO — adjuntar curl copiable'}`,
    ``,
    `**User-Agent usado:** \`${json.userAgent || 'no especificado'}\``,
    `**Scope documentado:** ${json.scopeDocumentado || '—'}`,
  ].join('\n');
}

/**
 * Checklist previo al envío según las reglas habituales de HackerOne.
 * @param {object} json
 * @returns {{ ok: boolean, items: Array<{label:string, ok:boolean}> }}
 */
function checklist(json) {
  const items = [
    { label: 'Asset dentro del scope exacto del programa', ok: !!(json.inScope === true || (json.scopeDocumentado && json.asset)) },
    { label: 'No es un duplicado (buscado en el programa)', ok: json.noDuplicate === true },
    { label: 'No es disqualifier (test IDs, self-XSS, etc.)', ok: json.notDisqualifier === true },
    { label: 'Impacto real demostrado (no solo reflejo)', ok: json.exploitable === true },
    { label: 'Screenshots del exploit y del impacto adjuntos', ok: !!json.screenshotsPath && !String(json.screenshotsPath).startsWith('⚠️') },
    { label: 'Request/Response reproducible (curl) adjunto', ok: !!json.requestResponsePath && !String(json.requestResponsePath).startsWith('⚠️') },
    { label: 'PoC reproducido al menos 2 veces', ok: (json.reproducibleCount || 0) >= 2 },
    { label: 'Sin PII real ni secretos (redactado)', ok: json.noPII === true },
  ];
  return { ok: items.every(i => i.ok), items };
}

module.exports = { parseScopeText, buildDraft, checklist };
