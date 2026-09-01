'use strict';

// ============================================================================
// KNK SUITE v2 — OPPLAN (Operation Plan)
// ============================================================================

// La semántica de scope DEBE ser idéntica a net.js (única fuente de verdad):
// exacto = solo ese host; wildcard (*.) = subdominios, NUNCA el apex; sin
// strip de www. Si divergen, el pipeline bloquea (fail-closed) o autoriza mal.
const netMod = require('./net');

function blank() {
  return {
    nombre: '',
    objetivo: '',
    scope: [],
    autorizado: false,
    rateLimit: '1 req / 2s',
    ventana: '09:00–18:00 CET',
    noTocar: [],
    limites: [],
    tecnicas: [],
    status: 'borrador',
    aprobadoEn: null,
    createdAt: new Date().toISOString(),
  };
}

function validate(p) {
  const pendientes = [];
  if (!p) return { ok: false, pendientes: ['No hay OPPLAN'] };
  if (!p.nombre.trim()) pendientes.push('nombre');
  if (!p.objetivo.trim()) pendientes.push('objetivo');
  if (!p.scope.length) pendientes.push('scope (al menos un asset)');
  if (p.autorizado !== true) pendientes.push('autorización escrita');
  return { ok: pendientes.length === 0, pendientes };
}

function inScope(p, host) {
  if (!p || !p.scope.length) return false;
  const h = netMod.normalizeHost(host);
  if (!h) return false;
  for (const s of p.scope) {
    if (netMod.matchesRule(h, s)) return true;
  }
  return false;
}

function render(p) {
  if (!p) return '⚠️ Sin OPPLAN.';
  const lines = [
    `📋 OPPLAN: ${p.nombre}  [${p.status}]`,
    `   🎯 Objetivo: ${p.objetivo}`,
    `   📍 Scope: ${p.scope.join(', ') || '(vacío)'}`,
    `   🔑 Autorización escrita: ${p.autorizado ? 'SÍ' : 'NO'}`,
    `   ⏱️  Rate limit: ${p.rateLimit} | Ventana: ${p.ventana}`,
    `   🚫 No tocar: ${p.noTocar.join(', ') || '(vacío)'}`,
  ];
  const v = validate(p);
  if (!v.ok) lines.push(`   ⛔ Pendiente: ${v.pendientes.join(', ')}`);
  return lines.join('\n');
}

module.exports = { blank, validate, inScope, render };