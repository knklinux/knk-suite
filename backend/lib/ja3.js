'use strict';
// ============================================================================
// ja3.js — la huella TLS del ClientHello, MEDIDA en vez de inferida.
//
// POR QUÉ EXISTE
// --------------
// Hasta ahora la huella TLS era lo único de la captura de contraste que seguía
// siendo una INFERENCIA («Node/OpenSSL vs NSS, se notará»). La captura es HTTP en
// claro, así que el handshake no se veía. Esto lo convierte en una medición: un eco
// HTTPS con certificado PROPIO que lee el ClientHello y calcula su JA3.
//
// LA DECISIÓN QUE LO HACE ÚTIL: medir el ClientHello NO exige que el cliente CONFÍE
// en el certificado. El ClientHello es el primer vuelo del cliente: sale ANTES de ver
// el certificado del servidor. Medido en `.tmp/probe-tls3.js`:
//
//   · cliente que acepta el cert  → handshake 'completado', y el eco responde su tabla.
//   · cliente que RECHAZA el cert → el servidor ve SOLO `close`: no hay error de TLS que
//     culpar. Su JA3 queda medido igual, y el handshake se anota 'cortado sin completar'.
//
// Consecuencia práctica: no hay que instalar ninguna CA en el perfil de Firefox para
// medir su JA3. Y de ahí una REGLA DE HONESTIDAD: como no se mide la causa, no se
// nombra. Nada aquí dice «el cliente rechazó el certificado» — eso es una inferencia
// plausible, y la inferencia plausible es justo lo que este módulo viene a sustituir.
//
// El certificado es PROPIO y se genera aquí (openssl, una vez, cacheado en
// `.tmp/eco-tls/`). No se toca el almacén del sistema, ni el perfil del navegador,
// ni ninguna CA de usuario: el eco es loopback y su cert no lo confía nadie.
//
// CÓMO SE LEE SIN CONSUMIR: el socket se lee en modo pausado hasta tener el record
// completo, y luego se le DEVUELVEN los bytes (`unshift`) antes de envolverlo en
// `tls.TLSSocket`. La medición es un observador, no un consumidor — si se comiera el
// ClientHello, la capa TLS no podría completar el handshake y el eco no sería un eco.
// (Comprobado: el handshake completa, incluso con el ClientHello leído y devuelto.)
//
// JA3 (Althouse et al.): md5 de «version,ciphers,extensions,curvas,formatosEC»
// con los valores GREASE excluidos, en el orden en que salen al cable.
// ============================================================================

const crypto = require('crypto');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { once } = require('events');

const RAIZ = path.join(__dirname, '..', '..');
const DIR_CERT = path.join(RAIZ, '.tmp', 'eco-tls');

/**
 * GREASE (RFC 8701): valores con forma 0x?a?a que los clientes insertan a propósito
 * para no ser fingerprints estables. JA3 los EXCLUYE; incluirlos daría un hash que
 * cambia entre conexiones del MISMO cliente — es decir, un hash inservible.
 */
function esGrease(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && (n & 0x0f0f) === 0x0a0a;
}

const sinGrease = (arr) => (arr || []).filter((v) => !esGrease(v));

const EXT = { SERVER_NAME: 0, GRUPOS: 10, FORMATOS_EC: 11, ALPN: 16 };

/** Estados terminales del handshake. Cualquier otro valor significa «aún no se sabe». */
const HANDSHAKE = {
  INICIADO: 'iniciado',
  COMPLETADO: 'completado',
  ERROR_TLS: 'error de TLS',
  CORTADO: 'cortado sin completar',
};
const TERMINALES = [HANDSHAKE.COMPLETADO, HANDSHAKE.ERROR_TLS, HANDSHAKE.CORTADO];

/**
 * Parsea un ClientHello a partir de los bytes recibidos. Puro: sin IO, sin estado.
 *
 * Devuelve:
 *   · `{ incompleto: true, necesarios: N }` → faltan bytes; el llamante debe seguir leyendo.
 *   · `null`                               → es un record, pero NO un ClientHello.
 *   · los campos + `bytes`                  → medido; `bytes` es lo que ocupa el record.
 *
 * No lanza por un búfer corto a propósito: en un socket, «corto» es lo normal.
 */
