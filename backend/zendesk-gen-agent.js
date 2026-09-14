'use strict';
// zendesk-gen-agent.js — Check Generador de agentes + iframes
const WebSocket = require('ws');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fs = require('fs');
const path = require('path');
const WS_URL = 'ws://127.0.0.1:9344/session';
const INSTANCE = 'https://autonomo-49965.zendesk.com';
const OUT = path.join(__dirname, '..', 'evidencia-poc', 'http');

async function main() {
  const ws = new WebSocket(WS_URL, { maxPayload: 50 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', d => { const j = JSON.parse(d.toString()); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } });
  const cmd = (m, p={}) => new Promise((r, j) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({id:i,method:m,params:p})); setTimeout(() => { if(pend.has(i)) { pend.delete(i); j(new Error('timeout '+m)); } }, 25000); });
  const eval_ = (ctx, expr) => cmd('script.evaluate', { expression: expr, target: { context: ctx }, awaitPromise: false });
  
  try {
    const sess = await cmd('session.new', { capabilities: { alwaysMatch: {} } });
    if (!sess.result?.sessionId) throw new Error('No session');
    console.log('✅ Session');
    await cmd('session.subscribe', { events: ['browsingContext.load'] });
    const ctx = (await cmd('browsingContext.getTree', { maxDepth: 1 })).result.contexts[0].context;

    // 1. Navigate to Generador de agentes
    await cmd('browsingContext.navigate', { context: ctx, url: INSTANCE + '/admin/ai/agent-builder', wait: 'complete' });
    await sleep(10000);
    
    // Click "Generador de agentes" in sidebar
    await eval_(ctx, `
      (function() {
        const btns = Array.from(document.querySelectorAll('button, a, [role="button"]'));
        const gen = btns.find(b => /generador/i.test(b.innerText));
        if (gen) { gen.click(); return 'clicked: ' + gen.innerText.trim(); }
        return 'not found';
      })()
    `);
    await sleep(8000);
    
    // Read full page text
    const body = await eval_(ctx, 'document.body?.innerText?.slice(0, 5000)');
    console.log('\n=== GENERADOR PAGE ===');
    console.log((body.result?.result?.value || '').slice(0, 3000));
    
    // Check iframes
    const iframeInfo = await eval_(ctx, `
      JSON.stringify(Array.from(document.querySelectorAll('iframe')).map((f, i) => ({
        idx: i,
        src: (f.src || '').slice(0, 150),
        id: f.id,
        name: f.name,
        visible: f.offsetWidth > 0 && f.offsetHeight > 0,
        size: f.offsetWidth + 'x' + f.offsetHeight
      })))
    `);
    console.log('\n=== IFRAMES ===');
    console.log(iframeInfo.result?.result?.value);
    
    // Also check for any hidden content via Shadow DOM or lazy loading
    const shadowCheck = await eval_(ctx, `
      JSON.stringify({
        customElements: document.querySelectorAll('[is], [data-component]').length,
        shadowRoots: Array.from(document.querySelectorAll('*')).filter(e => e.shadowRoot).length,
        reactRoots: document.querySelectorAll('[data-reactroot], #__next, #root').length,
        zendeskApps: document.querySelectorAll('[data-zendesk-app], [class*="zaf-"]').length
      })
    `);
    console.log('\n=== FRAMEWORK CHECK ===');
    console.log(shadowCheck.result?.result?.value);
    
    // 2. Try the direct URL for copilot/agent setup
    await cmd('browsingContext.navigate', { context: ctx, url: INSTANCE + '/admin/ai/copilot', wait: 'complete' });
    await sleep(8000);
    const copilotBody = await eval_(ctx, 'document.body?.innerText?.slice(0, 3000)');
    console.log('\n=== COPILOT PAGE ===');
    console.log((copilotBody.result?.result?.value || '').slice(0, 2000));
    
    // Screenshot
    const shot = await cmd('browsingContext.captureScreenshot', { context: ctx });
    if (shot.result?.data) {
      fs.writeFileSync(path.join(OUT, 'zendesk-gen-agent.png'), Buffer.from(shot.result.data, 'base64'));
      console.log('\n📸 Screenshot saved');
    }
    
  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    try { await cmd('session.end', {}); } catch(_) {}
    ws.close();
  }
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
