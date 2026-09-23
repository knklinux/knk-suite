'use strict';

// ============================================================================
// lib/param-hunter.js — Caza de parámetros reflejados (Param Hunter)
//
// Inspirado en la hoja de trucos "Top 25 XSS Parameters" y en el flujo de
// trabajo del bug bounty (descubrir → entender → trazar reflexión →
// comprobar codificación → validar en entorno autorizado):
//
//   1. Descubre parámetros: wordlists Top-25 XSS + BAC + SQLi + Open Redirect
//      + parser de la propia URL objetivo (los parámetros existentes SIEMPRE
//      van primero).
//   2. NO inyecta payloads destructivos:
//        · XSS/BAC/SQLi: canario alfanumérico único (knkxxxxxxxx). En un
//          parámetro numérico, un valor alfabético ya provoca el error de BD
//          sin necesidad de comillas ni payloads.
//        · Open-redirect: se manda una URL DEL MISMO HOST (u.origin + canario
//          en el path) — jamás un dominio externo.
//   3. Clasifica con clasificadores específicos por modo:
//        · classifySqli: firmas de error de MySQL/PostgreSQL/MSSQL/Oracle/
//          SQLite/genérico → behavior 'sqli_error' (P1) con el motor.
//        · classifyRedirect: 30x + Location hacia el probe del mismo host →
//          behavior 'redirect_param' (P2, candidato open redirect).
//        · Genéricos: reflected/encoded/param_exists/not_found (XSS/BAC).
//   4. Barreras idénticas al Repeater: scope OBLIGATORIO de la sesión,
//      envío por lib/net.fetch (limiter global >=800ms, anti-SSRF,
//      UA de la sesión), concurrencia serie y timeout corto.
//
// Un parámetro no es vulnerable por aparecer en una lista: este módulo solo
// señala CANDIDATOS y su comportamiento observado; la validación manual
// (Repeater) y la autorización del programa son responsabilidad del operador.
// ============================================================================

const net = require('./net');

// ── Wordlists (fuente: hoja de trucos "Top 25 XSS Parameters", root-x.dev) ──
const TOP_XSS_PARAMS = [
  'q', 's', 'search', 'id', 'lang', 'keyword', 'query', 'page', 'keywords',
  'year', 'view', 'email', 'type', 'name', 'p', 'month', 'immagine',
  'list_type', 'url', 'terms', 'categoryid', 'key', 'l', 'begindate', 'enddate',
];

// Parámetros clásicos de Broken Access Control / abuso de referencia directa
const BAC_PARAMS = [
  'dest', 'destination', 'redirect', 'redirect_uri', 'next', 'return', 'returnTo',
  'path', 'folder', 'dir', 'file', 'filepath', 'filename', 'download',
  'admin', 'debug', 'test', 'userid', 'uid', 'account_id', 'owner',
];

// Parámetros con tipado numérico/tipado por BD: candidatos clásicos a SQLi
// (son NOMBRES de parámetros, no payloads — Seclists/fuzzdb style).
const SQLI_PARAMS = [
  'id', 'cat', 'category', 'categoryid', 'item', 'product', 'productid', 'pid',
  'user', 'userid', 'uid', 'page', 'pageid', 'page_id', 'post', 'postid',
  'news', 'article', 'articleid', 'view', 'order', 'orderby', 'sort', 'sortby',
  'filter', 'ref', 'refid', 'no', 'num', 'number', 'code', 'sid', 'tid', 'fid',
  'doc', 'docid', 'entry', 'entryid', 'row', 'record', 'wp_id', 'menu', 'tab',
];

// Parámetros que las apps usan para redirigir (candidatos open redirect)
const OPEN_REDIRECT_PARAMS = [
  'url', 'next', 'redirect', 'redirect_uri', 'redirect_url', 'redirect_to',
  'return', 'returnTo', 'return_url', 'returnToUrl', 'return_path',
  'goto', 'go', 'target', 'dest', 'destination', 'rurl', 'r', 'u',
  'continuation', 'link', 'forward', 'continue', 'checkout_url',
  'callback', 'callback_url', 'success_url', 'window',
];

