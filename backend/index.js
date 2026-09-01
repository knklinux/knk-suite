'use strict';

// ============================================================================
// KNK SUITE v2.1 — Express Backend + WebSocket Terminal
// ============================================================================

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const db = require('./db');
const docker = require('./lib/docker');
const netMod = require('./lib/net');
const pipeline = require('./lib/pipeline');
const scannerMod = require('./lib/scanner');
const reconMod = require('./lib/recon');
const programParser = require('./lib/program-parser');
const reportMod = require('./lib/report');
const verifierMod = require('./lib/verifier');
const llmMod = require('./lib/llm');
const hackeroneMod = require('./lib/hackerone');
const screenshotMod = require('./lib/screenshot');
const huntMod = require('./lib/hunt');
const bizlogicMod = require('./lib/bizlogic');
const accountsMod = require('./lib/accounts');
const playbookMod = require('./lib/playbook');
const camerasMod = require('./lib/cameras');
const engagementMod = require('./lib/engagement');
const runbooksMod = require('./lib/runbooks');
const ctiMod = require('./lib/cti');
const assetsMod = require('./lib/assets');
const purpleteamMod = require('./lib/purpleteam');

const app = express();
const server = http.createServer(app);
const PORT = parseInt(process.env.KNK_PORT || '8086', 10);

