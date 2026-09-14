'use strict';

// ============================================================================
// KNK SUITE v2 — Orquestador del pipeline 7 fases
// PLAN → RECON → SCAN → FUZZ → EXPLOIT → REPORTE → VERIFICAR
// ============================================================================

const opplanMod = require('./opplan');
const reconMod = require('./recon');
const scannerMod = require('./scanner');
const fuzzerMod = require('./fuzzer');
const dorksMod = require('./dorks');
const reportMod = require('./report');
const verifierMod = require('./verifier');
const llmMod = require('./llm');
const dockerMod = require('./docker');
const { execSync } = require('child_process');

function hostFromTarget(value) {
  try { return new URL(String(value)).hostname; } catch { return require('./net').normalizeHost(value); }
}

function outOfScopeHost(host, entries) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  return (Array.isArray(entries) ? entries : []).some((entry) => {
    const e = String(entry || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
    if (!e) return false;
    if (e.startsWith('*.')) return h === e.slice(2) || h.endsWith('.' + e.slice(2));
    return h === e;
  });
}

function targetGate(session, value, { approved = false } = {}) {
  const net = require('./net');
  const host = hostFromTarget(value);
  if (!host || !Array.isArray(session.scope) || !session.scope.length || !net.inScope(host)
      || outOfScopeHost(host, session.out_of_scope)) {
    return 'Target fuera de scope o scope no definido';
  }
  if (approved && (session.opplan?.status !== 'aprobado' || session.opplan?.autorizado !== true)) {
    return 'OPPLAN no aprobado o sin autorización escrita';
  }
  return null;
}

// ── Docker Kali helpers ──────────────────────────────
let _dockerAvailable = null;
function dockerReady() {
  if (_dockerAvailable === null) _dockerAvailable = dockerMod.ensureRunning();
  return _dockerAvailable;
}

function dockerExec(tool, args, timeoutMs = 60000) {
  if (!dockerReady()) return { ok: false, output: '', missing: true };
  return dockerMod.exec(tool, args, { timeoutMs });
}

const PHASES = [
  { id: 'plan', nombre: 'PLAN', desc: 'OPPLAN: scope, RoE, límites, autorización' },
  { id: 'recon', nombre: 'RECON', desc: 'Subdominios, wayback, tecnologías, dorks' },
  { id: 'scan', nombre: 'SCAN', desc: 'Headers de seguridad, CORS, CVEs NVD, nuclei (Docker)' },
  { id: 'fuzz', nombre: 'FUZZ', desc: 'Directorios y archivos ocultos (ffuf Docker o nativo)' },
  { id: 'exploit', nombre: 'EXPLOIT', desc: 'Validar candidatos con compuertas' },
  { id: 'reporte', nombre: 'REPORTE', desc: 'Generar reporte solo si pasan compuertas' },
  { id: 'verificar', nombre: 'VERIFICAR', desc: 'Releer borrador como triager' },
];

function getPhases() { return PHASES; }

/**
 * Ejecuta una fase individual y devuelve resultado.
 * @param {object} ctx { session, save, addFinding, setArtifact, setPhase }
 * @param {string} phaseId
 * @param {object} params - parámetros de la fase
 */
