#!/usr/bin/env node
// ci/repo-hygiene.mjs — Guardián de higiene del árbol del repo
//
// Origen: la raíz acumulaba artefactos de ejecución local — backend.log,
// backend-anon.log, server.log… — que en su día llegaron a trackearse
// (se limpiaron del índice) y README.txt, sustituido por README.md como
// canónico. Este check falla si vuelven a aparecer EN LA RAÍZ: en local
// antes del commit (hook) y en CI como backstop del árbol completo.
//
// Reglas (solo raíz: los logs dentro de evidencia-poc/ o backend/ son
// legítimos, y evidencia-poc/ además ya está gitignored):
//   * *.log      → logs de ejecución: cubiertos por *.log en .gitignore,
//                  jamás versionados
//   * README.txt → el README canónico es README.md
//
// Uso:
//   node ci/repo-hygiene.mjs --staged   (hook pre-commit: solo lo indexado)
//   node ci/repo-hygiene.mjs --all      (backstop de CI: todo el árbol)
//
// Si el check bloquea tu commit: el fichero NO debe entrar. Si es un log
// de ejecución, déjalo sin trackear (*.log ya lo ignora); si es un README
// de carpeta, el convenio del repo es minúsculas: README.md.

import { execFileSync } from 'node:child_process';

const MODE = process.argv.includes('--all') ? 'all'
  : process.argv.includes('--staged') ? 'staged'
  : (console.error('Uso: node ci/repo-hygiene.mjs --staged | --all'), process.exit(2));

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
}

// ── Reglas (solo ficheros EN LA RAÍZ del repo) ─────────────────────────────
const RULES = [
  { test: (p) => /^[^/]+\.log$/i.test(p), why: 'log de ejecución — *.log ya está en .gitignore, no se versiona' },
  { test: (p) => /^readme\.txt$/i.test(p), why: 'el README canónico es README.md' },
];

let files;
if (MODE === 'staged') {
  // Añadidos/copiados/renombrados al index: lo que este commit INTRODUCIRÍA.
  files = git('diff', '--cached', '--name-only', '--diff-filter=ACR')
    .split('\n').filter(Boolean);
} else {
  files = git('ls-files').split('\n').filter(Boolean);
}

const offenders = [];
for (const f of files) {
  const rule = RULES.find((r) => r.test(f));
  if (rule) offenders.push({ f, why: rule.why });
}

if (offenders.length) {
  console.error(`\n✗ repo-hygiene: ${offenders.length} fichero(s) prohibido(s) en la raíz:\n`);
  for (const { f, why } of offenders) {
    console.error(`  ${f}  — ${why}`);
  }
  console.error('\nFuera del commit: git rm --cached <fichero> (si ya estaba indexado)\n' +
    'y bórralo o déjalo solo en disco (los *.log ya caen bajo .gitignore).\n');
  process.exit(1);
}

console.log(`repo-hygiene: OK (${MODE === 'staged' ? 'indexado' : 'árbol completo'}, ${files.length} ficheros, 0 infracciones)`);