// ── Cargar claves locales (~/.knk-suite/keys.env) ────────────────────────
// Sin pisar variables ya definidas en el entorno. keys.env tiene chmod 600.
(function loadKeysEnv() {
  try {
    const keysPath = path.join(require('os').homedir(), '.knk-suite', 'keys.env');
    if (!fs.existsSync(keysPath)) return;
    for (const line of fs.readFileSync(keysPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch { /* sin claves locales: el resto funciona igual */ }
})();

// ── Middleware ───────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend', 'dist')));
const API_KEY = process.env.KNK_API_KEY || '';
app.use('/api', (req, res, next) => {
  if (req.path === '/status' && req.method === 'GET') return next();
  if (API_KEY && req.get('x-knk-api-key') !== API_KEY) return res.status(401).json({ ok: false, error: 'authentication_required' });
  next();
});

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:8086');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Session helper ──────────────────────────────────
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

// ── API Routes ──────────────────────────────────────

// Status
app.get('/api/status', async (req, res) => {
  const s = getSession();
  // Check public IP (for VPN verification) — se omite con KNK_OFFLINE=1
  let publicIP = null;
  if (process.env.KNK_OFFLINE !== '1') try {
    const https = require('https');
    publicIP = await new Promise((resolve) => {
      https.get('https://ifconfig.me', { timeout: 3000 }, (r) => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => resolve(d.trim()));
      }).on('error', () => resolve(null));
    });
  } catch {}
  res.json({
    ok: true,
    session: {
      target: s.target,
      scope: s.scope,
      opplan: s.opplan.nombre ? { nombre: s.opplan.nombre, status: s.opplan.status } : null,
      findings: db.getFindings(s.id).length,
      phases: s.phases,
    },
    docker: docker.ensureRunning(),
    tools: ['nmap', 'ffuf', 'nuclei', 'subfinder', 'sqlmap', 'whatweb', 'dirb'],
    network: { publicIP },
  });
});

// Session
app.get('/api/session', (req, res) => {
  const s = getSession();
  const findings = db.getFindings(s.id);
  res.json({ ...s, findings });
});

// Findings
app.get('/api/findings', (req, res) => {
  const s = getSession();
  res.json(db.getFindings(s.id));
});

// Target
app.post('/api/target', (req, res) => {
  const s = getSession();
  const { target, scope, outOfScope, userAgent, rateLimitMs, programUrl, programPolicy } = req.body;
  if (target) s.target = target;
  if (scope) {
    s.scope = Array.isArray(scope) ? scope : String(scope).split(',').map(x => x.trim()).filter(Boolean);
    netMod.setScope(s.scope);
    s.out_of_scope = Array.isArray(outOfScope) ? outOfScope : s.out_of_scope;
    netMod.setOutOfScope(s.out_of_scope);
  }
  if (userAgent) {
    s.user_agent = userAgent;
    netMod.setUA(userAgent);
  }
  if (rateLimitMs) {
    s.rate_limit_ms = Math.max(800, Math.min(parseInt(rateLimitMs, 10) || 2000, 60000));
    netMod.setRateLimit(parseInt(rateLimitMs));
  }
  if (programUrl) s.program_url = programUrl;
  if (programPolicy) s.program_policy = programPolicy;
  db.saveSession(s.id, s);
  res.json({ ok: true, target: s.target, scope: s.scope, userAgent: s.user_agent });
});

// OPPLAN
app.get('/api/opplan', (req, res) => {
  const s = getSession();
  res.json(s.opplan.nombre ? s.opplan : null);
});

app.post('/api/opplan', (req, res) => {
  const s = getSession();
  const incoming = req.body || {};
  // Nunca permitir que el cliente fuerce 'aprobado' sin pasar por /approve
  delete incoming.status;
  delete incoming.aprobadoEn;
  s.opplan = { ...s.opplan, ...incoming, fecha: new Date().toISOString() };
  db.saveSession(s.id, s);
  res.json({ ok: true, opplan: s.opplan });
});

app.post('/api/opplan/approve', (req, res) => {
  const s = getSession();
  if (!s.opplan.nombre) return res.status(400).json({ ok: false, error: 'No hay OPPLAN' });
  // Aprobar = confirmación formal de autorización escrita (human-in-the-loop)
  s.opplan.status = 'aprobado';
  s.opplan.autorizado = true;
  s.opplan.aprobadoEn = new Date().toISOString();
  db.saveSession(s.id, s);
  res.json({ ok: true, opplan: s.opplan });
});

// Pipeline
app.get('/api/pipeline/phases', (req, res) => {
  res.json(pipeline.getPhases());
});

app.post('/api/pipeline/run', async (req, res) => {
  const { phase: phaseId, ...params } = req.body;
  if (!phaseId) return res.status(400).json({ ok: false, error: 'phase requerido' });
  if (req.body.dryRun === true) return res.json({ ok: true, dryRun: true, phase: phaseId, message: 'Dry-run: no se realizaron peticiones.' });
  const s = getSession();
  if (s.user_agent) netMod.setUA(s.user_agent);
  if (s.scope.length) netMod.setScope(s.scope);
  if (s.rate_limit_ms) netMod.setRateLimit(s.rate_limit_ms);
  const ctx = {
    session: s,
    save: () => db.saveSession(s.id, s),
    addFinding: (f) => db.addFinding(s.id, f.type, f.summary, f.severity),
    setArtifact: (k, v) => { s.artifacts[k] = v; },
    setPhase: (id, d) => { s.phases[id] = d; },
  };
  try {
    const result = await pipeline.runPhase(ctx, phaseId, params);
    db.saveSession(s.id, s);
    res.json(result);
  } catch (e) {
    res.json({ phase: phaseId, ok: false, error: e.message, output: null, findings: [] });
  }
});

app.post('/api/pipeline/full', async (req, res) => {
  const target = req.body.target || getSession().target;
  if (!target) return res.status(400).json({ ok: false, error: 'Sin target' });
  if (req.body.dryRun === true) return res.json({ ok: true, dryRun: true, target, message: 'Dry-run: no se realizaron peticiones.' });
  const s = getSession();
  if (s.user_agent) netMod.setUA(s.user_agent);
  if (s.scope.length) netMod.setScope(s.scope);
  if (s.rate_limit_ms) netMod.setRateLimit(s.rate_limit_ms);
  const ctx = {
    session: s,
    save: () => db.saveSession(s.id, s),
    addFinding: (f) => db.addFinding(s.id, f.type, f.summary, f.severity),
    setArtifact: (k, v) => { s.artifacts[k] = v; },
    setPhase: (id, d) => { s.phases[id] = d; },
  };
  const result = await pipeline.runFullPipeline(ctx, target);
  db.saveSession(s.id, s);
  res.json(result);
});

// Docker exec — solo herramientas allowlist, argumentos tokenizados (sin shell)
app.post('/api/docker/exec', (req, res) => {
  const { tool, args, timeoutMs } = req.body;
  if (!tool) return res.status(400).json({ ok: false, error: 'tool requerido (nmap|httpx|nuclei|ffuf|subfinder|amass|whatweb|dirb)' });
  if (!docker.ALLOWED_TOOLS.has(tool)) return res.status(403).json({ ok: false, error: 'Herramienta no permitida.' });
  if (!docker.ensureRunning()) return res.status(500).json({ ok: false, error: 'Docker Kali no disponible' });
  const r = docker.exec(tool, Array.isArray(args) ? args : String(args || '').trim(), { timeoutMs: Math.min(timeoutMs || 30000, 60000) });
  const s = getSession();
  db.logTerminal(s.id, `${tool} ${Array.isArray(args) ? args.join(' ') : args}`, r.output || r.error || '');
  res.json({ ok: r.ok, output: (r.output || '').slice(0, 50000), error: r.ok ? null : (r.output || '').slice(0, 500) });
});

// Terminal log
app.get('/api/terminal/log', (req, res) => {
  const s = getSession();
  res.json(db.getTerminalLog(s.id));
});

// Reports
app.get('/api/reports', (req, res) => {
  const s = getSession();
  res.json(db.getReports(s.id));
});

app.post('/api/reports/save', (req, res) => {
  const s = getSession();
  const { slug, data, status } = req.body;
  const id = db.saveReport(s.id, slug || 'draft', data || {}, status || 'borrador');
  res.json({ ok: true, id });
});

app.post('/api/reports/update', (req, res) => {
  const { id, data, status } = req.body;
  db.stmts.updateReport.run(JSON.stringify(data), status || 'borrador', id);
  res.json({ ok: true });
});

// Evidence
app.post('/api/evidence', (req, res) => {
  const { name, data, type } = req.body;
  if (!name || data === undefined) return res.status(400).json({ ok: false, error: 'name y data requeridos' });
  let file;
  try { file = netMod.saveEvidence(name, type === 'binary' ? Buffer.from(data, 'base64') : data); }
  catch (e) { return res.status(400).json({ ok: false, error: e.message }); }
  const s = getSession();
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  db.stmts.insertEvidence.run(s.id, null, name, type || 'text', file);
  res.json({ ok: true, file, sha256: hash });
});

app.get('/api/evidence', (req, res) => {
  const s = getSession();
  res.json(db.stmts.getEvidence.all(s.id));
});

// HackerOne (seguro: solo parseo de texto y borradores, sin llamadas API)
app.post('/api/hackerone/parse-scope', (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ ok: false, error: 'text requerido' });
  const parsed = hackeroneMod.parseScopeText(text);
  const s = getSession();
  if (parsed.inScope.length) {
    s.scope = parsed.inScope;
    s.out_of_scope = parsed.outOfScope;
    netMod.setScope(parsed.inScope);
    netMod.setOutOfScope(parsed.outOfScope);
    db.saveSession(s.id, s);
  }
  res.json({ ok: true, parsed });
});

