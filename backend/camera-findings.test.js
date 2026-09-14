'use strict';

// ============================================================================
// camera-findings.test.js — tests sin red
//
// Cubre el camino «objetivo analizado → hallazgo de la misión con evidencia» y
// el render del informe: saneado y re-puntuación en el servidor, severidad,
// deduplicación, escritura de la evidencia (en un directorio temporal) y
// apéndice de exposición del Markdown.
// ============================================================================

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const exposed = require('./lib/exposed-cameras');
const findings = require('./lib/camera-findings');
const reportExport = require('./lib/report-export');

const HIKVISION_HOST = {
  ip: '203.0.113.10',
  ports: [554, 80, 8000],
  hostnames: ['cam.portal-ayto.example'],
  cpes: ['cpe:/h:hikvision:ds-2cd2142fwd-i'],
  tags: ['webcam'],
  vulns: ['CVE-2021-36260', 'CVE-2017-7921'],
};

// ── saneado: el cliente no puede inflar la puntuación ───────────────
const clean = findings.sanitizeTarget({
  ...HIKVISION_HOST,
  score: 9999,
  isLikelyCamera: false,
  reasons: ['comprado'],
  ports: [554, 80, 0, 'x', 70000],
  vulns: ['CVE-2021-36260', 'no-es-un-cve', 'cve-2017-7921'],
  hostnames: ['cam.portal-ayto.example', ''],
  links: { shodan: 'https://evil.example/x' },
});

assert.ok(clean.target, 'un objetivo válido se sanea');
assert.strictEqual(clean.target.ip, '203.0.113.10');
assert.deepStrictEqual(clean.target.ports, [80, 554], 'puertos fuera de rango o no numéricos fuera');
assert.deepStrictEqual(clean.target.vulns, ['CVE-2021-36260', 'CVE-2017-7921'], 'solo CVEs con formato válido, deduplicados');
assert.strictEqual(clean.target.score, exposed.scoreCamera({
  ports: clean.target.ports,
  hostnames: clean.target.hostnames,
  cpes: clean.target.cpes,
  tags: clean.target.tags,
  vulns: clean.target.vulns,
}).score, 'la puntuación se recalcula con el motor, no se copia del cliente');
assert.ok(clean.target.score < 9999 && clean.target.score >= 40);
assert.strictEqual(clean.target.isLikelyCamera, true);
assert.ok(!clean.target.reasons.includes('comprado'), 'los motivos también se recalculan');
assert.strictEqual(clean.target.shodan, 'https://www.shodan.io/host/203.0.113.10', 'los enlaces se reconstruyen');

const privateIp = findings.sanitizeTarget({ ...HIKVISION_HOST, ip: '192.168.1.10' });
assert.ok(privateIp.error && /privada/.test(privateIp.error), 'una red privada no se registra');
const bogus = findings.sanitizeTarget({ ...HIKVISION_HOST, ip: 'no-es-ip' });
assert.ok(bogus.error && /IPv4/.test(bogus.error));

// ── severidad razonada ─────────────────────────────────────────────
assert.strictEqual(findings.severityFor(clean.target), 'high', 'CVEs + parece cámara → alto');
assert.strictEqual(findings.severityFor({ vulns: ['CVE-1'], isLikelyCamera: false, score: 10 }), 'medium', 'CVEs sin cámara → medio');
assert.strictEqual(findings.severityFor({ vulns: [], isLikelyCamera: true, score: 45 }), 'medium');
assert.strictEqual(findings.severityFor({ vulns: [], isLikelyCamera: false, score: 25 }), 'low');
assert.strictEqual(findings.severityFor({ vulns: [], isLikelyCamera: false, score: 0 }), 'info');

assert.strictEqual(findings.brandLabel(['cpe:/h:hikvision:x']), 'Hikvision');
assert.strictEqual(findings.brandLabel(['cpe:/a:nginx:nginx']), null);

// ── plan: duplicados, filtros y umbral de severidad ────────────────
const weak = { ip: '203.0.113.20', ports: [80], hostnames: [], cpes: [], tags: [], vulns: [] };
const fakeCamera = { ip: '203.0.113.30', ports: [554], hostnames: [], cpes: [], tags: [], vulns: [] };
const other = { ip: '203.0.113.40', ports: [554, 37777], hostnames: [], cpes: ['cpe:/h:dahua:x'], tags: [], vulns: [] };

const existing = [{ id: 42, type: 'camera-exposed', summary: 'ya estaba', severity: 'high', details: { asset: '203.0.113.30' } }];

