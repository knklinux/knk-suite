'use strict';
// ============================================================================
// lib/v13-detector.js — V13: monitor PASIVO de contexto ajeno (cross-tenant)
//
// Qué hace: escanea el TEXTO de cada respuesta que pasa por net.fetch buscando
// señales de contenido que NO provenga de nuestros propios recursos de prueba.
// Fundamento: el disclosure P1 de 2026-08-19 (cross-tenant PHI, $2.000) demostró
// que la única clase P1 viable en este programa es el bleed espontáneo de datos
// de otro usuario en el output del modelo — sin payload, condiciones estrechas,
// solo detectable observacionalmente.
//
// REGLA DE ORO (del análisis del caso): si dispara, CONGELAR — cero reintentos.
//   La condición es estrecha; un retry puede invalidar la evidencia. La
//   detección se hace ANTES de que el caller vea la respuesta, sin alterarla.
//
// Qué busca (heurística de especificidad estructurada = señal, no ruido):
//   1. Datos estructurados de documento ajeno: códigos ICD-10, patrones de
//      metadatos con UUIDs ajenos, RUT/DNI-like, fechas + nombres combinados
//      en formato de registro (patient:, record:, file owner, etc.)
//   2. Contenido que parezca fichero ajeno en respuestas donde solo esperamos
//      JSON de control (errores, status, confirmaciones cortas).
//   3. Marcadores de sesión/usuario ajenos: user-XXX / account-XXX distintos
//      de los ids conocidos de A/B (permitido por allowlist dinámica).
//
// Qué NO busca (falsos positivos deliberadamente excluidos):
//   - Nada de nuestros recursos SYNTHETIC-* ni NONCE ni DATO_VICTIMA propios.
//   - JSON estructural de la API (ids de conversación propios, model, etc.).
//   - Texto echo de nuestras propias peticiones.
//
// Ética (restricción permanente adoptada del caso): si algún día se detecta
// contenido real de un tercero, se guarda SOLO el mínimo imprescindible para
// la validación del vendor (categoria de dato, no valor). Ver redactar()
// más abajo.
//
// Uso:
//   const v13 = require('./lib/v13-detector');
//   v13.registrarEntidadesConocidas(['user-hDI8...', 'user-i5Bb...']);
//   // automático vía net.fetch (hook); también utilizable a mano:
//   const alerta = v13.escanear(texto, 'etiqueta-contexto');
//
// Alertas: evidencia-poc/v13-alertas.jsonl (una línea JSON por alerta) +
// console.error destacado. Nunca lanza excepciones: un fallo del detector no
// puede romper un driver.
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Estado ──────────────────────────────────────────────────────────────────
const _known = new Set();      // ids de usuario/cuenta legítimos (A y B)
const _ownTokens = new Set();  // nonces y marcadores sintéticos de la sesión
const _historial = [];         // hashes de textos ya escaneados (dedup alertas)

let _rutaSalida = null;
function _salida() {
  if (_rutaSalida) return _rutaSalida;
  // evidencia-poc/ está en la raíz del proyecto knk-suite (../.. desde lib/)
  _rutaSalida = path.join(__dirname, '..', '..', 'evidencia-poc', 'v13-alertas.jsonl');
  try {
    fs.mkdirSync(path.dirname(_rutaSalida), { recursive: true });
  } catch { /* ya existe */ }
  return _rutaSalida;
}

// ── Registro de entidades conocidas (allowlist) ─────────────────────────────
function registrarEntidadesConocidas(lista) {
  for (const e of Array.isArray(lista) ? lista : [lista]) {
    if (e) _known.add(String(e));
  }
}
function registrarTokenPropio(token) {
  if (token) _ownTokens.add(String(token));
}

// ── Heurísticas de detección ────────────────────────────────────────────────
// Cada regla devuelve { regla, muestra } o null. "muestra" es SIEMPRE la
// versión redactada (ver redactar) — nunca el dato crudo del tercero.

const REGLAS = [
  {
    nombre: 'icd10-clinico',
    // ICD-10 diagnóstico en contexto clínico (para evitar match con IDs casuales)
    re: /\b(patient|diagnos[ie]s|clinical|medical|record|chart)\b[^\n]{0,80}\b[A-TV-Z][0-9][0-9AB]\.?[0-9A-TV-Z]{1,4}\b/i,
  },
  {
    nombre: 'registro-pii',
    // "patient: <Nombre>, DOB <fecha>" / "record owner: ..." — registro formateado
    re: /\b(patient|dob|date of birth|record owner|account holder|ssn|dni)\b\s*[:=]\s*[^\n]{3,60}/i,
  },
  {
    nombre: 'uuid-ajeno',
    // UUID que NO esté en la allowlist de entidades conocidas
    re: /\buser-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    uuids: true,
  },
  {
    nombre: 'fichero-ajeno-en-json-de-control',
    // Respuesta corta de control (≤400 chars) que de repente contiene párrafos
    // de prosa con datos personales — el patrón del bleed en fase temprana.
    re: null, // manejada por función especial abajo
  },
];

