#!/usr/bin/env node
'use strict';

// ============================================================================
// KNK SUITE v2.1 — Onboarding de programa (seguro, sin tráfico)
// Escribe en SQLite (suite.db) — EL MISMO almacén que lee el servidor activo
// (backend/index.js). NO usa session.json (almacén legado).
// Uso:
//   node backend/onboard.js --name "Nombre" --target app.example.com --scope-file scope.txt
//   node backend/onboard.js --name "..." --target app.example.com --scope "*.example.com, api.example.org"
//   node backend/onboard.js --check
// ============================================================================

const fs = require('fs');
const db = require('./db');
const opplanMod = require('./lib/opplan');
const netMod = require('./lib/net');
const hackerone = require('./lib/hackerone');

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : fallback;
};
const has = flag => args.includes(flag);
const fail = msg => { console.error(`✗ ${msg}`); process.exit(1); };

function getSession() {
  const s = db.getOrCreateSession();
  return {
    ...s,
    scope: JSON.parse(s.scope || '[]'),
    out_of_scope: JSON.parse(s.out_of_scope || '[]'),
    opplan: JSON.parse(s.opplan || '{}'),
    artifacts: JSON.parse(s.artifacts || '{}'),
  };
}

if (has('--check')) {
  const s = getSession();
  console.log('Sesión actual (SQLite):', JSON.stringify({
    program: s.artifacts?.programName || null,
    target: s.target || null,
    scope: s.scope || [],
    opplan: s.opplan ? { status: s.opplan.status, autorizado: s.opplan.autorizado } : null,
  }, null, 2));
  if (!s.scope?.length) fail('Sin scope. Ejecuta onboard con --scope o --scope-file.');
  process.exit(0);
}

const name = getArg('--name', '');
const target = getArg('--target', '');
const scopeFile = getArg('--scope-file', '');
const scopeArg = getArg('--scope', '');

let scopeText = scopeArg;
if (scopeFile) {
  if (!fs.existsSync(scopeFile)) fail(`No existe ${scopeFile}`);
  scopeText = fs.readFileSync(scopeFile, 'utf8');
}
if (!scopeText) fail('Proporciona --scope "..." o --scope-file archivo.txt (texto pegado de la pestaña Scope).');

const parsed = hackerone.parseScopeText(scopeText);
if (!parsed.inScope.length) fail('No se extrajo ningún dominio válido del texto. Revisa que pegas las líneas de scope (ej: *.example.com).');

let finalTarget = target;
if (!finalTarget) {
  finalTarget = parsed.inScope.find(d => !d.startsWith('*.')) || parsed.inScope[0].replace(/^\*\./, '');
}

const s = getSession();
s.target = finalTarget;
s.scope = parsed.inScope;
s.out_of_scope = parsed.outOfScope;
s.artifacts = { ...s.artifacts, programName: name, outOfScope: parsed.outOfScope, onboardedAt: new Date().toISOString() };
s.opplan = opplanMod.blank();
s.opplan.nombre = name || 'Programa sin nombre';
s.opplan.objetivo = `Validación autorizada de ${finalTarget}`;
s.opplan.scope = parsed.inScope;
s.opplan.autorizado = false; // requiere aprobación explícita después

db.saveSession(s.id, s);
netMod.setScope(parsed.inScope);
netMod.setOutOfScope(parsed.outOfScope);

console.log(`✓ Programa configurado en SQLite: ${name || finalTarget}`);
console.log(`  Target: ${finalTarget}`);
console.log(`  Scope (${parsed.inScope.length}): ${parsed.inScope.join(', ')}`);
console.log(`  Out-of-scope (${parsed.outOfScope.length}): ${parsed.outOfScope.join(', ') || '(ninguno)'}`);
console.log('');
console.log('⏭  Siguientes pasos (manuales, obligatorios):');
console.log('  1. Verifica el scope en la página del programa (nunca confíes solo en el pegado).');
console.log('  2. Marca autorización en la UI (Dashboard → OPPLAN) tras leer la política.');
console.log('  3. Valida en seco: node backend/headless.js --check');
console.log('  4. Arranca: npm start');
