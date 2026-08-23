import React, { useState, useEffect } from 'react';

export default function Compliance({ api }) {
  const [rules, setRules] = useState(null);

  useEffect(() => { api('/compliance').then(setRules); }, [api]);

  if (!rules?.rules) return <div className="card"><span className="muted">Cargando...</span></div>;
  const r = rules.rules;

  const rows = [
    ['User-Agent personalizado', '✅', '✅ Obligatorio', '✅ Recomendado'],
    ['Scope enforcement', '✅', '✅ Obligatorio', '✅ Obligatorio'],
    ['Rate limiting (1.5s + jitter)', '✅', '✅ Mínimo 1-2s', '✅ Mínimo 1-2s'],
    ['RECON: subfinder (passive)', '✅', '✅ Permitido', '✅ Permitido'],
    ['SCAN: 1 petición headers', '✅', '✅ Manual = OK', '✅ Manual = OK'],
    ['FUZZ: 15 paths (2-4s)', '⚠️', '🚫 Prohibido auto', '🚫 Prohibido auto'],
    ['Nuclei/vuln scan auto', '❌', '🚫 Prohibido', '🚫 Prohibido'],
    ['Screenshots + curl', '✅', '✅ Requerido', '✅ Requerido'],
    ['Coordinated disclosure', '✅', '✅ Requerido', '✅ Requerido'],
  ];

  return (
    <div>
      <h2>📜 Compliance</h2>

      <div className="card">
        <h3>🔍 Suite vs Políticas</h3>
        <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ textAlign: 'left', padding: 6, color: 'var(--muted)' }}>Acción</th>
              <th style={{ padding: 6, color: 'var(--muted)' }}>Suite</th>
              <th style={{ padding: 6, color: 'var(--muted)' }}>YesWeHack</th>
              <th style={{ padding: 6, color: 'var(--muted)' }}>HackerOne</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([action, suite, ywh, h1], i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: 6 }}>{action}</td>
                <td style={{ padding: 6, textAlign: 'center', color: suite === '✅' ? 'var(--green)' : suite === '⚠️' ? 'var(--yellow)' : 'var(--red)' }}>{suite}</td>
                <td style={{ padding: 6, textAlign: 'center', fontSize: 10 }}>{ywh}</td>
                <td style={{ padding: 6, textAlign: 'center', fontSize: 10 }}>{h1}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ borderColor: 'var(--red)' }}>
        <h3 style={{ color: 'var(--red)' }}>⚠️ ADVERTENCIA</h3>
        <p style={{ fontSize: 12 }}><strong>El fuzz automático viola las políticas de ambos programas.</strong></p>
        <p style={{ fontSize: 12, marginTop: 8 }}>Desactívalo o pide autorización explícita. La suite pausa automáticamente en FUZZ y EXPLOIT para que lo hagas manualmente.</p>
      </div>

      <div className="card">
        <h3>✅ Checklist pre-envío</h3>
        {[
          '¿Dentro del scope documentado?',
          '¿User-Agent correcto (bug-bounty-TuNombre)?',
          '¿Rate limit respetado?',
          '¿Screenshot del exploit?',
          '¿Screenshot del impacto?',
          '¿Curl reproducible?',
          '¿PoC reproducido 2+ veces?',
          '¿CVSS honesto?',
          '¿Sin PII real?',
          '¿Primera vez que reportas?',
        ].map((item, i) => (
          <div key={i} style={{ padding: '3px 0', fontSize: 12 }}>
            <input type="checkbox" style={{ width: 'auto', marginRight: 8 }} />{item}
          </div>
        ))}
      </div>

      {r.userAgent && (
        <div className="card">
          <h3>📋 Reglas YesWeHack</h3>
          <p style={{ fontSize: 12 }}><strong>User-Agent:</strong> {r.userAgent.description}</p>
          <p style={{ fontSize: 11, color: 'var(--primary)' }}><code>{r.userAgent.example}</code></p>
          <p style={{ fontSize: 12, marginTop: 8 }}><strong>Escaneo:</strong> {r.automatedScanning.prohibited}</p>
          <p style={{ fontSize: 12 }}><strong>DoS:</strong> {r.denialOfService.prohibited}</p>
          <p style={{ fontSize: 12 }}><strong>Scope:</strong> {r.scope.rule}</p>
        </div>
      )}
    </div>
  );
}