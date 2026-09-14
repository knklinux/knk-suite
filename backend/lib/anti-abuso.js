'use strict';
// ============================================================================
// lib/anti-abuso.js — Backoff exponencial ante 403 "Unusual activity"
//
// Problema que resuelve: cuando el anti-abuso marca una cuenta (patrón E16),
// los drivers seguían ejecutando el resto de sus pasos contra un backend que
// rechaza todo → peticiones gastadas, flag prolongado, evidencia inservible.
//
// Comportamiento de conAntiAbuso(fn, etiqueta):
//   1) 403 "Unusual activity" → espera BACKOFF_BASE ms y reintenta
//   2) cada reintento duplica la espera (backoff exponencial: 15 s → 30 s → 60 s)
//   3) si se agotan MAX_REINTENTOS, aborta el proceso completo con exit 4
//      SIN ejecutar más peticiones del vector (política E16: nunca insistir
//      contra un flag activo)
//
// Importante: NO es evasión. El backoff respeta y amplía el ritmo; si el
// backend dice "try again later" y el flag no cae en los reintentos, la
// respuesta correcta es parar y reportar, no colarse.
//
// Uso en un driver A/B:
//   const { conAntiAbuso, esAntiAbuso } = require('./lib/anti-abuso');
//   const r = await conAntiAbuso(() => call('POST', ruta, ...), 'paso-1a');
//   // o dentro del wrapper existente:
//   //   return conAntiAbuso(() => net.fetch(...), `${metodo} ${ruta}`);
//
// Cumplimiento: pausas >= 15 s (muy por encima del rate limit de 2,2 s),
// máx 3 reintentos, sin datos de terceros, sin cambio de identidad/UA.
// ============================================================================

const BACKOFF_BASE_MS = 15000;   // primera espera tras el 1er 403
const MAX_REINTENTOS = 3;        // 15s → 30s → 60s; si sigue el 403, abortar
const EXIT_BLOQUEADO = 4;        // código compartido con los drivers bloqueados

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ¿Es esta respuesta un 403 del anti-abuso? (patrón E16, con o sin detail) */
function esAntiAbuso(respuesta) {
  if (!respuesta || respuesta.status !== 403) return false;
  return /unusual activity/i.test(String(respuesta.text || respuesta.body || ''));
}

/**
 * Ejecuta fn() con backoff exponencial ante 403 "Unusual activity".
 * fn debe ser una función sin argumentos que devuelve la respuesta
 * (o una promesa de ella) y NO debe tener efectos previos a la petición.
 * Etiqueta solo para los mensajes de log/evidencia.
 */
async function conAntiAbuso(fn, etiqueta = 'petición') {
  let espera = BACKOFF_BASE_MS;
  for (let intento = 0; intento <= MAX_REINTENTOS; intento++) {
    const r = await fn();
    if (!esAntiAbuso(r)) return r;

    if (intento === MAX_REINTENTOS) {
      // Agotados los reintentos: el flag persiste. Parar TODO el driver.
      console.error(`\n⛔ [anti-abuso] ${etiqueta}: 403 "Unusual activity" persiste tras ${MAX_REINTENTOS} reintentos con backoff (15s/30s/60s).`);
      console.error('   POLÍTICA E16: no se insiste contra un flag activo — abortando el driver SIN más peticiones.');
      console.error('   Acción: esperar >=24 h sin tocar /conversation con esta cuenta y relanzar.');
      process.exit(EXIT_BLOQUEADO);
    }

    console.warn(`⏳ [anti-abuso] ${etiqueta}: 403 "Unusual activity" — backoff exponencial, esperando ${espera / 1000}s antes del reintento ${intento + 1}/${MAX_REINTENTOS}...`);
    await sleep(espera);
    espera *= 2;
  }
  // inalcanzable (el bucle retorna o sale por exit)
}

module.exports = { conAntiAbuso, esAntiAbuso, BACKOFF_BASE_MS, MAX_REINTENTOS, EXIT_BLOQUEADO };
