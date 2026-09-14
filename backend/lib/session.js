'use strict';

// ============================================================================
// KNK SUITE v2 — Sesión persistente
// ============================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_DIR = path.join(os.homedir(), '.knk-suite');
const DEFAULT_FILE = path.join(DEFAULT_DIR, 'session.json');
const MAX_CHAT = 60;

function defaultSession() {
  return {
    version: 3,
    target: null,
    scope: [],
    opplan: null,
    notes: [],
    findings: [],
    chatHistory: [],
    artifacts: {},
    phases: {},
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function load(file = DEFAULT_FILE) {
  try {
    if (!fs.existsSync(file)) return defaultSession();
    return { ...defaultSession(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch { return defaultSession(); }
}

function save(file, session) {
  // Guardia contra persistencia silenciosa: save(file, session) — el 1er arg es
  // el ARCHIVO y el 2º la SESIÓN. Llamar save() sin la sesión (bug histórico que
  // hizo perder cierres/notas) lanza error en vez de devolver false en silencio.
  if (arguments.length < 2 || !session || typeof session !== 'object') {
    throw new Error('save(file, session): falta la sesión (2º argumento). Firmas válidas: save(file, session) o save(DEFAULT_FILE, s).');
  }
  try {
    if (!file) file = DEFAULT_FILE;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    session.updatedAt = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(session, null, 2), 'utf8');
    return true;
  } catch (e) {
    // Error real de escritura (permisos/disco): no silenciar, devolver false
    // para que el llamador lo detecte (los scripts .cjs ya comprueban el retorno).
    console.error('[session.save] error escribiendo ' + file + ': ' + e.message);
    return false;
  }
}

function addFinding(session, finding) {
  session.findings.push({ ...finding, at: new Date().toISOString(), id: `F-${session.findings.length + 1}` });
}

function setArtifact(session, key, value) { session.artifacts[key] = value; }

function addNote(session, text) { session.notes.push({ text, at: new Date().toISOString() }); }

function pushChat(session, role, text) {
  session.chatHistory.push({ role, text, at: new Date().toISOString() });
  if (session.chatHistory.length > MAX_CHAT) session.chatHistory = session.chatHistory.slice(-MAX_CHAT);
}

function setPhase(session, phaseId, data) {
  session.phases[phaseId] = { ...data, at: new Date().toISOString() };
}

function summary(session) {
  return [
    `🎯 ${session.target || '(sin objetivo)'}`,
    `📍 Scope: ${session.scope.join(', ') || '(sin definir)'}`,
    `📋 OPPLAN: ${session.opplan ? `[${session.opplan.status}] ${session.opplan.nombre}` : 'sin definir'}`,
    `🐞 Hallazgos: ${session.findings.length}`,
    `🕐 ${session.startedAt}`,
  ].join('\n');
}

module.exports = { DEFAULT_DIR, DEFAULT_FILE, defaultSession, load, save, addFinding, setArtifact, addNote, pushChat, setPhase, summary };