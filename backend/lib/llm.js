'use strict';

// ============================================================================
// KNK SUITE v2 — LLM client (Ollama) + fallback offline
// ============================================================================

const http = require('http');

const BASE = 'http://127.0.0.1:11434';

function listModels() {
  return new Promise((resolve) => {
    const req = http.get(`${BASE}/api/tags`, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve((JSON.parse(data).models || []).map((m) => m.name)); }
        catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

function generate(prompt, opts = {}) {
  const model = opts.model || 'hermes3:latest';
  const system = opts.system || 'Eres un mentor de bug bounty, claro y didáctico. Respondes en español.';
  const timeoutMs = opts.timeoutMs || 90000;
  const body = JSON.stringify({ model, prompt, stream: false, options: { temperature: 0.4, num_ctx: 8192 }, system });

  return new Promise((resolve) => {
    const req = http.request(`${BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const p = JSON.parse(data);
          resolve(p.response ? { ok: true, text: p.response.trim(), model } : { ok: false, text: '', model });
        } catch { resolve({ ok: false, text: '', model }); }
      });
    });
    req.on('error', () => resolve({ ok: false, text: '', model, offline: true }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, text: '', model, offline: true }); });
    req.write(body);
    req.end();
  });
}

async function pickModel() {
  const models = await listModels();
  if (!models.length) return null;
  const pref = ['hermes3', 'deepseek', 'qwen', 'llama', 'mistral', 'phi', 'gemma'];
  for (const p of pref) { const f = models.find(m => m.toLowerCase().includes(p)); if (f) return f; }
  return models[0];
}

async function status() {
  const models = await listModels();
  return { up: models.length > 0, models, model: models.length ? await pickModel() : null };
}

module.exports = { BASE, listModels, generate, pickModel, status };