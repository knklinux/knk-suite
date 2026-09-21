'use strict';

// ============================================================================
// KNK SUITE — Asistente Electra (Ollama local; roles con fallback real)
// ============================================================================

const llm = require('./llm');
const vault = require('./vault');
const db = require('../db');

const ROUTES = {
  chat: {
    system: 'Eres KNK, el asistente del workbench knkLinux. Tono cercano, técnico y directo. Respondes en español, sin relleno.',
  },
  code: {
    system: 'Eres KNK en modo programación. Escribes código correcto, mínimo y comentado solo lo imprescindible. Explicas decisiones clave en español. Prefieres Node/Python/bash según el contexto.',
  },
  pentest: {
    system: [
      'Eres KNK en modo pentesting autorizado, mentor de un investigador en su propio laboratorio.',
      'Ayudas con metodología, interpretación de resultados, análisis de superficie y redacción de hallazgos.',
      'Solo asistes con objetivos propios, laboratorios o autorizaciones explícitas.',
      'No proporcionas técnicas para evadir bloqueos, controles anti-abuso, WAFs ni autenticación de terceros.',
      'Si la petición cruza ese límite, lo dices y propones la vía de laboratorio.',
    ].join(' '),
  },
  study: {
    system: 'Eres KNK en modo estudio (CLLMSE, OWASP LLM Top 10, eJPT). Explicas con claridad didáctica, ejemplos cortos y mnemotecnias; terminas con 2-3 preguntas de repaso.',
  },
  osint: {
    system: 'Eres KNK en modo OSINT. Guías búsquedas de fuentes abiertas legales, interpretas resultados y distingues observación indexada de evidencia validada. No presentas cámaras públicas como vulnerables ni sugieres acceso a activos ajenos.',
  },
  debate: {
    system: 'Eres KNK en modo debate: confrontas ideas con rigor, das pros y contras numerados, detectas supuestos débiles y cierras con una recomendación clara. Español directo.',
  },
  plan: {
    system: 'Eres KNK en modo planificación: divides el objetivo en fases ordenadas con criterios de salida, estimas riesgos y defines qué evidencia cierra cada fase. Español directo.',
  },
  execute: {
    system: 'Eres KNK en modo ejecución: das pasos concretos y comandos listos para el laboratorio local, uno por bloque, con el resultado esperado de cada paso. Nada destructivo fuera del lab.',
  },
};

function classify(prompt) {
  const p = String(prompt || '').toLowerCase();
  const has = (...words) => words.some((word) => p.includes(word));
  if (has('script', 'función', 'funcion', 'código', 'codigo', 'python', 'javascript', 'node', 'regex', 'bug en', 'refactor', 'programa')) return 'code';
  if (has('nmap', 'sqlmap', 'burp', 'payload', 'xss', 'sqli', 'idor', 'ssrf', 'escalada', 'recon', 'subdominio', 'fuzz', 'cve', 'exploit', 'ctf', 'thm', 'hackthebox', 'owasp', 'bug bounty', 'inyección', 'inyeccion')) return 'pentest';
  if (has('osint', 'shodan', 'censys', 'cámara', 'camara', 'dork', 'geoip')) return 'osint';
  if (has('cllmse', 'ejpt', 'estudia', 'explícame', 'explicame', 'qué es', 'que es', 'diferencia entre', 'examen', 'aprender')) return 'study';
  if (has('debate', 'pros y contras', 'qué opinas', 'que opinas', 'convénceme', 'convenceme', 'defiende')) return 'debate';
  if (has('planifica', 'planificame', 'plan ', 'roadmap', 'fases', 'organiza', 'cronograma')) return 'plan';
  return 'chat';
}

function addMemory(sessionId, key, value) {
  const id = `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  db.stmts.addMemory.run(id, sessionId, key || 'nota', String(value).slice(0, 5000));
  return { id };
}

function listMemory(sessionId) { return db.stmts.listMemory.all(sessionId); }
function deleteMemory(sessionId, id) { db.stmts.delMemory.run(sessionId, id); return { ok: true }; }

function memoryBlock(sessionId) {
  const rows = listMemory(sessionId).slice(0, 10);
  return rows.length ? '\n\nMemoria del proyecto (decisiones/notas recientes):\n' + rows.map((row) => `- [${row.key}] ${String(row.value).slice(0, 300)}`).join('\n') : '';
}

async function talk({ prompt, mode, model, sessionId, useVault = true, useMemory = true, history = [] }) {
  const routeKey = ROUTES[mode] ? mode : classify(prompt || '');
  const route = ROUTES[routeKey] || ROUTES.chat;
  const selectedModel = model || undefined; // sin modelo explícito: llm elige por rol con fallback

  // Auto-datos (igual que el stream): snapshot + tools por palabra clave,
  // vía lazy-require para no crear ciclo con assistant-tools.
  let autoBlock = '';
  if (sessionId && prompt) {
    try {
      const tools = require('./assistant-tools');
      const parts = [];
      parts.push('SNAPSHOT DE DATOS REALES (en vivo):\n' + tools.sessionSnapshot(sessionId));
      const p = String(prompt);
      const wants = [];
      if (/hallazgo|finding|vulnerab|reportab|triaje|medium|critical|high/i.test(p)) wants.push(['get_findings', { limit: 10 }]);
      if (/fase|pipeline|avance|progreso|plan\b|opplan|siguiente paso|por d[oó]nde/i.test(p)) wants.push(['get_phase_status', {}]);
      if (/proxy|historial|petici|tr[aá]fico|intercept/i.test(p)) wants.push(['get_proxy_history', { limit: 10 }]);
      if (/programa|scope|alcance|objetivo|bounty/i.test(p)) wants.push(['get_phase_status', {}]);
      const seen = new Set();
      for (const [name, args] of wants) {
        if (seen.has(name) || parts.length >= 3) continue;
        seen.add(name);
        try {       parts.push(`[DATO EN VIVO — ${name}]\n${JSON.stringify(tools.TOOLS[name].run(sessionId, args)).slice(0, 1600)}`); } catch {}
      }
      autoBlock = '\n\nDatos ya resueltos (úsalos y cítalos):\n' + parts.join('\n');
    } catch {}
  }

  let context = '';
  let sources = [];
  if (useVault && prompt) {
    try {
      const result = vault.buildContext(prompt, 5);
      context = result.context;
      sources = result.sources;
    } catch {}
  }

  const system = [
    route.system,
    context ? `Contexto del cerebro local (bóveda Obsidian). Úsalo si aporta y cita [fuente: título]:\n\n${context}` : '',
    useMemory && sessionId ? memoryBlock(sessionId) : '',
    autoBlock,
    'Separa hechos, hipótesis y acciones propuestas. Si no tienes datos suficientes, dilo con honestidad; nunca inventes contenido de la bóveda.',
  ].filter(Boolean).join('\n\n');

  const fullPrompt = [
    ...history.slice(-6).map((item) => `${item.role === 'user' ? 'Usuario' : 'KNK'}: ${String(item.text).slice(0, 400)}`),
    `Usuario: ${prompt}`,
  ].join('\n');

  const response = await llm.generate(fullPrompt, { system, model: selectedModel, route: routeKey });
  return { ...response, mode: routeKey, model: selectedModel || response.model, sources };
}

async function status() {
  const state = await llm.status();
  return { ...state, vault: vault.stats() };
}

module.exports = { talk, status, addMemory, listMemory, deleteMemory, classify, ROUTES };
