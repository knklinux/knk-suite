'use strict';

// ============================================================================
// KNK SUITE v2 — Recon pasivo (crt.sh, wayback, tech detect)
// ============================================================================

const dns = require('dns').promises;
const { getJson, getText, qs, normalizeHost, fetch } = require('./net');

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

async function subdomains(domain) {
  const host = normalizeHost(domain);
  if (!host) return [];
  const out = new Set();
  // crt.sh
  try {
    const data = await getJson(`https://crt.sh/?q=${qs('%.' + host)}&output=json`, { timeoutMs: 60000 });
    if (Array.isArray(data)) {
      for (const row of data) {
        for (const n of String(row.name_value || '').split('\n')) {
          const clean = normalizeHost(n);
          if (clean && (clean === host || clean.endsWith('.' + host))) out.add(clean);
        }
      }
    }
  } catch { /* fallback */ }
  // hackertarget fallback
  if (out.size === 0) {
    const text = await getText(`https://api.hackertarget.com/hostsearch/?q=${host}`, { timeoutMs: 20000 });
    if (text && !text.includes('error')) {
      for (const line of text.split('\n')) {
        const h = normalizeHost(line.split(',')[0]);
        if (h) out.add(h);
      }
    }
  }
  return [...out].sort();
}

// Devuelve los destinos CNAME encadenados de un host, sin generar tráfico HTTP.
// Un DNS que no tenga CNAME devuelve una cadena vacía; el límite evita bucles.
async function cnameChain(host, maxHops = 8) {
  let current = normalizeHost(host).replace(/\.$/, '');
  const chain = [];
  const seen = new Set();
  for (let hop = 0; current && hop < maxHops && !seen.has(current); hop++) {
    seen.add(current);
    let aliases;
    try {
      // DNS también es interacción de red: respeta el mismo limiter global.
      const netMod = require('./net');
      await netMod.waitForSlot();
      aliases = await dns.resolveCname(current);
    } catch {
      break;
    }
    const next = normalizeHost(aliases[0] || '').replace(/\.$/, '');
    if (!next || next === current) break;
    chain.push(next);
    current = next;
  }
  return chain;
}

async function cnameChains(hosts) {
  const out = {};
  for (const host of (Array.isArray(hosts) ? hosts.slice(0, 50) : [])) {
    const chain = await cnameChain(host);
    if (chain.length) out[normalizeHost(host)] = chain;
  }
  return out;
}

async function wayback(domain, limit = 300) {
  const host = normalizeHost(domain);
  if (!host) return [];
  const url = `http://web.archive.org/cdx/search/cdx?url=${qs(host + '/*')}&output=json&fl=original&collapse=urlkey&filter=statuscode:200&limit=${limit}`;
  const data = await getJson(url, { timeoutMs: 30000 });
  if (!Array.isArray(data) || data.length < 2) return [];
  return data.slice(1).map(row => row[0]).filter(u => typeof u === 'string' && u.startsWith('http'));
}

async function techDetect(url) {
  const tech = new Set();
  const r = await fetch(url, { timeoutMs: 20000 });
  const h = r.headers || {};
  const srv = String(h['server'] || '');
  const powered = String(h['x-powered-by'] || '');
  if (srv) tech.add(`server:${srv}`);
  if (powered) tech.add(`x-powered-by:${powered}`);

  const body = (r.text || '').toLowerCase();
  const fps = [
    [/wp-content|wordpress/i, 'WordPress'], [/drupal/i, 'Drupal'], [/joomla/i, 'Joomla'],
    [/shopify/i, 'Shopify'], [/__next|_next\/static/i, 'Next.js'],
    [/ng-version|angular/i, 'Angular'], [/react|__react/i, 'React'],
    [/vue\.js|__vue__/i, 'Vue.js'], [/jquery/i, 'jQuery'],
    [/bootstrap/i, 'Bootstrap'], [/tailwind/i, 'Tailwind CSS'],
    [/laravel/i, 'Laravel'], [/csrf-token/i, 'ASP.NET'],
    [/django/i, 'Django'], [/flask/i, 'Flask'], [/express/i, 'Express.js'],
    [/cloudflare/i, 'Cloudflare'], [/akamai/i, 'Akamai'],
    [/aws|amazon/i, 'AWS'], [/azure/i, 'Azure'],
  ];
  for (const [re, name] of fps) {
    if (re.test(body) || re.test(srv + ' ' + powered)) tech.add(name);
  }
  if (/PHPSESSID/.test(String(h['set-cookie'] || ''))) tech.add('PHP');
  if (h['strict-transport-security']) tech.add('HSTS habilitado');
  return { url, status: r.status, tech: [...tech], headers: h };
}

async function emails(domain, limit = 10) {
  const host = normalizeHost(domain);
  if (!host) return [];
  const found = new Set();
  const html = await getText(`https://html.duckduckgo.com/html/?q=${qs('intext:"@' + host + '"')}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36' },
    timeoutMs: 20000,
  });
  for (const m of html.matchAll(EMAIL_RE)) {
    const e = m[0].toLowerCase();
    if (e.endsWith('.' + host) || e.endsWith(host)) found.add(e);
    if (found.size >= limit) break;
  }
  return [...found];
}

module.exports = { subdomains, cnameChain, cnameChains, wayback, techDetect, emails };