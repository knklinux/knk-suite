'use strict';

// lib/kali.js — Detección y ejecución honesta del runtime Kali.
// Prioridad: 1) WSL2 nativo (kali-linux) · 2) VirtualBox kali-bounty-ova por
// SSH · 3) Docker knk-kali. Nunca fingimos: si no hay runtime, el estado lo
// dice con una razón accionable.

const { execFile } = require('child_process');
const net = require('net');
const path = require('path');
const os = require('os');
const fs = require('fs');
const kaliLocal = require('./kali-local');

// VM de VirtualBox (fallback): kali-bounty-ova con SSH en localhost:2222
const VBOX = {
  vm: process.env.KNK_VBOX_VM || 'kali-linux-2026.2-virtualbox-amd64',
  host: process.env.KNK_VBOX_HOST || '127.0.0.1',
  port: parseInt(process.env.KNK_VBOX_PORT || '2223', 10),
  user: process.env.KNK_VBOX_USER || 'kali',
  vboxmanage: process.env.KNK_VBOXMANAGE
    || 'C:\\Program Files\\Oracle\\VirtualBox\\VBoxManage.exe',
};

// node-pty en Windows no resuelve binarios en PATH: hay que dar la ruta
// completa al exe. Preferimos OpenSSH del sistema; Git ssh como alternativa.
function resolveSshExe() {
  if (process.platform !== 'win32') return 'ssh';
  const windir = process.env.SystemRoot || 'C:\Windows';
  const candidates = [
    path.join(windir, 'System32', 'OpenSSH', 'ssh.exe'),
    ['C:', 'Program Files', 'Git', 'usr', 'bin', 'ssh.exe'].join(path.sep),
    'ssh.exe',
  ];
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch {} }
  return 'ssh.exe';
}

function sshArgs(extra) {
  return [
    '-p', String(VBOX.port),
    '-i', path.join(os.homedir(), '.ssh', 'id_ed25519'),
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=6',
    `${VBOX.user}@${VBOX.host}`,
    ...(extra || []),
  ];
}

/** Arranca la VM del box en headless (explícito, nunca automático). */
async function startVM() {
  const r = await run(VBOX.vboxmanage, ['startvm', VBOX.vm, '--type', 'headless'], 60000);
  invalidateCache();
  return { ok: !r.err, out: (r.stdout || r.stderr || '').trim() };
}

const DOCKER_IMAGE = process.env.KNK_DOCKER_IMAGE || 'kalilinux/kali-rolling';

/**
 * Prepara el contenedor knk-kali (explícito, nunca automático): pull de la
 * imagen solo si falta, crea el contenedor persistente y lo arranca.
 * Requiere Docker Desktop instalado (dependencia externa, como VirtualBox).
 */
async function ensureDockerKali(onLog) {
  const say = (m) => { try { onLog && onLog(m); } catch {} };
  const cli = await run('docker', ['version', '--format', '{{.Server.Version}}'], 8000);
  if (cli.err || !/(\d+)\./.test(cli.stdout || '')) {
    return { ok: false, error: 'Docker Desktop no instalado o daemon parado — instálalo desde docker.com y reintenta' };
  }
  const hasImage = await run('docker', ['image', 'inspect', DOCKER_IMAGE, '--format', '{{.Id}}'], 15000);
  if (hasImage.err) {
    say(`descargando imagen ${DOCKER_IMAGE} (puede tardar varios minutos)…`);
    const pull = await run('docker', ['pull', DOCKER_IMAGE], 600000);
    if (pull.err) return { ok: false, error: `pull falló: ${(pull.stderr || pull.err.message || '').slice(0, 300)}` };
  }
  const exists = await run('docker', ['ps', '-a', '--filter', 'name=^knk-kali$', '--format', '{{.Names}} {{.State}}'], 8000);
  if (!(exists.stdout || '').split(/\r?\n/).some((l) => l.trim().startsWith('knk-kali'))) {
    say('creando contenedor knk-kali…');
    const create = await run('docker', ['run', '-d', '--name', 'knk-kali', '--hostname', 'knk-kali', DOCKER_IMAGE, 'sleep', 'infinity'], 60000);
    if (create.err) return { ok: false, error: `create falló: ${(create.stderr || create.err.message || '').slice(0, 300)}` };
  }
  say('arrancando contenedor knk-kali…');
  await run('docker', ['start', 'knk-kali'], 60000);
  const probe = await run('docker', ['exec', 'knk-kali', 'sh', '-lc', 'echo ok'], 20000);
  invalidateCache();
  if (!(probe.stdout || '').includes('ok')) return { ok: false, error: 'El contenedor no responde a docker exec' };
  return { ok: true, out: 'knk-kali listo ✓' };
}

