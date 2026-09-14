'use strict';
// e13-captura-descarga-B.js — Captura FRESCA del pantallazo del E13:
// B descarga su propio content_url y recibe el contenido inyectado por A.
//   node backend/e13-captura-descarga-B.js
const fs = require('fs');
const path = require('path');
const { abrirCanal, navegar, evaluar, capturar, rutaPerfil } = require('./lib/browser');

const PUERTO = 9336; // ventana de evidencias
const RAIZ = path.join(__dirname, '..');
const JAR_B = path.join(RAIZ, 'evidencia-poc/http/sesion-cuenta-B-cookies.txt');
const RONDA = path.join(RAIZ, 'evidencia-poc/http/e13-ronda-fresca.json');
const NOMBRE = 'e13-descarga-B-fresca.png';
const DIR_SALIDA = path.join(RAIZ, 'evidencia-poc/pantallas');

(async () => {
  const ronda = JSON.parse(fs.readFileSync(RONDA, 'utf8'));
  const url = ronda.content_url;
  console.log('content_url fresco:', url.slice(0, 80) + '…');

  const { send, cerrar } = await abrirCanal({ port: PUERTO, perfil: rutaPerfil('openai-poc') });
  try {
    // 1) Inyectar las cookies de B por host exacto (solo chatgpt.com — nunca mezclar openai.com)
    const lineas = fs.readFileSync(JAR_B, 'utf8').split('\n').filter(Boolean);
    let puestas = 0;
    for (const l of lineas) {
      const partes = l.split('\t');
      const dom = partes[0], name = partes[1], value = partes[3] || partes[2];
      if (!dom || !name || !value) continue;
      if (!/chatgpt\.com$/.test(dom.replace(/^\./, ''))) continue; // host exacto chatgpt.com
      await send('Network.setCookie', {
        name, value,
        domain: dom,
        path: '/',
        secure: true, httpOnly: false,
      }).catch(() => {});
      puestas++;
    }
    console.log('cookies B puestas:', puestas);

    // 2) Comprobar identidad B antes de la descarga
    await navegar(send, 'https://chatgpt.com/');
    await new Promise(r => setTimeout(r, 3000));
    const ses = await evaluar(send, `fetch('/api/auth/session').then(r => r.json()).then(j => ({ id: j.user && j.user.id, email: j.user && j.user.email }))`);
    console.log('sesión en navegador:', ses);

    // 3) Navegar al content_url fresco y capturar
    await navegar(send, url);
    await new Promise(r => setTimeout(r, 2500));
    const texto = await evaluar(send, `document.body ? document.body.innerText.slice(0, 300) : ''`);
    console.log('texto en página:', JSON.stringify(texto));

    const capt = await capturar(send, NOMBRE, { urlParaNombre: null });
    console.log('captura suite →', capt.fichero, capt.bytes, 'bytes');

    // Copiar al paquete (reemplaza la captura de la ronda anterior)
    fs.mkdirSync(DIR_SALIDA, { recursive: true });
    fs.copyFileSync(capt.fichero, path.join(DIR_SALIDA, 'e13-descarga-B.png'));
    console.log('PANTALLAZO FRESCO →', path.join(DIR_SALIDA, 'e13-descarga-B.png'));
    console.log(JSON.stringify({ ok: true, decisivo: ronda.decisivo, cuerpo: ronda.body, textoPagina: texto }, null, 2));
  } catch (e) {
    console.error('FALLO:', e.message);
    process.exitCode = 1;
  } finally {
    try { cerrar(); } catch { /* cierre best-effort */ }
  }
})().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });
