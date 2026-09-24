'use strict';
// ============================================================================
// ja3.test.js — invariantes del eco TLS que MIDE la huella en vez de inferirla.
//
// Lo que este test protege no es el parser: es la AFIRMACIÓN que el parser sostiene.
// Si el parser se equivoca, la captura de contraste publica una columna «JA3» que
// parece una medición y no lo es — exactamente el error que la auditoría del 16-sep
// persiguió (dar por medido lo que solo se miró).
//
// Tres cosas que este test fija, y las tres salieron de un fallo REAL:
//
//   1. GREASE NO cambia el JA3. Si lo cambiara, dos conexiones del MISMO cliente darían
//      hashes distintos y la huella sería inservible.
//   2. Responder en 'secure', no en 'data'. La primera versión respondía al primer
//      'data': un cliente TLS que no manda aplicación (un `tls.connect` pelado, o un
//      navegador antes de pintar) nunca lo dispara, así que el eco parecía «vacío» sin
//      serlo. El test lo caza porque el cliente escribe una petición y espera respuesta.
//   3. El handshake se anota SIEMPRE. La guarda original comparaba `o.ts === ja3.ts`,
//      pero `ja3` no tiene `ts` → comparación siempre falsa y `handshake` se quedaba en
//      'iniciado' para siempre. Ahora hay estado terminal en las DOS ramas, y la rama de
//      corte se etiqueta por lo MEDIDO ('cortado sin completar'), no por una causa
//      plausible: cuando un cliente no confía en el certificado propio, el servidor solo
//      ve `close`, así que afirmar «rechazó el certificado» sería inventarse la causa.
//
// Hermético en el sentido que importa: no sale de 127.0.0.1, no usa navegador, no toca
// el almacén de CA del sistema y no gasta ninguna petición a un objetivo.
// ============================================================================

const assert = require('assert');
const crypto = require('crypto');
const tls = require('tls');

const ja3 = require('./lib/ja3');

let passed = 0;
const fallos = [];
function ok(name, fn) {
  try { const r = fn(); passed++; console.log(`  ok — ${name}`); return r; }
  catch (e) { fallos.push(name); console.error(`  FALLO — ${name}: ${e.message}`); process.exitCode = 1; }
}
async function okAsync(name, fn) {
  try { const r = await fn(); passed++; console.log(`  ok — ${name}`); return r; }
  catch (e) { fallos.push(name); console.error(`  FALLO — ${name}: ${e.message}`); process.exitCode = 1; }
}

// ── Constructor de ClientHello (bytes de verdad, no un mock) ────────────────
const u1 = (n) => Buffer.from([n]);
const u2 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u3 = (n) => { const b = Buffer.alloc(3); b.writeUIntBE(n, 0, 3); return b; };
const ext = (tipo, datos) => Buffer.concat([u2(tipo), u2(datos.length), datos]);

const extGrupos = (grupos) => ext(10, Buffer.concat([u2(grupos.length * 2), ...grupos.map(u2)]));
const extFormatos = (fs) => ext(11, Buffer.concat([u1(fs.length), Buffer.from(fs)]));
const extSni = (nombre) => {
  const host = Buffer.from(nombre, 'utf8');
  return ext(0, Buffer.concat([u2(3 + host.length), u1(0), u2(host.length), host]));
};
const extAlpn = (nombres) => {
  const lista = Buffer.concat(nombres.map((n) => Buffer.concat([u1(Buffer.byteLength(n)), Buffer.from(n, 'utf8')])));
  return ext(16, Buffer.concat([u2(lista.length), lista]));
};

/** ClientHello sintético completo, con record y handshake bien formados. */
function helloDePrueba({ ciphers = [0x1301, 0x1302], extensiones = [] } = {}) {
  const cuerpo = Buffer.concat([
    u2(0x0303),                                    // legacy_version
    Buffer.alloc(32, 0xab),                        // random
    u1(0),                                         // session_id vacío
    u2(ciphers.length * 2), ...ciphers.map(u2),
    u1(1), u1(0),                                  // compression_methods: 1 → null
    u2(extensiones.reduce((s, e) => s + e.length, 0)), ...extensiones,
  ]);
  const hs = Buffer.concat([u1(0x01), u3(cuerpo.length), cuerpo]);
  return Buffer.concat([u1(0x16), u2(0x0301), u2(hs.length), hs]);
}

