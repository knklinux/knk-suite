'use strict';
// zendesk-widget-test.js — Test widget interaction without article creation
const WebSocket = require('ws');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const WS_URL = 'ws://127.0.0.1:9344/session';
const INSTANCE = 'https://autonomo-49965.zendesk.com';
const CANARY = 'http://127.0.0.1:8210/hit';
const OUT = path.join(__dirname, '..', 'evidencia-poc', 'http');

function httpsGet(url, cookies) {
  return new Promise(r => {
    https.get(url, { headers: { Cookie: cookies || '' } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => r({ status: res.statusCode, body: d }));
    }).on('error', e => r({ status: 0, body: e.message }));
  });
}

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
    const ctx = (await cmd('browsingContext.getTree', { maxDepth: 1 })).result.contexts[0].context;

    // Get cookies for API
    await cmd('browsingContext.navigate', { context: ctx, url: INSTANCE + '/admin', wait: 'complete' });
    await sleep(4000);
    const cookies = (await eval_(ctx, 'document.cookie')).result?.result?.value || '';

    // === 1. LIST EXISTING HC ARTICLES ===
    console.log('\n=== 1. HC ARTICLES ===');
    const articles = await httpsGet(INSTANCE + '/api/v2/help_center/es/articles.json', cookies);
    console.log('Status:', articles.status);
    if (articles.status === 200) {
      const parsed = JSON.parse(articles.body);
      const arts = parsed.articles || [];
      console.log('Found', arts.length, 'articles');
      arts.forEach(a => console.log(`  - [${a.id}] ${a.title.slice(0, 60)} (created: ${a.created_at?.slice(0, 10)})`));
    }
    
    // === 2. CHECK CANARY ===
    const canary = await httpGet(CANARY);
    console.log('\nCanary:', canary.status === 204 ? '✅ alive' : '❌ dead');
    
    // === 3. VISIT HC AS VISITOR (new tab) ===
    console.log('\n=== 2. VISIT HC ===');
    const newCtx = (await cmd('browsingContext.create', { type: 'tab' })).result.context;
    const vCtx = newCtx.context || newCtx.browsingContext;
    
    await cmd('browsingContext.navigate', { context: vCtx, url: INSTANCE + '/hc/es', wait: 'complete' });
    await sleep(8000);
    
    const hcUrl = await eval_(vCtx, 'window.location.href');
    console.log('URL:', hcUrl.result?.result?.value);
    
    const hcText = await eval_(vCtx, 'document.body?.innerText?.slice(0, 2000)');
    console.log('HC text:', (hcText.result?.result?.value || '').slice(0, 800));
    
    // Check widget
    const widgetInfo = await eval_(vCtx, `
      JSON.stringify({
        zE: typeof window.zE,
        launcher: !!document.getElementById('launcher'),
        launcherText: document.getElementById('launcher')?.innerText?.slice(0, 50),
        iframes: Array.from(document.querySelectorAll('iframe')).map(f => ({
          src: (f.src || '').slice(0, 100),
          visible: f.offsetWidth > 0 && f.offsetHeight > 0,
          size: f.offsetWidth + 'x' + f.offsetHeight
        }))
      })
    `);
    console.log('\nWidget:', widgetInfo.result?.result?.value);
    
    // Try clicking launcher
    console.log('\n=== 3. CLICK LAUNCHER ===');
    const clickResult = await eval_(vCtx, `
      (function() {
        const launcher = document.getElementById('launcher');
        if (launcher) { launcher.click(); return 'clicked launcher'; }
        return 'no launcher';
      })()
    `);
    console.log('Click:', clickResult.result?.result?.value);
    
    await sleep(5000);
    
    // Check if widget opened
    const afterClick = await eval_(vCtx, `
      JSON.stringify({
        frames: Array.from(document.querySelectorAll('iframe')).map(f => ({
          src: (f.src || '').slice(0, 100),
          visible: f.offsetWidth > 0 && f.offsetHeight > 0,
          size: f.offsetWidth + 'x' + f.offsetHeight
        })),
        localStorage: Object.keys(localStorage).filter(k => /zendesk|sunco|zd/i.test(k))
      })
    `);
    console.log('After click:', afterClick.result?.result?.value);
    
    // Screenshot
    const shot = await cmd('browsingContext.captureScreenshot', { context: vCtx });
    if (shot.result?.data) {
      fs.writeFileSync(path.join(OUT, 'zendesk-widget-test.png'), Buffer.from(shot.result.data, 'base64'));
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
