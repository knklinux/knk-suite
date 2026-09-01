'use strict';

// ============================================================================
// KNK SUITE v2.1 — Purple Team
// Conecta lo ofensivo con lo defensivo: para cada tipo de hallazgo, entrega
// una regla de detección (estilo Sigma) y pasos de validación para comprobar
// que el SOC la vería. Uso: en el laboratorio propio, no contra terceros.
// ============================================================================

const DETECTIONS = {
  brute_force: {
    sigma: `title: Failed Logins Spike from Single Source
detection:
  selection:
    EventID: 4625   # Windows) / sshd Failed password
    src_ip:
      - 'same'
  condition: selection | count() by src_ip > 10 within 5m
level: medium`,
    validate: ['Reproducir 11 logins fallidos desde una IP en 5 min', 'Comprobar que la regla alerta', 'Probar que 5 fallos NO alertan (evitar ruido)'],
  },
  sqli: {
    sigma: `title: SQL Injection Probe Patterns
detection:
  selection:
    http_method: [GET, POST]
    url_query|contains:
      - "union select"
      - "' or '1'='1"
      - "sleep("
      - "waitfor delay"
  condition: selection
level: high`,
    validate: ['Enviar payload de prueba a un endpoint propio', 'Verificar que la regla lo captura en el log del WAF/proxy', 'Ajustar para no alertar en params legítimos'],
  },
  xss: {
    sigma: `title: Reflected XSS Payload in Request
detection:
  selection:
    http_method: [GET, POST]
    url_query|contains:
      - "<script>"
      - "alert("
      - "onerror="
      - "javascript:"
  condition: selection
level: high`,
    validate: ['Inyectar payload reflejado en laboratorio', 'Confirmar que la regla detecta antes de llegar al navegador', 'Probar bypasses (encoding) y ajustar normalización'],
  },
  ssrf: {
    sigma: `title: Outbound Request to Metadata/Loopback
detection:
  selection:
    dest_ip:
      - '169.254.169.254'
      - '127.0.0.1'
      - '10.0.0.0/8'
    user_agent|contains: 'knk-suite'
  condition: selection
level: critical`,
    validate: ['Disparar un SSRF de prueba al metadata en laboratorio', 'Verificar que el egress/IDS lo bloquea o alerta', 'Comprobar que el tráfico legítimo no lo cruza'],
  },
  idor: {
    sigma: `title: Horizontal Access Anomaly (same account, many objects)
detection:
  selection:
    http_method: GET
    url_path|startswith: '/api/'
    user_id|changed: true
    object_id|changed: true
  condition: selection | count() by session_id > 50 within 10m
level: medium`,
    validate: ['Con 2 cuentas propias, acceder a recursos de la otra', 'Verificar que la regla correlaciona el cambio de objeto', 'Ajustar umbrales por app'],
  },
  camera: {
    sigma: `title: Unexpected RTSP/ONVIF Access
detection:
  selection:
    dest_port:
      - 554
      - 8554
      - 8000
      - 8899
    src_net|not_contains: 'management_vlan'
  condition: selection
level: high`,
    validate: ['Desde un host NO gestión, conectar al RTSP de una cámara de laboratorio', 'Verificar alerta', 'Confirmar que la VLAN de gestión no alerta'],
  },
  c2: {
    sigma: `title: Beaconing to Known C2 Domain
detection:
  selection:
    dest_domain: <C2_DOMAIN>
    http_method: GET
  condition: selection | count() within 10m > 5
level: critical`,
    validate: ['Simular beacon con frecuencia regular en lab', 'Confirmar que la regla detecta la periodicidad', 'Enriquecer con IoCs del feed CTI'],
  },
};

function detectionFor(finding) {
  const type = String(finding?.type || '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (DETECTIONS[type]) return { type, ...DETECTIONS[type] };
  for (const [k, d] of Object.entries(DETECTIONS)) {
    if (type.includes(k) || k.includes(type)) return { type: k, ...d };
  }
  return null;
}

function renderDetection(d) {
  if (!d) return 'No hay regla de detección para este tipo de hallazgo.';
  return ['# Regla de detección (Sigma)', '', '```yaml', d.sigma, '```', '', '## Validación', ...d.validate.map((s, i) => `${i + 1}. ${s}`)].join('\n');
}

module.exports = { DETECTIONS, detectionFor, renderDetection };
