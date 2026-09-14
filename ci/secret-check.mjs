#!/usr/bin/env node
// ci/secret-check.mjs — Guardián de pre-commit y CI contra secretos
//
// Origen: la práctica del repo (cookie jars de bug bounty en evidencia-poc/,
// config.json con windyApiKey, ~/.knk-suite/api-token) exige que NADA de eso
// llegue a un commit. Este check escanea los ficheros que se van a commitear
// y falla si encuentra tokens, cookies de sesión, claves API o credenciales
// embebidas. Reglas por PATRÓN, sin dependencias, en milisegundos.
//
// Uso:
//   node ci/secret-check.mjs --staged   (hook pre-commit: solo lo indexado)
//   node ci/secret-check.mjs --all      (backstop de CI: todo el árbol)
//
// Excepciones (por línea): añade `knk-secret-ok` en la línea y el check la
// ignora. Úsalo solo para datos de prueba claramente falsos.
//
// Si el check bloquea tu commit: el secreto NO debe entrar. Sácalo del
// fichero, ponlo en config.json (gitignored) o en una variable de entorno.

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODE = process.argv.includes('--all') ? 'all'
  : process.argv.includes('--staged') ? 'staged'
  : (console.error('Uso: node ci/secret-check.mjs --staged | --all'), process.exit(2));

// ── Reglas ──────────────────────────────────────────────────────────────────
// Cada regla: id, regex por línea y descripción. Conservadoras para evitar
// falsos positivos en un repo lleno de metodología de bug bounty.
const RULES = [
  {
    id: 'github-token',
    re: /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/,
    what: 'token de GitHub (ghp_/github_pat_)',
  },
  {
    id: 'openai-style-key',
    re: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/,
    what: 'clave API estilo sk-… (OpenAI/Anthropic)',
  },
  {
    id: 'aws-access-key',
    re: /\bAKIA[0-9A-Z]{16}\b/,
    what: 'AWS access key (AKIA…)',
  },
  {
    id: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/,
    what: 'JWT (eyJ…)',
  },
  {
    id: 'openai-session-cookie',
    re: /(?:__Secure-next-auth\.session-token\s*[=:]\s*["']?[A-Za-z0-9%_.~-]{40,})|sess-[A-Za-z0-9_-]{30,}/,
    what: 'cookie de sesión de ChatGPT/OpenAI CON VALOR',
  },
  {
    id: 'bearer-value',
    re: /\bBearer\s+[A-Za-z0-9._-]{30,}/,
    what: 'Bearer token embebido',
  },
  {
    id: 'knk-api-token',
    re: /\b[a-f0-9]{48}\b/,
    what: 'token KNK (hex-48, formato ~/.knk-suite/api-token)',
  },
  {
    id: 'private-key',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----\s*\n[A-Za-z0-9+/=\s]{80,}/m,
    what: 'clave privada (cabecera + cuerpo base64)',
  },
  {
    id: 'url-credentials',
    re: /\bhttps?:\/\/[^\s/"'@:]+:[^\s/@]{6,}@/,
    what: 'URL con usuario:contraseña',
  },
  {
    id: 'apikey-assignment',
    re: /["']?(?:api[_-]?key|apikey|client[_-]?secret|auth[_-]?token)["']?\s*[:=]\s*["'][A-Za-z0-9+/_-]{24,}["']/i,
    what: 'asignación de api key/secret con valor literal',
  },
  {
    id: 'set-cookie-header',
    re: /^\s*set-cookie:\s*.+\b(?:session|token|auth)/i,
    what: 'cabecera Set-Cookie de sesión',
  },
  {
    id: 'netscape-cookie-jar',
    re: /^# (?:Netscape )?HTTP Cookie File/m,
    what: 'jar de cookies (formato Netscape)',
  },
];

// Ficheros cuyo contenido entero se salta (blobs generados que dan falsos
// positivos) y extensiones binarias.
const SKIP_PATH = /(?:^|\/)package-lock\.json$|(?:^|\/)Cargo\.lock$/;
const BINARY_EXT = /\.(png|jpe?g|gif|ico|icns|webp|pdf|zip|gz|7z|exe|dll|so|dylib|woff2?|ttf|eot|mp3|mp4|ts|db|sqlite3?|der|pem)$/i;
// Un .pem de CA pública no es un secreto, pero por defecto se escanea:
// si da problemas, se marca la línea concreta con knk-secret-ok.

function git(args) {
  return execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function isIgnored(rel) {
  try { git(['check-ignore', '--quiet', rel]); return true; } catch { return false; }
}

function listFiles() {
  if (MODE === 'all') {
    return git(['ls-files', '-z']).split('\0').filter(Boolean);
  }
  // staged: solo ficheros indexados que van a entrar en el commit
  const out = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']);
  return out.split('\0').filter(Boolean);
}

const findings = [];
let scanned = 0;
let skippedBinary = 0;

for (const rel of listFiles()) {
  if (SKIP_PATH.test(rel.replace(/\\/g, '/'))) continue;
  if (BINARY_EXT.test(rel.replace(/\\/g, '/'))) { skippedBinary++; continue; }
  if (isIgnored(rel)) continue; // un fichero gitignored nunca entra en un commit

  let buf;
  try { buf = readFileSync(join(ROOT, rel)); } catch { continue; }
  // heurística binaria: byte NUL en los primeros 8 KB
  if (buf.subarray(0, 8192).includes(0)) { skippedBinary++; continue; }
  const text = buf.toString('utf8');
  const lines = text.split('\n');
  scanned++;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('knk-secret-ok')) continue;
    for (const rule of RULES) {
      const hit = rule.re instanceof RegExp && rule.re.flags.includes('m')
        ? rule.re.test(text) // reglas multilinea: una vez por fichero
        : rule.re.test(line);
      if (hit) {
        findings.push({ rel, line: i + 1, rule: rule.id, what: rule.what, snippet: line.trim().slice(0, 90) });
        if (rule.re.flags.includes('m')) break; // no repetir regla multilinea por línea
      }
    }
  }
}

if (findings.length) {
  console.error(`\n✘ SECRETOS DETECTADOS en ${MODE === 'staged' ? 'lo indexado' : 'el árbol'} (${findings.length}):\n`);
  const seen = new Set();
  for (const f of findings) {
    const key = `${f.rel}:${f.rule}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.error(`  ${f.rel}:${f.line}  [${f.rule}] ${f.what}`);
    console.error(`    → ${f.snippet}`);
  }
  console.error(`
REMEDIO:
  1. Quita el secreto del fichero: va a config.json (gitignored) o a un env.
  2. Si es un valor de PRUEBA claramente falso, añade 'knk-secret-ok' en la línea.
  3. Si un secreto real YA se commiteó, rótalo: no basta con borrarlo (quedó en el histórico).
`);
  process.exit(1);
}

console.log(`secret-check: OK — ${scanned} ficheros escaneados (${skippedBinary} binarios saltados), 0 secretos`);
