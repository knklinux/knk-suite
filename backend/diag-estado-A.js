'use strict';
const { abrirCanal, rutaPerfil } = require('./lib/browser');
const fs = require('fs');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function main() {
  const canal = await abrirCanal({ port: 9336, perfil: rutaPerfil('openai-cuenta-a'), headed: true, url: 'https://chatgpt.com/' });
  await sleep(6000);
  const expr = [
    '(() => {',
    '  const t = document.body.innerText.slice(0, 800);',
    '  return JSON.stringify({',
    '    url: location.href.slice(0, 140),',
    '    titulo: document.title.slice(0, 80),',
    '    challenge: (/just a moment|attention required|verify/i.test(document.title)) || !!document.querySelector("#challenge-form, .cf-turnstile"),',
    '    avisos: (t.match(/unusual activity|security|suspend|locked|verify your|logged out|session expired/gi) || []).slice(0,5),',
    '    loginVisible: /log in|sign up|welcome back/i.test(t),',
    '    primerTexto: t.slice(0, 300)',
    '  });',
    '})()'
  ].join('\n');
  const r = await canal.send('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.log('ESTADO:', typeof r.result === 'object' ? r.result.value : JSON.stringify(r.result).slice(0, 600));
  const shot = await canal.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('evidencia-poc/pantallas/estado-A-antes-relogin.png', Buffer.from(shot.data, 'base64'));
  console.log('SCREENSHOT: evidencia-poc/pantallas/estado-A-antes-relogin.png');
  process.exit(0);
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
