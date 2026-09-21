'use strict';

// ============================================================================
// osint-hub.js — OSINT motor con herramientas gratuitas de código abierto
// ============================================================================

const https = require('https');
const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const netMod = require('./net');

// ── HTTP helper ─────────────────────────────────────────────────────
// Recon pasivo a servicios públicos: NO pasa por scope de sesión (crt.sh,
// wayback o el resolver DoH no son el objetivo), pero SÍ lleva ritmo
// (waitForSlot) y anti-SSRF (nunca IPs internas/loopback/metadata por
// literal ni por resolución DNS).
function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); }
    catch { return reject(new Error('URL malformada')); }
    if (!['http:', 'https:'].includes(parsed.protocol)) return reject(new Error('Solo HTTP(S)'));
    (async () => {
      try { await netMod.waitForSlot(); } catch { /* sigue */ }
      const host = parsed.hostname;
      try {
        if (netMod.isInternalHost(host) || (await netMod.resolvesInternal(host))) {
          return reject(new Error('Bloqueado anti-SSRF: host interno ' + host));
        }
      } catch (e) { return reject(e); }
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
    })();
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
  const U = encodeURIComponent(username);

  // TIER 1 — APIs abiertas: validación estructurada, confianza HIGH.
  const apiTier = [
    { name: 'GitHub', url: `https://api.github.com/users/${U}`, found: (j) => !!(j && j.login), pick: (j) => ({ nombre: j.name, perfil: j.html_url, repos: j.public_repos, seguidores: j.followers, bio: (j.bio || '').slice(0, 160) }) },
    { name: 'GitLab', url: `https://gitlab.com/api/v4/users?username=${U}`, found: (j) => Array.isArray(j) && j.length > 0 && j[0].username, pick: (j) => ({ nombre: j[0].name, perfil: j[0].web_url }) },
    { name: 'Docker Hub', url: `https://hub.docker.com/v2/users/${U}/`, found: (j) => !!(j && j.username), pick: (j) => ({ nombre: j.username, perfil: `https://hub.docker.com/u/${username}`, empresa: j.company || null, ubicacion: j.location || null }) },
    { name: 'Keybase', url: `https://keybase.io/_/api/1.0/user/lookup.json?usernames=${U}`, found: (j) => !!(j && j.them && j.them.length), pick: (j) => ({ perfil: `https://keybase.io/${username}`, proofs: ((j.them[0] || {}).proofs_summary || {}).all || null }) },
    { name: 'HackerNews', url: `https://hacker-news.firebaseio.com/v0/user/${U}.json`, found: (j) => !!(j && j.id), pick: (j) => ({ karma: j.karma, perfil: `https://news.ycombinator.com/user?id=${username}`, envios: (j.submitted || []).length }) },
    { name: 'Chess.com', url: `https://api.chess.com/pub/player/${U}`, found: (j) => !!(j && (j.username || j.player_id)), pick: (j) => ({ perfil: j.url || `https://www.chess.com/member/${username}`, nombre: j.name || null }) },
    { name: 'Lichess', url: `https://lichess.org/api/user/${U}`, found: (j) => !!(j && j.id), pick: (j) => ({ perfil: j.url || `https://lichess.org/@/${username}`, bio: ((j.profile || {}).bio || '').slice(0, 160) }) },
    { name: 'dev.to', url: `https://dev.to/api/users/by_username?url=${U}`, found: (j) => !!(j && j.username), pick: (j) => ({ nombre: j.name, perfil: `https://dev.to/${username}`, ubicacion: j.location || null }) },
    { name: 'Bluesky', url: `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${U}`, found: (j) => !!(j && j.did), pick: (j) => ({ nombre: j.displayName || null, handle: j.handle, perfil: `https://bsky.app/profile/${username}` }) },
    { name: 'Mastodon', url: `https://mastodon.social/api/v1/accounts/lookup?acct=${U}`, found: (j) => !!(j && j.id), pick: (j) => ({ nombre: j.display_name || null, perfil: j.url, nota: 'solo instancia mastodon.social' }) },
    { name: 'Mojang', url: `https://api.mojang.com/users/profiles/minecraft/${U}`, found: (j) => !!(j && j.id), pick: (j) => ({ perfil: `https://namemc.com/minecraft-names/${username}` }) },
    { name: 'StackExchange', url: `https://api.stackexchange.com/2.3/users?order=desc&sort=reputation&inname=${U}&site=stackoverflow`, found: (j) => !!(j && j.items && j.items.length && j.items[0].display_name && j.items[0].display_name.toLowerCase().includes(username.toLowerCase())), pick: (j) => ({ nombre: j.items[0].display_name, perfil: j.items[0].link, reputacion: j.items[0].reputation }), conf: 'MEDIUM' },
  ];

  // TIER 2 — sondas HTML (confianza MEDIUM si 200 limpio, 'maybe' tras muro).
  const platforms = [
    { name: 'Telegram', url: `https://t.me/${username}`, check: 'html' },
    { name: 'Reddit', url: `https://www.reddit.com/user/${username}/`, check: 'html' },
    { name: 'YouTube', url: `https://www.youtube.com/@${username}`, check: 'html' },
    { name: 'Twitch', url: `https://www.twitch.tv/${username}`, check: 'html' },
    { name: 'Steam', url: `https://steamcommunity.com/id/${username}?xml=1`, check: 'html' },
    { name: 'Twitter/X', url: `https://twitter.com/${username}`, check: 'html' },
    { name: 'Instagram', url: `https://www.instagram.com/${username}/`, check: 'html' },
    { name: 'TikTok', url: `https://www.tiktok.com/@${username}`, check: 'html' },
    { name: 'Pinterest', url: `https://www.pinterest.com/${username}/`, check: 'html' },
    { name: 'Medium', url: `https://medium.com/@${username}`, check: 'html' },
    { name: 'DeviantArt', url: `https://www.deviantart.com/${username}`, check: 'html' },
    { name: 'Tumblr', url: `https://${username}.tumblr.com`, check: 'html' },
    { name: 'Flickr', url: `https://www.flickr.com/people/${username}/`, check: 'html' },
    { name: 'Linktree', url: `https://linktr.ee/${username}`, check: 'html' },
    { name: 'LeetCode', url: `https://leetcode.com/${username}/`, check: 'html' },
    { name: 'npm', url: `https://www.npmjs.com/~${username}`, check: 'html' },
    { name: 'PyPI', url: `https://pypi.org/user/${username}/`, check: 'html' },
    { name: 'RubyGems', url: `https://rubygems.org/profiles/${username}`, check: 'html' },
    { name: 'Bitbucket', url: `https://bitbucket.org/${username}/`, check: 'html' },
    { name: 'LinkedIn', url: `https://www.linkedin.com/in/${username}`, check: 'html' },
  ];

  const results = [];

  // Tier 1 en serie (rápido y con JSON real)
  for (const p of apiTier) {
    try {
      const resp = await fetch(p.url, { timeout: 9000, headers: { accept: 'application/json' } });
      if (resp.status === 429) { results.push({ ...p, url: p.url, found: 'maybe', confidence: 'LOW', status: 429, note: 'rate-limit: reintenta luego' }); continue; }
      if (resp.status === 404) { results.push({ name: p.name, url: p.url, found: false, confidence: 'HIGH', status: 404 }); continue; }
      if (resp.status !== 200) { results.push({ name: p.name, url: p.url, found: 'maybe', confidence: 'LOW', status: resp.status }); continue; }
      let j = null;
      try { j = JSON.parse(resp.body); } catch { results.push({ name: p.name, url: p.url, found: 'maybe', confidence: 'LOW', status: 200, note: 'respuesta no JSON' }); continue; }
      if (p.found(j)) {
        let extra = {};
        try { extra = p.pick(j) || {}; } catch {}
        results.push({ name: p.name, url: p.url, found: true, confidence: p.conf || 'HIGH', status: 200, ...extra });
      } else {
        results.push({ name: p.name, url: p.url, found: false, confidence: 'HIGH', status: 200 });
      }
    } catch (e) {
      results.push({ name: p.name, url: p.url, found: false, confidence: 'LOW', status: 'error', error: String(e.message || e).slice(0, 60) });
    }
  }

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
          return { ...platform, url, found: 'maybe', confidence: 'LOW', status: resp.status, note: 'muro de login o anti-bot: no verificable' };
        }
        const found = resp.status === 200 && !/404|not found|no existe|does not exist|page.+available/i.test(head);
        return { ...platform, url, found, confidence: found ? 'MEDIUM' : 'HIGH', status: resp.status };
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
    high: results.filter(r => r.found === true && r.confidence === 'HIGH').length,
    maybe: results.filter(r => r.found === 'maybe').length,
    total: results.length,
    platforms: results,
  };
}

