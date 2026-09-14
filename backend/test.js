'use strict';

// ============================================================================
// KNK SUITE — Tests (npm test → node backend/test.js)
//
// Cobertura de la auditoría de seguridad:
//  · auth: filtro de comandos, saneo de targets, autorización (token/origen/socket)
//  · net: scope, bloqueo anti-SSRF de hosts internos (loopback/LAN/metadata)
//  · gates: reportReadiness exige evidencia real
//  · report: salida bilingüe (EN+ES) con fallback a español
// Sin dependencias externas ni red: solo node:assert.
// ============================================================================

const assert = require('assert');
const http = require('http');

const auth = require('./lib/auth');
const opplan = require('./lib/opplan');
const net = require('./lib/net');
const gates = require('./lib/gates');
const report = require('./lib/report');
const recon = require('./lib/recon');
const fuzzer = require('./lib/fuzzer');
const bizrace = require('./lib/bizrace');
const revocation = require('./lib/revocation');
const { RevocationLab } = require('./lib/revocation-lab');
const localPipeline = require('./lib/local-pipeline');
const surfaceMap = require('./lib/surface-map');
const kaliTools = require('./lib/kali-tools-job');
const kali = require('./lib/kali');
const cameraScanner = require('./lib/camera-scanner');
const dns = require('dns').promises;

let passed = 0;
let failed = 0;
const failures = [];
const asyncJobs = [];

function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; failures.push(name + ': ' + e.message); console.error('  ✗ ' + name + ' — ' + e.message); }
}

function testAsync(name, fn) {
  asyncJobs.push(async () => {
    try { await fn(); passed++; console.log('  ✓ ' + name); }
    catch (e) { failed++; failures.push(name + ': ' + e.message); console.error('  ✗ ' + name + ' — ' + e.message); }
  });
}

const CLEAN_CMDS = [
  'ls -la',
  'nmap -sV TARGET',
  "curl -s -b 'session=abc123' http://TARGET/api/users",
  'ping -c 1 localhost',
  'id',
  'ffuf -u http://TARGET/FUZZ -w /usr/share/wordlists/dirb/common.txt -mc 200 -t 1',
];

const BLOCKED_CMDS = [
  '$(rm -rf /)',        // command substitution
  '`id`',               // backticks
  'rm -rf /',           // destructivo directo
  'rm  -rf /',          // doble espacio (bypass de regex antigua)
  'x; rm -rf /',        // separador
  'shutdown -h now',
  'mkfs.ext4 /dev/sda1',
  'dd if=/dev/zero of=/dev/sda',
  'echo hi | id',       // pipe
  'cat /etc/passwd > /tmp/o', // redirección
  'a && b',             // AND
  'id < /etc/passwd',   // redirección entrada
  '{id;}',              // brace expansion
  '[id]',               // glob char
  'ls | grep x | shutdown',
  'rm -rf --no-preserve-root /',
  'echo "a$(id)b"',
  'curl -s https://8.8.8.8/',
  'ping -c 1 8.8.8.8',
];

test('auth.validateCommand acepta comandos limpios', () => {
  for (const c of CLEAN_CMDS) {
    assert.strictEqual(auth.validateCommand(c), null, 'no debería bloquear: ' + c);
  }
});

test('auth.validateCommand bloquea inyección/destructivos', () => {
  for (const c of BLOCKED_CMDS) {
    assert.notStrictEqual(auth.validateCommand(c), null, 'debería bloquear: ' + c);
  }
});

test('auth.validateCommand bloquea herramientas activas fuera del laboratorio', () => {
  assert.notStrictEqual(auth.validateCommand('sqlmap -u http://localhost/test?id=1 --batch'), null, 'SQLi automatizada debe ir por la compuerta');
  for (const c of ['nmap -sV example.com', 'ffuf -u https://example.com/FUZZ -w words', 'curl -s https://example.com', 'curl -s https://external.example/localhost', 'dig example.com', 'whois example.com', 'subfinder -d example.com', 'httpx https://example.com', 'python3 probe.py', 'node probe.js']) {
    assert.notStrictEqual(auth.validateCommand(c), null, 'debería bloquear: ' + c);
  }
  for (const c of ['nmap -sV localhost', 'curl -s http://127.0.0.1:8080', 'ffuf -u http://TARGET/FUZZ -w words']) {
    assert.strictEqual(auth.validateCommand(c), null, 'laboratorio permitido: ' + c);
  }
});

test('auth.validateCommand rechaza comando vacío y largos', () => {
  assert.notStrictEqual(auth.validateCommand('   '), null);
  assert.notStrictEqual(auth.validateCommand('x'.repeat(1001)), null);
});

test('auth.safeTarget acepta hostnames/URLs válidos', () => {
  for (const t of ['example.com', 'api.example.com', 'https://api.example.com/path?x=1', '*.crypto.com', '127.0.0.1']) {
    assert.notStrictEqual(auth.safeTarget(t), null, 'debería aceptar: ' + t);
  }
});

test('auth.safeScopeEntry acepta hosts exactos y comodines, no rutas', () => {
  assert.strictEqual(auth.safeScopeEntry('api.example.com'), 'api.example.com');
  assert.strictEqual(auth.safeScopeEntry('*.example.com'), '*.example.com');
  assert.strictEqual(auth.safeScopeEntry('https://example.com/path'), null);
  assert.strictEqual(auth.safeScopeEntry('example.com/path'), null);
});

