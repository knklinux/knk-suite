import React, { useState } from 'react';

export default function Gates({ api }) {
  const [results, setResults] = useState({});

  const gates = [
    { id: 'cors', title: 'CORS', fields: [
      { id: 'originReflected', label: '¿Origin reflejado con credenciales?', type: 'bool' },
      { id: 'endpointStatus', label: 'Estado del endpoint', type: 'num', def: 200 },
      { id: 'authMode', label: 'Auth (cookie/bearer/ninguna)', def: 'cookie' },
      { id: 'dataSensitive', label: '¿Dato sensible?', type: 'bool' },
      { id: 'crossOriginRead', label: '¿Lectura cross-origin?', type: 'bool' },
      { id: 'exfil', label: 'Exfiltración demostrada?', type: 'bool' },
    ]},
    { id: 'idor', title: 'IDOR', fields: [
      { id: 'inScope', label: '¿En scope?', type: 'bool' },
      { id: 'ownResourceB', label: '¿Recurso de cuenta B?', type: 'bool' },
      { id: 'baselineB200', label: '¿Baseline de B da 200?', type: 'bool' },
      { id: 'readWithA', label: 'Código de A leyendo B', type: 'num', def: 403 },
      { id: 'dataPrivate', label: '¿A leyó datos privados?', type: 'bool' },
      { id: 'reproducible', label: '¿Reproducible?', type: 'bool' },
      { id: 'programEligible', label: '¿Elegible según política?', type: 'bool' },
    ]},
    { id: 'ssrf', title: 'SSRF', fields: [
      { id: 'urlControlled', label: '¿Controlas la URL destino?', type: 'bool' },
      { id: 'serverFetches', label: '¿Llegó el callback?', type: 'bool' },
      { id: 'internalTarget', label: '¿Destino interno?', type: 'bool' },
      { id: 'impactShown', label: '¿Impacto demostrado?', type: 'bool' },
      { id: 'reproducible', label: '¿Reproducible?', type: 'bool' },
      { id: 'inScope', label: '¿En scope?', type: 'bool' },
    ]},
    { id: 'xss', title: 'XSS', fields: [
      { id: 'reflected', label: '¿Payload reflejado?', type: 'bool' },
      { id: 'execContext', label: 'Contexto (html/js/attr)', def: 'html' },
      { id: 'executed', label: '¿Ejecución demostrada?', type: 'bool' },
      { id: 'cspBlocks', label: '¿La CSP bloquea?', type: 'bool' },
      { id: 'impactReal', label: '¿Impacto real?', type: 'bool' },
      { id: 'reproducible', label: '¿Reproducible?', type: 'bool' },
      { id: 'inScope', label: '¿En scope?', type: 'bool' },
    ]},
    { id: 'sqli', title: '🛡️ SQLi — comprobación mínima', fields: [
      { id: 'inScope', label: '¿Endpoint dentro del scope exacto?', type: 'bool' },
      { id: 'authorizedAccount', label: '¿Cuenta autorizada?', type: 'bool' },
      { id: 'baselineCaptured', label: '¿Request legítima capturada?', type: 'bool' },
      { id: 'singleParameter', label: '¿Un único parámetro?', type: 'bool' },
      { id: 'nonDestructive', label: '¿No destructiva?', type: 'bool' },
      { id: 'noExtraction', label: '¿Sin extracción?', type: 'bool' },
      { id: 'automated', label: '¿Se automatizó?', type: 'bool' },
      { id: 'extractionAttempted', label: '¿Se intentó extraer?', type: 'bool' },
      { id: 'enumerationAttempted', label: '¿Se intentó enumerar?', type: 'bool' },
      { id: 'rateLimitRespected', label: '¿Rate limit respetado?', type: 'bool' },
      { id: 'requestCount', label: 'Peticiones controladas (1–2)', type: 'num', def: 0 },
      { id: 'differentialEvidence', label: '¿Evidencia diferencial?', type: 'bool' },
      { id: 'reproducibleCount', label: 'Reproducciones', type: 'num', def: 0 },
      { id: 'securityImpact', label: '¿Impacto concreto?', type: 'bool' },
    ]},
    { id: 'openai-model', title: '🤖 OpenAI — modelo privado/no anunciado', fields: [
      { id: 'program', label: 'Programa (openai)', def: 'openai' },
      { id: 'ownTestAccount', label: '¿Cuenta propia/de test autorizada?', type: 'bool' },
      { id: 'inScope', label: '¿Asset dentro del Brief vigente?', type: 'bool' },
      { id: 'requestResponseCaptured', label: '¿Request/response real capturado?', type: 'bool' },
      { id: 'modelIdReturned', label: '¿La respuesta devuelve model ID?', type: 'bool' },
      { id: 'privateOrUnannounced', label: '¿Privado/no anunciado demostrado?', type: 'bool' },
      { id: 'unauthorizedAccess', label: '¿Acceso no autorizado demostrado?', type: 'bool' },
      { id: 'securityImpact', label: '¿Impacto de seguridad concreto?', type: 'bool' },
      { id: 'reproducibleCount', label: 'Reproducciones', type: 'num', def: 0 },
      { id: 'noPII', label: '¿Sin PII/secretos?', type: 'bool' },
      { id: 'noThirdParty', label: '¿Sin sistemas de terceros?', type: 'bool' },
    ]},
    { id: 'biz', title: '🧮 Lógica de negocio', fields: [
      { id: 'flujoMapeado', label: '¿Flujo real mapeado?', type: 'bool' },
      { id: 'baseline', label: '¿Baseline legítimo (HTTP crudo)?', type: 'bool' },
      { id: 'campoConfiado', label: '¿Campo del cliente confiado?', type: 'bool' },
      { id: 'servidorAcepta', label: '¿El servidor aceptó el valor alterado?', type: 'bool' },
      { id: 'impacto', label: '¿Impacto financiero/de acceso demostrado?', type: 'bool' },
      { id: 'sinTransaccionReal', label: '¿Sin completar transacción real?', type: 'bool' },
      { id: 'reproducible', label: '¿Reproducible (2ª vez)?', type: 'bool' },
      { id: 'inScope', label: '¿En scope y la política lo permite?', type: 'bool' },
    ]},
  ];

  const validate = async (gate) => {
    const input = {};
    gate.fields.forEach(f => {
      const el = document.getElementById(`gate-${gate.id}-${f.id}`);
      if (!el) return;
      const val = el.value;
      if (f.type === 'bool') input[f.id] = val === 'true';
      else if (f.type === 'num') input[f.id] = parseInt(val) || 0;
      else if (val) input[f.id] = val;
    });
    const r = await api('/gates/validate', { method: 'POST', body: JSON.stringify({ type: gate.id, ...input }) });
    setResults(prev => ({ ...prev, [gate.id]: r }));
  };

  return (
    <div>
      <h2>✅ Compuertas</h2>
      <div className="grid">
        {gates.map(g => (
          <div className="card" key={g.id}>
            <h3>{g.title}</h3>
            {g.fields.map(f => (
              <div className="kv" key={f.id}>
                <span className="k">{f.label}</span>
                <span className="v">
                  {f.type === 'bool' ? (
                    <select id={`gate-${g.id}-${f.id}`} style={{ width: 'auto', fontSize: 11 }}>
                      <option value="">—</option>
                      <option value="true">✅ Sí</option>
                      <option value="false">⛔ No</option>
                    </select>
                  ) : (
                    <input id={`gate-${g.id}-${f.id}`} defaultValue={f.def || ''} style={{ width: 80, margin: 0, textAlign: 'right', fontSize: 11 }} />
                  )}
                </span>
              </div>
            ))}
            <button className="btn btn-sm" onClick={() => validate(g)} style={{ marginTop: 8 }}>Validar {g.title}</button>
            {results[g.id] && (
              <div style={{ marginTop: 8, fontSize: 11 }}>
                <strong>{results[g.id].summary}</strong>
                {results[g.id].results.map((r, i) => (
                  <div key={i}>{r.ok ? '✅' : '⛔'} {r.label}</div>
                ))}
                {results[g.id].sendable && <div style={{ color: 'var(--green)', marginTop: 4 }}>✅ ¡Reportable!</div>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}