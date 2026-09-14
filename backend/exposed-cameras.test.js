'use strict';

// ============================================================================
// exposed-cameras.test.js — tests sin red
//
// El motor de «Cámaras Expuestas» se prueba con un fetch inyectado: así se
// verifican el parseo de objetivos, la traducción de filtros a consultas por
// plataforma, la puntuación y el filtrado, sin salir a internet.
// ============================================================================

const assert = require('assert');

const exposed = require('./lib/exposed-cameras');

// ── parseo de objetivos ─────────────────────────────────────────────
const single = exposed.parseTargets('93.184.216.34');
assert.strictEqual(single.ok, true);
assert.deepStrictEqual(single.ips, ['93.184.216.34']);

const mixed = exposed.parseTargets('93.184.216.34, 8.8.8.8\n1.1.1.1');
assert.strictEqual(mixed.ips.length, 3);

const dupes = exposed.parseTargets('8.8.8.8 8.8.8.8 8.8.8.8');
assert.deepStrictEqual(dupes.ips, ['8.8.8.8']);

const privates = exposed.parseTargets('192.168.1.10 10.0.0.5 127.0.0.1 169.254.169.254');
assert.strictEqual(privates.ok, false, 'las redes privadas no son objetivo de este módulo');
assert.ok(/privada/.test(privates.notes.join(' ')));

const invalid = exposed.parseTargets('no-es-una-ip 8.8.8.8');
assert.deepStrictEqual(invalid.ips, ['8.8.8.8']);
assert.ok(invalid.notes.join(' ').includes('descartados'));

const cidr = exposed.parseTargets('93.184.216.0/24');
assert.strictEqual(cidr.ips.length, exposed.MAX_TARGETS, 'un /24 se recorta al límite');
assert.strictEqual(cidr.ips[0], '93.184.216.1', 'se empieza por la primera dirección usable');
assert.ok(cidr.notes.join(' ').includes('se analizan solo'), 'la nota explica el recorte');

const tiny = exposed.parseTargets('93.184.216.0/30');
assert.deepStrictEqual(tiny.ips, ['93.184.216.1', '93.184.216.2'], '/30 → red y broadcast fuera');

const half = exposed.parseTargets('93.184.216.0/31');
assert.deepStrictEqual(half.ips, ['93.184.216.0', '93.184.216.1'], '/31 usa sus dos direcciones');

const host32 = exposed.parseTargets('93.184.216.34/32');
assert.deepStrictEqual(host32.ips, ['93.184.216.34'], '/32 es la propia IP');

const mixedCidr = exposed.parseTargets('93.184.216.0/30 10.1.2.3');
assert.ok(mixedCidr.ips.every((ip) => !exposed.isPrivateIpv4(ip)));

assert.strictEqual(exposed.parseTargets('').ok, false);
assert.strictEqual(exposed.parseTargets('   ').ok, false);
assert.strictEqual(exposed.parseTargets('93.184.216.0/33').ok, false, 'prefijo imposible');

assert.strictEqual(exposed.ipToInt('255.255.255.255'), 4294967295);
assert.strictEqual(exposed.ipToInt('999.1.1.1'), null);
assert.strictEqual(exposed.intToIp(4294967295), '255.255.255.255');
assert.strictEqual(exposed.isPrivateIpv4('172.16.0.1'), true);
assert.strictEqual(exposed.isPrivateIpv4('172.32.0.1'), false);

// ── servicio (consulta) vs puerto (filtro de tus objetivos) ─────────
const serviceOnly = exposed.normalizeFilters({ service: 'rtsp' });
assert.strictEqual(serviceOnly.port, null, 'elegir servicio no filtra por puerto');
assert.strictEqual(serviceOnly.servicePort, 554, 'el puerto sugerido vive aparte');
assert.strictEqual(exposed.normalizeFilters({ service: 'rtsp', port: 8080 }).port, 8080);
assert.strictEqual(exposed.normalizeFilters({ port: '' }).port, null);
assert.strictEqual(exposed.normalizeFilters({}).service, 'all');

