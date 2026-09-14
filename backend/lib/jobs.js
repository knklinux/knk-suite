'use strict';

// ============================================================================
// lib/jobs.js — Motor de trabajos asíncronos con progreso y cancelación
//
// Reemplaza la ejecución síncrona dentro de requests HTTP. Cada job:
//  - corre en proceso hijo ligero (child_process) o función interna;
//  - registra progreso, salida y estado;
//  - es cancelable mientras corre;
//  - persiste en memoria (SQLite más adelante si hace falta histórico).
// ============================================================================

const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const JOBS = new Map(); // id → job
let SEQ = 0;

function newId() {
  SEQ += 1;
  return `job_${Date.now().toString(36)}_${SEQ}`;
}

function snapshot(job) {
  return {
    id: job.id,
    name: job.name,
    status: job.status, // queued|running|done|error|canceled
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    endedAt: job.endedAt || null,
    exitCode: job.exitCode,
    progress: job.progress, // 0..100 | null
    output: job.output.slice(-8000),
    unlock: job.unlock || null, // metadatos de desbloqueo (asistente paso a paso)
  };
}

function listJobs() {
  return [...JOBS.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50)
    .map(snapshot);
}

function getJob(id) {
  const j = JOBS.get(id);
  return j ? snapshot(j) : null;
}

function cancelJob(id) {
  const j = JOBS.get(id);
  if (!j) return { ok: false, error: 'Job no encontrado' };
  if (j.status !== 'running' && j.status !== 'queued') return { ok: false, error: `No cancelable en estado ${j.status}` };
  if (j.child && j.child.kill) {
    try { j.child.kill(); } catch {}
  }
  if (j.onCancel) { try { j.onCancel(); } catch {} }
  j.status = 'canceled';
  j.endedAt = Date.now();
  return { ok: true, job: snapshot(j) };
}

/**
 * Lanza un comando como job.
 * opts: { name, command (string), cwd, timeoutMs, env }
 */
function runCommand(opts) {
  const id = newId();
  const job = {
    id,
    name: opts.name || opts.command.slice(0, 60),
    command: opts.command,
    status: 'queued',
    createdAt: Date.now(),
    output: [],
    progress: null,
    child: null,
  };
  JOBS.set(id, job);

  const cwd = opts.cwd || ROOT;
  const timeoutMs = opts.timeoutMs || 10 * 60 * 1000;

  setTimeout(() => {
    if (job.status !== 'queued') return;
    job.status = 'running';
    job.startedAt = Date.now();
    try {
      job.child = spawn(opts.command, { cwd, shell: true, env: { ...process.env, ...(opts.env || {}) } });
    } catch (e) {
      job.status = 'error';
      job.output.push(`[spawn-error] ${e.message}`);
      job.endedAt = Date.now();
      return;
    }
    const push = (line) => {
      job.output.push(line);
      if (job.output.length > 2000) job.output.splice(0, job.output.length - 2000);
    };
    job.child.stdout?.on('data', (d) => String(d).split(/\r?\n/).forEach((l) => l && push(l)));
    job.child.stderr?.on('data', (d) => String(d).split(/\r?\n/).forEach((l) => l && push(`[err] ${l}`)));
    job.child.on('error', (e) => { push(`[error] ${e.message}`); });
    job.child.on('close', (code, signal) => {
      job.exitCode = code;
      job.endedAt = Date.now();
      if (job.status === 'canceled') return;
      job.status = signal ? 'canceled' : code === 0 ? 'done' : 'error';
    });
    job.timer = setTimeout(() => {
      if (job.status === 'running') { try { job.child.kill(); } catch {} job.status = 'error'; job.output.push('[timeout]'); job.endedAt = Date.now(); }
    }, timeoutMs);
  }, 0);

  return snapshot(job);
}

/** Registra un job gestionado externamente (jobs de tipo función). */
function _registerCustom(job) {
  if (!job.id) job.id = newId();
  if (!job.output) job.output = [];
  JOBS.set(job.id, job);
  return job;
}

module.exports = { runCommand, cancelJob, getJob, listJobs, _registerCustom };
