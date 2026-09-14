'use strict';

// ============================================================================
// KNK SUITE v2.1 — Módulo de Threat Hunting (defensivo)
// Analiza logs propios o autorizados, busca IoCs y comportamientos anómalos,
// y mapea resultados a MITRE ATT&CK. NO genera tráfico contra terceros:
// solo procesa texto/archivos que el operador le proporciona.
// ============================================================================

const IP_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g;
const DOMAIN_RE = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\b/gi;
const HASH_RE = /\b(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64})\b/g;
const EMAIL_RE = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
const URL_RE = /\bhttps?:\/\/[^\s"'<>]+/gi;

// ── MITRE ATT&CK (mapeo estático reducido, tácticas y técnicas comunes) ──────
const ATTACK = {
  T1110: { name: 'Brute Force', tactic: 'Credential Access' },
  T1190: { name: 'Exploit Public-Facing Application', tactic: 'Initial Access' },
  T1505: { name: 'Server Software Component (Web Shell)', tactic: 'Persistence' },
  T1078: { name: 'Valid Accounts', tactic: 'Defense Evasion' },
  T1059: { name: 'Command and Scripting Interpreter', tactic: 'Execution' },
  T1003: { name: 'OS Credential Dumping', tactic: 'Credential Access' },
  T1046: { name: 'Network Service Scanning', tactic: 'Discovery' },
  T1082: { name: 'System Information Discovery', tactic: 'Discovery' },
  T1071: { name: 'Application Layer Protocol (C2)', tactic: 'Command and Control' },
  T1566: { name: 'Phishing', tactic: 'Initial Access' },
  T1041: { name: 'Exfiltration Over C2 Channel', tactic: 'Exfiltration' },
  T1036: { name: 'Masquerading', tactic: 'Defense Evasion' },
  T1213: { name: 'Data from Information Repositories', tactic: 'Collection' },
};

const ATTACK_HINTS = [
  { re: /brute|many failed|authentication failure.*repeated/i, technique: 'T1110' },
  { re: /sqlmap|nikto|nuclei|masscan|zgrab|nessus|acunetix/i, technique: 'T1190' },
  { re: /shell|\.jsp\.jsp|cmd\.exe|powershell.*-enc|phpinfo\.php/i, technique: 'T1505' },
  { re: /(whoami|uname|id;|hostname|systeminfo)/i, technique: 'T1082' },
  { re: /(lsass|mimikatz|sekurlsa|sam\.dll|ntds\.dit)/i, technique: 'T1003' },
  { re: /(port scan|syn scan|nmap|masscan)/i, technique: 'T1046' },
  { re: /(bash -c|cmd \/c|\/bin\/sh -c|\/bin\/bash -c)/i, technique: 'T1059' },
];

// ── Heurísticas de ataque en logs web/auth ──────────────────────────────────
const PROBE_PATTERNS = [
  { name: 'Path Traversal', re: /(\.\.\/|\.\.\\|%2e%2e\/|%252e|\.\.%2f)/i, technique: 'T1190' },
  { name: 'LFI/RFI', re: /(file:\/\/|php:\/\/filter|base64|expect:\/\/|data:\/\/)/i, technique: 'T1190' },
  { name: 'SQL Injection', re: /(\bunion\s+select\b|'\s*or\s*'1'='1|sleep\s*\(|waitfor\s+delay|--\s*$|;%20drop)/i, technique: 'T1190' },
  { name: 'XSS probe', re: /(<script>|alert\s*\(|<img[^>]+onerror|<svg[^>]+onload)/i, technique: 'T1190' },
  { name: 'SSRF probe', re: /(169\.254\.169\.254|127\.0\.0\.1|localhost|metadata\.google)/i, technique: 'T1190' },
  { name: 'Web shell upload', re: /(\.php\.|\.jsp\.|\.asp\.|shell\.php|cmd\.php)/i, technique: 'T1505' },
  { name: 'Git/source exposure', re: /(\.git\/config|\.env|\.aws\/credentials|server-status|\.DS_Store)/i, technique: 'T1190' },
];

const ATTACKER_UA = /(sqlmap|nikto|nuclei|masscan|zgrab|nessus|acunetix|wpscan|dirbuster|gobuster|hydra|medusa)/i;

// ── IoC parsing ─────────────────────────────────────────────────────────────
function parseIocs(text) {
  const source = String(text || '');
  const iocs = {
    ips: [...new Set((source.match(IP_RE) || []).map(x => x.toLowerCase()))],
    domains: [...new Set((source.match(DOMAIN_RE) || []).map(x => x.toLowerCase()))],
    hashes: [...new Set((source.match(HASH_RE) || []).map(x => x.toLowerCase()))],
    emails: [...new Set((source.match(EMAIL_RE) || []).map(x => x.toLowerCase()))],
    urls: [...new Set((source.match(URL_RE) || []).map(x => x.toLowerCase()))],
  };
  iocs.total = iocs.ips.length + iocs.domains.length + iocs.hashes.length + iocs.emails.length + iocs.urls.length;
  return iocs;
}

// ── Búsqueda de IoCs en logs ────────────────────────────────────────────────
function huntIocs(logText, iocs, opts = {}) {
  const lines = String(logText || '').split(/\r?\n/);
  const matches = [];
  const set = (arr) => new Set((arr || []).map(x => String(x).toLowerCase()));
  const ips = set(iocs.ips); const domains = set(iocs.domains);
  const hashes = set(iocs.hashes); const emails = set(iocs.emails); const urls = set(iocs.urls);

  lines.forEach((line, idx) => {
    if (!line.trim()) return;
    const lower = line.toLowerCase();
    const hits = [];
    for (const ip of ips) if (lower.includes(ip)) hits.push(ip);
    for (const d of domains) if (lower.includes(d)) hits.push(d);
    for (const h of hashes) if (lower.includes(h)) hits.push(h);
    for (const e of emails) if (lower.includes(e)) hits.push(e);
    for (const u of urls) if (lower.includes(u)) hits.push(u);
    if (hits.length) matches.push({ line: idx + 1, hits: [...new Set(hits)], line_text: line.slice(0, opts.truncate || 500) });
  });
  return { total_matches: matches.length, matches: matches.slice(0, opts.limit || 500) };
}

// ── Detección de anomalías ──────────────────────────────────────────────────
function huntAnomalies(logText, opts = {}) {
  const lines = String(logText || '').split(/\r?\n/);
  const alerts = [];
  const add = (severity, title, detail, technique, line) => alerts.push({ severity, title, detail, technique, line });

  const failedByIp = {};
  const failedByUser = {};
  const statusByIp = {};
  const requestsByPath = {};
  const uaByIp = {};
  const bodyByIp = {};
  const beaconCandidates = {};
  const outOfScopeProbes = [];

  lines.forEach((line, idx) => {
    if (!line.trim()) return;
    const lower = line.toLowerCase();

    // Patrones de probe conocidos
    for (const p of PROBE_PATTERNS) {
      if (p.re.test(lower)) {
        add('high', `Probe detectado: ${p.name}`, line.slice(0, 300), p.technique, idx + 1);
        break;
      }
    }

    // User-Agent de escáner
    if (ATTACKER_UA.test(lower)) {
      add('medium', 'User-Agent de escáner/ataque', line.slice(0, 300), 'T1190', idx + 1);
    }

    // Auth: intentos fallidos
    if (/(failed password|authentication failure|invalid username|login failed)/i.test(lower)) {
      const ip = (line.match(IP_RE) || [])[0] || 'unknown';
      failedByIp[ip] = (failedByIp[ip] || 0) + 1;
      const user = (line.match(/(?:user|username)\s*[:=]\s*([^\s,]+)/i) || [])[1] || 'unknown';
      failedByUser[user] = (failedByUser[user] || 0) + 1;
    }

    // Status por IP (probing)
    const statusMatch = line.match(/["\s](40[13]|500)\s*["\s]?/);
    if (statusMatch) {
      const ip = (line.match(IP_RE) || [])[0];
      if (ip) statusByIp[ip] = (statusByIp[ip] || 0) + 1;
    }

    // Paths repetidos (beacon C2 básico)
    const pathMatch = line.match(/"(GET|POST|PUT)\s+([^"\s?]+)/i);
    if (pathMatch) {
      const p = pathMatch[2];
      requestsByPath[p] = requestsByPath[p] || { count: 0, times: [] };
      requestsByPath[p].count++;
      const t = (line.match(/\[(\d{2}\/[A-Za-z]{3}\/\d{4}:\d{2}:\d{2})/) || [])[1] || (line.match(/(\d{2}:\d{2}:\d{2})/) || [])[1];
      if (t) requestsByPath[p].times.push(t);
    }

    // Destinos sensibles fuera de rango habitual
    if (/(\/admin|\/api\/v1\/(users|tokens|config)|\/server-status|\/\.env)/i.test(lower)) {
      outOfScopeProbes.push({ line: idx + 1, snippet: line.slice(0, 200) });
    }
  });

  // Umbrales (configurables)
  const bruteThreshold = opts.bruteThreshold || 5;
  const beaconThreshold = opts.beaconThreshold || 10;

  for (const [ip, count] of Object.entries(failedByIp)) {
    if (count >= bruteThreshold) add('high', `Posible fuerza bruta desde ${ip}`, `${count} intentos fallidos`, 'T1110', null);
  }
  for (const [user, count] of Object.entries(failedByUser)) {
    if (count >= bruteThreshold) add('medium', `Cuenta bajo ataque: ${user}`, `${count} intentos fallidos`, 'T1110', null);
  }
  for (const [path, info] of Object.entries(requestsByPath)) {
    if (info.count >= beaconThreshold) {
      const interval = estimateInterval(info.times);
      add('medium', `Tráfico repetido a ${path}`, `${info.count} peticiones (intervalo estimado ${interval})`, 'T1071', null);
    }
  }

  const summary = {
    alerts,
    counts: {
      high: alerts.filter(a => a.severity === 'high').length,
      medium: alerts.filter(a => a.severity === 'medium').length,
      low: alerts.filter(a => a.severity === 'low').length,
    },
    brute_force_sources: Object.entries(failedByIp).sort((a, b) => b[1] - a[1]).slice(0, 10),
    sensitive_endpoints_touched: outOfScopeProbes.slice(0, 20),
  };
  return summary;
}

function estimateInterval(times) {
  if (times.length < 3) return 'insuficiente';
  const seconds = [];
  for (let i = 1; i < times.length; i++) {
    const [h1, m1, s1] = times[i - 1].split(':').map(Number);
    const [h2, m2, s2] = times[i].split(':').map(Number);
    const diff = (h2 * 3600 + m2 * 60 + s2) - (h1 * 3600 + m1 * 60 + s1);
    if (diff >= 0 && diff < 3600) seconds.push(diff);
  }
  if (!seconds.length) return 'insuficiente';
  const avg = seconds.reduce((a, b) => a + b, 0) / seconds.length;
  if (avg === 0) return 'constante (<1s)';
  return `~${avg.toFixed(1)}s`;
}

// ── Mapeo a MITRE ATT&CK ────────────────────────────────────────────────────
function mapToMitre(alerts) {
  const techMap = {};
  for (const a of alerts || []) {
    if (!a.technique) continue;
    techMap[a.technique] = (techMap[a.technique] || 0) + 1;
  }
  return Object.entries(techMap).map(([id, count]) => ({
    id,
    name: ATTACK[id]?.name || 'Técnica desconocida',
    tactic: ATTACK[id]?.tactic || 'Desconocida',
    hits: count,
  })).sort((a, b) => b.hits - a.hits);
}

function suggestMitre(text) {
  const found = new Set();
  for (const hint of ATTACK_HINTS) if (hint.re.test(String(text || ''))) found.add(hint.technique);
  return [...found].map(id => ({ id, name: ATTACK[id]?.name, tactic: ATTACK[id]?.tactic }));
}

module.exports = { parseIocs, huntIocs, huntAnomalies, mapToMitre, suggestMitre, ATTACK };
