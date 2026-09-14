'use strict';

// ============================================================================
// hls-proxy-audit.test.js — tests del check de proxies HLS mal configurados
//
// Todo sin red: manifiestos de fixture, allowlist real de KNK y sonda activa
// con fetch inyectado. Se verifican:
//   * patrón de proxy abierto detectado (reescritura de host ajeno);
//   * proxy bien configurado (solo hosts del propio origen) → sin hallazgo;
//   * manifiesto CDN clásico (URLs absolutas sin patrón proxy) → sin hallazgo;
//   * severidad razonada (sonda activa que confirma reenvío ⇒ high);
//   * conversión a hallazgo auditable con evidencia, dedup y details.
// ============================================================================

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const audit = require('./lib/hls-proxy-audit');
const findings = require('./lib/camera-findings');

let passed = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); }
  else { failures.push(name); console.log(`  ✘ ${name}${extra ? ' — ' + extra : ''}`); }
}

// ── Fixtures de manifiestos ────────────────────────────────────────────────

// 1) Proxy abierto típico: origen A, recursos embebidos de host ajeno B.
const OPEN_PROXY_MANIFEST_URL = 'https://camara-ejemplo.org/stream/master.m3u8';
const OPEN_PROXY_BODY = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:6',
  '#EXTINF:6.0,',
  'https://camara-ejemplo.org/stream/media_1.ts?u=https%3A%2F%2Fcdn-ajeno.example%2Fseg%2Fmedia_1.ts',
  '#EXTINF:6.0,',
  'https://camara-ejemplo.org/stream/media_2.ts?u=https%3A%2F%2Fcdn-ajeno.example%2Fseg%2Fmedia_2.ts',
  '#EXTINF:6.0,',
  'https://camara-ejemplo.org/stream/media_3.ts?u=https%3A%2F%2Fcdn-ajeno.example%2Fseg%2Fmedia_3.ts',
  '#EXT-X-ENDLIST',
].join('\n');

// 2) Proxy bien configurado: mismo patrón, pero los embebidos son del propio host.
const SAFE_PROXY_BODY = [
  '#EXTM3U',
  '#EXTINF:6.0,',
  'https://camara-ejemplo.org/stream/media_1.ts?url=https%3A%2F%2Fcamara-ejemplo.org%2Fseg%2Fmedia_1.ts',
  '#EXTINF:6.0,',
  'https://camara-ejemplo.org/stream/media_2.ts?url=https%3A%2F%2Fcamara-ejemplo.org%2Fseg%2Fmedia_2.ts',
  '#EXT-X-ENDLIST',
].join('\n');

// 3) CDN clásico: URLs absolutas, sin patrón de proxy.
const CDN_BODY = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=1280000',
  'https://cdn-ejemplo.net/live/chunklist.m3u8',
  '#EXTINF:6.0,',
  'https://cdn-ejemplo.net/live/media_1.ts',
  '#EXT-X-ENDLIST',
].join('\n');

// ── 1) Proxy abierto: detectado ─────────────────────────────────────────────
{
  const a = audit.analyzeManifest({ url: OPEN_PROXY_MANIFEST_URL, body: OPEN_PROXY_BODY });
  ok('patrón de proxy detectado', a.proxySuspected === true, `${a.segments} recursos`);
  ok('host ajeno identificado', a.finding === true && a.foreignHost === 'cdn-ajeno.example', a.foreignHost);
  ok('kind = foreign-host-rewrite', a.kind === 'foreign-host-rewrite');
  ok('checks incluyen foreign-host-rewrite', a.checks.some((c) => c.id === 'foreign-host-rewrite'));
  ok('score razonable', a.score >= 55 && a.score <= 100, `${a.score}/100`);
}

// ── 2) Proxy bien configurado: sin hallazgo ────────────────────────────────
{
  const a = audit.analyzeManifest({ url: OPEN_PROXY_MANIFEST_URL, body: SAFE_PROXY_BODY });
  ok('mismo-host: proxy presente pero sin hallazgo', a.proxySuspected === true && a.finding === false, a.kind);
  ok('kind = same-host-rewrite', a.kind === 'same-host-rewrite');
}

