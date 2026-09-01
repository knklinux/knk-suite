import React, { useState, useEffect } from 'react';
import Dashboard from './components/Dashboard';
import Pipeline from './components/Pipeline';
import Terminal from './components/Terminal';
import Gates from './components/Gates';
import Reportes from './components/Reportes';
import Compliance from './components/Compliance';
import Chat from './components/Chat';
import Hunt from './components/Hunt';
import Oplan from './components/Oplan';

const API = '/api';

async function api(url, opts = {}) {
  const r = await fetch(API + url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  return r.json();
}

export default function App() {
  const [view, setView] = useState('dashboard');
  const [status, setStatus] = useState({});

  useEffect(() => {
    api('/status').then(setStatus).catch(() => {});
    const interval = setInterval(() => {
      api('/status').then(setStatus).catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const views = {
    dashboard: <Dashboard api={api} status={status} />,
    pipeline: <Pipeline api={api} />,
    terminal: <Terminal />,
    gates: <Gates api={api} />,
    reportes: <Reportes api={api} />,
    compliance: <Compliance api={api} />,
    chat: <Chat api={api} />,
    hunt: <Hunt api={api} />,
    opplan: <Oplan api={api} />,
  };

  const icons = {
    dashboard: '📊', pipeline: '🚀', terminal: '🐳',
    gates: '✅', reportes: '📝', compliance: '📜', chat: '💬', hunt: '🛡️', opplan: '📋',
  };

  const labels = {
    dashboard: 'Dashboard', pipeline: 'Pipeline', terminal: 'Terminal Kali',
    gates: 'Compuertas', reportes: 'Reportes', compliance: 'Compliance', chat: 'Chat LLM', hunt: 'Threat Hunting', opplan: 'OPPLAN',
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>🐉 KNK SUITE v2.1</h1>
        <nav className="nav">
          {Object.keys(views).map(v => (
            <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
              {icons[v]} {labels[v]}
            </button>
          ))}
        </nav>
        <div className="status">
          <span style={{ color: status.docker ? 'var(--green)' : 'var(--red)' }}>●</span>
          {' '}Docker Kali: {status.docker ? 'ON' : 'OFF'}
          <br />
          <span style={{ color: status.session?.target ? 'var(--green)' : 'var(--muted)' }}>●</span>
          {' '}{status.session?.target || 'Sin target'}
          <br />
          Hallazgos: {status.session?.findings || 0}
        </div>
      </aside>
      <main className="main">
        {views[view]}
      </main>
    </div>
  );
}