// ── 5. PHONE INTEL (técnica estilo Wiwok, código propio) ─────────────────
// Sin APIs de pago NO existe HLR/carrier-exacto/geolocalización precisa.
// Lo que SÍ es fiable y gratis: parse E.164 offline (país por prefijo +
// validez por longitud), checks de registro con APIs abiertas donde las hay
// (WhatsApp/Telegram solo admiten verificación MANUAL con enlace profundo)
// y dorks/enlaces de búsqueda. Nada aquí envía SMS ni toca recuperación de
// cuentas ajenas (eso notifica a la víctima: fuera de esta suite).
const CC_TABLE = {
  1: { region: 'NANP (US/CA/Caribe)', min: 10, max: 10 }, 7: { region: 'RU/KZ', min: 10, max: 10 },
  20: { region: 'EG', min: 10, max: 10 }, 27: { region: 'ZA', min: 9, max: 9 }, 30: { region: 'GR', min: 10, max: 10 },
  31: { region: 'NL', min: 9, max: 9 }, 32: { region: 'BE', min: 8, max: 9 }, 33: { region: 'FR', min: 9, max: 9 },
  34: { region: 'ES', min: 9, max: 9, movil: ['6', '7'] }, 39: { region: 'IT', min: 9, max: 11 },
  40: { region: 'RO', min: 9, max: 9 }, 41: { region: 'CH', min: 9, max: 9 }, 43: { region: 'AT', min: 10, max: 11 },
  44: { region: 'GB', min: 10, max: 10 }, 45: { region: 'DK', min: 8, max: 8 }, 46: { region: 'SE', min: 9, max: 9 },
  47: { region: 'NO', min: 8, max: 8 }, 48: { region: 'PL', min: 9, max: 9 }, 49: { region: 'DE', min: 10, max: 11 },
  51: { region: 'PE', min: 9, max: 9 }, 52: { region: 'MX', min: 10, max: 10 }, 53: { region: 'CU', min: 8, max: 8 },
  54: { region: 'AR', min: 10, max: 10 }, 55: { region: 'BR', min: 10, max: 11 }, 56: { region: 'CL', min: 9, max: 9 },
  57: { region: 'CO', min: 10, max: 10 }, 58: { region: 'VE', min: 10, max: 10 }, 60: { region: 'MY', min: 9, max: 10 },
  61: { region: 'AU', min: 9, max: 9 }, 62: { region: 'ID', min: 9, max: 11 }, 63: { region: 'PH', min: 10, max: 10 },
  64: { region: 'NZ', min: 8, max: 9 }, 65: { region: 'SG', min: 8, max: 8 }, 66: { region: 'TH', min: 9, max: 9 },
  81: { region: 'JP', min: 10, max: 10 }, 82: { region: 'KR', min: 9, max: 10 }, 84: { region: 'VN', min: 9, max: 10 },
  86: { region: 'CN', min: 11, max: 11 }, 90: { region: 'TR', min: 10, max: 10 }, 91: { region: 'IN', min: 10, max: 10 },
  92: { region: 'PK', min: 10, max: 10 }, 93: { region: 'AF', min: 9, max: 9 }, 94: { region: 'LK', min: 9, max: 9 },
  95: { region: 'MM', min: 8, max: 10 }, 98: { region: 'IR', min: 10, max: 10 }, 212: { region: 'MA', min: 9, max: 9 },
  213: { region: 'DZ', min: 9, max: 9 }, 216: { region: 'TN', min: 8, max: 8 }, 220: { region: 'GM', min: 7, max: 7 },
  221: { region: 'SN', min: 9, max: 9 }, 222: { region: 'MR', min: 8, max: 8 }, 226: { region: 'BF', min: 8, max: 8 },
  227: { region: 'NE', min: 8, max: 8 }, 228: { region: 'TG', min: 8, max: 8 }, 229: { region: 'BJ', min: 8, max: 8 },
  230: { region: 'MU', min: 8, max: 8 }, 231: { region: 'LR', min: 8, max: 8 }, 232: { region: 'SL', min: 8, max: 8 },
  233: { region: 'GH', min: 9, max: 9 }, 234: { region: 'NG', min: 10, max: 10 }, 235: { region: 'TD', min: 8, max: 8 },
  236: { region: 'CF', min: 8, max: 8 }, 237: { region: 'CM', min: 9, max: 9 }, 238: { region: 'CV', min: 7, max: 7 },
  239: { region: 'ST', min: 7, max: 7 }, 240: { region: 'GQ', min: 9, max: 9 }, 241: { region: 'GA', min: 8, max: 8 },
  242: { region: 'CG', min: 9, max: 9 }, 243: { region: 'CD', min: 9, max: 9 }, 244: { region: 'AO', min: 9, max: 9 },
  245: { region: 'GW', min: 9, max: 9 }, 246: { region: 'IO', min: 7, max: 7 }, 247: { region: 'AC', min: 6, max: 6 },
  248: { region: 'SC', min: 7, max: 7 }, 249: { region: 'SD', min: 9, max: 9 }, 250: { region: 'RW', min: 9, max: 9 },
  251: { region: 'ET', min: 9, max: 9 }, 252: { region: 'SO', min: 8, max: 8 }, 253: { region: 'DJ', min: 8, max: 8 },
  254: { region: 'KE', min: 10, max: 10 }, 255: { region: 'TZ', min: 9, max: 9 }, 256: { region: 'UG', min: 9, max: 9 },
  257: { region: 'BI', min: 8, max: 8 }, 258: { region: 'MZ', min: 9, max: 9 }, 260: { region: 'ZM', min: 9, max: 9 },
  261: { region: 'MG', min: 9, max: 9 }, 262: { region: 'RE/YT', min: 9, max: 9 }, 263: { region: 'ZW', min: 9, max: 9 },
  264: { region: 'NA', min: 9, max: 9 }, 265: { region: 'MW', min: 8, max: 8 }, 266: { region: 'LS', min: 8, max: 8 },
  267: { region: 'BW', min: 8, max: 8 }, 268: { region: 'SZ', min: 8, max: 8 }, 269: { region: 'KM', min: 7, max: 7 },
  351: { region: 'PT', min: 9, max: 9 }, 352: { region: 'LU', min: 9, max: 9 }, 353: { region: 'IE', min: 9, max: 9 },
  354: { region: 'IS', min: 7, max: 7 }, 355: { region: 'AL', min: 9, max: 9 }, 356: { region: 'MT', min: 8, max: 8 },
  357: { region: 'CY', min: 8, max: 8 }, 358: { region: 'FI', min: 9, max: 9 }, 359: { region: 'BG', min: 9, max: 9 },
  370: { region: 'LT', min: 8, max: 8 }, 371: { region: 'LV', min: 8, max: 8 }, 372: { region: 'EE', min: 7, max: 8 },
  373: { region: 'MD', min: 8, max: 8 }, 374: { region: 'AM', min: 8, max: 8 }, 375: { region: 'BY', min: 9, max: 9 },
  376: { region: 'AD', min: 6, max: 6 }, 377: { region: 'MC', min: 8, max: 9 }, 378: { region: 'SM', min: 10, max: 10 },
  380: { region: 'UA', min: 9, max: 9 }, 381: { region: 'RS', min: 8, max: 9 }, 382: { region: 'ME', min: 8, max: 8 },
  383: { region: 'XK', min: 8, max: 8 }, 385: { region: 'HR', min: 8, max: 9 }, 386: { region: 'SI', min: 8, max: 8 },
  387: { region: 'BA', min: 8, max: 8 }, 389: { region: 'MK', min: 8, max: 8 }, 420: { region: 'CZ', min: 9, max: 9 },
  421: { region: 'SK', min: 9, max: 9 },   423: { region: 'LI', min: 7, max: 7 },
};

