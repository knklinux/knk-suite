'use strict';

// ============================================================================
// tor.test.js — pruebas del gestor de Tor SIN salir a Internet.
//
// Cubre los fallos reales que hacían que el panel «no conectara nunca»:
//   1. el listado del expert bundle tenía la versión fijada → 404 eterno;
//   2. `fetchViaTor` mandaba `CONNECT host:443` en texto por un puerto SOCKS5;
//   3. el excedente del saludo se perdía (destinos que hablan primero);
//   4. el torrc escribía rutas sin comillas / formato Unix.
//
// El SOCKS5 es de mentira y escucha en loopback: nada sale a Internet. Las
// pruebas de estado se adaptan a que en la máquina haya —o no— un Tor real.
// Cada prueba lleva su propio timeout para que un fallo nunca cuelgue la suite.
// ============================================================================

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knk-tor-test-'));
process.env.KNK_TOR_DIR = tmpDir;
process.env.KNK_TOR_SOCKS_PORT = '19050';
process.env.KNK_TOR_CONTROL_PORT = '19051';

const tor = require('./lib/tor');

const TEST_TIMEOUT_MS = 25000;

let passed = 0;
let failed = 0;

function withTimeout(promise, ms, name) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`la prueba «${name}» no terminó en ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function test(name, fn) {
  const run = () => {
    const out = fn();
    if (out && typeof out.then === 'function') return withTimeout(out, TEST_TIMEOUT_MS, name);
    return undefined;
  };
  return Promise.resolve()
    .then(run)
    .then(
      () => { passed++; console.log('  ok   ' + name); },
      (e) => { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
    );
}

function fixtureListing() {
  // Listado abreviado de dist.torproject.org/torbrowser/: incluye alphas y una
  // versión antigua desaparecida; el orden debe ser numérico, no alfabético.
  return [
    '<a href="../">../</a>',
    '<a href="13.5.9/">13.5.9/</a>',
    '<a href="14.5.9/">14.5.9/</a>',
    '<a href="15.0.2/">15.0.2/</a>',
    '<a href="15.0.22/">15.0.22/</a>',
    '<a href="16.0a1/">16.0a1/</a>',
    '<a href="16.5/">16.5/</a>',
  ].join('\n');
}

// ── resolución de la versión del bundle ───────────────────────────────────

async function bundleTests() {
  await test('elige la versión estable más nueva del listado', () => {
    assert.strictEqual(tor.pickLatestStableVersion(fixtureListing()), '16.5');
  });

  await test('ordena numéricamente, no como texto (9 < 15 < 16)', () => {
    const html = ['<a href="9.0.1/">9.0.1/</a>', '<a href="15.0.9/">15.0.9/</a>', '<a href="10.0.0/">10.0.0/</a>'].join('');
    assert.strictEqual(tor.pickLatestStableVersion(html), '15.0.9');
  });

  await test('descarta alphas y betas', () => {
    const html = ['<a href="16.0a1/">16.0a1/</a>', '<a href="15.0.9/">15.0.9/</a>', '<a href="16.0b2/">16.0b2/</a>'].join('');
    assert.strictEqual(tor.pickLatestStableVersion(html), '15.0.9');
  });

  await test('no repite versiones duplicadas en el listado', () => {
    const html = ['<a href="15.0.9/">15.0.9/</a>', '<a href="15.0.9/">15.0.9/</a>'].join('');
    assert.strictEqual(tor.pickLatestStableVersion(html), '15.0.9');
  });

  await test('sin versiones en el HTML devuelve null (no una versión inventada)', () => {
    assert.strictEqual(tor.pickLatestStableVersion('<html><body>vacío</body></html>'), null);
    assert.strictEqual(tor.pickLatestStableVersion(''), null);
    assert.strictEqual(tor.pickLatestStableVersion(null), null);
  });

  await test('la URL del bundle usa la versión pedida, no una fijada en el código', () => {
    assert.strictEqual(
      tor.expertBundleUrlFor('15.0.22'),
      'https://dist.torproject.org/torbrowser/15.0.22/tor-expert-bundle-windows-x86_64-15.0.22.tar.gz'
    );
    assert.ok(tor.expertBundleUrlFor('9.9.9').includes('tor-expert-bundle-windows-x86_64-9.9.9.tar.gz'));
  });

  await test('regresión: la versión ya no está fijada a 13.5.9', () => {
    const src = fs.readFileSync(path.join(__dirname, 'lib', 'tor.js'), 'utf8');
    assert.strictEqual(
      /tor-expert-bundle-windows-x86_64-(\d+\.\d+\.\d+)/.exec(src),
      null,
      'la URL del bundle no debe llevar la versión escrita a mano'
    );
    assert.ok(!/dist\.torproject\.org\/torbrowser\/\d+\.\d+\.\d+\//.test(src));
  });

  await test('resolveExpertBundleUrl nunca lanza y devuelve version+url coherentes', async () => {
    assert.strictEqual(typeof tor.resolveExpertBundleUrl, 'function');
    const out = await tor.resolveExpertBundleUrl();
    assert.ok(out && typeof out === 'object');
    assert.ok(['listado oficial', 'lista local', 'ninguna'].includes(out.resolvedFrom));
    if (out.version) assert.strictEqual(out.url, tor.expertBundleUrlFor(out.version));
  });
}

// ── SOCKS5 real ───────────────────────────────────────────────────────────

/**
 * SOCKS5 de mentira: registra lo que le llega y responde según `mode`.
 * En modo «ok» la respuesta y el PONG viajan en el MISMO write para comprobar
 * que los bytes sobrantes tras el saludo se entregan al consumidor.
 */
function fakeSocks(mode = 'ok') {
  return new Promise((resolve, reject) => {
    let request = Buffer.alloc(0);
    const server = net.createServer((socket) => {
      let phase = 'greeting';
      socket.on('data', (chunk) => {
        if (phase === 'greeting') {
          if (mode === 'not-socks') { socket.end('HTTP/1.1 200 OK\r\n\r\n'); return; }
          if (mode === 'needs-auth') { socket.end(Buffer.from([0x05, 0xff])); return; }
          if (chunk[0] !== 0x05) return;
          socket.write(Buffer.from([0x05, 0x00]));
          phase = 'request';
          return;
        }
        request = Buffer.concat([request, chunk]);
        if (mode === 'reject') {
          socket.end(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          return;
        }
        socket.write(Buffer.concat([
          Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
          Buffer.from('PONG'),
        ]));
      });
      socket.on('error', () => {});
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        get request() { return request; },
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function readOnce(socket, ms = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no llegaron datos del socket')), ms);
    socket.once('data', (chunk) => { clearTimeout(timer); resolve(chunk.toString('utf8')); });
  });
}

async function socksTests() {
  await test('habla SOCKS5 binario: ATYP=dominio con el host, nunca "CONNECT"', async () => {
    const proxy = await fakeSocks('ok');
    try {
      const socket = await tor.socks5Connect({ host: 'example.com', port: 443, proxyPort: proxy.port, timeoutMs: 5000 });
      const req = proxy.request;
      assert.strictEqual(req[0], 0x05, 'versión SOCKS5');
      assert.strictEqual(req[1], 0x01, 'comando CONNECT');
      assert.strictEqual(req[3], 0x03, 'ATYP=dominio (resuelve Tor, sin fuga de DNS)');
      assert.strictEqual(req[4], 'example.com'.length);
      assert.strictEqual(req.slice(5, 16).toString('utf8'), 'example.com');
      assert.strictEqual(req.readUInt16BE(16), 443, 'puerto de destino big-endian');
      assert.ok(!req.includes(Buffer.from('CONNECT')), 'no debe mandar el texto CONNECT de un proxy HTTP');
      socket.destroy();
    } finally { await proxy.close(); }
  });

  await test('ATYP=IPv4 cuando el destino ya es una IP', async () => {
    const proxy = await fakeSocks('ok');
    try {
      const socket = await tor.socks5Connect({ host: '93.184.216.34', port: 80, proxyPort: proxy.port, timeoutMs: 5000 });
      const req = proxy.request;
      assert.strictEqual(req[3], 0x01);
      assert.deepStrictEqual([...req.slice(4, 8)], [93, 184, 216, 34]);
      assert.strictEqual(req.readUInt16BE(8), 80);
      socket.destroy();
    } finally { await proxy.close(); }
  });

  await test('los bytes sobrantes tras el saludo se entregan (SSH/SMTP/TLS)', async () => {
    const proxy = await fakeSocks('ok');
    try {
      const socket = await tor.socks5Connect({ host: 'example.com', port: 80, proxyPort: proxy.port, timeoutMs: 5000 });
      assert.strictEqual(await readOnce(socket), 'PONG');
      socket.destroy();
    } finally { await proxy.close(); }
  });

  await test('rechazo del destino (0x05) se traduce a un motivo legible', async () => {
    const proxy = await fakeSocks('reject');
    try {
      await assert.rejects(
        () => tor.socks5Connect({ host: 'example.com', port: 443, proxyPort: proxy.port, timeoutMs: 5000 }),
        /conexión rechazada por el destino/
      );
    } finally { await proxy.close(); }
  });

  await test('proxy que exige autenticación lo dice en vez de colgarse', async () => {
    const proxy = await fakeSocks('needs-auth');
    try {
      await assert.rejects(
        () => tor.socks5Connect({ host: 'example.com', port: 443, proxyPort: proxy.port, timeoutMs: 5000 }),
        /exige autenticación/
      );
    } finally { await proxy.close(); }
  });

  await test('un puerto que no es SOCKS da un error claro, no un timeout', async () => {
    const proxy = await fakeSocks('not-socks');
    try {
      await assert.rejects(
        () => tor.socks5Connect({ host: 'example.com', port: 443, proxyPort: proxy.port, timeoutMs: 5000 }),
        /proxy SOCKS/
      );
    } finally { await proxy.close(); }
  });

  await test('sin host de destino falla al instante', async () => {
    await assert.rejects(() => tor.socks5Connect({ port: 443 }), /falta el host/);
  });

  await test('proxy inexistente no espera más que el timeout', async () => {
    const started = Date.now();
    await assert.rejects(() => tor.socks5Connect({ host: 'example.com', port: 443, proxyPort: 1, timeoutMs: 1500 }));
    assert.ok(Date.now() - started < 4000, 'debe fallar rápido: ' + (Date.now() - started) + ' ms');
  });
}

// ── torrc ─────────────────────────────────────────────────────────────────

async function torrcTests() {
  await test('el torrc usa rutas nativas y sin comillas porque Tor no las quita', () => {
    const out = tor.generateTorrc({ socksPort: 19050, controlPort: 19051 });
    assert.strictEqual(out.ok, true);
    assert.ok(fs.existsSync(out.path), 'debe escribir el torrc');
    assert.ok(out.content.includes('SocksPort 19050'));
    assert.ok(out.content.includes('ControlPort 19051'));
    assert.ok(out.content.includes('CookieAuthentication 1'));
    const dataLine = out.content.split('\n').find((l) => l.startsWith('DataDirectory '));
    assert.ok(dataLine, 'debe haber DataDirectory');
    assert.ok(!dataLine.includes('"'), 'Tor no quita las comillas: romperían la ruta (' + dataLine + ')');
    // Tor usa barras normales aunque sea Windows, así que se compara la forma normalizada.
    const dataDirNormalizado = path.join(tmpDir, 'data').replace(/\\/g, '/');
    assert.ok(dataLine.includes(dataDirNormalizado), 'DataDirectory dentro de KNK_TOR_DIR (' + dataLine + ')');
    assert.ok(!/^DataDirectory \//m.test(out.content), 'no debe usar rutas tipo Unix sin unidad');
    const logLine = out.content.split('\n').find((l) => l.startsWith('Log notice file '));
    assert.ok(logLine && !logLine.includes('"'), 'log sin comillas: ' + logLine);
  });

  await test('ExitNodes por defecto es una lista de países y se puede acotar', () => {
    const def = tor.generateTorrc({}).content;
    assert.ok(/^ExitNodes \{es\},\{de\}/m.test(def));
    const one = tor.generateTorrc({ exitNodes: ['nl'] }).content;
    assert.ok(/^ExitNodes \{nl\}$/m.test(one));
  });
}

// ── estado ────────────────────────────────────────────────────────────────

async function stateTests() {
  await test('getTorProxy apunta al SOCKS en loopback con esquema socks5h', () => {
    const proxy = tor.getTorProxy();
    assert.strictEqual(proxy.host, '127.0.0.1');
    assert.strictEqual(proxy.scheme, 'socks5h', 'socks5h resuelve el DNS dentro de Tor');
    assert.ok(Number.isInteger(proxy.port) && proxy.port > 0);
  });

  await test('getStatus dice la verdad en ambos escenarios', async () => {
    const status = await tor.getStatus({ ipMaxAgeMs: 60000, timeoutMs: 4000 });
    assert.strictEqual(status.ok, true);
    assert.strictEqual(typeof status.running, 'boolean');
    assert.strictEqual(status.dataDir, path.join(tmpDir, 'data'));
    assert.strictEqual(status.torrc, path.join(tmpDir, 'torrc'));
    if (status.running) {
      assert.ok(status.socksPort > 0, 'si corre, debe decir en qué puerto SOCKS');
      assert.ok(status.managed || status.external, 'si corre, debe decir de quién es');
      if (status.external) assert.ok(/no lo gestiona KNK/.test(status.note));
    } else {
      assert.ok(status.error || status.installed === false, 'debe decir por qué no está en marcha');
    }
  });

  await test('testConnection no miente sobre si hay Tor', async () => {
    const out = await tor.testConnection({ timeoutMs: 4000 });
    if (out.running) {
      assert.ok(out.socksPort > 0, 'si hay Tor, debe decir en qué puerto');
      assert.strictEqual(typeof out.ok, 'boolean');
    } else {
      assert.strictEqual(out.ok, false);
      assert.ok(/Arráncalo|Tor/.test(out.error));
    }
  });

  await test('un Tor externo no se para desde KNK', async () => {
    const out = await tor.stopTor();
    assert.ok(typeof out.ok === 'boolean');
    if (!out.ok) assert.ok(/no lo ha lanzado KNK/.test(out.error), 'si hay un Tor ajeno, lo dice');
  });

  await test('getTorLog devuelve una lista y no una traza inventada', () => {
    const out = tor.getTorLog({ tail: 10 });
    assert.strictEqual(out.ok, true);
    assert.ok(Array.isArray(out.lines));
    assert.ok(out.path.endsWith('tor.log'));
  });

  await test('el estado no anuncia un puerto de control que no responde', async () => {
    const status = await tor.getStatus({ ipMaxAgeMs: 60000, timeoutMs: 4000 });
    if (status.controlPort === null) return; // el Tor no expone control: es correcto
    const alive = await new Promise((resolve) => {
      const s = net.connect({ host: '127.0.0.1', port: status.controlPort });
      const done = (v) => { s.destroy(); resolve(v); };
      s.setTimeout(900);
      s.once('connect', () => done(true));
      s.once('timeout', () => done(false));
      s.once('error', () => done(false));
    });
    assert.strictEqual(alive, true, 'si se anuncia, el puerto debe aceptar conexiones: ' + status.controlPort);
  });

  await test('controlTunnel dice a qué puerto se puede pedir y por qué no', async () => {
    const tunnel = await tor.controlTunnel();
    const status = await tor.getStatus({ ipMaxAgeMs: 60000, timeoutMs: 4000 });
    if (!status.running) {
      assert.strictEqual(tunnel.ok, false);
      assert.strictEqual(tunnel.error, 'Tor no está en marcha');
      return;
    }
    if (status.managed) {
      assert.strictEqual(tunnel.ok, true);
      assert.strictEqual(tunnel.external, false);
      return;
    }
    assert.strictEqual(tunnel.external, tunnel.ok ? true : tunnel.external);
    if (tunnel.ok) {
      assert.ok(tunnel.port > 0, 'debe dar un puerto de control real');
    } else {
      assert.ok(/puerto de control|Tor Browser/.test(tunnel.error), 'debe explicarlo: ' + tunnel.error);
    }
  });

  await test('con IP de salida, el estado ya se considera bootstrapeado', async () => {
    const status = await tor.getStatus({ ipMaxAgeMs: 0, timeoutMs: 6000 });
    if (status.running && status.ip) {
      assert.strictEqual(status.bootstrapped, true, 'una IP de salida prueba que Tor está en pie');
    }
  });

  await test('el log dice de quién es cuando no hay nada que enseñar', () => {
    const out = tor.getTorLog({ tail: 10 });
    if (!out.lines.length && !out.live) {
      assert.ok(out.note && /no lo lanzó KNK|Arranca el Tor de KNK/.test(out.note), 'debe explicar el log vacío');
    }
  });

  await test('getCircuitInfo devuelve una lista', () => {
    assert.ok(Array.isArray(tor.getCircuitInfo()));
  });

  await test('findTorBinary no miente: null o una ruta existente', () => {
    const bin = tor.findTorBinary();
    if (bin !== null) assert.ok(fs.existsSync(bin), 'si devuelve ruta, el binario debe existir');
  });
}

(async () => {
  console.log('tor.test.js — sin salir a Internet, con SOCKS5 de mentira');
  await bundleTests();
  await socksTests();
  await torrcTests();
  await stateTests();
  console.log(`\n${passed} ok, ${failed} fallo(s)`);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* nada */ }
  process.exit(failed ? 1 : 0);
})();
