'use strict';
// zendesk-ai-agents-workspace.js — Navigate to AI agents workspace for messaging
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

    // Try various URLs for AI agent management
    const urls = [
      '/admin/ai/ai-agents',
      '/admin/ai/ai-agents/ai-agents',
      '/admin/ai/agents',
      '/admin/ai/messaging/agents',
      '/admin/channels/messaging_and_social/messaging/ai-agents',
      '/admin/ai/agent-builder/ai-agents'
    ];
    
    for (const url of urls) {
      const full = INSTANCE + url;
      await cmd('browsingContext.navigate', { context: ctx, url: full, wait: 'complete' });
      await sleep(5000);
      const currentUrl = await eval_(ctx, 'window.location.href');
      const bodySnippet = await eval_(ctx, 'document.body?.innerText?.slice(0, 500)');
      const cu = currentUrl.result?.result?.value || '';
      const bt = bodySnippet.result?.result?.value || '';
      const redirect = cu !== full;
      const hasAgentContent = /create|crear|agent|bot|ai/i.test(bt) && !/Centro de administración.*Agentes IA.*Agentes IA/.test(bt);
      console.log(`${redirect ? '↩️ REDIRECT' : '✅ STAY'} ${url}`);
      console.log(`  → ${cu.slice(0, 80)}`);
      if (hasAgentContent) {
        console.log(`  HAS CONTENT: ${bt.slice(0, 300)}`);
        // Found it!
        const shot = await cmd('browsingContext.captureScreenshot', { context: ctx });
        if (shot.result?.data) {
          fs.writeFileSync(path.join(OUT, 'zendesk-ai-agents-found.png'), Buffer.from(shot.result.data, 'base64'));
          console.log('📸 Screenshot saved');
        }
      }
      console.log();
    }
    
  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    try { await cmd('session.end', {}); } catch(_) {}
    ws.close();
  }
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
