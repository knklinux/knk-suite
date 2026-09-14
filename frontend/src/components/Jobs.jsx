import React, { useState, useEffect, useRef, useCallback } from 'react';

// ============================================================================
// Jobs.jsx — Motor de trabajos: lanzar, seguir y cancelar (async real)
// Incluye asistente paso a paso cuando un job se bloquea por escalada de
// privilegios: copiar el one-liner, escribirlo en la Terminal Kali y relanzar.
// ============================================================================

const QUICK = [
  { id: 'recon-cloudflare', label: '☁️ Recon Cloudflare' },
  { id: 'e16-cloudflare', label: '🎯 E16 Playground' },
  { id: 'v6-openai', label: '🤖 V6 OpenAI' },
];

// Instalador del toolkit con selección de paquetes por categorías (checkboxes).
// El catálogo viene del backend (/api/kali/tool-catalog): lista blanca estricta.
function InstallToolsSelection({ api, onLaunched }) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState(null); // [{cat, pkg, bin}]
  const [sel, setSel] = useState(new Set());
  const [busy, setBusy] = useState(false);

  const toggle = () => {
    setOpen(o => {
      const next = !o;
      if (next && !catalog) {
        api('/kali/tool-catalog').then(r => setCatalog(r?.catalog || [])).catch(() => setCatalog([]));
      }
      return next;
    });
  };

  const flip = (pkg) => setSel(prev => {
    const n = new Set(prev);
    n.has(pkg) ? n.delete(pkg) : n.add(pkg);
    return n;
  });

  const byCat = (cat) => (catalog || []).filter(p => p.cat === cat);
  const catLabel = { recon: 'Recon', cracking: 'Cracking', web: 'Web', osint: 'OSINT' };

  const launch = async () => {
    setBusy(true);
    try {
      const body = JSON.stringify({ packages: [...sel] }); // vacía = set de lab clásico
      const r = await api('/kali/install-tools', { method: 'POST', body });
      if (r?.job) { onLaunched(r.job); setOpen(false); }
    } finally { setBusy(false); }
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button className="btn btn-sm" style={{ borderColor: 'var(--green)', color: 'var(--green)' }}
        onClick={toggle} disabled={busy}
        title="apt install del toolkit de lab dentro de Kali — elige paquetes por categoría">
        {busy ? 'lanzando…' : sel.size ? `🧰 Instalar ${sel.size} tools en Kali` : '🧰 Instalar tools en Kali'}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50, minWidth: 300,
          background: 'var(--panel)', border: '1px solid var(--primary)', borderRadius: 10, padding: 12,
          boxShadow: '0 8px 30px rgba(0,0,0,.6)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
            🧰 Paquetes del lab <span className="muted" style={{ fontWeight: 400 }}>({sel.size} seleccionados)</span>
          </div>
          {!catalog && <div className="muted" style={{ fontSize: 12 }}>cargando catálogo…</div>}
          {catalog && ['recon', 'cracking', 'web', 'osint'].map(cat => (
            <div key={cat} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--teal)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                {catLabel[cat] || cat}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {byCat(cat).map(p => (
                  <label key={p.pkg} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, cursor: 'pointer',
                    border: `1px solid ${sel.has(p.pkg) ? 'var(--green)' : 'var(--border)'}`, borderRadius: 6,
                    padding: '3px 7px', background: sel.has(p.pkg) ? 'rgba(63,185,80,.12)' : 'var(--bg)' }}>
                    <input type="checkbox" checked={sel.has(p.pkg)} onChange={() => flip(p.pkg)} style={{ accentColor: 'var(--green)' }} />
                    {p.pkg}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center' }}>
            <button className="btn btn-sm" style={{ borderColor: 'var(--green)', color: 'var(--green)' }} onClick={launch}>
              ▸ Instalar selección{sel.size ? ` (${sel.size})` : ' (set clásico)'}
            </button>
            <button className="btn btn-sm btn-outline" onClick={() => setSel(new Set((catalog || []).map(p => p.pkg)))}>todos</button>
            <button className="btn btn-sm btn-outline" onClick={() => setSel(new Set())}>ninguno</button>
            <span className="muted" style={{ fontSize: 10.5 }}>sin selección = set de lab clásico</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// UnlockWizard — asistente paso a paso para el bloqueo de escalada.
// Aparece solo cuando el job seleccionado trae `unlock` (metadatos del job).
// Paso 1: copiar el one-liner · Paso 2: pegarlo en la Terminal Kali (botón que
// lo escribe en la PTY real vía onSendToTerminal) · Paso 3: verificar y relanzar.
// ============================================================================
function UnlockWizard({ unlock, api, onRelaunched, sendToTerminal }) {
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);
  const [verified, setVerified] = useState(null); // null | 'ok' | 'falta'
  const [verifying, setVerifying] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(unlock.oneLiner);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // fallback sin permiso de clipboard: selección manual
      const ta = document.createElement('textarea');
      ta.value = unlock.oneLiner;
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch {}
      document.body.removeChild(ta);
    }
  };

  const sendToKali = () => {
    if (!sendToTerminal) return;
    sendToTerminal({ cmd: unlock.oneLiner, ts: Date.now() });
    setSent(true);
  };

  const verify = async () => {
    setVerifying(true);
    try {
      const r = await api('/kali/exec', { method: 'POST', body: JSON.stringify({ command: `${unlock.verifyCmd} && echo VERIFY_OK || echo VERIFY_KO` }) });
      setVerified((r?.stdout || '').includes('VERIFY_OK') ? 'ok' : 'falta');
    } catch { setVerified('falta'); }
    finally { setVerifying(false); }
  };

  const relaunch = async () => {
    const body = JSON.stringify({ packages: unlock.packages || [] }); // conserva la selección original
    const r = await api('/kali/install-tools', { method: 'POST', body }).catch(() => null);
    if (r?.job) onRelaunched(r.job);
  };

  const step = (n, label, body, done) => (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '7px 0', borderBottom: '1px dashed var(--border)' }}>
      <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center',
        fontSize: 11, fontWeight: 700, background: done ? 'var(--green)' : 'var(--primary)', color: '#04121d' }}>{n}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, marginBottom: 6 }}>{label} {done && <span style={{ color: 'var(--green)' }}>✓</span>}</div>
        {body}
      </div>
    </div>
  );

  return (
    <div style={{ border: '1px solid rgba(227,179,65,.5)', background: 'rgba(227,179,65,.07)', borderRadius: 10, padding: '10px 14px', margin: '10px 0 14px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--yellow)', marginBottom: 2 }}>
        🔓 Asistente de desbloqueo — escalada de privilegios
      </div>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>
        El job necesita instalar paquetes y el box pide contraseña en modo no interactivo. Tres pasos, una sola vez:
      </div>

      {step(1, 'Copia el one-liner de desbloqueo', (
        <div>
          <code style={{ display: 'block', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', fontSize: 11.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {unlock.oneLiner}
          </code>
          <button className="btn btn-sm" style={{ marginTop: 7 }} onClick={copy}>
            {copied ? '✓ copiado al portapapeles' : '📋 Copiar al portapapeles'}
          </button>
        </div>
      ), copied)}

      {step(2, `Pégalo en: ${unlock.pasteWhere} — pedirá ${unlock.needs}`, (
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-sm btn-outline" onClick={sendToKali} disabled={!sendToTerminal}
            title={sendToTerminal ? 'Escribe el comando en la PTY de Kali (no lo ejecuta: revisa y pulsa Enter)' : 'Ve a la Terminal Kali primero (pestaña 🖥️)'}>
            ⌨️ Escribir en la Terminal Kali
          </button>
          <span className="muted" style={{ fontSize: 11 }}>
            {sendToTerminal ? 'queda escrito y SIN ejecutar: revisa y pulsa ↵ (ahí tecleas la contraseña)' : 'abre la pestaña Terminal y vuelve'}
          </span>
        </div>
      ), sent)}

      {step(3, 'Verifica el desbloqueo y relanza el job', (
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-sm btn-outline" onClick={verify} disabled={verifying}>
            {verifying ? 'verificando…' : '🔍 Comprobar'}
          </button>
          {verified === 'ok' && <span style={{ fontSize: 11.5, color: 'var(--green)' }}>✓ escalada sin contraseña OK</span>}
          {verified === 'falta' && <span style={{ fontSize: 11.5, color: 'var(--red)' }}>✗ aún pide contraseña — completa el paso 2</span>}
          <button className="btn btn-sm" style={{ borderColor: 'var(--green)', color: 'var(--green)' }} onClick={relaunch}>
            🧰 Relanzar instalación
          </button>
        </div>
      ), verified === 'ok')}
    </div>
  );
}

export default function Jobs({ api, sendToTerminal }) {
  const [jobs, setJobs] = useState([]);
  const [selected, setSelected] = useState(null);
  const [custom, setCustom] = useState('');
  const timerRef = useRef(null);

  const refresh = useCallback(async () => {
    const r = await api('/jobs').catch(() => null);
    if (r?.jobs) {
      setJobs(r.jobs);
      setSelected(sel => (sel ? r.jobs.find(j => j.id === sel.id) || sel : sel));
    }
  }, []);

  useEffect(() => {
    refresh();
    timerRef.current = setInterval(refresh, 2000);
    return () => clearInterval(timerRef.current);
  }, []);

  const launch = async (action) => {
    const r = await api('/jobs/run', { method: 'POST', body: JSON.stringify({ action }) }).catch(() => null);
    if (r?.job) { setSelected(r.job); refresh(); }
  };

  const launchCustom = async () => {
    if (!custom.trim()) return;
    const r = await api('/jobs/run', { method: 'POST', body: JSON.stringify({ command: custom.trim() }) }).catch(() => null);
    if (r?.job) { setSelected(r.job); setCustom(''); refresh(); }
  };

  const cancel = async (id) => { await api(`/jobs/${id}/cancel`, { method: 'POST', body: '{}' }); refresh(); };

  const color = (s) => s === 'done' ? 'var(--green)' : s === 'running' ? 'var(--blue)' : s === 'error' ? 'var(--red)' : s === 'canceled' ? 'var(--yellow)' : 'var(--muted)';

  return (
    <div>
      <h2>🚀 Motor de trabajos</h2>
      <div className="card">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {QUICK.map(q => <button key={q.id} className="btn btn-sm btn-outline" onClick={() => launch(q.id)}>{q.label}</button>)}
          <InstallToolsSelection api={api} onLaunched={(job) => { setSelected(job); refresh(); }} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input placeholder="Comando libre (se ejecuta async con cancelación)…" value={custom}
            onChange={e => setCustom(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && launchCustom()} style={{ flex: 1 }} />
          <button className="btn" onClick={launchCustom}>Lanzar</button>
        </div>

        <div style={{ maxHeight: 260, overflow: 'auto', marginBottom: 12 }}>
          {jobs.length === 0 && <span className="muted" style={{ fontSize: 12 }}>Sin trabajos aún.</span>}
          {jobs.map(j => (
            <div key={j.id} onClick={() => setSelected(j)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 8, marginBottom: 6, cursor: 'pointer',
                border: `1px solid ${selected?.id === j.id ? 'var(--primary)' : 'var(--border)'}`, background: 'var(--bg)' }}>
              <span style={{ color: color(j.status), fontSize: 11, minWidth: 70 }}>● {j.status}</span>
              <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.name}</span>
              {j.unlock && <span title="bloqueado — hay asistente de desbloqueo" style={{ fontSize: 11 }}>🔓</span>}
              {j.progress != null && (j.status === 'running' || j.status === 'queued') && (
                <span style={{ fontSize: 11, color: 'var(--blue)', minWidth: 38, textAlign: 'right' }}>{j.progress}%</span>
              )}
              {(j.status === 'running' || j.status === 'queued') && (
                <button className="btn btn-sm btn-outline" onClick={(e) => { e.stopPropagation(); cancel(j.id); }}>cancelar</button>
              )}
            </div>
          ))}
        </div>

        {selected?.unlock && (
          <UnlockWizard
            unlock={selected.unlock}
            api={api}
            sendToTerminal={sendToTerminal}
            onRelaunched={(job) => { setSelected(job); refresh(); }}
          />
        )}

        {selected && (
          <div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
              salida — {selected.id} {selected.exitCode != null ? `(exit ${selected.exitCode})` : ''}
            </div>
            <pre style={{ maxHeight: 260, overflow: 'auto', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontSize: 11.5, margin: 0, whiteSpace: 'pre-wrap' }}>
              {selected.output?.join('\n') || '(sin salida todavía)'}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