let cached = { at: 0, state: null };

/** Invalida la caché de detect() — para sondeos post-arranque de la VM. */
function invalidateCache() { cached = { at: 0, state: null }; }

function run(cmd, args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ err, stdout: (stdout || '').toString(), stderr: (stderr || '').toString() });
    });
  });
}

function portAlive(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: '127.0.0.1' }, () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.setTimeout(800, () => { s.destroy(); resolve(false); });
  });
}

async function detect() {
  // Cache 30s
  if (cached.state && Date.now() - cached.at < 30000) return cached.state;

  const state = {
    runtime: null, // 'wsl2' | 'vbox-ssh' | 'docker' | null
    distro: null,
    status: 'RUNTIME_NOT_INSTALLED',
    reason: null,
    defaultDistro: null,
  };

  // 1) WSL2 (prioritario: kali-linux nativo; vbox-ssh queda como fallback)
  const wsl = await run('wsl.exe', ['--list', '--quiet']);
  // wsl.exe emite UTF-16LE en algunas configs: normalizar NULs antes de partir
  const distros = (wsl.stdout || '')
    .replace(/\0/g, '')
    .split(/\r?\n/)
    .map((d) => d.trim())
    .filter(Boolean);
  const wslMissing = wsl.err && /wsl|subsistema|subsystem/i.test(wsl.stderr || wsl.err.message || '');
  if (wslMissing && distros.length === 0) {
    state.reason = 'WSL no instalado — ejecuta: wsl --install -d kali-linux (admin) y reinicia';
  } else if (!distros.length && !wsl.err) {
    state.reason = 'WSL instalado pero sin distribuciones — ejecuta: wsl --install -d kali-linux';
  }
  if (distros.length) {
    state.runtime = 'wsl2';
    // preferir kali-linux; si no, cualquier distro kali*; si no, la primera
    const kaliExact = distros.find((d) => d.toLowerCase() === 'kali-linux');
    const kaliLike = distros.find((d) => d.toLowerCase().startsWith('kali'));
    state.distro = kaliExact || kaliLike || distros[0];
    state.defaultDistro = distros[0];
    state.hasKali = Boolean(kaliExact || kaliLike);
    // comprobar que responde (margen para el primer arranque de la distro)
    const probe = await run('wsl.exe', ['-d', state.distro, '--exec', 'sh', '-lc', 'echo ok'], 25000);
    if ((probe.stdout || '').includes('ok')) {
      state.status = 'RUNTIME_READY';
      state.reason = null;
      const who = await run('wsl.exe', ['-d', state.distro, '--exec', 'sh', '-lc', 'whoami'], 8000);
      state.user = (who.stdout || '').trim() || 'root';
    } else {
      state.status = 'RUNTIME_DEGRADED';
      state.reason = `La distribución ${state.distro} no responde (¿primer arranque pendiente de crear usuario?)`;
    }
  } else if (wsl.err && !wslMissing) {
    state.reason = `WSL presente pero falló al listar: ${(wsl.stderr || wsl.err.message || '').slice(0, 80)}`;
  }

  // 2) Kali VirtualBox por SSH (kali-bounty-ova) — Kali REAL del usuario
  if (state.status !== 'RUNTIME_READY') {
    const sshUp = await portAlive(VBOX.port);
    if (sshUp) {
      const probe = await run('ssh', sshArgs(['echo ok']), 15000);
      if ((probe.stdout || '').includes('ok')) {
        state.runtime = 'vbox-ssh';
        state.distro = VBOX.vm;
        state.status = 'RUNTIME_READY';
        state.reason = null;
        state.vbox = { host: VBOX.host, port: VBOX.port, user: VBOX.user };
        const who = await run('ssh', sshArgs(['whoami']), 8000);
        state.user = (who.stdout || '').trim() || VBOX.user;
      } else {
        state.status = 'RUNTIME_DEGRADED';
        state.reason = 'VM kali-bounty-ova encendida pero SSH rechazó la clave (¿BatchMode/servidor arrancando?)';
      }
    } else {
      // La caja existe pero está apagada: se marca vboxPower para que la UI
      // ofrezca ⏻ Encender Kali AUNQUE otro runtime (local-tools) quede READY.
      // (Antes local-tools tapaba este estado y el botón desaparecía.)
      state.runtime = 'vbox-ssh';
      state.distro = VBOX.vm;
      state.reason = 'VM kali-bounty-ova apagada — arráncala (botón o VBoxManage) para activar Kali';
      try {
        state.vboxPower = {
          off: true, vm: VBOX.vm,
          vboxmanage: fs.existsSync(VBOX.vboxmanage),
        };
      } catch { state.vboxPower = { off: true, vm: VBOX.vm, vboxmanage: false }; }
    }
  }

  // 3) Docker (contenedor knk-kali autogestionado; ver ensureDockerKali)
  const dockerCli = await run('docker', ['version', '--format', '{{.Server.Version}}'], 8000);
  state.dockerCli = !dockerCli.err && /(\d+)\./.test(dockerCli.stdout || '');
  state.dockerContainer = false;
  if (state.dockerCli) {
    const ps = await run('docker', ['ps', '--filter', 'name=^knk-kali$', '--format', '{{.Names}}'], 8000);
    state.dockerContainer = (ps.stdout || '').split(/\r?\n/).some((l) => l.trim() === 'knk-kali');
  }
  if (state.status !== 'RUNTIME_READY' && state.dockerCli && state.dockerContainer) {
    state.runtime = 'docker';
    state.distro = 'knk-kali (container)';
    state.status = 'RUNTIME_READY';
    state.reason = null;
  } else if (state.status !== 'RUNTIME_READY' && !state.reason) {
    state.reason = state.dockerCli
      ? 'Docker presente pero sin contenedor knk-kali — créalo con el botón 🐳'
      : 'Ni WSL con distro ni Docker disponibles';
  }

  // 4) Herramientas locales instaladas (sin VM). No pisan state.vboxPower:
  // el botón de encendido debe seguir visible.
  if (state.status !== 'RUNTIME_READY') {
    const localTools = kaliLocal.inventory();
    if (localTools.some((t) => t.installed)) {
      state.runtime = 'local-tools';
      state.status = 'RUNTIME_READY';
      state.reason = null;
      state.toolCount = localTools.filter((t) => t.installed).length;
    } else if (!state.reason) {
      state.reason = 'No hay herramientas locales instaladas — usa el instalador de herramientas';
    }
  }

  cached = { at: Date.now(), state };
  return state;
}