function parsePhone(raw) {
  const digits = String(raw || '').replace(/[^0-9+]/g, '');
  if (!/^\+?\d{7,16}$/.test(digits)) return { ok: false, error: 'Formato inválido (7-16 dígitos, + opcional).' };
  let nacional = digits.startsWith('+') ? digits.slice(1) : digits;
  // Sin + asumimos ES si encaja (configurable: presume ES por defecto del operador)
  let cc = null;
  if (digits.startsWith('+')) {
    for (const len of [3, 2, 1]) {
      const cand = Number(nacional.slice(0, len));
      if (CC_TABLE[cand]) { cc = cand; break; }
    }
  } else if (/^[679]\d{8}$/.test(nacional)) {
    cc = 34;
  }
  const info = cc != null ? CC_TABLE[cc] : null;
  const resto = cc != null ? nacional.slice(String(cc).length) : nacional;
  const conPrefijo = digits.startsWith('+');
  const valido = info ? (resto.length >= info.min && resto.length <= info.max) : (resto.length >= 7 && resto.length <= 15);
  let tipo = null;
  if (info && info.movil && resto.length) tipo = info.movil.some((p) => resto.startsWith(p)) ? 'móvil (probable)' : 'fijo u otro (probable)';
  if (cc === 1 && /^(800|888|877|866|855|844|833|900)/.test(resto)) {
    tipo = resto.startsWith('900') ? 'tarifa premium (probable)' : 'gratuito/toll-free (probable)';
  }
  const e164 = cc != null ? `+${cc}${resto}` : `+${resto}`;
  return {
    ok: true, original: String(raw || ''), e164,
    cc, region: info ? info.region : (conPrefijo ? 'prefijo no reconocido' : 'sin prefijo: país no determinable'),
    nacional: resto, valido, tipo,
    formatos: {
      e164,
      internacional: cc != null ? `+${cc} ${resto}` : e164,
      rfc3966: `tel:${e164}`,
    },
    zonaHoraria: CC_TZ[cc] || null,
    areaGeografica: areaPorPrefijo(cc, resto),
  };
}

