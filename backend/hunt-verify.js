'use strict';
// hunt-verify.js — Pasada 2 de la REGLA-TRIPLE-REVISION: verifica que cada
// módulo hace sus comprobaciones. Uso: node backend/hunt-verify.js [--full]
// (--full incluye 1 llamada al asistente con LLM; por defecto se omite).
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const TOKEN = fs.readFileSync(path.join(os.homedir(), '.knk-suite', 'api-token'), 'utf8').trim();
const FULL = process.argv.includes('--full');
let pass = 0, fail = 0;
function req(method, apiPath, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const rq = http.request({ host: '127.0.0.1', port: 8086, path: apiPath, method,
      headers: { 'X-KNK-Token': TOKEN, 'Content-Type': 'application/json' } },
      (res) => { let b = ''; res.on('data', (c) => b += c); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
    rq.on('error', reject); rq.setTimeout(timeoutMs || 30000); if (data) rq.write(data); rq.end();
  });
}
async function check(name, fn) {
  try {
    const detail = await fn();
    pass++;
    console.log('  OK ' + name + (detail ? ' — ' + detail : ''));
  } catch (e) { fail++; console.log('  FAIL ' + name + ': ' + String(e.message).slice(0, 100)); }
}
const J = (r) => JSON.parse(r.body);
(async () => {
  console.log('hunt-verify (pasada 2 de la regla triple):');
  await check('dashboard/stats con actividad', async () => {
    const s = J(await req('GET', '/api/dashboard/stats')).recentActivity;
    if (!Array.isArray(s) || !s.length) throw new Error('sin actividad');
    return s.length + ' eventos';
  });
  await check('presets + scope de sesión', async () => {
    const p = J(await req('GET', '/api/presets'));
    if (!p.presets || !p.presets.length) throw new Error('sin presets');
    const s = J(await req('GET', '/api/status'));
    return p.presets.length + ' presets, scope=' + (s.session.scope || []).join(',');
  });
  await check('recon doh', async () => {
    const r = J(await req('GET', '/api/recon/doh?domain=openai.com&type=A'));
    if (!r.ok || !(r.registros || []).length) throw new Error('sin registros');
    return r.via;
  });
  await check('recon crtsh (o fallback con fuente)', async () => {
    const r = J(await req('GET', '/api/recon/crtsh?domain=dyson.com'));
    if (!r.ok) throw new Error(r.error || 'fallo');
    return (r.fuentes || ['?']).join(',');
  });
  await check('recon securitytxt+spfdmarc', async () => {
    const a = J(await req('GET', '/api/recon/securitytxt?domain=openai.com'));
    const b = J(await req('GET', '/api/recon/spfdmarc?domain=openai.com'));
    if (!a || !b) throw new Error('vacío');
    return 'ok';
  });
  await check('repeater scope-gate (OOS bloquea)', async () => {
    const raw = 'GET http://fuera-de-scope-ejemplo-xyz123.com/ HTTP/1.1\nHost: fuera-de-scope-ejemplo-xyz123.com\nConnection: close';
    const r = await req('POST', '/api/repeater/send', { raw, maxRedirects: 0 });
    if (r.status !== 400 || !/SCOPE/.test(r.body)) throw new Error('no bloquea OOS');
    return 'bloquea';
  });
  await check('params/wordlists', async () => {
    const r = J(await req('GET', '/api/params/wordlists'));
    const wl = r.wordlists || r;
    if (!wl.length) throw new Error('vacío');
    return wl.map((w) => w.id + ':' + w.count).join(' ');
  });
  await check('intruder/config', async () => {
    const r = J(await req('GET', '/api/intruder/config'));
    if (!r.caps) throw new Error('sin caps');
    return 'caps ok';
  });
  await check('proxy/status', async () => {
    const r = J(await req('GET', '/api/proxy/status'));
    if (typeof r.running !== 'boolean') throw new Error('raro');
    return 'running=' + r.running;
  });
  await check('findings leen (scope=all)', async () => {
    const r = J(await req('GET', '/api/findings?scope=all'));
    if (!Array.isArray(r)) throw new Error('no array');
    return r.length + ' hallazgos';
  });
  await check('cookie-jar sin valores', async () => {
    const r = J(await req('GET', '/api/session/cookies'));
    const s = JSON.stringify(r);
    if (/session-token=|Bearer eyJ/i.test(s)) throw new Error('fuga valores');
    return (r.hosts || []).length + ' hosts';
  });
  if (FULL) {
    await check('assistant/stream con datos', async () => {
      const r = await req('POST', '/api/assistant/stream',
        { prompt: '¿Cuántos hallazgos tengo? Una línea.', mode: 'chat', useVault: false, useMemory: false, history: [] }, 180000);
      if (!/hallazgo/i.test(r.body)) throw new Error('sin datos');
      return 'responde';
    });
  } else { console.log('  -- assistant/stream omitido (usa --full)'); }
  console.log(`\nresultado: ${pass} OK, ${fail} FAIL`);
  process.exit(fail ? 2 : 0);
})();
