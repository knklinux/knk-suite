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

module.exports = { generateReport, writeReport, slugify };