function parsearClientHello(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  if (b.length < 5) return { incompleto: true, necesarios: 5 };
  if (b[0] !== 0x16) return null;                       // no es un record de handshake
  const largoRecord = b.readUInt16BE(3);
  const finRecord = 5 + largoRecord;
  if (b.length < finRecord) return { incompleto: true, necesarios: finRecord };
  if (b.length < 9) return { incompleto: true, necesarios: 9 };
  if (b[5] !== 0x01) return null;                       // no es ClientHello (p. ej. ServerHello)
  const largoHs = b.readUIntBE(6, 3);
  const fin = 5 + 4 + largoHs;
  if (b.length < fin) return { incompleto: true, necesarios: fin };

  let o = 9;
  const version = b.readUInt16BE(o); o += 2;
  o += 32;                                              // random
  if (o >= fin) return null;

  const largoSession = b[o]; o += 1 + largoSession;      // session_id
  if (o + 2 > fin) return null;

  const largoCiphers = b.readUInt16BE(o); o += 2;
  const ciphers = [];
  for (let i = 0; i + 2 <= largoCiphers && o + 2 <= fin; i += 2) { ciphers.push(b.readUInt16BE(o)); o += 2; }
  if (o >= fin) return null;

  const largoComp = b[o]; o += 1 + largoComp;            // compression_methods
  const extensions = [];
  const curvas = [];
  let formatosEc = [];
  let sni = null;
  let alpn = null;

  if (o + 2 <= fin) {
    const largoExt = b.readUInt16BE(o); o += 2;
    const finExt = Math.min(fin, o + largoExt);
    while (o + 4 <= finExt) {
      const tipo = b.readUInt16BE(o);
      const len = b.readUInt16BE(o + 2);
      const ini = o + 4;
      const finTipo = ini + len;
      if (finTipo > finExt) break;
      extensions.push(tipo);
      if (tipo === EXT.GRUPOS && len >= 2) {
        const n = b.readUInt16BE(ini);
        for (let i = 0; i + 2 <= n && ini + 2 + i + 2 <= finTipo; i += 2) curvas.push(b.readUInt16BE(ini + 2 + i));
      } else if (tipo === EXT.FORMATOS_EC && len >= 1) {
        const n = b[ini];
        for (let i = 0; i < n && ini + 1 + i < finTipo; i++) formatosEc.push(b[ini + 1 + i]);
      } else if (tipo === EXT.SERVER_NAME && len >= 5) {
        // lista de nombres: len(2) + tipo(1) + len(2) + nombre
        try { sni = b.toString('utf8', ini + 5, ini + 5 + b.readUInt16BE(ini + 3)); } catch { /* opcional */ }
      } else if (tipo === EXT.ALPN && len >= 3) {
        // lista de protocolos: len(2) + [len(1) + nombre]*
        try {
          const nombres = [];
          let p = ini + 2;
          while (p + 1 <= finTipo) { const n = b[p]; nombres.push(b.toString('utf8', p + 1, p + 1 + n)); p += 1 + n; }
          alpn = nombres;
        } catch { /* opcional */ }
      }
      o = finTipo;
    }
  }

  return { version, ciphers, extensions, curvas, formatosEc, sni, alpn, bytes: fin };
}

/** Cadena y hash JA3 a partir de los campos ya parseados. Puro y testeable. */
function ja3DeCampos(campos = {}) {
  const lista = [
    campos.version,
    sinGrease(campos.ciphers).join('-'),
    sinGrease(campos.extensions).join('-'),
    sinGrease(campos.curvas).join('-'),
    sinGrease(campos.formatosEc).join('-'),
  ].join(',');
  return { lista, md5: crypto.createHash('md5').update(lista).digest('hex') };
}

