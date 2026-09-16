'use strict';
// ============================================================================
// oast.js — OAST integrado (protocolo interactsh) para KNK Suite
//
// Out-of-band: generas un payload (subdominio único), lo inyectas donde
// sospechas SSRF/XXE/RCE ciego, y si el objetivo llama a casa el callback
// llega aquí, se correlaciona con el payload y se convierte en hallazgo con
// evidencia en disco. Protocolo idéntico al cliente Go de projectdiscovery:
//
//   register   POST {server}/register  { publicKey(b64 SPKI PEM), secretKey, correlationID }
//   poll       GET  {server}/poll?id=CID&secret=SECRET
//               → { data:[b64], aesKey:b64, extra:[], tldData:[] }
//               aesKey = AES-256 cifrada con RSA-OAEP-SHA256 de TU clave pública;
//               cada data = AES-256-CTR con IV prefijo (16 bytes) → JSON interaction
//   payload    CID + nonce(zbase32 de 13 bytes, recortado) + "." + host
//   deregister POST {server}/deregister { correlationID, secretKey }
//
// Los servidores públicos por defecto son los de projectdiscovery
// (oast.pro, oast.live, ...); se puede apuntar a un servidor propio con token.
// ============================================================================

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { URL } = require('url');

const DEFAULT_SERVERS = 'oast.pro,oast.live,oast.site,oast.online,oast.fun,oast.me';
const CID_LENGTH = 20;           // preamble del payload (como el CLI)
const NONCE_LENGTH = 13;         // nonce por payload (como el CLI)
const MAX_PAYLOADS = 500;
const MAX_HITS = 500;
const MAX_INTERACTIONS_IN_DETAILS = 50;
const STATE_FILE = path.join(os.homedir(), '.knk-suite', 'oast-state.json');
const EVIDENCE_DIR = path.join(os.homedir(), '.knk-suite', 'evidencia');

const ZBASE32_ALPHA = 'ybndrfg8ejkmcpqxot1uwisza345h769';

/** z-base-32 (minúsculas, sin padding), bit a bit — prefijo idéntico al de Go. */
function zbase32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ZBASE32_ALPHA[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ZBASE32_ALPHA[(value << (5 - bits)) & 31];
  return out;
}

/** CID DNS-safe: 20 chars de [a-z0-9] (el servidor solo lo usa como clave). */
function newCorrelationId() {
  const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const raw = crypto.randomBytes(CID_LENGTH);
  let out = '';
  for (const b of raw) out += ALPHABET[b % ALPHABET.length];
  return out;
}

// ── estado del módulo ────────────────────────────────────────────────────────
const state = {
  session: null,      // { serverUrl, host, correlationID, secretKey, privateKeyPem, publicKeyB64 }
  payloads: new Map(),// key cid+nonce → { id, domain, createdAt, findingId, hits: 0 }
  hits: [],           // { id, payloadId, protocol, remoteAddress, timestamp, rawRequest, unknown }
  hitSeq: 0,
  polling: false,
  timer: null,
  intervalMs: 5000,
  autoCreateFindings: true,
  pollInFlight: false,
  lastPollAt: null,
  lastError: null,
  startedAt: null,
};

// ── persistencia local (la sesión sobrevive al rearranque) ──────────────────
function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      session: state.session,
      payloads: [...state.payloads.values()],
      intervalMs: state.intervalMs,
      autoCreateFindings: state.autoCreateFindings,
      savedAt: Date.now(),
    }, null, 2), 'utf8');
  } catch { /* el estado en disco es best-effort */ }
}

function loadState() {
  if (state.session || state.payloads.size) return; // ya cargado
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (raw.session) state.session = raw.session;
    for (const p of Array.isArray(raw.payloads) ? raw.payloads : []) {
      if (p && p.id && p.domain) state.payloads.set(p.key || p.domain.split('.')[0], { ...p, hits: p.hits || 0 });
    }
    if (Number.isFinite(raw.intervalMs)) state.intervalMs = raw.intervalMs;
    if (typeof raw.autoCreateFindings === 'boolean') state.autoCreateFindings = raw.autoCreateFindings;
  } catch { /* sin estado previo: primera vez */ }
}

