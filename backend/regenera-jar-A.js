'use strict';
// regenera-jar-A.js — Regenera el jar de la cuenta A desde su sesión de navegador viva.
//   node backend/regenera-jar-A.js [perfil] [puerto]
//   por defecto: perfil openai-cuenta-a, puerto 9336.
// Pasos: abrir/adjuntar canal CDP → navegar a chatgpt.com → informar del estado
// (¿challenge de Cloudflare?) → esperar a que el usuario pase el challenge →
// capturar cookies por host EXACTO (chatgpt.com / .chatgpt.com, nunca mezclar
// con openai.com) → escribir jar (backup del anterior) → verificar con una
// llamada a /api/auth/session (id distinto al de B) y /backend-api/me con Bearer.
const fs = require('fs');
const path = require('path');
const { abrirCanal } = require('./lib/browser');

const PERFIL = process.argv[2] || 'openai-cuenta-a';
const PUERTO = parseInt(process.argv[3] || '9336', 10);
const EVID = path.join(__dirname, '..', 'evidencia-poc', 'http');
const JAR = path.join(EVID, 'sesion-cuenta-A-cookies.txt');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0';
const ID_B = 'user-i5BbE1RcOASut3ys0nx5Ory7';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluar(send, expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r && r.result && r.result.value;
}

async function estadoPagina(send) {
  return evaluar(send, `JSON.stringify({
    url: location.href.slice(0, 120),
    titulo: document.title.slice(0, 80),
    esChallenge: /just a moment|attention required|verify you are human|cf-chl/i.test(document.title + ' ' + document.body.innerText.slice(0, 500)),
    loggedUI: /log out|log out/i.test(document.body.innerText) || !!document.querySelector('[data-testid*=profile],
    lenBody: document.body.innerText.length
  })`).then ? null : null;
}

async function main() {
  fs.mkdirSync(EVID, { recursive: true });
  console.log(`[1] Abriendo/adjuntando canal CDP puerto ${PUERTO}, perfil ${PERFIL}...`);
  const canal = await abrirCanal({ port: PUERTO, perfil: require('./lib/browser').rutaPerfil(PERFIL), headed: true, url: 'https://chatgpt.com/' });
  const { send } = canal;
  await sleep(4000);

  // estado actual de la página
  const st = await evaluar(send, `JSON.stringify((() => ({
    url: location.href.slice(0, 120),
    titulo: document.title.slice(0, 80),
    esChallenge: /just a moment|attention required|verify you are human/i.test(document.title) || !!document.querySelector('#challenge-form, .cf-turnstile, [class*=cf-]'),
    lenBody: document.body.innerText.length
  }))())`);
  console.log('Estado página:', st);
  const estado = JSON.parse(st);
  if (estado.esChallenge) {
    console.log('\n⚠️  CHALLENGE DE CLOUDFLARE DETECTADO. Pásalo a mano en la ventana del navegador');
    console.log('    (checkbox / verificación). Cuando el chat cargue, escribe "listo" y pulsa Enter aquí.');
    await new Promise((res) => {
      process.stdin.once('data', () => res());
    });
    await sleep(5000);
    const st2 = await evaluar(send, `JSON.stringify((() => ({
      url: location.href.slice(0, 120),
      esChallenge: /just a moment|attention required/i.test(document.title)
    }))())`);
    console.log('Estado tras challenge:', st2);
    if (/true/.test(st2.replace(/.*"esChallenge":(true|false).*/, '$1'))) {
      console.log('⛔ El challenge sigue. Abortar y reintentar más tarde.');
      process.exit(2);
    }
  }

  // cookies por host EXACTO
  console.log('[2] Capturando cookies (host exacto chatgpt.com / .chatgpt.com)...');
  const todas = await send('Storage.getCookies', { browserContextId: undefined }).catch(async () => {
    // fallback: Network.getCookies para las URLs concretas
    const r1 = await send('Network.getCookies', { urls: ['https://chatgpt.com/', 'https://chatgpt.com/backend-api'] });
    return { cookies: r1.cookies };
  });
  const cookies = (todas && todas.cookies) || [];
  const utiles = cookies.filter(c => c.domain === 'chatgpt.com' || c.domain === '.chatgpt.com');
  console.log(`    total=${cookies.length} útiles(chatgpt.com)=${utiles.length}`);
  const tieneSession = utiles.some(c => c.name === '__Secure-next-auth.session-token');
  console.log(`    __Secure-next-auth.session-token: ${tieneSession ? 'PRESENTE' : 'AUSENTE'}`);

  if (!tieneSession) {
    console.log('⛔ Sin session-token: la sesión no está completa (login no finalizado o cookies aún no en memoria). Abortar.');
    process.exit(3);
  }

  // escribir jar (formato host\tname\tvalue, solo hosts exactos)
  if (fs.existsSync(JAR)) {
    const bak = JAR.replace(/\.txt$/, `-bak-${Date.now()}.txt`);
    fs.copyFileSync(JAR, bak);
    console.log('    backup del jar anterior:', path.basename(bak));
  }
  const lineas = utiles.map(c => [c.domain, c.name, c.value].join('\t'));
  fs.writeFileSync(JAR, lineas.join('\n') + '\n');
  console.log(`[3] Jar escrito: ${JAR} (${utiles.length} cookies)`);

  // verificar con /api/auth/session (1 petición)
  console.log('[4] Verificando /api/auth/session (1 petición)...');
  const cookieHeader = utiles.map(c => `${c.name}=${c.value}`).join('; ');
  const { net } = { net: require('./lib/net') };
  const r = await net.fetch('https://chatgpt.com/api/auth/session', {
    method: 'GET',
    headers: { 'User-Agent': UA, 'Cookie': cookieHeader, 'Accept': 'application/json' },
  });
  const texto = r.text || (typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
  let j = null; try { j = JSON.parse(texto); } catch {}
  const userId = j && j.user && j.user.id;
  const email = j && j.user && j.user.email;
  const token = !!(j && j.accessToken);
  console.log(`    status=${r.status} user=${userId || '?'} email=${email || '?'} bearer=${token ? 'sí' : 'NO'}`);

  if (r.status !== 200 || !userId) { console.log('⛔ Sesión no válida aún.'); process.exit(4); }
  if (userId === ID_B) { console.log('⛔ ¡Es el id de B! Jar contaminado — revisar perfil.'); process.exit(5); }

  // Bearer vivo en /me (1 petición)
  await sleep(2300);
  const r2 = await net.fetch('https://chatgpt.com/backend-api/me', {
    method: 'GET',
    headers: { 'User-Agent': UA, 'Authorization': `Bearer ${j.accessToken}` },
  });
  console.log(`[5] /backend-api/me con Bearer → ${r2.status} ${r2.status === 200 ? '✅' : '⛔'}`);

  console.log('\nRESUMEN:');
  console.log(`  jar=${path.basename(JAR)} cookies=${utiles.length} user=${userId} bearer=${token && r2.status === 200 ? 'VIVO' : 'no'}`);
  console.log(`  estado: ${token && r2.status === 200 ? 'SESIÓN A OPERATIVA — se puede relanzar la cola' : 'revisar arriba'}`);
  process.exit(token && r2.status === 200 ? 0 : 6);
}

main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
