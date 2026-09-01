'use strict';

const assert = require('assert');
const net = require('./lib/net');
const opplan = require('./lib/opplan');
const gates = require('./lib/gates');
const report = require('./lib/report');
const hunt = require('./lib/hunt');
const hackerone = require('./lib/hackerone');
const bizlogic = require('./lib/bizlogic');
const playbook = require('./lib/playbook');
const cameras = require('./lib/cameras');
const engagement = require('./lib/engagement');
const runbooks = require('./lib/runbooks');
const cti = require('./lib/cti');
const assets = require('./lib/assets');
const purpleteam = require('./lib/purpleteam');

function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1; }
}

net.setScope(['*.example.com']);
net.setOutOfScope([]);
test('scope requires an explicit matching asset', () => {
  assert.strictEqual(net.inScope('api.example.com'), true);
  assert.strictEqual(net.inScope('example.com'), false);
  assert.strictEqual(net.inScope('evil.example.net'), false);
});
test('private destinations are blocked', () => {
  assert.strictEqual(net.isPrivateHost('127.0.0.1'), true);
  assert.strictEqual(net.isPrivateHost('169.254.169.254'), true);
  assert.strictEqual(net.isPrivateHost('localhost'), true);
  assert.strictEqual(net.inScope('127.0.0.1'), false);
});
test('out-of-scope rules override in-scope wildcards', () => {
  net.setOutOfScope(['admin.example.com']);
  assert.strictEqual(net.inScope('admin.example.com'), false);
  assert.strictEqual(net.inScope('www.example.com'), true);
  net.setOutOfScope([]);
});

test('www hostname matches wildcard scope (normalizeHost no longer strips www)', () => {
  net.setScope(['*.example.com']);
  assert.strictEqual(net.inScope('www.example.com'), true);
  assert.strictEqual(net.inScope('api.example.com'), true);
  assert.strictEqual(net.inScope('example.com'), false); // apex no casa con wildcard
  net.setScope(['example.com']);
  assert.strictEqual(net.inScope('example.com'), true);
  assert.strictEqual(net.inScope('www.example.com'), false); // hostname exacto
});

test('trusted services (parser/recon) are recognized regardless of scope', () => {
  assert.strictEqual(net.isTrustedService('crt.sh'), true);
  assert.strictEqual(net.isTrustedService('yeswehack.com'), true);
  assert.strictEqual(net.isTrustedService('web.archive.org'), true);
  assert.strictEqual(net.isTrustedService('evil.example.net'), false);
});
test('OPPLAN requires authorization and scope', () => {
  const invalid = opplan.validate(opplan.blank());
  assert.strictEqual(invalid.ok, false);
  const valid = opplan.blank();
  valid.nombre = 'Local test'; valid.objetivo = 'Authorized local validation'; valid.scope = ['example.com']; valid.autorizado = true;
  assert.strictEqual(opplan.validate(valid).ok, true);
});
test('OPPLAN inScope es idéntico a net.js (exacto, wildcard, www, apex)', () => {
  const p = opplan.blank();
  p.scope = ['*.example.com', 'exact.example.org'];
  // wildcard: subdominios SÍ, apex NO
  assert.strictEqual(opplan.inScope(p, 'www.example.com'), true);
  assert.strictEqual(opplan.inScope(p, 'api.example.com'), true);
  assert.strictEqual(opplan.inScope(p, 'example.com'), false);
  // exacto: solo ese host (sin subdominios, sin www mágico)
  assert.strictEqual(opplan.inScope(p, 'exact.example.org'), true);
  assert.strictEqual(opplan.inScope(p, 'sub.exact.example.org'), false);
  assert.strictEqual(opplan.inScope(p, 'www.exact.example.org'), false);
  // fuera de scope
  assert.strictEqual(opplan.inScope(p, 'evil.example.net'), false);
  assert.strictEqual(opplan.inScope(p, ''), false);
});
test('report readiness rejects placeholder evidence', () => {
  const result = report.generateReport({ title: 'Test finding', inScope: false });
  assert.strictEqual(result.allowed, false);
});
test('SSRF gate rejects missing internal-target proof', () => {
  const result = gates.ssrfChain({ urlControlled: true, serverFetches: true, internalTarget: false, impactShown: true, reproducible: true, inScope: true });
  assert.strictEqual(result.sendable, false);
});

