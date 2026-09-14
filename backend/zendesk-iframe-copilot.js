'use strict';
// zendesk-iframe-copilot.js — Check the main content iframe + ask copilot about agents
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

    // Go to agent builder
    await cmd('browsingContext.navigate', { context: ctx, url: INSTANCE + '/admin/ai/agent-builder', wait: 'complete' });
    await sleep(10000);

    // Get the tree with iframes
    const tree = (await cmd('browsingContext.getTree', { maxDepth: 3 })).result.contexts;
    console.log('=== TREE ===');
    for (const t of tree) {
      console.log(`  ${t.type} ${t.url?.slice(0, 80)} (${t.context?.slice(0, 20)})`);
    }

    // Find iframe contexts
    const iframes = tree.filter(t => t.type === 'iframe');
    console.log(`\n=== ${iframes.length} IFRAMES ===`);
    
    for (const iframe of iframes) {
      const ictx = iframe.context || iframe.browsingContext;
      console.log(`\n--- Iframe: ${iframe.url?.slice(0, 100)} (${ictx?.slice(0, 20)}) ---`);
      try {
        const content = await eval_(ictx, 'document.body?.innerText?.slice(0, 1500)');
        console.log(content.result?.result?.value?.slice(0, 800) || 'EMPTY');
      } catch (e) {
        console.log('Cannot read:', e.message);
      }
    }

    // 2. Try asking the copilot about agents
    console.log('\n=== ASKING COPILOT ===');
    // Find the textarea/input for copilot
    const inputInfo = await eval_(ctx, `
      (function() {
        const inputs = Array.from(document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]'));
        return JSON.stringify(inputs.map(i => ({
          tag: i.tagName,
          placeholder: (i.placeholder || '').slice(0, 50),
          id: i.id,
          class: (i.className || '').slice(0, 50),
          visible: i.offsetWidth > 0
        })));
      })()
    `);
    console.log('Inputs:', inputInfo.result?.result?.value);

    // Try typing in the copilot chat
    const typed = await eval_(ctx, `
      (function() {
        const ta = document.querySelector('textarea');
        if (ta) {
          // Set value via React-compatible method
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          nativeInputValueSetter.call(ta, 'How do I create a custom AI agent for my Zendesk instance?');
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          return 'typed in textarea';
        }
        // Try contenteditable
        const ce = document.querySelector('[contenteditable="true"]');
        if (ce) {
          ce.innerText = 'How do I create a custom AI agent for my Zendesk instance?';
          ce.dispatchEvent(new Event('input', { bubbles: true }));
          return 'typed in contenteditable';
        }
        return 'no input found';
      })()
    `);
    console.log('Typing:', typed.result?.result?.value);
    
    await sleep(2000);
    
    // Click send button
    const sent = await eval_(ctx, `
      (function() {
        const btns = Array.from(document.querySelectorAll('button'));
        const send = btns.find(b => /send|enviar|submit/i.test(b.innerText + ' ' + b.getAttribute('aria-label')));
        if (send) { send.click(); return 'sent: ' + send.innerText.trim(); }
        // Try the area near the textarea
        const ta = document.querySelector('textarea');
        if (ta && ta.parentElement) {
          const nearbyBtn = ta.parentElement.querySelector('button');
          if (nearbyBtn) { nearbyBtn.click(); return 'clicked nearby btn'; }
        }
        return 'no send button';
      })()
    `);
    console.log('Send:', sent.result?.result?.value);
    
    await sleep(8000);
    
    // Read copilot response
    const response = await eval_(ctx, 'document.body?.innerText?.slice(0, 4000)');
    const respText = response.result?.result?.value || '';
    // Extract the last part (likely the response)
    const lines = respText.split('\n').filter(Boolean);
    console.log('\n=== PAGE TEXT (last 30 lines) ===');
    console.log(lines.slice(-30).join('\n'));
    
    // Screenshot
    const shot = await cmd('browsingContext.captureScreenshot', { context: ctx });
    if (shot.result?.data) {
      fs.writeFileSync(path.join(OUT, 'zendesk-copilot-response.png'), Buffer.from(shot.result.data, 'base64'));
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