// ── HTTP plano (sin seguir el proxy de la suite: el OAST va directo) ─────────
function httpRequest(urlStr, { method = 'GET', body = null, token = '', timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: token } : {}),
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      },
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout del servidor interactsh')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── registro / sesión ────────────────────────────────────────────────────────
async function registerSession({ server = DEFAULT_SERVERS, token = '', reuse = true } = {}) {
  loadState();

  let session = reuse ? state.session : null;
  if (session && session.correlationID && session.privateKeyPem) {
    // Re-registro con las claves guardadas (el servidor lo acepta si sigue vivo).
    const body = JSON.stringify({ publicKey: session.publicKeyB64, secretKey: session.secretKey, correlationID: session.correlationID });
    const res = await httpRequest(normalizeServer(session.host) + '/register', { method: 'POST', body, token });
    if (res.status === 200) {
      state.session = { ...session, token };
      state.startedAt = Date.now();
      saveState();
      return state.session;
    }
    session = null; // sesión muerta → sesión nueva
  }

  // Sesión nueva: RSA-2048 + claves, como el cliente Go.
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const publicKeyB64 = Buffer.from(publicKeyPem).toString('base64');
  const correlationID = newCorrelationId();
  const secretKey = crypto.randomUUID();

  const candidates = String(server || DEFAULT_SERVERS).split(',').map((s) => s.trim()).filter(Boolean);
  let lastError = 'sin servidores';
  for (const candidate of candidates) {
    const base = normalizeServer(candidate);
    try {
      const body = JSON.stringify({ publicKey: publicKeyB64, secretKey, correlationID });
      const res = await httpRequest(base + '/register', { method: 'POST', body, token });
      if (res.status !== 200) {
        if (res.status === 400 && /already exists/i.test(res.body)) {
          lastError = `${base}: este servidor exige autenticación (API key de PDCP en cloud.projectdiscovery.io, o token de tu servidor self-hosted). Ponla en el campo token.`;
        } else {
          lastError = `${base}: HTTP ${res.status} ${res.body.slice(0, 120)}`;
        }
        continue;
      }
      let parsed = {};
      try { parsed = JSON.parse(res.body); } catch { /* sin cuerpo JSON */ }
      if (parsed.message !== 'registration successful') { lastError = `${base}: ${parsed.message || 'respuesta inesperada'}`; continue; }
      state.session = {
        serverUrl: base,
        host: new URL(base).host,
        correlationID,
        secretKey,
        privateKeyPem: privateKey.export({ type: 'pkcs1', format: 'pem' }),
        publicKeyB64,
        token,
      };
      state.startedAt = Date.now();
      state.lastError = null;
      saveState();
      return state.session;
    } catch (e) {
      lastError = `${base}: ${e.message}`;
    }
  }
  throw new Error(`no se pudo registrar en ningún servidor (${lastError})`);
}

function normalizeServer(candidate) {
  const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  return withScheme.replace(/\/+$/, '');
}

async function deregister() {
  const s = state.session;
  if (!s) return { ok: true, note: 'sin sesión' };
  try {
    await httpRequest(s.serverUrl + '/deregister', {
      method: 'POST',
      body: JSON.stringify({ correlationID: s.correlationID, secretKey: s.secretKey }),
      token: s.token || '',
    });
  } catch { /* el servidor la expira solo */ }
  return { ok: true };
}

