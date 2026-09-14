'use strict';

// ============================================================================
// camera-scanner.js — Real camera discovery: local network + external OSINT
// ============================================================================

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { execSync } = require('child_process');
const net = require('net');

// ── HTTP helper ─────────────────────────────────────────────────────
function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: opts.timeout || 10000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    } catch (e) { reject(e); }
  });
}

function tcpProbe(host, port, timeout = 1500) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(timeout);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
    sock.on('error', () => { sock.destroy(); resolve(false); });
    sock.connect(port, host);
  });
}

function httpProbe(url, timeout = 4000) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.get(url, { timeout, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => resolve({ ok: true, status: res.statusCode, headers: res.headers, body: data }));
      });
      req.on('error', () => resolve({ ok: false }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
    } catch (e) { resolve({ ok: false }); }
  });
}

// ── Known camera brands + default credentials + paths ───────────────
const CAMERA_BRANDS = [
  { brand: 'Hikvision', defaultUser: 'admin', defaultPass: '12345', rtsp: '/Streaming/Channels/101', mjpeg: '/ISAPI/Streaming/channels/101/httpPreview', snapshot: '/ISAPI/Streaming/channels/101/picture' },
  { brand: 'Dahua', defaultUser: 'admin', defaultPass: 'admin', rtsp: '/cam/realmonitor?channel=1&subtype=0', mjpeg: '/cgi-bin/mjpg/video.cgi?channel=1&subtype=1', snapshot: '/cgi-bin/snapshot.cgi?channel=1' },
  { brand: 'Axis', defaultUser: 'root', defaultPass: 'pass', rtsp: '/axis-media/media.asp', mjpeg: '/axis-cgi/mjpg/video.cgi', snapshot: '/axis-cgi/snapshot.cgi' },
  { brand: 'Amcrest', defaultUser: 'admin', defaultPass: 'admin', rtsp: '/cam/realmonitor?channel=1&subtype=0', mjpeg: '/cgi-bin/mjpg/video.cgi?channel=1&subtype=1', snapshot: '/cgi-bin/snapshot.cgi' },
  { brand: 'Foscam', defaultUser: 'admin', defaultPass: '', rtsp: '/videoMain', mjpeg: '/cgi-bin/cgiop?op=getmotor&curpos=1', snapshot: '/cgi-bin/snapshot.cgi?channel=1' },
  { brand: 'Reolink', defaultUser: 'admin', defaultPass: '', rtsp: '/h264Preview_01_main', mjpeg: '/cgi-bin/api.cgi?op=get&channel=0&channel0=mjpg', snapshot: '/cgi-bin/api.cgi?op=get&channel=0&channel0=snap' },
  { brand: 'TP-Link Tapo', defaultUser: 'admin', defaultPass: 'admin', rtsp: '/stream1', mjpeg: null, snapshot: null },
  { brand: 'Xiaomi', defaultUser: 'admin', defaultPass: 'admin', rtsp: '/live', mjpeg: null, snapshot: null },
  { brand: 'UNV (Uniview)', defaultUser: 'admin', defaultPass: '123456', rtsp: '/media/video1', mjpeg: null, snapshot: null },
  { brand: 'Vivotek', defaultUser: 'root', defaultPass: '', rtsp: '/live.sdp', mjpeg: '/cgi-bin/viewer/video.mjpg', snapshot: null },
  { brand: 'Bosch', defaultUser: 'admin', defaultPass: 'admin', rtsp: '/rtsp_live', mjpeg: null, snapshot: null },
  { brand: 'Geovision', defaultUser: 'admin', defaultPass: 'admin', rtsp: '/video1', mjpeg: null, snapshot: null },
  { brand: 'Pelco', defaultUser: 'admin', defaultPass: '', rtsp: '/stream1', mjpeg: null, snapshot: null },
  { brand: 'Sony', defaultUser: 'admin', defaultPass: 'password', rtsp: '/stream1', mjpeg: null, snapshot: null },
  { brand: 'Samsung', defaultUser: 'admin', defaultPass: '4321', rtsp: '/live/main', mjpeg: null, snapshot: null },
  { brand: 'Panasonic', defaultUser: 'admin', defaultPass: '12345', rtsp: '/MJPEG', mjpeg: '/MJPEG', snapshot: null },
  { brand: 'Lorex', defaultUser: 'admin', defaultPass: 'admin', rtsp: '/videoMain', mjpeg: null, snapshot: null },
  { brand: 'Swann', defaultUser: 'admin', defaultPass: 'admin', rtsp: '/stream1', mjpeg: null, snapshot: null },
  { brand: 'Night Owl', defaultUser: 'admin', defaultPass: 'password', rtsp: '/stream1', mjpeg: null, snapshot: null },
];

