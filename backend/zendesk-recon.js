'use strict';
// zendesk-recon.js — Recon PASIVO del programa Zendesk en Bugcrowd vía CDP (canal 9340)
//   node backend/zendesk-recon.js
// Requisitos: navegador CDP abierto en 9340 (perfil zendesk-recon) y el
// usuario logueado en Bugcrowd en esa ventana. Solo LECTURA del panel:
// engagement (targets/scope) → known issues → mis submissions.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { abrirCanal, navegar } = require('./lib/browser');

const SALIDA = path.join(__dirname, '..', 'evidencia-poc', 'http', 'zendesk-recon-panel.json');
const PANTALLAS = path.join(__dirname, '..', 'evidencia-poc', 'pantallas');

(async () => {
  const informe = { ts: new Date().toISOString(), pasos: [] };
  const canal = await abrirCanal({
    port: 9340,
    perfil: path.join(os.homedir(), '.knk-suite', 'browser-profile', 'zendesk-recon'),
    url: 'https://bugcrowd.com/dashboard',
  });
  const ev = async (expr) => {
    const r = await canal.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result.value;
  };
  const shot = async (nombre) => {
    try {
      const r = await canal.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(PANTALLAS, nombre), Buffer.from(r.data, 'base64'));
    } catch {}
  };
  const nav = async (url) => { await navegar(canal.send.bind(canal), url); await new Promise((r) => setTimeout(r, 4000)); };

  // ── 1) Sesión ──
  await nav('https://bugcrowd.com/dashboard');
  const sesion = await ev(`(() => { const t = document.body.innerText; return {
    url: location.href.slice(0,120),
    usuario: (t.match(/knk_[A-Za-z0-9_]+/) || [null])[0],
    loginBtn: t.includes('Hacker Login') || t.includes('Sign in')
  }; })()`);
  informe.pasos.push({ paso: '1-sesion', sesion });
  await shot('zendesk-recon-1-sesion.png');
  if (!sesion || !sesion.usuario || sesion.loginBtn) {
    informe.veredicto = 'SIN SESION — logueate en la ventana CDP 9340 (perfil zendesk-recon) y relanza';
    fs.writeFileSync(SALIDA, JSON.stringify(informe, null, 2));
    console.log(informe.veredicto);
    return process.exit(2);
  }

  // ── 2) Engagement: targets, scope, recompensas ──
  await nav('https://bugcrowd.com/engagements/zendesk');
  const eng = await ev(`(() => {
    const t = document.body.innerText;
    const iAI = t.search(/Zendesk AI/i);
    return {
      titulo: document.title.slice(0,100),
      tieneAI: iAI >= 0,
      contextoAI: iAI >= 0 ? t.slice(Math.max(0, iAI-200), iAI+400) : null,
      knownIssuesSeccion: /known issues/i.test(t),
      extracto: t.slice(0, 9000)
    };
  })()`);
  informe.pasos.push({ paso: '2-engagement', ...eng });
  await shot('zendesk-recon-2-engagement.png');

  // ── 3) Known issues (anti-duplicados) ──
  await nav('https://bugcrowd.com/engagements/zendesk/known_issues');
  const ki = await ev(`(() => {
    const t = document.body.innerText;
    return { url: location.href.slice(0,140), filas: t.slice(0, 12000) };
  })()`);
  informe.pasos.push({ paso: '3-known-issues', ...ki });
  await shot('zendesk-recon-3-known-issues.png');

  // ── 4) Mis submissions (¿ya tengo algo en Zendesk?) ──
  await nav('https://bugcrowd.com/submissions?filter_by=all');
  const subs = await ev(`(() => ({ tieneZendesk: /zendesk/i.test(document.body.innerText) }))()`);
  informe.pasos.push({ paso: '4-submissions-propias', ...subs });

  informe.veredicto = 'RECON PASIVO COMPLETADO';
  fs.writeFileSync(SALIDA, JSON.stringify(informe, null, 2));
  console.log(informe.veredicto);
  console.log('JSON: ' + SALIDA);
  console.log('logueado como: ' + sesion.usuario);
  console.log('Zendesk AI en engagement: ' + eng.tieneAI);
  console.log('known_issues URL respondió: ' + (ki.url || 'n/a'));
  process.exit(0);
})().catch((e) => { console.error('ERROR: ' + e.message); process.exit(1); });
