'use strict';

// ============================================================================
// KNK SUITE v2 — Parser de programas de bug bounty
// Soporta: YesWeHack (auto-parse) + HackerOne (modo guiado, SPA bloquea)
// ============================================================================

const { getText } = require('./net');

const YWH_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';

// TLDs reales
const TLD_SET = new Set([
  'com', 'net', 'org', 'io', 'co', 'dev', 'fr', 'ch', 'de', 'es', 'it', 'app',
  'cloud', 'xyz', 'info', 'ai', 'me', 'ru', 'nl', 'be', 'se', 'no', 'fi', 'dk',
  'pl', 'cz', 'at', 'pt', 'gr', 'ie', 'lu', 'uk', 'us', 'ca', 'au', 'jp', 'in',
  'br', 'mx', 'ar', 'za', 'nz', 'sg', 'hk', 'kr', 'tw', 'il', 'tr', 'eu', 'tv',
  'live', 'pro', 'site', 'online', 'store', 'tech', 'digital', 'media', 'agency',
  'solutions', 'group', 'team', 'systems', 'services', 'software', 'network',
]);

const GENERIC = new Set([
  'google.com', 'github.com', 'apple.com', 'play.google.com', 'apps.apple.com',
  'firebounty.com', 'linkedin.com', 'twitter.com', 'facebook.com', 'instagram.com',
  'w3.org', 'gstatic.com', 'googleapis.com', 'cloudflare.com', 'jsdelivr.net',
  'unpkg.com', 'amazonaws.com', 'sentry.io', 'gitlab.com', 'docker.com',
  'wikipedia.org', 'mozilla.org', 'yeswehack.com', 'hackerone.com',
  'bugcrowd.com', 'intigriti.com', 'stackoverflow.com', 'reddit.com',
  'schema.org', 'googletagmanager.com', 'google-analytics.com', 'ywh.com',
  'cdn-yeswehack.com', 'imgur.com', 'youtube.com', 'vimeo.com', 'discord.com',
  'slack.com', 'telegram.org', 'whatsapp.com', 'medium.com', 'gmail.com',
  'outlook.com', 'microsoft.com',  'google.co', 'fontawesome.com',
  'cdnjs.cloudflare.com', 'maxcdn.bootstrapcdn.com',
  // Dominios propios de la plataforma (nav/help/footer — NUNCA scope)
  'yeswehack.io', 'helpcenter.yeswehack.io', 'support.yeswehack.io',
  'docs.yeswehack.com', 'go.yeswehack.com', 'cdn-yeswehack.com',
]);


function rootOf(domain) {
  const parts = domain.split('.');
  return parts.slice(-2).join('.');
}

function cleanDomain(raw) {
  return String(raw)
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('\\')[0]
    .replace(/^u002[fF]/i, '') // artefacto de escape \u002f en HTML de YWH
    .replace(/\\u002[fF]/g, '')
    .trim();
}

function isValidDomain(d) {
  if (!d || d.length < 4 || d.length > 63) return false;
  const parts = d.split('.');
  if (parts.length < 2) return false;
  const tld = parts[parts.length - 1].toLowerCase();
  if (!TLD_SET.has(tld)) return false;
  if (GENERIC.has(d)) return false;
  return true;
}

/**
 * Detecta la plataforma desde la URL.
 */
function detectPlatform(url) {
  let hostname = '';
  try { hostname = new URL(String(url)).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return 'unknown'; }
  const platforms = [
    ['yeswehack', 'yeswehack.com'],
    ['hackerone', 'hackerone.com'],
    ['bugcrowd', 'bugcrowd.com'],
    ['intigriti', 'intigriti.com'],
  ];
  const match = platforms.find(([, base]) => hostname === base || hostname.endsWith(`.${base}`));
  return match ? match[0] : 'unknown';
}

/**
 * Parsea programa YesWeHack (server-side rendered, scrapeable).
 */
