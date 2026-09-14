'use strict';

// ============================================================================
// KNK SUITE v2.1 — Vault de cuentas de prueba (identidades A/B para IDOR)
// Almacena SOLO cuentas que el operador crea manualmente en el programa
// (conforme a su política). Nunca crea cuentas automáticamente.
// Archivo local con permisos 0600 en ~/.knk-suite/vault/.
// ============================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');

const VAULT_DIR = path.join(os.homedir(), '.knk-suite', 'vault');
const VAULT_FILE = path.join(VAULT_DIR, 'accounts.json');

function load() {
  try {
    if (!fs.existsSync(VAULT_FILE)) return {};
    return JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8'));
  } catch { return {}; }
}

function save(data) {
  fs.mkdirSync(VAULT_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(VAULT_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

/**
 * Añade una cuenta de prueba creada manualmente por el operador.
 * @param {{program:string, label:string, username:string, password?:string, role?:string, notes?:string}} account
 */
function addAccount(account) {
  if (!account?.program || !account?.label || !account?.username) {
    throw new Error('program, label y username son obligatorios');
  }
  const data = load();
  const key = String(account.program).toLowerCase();
  data[key] = data[key] || [];
  data[key].push({
    label: String(account.label).slice(0, 40),
    username: String(account.username).slice(0, 200),
    password: account.password ? String(account.password).slice(0, 200) : undefined,
    role: account.role || 'user',
    notes: account.notes ? String(account.notes).slice(0, 500) : '',
    createdAt: new Date().toISOString(),
  });
  save(data);
  return listAccounts(account.program);
}

function listAccounts(program) {
  const data = load();
  if (program) return data[String(program).toLowerCase()] || [];
  return data;
}

function removeAccount(program, index) {
  const data = load();
  const key = String(program).toLowerCase();
  if (!Array.isArray(data[key]) || !data[key][index]) throw new Error('Cuenta no encontrada');
  data[key].splice(index, 1);
  save(data);
  return listAccounts(program);
}

module.exports = { load, addAccount, listAccounts, removeAccount, VAULT_FILE };
