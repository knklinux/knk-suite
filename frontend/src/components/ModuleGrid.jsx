import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';

const STATIONS = [
  { id: 'targets', icon: '🎯', name: 'Targets', desc: 'Scope y autorización', glow: '#08b9ff', bg: 'radial-gradient(circle at 80% 20%, #083b5e33, transparent 70%)' },
  { id: 'pipeline', icon: '🚀', name: 'Pipeline', desc: 'Fases del engagement', glow: '#42e6a4', bg: 'radial-gradient(circle at 20% 80%, #0d5e3c33, transparent 70%)' },
  { id: 'jobs', icon: '⚙️', name: 'Trabajos', desc: 'Ejecución async', glow: '#f3c75f', bg: 'radial-gradient(circle at 80% 80%, #5e450833, transparent 70%)' },
  { id: 'terminal', icon: '🖥️', name: 'Terminal', desc: 'Kali / runtime real', glow: '#b12cff', bg: 'radial-gradient(circle at 50% 0%, #2a085e44, transparent 75%)' },
  { id: 'assistant', icon: '🤖', name: 'KNK Assistant', desc: 'Copiloto con cerebro', glow: '#08d8ff', bg: 'radial-gradient(circle at 20% 20%, #085e5144, transparent 70%)' },
  { id: 'vault', icon: '📚', name: 'Bóveda', desc: 'Cerebro de conocimiento', glow: '#7aa2ff', bg: 'radial-gradient(circle at 80% 50%, #1a2c6e44, transparent 70%)' },
  { id: 'gates', icon: '✅', name: 'Compuertas', desc: 'Validación pre-envío', glow: '#42e6a4', bg: 'radial-gradient(circle at 50% 100%, #0d5e3c2e, transparent 70%)' },
  { id: 'reportes', icon: '📝', name: 'Reportes', desc: 'Informes de la sesión', glow: '#ff8b4a', bg: 'radial-gradient(circle at 20% 50%, #5e2c0833, transparent 70%)' },
];

export default function ModuleGrid({ go, health, session }) {
  const [jobs, setJobs] = useState([]);
  useEffect(() => { apiFetch('/jobs').then((data) => setJobs(data.jobs || [])).catch(() => {}); }, []);

  const kaliOk = health?.subsystems?.kali?.status === 'RUNTIME_READY';
  const llmUp = health?.subsystems?.ollama?.up;
  const notes = health?.subsystems?.vault?.notes || 0;
  const running = jobs.filter((job) => job.status === 'running' || job.status === 'queued').length;
  const states = {
    targets: { live: !!session?.target, label: session?.target || 'sin objetivo' },
    pipeline: { live: (session?.findings?.length || 0) > 0, label: `${session?.findings?.length || 0} hallazgos` },
    jobs: { live: running > 0, label: running > 0 ? `${running} en ejecución` : 'sin trabajos' },
    terminal: { live: kaliOk, label: kaliOk ? 'Kali READY' : (health?.subsystems?.kali?.status || 'no runtime').replace('RUNTIME_', '') },
    assistant: { live: llmUp, label: llmUp ? 'AI ON' : 'AI offline' },
    vault: { live: notes > 100, label: `${notes} notas` },
    gates: { live: true, label: 'listo' },
    reportes: { live: true, label: 'disponible' },
  };

  return <div className="module-grid">{STATIONS.map((station) => { const state = states[station.id] || { live: false, label: '' }; return <button key={station.id} className="module-station" style={{ '--glow': station.glow }} onClick={() => go(station.id)}><span className="station-bg" style={{ background: station.bg }} /><span className="station-head"><span className="station-icon">{station.icon}</span><span className={`station-live ${state.live ? 'on' : ''}`} /></span><span className="station-name">{station.name}</span><span className="station-desc">{station.desc}</span><span className="station-state">{state.label}</span></button>; })}</div>;
}