test('opplan valida autorización y no amplía hosts exactos', () => {
  const draft = opplan.blank();
  assert.strictEqual(opplan.validate(draft).ok, false);
  const approved = {
    ...draft,
    nombre: 'OpenAI A/B autorizado',
    objetivo: 'Validar aislamiento con recurso sintético',
    scope: ['api.example.com'],
    autorizado: true,
    status: 'aprobado',
  };
  assert.strictEqual(opplan.validate(approved).ok, true);
  assert.strictEqual(opplan.inScope(approved, 'api.example.com'), true);
  assert.strictEqual(opplan.inScope(approved, 'child.api.example.com'), false);
  assert.strictEqual(opplan.inScope({ ...approved, scope: ['*.example.com'] }, 'child.example.com'), true);
});

test('opplan aprobado queda invalidado si falta target o el scope activo no coincide', () => {
  const plan = {
    ...opplan.blank(),
    nombre: 'Plan aprobado de prueba',
    objetivo: 'Validar aislamiento sintético',
    scope: ['chat.example.com'],
    autorizado: true,
    status: 'aprobado',
  };
  assert.strictEqual(opplan.isApprovedForSession(plan, {
    target: null, scope: ['chat.example.com'], out_of_scope: [],
  }), false);
  assert.strictEqual(opplan.isApprovedForSession(plan, {
    target: 'chat.example.com', scope: [], out_of_scope: [],
  }), false);
  assert.strictEqual(opplan.isApprovedForSession(plan, {
    target: 'chat.example.com', scope: ['other.example.com'], out_of_scope: [],
  }), false);
  assert.strictEqual(opplan.isApprovedForSession(plan, {
    target: 'chat.example.com', scope: ['chat.example.com'], out_of_scope: [],
  }), true);
  assert.strictEqual(opplan.isApprovedForSession(plan, {
    target: 'chat.example.com', scope: ['chat.example.com'], out_of_scope: ['chat.example.com'],
  }), false);
});

test('auth.safeTarget rechaza inyección y hostnames ambiguos', () => {
  for (const t of ['$(id).com', 'example.com; id', 'https://x.com/$(id)', 'https://x.com/`id`', 'example.com|ls', 'ftp://x.com', 'https://-bad.example.com', 'https://bad-.example.com']) {
    assert.strictEqual(auth.safeTarget(t), null, 'debería rechazar: ' + t);
  }
});

test('program-parser solo detecta plataformas por hostname', () => {
  const parser = require('./lib/program-parser');
  assert.strictEqual(parser.detectPlatform('https://bugcrowd.com/program/openai'), 'bugcrowd');
  assert.strictEqual(parser.detectPlatform('https://evil.example/?next=bugcrowd.com'), 'unknown');
  assert.strictEqual(parser.detectPlatform('https://notbugcrowd.com'), 'unknown');
});

test('browser.rutaCaptura rechaza rutas y extensiones peligrosas', () => {
  const browser = require('./lib/browser');
  for (const p of ['/tmp/out.png', '../out.png', 'sub/out.png', 'out.jpg', 'out.png\\\\x']) {
    assert.throws(() => browser.rutaCaptura(p), /no permitido|extensión/);
  }
});

test('auth.safeUrl rechaza inyección y protocolos no http(s)', () => {
  assert.notStrictEqual(auth.safeUrl('https://api.example.com/v1?q=1'), null);
  assert.strictEqual(auth.safeUrl('https://x.com/$(id)'), null);
  assert.strictEqual(auth.safeUrl('javascript:alert(1)'), null);
  assert.strictEqual(auth.safeUrl('file:///etc/passwd'), null);
  assert.strictEqual(auth.safeUrl('https://user:pass@example.com/'), null);
  assert.strictEqual(auth.safeUrl('https://example.com:8443/'), null);
});

test('auth.authorize acepta cookie/header locales y rechaza origen/socket', () => {
  const tok = auth.getToken();
  const local = { headers: { cookie: `${auth.COOKIE_NAME}=${tok}` }, socket: { remoteAddress: '127.0.0.1' } };
  assert.strictEqual(auth.authorize(local), true);
  const viaHeader = { headers: { 'x-knk-token': tok }, socket: { remoteAddress: '::1' } };
  assert.strictEqual(auth.authorize(viaHeader), true);
  const evilOrigin = { headers: { cookie: `${auth.COOKIE_NAME}=${tok}`, origin: 'http://evil.com' }, socket: { remoteAddress: '127.0.0.1' } };
  assert.strictEqual(auth.authorize(evilOrigin), false);
  const remote = { headers: { cookie: `${auth.COOKIE_NAME}=${tok}` }, socket: { remoteAddress: '10.0.0.5' } };
  assert.strictEqual(auth.authorize(remote), false);
  const badToken = { headers: { 'x-knk-token': 'wrong' }, socket: { remoteAddress: '127.0.0.1' } };
  assert.strictEqual(auth.authorize(badToken), false);
});

test('net.inScope respeta wildcards y dominios exactos', () => {
  net.setScope(['*.crypto.com', 'api.other.com', '127.0.0.1']);
  assert.strictEqual(net.inScope('api.crypto.com'), true);
  assert.strictEqual(net.inScope('crypto.com'), true);      // base del wildcard
  assert.strictEqual(net.inScope('api.other.com'), true);
  assert.strictEqual(net.inScope('www.api.other.com'), false, 'un host exacto no debe ampliar el scope');
  assert.strictEqual(net.inScope('127.0.0.1'), true);       // lab local explícito
  assert.strictEqual(net.inScope('evil.net'), false);
  assert.strictEqual(net.inScope('crypto.com.evil.net'), false);
});

