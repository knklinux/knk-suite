import React, { useEffect, useState } from 'react';
import Dashboard from './components/Dashboard';
import Opplan from './components/Opplan';
import KaliTerminal from './components/KaliTerminal';
import PipelineHub from './components/PipelineHub';
import CamerasHub from './components/CamerasHub';
import { NAV_GROUPS, NAV_MODULES, visibleGroups, LAB_MODULES } from './nav';
import Jobs from './components/Jobs';
import CheatSheet from './components/CheatSheet';
import Gates from './components/Gates';
import Repeater from './components/Repeater';
import ParamHunter from './components/ParamHunter';
import Reportes from './components/Reportes';
import Compliance from './components/Compliance';
import Assistant from './components/Assistant';
import Vault from './components/Vault';
import Revocation from './components/Revocation';
import OSINT from './components/OSINT';
import LiligoVirtual from './components/LiligoVirtual';
import Targets from './components/Targets';
import Labs from './components/Labs';
import CommandPalette from './components/CommandPalette';
import ViewAmbient from './components/ViewAmbient';
import ToolsInstaller from './components/ToolsInstaller';
import ReportExport from './components/ReportExport';
import NucleiPanel from './components/NucleiPanel';
import ClipboardManager from './components/ClipboardManager';
import AlertsPanel from './components/AlertsPanel';
import LiligoPanel from './components/LiligoPanel';
import TeamPanel from './components/TeamPanel';
import PluginsPanel from './components/PluginsPanel';
import OfflineCachePanel from './components/OfflineCachePanel';
import TorPanel from './components/TorPanel';
import OastPanel from './components/OastPanel';
import ProxyPanel from './components/ProxyPanel';
import FindingsPanel from './components/FindingsPanel';
import { backendStatus, openAssistantWindow } from './desktop-api';
import { apiFetch } from './api';

const API = '/api';
const APP_VERSION = 'v4.2';

export async function api(url, opts = {}) {
  return apiFetch(url, opts);
}

function shortModel(m) {
  const s = String(m || '');
  if (!s) return '';
  return s.split(':')[0].replace(/-\d+(\.\d+)*b$/i, '').slice(0, 22) || s.slice(0, 22);
}

