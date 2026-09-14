'use strict';

// ============================================================================
// KNK SUITE v2.1 — Cámaras IP / RTSP / ONVIF (solo programas autorizados)
// Regla de oro: NUNCA probar cámaras fuera del scope del programa. Escanear
// cámaras ajenas (Shodan-style) es ilegal. Este módulo solo actúa sobre hosts
// que el operador ha configurado como in-scope Y con OPPLAN aprobado.
// NO automatiza fuerza bruta de credenciales (requiere reglas del programa).
// ============================================================================

const net = require('net');

const RTSP_PORTS = [554, 8554, 10554, 8554];
const COMMON_RTSP_PATHS = ['/', '/live', '/stream1', '/h264', '/video1', '/live1', '/onvif1', '/h264Preview_01_main'];

const CATEGORIES = [
  {
    id: 'exposure',
    name: 'Panel web / exposición',
    accounts: 'none',
    why: 'Paneles sin auth en puertos web (80/443/8080/8443).',
    tests: [
      { id: 'cam-web', title: 'Panel de administración expuesto', steps: ['Probar http(s)://HOST en 80/443/8080/8443', '¿Login sin protección? ¿Banner con modelo/firmware?'] },
      { id: 'cam-paths', title: 'Rutas comunes de panel', steps: ['Probar /, /admin, /login, /cgi-bin/, /setup.cgi', '¿Páginas sin autenticación?'] },
      { id: 'cam-snapshot', title: 'Snapshot sin auth', steps: ['Probar /snapshot.cgi, /image.jpg, /capture, /stream.jpg', '¿Devuelve imagen sin credenciales?'] },
    ],
  },
  {
    id: 'rtsp',
    name: 'Flujo RTSP',
    accounts: 'none',
    why: 'Streams en rutas predecibles sin credenciales.',
    tests: [
      { id: 'rtsp-ports', title: 'Puertos RTSP abiertos', steps: ['Probar TCP a 554, 8554, 10554', '¿Puerto abierto? Registrar banner'] },
      { id: 'rtsp-paths', title: 'Rutas de stream comunes', steps: ['OPTIONS rtsp://HOST:PORT/PATH', 'Probar /live, /stream1, /h264, /onvif1', '¿DESCRIBE responde 200 sin auth?'] },
      { id: 'rtsp-anon', title: 'Stream anónimo', steps: ['DESCRIBE rtsp://HOST/PATH', 'Si 200, intentar PLAY (VLC) — verificar que es reproducible', '⚠️ No grabar/almacenar contenido ajeno'] },
    ],
  },
  {
    id: 'onvif',
    name: 'ONVIF / protocolo',
    accounts: 'none',
    why: 'Servicio ONVIF mal configurado en puerto 8000/8899.',
    tests: [
      { id: 'onvif-port', title: 'ONVIF accesible', steps: ['Probar TCP a 8000, 8899', 'POST /onvif/device_service con GetDeviceInformation', '¿Responde sin auth?'] },
      { id: 'onvif-ws', title: 'WS-Discovery', steps: ['Solo en red local autorizada: enviar Probe a 239.255.255.250:3702', '¿Revela dispositivos con URLs y MAC?'] },
    ],
  },
  {
    id: 'creds',
    name: 'Credenciales por defecto',
    accounts: 'none',
    why: '⚠️ SOLO si el programa lo permite explícitamente en su política.',
    tests: [
      { id: 'cred-default', title: 'Credenciales por defecto (verificar política)', steps: ['Consultar la política: ¿permite probar admin/admin, root/12345?', 'Probar SOLO si está permitido y documentado', 'Nunca automatizar fuerza bruta masiva'] },
    ],
  },
  {
    id: 'firmware',
    name: 'Firmware / CVEs',
    accounts: 'none',
    why: 'Versión de firmware → CVEs conocidos.',
    tests: [
      { id: 'fw-banner', title: 'Identificar modelo y firmware', steps: ['Banner del panel o respuesta ONVIF', 'Buscar CVEs del modelo/firmware', 'Probar exploit SOLO si el programa lo permite'] },
    ],
  },
];

