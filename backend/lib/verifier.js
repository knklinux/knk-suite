'use strict';

// ============================================================================
// KNK SUITE v2 — Verificador de reportes (triager simulado con requisitos reales)
// ============================================================================

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const TOKEN_RE = /\b(ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]{10,})\b/g;

function _countSteps(json) {
  const steps = json.pasos || json.steps || [];
  return Array.isArray(steps) ? steps.filter(s => String(s).trim().length > 8).length : 0;
}

async function verifyReport(json, opts = {}) {
  const problems = [];
  const warnings = [];

  // 1. Pasos de reproducción (mínimo 3)
  const steps = _countSteps(json);
  if (steps < 3) problems.push(`Pasos insuficientes (${steps}/3+): un triager debe poder reproducir solo con lo escrito.`);
  else if (steps < 5) warnings.push(`Solo ${steps} pasos: añade autenticación, headers exactos, payload.`);

  // 2. Request/Response reproducible (BLOQUEANTE)
  const hasReqRes = /(curl |http\s*\n|HTTP\/|GET |POST |PUT |request|response)/i.test(JSON.stringify(json));
  if (!hasReqRes) problems.push('❌ SIN REQUEST/RESPONSE: adjunta un curl o raw HTTP que el triager pueda copiar y pegar.');

  // 3. Screenshots (BLOQUEANTE)
  const ev = json.evidencia || json.evidence || [];
  const hasScreenshot = ev.some(e => /screenshot|captura|pantalla|screen|img|png|jpg/i.test(String(e)));
  if (!hasScreenshot) problems.push('❌ SIN SCREENSHOTS: obligatorio screenshot del exploit + screenshot del impacto.');

  // 4. Screenshot path
  const ssPath = json.screenshotsPath || '';
  if (!ssPath || ssPath.startsWith('❌')) problems.push('❌ Ruta de screenshots vacía: indica dónde están los archivos.');

  // 5. Request/Response path
  const rrPath = json.requestResponsePath || '';
  if (!rrPath || rrPath.startsWith('❌')) problems.push('❌ Ruta de request/response vacía.');

  // 6. Scope documentado
  if (!json.scopeDocumentado || json.scopeDocumentado === '—') {
    warnings.push('⚠️ Scope no documentado: copia la URL de la política del programa.');
  }

  // 7. User-Agent
  if (!json.userAgent || json.userAgent === 'no especificado') {
    warnings.push('⚠️ User-Agent no documentado: incluye el UA usado en las peticiones.');
  }

  // 8. Programa URL
  if (!json.programaUrl || json.programaUrl === '—') {
    warnings.push('⚠️ URL del programa no documentada.');
  }

  // 9. Severidad coherente
  const cvss = parseFloat(String(json.cvss || '0'));
  const sev = String(json.severidad || '').toLowerCase();
  if (cvss > 0) {
    if (cvss >= 9 && !/critical/i.test(sev)) warnings.push(`CVSS ${cvss} pero severidad "${json.severidad}".`);
    if (cvss < 4 && /critical|high/i.test(sev)) problems.push(`Severidad ${sev} inflada para CVSS ${cvss}: sé honesto.`);
  }

  // 10. PII y tokens
  const body = JSON.stringify(json);
  const pii = body.match(EMAIL_RE) || [];
  if (pii.length) warnings.push(`Contiene emails (${pii.length}): redacta si no son cuentas de prueba.`);
  const tokens = body.match(TOKEN_RE);
  if (tokens) problems.push('⚠️ SECRETOS/TOKENS detectados: ELIMÍNALOS antes de enviar.');

  // 11. Impacto
  const impact = String(json.impacto || '');
  if (impact.length < 20) problems.push('Impacto demasiado corto: describe el daño REAL demostrado.');

  // 12. Título
  const title = String(json.titulo || '');
  if (title.length < 10 || /sin título/i.test(title)) problems.push('Título genérico: usa "TipoDeBug en endpoint (Programa)".');

  // 13. Reproducibilidad (mínimo 2)
  const reps = parseInt(json.reproducible || json.reproducibleCount || 0, 10);
  if (reps < 2) problems.push(`PoC reproducido ${reps}x (mínimo 2 requerido por triagers reales).`);

  const score = Math.max(0, Math.round(100 - (problems.length * 25 + warnings.length * 8)));
  const verdict = problems.length === 0 ? 'LISTO' : problems.length <= 2 ? 'REVISAR' : 'BLOQUEADO';

  let llm = null;
  if (opts.llm && typeof opts.llm.generate === 'function' && problems.length === 0) {
    try {
      const r = await opts.llm.generate(
        `Actúa como triager de bug bounty. Revisa este reporte y dime si tiene screenshots, request/response reproducible, y si el impacto está demostrado. Devuelve 3 observaciones concretas o "OK":\n${JSON.stringify(json)}`,
        { system: 'Eres un triager exigente. Buscas: screenshots, curl reproducible, PoC claro, impacto real. Español. Breve.' }
      );
      if (r.ok) llm = r.text;
    } catch { llm = '(LLM timeout)'; }
  }

  return { verdict, score, problems, warnings, llm };
}

module.exports = { verifyReport };