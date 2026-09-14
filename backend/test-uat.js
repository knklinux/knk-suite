'use strict';

// ============================================================================
// test-uat.js — Pruebas de aceptación (UAT smoke) contra el backend VIVO.
//   node backend/test-uat.js [baseUrl]
// Verifica el recorrido del usuario: salud, cerebro, asistente, memoria,
// jobs, modelos y honestidad del runtime Kali. Falla si algo no responde.
// ============================================================================

const BASE = process.argv[2] || 'http://127.0.0.1:8086';
let pass = 0, fail = 0;
const fails = [];

async function api(path, opts = {}) {
  const r = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, json };
}

function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}

(async () => {
  console.log(`\nUAT knkLinux → ${BASE}\n`);

  // 1. Salud honesta
  const h = await api('/api/health');
  check('health responde', h.status === 200 && h.json?.ok);
  check('sqlite operativa', h.json?.subsystems?.sqlite === true);
  check('vault indexado (>100 notas)', (h.json?.subsystems?.vault?.notes || 0) > 100, `→ ${h.json?.subsystems?.vault?.notes}`);
  const kaliState = h.json?.subsystems?.kali?.status || '';
  check('kali reporta estado honesto', /^RUNTIME_/.test(kaliState), `→ ${kaliState}`);
  if (kaliState === 'RUNTIME_READY') {
    const kt = await api('/api/kali/tools');
    check('inventario de herramientas Kali', kt.json?.ok === true && (kt.json?.tools || []).length >= 10, `→ ${kt.json?.tools?.length} tools`);
    const ke = await api('/api/kali/exec', { method: 'POST', body: JSON.stringify({ command: 'uname -s' }) });
    check('exec en Kali responde', ke.json?.ok === true && /Linux/i.test(ke.json?.stdout || ''));
  } else {
    check('kali sin runtime → razón accionable', /instal|arr[aá]ncala|VBoxManage|wsl|ssh|SSH|rechaz/i.test(h.json?.subsystems?.kali?.reason || ''), `→ ${h.json?.subsystems?.kali?.reason}`);
  }

  // 1a-bis. Selector de runtime de la terminal
  const rt = await api('/api/kali/runtimes');
  check('runtimes responde con las 3 terminales', rt.json?.ok === true && (rt.json?.runtimes || []).length === 3, `→ ${(rt.json?.runtimes || []).length}`);
  const localRt = (rt.json?.runtimes || []).find(x => x.id === 'local');
  check('terminal local siempre disponible', localRt?.available === true);
  check('runtime auto declarado', typeof rt.json?.auto === 'string' && rt.json.auto.length > 0, `→ ${rt.json?.auto}`);

  // 1b. Catálogo del instalador de tools (checkboxes de la UI)
  const tc = await api('/api/kali/tool-catalog');
  check('catálogo de tools responde', tc.json?.ok === true && (tc.json?.catalog || []).length >= 15, `→ ${(tc.json?.catalog || []).length} paquetes`);
  check('catálogo cubre recon/cracking/web/osint', ['recon', 'cracking', 'web', 'osint'].every(c => (tc.json?.categories || []).includes(c)), `→ ${JSON.stringify(tc.json?.categories)}`);

  // 2. Bóveda: búsqueda con contenido real
  const s = await api('/api/vault/search?q=' + encodeURIComponent('escalada privilegios linux'));
  check('bóveda busca en español', (s.json?.results || []).length > 0);
  const s2 = await api('/api/vault/search?q=' + encodeURIComponent('CLLMSE dominios'));
  check('bóveda tiene material de estudio', (s2.json?.results || []).some(r => /cllmse/i.test(r.title + r.file)));

  // 3. Asistente: estado y rutas
  const a = await api('/api/assistant/status');
  check('assistant up con modelos', a.json?.up === true);
  check('assistant tiene las rutas base', ['chat', 'code', 'pentest', 'study'].every(m => m in (a.json?.routes || {})));

  // 4. Memoria del proyecto
  const m = await api('/api/memory', { method: 'POST', body: JSON.stringify({ key: 'uat', value: 'prueba de aceptación' }) });
  check('memoria escribe', m.json?.ok === true && m.json?.id);
  const ml = await api('/api/memory');
  check('memoria lee', (ml.json?.items || []).some(i => i.key === 'uat'));

  // 5. Jobs: lanzar, esperar, leer
  const j = await api('/api/jobs/run', { method: 'POST', body: JSON.stringify({ command: 'echo uat-ok' }) });
  check('job se lanza', j.json?.ok === true && j.json?.job?.id);
  await new Promise(r => setTimeout(r, 2500));
  const jd = await api(`/api/jobs/${j.json.job.id}`);
  check('job termina done con salida', jd.json?.job?.status === 'done' && jd.json?.job?.output.join('').includes('uat-ok'));

  // 6. Modelos: listas y rutas
  const mi = await api('/api/models/installed');
  check('modelos instalados listados', Array.isArray(mi.json?.models) && mi.json.models.length > 0);
  const mc = await api('/api/models/catalog');
  check('catálogo disponible', (mc.json?.catalog || []).length >= 5);
  const mr = await api('/api/models/routes', { method: 'POST', body: JSON.stringify({ chat: 'hermes3:latest' }) });
  check('rutas de modelos persisten', mr.json?.ok === true);

  // 7. UI servida
  const ui = await fetch(BASE + '/');
  const html = await ui.text();
  const bundle = html.match(/src=\"(\/assets\/[^"]+\.js)\"/)?.[1];
  check('index.html servido con bundle', ui.status === 200 && !!bundle);
  if (bundle) {
    const js = await (await fetch(BASE + bundle)).text();
    check('frontend v4 servido', js.includes('v4.0'));
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron${fails.length ? ' → ' + fails.join(', ') : ''}\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('UAT error:', e.message); process.exit(1); });
