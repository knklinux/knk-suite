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
const wssAlerts = new WebSocketServer({ server, path: '/ws/alerts' });
wssAlerts.on('connection', async (ws, req) => {
  if (!auth.authorize({ headers: req.headers, socket: req.socket })) {
    try { ws.close(1008, 'No autorizado'); } catch {}
    return;
  }
  alertHub.attach(ws);
  try { ws.send(JSON.stringify({ type: 'info', severity: 'info', title: 'Conectado', message: 'Stream de alertas activo', source: 'system', timestamp: new Date().toISOString() })); } catch {}
});

// ── WebSocket Terminal ──────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws/terminal' });

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
    const choice = new URL(req.url, 'http://x').searchParams.get('runtime') || 'auto';
    const st = await kali.detect();
    const term = kali.pickTerminal(choice, st);
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