app.post('/api/hackerone/build-draft', (req, res) => {
  const { json } = req.body || {};
  if (!json) return res.status(400).json({ ok: false, error: 'json requerido' });
  res.json({ ok: true, draft: hackeroneMod.buildDraft(json) });
});

app.post('/api/hackerone/checklist', (req, res) => {
  const { json } = req.body || {};
  if (!json) return res.status(400).json({ ok: false, error: 'json requerido' });
  res.json({ ok: true, checklist: hackeroneMod.checklist(json) });
});

// Exportación HTML (imprimible a PDF) y diff de reportes
app.post('/api/reports/export-html', (req, res) => {
  const { json } = req.body || {};
  if (!json) return res.status(400).json({ ok: false, error: 'json requerido' });
  const file = reportMod.writeReportHtml(path.join(__dirname, '..', 'workspace'), json);
  res.json({ ok: true, file });
});

app.post('/api/reports/diff', (req, res) => {
  const { before, after } = req.body || {};
  if (!before || !after) return res.status(400).json({ ok: false, error: 'before y after requeridos' });
  res.json({ ok: true, diff: reportMod.diffReports(before, after) });
});

// Screenshots automáticos (requiere puppeteer instalado)
app.post('/api/screenshots', async (req, res) => {
  const { urls, label } = req.body || {};
  if (!Array.isArray(urls) || !urls.length) return res.status(400).json({ ok: false, error: 'urls requerido' });
  try {
    const result = await screenshotMod.takeScreenshots(urls, { label });
    res.json(result);
  } catch (e) {
    res.status(e.code === 'PUPPETEER_MISSING' ? 501 : 500).json({ ok: false, error: e.message });
  }
});

