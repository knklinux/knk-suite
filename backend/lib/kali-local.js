'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const TOOLS_DIR = path.join(os.homedir(), '.knk-suite', 'tools');

const CATALOG = [
  {
    name: 'nmap',
    category: 'recon',
    downloadUrl: 'https://nmap.org/dist/nmap-7.99-setup.exe',
    binaryPath: 'nmap.exe',
    version: '7.99 (winget)',
    notes: 'winget',
    wingetId: 'Insecure.Nmap'
  },
  {
    name: 'nuclei',
    category: 'vuln-scan',
    downloadUrl: 'https://github.com/projectdiscovery/nuclei/releases/download/v3.11.1/nuclei_3.11.1_windows_amd64.zip',
    binaryPath: 'nuclei.exe',
    version: '3.11.1',
    notes: 'go-binary'
  },
  {
    name: 'subfinder',
    category: 'recon',
    downloadUrl: 'https://github.com/projectdiscovery/subfinder/releases/download/v2.16.0/subfinder_2.16.0_windows_amd64.zip',
    binaryPath: 'subfinder.exe',
    version: '2.16.0',
    notes: 'go-binary'
  },
  {
    name: 'httpx',
    category: 'recon',
    downloadUrl: 'https://github.com/projectdiscovery/httpx/releases/download/v1.12.0/httpx_1.12.0_windows_amd64.zip',
    binaryPath: 'httpx.exe',
    version: '1.12.0',
    notes: 'go-binary'
  },
  {
    name: 'whatweb',
    category: 'recon',
    downloadUrl: 'https://github.com/urbanadventurer/WhatWeb/archive/master.zip',
    binaryPath: path.join('WhatWeb-master', 'whatweb'),
    version: 'master',
    notes: 'requires ruby'
  },
  {
    name: 'ffuf',
    category: 'fuzzing',
    downloadUrl: 'https://github.com/ffuf/ffuf/releases/download/v2.3.0/ffuf_2.3.0_windows_amd64.zip',
    binaryPath: 'ffuf.exe',
    version: '2.3.0',
    notes: 'go-binary'
  },
  {
    name: 'nikto',
    category: 'vuln-scan',
    downloadUrl: 'https://github.com/sullo/nikto/archive/master.zip',
    binaryPath: 'nikto.cmd',
    version: 'master',
    notes: 'perl-portable',
    perlUrl: 'https://github.com/StrawberryPerl/Perl-Dist-Strawberry/releases/download/SP_54231_64bit/strawberry-perl-5.42.3.1-64bit-portable.zip',
    perlBin: path.join('perl', 'perl', 'bin', 'perl.exe'),
    niktoPl: null // se localiza por búsqueda (main/master según la rama)
  },
  {
    name: 'hydra',
    category: 'brute-force',
    downloadUrl: 'https://github.com/vanhauser-thc/thc-hydra/archive/master.zip',
    binaryPath: path.join('thc-hydra-master', 'hydra.exe'),
    version: 'master',
    notes: 'sin binario Windows oficial: usa la VM Kali (⏻) o el contenedor Docker'
  },
  {
    name: 'gobuster',
    category: 'fuzzing',
    downloadUrl: 'https://github.com/OJ/gobuster/releases/download/v3.8.2/gobuster_Windows_x86_64.zip',
    binaryPath: 'gobuster.exe',
    version: '3.8.2',
    notes: 'go-binary'
  },
  {
    name: 'sqlmap',
    category: 'exploit',
    downloadUrl: 'https://github.com/sqlmapproject/sqlmap/archive/refs/heads/master.zip',
    binaryPath: path.join('sqlmap-master', 'sqlmap.py'),
    version: 'master',
    notes: 'requires python'
  }
];

function getToolsDir() {
  return TOOLS_DIR;
}

function catalog() {
  return CATALOG.map(tool => {
    const binPath = getBinaryPath(tool.name);
    const installed = Boolean(binPath);
    return {
      name: tool.name,
      installed,
      path: installed ? binPath : null,
      version: tool.version,
      downloadUrl: tool.downloadUrl,
      category: tool.category,
      notes: tool.notes
    };
  });
}

