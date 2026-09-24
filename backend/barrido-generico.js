'use strict';
// ============================================================================
// barrido-generico.js — Barrido re-targetable NaN / CORS / open-redirect / SSRF
// para CUALQUIER programa nuevo, sin escribir código: solo un JSON de config.
//
//   node backend/barrido-generico.js <config.json>              # plan (seco)
//   node backend/barrido-generico.js <config.json> --ejecutar   # lanza
//   node backend/barrido-generico.js --plantilla > mi.json      # esqueleto
//
// Hereda de las guardias del suite (sin duplicar nada):
//   · net.fetch  → scope (solo host declarado), rate-limit, redacción de
//                  secretos en la evidencia, volcado automático de cabeceras
//                  efectivas y el aviso de huella de automatizado.
//   · lib/muestras.js → cada sonda se replica hasta 2 muestras concluyentes
//                  concordantes; un corte de borde (429/502/503/504 o HTML del
//                  CDN) no cuenta como muestra; discrepancia ⇒ INCONCLUSO.
//
// Formato del JSON de configuración (véase --plantilla):
//   {
//     "programa": "mi-programa",
//     "scope": "api.midominio.com",           // ÚNICO host al que se dispara
//     "base": "https://api.midominio.com",
//     "rate_limit_ms": 3000,
//     "cabeceras": { "Accept": "application/json" },
//     "sondas": [
//       { "id": "nan-precio", "tipo": "nan",
//         "metodo": "POST", "ruta": "/v1/cotizador",
//         "campo": "amount", "valores": ["NaN", "Infinity", "1e999", "-1"],
//         "plantilla": { "moneda": "USD" } },
//       { "id": "cors-listado", "tipo": "cors",
//         "metodo": "GET", "ruta": "/v1/public/items",
//         "origen": "https://evil.example" },
//       { "id": "redir-login", "tipo": "redirect",
//         "metodo": "GET", "ruta": "/salir?url=", "param": "url",
//         "destino": "https://evil.example/receptor" }
//     ]
//   }
//
// REGLA DE COSTE: seco por defecto. El plan nunca manda una petición; cada
// pasada deja evidencia JSON con el coste exacto y las cabeceras volcadas.
// ============================================================================

const fs = require('fs');
const path = require('path');
const net = require('./lib/net');
const muestras = require('./lib/muestras');

const RAIZ = path.join(__dirname, '..');

// ── Clasificadores declarativos (puros) ──────────────────────────────────────

/** NaN: el hallazgo es un 5xx o una fuga de infraestructura interna. */
function clasificadorNan(r) {
  const cuerpo = String(r.cuerpo || '');
  const fuga = /openai\.internal|svc\.cluster\.local|[\w.-]+\.internal\b|[\w.-]+\.corp\b|file\s+\\?"\/[\w/.-]+\\?"|line \d+, in <module>/i.test(cuerpo);
  if (r.status >= 500) {
    return { veredicto: 'SOSPECHOSO', motivo: `status ${r.status} con valor degenerado en el campo numérico${fuga ? ' + FUGA INTERNA en el cuerpo' : ''}`, concluyente: true, fuga };
  }
  if (fuga) {
    return { veredicto: 'FUGA_INTERNA', motivo: 'el error filtra rutas/hosts internos', concluyente: true, fuga: true };
  }
  return { veredicto: 'LIMPIO', motivo: `status ${r.status} sin 5xx ni fuga`, concluyente: true };
}

/** CORS: hallazgo si ACAO refleja NUESTRO origen atacante con credenciales, o un wildcard con credenciales. */
function clasificadorCors(r) {
  const h = r.headers || {};
  const acao = h['access-control-allow-origin'];
  const acac = h['access-control-allow-credentials'];
  const acaoLista = Array.isArray(acao) ? acao.join(', ') : acao;
  if (!acaoLista) return { veredicto: 'LIMPIO', motivo: 'sin Access-Control-Allow-Origin', concluyente: true };
  const refleja = acaoLista.includes(r.origenAtaque || '');
  const wildcard = acaoLista.trim() === '*';
  const cred = String(acac).toLowerCase() === 'true';
  if ((refleja || wildcard) && cred) {
    return { veredicto: 'SOSPECHOSO', motivo: `ACAO ${refleja ? 'refleja el origen de ataque' : 'wildcard'} CON allow-credentials: true`, concluyente: true };
  }
  if (refleja && !cred) {
    return { veredicto: 'POSIBLE', motivo: 'ACAO refleja el origen pero sin credenciales (impacto limitado a datos públicos)', concluyente: true };
  }
  return { veredicto: 'LIMPIO', motivo: `ACAO estático sin reflejo (${acaoLista.slice(0, 60)})`, concluyente: true };
}