// ── payloads OOB ─────────────────────────────────────────────────────────────
function newPayloads(count = 1) {
  const s = state.session;
  if (!s) throw new Error('OAST no registrado: conecta primero');
  const out = [];
  const n = Math.min(Math.max(Number(count) || 1, 1), 20);
  if (state.payloads.size + n > MAX_PAYLOADS) throw new Error(`tope de ${MAX_PAYLOADS} payloads en la sesión`);
  for (let i = 0; i < n; i++) {
    const nonce = zbase32Encode(crypto.randomBytes(NONCE_LENGTH)).slice(0, NONCE_LENGTH);
    const domain = `${s.correlationID}${nonce}.${s.host}`;
    const rec = {
      id: `p${Date.now().toString(36)}${state.payloads.size.toString(36)}`,
      key: `${s.correlationID}${nonce}`,
      domain,
      httpUrl: `http://${domain}/`,
      httpsUrl: `https://${domain}/`,
      createdAt: Date.now(),
      findingId: null,
      hits: 0,
    };
    state.payloads.set(rec.key, rec);
    out.push(rec);
  }
  saveState();
  return out;
}

/** Payload especial para XXE/LDAP: el CID embebido en un URI tipo LDAP. */
function ldapPayload(rec) {
  return `ldap://${rec.domain}`;
}

