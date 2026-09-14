'use strict';

// ============================================================================
// lib/vault.js — Cerebro de conocimiento local (bóveda Obsidian)
//
// Indexa los .md de vault-knklinux/ y ofrece búsqueda por relevancia.
// Sin dependencias externas: scoring por frecuencia de términos + boosts
// (título y etiquetas). Los embeddings llegarán cuando elijamos modelo local
// de embeddings; este motor es suficiente para el cerebro inicial.
// ============================================================================

const fs = require('fs');
const path = require('path');

// La bóveda vive junto a knk-suite: <raíz>/vault-knklinux
// (__dirname = backend/lib → subir 2 niveles = knk-suite → hermano = vault)
// Raíces de la bóveda (multi-raíz): bóveda grande del usuario + bóveda de producto
function defaultVaultRoots() {
  const roots = [];
  if (process.env.KNK_VAULT_DIR) roots.push(process.env.KNK_VAULT_DIR);
  const home = process.env.USERPROFILE || require('os').homedir();
  roots.push(path.join(home, 'Downloads', 'conocimientoo', 'conocimientoo'));
  roots.push(path.resolve(__dirname, '..', '..', '..', 'vault-knklinux'));
  return [...new Set(roots)].filter((r) => { try { return fs.statSync(r).isDirectory(); } catch { return false; } });
}
const VAULT_ROOTS = defaultVaultRoots();
const VAULT_DIR = VAULT_ROOTS[VAULT_ROOTS.length - 1];
const MAX_CONTEXT_CHARS = 6000; // presupuesto de contexto para el modelo
const CHUNK_SIZE = 1200;        // troceado de notas largas

// ── Utilidades de texto ────────────────────────────────────────────────
function normalize(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const STOPWORDS = new Set(
  ('de la que el en y a los se del las un por con no una su para es al lo como ' +
   'mas o pero sus le ya o este si porque esta entre cuando muy sin sobre tambien ' +
   'me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ' +
   'ese eso ante ellos e esto mi antes algunos que unos yo otro otras otra el tan ' +
   'the of and to in is it that for on with as are was be this at by from or an').split(' ')
);

function tokenize(s) {
  return normalize(s)
    .replace(/[^a-z0-9áéíóúñü\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

// ── Frontmatter y chunks ───────────────────────────────────────────────
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_-]+)\s*:\s*(.+)$/);
    if (kv) {
      if (kv[1] === 'tags') {
        meta.tags = (kv[2].match(/\[([^\]]*)\]/)?.[1] || kv[2])
          .split(',')
          .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);
      } else {
        meta[kv[1]] = kv[2].trim();
      }
    }
  }
  return { meta, body: text.slice(m[0].length) };
}

function chunkText(body) {
  const blocks = body.split(/\r?\n\r?\n/);
  const chunks = [];
  let cur = '';
  for (const b of blocks) {
    if ((cur + '\n\n' + b).length > CHUNK_SIZE && cur) {
      chunks.push(cur.trim());
      cur = b;
    } else {
      cur = cur ? cur + '\n\n' + b : b;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

// ── Índice ─────────────────────────────────────────────────────────────
let INDEX = []; // { file, title, tags, chunk, tokens:Map, tf:number }
let lastScan = 0;

const SKIP_DIRS = new Set(['images', 'attachments', 'trash']);
function walkMarkdown(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name.toLowerCase())) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkMarkdown(full, out);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(full);
  }
  return out;
}

function titleFromFile(file, frontTitle) {
  if (frontTitle) return frontTitle;
  const base = path.basename(file, '.md');
  return base === '00-ÍNDICE' || base.startsWith('00-') ? 'Índice de la bóveda' : base.replace(/[-_]+/g, ' ');
}

function buildIndex() {
  const files = VAULT_ROOTS.flatMap((root) => walkMarkdown(root));
  INDEX = [];
  for (const file of files) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const { meta, body } = parseFrontmatter(raw);
    const title = titleFromFile(file, meta.title);
    const rel = path.relative(VAULT_ROOTS.find((r) => file.startsWith(r)) || VAULT_DIR, file).replace(/\\/g, '/');
    const tags = meta.tags || [];
    for (const chunk of chunkText(body)) {
      const tokens = tokenize(chunk + ' ' + title + ' ' + tags.join(' '));
      const tf = new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      INDEX.push({ file: rel, title, tags, chunk, tf, len: tokens.length || 1 });
    }
  }
  lastScan = Date.now();
  return INDEX.length;
}

function ensureIndex(maxAgeMs = 15000) {
  if (!INDEX.length || Date.now() - lastScan > maxAgeMs) buildIndex();
}

// ── Búsqueda ───────────────────────────────────────────────────────────
function search(query, limit = 5) {
  ensureIndex();
  const qTokens = [...new Set(tokenize(query))];
  if (!qTokens.length) return [];

  const scored = [];
  for (const doc of INDEX) {
    let score = 0;
    for (const qt of qTokens) {
      const f = doc.tf.get(qt);
      if (!f) continue;
      // TF normalizado + boost si el término está en el título o tags
      score += (f / doc.len) * 100;
      if (normalize(doc.title).includes(qt)) score += 25;
      if (doc.tags.some((tg) => normalize(tg).includes(qt))) score += 15;
    }
    if (score > 0) scored.push({ score, doc });
  }
  scored.sort((a, b) => b.score - a.score);

  // Deduplicar por nota: máx 2 chunks por archivo
  const perFile = new Map();
  const results = [];
  for (const { score, doc } of scored) {
    const n = perFile.get(doc.file) || 0;
    if (n >= 2) continue;
    perFile.set(doc.file, n + 1);
    results.push({ file: doc.file, title: doc.title, tags: doc.tags, score: Math.round(score), excerpt: doc.chunk.slice(0, 500) });
    if (results.length >= limit) break;
  }
  return results;
}

// ── Contexto para el asistente ─────────────────────────────────────────
function buildContext(query, limit = 5) {
  const hits = search(query, limit);
  if (!hits.length) return { context: '', sources: [] };
  let context = '';
  const sources = [];
  for (const h of hits) {
    const piece = `### ${h.title} (vault/${h.file})\n${h.excerpt}\n`;
    if (context.length + piece.length > MAX_CONTEXT_CHARS) break;
    context += piece + '\n';
    sources.push(h.title + ' — vault/' + h.file);
  }
  return { context, sources };
}

function stats() {
  ensureIndex();
  const files = new Set(INDEX.map((d) => d.file));
  return { vaultDir: VAULT_ROOTS.length > 1 ? VAULT_ROOTS.length + ' raíces' : 'vault-knklinux/', roots: VAULT_ROOTS.length, notes: files.size, chunks: INDEX.length };
}

module.exports = { search, buildContext, stats, rebuild: buildIndex };
