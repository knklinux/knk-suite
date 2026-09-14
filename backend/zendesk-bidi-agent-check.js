'use strict';
// zendesk-bidi-agent-check.js — Verifica el AI agent en Zendesk via BiDi
//   node backend/zendesk-bidi-agent-check.js
const WebSocket = require('ws');

async function main() {
  const ws = new WebSocket('ws://127.0.0.1:9344/session', { maxPayload: 50 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

  let id = 0;
  const pending = new Map();
  ws.on('message', d => {
    const m = JSON.parse(d);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });

  function send(method, params = {}) {
    return new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params }));
      setTimeout(() => { pending.delete(mid); rej(new Error('timeout: ' + method)); }, 30000);
    });
  }

  try {
    // Create session
    const sess = await send('session.new', { capabilities: {} });
    const sid = sess.result?.sessionId;
    if (!sid) throw new Error('No session: ' + JSON.stringify(sess).slice(0, 200));
    console.log('✅ Session:', sid.slice(0, 16) + '...');

    // Get browsing contexts
    const tree = await send('browsingContext.getTree', {});
    const contexts = tree.result?.contexts || [];
    console.log('📋 Contexts:', contexts.length);

    // Find or use the first browsing context
    const ctx = contexts.find(c => c.type === 'tab') || contexts[0];
    if (!ctx) throw new Error('No browsing context found');

    const ctxId = ctx.id || ctx.browsingContext;
    console.log('🔖 Context ID:', ctxId);

    // Navigate to agent builder
    console.log('🧭 Navigating to agent builder...');
    await send('browsingContext.navigate', {
      context: ctxId,
      url: 'https://autonomo-49965.zendesk.com/admin/ai/agent-builder/custom-agents'
    });

    // Wait for page load
    await new Promise(r => setTimeout(r, 12000));

    // Evaluate JS using script.evaluate
    const evalResult = await send('script.evaluate', {
      target: { context: ctxId },
      expression: `JSON.stringify({
        url: location.href,
        title: document.title,
        text: (document.body?.innerText || '').slice(0, 4000)
      })`,
      resultOwnership: 'root'
    });

    const val = evalResult.result?.result?.value;
    if (val) {
      const p = JSON.parse(val);
      console.log('\n=== PAGE STATE ===');
      console.log('URL:', p.url);
      console.log('Title:', p.title);
      console.log('Body:', p.text);
    } else {
      console.log('Eval result:', JSON.stringify(evalResult).slice(0, 2000));
    }

  } catch (e) {
    console.error('❌', e.message);
  } finally {
    ws.close();
  }
}

main();
