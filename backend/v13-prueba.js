'use strict';
// v13-prueba.js — Autotest del detector V13 (sin red, sin peticiones)
//   node backend/v13-prueba.js
// Verifica: reglas de detección, allowlist de ids propios, dedup, redacción
// y que escanear() nunca lanza sobre entradas basura.

const assert = require('assert');
const fs = require('fs');
const v13 = require('./lib/v13-detector');

let pasadas = 0;

function caso(nombre, fn) {
  fn();
  pasadas++;
  console.log(`  ✅ ${nombre}`);
}

console.log('== V13 autotest ==\n');

// Preparamos allowlist de "nuestras" entidades (como haría un driver)
v13.registrarEntidadesConocidas([
  'user-hDI8xdVTY6zahW36WXAsVD8e',
  'user-i5BbEjemploDeCuentaB',
]);

caso('1) JSON de control limpio → sin alerta', () => {
  const r = v13.escanear('{"status":"ok","conversation_id":"abc123","model":"gpt-4o"}', 'test-limpio');
  assert.strictEqual(r, null);
});

caso('2) ICD-10 en contexto clínico → alerta', () => {
  const r = v13.escanear('The patient record shows diagnosis E11.9 confirmed on 2025-03-14 by Dr. review.', 'test-icd10');
  assert.ok(r, 'debería alertar');
  assert.ok(r.alertas.some((a) => a.regla === 'icd10-clinico'));
});

caso('3) Registro PII formateado → alerta redactada', () => {
  const r = v13.escanear('patient: John Smith, DOB 1972-04-01, chart review pending', 'test-pii');
  assert.ok(r, 'debería alertar');
  // Redacción: el nombre NO puede aparecer en la muestra guardada
  assert.ok(!r.fragmento.includes('John Smith'), 'el nombre debe estar redactado');
  assert.ok(r.fragmento.includes('[REDACTADO-P3]'));
});

caso('4) UUID ajeno → alerta; UUID propio → sin alerta', () => {
  const ajeno = v13.escanear('context merged with session user-9f8e7d6c-1111-2222-3333-444455556666 unexpectedly', 'test-uuid-ajeno');
  assert.ok(ajeno, 'uuid ajeno debería alertar');
  const propio = v13.escanear('session for user-hDI8xdVTY6zahW36WXAsVD8e validated', 'test-uuid-propio');
  assert.strictEqual(propio, null, 'uuid propio NO debe alertar');
});

caso('5) JSON corto con prosa médica y sin tokens propios → alerta control', () => {
  const r = v13.escanear('{"summary":"patient born 1990 has treatment plan attached"}', 'test-json-control');
  assert.ok(r, 'debería alertar');
  assert.ok(r.alertas.some((a) => a.regla === 'fichero-ajeno-en-json-de-control'));
});

caso('6) Dedup: el mismo texto no alerta dos veces', () => {
  const txt = 'diagnosis Z99.89 in chart of unrelated party, review needed';
  const primera = v13.escanear(txt, 'dedup-1');
  const segunda = v13.escanear(txt, 'dedup-2');
  assert.ok(primera, 'primera debería alertar');
  assert.strictEqual(segunda, null, 'segunda debe estar deduplicada');
});

caso('7) Entradas basura nunca lanzan', () => {
  for (const basura of [null, undefined, '', 'x', 42, {}, [], '¡'.repeat(5000)]) {
    assert.doesNotThrow(() => v13.escanear(basura, 'basura'));
  }
});

caso('8) Email y teléfono se redactan', () => {
  const r = v13.escanear('account holder: Maria Lopez, contact maria.lopez@gmail.com, phone +34 612 345 678, file note', 'test-redaccion');
  assert.ok(r, 'debería alertar');
  assert.ok(!r.fragmento.includes('maria.lopez@gmail.com'), 'email redactado');
  assert.ok(!r.fragmento.includes('612 345 678'), 'teléfono redactado');
});

caso('9) Hook de resultado no altera la respuesta', () => {
  const resp = { ok: true, status: 200, text: '{"all":"normal"}' };
  const out = v13.hookResultadoFetch(resp, 'hook-test');
  assert.strictEqual(out, resp, 'debe devolver el MISMO objeto');
});

// Verificar que el jsonl de alertas existe y tiene las de este test
const fichero = v13._salida();
const lineas = fs.existsSync(fichero) ? fs.readFileSync(fichero, 'utf8').trim().split('\n').filter(Boolean) : [];
console.log(`\n  📄 alertas escritas en ${fichero} (total acumulado: ${lineas.length})`);
assert.ok(lineas.length >= 6, 'deberían existir las alertas del test');

console.log(`\n✅ ${pasadas}/9 casos pasados. Detector operativo y sin romper respuestas.`);
console.log('   Integración: hook automático vía net.fetch (compuerta + drivers).');
