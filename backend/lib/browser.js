'use strict';
// ============================================================================
// browser.js — Canal de NAVEGADOR REAL con perfil persistente (CDP) para
// evidencias. Mismo patrón que docs/moneybox-sesion/cdp.mjs (cero deps npm:
// WebSocket global de Node ≥ 22 + Chrome/Edge del sistema vía Chrome DevTools
// Protocol). Reutilizable para cualquier caza:
//
//   node lib/browser.js estado
//   node lib/browser.js abrir --url https://bugcrowd.com        # headed (ventana real)
//   node lib/browser.js navegar https://objetivo.com --captura foto.png
//   node lib/browser.js run mi-script.js                        # JS en la página
//   node lib/browser.js cerrar        # suelta el canal (el navegador sigue vivo)
//   node lib/browser.js kill          # cierra el navegador (Browser.close)
//
// El perfil vive en ~/.knk-suite/browser-profile/<programa>/ → cookies, logins
// (p.ej. la cuenta de test @bugcrowdninja.com) y challenges (Turnstile/CF)
// SOBREVIVEN entre sesiones. Solo hay un navegador vivo por perfil (chromium
// bloquea el user-data-dir compartido): si ya está vivo, el canal se ADJUNTA.
// ============================================================================

const { spawn } = require('child_process');
const fs = require('fs');
const netMod = require('./net');
const os = require('os');
const path = require('path');

const PUERTO_DEFECTO = parseInt(process.env.KNK_CDP_PORT || '9222', 10);
const PERFIL_RAIZ = path.join(os.homedir(), '.knk-suite', 'browser-profile');
const EVIDENCIA_BROWSER_DIR = path.join(os.homedir(), '.knk-suite', 'evidencia', 'browser');