// Threat hunting (defensivo: solo procesa texto/logs que envía el operador)
app.post('/api/hunt/parse-iocs', (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ ok: false, error: 'text requerido' });
  res.json({ ok: true, iocs: huntMod.parseIocs(text) });
});

app.post('/api/hunt/scan', (req, res) => {
  const { logText, iocs } = req.body || {};
  if (!logText) return res.status(400).json({ ok: false, error: 'logText requerido' });
  const parsed = iocs ? iocs : huntMod.parseIocs('');
  res.json({ ok: true, result: huntMod.huntIocs(logText, parsed) });
});

app.post('/api/hunt/anomalies', (req, res) => {
  const { logText, thresholds } = req.body || {};
  if (!logText) return res.status(400).json({ ok: false, error: 'logText requerido' });
  const result = huntMod.huntAnomalies(logText, thresholds || {});
  res.json({ ok: true, result, mitre: huntMod.mapToMitre(result.alerts) });
});

// Lógica de negocio (manual, basada en metodología de writeups)
app.post('/api/bizlogic/plan', (req, res) => {
  const s = getSession();
  const plan = bizlogicMod.planTests({ target: s.target, scope: s.scope });
  res.json({ ok: true, plan, markdown: bizlogicMod.renderPlan(plan) });
});

app.post('/api/bizlogic/validate', (req, res) => {
  const { ...input } = req.body || {};
  const verdict = bizlogicMod.bizlogicChain(input);
  if (verdict.sendable) {
    const s = getSession();
    db.addFinding(s.id, 'BIZLOGIC', verdict.summary, 'medium');
  }
  res.json(verdict);
});

// Vault de cuentas de prueba (identidades A/B, solo manuales)
app.get('/api/accounts', (req, res) => {
  const program = req.query.program;
  res.json({ ok: true, accounts: accountsMod.listAccounts(program) });
});