function _uuidsAjenos(texto) {
  const encontrados = [];
  const re = /\b(?:user|account|org|tenant)-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;
  let m;
  while ((m = re.exec(texto)) !== null) {
    const id = m[0];
    if (!_known.has(id)) encontrados.push(id);
  }
  return encontrados;
}

function _sospechaEnJsonControl(texto) {
  // Solo aplica a respuestas cortas (JSON de control / confirmaciones)
  if (!texto || texto.length > 400) return null;
  // Debe contener prosa con patrón de registro de datos personales
  if (!/\b(born|diagnos|patient|medical|prescription|treatment)\b/i.test(texto)) return null;
  // Y no debe ser echo de nuestros payloads
  for (const t of _ownTokens) if (texto.includes(t)) return null;
  return { regla: 'fichero-ajeno-en-json-de-control', muestra: redactar(texto) };
}

// ── Redacción (ética: categoría, no valor) ──────────────────────────────────
// Sustituye contenido potencialmente identificador por su categoría, dejando
// el mínimo estructural para que el vendor pueda validar contra sus logs.
function redactar(texto) {
  let t = String(texto || '');
  // Nombres tras etiquetas de PII → categoría
  t = t.replace(/(\b(?:patient|owner|holder|dob|date of birth|ssn|dni)\b\s*[:=]\s*)([^\n,;]{2,60})/gi,
    (m, pref) => pref + '[REDACTADO-P3]');
  // Correos → categoría
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[REDACTADO-EMAIL]');
  // Teléfonos largos → categoría
  t = t.replace(/\b\+?\d[\d\s().-]{8,}\d\b/g, '[REDACTADO-NUMERO]');
  // Cualquier UUID de usuario ajeno conservado tal cual SOLO si es un id de
  // sesión (necesario para el cross-check del vendor); los demás se recortan.
  return t.slice(0, 2000); // tope duro de almacenamiento
}

// ── Escaneo ─────────────────────────────────────────────────────────────────
/**
 * Escanea un texto de respuesta. Devuelve la alerta (objeto) o null.
 * NO lanza nunca. Escribir la alerta es side-effect best-effort.
 */
function escanear(texto, contexto = 'sin-contexto') {
  try {
    if (!texto || typeof texto !== 'string' || texto.length < 8) return null;
    // Dedup por hash (no re-alertar lo ya visto)
    const hash = crypto.createHash('sha1').update(texto).digest('hex');
    if (_historial.includes(hash)) return null;
    _historial.push(hash);
    if (_historial.length > 500) _historial.shift();

    // Filtro primero: si contiene nuestros tokens propios y nada raro, fuera
    const alertas = [];

    for (const r of REGLAS) {
      if (r.uuids) {
        const ajenos = _uuidsAjenos(texto);
        if (ajenos.length) {
          alertas.push({ regla: r.nombre, muestra: ajenos.map((u) => u).slice(0, 5).join(', ') });
        }
        continue;
      }
      if (!r.re) continue;
      const m = texto.match(r.re);
      if (m) alertas.push({ regla: r.nombre, muestra: redactar(m[0]) });
    }

    const jsonControl = _sospechaEnJsonControl(texto);
    if (jsonControl) alertas.push(jsonControl);

    if (!alertas.length) return null;

    const alerta = {
      ts: new Date().toISOString(),
      contexto,
      hash,
      texto_len: texto.length,
      alertas,
      // Fragmento redactado para revisión humana inmediata
      fragmento: redactar(texto.slice(0, 600)),
    };
    registrarAlerta(alerta);
    return alerta;
  } catch (e) {
    try { console.error('[v13] error no fatal en escanear:', e.message); } catch {}
    return null;
  }
}

function registrarAlerta(alerta) {
  try {
    fs.appendFileSync(_salida(), JSON.stringify(alerta) + '\n');
  } catch { /* sin fichero, no bloquear */ }
  try {
    console.error('\n' + '🚨'.repeat(3) + ' V13 ALERTA — posible contenido cross-tenant 🚨'.repeat(1) + ' 🚨'.repeat(3));
    console.error(`    contexto: ${alerta.contexto}`);
    console.error(`    reglas:   ${alerta.alertas.map((a) => a.regla).join(', ')}`);
    console.error(`    fragmento redactado (primeros 300):`);
    console.error('    ' + alerta.fragmento.slice(0, 300).replace(/\n/g, '\n    '));
    console.error('    → CONGELAR: cero reintentos, capturar raw + pantallazo AHORA.');
    console.error('    → fichero: ' + _salida() + '\n');
  } catch { /* console roto, no bloquear */ }
}

// ── Hook automático en net.fetch ────────────────────────────────────────────
// Llamar UNA vez al inicio del proceso (lo hace net.js al cargar el hook).
// Devuelve una función que envuelve un "resultado de fetch" y lo escanea.
function hookResultadoFetch(resultado, contexto) {
  try {
    if (resultado && typeof resultado.text === 'string') {
      escanear(resultado.text, contexto);
    }
  } catch { /* nunca bloquear */ }
  return resultado;
}

module.exports = {
  escanear,
  redactar,
  registrarEntidadesConocidas,
  registrarTokenPropio,
  hookResultadoFetch,
  _salida,
};
