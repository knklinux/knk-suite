import React, { useState, useEffect, useRef } from 'react';

export default function TeamPanel({ api }) {
  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [members, setMembers] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [findings, setFindings] = useState([]);
  const [connecting, setConnecting] = useState(false);
  const [toast, setToast] = useState('');
  const chatEndRef = useRef(null);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory]);

  const loadMembers = async () => {
    try {
      const r = await api('/team/members');
      if (r?.members) setMembers(r.members);
    } catch (e) {}
  };

  const loadHistory = async () => {
    try {
      const r = await api('/team/history');
      if (r?.messages) setChatHistory(r.messages);
      if (r?.findings) setFindings(r.findings);
    } catch (e) {}
  };

  const joinTeam = async () => {
    if (!name.trim()) return;
    setConnecting(true);
    try {
      const r = await api('/team/join', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      });
      if (r?.ok) {
        setJoined(true);
        setToast('Unido al equipo');
        loadMembers();
        loadHistory();
      } else {
        setToast(r?.error || 'Error al unirse');
      }
    } catch (e) {
      setToast('Error: ' + e.message);
    } finally {
      setConnecting(false);
    }
  };

  const sendMessage = async () => {
    if (!chatInput.trim()) return;
    const msg = chatInput.trim();
    setChatInput('');
    try {
      const r = await api('/team/send', {
        method: 'POST',
        body: JSON.stringify({ message: msg }),
      });
      if (r?.ok) {
        setChatHistory(prev => [...prev, { sender: name, message: msg, timestamp: Date.now() }]);
      }
    } catch (e) {
      setToast('Error al enviar: ' + e.message);
    }
  };

  const leaveTeam = async () => {
    try {
      await api('/team/leave', { method: 'POST' });
      setJoined(false);
      setMembers([]);
      setChatHistory([]);
      setFindings([]);
      setToast('Saliste del equipo');
    } catch (e) {
      setToast('Error: ' + e.message);
    }
  };

  return (
    <div>
      <div className="module-heading">
        <div>
          <span className="eyebrow">COLABORACION</span>
          <h2>Team</h2>
        </div>
        <span className={`badge ${joined ? 'badge-ok' : 'badge-warn'}`}>
          {joined ? 'CONECTADO' : 'DESCONECTADO'}
        </span>
      </div>

      {!joined ? (
        <div className="card">
          <h3>Unirse al equipo</h3>
          <div className="inline-form">
            <input
              placeholder="Tu nombre"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && joinTeam()}
            />
            <button className="btn btn-sm" onClick={joinTeam} disabled={connecting || !name.trim()}>
              {connecting ? 'Uniendo...' : 'Unirse'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="card">
            <h3>Miembros en línea</h3>
            {members.length === 0 && <span className="muted">No hay miembros conectados</span>}
            {members.map((m, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid #16314b' }}>
                <div className="st-dot on" />
                <span style={{ color: '#fff', fontSize: 11 }}>{m.name || m}</span>
                {m.role && <span className="badge badge-ok" style={{ marginLeft: 'auto' }}>{m.role}</span>}
              </div>
            ))}
          </div>

          <div className="card">
            <h3>Chat</h3>
            <div className="chat-log" style={{ minHeight: 200 }}>
              {chatHistory.length === 0 && (
                <span className="muted" style={{ display: 'block', textAlign: 'center', padding: 20 }}>
                  Sin mensajes aún
                </span>
              )}
              {chatHistory.map((msg, i) => (
                <div key={i} className={`chat-message ${msg.sender === name ? 'user' : ''}`}>
                  <strong>{msg.sender}</strong>
                  {msg.message}
                  <small>{msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : ''}</small>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="chat-composer" style={{ marginTop: 10 }}>
              <textarea
                placeholder="Escribe un mensaje..."
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                rows={2}
              />
              <button className="btn btn-sm" onClick={sendMessage} disabled={!chatInput.trim()}>
                Enviar
              </button>
            </div>
          </div>

          {findings.length > 0 && (
            <div className="card">
              <h3>Hallazgos compartidos</h3>
              {findings.map((f, i) => (
                <div className="finding" key={i}>
                  <span className="f-type">[{f.type}]</span>
                  <span className="f-sum">{f.summary}</span>
                  <span className="f-sev"><span className="badge badge-ok">{f.severity}</span></span>
                </div>
              ))}
            </div>
          )}

          <button className="btn btn-sm btn-outline" onClick={leaveTeam}>
            Salir del equipo
          </button>
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
