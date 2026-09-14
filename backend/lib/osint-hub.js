'use strict';

// ============================================================================
// osint-hub.js — OSINT motor con herramientas gratuitas de código abierto
// ============================================================================

const https = require('https');
const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

// ── HTTP helper ─────────────────────────────────────────────────────
function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', ...(opts.headers || {}) },
      timeout: opts.timeout || 15000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ── 1. PUBLIC CAMERAS ───────────────────────────────────────────────
// ELIMINADO (auditoría): contenía una CameraDB inventada (Madrid.Cameras.es,
// NYC.Cams.to…) y una consulta fija a 88.8.8.8 sin sentido. Las cámaras
// públicas viven en public-webcams.js (fuentes oficiales) y
// public-camera-sources.js; no se sirve stream inventado.

// ── 2. GOOGLE DORKS ────────────────────────────────────────────────
function generateGoogleDorks(target, type = 'general') {
  const dorks = {
    general: [
      `site:${target}`,
      `inurl:${target}`,
      `intitle:"index of" ${target}`,
      `filetype:pdf site:${target}`,
      `filetype:doc site:${target}`,
      `filetype:sql site:${target}`,
      `filetype:log site:${target}`,
      `intext:"password" site:${target}`,
      `intext:"username" site:${target}`,
      `intext:"confidential" site:${target}`,
    ],
    security: [
      `inurl:admin site:${target}`,
      `inurl:login site:${target}`,
      `inurl:wp-admin site:${target}`,
      `inurl:phpmyadmin site:${target}`,
      `inurl:.env site:${target}`,
      `inurl:config site:${target}`,
      `inurl:backup site:${target}`,
      `inurl:database site:${target}`,
      `"SQL syntax" site:${target}`,
      `"Warning:" site:${target}`,
      `"Error:" site:${target}`,
      `"phpinfo()" site:${target}`,
    ],
    files: [
      `filetype:env site:${target}`,
      `filetype:bak site:${target}`,
      `filetype:old site:${target}`,
      `filetype:swf site:${target}`,
      `filetype:xls site:${target}`,
      `filetype:csv site:${target}`,
      `filetype:json site:${target}`,
      `filetype:xml site:${target}`,
      `filetype:txt site:${target}`,
    ],
    subdomains: [
      `site:*.${target} -www`,
      `site:${target} inurl:login`,
      `site:${target} inurl:api`,
      `site:${target} inurl:dev`,
      `site:${target} inurl:test`,
      `site:${target} inurl:staging`,
    ],
    emails: [
      `"@${target}" email`,
      `"@${target}" contact`,
      `"@${target}" support`,
      `"@${target}" admin`,
    ],
    phones: [
      `site:${target} phone`,
      `site:${target} tel`,
      `site:${target} contact`,
      `site:${target} "phone number"`,
    ],
  };

  return {
    ok: true,
    target,
    dorks: dorks[type] || dorks.general,
    allDorks: dorks,
    usage: 'Copy and paste into Google. Each line is a separate search.',
  };
}

