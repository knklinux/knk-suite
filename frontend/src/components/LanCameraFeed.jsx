import React, { useEffect, useMemo, useRef, useState } from 'react';

// ============================================================================
// LanCameraFeed.jsx — reproductor de cámaras de la LAN vía relé del backend
//
// ¿POR QUÉ?
// El workbench de escritorio (Tauri) sirve la SPA desde http://127.0.0.1:8086 y
// su CSP solo permite imágenes de 'self'. Un <img src="http://192.168.1.50:8080/
// video"> se bloquea sin decir nada: la cámara funciona y la UI muestra igual
// "no se pudo conectar". Aquí la URL de la cámara se reenvía por el backend
// (`/api/cameras/local/stream`), que es same-origin, así que el CSP no se abre
// a la LAN y no hay que pelear con CORS ni con contenido mixto.
//
// El backend solo reenvía IPv4 privada RFC1918 en puertos HTTP de cámara y solo
// respuestas de imagen/MJPEG; ver backend/lib/lan-relay.js.
//
// DOS MODOS
//   🎞️ en directo → multipart/x-mixed-replace; si la cámara no lo sirve, el
//      <img> falla y se pasa solo a modo fotograma.
//   📷 fotograma  → un único frame refrescado en bucle (cámaras que solo
//      exponen snapshot).
// ============================================================================

const POLL_MS = 3000;

/** ¿Es una IPv4 privada RFC1918 servible por el relé? */
export function isPrivateLanUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(parsed.hostname);
    if (!match) return false;
    const octets = match.slice(1, 5).map(Number);
    if (octets.some((n) => n > 255)) return false;
    const [a, b] = octets;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Motivo por el que una URL no se puede relayar (o null si sí se puede).
 * Espeja las barreras del backend para explicar la UI sin llamar al API.
 */
export function lanRelayBlockReason(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ''));
  } catch {
    return 'URL inválida';
  }
  if (parsed.protocol === 'rtsp:') return 'RTSP no se reproduce en el navegador — ábrelo en VLC';
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return `protocolo no soportado (${parsed.protocol})`;
  if (parsed.username || parsed.password) return 'no se permiten credenciales en la URL';
  if (!isPrivateLanUrl(rawUrl)) return 'el relé solo reenvía redes privadas de tu LAN (RFC1918)';
  const port = parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
  if (![80, 443, 8000, 8080, 8443].includes(port)) return `puerto fuera de los habituales de cámara (${port})`;
  return null;
}

/** URL del relé en modo stream continuo. */
export function lanStreamUrl(rawUrl, nonce = 0) {
  if (!isPrivateLanUrl(rawUrl)) return null;
  return `/api/cameras/local/stream?url=${encodeURIComponent(rawUrl)}${nonce ? `&n=${nonce}` : ''}`;
}

/** URL del relé en modo fotograma único (buffered). */
export function lanSnapshotUrl(rawUrl, tick = 0) {
  if (!isPrivateLanUrl(rawUrl)) return null;
  return `/api/cameras/local/relay?url=${encodeURIComponent(rawUrl)}&t=${tick}`;
}

// Un endpoint con pinta de foto suelta se sirve mejor por el relé buffered;
// una ruta MJPEG solo funciona en modo stream.
function looksLikeSnapshot(rawUrl) {
  return /(snapshot|picture|snap|still|image|\.jpe?g|\.png)/i.test(String(rawUrl || ''));
}

function CopyButton({ text, title = 'Copiar URL' }) {
  const [done, setDone] = useState(false);
  return (
    <button title={title} onClick={(e) => {
      e.stopPropagation();
      navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }, () => {});
    }} style={{
      fontSize: 8, padding: '1px 5px', background: 'var(--panel)', color: done ? 'var(--green)' : 'var(--muted)',
      border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', whiteSpace: 'nowrap',
    }}>{done ? '✓' : '📋'}</button>
  );
}

/**
 * Reproductor de una cámara de la LAN. `fallbackUrl` es la URL de snapshot de
 * la misma cámara, si el escáner la conoce (se usa cuando el MJPEG falla).
 */