// ── descifrado (AES key con RSA-OAEP + payload AES-256-CTR con IV prefijo) ──
function decryptInteraction(privateKeyPem, aesKeyB64, dataB64) {
  const aesKey = crypto.privateDecrypt(
    { key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(aesKeyB64, 'base64'),
  );
  const cipher = Buffer.from(dataB64, 'base64');
  if (cipher.length < 16) throw new Error('ciphertext demasiado corto');
  const iv = cipher.subarray(0, 16);
  const decipher = crypto.createDecipheriv('aes-256-ctr', aesKey, iv);
  const plain = Buffer.concat([decipher.update(cipher.subarray(16)), decipher.final()]);
  return JSON.parse(plain.toString('utf8').replace(/[\s]+$/, ''));
}

function pick(obj, ...keys) {
  for (const k of keys) if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  return null;
}

// ── poll + correlación + conversión a hallazgo ───────────────────────────────
async function pollOnce({ db, getSession } = {}) {
  const s = state.session;
  if (!s) throw new Error('OAST no registrado');
  if (state.pollInFlight) return { ok: true, skipped: true, new: 0 };
  state.pollInFlight = true;
  try {
    const res = await httpRequest(`${s.serverUrl}/poll?id=${encodeURIComponent(s.correlationID)}&secret=${encodeURIComponent(s.secretKey)}`, { token: s.token || '' });
    state.lastPollAt = Date.now();
    if (res.status === 401) { state.lastError = 'sesión expirada en el servidor'; return { ok: false, error: state.lastError, new: 0 }; }
    if (res.status !== 200) { state.lastError = `poll HTTP ${res.status}`; return { ok: false, error: state.lastError, new: 0 }; }

    let parsed;
    try { parsed = JSON.parse(res.body); } catch { state.lastError = 'poll con cuerpo no JSON'; return { ok: false, error: state.lastError, new: 0 }; }

    let fresh = 0;
    const batches = [
      ...(Array.isArray(parsed.data) ? parsed.data : []).map((d) => () => decryptInteraction(s.privateKeyPem, parsed.aesKey, d)),
      ...(Array.isArray(parsed.extra) ? parsed.extra : []).map((e) => () => JSON.parse(e)),
      ...(Array.isArray(parsed.tldData) ? parsed.tldData : []).filter(Boolean).map((e) => () => JSON.parse(e)),
    ];
    for (const decode of batches) {
      let it;
      try { it = decode(); } catch (e) { state.lastError = `interacción ilegible: ${e.message}`; continue; }
      if (recordInteraction(it, { db, getSession })) fresh++;
    }
    state.lastError = batches.length ? null : state.lastError;
    return { ok: true, new: fresh };
  } catch (e) {
    state.lastError = e.message;
    return { ok: false, error: e.message, new: 0 };
  } finally {
    state.pollInFlight = false;
  }
}

function recordInteraction(it, { db, getSession } = {}) {
  const fullId = String(pick(it, 'full-id', 'fullId') || '');
  const uniqueId = String(pick(it, 'unique-id', 'uniqueId') || pick(it, 'qname') || '');
  const hitCid = fullId || uniqueId;
  if (!hitCid) return false;

  let payloadRec = null;
  if (hitCid.startsWith(state.session.correlationID)) {
    payloadRec = state.payloads.get(hitCid) || null;
  }
  const hit = {
    id: ++state.hitSeq,
    payloadId: payloadRec ? payloadRec.id : null,
    unknown: !payloadRec,
    protocol: String(pick(it, 'protocol') || 'dns').toLowerCase(),
    remoteAddress: String(pick(it, 'remote-address', 'remoteAddress') || ''),
    timestamp: pick(it, 'timestamp') || new Date().toISOString(),
    rawRequest: String(pick(it, 'raw-request', 'rawRequest') || '').slice(0, 4000),
    payload: payloadRec ? payloadRec.domain : hitCid.split('.')[0],
    findingId: null,
  };
  state.hits.push(hit);
  if (state.hits.length > MAX_HITS) state.hits.splice(0, state.hits.length - MAX_HITS);
  if (payloadRec) payloadRec.hits++;

  if (payloadRec && state.autoCreateFindings) {
    try {
      hit.findingId = convertHitToFinding(hit, payloadRec, { db, getSession });
      if (hit.findingId) payloadRec.findingId = hit.findingId;
    } catch (e) {
      state.lastError = `hallazgo no creado: ${e.message}`;
    }
  }
  saveState();
  return true;
}

/**
 * Convierte un golpe confirmado en hallazgo de la misión con evidencia en
 * disco (~/.knk-suite/evidencia/oast-*.json). El primer golpe crea el
 * hallazgo; los siguientes se acumulan en sus details.interactions.
 */
function convertHitToFinding(hit, payloadRec, { db, getSession } = {}) {
  if (!db || typeof db.addFinding !== 'function') throw new Error('db no disponible');
  const sessionId = getSession ? getSession().id : null;
  if (!sessionId) throw new Error('sin sesión activa');

  const evidencePath = writeHitEvidence(hit, payloadRec);
  const interaction = {
    hitId: hit.id,
    protocol: hit.protocol,
    remoteAddress: hit.remoteAddress,
    timestamp: hit.timestamp,
    payload: hit.payload,
  };

  if (payloadRec.findingId) {
    const existing = db.getFinding(sessionId, payloadRec.findingId);
    if (existing) {
      const details = { ...existing.details };
      details.interactions = [...(details.interactions || []), interaction].slice(-MAX_INTERACTIONS_IN_DETAILS);
      details.hits = (details.hits || 1) + 1;
      db.updateFindingDetails(sessionId, payloadRec.findingId, details);
      return payloadRec.findingId;
    }
  }

  const severity = hit.protocol === 'http' || hit.protocol === 'https' || hit.protocol === 'ldap' ? 'high' : 'medium';
  const summary = `OOB ${hit.protocol.toUpperCase()} confirmado desde ${hit.remoteAddress || 'IP desconocida'}`;
  const details = {
    asset: hit.payload,
    oastPayload: hit.payload,
    oastHitId: hit.id,
    protocol: hit.protocol,
    remoteAddress: hit.remoteAddress,
    firstSeen: hit.timestamp,
    hits: 1,
    interactions: [interaction],
    evidence: [evidencePath],
    cves: [],
    module: 'OAST',
    note: 'Interacción out-of-band real: el objetivo contactó nuestro listener. Verifica el contexto de inyección antes de reportar.',
  };
  const res = db.addFinding(sessionId, 'OAST', summary, severity, details);
  return res && res.lastInsertRowid ? Number(res.lastInsertRowid) : (payloadRec.findingId || null);
}

function writeHitEvidence(hit, payloadRec) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = path.join(EVIDENCE_DIR, `oast-${payloadRec ? payloadRec.id : 'unknown'}-${hit.id}.json`);
  fs.writeFileSync(file, JSON.stringify({
    capturedAt: new Date().toISOString(),
    oastServer: state.session ? state.session.host : null,
    correlationId: state.session ? state.session.correlationID : null,
    payload: hit.payload,
    protocol: hit.protocol,
    remoteAddress: hit.remoteAddress,
    timestamp: hit.timestamp,
    rawRequest: hit.rawRequest,
  }, null, 2), 'utf8');
  return file;
}

