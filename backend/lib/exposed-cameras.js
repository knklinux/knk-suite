'use strict';

// ============================================================================
// exposed-cameras.js — motor del módulo «Cámaras Expuestas»
//
// QUÉ ES
// Un constructor de consultas con filtros para localizar cámaras de vídeo en
// índices públicos de internet (Shodan, FOFA, ZoomEye, Netlas, Censys,
// GreyNoise) y un analizador de objetivos sueltos usando Shodan InternetDB
// (gratuito y sin clave).
//
// QUÉ NO ES (límites deliberados, iguales que el resto de KNK)
//   * NO se conecta nunca a los objetivos: solo se consultan índices que ya
//     escanearon internet antes y devuelven metadatos de ese escaneo;
//   * NO se abren streams, NO se prueban credenciales ni se explota nada;
//   * la salida es una lista de CANDIDATOS con una puntuación razonada para que
//     la persona decida qué está en su alcance autorizado.
//
// DOS FILTROS QUE SE CONFUNDEN FÁCIL
//   `service`  → acota la CONSULTA que se pega en el buscador.
//   `port`     → filtra TUS objetivos analizados (solo si se pide a mano).
// Equivocarlos dejaría la lista vacía al elegir un servicio, así que van
// separados a propósito.
//
// El análisis de objetivos acepta IPs y CIDR (recortando rangos enormes) y
// guarda el motivo de cada descarte en lugar de descartar en silencio.
// ============================================================================

const MAX_TARGETS = 32; // InternetDB es un GET por IP: se acota por cortesía.
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 8000;
const INTERNETDB_BASE = 'https://internetdb.shodan.io/';

// Puertos donde de verdad vive una cámara o su grabador (DVR/NVR).
const CAMERA_PORTS = [554, 8554, 10554, 80, 8080, 8000, 8443, 443, 37777, 34567, 8888, 9000];

// Firmas por marca: sirven para construir consultas precisas en cada buscador.
const BRANDS = {
  hikvision: {
    label: 'Hikvision',
    cpe: ['hikvision'],
    shodan: 'product:"Hikvision IP Camera"',
    fofa: 'app="HIKVISION-视频监控"',
    zoomeye: 'app:"Hikvision"',
    dork: '/doc/page/login.asp',
  },
  dahua: {
    label: 'Dahua',
    cpe: ['dahua', 'zhejiang_dahua'],
    shodan: 'product:"Dahua DVR"',
    fofa: 'app="Dahua-视频监控"',
    zoomeye: 'app:"Dahua"',
    dork: '/current_config/passwd',
  },
  axis: {
    label: 'Axis',
    cpe: ['axis'],
    shodan: 'product:"AXIS Camera"',
    fofa: 'app="AXIS-视频监控"',
    zoomeye: 'app:"AXIS"',
    dork: '/view/view.shtml',
  },
  foscam: {
    label: 'Foscam',
    cpe: ['foscam'],
    shodan: 'product:"Foscam IP Camera"',
    fofa: 'app="Foscam"',
    zoomeye: 'app:"Foscam"',
    dork: '/cgi-bin/CGIProxy.fcgi',
  },
  reolink: {
    label: 'Reolink',
    cpe: ['reolink'],
    shodan: 'product:"Reolink"',
    fofa: 'body="Reolink"',
    zoomeye: 'app:"Reolink"',
    dork: 'h264Preview_01_main',
  },
  xiongmai: {
    label: 'Xiongmai / XM',
    cpe: ['xiongmai'],
    shodan: 'product:"Xiongmai DVR"',
    fofa: 'app="XM-视频监控"',
    zoomeye: 'app:"Xiongmai"',
    dork: 'Login.vsp',
  },
  tplink: {
    label: 'TP-Link / Tapo',
    cpe: ['tp-link'],
    shodan: 'product:"TP-LINK IP Camera"',
    fofa: 'app="TP-LINK-视频监控"',
    zoomeye: 'app:"TP-Link"',
    dork: 'stream1',
  },
};

