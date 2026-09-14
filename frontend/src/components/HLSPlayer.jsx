import React, { useRef, useEffect, useState, useCallback } from 'react';

// ============================================================================
// HLSPlayer.jsx — Reproductor HLS vía proxy same-origin del backend
//
// Notas de campo (LL-HLS, p. ej. Chaturbate):
//  · Las partes (.m4s) caducan en segundos: un token/manifiesto viejo da 403
//    y NO se reintenta en bucle (antes el startLoad() giraba eternamente).
//  · Se arranca en la variante más baja (startLevel 0) para abrir rápido y
//    el ABR sube solo; capLevelToPlayerSize evita pedir 1080p en una tarjeta.
//  · El estado se decide con eventos del <video> (playing/waiting), no con
//    temporizadores: el directo LL-HLS puede tardar >12 s en arrancar.
// ============================================================================

function mapError(data, deniedHint) {
  const code = data?.response?.code;
  const details = String(data?.details || '');
  const hint = deniedHint ? ` ${deniedHint}` : '';
  if (code === 401 || code === 403 || /keyLoadError|keySystem/i.test(details)) {
    return `Acceso denegado o token caducado — se pidió señal fresca sola.${hint}`;
  }
  if (code === 404 || /manifestLoadError|levelLoadError/i.test(details) && /404/.test(details)) {
    return `Señal no encontrada (la sala/emisión puede haber cerrado).${hint}`;
  }
  if (/timeout|LoadTimeOut/i.test(details)) {
    return 'Red lenta o emisor saturado — Reintentar suele bastar.';
  }
  if (/bufferStalledError/i.test(details)) {
    return 'Emisor pausado: la fuente no envía segmentos nuevos.';
  }
  return details || 'Error de reproducción';
}

