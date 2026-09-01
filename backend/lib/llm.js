'use strict';

// ============================================================================
// KNK SUITE v2.1 — LLM client (Ollama) + fallback offline
// Selección consciente del hardware: en equipos sin GPU grande (o CPU-only)
// los modelos de 3B-4B Q4 son la opción usable. hermes3:latest (8B, 4GB)
// NO cabe en GPUs de 2GB → inferencia CPU lenta. Este módulo prefiere el
// modelo pequeño y rápido si existe.
// ============================================================================

const http = require('http');
const https = require('https');

const BASE = 'http://127.0.0.1:11434';

// Orden de preferencia por familia (rápidos primero) + tamaño máximo recomendado
const PREFERRED = ['qwen2.5:3b', 'phi3:mini', 'llama3.2:3b', 'gemma2:2b', 'qwen2.5:1.5b', 'tinyllama', 'hermes3'];
const MAX_MODEL_BYTES = 3.5 * 1024 * 1024 * 1024; // ~3.5GB: evita 8B+ en laptops

function listModels() {
  return new Promise((resolve) => {
    const req = http.get(`${BASE}/api/tags`, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve((JSON.parse(data).models || []).map((m) => ({ name: m.name, size: m.size || 0 }))); }
        catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

/**
 * Elige el modelo más rápido disponible:
 * - Si KNK_LLM_MODEL está definido, ese (si existe)
 * - Si no, el primero de PREFERRED que exista y sea <= MAX_MODEL_BYTES
 * - Si solo hay modelos grandes, el más pequeño
 */
async function pickModel() {
  const envModel = process.env.KNK_LLM_MODEL;
  const models = await listModels();
  if (!models.length) return null;

  if (envModel) {
    const exact = models.find(m => m.name === envModel || m.name.startsWith(envModel));
    if (exact) return exact.name;
  }

  for (const pref of PREFERRED) {
    const found = models.find(m => m.name.toLowerCase().startsWith(pref.toLowerCase()));
    if (found && (found.size || 0) <= MAX_MODEL_BYTES) return found.name;
  }
  // Fallback: el más pequeño disponible
  const smallest = [...models].sort((a, b) => (a.size || 0) - (b.size || 0))[0];
  return smallest ? smallest.name : null;
}

// ── Cliente remoto (OpenAI-compatible: OpenRouter, OpenAI, local LLM servers) ──
// Activo solo si la API remota está configurada. Acepta DOS esquemas de
// variables (el de keys.env legado y el moderno):
//   LLM_ONLINE_BASE_URL / LLM_ONLINE_API_KEY / LLM_ONLINE_MODEL
//   KNK_LLM_API_URL     / KNK_LLM_API_KEY     / KNK_LLM_REMOTE_MODEL
function remoteConfig() {
  const baseUrl = process.env.KNK_LLM_API_URL || process.env.LLM_ONLINE_BASE_URL || '';
  const key = process.env.KNK_LLM_API_KEY || process.env.LLM_ONLINE_API_KEY || '';
  const model = process.env.KNK_LLM_REMOTE_MODEL || process.env.LLM_ONLINE_MODEL || 'openrouter/auto';
  return { baseUrl, key, model };
}

function isRemoteConfigured() {
  const { baseUrl, key } = remoteConfig();
  return !!(baseUrl && key);
}

function generateRemote(prompt, opts = {}) {
  const { baseUrl, key, model } = remoteConfig();
  const system = opts.system || 'Eres un mentor de bug bounty, claro y didáctico. Respondes en español, breve.';
  const timeoutMs = Math.min(opts.timeoutMs || 45000, 120000);

  return new Promise((resolve) => {
    const body = JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], stream: false, max_tokens: 600 });
    // Normalizar endpoint: si la base no termina en /chat/completions, añadirlo
    let endpoint = String(baseUrl).replace(/\/+$/, '');
    if (!/\/chat\/completions$/i.test(endpoint)) endpoint += '/chat/completions';
    let u;
    try { u = new URL(endpoint); } catch { return resolve({ ok: false, text: '', model, reason: 'invalid_url', remote: true }); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return resolve({ ok: false, text: '', model, reason: 'unsupported_protocol', remote: true });
    const transport = u.protocol === 'https:' ? https : http;
    const req = transport.request(u, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const p = JSON.parse(data);
          const text = p?.choices?.[0]?.message?.content;
          if (text) return resolve({ ok: true, text: text.trim(), model, remote: true });
          resolve({ ok: false, text: '', model, error: p?.error?.message || 'empty_response', reason: 'remote_error', remote: true });
        } catch { resolve({ ok: false, text: '', model, reason: 'parse_error', remote: true }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, text: '', model, reason: 'connection_error', remote: true, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, text: '', model, reason: 'timeout', remote: true }); });
    req.write(body);
    req.end();
  });
}

