'use strict';

// ============================================================================
// KNK SUITE v2.1 — Cierre de misión: informe de sesión desde la plantilla
//
// Toma docs/bugbounty/PLANTILLA-INFORME-SESION.md, rellena la cabecera y la
// tabla de hallazgos (§5) con lo que la sesión registró en la suite, y
// escribe docs/bugbounty/INFORME-SESION-YYYY-MM-DD.md. El resto de secciones
// (hipótesis, vectores, compuertas, lecciones) se completan a mano: eso es
// exactamente lo que la parte manual aporta y la máquina no puede inventar.
// ============================================================================

const fs = require('fs');
const path = require('path');

const PLANTILLA = 'PLANTILLA-INFORME-SESION.md';

// Fila de ejemplo de §5 en la plantilla: punto de anclaje único para
// insertar los hallazgos reales sin tocar el resto del documento.
const EJEMPLO_ROW = '| _ejemplo: F-1_ | _BIZ_ | _medium_ | _CERRADO-NOREPORTABLE_ | _`nr-1`_ |';

/** Rutas permitidas para docsDir: docs/bugbounty del repo y de la suite suelta. */
function allowedRoots() {
  return [
    path.resolve(__dirname, '..', '..', '..', 'docs', 'bugbounty'),
    path.resolve(__dirname, '..', '..', 'docs', 'bugbounty'),
  ];
}

/**
 * Resuelve el directorio docs/bugbounty que contiene la plantilla.
 * Orden: ruta explícita (SOLO si está dentro de las raíces permitidas) →
 * <repo>/docs/bugbounty → <suite>/docs/bugbounty.
 */
function resolveDocsDir(explicit) {
  const roots = allowedRoots();
  const candidates = [];
  if (explicit) {
    const e = path.resolve(explicit);
    if (roots.some((root) => e === root || e.startsWith(root + path.sep))) candidates.push(e);
  }
  candidates.push(...roots);

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, PLANTILLA))) return dir;
  }
  return null;
}

/** Limpia un valor para meterlo en una celda de tabla markdown. */
function cell(v) {
  return String(v == null ? '' : v)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim() || '—';
}