/** Atajo: bytes del ClientHello → campos + JA3. Null si no es un ClientHello. */
function ja3DeClientHello(buf) {
  const c = parsearClientHello(buf);
  if (!c || c.incompleto) return c;
  return { ...c, ...ja3DeCampos(c) };
}

/**
 * Asegura un certificado autofirmado propio en `.tmp/eco-tls/`.
 * Se genera UNA vez con openssl y se reutiliza. Devuelve `{ key, cert }` con los
 * contenidos, `generado: true|false`, o `{ error }` si openssl no está (en ese caso
 * el eco puede medir igual el ClientHello, pero no completar el handshake; el
 * llamante debe DECLARARLO, no fingir que hay eco HTTPS).
 */
function opensslBin() {
  const candidates = [
    process.env.KNK_OPENSSL,
    process.env.OPENSSL_BIN,
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'usr', 'bin', 'openssl.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'usr', 'bin', 'openssl.exe'),
  ].filter(Boolean);
  return candidates.find((candidate) => candidate === 'openssl' || fs.existsSync(candidate)) || 'openssl';
}

function asegurarCertificado({ dir = DIR_CERT, renovar = false } = {}) {
  const fKey = path.join(dir, 'eco.key');
  const fCrt = path.join(dir, 'eco.crt');
  const existen = fs.existsSync(fKey) && fs.existsSync(fCrt);
  if (existen && !renovar) {
    return { key: fs.readFileSync(fKey), cert: fs.readFileSync(fCrt), generado: false, ruta: { key: fKey, cert: fCrt } };
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    execFileSync(opensslBin(), [
      'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
      '-nodes', '-days', '3650', '-subj', '/CN=knk-suite eco local',
      '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
      '-keyout', fKey, '-out', fCrt,
    ], { stdio: 'pipe', timeout: 30000 });
    return { key: fs.readFileSync(fKey), cert: fs.readFileSync(fCrt), generado: true, ruta: { key: fKey, cert: fCrt } };
  } catch (e) {
    return { error: `no se pudo generar el certificado propio (¿openssl?): ${String(e.message).slice(0, 160)}` };
  }
}

/** Respuesta HTTP mínima del eco, para que un cliente que SÍ confíe vea algo útil. */
function respuestaHtml({ metodo = 'GET', url = '/', ja3 = null } = {}) {
  const filas = ja3
    ? [
      ['JA3 (md5)', ja3.md5],
      ['JA3 (cadena)', ja3.lista],
      ['TLS ClientHello', String(ja3.version)],
      ['ciphers', String(sinGrease(ja3.ciphers).length)],
      ['extensions', String(sinGrease(ja3.extensions).length)],
      ['curvas', (ja3.curvas || []).join(', ')],
      ['EC point formats', (ja3.formatosEc || []).join(', ')],
      ['SNI', ja3.sni || '(ninguno)'],
      ['ALPN', (ja3.alpn || []).join(', ') || '(ninguno)'],
    ].map(([k, v]) => `<tr><td>${k}</td><td>${String(v).replace(/</g, '&lt;')}</td></tr>`).join('')
    : '<tr><td>(sin ClientHello medido)</td><td></td></tr>';
  const cuerpo = `<!doctype html><meta charset="utf-8"><title>eco TLS — ${metodo}</title>
<body style="font-family:monospace;margin:24px">
<h2>Eco TLS · ${metodo} ${url}</h2>
<p>Así ve este servidor el ClientHello. La tabla se calcula con el handshake, es decir:
solo la ve un cliente que acepte el certificado propio. La MEDICIÓN de JA3 no necesita
aceptarlo.</p>
<table border="1" cellpadding="6" cellspacing="0">${filas}</table>
</body>`;
  return cuerpo;
}

/**
 * Levanta el eco HTTPS en loopback (puerto efímero por defecto).
 *
 * `observaciones` acumula UNA entrada por conexión, incluida cada conexión cuyo
 * handshake NO llega a completarse — que es el caso normal para un cliente que no
 * confía en el certificado propio, y precisamente el que interesa para medir la
 * huella TLS del navegador real.
 *
 * Devuelve `{ server, puerto, base, observaciones, resumen, esperarHandshake, cerrar }`.
 */
