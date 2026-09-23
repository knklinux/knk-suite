'use strict';

// ============================================================================
// presets.js — Presets de programa: scope, out-of-scope, ritmo y OPPLAN base
// de un engagement, listos para aplicar a la sesión. El preset OpenAI bebe
// del Brief oficial curado en data/compliance-openai.json (recompensas,
// reglas de oro y out-of-scope). VERIFICA siempre el panel: el Brief manda.
// ============================================================================

const fs = require('fs');
const path = require('path');

function readCompliance() {
  const candidates = [
    path.join(__dirname, '..', 'data', 'compliance-openai.json'),
    path.join(__dirname, '..', '..', 'data', 'compliance-openai.json'),
  ];
  for (const p of candidates) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* siguiente */ }
  }
  return null;
}

const PRESETS = {
  'openai-bugcrowd': {
    id: 'openai-bugcrowd',
    nombre: 'OpenAI — Bugcrowd (Security BB)',
    programUrl: 'https://bugcrowd.com/engagements/openai',
    // Conservador: apex + lo que el Brief nombra. Amplía SOLO con grupos
    // objetivo de TU panel (API, ChatGPT, Codex, API keys...).
    // El motor de scope exige wildcard explícito para subdominios: el apex
    // solo NO cubre accounts./auth./chat. (matchesRule: '*.x' ⊃ subs, 'x' = apex).
    scope: ['openai.com', '*.openai.com', 'chatgpt.com', '*.chatgpt.com'],
    outOfScope: ['pay.openai.com', 'community.openai.com'],
    rateLimitMs: 2000,
    userAgent: 'knk-suite-researcher/2.0 bug-bounty-knk_linux',
    opplanBase: {
      nombre: 'OpenAI Bugcrowd — caza',
      objetivo: 'Cazar vulnerabilidades web/API en grupos objetivo del Brief con impacto demostrable y reporte completo.',
      reglas: 'Brief > todo. Solo cuentas propias. Mínimo acceso a datos (PII → parar). Sin DoS/fuerza bruta/scraping. Nada de model-issues (van al formulario, no a Bugcrowd).',
    },
    notas: [
      'Model-issues (jailbreaks, hallucinations) = FUERA (formulario de feedback).',
      'Bypass Cloudflare en api.openai.com = FUERA. Rate-limit temporal = FUERA.',
      'API keys filtradas (sk-) JAMÁS por Bugcrowd: formulario https://forms.gle/h8bQ5YKWzXb8FtrQ8.',
      'Safety BB (prompt-injection agentes ≥50%, integridad de cuentas) es OTRO programa.',
    ],
  },
  'cloudflare-hackerone': {
    id: 'cloudflare-hackerone',
    nombre: 'Cloudflare — HackerOne',
    programUrl: 'https://hackerone.com/cloudflare?type=team',
    // Del CSV oficial de scope (2026-09-17). Elegibles true/true + reglas.
    scope: ['*.cloudflare.com', 'dash.cloudflare.com', 'api.cloudflare.com', 'one.dash.cloudflare.com', '*.teams.cloudflare.com', '*.cloudflarepartners.com', 'cloudflareworkers.com'],
    outOfScope: ['support.cloudflare.com', 'community.cloudflare.com', 'support.cloudflarewarp.com', 'events.www.cloudflare.com', 'challenges.cloudflare.com', 'demo.realtime.cloudflare.com', 'api.staging.realtime.cloudflare.com', 'examples.realtime.cloudflare.com', 'react-examples.realtime.cloudflare.com', 'test.realtime.cloudflare.com', 'files.plugins.realtime.cloudflare.com', 'app.dyte.io'],
    rateLimitMs: 3000,
    userAgent: 'knk-suite-researcher/2.0 bug-bounty-knk_linux',
    opplanBase: {
      nombre: 'Cloudflare H1 — caza dash + API',
      objetivo: 'Recon pasivo y scan ligero de activos elegibles (dash 17% resolved, api, workers). Sin fuzzing agresivo: es el vendor WAF/DDoS; todo espaciado, reversible y con cuenta propia.',
      reglas: 'Solo elegibles true/true. Fuera: support/community (van a Zendesk), SaaS de terceros, 172.65.0.0/16 (Spectrum clientes), Turnstile, dominios realtime de test, WAF-bypass solo en waf.cumulusfire.net (sin bounty). github.com/cloudflare* SOLO paths /cloudflare (white-box manual).',
    },
    notas: [
      'dash sin login = 403 esperado: la caza real exige TU sesión (proxy + Repeater).',
      'api.cloudflare.com: con TU API token personal (nunca de otro).',
      'Workers AI: prompt-injection SIN impacto en Cloudflare = NO aceptado.',
      'WARP+: usar funciones de pago sin pagar = FUERA.',
      'vinext es experimental: triaje lento por duplicados.',
    ],
  },
  'atlassian-bugcrowd': {
    id: 'atlassian-bugcrowd',
    nombre: 'Atlassian — Bugcrowd',
    programUrl: 'https://bugcrowd.com/engagements/atlassian',
    scope: ['atlassian.com', '*.atlassian.com', 'atl-paas.net', '*.atl-paas.net'],
    outOfScope: ['support.atlassian.com', 'shop.atlassian.com', 'bytebucket.org', 'bitbucket.io', 'blog.bitbucket.org', 'support.loom.com', 'info.loom.com'],
    rateLimitMs: 4000,
    userAgent: 'knk-suite-researcher/2.0 bug-bounty-knk_linux',
    opplanBase: {
      nombre: 'Atlassian Bugcrowd — caza sin login',
      objetivo: 'Recon pasivo + revisión manual. PROHIBIDO scanners/fuzz/nuclei (expulsión). Foco: cross-instance leakage, SSRF, XSS, IDOR, traversal, Rovo.',
      reglas: 'Cuentas @bugcrowdninja.com en instancia propia bugbounty-test-<user>. Nunca instancias/datos de clientes. Sin DoS. Reportes en texto plano con PoC curl. Sin divulgar sin permiso.',
    },
    notas: [
      'Automatizados PROHIBIDOS: nada de ffuf/nuclei/dirbusting ni siquiera acotado.',
      'Enumeración/info-gathering NO interesa (colaboración por diseño).',
      'Clickjacking, headers, SPF/DMARC, open redirect (P4), self-XSS, libs sin PoC = FUERA.',
      'La instancia de test la creas TÚ con tu email @bugcrowdninja.com.',
    ],
  },
  'intigriti-generico': {
    id: 'intigriti-generico',
    nombre: 'Intigriti — plantilla por programa',
    programUrl: 'https://app.intigriti.com/',
    // Intigriti no tiene un scope global: AJUSTA scope/outOfScope con la ficha
    // "Domains & rules" de TU programa antes de cazar. Plantilla conservadora.
    scope: [],
    outOfScope: [],
    rateLimitMs: 3000,
    userAgent: 'knk-suite-researcher/2.0 bug-bounty-knk_linux',
    opplanBase: {
      nombre: 'Intigriti — caza por programa',
      objetivo: 'Cazar en el programa Intigriti aceptado con pruebas manuales + proxy/Repeater; automatización solo si la ficha lo permite.',
      reglas: 'La ficha del programa manda (scope, OOS, severity, disclosure). Respeta rate-limits y ventanas de test. Sin DoS/fuerza bruta salvo permiso explícito. Evidencia completa (request/response + pasos).',
    },
    notas: [
      'Pega aquí el scope EXACTO de tu ficha (Platform → programa → Domains & rules).',
      'Muchos programas Intigriti exigen endpoints con cuenta propia y prohíben scanners.',
      'Revisa "Out of scope" y "Known issues / duplicates" antes de reportar.',
    ],
  },
  'tesla-bugcrowd': {
    id: 'tesla-bugcrowd',
    nombre: 'Tesla — Bugcrowd',
    programUrl: 'https://bugcrowd.com/engagements/tesla',
    // VERIFICA el panel: el Brief manda (OOS y reglas cambian).
    scope: ['tesla.com', '*.tesla.com'],
    outOfScope: [],
    rateLimitMs: 2500,
    userAgent: 'knk-suite-researcher/2.0 bug-bounty-knk_linux',
    opplanBase: {
      nombre: 'Tesla Bugcrowd — caza',
      objetivo: 'Recon pasivo + revisión manual de superficie web/API con cuenta propia donde aplique.',
      reglas: 'Brief > todo. Solo cuentas propias. Sin DoS/fuerza bruta/scraping agresivo. Staging decommissioned (NXDOMAIN) no es hallazgo.',
    },
    notas: [
      'Staging viejo (ai-api-stg/uat, acs2-poc.voice) = NXDOMAIN decommissioned, no reportable.',
      'www con bot-wall 403: la caza real es tras login o en APIs.',
    ],
  },
  '1password-bugcrowd': {
    id: '1password-bugcrowd',
    nombre: '1Password — Bugcrowd',
    programUrl: 'https://bugcrowd.com/engagements/1password',
    // VERIFICA el panel: el Brief manda (OOS y reglas cambian).
    scope: ['1password.com', '*.1password.com'],
    outOfScope: [],
    rateLimitMs: 2500,
    userAgent: 'knk-suite-researcher/2.0 bug-bounty-knk_linux',
    opplanBase: {
      nombre: '1Password Bugcrowd — caza',
      objetivo: 'Recon pasivo + revisión manual con cuenta propia. Foco: lógica de cuentas/bóvedas compartidas, seguridad de cliente.',
      reglas: 'Brief > todo. Solo cuentas propias. Sin DoS. Sin probar con datos de terceros.',
    },
    notas: [
      'La app real (app/my/start) exige cuenta: el valor está tras login.',
      'Cuidado con vaults ajenos: solo los tuyos.',
    ],
  },
  'adobe-intigriti': {
    id: 'adobe-intigriti',
    nombre: 'Adobe — Intigriti (público, N1 hasta $15k)',
    programUrl: 'https://app.intigriti.com/',
    // Scope de la ficha pública 2026-09-21. Niveles: N1=bonus AI (hasta $15k),
    // N2=web/móvil alto valor, N3=empresarial/identidad. OOS por CLASE (ver notas).
    scope: [
      'adobe.com', '*.adobe.com',
      'acrobat.adobe.com', '*.acrobat.adobe.com',
      'stock.adobe.com', 'firefly.adobe.com', '*.firefly.adobe.com',
      'firefly-3p.ff.adobe.com', 'image-v5.ff.adobe.io', '*.ff.adobe.io',
      'bks.adobe.com', 'commerce.adobe.com',
      'lightroom.adobe.com', '*.lightroom.adobe.com',
      'photoshop.adobe.com',
      'new.express.adobe.com', 'portfolio.ccpsx.com', 'fonts.adobe.com',
      'net.s2stagehance.com', 'learningmanagerstage4.adobe.com',
      'account.adobe.com', 'auth.services.adobe.com', 'adobeid-na1.services.adobe.com',
      'ims-na1.adobelogin.com', 'federatedid-na1.services.adobe.com',
      'account.magento.com', 'repo.magento.com', 'magento.com',
    ],
    outOfScope: ['coldfusion.adobe.com', 'tracker.adobe.com', 'cffiddle.adobe.com'],
    rateLimitMs: 1000,
    userAgent: 'knk-suite-researcher/2.0 bug-bounty-knk_linux intigriti:{username}',
    extraHeaders: { 'X-Intigriti-Username': '{username}' },
    opplanBase: {
      nombre: 'Adobe Intigriti — caza',
      objetivo: 'Recon pasivo + revisión manual por niveles (N1 AI con impacto backend, N2 web/móvil, N3 identidad). Cuentas @intigriti.me.',
      reglas: 'Ficha > todo. UA con intigriti:{username} + header X-Intigriti-Username. Máx 20 rps (vamos a 1rps). IA-asistido permitido SOLO validado a mano. Sin DoS, sin MITM ajeno, sin divulgar.',
    },
    notas: [
      'OOS por clase: headers/cookies/CSRF-logout/open-redirect-bajo/SPF-DMARC/user-enum/bruteforce/trial-bypass/CSV/libs-sin-PoC/clickjacking/version/adivinanza-paquetes/takeover-SIN-PoC-de-control/LLM-solo-alucinación.',
      'Takeover solo con PoC de control del recurso. ColdFusion: solo con Lockdown + última versión, sin CF Admin.',
      'Móvil: solo cuentas/roles del test plan, sin root/APK-maliciosa.',
      'AI Nivel 1: exige impacto backend real (exfiltración, cross-account, escalada, bypass) — prompt-injection sin impacto = FUERA.',
      'Leer Adobe_Bug_Bounty_Test_Plans.docx antes de cada producto.',
    ],
  },
  'mercadolibre-h1': {
    id: 'mercadolibre-h1',
    nombre: 'MercadoLibre — HackerOne (bono newbie 2026)',
    programUrl: 'https://hackerone.com/mercadolibre',
    // Bono newbie 2026 al primer High/Critical. VERIFICA scope/stats en H1.
    scope: ['mercadolibre.com', '*.mercadolibre.com', 'mercadopago.com', '*.mercadopago.com'],
    outOfScope: [],
    rateLimitMs: 2000,
    userAgent: 'knk-suite-researcher/2.0 bug-bounty-knk_linux',
    opplanBase: {
      nombre: 'MercadoLibre H1 — caza sin login',
      objetivo: 'Superficie anónima: búsqueda, catálogo, APIs públicas de items, validadores de cupón/precio. Checkout con cuenta (una sola).',
      reglas: 'H1 > todo. Sin login salvo cuenta propia para checkout. Sin DoS. Ritmo manual.',
    },
    notas: [
      'NaN en validadores de cupón/precio de APIs públicas (patrón de la suite).',
      'CORS en subdominios de marketing. Recon .com/.com.ar/.com.mx.',
      'Alta competencia: prioriza lógica de negocio sobre headers.',
    ],
  },
  'dyson-h1': {
    id: 'dyson-h1',
    nombre: 'Dyson — HackerOne (61 activos, bounty 14d)',
    programUrl: 'https://hackerone.com/dyson',
    // *.cp.dyson.com con 61 activos bounty-eligible. VERIFICA en H1.
    scope: ['dyson.com', '*.dyson.com'],
    outOfScope: [],
    rateLimitMs: 2000,
    userAgent: 'knk-suite-researcher/2.0 bug-bounty-knk_linux',
    opplanBase: {
      nombre: 'Dyson H1 — caza sin login',
      objetivo: 'E-commerce público: búsqueda, catálogo, validadores de cupón, previsualizadores.',
      reglas: 'H1 > todo. Sin login salvo cuenta propia. Sin DoS.',
    },
    notas: [
      'DMARC p=none en apex (gap, requiere PoC con impacto).',
      'Recon masivo sobre wildcard + CORS en APIs de tienda + open-redirect en compra.',
    ],
  },
  'crypto-h1': {
    id: 'crypto-h1',
    nombre: 'Crypto.com — HackerOne (wildcard, Extreme hasta $1M)',
    programUrl: 'https://hackerone.com/crypto',
    // *.crypto.com elegible (104 resueltos). Foco 0-resueltos: tickets,
    // experiencias, developer*, travel. App principal exige KYC: evitar.
    scope: ['crypto.com', '*.crypto.com', 'mona.co', '*.mona.co'],
    outOfScope: [],
    rateLimitMs: 2000,
    userAgent: 'knk-suite-researcher/2.0 bug-bounty-knk_linux',
    opplanBase: {
      nombre: 'Crypto.com H1 — caza sin login',
      objetivo: 'Activos web 0-resueltos (tickets, experiencias, developer, travel, js) + price/nft ya mapeados. Sin KYC, sin cuentas ajenas.',
      reglas: 'H1 > todo. App con KYC fuera de alcance práctico. Sin DoS. GraphQL-DoS capado a $500/$200: no quemar tiempo ahí.',
    },
    notas: [
      'Joyas 0 resueltos: tickets.crypto.com, experiencias.crypto.com, developer-platform-api.crypto.com, developer.crypto.com.',
      'Price (medio) y NFT ya mapeados y cerrados sin login: no repetir.',
      'Extreme ($40k-$1M): solo pérdida masiva de fondos o PII masiva con PoC.',
      'SendGrid/Brevo takeovers ya cerrados (dangling inerte).',
    ],
  },
};

