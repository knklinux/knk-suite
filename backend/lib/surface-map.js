'use strict';

// ============================================================================
// KNK SUITE v2 — Surface mapping (SPA JS bundles)
// Descarga el index y los bundles JS del SPA en scope, extrae endpoints e
// identificadores, y guarda evidencias locales. Todo el tráfico pasa por el
// limiter global, el UA de la sesión y el filtro de scope/anti-SSRF de net.js.
// ============================================================================

const netMod = require('./net');

const MAX_BUNDLES = 12;
const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
const MAX_FOCUS_BUNDLES = 10;

// ── Extractores puros (sin red, testables) ────────────────────────────────

function extractScriptSrcs(html, baseUrl) {
  const out = [];
  // <script src="..."> clásico
  const srcRe = /<script[^>]+src\s*=\s*["']([^"']+)["']/gi;
  // <link rel="modulepreload|preload|prefetch" href="...js"> (SPAs modernos
  // tipo Remix/React Router: chatgpt.com no usa <script src>, inlinea todo).
  const hrefRe = /<link[^>]+href\s*=\s*["']([^"']*\.js[^"']*)["']/gi;
  const isJsAsset = (pathname) => !/\.(css|png|jpe?g|svg|gif|webp|woff2?|ttf|ico|map)(?:\?|$)/i.test(pathname);
  const push = (raw) => {
    try {
      const u = new URL(raw, baseUrl);
      if ((u.protocol === 'http:' || u.protocol === 'https:') && isJsAsset(u.pathname)) out.push(u.toString());
    } catch { /* inválido: se ignora */ }
  };
  let m;
  while ((m = srcRe.exec(String(html || ''))) !== null) push(m[1]);
  while ((m = hrefRe.exec(String(html || ''))) !== null) push(m[1]);
  return [...new Set(out)];
}

// Normaliza una ruta con segmentos dinámicos: /backend-api/${t.x} → /backend-api/{param}
function normalizeTemplatePath(p) {
  return String(p || '').replace(/\$\{[^}]+\}/g, '{param}').replace(/\s+/g, '');
}

