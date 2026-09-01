#!/usr/bin/env node
'use strict';

// ============================================================================
// KNK SUITE v2.1 — Modo headless (CI/CD)
// Lee la sesión desde SQLite (suite.db) — el mismo almacén del servidor activo.
// Uso:
//   node backend/headless.js --check                 # valida configuración (sin red)
//   node backend/headless.js --dry-run               # simula pipeline sin peticiones
//   node backend/headless.js --export-report FILE    # exporta reporte JSON a HTML
// Variables: KNK_DB, KNK_API_KEY
// Por defecto NO realiza tráfico de red contra objetivos.
// ============================================================================

const fs = require('fs');
const db = require('./db');
const opplanMod = require('./lib/opplan');
const netMod = require('./lib/net');
const reportMod = require('./lib/report');
const pipeline = require('./lib/pipeline');

const args = process.argv.slice(2);

function fail(msg) { console.error(`✗ ${msg}`); process.exit(1); }

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

function loadConfig() {
  const s = getSession();
  if (!s.scope || !s.scope.length) fail('Sin scope definido: configura el programa (node backend/onboard.js).');
  netMod.setScope(s.scope);
  netMod.setOutOfScope(s.out_of_scope || s.artifacts?.outOfScope || []);
  return s;
}

if (args.includes('--check')) {
  const s = loadConfig();
  const v = opplanMod.validate(s.opplan || {});
  const target = s.target;
  const targetInScope = target ? netMod.inScope(netMod.normalizeHost(target)) : false;
  const status = {
    scope: s.scope,
    target,
    targetInScope,
    opplanValid: v.ok,
    opplanApproved: s.opplan?.status === 'aprobado',
    authorized: s.opplan?.autorizado === true,
  };
  console.log(JSON.stringify(status, null, 2));
  if (!v.ok) fail(`OPPLAN incompleto: ${v.pendientes.join(', ')}`);
  if (s.opplan?.status !== 'aprobado') fail('OPPLAN no aprobado: aprueba el plan antes de ejecutar.');
  if (!targetInScope) fail(`Target ${target} fuera del scope.`);
  console.log('✓ Configuración válida (sin tráfico de red)');
  process.exit(0);
}

if (args.includes('--dry-run')) {
  loadConfig();
  const s = getSession();
  const ctx = {
    session: s,
    save: () => {},
    addFinding: () => {},
    setArtifact: () => {},
    setPhase: () => {},
  };
  console.log('Simulando pipeline en dry-run (sin peticiones)...');
  for (const phase of pipeline.getPhases()) console.log(`- ${phase.id}: SIMULADO`);
  process.exit(0);
}

const exportIdx = args.indexOf('--export-report');
if (exportIdx !== -1) {
  const file = args[exportIdx + 1];
  if (!file) fail('Falta el archivo JSON del reporte tras --export-report');
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const html = reportMod.writeReportHtml(process.cwd(), json);
  console.log(`✓ Exportado: ${html}`);
  process.exit(0);
}

console.log(`Uso: node backend/headless.js --check | --dry-run | --export-report FILE`);
process.exit(2);