// ── traducción de filtros a consultas ───────────────────────────────
const plan = exposed.buildPlatformQueries(
  { country: 'ES', port: 554, hasScreenshot: true, q: 'carretera' },
  { service: exposed.SERVICES.find((s) => s.id === 'rtsp') },
);
const shodan = plan.find((p) => p.platform === 'Shodan');
const fofa = plan.find((p) => p.platform === 'FOFA');
const zoomeye = plan.find((p) => p.platform === 'ZoomEye');
assert.ok(shodan.syntax.includes('port:554'));
assert.strictEqual(shodan.syntax.split('port:554').length - 1, 1, 'sin términos duplicados');
assert.ok(shodan.syntax.includes('country:ES'));
assert.ok(shodan.syntax.includes('has_screenshot:true'));
assert.ok(/carretera/.test(shodan.syntax));
assert.ok(fofa.syntax.includes('country="ES"'));
assert.ok(fofa.url.includes('qbase64='));
const decoded = Buffer.from(fofa.url.split('qbase64=')[1], 'base64').toString('utf8');
assert.strictEqual(decoded, fofa.syntax, 'la consulta de FOFA viaja en base64 tal cual');
assert.ok(zoomeye.syntax.includes('country:"ES"'));
assert.ok(plan.every((p) => p.url.startsWith('https://')));
assert.ok(plan.every((p) => p.syntax.length > 0));

const presetPlan = exposed.buildPlatformQueries({}, { preset: exposed.PRESETS.find((p) => p.id === 'open-webcams') });
assert.ok(presetPlan.find((p) => p.platform === 'Shodan').syntax.includes('has_screenshot:true'));

// preset + servicio que piden el mismo puerto: aparece una sola vez
const dedupPlan = exposed.buildPlatformQueries({}, {
  preset: exposed.PRESETS.find((p) => p.id === 'open-webcams'),
  service: exposed.SERVICES.find((s) => s.id === 'rtsp'),
});
const dedupShodan = dedupPlan.find((p) => p.platform === 'Shodan').syntax;
assert.strictEqual(dedupShodan.split('port:554').length - 1, 1);
assert.ok(dedupShodan.includes('has_screenshot:true'));

const vulnsPlan = exposed.buildPlatformQueries({ vulnsOnly: true });
assert.ok(vulnsPlan.find((p) => p.platform === 'Shodan').syntax.includes('vulns:'));
assert.strictEqual(exposed.buildPlatformQueries({ country: 'all' }).find((p) => p.platform === 'Shodan').syntax.includes('country:'), false, '«todos los países» no añade filtro');

const brandPlan = exposed.buildPlatformQueries({}, { brand: exposed.BRANDS.hikvision });
assert.ok(brandPlan.find((p) => p.platform === 'Shodan').syntax.includes('Hikvision'));
assert.ok(brandPlan.find((p) => p.platform === 'FOFA').syntax.includes('HIKVISION'));

// un puerto explícito sin servicio sí entra en la consulta
const portPlan = exposed.buildPlatformQueries({ port: 8888 });
assert.ok(portPlan.find((p) => p.platform === 'Shodan').syntax.includes('port:8888'));
assert.ok(portPlan.find((p) => p.platform === 'FOFA').syntax.includes('port="8888"'));

// ── dorks y comandos ────────────────────────────────────────────────
const dorks = exposed.buildDorks({ country: 'ES' }, {});
assert.ok(dorks.length >= 4);
assert.strictEqual(new Set(dorks.map((d) => d.dork)).size, dorks.length, 'sin dorks repetidas');
assert.ok(dorks.every((d) => d.url.startsWith('https://www.google.com/search?q=')));

const cli = exposed.buildCli({ port: 8554, country: 'FR' });
assert.ok(cli.some((c) => c.command.includes('-p8554')));
assert.ok(cli.some((c) => /alcance|autorizado/i.test(`${c.label} ${c.note}`)), 'los comandos recuerdan el alcance');

// ── puntuación ──────────────────────────────────────────────────────
const rtspHost = exposed.scoreCamera({ ports: [554], cpes: [], tags: [], hostnames: [], vulns: [] });
assert.ok(rtspHost.score >= 40);
assert.strictEqual(rtspHost.isLikelyCamera, true);
assert.ok(rtspHost.reasons.some((r) => /RTSP/.test(r)));

const hikvisionHost = exposed.scoreCamera({ ports: [8000], cpes: ['cpe:/a:hikvision:ip_camera'], tags: [], hostnames: ['cam-01.local'] });
assert.ok(hikvisionHost.reasons.some((r) => /Hikvision/.test(r)));
assert.ok(hikvisionHost.reasons.some((r) => /nombre de host/.test(r)));

