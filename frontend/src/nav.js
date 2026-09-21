// Fuente ÚNICA de módulos de navegación.
// La consume el sidebar (App.jsx) y la CommandPalette — antes cada uno
// mantenía su propia lista y se desincronizaban (la paleta se quedó sin
// proxy, params, findings, cámaras…). Añadir un módulo = editarlo aquí.
//
// Shape: { id, label, icon, kw } — kw son palabras clave para la búsqueda
// difusa de la paleta.

export const NAV_GROUPS = [
  ['OPERACIÓN', ['dashboard', 'findings', 'params', 'targets', 'opplan', 'pipeline', 'jobs']],
  ['EJECUCIÓN', ['terminal', 'proxy', 'repeater', 'gates', 'revocation', 'nuclei', 'oast']],
  ['INTELIGENCIA', ['assistant', 'vault', 'osint', 'cameras', 'liligo', 'liligo-real']],
  ['HERRAMIENTAS', ['tools', 'clipboard', 'alerts', 'cache', 'plugins', 'team', 'tor']],
  ['LABORATORIO', ['labs']],
  ['SALIDA', ['reportes', 'report-export', 'compliance', 'cheatsheet']],
];

export const NAV_MODULES = {
  dashboard: { label: 'Panel', icon: '📊', kw: 'hub inicio resumen estado misión' },
  findings: { label: 'Hallazgos', icon: '🐞', kw: 'findings bugs hallazgos evidencia' },
  params: { label: 'Param Hunter', icon: '🎯', kw: 'params reflected parámetros canario' },
  targets: { label: 'Targets', icon: '🎯', kw: 'objetivo scope autorización' },
  opplan: { label: 'OPPLAN', icon: '📋', kw: 'plan operación aprobación autorización' },
  pipeline: { label: 'Pipeline · Fases', icon: '🚀', kw: 'pipeline fases engagement run plantillas QA local' },
  jobs: { label: 'Trabajos', icon: '⚙️', kw: 'jobs async ejecución progreso' },

  terminal: { label: 'Terminal Kali', icon: '🖥️', kw: 'shell pty consola runtime kali' },
  proxy: { label: 'Proxy', icon: '🛰️', kw: 'proxy mitm interceptar http history' },
  repeater: { label: 'Repeater', icon: '🔁', kw: 'repeater manipular reenviar petición' },
  gates: { label: 'Compuertas', icon: '✅', kw: 'gates validación pre-envío' },
  revocation: { label: 'Revocación A/B', icon: '⛔', kw: 'ab revocar credenciales' },
  nuclei: { label: 'Nuclei Scanner', icon: '🛡️', kw: 'nuclei plantillas escáner' },
  oast: { label: 'OAST', icon: '📡', kw: 'oast callback ssrf out-of-band' },

  assistant: { label: 'KNK Assistant', icon: '🤖', kw: 'ia copiloto voz cerebro chat conversacion' },
  vault: { label: 'Bóveda', icon: '📚', kw: 'obsidian notas conocimiento' },
  osint: { label: 'OSINT Hub', icon: '🌐', kw: 'shodan geoint tools account osint cámaras índices expuestas fofa zoomeye netlas censys greynoise internetdb' },
  cameras: { label: 'Cámaras · En vivo', icon: '🎥', kw: 'cámaras webcams en vivo insecam windy hls rtsp fuentes público' },
  liligo: { label: 'LILIGO ESP32', icon: '⚡', kw: 'liligo esp32 virtual' },
  'liligo-real': { label: 'LILIGO Serial', icon: '🔌', kw: 'liligo serial puerto hardware' },

  tools: { label: 'Instalar Tools', icon: '🔧', kw: 'instalar herramientas apt osint' },
  clipboard: { label: 'Clipboard', icon: '📋', kw: 'portapapeles historial' },
  alerts: { label: 'Alertas', icon: '🔔', kw: 'alertas notificaciones' },
  cache: { label: 'Cache Offline', icon: '💾', kw: 'cache offline sin conexión' },
  plugins: { label: 'Plugins', icon: '🧩', kw: 'plugins extensiones' },
  team: { label: 'Equipo', icon: '👥', kw: 'equipo miembros roles' },
  tor: { label: 'Red Tor', icon: '🧅', kw: 'tor red anonimato proxy socks' },

  labs: { label: 'Laboratorios VM', icon: '🧪', kw: 'labs vm virtualbox wsl dvwa metasploitable' },

  reportes: { label: 'Reportes', icon: '📝', kw: 'informes export salida pdf' },
  'report-export': { label: 'Exportar Reportes', icon: '📄', kw: 'exportar sarif json markdown' },
  compliance: { label: 'Cumplimiento', icon: '📜', kw: 'políticas compliance legal' },
  cheatsheet: { label: 'Guía manual', icon: '📖', kw: 'cheatsheet comandos ayuda manual' },
};

// Modo BOUNTY (caza) vs LAB (juguetes e infra):
// en BOUNTY se ocultan los módulos que no cazan (hardware, ocio, equipo…).
// El modo vive en localStorage ('knk.mode') y lo conmuta el sidebar.
export const LAB_MODULES = new Set(['liligo', 'liligo-real', 'clipboard', 'cache', 'plugins', 'team']);

export function visibleGroups(mode) {
  if (mode !== 'bounty') return NAV_GROUPS;
  return NAV_GROUPS.map(([group, ids]) => [group, ids.filter((id) => !LAB_MODULES.has(id))])
    .filter(([, ids]) => ids.length > 0);
}

// Lista plana en orden de menú (para la paleta y validaciones).
export const NAV_ORDER = NAV_GROUPS.flatMap(([, ids]) => ids);
