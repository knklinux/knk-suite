'use strict';
/**
 * muestras.test.js — la guardia "una sola muestra no es determinista".
 *
 * Tres capas:
 *   1. Puras: esCorteDeBorde, clasificarMuestra (el upgrade que impone la
 *      guardia: el borde NUNCA es concluyente), decidir (mínimo, concordancia,
 *      discrepancia) y medirConRepeticion (repite hasta juntar muestras).
 *   2. Auto-flagelante: los CLASIFICADORES REALES de la suite (veredictoDe del
 *      discriminador y clasificarAlcance de sonda-anon) contra la guardia —
 *      si un cambio futuro delata que un borde podría colarse como concluyente,
 *      este test se rompe solo.
 *   3. barrer() con la guardia y fetchImpl falso: 502 transitorio → réplica →
 *      decisión; flag anti-abuso → aborta tras la sonda que lo desató.
 */

const assert = require('assert');
const muestras = require('./lib/muestras');
const sonda = require('./lib/sonda-anon');
const disc = require('./cdp-discriminador-flag');

let ok = 0; let ko = 0;
function t(nombre, fn) {
  try { fn(); ok++; console.log('  ok — ' + nombre); }
  catch (e) { ko++; console.error(`  FALLO — ${nombre}: ${e.message}`); }
}
async function tA(nombre, fn) {
  try { await fn(); ok++; console.log('  ok — ' + nombre); }
  catch (e) { ko++; console.error(`  FALLO — ${nombre}: ${e.message}`); }
}

const { decidir, clasificarMuestra, esCorteDeBorde, medirConRepeticion, MIN_MUESTRAS } = muestras;

// Clasificadores REALES (mismas instancias que consumen los drivers).
const veredictoDe = disc.veredictoDe;
const clasificarAlcance = sonda.clasificarAlcance;

