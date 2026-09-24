'use strict';
/**
 * barrido-multi.test.js — la capa multi-programa.
 *
 * Lección de esta misma suite: un helper t() que no lanza en condición falsa
 * FINGE resultados (cualquier expectativa falsa cuenta como ✅). Aquí t() es
 * honesto: condición falsa → fallo. Y la fase "rota" es inválida DE VERDAD
 * (nan sin campo → validarConfig la rechaza).
 *
 * Capas:
 *   1. Puras: ritmoGlobal (máximo), validarLote, leerConfig (fallo legible),
 *      sintetizarFase (sondas YA expandidas), resolverReferencia (fichero/dir).
 *   2. Punta a punta SIN red con net.fetch monopolizado:
 *      · seco → 0 llamadas y plan combinado,
 *      · ejecutar → cada fase dispara con SU rate vigente en el limiter global
 *        (observado con net.getRateLimit() DENTRO de la petición),
 *      · la guardia de muestras replica ×2 cada sonda (peticiones = sondas × 2),
 *      · una fase inválida NO tumba la sesión.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('./lib/net');
const M = require('./barrido-multi');

let ok = 0;
function t(nombre, cond) {
  try {
    const r = typeof cond === 'function' ? cond() : cond;
    if (!r) throw new Error('condición falsa');
    ok++; console.log('  ✅ ' + nombre);
  } catch (e) { console.log('  ❌ ' + nombre + ' :: ' + e.message); process.exitCode = 1; }
}

const cfgA = {
  programa: 'prog-a', scope: 'a.test', base: 'https://a.test', rate_limit_ms: 900,
  sondas: [{ id: 'cors-a', tipo: 'cors', metodo: 'GET', ruta: '/pub', origen: 'https://evil.example' }],
};
const cfgB = {
  programa: 'prog-b', scope: 'b.test', base: 'https://b.test', rate_limit_ms: 1800,
  sondas: [
    { id: 'nan-b', tipo: 'nan', metodo: 'POST', ruta: '/precio', campo: 'amount', valores: ['NaN', '-1'], plantilla: { moneda: 'USD' } },
    { id: 'cors-b', tipo: 'cors', metodo: 'GET', ruta: '/items', origen: 'https://evil.example' },
  ],
};
// INVÁLIDA de verdad: sonda nan sin "campo" → validarConfig la rechaza.
const cfgRota = {
  programa: 'rota', scope: 'r.test', base: 'https://r.test',
  sondas: [{ id: 'x', tipo: 'nan', ruta: '/x' }],
};

(async () => {
  console.log('── puras ──');
  t('ritmoGlobal = máximo de las fases', M.ritmoGlobal([{ rate_limit_ms: 900 }, { rate_limit_ms: 1800 }]) === 1800);
  t('ritmoGlobal: fase sin rate usa el default 3000 y puede mandar', M.ritmoGlobal([{ rate_limit_ms: 900 }, {}]) === 3000);
  t('validarLote: no-lista rechazada', M.validarLote('x').length === 1);
  t('validarLote: vacía rechazada', M.validarLote([]).length === 1);
  t('validarLote: referencia no-string rechazada', M.validarLote([42]).length === 1);
  t('leerConfig: fichero que no existe → error legible', (() => {
    const r = M.leerConfig('no-existe.json');
    return !r.cfg && /no se encontró/.test(r.error);
  })());
  t('leerConfig: JSON roto → error legible', (() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lote-'));
    const f = path.join(dir, 'roto.json');
    fs.writeFileSync(f, '{ roto');
    const r = M.leerConfig(f);
    return !r.cfg && /JSON inválido/.test(r.error);
  })());
  t('sintetizarFase: sondas YA expandidas (nan → 2 crudas con valor)', (() => {
    const f = M.sintetizarFase(cfgB);
    return f.nombre === 'prog-b' && f.sondas.length === 3 && f.sondas.some((s) => s.tipo === 'nan' && s.valor === 'NaN');
  })());
  t('resolverReferencia: fichero suelto', (() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lote-'));
    fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify(cfgA));
    const r = M.resolverReferencia('a.json', dir);
    return r.ficheros.length === 1 && r.ficheros[0].endsWith('a.json');
  })());
  t('resolverReferencia: directorio expande *.json ordenados y excluye no-JSON', (() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lote-'));
    fs.writeFileSync(path.join(dir, 'z.json'), JSON.stringify(cfgA));
    fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify(cfgB));
    fs.writeFileSync(path.join(dir, 'nota.txt'), 'x');
    const r = M.resolverReferencia('.', dir);
    return r.ficheros.length === 2 && r.ficheros[0].endsWith('a.json') && r.ficheros[1].endsWith('z.json');
  })());
  t('resolverReferencia: directorio sin *.json → error', (() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lote-'));
    fs.writeFileSync(path.join(dir, 'nota.txt'), 'x');
    return M.resolverReferencia('.', dir).error !== undefined;
  })());

  console.log('── punta a punta SIN red (net.fetch monopolizado) ──');
  const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lote-e2e-'));
  fs.writeFileSync(path.join(dirTmp, 'a.json'), JSON.stringify(cfgA));
  fs.writeFileSync(path.join(dirTmp, 'b.json'), JSON.stringify(cfgB));

  // Seco: 0 llamadas, plan combinado, limiter intacto.
  {
    const original = net.fetch;
    let llamadas = 0;
    net.fetch = async () => { llamadas++; return { status: 200, headers: {}, text: '' }; };
    try {
      const sesion = await M.correr([M.sintetizarFase(cfgA), M.sintetizarFase(cfgB)], { ejecutar: false });
      t('seco: 0 llamadas a fetch y plan_total correcto (1+3 crudas)', llamadas === 0 && sesion.plan_total === 4);
    } finally { net.fetch = original; }
  }

  // Ejecutar: rate por fase en el limiter global + guardia ×2 por sonda.
  {
    const original = net.fetch;
    const ratesVistos = [];
    const urlsVistas = [];
    net.fetch = async (url) => {
      ratesVistos.push(net.getRateLimit());
      urlsVistas.push(String(url));
      return { status: 200, headers: {}, text: '' };
    };
    try {
      const sesion = await M.correr([M.sintetizarFase(cfgA), M.sintetizarFase(cfgB)], { ejecutar: true });
      const esFase = (u, host) => u.includes(host);
      const rateA = ratesVistos.filter((_, i) => esFase(urlsVistas[i], 'a.test'));
      const rateB = ratesVistos.filter((_, i) => esFase(urlsVistas[i], 'b.test'));
      t('ejecutar: fase A = 2 peticiones (1 sonda × guardia ×2) con rate 900', rateA.length === 2 && rateA.every((r) => r === 900));
      t('ejecutar: fase B = 6 peticiones (3 sondas × guardia ×2) con rate 1800', rateB.length === 6 && rateB.every((r) => r === 1800));
      t('ejecutar: peticiones totales sumadas (8)', sesion.peticiones === 8);
      t('ejecutar: fases registradas con veredictos', sesion.fases.length === 2 && sesion.fases[1].veredictos.length === 3);
      t('ejecutar: evidencia escrita en disco', sesion.evidencia && fs.existsSync(path.resolve(sesion.evidencia)));
    } finally { net.fetch = original; }
  }

  // Fase INVÁLIDA en ejecución: error registrado, la sesión sigue.
  {
    const original = net.fetch;
    let llamadas = 0;
    net.fetch = async () => { llamadas++; return { status: 200, headers: {}, text: '' }; };
    try {
      const sesion = await M.correr([M.sintetizarFase(cfgRota), M.sintetizarFase(cfgA)], { ejecutar: true });
      t('fase inválida: error registrado (nan sin campo) y la sesión sigue con prog-a',
        sesion.errores.length === 1 && sesion.errores[0].programa === 'rota'
        && sesion.programas.includes('prog-a') && llamadas === 2);
    } finally { net.fetch = original; }
  }

  console.log(`\n${ok} aserciones OK`);
})().catch((e) => { console.error('FALLO test:', e.message); process.exit(1); });