export default function App() {
  const floating = window.location.hash === '#assistant';
  const [view, setView] = useState(floating ? 'assistant' : 'dashboard');
  // Keep-alive: cada vista se monta una sola vez y se oculta (no se
  // desmonta), así cambiar de pestaña ya no resetea resultados ni sesiones.
  const [visited, setVisited] = useState(() => new Set([floating ? 'assistant' : 'dashboard']));
  const go = (next) => {
    setVisited((prev) => { const s = new Set(prev); s.add(next); return s; });
    setView(next);
  };
  const [status, setStatus] = useState({});
  const [health, setHealth] = useState(null);
  const [sendToTerminal, setSendToTerminal] = useState(null);
  const [palette, setPalette] = useState(false);
  const [ambientIntensity, setAmbientIntensity] = useState(1);
  const [desktopState, setDesktopState] = useState(null);
  // Modo BOUNTY (caza, sin juguetes) vs LAB (todo). Persiste en localStorage.
  const [mode, setMode] = useState(() => { try { return localStorage.getItem('knk.mode') === 'lab' ? 'lab' : 'bounty'; } catch { return 'bounty'; } });
  const switchMode = (m) => { setMode(m); try { localStorage.setItem('knk.mode', m); } catch {} };

  useEffect(() => {
    if (floating) document.title = 'KNK Assistant';
    const refresh = () => {
      api('/status').then(setStatus).catch(() => {});
      api('/health').then(setHealth).catch(() => {});
    };
    refresh();
    backendStatus().then(setDesktopState).catch(() => {});
    const timer = setInterval(refresh, 12000);
    return () => clearInterval(timer);
  }, [floating]);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette((value) => !value);
      }
      if (event.key === 'Escape') setPalette(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (floating) return <div className="floating-root"><Assistant api={api} floating /></div>;

  const send = (payload) => setSendToTerminal({ ...(payload || {}), ts: Date.now() });
  // Puente → Repeater: escribe el raw en el mismo canal de prefill del Repeater
  const setSendToRepeater = (raw) => setSendToTerminal({ raw, ts: Date.now() });
  const views = {
    dashboard: <Dashboard api={api} status={status} health={health} go={go} sendToRepeater={setSendToRepeater} />,
    targets: <Targets api={api} />,
    opplan: <Opplan api={api} />,
    pipeline: <PipelineHub api={api} />,
    jobs: <Jobs api={api} sendToTerminal={send} />,
    terminal: <KaliTerminal api={api} inject={sendToTerminal} />,
    cheatsheet: <CheatSheet onSendToTerminal={(cmd) => send({ cmd })} onGoToTerminal={() => go('terminal')} />,
    gates: <Gates api={api} />,
    repeater: <Repeater api={api} prefill={sendToTerminal?.raw || null} />,
    reportes: <Reportes api={api} />,
    compliance: <Compliance api={api} />,
    assistant: <Assistant api={api} />,
    vault: <Vault api={api} />,
    revocation: <Revocation api={api} />,
    osint: <OSINT api={api} />,
    cameras: <CamerasHub api={api} />,
    liligo: <LiligoVirtual api={api} sendToTerminal={send} />,
    labs: <Labs api={api} />,
    tools: <ToolsInstaller api={api} />,
    'report-export': <ReportExport api={api} />,
    nuclei: <NucleiPanel api={api} />,
    clipboard: <ClipboardManager api={api} />,
    alerts: <AlertsPanel api={api} />,
    'liligo-real': <LiligoPanel api={api} />,
    team: <TeamPanel api={api} />,
    plugins: <PluginsPanel api={api} />,
    cache: <OfflineCachePanel api={api} />,
    tor: <TorPanel api={api} />,
    oast: <OastPanel api={api} />,
    findings: <FindingsPanel api={api} go={go} sendToRepeater={setSendToRepeater} />,
    proxy: <ProxyPanel api={api} go={go} sendToRepeater={setSendToRepeater} />,
    params: <ParamHunter api={api} go={go} sendToRepeater={setSendToRepeater} />,
  };

  const groups = visibleGroups(mode);
  const kali = health?.subsystems?.kali;
  const llmUp = status?.ollama?.up ?? status?.up;
  const llmModel = status?.ollama?.model || '';

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand-mark">
          <div className="brand-terminal-title">┌──(root@knkLinux)-[~]</div>
          <div className="brand-subtitle">SECURITY WORKBENCH</div>
          <div className="brand-version">{APP_VERSION} · {llmUp ? shortModel(llmModel) || 'LLM' : 'LLM off'} · Local Tools</div>
        </div>
        <nav className="nav" aria-label="Módulos">
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <button className={`btn btn-sm ${mode === 'bounty' ? '' : 'btn-outline'}`} onClick={() => switchMode('bounty')} title="Solo módulos de caza">🎯 BOUNTY</button>
            <button className={`btn btn-sm ${mode === 'lab' ? '' : 'btn-outline'}`} onClick={() => switchMode('lab')} title="Todo, incluido hardware y ocio">🧪 LAB</button>
          </div>          {groups.map(([group, items]) => <div className="nav-group" key={group}>
            <div className="nav-group-title">{group}</div>
            {items.map((item, index) => <button className={`turret nav-server-${index % 4} ${view === item ? 'active' : ''}`} key={item} onClick={() => go(item)} title={NAV_MODULES[item]?.label || item}>
              <span className="nav-ico">{NAV_MODULES[item]?.icon}</span>
              <span className="nav-label">{NAV_MODULES[item]?.label || item}</span>
              <span className="nav-srv">SRV-{String(index + 1).padStart(2, '0')}</span>
              {(item === 'assistant' && llmUp) || (item === 'terminal' && kali?.status === 'RUNTIME_READY') ? <span className="nav-dot" /> : null}
            </button>)}
          </div>)}
        </nav>
        <div className="sidebar-controls">
          <label className="muted">ambient <input type="range" min="0" max="1" step="0.05" value={ambientIntensity} onChange={(event) => setAmbientIntensity(Number(event.target.value))} /></label>
        </div>
        <div className="status">
          <span className="st-line"><span className={`st-dot ${kali?.status === 'RUNTIME_READY' ? 'on' : 'off'}`} /> Kali: {kali?.status || '…'}</span>
          <span className="st-line"><span className={`st-dot ${llmUp ? 'on' : 'off'}`} /> LLM: {llmUp ? shortModel(llmModel) : 'OFF'}</span>
          <span className="st-line"><span className="st-dot idle" /> {status.session?.target || 'sin target'}</span>
        </div>
      </aside>
      <main className="main">
        <ViewAmbient view={view} intensity={ambientIntensity} disabled={{}} />
        <header className="topbar"><div><span className="topbar-prompt">root@knkLinux</span><span className="topbar-sep">:</span><span className="topbar-path">~/workbench</span><span className="topbar-cursor">_</span></div><div className="topbar-status"><span className="status-pulse" /> {desktopState?.running ? 'TAURI · ' : 'WEB · '}{llmUp ? `AI ${shortModel(llmModel) || 'ON'}` : 'AI OFF'} <button className="btn btn-sm btn-outline assistant-popout" onClick={() => openAssistantWindow().catch(() => {})}>assistant flotante</button></div></header>
        {Object.entries(views).map(([key, node]) => visited.has(key) && (
          <div key={key} style={{ display: key === (views[view] ? view : 'dashboard') ? 'block' : 'none' }}>
            {node}
          </div>
        ))}
      </main>
      {palette && <CommandPalette mode={mode} onClose={() => setPalette(false)} onGo={(next) => { go(next); setPalette(false); }} />}
    </div>
  );
}
