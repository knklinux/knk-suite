'use strict';

// ============================================================================
// bb-hub.js — "Burp de bolsillo" de la suite: guía de caza por clase de bug +
// decodificador. Todo manual y dentro del scope: la guía dice QUÉ probar y
// CON QUÉ ruta de la suite; la ejecución la hace el investigador.
// ============================================================================

const GUIDE = {
  idor: {
    titulo: 'IDOR / Control de acceso',
    checklist: [
      'Mapea endpoints con :id, :uuid, :account (surface/map + wayback con params)',
      'Crea DOS recursos con tu cuenta A; accede al de A2 con sesión de B',
      'Compara byte a byte: 200 con datos ajenos = vulnerable; 403/404 = ok',
      'Prueba IDs secuenciales, UUID versionados, cambio de método (GET→POST)',
    ],
    herramienta: { ruta: 'POST /api/repeater/send', ejemplo: 'raw con Cookie de B apuntando al recurso de A' },
    evidencia: ['request/response A vs B', 'screenshot del dato ajeno (tapa PII)', 'curl mínimo reproducible'],
    fueraDeScope: ['Datos propios de tu cuenta', 'IDs que solo listan catálogo público'],
  },
  ssrf: {
    titulo: 'SSRF / Redirecciones servidor',
    checklist: [
      'Localiza params url/file/fetch/webhook/avatar-import (wayback + JS bundles)',
      'Apunta primero a tu canario propio (Burp Collaborator / interactsh), nunca a 169.254.169.254 ajeno',
      'Confirma DNS+HTTP en tu canario; luego prueba esquemas (http, gopher solo si hay eco)',
      'Documenta qué dato interno sale (no lo extraigas entero: mínimo acceso)',
    ],
    herramienta: { ruta: 'POST /api/gates/validate { clase: "ssrf" }', ejemplo: 'url=http://TU-canario/ping' },
    evidencia: ['log del canario con hora', 'request/response', 'impacto acotado'],
    fueraDeScope: ['Metadata cloud de terceros', 'DoS del parser', 'OAST simulado: no vale como prueba'],
  },
  xss: {
    titulo: 'XSS (reflejado/almacenado/DOM)',
    checklist: [
      'Reflejo en Repeater con canario inocuo (\"knk-<n>\"); mira contexto (html/atributo/js)',
      'Almacenado: usa cuenta propia, verifica en segunda sesión limpia',
      'DOM: rastrea sources/sinks en bundles (surface/map) antes de payloads',
      'Sin robo de sesión ajena: alerta propia o Collaborator basta',
    ],
    herramienta: { ruta: 'POST /api/gates/validate { clase: "xss" }', ejemplo: 'param=<script>alert(document.domain)</script> solo en tu sesión' },
    evidencia: ['screenshot del alert/ejecución en TU sesión', 'request/response', 'pasos de repro'],
    fueraDeScope: ['Self-XSS sin escalado', 'XSS en sandbox sin cookies/sesión'],
  },
  takeover: {
    titulo: 'Subdomain takeover',
    checklist: [
      'GET /api/osint/takeover: CNAMEs a servicios reclamables de TU scope',
      'Verifica huérfano: NXDOMAIN / página por defecto del servicio / fingerprint',
      'Reclama SOLO con tu cuenta y SOLO si está sin uso; captura la prueba',
      'Tercero activo (helpdesk, community viva) → NO tocar, fuera de scope',
    ],
    herramienta: { ruta: 'GET /api/osint/takeover', ejemplo: 'usa cadenas_cname del RECON' },
    evidencia: ['dig/CNAME', 'screenshot página por defecto', 'reclamo de prueba revertido'],
    fueraDeScope: ['CNAME a Stripe/servicios de pago', 'subdominios en uso'],
  },
  cors: {
    titulo: 'CORS mal configurado',
    checklist: [
      'Repeater con Origin: https://evil.example — ¿refleja + Allow-Credentials: true?',
      'Prueba null origin y subdominio propio; exige lectura real con credenciales',
      'Sin dato sensible legible cross-origin → no reportable',
    ],
    herramienta: { ruta: 'POST /api/gates/validate { clase: "cors" }', ejemplo: 'header Origin evil + Cookie propia' },
    evidencia: ['response con ACAO evil + dato sensible', 'PoC fetch mínimo'],
    fueraDeScope: ['Reflejo de Origin sin credenciales ni datos'],
  },
  auth: {
    titulo: 'Autenticación / sesión',
    checklist: [
      'Rate-limit de login con cuenta propia (espaciado, sin credential stuffing)',
      'Fijación de sesión, logout real, expiración, 2FA bypass solo en tu cuenta',
      'OAuth: redirect_uri abierto SOLO si roba code/token a víctima (PoC propia)',
      'Nunca pruebes con credenciales ajenas ni bloquees cuentas de otros',
    ],
    herramienta: { ruta: 'POST /api/repeater/send', ejemplo: 'secuencia login → uso → logout con tus 2 cuentas' },
    evidencia: ['secuencia completa', 'video/gif del bypass en tu cuenta'],
    fueraDeScope: ['Fuerza bruta agresiva', 'Bypass de CAPTCHA de bajo impacto', 'Enumeración masiva de usuarios'],
  },
  race: {
    titulo: 'Race condition / lógica TOCTOU',
    checklist: [
      'Operaciones single-use con tus recursos: cupones, checkout, revoke, claim',
      'Ronda acotada con la compuerta biz/race (máx 3 petis, espaciadas)',
      'Compara estado final server-side (no el eco del cliente)',
    ],
    herramienta: { ruta: 'POST /api/biz/race { url, metodo, cuerpo, n, manualConfirm:true }', ejemplo: 'redeem de cupón propio x2 en ventana' },
    evidencia: ['estado inicial/final', 'logs de las N peticiones'],
    fueraDeScope: ['Races contra 127.0.0.1/localhost', 'doble-click de UI sin impacto server'],
  },
  redirect: {
    titulo: 'Open redirect',
    checklist: [
      'Params next/return/url/redirect: prueba //evil.example y https:evil.example',
      'Exige salida REAL del dominio con un click (no solo reflejo en JS)',
      'Cadena a OAuth/login = impacto mayor; documenta el flujo',
    ],
    herramienta: { ruta: 'POST /api/repeater/send { maxRedirects: 0 }', ejemplo: 'inspecciona el 30x sin seguirlo' },
    evidencia: ['response 30x con Location externa', 'screenshot del flujo'],
    fueraDeScope: ['Redirect dentro del mismo dominio', 'Reflejo sin navegación'],
  },
  sqli: {
    titulo: 'SQLi / Inyección',
    checklist: [
      'Params numéricos y búsquedas: prueba comilla simple + sleep solo en tu dato',
      'Error SQL visible → valida con 2 payloads distintos (no escaneos ciegos largos)',
      'Time-based con delays cortos (≤5s) y pocas muestras; nunca extraigas tablas',
    ],
    herramienta: { ruta: 'POST /api/repeater/send', ejemplo: "id=1' AND '1'='1 vs id=1' AND '1'='2" },
    evidencia: ['diff de respuestas', 'query probada mínima'],
    fueraDeScope: ['sqlmap agresivo', 'extracción de datos'],
  },
  info: {
    titulo: 'Exposición de información',
    checklist: [
      'security.txt, robots, sitemap, .git/HEAD, .env, backups (una petición por candidato)',
      'JS bundles: secretos, endpoints internos, feature flags (surface/map)',
      'Cabeceras que filtran versión + endpoint que la confirma',
    ],
    herramienta: { ruta: 'GET /api/osint/securitytxt · POST /api/surface/map', ejemplo: '/.well-known/security.txt' },
    evidencia: ['contenido expuesto (tapa secretos reales al reportar)', 'URL exacta'],
    fueraDeScope: ['Headers ausentes solos', 'Versiones sin PoC', 'Emails públicos'],
  },
  'idor-chat': {
    titulo: 'IDOR en historial de chat (LLM02)',
    checklist: [
      'Localiza conversation_id/IDs secuenciales en tus llamadas (Burp/Repeater)',
      'Con tu SEGUNDA cuenta (o sin sesión) pide el recurso de la primera: ±5 IDs como máximo, a ritmo humano',
      'Compara: 200 con historial ajeno = hallazgo; 403/404 = correcto',
      'Nunca enumeres en masa ni accedas a datos de terceros reales',
    ],
    herramienta: { ruta: 'POST /api/ai-kit/run { modulo: "conversation-idor" }', ejemplo: 'ids: tus 3 últimos + adyacentes, sesiones A y B Tuyas' },
    evidencia: ['request/response A vs B/anon', 'IDs probados (pocos)', 'captura del dato ajeno tapando PII'],
    fueraDeScope: ['Enumeración masiva de IDs', 'Leer datos reales de terceros'],
  },
  'file-idor': {
    titulo: 'IDOR en ficheros (LLM02)',
    checklist: [
      'Inventario: download, content_url, thumbnails, library/shared, materialize, claim — todos con {id}',
      'A sube sintético; B pide el file_id/libfile de A; anónimo también',
      '200 con bytes ajenos = hallazgo (como el E13); 403/404 = correcto',
      'Ojo a grants/warm y enlaces compartidos: revalidan permisos o confían',
    ],
    herramienta: { ruta: 'POST /api/ai-kit/run { modulo: "idor-sweep" }', ejemplo: 'urlTemplate con {id}, headersA/B de tus 2 cuentas' },
    evidencia: ['bytes descargados como B/anon vs 404', 'owner_id del recurso', 'curl mínimo'],
    fueraDeScope: ['Fuerza bruta de file_ids', 'Datos reales de terceros'],
  },
  'workspace-idor': {
    titulo: 'IDOR en workspaces/equipos (BAC)',
    checklist: [
      'Invita a B con el rol más bajo; mapea endpoints con {account_id}/{user_id}/{group_id}',
      'B repite acciones de admin: users, groups, invites, settings, sso, policy',
      'Misconfiguración típica: 200 en lectura + 403 solo en escritura (o al revés)',
      'Documenta matriz rol × endpoint: es lo que el triager quiere ver',
    ],
    herramienta: { ruta: 'POST /api/repeater/send (manual, 2 roles)', ejemplo: 'misma petición, Cookie de admin vs miembro' },
    evidencia: ['matriz rol×endpoint', 'request/response comparadas', 'screenshot del panel'],
    fueraDeScope: ['Elevar tu rol por medios no documentados', 'Tocar workspaces ajenos'],
  },
  'share-idor': {
    titulo: 'Enlaces compartidos (LLM02)',
    checklist: [
      'Crea shares desde A (conversación, fichero, gizmo, proyecto); anota sus IDs/URLs',
      'Pide cada uno como B y como anónimo; revoca y vuelve a pedir (¿muere de verdad?)',
      'IDs adivinables/secuenciales + contenido ajeno = hallazgo serio',
      'Nunca enumeres el espacio de IDs: solo los tuyos ±5 como máximo',
    ],
    herramienta: { ruta: 'POST /api/ai-kit/run { modulo: "idor-sweep" }', ejemplo: 'tus share IDs + adyacentes' },
    evidencia: ['share creado por A, leído por B/anon', 'revocación verificada o no'],
    fueraDeScope: ['Enumeración del espacio de shares', 'Abrir shares de terceros'],
  },
  'oauth-redirect': {
    titulo: 'OAuth redirect_uri (clásico)',
    checklist: [
      'Localiza el authorize: client_id, redirect_uri, response_type, scope, state',
      'Prueba redirect_uri a tu dominio, subdominio abierto, path traversal, doble-encode',
      'Exige robo REAL de code/token: 302 a tu dominio con el code pegado',
      'Revisa fugas en Referer, logs y fragmentos (#) vs query (?)',
    ],
    herramienta: { ruta: 'POST /api/repeater/send { maxRedirects: 0 }', ejemplo: 'inspecciona el 30x sin seguirlo' },
    evidencia: ['response 30x con Location a tu dominio + code', 'flujo completo reproducible'],
    fueraDeScope: ['Redirect mismo-dominio', 'Phishing a terceros'],
  },
  'indirect-injection': {
    titulo: 'Inyección indirecta + exfil (LLM01, Safety BB)',
    checklist: [
      'Genera el kit OFFLINE con TU canario (nada sale de tu máquina)',
      'Planta UNA variante en TU contenido (doc, web tuya, ticket tuyo)',
      'Induce al asistente a procesarlo; mira hits en TU canario (≥50% para Safety BB)',
      'Sin impacto en terceros: si exfiltra, solo tus datos sintéticos',
    ],
    herramienta: { ruta: 'POST /api/ai-kit/run { modulo: "kit-indirecto" }', ejemplo: 'canary: tu-dominio-collaborator' },
    evidencia: ['contenido plantado (tuyo)', 'hits en tu canario con hora', 'tasa de reproducibilidad N/M'],
    fueraDeScope: ['Plantar en contenido de terceros', 'Exfiltrar datos reales'],
  },
  'rag-cross-tenant': {
    titulo: 'RAG cross-tenant (LLM08)',
    checklist: [
      'Genera doc con marca única; súbelo a TU workspace A',
      'Pregunta desde TU workspace B/sesión B por la marca y por metadatos ajenos',
      'Cita de la marca desde B = cross-tenant (HIGH); metadatos (títulos/autores ajenos) = fuga',
      'Nunca con documentos reales de nadie',
    ],
    herramienta: { ruta: 'POST /api/ai-kit/run { modulo: "watermark" }', ejemplo: 'marca auto + consultas guía' },
    evidencia: ['doc con marca (tuyo)', 'respuesta de B citándola', 'capturas'],
    fueraDeScope: ['Documentos de terceros', 'Envenenar índices compartidos reales'],
  },
  'api-role-injection': {
    titulo: 'Role injection y params API (lógica)',
    checklist: [
      'Intercepta la llamada real del chat (Burp/proxy); clónala en Repeater',
      'Inyecta tu system, cambia model/temperature/max_tokens uno a uno',
      'Compara contra baseline: status, longitud, coste (usage.tokens)',
      'Modelo superior al de tu plan o system aceptado = hallazgo de negocio',
    ],
    herramienta: { ruta: 'POST /api/ai-kit/run { modulo: "api-probes" }', ejemplo: 'endpoint + tus headers + baseBody real' },
    evidencia: ['baseline vs mutado (diff)', 'usage/coste si aplica', 'curl mínimo'],
    fueraDeScope: ['DoS/coste agresivo', 'Claves ajenas'],
  },
  'copilot-llm01': {
    titulo: '[Copilot] Prompt injection directa e indirecta (LLM01)',
    checklist: [
      'Directa: detectores clásicos en el chat (eco, system-echo); documenta si cede',
      'Indirecta: sube un DOC tuyo con instrucción oculta y pide resumen; pega una URL tuya con span oculto y pide resumirla',
      'El salto a reportable: que la inyección LEA algo (archivos, correos, web) o EJECUTE algo (plugins, conectores)',
      'Sin exfil ni acción = model issue, no bounty. Con exfil a tu canario = HIGH',
    ],
    herramienta: { ruta: 'POST /api/ai-kit/run { modulo: "kit-indirecto" }', ejemplo: 'canary: tu Collaborator; luego Repeater con tus 2 cuentas' },
    evidencia: ['payload plantado (tuyo)', 'respuesta que obedece', 'hit en tu canario con hora (si exfiltra)'],
    fueraDeScope: ['Jailbreak sin impacto', 'Datos reales de terceros'],
  },
  'copilot-llm02': {
    titulo: '[Copilot] Fuga entre sesiones/usuarios (LLM02)',
    checklist: [
      'Conversación A con dato ficticio marcado; pregunta en B (otra sesión/tipo de acceso) por él',
      'Revisa historial compartido, archivos citados, memorias y conectores que listan contenido ajeno',
      'PII/financiero ajeno = CRITICAL; metadatos (títulos de otros) = fuga a valorar',
      'Nunca con datos reales de nadie: marcas sintéticas',
    ],
    herramienta: { ruta: 'POST /api/ai-kit/run { modulo: "idor-sweep" }', ejemplo: 'conversation/file IDs tuyos ±5, sesiones A y B' },
    evidencia: ['dato marcado en A, citado en B (capturas)', 'IDs y timestamps'],
    fueraDeScope: ['Datos reales de terceros', 'Enumeración masiva'],
  },
  'copilot-llm05': {
    titulo: '[Copilot] XSS vía salida del modelo (LLM05)',
    checklist: [
      'Averigua si el chat renderiza markdown/HTML (prueba inerte: **negrita**, [x](https://example.com))',
      'Si renderiza: pide al modelo que empiece con <img src=x onerror=...> (primero en TU sesión)',
      'Escalado real: inyección indirecta (doc tuyo) que hace que la respuesta ataque a quien la ve',
      'Self-XSS solo = N/A; ejecútalo hacia 2ª sesión tuya para probar alcance',
    ],
    herramienta: { ruta: 'POST /api/ai-kit/run { modulo: "analizar" }', ejemplo: 'pega la respuesta y mira contextos' },
    evidencia: ['render con payload inerte', '2ª sesión afectada (tuya)', 'CSP que lo permite/bloquea'],
    fueraDeScope: ['Self-XSS aislado', 'Roba-sesiones reales'],
  },
  'copilot-llm06': {
    titulo: '[Copilot] Agencia excesiva (LLM06)',
    checklist: [
      'Inventario: pregunta qué herramientas tiene y con qué permisos (plugins, conectores, archivos, correo)',
      'Pide acciones fuera de su rol: admin, borrados, envíos, pagos, cambios de config',
      'Busca acciones irreversibles SIN confirmación humana: ese es el bug caro',
      'Cadena letal: contenido envenenado tuyo que dispara una herramienta sin que lo pidas',
    ],
    herramienta: { ruta: 'Repeater manual + guía', ejemplo: 'misma petición, rol normal vs admin' },
    evidencia: ['acción ejecutada sin confirmación (tuya)', 'permisos declarados vs efectivos', 'vídeo del flujo'],
    fueraDeScope: ['Acciones sobre datos ajenos', 'DoS vía herramientas'],
  },
  'copilot-llm07': {
    titulo: '[Copilot] System prompt (LLM07)',
    checklist: [
      'Las 4 clásicas: repetición, JSON, marco/canción, incremental de 10 en 10',
      'Si sale: busca DENTRO secretos (keys), endpoints internos, herramientas ocultas, reglas saltables',
      'Personalidad sin secretos = INFO, no reportable en MSRC como tal',
      'Reporta por el SECRETO (LLM02), no por la fuga',
    ],
    herramienta: { ruta: 'POST /api/ai-kit/run { modulo: "api-probes" }', ejemplo: 'sondas ext.* una a una, con tu sesión' },
    evidencia: ['prompt extraído (tapa secretos al reportar)', 'secreto concreto y dónde se usa'],
    fueraDeScope: ['Fuga sin secretos', 'Publicar prompts internos'],
  },
  'copilot-llm08': {
    titulo: '[Copilot] RAG cross-tenant (LLM08)',
    checklist: [
      'Sube doc con marca única a TU espacio; pregunta por ella desde OTRO contexto tuyo (otro chat/cuenta/espacio)',
      'Pide metadatos: títulos, autores, propietarios del índice',
      'Cita cross-contexto = HIGH; metadatos ajenos = fuga a valorar',
      'Jamás documentos reales de nadie',
    ],
    herramienta: { ruta: 'POST /api/ai-kit/run { modulo: "watermark" }', ejemplo: 'marca auto + consultas' },
    evidencia: ['doc marcado (tuyo)', 'cita desde el otro contexto', 'capturas'],
    fueraDeScope: ['Envenenar índices compartidos reales', 'Datos de terceros'],
  },
  'copilot-llm03': {
    titulo: '[Copilot] Plugins/MCP terceros (LLM03)',
    checklist: [
      'Lista plugins/conectores instalables; revisa permisos que piden vs los que necesitan',
      'Rug-pull: compara manifiesto actual vs el que aprobaste (versión, permisos nuevos, dominios)',
      'Prueba si un conector puede leer/escribir fuera de su ámbito declarado',
      'SIEMPRE con tus propios conectores de prueba',
    ],
    herramienta: { ruta: 'Repeater manual', ejemplo: 'llamadas del conector con tu sesión' },
    evidencia: ['permisos declarados vs efectivos', 'diff de manifiesto', 'lectura fuera de ámbito'],
    fueraDeScope: ['Atacar al proveedor del plugin', 'Datos de otros usuarios del plugin'],
  },
  'copilot-llm10': {
    titulo: '[Copilot] Coste/consumo (LLM10)',
    checklist: [
      'Lee usage/tokens en respuestas: ¿el modelo/parámetros son configurables por ti?',
      '2-3 pruebas de vector (entrada larga, max_tokens alto), NUNCA campaña',
      'Si multiplicas coste con tu plan básico = bug de negocio (no DoS)',
      'Documenta coste calculado, no ejecutes volumen',
    ],
    herramienta: { ruta: 'POST /api/ai-kit/run { modulo: "api-probes" }', ejemplo: 'params: max_tokens/temperature fuera de rango' },
    evidencia: ['usage antes/después', 'cálculo de coste', '2-3 peticiones como máximo'],
    fueraDeScope: ['DoS y volumen', 'Quemar cuota ajena'],
  },
  'copilot-api': {
    titulo: '[Copilot] API abuse y control de acceso',
    checklist: [
      'Mapea endpoints del dashboard/app (Burp history) con tu sesión',
      'Prueba IDOR cross-usuario, verb-tampering, 401 vs 404 diferenciales',
      'Tokens: alcance real vs declarado, expiración, revocación al logout',
      'Todo con tus 2 cuentas/sesiones como máximo',
    ],
    herramienta: { ruta: 'POST /api/ai-kit/run { modulo: "idor-sweep" }', ejemplo: 'IDs tuyos ±5' },
    evidencia: ['request/response A vs B', 'matriz de accesos', 'curl mínimo'],
    fueraDeScope: ['Cuentas ajenas', 'Fuerza bruta', 'DoS'],
  },
};

