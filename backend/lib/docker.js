'use strict';

const { spawnSync } = require('child_process');
const CONTAINER = process.env.KNK_KALI_CONTAINER || 'knk-kali';
const VALID_CONTAINER = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\\"'\\\"'")}'`;
}

function safeContainer() {
  return VALID_CONTAINER.test(CONTAINER) ? CONTAINER : null;
}

function safeContainerName() {
  return safeContainer();
}

function splitArgs(value) {
  if (Array.isArray(value)) return value.map(String);
  const text = String(value || '').trim();
  return text ? text.split(/\s+/) : [];
}

// Linux images may require `sg docker`; Windows/macOS Docker Desktop uses the
// docker CLI directly. Keeping this decision in one helper prevents the
// terminal from being marked broken solely because `sg` does not exist.
function runDocker(args, opts = {}) {
  const timeout = opts.timeoutMs || 5000;
  const list = Array.isArray(args) ? args.map(String) : [];
  if (process.platform === 'win32' || process.env.KNK_DOCKER_DIRECT === '1') {
    return spawnSync('docker', list, {
      encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe']
    });
  }
  const command = ['docker', ...list].map(shellQuote).join(' ');
  return spawnSync('sg', ['docker', '-c', command], {
    encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe']
  });
}

function dockerAvailable() {
  try {
    const r = runDocker(['version', '--format', '{{.Server.Version}}'], { timeoutMs: 3000 });
    return !r.error && r.status === 0;
  } catch { return false; }
}

function isRunning() {
  const container = safeContainer();
  if (!container) return false;
  try {
    const r = runDocker(['inspect', '-f', '{{.State.Running}}', container], { timeoutMs: 5000 });
    return !r.error && r.status === 0 && String(r.stdout || '').trim() === 'true';
  } catch { return false; }
}
function exec(tool, args, opts = {}) {
  const timeout = Math.min(opts.timeoutMs || 10000, 10000); // hard cap 10s
  const toolMap = { httpx: 'httpx-toolkit' };
  const binary = toolMap[tool] || tool;
  // Endurecimiento: el binario debe ser un nombre simple y los args no pueden
  // empezar por un comando destructivo (defensa en profundidad tras el filtro
  // del endpoint HTTP).
  if (!/^[a-zA-Z0-9._/-]+$/.test(binary)) {
    return { ok: false, output: 'Herramienta no válida', missing: false };
  }
  if (/^(?:sqlmap(?:\.py)?|ghauri)$/i.test(binary)) {
    return { ok: false, output: 'SQLi automatizada bloqueada por política', missing: false };
  }
  const argsStr = String(args || '').trim();
  if (/[\x00-\x1f\x7f`$;&|<>(){}[\]]/.test(argsStr)) {
    return { ok: false, output: 'Argumentos no permitidos por política', missing: false };
  }
  if (/^(rm|rmdir|dd|mkfs|shutdown|reboot|poweroff|halt|init|telinit|fdisk|parted)\b/.test(argsStr)) {
    return { ok: false, output: 'Comando bloqueado por política', missing: false };
  }
  // Defensa en profundidad: Docker no puede convertirse en una ruta paralela
  // para ejecutar reconocimiento o scanning externo sin el limiter/scope del
  // pipeline. Solo se permiten herramientas de red cuando el caller declara
  // explícitamente un laboratorio local; la API HTTP no concede ese flag.
  const activeNetworkTool = /(?:^|[\s,])(?:nmap|masscan|ffuf|wfuzz|gobuster|dirb|feroxbuster|nuclei|sqlmap(?:\.py)?|ghauri|hydra|medusa|nikto|curl|wget|nc|netcat|socat|traceroute|ping|openssl|telnet|dig|host|nslookup|whois|amass|subfinder|dnsrecon|theHarvester|whatweb|httpx|arjun|katana|hakrawler)(?:[\s,]|$)/i.test(`${binary} ${argsStr}`);
  if (activeNetworkTool && opts.localOnly !== true) {
    return { ok: false, output: 'Herramienta de red bloqueada en Docker: usa el pipeline con scope, autorización y limiter global', missing: false };
  }
  if (/(?:^|[\s,])(?:sqlmap(?:\.py)?|ghauri)(?:[\s,]|$)/i.test(argsStr)) {
    return { ok: false, output: 'SQLi automatizada bloqueada por política', missing: false };
  }
  const container = safeContainer();
  if (!container) return { ok: false, output: 'Contenedor no válido', missing: false };
  const argList = splitArgs(args);
  const dockerExecCmd = ['docker', 'exec', container, binary, ...argList].map(shellQuote).join(' ');

  try {
    const r = runDocker(['exec', container, binary, ...argList], {
      timeoutMs: timeout,
      maxBuffer: 2 * 1024 * 1024,
      killSignal: 'SIGKILL',
    });
    const out = (r.stdout || '').trim();
    if (r.error && !out) return { ok: false, output: String(r.error.message || ''), missing: true };
    if (r.status !== 0) return { ok: false, output: out || String(r.stderr || '').trim(), missing: false };
    return { ok: true, output: out };
  } catch (e) {
    return { ok: false, output: String(e.message || '').slice(0, 200), missing: false };
  }
}
function ensureRunning() {
  if (isRunning()) return true;
  const container = safeContainer();
  if (!container) return false;
  try {
    const r = runDocker(['start', container], { timeoutMs: 30000 });
    return !r.error && (r.status === 0 || isRunning());
  } catch { return false; }
}

function status() {
  const available = dockerAvailable();
  const running = available && isRunning();
  return {
    available,
    running,
    container: safeContainer(),
    platform: process.platform,
    reason: !available ? 'Docker CLI/daemon no disponible' : (!running ? 'El contenedor KNK Kali no está iniciado' : null),
  };
}

module.exports = { CONTAINER, safeContainerName, dockerAvailable, isRunning, status, exec, ensureRunning };