const CAMERA_PORTS = [80, 554, 8000, 8080, 8443, 8554, 37777];
const HTTP_PORTS = [80, 8000, 8080, 8443];
const RTSP_PORTS = [554, 8554];

// ── 1. LOCAL NETWORK SCANNER ────────────────────────────────────────

async function getLocalIP() {
  try {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) return iface.address;
      }
    }
  } catch (e) {}
  return '192.168.1.1';
}

function strictV4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s || '').trim());
  if (!m) return null;
  const oct = m.slice(1, 5).map(Number);
  if (oct.some((n) => n > 255)) return null;
  return oct.join('.');
}

function isRfc1918(ip) {
  const o = ip.split('.').map(Number);
  return o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168);
}

// IP apta para auditoría activa: todo menos link-local/metadata/0.0.0.0.
function auditableIP(ip) {
  const clean = strictV4(ip);
  if (!clean) return null;
  const o = clean.split('.').map(Number);
  if (o[0] === 169 && o[1] === 254) return null;
  if (o.every((n) => n === 0)) return null;
  return clean;
}

async function scanLocalNetwork(targetRange) {
  // FIX seguridad: el rango venía de ?range= sin sanear (inyección shell).
  // Solo IPv4/CIDR válidos y, por diseño «red local», solo RFC1918.
  let base = null;
  if (targetRange) {
    const m = /^(\d{1,3}(?:\.\d{1,3}){0,3})(?:\/(\d{1,2}))?$/.exec(String(targetRange).trim());
    if (m) {
      const parts = m[1].split('.').map(Number);
      if (parts.every((n) => n <= 255) && (m[2] === undefined || Number(m[2]) <= 32)) {
        const full = [...parts, ...Array(4 - parts.length).fill(0)].join('.');
        if (isRfc1918(full)) base = full.split('.').slice(0, 3).join('.');
      }
    }
    if (!base) return { ok: false, error: 'Rango inválido: usa una red privada RFC1918 (ej: 192.168.1.0/24)' };
  }
  const localIP = base ? `${base}.1` : await getLocalIP();
  const subnet = localIP.split('.').slice(0, 3).join('.');
  const cameras = [];

  // Step 1: Discover hosts (sin shell: execFile con args fijos)
  let hosts = [];
  try {
    const { execFileSync } = require('child_process');
    const nmapOut = execFileSync('nmap', ['-sn', `${subnet}.0/24`, '-T4', '--min-rate', '1000'], { encoding: 'utf8', timeout: 20000 });
    const ipRegex = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g;
    let match;
    while ((match = ipRegex.exec(nmapOut)) !== null) {
      if (!hosts.includes(match[1])) hosts.push(match[1]);
    }
  } catch (e) {
    try {
      const arpOut = execSync('arp -a', { encoding: 'utf8', timeout: 5000 });
      const ipRegex = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g;
      let match;
      while ((match = ipRegex.exec(arpOut)) !== null) {
        if (!hosts.includes(match[1])) hosts.push(match[1]);
      }
    } catch (e2) {}
  }

  if (hosts.length === 0) {
    for (let i = 1; i <= 50; i++) hosts.push(`${subnet}.${i}`);
  }

  // Step 2: Probe hosts in parallel batches
  const BATCH_SIZE = 10;
  for (let b = 0; b < hosts.length; b += BATCH_SIZE) {
    const batch = hosts.slice(b, b + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(host => probeHost(host)));
    for (const cam of batchResults) {
      if (cam) cameras.push(cam);
    }
  }

  return {
    ok: true,
    subnet,
    scanned: hosts.length,
    cameras,
    total: cameras.length,
    note: 'Credenciales por defecto conocidas. MJPEG streams se pueden ver en el navegador.',
  };
}

