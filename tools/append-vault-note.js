'use strict';
// tools/append-vault-note.js — añade una entrada al final de Estado-del-producto.md
// Uso: node tools/append-vault-note.js "TITULO" "bullet 1" "bullet 2" ...
// Los bullets se leen de un fichero UTF-8 (uno por línea) para evitar
// problemas de quoting/escapes en la línea de comandos de Windows.
const fs = require('fs');
const path = require('path');

const [title, bulletsFile] = process.argv.slice(2);
if (!title || !bulletsFile) {
  console.error('uso: node tools/append-vault-note.js "TITULO" <fichero-bullets>');
  console.error('  <fichero-bullets>: UTF-8, una línea = un bullet');
  process.exit(1);
}
const bullets = fs.readFileSync(bulletsFile, 'utf8')
  .split(/\r?\n/)
  .map(l => l.trim())
  .filter(Boolean);
if (bullets.length === 0) {
  console.error('sin bullets en', bulletsFile);
  process.exit(1);
}
const file = path.join(__dirname, '..', '..', 'vault-knklinux', '01-Producto', 'Estado-del-producto.md');
const entry = '\n## ' + title + '\n\n' + bullets.map(b => '- ' + b).join('\n') + '\n';
fs.appendFileSync(file, entry, 'utf8');
console.log('entrada añadida a', path.basename(file), '(' + bullets.length + ' bullets)');
