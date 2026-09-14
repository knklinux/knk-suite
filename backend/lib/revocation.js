'use strict';

// Flujo de validación de revocación: no hace peticiones por sí mismo.
// La interacción real debe capturarse desde el navegador CDP autenticado y
// pasar por el scope/rate limiter del resto de la suite.

const RESOURCE_TYPES = new Set(['file', 'conversation']);

function resourceType(value) {
  const type = String(value || '').trim().toLowerCase();
  return RESOURCE_TYPES.has(type) ? type : null;
}

function plan(input = {}) {
  const type = resourceType(input.resourceType) || 'file';
  return {
    resourceType: type,
    accounts: ['A — propietaria', 'B — cuenta propia/de test autorizada'],
    dataPolicy: 'Recurso sintético, sin PII, secretos, datos de terceros ni fondos reales.',
    sequence: [
      'A crea el recurso sintético y captura su identificador/URL sin secretos.',
      'A comparte el recurso con B mediante el flujo normal.',
      'B confirma acceso legítimo y se captura el baseline.',
      'A revoca el permiso o desactiva el enlace desde la interfaz normal.',
      'B repite una lectura con el enlace/identificador ya revocado.',
      'B intenta únicamente una acción reversible de escritura si el producto la ofrece.',
      'Se capturan estado, cuerpo mínimo redactado y pantallas antes/después.',
    ],
    stopConditions: [
      'Aparece PII, secreto o recurso de un tercero.',
      'Respuesta 429/403/CAPTCHA o degradación del servicio.',
      'La operación exige borrar, pagar, enviar mensajes o completar una transacción real.',
      'El Brief vigente excluye el asset, recurso o acción.',
    ],
    evidence: [
      'baseline-owner',
      'share-confirmation',
      'revocation-action',
      'post-revocation-read',
      'post-revocation-write (solo si es reversible)',
    ],
  };
}

function analyze(input = {}) {
  const type = resourceType(input.resourceType);
  const readStatus = Number(input.postRevokeReadStatus);
  const writeStatus = Number(input.postRevokeWriteStatus);
  const readLeak = input.postRevokeRead === true
    && readStatus >= 200 && readStatus < 300
    && input.privateContentReturned === true;
  const writeLeak = input.postRevokeWrite === true
    && writeStatus >= 200 && writeStatus < 300;
  const accessRemains = readLeak || writeLeak;
  const gates = [
    ['rev-g0', 'Tipo de recurso válido (archivo o conversación)', RESOURCE_TYPES.has(type)],
    ['rev-g1', 'Programa OpenAI/Bugcrowd y asset en scope exacto', input.openaiProgram === true && input.inScope === true],
    ['rev-g2', 'OPPLAN aprobado y autorización escrita', input.opplanApproved === true && input.authorized === true],
    ['rev-g3', 'Cuentas A/B propias o de test autorizadas', input.ownAccountsAB === true],
    ['rev-g4', 'Recurso sintético sin PII ni secretos', input.syntheticResource === true && input.noPII === true],
    ['rev-g5', 'Baseline legítimo de B capturado antes de revocar', input.baselineB === true],
    ['rev-g6', 'Revocación ejecutada por A y confirmada', input.revocationPerformed === true && input.revocationConfirmed === true],
    ['rev-g7', 'Se comprobó el acceso posterior sin enumeración', input.postRevokeCheck === true && input.singleResource === true],
    ['rev-g8', 'Sin terceros y con rate limit respetado', input.noThirdParty === true && input.rateLimitRespected === true],
    ['rev-g9', 'Reproducible al menos dos veces', Number(input.reproducibleCount) >= 2],
    ['rev-g10', 'Evidencia diferencial suficiente', input.evidenceComplete === true],
    ['rev-g11', 'Impacto: lectura privada o escritura no autorizada tras revocar', accessRemains],
  ];
  const results = gates.map(([id, label, ok]) => ({
    id,
    label,
    ok: ok === true,
    detail: ok === true ? 'OK' : 'PENDIENTE',
  }));
  const sendable = results.every((item) => item.ok);
  return {
    sendable,
    accessRemains,
    readLeak,
    writeLeak,
    summary: sendable
      ? `✅ REVOCACIÓN ROTA: ${type} sigue accesible después de revocar`
      : `⛔ REVOCACIÓN NO CONFIRMADA: ${results.filter((item) => !item.ok).map((item) => item.id).join(', ')}`,
    results,
  };
}

module.exports = { RESOURCE_TYPES, resourceType, plan, analyze };
