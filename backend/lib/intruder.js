'use strict';
// ============================================================================
// intruder.js — fuzzer pequeño estilo Burp Intruder, acoplado al Repeater
//
// Filosofía: el pipeline FUZZ masivo ya demostró sus problemas (bloquea el
// pipeline del CI, satura al objetivo). Esto es lo contrario: fuzzing a
// escala de investigador — el usuario define LOS PAYLOADS, uno a uno, y los
// caps son duros en el servidor. Nada automático, nada masivo:
//
//   * posiciones estilo Burp con §...§ en la petición cruda del Repeater;
//   * payloads escritos por el usuario (uno por línea) — sin diccionarios;
//   * caps duros server-side: MAX_TOTAL_REQUESTS 100 / MAX_PAYLOADS 50 /
//     MAX_CONCURRENT 3 / MAX_RUNS_CONCURRENT 2 por sesión;
//   * CADA petición individual pasa por sendRaw() del repeater: scope
//     obligatorio, limiter global (>=800 ms serializado), anti-SSRF;
//   * runs ASÍNCRONAS con progreso por polling — la UI no se congela;
//   * abort explícito del usuario en cualquier momento;
//   * detección de anomalías (status minoritarios, longitudes atípicas);
//   * exportar cualquier resultado a hallazgo con evidencia completa.
// ============================================================================

const db = require('../db');
const repeater = require('./repeater');

// ── Caps duros (server-side; la UI los muestra pero no manda) ───────────────
const MAX_TOTAL_REQUESTS = 100;   // techo absoluto de peticiones por run
const MAX_PAYLOADS = 50;          // techo de payloads por set
const MAX_CONCURRENT = 3;         // máximo en vuelo simultáneo
const MAX_RUNS_CONCURRENT = 2;    // runs activos máximos por sesión

// ── Payload sets predefinidos (server-side, pequeños a propósito) ──────────
// Complementan —no sustituyen— los payloads manuales del operador. Cada set
// respeta MAX_PAYLOADS y son valores de sonda clásicos, no diccionarios de
// fuerza bruta. Falsos positivos mínimos: se espera que el operador analice
// las anomalías con la vista de resultados.
const PAYLOAD_SETS = {
  'dir-traversal': {
    label: 'Path traversal (LFI)',
    payloads: [
      '../../../../etc/passwd',
      '..\\..\\..\\..\\windows\\win.ini',
      '....//....//....//etc/passwd',
      '/etc/passwd',
      '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      'php://filter/convert.base64-encode/resource=index.php',
    ],
  },
  'sqli-probe': {
    label: 'Sonda SQLi (sin destructivas)',
    payloads: [
      "'",
      '1\' OR \'1\'=\'1',
      '1 UNION SELECT NULL--',
      '1 AND SLEEP(0)--',
      '1 ORDER BY 1--',
      '1\' AND \'1\'=\'1',
    ],
  },
  'xss-probe': {
    label: 'Sonda XSS (reflexión, no exploit)',
    payloads: [
      'knkxss123',
      '<svg/onload=alert(1)>',
      '"><script>alert(1)</script>',
      '\'<img src=x onerror=alert(1)>',
      'javascript:alert(1)',
      '{{7*7}}',
    ],
  },
  'open-redirect': {
    label: 'Open redirect (mismo host)',
    payloads: [
      '//knk-redirect.test',
      '/\\knk-redirect.test',
      'https://knk-redirect.test',
      '%2f%2fknk-redirect.test',
    ],
  },
  'ssti-probe': {
    label: 'Sonda SSTI (detección)',
    payloads: [
      '{{7*7}}',
      '${7*7}',
      '<%= 7*7 %>',
      '{{constructor.constructor(\'return 7*7\')()}}',
    ],
  },
  'id-probe': {
    label: 'IDOR/BAC (secuencia de IDs)',
    payloads: ['1', '2', '3', '0', '999999', 'admin'],
  },
};

// ── Estado en memoria (vive con el proceso del backend) ────────────────────
const runs = new Map();

// limpieza de runs terminadas con más de 2h
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, r] of runs) {
    if (r.status !== 'running' && Date.parse(r.finishedAt || r.createdAt) < cutoff) {
      runs.delete(id);
    }
  }
}, 15 * 60 * 1000).unref();

// ── Parser de posiciones §...§ (estilo Burp) ────────────────────────────────
function extractPositions(raw) {
  const positions = [];
  const re = /§([^§]*)§/g; // se permiten vacías ("borrar el parámetro")
  let m;
  while ((m = re.exec(raw)) !== null) positions.push(m[1]);
  return positions;
}