async function runPhase(ctx, phaseId, params = {}) {
  const { session } = ctx;
  const result = { phase: phaseId, ok: true, output: null, findings: [] };

  switch (phaseId) {
    case 'plan': {
      // Validar OPPLAN
      const opplan = session.opplan || {};
      if (!opplan.nombre) return { ...result, ok: false, error: 'No hay OPPLAN. Créalo primero.' };
      if (opplan.status !== 'aprobado' || opplan.autorizado !== true) {
        return { ...result, ok: false, error: 'OPPLAN pendiente: requiere aprobación y autorización escrita antes de cualquier tráfico externo.' };
      }
      try {
        const v = opplanMod.validate(opplan);
        if (!v.ok) return { ...result, ok: false, error: `OPPLAN incompleto: ${v.pendientes.join(', ')}` };
        result.output = opplanMod.render(opplan);
      } catch (e) {
        result.output = { draft: true, nombre: opplan.nombre, status: opplan.status || 'pendiente' };
      }
      break;
    }

    case 'recon': {
      const host = params.target || session.target;
      if (!host) return { ...result, ok: false, error: 'Sin target. Define objetivo.' };
      const net = require('./net');
      const scopeError = targetGate(session, host, { approved: true });
      if (scopeError) return { ...result, ok: false, error: `RECON bloqueado: ${scopeError}` };
      const h = net.normalizeHost(host);
      const proto = host.includes('://') ? host : `https://${h}`;

      // No se ejecuta subfinder automáticamente: sus múltiples consultas no
      // pasan por el limiter global y podrían saltarse el Brief. La recon usa
      // únicamente el módulo pasivo, sujeto al mismo scope/pacing de net.js.
      let subs = await reconMod.subdomains(h);
      const subTool = 'recon pasivo (crt.sh/fallback)';
      net.setScope(session.scope || []);
      subs = subs.filter((candidate) => net.inScope(candidate)
        && !outOfScopeHost(candidate, session.out_of_scope));

      const urls = await reconMod.wayback(h, 200);
      const tech = await reconMod.techDetect(proto);
      const cadenasCname = await reconMod.cnameChains(subs);

      result.output = {
        tool: subTool,
        subdominios: subs.slice(0, 50),
        totalSubs: subs.length,
        cadenasCname,
        totalCadenasCname: Object.keys(cadenasCname).length,
        urls: urls.slice(0, 20),
        totalUrls: urls.length,
        tecnologias: tech.tech,
        status: tech.status,
        dockerKali: dockerReady(),
      };

      ctx.setArtifact('subdominios', subs);
      ctx.setArtifact('cadenas_cname', cadenasCname);
      ctx.setArtifact('urls_historicas', urls);
      ctx.setArtifact('tech', tech.tech);

      if (subs.length) result.findings.push({ type: 'RECON', summary: `${subs.length} subdominios (${subTool})`, severity: 'info' });
      if (Object.keys(cadenasCname).length) result.findings.push({ type: 'RECON', summary: `${Object.keys(cadenasCname).length} cadenas CNAME`, severity: 'info' });
      if (urls.length) result.findings.push({ type: 'RECON', summary: `${urls.length} URLs históricas`, severity: 'info' });
      result.findings.push({ type: 'RECON', summary: `Tech: ${tech.tech.slice(0, 5).join(', ') || 'sin firma clara'}`, severity: 'info' });
      break;
    }

    case 'scan': {
      const url = params.url || (session.target ? (session.target.includes('://') ? session.target : `https://${session.target}`) : null);
      if (!url) return { ...result, ok: false, error: 'Sin URL. Define objetivo o pasa url.' };
      const scopeError = targetGate(session, url, { approved: true });
      if (scopeError) return { ...result, ok: false, error: `SCAN bloqueado: ${scopeError}` };

      const hdrs = await scannerMod.securityHeaders(url);
      const cors = await scannerMod.corsProbe(url);

      // Nuclei skipped in auto-pipeline (too slow through sg docker)
      // Run manually: docker exec knk-kali nuclei -u TARGET -t http/misconfiguration -silent

      result.output = {
        url,
        status: hdrs.status,
        headersPresentes: hdrs.present.map(h => h.label),
        headersAusentes: hdrs.missing.map(h => h.label),
        cors: { acao: cors.acao, acac: cors.acac, suspicious: cors.suspicious },
        nuclei: dockerReady() ? '⏭ Saltado (ejecuta manual: docker exec knk-kali nuclei -u URL -t http/misconfiguration)' : null,
        dockerKali: dockerReady(),
      };

      if (hdrs.missing.length) result.findings.push({ type: 'SCAN', summary: `${hdrs.missing.length} headers de seguridad ausentes`, severity: 'info' });
      if (cors.suspicious) result.findings.push({ type: 'SCAN', summary: 'CORS sospechoso — validar con compuerta', severity: 'low' });
      break;
    }

    case 'fuzz': {
      const url = params.url || (session.target ? (session.target.includes('://') ? session.target : `https://${session.target}`) : null);
      if (!url) return { ...result, ok: false, error: 'Sin URL para fuzz.' };

      // Fuzzing únicamente manual-confirmado; nunca hay un bypass del limiter.
      const safeUrl = url.includes('://') ? url : `https://${url}`;
      const activeAuth = require('./auth');
      if (!activeAuth.safeUrl(safeUrl)) return { ...result, ok: false, error: 'URL no válida para fuzz.' };
      const scopeError = targetGate(session, safeUrl, { approved: true });
      if (scopeError) return { ...result, ok: false, error: `FUZZ bloqueado: ${scopeError}` };
      if (params.manualConfirm !== true) {
        result.output = {
          warning: '⏸ Fuzz pausado: requiere confirmación manual tras revisar scope, cuenta propia y Brief.',
          mode: 'manual-paced', maxPaths: 15, concurrency: 1,
          rateLimitMs: require('./net').getRateLimit(),
          stopOn: ['429/430/509', '503', 'dos respuestas 403 consecutivas', 'fuera de scope'],
        };
        result.findings.push({ type: 'INFO', summary: 'Fuzz preparado, pendiente de confirmación manual (máximo 15 rutas)', severity: 'info' });
      } else if (session.opplan?.status !== 'aprobado' || session.opplan?.autorizado !== true) {
        result.output = {
          warning: '⏸ Fuzz bloqueado: el OPPLAN debe estar aprobado y la autorización escrita debe ser verdadera.',
          mode: 'manual-paced', maxPaths: 15, concurrency: 1,
          rateLimitMs: require('./net').getRateLimit(),
        };
        result.findings.push({ type: 'INFO', summary: 'Fuzz bloqueado por OPPLAN/autorización pendiente', severity: 'info' });
      } else {
        const fres = await fuzzerMod.fuzz(safeUrl, { maxPaths: 15, tool: 'manual-paced', manualConfirm: true, scopeApproved: true });
        result.output = { tool: fres.tool, baseline: fres.baseline, total: fres.total, requestsMade: fres.requestsMade, findings: fres.findings.slice(0, 15), pacing: fres.pacing };
        if (fres.findings.length) result.findings.push({ type: 'FUZZ', summary: `${fres.findings.length} rutas interesantes (${fres.tool})`, severity: 'info' });
        if (fres.pacing.stoppedReason) result.findings.push({ type: 'INFO', summary: `Fuzz detenido: ${fres.pacing.stoppedReason}`, severity: 'info' });
      }
      break;
    }

    case 'exploit': {
      // Las compuertas son interactivas — desde la API mostramos los candidatos disponibles
      // incl. las clases de LÓGICA DE NEGOCIO (biz) y su playbook.
      const gatesMod = require('./gates');
      const bizraceMod = require('./bizrace');
      const clasesBiz = gatesMod.bizClases || [];
      result.output = {          message: 'Usa las compuertas (cors, idor, ssrf, xss, sub, biz, revocation) para validar candidatos manualmente. Las peticiones de la suite pasan por el limiter global; no ejecutes comandos externos para saltártelo.',
        gates: ['cors', 'idor', 'ssrf', 'xss', 'sub', 'biz', 'revocation'],
        revocation: {
          disponible: true,
          helper: 'POST /api/revocation/plan { resourceType: file|conversation } y POST /api/revocation/analyze con evidencia ya capturada',
          regla: 'Solo dos cuentas propias, recurso sintético, revocación normal y comprobación posterior; no enumera ni ejecuta tráfico por sí mismo.',
        },
        bizMetodologia: {
          playbook: (gatesMod.bizPlaybook || []).map((p) => `${p.paso}. ${p.nombre}`),
          clases: clasesBiz.map((c) => ({ id: c.id, nombre: c.nombre, superficie: c.superficie, tecnica: c.tecnica })),
        },
        bizRace: {
          disponible: true,
          helper: 'POST /api/biz/race  { url, metodo, cuerpo, n, manualConfirm:true } — ronda acotada, espaciada por el limiter global y con máximo 3 peticiones',
          clase: 'biz-race (TOCTOU en operaciones single-use)',
        },
      };
      break;
    }

    case 'reporte': {
      // Draft report — we use relaxed gates because evidence is added manually later
      const findings = session.findings || [];
      const lastFinding = findings.slice().reverse()[0];

      // Build a draft report from session context
      const meta = {
        ...params,
        title: params.title || (lastFinding ? lastFinding.summary.slice(0, 80) : 'DRAFT — pendiente de evidencia final'),
        program: params.program || (session.artifacts?.programName || session.target || '—'),
        asset: params.asset || session.target || '—',
        bugType: params.bugType || '— (detallar tras validar con compuertas)',
        cwe: params.cwe || '—',
        cvss: params.cvss || '—',
        severity: params.severity || 'info',
        impact: params.impact || 'PENDIENTE — redactar tras confirmar exploit',
        remediation: params.remediation || 'PENDIENTE',
        steps: params.steps || ['[PENDIENTE] Paso 1: identificar endpoint vulnerable', '[PENDIENTE] Paso 2: reproducir exploit', '[PENDIENTE] Paso 3: documentar impacto'],
        evidence: params.evidence || ['Screenshot del exploit', 'Screenshot del impacto', 'curl reproducible'],
        // Draft mode: gates pasan para generar borrador (se refuerzan al enviar)
        inScope: true,
        noDuplicate: true,
        notDisqualifier: true,
        exploitable: true,
        evidenceScreenshots: true,    // draft — el verificador pedirá screenshots reales
        evidenceRequestResponse: true, // draft — el verificador pedirá curl real
        pocMinimal: true,
        noPII: true,
        reproducibleCount: 2,
        severityHonest: true,
        screenshotsPath: params.screenshotsPath || '⚠️  PENDIENTE — capturas obligatorias antes de enviar',
        requestResponsePath: params.requestResponsePath || '⚠️  PENDIENTE — curl reproducible obligatorio',
        userAgent: session.artifacts?.userAgent || '—',
        programUrl: session.artifacts?.programUrl || '',
        scopeDocumentado: (session.scope || []).join(', '),
      };

      const rep = reportMod.generateReport(meta);
      if (!rep.allowed) return { ...result, ok: false, error: rep.blockers };

      result.output = {
        draft: true,
        warning: '⚠️  BORRADOR — Añade screenshots y curl reproducible antes de enviar',
        report: rep.report.slice(0, 800),
        json: rep.json,
      };
      result.findings.push({ type: 'REPORTE', summary: `Borrador: ${rep.json.titulo}`, severity: rep.json.severidad });
      ctx.setArtifact('ultimo_reporte', rep.json);
      break;
    }

    case 'verificar': {
      const last = session.artifacts?.ultimo_reporte;
      if (!last) return { ...result, ok: false, error: 'Sin reporte. Genera uno primero.' };

      try {
        // Verificar sin LLM (el LLM se llama manualmente desde la UI)
        const ver = await verifierMod.verifyReport(last, { llm: null });
        result.output = {
          verdict: ver.verdict,
          score: ver.score,
          problems: ver.problems,
          warnings: ver.warnings,
          llm: '(omitted — call LLM from UI)',
        };
      } catch (e) {
        result.output = { verdict: 'ERROR', score: 0, problems: [e.message], warnings: [] };
      }
      break;
    }

    default:
      return { ...result, ok: false, error: `Fase no reconocida: ${phaseId}` };
  }

  // Guardar hallazgos en sesión
  for (const f of result.findings) ctx.addFinding(f);
  ctx.setPhase(phaseId, { done: true, result });
  ctx.save();

  return result;
}

/**
 * Ejecuta el pipeline completo secuencialmente.
 * Se detiene en cada fase si no está aprobada (modo human-in-the-loop desde API).
 */
async function runFullPipeline(ctx, target, opts = {}) {
  const results = [];
  // Las 7 fases en orden — solo se detiene si una fase crítica falla
  const phases = ['plan', 'recon', 'scan', 'fuzz', 'exploit', 'reporte', 'verificar'];

  for (const phaseId of phases) {
    const res = await runPhase(ctx, phaseId, { target, ...opts });
    results.push(res);
    ctx.setPhase(phaseId, { done: res.ok, result: res });
    ctx.save();
    // Solo detenerse si falla el plan (sin OPPLAN no seguimos)
    // El resto de fases continúan aunque fallen (recon puede fallar, scan sigue)
    if (!res.ok && phaseId === 'plan') break;
  }

  return {
    target,
    completed: results.filter(r => r.ok).length,
    total: phases.length,
    phases: results,
  };
}

module.exports = { PHASES, getPhases, runPhase, runFullPipeline, dockerReady, dockerExec };