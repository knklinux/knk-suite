'use strict';
// zendesk-copilot-wait.js — Wait for copilot response
const WebSocket = require('ws');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fs = require('fs');
const path = require('path');
const WS_URL = 'ws://127.0.0.1:9344/session';
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

    // Go to agent builder
    await cmd('browsingContext.navigate', { context: ctx, url: 'https://autonomo-49965.zendesk.com/admin/ai/agent-builder', wait: 'complete' });
    await sleep(8000);

    // Type question in copilot
    await eval_(ctx, `
      (function() {
        const ta = document.querySelector('textarea');
        if (!ta) return 'no textarea';
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        nativeInputValueSetter.call(ta, 'Show me the custom agents list. How many agents do I have?');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return 'typed';
      })()
    `);
    await sleep(1000);
    
    // Click send
    await eval_(ctx, `
      (function() {
        const btns = Array.from(document.querySelectorAll('button'));
        const send = btns.find(b => !b.innerText.trim() && b.closest('[class*="chat"], [class*="message"]'));
        if (send) { send.click(); return 'clicked'; }
        // Try pressing Enter
        const ta = document.querySelector('textarea');
        if (ta) { ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })); return 'enter pressed'; }
        return 'no send';
      })()
    `);
    
    // Wait for response
    console.log('Waiting for copilot response...');
    let lastText = '';
    for (let i = 0; i < 15; i++) {
      await sleep(2000);
      const text = await eval_(ctx, 'document.body?.innerText');
      const full = text.result?.result?.value || '';
      // Check if "Trabajando" is gone (response arrived)
      if (!full.includes('Trabajando en eso') && full.length > lastText.length) {
        // Extract the response
        const lines = full.split('\n').filter(Boolean);
        const responseStart = lines.findIndex(l => /custom agents|agentes personalizados/i.test(l));
        if (responseStart >= 0) {
          console.log('\n=== COPILOT RESPONSE ===');
          console.log(lines.slice(responseStart, responseStart + 20).join('\n'));
        } else {
          console.log('\n=== LAST 15 LINES ===');
          console.log(lines.slice(-15).join('\n'));
        }
        break;
      }
      lastText = full;
      if (i === 14) console.log('Still processing after 30s...');
    }
    
    // Screenshot
    const shot = await cmd('browsingContext.captureScreenshot', { context: ctx });
    if (shot.result?.data) {
      fs.writeFileSync(path.join(OUT, 'zendesk-copilot-final.png'), Buffer.from(shot.result.data, 'base64'));
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