async function probeHost(host) {
  // Quick port check - probe all ports in parallel
  const portResults = await Promise.all(CAMERA_PORTS.map(async (port) => {
    const open = await tcpProbe(host, port, 1200);
    return { port, open };
  }));
  const openPorts = portResults.filter(r => r.open).map(r => r.port);
  if (openPorts.length === 0) return null;

  const camera = { ip: host, ports: openPorts, brand: null, streams: [], webInterface: null, credentials: null };

  // Try HTTP probe for brand + MJPEG
  for (const port of openPorts.filter(p => HTTP_PORTS.includes(p))) {
    const proto = port === 443 || port === 8443 ? 'https' : 'http';
    const probe = await httpProbe(`${proto}://${host}:${port}/`, 3000);
    if (probe.ok) {
      camera.webInterface = `${proto}://${host}:${port}`;
      const body = probe.body.toLowerCase();
      const server = (probe.headers.server || '').toLowerCase();

      for (const brand of CAMERA_BRANDS) {
        const bl = brand.brand.toLowerCase();
        if (body.includes(bl) || body.includes(bl.replace(/\s/g, '')) || server.includes(bl)) {
          camera.brand = brand.brand;
          camera.credentials = { user: brand.defaultUser, pass: brand.defaultPass };

          // Add MJPEG snapshot URL if available
          if (brand.snapshot) {
            camera.streams.push({ type: 'mjpeg', url: `${proto}://${host}:${port}${brand.snapshot}`, label: 'Snapshot' });
          }
          if (brand.mjpeg) {
            camera.streams.push({ type: 'mjpeg', url: `${proto}://${host}:${port}${brand.mjpeg}`, label: 'MJPEG Live' });
          }
          break;
        }
      }
      break;
    }
  }

  // RTSP streams
  for (const port of openPorts.filter(p => RTSP_PORTS.includes(p))) {
    // Add brand-specific RTSP path if known
    const brandInfo = camera.brand ? CAMERA_BRANDS.find(b => b.brand === camera.brand) : null;
    const rtspPath = brandInfo?.rtsp || '';
    camera.streams.push({ type: 'rtsp', url: `rtsp://${host}:${port}${rtspPath}`, label: `RTSP :${port}` });
  }

  // If no brand detected but has RTSP, still add generic stream
  if (!camera.brand && openPorts.some(p => RTSP_PORTS.includes(p))) {
    const rtspPort = openPorts.find(p => RTSP_PORTS.includes(p));
    camera.streams.push({ type: 'rtsp', url: `rtsp://${host}:${rtspPort}/`, label: 'RTSP (generic)' });
  }

  return camera;
}

// ── 2. SHODAN INTERNETDB ────────────────────────────────────────────

