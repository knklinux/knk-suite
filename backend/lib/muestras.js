'use strict';
/**
 * Guardia de no-determinismo: UNA SOLA MUESTRA NO DA VEREDICTO.
 *
 * La lección del E12 (hallazgo que no se reprodujo hasta la 3ª pasada) hecha
 * guardia reutilizable. Contrato:
 *
 *   · Cada clasificador del suite (veredictoDe del discriminador,
 *     clasificarAlcance de sonda-anon…) declara sus muestras; esta librería
 *     decide si YA HAY veredicto y cuántas muestras faltan.
 *   · Un corte de BORDE (502/503/504/429 o HTML de la periferia) nunca cuenta
 *     como muestra válida: imita respuestas de la aplicación y no la midió.
 *   · Veredicto SOLO con ≥ minMuestras concluyentes y CONCORDANTES entre sí.
 *     Muestras que discrepan → INCONCLUSO, nunca "gana la mayoría".
 *   · `medirConRepeticion` ejecuta la medición tantas veces como haga falta
 *     (con tope) para juntarlas, de modo que ningún driver tenga excusa para
 *     hacer el experimento de una sola pasada.
 *
 * PURA salvo medirConRepeticion (que inyecta `medir` y `sleep`).
 */

/** Mínimo de muestras válidas y concordantes para dar un veredicto. */
const MIN_MUESTRAS = 2;

/**
 * ¿Es un corte de borde? Lo que responde la periferia (CDN, WAF, gateway) en
 * lugar de la aplicación. El E12 lo aprendió a mano: un 502/503 transitorio
 * imita un "el manejador reventó" y una página HTML imita un rechazo.
 * PURA.
 */
function esCorteDeBorde(r) {
  if (!r || r.fase === 'error') return false;
  const cuerpo = String(r.text || r.fragmento || r.cuerpo || '');
  if (/<html[\s>]|<!doctype/i.test(cuerpo)) return true; // página del borde
  return r.status === 429 || r.status === 502 || r.status === 503 || r.status === 504;
}

/**
 * Clasifica una muestra con el clasificador del driver y le añade la verdict
 * de guardia: `esBorde` y `concluyente` (una muestra de borde NUNCA es
 * concluyente aunque el clasificador del driver diga lo contrario — ese es
 * el upgrade que esta guardia impone a `clasificarAlcance`). PURA.
 */
function clasificarMuestra(r, clasificador) {
  if (r && r.fase === 'error') {
    return { veredicto: 'ERROR', motivo: `la medición no concluyó: ${r.error}`, esBorde: false, concluyente: false };
  }
  const v = clasificador(r) || {};
  const esBorde = esCorteDeBorde(r);
  return {
    ...v,
    esBorde,
    concluyente: v.concluyente !== false && !esBorde,
  };
}

/**
 * La decisión de guardia. PURA.
 * @param {Array} muestras  respuestas crudas (una por medición)
 * @param {Function} opciones.clasificador  el del driver (declarativo)
 * @param {number} [opciones.minMuestras]   válido+concordante mínimo (def. 2)
 * @returns {{veredicto, motivo, muestras, validas, necesitaMas, replicado}}
 */
function decidirClasificadas(cs, { minMuestras = MIN_MUESTRAS } = {}) {
  const validas = (cs || []).filter((c) => c.concluyente);

  if (validas.length < minMuestras) {
    const m0 = (cs || [])[0] || null;
    const porque = m0
      ? (m0.esBorde
        ? 'la única muestra fue un corte de borde (no midió la aplicación)'
        : `la muestra no fue concluyente — ${m0.motivo}`)
      : 'sin muestras';
    return {
      veredicto: 'INCONCLUSO',
      motivo: `una sola muestra no es determinista: ${porque}. Segunda medición obligatoria antes de dar veredicto`,
      muestras: cs || [],
      validas: validas.length,
      necesitaMas: Math.max(0, minMuestras - validas.length),
      replicado: false,
    };
  }

  const conteo = {};
  for (const c of validas) conteo[c.veredicto] = (conteo[c.veredicto] || 0) + 1;
  const unicos = Object.keys(conteo);

  if (unicos.length > 1) {
    const detalle = unicos.map((k) => `${k}×${conteo[k]}`).join(', ');
    return {
      veredicto: 'INCONCLUSO',
      motivo: `las muestras válidas discrepan (${detalle}) — ni una muestra ni una discrepancia dan veredicto; medir de nuevo en otra ventana`,
      muestras: cs || [],
      validas: validas.length,
      necesitaMas: 1,
      replicado: false,
    };
  }

  const primera = validas[0];
  return {
    veredicto: primera.veredicto,
    motivo: primera.motivo + (validas.length > 1 ? ` — replicado en ${validas.length} muestras concordantes` : ''),
    muestras: cs || [],
    validas: validas.length,
    necesitaMas: 0,
    replicado: validas.length > 1,
  };
}

function decidir(muestras, { clasificador, minMuestras = MIN_MUESTRAS } = {}) {
  if (typeof clasificador !== 'function') throw new Error('decidir: falta el clasificador del driver');
  return decidirClasificadas((muestras || []).map((m) => clasificarMuestra(m, clasificador)), { minMuestras });
}

/**
 * Medición con la guardia integrada: llama a `medir()` hasta
 * juntar minMuestras válidas concordantes (o agotar maxIntentos). Si la
 * primera fue corte de borde, la segunda puede salvar la pasada; si hay
 * discrepancia, sigue midiendo hasta el tope (el flap en sí es evidencia).
 *
 * @param {Object} o
 * @param {Function} o.medir            async () → respuesta cruda
 * @param {Function} o.clasificador     el del driver
 * @param {number}   [o.minMuestras]    def. MIN_MUESTRAS
 * @param {number}   [o.maxIntentos]    def. 3 (minMuestras + 1 margen de borde)
 * @param {number}   [o.pausaMs]        pausa entre mediciones (0 = sin pausa)
 * @param {Function} [o.sleep]          inyectable para tests
 * @returns {Promise<{muestras: Array, decision: Object}>}
 */
async function medirConRepeticion({
  medir, clasificador, minMuestras = MIN_MUESTRAS, maxIntentos = 3,
  pausaMs = 0, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  if (typeof medir !== 'function') throw new Error('medirConRepeticion: falta medir()');
  const muestras = [];
  const clasificadas = [];
  for (let i = 0; i < maxIntentos; i++) {
    let m;
    try { m = await medir(i); } catch (e) { m = { fase: 'error', error: e && e.message }; }
    muestras.push(m);
    clasificadas.push(clasificarMuestra(m, clasificador));
    const d = decidirClasificadas(clasificadas, { minMuestras });
    if (d.veredicto !== 'INCONCLUSO') return { muestras, decision: d };
    if (i < maxIntentos - 1 && pausaMs > 0) await sleep(pausaMs);
  }
  return { muestras, decision: decidirClasificadas(clasificadas, { minMuestras }) };
}

module.exports = { MIN_MUESTRAS, esCorteDeBorde, clasificarMuestra, decidir, medirConRepeticion };
