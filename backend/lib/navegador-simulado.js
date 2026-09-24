'use strict';
/**
 * lib/navegador-simulado.js — chatgpt.com de juguete para el discriminador CDP.
 *
 * Para qué: correr el discriminador DE PUNTA A PUNTA (lanzar→inyectar→esperar→medir)
 * sin gastar la petición real a /conversation. El navegador es REAL (CDP auténtico:
 * launch, WS, cookies, Runtime.evaluate, su TLS y su huella), pero resuelve
 * `chatgpt.com` a un servidor HTTPS LOCAL mediante `--host-resolver-rules`:
 *
 *   MAP chatgpt.com 127.0.0.1:<puertoSim>, EXCLUDE localhost
 *
 * Así `location.href` ES `https://chatgpt.com/` de verdad (no hay replaceState
 * que valga: el origen no se puede falsificar desde JS, y no hace falta), las
 * cookies se asientan de verdad en el perfil, y `location.origin` coincide con
 * el destino de la sonda: los `fetch('/api/auth/session')` y
 * `fetch('/backend-api/conversation')` del driver caen aquí. Nada sale a internet.
 *
 * El certificado es PROPIO (CN=chatgpt.com, openssl, una vez, cacheado en .tmp)
 * y el navegador lanza con `--ignore-certificate-errors` SOLO en modo simulación:
 * es el detalle que declara que la página no es la real.
 *
 * Contratos servidos (los que consume el código REAL del driver):
 *   GET  /                     → HTML mínimo (título "ChatGPT")
 *   GET  /api/auth/session     → 200 {} sin cookie de sesión (la ESPERA espera de
 *                                verdad); 200 con user/accessToken si llega la
 *                                cookie __Secure-next-auth.session-token (la
 *                                INYECCIÓN del jar hace su trabajo real)
 *   POST /backend-api/conversation → exige Bearer + Content-Type; sabor con
 *                                SIM_CONV=403 (defecto) / 500 / 200
 *
 * REGLA: este servidor escucha SOLO en 127.0.0.1 y jamás representa al objetivo:
 * es un DOUBLE declarado, para validar la secuencia del driver, no para fingir
 * resultados del objetivo. El driver imprime "MODO SIMULACIÓN" por todas partes
 * y su JSON lleva simulacion:true + la ruta del volcado de peticiones.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const propiedad = require('./propiedad');

const HOST = '127.0.0.1';
const DOMINIO = 'chatgpt.com';
const NOMBRE_COOKIE_SESION = '__Secure-next-auth.session-token';
// NextAuth trocea la sesión en <nombre>.0, .1… cuando el valor supera ~4096 bytes.
// El jar REAL del proyecto viene troceado, así que el doble debe re-ensamblarlo
// (hallado por el propio modo sim: 27/27 cookies puestas y sesión que no llegaba).
const PREFIJO_CHUNK = NOMBRE_COOKIE_SESION + '.';
const DIR_CERT = path.join(__dirname, '..', '..', '.tmp', 'sim-tls');
const RUTA_MARCA = path.join(__dirname, '..', '..', '.tmp', 'disc-cdp-sim.json');

// ── Contratos puros (testeables sin servidor) ──────────────────────────────

/** El contrato que expresionSesion() consume. PURA: cabeceras → {status, cuerpo}. */
function analizarSesion(cabeceras) {
  const cookies = String((cabeceras && cabeceras.cookie) || '');
  let base = null;
  const trozos = new Map(); // nº de chunk → valor
  for (const kv of cookies.split(/;\s*/)) {
    const i = kv.indexOf('=');
    if (i <= 0) continue;
    const nombre = kv.slice(0, i).trim();
    const valor = kv.slice(i + 1);
    if (!valor) continue;
    if (nombre === NOMBRE_COOKIE_SESION) base = valor;
    else if (nombre.startsWith(PREFIJO_CHUNK)) {
      const n = parseInt(nombre.slice(PREFIJO_CHUNK.length), 10);
      if (Number.isInteger(n)) trozos.set(n, valor);
    }
  }
  // Re-ensamblado en orden numérico (NextAuth: .0 + .1 + …). El doble NO valida
  // el JWT: con que la sesión llegue basta para lo que el driver consume.
  const reconstruido = base
    || (trozos.size
      ? [...trozos.keys()].sort((a, b) => a - b).map((n) => trozos.get(n)).join('')
      : null);
  if (!reconstruido) return { status: 200, cuerpo: {} }; // como el real: 200 con {} → sinSesion:true
  return {
    status: 200,
    cuerpo: {
      user: {
        id: 'user-simulad0-0000000000000000000001',
        name: 'Cuenta A (SIMULADA)',
        email: 'cuenta-a@simulado.invalid',
      },
      // Token SIN validación ninguna: es un double, no un emisor de credenciales.
      accessToken: 'SIMULADO.no-es-un-token-real',
      expires: '2026-12-31T00:00:00.000Z',
      simulacion: { sesionChunked: base ? 0 : trozos.size }, // chunks USADOS (0 si vino la base)
    },
  };
}

