import React, { useCallback, useEffect, useState } from 'react';

// Card de proxy de salida (estilo Burp): el tráfico de recon/Repeater/Intruder
// pasa por el proxy configurado aquí sin tocar variables de entorno. El motor
// vive en lib/net.js (CONNECT tunnel para HTTPS); el backend expone
// /api/outproxy (GET/POST/DELETE + POST /test).

export default function Labs({ api }) {
  const [inventory, setInventory] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const result = await api('/labs/inventory').catch(() => null);
    if (result) setInventory(result);
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);

  // ── proxy de salida ──────────────────────────────────────────────────
  const [proxyState, setProxyState] = useState(null);
  const [proxyInput, setProxyInput] = useState('');
  const [proxyMsg, setProxyMsg] = useState(null); // {kind:'ok'|'err'|'info', text}
  const [proxyBusy, setProxyBusy] = useState(null); // 'save' | 'test' | 'clear'
  const [testResults, setTestResults] = useState(null);

  const refreshProxy = useCallback(async () => {
    const st = await api('/outproxy').catch(() => null);
    if (st) {
      setProxyState(st);
      setProxyInput(st.proxy || st.stored || '');
    }
  }, [api]);

  useEffect(() => { refreshProxy(); }, [refreshProxy]);

  const saveProxy = async () => {
    setProxyBusy('save');
    setProxyMsg(null); setTestResults(null);
    try {
      const r = await api('/outproxy', { method: 'POST', body: JSON.stringify({ proxy: proxyInput.trim() }) });
      if (r.ok) { setProxyMsg({ kind: 'ok', text: r.note || 'Proxy activo.' }); await refreshProxy(); }
      else setProxyMsg({ kind: 'err', text: r.error || 'No se pudo activar el proxy.' });
    } finally { setProxyBusy(null); }
  };

  const testProxy = async () => {
    setProxyBusy('test');
    setProxyMsg(null); setTestResults(null);
    try {
      const r = await api('/outproxy/test', { method: 'POST', body: JSON.stringify({ proxy: proxyInput.trim() }) });
      if (r.ok !== undefined && r.results) {
        setTestResults(r.results);
        setProxyMsg(r.ok
          ? { kind: 'ok', text: 'El proxy contesta. Tráfico listo para pasar por él.' }
          : { kind: 'err', text: 'El proxy no contesta a las sondas. ¿Está levantado y en ese puerto?' });
      } else setProxyMsg({ kind: 'err', text: r.error || 'Test fallido.' });
    } finally { setProxyBusy(null); }
  };

  const clearProxy = async () => {
    setProxyBusy('clear');
    setProxyMsg(null); setTestResults(null);
    try {
      const r = await api('/outproxy', { method: 'DELETE' });
      if (r.ok) { setProxyMsg({ kind: 'info', text: r.note || 'Salida directa restaurada.' }); await refreshProxy(); }
      else setProxyMsg({ kind: 'err', text: r.error || 'No se pudo quitar el proxy.' });
    } finally { setProxyBusy(null); }
  };

  const labsAction = async (verb, machine) => {
    setBusy(true);
    try {
      const result = await api(`/labs/${verb}`, { method: 'POST', body: JSON.stringify({ machine }) });
      setMessage(result.ok ? `${verb === 'start' ? 'Arranque solicitado' : 'Parada solicitada'}: ${machine}` : (result.error || 'La operación fue rechazada'));
      await refreshProxy();
    } finally { setBusy(false); }
  };

  const machines = inventory?.machines || [];
  const providers = inventory?.providers || [];
  const catalog = inventory?.catalog || [];
  const activeBadge = proxyState?.active
    ? <span className="badge badge-ok">activo · {proxyState.proxy}{proxyState.port ? `:${proxyState.port}` : ''}</span>
    : <span className="badge badge-warn">salida directa</span>;

  return <section>
    <div className="module-heading"><div><span className="eyebrow">LABORATORY // VIRTUAL MACHINES</span><h2>Laboratorios</h2><p className="muted">Inventario local de VMs y escenarios educativos; no crea máquinas ni abre red por sorpresa.</p></div><button className="btn btn-sm btn-outline" onClick={refresh} disabled={busy}>revalidar</button></div>
    {message && <div className="toast">{message}</div>}

    <div className="card">
      <h3>Proxy de salida (Burp-style)</h3>
      <p className="muted">El tráfico de recon, Repeater e Intruder pasa por el proxy que pongas aquí — intercepta con Burp/ZAP sin tocar variables de entorno. HTTPS por CONNECT; el UA, el rate limiter y el scope no cambian. No afecta al tráfico interno del workbench.</p>
      <div className="kv" style={{ marginBottom: 10 }}><span className="k">Estado</span><span className="v">{activeBadge}{proxyState?.source ? <small className="muted" style={{ marginLeft: 8 }}>{proxyState.source}</small> : null}</span></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          className="input" style={{ flex: '1 1 260px', fontFamily: 'var(--mono, monospace)' }}
          placeholder="http://127.0.0.1:8080"
          value={proxyInput}
          onChange={(e) => setProxyInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && proxyInput.trim()) saveProxy(); }}
          disabled={proxyBusy !== null || proxyState?.source?.startsWith('env')}
          title={proxyState?.source?.startsWith('env') ? 'KNK_PROXY fijado por entorno: reinicia sin la variable para editar' : undefined}
        />
        <button className="btn btn-sm" onClick={saveProxy} disabled={proxyBusy !== null || !proxyInput.trim() || proxyState?.source?.startsWith('env')}>{proxyBusy === 'save' ? '⏳' : 'Activar'}</button>
        <button className="btn btn-sm btn-outline" onClick={testProxy} disabled={proxyBusy !== null || !proxyInput.trim()}>{proxyBusy === 'test' ? '⏳' : 'Probar'}</button>
        <button className="btn btn-sm btn-outline" onClick={clearProxy} disabled={proxyBusy !== null || !proxyState?.active}>{proxyBusy === 'clear' ? '⏳' : 'Quitar'}</button>
      </div>
      {proxyMsg && <div className="toast" style={{ marginTop: 10, borderColor: proxyMsg.kind === 'ok' ? 'var(--ok, #35d07f)' : proxyMsg.kind === 'err' ? 'var(--danger, #ff5470)' : 'var(--primary, #35c4ff)' }}>{proxyMsg.text}</div>}
      {testResults && (
        <div className="kv" style={{ marginTop: 10 }}>
          <span className="k">Sonda HTTP</span><span className="v">{testResults.http?.ok ? `✅ ${testResults.http.detail}` : `❌ ${testResults.http?.error || 'sin respuesta'}`}</span>
          <span className="k">Sonda CONNECT (HTTPS)</span><span className="v">{testResults.https?.ok ? `✅ ${testResults.https.detail}` : `❌ ${testResults.https?.error || 'sin respuesta'}`}</span>
        </div>
      )}
      <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>Para que Burp valide el TLS de los MITM: exporta su CA (GET http://127.0.0.1:8080/cert) y arranca Node con NODE_EXTRA_CA_CERTS=burp-ca.pem. Con KNK_TLS_INSECURE=1 se desactiva la verificación solo en local.</p>
    </div>

    <div className="module-grid">
      {providers.map((provider) => <div className="card" key={provider.id}><h3>{provider.label}</h3><div className="kv"><span className="k">Proveedor</span><span className={`v badge ${provider.installed ? 'badge-ok' : 'badge-warn'}`}>{provider.installed ? 'detectado' : 'no disponible'}</span></div><p className="muted">{provider.detail || 'sin detalle'}</p></div>)}
    </div>
    <div className="card"><h3>Máquinas detectadas</h3>{machines.length === 0 && <p className="muted">No hay VMs detectadas o el proveedor no está instalado.</p>}{machines.map((machine) => <div className="lab-machine" key={`${machine.provider}-${machine.name}`}><div><strong>{machine.name}</strong><small>{machine.provider} · {machine.state || 'inventariada'}</small></div><div className="lab-actions"><button className="btn btn-sm" onClick={() => labsAction('start', machine.name)} disabled={busy}>arrancar</button><button className="btn btn-sm btn-outline" onClick={() => labsAction('stop', machine.name)} disabled={busy}>parar</button></div></div>)}</div>
    <div className="card"><h3>Catálogo de escenarios</h3><div className="module-grid">{catalog.map((lab) => <div className="lab-card" key={lab.id}><strong>{lab.name}</strong><small>{lab.provider} · {lab.status}</small><p className="muted">{lab.purpose}</p><span className="badge badge-warn">importación/configuración manual</span></div>)}</div><p className="muted" style={{ marginTop: 12 }}>La suite no descarga imágenes ni configura redes automáticamente. Importa los escenarios desde su fuente oficial y verifica aislamiento/NAT antes de usarlos.</p></div>
  </section>;
}
