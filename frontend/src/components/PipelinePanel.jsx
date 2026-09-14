import React, { useState, useEffect } from 'react';

const TEMPLATES = [
  { id: 'fullRecon', label: 'Full Recon', desc: 'Reconocimiento completo: DNS, subdominios, headers, tech stack' },
  { id: 'quickScan', label: 'Quick Scan', desc: 'Escaneo rápido de superficie y headers principales' },
  { id: 'webAudit', label: 'Web Audit', desc: 'Auditoría web con fuzzing básico y análisis de seguridad' },
];

export default function PipelinePanel({ api }) {
  const [templates, setTemplates] = useState(TEMPLATES);
  const [selectedTemplate, setSelectedTemplate] = useState('fullRecon');
  const [target, setTarget] = useState('');
  const [phases, setPhases] = useState([
    { tool: 'nmap', args: '-sV', dependsOn: [] },
  ]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState(null);
  const [pipelineResult, setPipelineResult] = useState(null);
  const [pipelineName, setPipelineName] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    api('/pipeline/templates')
      .then(r => {
        if (r?.templates?.length) setTemplates(r.templates);
      })
      .catch(() => {});
  }, [api]);

  const addPhase = () => {
    setPhases(prev => [...prev, { tool: '', args: '', dependsOn: [] }]);
  };

  const updatePhase = (idx, field, value) => {
    setPhases(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  };

  const removePhase = (idx) => {
    setPhases(prev => prev.filter((_, i) => i !== idx));
  };

  const toggleDependency = (idx, depIdx) => {
    setPhases(prev => prev.map((p, i) => {
      if (i !== idx) return p;
      const deps = p.dependsOn.includes(depIdx)
        ? p.dependsOn.filter(d => d !== depIdx)
        : [...p.dependsOn, depIdx];
      return { ...p, dependsOn: deps };
    }));
  };

  const pollRun = async (runId) => {
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const s = await api(`/pipeline/tools/runs/${encodeURIComponent(runId)}`);
        if (!s?.ok) break;
        setPipelineResult(s);
        const donePhases = (s.phases || []).filter((p) => p.status === 'completed' || p.status === 'failed').length;
        setStatus(`Ejecutando… ${donePhases}/${(s.phases || []).length} fases (${s.progress || 0}%)`);
        if (s.done || s.status === 'completed' || s.status === 'failed' || s.status === 'cancelled') {
          setStatus(s.status === 'completed' ? 'Pipeline completado ✓' : `Pipeline: ${s.status}`);
          setRunning(false);
          return;
        }
      } catch { break; }
    }
    setStatus('Sin más latido del run (mira Alertas)');
    setRunning(false);
  };

  const runPipeline = async () => {
    if (!target.trim()) {
      setToast('Ingresa un objetivo');
      return;
    }
    setRunning(true);
    setPipelineResult(null);
    setStatus('Lanzando pipeline…');
    try {
      const normPhases = phases.map((p, i) => ({
        id: `phase${i + 1}`,
        tool: p.tool,
        args: typeof p.args === 'string' && p.tool === 'nmap' ? { flags: p.args } : (p.args || {}),
        dependsOn: (p.dependsOn || []).map((d) => `phase${Number(d) + 1}`),
      }));
      const r = await api('/pipeline/tools/run', {
        method: 'POST',
        body: JSON.stringify({ target: target.trim(), template: selectedTemplate, phases: normPhases }),
      });
      if (!r?.ok || !r.runId) {
        setStatus('Pipeline rechazado');
        setToast(r?.error || (r?.errors || []).join(' · ') || 'Error al lanzar');
        setRunning(false);
        return;
      }
      setStatus(`Run ${r.runId} en marcha…`);
      setPipelineResult(r.status || null);
      pollRun(r.runId);
    } catch (e) {
      setStatus('Error de conexión');
      setToast('Error: ' + e.message);
      setRunning(false);
    }
  };

  const savePipeline = async () => {
    if (!pipelineName.trim()) {
      setToast('Ingresa un nombre para el pipeline');
      return;
    }
    setSaving(true);
    try {
      const r = await api('/pipeline/save', {
        method: 'POST',
        body: JSON.stringify({ name: pipelineName.trim(), template: selectedTemplate, phases }),
      });
      if (r?.ok) {
        setToast('Pipeline guardado');
        setPipelineName('');
      } else {
        setToast(r?.error || 'Error al guardar');
      }
    } catch (e) {
      setToast('Error: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="module-heading">
        <div>
          <span className="eyebrow">PIPELINE</span>
          <h2>Scan Pipeline</h2>
        </div>
        {running && <span className="badge badge-warn">EJECUTANDO</span>}
      </div>

      <div className="card">
        <h3>Template</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {templates.map(t => (
            <label
              key={t.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                border: `1px solid ${selectedTemplate === t.id ? 'var(--primary)' : 'var(--border)'}`,
                borderRadius: 6,
                cursor: 'pointer',
                background: selectedTemplate === t.id ? 'rgba(8,216,255,0.06)' : 'transparent',
              }}
            >
              <input
                type="radio"
                name="template"
                checked={selectedTemplate === t.id}
                onChange={() => setSelectedTemplate(t.id)}
                style={{ width: 'auto' }}
              />
              <div>
                <div style={{ color: '#fff', fontSize: 11 }}>{t.label || t.id}</div>
                <div className="muted" style={{ fontSize: 10 }}>{t.desc || t.description || ''}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Objetivo</h3>
        <input
          placeholder="https://target.com"
          value={target}
          onChange={e => setTarget(e.target.value)}
        />
      </div>

      <div className="card">
        <h3>Custom Phases</h3>
        {phases.map((p, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              placeholder="tool"
              value={p.tool}
              onChange={e => updatePhase(idx, 'tool', e.target.value)}
              style={{ width: 100, flex: 'none' }}
            />
            <input
              placeholder="args"
              value={p.args}
              onChange={e => updatePhase(idx, 'args', e.target.value)}
              style={{ flex: 1, minWidth: 120 }}
            />
            <select
              value={p.dependsOn.join(',')}
              onChange={e => {
                const vals = e.target.value ? e.target.value.split(',').map(Number) : [];
                updatePhase(idx, 'dependsOn', vals);
              }}
              style={{ width: 140, flex: 'none' }}
            >
              <option value="">sin dependencias</option>
              {phases.map((_, di) => di !== idx && (
                <option key={di} value={di}>fase {di + 1}</option>
              ))}
            </select>
            <button className="btn btn-sm btn-outline" onClick={() => removePhase(idx)} disabled={phases.length <= 1}>
              X
            </button>
          </div>
        ))}
        <button className="btn btn-sm btn-outline" onClick={addPhase}>
          + Agregar fase
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="btn" onClick={runPipeline} disabled={running || !target.trim()}>
          {running ? 'Ejecutando...' : 'Run Pipeline'}
        </button>
        <button className="btn btn-sm" onClick={savePipeline} disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar Pipeline'}
        </button>
        <input
          placeholder="Nombre del pipeline"
          value={pipelineName}
          onChange={e => setPipelineName(e.target.value)}
          style={{ maxWidth: 200 }}
        />
      </div>

      {status && (
        <div className="card">
          <h3>Estado</h3>
          <p style={{ fontSize: 12 }}>{status}</p>
        </div>
      )}

      {pipelineResult?.phases && (
        <div className="card">
          <h3>Progreso por fase</h3>
          {pipelineResult.phases.map((p, i) => (
            <div className="pipeline-phase" key={p.id || i}>
              <div className={`phase-num ${p.status === 'completed' ? 'done' : ''}`}>
                {p.status === 'completed' ? '✓' : p.status === 'failed' ? '✗' : p.status === 'running' ? '▶' : i + 1}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{p.name || p.id}</strong>
                <span className="muted" style={{ display: 'block', fontSize: 10 }}>
                  {p.status === 'completed' && pipelineResult.results?.[p.id]?.stdout
                    ? String(pipelineResult.results[p.id].stdout).split('\n').filter(Boolean).slice(0, 3).join(' · ').slice(0, 220)
                    : (pipelineResult.results?.[p.id]?.error || p.status || 'pendiente')}
                </span>
              </div>
              <span className={`badge ${p.status === 'completed' ? 'badge-ok' : p.status === 'failed' ? 'badge-err' : 'badge-warn'}`}>
                {(p.status || 'pend').toUpperCase()}
              </span>
            </div>
          ))}
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
