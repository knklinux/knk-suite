'use strict';
// tools/cdp-eval.js — cliente CDP mínimo para probar la app Electron real.
// Uso:
//   node tools/cdp-eval.js "<url-substr>" "<expr>"           → evalúa JS (con awaitPromise)
//   node tools/cdp-eval.js "<url-substr>" --key ctrl+k       → teclas reales (ctrl|alt|shift+tecla)
//   node tools/cdp-eval.js "<url-substr>" --type "texto"     → teclea texto (Input.insertText)
// El objetivo se elige por subcadena de URL ("8086" = ventana principal, "assistant" = flotante).
const http = require('http');
const WebSocket = require('ws');

const urlSub = process.argv[2] || '8086';
const action = process.argv[3] || '';
const payload = process.argv[4] || '';

function pickTarget() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9223/json/list', r => {
      let d = '';
      r.on('data', c => (d += c));
      r.on('end', () => {
        const list = JSON.parse(d).filter(t => t.type === 'page');
        const wantAssistant = urlSub === 'main' ? false : urlSub.includes('assistant');
        const t = list.find(t => (t.url || '').includes('#assistant') === wantAssistant); if (!t) throw new Error('sin target: ' + urlSub);
        t ? resolve(t) : reject(new Error('sin target: ' + urlSub + ' — hay: ' + list.map(x => x.url).join(', ')));
      });
    }).on('error', reject);
  });
}

const MOD = { ctrl: 2, alt: 1, shift: 8, meta: 4 };
const VK = { k: 75, w: 87, escape: 27, enter: 13 };

(async () => {
  const target = await pickTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0;
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    const to = setTimeout(() => rej(new Error('timeout ' + method)), 20000);
    ws.on('message', function h(m) {
      const msg = JSON.parse(m);
      if (msg.id === mid) { clearTimeout(to); ws.off('message', h); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); }
    });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  try {
    if (action === '--key') {
      // "ctrl+k", "escape", "enter", "ctrl+alt+k"
      const parts = payload.split('+');
      const key = parts.pop();
      const modifiers = parts.reduce((a, p) => a | (MOD[p] || 0), 0);
      const vk = VK[key.toLowerCase()] || key.toUpperCase().charCodeAt(0);
      const base = { modifiers, key: key.length === 1 ? key.toLowerCase() : key, code: 'Key' + key.toUpperCase(), windowsVirtualKeyCode: vk };
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      console.log(JSON.stringify({ sent: payload }));
    } else if (action === '--type') {
      await send('Input.insertText', { text: payload });
      console.log(JSON.stringify({ typed: payload }));
    } else {
      const expr = action === '--expr' ? payload : action;
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      console.log(JSON.stringify(r.result && 'value' in r.result ? r.result.value : r.result, null, 1));
    }
  } finally { ws.close(); }
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