function isInstalled(name) {
  return Boolean(getBinaryPath(name));
}

function getBinaryPath(name) {
  const tool = CATALOG.find(t => t.name === name);
  if (!tool) return null;

  const toolDir = path.join(TOOLS_DIR, tool.name);
  let binaryFull = path.join(toolDir, tool.binaryPath);
  if (fs.existsSync(binaryFull)) return binaryFull;

  if (tool.notes === 'silent-installer' || tool.notes === 'winget') {
    const altPaths = [
      path.join(toolDir, 'nmap.exe'),
      path.join('C:', 'Program Files (x86)', 'Nmap', 'nmap.exe'),
      path.join('C:', 'Program Files', 'Nmap', 'nmap.exe')
    ];
    for (const alt of altPaths) {
      if (fs.existsSync(alt)) return alt;
    }
    // Instalación por extracción: el exe queda en subcarpetas del payload.
    return findFileRecursive(toolDir, tool.binaryPath);
  }
  return null;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    try {
      const dir = path.dirname(destPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      execSync(
        `curl.exe -L --retry 2 --retry-delay 2 -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) knkSuite/1.0" -o "${destPath}" "${url}" --connect-timeout 30 --max-time 300 -s -f`,
        { stdio: 'pipe', windowsHide: true }
      );

      if (!fs.existsSync(destPath) || fs.statSync(destPath).size === 0) {
        reject(new Error(`Download failed or empty file for ${url}`));
        return;
      }
      resolve();
    } catch (err) {
      reject(new Error(`curl failed for ${url}: ${err.message}`));
    }
  });
}

function extractZip(zipPath, destDir) {
  try {
    execSync(
      `powershell.exe -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`,
      { stdio: 'pipe', windowsHide: true, timeout: 120000 }
    );
    return true;
  } catch (err) {
    return false;
  }
}

function extractWith7z(zipPath, destDir) {
  try {
    execSync(`7z x "${zipPath}" -o"${destDir}" -y`, { stdio: 'pipe', windowsHide: true, timeout: 120000 });
    return true;
  } catch {
    return false;
  }
}

function findFileRecursive(dir, fileName) {
  let found = null;
  const walk = (d) => {
    if (found) return;
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isFile() && e.name.toLowerCase() === fileName.toLowerCase()) { found = full; return; }
      if (e.isDirectory()) walk(full);
    }
  };
  walk(dir);
  return found;
}

async function ensure7zr() {
  const bin = path.join(TOOLS_DIR, '7zr.exe');
  if (fs.existsSync(bin)) return bin;
  ensureDir(TOOLS_DIR);
  await downloadFile('https://www.7-zip.org/a/7zr.exe', bin);
  if (!fs.existsSync(bin)) throw new Error('no se pudo descargar 7zr');
  return bin;
}

