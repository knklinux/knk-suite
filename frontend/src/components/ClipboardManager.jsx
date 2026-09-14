import React, { useState, useEffect } from 'react';

const CATEGORIES = ['All', 'Payload', 'Command', 'Snippet', 'Note'];
const CATEGORY_COLORS = {
  Payload: 'var(--red)',
  Command: 'var(--primary)',
  Snippet: 'var(--green)',
  Note: 'var(--yellow)',
};

export default function ClipboardManager({ api }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('All');
  const [search, setSearch] = useState('');
  const [newText, setNewText] = useState('');
  const [newCategory, setNewCategory] = useState('Payload');
  const [newTags, setNewTags] = useState('');
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState({});
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    loadEntries();
  }, [api]);

  const loadEntries = () => {
    setLoading(true);
    api('/clipboard')
      .then(r => {
        const list = Array.isArray(r) ? r : r.entries || r.items || [];
        setEntries(list);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  const addEntry = async () => {
    if (!newText.trim()) return;
    setAdding(true);
    try {
      const r = await api('/clipboard', {
        method: 'POST',
        body: JSON.stringify({
          text: newText.trim(),
          category: newCategory,
          tags: newTags.split(',').map(t => t.trim()).filter(Boolean),
        }),
      });
      if (r.ok !== false) {
        setNewText('');
        setNewTags('');
        setToast('✅ Entrada agregada');
        await loadEntries();
      } else {
        setToast(`❌ ${r.error || 'Error al agregar'}`);
      }
    } catch (e) {
      setToast(`❌ ${e.message}`);
    }
    setAdding(false);
  };

  const deleteEntry = async (id) => {
    setDeleting(prev => ({ ...prev, [id]: true }));
    try {
      const r = await api(`/clipboard/${id}`, { method: 'DELETE' });
      if (r.ok !== false) {
        setToast('🗑️ Entrada eliminada');
        setEntries(prev => prev.filter(e => e.id !== e._id && e.id !== id));
      } else {
        setToast(`❌ ${r.error || 'Error al eliminar'}`);
      }
    } catch (e) {
      setToast(`❌ ${e.message}`);
    }
    setDeleting(prev => ({ ...prev, [id]: false }));
  };

  const copyToClipboard = (text) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        setToast('📋 Copiado al portapapeles');
      });
    }
  };

  const filtered = entries.filter(entry => {
    const matchTab = activeTab === 'All' || entry.category === activeTab;
    const matchSearch = !search ||
      (entry.text || '').toLowerCase().includes(search.toLowerCase()) ||
      (entry.tags || []).some(t => t.toLowerCase().includes(search.toLowerCase()));
    return matchTab && matchSearch;
  });

  if (loading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40 }}>
        <span className="muted">Cargando clipboard...</span>
      </div>
    );
  }

  return (
    <div>
      {toast && <div className="toast" onClick={() => setToast('')}>{toast}</div>}

      <div className="module-heading">
        <div>
          <span className="eyebrow">CLIPBOARD</span>
          <h2>Payload & Snippet Manager</h2>
          <span className="muted">Gestiona payloads, comandos y snippets reutilizables</span>
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderLeft: '4px solid var(--yellow)', marginBottom: 12 }}>
          <span className="muted">{error}</span>
        </div>
      )}

      <div className="card">
        <h3>Agregar nuevo</h3>
        <textarea
          value={newText}
          onChange={e => setNewText(e.target.value)}
          placeholder="Texto del payload, comando o snippet..."
          rows={3}
          style={{ fontFamily: 'monospace', fontSize: 11, marginBottom: 8 }}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={newCategory} onChange={e => setNewCategory(e.target.value)}>
            {CATEGORIES.filter(c => c !== 'All').map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input
            value={newTags}
            onChange={e => setNewTags(e.target.value)}
            placeholder="Tags (separados por coma)"
            style={{ flex: 1 }}
          />
          <button className="btn btn-sm" onClick={addEntry} disabled={adding || !newText.trim()}>
            {adding ? '⏳ Agregando...' : '+ Agregar'}
          </button>
        </div>
      </div>

      <div className="tabbar" style={{ marginBottom: 8 }}>
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            className={`btn btn-sm ${activeTab === cat ? '' : 'btn-outline'}`}
            onClick={() => setActiveTab(cat)}
          >
            {cat !== 'All' && <span style={{ color: CATEGORY_COLORS[cat] }}>●</span>} {cat}
            <span className="muted" style={{ marginLeft: 4, fontSize: 9 }}>
              ({cat === 'All' ? entries.length : entries.filter(e => e.category === cat).length})
            </span>
          </button>
        ))}
      </div>

      <div className="card">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Buscar por contenido o tags..."
          style={{ marginBottom: 12 }}
        />

        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <span className="muted">{entries.length === 0 ? 'No hay entradas en el clipboard' : 'Sin resultados para esta búsqueda'}</span>
          </div>
        )}

        {filtered.map((entry, i) => {
          const id = entry.id || entry._id || i;
          return (
            <div key={id} style={{ padding: '10px 0', borderBottom: '1px solid #16314b' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <pre style={{
                    margin: 0, padding: '6px 8px', background: 'var(--bg)', borderRadius: 4,
                    fontSize: 10, fontFamily: 'monospace', color: '#a8dfff', whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all', maxHeight: 80, overflow: 'auto',
                    border: '1px solid #16314b',
                  }}>
                    {entry.text}
                  </pre>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                    <span className="badge" style={{
                      color: CATEGORY_COLORS[entry.category] || 'var(--muted)',
                      background: `${CATEGORY_COLORS[entry.category] || 'var(--muted)'}22`,
                      border: `1px solid ${CATEGORY_COLORS[entry.category] || 'var(--muted)'}44`,
                    }}>
                      {entry.category}
                    </span>
                    {(entry.tags || []).map((tag, j) => (
                      <span key={j} className="badge" style={{ fontSize: 8, color: 'var(--primary)' }}>{tag}</span>
                    ))}
                    {entry.createdAt && (
                      <span className="muted" style={{ fontSize: 9, marginLeft: 'auto' }}>
                        {new Date(entry.createdAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => copyToClipboard(entry.text)}
                    title="Copiar"
                  >
                    📋
                  </button>
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => deleteEntry(id)}
                    disabled={deleting[id]}
                    title="Eliminar"
                    style={{ color: 'var(--red)' }}
                  >
                    {deleting[id] ? '⏳' : '🗑️'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
