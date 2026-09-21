'use strict';

// ============================================================================
// assistant-tools.js — Herramientas (function-calling) para el asistente.
//
// Protocolo robusto e independiente del modelo (Ollama no expone tools
// nativas en /api/chat para todos los modelos locales):
//
//   1. El system prompt anuncia las herramientas y el formato de llamada:
//         @tool nombre {"arg": "valor"}
//   2. El extractor tolerante encuentra esas líneas en la salida del modelo
//      (tolera fences ```json, texto antes/después y varias llamadas).
//   3. Las funciones REALES se ejecutan (jamás se devuelve texto inventado
//      como dato) y se re-consulta al modelo con los resultados
//      (loop de herramientas, tope MAX_TOOL_LOOPS).
//   4. El streaming NDJSON de Ollama se traduce a SSE hacia la UI.
// ============================================================================

const db = require('../db');
const proxyMod = require('./proxy');
const pipeline = require('./pipeline');

const MAX_TOOL_LOOPS = 2;
const MAX_PROMPT_SAFE = 8000;

// ── 1) Herramientas: datos reales de la sesión (cero hallucination) ────────

function listFindings(sessionId, args = {}) {
  const limit = Math.max(1, Math.min(Number(args.limit) || 12, 25));
  let rows = db.getFindings(sessionId);
  if (args.severity) rows = rows.filter((f) => f.severity === String(args.severity).toLowerCase());
  if (args.type) rows = rows.filter((f) => f.type === String(args.type));
  rows = rows.slice(0, limit);
  return {
    count: rows.length,
    items: rows.map((f) => ({
      id: f.id,
      type: f.type,
      severity: f.severity,
      summary: f.summary,
      asset: (f.details && f.details.asset) || undefined,
      url: (f.details && f.details.url) || undefined,
      origin: (f.details && f.details.osint && f.details.osint.tool) || (f.details && f.details.source) || 'pipeline',
    })),
  };
}

function proxyHistory(sessionId, args = {}) {
  const limit = Math.max(1, Math.min(Number(args.limit) || 15, 40));
  const h = proxyMod.history({ limit, q: args.q || '' });
  return {
    count: h.count,
    items: (h.entries || []).map((e) => ({
      id: e.id,
      method: e.method,
      url: e.url,
      status: e.status,
      durationMs: e.durationMs,
      reqPreview: String(e.reqBodyPreview || '').slice(0, 150),
      resPreview: String(e.resBodyPreview || '').slice(0, 150),
    })),
  };
}

function phaseStatus(sessionId) {
  const raw = db.stmts.getSession.get(sessionId);
  if (!raw) return { error: 'sesión no encontrada' };
  let phases = {};
  let opplan = {};
  try { phases = JSON.parse(raw.phases || '{}'); } catch {}
  try { opplan = JSON.parse(raw.opplan || '{}'); } catch {}
  const known = pipeline.PHASES || [];
  const summary = known.length
    ? known.map((id) => {
        const st = phases[id] || {};
        return { phase: id, done: st.done === true, ok: st.result ? st.result.ok === true : null };
      })
    : Object.keys(phases).map((id) => ({ phase: id, done: !!(phases[id] && phases[id].done), ok: null }));
  const findings = db.getFindings(sessionId);
  return {
    target: raw.target || '(sin target)',
    scope: JSON.parse(raw.scope || '[]'),
    opplan: opplan.status || 'sin plan',
    phases: summary,
    findingsTotal: findings.length,
    findingsBySeverity: findings.reduce((acc, f) => { acc[f.severity] = (acc[f.severity] || 0) + 1; return acc; }, {}),
  };
}

// ── Snapshot determinista de la sesión (grounding) ─────────────────────────
// Se inyecta EN EL SYSTEM PROMPT: el modelo responde con datos reales aunque
// nunca emita @tool (los modelos locales a veces "role-playean" el protocolo
// y alucinan). Las tools quedan para profundizar (filtros, búsquedas).

