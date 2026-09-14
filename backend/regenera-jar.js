'use strict';
// regenera-jar.js — Regenera el jar de la cuenta A o B desde su sesión de navegador viva.
//   node backend/regenera-jar.js <A|B> [perfil] [puerto]
//   A (por defecto): perfil openai-cuenta-a, puerto 9336, jar sesion-cuenta-A-cookies.txt
//   B:               perfil openai-b,       puerto 9337, jar sesion-cuenta-B-cookies.txt
// Pasos (idénticos a la versión A, con verificación cruzada de ambos ids):
//   abrir/adjuntar canal CDP → navegar a chatgpt.com → detectar challenge de
//   Cloudflare (espera "listo" si lo hay) → capturar cookies por host EXACTO
//   (chatgpt.com / .chatgpt.com, nunca mezclar con openai.com) → escribir jar
//   (backup del anterior) → verificar con /api/auth/session:
//     * el id de sesión debe coincidir con la CUENTA ELEGIDA
//     * debe ser DISTINTO al id de la OTRA cuenta (compuerta de contaminación)
//   → /backend-api/me con Bearer (1 petición).
const fs = require('fs');
const path = require('path');
const { abrirCanal, rutaPerfil } = require('./lib/browser');

// Identidades conocidas (ground truth de la compuerta de salud)
const IDS = {
  A: 'user-hDI8xdVTY6zahW36WXAsVD8e',
  B: 'user-i5BbE1RcOASut3ys0nx5Ory7',
};

