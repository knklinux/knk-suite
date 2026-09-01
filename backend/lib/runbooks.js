'use strict';

// ============================================================================
// KNK SUITE v2.1 — Runbooks de respuesta a incidentes
// Por tipo de hallazgo: contención, erradicación, recuperación y lecciones.
// Uso defensivo: cuando `hunt` detecta actividad o un hallazgo se reporta,
// el runbook guía la respuesta del equipo.
// ============================================================================

const RUNBOOKS = {
  brute_force: {
    name: 'Fuerza bruta / credential stuffing',
    containment: ['Bloquear IPs origen (firewall/WAF)', 'Forzar MFA y rotación de contraseñas afectadas', 'Habilitar lockout con backoff exponencial'],
    eradication: ['Revisar cuentas comprometidas (logs de acceso post-exito)', 'Revocar sesiones activas', 'Buscar persistencia (nuevos usuarios, mail forwarding)'],
    recovery: ['Restaurar desde backup si hubo modificación', 'Monitorizar actividad anómala 30 días'],
    lessons: ['MFA obligatorio', 'Rate limiting por IP+cuenta', 'Detección de spikes de fallos (tuning de thresholds)'],
  },
  sqli: {
    name: 'Inyección SQL',
    containment: ['Aislar el endpoint vulnerable', 'Bloquear payloads de inyección en WAF temporalmente', 'Desconectar la app si hay exfiltración activa'],
    eradication: ['Corregir consultas (prepared statements / ORM)', 'Rotar credenciales de BD', 'Revisar dumps en pastebin/telegram'],
    recovery: ['Restaurar datos afectados (PITR)', 'Notificar brecha si hubo datos personales'],
    lessons: ['Validación server-side siempre', 'Principio de menor privilegio en cuentas de BD'],
  },
  xss: {
    name: 'Cross-site scripting',
    containment: ['Añadir CSP estricta (block-all-mixed-content, nonces)', 'Sanitizar el vector de entrada inmediatamente'],
    eradication: ['Corregir encoding de salida', 'Rotar tokens/sesiones potencialmente robadas', 'Buscar cookies httpOnly ausentes'],
    recovery: ['Revisar sesiones de usuarios afectados', 'Notificar si hubo robo de sesión'],
    lessons: ['CSP por defecto', 'httpOnly + Secure + SameSite en cookies'],
  },
  ssrf: {
    name: 'Server-side request forgery',
    containment: ['Bloquear tráfico saliente a metadata/loopback en red', 'Deshabilitar el endpoint mientras se corrige'],
    eradication: ['Allowlist de destinos en el código', 'Validar y normalizar URLs server-side', 'Eliminar credenciales de metadata del entorno'],
    recovery: ['Rotar credenciales de cloud si hubo acceso a metadata', 'Auditar llamadas salientes'],
    lessons: ['Denegar por defecto destinos privados', 'DNS pinning y validación de IP resuelta'],
  },
  idor: {
    name: 'IDOR / acceso horizontal',
    containment: ['Revisar logs del recurso afectado', 'Invalidar sesiones si se sospecha acceso cruzado'],
    eradication: ['Corregir autorización por recurso (ownership check)', 'Auditar endpoints similares con el mismo patrón'],
    recovery: ['Notificar a usuarios afectados si hubo acceso a datos', 'Revisar acceso en logs'],
    lessons: ['Autorización por objeto, no solo autenticación', 'Tests de 2 cuentas en CI'],
  },
  bizlogic: {
    name: 'Lógica de negocio',
    containment: ['Pausar la operación abusada (promo, cupón, transferencia)', 'Congelar saldos/créditos sospechosos'],
    eradication: ['Corregir la validación server-side', 'Revertir transacciones abusivas', 'Auditar el flujo completo'],
    recovery: ['Recalcular saldos afectados', 'Avisar a clientes afectados si aplica'],
    lessons: ['Validar cantidades/estados en el servidor', 'Idempotencia en operaciones críticas', 'Anti-race (transacciones atómicas)'],
  },
  camera: {
    name: 'Cámara IoT expuesta',
    containment: ['Aislar la cámara en VLAN de gestión', 'Cambiar credenciales por defecto', 'Deshabilitar acceso externo (port forwarding)'],
    eradication: ['Actualizar firmware', 'Revisar si el stream fue accedido (logs)'],
    recovery: ['Reinstalar/reiniciar dispositivo', 'Revisar acceso físico'],
    lessons: ['Nunca credenciales por defecto', 'RTSP/ONVIF solo en red interna', 'Segmentación de red IoT'],
  },
  subdomain_takeover: {
    name: 'Subdomain takeover',
    containment: ['Quitar el DNS del servicio abandonado o reclamarlo', 'Poner registro de invalidación'],
    eradication: ['Reclamar el servicio o eliminar el CNAME', 'Auditar otros CNAMEs colgantes'],
    recovery: ['Verificar que no se sirvió contenido malicioso', 'Revisar cookies de dominio'],
    lessons: ['Monitorización de CNAMEs colgantes', 'Proceso de baja de subdominios'],
  },
};

function runbookFor(type) {
  const key = String(type || '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (RUNBOOKS[key]) return { type: key, ...RUNBOOKS[key] };
  // Búsqueda parcial (ej: 'SQL_INJECTION' → 'sqli')
  for (const [k, rb] of Object.entries(RUNBOOKS)) {
    if (key.includes(k) || k.includes(key)) return { type: k, ...rb };
  }
  return null;
}

function renderRunbook(rb) {
  if (!rb) return 'No hay runbook para este tipo de hallazgo.';
  const lines = [`# Runbook: ${rb.name}`, ''];
  lines.push('## Contención', ...rb.containment.map((s, i) => `${i + 1}. ${s}`), '');
  lines.push('## Erradicación', ...rb.eradication.map((s, i) => `${i + 1}. ${s}`), '');
  lines.push('## Recuperación', ...rb.recovery.map((s, i) => `${i + 1}. ${s}`), '');
  lines.push('## Lecciones', ...rb.lessons.map((s, i) => `${i + 1}. ${s}`), '');
  return lines.join('\n');
}

module.exports = { RUNBOOKS, runbookFor, renderRunbook };