export default function LanCameraFeed({ stream, fallbackUrl, height = 170, autoStart = true }) {
  const rawUrl = stream?.url || '';
  const candidates = useMemo(() => {
    const list = [rawUrl];
    if (fallbackUrl && fallbackUrl !== rawUrl) list.push(fallbackUrl);
    return list;
  }, [rawUrl, fallbackUrl]);

  const [candidateIndex, setCandidateIndex] = useState(0);
  const [mode, setMode] = useState(autoStart && !looksLikeSnapshot(rawUrl) ? 'live' : 'frame');
  const [tick, setTick] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState('loading'); // loading | ok | error
  const [reason, setReason] = useState('');
  const [showDetail, setShowDetail] = useState(false);
  const attempts = useRef(0);

  const candidate = candidates[Math.min(candidateIndex, candidates.length - 1)];
  const blocked = lanRelayBlockReason(candidate);
  const relayed = !blocked;

  const src = relayed
    ? (mode === 'frame' ? lanSnapshotUrl(candidate, tick) : lanStreamUrl(candidate, nonce))
    : null;

  useEffect(() => {
    setState('loading');
    setReason('');
  }, [src]);

  // Refresco del modo fotograma: se reescribe el src para forzar una petición
  // nueva (el backend responde no-store).
  useEffect(() => {
    if (!relayed || mode !== 'frame' || state === 'error') return undefined;
    const timer = setInterval(() => setTick((t) => t + 1), POLL_MS);
    return () => clearInterval(timer);
  }, [relayed, mode, state]);

  // Diagnóstico: la respuesta del relé explica el motivo real del fallo.
  const handleError = async () => {
    setState('error');
    if (src) {
      try {
        const response = await fetch(src, { credentials: 'same-origin' });
        const body = await response.json();
        if (body?.error) setReason(body.error);
      } catch { /* sin cuerpo legible: se usa el motivo genérico */ }
    }
    // Primer fallo en directo: muchas cámaras solo sirven fotogramas.
    if (mode === 'live') { setMode('frame'); setState('loading'); return; }
    // Fallo en modo fotograma: si hay otra URL conocida de la misma cámara, se prueba.
    if (candidateIndex + 1 < candidates.length && attempts.current < 1) {
      attempts.current += 1;
      setMode('live');
      setCandidateIndex((i) => i + 1);
      setState('loading');
    }
  };

  const retry = () => {
    attempts.current = 0;
    setCandidateIndex(0);
    setMode(looksLikeSnapshot(rawUrl) ? 'frame' : 'live');
    setNonce((n) => n + 1);
    setTick((t) => t + 1);
    setState('loading');
    setReason('');
  };

  const headerColor = state === 'ok' ? 'var(--green)' : state === 'error' ? 'var(--yellow)' : 'var(--primary)';

  return (
    <div style={{ border: `1px solid ${state === 'error' ? 'var(--border)' : headerColor}`, borderRadius: 6, overflow: 'hidden', background: '#000' }}>
      <div style={{
        fontSize: 8, padding: '2px 6px', background: 'rgba(255,255,255,0.04)', color: headerColor,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6,
      }}>
        <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {relayed ? (mode === 'live' ? '🎞️' : '📷') : '🚫'} {stream?.label || 'stream'}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {relayed && <span title="Se reenvía por el backend local (same-origin): el CSP del escritorio no bloquea la LAN">🔌 relay</span>}
          {relayed && (
            <button title={mode === 'live' ? 'Congelar en fotograma' : 'Intentar en directo'}
              onClick={() => { setMode(mode === 'live' ? 'frame' : 'live'); setState('loading'); setReason(''); }}
              style={{ fontSize: 8, padding: '1px 5px', background: 'var(--panel)', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer' }}>
              {mode === 'live' ? '📷' : '🎞️'}
            </button>
          )}
          <CopyButton text={candidate} />
          <button title="Detalles" onClick={() => setShowDetail((v) => !v)}
            style={{ fontSize: 8, padding: '1px 5px', background: 'var(--panel)', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer' }}>ⓘ</button>
        </span>
      </div>

      {!relayed && (
        <div style={{ padding: 12, fontSize: 9, color: 'var(--yellow)', fontFamily: 'monospace' }}>
          🚫 no relayable — {blocked}
          <div style={{ marginTop: 4, color: 'var(--muted)', fontSize: 8, wordBreak: 'break-all' }}>{candidate}</div>
        </div>
      )}

      {relayed && state !== 'error' && (
        <img src={src} alt={stream?.label || 'cámara LAN'}
          style={{ width: '100%', height, objectFit: 'contain', display: state === 'loading' ? 'none' : 'block' }}
          onLoad={() => setState('ok')}
          onError={handleError} />
      )}

      {relayed && state === 'loading' && (
        <div style={{ height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 9, color: 'var(--primary)', fontFamily: 'monospace' }}>
          <div style={{ fontSize: 18, animation: 'pulse 1.5s infinite' }}>📷</div>
          {mode === 'live' ? 'conectando stream…' : 'capturando fotograma…'}
        </div>
      )}

      {relayed && state === 'error' && (
        <div style={{ padding: 12, textAlign: 'center', fontSize: 9, color: 'var(--muted)', fontFamily: 'monospace' }}>
          ⚠️ la cámara no respondió por el relé
          {reason && <div style={{ marginTop: 4, color: 'var(--yellow)', wordBreak: 'break-word' }}>{reason}</div>}
          <button className="btn btn-sm" style={{ marginTop: 6, fontSize: 9 }} onClick={retry}>🔄 Reintentar</button>
        </div>
      )}

      {showDetail && (
        <div style={{ padding: '4px 6px', background: 'rgba(0,0,0,0.5)', borderTop: '1px solid var(--border)', fontSize: 8, fontFamily: 'monospace', color: 'var(--muted)', wordBreak: 'break-all' }}>
          <div>origen: {candidate}</div>
          <div>relé: {src || '—'}</div>
          <div>modo: {mode === 'live' ? 'MJPEG en directo' : `fotograma cada ${POLL_MS / 1000}s`}</div>
        </div>
      )}
    </div>
  );
}