function listGuide() {
  return Object.entries(GUIDE).map(([id, g]) => ({ id, titulo: g.titulo }));
}

function getGuide(clase) {
  const g = GUIDE[String(clase || '').toLowerCase()];
  if (!g) return { ok: false, clases: listGuide() };
  return { ok: true, ...g };
}

// ── Decodificador (caja de herramientas manual) ──────────────────────────
function tryB64(s) {
  try {
    const clean = String(s).trim().replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/=_-]+$/.test(clean) || clean.length < 4) return null;
    const norm = clean.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(norm, 'base64').toString('utf8');
  } catch { return null; }
}

function decodeJwt(s) {
  try {
    const parts = String(s).trim().split('.');
    if (parts.length !== 3) return null;
    const out = {};
    for (const [i, k] of [[0, 'header'], [1, 'payload']]) {
      out[k] = JSON.parse(Buffer.from(parts[i].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    }
    out.firmaPresente = parts[2].length > 0;
    return out;
  } catch { return null; }
}

function decode(input) {
  const s = String(input ?? '');
  const res = { input: s.slice(0, 500), base64: null, url: null, hex: null, html: null, jwt: null };
  res.base64 = tryB64(s);
  try { const u = decodeURIComponent(s); res.url = u === s ? null : u; } catch { res.url = null; }
  try {
    const h = s.trim().replace(/^0x/i, '').replace(/\s+/g, '');
    res.hex = (/^[0-9a-fA-F]+$/.test(h) && h.length >= 4 && h.length % 2 === 0)
      ? Buffer.from(h, 'hex').toString('utf8') : null;
  } catch { res.hex = null; }
  try {
    const ent = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&#x27;': "'" };
    const h = s.replace(/&(lt|gt|amp|quot|#39|#x27);/g, (m) => ent[m] || m);
    res.html = h === s ? null : h;
  } catch { res.html = null; }
  res.jwt = decodeJwt(s);
  res.util = [res.jwt && 'jwt', res.base64 && 'base64', res.url && 'url', res.hex && 'hex', res.html && 'html'].filter(Boolean);
  return res;
}

module.exports = { GUIDE, listGuide, getGuide, decode };
