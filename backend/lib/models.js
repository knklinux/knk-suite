'use strict';

// ============================================================================
// lib/models.js — Gestión de modelos Ollama: listar, pull (job), borrar,
// asignación de rutas del asistente (chat/code/pentest/study) persistente.
// ============================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:11434';
const CFG = path.join(__dirname, '..', '..', 'data', 'model-routes.json');

const DEFAULT_ROUTES = { chat: null, code: null, pentest: null, study: null };

function req(method, apiPath, body, timeoutMs = 180000) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(`${BASE}${apiPath}`, {
      method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
      timeout: timeoutMs,
    }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: out ? JSON.parse(out) : null, raw: out }); }
        catch { resolve({ status: res.statusCode, json: null, raw: out }); }
      });
    });
    r.on('error', (e) => resolve({ status: 0, error: e.message }));
    r.on('timeout', () => { r.destroy(); resolve({ status: 0, error: 'timeout' }); });
    if (data) r.write(data);
    r.end();
  });
}

async function listInstalled() {
  const r = await req('GET', '/api/tags', null, 5000);
  return (r.json?.models || []).map((m) => ({
    name: m.name,
    size: m.size,
    params: m.details?.parameter_size || null,
    quant: m.details?.quantization_level || null,
    ctx: m.details?.context_length || null,
    modified: m.modified_at,
  }));
}

async function listCatalog() {
  // Biblioteca pública de Ollama (nombres + descripción corta)
  const r = await req('GET', '/api/tags', null, 5000).catch(() => null);
  const local = new Set((r?.json?.models || []).map((m) => m.name.split(':')[0]));
  // Catálogo curado para nuestro hardware (RTX 3060 12GB): estáticos y honestos
  return [
    { name: 'qwen2.5-coder:7b', desc: 'Código 7B — ideal para la ruta code (4.7GB)', recommended: 'code' },
    { name: 'qwen2.5:7b', desc: 'General 7B rápido en GPU', recommended: 'chat' },
    { name: 'qwen3:8b', desc: 'General con razonamiento, tools', recommended: 'chat' },
    { name: 'llama3.1:8b', desc: 'Meta 8B, tools', recommended: 'chat' },
    { name: 'mistral:7b', desc: '7B clásico, tools', recommended: 'pentest' },
    { name: 'gemma3:4b', desc: '4B muy ligero, visión', recommended: 'study' },
    { name: 'phi4:14b', desc: '14B razonamiento (más lento en 3060)', recommended: null },
    { name: 'deepseek-r1:8b', desc: 'Razonamiento 8B', recommended: 'study' },
  ].map((m) => ({ ...m, installed: local.has(m.name.split(':')[0]) || undefined }));
}

function loadRoutes() {
  try { return { ...DEFAULT_ROUTES, ...JSON.parse(fs.readFileSync(CFG, 'utf8')) }; }
  catch { return { ...DEFAULT_ROUTES }; }
}

function saveRoutes(routes) {
  const clean = { ...DEFAULT_ROUTES, ...routes };
  for (const k of Object.keys(clean)) if (!clean[k]) delete clean[k];
  fs.mkdirSync(path.dirname(CFG), { recursive: true });
  fs.writeFileSync(CFG, JSON.stringify(clean, null, 2));
  return clean;
}

/** Pull con progreso: devuelve un objeto emitible por SSE o consultable. */
function pull(model, onProgress) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ model, stream: true });
    const r = http.request(`${BASE}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 3600000,
    }, (res) => {
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          try {
            const j = JSON.parse(line);
            if (j.error) return resolve({ ok: false, error: j.error });
            if (onProgress && j.total) onProgress({ model, pct: Math.round(((j.completed || 0) / j.total) * 100), status: j.status });
            if (j.status === 'success') return resolve({ ok: true, model });
          } catch {}
        }
      });
      res.on('end', () => resolve({ ok: true, model, done: true }));
    });
    r.on('error', (e) => resolve({ ok: false, error: e.message }));
    r.on('timeout', () => { r.destroy(); resolve({ ok: false, error: 'timeout' }); });
    r.write(data);
    r.end();
  });
}

async function remove(model) {
  const r = await req('DELETE', '/api/delete', { model }, 30000);
  return { ok: r.status === 200, error: r.json?.error };
}

module.exports = { listInstalled, listCatalog, loadRoutes, saveRoutes, pull, remove };