async function installTool(name) {
  const tool = CATALOG.find(t => t.name === name);
  if (!tool) {
    return { ok: false, error: `Unknown tool: ${name}` };
  }

  const toolDir = path.join(TOOLS_DIR, tool.name);
  const filePath = path.join(TOOLS_DIR, `${name}${tool.notes === 'silent-installer' ? '.exe' : '.zip'}`);

  if (isInstalled(name)) {
    return { ok: true, message: `${name} is already installed`, path: getBinaryPath(name) };
  }

  ensureDir(toolDir);
  ensureDir(TOOLS_DIR);

  try {
    await downloadFile(tool.downloadUrl, filePath);

    if (tool.notes === 'winget' && tool.wingetId) {
      // 1) Intento winget (pide UAC solo; silencioso fallaría sin admin).
      try {
        execSync(
          `winget install -e --id ${tool.wingetId} --source winget --accept-source-agreements --accept-package-agreements`,
          { stdio: 'pipe', windowsHide: true, timeout: 600000 }
        );
      } catch {}
      let binPath = getBinaryPath(name);
      if (binPath) {
        try { fs.unlinkSync(filePath); } catch {}
        return { ok: true, path: binPath };
      }
      // 2) Plan B: el instalador oficial a Descargas para doble clic manual
      // (winget roto en esta máquina; el driver Npcap exige UAC igualmente).
      try {
        const dlDir = path.join(os.homedir(), 'Downloads');
        ensureDir(dlDir);
        const manual = path.join(dlDir, 'nmap-7.99-setup.exe');
        if (!fs.existsSync(manual)) await downloadFile(tool.downloadUrl, manual);
        try { fs.unlinkSync(filePath); } catch {}
        return { ok: false, needsInteraction: true, manual, error: 'Ejecuta el instalador con doble clic (pide UAC por Npcap) y reintenta: ' + manual };
      } catch (e) {
        try { fs.unlinkSync(filePath); } catch {}
        return { ok: false, error: `Sin nmap: ${String(e.message || e).slice(0, 160)}. Alternativa inmediata: la VM Kali (⏻) ya trae nmap.` };
      }
    } else if (tool.notes === 'perl-portable') {
      // Nikto: perl portable (~290 MB) + wrapper .cmd. Sin admin ni PATH.
      try {
        const perlDir = path.join(TOOLS_DIR, 'perl');
        const perlBin = path.join(TOOLS_DIR, tool.perlBin);
        if (!fs.existsSync(perlBin)) {
          const perlZip = path.join(TOOLS_DIR, 'perl-portable.zip');
          if (!fs.existsSync(perlZip)) await downloadFile(tool.perlUrl, perlZip);
          ensureDir(perlDir);
          // tar.exe de Windows maneja las rutas profundas de Strawberry;
          // Expand-Archive y 7zr portable fallan con ellas.
          let perlOk = false;
          try {
            execSync(`tar -xf "${perlZip}" -C "${perlDir}"`, { stdio: 'pipe', windowsHide: true, timeout: 600000 });
            perlOk = fs.existsSync(perlBin);
          } catch {}
          if (!perlOk) perlOk = extractZip(perlZip, perlDir) && fs.existsSync(perlBin);
          if (!perlOk) {
            return { ok: false, error: 'No se pudo extraer perl portable (ocupa ~1 GB). Libera disco e inténtalo de nuevo.' };
          }
          try { fs.unlinkSync(perlZip); } catch {}
        }
        if (!fs.existsSync(perlBin)) return { ok: false, error: 'perl.exe no aparece tras extraer.' };
        await downloadFile(tool.downloadUrl, filePath);
        if (!extractZip(filePath, toolDir) && !extractWith7z(filePath, toolDir)) {
          try { fs.unlinkSync(filePath); } catch {}
          return { ok: false, error: 'No se pudo extraer nikto.' };
        }
        try { fs.unlinkSync(filePath); } catch {}
        const plPath = findFileRecursive(toolDir, 'nikto.pl');
        if (!plPath) return { ok: false, error: 'nikto.pl no aparece tras extraer.' };
        const wrapper = path.join(toolDir, 'nikto.cmd');
        fs.writeFileSync(wrapper, `@echo off\r\n"${perlBin}" "${plPath}" %*\r\n`, 'utf8');
        // Nikto exige XML::Writer: se instala con el cpan portable (puro-perl).
        try {
          execSync(`cmd /d /s /c "set PATH=${path.dirname(perlBin)};%PATH% && cpan -T XML::Writer"`, { stdio: 'pipe', windowsHide: true, timeout: 300000 });
        } catch {}
        return { ok: true, path: wrapper };
      } catch (e) {
        try { fs.unlinkSync(filePath); } catch {}
        return { ok: false, error: String(e.message || e).slice(0, 200) };
      }
    } else if (tool.notes === 'silent-installer') {
      let installed = false;
      try {
        execSync(
          `"${filePath}" /S /D=${toolDir}`,
          { stdio: 'pipe', windowsHide: true, timeout: 180000 }
        );
        installed = Boolean(getBinaryPath(name));
      } catch {}
      if (!installed) {
        try {
          const sevenZr = await ensure7zr();
          execSync(`"${sevenZr}" x "${filePath}" -o"${toolDir}" -y`, { stdio: 'pipe', windowsHide: true, timeout: 180000 });
          installed = Boolean(findFileRecursive(toolDir, 'nmap.exe'));
        } catch {}
      }
      try { fs.unlinkSync(filePath); } catch {}
      if (!installed) return { ok: false, error: 'Instalador falló (¿sin admin para Npcap?) y la extracción tampoco. nmap necesita Npcap: instálalo como admin o usa la VM Kali.' };
    } else {
      const extracted = extractZip(filePath, toolDir) || extractWith7z(filePath, toolDir);
      if (!extracted) {
        return { ok: false, error: 'Failed to extract archive' };
      }
      try { fs.unlinkSync(filePath); } catch {}
    }

    const binPath = getBinaryPath(name);
    if (!binPath) {
      return { ok: false, error: 'Binary not found after extraction' };
    }

    return { ok: true, path: binPath };
  } catch (err) {
    try { fs.unlinkSync(filePath); } catch {}
    return { ok: false, error: err.message };
  }
}