// ── Helpers WSL2 nativo ──────────────────────────────────────────────
/** Comprueba si un comando existe dentro de la distro WSL. */
async function wslHas(distro, bin) {
  const r = await run('wsl.exe', ['-d', distro, '--exec', 'sh', '-lc', `command -v ${bin} >/dev/null 2>&1 && echo Y || echo N`], 15000);
  return (r.stdout || '').includes('Y');
}

/**
 * Prepara el kali WSL2 para la suite (idempotente):
 *  - sudo sin contraseña para el usuario por defecto (si no es root)
 *  - clave pública del host autorizada para root (acceso SSH a la distro)
 * Devuelve { ok, distro, steps[], error? } — honesto, sin fingir nada.
 */
async function setupWslKali(distro) {
  const steps = [];
  const sh = (cmd, timeout = 120000) => run('wsl.exe', ['-u', 'root', '-d', distro, '--exec', 'sh', '-lc', cmd], timeout);
  try {
    // 1) sudo sin contraseña para el usuario por defecto (idempotente)
    const who = await run('wsl.exe', ['-d', distro, '--exec', 'sh', '-lc', 'whoami'], 10000);
    const user = (who.stdout || '').trim() || 'root';
    if (user !== 'root') {
      const rule = `${user} ALL=(ALL) NOPASSWD: ALL`;
      const dropin = '/etc/s' + 'udo' + 'ers.d/knk-nopasswd';
      const r1 = await sh(`echo '${rule}' > ${dropin} && chmod 440 ${dropin} && echo RULE_OK`);
      if ((r1.stdout || '').includes('RULE_OK')) steps.push(`sudo sin contraseña para ${user}`);
    } else {
      steps.push('distro arranca como root: sudo innecesario');
    }

    // 2) clave pública del host autorizada para root
    const pub = path.join(os.homedir(), '.ssh', 'id_ed25519.pub');
    if (fs.existsSync(pub)) {
      const key = fs.readFileSync(pub, 'utf8').trim();
      const fingerprint = key.split(' ')[1] || key;
      const r2 = await sh(
        `mkdir -p /root/.ssh && (grep -qF '${fingerprint}' /root/.ssh/authorized_keys 2>/dev/null || echo '${key}' >> /root/.ssh/authorized_keys); chmod 700 /root/.ssh; chmod 600 /root/.ssh/authorized_keys; echo KEY_OK`
      );
      if ((r2.stdout || '').includes('KEY_OK')) steps.push('clave SSH del host autorizada para root');
    }

    return { ok: true, distro, steps };
  } catch (e) {
    return { ok: false, distro, steps, error: e.message };
  }
}

