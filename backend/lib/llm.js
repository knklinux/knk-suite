'use strict';

// ============================================================================
// KNK SUITE — LLM Client (Ollama local, 100% gratis y sin claves)
//
// El tier gratuito de OpenCode Zen exige sesión de su app (MissingSessionID),
// así que el motor principal es Ollama en local:
//   · code/ejecutar → qwen2.5-coder:7b (si está) si no dolphin3:8b
//   · chat/debatir  → dolphin3:8b (sin censura, contexto 131k)
//   · planificar    → deepseek-r1:8b si está, si no dolphin3:8b
// Si falta un modelo se usa el mejor instalado (nunca se finge).
// ============================================================================

const http = require('http');

const OLLAMA = process.env.KNK_OLLAMA_BASE || 'http://127.0.0.1:11434';

const ROLE_PREFS = {
  code: ['qwen2.5-coder:7b', 'qwen2.5-coder:14b', 'deepseek-coder-v2:16b', 'dolphin3:8b'],
  chat: ['dolphin3:8b', 'llama3.1:8b', 'ministral:8b', 'qwen2.5:7b'],
  debate: ['dolphin3:8b', 'llama3.1:8b', 'qwen2.5:14b'],
  plan: ['deepseek-r1:8b', 'deepseek-r1:14b', 'qwen2.5:14b', 'dolphin3:8b'],
  execute: ['qwen2.5-coder:7b', 'dolphin3:8b'],
  pentest: ['dolphin3:8b', 'qwen2.5-coder:7b'],
  study: ['dolphin3:8b'],
  osint: ['dolphin3:8b'],
};

// Compat: el resto del backend importa MODEL/ROUTE_PREFS de aquí.
const MODEL = process.env.KNK_LLM_MODEL || 'dolphin3:8b';
const ROUTE_PREFS = Object.fromEntries(
  Object.entries(ROLE_PREFS).map(([route, models]) => [route, models[0]])
);
const BASE = OLLAMA;

function post(path, body, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const url = new URL(OLLAMA + path);
    const req = http.request(url, {
      method: 'POST',
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(text) }); }
        catch { resolve({ status: res.statusCode, json: null, raw: text }); }
      });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
    req.write(data);
    req.end();
  });
}

function get(path, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const url = new URL(OLLAMA + path);
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(text) }); }
        catch { resolve({ status: res.statusCode, json: null }); }
      });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
  });
}

let _modelsCache = { at: 0, names: [] };

async function listModels() {
  if (Date.now() - _modelsCache.at < 30000 && _modelsCache.names.length) return _modelsCache.names;
  const r = await get('/api/tags');
  const names = (r.json && Array.isArray(r.json.models) ? r.json.models : []).map((m) => m.name).filter(Boolean);
  if (names.length) _modelsCache = { at: Date.now(), names };
  return _modelsCache.names.length ? _modelsCache.names : names;
}

async function listModelDetails() {
  const names = await listModels();
  return names.map((name) => ({ name, size: null, details: {} }));
}

function pickInstalledModel(models, route = 'chat', explicit) {
  if (explicit && models.includes(explicit)) return explicit;
  if (explicit) return explicit; // explícito aunque no listado: Ollama lo intentará
  const prefs = ROLE_PREFS[route] || ROLE_PREFS.chat;
  return prefs.find((m) => models.includes(m)) || models[0] || MODEL;
}

async function pickModel(route = 'chat', explicit) {
  return pickInstalledModel(await listModels(), route, explicit);
}

async function generate(prompt, opts = {}) {
  const started = Date.now();
  const route = opts.route || 'chat';
  const installed = await listModels();
  if (!installed.length) {
    return { ok: false, text: '', model: null, route, elapsedMs: Date.now() - started, offline: true, error: 'Ollama sin modelos (ollama pull qwen2.5-coder:7b)' };
  }
  const candidates = opts.model
    ? [opts.model]
    : [...new Set([...(ROLE_PREFS[route] || ROLE_PREFS.chat).filter((m) => installed.includes(m)), installed[0]])];
  const system = opts.system || 'Eres Electra, mentora de seguridad local, clara y didáctica. Respondes en español.';
  const timeoutMs = opts.timeoutMs || 180000;
  let lastError = 'sin candidatos';

  for (const model of candidates) {
    const r = await post('/api/chat', {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      stream: false,
      keep_alive: '30m',
      options: { temperature: opts.temperature ?? 0.35, num_predict: opts.maxTokens || 2048 },
    }, timeoutMs);
    const text = r.json && r.json.message && r.json.message.content;
    if (r.status === 200 && text) {
      return { ok: true, text: String(text).trim(), model, route, elapsedMs: Date.now() - started };
    }
    lastError = (r.json && r.json.error) || r.error || `http ${r.status}`;
    if (/connect|refused|timeout/i.test(lastError)) break; // Ollama caído: no rotar
  }
  return { ok: false, text: '', model: candidates[0] || null, route, elapsedMs: Date.now() - started, error: lastError };
}

async function request(method, apiPath, body, timeoutMs = 10000) {
  // Compat con llamantes antiguos (Zen): se traduce a Ollama cuando cuadra.
  if (method === 'GET' && apiPath === '/models') {
    return { status: 200, json: { object: 'list', data: (await listModels()).map((id) => ({ id, object: 'model' })) } };
  }
  return { status: 501, json: null, error: 'ruta legacy: usa generate()' };
}

async function status() {
  const names = await listModels();
  const up = names.length > 0;
  const routes = {};
  for (const route of Object.keys(ROLE_PREFS)) routes[route] = pickInstalledModel(names, route);
  return {
    up, base: OLLAMA, model: routes.chat || null, models: names, routes,
    inventory: names.map((name) => ({ name, size: null })),
  };
}

module.exports = { BASE, ROUTE_PREFS, MODEL, ROLE_PREFS, request, listModelDetails, listModels, generate, pickInstalledModel, pickModel, status };