const WORDLISTS = {
  'top-xss': { label: 'Top 25 XSS (hoja de trucos)', params: TOP_XSS_PARAMS },
  'bac': { label: 'BAC / Open Redirect (carpetas, rutas, dest)', params: BAC_PARAMS },
  'sqli': { label: 'SQLi (parámetros tipados: id, cat, sort…)', params: SQLI_PARAMS },
  'open-redirect': { label: 'Open Redirect (next, url, return…)', params: OPEN_REDIRECT_PARAMS },
  'all': { label: 'Top 25 XSS + BAC + SQLi + Open Redirect', params: [...new Set([...TOP_XSS_PARAMS, ...BAC_PARAMS, ...SQLI_PARAMS, ...OPEN_REDIRECT_PARAMS])] },
};

// ── Utilidades ──────────────────────────────────────────────────────────────
function canary() {
  // Canario alfanumérico inofensivo: nunca contiene metacaracteres.
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = 'knk';
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function extractTargetParams(urlObj) {
  // Los parámetros que YA tiene la URL van siempre primero: son los que la
  // app declara realmente usar.
  return [...new Set([...urlObj.searchParams.keys()])].slice(0, 20);
}

function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCharCode(parseInt(h, 16)); } catch { return _; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCharCode(Number(d)); } catch { return _; } })
    .replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

/**
 * Clasifica la respuesta respecto al canario (modo XSS/BAC).
 * @returns {{behavior: string, context: string, detail: string}}
 */
function classify(body, canaryValue) {
  const html = String(body || '');
  if (!html.includes(canaryValue)) {
    // ¿aparece decodificado (la app lo codificó al escribir)?
    const decoded = decodeEntities(html);
    if (decoded.includes(canaryValue)) {
      return { behavior: 'encoded', context: 'n/a', detail: 'el canario aparece tras decodificar entidades HTML (la app lo codifica al escribir)' };
    }
    return { behavior: 'not_found', context: 'n/a', detail: 'sin efecto observable' };
  }
  // Reflejo literal: localizar contexto y posible recorte.
  const idx = html.indexOf(canaryValue);
  const before = html.slice(Math.max(0, idx - 60), idx);
  const after = html.slice(idx + canaryValue.length, idx + canaryValue.length + 60);
  let context = 'desconocido';
  let behavior = 'reflected';
  if (/<script[\s>]/i.test(before) || /<script/i.test(before.slice(-20))) context = 'script';
  else if (/<[a-z][^>]*$/i.test(before)) context = 'atributo';
  else if (/>[^<]*$/i.test(before)) context = 'texto';
  else if (/^\s*['"]?\s*[:=]/i.test(after) || /["']\s*[:=]\s*["']?\s*$/i.test(before) || /=\s*["']\s*$/i.test(before) || /^\s*["']\s*[,;}]/.test(after)) context = 'js-string';
  const tail = html.slice(idx + canaryValue.length, idx + canaryValue.length + 4);
  const gotAll = html.split(canaryValue).length - 1;
  if (context === 'texto' && after.trim().startsWith('<')) behavior = 'reflected';
  if (gotAll > 1) behavior = 'reflected';
  return {
    behavior,
    context,
    detail: `reflejado literal x${gotAll} en contexto ${context} · después: "${(before.slice(-24) + '◆' + tail).replace(/\s+/g, ' ').slice(0, 60)}"`,
  };
}

