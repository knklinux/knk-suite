'use strict';

// ============================================================================
// KNK SUITE v2.1 — SQLite Database
// ============================================================================

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(require('os').homedir(), '.knk-suite');
fs.mkdirSync(DB_DIR, { recursive: true });

const DB_PATH = process.env.KNK_DB || path.join(DB_DIR, 'suite.db');
const db = new Database(DB_PATH);

// WAL mode for better concurrent access
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ──────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target TEXT,
    scope TEXT DEFAULT '[]',
    user_agent TEXT,
    rate_limit_ms INTEGER DEFAULT 2000,
    program_url TEXT,
    program_name TEXT,
    program_policy TEXT,
    out_of_scope TEXT DEFAULT '[]',
    opplan TEXT DEFAULT '{}',
    phases TEXT DEFAULT '{}',
    artifacts TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS findings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES sessions(id),
    type TEXT,
    summary TEXT,
    severity TEXT DEFAULT 'info',
    details TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES sessions(id),
    slug TEXT,
    data TEXT DEFAULT '{}',
    status TEXT DEFAULT 'borrador',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES sessions(id),
    report_id INTEGER REFERENCES reports(id),
    name TEXT,
    type TEXT,
    file_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS terminal_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES sessions(id),
    command TEXT,
    output TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ── Prepared Statements ─────────────────────────────
const stmts = {
  // Sessions
  createSession: db.prepare(`INSERT INTO sessions DEFAULT VALUES`),
  getSession: db.prepare(`SELECT * FROM sessions WHERE id = ?`),
  getLatestSession: db.prepare(`SELECT * FROM sessions ORDER BY id DESC LIMIT 1`),
  updateSession: db.prepare(`
    UPDATE sessions SET target=?, scope=?, user_agent=?, rate_limit_ms=?,
    program_url=?, program_name=?, program_policy=?, out_of_scope=?,
    opplan=?, phases=?, artifacts=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `),

  // Findings
  insertFinding: db.prepare(`INSERT INTO findings (session_id, type, summary, severity, details) VALUES (?, ?, ?, ?, ?)`),
  getFindings: db.prepare(`SELECT * FROM findings WHERE session_id = ? ORDER BY id DESC`),
  deleteFindings: db.prepare(`DELETE FROM findings WHERE session_id = ?`),

  // Reports
  insertReport: db.prepare(`INSERT INTO reports (session_id, slug, data, status) VALUES (?, ?, ?, ?)`),
  getReports: db.prepare(`SELECT * FROM reports WHERE session_id = ? ORDER BY id DESC`),
  getAllReports: db.prepare(`SELECT * FROM reports ORDER BY id DESC`),
  updateReport: db.prepare(`UPDATE reports SET data=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`),

  // Evidence
  insertEvidence: db.prepare(`INSERT INTO evidence (session_id, report_id, name, type, file_path) VALUES (?, ?, ?, ?, ?)`),
  getEvidence: db.prepare(`SELECT * FROM evidence WHERE session_id = ?`),

  // Terminal log
  insertTerminalLog: db.prepare(`INSERT INTO terminal_log (session_id, command, output) VALUES (?, ?, ?)`),
  getTerminalLog: db.prepare(`SELECT * FROM terminal_log WHERE session_id = ? ORDER BY id DESC LIMIT 50`),
};

// ── Helper Functions ────────────────────────────────
function getOrCreateSession(id) {
  if (id) return stmts.getSession.get(id);
  let s = stmts.getLatestSession.get();
  if (!s) {
    const r = stmts.createSession.run();
    s = stmts.getSession.get(r.lastInsertRowid);
  }
  return s;
}

function saveSession(id, data) {
  stmts.updateSession.run(
    data.target || null,
    JSON.stringify(data.scope || []),
    data.user_agent || null,
    data.rate_limit_ms || 2000,
    data.program_url || null,
    data.program_name || null,
    data.program_policy || null,
    JSON.stringify(data.out_of_scope || []),
    JSON.stringify(data.opplan || {}),
    JSON.stringify(data.phases || {}),
    JSON.stringify(data.artifacts || {}),
    id
  );
}

function addFinding(sessionId, type, summary, severity = 'info', details = {}) {
  return stmts.insertFinding.run(sessionId, type, summary, severity, JSON.stringify(details));
}

function getFindings(sessionId) {
  return stmts.getFindings.all(sessionId).map(f => ({
    ...f,
    details: JSON.parse(f.details || '{}'),
  }));
}

function saveReport(sessionId, slug, data, status = 'borrador') {
  const existing = stmts.getAllReports.get();
  // Check if slug already exists
  const all = stmts.getAllReports.all();
  const existingReport = all.find(r => r.slug === slug);
  if (existingReport) {
    stmts.updateReport.run(JSON.stringify(data), status, existingReport.id);
    return existingReport.id;
  }
  const r = stmts.insertReport.run(sessionId, slug, JSON.stringify(data), status);
  return r.lastInsertRowid;
}

function getReports(sessionId) {
  return stmts.getReports.all(sessionId).map(r => ({
    ...r,
    data: JSON.parse(r.data || '{}'),
  }));
}

function logTerminal(sessionId, command, output) {
  return stmts.insertTerminalLog.run(sessionId, command, output.slice(0, 50000));
}

function getTerminalLog(sessionId) {
  return stmts.getTerminalLog.all(sessionId);
}

module.exports = {
  db,
  stmts,
  getOrCreateSession,
  saveSession,
  addFinding,
  getFindings,
  saveReport,
  getReports,
  logTerminal,
  getTerminalLog,
};