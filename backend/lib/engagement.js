'use strict';

// ============================================================================
// KNK SUITE v2.1 — Informe de engagement profesional (deliverable de pentest)
// Combina findings, assets, scope y metodología en un documento ejecutable
// (resumen ejecutivo → hallazgos → remediación → anexos).
// ============================================================================

const { slugify } = require('./report');

const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function generateEngagementReport(data = {}) {
  const findings = (data.findings || []).map(f => ({ severity: 'info', status: 'open', ...f }));
  const sorted = [...findings].sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));

  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of sorted) counts[f.severity] = (counts[f.severity] || 0) + 1;

  const json = {
    id: `ENG-${Date.now().toString(36).toUpperCase()}`,
    title: data.title || `Informe de engagement — ${data.target || 'sin target'}`,
    target: data.target || '',
    program: data.program || '',
    scope: data.scope || [],
    period: data.period || { start: new Date().toISOString(), end: new Date().toISOString() },
    methodology: data.methodology || ['Reconocimiento pasivo', 'Análisis de superficie', 'Pruebas de lógica de negocio', 'Validación manual con compuertas'],
    executiveSummary: data.executiveSummary || 'Resumen ejecutivo pendiente de redactar.',
    assets: (data.assets || []).map(a => ({ status: 'in-scope', ...a })),
    findings: sorted,
    counts,
    remediation: data.remediation || {},
    appendix: {
      tools: data.tools || ['knk-suite', 'nmap', 'httpx', 'nuclei', 'ffuf', 'katana', 'sqlmap'],
      evidenceDir: data.evidenceDir || '',
    },
    generatedAt: new Date().toISOString(),
    estado: 'borrador',
  };

  const lines = [
    `# ${json.title}`,
    '',
    `**Cliente/Programa:** ${json.program || '—'} | **Target:** ${json.target} | **Periodo:** ${json.period.start.slice(0, 10)} → ${json.period.end.slice(0, 10)}`,
    '',
    '## 1. Resumen ejecutivo',
    json.executiveSummary,
    '',
    '## 2. Resumen de hallazgos',
    '',
    '| Severidad | Cantidad |',
    '|---|---|',
    ...Object.entries(counts).map(([sev, n]) => `| ${sev} | ${n} |`),
    '',
    '## 3. Alcance',
    ...(json.scope.length ? json.scope.map(s => `- ${s}`) : ['- (sin definir)']),
    '',
    '## 4. Activos evaluados',
    ...(json.assets.length ? json.assets.map(a => `- [${a.status}] ${a.hostname || a.url || a.name}${a.notes ? ' — ' + a.notes : ''}`) : ['- (ninguno)']),
    '',
    '## 5. Hallazgos detallados',
    '',
  ];
  for (const f of sorted) {
    lines.push(`### [${f.severity.toUpperCase()}] ${f.summary || f.title || 'Hallazgo'}`, '');
    if (f.details) lines.push(`- **Detalle:** ${JSON.stringify(f.details).slice(0, 300)}`);
    if (f.remediation) lines.push(`- **Remediación:** ${f.remediation}`);
    lines.push('');
  }
  lines.push(
    '## 6. Metodología aplicada',
    ...json.methodology.map((m, i) => `${i + 1}. ${m}`),
    '',
    '## 7. Anexos',
    `- Herramientas: ${json.appendix.tools.join(', ')}`,
    `- Evidencias: ${json.appendix.evidenceDir || '—'}`,
    '',
    `*Generado por knk-suite v2.1 | ${json.generatedAt}*`,
  );

  return { json, markdown: lines.join('\n'), fileBase: slugify(json.title) };
}

module.exports = { generateEngagementReport };