test('hunt parses IoCs (IPs, hashes, domains)', () => {
  const iocs = hunt.parseIocs('C2 at 203.0.113.5 and bad.example.com hash d41d8cd98f00b204e9800998ecf8427e contact bad@example.com https://evil.example/x');
  assert.ok(iocs.ips.includes('203.0.113.5'));
  assert.ok(iocs.domains.includes('bad.example.com'));
  assert.ok(iocs.hashes.includes('d41d8cd98f00b204e9800998ecf8427e'));
  assert.ok(iocs.emails.includes('bad@example.com'));
  assert.strictEqual(iocs.total >= 4, true);
});

test('hunt detects IoCs in logs with line numbers', () => {
  const iocs = hunt.parseIocs('203.0.113.5');
  const result = hunt.huntIocs('line one\nrequest from 203.0.113.5 /login\nline three', iocs);
  assert.strictEqual(result.total_matches, 1);
  assert.strictEqual(result.matches[0].line, 2);
});

test('hunt flags brute force and probes with MITRE mapping', () => {
  const log = [
    '[01/Jan/2026:00:00:01] failed password for user admin from 203.0.113.9',
    '[01/Jan/2026:00:00:02] failed password for user admin from 203.0.113.9',
    '[01/Jan/2026:00:00:03] failed password for user admin from 203.0.113.9',
    '[01/Jan/2026:00:00:04] failed password for user admin from 203.0.113.9',
    '[01/Jan/2026:00:00:05] failed password for user admin from 203.0.113.9',
    'GET /../../etc/passwd HTTP/1.1 404',
  ].join('\n');
  const result = hunt.huntAnomalies(log, { bruteThreshold: 5 });
  const mitre = hunt.mapToMitre(result.alerts);
  assert.ok(result.alerts.some(a => a.title.includes('fuerza bruta')));
  assert.ok(mitre.some(m => m.id === 'T1110'));
});

test('hackerone scope text parser extracts in/out scope', () => {
  const parsed = hackerone.parseScopeText('*.example.com\nexample.com\nhttps://app.example.org\n!admin.example.com');
  assert.ok(parsed.inScope.includes('*.example.com'));
  assert.ok(parsed.inScope.includes('app.example.org'));
  assert.ok(parsed.outOfScope.includes('admin.example.com'));
});

test('hackerone draft includes required H1 sections', () => {
  const draft = hackerone.buildDraft({ asset: 'example.com', tipo: 'XSS', pasos: ['uno', 'dos', 'tres'] });
  assert.ok(draft.includes('## Summary'));
  assert.ok(draft.includes('## Steps To Reproduce'));
  assert.ok(draft.includes('## Impact'));
});

test('bizlogic plan includes categories and account requirements', () => {
  const plan = bizlogic.planTests({ target: 'example.com', scope: ['*.example.com'] });
  assert.ok(plan.categories.length >= 7);
  assert.ok(plan.counts.oneAccount > 0);
  assert.ok(plan.counts.twoAccounts > 0);
  assert.ok(plan.universal.length === 8);
  const auth = plan.categories.find(c => c.id === 'auth');
  assert.strictEqual(auth.accounts, 'two');
  const price = plan.categories.find(c => c.id === 'price');
  assert.strictEqual(price.accounts, 'one');
});

