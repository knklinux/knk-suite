'use strict';
// zendesk-find-agent.js — Find and list all AI agents in the admin
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
    console.log('✅ Session:', sess.result.sessionId.slice(0, 30));
    await cmd('session.subscribe', { events: ['browsingContext.load'] });
    const tree0 = (await cmd('browsingContext.getTree', { maxDepth: 1 })).result.contexts;
    const ctx = tree0[0].context;

    // 1. Go to AI section
    await cmd('browsingContext.navigate', { context: ctx, url: INSTANCE + '/admin/ai/agent-builder', wait: 'complete' });
    await sleep(6000);
    
    // Read full page
    const body = await eval_(ctx, 'document.body?.innerText?.slice(0, 5000)');
    const text = body.result?.result?.value || '';
    console.log('=== AI PAGE (first 2000 chars) ===');
    console.log(text.slice(0, 2000));
    
    // Find all links with 'agent' or 'custom' in them
    const links = await eval_(ctx, `JSON.stringify(Array.from(document.querySelectorAll('a')).filter(a => /agent|custom|crear|create/i.test(a.href + ' ' + a.innerText)).map(a => ({text: a.innerText.trim().slice(0,60), href: a.href.slice(0,120)})))`);
    console.log('\n=== AGENT LINKS ===');
    console.log(links.result?.result?.value);
    
    // Click on "Agentes personalizados" if it exists
    const clicked = await eval_(ctx, `
      (function() {
        const links = Array.from(document.querySelectorAll('a'));
        const target = links.find(a => /personalizados|custom/i.test(a.innerText));
        if (target) { target.click(); return 'clicked: ' + target.innerText.trim(); }
        return 'not found';
      })()
    `);
    console.log('\n=== CLICK RESULT ===');
    console.log(clicked.result?.result?.value);
    
    await sleep(5000);
    
    // Read after click
    const body2 = await eval_(ctx, 'window.location.href + \" ||| \" + document.body?.innerText?.slice(0, 3000)');
    console.log('\n=== AFTER CLICK ===');
    console.log((body2.result?.result?.value || '').slice(0, 2000));
    
    // Screenshot
    const shot = await cmd('browsingContext.captureScreenshot', { context: ctx });
    if (shot.result?.data) {
      fs.writeFileSync(path.join(OUT, 'zendesk-agents-page.png'), Buffer.from(shot.result.data, 'base64'));
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
