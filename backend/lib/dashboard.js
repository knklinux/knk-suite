'use strict';

const STARTUP = Date.now();

function getStats(db) {
  const totalSessions = (db.query('SELECT COUNT(*) as c FROM sessions')[0] || {}).c || 0;
  const totalFindings = (db.query('SELECT COUNT(*) as c FROM findings')[0] || {}).c || 0;
  const totalReports = (db.query('SELECT COUNT(*) as c FROM reports')[0] || {}).c || 0;

  const sevRows = db.query('SELECT severity, COUNT(*) as c FROM findings GROUP BY severity');
  const findingsBySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const r of sevRows) {
    const k = r.severity || 'info';
    if (k in findingsBySeverity) findingsBySeverity[k] = r.c;
  }

  const recentRows = db.query(
    `SELECT 'finding' as type, type || ': ' || summary as message, created_at as timestamp FROM findings
     UNION ALL
     SELECT 'session' as type, 'Sesión #' || id || COALESCE(' — ' || target, '') as message, created_at as timestamp
     UNION ALL
     SELECT 'report' as type, 'Reporte ' || slug || ' (' || status || ')' as message, created_at as timestamp
     ORDER BY timestamp DESC LIMIT 10`
  );
  const recentActivity = recentRows.map(r => ({
    type: r.type,
    message: r.message,
    timestamp: r.timestamp,
  }));

  return {
    totalSessions,
    totalFindings,
    totalReports,
    findingsBySeverity,
    recentActivity,
    uptimeSeconds: Math.floor((Date.now() - STARTUP) / 1000),
  };
}

function getTimeline(db, days = 7) {
  const rows = db.query(
    `SELECT date(f.created_at) as day, COUNT(f.id) as findings, COUNT(DISTINCT f.session_id) as sessions
     FROM findings f
     WHERE f.created_at >= datetime('now', '-' || ? || ' days')
     GROUP BY date(f.created_at)
     ORDER BY day ASC`,
    [days]
  );

  const map = {};
  for (const r of rows) {
    map[r.day] = { day: r.day, findings: r.findings, sessions: r.sessions };
  }

  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    result.push(map[key] || { day: key, findings: 0, sessions: 0 });
  }
  return result;
}

function getTopTargets(db, limit = 10) {
  return db.query(
    `SELECT target, COUNT(*) as scanCount, MAX(created_at) as lastScan
     FROM sessions
     WHERE target IS NOT NULL AND target != ''
     GROUP BY target
     ORDER BY scanCount DESC
     LIMIT ?`,
    [limit]
  );
}

module.exports = { getStats, getTimeline, getTopTargets };
