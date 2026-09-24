'use strict';

// ============================================================================
// lib/osint-findings.js — Conecta los resultados de las herramientas OSINT
// (lib/osint-tools) con el sistema de findings/evidencia de la suite.
//
// Flujo: execCommand() → parseOutput(tool, salida) → hallazgos estructurados
//        → ingest(tool, target, salida) → dedup estable (fingerprint) +
//        evidencia persistente (fichero con SHA-256 en ~/.knk-suite/evidencia)
//        → export JSON/CSV/Markdown.
//
// Deduplicación: cada hallazgo lleva `details.osint.key` (fingerprint
// `<tool>|<type>|<value>`). Re-ingerir lo mismo actualiza `lastSeenAt` y
// `occurrences` en el hallazgo existente en lugar de duplicar filas.
// ============================================================================

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const db = require('../db');
const osintTools = require('./osint-tools');

const EVIDENCE_DIR = path.join(os.homedir(), '.knk-suite', 'evidencia');

// ── Parser por herramienta → hallazgos estructurados ────────────────────────
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const HOST_RE = /(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}/gi;
const URL_RE = /https?:\/\/[^\s"'<>)]+/g;

function uniq(list) { return [...new Set(list)]; }

// Solo subdominios del objetivo: evita que URLs de fuentes (google.com,
// bing.com…) del log se cuelen como "subdominios".
function isSubdomainOf(host, target) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  const t = String(target || '').toLowerCase();
  return h.endsWith(`.${t}`) && h !== t;
}

function extractSubdomains(text, target) {
  if (!target) return [];
  const raw = String(text || '');
  // Los dominios de los emails presentes en el texto NO son subdominios:
  // el banner de theHarvester (cmartorella@edge-security.com) colaba como
  // "subdominio" el dominio del correo del autor.
  const emailDomains = new Set(
    (raw.match(/[a-zA-Z0-9._%+-]+@([a-zA-Z0-9.-]+\.[a-z]{2,63})/g) || [])
      .map((e) => e.split('@')[1].toLowerCase()),
  );
  const found = [];
  for (const m of raw.match(HOST_RE) || []) {
    const host = m.toLowerCase().replace(/\.$/, '');
    if (emailDomains.has(host)) continue;
    if (isSubdomainOf(host, target)) found.push(host);
  }
  return uniq(found);
}

function extractEmails(text) {
  return uniq(String(text || '').match(EMAIL_RE) || []);
}

function extractEmailsOfTarget(text, target) {
  const t = String(target || '').toLowerCase();
  if (!t) return extractEmails(text);
  return extractEmails(text).filter((e) => {
    const dom = String(e.split('@')[1] || '').toLowerCase();
    return dom === t || dom.endsWith('.' + t);
  });
}

function normalizePhone(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return '';
  return raw;
}

function extractPhones(text) {
  const raw = String(text || '').trim();
  const found = new Map();
  const add = (value, meta = {}) => {
    const number = normalizePhone(value);
    const digits = number.replace(/\D/g, '');
    if (!number || !digits) return;
    if (!found.has(digits)) found.set(digits, { number, ...meta });
  };
  try {
    const parsed = JSON.parse(raw);
    const visit = (value) => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== 'object') return;
      const number = value.number || value.phone || value.phoneNumber || value.msisdn;
      if (number) add(number, { country: value.country, carrier: value.carrier, lineType: value.lineType, location: value.location });
      for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child);
    };
    visit(parsed);
  } catch {}
  if (!found.size) {
    for (const line of raw.split(/\r?\n/)) {
      if (!/phone|number|msisdn|tel[eé]fono|telefono/i.test(line)) continue;
      for (const match of line.match(/(?:\+|00)?\d[\d\s().-]{6,}\d/g) || []) add(match);
    }
  }
  return [...found.values()];
}

