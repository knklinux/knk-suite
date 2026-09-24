'use strict';
/**
 * simulador.test.js — el chatgpt.com local del modo --sim del discriminador.
 *
 * El simulador existe para validar lanzar→inyectar→esperar→medir SIN la petición
 * real. Su riesgo simétrico al del driver: fingir resultados. Por eso el test fija
 * los CONTRATOS que el código real del driver consume (expresionSesion,
 * expresionSonda, veredictoDe) y que el servidor los sirva de verdad por HTTPS:
 *
 *   · analizarSesion/clasificarSonda (PUROS): el contrato exacto ({} sin cookie,
 *     401 sin Bearer, 403 con el marcador /unusual activity/i, SSE en el 200).
 *   · el SERVIDOR vivo: mismas respuestas por TLS con el cert CN=chatgpt.com
 *     (el --host-resolver-rules del modo sim lo hace creíble para el navegador),
 *     escuchando SOLO en 127.0.0.1.
 *   · verificarPropiedad: el hijo del lanzado con la cmdline del perfil → nuestro;
 *     el de otro padre → no.
 *
 * Sin navegador, sin red externa: todo loopback.
 */

const https = require('https');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const sim = require('./lib/navegador-simulado');
const disc = require('./cdp-discriminador-flag');

const opensslBin = [
  process.env.KNK_OPENSSL,
  process.env.OPENSSL_BIN,
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'usr', 'bin', 'openssl.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'usr', 'bin', 'openssl.exe'),
].filter(Boolean).find((candidate) => fs.existsSync(candidate)) || 'openssl';

let ok = 0, ko = 0;
function t(nombre, fn) {
  try { fn(); ok++; console.log(`  ok — ${nombre}`); }
  catch (e) { ko++; console.error(`  FALLO — ${nombre}: ${e.message}`); process.exitCode = 1; }
}
const tA = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`  ok — ${nombre}`); }
  catch (e) { ko++; console.error(`  FALLO — ${nombre}: ${e.message}`); process.exitCode = 1; }
};

console.log('simulador.test.js');

// ── 1. Contratos puros ──────────────────────────────────────────────────────

t('analizarSesion: sin cookie de sesión → 200 {} (la ESPERA espera de verdad)', () => {
  const s = sim.analizarSesion({ cookie: 'foo=bar; __cflb=xyz' });
  assert.strictEqual(s.status, 200);
  assert.deepStrictEqual(s.cuerpo, {});
});

t('analizarSesion: con __Secure-next-auth.session-token → user + accessToken', () => {
  const s = sim.analizarSesion({ cookie: `${sim.NOMBRE_COOKIE_SESION}=abc.def; foo=bar` });
  assert.strictEqual(s.status, 200);
  assert.ok(s.cuerpo.user && s.cuerpo.user.id.startsWith('user-'), 'user.id con forma user-…');
  assert.ok(s.cuerpo.accessToken, 'accessToken presente');
  assert.ok(/SIMULADO/.test(s.cuerpo.accessToken), 'el token declara que es simulado');
});

t('analizarSesion: sesión TROCEADA de NextAuth (.0/.1) se re-ensambla — el caso del jar real', () => {
  const s = sim.analizarSesion({ cookie: sim.NOMBRE_COOKIE_SESION + '.0=parteUno; ' + sim.NOMBRE_COOKIE_SESION + '.1=parteDos; __cflb=x' });
  assert.strictEqual(s.status, 200);
  assert.ok(s.cuerpo.user && s.cuerpo.accessToken, 'sesión presente con chunks');
  assert.strictEqual(s.cuerpo.simulacion.sesionChunked, 2);
});

t('analizarSesion: el nombre base tiene precedencia sobre los chunks', () => {
  const s = sim.analizarSesion({ cookie: sim.NOMBRE_COOKIE_SESION + '=base; ' + sim.NOMBRE_COOKIE_SESION + '.0=chunk' });
  assert.ok(s.cuerpo.accessToken);
  assert.strictEqual(s.cuerpo.simulacion.sesionChunked, 0, 'sin chunks usados');
});

t('analizarSesion: cookie vacía o sin valor no cuenta como sesión', () => {
  assert.deepStrictEqual(sim.analizarSesion({ cookie: `${sim.NOMBRE_COOKIE_SESION}=` }).cuerpo, {});
  assert.deepStrictEqual(sim.analizarSesion(null).cuerpo, {});
});

t('clasificarSonda: sin Bearer → 401 (lo que veredictoDe lee como INCONCLUSO)', () => {
  const r = sim.clasificarSonda({ cabeceras: { 'content-type': 'application/json' } }, '403');
  assert.strictEqual(r.status, 401);
  assert.ok(/Access token is missing/.test(r.cuerpo));
});

t('clasificarSonda: Bearer sin Content-Type → 415 (guardia de forma)', () => {
  const r = sim.clasificarSonda({ cabeceras: { authorization: 'Bearer x' } }, '403');
  assert.strictEqual(r.status, 415);
});

t('clasificarSonda: sabor 403 → el marcador que veredictoDe busca (/unusual activity/i)', () => {
  const r = sim.clasificarSonda({ cabeceras: { authorization: 'Bearer x', 'content-type': 'application/json' } }, '403');
  assert.strictEqual(r.status, 403);
  assert.ok(/unusual activity/i.test(r.cuerpo), 'marcador presente');
  const v = disc.veredictoDe({ fase: 'sonda', status: r.status, unusual: true });
  assert.strictEqual(v.veredicto, 'FLAG_DE_LA_CUENTA_O_IP', 'el veredicto del driver lee este cuerpo');
});

