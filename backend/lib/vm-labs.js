'use strict';

// Gestión local y declarativa de laboratorios. Este módulo no escanea redes ni
// ejecuta comandos suministrados por el usuario: solo usa proveedores y VMs
// previamente configurados por el operador.

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Ruta absoluta primero (no depende del PATH), con fallback al bare name.
// Igual criterio que lib/kali.js (KNK_VBOXMANAGE > abs > PATH).
function resolveBin(winAbs, bare) {
  if (process.env.KNK_VBOXMANAGE) return process.env.KNK_VBOXMANAGE;
  if (process.platform === 'win32') {
    try { if (fs.existsSync(winAbs)) return winAbs; } catch {}
  }
  return bare;
}

const PROVIDERS = [
  { id: 'virtualbox', label: 'VirtualBox', bin: resolveBin('C:\\Program Files\\Oracle\\VirtualBox\\VBoxManage.exe', process.platform === 'win32' ? 'VBoxManage.exe' : 'VBoxManage') },
  { id: 'libvirt', label: 'libvirt / virsh', bin: process.platform === 'win32' ? 'virsh.exe' : 'virsh' },
  { id: 'wsl2', label: 'WSL2', bin: process.platform === 'win32' ? 'wsl.exe' : 'wsl' },
  { id: 'docker', label: 'Docker', bin: process.platform === 'win32' ? 'docker.exe' : 'docker' },
];

const LAB_CATALOG = [
  { id: 'kali', name: 'Kali Linux', provider: 'wsl2', image: 'kali-linux', purpose: 'toolkit y terminal aislada', status: 'detectable' },
  { id: 'metasploitable', name: 'Metasploitable 2', provider: 'virtualbox', image: 'metasploitable2', purpose: 'laboratorio vulnerable local', status: 'manual-import' },
  { id: 'owasp-bwa', name: 'OWASP Broken Web Apps', provider: 'virtualbox', image: 'owasp-bwa', purpose: 'web security training', status: 'manual-import' },
  { id: 'dvwa', name: 'DVWA', provider: 'docker', image: 'vulnerables/web-dvwa', purpose: 'web security training', status: 'docker-compose' },
];

function run(bin, args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout || ''), stderr: String(stderr || ''), error: error?.message || null });
    });
  });
}

async function detectProviders() {
  const results = await Promise.all(PROVIDERS.map(async (provider) => {
    const probe = provider.id === 'wsl2' ? await run(provider.bin, ['--status'])
      : provider.id === 'docker' ? await run(provider.bin, ['info', '--format', '{{.ServerVersion}}'])
      : await run(provider.bin, ['--version']);
    return { ...provider, installed: probe.ok, detail: (probe.stdout || probe.stderr || probe.error || '').trim().slice(0, 180) };
  }));
  return { ok: true, host: os.platform(), arch: os.arch(), providers: results, checkedAt: new Date().toISOString() };
}

async function listVirtualBox() {
  const provider = PROVIDERS.find((item) => item.id === 'virtualbox');
  const result = await run(provider.bin, ['list', 'vms']);
  if (!result.ok) return { ok: false, provider: provider.id, error: result.error || result.stderr, machines: [] };
  const machines = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const match = line.match(/^"([^"]+)"\s+\{([^}]+)\}$/);
    return match ? { name: match[1], id: match[2], provider: 'virtualbox' } : null;
  }).filter(Boolean);
  return { ok: true, provider: provider.id, machines };
}

async function listWsl() {
  const provider = PROVIDERS.find((item) => item.id === 'wsl2');
  const result = await run(provider.bin, ['--list', '--verbose']);
  if (!result.ok) return { ok: false, provider: provider.id, error: result.error || result.stderr, machines: [] };
  const machines = result.stdout.replace(/\0/g, '').split(/\r?\n/).slice(1).map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.replace(/^\*\s*/, '').split(/\s{2,}/);
    return { name: parts[0], state: parts[1] || 'unknown', version: parts[2] || null, provider: 'wsl2' };
  });
  return { ok: true, provider: provider.id, machines };
}

async function listDocker() {
  const provider = PROVIDERS.find((item) => item.id === 'docker');
  const result = await run(provider.bin, ['ps', '--all', '--format', '{{.Names}}\t{{.Image}}\t{{.Status}}']);
  if (!result.ok) return { ok: false, provider: provider.id, error: result.error || result.stderr, machines: [] };
  const machines = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, image, status] = line.split('\t');
    return name ? { name, image: image || null, state: status || 'unknown', provider: 'docker' } : null;
  }).filter(Boolean);
  return { ok: true, provider: provider.id, machines };
}

function dockerContainerFor(machine) {
  // Una VM de laboratorio corre como contenedor "knklab-<id>" para separar
  // los contenedores del laboratorio del resto de contenedores del host.
  return `knklab-${String(machine).trim().toLowerCase()}`;
}

async function inventory() {
  const [providers, virtualbox, wsl, docker] = await Promise.all([detectProviders(), listVirtualBox(), listWsl(), listDocker()]);
  return {
    ...providers,
    machines: [...(virtualbox.machines || []), ...(wsl.machines || []), ...(docker.machines || [])],
    catalog: LAB_CATALOG,
  };
}

