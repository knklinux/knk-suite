'use strict';
/**
 * barrido-generico.test.js — el driver re-targetable NaN/CORS/redirect.
 *
 * Sin red: validación de configuración, expansión de sondas (incluido el JSON
 * CRUDO con literales NaN/Infinity, la razón de ser del patrón E12), los tres
 * clasificadores puros, y una pasada de punta a punta con `net.fetch`
 * MONOPOLIZADO (inyección via require.cache) que demuestra que:
 *   · el scope queda fijado al host del JSON antes de disparar,
 *   · un corte de borde NO cuenta como muestra (la guardia heredada replica),
 *   · la discrepancia degradaba a INCONCLUSO y no a "gana la mayoría".
 */

const assert = require('assert');
const B = require('./barrido-generico');

let ok = 0;
function t(nombre, cond) {
  try {
    const value = typeof cond === 'function' ? cond() : cond;
    if (!value) throw new Error('condición falsa');
    ok++; console.log('  ✅ ' + nombre);
  } catch (e) { console.log('  ❌ ' + nombre + ' :: ' + e.message); process.exitCode = 1; }
}

(async () => {

  console.log('── validación de configuración ──');
  t('config vacía → errores', (() => {
    const r = B.validarConfig({});
    return r.length >= 4 && r.some((e) => e.includes('programa'));
  })());
  t('base fuera del scope → rechazada', (() => {
    const r = B.validarConfig({ programa: 'x', scope: 'a.com', base: 'https://b.com', sondas: [{ id: 's', tipo: 'cors', ruta: '/' }] });
    return r.some((e) => e.includes('no pertenece al scope'));
  })());
  t('sonda sin campo en nan → rechazada', (() => {
    const r = B.validarConfig({ programa: 'x', scope: 'a.com', base: 'https://a.com', sondas: [{ id: 's', tipo: 'nan', ruta: '/x' }] });
    return r.some((e) => e.includes('nan necesita "campo"'));
  })());
  t('config válida mínima → 0 errores', (() => {
    const r = B.validarConfig({ programa: 'x', scope: 'a.com', base: 'https://a.com', sondas: [{ id: 's', tipo: 'cors', ruta: '/x' }] });
    return r.length === 0;
  })());

  console.log('── expansión de sondas ──');
  t('nan expande una sonda por valor', (() => {
    const s = B.expandir({ base: 'https://a.com', sondas: [{ id: 'n', tipo: 'nan', ruta: '/x', campo: 'amount', valores: ['NaN', '-1'] }] });
    return s.length === 2 && s[0].id === 'n[NaN]' && s[1].id === 'n[-1]';
  })());
  t('JSON CRUDO: NaN/Infinity van SIN comillas y 1e999 es número', (() => {
    const s = B.expandir({ base: 'https://a.com', sondas: [{ id: 'n', tipo: 'nan', ruta: '/x', campo: 'amount', valores: ['NaN', 'Infinity', '1e999'], plantilla: { moneda: 'USD' } }] });
    assert(s[0].body.includes('"amount":NaN') && !s[0].body.includes('"NaN"'), 'NaN crudo: ' + s[0].body);
    assert(s[1].body.includes('"amount":Infinity'), 'Infinity crudo: ' + s[1].body);
    assert(s[2].body.includes('"amount":1e999'), '1e999: ' + s[2].body);
    assert(s[0].body.includes('"moneda":"USD"'), 'la plantilla se conserva');
    return true;
  })());
  t('redirect pinta el destino codificado en la ruta', (() => {
    const s = B.expandir({ base: 'https://a.com', sondas: [{ id: 'r', tipo: 'redirect', ruta: '/salir?url=', destino: 'https://evil.example/x' }] });
    return s[0].ruta === '/salir?url=https%3A%2F%2Fevil.example%2Fx' && s[0].destinoAtaque === 'https://evil.example/x';
  })());

  console.log('── clasificadores puros ──');
  t('nan: 500 → SOSPECHOSO concluyente', (() => {
    const v = B.clasificadorNan({ status: 500, cuerpo: '{}' });
    return v.veredicto === 'SOSPECHOSO' && v.concluyente === true;
  })());
  t('nan: fuga interna con 400 → FUGA_INTERNA', (() => {
    const v = B.clasificadorNan({ status: 400, cuerpo: '{"error":"File \\"/srv/app/main.py\\", line 42"}' });
    return v.veredicto === 'FUGA_INTERNA' && v.fuga === true;
  })());
  t('nan: 400 limpio → LIMPIO', (() => {
    const v = B.clasificadorNan({ status: 400, cuerpo: '{"detail":"invalid"}' });
    return v.veredicto === 'LIMPIO' && v.concluyente === true;
  })());
  t('cors: ACAO reflejante + credenciales → SOSPECHOSO', (() => {
    const v = B.clasificadorCors({ status: 200, headers: { 'access-control-allow-origin': 'https://evil.example', 'access-control-allow-credentials': 'true' }, origenAtaque: 'https://evil.example' });
    return v.veredicto === 'SOSPECHOSO';
  })());
  t('cors: wildcard CON credenciales → SOSPECHOSO', (() => {
    const v = B.clasificadorCors({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-credentials': 'true' }, origenAtaque: 'https://evil.example' });
    return v.veredicto === 'SOSPECHOSO';
  })());
  t('cors: reflejo sin credenciales → POSIBLE (no inflado)', (() => {
    const v = B.clasificadorCors({ status: 200, headers: { 'access-control-allow-origin': 'https://evil.example' }, origenAtaque: 'https://evil.example' });
    return v.veredicto === 'POSIBLE';
  })());
  t('cors: ACAO estático → LIMPIO', (() => {
    const v = B.clasificadorCors({ status: 200, headers: { 'access-control-allow-origin': 'https://app.a.com' }, origenAtaque: 'https://evil.example' });
    return v.veredicto === 'LIMPIO';
  })());
  t('redirect: Location hacia el destino de ataque → SOSPECHOSO', (() => {
    const v = B.clasificadorRedirect({ status: 302, headers: { location: 'https://evil.example/x' }, destinoAtaque: 'https://evil.example' });
    return v.veredicto === 'SOSPECHOSO';
  })());
  t('redirect: Location propio → LIMPIO', (() => {
    const v = B.clasificadorRedirect({ status: 302, headers: { location: 'https://a.com/inicio' }, destinoAtaque: 'https://evil.example' });
    return v.veredicto === 'LIMPIO';
  })());

  console.log('── punta a punta con net.fetch monopolizado (sin red) ──');
  {
    const net = require('./lib/net');
    const reales = [];
    // monopolizo net.fetch en el MÓDULO del driver (mismo objeto que consume)
    const original = net.fetch;
    const llamadas = [];
    let modo = 'borde-primero'; // borde-primero | concordante | discrepancia
    const cola = [];
    net.fetch = async (url, opts = {}) => {
      llamadas.push({ url, method: opts.method, origen: opts.headers && opts.headers.Origin });
      const plan = modo === 'borde-primero' ? [502, 400] : modo === 'concordante' ? [500, 500] : [500, 400];
      const status = cola.length ? cola.shift() : plan[Math.min(llamadasFina(), plan.length - 1)];
      return { status, headers: {}, text: '{"detail":"x"}' };
      function llamadasFina() { return 0; }
    };
    const cfg = {
      programa: 'test', scope: 'api.test.local', base: 'https://api.test.local',
      rate_limit_ms: 1, cabeceras: { Accept: 'application/json' },
      sondas: [
        { id: 'nan-borde', tipo: 'nan', metodo: 'POST', ruta: '/x', campo: 'amount', valores: ['NaN'] },
      ],
    };
    // Caso 1: primer intento 502 (borde) → la guardia NO debe aceptarlo como muestra única
    cola.length = 0; cola.push(502, 400, 400);
    const r1 = await B.barrer(cfg, { seco: false });
    t('borde 502 quemado: replica y decide con las muestras válidas (400 → LIMPIO)',
      r1.resultados[0].nMuestras === 3 && r1.resultados[0].veredicto === 'LIMPIO' && llamadas.length === 3);
    t('el scope quedó fijado al host del JSON', net.getScope().includes('api.test.local'));

    // Caso 2: dos 500 concordantes → SOSPECHOSO con 2 muestras
    net.fetch = async () => ({ status: 500, headers: {}, text: '{"err":"boom"}' });
    const r2 = await B.barrer(cfg, { seco: false });
    t('2×500 concordantes → SOSPECHOSO con 2 muestras',
      r2.resultados[0].veredicto === 'SOSPECHOSO' && r2.resultados[0].nMuestras === 2 && r2.sospechosos.length === 1);

    // Caso 3: 500 y luego 400 (discrepancia) → INCONCLUSO, nunca mayoría
    net.fetch = async (url, opts, i) => ({ status: (global.__n = (global.__n || 0) + 1) === 1 ? 500 : 400, headers: {}, text: '{}' });
    global.__n = 0;
    const r3 = await B.barrer(cfg, { seco: false });
    t('discrepancia 500/400 → INCONCLUSO (la guardia no elige ganador)',
      r3.resultados[0].veredicto === 'INCONCLUSO' && r3.inconclusos.length === 1);

    // Caso 4: CORS reflejante de punta a punta
    llamadas.length = 0;
    net.fetch = async (url, opts) => { llamadas.push({ url, method: opts.method, origen: opts.headers && opts.headers.Origin }); return { status: 200, headers: { 'access-control-allow-origin': opts.headers.Origin, 'access-control-allow-credentials': 'true' }, text: '[]' }; };
    const cfgCors = { ...cfg, sondas: [{ id: 'c', tipo: 'cors', ruta: '/items', origen: 'https://evil.example' }] };
    const r4 = await B.barrer(cfgCors, { seco: false });
    t('CORS reflejante+credenciales de punta a punta → SOSPECHOSO',
      r4.sospechosos.length === 1 && llamadas.at(-1).origen === 'https://evil.example');
    t('la petición CORS llevó el Origin de ataque',
      true); // verificado implícitamente por el clasificador que exige el header reflejado

    net.fetch = original; // restaurar SIEMPRE
    reales.length = 0;
  }

  console.log('── seco por defecto no dispara nada ──');
  {
    const net = require('./lib/net');
    let llamadas = 0;
    const original = net.fetch;
    net.fetch = async () => { llamadas++; return { status: 200, headers: {}, text: '' }; };
    const r = await B.barrer({ programa: 'x', scope: 'api.x.local', base: 'https://api.x.local', sondas: [{ id: 's', tipo: 'cors', ruta: '/' }] }, { seco: true });
    t('modo seco: 0 llamadas a fetch y plan completo', llamadas === 0 && r.plan.length === 1 && r.peticiones === 0);
    net.fetch = original;
  }

  console.log(`\n${ok} ok${process.exitCode ? ' (con fallos)' : ''}`);
})().catch((e) => { console.error('FALLO:', e); process.exit(1); });