// Protocolos/servicios de cámara sobre los que se filtra.
const SERVICES = [
  { id: 'rtsp', label: 'RTSP (554)', port: 554, shodan: 'port:554', fofa: 'protocol="rtsp"', zoomeye: 'service:"rtsp"' },
  { id: 'rtsp-alt', label: 'RTSP alternativo (8554)', port: 8554, shodan: 'port:8554', fofa: 'port="8554"', zoomeye: 'port:8554' },
  { id: 'mjpeg', label: 'MJPEG por HTTP (80)', port: 80, shodan: 'port:80 "multipart/x-mixed-replace"', fofa: 'body="multipart/x-mixed-replace"', zoomeye: 'port:80' },
  { id: 'http-alt', label: 'HTTP alternativo (8080)', port: 8080, shodan: 'port:8080', fofa: 'port="8080"', zoomeye: 'port:8080' },
  { id: 'hikvision-http', label: 'Hikvision HTTP (8000)', port: 8000, shodan: 'port:8000', fofa: 'port="8000"', zoomeye: 'port:8000' },
  { id: 'https', label: 'HTTPS de cámara (8443)', port: 8443, shodan: 'port:8443', fofa: 'port="8443"', zoomeye: 'port:8443' },
  { id: 'onvif', label: 'ONVIF', port: 80, shodan: '"/onvif/device_service"', fofa: 'body="/onvif/device_service"', zoomeye: '"/onvif/device_service"' },
  { id: 'dahua-dvr', label: 'Dahua DVR (37777)', port: 37777, shodan: 'port:37777', fofa: 'port="37777"', zoomeye: 'port:37777' },
  { id: 'xiongmai-dvr', label: 'Xiongmai DVR (34567)', port: 34567, shodan: 'port:34567', fofa: 'port="34567"', zoomeye: 'port:34567' },
];

// Consultas ya cocinadas: lo que la gente usa de verdad para encontrar
// webcams que un buscador ya fotografió.
const PRESETS = [
  {
    id: 'open-webcams',
    label: 'Webcams con captura disponible',
    hint: 'Índices que ya guardaron una imagen del stream público.',
    shodan: 'port:554 has_screenshot:true',
    fofa: 'protocol="rtsp" && is_domain=false',
    zoomeye: 'port:554 +has_screenshot:true',
  },
  {
    id: 'mjpeg-open',
    label: 'MJPEG abiertos (sin formulario delante)',
    hint: 'Servidores que responden con multipart/x-mixed-replace.',
    shodan: '"multipart/x-mixed-replace" -401',
    fofa: 'header="multipart/x-mixed-replace"',
    zoomeye: '"multipart/x-mixed-replace"',
  },
  {
    id: 'nvrs',
    label: 'NVR/DVR de videovigilancia',
    hint: 'Grabadores accesibles con su panel de login.',
    shodan: 'product:"DVR" port:80',
    fofa: 'app="DVR-视频监控"',
    zoomeye: 'app:"DVR"',
  },
  {
    id: 'traffic-cams',
    label: 'Cámaras de tráfico',
    hint: 'Cámaras de carretera y tráfico indexadas.',
    shodan: 'http.title:"Traffic" port:80',
    fofa: 'title="Traffic"',
    zoomeye: 'title:"traffic camera"',
  },
  {
    id: 'vuln-cameras',
    label: 'Cámaras con vulnerabilidades conocidas',
    hint: 'Filtro de CVEs que el buscador ya asoció al host.',
    shodan: 'vulns: CVE-2021-36260',
    fofa: 'vulns="CVE-2021-36260"',
    zoomeye: 'CVE-2021-36260',
  },
];

// Países frecuentes para acotar el alcance de la búsqueda.
const COUNTRIES = [
  { code: 'ES', label: 'España' }, { code: 'FR', label: 'Francia' }, { code: 'PT', label: 'Portugal' },
  { code: 'IT', label: 'Italia' }, { code: 'DE', label: 'Alemania' }, { code: 'NL', label: 'Países Bajos' },
  { code: 'BE', label: 'Bélgica' }, { code: 'GB', label: 'Reino Unido' }, { code: 'IE', label: 'Irlanda' },
  { code: 'CH', label: 'Suiza' }, { code: 'AT', label: 'Austria' }, { code: 'SE', label: 'Suecia' },
  { code: 'NO', label: 'Noruega' }, { code: 'DK', label: 'Dinamarca' }, { code: 'FI', label: 'Finlandia' },
  { code: 'IS', label: 'Islandia' }, { code: 'PL', label: 'Polonia' }, { code: 'CZ', label: 'Chequia' },
  { code: 'RO', label: 'Rumanía' }, { code: 'GR', label: 'Grecia' }, { code: 'TR', label: 'Turquía' },
  { code: 'MA', label: 'Marruecos' }, { code: 'US', label: 'Estados Unidos' }, { code: 'CA', label: 'Canadá' },
  { code: 'MX', label: 'México' }, { code: 'BR', label: 'Brasil' }, { code: 'AR', label: 'Argentina' },
  { code: 'CL', label: 'Chile' }, { code: 'CO', label: 'Colombia' }, { code: 'PE', label: 'Perú' },
  { code: 'JP', label: 'Japón' }, { code: 'KR', label: 'Corea del Sur' }, { code: 'CN', label: 'China' },
  { code: 'IN', label: 'India' }, { code: 'SG', label: 'Singapur' }, { code: 'AU', label: 'Australia' },
  { code: 'ZA', label: 'Sudáfrica' }, { code: 'AE', label: 'Emiratos Árabes' }, { code: 'IL', label: 'Israel' },
  { code: 'RU', label: 'Rusia' },
];

