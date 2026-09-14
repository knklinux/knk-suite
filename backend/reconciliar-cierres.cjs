'use strict';
// Reconciliación: añade al session.json los cierres CERRADO-NOREPORTABLE que
// ya están en SQLite pero nunca se persistieron en JSON (bug: save(file, session)
// se llamaba sin la sesión → TypeError silencioso → save() devolvía false).
// Uso: node reconciliar-cierres.cjs
const sessionMod = require('./lib/session');

const s = sessionMod.load();

// Los 4 cierres tal como quedaron registrados en SQLite (fuente de verdad)
const cierres = [
  {
    type: 'CERRADO-NOREPORTABLE',
    target: 'www.newegg.com',
    summary: 'Newegg carrito (Add2CartV2/InitCartApi/SmartCartApi) — CERRADO: sin vector de precio (ItemKey+Quantity no llevan campo precio, server-side), cantidad clampeada (999/-1/5000 → 201 sin reflejarse), nonce replay a 2s → 400 (anti-replay presente). biz-precio/biz-cupon/quantity-overflow NO explotable.',
    severity: 'info',
    details: { estado: 'cerrado', veredicto: 'no_reportable', clase: 'biz-precio|biz-cupon|biz-envio', evidencia: 'docs/bugbounty/NEWEGG-ADD2CART-EVIDENCIA-2026-08-30.md', fecha: '2026-08-30' }
  },
  {
    type: 'CERRADO-NOREPORTABLE',
    target: 'img/r.mail.travel.crypto.com',
    summary: 'Brevo takeover (img/r.mail.travel.crypto.com → brevosend) — CERRADO: brand reproducible pero DNS-gate impide servir contenido. Dangling inerte, infra huérfana no reportable.',
    severity: 'info',
    details: { estado: 'cerrado', veredicto: 'no_explotable', clase: 'subdomain-takeover', evidencia: 'docs/crypto-com-recon/BREVO-VEREDICTO-2026-08-18.md', fecha: '2026-08-18' }
  },
  {
    type: 'CERRADO-NOREPORTABLE',
    target: 'abmail/em7289/statuspage',
    summary: 'SendGrid whitelabels huérfanos (abmail/em7289/statuspage) — CERRADO: verificado que no son reclamables (dangling inerte, sin contenido servido).',
    severity: 'info',
    details: { estado: 'cerrado', veredicto: 'no_reclamable', clase: 'subdomain-takeover', evidencia: 'docs/crypto-com-recon/SENDGRID-CLAIM-2026-08-18.md', fecha: '2026-08-18' }
  },
  {
    type: 'CERRADO-NOREPORTABLE',
    target: 'crypto.com/nft (nft-api/graphql)',
    summary: 'Fase A crypto.com/nft — CERRADO: superficie sin login mapeada via MITM (37 requests GraphQL anonimos, 12 operaciones). Todo 200 pero catalogo publico por diseno. Introspection GraphQL deshabilitada. Filtros ownerId/assetOwnerId/creatorId sin datos ajenos demostrados. biz-precio/redeem exige sesion de cuenta NFT. Sin hallazgo reportable.',
    severity: 'info',
    details: { estado: 'cerrado', veredicto: 'no_reportable', clase: 'superficie-sin-login|graphql', evidencia: 'docs/bugbounty/NFT-FASE-A-2026-09-01.md|docs/bugbounty/evidencia-nft/graphql-anon-2026-08-30.jsonl', fecha: '2026-09-01', fase: 'A', ops_graphql: 12, requests_capturados: 37, introspection: 'disabled' }
  }
];

let añadidos = 0;
const existentes = new Set(s.findings.map(f => f.target));
for (const c of cierres) {
  if (!existentes.has(c.target)) {
    sessionMod.addFinding(s, c);
    añadidos++;
  }
}

if (añadidos > 0) {
  const ok = sessionMod.save(sessionMod.DEFAULT_FILE, s);
  if (!ok) { console.error('ERROR: save() devolvió false — session.json NO actualizado'); process.exit(1); }
}

console.log('Cierres añadidos al JSON:', añadidos);
console.log('Hallazgos totales en JSON:', s.findings.length);
console.log('Notas totales en JSON:', s.notes.length);
console.log('--- verificación de targets ---');
for (const f of s.findings) if (f.type === 'CERRADO-NOREPORTABLE') console.log('-', f.id, f.target);