// ── Cliente TLS de prueba ───────────────────────────────────────────────────
// OJO con el nombre: `confiar` es SEMÁNTICO y por eso NO se pasa tal cual a TLS.
// `rejectUnauthorized` es su NEGACIÓN — invertirlo fue un fallo real de este test,
// que hacía que la rama de «acepta» rechazara el certificado y al revés.
async function conectar(puerto, { confiar = true, peticion = null, timeoutMs = 4000 } = {}) {
  return new Promise((resolve) => {
    const s = tls.connect({
      host: '127.0.0.1', port: puerto, servername: 'localhost',
      rejectUnauthorized: !confiar,
    });
    let texto = ''; let error = null; let resuelto = false;
    const fin = (extra) => { if (resuelto) return; resuelto = true; try { s.destroy(); } catch { /* ya */ } resolve({ texto, error, ...extra }); };
    s.on('secureConnect', () => { if (peticion) s.write(peticion); });
    s.on('data', (d) => { texto += d; });
    s.on('error', (e) => { error = e.message; fin({}); });
    s.on('end', () => fin({}));
    setTimeout(() => fin({ timeout: true }), timeoutMs);
  });
}

const GET = 'GET /huella HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n';

(async () => {
  console.log('ja3.test.js');

  // ── 1. GREASE ─────────────────────────────────────────────────────────────
  ok('esGrease reconoce la forma 0x?a?a y solo esa', () => {
    for (const v of [0x0a0a, 0x1a1a, 0x2a2a]) assert.strictEqual(ja3.esGrease(v), true, `${v.toString(16)} es GREASE`);
    for (const v of [0x1301, 0x0000, 0x0a0b, 0x0b0a, 0x0303]) {
      assert.strictEqual(ja3.esGrease(v), false, `${v.toString(16)} NO es GREASE`);
    }
  });

  // ── 2. Parser ─────────────────────────────────────────────────────────────
  const SNI = 'eco.local';
  const EXTS = [extSni(SNI), extGrupos([0x001d, 0x0017]), extFormatos([0]), extAlpn(['h2', 'http/1.1'])];
  const CRUDO = helloDePrueba({ ciphers: [0x1301, 0x1302], extensiones: EXTS });

  ok('parsea un ClientHello completo: versión, ciphers, extensión, SNI y ALPN', () => {
    const c = ja3.parsearClientHello(CRUDO);
    assert.ok(c && !c.incompleto, 'debe parsear sin decir "incompleto"');
    assert.strictEqual(c.version, 0x0303);
    assert.deepStrictEqual(c.ciphers, [0x1301, 0x1302]);
    assert.deepStrictEqual(c.curvas, [0x001d, 0x0017]);
    assert.deepStrictEqual(c.formatosEc, [0]);
    assert.strictEqual(c.sni, SNI);
    assert.deepStrictEqual(c.alpn, ['h2', 'http/1.1']);
    assert.strictEqual(c.bytes, CRUDO.length, 'debe decir cuántos bytes ocupa el record');
  });

  ok('el JA3 sale de los bytes: la cadena es la esperada y su md5 se recalcula en el test', () => {
    const h = ja3.ja3DeClientHello(CRUDO);
    // Cadena canónica JA3: version,ciphers,extensions,curvas,formatosEC
    assert.strictEqual(h.lista, '771,4865-4866,0-10-11-16,29-23,0');
    const esperado = crypto.createHash('md5').update(h.lista).digest('hex');
    assert.strictEqual(h.md5, esperado, 'el md5 debe ser el de la cadena publicada');
    assert.strictEqual(h.md5.length, 32);
  });

  ok('INVARIANTE: el GREASE no cambia el JA3 (si lo cambiara, la huella no serviría)', () => {
    // Mismas extensiones en el MISMO orden; solo cambia el contenido: ciphers y curvas
    // llevan GREASE, y se añade una extensión GREASE. Nada más cambia (una lista con una
    // extensión `supported_groups` DUPLICADA sí cambiaría el JA3, y eso fue un fallo de
    // este test: la aserción medía mi constructor, no el invariante).
    const conGrease = helloDePrueba({
      ciphers: [0x0a0a, 0x1301, 0x1302, 0x1a1a],
      extensiones: [ext(0x2a2a, Buffer.alloc(0)), extSni(SNI), extGrupos([0x0a0a, 0x001d, 0x0017]), extFormatos([0]), extAlpn(['h2', 'http/1.1'])],
    });
    const a = ja3.ja3DeClientHello(CRUDO);
    const b = ja3.ja3DeClientHello(conGrease);
    assert.strictEqual(b.lista, a.lista, `la cadena no debe moverse: ${b.lista}`);
    assert.strictEqual(b.md5, a.md5, 'GREASE en ciphers/extensiones/curvas no debe mover el hash');
    assert.ok(!/2570|6698|10922/.test(b.lista), `la cadena no debe publicar GREASE: ${b.lista}`);
  });

  ok('dos clientes distintos → dos hashes distintos (el hash discrimina de verdad)', () => {
    const otro = helloDePrueba({ ciphers: [0x1301], extensiones: [extGrupos([0x001d])] });
    const a = ja3.ja3DeClientHello(CRUDO);
    const b = ja3.ja3DeClientHello(otro);
    assert.notStrictEqual(b.md5, a.md5);
    assert.strictEqual(b.lista, '771,4865,10,29,', 'formatosEC vacío es válido en JA3');
  });

  ok('búfer corto → "incompleto" con los bytes que faltan (no lanza, no miente)', () => {
    for (const corte of [1, 4, 10, Math.floor(CRUDO.length / 2), CRUDO.length - 1]) {
      const r = ja3.parsearClientHello(CRUDO.slice(0, corte));
      assert.ok(r && r.incompleto === true, `corte ${corte} debe declararse incompleto`);
      assert.ok(r.necesarios > corte, `corte ${corte} debe decir cuánto falta`);
    }
  });

  ok('un record que NO es ClientHello → null (no se inventa una huella)', () => {
    const noHandshake = Buffer.from(CRUDO); noHandshake[0] = 0x17;      // application_data
    assert.strictEqual(ja3.parsearClientHello(noHandshake), null);
    const serverHello = Buffer.from(CRUDO); serverHello[5] = 0x02;      // es ServerHello
    assert.strictEqual(ja3.parsearClientHello(serverHello), null);
    assert.deepStrictEqual(ja3.parsearClientHello(Buffer.alloc(0)), { incompleto: true, necesarios: 5 });
  });

  // ── 3. Certificado propio ─────────────────────────────────────────────────
  const cert = ok('asegurarCertificado() entrega cert y clave sin tocar el almacén del sistema', () => {
    const c = ja3.asegurarCertificado();
    assert.ok(!c.error, `no se pudo generar el cert: ${c.error || ''}`);
    assert.ok(Buffer.isBuffer(c.key) && Buffer.isBuffer(c.cert));
    return c;
  });
  if (!cert || cert.error) { console.error('    (el eco vivo no se puede probar sin certificado)'); }

  ok('el certificado pedido por segunda vez no se regenera', () => {
    const a = ja3.asegurarCertificado();
    const b = ja3.asegurarCertificado();
    assert.strictEqual(b.generado, false);
    assert.strictEqual(b.cert.toString(), a.cert.toString(), 'debe ser el MISMO certificado');
  });

  if (cert && !cert.error) {
    // ── 4. Eco vivo: las dos ramas del handshake ────────────────────────────
    const eco = await ja3.crearEcoTls({ key: cert.key, cert: cert.cert });
    try {
      console.log(`    eco HTTPS en ${eco.base} (loopback, puerto efímero)`);

      ok('el eco DECLARA que su certificado es propio y no lo confía nadie', () => {
        assert.strictEqual(eco.certificado.propio, true);
        assert.strictEqual(eco.certificado.confiable, false, 'no confiarlo es el diseño, no un accidente');
      });

      // 4.a Sin ninguna conexión, «0 huellas» NO puede ser un ok silencioso.
      await okAsync('esperarHandshake() sin conexiones → ok:false con motivo (no un falso cero)', async () => {
        const r = await eco.esperarHandshake({ min: 1, timeoutMs: 300, intervaloMs: 60 });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.vistos, 0);
        assert.ok(/0 ClientHello medido/.test(r.motivo), r.motivo);
      });

      // 4.b Cliente que RECHAZA el cert propio: aquí muere el bug de la guarda.
      await okAsync('cliente que RECHAZA el cert propio: JA3 medido y handshake ANOTADO (no "iniciado")', async () => {
        const r = await conectar(eco.puerto, { confiar: false });
        assert.ok(r.error && /SELF_SIGNED|self-signed|UNABLE_TO_VERIFY/i.test(r.error), `error inesperado: ${r.error}`);
        const e = await eco.esperarHandshake({ min: 1, timeoutMs: 3000 });
        assert.strictEqual(e.ok, true, e.motivo);
        const o = eco.observaciones[0];
        assert.ok(o.md5, 'el ClientHello debe quedar MEDIDO aunque el handshake no complete');
        // La regresión exacta: antes quedaba 'iniciado' para siempre.
        assert.notStrictEqual(o.handshake, ja3.HANDSHAKE.INICIADO);
        // Y la regla de honestidad: no se nombra una causa que no se ha medido.
        assert.strictEqual(o.handshake, ja3.HANDSHAKE.CORTADO, `estado medido: ${o.handshake}`);
        assert.ok(!/rechaz|reject/i.test(String(o.motivo || '') + String(o.motivo_socket || '')),
          'no debe atribuir el corte al rechazo del certificado: eso no se mide');
      });

      // 4.c Cliente que ACEPTA: el eco responde (responder en 'secure', no en 'data').
      await okAsync('cliente que ACEPTA: handshake completado y el HTML lleva el MISMO JA3 medido', async () => {
        const r = await conectar(eco.puerto, { confiar: true, peticion: GET });
        const e = await eco.esperarHandshake({ min: 2, timeoutMs: 3000 });
        assert.strictEqual(e.ok, true, e.motivo);
        const o = eco.observaciones[1];
        assert.strictEqual(o.handshake, ja3.HANDSHAKE.COMPLETADO,
          `el handshake debe completar (responder en 'secure'): ${o.handshake}${o.motivo ? ' · ' + o.motivo : ''}`);
        assert.ok(r.texto && /JA3 \(md5\)/.test(r.texto), `el eco debe responder su tabla: ${r.texto.length} bytes`);
        assert.ok(r.texto.includes(o.md5), 'el HTML debe llevar el hash que se anotó en la observación');
      });

      // 4.d Determinismo + agrupación: varias conexiones del mismo cliente son UNA huella.
      await okAsync('mismo cliente tres veces → UNA huella con conexiones:3 (determinismo del hash)', async () => {
        await conectar(eco.puerto, { confiar: true, peticion: GET });
        const e = await eco.esperarHandshake({ min: 3, timeoutMs: 3000 });
        assert.strictEqual(e.ok, true, e.motivo);
        const res = eco.resumen();
        assert.strictEqual(res.huellas.length, 1, `debe haber UNA sola huella, hay ${res.huellas.length}`);
        assert.strictEqual(res.huellas[0].conexiones, 3, 'las tres conexiones deben contarse juntas');
        assert.ok(res.huellas[0].curvas && res.huellas[0].curvas.length > 0, 'debe registrar los grupos soportados');
        const estados = Object.keys(res.huellas[0].handshakes);
        assert.ok(estados.every((s) => ja3.TERMINALES.includes(s)), `estados inesperados: ${JSON.stringify(estados)}`);
      });
    } finally {
      await eco.cerrar();
    }
  }

  console.log(`ja3: ${passed} ok${fallos.length ? ` · ${fallos.length} FALLO(S)` : ''}`);
  if (process.exitCode) process.exit(process.exitCode);
})();
