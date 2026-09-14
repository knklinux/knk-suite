'use strict';
// Registra en knk-suite la clausura definitiva (veredicto no-reportable) de los
// hallazgos Newegg / Brevo / SendGrid, con la evidencia y el veredicto.
// Uso: node registrar-cierres.mjs
const path = require('path');
const sessionMod = require('./lib/session');

const s = sessionMod.load();

const cierres = [
  {
    type: 'CERRADO-NOREPORTABLE',
    target: 'www.newegg.com',
    summary: 'Newegg carrito (Add2CartV2/InitCartApi/SmartCartApi) — CERRADO: sin vector de precio (ItemKey+Quantity no llevan campo precio, server-side PriceChangeUSA), cantidad clampeada (999/-1/5000 → 201 sin reflejarse en MiniCart), nonce replay a 2s → 400 (anti-replay presente). biz-precio/biz-cupon/quantity-overflow NO explotable.',
    severity: 'info',
    details: {
      estado: 'cerrado',
      veredicto: 'no_reportable',
      clase: 'biz-precio|biz-cupon|biz-envio',
      evidencia: 'docs/bugbounty/NEWEGG-ADD2CART-EVIDENCIA-2026-08-30.md',
      fecha: '2026-08-30'
    }
  },
  {
    type: 'CERRADO-NOREPORTABLE',
    target: 'img/r.mail.travel.crypto.com',
    summary: 'Brevo takeover (img/r.mail.travel.crypto.com → brevosend) — CERRADO: brand reproducible pero DNS-gate impide servir contenido (solo controlable con control del DNS de crypto.com). Dangling inerte, infra huérfana no reportable.',
    severity: 'info',
    details: {
      estado: 'cerrado',
      veredicto: 'no_explotable',
      clase: 'subdomain-takeover',
      evidencia: 'docs/crypto-com-recon/BREVO-VEREDICTO-2026-08-18.md',
      fecha: '2026-08-18'
    }
  },
  {
    type: 'CERRADO-NOREPORTABLE',
    target: 'abmail/em7289/statuspage',
    summary: 'SendGrid whitelabels huérfanos (abmail/em7289/statuspage) — CERRADO: verificado que no son reclamables (dangling inerte, sin contenido servido; misma categoría que los ELB borrados). Misma categoría que los CNAME de elb deleteda.',
    severity: 'info',
    details: {
      estado: 'cerrado',
      veredicto: 'no_reclamable',
      clase: 'subdomain-takeover',
      evidencia: 'docs/crypto-com-recon/SENDGRID-CLAIM-2026-08-18.md',
      fecha: '2026-08-18'
    }
  }
];

for (const c of cierres) sessionMod.addFinding(s, c);

sessionMod.addNote(s,
  'CIERRE DEFINITIVO DE HALLAZGOS (2026-08-30): Newegg, Brevo y SendGrid registrados como ' +
  'CERRADO-NOREPORTABLE con evidencia y veredicto. Ninguno pasa la checklist anti-rechazo ' +
  '(impacto solo propio / no explotable / infra huérfana). NO enviar a triage. ' +
  'Los 3 archivos de evidencia ya presentan el veredicto completo del caso.'
);

const ok = sessionMod.save(sessionMod.DEFAULT_FILE, s);
if (!ok) { console.error('ERROR: save() devolvió false — session.json NO actualizado'); process.exit(1); }

// Cross-check con SQLite si está disponible (db.js)
try {
  const db = require('./db');
  const ses = db.getOrCreateSession(null);
  for (const c of cierres) db.addFinding(ses.id, c.type, c.summary, c.severity, c.details);
  console.log('  ✓ registrado también en SQLite (findings)');
} catch (e) {
  console.log('  (SQLite no disponible: ' + (e.code === 'MODULE_NOT_FOUND' ? 'better-sqlite3 no instalado' : e.message) + ')');
}

console.log('Registrados en sesión JSON: ' + cierres.length + ' cierres + 1 nota.');
console.log('Hallazgos totales ahora: ' + s.findings.length);
console.log('Notas totales ahora: ' + s.notes.length);