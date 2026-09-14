'use strict';

// ============================================================================
// camera-findings.js — de «Cámaras Expuestas» a hallazgos de la misión
//
// QUÉ HACE
// Toma los objetivos que devolvió el análisis de índices públicos (InternetDB)
// y los convierte en hallazgos de la sesión activa, cada uno con:
//
//   * severidad razonada (CVEs + confianza de cámara, no adivinada);
//   * `details` estructurado (activos, puertos, CPEs, CVEs, señales, enlaces);
//   * un fichero de EVIDENCIA en disco con el registro del índice y las
//     consultas exactas para reproducirlo, registrado en la tabla `evidence`.
//
// QUÉ NO HACE (mismos límites que el módulo del que viene)
//   * no contacta con el objetivo;
//   * no convierte en hallazgo nada que no venga ya analizado;
//   * no confía en las puntuaciones del cliente: vuelve a puntuar con el mismo
//     motor (`scoreCamera`) a partir de los campos saneados, así que un
//     navegador manipulado no puede inflar la severidad de un hallazgo.
//
// Los hallazgos nacen marcados como CANDIDATO NO VERIFICADO: la evidencia es
// metadato de un escaneo ajeno, no una explotación. Es responsabilidad de la
// persona verificar (2 pasadas + compuerta) antes de reportar.
// ============================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const exposed = require('./exposed-cameras');

const TYPE = 'camera-exposed';
const MODULE_ID = 'camaras-expuestas';
const MAX_TEXT_BYTES = 256 * 1024;

const SEVERITY_ORDER = ['info', 'low', 'medium', 'high', 'critical'];

const DEFAULTS = {
  minScore: 20,        // por debajo de esto no hay ninguna señal de cámara
  includeInfo: false,  // los «dudosos» se quedan fuera salvo que se pidan
  onlyVulns: false,    // solo hosts con CVEs asociados en el índice
  limit: 32,           // mismo tope que el análisis (una evidencia por objetivo)
  severityFloor: null, // 'low' | 'medium' | … eleva el mínimo de severidad
};

// ── saneado de la entrada ──────────────────────────────────────────────────
// El cliente manda lo que vio en pantalla, pero aquí se reconstruye todo lo
// que importa: se conserva solo lo que tiene forma válida y se re-puntúa.

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const CVE_RE = /^CVE-\d{4}-\d{4,7}$/i;

function cleanIpv4(value) {
  const m = IPV4_RE.exec(String(value == null ? '' : value).trim());
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  if (octets.some((o) => o > 255)) return null;
  return octets.join('.');
}

function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const t = value.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  if (!t) return null;
  return t.slice(0, max);
}

function cleanPorts(value) {
  const out = new Set();
  for (const raw of Array.isArray(value) ? value : []) {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= 65535) out.add(n);
  }
  return [...out].sort((a, b) => a - b).slice(0, 24);
}

