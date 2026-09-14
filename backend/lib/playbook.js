'use strict';

// ============================================================================
// KNK SUITE v2.1 — Playbook de explotación manual
// Genera pasos ordenados para el cazador tras completar el pipeline.
// Metodología basada en workflow reales de 2026 (recon multi-fuente → URL
// collection → hunting → business logic/API → secrets → evidencia).
// La suite guía; la explotación la ejecuta el operador, siempre en scope.
// ============================================================================

const bizlogic = require('./bizlogic');

/**
 * Checks específicos según el stack tecnológico detectado en recon.
 */
function techChecks(tech) {
  const t = (tech || []).map(x => x.toLowerCase()).join(' ');
  const checks = [];
  if (/wordpress/i.test(t)) checks.push(
    'WordPress: probar /wp-json/wp/v2/users, /wp-json/wp/v2/users?roles=administrator (enumeración)',
    'WordPress: /wp-content/plugins/<plugin>/readme.txt (versiones → CVE)',
    'WordPress: /xmlrpc.php (system.multicall para fuerza bruta lenta)',
    'WordPress: wp-json media con IDs secuenciales (IDOR en medios privados)'
  );
  if (/laravel/i.test(t)) checks.push(
    'Laravel: probar /.env expuesto (APP_KEY, DB creds)',
    'Laravel: /_ignition/health-check y /_ignition/execute-solution (CVE-2021-3129, debug mode)',
    'Laravel: rutas /api/* sin auth → IDOR'
  );
  if (/spring|java/i.test(t)) checks.push(
    'Spring Boot: probar /actuator, /actuator/health, /actuator/env, /actuator/heapdump',
    'Spring: buscar @PreAuthorize en controllers vs SecurityConfig (cobertura incompleta)',
    'Spring: path bypass con /;/admin/... (request.getRequestURI vs getServletPath)'
  );
  if (/asp\.net/i.test(t)) checks.push(
    'ASP.NET: probar /trace.axd, /elmah.axd, /web.config, /appsettings.json',
    'ASP.NET: ViewState con machineKey débil (si firma en source)'
  );
  if (/next\.js|react/i.test(t)) checks.push(
    'Next.js/React: descargar JS bundle y extraer endpoints/API keys (grep api|token|key|secret)',
    'Next.js: probar /_next/data/<build>/... (SSG data leaks) y rutas /api/*'
  );
  if (/php/i.test(t)) checks.push(
    'PHP: probar /phpinfo.php, /info.php, /test.php',
    'PHP: session fixation/IDOR en PHPSESSID; uploads en /uploads/ con nombres predecibles'
  );
  if (/cloudflare/i.test(t)) checks.push(
    'Cloudflare: buscar IP real del origen (históricas en SecurityTrails, subdominios sin proxy, mail records)',
    'Cloudflare: probar bypass con X-Forwarded-For / rango de IPs del CDN'
  );
  return checks;
}

/**
 * Genera el playbook completo a partir de los artefactos del pipeline.
 * @param {{target:string, scope:string[], subdomains:string[], urls:string[], tech:string[], headers:object, cors:object, includeCameras?:boolean}} artifacts
 */