// ── Clasificador SQLi: firmas de error de base de datos ─────────────────────
const DB_ERROR_SIGNATURES = [
  { engine: 'mysql', re: /you have an error in your sql syntax|warning: mysql_|mysql_fetch_|MySQLSyntaxErrorException|mysqli?_query\(\)/i },
  { engine: 'postgresql', re: /PostgreSQL.*ERROR|pg_query\(\)|syntax error at or near|psycopg2/i },
  { engine: 'mssql', re: /Microsoft OLE DB Provider for SQL Server|ODBC SQL Server Driver|Unclosed quotation mark after|SQLServerException/i },
  { engine: 'oracle', re: /ORA-\d{5}|quoted string not properly terminated|OracleException/i },
  { engine: 'sqlite', re: /SQLite3::|SQLITE_ERROR|SQLITE_\w+|unrecognized token/i },
  { engine: 'generic', re: /SQL syntax|SQLSTATE\[|SQLException|SQL error|database error|DB2 SQL error/i },
];

/**
 * Busca firmas de error de BD en una respuesta (canario alfabético sobre un
 * parámetro numérico las provoca sin necesidad de payloads).
 * @returns {{engine: string, signature: string} | null}
 */
function classifySqli(body) {
  const text = String(body || '');
  if (!text) return null;
  for (const sig of DB_ERROR_SIGNATURES) {
    const m = text.match(sig.re);
    if (m) return { engine: sig.engine, signature: String(m[0]).slice(0, 80) };
  }
  return null;
}

/**
 * Clasificador open-redirect: ¿la respuesta es 30x y su Location apunta al
 * probe DEL MISMO HOST que enviamos? (jamás mandamos dominios externos).
 * @returns {{to: string} | null}
 */
function classifyRedirect(res, probeUrl) {
  const status = Number(res && res.status);
  if (![301, 302, 303, 307, 308].includes(status)) return null;
  const h = res.headers || {};
  const loc = String(h.location || h.Location || '').trim();
  if (!loc) return null;
  const probe = String(probeUrl || '');
  if (loc === probe || loc.startsWith(probe)) return { to: loc.slice(0, 200) };
  // el path del canario puede aparecer tras normalización (./, absoluta…)
  try {
    const ln = new URL(loc, probe).toString();
    if (ln === probe || ln.startsWith(probe)) return { to: ln.slice(0, 200) };
  } catch { /* location relativa rara */ }
  return null;
}

// Diferencia estructurada entre respuesta base y respuesta con parámetro.
function delta(baseLen, baseHashLike, res) {
  const lenDelta = res.length - baseLen;
  const changed = lenDelta !== 0 || (baseHashLike && res.hashLike !== baseHashLike);
  return { lenDelta, changed };
}

// Valor de prueba según el modo: open-redirect manda URL DEL MISMO HOST;
// el resto, el canario alfanumérico puro.
function probeValueFor(wordlistId, u, mark) {
  if (wordlistId === 'open-redirect') return `${u.origin}/knk-${mark.replace(/^knk/, '')}`;
  return mark;
}

// ── Caza principal ──────────────────────────────────────────────────────────
async function hunt({ url, wordlist = 'all', limit = 25, timeoutMs = 8000, maxParams = 40, scope, historyParams, mode = 'query', bodyParams, headers } = {}) {
  let u;
  try { u = new URL(String(url || '')); } catch { return { ok: false, error: 'URL inválida' }; }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) {
    return { ok: false, error: 'solo URLs HTTP(S) sin credenciales' };
  }
  // Scope OBLIGATORIO (mismo criterio que Repeater: sin scope definido TAMBIÉN
  // se rechaza): la caza solo se lanza contra objetivos autorizados en la sesión.
  const host = u.hostname;
  const scopeList = Array.isArray(scope) ? scope : [];
  if (!scopeList.length || !net.inScope(host)) {
    return { ok: false, error: `FUERA DE SCOPE: "${host}" no está en el scope de la sesión. Defínelo en Targets primero.` };
  }

  const wl = WORDLISTS[wordlist] ? wordlist : 'all';
  const targetParams = extractTargetParams(u);
  // Parámetros observados en tráfico real (historial del proxy), ya vistos en
  // peticiones al objetivo: van DESPUÉS de los de la URL y ANTES que las
  // wordlists — ordenados por frecuencia (los que la app usa más, primero).
  const seen = new Set(targetParams);
  const hist = (Array.isArray(historyParams) ? historyParams : [])
    .filter((x) => x && typeof x.name === 'string' && x.name.length <= 64 && /^[A-Za-z_][A-Za-z0-9_.\[\]-]*$/.test(x.name) && !seen.has(x.name))
    .sort((a, b) => (b.count || 0) - (a.count || 0));
  // Modo form (POST): los campos vienen de cuerpos de formularios capturados
  // por el proxy. NUNCA se reenvían valores capturados (credenciales, tokens,
  // datos de compra): cada sonda envía SOLO el campo de prueba con el canario.
  const isForm = mode === 'form';
  const bp = (isForm && Array.isArray(bodyParams) ? bodyParams : [])
    .filter((x) => x && typeof x.name === 'string' && x.name.length <= 64 && /^[A-Za-z_][A-Za-z0-9_.\[\]-]*$/.test(x.name))
    .sort((a, b) => (b.count || 0) - (a.count || 0));
  const list = isForm ? [
    ...bp.map((p) => ({ name: p.name, origin: 'del-cuerpo' })),
    ...WORDLISTS[wl].params.filter((p) => !bp.some((h) => h.name === p)).map((p) => ({ name: p, origin: 'wordlist' })),
  ] : [
    ...targetParams.map((p) => ({ name: p, origin: 'en-la-url' })),
    ...hist.map((p) => ({ name: p.name, origin: 'historial' })),
    ...WORDLISTS[wl].params.filter((p) => !targetParams.includes(p) && !hist.some((h) => h.name === p)).map((p) => ({ name: p, origin: 'wordlist' })),
  ].slice(0, Math.max(1, Math.min(Number(maxParams) || 40, 60)));
  if (isForm) list.length = Math.min(list.length, Math.max(1, Math.min(Number(maxParams) || 40, 60)));

  // Cabeceras extra del operador (p. ej. Cookie/Authorization de SU propia
  // sesión para cazar autenticado). Saneadas: máx 10, string ≤2KB, sin
  // cabeceras prohibidas (host/content-length las fija net.fetch).
  const extraHeaders = {};
  if (headers && typeof headers === 'object') {
    for (const [k, v] of Object.entries(headers).slice(0, 10)) {
      const key = String(k).trim();
      if (!key || /^(host|content-length|connection)$/i.test(key)) continue;
      // Cookie/Authorization propios pueden ser largos (varios KB): cap 8KB.
      const cap = /^(cookie|authorization)$/i.test(key) ? 8192 : 2048;
      extraHeaders[key] = String(v).slice(0, cap);
    }
  }
  const FORM_HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded', ...extraHeaders };
  const GET_HEADERS = { ...extraHeaders };
  // Cookie-jar del operador si no se pasó Cookie explícita (caza autenticada).
  try {
    const hasCookie = Object.keys(GET_HEADERS).some((k) => k.toLowerCase() === 'cookie');
    if (!hasCookie) {
      const jarCookie = require('./cookie-jar').get(u.hostname);
      if (jarCookie) { GET_HEADERS.cookie = jarCookie; FORM_HEADERS.cookie = jarCookie; }
    }
  } catch {}
  const base = isForm
    ? await net.fetch(u.toString(), { method: 'POST', headers: FORM_HEADERS, body: '', timeoutMs, maxRedirects: 0 })
    : await net.fetch(u.toString(), { headers: GET_HEADERS, timeoutMs, maxRedirects: 0 });
  if (!base.ok && !base.status) return { ok: false, error: `el objetivo no responde: ${base.error || base.status}` };
  const baseLen = base.text ? base.text.length : 0;

  // 2) Un canario único por ejecución: localizable y sin significado.
  const mark = canary();
  const probeValue = probeValueFor(wl, u, mark);
  // Modo HPP (HTTP Parameter Pollution): el mismo parámetro DOS veces con
  // valores distintos (?p=BASE&p=CANARIO y al revés). Revela si el backend
  // toma el primero, el último, concatena o falla — vector clásico para
  // bypass de controles, IDOR y diferencias de precio/lógica. 2 reqs/parám.
  const isHpp = mode === 'hpp';
  const hppBase = () => 'knkbase' + Math.random().toString(36).slice(2, 7);
  const results = [];
  let probed = 0;
  for (const { name, origin } of list) {
    if (probed >= limit) break;
    if (isHpp && !isForm) {
      // HPP query: orden normal (base,canario) y reverso (canario,base)
      const trialA = new URL(u.toString());
      trialA.searchParams.append(name, hppBase());
      trialA.searchParams.append(name, probeValue);
      const trialB = new URL(u.toString());
      trialB.searchParams.append(name, probeValue);
      trialB.searchParams.append(name, hppBase());
      const [ra, rb] = await Promise.all([
        net.fetch(trialA.toString(), { headers: GET_HEADERS, timeoutMs, maxRedirects: 0 }),
        net.fetch(trialB.toString(), { headers: GET_HEADERS, timeoutMs, maxRedirects: 0 }),
      ]);
      probed++;
      const ba = ra.text || '', bb = rb.text || '';
      const inA = ba.includes(mark) || decodeEntities(ba).includes(mark);
      const inB = bb.includes(mark) || decodeEntities(bb).includes(mark);
      let behavior = 'not_found', detail = 'duplicado ignorado en ambos órdenes', priority = '—';
      if (inA && inB) { behavior = 'hpp_echo_both'; detail = 'el canario aparece con el parámetro duplicado en AMBOS órdenes (concatena o refleja todo)'; priority = 'P2'; }
      else if (inA && !inB) { behavior = 'hpp_last_wins'; detail = 'solo refleja cuando el canario va SEGUNDO → el backend toma el ÚLTIMO valor'; priority = 'P2'; }
      else if (!inA && inB) { behavior = 'hpp_first_wins'; detail = 'solo refleja cuando el canario va PRIMERO → el backend toma el PRIMER valor'; priority = 'P2'; }
      else {
        const d = delta(baseLen, null, { length: ba.length });
        if (Math.abs(d.lenDelta) >= 64) { behavior = 'param_exists'; detail = 'sin reflejo pero el duplicado cambia la respuesta (' + (d.lenDelta > 0 ? '+' : '') + d.lenDelta + 'B)'; priority = 'P3'; }
      }
      const dbErr = classifySqli(ba + bb);
      if (dbErr) results.push({ param: name, origin, behavior: 'sqli_error', context: dbErr.engine, priority: 'P1', detail: `error de BD (${dbErr.engine}) con parámetro duplicado` });
      else results.push({ param: name, origin, behavior, context: 'hpp', priority, detail });
      continue;
    }
    let res;
    if (isForm) {
      const form = new URLSearchParams();
      form.set(name, probeValue);
      res = await net.fetch(u.toString(), { method: 'POST', headers: FORM_HEADERS, body: form.toString(), timeoutMs, maxRedirects: 0 });
    } else {
      const trial = new URL(u.toString());
      trial.searchParams.set(name, probeValue);
      res = await net.fetch(trial.toString(), { headers: GET_HEADERS, timeoutMs, maxRedirects: 0 });
    }
    probed++;
    if (!res.ok && !res.status) {
      results.push({ param: name, origin, behavior: 'error', detail: (res.error || `HTTP ${res.status}`).slice(0, 80) });
      continue;
    }
    const body = res.text || '';

    // (a) Clasificador SQLi (en TODOS los modos: un error de BD es señal
    //     valiosa aunque la wordlist sea de XSS).
    const dbErr = classifySqli(body);
    if (dbErr) {
      results.push({
        param: name, origin, behavior: 'sqli_error', context: dbErr.engine, priority: 'P1',
        detail: `error de BD (${dbErr.engine}): "${dbErr.signature}" — candidato a inyección SQL en este parámetro`,
      });
      continue;
    }

    // (b) Clasificador open-redirect (solo en su modo: el probe es una URL
    //     del mismo host; si la app redirige hacia él, el parámetro redirige).
    if (wl === 'open-redirect') {
      const red = classifyRedirect(res, probeValue);
      if (red) {
        results.push({
          param: name, origin, behavior: 'redirect_param', context: '30x', priority: 'P2',
          detail: `redirige (30x) al probe del mismo host (${red.to.slice(0, 80)}) — candidato open redirect: prueba un dominio externo SOLO si el programa lo permite`,
        });
        continue;
      }
    }

    // (c) Flujo genérico XSS/BAC: reflexión del canario o delta observable.
    const cls = body.includes(mark) || decodeEntities(body).includes(mark)
      ? classify(body, mark)
      : (() => {
          const d = delta(baseLen, null, { length: body.length });
          const sign = d.lenDelta > 64 ? `cambia mucho la respuesta (+${d.lenDelta}B)` : d.lenDelta < -64 ? `cambia mucho la respuesta (${d.lenDelta}B)` : d.lenDelta !== 0 ? `cambia levemente (${d.lenDelta > 0 ? '+' : ''}${d.lenDelta}B)` : 'sin cambio de longitud';
          const looksError = /40[134]|error|forbidden|not found/i.test(body.slice(0, 400));
          if (looksError && Math.abs(d.lenDelta) < 512) return { behavior: 'param_exists', context: 'n/a', detail: `sin reflexión · ${sign} · respuesta tipo error/404` };
          if (Math.abs(d.lenDelta) >= 64) return { behavior: 'param_exists', context: 'n/a', detail: `sin reflexión · ${sign}` };
          return { behavior: 'not_found', context: 'n/a', detail: 'sin efecto observable' };
        })();
    const reflected = cls.behavior === 'reflected';
    const priority = reflected ? (cls.context === 'script' ? 'P1' : cls.context === 'atributo' ? 'P2' : 'P3')
      : cls.behavior === 'encoded' ? 'P4'
      : cls.behavior === 'param_exists' ? 'P3' : '—';
    results.push({ param: name, origin, behavior: cls.behavior, context: cls.context, priority, detail: cls.detail });
  }

  const order = { P1: 1, P2: 2, P3: 3, P4: 4, '—': 5 };
  results.sort((a, b) => (order[a.priority] || 9) - (order[b.priority] || 9));

  return {
    ok: true,
    url: u.toString(),
    host,
    authenticated: Object.keys(extraHeaders).length > 0,
    wordlist: wl,
    wordlistLabel: WORDLISTS[wl].label,
    canary: mark,
    base: { status: base.status, length: baseLen },
    mode: isHpp ? 'hpp' : (isForm ? 'form' : 'query'),
    paramsFromUrl: isForm ? 0 : targetParams.length,
    paramsFromHistory: list.filter((x) => x.origin === 'historial').length,
    paramsFromBody: list.filter((x) => x.origin === 'del-cuerpo').length,
    probed,
    reflected: results.filter((r) => r.behavior === 'reflected').length,
    encoded: results.filter((r) => r.behavior === 'encoded').length,
    exists: results.filter((r) => r.behavior === 'param_exists').length,
    sqliErrors: results.filter((r) => r.behavior === 'sqli_error').length,
    redirects: results.filter((r) => r.behavior === 'redirect_param').length,
    results,
    workflow: [
      'Descubrir parámetros (hecho arriba)',
      'Entiende su propósito (mira la respuesta y la app)',
      'Traza dónde se refleja la entrada (columna contexto)',
      'Comprueba la codificación de salida (behavior encoded vs reflected)',
      'Valida de forma segura y autorizada en el Repeater',
    ],
    reminder: 'Un parámetro no es automáticamente vulnerable por aparecer en una lista: verifica siempre el comportamiento real de la aplicación.',
  };
}

function wordlists() {
  return Object.entries(WORDLISTS).map(([id, w]) => ({ id, label: w.label, count: w.params.length, params: w.params }));
}

module.exports = {
  hunt, wordlists, classify, classifySqli, classifyRedirect, canary,
  WORDLISTS, TOP_XSS_PARAMS, BAC_PARAMS, SQLI_PARAMS, OPEN_REDIRECT_PARAMS,
  DB_ERROR_SIGNATURES,
};