function listPresets() {
  return Object.values(PRESETS).map((p) => ({
    id: p.id, nombre: p.nombre, programUrl: p.programUrl,
    scope: p.scope, outOfScope: p.outOfScope, rateLimitMs: p.rateLimitMs,
  }));
}

// Aplica el preset a la sesión: devuelve el parche aplicado. Si había un
// OPPLAN aprobado y el scope cambia, vuelve a pendiente (hay que reaprobar).
function applyPreset(session, id, opts = {}) {
  const p = PRESETS[String(id || '')];
  if (!p) return { ok: false, error: 'preset desconocido', presets: listPresets() };
  const s = session || {};
  // Username Intigriti persistente: viene en opts, o ya guardado en la sesión.
  if (opts.username) {
    const art0 = s.artifacts || {};
    art0.intigritiUser = String(opts.username).slice(0, 64);
    s.artifacts = art0;
  }
  const intigritiUser = (s.artifacts && s.artifacts.intigritiUser) || process.env.KNK_INTIGRITI_USER || '';
  const oldScope = JSON.stringify([...(s.scope || [])].sort());
  const newScope = JSON.stringify([...p.scope].sort());
  s.scope = [...p.scope];
  s.out_of_scope = [...p.outOfScope];
  s.program_url = p.programUrl;
  s.program_name = p.nombre;
  s.rate_limit_ms = p.rateLimitMs;
  if (p.userAgent) s.user_agent = String(p.userAgent).replace(/\{username\}/gi, intigritiUser || '{username}');
  const art = s.artifacts || {};
  art.presetAplicado = p.id;
  art.presetNotas = p.notas;
  s.artifacts = art;
  let opplanReseteado = false;
  if (s.opplan && s.opplan.status === 'aprobado' && oldScope !== newScope) {
    s.opplan = { ...(s.opplanBase || {}), ...(p.opplanBase || {}), status: 'pendiente', autorizado: false, nota: 'Scope cambiado por preset: reaprobar.' };
    opplanReseteado = true;
  } else if (!s.opplan || !s.opplan.nombre) {
    s.opplan = { ...(p.opplanBase || {}), status: 'pendiente', autorizado: false };
  }
  try {
    const netMod = require('./net');
    netMod.setScope(s.scope);
    netMod.setRateLimit(s.rate_limit_ms);
    if (s.user_agent) netMod.setUA(s.user_agent);
    // Cabeceras del programa (p. ej. X-Intigriti-Username): sustituye
    // {username} por tu usuario y rellena valores vacíos desde KNK_* si existen.
    if (p.extraHeaders) {
      const filled = {};
      for (const [k, v] of Object.entries(p.extraHeaders)) {
        let val = String(v == null ? '' : v);
        if (/\{username\}/i.test(val)) val = val.replace(/\{username\}/gi, intigritiUser);
        if (!val.trim()) continue;
        filled[k] = val;
      }
      netMod.setExtraHeaders(filled);
      const art2 = s.artifacts || {};
      art2.extraHeaders = Object.keys(filled);
      s.artifacts = art2;
    } else {
      netMod.setExtraHeaders({});
    }
  } catch {}
  return { ok: true, preset: p.id, scope: s.scope, outOfScope: s.out_of_scope, opplanReseteado, notas: p.notas };
}

module.exports = { PRESETS, listPresets, applyPreset, readCompliance };