function generatePlaybook(artifacts = {}) {
  const target = artifacts.target || '';
  const scope = artifacts.scope || [];
  const subs = artifacts.subdomains || [];
  const urls = artifacts.urls || [];
  const tech = artifacts.tech || [];
  const headers = artifacts.headers || {};
  const cors = artifacts.cors || {};

  const phases = [];

  // ── FASE 0: Restricciones y límites del programa (si las hay) ──────────
  const restrictions = artifacts.restrictions || [];
  if (restrictions.length) {
    phases.push({
      id: 'restrictions',
      name: 'Restricciones del programa (NO VIOLAR)',
      steps: restrictions.map(r => `⛔ ${r}`),
    });
  }

  // ── FASE 1: Consolidación de superficie ────────────────────────────────
  phases.push({
    id: 'surface',
    name: 'Consolidar superficie de ataque',
    steps: [
      `Target: ${target} | Scope: ${scope.join(', ') || '(vacío — revisar)'}`,
      subs.length ? `Subdominios encontrados (${subs.length}): priorizar los NO vistos en recon (subdominios olvidados = más bugs). Tomar nota de: ${subs.slice(0, 8).join(', ')}${subs.length > 8 ? '...' : ''}` : 'Ejecutar RECON de nuevo: la superficie es la clave (80% del éxito).',
      urls.length ? `URLs históricas (${urls.length}): revisar las que tengan parámetros, /api/, /admin/, /internal, /graphql` : 'Recolectar URLs (gau/waybackurls/katana) antes de seguir.',
      'Buscar hosts "aburridos" que nadie mira: /health, /metrics, /console, /phpinfo.php',
      'Probar headers de confianza en TODOS los hosts: X-Forwarded-Host, X-Original-URL: /admin, X-Forwarded-For: 127.0.0.1',
    ],
  });

  // ── FASE 1b: Apps móviles en scope ────────────────────────────────────
  const mobile = artifacts.mobileApps || [];
  if (mobile.length) {
    phases.push({
      id: 'mobile',
      name: 'Apps móviles en scope',
      steps: [
        `Apps: ${mobile.map(a => `${a.name || a.id || a.bundle} (${a.platform})`).join(', ')}`,
        'Descargar APK (Android) / IPA (iOS) y descomprimir: extraer endpoints de API, claves hardcodeadas, deep links y certificados',
        'Analizar el tráfico de la app (Burp + certificado) para mapear la API del backend',
        'La API del backend suele apuntar a los dominios en scope (*.platacard.mx / *.bancoplata.mx): probar auth, IDOR y lógica en esos endpoints',
        'Buscar: firebase config, API keys, tokens OAuth, endpoints ocultos (/internal, /admin), versiones antiguas de la API',
      ],
    });
  }

  // ── FASE 2: Hunting según tech stack ───────────────────────────────────
  const techSteps = techChecks(tech);
  phases.push({
    id: 'hunt',
    name: 'Hunting técnico (según stack detectado)',
    steps: techSteps.length ? techSteps : [
      'Stack no identificado: descargar la página principal y revisar headers Server/X-Powered-By + fuentes (JS)',
      'Recolectar parámetros de TODAS las URLs (grep "=" → cut) y probar reflejo en cada uno',
      'Probar parámetros con valores límite: id=123&id=456 (pollution), valores negativos, arrays (campo[0]=x&campo[0]=y)',
    ],
  });

  // ── FASE 3: Lógica de negocio y API ────────────────────────────────────
  const bizPlan = artifacts.bizlogicPlan || bizlogic.planTests({ target, scope });
  phases.push({
    id: 'bizlogic',
    name: 'Lógica de negocio y API (donde está el dinero)',
    steps: [
      'Prioridad: categorías de 1 cuenta primero (precio, race, workflow, tiers) — no necesitas 2 cuentas para empezar.',
      'JWT: si hay token, probar jwt_tool con alg=none y claims (role/admin:true). Probar firma débil.',
      'GraphQL: probar /graphql con introspection ({__schema{queryType{name}}}). Si responde, mapear queries/mutations y probar auth en cada una.',
      'UUID: si usan UUIDv1, generar secuenciales (uuidgen -t) y probar acceso a IDs vecinos.',
      'Errores: NUNCA ignorar mensajes de error (SQL, stack traces, "Access denied for user root").',
      ...bizPlan.categories.slice(0, 4).map(c => `[${c.name}] (${c.accounts === 'two' ? '2 cuentas' : '1 cuenta'}): ${c.tests[0].title} — ${c.tests[0].steps.join(' → ')}`),
    ],
  });

  // ── FASE 4: Secretos y datos sensibles ─────────────────────────────────
  phases.push({
    id: 'secrets',
    name: 'Secretos y datos sensibles',
    steps: [
      'JS: grep de (api|key|token|secret|password)= en TODOS los .js del target',
      'Probar /.git/config y /.env en todos los hosts (exposición = critical instantáneo)',
      'Probar rutas de backup: /backup.zip, /db.sql, /www.zip, /app.tar.gz',
      'S3/buckets: buscar subdominios tipo s3.*, y buckets con nombres del dominio (listar sin auth)',
    ],
  });

  // ── FASE 5: Cámaras (si aplica) ────────────────────────────────────────
  if (artifacts.includeCameras) {
    phases.push({
      id: 'cameras',
      name: 'Cámaras IP (solo in-scope)',
      steps: [
        'Probar panel web en 80/443/8080/8443 y rutas /snapshot.cgi, /image.jpg, /stream.jpg',
        'Probar RTSP: puertos 554/8554, rutas /live, /stream1, /h264, /onvif1 (solo hosts en scope)',
        'ONVIF: POST /onvif/device_service con GetDeviceInformation en 8000/8899',
        'Credenciales por defecto SOLO si la política del programa lo permite explícitamente',
      ],
    });
  }

  // ── FASE 6: Evidencia y reporte ────────────────────────────────────────
  const headerHints = headers ? (headers.missing || []).length : 0;
  phases.push({
    id: 'evidence',
    name: 'Evidencia y reporte',
    steps: [
      cors && cors.suspicious ? `CORS sospechoso detectado (${cors.acao} + credenciales): validar con compuerta cors y capturar lectura cross-origin REAL` : 'CORS: sin hallazgo en el scan — validar manualmente en endpoints con datos privados.',
      headerHints ? `Headers ausentes (${headerHints}): revisar si alguno implica impacto real (CSP ausente + XSS, HSTS ausente en login)` : 'Headers OK en el scan.',
      'Por cada candidato: reproducir ≥2 veces, capturar screenshot del exploit + impacto + curl copiable',
      'Pasar el candidato por la compuerta adecuada (bizlogic, cors, idor, ssrf, xss) ANTES de generar el reporte',
      'Buscar duplicados en Hacktivity del programa antes de enviar',
      'Generar reporte con la fase REPORTE (verificador triager incluido) y exportar a HTML para el envío',
    ],
  });

  return {
    target,
    generatedAt: new Date().toISOString(),
    phases,
    summary: {
      tech: tech.join(', ') || 'desconocido',
      subdomains: subs.length,
      urls: urls.length,
      focus: bizPlan.categories.find(c => c.accounts === 'one')?.name || 'precio/valor',
    },
  };
}

function renderPlaybook(playbook) {
  const lines = [`# 🎯 Playbook de explotación manual — ${playbook.target}`, ''];
  lines.push(`> Stack: ${playbook.summary.tech} | Subs: ${playbook.summary.subdomains} | URLs: ${playbook.summary.urls}`, '');
  for (const phase of playbook.phases) {
    lines.push(`## ${phase.id.toUpperCase()} — ${phase.name}`, '');
    phase.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = { generatePlaybook, renderPlaybook, techChecks };
