'use strict';

// Auditoría defensiva de cámaras en una red propia/laboratorio.
// No acepta IPs públicas, no hace login, no prueba credenciales y limita el
// número de hosts/puertos. El resultado es exposición observada, no una prueba
// de vulnerabilidad ni permiso para acceder a una cámara.

const net = require('net');
const dns = require('dns').promises;

const DEFAULT_PORTS = [80, 443, 554, 8000, 8080, 8899];
const CAMERA_PORTS = new Set(DEFAULT_PORTS);
const MAX_HOSTS = 256;
const MAX_PORTS = 12;
const MAX_CONCURRENCY = 16;
const TIMEOUT_MS = 900;

function ipv4Parts(value) {
  if (net.isIP(String(value)) !== 4) return null;
  const parts = String(value).split('.').map(Number);
  return parts.every((part) => part >= 0 && part <= 255) ? parts : null;
}

function privateIp(value) {
  const text = String(value || '').toLowerCase();
  const parts = ipv4Parts(text);
  if (parts) {
    const [a, b] = parts;
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (net.isIP(text) === 6) {
    return text === '::1' || text.startsWith('fc') || text.startsWith('fd') || text.startsWith('fe80:');
  }
  return false;
}

function ipv4ToInt(ip) {
  return ipv4Parts(ip).reduce((n, octet) => ((n << 8) | octet) >>> 0, 0);
}

function intToIpv4(n) {
  return [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join('.');
}

function expandCidr(cidr) {
  const [base, bitsText] = String(cidr || '').split('/');
  const bits = Number(bitsText);
  const parts = ipv4Parts(base);
  if (!parts || !Number.isInteger(bits) || bits < 24 || bits > 32) {
    throw new Error('CIDR inválido: usa una red privada /24 a /32');
  }
  if (!privateIp(base)) throw new Error('Solo se permiten redes privadas, loopback o link-local');
  const hostCount = 2 ** (32 - bits);
  if (hostCount > MAX_HOSTS) throw new Error(`Rango demasiado grande: máximo ${MAX_HOSTS} hosts`);
  const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
  const start = ipv4ToInt(base) & mask;
  return Array.from({ length: hostCount }, (_, i) => intToIpv4((start + i) >>> 0));
}

async function resolvePrivateHost(host) {
  if (net.isIP(host)) {
    if (!privateIp(host)) throw new Error('El host no es privado');
    return host;
  }
  const addresses = await dns.lookup(host, { all: true });
  const hit = addresses.map((x) => x.address).find(privateIp);
  if (!hit) throw new Error('El nombre no resuelve a una IP privada');
  return hit;
}

function probe(host, port) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;
    const finish = (open, reason) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ host, port, open, latencyMs: Date.now() - started, reason: reason || null });
    };
    socket.setTimeout(TIMEOUT_MS, () => finish(false, 'timeout'));
    socket.once('connect', () => finish(true, 'open'));
    socket.once('error', (e) => finish(false, e.code || 'closed'));
    socket.connect(port, host);
  });
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function normalizePorts(input) {
  const raw = Array.isArray(input) && input.length ? input : DEFAULT_PORTS;
  const ports = [...new Set(raw.map(Number).filter((p) => Number.isInteger(p) && p >= 1 && p <= 65535))]
    .slice(0, MAX_PORTS);
  if (!ports.length) throw new Error('No hay puertos válidos');
  return ports;
}

async function auditLocalCameraNetwork(input = {}) {
  const cidr = String(input.cidr || '').trim();
  const hostInput = String(input.host || '').trim();
  const ports = normalizePorts(input.ports);
  const authorized = input.authorized === true || input.authorization === true;
  if (!authorized) throw new Error('Confirma autorización explícita para la red privada antes de auditar');
  if (!cidr && !hostInput) throw new Error('Indica host privado o CIDR privado autorizado');
  if (cidr && hostInput) throw new Error('Indica CIDR o host, no ambos');

  let hosts;
  if (cidr) hosts = expandCidr(cidr);
  else hosts = [await resolvePrivateHost(hostInput)];

  const pairs = hosts.flatMap((host) => ports.map((port) => ({ host, port })));
  const observations = await mapLimit(pairs, MAX_CONCURRENCY, ({ host, port }) => probe(host, port));
  const open = observations.filter((x) => x.open);
  return {
    ok: true,
    mode: 'authorized-local-connectivity',
    authorizedBoundary: 'private-network-only',
    authorizationConfirmed: true,
    hosts: hosts.length,
    ports,
    observations,
    open,
    cameraCandidates: open.filter((x) => CAMERA_PORTS.has(x.port)).map((item) => ({
      ...item,
      classification: 'camera-candidate',
      vulnerable: false,
      note: 'Puerto compatible observado; requiere identificación manual autorizada.',
    })),
    warning: 'Un puerto abierto no demuestra que exista una cámara ni que sea vulnerable. Revisa manualmente el activo y su autorización antes de cualquier prueba.',
    ts: new Date().toISOString(),
  };
}

module.exports = { auditLocalCameraNetwork, expandCidr, privateIp, DEFAULT_PORTS, MAX_HOSTS, MAX_PORTS };
