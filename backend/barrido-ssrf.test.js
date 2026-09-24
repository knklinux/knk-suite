'use strict';
/**
 * barrido-ssrf.test.js — la sonda SSRF del barrido genérico (instrumento I-005).
 *
 * Sin red y sin tocar la evidencia real (logs del canario en .tmp):
 *   · sondasSsrf: marcador <receptor>, nonce por sonda, plantilla, valores
 *     internos sin marcador.
 *   · clasificadorSsrf PURO contra el log: hit → SOSPECHOSO, sin hit → LIMPIO,
 *     interno procesado → POSIBLE, 5xx → SOSPECHOSO (revisar).
 *   · golpesCanario: solo /hit con EL nonce de esta sonda; ruido fuera.
 *   · urlReceptor: config explícita > última URL pelada del log.
 *   · barrer: sin receptor → rechazo en seco (0 peticiones); con receptor →
 *     urlEnviada y BODY reescritos (bug del marcador cazado en test).
 *   · punta a punta con net.fetch monopolizado: el plan dispara la URL real
 *     con el nonce, y la guardia de muestras replica en discrepancia.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const B = require('./barrido-generico');

let ok = 0;
function t(nombre, cond) {
  try {
    const r = typeof cond === 'function' ? cond() : cond;
    if (!r) throw new Error('condición falsa');
    ok++; console.log('  ✅ ' + nombre);
  } catch (e) { console.log('  ❌ ' + nombre + ' :: ' + e.message); process.exitCode = 1; }
}

// ── log canario temporal ────────────────────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'knk-ssrf-'));
const LOG_JSON = path.join(TMP, 'canario-ssrf-log.json');
const LOG_TXT = path.join(TMP, 'canario-ssrf-log.txt');
const escribeLog = (entradas) => fs.writeFileSync(LOG_JSON, entradas.map((e) => JSON.stringify(e)).join('\n') + '\n');
process.env.KNK_CANARY_LOG = LOG_JSON;
process.env.KNK_CANARY_TXT = LOG_TXT;

(async () => {

  console.log('── sondasSsrf (expansión + guarda anti-regresión del nonce) ──');
  const sonda = { id: 'prev', tipo: 'ssrf', metodo: 'POST', ruta: '/preview', campo: 'url', plantilla: { modo: 'rapido' } };
  const exp = B.expandir({
    base: 'https://a.com',
    sondas: [{ ...sonda, valores: ['https://__RECEPTOR__/step1', 'https://__RECEPTOR__/probe-x', 'https://__RECEPTOR__/p?u=1', 'http://169.254.169.254/latest/meta-data/'] }],
  });
  t('una sonda cruda por valor', exp.length === 4 && exp.every((s) => s.tipo === 'ssrf'));
  // ANTI-REGRESIÓN (2026-09-19): el nonce solo se añadía a valores que acababan
  // en el literal /step1 → cualquier otra ruta iba SIN nonce y un SSRF real
  // habría dado falso LIMPIO. Todo valor al receptor lleva ?v= (o &v=) IGUAL a
  // su nonceEsperado; los internos no lo llevan (se atribuyen por sí mismos).
  const alReceptor = exp.filter((s) => s.valor.includes('__RECEPTOR__'));
  t('GUARDA: TODO valor al receptor lleva v= en urlEnviada', alReceptor.length === 3 && alReceptor.every((s) => /[?&]v=knk-prev-[a-z0-9]{6}/.test(s.urlEnviada)));
  t('GUARDA: el v= de la URL es EXACTAMENTE su nonceEsperado (atribución ligada)', alReceptor.every((s) => s.urlEnviada.endsWith('v=' + s.nonceEsperado)));
  t('GUARDA: valor con query existente usa &v=, no ?v=', exp[2].urlEnviada.includes('?u=1&v=knk-prev-'));
  t('GUARDA: valor interno sin marcador no lleva v=', !exp[3].urlEnviada.includes('v='));
  t('el marcador __RECEPTOR__ viaja en la URL (la real la inyecta barrer)', exp[0].urlEnviada.includes('__RECEPTOR__'));
  t('la plantilla conserva el resto de campos y lleva el campo con la URL',
    exp[0].body.includes('"modo":"rapido"') && exp[0].body.includes('"url":"https://__RECEPTOR__'));

  console.log('── clasificadorSsrf (puro, contra log temporal) ──');
  escribeLog([
    { ts: 'T1', ip: '10.1.2.3', ua: 'python-requests', path: '/hit', query: { canary: 'knk-prev-abc123' }, urlCompleta: '/hit?canary=knk-prev-abc123' },
    { ts: 'T2', ip: '10.1.2.3', ua: 'python-requests', path: '/hit', query: { canary: 'knk-prev-abc123' }, urlCompleta: '/hit?canary=knk-prev-abc123' },
  ]);
  t('2 golpes del nonce → SOSPECHOSO concluyente', (() => {
    const v = B.clasificadorSsrf({ status: 200, cuerpo: 'ok', urlEnviada: 'https://tunel/step1?v=knk-prev-abc123', nonceEsperado: 'knk-prev-abc123' });
    return v.veredicto === 'SOSPECHOSO' && v.concluyente === true && v.golpes.length === 2;
  })());

  escribeLog([{ ts: 'T3', ip: '10.1.2.3', ua: 'x', path: '/step1', query: { v: 'knk-prev-abc123' }, urlCompleta: '/step1?v=knk-prev-abc123' }]);
  t('solo /hit cuenta: el paso por /step1 NO es golpe', (() => {
    const v = B.clasificadorSsrf({ status: 200, cuerpo: 'ok', urlEnviada: 'x', nonceEsperado: 'knk-prev-abc123' });
    return v.veredicto === 'LIMPIO';
  })());

  escribeLog([{ ts: 'T4', ip: '9.9.9.9', ua: 'curl', path: '/hit', query: { canary: 'knk-otra-zzz999' }, urlCompleta: '/hit?canary=knk-otra-zzz999' }]);
  t('golpe de OTRA sonda (otro nonce) → no contamina', (() => {
    const v = B.clasificadorSsrf({ status: 200, cuerpo: 'ok', urlEnviada: 'x', nonceEsperado: 'knk-prev-abc123' });
    return v.veredicto === 'LIMPIO';
  })());

  t('interna procesada sin hit → POSIBLE (no inflado)', (() => {
    const v = B.clasificadorSsrf({ status: 200, cuerpo: 'ok', urlEnviada: 'http://169.254.169.254/latest/meta-data/', nonceEsperado: 'knk-nadie' });
    return v.veredicto === 'POSIBLE';
  })());
  t('interna con 401/403 → LIMPIO (el gate cortó)', (() => {
    const v = B.clasificadorSsrf({ status: 403, cuerpo: 'denied', urlEnviada: 'http://169.254.169.254/', nonceEsperado: 'knk-nadie' });
    return v.veredicto === 'LIMPIO';
  })());
  t('5xx al enviar nuestra URL → SOSPECHOSO (revisar cuerpo)', (() => {
    const v = B.clasificadorSsrf({ status: 500, cuerpo: 'boom', urlEnviada: 'https://tunel/step1?v=knk-nadie', nonceEsperado: 'knk-nadie' });
    return v.veredicto === 'SOSPECHOSO';
  })());

  console.log('── urlReceptor ──');
  t('config explícita gana', B.urlReceptor({ receptor: 'https://fija.trycloudflare.com' }) === 'https://fija.trycloudflare.com');
  fs.writeFileSync(LOG_TXT, 'ruido\nhttps://vieja.trycloudflare.com\nhttps://nueva.trycloudflare.com\n');
  t('última URL pelada del log del canary', B.urlReceptor() === 'https://nueva.trycloudflare.com');
  t('sin log → null', B.urlReceptor({}, path.join(TMP, 'no-existe.txt')) === null);
  console.log('── injertarReceptor (el doble esquema que el CLI delató) ──');
  t('plantilla CON esquema → injerta solo el host',
    B.injertarReceptor('https://__RECEPTOR__/step1?v=knk-x', 'https://vivo.trycloudflare.com') === 'https://vivo.trycloudflare.com/step1?v=knk-x');
  t('plantilla SIN esquema → URL completa',
    B.injertarReceptor('__RECEPTOR__/step1', 'https://vivo.trycloudflare.com') === 'https://vivo.trycloudflare.com/step1');
  t('plantilla de OTRO esquema → sin doble ://',
    B.injertarReceptor('gopher://__RECEPTOR__/x', 'https://vivo.trycloudflare.com') === 'gopher://vivo.trycloudflare.com/x');

  console.log('── barrer: receptor y reescritura ──');
  const cfgSsrf = {
    programa: 'test-ssrf', scope: 'api.test.local', base: 'https://api.test.local',
    rate_limit_ms: 1,
    sondas: [{ ...sonda, valores: ['https://__RECEPTOR__/step1'] }],
  };
  fs.writeFileSync(LOG_TXT, 'ruido\n');
  const rSeco = await B.barrer(cfgSsrf, { seco: true });
  t('seco sin receptor → rechazo honesto (0 peticiones)', rSeco.ok === false && rSeco.peticiones === 0 && rSeco.errores[0].includes('receptor'));

  const net = require('./lib/net');
  const original = net.fetch;
  const vistas = [];
  net.fetch = async (url, opts) => { vistas.push({ url: String(url), body: opts && opts.body }); return { status: 200, headers: {}, text: 'ok' }; };
  try {
    const r = await B.barrer({ ...cfgSsrf, receptor: 'https://vivo.trycloudflare.com' }, { seco: false });
    t('guardia ×2: la petición al objetivo se disparó dos veces, a SU url exacta',
      vistas.length === 2 && vistas.every((v) => v.url === 'https://api.test.local/preview'));
    t('el BODY lleva el receptor real con nonce (sin marcador ni doble esquema)',
      vistas.every((v) => /https:\/\/vivo\.trycloudflare\.com\/step1\?v=knk-prev-[a-z0-9]{6}/.test(String(v.body))
        && !String(v.body).includes('__RECEPTOR__') && !String(v.body).includes('https://https://')));
    t('la plantilla sobrevive en el BODY junto a la URL inyectada',
      vistas.every((v) => String(v.body).includes('"modo":"rapido"')));
    t('LIMPIO con log sin golpes de ESTE nonce', r.resultados[0].veredicto === 'LIMPIO' && r.resultados[0].nMuestras === 2);
  } finally { net.fetch = original; }

  console.log('── punta a punta: golpes del canario deciden el veredicto ──');
  {
    const net2 = require('./lib/net');
    const original2 = net2.fetch;
    // El objetivo "fetcha" la URL que viaja en el BODY: el golpe llega con EL nonce del cuerpo
    net2.fetch = async (url, opts) => {
      const m = String((opts && opts.body) || '').match(/v=(knk-[a-z0-9-]+)/);
      if (m) {
        escribeLog([
          { ts: 'T5', ip: '10.0.0.5', ua: 'go-http-client', path: '/hit', query: { canary: m[1] }, urlCompleta: '/hit?canary=' + m[1] },
          { ts: 'T6', ip: '10.0.0.5', ua: 'go-http-client', path: '/hit', query: { canary: m[1] }, urlCompleta: '/hit?canary=' + m[1] },
        ]);
      }
      return { status: 200, headers: {}, text: 'preview generado' };
    };
    try {
      const r = await B.barrer({ ...cfgSsrf, receptor: 'https://vivo.trycloudflare.com' }, { seco: false });
      t('el objetivo fetchó la URL → SOSPECHOSO replicado (2 muestras concordantes)',
        r.sospechosos.length === 1 && r.resultados[0].veredicto === 'SOSPECHOSO' && r.resultados[0].nMuestras === 2);
    } finally { net2.fetch = original2; }
  }

  console.log('── discrepancia en golpes → INCONCLUSO (la guardia manda) ──');
  {
    const net3 = require('./lib/net');
    const original3 = net3.fetch;
    let n = 0;
    net3.fetch = async (url, opts) => {
      n++;
      const m = String((opts && opts.body) || '').match(/v=(knk-[a-z0-9-]+)/);
      if (m && n === 1) {
        escribeLog([{ ts: 'T7', ip: '10.0.0.6', ua: 'x', path: '/hit', query: { canary: m[1] }, urlCompleta: '/hit?canary=' + m[1] }]);
      } else {
        escribeLog([]);
      }
      return { status: 200, headers: {}, text: 'ok' };
    };
    try {
      const r = await B.barrer({ ...cfgSsrf, receptor: 'https://vivo.trycloudflare.com' }, { seco: false });
      t('golpe/no-golpe entre muestras → INCONCLUSO, nunca mayoría',
        r.resultados[0].veredicto === 'INCONCLUSO' && r.inconclusos.length === 1);
    } finally { net3.fetch = original3; }
  }

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('\n' + ok + ' ok' + (process.exitCode ? ' (con fallos)' : ''));
})().catch((e) => { console.error('FALLO:', e); process.exit(1); });