const boringHost = exposed.scoreCamera({ ports: [22, 25], cpes: [], tags: [], hostnames: [], vulns: [] });
assert.strictEqual(boringHost.score, 0);
assert.strictEqual(boringHost.isLikelyCamera, false);

const maxHost = exposed.scoreCamera({
  ports: [554, 8554, 37777, 34567, 8000, 80, 8443],
  cpes: ['cpe:/a:hikvision:ip_camera'],
  tags: ['webcam', 'camera'],
  hostnames: ['cctv-1.example'],
  vulns: ['CVE-2021-36260', 'CVE-2017-7921', 'CVE-2022-2222', 'CVE-2023-3333', 'CVE-2024-4444'],
});
assert.strictEqual(maxHost.score, 100, 'la puntuación se corta en 100');
assert.strictEqual(exposed.brandMatches(['cpe:/a:dahua:dvr'], exposed.BRANDS.dahua), true);
assert.strictEqual(exposed.brandMatches([], exposed.BRANDS.dahua), false);

// ── búsqueda completa con fetch inyectado (sin red) ─────────────────
const INDEX = {
  '93.184.216.34': { ports: [554, 8000], cpes: ['cpe:/a:hikvision:ip_camera'], tags: ['camera'], hostnames: ['cam.example'], vulns: ['CVE-2021-36260'] },
  '8.8.8.8': { ports: [53, 443], cpes: [], tags: [], hostnames: [], vulns: [] },
  '1.1.1.1': { ports: [554], cpes: [], tags: [], hostnames: [], vulns: [] },
  '203.0.113.7': null, // simula 404 → sin datos
};

const calls = [];
exposed.setFetchImpl(async (url) => {
  calls.push(url);
  const ip = url.replace(exposed.INTERNETDB_BASE, '');
  const record = INDEX[ip];
  if (!record) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => record };
});

