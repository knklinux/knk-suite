import React, { useState } from 'react';

const INITIAL = {
  resourceType: 'file',
  asset: '',
  ownAccountsAB: false,
  syntheticResource: false,
  noPII: false,
  baselineB: false,
  revocationPerformed: false,
  revocationConfirmed: false,
  postRevokeCheck: false,
  singleResource: false,
  noThirdParty: false,
  rateLimitRespected: false,
  reproducibleCount: 0,
  evidenceComplete: false,
  postRevokeRead: false,
  postRevokeReadStatus: 0,
  privateContentReturned: false,
  postRevokeWrite: false,
  postRevokeWriteStatus: 0,
};

const FIELDS = [
  ['ownAccountsAB', 'Cuentas A/B propias o de test autorizadas'],
  ['syntheticResource', 'Recurso sintético creado para esta prueba'],
  ['noPII', 'Sin PII, secretos ni datos de terceros'],
  ['baselineB', 'B accedió legítimamente antes de revocar'],
  ['revocationPerformed', 'A ejecutó la revocación normal'],
  ['revocationConfirmed', 'La interfaz/servidor confirmó la revocación'],
  ['postRevokeCheck', 'Se repitió la lectura después de revocar'],
  ['singleResource', 'Solo se comprobó el recurso propio, sin enumeración'],
  ['noThirdParty', 'No intervino ningún tercero'],
  ['rateLimitRespected', 'Rate limit de la sesión respetado'],
  ['evidenceComplete', 'Evidencia antes/después completa y redactada'],
];

export default function Revocation({ api }) {
  const [form, setForm] = useState(INITIAL);
  const [plan, setPlan] = useState(null);
  const [verdict, setVerdict] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const prepare = async () => {
    setBusy(true); setVerdict(null);
    const r = await api('/revocation/plan', {
      method: 'POST', body: JSON.stringify({ resourceType: form.resourceType }),
    });
    setBusy(false);
    setPlan(r.ok ? r : { error: r.error || 'No se pudo preparar el flujo' });
  };

  const analyze = async () => {
    setBusy(true);
    const r = await api('/revocation/analyze', { method: 'POST', body: JSON.stringify(form) });
    setBusy(false);
    setVerdict(r.ok ? r.verdict : { summary: r.error || 'No se pudo analizar', results: [] });
  };

  return (
    <div>
      <h2>🔁 Revocación de archivos/conversaciones</h2>
      <div className="card" style={{ borderColor: 'var(--primary)' }}>
        <p style={{ fontSize: 12 }}>
          Flujo OpenAI/Bugcrowd para verificar si B conserva acceso después de que A revoque un recurso.
          No genera tráfico: prepara el protocolo y analiza evidencia ya capturada.
        </p>
        <select value={form.resourceType} onChange={(e) => set('resourceType', e.target.value)}>
          <option value="file">Archivo</option>
          <option value="conversation">Conversación</option>
        </select>
        <input placeholder="Asset exacto del Brief (ej. chat.openai.com)" value={form.asset} onChange={(e) => set('asset', e.target.value)} />
        <button className="btn btn-sm" onClick={prepare} disabled={busy}>📋 Preparar protocolo</button>
      </div>

      {plan?.error && <div className="card" style={{ borderColor: 'var(--red)' }}>⛔ {plan.error}</div>}
      {plan?.ok && (
        <div className="card">
          <h3>Protocolo preparado — sin peticiones externas</h3>
          <p className="muted">Rate limit configurado: {plan.prerequisites.rateLimitMs} ms · OPPLAN: {plan.prerequisites.opplanApproved ? 'aprobado' : 'pendiente'}</p>
          <ol style={{ fontSize: 11 }}>{plan.plan.sequence.map((step, i) => <li key={i}>{step}</li>)}</ol>
          <p style={{ fontSize: 11, color: 'var(--yellow)' }}>⛔ Para empezar, inicia sesión manualmente con A y B y utiliza únicamente datos sintéticos.</p>
        </div>
      )}

      <div className="card">
        <h3>Comprobación de evidencia capturada</h3>
        {FIELDS.map(([key, label]) => (
          <label key={key} style={{ display: 'block', margin: '4px 0', fontSize: 12 }}>
            <input type="checkbox" checked={form[key] === true} onChange={(e) => set(key, e.target.checked)} style={{ marginRight: 6 }} />{label}
          </label>
        ))}
        <label style={{ display: 'block', margin: '6px 0', fontSize: 12 }}>
          Reproducciones post-revocación:{' '}
          <input type="number" min={0} max={2} value={form.reproducibleCount} onChange={(e) => set('reproducibleCount', Number(e.target.value))} style={{ width: 60 }} />
        </label>
        <h4>Lectura posterior</h4>
        <label style={{ display: 'block', fontSize: 12 }}><input type="checkbox" checked={form.postRevokeRead} onChange={(e) => set('postRevokeRead', e.target.checked)} /> B obtuvo respuesta después de revocar</label>
        <input type="number" placeholder="HTTP status de lectura posterior" value={form.postRevokeReadStatus || ''} onChange={(e) => set('postRevokeReadStatus', Number(e.target.value))} style={{ width: 220 }} />
        <label style={{ display: 'block', fontSize: 12 }}><input type="checkbox" checked={form.privateContentReturned} onChange={(e) => set('privateContentReturned', e.target.checked)} /> La respuesta contenía contenido privado sintético</label>
        <h4>Escritura posterior (solo si es reversible)</h4>
        <label style={{ display: 'block', fontSize: 12 }}><input type="checkbox" checked={form.postRevokeWrite} onChange={(e) => set('postRevokeWrite', e.target.checked)} /> B pudo modificar después de revocar</label>
        <input type="number" placeholder="HTTP status de escritura posterior" value={form.postRevokeWriteStatus || ''} onChange={(e) => set('postRevokeWriteStatus', Number(e.target.value))} style={{ width: 220 }} />
        <button className="btn btn-green btn-sm" onClick={analyze} disabled={busy} style={{ marginTop: 10 }}>✅ Analizar sin tráfico externo</button>
      </div>

      {verdict && (
        <div className="card" style={{ borderColor: verdict.sendable ? 'var(--red)' : 'var(--yellow)' }}>
          <h3>{verdict.summary}</h3>
          {verdict.results.map((item) => <div key={item.id} style={{ fontSize: 11 }}>{item.ok ? '✅' : '⛔'} {item.label}</div>)}
          {verdict.sendable && <p style={{ color: 'var(--red)', fontWeight: 'bold' }}>Hay una posible vulnerabilidad de autorización post-revocación. Revisa manualmente el Brief y la evidencia antes de redactar.</p>}
        </div>
      )}
    </div>
  );
}
