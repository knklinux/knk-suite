import React, { useState, useEffect } from 'react';

const CHECKLIST = [
  ['inScope', 'Asset dentro del scope exacto'],
  ['noDuplicate', 'Buscados reports parecidos (no duplicado)'],
  ['notDisqualifier', 'No es disqualifier del programa'],
  ['exploitable', 'Explotable de verdad (impacto real)'],
  ['evidenceScreenshots', 'Capturas del exploit y del impacto'],
  ['evidenceRequestResponse', 'Request/Response reproducible adjunto'],
  ['pocMinimal', 'PoC mínimo con pasos numerados'],
  ['noPII', 'Sin PII real (redactado)'],
  ['severityHonest', 'Severidad/CVSS honesto'],
  ['humanReview', 'Revisión humana completada'],
];

const BIZ_FIELDS = [
  ['flujoMapeado', 'Flujo real mapeado (no adivinado)'],
  ['baseline', 'Baseline legítimo capturado (raw HTTP)'],
  ['campoConfiado', 'Campo manipulado es del CLIENTE (confiado)'],
  ['servidorAcepta', 'El servidor ACEPTÓ el valor alterado (diferencia demostrada)'],
  ['impacto', 'Impacto financiero o de acceso demostrado'],
  ['sinTransaccionReal', 'Sin completar transacción real ni tocar fondos ajenos'],
];

const EMPTY_FORM = {
  title: '', asset: '', bugType: '', cwe: '', cvss: '',
  severity: 'info', impact: '', steps: '', screenshotsPath: '', curl: '',
  reproducibleCount: 2,
  humanReview: false,
  reviewNote: '',
  crossOriginRead: false,
  exfil: false,
  ...Object.fromEntries(BIZ_FIELDS.map(([k]) => [k, false])),
};
const emptyChecklist = () => Object.fromEntries(CHECKLIST.map(([k]) => [k, false]));

