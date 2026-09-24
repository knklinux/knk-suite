'use strict';

// ============================================================================
// KNK SUITE v2 — Compuertas de verificación CORS/IDOR/SSRF/XSS/sub/calidad/autorización
// + lógica de negocio (bizChain, metodología en bizlogic.js)
// ============================================================================

const bizMod = require('./bizlogic');
const altaMod = require('./alta');
const revocationMod = require('./revocation');
const manualMod = require('./manual');

function gate(id, label, ok, detail, lesson) {
  return { id, label, ok, detail, lesson };
}

function verdict(sendable, summary, results) {
  return { sendable, summary, results };
}

function corsChain(i) {
  const r = [];
  // Lección de campo: ACAO reflejado en un endpoint que da 5xx (error server sin
  // recurso) o que está login-gated (redirect/401 a sign-in) NO expone datos →
  // no puede haber crossOriginRead → no pasa compuerta. Reflejar ≠ leer.
  const hit5xx = [500, 502, 503, 504].includes(i.endpointStatus);
  const gated = i.loginGated === true || i.authMode === 'login-gated';
  r.push(gate('cors-g0b', 'El endpoint sirve el RECURSO (no 5xx ni login-gated)',
    !hit5xx && !gated,
    hit5xx ? `Endpoint responde ${i.endpointStatus} (error server): no hay recurso que leer.`
      : (gated ? 'Endpoint login-gated (redirect/401 a sign-in): no expone datos cross-origin.' : 'Endpoint sirve recurso real.'),
    'ACAO en el 500 o en el login no expone nada: reflejar ≠ leer.'));
  const reflectionOk = i.originReflected === true && i.allowCredentials === true;
  r.push(gate('cors-g0', 'Reflexión explotable (Origin reflejado + Allow-Credentials)', reflectionOk && !hit5xx && !gated,
    (reflectionOk && !hit5xx && !gated) ? 'El servidor refleja el Origin con credenciales.' : 'ACAO:* sin credenciales, origen fijo, 5xx o login-gated.',
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
  r.push(gate('idor-g0', 'Asset dentro del scope exacto', i.inScope === true, i.inScope ? 'En scope.' : 'Fuera de scope.'));
  r.push(gate('idor-g1', 'Cuenta A y cuenta B propias/autorizadas', i.ownAccountsAB === true, i.ownAccountsAB ? 'A y B están controladas/autorizadas.' : 'No se ha demostrado control sobre ambas cuentas.'));
  r.push(gate('idor-g2', 'Recurso privado pertenece a cuenta B', i.ownResourceB === true, i.ownResourceB ? 'Recurso propio y privado de B.' : 'Sin recurso privado propio de B.'));
  r.push(gate('idor-g3', 'Baseline: B lee su recurso (200)', i.baselineB200 === true, i.baselineB200 ? 'Baseline correcto.' : 'Sin baseline legítimo.'));
  const leaked = i.readWithA === 200 && i.dataPrivate === true;
  r.push(gate('idor-g4', 'A lee datos privados de B', leaked, leaked ? 'A obtuvo contenido privado de B.' : 'Sin lectura privada no autorizada.'));
  r.push(gate('idor-g5', 'Recurso conocido, sin enumeración', i.singleKnownResource === true, i.singleKnownResource ? 'Se usó un único identificador conocido.' : 'No se acredita ausencia de enumeración.'));
  r.push(gate('idor-g6', 'Reproducible (2ª vez)', i.reproducible === true, i.reproducible ? 'Reproducido 2 veces.' : 'No reproducible.'));
  r.push(gate('idor-g7', 'Política lo considera elegible', i.programEligible === true, i.programEligible ? 'Elegible.' : 'Excluido por diseño.'));
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

function sqliChain(i) {
  const r = [];
  const g = (id, label, ok, detail, lesson) => r.push(gate(id, label, ok === true, detail || (ok === true ? 'OK' : 'PENDIENTE'), lesson));
  g('sqli-g0', 'Programa y endpoint dentro del scope exacto', i.inScope === true,
    i.inScope ? 'Endpoint incluido en el Brief vigente.' : 'Scope no verificado.',
    'No probar endpoints por nombres adivinados ni fuera del Brief.');
  g('sqli-g1', 'Petición legítima capturada con cuenta autorizada', i.baselineCaptured === true && i.authorizedAccount === true,
    i.baselineCaptured && i.authorizedAccount ? 'Baseline real y cuenta autorizada.' : 'Falta baseline o autorización.',
    'La suite no sustituye la autorización del programa.');
  g('sqli-g2', 'Un único parámetro controlado', i.singleParameter === true,
    i.singleParameter ? 'Un parámetro por prueba.' : 'Se pretenden probar varios parámetros.',
    'Evita fuzzing, enumeración y resultados ambiguos.');
  g('sqli-g3', 'Prueba mínima, no destructiva y sin extracción',
    i.nonDestructive === true && i.noExtraction === true && i.automated === false && i.extractionAttempted === false && i.enumerationAttempted === false,
    i.nonDestructive === true && i.noExtraction === true && i.automated !== true && i.extractionAttempted !== true && i.enumerationAttempted !== true
      ? 'Sin escritura, extracción, enumeración ni automatización.' : 'La prueba podría alterar, extraer, enumerar o automatizarse.',
    'No usar sqlmap/ghauri, dump, schema enumeration, stacked queries ni acciones destructivas.');
  g('sqli-g4', 'Ritmo y volumen dentro del límite',
    i.rateLimitRespected === true && i.automated === false && (i.requestCount || 0) >= 1 && (i.requestCount || 0) <= 2,
    i.rateLimitRespected === true && i.automated !== true && (i.requestCount || 0) >= 1 && (i.requestCount || 0) <= 2 ? 'Entre 1 y 2 peticiones manuales y controladas.' : 'Volumen, automatización o ritmo no acreditado.',
    'SQLi automatizada o cientos de peticiones quedan fuera del flujo.');
  g('sqli-g5', 'Indicador reproducible sin impacto en datos reales', i.differentialEvidence === true && i.reproducibleCount >= 2,
    i.differentialEvidence && i.reproducibleCount >= 2 ? 'Diferencia reproducida dos veces.' : 'No hay diferencia reproducible.',
    'Un error genérico o una latencia aislada no demuestra SQLi.');
  g('sqli-g6', 'Impacto de seguridad concreto demostrado', i.securityImpact === true,
    i.securityImpact ? 'Impacto real documentado.' : 'No hay impacto concreto.',
    'No abrir reporte solo por una respuesta distinta.');
  const sendable = r.every((item) => item.ok);
  return verdict(sendable, sendable ? '✅ CADENA SQLi COMPLETA' : `⛔ INCOMPLETA: ${r.filter(item => !item.ok).map(item => item.id).join(', ')}`, r);
}

function revocationChain(i) {
  return revocationMod.analyze(i);
}

function openaiModelChain(i) {
  const r = [];
  const g = (id, label, ok, detail, lesson) => r.push(gate(id, label, ok === true, detail || (ok === true ? 'OK' : 'PENDIENTE'), lesson));
  const programName = String(i.programName || '').toLowerCase();
  g('oai-g0', 'Programa OpenAI/Bugcrowd identificado', i.program === 'openai' || programName === 'openai' || i.openaiProgram === true,
    (i.program === 'openai' || programName === 'openai' || i.openaiProgram === true) ? 'Programa OpenAI identificado.' : 'El contexto no identifica el programa OpenAI.',
    'No mezclar evidencia de otro programa o de un tercero.');
  g('oai-g1', 'Cuenta propia o cuenta de test autorizada', i.ownTestAccount === true,
    i.ownTestAccount ? 'Cuenta propia/de test autorizada.' : 'No hay cuenta de test autorizada.',
    'No usar cuentas, tokens ni datos de terceros.');
  g('oai-g2', 'Asset y endpoint dentro del scope exacto', i.inScope === true,
    i.inScope ? 'Asset dentro del Brief vigente.' : 'Scope no verificado.',
    'El Brief actual prevalece sobre el recon o la política local.');
  g('oai-g3', 'Request/response real capturado', i.requestResponseCaptured === true,
    i.requestResponseCaptured ? 'Par request/response disponible.' : 'Falta la pareja request/response.',
    'Un nombre encontrado en un bundle no demuestra acceso.');
  g('oai-g4', 'La respuesta devuelve un identificador de modelo', i.modelIdReturned === true,
    i.modelIdReturned ? 'La respuesta devuelve model ID.' : 'No hay model ID devuelto por el servidor.',
    'No reportar nombres hipotéticos, errores ni respuestas del modelo.');
  g('oai-g5', 'Privado/no anunciado demostrado frente a fuente pública vigente', i.privateOrUnannounced === true,
    i.privateOrUnannounced ? 'Estado privado/no anunciado documentado.' : 'No se ha demostrado que sea privado/no anunciado.',
    'Comparar con la documentación pública y el Brief vigente, sin adivinar.');
  g('oai-g6', 'Acceso no autorizado o aislamiento roto demostrado', i.unauthorizedAccess === true,
    i.unauthorizedAccess ? 'La cuenta no debía disponer de ese acceso.' : 'El acceso puede ser intencionado o no está demostrado.',
    'Tener acceso autorizado a un modelo no es por sí solo una vulnerabilidad.');
  g('oai-g7', 'Impacto de seguridad concreto demostrado', i.securityImpact === true,
    i.securityImpact ? 'Impacto de seguridad reproducible.' : 'Solo hay descubrimiento de nombre o comportamiento.',
    'El contenido del modelo, jailbreaks y alucinaciones no sustituyen un impacto elegible.');
  g('oai-g8', 'Reproducido al menos dos veces', (i.reproducibleCount || 0) >= 2,
    (i.reproducibleCount || 0) >= 2 ? 'Reproducido 2+ veces.' : 'Reproducción insuficiente.',
    'La evidencia debe permitir que otro investigador la repita.');
  g('oai-g9', 'Sin PII, secretos ni sistemas de terceros', i.noPII === true && i.noThirdParty === true,
    i.noPII === true && i.noThirdParty === true ? 'Datos minimizados y sin terceros.' : 'Hay PII/secretos o intervención de terceros.',
    'Detenerse ante PII/secretos y no probar proveedores externos.');
  const sendable = r.every((item) => item.ok);
  return verdict(sendable, sendable ? '✅ CADENA OPENAI-MODELO COMPLETA' : `⛔ INCOMPLETA: ${r.filter(item => !item.ok).map(item => item.id).join(', ')}`, r);
}

function reportReadiness(i) {
  const r = [];
  const chk = (id, label, ok, lesson) => r.push(gate(id, label, ok === true, ok === true ? 'OK' : 'PENDIENTE', lesson));
  chk('rep-1', 'Asset dentro del scope exacto', i.inScope);
  chk('rep-2', 'Buscados reports parecidos (no duplicado)', i.noDuplicate);
  chk('rep-3', 'No es disqualifier del programa', i.notDisqualifier);
  chk('rep-4', 'Explotable de verdad (impacto real)', i.exploitable);
  chk('rep-5', 'Captura(s) del exploit e impacto', i.evidenceScreenshots);
  chk('rep-6', 'Request/response reproducible adjunto', i.evidenceRequestResponse);
  chk('rep-7', 'PoC mínimo con pasos numerados', i.pocMinimal);
  chk('rep-8', 'Sin PII real (redactado)', i.noPII);
  chk('rep-9', 'PoC reproducido ≥2 veces', (i.reproducibleCount || 0) >= 2);
  chk('rep-10', 'Severidad/CVSS honesto', i.severityHonest);
  chk('rep-11', 'Revisión humana documentada', i.humanReview === true && String(i.reviewNote || '').trim().length >= 20,
    'La apertura a triage requiere una atestación humana breve; no basta con marcar flags desde un cliente.');
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

// ── Reglas automáticas por tipo (anti-rechazo): lo que el triage exige y que nos quemó ──
// Cualquier reporte de tipo CORS se BLOQUEA en la puerta de triage si no demuestra
// lectura cross-origin real (crossOriginRead) y exfiltración (exfil). Reflejar la
// cabecera NO es la vulnerabilidad; lo es el dato que otro origen puede leer.
function corsTriageChecklist(i) {
  return [
    gate('cors-t1', 'crossOriginRead: el navegador LEYÓ datos desde otro origen', i.crossOriginRead === true,
      i.crossOriginRead === true ? 'El navegador leyó el cuerpo cross-origin.' : 'Sin lectura cross-origin. Reflejar ≠ explotar.',
      'La cabecera reflejada no es la vuln: lo es el DATO que otro origen puede leer.'),
    gate('cors-t2', 'exfil demostrada (callback controlado)', i.exfil === true,
      i.exfil === true ? 'El dato llegó al origen del atacante.' : 'Sin exfiltración demostrada.',
      'Sin exfil, el triager lo cierra como Informative/N/A.'),
  ];
}

// Compuerta de triage dependiente del tipo de bug. Hoy: CORS y LÓGICA DE NEGOCIO.
// Devuelve { sendable, summary, results } (compatible con verdictToText).
function exigirPorTipo(meta) {
  const t = String((meta && meta.bugType) || '').toLowerCase();
  if (t.includes('idor') || t.includes('insecure direct object') || t.includes('autorizacion horizontal') || t.includes('autorización horizontal')) {
    const extra = idorChain(meta || {});
    return { sendable: extra.sendable, summary: extra.summary, results: extra.results };
  }
  if (t.includes('cors')) {
    const extra = corsTriageChecklist(meta || {});
    const ok = extra.every((g) => g.ok);
    return {
      sendable: ok, summary: ok
        ? '✅ CORS cumple requisitos de triage (crossOriginRead + exfil)'
        : `⛔ CORS sin cadena de lectura: ${extra.filter(g => !g.ok).map(g => g.id).join(', ')}`,
      results: extra,
    };
  }
  // LÓGICA DE NEGOCIO: si el tipo indica manipulación de precio/checkout/cupón/
  // reward/redeem/free-entry/race, se exige la cadena bizChain COMPLETA.
  // Sin "el servidor aceptó el valor alterado" + "impacto demostrado" → bloqueado.
  if (/sql.?i|sql.?injection|inyeccion.?sql|inyección.?sql/.test(t)) {
    const extra = sqliChain(meta || {});
    return {
      sendable: extra.sendable,
      summary: extra.summary,
      results: extra.results,
    };
  }
  if (/revoc|revoke|revoked|shared.file|shared.conversation|archivo.compartido|conversacion.compartida|conversation.access/.test(t)) {
    const extra = revocationChain(meta || {});
    return {
      sendable: extra.sendable,
      summary: extra.summary,
      results: extra.results,
    };
  }
  if (/modelo|model|private|privad|unannounced|inédito/.test(t)) {
    const extra = openaiModelChain(meta || {});
    return {
      sendable: extra.sendable,
      summary: extra.summary,
      results: extra.results,
    };
  }
  if (/precio|checkout|line-item|coupon|cupon|descuento|reward|redeem|canje|free.entry|bypass.*pago|race|price.tamper|business.logic|logica.de.negocio/.test(t)) {
    const extra = bizMod.bizChain(meta || {});
    const criticos = extra.results.filter((g) => ['biz-g3', 'biz-g4'].includes(g.id));
    const ok = criticos.every((g) => g.ok);
    return {
      sendable: ok,
      summary: ok
        ? '✅ Lógica de negocio cumple requisitos de triage (servidor aceptó alteración + impacto)'
        : `⛔ Lógica de negocio SIN impacto demostrable: ${criticos.filter(g => !g.ok).map(g => g.id).join(', ')} — el servidor debe aceptar el valor alterado y el impacto debe estar demostrado`,
      results: extra.results,
    };
  }
  const cap = manualMod.capabilityCheck(meta || {});
  if (!cap.sendable) return cap;
  return { sendable: true, summary: null, results: [] };
}

module.exports = {
  gate, verdict,
  corsChain, idorChain, ssrfChain, xssChain, subdomainChain, decepticonChain, sqliChain, revocationChain, openaiModelChain, reportReadiness, exigirPorTipo,
  bizChain: bizMod.bizChain, bizClases: bizMod.CLASES, bizPlaybook: bizMod.PLAYBOOK,
  altaChain: altaMod.altaChain, altaDecision: altaMod.decision, altaFases: altaMod.FASES,
  manualPlaybook: manualMod.PLAYBOOK, manualChecklist: manualMod.CHECKLIST_FINAL, manualValidate: manualMod.validateManual, manualCapability: manualMod.capabilityCheck,
  verdictToText,
};