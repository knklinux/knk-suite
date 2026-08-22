'use strict';

// ============================================================================
// KNK SUITE v2 — Google Dorks (catálogo + búsqueda DDG/Bing)
// ============================================================================

const { getText, qs } = require('./net');

const SEARCH_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';

const CATALOG = [
  { id: 'subdominios', dorks: ['site:*.{d} -www', 'site:{d}'] },
  { id: 'archivos-expuestos', dorks: ['site:{d} ext:pdf', 'site:{d} ext:sql', 'site:{d} ext:log', 'site:{d} ext:env', 'site:{d} ext:bak', 'site:{d} ext:config', 'site:{d} ext:xml', 'site:{d} ext:json', 'site:{d} ext:yml', 'site:{d} ext:ini'] },
  { id: 'paneles-admin', dorks: ['site:{d} inurl:admin', 'site:{d} inurl:login', 'site:{d} inurl:dashboard', 'site:{d} intitle:"admin panel"'] },
  { id: 'config-backups', dorks: ['site:{d} inurl:backup', 'site:{d} inurl:.git', 'site:{d} ".env"', 'site:{d} "DB_PASSWORD"', 'site:{d} "wp-config.php"'] },
  { id: 'git-y-codigo', dorks: ['site:github.com {d}', 'site:gitlab.com {d}', 'site:pastebin.com {d}'] },
  { id: 'cloud-buckets', dorks: ['site:s3.amazonaws.com {d}', 'site:storage.googleapis.com {d}', 'site:blob.core.windows.net {d}'] },
  { id: 'apis-y-keys', dorks: ['site:{d} inurl:api', 'site:{d} "api_key"', 'site:{d} "Authorization:"', 'site:{d} "Bearer"'] },
  { id: 'emails-osint', dorks: ['site:{d} "@{d}"', 'site:{d} intext:"@{d}"'] },
  { id: 'errores-info', dorks: ['site:{d} "stack trace"', 'site:{d} "debug"', 'site:{d} "exception"', 'site:{d} "sql syntax"', 'site:{d} intext:"Warning:"'] },
  { id: 'dashboards', dorks: ['site:{d} intitle:grafana', 'site:{d} intitle:kibana', 'site:{d} intitle:"phpinfo"', 'site:{d} inurl:phpinfo.php'] },
  { id: 'tecnologias', dorks: ['site:{d} "powered by"', 'site:{d} "generator"', 'site:{d} inurl:wp-content'] },
  { id: 'interesantes', dorks: ['site:{d} inurl:upload', 'site:{d} inurl:shell', 'site:{d} inurl:cmd', 'site:{d} "password" filetype:txt'] },
];

function categories() { return CATALOG.map(c => c.id); }

function fill(dork, domain) { return dork.replace(/\{d\}/g, domain); }

function generateAll(domain) {
  const out = [];
  for (const cat of CATALOG) for (const d of cat.dorks) out.push({ categoria: cat.id, dork: fill(d, domain) });
  return out;
}

function generateCategory(domain, catId) {
  const cat = CATALOG.find(c => c.id === catId);
  if (!cat) return [];
  return cat.dorks.map(d => ({ categoria: cat.id, dork: fill(d, domain) }));
}

async function _ddg(dork, limit) {
  const urls = [];
  const html = await getText(`https://html.duckduckgo.com/html/?q=${qs(dork)}`, {
    headers: { 'User-Agent': SEARCH_UA }, timeoutMs: 20000,
  });
  if (/anomaly|challenge/i.test(html)) return urls;
  const re = /class="result__a"[^>]*href="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null && urls.length < limit) {
    let href = m[1];
    if (href.startsWith('//')) href = 'https:' + href;
    try {
      const u = new URL(href);
      if (u.hostname.includes('duckduckgo.com') && u.searchParams.has('uddg')) {
        urls.push(decodeURIComponent(u.searchParams.get('uddg')));
      } else if (u.protocol === 'http:' || u.protocol === 'https:') {
        urls.push(href);
      }
    } catch { /* skip */ }
  }
  return urls;
}

async function _bing(dork, limit) {
  const urls = [];
  const html = await getText(`https://www.bing.com/search?q=${qs(dork)}`, {
    headers: { 'User-Agent': SEARCH_UA }, timeoutMs: 20000,
  });
  const re = /<cite[^>]*>(.*?)<\/cite>/g;
  let m;
  while ((m = re.exec(html)) !== null && urls.length < limit) {
    const raw = m[1].replace(/<[^>]+>/g, '').replace(/\s*›\s*/g, '/').trim();
    if (raw.startsWith('http')) urls.push(raw);
    else if (raw && /^[a-z0-9.-]+\.[a-z]{2,}/i.test(raw)) urls.push('https://' + raw);
  }
  return urls;
}

async function searchDork(dork, limit = 20) {
  let urls = await _ddg(dork, limit);
  if (!urls.length) urls = await _bing(dork, limit);
  return urls;
}

async function runCategory(domain, catId, limit = 10) {
  const dorks = generateCategory(domain, catId);
  const results = [];
  for (const item of dorks) {
    const urls = await searchDork(item.dork, limit);
    results.push({ dork: item.dork, urls });
    await new Promise(r => setTimeout(r, 1500));
  }
  return results;
}

module.exports = { CATALOG, categories, generateAll, generateCategory, searchDork, runCategory };