'use strict';

// ============================================================================
// tor.js — Tor Network Manager (knk-suite v4.1)
//
// QUÉ HACE
//   * arranca y para un Tor propio (tor.exe del «expert bundle») con DataDirectory
//     y logs dentro de ~/.knk-suite/tor;
//   * habla SOCKS5 de verdad con 127.0.0.1:9050 para sacar tráfico por Tor;
//   * habla el protocolo de control (puerto 9051) autenticándose con la cookie
//     del DataDirectory: nueva identidad, fase de bootstrap, IP de salida;
//   * detecta un Tor que ya esté corriendo (Tor Browser usa 9150/9151) y se
//     apoya en él en vez de pelearse por el puerto;
//   * instala el «tor expert bundle» resolviendo la última versión publicada.
//
// QUÉ ESTABA MAL (y por qué no conectaba nunca)
//   1. `fetchViaTor` enviaba `CONNECT host:443` por HTTP a un puerto SOCKS5: el
//      servidor no entiende texto, así que TODA consulta fallaba.
//   2. `sendControlCommand` resolvía solo al cerrarse el socket, y el puerto de
//      control no cierra: toda orden terminaba en «timeout» a los 5 s.
//   3. La URL del bundle estaba fijada a una versión ya inexistente (404) y la
//      extracción buscaba un .exe suelto en la raíz, cuando el bundle trae
//      `tor/tor.exe` en subcarpeta.
//   4. El torrc escribía rutas sin comillas y con `Log … file`, que en Windows
//      puede no abrirse y deja a Tor sin arrancar (visto en vivo: Tor rechaza
//      rutas tipo `/tmp/...`).
//   5. El estado solo miraba el proceso hijo: un Tor externo salía como «parado».
//
// LÍMITES
//   * `routeAllThroughTor` toca el proxy del sistema (HKCU) y guarda el valor
//     anterior para poder deshacerlo; en Linux/macOS no aplica.
//   * El SOCKS escucha solo en loopback: Tor no abre nada hacia fuera.
// ============================================================================

const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const net = require('net');
const zlib = require('zlib');

const IS_WINDOWS = process.platform === 'win32';

const TOR_DIR = process.env.KNK_TOR_DIR || path.join(os.homedir(), '.knk-suite', 'tor');
const TORRC_PATH = path.join(TOR_DIR, 'torrc');
const TOR_DATA_DIR = path.join(TOR_DIR, 'data');
const TOR_LOG_PATH = path.join(TOR_DIR, 'tor.log');
const BUNDLE_DIR = path.join(TOR_DIR, 'bundle');
const PROXY_BACKUP_PATH = path.join(TOR_DIR, 'system-proxy-backup.json');
const DEFAULT_SOCKS_PORT = Number(process.env.KNK_TOR_SOCKS_PORT) || 9050;
const DEFAULT_CONTROL_PORT = Number(process.env.KNK_TOR_CONTROL_PORT) || 9051;
// Tor Browser arranca su propio Tor en 9150/9151: si está abierto, se reutiliza.
const EXTERNAL_PORT_PAIRS = [[9150, 9151], [9152, 9153]];

const DIST_LISTING = 'https://dist.torproject.org/torbrowser/';
// Si el listado no se puede leer, se prueban estas versiones conocidas.
const BUNDLE_FALLBACK_VERSIONS = ['15.0.22', '14.5.9'];
const MAX_BUNDLE_BYTES = 120 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_LOG_BYTES = 200 * 1024;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; rv:115.0) Gecko/20100101 Firefox/115.0';

let torProcess = null;
let managedSocksPort = null;
let managedControlPort = null;
let circuitHistory = [];
let startTime = null;
let currentExitIP = null;
let currentCountry = null;
let ipCheckedAt = 0;
let logBuffer = '';
let lastError = null;
let externalSocks = null;
let externalControl = null;

