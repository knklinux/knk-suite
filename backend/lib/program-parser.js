'use strict';

// ============================================================================
// KNK SUITE v2 — Parser de programas de bug bounty (YesWeHack)
// Extrae scope, out-of-scope, UA, políticas, rewards desde URL del programa
// ============================================================================

const { getText } = require('./net');

const YWH_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';

// TLDs reales (lista estricta — excluye extensiones de archivo)
const TLD_SET = new Set([
  'com', 'net', 'org', 'io', 'co', 'dev', 'fr', 'ch', 'de', 'es', 'it', 'app',
  'cloud', 'xyz', 'info', 'ai', 'me', 'ru', 'nl', 'be', 'se', 'no', 'fi', 'dk',
  'pl', 'cz', 'at', 'pt', 'gr', 'ie', 'lu', 'uk', 'us', 'ca', 'au', 'jp', 'in',
  'br', 'mx', 'ar', 'za', 'nz', 'sg', 'hk', 'kr', 'tw', 'il', 'tr', 'eu', 'tv',
  'live', 'pro', 'site', 'online', 'store', 'tech', 'digital', 'media', 'agency',
  'solutions', 'group', 'team', 'systems', 'services', 'software', 'network',
]);

// Dominios genéricos/infraestructura
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
  'outlook.com', 'microsoft.com', 'google.co', 'gstatic.com', 'fontawesome.com',
  'cdnjs.cloudflare.com', 'maxcdn.bootstrapcdn.com',
]);

function rootOf(domain) {
  // Toma las últimas 2 labels (deezer.com de www.deezer.com)
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

async function parseYesWeHack(url) {
  const html = await getText(url, {
    headers: { 'User-Agent': YWH_UA },
    timeoutMs: 20000,
  });

  if (!html) return { error: 'No se pudo cargar la página del programa' };

  const result = {
    source: 'yeswehack',
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

  // ── Extraer dominios de la sección scope ──
  const domRe = /[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+/gi;

  const scopeDomains = new Set();
  const scopeMatches = scopeHtml.match(domRe) || [];
  for (const m of scopeMatches) {
    const c = cleanDomain(m);
    if (isValidDomain(c)) scopeDomains.add(c);
  }

  const outDomains = new Set();
  const outMatches = outHtml.match(domRe) || [];
  for (const m of outMatches) {
    const c = cleanDomain(m);
    if (isValidDomain(c)) outDomains.add(c);
  }

  // ── Agrupar por root domain y encontrar el del programa ──
  // 1. Quitar dominios out-of-scope de los in-scope
  for (const od of outDomains) scopeDomains.delete(od);

  // 2. Agrupar por root
  const rootFreq = {};
  for (const d of scopeDomains) {
    const root = rootOf(d);
    rootFreq[root] = (rootFreq[root] || 0) + 1;
  }
  // Ordenar por frecuencia, descartando roots genéricos
  const rootEntries = Object.entries(rootFreq)
    .filter(([root]) => !GENERIC.has(root))
    .sort((a, b) => b[1] - a[1]);

  let domains = [];
  if (rootEntries.length) {
    // El root más frecuente es el dominio del programa
    const programRoot = rootEntries[0][0];
    domains = [...scopeDomains].filter(d => {
      const r = rootOf(d);
      return r === programRoot;
    });
    // Si el root del programa no capturó suficientes, añadir otros roots frecuentes
    if (domains.length < 2 && rootEntries.length > 1) {
      for (const [root] of rootEntries.slice(1, 4)) {
        const extra = [...scopeDomains].filter(d => rootOf(d) === root);
        domains = domains.concat(extra);
      }
    }
  } else {
    domains = [...scopeDomains];
  }

  result.domains = domains.slice(0, 25);
  result.target = domains[0] || '';
  result.outOfScope = [...outDomains].filter(d => !GENERIC.has(d)).slice(0, 20);

  // ── User-Agent requerido ──
  const uaPatterns = [
    /append[\s\S]{0,120}["'‘’]\s*(bug-bounty-?\s*[\w-]+)["'‘’]/i,
    /\(bug-bounty-?\s*[\w-]+\)/i,
    /(bug-bounty-?\s*HunterName)/i,
    /(bug-bounty[\s-][\w-]{3,30})/i,
  ];
  for (const re of uaPatterns) {
    const m = html.match(re);
    if (m) {
      let ua = (m[1] || m[0]).trim().replace(/['"‘’]/g, '');
      if (ua.startsWith('bug-bounty')) ua = `knk-suite-researcher/2.0 ${ua}`;
      result.userAgent = ua;
      break;
    }
  }
  // Si no encontró nada, buscar la frase exacta de la política
  if (!result.userAgent) {
    const sectMatch = html.match(/User agent[\s\S]{0,300}?bug.?bounty[\s\S]{0,50}?([\w-]{3,40})/i);
    if (sectMatch) result.userAgent = `knk-suite-researcher/2.0 bug-bounty-${sectMatch[1]}`;
  }

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

  // ── Política resumida ──
  const policyBits = [];
  if (/responsible disclosure/i.test(html)) policyBits.push('Responsible Disclosure');
  if (/coordinated disclosure/i.test(html)) policyBits.push('Coordinated Disclosure');
  if (/CVSS/i.test(html)) policyBits.push('CVSS 3.1');
  if (/No DoS|denial of service/i.test(html)) policyBits.push('No DoS');
  if (/screenshots/i.test(html)) policyBits.push('Screenshots requeridos');
  if (/proof of concept|PoC/i.test(html)) policyBits.push('PoC obligatorio');
  if (/user agent/i.test(html)) policyBits.push('User-Agent obligatorio');
  result.policy = policyBits.join(' | ') || 'Leer política completa';

  return result;
}

module.exports = { parseYesWeHack };