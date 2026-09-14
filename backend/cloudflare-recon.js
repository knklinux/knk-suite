'use strict';
// ============================================================================
// cloudflare-recon.js — Recon de superficie AI en Cloudflare
//   node backend/cloudflare-recon.js
//
// Flujo:
//   1. Se adjunta a Firefox BiDi (:9344) — requiere login previo del usuario
//   2. Navega al dashboard de Cloudflare y extrae: account_id, email, zona(s)
//   3. Mapea endpoints AI: AI Playground, Workers AI, AI Gateway, MCP
//   4. Extrae tokens de API si existen
//   5. Guarda evidencia en evidencia-poc/http/cloudflare-recon/
//
// Restricciones: solo tráfico contra dash.cloudflare.com y api.cloudflare.com
// ============================================================================

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const PUERTO_BIDI = 9344;
const EVID_DIR = path.join(__dirname, '..', 'evidencia-poc', 'http', 'cloudflare-recon');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Crear directorio de evidencia
fs.mkdirSync(EVID_DIR, { recursive: true });

let id = 0;
const pending = new Map();

function enviar(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

async function main() {
  console.log('[recon] Conectando a BiDi :9344...');
  const ws = new WebSocket(`ws://127.0.0.1:${PUERTO_BIDI}/session`);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

  ws.on('message', d => {
    const j = JSON.parse(d);
    if (j.id && pending.has(j.id)) {
      const p = pending.get(j.id);
      pending.delete(j.id);
      j.error ? p.reject(new Error(JSON.stringify(j.error))) : p.resolve(j.result);
    }
  });

  console.log('[recon] Canal abierto. Creando contexto de navegador...');

  // Crear contexto de navegador
  const ctx = await enviar(ws, 'browser.createBrowserContext', {});
  const contextId = ctx.context;
  console.log(`[recon] Contexto: ${contextId}`);

  // Crear pestaña
  const { targetInfo } = await enviar(ws, 'browsingContext.create', {
    type: 'tab',
    context: contextId,
    url: 'about:blank'
  });
  const targetId = targetInfo.targetId;
  console.log(`[recon] Target: ${targetId}`);

  // Habilitar Network + DOM
  await enviar(ws, 'network.enable', { contextId: targetId });
  await enviar(ws, 'dom.enable', { contextId: targetId });

  // Helper: navegar y esperar
  async function navegar(url, nombre) {
    console.log(`[recon] Navegando a ${url} (${nombre})...`);
    await enviar(ws, 'browsingContext.navigate', {
      context: targetId,
      url,
      wait: 'load'
    });
    await sleep(3000);

    // Capturar screenshot
    const { data } = await enviar(ws, 'browsingContext.captureScreenshot', {
      context: targetId,
      format: 'png'
    });
    const screenshotPath = path.join(EVID_DIR, `${nombre}.png`);
    fs.writeFileSync(screenshotPath, Buffer.from(data, 'base64'));
    console.log(`[recon] Screenshot: ${screenshotPath}`);

    // Capturar HTML
    const { result } = await enviar(ws, 'runtime.evaluate', {
      expression: 'document.documentElement.outerHTML',
      context: targetId
    });
    const htmlPath = path.join(EVID_DIR, `${nombre}.html`);
    fs.writeFileSync(htmlPath, result.value || '(empty)');
    console.log(`[recon] HTML: ${htmlPath}`);

    return result.value || '';
  }

  // Helper: evaluar JS en la página
  async function evaluar(expr) {
    const { result } = await enviar(ws, 'runtime.evaluate', {
      expression: expr,
      context: targetId,
      returnByValue: true,
      awaitPromise: true
    });
    return result.value;
  }

  // Helper: capturar peticiones de red
  const peticiones = [];
  ws.on('message', d => {
    const j = JSON.parse(d);
    if (j.method === 'network.beforeRequestSent') {
      peticiones.push({
        ts: new Date().toISOString(),
        url: j.params?.request?.url,
        method: j.params?.request?.method,
        headers: j.params?.request?.headers
      });
    }
  });

  const resultados = {
    ts: new Date().toISOString(),
    target: 'Cloudflare AI',
    fases: []
  };

  try {
    // ── FASE 1: Login check ──────────────────────────────────────────────
    console.log('\n=== FASE 1: Verificando login ===');
    await navegar('https://dash.cloudflare.com/', '01-dashboard');

    const isLoggedIn = await evaluar(`
      !!document.querySelector('[data-testid="user-menu"]') ||
      !!document.querySelector('.user-menu') ||
      !!document.querySelector('header')?.textContent?.includes('My Dashboard') ||
      window.location.href.includes('/dashboard')
    `);

    if (!isLoggedIn) {
      console.log('\n[recon] ⚠️  NO ESTÁS LOGUEADO EN CLOUDFLARE');
      console.log('[recon] Abre Firefox y haz login en https://dash.cloudflare.com/');
      console.log('[recon] Cuando estés logueado, vuelve a ejecutar este script.');
      resultados.fases.push({ fase: 'login', estado: 'NO_LOGUEADO' });
      fs.writeFileSync(path.join(EVID_DIR, 'recon-result.json'), JSON.stringify(resultados, null, 2));
      ws.close();
      process.exit(20);
    }

    console.log('[recon] ✅ Login confirmado');
    resultados.fases.push({ fase: 'login', estado: 'OK' });

    // ── FASE 2: Extraer account info ─────────────────────────────────────
    console.log('\n=== FASE 2: Account info ===');

    // Obtener email del usuario
    const email = await evaluar(`
      document.querySelector('[data-testid="user-menu"]')?.textContent ||
      document.querySelector('.user-menu-email')?.textContent ||
      document.querySelector('header')?.textContent?.match(/[\\w.-]+@[\\w.-]+\\.[a-z]+/)?.[0] ||
      'unknown'
    `);
    console.log(`[recon] Email: ${email}`);

    // Obtener account_id de la URL o del DOM
    const accountId = await evaluar(`
      window.location.href.match(/\\/accounts\\/([a-f0-9-]+)/)?.[1] ||
      document.querySelector('[data-account-id]')?.getAttribute('data-account-id') ||
      'unknown'
    `);
    console.log(`[recon] Account ID: ${accountId}`);

    // Si no tenemos account_id de la URL, buscarlo en la API
    let realAccountId = accountId;
    if (accountId === 'unknown') {
      console.log('[recon] Buscando account_id en la API...');
      const apiResult = await evaluar(`
        fetch('https://api.cloudflare.com/client/v4/accounts', {
          credentials: 'include'
        }).then(r => r.json()).then(d => {
          const acc = d.result?.[0];
          return acc ? { id: acc.id, name: acc.name } : null;
        }).catch(() => null)
      `);
      if (apiResult) {
        realAccountId = apiResult.id;
        console.log(`[recon] Account ID (API): ${realAccountId} (${apiResult.name})`);
      }
    }

    resultados.account = { email, accountId: realAccountId };

    // ── FASE 3: Mapear zonas ─────────────────────────────────────────────
    console.log('\n=== FASE 3: Zonas ===');
    const zonas = await evaluar(`
      fetch('https://api.cloudflare.com/client/v4/zones', {
        credentials: 'include'
      }).then(r => r.json()).then(d =>
        d.result?.map(z => ({ id: z.id, name: z.name, status: z.status })) || []
      ).catch(() => [])
    `);
    console.log(`[recon] Zonas: ${zonas.length}`);
    zonas.forEach(z => console.log(`  - ${z.name} (${z.status})`));
    resultados.zonas = zonas;

    // ── FASE 4: Workers AI ───────────────────────────────────────────────
    console.log('\n=== FASE 4: Workers AI ===');
    await navegar(`https://dash.cloudflare.com/${realAccountId}/ai/playground`, '02-ai-playground');

    const aiPlayground = await evaluar(`
      ({
        title: document.title,
        url: window.location.href,
        hasPlayground: !!document.querySelector('[class*="playground"]') ||
                       !!document.querySelector('textarea') ||
                       document.body.textContent.includes('Playground'),
        models: Array.from(document.querySelectorAll('select option, [role="option"]'))
          .map(el => el.textContent?.trim()).filter(Boolean).slice(0, 20)
      })
    `);
    console.log(`[recon] AI Playground: ${JSON.stringify(aiPlayground)}`);
    resultados.aiPlayground = aiPlayground;

    // AI Gateway
    console.log('\n=== FASE 4b: AI Gateway ===');
    await navegar(`https://dash.cloudflare.com/${realAccountId}/ai/gateway`, '03-ai-gateway');

    const aiGateway = await evaluar(`
      ({
        title: document.title,
        url: window.location.href,
        hasGateway: document.body.textContent.includes('AI Gateway') ||
                    document.body.textContent.includes('gateway'),
        gateways: Array.from(document.querySelectorAll('table tr, [class*="row"]'))
          .map(el => el.textContent?.trim()).filter(Boolean).slice(0, 10)
      })
    `);
    console.log(`[recon] AI Gateway: ${JSON.stringify(aiGateway)}`);
    resultados.aiGateway = aiGateway;

    // Workers
    console.log('\n=== FASE 4c: Workers & Pages ===');
    await navegar(`https://dash.cloudflare.com/${realAccountId}/workers-and-pages`, '04-workers');

    const workers = await evaluar(`
      ({
        title: document.title,
        url: window.location.href,
        count: document.querySelectorAll('table tr, [class*="worker"]').length,
        names: Array.from(document.querySelectorAll('table td:first-child, [class*="name"]'))
          .map(el => el.textContent?.trim()).filter(Boolean).slice(0, 20)
      })
    `);
    console.log(`[recon] Workers: ${JSON.stringify(workers)}`);
    resultados.workers = workers;

    // ── FASE 5: API Tokens ───────────────────────────────────────────────
    console.log('\n=== FASE 5: API Tokens ===');
    await navegar(`https://dash.cloudflare.com/${realAccountId}/profile/api-tokens`, '05-api-tokens');

    const tokens = await evaluar(`
      ({
        title: document.title,
        url: window.location.href,
        tokenCount: document.querySelectorAll('table tr').length - 1,
        tokens: Array.from(document.querySelectorAll('table tbody tr'))
          .map(row => {
            const cells = row.querySelectorAll('td');
            return {
              name: cells[0]?.textContent?.trim(),
              permisos: cells[1]?.textContent?.trim(),
              fecha: cells[2]?.textContent?.trim()
            };
          }).slice(0, 10)
      })
    `);
    console.log(`[recon] API Tokens: ${JSON.stringify(tokens)}`);
    resultados.apiTokens = tokens;

    // ── FASE 6: Mapear endpoints AI via JS ───────────────────────────────
    console.log('\n=== FASE 6: AI Endpoints (JS map) ===');
    const endpoints = await evaluar(`
      // Buscar en el JS del dashboard endpoints de AI
      const scripts = Array.from(document.querySelectorAll('script[src]'));
      const aiEndpoints = scripts
        .map(s => s.src)
        .filter(s => s.includes('ai') || s.includes('ml') || s.includes('llm'));

      // Buscar en el DOM referencias a AI
      const aiRefs = document.body.innerHTML.match(/\\/ai\\/[^"\\s]+/g) || [];
      const uniqueRefs = [...new Set(aiRefs)].slice(0, 30);

      ({ scripts: aiEndpoints, aiReferences: uniqueRefs })
    `);
    console.log(`[recon] AI Endpoints: ${JSON.stringify(endpoints)}`);
    resultados.aiEndpoints = endpoints;

    // ── FASE 7: MCP Servers ──────────────────────────────────────────────
    console.log('\n=== FASE 7: MCP Servers ===');
    await navegar(`https://dash.cloudflare.com/${realAccountId}/ai/mcp`, '06-mcp');

    const mcp = await evaluar(`
      ({
        title: document.title,
        url: window.location.href,
        hasMCP: !window.location.href.includes('404') &&
                (document.body.textContent.includes('MCP') ||
                 document.body.textContent.includes('Model Context Protocol')),
        servers: Array.from(document.querySelectorAll('table tr, [class*="server"]'))
          .map(el => el.textContent?.trim()).filter(Boolean).slice(0, 10)
      })
    `);
    console.log(`[recon] MCP: ${JSON.stringify(mcp)}`);
    resultados.mcp = mcp;

    // ── FASE 8: Capturar peticiones de red ───────────────────────────────
    console.log('\n=== FASE 8: Peticiones capturadas ===');
    const aiPeticiones = peticiones.filter(p =>
      p.url?.includes('/ai/') || p.url?.includes('/ml/') ||
      p.url?.includes('workers') || p.url?.includes('mcp')
    );
    console.log(`[recon] Peticiones AI: ${aiPeticiones.length}`);
    resultados.peticionesAI = aiPeticiones;

    // ── GUARDAR RESULTADOS ───────────────────────────────────────────────
    resultados.ts_fin = new Date().toISOString();
    resultados.fases.push({ fase: 'completo', estado: 'OK' });

    const outPath = path.join(EVID_DIR, 'recon-result.json');
    fs.writeFileSync(outPath, JSON.stringify(resultados, null, 2));
    console.log(`\n[recon] ✅ Resultados guardados en ${outPath}`);

    // Resumen
    console.log('\n=== RESUMEN ===');
    console.log(`Account: ${email} (${realAccountId})`);
    console.log(`Zonas: ${zonas.length}`);
    console.log(`AI Playground: ${aiPlayground.hasPlayground ? '✅' : '❌'}`);
    console.log(`AI Gateway: ${aiGateway.hasGateway ? '✅' : '❌'}`);
    console.log(`Workers: ${workers.count || 0}`);
    console.log(`API Tokens: ${tokens.tokenCount || 0}`);
    console.log(`MCP: ${mcp.hasMCP ? '✅' : '❌'}`);

  } catch (e) {
    console.error('[recon] Error:', e.message);
    resultados.error = e.message;
    fs.writeFileSync(path.join(EVID_DIR, 'recon-result.json'), JSON.stringify(resultados, null, 2));
  } finally {
    await enviar(ws, 'browser.closeBrowserContext', { context: contextId }).catch(() => {});
    ws.close();
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
