import React, { useCallback, useEffect, useState } from 'react';

export default function Labs({ api }) {
  const [inventory, setInventory] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const result = await api('/labs/inventory').catch(() => null);
    if (result) setInventory(result);
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);

  const action = async (verb, machine) => {
    setBusy(true);
    try {
      const result = await api(`/labs/${verb}`, { method: 'POST', body: JSON.stringify({ machine }) });
      setMessage(result.ok ? `${verb === 'start' ? 'Arranque solicitado' : 'Parada solicitada'}: ${machine}` : (result.error || 'La operación fue rechazada'));
      await refresh();
    } finally { setBusy(false); }
  };

  const machines = inventory?.machines || [];
  const providers = inventory?.providers || [];
  const catalog = inventory?.catalog || [];
  return <section>
    <div className="module-heading"><div><span className="eyebrow">LABORATORY // VIRTUAL MACHINES</span><h2>Laboratorios</h2><p className="muted">Inventario local de VMs y escenarios educativos; no crea máquinas ni abre red por sorpresa.</p></div><button className="btn btn-sm btn-outline" onClick={refresh} disabled={busy}>revalidar</button></div>
    {message && <div className="toast">{message}</div>}
    <div className="module-grid">
      {providers.map((provider) => <div className="card" key={provider.id}><h3>{provider.label}</h3><div className="kv"><span className="k">Proveedor</span><span className={`v badge ${provider.installed ? 'badge-ok' : 'badge-warn'}`}>{provider.installed ? 'detectado' : 'no disponible'}</span></div><p className="muted">{provider.detail || 'sin detalle'}</p></div>)}
    </div>
    <div className="card"><h3>Máquinas detectadas</h3>{machines.length === 0 && <p className="muted">No hay VMs detectadas o el proveedor no está instalado.</p>}{machines.map((machine) => <div className="lab-machine" key={`${machine.provider}-${machine.name}`}><div><strong>{machine.name}</strong><small>{machine.provider} · {machine.state || 'inventariada'}</small></div><div className="lab-actions"><button className="btn btn-sm" onClick={() => action('start', machine.name)} disabled={busy}>arrancar</button><button className="btn btn-sm btn-outline" onClick={() => action('stop', machine.name)} disabled={busy}>parar</button></div></div>)}</div>
    <div className="card"><h3>Catálogo de escenarios</h3><div className="module-grid">{catalog.map((lab) => <div className="lab-card" key={lab.id}><strong>{lab.name}</strong><small>{lab.provider} · {lab.status}</small><p className="muted">{lab.purpose}</p><span className="badge badge-warn">importación/configuración manual</span></div>)}</div><p className="muted" style={{ marginTop: 12 }}>La suite no descarga imágenes ni configura redes automáticamente. Importa los escenarios desde su fuente oficial y verifica aislamiento/NAT antes de usarlos.</p></div>
  </section>;
}
