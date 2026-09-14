'use strict';
// ki-descarga-completa.js — Descarga la lista completa de Known Issues vía API interna
//   GET /engagements/openai/known_issues.json (con paginación si hace falta)
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const OUT_JSON = path.join(__dirname, '..', 'evidencia-poc', 'http', 'known-issues-openai-full.json');
const OUT_TXT = path.join(__dirname, '..', 'evidencia-poc', 'http', 'known-issues-openai.txt');
async function main() {
  const ws = new WebSocket('ws://127.0.0.1:9344/session', { maxPayload: 50*1024*1024 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', d => { const j = JSON.parse(d); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } });
  const cmd = (m, p = {}) => new Promise((r, j2) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); j2(new Error('timeout ' + m)); } }, 60000); });
  const ses = await cmd('session.new', { capabilities: { alwaysMatch: {} } });
  const tree = await cmd('browsingContext.getTree', { maxDepth: 2 });
  const ctx = tree.result.contexts[0].context;
  const expr = [
    '(async () => {',
    '  const csrf = document.querySelector(\'meta[name="csrf-token"]\')?.content || "";',
    '  const H = { "Accept": "application/json", "X-CSRF-Token": csrf };',
    '  const todas = [];',
    '  for (let page = 1; page <= 6; page++) {',
    '    const resp = await fetch("/engagements/openai/known_issues.json?page=" + page + "&per_page=100", { headers: H, credentials: "same-origin" });',
    '    const txt = await resp.text();',
    '    let j; try { j = JSON.parse(txt); } catch (e) { break; }',
    '    const arr = j.known_issues || j.issues || (Array.isArray(j) ? j : []);',
    '    if (!arr.length) break;',
    '    todas.push(...arr);',
    '    if (arr.length < 100) break;',
    '  }',
    '  return JSON.stringify({ n: todas.length, primera: todas[0] ? JSON.stringify(todas[0]).slice(0, 500) : null });',
    '})()'
  ].join('\n');
  const r = await cmd('script.evaluate', { expression: expr, target: { context: ctx }, awaitPromise: true, resultOwnership: 'none' });
  console.log('PROBE:', r.result.result.value.slice(0, 800));
  await cmd('session.end', {});
  ws.close();
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
