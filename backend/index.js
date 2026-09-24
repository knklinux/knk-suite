'use strict';

// ============================================================================
// KNK SUITE — Express Backend (bootstrap fino)
// Toda la capa de rutas vive en backend/routes.js; esto solo arranca el
// servidor HTTP + la terminal WebSocket (con selector de runtime Kali).
// ============================================================================

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { router } = require('./routes');
const { publicCamerasRouter } = require('./lib/public-webcams-router');
const kali = require('./lib/kali');
const auth = require('./lib/auth');
const { initDB } = require('./db');

const app = express();
const server = http.createServer(app);
const PORT = parseInt(process.env.KNK_PORT || '8086', 10);
const HOST = process.env.KNK_HOST || '127.0.0.1';

// ── Middleware ───────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(auth.cors);
app.use(express.static(path.join(__dirname, '..', 'frontend', 'dist'), { index: false }));
// Auth de API: token SIEMPRE exigido, salvo el healthcheck público.
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' && req.path === '/health') return next();
  return auth.requireToken(req, res, next);
});
// Cámaras públicas en directo (proxy same-origin de fuentes oficiales abiertas)
app.use('/api', publicCamerasRouter);
app.use('/api', router);

// Bootstrap del arranque limpio: sirve el HTML SIN exigir token y planta
// la cookie de sesión (como hace auth.cors en toda respuesta). Solo
// sockets loopback: es el mismo riesgo que el estático (HTML sin datos).
// El shell de Tauri navega aquí cuando no hay cookie previa; con la
// cookie en el jar, la siguiente navegación autentica sola.
app.get('/bootstrap', (req, res) => {
  if (!auth.isLocalSocket(req)) return res.status(403).json({ ok: false, error: 'solo local' });
  const index = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
  if (!fs.existsSync(index)) return res.status(404).json({ error: 'Frontend not built — run: cd frontend && npm run build' });
  auth.cors(req, res, () => res.sendFile(index));
});

// SPA fallback
app.get('*', (req, res) => {
  const index = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
  if (fs.existsSync(index)) {
    auth.cors(req, res, () => {
      auth.requireToken(req, res, () => res.sendFile(index));
    });
  } else res.status(404).json({ error: 'Frontend not built — run: cd frontend && npm run build' });
});

// ── WebSocket Alertas ───────────────────────────────────────────
const alertHub = require('./lib/alert-hub');
const wssAlerts = new WebSocketServer({ noServer: true });
wssAlerts.on('connection', async (ws, req) => {
  if (!auth.authorize({ headers: req.headers, socket: req.socket })) {
    try { ws.close(1008, 'No autorizado'); } catch {}
    return;
  }
  alertHub.attach(ws);
  try { ws.send(JSON.stringify({ type: 'info', severity: 'info', title: 'Conectado', message: 'Stream de alertas activo', source: 'system', timestamp: new Date().toISOString() })); } catch {}
});

// ── WebSocket Terminal ──────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });

// Un SOLO listener de upgrade que reparte por path. Con dos WebSocketServer
// montados sobre el mismo http.Server, el que no coincidía con su path
// destruía el socket con 400 antes de que el otro completara el handshake
// (el terminal, construido en segundo lugar, nunca llegaba a conectarse).
server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname === '/ws/terminal') wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  else if (pathname === '/ws/alerts') wssAlerts.handleUpgrade(req, socket, head, (ws) => wssAlerts.emit('connection', ws, req));
  else socket.destroy();
});

let _ptyModule = null;
let _ptyLoadAttempted = false;

function loadPty() {
  if (_ptyLoadAttempted) return _ptyModule;
  _ptyLoadAttempted = true;
  try {
    _ptyModule = require('node-pty');
    return _ptyModule;
  } catch (e) {
    console.error('node-pty unavailable:', e.message);
    return null;
  }
}

wss.on('connection', async (ws, req) => {
  if (!auth.authorize({ headers: req.headers, socket: req.socket })) {
    try { ws.close(1008, 'No autorizado'); } catch {}
    return;
  }
  console.log('🔌 Terminal WebSocket connected');
  const ptyMgr = require('./lib/pty-manager');
  let sessKey = null;
  let sess = null;
  const send = (message) => { try { if (ws.readyState === 1) ws.send(JSON.stringify(message)); } catch {} };
  try {
    const pty = loadPty();
    if (!pty) {
      send({ type: 'error', data: 'Terminal PTY no disponible en este entorno (node-pty no carga correctamente).' });
      return;
    }
    const qs = new URL(req.url, 'http://x').searchParams;
    const choice = qs.get('runtime') || 'auto';
    const tab = (qs.get('tab') || 'main').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'main';
    const st = await kali.detect();
    const term = kali.pickTerminal(choice, st);
    term.tab = tab;
    sessKey = ptyMgr.keyFor(term);
    sess = ptyMgr.attach(sessKey, ws);
    if (sess && sess.pty) {
      // Reenganche: la sesión seguía viva (p. ej. comando mandado desde otro
      // módulo). Se reenvía el historial para no perder la respuesta.
      send({ type: 'output', data: `\x1b[36m── reconectado: ${term.banner || term.runtime || 'terminal'} (historial debajo) ──\x1b[0m\r\n` });
      if (sess.backlog.length) send({ type: 'output', data: sess.backlog.join('\r\n') + '\r\n' });
    } else {
      send({ type: 'output', data: `\x1b[36m${term.banner || '── Terminal ──'}\x1b[0m\r\n` });
      const ptyProcess = pty.spawn(term.shell, term.shellArgs, {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: term.cwd || process.env.USERPROFILE || process.env.HOME,
        env: { ...process.env, ...(term.extraEnv || {}), TERM: 'xterm-256color' },
      });
      sess = ptyMgr.create(sessKey, ptyProcess);
      sess.clients.add(ws);
    }

    ws.on('message', (msg) => {
      try {
        const m = JSON.parse(msg);
        const live = sess && sess.pty;
        if (m.type === 'input' && live) live.write(m.data);
        else if (m.type === 'resize' && live) live.resize(m.cols || 120, m.rows || 30);
      } catch {}
    });


    ws.on('close', () => {
      // La PTY sobrevive al cierre de la vista (ver pty-manager).
      if (sessKey) ptyMgr.detach(sessKey, ws);
    });
  } catch (e) {
    console.error('PTY error:', e.message);
    send({ type: 'error', data: 'Terminal no disponible: ' + e.message });
  }
});

