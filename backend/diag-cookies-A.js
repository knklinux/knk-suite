'use strict';
// diag-cookies-A.js — Diagnóstico rápido: qué cookies de sesión hay en el perfil de A
const { abrirCanal, rutaPerfil } = require('./lib/browser');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function main() {
  const canal = await abrirCanal({ port: 9336, perfil: rutaPerfil('openai-cuenta-a'), headed: true, url: 'https://chatgpt.com/api/auth/session' });
  await sleep(6000);
  const r = await canal.send('Runtime.evaluate', { expression: 'document.body.innerText.slice(0,400)', returnByValue: true });
  console.log("CUERPO:", JSON.stringify(r.result).slice(0,300));
  const c = await canal.send('Network.getCookies', { urls: ['https://chatgpt.com/'] }).catch(e => ({ error: e.message }));
  if (c.cookies) {
    const ses = c.cookies.filter(x => /session|auth/i.test(x.name));
    console.log('COOKIES DE SESIÓN:', JSON.stringify(ses.map(x => ({ n: x.name, d: x.domain, len: (x.value||'').length })), null, 1));
  } else console.log('ERR cookies:', c.error);
  process.exit(0);
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