t('clasificarSonda: sabor 200 → SSE con data: [DONE] y veredicto FLAG_DEL_CLIENTE_SINTETICO', () => {
  const r = sim.clasificarSonda({ cabeceras: { authorization: 'Bearer x', 'content-type': 'application/json' } }, '200');
  assert.strictEqual(r.status, 200);
  assert.ok(r.cuerpo.includes('data:') && r.cuerpo.includes('[DONE]'), 'cuerpo SSE');
  const v = disc.veredictoDe({ fase: 'sonda', status: r.status, unusual: false });
  assert.strictEqual(v.veredicto, 'FLAG_DEL_CLIENTE_SINTETICO');
});

t('clasificarSonda: sabor 500 → 500 limpio (el caso E12, para contrastar)', () => {
  const r = sim.clasificarSonda({ cabeceras: { authorization: 'Bearer x', 'content-type': 'application/json' } }, '500');
  assert.strictEqual(r.status, 500);
});

// ── 2. El servidor vivo (HTTPS real en loopback) ────────────────────────────

function pedir(url, { metodo = 'GET', cabeceras = {}, cuerpo = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: metodo, headers: cabeceras, rejectUnauthorized: false }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, texto: d }));
    });
    req.on('error', reject);
    if (cuerpo) req.write(cuerpo);
    req.end();
  });
}

(async () => {
  await tA('el servidor arranca solo en 127.0.0.1 y sirve la página con título ChatGPT', async () => {
    const s = await sim.iniciar({ puertoSim: 0, registro: () => {} });
    try {
      assert.ok(s.puerto >= 1024, 'puerto asignado');
      assert.strictEqual(s.hostResolverArgs, `MAP chatgpt.com 127.0.0.1:${s.puerto}, EXCLUDE localhost`);
      const r = await pedir(`https://127.0.0.1:${s.puerto}/`);
      assert.strictEqual(r.status, 200);
      assert.ok(/<title>ChatGPT<\/title>/.test(r.texto), 'título ChatGPT');
    } finally { await s.cerrar(); }
  });

  await tA('el certificado es propio y su CN es chatgpt.com (la credibilidad del MAP)', async () => {
    const cert = sim.asegurarCertificado();
    assert.ok(!cert.error, 'certificado generado');
    const subject = execFileSync(opensslBin, ['x509', '-noout', '-subject'],
      { input: cert.cert, encoding: 'utf8', timeout: 15000 });
    assert.ok(/CNs*=s*chatgpt.com/.test(subject), `subject real: ${subject.trim()}`);
  });

  await tA('punta a punta del contrato: sesión sin cookie → {} · con cookie → user/accessToken', async () => {
    const s = await sim.iniciar({ puertoSim: 0, registro: () => {} });
    try {
      const sin = await pedir(`https://127.0.0.1:${s.puerto}/api/auth/session`);
      assert.strictEqual(sin.status, 200);
      assert.strictEqual(sin.texto, '{}');
      const con = await pedir(`https://127.0.0.1:${s.puerto}/api/auth/session`, {
        cabeceras: { Cookie: `${sim.NOMBRE_COOKIE_SESION}=prueba-de-test` },
      });
      assert.strictEqual(con.status, 200);
      const j = JSON.parse(con.texto);
      assert.ok(j.user && j.user.id.startsWith('user-'), 'user.id real para el driver');
      assert.ok(j.accessToken, 'accessToken para el Bearer de la sonda');
    } finally { await s.cerrar(); }
  });

  await tA('punta a punta de la sonda: 403 con el marcador (SIM_CONV por defecto)', async () => {
    const s = await sim.iniciar({ puertoSim: 0, registro: () => {} });
    try {
      process.env.SIM_CONV = '403';
      const r = await pedir(`https://127.0.0.1:${s.puerto}/backend-api/conversation`, {
        metodo: 'POST',
        cabeceras: { authorization: 'Bearer SIMULADO.no-es-un-token-real', 'content-type': 'application/json' },
        cuerpo: JSON.stringify({ messages: [] }),
      });
      assert.strictEqual(r.status, 403);
      assert.ok(/unusual activity/i.test(r.texto));
    } finally { await s.cerrar(); delete process.env.SIM_CONV; }
  });

  await tA('punta a punta de la sonda: sabor 200 → SSE (FLAG_DEL_CLIENTE_SINTETICO posible)', async () => {
    const s = await sim.iniciar({ puertoSim: 0, registro: () => {} });
    try {
      process.env.SIM_CONV = '200';
      const r = await pedir(`https://127.0.0.1:${s.puerto}/backend-api/conversation`, {
        metodo: 'POST',
        cabeceras: { authorization: 'Bearer x', 'content-type': 'application/json' },
        cuerpo: '{}',
      });
      assert.strictEqual(r.status, 200);
      assert.ok(r.texto.includes('[DONE]'));
    } finally { await s.cerrar(); delete process.env.SIM_CONV; }
  });

  await tA('verificarPropiedad: pid directo → nuestro · otro padre → no', async () => {
    const a = await sim.verificarPropiedad({ pidLanzado: 777, pidPuerto: 777, perfil: 'C:/x' });
    assert.strictEqual(a.nuestro, true);
    // proceso vivo con padre que NO es 777 (el propio test):
    const b = await sim.verificarPropiedad({ pidLanzado: 777, pidPuerto: process.pid, perfil: 'C:/x' });
    assert.strictEqual(b.nuestro, false);
  });

  await tA('asegurarPerfilLibre: perfil inexistente → 0 y no explota', async () => {
    const n = sim.asegurarPerfilLibre('perfil-que-no-existe-nunca-xyz');
    assert.strictEqual(n, 0);
  });

  console.log(`\nsimulador: ${ok} ok, ${ko} NO`);
  process.exit(ko ? 1 : 0);
})();
