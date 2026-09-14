'use strict';
// zendesk-agent-deep.js — Deep scan of AI agents page, wait for SPA load
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

    // Go to custom agents page
    await cmd('browsingContext.navigate', { context: ctx, url: INSTANCE + '/admin/ai/agent-builder/custom-agents', wait: 'complete' });
    
    // Wait much longer for SPA to load
    console.log('Waiting 12s for SPA...');
    await sleep(12000);
    
    // Check full DOM structure
    const domInfo = await eval_(ctx, `
      JSON.stringify({
        url: window.location.href,
        title: document.title,
        mainContent: document.querySelector('[role="main"]')?.innerText?.slice(0, 2000) || 'no main',
        allText: document.body?.innerText?.length,
        iframes: document.querySelectorAll('iframe').length,
        tables: document.querySelectorAll('table').length,
        cards: document.querySelectorAll('[class*="card"], [class*="agent"], [class*="list"]').length,
        buttons: Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim().slice(0,40)).filter(Boolean),
        h1h3: Array.from(document.querySelectorAll('h1,h2,h3')).map(h => h.innerText.trim().slice(0,60))
      })
    `);
    const info = JSON.parse(domInfo.result?.result?.value || '{}');
    console.log('\n=== DOM INFO ===');
    console.log('URL:', info.url);
    console.log('Main content:', info.mainContent?.slice(0, 500));
    console.log('Iframes:', info.iframes, 'Tables:', info.tables, 'Cards:', info.cards);
    console.log('Buttons:', JSON.stringify(info.buttons));
    console.log('Headings:', JSON.stringify(info.h1h3));
    
    // Also try navigating to agent builder root
    await cmd('browsingContext.navigate', { context: ctx, url: INSTANCE + '/admin/ai/agent-builder', wait: 'complete' });
    await sleep(10000);
    
    const domInfo2 = await eval_(ctx, `
      JSON.stringify({
        url: window.location.href,
        mainContent: document.querySelector('[role="main"]')?.innerText?.slice(0, 2000) || 'no main',
        buttons: Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim().slice(0,40)).filter(Boolean),
        h1h3: Array.from(document.querySelectorAll('h1,h2,h3')).map(h => h.innerText.trim().slice(0,60))
      })
    `);
    const info2 = JSON.parse(domInfo2.result?.result?.value || '{}');
    console.log('\n=== AGENT BUILDER ROOT ===');
    console.log('URL:', info2.url);
    console.log('Main:', info2.mainContent?.slice(0, 500));
    console.log('Buttons:', JSON.stringify(info2.buttons));
    console.log('Headings:', JSON.stringify(info2.h1h3));
    
    // Screenshot
    const shot = await cmd('browsingContext.captureScreenshot', { context: ctx });
    if (shot.result?.data) {
      fs.writeFileSync(path.join(OUT, 'zendesk-agent-deep.png'), Buffer.from(shot.result.data, 'base64'));
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
