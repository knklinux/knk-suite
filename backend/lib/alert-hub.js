'use strict';

// ============================================================================
// alert-hub.js — Singleton de alertas para el centro de notificaciones.
// Emite al WS /ws/alerts y guarda historial para GET /api/alerts.
// Formato frontal: {title, message, severity, source, type, timestamp}.
// ============================================================================

const { AlertManager } = require('./alerts');

let manager = null;
const seen = new Set();

function get() {
  if (!manager) manager = new AlertManager(null);
  return manager;
}

function emit(type, { title, message, severity, source } = {}) {
  const map = {
    scan_complete: { title: title || 'Escaneo completado', severity: severity || 'info' },
    vulnerability_found: { title: title || 'Vulnerabilidad', severity: severity || 'high' },
    tool_installed: { title: title || 'Herramienta instalada', severity: severity || 'success' },
    error: { title: title || 'Error', severity: severity || 'error' },
    info: { title: title || 'Info', severity: severity || 'info' },
  };
  const m = map[type] || map.info;
  // Dedupe ráfagas idénticas (misma firma en 5 s).
  const sig = `${type}|${m.title}|${message || ''}`;
  const now = Date.now();
  for (const [k, at] of seen) if (now - at > 5000) seen.delete(k);
  if (seen.has(sig)) return null;
  seen.add(sig);
  return get().emit(type, {
    title: m.title, message: message || '', severity: m.severity,
    source: source || 'system', timestamp: new Date(now).toISOString(),
  });
}

function history(limit = 100) {
  return get().history(limit);
}

function clear() {
  get().items.length = 0;
  return { ok: true };
}

function attach(ws) {
  const mgr = get();
  mgr.subscribe(ws);
  ws.on('close', () => mgr.unsubscribe(ws));
}

module.exports = { emit, history, clear, attach, get };
