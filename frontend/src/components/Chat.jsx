import React, { useEffect, useRef, useState } from 'react';
import { loadConversation, saveConversation, clearConversation, onConversationChange } from './assistant-state';

export default function Chat({ api }) {
  const [messages, setMessages] = useState(loadConversation);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [voice, setVoice] = useState(false);
  const [listening, setListening] = useState(false);
  const [useVault, setUseVault] = useState(true);
  const endRef = useRef(null);
  const recRef = useRef(null);

  useEffect(() => { saveConversation(messages); }, [messages]);
  useEffect(() => onConversationChange(setMessages), []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const speak = (text) => {
    if (!voice || !window.speechSynthesis || !text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 1600));
    utterance.lang = 'es-ES';
    window.speechSynthesis.speak(utterance);
  };

  const send = async (value = input) => {
    const prompt = value.trim();
    if (!prompt || loading) return;
    const history = messages.slice(-8).map(({ role, text }) => ({ role, text }));
    const userMessage = { role: 'user', text: prompt, at: Date.now() };
    setInput('');
    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);
    try {
      const r = await api('/assistant/talk', { method: 'POST', body: JSON.stringify({ prompt, useVault, useMemory: true, history }) });
      const text = r.text || (r.offline ? '⚠️ Ollama no responde.' : 'Sin respuesta');
      setMessages((prev) => [...prev, { role: 'assistant', text, model: r.model, sources: r.sources || [], at: Date.now() }]);
      speak(text);
    } catch {
      setMessages((prev) => [...prev, { role: 'system', text: '❌ Error de conexión con el asistente', at: Date.now() }]);
    } finally { setLoading(false); }
  };

  const listen = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMessages((prev) => [...prev, { role: 'system', text: '⚠️ Reconocimiento de voz no disponible; usa texto.', at: Date.now() }]);
      return;
    }
    if (recRef.current) { recRef.current.stop(); return; }
    const rec = new SpeechRecognition();
    rec.lang = 'es-ES'; rec.interimResults = false; rec.continuous = false;
    rec.onstart = () => setListening(true);
    rec.onend = () => { setListening(false); recRef.current = null; };
    rec.onerror = () => { setListening(false); recRef.current = null; };
    rec.onresult = (event) => {
      const text = Array.from(event.results).map((result) => result[0].transcript).join('');
      setInput(text);
      send(text);
    };
    recRef.current = rec;
    rec.start();
  };

  const reset = () => { clearConversation(); setMessages([]); };

  return <section className="chat-unified card">
    <div className="module-heading"><div><span className="eyebrow">KNK ASSISTANT // CONVERSATION</span><h2>Chat unificado</h2></div><div className="chat-controls"><label><input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> voz</label><label><input type="checkbox" checked={useVault} onChange={(e) => setUseVault(e.target.checked)} /> bóveda</label><button className="btn btn-sm btn-outline" onClick={reset}>limpiar</button></div></div>
    <p className="muted">Comparte memoria de conversación con KNK Assistant y continúa al cambiar de módulo o abrir la ventana flotante.</p>
    <div className="chat-log">{messages.length === 0 && <p className="muted">Pregunta, analiza una evidencia o prepara un plan.</p>}{messages.map((message, index) => <div className={`chat-message ${message.role}`} key={`${message.at || index}-${index}`}><strong>{message.role === 'user' ? 'TÚ' : message.role === 'assistant' ? 'KNK' : 'SISTEMA'}</strong><div>{message.text}</div>{message.model && <small>{message.model}{message.sources?.length ? ` · ${message.sources.length} fuentes` : ''}</small>}</div>)}{loading && <div className="chat-message assistant"><strong>KNK</strong><div>pensando…</div></div>}<div ref={endRef} /></div>
    <div className="chat-composer"><textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Pregunta, analiza una evidencia o prepara un plan…" /><button className={`btn btn-sm ${listening ? 'btn-green' : 'btn-outline'}`} onClick={listen}>{listening ? 'escuchando…' : '🎙️'}</button><button className="btn" onClick={() => send()} disabled={loading}>{loading ? 'pensando…' : 'Enviar'}</button></div>
  </section>;
}
