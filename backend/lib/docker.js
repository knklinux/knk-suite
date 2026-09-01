'use strict';

const { spawnSync } = require('child_process');
const CONTAINER = process.env.KNK_KALI_CONTAINER || 'knk-kali';
const ALLOWED_TOOLS = new Set(['nmap', 'httpx', 'nuclei', 'ffuf', 'subfinder', 'amass', 'whatweb', 'dirb', 'wpscan', 'katana', 'naabu', 'dnsx', 'gau', 'waybackurls', 'gospider', 'gf', 'dalfox', 'assetfinder', 'anew', 'qsreplace', 'gowitness']);
const ARG_RE = /^[a-zA-Z0-9_./:@%+=,-]+$/;

function runSg(args, timeout) {
  return spawnSync('sg', ['docker', '-c', args], { encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], killSignal: 'SIGKILL' });
}
function isRunning() {
  try { return runSg(`docker inspect -f '{{.State.Running}}' ${CONTAINER}`, 5000).stdout.trim() === 'true'; } catch { return false; }
}
function parseArgs(args) {
  if (Array.isArray(args)) return args;
  return String(args || '').match(/[^\s"']+/g) || [];
}
function exec(tool, args, opts = {}) {
  if (!ALLOWED_TOOLS.has(tool)) return { ok: false, output: 'tool_not_allowed', blocked: true };
  const argv = parseArgs(args);
  if (argv.length > 64 || argv.some(arg => !ARG_RE.test(arg))) return { ok: false, output: 'unsafe_arguments', blocked: true };
  const binary = tool === 'httpx' ? 'httpx-toolkit' : tool;
  const command = ['docker', 'exec', CONTAINER, binary, ...argv].map(value => `'${String(value).replace(/'/g, "'\\''")}'`).join(' ');
  try {
    const r = runSg(command, Math.min(Number(opts.timeoutMs) || 10000, 10000));
    if (r.error) return { ok: false, output: r.error.message, error: r.error.message };
    return { ok: r.status === 0, output: String(r.stdout || r.stderr || '').trim(), status: r.status };
  } catch (error) { return { ok: false, output: error.message }; }
}
function ensureRunning() {
  if (isRunning()) return true;
  try { runSg(`docker start '${CONTAINER.replace(/'/g, "'\\''")}'`, 30000); return isRunning(); } catch { return false; }
}
module.exports = { CONTAINER, ALLOWED_TOOLS, isRunning, exec, ensureRunning };