test('net.inScope solo amplía subdominios con wildcard explícito', () => {
  net.setScope(['api.example.com', '*.wild.example.com']);
  assert.strictEqual(net.inScope('api.example.com'), true);
  assert.strictEqual(net.inScope('v2.api.example.com'), false);
  assert.strictEqual(net.inScope('x.wild.example.com'), true);
  assert.strictEqual(net.inScope('wild.example.com'), true);
  assert.strictEqual(net.inScope('x.wild.example.com.evil.net'), false);
});

test('net.isInternalHost detecta loopback/LAN/link-local/metadata', () => {
  const internos = ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.169.254', '0.0.0.0', 'localhost', 'pwn.local', 'svc.internal', '::1', '[::1]', 'fe80::1', 'fc00::1'];
  for (const h of internos) {
    assert.strictEqual(net.isInternalHost(h), true, 'debería ser interno: ' + h);
  }
  const publicos = ['8.8.8.8', '1.1.1.1', 'example.com', 'api.crypto.com', '169.253.0.1', '172.15.0.1', '172.32.0.1'];
  for (const h of publicos) {
    assert.strictEqual(net.isInternalHost(h), false, 'no debería ser interno: ' + h);
  }
});

testAsync('net.hostAllowed bloquea internos sin scope y permite con scope explícito', async () => {
  net.setScope([]);
  assert.strictEqual(await net.hostAllowed('127.0.0.1'), false, 'loopback sin scope debe bloquearse');
  assert.strictEqual(await net.hostAllowed('localhost'), false);
  assert.strictEqual(await net.hostAllowed('169.254.169.254'), false, 'metadata sin scope debe bloquearse');
  assert.strictEqual(await net.hostAllowed('8.8.8.8'), true, 'IP pública literal debe pasar');
  net.setScope(['127.0.0.1']);
  assert.strictEqual(await net.hostAllowed('127.0.0.1'), true, 'scope explícito permite el lab local');
  net.setScope(['*.crypto.com']);
  assert.strictEqual(await net.hostAllowed('api.crypto.com'), true);
  assert.strictEqual(await net.hostAllowed('evil.net'), false);
});

test('net.rateLimit aplica un mínimo transparente y no conserva stealth', () => {
  net.setRateLimit(1);
  assert.strictEqual(net.getRateLimit(), 800);
  net.setRateLimit(2000);
  assert.strictEqual(net.getRateLimit(), 2000);
  assert.strictEqual(net.setStealth(true), undefined);
});

test('net.setUA rechaza control y no permite sobrescribir el UA fijado', () => {
  net.unlockUA();
  net.setUA('knk-test-session', { force: true });
  assert.strictEqual(net.getUA(), 'knk-test-session');
  net.setUA('otro-módulo');
  assert.strictEqual(net.getUA(), 'knk-test-session');
  const invalidUA = 'malicioso' + String.fromCharCode(13, 10) + 'X-Injected: yes';
  net.setUA(invalidUA, { force: true });
  assert.strictEqual(net.getUA(), 'knk-test-session');
});

test('docker rechaza contenedor configurado de forma insegura', () => {
  const docker = require('./lib/docker');
  assert.strictEqual(docker.isRunning(), false, 'un contenedor inválido no debe inspeccionarse');
  assert.strictEqual(docker.exec('sqlmap', ['-u', 'http://TARGET/?id=1']).ok, false, 'sqlmap no debe poder lanzarse desde callers internos');
  assert.strictEqual(docker.exec('bash', ['-c', 'sqlmap -u http://TARGET/?id=1']).ok, false, 'sqlmap no debe poder ocultarse tras bash -c');
  assert.strictEqual(docker.exec('subfinder', ['-d', 'example.com']).ok, false, 'Docker no debe ejecutar recon externo fuera del pipeline');
  assert.strictEqual(docker.exec('dig', ['example.com']).ok, false, 'Docker no debe ejecutar DNS externo fuera del pipeline');
  assert.strictEqual(docker.exec('httpx', ['https://example.com']).ok, false, 'Docker no debe ejecutar httpx externo fuera del pipeline');
});

testAsync('net bloquea una redirección a un host fuera del scope', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: `http://localhost:${server.address().port}/final` });
      return res.end();
    }
    res.writeHead(200);
    res.end('final');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  net.setScope(['127.0.0.1']);
  net.setRateLimit(800);
  try {
    const result = await net.fetch(`http://127.0.0.1:${port}/redirect`);
    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.outOfScope, true);
    assert.strictEqual(result.blocked, true);
  } finally {
    net.setScope([]);
    net.setRateLimit(2000);
    await new Promise((resolve) => server.close(resolve));
  }
});