async function start(machine) {
  if (!machine || typeof machine !== 'string' || !/^[a-zA-Z0-9._ -]{1,100}$/.test(machine)) return { ok: false, error: 'nombre de VM inválido' };
  const inventoryState = await inventory();
  const known = inventoryState.machines.find((item) => item.name === machine);
  if (!known) return { ok: false, error: 'la VM no está en el inventario local' };
  if (known.provider === 'virtualbox') {
    const provider = PROVIDERS.find((item) => item.id === 'virtualbox');
    const result = await run(provider.bin, ['startvm', known.name, '--type', 'headless'], 60000);
    return { ok: result.ok, provider: known.provider, machine, output: (result.stdout || result.stderr).slice(0, 500) };
  }
  if (known.provider === 'wsl2') {
    const provider = PROVIDERS.find((item) => item.id === 'wsl2');
    const result = await run(provider.bin, ['-d', known.name, '--exec', 'true'], 30000);
    return { ok: result.ok, provider: known.provider, machine, output: (result.stdout || result.stderr).slice(0, 500) };
  }
  if (known.provider === 'docker') {
    const provider = PROVIDERS.find((item) => item.id === 'docker');
    const result = await run(provider.bin, ['start', known.name], 30000);
    return { ok: result.ok, provider: known.provider, machine, output: (result.stdout || result.stderr).slice(0, 500) };
  }
  return { ok: false, error: 'proveedor no soportado para arranque' };
}

async function stop(machine) {
  if (!machine || typeof machine !== 'string' || !/^[a-zA-Z0-9._ -]{1,100}$/.test(machine)) return { ok: false, error: 'nombre de VM inválido' };
  const inventoryState = await inventory();
  const known = inventoryState.machines.find((item) => item.name === machine);
  if (!known) return { ok: false, error: 'la VM no está en el inventario local' };
  if (known.provider === 'virtualbox') {
    const provider = PROVIDERS.find((item) => item.id === 'virtualbox');
    const result = await run(provider.bin, ['controlvm', known.name, 'acpipowerbutton'], 30000);
    return { ok: result.ok, provider: known.provider, machine, output: (result.stdout || result.stderr).slice(0, 500) };
  }
  if (known.provider === 'wsl2') {
    const provider = PROVIDERS.find((item) => item.id === 'wsl2');
    const result = await run(provider.bin, ['--terminate', known.name], 30000);
    return { ok: result.ok, provider: known.provider, machine, output: (result.stdout || result.stderr).slice(0, 500) };
  }
  if (known.provider === 'docker') {
    const provider = PROVIDERS.find((item) => item.id === 'docker');
    const result = await run(provider.bin, ['stop', known.name], 30000);
    return { ok: result.ok, provider: known.provider, machine, output: (result.stdout || result.stderr).slice(0, 500) };
  }
  return { ok: false, error: 'proveedor no soportado para parada' };
}

// Catálogo → acción concreta por proveedor. Solo acepta ids del catálogo local
// (nunca entrada libre del operador) y usa nombres prefijados para contenedores.
async function provision(labId) {
  const lab = LAB_CATALOG.find((item) => item.id === labId);
  if (!lab) return { ok: false, error: 'lab desconocido' };
  if (lab.provider === 'docker') {
    const provider = PROVIDERS.find((item) => item.id === 'docker');
    const container = dockerContainerFor(lab.id);
    const probe = await run(provider.bin, ['ps', '--all', '--format', '{{.Names}}']);
    if (probe.ok && probe.stdout.split(/\r?\n/).includes(container)) {
      const started = await run(provider.bin, ['start', container], 60000);
      return { ok: started.ok, provider: lab.provider, labId, container, reused: true, output: (started.stdout || started.stderr).slice(0, 500) };
    }
    const created = await run(provider.bin, ['run', '-d', '--name', container, '-p', '127.0.0.1::80', lab.image], 120000);
    return { ok: created.ok, provider: lab.provider, labId, container, reused: false, output: (created.stdout || created.stderr).slice(0, 500) };
  }
  return { ok: false, error: `provisión automática no disponible para ${lab.provider}; importa la VM manualmente` };
}

async function deprovision(labId) {
  const lab = LAB_CATALOG.find((item) => item.id === labId);
  if (!lab) return { ok: false, error: 'lab desconocido' };
  if (lab.provider === 'docker') {
    const provider = PROVIDERS.find((item) => item.id === 'docker');
    const container = dockerContainerFor(lab.id);
    const removed = await run(provider.bin, ['rm', '-f', container], 30000);
    return { ok: removed.ok, provider: lab.provider, labId, container, output: (removed.stdout || removed.stderr).slice(0, 500) };
  }
  return { ok: false, error: `retirada automática no disponible para ${lab.provider}` };
}

module.exports = { PROVIDERS, LAB_CATALOG, detectProviders, inventory, listVirtualBox, listWsl, listDocker, start, stop, provision, deprovision };