export default function Reportes({ api }) {
  const [reports, setReports] = useState([]);
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM, ...emptyChecklist() });
  const [triage, setTriage] = useState(null);
  const [cierre, setCierre] = useState(null);
  const [cerrando, setCerrando] = useState(false);

  useEffect(() => { api('/reports').then(setReports); }, [api]);

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const esCors = (d = {}) => String((d.bugType || '')).toLowerCase().includes('cors');
  const esBiz = (d = {}) => /precio|checkout|line-item|coupon|cupon|descuento|reward|redeem|canje|free.entry|bypass.*pago|race|logica.de.negocio|business.logic/.test(String((d.bugType || '')).toLowerCase());
  const progreso = (d = {}) => {
    const okCheck = CHECKLIST.filter(([k]) => d[k] === true).length;
    const reproOk = Number(d.reproducibleCount || 0) >= 2;
    const cifraCors = esCors(d);
    const cifraBiz = esBiz(d);
    const corsOk = cifraCors ? ((d.crossOriginRead === true ? 1 : 0) + (d.exfil === true ? 1 : 0)) : 0;
    const bizOk = cifraBiz ? BIZ_FIELDS.filter(([k]) => d[k] === true).length : 0;
    return { ok: okCheck + (reproOk ? 1 : 0) + corsOk + bizOk, total: CHECKLIST.length + 1 + (cifraCors ? 2 : 0) + (cifraBiz ? BIZ_FIELDS.length : 0), reproOk, esCors: cifraCors, esBiz: cifraBiz };
  };

  const save = async () => {
    const data = {
      ...form,
      steps: (form.steps || '').split('|').map(s => s.trim()).filter(Boolean),
    };
    const slug = ((form.title || 'draft')).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const r = await api('/reports/save', { method: 'POST', body: JSON.stringify({ slug, data }) });
    if (r.ok) {
      setReports(await api('/reports'));
      setEditMode(false);
      setTriage(null);
    }
  };

  const abrirTriage = async (rep) => {
    setTriage({ slug: rep.slug, ok: false, estado: 'comprobando', lines: ['Evaluando checklist…'], carencias: [] });
    const r = await api('/reports/open-triage', { method: 'POST', body: JSON.stringify({ slug: rep.slug, data: rep.data }) });
    if (r.ok) {
      setTriage({
        slug: rep.slug, ok: true, estado: 'abrir_triage',
        veredicto: (r.veredicto && r.veredicto.summary) || '✅ REPORTE LISTO',
        texto: r.texto || '',
        carencias: [],
      });
    } else {
      setTriage({
        slug: rep.slug, ok: false, estado: r.estado,
        lines: (r.carencias && r.carencias.length
          ? r.carencias.map(c => '⛔ ' + c + ' (obligatorio)')
          : (r.blockers || 'No pasa').split('\n').filter(Boolean)),
        carencias: r.carencias || (r.faltantes || []),
      });
    }
  };

  const copiar = (t) => { if (navigator.clipboard) navigator.clipboard.writeText(t); };

  // Cierre de misión: andamiaje del informe de sesión del día en docs/bugbounty/
  const cerrarMision = async (overwrite = false) => {
    setCerrando(true);
    setCierre(null);
    const r = await api('/mission/close', { method: 'POST', body: JSON.stringify({ overwrite }) });
    setCerrando(false);
    setCierre(r);
  };

  return (
    <div>
      <h2>📝 Reportes <span className="muted">· bloqueados hasta pasar la checklist</span></h2>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <button
          className="btn btn-sm btn-green"
          onClick={() => cerrarMision(false)}
          disabled={cerrando}
        >
          {cerrando ? '⏳ Cerrando…' : '🏁 Cerrar misión'}
        </button>
        <span className="muted">
          Genera docs/bugbounty/INFORME-SESION-YYYY-MM-DD.md con los hallazgos de la sesión pre-cargados
        </span>
      </div>

      {cierre && cierre.ok && (
        <div className="card" style={{ borderLeft: '4px solid var(--green)' }}>
          <h3>✅ Informe de sesión generado</h3>
          <div className="kv"><span className="k">Archivo</span><span className="v"><code>{cierre.outPath}</code></span></div>
          <div className="kv"><span className="k">Hallazgos pre-cargados</span><span className="v">{cierre.findingsCount} (§5)</span></div>
          <div className="kv"><span className="k">Fecha</span><span className="v">{cierre.fecha}</span></div>
          <p className="muted" style={{ marginTop: 8 }}>
            Completa a mano: hipótesis (§2), vectores probados (§3), compuertas ejecutadas (§4)
            y lecciones (§6). Luego pasa §9 (validación anti-rechazo) antes de cerrar el día.
          </p>
        </div>
      )}

      {cierre && !cierre.ok && cierre.reason === 'exists' && (
        <div className="card" style={{ borderLeft: '4px solid var(--yellow)' }}>
          <h3>ℹ️ El informe de hoy ya existe</h3>
          <p className="muted"><code>{cierre.outPath}</code></p>
          <button className="btn btn-sm btn-outline" style={{ marginTop: 6 }} onClick={() => cerrarMision(true)}>
            ♻️ Regenerar (sobrescribir con los hallazgos actuales)
          </button>
          <p className="muted" style={{ fontSize: 10, marginTop: 6 }}>
            Ojo: sobrescribir descarta las ediciones manuales que hayas hecho en el archivo.
          </p>
        </div>
      )}

      {cierre && !cierre.ok && cierre.reason !== 'exists' && (
        <div className="card" style={{ borderLeft: '4px solid var(--red)' }}>
          <h3>⛔ No se pudo generar el informe</h3>
          <p className="muted">{cierre.error || 'Error desconocido'}</p>
        </div>
      )}

      <button
        className="btn btn-sm"
        onClick={() => { setEditMode(!editMode); setTriage(null); }}
        style={{ marginBottom: 12 }}
      >
        {editMode ? 'Cancelar' : '+ Nuevo reporte'}
      </button>

      {editMode && (
        <div className="card">
          <h3>Editar reporte</h3>
          <input placeholder="Título (ej: CORS en api.target.com)" value={form.title} onChange={e => setF('title', e.target.value)} />
          <input placeholder="Asset vulnerable" value={form.asset} onChange={e => setF('asset', e.target.value)} />
          <input placeholder="Tipo (CORS, IDOR, XSS, SSRF)" value={form.bugType} onChange={e => setF('bugType', e.target.value)} />
          <input placeholder="CWE" value={form.cwe} onChange={e => setF('cwe', e.target.value)} />
          <input placeholder="CVSS" value={form.cvss} onChange={e => setF('cvss', e.target.value)} />
          <select value={form.severity} onChange={e => setF('severity', e.target.value)}>
            {['info', 'low', 'medium', 'high', 'critical'].map(s => <option key={s}>{s}</option>)}
          </select>
          <textarea placeholder="Impacto" rows={2} value={form.impact} onChange={e => setF('impact', e.target.value)} />
          <textarea placeholder="Pasos (separa con |)" rows={3} value={form.steps} onChange={e => setF('steps', e.target.value)} />
          <input placeholder="Ruta screenshots (exploit + impacto)" value={form.screenshotsPath} onChange={e => setF('screenshotsPath', e.target.value)} />
          <textarea placeholder="Curl reproducible (obligatorio para abrir a triage)" rows={3} value={form.curl} onChange={e => setF('curl', e.target.value)} style={{ fontFamily: 'monospace', fontSize: 11 }} />
          <label>
            Veces reproducido (≥2 obligatorio):{' '}
            <input type="number" min={0} value={form.reproducibleCount} onChange={e => setF('reproducibleCount', Number(e.target.value))} style={{ width: 64 }} />
          </label>
          <textarea placeholder="Nota de revisión humana (qué verificaste; mínimo 20 caracteres)" rows={2} value={form.reviewNote} onChange={e => setF('reviewNote', e.target.value)} />

          <h4 style={{ marginTop: 14, color: 'var(--warn, #f0ad4e)' }}>Checklist de pre-entrega (TODAS obligatorias)</h4>
          {CHECKLIST.map(([k, label]) => (
            <label key={k} style={{ display: 'block', margin: '3px 0' }}>
              <input type="checkbox" checked={form[k] === true} onChange={e => setF(k, e.target.checked)} style={{ marginRight: 6 }} />
              {label}
            </label>
          ))}

          <h4 style={{ marginTop: 12, color: 'var(--warn, #f0ad4e)' }}>
            {esCors(form) ? 'CORS — requisitos de triage (OBLIGATORIOS por tipo)' : 'CORS (aplica si el tipo es CORS)'}
          </h4>
          <label style={{ display: 'block', margin: '3px 0' }}>
            <input type="checkbox" checked={form.crossOriginRead === true} onChange={e => setF('crossOriginRead', e.target.checked)} style={{ marginRight: 6 }} />
            crossOriginRead: el navegador LEYÓ el dato desde otro origen
          </label>
          <label style={{ display: 'block', margin: '3px 0' }}>
            <input type="checkbox" checked={form.exfil === true} onChange={e => setF('exfil', e.target.checked)} style={{ marginRight: 6 }} />
            exfil: el dato llegó a un callback controlado
          </label>

          <h4 style={{ marginTop: 12, color: 'var(--warn, #f0ad4e)' }}>
            {esBiz(form) ? 'LÓGICA DE NEGOCIO — cadena de impacto (OBLIGATORIA por tipo)' : 'Lógica de negocio (aplica si el tipo es de negocio)'}
          </h4>
          {BIZ_FIELDS.map(([k, label]) => (
            <label key={k} style={{ display: 'block', margin: '3px 0' }}>
              <input type="checkbox" checked={form[k] === true} onChange={e => setF(k, e.target.checked)} style={{ marginRight: 6 }} />
              {label}
            </label>
          ))}
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            La puerta de triage exige mínimo <strong>servidorAcepta</strong> + <strong>impacto</strong> (biz-g3/g4). Sin eso, el reporte se bloquea.
          </div>

          <div style={{ marginTop: 10 }}>
            <strong>Estado checklist: {progreso(form).ok}/{progreso(form).total}</strong>
            {' '}({progreso(form).reproOk ? 'reproducción ✅' : 'reproducción ⛔'})
            {progreso(form).esCors && <span className="muted"> · CORS: requiere crossOriginRead+exfil</span>}
            {progreso(form).esBiz && <span className="muted"> · Biz: requiere servidorAcepta+impacto</span>}
          </div>
          <button className="btn btn-green" onClick={save} style={{ marginTop: 10 }}>💾 Guardar borrador</button>
        </div>
      )}

      {triage && (
        <div className="card" style={{ marginBottom: 12, borderLeft: `4px solid ${triage.ok ? 'var(--green,#4caf50)' : 'var(--red,#f44336)'}` }}>
          <h3>{triage.ok ? `🚀 Abierto a triage · ${triage.slug}` : `⛔ Bloqueado · ${triage.slug}`}</h3>
          {triage.ok ? (
            <>
              <p>{triage.veredicto}</p>
              <button className="btn btn-sm" onClick={() => copiar(triage.texto)}>📋 Copiar reporte (Markdown)</button>
              <pre style={{ maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{triage.texto}</pre>
            </>
          ) : (
            <>
              <p className="muted">Falta lo siguiente antes de poder abrirlo a triage:</p>
              <ul>{triage.lines.map((l, i) => <li key={i} style={{ whiteSpace: 'pre-wrap' }}>{l}</li>)}</ul>
            </>
          )}
        </div>
      )}

      {reports.length === 0 && <span className="muted">Sin reportes guardados.</span>}
      {reports.map((r, i) => {
        const p = progreso(r.data || {});
        const listo = p.ok === p.total;
        return (
          <div className="card" key={i}>
            <h3>{r.data?.title || r.slug}</h3>
            <div className="kv"><span className="k">Asset</span><span className="v">{r.data?.asset || '—'}</span></div>
            <div className="kv"><span className="k">Tipo</span><span className="v">{r.data?.bugType || '—'}</span></div>
            <div className="kv"><span className="k">Severidad</span><span className="v"><span className="badge badge-warn">{r.data?.severity} ({r.data?.cvss})</span></span></div>
            <div className="kv"><span className="k">Estado</span><span className="v">
              <span className={`badge ${listo ? '' : 'badge-warn'}`}>{r.status || 'borrador'}</span>
              {' · Checklist '}{p.ok}/{p.total} {listo ? '✅' : '⛔'}
              {listo && (r.data?.checklistTimestamp ? <span className="muted"> · abierto {new Date(r.data.checklistTimestamp).toLocaleString()}</span> : ' · pendiente de abrir')}
            </span></div>
            <button
              className={`btn btn-sm ${listo ? 'btn-green' : ''}`}
              style={{ marginTop: 8 }}
              onClick={() => abrirTriage(r)}
            >
              {listo ? '🚀 Abrir para triage' : '🔒 Abrir para triage (falta checklist)'}
            </button>
          </div>
        );
      })}
    </div>
  );
}