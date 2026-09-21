'use strict';

// ============================================================================
// pty-manager.js — Sesiones de terminal persistentes por runtime.
//
// Problema que resuelve: cada conexión WS creaba una PTY nueva, así que al
// mandar un comando desde otro módulo y abrir la Terminal después, la salida
// ya no existía. Ahora la PTY vive en el backend indexada por runtime:
// reconectar reengancha la misma sesión y reenvía el historial (ring buffer).
// Las sesiones ociosas +30 min sin clientes se cierran solas.
// ============================================================================

const IDLE_KILL_MS = 30 * 60 * 1000;
const BACKLOG_LINES = 500;

const sessions = new Map(); // key -> { pty, clients:Set, backlog:[], lastActive }

function keyFor(term) {
  const tab = String(term.tab || 'main').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'main';
  return `${term.runtime || 'local'}::${term.shell}::${(term.shellArgs || []).join(' ')}::${tab}`;
}

function pushLine(sess, data) {
  const parts = String(data).split(/\r?\n/);
  for (const line of parts) {
    sess.backlog.push(line);
    if (sess.backlog.length > BACKLOG_LINES) sess.backlog.splice(0, sess.backlog.length - BACKLOG_LINES);
  }
  sess.lastActive = Date.now();
}

function broadcast(sess, message) {
  const text = JSON.stringify(message);
  for (const ws of sess.clients) {
    try { if (ws.readyState === 1) ws.send(text); } catch {}
  }
}

function attach(key, ws) {
  const sess = sessions.get(key);
  if (!sess || !sess.pty) return null;
  sess.clients.add(ws);
  sess.lastActive = Date.now();
  return sess;
}

function create(key, ptyProcess) {
  const sess = { pty: ptyProcess, clients: new Set(), backlog: [], lastActive: Date.now() };
  sessions.set(key, sess);
  ptyProcess.onData((data) => {
    pushLine(sess, data);
    broadcast(sess, { type: 'output', data });
  });
  ptyProcess.onExit(({ exitCode }) => {
    broadcast(sess, { type: 'exit', code: exitCode });
    destroy(key);
  });
  return sess;
}

function detach(key, ws) {
  const sess = sessions.get(key);
  if (!sess) return;
  sess.clients.delete(ws);
}

function destroy(key) {
  const sess = sessions.get(key);
  if (!sess) return;
  sessions.delete(key);
  try { sess.pty.kill(); } catch {}
}

function reapIdle() {
  const now = Date.now();
  for (const [key, sess] of sessions) {
    if (sess.clients.size === 0 && now - sess.lastActive > IDLE_KILL_MS) destroy(key);
  }
}

setInterval(reapIdle, 5 * 60 * 1000).unref?.();

function stats() {
  return [...sessions.entries()].map(([key, sess]) => ({
    key, clients: sess.clients.size, backlog: sess.backlog.length, idleSec: Math.round((Date.now() - sess.lastActive) / 1000),
  }));
}

module.exports = { keyFor, attach, create, detach, destroy, stats };