/**
 * El contrato que expresionSonda() consume. PURA:
 * ({metodo, cabeceras}, sabor) → {status, cuerpo, sabor}
 */
function clasificarSonda(req, sabor = '403') {
  const auth = String((req.cabeceras && req.cabeceras.authorization) || '');
  const ctype = String((req.cabeceras && req.cabeceras['content-type']) || '');
  if (!/^Bearer\s+\S+/i.test(auth)) {
    return { status: 401, cuerpo: JSON.stringify({ detail: 'Unauthorized - Access token is missing' }), sabor: 'sin-bearer' };
  }
  if (!/application\/json/i.test(ctype)) {
    return { status: 415, cuerpo: JSON.stringify({ detail: 'Unsupported Media Type' }), sabor: 'sin-ct' };
  }
  if (sabor === '403') {
    return {
      status: 403,
      // El marcador que veredictoDe() busca (/unusual activity/i):
      cuerpo: JSON.stringify({ message: 'Unusual activity has been detected from your device. Try again later. (simulado-0000)' }),
      sabor: '403',
    };
  }
  if (sabor === '500') {
    return { status: 500, cuerpo: JSON.stringify({ detail: 'Internal Server Error' }), sabor: '500' };
  }
  return {
    status: 200,
    cuerpo: 'data: {"message": {"status": "creating_conversation", "current_node": "simulado"}}\n\ndata: [DONE]\n\n',
    sabor: '200',
  };
}

function opensslBin() {
  const candidates = [
    process.env.KNK_OPENSSL,
    process.env.OPENSSL_BIN,
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'usr', 'bin', 'openssl.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'usr', 'bin', 'openssl.exe'),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || 'openssl';
}

function asegurarCertificado({ dir = DIR_CERT, renovar = false } = {}) {
  const fKey = path.join(dir, 'sim.key');
  const fCrt = path.join(dir, 'sim.crt');
  if (fs.existsSync(fKey) && fs.existsSync(fCrt) && !renovar) {
    return { key: fs.readFileSync(fKey), cert: fs.readFileSync(fCrt), generado: false };
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    execFileSync(opensslBin(), [
      'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
      '-nodes', '-days', '3650', '-subj', '/CN=chatgpt.com',
      '-addext', 'subjectAltName=DNS:chatgpt.com,DNS:localhost,IP:127.0.0.1',
      '-keyout', fKey, '-out', fCrt,
    ], { stdio: 'pipe', timeout: 30000 });
    return { key: fs.readFileSync(fKey), cert: fs.readFileSync(fCrt), generado: true };
  } catch (e) {
    return { error: `no se pudo generar el certificado del simulador (¿openssl?): ${String(e.message).slice(0, 160)}` };
  }
}

// ── Propiedad del navegador en modo sim (misma cadena que lib/propiedad.js) ─

function pidPadreDe(pid) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").ParentProcessId`],
      { timeout: 15000, windowsHide: true }, (err, stdout) => {
        if (err) return resolve(null);
        const p = parseInt(String(stdout).trim(), 10);
        resolve(Number.isInteger(p) ? p : null);
      });
  });
}

/**
 * El modo sim es el ÚNICO propietario legítimo del perfil openai-poc-sim.
 * Chromium: un perfil vivo es una llave de instancia — si quedó una instancia
 * previa de este perfil (crash, Ctrl-C, timeout), el nuevo lanzamiento DELEGA
 * en ella y muere sin abrir el puerto CDP ('El navegador no levantó CDP').
 * Por eso limpiamos CUALQUIER proceso con este perfil antes de lanzar.
 * El perfil es desechable y exclusivo del modo sim: jamás puede tocar un
 * perfil del usuario. Síncrona a propósito: debe terminar ANTES de lanzar.
 * @returns {number} procesos eliminados (0 si el perfil ya estaba libre)
 */
function asegurarPerfilLibre(perfil) {
  const { execFileSync } = require('child_process');
  const consulta = `$ErrorActionPreference='SilentlyContinue'; ` +
    `Get-CimInstance Win32_Process -Filter "Name='msedge.exe' or Name='chrome.exe'" | ` +
    `Where-Object { $_.CommandLine -like '*${perfil}*' } | ` +
    `Select-Object -ExpandProperty ProcessId`;
  let pids = [];
  try {
    const stdout = execFileSync('powershell', ['-NoProfile', '-Command', consulta], { encoding: 'utf8', timeout: 30000 });
    pids = stdout.split(/\r?\n/).map((s) => parseInt(s.trim(), 10)).filter(Number.isInteger);
  } catch { return 0; } // sin PowerShell o sin procesos: perfil libre
  let n = 0;
  for (const pid of pids) {
    try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'pipe', timeout: 15000 }); n++; }
    catch { /* ya muerto por el /T del padre */ }
  }
  return n;
}
/**
 * ¿El proceso que escucha el puerto CDP es la instancia que ESTE experimento
 * lanzó? Cadena: hijo directo del pid lanzado + `--user-data-dir` del perfil
 * de sim en su línea de comando. Devuelve { nuestro, pid, detalle }.
 */