const CONFIG = {
  A: { perfil: 'openai-cuenta-a', puerto: 9336, jar: 'sesion-cuenta-A-cookies.txt' },
  B: { perfil: 'openai-b', puerto: 9337, jar: 'sesion-cuenta-B-cookies.txt' },
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0';
const EVID = path.join(__dirname, '..', 'evidencia-poc', 'http');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs() {
  const cuenta = (process.argv[2] || 'A').toUpperCase();
  if (!CONFIG[cuenta]) {
    console.error('Cuenta debe ser A o B. Uso: node backend/regenera-jar.js <A|B> [perfil] [puerto]');
    process.exit(1);
  }
  const cfg = { ...CONFIG[cuenta] };
  if (process.argv[3]) cfg.perfil = process.argv[3];
  if (process.argv[4]) cfg.puerto = parseInt(process.argv[4], 10);
  return { cuenta, cfg };
}

async function evaluar(send, expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r && r.result && r.result.value;
}

async function main() {
  const { cuenta, cfg } = parseArgs();
  const idPropia = IDS[cuenta];
  const idOtra = IDS[cuenta === 'A' ? 'B' : 'A'];
  const jarPath = path.join(EVID, cfg.jar);
  fs.mkdirSync(EVID, { recursive: true });

  console.log(`[1] Cuenta ${cuenta}: abriendo/adjuntando canal CDP puerto ${cfg.puerto}, perfil ${cfg.perfil}...`);
  const canal = await abrirCanal({ port: cfg.puerto, perfil: rutaPerfil(cfg.perfil), headed: true, url: 'https://chatgpt.com/' });
  const { send } = canal;
  await sleep(4000);

  // estado actual de la página
  const st = await evaluar(send, `JSON.stringify((() => ({
    url: location.href.slice(0, 120),
    titulo: document.title.slice(0, 80),
    esChallenge: /just a moment|attention required|verify you are human/i.test(document.title) || !!document.querySelector('#challenge-form, .cf-turnstile, [class*=cf-]')
  }))())`);
  console.log('Estado página:', st);
  const estado = JSON.parse(st);
  if (estado.esChallenge) {
    console.log('\n⚠️  CHALLENGE DE CLOUDFLARE DETECTADO. Pásalo a mano en la ventana del navegador.');
    console.log(`    Cuando el chat cargue, escribe "listo" y pulsa Enter aquí (cuenta ${cuenta}).`);
    await new Promise((res) => process.stdin.once('data', () => res()));
    await sleep(5000);
    const st2 = await evaluar(send, `JSON.stringify((() => ({ esChallenge: /just a moment|attention required/i.test(document.title) }))())`);
    if (/true/.test(st2.replace(/.*"esChallenge":(true|false).*/, '$1'))) {
      console.log('⛔ El challenge sigue. Abortar y reintentar más tarde.');
      process.exit(2);
    }
  }

  // cookies por host EXACTO
  console.log('[2] Capturando cookies (host exacto chatgpt.com / .chatgpt.com)...');
  const todas = await send('Storage.getCookies', { browserContextId: undefined }).catch(async () => {
    const r1 = await send('Network.getCookies', { urls: ['https://chatgpt.com/', 'https://chatgpt.com/backend-api'] });
    return { cookies: r1.cookies };
  });
  const cookies = (todas && todas.cookies) || [];
  const utiles = cookies.filter(c => c.domain === 'chatgpt.com' || c.domain === '.chatgpt.com');
  console.log(`    total=${cookies.length} útiles(chatgpt.com)=${utiles.length}`);

  // el session-token puede ir completo o partido en chunks (.0, .1, ...)
  const tokenCompleto = utiles.some(c => c.name === '__Secure-next-auth.session-token');
  const chunks = utiles.filter(c => /^__Secure-next-auth\.session-token\.\d+$/.test(c.name));
  console.log(`    session-token completo: ${tokenCompleto ? 'PRESENTE' : 'no'} | chunks: ${chunks.length ? chunks.map(c => c.name).join(',') : 'ninguno'}`);

  if (!tokenCompleto && !chunks.length) {
    console.log('⛔ Sin session-token (ni chunks): la sesión no está completa. Abortar.');
    process.exit(3);
  }

  // escribir jar (backup del anterior)
  if (fs.existsSync(jarPath)) {
    const bak = jarPath.replace(/\.txt$/, `-bak-${Date.now()}.txt`);
    fs.copyFileSync(jarPath, bak);
    console.log('    backup del jar anterior:', path.basename(bak));
  }
  const lineas = utiles.map(c => [c.domain, c.name, c.value].join('\t'));
  fs.writeFileSync(jarPath, lineas.join('\n') + '\n');
  console.log(`[3] Jar escrito: ${jarPath} (${utiles.length} cookies)`);

  // verificación cruzada de identidad (1 petición)
  console.log('[4] Verificando /api/auth/session (1 petición)...');
  const cookieHeader = utiles.map(c => `${c.name}=${c.value}`).join('; ');
  const net = require('./lib/net');
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

  // verificación de identidad dual: correcta Y no contaminada
  if (userId === idOtra) {
    console.log(`⛔ ¡CONTAMINACIÓN! El jar de la cuenta ${cuenta} resuelve a la identidad de la cuenta ${cuenta === 'A' ? 'B' : 'A'} (${userId}).`);
    console.log('    Probablemente esa otra cuenta está logueada en este perfil. Cerrar sesión de la otra cuenta y repetir.');
    process.exit(5);
  }
  if (userId !== idPropia) {
    console.log(`⛔ El id resuelto (${userId}) NO es el esperado de la cuenta ${cuenta} (${idPropia}) ni el de la otra cuenta.`);
    console.log('    ¿Cuenta nueva o cambio de identidad? Actualizar IDS en este script tras confirmarlo manualmente.');
    process.exit(6);
  }
  console.log(`    ✅ Identidad verificada: ${userId} = cuenta ${cuenta} (distinta de ${cuenta === 'A' ? 'B' : 'A'})`);

  // Bearer vivo en /me (1 petición)
  await sleep(2300);
  const r2 = await net.fetch('https://chatgpt.com/backend-api/me', {
    method: 'GET',
    headers: { 'User-Agent': UA, 'Authorization': `Bearer ${j.accessToken}` },
  });
  console.log(`[5] /backend-api/me con Bearer → ${r2.status} ${r2.status === 200 ? '✅' : '⛔'}`);

  const operativo = token && r2.status === 200;
  console.log('\nRESUMEN:');
  console.log(`  cuenta=${cuenta} jar=${path.basename(jarPath)} cookies=${utiles.length} user=${userId} bearer=${operativo ? 'VIVO' : 'no'}`);
  console.log(`  estado: ${operativo ? `SESIÓN ${cuenta} OPERATIVA — compuerta lista` : 'revisar arriba'}`);
  process.exit(operativo ? 0 : 7);
}

main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
