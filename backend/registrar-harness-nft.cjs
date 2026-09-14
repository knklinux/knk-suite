'use strict';
// Registra en knk-suite el harness de lógica de negocio de crypto.com/nft como
// artefacto de la sesión, con la lección del enum CheckoutKind y el estado
// 'listo, pendiente de cuenta'.
// Uso: node registrar-harness-nft.cjs
const sessionMod = require('./lib/session');

const s = sessionMod.load();

// Artefacto: estado del harness NFT
sessionMod.setArtifact(s, 'harness-nft', {
  estado: 'listo, pendiente de cuenta',
  target: 'crypto.com/nft (nft-api/graphql)',
  fecha: '2026-09-01',
  script: 'docs/moneybox-sesion/probar-nft-biz.mjs',
  config: 'docs/moneybox-sesion/nft-checkout-cfg.json (template: nft-checkout-cfg.template.json)',
  mutaciones_reales: [
    'createCheckout', 'createShoppingCartCheckout', 'createListing', 'createAuctionListing',
    'placeBid (PlaceBidMutation)', 'createOffer', 'acceptOffer', 'cancelListing', 'cancelOffer'
  ],
  cortafuegos_cobro: [
    'CreateAndCaptureAccountPayment', 'captureCROPayment', 'captureIXOPayment',
    'preauthIXOPayment', 'createWithdrawalFeeCheckout', 'checkoutAssetRecord'
  ],
  cortafuegos_verificado: true,
  sonda_sesion: {
    '_nota': 'Fase 0.5 del harness: queries de cuenta del root (sin public) = requieren sesión. Verificadas 2026-09-01: sin sesión → errors UNAUTHORIZED (HTTP 200). Con sesión → datos reales.',
    queries: ['getMyWallets', 'accountBalanceQuery', 'GetUserPrivateAssetsTotal', 'GetMyCollectedAssets', 'GetUserOwnedCollections', 'GetUserTransfers', 'GetMyLikedAssets'],
    verificadas_sin_sesion: 5
  },
  evidencia: 'docs/moneybox-sesion/evidencia-nft/evidencia.json (pasos F05-sesion-* + F1 catalogo + F2 createCheckout baseline)',
  bloqueante: 'sesión de cuenta Crypto.com en el Firefox moneybox (misma barrera que experiences)',
  leccion_enum: 'kind=BUY_NOW → 400 BAD_USER_INPUT: "Value BUY_NOW does not exist in CheckoutKind enum". Los strings del bundle son de UI, no el enum GraphQL (introspection off). Capturar el kind REAL con sesión antes de Fase 2.'
});

// Nota con la lección para el flujo de trabajo
sessionMod.addNote(s,
  'HARNESS NFT LISTO (2026-09-01): probar-nft-biz.mjs con las 9 mutaciones reales del bundle ' +
  'main.2e5ddba1.js, cortafuegos de cobro verificado en vivo (bloquea CreateAndCaptureAccountPayment y 5 más). ' +
  'LECCIÓN: los enums GraphQL del bundle (BUY_NOW etc.) son strings de UI — el schema real los rechaza (400 ' +
  'BAD_USER_INPUT) porque la introspection está deshabilitada; hay que capturar el valor real con sesión, no fiarse del bundle. ' +
  'Estado: listo, pendiente de cuenta Crypto.com.'
);

const ok = sessionMod.save(sessionMod.DEFAULT_FILE, s);
if (!ok) { console.error('ERROR: save() devolvió false — session.json NO actualizado'); process.exit(1); }

console.log('Artefacto registrado: harness-nft');
console.log('Nota registrada. Estado de la sesión:');
console.log('  hallazgos:', s.findings.length, '| notas:', s.notes.length, '| artefactos:', Object.keys(s.artifacts).length);
console.log('Artefactos:', Object.keys(s.artifacts));