/** Conversión manual (autoCreateFindings=false): el operador decide. */
function convertHitManually(hitId, { db, getSession } = {}) {
  const hit = state.hits.find((h) => h.id === hitId);
  if (!hit) throw new Error('golpe no encontrado');
  if (hit.findingId) return { ok: true, findingId: hit.findingId, note: 'ya convertido' };
  const payloadRec = hit.payloadId ? state.payloads.get([...state.payloads.entries()].find(([, v]) => v.id === hit.payloadId)?.[0]) : null;
  const findingId = convertHitToFinding(hit, payloadRec || { id: hit.payloadId || 'unknown', domain: hit.payload, findingId: null, hits: 1 }, { db, getSession });
  hit.findingId = findingId;
  if (payloadRec) payloadRec.findingId = findingId;
  saveState();
  return { ok: true, findingId };
}

// ── ciclo de polling ─────────────────────────────────────────────────────────
function startPolling({ db, getSession } = {}) {
  stopTimer();
  state.timer = setInterval(async () => {
    await pollOnce({ db, getSession }).catch(() => {});
  }, state.intervalMs);
  if (state.timer.unref) state.timer.unref();
  state.polling = true;
}

function stopTimer() {
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
  state.polling = false;
}

// ── API del módulo ───────────────────────────────────────────────────────────
async function start(opts = {}, deps = {}) {
  loadState();
  if (Number.isFinite(opts.pollIntervalMs) && opts.pollIntervalMs >= 2000) state.intervalMs = opts.pollIntervalMs;
  if (typeof opts.autoCreateFindings === 'boolean') state.autoCreateFindings = opts.autoCreateFindings;
  const session = await registerSession({ server: opts.server, token: opts.token, reuse: opts.reuse !== false });
  startPolling(deps);
  await pollOnce({ ...deps }).catch(() => {});
  return { ok: true, server: session.host, correlationId: session.correlationID, reused: !!state.session && state.startedAt !== Date.now(), payloads: state.payloads.size, hits: state.hits.length };
}

async function stop({ keepPayloads = true } = {}) {
  stopTimer();
  const res = await deregister();
  state.session = null;
  state.startedAt = null;
  if (!keepPayloads) { state.payloads.clear(); state.hits = []; }
  try { fs.rmSync(STATE_FILE, { force: true }); } catch { /* nada que borrar */ }
  return { ...res, note: 'OAST desconectado; los payloads conservados ya no reciben sondeo.' };
}

function status() {
  loadState();
  return {
    ok: true,
    registered: !!state.session,
    server: state.session ? state.session.host : null,
    correlationId: state.session ? state.session.correlationID : null,
    polling: state.polling,
    intervalMs: state.intervalMs,
    autoCreateFindings: state.autoCreateFindings,
    payloads: state.payloads.size,
    hits: state.hits.length,
    lastPollAt: state.lastPollAt,
    lastError: state.lastError,
    defaultServers: DEFAULT_SERVERS,
  };
}

function listPayloads() {
  loadState();
  return [...state.payloads.values()].sort((a, b) => b.createdAt - a.createdAt).map((p) => ({ ...p, ldapUrl: ldapPayload(p) }));
}

function listHits({ limit = 100, since = 0 } = {}) {
  loadState();
  return state.hits
    .filter((h) => h.id > (Number(since) || 0))
    .slice(-Math.min(Number(limit) || 100, MAX_HITS))
    .reverse();
}

function reset({ db, getSession } = {}) {
  stopTimer();
  state.payloads.clear();
  state.hits = [];
  state.hitSeq = 0;
  state.lastError = null;
  saveState();
  return { ok: true, note: 'payloads y golpes locales borrados (la sesión sigue activa)' };
}

module.exports = {
  DEFAULT_SERVERS,
  zbase32Encode,
  newCorrelationId,
  decryptInteraction,
  start,
  stop,
  status,
  newPayloads,
  pollOnce,
  listPayloads,
  listHits,
  convertHitManually,
  recordInteraction,
  reset,
  _state: state,
};