async function shodanInternetDB(ip) {
  try {
    const resp = await fetch(`https://internetdb.shodan.io/${ip}`);
    if (resp.status === 200) {
      return { ok: true, source: 'Shodan InternetDB', data: JSON.parse(resp.body) };
    }
    return { ok: false, error: `HTTP ${resp.status}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── 3. GOOGLE DORKS FOR CAMERAS ─────────────────────────────────────

function generateCameraDorks(brand = 'all', target = '') {
  const dorks = {
    general: [
      'inurl:"/cgi-bin/mjpeg"',
      'inurl:"/cgi-bin/viewer"',
      'intitle:"live view" intitle:"network camera"',
      'inurl:"/videoMain"',
      'inurl:"/video.mjpg"',
      'inurl:"/mjpg/video.mjpg"',
      'intext:"Network Camera" inurl:"/viewer/frame.html"',
      'inurl:"/ISAPI/Stream"',
      'inurl:"/Streaming/Channels"',
      'inurl:"/axis-cgi"',
      'inurl:"/cam/realmonitor"',
      'intitle:"Network Camera" "Server: gSOAP"',
      'inurl:"/onvif-http/snapshot"',
    ],
    hikvision: [
      'inurl:"/ISAPI/System/deviceInfo"',
      'inurl:"/Streaming/Channels/101"',
      'intitle:"Hikvision" inurl:"/doc/page/login"',
      'inurl:"/SDK/webAgent"',
      'intitle:"Hik-Connect"',
      'inurl:"/ISAPI/Security/adminUser"',
      'intitle:"HIKVISION" inurl:"/login"',
    ],
    dahua: [
      'inurl:"/cam/realmonitor?channel=1"',
      'inurl:"/RPC2" intitle:"Dahua"',
      'intitle:"Dahua" inurl:"/login.jsp"',
      'inurl:"/cgi-bin/magicBox.cgi"',
      'inurl:"/cgi-bin/configManager.cgi"',
      'intitle:"Dahua Web Service"',
    ],
    axis: [
      'inurl:"/axis-cgi"',
      'inurl:"/operator/basic.shtml"',
      'intitle:"AXIS" inurl:"/admin/basic.shtml"',
      'inurl:"/axis-cgi/viewer"',
      'intitle:"AXIS Video Server"',
    ],
    foscam: [
      'inurl:"/cgi-bin/CGIProxy"',
      'intitle:"FOSCAM" inurl:"/web_login"',
      'inurl:"/videoMain"',
    ],
    reolink: [
      'inurl:"/cgi-bin/api.cgi"',
      'intitle:"Reolink" inurl:"/login"',
    ],
    amcrest: [
      'inurl:"/cgi-bin/magicBox.cgi"',
      'intitle:"Amcrest" inurl:"/login"',
    ],
    onvif: [
      'intitle:"ONVIF" inurl:"/onvif"',
      'inurl:"/onvif-http/snapshot"',
      'intext:"ONVIF" inurl:"/onvif/device_service"',
    ],
  };

  const brandLower = (brand || 'general').toLowerCase();
  let selectedDorks = dorks[brandLower] || dorks.general;
  if (target) selectedDorks = selectedDorks.map(d => `${d} site:${target}`);

  return {
    ok: true,
    brand: brandLower,
    target: target || 'global',
    dorks: selectedDorks,
    total: selectedDorks.length,
    allCategories: Object.keys(dorks),
  };
}

// ── 4. CVE LOOKUP ───────────────────────────────────────────────────

async function cameraCVELookup(brand) {
  const cves = {
    hikvision: [
      { id: 'CVE-2021-36260', severity: 'CRITICAL', desc: 'RCE via command injection in web server (CVSS 9.8)', affected: 'All Hikvision cameras with firmware < 4.30.0' },
      { id: 'CVE-2023-28808', severity: 'HIGH', desc: 'ACL bypass allowing unauthorized access', affected: 'Multiple Hikvision products' },
      { id: 'CVE-2023-6895', severity: 'HIGH', desc: 'Heap buffer overflow in RTSP', affected: 'Multiple firmware versions' },
      { id: 'CVE-2021-31955', severity: 'MEDIUM', desc: 'Information disclosure', affected: 'Multiple models' },
      { id: 'CVE-2017-7921', severity: 'CRITICAL', desc: 'Authentication bypass allowing full control', affected: 'Older firmware versions' },
    ],
    dahua: [
      { id: 'CVE-2021-33044', severity: 'CRITICAL', desc: 'Authentication bypass via 0-day exploit (CVSS 9.8)', affected: 'All Dahua products before 3.4.0.0' },
      { id: 'CVE-2021-33045', severity: 'CRITICAL', desc: 'Authentication bypass (backdoor)', affected: 'All Dahua products before 3.4.0.0' },
      { id: 'CVE-2023-3836', severity: 'HIGH', desc: 'Command injection in IP camera web server', affected: 'IPC-HDW series' },
    ],
    axis: [
      { id: 'CVE-2023-21416', severity: 'HIGH', desc: 'Privilege escalation in Axis camera API', affected: 'AXIS OS < 11.8' },
      { id: 'CVE-2018-10055', severity: 'HIGH', desc: 'Stack buffer overflow in FTP server', affected: 'Multiple Axis cameras' },
    ],
    reolink: [
      { id: 'CVE-2023-48636', severity: 'HIGH', desc: 'Command injection via RTSP', affected: 'RLN8-410 NVR firmware' },
    ],
    foscam: [
      { id: 'CVE-2018-19446', severity: 'CRITICAL', desc: 'RCE via buffer overflow in CGI handler', affected: 'Multiple Foscam models' },
      { id: 'CVE-2019-11219', severity: 'HIGH', desc: 'Information disclosure', affected: 'Multiple models' },
    ],
  };

  const brandLower = (brand || '').toLowerCase();
  const brandCves = cves[brandLower] || [];

  return {
    ok: true,
    brand: brandLower || 'unknown',
    cves: brandCves,
    total: brandCves.length,
    searchNvd: `https://nvd.nist.gov/vuln/search/results?query=${encodeURIComponent(brand)}+camera&results_type=overview`,
  };
}

// ── 5. RTSP STREAM PROBE ───────────────────────────────────────────

async function probeRTSP(host, port = 554) {
  const results = { host, port, accessible: false, streams: [] };
  const paths = CAMERA_BRANDS.map(b => b.rtsp).filter(Boolean);
  paths.push('/live', '/stream1', '/videoMain');

  for (const p of paths) {
    try {
      await new Promise((resolve, reject) => {
        const sock = new net.Socket();
        sock.setTimeout(2000);
        const req = `DESCRIBE rtsp://${host}:${port}${p} RTSP/1.0\r\nCSeq: 1\r\n\r\n`;
        sock.on('connect', () => sock.write(req));
        sock.on('data', (data) => {
          const s = data.toString();
          if (s.includes('RTSP/1.0')) {
            results.accessible = true;
            results.streams.push({ path: p, response: s.split('\r\n')[0] });
          }
          sock.destroy();
          resolve();
        });
        sock.on('timeout', () => { sock.destroy(); reject(new Error('timeout')); });
        sock.on('error', () => { sock.destroy(); reject(new Error('error')); });
        sock.connect(port, host);
      });
    } catch (e) {}
  }
  return results;
}

// ── 6. EXTERNAL CAMERA SEARCH ───────────────────────────────────────

async function externalCameraSearch(query = '', country = 'all') {
  // Try to actually query some known camera IPs via InternetDB
  const discovered = [];

  // Well-known public camera test IPs (Shodan examples)
  const testIPs = [];
  if (!query) {
    // Generate some common camera ranges to check
    // These are examples from Shodan documentation
  }

  // If query is an IP, query it directly
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(query)) {
    try {
      const resp = await fetch(`https://internetdb.shodan.io/${query}`);
      if (resp.status === 200) {
        const data = JSON.parse(resp.body);
        if (data.ports && (data.ports.includes(554) || data.ports.includes(80) || data.ports.includes(8080))) {
          discovered.push({ ip: query, ports: data.ports, hostnames: data.hostnames || [], vulns: data.vulns || [] });
        }
      }
    } catch (e) {}
  }

  const searchUrls = [
    { name: 'Shodan', url: `https://www.shodan.io/search?query=${encodeURIComponent(query || 'port:554 has_screenshot:true')}`, free: true },
    { name: 'FOFA', url: `https://en.fofa.info/result?qbase64=${Buffer.from(query || 'protocol="rtsp"').toString('base64')}`, free: true },
    { name: 'ZoomEye', url: `https://www.zoomeye.org/search?q=${encodeURIComponent(query || 'port:554')}`, free: true },
    { name: 'Netlas', url: `https://app.netlas.io/search/?q=${encodeURIComponent(query || 'port:554')}`, free: true },
    { name: 'Censys', url: `https://search.censys.io/search?resource=hosts&q=${encodeURIComponent(query || 'services.port=554')}`, free: true },
    { name: 'GreyNoise', url: `https://viz.greynoise.io/query?q=${encodeURIComponent(query || 'port:554')}`, free: true },
  ];

  const googleDorks = generateCameraDorks('all', country === 'all' ? '' : country).dorks;

  return {
    ok: true,
    query,
    country,
    discovered,
    searchUrls,
    googleDorks,
    internetDB: 'https://internetdb.shodan.io/{IP} — free, no API key',
  };
}

