'use strict';

// ============================================================================
// KNK SUITE v2.1 — SQLite Database (sql.js — pure WASM, no native crash)
// ============================================================================

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(require('os').homedir(), '.knk-suite');
fs.mkdirSync(DB_DIR, { recursive: true });

const DB_PATH = process.env.KNK_DB || path.join(DB_DIR, 'suite.db');

const SCHEMA = `
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
  CREATE TABLE IF NOT EXISTS memory (
    id TEXT PRIMARY KEY,
    session_id INTEGER REFERENCES sessions(id),
    key TEXT,
    value TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS terminal_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES sessions(id),
    command TEXT,
    output TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`;

let _db = null;
let _saveTimer = null;

function scheduleSave() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    if (_db) {
      try {
        const data = _db.export();
        fs.writeFileSync(DB_PATH, Buffer.from(data));
      } catch (e) { console.error('DB save error:', e.message); }
    }
  }, 200);
}

function runSql(sql, params = []) {
  try {
    _db.run(sql, params);
    scheduleSave();
    const res = _db.exec('SELECT last_insert_rowid() as id');
    const lastInsertRowid = res.length > 0 ? res[0].values[0][0] : 0;
    return { lastInsertRowid, changes: _db.getRowsModified() };
  } catch (e) {
    console.error('SQL error:', e.message, sql.slice(0, 100));
    return { lastInsertRowid: 0, changes: 0, error: e.message };
  }
}

function queryAll(sql, params = []) {
  try {
    const stmt = _db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  } catch (e) {
    console.error('SQL query error:', e.message, sql.slice(0, 100));
    return [];
  }
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : undefined;
}

function execRaw(sql) {
  try { _db.run(sql); scheduleSave(); } catch (e) { console.error('SQL exec error:', e.message); }
}

// ── Statement wrappers (match better-sqlite3 API) ───────────────
function stmtRunner(sql) { return { run: (...p) => runSql(sql, p) }; }
function stmtGetter(sql) { return { get: (...p) => queryOne(sql, p) }; }
function stmtAller(sql)  { return { all: (...p) => queryAll(sql, p) }; }

// ── Init (must be called before any DB access) ───────────────────
async function initDB() {
  const SQL = await initSqlJs();
  try {
    const buf = fs.readFileSync(DB_PATH);
    _db = new SQL.Database(buf);
  } catch {
    _db = new SQL.Database();
  }
  _db.run('PRAGMA journal_mode = WAL');
  _db.run('PRAGMA foreign_keys = ON');
  _db.run(SCHEMA);
  scheduleSave();
}

// ── Prepared Statements ──────────────────────────────────────────
const stmts = {
  createSession: stmtRunner(`INSERT INTO sessions DEFAULT VALUES`),
  getSession: stmtGetter(`SELECT * FROM sessions WHERE id = ?`),
  getLatestSession: stmtGetter(`SELECT * FROM sessions ORDER BY id DESC LIMIT 1`),
  updateSession: stmtRunner(`
    UPDATE sessions SET target=?, scope=?, user_agent=?, rate_limit_ms=?,
    program_url=?, program_name=?, program_policy=?, out_of_scope=?,
    opplan=?, phases=?, artifacts=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `),
  insertFinding: stmtRunner(`INSERT INTO findings (session_id, type, summary, severity, details) VALUES (?, ?, ?, ?, ?)`),
  getFindings: stmtAller(`SELECT * FROM findings WHERE session_id = ? ORDER BY id DESC`),
  getFinding: stmtGetter(`SELECT * FROM findings WHERE session_id = ? AND id = ?`),
  deleteFindings: stmtRunner(`DELETE FROM findings WHERE session_id = ?`),
  deleteFinding: stmtRunner(`DELETE FROM findings WHERE session_id = ? AND id = ?`),
  insertReport: stmtRunner(`INSERT INTO reports (session_id, slug, data, status) VALUES (?, ?, ?, ?)`),
  getReports: stmtAller(`SELECT * FROM reports WHERE session_id = ? ORDER BY id DESC`),
  getAllReports: stmtAller(`SELECT * FROM reports ORDER BY id DESC`),
  updateReport: stmtRunner(`UPDATE reports SET data=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`),
  insertEvidence: stmtRunner(`INSERT INTO evidence (session_id, report_id, name, type, file_path) VALUES (?, ?, ?, ?, ?)`),
  getEvidence: stmtAller(`SELECT * FROM evidence WHERE session_id = ? ORDER BY id DESC`),
  addMemory: stmtRunner(`INSERT INTO memory (id, session_id, key, value) VALUES (?, ?, ?, ?)`),
  listMemory: stmtAller(`SELECT id, key, value, created_at FROM memory WHERE session_id=? ORDER BY created_at DESC LIMIT 50`),
  delMemory: stmtRunner(`DELETE FROM memory WHERE session_id=? AND id=?`),
  insertTerminalLog: stmtRunner(`INSERT INTO terminal_log (session_id, command, output) VALUES (?, ?, ?)`),
  getTerminalLog: stmtAller(`SELECT * FROM terminal_log WHERE session_id = ? ORDER BY id DESC LIMIT 50`),
};

