'use strict';

// ============================================================================
// KNK SUITE v2 — Servidor Express (1 solo puerto: 8086)
// ============================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const sessionMod = require('./lib/session');
const opplanMod = require('./lib/opplan');
const pipeline = require('./lib/pipeline');
const gates = require('./lib/gates');
const llm = require('./lib/llm');
const reportMod = require('./lib/report');
const verifierMod = require('./lib/verifier');
const netMod = require('./lib/net');
const programParser = require('./lib/program-parser');

const PORT = parseInt(process.env.KNK_PORT || '8086', 10);
const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const WORKSPACE = path.join(ROOT, 'workspace');
const SESSION_FILE = process.env.KNK_SESSION_FILE || sessionMod.DEFAULT_FILE;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJSON(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readJSON(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => (data += c));
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);

  // CORS para el frontend local
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // =========================================================================
  // API: Estado general
  // =========================================================================
  if (u.pathname === '/api/status') {
    const s = sessionMod.load(SESSION_FILE);
    const ollama = await llm.status();
    return sendJSON(res, 200, {
      ok: true,
      session: {
        target: s.target,
        scope: s.scope,
        opplan: s.opplan ? { nombre: s.opplan.nombre, status: s.opplan.status } : null,
        notes: s.notes.length,
        findings: s.findings.length,
        phases: s.phases,
      },
      ollama: { up: ollama.up, model: ollama.model },
    });
  }

  // =========================================================================
  // API: Sesión completa
  // =========================================================================
  if (u.pathname === '/api/session') {
    const s = sessionMod.load(SESSION_FILE);
    return sendJSON(res, 200, s);
  }

  // =========================================================================
  // API: Hallazgos
  // =========================================================================
  if (u.pathname === '/api/findings') {
    const s = sessionMod.load(SESSION_FILE);
    return sendJSON(res, 200, s.findings);
  }

  // =========================================================================
  // API: OPPLAN
  // =========================================================================
  if (u.pathname === '/api/opplan' && req.method === 'GET') {
    const s = sessionMod.load(SESSION_FILE);
    return sendJSON(res, 200, s.opplan || null);
  }

  if (u.pathname === '/api/opplan' && req.method === 'POST') {
    const body = await readJSON(req);
    const s = sessionMod.load(SESSION_FILE);
    s.opplan = { ...opplanMod.blank(), ...body };
    const v = opplanMod.validate(s.opplan);
    sessionMod.save(SESSION_FILE, s);
    return sendJSON(res, 200, { ok: v.ok, opplan: s.opplan, pendientes: v.pendientes });
  }

  if (u.pathname === '/api/opplan/approve' && req.method === 'POST') {
    const s = sessionMod.load(SESSION_FILE);
    if (!s.opplan) return sendJSON(res, 400, { ok: false, error: 'No hay OPPLAN' });
    s.opplan.status = 'aprobado';
    s.opplan.aprobadoEn = new Date().toISOString();
    sessionMod.save(SESSION_FILE, s);
    return sendJSON(res, 200, { ok: true, opplan: s.opplan });
  }

  // =========================================================================
  // API: Objetivo / Scope / Config
  // =========================================================================
  if (u.pathname === '/api/target' && req.method === 'POST') {
    const body = await readJSON(req);
    const s = sessionMod.load(SESSION_FILE);
    if (body.target) s.target = body.target;
    if (body.scope) {
      s.scope = Array.isArray(body.scope) ? body.scope : String(body.scope).split(',').map(x => x.trim()).filter(Boolean);
      netMod.setScope(s.scope);
    }
    if (body.userAgent) {
      netMod.setUA(body.userAgent);
      sessionMod.setArtifact(s, 'userAgent', body.userAgent);
    }
    if (body.rateLimitMs) netMod.setRateLimit(parseInt(body.rateLimitMs) || 500);
    if (body.programUrl) sessionMod.setArtifact(s, 'programUrl', body.programUrl);
    if (body.programPolicy) sessionMod.setArtifact(s, 'programPolicy', body.programPolicy);
    sessionMod.save(SESSION_FILE, s);
    return sendJSON(res, 200, {
      ok: true,
      target: s.target,
      scope: s.scope,
      userAgent: netMod.getUA(),
      programUrl: s.artifacts?.programUrl || '',
    });
  }

  if (u.pathname === '/api/evidence' && req.method === 'POST') {
    const body = await readJSON(req);
    const { name, data, type } = body;
    if (!name || !data) return sendJSON(res, 400, { ok: false, error: 'name y data requeridos' });
    const file = netMod.saveEvidence(name, type === 'binary' ? Buffer.from(data, 'base64') : data);
    const s = sessionMod.load(SESSION_FILE);
    const evidenceList = s.artifacts?.evidenceFiles || [];
    evidenceList.push({ name, file, type: type || 'text', at: new Date().toISOString() });
    sessionMod.setArtifact(s, 'evidenceFiles', evidenceList);
    sessionMod.save(SESSION_FILE, s);
    return sendJSON(res, 200, { ok: true, file });
  }

  if (u.pathname === '/api/config' && req.method === 'GET') {
    const s = sessionMod.load(SESSION_FILE);
    return sendJSON(res, 200, {
      userAgent: netMod.getUA(),
      scope: s.scope,
      target: s.target,
      programUrl: s.artifacts?.programUrl || '',
      evidenceDir: netMod.getEvidenciaDir(),
      evidenceFiles: s.artifacts?.evidenceFiles || [],
    });
  }

  // =========================================================================
  // API: Parsear programa desde URL (auto-fill)
  // =========================================================================
  if (u.pathname === '/api/parse-program' && req.method === 'POST') {
    const body = await readJSON(req);
    const url = body.url;
    if (!url) return sendJSON(res, 400, { ok: false, error: 'URL del programa requerida' });

    const parsed = await programParser.parseProgram(url).catch(err => {
      return { error: 'Error al analizar programa: ' + (err.message || 'timeout'), source: programParser.detectPlatform(url) };
    });
    if (parsed.error && parsed.source === 'hackerone') {
      // HackerOne: modo guiado aunque el fetch falle
      const hoGuided = programParser.parseHackerOne(url);
      parsed.source = hoGuided.source;
      parsed.autoParsed = false;
      parsed.programName = hoGuided.programName;
      parsed.note = hoGuided.note;
      parsed.domains = [];
      parsed.policy = hoGuided.policy;
      parsed.error = null;
    }
    if (parsed.error) return sendJSON(res, 400, { ok: false, error: parsed.error });

    // Auto-fill session
    const s = sessionMod.load(SESSION_FILE);
    s.target = parsed.target;
    s.scope = parsed.domains;
    sessionMod.setArtifact(s, 'outOfScope', parsed.outOfScope);
    sessionMod.setArtifact(s, 'programUrl', parsed.programUrl);
    sessionMod.setArtifact(s, 'programName', parsed.programName);
    sessionMod.setArtifact(s, 'programPolicy', parsed.policy);
    sessionMod.setArtifact(s, 'rewards', parsed.rewards);
    sessionMod.setArtifact(s, 'autoParsed', parsed.autoParsed !== false);
    sessionMod.setArtifact(s, 'source', parsed.source);
    netMod.setScope(parsed.domains);
    if (parsed.userAgent) netMod.setUA(parsed.userAgent);
    netMod.setRateLimit(parsed.rateLimit);
    sessionMod.save(SESSION_FILE, s);

    return sendJSON(res, 200, { ok: true, parsed });
  }

  // =========================================================================
  // API: Cumplimiento / Compliance
  // =========================================================================
  if (u.pathname === '/api/compliance') {
    const fs = require('fs');
    const path = require('path');
    try {
      const ywh = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'compliance-ywh.json'), 'utf8'));
      return sendJSON(res, 200, ywh);
    } catch { return sendJSON(res, 500, { error: 'No se pudo cargar compliance' }); }
  }

  // =========================================================================
  // API: Pipeline (ejecutar fase)
  // =========================================================================
  if (u.pathname === '/api/pipeline/phases') {
    return sendJSON(res, 200, pipeline.getPhases());
  }

  if (u.pathname === '/api/pipeline/run' && req.method === 'POST') {
    const body = await readJSON(req);
    const phaseId = body.phase;
    if (!phaseId) return sendJSON(res, 400, { ok: false, error: 'Especifica phase' });

    const s = sessionMod.load(SESSION_FILE);
    const ctx = {
      session: s,
      save: () => sessionMod.save(SESSION_FILE, s),
      addFinding: (f) => sessionMod.addFinding(s, f),
      setArtifact: (k, v) => sessionMod.setArtifact(s, k, v),
      setPhase: (id, data) => sessionMod.setPhase(s, id, data),
    };

    const result = await pipeline.runPhase(ctx, phaseId, body).catch(err => {
      return { phase: body.phase || phaseId, ok: false, error: err.message || 'Error en la fase', output: null, findings: [] };
    });
    return sendJSON(res, 200, result);
  }

  if (u.pathname === '/api/pipeline/full' && req.method === 'POST') {
    const body = await readJSON(req);
    const target = body.target || sessionMod.load(SESSION_FILE).target;
    if (!target) return sendJSON(res, 400, { ok: false, error: 'Sin target' });

    const s = sessionMod.load(SESSION_FILE);
    const ctx = {
      session: s,
      save: () => sessionMod.save(SESSION_FILE, s),
      addFinding: (f) => sessionMod.addFinding(s, f),
      setArtifact: (k, v) => sessionMod.setArtifact(s, k, v),
      setPhase: (id, data) => sessionMod.setPhase(s, id, data),
    };

    const result = await pipeline.runFullPipeline(ctx, target);
    return sendJSON(res, 200, result);
  }

  // =========================================================================
  // API: Compuertas
  // =========================================================================
  if (u.pathname === '/api/gates/validate' && req.method === 'POST') {
    const body = await readJSON(req);
    const { type, ...input } = body;
    let verdict;
    switch (type) {
      case 'cors': verdict = gates.corsChain(input); break;
      case 'idor': verdict = gates.idorChain(input); break;
      case 'ssrf': verdict = gates.ssrfChain(input); break;
      case 'xss': verdict = gates.xssChain(input); break;
      case 'sub': verdict = gates.subdomainChain(input); break;
      default: return sendJSON(res, 400, { ok: false, error: `Tipo desconocido: ${type}` });
    }
    if (verdict.sendable) {
      const s = sessionMod.load(SESSION_FILE);
      sessionMod.addFinding(s, { type: type.toUpperCase(), summary: verdict.summary });
      sessionMod.save(SESSION_FILE, s);
    }
    return sendJSON(res, 200, verdict);
  }

  // =========================================================================
  // API: Reportes
  // =========================================================================
  if (u.pathname === '/api/reportes') {
    try {
      const dir = path.join(WORKSPACE, 'reportes');
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')) : [];
      const reportes = files.map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; }
      }).filter(Boolean);
      return sendJSON(res, 200, reportes);
    } catch { return sendJSON(res, 200, []); }
  }

  if (u.pathname === '/api/reporte/generate' && req.method === 'POST') {
    const body = await readJSON(req);
    const rep = reportMod.generateReport(body);
    if (!rep.allowed) return sendJSON(res, 400, { ok: false, blockers: rep.blockers });
    const file = reportMod.writeReport(WORKSPACE, rep.json);
    const s = sessionMod.load(SESSION_FILE);
    sessionMod.setArtifact(s, 'ultimo_reporte', rep.json);
    sessionMod.addFinding(s, { type: 'REPORTE', summary: `Reporte: ${rep.json.titulo}`, severity: rep.json.severidad });
    sessionMod.save(SESSION_FILE, s);
    return sendJSON(res, 200, { ok: true, file, json: rep.json });
  }

  // Guardar borrador del reporte (sin validación estricta)
  if (u.pathname === '/api/reporte/save-draft' && req.method === 'POST') {
    const body = await readJSON(req);
    const s = sessionMod.load(SESSION_FILE);
    // Merge con el reporte existente si hay
    const existing = s.artifacts?.ultimo_reporte || {};
    const draft = { ...existing, ...body, estado: 'borrador', fecha: new Date().toISOString() };
    const file = reportMod.writeReport(WORKSPACE, draft);
    sessionMod.setArtifact(s, 'ultimo_reporte', draft);
    sessionMod.save(SESSION_FILE, s);
    return sendJSON(res, 200, { ok: true, file, json: draft });
  }

  if (u.pathname === '/api/reporte/verify' && req.method === 'POST') {
    const s = sessionMod.load(SESSION_FILE);
    const last = s.artifacts.ultimo_reporte;
    if (!last) return sendJSON(res, 400, { ok: false, error: 'Sin reporte' });
    const ver = await verifierMod.verifyReport(last, { llm });
    return sendJSON(res, 200, ver);
  }

  // =========================================================================
  // API: LLM / Chat
  // =========================================================================
  if (u.pathname === '/api/llm/status') {
    const st = await llm.status();
    return sendJSON(res, 200, st);
  }

  if (u.pathname === '/api/llm/chat' && req.method === 'POST') {
    const body = await readJSON(req);
    const r = await llm.generate(body.prompt, { system: body.system, model: body.model });
    return sendJSON(res, 200, r);
  }

  // =========================================================================
  // API: Herramientas / Docker Kali
  // =========================================================================
  if (u.pathname === '/api/tools') {
    const dockerOk = require('./lib/docker').ensureRunning();
    let dockerTools = [];
    if (dockerOk) {
      try {
        const r = require('./lib/docker').exec('bash', '-c "which nmap nuclei ffuf subfinder amass sqlmap 2>/dev/null | tr \"\\n\" \" \""', { timeoutMs: 10000 });
        if (r.ok) dockerTools = r.output.trim().split(/\s+/).filter(Boolean).map(t => t.split('/').pop());
      } catch { /* no docker */ }
    }
    return sendJSON(res, 200, {
      dockerKali: dockerOk,
      dockerTools,
      nativeTools: ['node', 'ollama'].filter(() => true),
    });
  }

  // =========================================================================
  // API: Notas
  // =========================================================================
  if (u.pathname === '/api/notes' && req.method === 'POST') {
    const body = await readJSON(req);
    const s = sessionMod.load(SESSION_FILE);
    sessionMod.addNote(s, body.text || '');
    sessionMod.save(SESSION_FILE, s);
    return sendJSON(res, 200, { ok: true });
  }

  // =========================================================================
  // Frontend estático
  // =========================================================================
  let file = path.join(FRONTEND, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!file.startsWith(FRONTEND)) return sendJSON(res, 403, { error: 'Forbidden' });

  fs.readFile(file, (err, data) => {
    if (err) {
      // Si no encuentra, servir index.html (SPA fallback)
      fs.readFile(path.join(FRONTEND, 'index.html'), (err2, data2) => {
        if (err2) return sendJSON(res, 404, { error: 'Not found' });
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(data2);
      });
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║         🐉 KNK SUITE v2 — Bug Bounty        ║');
  console.log('  ║                                              ║');
  console.log(`  ║  Dashboard → http://127.0.0.1:${PORT}           ║`);
  console.log('  ║  API       → /api/*                          ║');
  console.log('  ║                                              ║');
  console.log('  ║  URL → OPPLAN → recon → scan → fuzz         ║');
  console.log('  ║       → exploit → reporte → verificar       ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
});