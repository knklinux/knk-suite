'use strict';

// ============================================================================
// KNK SUITE v2.1 — Test en vivo, módulo por módulo (requiere red)
// Solo usa servicios públicos e inofensivos (crt.sh, yeswehack.com, example.com).
// Uso: node backend/test-live.js
// ============================================================================

const net = require('./lib/net');
const recon = require('./lib/recon');
const scanner = require('./lib/scanner');
const parser = require('./lib/program-parser');

let failures = 0;
function check(name, cond, extra = '') {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
}

(async () => {
  // ── 1. fetch a servicio de confianza (recon) con scope definido ─────────
  net.setScope(['*.example.com']);
  let r = await net.fetch('https://crt.sh/?q=%25.example.com&output=json', { timeoutMs: 20000 });
  check('net.fetch → crt.sh permitido (trusted service)', r.ok || r.status > 0, `status=${r.status} err=${r.error || ''}`);

  // ── 2. SSRF: loopback siempre bloqueado ──────────────────────────────────
  r = await net.fetch('http://127.0.0.1/');
  check('net.fetch → 127.0.0.1 bloqueado (SSRF)', r.blocked === true || r.outOfScope === true, `blocked=${r.blocked} err=${r.error || ''}`);

  // ── 3. fetch a host fuera de scope bloqueado ─────────────────────────────
  r = await net.fetch('https://evil.example.net/');
  check('net.fetch → evil.example.net bloqueado (out of scope)', r.outOfScope === true, `outOfScope=${r.outOfScope}`);

  // ── 4. fetch a target EN scope ───────────────────────────────────────────
  net.setScope(['example.com', 'www.example.com']);
  r = await net.fetch('https://www.example.com/', { timeoutMs: 20000 });
  check('net.fetch → www.example.com OK (en scope)', r.ok, `status=${r.status} err=${r.error || ''}`);

  // ── 5. recon.subdomains (crt.sh real) ────────────────────────────────────
  const subs = await recon.subdomains('example.com');
  check('recon.subdomains → resultados reales de crt.sh', Array.isArray(subs) && subs.length > 0, `${subs.length} subdominios`);

  // ── 6. scanner.securityHeaders (target real) ─────────────────────────────
  const hdrs = await scanner.securityHeaders('https://example.com');
  check('scanner.securityHeaders → headers analizados', hdrs.status > 0 && Array.isArray(hdrs.present), `status=${hdrs.status} presentes=${hdrs.present.length} ausentes=${hdrs.missing.length}`);

  // ── 7. scanner.corsProbe (target real) ───────────────────────────────────
  const cors = await scanner.corsProbe('https://example.com');
  check('scanner.corsProbe → respuesta analizada', cors.status > 0, `acao=${cors.acao.slice(0, 40)}`);

  // ── 8. parser de programas por URL (YesWeHack real) ──────────────────────
  const parsed = await parser.parseProgram('https://yeswehack.com/programs');
  check('parser.parseProgram → YesWeHack sin error', !parsed.error, `source=${parsed.source} error=${parsed.error || ''}`);
  check('parser.parseProgram → detecta plataforma yeswehack', parsed.source === 'yeswehack', `source=${parsed.source}`);

  // ── 9. parser HackerOne → modo guiado (no scrapea) ───────────────────────
  const h1 = parser.parseHackerOne('https://hackerone.com/tiktok');
  check('parser.parseHackerOne → autoParsed=false (SPA)', h1.autoParsed === false, `programName=${h1.programName}`);

  console.log(failures === 0 ? '\n✅ Live test: todos los módulos OK' : `\n❌ Live test: ${failures} fallos`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