async function crearEcoTls({ key, cert, host = '127.0.0.1', puerto = 0, timeoutMs = 8000 } = {}) {
  if (!key || !cert) throw new Error('crearEcoTls necesita key y cert (ver asegurarCertificado)');
  const ctx = tls.createSecureContext({ key, cert });
  const observaciones = [];

  const server = net.createServer((socket) => {
    // El error del socket crudo se GUARDA, no se atribuye: es un dato, no una causa.
    let motivoSocket = null;
    socket.on('error', (e) => { motivoSocket = String(e.message).slice(0, 120); });
    socket.setTimeout(timeoutMs, () => { try { socket.destroy(); } catch { /* ya cerrado */ } });
    (async () => {
      // Lectura en modo PAUSADO: nada se consume en modo fluido, así que no se puede
      // robar el ClientHello. Se devuelve todo con `unshift` antes de envolver: medido,
      // el handshake completa igual (si se comiera los bytes, no completaría).
      socket.pause();
      const trozos = [];
      let hello = null;
      for (;;) {
        const chunk = socket.read();
        if (chunk === null) {
          if (!socket.readable) return;
          await once(socket, 'readable');
          continue;
        }
        trozos.push(chunk);
        const buf = Buffer.concat(trozos);
        let r;
        try { r = parsearClientHello(buf); } catch { r = null; }
        if (r && r.incompleto) continue;
        if (!r) { try { socket.destroy(); } catch { /* ya cerrado */ } return; }
        hello = r;
        break;
      }

      const ja3 = { ...hello, ...ja3DeCampos(hello) };
      // La observación se guarda por REFERENCIA. Compararla por `ts` parecía identificar la
      // conexión, pero `ja3` (campos del ClientHello) no tiene `ts`: la guarda era SIEMPRE
      // falsa y `handshake` se quedaba en 'iniciado' para siempre. Y con conexiones
      // concurrentes, `observaciones[length-1]` puede ser de OTRA conexión.
      const obs = {
        ts: new Date().toISOString(), ...ja3,
        ciphers: sinGrease(hello.ciphers), extensions: sinGrease(hello.extensions),
        handshake: HANDSHAKE.INICIADO,
      };
      observaciones.push(obs);

      const buf = Buffer.concat(trozos);
      socket.unshift(buf);                       // la medición no consume: devuelve los bytes
      const tlsSock = new tls.TLSSocket(socket, { isServer: true, secureContext: ctx });
      let respondido = false;
      const responder = (via) => {
        if (respondido) return;
        respondido = true;
        obs.respondido_via = via;
        const cuerpo = respuestaHtml({ metodo: 'GET', url: '/', ja3 });
        tlsSock.write('HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n'
          + `Content-Length: ${Buffer.byteLength(cuerpo)}\r\nConnection: close\r\n\r\n${cuerpo}`);
        tlsSock.end();
      };
      // MEDIDO: responder en 'secure' es lo que hace que el eco sea un eco. Responder solo
      // en 'data' dejaba al cliente esperando para siempre, porque un cliente TLS que no
      // manda aplicación (un simple `tls.connect`, o el navegador antes de pintar) nunca
      // dispara 'data' — y el eco parecía «vacío» sin serlo.
      tlsSock.on('secure', () => { obs.handshake = HANDSHAKE.COMPLETADO; responder('secure'); });
      tlsSock.on('data', () => { if (!respondido) { obs.handshake = HANDSHAKE.COMPLETADO; responder('data'); } });
      tlsSock.on('error', (e) => {
        if (obs.handshake === HANDSHAKE.INICIADO) {
          obs.handshake = HANDSHAKE.ERROR_TLS;
          obs.motivo = String(e.message).slice(0, 120);
        }
      });
      tlsSock.on('close', () => {
        if (obs.handshake !== HANDSHAKE.INICIADO) return;
        // NO se nombra la causa: lo único medido es que no completó. Un cliente que
        // rechaza un certificado propio aterriza aquí, y también un corte de red.
        obs.handshake = HANDSHAKE.CORTADO;
        if (motivoSocket) obs.motivo_socket = motivoSocket;
      });
    })().catch((e) => {
      const o = observaciones[observaciones.length - 1];
      if (o && o.handshake === HANDSHAKE.INICIADO) o.handshake = HANDSHAKE.CORTADO;
      if (o && !o.motivo) o.motivo = String(e.message).slice(0, 120);
      try { socket.destroy(); } catch { /* ya cerrado */ }
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(puerto, host, resolve);
  });

  const puertoReal = server.address().port;
  return {
    server,
    puerto: puertoReal,
    base: `https://${host}:${puertoReal}`,
    // Se declara, no se calla: el certificado es propio y NADIE lo confía.
    certificado: { propio: true, confiable: false, ok: true },
    observaciones,
    resumen: () => resumirObservaciones(observaciones),
    esperarHandshake: (opciones) => esperarHandshake(observaciones, opciones),
    cerrar: () => new Promise((r) => server.close(() => r(true))),
  };
}

/**
 * Resumen de lo observado. Agrupa por JA3 en vez de listar: dos conexiones del mismo
 * cliente (el navegador abre varias) deben leerse como UNA huella, no como dos.
 */
function resumirObservaciones(observaciones = []) {
  const porHash = new Map();
  for (const o of observaciones) {
    const k = o.md5 || '(sin medir)';
    const e = porHash.get(k) || {
      md5: o.md5, lista: o.lista, version: o.version, conexiones: 0,
      handshakes: {}, curvas: o.curvas, alpn: o.alpn, primeros: null,
    };
    e.conexiones += 1;
    e.handshakes[o.handshake] = (e.handshakes[o.handshake] || 0) + 1;
    if (!e.primeros) e.primeros = o.ts;
    porHash.set(k, e);
  }
  return {
    conexiones: observaciones.length,
    huellas: [...porHash.values()].map((e) => ({ ...e, handshakes: { ...e.handshakes } })),
  };
}

/**
 * Espera a que el eco haya MEDIDO al menos N ClientHellos (haya o no completado el
 * handshake) y a que esos N tengan estado terminal. Existe porque el lado del navegador
 * es asíncrono respecto a la llamada que lo provoca: `navegar()` puede devolver o fallar
 * antes de que el eco vea la conexión, y leer «0 huellas» sin esperar sería exactamente
 * el error que esta auditoría persigue — dar por medido lo que solo se miró.
 * Devuelve `{ ok, vistos, terminales, motivo }`; NUNCA lanza.
 */
async function esperarHandshake(observaciones = [], { min = 1, timeoutMs = 6000, intervaloMs = 100, soloMedidos = true } = {}) {
  const t0 = Date.now();
  for (;;) {
    const elegibles = soloMedidos ? observaciones.filter((o) => o.md5) : observaciones;
    const terminales = elegibles.filter((o) => TERMINALES.includes(o.handshake));
    if (elegibles.length >= min && terminales.length >= min) {
      return { ok: true, vistos: elegibles.length, terminales: terminales.length, ms: Date.now() - t0 };
    }
    if (Date.now() - t0 >= timeoutMs) {
      return {
        ok: false, vistos: elegibles.length, terminales: terminales.length, ms: Date.now() - t0,
        motivo: `tras ${timeoutMs} ms: ${elegibles.length} ClientHello medido(s), ${terminales.length} con handshake resuelto (se pedían ${min})`,
      };
    }
    await new Promise((r) => setTimeout(r, intervaloMs));
  }
}

module.exports = {
  DIR_CERT, HANDSHAKE, TERMINALES,
  esGrease, sinGrease,
  parsearClientHello, ja3DeCampos, ja3DeClientHello,
  asegurarCertificado, crearEcoTls, resumirObservaciones, respuestaHtml,
  esperarHandshake,
};