(async () => {
  const found = await exposed.searchExposed({
    targets: '93.184.216.34 8.8.8.8 1.1.1.1 203.0.113.7',
    sort: 'score',
  });

  assert.strictEqual(found.ok, true);
  assert.strictEqual(found.summary.requested, 4);
  assert.strictEqual(found.summary.analyzed, 3);
  assert.strictEqual(found.summary.failed, 1);
  assert.strictEqual(found.targets[0].ip, '93.184.216.34', 'la cámara más probable va primero');
  assert.strictEqual(found.targets[0].isLikelyCamera, true);
  assert.strictEqual(found.targets.at(-1).ip, '8.8.8.8', 'el host sin pinta de cámara queda al final');
  assert.ok(found.failed[0].error.includes('sin datos'));
  assert.ok(found.warning.includes('no se ha conectado'));
  assert.strictEqual(found.semantics, 'public-index-metadata');
  assert.strictEqual(calls.length, 4, 'una consulta por objetivo');
  assert.ok(calls.every((url) => url.startsWith('https://internetdb.shodan.io/')));

  // REGRESIÓN: elegir un servicio no puede vaciar la lista de objetivos
  const withService = await exposed.searchExposed({ targets: '93.184.216.34 8.8.8.8 1.1.1.1', service: 'rtsp' });
  assert.strictEqual(withService.targets.length, 3, 'el servicio solo acota la consulta al buscador');
  assert.strictEqual(withService.summary.filteredOut, 0);
  assert.strictEqual(withService.filters.port, null);
  assert.ok(withService.notes.join(' ').includes('sin filtrar por puerto'));

  // el puerto explícito sí filtra los objetivos
  const portExplicit = await exposed.searchExposed({ targets: '93.184.216.34 8.8.8.8 1.1.1.1', port: 554 });
  assert.deepStrictEqual(portExplicit.targets.map((t) => t.ip).sort(), ['1.1.1.1', '93.184.216.34']);
  assert.strictEqual(portExplicit.summary.filteredOut, 1);

  // servicio + puerto: consulta acotada y objetivos filtrados, y se explica
  const both = await exposed.searchExposed({ targets: '93.184.216.34 8.8.8.8 1.1.1.1', service: 'rtsp', port: 8000 });
  assert.deepStrictEqual(both.targets.map((t) => t.ip), ['93.184.216.34']);
  assert.ok(both.notes.join(' ').includes('filtra además'));

  // filtro por CVE
  const vulnsOnly = await exposed.searchExposed({ targets: '93.184.216.34 8.8.8.8 1.1.1.1', vulnsOnly: true });
  assert.strictEqual(vulnsOnly.targets.length, 1);
  assert.strictEqual(vulnsOnly.targets[0].ip, '93.184.216.34');

  // umbral de puntuación
  const highScore = await exposed.searchExposed({ targets: '93.184.216.34 8.8.8.8 1.1.1.1', minScore: 40 });
  assert.ok(highScore.targets.every((t) => t.score >= 40));
  assert.ok(highScore.summary.filteredOut >= 1);

  // marca: se conservan los hosts sin CPE y se marca la coincidencia
  const branded = await exposed.searchExposed({ targets: '93.184.216.34 1.1.1.1 8.8.8.8', brand: 'hikvision' });
  assert.strictEqual(branded.targets.find((t) => t.ip === '93.184.216.34').brandMatch, true);
  assert.ok(branded.targets.some((t) => t.ip === '1.1.1.1'), 'sin CPE no se descarta el candidato');

  // orden por IP
  const byIp = await exposed.searchExposed({ targets: '93.184.216.34 8.8.8.8 1.1.1.1', sort: 'ip' });
  assert.deepStrictEqual(byIp.targets.map((t) => t.ip), ['1.1.1.1', '8.8.8.8', '93.184.216.34']);

  // orden por CVEs
  const byVulns = await exposed.searchExposed({ targets: '8.8.8.8 93.184.216.34', sort: 'vulns' });
  assert.strictEqual(byVulns.targets[0].ip, '93.184.216.34');

  // límite
  const limited = await exposed.searchExposed({ targets: '93.184.216.34 8.8.8.8 1.1.1.1', limit: 2 });
  assert.strictEqual(limited.targets.length, 2);
  assert.strictEqual(limited.summary.shown, 2);

  // una lista privada no consulta nada y lo explica
  calls.length = 0;
  const privateOnly = await exposed.searchExposed({ targets: '192.168.1.0/24' });
  assert.strictEqual(calls.length, 0, 'jamás se consulta una red privada');
  assert.strictEqual(privateOnly.summary.analyzed, 0);
  assert.ok(privateOnly.notes.join(' ').length > 0);
  assert.ok(privateOnly.queryPlan.platforms.length >= 5);
  assert.ok(privateOnly.queryPlan.dorks.length >= 4);

  // sin objetivos sigue siendo útil: solo el plan
  const planOnly = await exposed.searchExposed({ country: 'ES', service: 'mjpeg' });
  assert.strictEqual(planOnly.summary.requested, 0);
  const planShodan = planOnly.queryPlan.platforms.find((p) => p.platform === 'Shodan').syntax;
  assert.ok(planShodan.includes('country:ES'));
  assert.ok(planShodan.includes('multipart/x-mixed-replace'));

  // hasScreenshot avisa de que se aplica en el buscador, no en InternetDB
  const shot = await exposed.searchExposed({ targets: '8.8.8.8', hasScreenshot: true });
  assert.ok(shot.notes.join(' ').includes('con captura'));
  assert.ok(shot.queryPlan.platforms.find((p) => p.platform === 'Shodan').syntax.includes('has_screenshot:true'));

  // resumen de puertos
  const summary = await exposed.searchExposed({ targets: '93.184.216.34 1.1.1.1' });
  assert.ok(summary.summary.byPort[554] >= 2);

  // catálogo de opciones para la UI
  const opts = exposed.options();
  assert.ok(opts.services.length >= 8);
  assert.ok(opts.presets.length >= 4);
  assert.ok(opts.countries.some((c) => c.code === 'ES'));
  assert.ok(opts.brands.some((b) => b.id === 'hikvision'));
  assert.ok(opts.sorts.length >= 4);
  assert.ok(opts.cameraPorts.includes(554) && opts.cameraPorts.includes(37777));

  // concurrencia: se respeta el orden de entrada
  const order = await exposed.mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
    await new Promise((r) => setTimeout(r, (6 - n) * 5));
    return n * 2;
  });
  assert.deepStrictEqual(order, [2, 4, 6, 8, 10]);

  console.log('exposed-cameras: OK');
})().catch((error) => {
  console.error('exposed-cameras: FALLO —', error.message);
  process.exit(1);
});