/** Fecha YYYY-MM-DD de un ISO o de ahora. */
function fechaDe(iso) {
  const d = iso ? new Date(iso) : new Date();
  return isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

// Estado honesto por hallazgo: la suite no sabe si pasa triage, así que solo
// "info" se marca como no reportable; el resto queda POR VERIFICAR.
function estadoDe(f) {
  const sev = String(f.severity || 'info').toLowerCase();
  return sev === 'info' || sev === 'none'
    ? 'CERRADO-NOREPORTABLE'
    : 'POR VERIFICAR (2x + compuerta)';
}

// Detalles del hallazgo: la BD ya los entrega parseados, pero se acepta texto
// por si el hallazgo llega de una fuente antigua.
function detallesDe(f) {
  if (f && typeof f.details === 'object' && f.details) return f.details;
  if (f && typeof f.details === 'string') {
    try { const d = JSON.parse(f.details); return d && typeof d === 'object' ? d : {}; } catch { return {}; }
  }
  return {};
}

// Referencia corta de la evidencia en disco: «fichero.txt» o «fichero.txt +2».
function evidenciaDe(f) {
  const d = detallesDe(f);
  const files = [].concat(Array.isArray(d.evidence) ? d.evidence : [d.evidence])
    .filter((e) => typeof e === 'string' && e);
  if (!files.length) return '';
  const base = files[0].split(/[\\/]/).pop();
  return files.length > 1 ? '`' + base + '` +' + (files.length - 1) : '`' + base + '`';
}

// Última columna («Regla / bloqueo»): un hallazgo nacido en índices públicos se
// marca como candidato (`cand-idx`) para que nadie lo lea como verificado, y se
// citan sus CVEs y su evidencia.
function reglaDe(f) {
  const d = detallesDe(f);
  const esIndice = f.type === 'camera-exposed' || d.module === 'camaras-expuestas';
  const piezas = [];
  if (esIndice) piezas.push('`cand-idx`');
  const cves = Array.isArray(d.vulns) ? d.vulns.filter((c) => typeof c === 'string') : [];
  if (cves.length) piezas.push(cves.slice(0, 3).join(' ') + (cves.length > 3 ? ' +' + (cves.length - 3) : ''));
  const ev = evidenciaDe(f);
  if (ev) piezas.push(ev);
  return piezas.join(' · ');
}

// Filas reales de §5 a partir de los hallazgos de la suite.
function findingsRows(findings) {
  const ordenados = [...(findings || [])].sort((a, b) => (a.id || 0) - (b.id || 0));
  if (!ordenados.length) {
    return '| — | (sin hallazgos registrados en la suite) | — | — | 0 enviables | — |';
  }
  return ordenados.map((f, i) =>
    `| F-${i + 1} | ${cell(f.summary)} | ${cell(f.type)} | ${cell(f.severity)} | ${estadoDe(f)} | ${reglaDe(f) || '—'} |`
  ).join('\n');
}

/** Notas de la sesión → bloque markdown para las incidencias del circuito. */
function notesBlock(notes) {
  const list = (notes || []).map(n => {
    if (typeof n === 'string') return `- ${cell(n)}`;
    const hhmm = n.at ? String(n.at).slice(11, 16) : '';
    return `- ${hhmm ? `[${hhmm}] ` : ''}${cell(n.text)}`;
  }).filter(Boolean);
  return list.length ? list.join('\n') : '';
}

/**
 * Genera el informe de sesión del día.
 * @param {object} opts
 * @param {object}   opts.session    Fila de sesión (db.getSession + campos parseados)
 * @param {object[]} opts.findings   Hallazgos de db.getFindings(sessionId)
 * @param {string}   [opts.docsDir]  Ruta alternativa a docs/bugbounty (tests)
 * @param {string}   [opts.fecha]    YYYY-MM-DD (por defecto hoy, UTC)
 * @param {boolean}  [opts.overwrite] Reescribir si el informe de hoy ya existe
 * @param {string}   [opts.alias]    Alias de la plataforma si no está en la sesión
 */
function scaffold({ session = {}, findings = [], docsDir = null, fecha = null, overwrite = false, alias = null } = {}) {
  const dir = resolveDocsDir(docsDir);
  if (!dir) {
    return { ok: false, reason: 'no-plantilla', error: `No se encontró ${PLANTILLA} (buscado en docs/bugbounty del repo y de la suite)` };
  }

  const day = fechaDe(fecha);
  const outPath = path.join(dir, `INFORME-SESION-${day}.md`);

  if (fs.existsSync(outPath) && !overwrite) {
    return { ok: false, reason: 'exists', outPath };
  }

  const plantilla = fs.readFileSync(path.join(dir, PLANTILLA), 'utf8');
  const existed = fs.existsSync(outPath);

  const artifacts = session.artifacts || {};
  const programa = session.program_name || artifacts.programName || session.target || 'NOMBRE (PLATAFORMA)';
  const aliasFinal = alias || artifacts.alias || 'tu-alias';

  let out = plantilla
    .replace(
      'Programa: NOMBRE (PLATAFORMA) · Alias: tu-alias · Tipo de sesión: manual (hipótesis → vectores → compuertas → lecciones)',
      `Programa: ${cell(programa)} · Alias: ${cell(aliasFinal)} · Tipo de sesión: manual (hipótesis → vectores → compuertas → lecciones)`
    )
    .replace(
      '## 0 · Ficha rápida de caza (una hipótesis)',
      `## 0 · Ficha rápida de caza (una hipótesis)\n\n` +
      `> **Sesión cerrada: ${day}.** Informe generado por la suite con ` +
      `**${(findings || []).length} hallazgo(s)** pre-cargado(s) en §5 y target ` +
      `\`${session.target || 'sin target'}\`. Completa hipótesis (§2), vectores (§3), ` +
      `compuertas (§4) y lecciones (§6) a mano — la máquina no las inventa.`
    )
    .replace(
      '## 5 · Hallazgos del día',
      `## 5 · Hallazgos del día (pre-cargados desde la suite: ${(findings || []).length})`
    )
    .replace(EJEMPLO_ROW, `${findingsRows(findings)}\n${EJEMPLO_ROW}`)
    .replace(
      '**Sin hallazgo enviable / N hallazgos verificados.**',
      (findings || []).length
        ? `**${findings.length} hallazgo(s) pre-cargado(s) — clasifícalos (enviable / no reportable) antes del cierre.**`
        : '**0 hallazgos registrados en la suite para esta sesión.**'
    );

  // Notas registradas en la sesión → incidencias del circuito (§1), si no hay texto ya
  const notas = notesBlock(session.notes);
  if (notas) {
    out = out.replace(
      '**Incidencias del circuito (si las hubo):**',
      `**Incidencias del circuito (registradas por la suite):**\n\n${notas}\n\n**Notas manuales adicionales:**`
    );
  }

  fs.writeFileSync(outPath, out, 'utf8');

  return {
    ok: true,
    outPath,
    created: !existed,
    overwrote: existed,
    findingsCount: (findings || []).length,
    fecha: day,
  };
}

module.exports = { scaffold, resolveDocsDir, findingsRows };