// ── Helper Functions ─────────────────────────────────────────────
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
    details: typeof f.details === 'string' ? JSON.parse(f.details || '{}') : f.details || {},
  }));
}

function getFinding(sessionId, id) {
  const f = stmts.getFinding.get(sessionId, id);
  if (!f) return null;
  return { ...f, details: typeof f.details === 'string' ? JSON.parse(f.details || '{}') : f.details || {} };
}

/** Evidencia de un hallazgo dentro del directorio de evidencias de la suite. */
function evidenceFilesOf(finding) {
  const d = finding && typeof finding.details === 'object' && finding.details ? finding.details : {};
  const dir = path.join(DB_DIR, 'evidencia');
  const files = []
    .concat(Array.isArray(d.evidence) ? d.evidence : [d.evidence])
    .filter((p) => typeof p === 'string' && p)
    .map((p) => path.resolve(p))
    .filter((p) => p === dir || p.startsWith(dir + path.sep));
  return [...new Set(files)];
}

/**
 * Borra un hallazgo de la sesión y, si la evidencia que generó está dentro de
 * ~/.knk-suite/evidencia, borra también esos ficheros (nunca toca rutas de
 * fuera: un hallazgo importado no puede hacer que se borre algo ajeno).
 */
function removeFinding(sessionId, id, { deleteFiles = true } = {}) {
  const finding = getFinding(sessionId, id);
  if (!finding) return { ok: false, error: 'hallazgo no encontrado', changes: 0 };
  const res = stmts.deleteFinding.run(sessionId, id);
  const deletedFiles = [];
  if (deleteFiles) {
    for (const file of evidenceFilesOf(finding)) {
      try { fs.unlinkSync(file); deletedFiles.push(file); }
      catch { /* el fichero ya no está: el hallazgo sigue borrado */ }
    }
  }
  return { ok: (res.changes || 0) > 0, id, deletedFiles, finding };
}

/** Borra todos los hallazgos de la sesión y su evidencia asociada. */
function clearFindings(sessionId) {
  const all = getFindings(sessionId);
  const deletedFiles = [];
  for (const f of all) {
    for (const file of evidenceFilesOf(f)) {
      try { fs.unlinkSync(file); deletedFiles.push(file); }
      catch { /* ya no existe */ }
    }
  }
  const res = stmts.deleteFindings.run(sessionId);
  return { ok: true, deleted: all.length, deletedFiles };
}

function saveReport(sessionId, slug, data, status = 'borrador') {
  const existingReport = stmts.getReports.all(sessionId).find(r => r.slug === slug);
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
    data: typeof r.data === 'string' ? JSON.parse(r.data || '{}') : r.data || {},
  }));
}

function logTerminal(sessionId, command, output) {
  return stmts.insertTerminalLog.run(sessionId, command, String(output || '').slice(0, 50000));
}

function getTerminalLog(sessionId) {
  return stmts.getTerminalLog.all(sessionId);
}

module.exports = {
  db: { close: () => { if (_saveTimer) clearTimeout(_saveTimer); scheduleSave(); } },
  query: queryAll,
  stmts,
  getOrCreateSession,
  saveSession,
  addFinding,
  getFindings,
  getFinding,
  removeFinding,
  clearFindings,
  evidenceFilesOf,
  saveReport,
  getReports,
  logTerminal,
  getTerminalLog,
  initDB,
};