/** Open redirect: hallazgo si Location apunta al destino externo de ataque. */
function clasificadorRedirect(r) {
  const h = r.headers || {};
  const loc = (h.location && (Array.isArray(h.location) ? h.location[0] : h.location)) || '';
  if (r.status >= 300 && r.status < 400 && loc) {
    if (/^https?:\/\//i.test(loc) && !r.hostObjetivo) {
      // host objetivo llega como propiedad extra en la medición
    }
    if (r.destinoAtaque && loc.includes(r.destinoAtaque)) {
      return { veredicto: 'SOSPECHOSO', motivo: `redirección abierta a ${loc.slice(0, 80)}`, concluyente: true };
    }
    return { veredicto: 'LIMPIO', motivo: `redirige a destino propio (${loc.slice(0, 60)})`, concluyente: true };
  }
  return { veredicto: 'LIMPIO', motivo: `status ${r.status} sin Location externo`, concluyente: true };
}

/**
 * SSRF: el veredicto se decide por GOLPES EN EL LOG DEL CANARIO, no por la
 * respuesta del objetivo (que suele ser un 200 de cortesía). El nonce por
 * sonda aísla cada medición; el log es JSON Lines en evidencia-poc/http/.
 */
const EVID_HTTP = path.join(RAIZ, 'evidencia-poc', 'http');
const LOG_CANARIO = path.join(EVID_HTTP, 'canario-ssrf-log.json');

function golpesCanario(nonce, logPath) {
  let lineas = [];
  const ruta = logPath || process.env.KNK_CANARY_LOG || LOG_CANARIO;
  try { lineas = fs.readFileSync(ruta, 'utf8').split('\n').filter(Boolean); } catch (e) { return []; }
  return lineas
    .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
    .filter((e) => e && e.path === '/hit' && String(e.query && e.query.canary) === nonce)
    .map((e) => ({ ts: e.ts, ip: e.ip, ua: e.ua, url: e.urlCompleta }));
}

function clasificadorSsrf(r) {
  const golpes = golpesCanario(r.nonceEsperado || '');
  const u = String(r.urlEnviada || '');
  const llegoInterno = u.includes('169.254.169.254') || u.includes('10.0.0.1') || u.includes('100.64.0.1');
  if (golpes.length >= 1) {
    return { veredicto: 'SOSPECHOSO', motivo: 'canario golpeado ' + golpes.length + '× con el nonce de esta sonda (' + (golpes[0].ip || 'ip?') + '): el objetivo fetchó nuestra URL', concluyente: true, golpes };
  }
  if (llegoInterno && r.status >= 200 && r.status < 500 && r.status !== 401 && r.status !== 403) {
    return { veredicto: 'POSIBLE', motivo: 'la respuesta (' + r.status + ') sugiere que el objetivo procesó la URL interna, pero el canario no recibió hit — revisar manualmente', concluyente: true };
  }
  if (r.status >= 500) {
    return { veredicto: 'SOSPECHOSO', motivo: 'status ' + r.status + ' al enviar nuestra URL: el fetch del objetivo pudo reventar (revisar cuerpo)', concluyente: true };
  }
  return { veredicto: 'LIMPIO', motivo: 'status ' + r.status + ' sin golpes del canario para este nonce', concluyente: true };
}

const CLASIFICADORES = { nan: clasificadorNan, cors: clasificadorCors, redirect: clasificadorRedirect, ssrf: clasificadorSsrf };

// ── Generadores de sondas ────────────────────────────────────────────────────

