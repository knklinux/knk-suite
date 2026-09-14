'use strict';
// extrae-known-issues.js — Extrae los títulos de Known Issues del programa openai vía BiDi
//   node backend/extrae-known-issues.js
// Salida: evidencia-poc/http/known-issues-openai.json (+ .txt legible)
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const OUT_JSON = path.join(__dirname, '..', 'evidencia-poc', 'http', 'known-issues-openai.json');
const OUT_TXT = path.join(__dirname, '..', 'evidencia-poc', 'http', 'known-issues-openai.txt');

async function main() {
  const ws = new WebSocket('ws://127.0.0.1:9344/session', { maxPayload: 50 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', d => { const j = JSON.parse(d); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } });
  const cmd = (m, p = {}) => new Promise((r, j2) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); j2(new Error('timeout ' + m)); } }, 45000); });
  let sid = null;
  try {
    const ses = await cmd('session.new', { capabilities: { alwaysMatch: { "moz:firefoxOptions": { "args": [] } }, strict: false } });
    sid = ses.result.sessionId;
    const tree = await cmd('browsingContext.getTree', { maxDepth: 1 });
    const ctxInfo = tree.result.contexts.find(c => (c.url || '').includes('bugcrowd'));
    if (!ctxInfo) { console.log('SIN-TAB-BUGCROWD:', JSON.stringify(tree.result.contexts.map(c => c.url).slice(0, 4))); process.exit(2); }
    const ctx = ctxInfo.context;
    console.log('URL:', ctxInfo.url.slice(0, 110));

    // 1) leer la sección known issues tal como está (primeros elementos)
    const leer = "(() => { const t = document.body.innerText; const contadores = [...t.matchAll(/(\\d+)\\s*(unique\\s*)?(known issues|submissions)/gi)].map(m => m[0]); const botones = [...document.querySelectorAll('a,button')].map(e => ({ t: e.innerText.trim(), h: e.getAttribute('href') })).filter(x => /view all|see all|show all|view more|full list/i.test(x.t)); const linksDisc = [...document.querySelectorAll('a')].map(a => ({ t: (a.innerText || '').trim().slice(0, 140), h: a.getAttribute('href') })).filter(x => x.h && x.h.includes('/disclosures/')); return JSON.stringify({ url: location.href.slice(0, 120), logueado: /knk_Linux/.test(t), contadores, botones, nDisc: linksDisc.length, disc: linksDisc.slice(0, 200) }); })()";
    const r1 = await cmd('script.evaluate', { expression: leer, target: { context: ctx }, awaitPromise: true, resultOwnership: 'none' });
    const v1 = JSON.parse(r1.result.result.value);
    console.log('logueado:', v1.logueado, '| contadores:', JSON.stringify(v1.contadores), '| links disclosures:', v1.nDisc, '| botones:', JSON.stringify(v1.botones.map(b => b.t)));

    let disc = v1.disc;
    // 2) si hay botón "view all", navegarlo y re-extraer
    if (v1.nDisc < 60 && v1.botones.length) {
      const b = v1.botones[0];
      const urlAbs = b.h && b.h.startsWith('http') ? b.h : (b.h ? 'https://bugcrowd.com' + b.h : null);
      if (urlAbs) {
        console.log('Abriendo vista completa:', urlAbs);
        await cmd('browsingContext.navigate', { context: ctx, url: urlAbs, wait: 'complete' });
        await new Promise(rr => setTimeout(rr, 8000));
        const leer2 = "(() => { const links = [...document.querySelectorAll('a')].map(a => ({ t: (a.innerText || '').trim().slice(0, 140), h: a.getAttribute('href') })).filter(x => x.h && x.h.includes('/disclosures/')); return JSON.stringify({ url: location.href.slice(0, 120), n: links.length, disc: links.slice(0, 300) }); })()";
        const r2 = await cmd('script.evaluate', { expression: leer2, target: { context: ctx }, awaitPromise: true, resultOwnership: 'none' });
        const v2 = JSON.parse(r2.result.result.value);
        console.log('Vista completa:', v2.url, '→', v2.n, 'títulos');
        if (v2.n > disc.length) disc = v2.disc;
      }
    }

    // 3) dedup y guardado
    const unicos = [];
    const vistos = new Set();
    for (const d of disc) {
      const key = d.h.split('/disclosures/')[1];
      if (key && !vistos.has(key)) { vistos.add(key); unicos.push(d); }
    }
    fs.writeFileSync(OUT_JSON, JSON.stringify({ extraido: new Date().toISOString(), url: v1.url, total: unicos.length, titulos: unicos }, null, 1));
    const txt = unicos.map((d, i) => `${i + 1}. ${d.t}\n   https://bugcrowd.com${d.h.startsWith('/') ? d.h : ''}`).join('\n');
    fs.writeFileSync(OUT_TXT, txt);
    console.log(`GUARDADO: ${unicos.length} títulos únicos → ${OUT_JSON} y .txt`);
  } finally {
    if (sid) { try { await cmd('session.end', {}); } catch (e) {} }
    ws.close();
  }
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