const SORTS = [
  { id: 'score', label: 'Más probable primero' },
  { id: 'ports', label: 'Más puertos de cámara' },
  { id: 'vulns', label: 'Más CVEs' },
  { id: 'ip', label: 'IP' },
];

// ── parseo de objetivos ─────────────────────────────────────────────

function ipToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value * 256) + octet;
  }
  return value;
}

function intToIp(value) {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

function isPrivateIpv4(ip) {
  const value = ipToInt(ip);
  if (value === null) return false;
  const a = value >>> 24;
  const b = (value >>> 16) & 255;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/**
 * Expande un CIDR a direcciones concretas.
 * En /30 o menor (más hosts) se descartan red y broadcast; en /31 y /32, que no
 * tienen esa distinción, se usan todas. Nunca se generan redes privadas.
 */
function expandCidr(token, max, notes, invalid) {
  const [base, bitsRaw] = String(token).split('/');
  const bits = Number(bitsRaw);
  const baseValue = ipToInt(base);
  if (baseValue === null || !/^\d{1,2}$/.test(bitsRaw) || bits < 8 || bits > 32) {
    invalid.push(token);
    return [];
  }
  const hostBits = 32 - bits;
  const size = 2 ** hostBits;
  const network = hostBits === 0 ? baseValue : (baseValue - (baseValue % size));
  const first = hostBits >= 2 ? network + 1 : network;
  const last = hostBits >= 2 ? network + size - 2 : network + size - 1;

  const out = [];
  for (let value = first; value <= last; value += 1) {
    if (out.length >= max) break;
    const candidate = intToIp(value >>> 0);
    if (isPrivateIpv4(candidate)) continue;
    out.push(candidate);
  }
  if (out.length >= max && last - first + 1 > max) {
    notes.push(`${token}: se analizan solo ${max} de ${last - first + 1} direcciones usables`);
  }
  return out;
}

/**
 * Acepta una IP, una lista separada por comas/espacios/saltos o un CIDR.
 * Un CIDR grande se recorta a `max` direcciones y se avisa en `notes` en lugar
 * de intentar cientos de peticiones al índice.
 */
function parseTargets(input, { max = MAX_TARGETS } = {}) {
  const raw = String(input || '').trim();
  const notes = [];
  const ips = [];
  const invalid = [];

  if (!raw) return { ok: false, error: 'escribe al menos una IP o un CIDR', ips: [], invalid, notes };

  for (const token of raw.split(/[\s,;]+/).filter(Boolean)) {
    if (ips.length >= max) { notes.push(`límite de ${max} objetivos por análisis`); break; }

    if (token.includes('/')) {
      ips.push(...expandCidr(token, max - ips.length, notes, invalid));
      continue;
    }

    if (ipToInt(token) === null) { invalid.push(token); continue; }
    if (isPrivateIpv4(token)) { invalid.push(`${token} (privada: este módulo es para objetivos públicos)`); continue; }
    if (!ips.includes(token)) ips.push(token);
  }

  const unique = [...new Set(ips)];
  if (invalid.length) notes.push(`descartados: ${invalid.slice(0, 6).join(', ')}${invalid.length > 6 ? '…' : ''}`);
  if (!unique.length) return { ok: false, error: 'ninguna IP pública válida en la lista', ips: [], invalid, notes };
  if (unique.length >= max) notes.push(`límite de ${max} objetivos por análisis`);
  return { ok: true, ips: unique, invalid, notes: [...new Set(notes)] };
}

// ── plan de consultas ───────────────────────────────────────────────

/**
 * Une términos de búsqueda quitando repetidos y los que ya están contenidos en
 * otro: un preset («port:554 has_screenshot:true») y un servicio («port:554»)
 * no deben repetir el mismo puerto en la consulta final.
 */
function joinTerms(list, glue) {
  const terms = [...new Set(list.filter(Boolean))];
  const kept = terms.filter((term) => !terms.some((other) => other !== term && other.includes(term)));
  return kept.join(glue);
}

/**
 * Traduce los filtros a consultas concretas para cada buscador. Cada motor usa
 * su propia sintaxis, así que la traducción es explícita y comprobable.
 */
function buildPlatformQueries(filters = {}, { service = null, brand = null, preset = null } = {}) {
  const country = String(filters.country || '').toUpperCase();
  const q = String(filters.q || '').trim();
  const vulnsOnly = Boolean(filters.vulnsOnly);
  const hasScreenshot = Boolean(filters.hasScreenshot);
  const port = filters.port ? Number(filters.port) : null;

  const terms = { shodan: [], fofa: [], zoomeye: [] };

  if (preset) {
    terms.shodan.push(preset.shodan);
    terms.fofa.push(preset.fofa);
    terms.zoomeye.push(preset.zoomeye);
  }
  if (service) {
    terms.shodan.push(service.shodan);
    terms.fofa.push(service.fofa);
    terms.zoomeye.push(service.zoomeye);
  }
  if (port && !service) {
    terms.shodan.push(`port:${port}`);
    terms.fofa.push(`port="${port}"`);
    terms.zoomeye.push(`port:${port}`);
  }
  if (brand) {
    terms.shodan.push(brand.shodan);
    terms.fofa.push(brand.fofa);
    terms.zoomeye.push(brand.zoomeye);
  }
  if (country && country !== 'ALL') {
    terms.shodan.push(`country:${country}`);
    terms.fofa.push(`country="${country}"`);
    terms.zoomeye.push(`country:"${country}"`);
  }
  if (hasScreenshot) terms.shodan.push('has_screenshot:true');
  if (vulnsOnly) {
    terms.shodan.push('vulns:!undefined');
    terms.fofa.push('vulns!=""');
  }
  if (q) {
    terms.shodan.push(q);
    terms.fofa.push(q);
    terms.zoomeye.push(q);
  }

  const shodanQuery = joinTerms(terms.shodan, ' ') || 'port:554';
  const fofaQuery = joinTerms(terms.fofa, ' && ') || 'protocol="rtsp"';
  const zoomeyeQuery = joinTerms(terms.zoomeye, ' ') || 'port:554';

  return [
    { platform: 'Shodan', url: `https://www.shodan.io/search?query=${encodeURIComponent(shodanQuery)}`, syntax: shodanQuery, free: true, note: 'Capturas e histórico; la cuenta gratuita limita resultados.' },
    { platform: 'FOFA', url: `https://en.fofa.info/result?qbase64=${Buffer.from(fofaQuery, 'utf8').toString('base64')}`, syntax: fofaQuery, free: true, note: 'Requiere cuenta gratuita para ver todas las páginas.' },
    { platform: 'ZoomEye', url: `https://www.zoomeye.org/searchResult?q=${encodeURIComponent(zoomeyeQuery)}`, syntax: zoomeyeQuery, free: true, note: 'Buenas capturas de dispositivos.' },
    { platform: 'Netlas', url: `https://app.netlas.io/responses/?q=${encodeURIComponent(zoomeyeQuery)}`, syntax: zoomeyeQuery, free: true, note: 'Alternativa sin clave para consultas pequeñas.' },
    { platform: 'Censys', url: `https://search.censys.io/search?resource=hosts&q=${encodeURIComponent(shodanQuery.replace(/country:/g, 'location.country_code:').replace(/port:/g, 'services.port='))}`, syntax: shodanQuery, free: true, note: 'Metadatos de servicio y certificados.' },
    { platform: 'GreyNoise', url: `https://viz.greynoise.io/query?q=${encodeURIComponent(shodanQuery)}`, syntax: shodanQuery, free: true, note: 'Ruido y clasificación del host.' },
  ];
}

function buildDorks(filters = {}, { brand = null, preset = null } = {}) {
  const country = String(filters.country || '').toUpperCase();
  const dorks = [];
  if (preset) dorks.push(preset.shodan);
  if (brand?.dork) dorks.push(`inurl:"${brand.dork}"`);
  dorks.push(
    'intitle:"webcam" inurl:view/view.shtml',
    'inurl:"/cgi-bin/mjpg/video.cgi"',
    'intitle:"Network Camera" "live view"',
    'inurl:"axis-cgi/mjpg/video.cgi"',
    'inurl:"/videostream.cgi" -inurl:login',
  );
  if (country && country !== 'ALL') dorks.push(`intitle:"webcam" country:${country}`);
  return [...new Set(dorks)].map((dork) => ({
    dork,
    url: `https://www.google.com/search?q=${encodeURIComponent(dork)}`,
  }));
}

/** Órdenes listas para pegar en la terminal del workbench. */
function buildCli(filters = {}, { service = null } = {}) {
  const port = filters.port || service?.port || 554;
  const country = filters.country && filters.country !== 'ALL' ? String(filters.country).toUpperCase() : null;
  return [
    {
      tool: 'nmap',
      label: `Comprobar puerto ${port}${country ? ` en ${country}` : ''}`,
      command: `nmap -Pn -p${port} --open -iL objetivos.txt`,
      note: 'Escribe en objetivos.txt solo rangos de tu alcance (cliente, bug bounty, laboratorio).',
    },
    {
      tool: 'internetdb',
      label: 'Metadatos de un host sin tocarlo',
      command: 'curl -s https://internetdb.shodan.io/<IP> | jq',
      note: 'Devuelve puertos, CPEs y CVEs de un escaneo ya hecho por Shodan.',
    },
    {
      tool: 'ffmpeg',
      label: 'Un fotograma como evidencia (solo en tu alcance)',
      command: 'ffmpeg -rtsp_transport tcp -i rtsp://<host>:554/<path> -frames:v 1 -y foto.jpg',
      note: 'Un solo fotograma basta para adjuntarlo a un informe.',
    },
    {
      tool: 'catálogo',
      label: 'Webcams públicas legítimas, ya integradas',
      command: 'Módulo Cámaras Públicas → filtro por zona',
      note: 'Fuentes oficiales (DGT, Madrid, TfL, Digitraffic, Vegagerðin) sin claves.',
    },
  ];
}

// ── puntuación de un host ───────────────────────────────────────────

/**
 * Puntúa qué probabilidad hay de que un host sea una cámara, con motivos
 * legibles. Nunca "decide" por el analista: solo prioriza la lista.
 */
function scoreCamera(record = {}) {
  const ports = (record.ports || []).map(Number);
  const cpes = (record.cpes || []).map((c) => String(c).toLowerCase());
  const tags = (record.tags || []).map((t) => String(t).toLowerCase());
  const hostnames = (record.hostnames || []).map((h) => String(h).toLowerCase());
  const vulns = record.vulns || [];

  let score = 0;
  const reasons = [];

  const cameraPorts = ports.filter((p) => CAMERA_PORTS.includes(p));
  if (ports.includes(554)) { score += 40; reasons.push('RTSP abierto (554): protocolo típico de cámara'); }
  if (ports.includes(8554)) { score += 20; reasons.push('RTSP alternativo (8554)'); }
  if (ports.includes(37777)) { score += 30; reasons.push('puerto 37777: DVR Dahua'); }
  if (ports.includes(34567)) { score += 25; reasons.push('puerto 34567: DVR Xiongmai'); }
  if (ports.includes(8000)) { score += 15; reasons.push('puerto 8000: HTTP de Hikvision'); }
  if (ports.includes(80) || ports.includes(8080)) { score += 5; reasons.push('HTTP de gestión expuesto'); }
  if (ports.includes(8443) || ports.includes(443)) { score += 5; reasons.push('HTTPS de gestión expuesto'); }

  for (const brand of Object.values(BRANDS)) {
    if (cpes.some((cpe) => brand.cpe.some((fragment) => cpe.includes(fragment)))) {
      score += 35;
      reasons.push(`CPE de ${brand.label} en el índice`);
      break;
    }
  }
  if (cpes.some((cpe) => /camera|webcam|ipcam|dvr|nvr/.test(cpe))) { score += 25; reasons.push('CPE con «camera/dvr/nvr»'); }
  if (tags.includes('webcam') || tags.includes('camera')) { score += 15; reasons.push('etiquetas de cámara en el índice'); }
  if (hostnames.some((h) => /cam|cctv|ipcam|dvr|nvr|webcam/.test(h))) { score += 20; reasons.push('nombre de host con «cam/cctv/dvr»'); }
  if (vulns.length) { score += Math.min(20, vulns.length * 5); reasons.push(`${vulns.length} CVE(s) asociado(s)`); }
  if (cameraPorts.length >= 3) { score += 10; reasons.push('varios puertos de cámara a la vez'); }

  return {
    score: Math.min(100, score),
    reasons,
    isLikelyCamera: score >= 40,
    cameraPorts,
  };
}

/** ¿Algún CPE del host corresponde a la marca filtrada? */
function brandMatches(cpes, brand) {
  if (!brand) return false;
  return (cpes || []).some((cpe) => brand.cpe.some((fragment) => String(cpe).toLowerCase().includes(fragment)));
}

// ── Shodan InternetDB ───────────────────────────────────────────────

let fetchImpl = globalThis.fetch;

/** Permite inyectar un fetch en los tests (sin red). */
function setFetchImpl(impl) {
  fetchImpl = impl;
}

async function queryInternetDb(ip, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== 'function') return { ok: false, ip, error: 'sin cliente HTTP disponible' };
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(`${INTERNETDB_BASE}${ip}`, { signal: controller?.signal });
    if (response.status === 404) return { ok: false, ip, error: 'sin datos en el índice' };
    if (!response.ok) return { ok: false, ip, error: `índice HTTP ${response.status}` };
    const data = await response.json();
    return { ok: true, ip, record: data };
  } catch (error) {
    return { ok: false, ip, error: error.name === 'AbortError' ? 'timeout del índice' : error.message };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Ejecuta tareas en paralelo con un techo, conservando el orden de entrada. */
async function mapWithConcurrency(items, limit, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

// ── filtros y búsqueda ──────────────────────────────────────────────

function normalizeFilters(input = {}) {
  const service = SERVICES.find((s) => s.id === input.service) || null;
  const brandId = Object.keys(BRANDS).find((key) => key === String(input.brand || '').toLowerCase()) || 'all';
  const preset = PRESETS.find((p) => p.id === input.preset) || null;
  const country = String(input.country || 'all').toUpperCase();
  // `port` es SOLO el filtro explícito sobre tus objetivos: el puerto sugerido
  // por un servicio vive en `servicePort` y no descarta hosts.
  const port = input.port !== undefined && input.port !== null && input.port !== '' ? Number(input.port) : null;
  return {
    q: String(input.q || '').trim().slice(0, 200),
    targets: String(input.targets || '').trim().slice(0, 4000),
    country: COUNTRIES.some((c) => c.code === country) ? country : 'all',
    service: service?.id || 'all',
    servicePort: service?.port || null,
    brand: brandId,
    preset: preset?.id || 'all',
    port: Number.isFinite(port) ? port : null,
    hasScreenshot: Boolean(input.hasScreenshot),
    vulnsOnly: Boolean(input.vulnsOnly),
    minScore: Math.max(0, Math.min(100, Number(input.minScore) || 0)),
    sort: SORTS.some((s) => s.id === input.sort) ? input.sort : 'score',
    limit: Math.max(1, Math.min(Number(input.limit) || 50, 200)),
  };
}

function sortTargets(targets, sort) {
  const copy = [...targets];
  if (sort === 'ip') return copy.sort((a, b) => (ipToInt(a.ip) || 0) - (ipToInt(b.ip) || 0));
  if (sort === 'ports') return copy.sort((a, b) => (b.cameraPorts.length - a.cameraPorts.length) || (b.score - a.score));
  if (sort === 'vulns') return copy.sort((a, b) => (b.vulns.length - a.vulns.length) || (b.score - a.score));
  return copy.sort((a, b) => b.score - a.score || a.ip.localeCompare(b.ip));
}

/**
 * Búsqueda completa: plan de consultas + análisis de los objetivos escritos.
 * Nunca lanza: cualquier fallo se devuelve en `notes` o en cada objetivo.
 */
async function searchExposed(input = {}) {
  const filters = normalizeFilters(input);
  const service = SERVICES.find((s) => s.id === filters.service) || null;
  const brand = BRANDS[filters.brand] || null;
  const preset = PRESETS.find((p) => p.id === filters.preset) || null;

  const queryPlan = {
    platforms: buildPlatformQueries(filters, { service, brand, preset }),
    dorks: buildDorks(filters, { brand, preset }),
    cli: buildCli(filters, { service }),
  };

  const parsed = parseTargets(filters.targets);
  const notes = [...parsed.notes];
  const targets = [];
  const failed = [];

  if (parsed.ok) {
    const analyzed = await mapWithConcurrency(parsed.ips, DEFAULT_CONCURRENCY, (ip) => queryInternetDb(ip));
    analyzed.forEach((result, index) => {
      const ip = parsed.ips[index];
      if (!result.ok) { failed.push({ ip, error: result.error }); return; }
      const record = result.record || {};
      const scored = scoreCamera(record);
      targets.push({
        ip,
        ports: record.ports || [],
        hostnames: record.hostnames || [],
        cpes: record.cpes || [],
        tags: record.tags || [],
        vulns: record.vulns || [],
        score: scored.score,
        reasons: scored.reasons,
        cameraPorts: scored.cameraPorts,
        isLikelyCamera: scored.isLikelyCamera,
        brandMatch: brandMatches(record.cpes, brand),
        internetDb: `${INTERNETDB_BASE}${ip}`,
        shodan: `https://www.shodan.io/host/${ip}`,
      });
    });
    if (!targets.length && failed.length) notes.push('InternetDB no devolvió datos para ningún objetivo');
  } else if (filters.targets) {
    notes.push(parsed.error);
  }

  let visible = targets;
  if (filters.vulnsOnly) visible = visible.filter((t) => t.vulns.length > 0);
  if (filters.port) visible = visible.filter((t) => t.ports.includes(filters.port));
  if (filters.minScore > 0) visible = visible.filter((t) => t.score >= filters.minScore);
  // Con marca elegida se conservan los hosts sin CPE: el índice no siempre los
  // publica, y descartarlos ocultaría candidatos reales.
  if (brand) visible = visible.filter((t) => t.brandMatch || t.cpes.length === 0);
  if (filters.hasScreenshot) notes.push('el filtro «con captura» se aplica en la consulta al buscador, no en InternetDB');
  if (service && filters.port) {
    notes.push(`el servicio «${service.label}» filtra la consulta al buscador; el puerto ${filters.port} filtra además tus objetivos`);
  } else if (service) {
    notes.push(`«${service.label}» acota la consulta al buscador; tus objetivos se listan sin filtrar por puerto`);
  }

  const sorted = sortTargets(visible, filters.sort).slice(0, filters.limit);
  const byPort = {};
  for (const target of targets) for (const port of target.cameraPorts) byPort[port] = (byPort[port] || 0) + 1;

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    filters,
    queryPlan,
    targets: sorted,
    summary: {
      requested: parsed.ips?.length || 0,
      analyzed: targets.length,
      failed: failed.length,
      shown: sorted.length,
      filteredOut: targets.length - sorted.length,
      likelyCameras: targets.filter((t) => t.isLikelyCamera).length,
      withVulns: targets.filter((t) => t.vulns.length > 0).length,
      byPort,
    },
    failed,
    notes: [...new Set(notes)],
    semantics: 'public-index-metadata',
    warning: 'Metadatos de índices públicos: no se ha conectado a ningún objetivo. Analiza solo sistemas de tu alcance autorizado.',
  };
}

function options() {
  return {
    services: SERVICES,
    brands: Object.entries(BRANDS).map(([id, brand]) => ({ id, label: brand.label })),
    presets: PRESETS,
    countries: COUNTRIES,
    sorts: SORTS,
    cameraPorts: CAMERA_PORTS,
    limits: [25, 50, 100, 200],
  };
}

module.exports = {
  searchExposed,
  options,
  parseTargets,
  buildPlatformQueries,
  buildDorks,
  buildCli,
  joinTerms,
  scoreCamera,
  brandMatches,
  queryInternetDb,
  setFetchImpl,
  mapWithConcurrency,
  isPrivateIpv4,
  ipToInt,
  intToIp,
  expandCidr,
  normalizeFilters,
  MAX_TARGETS,
  CAMERA_PORTS,
  SERVICES,
  BRANDS,
  PRESETS,
  COUNTRIES,
  SORTS,
  INTERNETDB_BASE,
};