/** Sustituye la posición index-ésima §...§ por payload; las demás conservan
 *  su contenido original y se limpian de §. */
function applyPayload(raw, index, payload) {
  let seen = -1;
  return raw.replace(/§([^§]*)§/g, (whole, original) => {
    seen += 1;
    return seen === index ? String(payload) : original;
  }).replace(/§/g, '');
}

// ── Anomalías simples sobre los resultados ─────────────────────────────────
function detectAnomalies(results) {
  if (!results.length) return { statusCodes: [], minorityStatus: [], lengthOutliers: [] };

  const statusCodes = [...new Set(results.map((r) => r.status))].sort((a, b) => a - b);

  // status minoritario: aparece 1-2 veces cuando hay suficiente muestra estable
  const byStatus = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  const minorityStatus = results.length >= 5
    ? Object.entries(byStatus).filter(([, n]) => n <= 2).map(([s]) => Number(s))
    : [];

  // outliers de longitud: > 2x o < 0.5x la mediana (con muestra suficiente)
  const lengths = results.filter((r) => typeof r.length === 'number').map((r) => r.length);
  let lengthOutliers = [];
  if (lengths.length >= 5) {
    const sorted = [...lengths].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    if (median > 0) {
      results.forEach((r, i) => {
        if (r.length > 2 * median || r.length < 0.5 * median) {
          lengthOutliers.push({ index: i, payload: r.payload, length: r.length, median });
        }
      });
    }
  }

  return { statusCodes, minorityStatus, lengthOutliers };
}

/**
 * Marca posiciones §...§ en una petición cruda: el valor del PRIMER parámetro
 * de la query (si existe) y, si hay cuerpo urlencoded, el primer campo. Así el
 * "→ Intruder" desde el proxy llega listo para lanzar sin editar a mano.
 */
function markPositions(raw) {
  const out = String(raw || '');
  const idxQuery = out.indexOf('?');
  const idxBody = out.indexOf('\r\n\r\n');
  let result = out;

  // 1) query: marcar el valor del primer parámetro (si hay y tiene "=").
  // La query termina en el primer ESPACIO (antes de HTTP/1.1) o en el CRLF —
  // nunca arrastrar la versión HTTP dentro de la posición §...§.
  if (idxQuery !== -1) {
    const lineEnd = out.indexOf('\r\n', idxQuery);
    const spaceEnd = out.indexOf(' ', idxQuery);
    const ends = [lineEnd, spaceEnd].filter((x) => x !== -1);
    const qEnd = ends.length ? Math.min(...ends) : -1;
    const queryPart = out.slice(idxQuery + 1, qEnd === -1 ? undefined : qEnd);
    const firstParam = queryPart.split('&')[0];
    if (firstParam && firstParam.includes('=')) {
      const markedQuery = queryPart.replace(firstParam, firstParam.replace('=', '=§') + '§');
      result = out.slice(0, idxQuery + 1) + markedQuery + (qEnd === -1 ? '' : out.slice(qEnd));
    }
  }

  // 2) cuerpo urlencoded: marcar el primer campo (independiente de la query;
  //    un POST sin query también llega listo para fuzzear). Se excluyen JSON
  //    y cuerpos binarios/XML.
  const bodyStart = result.indexOf('\r\n\r\n');
  if (bodyStart !== -1) {
    const body = result.slice(bodyStart + 4);
    if (body && body.includes('=') && !body.startsWith('{') && !body.startsWith('<')) {
      const first = body.split('&')[0];
      if (first && first.includes('=')) {
        const markedBody = body.replace(first, first.replace('=', '=§') + '§');
        result = result.slice(0, bodyStart + 4) + markedBody;
      }
    }
  }
  return result;
}

// ── Construcción de la lista de ataques (payload, positionIndex) ───────────
// 1 posición: un ataque por payload. Varias: emparejado (pairwise) con
// rotación de posición, techo MAX_TOTAL_REQUESTS.
function buildAttackPlan(payloads, positionCount) {
  const plan = [];
  if (positionCount <= 1) {
    payloads.forEach((p) => plan.push({ payload: p, positionIndex: 0 }));
    return plan.slice(0, MAX_TOTAL_REQUESTS);
  }
  // pairwise: payload i va a la posición i % positionCount
  for (let i = 0; i < payloads.length && plan.length < MAX_TOTAL_REQUESTS; i++) {
    plan.push({ payload: payloads[i], positionIndex: i % positionCount });
  }
  return plan;
}