const plan = findings.planConversion([HIKVISION_HOST, fakeCamera, weak, other, { ip: '10.0.0.9' }], existing, {});
assert.deepStrictEqual(plan.duplicates.map((d) => d.ip), ['203.0.113.30'], 'un objetivo ya registrado no se duplica');
assert.ok(plan.duplicates[0].findingId === 42);
assert.ok(plan.invalid.some((d) => d.ip === '10.0.0.9'), 'la red privada se reporta como descarte');
assert.deepStrictEqual(plan.accepted.map((t) => t.ip), ['203.0.113.10', '203.0.113.40'], 'los «dudosos» (nivel info) quedan fuera por defecto');
assert.ok(plan.filtered.some((d) => d.ip === '203.0.113.20' && /puntuaci/.test(d.reason)), 'por debajo del mínimo por defecto queda fuera y con motivo');

const infoOff = findings.planConversion([weak], [], { minScore: 0 });
assert.strictEqual(infoOff.accepted.length, 0, 'el nivel info no se registra salvo que se pida');
assert.ok(/nivel info/.test(infoOff.filtered[0].reason));

const withInfo = findings.planConversion([weak], [], { includeInfo: true, minScore: 0 });
assert.strictEqual(withInfo.accepted.length, 1);
assert.strictEqual(withInfo.accepted[0].severity, 'info');

const withFloor = findings.planConversion([weak], [], { includeInfo: true, minScore: 0, severityFloor: 'medium' });
assert.strictEqual(withFloor.accepted[0].severity, 'medium', 'el umbral de severidad eleva el mínimo pedido');

const byScore = findings.planConversion([fakeCamera], [], { minScore: 55 });
assert.strictEqual(byScore.accepted.length, 0);
assert.ok(/puntuación/.test(byScore.filtered[0].reason));

const onlyVulns = findings.planConversion([HIKVISION_HOST, other], [], { onlyVulns: true });
assert.deepStrictEqual(onlyVulns.accepted.map((t) => t.ip), ['203.0.113.10']);

const capped = findings.planConversion([HIKVISION_HOST, other, fakeCamera, weak], [], { limit: 2, includeInfo: true });
assert.strictEqual(capped.accepted.length, 2);
assert.strictEqual(capped.skipped.length, 2, 'lo que no entra en la tanda se explica, no se pierde en silencio');

assert.deepStrictEqual(findings.planConversion([HIKVISION_HOST, HIKVISION_HOST], [], {}).skipped.map((s) => s.reason), ['repetido en la misma tanda']);

// ── conversión + evidencia (store en memoria) ──────────────────────
const added = [];
const evidenceRows = [];
// Hallazgo previo de OTRO activo: así ningún objetivo de la tanda es duplicado.
const existingForStore = [{ id: 42, type: 'camera-exposed', summary: 'otro activo', severity: 'high', details: { asset: '198.51.100.7' } }];
const store = {
  listFindings: () => existingForStore,
  addFinding: (row) => { added.push(row); return { lastInsertRowid: 100 + added.length }; },
  addEvidence: (row) => { evidenceRows.push(row); return evidenceRows.length; },
};

const tmpDir = path.join(os.tmpdir(), 'knk-cam-findings-test-' + Date.now());
const result = findings.convertAndStore({
  targets: [HIKVISION_HOST, fakeCamera, weak],
  sessionId: 1,
  store,
  opts: { evidenceDir: tmpDir, sessionTarget: 'portal-ayto.example' },
});

assert.strictEqual(result.ok, true);
assert.strictEqual(result.summary.created, 2, 'se registran solo los que tienen señal');
assert.strictEqual(result.summary.duplicates, 0, 'ningún objetivo de la tanda estaba ya registrado');
assert.strictEqual(result.summary.withVulns, 1);
assert.deepStrictEqual(result.summary.bySeverity, { high: 1, medium: 1 });
assert.strictEqual(added.length, 2);
assert.ok(added.every((f) => f.type === 'camera-exposed'));
assert.deepStrictEqual(added.map((f) => f.details.asset), ['203.0.113.10', '203.0.113.30']);
assert.strictEqual(added[0].details.verification, 'candidato-no-verificado');
assert.deepStrictEqual(added[0].details.vulns, ['CVE-2021-36260', 'CVE-2017-7921']);
assert.ok(added[0].details.recommendation.length > 40, 'el hallazgo trae recomendación, no solo metadatos');
assert.ok(added[0].summary.includes('203.0.113.10') && added[0].summary.includes('2 CVE'));

