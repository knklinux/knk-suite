import React, { useEffect, useRef, useState } from 'react';
import { loadConversation, saveConversation, clearConversation, onConversationChange } from './assistant-state';
import HoloAvatar from './HoloAvatar';

const MODES = [
  { id: 'auto', label: 'AUTO' },
  { id: 'chat', label: 'CHAT' },
  { id: 'code', label: 'CÓDIGO' },
  { id: 'debate', label: 'DEBATE' },
  { id: 'plan', label: 'PLAN' },
  { id: 'pentest', label: 'PENTEST' },
  { id: 'study', label: 'ESTUDIO' },
  { id: 'osint', label: 'OSINT' },
];

export default function Assistant({ api, floating = false }) {
  const [mode, setMode] = useState('auto');
  const [input, setInput] = useState('');
  const [msgs, setMsgs] = useState(loadConversation);
  const [busy, setBusy] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceId, setVoiceId] = useState('salome');
  const [voices, setVoices] = useState(null);
  const [engine, setEngine] = useState('');
  const [listening, setListening] = useState(false);
  const [useMemory, setUseMemory] = useState(true);
  const [useBrain, setUseBrain] = useState(true);
  const [state, setState] = useState('IDLE');
  const recRef = useRef(null);
  const mediaRef = useRef(null);
  const audioRef = useRef(null);
  const endRef = useRef(null);

  useEffect(() => { saveConversation(msgs); }, [msgs]);
  useEffect(() => onConversationChange(setMsgs), []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);
  useEffect(() => {
    api('/voice/voices').then((r) => { if (r?.ok) { setVoices(r.voices); setVoiceId(r.default || 'salome'); } }).catch(() => {});
    api('/assistant/status').then((r) => { if (r?.model) setEngine(r.model); }).catch(() => {});
  }, [api]);
  useEffect(() => {
    if (!floating || !window.electronAPI?.onAssistantHotkey) return undefined;
    return window.electronAPI.onAssistantHotkey(() => listen());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floating]);

  const speak = async (text) => {
    if (!voiceOn || !text) return;
    try { audioRef.current?.pause(); } catch {}
    setState('SPEAKING');
    try {
      // TTS del backend (Salomé/Ramona); fallback al sintetizador local.
      const r = await fetch(`/api/voice/speak?voice=${encodeURIComponent(voiceId)}&text=${encodeURIComponent(text.slice(0, 900))}`, { credentials: 'same-origin' });
      if (r.ok && (r.headers.get('content-type') || '').includes('audio')) {
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => { setState('IDLE'); URL.revokeObjectURL(url); };
        audio.onerror = () => { setState('IDLE'); localSpeak(text); };
        await audio.play();
        return;
      }
      throw new Error('sin audio');
    } catch {
      localSpeak(text);
    }
  };

  const localSpeak = (text) => {
    if (!window.speechSynthesis) { setState('IDLE'); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.slice(0, 900));
    u.lang = 'es-ES';
    u.onend = () => setState('IDLE');
    window.speechSynthesis.speak(u);
  };

  const stopVoice = () => {
    try { audioRef.current?.pause(); } catch {}
    try { window.speechSynthesis?.cancel(); } catch {}
    if (!busy && !listening) setState('IDLE');
  };

  const listen = async () => {
    if (recRef.current || mediaRef.current) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.lang = 'es-ES'; rec.interimResults = false; rec.continuous = false;
      rec.onstart = () => { setListening(true); setState('LISTENING'); };
      rec.onend = () => { setListening(false); recRef.current = null; if (!busy) setState('IDLE'); };
      rec.onerror = () => { listenWhisper(); };
      rec.onresult = (event) => send(Array.from(event.results).map((result) => result[0].transcript).join(''));
      recRef.current = rec;
      try { rec.start(); return; } catch { recRef.current = null; }
    }
    listenWhisper();
  };

  const listenWhisper = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = window.MediaRecorder?.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        mediaRef.current = null;
        setListening(false);
        if (!chunks.length) { if (!busy) setState('IDLE'); return; }
        const buf = await new Blob(chunks).arrayBuffer();
        let b64 = '';
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 8192) b64 += String.fromCharCode(...bytes.slice(i, i + 8192));
        setState('THINKING');
        try {
          const r = await api('/voice/transcribe', { method: 'POST', body: JSON.stringify({ audio: btoa(b64), ext: 'webm' }) });
          if (r?.ok && r.text) send(r.text);
          else { setState('IDLE'); }
        } catch { setState('IDLE'); }
      };
      mediaRef.current = mr;
      setListening(true); setState('LISTENING');
      mr.start();
      setTimeout(() => { try { mr.state !== 'inactive' && mr.stop(); } catch {} }, 15000);
    } catch {
      setListening(false);
      if (!busy) setState('IDLE');
    }
  };

  const send = async (value = input) => {
    const prompt = value.trim();
    if (!prompt || busy) return;
    const history = msgs.slice(-8).map(({ role, text }) => ({ role, text }));
    setInput(''); setBusy(true); setState('THINKING');
    setMsgs((prev) => [...prev, { role: 'user', text: prompt, at: Date.now() }]);
    try {
      const r = await api('/assistant/talk', { method: 'POST', body: JSON.stringify({ prompt, mode: mode === 'auto' ? undefined : mode, useVault: useBrain, useMemory, history }) });
      const text = r.text || (r.offline ? '⚠️ Ollama no responde.' : '(sin respuesta)');
      setMsgs((prev) => [...prev, { role: 'assistant', text, model: r.model, sources: r.sources || [], at: Date.now() }]);
      speak(text);
      if (!voiceOn) setState('IDLE');
    } catch { setMsgs((prev) => [...prev, { role: 'system', text: '⚠️ Error contactando al asistente', at: Date.now() }]); setState('IDLE'); }
    finally { setBusy(false); }
  };

  const reset = () => { clearConversation(); setMsgs([]); };

  return <section className={`assistant-wrap ${floating ? 'floating' : ''}`}>
    <div className="avatar-shell"><HoloAvatar state={state} size={56} /><div className="avatar-meta"><strong>ELECTRA · KNK ASSISTANT</strong><small>{engine ? `${engine} local` : 'Ollama local'} · {state}</small></div>{floating && <button className="floating-close" onClick={() => window.electronAPI?.assistantWindowControls?.close()}>×</button>}</div>
    <div className="assistant-toolbar">{MODES.map((item) => <button className={`btn btn-sm ${mode === item.id ? '' : 'btn-outline'}`} onClick={() => setMode(item.id)} key={item.id}>{item.label}</button>)}<button className="btn btn-sm btn-outline" onClick={reset}>limpiar</button><span className="muted">{busy ? 'razonando…' : 'listo'}</span></div>
    <div className="assistant-log">{msgs.length === 0 && <p className="muted">Puedo explicar, razonar sobre evidencias, preparar comandos y ayudarte a estudiar. No fingiré ejecuciones.</p>}{msgs.map((message, index) => <div className={`assistant-msg ${message.role}`} key={`${message.at || index}-${index}`}><b>{message.role === 'user' ? 'TÚ' : message.role === 'assistant' ? 'KNK' : 'SISTEMA'}</b><div>{message.text}</div>{message.model && <small>{message.model}{message.sources?.length ? ` · ${message.sources.length} fuentes` : ''}</small>}</div>)}<div ref={endRef} /></div>
    <div className="assistant-input"><textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="¿Qué necesitas analizar?" /><button className={`btn btn-sm ${listening ? 'btn-green' : 'btn-outline'}`} onClick={listen}>🎙️</button><button className="btn" onClick={() => send()} disabled={busy}>Enviar</button></div>
    <footer className="assistant-foot"><label><input type="checkbox" checked={voiceOn} onChange={(e) => { setVoiceOn(e.target.checked); if (!e.target.checked) stopVoice(); }} /> voz</label>{voiceOn && voices && (<select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} style={{ fontSize: 10, padding: '2px 6px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4 }}>{Object.entries(voices).map(([id, v]) => <option key={id} value={id}>{v.label}</option>)}</select>)}<label><input type="checkbox" checked={useBrain} onChange={(e) => setUseBrain(e.target.checked)} /> cerebro</label><label><input type="checkbox" checked={useMemory} onChange={(e) => setUseMemory(e.target.checked)} /> memoria</label><span className="muted">La ventana flotante sigue disponible fuera de la terminal · Ctrl+Alt+K</span></footer>
  </section>;
}