test('bizlogic gate requires real impact and repro', () => {
  const v = bizlogic.bizlogicChain({ inScope: true, impactReal: false, reproducibleCount: 1 });
  assert.strictEqual(v.sendable, false);
  const ok = bizlogic.bizlogicChain({ inScope: true, impactReal: true, reproducibleCount: 2, testAccountsOnly: true, noDuplicate: true, notDisqualifier: true, serverSide: true });
  assert.strictEqual(ok.sendable, true);
});

test('playbook generates ordered phases from pipeline artifacts', () => {
  const pb = playbook.generatePlaybook({
    target: 'app.example.com',
    scope: ['*.example.com'],
    subdomains: ['api.example.com', 'old.example.com'],
    urls: ['https://api.example.com/user?id=1'],
    tech: ['WordPress', 'Cloudflare'],
    includeCameras: true,
  });
  assert.ok(pb.phases.length >= 6);
  assert.ok(pb.phases.some(p => p.id === 'bizlogic'));
  assert.ok(pb.phases.some(p => p.id === 'cameras'));
  const hunt = pb.phases.find(p => p.id === 'hunt');
  assert.ok(hunt.steps.some(s => /wp-json|xmlrpc/i.test(s))); // tech-specific
  const md = playbook.renderPlaybook(pb);
  assert.ok(md.includes('Playbook de explotación manual'));
});

test('camera plan and gate enforce scope/authorization', () => {
  const plan = cameras.planTests({ target: 'cam.example.com', scope: ['cam.example.com'] });
  assert.ok(plan.categories.length >= 4);
  const v = cameras.cameraChain({ inScope: true, authorized: true, impactReal: true, reproducibleCount: 2, safeTesting: true, noDuplicate: true, notDisqualifier: true });
  assert.strictEqual(v.sendable, true);
  const bad = cameras.cameraChain({ inScope: false, authorized: true });
  assert.strictEqual(bad.sendable, false);
});

test('engagement report aggregates findings by severity', () => {
  const rep = engagement.generateEngagementReport({
    target: 'app.example.com',
    findings: [{ severity: 'high', summary: 'XSS' }, { severity: 'low', summary: 'Header' }],
    assets: [{ hostname: 'api.example.com' }],
  });
  assert.strictEqual(rep.json.counts.high, 1);
  assert.strictEqual(rep.json.counts.low, 1);
  assert.ok(rep.markdown.includes('Resumen ejecutivo'));
  assert.ok(rep.fileBase.length > 0);
});

test('runbooks provide containment for brute force and SSRF', () => {
  const bf = runbooks.runbookFor('brute_force');
  assert.ok(bf.containment.some(s => /bloquear/i.test(s)));
  const ssrf = runbooks.runbookFor('SSRF');
  assert.ok(ssrf.name.includes('request forgery'));
  assert.strictEqual(runbooks.runbookFor('unknown_type_xyz'), null);
});

test('CTI ingests STIX and plain IoC feeds', () => {
  const stix = JSON.stringify({ objects: [{ type: 'indicator', pattern: "[ipv4-addr:value = '198.51.100.7']" }, { type: 'domain-name', value: 'evil.example.com' }] });
  const parsed = cti.parseFeed(stix, 'stix');
  assert.ok(parsed.iocs.ips.includes('198.51.100.7'));
  assert.ok(parsed.iocs.domains.includes('evil.example.com'));
  const plain = cti.parseFeed('203.0.113.9\nd41d8cd98f00b204e9800998ecf8427e');
  assert.ok(plain.iocs.ips.includes('203.0.113.9'));
  assert.strictEqual(plain.format, 'ioc');
});

test('asset inventory CRUD with statuses', () => {
  const session = { artifacts: {} };
  const a = assets.addAsset(session, { hostname: 'api.example.com', status: 'testing' });
  assert.strictEqual(a.status, 'testing');
  const updated = assets.updateAsset(session, a.id, { status: 'vulnerable' });
  assert.strictEqual(updated.status, 'vulnerable');
  assert.strictEqual(assets.summary(session).byStatus.vulnerable, 1);
  assert.throws(() => assets.updateAsset(session, a.id, { status: 'nope' }));
});

