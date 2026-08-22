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
  try {
    if (!file) file = DEFAULT_FILE;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    session.updatedAt = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(session, null, 2), 'utf8');
    return true;
  } catch { return false; }
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