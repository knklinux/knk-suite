import React, { useState, useEffect } from 'react';

const CHECKLIST_BUGCROWD = [
  '¿Dentro del scope del Brief (tabla de scopes)?',
  '¿Política de testing del Brief revisada (prevalece)?',
  '¿Rate limit respetado?',
  '¿Sin PII/PHI/datos de tarjetas en la evidencia?',
  '¿Acceso a datos limitado al mínimo para demostrar impacto?',
  '¿Informe completo en el ORIGINAL (no marcador de posición)?',
  '¿Captura del exploit?',
  '¿Captura del impacto?',
  '¿Curl reproducible?',
  '¿PoC reproducido 2+ veces?',
  '¿CVSS honesto?',
  '¿Reporte de GenAI revisado y validado manualmente (obligatorio)?',
  '¿Confidencialidad del programa privado mantenida?',
];

export default function Compliance({ api }) {
  const [rules, setRules] = useState(null);
  const [platformOverride, setPlatformOverride] = useState('');

  useEffect(() => {
    const q = platformOverride ? `?platform=${platformOverride}` : '';
    api(`/compliance${q}`).then(setRules);
  }, [api, platformOverride]);

  if (!rules?.rules) return <div className="card"><span className="muted">Cargando...</span></div>;
  const r = rules.rules;
  const esBugcrowd = rules.activePlatform === 'bugcrowd';
  const esYWH = rules.activePlatform === 'yeswehack';
  const checklist = rules.programPolicy?.checklistPreEnvio || (esBugcrowd ? CHECKLIST_BUGCROWD : [
    '¿Dentro del scope documentado?',
    '¿User-Agent correcto (bug-bounty-TuNombre)?',
    '¿Rate limit respetado?',
    '¿Captura del exploit?',
    '¿Captura del impacto?',
    '¿Curl reproducible?',
    '¿PoC reproducido 2+ veces?',
    '¿CVSS honesto?',
    '¿Sin PII real?',
    '¿Primera vez que reportas?',
  ]);

  const rows = [
    ['User-Agent personalizado', '✅', '✅ Obligatorio', '⚪ No exigido (buena práctica)'],
    ['Respeto del scope', '✅', '✅ Obligatorio', '✅ Obligatorio (Brief manda)'],
    ['Rate limiting (1.5s mínimo, sin jitter)', '✅', '✅ Mínimo 1-2s', '✅ Buen estándar'],
    ['RECON: subfinder (pasivo)', '✅', '✅ Permitido', '✅ Permitido (según Brief)'],
    ['SCAN: 1 petición headers', '✅', '✅ Manual = OK', '✅ Manual = OK'],
    ['FUZZ: 15 rutas (manual-paced)', '⚠️', '🚫 Prohibido auto', '🚫 Prohibido sin autorización'],
    ['Nuclei / escáner de vulns automático', '❌', '🚫 Prohibido', '🚫 Prohibido (estándar plataforma)'],
    ['Capturas + curl', '✅', '✅ Requerido', '✅ Requerido (PoC completo)'],
    ['Divulgación coordinada', '✅', '✅ Requerido', '✅ Requerida + confidencialidad'],
    ['GenAI con revisión humana', '✅', '⚪ Sin regla', '✅ Requerida (rechazo si no)'],
    ['Mínimo acceso a datos', '✅', '⚪ Sin regla', '✅ Obligatorio (PII → detener)'],
  ];

  return (
    <div>
      <h2>📜 Cumplimiento</h2>

      <div className="card">
        <h3>⚙️ Plataforma activa</h3>
        <p style={{ fontSize: 12, margin: '4px 0' }}>
          {esBugcrowd
            ? <><strong style={{ color: 'var(--green)' }}>🐦 Bugcrowd — Código de Conducta</strong> (activado por el programa de la sesión)</>
            : <><strong style={{ color: 'var(--green)' }}>⚔️ YesWeHack — Global Hunter Terms</strong> (política por defecto)</>}
        </p>
        <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0' }}>
          Se elige automáticamente según la plataforma del programa parseado (bugcrowd.com → Código de Conducta Bugcrowd).
        </p>
        <select value={platformOverride} onChange={e => setPlatformOverride(e.target.value)} style={{ fontSize: 12 }}>
          <option value="">— Automático (sesión) —</option>
          {(rules.available || []).map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        {esBugcrowd && rules.activeWhen && (
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
            Aplica a: {rules.activeWhen.appliesTo?.join(' · ')}
          </p>
        )}
      </div>

      {rules.programPolicy && (
        <div className="card" style={{ borderColor: 'var(--primary)' }}>
          <h3>🎯 {rules.programPolicy.program === 'openai' ? 'Programa activo: OpenAI (Bugcrowd)' : `Programa activo: ${rules.program}`}</h3>
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0' }}>{rules.programPolicy.source}</p>
          {rules.programPolicy.activeWhen?.ficha && (
            <p style={{ fontSize: 11, margin: '4px 0' }}>
              📇 {rules.programPolicy.activeWhen.ficha.estado} · Safe Harbor: {rules.programPolicy.activeWhen.ficha.safeHarbor} · Bonus máx: {rules.programPolicy.activeWhen.ficha.bonusMaximo}<br />
              ⚠️ {rules.programPolicy.activeWhen.ficha.requisito}
            </p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
            <div>
              <strong style={{ fontSize: 11 }}>🟢 En scope (grupos):</strong>
              <ul style={{ fontSize: 11, paddingLeft: 16, margin: '4px 0' }}>
                {(rules.programPolicy.scope?.targets || []).map((t, i) => (
                  <li key={i}><strong>{t.grupo}</strong> — {t.assets.join(', ')}<br /><span style={{ color: 'var(--muted)' }}>{t.recompensa}</span></li>
                ))}
              </ul>
            </div>
            <div>
              <strong style={{ fontSize: 11 }}>🔴 Reglas de oro:</strong>
              <ol style={{ fontSize: 11, paddingLeft: 16, margin: '4px 0' }}>
                {(rules.programPolicy.reglasDeOro || []).map((g, i) => <li key={i}>{g}</li>)}
              </ol>
            </div>
          </div>
          {rules.programPolicy.modelIssues && (
            <div style={{ border: '1px solid var(--red)', padding: 8, marginTop: 8 }}>
              <strong style={{ fontSize: 12, color: 'var(--red)' }}>⛔ {rules.programPolicy.modelIssues.title} — Issues de modelo</strong>
              <p style={{ fontSize: 11, margin: '4px 0' }}>{rules.programPolicy.modelIssues.rule}</p>
              <p style={{ fontSize: 11, margin: '4px 0', color: 'var(--muted)' }}>Fuera: {rules.programPolicy.modelIssues.fuera.join(' · ')}</p>
              <p style={{ fontSize: 11, margin: '4px 0' }}>📮 Reportar modelo → {rules.programPolicy.modelIssues.dondeReportar.comportamiento} · Safety → {rules.programPolicy.modelIssues.dondeReportar.safetyProgram}</p>
              <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse', marginTop: 6 }}>
                <thead><tr style={{ borderBottom: '1px solid var(--border)' }}><th style={{ textAlign: 'left', padding: 3, color: 'var(--muted)' }}>Sandbox (fuera de alcance)</th><th style={{ textAlign: 'left', padding: 3, color: 'var(--muted)' }}>Indicadores</th></tr></thead>
                <tbody>
                  {rules.programPolicy.modelIssues.sandboxes.map((sb, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: 3 }}><strong>{sb.nombre}</strong><br /><span style={{ color: 'var(--muted)' }}>{sb.nota}</span></td>
                      <td style={{ padding: 3, fontFamily: 'monospace' }}>whoami={sb.whoami}<br />{sb.uname}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ fontSize: 11, marginTop: 6, color: 'var(--yellow)' }}>🧪 {rules.programPolicy.modelIssues.reglaSandbox}</p>
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <strong style={{ fontSize: 11 }}>⚪ Fuera de alcance (recordatorio):</strong>
            <p style={{ fontSize: 10, color: 'var(--muted)', margin: '4px 0' }}>
              {[...(rules.programPolicy.outOfScope?.general || []), ...(rules.programPolicy.outOfScope?.especificos || [])].join(' · ')}
            </p>
          </div>
          {rules.programPolicy.credenciales && (
            <p style={{ fontSize: 11, marginTop: 6 }}><strong>🔑 Credenciales:</strong> {rules.programPolicy.credenciales.cuentas} {rules.programPolicy.credenciales.avisos.join(' ')}</p>
          )}
          <p style={{ fontSize: 11, marginTop: 6, color: 'var(--muted)' }}>⚖️ {rules.programPolicy.safeHarbor?.proteccion} {rules.programPolicy.safeHarbor?.limites}</p>
          <p style={{ fontSize: 11, marginTop: 4, color: 'var(--yellow)' }}>🔧 {rules.programPolicy.suiteNota}</p>
          <p style={{ fontSize: 11, marginTop: 6 }}><strong>✅ Checklist del programa:</strong> {rules.programPolicy.checklistPreEnvio?.length || 0} ítems (se activan abajo).</p>
        </div>
      )}

      <div className="card">
        <h3>🔍 Suite vs Políticas</h3>
        <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ textAlign: 'left', padding: 6, color: 'var(--muted)' }}>Acción</th>
              <th style={{ padding: 6, color: 'var(--muted)' }}>Suite</th>
              <th style={{ padding: 6, color: 'var(--muted)' }}>YesWeHack</th>
              <th style={{ padding: 6, color: 'var(--muted)' }}>Bugcrowd</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([action, suite, ywh, bc], i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: esBugcrowd && bc.startsWith('✅') ? 'rgba(46,204,113,.06)' : 'transparent' }}>
                <td style={{ padding: 6 }}>{action}</td>
                <td style={{ padding: 6, textAlign: 'center', color: suite === '✅' ? 'var(--green)' : suite === '⚠️' ? 'var(--yellow)' : 'var(--red)' }}>{suite}</td>
                <td style={{ padding: 6, textAlign: 'center', fontSize: 10 }}>{ywh}</td>
                <td style={{ padding: 6, textAlign: 'center', fontSize: 10 }}>{bc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ borderColor: 'var(--red)' }}>
        <h3 style={{ color: 'var(--red)' }}>⚠️ ADVERTENCIA</h3>
        <p style={{ fontSize: 12 }}><strong>El fuzz automático viola las políticas de las plataformas.</strong></p>
        <p style={{ fontSize: 12, marginTop: 8 }}>Desactívalo o pide autorización explícita. La suite pausa automáticamente en FUZZ y EXPLOIT para que lo hagas manualmente.</p>
      </div>

      {esBugcrowd && (
        <>
          {rules.platformStandards && (
            <div className="card">
              <h3>📏 {rules.platformStandards.title}</h3>
              <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0' }}>{rules.platformStandards.description}</p>
              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse', marginTop: 8 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: 4, color: 'var(--muted)' }}>Marcas</th>
                    <th style={{ textAlign: 'left', padding: 4, color: 'var(--muted)' }}>Comportamiento</th>
                    <th style={{ textAlign: 'left', padding: 4, color: 'var(--muted)' }}>Ejemplos</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.platformStandards.behaviors.map((b, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: 4, textAlign: 'center', color: b.marks >= 4 ? 'var(--red)' : b.marks >= 2 ? 'var(--yellow)' : 'var(--muted)' }}><strong>{b.marks}</strong></td>
                      <td style={{ padding: 4 }}><strong>{b.name}</strong></td>
                      <td style={{ padding: 4, color: 'var(--muted)' }}>{b.examples}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h4 style={{ margin: '12px 0 4px' }}>⚖️ Escala de sanciones</h4>
              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: 4, color: 'var(--muted)' }}>Puntos</th>
                    <th style={{ textAlign: 'left', padding: 4, color: 'var(--muted)' }}>Medida</th>
                    <th style={{ textAlign: 'left', padding: 4, color: 'var(--muted)' }}>Definición</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.platformStandards.enforcementScale.map((e, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: 4, textAlign: 'center' }}><strong>{e.marks}</strong></td>
                      <td style={{ padding: 4 }}><strong>{e.action}</strong></td>
                      <td style={{ padding: 4, color: 'var(--muted)' }}>{e.definition}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>⏳ {rules.platformStandards.caducidad}</p>
              <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>🚪 {rules.platformStandards.reincorporacion}</p>
              <p style={{ fontSize: 11, marginTop: 4 }}><strong>📣 {rules.platformStandards.reportar}</strong></p>
              <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>⚖️ {rules.platformStandards.discretion}</p>
              <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>📜 {rules.platformStandards.terms}</p>
            </div>
          )}
          {rules.aiPrinciples && (
            <div className="card">
              <h3>🧠 {rules.aiPrinciples.title}</h3>
              <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0' }}>{rules.aiPrinciples.description}</p>
              <p style={{ fontSize: 11, color: 'var(--primary)', margin: '4px 0' }}>🔐 Certificaciones: {rules.aiPrinciples.certifications}</p>
              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse', marginTop: 8 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ textAlign: 'left', padding: 4, color: 'var(--muted)' }}>Principio</th>
                    <th style={{ textAlign: 'left', padding: 4, color: 'var(--muted)' }}>Qué significa</th>
                    <th style={{ textAlign: 'left', padding: 4, color: 'var(--muted)' }}>Qué significa para ti</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.aiPrinciples.principles.map((p, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: 4 }}><strong>{p.name}</strong></td>
                      <td style={{ padding: 4, color: 'var(--muted)' }}>{p.meaning}</td>
                      <td style={{ padding: 4 }}>{p.forYou}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h4 style={{ margin: '12px 0 4px' }}>🏗️ {rules.aiPrinciples.architecture?.title}</h4>
              <p style={{ fontSize: 11, margin: '4px 0' }}><strong>Modelos:</strong> <span style={{ color: 'var(--muted)' }}>{rules.aiPrinciples.architecture?.models}</span></p>
              <p style={{ fontSize: 11, margin: '4px 0' }}><strong>Aislamiento:</strong> <span style={{ color: 'var(--muted)' }}>{rules.aiPrinciples.architecture?.isolation}</span></p>
              <p style={{ fontSize: 11, margin: '4px 0' }}><strong>HITL:</strong> <span style={{ color: 'var(--muted)' }}>{rules.aiPrinciples.architecture?.hitl}</span></p>
              <h4 style={{ margin: '10px 0 4px' }}>❓ FAQ</h4>
              {(rules.aiPrinciples.architecture?.faq || []).map((f, i) => (
                <p key={i} style={{ fontSize: 11, margin: '4px 0' }}><strong>{f.q}</strong><br /><span style={{ color: 'var(--muted)' }}>{f.a}</span></p>
              ))}
              <p style={{ fontSize: 11, marginTop: 8, color: 'var(--yellow)' }}>🎯 {rules.aiPrinciples.relevanciaCaza}</p>
            </div>
          )}
          <div className="card" style={{ borderColor: 'var(--yellow)' }}>
            <h3 style={{ color: 'var(--yellow)' }}>🤖 GenAI — Uso responsable (Bugcrowd)</h3>
            <p style={{ fontSize: 12 }}>{r.genai?.rule}</p>
            <p style={{ fontSize: 12, marginTop: 8, color: 'var(--red)' }}><strong>{r.genai?.humanReview}</strong></p>
            {r.genai?.suiteNota && <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>{r.genai.suiteNota}</p>}
          </div>
          <div className="card" style={{ borderColor: 'var(--yellow)' }}>
            <h3>🔐 Confidencialidad y datos (Bugcrowd)</h3>
            <p style={{ fontSize: 12 }}><strong>Programas privados:</strong> {r.disclosure?.rule}</p>
            <p style={{ fontSize: 12, marginTop: 8 }}><strong>Acceso a datos:</strong> {r.disclosure?.dataMinimization}</p>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}><strong>Regulación:</strong> {r.disclosure?.regulacion}</p>
          </div>
          <div className="card" style={{ borderColor: 'var(--red)' }}>
            <h3 style={{ color: 'var(--red)' }}>🚫 Prohibido: marcadores de posición (squatting)</h3>
            <p style={{ fontSize: 12 }}>{r.reportingRequirements?.placeholderBan}</p>
          </div>
        </>
      )}

      <div className="card">
        <h3>✅ Checklist pre-envío</h3>
        <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0' }}>
          {rules.programPolicy ? 'Checklist específico del programa activo' : esBugcrowd ? 'Checklist según Código de Conducta Bugcrowd' : 'Checklist según Global Hunter Terms (YesWeHack)'}
        </p>
        {checklist.map((item, i) => (
          <div key={i} style={{ padding: '3px 0', fontSize: 12 }}>
            <input type="checkbox" style={{ width: 'auto', marginRight: 8 }} />{item}
          </div>
        ))}
      </div>

      {esYWH && r.userAgent && (
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