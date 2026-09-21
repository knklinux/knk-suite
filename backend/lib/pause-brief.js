'use strict';

// ============================================================================
// pause-brief.js — "¿dónde estoy y cómo sigo?"
//
// Cuando el pipeline se detiene (FUZZ en pausa, EXPLOIT, corte del full-run)
// ya no devuelve solo un aviso: adjunta un BRIEF generado SOLO con los
// artefactos de la sesión (cero peticiones nuevas):
//
//   resumen  → qué sabe la suite hasta ahora (subs, CNAME, tech, headers…)
//   vectores → los N vectores más plausibles, rankeados, cada uno con el
//              "cómo seguir" exacto (ruta de la suite / compuerta / comando)
//   estado   → en qué fase estamos y cuál es la siguiente
// ============================================================================

// Exclusiones por programa: vectores que el Brief declara no elegibles y que
// el brief NO debe sugerir (evita cazar en balde). Claves sobre program_name.
const PROGRAM_EXCLUSIONS = {
  cloudflare: ['takeover', 'redirect', 'clickjacking', 'headers:ausentes'],
  openai: ['headers:ausentes'],
  atlassian: ['clickjacking', 'headers:ausentes'],
};

// Sufijos CNAME conocidos de servicios que permiten reclamar el host si el
// recurso origen se borró (takeover). Solo CANDIDATOS: hay que verificar que
// el destino responde NXDOMAIN/servicio huérfano antes de reportar.
// EXCLUIDOS a propósito: *.cdn.cloudflare.net, *.cloudfront.net, azureedge:
// son hostnames aleatorios asignados por el CDN (fronting activo), NO
// reclamables por terceros. Incluirlos generaba falsos HIGH (audit 17/09).
const TAKEOVER_FINGERPRINTS = [
  { sufijo: 'github.io', servicio: 'GitHub Pages' },
  { sufijo: 'herokuapp.com', servicio: 'Heroku' },
  { sufijo: 'herokussl.com', servicio: 'Heroku SSL' },
  { sufijo: 'azurewebsites.net', servicio: 'Azure Web Apps' },
  { sufijo: 'cloudapp.net', servicio: 'Azure Cloud Services' },
  { sufijo: 'trafficmanager.net', servicio: 'Azure Traffic Manager' },
  { sufijo: 's3.amazonaws.com', servicio: 'S3' },
  { sufijo: 's3-website', servicio: 'S3 Website' },
  { sufijo: 'elasticbeanstalk.com', servicio: 'Elastic Beanstalk' },
  { sufijo: 'myshopify.com', servicio: 'Shopify' },
  { sufijo: 'wordpress.com', servicio: 'WordPress.com' },
  { sufijo: 'tumblr.com', servicio: 'Tumblr' },
  { sufijo: 'vercel-dns.com', servicio: 'Vercel' },
  { sufijo: 'vercel.app', servicio: 'Vercel' },
  { sufijo: 'netlify.app', servicio: 'Netlify' },
  { sufijo: 'netlify.com', servicio: 'Netlify' },
  { sufijo: 'surge.sh', servicio: 'Surge.sh' },
  { sufijo: 'bitbucket.io', servicio: 'Bitbucket' },
  { sufijo: 'ghost.io', servicio: 'Ghost' },
  { sufijo: 'statuspage.io', servicio: 'Statuspage' },
  { sufijo: 'zendesk.com', servicio: 'Zendesk' },
  { sufijo: 'freshdesk.com', servicio: 'Freshdesk' },
  { sufijo: 'intercom', servicio: 'Intercom' },
  { sufijo: 'launchrock.com', servicio: 'LaunchRock' },
  { sufijo: 'pingdom', servicio: 'Pingdom' },
  { sufijo: 'cargocollective.com', servicio: 'Cargo' },
  { sufijo: 'kineticagroup', servicio: 'Agility CMS' },
  { sufijo: 'swoogo.com', servicio: 'Swoogo (eventos)' },
  { sufijo: 'vercel-dns-013.com', servicio: 'Vercel DNS' },
];

const PARAMS_INTERESANTES = ['id', 'file', 'path', 'url', 'redirect', 'next', 'return', 'q',
  'search', 'query', 'page', 'lang', 'cat', 'item', 'user', 'account', 'email', 'token',
  'callback', 'template', 'view', 'doc', 'folder', 'dir', 'load', 'include', 'site'];