// ── utilidades ────────────────────────────────────────────────────────────

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Rutas con barras normales: Tor en Windows rechaza `/tmp/x` y le estorban las `\`. */
function torPath(p) {
  return String(p).replace(/\\/g, '/');
}

/** Nombre corto (8.3) de una ruta de Windows, para cuando lleva espacios. */
function windowsShortPath(target) {
  if (!IS_WINDOWS) return null;
  try {
    const out = execFileSync('cmd', ['/c', `for %I in ("${target}") do @echo %~sI`], { encoding: 'utf8', timeout: 5000 });
    const short = String(out).trim().split(/\r?\n/)[0].trim();
    return short && !short.includes(' ') ? torPath(short) : null;
  } catch { return null; }
}

/**
 * Ruta para el torrc. SIN comillas: Tor no las quita y las toma como parte
 * del nombre («Failed to init Log options»). A cambio, un espacio en la ruta
 * rompería la línea, así que se resuelve con el nombre corto de Windows o se
 * explica el problema en vez de arrancar Tor para que falle solo.
 */
function confPath(p, what = 'ruta') {
  const clean = torPath(p);
  if (!clean.includes(' ')) return clean;
  const short = windowsShortPath(clean);
  if (short) return short;
  throw new Error(`Tor no admite comillas en el torrc y la ${what} lleva un espacio: «${clean}». Mueve ~/.knk-suite a una ruta sin espacios o define la variable KNK_TOR_DIR.`);
}

function ensureDirectories() {
  for (const dir of [TOR_DIR, TOR_DATA_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function appendLog(text) {
  logBuffer += text;
  if (logBuffer.length > MAX_LOG_BYTES) logBuffer = logBuffer.slice(-MAX_LOG_BYTES);
  try { fs.appendFileSync(TOR_LOG_PATH, text, 'utf8'); } catch { /* el log en memoria sigue */ }
}

function lastLogLines(count = 6) {
  return logBuffer.trim().split(/\r?\n/).slice(-count).join(' | ');
}

function portAcceptsConnections(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(900);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

// ── SOCKS5 (RFC 1928) ─────────────────────────────────────────────────────
// El puerto 9050 NO es un proxy HTTP: hay que hacer el saludo binario. Se usa
// ATYP=dominio para que resuelva Tor (sin fuga de DNS local) y así funcionan
// también los .onion.

const SOCKS_ERRORS = {
  0x01: 'fallo general del proxy',
  0x02: 'conexión no permitida por las reglas',
  0x03: 'red inalcanzable',
  0x04: 'host inalcanzable',
  0x05: 'conexión rechazada por el destino',
  0x06: 'TTL expirado',
  0x07: 'comando no soportado',
  0x08: 'tipo de dirección no soportado',
};

/**
 * Abre un socket TCP al destino a través del proxy SOCKS5.
 * @returns {Promise<net.Socket>} socket ya conectado al destino.
 */
function socks5Connect({ host, port, proxyHost = '127.0.0.1', proxyPort = DEFAULT_SOCKS_PORT, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!host) return reject(new Error('SOCKS5: falta el host de destino'));
    const targetPort = Number(port) || 443;

    const socket = net.connect({ host: proxyHost, port: proxyPort });
    let settled = false;
    let pending = Buffer.alloc(0);
    let phase = 'greeting';

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners('error');
      socket.removeAllListeners('close');
      if (err) { socket.destroy(); return reject(err); }
      socket.removeAllListeners('data');
      const extra = pending;
      pending = Buffer.alloc(0);
      if (extra.length) {
        // El destino habló antes que nosotros (SSH, SMTP, MySQL, TLS…): esos
        // bytes hay que devolvérselos al consumidor. En modo flowing `unshift`
        // los tira, así que se pausa primero; y como un socket pausado ya no se
        // reanuda solo al enganchar un oyente, se reanuda en cuanto el
        // consumidor escuche, con una red de seguridad por si no escucha nunca.
        socket.pause();
        socket.unshift(extra);
        const resumeForConsumer = () => { if (!socket.destroyed) socket.resume(); };
        const safety = setTimeout(resumeForConsumer, 500);
        if (safety.unref) safety.unref();
        const onNewListener = (event) => {
          if (event !== 'data') return;
          socket.removeListener('newListener', onNewListener);
          clearTimeout(safety);
          setImmediate(resumeForConsumer);
        };
        socket.on('newListener', onNewListener);
      }
      resolve(value || socket);
    };

    const timer = setTimeout(
      () => finish(new Error(`SOCKS5: ${proxyHost}:${proxyPort} no respondió en ${timeoutMs} ms`)),
      timeoutMs
    );

    socket.once('error', (e) => finish(new Error(`SOCKS5: ${e.message}`)));
    socket.once('close', () => { if (!settled) finish(new Error('SOCKS5: la conexión se cerró antes de completar el saludo')); });

    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      try {
        if (phase === 'greeting') {
          if (pending.length < 2) return;
          if (pending[0] !== 0x05) {
            return finish(new Error(`SOCKS5: versión inesperada (${pending[0]}); ¿esto es un proxy SOCKS?`));
          }
          if (pending[1] !== 0x00) {
            return finish(new Error(pending[1] === 0xff
              ? 'SOCKS5: el proxy exige autenticación que no está configurada'
              : `SOCKS5: método de autenticación no soportado (${pending[1]})`));
          }
          pending = pending.slice(2);
          phase = 'reply';

          const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
          const name = Buffer.from(host, 'utf8');
          const tail = Buffer.from([targetPort >> 8, targetPort & 0xff]);
          socket.write(isIpv4
            ? Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x01]), Buffer.from(host.split('.').map(Number)), tail])
            : Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, name.length]), name, tail]));
          return;
        }

        if (pending.length < 5) return;
        const [ver, code, , atyp] = pending;
        if (ver !== 0x05) return finish(new Error('SOCKS5: respuesta con versión inválida'));
        const addrLen = atyp === 0x01 ? 4 : atyp === 0x04 ? 16 : atyp === 0x03 ? pending[4] + 1 : 0;
        if (!addrLen) return finish(new Error(`SOCKS5: tipo de dirección desconocido (${atyp})`));
        const total = 4 + addrLen + 2;
        if (pending.length < total) return;
        pending = pending.slice(total);
        if (code !== 0x00) {
          return finish(new Error(`SOCKS5: rechazado ${host}:${targetPort} — ${SOCKS_ERRORS[code] || `código ${code}`}`));
        }
        finish(null, socket);
      } catch (e) {
        finish(new Error(`SOCKS5: respuesta ilegible (${e.message})`));
      }
    });

    // 1) saludo: versión 5, un método, sin autenticación
    socket.write(Buffer.from([0x05, 0x01, 0x00]));
  });
}

/**
 * Petición HTTP(S) a través de Tor (SOCKS5). En .onion se relaja la verificación
 * TLS porque los servicios ocultos usan certificados autofirmados; el cifrado
 * real lo aporta el circuito de Tor.
 */
async function fetchViaTor(url, opts = {}) {
  const {
    method = 'GET', headers = {}, body = null, timeoutMs = 25000,
    maxBytes = MAX_RESPONSE_BYTES, proxyPort = null, insecure = null,
  } = opts;

  const u = new URL(url);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`Protocolo no soportado: ${u.protocol}`);
  const isHttps = u.protocol === 'https:';
  const isOnion = /\.onion$/i.test(u.hostname);

  const socket = await socks5Connect({
    host: u.hostname,
    port: Number(u.port) || (isHttps ? 443 : 80),
    proxyPort: proxyPort || activeSocksPort(),
    timeoutMs,
  });

  return new Promise((resolve, reject) => {
    const mod = isHttps ? https : http;
    const req = mod.request({
      method,
      path: `${u.pathname}${u.search}`,
      socket,
      agent: false,
      servername: u.hostname,
      rejectUnauthorized: insecure === null ? !isOnion : !insecure,
      headers: { Host: u.host, 'User-Agent': USER_AGENT, 'Accept-Encoding': 'identity', ...headers },
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) { req.destroy(new Error(`respuesta mayor de ${maxBytes} bytes`)); return; }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const encoding = String(res.headers['content-encoding'] || '').toLowerCase();
        let raw = buffer;
        try {
          if (encoding === 'gzip') raw = zlib.gunzipSync(buffer);
          else if (encoding === 'deflate') raw = zlib.inflateSync(buffer);
          else if (encoding === 'br') raw = zlib.brotliDecompressSync(buffer);
        } catch { raw = buffer; }
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          statusCode: res.statusCode,
          headers: res.headers,
          body: raw.toString('utf8'),
          bytes: raw.length,
          onion: isOnion,
          proxy: activeSocksPort(),
        });
      });
    });

    req.setTimeout(timeoutMs, () => req.destroy(new Error(`sin respuesta en ${timeoutMs} ms`)));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── instalación (tor expert bundle) ───────────────────────────────────────

function getText(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': USER_AGENT }, timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(getText(new URL(res.headers.location, url).toString(), timeoutMs));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} en ${url}`)); }
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve(text));
    });
    req.on('timeout', () => req.destroy(new Error('tiempo de espera agotado')));
    req.on('error', reject);
  });
}

