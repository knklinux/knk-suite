'use strict';
// Registra en knk-suite el cierre (veredicto no-reportable) de la Fase A de
// crypto.com/nft: superficie GraphQL anónima mapeada, introspection off, sin hallazgo.
// Uso: node registrar-cierre-nft.cjs
const sessionMod = require('./lib/session');

const s = sessionMod.load();

const cierres = [
  {
    type: 'CERRADO-NOREPORTABLE',
    target: 'crypto.com/nft (nft-api/graphql)',
    summary: 'Fase A crypto.com/nft — CERRADO: superficie sin login mapeada via MITM (37 requests GraphQL anonimos, 12 operaciones: GetMarketplaceAssets/GetCollections/GetTopCollectibles/LiveAndUpcomingDrops/getPublicSharedConfigs...). Todo 200 pero es catalogo publico por diseno (drops/colecciones/listings con precio). Introspection GraphQL deshabilitada (sin schema leak). Filtros ownerId/assetOwnerId/creatorId son de catalogo, sin datos ajenos demostrados. biz-precio/redeem exige sesion de cuenta NFT (misma barrera que experiences). Sin hallazgo reportable.',
    severity: 'info',
    details: {
      estado: 'cerrado',
      veredicto: 'no_reportable',
      clase: 'superficie-sin-login|graphql',
      evidencia: 'docs/bugbounty/NFT-FASE-A-2026-09-01.md|docs/bugbounty/evidencia-nft/graphql-anon-2026-08-30.jsonl',
      fecha: '2026-09-01',
      fase: 'A',
      ops_graphql: 12,
      requests_capturados: 37,
      introspection: 'disabled'
    }
  }
];

for (const c of cierres) sessionMod.addFinding(s, c);

sessionMod.addNote(s,
  'CIERRE FASE A NFT (2026-09-01): crypto.com/nft registrado como CERRADO-NOREPORTABLE. ' +
  'Surface sin login agotada en el programa: mona, Nadex, Mozilla, Shopify, js.crypto.com y ahora NFT ' +
  'quedan documentados sin hallazgo. La clase biz real (biz-precio/redeem) exige cuenta propia ' +
  '(experiences o NFT) — siguiente bloqueante es la cuenta de test.'
);

const ok = sessionMod.save(sessionMod.DEFAULT_FILE, s);
if (!ok) { console.error('ERROR: no se pudo escribir session.json'); process.exit(1); }

// Cross-check con SQLite si está disponible (db.js)
try {
  const db = require('./db');
  const ses = db.getOrCreateSession(null);
  for (const c of cierres) db.addFinding(ses.id, c.type, c.summary, c.severity, c.details);
  console.log('  ✓ registrado también en SQLite (findings)');
} catch (e) {
  console.log('  (SQLite no disponible: ' + (e.code === 'MODULE_NOT_FOUND' ? 'better-sqlite3 no instalado' : e.message) + ')');
}

console.log('Registrado en sesión JSON: ' + cierres.length + ' cierre + 1 nota.');
console.log('Hallazgos totales ahora: ' + s.findings.length);
console.log('Notas totales ahora: ' + s.notes.length);