export default function HLSPlayer({ src, rawUrl, poster, width = 320, height = 180, autoPlay = true, muted = true, showCheck = false, onExpired, deniedHint, logCtx }) {
  const log = useCallback((stage, detail = '') => {
    try {
      fetch('/api/live/player-log', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view: (logCtx && logCtx.view) || '', label: (logCtx && logCtx.label) || '', stage, detail }),
      }).catch(() => {});
    } catch {}
  }, [logCtx]);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const startAt = useRef(0);
  const expiredTried = useRef(false);
  const fragLogged = useRef(false);
  const onExpiredRef = useRef(onExpired);
  onExpiredRef.current = onExpired;
  const [status, setStatus] = useState('idle'); // idle | loading | buffering | playing | error
  const [error, setError] = useState('');
  const [isMuted, setIsMuted] = useState(muted);
  const [attempt, setAttempt] = useState(0);
  const [diag, setDiag] = useState(null);
  const [quality, setQuality] = useState('');
  const [copied, setCopied] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [levels, setLevels] = useState([]);
  const [levelIdx, setLevelIdx] = useState(-1);
  const [vol, setVol] = useState(() => {
    try {
      const v = parseFloat(localStorage.getItem('knk_vol') ?? '1');
      return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
    } catch { return 1; }
  });
  const [big, setBig] = useState(false);
  const boxRef = useRef(null);

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch {}
      hlsRef.current = null;
    }
  }, []);

  const mountId = useRef(Math.random().toString(36).slice(2, 7));
  useEffect(() => {
    if (!src || !videoRef.current) return;
    let cancelled = false;
    startAt.current = Date.now();
    log('effect-run', `m=${mountId.current} attempt=${attempt}`);

    async function loadStream() {
      setStatus('loading');
      setError('');
      setDiag(null);
      setQuality('');
      setNeedsGesture(false);
      try {
        const u = new URL(src, window.location.origin);
        log('init', `${u.host}${u.pathname.slice(0, 40)}`);
      } catch { log('init', String(src).slice(0, 80)); }
      destroyHls();
      const video = videoRef.current;

      expiredTried.current = false;
      fragLogged.current = false;
      // React no siempre propaga `muted` a la propiedad del <video> y la
      // política de autoplay lo exige como PROPIEDAD, no como atributo.
      try {
        video.muted = true;
        video.defaultMuted = true;
        video.playsInline = true;
        video.volume = vol;
        setIsMuted(true);
      } catch {}
      const nativeCapable = (() => {
        try { return video.canPlayType('application/vnd.apple.mpegurl'); } catch { return ''; }
      })();
      const tryPlay = () => {
        if (!autoPlay) return;
        try {
          const p = video.play();
          if (p && p.catch) {
            p.catch((e) => {
              if (cancelled || !e) return;
              log('play-rejected', `${e.name || '?'}: ${(e.message || '').slice(0, 120)}`);
              if (e.name === 'NotAllowedError' || /not allowed|interrupted/i.test(e.message || '')) {
                setNeedsGesture(true);
              }
            });
          }
        } catch (e) {
          log('play-throw', String((e && e.message) || e).slice(0, 120));
        }
      };
      const fail = (msg) => {
        if (cancelled) return;
        log('fail', String(msg).slice(0, 200));
        // Token caducado nada más pedirlo: una renovación automática con
        // señal fresca suele bastar (solo una vez por reproducción).
        if (!expiredTried.current && onExpiredRef.current && /caducad|denegad|403|404|no encontrada/i.test(msg)) {
          expiredTried.current = true;
          destroyHls();
          setError('');
          setStatus('loading');
          try { onExpiredRef.current(); } catch {}
          return;
        }
        destroyHls();
        setError(msg);
        setStatus('error');
      };

      // Watchdog absoluto: 45 s sin imagen = error (las partes LL-HLS caducan
      // y reintentar con el mismo manifiesto no sirve; hay que pedir señal nueva).
      const watchdog = setTimeout(() => {
        if (cancelled || video.readyState >= 2) return;
        log('watchdog', `readyState=${video.readyState} net=${video.networkState} hls=${Boolean(hlsRef.current)}`);
        fail('Sin imagen tras 45 s — la señal puede haber caducado. Reintentar pide manifiesto fresco.');
      }, 45000);

      const clearWatchdog = () => clearTimeout(watchdog);

      // hls.js SIEMPRE primero: el HLS "nativo" del WebView2/Windows (Media
        // Foundation) declara canPlayType pero no traga LL-HLS/fmp4 y muere
        // con NotSupportedError sin decir nada útil. Nativo solo como último
        // recurso si hls.js no corre en este motor.
        const useNative = async () => {
          log('native-fallback', `cap=${nativeCapable || 'none'}`);
          video.src = src;
          video.load();
          tryPlay();
          video.onplaying = () => { if (!cancelled) { clearWatchdog(); setStatus('playing'); } };
          video.onwaiting = () => { if (!cancelled) setStatus((s) => (s === 'playing' ? 'buffering' : s)); };
          video.onerror = () => {
            if (cancelled) return;
            try {
              const e = video.error;
              log('native-error', `code=${e ? e.code : '?'}`);
            } catch {}
            fail('El navegador no pudo abrir el stream.');
          };
        };

      try {
        let Hls = null;
        try {
          ({ default: Hls } = await import('hls.js'));
        } catch (e) {
          log('hls-import-fail', String((e && e.message) || e).slice(0, 160));
        }
        if (cancelled) { clearWatchdog(); return; }
        if (!Hls || !Hls.isSupported()) {
          log('unsupported', `mse=${Boolean(window.MediaSource)} native=${nativeCapable || 'none'}`);
          if (nativeCapable) { await useNative(); return () => { cancelled = true; clearWatchdog(); }; }
          fail('HLS no soportado en este navegador');
          clearWatchdog();
          return;
        }

        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          capLevelToPlayerSize: true,
          startLevel: 0,
          backBufferLength: 30,
          maxBufferLength: 30,
          liveSyncDurationCount: 3,
          manifestLoadingTimeOut: 20000,
          manifestLoadingMaxRetry: 2,
          manifestLoadingRetryDelay: 1500,
          levelLoadingTimeOut: 20000,
          levelLoadingMaxRetry: 2,
          fragLoadingTimeOut: 25000,
          fragLoadingMaxRetry: 3,
          // La cookie knk_token viaja al proxy /api/* solo con credenciales.
          xhrSetup: (xhr) => { xhr.withCredentials = true; },
        });
        hlsRef.current = hls;

        hls.loadSource(src);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, (_, d) => {
          if (cancelled) return;
          log('manifest', `levels=${(d && d.levels && d.levels.length) || '?'} audio=${hls.audioTracks ? hls.audioTracks.length : '?'}`);
          tryPlay();
        });

        hls.on(Hls.Events.FRAG_BUFFERED, () => {
          if (cancelled || fragLogged.current) return;
          fragLogged.current = true;
          log('first-frag', `readyState=${video.readyState}`);
        });

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (cancelled) return;
          try {
            setLevels((hls.levels || []).map((l, i) => ({ i, h: l.height || 0, bw: l.bitrate || 0 })));
          } catch {}
        });

        hls.on(Hls.Events.LEVEL_SWITCHED, (_, d) => {
          if (cancelled) return;
          const lvl = hls.levels?.[d.level];
          if (lvl?.height) setQuality(`${lvl.height}p`);
          setLevelIdx(d.level);
        });

        let netRetries = 0;
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (cancelled || !data.fatal) return;
          log('fatal', `${data.type}/${data.details} code=${(data.response && data.response.code) || '-'}`);
          // 401/403/404 = token o sala muertos: fallar ya (con auto-renovación),
          // nunca en bucle. Los manifiestos tampoco se reintentan: si el
          // manifiesto muere, la señal está muerta.
          const code = data?.response?.code;
          const details = String(data.details || '');
          const isManifest = /manifest|levelLoad/i.test(details);
          if (code === 401 || code === 403 || code === 404 || isManifest) {
            fail(mapError(data, deniedHint));
            return;
          }
          // Solo fragmentos sueltos con error de red: 3 reintentos y fuera.
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR && netRetries < 3) {
            netRetries += 1;
            try { hls.startLoad(); } catch {}
            return;
          }
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            try { hls.recoverMediaError(); } catch {}
            setTimeout(() => {
              if (!cancelled && hlsRef.current === hls && video.readyState < 2 && Date.now() - startAt.current > 20000) {
                fail(mapError(data, deniedHint));
              }
            }, 8000);
            return;
          }
          fail(mapError(data, deniedHint));
        });

        video.onplaying = () => { if (!cancelled) { clearWatchdog(); setStatus('playing'); } };
        video.onwaiting = () => { if (!cancelled) setStatus((s) => (s === 'playing' ? 'buffering' : s)); };
      } catch (e) {
        if (!cancelled) fail(e.message);
      }

      return () => { cancelled = true; clearWatchdog(); };
    }

    loadStream();
    return () => { log('effect-cleanup', `m=${mountId.current}`); cancelled = true; destroyHls(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, autoPlay, attempt]);

  const handleRetry = () => {
    // Con fuente renovable (salas con token), Reintentar pide señal fresca
    // en vez de reusar la URL muerta. Sin ella, recarga lo mismo.
    if (onExpiredRef.current) {
      setNeedsGesture(false);
      setError('');
      setStatus('loading');
      try { onExpiredRef.current(); } catch {}
      return;
    }
    if (videoRef.current) {
      try { videoRef.current.removeAttribute('src'); videoRef.current.load(); } catch {}
    }
    setNeedsGesture(false);
    setAttempt((a) => a + 1);
  };

  const handleGesturePlay = (e) => {
    e.stopPropagation();
    setNeedsGesture(false);
    if (videoRef.current) {
      try {
        videoRef.current.muted = true;
        const p = videoRef.current.play();
        if (p && p.catch) p.catch(() => setNeedsGesture(true));
      } catch { setNeedsGesture(true); }
    }
  };

  const copyUrl = async () => {
    const u = rawUrl || src;
    try {
      await navigator.clipboard?.writeText(u);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const runCheck = async () => {
    setDiag({ loading: true });
    try {
      let remote = rawUrl || src;
      try {
        const u = new URL(remote, window.location.origin);
        remote = u.searchParams.get('url') || remote;
      } catch {}
      const r = await fetch(`/api/cameras/public/hls-check?url=${encodeURIComponent(remote)}`, { credentials: 'same-origin' });
      setDiag(await r.json());
    } catch (e) {
      setDiag({ ok: false, error: e.message });
    }
  };

  const toggleMute = (e) => {
    e.stopPropagation();
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setIsMuted(videoRef.current.muted);
    }
  };

  const changeVol = (v) => {
    const nv = Math.min(1, Math.max(0, Number(v)));
    setVol(nv);
    try { localStorage.setItem('knk_vol', String(nv)); } catch {}
    if (videoRef.current) {
      videoRef.current.volume = nv;
      if (nv > 0 && videoRef.current.muted) {
        videoRef.current.muted = false;
        setIsMuted(false);
      }
    }
  };

  const pickLevel = (i) => {
    setLevelIdx(i);
    try {
      if (hlsRef.current) hlsRef.current.currentLevel = i;
    } catch {}
  };

  const toggleBig = (e) => {
    e.stopPropagation();
    setBig((b) => !b);
  };

  const toggleFs = (e) => {
    e.stopPropagation();
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else boxRef.current?.requestFullscreen?.();
    } catch {}
  };

  const boxH = big ? 'min(72vh, 640px)' : height;
  return (
    <div ref={boxRef} style={{ position: 'relative', width, height: boxH, background: '#000', borderRadius: 6, overflow: 'hidden' }}>
      <video
        ref={videoRef}
        poster={poster}
        muted={isMuted}
        playsInline
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        controls={false}
      />
      {(status === 'loading' || status === 'buffering') && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
          background: status === 'loading' ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.35)', color: '#08d8ff', fontSize: 12, fontFamily: 'monospace',
          pointerEvents: 'none',
        }}>
          <div>⏳ {status === 'loading' ? 'Cargando stream…' : 'Recibiendo señal…'}</div>
          <div style={{ fontSize: 9, color: 'var(--muted)' }}>el directo LL-HLS puede tardar unos segundos</div>
        </div>
      )}
      {status === 'error' && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.88)', color: '#ff5149', fontSize: 11, fontFamily: 'monospace', gap: 6, padding: 10, textAlign: 'center',
        }}>
          <div>❌ {error || 'Error'}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button onClick={handleRetry} style={miniBtn('#08d8ff')}>Reintentar</button>
            <button onClick={copyUrl} style={miniBtn('var(--muted)')}>{copied ? '✓ URL copiada (ábrela en VLC)' : 'Copiar URL (VLC)'}</button>
            {showCheck && <button onClick={runCheck} style={miniBtn('var(--muted)')}>Diagnosticar</button>}
          </div>
          {diag && !diag.loading && (
            <div style={{ fontSize: 9, color: diag.ok ? 'var(--green)' : 'var(--yellow)', wordBreak: 'break-word' }}>
              {diag.ok ? `Upstream ${diag.upstream?.status} · ${diag.segmentsFound} segmentos` : `Diag: ${diag.error || 'fallo'}`}
            </div>
          )}
        </div>
      )}
      {needsGesture && status !== 'error' && (
        <button onClick={handleGesturePlay} title="El navegador exige un clic para reproducir"
          style={{
            position: 'absolute', inset: 0, margin: 'auto', width: 64, height: 64, borderRadius: '50%',
            background: 'rgba(63,185,80,0.9)', color: '#fff', fontSize: 26, border: '2px solid #fff',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          ▶
        </button>
      )}
      {status === 'playing' && (
        <div style={{
          position: 'absolute', top: 4, left: 4, padding: '2px 6px',
          background: 'rgba(63,185,80,0.85)', borderRadius: 3, fontSize: 9, color: '#fff',
          fontFamily: 'monospace', fontWeight: 700,
        }}>
          🔴 LIVE{quality ? ` ${quality}` : ''}
        </div>
      )}
      <div style={{ position: 'absolute', bottom: 4, right: 4, display: 'flex', gap: 4 }}>
        {levels.length > 1 && (
          <select value={levelIdx} onChange={(e) => pickLevel(Number(e.target.value))} title="Calidad"
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'rgba(0,0,0,0.6)', color: '#fff', border: '1px solid var(--border)', borderRadius: 4, fontSize: 9, padding: '2px 4px', cursor: 'pointer', maxWidth: 76 }}>
            <option value={-1}>AUTO{quality ? ` ${quality}` : ''}</option>
            {levels.map((l) => <option key={l.i} value={l.i}>{l.h ? `${l.h}p` : `N${l.i + 1}`}</option>)}
          </select>
        )}
        <button onClick={toggleBig} title={big ? 'Tamaño normal' : 'Más grande'}
          style={{ width: 26, height: 26, background: 'rgba(0,0,0,0.6)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', color: '#fff', fontSize: 12, lineHeight: 1 }}>
          {big ? '➖' : '➕'}
        </button>
        <button onClick={toggleFs} title="Pantalla completa"
          style={{ width: 26, height: 26, background: 'rgba(0,0,0,0.6)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', color: '#fff', fontSize: 12, lineHeight: 1 }}>
          ⛶
        </button>
        {!isMuted && (
          <input type="range" min="0" max="1" step="0.05" value={vol} title="Volumen"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => changeVol(e.target.value)}
            style={{ width: 56, accentColor: 'var(--primary)', cursor: 'pointer' }} />
        )}
        <button onClick={toggleMute} title={isMuted ? 'Activar sonido' : 'Silenciar'}
          style={{ width: 26, height: 26, background: 'rgba(0,0,0,0.6)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', color: '#fff', fontSize: 13, lineHeight: 1 }}>
          {isMuted ? '🔇' : '🔊'}
        </button>
      </div>
    </div>
  );
}

function miniBtn(color) {
  return {
    padding: '3px 10px', background: 'transparent', border: `1px solid ${color}`,
    borderRadius: 4, color, cursor: 'pointer', fontSize: 10,
  };
}