async function verificarPropiedad({ pidLanzado, pidPuerto, perfil }) {
  if (!Number.isInteger(pidPuerto)) return { nuestro: false, pid: null, detalle: 'sin pid en el puerto' };
  if (pidPuerto === pidLanzado) return { nuestro: true, pid: pidPuerto, detalle: 'pid lanzado === pid del puerto' };
  const padre = await pidPadreDe(pidPuerto);
  if (padre !== pidLanzado) {
    return { nuestro: false, pid: pidPuerto, detalle: `el pid del puerto (${pidPuerto}) no es hijo del lanzado (${pidLanzado})` };
  }
  const cmd = await propiedad.commandLineDe(pidPuerto);
  if (perfil && cmd && !cmd.includes(perfil)) {
    return { nuestro: false, pid: pidPuerto, detalle: `hijo del lanzado pero su cmdline no lleva el perfil de sim (${perfil})` };
  }
  return { nuestro: true, pid: pidPuerto, detalle: `hijo directo del lanzado (${pidLanzado})` + (cmd && cmd.includes('--ignore-certificate-errors') ? ' y lleva la marca de simulación (--ignore-certificate-errors)' : '') };
}

// ── Servidor HTTPS local ───────────────────────────────────────────────────

const PAGINA_HTML = '<!doctype html><meta charset="utf-8"><title>ChatGPT</title>'
  + '<body style="font-family:system-ui;margin:40px">'
  + '<h1>MODO SIMULACIÓN — chatgpt.com local</h1>'
  + '<p>Página servida por <code>lib/navegador-simulado.js</code>. El driver del '
  + 'discriminador lee aquí su sesión y su sonda: <b>0 peticiones al objetivo</b>.</p>';

function recogerCuerpo(req, cb) {
  let cuerpo = '';
  req.on('data', (c) => { cuerpo += c; if (cuerpo.length > 1e6) req.destroy(); });
  req.on('end', () => cb(cuerpo));
  req.on('error', () => cb(''));
}

/**
 * Arranca el simulador en 127.0.0.1 (puertoSim=0 → efímero).
 * Devuelve { puerto, url, hostResolverArgs, cerrar() }.
 */
async function iniciar({ puertoSim = 0, registro = () => {} } = {}) {
  const cert = asegurarCertificado();
  if (cert.error) throw new Error(cert.error);
  const server = https.createServer({ key: cert.key, cert: cert.cert }, (req, res) => {
    recogerCuerpo(req, (cuerpoTexto) => {
      const url = String(req.url || '/').split('?')[0];
      if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
        registro(`[sim] GET ${url} → página`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(PAGINA_HTML);
        return;
      }
      if (req.method === 'GET' && url === '/api/auth/session') {
        const s = analizarSesion(req.headers);
        registro(`[sim] GET /api/auth/session → ${s.status} (${s.cuerpo.accessToken ? 'CON sesión' : 'sin sesión'})`);
        res.writeHead(s.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(s.cuerpo));
        return;
      }
      if (req.method === 'POST' && url === '/backend-api/conversation') {
        const r = clasificarSonda({ metodo: req.method, cabeceras: req.headers, cuerpoTexto }, process.env.SIM_CONV || '403');
        registro(`[sim] POST /backend-api/conversation → ${r.status} (sabor ${r.sabor})`);
        res.writeHead(r.status, { 'Content-Type': r.status === 200 ? 'text/event-stream' : 'application/json' });
        res.end(r.cuerpo);
        return;
      }
      registro(`[sim] ${req.method} ${url} → 404`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ detail: 'Not Found' }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(puertoSim, HOST, resolve);
  });
  const puerto = server.address().port;
  return {
    puerto,
    url: `https://${DOMINIO}/`,
    hostResolverArgs: `MAP ${DOMINIO} ${HOST}:${puerto}, EXCLUDE localhost`,
    cerrar: () => new Promise((r) => server.close(r)),
  };
}

module.exports = {
  HOST, DOMINIO, NOMBRE_COOKIE_SESION, DIR_CERT, RUTA_MARCA,
  analizarSesion, clasificarSonda, asegurarCertificado, asegurarPerfilLibre, pidPadreDe, verificarPropiedad,
  iniciar,
};