// Zona horaria del PAÍS (no del terminal) + área por prefijo de alta.
// Regla de oro: es la zona de emisión/alta; portabilidad e itinerancia la invalidan.
const CC_TZ = {
  34: ['Europe/Madrid'], 351: ['Europe/Lisbon'], 33: ['Europe/Paris'], 39: ['Europe/Rome'],
  49: ['Europe/Berlin'], 44: ['Europe/London'], 1: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'],
  52: ['America/Mexico_City'], 54: ['America/Argentina/Buenos_Aires'], 55: ['America/Sao_Paulo'],
  56: ['America/Santiago'],   57: ['America/Bogota'], 51: ['America/Lima'],
  61: ['Australia/Sydney'], 81: ['Asia/Tokyo'], 86: ['Asia/Shanghai'], 91: ['Asia/Kolkata'],
  62: ['Asia/Jakarta'], 63: ['Asia/Manila'], 27: ['Africa/Johannesburg'], 20: ['Africa/Cairo'],
  212: ['Africa/Casablanca'], 213: ['Africa/Algiers'], 234: ['Africa/Lagos'], 254: ['Africa/Nairobi'],
  90: ['Europe/Istanbul'], 41: ['Europe/Zurich'], 31: ['Europe/Amsterdam'], 32: ['Europe/Brussels'],
  46: ['Europe/Stockholm'], 47: ['Europe/Oslo'], 45: ['Europe/Copenhagen'], 48: ['Europe/Warsaw'],
};

