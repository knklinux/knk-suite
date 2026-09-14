import React, { useState, useEffect } from 'react';

export default function PluginsPanel({ api }) {
  const [plugins, setPlugins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [installUrl, setInstallUrl] = useState('');
  const [installing, setInstalling] = useState(false);
  const [toast, setToast] = useState('');
  const [selectedPlugin, setSelectedPlugin] = useState(null);

  const loadPlugins = async () => {
    setLoading(true);
    try {
      const r = await api('/plugins');
      if (r?.plugins) setPlugins(r.plugins);
    } catch (e) {}
    finally { setLoading(false); }
  };

  useEffect(() => { loadPlugins(); }, [api]);

  const installPlugin = async () => {
    if (!installUrl.trim()) return;
    setInstalling(true);
    try {
      const r = await api('/plugins/install', {
        method: 'POST',
        body: JSON.stringify({ url: installUrl.trim() }),
      });
      if (r?.ok) {
        setToast('Plugin instalado');
        setInstallUrl('');
        loadPlugins();
      } else {
        setToast(r?.error || 'Error al instalar');
      }
    } catch (e) {
      setToast('Error: ' + e.message);
    } finally {
      setInstalling(false);
    }
  };

  const togglePlugin = async (pluginId, enabled) => {
    try {
      const r = await api(`/plugins/${pluginId}/${enabled ? 'disable' : 'enable'}`, {
        method: 'POST',
      });
      if (r?.ok) {
        setPlugins(prev => prev.map(p =>
          p.id === pluginId ? { ...p, enabled: !enabled } : p
        ));
        setToast(enabled ? 'Plugin deshabilitado' : 'Plugin habilitado');
      }
    } catch (e) {
      setToast('Error: ' + e.message);
    }
  };

  const uninstallPlugin = async (pluginId) => {
    if (!confirm('¿Desinstalar este plugin?')) return;
    try {
      const r = await api(`/plugins/${pluginId}`, { method: 'DELETE' });
      if (r?.ok) {
        setPlugins(prev => prev.filter(p => p.id !== pluginId));
        setSelectedPlugin(null);
        setToast('Plugin desinstalado');
      }
    } catch (e) {
      setToast('Error: ' + e.message);
    }
  };

  const categories = [...new Set(plugins.map(p => p.category).filter(Boolean))];

  return (
    <div>
      <div className="module-heading">
        <div>
          <span className="eyebrow">EXTENSIONES</span>
          <h2>Plugins</h2>
        </div>
        <span className="badge badge-ok">{plugins.length} plugins</span>
      </div>

      <div className="card">
        <h3>Instalar desde URL</h3>
        <div className="inline-form">
          <input
            placeholder="https://github.com/user/plugin.git"
            value={installUrl}
            onChange={e => setInstallUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && installPlugin()}
          />
          <button className="btn btn-sm" onClick={installPlugin} disabled={installing || !installUrl.trim()}>
            {installing ? 'Instalando...' : 'Instalar'}
          </button>
        </div>
      </div>

      {categories.length > 0 && (
        <div className="card">
          <h3>Categorías</h3>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {categories.map(c => (
              <span key={c} className="badge badge-ok">{c}</span>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: 20 }}>
          <span className="muted">Cargando plugins...</span>
        </div>
      ) : plugins.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 20 }}>
          <span className="muted">No hay plugins instalados</span>
        </div>
      ) : (
        <div>
          {plugins.map(p => (
            <div
              key={p.id}
              className="card"
              style={{ cursor: 'pointer', borderColor: selectedPlugin === p.id ? 'var(--primary)' : undefined }}
              onClick={() => setSelectedPlugin(selectedPlugin === p.id ? null : p)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <h3 style={{ marginBottom: 4 }}>{p.name || p.id}</h3>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                    <span className="muted" style={{ fontSize: 10 }}>v{p.version || '0.0.0'}</span>
                    {p.category && <span className="badge badge-ok">{p.category}</span>}
                  </div>
                  {p.description && <span className="muted" style={{ fontSize: 11 }}>{p.description}</span>}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--muted)' }}>
                    <input
                      type="checkbox"
                      checked={p.enabled !== false}
                      onChange={() => togglePlugin(p.id, p.enabled !== false)}
                      style={{ width: 'auto' }}
                    />
                    {p.enabled !== false ? 'ON' : 'OFF'}
                  </label>
                  <button className="btn btn-sm btn-outline" onClick={() => uninstallPlugin(p.id)}>
                    Uninstall
                  </button>
                </div>
              </div>

              {selectedPlugin === p.id && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #16314b' }}>
                  {p.hooks && p.hooks.length > 0 && (
                    <div>
                      <span className="muted" style={{ fontSize: 10, display: 'block', marginBottom: 4 }}>Hooks:</span>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {p.hooks.map((h, i) => (
                          <span key={i} className="badge badge-ok">{h}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {p.author && <div className="kv"><span className="k">Autor</span><span className="v">{p.author}</span></div>}
                  {p.homepage && <div className="kv"><span className="k">Homepage</span><span className="v">{p.homepage}</span></div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