function parsePayloadSet(text) {
  const payloads = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return [...new Set(payloads)].slice(0, MAX_PAYLOADS);
}

// ── Orquestador de la run ───────────────────────────────────────────────────
async function startRun(session, { raw, payloadText, preset, maxRedirects, match }) {
  if (typeof raw !== 'string' || !raw.includes('§')) {
    return { ok: false, error: 'Marca al menos una posición con §...§ en la petición' };
  }
  // Grep-match estilo Burp: cadenas a buscar en cada respuesta (máx 10 × 100).
  const matchList = Array.isArray(match) ? match.map((m) => String(m).slice(0, 100)).filter(Boolean).slice(0, 10) : [];
  const positions = extractPositions(raw);
  if (!positions.length) {
    return { ok: false, error: 'No hay posiciones §...§ válidas' };
  }
  let payloads;
  let presetUsed = null;
  if (preset) {
    const set = PAYLOAD_SETS[String(preset)];
    if (!set) return { ok: false, error: `preset desconocido: ${String(preset)}. Disponibles: ${Object.keys(PAYLOAD_SETS).join(', ')}` };
    payloads = set.payloads.slice(0, MAX_PAYLOADS);
    presetUsed = String(preset);
  } else {
    payloads = parsePayloadSet(payloadText);
  }
  if (!payloads.length) {
    return { ok: false, error: `Escribe tus payloads (uno por línea, máx ${MAX_PAYLOADS}) o elige un preset` };
  }

  // gate de runs concurrentes por sesión
  const active = [...runs.values()].filter(
    (r) => r.sessionId === session.id && r.status === 'running'
  );
  if (active.length >= MAX_RUNS_CONCURRENT) {
    return { ok: false, error: `Ya hay ${active.length} runs activas (máx ${MAX_RUNS_CONCURRENT}). Aborta una o espera.` };
  }

  const plan = buildAttackPlan(payloads, positions.length);
  if (!plan.length) return { ok: false, error: 'Plan de ataque vacío' };

  const id = 'intr-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const run = {
    id,
    sessionId: session.id,
    status: 'running',
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    abortedByUser: false,
    totalRequests: plan.length,
    completedRequests: 0,
    payloadCount: payloads.length,
    preset: presetUsed,
    match: matchList,
    positionCount: positions.length,
    maxConcurrent: MAX_CONCURRENT,
    results: [],
    error: null,
  };
  runs.set(id, run);

  // disparo asíncrono: la ruta responde ya con el id
  executeRun(session, run, raw, plan, Number(maxRedirects) || 0, matchList)
    .catch((e) => { run.status = 'error'; run.error = String(e.message || e); run.finishedAt = new Date().toISOString(); });

  return { ok: true, run: publicRun(run) };
}

async function executeRun(session, run, raw, plan, maxRedirects, matchList = []) {
  run.startedAt = new Date().toISOString();

  // baseline: una petición sin sustituir (payloads tal cual en su §...§) para diff
  let baseline = null;
  try {
    const baseRaw = raw.replace(/§/g, '');
    const b = await repeater.sendRaw(session, baseRaw, { maxRedirects });
    if (b.ok) baseline = b.send.diffable;
  } catch { /* baseline es best-effort */ }
  run.baseline = baseline;

  let cursor = 0;
  const workers = Array.from({ length: Math.min(MAX_CONCURRENT, plan.length) }, async () => {
    while (cursor < plan.length && run.status === 'running') {
      const idx = cursor++;
      const { payload, positionIndex } = plan[idx];
      const attemptRaw = applyPayload(raw, positionIndex, payload);
      const t0 = Date.now();
      let result = { index: idx, payload, positionIndex, status: null, length: null, ms: null, error: null, matches: [] };
      try {
        const r = await repeater.sendRaw(session, attemptRaw, { maxRedirects });
        if (r.ok) {
          result.status = r.send.status;
          result.length = r.send.length;
          result.diff = diffVsBaseline(baseline, r.send.diffable);
          // guardamos solo un preview del body (evidencia ligera)
          result.bodyPreview = (r.send.responseBody || '').slice(0, 2000);
          if (matchList.length && result.bodyPreview) {
            result.matches = matchList.filter((m) => result.bodyPreview.includes(m));
          }
        } else {
          result.error = r.error;
        }
      } catch (e) {
        result.error = String(e.message || e);
      }
      result.ms = Date.now() - t0;

      if (run.status !== 'running') break; // abortado mientras volaba
      run.results[idx] = result;
      run.completedRequests += 1;
    }
  });

  await Promise.all(workers);

  if (run.status === 'running') {
    run.status = run.abortedByUser ? 'aborted' : 'completed';
    run.finishedAt = new Date().toISOString();
  }
  run.results = run.results.filter(Boolean);
  run.anomalies = detectAnomalies(run.results);
}

