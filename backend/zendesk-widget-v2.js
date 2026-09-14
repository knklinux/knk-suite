'use strict';
// zendesk-widget-v2.js — Widget test with fixed context handling
const WebSocket = require('ws');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fs = require('fs');
const path = require('path');
const http = require('http');

const WS_URL = 'ws://127.0.0.1:9344/session';
const INSTANCE = 'https://autonomo-49965.zendesk.com';
const CANARY = 'http://127.0.0.1:8210/hit';
const OUT = path.join(__dirname, '..', 'evidencia-poc', 'http');

function httpGet(url) {
  return new Promise(r => {
    http.get(url, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => r({ status: res.statusCode, body: d }));
    }).on('error', () => r({ status: 0, body: '' }));
  });
}

async function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  
  const ws = new WebSocket(WS_URL, { maxPayload: 50 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', d => { const j = JSON.parse(d.toString()); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } });
  const cmd = (m, p={}) => new Promise((r, j) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({id:i,method:m,params:p})); setTimeout(() => { if(pend.has(i)) { pend.delete(i); j(new Error('timeout '+m)); } }, 30000); });
  const eval_ = (ctx, expr) => cmd('script.evaluate', { expression: expr, target: { context: ctx }, awaitPromise: false });
  
  try {
    const sess = await cmd('session.new', { capabilities: { alwaysMatch: {} } });
    if (!sess.result?.sessionId) throw new Error('No session');
    console.log('✅ Session');
    await cmd('session.subscribe', { events: ['browsingContext.load'] });
    
    // Get all existing contexts
    const tree = (await cmd('browsingContext.getTree', { maxDepth: 2 })).result.contexts;
    console.log('Contexts:', tree.length);
    tree.forEach(t => console.log(`  ${t.type}: ${(t.url || '').slice(0, 80)} [${(t.context || '').slice(0, 20)}]`));
    
    const ctx = tree[0].context;
    
    // Navigate to HC
    console.log('\n=== NAVIGATE TO HC ===');
    await cmd('browsingContext.navigate', { context: ctx, url: INSTANCE + '/hc/es', wait: 'complete' });
    await sleep(8000);
    
    // Read page
    const url = await eval_(ctx, 'window.location.href');
    console.log('URL:', url.result?.result?.value);
    
    const body = await eval_(ctx, 'document.body?.innerText?.slice(0, 2000)');
    const text = body.result?.result?.value || '';
    console.log('Body:', text.slice(0, 800));
    
    // Check widget
    const widget = await eval_(ctx, `
      JSON.stringify({
        zE: typeof window.zE,
        launcher: !!document.getElementById('launcher'),
        launcherVisible: document.getElementById('launcher')?.offsetWidth > 0,
        iframes: document.querySelectorAll('iframe').length,
        snippetLoaded: !!document.querySelector('script[src*="zdassets"], script[src*="web-widget"]'),
        snippets: Array.from(document.querySelectorAll('script[src]')).filter(s => /zdassets|web.widget|sunco/i.test(s.src)).map(s => s.src.slice(0, 100))
      })
    `);
    console.log('\nWidget info:', widget.result?.result?.value);
    
    // Click launcher if exists
    const click = await eval_(ctx, `
      (function() {
        const l = document.getElementById('launcher');
        if (l) { l.click(); return 'clicked'; }
        return 'no launcher';
      })()
    `);
    console.log('Click:', click.result?.result?.value);
    
    await sleep(5000);
    
    // Check iframes after click
    const iframes = await eval_(ctx, `
      JSON.stringify(Array.from(document.querySelectorAll('iframe')).map(f => ({
        src: (f.src || '').slice(0, 100),
        w: f.offsetWidth,
        h: f.offsetHeight,
        vis: f.offsetWidth > 0 && f.offsetHeight > 0
      })))
    `);
    console.log('Iframes:', iframes.result?.result?.value);
    
    // Screenshot
    const shot = await cmd('browsingContext.captureScreenshot', { context: ctx });
    if (shot.result?.data) {
      fs.writeFileSync(path.join(OUT, 'zendesk-widget-v2.png'), Buffer.from(shot.result.data, 'base64'));
      console.log('\n📸 Screenshot saved');
    }
    
    console.log('\n=== DONE ===');
    
  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    try { await cmd('session.end', {}); } catch(_) {}
    ws.close();
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
