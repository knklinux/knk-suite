'use strict';

// ============================================================================
// routes.js — Capa de rutas HTTP + terminal WebSocket del workbench.
// ============================================================================

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

const db = require('./db');
const docker = require('./lib/docker');
const netMod = require('./lib/net');
const localPipeline = require('./lib/local-pipeline');
const surfaceMap = require('./lib/surface-map');
const reportMod = require('./lib/report');
const verifierMod = require('./lib/verifier');
const programParser = require('./lib/program-parser');
const llmMod = require('./lib/llm');
const vault = require('./lib/vault');
const { detectMode, getSystemPrompt } = require('./lib/system-prompts');
const jobs = require('./lib/jobs');
const kali = require('./lib/kali');
const kaliToolsJob = require('./lib/kali-tools-job');
const kaliLocal = require('./lib/kali-local');
const assistant = require('./lib/assistant');
const models = require('./lib/models');
const osint = require('./lib/osint');
const osintTools = require('./lib/osint-tools');
const osintFindings = require('./lib/osint-findings');
const paramHunter = require('./lib/param-hunter');
const proxyMod = require('./lib/proxy');

// Sink del scanner pasivo del proxy: convierte candidatos en hallazgos de la
// sesión con dedup estable (details.proxyScan.key). Devuelve el id del
// hallazgo creado/actualizado (o null si ya existía).
proxyMod && (() => {
  const scannerMod = require('./lib/proxy-scanner');
  scannerMod.setFindingSink(({ sessionId, key, severity, summary, details }) => {
    const existing = db.getFindings(sessionId).find((f) => f.details && f.details.proxyScan && f.details.proxyScan.key === key);
    if (existing) {
      const merged = { ...existing.details, ...details, proxyScan: { ...existing.details.proxyScan, lastSeenAt: new Date().toISOString() } };
      db.updateFindingDetails(sessionId, existing.id, merged);
      return existing.id;
    }
    const r = db.addFinding(sessionId, 'PROXY-SCAN', summary, severity, details);
    return (r && r.lastInsertRowid) || null;
  });
  return scannerMod;
})();
const gates = require('./lib/gates');
const revocation = require('./lib/revocation');
const dorks = require('./lib/dorks');
const closeMission = require('./lib/close-mission');
const browser = require('./lib/browser');
const { auditLocalCameraNetwork } = require('./lib/camera-audit');
const cameraIndex = require('./lib/camera-index');
const vmLabs = require('./lib/vm-labs');
const dashboard = require('./lib/dashboard');
const repeater = require('./lib/repeater');
const intruder = require('./lib/intruder');
const outproxy = require('./lib/outproxy');
const oastRouter = require('./lib/oast-router');
const egress = require('./lib/egress');

const router = express.Router();

// ── Session helper ───────────────────────────────────────────────────
function getSession() {
  const s = db.getOrCreateSession();
  return {
    ...s,
    scope: JSON.parse(s.scope || '[]'),
    out_of_scope: JSON.parse(s.out_of_scope || '[]'),
    opplan: JSON.parse(s.opplan || '{}'),
    phases: JSON.parse(s.phases || '{}'),
    artifacts: JSON.parse(s.artifacts || '{}'),
  };
}

// ── Health ───────────────────────────────────────────────────────────
router.get('/health', async (req, res) => {
  const kaliState = await kali.detect();
  const ollama = await llmMod.status().catch(() => ({ up: false, models: [] }));
  let vaultStats = { notes: 0 };
  try { vaultStats = vault.stats(); } catch {}
  res.json({ ok: true, checkedAt: new Date().toISOString(), subsystems: {
    sqlite: true,
    kali: { status: kaliState.status, runtime: kaliState.runtime, distro: kaliState.distro, reason: kaliState.reason },
    ollama: { up: ollama.up, models: ollama.models?.length || 0 },
    vault: { notes: vaultStats.notes ?? vaultStats.total ?? 0 },
  } });
});

