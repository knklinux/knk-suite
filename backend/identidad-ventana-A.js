'use strict';
// identidad-ventana-A.js — ¿Qué cuenta está logueada AHORA en la ventana del perfil de A?
const { abrirCanal, rutaPerfil } = require('./lib/browser');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function main() {
  const canal = await abrirCanal({ port: 9336, perfil: rutaPerfil('openai-cuenta-a'), headed: true, url: 'https://chatgpt.com/' });
  await sleep(3000);
  const expr = "fetch('/api/auth/session', {headers:{'Accept':'application/json'}}).then(r=>r.json()).then(j=>JSON.stringify({id:j.user&&j.user.id, email:j.user&&j.user.email, plan:j.user&&j.user.name?j.accounts:null, exp:j.expires, tieneToken:!!j.accessToken}))";
  const r = await canal.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  console.log('SESION EN VENTANA:', r.result.value);
  process.exit(0);
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
