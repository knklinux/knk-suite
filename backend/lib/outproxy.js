'use strict';

// ============================================================================
// outproxy.js — Proxy de SALIDA de la suite (estilo Burp: KNK_PROXY), con UI.
//
// net.js ya tenía el motor (setProxy/getProxy + CONNECT tunnel para HTTPS),
// pero solo se activaba con la variable de entorno KNK_PROXY al arrancar.
// Este módulo lo expone en caliente por HTTP y lo persiste:
//
//   * GET  /api/outproxy        → estado (proxy activo, origen env/config)
//   * POST /api/outproxy        → activar/validar { proxy: "http://127.0.0.1:8080" }
//   * POST /api/outproxy/test   → test de conectividad (HTTP plano + CONNECT)
//   * DELETE /api/outproxy      → quitar (vuelve a salida directa)
//
// Persistencia: clave `outboundProxy` en config.json (repo) o
// ~/.knk-suite/config.json. En el arranque, index.js la aplica si KNK_PROXY
// no está presente (la env siempre gana: es el override explícito).
//
// El proxy afecta al tráfico de RECON/módulos/Repeater/Intruder (todo lo que
// pasa por lib/net.js). NO afecta: las peticiones internas same-origin del
// workbench ni las sondas de cámaras que usan fetch global.
// ============================================================================

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const netMod = require('./net');

const CONFIG_CANDIDATES = [
  path.join(__dirname, '..', '..', 'config.json'),
  path.join(os.homedir(), '.knk-suite', 'config.json'),
];
const CONFIG_KEY = 'outboundProxy';

function readConfig() {
  for (const p of CONFIG_CANDIDATES) {
    try {
      const cfg = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
      if (cfg && typeof cfg[CONFIG_KEY] === 'string') return { file: p, value: cfg[CONFIG_KEY] };
    } catch {}
  }
  return { file: null, value: '' };
}

function writeConfig(value) {
  const target = CONFIG_CANDIDATES[0];
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(target, 'utf8').replace(/^﻿/, '')); } catch {}
  if (value) cfg[CONFIG_KEY] = value;
  else {
    // quitar: si la clave ni existía, no reescribimos el fichero (podría
    // contener claves de terceros del usuario — no lo reformateamos gratis)
    if (!(CONFIG_KEY in cfg)) return;
    delete cfg[CONFIG_KEY];
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(cfg, null, 2) + '\n');
}

/** Conecta contra el proxy: CONNECT para https, GET directo para http. */
function probe(proxyUrl, targetUrl, timeoutMs = 6000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    const timer = setTimeout(() => done({ ok: false, error: 'timeout del proxy' }), timeoutMs);

    try {
      const target = new URL(targetUrl);
      const proxy = new URL(proxyUrl);
      if (!/^https?:$/.test(proxy.protocol)) throw new Error('el proxy debe ser http(s)://');

      const finish = (label) => (res) => {
        clearTimeout(timer);
        done({ ok: true, via: label, status: res.statusCode, detail: `HTTP ${res.statusCode} vía ${label}` });
      };
      const fail = (label) => (err) => {
        clearTimeout(timer);
        done({ ok: false, via: label, error: err.message });
      };

      if (target.protocol === 'https:') {
        // CONNECT tunnel — el handshake TLS y la petición real los hace lib/net
        // contra el túnel; aquí solo validamos que el proxy acepta el CONNECT.
        const req = http.request({
          host: proxy.hostname, port: Number(proxy.port) || 8080,
          method: 'CONNECT', path: `${target.hostname}:443`,
          headers: { Host: `${target.hostname}:443` }, timeout: timeoutMs,
        });
        req.on('connect', (res, socket) => {
          socket.destroy();
          finish(`CONNECT ${target.hostname}:443`)(res);
        });
        req.on('error', fail('CONNECT'));
        req.on('timeout', () => { req.destroy(); fail('CONNECT')(new Error('timeout')); });
        req.end();
      } else {
        // NOTA: no mezclar URL string con host/port en options — en Node la
        // URL GANA y la petición se va al target real en vez de al proxy.
        const req = http.request({
          host: proxy.hostname, port: Number(proxy.port) || 8080,
          method: 'GET', path: '/',
          headers: { Host: target.host, 'User-Agent': 'knk-suite proxy-test' },
          timeout: timeoutMs,
        });
        req.on('response', finish(`GET ${target.host}`));
        req.on('error', fail('GET'));
        req.on('timeout', () => { req.destroy(); fail('GET')(new Error('timeout')); });
        req.end();
      }
    } catch (e) {
      clearTimeout(timer);
      done({ ok: false, error: e.message });
    }
  });
}

function statusPayload() {
  const active = netMod.getProxy();
  const envSet = Boolean(process.env.KNK_PROXY);
  const cfg = readConfig();
  return {
    ok: true,
    active: Boolean(active),
    proxy: active ? `${active.protocol}//${active.host}` : null,
    port: active ? Number(active.port) || 8080 : null,
    source: active ? (envSet ? 'env (KNK_PROXY — override, no editable desde la UI)' : (cfg.file ? `config (${cfg.file})` : 'memoria')) : null,
    stored: cfg.value || '',
  };
}

function mount(router) {
  router.get('/outproxy', (_req, res) => res.json(statusPayload()));

  router.post('/outproxy', (req, res) => {
    const raw = String((req.body && req.body.proxy) || '').trim();
    if (process.env.KNK_PROXY) {
      return res.status(409).json({ ok: false, error: 'KNK_PROXY está fijado por entorno: la UI no puede cambiarlo (override explícito del arranque).' });
    }
    if (!raw) return res.status(400).json({ ok: false, error: 'Falta proxy (ej. http://127.0.0.1:8080)' });
    try { netMod.setProxy(raw); } catch (e) {
      return res.status(400).json({ ok: false, error: e.message });
    }
    try { writeConfig(raw); } catch (e) {
      return res.status(500).json({ ok: false, error: `Proxy activo en memoria, pero no se pudo persistir: ${e.message}` });
    }
    res.json({ ...statusPayload(), note: 'Proxy de salida activo: el tráfico de recon/Repeater/Intruder pasa por él.' });
  });

  router.post('/outproxy/test', async (req, res) => {
    const body = req.body || {};
    const active = netMod.getProxy();
    // Si no llega URL en el body se prueba el proxy ACTIVO (o falla si no hay).
    let candidate = String(body.proxy || '').trim();
    if (!candidate) {
      if (!active) return res.status(400).json({ ok: false, error: 'No hay proxy activo que probar' });
      candidate = `${active.protocol}//${active.host}`;
    } else {
      try { new URL(candidate); } catch (e) { return res.status(400).json({ ok: false, error: `URL inválida: ${e.message}` }); }
    }
    const results = {
      http: await probe(candidate, 'http://example.com/'),
      https: await probe(candidate, 'https://example.com/'),
    };
    res.json({ ok: results.http.ok || results.https.ok, proxy: candidate, results });
  });

  router.delete('/outproxy', (_req, res) => {
    if (process.env.KNK_PROXY) {
      return res.status(409).json({ ok: false, error: 'KNK_PROXY viene del entorno: rearranca sin la variable para salir directo.' });
    }
    netMod.setProxy(null);
    try { writeConfig(''); } catch {}
    res.json({ ...statusPayload(), note: 'Salida directa restaurada.' });
  });
}

module.exports = { mount, probe, statusPayload, CONFIG_KEY, CONFIG_CANDIDATES, writeConfig };
