import React, { useState, useEffect } from 'react';

const CATEGORIES = ['recon', 'web', 'brute-force', 'misc'];
const CATEGORY_ICONS = { recon: '🔍', 'web': '🌐', 'brute-force': '⚡', misc: '📦' };

export default function ToolsInstaller({ api }) {
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState({});
  const [setupAll, setSetupAll] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    api('/kali/tools')
      .then(r => { if (r.ok !== false) setTools(Array.isArray(r) ? r : r.tools || []); else setError(r.error || 'Error al cargar tools'); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [api]);

  const installTool = async (toolName) => {
    setInstalling(prev => ({ ...prev, [toolName]: true }));
    try {
      const r = await api(`/kali/install/${toolName}`, { method: 'POST' });
      if (r.ok) {
        setTools(prev => prev.map(t => t.name === toolName ? { ...t, installed: true } : t));
        setToast(`✅ ${toolName} instalado`);
      } else {
        setToast(`❌ ${r.error || 'Error instalando ' + toolName}`);
      }
    } catch (e) {
      setToast(`❌ ${e.message}`);
    }
    setInstalling(prev => ({ ...prev, [toolName]: false }));
  };

  const setupAllTools = async () => {
    setSetupAll(true);
    try {
      const r = await api('/kali/setup-all', { method: 'POST' });
      if (r.ok) {
        setTools(prev => prev.map(t => ({ ...t, installed: true })));
        setToast('✅ Todos los tools instalados');
      } else {
        setToast(`❌ ${r.error || 'Error en setup-all'}`);
      }
    } catch (e) {
      setToast(`❌ ${e.message}`);
    }
    setSetupAll(false);
  };

  const filtered = filter === 'all' ? tools : tools.filter(t => t.category === filter);

  if (loading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40 }}>
        <span className="muted">Cargando inventario de tools...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ borderLeft: '4px solid var(--red)' }}>
        <h3>Error</h3>
        <span className="muted">{error}</span>
      </div>
    );
  }

  return (
    <div>
      {toast && <div className="toast" onClick={() => setToast('')}>{toast}</div>}

      <div className="module-heading">
        <div>
          <span className="eyebrow">KALI TOOLS</span>
          <h2>Herramientas de seguridad</h2>
          <span className="muted">Instala y gestiona herramientas de pentesting</span>
        </div>
        <button className="btn btn-sm" onClick={setupAllTools} disabled={setupAll}>
          {setupAll ? '⏳ Instalando...' : '🚀 Instalar Todas'}
        </button>
      </div>

      <div className="tabbar">
        <button className={`btn btn-sm ${filter === 'all' ? '' : 'btn-outline'}`} onClick={() => setFilter('all')}>
          Todas ({tools.length})
        </button>
        {CATEGORIES.map(cat => (
          <button key={cat} className={`btn btn-sm ${filter === cat ? '' : 'btn-outline'}`} onClick={() => setFilter(cat)}>
            {CATEGORY_ICONS[cat]} {cat} ({tools.filter(t => t.category === cat).length})
          </button>
        ))}
      </div>

      <div className="module-grid">
        {filtered.map(tool => (
          <div key={tool.name} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: 12 }}>{tool.name}</h3>
              <span className={`badge ${tool.installed ? 'badge-ok' : 'badge-err'}`}>
                {tool.installed ? '✓ Instalado' : '✗ No instalado'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="badge badge-warn">{CATEGORY_ICONS[tool.category]} {tool.category}</span>
              {tool.version && <span className="muted" style={{ fontSize: 9 }}>v{tool.version}</span>}
            </div>
            {tool.description && <span className="muted" style={{ fontSize: 10 }}>{tool.description}</span>}
            <button
              className={`btn btn-sm ${tool.installed ? 'btn-outline' : ''}`}
              onClick={() => installTool(tool.name)}
              disabled={installing[tool.name] || tool.installed}
              style={{ marginTop: 'auto' }}
            >
              {installing[tool.name] ? '⏳ Instalando...' : tool.installed ? '✓ Listo' : '📥 Instalar'}
            </button>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 24 }}>
          <span className="muted">No hay tools en esta categoría</span>
        </div>
      )}
    </div>
  );
}