// ── Kali ─────────────────────────────────────────────────────────────
router.get('/kali/status', async (req, res) => {
  if (req.query.fresh) kali.invalidateCache();
  res.json(await kali.detect());
});
router.get('/kali/tools', (req, res) => res.json({ ok: true, tools: kaliLocal.inventory() }));
router.post('/kali/exec', async (req, res) => {
  const { command } = req.body || {};
  if (!command || typeof command !== 'string') return res.status(400).json({ ok: false, error: 'command requerido' });
  const authMod = require('./lib/auth');
  const reason = authMod.validateCommand(command);
  if (reason) return res.status(400).json({ ok: false, error: `Comando bloqueado: ${reason}` });
  res.json(await kali.exec(command));
});
router.get('/kali/runtimes', async (req, res) => res.json(await kali.runtimes()));
router.post('/kali/start', async (req, res) => {
  try { const r = await kali.startVM(); res.json({ ok: !r.err, out: (r.stdout || r.stderr || '').slice(0, 400) }); }
  catch (e) { res.json({ ok: false, out: e.message }); }
});
// Contenedor Kali Docker (pull solo si falta + crear + arrancar). Explícito,
// nunca automático: el pull descarga cientos de MB.
router.post('/kali/docker-ensure', async (req, res) => {
  try { res.json(await kali.ensureDockerKali()); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
router.post('/kali/setup-wsl', async (req, res) => {
  const st = await kali.detect();
  if (!st.distro) return res.json({ ok: false, error: st.reason || 'sin distro WSL' });
  res.json(await kali.setupWslKali(st.distro));
});
router.get('/kali/tool-catalog', (req, res) => res.json({ ok: true, catalog: kaliToolsJob.PACKAGE_CATALOG, categories: kaliToolsJob.CATS }));
router.post('/kali/install-tools', (req, res) => {
  const { packages } = req.body || {};
  const job = kaliToolsJob.installKaliTools(jobs, kali, Array.isArray(packages) ? packages : []);
  res.json({ ok: true, job });
});

// ── Laboratorios virtuales ─────────────────────────────────────────
router.get('/labs/catalog', (req, res) => res.json({ ok: true, catalog: vmLabs.LAB_CATALOG, providers: vmLabs.PROVIDERS }));
router.get('/labs/inventory', async (req, res) => { try { res.json(await vmLabs.inventory()); } catch (e) { res.status(500).json({ ok: false, error: e.message, machines: [], providers: [] }); } });
router.post('/labs/start', async (req, res) => { try { res.json(await vmLabs.start(req.body?.machine)); } catch (e) { res.status(400).json({ ok: false, error: e.message }); } });
router.post('/labs/stop', async (req, res) => { try { res.json(await vmLabs.stop(req.body?.machine)); } catch (e) { res.status(400).json({ ok: false, error: e.message }); } });
router.post('/labs/provision', async (req, res) => { try { res.json(await vmLabs.provision(req.body?.lab)); } catch (e) { res.status(400).json({ ok: false, error: e.message }); } });
router.post('/labs/deprovision', async (req, res) => { try { res.json(await vmLabs.deprovision(req.body?.lab)); } catch (e) { res.status(400).json({ ok: false, error: e.message }); } });

// ── OSINT Hub ────────────────────────────────────────────────────────
router.get('/osint/status', (req, res) => res.json(osint.status()));
// ── Herramientas OSINT locales (theHarvester, Sherlock, SpiderFoot, Social
//    Analyzer, Amass, PhoneInfoga, Osmedeus). Instalación SIEMPRE explícita
//    (confirm: true) y ejecución con target/args validados en lib/osint-tools.
router.get('/osint/tools', async (req, res) => {
  try { res.json(await osintTools.status()); } // status() es async (detecta cada herramienta)
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
router.post('/osint/tools/install', async (req, res) => {
  const { id, confirm } = req.body || {};
  if (confirm !== true) return res.status(400).json({ ok: false, error: 'instalación requiere confirm: true (descarga e instala software en el host local)' });
  try { res.json(await osintTools.install(String(id || ''))); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
router.post('/osint/tools/run', async (req, res) => {
  const { id, target, args, timeoutMs } = req.body || {};
  try {
    const result = await osintTools.execCommand(String(id || ''), { target, args, timeoutMs });
    // Ingesta automática: parsea la salida y crea/actualiza hallazgos + evidencia.
    if (result.ok && typeof result.output === 'string') {
      try { result.ingest = await osintFindings.ingest(String(id), result.target, result.output); } catch (e) { result.ingest = { ok: false, error: e.message }; }
    }
    res.json(result);
  }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
// ── Hallazgos OSINT: ingesta manual, listado y export ───────────────────────
router.post('/osint/findings/ingest', async (req, res) => {
  const { id, target, output } = req.body || {};
  if (!id || typeof output !== 'string') return res.status(400).json({ ok: false, error: 'id y output requeridos' });
  try { res.json(await osintFindings.ingest(String(id), String(target || ''), output)); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
router.get('/osint/findings', (req, res) => {
  const session = getSession();
  const fTool = String(req.query.tool || '').trim().toLowerCase();
  const fType = String(req.query.type || '').trim().toLowerCase();
  const fOcc = parseInt(req.query.occ, 10) || 0;
  // Facets (herramientas y tipos) calculados SIEMPRE sobre el total sin filtrar:
  // los desplegables del Dashboard no se vacían cuando se aplica un filtro.
  const all = db.getFindings(session.id).filter((f) => f.details && f.details.osint).map((f) => ({
    id: f.id, tool: f.details.osint.tool, type: f.type, value: f.details.asset || '',
    target: f.details.osint.target || '', occurrences: f.details.osint.occurrences || 1,
    firstSeenAt: f.details.osint.firstSeenAt || null, lastSeenAt: f.details.osint.lastSeenAt || null,
    severity: f.severity, summary: f.summary,
  }));
  const uniqSorted = (arr) => [...new Set(arr)].sort();
  const facets = { tools: uniqSorted(all.map((r) => r.tool)), types: uniqSorted(all.map((r) => r.type)) };
  // Stats globales (sin filtros) para la tarjeta del Dashboard:
  //  · byTool → gráfico de barras por herramienta
  //  · newLast24h → hallazgos cuyo firstSeenAt cae en las últimas 24 h
  const byToolMap = new Map();
  for (const r of all) byToolMap.set(r.tool, (byToolMap.get(r.tool) || 0) + 1);
  const byTool = [...byToolMap.entries()]
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b2) => b2.count - a.count || a.tool.localeCompare(b2.tool));
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const newLast24h = all.filter((r) => {
    const t = r.firstSeenAt ? Date.parse(r.firstSeenAt) : NaN;
    return Number.isFinite(t) && t >= cutoff;
  }).length;
  const rows = all
    .filter((r) => !fTool || r.tool === fTool)
    .filter((r) => !fType || r.type === fType)
    .filter((r) => r.occurrences >= fOcc);
  res.json({ ok: true, count: rows.length, total: all.length, facets, byTool, newLast24h, findings: rows });
});

// ── Acciones sobre hallazgos OSINT: → pipeline / → targets / → Repeater ─────
// Solo osint.subdomain es enviable. TODAS las acciones respetan el scope de la
// sesión (mismo criterio textual que repeater.sendRaw y targetGate del
// pipeline): un subdominio fuera de scope se rechaza con 400 ANTES de tocar
// pipeline, targets o el cliente HTTP — fail-closed, sin excepciones.
const SUBDOMAIN_RX = /^(?=.{1,253}$)([a-z0-9]([a-z0-9_-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function osintSendableFinding(session, rawId) {
  const id = String(rawId || '').trim();
  if (!id) return { error: 'id requerido' };
  const f = db.getFindings(session.id).find((x) => String(x.id) === id && x.details && x.details.osint);
  if (!f) return { error: 'hallazgo no encontrado' };
  if (f.type !== 'osint.subdomain') return { error: 'solo osint.subdomain se puede enviar (este es ' + f.type + ')' };
  const value = String(f.details.asset || '').trim().toLowerCase();
  if (!SUBDOMAIN_RX.test(value)) return { error: 'el valor del hallazgo no es un hostname válido' };
  return { finding: f, tool: f.details.osint.tool, value };
}

// out-of-scope de la sesión: SIEMPRE domina (ninguna acción lo salta)
function inOutOfScope(session, host) {
  const h = String(host || '').toLowerCase();
  const oos = Array.isArray(session.out_of_scope) ? session.out_of_scope : [];
  return oos.some((e) => { const s = String(e || '').trim().toLowerCase(); return s && (h === s || h.endsWith('.' + s)); });
}

// Scope estricto para pipeline/repeater: mismo criterio textual que
// repeater.sendRaw y targetGate (fail-closed, sin excepciones)
function osintScopeBlocked(session, host) {
  if (inOutOfScope(session, host)) return '"' + host + '" está en el out-of-scope de la sesión';
  if (!Array.isArray(session.scope) || !session.scope.length || !netMod.inScope(host)) {
    return 'FUERA DE SCOPE: "' + host + '" no está en el scope de la sesión. Usa "＋ targets" para añadirlo (eso invalida un OPPLAN aprobado, por diseño).';
  }
  return null;
}

router.post('/osint/findings/send-to-pipeline', (req, res) => {
  const s = getSession();
  const v = osintSendableFinding(s, req.body?.id);
  if (v.error) return res.status(400).json({ ok: false, error: v.error });
  const blocked = osintScopeBlocked(s, v.value);
  if (blocked) return res.status(400).json({ ok: false, error: blocked });
  // Fijar el target de la sesión (el pipeline arranca desde ahí) y dejar
  // trazabilidad como hallazgo de pipeline (sin details.osint: no aparece
  // en la vista OSINT, sí en la unificada y en los facets).
  s.target = v.value;
  db.saveSession(s.id, s);
  const fingerprint = 'pipeline:' + v.value + ':' + new Date().toISOString().slice(0, 10);
  db.addFinding(s.id, 'TARGET',
    'Target de pipeline fijado desde hallazgo OSINT: ' + v.value + ' (' + v.tool + ')',
    'info',
    { sentFrom: 'osint-finding', findingId: v.finding.id, tool: v.tool, osintTarget: v.finding.details.osint.target || '', subdomain: v.value, fingerprint });
  res.json({ ok: true, sent: 'pipeline', target: s.target, sessionId: s.id, pipelineFingerprint: fingerprint });
});

router.post('/osint/findings/send-to-targets', (req, res) => {
  const s = getSession();
  const v = osintSendableFinding(s, req.body?.id);
  if (v.error) return res.status(400).json({ ok: false, error: v.error });
  if (inOutOfScope(s, v.value)) return res.status(400).json({ ok: false, error: '"' + v.value + '" está en el out-of-scope de la sesión' });
  // Decisión humana de ampliar superficie: el valor debe ser subdominio del
  // dominio del target de sesión (relación de dominio, no de scope).
  const tHost = netMod.normalizeHost(s.target || '');
  const related = tHost && (v.value === tHost || v.value.endsWith('.' + tHost));
  if (!related) return res.status(400).json({ ok: false, error: '"' + v.value + '" no es subdominio del target de sesión (' + (tHost || 'sin target') + ')' });
  const existing = db.stmts.listTargets.all().some((t) => String(t.name || '').toLowerCase() === v.value);
  if (!existing) {
    const id = require('node:crypto').randomUUID();
    db.stmts.insertTarget.run(id, v.value, JSON.stringify([v.value]), '', new Date().toISOString());
  }
  // Añadir al scope de sesión si no estaba (isApprovedForSession exige igualdad
  // exacta de scope: un OPPLAN aprobado queda inválido hasta re-aprobar).
  const scope = Array.isArray(s.scope) ? s.scope.slice() : [];
  const wasInScope = scope.some((e) => { const x = String(e || '').trim().toLowerCase(); return x === v.value || (x.startsWith('*.') && v.value.endsWith('.' + x.slice(2))); });
  let addedToScope = false;
  if (!wasInScope) { scope.push(v.value); s.scope = scope; db.saveSession(s.id, s); netMod.setScope(s.scope); addedToScope = true; }
  const planInvalidated = Boolean(addedToScope && s.opplan && s.opplan.status === 'aprobado');
  if (planInvalidated) { s.opplan.status = 'borrador'; db.saveSession(s.id, s); }
  res.json({ ok: true, sent: 'targets', target: v.value, already: Boolean(existing && !addedToScope), addedToScope, planInvalidated });
});

router.post('/osint/findings/send-to-repeater', (req, res) => {
  const s = getSession();
  const v = osintSendableFinding(s, req.body?.id);
  if (v.error) return res.status(400).json({ ok: false, error: v.error });
  const blocked = osintScopeBlocked(s, v.value);
  if (blocked) return res.status(400).json({ ok: false, error: blocked });
  const raw = 'GET / HTTP/1.1\r\nHost: ' + v.value + '\r\nAccept: */*\r\nUser-Agent: ' + (s.user_agent || netMod.getUA()) + '\r\nConnection: close';
  res.json({ ok: true, sent: 'repeater', target: v.value, url: 'https://' + v.value, raw });
});
// ── Proxy MITM local (interceptor + historial + replay) ────────────────────
router.get('/proxy/status', (req, res) => res.json(proxyMod.status()));
router.post('/proxy/start', async (req, res) => { try { const p = Number(req.body?.port); res.json(await proxyMod.start({ port: Number.isFinite(p) && p >= 0 ? p : 8083 })); } catch (e) { res.status(400).json({ ok: false, error: e.message }); } });
router.post('/proxy/stop', (req, res) => { const s = getSession(); res.json(proxyMod.stop({ sessionId: s.id })); });
router.post('/proxy/intercept', (req, res) => res.json(proxyMod.setIntercept(Boolean(req.body?.on))));
router.post('/proxy/strict', (req, res) => res.json(proxyMod.setStrict(req.body?.enabled !== undefined ? Boolean(req.body.enabled) : Boolean(req.body?.on))));
router.post('/proxy/scope', (req, res) => res.json(proxyMod.setScope(Array.isArray(req.body?.scope) ? req.body.scope : [])));
router.get('/proxy/history', (req, res) => res.json(proxyMod.history({ limit: Number(req.query.limit) || 100, q: String(req.query.q || '') })));
router.get('/proxy/history/:id', (req, res) => { const e = proxyMod.historyEntry(req.params.id); if (!e) return res.status(404).json({ ok: false, error: 'entrada no encontrada' }); res.json(e); });
router.get('/proxy/pending', (req, res) => res.json(proxyMod.pendingList()));
router.post('/proxy/pending/:id/resolve', (req, res) => res.json(proxyMod.resolvePending(req.params.id, req.body || {})));
router.post('/proxy/replay/:id', async (req, res) => { try { res.json(await proxyMod.replay(Number(req.params.id), { raw: req.body?.raw || null })); } catch (e) { res.status(400).json({ ok: false, error: e.message }); } });
// ── Scanner pasivo del proxy ────────────────────────────────────────────────
router.get('/proxy/scanner', (req, res) => res.json(proxyMod.scannerStatus()));
router.post('/proxy/scanner', (req, res) => res.json(proxyMod.scannerToggle(Boolean(req.body?.enabled))));
router.post('/proxy/scanner/flush', (req, res) => { const s = getSession(); res.json(proxyMod.scannerFlush(s.id)); });
router.get('/proxy/ca.crt', (req, res) => {
  const ca = proxyMod.ensureCA();
  res.setHeader('Content-Type', 'application/x-x509-ca-cert');
  res.setHeader('Content-Disposition', 'attachment; filename="knk-mitm-ca.crt"');
  res.send(ca.certPem);
});
router.get('/osint/findings/export', (req, res) => {
  const format = ['json', 'csv', 'md'].includes(req.query.format) ? req.query.format : 'json';
  const out = osintFindings.exportFindings({ format });
  res.setHeader('Content-Type', out.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
  res.send(out.body);
});
router.get('/osint/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q requerido' });
  const sources = String(req.query.sources || 'shodan,geoip').split(',').map(s => s.trim()).filter(Boolean);
  try { res.json(await osint.unifiedSearch(q, sources)); }
  catch (e) { res.json({ error: e.message, results: [] }); }
});
router.get('/osint/cameras', async (req, res) => {
  const { country, lat, lon, radius } = req.query;
  try { res.json(await cameraIndex.searchIndexedCameras({ country: country || '', lat: lat ? Number(lat) : null, lon: lon ? Number(lon) : null, radius: radius ? Number(radius) : 50 })); }
  catch (e) { res.json({ error: e.message, cameras: [] }); }
});
router.get('/osint/people', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q requerido' });
  try { res.json(await osint.peopleSearch(q)); }
  catch (e) { res.json({ error: e.message, results: [] }); }
});
router.get('/osint/shodan/host/:ip', async (req, res) => {
  try { res.json(await osint.shodanHost(req.params.ip)); }
  catch (e) { res.json({ error: e.message }); }
});

// Auditoría defensiva solo contra un host/CIDR privado autorizado. No se
// conecta a IPs públicas, no prueba credenciales y no intenta explotar cámaras.
router.post('/osint/camera-audit', async (req, res) => {
  try {
    const result = await auditLocalCameraNetwork(req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ── Jobs ─────────────────────────────────────────────────────────────
const JOB_ACTIONS = {
  'v6-openai': { name: 'V6 OpenAI probe', command: 'node backend/openai-v6-probe.js', cwd: path.join(__dirname, '..') },
  'recon-cloudflare': { name: 'Recon Cloudflare', command: 'node backend/cloudflare-recon.js', cwd: path.join(__dirname, '..') },
  'e16-cloudflare': { name: 'E16 Cloudflare Playground', command: 'node backend/cloudflare-e16-playground.js', cwd: path.join(__dirname, '..') },
};
router.get('/jobs', (req, res) => res.json({ jobs: jobs.listJobs() }));
router.post('/jobs/run', (req, res) => {
  const { action, command } = req.body || {};
  const spec = action && JOB_ACTIONS[action];
  if (!spec && !command) return res.status(400).json({ error: 'action o command requerido' });
  try {
    if (spec) {
      const job = jobs.runCommand(spec.command, { name: spec.name, cwd: spec.cwd });
      return res.json({ ok: true, job });
    }
    const authMod = require('./lib/auth');
    const reason = authMod.validateCommand(command);
    if (reason) return res.status(400).json({ ok: false, error: `Comando bloqueado: ${reason}` });
    res.json({ ok: true, job: jobs.runCommand(command, { name: 'custom' }) });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
router.get('/jobs/:id', (req, res) => res.json(jobs.getJob(req.params.id) || { error: 'job no encontrado' }));
router.post('/jobs/:id/cancel', (req, res) => res.json(jobs.cancelJob(req.params.id)));

// ── Centro de notificaciones ───────────────────────────────────────
router.get('/alerts', (req, res) => {
  try { res.json({ ok: true, alerts: require('./lib/alert-hub').history(100) }); }
  catch (e) { res.json({ ok: false, error: e.message, alerts: [] }); }
});
router.delete('/alerts', (req, res) => {
  try { require('./lib/alert-hub').clear(); res.json({ ok: true, alerts: [] }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

// ── Terminal persistente ───────────────────────────────────────────
router.get('/terminal/sessions', (req, res) => {
  try { res.json({ ok: true, sessions: require('./lib/pty-manager').stats() }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

// ── Vault / modelos / asistente ─────────────────────────────────────
router.get('/vault/stats', (req, res) => res.json(vault.stats()));
router.get('/vault/search', (req, res) => res.json(vault.search(String(req.query.q || ''))));
router.post('/vault/rebuild', (req, res) => res.json(vault.rebuild()));
router.get('/models/installed', async (req, res) => res.json(await models.listInstalled()));
router.get('/models/catalog', async (req, res) => res.json(await models.listCatalog()));
router.get('/models/routes', (req, res) => res.json(models.loadRoutes()));
router.post('/models/routes', (req, res) => res.json({ ok: true, routes: models.saveRoutes(req.body || {}) }));
router.post('/models/pull', async (req, res) => {
  const { model } = req.body || {};
  if (!model || !/^[a-z0-9._:-]+$/i.test(model)) return res.status(400).json({ ok: false, error: 'modelo inválido' });
  res.json(await models.pull(model));
});
router.get('/assistant/status', async (req, res) => res.json(await assistant.status()));
router.post('/assistant/talk', async (req, res) => {
  const { prompt, mode, model, useVault, useMemory, history } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt requerido' });
  const s = getSession();
  try { res.json(await assistant.talk({ prompt, mode, model, sessionId: s.id, useVault, useMemory, history })); }
  catch (e) { res.json({ text: '', offline: true, error: e.message, mode: mode || 'chat' }); }
});
// Stream del asistente (SSE): eventos delta/tools/done/error. La sesión se
// fija ANTES de emitir: el orden de cabeceras SSE es estable y el cierre
// siempre ocurre (no se cuelga la UI si el LLM muere a mitad).
const assistantTools = require('./lib/assistant-tools');
router.post('/assistant/stream', async (req, res) => {
  const { prompt, mode, model, useVault, useMemory, history } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt requerido' });
  const s = getSession();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event) => {
    try { res.write('data: ' + JSON.stringify(event) + '\n\n'); } catch {}
  };
  try {
    await assistantTools.talkStream(
      { prompt, mode, model, sessionId: s.id, useVault, useMemory, history },
      send
    );
  } catch (e) {
    send({ type: 'error', error: e.message });
  }
  try { res.end(); } catch {}
});
router.get('/memory', (req, res) => res.json({ items: assistant.listMemory(getSession().id) }));
router.post('/memory', (req, res) => {
  const { key, value } = req.body || {};
  if (!value) return res.status(400).json({ ok: false, error: 'value requerido' });
  res.json({ ok: true, ...assistant.addMemory(getSession().id, key, value) });
});
router.delete('/memory/:id', (req, res) => res.json(assistant.deleteMemory(getSession().id, req.params.id)));
router.get('/llm/status', async (req, res) => res.json(await llmMod.status()));
router.post('/llm/chat', async (req, res) => {
  const { prompt, system, model, useVault, mode: reqMode } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt requerido' });
  const mode = reqMode || detectMode(prompt || '');
  let vaultContext = '';
  let sources = [];
  if (useVault !== false) {
    try { const c = vault.buildContext(prompt, 8); vaultContext = c.context; sources = c.sources; } catch {}
  }
  const sys = system || getSystemPrompt(mode, vaultContext);
  try { res.json({ ...(await llmMod.generate(prompt, { system: sys, model })), sources, mode }); }
  catch (e) { res.json({ ok: false, error: e.message, text: '', mode }); }
});

// ── Sesión / target / OPPLAN ────────────────────────────────────────
router.get('/status', async (req, res) => {
  const s = getSession();
  const llm = await llmMod.status().catch(() => ({ up: false, model: null }));
  res.json({ ok: true, up: llm.up, checkedAt: new Date().toISOString(), session: { target: s.target, scope: s.scope, program: s.program_name || null, opplan: s.opplan?.nombre ? { nombre: s.opplan.nombre, status: s.opplan.status } : null, findings: db.getFindings(s.id).length, phases: s.phases }, ollama: { up: llm.up, model: llm.model, models: llm.models || [] } });
});
router.get('/session', (req, res) => { const s = getSession(); res.json({ ...s, findings: db.getFindings(s.id) }); });
router.get('/findings', (req, res) => {
  // ?scope=all → todas las sesiones con programa resuelto (el Dashboard cuenta
  // global; sin esto el panel solo ve la sesión actual y los medium "desaparecen").
  if (req.query.scope === 'all') return res.json(db.getAllFindings());
  const s = getSession(); res.json(db.getFindings(s.id));
});

// Triaje de un hallazgo (estado + severidad + nota). Global por id para poder
// triar desde la vista "todas las sesiones".
router.post('/findings/:id/triage', (req, res) => {
  const b = req.body || {};
  const r = db.triageFinding(req.params.id, { status: b.status, severity: b.severity, note: b.note });
  if (!r.ok) return res.status(r.error === 'hallazgo no encontrado' ? 404 : 400).json(r);
  res.json(r);
});

// ── Cookie-jar: sesiones del operador (caza autenticada sin pegar secretos)
// La API nunca devuelve valores de cookies, solo inventario.
const cookieJar = require('./lib/cookie-jar');
router.get('/session/cookies', (req, res) => res.json({ ok: true, hosts: cookieJar.hosts() }));
router.post('/session/cookies', (req, res) => {
  const b = req.body || {};
  res.json(cookieJar.set(b.host, b.cookie));
});
router.delete('/session/cookies/:host', (req, res) => res.json(cookieJar.remove(req.params.host)));
router.post('/session/cookies/import-firefox', async (req, res) => {
  const b = req.body || {};
  res.json(await cookieJar.importFirefox(b.profile, b.hosts));
});

// ── Borrador de reporte desde Hallazgos filtrados ───────────────────────────
// El cliente envía SOLO los ids visibles tras sus filtros (severidad, tipo,
// búsqueda) + la atestación del operador. El backend vuelve a leer los
// hallazgos de la sesión (nunca acepta contenido de hallazgos del cliente),
// deriva el meta y llama a report.generateReport(). Las compuertas se
// atestan aquí: sin atestación no hay borrador (el gate es explícito, no
// implícito). El resultado se guarda como reporte 'borrador' y se devuelve
// el markdown + json + slug para re-generar/editar.
router.post('/findings/draft-report', (req, res) => {
  const s = getSession();
  const b = req.body || {};
  const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Number.isInteger) : [];
  if (!ids.length) return res.status(400).json({ ok: false, error: 'ids requerido: envía los hallazgos visibles tras tus filtros' });
  const attest = b.attestation && typeof b.attestation === 'object' ? b.attestation : null;
  if (!attest) return res.status(400).json({ ok: false, error: 'atestación del operador requerida (compuertas rep-1..rep-10)' });
  if (attest.humanReview !== true || String(attest.reviewNote || '').trim().length < 20) {
    return res.status(400).json({ ok: false, error: 'revisión humana obligatoria: humanReview:true + reviewNote (≥20 caracteres)' });
  }

  const all = db.getFindings(s.id);
  const byId = new Map(all.map((f) => [f.id, f]));
  const selected = ids.map((id) => byId.get(id)).filter(Boolean);
  if (!selected.length) return res.status(400).json({ ok: false, error: 'ninguno de los ids existe en esta sesión' });

  const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  selected.sort((a, b2) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b2.severity] ?? 9));
  const top = selected[0];

  const meta = {
    // Identidad del reporte: el hallazgo de mayor severidad da el título/tipo;
    // el resto se listan como hallazgos asociados en impacto y pasos.
    title: (b.title || top.summary).slice(0, 120),
    program: b.program || s.artifacts?.programName || s.target || '—',
    asset: b.asset || top.details?.asset || top.details?.url || s.target || '—',
    bugType: b.bugType || top.type || '—',
    cwe: b.cwe || top.details?.cwe || '—',
    cvss: b.cvss || top.details?.cvss || '—',
    severity: b.severity || top.severity || 'info',
    impact: b.impact || selected.map((f) => `• [${f.severity}] ${f.summary}`).join('\n') || 'PENDIENTE',
    remediation: b.remediation || 'PENDIENTE — revisar por hallazgo antes de enviar',
    steps: selected.map((f, i) => `${i + 1}. [${f.type}] ${f.summary} — ${f.details?.url || f.details?.asset || 'sin URL'}`),
    evidence: selected.map((f) => `${f.details?.evidence ? 'evidencia ' + f.details.evidence : 'pendiente de adjuntar'} (#${f.id})`),
    inScope: netMod.inScope(top.details?.asset || top.details?.url || s.target),
    noDuplicate: attest.noDuplicate === true,
    notDisqualifier: attest.notDisqualifier === true,
    exploitable: attest.exploitable === true,
    evidenceScreenshots: attest.evidenceScreenshots === true,
    evidenceRequestResponse: attest.evidenceRequestResponse === true,
    pocMinimal: attest.pocMinimal === true,
    noPII: attest.noPII === true,
    humanReview: attest.humanReview === true,
    reviewNote: String(attest.reviewNote || ''),
    reproducibleCount: Number(attest.reproducibleCount || 0),
    severityHonest: true,
    programUrl: s.artifacts?.programUrl || '',
    scopeDocumentado: (s.scope || []).join(', '),
    userAgent: s.artifacts?.userAgent || '—',
  };

  const rep = reportMod.generateReport(meta);
  if (!rep.allowed) return res.json({ ok: false, error: 'compuertas bloqueantes', blockers: rep.blockers });

  // Slug determinista por sesión+selección: re-generar los mismos ids
  // ACTUALIZA el mismo borrador (saveReport hace upsert por slug) en vez de
  // duplicar. djb2 sobre los ids ordenados — sin depender del timestamp que
  // generateReport pone dentro del id del reporte.
  let h = 5381;
  for (const c of ids.slice().sort((a, b2) => a - b2).join(',')) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
  const slug = b.slug || ('hallazgos-' + s.id + '-' + h.toString(36));
  db.saveReport(s.id, slug, rep.json, 'borrador');
  res.json({ ok: true, slug, id: rep.json.id, json: rep.json, report: rep.report });
});
router.post('/target', (req, res) => {
  const s = getSession();
  const { target, scope, userAgent, rateLimitMs, programUrl, programPolicy } = req.body || {};
  if (target && String(target).trim().toLowerCase() === 'x.onion') return res.status(400).json({ ok: false, error: 'host no permitido como target' });
  if (target) s.target = target;
  if (scope) s.scope = Array.isArray(scope) ? scope : String(scope).split(',').map(x => x.trim()).filter(Boolean);
  if (userAgent) s.user_agent = userAgent;
  if (rateLimitMs) s.rate_limit_ms = parseInt(rateLimitMs, 10);
  if (programUrl) s.program_url = programUrl;
  if (programPolicy) s.program_policy = programPolicy;
  netMod.setScope(s.scope); if (s.user_agent) netMod.setUA(s.user_agent); if (s.rate_limit_ms) netMod.setRateLimit(s.rate_limit_ms);
  db.saveSession(s.id, s);
  res.json({ ok: true, target: s.target, scope: s.scope, outOfScope: s.out_of_scope, userAgent: s.user_agent });
});
router.get('/opplan', (req, res) => res.json(getSession().opplan));
router.post('/opplan', (req, res) => {
  const s = getSession();
  s.opplan = { ...s.opplan, ...(req.body || {}), fecha: new Date().toISOString() };
  db.saveSession(s.id, s);
  res.json({ ok: true, opplan: s.opplan });
});
router.post('/opplan/approve', (req, res) => {
  const s = getSession();
  if (!s.opplan || !s.opplan.nombre) return res.status(400).json({ ok: false, error: 'No hay OPPLAN' });
  s.opplan.status = 'aprobado'; s.opplan.aprobadoEn = new Date().toISOString();
  db.saveSession(s.id, s);
  // Briefing: el asistente conoce el plan aprobado (memoria persistente por sesión)
  try {
    const resumen = `${s.opplan.nombre || 'OPPLAN'} — objetivo: ${s.target || 'n/d'}; scope: ${(s.scope || []).join(', ') || 'n/d'}; fases: ${(s.opplan.fases || []).map((f) => f.nombre || f.id || '?').join(', ') || 'n/d'}`;
    assistant.addMemory(s.id, 'opplan', resumen);
  } catch {}
  res.json({ ok: true, opplan: s.opplan, briefing: true });
});
router.post('/parse-program', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ ok: false, error: 'URL requerida' });
  try {
    const parsed = await programParser.parseProgram(url);
    const s = getSession();
    s.target = parsed.target; s.scope = parsed.domains; s.out_of_scope = parsed.outOfScope;
    s.program_url = parsed.programUrl; s.program_name = parsed.programName; s.program_policy = parsed.policy;
    s.artifacts = { ...s.artifacts, userAgent: parsed.userAgent, rateLimit: parsed.rateLimit, rewards: parsed.rewards, source: parsed.source, autoParsed: parsed.autoParsed !== false };
    db.saveSession(s.id, s); netMod.setScope(parsed.domains); if (parsed.userAgent) netMod.setUA(parsed.userAgent); netMod.setRateLimit(parsed.rateLimit);
    res.json({ ok: true, parsed });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ── Pipeline / superficie / reportes ─────────────────────────────────
router.get('/pipeline/phases', (req, res) => res.json(require('./lib/pipeline').getPhases()));
router.post('/pipeline/run', async (req, res) => {
  const { phase: phaseId, ...params } = req.body || {};
  if (!phaseId) return res.status(400).json({ ok: false, error: 'phase requerido' });
  const s = getSession();
  const ctx = { session: s, save: () => db.saveSession(s.id, s), addFinding: (f) => db.addFinding(s.id, f.type, f.summary, f.severity, f.details || {}), setArtifact: (k, v) => { s.artifacts[k] = v; }, setPhase: (id, d) => { s.phases[id] = d; } };
  try { const result = await require('./lib/pipeline').runPhase(ctx, phaseId, params); db.saveSession(s.id, s); res.json(result); }
  catch (e) { res.json({ phase: phaseId, ok: false, error: e.message, output: null, findings: [] }); }
});
router.post('/pipeline/full', async (req, res) => {
  const s = getSession(); const target = req.body?.target || s.target;
  if (!target) return res.status(400).json({ ok: false, error: 'Sin target' });
  const ctx = { session: s, save: () => db.saveSession(s.id, s), addFinding: (f) => db.addFinding(s.id, f.type, f.summary, f.severity, f.details || {}), setArtifact: (k, v) => { s.artifacts[k] = v; }, setPhase: (id, d) => { s.phases[id] = d; } };
  const result = await require('./lib/pipeline').runFullPipeline(ctx, target); db.saveSession(s.id, s); res.json(result);
});
router.post('/pipeline/local', (req, res) => res.json(localPipeline.runLocalPipeline(getSession(), req.body || {})));
router.post('/surface/map', async (req, res) => { try { res.json(await surfaceMap.mapSurface(getSession().target, req.body || {})); } catch (e) { res.status(400).json({ ok: false, error: e.message }); } });
router.get('/reports', (req, res) => res.json(db.getReports(getSession().id)));
// Plantillas por plataforma (secciones + recordatorios del formulario).
router.get('/reports/templates', (req, res) => res.json({ ok: true, platforms: ['bugcrowd', 'hackerone', 'intigriti', 'yeswehack'] }));
router.get('/reports/templates/:platform', (req, res) => res.json({ ok: true, template: require('./lib/report').platformTemplate(req.params.platform) }));
router.post('/reports/save', (req, res) => { const s = getSession(); const id = db.saveReport(s.id, req.body?.slug || 'draft', req.body?.data || {}, req.body?.status || 'borrador'); res.json({ ok: true, id }); });
router.post('/reports/update', (req, res) => { db.stmts.updateReport.run(JSON.stringify(req.body?.data || {}), req.body?.status || 'borrador', req.body?.id); res.json({ ok: true }); });
router.post('/reports/verify', async (req, res) => res.json(await verifierMod.verifyReport(req.body?.data || {}, { llm: llmMod })));
router.post('/reports/open-triage', (req, res) => res.json(gates.reportReadiness(req.body?.data || {})));
router.post('/mission/close', (req, res) => { const s = getSession(); res.json(closeMission.scaffold({ session: s, findings: db.getFindings(s.id), overwrite: !!req.body?.overwrite })); });
router.post('/evidence', (req, res) => {
  const { name, data, type } = req.body || {};
  if (!name || !data) return res.status(400).json({ ok: false, error: 'name y data requeridos' });
  const dir = path.join(os.homedir(), '.knk-suite', 'evidencia'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}_${String(name).replace(/[^a-zA-Z0-9._-]/g, '_')}`);
  fs.writeFileSync(file, type === 'binary' ? Buffer.from(data, 'base64') : data);
  db.stmts.insertEvidence.run(getSession().id, null, name, type || 'text', file); res.json({ ok: true, file });
});
router.get('/evidence', (req, res) => res.json(db.stmts.getEvidence.all(getSession().id)));
// Descarga autenticada de un fichero de evidencia (solo dentro de ~/.knk-suite/evidencia)
router.get('/evidence/download', (req, res) => {
  const p = path.resolve(String(req.query.path || ''));
  const dir = path.join(os.homedir(), '.knk-suite', 'evidencia');
  if (!p.startsWith(dir + path.sep)) return res.status(403).json({ ok: false, error: 'ruta fuera de evidencia' });
  if (!fs.existsSync(p)) return res.status(404).json({ ok: false, error: 'fichero no encontrado' });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${path.basename(p)}"`);
  res.send(fs.readFileSync(p));
});

// ── Gates / compliance / browser / dorks / Docker ───────────────────
router.post('/gates/validate', (req, res) => {
  const { type, ...input } = req.body || {};
  const fn = { cors: gates.corsChain, idor: gates.idorChain, ssrf: gates.ssrfChain, xss: gates.xssChain, sub: gates.subdomainChain, sqli: gates.sqliChain, revocation: gates.revocationChain, biz: gates.bizChain, alta: gates.altaChain }[type];
  if (!fn) return res.status(400).json({ ok: false, error: `Tipo desconocido: ${type}` });
  res.json(fn(input));
});
router.get('/dorks/categories', (req, res) => res.json({ categories: dorks.categories() }));
router.post('/dorks/generate', (req, res) => res.json(dorks.generateCategory(req.body?.domain || getSession().target || '', req.body?.category)));
router.get('/browser/estado', async (req, res) => res.json(await browser.paginaActual().catch(() => ({ vivo: false }))));
router.post('/browser/navegar', async (req, res) => { try { res.json(await browser.navegar(req.body?.url, req.body?.captura !== false)); } catch (e) { res.status(400).json({ ok: false, error: e.message }); } });
router.get('/docker/status', (req, res) => res.json(docker.status()));
router.get('/terminal/log', (req, res) => res.json(db.getTerminalLog(getSession().id)));
router.get('/compliance', (req, res) => { try { res.json(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'compliance-ywh.json'), 'utf8'))); } catch { res.status(500).json({ error: 'Compliance no disponible' }); } });
router.get('/targets/status', (req, res) => res.json({ ok: true, session: getSession() }));
router.get('/canary/status', (req, res) => res.json({ ok: false, active: false, note: 'canario no iniciado' }));
router.get('/bidi/status', (req, res) => res.json({ ok: false, active: false, note: 'BiDi no iniciado' }));
router.post('/revocation/plan', (req, res) => res.json(revocation.plan(req.body || {})));
router.post('/revocation/analyze', (req, res) => res.json(revocation.analyze(req.body || {})));

// ── LILIGO ESP32 ───────────────────────────────────────────────────
const liligo = require('./lib/liligo');

router.get('/liligo/detect', async (req, res) => {
  try {
    const device = await liligo.detect();
    const allPorts = await liligo.detectAll();
    res.json({ ok: true, device, allPorts });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.post('/liligo/connect', async (req, res) => {
  try {
    const { path: devicePath, baud } = req.body;
    await liligo.connect(devicePath, baud);
    const info = await liligo.getInfo();
    res.json({ ok: true, info });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.get('/liligo/info', async (req, res) => {
  try {
    const info = await liligo.getInfo();
    res.json({ ok: true, info });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.post('/liligo/scan/wifi', async (req, res) => {
  try {
    const networks = await liligo.scanWiFi();
    res.json({ ok: true, networks });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.post('/liligo/scan/ble', async (req, res) => {
  try {
    const devices = await liligo.scanBLE();
    res.json({ ok: true, devices });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.post('/liligo/scan/lora', async (req, res) => {
  try {
    const { frequency } = req.body;
    const packets = await liligo.scanLoRa(frequency);
    res.json({ ok: true, packets });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.post('/liligo/ir/send', async (req, res) => {
  try {
    const { signal } = req.body;
    const result = await liligo.sendIR(signal);
    res.json({ ok: true, result });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.post('/liligo/ir/learn', async (req, res) => {
  try {
    const result = await liligo.learnIR();
    res.json({ ok: true, result });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.post('/liligo/rfid/send', async (req, res) => {
  try {
    const { type, data } = req.body;
    const result = await liligo.sendRFID(type, data);
    res.json({ ok: true, result });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.post('/liligo/command', async (req, res) => {
  try {
    const { command } = req.body;
    const result = await liligo.sendCommand(command);
    res.json({ ok: true, result });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.post('/liligo/disconnect', (req, res) => {
  liligo.disconnect();
  res.json({ ok: true });
});

// ── Findings Export ─────────────────────────────────────────────────

// Los hallazgos viven en la tabla `findings`. Estas rutas leían antes
// `sessions.findings`, una columna que no existe: el export salía siempre
// vacío y el borrado lanzaba error de SQL. Los módulos (cámaras expuestas,
// nuclei, pipeline) crean los suyos; aquí también se puede dar de alta uno.

function findingRow(f) {
  const details = f && typeof f.details === 'object' && f.details ? f.details : {};
  return {
    id: f.id,
    type: f.type,
    summary: f.summary,
    severity: f.severity,
    asset: details.asset || details.url || '',
    cves: Array.isArray(details.vulns) ? details.vulns : [],
    evidence: Array.isArray(details.evidence) ? details.evidence : [],
    details,
  };
}

// ── Repeater (cliente HTTP manual estilo Burp) ──────────────────────────────
// Envío manual de una petición cruda: scope obligatorio, limiter global
// (>=800 ms entre peticiones, lo aplica net.fetch), maxRedirects=0 por
// defecto para inspeccionar redirecciones en crudo.
router.post('/repeater/send', async (req, res) => {
  try {
    const { raw, maxRedirects } = req.body || {};
    if (typeof raw !== "string" || !raw.trim()) return res.status(400).json({ ok: false, error: "raw requerido" });
    const s = getSession();
    const r = await repeater.sendRaw(s, raw, { maxRedirects });
    if (!r.ok) return res.status(400).json(r);
    res.json({ ok: true, send: r.send });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Convertir un envío del Repeater en hallazgo de la misión
router.post('/repeater/finding', (req, res) => {
  try {
    const { send, note } = req.body || {};
    if (!send || !send.url || !send.method) return res.status(400).json({ ok: false, error: "send requerido" });
    const s = getSession();
    const f = repeater.toFinding(s.id, send, note);
    res.json({ ok: true, finding: f });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/findings', (req, res) => {
  const { type, summary, severity, details } = req.body || {};
  if (!summary) return res.status(400).json({ ok: false, error: 'summary requerido' });
  const s = getSession();
  const r = db.addFinding(s.id, type || 'manual', String(summary), severity || 'info', details || {});
  // Etiqueta con el engagement activo (ciclo proyecto → hallazgo → reporte).
  try {
    const eng = db.getActiveEngagementId(s) || req.body?.engagement_id || null;
    if (eng) db.stmts.setFindingEngagement.run(String(eng), r.lastInsertRowid);
  } catch {}
  res.json({ ok: true, id: r.lastInsertRowid, total: db.getFindings(s.id).length });
});

// ── Engagements (proyectos): agrupan targets, scope, hallazgos y ciclo ──
router.get('/engagements', (req, res) => res.json({ ok: true, engagements: db.listEngagements() }));
router.post('/engagements', (req, res) => {
  const b = req.body || {};
  const r = db.createEngagement({ name: b.name, platform: b.platform, program_url: b.program_url, scope: b.scope, out_of_scope: b.out_of_scope, notes: b.notes });
  if (!r.ok) return res.status(400).json(r);
  res.json(r);
});
router.post('/engagements/:id/activate', (req, res) => {
  const s = getSession();
  res.json(db.activateEngagement(s.id, req.params.id));
});
router.post('/engagements/:id/close', (req, res) => {
  const e = db.stmts.getEngagement.get(String(req.params.id || ''));
  if (!e) return res.status(404).json({ ok: false, error: 'engagement no encontrado' });
  db.stmts.updateEngagement.run(e.name, e.platform, e.program_url, 'cerrado', e.scope, e.out_of_scope, e.notes || '', e.id);
  res.json({ ok: true, id: e.id, status: 'cerrado' });
});
router.get('/engagements/:id/findings', (req, res) => {
  res.json(db.stmts.findingsByEngagement.all(String(req.params.id || '')).map((f) => ({
    ...f, details: typeof f.details === 'string' ? JSON.parse(f.details || '{}') : f.details || {},
  })));
});

// ── Param Hunter: caza de parámetros reflejados (Top-25 XSS / BAC) ─────────
// Caza SOLO autorizada: scope obligatorio de la sesión (como el Repeater),
// canario alfanumérico inofensivo (sin payloads), limiter global de net.fetch.
router.get('/params/wordlists', (req, res) => {
  res.json({ ok: true, wordlists: paramHunter.wordlists() });
});

router.post('/params/hunt', async (req, res) => {
  const { url, wordlist, limit, maxParams, useHistory, mode, headers } = req.body || {};
  if (typeof url !== 'string' || !url.trim()) return res.status(400).json({ ok: false, error: 'url requerida' });
  const session = getSession();
  try {
    // Priorizar parámetros vistos en tráfico real (historial del proxy del
    // mismo host) salvo que el cliente lo desactive con useHistory: false.
    let historyParams = [];
    let bodyParams = [];
    if (useHistory !== false) {
      try {
        let hostname = '';
        try { hostname = new URL(url).hostname; } catch { /* url ya validada dentro */ }
        historyParams = proxyMod.historyParams({ host: hostname, limit: 60 });
        if (mode === 'form') bodyParams = proxyMod.historyBodyParams({ host: hostname, limit: 60 });
      } catch { historyParams = []; bodyParams = []; }
    }
    const r = await paramHunter.hunt({ url, wordlist, limit: Number(limit) || 25, maxParams: Number(maxParams) || 40, scope: session.scope, historyParams, mode, bodyParams, headers });
    if (!r.ok) return res.json({ ok: false, error: r.error });
    // sqli_error = evidencia objetiva (error de BD con firma): hallazgo automático
    // (reflected/param_exists siguen siendo manuales; redirect_param se valida a mano)
    for (const row of r.results || []) {
      if (row.behavior !== 'sqli_error' || row.priority !== 'P1') continue;
      try {
        db.addFinding(session.id, 'PARAM-HUNTER',
          `[ParamHunter] ${row.param} (sqli_error · ${row.context || 'n/a'}) en ${String(url).slice(0, 120)}`,
          'high',
          { url, param: row.param, behavior: 'sqli_error', context: row.context || '', priority: 'P1', detail: row.detail || '', source: 'param-hunter', asset: url });
      } catch { /* nunca romper la caza por un finding */ }
    }
    res.json(r);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Convierte un resultado de la caza en hallazgo de la misión
router.post('/params/finding', (req, res) => {
  const { url, param, behavior, context, priority, detail } = req.body || {};
  if (!url || !param) return res.status(400).json({ ok: false, error: 'url y param requeridos' });
  if (!['reflected', 'encoded', 'partial', 'param_exists', 'sqli_error', 'redirect_param'].includes(behavior)) {
    return res.status(400).json({ ok: false, error: 'behavior inválido' });
  }
  const s = getSession();
  const sev = behavior === 'sqli_error' ? 'high'
    : behavior === 'redirect_param' ? 'medium'
    : behavior === 'reflected' ? (priority === 'P1' ? 'high' : priority === 'P2' ? 'medium' : 'low')
    : 'info';
  const r = db.addFinding(s.id, 'PARAM-HUNTER', `[ParamHunter] ${param} (${behavior} · ${context || 'n/a'}) en ${String(url).slice(0, 120)}`, sev, {
    url, param, behavior, context, priority: priority || null, detail: detail || '', source: 'param-hunter', asset: url,
  });
  res.json({ ok: true, id: r.lastInsertRowid });
});

// Facetado unificado de hallazgos (OSINT + pipeline) de la sesión: cuenta por
// herramienta, tipo y ocurrencias. Alimenta los filtros del Dashboard.
router.get('/findings/facets', (req, res) => {
  const session = getSession();
  const findings = db.getFindings(session.id);
  const osint = [];
  const proxy = [];
  const pipeline = [];
  const originOf = (f) => {
    const d = f.details || {};
    if (d.osint) return 'osint';
    if (d.proxyScan || d.source === 'proxy-scanner' || f.type === 'PROXY-SCAN') return 'proxy';
    return 'pipeline';
  };
  for (const f of findings) {
    const o = originOf(f);
    if (o === 'osint') osint.push(f); else if (o === 'proxy') proxy.push(f); else pipeline.push(f);
  }
  const tally = (arr, pick) => {
    const m = new Map();
    for (const f of arr) { const k = pick(f) || '(sin datos)'; m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
  };
  res.json({
    ok: true,
    total: findings.length,
    osint: { count: osint.length, byTool: tally(osint, (f) => f.details.osint.tool), byType: tally(osint, (f) => f.type) },
    proxy: { count: proxy.length, byType: tally(proxy, (f) => (f.details && f.details.type) || f.type), bySeverity: tally(proxy, (f) => f.severity) },
    pipeline: { count: pipeline.length, byType: tally(pipeline, (f) => f.type), bySeverity: tally(pipeline, (f) => f.severity) },
  });
});

// Export UNIFICADO (OSINT + pipeline) en JSON / CSV / Markdown. Cada fila lleva
// origin: 'osint' | 'pipeline'. Para OSINT conserva tool/type/value/target/
// occurrences/lastSeenAt; para pipeline, summary/asset/severity.
router.get('/findings/export/unified', (req, res) => {
  const format = ['json', 'csv', 'md'].includes(req.query.format) ? req.query.format : 'json';
  const session = getSession();
  const now = new Date().toISOString();
  const rows = db.getFindings(session.id).map((f) => {
    const d = f.details || {};
    if (d.osint) {
      return {
        origin: 'osint', id: f.id, type: f.type, tool: d.osint.tool,
        value: d.asset || '', summary: f.summary, severity: f.severity,
        target: d.osint.target || '', occurrences: d.osint.occurrences || 1,
        lastSeenAt: d.osint.lastSeenAt || null, asset: d.asset || '',
      };
    }
    if (d.proxyScan || d.source === 'proxy-scanner' || f.type === 'PROXY-SCAN') {
      return {
        origin: 'proxy', id: f.id, type: d.type || f.type, tool: d.source || 'proxy-scanner',
        value: d.asset || d.url || '', summary: f.summary, severity: f.severity,
        target: session.target || '', occurrences: 1,
        lastSeenAt: (d.proxyScan && (d.proxyScan.lastSeenAt || d.proxyScan.firstSeenAt)) || f.created_at || null,
        asset: d.asset || d.url || '',
      };
    }
    return {
      origin: 'pipeline', id: f.id, type: f.type, tool: d.source || 'pipeline',
      value: d.asset || d.url || '', summary: f.summary, severity: f.severity,
      target: session.target || '', occurrences: 1, lastSeenAt: f.created_at || null,
      asset: d.asset || d.url || '',
    };
  });
  if (format === 'csv') {
    const headers = ['origin', 'id', 'tool', 'type', 'value', 'severity', 'occurrences', 'lastSeenAt', 'summary'];
    const cell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const body = [headers.join(',')].concat(rows.map((r) => headers.map((h) => cell(r[h])).join(','))).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="findings-unified.csv"');
    return res.send(body);
  }
  if (format === 'md') {
    const lines = [
      '# Hallazgos unificados (OSINT + pipeline)', '',
      `Sesión: ${session.id} — objetivo: ${session.target || 'n/a'} — ${now}`, '',
      '| origin | tool | type | value | sev | occ | summary |',
      '|---|---|---|---|---|---|---|',
    ].concat(rows.map((r) => `| ${r.origin} | ${r.tool} | ${r.type} | ${String(r.value || '').slice(0, 60)} | ${r.severity} | ${r.occurrences} | ${String(r.summary || '').replace(/\|/g, '/').slice(0, 80)} |`));
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="findings-unified.md"');
    return res.send(lines.join('\n'));
  }
  res.setHeader('Content-Disposition', 'attachment; filename="findings-unified.json"');
  res.json({ target: session.target, exportedAt: now, count: rows.length, osint: rows.filter((r) => r.origin === 'osint').length, proxy: rows.filter((r) => r.origin === 'proxy').length, pipeline: rows.filter((r) => r.origin === 'pipeline').length, findings: rows });
});

router.get('/findings/export/json', (req, res) => {
  const session = getSession();
  const findings = db.getFindings(session.id).map(findingRow);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="findings.json"');
  res.json({ target: session.target, exportedAt: new Date().toISOString(), count: findings.length, findings });
});

router.get('/findings/export/csv', (req, res) => {
  const session = getSession();
  const findings = db.getFindings(session.id).map(findingRow);
  const headers = ['id', 'type', 'summary', 'severity', 'asset', 'cves', 'evidence'];
  const cell = (v) => '"' + (Array.isArray(v) ? v.join(' ') : (v == null ? '' : String(v))).replace(/"/g, '""') + '"';
  const csv = [headers.join(',')];
  findings.forEach(f => csv.push(headers.map(h => cell(f[h])).join(',')));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="findings.csv"');
  res.send(csv.join('\n'));
});

// Borra un hallazgo y, si su evidencia está en ~/.knk-suite/evidencia, borra
// también ese fichero: deshacer una conversión no deja basura en disco.
router.delete('/findings/:id', (req, res) => {
  const s = getSession();
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: 'id inválido' });
  res.json(db.removeFinding(s.id, id));
});

router.delete('/findings', (req, res) => {
  const s = getSession();
  res.json(db.clearFindings(s.id));
});

// ── Multi-target (varios objetivos) ──────────────────────────────────

router.get('/targets', (req, res) => {
  const targets = db.stmts.listTargets.all();
  res.json(targets || []);
});

router.post('/targets', (req, res) => {
  const { name, scope: tgtScope, userAgent } = req.body;
  const id = require('node:crypto').randomUUID(); // uuid no estaba en deps: builtin
  db.stmts.insertTarget.run(id, name, JSON.stringify(tgtScope || []), userAgent || '',
    new Date().toISOString());
  res.json({ ok: true, id });
});

router.delete('/targets/:id', (req, res) => {
  db.stmts.deleteTarget.run(req.params.id);
  res.json({ ok: true });
});

// ── Presets de programa (Bugcrowd/H1/Intigriti) ──────────────────────
// Aplica scope + out-of-scope + ritmo + OPPLAN base a la sesión. El preset
// fija program_name → los hallazgos heredan programa (backfill + getAll).
router.get('/presets', (req, res) => res.json({ ok: true, presets: require('./lib/presets').listPresets() }));
router.post('/presets/apply', (req, res) => {
  const s = getSession();
  const r = require('./lib/presets').applyPreset(s, req.body?.id, { username: req.body?.username });
  if (!r.ok) return res.json(r);
  db.saveSession(s.id, s);
  res.json(r);
});


// ── Intruder (fuzzer pequeño estilo Burp, acoplado al Repeater) ────────────
// Caps duros server-side; payloads del usuario; cada petición pasa por
// repeater.sendRaw (scope obligatorio + limiter >=800ms + anti-SSRF).
router.get('/intruder/config', (req, res) => {
  res.json({ ok: true, caps: {
    maxTotalRequests: intruder.MAX_TOTAL_REQUESTS,
    maxPayloads: intruder.MAX_PAYLOADS,
    maxConcurrent: intruder.MAX_CONCURRENT,
    maxRunsConcurrent: intruder.MAX_RUNS_CONCURRENT,
  }, presets: Object.entries(intruder.PAYLOAD_SETS).map(([id, s]) => ({ id, label: s.label, count: s.payloads.length })) });
});

// Peticiones del historial del proxy preparadas para el Intruder: raw con
// posiciones §...§ ya marcadas (primer parámetro de query y de cuerpo).
router.get('/intruder/from-proxy/:id', (req, res) => {
  const w = proxyMod.historyEntry(req.params.id);
  const e = w && w.entry;
  if (!e) return res.status(404).json({ ok: false, error: 'entrada no encontrada' });
  if (e.scheme === 'tunnel') return res.status(400).json({ ok: false, error: 'una petición CONNECT no es fuzzable' });
  const raw = intruder.markPositions(proxyMod.buildRawRequest(e));
  const positions = (raw.match(/§[^§]*§/g) || []).length;
  res.json({ ok: true, id: e.id, method: e.method, url: e.url, raw, positions, presets: Object.entries(intruder.PAYLOAD_SETS).map(([pid, s]) => ({ id: pid, label: s.label, count: s.payloads.length })) });
});

router.post('/intruder/start', async (req, res) => {
  try {
    const { raw, payloadText, preset, maxRedirects, match } = req.body || {};
    const s = getSession();
    const r = await intruder.startRun(s, { raw, payloadText, preset, maxRedirects, match });
    if (!r.ok) return res.status(400).json(r);
    res.json({ ok: true, run: r.run });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get('/intruder/run/:id', (req, res) => {
  const s = getSession();
  const run = intruder.getRun(s.id, req.params.id);
  if (!run) return res.status(404).json({ ok: false, error: "run no encontrada" });
  res.json({ ok: true, run });
});

router.post('/intruder/abort/:id', (req, res) => {
  const s = getSession();
  res.json(intruder.abortRun(s.id, req.params.id));
});

router.post('/intruder/finding/:runId/:index', (req, res) => {
  try {
    const s = getSession();
    const r = intruder.toFinding(s.id, req.params.runId, Number(req.params.index), (req.body || {}).note);
    if (!r.ok) return res.status(400).json(r);
    res.json({ ok: true, finding: r.finding });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
// ── Docker Panel ────────────────────────────────────────────────────
router.get('/docker/containers', async (req, res) => {
  try {
    const result = require('child_process').execSync('docker ps -a --format "{{.ID}}|{{.Names}}|{{.Status}}|{{.Image}}"', { encoding: 'utf8' });
    const containers = result.trim().split('\n').filter(Boolean).map(line => {
      const [id, name, status, image] = line.split('|');
      return { id, name, status, image };
    });
    res.json({ ok: true, containers });
  } catch (e) {
    res.json({ ok: true, containers: [], error: 'Docker no disponible' });
  }
});

router.post('/docker/start/:id', (req, res) => {
  try {
    // Allowlist estricta: ids docker [a-zA-Z0-9_.-] + execFile (sin shell).
    if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(req.params.id || '')) return res.json({ ok: false, error: 'id docker inválido' });
    require('child_process').execFileSync('docker', ['start', req.params.id], { encoding: 'utf8' });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.post('/docker/stop/:id', (req, res) => {
  try {
    if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(req.params.id || '')) return res.json({ ok: false, error: 'id docker inválido' });
    require('child_process').execFileSync('docker', ['stop', req.params.id], { encoding: 'utf8' });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── OSINT Hub ──────────────────────────────────────────────────────
const osintHub = require('./lib/osint-hub');
const cameraScanner = require('./lib/camera-scanner');

// ── Recon pasivo (crt.sh, wayback, DoH, takeover, security.txt, SPF/DMARC)
// Motor fusionado sin claves; ritmo + anti-SSRF propios (no consume scope).
const reconHub = require('./lib/recon-hub');
router.get('/recon/crtsh', async (req, res) => {
  const { domain } = req.query;
  if (!domain) return res.json({ ok: false, error: 'Domain required' });
  res.json(await reconHub.crtshSubs(domain));
});
router.get('/recon/wayback', async (req, res) => {
  const { domain, limit } = req.query;
  if (!domain) return res.json({ ok: false, error: 'Domain required' });
  res.json(await reconHub.waybackCdx(domain, limit));
});
router.get('/recon/doh', async (req, res) => {
  const { domain, type } = req.query;
  if (!domain) return res.json({ ok: false, error: 'Domain required' });
  res.json(await reconHub.dohRecords(domain, type));
});
router.get('/recon/takeover', (req, res) => {
  const s = getSession();
  res.json(reconHub.checkTakeoverHub((s.artifacts || {}).cadenas_cname || {}));
});
router.get('/recon/securitytxt', async (req, res) => {
  const { domain } = req.query;
  if (!domain) return res.json({ ok: false, error: 'Domain required' });
  res.json(await reconHub.securityTxt(domain));
});
router.get('/recon/spfdmarc', async (req, res) => {
  const { domain } = req.query;
  if (!domain) return res.json({ ok: false, error: 'Domain required' });
  res.json(await reconHub.spfDmarc(domain));
});
router.get('/recon/investigate', async (req, res) => {
  const { target } = req.query;
  if (!target) return res.json({ ok: false, error: 'Target required (email, teléfono o usuario)' });
  res.json(await reconHub.investigate(target));
});

// ── Hub BB: guía de caza por clase + decodificador ───────────────────
const bbHub = require('./lib/bb-hub');
router.get('/hub/guide', (req, res) => res.json({ ok: true, clases: bbHub.listGuide() }));
router.get('/hub/guide/:clase', (req, res) => res.json(bbHub.getGuide(req.params.clase)));
router.post('/hub/decode', (req, res) => {
  const { input } = req.body || {};
  if (!input) return res.json({ ok: false, error: 'input requerido' });
  res.json({ ok: true, ...bbHub.decode(input) });
});

// ── Camera Scanner (new) ───────────────────────────────────────────

router.get('/camera/scan-local', async (req, res) => {
  try {
    const { range } = req.query;
    const result = await cameraScanner.scanLocalNetwork(range);
    res.json(result);
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.get('/camera/shodan/:ip', async (req, res) => {
  try {
    const ip = cameraScanner.strictV4(req.params.ip);
    if (!ip) return res.json({ ok: false, error: 'IP inválida' });
    res.json(await cameraScanner.shodanInternetDB(ip));
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.get('/camera/dorks', (req, res) => {
  const { brand, target } = req.query;
  res.json(cameraScanner.generateCameraDorks(brand, target));
});

router.get('/camera/cves', async (req, res) => {
  const { brand } = req.query;
  if (!brand) return res.json({ ok: false, error: 'Brand required (hikvision, dahua, axis...)' });
  res.json(await cameraScanner.cameraCVELookup(brand));
});

router.get('/camera/rtsp-probe', async (req, res) => {
  const { host, port } = req.query;
  const clean = cameraScanner.auditableIP(host);
  if (!clean) return res.json({ ok: false, error: 'Host inválido o bloqueado (link-local/metadata)' });
  const p = parseInt(port, 10) || 554;
  if (p < 1 || p > 65535) return res.json({ ok: false, error: 'Puerto inválido' });
  res.json(await cameraScanner.probeRTSP(clean, p));
});

router.get('/camera/external-search', async (req, res) => {
  const { query, country } = req.query;
  res.json(await cameraScanner.externalCameraSearch(query, country));
});

router.post('/camera/audit', async (req, res) => {
  const { ip } = req.body || {};
  const clean = cameraScanner.auditableIP(ip);
  if (!clean) return res.json({ ok: false, error: 'IP inválida o bloqueada (link-local/metadata)' });
  res.json(await cameraScanner.fullCameraAudit(clean));
});

router.get('/osint/dorks', (req, res) => {
  const { target, type } = req.query;
  if (!target) return res.json({ ok: false, error: 'Target required' });
  res.json(osintHub.generateGoogleDorks(target, type));
});

router.get('/osint/robots', async (req, res) => {
  const { domain } = req.query;
  if (!domain) return res.json({ ok: false, error: 'Domain required' });
  res.json(await osintHub.analyzeRobotsTxt(domain));
});

router.get('/osint/username', async (req, res) => {
  const { user } = req.query;
  if (!user) return res.json({ ok: false, error: 'Username required' });
  res.json(await osintHub.searchUsername(user));
});

router.get('/osint/phone', async (req, res) => {
  const { number } = req.query;
  if (!number) return res.json({ ok: false, error: 'Phone required' });
  res.json(await osintHub.lookupPhone(number));
});

router.get('/osint/email', async (req, res) => {
  const { address } = req.query;
  if (!address) return res.json({ ok: false, error: 'Email required' });
  res.json(await osintHub.emailOSINT(address));
});

router.get('/osint/domain', async (req, res) => {
  const { target } = req.query;
  if (!target) return res.json({ ok: false, error: 'Domain required' });
  res.json(await osintHub.domainRecon(target));
});

router.get('/osint/ip', async (req, res) => {
  const { target } = req.query;
  if (!target) return res.json({ ok: false, error: 'IP required' });
  res.json(await osintHub.ipRecon(target));
});

router.get('/osint/traceroute', async (req, res) => {
  const { target } = req.query;
  if (!target) return res.json({ ok: false, error: 'Target required (IP o hostname)' });
  res.json(await osintHub.traceroute(target));
});

router.get('/osint/hash', async (req, res) => {
  const { target } = req.query;
  if (!target) return res.json({ ok: false, error: 'Hash required' });
  res.json(await osintHub.hashLookup(target));
});

// ── Dashboard ─────────────────────────────────────────────────────
router.get('/dashboard/stats', (req, res) => res.json(dashboard.getStats(db)));
router.get('/dashboard/timeline', (req, res) => {
  const days = parseInt(req.query.days, 10) || 7;
  res.json(dashboard.getTimeline(db, days));
});
router.get('/dashboard/top-targets', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 10;
  res.json(dashboard.getTopTargets(db, limit));
});

// ── Report Export ─────────────────────────────────────────────────

// El parámetro de export puede ser id de sesión, id de reporte o slug: la UI
// enlaza por slug y parseInt(slug) es NaN, así que acababa exportando «la
// última sesión» por accidente.
// `db.getOrCreateSession` devuelve la fila cruda de SQLite: en ella `scope`,
// `opplan`, `phases` y `artifacts` son strings JSON. El generador de informes
// espera arrays/objetos, así que la exportación se hacía con una sesión que
// reventaba en cuanto había scope. Se normaliza aquí, en un solo sitio.
function parseSessionRow(s) {
  const safe = (value, fallback) => {
    if (value == null) return fallback;
    if (typeof value === 'object') return value;
    try { const parsed = JSON.parse(value); return parsed == null ? fallback : parsed; } catch { return fallback; }
  };
  return {
    ...s,
    scope: safe(s.scope, []),
    out_of_scope: safe(s.out_of_scope, []),
    opplan: safe(s.opplan, {}),
    phases: safe(s.phases, {}),
    artifacts: safe(s.artifacts, {}),
  };
}

// El parámetro de export puede ser id de sesión, id de reporte o slug: la UI
// enlaza por slug y parseInt(slug) es NaN, así que acababa exportando «la
// última sesión» por accidente.
function resolveExportSession(idRaw) {
  const raw = String(idRaw == null ? '' : idRaw);
  if (/^[0-9]+$/.test(raw)) {
    const asNumber = parseInt(raw, 10);
    const byId = db.stmts.getSession.get(asNumber);
    if (byId) return parseSessionRow(db.getOrCreateSession(asNumber));
    const byReport = db.query('SELECT * FROM reports WHERE id = ? LIMIT 1', [asNumber]);
    if (byReport.length) return parseSessionRow(db.getOrCreateSession(byReport[0].session_id));
  }
  if (raw) {
    const bySlug = db.query('SELECT * FROM reports WHERE slug = ? ORDER BY id DESC LIMIT 1', [raw]);
    if (bySlug.length) return parseSessionRow(db.getOrCreateSession(bySlug[0].session_id));
  }
  return parseSessionRow(db.getOrCreateSession());
}

const reportExport = require('./lib/report-export');
router.get('/reports/:id/export/md', (req, res) => {
  const session = resolveExportSession(req.params.id);
  const findings = db.getFindings(session.id);
  const reports = db.getReports(session.id);
  const md = reportExport.generateMarkdown(session, findings, reports);
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="report-${session.id}.md"`);
  res.send(md);
});
router.get('/reports/:id/export/html', (req, res) => {
  const session = resolveExportSession(req.params.id);
  const findings = db.getFindings(session.id);
  const reports = db.getReports(session.id);
  const html = reportExport.generateHTML(session, findings, reports);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// ── Nuclei Integration ───────────────────────────────────────────
const nuclei = require('./lib/nuclei');
router.get('/nuclei/status', (req, res) => res.json({ installed: nuclei.isInstalled() }));
router.post('/nuclei/scan', async (req, res) => {
  const { target, templates, severity, timeoutMs } = req.body || {};
  if (!target) return res.status(400).json({ ok: false, error: 'target required' });
  res.json(await nuclei.scan(target, templates, severity, timeoutMs));
});
router.get('/nuclei/templates', (req, res) => res.json(nuclei.listTemplates()));
router.post('/nuclei/update', async (req, res) => res.json(await nuclei.updateTemplates()));

// ── Offline Cache ────────────────────────────────────────────────
const offlineCache = require('./lib/offline-cache');
router.get('/cache/stats', (req, res) => res.json(offlineCache.stats()));
router.delete('/cache', (req, res) => { offlineCache.clear(); res.json({ ok: true }); });

// ── Clipboard Manager ────────────────────────────────────────────
const clipboard = require('./lib/clipboard');
router.get('/clipboard', (req, res) => res.json(clipboard.list(req.query.category)));
router.post('/clipboard', (req, res) => { const { text, category, tags } = req.body || {}; res.json(clipboard.add(text, category, tags)); });
router.delete('/clipboard/:id', (req, res) => res.json(clipboard.remove(req.params.id)));
router.delete('/clipboard', (req, res) => { clipboard.clear(); res.json({ ok: true }); });
router.get('/clipboard/search', (req, res) => res.json(clipboard.search(req.query.q)));

// ── LILIGO ESP32 ─────────────────────────────────────────────────
const liligoReal = require('./lib/liligo-real');
router.get('/liligo/detect', async (req, res) => res.json(await liligoReal.detectBoard()));
router.post('/liligo/connect', async (req, res) => res.json(await liligoReal.connect(req.body.port, req.body.baudRate)));
router.post('/liligo/command', async (req, res) => res.json(await liligoReal.sendCommand(req.body.port, req.body.cmd)));
router.post('/liligo/scan-wifi', async (req, res) => res.json(await liligoReal.scanWifi(req.body.port)));
router.post('/liligo/scan-ble', async (req, res) => res.json(await liligoReal.scanBle(req.body.port)));
router.post('/liligo/info', async (req, res) => res.json(await liligoReal.getInfo(req.body.port)));
router.post('/liligo/disconnect', async (req, res) => res.json(await liligoReal.disconnect(req.body.port)));

// ── Pipeline Engine ──────────────────────────────────────────────
const pipeEngine = require('./lib/pipe-engine');
router.get('/pipeline/templates', (req, res) => res.json(pipeEngine.listTemplates()));
const pipeRuns = new Map(); // runId -> { pipeline, target, startedAt, done }
const alertHub = require('./lib/alert-hub');

router.post('/pipeline/tools/run', async (req, res) => {
  const { template, target, definition, phases } = req.body || {};
  try {
    let def = definition;
    if (!def && template) def = pipeEngine.getBuiltinTemplate(template, target);
    if (!def && Array.isArray(phases)) {
      def = { name: template || 'custom', phases: phases.map((p, i) => ({ id: p.id || `phase${i + 1}`, ...p })) };
    }
    if (!def) return res.status(400).json({ ok: false, error: 'template, phases o definition requeridos' });
    // Inyecta el target donde falte.
    for (const p of (def.phases || [])) {
      p.args = p.args && typeof p.args === 'object' ? p.args : {};
      if (target && !p.args.target) p.args.target = target;
    }
    const pipeline = new pipeEngine.Pipeline(def);
    const validation = pipeline.validate();
    if (!validation.valid) return res.status(400).json({ ok: false, errors: validation.errors });
    const runId = `pipe_${Date.now().toString(36)}`;
    const entry = { pipeline, target: target || def.name, startedAt: Date.now(), done: false };
    pipeRuns.set(runId, entry);
    if (pipeRuns.size > 20) { const first = pipeRuns.keys().next().value; pipeRuns.delete(first); }
    alertHub.emit('info', { title: 'Pipeline iniciado', message: `${def.name} → ${target || '?'}`, source: 'pipeline' });
    pipeline.run((phaseId, phaseStatus, result) => {
      try {
        if (phaseId && phaseStatus !== 'running') {
          alertHub.emit(phaseStatus === 'failed' ? 'error' : 'info', {
            title: `Fase ${phaseId}: ${phaseStatus}`, source: 'pipeline',
            message: phaseStatus === 'failed' ? String((result && result.error) || 'falló').slice(0, 200) : `${def.name}`,
          });
        }
        if (!phaseId) {
          entry.done = true;
          const okRun = pipeline.status === 'completed';
          alertHub.emit(okRun ? 'scan_complete' : 'error', {
            title: okRun ? 'Pipeline completado' : 'Pipeline fallido',
            message: `${def.name} → ${target || '?'}`, source: 'pipeline',
          });
        }
      } catch {}
    }).catch(() => {});
    res.json({ ok: true, runId, status: pipeline.getStatus() });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});
router.get('/pipeline/tools/runs/:id', (req, res) => {
  const entry = pipeRuns.get(req.params.id);
  if (!entry) return res.status(404).json({ ok: false, error: 'run no encontrado' });
  res.json({ ok: true, runId: req.params.id, target: entry.target, startedAt: entry.startedAt, done: entry.done, ...entry.pipeline.getStatus() });
});
router.get('/pipeline/tools/runs', (req, res) => {
  res.json({ ok: true, runs: [...pipeRuns.entries()].map(([runId, e]) => ({ runId, target: e.target, startedAt: e.startedAt, done: e.done, status: e.pipeline.status })) });
});
router.post('/pipeline/save', (req, res) => {
  const { name, definition } = req.body || {};
  res.json(pipeEngine.saveTemplate(name, definition));
});
router.get('/pipeline/:name', (req, res) => res.json(pipeEngine.loadTemplate(req.params.name) || { error: 'not found' }));

// ── Public Camera Sources ──────────────────────────────────────
const publicCameraSources = require('./lib/public-camera-sources');

router.get('/cameras/sources/insecam', async (req, res) => {
  const { country, category } = req.query;
  try { res.json(await publicCameraSources.fetchInsecam(country, category)); }
  catch (e) { res.json({ ok: false, error: e.message, cameras: [] }); }
});

router.get('/cameras/sources/earthcam', async (req, res) => {
  const { category } = req.query;
  try { res.json(await publicCameraSources.fetchEarthCam(category)); }
  catch (e) { res.json({ ok: false, error: e.message, cameras: [] }); }
});

router.get('/cameras/sources/streams', (req, res) => {
  res.json(publicCameraSources.getPublicCameraStreams());
});

router.get('/cameras/sources/dorks', (req, res) => {
  const { brand, country } = req.query;
  res.json(publicCameraSources.generateCameraDorks(brand, country));
});

router.get('/cameras/sources/ip-dorks', (req, res) => {
  const { service, port } = req.query;
  res.json(publicCameraSources.generateIPSearchDorks(service, parseInt(port) || 80));
});

router.get('/cameras/sources/brands', (req, res) => {
  res.json(publicCameraSources.getCameraBrands());
});

router.get('/cameras/sources/exposed/:ip', async (req, res) => {
  try { res.json(await publicCameraSources.searchExposedCameras(req.params.ip)); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

// ── En Directo (módulo LiveCams) ───────────────────────────────────
const liveCams = require('./lib/public-live-cams');

router.get('/live/feeds', (req, res) => {
  res.json({ ok: true, feeds: liveCams.getVerifiedLiveFeeds() });
});
router.get('/live/directories', (req, res) => {
  res.json({ ok: true, directories: liveCams.getCommunityDirectories() });
});
router.get('/live/platforms', (req, res) => {
  res.json({ ok: true, platforms: liveCams.getAdultPlatforms() });
});
router.get('/live/suggestions', (req, res) => {
  res.json({ ok: true, suggestions: liveCams.getLiveSuggestions() });
});
router.get('/live/dorks', (req, res) => {
  const { platform, brand, port } = req.query;
  res.json({ ok: true, ...liveCams.getPublicCamDorks(platform || 'google', { brand, port }) });
});

// Salas públicas Chaturbate (API pública sin clave): listado cacheado 90 s
// con miniaturas live + HLS por sala solo a petición (tokens efímeros).
router.get('/live/adult/rooms', async (req, res) => {
  try {
    const { platform, limit } = req.query;
    if (platform && platform !== 'chaturbate') {
      return res.json({ ok: true, platform, rooms: [], total: 0, note: 'Listado en directo solo disponible para Chaturbate; el resto son fichas externas.' });
    }
    const gender = ['f', 'm', 'c', 't', 's'].includes(String(req.query.gender)) ? req.query.gender : 'all';
    res.json({ ok: true, platform: 'chaturbate', ...(await liveCams.getCbRooms({ limit, gender })) });
  } catch (e) { res.json({ ok: false, error: e.message, rooms: [] }); }
});

// Telemetría del reproductor: el frontend cuenta en qué paso muere cada
// stream (manifiesto, fragmentos, play). Últimas 80 entradas en memoria.
const _playerLog = [];
let _playerLogLast = 0;
router.post('/live/player-log', (req, res) => {
  try {
    const b = req.body || {};
    const now = Date.now();
    if (now - _playerLogLast < 1500) return res.json({ ok: true, throttled: true });
    _playerLogLast = now;
    const entry = {
      at: new Date(now).toISOString(),
      view: String(b.view || '').slice(0, 20),
      label: String(b.label || '').slice(0, 80),
      stage: String(b.stage || '').slice(0, 30),
      detail: String(b.detail || '').slice(0, 300),
    };
    _playerLog.push(entry);
    if (_playerLog.length > 80) _playerLog.shift();
    try { console.log(`[player] ${entry.view}/${entry.label} ${entry.stage} ${entry.detail}`); } catch {}
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false }); }
});
router.get('/live/player-log', (req, res) => {
  res.json({ ok: true, entries: _playerLog.slice(-80) });
});

router.get('/live/adult/hls', async (req, res) => {
  try {
    const { platform, user } = req.query;
    if ((platform || 'chaturbate') !== 'chaturbate') return res.json({ ok: false, error: 'HLS en directo solo para Chaturbate' });
    res.json({ ok: true, ...(await liveCams.getCbRoomHls(user)) });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ── NASA Tierra + ISS ────────────────────────────────────────────
// Foto del día EPIC (DSCOVR, DEMO_KEY gratuita sin registro) + posición
// en vivo de la ISS (open-notify, sin clave). La imagen se sirve por el
// proxy /api/cameras/media/img para no abrir el CSP.
const https_nasa = require('https');
const _nasaCache = { epic: null, epicAt: 0, iss: null, issAt: 0 };

function fetchJson(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const mod = String(url).startsWith('https') ? https_nasa : require('http');
    const rq = mod.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'knkSuite-NASA/1.0' } }, (rs) => {
      if (rs.statusCode !== 200) { rs.resume(); return reject(new Error(`upstream ${rs.statusCode}`)); }
      let body = '';
      rs.on('data', (c) => { body += c; if (body.length > 2 * 1024 * 1024) rq.destroy(); });
      rs.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
      rs.on('error', reject);
    });
    rq.on('error', reject);
    rq.on('timeout', () => { rq.destroy(); reject(new Error('timeout')); });
  });
}

router.get('/live/nasa-epic', async (req, res) => {
  try {
    if (!_nasaCache.epic || Date.now() - _nasaCache.epicAt > 6 * 3600 * 1000) {
      let cfgKey = '';
      try { cfgKey = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'config.json'), 'utf8')).nasaApiKey || ''; } catch {}
      const key = process.env.NASA_API_KEY || cfgKey || 'DEMO_KEY';
      const list = await fetchJson(`https://api.nasa.gov/EPIC/api/natural?api_key=${encodeURIComponent(key)}`);
      if (!Array.isArray(list) || !list.length) throw new Error('EPIC sin imágenes hoy');
      const latest = list[0];
      const d = String(latest.identifier || '').slice(0, 8);
      const raw = `https://epic.gsfc.nasa.gov/archive/natural/${d.slice(0, 4)}/${d.slice(4, 6)}/${d.slice(6, 8)}/png/${latest.image}.png`;
      _nasaCache.epic = {
        caption: latest.caption || '', date: latest.date || '',
        centroid: latest.centroid_coordinates || null,
        image: raw,
        proxy: `/api/cameras/media/img?url=${encodeURIComponent(raw)}`,
      };
      _nasaCache.epicAt = Date.now();
    }
    res.json({ ok: true, ..._nasaCache.epic });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ── YouTube Live (solo con clave gratuita de Google Cloud) ──────────
// Sin clave devuelve configured:false y la UI muestra búsquedas externas.
function youtubeKey() {
  if (process.env.YOUTUBE_API_KEY) return process.env.YOUTUBE_API_KEY;
  try {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    for (const p of [path.join(__dirname, '..', 'config.json'), path.join(os.homedir(), '.knk-suite', 'config.json')]) {
      try {
        const cfg = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
        if (cfg.youtubeApiKey) return cfg.youtubeApiKey;
      } catch {}
    }
  } catch {}
  return '';
}

router.get('/live/youtube', async (req, res) => {
  const key = youtubeKey();
  if (!key) {
    return res.json({ ok: true, configured: false, lives: [], note: 'Crea una clave gratuita (Google Cloud → YouTube Data API v3) y ponla en youtubeApiKey.' });
  }
  const q = String(req.query.q || 'live').slice(0, 80);
  try {
    const params = new URLSearchParams({ part: 'snippet', eventType: 'live', type: 'video', maxResults: '12', q, key });
    const r = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, { headers: { 'User-Agent': 'knkSuite/1.0' } });
    // fetch global de Node 18+: Response con .ok/.json()
    if (!r.ok) return res.json({ ok: false, configured: true, error: `YouTube ${r.status}`, lives: [] });
    const j = await r.json();
    const lives = (j.items || []).map((it) => ({
      id: it.id?.videoId, title: it.snippet?.title, channel: it.snippet?.channelTitle,
      thumb: it.snippet?.thumbnails?.medium?.url || null,
      watch: it.id?.videoId ? `https://www.youtube.com/watch?v=${it.id.videoId}` : null,
      embed: it.id?.videoId ? `https://www.youtube-nocookie.com/embed/${it.id.videoId}?autoplay=1&mute=1` : null,
    })).filter((v) => v.id);
    res.json({ ok: true, configured: true, lives });
  } catch (e) { res.json({ ok: false, configured: true, error: e.message, lives: [] }); }
});

// ── Cielo (vuelos ADS-B, satélites, Sol, planetas) ───────────────────
const sky = require('./lib/sky');

router.get('/sky/flights', async (req, res) => {
  try {
    res.json({ ok: true, ...(await sky.getFlights(req.query)) });
  } catch (e) { res.json({ ok: false, error: e.message, flights: [] }); }
});
router.get('/sky/sats', async (req, res) => {
  try { res.json({ ok: true, ...(await sky.getSatPositions()) }); }
  catch (e) { res.json({ ok: false, error: e.message, sats: [] }); }
});
router.get('/sky/tle/:id', async (req, res) => {
  try { res.json({ ok: true, ...(await sky.getTLE(req.params.id)) }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
router.get('/sky/sun', async (req, res) => {
  try { res.json({ ok: true, ...(await sky.getSun()) }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
router.get('/sky/planets', (req, res) => {
  res.json({ ok: true, planets: sky.getPlanets() });
});

router.get('/live/iss-now', async (req, res) => {
  try {
    if (!_nasaCache.iss || Date.now() - _nasaCache.issAt > 30000) {
      let lat = NaN, lon = NaN, timestamp = Math.floor(Date.now() / 1000);
      try {
        const w = await fetchJson('https://api.wheretheiss.at/v1/satellites/25544', 12000);
        lat = Number(w.latitude); lon = Number(w.longitude); timestamp = w.timestamp || timestamp;
      } catch {
        const j = await fetchJson('http://api.open-notify.org/iss-now.json', 10000);
        lat = Number(j.iss_position.latitude); lon = Number(j.iss_position.longitude);
        timestamp = j.timestamp || timestamp;
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('ISS sin posición válida');
      _nasaCache.iss = { lat, lon, timestamp };
      _nasaCache.issAt = Date.now();
    }
    res.json({ ok: true, ..._nasaCache.iss });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ── Kali Local Tools ─────────────────────────────────────────────
router.post('/kali/install/:tool', async (req, res) => {
  const result = await kaliLocal.installTool(req.params.tool);
  try {
    require('./lib/alert-hub').emit(result.ok ? 'tool_installed' : 'error', {
      title: result.ok ? `${req.params.tool} instalada` : `Falló ${req.params.tool}`,
      message: (result.path || result.error || '').slice(0, 200), source: 'tools',
    });
  } catch {}
  res.json(result);
});
router.post('/kali/setup-all', async (req, res) => {
  res.json(await kaliLocal.setupAll());
});

// ── Plugins Marketplace ──────────────────────────────────────────
const { PluginManager } = require('./lib/plugins');
const pluginMgr = new PluginManager();
router.get('/plugins', (req, res) => res.json(pluginMgr.list()));
router.post('/plugins/install', async (req, res) => res.json(await pluginMgr.install(req.body.source)));
router.delete('/plugins/:name', (req, res) => res.json(pluginMgr.uninstall(req.params.name)));
router.post('/plugins/:name/enable', (req, res) => res.json(pluginMgr.enable(req.params.name)));
router.post('/plugins/:name/disable', (req, res) => res.json(pluginMgr.disable(req.params.name)));

// ── Teaming ──────────────────────────────────────────────────────
const { TeamManager } = require('./lib/team');
const teamMgr = new TeamManager();
router.get('/team/members', (req, res) => res.json(teamMgr.getMembers()));
router.get('/team/history', (req, res) => res.json(teamMgr.getChatHistory(parseInt(req.query.limit) || 100)));

// ── Voz de Electra (TTS/STT) ───────────────────────────────────────
const voice = require('./lib/voice');
router.get('/voice/voices', (req, res) => {
  res.json({ ok: true, voices: voice.VOICES, default: voice.DEFAULT_VOICE });
});
router.get('/voice/speak', async (req, res) => {
  const r = await voice.speak(String(req.query.text || ''), String(req.query.voice || voice.DEFAULT_VOICE));
  if (!r.ok) return res.status(400).json(r);
  res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=86400' });
  require('fs').createReadStream(r.file).pipe(res);
});
router.post('/voice/transcribe', async (req, res) => {
  const { audio, ext } = req.body || {};
  res.json(await voice.transcribe(audio, ext));
});

// ── Tor Network ──────────────────────────────────────────────────
const tor = require('./lib/tor');

function torError(res, e) {
  res.json({ ok: false, error: e && e.message ? e.message : String(e) });
}

// Códigos ISO de dos letras para elegir países de salida (o null = por defecto).
function torExitNodes(value) {
  if (!Array.isArray(value)) return null;
  const codes = value.map((v) => String(v || '').trim().toLowerCase()).filter((v) => /^[a-z]{2}$/.test(v));
  const unique = [...new Set(codes)].slice(0, 12);
  return unique.length ? unique : null;
}

router.get('/tor/status', async (req, res) => {
  try {
    const stale = req.query.refresh === '1' || req.query.refresh === 'true';
    res.json(await tor.getStatus(stale ? { ipMaxAgeMs: 0 } : {}));
  } catch (e) { torError(res, e); }
});

// Instala el «tor expert bundle» oficial (Windows) o explica cómo hacerlo en
// otros sistemas. Puede tardar: descarga ~25 MB y descomprime.
router.post('/tor/install', async (req, res) => {
  try {
    res.json(await tor.ensureTorInstalled({ force: req.body?.force === true }));
  } catch (e) { torError(res, e); }
});

function clampPort(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : undefined;
}

router.post('/tor/start', async (req, res) => {
  try {
    const body = req.body || {};
    const socksPort = clampPort(body.socksPort);
    const controlPort = clampPort(body.controlPort);
    res.json(await tor.startTor({ socksPort, controlPort, exitNodes: torExitNodes(body.exitNodes) }));
  } catch (e) { torError(res, e); }
});

router.post('/tor/stop', async (req, res) => {
  try { res.json(await tor.stopTor()); } catch (e) { torError(res, e); }
});

router.post('/tor/new-identity', async (req, res) => {
  try { res.json(await tor.newIdentity()); } catch (e) { torError(res, e); }
});

router.get('/tor/test', async (req, res) => {
  try { res.json(await tor.testConnection()); } catch (e) { torError(res, e); }
});

router.get('/tor/ip', async (req, res) => {
  try {
    const fresh = req.query.refresh === '1' || req.query.refresh === 'true';
    res.json(await tor.getCurrentIP(fresh ? { cacheMs: 0 } : {}));
  } catch (e) { torError(res, e); }
});

router.get('/tor/circuits', (req, res) => {
  try { res.json(tor.getCircuitInfo()); } catch (e) { torError(res, e); }
});

// Log real de Tor: el panel lo pinta tal cual en vez de fabricarlo.
router.get('/tor/log', (req, res) => {
  try { res.json(tor.getTorLog({ tail: parseInt(req.query.tail, 10) || 200, source: req.query.source || 'auto' })); }
  catch (e) { torError(res, e); }
});

// Estado del proxy del SISTEMA para el aviso del panel: si otro programa
// (o el propio usuario) ha puesto un proxy a nivel de Windows, el operador
// debe saberlo antes de enrutar todo por Tor.
router.get('/tor/system-proxy', (req, res) => {
  try {
    const state = tor.getSystemProxyState();
    res.json({ ok: true, available: state !== null, state });
  } catch (e) { torError(res, e); }
});

router.post('/tor/route-all', (req, res) => {
  try { res.json(tor.routeAllThroughTor()); } catch (e) { torError(res, e); }
});

router.post('/tor/clear-proxy', (req, res) => {
  try { res.json(tor.clearSystemProxy()); } catch (e) { torError(res, e); }
});

// ── Proxy de salida (Burp-style): estado / activar / test / quitar ──
outproxy.mount(router);
// ── Indicador de salida (directo / Tor / proxy) para el Dashboard ──
egress.mount(router);
// ── OAST (interactsh): payloads OOB, callbacks y hallazgos ──
oastRouter.mount(router, { getSession });

module.exports = { router, getSession };
