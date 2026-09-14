'use strict';
// zendesk-verificar-agente.js — Verifica si el AI agent existe en Zendesk via BiDi
//   node backend/zendesk-verificar-agente.js
// Flujo completo: conectar → sesión → context → navigate → evaluar DOM → evidencia
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const EVIDENCE_DIR = path.join(__dirname, '..', 'evidencia-poc', 'http');
const URL_AGENT_BUILDER = 'https://autonomo-49965.zendesk.com/admin/ai/agent-builder/custom-agents';
const URL_AI_AGENTS = 'https://autonomo-49965.zendesk.com/admin/ai/ai-agents/ai-agents';

async function main() {
  // Connect
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
    // Step 1: Create session
    const sess = await send('session.new', { capabilities: {} });
    const sid = sess.result?.sessionId;
    if (!sid) throw new Error('session.new failed: ' + JSON.stringify(sess).slice(0, 300));
    console.log('✅ Sesión BiDi:', sid.slice(0, 20));

    // Step 2: Get browsing context tree
    const tree = await send('browsingContext.getTree', {});
    const ctxs = tree.result?.contexts;
    console.log('📋 Contextos:', JSON.stringify(ctxs).slice(0, 500));

    // Find a usable context
    let ctxId = null;
    if (ctxs && ctxs.length > 0) {
      // Try common field names for the context ID
      const first = ctxs[0];
      ctxId = first.browsingContext || first.id || first.context || first.navigableId;
      if (!ctxId && typeof first === 'string') ctxId = first;
    }
    
    if (!ctxId) {
      // If no contexts, try creating one via browsingContext.create
      const created = await send('browsingContext.create', { type: 'tab', url: URL_AGENT_BUILDER });
      ctxId = created.result?.context;
      console.log('🆕 Contexto creado:', ctxId);
    } else {
      console.log('🔖 Contexto:', ctxId);
    }

    // Step 3: Navigate
    console.log('🧭 Navegando a agent builder...');
    const nav = await send('browsingContext.navigate', {
      context: ctxId,
      url: URL_AGENT_BUILDER
    });
    console.log('🧭 Nav:', JSON.stringify(nav).slice(0, 200));

    // Wait for page to load
    await new Promise(r => setTimeout(r, 12000));

    // Step 4: Evaluate DOM
    const evalRes = await send('script.evaluate', {
      target: { context: ctxId },
      expression: `JSON.stringify({
        url: location.href,
        title: document.title,
        text: (document.body?.innerText || '').slice(0, 5000)
      })`,
      awaitPromise: false,
      resultOwnership: 'root'
    });

    const val = evalRes.result?.result?.value;
    if (val) {
      const parsed = JSON.parse(val);
      console.log('\n=== ESTADO DEL AGENT BUILDER ===');
      console.log('URL:', parsed.url);
      console.log('Title:', parsed.title);
      console.log('Body:', parsed.text);

      // Save evidence
      const evidence = {
        fecha: new Date().toISOString(),
        url: parsed.url,
        title: parsed.title,
        body: parsed.text,
        hasAgent: parsed.text.includes('SYNTHETIC') || parsed.text.includes('agent') && !parsed.text.includes('No agents'),
        bodySnippet: parsed.text.slice(0, 500)
      };
      const outPath = path.join(EVIDENCE_DIR, 'zendesk-agent-builder-estado.json');
      fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2));
      console.log('\n💾 Evidencia guardada:', outPath);
    } else {
      console.log('⚠️ Eval result:', JSON.stringify(evalRes).slice(0, 1500));
    }

    // Step 5: End session
    await send('session.end', {});
    console.log('🔒 Sesión cerrada');

  } catch (e) {
    console.error('❌', e.message);
  } finally {
    ws.close();
  }
}

main();
