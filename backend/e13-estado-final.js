'use strict';
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
async function main() {
  const ws = new WebSocket('ws://127.0.0.1:9344/session', { maxPayload: 50*1024*1024 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', d => { const j = JSON.parse(d); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } });
  const cmd = (m, p = {}) => new Promise((r, j2) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); j2(new Error('timeout ' + m)); } }, 45000); });
  let sid = null;
  try {
    const ses = await cmd('session.new', { capabilities: { alwaysMatch: {} } });
    sid = ses.result.sessionId;
    const tree = await cmd('browsingContext.getTree', { maxDepth: 1 });
    const ctxInfo = tree.result.contexts.find(c => (c.url || '').includes('bugcrowd'));
    const ctx = ctxInfo.context;
    const r = await cmd('script.evaluate', {
      expression: `JSON.stringify((() => {
        const page = document.body.innerText;
        const desc = document.querySelector('textarea[name="submission[description]"]');
        const titulo = document.querySelector('input[name="submission[caption]"]');
        const adjuntosEsperados = {
          'sas-upload-raw-CLEAN.txt': page.includes('sas-upload-raw-CLEAN.txt'),
          'sas-round3-contenido.txt': page.includes('sas-round3-contenido.txt'),
          'sas-ip-binding-analisis.txt': page.includes('sas-ip-binding-analisis.txt'),
          'e13-descarga-B.png': page.includes('e13-descarga-B.png'),
        };
        return {
          titulo: titulo ? titulo.value.slice(0, 80) + '… (len ' + titulo.value.length + ')' : null,
          descLen: desc ? desc.value.length : 0,
          descIncluyeRepro: desc ? desc.value.includes('Steps to reproduce') : false,
          descIncluyePayload: desc ? desc.value.includes('upload_reservations') : false,
          descIncluyeEscalacion: desc ? desc.value.includes('account takeover') || desc.value.includes('escalat') : false,
          adjuntosEsperados,
          hostnameInternoEnPagina: /sediment|cluster\.local/i.test(page),
          vrtBrokenAccessControl: page.includes('Broken Access Control') || page.includes('broken_access_control'),
          warningVRT: /weak login|informational/i.test(page),
          botones: [...document.querySelectorAll('button, input[type=submit]')].map(b => (b.innerText || b.value || '').trim()).filter(t => /report|preview/i.test(t)).slice(0, 5)
        };
      })())`,
      target: { context: ctx }, awaitPromise: true, resultOwnership: 'none',
    });
    console.log(r.result.result.value);
    const shot = await cmd('browsingContext.captureScreenshot', { context: ctx });
    const f = path.resolve('evidencia-poc/pantallas/e13-form-final-completo.png');
    fs.writeFileSync(f, Buffer.from(shot.result.data, 'base64'));
    console.log('SCREENSHOT:', f, fs.statSync(f).size, 'bytes');
  } finally {
    if (sid) { try { await cmd('session.end', {}); } catch (e) {} }
    ws.close();
  }
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