function cleanList(value, { max = 6, len = 200, pattern = null, upper = false } = {}) {
  const out = [];
  for (const raw of Array.isArray(value) ? value : []) {
    let t = cleanText(raw, len);
    if (!t) continue;
    if (pattern && !pattern.test(t)) continue;
    if (upper) t = t.toUpperCase();
    if (!out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Sanea un objetivo tal como lo devolvió el análisis. Devuelve
 * `{ target }` o `{ ip, error }` para que el descarte quede explicado.
 */
function sanitizeTarget(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const ip = cleanIpv4(input.ip);
  if (!ip) return { ip: cleanText(String(input.ip || ''), 40) || '(sin ip)', error: 'no es una IPv4 válida' };
  if (exposed.isPrivateIpv4(ip)) return { ip, error: 'red privada: no se registra desde índices públicos' };

  const record = {
    ports: cleanPorts(input.ports),
    hostnames: cleanList(input.hostnames, { max: 6, len: 253, pattern: /^[a-z0-9.-]+$/i }),
    cpes: cleanList(input.cpes, { max: 12, len: 200 }),
    tags: cleanList(input.tags, { max: 12, len: 40, pattern: /^[a-z0-9_.-]+$/i }),
    vulns: cleanList(input.vulns, { max: 25, len: 20, pattern: CVE_RE, upper: true }),
  };

  // Mismo motor de puntuación que el análisis: la severidad no depende del
  // valor que llegue del cliente.
  const scored = exposed.scoreCamera(record);

  return {
    target: {
      ip,
      ...record,
      score: scored.score,
      reasons: scored.reasons,
      cameraPorts: scored.cameraPorts,
      isLikelyCamera: scored.isLikelyCamera,
      internetDb: `https://internetdb.shodan.io/${ip}`,
      shodan: `https://www.shodan.io/host/${ip}`,
    },
  };
}

function confidenceLabel(score) {
  if (score >= 80) return 'muy probable';
  if (score >= 55) return 'probable';
  if (score >= 40) return 'posible';
  return 'dudoso';
}

/** Etiqueta de marca del primer CPE que case con una firma conocida. */
function brandLabel(cpes) {
  const list = (cpes || []).map((c) => String(c).toLowerCase());
  for (const brand of Object.values(exposed.BRANDS)) {
    if (list.some((cpe) => brand.cpe.some((fragment) => cpe.includes(fragment)))) return brand.label;
  }
  return null;
}

/**
 * Severidad razonada. Se queda en «medio» cuando no hay confirmación de que el
 * CVE aplique: el índice asocia CVEs por CPE, no porque haya probado el fallo.
 */
function severityFor(target) {
  const hasVulns = target.vulns.length > 0;
  if (hasVulns && target.isLikelyCamera) return 'high';
  if (hasVulns) return 'medium';
  if (target.isLikelyCamera) return 'medium';
  if (target.score >= 20) return 'low';
  return 'info';
}

function summaryFor(target) {
  const bits = [];
  if (target.cameraPorts.length) bits.push(`puertos ${target.cameraPorts.slice(0, 4).join('/')}`);
  const brand = brandLabel(target.cpes);
  if (brand) bits.push(brand);
  if (target.vulns.length) bits.push(`${target.vulns.length} CVE`);
  if (target.hostnames.length) bits.push(target.hostnames[0]);
  const kind = target.isLikelyCamera ? 'cámara probable' : 'host con señales de cámara';
  return `Candidato sin verificar — ${target.ip}: ${kind} (${target.score}/100)` + (bits.length ? ` · ${bits.join(' · ')}` : '');
}

function reproduceCommands(target) {
  return [
    `curl -s https://internetdb.shodan.io/${target.ip} | jq .`,
    `curl -s https://internetdb.shodan.io/${target.ip} -o evidencia/internetdb-${target.ip}.json`,
    `https://www.shodan.io/host/${target.ip}`,
  ];
}

function recommendationFor() {
  return [
    'Confirmar por qué el equipo publica su panel o su stream en internet (mal NAT, UPnP, DMZ, puerto abierto a propósito).',
    'Cerrar el acceso desde internet, poner el dispositivo tras VPN y cambiar credenciales por defecto.',
    'Si el CVE aplica, actualizar el firmware y volver a comprobar; este hallazgo no demuestra explotación, solo exposición.',
  ].join(' ');
}

/** Texto de la evidencia (fichero .txt que se guarda en ~/.knk-suite/evidencia). */
function evidenceText(target, { now, sessionTarget = null, source = 'internetdb.shodan.io' } = {}) {
  const stamp = now || new Date().toISOString();
  const lines = [
    'KNK SUITE — Evidencia de exposición en índices públicos',
    '================================================================',
    `Tipo:        ${TYPE} (metadatos de índice público, candidato sin verificar)`,
    `Fecha:       ${stamp}`,
    `Objetivo:    ${target.ip}`,
    `Puntuación:  ${target.score}/100 · ${confidenceLabel(target.score)}${target.isLikelyCamera ? ' · parece cámara' : ''}`,
    `Sesión:      ${sessionTarget || '(sin target de sesión)'}`,
    `Fuente:      ${source}`,
    '',
    '-- Observado en el índice -----------------------------------------',
    `Puertos:     ${target.ports.length ? target.ports.join(', ') : '—'}`,
    `Puertos cám: ${target.cameraPorts.length ? target.cameraPorts.join(', ') : '—'}`,
    `Marca (CPE): ${brandLabel(target.cpes) || '—'}`,
    `CPEs:        ${target.cpes.length ? target.cpes.join(' | ') : '—'}`,
    `Hostnames:   ${target.hostnames.length ? target.hostnames.join(', ') : '—'}`,
    `Tags:        ${target.tags.length ? target.tags.join(', ') : '—'}`,
    `CVEs:        ${target.vulns.length ? target.vulns.join(', ') : '—'}`,
    '',
    '-- Por qué el motor lo marcó ---------------------------------------',
    ...(target.reasons.length ? target.reasons.map((r) => `- ${r}`) : ['- (sin señales registradas)']),
    '',
    '-- Reproducir ------------------------------------------------------',
    ...reproduceCommands(target).map((c) => `$ ${c}`),
    '',
    '-- Registro saneado del índice -------------------------------------',
    JSON.stringify({
      ip: target.ip,
      ports: target.ports,
      hostnames: target.hostnames,
      cpes: target.cpes,
      tags: target.tags,
      vulns: target.vulns,
      score: target.score,
      isLikelyCamera: target.isLikelyCamera,
      reasons: target.reasons,
    }, null, 2),
    '',
    'NOTA: metadatos de un escaneo que hizo un tercero; KNK no ha contactado',
    'con el objetivo, no ha abierto su stream y no ha probado credenciales.',
    'Antes de reportar hay que verificar (2 pasadas + compuerta) y confirmar',
    'que el activo está dentro del alcance autorizado.',
    '',
  ];
  return lines.join('\n').slice(0, MAX_TEXT_BYTES);
}

/** Nombre de fichero seguro y estable para la evidencia de un objetivo. */
function evidenceName(target, stampISO) {
  const safeStamp = String(stampISO || new Date().toISOString()).replace(/[:.]/g, '-');
  return `cam-exp-${target.ip}-${safeStamp}.txt`;
}

/** Escribe la evidencia en `dir` y devuelve la ruta absoluta. */
function writeEvidenceFile(dir, { name, text }) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, String(name).replace(/[^a-zA-Z0-9._-]/g, '_'));
  fs.writeFileSync(file, String(text), 'utf8');
  return file;
}

function defaultEvidenceDir() {
  return path.join(os.homedir(), '.knk-suite', 'evidencia');
}

function findingDetails(target, { evidence = [], now, sessionTarget = null }) {
  return {
    asset: target.ip,
    ip: target.ip,
    module: MODULE_ID,
    source: 'internetdb.shodan.io',
    semantics: 'public-index-metadata',
    verification: 'candidato-no-verificado',
    confidence: confidenceLabel(target.score),
    score: target.score,
    isLikelyCamera: target.isLikelyCamera,
    ports: target.ports,
    cameraPorts: target.cameraPorts,
    hostnames: target.hostnames,
    cpes: target.cpes,
    tags: target.tags,
    vulns: target.vulns,
    reasons: target.reasons,
    links: { internetDb: target.internetDb, shodan: target.shodan },
    capturedAt: now,
    evidence,
    reproduce: reproduceCommands(target),
    recommendation: recommendationFor(),
    scopeNote: 'Analiza solo sistemas de tu alcance autorizado: los índices públicos contienen dispositivos de terceros.',
    sessionTarget: sessionTarget || null,
    nextSteps: ['Verificar el dispositivo y su propietario', 'Comprobar si el CVE aplica de verdad', 'Cerrar la exposición o documentarla como riesgo aceptado'],
  };
}

/** Índice de hallazgos ya existentes por activo (para no duplicar). */
function existingByAsset(findings) {
  const map = new Map();
  for (const f of findings || []) {
    const d = f && typeof f.details === 'object' && f.details ? f.details : {};
    const asset = d.asset || d.ip || f.asset;
    if (!asset) continue;
    if (!map.has(asset)) map.set(asset, f);
  }
  return map;
}

function severityIndex(severity) {
  const i = SEVERITY_ORDER.indexOf(String(severity || '').toLowerCase());
  return i < 0 ? 0 : i;
}

/**
 * Plan de conversión (sin efectos): decide qué objetivos se convierten y por
 * qué se descarta el resto. Es la parte que los tests cubren sin red ni disco.
 */
function planConversion(targets, existingFindings = [], opts = {}) {
  const o = { ...DEFAULTS, ...(opts || {}) };
  const existing = existingByAsset(existingFindings);
  const accepted = [];
  const skipped = [];
  const duplicates = [];
  const filtered = [];
  const invalid = [];
  const seen = new Set();
  const floorIndex = o.severityFloor ? severityIndex(o.severityFloor) : -1;

  for (const raw of Array.isArray(targets) ? targets : []) {
    if (accepted.length >= o.limit) { skipped.push({ ip: raw && raw.ip, reason: 'límite de la tanda alcanzado' }); continue; }

    const clean = sanitizeTarget(raw);
    if (clean.error) { invalid.push({ ip: clean.ip, reason: clean.error }); continue; }
    const t = clean.target;

    if (seen.has(t.ip)) { skipped.push({ ip: t.ip, reason: 'repetido en la misma tanda' }); continue; }
    seen.add(t.ip);

    if (existing.has(t.ip)) { duplicates.push({ ip: t.ip, findingId: existing.get(t.ip).id || null }); continue; }

    let severity = severityFor(t);
    if (floorIndex >= 0 && severityIndex(severity) < floorIndex) severity = SEVERITY_ORDER[floorIndex];

    if (o.onlyVulns && !t.vulns.length) { filtered.push({ ip: t.ip, reason: 'sin CVEs en el índice (filtro activo)' }); continue; }
    if (t.score < o.minScore) { filtered.push({ ip: t.ip, reason: `puntuación ${t.score} < mínimo ${o.minScore}` }); continue; }
    if (severity === 'info' && !o.includeInfo) { filtered.push({ ip: t.ip, reason: 'sin señales suficientes (nivel info)' }); continue; }

    accepted.push({ ...t, severity });
  }

  return { accepted, skipped, duplicates, filtered, invalid, options: o };
}

/**
 * Convierte objetivos en hallazgos + evidencia, delegando la escritura.
 * @param {object[]} targets      Objetivos del análisis (forma de /cameras/exposed/search)
 * @param {object}   opts
 * @param {object[]} opts.existingFindings  Hallazgos ya en la sesión (dedup por activo)
 * @param {string}   [opts.now]   Fecha ISO (tests)
 * @param {string}   [opts.sessionTarget]
 * @param {function} [opts.writeEvidence] ({name,text,ip}) → ruta del fichero
 */
function convertTargets(targets, opts = {}) {
  const now = opts.now || new Date().toISOString();
  const plan = planConversion(targets, opts.existingFindings, opts);
  const written = [];
  const findings = plan.accepted.map((t) => {
    const name = evidenceName(t, now);
    const text = evidenceText(t, { now, sessionTarget: opts.sessionTarget });
    let evidencePath = null;
    if (typeof opts.writeEvidence === 'function') {
      try { evidencePath = opts.writeEvidence({ name, text, ip: t.ip }); }
      catch { evidencePath = null; }
    }
    written.push({ ip: t.ip, name, evidencePath, text });
    return {
      type: TYPE,
      summary: summaryFor(t),
      severity: t.severity,
      details: findingDetails(t, { evidence: evidencePath ? [evidencePath] : [], now, sessionTarget: opts.sessionTarget }),
      _evidence: evidencePath ? { name, path: evidencePath, text } : null,
    };
  });

  return { findings, written, plan, now };
}

/**
 * Orquestador: convierte y persiste hallazgos + evidencia en la sesión.
 * `store` es un adaptador mínimo (en producción lo construye el router):
 *   listFindings(sessionId) → hallazgos
 *   addFinding({type, summary, severity, details}) → id
 *   addEvidence({name, type, filePath}) → id
 */
function convertAndStore({ targets, sessionId, store, opts = {} } = {}) {
  if (!store || typeof store.addFinding !== 'function') {
    return { ok: false, error: 'falta el almacén de hallazgos' };
  }
  const existing = typeof store.listFindings === 'function' ? store.listFindings(sessionId) : [];
  const result = convertTargets(targets, {
    ...opts,
    existingFindings: existing,
    writeEvidence: (entry) => {
      const file = writeEvidenceFile(opts.evidenceDir || defaultEvidenceDir(), entry);
      try { store.addEvidence && store.addEvidence({ name: entry.name, type: 'text', filePath: file }); }
      catch { /* el fichero ya está escrito: no perder el hallazgo por la tabla */ }
      return file;
    },
  });

  const created = [];
  for (const f of result.findings) {
    const { _evidence, ...row } = f;
    const id = store.addFinding(row);
    created.push({
      id: typeof id === 'object' && id != null ? id.lastInsertRowid : id,
      ip: row.details.asset,
      severity: row.severity,
      cves: row.details.vulns,
      score: row.details.score,
      evidence: _evidence ? _evidence.path : null,
      summary: row.summary,
    });
  }

  const { accepted, skipped, duplicates, filtered, invalid, options } = result.plan;
  return {
    ok: true,
    created,
    summary: {
      requested: Array.isArray(targets) ? targets.length : 0,
      created: created.length,
      duplicates: duplicates.length,
      filtered: filtered.length,
      invalid: invalid.length,
      skipped: skipped.length,
      bySeverity: created.reduce((acc, c) => { acc[c.severity] = (acc[c.severity] || 0) + 1; return acc; }, {}),
      withVulns: accepted.filter((t) => t.vulns.length).length,
    },
    duplicates,
    filtered,
    invalid,
    skipped,
    options,
    capturedAt: result.now,
    semantics: 'mission-findings-with-evidence',
    note: 'Los hallazgos nacen como candidato no verificado: la evidencia es metadato de un índice público, no una explotación.',
  };
}

module.exports = {
  TYPE,
  MODULE_ID,
  SEVERITY_ORDER,
  DEFAULTS,
  sanitizeTarget,
  severityFor,
  confidenceLabel,
  brandLabel,
  summaryFor,
  recommendationFor,
  reproduceCommands,
  evidenceText,
  evidenceName,
  writeEvidenceFile,
  defaultEvidenceDir,
  findingDetails,
  existingByAsset,
  severityIndex,
  planConversion,
  convertTargets,
  convertAndStore,
};