function generate(prompt, opts = {}) {
  const system = opts.system || 'Eres un mentor de bug bounty, claro y didáctico. Respondes en español, breve.';
  const timeoutMs = Math.min(opts.timeoutMs || 45000, 120000); // default 45s, máx 120s
  const numCtx = opts.numCtx || 4096; // contexto reducido: más rápido en CPU

  return new Promise(async (resolve) => {
    // 1) Si hay API remota configurada, usarla (rápida y de calidad)
    if (isRemoteConfigured()) {
      const r = await generateRemote(prompt, opts);
      // Si falla la remota, caer a Ollama en vez de colgar
      if (r.ok) return resolve(r);
      console.error(`[llm] remota falló (${r.reason}), usando Ollama`);
    }
    const model = opts.model || await pickModel();
    if (!model) return resolve({ ok: false, text: '', model: null, offline: true, reason: 'ollama_down' });

    const body = JSON.stringify({ model, prompt, stream: false, options: { temperature: 0.4, num_ctx: numCtx }, system });
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
          if (p.response) return resolve({ ok: true, text: p.response.trim(), model });
          if (p.error) return resolve({ ok: false, text: '', model, error: p.error, reason: 'model_error' });
          resolve({ ok: false, text: '', model });
        } catch { resolve({ ok: false, text: '', model, reason: 'parse_error' }); }
      });
    });
    req.on('error', () => resolve({ ok: false, text: '', model, offline: true, reason: 'connection_error' }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, text: '', model, offline: true, reason: 'timeout', timeoutMs }); });
    req.write(body);
    req.end();
  });
}

async function status() {
  const models = await listModels();
  const model = await pickModel();
  const remote = isRemoteConfigured();
  const { model: remoteModel } = remoteConfig();
  return {
    up: models.length > 0 || remote,
    remote,
    remoteModel: remote ? remoteModel : null,
    models: models.map(m => m.name),
    sizes: Object.fromEntries(models.map(m => [m.name, `${(m.size / 1e9).toFixed(1)}GB`])),
    model,
    envModel: process.env.KNK_LLM_MODEL || process.env.LLM_ONLINE_MODEL || null,
    note: remote
      ? `✅ API remota configurada (${remoteModel}): respuestas rápidas y de calidad. Fallback a Ollama (${model}) si la remota falla.`
      : (models.length && !model ? '⚠️ Todos los modelos instalados son >3.5GB: en laptops sin GPU grande serán MUY lentos. Instala uno pequeño: ollama pull qwen2.5:3b' : (models.length ? `Ollama local (${model}) — configura LLM_ONLINE_BASE_URL/API_KEY en ~/.knk-suite/keys.env (o KNK_LLM_*) para usar una API remota rápida.` : 'Ollama no responde: instala ollama o configura la API remota en ~/.knk-suite/keys.env.')),
  };
}

module.exports = { BASE, listModels, generate, generateRemote, isRemoteConfigured, pickModel, status, PREFERRED, MAX_MODEL_BYTES };