function sondasNan(base, s) {
  const valores = s.valores || ['NaN', 'Infinity', '1e999', '-1'];
  const fuera = [];
  for (const v of valores) {
    const plantilla = s.plantilla || {};
    let body;
    if (v === 'NaN' || v === 'Infinity' || v === '1e999') {
      // JSON CRUDO: json.loads de Python los acepta; JSON.stringify de Node NO
      // puede emitirlos (los emite null: 1e999 === Infinity en JS).
      const conValor = JSON.stringify({ ...plantilla, [s.campo]: '@@VALOR@@' });
      body = conValor.replace('"@@VALOR@@"', v);
    } else {
      body = JSON.stringify({ ...plantilla, [s.campo]: v });
    }
    fuera.push({ id: `${s.id}[${v}]`, tipo: 'nan', metodo: s.metodo || 'POST', ruta: s.ruta, body, campo: s.campo, valor: v });
  }
  return fuera;
}

function sondasCors(base, s) {
  return [{
    id: s.id, tipo: 'cors', metodo: s.metodo || 'GET', ruta: s.ruta,
    origenAtaque: s.origen || 'https://evil.example',
  }];
}

function sondasRedirect(base, s) {
  return [{
    id: s.id, tipo: 'redirect', metodo: s.metodo || 'GET',
    ruta: `${s.ruta}${encodeURIComponent(s.destino || 'https://evil.example')}`,
    destinoAtaque: s.destino || 'https://evil.example',
  }];
}

/** Injerta la URL del receptor evitando el doble esquema (https://https://)
 *  cuando la plantilla ya lleva el suyo delante del marcador. PURA. */
