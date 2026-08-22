'use strict';

// ============================================================================
// KNK SUITE v2 — Compuertas de verificación CORS/IDOR/SSRF/XSS/sub/calidad/autorización
// ============================================================================

function gate(id, label, ok, detail, lesson) {
  return { id, label, ok, detail, lesson };
}

function verdict(sendable, summary, results) {
  return { sendable, summary, results };
}

function corsChain(i) {
  const r = [];
  const reflectionOk = i.originReflected === true && i.allowCredentials === true;
  r.push(gate('cors-g0', 'Reflexión explotable (Origin reflejado + Allow-Credentials)', reflectionOk,
    reflectionOk ? 'El servidor refleja el Origin con credenciales.' : 'ACAO:* sin credenciales o origen fijo.',
    'La cabecera sola no es la vulnerabilidad: lo es el DATO que otro origen puede leer.'));
  r.push(gate('cors-g1', 'El endpoint EXISTE (no 404/405)', ![404, 405].includes(i.endpointStatus),
    ![404, 405].includes(i.endpointStatus) ? `Endpoint responde ${i.endpointStatus}` : `Endpoint ${i.endpointStatus} (no existe).`,
    'Nunca PoC sobre rutas inventadas.'));
  r.push(gate('cors-g2', 'Autentica por COOKIE (no Bearer)', i.authMode === 'cookie',
    i.authMode === 'cookie' ? 'La cookie basta: el navegador la adjunta cross-origin.' : `authMode=${i.authMode}: sin sesión no hay veredicto.`,
    'Bearer-only: el navegador NO adjunta Authorization cross-origin.'));
  r.push(gate('cors-g3', 'El dato es SENSIBLE (privado)', i.dataSensitive === true,
    i.dataSensitive ? 'El dato es privado (email, token, documento...).' : 'Dato público = sin impacto reportable.'));
  r.push(gate('cors-g4', 'Lectura cross-origin REAL en el navegador', i.crossOriginRead === true,
    i.crossOriginRead ? 'El navegador leyó el cuerpo desde otro origen.' : 'curl no demuestra lectura cross-origin.'));
  r.push(gate('cors-g5', 'Exfiltración demostrada (callback)', i.exfil === true,
    i.exfil ? 'El dato llegó al callback controlado.' : 'Sin callback no hay prueba de exfiltración.'));
  const sendable = r.every((g) => g.ok);
  return verdict(sendable, sendable ? '✅ CADENA CORS COMPLETA' : `⛔ INCOMPLETA: ${r.filter(g => !g.ok).map(g => g.id).join(', ')}`, r);
}

function idorChain(i) {
  const r = [];
  r.push(gate('idor-g0', 'Asset dentro del scope', i.inScope === true, i.inScope ? 'En scope.' : 'Fuera de scope.'));
  r.push(gate('idor-g1', 'Recurso pertenece a cuenta B (propia)', i.ownResourceB === true, i.ownResourceB ? 'Recurso propio de B.' : 'Sin recurso propio.'));
  r.push(gate('idor-g2', 'Baseline: B lee su recurso (200)', i.baselineB200 === true, i.baselineB200 ? 'Baseline correcto.' : 'Sin baseline.'));
  const leaked = i.readWithA === 200 && i.dataPrivate === true;
  r.push(gate('idor-g3', 'A lee datos PRIVADOS de B (200 + PII)', leaked, leaked ? 'A obtuvo datos privados de B.' : 'Sin dato privado o no autorizado.'));
  r.push(gate('idor-g4', 'Reproducible (2ª vez)', i.reproducible === true, i.reproducible ? 'Reproducido 2 veces.' : 'No reproducible.'));
  r.push(gate('idor-g5', 'Política lo considera elegible', i.programEligible === true, i.programEligible ? 'Elegible.' : 'Excluido por diseño.'));
  const sendable = r.every((g) => g.ok);
  return verdict(sendable, sendable ? '✅ CADENA IDOR COMPLETA' : `⛔ INCOMPLETA: ${r.filter(g => !g.ok).map(g => g.id).join(', ')}`, r);
}

function ssrfChain(i) {
  const r = [];
  r.push(gate('ssrf-g0', 'El atacante controla la URL/host destino', i.urlControlled === true, i.urlControlled ? 'Input del atacante controla el destino.' : 'Sin control del destino.'));
  r.push(gate('ssrf-g1', 'La petición la hace el SERVIDOR (callback recibido)', i.serverFetches === true, i.serverFetches ? 'Callback recibió la petición.' : 'Sin callback.'));
  r.push(gate('ssrf-g2', 'Destino interno/restringido', i.internalTarget === true, i.internalTarget ? '127.0.0.1, 169.254.169.254 o red privada.' : 'Destino público.'));
  r.push(gate('ssrf-g3', 'Impacto demostrado', i.impactShown === true, i.impactShown ? 'Impacto real.' : 'Callback sin impacto no es severidad.'));
  r.push(gate('ssrf-g4', 'Reproducible', i.reproducible === true, i.reproducible ? 'Reproducido.' : 'No reproducible.'));
  r.push(gate('ssrf-g5', 'Dentro del scope', i.inScope === true, i.inScope ? 'En scope.' : 'Fuera de scope.'));
  const sendable = r.every((g) => g.ok);
  return verdict(sendable, sendable ? '✅ CADENA SSRF COMPLETA' : `⛔ INCOMPLETA: ${r.filter(g => !g.ok).map(g => g.id).join(', ')}`, r);
}

