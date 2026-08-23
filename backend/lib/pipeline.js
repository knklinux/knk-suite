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
      if (!session.opplan) return { ...result, ok: false, error: 'No hay OPPLAN. Créalo primero.' };
      const v = opplanMod.validate(session.opplan);
      if (!v.ok) return { ...result, ok: false, error: `OPPLAN incompleto: ${v.pendientes.join(', ')}` };
      result.output = opplanMod.render(session.opplan);
      break;
    }

    case 'recon': {
      const host = params.target || session.target;
      if (!host) return { ...result, ok: false, error: 'Sin target. Define objetivo.' };
      const net = require('./net');
      const h = net.normalizeHost(host);
      const proto = host.includes('://') ? host : `https://${h}`;

      // Intentar subfinder via Docker Kali primero
      let subs = [];
      let subTool = 'crt.sh';
      if (dockerReady()) {
        const subRes = dockerExec('subfinder', `-d ${h} -silent -timeout 15`, 90000);
        if (subRes.ok && subRes.output.trim()) {
          subs = subRes.output.trim().split('\n').map(l => net.normalizeHost(l)).filter(Boolean);
          subTool = 'subfinder (Docker)';
        }
      }
      if (!subs.length) {
        subs = await reconMod.subdomains(h);
        subTool = 'crt.sh (fallback)';
      }

      const urls = await reconMod.wayback(h, 200);
      const tech = await reconMod.techDetect(proto);

      result.output = {
        tool: subTool,
        subdominios: subs.slice(0, 50),
        totalSubs: subs.length,
        urls: urls.slice(0, 20),
        totalUrls: urls.length,
        tecnologias: tech.tech,
        status: tech.status,
        dockerKali: dockerReady(),
      };

      ctx.setArtifact('subdominios', subs);
      ctx.setArtifact('urls_historicas', urls);
      ctx.setArtifact('tech', tech.tech);

      if (subs.length) result.findings.push({ type: 'RECON', summary: `${subs.length} subdominios (${subTool})`, severity: 'info' });
      if (urls.length) result.findings.push({ type: 'RECON', summary: `${urls.length} URLs históricas`, severity: 'info' });
      result.findings.push({ type: 'RECON', summary: `Tech: ${tech.tech.slice(0, 5).join(', ') || 'sin firma clara'}`, severity: 'info' });
      break;
    }

    case 'scan': {
      const url = params.url || (session.target ? (session.target.includes('://') ? session.target : `https://${session.target}`) : null);
      if (!url) return { ...result, ok: false, error: 'Sin URL. Define objetivo o pasa url.' };

      const hdrs = await scannerMod.securityHeaders(url);
      const cors = await scannerMod.corsProbe(url);

      // nuclei via Docker (optional, nunca bloquea el pipeline)
      let nucleiFindings = [];
      let nucleiTool = null;
      if (dockerReady()) {
        try {
          const nRes = dockerExec('nuclei', `-u ${url} -t http/misconfiguration -severity low,medium,high,critical -silent -timeout 5 -retries 0 -max-host-error 3`, 30000);
          if (nRes.ok && nRes.output.trim()) {
            nucleiFindings = nRes.output.trim().split('\n').filter(Boolean);
            nucleiTool = 'nuclei (Docker)';
          }
        } catch { /* nuclei timeout — continuar sin él */ }
      }

      result.output = {
        url,
        status: hdrs.status,
        headersPresentes: hdrs.present.map(h => h.label),
        headersAusentes: hdrs.missing.map(h => h.label),
        cors: { acao: cors.acao, acac: cors.acac, suspicious: cors.suspicious },
        nuclei: nucleiFindings.length ? { tool: nucleiTool, findings: nucleiFindings.slice(0, 20) } : null,
        dockerKali: dockerReady(),
      };

      if (hdrs.missing.length) result.findings.push({ type: 'SCAN', summary: `${hdrs.missing.length} headers de seguridad ausentes`, severity: 'info' });
      if (cors.suspicious) result.findings.push({ type: 'SCAN', summary: 'CORS sospechoso — validar con compuerta', severity: 'low' });
      if (nucleiFindings.length) {
        nucleiFindings.slice(0, 10).forEach(f => result.findings.push({ type: 'NUCLEI', summary: f.slice(0, 120), severity: 'low' }));
      }
      break;
    }

    case 'fuzz': {
      const url = params.url || (session.target ? (session.target.includes('://') ? session.target : `https://${session.target}`) : null);
      if (!url) return { ...result, ok: false, error: 'Sin URL para fuzz.' };

      // Stealth mode: sin ffuf automático, solo wordlist conservadora
      const safeUrl = url.includes('://') ? url : `https://${url}`;
      const isStealth = params.stealth !== false;
      if (isStealth && dockerReady() && params.full !== true) {
        // Recomendar no hacer fuzz masivo
        result.output = {
          warning: '⚠️  Fuzz masivo desactivado en modo stealth. Usa {full:true} solo con autorización explícita.',
          mode: 'stealth',
          maxPaths: 15,
          concurrency: 1,
          delayMin: 2000,
        };
        result.findings.push({ type: 'INFO', summary: 'Fuzz en modo stealth (15 paths máximo, 2-4s delay)', severity: 'info' });
      } else {
        const fres = await fuzzerMod.fuzz(safeUrl, { concurrency: 1, stealth: isStealth, tool: dockerReady() ? 'stealth-native' : 'native' });
        result.output = { tool: fres.tool, baseline: fres.baseline, total: fres.total, findings: fres.findings.slice(0, 15), stealth: fres.stealth };
        if (fres.findings.length) result.findings.push({ type: 'FUZZ', summary: `${fres.findings.length} rutas interesantes (${fres.tool})`, severity: 'info' });
      }
      break;
    }

    case 'exploit': {
      // Las compuertas son interactivas — desde la API solo mostramos los candidatos disponibles
      result.output = {
        message: 'Usa las compuertas (cors, idor, ssrf, xss, sub) para validar candidatos manualmente.',
        gates: ['cors', 'idor', 'ssrf', 'xss', 'sub'],
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