function injertarReceptor(plantilla, receptor) {
  const texto = String(plantilla);
  if (texto.includes('://__RECEPTOR__')) {
    return texto.split('://__RECEPTOR__').join('://' + receptor.replace(/^https?:\/\//, ''));
  }
  return texto.split('__RECEPTOR__').join(receptor);
}

function sondasSsrf(base, s) {
  const valores = s.valores || ['https://__RECEPTOR__/step1', 'http://169.254.169.254/latest/meta-data/'];
  return valores.map((v) => {
    const nonce = 'knk-' + s.id + '-' + Math.random().toString(36).slice(2, 8);
    const url = v.includes('__RECEPTOR__')
      ? v + (v.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(nonce)
      : v;
    const cuerpo = s.plantilla ? JSON.stringify({ ...s.plantilla, [s.campo]: url }) : undefined;
    return { id: s.id + '[' + v.slice(0, 44) + ']', tipo: 'ssrf', metodo: s.metodo || 'POST', ruta: s.ruta,
      body: cuerpo, urlEnviada: url, nonceEsperado: nonce, campo: s.campo, valor: v };
  });
}

/** Valida el JSON de configuración; devuelve lista de errores. */
function validarConfig(cfg) {
  const errores = [];
  if (!cfg || typeof cfg !== 'object') return ['la configuración no es un objeto'];
  if (!cfg.programa) errores.push('falta "programa"');
  if (!cfg.scope || /\s/.test(cfg.scope)) errores.push('"scope" debe ser el hostname ÚNICO al que disparar');
  if (!cfg.base || !/^https:\/\//.test(cfg.base)) {
    errores.push('"base" debe ser una URL https:// explícita');
  } else if (cfg.scope && !cfg.base.startsWith(`https://${cfg.scope}`)) {
    errores.push(`"base" (${cfg.base}) no pertenece al scope declarado (${cfg.scope})`);
  }
  if (!Array.isArray(cfg.sondas) || !cfg.sondas.length) errores.push('"sondas" debe ser una lista no vacía');
  (cfg.sondas || []).forEach((s, i) => {
    if (!s.id) errores.push(`sonda[${i}]: falta "id"`);
    if (!CLASIFICADORES[s.tipo]) errores.push(`sonda[${i}] (${s.id}): "tipo" debe ser nan|cors|redirect|ssrf`);
    if (!s.ruta) errores.push(`sonda[${i}] (${s.id}): falta "ruta"`);
    if (s.tipo === 'nan' && !s.campo) errores.push(`sonda[${i}] (${s.id}): nan necesita "campo"`);
    if (s.tipo === 'ssrf' && !s.campo) errores.push(`sonda[${i}] (${s.id}): ssrf necesita "campo"`);
  });
  return errores;
}

/** Expande la configuración a sondas crudas listas para medir. */
function expandir(cfg) {
  const crudas = [];
  for (const s of cfg.sondas) {
    if (s.tipo === 'nan') crudas.push(...sondasNan(cfg.base, s));
    else if (s.tipo === 'cors') crudas.push(...sondasCors(cfg.base, s));
    else if (s.tipo === 'redirect') crudas.push(...sondasRedirect(cfg.base, s));
    else if (s.tipo === 'ssrf') crudas.push(...sondasSsrf(cfg.base, s));
  }
  return crudas;
}

// ── Medición con la guardia heredada ─────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** La URL del receptor canario: explícita en config, o la ÚLTIMA pelada del
 *  log del canary (convención del preflight/watchdog). */
function urlReceptor(cfg, txtPath) {
  if (cfg && cfg.receptor) return String(cfg.receptor);
  try {
    const ruta = txtPath || process.env.KNK_CANARY_TXT || path.join(EVID_HTTP, 'canario-ssrf-log.txt');
    const lineas = fs.readFileSync(ruta, 'utf8').split('\n').filter(Boolean);
    for (let i = lineas.length - 1; i >= 0; i--) {
      const m = lineas[i].trim().match(/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/);
      if (m) return m[0];
    }
    return null;
  } catch (e) { return null; }
}

async function medirUna(base, cabeceras, s) {
  const t0 = Date.now();
  const opts = {
    method: s.metodo || 'GET',
    headers: { ...cabeceras, ...(s.tipo === 'cors' ? { Origin: s.origenAtaque } : {}) },
    maxRedirects: 0,
  };
  if (s.body !== undefined && s.body !== null) opts.body = s.body;
  // SSRF: la URL real del receptor se inyecta al vuelo — no viaja en el plan.
  const rutaReal = (s.tipo === 'ssrf' && s.urlEnviada) ? injertarReceptor(s.ruta, s.urlEnviada) : s.ruta;
  const r = await net.fetch(`${base}${rutaReal}`, opts).catch((e) => ({ status: 0, text: '', headers: {}, error: e.message }));
  return {
    status: r.status,
    headers: r.headers || {},
    cuerpo: String(r.text || '').slice(0, 400),
    ms: Date.now() - t0,
    // contexto que el clasificador necesita (puras, sin cierre sobre el mundo)
    origenAtaque: s.origenAtaque,
    destinoAtaque: s.destinoAtaque,
    urlEnviada: s.urlEnviada,
    nonceEsperado: s.nonceEsperado,
  };
}

async function barrer(cfg, { seco = true } = {}) {
  const errores = validarConfig(cfg);
  if (errores.length) {
    return { ok: false, errores, plan: [], resultados: [], peticiones: 0 };
  }
  const crudas = expandir(cfg);
  const haySsrf = crudas.some((s) => s.tipo === 'ssrf');
  const receptor = haySsrf ? urlReceptor(cfg) : null;
  if (haySsrf && !receptor) {
    return { ok: false, errores: ['hay sondas ssrf pero falta "receptor": la URL del túnel canario (con --ejecutar se resuelve del log del canary o se levanta el túnel; en seco declárala en el JSON)'], plan: [], resultados: [], peticiones: 0 };
  }
  const crudasConReceptor = haySsrf
    ? crudas.map((s) => (s.tipo === 'ssrf' ? {
      ...s,
      urlEnviada: injertarReceptor(s.urlEnviada, receptor),
      body: typeof s.body === 'string' ? injertarReceptor(s.body, receptor) : s.body,
    } : s))
    : crudas;
  const plan = crudasConReceptor.map((s) => `${s.metodo || 'GET'} ${s.ruta} [${s.id}]${s.tipo === 'ssrf' ? ' → ' + s.urlEnviada.slice(0, 60) : ''}`);

  if (seco) {
    return { ok: true, seco: true, programa: cfg.programa, scope: cfg.scope, receptor: receptor || undefined, plan, resultados: [], peticiones: 0 };
  }

  net.setScope([cfg.scope]);
  net.setRateLimit(cfg.rate_limit_ms || 3000);
  net.setMaxBatch(5);

  const resultados = [];
  for (const s of crudasConReceptor) {
    const clasificador = CLASIFICADORES[s.tipo];
    const { muestras: ms, decision } = await muestras.medirConRepeticion({
      medir: async () => {
        const r = await medirUna(cfg.base, cfg.cabeceras || {}, s);
        // SSRF: el fetch del objetivo llega DESPUÉS de su respuesta — gracia
        // para que el golpe aterrice en el log antes de clasificar.
        const gracia = s.tipo === 'ssrf' ? (cfg.espera_golpe_ms !== undefined ? cfg.espera_golpe_ms : 2500) : 0;
        if (gracia > 0) await sleep(gracia);
        return r;
      },
      clasificador,
      minMuestras: cfg.min_muestras || muestras.MIN_MUESTRAS,
      maxIntentos: 3,
      pausaMs: cfg.rate_limit_ms || 3000,
      sleep,
    });
    const ultima = ms[ms.length - 1] || {};
    resultados.push({
      id: s.id, tipo: s.tipo, ruta: s.ruta,
      ...(s.campo ? { campo: s.campo, valor: s.valor } : {}),
      veredicto: decision.veredicto,
      motivo: decision.motivo,
      nMuestras: ms.length,
      status: ultima.status, ms: ultima.ms,
      cuerpo: String(ultima.cuerpo || '').slice(0, 200),
    });
    const icono = decision.veredicto === 'SOSPECHOSO' ? '⚠️ ' : decision.veredicto === 'INCONCLUSO' ? '❓' : decision.veredicto === 'POSIBLE' ? '🟡' : '✓';
    console.log(`  ${icono} [${s.id}] ${decision.veredicto} (status ${ultima.status}, ${ms.length} muestra(s)): ${decision.motivo}`);
    await sleep(cfg.rate_limit_ms || 3000);
  }

  const sospechosos = resultados.filter((r) => r.veredicto === 'SOSPECHOSO');
  const inconclusos = resultados.filter((r) => r.veredicto === 'INCONCLUSO');
  return {
    ok: true, seco: false, programa: cfg.programa, scope: cfg.scope,
    plan, resultados, sospechosos, inconclusos,
    peticiones: resultados.reduce((a, r) => a + (r.nMuestras || 0), 0),
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function plantilla() {
  return {
    programa: 'mi-programa',
    scope: 'api.midominio.com',
    base: 'https://api.midominio.com',
    rate_limit_ms: 3000,
    min_muestras: 2,
    cabeceras: { Accept: 'application/json', 'Content-Type': 'application/json' },
    sondas: [
      { id: 'nan-monto', tipo: 'nan', metodo: 'POST', ruta: '/v1/cotizador', campo: 'amount', valores: ['NaN', 'Infinity', '1e999', '-1'], plantilla: { moneda: 'USD' } },
      { id: 'cors-publico', tipo: 'cors', metodo: 'GET', ruta: '/v1/public/items', origen: 'https://evil.example' },
      { id: 'redir-salida', tipo: 'redirect', metodo: 'GET', ruta: '/salir?url=', destino: 'https://evil.example/receptor' },
      { id: 'ssrf-preview', tipo: 'ssrf', metodo: 'POST', ruta: '/v1/link-preview', campo: 'url',
        valores: ['https://__RECEPTOR__/step1', 'http://169.254.169.254/latest/meta-data/'], plantilla: { url: '' } },
    ],
    // receptor: URL del túnel canario; el CLI la resuelve del log del canary al ejecutar
  };
}

module.exports = {
  validarConfig, expandir, barrer, plantilla,
  clasificadorNan, clasificadorCors, clasificadorRedirect, clasificadorSsrf,
  golpesCanario, urlReceptor, injertarReceptor,
  CLASIFICADORES,
};

/** Receptor vivo SOLO para el CLI: log del canary → verificación HTTP del
 *  túnel; si falta, levanta canario local y quick tunnel (nunca toca una
 *  instancia cloudflared ajena: no mata procesos, solo añade el suyo). */
async function receptorVivo() {
  const { spawn } = require('child_process');
  let url = urlReceptor();
  const check = async (u) => {
    try { const r = await fetch(u + '/hit', { signal: AbortSignal.timeout(8000) }); return r.status === 204; }
    catch (e) { return false; }
  };
  if (url && await check(url)) return url;

  // canario local (si no hay nadie en 8210)
  try { await fetch('http://127.0.0.1:8210/hit', { signal: AbortSignal.timeout(1500) }); }
  catch (e) {
    const canary = spawn(process.execPath, [path.join(__dirname, 'canario-ssrf.js')], { stdio: 'ignore' });
    process.on('exit', () => { try { canary.kill(); } catch (e2) {} });
    await sleep(1200);
  }

  // quick tunnel: solo añade SU instancia (detached), nunca mata otras
  const cloudflared = path.join(RAIZ, 'tools', 'cloudflared.exe');
  if (fs.existsSync(cloudflared)) {
    const hijo = spawn(cloudflared, ['tunnel', '--url', 'http://127.0.0.1:8210', '--no-autoupdate'], { cwd: RAIZ, stdio: 'ignore', detached: true });
    hijo.unref();
    const inicio = fs.existsSync(path.join(EVID_HTTP, 'canario-ssrf-log.txt'))
      ? fs.readFileSync(path.join(EVID_HTTP, 'canario-ssrf-log.txt'), 'utf8').length : 0;
    for (let i = 0; i < 45; i++) {
      await sleep(1000);
      const added = fs.readFileSync(path.join(EVID_HTTP, 'canario-ssrf-log.txt'), 'utf8').slice(inicio);
      const m = added.split('\n').map((l) => l.trim().match(/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/)).find(Boolean);
      if (m) { url = m[0]; break; }
    }
  }
  return (url && await check(url)) ? url : null;
}

if (require.main === module) {
(async () => {
  const argv = process.argv.slice(2);
  if (argv.includes('--plantilla')) {
    console.log(JSON.stringify(plantilla(), null, 2));
    return;
  }
  const fichero = argv.find((a) => !a.startsWith('--'));
  if (!fichero || !fs.existsSync(fichero)) {
    console.error('Uso: node backend/barrido-generico.js <config.json> [--ejecutar] [--sin-tunel]  |  --plantilla');
    process.exit(1);
  }
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(fichero, 'utf8')); } catch (e) { console.error('JSON inválido:', e.message); process.exit(1); }

  const ejecutar = argv.includes('--ejecutar');
  const quiereTunel = !argv.includes('--sin-tunel');
  if (ejecutar && quiereTunel && (cfg.sondas || []).some((s) => s.tipo === 'ssrf') && !cfg.receptor) {
    const receptor = await receptorVivo();
    if (!receptor) { console.error('El túnel canario no está disponible — usa --sin-tunel o fija "receptor" en el JSON.'); process.exit(3); }
    cfg = { ...cfg, receptor };
    console.log('Receptor SSRF:', receptor);
  }
  const res = await barrer(cfg, { seco: !ejecutar });

  if (!res.ok) {
    console.error('CONFIGURACIÓN INVÁLIDA:');
    for (const e of res.errores) console.error('  ✗', e);
    process.exit(2);
  }

  console.log(`── Barrido genérico: ${res.programa} · scope=${res.scope} ──`);
  console.log(`Plan: ${res.plan.length} sondas${res.seco ? ' (SECO — 0 peticiones)' : ''}`);
  for (const p of res.plan) console.log('   ·', p);

  if (res.seco) {
    console.log('\nNada lanzado. Revisa el plan y añade --ejecutar.');
    process.exit(0);
  }

  const ficheroRes = path.join(RAIZ, 'evidencia-poc', 'http', `barrido-generico-${res.programa}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
  fs.mkdirSync(path.dirname(ficheroRes), { recursive: true });
  fs.writeFileSync(ficheroRes, JSON.stringify(res, null, 2) + '\n');
  console.log(`\nCoste: ${res.peticiones} peticiones · evidencia: ${path.relative(RAIZ, ficheroRes)}`);
  console.log(res.sospechosos.length
    ? `⚠️ ${res.sospechosos.length} SOSPECHOSO(s): ${res.sospechosos.map((s) => s.id).join(', ')} — revisar antes de reportar.`
    : `Sin hallazgos en esta pasada (${res.inconclusos.length} inconcluso(s) por borde).`);
})().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });
}
