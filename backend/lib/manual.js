'use strict';
const PLAYBOOK = [
  { min: '0-5', label: 'scope y reglas', checks: ['Leí scope y exclusiones', 'Confirmé activo autorizado', 'Conozco límites y rate limits'] },
  { min: '5-10', label: 'mapa de endpoints/objetos', checks: ['Listé endpoints/objetos con A/B', 'Clasifiqué hosts por función'] },
  { min: '10-15', label: 'identidades A/B', checks: ['Tengo cuentas A y B propias', 'Sé qué datos no debo tocar'] },
  { min: '15-20', label: '2-3 invariantes', checks: ['Formulé hipótesis de confianza/estado', 'Identifiqué capability vs filtración'] },
  { min: '20-25', label: 'validación y control negativo', checks: ['Reproduje impacto 2×', 'Probé control negativo (404/403) que debe fallar'] },
  { min: '25-30', label: 'decisión', checks: ['Reportar con PoC mínimo o formular siguiente hipótesis'] },
];
const CHECKLIST_FINAL = {
  antesTestear: ['Leí scope y exclusiones', 'Confirmé el activo autorizado', 'Conozco límites y rate limits', 'Tengo cuentas de prueba', 'Sé qué datos no debo tocar'],
  antesReportar: ['Puedo explicar el bug en una frase', 'Sé qué identidad realiza cada acción', 'Reproduje el impacto', 'Probé un control negativo', 'Separé evidencia de hipótesis', 'Sé cómo obtiene el atacante lo necesario', 'No dependo de víctima real', 'No estoy inflando severidad'],
  antesEnviar: ['Título descriptivo', 'Pasos mínimos y reproducibles', 'Requests importantes incluidos', 'Impacto ligado a activo real', 'Límites declarados', 'Remediación razonable'],
};
const CAPABILITY_GATE = [
  { id: 'cap-g0', label: 'Capability obtenida sin autorización o ampliada', check: (m) => m.capabilityImproperlyObtained === true || m.capabilityEscalated === true },
  { id: 'cap-g1', label: 'No es solo posesión de URL firmada bearer', check: (m) => m.onlyPossession !== true },
];
function validateManual(meta) {
  const results = [];
  const add = (id, label, ok) => results.push({ id, label, ok, detail: ok ? 'OK' : 'PENDIENTE' });
  for (const c of CHECKLIST_FINAL.antesTestear) add('pre-test', c, meta[c] === true);
  for (const c of CHECKLIST_FINAL.antesReportar) add('pre-report', c, meta[c] === true);
  for (const c of CHECKLIST_FINAL.antesEnviar) add('pre-send', c, meta[c] === true);
  const ok = results.every(r => r.ok);
  return { ok, results, summary: ok ? 'Manual checklist completo' : 'Checklist incompleto' };
}
function capabilityCheck(meta) {
  const urlSigned = String(meta.bugType || '').toLowerCase().includes('capability') || String(meta.bugType || '').toLowerCase().includes('sas') || String(meta.bugType || '').toLowerCase().includes('url firmada');
  if (!urlSigned) return { sendable: true, summary: null, results: [] };
  const results = CAPABILITY_GATE.map(g => ({ id: g.id, label: g.label, ok: g.check(meta), detail: g.check(meta) ? 'OK' : 'Falta demostrar obtención indebida' }));
  const ok = results.every(r => r.ok);
  return { sendable: ok, summary: ok ? 'Capability con obtención indebida demostrada' : 'Capability sin filtración: falta demostrar cómo obtiene el atacante la URL', results };
}
module.exports = { PLAYBOOK, CHECKLIST_FINAL, validateManual, capabilityCheck };
