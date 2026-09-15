'use strict';

// ============================================================================
// egress.js — Estado de SALIDA del tráfico de la suite, para el Dashboard.
//
// Prioridad real (lo que hace lib/net.js al emitir una petición):
//   1. burp    — KNK_PROXY en el entorno O proxy de salida de la UI (tab Labs)
//   2. tor     — el proxy del SISTEMA enrutado a Tor (route-all del tab Tor)
//   3. sistema — proxy del sistema apuntando a otro sitio (Windows)
//   4. directo — nada de lo anterior
//
// El indicador del Dashboard consume /api/egress TRAS el gate de auth
// (solo /health es pública; el Dashboard siempre viaja con la cookie).
// ============================================================================

const netMod = require('./net');
const tor = require('./tor');

function readSystemProxy() {
  try { return tor.getSystemProxyState(); } catch { return null; }
}

function resolveMode({ burp, sys } = {}) {
  if (burp && burp.active) {
    return { mode: 'burp', label: 'PROXY EXTERNO', detail: burp.proxy, note: 'Salida de la suite vía proxy (Burp/ZAP). El sistema y Tor no afectan a net.js.' };
  }
  if (sys && sys.enabled && sys.isTor) {
    return { mode: 'tor', label: 'TOR', detail: `sistema → ${sys.server}`, note: 'El proxy del sistema está enrutado a Tor (route-all del tab Red Tor).' };
  }
  if (sys && sys.enabled && sys.server) {
    return { mode: 'system', label: 'PROXY DEL SISTEMA', detail: sys.server, note: 'El sistema tiene un proxy activo; la suite NO lo usa (solo afecta a apps que lo respeten).' };
  }
  return { mode: 'direct', label: 'DIRECTO', detail: null, note: 'Sin proxy: la suite sale directa a internet.' };
}

async function statusPayload({ torTimeoutMs = 6000 } = {}) {
  const proxy = netMod.getProxy();
  const burp = proxy
    ? {
        active: true,
        proxy: `${proxy.protocol}//${proxy.host}`,
        port: Number(proxy.port) || 8080,
        source: process.env.KNK_PROXY ? 'env (KNK_PROXY)' : 'UI (tab Labs)',
      }
    : { active: false, proxy: null, source: null };

  const sys = readSystemProxy();

  // Tor: estado barato (sin refrescar IP por defecto — getStatus cachea 60s)
  let torState = { running: false, socksPort: null, ip: null, country: null };
  try {
    const st = await tor.getStatus({ timeoutMs: torTimeoutMs });
    torState = {
      running: Boolean(st.running),
      socksPort: st.socksPort || null,
      ip: st.ip || null,
      country: st.country || null,
    };
  } catch { /* sin Tor instalado/activo → estado por defecto */ }

  const resolved = resolveMode({ burp, sys });
  return {
    ok: true,
    ...resolved,
    burp,
    tor: torState,
    system: sys, // null en Linux/macOS
  };
}

function mount(router) {
  router.get('/egress', async (_req, res) => {
    try {
      // ?ip=1 fuerza refresco del exit-IP de Tor (desde el tab, on-demand)
      const refresh = _req.query.ip === '1';
      if (refresh && tor.isRunning()) {
        try { await tor.getCurrentIP({ cacheMs: 0, timeoutMs: 10000 }); } catch {}
      }
      res.json(await statusPayload());
    } catch (e) {
      res.json({ ok: false, mode: 'unknown', label: '—', detail: null, error: e.message });
    }
  });
}

module.exports = { mount, resolveMode, statusPayload };