/**
 * Plan de pruebas para cámaras del programa.
 */
function planTests(program) {
  return {
    target: program?.target || '',
    scope: program?.scope || [],
    categories: CATEGORIES,
    count: CATEGORIES.reduce((n, c) => n + c.tests.length, 0),
    note: 'Solo hosts in-scope del programa. Nunca probar cámaras ajenas.',
  };
}

/**
 * Sonda RTSP segura: SOLO hosts in-scope y con autorización explícita.
 * NO fuerza bruta. Solo conexión TCP + OPTIONS con timeout.
 * @param {string} host
 * @param {{port?:number, timeoutMs?:number, authorized?:boolean}} opts
 */
async function probeRtsp(host, opts = {}) {
  const { timeoutMs = 4000, authorized = false } = opts;
  const inScope = netMod ? netMod.inScope(host) : false;
  if (!authorized) return { ok: false, error: 'not_authorized', reason: 'OPPLAN aprobado + autorización requeridos' };
  if (!inScope) return { ok: false, error: 'out_of_scope', reason: `${host} no está en el scope del programa` };
  const port = opts.port || 554;

  return new Promise(resolve => {
    const socket = new net.Socket();
    const timer = setTimeout(() => { socket.destroy(); resolve({ ok: false, host, port, error: 'timeout', reason: 'sin respuesta' }); }, timeoutMs);
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      // OPTIONS RTSP (bajo impacto, no destructivo)
      socket.write('OPTIONS rtsp://' + host + ':' + port + '/ RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: knk-suite/2.1 (authorized testing)\r\n\r\n');
    });
    socket.once('data', data => {
      clearTimeout(timer);
      socket.destroy();
      const text = data.toString('utf8', 0, 200);
      const rtsp200 = /RTSP\/1\.0 200/i.test(text);
      resolve({ ok: true, host, port, open: true, rtsp: rtsp200, banner: text.split('\r\n')[0] || text.slice(0, 60) });
    });
    socket.once('close', () => { clearTimeout(timer); resolve({ ok: true, host, port, open: false, reason: 'puerto cerrado' }); });
    socket.once('error', () => { clearTimeout(timer); resolve({ ok: false, host, port, error: 'connection_error', reason: 'no accesible' }); });
    socket.connect(port, host);
  });
}

/**
 * Compuerta para validar un hallazgo de cámara antes de reportar.
 */
function cameraChain(i) {
  const checks = [
    { id: 'cam-1', label: 'Cámara dentro del scope exacto del programa', ok: i.inScope === true },
    { id: 'cam-2', label: 'Autorización explícita del programa (política leída)', ok: i.authorized === true },
    { id: 'cam-3', label: 'Impacto real demostrado (stream/panel/datos)', ok: i.impactReal === true },
    { id: 'cam-4', label: 'Reproducible ≥2 veces', ok: (i.reproducibleCount || 0) >= 2 },
    { id: 'cam-5', label: 'Sin DoS, sin fuerza bruta masiva, sin datos ajenos', ok: i.safeTesting === true },
    { id: 'cam-6', label: 'No es duplicado ni disqualifier', ok: i.noDuplicate === true && i.notDisqualifier === true },
  ];
  const sendable = checks.every(c => c.ok);
  return {
    sendable,
    summary: sendable ? '✅ HALLAZGO DE CÁMARA LISTO' : `⛔ INCOMPLETO: ${checks.filter(c => !c.ok).map(c => c.id).join(', ')}`,
    results: checks.map(c => ({ ...c, detail: c.ok ? 'OK' : 'PENDIENTE' })),
  };
}

let netMod = null;
function setNetMod(mod) { netMod = mod; }

module.exports = { CATEGORIES, planTests, probeRtsp, cameraChain, setNetMod, RTSP_PORTS, COMMON_RTSP_PATHS };