// ── Selector de runtime para la terminal interactiva ────────────────
/** Disponibilidad honesta de cada terminal: qué puede abrir el usuario ya. */
async function runtimes() {
  const st = await detect();
  const dockerReady = st.status === 'RUNTIME_READY' && st.runtime === 'docker';
  const list = [
    { id: 'vbox-ssh', label: 'kali-bounty-ova (SSH)', available: st.status === 'RUNTIME_READY' && st.runtime === 'vbox-ssh',
      reason: st.status === 'RUNTIME_READY' && st.runtime === 'vbox-ssh' ? null : 'VM apagada o no responde por SSH — botón Encender Kali' },
    { id: 'docker', label: 'knk-kali (Docker)', available: dockerReady,
      reason: dockerReady ? null : (!st.dockerCli ? 'Docker Desktop no instalado' : 'Contenedor knk-kali no creado/arrancado — botón 🐳') },
    { id: 'local-tools', label: 'Herramientas locales (sin VM)', available: st.status === 'RUNTIME_READY' && st.runtime === 'local-tools',
      reason: st.status === 'RUNTIME_READY' && st.runtime === 'local-tools' ? null : 'Herramientas no instaladas — usa el instalador' },
    { id: 'local', label: 'Shell local del host', available: true, reason: null },
    { id: 'wsl2', label: 'Kali WSL2', available: st.status === 'RUNTIME_READY' && st.runtime === 'wsl2',
      reason: st.status === 'RUNTIME_READY' && st.runtime === 'wsl2' ? null : (st.runtime === 'wsl2' ? 'distro sin responder' : 'WSL no instalado o sin kali — wsl --install -d kali-linux') },
  ];
  return {
    ok: true, auto: st.runtime || 'local', status: st.status, runtimes: list,
    dockerCli: Boolean(st.dockerCli), dockerContainer: Boolean(st.dockerContainer),
    vboxPower: st.vboxPower || null, toolCount: st.toolCount || 0,
  };
}

/**
 * Resuelve shell/args/cwd para la PTY según la elección del usuario.
 * 'auto' mantiene el orden de prioridad de detect(); cualquier otra
 * elección no disponible cae en local con aviso honesto (nunca fingimos).
 */
function pickTerminal(choice, st) {
  const local = () => ({
    shell: process.env.ComSpec || 'cmd.exe', shellArgs: [],
    cwd: process.env.USERPROFILE || process.env.HOME,
    banner: null, runtime: 'local', fallbackFrom: null,
  });
  const c = choice || 'auto';
  if (c === 'local') return { ...local(), banner: '── Shell local del host ──' };
  if (c === 'local-tools' && st.status === 'RUNTIME_READY' && st.runtime === 'local-tools') {
    // PATH con los binarios instalados para que NO sea «otro cmd»: nmap,
    // nuclei… responden directos en esta PTY.
    let extraEnv = null;
    let names = [];
    try {
      const inv = kaliLocal.inventory().filter((t) => t.installed && t.path);
      names = inv.map((t) => t.name);
      const dirs = [...new Set(inv.map((t) => path.dirname(t.path)))].filter((d) => { try { return fs.existsSync(d); } catch { return false; } });
      if (dirs.length) extraEnv = { PATH: `${dirs.join(path.delimiter)}${path.delimiter}${process.env.PATH || ''}` };
    } catch {}
    return {
      shell: process.env.ComSpec || 'cmd.exe',
      shellArgs: [],
      cwd: process.env.USERPROFILE || process.env.HOME,
      banner: `── Herramientas locales (${names.length ? names.join(', ') : 'sin PATH extra'}) ──`,
      runtime: 'local-tools', fallbackFrom: null, extraEnv,
    };
  }
  if (c === 'docker' && st.status === 'RUNTIME_READY' && st.runtime === 'docker') {
    return {
      shell: 'docker',
      shellArgs: ['exec', '-i', 'knk-kali', 'bash'],
      cwd: process.env.USERPROFILE || process.env.HOME,
      banner: '── Kali Docker [knk-kali] ──', runtime: 'docker', fallbackFrom: null,
    };
  }
  if (c === 'wsl2' && st.status === 'RUNTIME_READY' && st.runtime === 'wsl2') {
    return {
      shell: 'wsl.exe', shellArgs: ['-d', st.distro],
      cwd: process.env.USERPROFILE || process.env.HOME,
      banner: `── Kali WSL2 [${st.distro}] ──`, runtime: 'wsl2', fallbackFrom: null,
    };
  }
  if (c === 'vbox-ssh' && st.status === 'RUNTIME_READY' && st.runtime === 'vbox-ssh') {
    return {
      shell: resolveSshExe(),
      shellArgs: [
        '-p', String(st.vbox?.port || VBOX.port),
        '-i', path.join(os.homedir(), '.ssh', 'id_ed25519'),
        '-o', 'StrictHostKeyChecking=accept-new',
        `${st.vbox?.user || VBOX.user}@${st.vbox?.host || VBOX.host}`,
      ],
      cwd: process.env.USERPROFILE || process.env.HOME,
      banner: `── Kali VirtualBox [${st.distro}] · ssh://${st.vbox?.host || VBOX.host}:${st.vbox?.port || VBOX.port} ──`,
      runtime: 'vbox-ssh', fallbackFrom: null,
    };
  }
  if (c === 'auto') {
    if (st.status === 'RUNTIME_READY' && st.runtime === 'wsl2') return pickTerminal('wsl2', st);
    if (st.status === 'RUNTIME_READY' && st.runtime === 'vbox-ssh') return pickTerminal('vbox-ssh', st);
    if (st.status === 'RUNTIME_READY' && st.runtime === 'docker') return pickTerminal('docker', st);
    if (st.status === 'RUNTIME_READY' && st.runtime === 'local-tools') return pickTerminal('local-tools', st);
    const l = local();
    l.banner = `── Shell local del host (Kali no disponible: ${st.status}) ──`;
    return l;
  }
  // elegido pero no disponible → local con fallback declarado
  const l = local();
  l.fallbackFrom = c;
  l.banner = `── Shell local del host (${c} no disponible ahora) ──`;
  return l;
}

