import React, { useState, useMemo, useRef, useEffect } from 'react';
import { apiFetch } from '../api';
import { NAV_ORDER, NAV_MODULES, LAB_MODULES } from '../nav';

function fuzzy(q, text) {
  const t = text.toLowerCase();
  const s = q.toLowerCase();
  let ti = 0; let score = 0; let last = -2; const positions = [];
  for (let si = 0; si < s.length; si += 1) {
    const ch = s[si];
    if (ch === ' ') continue;
    const idx = t.indexOf(ch, ti);
    if (idx === -1) return null;
    let points = 1;
    if (idx === last + 1) points += 5;
    if (idx === 0 || /[\s\-_/·(]/.test(t[idx - 1])) points += 3;
    if (idx > last + 1 && last >= 0) points -= Math.min(2, idx - last - 1);
    score += points; positions.push(idx); last = idx; ti = idx + 1;
  }
  if (positions.length && positions[0] === 0) score += 4;
  return { score, positions };
}

function Highlight({ text, positions }) {
  if (!positions) return text;
  const indexes = new Set(positions);
  return [...text].map((char, index) => indexes.has(index) ? <b key={index} className="palette-hl">{char}</b> : char);
}

export default function CommandPalette({ onGo, onClose, mode = 'bounty' }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const [armed, setArmed] = useState(null);
  const listRef = useRef(null);
  // Fuente única: nav.js (mismo orden y etiquetas que el sidebar).
  const modules = useMemo(() => NAV_ORDER.filter((id) => mode !== 'bounty' || !LAB_MODULES.has(id)).map((id) => ({
    id, label: NAV_MODULES[id].label, kw: NAV_MODULES[id].kw,
  })), [mode]);
  const actions = useMemo(() => [
    { id: 'status-kali', label: 'Kali: estado del runtime', kw: 'kali runtime status wsl vbox', run: async () => { const r = await apiFetch('/kali/status'); return r.status === 'RUNTIME_READY' ? `✓ Kali READY — ${r.runtime || ''} ${r.distro || ''}` : `⛔ ${r.status} — ${r.reason || ''}`; } },
    { id: 'status-llm', label: 'LLM: estado de Ollama', kw: 'ollama modelos llm status', run: async () => { const r = await apiFetch('/llm/status'); return r.up ? `✓ Ollama ON — ${(r.models || []).join(' · ')}` : '⛔ Ollama offline'; } },
    { id: 'status-labs', label: 'Laboratorios: inventario local', kw: 'vm virtualbox wsl inventario laboratorio', run: async () => { const r = await apiFetch('/labs/inventory'); return `✓ ${r.machines?.length || 0} máquinas · ${(r.providers || []).filter((p) => p.installed).length} proveedores`; } },
    { id: 'rebuild-vault', label: 'Reindexar bóveda', kw: 'vault rebuild notas chunks', run: async () => { const r = await apiFetch('/vault/rebuild', { method: 'POST' }); return r.ok !== false ? `✓ bóveda reindexada — ${r.chunks || 0} chunks` : '✗ fallo al reindexar'; } },
  ], []);
  const launches = useMemo(() => [
    { id: 'launch-v6', label: 'Lanzar V6 probe (OpenAI)', kw: 'v6 openai sonda lanzar ejecutar', action: 'v6-openai' },
    { id: 'launch-tools', label: 'Lanzar instalador de tools (Kali)', kw: 'kali tools install apt paquetes', action: 'kali-tools' },
  ], []);
  const all = useMemo(() => {
    const filter = (items) => !q.trim() ? items.map((item) => ({ ...item, kind: item.action ? 'launch' : item.run ? 'act' : 'mod' })) : items.map((item) => { const match = fuzzy(q.trim(), `${item.label} ${item.kw}`); return match ? { ...item, _m: match, kind: item.action ? 'launch' : item.run ? 'act' : 'mod' } : null; }).filter(Boolean).sort((a, b) => b._m.score - a._m.score);
    return filter([...modules, ...actions, ...launches]);
  }, [q, modules, actions, launches]);
  useEffect(() => { setSel(0); setResult(null); setArmed(null); }, [q]);
  useEffect(() => { listRef.current?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }); }, [sel, q]);

  const execute = async (item) => {
    if (item.kind === 'mod') { onGo(item.id); return; }
    if (item.kind === 'launch') {
      if (armed !== item.id) { setArmed(item.id); setResult('⚠️ Vuelve a pulsar Enter para confirmar el lanzamiento.'); return; }
      setArmed(null); setBusy(item.id);
      const r = await apiFetch('/jobs/run', { method: 'POST', body: JSON.stringify(item.action === 'kali-tools' ? { command: 'echo Selecciona tools desde el módulo Trabajos' } : { action: item.action }) });
      setResult(r?.job ? `▶ job ${r.job.id} encolado` : (r?.error || '✗ no se pudo lanzar')); setBusy(null); return;
    }
    setBusy(item.id); try { setResult(await item.run()); } catch (error) { setResult(`✗ ${error.message}`); } finally { setBusy(null); }
  };
  const onKey = (event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setSel((value) => Math.min(all.length - 1, value + 1)); } if (event.key === 'ArrowUp') { event.preventDefault(); setSel((value) => Math.max(0, value - 1)); } if (event.key === 'Escape') { if (armed) setArmed(null); else onClose(); } if (event.key === 'Enter' && all[sel]) { event.preventDefault(); execute(all[sel]); } };

  return <div className="palette-backdrop" onClick={onClose}><div className="palette" onClick={(event) => event.stopPropagation()}><div className="palette-input"><span>⌘</span><input autoFocus value={q} onChange={(event) => setQ(event.target.value)} onKeyDown={onKey} placeholder="saltar a módulo o ejecutar acción…" /></div><div className="palette-list" ref={listRef}>{all.length === 0 && <div className="muted">sin coincidencias</div>}{all.map((item, index) => <button className={index === sel ? 'sel' : ''} key={`${item.kind}-${item.id}`} onMouseEnter={() => setSel(index)} onClick={() => execute(item)}><span className="palette-kind">{item.kind === 'mod' ? 'MOD' : item.kind === 'act' ? 'CHK' : 'RUN'}</span><span><Highlight text={item.label} positions={item._m?.positions} /><small>{item.kw}</small></span><span>{busy === item.id ? '…' : armed === item.id ? 'CONFIRMAR' : '↵'}</span></button>)}</div>{result && <div className="palette-result">{result}</div>}<div className="palette-help">↑↓ navegar · Enter ejecutar · Esc cerrar</div></div></div>;
}