function xssChain(i) {
  const r = [];
  const dangerous = ['html', 'js', 'attr'].includes(i.execContext);
  r.push(gate('xss-g0', 'Payload cae en contexto peligroso (html/js/attr)', i.reflected === true && dangerous,
    i.reflected && dangerous ? `Reflejado en ${i.execContext}.` : 'No reflejado o contexto seguro.'));
  r.push(gate('xss-g1', 'EJECUCIÓN demostrada (alert)', i.executed === true, i.executed ? 'Ejecución en navegador.' : 'Reflejar ≠ ejecutar.'));
  r.push(gate('xss-g2', 'CSP no bloquea (o bypass)', i.cspBlocks !== true, !i.cspBlocks ? 'Sin CSP bloqueante.' : 'CSP bloquea.'));
  r.push(gate('xss-g3', 'Impacto real', i.impactReal === true, i.impactReal ? 'Impacto real.' : 'Alert sin contexto = informativo.'));
  r.push(gate('xss-g4', 'Reproducible', i.reproducible === true, i.reproducible ? 'Reproducido.' : 'No reproducible.'));
  r.push(gate('xss-g5', 'Dentro del scope', i.inScope === true, i.inScope ? 'En scope.' : 'Fuera de scope.'));
  const sendable = r.every((g) => g.ok);
  return verdict(sendable, sendable ? '✅ CADENA XSS COMPLETA' : `⛔ INCOMPLETA: ${r.filter(g => !g.ok).map(g => g.id).join(', ')}`, r);
}

function subdomainChain(i) {
  const r = [];
  r.push(gate('sub-g0', 'CNAME colgante a servicio externo', i.danglingCNAME === true, i.danglingCNAME ? 'CNAME no reclamado.' : 'Sin CNAME colgante.'));
  r.push(gate('sub-g1', 'Destino responde "not found"', i.providerUnclaimed === true, i.providerUnclaimed ? 'Firma de no reclamado.' : 'Sin firma clara.'));
  r.push(gate('sub-g2', 'Proveedor permite reclamar', i.claimable === true, i.claimable ? 'Reclamable.' : 'No reclamable.'));
  r.push(gate('sub-g3', 'Reclamación demostrada', i.proofClaimed === true, i.proofClaimed ? 'Reclamado y retirado.' : 'Sin evidencia de reclamabilidad.'));
  r.push(gate('sub-g4', 'Impacto real', i.impactReal === true, i.impactReal ? 'Impacto real.' : 'Sin impacto.'));
  r.push(gate('sub-g5', 'Dentro del scope', i.inScope === true, i.inScope ? 'En scope.' : 'Fuera de scope.'));
  const sendable = r.every((g) => g.ok);
  return verdict(sendable, sendable ? '✅ CADENA SUBDOMAIN TAKEOVER COMPLETA' : `⛔ INCOMPLETA: ${r.filter(g => !g.ok).map(g => g.id).join(', ')}`, r);
}

function reportReadiness(i) {
  const r = [];
  const chk = (id, label, ok, lesson) => r.push(gate(id, label, ok === true, ok === true ? 'OK' : 'PENDIENTE', lesson));
  chk('rep-1', 'Asset dentro del scope exacto', i.inScope);
  chk('rep-2', 'Buscados reports parecidos (no duplicado)', i.noDuplicate);
  chk('rep-3', 'No es disqualifier del programa', i.notDisqualifier);
  chk('rep-4', 'Explotable de verdad (impacto real)', i.exploitable);
  chk('rep-5', 'Screenshot(s) del exploit e impacto', i.evidenceScreenshots);
  chk('rep-6', 'Request/response reproducible adjunto', i.evidenceRequestResponse);
  chk('rep-7', 'PoC mínimo con pasos numerados', i.pocMinimal);
  chk('rep-8', 'Sin PII real (redactado)', i.noPII);
  chk('rep-9', 'PoC reproducido ≥2 veces', (i.reproducibleCount || 0) >= 2);
  chk('rep-10', 'Severidad/CVSS honesto', i.severityHonest);
  const sendable = r.every((g) => g.ok);
  return verdict(sendable, sendable ? '✅ REPORTE LISTO' : `⛔ BLOQUEADO: ${r.filter(g => !g.ok).map(g => g.id).join(', ')}`, r);
}

function decepticonChain(i) {
  const r = [];
  r.push(gate('dep-g0', 'Target dentro del scope', i.inScope === true));
  r.push(gate('dep-g1', 'Autorización escrita', i.authorized === true));
  r.push(gate('dep-g2', 'OPPLAN definido', i.opplan === true));
  r.push(gate('dep-g3', 'Rate limit y ventana respetados', i.rateLimit === true));
  r.push(gate('dep-g4', 'Human-in-the-loop por fase', i.humanReview === true));
  const sendable = r.every((g) => g.ok);
  return verdict(sendable, sendable ? '✅ AUTORIZACIÓN COMPLETA' : `⛔ NO LANZAR: ${r.filter(g => !g.ok).map(g => g.id).join(', ')}`, r);
}

function verdictToText(v, indent = '  ') {
  const lines = [v.summary];
  for (const g of v.results) {
    lines.push(`${indent}${g.ok ? '✅' : '⛔'} ${g.label}: ${g.detail}`);
    if (!g.ok && g.lesson) lines.push(`${indent}   📚 ${g.lesson}`);
  }
  return lines.join('\n');
}

module.exports = {
  gate, verdict,
  corsChain, idorChain, ssrfChain, xssChain, subdomainChain, decepticonChain, reportReadiness,
  verdictToText,
};