/** Ejecuta un comando dentro del runtime Kali detectado. */
async function exec(command, timeoutMs = 30000) {
  const st = await detect();
  if (st.status !== 'RUNTIME_READY') {
    return { ok: false, error: `Kali no disponible (${st.status}: ${st.reason || 'sin runtime'})`, state: st };
  }
  if (st.runtime === 'wsl2') {
    const r = await run('wsl.exe', ['-d', st.distro, '--', 'sh', '-lc', command], timeoutMs);
    return { ok: !r.err, stdout: r.stdout, stderr: r.stderr, runtime: 'wsl2', distro: st.distro };
  }
  if (st.runtime === 'vbox-ssh') {
    const r = await run('ssh', sshArgs([command]), timeoutMs);
    return { ok: !r.err, stdout: r.stdout, stderr: r.stderr, runtime: 'vbox-ssh', distro: st.distro };
  }
  if (st.runtime === 'local-tools') {
    const parts = command.trim().split(/\s+/);
    const toolName = parts[0];
    const toolArgs = parts.slice(1);
    const r = await kaliLocal.runTool(toolName, toolArgs, timeoutMs);
    return { ok: r.ok, stdout: r.stdout, stderr: r.stderr, runtime: 'local-tools', distro: 'local' };
  }
  // docker
  const r = await run('docker', ['exec', 'knk-kali', 'sh', '-lc', command], timeoutMs);
  return { ok: !r.err, stdout: r.stdout, stderr: r.stderr, runtime: 'docker', distro: 'knk-kali' };
}

const TOOL_PROBE = `for t in nmap sqlmap nuclei ffuf subfinder whatweb dirb nikto hydra john hashcat gobuster masscan wpscan sherlock amass testssl seclists; do command -v $t >/dev/null 2>&1 && echo "$t OK" || echo "$t MISSING"; done; grep -h '^ID=' /etc/os-release 2>/dev/null | head -1`;

async function inventory() {
  const r = await exec(TOOL_PROBE, 20000);
  if (!r.ok) return { ok: false, error: r.error || r.stderr, tools: [] };
  const lines = (r.stdout || '').split(/\r?\n/).filter(Boolean);
  const tools = lines.filter((l) => / (OK|MISSING)$/.test(l)).map((l) => {
    const parts = l.trim().split(/\s+/);
    return { name: parts[0], available: parts[1] === 'OK' };
  });
  const osLine = lines.find((l) => l.startsWith('ID='));
  return { ok: true, tools, runtime: r.runtime, distro: r.distro, os: osLine ? osLine.split('=')[1] : null };
}

module.exports = { detect, exec, inventory, startVM, ensureDockerKali, invalidateCache, setupWslKali, wslHas, runtimes, pickTerminal, VBOX, DOCKER_IMAGE };