// ── 3) CDN clásico: sin hallazgo ───────────────────────────────────────────
{
  const a = audit.analyzeManifest({ url: 'https://canal-ejemplo.tv/live/master.m3u8', body: CDN_BODY });
  ok('CDN sin patrón proxy: sin hallazgo', a.finding === false && a.kind === 'no-proxy-pattern', a.kind);
}

// ── 4) Allowlist real de KNK ───────────────────────────────────────────────
{
  // Host ajeno arbitrario → allowlisted === false → severity high en la conversión.
  const a = audit.analyzeManifest({ url: OPEN_PROXY_MANIFEST_URL, body: OPEN_PROXY_BODY });
  ok('host ajeno NO está en allowlist pública', a.allowlisted === false, String(a.allowlisted));
  ok('severity base = high (fuera de allowlist)', findings.hlsSeverityFor(a) === 'high');

  // Fixture con el host embebido en la allowlist de KNK (nysdot.skyvdn.com, 511NY).
  const KNK_BODY = [
    '#EXTM3U',
    '#EXTINF:6.0,',
    'https://proxy.ejemplo.org/hls?u=' + encodeURIComponent('https://s52.nysdot.skyvdn.com/rtb/live/media_1.ts'),
    '#EXT-X-ENDLIST',
  ].join('\n');
  const b = audit.analyzeManifest({ url: 'https://proxy.ejemplo.org/hls', body: KNK_BODY });
  ok('host KNK en allowlist detectado', b.finding === true && b.allowlisted === true, `${b.foreignHost}`);
  ok('severity base = medium (allowlist conocida)', findings.hlsSeverityFor(b) === 'medium');
}

