'use strict';

// Gestión local y declarativa de laboratorios. Este módulo no escanea redes ni
// ejecuta comandos suministrados por el usuario: solo usa proveedores y VMs
// previamente configurados por el operador.

const { execFile } = require('child_process');
const os = require('os');

const PROVIDERS = [
  { id: 'virtualbox', label: 'VirtualBox', bin: process.platform === 'win32' ? 'VBoxManage.exe' : 'VBoxManage' },
  { id: 'libvirt', label: 'libvirt / virsh', bin: process.platform === 'win32' ? 'virsh.exe' : 'virsh' },
  { id: 'wsl2', label: 'WSL2', bin: process.platform === 'win32' ? 'wsl.exe' : 'wsl' },
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
    const probe = provider.id === 'wsl2' ? await run(provider.bin, ['--status']) : await run(provider.bin, ['--version']);
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

async function inventory() {
  const [providers, virtualbox, wsl] = await Promise.all([detectProviders(), listVirtualBox(), listWsl()]);
  return { ...providers, machines: [...(virtualbox.machines || []), ...(wsl.machines || [])], catalog: LAB_CATALOG };
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
  return { ok: false, error: 'proveedor no soportado para parada' };
}

module.exports = { PROVIDERS, LAB_CATALOG, detectProviders, inventory, listVirtualBox, listWsl, start, stop };
