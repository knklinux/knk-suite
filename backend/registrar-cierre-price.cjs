'use strict';
// Registra el cierre (veredicto no-reportable) de la Fase A de price-api.crypto.com
// (target crypto.com/price): bundle mapeado + 3 vectores probados, sin hallazgo.
// Uso: node registrar-cierre-price.cjs
const sessionMod = require('./lib/session');

const s = sessionMod.load();

const cierre = {
  type: 'CERRADO-NOREPORTABLE',
  target: 'price-api.crypto.com (crypto.com/price)',
  summary: 'Fase A price-api.crypto.com — CERRADO: bundle del SPA de /price mapeado (13 endpoints publicos + detalle meta/v1/token/{id} con 33 campos). 3 vectores probados sin hallazgo: (1) slug-enum en token-price/{slug} → lookup estricto case-sensitive, id numerico no resuelve (404); (2) all-coin-launches → solo name/symbol/id/icon, sin fechas ni info no publicada; (3) meta/v2/all-tokens + detalle por id → 30632 tokens publicos, sin visibility oculta, sin active=false, sin datos diferenciales. Lo autenticado (coin-price-sse-auth/api/* 401, meta/v2/all-tokens/1 401) bien protegido. Catalogo publico por diseno → no reportable.',
  severity: 'info',
  details: {
    estado: 'cerrado',
    veredicto: 'no_reportable',
    clase: 'superficie-sin-login|api-publica',
    evidencia: 'docs/bugbounty/PRICE-API-FASE-A-2026-09-01.md',
    fecha: '2026-09-01',
    fase: 'A',
    endpoints_mapeados: 13,
    tokens_catalogo: 30632,
    vectores_probados: 3
  }
};

sessionMod.addFinding(s, cierre);
const ok = sessionMod.save(sessionMod.DEFAULT_FILE, s);
if (!ok) { console.error('ERROR: save() devolvió false'); process.exit(1); }

try {
  const db = require('./db');
  const ses = db.getOrCreateSession(null);
  db.addFinding(ses.id, cierre.type, cierre.summary, cierre.severity, cierre.details);
  console.log('  ✓ registrado también en SQLite');
} catch (e) {
  console.log('  (SQLite no disponible: ' + e.message.slice(0, 60) + ')');
}

console.log('Cierre registrado. Hallazgos totales:', s.findings.length);
console.log('Cierres totales:', s.findings.filter(f => f.type === 'CERRADO-NOREPORTABLE').length);