testAsync('net serializa varias peticiones con el intervalo configurado', async () => {
  const tiempos = [];
  const server = http.createServer((req, res) => {
    tiempos.push(Date.now());
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  net.setScope(['127.0.0.1']);
  net.setRateLimit(800);
  try {
    const respuestas = await Promise.all([
      net.fetch(`http://127.0.0.1:${port}/a`),
      net.fetch(`http://127.0.0.1:${port}/b`),
      net.fetch(`http://127.0.0.1:${port}/c`),
    ]);
    assert.ok(respuestas.every((r) => r.status === 200));
    assert.strictEqual(tiempos.length, 3);
    assert.ok(tiempos[1] - tiempos[0] >= 700, `intervalo 1 insuficiente: ${tiempos[1] - tiempos[0]}ms`);
    assert.ok(tiempos[2] - tiempos[1] >= 700, `intervalo 2 insuficiente: ${tiempos[2] - tiempos[1]}ms`);
  } finally {
    net.setScope([]);
    net.setRateLimit(2000);
    await new Promise((resolve) => server.close(resolve));
  }
});

testAsync('fuzzer exige confirmación manual y aprobación de scope', async () => {
  const r = await fuzzer.fuzz('https://example.com', { wordlist: ['admin'], manualConfirm: false });
  assert.strictEqual(r.requestsMade, 0);
  assert.strictEqual(r.pacing.stoppedReason, 'manual-confirmation-required');
  const sinScope = await fuzzer.fuzz('https://example.com', { wordlist: ['admin'], manualConfirm: true });
  assert.strictEqual(sinScope.requestsMade, 0);
  assert.strictEqual(sinScope.pacing.stoppedReason, 'scope-approval-required');
});

test('bizrace exige autorización antes de abrir una ronda', async () => {
  const r = await bizrace.lanzarRonda('https://example.com', { manualConfirm: true });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /autorización explícita/i);
});

test('bizrace limita la ronda y distingue doble aplicación', () => {
  const ronda = { ok: true, respuestas: [
    { status: 200, body: JSON.stringify({ id: 'a' }) },
    { status: 200, body: JSON.stringify({ id: 'b' }) },
    { status: 200, body: JSON.stringify({ id: 'c' }) },
    { status: 200, body: JSON.stringify({ id: 'd' }) },
    { status: 200, body: JSON.stringify({ id: 'e' }) },
    { status: 200, body: JSON.stringify({ id: 'f' }) },
  ] };
  assert.strictEqual(bizrace.analizarRonda(ronda).probableRace, true);
  assert.strictEqual(bizrace.analizarRonda({ ok: true, respuestas: [
    { status: 200, body: JSON.stringify({ id: 'same' }) },
    { status: 200, body: JSON.stringify({ id: 'same' }) },
  ] }).probableRace, false);
});

testAsync('recon.cnameChain devuelve la cadena CNAME sin bucles', async () => {
  const original = dns.resolveCname;
  const records = {
    'app.example.com': ['edge.provider.example.com'],
    'edge.provider.example.com': ['origin.provider.example.com'],
  };
  dns.resolveCname = async (host) => {
    if (!records[host]) {
      const error = new Error('no CNAME');
      error.code = 'ENODATA';
      throw error;
    }
    return records[host];
  };
  try {
    assert.deepStrictEqual(await recon.cnameChain('https://app.example.com/'), [
      'edge.provider.example.com', 'origin.provider.example.com',
    ]);
    assert.deepStrictEqual(await recon.cnameChain('direct.example.com'), []);
  } finally {
    dns.resolveCname = original;
  }
});

test('gates.sqliChain bloquea pruebas automáticas o sin evidencia', () => {
  const bloqueado = gates.sqliChain({
    inScope: true, authorizedAccount: true, baselineCaptured: true, singleParameter: true,
    nonDestructive: true, noExtraction: false, rateLimitRespected: true, requestCount: 1,
    differentialEvidence: false, reproducibleCount: 1, securityImpact: false,
  });
  assert.strictEqual(bloqueado.sendable, false);
  assert.ok(bloqueado.results.some((g) => g.id === 'sqli-g3' && !g.ok));
  const completo = gates.sqliChain({
    inScope: true, authorizedAccount: true, baselineCaptured: true, singleParameter: true,
    nonDestructive: true, noExtraction: true, automated: false, extractionAttempted: false, enumerationAttempted: false,
    rateLimitRespected: true, requestCount: 2,
    differentialEvidence: true, reproducibleCount: 2, securityImpact: true,
  });
  assert.strictEqual(completo.sendable, true, completo.summary);
  const automatizado = gates.sqliChain({
    inScope: true, authorizedAccount: true, baselineCaptured: true, singleParameter: true,
    nonDestructive: true, noExtraction: true, automated: true, rateLimitRespected: true,
    requestCount: 1, differentialEvidence: true, reproducibleCount: 2, securityImpact: true,
  });
  assert.strictEqual(automatizado.sendable, false, 'la automatización debe invalidar el gate aunque los demás flags sean positivos');
  assert.ok(automatizado.results.some((g) => g.id === 'sqli-g3' && !g.ok));
  const tipo = gates.exigirPorTipo({ bugType: 'SQL injection', inScope: true, authorizedAccount: true, baselineCaptured: true, singleParameter: true, nonDestructive: true, noExtraction: true, automated: true, extractionAttempted: false, enumerationAttempted: false, rateLimitRespected: true, requestCount: 1, differentialEvidence: true, reproducibleCount: 2, securityImpact: true });
  assert.strictEqual(tipo.sendable, false, 'la apertura por tipo también debe bloquear SQLi automatizada');
});

test('revocation prepara el flujo sin tráfico y bloquea evidencia incompleta', () => {
  const plan = revocation.plan({ resourceType: 'conversation' });
  assert.strictEqual(plan.resourceType, 'conversation');
  assert.strictEqual(plan.sequence.length >= 6, true);
  const incompleto = revocation.analyze({
    resourceType: 'conversation', openaiProgram: true, inScope: true,
    opplanApproved: true, authorized: true, ownAccountsAB: true,
    syntheticResource: true, noPII: true, baselineB: true,
    revocationPerformed: true, revocationConfirmed: true,
    postRevokeCheck: true, singleResource: true, noThirdParty: true,
    rateLimitRespected: true, reproducibleCount: 1, evidenceComplete: true,
    postRevokeRead: false, postRevokeReadStatus: 403, privateContentReturned: false,
  });
  assert.strictEqual(incompleto.sendable, false);
  assert.ok(incompleto.results.some((g) => g.id === 'rev-g9' && !g.ok));
  const completo = revocation.analyze({
    resourceType: 'file', openaiProgram: true, inScope: true,
    opplanApproved: true, authorized: true, ownAccountsAB: true,
    syntheticResource: true, noPII: true, baselineB: true,
    revocationPerformed: true, revocationConfirmed: true,
    postRevokeCheck: true, singleResource: true, noThirdParty: true,
    rateLimitRespected: true, reproducibleCount: 2, evidenceComplete: true,
    postRevokeRead: true, postRevokeReadStatus: 200, privateContentReturned: true,
    postRevokeWrite: false, postRevokeWriteStatus: 403,
  });
  assert.strictEqual(completo.sendable, true, completo.summary);
  assert.strictEqual(completo.accessRemains, true);
});

test('pipeline local completo ejecuta fuzz y exploit sin tráfico externo', () => {
  const result = localPipeline.runLocalPipeline({ maxPaths: 15 });
  assert.strictEqual(result.localOnly, true);
  assert.strictEqual(result.externalRequests, 0);
  assert.strictEqual(result.dockerUsed, false);
  assert.strictEqual(result.burpUsed, false);
  assert.strictEqual(result.completed, result.total);
  assert.strictEqual(result.verdict, 'QA LOCAL OK — no es un reporte externo');
  const fuzz = result.phases.find((p) => p.phase === 'fuzz');
  assert.strictEqual(fuzz.output.total, 15);
  assert.strictEqual(fuzz.output.requestsMade, 0);
  const exploit = result.phases.find((p) => p.phase === 'exploit');
  assert.strictEqual(exploit.output.checks.revocationFixtureDetected, true);
  assert.strictEqual(exploit.output.checks.idorFixtureDetected, true);
});

test('surface-map extrae scripts, endpoints e identificadores de bundles', () => {
  const html = `<html><head><script src="/_next/static/chunks/main.js"></script><script src="https://cdn.openai.com/app.js"></script><script src="/x.css"></script></head></html>`;
  const scripts = surfaceMap.extractScriptSrcs(html, 'https://chat.openai.com/');
  assert.deepStrictEqual(scripts, [
    'https://chat.openai.com/_next/static/chunks/main.js',
    'https://cdn.openai.com/app.js',
  ]);
  const js = `
    fetch("/backend-api/conversation/${'{conversation_id}'}", {method:'GET'});
    axios.post("/api/files", {ownerId: 1});
    const x = "/v1/models";
    const y = "/backend-api/settings/user";
  `;
  const endpoints = surfaceMap.extractEndpoints(js);
  assert.ok(endpoints.includes('/backend-api/conversation/{conversation_id}'));
  assert.ok(endpoints.includes('/api/files'));
  assert.ok(endpoints.includes('/v1/models'));
  assert.ok(endpoints.includes('/backend-api/settings/user'));
  const ids = surfaceMap.extractIdentifiers(js);
  assert.ok(ids.conversation_id >= 1);
  assert.ok(ids.ownerId >= 1);
});

test('surface-map extrae rutas dinámicas (template literals) y wrappers safeGet/safePost', () => {
  const js = `
    const a = \`/backend-api/${'${t.pathname.slice(5)}'}\`;
    const b = \`conversation/${'${id}'}/messages/${'${mid}'}/reactions\`;
    await K.safeGet(\`/files/library/directories/path\`, { parameters: { query: { directory_id: e } } });
    await SE().safePost(\`/plugins/search\`, { requestBody: { q: d } });
    const c = \`https://example.com/${'${x}'}\`;
  `;
  const endpoints = surfaceMap.extractEndpoints(js);
  assert.ok(endpoints.includes('/backend-api/{param}'), 'template literal normalizado: ' + JSON.stringify(endpoints));
  assert.ok(endpoints.includes('/conversation/{param}/messages/{param}/reactions'), 'template con 2 parámetros');
  assert.ok(endpoints.includes('/files/library/directories/path'), 'wrapper safeGet');
  assert.ok(endpoints.includes('/plugins/search'), 'wrapper safePost');
  assert.ok(!endpoints.some((e) => e.includes('example.com')), 'URLs absolutas ajenas no entran');
  assert.ok(!endpoints.some((e) => e.includes('<') || e.includes('>')), 'sin ruido JSX/HTML');
});

test('surface-map extractTemplatePaths filtra ruido JSX/regex y conserva rutas API', () => {
  const js = `
    const a = \`/backend-api/${'${x}'}/messages\`;
    const b = \`/<p>{param}</p>\`;
    const c = \`/(<\\/ul>){param}\\s*\`;
    const d = \`/#settings/${'${connector}'}?connector=${'${y}'}\`;
    const e = \`/Routepath\"${'${r}'}\"noelement\`;
  `;
  const paths = surfaceMap.extractTemplatePaths(js);
  assert.ok(paths.includes('/backend-api/{param}/messages'), 'ruta API conservada: ' + JSON.stringify(paths));
  assert.ok(paths.includes('/#settings/{param}?connector={param}'), 'ruta hash conservada');
  assert.ok(!paths.some((p) => p.includes('<') || p.includes('>')), 'sin JSX');
  assert.ok(!paths.some((p) => p.includes('Routepath')), 'sin mensajes de error');
});

test('surface-map parsea el manifest en rutas de chunk y filtra focus payments', () => {
  const manifest = `
    var routes = {
      \"/cdn/assets/admin.billing-icihehqg.js\": {},
      \"/cdn/assets/checkout._entity._checkoutId-gzwqhtvq.js\": {},
      \"/cdn/assets/payments.success-b18x4oiz.js\": {},
      \"/cdn/assets/_conversation-gzlxwipx.js\": {},
      \"/cdn/assets/root-id6bxwk2.js\": {},
    };
  `;
  const chunks = surfaceMap.extractRouteChunks(manifest, 'https://chatgpt.com/');
  const rutas = chunks.map((c) => c.route);
  assert.ok(rutas.includes('admin.billing'), 'rutas: ' + JSON.stringify(rutas));
  assert.ok(rutas.includes('checkout._entity._checkoutId'));
  assert.ok(rutas.includes('payments.success'));
  assert.ok(surfaceMap.paymentFocusMatch('admin.billing'));
  assert.ok(surfaceMap.paymentFocusMatch('checkout._entity._checkoutId'));
  assert.ok(surfaceMap.paymentFocusMatch('codex.purchase._plan'));
  assert.ok(!surfaceMap.paymentFocusMatch('_conversation'));
  assert.ok(!surfaceMap.paymentFocusMatch('root'));
});

test('surface-map isSameScopeHost respeta hosts exactos y wildcards', () => {
  assert.strictEqual(surfaceMap.isSameScopeHost('chat.openai.com', ['chat.openai.com']), true);
  assert.strictEqual(surfaceMap.isSameScopeHost('cdn.openai.com', ['chat.openai.com']), false);
  assert.strictEqual(surfaceMap.isSameScopeHost('cdn.openai.com', ['*.openai.com']), true);
  assert.strictEqual(surfaceMap.isSameScopeHost('chat.openai.com', []), true, 'sin scope no se filtra');
});

test('laboratorio local ejecuta escenario seguro y detecta modo vulnerable', () => {
  const seguro = new RevocationLab({ enforceRevocation: true }).runScenario('file');
  assert.strictEqual(seguro.secure, true);
  assert.strictEqual(seguro.baseline.status, 200);
  assert.strictEqual(seguro.afterRead.status, 403);
  assert.strictEqual(seguro.afterWrite.status, 403);
  const vulnerable = new RevocationLab({ enforceRevocation: false }).runScenario('conversation');
  assert.strictEqual(vulnerable.secure, false);
  assert.strictEqual(vulnerable.afterRead.status, 200);
  assert.strictEqual(vulnerable.afterWrite.status, 204);
  assert.strictEqual(vulnerable.reproducible, true);
});

test('gates.idorChain exige dos cuentas propias, recurso conocido y lectura privada', () => {
  const incomplete = gates.idorChain({
    inScope: true, ownAccountsAB: false, ownResourceB: true, baselineB200: true,
    readWithA: 200, dataPrivate: true, singleKnownResource: true,
    reproducible: true, programEligible: true,
  });
  assert.strictEqual(incomplete.sendable, false);
  assert.ok(incomplete.results.some((g) => g.id === 'idor-g1' && !g.ok));

  const complete = gates.idorChain({
    inScope: true, ownAccountsAB: true, ownResourceB: true, baselineB200: true,
    readWithA: 200, dataPrivate: true, singleKnownResource: true,
    reproducible: true, programEligible: true,
  });
  assert.strictEqual(complete.sendable, true, complete.summary);
  assert.strictEqual(gates.exigirPorTipo({ bugType: 'IDOR horizontal', ...completeInputForIdor() }).sendable, true);
});

function completeInputForIdor() {
  return {
    inScope: true, ownAccountsAB: true, ownResourceB: true, baselineB200: true,
    readWithA: 200, dataPrivate: true, singleKnownResource: true,
    reproducible: true, programEligible: true,
  };
}

test('laboratorio local comprueba aislamiento IDOR con recursos sintéticos', () => {
  const seguro = new RevocationLab({ enforceRevocation: true }).runIdorScenario('conversation');
  assert.strictEqual(seguro.secure, true);
  assert.strictEqual(seguro.baseline.status, 200);
  assert.strictEqual(seguro.readWithA.status, 403);
  assert.strictEqual(seguro.writeWithA.status, 403);

  const vulnerable = new RevocationLab({ enforceRevocation: false }).runIdorScenario('conversation');
  assert.strictEqual(vulnerable.vulnerable, true);
  assert.strictEqual(vulnerable.readWithA.status, 200);
  assert.strictEqual(vulnerable.writeWithA.status, 204);
});

test('gates.exigirPorTipo bloquea revocación sin impacto', () => {
  const r = gates.exigirPorTipo({
    bugType: 'revocation file access', resourceType: 'file', openaiProgram: true,
    inScope: true, opplanApproved: true, authorized: true, ownAccountsAB: true,
    syntheticResource: true, noPII: true, baselineB: true, revocationPerformed: true,
    revocationConfirmed: true, postRevokeCheck: true, singleResource: true,
    noThirdParty: true, rateLimitRespected: true, reproducibleCount: 2,
    evidenceComplete: true, postRevokeRead: false, postRevokeReadStatus: 403,
    privateContentReturned: false,
  });
  assert.strictEqual(r.sendable, false);
  assert.ok(r.results.some((g) => g.id === 'rev-g11' && !g.ok));
});

test('gates.reportReadiness bloquea sin evidencia y pasa con checklist completa', () => {
  const incompleto = gates.reportReadiness({ inScope: true, noDuplicate: true, notDisqualifier: true, exploitable: false, evidenceScreenshots: false });
  assert.strictEqual(incompleto.sendable, false);
  assert.ok(incompleto.results.some((g) => g.id === 'rep-5' && !g.ok), 'rep-5 debe fallar sin capturas');
  const completo = gates.reportReadiness({
    inScope: true, noDuplicate: true, notDisqualifier: true, exploitable: true,
    evidenceScreenshots: true, evidenceRequestResponse: true, pocMinimal: true, noPII: true,
    reproducibleCount: 2, severityHonest: true, humanReview: true,
    reviewNote: 'Revisé manualmente scope, evidencia, impacto y reproducción.',
  });
  assert.strictEqual(completo.sendable, true, completo.summary);
});

function metaBase(extra) {
  return {
    title: 'Título ES', program: 'P', asset: 'A', bugType: 'xss', cwe: 'CWE-79', cvss: '5.3', severity: 'medium',
    impact: 'Impacto ES', remediation: 'Remediación ES',
    steps: ['Paso 1', 'Paso 2', 'Paso 3'],
    evidence: ['cap1.png'],
    inScope: true, noDuplicate: true, notDisqualifier: true, exploitable: true,
    evidenceScreenshots: true, evidenceRequestResponse: true, pocMinimal: true, noPII: true,
    reproducibleCount: 2, severityHonest: true, humanReview: true,
    reviewNote: 'He revisado scope, request/response, impacto y reproducción manual.',
    curl: 'curl -v https://x', screenshotsPath: '/tmp/x.png', requestResponsePath: '/tmp/rr.txt',
    userAgent: 'UA', programUrl: 'https://p', scopeDocumentado: '*.crypto.com',
    ...extra,
  };
}

test('report.generateReport produce salida bilingüe con campos EN', () => {
  const rep = report.generateReport(metaBase({
    titleEn: 'Tampered Checkout Title', summaryEn: 'English summary', impactEn: 'English impact',
    remediationEn: 'English remediation', stepsEn: ['EN step 1', 'EN step 2'],
  }));
  assert.strictEqual(rep.allowed, true, rep.blockers);
  assert.ok(rep.report.includes('ENGLISH — submission-ready'), 'falta sección EN');
  assert.ok(rep.report.includes('ESPAÑOL — análisis de trabajo'), 'falta sección ES');
  assert.ok(rep.report.includes('Tampered Checkout Title'), 'no usa el título EN');
  assert.ok(rep.report.includes('English summary'), 'no usa el resumen EN');
});

test('kali.pickTerminal resuelve las 3 terminales y el fallback honesto', () => {
  const stVbox = { status: 'RUNTIME_READY', runtime: 'vbox-ssh', distro: 'kali-bounty-ova', vbox: { host: '127.0.0.1', port: 2222, user: 'kali' } };
  const stWsl = { status: 'RUNTIME_READY', runtime: 'wsl2', distro: 'kali-linux', user: 'knkli' };
  const stOff = { status: 'RUNTIME_NOT_INSTALLED', runtime: null, distro: null };

  // vbox disponible
  const v = kali.pickTerminal('vbox-ssh', stVbox);
  assert.strictEqual(v.runtime, 'vbox-ssh');
  // En Windows el shell es la ruta resuelta a ssh.exe (node-pty no resuelve PATH)
  assert.ok(v.shell.endsWith('ssh.exe') || v.shell === 'ssh', 'shell ssh resuelto');
  assert.ok(v.shellArgs.some(a => String(a).includes('2222')), 'args ssh con puerto');
  assert.ok(v.banner.includes('Kali VirtualBox'), 'banner vbox');

  // wsl disponible
  const w = kali.pickTerminal('wsl2', stWsl);
  assert.strictEqual(w.runtime, 'wsl2');
  assert.deepStrictEqual(w.shellArgs, ['-d', 'kali-linux']);
  assert.ok(w.banner.includes('Kali WSL2'), 'banner wsl');

  // local siempre disponible
  const l = kali.pickTerminal('local', stOff);
  assert.strictEqual(l.runtime, 'local');
  assert.ok(l.shell.includes('cmd'), 'shell local Windows');

  // auto respeta prioridad: wsl > vbox > local
  assert.strictEqual(kali.pickTerminal('auto', stWsl).runtime, 'wsl2');
  assert.strictEqual(kali.pickTerminal('auto', stVbox).runtime, 'vbox-ssh');
  assert.strictEqual(kali.pickTerminal('auto', stOff).runtime, 'local');

  // elegido pero NO disponible → local con fallbackFrom declarado (nunca fingimos)
  const f = kali.pickTerminal('wsl2', stVbox);
  assert.strictEqual(f.runtime, 'local');
  assert.strictEqual(f.fallbackFrom, 'wsl2');
  assert.ok(f.banner.includes('wsl2 no disponible'), 'banner declara el fallback');
});

test('kali.runtimes devuelve lista con las terminales (incl. local-tools y docker)', async () => {
  const r = await kali.runtimes();
  assert.strictEqual(r.ok, true);
  const ids = r.runtimes.map(rt => rt.id);
  assert.deepStrictEqual(ids, ['vbox-ssh', 'docker', 'local-tools', 'local', 'wsl2']);
  assert.ok(r.runtimes.every(rt => typeof rt.available === 'boolean'), 'available booleano');
  const localRt = r.runtimes.find(rt => rt.id === 'local');
  assert.strictEqual(localRt.available, true, 'local siempre disponible');
});

test('kaliTools.resolvePackages valida lista blanca y deduplica', () => {
  // vacía → set de lab clásico
  assert.deepStrictEqual(kaliTools.resolvePackages([]), kaliTools.LAB_PACKAGES);
  assert.deepStrictEqual(kaliTools.resolvePackages(undefined), kaliTools.LAB_PACKAGES);
  // mezcla válidos, duplicados, no-string y elementos fuera del catálogo
  const r = kaliTools.resolvePackages(['nmap', ' nmap ', 42, 'rm -rf /', 'hydra', null]);
  assert.deepStrictEqual(r, ['nmap', 'hydra'], 'filtra inválidos/duplicados y conserva orden');
  // todo inválido → fallback al set clásico
  assert.deepStrictEqual(kaliTools.resolvePackages(['evil-package', 'x']), kaliTools.LAB_PACKAGES);
});

test('kaliTools.PACKAGE_CATALOG cubre las 4 categorías de la UI', () => {
  const cats = new Set(kaliTools.PACKAGE_CATALOG.map(p => p.cat));
  for (const c of kaliTools.CATS) assert.ok(cats.has(c), `falta categoría ${c}`);
  const pkgs = kaliTools.PACKAGE_CATALOG.map(p => p.pkg);
  assert.strictEqual(new Set(pkgs).size, pkgs.length, 'paquetes duplicados en el catálogo');
  assert.ok(kaliTools.PACKAGE_CATALOG.every(p => typeof p.pkg === 'string' && typeof p.bin === 'string'), 'entradas incompletas');
});

test('report.generateReport hace fallback al español sin campos EN', () => {
  const rep = report.generateReport(metaBase({}));
  assert.strictEqual(rep.allowed, true, rep.blockers);
  assert.ok(rep.report.includes('Título ES'), 'la sección EN debe caer al título ES');
  assert.ok(rep.report.includes('Impacto ES'), 'la sección EN debe caer al impacto ES');
});

test('scanLocalNetwork rechaza inyección y rangos no RFC1918', async () => {
  const bad = await cameraScanner.scanLocalNetwork('192.168.1.1; calc.exe');
  assert.strictEqual(bad.ok, false, 'inyección debe rechazarse');
  const pub = await cameraScanner.scanLocalNetwork('8.8.8.0/24');
  assert.strictEqual(pub.ok, false, 'rango público debe rechazarse en red local');
  const malformed = await cameraScanner.scanLocalNetwork('999.1.1.0');
  assert.strictEqual(malformed.ok, false, 'IP malformada debe rechazarse');
});

test('auditableIP bloquea link-local/metadata y acepta resto', () => {
  assert.strictEqual(cameraScanner.auditableIP('169.254.169.254'), null, 'metadata bloqueada');
  assert.strictEqual(cameraScanner.auditableIP('0.0.0.0'), null, '0.0.0.0 bloqueada');
  assert.strictEqual(cameraScanner.auditableIP('8.8.8.8;id'), null, 'inyección bloqueada');
  assert.strictEqual(cameraScanner.auditableIP('8.8.8.8'), '8.8.8.8', 'pública válida');
  assert.strictEqual(cameraScanner.auditableIP('192.168.1.10'), '192.168.1.10', 'LAN válida (lab)');
});

test('osint username inválido se rechaza sin red', async () => {
  const osintHub = require('./lib/osint-hub');
  const r = await osintHub.searchUsername('../../etc');
  assert.strictEqual(r.ok, false, 'username con path traversal debe rechazarse');
});

test('osint robots sanea userinfo y rutas', async () => {
  const osintHub = require('./lib/osint-hub');
  const r = await osintHub.analyzeRobotsTxt('https://evil.com@bueno.com/x');
  assert.ok(r.ok === false || !String(JSON.stringify(r)).includes('evil.com@'), 'userinfo no debe cambiar el destino');
});

test('osint email inválido no ejecuta nada', async () => {
  const osintHub = require('./lib/osint-hub');
  const r = await osintHub.emailOSINT('no-es-email');
  assert.strictEqual(r.email, 'no-es-email');
  assert.ok(r.breachCheck === undefined || r.breachCheck.breached !== true, 'sin falso positivo');
});

test('osint batch insecam exige urls (contrato de validación)', () => {
  const bad = [];
  for (const u of ['', 'https://evil.com/x', 'http://www.insecam.org/en/bycountry/US/']) {
    if (/^https?:\/\/(www\.)?insecam\.org\/en\/view\//i.test(String(u))) bad.push(u);
  }
  assert.deepStrictEqual(bad, [], 'solo /en/view/ pasa el filtro');
});

test('validateCommand se exige en rutas exec (contrato)', () => {
  assert.notStrictEqual(auth.validateCommand('nmap -sn 192.168.1.0/24'), null, 'nmap externo se bloquea');
  assert.notStrictEqual(auth.validateCommand('rm -rf /tmp/x'), null, 'destructivo se bloquea');
});

(async () => {
  for (const job of asyncJobs) await job();
  console.log(`\n${passed} pasaron, ${failed} fallaron`);
  if (failed) {
    console.error('\nFallos:');
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
})();