const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const DATA_DIR = path.join(os.homedir(), '.knk-suite', 'pipelines');

const crypto = require('crypto');

// Resuelve el binario instalado por la suite (kali-local) antes que el PATH:
// en Windows los tools NO están en el PATH y el exec anterior fallaba siempre.
function resolveToolBin(tool) {
  try {
    const kaliLocal = require('./kali-local');
    return kaliLocal.getBinaryPath(tool) || tool;
  } catch { return tool; }
}

const toolExecutors = {
  subfinder: (args) => execTool('subfinder', ['-d', bareHost(args.target), '-silent']),
  httpx: async (args) => {
    if (args.inputFile) return execTool('httpx', ['-l', args.inputFile, '-silent', '-status-code']);
    const t = String(args.target || '').trim();
    const withScheme = /^[a-z]+:\/\//i.test(t) ? [t] : [`https://${t}`, `http://${t}`];
    let lastErr = null;
    for (const u of withScheme) {
      try {
        const r = await execTool('httpx', ['-u', u, '-silent', '-status-code'], { timeoutMs: 45000 });
        if (r.stdout.trim()) return r;
        lastErr = new Error('sin respuesta en ' + u);
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('httpx sin respuesta');
  },
  nuclei: (args) => execTool('nuclei', ['-u', targetUrl(args.target), '-silent', '-severity', args.severity || 'medium,high,critical']),
  nmap: (args) => execTool('nmap', [...(args.flags ? String(args.flags).split(/\s+/).filter(Boolean) : ['-sV']), bareHost(args.target)]),
  ffuf: (args) => execTool('ffuf', ['-u', targetUrl(args.target) + '/FUZZ', '-w', args.wordlist || defaultWordlist(), '-mc', '200,301,302,403']),
  nikto: (args) => execTool('nikto', ['-h', bareHost(args.target)]),
  report: (args) => Promise.resolve({ stdout: JSON.stringify(args, null, 2), stderr: '' })
};

function defaultWordlist() {
  const candidates = [
    path.join(os.homedir(), '.knk-suite', 'wordlists', 'common.txt'),
    '/usr/share/wordlists/dirb/common.txt',
    '/usr/share/seclists/Discovery/Web-Content/common.txt',
  ];
  const hit = candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
  if (!hit) throw new Error('Sin wordlist: coloca una en ~/.knk-suite/wordlists/common.txt');
  return hit;
}

// Normaliza target según la herramienta: host pelado (nmap/subfinder) o URL
// con esquema (httpx/nuclei/ffuf). stdin se ignora: varias tools PD leen
// targets de stdin cuando no es TTY y execFile lo dejaba abierto (cuelgue).
function bareHost(target) {
  return String(target || '').trim().replace(/^[a-z]+:\/\//i, '').split('/')[0].split(':')[0];
}

function targetUrl(target) {
  const t = String(target || '').trim();
  return /^[a-z]+:\/\//i.test(t) ? t : `https://${t}`;
}

function execTool(cmd, args, opts = {}) {
  // spawn (NO execFile): hay que cerrar stdin YA (child.stdin.end()). Las
  // tools PD leen targets de stdin cuando no es consola y con el pipe
  // abierto del execFile se quedaban colgadas eternamente sin red ni salida.
  const { spawn } = require('child_process');
  const bin = resolveToolBin(cmd);
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return reject(new Error(`${cmd} no instalado (ToolsInstaller)`));
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, opts.timeoutMs || 180000);
    child.stdout.on('data', (d) => {
      stdout += d;
      if (stdout.length > 32 * 1024 * 1024) { try { child.kill(); } catch {} }
    });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(/ENOENT/i.test(e.message || '') ? `${cmd} no instalado (ToolsInstaller)` : String(e.message || e).slice(0, 500)));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(code == null ? `${cmd} terminado por timeout` : ((stderr || '').trim().split('\n').pop() || `${cmd} salió con código ${code}`).slice(0, 500)));
    });
    try { child.stdin.end(); } catch {}
  });
}