// ── 5) Sonda activa con fetch inyectado ────────────────────────────────────
(async () => {
  {
    const a = audit.analyzeManifest({ url: OPEN_PROXY_MANIFEST_URL, body: OPEN_PROXY_BODY });
    const p = await audit.probeProxy({ analysis: a, fetchImpl: async () => ({ status: 200 }) });
    ok('sonda: reenvío confirmado (200)', p.attempted === true && p.reachable === true && p.status === 200);
    const sev = findings.hlsSeverityFor({ ...a, probe: p });
    ok('sonda 200 ⇒ severity high', sev === 'high');
  }
  {
    const a = audit.analyzeManifest({ url: OPEN_PROXY_MANIFEST_URL, body: OPEN_PROXY_BODY });
    const p = await audit.probeProxy({ analysis: a, fetchImpl: async () => ({ status: 403 }) });
    ok('sonda: proxy valida y rechaza (403)', p.attempted === true && p.reachable === false && p.status === 403);
    const sev = findings.hlsSeverityFor({ ...a, probe: p });
    ok('sonda 403 con host fuera de allowlist ⇒ sigue high', sev === 'high');
    // El camino a medium exige host en allowlist conocida y sonda sin confirmar:
    const KNK_BODY = [
      '#EXTM3U',
      '#EXTINF:6.0,',
      'https://proxy.ejemplo.org/hls?u=' + encodeURIComponent('https://s52.nysdot.skyvdn.com/rtb/live/media_1.ts'),
      '#EXT-X-ENDLIST',
    ].join('\n');
    const b = audit.analyzeManifest({ url: 'https://proxy.ejemplo.org/hls', body: KNK_BODY });
    const p403 = { ok: true, attempted: true, reachable: false, status: 403, latencyMs: 5, note: 'rechazado' };
    ok('sonda 403 con host EN allowlist ⇒ medium', findings.hlsSeverityFor({ ...b, probe: p403 }) === 'medium');
  }
  {
    const safe = audit.analyzeManifest({ url: OPEN_PROXY_MANIFEST_URL, body: SAFE_PROXY_BODY });
    const p = await audit.probeProxy({ analysis: safe, fetchImpl: async () => { throw new Error('no debe llamarse'); } });
    ok('sonda sin hallazgo: no se intenta nada', p.attempted === false);
  }

  // ── 6) Conversión a hallazgo auditable ───────────────────────────────────
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'knk-hls-audit-'));
  const store = {
    list: [],
    listFindings() { return this.list; },
    addFinding(row) { const id = this.list.length + 1; this.list.push({ id, ...row }); return id; },
    addEvidence() {},
  };
  const a = audit.analyzeManifest({ url: OPEN_PROXY_MANIFEST_URL, body: OPEN_PROXY_BODY });
  const conv = findings.convertHlsAudit({
    analysis: a,
    manifestUrl: OPEN_PROXY_MANIFEST_URL,
    store,
    writeEvidence: ({ name, text }) => { const f = path.join(tmp, name); fs.writeFileSync(f, text, 'utf8'); return f; },
    now: '2026-09-14T00:00:00.000Z',
  });

  ok('conversión ok con hallazgo', conv.ok === true && conv.finding === true);
  ok('tipo de hallazgo = hls-open-proxy', conv.type === findings.TYPE_HLS && conv.type === 'hls-open-proxy', conv.type);
  ok('hallazgo creado con id', conv.created && typeof conv.created.id === 'number');
  ok('evidencia escrita', typeof conv.created.evidence === 'string' && fs.existsSync(conv.created.evidence));
  const text = fs.readFileSync(conv.created.evidence, 'utf8');
  ok('evidencia: manifiesto y veredicto presentes', text.includes(OPEN_PROXY_MANIFEST_URL) && text.includes('REESCRITURA DE HOST AJENO'));
  ok('evidencia: recurso embebido reproducible', text.includes('curl') && text.includes('cdn-ajeno.example'));

  const row = store.list[0];
  ok('row: severity high', row.severity === 'high', row.severity);
  ok('row: details con foreignHost y checks', row.details.foreignHost === 'cdn-ajeno.example' && Array.isArray(row.details.checks));
  ok('row: verification candidato-no-verificado', row.details.verification === 'candidato-no-verificado');
  ok('row: asset = host del proxy', row.details.asset === 'camara-ejemplo.org');

  // dedup por manifestUrl
  const dup = findings.convertHlsAudit({ analysis: a, manifestUrl: OPEN_PROXY_MANIFEST_URL, store, writeEvidence: () => { throw new Error('no debe escribir'); } });
  ok('dedup: no duplica el mismo manifiesto', dup.duplicate === true && dup.findingId === 1 && store.list.length === 1);

  // sin hallazgo ⇒ no escribe nada
  const safe = audit.analyzeManifest({ url: OPEN_PROXY_MANIFEST_URL, body: SAFE_PROXY_BODY });
  const none = findings.convertHlsAudit({ analysis: safe, manifestUrl: OPEN_PROXY_MANIFEST_URL, store, writeEvidence: () => { throw new Error('no debe escribir'); } });
  ok('sin hallazgo: no se crea finding ni evidencia', none.ok === true && none.finding === false && !none.created && store.list.length === 1);
  ok('sin hallazgo: recomendación disponible', typeof findings.hlsRecommendationFor(safe) === 'string' && /Sin acción/.test(findings.hlsRecommendationFor(safe)));

  // con sonda confirmada en details
  const probe = { ok: true, attempted: true, reachable: true, status: 200, latencyMs: 12, note: 'reenvío confirmado' };
  const withProbe = findings.convertHlsAudit({ analysis: a, manifestUrl: OPEN_PROXY_MANIFEST_URL, probe, store, writeEvidence: () => path.join(tmp, 'x.txt'), now: '2026-09-14T00:00:01.000Z' });
  // (dedup activo: la URL es la misma, pero verificamos el shape de severidad aparte)
  ok('sonda confirmada ⇒ severity high', withProbe.severity === 'high');

  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(failures.length === 0
    ? `\nhls-proxy-audit: OK — ${passed} comprobaciones`
    : `\nhls-proxy-audit: ${failures.length} fallos`);
  if (failures.length) { console.error('Fallos:'); for (const f of failures) console.error('  - ' + f); }
  process.exit(failures.length === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