// NANP: el área SÍ es geográfica en origen (portabilidad posible). Selección compacta.
const NANP_AREA = {
  212: 'New York NY', 646: 'New York NY', 718: 'New York NY', 310: 'Los Ángeles CA', 213: 'Los Ángeles CA',
  415: 'San Francisco CA', 312: 'Chicago IL', 305: 'Miami FL', 786: 'Miami FL', 202: 'Washington DC',
  617: 'Boston MA', 214: 'Dallas TX', 713: 'Houston TX', 404: 'Atlanta GA', 206: 'Seattle WA',
  503: 'Portland OR', 702: 'Las Vegas NV', 602: 'Phoenix AZ', 720: 'Denver CO', 612: 'Minneapolis MN',
  414: 'Milwaukee WI', 313: 'Detroit MI', 216: 'Cleveland OH', 412: 'Pittsburgh PA', 215: 'Philadelphia PA',
  410: 'Baltimore MD', 919: 'Raleigh NC', 704: 'Charlotte NC', 615: 'Nashville TN',
  504: 'New Orleans LA', 512: 'Austin TX',   619: 'San Diego CA', 858: 'San Diego CA',
  808: 'Hawaii HI', 907: 'Alaska AK', 787: 'Puerto Rico', 809: 'Rep. Dominicana', 876: 'Jamaica',
  416: 'Toronto ON', 514: 'Montreal QC', 604: 'Vancouver BC',
};

// ES fijos: geográficos por provincia (móviles 6/7 NO tienen geografía).
const ES_FIJO = {
  91: 'Madrid', 93: 'Barcelona', 95: 'Andalucía (95x)', 96: 'C. Valenciana/Murcia (96x)',
  97: 'Norte/Castilla y León/Extremadura (97x)', 98: 'Norte: Galicia/Asturias/Cantabria/País Vasco (98x)',
  92: 'Canarias (928)/Extremadura (924)', 94: 'País Vasco (94x)', 87: 'Cataluña interior (87x)',
  88: 'Galicia (88x)', 81: 'Galicia (81x)', 82: 'Canarias (822)',
};

function areaPorPrefijo(cc, resto) {
  if (cc === 1 && resto && resto.length >= 3) {
    const a = Number(resto.slice(0, 3));
    if (NANP_AREA[a]) return { area: NANP_AREA[a], nota: 'Área NANP de alta (portabilidad posible).' };
    return null;
  }
  if (cc === 34 && resto && /^[89]/.test(resto) && resto.length === 9) {
    const p2 = resto.slice(0, 2);
    if (ES_FIJO[p2]) return { area: `${ES_FIJO[p2]} (fijo)`, nota: 'Fijo geográfico; móviles 6/7 sin geografía.' };
  }
  return null;
}