app.post('/api/accounts', (req, res) => {
  try { res.json({ ok: true, accounts: accountsMod.addAccount(req.body || {}) }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.delete('/api/accounts', (req, res) => {
  const { program, index } = req.body || {};
  try { res.json({ ok: true, accounts: accountsMod.removeAccount(program, index) }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// Playbook de explotación manual (consume artefactos del pipeline)
app.post('/api/playbook', (req, res) => {
  const s = getSession();
  const opts = req.body || {};
  const pb = playbookMod.generatePlaybook({
    target: s.target,
    scope: s.scope,
    subdomains: s.artifacts?.subdominios || [],
    urls: s.artifacts?.urls_historicas || [],
    tech: s.artifacts?.tech || [],
    restrictions: s.artifacts?.restrictions || [],
    mobileApps: s.artifacts?.mobileApps || [],
    includeCameras: opts.includeCameras === true,
  });
  res.json({ ok: true, playbook: pb, markdown: playbookMod.renderPlaybook(pb) });
});

// Cámaras IP (solo in-scope + autorización)
camerasMod.setNetMod(netMod);
app.post('/api/cameras/plan', (req, res) => {
  const s = getSession();
  res.json({ ok: true, plan: camerasMod.planTests({ target: s.target, scope: s.scope }) });
});

app.post('/api/cameras/probe-rtsp', async (req, res) => {
  const { host, port, authorized } = req.body || {};
  if (!host) return res.status(400).json({ ok: false, error: 'host requerido' });
  const s = getSession();
  const opplanOk = s.opplan?.status === 'aprobado' && s.opplan?.autorizado === true;
  const result = await camerasMod.probeRtsp(host, {
    port: port || 554,
    authorized: authorized === true && opplanOk,
  });
  if (result.error === 'not_authorized' || result.error === 'out_of_scope') return res.status(403).json(result);
  res.json({ ok: result.ok, ...result });
});

app.post('/api/cameras/validate', (req, res) => {
  const verdict = camerasMod.cameraChain(req.body || {});
  if (verdict.sendable) {
    const s = getSession();
    db.addFinding(s.id, 'CAMERA', verdict.summary, 'medium');
  }
  res.json(verdict);
});

// ── Roadmap: engagement, runbooks, CTI, assets, purple team ──────────────
app.post('/api/engagement/generate', (req, res) => {
  const s = getSession();
  const findings = db.getFindings(s.id);
  const rep = engagementMod.generateEngagementReport({
    target: s.target,
    program: s.artifacts?.programName || '',
    scope: s.scope,
    assets: s.artifacts?.assets || [],
    findings,
    evidenceDir: netMod.getEvidenciaDir(),
    ...(req.body || {}),
  });
  res.json({ ok: true, ...rep });
});

app.post('/api/runbooks/for', (req, res) => {
  const { type } = req.body || {};
  if (!type) return res.status(400).json({ ok: false, error: 'type requerido' });
  const rb = runbooksMod.runbookFor(type);
  res.json({ ok: !!rb, runbook: rb, markdown: runbooksMod.renderRunbook(rb) });
});

app.post('/api/cti/ingest', (req, res) => {
  const { text, format } = req.body || {};
  if (!text) return res.status(400).json({ ok: false, error: 'text requerido' });
  try { res.json({ ok: true, ...ctiMod.parseFeed(text, format) }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.get('/api/assets', (req, res) => {
  const s = getSession();
  res.json({ ok: true, assets: assetsMod.listAssets(s), summary: assetsMod.summary(s) });
});

app.post('/api/assets', (req, res) => {
  const s = getSession();
  try {
    const entry = assetsMod.addAsset(s, req.body || {});
    db.saveSession(s.id, s);
    res.json({ ok: true, asset: entry, summary: assetsMod.summary(s) });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.patch('/api/assets', (req, res) => {
  const s = getSession();
  const { id, ...patch } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: 'id requerido' });
  try {
    const asset = assetsMod.updateAsset(s, id, patch);
    db.saveSession(s.id, s);
    res.json({ ok: true, asset, summary: assetsMod.summary(s) });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.post('/api/purpleteam/detection', (req, res) => {
  const { type } = req.body || {};
  if (!type) return res.status(400).json({ ok: false, error: 'type requerido' });
  const d = purpleteamMod.detectionFor({ type });
  res.json({ ok: !!d, detection: d, markdown: purpleteamMod.renderDetection(d) });
});

// Directorio de programas candidatos (curado, verificar siempre)
app.get('/api/programs', (req, res) => {
  try {
    const programs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'programs.json'), 'utf8'));
    res.json(programs);
  } catch { res.status(500).json({ error: 'Programas no disponible' }); }
});

// Compliance
app.get('/api/compliance', (req, res) => {
  try {
    const ywh = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'compliance-ywh.json'), 'utf8'));
    res.json(ywh);
  } catch { res.status(500).json({ error: 'Compliance no disponible' }); }
});

// LLM
app.get('/api/llm/status', async (req, res) => {
  res.json(await llmMod.status());
});

app.post('/api/llm/chat', async (req, res) => {
  const { prompt, system, model } = req.body;
  const r = await llmMod.generate(prompt, { system, model });
  res.json(r);
});

// Program parser
app.post('/api/parse-program', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ ok: false, error: 'URL requerida' });
  try {
    const parsed = await programParser.parseProgram(url);
    const s = getSession();
    const guided = parsed.autoParsed === false || !(parsed.domains && parsed.domains.length);
    // Metadata del programa SIEMPRE
    s.program_url = parsed.programUrl;
    s.program_name = parsed.programName;
    s.program_policy = parsed.policy;
    s.artifacts.userAgent = parsed.userAgent;
    s.artifacts.rateLimit = parsed.rateLimit;
    s.artifacts.rewards = parsed.rewards;
    s.artifacts.source = parsed.source;
    s.artifacts.autoParsed = parsed.autoParsed !== false;
    // Scope SOLO si el parser extrajo dominios de verdad (nunca pisar con [])
    if (!guided) {
      s.target = parsed.target;
      s.scope = parsed.domains;
      s.out_of_scope = parsed.outOfScope;
      netMod.setScope(parsed.domains);
      netMod.setOutOfScope(parsed.outOfScope);
      if (parsed.userAgent) netMod.setUA(parsed.userAgent);
      netMod.setRateLimit(parsed.rateLimit);
    } else {
      // Modo guiado: conservar el scope existente si lo hay
      netMod.setScope(s.scope);
      netMod.setOutOfScope(s.out_of_scope);
    }
    db.saveSession(s.id, s);
    res.json({ ok: true, parsed, guided });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Gates
app.post('/api/gates/validate', (req, res) => {
  const { type, ...input } = req.body;
  const gates = require('./lib/gates');
  let verdict;
  switch (type) {
    case 'cors': verdict = gates.corsChain(input); break;
    case 'idor': verdict = gates.idorChain(input); break;
    case 'ssrf': verdict = gates.ssrfChain(input); break;
    case 'xss': verdict = gates.xssChain(input); break;
    case 'sub': verdict = gates.subdomainChain(input); break;
    default: return res.status(400).json({ ok: false, error: `Tipo desconocido: ${type}` });
  }
  if (verdict.sendable) {
    const s = getSession();
    db.addFinding(s.id, type.toUpperCase(), verdict.summary, 'medium');
  }
  res.json(verdict);
});

// SPA fallback
app.get('*', (req, res) => {
  const index = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
  if (fs.existsSync(index)) res.sendFile(index);
  else res.status(404).json({ error: 'Frontend not built — run: cd frontend && npm run build' });
});

// ── WebSocket Terminal ──────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws/terminal' });

wss.on('connection', (ws, req) => {
  if (API_KEY && req.headers['x-knk-api-key'] !== API_KEY) { ws.close(1008, 'authentication_required'); return; }
  console.log('🔌 Terminal WebSocket connected');

  let ptyProcess = null;
  try {
    const pty = require('node-pty');
    // Detect if sg docker is needed
    let shell = '/bin/bash';
    let shellArgs = [];
    try {
      require('child_process').execSync('docker ps', { timeout: 3000, stdio: 'ignore' });
    } catch {
      // Need sg docker
      shell = 'sg';
      shellArgs = ['docker', '-c', 'docker exec -it knk-kali bash'];
    }

    ptyProcess = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: process.env.HOME || '/root',
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    ptyProcess.onData((data) => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'output', data }));
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
    });

    ws.on('message', (msg) => {
      try {
        const m = JSON.parse(msg);
        if (m.type === 'input' && ptyProcess) {
          ptyProcess.write(m.data);
        } else if (m.type === 'resize' && ptyProcess) {
          ptyProcess.resize(m.cols || 120, m.rows || 30);
        }
      } catch {}
    });

    ws.on('close', () => {
      if (ptyProcess) ptyProcess.kill();
    });

  } catch (e) {
    console.error('PTY error:', e.message);
    ws.send(JSON.stringify({ type: 'error', data: 'Terminal no disponible: ' + e.message }));
  }
});

// ── Start ───────────────────────────────────────────
server.listen(PORT, '127.0.0.1', () => {

  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║      🐉 KNK SUITE v2.1 — Bug Bounty         ║');
  console.log('  ║                                              ║');
  console.log(`  ║  Dashboard → http://127.0.0.1:${PORT}           ║`);
  console.log('  ║  API       → /api/*                          ║');
  console.log('  ║  Terminal  → ws://127.0.0.1:' + PORT + '/ws/terminal  ║');
  console.log('  ║                                              ║');
  console.log('  ║  Express + SQLite + WebSocket + Docker Kali  ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
});

module.exports = { app, server };