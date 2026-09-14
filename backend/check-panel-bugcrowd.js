'use strict';
// check-panel-bugcrowd.js — Lectura del panel Bugcrowd con la sesión del usuario
// Paso 1: detecta login en el navegador de evidencias (CDP 9336, perfil openai-poc).
// Paso 2 (si hay login): known-issues JSON + tabla de targets + scope del E13.
// Guarda evidencia en evidencia-poc/http/bugcrowd-panel-*.json|txt
//
//   node backend/check-panel-bugcrowd.js
// ============================================================================
const { abrirCanal, navegar } = require('./lib/browser');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PORT = 9336;
const PERFIL = path.join(os.homedir(), '.knk-suite', 'browser-profile', 'openai-poc');
const OUT_JSON = path.join(__dirname, '..', 'evidencia-poc', 'http', 'bugcrowd-panel-estado.json');
const OUT_TXT = path.join(__dirname, '..', 'evidencia-poc', 'http', 'bugcrowd-panel-scope.txt');
const ENG = 'https://bugcrowd.com/engagements/openai';

async function leer(canal, expresion) {
  const r = await canal.send('Runtime.evaluate', { expression: expresion, returnByValue: true });
  try { return JSON.parse(r.result.value); } catch { return { raw: r && r.result && r.result.value }; }
}

(async () => {
  const canal = await abrirCanal({ port: PORT, perfil: PERFIL, headed: true });
  const pag = await navegar(canal.send, ENG, 30000);
  await new Promise((r) => setTimeout(r, 2500));

  // ── PASO 1: ¿hay sesión? ───────────────────────────────────────────────────
  const estado = await leer(canal, `JSON.stringify((() => {
    const t = document.body.innerText;
    const hayLogout = /\\bLog ?out\\b|\\bSign ?out\\b|\\bDashboard\\b|\\bSubmissions\\b/i.test(t) && !/Hacker Login/.test(t);
    const hayLoginBtn = /Hacker Login|Customer Login/.test(t);
    const hayAvatar = !!document.querySelector('[data-testid="account-menu"]') || !!document.querySelector('img[alt*="avatar" i]');
    return { url: location.href, logueado: hayLogout || hayAvatar, hayLoginBtn };
  })())`);
  console.log('[paso 1] login detectado:', JSON.stringify(estado));

  if (!estado.logueado) {
    console.log('\n⛔ SIN SESIÓN. El navegador de evidencias está abierto en la página del programa.');
    console.log('   → ACCIÓN DEL USUARIO: haz login como Hacker en la ventana de Edge que está abierta');
    console.log('     ("Hacker Login" arriba a la derecha). Cuando termines, dime "ya" y reejecuto este script.');
    // Dejar la ventana abierta y el canal listo; cerrar solo el WS.
    canal.cerrar();
    process.exit(2);
  }

  // ── PASO 2a: tabla de targets (scope) ──────────────────────────────────────
  const targets = await leer(canal, `JSON.stringify((() => {
    const t = document.body.innerText;
    const out = {};
    for (const host of ['chatgpt.com','cdn.oaistatic.com','*.oaiusercontent.com','oaiusercontent.com','api.openai.com']) {
      const i = t.indexOf(host);
      out[host] = i >= 0 ? t.slice(Math.max(0, i - 120), i + 160).replace(/\\n+/g, ' | ') : null;
    }
    const iS = t.search(/in scope/i);
    out.seccionScope = iS >= 0 ? t.slice(iS, iS + 900).replace(/\\n+/g, ' | ') : null;
    return out;
  })())`);
  console.log('\n[paso 2a] targets/scope:', JSON.stringify(targets, null, 2).slice(0, 1500));

  // ── PASO 2b: known-issues JSON (autenticado) ───────────────────────────────
  const ki = await leer(canal, `fetch('/engagements/openai/engagement_known_issues.json', {credentials:'same-origin'})
    .then(r => r.text().then(t => ({ status: r.status, body: t.slice(0, 6000) })))
    .catch(e => ({ status: 0, error: e.message }))`);
  console.log('\n[paso 2b] known-issues JSON →', ki.status);

  // ── PASO 2c: historial de submissions del usuario (duplicados propios) ─────
  const subs = await leer(canal, `fetch('/api-v2/engagements?query=openai', {credentials:'same-origin'})
    .then(r => ({ status: r.status, body: null }))
    .catch(e => ({ status: 0, error: e.message }))`);
  console.log('[paso 2c] API v2 accesible desde el panel:', subs.status, '(solo sondabilidad; el historial se revisa en la UI)');

  const resumen = { ts: new Date().toISOString(), estado, targets, knownIssues: ki, sondas: subs };
  fs.writeFileSync(OUT_JSON, JSON.stringify(resumen, null, 2));
  fs.writeFileSync(OUT_TXT, [
    `# Panel Bugcrowd (OpenAI) — ${resumen.ts}`,
    `Login: ${estado.logueado}`,
    '',
    '== SCOPE (fragmento targets) ==',
    targets.seccionScope || '(no visible)',
    '',
    '== HOSTS DEL E13 ==',
    ...Object.entries(targets).filter(([k]) => k !== 'seccionScope').map(([k, v]) => `${k}: ${v ? 'VISTO' : 'no aparece en la página'}`),
    '',
    '== KNOWN ISSUES (primeros 4 KB) ==',
    ki.body || '(vacío)',
  ].join('\n'));
  console.log('\n✅ Evidencia guardada en', OUT_JSON);
  canal.cerrar();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
