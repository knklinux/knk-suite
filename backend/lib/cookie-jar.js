'use strict';

// ============================================================================
// cookie-jar.js — Sesiones del OPERADOR (sus propias cuentas) para cazar
// autenticado sin pegar secretos en el chat ni en el front.
//
// - Guarda Cookie-headers por host en ~/.knk-suite/cookie-jar.json (0600).
// - Repeater y ParamHunter la adjuntan SOLO si la petición no trae Cookie.
// - Import desde perfil Firefox (cookies.sqlite en claro, solo hosts pedidos).
// - La API nunca devuelve valores: GET lista hosts + fecha + longitud.
// ============================================================================

const fs = require('fs');
const path = require('path');
const os = require('os');

const JAR_PATH = path.join(os.homedir(), '.knk-suite', 'cookie-jar.json');

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(JAR_PATH, 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch { return {}; }
}

function save(jar) {
  try {
    fs.mkdirSync(path.dirname(JAR_PATH), { recursive: true });
    fs.writeFileSync(JAR_PATH, JSON.stringify(jar), { mode: 0o600 });
    try { fs.chmodSync(JAR_PATH, 0o600); } catch {}
    return true;
  } catch { return false; }
}

function normHost(h) {
  return String(h || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/^\.+/, '').slice(0, 253);
}

function set(host, cookie) {
  const h = normHost(host);
  const c = String(cookie || '');
  if (!h || !/^[a-z0-9_.-]+$/i.test(h) || !c || c.length > 16384) return { ok: false, error: 'host o cookie inválidos' };
  const jar = load();
  jar[h] = { cookie: c, updatedAt: new Date().toISOString() };
  return save(jar) ? { ok: true, host: h, len: c.length } : { ok: false, error: 'no se pudo guardar' };
}

function get(host) {
  const jar = load();
  // Coincidencia exacta primero; si no, sube por dominios padre como un
  // navegador (stock.adobe.com hereda la jarra de adobe.com).
  let h = normHost(host);
  while (h) {
    const e = jar[h];
    if (e && e.cookie) return e.cookie;
    const dot = h.indexOf('.');
    if (dot < 0) break;
    h = h.slice(dot + 1);
  }
  return null;
}

/** Lista sin valores (para UI): host, fecha, longitud. */
function hosts() {
  const jar = load();
  return Object.entries(jar).map(([host, e]) => ({ host, updatedAt: e.updatedAt || null, len: (e.cookie || '').length }));
}

function remove(host) {
  const h = normHost(host);
  const jar = load();
  if (!jar[h]) return { ok: false, error: 'no existe' };
  delete jar[h];
  return save(jar) ? { ok: true, host: h } : { ok: false, error: 'no se pudo guardar' };
}

/** Importa cookies de un perfil Firefox local (solo hosts indicados). */
async function importFirefox(profile, hostSuffixes) {
  if (process.platform !== 'win32') return { ok: false, error: 'solo Windows de momento' };
  const prof = String(profile || '').replace(/[\\/]/g, '').slice(0, 80);
  if (!prof) return { ok: false, error: 'perfil requerido' };
  const suffixes = (Array.isArray(hostSuffixes) ? hostSuffixes : []).map((s) => String(s).toLowerCase()).filter(Boolean).slice(0, 10);
  if (!suffixes.length) return { ok: false, error: 'hosts requerido (p. ej. ["chatgpt.com"])' };
  const src = path.join(os.homedir(), 'AppData', 'Roaming', 'Mozilla', 'Firefox', 'Profiles', prof, 'cookies.sqlite');
  if (!fs.existsSync(src)) return { ok: false, error: 'perfil no encontrado: ' + prof };
  let SQL;
  try { SQL = await require('sql.js')(); }
  catch { return { ok: false, error: 'sql.js no disponible' }; }
  const tmp = path.join(os.tmpdir(), 'knk-ff-' + Date.now() + '.db');
  try { fs.copyFileSync(src, tmp); }
  catch { return { ok: false, error: 'perfil en uso (cierra Firefox o usa otro perfil)' }; }
  const found = {};
  try {
    const db = new SQL.Database(fs.readFileSync(tmp));
    const r = db.exec('SELECT host, name, value FROM moz_cookies');
    for (const [host, name, value] of (r.length ? r[0].values : [])) {
      const h = String(host).toLowerCase().replace(/^\./, '');
      if (!suffixes.some((s) => h === s || h.endsWith('.' + s))) continue;
      (found[h] = found[h] || []).push(name + '=' + value);
    }
    db.close();
  } catch (e) { try { fs.unlinkSync(tmp); } catch {} return { ok: false, error: 'sqlite: ' + e.message }; }
  try { fs.unlinkSync(tmp); } catch {}
  const saved = [];
  for (const [h, pairs] of Object.entries(found)) {
    const r2 = set(h, pairs.join('; '));
    if (r2.ok) saved.push({ host: h, cookies: pairs.length });
  }
  return { ok: true, profile: prof, hosts: saved };
}

module.exports = { set, get, hosts, remove, importFirefox, JAR_PATH };