// ── Graceful exit ────────────────────────────────────────────────
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// ── Start (async: init DB first) ────────────────────────────────
(async () => {
  await initDB();
  // ── Restaura scope/UA/ritmo de la sesión (fail-closed tras reinicio) ──
  // Sin esto, net.js arranca con scope vacío y los gates de scope (repeater,
  // hunter, intruder) quedan ABIERTOS hasta aplicar un preset. Detectado por
  // hunt-verify.js. Nunca bloquea el arranque.
  try {
    const dbm = require('./db');
    const s = dbm.getOrCreateSession();
    const netm = require('./lib/net');
    const toArr = (v) => { try { const a = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(a) ? a : []; } catch { return []; } };
    const sc = toArr(s.scope);
    if (sc.length) {
      netm.setScope(sc);
      try { require('./lib/proxy').setScope(sc); } catch {}
    }
    if (s.user_agent) { try { netm.setUA(s.user_agent, { force: true }); } catch { try { netm.setUA(s.user_agent); } catch {} } }
    if (s.rate_limit_ms) netm.setRateLimit(Number(s.rate_limit_ms) || 2000);
    try {
      const art = typeof s.artifacts === 'string' ? JSON.parse(s.artifacts || '{}') : (s.artifacts || {});
      if (art.intigritiUser) netm.setExtraHeaders({ 'X-Intigriti-Username': String(art.intigritiUser).slice(0, 64) });
    } catch {}
    if (sc.length) console.log('[net] scope restaurado de la sesión (' + sc.length + ' entradas)');
  } catch (e) { console.warn('[net] sin scope inicial:', e.message); }
  // ── Proxy de salida persistido (UI → config.json) ───────────────────────
  // KNK_PROXY (entorno) tiene prioridad; si no está, se aplica el guardado
  // desde el tab Labs. En try silencioso: nunca bloquea el arranque.
  try {
    if (!process.env.KNK_PROXY) {
      const { CONFIG_KEY } = require("./lib/outproxy");
      // OJO: __dirname aquí es backend/ — la config vive en la RAÍZ del repo
      for (const p of [require("path").join(__dirname, "..", "config.json"), require("path").join(require("os").homedir(), ".knk-suite", "config.json")]) {
        try {
          const cfg = JSON.parse(require("fs").readFileSync(p, "utf8").replace(/^﻿/, ""));
          if (cfg && typeof cfg[CONFIG_KEY] === "string" && cfg[CONFIG_KEY]) {
            require("./lib/net").setProxy(cfg[CONFIG_KEY]);
            console.log("[proxy] salida vía " + cfg[CONFIG_KEY] + " (config.json)");
            break;
          }
        } catch {}
      }
    }
  } catch {}

  // ── Diagnóstico de navegador ────────────────────────────────────────────
  // Los módulos que usan un navegador real (lib/browser.js CDP, BiDi Firefox)
  // heredan el proxy de usuario de Windows, que Node NO usa. Si ese proxy apunta
  // a algo que no escucha, el navegador no carga NADA y el módulo parece "sin
  // hallazgo". Se comprueba al arrancar (1 lectura de registro + 1 connect TCP)
  // y NUNCA bloquea el arranque.
  try {
    const diag = await require('./lib/diagnostico-navegador').diagnosticoNavegador();
    if (diag.ok) {
      console.log(`[navegador] ${diag.resumen}`);
      if (diag.avisos) console.log('[navegador] detalle: node backend/lib/diagnostico-navegador.js');
    } else {
      console.warn(`[navegador] ⛔ ${diag.resumen}`);
      for (const h of diag.hallazgos.filter((x) => x.nivel === 'error')) {
        console.warn(`[navegador]   ${h.codigo}: ${h.mensaje}`);
        if (h.accion) console.warn(`[navegador]   → ${h.accion}`);
      }
    }
  } catch (e) {
    console.warn('[navegador] diagnóstico no disponible:', e.message);
  }

  server.listen(PORT, HOST, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════╗');
    console.log('  ║   🐉 knkLinux // Security Workbench          ║');
    console.log(`  ║   Dashboard → http://${HOST}:${PORT}        ║`);
    console.log(`  ║   Terminal  → ws://${HOST}:${PORT}/ws/terminal ║`);
    console.log('  ╚══════════════════════════════════════════════╝');
    console.log('');
  });
})();

module.exports = { app, server };