// evidencia: fichero real en disco + fila en la tabla `evidence`
assert.strictEqual(evidenceRows.length, 2, 'cada hallazgo registra su evidencia');
for (const row of evidenceRows) {
  assert.strictEqual(row.type, 'text');
  assert.ok(fs.existsSync(row.filePath), 'la evidencia se escribe en disco');
  assert.ok(row.filePath.startsWith(tmpDir), 'y queda dentro del directorio de evidencias');
}
const evidenceText = fs.readFileSync(added[0].details.evidence[0], 'utf8');
assert.ok(evidenceText.includes('CVE-2021-36260'), 'la evidencia cita los CVEs');
assert.ok(evidenceText.includes('https://internetdb.shodan.io/203.0.113.10'), 'y el comando para reproducir');
assert.ok(/no ha contactado/.test(evidenceText), 'deja claro que no se tocó el objetivo');
assert.ok(!/192\.168\./.test(evidenceText));
assert.deepStrictEqual(result.created[0].evidence, added[0].details.evidence[0]);
fs.rmSync(tmpDir, { recursive: true, force: true });
assert.ok(!fs.existsSync(tmpDir), 'el temporal de test se limpia');

// sin store no se inventa nada
assert.strictEqual(findings.convertAndStore({ targets: [HIKVISION_HOST] }).ok, false);

// ── informe: filas de la BD → Markdown legible ─────────────────────
const dbRow = {
  id: 7,
  type: 'camera-exposed',
  summary: 'Candidato sin verificar — 203.0.113.10: cámara probable (95/100)',
  severity: 'high',
  created_at: '2026-09-11 10:00:00',
  details: added[0].details,
};
const generic = {
  id: 8,
  type: 'nuclei',
  summary: 'Exposed .git directory',
  severity: 'medium',
  details: { url: 'https://portal-ayto.example/.git/config', matched: 'config', status: 200 },
};

const norm = reportExport.normalizeFinding(dbRow);
assert.strictEqual(norm.name, dbRow.summary);
assert.strictEqual(norm.affected, '203.0.113.10');
assert.ok(norm.description.includes('CVE-2021-36260'));
assert.ok(norm.description.includes('Puertos observados'));
assert.deepStrictEqual(norm.cves, ['CVE-2021-36260', 'CVE-2017-7921']);
assert.strictEqual(norm.evidence.length, 1);
assert.ok(norm.commands.some((c) => c.includes('curl')));
assert.strictEqual(norm.camera, true);

const normGeneric = reportExport.normalizeFinding(generic);
assert.strictEqual(normGeneric.camera, false);
assert.ok(normGeneric.description.includes('portal-ayto.example/.git/config'), 'los detalles genéricos se listan como pares clave/valor');
assert.ok(!/\[object Object\]/.test(normGeneric.description));

const md = reportExport.generateMarkdown({ target: 'portal-ayto.example', scope: ['portal-ayto.example'] }, [dbRow, generic], []);
assert.ok(md.includes('## Findings'));
assert.ok(md.includes('## Appendix A — Public-index exposure (cameras)'));
assert.ok(md.includes('203.0.113.10'));
assert.ok(md.includes('CVE-2021-36260'));
assert.ok(md.includes('candidates, not confirmed vulnerabilities'));
assert.ok(md.includes(added[0].details.evidence[0]), 'el informe cita la ruta de la evidencia');
assert.ok(md.includes('curl -s https://internetdb.shodan.io/203.0.113.10 | jq .'), 'y cómo reproducirla');
assert.ok(!/\[object Object\]/.test(md), 'nunca se imprime un objeto crudo');
assert.ok(md.includes('| High     | 1 |') && md.includes('| Medium   | 1 |'));

// El apéndice no aparece si no hay hallazgos de índices públicos.
const mdGeneric = reportExport.generateMarkdown({ target: 'x', scope: [] }, [generic], []);
assert.ok(!mdGeneric.includes('Appendix A'));
assert.ok(mdGeneric.includes('**Affected:** https://portal-ayto.example/.git/config'));

const mdEmpty = reportExport.generateMarkdown({ target: 'x', scope: [] }, [], []);
assert.ok(mdEmpty.includes('A total of **0** findings'));

// Sesión CRUDA de la BD (scope/opplan son strings JSON): el export no puede
// reventar por eso — era el fallo que dejaba el informe en 500.
const mdRawSession = reportExport.generateMarkdown({ target: 'portal-ayto.example', scope: '[]', opplan: '{}', phases: '{}' }, [dbRow], []);
assert.ok(mdRawSession.includes('- portal-ayto.example'), 'una sesión cruda cae al target, no lanza');
assert.ok(mdRawSession.includes('Appendix A'));

const mdStringScope = reportExport.generateMarkdown({ target: 'x', scope: 'a.example, b.example' }, [], []);
assert.ok(mdStringScope.includes('- a.example') && mdStringScope.includes('- b.example'), 'una lista separada por comas también vale');

const html = reportExport.generateHTML({ target: 'portal-ayto.example', scope: [] }, [dbRow], []);
assert.ok(html.includes('<h1>Penetration Test Report</h1>'), 'los títulos no quedan dentro de un <p>');
assert.ok(html.includes('<h2>Appendix A — Public-index exposure (cameras)</h2>'));
assert.ok(html.includes('<table>'));

console.log('camera-findings: OK');
