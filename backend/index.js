'use strict';

// ============================================================================
// KNK SUITE v2.1 — Express Backend + WebSocket Terminal
// ============================================================================

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');

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

const app = express();
const server = http.createServer(app);
const PORT = parseInt(process.env.KNK_PORT || '8086', 10);

// ── Middleware ───────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend', 'dist')));

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
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
  // Check public IP (for VPN verification)
  let publicIP = null;
  try {
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
  const { target, scope, userAgent, rateLimitMs, programUrl, programPolicy } = req.body;
  if (target) s.target = target;
  if (scope) {
    s.scope = Array.isArray(scope) ? scope : String(scope).split(',').map(x => x.trim()).filter(Boolean);
    netMod.setScope(s.scope);
  }
  if (userAgent) {
    s.user_agent = userAgent;
    netMod.setUA(userAgent);
  }
  if (rateLimitMs) {
    s.rate_limit_ms = parseInt(rateLimitMs);
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
  s.opplan = { ...s.opplan, ...req.body, fecha: new Date().toISOString() };
  db.saveSession(s.id, s);
  res.json({ ok: true, opplan: s.opplan });
});

app.post('/api/opplan/approve', (req, res) => {
  const s = getSession();
  if (!s.opplan.nombre) return res.status(400).json({ ok: false, error: 'No hay OPPLAN' });
  s.opplan.status = 'aprobado';
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

// Docker exec
app.post('/api/docker/exec', (req, res) => {
  const { cmd, timeoutMs } = req.body;
  if (!cmd) return res.status(400).json({ ok: false, error: 'cmd requerido' });
  const blocked = /^(rm\s+-rf|mkfs|dd\s+if=|shutdown|reboot|init\s+0)/i;
  if (blocked.test(cmd)) return res.status(403).json({ ok: false, error: 'Bloqueado' });
  if (!docker.ensureRunning()) return res.status(500).json({ ok: false, error: 'Docker Kali no disponible' });
  const timeout = Math.min(timeoutMs || 30000, 60000);
  const r = docker.exec('bash', `-c "${cmd.replace(/"/g, '\\"')}"`, { timeoutMs: timeout });
  const s = getSession();
  db.logTerminal(s.id, cmd, r.output || r.error || '');
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
  if (!name || !data) return res.status(400).json({ ok: false, error: 'name y data requeridos' });
  const dir = path.join(require('os').homedir(), '.knk-suite', 'evidencia');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}_${name.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
  fs.writeFileSync(file, type === 'binary' ? Buffer.from(data, 'base64') : data, 'utf8');
  const s = getSession();
  db.stmts.insertEvidence.run(s.id, null, name, type || 'text', file);
  res.json({ ok: true, file });
});

app.get('/api/evidence', (req, res) => {
  const s = getSession();
  res.json(db.stmts.getEvidence.all(s.id));
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
    // Auto-fill session
    const s = getSession();
    s.target = parsed.target;
    s.scope = parsed.domains;
    s.out_of_scope = parsed.outOfScope;
    s.program_url = parsed.programUrl;
    s.program_name = parsed.programName;
    s.program_policy = parsed.policy;
    s.artifacts.userAgent = parsed.userAgent;
    s.artifacts.rateLimit = parsed.rateLimit;
    s.artifacts.rewards = parsed.rewards;
    s.artifacts.source = parsed.source;
    s.artifacts.autoParsed = parsed.autoParsed !== false;
    netMod.setScope(parsed.domains);
    if (parsed.userAgent) netMod.setUA(parsed.userAgent);
    netMod.setRateLimit(parsed.rateLimit);
    db.saveSession(s.id, s);
    res.json({ ok: true, parsed });
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
server.listen(PORT, '0.0.0.0', () => {
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