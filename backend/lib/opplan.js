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
  if (typeof p.nombre !== 'string' || !p.nombre.trim()) pendientes.push('nombre');
  if (typeof p.objetivo !== 'string' || !p.objetivo.trim()) pendientes.push('objetivo');
  if (!Array.isArray(p.scope) || !p.scope.length) pendientes.push('scope (al menos un asset)');
  if (p.autorizado !== true) pendientes.push('autorización escrita');
  return { ok: pendientes.length === 0, pendientes };
}

function inScope(p, host) {
  if (!p || !p.scope.length) return false;
  const h = String(host || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  for (const s of p.scope) {
    const entry = String(s).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (!entry) continue;
    if (entry.startsWith('*.')) {
      const base = entry.slice(2);
      if (h === base || h.endsWith('.' + base)) return true;
    } else if (h === entry) {
      return true;
    }
  }
  return false;
}

function normalizeHost(value) {
  try {
    const raw = String(value || '').trim();
    const url = raw.includes('://') ? raw : `https://${raw}`;
    return new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return String(value || '').trim().toLowerCase().split('/')[0].replace(/^\[|\]$/g, '');
  }
}

function scopeMatches(scope, host) {
  const h = normalizeHost(host);
  return (Array.isArray(scope) ? scope : []).some((entry) => {
    const e = String(entry || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
    if (!e) return false;
    return e.startsWith('*.') ? h === e.slice(2) || h.endsWith('.' + e.slice(2)) : h === e;
  });
}

function sameScope(left, right) {
  const a = [...new Set(Array.isArray(left) ? left.map(String) : [])].sort();
  const b = [...new Set(Array.isArray(right) ? right.map(String) : [])].sort();
  return JSON.stringify(a) === JSON.stringify(b);
}

// Un plan aprobado solo es válido para la sesión que se aprobó: evita que una
// aprobación persistida sobreviva a un target/scope eliminado o cambiado.
function isApprovedForSession(plan, session) {
  if (!plan || !session || plan.status !== 'aprobado' || plan.autorizado !== true) return false;
  if (!validate(plan).ok || !sameScope(plan.scope, session.scope)) return false;
  const host = normalizeHost(session.target);
  if (!host || !scopeMatches(plan.scope, host) || !scopeMatches(session.scope, host)) return false;
  const excluded = Array.isArray(session.out_of_scope) ? session.out_of_scope : [];
  if (scopeMatches(excluded, host)) return false;
  return true;
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

module.exports = { blank, validate, inScope, render, normalizeHost, sameScope, isApprovedForSession };