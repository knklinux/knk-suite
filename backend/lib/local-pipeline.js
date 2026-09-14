'use strict';

// Pipeline de QA completamente local. No usa DNS, HTTP, Docker, Burp ni
// credenciales. Su resultado valida KNK Suite; no constituye un hallazgo ni
// una autorización para probar un programa externo.

const { RevocationLab } = require('./revocation-lab');

const SYNTHETIC_ROUTES = [
  '/', '/health', '/api/resources', '/api/resources/synthetic-1',
  '/api/resources/synthetic-1/share', '/api/resources/synthetic-1/revoke',
  '/api/resources/synthetic-1/audit', '/api/conversations',
  '/api/conversations/synthetic-1', '/api/conversations/synthetic-1/share',
  '/api/conversations/synthetic-1/revoke', '/api/files',
  '/api/files/synthetic-1', '/api/files/synthetic-1/share', '/api/files/synthetic-1/revoke',
];

function phase(id, output, findings = []) {
  return { phase: id, ok: true, localOnly: true, output, findings };
}

function runLocalPipeline({ maxPaths = 15 } = {}) {
  const startedAt = new Date().toISOString();
  const phases = [];

  phases.push(phase('plan', {
    mode: 'local-synthetic',
    authorization: 'not applicable: no external target',
    target: '127.0.0.1 synthetic fixtures (in-memory)',
    scope: ['local synthetic fixtures'],
    externalRequests: 0,
    dockerRequired: false,
  }));

  phases.push(phase('recon', {
    mode: 'synthetic inventory',
    resources: ['file', 'conversation'],
    accounts: ['A', 'B'],
    externalRequests: 0,
  }));

  phases.push(phase('scan', {
    mode: 'synthetic policy checks',
    checks: {
      privateResourceRequiresAuthorization: true,
      revokedResourceReturns403: true,
      unauthorizedWriteReturns403: true,
      syntheticContentOnly: true,
    },
    externalRequests: 0,
  }));

  const routes = SYNTHETIC_ROUTES.slice(0, Math.min(15, Math.max(1, Number(maxPaths) || 15)));
  phases.push(phase('fuzz', {
    mode: 'manual-paced-simulation',
    routes,
    total: routes.length,
    requestsMade: 0,
    concurrency: 1,
    rateLimitMs: 2000,
    stoppedOn: null,
    note: 'Simulación sin solicitudes: la terminal/Docker no participa en este QA local.',
  }));

  const secureRevocation = new RevocationLab({ enforceRevocation: true }).runScenario('conversation');
  const vulnerableRevocation = new RevocationLab({ enforceRevocation: false }).runScenario('conversation');
  const secureIdor = new RevocationLab({ enforceRevocation: true }).runIdorScenario('file');
  const vulnerableIdor = new RevocationLab({ enforceRevocation: false }).runIdorScenario('file');
  const exploitChecks = {
    revocationSecure: secureRevocation.secure,
    revocationFixtureDetected: vulnerableRevocation.afterRead.status === 200
      && vulnerableRevocation.afterWrite.status === 204,
    idorSecure: secureIdor.secure,
    idorFixtureDetected: vulnerableIdor.vulnerable,
  };
  const exploitOk = Object.values(exploitChecks).every(Boolean);
  phases.push({
    phase: 'exploit',
    ok: exploitOk,
    localOnly: true,
    output: {
      mode: 'fixture-validation',
      checks: exploitChecks,
      secureExpected: {
        revocationAfterRevoke: secureRevocation.afterRead.status,
        revocationAfterRevokeRepeat: secureRevocation.afterReadAgain.status,
        revocationUnauthorizedWrite: secureRevocation.afterWrite.status,
        idorReadWithA: secureIdor.readWithA.status,
        idorWriteWithA: secureIdor.writeWithA.status,
      },
      vulnerableFixture: {
        revocationAfterRevoke: vulnerableRevocation.afterRead.status,
        revocationUnauthorizedWrite: vulnerableRevocation.afterWrite.status,
        idorReadWithA: vulnerableIdor.readWithA.status,
        idorWriteWithA: vulnerableIdor.writeWithA.status,
      },
    },
    findings: exploitOk ? [{
      type: 'LOCAL-QA',
      summary: 'Los detectores distinguen correctamente el modo seguro del fixture vulnerable.',
      severity: 'info',
    }] : [{
      type: 'LOCAL-QA-FAIL',
      summary: 'El fixture local no produjo los estados esperados.',
      severity: 'high',
    }],
  });

  const report = {
    status: 'qa-only',
    sendableToBugcrowd: false,
    externalFinding: false,
    reason: 'El resultado procede de fixtures sintéticos locales y no demuestra impacto en un servicio externo.',
    evidence: ['secure revocation: B recibe 403 tras revocar', 'secure IDOR: A recibe 403 al leer/escribir recurso privado de B', 'vulnerable fixtures detectados por el analizador'],
  };
  phases.push(phase('reporte', report));

  const verification = {
    allPhasesOk: phases.every((p) => p.ok),
    externalRequests: 0,
    dockerUsed: false,
    burpUsed: false,
    reportBlockedFromExternalSubmission: report.sendableToBugcrowd === false,
  };
  phases.push(phase('verificar', verification));

  return {
    mode: 'local-synthetic',
    localOnly: true,
    externalRequests: 0,
    dockerUsed: false,
    burpUsed: false,
    startedAt,
    completedAt: new Date().toISOString(),
    completed: phases.filter((p) => p.ok).length,
    total: phases.length,
    phases,
    verdict: verification.allPhasesOk ? 'QA LOCAL OK — no es un reporte externo' : 'QA LOCAL FALLIDO',
  };
}

module.exports = { runLocalPipeline, SYNTHETIC_ROUTES };