(async () => {
  console.log('muestras.test.js\n');

  // ── 1. Puras ──────────────────────────────────────────────────────────────
  t('esCorteDeBorde: 502/503/504/429 sí; 403/200/404 no', () => {
    for (const s of [502, 503, 504, 429]) assert.strictEqual(esCorteDeBorde({ status: s, text: '' }), true, String(s));
    for (const s of [200, 403, 404, 500]) assert.strictEqual(esCorteDeBorde({ status: s, text: '' }), false, String(s));
  });

  t('esCorteDeBorde: HTML del periférico (aunque venga con 200 o 403)', () => {
    assert.strictEqual(esCorteDeBorde({ status: 403, text: '<html>challenge</html>' }), true);
    assert.strictEqual(esCorteDeBorde({ status: 200, text: '<!doctype html><html><body>ok</body>' }), true);
  });

  t('clasificarMuestra: el borde NUNCA es concluyente aunque el clasificador lo diga', () => {
    // clasificarAlcance marca un 500 como MANEJADOR concluyente...
    const v500 = clasificarAlcance({ status: 500, text: '{"detail":"boom"}' });
    assert.strictEqual(v500.concluyente, true);
    // ...pero la guardia lo degrada si el cuerpo huele a periferia.
    const degradado = clasificarMuestra({ status: 502, text: 'upstream error' }, clasificarAlcance);
    assert.strictEqual(degradado.esBorde, true);
    assert.strictEqual(degradado.concluyente, false);
    // Y un 500 real de la API (JSON) no es borde: sigue concluyente.
    const api500 = clasificarMuestra({ status: 500, text: '{"detail":"boom"}' }, clasificarAlcance);
    assert.strictEqual(api500.esBorde, false);
    assert.strictEqual(api500.concluyente, true);
  });

  t('decidir: con una sola muestra → INCONCLUSO y necesitaMas=1 (la regla)', () => {
    const d = decidir([{ status: 200, text: '{}' }], { clasificador: veredictoDe });
    assert.strictEqual(d.veredicto, 'INCONCLUSO');
    assert.strictEqual(d.necesitaMas, 1);
    assert.match(d.motivo, /una sola muestra no es determinista/i);
  });

  t('decidir: dos muestras concordantes → veredicto replicado', () => {
    const d = decidir(
      [{ status: 200, text: '{}' }, { status: 200, text: '{}' }],
      { clasificador: veredictoDe },
    );
    assert.strictEqual(d.veredicto, 'FLAG_DEL_CLIENTE_SINTETICO');
    assert.strictEqual(d.replicado, true);
    assert.strictEqual(d.validas, MIN_MUESTRAS);
    assert.match(d.motivo, /replicado en 2 muestras concordantes/);
  });

  t('decidir: discrepancia → INCONCLUSO, nunca gana la mayoría', () => {
    const d = decidir(
      [{ status: 200, text: '{}' }, { status: 403, text: '{"message":"Unusual activity has been detected from your device"}' }],
      { clasificador: veredictoDe },
    );
    assert.strictEqual(d.veredicto, 'INCONCLUSO');
    assert.match(d.motivo, /discrepan/i);
  });

  t('decidir: el borde no cuenta como muestra → INCONCLUSO aunque la otra concluya', () => {
    const d = decidir(
      [{ status: 502, text: 'bad gateway' }, { status: 200, text: '{}' }],
      { clasificador: veredictoDe },
    );
    assert.strictEqual(d.veredicto, 'INCONCLUSO'); // solo 1 válida de 2
    assert.strictEqual(d.validas, 1);
    assert.strictEqual(d.necesitaMas, 1);
  });

  t('decidir: fase error no es muestra válida', () => {
    const d = decidir([{ fase: 'error', error: 'CDP caído' }, { fase: 'error', error: 'CDP caído' }], { clasificador: veredictoDe });
    assert.strictEqual(d.veredicto, 'INCONCLUSO');
    assert.strictEqual(d.validas, 0);
  });

  t('decidir: sin clasificador → error de contrato', () => {
    assert.throws(() => decidir([{ status: 200, text: '{}' }], {}), /clasificador/);
  });

  await tA('medirConRepeticion: repite hasta juntar muestras concordantes', async () => {
    let n = 0;
    const r = await medirConRepeticion({
      medir: async () => (++n === 1 ? { status: 502, text: 'borde' } : { status: 200, text: '{}' }),
      clasificador: veredictoDe,
    });
    assert.strictEqual(n, 3); // la 502 se quemó (no cuenta): 2 válidas exigen 3 llamadas
    assert.strictEqual(r.decision.veredicto, 'FLAG_DEL_CLIENTE_SINTETICO');
    assert.strictEqual(r.muestras.length, 3); // crudas: incluye la 502 quemada
  });

  await tA('medirConRepeticion: se agota el tope sin concordancia → INCONCLUSO con flap documentado', async () => {
    let n = 0;
    const r = await medirConRepeticion({
      medir: async () => (++n % 2 ? { status: 200, text: '{}' } : { status: 403, text: 'Unusual activity has been detected' }),
      clasificador: veredictoDe,
      maxIntentos: 3,
    });
    assert.strictEqual(n, 3);
    assert.strictEqual(r.decision.veredicto, 'INCONCLUSO');
    assert.strictEqual(r.muestras.length, 3);
  });

  // ── 2. Auto-flagelante: clasificadores reales contra la guardia ───────────
  t('AUTO: ningún veredicto del discriminador marca su borde propio como concluyente', () => {
    for (const s of [429, 502, 503, 504]) {
      const c = clasificarMuestra({ status: s, text: '' }, veredictoDe);
      if (!c.esBorde || c.concluyente) {
        throw new Error(`veredictoDe con ${s} se filtra como muestra válida`);
      }
    }
  });

  t('AUTO: clasificarAlcance deja declarado el borde (502 → concluyente:false)', () => {
    const v = clasificarAlcance({ status: 502, text: 'upstream' });
    assert.strictEqual(v.concluyente, false, 'la declaración del clasificador debe negar el borde');
  });

  t('AUTO: clasificarAlcance con 500 JSON (no borde) sigue siendo concluyente', () => {
    const c = clasificarMuestra({ status: 500, text: '{"detail":"x"}' }, clasificarAlcance);
    assert.strictEqual(c.concluyente, true);
    assert.strictEqual(c.esBorde, false);
  });

  // ── 3. barrer() con la guardia y transporte falso ─────────────────────────
  const sondasFalsas = [{ id: 'S-1', prefijo: '/backend-api', ruta: '/conversation', metodo: 'POST', body: {} }];

  await tA('barrer: 502 transitorio → réplica obligatoria → sonda con réplica en la fila', async () => {
    let llamadas = 0;
    const { resultados } = await sonda.barrer(sondasFalsas, {
      pausaMs: 0,
      fetchImpl: async () => (++ llamadas === 1
        ? { status: 502, text: 'bad gateway' }
        : { status: 401, text: '{"detail":"Unauthorized"}' }),
      maxIntentos: 3,
    });
    assert.strictEqual(llamadas, 3, 'la 502 se quemó (no cuenta): 2 válidas exigen 3 llamadas');
    const r = resultados[0];
    assert.strictEqual(r.replicas.length, 3); // crudas: incluye la 502 quemada
    assert.strictEqual(r.status, 401);
    assert.strictEqual(r.alcance, 'GATE_AUTH');
    assert.strictEqual(r.concluyente, true);
    assert.strictEqual(r.nMuestras, 2);
    assert.strictEqual(r.veredictoReplicado, true);
  });

  await tA('barrer: una sonda válida aislada se replica igual (la guardia no confía en muestras únicas)', async () => {
    let llamadas = 0;
    const { resultados } = await sonda.barrer(sondasFalsas, {
      pausaMs: 0,
      fetchImpl: async () => { llamadas++; return { status: 401, text: '{"detail":"Unauthorized"}' }; },
    });
    assert.strictEqual(llamadas, MIN_MUESTRAS, 'aunque la 1ª muestra sea válida, la guardia exige la 2ª antes de veredicto');
    const r = resultados[0];
    assert.strictEqual(r.concluyente, true);
    assert.strictEqual(r.replicas.length, MIN_MUESTRAS);
  });

  await tA('barrer: flag anti-abuso aborta el barrido (política intacta)', async () => {
    const sondas2 = [
      { id: 'S-1', prefijo: '/backend-api', ruta: '/a', metodo: 'GET' },
      { id: 'S-2', prefijo: '/backend-api', ruta: '/b', metodo: 'GET' },
    ];
    let llamadas = 0;
    const { resultados, abortado } = await sonda.barrer(sondas2, {
      pausaMs: 0,
      fetchImpl: async () => {
        llamadas++;
        return { status: 400, text: 'Our systems have detected unusual activity from your device' };
      },
      maxIntentos: 3,
    });
    assert.strictEqual(abortado, true);
    assert.strictEqual(resultados[1].noEjecutada, true);
    assert.ok(llamadas >= MIN_MUESTRAS);
  });

  console.log(`\nmuestras: ${ok} ok, ${ko} NO`);
  process.exit(ko ? 1 : 0);
})();
