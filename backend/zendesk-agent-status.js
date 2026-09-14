'use strict';
// zendesk-agent-status.js — Full status: copilot response + generador + API check
const WebSocket = require('ws');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fs = require('fs');
const path = require('path');
const https = require('https');
const WS_URL = 'ws://127.0.0.1:9344/session';
const INSTANCE = 'https://autonomo-49965.zendesk.com';
const OUT = path.join(__dirname, '..', 'evidencia-poc', 'http');

function httpsGet(url, cookies) {
  return new Promise((resolve) => {
    const opts = { headers: { Cookie: cookies || '' } };
    https.get(url, opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', e => resolve({ status: 0, body: e.message }));
  });
}

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

    // Get cookies for API calls
    await cmd('browsingContext.navigate', { context: ctx, url: INSTANCE + '/admin', wait: 'complete' });
    await sleep(4000);
    const cookies = await eval_(ctx, 'document.cookie');
    const cookieStr = cookies.result?.result?.value || '';
    console.log('Cookies:', cookieStr.slice(0, 100) + '...');
    
    // 1. Try API endpoints for agents
    console.log('\n=== API CHECK ===');
    const endpoints = [
      '/api/v2/ai_agents',
      '/api/v2/ai/custom_agents', 
      '/api/v2/bots',
      '/api/v2/automations',
      '/api/v2/triggers'
    ];
    for (const ep of endpoints) {
      const r = await httpsGet(INSTANCE + ep, cookieStr);
      console.log(`${ep}: ${r.status} ${r.body.slice(0, 100)}`);
    }
    
    // 2. Navigate to Generador and read full page
    console.log('\n=== GENERADOR ===');
    await cmd('browsingContext.navigate', { context: ctx, url: INSTANCE + '/admin/ai/agent-builder', wait: 'complete' });
    await sleep(10000);
    
    // Get the full page HTML to understand structure
    const html = await eval_(ctx, 'document.documentElement.outerHTML.slice(0, 8000)');
    const htmlText = html.result?.result?.value || '';
    
    // Look for agent-related content in HTML
    const agentMatches = htmlText.match(/agent|bot|botbuilder|flow|conversation/gi);
    console.log('Agent-related words in HTML:', agentMatches?.length || 0);
    
    // Check for any data attributes or React state
    const state = await eval_(ctx, `
      (function() {
        // Check for __NEXT_DATA__ or similar
        const nd = document.getElementById('__NEXT_DATA__');
        if (nd) return 'NEXT_DATA: ' + nd.textContent.slice(0, 500);
        // Check window state
        const keys = Object.keys(window).filter(k => /agent|bot|zendesk|zaf/i.test(k));
        return 'Window keys: ' + keys.join(', ');
      })()
    `);
    console.log('State:', state.result?.result?.value);
    
    // 3. Get full body text again with longer wait
    const fullText = await eval_(ctx, 'document.body?.innerText');
    const text = fullText.result?.result?.value || '';
    
    // Look for any mention of existing agents
    const agentLines = text.split('\n').filter(l => /agent|bot|activo|active|created|creado/i.test(l));
    console.log('\nAgent-related lines:', agentLines.length);
    agentLines.forEach(l => console.log('  >', l.slice(0, 100)));
    
    // Screenshot
    const shot = await cmd('browsingContext.captureScreenshot', { context: ctx });
    if (shot.result?.data) {
      fs.writeFileSync(path.join(OUT, 'zendesk-agent-status.png'), Buffer.from(shot.result.data, 'base64'));
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