function checkTakeover(cnameMap) {
  const candidatos = [];
  for (const [sub, cadena] of Object.entries(cnameMap || {})) {
    const eslabones = Array.isArray(cadena) ? cadena : [cadena];
    for (const destino of eslabones) {
      const d = String(destino || '').toLowerCase();
      const hit = TAKEOVER_FINGERPRINTS.find((f) => d === f.sufijo || d.endsWith('.' + f.sufijo) || d.includes(f.sufijo));
      if (hit) { candidatos.push({ sub, destino, servicio: hit.servicio }); break; }
    }
  }
  return candidatos;
}

// Extrae nombres de parámetros de query de URLs históricas y los rankea.
function minarParametros(urls) {
  const conteo = {};
  for (const u of urls || []) {
    const q = String(u || '').split('?')[1];
    if (!q) continue;
    for (const par of q.split(/[&#]/)) {
      const nombre = par.split('=')[0].trim().toLowerCase();
      if (nombre) conteo[nombre] = (conteo[nombre] || 0) + 1;
    }
  }
  return Object.entries(conteo)
    .map(([nombre, n]) => ({ nombre, n, caliente: PARAMS_INTERESANTES.includes(nombre) }))
    .sort((a, b) => ((b.caliente ? 1000 : 0) + b.n) - ((a.caliente ? 1000 : 0) + a.n))
    .slice(0, 8);
}

function faseActual(phases) {
  const orden = ['plan', 'recon', 'scan', 'fuzz', 'exploit', 'reporte', 'verificar'];
  let ultima = null;
  for (const id of orden) {
    if (phases && phases[id] && phases[id].done) ultima = id;
    else break;
  }
  const idx = ultima ? orden.indexOf(ultima) : -1;
  return { ultimaOk: ultima, siguiente: orden[idx + 1] || 'verificar', orden };
}

/**
 * Construye el brief. `session` = objeto de sesión parseado (scope,
 * out_of_scope, opplan, phases, artifacts). `findings` opcional para contexto.
 */
function buildBrief(session, findings = []) {
  const s = session || {};
  const art = s.artifacts || {};
  const subs = art.subdominios || [];
  const cname = art.cadenas_cname || {};
  const urls = art.urls_historicas || [];
  const tech = art.tech || [];
  const headers = art.headers || {};
  const estado = faseActual(s.phases || {});
  const takeovers = checkTakeover(cname);
  const params = minarParametros(urls);
  const missing = headers.missing || [];
  const corsSospechoso = !!(headers.cors && headers.cors.suspicious);

  const resumen = {
    target: s.target || '—',
    programa: s.program_name || '—',
    subdominios: subs.length,
    cadenasCname: Object.keys(cname).length,
    urlsHistoricas: urls.length,
    tecnologias: tech.slice(0, 6),
    headersAusentes: missing.slice(0, 8),
    corsSospechoso,
    hallazgosSesion: findings.length,
    opplan: (s.opplan && s.opplan.status) || 'pendiente',
  };

  const vectores = [];

  for (const t of takeovers.slice(0, 5)) {
    vectores.push({
      id: `takeover:${t.sub}`,
      titulo: `Posible takeover: ${t.sub} → ${t.servicio}`,
      severidadPotencial: 'high',
      porQue: `CNAME a servicio reclamable (${t.destino}). Verificar NXDOMAIN/huérfano antes de reportar.`,
      comoSeguir: [
        'nslookup del CNAME + visita el host: ¿página de servicio por defecto?',
        'Si es reclamable con tu cuenta y está sin uso → compuerta sub + reporte',
        'Si el CNAME apunta a tercero ACTIVO (ej. community, helpdesk vivo) → fuera de scope',
      ],
      herramienta: { ruta: 'POST /api/gates/validate { clase: "sub" }', alternativa: 'dig/nslookup manual' },
      score: 90,
    });
  }

  if (params.length) {
    const calientes = params.filter((p) => p.caliente).map((p) => p.nombre);
    vectores.push({
      id: 'params:wayback',
      titulo: `Parámetros históricos atacables (${params.length} distintos${calientes.length ? `: ${calientes.slice(0, 5).join(', ')}` : ''})`,
      severidadPotencial: 'medium',
      porQue: `${urls.length} URLs de archivo con querystring. Los params ${calientes.slice(0, 4).join(', ') || 'detectados'} son clásicos de IDOR/LFI/redirect.`,
      comoSeguir: [
        'Elige 1 URL con params y ábrela en Repeater (edítala a mano)',
        'Prueba IDOR (cambia id), path traversal (file/path), open redirect (url/redirect/next)',
        'Si un param refleja → compuerta xss; si 302 a destino ajeno → open redirect',
      ],
      herramienta: { ruta: 'POST /api/repeater/send { raw }', topParams: params },
      score: 75,
    });
  }

  const cms = (tech || []).find((t) => /wordpress|drupal|joomla|shopify|laravel|django|next|strapi/i.test(String(t)));
  if (cms) {
    vectores.push({
      id: 'tech:stack',
      titulo: `Stack detectado: ${cms}`,
      severidadPotencial: 'medium',
      porQue: 'CMS/framework conocido → superficie de CVEs y endpoints típicos (admin, api, graphql).',
      comoSeguir: [
        'Mapea JS bundles: POST /api/surface/map (busca endpoints y secretos en bundles)',
        'Fuzz dirigido max 15 rutas tras confirmación manual',
        'Cruza versión con NVD solo si la versión es visible (no adivinar)',
      ],
      herramienta: { ruta: 'POST /api/surface/map { url }' },
      score: 60,
    });
  }

  if (corsSospechoso) {
    vectores.push({
      id: 'cors:sospechoso',
      titulo: 'CORS sospechoso en SCAN',
      severidadPotencial: 'medium',
      porQue: 'El probe automático marcó Access-Control-Allow-Origin/Allow-Credentials anómalo.',
      comoSeguir: ['Valida con compuerta cors (origen propio vs evil)', 'Sin lectura cross-origin con credenciales → no reportable'],
      herramienta: { ruta: 'POST /api/gates/validate { clase: "cors", url }' },
      score: 65,
    });
  }

  if (missing.length) {
    vectores.push({
      id: 'headers:ausentes',
      titulo: `${missing.length} headers ausentes (${missing.slice(0, 4).join(', ')})`,
      severidadPotencial: 'info',
      porQue: 'Endurecimiento, no vulnerabilidad. Solo sirve como apoyo (clickjacking necesita PoC).',
      comoSeguir: ['No reportar solo. Si falta X-Frame-Options → PoC de clickjacking con acción real'],
      herramienta: { ruta: '— (apoyo)' },
      score: 15,
    });
  }

  vectores.push({
    id: 'manual:repeater-intruder',
    titulo: 'Vía manual: Repeater → Intruder (caza real)',
    severidadPotencial: 'variable',
    porQue: 'El pipeline automático ya exprimió lo pasivo. Lo que paga se valida a mano.',
    comoSeguir: [
      'Copia una petición interesante al Repeater y reprodúcela (maxRedirects 0 para ver 30x)',
      'Marca posiciones §…§ y lanza Intruder con TUS payloads (máx 100 req/run)',
      'Anomalía (status/longitud) → POST /api/intruder/finding/:runId/:index → hallazgo con evidencia',
      'Consulta la guía: GET /api/hub/guide/:clase (idor, ssrf, xss, takeover…)',
    ],
    herramienta: { ruta: 'POST /api/repeater/send · POST /api/intruder/start' },
    score: 50,
  });

  // Exclusiones del programa: fuera los vectores no elegibles del Brief.
  const progKey = Object.keys(PROGRAM_EXCLUSIONS).find((k) =>
    String(s.program_name || '').toLowerCase().includes(k));
  const excl = progKey ? PROGRAM_EXCLUSIONS[progKey] : [];
  const vectoresVisibles = vectores.filter((v) =>
    !excl.some((x) => v.id === x || v.id.startsWith(x + ':')));
  vectoresVisibles.sort((a, b) => b.score - a.score);

  return {
    generadoEn: new Date().toISOString(),
    estado: { ...estado, opplan: resumen.opplan },
    programa: s.program_name || null,
    exclusionesAplicadas: excl,
    resumen,
    vectores: vectoresVisibles,
    siguienteAccion: vectoresVisibles.length
      ? `Empieza por "${vectoresVisibles[0].titulo}": ${vectoresVisibles[0].comoSeguir[0]}`
      : 'Sin artefactos aún: ejecuta PLAN → RECON → SCAN primero.',
  };
}

module.exports = { buildBrief, checkTakeover, minarParametros, faseActual, TAKEOVER_FINGERPRINTS };