async function lookupPhone(phone) {
  const p = parsePhone(phone);
  if (!p.ok) return { ok: false, phone: String(phone || ''), error: p.error };
  const e164 = p.e164;
  const soloDigitos = e164.replace('+', '');
  // Verificación MANUAL honesta: wa.me solo abre chat (no confirma registro
  // por sí solo); t.me resuelve si el usuario permite descubrimiento.
  return {
    ok: true, ...p,
    verificacionManual: [
      { canal: 'WhatsApp', url: `https://wa.me/${soloDigitos}`, nota: 'Abre chat: si muestra foto/nombre, el número usa WhatsApp (compruébalo tú).' },
      { canal: 'Telegram', url: `https://t.me/+${soloDigitos}`, nota: 'Resuelve solo si el usuario permite ser hallado por número.' },
      { canal: 'Signal', url: `https://signal.me/#p/+${soloDigitos}`, nota: 'Enlace de contacto, no verificación.' },
    ],
    busquedas: [
      { engine: 'Google exacto', url: `https://www.google.com/search?q=%22${encodeURIComponent(e164)}%22` },
      { engine: 'Google variantes', url: `https://www.google.com/search?q=%22${encodeURIComponent(p.nacional)}%22+OR+%22${encodeURIComponent(soloDigitos)}%22` },
      { engine: 'Truecaller web', url: `https://www.truecaller.com/search/${encodeURIComponent(soloDigitos)}` },
      { engine: 'Sync.me', url: `https://sync.me/search/?number=${encodeURIComponent(e164)}` },
    ],
    limites: 'Sin APIs de pago NO hay: operador exacto, HLR (activo/inactivo), ni geolocalización precisa. El país por prefijo SÍ es fiable; el resto son pistas.',
  };
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

  // MX vía DoH (sin nslookup: multiplataforma y sin shell)
  try {
    const mx = await dohRecords(domain, 'MX');
    if (mx.ok) {
      results.mxRecords = mx.registros.map((r) => String(r).split(/\s+/).pop()).filter(Boolean).slice(0, 5);
    }
  } catch {}

  // Gravatar: el hash MD5 del email con ?d=404 da 200 SOLO si está registrado.
  try {
    const md5 = require('crypto').createHash('md5').update(String(email).trim().toLowerCase()).digest('hex');
    results.gravatarHash = md5;
    const g = await fetch(`https://gravatar.com/avatar/${md5}?d=404&s=80`, { timeout: 8000 });
    results.gravatar = { registrado: g.status === 200, url: g.status === 200 ? `https://gravatar.com/avatar/${md5}?s=200` : null };
    if (g.status === 200) {
      try {
        const prof = await fetch(`https://en.gravatar.com/${md5}.json`, { timeout: 8000 });
        if (prof.status === 200) {
          const pj = JSON.parse(prof.body);
          const e0 = (pj.entry || [])[0] || {};
          results.gravatar.perfil = { nombre: e0.displayName || null, perfil: e0.profileUrl || null, fotos: (e0.photos || []).length };
        }
      } catch {}
    }
  } catch (e) { results.gravatar = { registrado: 'unknown', error: String(e.message || e).slice(0, 80) }; }

  // XposedOrNot: breaches SIN clave (primera fuente gratuita real).
  try {
    const x = await fetch(`https://api.xposedornot.com/v1/check-email/${encodeURIComponent(email)}`, { timeout: 10000 });
    if (x.status === 200) {
      const j = JSON.parse(x.body);
      const br = j.breaches || [];
      results.breachCheck = { fuente: 'xposedornot', filtrado: br.length > 0, breaches: br.flat().slice(0, 20) };
    } else {
      results.breachCheck = { fuente: 'xposedornot', filtrado: 'unknown', error: `HTTP ${x.status}` };
    }
  } catch (e) {
    results.breachCheck = { fuente: 'xposedornot', filtrado: 'unknown', error: String(e.message || e).slice(0, 100) };
  }

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
      results.breachCheck = { fuente: 'hibp', breached: true, breaches: Array.isArray(list) ? list.map((b) => b.Name || b.Title || b).slice(0, 20) : [] };
    } else if (resp.status === 404) {
      results.breachCheck = { fuente: 'hibp', breached: false };
    } else if (results.breachCheck && results.breachCheck.fuente === 'xposedornot' && typeof results.breachCheck.filtrado === 'boolean') {
      // Sin clave HIBP: conserva el veredicto gratuito de XposedOrNot y anota.
      results.breachCheck.hibp = `sin veredicto (HTTP ${resp.status}, ¿falta API key?)`;
    } else {
      results.breachCheck = { fuente: 'hibp', breached: 'unknown', error: `HIBP respondió ${resp.status} (¿falta API key?)` };
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

  // DNS vía DoH (sin nslookup: funciona igual en Windows/Linux y sin shell)
  if (!validDomain(domain || '')) {
    return { ok: false, error: 'Dominio inválido', domain };
  }
  try {
    for (const type of ['A', 'AAAA', 'MX', 'NS', 'TXT']) {
      try {
        const r = await dohRecords(domain, type);
        if (r.ok && r.registros.length) results.dns[type] = r.registros.slice(0, 10);
      } catch {}
    }
  } catch {}

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

// ── 11. CRT.SH — subdominios por transparencia de certificados (sin clave) ──
function validDomain(d) {
  return /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(String(d || ''));
}

async function crtshSubs(domain) {
  const d = String(domain || '').trim().toLowerCase();
  if (!validDomain(d)) return { ok: false, error: 'Dominio inválido', domain };
  try {
    const resp = await fetch(`https://crt.sh/?q=%25.${encodeURIComponent(d)}&output=json`, { timeout: 20000 });
    if (resp.status !== 200) return { ok: false, error: `crt.sh respondió ${resp.status}`, domain: d };
    const rows = JSON.parse(resp.body);
    if (!Array.isArray(rows)) return { ok: false, error: 'crt.sh sin filas', domain: d };
    const set = new Set();
    // Techo: en apex grandes crt.sh devuelve decenas de miles de filas; con
    // las primeras 3000 basta para cazar (el resto es ruido de SaaS).
    for (const r of rows.slice(0, 3000)) {
      for (const n of String(r.name_value || '').split('\n')) {
        const h = n.trim().toLowerCase().replace(/^\*\./, '');
        if (h && (h === d || h.endsWith('.' + d))) set.add(h);
      }
    }
    return { ok: true, domain: d, total: set.size, subdominios: [...set].sort().slice(0, 200) };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 120), domain: d }; }
}