// Encadena fases: `input: "<id-fase>"` vuelca el stdout previo a un temporal.
async function runPhaseWithChaining(phase, results) {
  const args = { ...(phase.args || {}) };
  if (typeof args.input === 'string' && results[args.input] && results[args.input].stdout) {
    const lines = String(results[args.input].stdout).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length) {
      ensureDataDir();
      const tmp = path.join(DATA_DIR, `pipe-in-${crypto.randomBytes(6).toString('hex')}.txt`);
      fs.writeFileSync(tmp, lines.join('\n'), 'utf8');
      args.inputFile = tmp;
    }
    delete args.input; // vacía o no: sin fichero httpx cae a -u target
  } else if (typeof args.input === 'string') {
    delete args.input; // fase previa sin salida: httpx cae a -u target
  }
  const executor = toolExecutors[phase.tool];
  if (!executor) throw new Error(`tool desconocida: ${phase.tool}`);
  return executor(args);
}

function getBuiltinTemplate(name, target) {
  if (typeof builtInTemplates[name] === 'function') return builtInTemplates[name](target);
  return null;
}

class Pipeline {
  constructor(definition) {
    this.name = definition.name || 'unnamed';
    this.phases = (definition.phases || []).map(p => ({
      id: p.id,
      name: p.name || p.id,
      tool: p.tool,
      args: p.args || {},
      dependsOn: p.dependsOn || [],
      timeoutMs: p.timeoutMs || 120000,
      status: 'pending',
      result: null
    }));
    this.status = 'idle';
    this.currentPhase = null;
    this.cancelled = false;
    this.results = {};
  }

  validate() {
    const ids = new Set(this.phases.map(p => p.id));
    const errors = [];

    for (const phase of this.phases) {
      for (const dep of phase.dependsOn) {
        if (!ids.has(dep)) {
          errors.push(`Phase "${phase.id}" depends on missing phase "${dep}"`);
        }
      }
      if (!toolExecutors[phase.tool] && phase.tool !== 'custom') {
        errors.push(`Phase "${phase.id}" uses unknown tool "${phase.tool}"`);
        errors.push(`Available tools: ${Object.keys(toolExecutors).join(', ')}`);
        break;
      }
    }

    // Check circular dependencies
    for (const phase of this.phases) {
      const visited = new Set();
      const stack = [phase.id];
      while (stack.length) {
        const current = stack.pop();
        if (visited.has(current)) {
          errors.push(`Circular dependency detected involving "${current}"`);
          break;
        }
        visited.add(current);
        const p = this.phases.find(ph => ph.id === current);
        if (p) stack.push(...p.dependsOn);
      }
    }

    return { valid: errors.length === 0, ok: errors.length === 0, errors };
  }

  async run(onProgress) {
    const validation = this.validate();
    if (!validation.valid) {
      throw new Error('Pipeline validation failed:\n' + validation.errors.join('\n'));
    }

    this.status = 'running';
    this.cancelled = false;
    this.results = {};

    for (const phase of this.phases) {
      phase.status = 'pending';
    }

    try {
      while (!this.cancelled) {
        const ready = this.phases.filter(p =>
          p.status === 'pending' &&
          p.dependsOn.every(dep => this.results[dep] !== undefined)
        );

        if (ready.length === 0) break;

        this.currentPhase = ready[0];
        this.currentPhase.status = 'running';
        onProgress && onProgress(this.currentPhase.id, 'running', null);

        try {
          const result = await Promise.race([
            runPhaseWithChaining(this.currentPhase, this.results),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Phase timed out')), this.currentPhase.timeoutMs)
            )
          ]);

          this.currentPhase.status = 'completed';
          this.currentPhase.result = result;
          this.results[this.currentPhase.id] = result;
          onProgress && onProgress(this.currentPhase.id, 'completed', result);
        } catch (err) {
          this.currentPhase.status = 'failed';
          this.currentPhase.result = { error: err.message };
          this.results[this.currentPhase.id] = { error: err.message };
          onProgress && onProgress(this.currentPhase.id, 'failed', { error: err.message });
          this.status = 'failed';
          return this.getStatus();
        }
      }

      this.status = this.cancelled ? 'cancelled' : 'completed';
      onProgress && onProgress(null, this.status, null);
    } catch (err) {
      this.status = 'failed';
    }