function escapeRegExp(v) { return String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Convierte la salida cruda de una herramienta en hallazgos estructurados.
 * @returns {{type: string, value: string, meta: object}[]}
 */
function parseOutput(toolId, rawOutput, { target } = {}) {
  const text = String(rawOutput || '');
  const findings = [];

  if (toolId === 'theharvester') {
    for (const email of extractEmailsOfTarget(text, target)) findings.push({ type: 'osint.email', value: email, meta: { target } });
    for (const host of extractSubdomains(text, target)) findings.push({ type: 'osint.subdomain', value: host, meta: { target } });
  } else if (toolId === 'sherlock' || toolId === 'social-analyzer') {
    // Sherlock marca con [+] las cuentas encontradas y [-] las ausentes; solo
    // se ingieren los positivos cuyo path apunta al usuario buscado (evita
    // colar webs de plataformas o cuentas de otros usuarios).
    const userRx = target ? new RegExp(`/@?${escapeRegExp(target)}(?:[/?#]|$)`, 'i') : null;
    for (const line of text.split(/\r?\n/)) {
      if (!/^\[\+\]/.test(line.trim())) continue; // solo "[+] Sitio: URL"
      for (const url of line.match(URL_RE) || []) {
        if (!userRx || userRx.test(url)) findings.push({ type: 'osint.account', value: url, meta: { target } });
      }
    }
  } else if (toolId === 'spiderfoot') {
    for (const email of extractEmailsOfTarget(text, target)) findings.push({ type: 'osint.email', value: email, meta: { target } });
    for (const host of extractSubdomains(text, target)) findings.push({ type: 'osint.subdomain', value: host, meta: { target } });
  } else if (toolId === 'recon-ng') {
    // recon-cli (hackertarget) imprime "[*] Host: sub.dominio" con su
    // "[*] Ip_Address: x.y.z.w" en la línea siguiente. Igual que amass: solo
    // hosts subdominio del target (nunca el dominio base).
    const lines = String(text || '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/\[\*\]\s*Host:\s*(\S+)/i);
      if (!m) continue;
      const host = m[1].toLowerCase();
      const ipLine = (lines[i + 1] || '').match(/\[\*\]\s*Ip_Address:\s*(\S+)/i);
      if (extractSubdomains(host, target).length) {
        findings.push({ type: 'osint.subdomain', value: host, meta: { target, ip: ipLine ? ipLine[1] : null, source: 'hackertarget' } });
      }
    }
  } else if (toolId === 'phoneinfoga') {
    for (const p of extractPhones(text)) findings.push({ type: 'osint.phone', value: p.number, meta: { target, ...p } });
  } else if (toolId === 'amass') {
    // Amass enum -passive imprime un subdominio por línea; los wildcards
    // (*.sub.example.com) se normalizan al host base para mantener hostnames
    // estrictos y deduplicación estable.
    for (const line of text.split(/\r?\n/)) {
      let host = line.trim().toLowerCase();
      if (host.startsWith('*.')) host = host.slice(2);
      if (isSubdomainOf(host, target)) findings.push({ type: 'osint.subdomain', value: host, meta: { target } });
    }
  } else if (toolId === 'sublist3r') {
    // Sublist3r imprime un subdominio por línea (con cabeceras/banner): se
    // filtra igual que Amass — solo hosts del objetivo, sin wildcards.
    for (const line of text.split(/\r?\n/)) {
      const host = line.trim().toLowerCase().replace(/\.$/, '');
      if (isSubdomainOf(host, target)) findings.push({ type: 'osint.subdomain', value: host, meta: { target } });
    }
  } else if (toolId === 'osmedeus') {
    for (const email of extractEmails(text)) findings.push({ type: 'osint.email', value: email, meta: { target } });
    for (const host of extractSubdomains(text, target)) findings.push({ type: 'osint.subdomain', value: host, meta: { target } });
  }

  // Normaliza y limita (protección ante salidas patológicas)
  return findings
    .filter((f) => f && typeof f.value === 'string' && f.value.length > 0 && f.value.length <= 300)
    .slice(0, 2000);
}

function summaryFor(toolId, type, value) {
  const toolName = (osintTools.TOOLS.find((t) => t.id === toolId) || {}).name || toolId;
  const labels = {
    'osint.email': `Email expuesto en fuentes públicas: ${value}`,
    'osint.subdomain': `Subdominio descubierto (OSINT): ${value}`,
    'osint.account': `Cuenta pública detectada: ${value}`,
    'osint.phone': `Número reconocido: ${value}`,
  };
  return `${toolName}: ${labels[type] || `Dato OSINT (${type})`}`;
}

function severityFor(type) {
  if (type === 'osint.account' || type === 'osint.email') return 'low';
  return 'info';
}

function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }

/**
 * Ingiere los resultados de una ejecución: parsea, deduplica contra la sesión
 * y persiste la evidencia (fichero + hash) y los hallazgos.
 */