function diffVsBaseline(baseline, diffable) {
  if (!baseline || !diffable) return null;
  const changes = [];
  if (baseline.status !== diffable.status) changes.push(`status ${baseline.status} → ${diffable.status}`);
  if (baseline.length !== diffable.length) {
    const d = diffable.length - baseline.length;
    changes.push(`longitud ${baseline.length} → ${diffable.length} (${d >= 0 ? '+' : ''}${d})`);
  }
  return changes.length ? { identical: false, summary: changes.join(' · ') } : { identical: true, summary: 'igual al baseline' };
}

/** Aborta una run: marca el flag; los workers lo comprueban entre peticiones */
function abortRun(sessionId, runId) {
  const run = runs.get(runId);
  if (!run || run.sessionId !== sessionId) return { ok: false, error: 'run no encontrada' };
  if (run.status !== 'running') return { ok: false, error: `la run ya está ${run.status}` };
  run.abortedByUser = true;
  run.status = 'aborted';
  run.finishedAt = new Date().toISOString();
  return { ok: true, run: publicRun(run) };
}

/** Vista pública de la run: sin bodies completos (esos van a evidencia) */
function publicRun(run) {
  return {
    id: run.id,
    status: run.status,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
    abortedByUser: run.abortedByUser,
    totalRequests: run.totalRequests,
    completedRequests: run.completedRequests,
    payloadCount: run.payloadCount,
    preset: run.preset || null,
    positionCount: run.positionCount,
    maxConcurrent: run.maxConcurrent,
    baseline: run.baseline || null,
    error: run.error || null,
    anomalies: run.anomalies || null,
    results: (run.results || []).map((r) => ({
      index: r.index, payload: r.payload, positionIndex: r.positionIndex,
      status: r.status, length: r.length, ms: r.ms, error: r.error,
      diff: r.diff || null, bodyPreview: (r.bodyPreview || '').slice(0, 400),
    })),
  };
}

function getRun(sessionId, runId) {
  const run = runs.get(runId);
  if (!run || run.sessionId !== sessionId) return null;
  return publicRun(run);
}

function listRuns(sessionId) {
  return [...runs.values()]
    .filter((r) => r.sessionId === sessionId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((r) => ({
      id: r.id, status: r.status, createdAt: r.createdAt,
      totalRequests: r.totalRequests, completedRequests: r.completedRequests,
      payloadCount: r.payloadCount, positionCount: r.positionCount,
    }));
}

/** Resultado de una run → hallazgo de la misión con evidencia completa */
function toFinding(sessionId, runId, resultIndex, note) {
  const run = runs.get(runId);
  if (!run || run.sessionId !== sessionId) return { ok: false, error: 'run no encontrada' };
  const r = (run.results || [])[resultIndex];
  if (!r) return { ok: false, error: 'resultado no encontrado' };

  const posLabel = run.positionCount > 1 ? `pos#${r.positionIndex}` : 'pos0';
  const summary = note ||
    `[Intruder] payload "${String(r.payload).slice(0, 60)}" (${posLabel}) → ${r.status ?? 'error'}`;

  const result = db.addFinding(sessionId, 'INTRUDER', summary, 'info', {
    runId,
    payload: r.payload,
    positionIndex: r.positionIndex,
    status: r.status,
    length: r.length,
    ms: r.ms,
    error: r.error || null,
    diff: r.diff || null,
    bodyPreview: (r.bodyPreview || '').slice(0, 2000),
    runAnomalies: run.anomalies || null,
    runTotals: { totalRequests: run.totalRequests, completedRequests: run.completedRequests },
    exportedAt: new Date().toISOString(),
  });
  return { ok: true, finding: { id: (result && result.lastInsertRowid) || null, summary } };
}

module.exports = {
  // constantes expuestas para la UI/ tests
  MAX_TOTAL_REQUESTS, MAX_PAYLOADS, MAX_CONCURRENT, MAX_RUNS_CONCURRENT,
  PAYLOAD_SETS,
  markPositions,
  extractPositions,
  applyPayload,
  parsePayloadSet,
  detectAnomalies,
  buildAttackPlan,
  startRun,
  abortRun,
  getRun,
  listRuns,
  toFinding,
};
