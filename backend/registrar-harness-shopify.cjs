'use strict';
// Registra en knk-suite el harness de lógica de negocio del guest checkout de la
// dev store de Shopify como artefacto de la sesión.
// Uso: node registrar-harness-shopify.cjs
const sessionMod = require('./lib/session');

const s = sessionMod.load();

sessionMod.setArtifact(s, 'harness-shopify', {
  estado: 'listo, pendiente de dev store',
  target: 'Shopify (H1) — dev store propia *.myshopify.com + checkout.shopify.com',
  fecha: '2026-09-02',
  scope_verificado: 'docs/bugbounty/SHOPIFY-SCOPE-2026-09-02.md — our-store.myshopify.com Core/Critical eligible; *.shopify.com Non-core/Medium eligible',
  script: 'docs/moneybox-sesion/probar-shopify-biz.mjs',
  config: 'docs/moneybox-sesion/shopify-checkout-cfg.json (template: shopify-checkout-cfg.template.json)',
  apis_reales: ['/cart.js', '/cart/add.js', '/cart/change.js', '/cart/update.js', '/products.json', 'checkout review (confirm)'],
  fases: {
    'F0': 'config store (sin store → corta limpio)',
    'F1': 'forma real GET-only: navega al origen de la store, products.json → variante real, cart.js baseline',
    'F2': 'escenarios biz: add → qty 999/-1 → update price/attrs → review checkout → clear (PERMITIR_MUTACIONES=1)'
  },
  cortafuegos_cobro: {
    patrones: ['/complete', 'complete_purchase', '/pay', 'payment', 'charge', 'capture', 'authorize', 'card', '/3ds', 'place_order', 'order_confirm'],
    verificado: true
  },
  evidencia: 'docs/moneybox-sesion/evidencia-shopify/evidencia.json (F1 baseline + F2A/F2B/F2C + F2Z clear)',
  bloqueante: 'crear la dev store propia en partners.shopify.com (gratis, sin KYC) y rellenar cfg.store.dominio + producto real',
  leccion_regla: 'Test SOLO sobre la store propia (stores you have created). Nunca merchants reales ni apps de terceros. Nunca completar cobro.'
});

sessionMod.addNote(s,
  'HARNESS SHOPIFY LISTO (2026-09-02): probar-shopify-biz.mjs con la Ajax API real del storefront ' +
  '(guest checkout sin login). Fases 0/1 verificadas (corta limpio sin store; navega origen + products.json + cart.js). ' +
  'Fase 2 (qty-overflow/precio-linea/cupon/envio, review del total sin pagar) lista con PERMITIR_MUTACIONES=1 y cfg. ' +
  'Scope verificado en H1 el mismo día: dev store propia Core/Critical eligible; checkout.shopify.com bajo *.shopify.com eligible. ' +
  'Cortafuegos de cobro activos (patrones place_order/payment/3ds/complete). Bloqueante: crear la dev store en partners.shopify.com. ' +
  'Regla del programa: solo la store propia, nunca merchants reales, nunca completar cobro.'
);

const ok = sessionMod.save(sessionMod.DEFAULT_FILE, s);
if (!ok) { console.error('ERROR: save() devolvió false — session.json NO actualizado'); process.exit(1); }

console.log('Artefacto registrado: harness-shopify');
console.log('Nota registrada. Estado de la sesión:');
console.log('  hallazgos:', s.findings.length, '| notas:', s.notes.length, '| artefactos:', Object.keys(s.artifacts).length);
console.log('Artefactos:', Object.keys(s.artifacts));