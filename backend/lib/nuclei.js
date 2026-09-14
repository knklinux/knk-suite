const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const NUCLEI_DIR = path.join(os.homedir(), '.knk-suite', 'tools', 'nuclei');
const NUCLEI_BIN = process.platform === 'win32'
  ? path.join(NUCLEI_DIR, 'nuclei.exe')
  : path.join(NUCLEI_DIR, 'nuclei');
const TEMPLATES_DIR = path.join(NUCLEI_DIR, 'templates');

function isInstalled() {
  try {
    fs.accessSync(NUCLEI_BIN, fs.constants.X_OK);
    return true;
  } catch {
    try {
      fs.accessSync(NUCLEI_BIN, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

function scan(target, templates, severity, timeoutMs) {
  const timeout = timeoutMs || 300000;
  const start = Date.now();

  return new Promise((resolve) => {
    if (!isInstalled()) {
      return resolve({ ok: false, findings: [], elapsedMs: 0, error: 'nuclei not installed' });
    }

    const args = ['-target', target, '-json'];

    if (templates && templates.length) {
      templates.forEach(t => { args.push('-t', t); });
    } else {
      args.push('-t', TEMPLATES_DIR);
    }

    if (severity && severity.length) {
      args.push('-severity', severity.join(','));
    }

    args.push('-timeout', String(Math.floor(timeout / 1000)));

    const child = execFile(NUCLEI_BIN, args, { timeout }, (error, stdout, stderr) => {
      const elapsedMs = Date.now() - start;

      if (error && error.killed) {
        return resolve({ ok: false, findings: [], elapsedMs, error: 'scan timed out' });
      }

      const findings = [];
      if (stdout) {
        stdout.split('\n').forEach(line => {
          line = line.trim();
          if (!line) return;
          try {
            const parsed = JSON.parse(line);
            findings.push({
              id: parsed['template-id'] || parsed.id || '',
              severity: (parsed.info && parsed.info.severity) || parsed.severity || 'unknown',
              name: (parsed.info && parsed.info.name) || parsed.name || '',
              matchedAt: parsed['matched-at'] || parsed.matched || '',
              description: (parsed.info && parsed.info.description) || parsed.description || '',
              reference: (parsed.info && parsed.info.reference) || [],
              tags: (parsed.info && parsed.info.tags) || []
            });
          } catch {
            // skip non-JSON lines
          }
        });
      }

      resolve({ ok: !error, findings, elapsedMs, error: error ? error.message : null });
    });

    child.on('error', () => {
      resolve({ ok: false, findings: [], elapsedMs: Date.now() - start, error: 'failed to spawn nuclei' });
    });
  });
}

function listTemplates() {
  return new Promise((resolve) => {
    if (!isInstalled()) {
      return resolve({ ok: false, templates: [], error: 'nuclei not installed' });
    }

    fs.readdir(TEMPLATES_DIR, { recursive: true }, (err, files) => {
      if (err) {
        return resolve({ ok: false, templates: [], error: err.message });
      }
      const templates = (files || [])
        .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
        .sort();
      resolve({ ok: true, templates, error: null });
    });
  });
}

function updateTemplates() {
  return new Promise((resolve) => {
    if (!isInstalled()) {
      return resolve({ ok: false, error: 'nuclei not installed' });
    }

    execFile(NUCLEI_BIN, ['-update-templates'], { timeout: 120000 }, (error, stdout, stderr) => {
      if (error) {
        return resolve({ ok: false, error: error.message });
      }
      resolve({ ok: true, output: stdout || stderr, error: null });
    });
  });
}

module.exports = { isInstalled, scan, listTemplates, updateTemplates };