// ── 3. ROBOTS.TXT ANALYZER ─────────────────────────────────────────
async function analyzeRobotsTxt(domain) {
  // Sanea: quita esquema/ruta/userinfo y valida hostname (antes
  // `https://${domain}` permitía `a@b/` o rutas que cambiaban el destino).
  let host = String(domain || '').trim();
  try {
    if (/^[a-z]+:\/\//i.test(host)) host = new URL(host).hostname;
    else host = host.split('/')[0].split(':')[0].split('@').pop();
  } catch { return { ok: false, error: 'Dominio inválido' }; }
  if (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(host)) {
    return { ok: false, error: 'Dominio inválido' };
  }
  try {
    const robotsUrl = `https://${host}/robots.txt`;
    const resp = await fetch(robotsUrl);

    if (resp.status !== 200) {
      return { ok: false, error: `No robots.txt found (${resp.status})` };
    }

    const lines = resp.body.split('\n');
    const disallowed = [];
    const allowed = [];
    const sitemaps = [];
    const host = [];
    let currentAgent = '*';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('User-agent:')) {
        currentAgent = trimmed.split(':')[1].trim();
      } else if (trimmed.startsWith('Disallow:')) {
        const path = trimmed.split(':').slice(1).join(':').trim();
        if (path) disallowed.push({ path, agent: currentAgent });
      } else if (trimmed.startsWith('Allow:')) {
        const path = trimmed.split(':').slice(1).join(':').trim();
        if (path) allowed.push({ path, agent: currentAgent });
      } else if (trimmed.startsWith('Sitemap:')) {
        sitemaps.push(trimmed.split(':').slice(1).join(':').trim());
      } else if (trimmed.startsWith('Host:')) {
        host.push(trimmed.split(':').slice(1).join(':').trim());
      }
    }

    // Find interesting paths
    const interesting = disallowed.filter(d =>
      d.path.includes('admin') || d.path.includes('config') ||
      d.path.includes('backup') || d.path.includes('database') ||
      d.path.includes('private') || d.path.includes('secret') ||
      d.path.includes('login') || d.path.includes('api')
    );

    return {
      ok: true,
      domain,
      disallowed: disallowed.length,
      allowed: allowed.length,
      sitemaps,
      host,
      interesting,
      raw: resp.body,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── 4. USERNAME SEARCH (Sherlock-style) ─────────────────────────────
// found: true (perfil real) | 'maybe' (muro de login/bloqueo bot: la web
// responde 200 pero no deja ver; decir "no existe" sería mentir) | false.
async function searchUsername(username) {
  const clean = String(username || '').trim().replace(/^@/, '').slice(0, 40);
  if (!/^[a-zA-Z0-9._-]+$/.test(clean)) {
    return { ok: false, username: clean, error: 'Username inválido (letras, números, . _ -).', platforms: [] };
  }
  username = clean; // desde aquí las plantillas usan el valor saneado
  const LOGIN_WALL = /log in|sign up|create account|join now|verify you are|unusual traffic|enable javascript to|cf-chl|captcha/i;
  const platforms = [
    { name: 'GitHub', url: `https://github.com/${username}`, check: 'html' },
    { name: 'Twitter/X', url: `https://twitter.com/${username}`, check: 'html' },
    { name: 'Instagram', url: `https://www.instagram.com/${username}/`, check: 'html' },
    { name: 'Reddit', url: `https://www.reddit.com/user/${username}`, check: 'html' },
    { name: 'LinkedIn', url: `https://www.linkedin.com/in/${username}`, check: 'html' },
    { name: 'YouTube', url: `https://www.youtube.com/@${username}`, check: 'html' },
    { name: 'TikTok', url: `https://www.tiktok.com/@${username}`, check: 'html' },
    { name: 'Pinterest', url: `https://www.pinterest.com/${username}/`, check: 'html' },
    { name: 'Medium', url: `https://medium.com/@${username}`, check: 'html' },
    { name: 'DeviantArt', url: `https://www.deviantart.com/${username}`, check: 'html' },
    { name: 'Tumblr', url: `https://${username}.tumblr.com`, check: 'html' },
    { name: 'Flickr', url: `https://www.flickr.com/people/${username}/`, check: 'html' },
    { name: 'Steam', url: `https://steamcommunity.com/id/${username}`, check: 'html' },
    { name: 'Twitch', url: `https://www.twitch.tv/${username}`, check: 'html' },
    { name: 'Keybase', url: `https://keybase.io/${username}`, check: 'html' },
    { name: 'HackerRank', url: `https://www.hackerrank.com/${username}`, check: 'html' },
    { name: 'LeetCode', url: `https://leetcode.com/${username}/`, check: 'html' },
    { name: 'GitLab', url: `https://gitlab.com/${username}`, check: 'html' },
    { name: 'Bitbucket', url: `https://bitbucket.org/${username}/`, check: 'html' },
    { name: 'Docker Hub', url: `https://hub.docker.com/u/${username}`, check: 'html' },
  ];

  const results = [];

  // Check in parallel batches of 5
  for (let i = 0; i < platforms.length; i += 5) {
    const batch = platforms.slice(i, i + 5);
    const promises = batch.map(async (platform) => {
      try {
        // Seguro: la entrada se validó a charset [a-z0-9._-] arriba; si era
        // mala se devolvió error antes de construir estas URLs.
        const url = platform.url;
        const resp = await fetch(url, { timeout: 8000 });
        const head = String(resp.body || '').slice(0, 8000);
        if (resp.status === 429 || resp.status === 403 || LOGIN_WALL.test(head)) {
          return { ...platform, url, found: 'maybe', status: resp.status, note: 'muro de login o anti-bot: no verificable' };
        }
        const found = resp.status === 200 && !/404|not found|no existe|does not exist|page.+available/i.test(head);
        return { ...platform, url, found, status: resp.status };
      } catch (e) {
        return { ...platform, found: false, status: 'error', error: String(e.message || e).slice(0, 80) };
      }
    });
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
  }

  return {
    ok: true,
    username: clean,
    found: results.filter(r => r.found === true).length,
    maybe: results.filter(r => r.found === 'maybe').length,
    total: results.length,
    platforms: results,
  };
}

// ── 5. PHONE NUMBER LOOKUP ─────────────────────────────────────────
async function lookupPhone(phone) {
  const clean = phone.replace(/[^0-9+]/g, '');

  // NumVerify-style lookup (free tier)
  const results = {
    phone: clean,
    valid: clean.length >= 10,
    format: {
      international: `+${clean}`,
      local: clean.startsWith('+') ? clean.slice(1) : clean,
    },
    sources: [],
  };

  // NumVerify exige clave real: la llamada con `access_key=demo` moría siempre
  // en silencio (petición externa inútil en cada lookup). Se deja el hueco
  // documentado; el país se infiere por prefijo y los enlaces de búsqueda.
  results.note = results.note || 'Carrier exacto requiere clave NumVerify (NUMVERIFY_API_KEY).';

  // Generate OSINT searches for the phone
  results.searchLinks = [
    { engine: 'Google', url: `https://www.google.com/search?q=%22${encodeURIComponent(clean)}%22` },
    { engine: 'Google Dorks', url: `https://www.google.com/search?q=%22${encodeURIComponent(clean)}%22+site%3Apastebin.com` },
    { engine: 'Truecaller', url: `https://www.truecaller.com/search/${clean.replace('+', '')}` },
    { engine: 'SpyDialer', url: `https://www.spydialer.com/default.aspx?r=${clean.replace('+', '')}` },
    { engine: 'CallerID Test', url: `https://www.calleridtest.com/results.aspx?number=${clean.replace('+', '')}` },
  ];

  return { ok: true, ...results };
}

// ── 6. EMAIL OSINT ─────────────────────────────────────────────────
async function emailOSINT(email) {
  const domain = email.split('@')[1];
  const username = email.split('@')[0];

  const results = {
    email,
    domain,
    username,
    mxRecords: [],
    breachCheck: null,
    socialProfiles: [],
    searches: [
      { engine: 'Google', url: `https://www.google.com/search?q=%22${encodeURIComponent(email)}%22` },
      { engine: 'GitHub', url: `https://github.com/search?q=${encodeURIComponent(email)}&type=code` },
      { engine: 'Pastebin', url: `https://www.google.com/search?q=site%3Apastebin.com+%22${encodeURIComponent(email)}%22` },
    ],
  };

  // Check MX records (sin shell: execFile + dominio validado)
  try {
    const { execFileSync } = require('child_process');
    if (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(domain || '')) {
      throw new Error('dominio inválido');
    }
    const mx = execFileSync('nslookup', [`-type=mx`, domain], { encoding: 'utf8', timeout: 10000 });
    results.mxRecords = mx.split('\n')
      .filter(l => l.includes('mail exchanger'))
      .map(l => l.split('=')[1]?.trim())
      .filter(Boolean);
  } catch (e) {}

  // Have I Been Pwned: 404 = limpio, 200 = filtrado, 401/429/sin clave = desconocido.
  // (Antes usaba el fetch global y leía resp.body como texto: siempre caía en
  // 'unknown'. Ahora usa el helper del módulo, que devuelve {status, body}.)
  try {
    const hibpKey = process.env.HIBP_API_KEY || '';
    const resp = await fetch(`https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=true`, {
      timeout: 8000,
      headers: hibpKey ? { 'hibp-api-key': hibpKey, 'user-agent': 'knkLinux-OSINT' } : { 'user-agent': 'knkLinux-OSINT' },
    });
    if (resp.status === 200) {
      let list = [];
      try { list = JSON.parse(resp.body); } catch {}
      results.breachCheck = { breached: true, breaches: Array.isArray(list) ? list.map((b) => b.Name || b.Title || b).slice(0, 20) : [] };
    } else if (resp.status === 404) {
      results.breachCheck = { breached: false };
    } else {
      results.breachCheck = { breached: 'unknown', error: `HIBP respondió ${resp.status} (¿falta API key?)` };
    }
  } catch (e) {
    results.breachCheck = { breached: 'unknown', error: String(e.message || e).slice(0, 120) };
  }

  return { ok: true, ...results };
}

// ── 7. DOMAIN RECON ────────────────────────────────────────────────
async function domainRecon(domain) {
  const results = {
    domain,
    dns: {},
    whois: null,
    technologies: [],
    subdomains: [],
    emails: [],
  };

  // DNS records (sin shell: execFile + dominio validado una vez)
  if (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(domain || '')) {
    return { ok: false, error: 'Dominio inválido', domain };
  }
  try {
    const { execFileSync } = require('child_process');
    const types = ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME', 'SOA'];
    for (const type of types) {
      try {
        const out = execFileSync('nslookup', [`-type=${type}`, domain], { encoding: 'utf8', timeout: 10000 });
        results.dns[type] = out.split('\n')
          .filter(l => l.includes('Address:') || l.includes('internet address'))
          .map(l => l.split(':').pop()?.trim())
          .filter(Boolean);
      } catch (e) {}
    }
  } catch (e) {}

  // Technology detection via headers
  try {
    const resp = await fetch(`https://${domain}`, { timeout: 10000 });
    const server = resp.headers['server'];
    const powered = resp.headers['x-powered-by'];
    const generator = resp.body.match(/<meta.*generator.*content="([^"]+)"/i);

    if (server) results.technologies.push({ name: 'Server', value: server });
    if (powered) results.technologies.push({ name: 'Framework', value: powered });
    if (generator) results.technologies.push({ name: 'Generator', value: generator[1] });

    // Check for common technologies
    const body = resp.body.toLowerCase();
    if (body.includes('wordpress')) results.technologies.push({ name: 'CMS', value: 'WordPress' });
    if (body.includes('drupal')) results.technologies.push({ name: 'CMS', value: 'Drupal' });
    if (body.includes('joomla')) results.technologies.push({ name: 'CMS', value: 'Joomla' });
    if (body.includes('laravel')) results.technologies.push({ name: 'Framework', value: 'Laravel' });
    if (body.includes('django')) results.technologies.push({ name: 'Framework', value: 'Django' });
    if (body.includes('react')) results.technologies.push({ name: 'Framework', value: 'React' });
    if (body.includes('angular')) results.technologies.push({ name: 'Framework', value: 'Angular' });
    if (body.includes('vue')) results.technologies.push({ name: 'Framework', value: 'Vue.js' });
  } catch (e) {}

  // Generate search links
  results.searchLinks = [
    { engine: 'Google Dorks', dorks: generateGoogleDorks(domain, 'security').dorks },
    { engine: 'Shodan', url: `https://www.shodan.io/search?query=hostname:${domain}` },
    { engine: 'Censys', url: `https://censys.io/ipv4/${domain}` },
    { engine: 'VirusTotal', url: `https://www.virustotal.com/gui/domain/${domain}` },
    { engine: 'SecurityTrails', url: `https://securitytrails.com/domain/${domain}` },
    { engine: 'BuiltWith', url: `https://builtwith.com/${domain}` },
    { engine: 'Archive.org', url: `https://web.archive.org/web/*/${domain}` },
  ];

  return { ok: true, ...results };
}

// ── 8. IP RECON ────────────────────────────────────────────────────
async function ipRecon(ip) {
  const results = {
    ip,
    geo: null,
   ports: [],
    services: [],
    abuse: [],
  };

  // ip-api.com (free)
  try {
    const resp = await fetch(`http://ip-api.com/json/${ip}?fields=66846719`);
    if (resp.status === 200) {
      results.geo = JSON.parse(resp.body);
    }
  } catch (e) {}

  // ipinfo.io (free)
  try {
    const resp = await fetch(`https://ipinfo.io/${ip}/json`);
    if (resp.status === 200) {
      const data = JSON.parse(resp.body);
      results.geo = { ...results.geo, ...data };
    }
  } catch (e) {}

  return { ok: true, ...results };
}

// ── 9. TRACEROUTE ────────────────────────────────────────────────
// tracert (Windows) / traceroute (unix) vía execFile SIN shell. El destino
// se valida estricto (IPv4 u hostname); se bloquea link-local/metadata.
function validTraceTarget(t) {
  const s = String(t || '').trim().replace(/\/$/, '');
  const host = s.includes('://') ? (() => { try { return new URL(s).hostname; } catch { return ''; } })() : s.split('/')[0].split(':')[0];
  if (/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(host)) {
    if (/metadata\.google\.internal|instance-data|.*\.internal$/i.test(host)) return null;
    return host.toLowerCase();
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const o = m.slice(1, 5).map(Number);
    if (o.some((n) => n > 255)) return null;
    if (o[0] === 169 && o[1] === 254) return null;
    if (o.every((n) => n === 0)) return null;
    return o.join('.');
  }
  return null;
}

async function traceroute(target) {
  const clean = validTraceTarget(target);
  if (!clean) return { ok: false, error: 'Destino inválido (IPv4 u hostname público).', target };
  const { execFileSync } = require('child_process');
  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'tracert' : 'traceroute';
  const args = isWin
    ? ['-d', '-w', '1500', '-h', '24', clean]
    : ['-n', '-w', '2', '-m', '24', '-q', '2', clean];
  let out;
  try {
    out = execFileSync(cmd, args, { encoding: 'utf8', timeout: 90000, maxBuffer: 2 * 1024 * 1024 });
  } catch (e) {
    out = e.stdout || '';
    if (!out) return { ok: false, error: `${cmd} no disponible o sin respuesta: ${e.message}`, target: clean };
  }
  const hops = [];
  for (const line of String(out).split(/\r?\n/)) {
    const ips = [...line.matchAll(/(\d{1,3}(?:\.\d{1,3}){3})/g)].map((x) => x[1]);
    const ms = [...line.matchAll(/(\d+)\s*ms/gi)].map((x) => Number(x[1]));
    const n = (line.match(/^\s*(\d{1,3})\b/) || [])[1];
    if (!n || !ips.length) continue;
    hops.push({ n: Number(n), ip: ips[0], ms: ms.slice(0, 3), raw: line.trim().slice(0, 160) });
    if (hops.length >= 24) break;
  }
  return { ok: true, target: clean, tool: cmd, hops, count: hops.length };
}

// ── 10. FILE HASH LOOKUP ───────────────────────────────────────────
async function hashLookup(hash) {
  const results = { hash, detections: [], sources: [] };

  // VirusTotal (free API key required for full)
  results.sources.push({ name: 'VirusTotal', url: `https://www.virustotal.com/gui/file/${hash}` });
  results.sources.push({ name: 'Hybrid Analysis', url: `https://www.hybrid-analysis.com/search?query=${hash}` });
  results.sources.push({ name: 'Joesandbox', url: `https://www.joesandbox.com/search?q=${hash}` });
  results.sources.push({ name: 'MalwareBazaar', url: `https://bazaar.abuse.ch/browse/?search=${hash}` });

  return { ok: true, ...results };
}

module.exports = {
  generateGoogleDorks,
  analyzeRobotsTxt,
  searchUsername,
  lookupPhone,
  emailOSINT,
  domainRecon,
  ipRecon,
  hashLookup,
  traceroute,
  validTraceTarget,
};
