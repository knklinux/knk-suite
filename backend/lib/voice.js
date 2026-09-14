'use strict';

// ============================================================================
// voice.js — Voz de Electra: TTS (edge-tts, gratis, sin clave) + STT (whisper)
// Voces femeninas latinas: es-CO-SalomeNeural (Colombia) y
// es-DO-RamonaNeural (Dominicana).
// ============================================================================

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');

const VOICE_DIR = path.join(os.homedir(), '.knk-suite', 'voice');
const TMP_DIR = path.join(os.homedir(), '.knk-suite', 'tmp');

const VOICES = {
  salome: { id: 'es-CO-SalomeNeural', label: 'Salomé — Colombia ♀', lang: 'es-CO', feminine: true },
  ramona: { id: 'es-DO-RamonaNeural', label: 'Ramona — Dominicana ♀', lang: 'es-DO', feminine: true },
  gonzalo: { id: 'es-CO-GonzaloNeural', label: 'Gonzalo — Colombia ♂', lang: 'es-CO', feminine: false },
};

const DEFAULT_VOICE = 'salome';

function ensureDir(d) {
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
}

function pickPython() {
  for (const c of ['python', 'python3', 'py']) {
    try {
      require('child_process').execFileSync(c, ['--version'], { timeout: 5000, windowsHide: true });
      return c;
    } catch {}
  }
  return null;
}

function speak(text, voiceKey = DEFAULT_VOICE) {
  return new Promise((resolve) => {
    const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
    if (!clean) return resolve({ ok: false, error: 'Texto vacío' });
    const voice = (VOICES[voiceKey] || VOICES[DEFAULT_VOICE]).id;
    const py = pickPython();
    if (!py) return resolve({ ok: false, error: 'Python no encontrado' });
    ensureDir(VOICE_DIR);
    const hash = crypto.createHash('sha1').update(`${voice}:${clean}`).digest('hex');
    const out = path.join(VOICE_DIR, `${hash}.mp3`);
    if (fs.existsSync(out) && fs.statSync(out).size > 0) {
      return resolve({ ok: true, file: out, cached: true, voice });
    }
    const code = 'import asyncio,edge_tts,sys; asyncio.run(edge_tts.Communicate(sys.argv[1],sys.argv[2]).save(sys.argv[3]))';
    execFile(py, ['-c', code, clean, voice, out], { timeout: 60000, windowsHide: true }, (err) => {
      if (err) return resolve({ ok: false, error: `TTS falló: ${(err.message || '').slice(0, 200)} (¿pip install edge-tts?)` });
      if (!fs.existsSync(out)) return resolve({ ok: false, error: 'TTS sin audio' });
      resolve({ ok: true, file: out, cached: false, voice });
    });
  });
}

function transcribe(audioBase64, ext = 'webm') {
  return new Promise((resolve) => {
    const cleanExt = String(ext || 'webm').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'webm';
    let buf;
    try { buf = Buffer.from(String(audioBase64 || ''), 'base64'); }
    catch { return resolve({ ok: false, error: 'Audio inválido' }); }
    if (!buf.length || buf.length > 10 * 1024 * 1024) {
      return resolve({ ok: false, error: 'Audio vacío o mayor de 10 MB' });
    }
    ensureDir(TMP_DIR);
    const file = path.join(TMP_DIR, `stt-${Date.now()}.${cleanExt}`);
    try { fs.writeFileSync(file, buf); } catch (e) { return resolve({ ok: false, error: e.message }); }
    let whisper;
    try { whisper = require('whisper-node'); }
    catch { try { fs.unlinkSync(file); } catch {} return resolve({ ok: false, error: 'whisper-node no instalado' }); }
    const run = typeof whisper === 'function' ? whisper : whisper.transcribe || whisper.default;
    if (typeof run !== 'function') {
      try { fs.unlinkSync(file); } catch {}
      return resolve({ ok: false, error: 'whisper-node sin función válida' });
    }
    Promise.resolve()
      .then(() => run(file, { modelName: 'tiny', language: 'es', whisperOptions: { language: 'es' } }))
      .then((out) => {
        try { fs.unlinkSync(file); } catch {}
        const text = Array.isArray(out) ? out.map((s) => s.speech).join(' ').trim() : String((out && out.transcription) || out || '').trim();
        if (!text) return resolve({ ok: false, error: 'Sin transcripción (¿modelo descargándose? reintenta en 1 min)' });
        resolve({ ok: true, text });
      })
      .catch((e) => {
        try { fs.unlinkSync(file); } catch {}
        resolve({ ok: false, error: `STT falló: ${String((e && e.message) || e).slice(0, 200)}` });
      });
  });
}

module.exports = { VOICES, DEFAULT_VOICE, speak, transcribe, VOICE_DIR };
