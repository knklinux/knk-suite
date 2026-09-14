const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_ENTRIES = 200;
const DATA_DIR = path.join(os.homedir(), '.knk-suite');
const FILE_PATH = path.join(DATA_DIR, 'clipboard.json');

let entries = [];

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function save() {
  ensureDataDir();
  try {
    fs.writeFileSync(FILE_PATH, JSON.stringify(entries, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save clipboard:', err.message);
  }
}

function load() {
  ensureDataDir();
  try {
    if (fs.existsSync(FILE_PATH)) {
      const data = fs.readFileSync(FILE_PATH, 'utf8');
      entries = JSON.parse(data);
      if (!Array.isArray(entries)) entries = [];
    }
  } catch (err) {
    console.error('Failed to load clipboard:', err.message);
    entries = [];
  }
}

function add(text, category = 'note', tags = []) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const entry = {
    id,
    text,
    category,
    tags: Array.isArray(tags) ? tags : [],
    timestamp: Date.now()
  };

  entries.unshift(entry);

  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(0, MAX_ENTRIES);
  }

  save();
  return entry;
}

function list(category) {
  let result = entries;
  if (category) {
    result = entries.filter(e => e.category === category);
  }
  return result.slice().sort((a, b) => b.timestamp - a.timestamp);
}

function search(query) {
  const q = query.toLowerCase();
  return entries.filter(e =>
    e.text.toLowerCase().includes(q) ||
    e.tags.some(t => t.toLowerCase().includes(q))
  );
}

function remove(id) {
  const idx = entries.findIndex(e => e.id === id);
  if (idx === -1) return false;
  entries.splice(idx, 1);
  save();
  return true;
}

function clear() {
  entries = [];
  save();
  return true;
}

function exportAll() {
  return JSON.parse(JSON.stringify(entries));
}

load();

module.exports = { add, list, search, remove, clear, export: exportAll };
