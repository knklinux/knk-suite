const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const CACHE_DIR = path.join(os.homedir(), '.knk-suite', 'cache');
const DEFAULT_TTL = 24 * 60 * 60 * 1000;

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function getCachePath() {
  ensureCacheDir();
  return CACHE_DIR;
}

function hashKey(key) {
  return crypto.createHash('md5').update(key).digest('hex');
}

function getFilePath(key) {
  return path.join(getCachePath(), `${hashKey(key)}.json`);
}

function get(key) {
  const filePath = getFilePath(key);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const entry = JSON.parse(raw);
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      fs.unlinkSync(filePath);
      return null;
    }
    return entry.value;
  } catch {
    return null;
  }
}

function set(key, value, ttlMs) {
  const ttl = ttlMs || DEFAULT_TTL;
  const entry = {
    key,
    value,
    cachedAt: Date.now(),
    expiresAt: Date.now() + ttl
  };
  const filePath = getFilePath(key);
  ensureCacheDir();
  fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf8');
}

function has(key) {
  const filePath = getFilePath(key);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const entry = JSON.parse(raw);
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      fs.unlinkSync(filePath);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function clear() {
  const dir = getCachePath();
  try {
    const files = fs.readdirSync(dir);
    files.forEach(f => {
      if (f.endsWith('.json')) {
        fs.unlinkSync(path.join(dir, f));
      }
    });
    return { ok: true, removed: files.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function stats() {
  const dir = getCachePath();
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    let totalSize = 0;
    files.forEach(f => {
      const stat = fs.statSync(path.join(dir, f));
      totalSize += stat.size;
    });
    return { totalEntries: files.length, totalSize };
  } catch {
    return { totalEntries: 0, totalSize: 0 };
  }
}

module.exports = { getCachePath, get, set, has, clear, stats };