// ── 7. FULL CAMERA AUDIT ───────────────────────────────────────────

async function fullCameraAudit(targetIP) {
  const audit = { ip: targetIP, brand: null, vulnerabilities: [], credentials: [], streams: [] };

  // Port scan - parallel
  const portResults = await Promise.all(CAMERA_PORTS.map(async (port) => {
    const open = await tcpProbe(targetIP, port, 1500);
    return { port, open };
  }));
  audit.openPorts = portResults.filter(r => r.open).map(r => r.port);

  // HTTP probe for brand
  for (const port of audit.openPorts.filter(p => HTTP_PORTS.includes(p))) {
    const proto = port === 443 || port === 8443 ? 'https' : 'http';
    const probe = await httpProbe(`${proto}://${targetIP}:${port}/`, 3000);
    if (probe.ok) {
      const body = probe.body.toLowerCase();
      for (const brand of CAMERA_BRANDS) {
        if (body.includes(brand.brand.toLowerCase())) {
          audit.brand = brand.brand;
          audit.credentials.push({ user: brand.defaultUser, pass: brand.defaultPass, source: 'default' });

          // Add stream URLs
          if (brand.snapshot) audit.streams.push({ type: 'mjpeg', url: `${proto}://${targetIP}:${port}${brand.snapshot}`, label: 'Snapshot' });
          if (brand.mjpeg) audit.streams.push({ type: 'mjpeg', url: `${proto}://${targetIP}:${port}${brand.mjpeg}`, label: 'MJPEG Live' });
          if (brand.rtsp) audit.streams.push({ type: 'rtsp', url: `rtsp://${targetIP}:${audit.openPorts.find(p => RTSP_PORTS.includes(p)) || 554}${brand.rtsp}`, label: 'RTSP' });
          break;
        }
      }
      audit.webInterface = `${proto}://${targetIP}:${port}`;
      break;
    }
  }

  // RTSP probe
  const rtspPort = audit.openPorts.find(p => RTSP_PORTS.includes(p));
  if (rtspPort) {
    const rtsp = await probeRTSP(targetIP, rtspPort);
    audit.rtspAccessible = rtsp.accessible;
    for (const s of rtsp.streams) {
      audit.streams.push({ type: 'rtsp', url: `rtsp://${targetIP}:${rtspPort}${s.path}`, label: s.path });
    }
  }

  // CVE lookup
  if (audit.brand) {
    const cveResult = await cameraCVELookup(audit.brand);
    audit.vulnerabilities = cveResult.cves;
  }

  // Vuln paths
  const vulnPaths = ['/../../../etc/passwd', '/cgi-bin/hi3510/param.cgi?cmd=getp', '/ISAPI/System/deviceInfo', '/onvif-http/snapshot'];
  for (const vPath of vulnPaths) {
    const port = audit.openPorts[0] || 80;
    const proto = port === 443 ? 'https' : 'http';
    const probe = await httpProbe(`${proto}://${targetIP}:${port}${vPath}`, 2000);
    if (probe.ok && probe.status === 200) {
      audit.vulnerablePaths = audit.vulnerablePaths || [];
      audit.vulnerablePaths.push({ path: vPath, status: probe.status });
    }
  }

  return { ok: true, ...audit };
}

module.exports = {
  scanLocalNetwork,
  shodanInternetDB,
  generateCameraDorks,
  cameraCVELookup,
  probeRTSP,
  externalCameraSearch,
  fullCameraAudit,
  strictV4,
  auditableIP,
  CAMERA_BRANDS,
  CAMERA_PORTS,
};