    return this.getStatus();
  }

  getStatus() {
    const completed = this.phases.filter(p => p.status === 'completed').length;
    return {
      name: this.name,
      status: this.status,
      currentPhase: this.currentPhase ? this.currentPhase.id : null,
      progress: this.phases.length > 0 ? (completed / this.phases.length * 100).toFixed(1) : 0,
      phases: this.phases.map(p => ({ id: p.id, name: p.name, status: p.status })),
      results: this.results
    };
  }

  cancel() {
    this.cancelled = true;
    if (this.currentPhase) {
      this.currentPhase.status = 'cancelled';
    }
    this.status = 'cancelled';
  }
}

const builtInTemplates = {
  fullRecon: (target) => ({
    name: 'Full Reconnaissance',
    phases: [
      { id: 'enum', name: 'Subdomain Enumeration', tool: 'subfinder', args: { target } },
      { id: 'probe', name: 'HTTP Probing', tool: 'httpx', args: { input: 'enum' }, dependsOn: ['enum'] },
      { id: 'vuln', name: 'Vulnerability Scan', tool: 'nuclei', args: { target }, dependsOn: ['probe'] },
      { id: 'report', name: 'Generate Report', tool: 'report', args: { target }, dependsOn: ['vuln'] }
    ]
  }),
  quickScan: (target) => ({
    name: 'Quick Scan',
    phases: [
      { id: 'portscan', name: 'Nmap Quick Scan', tool: 'nmap', args: { target, flags: '-T4 -F' } },
      { id: 'probe', name: 'HTTP Probing', tool: 'httpx', args: { input: 'portscan' }, dependsOn: ['portscan'] }
    ]
  }),
  webAudit: (target) => ({
    name: 'Web Application Audit',
    phases: [
      { id: 'nikto', name: 'Nikto Scan', tool: 'nikto', args: { target } },
      { id: 'fuzz', name: 'Directory Fuzzing', tool: 'ffuf', args: { target } },
      { id: 'vuln', name: 'Nuclei Vuln Scan', tool: 'nuclei', args: { target }, dependsOn: ['nikto', 'fuzz'] }
    ]
  })
};

function fullRecon(target) {
  return new Pipeline(builtInTemplates.fullRecon(target));
}

function quickScan(target) {
  return new Pipeline(builtInTemplates.quickScan(target));
}

function webAudit(target) {
  return new Pipeline(builtInTemplates.webAudit(target));
}

function listTemplates() {
  return Object.keys(builtInTemplates);
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function safeTemplateName(name) {
  const clean = String(name || '').trim().replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 60);
  if (!clean) throw new Error('Nombre de plantilla inválido');
  return clean;
}

function saveTemplate(name, definition) {
  ensureDataDir();
  const filePath = path.join(DATA_DIR, `${safeTemplateName(name)}.json`);
  fs.writeFileSync(filePath, JSON.stringify(definition, null, 2), 'utf8');
  return { ok: true, name: safeTemplateName(name) };
}

function loadTemplate(name) {
  const filePath = path.join(DATA_DIR, `${safeTemplateName(name)}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Template "${name}" not found`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

module.exports = { Pipeline, fullRecon, quickScan, webAudit, listTemplates, saveTemplate, loadTemplate, getBuiltinTemplate, runPhaseWithChaining, resolveToolBin };