async function parseYesWeHack(url) {
  const html = await getText(url, {
    headers: { 'User-Agent': YWH_UA },
    timeoutMs: 20000,
  });

  if (!html) return { error: 'No se pudo cargar la página del programa' };

  const result = {
    source: 'yeswehack',
    autoParsed: true,
    programUrl: url,
    programName: '',
    target: '',
    domains: [],
    outOfScope: [],
    userAgent: '',
    policy: '',
    rewards: '',
    rateLimit: 800,
  };

  // ── Nombre del programa ──
  const titleMatch = html.match(/<title>([^<]+)/i);
  if (titleMatch) result.programName = titleMatch[1].replace(/\s*bug bounty program.*/i, '').trim();

  // ── Separar secciones ──
  const outIdx = html.indexOf('Out of scopes');
  const scopeHtml = outIdx > -1 ? html.slice(0, outIdx) : html;
  const outHtml = outIdx > -1 ? html.slice(outIdx, outIdx + 10000) : '';

  // ── Extraer dominios ──
  const domRe = /[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+/gi;

  const scopeSet = new Set();
  for (const m of scopeHtml.match(domRe) || []) {
    const c = cleanDomain(m);
    if (isValidDomain(c)) scopeSet.add(c);
  }

  const outSet = new Set();
  for (const m of outHtml.match(domRe) || []) {
    const c = cleanDomain(m);
    if (isValidDomain(c)) outSet.add(c);
  }

  // Quitar out-of-scope de in-scope
  for (const od of outSet) scopeSet.delete(od);

  // Agrupar por root domain
  const rootFreq = {};
  for (const d of scopeSet) {
    const root = rootOf(d);
    rootFreq[root] = (rootFreq[root] || 0) + 1;
  }
  const rootEntries = Object.entries(rootFreq)
    .filter(([root]) => !GENERIC.has(root))
    .sort((a, b) => b[1] - a[1]);

  let domains = [];
  if (rootEntries.length) {
    const programRoot = rootEntries[0][0];
    domains = [...scopeSet].filter(d => rootOf(d) === programRoot);
    if (domains.length < 2 && rootEntries.length > 1) {
      for (const [root] of rootEntries.slice(1, 4)) {
        domains = domains.concat([...scopeSet].filter(d => rootOf(d) === root));
      }
    }
  } else {
    domains = [...scopeSet];
  }

  result.domains = domains.slice(0, 25);
  result.target = domains[0] || '';
  result.outOfScope = [...outSet].filter(d => !GENERIC.has(d)).slice(0, 20);

  // ── User-Agent ──
  const uaMatch = html.match(/bug-bounty[-\s]*(HunterName|[\w-]{3,30})/i);
  if (uaMatch) result.userAgent = `knk-suite-researcher/2.0 bug-bounty-${uaMatch[1]}`;

  // ── Rate limit ──
  if (/automated (scanners|tools)/i.test(html)) result.rateLimit = 1000;
  if (/large amount.*traffic/i.test(html)) result.rateLimit = 1500;
  if (/degradation|interruption/i.test(html)) result.rateLimit = 2000;

  // ── Rewards ──
  const rewardRe = /(?:€|USD|US\$|\$)\s*([\d,.]+)\s*[-–]\s*(?:€|USD|US\$|\$)\s*([\d,.]+)/g;
  const rewards = [];
  let rm;
  while ((rm = rewardRe.exec(html)) !== null && rewards.length < 3) {
    rewards.push(`${rm[1]}-${rm[2]}`);
  }
  result.rewards = rewards.length ? rewards.join(' | ') : 'Consultar grid';

  // ── Política ──
  const policyBits = [];
  if (/responsible disclosure/i.test(html)) policyBits.push('Responsible Disclosure');
  if (/CVSS/i.test(html)) policyBits.push('CVSS 3.1');
  if (/No DoS|denial of service/i.test(html)) policyBits.push('No DoS');
  if (/screenshots/i.test(html)) policyBits.push('Screenshots');
  if (/proof of concept|PoC/i.test(html)) policyBits.push('PoC obligatorio');
  if (/user agent/i.test(html)) policyBits.push('User-Agent obligatorio');
  result.policy = policyBits.join(' | ') || 'Leer política completa';

  return result;
}

/**
 * HackerOne: SPA (React) — no scrapeable server-side.
 * Devuelve modo guiado para que el usuario pegue los datos.
 */
function parseHackerOne(url) {
  // Extraer nombre del programa del slug de la URL
  const slug = url.split('/').filter(Boolean).pop() || '';
  const programName = slug.replace(/-/g, ' ').replace(/bug.?bounty.*/i, '').trim();

  return {
    source: 'hackerone',
    autoParsed: false,
    programUrl: url,
    programName: programName || 'Programa HackerOne',
    target: '',
    domains: [],
    outOfScope: [],
    userAgent: '',
    policy: 'Coordinated Disclosure | CVSS 3.1 | Screenshots | PoC obligatorio',
    rewards: 'Consultar grid en la página del programa',
    rateLimit: 1000,
    note: '⚠️  HackerOne es una SPA (React) — no scrapeable automáticamente. Pega manualmente los dominios del scope y out-of-scope desde la pestaña "Scope" del programa.',
    hint: 'Abre la página del programa en el navegador, ve a la pestaña "Scope", copia los dominios y pégalos en el campo Scope del Dashboard.',
  };
}

/**
 * Bugcrowd: SPA — no scrapeable server-side.
 * Devuelve modo guiado con la política del Código de Conducta Bugcrowd precargada.
 * La suite activa compliance-bugcrowd.json automáticamente al fijar esta sesión.
 */
function parseBugcrowd(url) {
  const slug = url.split('/').filter(Boolean).pop() || '';
  const programName = slug.replace(/-/g, ' ').replace(/bug.?bounty.*/i, '').trim();

  return {
    source: 'bugcrowd',
    autoParsed: false,
    programUrl: url,
    programName: programName || 'Programa Bugcrowd',
    target: '',
    domains: [],
    outOfScope: [],
    userAgent: '',
    policy: 'Código de Conducta Bugcrowd: divulgación coordinada (programas privados confidenciales) | informe completo inicial (no marcadores de posición) | mínimo acceso a datos (PII → detener) | GenAI solo con revisión humana | CVSS 3.1',
    rewards: 'Consultar Brief del programa (la tabla de recompensas prevalece)',
    rateLimit: 1000,
    note: '⚠️  Bugcrowd es una SPA — no scrapeable automáticamente. Pega manualmente los dominios del scope desde la tabla de scopes del Brief.',
    hint: 'La política del Código de Conducta Bugcrowd se activa en la pestaña Cumplimiento al fijar este programa. OJO: el Brief concreto puede ser más restrictivo — prevalece sobre la política general.',
  };
}

/**
 * Bugcrowd / Intigriti: similar a HackerOne — SPAs.
 */
function parseOther(url, platform) {
  return {
    source: platform,
    autoParsed: false,
    programUrl: url,
    programName: `Programa ${platform}`,
    target: '',
    domains: [],
    outOfScope: [],
    userAgent: '',
    policy: 'Consultar política del programa',
    rewards: 'Consultar grid',
    rateLimit: 1000,
    note: `⚠️  ${platform} es una SPA — no scrapeable automáticamente. Pega manualmente los dominios del scope desde la página del programa.`,
  };
}

/**
 * Parser unificado: auto-detecta plataforma y aplica la estrategia correcta.
 */
async function parseProgram(url) {
  let parsed;
  try { parsed = new URL(String(url)); } catch { return { error: 'URL de programa inválida' }; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    return { error: 'La URL del programa debe ser HTTP(S) y no contener credenciales' };
  }
  const platform = detectPlatform(parsed.toString());
  if (platform === 'unknown') return { error: 'URL fuera de las plataformas admitidas' };

  switch (platform) {
    case 'yeswehack':
      return parseYesWeHack(url);
    case 'hackerone':
      return parseHackerOne(url);
    case 'bugcrowd':
      return parseBugcrowd(url);
    case 'intigriti':
      return parseOther(url, platform);
    default:
      return { error: `Plataforma no soportada: ${platform}. Solo YesWeHack (auto) y HackerOne/Bugcrowd/Intigriti (manual).` };
  }
}

module.exports = { parseProgram, parseYesWeHack, parseHackerOne, parseBugcrowd, detectPlatform };