// ── 12. WAYBACK CDX — URLs históricas con foco en params y JS ────────────
async function waybackCdx(domain, limit = 500) {
  const d = String(domain || '').trim().toLowerCase();
  if (!validDomain(d)) return { ok: false, error: 'Dominio inválido', domain };
  try {
    const url = `https://web.archive.org/cdx/search/cdx?url=*.${encodeURIComponent(d)}/*&output=json&fl=original&collapse=urlkey&limit=${Math.min(Number(limit) || 500, 2000)}`;
    const resp = await fetch(url, { timeout: 25000 });
    if (resp.status !== 200) return { ok: false, error: `wayback respondió ${resp.status}`, domain: d };
    const rows = JSON.parse(resp.body).slice(1).map((r) => r[0]).filter(Boolean);
    // Fuera ruido de scanners archivados (p. ej. sufijos 'savik%27%3C'): son
    // artefactos de otros cazadores, no params reales de la app.
    const BASURA = /savik|%27%3C|%3C\//i;
    const limpias = rows.filter((u) => !BASURA.test(u));
    const conParams = limpias.filter((u) => u.includes('?'));
    const js = limpias.filter((u) => /\.js(\?|$)/i.test(u));
    return {
      ok: true, domain: d, total: rows.length, utiles: limpias.length,
      conParametros: conParams.length, ficherosJs: js.length,
      muestraParams: conParams.slice(0, 30), muestraJs: js.slice(0, 30),
    };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 120), domain: d }; }
}

// ── 13. DNS-over-HTTPS — registros sin depender de nslookup ──────────────
async function dohRecords(domain, type = 'A') {
  const d = String(domain || '').trim().toLowerCase();
  if (!validDomain(d)) return { ok: false, error: 'Dominio inválido', domain };
  const t = String(type || 'A').toUpperCase();
  if (!/^(A|AAAA|MX|NS|TXT|CNAME|SOA)$/.test(t)) return { ok: false, error: 'Tipo no soportado (A/AAAA/MX/NS/TXT/CNAME/SOA)', domain: d };
  const endpoints = [
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(d)}&type=${t}`,
    `https://dns.google/resolve?name=${encodeURIComponent(d)}&type=${t}`,
  ];
  for (const ep of endpoints) {
    try {
      const resp = await fetch(ep, { timeout: 12000, headers: { accept: 'application/dns-json' } });
      if (resp.status !== 200) continue;
      const j = JSON.parse(resp.body);
      const registros = (j.Answer || []).map((a) => String(a.data));
      return { ok: true, domain: d, type: t, via: new URL(ep).hostname, registros };
    } catch {}
  }
  return { ok: false, error: 'DoH sin respuesta (cloudflare-dns, dns.google)', domain: d };
}

// ── 14. GREP.APP — código público que menciona el dominio (sin clave) ────
async function grepApp(query) {
  const q = String(query || '').trim().slice(0, 120);
  if (q.length < 3) return { ok: false, error: 'Query mínima de 3 caracteres' };
  try {
    const resp = await fetch(`https://grep.app/api/search?q=${encodeURIComponent(q)}`, { timeout: 20000 });
    if (resp.status !== 200) return { ok: false, error: `grep.app respondió ${resp.status}` };
    const j = JSON.parse(resp.body);
    const hits = (j.hits && j.hits.hits) || [];
    return {
      ok: true, query: q, total: hits.length,
      resultados: hits.slice(0, 20).map((h) => ({
        repo: (h.repo && h.repo.raw) || '', fichero: (h.path && h.path.raw) || '',
        url: h.repo && h.path ? `https://github.com/${h.repo.raw}/blob/HEAD/${h.path.raw}` : null,
        snippet: (h.content && h.content.snippet) || '',
      })),
    };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 120) }; }
}

