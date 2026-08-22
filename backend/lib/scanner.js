'use strict';

// ============================================================================
// KNK SUITE v2 — Scanner (headers seguridad, CORS, CVEs NVD)
// ============================================================================

const { fetch, getJson } = require('./net');

const SECURITY_HEADERS = [
  { name: 'strict-transport-security', label: 'Strict-Transport-Security' },
  { name: 'content-security-policy', label: 'Content-Security-Policy' },
  { name: 'x-frame-options', label: 'X-Frame-Options' },
  { name: 'x-content-type-options', label: 'X-Content-Type-Options' },
  { name: 'referrer-policy', label: 'Referrer-Policy' },
  { name: 'permissions-policy', label: 'Permissions-Policy' },
];

async function securityHeaders(url) {
  const r = await fetch(url, { timeoutMs: 20000 });
  const h = r.headers || {};
  const present = [], missing = [];
  for (const sh of SECURITY_HEADERS) {
    if (h[sh.name]) present.push({ ...sh, value: String(h[sh.name]).slice(0, 120) });
    else missing.push(sh);
  }
  return { url, status: r.status, present, missing };
}

async function corsProbe(url) {
  const evil = 'https://evil.example';
  const r = await fetch(url, {
    headers: { Origin: evil, 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/131.0 Safari/537.36' },
    timeoutMs: 20000,
  });
  const h = r.headers || {};
  const acao = String(h['access-control-allow-origin'] || '');
  const acac = String(h['access-control-allow-credentials'] || '');
  return {
    url, status: r.status,
    acao: acao || '(sin ACAO)',
    acac: acac || '(sin ACAC)',
    reflected: acao.includes(evil),
    credentials: acac.toLowerCase() === 'true',
    suspicious: acao.includes(evil) && acac.toLowerCase() === 'true',
  };
}

async function nvdCves(keyword, limit = 6) {
  try {
    const data = await getJson(
      `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(keyword)}&resultsPerPage=50`,
      { timeoutMs: 25000, headers: { 'User-Agent': 'knk-suite/2.0' } }
    );
    const vulns = (data.vulnerabilities || []).map(v => {
      const c = v.cve; const m = c.metrics || {};
      let severity = 'N/A', score = null;
      const v3 = m.cvssMetricV31 || m.cvssMetricV30;
      if (v3 && v3[0]) { score = v3[0].cvssData.baseScore; severity = v3[0].cvssData.baseSeverity || 'N/A'; }
      return { id: c.id, published: (c.published || '').slice(0, 10), severity, score, description: (c.descriptions?.[0]?.value || '').slice(0, 200) };
    });
    return vulns.sort((a, b) => a.published < b.published ? 1 : -1).slice(0, limit);
  } catch { return []; }
}

module.exports = { securityHeaders, corsProbe, nvdCves, SECURITY_HEADERS };