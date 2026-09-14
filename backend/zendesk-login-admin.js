'use strict';
// zendesk-login-admin.js — Login en Zendesk admin via BiDi
//   node backend/zendesk-login-admin.js [email] [password]
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const EVIDENCE_DIR = path.join(__dirname, '..', 'evidencia-poc', 'http');
const SUBDOMINIO = 'autonomo-49965';

async function main() {
  const email = process.argv[2] || 'admin@autonomo-49965.zendesk.com';
  const pass = process.argv[3] || '';

  if (!pass) {
    console.log('Usage: node backend/zendesk-login-admin.js <email> <password>');
    console.log('Example: node backend/zendesk-login-admin.js admin@autonomo-49965.zendesk.com mypassword');
    process.exit(1);
  }

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
    // Session
    const sess = await send('session.new', { capabilities: {} });
    const sid = sess.result?.sessionId;
    if (!sid) throw new Error('No session');
    console.log('✅ Sesión:', sid.slice(0, 16));

    // Context
    const tree = await send('browsingContext.getTree', {});
    const ctx = tree.result?.contexts?.[0];
    const ctxId = ctx?.context;
    if (!ctxId) throw new Error('No context');

    // Navigate to login
    console.log('🧭 Navegando al login...');
    await send('browsingContext.navigate', {
      context: ctxId,
      url: `https://${SUBDOMINIO}.zendesk.com/admin/ai/agent-builder/custom-agents`
    });
    await new Promise(r => setTimeout(r, 8000));

    // Fill email
    console.log('📧 Rellenando email...');
    await send('script.evaluate', {
      target: { context: ctxId },
      expression: `
        const emailInput = document.querySelector('input[name="user[email]"], input[type="email"], #user_email');
        if (emailInput) {
          emailInput.focus();
          emailInput.value = '${email}';
          emailInput.dispatchEvent(new Event('input', {bubbles: true}));
          emailInput.dispatchEvent(new Event('change', {bubbles: true}));
          'email set';
        } else {
          'no email input found: ' + document.body.innerText.slice(0, 300);
        }
      `,
      awaitPromise: false,
      resultOwnership: 'root'
    });
    await new Promise(r => setTimeout(r, 1000));

    // Fill password
    console.log('🔑 Rellenando password...');
    const passRes = await send('script.evaluate', {
      target: { context: ctxId },
      expression: `
        const passInput = document.querySelector('input[name="user[password]"], input[type="password"]');
        if (passInput) {
          passInput.focus();
          passInput.value = '${pass}';
          passInput.dispatchEvent(new Event('input', {bubbles: true}));
          passInput.dispatchEvent(new Event('change', {bubbles: true}));
          'password set';
        } else {
          'no password input found';
        }
      `,
      awaitPromise: false,
      resultOwnership: 'root'
    });
    console.log('Pass result:', passRes.result?.result?.value);
    await new Promise(r => setTimeout(r, 1000));

    // Submit
    console.log('🚀 Submitting...');
    await send('script.evaluate', {
      target: { context: ctxId },
      expression: `
        const btn = document.querySelector('button[type="submit"], input[type="submit"]');
        if (btn) { btn.click(); 'clicked'; } else { 'no submit button'; }
      `,
      awaitPromise: false,
      resultOwnership: 'root'
    });

    // Wait for redirect
    await new Promise(r => setTimeout(r, 10000));

    // Check result
    const result = await send('script.evaluate', {
      target: { context: ctxId },
      expression: `JSON.stringify({url: location.href, title: document.title, body: document.body?.innerText?.slice(0, 2000) || 'empty'})`,
      awaitPromise: false,
      resultOwnership: 'root'
    });

    const val = result.result?.result?.value;
    if (val) {
      const p = JSON.parse(val);
      console.log('\n=== POST-LOGIN ===');
      console.log('URL:', p.url);
      console.log('Title:', p.title);
      console.log('Body:', p.body);

      const loggedIn = !p.url.includes('signin') && !p.url.includes('login');
      console.log('\n🔐 Login:', loggedIn ? '✅ EXITOSO' : '❌ FALLO');

      // Save evidence
      fs.writeFileSync(path.join(EVIDENCE_DIR, 'zendesk-login-resultado.json'), JSON.stringify({
        fecha: new Date().toISOString(),
        email,
        url: p.url,
        loggedIn,
        bodySnippet: p.body.slice(0, 500)
      }, null, 2));
    }

    // Don't end session — keep it alive for the next script
    console.log('⚠️ Sesión BiDi permanece abierta para scripts posteriores');

  } catch (e) {
    console.error('❌', e.message);
  } finally {
    ws.close();
  }
}

main();