// ── 15. TAKEOVER — CNAMEs de la sesión contra fingerprints conocidos ──────
function checkTakeoverHub(cnameMap) {
  try {
    const { checkTakeover } = require('./pause-brief');
    const candidatos = checkTakeover(cnameMap || {});
    return {
      ok: true, total: candidatos.length, candidatos,
      nota: candidatos.length
        ? 'CANDIDATOS sin verificar: confirma NXDOMAIN/página por defecto antes de reportar.'
        : 'Sin CNAMEs a servicios reclamables conocidos.',
    };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 120) }; }
}

// ── 16. SECURITY.TXT — contacto y alcance declarado ──────────────────────
async function securityTxt(domain) {
  const d = String(domain || '').trim().toLowerCase();
  if (!validDomain(d)) return { ok: false, error: 'Dominio inválido', domain };
  for (const p of ['/.well-known/security.txt', '/security.txt']) {
    try {
      const resp = await fetch(`https://${d}${p}`, { timeout: 10000 });
      if (resp.status === 200 && /contact:/i.test(resp.body)) {
        const contactos = resp.body.split('\n').filter((l) => /^contact:/i.test(l.trim())).map((l) => l.trim());
        return { ok: true, domain: d, url: `https://${d}${p}`, contactos, raw: resp.body.slice(0, 2000) };
      }
    } catch {}
  }
  return { ok: true, domain: d, encontrado: false, nota: 'Sin security.txt (no es un fallo, es una pista menos).' };
}

// ── 17. SPF/DMARC — postura de email (spoofing/phishing) ──────────────────
async function spfDmarc(domain) {
  const d = String(domain || '').trim().toLowerCase();
  if (!validDomain(d)) return { ok: false, error: 'Dominio inválido', domain };
  const spf = await dohRecords(d, 'TXT');
  const dmarc = await dohRecords(`_dmarc.${d}`, 'TXT');
  const spfTxt = spf.ok ? spf.registros.filter((r) => /v=spf1/i.test(r)) : [];
  const dmarcTxt = dmarc.ok ? dmarc.registros.filter((r) => /v=DMARC1/i.test(r)) : [];
  const debil = !dmarcTxt.length || /p=none/i.test(dmarcTxt.join(' '));
  return {
    ok: true, domain: d, spf: spfTxt, dmarc: dmarcTxt,
    valoracion: debil
      ? 'DMARC ausente o p=none → spoofing de correo posible (solo reportable con PoC de impacto en el programa).'
      : 'DMARC con enforcement (p=quarantine/reject).',
  };
}

// ── 18. INVESTIGATE — perfil unificado estilo Wiwok (código propio) ───
// Detecta el tipo (email/teléfono/usuario), ejecuta los módulos que SÍ
// funcionan sin claves y fusiona todo con pivotes para seguir tirando.
function detectTargetType(target) {
  const t = String(target || '').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t)) return 'email';
  if (parsePhone(t).ok) return 'phone';
  if (/^[a-zA-Z0-9._-]{2,40}$/.test(t.replace(/^@/, ''))) return 'username';
  return 'unknown';
}

async function investigate(target) {
  const t = String(target || '').trim().slice(0, 120);
  const type = detectTargetType(t);
  const out = { ok: true, target: t, type, secciones: {}, pivots: [], resumen: {} };
  if (type === 'email') {
    out.secciones.email = await emailOSINT(t);
    const local = t.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 40);
    if (local.length >= 3) {
      out.secciones.usuarioLocalPart = await searchUsername(local);
      out.pivots.push({ tipo: 'username', valor: local, porQue: 'local-part del email' });
    }
    const h = (out.secciones.email.breachCheck && out.secciones.email.breachCheck.filtrado) === true ? 1 : 0;
    out.resumen = { filtrado: h, gravatar: !!(out.secciones.email.gravatar && out.secciones.email.gravatar.registrado) };
  } else if (type === 'phone') {
    out.secciones.telefono = await lookupPhone(t);
    out.resumen = { valido: !!out.secciones.telefono.valido, region: out.secciones.telefono.region || null };
  } else if (type === 'username') {
    out.secciones.usuario = await searchUsername(t);
    const u = out.secciones.usuario;
    out.resumen = { encontrados: u.found || 0, altaConfianza: u.high || 0, porVerificar: u.maybe || 0 };
    out.pivots.push({ tipo: 'dorks', valor: t, porQue: 'username para dorks y grep.app' });
  } else {
    return { ok: false, target: t, error: 'No reconozco el objetivo: usa email, teléfono (+prefijo) o usuario.' };
  }
  return out;
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
  crtshSubs,
  waybackCdx,
  dohRecords,
  grepApp,
  checkTakeoverHub,
  securityTxt,
  spfDmarc,
  parsePhone,
  CC_TABLE,
  detectTargetType,
  investigate,
};