function rutaCaptura(salida) {
  const root = path.resolve(EVIDENCIA_BROWSER_DIR);
  const requested = String(salida || '').trim();
  const name = requested || `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-captura.png`;
  // Solo un nombre de fichero dentro del directorio gestionado por la suite:
  // evita traversal, rutas absolutas y escrituras a través de symlinks.
  if (path.isAbsolute(name) || path.basename(name) !== name || name.includes('\\') || name.length > 120) {
    throw new Error('Nombre de captura no permitido: usa un único nombre .png');
  }
  if (!/^[A-Za-z0-9._-]+\.png$/i.test(name)) throw new Error('La captura debe tener extensión .png');
  const candidate = path.join(root, name);
  try {
    if (fs.lstatSync(candidate).isSymbolicLink()) throw new Error('La captura no puede ser un enlace simbólico');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return candidate;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Localización del navegador (Windows/macOS/Linux) ───────────────────────
function resolverBinario() {
  const candidatos = [];
  if (process.env.KNK_BROWSER_PATH) candidatos.push(process.env.KNK_BROWSER_PATH);
  if (process.platform === 'win32') {
    candidatos.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    );
  } else {
    candidatos.push(
      '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
      '/snap/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    );
  }
  for (const c of candidatos) {
    try { if (c && fs.existsSync(c)) return c; } catch { /* siguiente */ }
  }
  return null;
}

/** Perfil persistente por programa (saneado) o 'default'. */
function rutaPerfil(programa) {
  const limpio = String(programa || 'default')
    .toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
    || 'default';
  return path.join(PERFIL_RAIZ, limpio);
}

// ── Estado del puerto CDP ───────────────────────────────────────────────────
async function vivo(port) {
  if (!Number.isInteger(Number(port)) || Number(port) < 1024 || Number(port) > 65535) return null;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    const v = await r.json();
    return { navegador: v.Browser || '?', userAgent: v['User-Agent'] || '' };
  } catch { return null; }
}

// ── Abrir o adjuntar el canal ───────────────────────────────────────────────
/**
 * Devuelve { send, cerrar, kill, puerto, perfil, binario, headed, lanzado }.
 * Si ya hay navegador vivo en el puerto → se ADJUNTA (no lo toca).
 * Si no → lo LANZA con perfil persistente (headed=true → ventana real).
 */
async function abrirCanal({
  port = PUERTO_DEFECTO,
  perfil = rutaPerfil('default'),
  headed = true,
  headless = false,
  url = null,
  ua = null,
  requestPolicy = null,
} = {}) {
  if (!Number.isInteger(Number(port)) || Number(port) < 1024 || Number(port) > 65535) throw new Error('Puerto CDP no permitido');
  const base = `http://127.0.0.1:${port}`;
  let proc = null;
  let lanzado = false;

  let info = await vivo(port);
  if (!info) {
    const binario = resolverBinario();
    if (!binario) throw new Error('No hay Chrome/Edge/chromium — fija KNK_BROWSER_PATH');
    fs.mkdirSync(perfil, { recursive: true });
    const flags = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${perfil}`,
      '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage',
    ];
    if (headless || !headed) flags.push('--headless=new', '--disable-gpu', '--window-size=1600,1000');
    else flags.push('--start-maximized');
    if (ua) flags.push(`--user-agent=${ua}`);
    flags.push(url || 'about:blank');
    proc = spawn(binario, flags, { stdio: 'ignore' });
    proc.on('error', () => { /* el poll de abajo lo detecta */ });
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) {
      info = await vivo(port);
      ok = !!info;
      if (!ok) await sleep(500);
    }
    if (!ok) throw new Error(`El navegador no levantó CDP en el puerto ${port}`);
    lanzado = true;
  }

  const lista = await (await fetch(`${base}/json/list`)).json();
  const page = lista.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) throw new Error('Sin pestañas CDP disponibles (¿ventana cerrada?)');
  const ws = new WebSocket(page.webSocketDebuggerUrl);

  let id = 0;
  const pend = new Map();
  const eventos = new Map(); // método → Set(handler)
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      const p = pend.get(m.id);
      pend.delete(m.id);
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
    } else if (m.method && eventos.has(m.method)) {
      for (const h of eventos.get(m.method)) h(m.params);
    }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WS CDP rechazado')); });

  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pend.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const on = (method, handler) => {
    if (!eventos.has(method)) eventos.set(method, new Set());
    eventos.get(method).add(handler);
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');

  // El navegador persistente no debe poder seguir una redirección o cargar un
  // subrecurso fuera del scope aprobado. La política se aplica en la fase de
  // request, antes de que Chromium envíe la petición al destino.
  // Aplicar el UA de la sesión al navegador real, no solo a las peticiones HTTP
  // de Node. Así Burp, el servidor y la evidencia ven el mismo identificador.
  if (ua) {
    await send('Network.setUserAgentOverride', { userAgent: String(ua) });
  }

  if (typeof requestPolicy === 'function') {
    on('Fetch.requestPaused', async (event) => {
      try {
        const requestUrl = String(event.request?.url || '');
        const esHttp = /^https?:/i.test(requestUrl);
        const allowed = !esHttp || await requestPolicy(requestUrl, event);
        if (!allowed) {
          await send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' });
          return;
        }
        // El canal CDP también consume el limiter global. Esto impide que el
        // navegador real se convierta en una ruta paralela que lo esquive.
        if (esHttp) await netMod.waitForSlot();
        await send('Fetch.continueRequest', { requestId: event.requestId });
      } catch {
        try { await send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }); } catch { /* canal cerrado */ }
      }
    });
    await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  }

  const cerrar = () => {
    try { ws.close(); } catch { /* ya cerrado */ }
    if (proc) {
      // El navegador sigue vivo a propósito (perfil persistente); unref deja que
      // este proceso Node termine sin matar al hijo que él mismo lanzó.
      try { proc.unref(); } catch { /* ya sin referencia */ }
    }
  };
  const kill = async () => {
    try { await send('Browser.close'); } catch { /* fallback abajo */ }
    cerrar();
    if (proc) { try { proc.kill(); } catch { /* ya muerto */ } }
  };

  return {
    send, on, cerrar, kill,
    puerto: port, perfil, lanzado, headed: lanzado ? !headless && headed : null,
    binario: info?.navegador || '?',
  };
}

// ── Helpers de alto nivel ───────────────────────────────────────────────────

/** Página activa: { url, titulo, listo } */
async function paginaActual(send) {
  const r = await send('Runtime.evaluate', {
    expression: 'JSON.stringify({ url: location.href, titulo: document.title, listo: document.readyState })',
    returnByValue: true,
  });
  try { return JSON.parse(r.result.value); } catch { return { url: '?', titulo: '?', listo: '?' }; }
}

/** Navega y espera a que la carga termine (poll de readyState, como moneybox). */
async function navegar(send, url, timeoutMs = 30000) {
  await send('Page.navigate', { url });
  const fin = Date.now() + timeoutMs;
  let ultima = { url, titulo: '', listo: 'loading' };
  while (Date.now() < fin) {
    try {
      ultima = await paginaActual(send);
      if (ultima.listo === 'complete') break;
    } catch { /* transición */ }
    await sleep(400);
  }
  return ultima;
}

/** Evalúa JS en la página (await implícito, valor por copia). */
async function evaluar(send, expresion) {
  const r = await send('Runtime.evaluate', { expression: expresion, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'excepción en la página');
  return r.result?.value;
}

/** Saca el slug del hostname para nombrar evidencias. */
function slugUrl(url) {
  try { return new URL(url).hostname.replace(/[^a-z0-9.-]+/gi, ''); } catch { return 'pagina'; }
}

/** Pantallazo PNG → fichero. Devuelve { fichero, bytes, url, titulo }. */
async function capturar(send, salida, { fullPage = false, urlParaNombre = null } = {}) {
  const dir = EVIDENCIA_BROWSER_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const fichero = rutaCaptura(salida || `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${slugUrl(urlParaNombre || '') || 'captura'}.png`);
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: !!fullPage,
    fromSurface: true,
  });
  const buf = Buffer.from(shot.data, 'base64');
  // Creación exclusiva: evita que una carrera entre lstat y writeFile siga un
  // symlink creado por otro proceso local.
  const fd = fs.openSync(fichero, 'wx', 0o600);
  try { fs.writeFileSync(fd, buf); } finally { fs.closeSync(fd); }
  const pag = await paginaActual(send);
  return { fichero, bytes: buf.length, url: pag.url, titulo: pag.titulo };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function argVal(flag, argv) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}
const tiene = (flag, argv) => argv.includes(flag);

async function cli() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] || 'estado';
  const puerto = parseInt(argVal('--puerto', argv) || PUERTO_DEFECTO, 10);
  const perfil = rutaPerfil(argVal('--perfil', argv));
  const binario = resolverBinario();

  const imprimirEstado = async (extra = {}) => {
    const v = await vivo(puerto);
    const estado = { vivo: !!v, puerto, perfil, binario, ...(v || {}), ...extra };
    console.log(JSON.stringify(estado, null, 2));
    return estado;
  };

  if (cmd === 'estado') { await imprimirEstado(); return; }

  if (cmd === 'abrir') {
    const url = argVal('--url', argv);
    if (url) throw new Error('La navegación activa desde CLI está bloqueada: usa la API autenticada de KNK Suite para aplicar scope y política de red');
    const ya = await vivo(puerto);
    const canal = await abrirCanal({ port: puerto, perfil, headed: !tiene('--headless', argv), url: 'about:blank' });
    const pag = await paginaActual(canal.send);
    console.log(JSON.stringify({ ok: true, adjuntado: !!ya, puerto, perfil, binario: canal.binario, pagina: pag }, null, 2));
    canal.cerrar(); // el navegador sigue vivo; solo soltamos el WS
    return;
  }

  if (cmd === 'navegar') {
    throw new Error('La navegación activa desde CLI está bloqueada: usa POST /api/browser/navegar desde la interfaz autenticada de KNK Suite');
    /* istanbul ignore next */
    const url = argVal('--url', argv) || argv[1];
    if (!url) throw new Error('falta --url <destino>');
    const canal = await abrirCanal({ port: puerto, perfil, headed: !tiene('--headless', argv) });
    const pag = await navegar(canal.send, url);
    let captura = null;
    const out = argVal('--captura', argv);
    if (out) captura = await capturar(canal.send, out, { fullPage: tiene('--fullpage', argv), urlParaNombre: url });
    console.log(JSON.stringify({ ok: true, pagina: pag, captura }, null, 2));
    canal.cerrar();
    return;
  }

  if (cmd === 'captura') {
    throw new Error('La captura activa desde CLI está bloqueada: usa POST /api/browser/captura desde la interfaz autenticada de KNK Suite');
    /* istanbul ignore next */
    const out = argVal('--salida', argv);
    const canal = await abrirCanal({ port: puerto, perfil, headed: !tiene('--headless', argv) });
    const pag = await paginaActual(canal.send);
    const captura = await capturar(canal.send, out, { fullPage: tiene('--fullpage', argv), urlParaNombre: pag.url });
    console.log(JSON.stringify({ ok: true, captura }, null, 2));
    canal.cerrar();
    return;
  }

  if (cmd === 'run') {
    throw new Error('La ejecución de JavaScript en páginas desde CLI está bloqueada: usa únicamente el canal autenticado y aprobado de KNK Suite');
    /* istanbul ignore next */
    const fichero = argv[1];
    if (!fichero) throw new Error('falta el fichero .js a ejecutar en la página');
    const codigo = fs.readFileSync(fichero, 'utf8');
    const canal = await abrirCanal({ port: puerto, perfil, headed: !tiene('--headless', argv) });
    const valor = await evaluar(canal.send, codigo);
    console.log(JSON.stringify({ ok: true, resultado: valor }, null, 2));
    canal.cerrar();
    return;
  }

  if (cmd === 'cerrar') {
    // Solo suelta el canal: no hay WS persistente del backend que cerrar en CLI;
    // este comando existe por simetría y para verificar el puerto.
    const v = await vivo(puerto);
    console.log(JSON.stringify({ ok: true, vivo: !!v, nota: v ? 'el navegador sigue vivo (ciérralo con kill o la ventana)' : 'no había navegador' }, null, 2));
    return;
  }

  if (cmd === 'kill') {
    const canal = await abrirCanal({ port: puerto, perfil });
    await canal.kill();
    console.log(JSON.stringify({ ok: true, cerrado: true }, null, 2));
    return;
  }

  throw new Error(`comando desconocido: ${cmd} (estado|abrir|navegar|captura|run|cerrar|kill)`);
}

module.exports = {
  PUERTO_DEFECTO, PERFIL_RAIZ,
  resolverBinario, rutaPerfil, vivo,
  abrirCanal, navegar, paginaActual, evaluar, capturar, slugUrl, rutaCaptura,
  cli,
};

if (require.main === module) {
  cli().catch((e) => { console.error(JSON.stringify({ ok: false, error: e.message }, null, 2)); process.exitCode = 1; });
}
