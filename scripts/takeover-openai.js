'use strict';
// ============================================================================
// Verificador de SUBDOMAIN TAKEOVER — Programa OpenAI (vector #1)
// Uso:   node scripts/takeover-openai.js
// Salida: knk-suite/.evidencia-takeover/resultados.json
//         knk-suite/.evidencia-takeover/evidencia-takeover-openai.html
//
// 100% pasivo sobre OpenAI: crt.sh (CT logs), resolución DNS, y SOLO cuando
// hay CNAME: 1 petición GET identificada para firmar el estado del host.
// Nunca se registra, compra ni reclama ningún dominio (eso violaría el brief).
// ============================================================================

const dns = require('dns').promises;
const fs = require('fs');
const path = require('path');
const net = require('../backend/lib/net');

const OUT_DIR = path.join(__dirname, '..', '.evidencia-takeover');
const UA = 'knk-suite-researcher/2.0 bug-bounty-knk_linux';

// Fingerprints de servicios potencialmente colgables. Un fingerprint nunca prueba
// por sí solo que el recurso sea reclamable: la claimability debe verificarse
// según la política actual del proveedor y del programa.
const FINGERPRINTS = [
  { re: /There isn't a GitHub Pages site here\./i, servicio: 'GitHub Pages', canTakeover: true },
  { re: /404 Not Found|nginx/, servicio: 'nginx genérico (verificar manual)', canTakeover: 'quizás' },
  { re: /The specified bucket does not exist/i, servicio: 'AWS S3', canTakeover: true },
  { re: /fastly error: unknown domain/i, servicio: 'Fastly', canTakeover: true },
  { re: /Domain not found|Connection not found/i, servicio: 'Fastly/Surge', canTakeover: true },
  { re: /Heroku|No such app/i, servicio: 'Heroku', canTakeover: true },
  { re: /Workspace Pre-Authentication Page/i, servicio: 'Azure', canTakeover: true },
  { re: /404 Web Site not found/i, servicio: 'Azure (App Service)', canTakeover: 'quizás' },
  { re: /The request could not be satisfied/i, servicio: 'CloudFront', canTakeover: 'revisar' },
  { re: /ERROR: The request could not be satisfied/i, servicio: 'CloudFront', canTakeover: 'revisar' },
  { re: /unusual activity.*cloudflare/i, servicio: 'Cloudflare (no colgable)', canTakeover: false },
  { re: /gradual\.com/i, servicio: 'Gradual (activo)', canTakeover: false },
  { re: /swoogo/i, servicio: 'Swoogo (activo)', canTakeover: false },
  { re: /vercel/i, servicio: 'Vercel', canTakeover: false },
];

async function resolveHost(host) {
  // A directo -> CNAME -> NXDOMAIN/ENODATA
  try { return { type: 'A', value: (await dns.resolve4(host)).join(', ') }; }
  catch (e1) {
    try { return { type: 'CNAME', value: (await dns.resolveCname(host)).join(', ') }; }
    catch (e2) {
      try {
        // algunos CNAME solo tienen AAAA
        return { type: 'AAAA', value: (await dns.resolve6(host)).join(', ') };
      } catch (e3) {
        return { type: 'sin-dns', value: (e2.code || e3.code || 'sin registros') };
      }
    }
  }
}

async function fingerprint(url) {
  // 1 GET identificada — solo sobre hosts vivos
  try {
    const r = await net.fetch(url, { timeoutMs: 20000, headers: { 'User-Agent': UA } });
    const body = String(r.text || '').slice(0, 5000);
    let servicio = 'desconocido', canTakeover = 'revisar', match = null;
    for (const f of FINGERPRINTS) {
      if (f.re.test(body)) { servicio = f.servicio; canTakeover = f.canTakeover; match = f.re.source; break; }
    }
    return { status: r.status, location: r.headers.location || null, servicio, canTakeover, match, bodySnippet: body.slice(0, 220).replace(/\s+/g, ' ') };
  } catch (e) {
    return { status: 0, error: e.message, servicio: 'inaccesible', canTakeover: 'revisar' };
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('== 1/4 crt.sh: certificados de openai.com ==');
  let subs = [];
  try {
    const data = await net.getJson('https://crt.sh/?q=' + net.qs('%.openai.com') + '&output=json', { timeoutMs: 60000 });
    const set = new Set();
    for (const row of (Array.isArray(data) ? data : [])) {
      for (const n of String(row.name_value || '').split('\n')) {
        const c = net.normalizeHost(n);
        if (c && (c === 'openai.com' || c.endsWith('.openai.com'))) set.add(c);
      }
    }
    subs = [...set].sort();
  } catch (e) {
    console.log('  crt.sh falló:', e.message, '— intentando caché local previa si existe');
  }
  console.log('  subdominios únicos:', subs.length);

  console.log('== 2/4 DNS: resolviendo', subs.length, 'hosts ==');
  const resultados = [];
  let i = 0;
  for (const sub of subs) {
    i++;
    if (i % 50 === 0) console.log('  progreso:', i, '/', subs.length);
    const r = { sub, dns: await resolveHost(sub) };
    if (r.dns.type === 'sin-dns') {
      r.estado = 'SIN DNS observable (no implica takeover)';
    } else {
      r.estado = 'VIVO';
    }
    resultados.push(r);
    await new Promise(res => setTimeout(res, 120)); // ritmo DNS respetuoso
  }
  const vivos = resultados.filter(r => r.estado === 'VIVO');
  const sinDns = resultados.filter(r => r.estado !== 'VIVO');
  console.log('  vivos:', vivos.length, '| sin DNS:', sinDns.length);

  console.log('== 3/4 CNAME: cadenas de', vivos.length, 'vivos ==');
  for (const r of vivos) {
    try {
      const c = await dns.resolveCname(r.sub);
      r.cname = c.join(', ');
    } catch { r.cname = '(A directo)'; }
    await new Promise(res => setTimeout(res, 100));
  }
  const conCname = vivos.filter(r => r.cname && r.cname !== '(A directo)');

  console.log('== 4/4 HTTP: fingerprint de', conCname.length, 'CNAMEs ==');
  const evidencias = [];
  for (const r of conCname) {
    const fp = await fingerprint('https://' + r.sub + '/');
    r.http = fp;
    evidencias.push({
      sub: r.sub, cname: r.cname, status: fp.status,
      servicio: fp.servicio, canTakeover: fp.canTakeover,
      snippet: fp.bodySnippet || fp.error || '', fecha: new Date().toISOString(),
    });
    console.log('  ', r.sub, '->', r.cname.slice(0, 60), '|', fp.servicio, '|', fp.canTakeover);
    await new Promise(res => setTimeout(res, 1500)); // 1.5s entre peticiones HTTP (norma suite)
  }

  const resumen = {
    fecha: new Date().toISOString(),
    programa: 'OpenAI (Bugcrowd) — vector #1 subdomain takeover',
    metodo: 'pasivo: crt.sh + DNS + 1 GET identificada por CNAME vivo',
    totals: { subdominios: subs.length, vivos: vivos.length, sinDns: sinDns.length, conCname: conCname.length, reclamables: evidencias.filter(e => e.canTakeover === true).length },
    resultados, evidencias,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'resultados.json'), JSON.stringify(resumen, null, 2));

  // HTML bilingüe ES/EN con huecos de captura
  const rows = evidencias.map(e => `
    <tr>
      <td><code>${e.sub}</code></td><td><code>${e.cname}</code></td>
      <td>${e.status}</td><td>${e.servicio}</td>
      <td style="color:${e.canTakeover === true ? '#c0392b' : e.canTakeover === 'quizás' ? '#8e6d1a' : '#27ae60'}">${e.canTakeover === true ? 'SÍ reclamar / claimable' : e.canTakeover === 'quizás' ? 'duda / unclear' : 'NO / no'}</td>
      <td><code style="font-size:10px">${(e.snippet || '').slice(0, 120)}</code></td>
      <td class="gap">🖼️ [captura / screenshot: ${e.sub}]<br>Fecha/Date: ____</td>
    </tr>`).join('');
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Evidencia takeover OpenAI</title>
<style>body{font-family:system-ui;margin:24px;background:#fafafa}h1{font-size:20px}table{border-collapse:collapse;width:100%;font-size:12px;background:#fff}
th,td{border:1px solid #ddd;padding:6px;text-align:left}.gap{background:#fffbe6;border:1px dashed #d4b106;padding:8px}.meta{background:#eef;padding:8px;font-size:12px}</style></head><body>
<h1>🎯 Evidencia — Subdomain Takeover · OpenAI (Bugcrowd) · Vector #1</h1>
<p class="meta"><b>Fecha:</b> ${resumen.fecha}<br><b>Método/Método:</b> pasivo — crt.sh + DNS + fingerprint HTTP (1 GET identificada con UA <code>${UA}</code>)<br>
<b>Totales:</b> ${resumen.totals.subdominios} subdominios · ${resumen.totals.vivos} vivos · ${resumen.totals.sinDns} sin DNS · ${resumen.totals.conCname} con CNAME · <b>${resumen.totals.reclamables} fingerprints potencialmente reclamables</b><br>
<b>AVISO/NOTE:</b> Nunca se registra ni reclama ningún dominio — solo se documenta el estado. / No domain was registered or claimed — state documentation only.</p>
<h2>📡 CNAMEs vivos (los candidatos reales / live candidates)</h2>
<table><thead><tr><th>Subdominio</th><th>CNAME</th><th>HTTP</th><th>Servicio</th><th>¿Reclamable?</th><th>Snippet</th><th>Hueco de captura / Screenshot</th></tr></thead><tbody>${rows || '<tr><td colspan="7">— sin CNAMEs vivos / no live CNAMEs —</td></tr>'}</tbody></table>
<h2>☠️ Subdominios sin DNS (higiene de OpenAI / OpenAI hygiene)</h2>
<p style="font-size:12px">${sinDns.length} hosts sin registros DNS observables (NXDOMAIN/ENODATA) — esto no demuestra por sí solo eliminación ni claimability. / Hosts with no observable DNS records — this alone does not prove deletion or claimability.</p>
<h2>📸 Evidencia del estado observado / Evidence of observed state</h2>
<ol>
<li>Captura del DNS que muestra el CNAME observado (dig/nslookup) / DNS showing observed CNAME: <span class="gap">🖼️ ____</span></li>
<li>Captura del estado HTTP/DNS del destino / HTTP or DNS state of target: <span class="gap">🖼️ ____</span></li>
<li>Solo si el proveedor y el programa lo autorizan expresamente: evidencia de claimability / claimability evidence: <span class="gap">🖼️ ____</span></li>
<li>Paquete reproducible (curl + DNS + política aplicable) en <code>docs/bugbounty/evidencia-takeover/</code>: <span class="gap">📁 ____</span></li>
</ol>
<p style="font-size:11px;color:#666">Generado por knk-suite · scripts/takeover-openai.js · ${resumen.fecha}</p>
</body></html>`;
  fs.writeFileSync(path.join(OUT_DIR, 'evidencia-takeover-openai.html'), html);
  console.log('\n✅ Resultados:', path.join(OUT_DIR, 'resultados.json'));
  console.log('✅ Informe HTML:', path.join(OUT_DIR, 'evidencia-takeover-openai.html'));
  console.log('Reclamables:', resumen.totals.reclamables, '| Con CNAME:', resumen.totals.conCname, '| Sin DNS:', resumen.totals.sinDns);
}

main().catch(e => { console.error('FALLO:', e); process.exit(1); });