function runTool(name, args = [], timeoutMs = 30000) {
  // spawn + stdin.end() inmediato (NO execSync): las tools leen stdin cuando
  // no hay consola y con el pipe abierto se cuelgan sin salida ni red.
  const { spawn, exec } = require('child_process');
  const binPath = getBinaryPath(name);
  if (!binPath) {
    return Promise.resolve({ ok: false, stdout: '', stderr: `${name} is not installed`, exitCode: -1 });
  }
  // .cmd/.bat: exec() con UNA sola capa de citado (spawn+array rompe las
  // comillas internas por el doble citado libuv+cmd). Args sin comillas.
  if (/\.cmd$/i.test(binPath)) {
    const safeArgs = args.map((a) => `"${String(a).replace(/"/g, '')}"`).join(' ');
    return new Promise((resolve) => {
      exec(`"${binPath}" ${safeArgs}`, { timeout: timeoutMs, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
        if (!err) return resolve({ ok: true, stdout: String(stdout || ''), stderr: String(stderr || ''), exitCode: 0 });
        resolve({ ok: false, stdout: String(stdout || ''), stderr: String(stderr || err.message || ''), exitCode: typeof err.code === 'number' ? err.code : -1 });
      });
    });
  }
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(binPath, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return resolve({ ok: false, stdout: '', stderr: String(e.message || e), exitCode: -1 });
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: String(e.message || e), exitCode: -1 });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ ok: true, stdout, stderr, exitCode: 0 });
      else resolve({ ok: false, stdout, stderr: (stderr.trim().split('\n').pop() || `${name} exit ${code}`), exitCode: code == null ? -1 : code });
    });
    try { child.stdin.end(); } catch {}
  });
}

function inventory() {
  return CATALOG.map(tool => {
    const binPath = getBinaryPath(tool.name);
    let installed = Boolean(binPath);
    let size = 0;
    let lastModified = null;

    if (binPath) {
      try {
        const stat = fs.statSync(binPath);
        size = stat.size;
        lastModified = stat.mtime;
      } catch {}
    }

    let runtimeDeps = null;
    if (tool.notes && tool.notes.startsWith('requires')) {
      runtimeDeps = tool.notes.replace('requires ', '');
    }

    return {
      name: tool.name,
      category: tool.category,
      installed,
      path: binPath,
      version: tool.version,
      downloadUrl: tool.downloadUrl,
      size,
      lastModified,
      runtimeDependencies: runtimeDeps
    };
  });
}

async function setupAll() {
  ensureDir(TOOLS_DIR);

  const results = {};
  for (const tool of CATALOG) {
    if (isInstalled(tool.name)) {
      results[tool.name] = { ok: true, skipped: true, path: getBinaryPath(tool.name) };
      continue;
    }
    results[tool.name] = await installTool(tool.name);
  }

  return results;
}

module.exports = {
  getToolsDir,
  catalog,
  installTool,
  isInstalled,
  getBinaryPath,
  runTool,
  inventory,
  setupAll
};