// Valida una ruta extraída: sin JSX/HTML, comillas, barras, ${} sin cerrar
// ni restos de normalización parcial (p. ej. `).toString()}`).
function isValidEndpointPath(p) {
  if (!p || p.length < 4 || p.length > 240) return false;
  if (/[<>"'\\]/.test(p) || p.includes(')')) return false;
  if (/\$\{/.test(p)) return false;
  return true;
}

// Template literals con ${...}: rutas construidas dinámicamente que los
// extractores de literales no ven (p. ej. `/backend-api/${t.pathname.slice(5)}`,
// `conversation/${id}/messages`). Los ${...} se normalizan a {param}.
function extractTemplatePaths(js) {
  const out = new Set();
  const tplRe = /`([^`]*\$\{[^`]+?\}[^`]*)`/g;
  let m;
  while ((m = tplRe.exec(String(js || ''))) !== null) {
    let p = normalizeTemplatePath(m[1]).trim();
    if (!p || !p.includes('/') || p.includes('://')) continue;
    if (!p.startsWith('/')) p = '/' + p;
    // Ruido: plantillas JSX/HTML, literales regex y mensajes de error
    // (los mensajes de formatjs/Remix empiezan por mayúscula tras el /).
    if (!/^\/([a-z0-9#_]|\{param\})/.test(p) || !isValidEndpointPath(p)) continue;
    out.add(p);
  }
  return [...out];
}

// Paths API relevantes: literales de string que empiezan por / y pertenecen a
// rutas de API/producto típicas (backend-api, api, v1..v5, conversation,
// files, auth, session, models, chat, attachments, settings, me, dashboard…).
function extractEndpoints(js) {
  const out = new Set();
  const text = String(js || '');
  const pathRe = /["'`](\/(?:backend-api|api|v\d+|auth|session|conversation|conversations|files|file|me|models|chat|attachments|settings|dashboard|admin|organization|organizations|team|teams|payments|billing|subscription|usage|invites|members)\/[A-Za-z0-9_\-/{}.:?=&%$]*)/g;
  let m;
  while ((m = pathRe.exec(text)) !== null) {
    const p = normalizeTemplatePath(m[1]);
    if (isValidEndpointPath(p)) out.add(p);
  }
  // Llamadas fetch/axios/wrappers React Query (safeGet/safePost/...) con URL
  // literal (relativas o absolutas en scope). También captura ${...} normalizados.
  const callRe = /(?:fetch|axios\.(?:get|post|put|patch|delete)|\.safe(?:Get|Post|Put|Patch|Delete))\s*\(\s*["'`]([^"'`]{2,240})["'`]/g;
  while ((m = callRe.exec(text)) !== null) {
    const v = normalizeTemplatePath(m[1]);
    if (/^\//.test(v)) {
      if (isValidEndpointPath(v) && !/\.(css|png|jpg|svg|woff2?|map)$/i.test(v)) out.add(v);
    } else {
      try {
        const u = new URL(v);
        if (u.protocol === 'http:' || u.protocol === 'https:') out.add(u.pathname + u.search);
      } catch { /* relativa de otro tipo */ }
    }
  }
  // Rutas dinámicas con template literals (no visibles para los literales)
  for (const t of extractTemplatePaths(text)) out.add(t);
  return [...out].sort();
}

// Chunks de ruta lazy del manifest del SPA: nombre-ruta → URL del bundle.
// El manifest (manifest-*.js) mapea rutas (admin.billing, checkout._entity._checkoutId,
// payments.success...) a sus bundles; la mayoría NO se descarga con el index.
function extractRouteChunks(js, baseUrl) {
  const out = [];
  const seen = new Set();
  const re = /([A-Za-z0-9][A-Za-z0-9_.\-]*)-([a-z0-9]{8,}\.js)/g;
  let m;
  while ((m = re.exec(String(js || ''))) !== null) {
    const full = m[0];
    if (seen.has(full)) continue;
    seen.add(full);
    const route = m[1];
    try {
      const base = baseUrl || 'https://x/';
      out.push({ route, url: new URL('/cdn/assets/' + full, base).toString() });
    } catch { /* ignorar */ }
  }
  return out;
}

// Foco "payments": rutas del manifest relacionadas con pago/facturación.
const PAYMENT_ROUTE_RE = /(checkout|buy|bill|plan|purchas|subscri|credit|usage|member|team|workspace|account|invite|payment)/i;
function paymentFocusMatch(route) {
  return PAYMENT_ROUTE_RE.test(String(route || ''));
}

// Identificadores/parámetros de interés: cada uno es un candidato a vector.
function extractIdentifiers(js) {
  const keywords = [
    'conversation_id', 'conversationId', 'user_id', 'userId', 'org_id', 'orgId',
    'organization_id', 'ownerId', 'owner_id', 'price', 'amount', 'role',
    'uuid', 'session_id', 'sessionId', 'access_token', 'id_token', 'share_id',
    'shareId', 'file_id', 'fileId', 'attachment_id', 'attachmentId',
    'message_id', 'messageId', 'team_id', 'teamId', 'invite_id', 'inviteId',
    'billing_id', 'billingId', 'subscription_id', 'subscriptionId',
  ];
  const text = String(js || '');
  const found = {};
  for (const k of keywords) {
    const re = new RegExp(`["'\`]?\\b${k}\\b["'\`]?:?`, 'gi');
    const count = (text.match(re) || []).length;
    if (count > 0) found[k] = count;
  }
  return Object.fromEntries(Object.entries(found).sort((a, b) => b[1] - a[1]));
}

function isSameScopeHost(host, scopeEntries) {
  const h = String(host || '').toLowerCase();
  const entries = Array.isArray(scopeEntries) ? scopeEntries : [];
  if (!entries.length) return true; // sin scope no se filtra
  return entries.some((entry) => {
    const e = String(entry || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
    if (!e) return false;
    if (e.startsWith('*.')) return h === e.slice(2) || h.endsWith('.' + e.slice(2));
    return h === e;
  });
}

// ── Orquestación con red (sujeta a limiter/scope/UA) ───────────────────────

async function mapSurface(targetUrl, opts = {}) {
  const base = String(targetUrl || '').replace(/\/+$/, '');
  const maxBundles = Math.min(MAX_BUNDLES, Math.max(1, Number(opts.maxBundles) || MAX_BUNDLES));
  const focus = opts.focus ? String(opts.focus).trim().toLowerCase() : null;
  const maxFocusBundles = Math.min(MAX_FOCUS_BUNDLES, Math.max(1, Number(opts.maxFocusBundles) || MAX_FOCUS_BUNDLES));
  const result = {
    target: base,
    status: null,
    indexBytes: 0,
    bundles: [],
    totalBundles: 0,
    endpoints: [],
    identifiers: {},
    skippedOutOfScope: [],
    blocked: null,
    savedEvidence: [],
    routeChunks: [],
    focus: focus || null,
    focusBundles: [],
    focusSkipped: [],
  };

  const indexR = await netMod.fetch(base, { timeoutMs: 20000 });
  result.status = indexR.status;
  // Cabeceras del index: útil como evidencia y para diagnosticar bloqueos
  // (cf-mitigated, server, content-type...).
  result.indexHeaders = indexR.headers || {};
  if (indexR.outOfScope || indexR.blocked) {
    result.blocked = 'index fuera de scope o bloqueado por anti-SSRF';
    return result;
  }
  if (!indexR.ok) return result;
  result.indexBytes = (indexR.text || '').length;
  // El index de chatgpt.com inlinea config de bootstrap (funnel de pago,
  // IDs de analytics, taxonomía de impuestos Stripe...). Se guarda como
  // evidencia local para el análisis posterior.
  try {
    const file = netMod.saveEvidence('surface-index.html', indexR.text || '');
    result.savedEvidence.push(file);
  } catch { /* evidencia opcional */ }

  const scope = opts.scope || [];
  const scriptUrls = extractScriptSrcs(indexR.text, base)
    .filter((u) => {
      let host = '';
      try { host = new URL(u).hostname; } catch { return false; }
      const ok = !scope.length || isSameScopeHost(host, scope);
      if (!ok) result.skippedOutOfScope.push(u);
      return ok;
    })
    .slice(0, maxBundles);

  for (const url of scriptUrls) {
    let r;
    try { r = await netMod.fetch(url, { timeoutMs: 20000 }); }
    catch { continue; }
    if (r.outOfScope || r.blocked) { result.skippedOutOfScope.push(url); continue; }
    const body = r.text || '';
    if (!r.ok) continue;
    if (Buffer.byteLength(body) > MAX_BUNDLE_BYTES) continue;
    result.bundles.push({ url, status: r.status, bytes: Buffer.byteLength(body), endpoints: extractEndpoints(body), ...(/manifest-[^/]+\.js/.test(url) ? { text: body } : {}) });
    for (const e of extractEndpoints(body)) result.endpoints.push(e);
    Object.assign(result.identifiers, extractIdentifiers(body));
    const evidenceName = 'surface-bundle-' + new URL(url).pathname.split('/').pop().slice(0, 60) + '.js';
    try {
      const file = netMod.saveEvidence(evidenceName, body);
      result.savedEvidence.push(file);
    } catch { /* evidencia opcional */ }
  }
  result.totalBundles = result.bundles.length;

  // Manifest del SPA: mapa completo de rutas → chunks lazy. Con focus="payments"
  // se descargan además los bundles de pago/facturación que el index no precarga.
  const manifestBundle = result.bundles.find((b) => /manifest-[^/]+\.js/.test(b.url));
  if (manifestBundle) {
    result.routeChunks = extractRouteChunks(manifestBundle.text || '', base);
    if (focus) {
      const objetivo = focus === 'payments' ? paymentFocusMatch : (route) => route.includes(focus);
      const candidatos = result.routeChunks.filter((c) => objetivo(c.route)).slice(0, maxFocusBundles);
      for (const chunk of candidatos) {
        if (!isSameScopeHost(new URL(chunk.url).hostname, opts.scope || [])) {
          result.focusSkipped.push(chunk.url);
          continue;
        }
        let r;
        try { r = await netMod.fetch(chunk.url, { timeoutMs: 20000 }); } catch { continue; }
        if (r.outOfScope || r.blocked) { result.focusSkipped.push(chunk.url); continue; }
        const body = r.text || '';
        if (!r.ok || Buffer.byteLength(body) > MAX_BUNDLE_BYTES) continue;
        result.focusBundles.push({ route: chunk.route, url: chunk.url, status: r.status, bytes: Buffer.byteLength(body), endpoints: extractEndpoints(body) });
        for (const e of extractEndpoints(body)) result.endpoints.push(e);
        Object.assign(result.identifiers, extractIdentifiers(body));
        const evidenceName = 'surface-focus-' + chunk.route.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 50) + '.js';
        try {
          const file = netMod.saveEvidence(evidenceName, body);
          result.savedEvidence.push(file);
        } catch { /* evidencia opcional */ }
      }
    }
  }

  // El manifest completo no se serializa en el resultado (solo su mapa de rutas)
  if (manifestBundle && manifestBundle.text) delete manifestBundle.text;

  result.endpoints = [...new Set(result.endpoints)].sort();

  // Frecuencias de identificadores agregadas por bundle
  result.identifiers = Object.fromEntries(
    Object.entries(result.identifiers).sort((a, b) => b[1] - a[1])
  );

  return result;
}

module.exports = {
  extractScriptSrcs,
  extractEndpoints,
  extractTemplatePaths,
  extractRouteChunks,
  paymentFocusMatch,
  extractIdentifiers,
  isSameScopeHost,
  mapSurface,
  MAX_BUNDLES,
  MAX_FOCUS_BUNDLES,
};