'use strict';

// ============================================================================
// Contrato de lib/osint-findings.js sobre DB temporal (KNK_DB en tmpdir):
// parser por herramienta, deduplicación estable, evidencia con hash y export.
// Sin red y sin ejecutar herramientas reales.
// Ejecutar: node backend/osint-findings.test.js  (o npm run test:osint-findings)
// ============================================================================

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Entorno hermético ANTES de requerir módulos con DB
process.env.KNK_DB = path.join(os.tmpdir(), `knk-osint-findings-${process.pid}.db`);
process.env.KNK_OFFLINE = '1';
process.env.KNK_API_TOKEN = `test-${crypto.randomBytes(8).toString('hex')}`;

const findingsMod = require('./lib/osint-findings');
const db = require('./db');

(async () => {
  await db.initDB();

  // ── 1. Parser: theHarvester (emails + subdominios reales del target) ──────
  const thOut = `
[*] Target: example.com
contact@example.com
info@example.com
sub.example.com
api.example.com
www.google.com
https://accounts.google.com
`;
  const th = findingsMod.parseOutput('theharvester', thOut, { target: 'example.com' });
  const thEmails = th.filter((f) => f.type === 'osint.email').map((f) => f.value);
  const thHosts = th.filter((f) => f.type === 'osint.subdomain').map((f) => f.value);
  assert.ok(thEmails.includes('contact@example.com') && thEmails.includes('info@example.com'), 'emails del target');

  // ── 1b. Banner ajeno: emails de otros dominios NUNCA se ingieren ──────────
  const thBanner = 'Coded by Christian Martorella\ncmartorella@edge-security.com\ncontacto@example.com\ninfo@mail.example.com\nwww.example.com\nedge-security.com';
  const thB = findingsMod.parseOutput('theharvester', thBanner, { target: 'example.com' });
  const thBVals = thB.map((x) => x.type + ':' + x.value);
  assert.ok(!thBVals.includes('osint.email:cmartorella@edge-security.com'), 'email del banner ajeno excluido');
  assert.ok(!thBVals.includes('osint.subdomain:edge-security.com'), 'dominio del email ajeno excluido de subdominios');
  assert.ok(thBVals.includes('osint.email:contacto@example.com') && thBVals.includes('osint.email:info@mail.example.com'), 'emails del target (dominio y subdominio) incluidos');
  assert.ok(thHosts.includes('sub.example.com') && thHosts.includes('api.example.com'), 'subdominios del target');
  assert.ok(!thHosts.includes('google.com') && !thHosts.includes('accounts.google.com'), 'no cuela dominios de fuentes');

  // ── 2. Parser: sherlock (solo URLs del usuario buscado) ───────────────────
  const shOut = `[*] Checking username johndoe on:
[+] GitHub: https://www.github.com/johndoe
[+] Reddit: https://www.reddit.com/user/johndoe
[-] Twitter: https://twitter.com/johndoe
[+] PlataformaAjena: https://plataforma.com/otrouser`;
  const sh = findingsMod.parseOutput('sherlock', shOut, { target: 'johndoe' });
  const shUrls = sh.filter((f) => f.type === 'osint.account').map((f) => f.value);
  assert.ok(shUrls.includes('https://www.github.com/johndoe'), 'cuenta GitHub del usuario');
  assert.ok(!shUrls.includes('https://plataforma.com/otrouser'), 'no cuela cuentas de otros usuarios');

  // ── 2b. Parser: recon-ng (hackertarget: Host + Ip_Address) ────────────────
  const rnOut = `[i] Module loaded: recon/domains-hosts/hackertarget
EXAMPLE.COM
-----------
[*] Country: None
[*] Host: www.example.com
[*] Ip_Address: 104.20.23.154
[*] --------------------------------------------------
[*] Host: api.example.com
[*] Ip_Address: 93.184.216.34
[*] Host: example.com
[*] Ip_Address: 93.184.216.34
[*] Host: www.google.com
[*] Ip_Address: 142.250.200.68

-------
SUMMARY
-------
[*] 3 total (3 new) hosts found.`;
  const rn = findingsMod.parseOutput('recon-ng', rnOut, { target: 'example.com' });
  const rnHosts = rn.map((x) => x.value);
  assert.deepStrictEqual(rnHosts.sort(), ['api.example.com', 'www.example.com'], 'recon-ng: solo subdominios del target');
  const rnApi = rn.find((x) => x.value === 'api.example.com');
  assert.strictEqual(rnApi.meta.ip, '93.184.216.34', 'IP capturada en meta');
  assert.strictEqual(rnApi.meta.source, 'hackertarget');
  assert.ok(!rnHosts.includes('www.google.com'), 'no cuela hosts de otros dominios');

  // ── 3. Parser: amass (subdominio por línea) ───────────────────────────────
  const amOut = 'sub.example.com\napi.example.com\ndomain.invalid\n*.wild.example.com';
  const am = findingsMod.parseOutput('amass', amOut, { target: 'example.com' });
  const amHosts = am.map((f) => f.value);
  assert.deepStrictEqual(amHosts.sort(), ['api.example.com', 'sub.example.com', 'wild.example.com'], 'amass: wildcards normalizados al host base');

  const phone = findingsMod.parseOutput('phoneinfoga', JSON.stringify([{ number: '+1 202-555-0100', country: 'US', carrier: 'Test' }]), { target: 'test' });
  assert.deepStrictEqual(phone.map((f) => f.value), ['+1 202-555-0100'], 'phoneinfoga: número JSON');
  assert.strictEqual(phone[0].meta.country, 'US');

  // ── 4. Ingesta + dedup: 1ª vez crea, 2ª vez actualiza ─────────────────────
  const first = await findingsMod.ingest('sherlock', 'johndoe', shOut);
  assert.strictEqual(first.created, 2, 'primera ingesta crea 2 cuentas');
  assert.strictEqual(first.updated, 0);
  assert.ok(first.evidence && first.evidence.sha256 && first.evidence.sha256.length === 64, 'evidencia con SHA-256');
  assert.ok(fs.existsSync(first.evidence.file), 'fichero de evidencia existe');

  const second = await findingsMod.ingest('sherlock', 'johndoe', shOut);
  assert.strictEqual(second.created, 0, 're-ingesta no duplica');
  assert.strictEqual(second.updated, 2, 're-ingesta actualiza los existentes');
  assert.strictEqual(second.duplicates, 0);

  // El hallazgo acumula ocurrencias
  const after = db.getFindings(first.session).filter((f) => f.details && f.details.osint);
  assert.strictEqual(after.length, 2, 'sigue habiendo 2 hallazgos, no 4');
  assert.ok(after.every((f) => f.details.osint.occurrences === 2), 'occurrences=2 tras re-ingesta');
  assert.ok(after.every((f) => Array.isArray(f.details.evidence) && f.details.evidence.length >= 1), 'evidencia enlazada al hallazgo');

  // ── 5. Export JSON / CSV / MD ──────────────────────────────────────────────
  const json = findingsMod.exportFindings({ sessionId: first.session, format: 'json' });
  const jsonData = JSON.parse(json.body);
  assert.strictEqual(jsonData.count, 2);
  assert.ok(jsonData.findings.every((f) => f.tool === 'sherlock' && f.occurrences === 2));

  const csv = findingsMod.exportFindings({ sessionId: first.session, format: 'csv' });
  assert.ok(csv.body.startsWith('id,tool,type,value,target,occurrences,firstSeenAt,lastSeenAt,severity'), 'cabecera CSV');
  assert.ok(csv.body.includes('"https://www.github.com/johndoe"'), 'fila CSV escapada');

  const md = findingsMod.exportFindings({ sessionId: first.session, format: 'md' });
  assert.ok(md.body.includes('| id | tool | type | value | target | occ | severity |'), 'tabla MD');

  // ── 6. Limpieza de evidencia temporal del test ────────────────────────────
  try { fs.unlinkSync(first.evidence.file); } catch {}
  try { fs.unlinkSync(second.evidence.file); } catch {}
  try { fs.unlinkSync(process.env.KNK_DB); } catch {}
  try { fs.unlinkSync(process.env.KNK_DB + '-wal'); } catch {}
  try { fs.unlinkSync(process.env.KNK_DB + '-shm'); } catch {}

  console.log('osint-findings: OK — parser (theHarvester/Sherlock/Amass), dedup estable, evidencia SHA-256 y export JSON/CSV/MD');
})().catch((e) => { console.error('osint-findings: FAIL', e.message); process.exitCode = 1; });
