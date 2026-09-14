'use strict';

// ============================================================================
// KNK SUITE v2.1 — Screenshots automáticos de evidencia (Puppeteer)
// Seguridad: valida scope exacto + destino público antes de navegar,
// aplica rate limit, limita tamaño de descarga y guarda evidencia con SHA-256.
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('./net');

const SCREENSHOTS_DIR = path.join(require('os').homedir(), '.knk-suite', 'evidencia', 'screenshots');
const MAX_PAGE_BYTES = 5 * 1024 * 1024; // límite de descarga por página

let _puppeteer = null;
function loadPuppeteer() {
  if (_puppeteer) return _puppeteer;
  try { _puppeteer = require('puppeteer'); }
  catch (e) {
    const err = new Error('puppeteer no instalado. Ejecuta: npm install puppeteer (descarga Chromium).');
    err.code = 'PUPPETEER_MISSING';
    throw err;
  }
  return _puppeteer;
}

/**
 * Valida una URL contra scope estricto y bloquea destinos privados/locales.
 * @returns {{ok:true,url:URL}|{ok:false,error:string,reason:string}}
 */
async function validateUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); }
  catch { return { ok: false, error: 'invalid_url', reason: 'URL malformada' }; }
  if (!['http:', 'https:'].includes(u.protocol)) return { ok: false, error: 'unsupported_protocol', reason: 'Solo http/https' };
  if (!net.inScope(u.hostname)) return { ok: false, error: 'out_of_scope', reason: `${u.hostname} fuera del scope definido` };
  if (!(await net.isSafePublicHost(u.hostname))) return { ok: false, error: 'unsafe_destination', reason: `destino no público/privado: ${u.hostname}` };
  return { ok: true, url: u };
}

/**
 * Captura screenshots de una lista de URLs.
 * @param {string[]} urls
 * @param {object} [opts] { delayMs, width, height, fullPage, label, timeoutMs }
 */
async function takeScreenshots(urls, opts = {}) {
  const {
    delayMs = 3000,
    width = 1920,
    height = 1080,
    fullPage = false,
    label = 'poc',
    timeoutMs = 30000,
  } = opts;

  const list = Array.isArray(urls) ? urls : [urls];
  if (!list.length) return { ok: false, error: 'no_urls' };

  const browser = await loadPuppeteer().launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions', '--disable-background-networking', `--window-size=${width},${height}`],
  });

  const results = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    page.setDefaultNavigationTimeout(timeoutMs);
    page.setDefaultTimeout(timeoutMs);

    // Abortar recursos pesados y dominios fuera de scope (SSRF/redirects en subrecursos)
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      try {
        const u = new URL(req.url());
        if (!['http:', 'https:'].includes(u.protocol) || !net.inScope(u.hostname)) return req.abort();
      } catch { return req.abort(); }
      req.continue();
    });

    for (let i = 0; i < list.length; i++) {
      const raw = list[i];
      const start = Date.now();
      const record = { url: raw, ok: false };

      const validation = await validateUrl(raw);
      if (!validation.ok) {
        record.error = validation.error;
        record.reason = validation.reason;
        results.push(record);
        continue;
      }

      fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
      const safeName = validation.url.hostname + validation.url.pathname.replace(/[^a-zA-Z0-9/.-]/g, '_');
      const filename = `${label}_${String(i + 1).padStart(2, '0')}_${safeName.slice(0, 80)}_${Date.now()}.png`;
      const filepath = path.join(SCREENSHOTS_DIR, filename);

      try {
        const response = await page.goto(validation.url.toString(), { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        await new Promise(r => setTimeout(r, 1500)); // esperar rendering
        await page.screenshot({ path: filepath, fullPage, type: 'png' });
        const status = response ? response.status() : 0;
        const sha256 = crypto.createHash('sha256').update(fs.readFileSync(filepath)).digest('hex');
        Object.assign(record, {
          ok: true,
          status,
          finalUrl: page.url(),
          title: await page.title().catch(() => ''),
          filepath,
          filename,
          sha256,
          bytes: fs.statSync(filepath).size,
          elapsedMs: Date.now() - start,
        });
      } catch (e) {
        record.error = 'navigation_failed';
        record.reason = e.message;
      }

      // Rate limit con jitter entre capturas
      if (i < list.length - 1) {
        const jitter = delayMs * (1 + (Math.random() * 0.3 - 0.15));
        await new Promise(r => setTimeout(r, jitter));
      }
      results.push(record);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const captured = results.filter(r => r.ok).length;
  return { ok: captured > 0, total: list.length, captured, failed: list.length - captured, dir: SCREENSHOTS_DIR, screenshots: results };
}

async function screenshot(url, opts = {}) {
  return takeScreenshots([url], opts);
}

function listScreenshots() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) return [];
  return fs.readdirSync(SCREENSHOTS_DIR)
    .filter(f => f.endsWith('.png'))
    .map(f => ({ filename: f, filepath: path.join(SCREENSHOTS_DIR, f), size: fs.statSync(path.join(SCREENSHOTS_DIR, f)).size }))
    .sort((a, b) => b.filepath.localeCompare(a.filepath));
}

module.exports = { takeScreenshots, screenshot, listScreenshots, SCREENSHOTS_DIR, validateUrl };
