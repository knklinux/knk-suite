import React, { useState, useEffect } from 'react';

export default function Vault({ api }) {
  const [stats, setStats] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);

  const loadStats = () => api('/vault/stats').then(setStats).catch(() => {});
  useEffect(() => { loadStats(); }, []); // loadStats devuelve Promise: NO como cleanup directo

  const search = async (e) => {
    e?.preventDefault();
    if (!query.trim()) return;
    const r = await api(`/vault/search?q=${encodeURIComponent(query)}`).catch(() => null);
    setResults(r?.results || []);
    setSearched(true);
  };

  return (
    <div>
      <h2>📚 Bóveda — el cerebro local</h2>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          Todo el conocimiento del asistente vive en <code>vault-knklinux/</code> (formato Obsidian).
          El asistente busca aquí antes de responder y cita las notas usadas.
          Añade notas a la bóveda y el índice se actualiza solo.
        </p>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
          <span>📝 Notas: <b>{stats?.notes ?? '…'}</b></span>
          <span>🧩 Fragmentos indexados: <b>{stats?.chunks ?? '…'}</b></span>
          <button className="btn btn-sm btn-outline" onClick={async () => { await api('/vault/rebuild', { method: 'POST', body: '{}' }); loadStats(); }}>
            ↻ Reindexar
          </button>
        </div>
        <form onSubmit={search} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            placeholder="Buscar en el cerebro… (p. ej. límites, owasp, fases)"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="btn" onClick={search}>Buscar</button>
        </form>
        {searched && results.length === 0 && <p className="muted">Sin resultados. Prueba con otras palabras o añade una nota a la bóveda.</p>}
        {results.map((r, i) => (
          <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 8, background: 'var(--bg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 13 }}>{r.title}</b>
              <span className="muted" style={{ fontSize: 10.5 }}>{r.file} · relevancia {r.score}</span>
            </div>
            {r.tags?.length > 0 && (
              <div style={{ margin: '4px 0' }}>
                {r.tags.map(t => <span key={t} style={{ fontSize: 10, color: 'var(--primary)', marginRight: 8 }}>#{t}</span>)}
              </div>
            )}
            <div className="muted" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{r.excerpt.slice(0, 280)}{r.excerpt.length > 280 ? '…' : ''}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
