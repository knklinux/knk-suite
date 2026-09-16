'use strict';
// ============================================================================
// oast-router.js — rutas /oast/* del OAST integrado (protocolo interactsh).
//
//   GET  /oast/status            estado (registrado, server, payloads, hits…)
//   POST /oast/start             { server?, token?, pollIntervalMs?, autoCreateFindings? }
//   POST /oast/stop              deregistra y para el polling
//   POST /oast/payloads          { count } → payloads OOB nuevos
//   GET  /oast/payloads          lista de payloads con URLs listas para inyectar
//   POST /oast/poll              sondeo manual (además del automático)
//   GET  /oast/hits              ?limit&since → golpes correlacionados
//   POST /oast/hits/:id/convert  convierte un golpe en hallazgo manualmente
//   POST /oast/reset             borra payloads y golpes locales
//
// Todas quedan tras el gate de auth (el test auth-gate las audita solas).
// ============================================================================
const express = require('express');
const db = require('../db');
const oast = require('./oast');

function mount(parentRouter, { getSession } = {}) {
  const router = express.Router();
  const deps = () => ({ db, getSession });

  router.get('/oast/status', (req, res) => res.json(oast.status()));

  router.post('/oast/start', async (req, res) => {
    try { res.json(await oast.start(req.body || {}, deps())); }
    catch (e) { res.status(502).json({ ok: false, error: e.message }); }
  });

  router.post('/oast/stop', async (req, res) => {
    try { res.json(await oast.stop(req.body || {})); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.get('/oast/payloads', (req, res) => res.json({ ok: true, payloads: oast.listPayloads() }));

  router.post('/oast/payloads', (req, res) => {
    try { res.json({ ok: true, payloads: oast.newPayloads(req.body?.count || 1) }); }
    catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  router.post('/oast/poll', async (req, res) => {
    try { res.json(await oast.pollOnce(deps())); }
    catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  router.get('/oast/hits', (req, res) => {
    res.json({ ok: true, hits: oast.listHits({ limit: req.query.limit, since: req.query.since }) });
  });

  router.post('/oast/hits/:id/convert', (req, res) => {
    try { res.json(oast.convertHitManually(Number(req.params.id), deps())); }
    catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  router.post('/oast/reset', (req, res) => res.json(oast.reset(deps())));

  parentRouter.use(router);
}

module.exports = { mount };
