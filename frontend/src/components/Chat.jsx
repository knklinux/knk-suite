import React, { useState, useRef, useEffect } from 'react';

export default function Chat({ api }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const msg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: msg }]);
    setLoading(true);
    try {
      const r = await api('/llm/chat', { method: 'POST', body: JSON.stringify({ prompt: msg }) });
      setMessages(prev => [...prev, { role: 'assistant', text: r.text || 'Sin respuesta' }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', text: '❌ Error de conexión' }]);
    }
    setLoading(false);
  };

  const quickPrompts = [
    '¿Qué headers de seguridad faltan?',
    '¿Cómo explotar un CORS mal configurado?',
    '¿Cómo hacer bypass de CSP?',
    'Genera un payload XSS para este contexto:',
    'Analiza este curl y dime si es vulnerable:',
  ];

  return (
    <div>
      <h2>💬 Chat LLM</h2>
      <div className="card">
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
          {quickPrompts.map(p => (
            <button key={p} className="btn btn-sm btn-outline" style={{ fontSize: 10 }} onClick={() => setInput(p)}>
              {p.slice(0, 30)}...
            </button>
          ))}
        </div>
        <div style={{ maxHeight: 400, overflow: 'auto', marginBottom: 12, padding: 8, background: 'var(--bg)', borderRadius: 6 }}>
          {messages.length === 0 && <span className="muted">Pregunta al LLM sobre seguridad, explotación, remediarion...</span>}
          {messages.map((m, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <span style={{ color: m.role === 'user' ? 'var(--muted)' : 'var(--primary)', fontSize: 11 }}>
                {m.role === 'user' ? '👤 Tú' : '🤖 LLM'}&gt;
              </span>
              <span style={{ fontSize: 12, marginLeft: 8 }}>{m.text}</span>
            </div>
          ))}
          {loading && <div style={{ color: 'var(--yellow)', fontSize: 12 }}>🤖 Pensando...</div>}
          <div ref={endRef} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <textarea
            placeholder="Escribe tu pregunta..."
            rows={2}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            style={{ flex: 1, resize: 'vertical' }}
          />
          <button className="btn" onClick={send} disabled={loading}>Enviar</button>
        </div>
      </div>
    </div>
  );
}