function sessionSnapshot(sessionId) {
  const raw = db.stmts.getSession.get(sessionId);
  if (!raw) return '(sin sesión)';
  let phases = {};
  let opplan = {};
  try { phases = JSON.parse(raw.phases || '{}'); } catch {}
  try { opplan = JSON.parse(raw.opplan || '{}'); } catch {}
  const known = pipeline.PHASES || [];
  const mark = (id) => (phases[id] && phases[id].done ? 'hecho' : 'pendiente');
  const faseLine = known.length ? known.map((id) => id + '=' + mark(id)).join(' ') : 'ninguna';
  const findings = db.getFindings(sessionId);
  const bySev = findings.reduce((acc, f) => { acc[f.severity] = (acc[f.severity] || 0) + 1; return acc; }, {});
  const triOf = (f) => f.status || (f.details && f.details.triage && f.details.triage.status) || 'nuevo';
  const byTri = findings.reduce((acc, f) => { const k = triOf(f); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  const assetOf = (f) => (f.details && (f.details.asset || f.details.url)) || '';
  const topFindings = findings.slice(-6).map((f) => '  · [' + f.severity + '/' + triOf(f) + '] #' + f.id + ' ' + f.type + ': ' + f.summary + (assetOf(f) ? ' @' + String(assetOf(f)).slice(0, 80) : ''));
  const program = raw.program_name || raw.program_url || '(sin programa)';
  let scope = [];
  try { scope = JSON.parse(raw.scope || '[]'); } catch {}
  const h = proxyMod.history({ limit: 5, q: '' });
  const proxyLines = (h.entries || []).slice(0, 5).map((e) => '  · ' + e.method + ' ' + e.url + ' -> ' + e.status);
  return [
    '- Target: ' + (raw.target || '(sin target)') + ' | Programa: ' + program + ' | OPPLAN: ' + (opplan.status || 'sin plan') + ' | Fases: ' + faseLine,
    '- Scope: ' + (scope.length ? scope.join(', ') : '(sin definir — caza limitada)') ,
    '- Hallazgos: ' + findings.length + ' en total (' + (Object.entries(bySev).map(([k, v]) => k + ': ' + v).join(', ') || 'ninguno') + ') · triaje (' + (Object.entries(byTri).map(([k, v]) => k + ': ' + v).join(', ') || '—') + ')' + (topFindings.length ? ', últimos:' : ''),
    ...topFindings,
    '- Proxy HTTP: ' + h.count + ' entradas capturadas' + (proxyLines.length ? ', últimas:' : ''),
    ...proxyLines,
  ].join('\n');
}

// Registro público: nombre → { description, args, run }
const TOOLS = {
  get_findings: {
    description: 'Devuelve hallazgos reales de la sesión (tipo, severidad, resumen, asset/url).',
    args: '{ "severity": "high|medium|low|info (opcional)", "type": "filtro por tipo (opcional)", "limit": "1-25 (opcional)" }',
    run: (sessionId, args) => listFindings(sessionId, args),
  },
  get_proxy_history: {
    description: 'Devuelve entradas reales del historial del proxy HTTP capturado (método, URL, estado, previews).',
    args: '{ "q": "filtro por texto/método/status (opcional)", "limit": "1-40 (opcional)" }',
    run: (sessionId, args) => proxyHistory(sessionId, args),
  },
  get_phase_status: {
    description: 'Devuelve el estado real del engagement: target, scope, OPPLAN, fases del pipeline y conteo de hallazgos.',
    args: '{}',
    run: (sessionId, args) => phaseStatus(sessionId, args),
  },
};

const TOOLS_MANUAL = Object.entries(TOOLS)
  .map(([name, t]) => `- ${name}: ${t.description} Args JSON: ${t.args}`)
  .join('\n');

// ── 2) Extractor tolerante de llamadas @tool ────────────────────────────────

const TOOL_RX_SRC = '@tool\\s+([a-zA-Z0-9_]+)\\s*(\\{[\\s\\S]*?\\})?\\s*(?=\\n|$)';

function extractToolCalls(text) {
  const calls = [];
  const rx = new RegExp(TOOL_RX_SRC, 'g');
  let m;
  while ((m = rx.exec(String(text || ''))) !== null) {
    const name = m[1];
    if (!TOOLS[name]) continue;
    let args = {};
    if (m[2]) {
      try { args = JSON.parse(m[2]); } catch { args = {}; }
    }
    calls.push({ name, args: args && typeof args === 'object' ? args : {} });
  }
  return calls;
}

function stripToolLines(text) {
  const rx = new RegExp(TOOL_RX_SRC, 'g');
  return String(text || '')
    .replace(rx, '')
    .replace(/^.*@tool.*$/gm, (line) => (/@tool\s+[a-zA-Z0-9_]+/.test(line) ? '' : line))
    .replace(/```json[\s\S]*?```/g, (f) => (/@tool/.test(f) ? '' : f))
    .trim();
}

// ── 3) System prompt de herramientas ────────────────────────────────────────

function toolsSystemBlock(sessionId) {
  const lines = [
    'DATOS DE LA SESIÓN — REGLA ANTI-INVENCIÓN:',
    '· Debajo tienes un SNAPSHOT de datos reales. Si la respuesta está ahí, úsala directamente y CITA esos valores literales.',
    '· Si necesitas filtrar o buscar más allá del snapshot, emite UNA línea de llamada: @tool nombre {"arg": "valor"}',
    '· PROHIBIDO inventar datos de la sesión o simular bloques [TOOL_RESULT]: si no tienes el dato, dilo o llama a la herramienta.',
    'Herramientas para profundizar:',
    TOOLS_MANUAL,
  ];
  if (sessionId) {
    try { lines.push('SNAPSHOT DE DATOS REALES (en vivo):', sessionSnapshot(sessionId)); } catch {}
  }
  return lines.join('\n');
}

// ── 4) Talk con streaming (SSE) + loop de herramientas ─────────────────────
// `emit(event)` recibe la UI; devuelve el resultado final (para el test).

async function talkStream(opts, emit) {
  const { prompt, mode, model, sessionId, useVault = true, useMemory = true, history = [] } = opts;
  const assistant = require('./assistant');
  const llm = require('./llm');

  const routeKey = assistant.ROUTES && assistant.ROUTES[mode] ? mode : assistant.classify(prompt || '');
  const route = assistant.ROUTES[routeKey] || assistant.ROUTES.chat;

  let context = '';
  let sources = [];
  if (useVault && prompt) {
    try {
      const r = require('./vault').buildContext(prompt, 5);
      context = r.context; sources = r.sources || [];
    } catch {}
  }

  let memoryBlock = '';
  if (useMemory && sessionId) {
    try {
      const rows = assistant.listMemory(sessionId).slice(0, 10);
      memoryBlock = rows.length ? '\n\nMemoria del proyecto (decisiones/notas recientes):\n' + rows.map((row) => `- [${row.key}] ${String(row.value).slice(0, 300)}`).join('\n') : '';
    } catch {}
  }

  // ── Auto-datos por palabra clave ─────────────────────────────────────
  // Los modelos locales a veces no emiten @tool aunque lo necesiten: si la
  // pregunta menciona hallazgos/fases/proxy/programa, se inyectan los datos
  // ANTES de generar (determinista, sin cooperar el modelo). Máx 2 bloques.
  let autoBlock = '';
  if (sessionId && prompt) {
    const p = String(prompt);
    const wants = [];
    if (/hallazgo|finding|vulnerab|reportab|triaje|medium|critical|high/i.test(p)) wants.push(['get_findings', { limit: 10 }]);
    if (/fase|pipeline|avance|progreso|plan\b|opplan|siguiente paso|por d[oó]nde/i.test(p)) wants.push(['get_phase_status', {}]);
    if (/proxy|historial|petici|tr[aá]fico|intercept/i.test(p)) wants.push(['get_proxy_history', { limit: 10 }]);
    if (/programa|scope|alcance|objetivo|presupuesto|bounty/i.test(p)) wants.push(['get_phase_status', {}]);
    const seen = new Set();
    const parts = [];
    for (const [name, args] of wants) {
      if (seen.has(name) || parts.length >= 2) continue;
      seen.add(name);
      try {
        const data = TOOLS[name].run(sessionId, args);
        parts.push(`[DATO EN VIVO — ${name}]\n${JSON.stringify(data).slice(0, 1600)}`);
      } catch {}
    }
    if (parts.length) autoBlock = '\n\nDatos ya resueltos (NO llames a estas tools, úsalos y cítalos):\n' + parts.join('\n');
  }

  const system = [
    route.system,
    toolsSystemBlock(sessionId),
    context ? `Contexto del cerebro local (bóveda Obsidian). Úsalo si aporta y cita [fuente: título]:\n\n${context}` : '',
    memoryBlock,
    autoBlock,
  ].filter(Boolean).join('\n\n');

  const historyLines = (history || []).slice(-6).map((item) => `${item.role === 'user' ? 'Usuario' : 'KNK'}: ${String(item.text).slice(0, 400)}`);
  const llmForPick = require('./llm');
  const chosenModel = model || (await llmForPick.pickModel(routeKey).catch(() => null));
  let convo = [{ role: 'user', content: [...historyLines, `Usuario: ${String(prompt || '').slice(0, MAX_PROMPT_SAFE)}`].filter(Boolean).join('\n') }];

  const toolEvents = [];
  let finalSources = sources;

  for (let loop = 0; loop <= MAX_TOOL_LOOPS; loop++) {
    const chunks = [];
    const streamed = await llm.generateStream(convo, { system, model: chosenModel, route: routeKey }, (piece) => {
      chunks.push(piece);
      try { emit({ type: 'delta', delta: piece }); } catch {}
    });
    let full = chunks.join('');
    if (!streamed) {
      const r = await llm.generate(convo.map((m) => m.content).join('\n\n'), { system, model: chosenModel, route: routeKey });
      full = r.text || '';
      if (!r.ok) {
        emit({ type: 'error', error: r.error || 'LLM offline' });
        return { ok: false, error: r.error || 'LLM offline', mode: routeKey, sources: finalSources, tools: toolEvents };
      }
      emit({ type: 'delta', delta: full });
    }

    const calls = extractToolCalls(full);
    if (!calls.length || loop === MAX_TOOL_LOOPS) {
      // Guardia anti-simulación: si el modelo role-playeó el protocolo
      // (escribió [TOOL_RESULT] sin que nadie ejecutara nada), se corta el
      // eco para que el usuario no vea datos falsos presentados como reales.
      const clean = stripToolLines(full).split('[TOOL_RESULT]')[0].trim();
      emit({ type: 'done', mode: routeKey, model: chosenModel, tools: toolEvents, finalText: clean });
      return { ok: true, text: clean, mode: routeKey, model: chosenModel, sources: finalSources, tools: toolEvents };
    }

    // Ejecutar herramientas REALES y re-consultar al modelo
    emit({ type: 'tools', calls: calls.map((c) => c.name) });
    const results = [];
    for (const call of calls) {
      const t0 = Date.now();
      let result;
      try { result = TOOLS[call.name].run(sessionId, call.args || {}); }
      catch (e) { result = { error: e.message }; }
      toolEvents.push({ tool: call.name, args: call.args, elapsedMs: Date.now() - t0 });
      results.push({ tool: call.name, result });
    }
    finalSources = [...(finalSources || []), ...results.map((r) => ({ title: `tool:${r.tool}`, kind: 'tool' }))];

    convo = [
      ...convo,
      { role: 'assistant', content: full },
      { role: 'user', content: `[TOOL_RESULT]\n${results.map((r) => `@${r.tool} → ${JSON.stringify(r.result).slice(0, 6000)}`).join('\n')}\n\nCon estos datos reales responde al usuario en español.` },
    ];
  }

  emit({ type: 'done', mode: routeKey, model: chosenModel, tools: toolEvents });
  return { ok: true, text: '', mode: routeKey, model: chosenModel, sources: finalSources, tools: toolEvents };
}

module.exports = { TOOLS, extractToolCalls, stripToolLines, toolsSystemBlock, talkStream, listFindings, proxyHistory, phaseStatus, sessionSnapshot, MAX_TOOL_LOOPS };