async function ingest(toolId, target, rawOutput, { sessionId } = {}) {
  const now = new Date().toISOString();
  const session = sessionId ? db.getOrCreateSession(sessionId) : db.getOrCreateSession();
  const parsed = parseOutput(toolId, rawOutput, { target });

  // 1) Evidencia: fichero con hash, registrado en la tabla evidence.
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const evFile = path.join(EVIDENCE_DIR, `osint_${toolId}_${Date.now()}.txt`);
  const evBody = `# OSINT ${toolId} — target: ${target} — ${now}\n\n${String(rawOutput || '')}`;
  fs.writeFileSync(evFile, evBody);
  const evidenceHash = sha256(evBody);
  db.stmts.insertEvidence.run(session.id, null, `OSINT ${toolId} (${target || 'n/a'})`, 'osint', evFile);

  // 2) Dedup estable: fingerprint <tool>|<type>|<value> en details.osint.key
  const existing = db.getFindings(session.id).filter((f) => f.details && f.details.osint && f.details.osint.key);
  const byKey = new Map(existing.map((f) => [f.details.osint.key, f]));

  let created = 0;
  let updated = 0;
  for (const f of parsed) {
    const key = `${toolId}|${f.type}|${f.value.toLowerCase()}`;
    const hit = byKey.get(key);
    if (hit) {
      const details = { ...hit.details, osint: { ...hit.details.osint, lastSeenAt: now, occurrences: (hit.details.osint.occurrences || 1) + 1 } };
      db.updateFindingDetails(session.id, hit.id, details);
      updated++;
    } else {
      db.addFinding(session.id, f.type, summaryFor(toolId, f.type, f.value), severityFor(f.type), {
        asset: f.value,
        evidence: [evFile],
        source: toolId,
        osint: { key, tool: toolId, target, firstSeenAt: now, lastSeenAt: now, occurrences: 1, meta: f.meta || {} },
      });
      created++;
    }
  }

  return {
    ok: true,
    tool: toolId,
    target,
    session: session.id,
    evidence: { file: evFile, sha256: evidenceHash },
    parsed: parsed.length,
    created,
    updated,
    duplicates: parsed.length - created - updated,
  };
}

/**
 * Export de los hallazgos OSINT de la sesión en JSON / CSV / Markdown.
 */
function exportFindings({ sessionId, format = 'json' } = {}) {
  const session = sessionId ? db.getOrCreateSession(sessionId) : db.getOrCreateSession();
  const findings = db.getFindings(session.id).filter((f) => f.details && f.details.osint);
  const rows = findings.map((f) => ({
    id: f.id,
    tool: f.details.osint.tool,
    type: f.type,
    value: f.details.asset || f.summary,
    target: f.details.osint.target || '',
    occurrences: f.details.osint.occurrences || 1,
    firstSeenAt: f.details.osint.firstSeenAt || null,
    lastSeenAt: f.details.osint.lastSeenAt || null,
    severity: f.severity,
    summary: f.summary,
  }));

  if (format === 'csv') {
    const headers = ['id', 'tool', 'type', 'value', 'target', 'occurrences', 'firstSeenAt', 'lastSeenAt', 'severity'];
    const cell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = [headers.join(',')].concat(rows.map((r) => headers.map((h) => cell(r[h])).join(',')));
    return { mime: 'text/csv; charset=utf-8', filename: `osint-findings-${session.id}.json`.replace('.json', '.csv'), body: lines.join('\r\n') };
  }
  if (format === 'md') {
    const lines = [
      `# OSINT — hallazgos de la sesión ${session.id}`,
      '',
      `| id | tool | type | value | target | occ | severity |`,
      `|---|---|---|---|---|---|---|`,
    ];
    for (const r of rows) lines.push(`| ${r.id} | ${r.tool} | ${r.type} | ${r.value} | ${r.target} | ${r.occurrences} | ${r.severity} |`);
    return { mime: 'text/markdown; charset=utf-8', filename: `osint-findings-${session.id}.md`, body: lines.join('\n') };
  }
  return { mime: 'application/json; charset=utf-8', filename: `osint-findings-${session.id}.json`, body: JSON.stringify({ session: session.id, exportedAt: new Date().toISOString(), count: rows.length, findings: rows }, null, 2) };
}

module.exports = { parseOutput, ingest, exportFindings, sha256, EVIDENCE_DIR };
