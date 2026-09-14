import { useState } from 'react';

// Colores por veredicto del análisis (mismos tokens del resto de la UI).
const KIND_STYLE = {
  'foreign-host-rewrite': { color: 'var(--red, #f85149)', label: '⚠ PROXY ABIERTO: reescribe hosts ajenos', canCreate: true },
  'same-host-rewrite': { color: 'var(--green)', label: '✓ Proxy sano: solo reescribe su propio host', canCreate: false },
  'no-proxy-pattern': { color: 'var(--green)', label: '✓ Sin patrón de proxy: CDN/manifiesto directo', canCreate: false },
};

const SEVERITY_COLOR = {
  high: 'var(--red, #f85149)',
  medium: 'var(--yellow)',
  low: 'var(--primary)',
  info: 'var(--muted)',
};

/**
 * Veredicto de la auditoría del proxy HLS de una cámara: análisis del
 * manifiesto, sonda activa opcional (opt-in, solo habla con el proxy) y
 * conversión en hallazgo de la misión con evidencia. El manifiesto se envía
 * inline cuando se tiene (evita una segunda descarga remota); si no, el
 * backend lo descarga por sí mismo.
 */
export default function HlsAuditPanel({ api, manifestUrl, manifestInline, cameraName, onClose }) {
  const [phase, setPhase] = useState('idle'); // idle | running | done | error
  const [withProbe, setWithProbe] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(null);

  const runAudit = async (probe) => {
    setPhase('running');
    setErr('');
    setCreated(null);
    setWithProbe(probe);
    try {
      const body = { url: manifestUrl };
      if (probe) body.probe = true;
      if (manifestInline) body.manifest = manifestInline;
      const r = await api('/cameras/exposed/hls-audit', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!r || r.ok === false) throw new Error(r?.error || 'respuesta sin análisis');
      setResult(r);
      setPhase('done');
    } catch (e) {
      setErr(e.message || String(e));
      setPhase('error');
    }
  };

  const createFinding = async () => {
    if (!result) return;
    setCreating(true);
    try {
      const body = { url: manifestUrl, create: true };
      if (withProbe) body.probe = true;
      if (manifestInline) body.manifest = manifestInline;
      const r = await api('/cameras/exposed/hls-audit', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!r || r.ok === false) throw new Error(r?.error || 'no se pudo crear el hallazgo');
      const conv = r.conversion || {};
      setCreated(conv.duplicate ? { duplicate: true, id: conv.findingId, note: conv.note } : { duplicate: false, id: conv.created?.id, evidence: conv.created?.evidence });
      setResult(r);
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setCreating(false);
    }
  };

  const a = result?.analysis;
  const kind = a && KIND_STYLE[a.kind];
  const score = a ? Math.round(a.score) : 0;

  return (
    <div style={{ marginTop: 8, borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
      {phase === 'idle' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-sm btn-outline" onClick={() => runAudit(false)}>
            🔍 Auditar proxy HLS
          </button>
          <button className="btn btn-sm btn-outline" onClick={() => runAudit(true)} title="Pide al proxy el primer recurso reescrito y mira si reenvía a un host ajeno. Solo habla con el proxy, nunca con el destino.">
            🔬 Auditar + sonda activa
          </button>
          <span style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'monospace' }}>analiza el manifiesto en busca de reescritura de hosts ajenos (proxy abierto → SSRF)</span>
        </div>
      )}

      {phase === 'running' && (
        <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--primary)' }}>
          ⏳ analizando manifiesto{withProbe ? ' + sonda activa' : ''}…
        </div>
      )}

      {phase === 'error' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--red, #f85149)' }}>✘ {err}</span>
          <button className="btn btn-sm btn-outline" onClick={() => runAudit(withProbe)}>reintentar</button>
        </div>
      )}

      {phase === 'done' && a && (
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: kind.color }}>{kind.label}</span>
            <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--muted)' }}>
              score {score}/100 · host embebido: <b style={{ color: kind.color }}>{a.foreignHost || '—'}</b>
              {a.allowlisted != null && (
                <> · {a.allowlisted ? 'en allowlist pública (mitiga)' : 'NO en allowlist (arbitrario)'}</>
              )}
            </span>
            <button className="btn btn-sm btn-outline" onClick={onClose} style={{ marginLeft: 'auto' }}>✕</button>
          </div>

          {a.checks?.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {a.checks.map((c, i) => (
                <li key={i} style={{ fontSize: 9, fontFamily: 'monospace', color: SEVERITY_COLOR[c.severity] || 'var(--muted)' }}>
                  [{c.severity}] {c.detail}
                </li>
              ))}
            </ul>
          )}

          {result.probe && (
            <div style={{ fontSize: 9, fontFamily: 'monospace', color: result.probe.reachable ? 'var(--red, #f85149)' : 'var(--green)' }}>
              🔬 sonda: {result.probe.note}{result.probe.status ? ` (HTTP ${result.probe.status}, ${result.probe.latencyMs}ms)` : ''}
            </div>
          )}

          {a.finding ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {!created && (
                <button className="btn btn-sm" onClick={createFinding} disabled={creating}>
                  {creating ? '⏳ creando…' : '➕ Crear hallazgo en la misión (con evidencia)'}
                </button>
              )}
              {created && created.duplicate && (
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--yellow)' }}>⏭ ya existía un hallazgo para este manifiesto — no se duplica</span>
              )}
              {created && !created.duplicate && (
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--green)' }}>
                  ✔ hallazgo #{created.id} creado{created.evidence ? ' · evidencia en ~/.knk-suite/evidencia/' : ''}
                </span>
              )}
              <button className="btn btn-sm btn-outline" onClick={() => runAudit(withProbe)}>🔁 repetir</button>
            </div>
          ) : (
            <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--muted)' }}>{result.recommendation || 'Sin acción.'}</span>
          )}

          {a.finding && result.recommendation && (
            <details style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--muted)' }}>
              <summary style={{ cursor: 'pointer' }}>recomendación de remediación</summary>
              <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{result.recommendation}</div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