/** Versiones estables publicadas en el listado, de la más nueva a la más vieja. */
function stableVersionsFromListing(html) {
  return [...String(html || '').matchAll(/href="(\d+\.\d+(?:\.\d+)?)\//g)]
    .map((m) => m[1])
    .filter((v) => !/[a-z]/i.test(v))
    .filter((v, i, all) => all.indexOf(v) === i)
    .sort((a, b) => {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
      return 0;
    });
}

/** Última versión estable del listado (o null si el HTML no trae ninguna). */
function pickLatestStableVersion(html) {
  const versions = stableVersionsFromListing(html);
  return versions.length ? versions[0] : null;
}

/** URL del expert bundle de Windows para una versión concreta. */
function expertBundleUrlFor(version) {
  return DIST_LISTING + version + '/tor-expert-bundle-windows-x86_64-' + version + '.tar.gz';
}

/**
 * Resuelve la última versión publicada consultando el listado oficial. La
 * versión NO puede ir fijada en el código: la que había (13.5.9) desapareció de
 * los mirrors y la instalación devolvía 404 para siempre.
 */
async function resolveExpertBundleUrl() {
  try {
    const version = pickLatestStableVersion(await getText(DIST_LISTING));
    if (version) return { version, url: expertBundleUrlFor(version), resolvedFrom: 'listado oficial' };
  } catch (err) {
    // Sin red o listado caído: se usa la lista local de abajo.
  }

  for (const version of BUNDLE_FALLBACK_VERSIONS) {
    return { version, url: expertBundleUrlFor(version), resolvedFrom: 'lista local' };
  }
  return { version: null, url: null, resolvedFrom: 'ninguna' };
}

/** Descarga a disco siguiendo redirecciones y con tope de tamaño. */
function download(url, dest, { timeoutMs = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    const go = (current, depth = 0) => {
      if (depth > 5) return reject(new Error('demasiadas redirecciones al descargar el bundle'));
      const req = https.get(current, { headers: { 'User-Agent': USER_AGENT }, timeout: timeoutMs }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return go(new URL(res.headers.location, current).toString(), depth + 1);
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} al descargar ${current}`)); }
        const declared = Number(res.headers['content-length'] || 0);
        if (declared && declared > MAX_BUNDLE_BYTES) return reject(new Error('el bundle excede el tamaño máximo permitido'));
        const file = fs.createWriteStream(dest);
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BUNDLE_BYTES) {
            req.destroy();
            file.destroy();
            fs.rmSync(dest, { force: true });
            reject(new Error('el bundle excede el tamaño máximo permitido'));
          }
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve({ bytes: size })));
        file.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('tiempo de espera agotado al descargar el bundle')));
      req.on('error', reject);
    };
    go(url);
  });
}

/** Busca tor(.exe): bundle extraído, instalación manual o PATH del sistema. */
function findTorBinary() {
  const maxDepth = 4;
  const walk = (dir, depth) => {
    if (depth > maxDepth || !fs.existsSync(dir)) return null;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const entry of entries) {
      if (entry.isFile() && /^tor(\.exe)?$/i.test(entry.name)) return path.join(dir, entry.name);
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const found = walk(path.join(dir, entry.name), depth + 1);
      if (found) return found;
    }
    return null;
  };

  const local = walk(TOR_DIR, 0);
  if (local) return local;

  for (const name of ['tor', 'tor.exe']) {
    try {
      const out = execFileSync(IS_WINDOWS ? 'where' : 'which', [name], { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (out.length) return out[0];
    } catch { /* no está en el PATH */ }
  }
  return null;
}

function torVersion(binaryPath) {
  try {
    const out = execFileSync(binaryPath, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).toString();
    const m = out.match(/Tor version (\S+)/i);
    return m ? m[1] : out.trim().split(/\r?\n/)[0];
  } catch {
    return null;
  }
}

/**
 * Garantiza que hay un tor utilizable. En Windows descarga el expert bundle
 * oficial (la versión la resuelve el listado de dist.torproject.org), lo extrae
 * en <tor>/bundle y valida el binario; en Linux/macOS usa el tor del sistema.
 */
/** Candidatos para descomprimir el bundle, del más fiable al más genérico. */
function tarExtractors(tarPath, destDir) {
  const list = [];
  if (IS_WINDOWS) {
    // bsdtar de Windows entiende `C:\...`; el tar de MSYS/Git Bash interpreta
    // `C:` como un host remoto («Cannot connect to C») y falla siempre.
    const sysTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    if (fs.existsSync(sysTar)) list.push({ bin: sysTar, args: ['-xzf', tarPath, '-C', destDir], cwd: undefined });
  }
  // Plan B: el tar del PATH con rutas RELATIVAS, que es el único formato sin
  // ambigüedad cuando hay una unidad de Windows de por medio.
  const base = path.dirname(tarPath);
  const relative = path.relative(base, destDir) || '.';
  list.push({ bin: 'tar', args: ['-xzf', path.basename(tarPath), '-C', relative], cwd: base });
  return list;
}

function extractTarGz(tarPath, destDir) {
  const errors = [];
  for (const candidate of tarExtractors(tarPath, destDir)) {
    try {
      execFileSync(candidate.bin, candidate.args, { stdio: 'pipe', timeout: 240000, cwd: candidate.cwd });
      return { ok: true, tool: candidate.bin };
    } catch (e) {
      const detalle = String(e.message).split('\n').slice(0, 2).join(' ');
      errors.push(candidate.bin + ': ' + detalle);
    }
  }
  throw new Error('no se pudo descomprimir el bundle (' + errors.join(' · ') + ')');
}

async function ensureTorInstalled({ force = false, onProgress = null } = {}) {
  ensureDirectories();

  if (!force) {
    const existing = findTorBinary();
    if (existing) return { ok: true, alreadyPresent: true, path: existing, version: torVersion(existing) };
  }

  if (!IS_WINDOWS) {
    return {
      ok: false,
      error: 'La instalación automática solo cubre Windows. En Linux/macOS instala el paquete «tor» y arranca el servicio: el puerto 9050 se detecta solo.',
    };
  }

  const resolved = await resolveExpertBundleUrl();
  if (onProgress) onProgress({ phase: 'resolved', ...resolved });

  const tarPath = path.join(TOR_DIR, `tor-expert-bundle-${resolved.version}.tar.gz`);
  try {
    // Se parte siempre de cero: una extracción a medias dejaría un bundle con
    // ficheros de dos versiones y un tor.exe que no arranca.
    fs.rmSync(BUNDLE_DIR, { recursive: true, force: true });
    fs.mkdirSync(BUNDLE_DIR, { recursive: true });
    const dl = await download(resolved.url, tarPath);
    if (onProgress) onProgress({ phase: 'downloaded', bytes: dl.bytes, url: resolved.url });

    const extraction = extractTarGz(tarPath, BUNDLE_DIR);
    fs.rmSync(tarPath, { force: true });
    if (onProgress) onProgress({ phase: 'extracted', dir: BUNDLE_DIR });

    const binary = findTorBinary();
    const version = binary ? torVersion(binary) : null;
    if (!binary || !version) {
      return { ok: false, error: 'El bundle se descargó pero no se encontró un tor.exe ejecutable dentro.' };
    }
    return {
      ok: true,
      path: binary,
      version,
      bundleDir: BUNDLE_DIR,
      bytes: dl.bytes,
      url: resolved.url,
      resolvedFrom: resolved.resolvedFrom,
      extractedWith: extraction.tool,
    };
  } catch (e) {
    fs.rmSync(tarPath, { force: true });
    return { ok: false, error: `Instalación fallida: ${e.message}` };
  }
}

// ── configuración torrc ───────────────────────────────────────────────────

function geoIpFiles() {
  for (const base of [BUNDLE_DIR, TOR_DIR]) {
    const geoip = path.join(base, 'data', 'geoip');
    const geoip6 = path.join(base, 'data', 'geoip6');
    if (fs.existsSync(geoip)) return { geoip, geoip6: fs.existsSync(geoip6) ? geoip6 : null };
  }
  return null;
}

/**
 * torrc. Todas las rutas van entre comillas y en formato nativo: Tor en Windows
 * no acepta rutas tipo `/tmp/...`, y una ruta con espacios sin comillas rompe el
 * fichero entero.
 */
function generateTorrc({ socksPort = DEFAULT_SOCKS_PORT, controlPort = DEFAULT_CONTROL_PORT, exitNodes = null } = {}) {
  ensureDirectories();
  const countries = exitNodes || ['es', 'de', 'fr', 'nl', 'se', 'ch', 'no', 'fi', 'pt', 'it', 'at', 'be', 'dk', 'ie', 'jp', 'au', 'br', 'ca', 'mx', 'ar'];
  const lines = [
    '# Generado por knk-suite (backend/lib/tor.js): cualquier cambio se reescribe.',
    `SocksPort ${socksPort}`,
    `ControlPort ${controlPort}`,
    'CookieAuthentication 1',
    `DataDirectory ${confPath(TOR_DATA_DIR, 'carpeta de datos')}`,
    'Log notice stdout',
    'AvoidDiskWrites 1',
    'CircuitStreamTimeout 30',
    `ExitNodes ${countries.map((c) => `{${c}}`).join(',')}`,
    'StrictNodes 0',
  ];

  const geo = geoIpFiles();
  if (geo) {
    lines.push(`GeoIPFile ${confPath(geo.geoip, 'ruta de GeoIP')}`);
    if (geo.geoip6) lines.push(`GeoIPv6File ${confPath(geo.geoip6, 'ruta de GeoIPv6')}`);
  }
  // Un log a fichero además de stdout: si el proceso se va, queda rastro.
  // Se crea el fichero antes: así el nombre corto de Windows se puede resolver
  // y Tor no tiene que inventarse la carpeta.
  try { if (!fs.existsSync(TOR_LOG_PATH)) fs.appendFileSync(TOR_LOG_PATH, ''); } catch { /* Tor lo intentará igual */ }
  lines.push(`Log notice file ${confPath(TOR_LOG_PATH, 'ruta del log')}`);

  fs.writeFileSync(TORRC_PATH, lines.join('\n') + '\n', 'utf8');
  return { ok: true, path: TORRC_PATH, socksPort, controlPort, content: lines.join('\n') };
}

// ── protocolo de control (puerto 9051) ────────────────────────────────────

/** Cookie de autenticación que Tor escribe en el DataDirectory. */
function controlCookie() {
  const cookiePath = path.join(TOR_DATA_DIR, 'control_auth_cookie');
  if (!fs.existsSync(cookiePath)) return null;
  try { return fs.readFileSync(cookiePath).toString('hex'); } catch { return null; }
}

/**
 * Envía una orden al puerto de control y resuelve con la respuesta final.
 * Resuelve en cuanto llega una línea «2xx » (las «2xx-» son continuación) y
 * rechaza con el texto de un «4xx/5xx». NO se espera al cierre del socket: el
 * puerto de control mantiene la conexión abierta, y esperar su cierre fue el
 * motivo de que toda orden acabase en timeouts.
 */
function controlCommand(command, { port = null, timeoutMs = 10000, authenticate = true, cookie = null } = {}) {
  const controlPort = port || activeControlPort();

  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port: controlPort });
    let settled = false;
    let buffer = '';
    let phase = authenticate ? 'auth' : 'command';
    const received = [];

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.write('QUIT\r\n'); } catch { /* puede estar ya cerrado */ }
      socket.end();
      socket.destroy();
      if (err) reject(err); else resolve(value);
    };

    const timer = setTimeout(
      () => finish(new Error(`el puerto de control (${controlPort}) no respondió en ${timeoutMs} ms`)),
      timeoutMs
    );

    socket.once('error', (e) => finish(new Error(`puerto de control ${controlPort}: ${e.message}`)));
    socket.once('close', () => { if (!settled) finish(new Error(`el puerto de control ${controlPort} cerró sin responder`)); });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        received.push(line);
        const match = line.match(/^(\d{3})([ -])/);
        if (!match) continue;
        const code = Number(match[1]);
        if (code >= 400) {
          return finish(new Error(line.replace(/^\d{3}[ -]/, '') || `el control devolvió ${code}`));
        }
        if (match[2] === '-') continue; // respuesta multilínea: aún no es la final

        if (phase === 'auth') {
          phase = 'command';
          received.length = 0;
          socket.write(command + '\r\n');
          continue;
        }
        return finish(null, received.join('\n'));
      }
    });

    socket.once('connect', () => {
      if (authenticate) {
        const auth = cookie || controlCookie();
        socket.write(auth ? `AUTHENTICATE ${auth}\r\n` : 'AUTHENTICATE\r\n');
      } else {
        socket.write(command + '\r\n');
      }
    });
  });
}

async function newIdentity() {
  const tunnel = await controlTunnel();
  if (!tunnel.ok) return { ok: false, error: tunnel.error };
  try {
    await controlCommand('SIGNAL NEWNYM', { port: tunnel.port, cookie: tunnel.cookie });
  } catch (e) {
    const ajeno = tunnel.external
      ? ' — el Tor en marcha no lo lanzó KNK y su cookie de control no es nuestra; cámbiala desde su propia aplicación'
      : '';
    return { ok: false, error: `no se pudo pedir una identidad nueva: ${e.message}${ajeno}` };
  }
  // Tor tarda un momento en marcar los circuitos viejos como sucios.
  await delay(1200);
  const fresh = await getCurrentIP({ cacheMs: 0, timeoutMs: 30000 });
  if (fresh.ip) {
    currentExitIP = fresh.ip;
    currentCountry = fresh.country || currentCountry;
    ipCheckedAt = Date.now();
    circuitHistory.push({ timestamp: ipCheckedAt, ip: currentExitIP, country: currentCountry || 'unknown' });
    if (circuitHistory.length > 100) circuitHistory = circuitHistory.slice(-100);
  }
  return { ok: !!fresh.ip, newIP: fresh.ip || null, country: fresh.country || null, isTor: fresh.isTor, error: fresh.error || null };
}

/**
 * Puerto de control al que se puede pedir algo, con la cookie que toca. Si el
 * Tor en marcha no lo expone, se explica en vez de fallar con un error opaco.
 */
async function controlTunnel() {
  if (torProcess && !torProcess.killed) {
    return { ok: true, port: managedControlPort, cookie: controlCookie(), external: false };
  }
  const external = await detectExternal();
  if (!external) return { ok: false, error: 'Tor no está en marcha' };
  if (!external.control) {
    return {
      ok: false,
      error: `El Tor del puerto ${external.socks} no expone puerto de control (Tor Browser no lo abre), así que KNK no puede pedirle una identidad nueva. Arranca el Tor de KNK para poder rotarla.`,
    };
  }
  return { ok: true, port: external.control, cookie: controlCookie(), external: true };
}

/** Fase de bootstrap real, preguntada al puerto de control. */
async function bootstrapPhase() {
  const tunnel = await controlTunnel();
  if (!tunnel.ok) return null;
  try {
    const reply = await controlCommand('GETINFO status/bootstrap-phase', { port: tunnel.port, cookie: tunnel.cookie });
    const progress = reply.match(/PROGRESS=(\d+)/);
    const summary = reply.match(/SUMMARY=([^\r\n]+)/);
    return {
      progress: progress ? Number(progress[1]) : null,
      summary: summary ? summary[1].trim().replace(/^"|"$/g, '') : null,
    };
  } catch {
    return null;
  }
}

// ── estado ────────────────────────────────────────────────────────────────

/** Puerto SOCKS en uso: el del proceso propio o el de un Tor externo detectado. */
function activeSocksPort() {
  return managedSocksPort || externalSocks || DEFAULT_SOCKS_PORT;
}

function activeControlPort() {
  return managedControlPort || externalControl || DEFAULT_CONTROL_PORT;
}

/** Busca un Tor ajeno (Tor Browser, servicio del sistema) que podamos reutilizar. */
async function detectExternal() {
  const candidates = [[DEFAULT_SOCKS_PORT, DEFAULT_CONTROL_PORT], ...EXTERNAL_PORT_PAIRS];
  for (const [socks, control] of candidates) {
    if (managedSocksPort === socks) continue;
    if (!(await portAcceptsConnections(socks))) continue;
    // El SOCKS dice que hay un Tor, pero el puerto de control no siempre está
    // abierto (Tor Browser no lo abre): se comprueba y, si no responde, se
    // informa de null en vez de suponer que está en el puerto de al lado.
    const controlOk = await portAcceptsConnections(control);
    return { socks, control: controlOk ? control : null };
  }
  return null;
}

async function isRunning() {
  if (torProcess && !torProcess.killed) return true;
  const external = await detectExternal();
  if (external) {
    externalSocks = external.socks;
    externalControl = external.control;
    return true;
  }
  externalSocks = null;
  externalControl = null;
  return false;
}

/**
 * Estado completo para la UI. La IP de salida se cachea (60 s por defecto) para
 * que el sondeo del panel no encadene consultas por Tor.
 */
async function getStatus({ ipMaxAgeMs = 60000, timeoutMs = 15000 } = {}) {
  const binary = findTorBinary();
  const managed = !!(torProcess && !torProcess.killed);
  let external = null;

  if (!managed) {
    external = await detectExternal();
    externalSocks = external ? external.socks : null;
    externalControl = external ? external.control : null;
  }

  const running = managed || !!external;

  if (running && (!currentExitIP || Date.now() - ipCheckedAt > ipMaxAgeMs)) {
    const check = await getCurrentIP({ cacheMs: 0, timeoutMs });
    if (check.ip) {
      currentExitIP = check.ip;
      currentCountry = check.country || currentCountry;
      ipCheckedAt = Date.now();
      circuitHistory.push({ timestamp: ipCheckedAt, ip: currentExitIP, country: currentCountry || 'unknown' });
      if (circuitHistory.length > 100) circuitHistory = circuitHistory.slice(-100);
    }
  }

  let fileLog = '';
  try { fileLog = fs.existsSync(TOR_LOG_PATH) ? fs.readFileSync(TOR_LOG_PATH, 'utf8') : ''; } catch { fileLog = ''; }
  // Una IP de salida obtenida por el SOCKS es prueba suficiente de que el Tor
  // ya está en pie, aunque el log sea de un Tor ajeno y no lo veamos.
  const bootstrapped = /Bootstrapped 100%/.test(logBuffer) || /Bootstrapped 100%/.test(fileLog)
    || (running && !!currentExitIP);

  return {
    ok: true,
    installed: !!binary,
    torBinary: binary || null,
    version: binary ? torVersion(binary) : null,
    running,
    managed,
    external: !!external,
    pid: managed ? torProcess.pid : null,
    socksPort: running ? activeSocksPort() : null,
    controlPort: running ? (managed ? managedControlPort : externalControl) : null,
    bootstrapped,
    ip: running ? currentExitIP : null,
    country: running ? currentCountry : null,
    ipCheckedAt: ipCheckedAt || null,
    uptime: managed && startTime ? Date.now() - startTime : 0,
    dataDir: TOR_DATA_DIR,
    torrc: TORRC_PATH,
    logPath: TOR_LOG_PATH,
    lastError,
    note: external
      ? `Se reutiliza un Tor ya en marcha en el puerto ${external.socks} (no lo gestiona KNK).`
        + (external.control ? '' : ' No expone puerto de control, así que no se puede rotar la identidad desde aquí.')
      : null,
  };
}

// ── arranque y parada ─────────────────────────────────────────────────────

function waitForBootstrap({ timeoutMs = 90000, intervalMs = 700 } = {}) {
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = setInterval(() => {
      if (/Bootstrapped 100%/.test(logBuffer)) { clearInterval(tick); return resolve({ ok: true }); }
      const fatal = logBuffer.match(/\[err\][^\n]*/g);
      if (fatal) { clearInterval(tick); return resolve({ ok: false, error: fatal[fatal.length - 1].trim() }); }
      if (Date.now() - started > timeoutMs) {
        clearInterval(tick);
        return resolve({ ok: false, error: `no completó el bootstrap en ${Math.round(timeoutMs / 1000)} s` });
      }
    }, intervalMs);
  });
}

/**
 * Arranca Tor. Si ya hay uno corriendo (propio o de Tor Browser) no levanta un
 * segundo proceso: informa del que hay y lo reutiliza.
 */
async function startTor({ socksPort = DEFAULT_SOCKS_PORT, controlPort = DEFAULT_CONTROL_PORT, exitNodes = null, waitMs = 90000 } = {}) {
  ensureDirectories();
  lastError = null;

  if (torProcess && !torProcess.killed) {
    return {
      ok: true, alreadyRunning: true, managed: true, pid: torProcess.pid,
      socksPort: managedSocksPort, controlPort: managedControlPort,
      bootstrapped: /Bootstrapped 100%/.test(logBuffer),
    };
  }

  const external = await detectExternal();
  if (external) {
    externalSocks = external.socks;
    externalControl = external.control;
    return {
      ok: true,
      alreadyRunning: true,
      external: true,
      socksPort: external.socks,
      controlPort: external.control,
      note: `Ya hay un Tor escuchando en ${external.socks}; se reutiliza en lugar de abrir otro.`,
    };
  }

  const binary = findTorBinary();
  if (!binary) {
    const error = 'Tor no está instalado en ~/.knk-suite/tor';
    lastError = error;
    return { ok: false, error, needsInstall: true, platform: process.platform };
  }

  generateTorrc({ socksPort, controlPort, exitNodes });
  logBuffer = '';
  try { fs.writeFileSync(TOR_LOG_PATH, '', 'utf8'); } catch { /* el log en fichero es opcional */ }

  torProcess = spawn(binary, ['-f', TORRC_PATH], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  managedSocksPort = socksPort;
  managedControlPort = controlPort;
  startTime = Date.now();

  torProcess.stdout.on('data', (chunk) => appendLog(chunk.toString('utf8')));
  torProcess.stderr.on('data', (chunk) => appendLog(chunk.toString('utf8')));
  torProcess.on('error', (err) => {
    lastError = `no se pudo lanzar Tor: ${err.message}`;
    torProcess = null; managedSocksPort = null; managedControlPort = null; startTime = null;
  });
  torProcess.on('exit', (code) => {
    if (code !== 0 && !/Bootstrapped 100%/.test(logBuffer)) lastError = `Tor terminó con código ${code}: ${lastLogLines()}`;
    torProcess = null;
    managedSocksPort = null;
    managedControlPort = null;
    startTime = null;
  });

  const boot = await waitForBootstrap({ timeoutMs: waitMs });
  if (!boot.ok) {
    const detail = lastLogLines(4);
    if (torProcess) { try { torProcess.kill(); } catch { /* ya no está */ } }
    torProcess = null;
    managedSocksPort = null;
    managedControlPort = null;
    startTime = null;
    lastError = boot.error;
    return { ok: false, error: `Tor no arrancó: ${boot.error}`, detail };
  }

  const ip = await getCurrentIP({ cacheMs: 0, timeoutMs: 20000 });
  if (ip.ip) {
    currentExitIP = ip.ip;
    currentCountry = ip.country || null;
    ipCheckedAt = Date.now();
    circuitHistory.push({ timestamp: ipCheckedAt, ip: ip.ip, country: currentCountry || 'unknown' });
  }

  return {
    ok: true,
    pid: torProcess ? torProcess.pid : null,
    socksPort,
    controlPort,
    bootstrapped: true,
    ip: currentExitIP,
    country: currentCountry,
    version: torVersion(binary),
    ipError: ip.ip ? null : ip.error,
  };
}

async function stopTor() {
  if (!torProcess) {
    const external = await detectExternal();
    if (external) {
      return { ok: false, error: `El Tor del puerto ${external.socks} no lo ha lanzado KNK: ciérralo desde su propia aplicación.` };
    }
    return { ok: true, message: 'Tor no estaba en marcha' };
  }
  const pid = torProcess.pid;
  try { torProcess.kill(); } catch { /* puede haber muerto ya */ }
  torProcess = null;
  managedSocksPort = null;
  managedControlPort = null;
  startTime = null;
  currentExitIP = null;
  currentCountry = null;
  ipCheckedAt = 0;
  return { ok: true, pid };
}

// ── IP de salida y prueba de conexión ─────────────────────────────────────

async function getCurrentIP({ cacheMs = 30000, timeoutMs = 20000 } = {}) {
  if (cacheMs && currentExitIP && Date.now() - ipCheckedAt < cacheMs) {
    return { ip: currentExitIP, country: currentCountry, isTor: true, cached: true };
  }
  if (!(await isRunning())) {
    return { ip: null, country: null, isTor: false, error: 'Tor no está en marcha' };
  }

  const attempts = [
    {
      url: 'https://check.torproject.org/api/ip',
      parse: (body) => { const d = JSON.parse(body); return { ip: d.IP, country: d.Country || null, isTor: d.IsTor === true }; },
    },
    { url: 'https://api.ipify.org?format=json', parse: (body) => ({ ip: JSON.parse(body).ip, country: null, isTor: null }) },
    {
      url: 'http://check.torproject.org/api/ip',
      parse: (body) => { const d = JSON.parse(body); return { ip: d.IP, country: d.Country || null, isTor: d.IsTor === true }; },
    },
  ];

  const errors = [];
  for (const attempt of attempts) {
    try {
      const res = await fetchViaTor(attempt.url, { timeoutMs });
      const parsed = attempt.parse(res.body);
      currentExitIP = parsed.ip || null;
      currentCountry = parsed.country || currentCountry;
      ipCheckedAt = Date.now();
      return { ...parsed, source: attempt.url, proxy: activeSocksPort() };
    } catch (e) {
      errors.push(`${new URL(attempt.url).hostname}: ${e.message}`);
    }
  }
  return { ip: null, country: null, isTor: false, error: errors.join(' · '), proxy: activeSocksPort() };
}

/** IP directa (sin Tor), para poder comparar. */
function getDirectIP({ timeoutMs = 10000 } = {}) {
  return new Promise((resolve) => {
    const req = https.get('https://api.ipify.org?format=json', { timeout: timeoutMs, headers: { 'User-Agent': USER_AGENT } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body).ip); } catch { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

/** Prueba honesta: primero comprueba que hay SOCKS escuchando; si no, lo dice. */
async function testConnection({ timeoutMs = 25000 } = {}) {
  const managed = !!(torProcess && !torProcess.killed);
  const external = managed ? null : await detectExternal();
  const running = managed || !!external;
  const socksPort = managed ? managedSocksPort : (external ? external.socks : DEFAULT_SOCKS_PORT);

  if (!running) {
    return {
      ok: false,
      running: false,
      socksPort,
      error: `No hay ningún Tor escuchando en 127.0.0.1:${DEFAULT_SOCKS_PORT} (ni en ${EXTERNAL_PORT_PAIRS[0][0]}). Arráncalo desde aquí o abre Tor Browser.`,
    };
  }

  externalSocks = running && !managed ? socksPort : externalSocks;
  const tor = await getCurrentIP({ cacheMs: 0, timeoutMs });
  const directIP = await getDirectIP();

  if (!tor.ip) {
    return { ok: false, running: true, socksPort, directIP, error: `El SOCKS responde pero la consulta por Tor falló: ${tor.error}` };
  }

  return {
    ok: true,
    running: true,
    socksPort,
    torIP: tor.ip,
    directIP,
    isTor: tor.isTor,
    country: tor.country,
    different: Boolean(directIP && tor.ip && directIP !== tor.ip),
    source: tor.source,
    warning: tor.isTor === false ? 'La petición salió por el proxy, pero el servicio no la reconoce como salida de Tor.' : null,
  };
}

// ── proxy del sistema (solo Windows) ──────────────────────────────────────

const INTERNET_SETTINGS_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

function readSystemProxy() {
  if (!IS_WINDOWS) return null;
  const read = (name) => {
    try {
      return execFileSync('reg', ['query', INTERNET_SETTINGS_KEY, '/v', name], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    } catch { return null; }
  };
  return { ProxyEnable: read('ProxyEnable'), ProxyServer: read('ProxyServer'), ProxyOverride: read('ProxyOverride') };
}

// Estado del proxy del SISTEMA (Windows): habilitado, servidor y si fue KNK
// quien lo enrutó (existe copia de seguridad) y si apunta a Tor. Sirve al
// indicador de salida del Dashboard. null en otros SO.
// Interpreta la salida cruda de `reg query` (o un fixture con la misma forma).
// Separada de getSystemProxyState para poder testearla sin registro.
function parseSystemProxy(raw) {
  if (!raw) return null;
  const enabled = /0x1/.test(raw.ProxyEnable || '');
  const m = raw.ProxyServer && raw.ProxyServer.match(/ProxyServer\s+REG_SZ\s+(\S+)/);
  const server = m ? m[1] : undefined;
  if (!enabled) return null;
  return {
    enabled: true,
    server: server === undefined ? null : server,
    isTor: Boolean(server && server.includes('socks=') && server.includes('127.0.0.1')),
  };
}

function getSystemProxyState() {
  const state = parseSystemProxy(readSystemProxy());
  if (!state) return null;
  return { ...state, knkManaged: fs.existsSync(PROXY_BACKUP_PATH) };
}

function routeAllThroughTor() {
  if (!IS_WINDOWS) {
    return { ok: false, error: 'El proxy del sistema solo se configura desde el backend en Windows. En Linux/macOS exporta https_proxy=socks5h://127.0.0.1:9050.' };
  }
  try {
    const proxy = `socks=127.0.0.1:${activeSocksPort()}`;
    const previous = readSystemProxy();
    if (previous) {
      try { fs.writeFileSync(PROXY_BACKUP_PATH, JSON.stringify(previous, null, 2), 'utf8'); } catch { /* sin copia no se puede restaurar */ }
    }
    execFileSync('reg', ['add', INTERNET_SETTINGS_KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f'], { stdio: 'pipe' });
    execFileSync('reg', ['add', INTERNET_SETTINGS_KEY, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', proxy, '/f'], { stdio: 'pipe' });
    execFileSync('reg', ['add', INTERNET_SETTINGS_KEY, '/v', 'ProxyOverride', '/t', 'REG_SZ', '/d', 'localhost;127.*;10.*;192.168.*;*.local', '/f'], { stdio: 'pipe' });
    return {
      ok: true,
      proxy,
      socksPort: activeSocksPort(),
      backup: fs.existsSync(PROXY_BACKUP_PATH) ? PROXY_BACKUP_PATH : null,
      note: 'Los navegadores ya abiertos pueden seguir con el proxy anterior hasta reiniciarse.',
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clearSystemProxy() {
  if (!IS_WINDOWS) return { ok: false, error: 'Solo aplica en Windows.' };
  try {
    const hadBackup = fs.existsSync(PROXY_BACKUP_PATH);
    execFileSync('reg', ['add', INTERNET_SETTINGS_KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0', '/f'], { stdio: 'pipe' });
    try { execFileSync('reg', ['delete', INTERNET_SETTINGS_KEY, '/v', 'ProxyServer', '/f'], { stdio: 'pipe' }); } catch { /* no existía */ }
    if (hadBackup) fs.rmSync(PROXY_BACKUP_PATH, { force: true });
    return {
      ok: true,
      restored: hadBackup,
      note: 'Puede hacer falta reiniciar el navegador para que deje de usar el proxy.',
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── lecturas simples ──────────────────────────────────────────────────────

function getCircuitInfo() {
  return [...circuitHistory];
}

function getTorLog({ tail = 200, source = 'auto' } = {}) {
  let text = '';
  if (source === 'file') {
    try { text = fs.existsSync(TOR_LOG_PATH) ? fs.readFileSync(TOR_LOG_PATH, 'utf8') : ''; } catch { text = ''; }
  } else {
    text = logBuffer;
    if (!text) {
      try { text = fs.existsSync(TOR_LOG_PATH) ? fs.readFileSync(TOR_LOG_PATH, 'utf8') : ''; } catch { text = ''; }
    }
  }
  const lines = text.trim() ? text.trim().split(/\r?\n/) : [];
  const gestionado = !!(torProcess && !torProcess.killed);
  return {
    ok: true,
    lines: lines.slice(-tail),
    bytes: text.length,
    path: TOR_LOG_PATH,
    live: !!logBuffer,
    note: lines.length || gestionado
      ? null
      : 'El Tor en marcha no lo lanzó KNK: su log no está en ~/.knk-suite/tor/tor.log. Arranca el Tor de KNK para ver el bootstrap.',
  };
}

function getTorProxy() {
  return { host: '127.0.0.1', port: activeSocksPort(), scheme: 'socks5h' };
}

/** Deja el módulo en blanco (tests y reinicios limpios). */
function resetForTests() {
  torProcess = null;
  managedSocksPort = null;
  managedControlPort = null;
  circuitHistory = [];
  startTime = null;
  currentExitIP = null;
  currentCountry = null;
  ipCheckedAt = 0;
  logBuffer = '';
  lastError = null;
  externalSocks = null;
  externalControl = null;
}

module.exports = {
  parseSystemProxy,
  // rutas de trabajo y puertos
  TOR_DIR, TORRC_PATH, TOR_DATA_DIR, TOR_LOG_PATH, BUNDLE_DIR,
  DEFAULT_SOCKS_PORT, DEFAULT_CONTROL_PORT, EXTERNAL_PORT_PAIRS,
  // ciclo de vida
  ensureTorInstalled,
  resolveExpertBundleUrl,
  pickLatestStableVersion,
  expertBundleUrlFor,
  findTorBinary,
  generateTorrc,
  startTor,
  stopTor,
  getStatus,
  isRunning,
  // red
  socks5Connect,
  fetchViaTor,
  getCurrentIP,
  getDirectIP,
  testConnection,
  getTorProxy,
  activeSocksPort,
  activeControlPort,
  // control
  controlCommand,
  newIdentity,
  bootstrapPhase,
  controlTunnel,
  getCircuitInfo,
  // sistema
  routeAllThroughTor,
  getSystemProxyState,
  clearSystemProxy,
  // diagnóstico
  getTorLog,
  resetForTests,
};