test('db session round-trip never double-encodes JSON fields', () => {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knk-db-'));
  const origDb = process.env.KNK_DB;
  process.env.KNK_DB = path.join(tmpDir, 'test.db');
  delete require.cache[require.resolve('./db')];
  const db = require('./db');
  const s1 = db.getOrCreateSession();
  // Simular el round-trip que antes doble-encodificaba: pasar strings crudos
  const s2 = { ...s1, scope: JSON.stringify(['*.example.com']), opplan: JSON.stringify({ nombre: 'Test', status: 'borrador' }), artifacts: JSON.stringify({ a: 1 }) };
  db.saveSession(s2.id, s2);
  const s3 = db.getOrCreateSession();
  const scope = JSON.parse(s3.scope);
  assert.ok(Array.isArray(scope) && scope.length === 1);
  assert.strictEqual(JSON.parse(s3.opplan).nombre, 'Test');
  delete require.cache[require.resolve('./db')];
  if (origDb) process.env.KNK_DB = origDb; else delete process.env.KNK_DB;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('curated programs directory loads with required fields', () => {
  const fs = require('fs');
  const path = require('path');
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'programs.json'), 'utf8'));
  assert.ok(data.candidatos.length >= 4);
  for (const p of data.candidatos) {
    assert.ok(p.url && p.plataforma && p.nombre && Array.isArray(p.alineacion));
    assert.ok(p.alineacion.length > 0);
  }
});

test('purple team maps findings to Sigma detections', () => {
  const d = purpleteam.detectionFor({ type: 'sqli' });
  assert.ok(d.sigma.includes('union select'));
  assert.ok(d.validate.length >= 2);
  const c2 = purpleteam.detectionFor({ type: 'c2' });
  assert.ok(c2.sigma.includes('Beaconing'));
  assert.strictEqual(purpleteam.detectionFor({ type: 'zzz' }), null);
});

test('camera probe refuses out-of-scope and unauthenticated hosts', async () => {
  const cameras = require('./lib/cameras');
  cameras.setNetMod(net);
  const noAuth = await cameras.probeRtsp('127.0.0.1', { authorized: false });
  assert.strictEqual(noAuth.error, 'not_authorized');
  const oos = await cameras.probeRtsp('evil.example.net', { authorized: true });
  assert.strictEqual(oos.error, 'out_of_scope');
});

test('accounts vault stores and lists A/B identities', () => {
  const os = require('os');
  const path = require('path');
  const accounts = require('./lib/accounts');
  const orig = process.env.HOME;
  const tmp = require('fs').mkdtempSync(path.join(os.tmpdir(), 'knk-vault-'));
  process.env.HOME = tmp;
  delete require.cache[require.resolve('./lib/accounts')];
  const fresh = require('./lib/accounts');
  fresh.addAccount({ program: 'testprog', label: 'Cuenta A (admin)', username: 'a@test.dev', role: 'admin' });
  fresh.addAccount({ program: 'testprog', label: 'Cuenta B (user)', username: 'b@test.dev', role: 'user' });
  const list = fresh.listAccounts('testprog');
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].role, 'admin');
  require('fs').rmSync(tmp, { recursive: true, force: true });
  process.env.HOME = orig;
});

test('report html export and diff work', () => {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knk-report-'));
  const before = { titulo: 'A', impacto: 'x' };
  const after = { titulo: 'A', impacto: 'y', extra: 1 };
  const diff = report.diffReports(before, after);
  assert.ok(diff.changed.includes('impacto'));
  assert.ok(diff.added.includes('extra'));
  const file = report.writeReportHtml(dir, { titulo: 'Test', pasos: ['a'], evidencia: ['e'] });
  assert.ok(fs.existsSync(file));
  fs.rmSync(dir, { recursive: true, force: true });
});

if (!process.exitCode) console.log('Smoke tests completed successfully.');
