import React, { useEffect, useRef } from 'react';

// ============================================================================
// ViewAmbient.jsx — Textura ambiental animada por módulo.
// Un solo canvas fijo detrás del contenido; cada vista tiene su propio FX y
// tinte, coherente con la estación del hub (ModuleGrid). Todo de baja opacidad,
// pointer-events:none y pausado si la pestaña no es visible.
// FX: scanlines, radar, wave, matrix, shelf (bóveda), grid, orbit, flow, seal.
// ============================================================================

const MODES = {
  dashboard:  { fx: 'grid',      tint: '#08b9ff', op: .20 },
  targets:    { fx: 'radar',     tint: '#08b9ff', op: .38 },
  opplan:     { fx: 'grid',      tint: '#5b8dd6', op: .16 },
  pipeline:   { fx: 'matrix',    tint: '#42e6a4', op: .30 },
  jobs:       { fx: 'orbit',     tint: '#f3c75f', op: .34 },
  terminal:   { fx: 'scanlines', tint: '#b12cff', op: .34 },
  gates:      { fx: 'grid',      tint: '#42e6a4', op: .20 },
  revocation: { fx: 'wave',      tint: '#b98cff', op: .26, dual: '#42e6a4' },
  assistant:  { fx: 'wave',      tint: '#08d8ff', op: .34 },
  chat:       { fx: 'wave',      tint: '#8b98ab', op: .18 },
  vault:      { fx: 'shelf',     tint: '#7aa2ff', op: .34 },
  reportes:   { fx: 'flow',      tint: '#ff8b4a', op: .26 },
  compliance: { fx: 'seal',      tint: '#58a6ff', op: .30 },
  cheatsheet: { fx: 'matrix',    tint: '#5b8dd6', op: .16 },
};

export default function ViewAmbient({ view, intensity = 1, disabled = {} }) {
  const ref = useRef(null);
  const stateRef = useRef({});

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !cv.getContext) return undefined;
    const ctx = cv.getContext('2d');
    if (!ctx) return undefined;

    const st = stateRef.current;
    st.w = 0; st.h = 0; st.dpr = Math.min(window.devicePixelRatio || 1, 1.5); st._intensity = intensity; st._disabled = !!disabled[view];

    const resize = () => {
      st.w = window.innerWidth; st.h = window.innerHeight;
      cv.width = Math.floor(st.w * st.dpr); cv.height = Math.floor(st.h * st.dpr);
      cv.style.width = st.w + 'px'; cv.style.height = st.h + 'px';
      ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
      st.static = null;          // invalida la capa prerenderizada
      st.init = null;            // invalida partículas/columnas
    };
    resize();
    window.addEventListener('resize', resize);

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let raf = 0; let running = true;

    const tick = (ts) => {
      if (!running) return;
      const mode = MODES[viewRef.current] || MODES.dashboard;
      draw(ctx, st, mode, ts / 1000, st.w, st.h);
      raf = requestAnimationFrame(tick);
    };

    // viewRef: la animación lee la vista actual sin re-suscribir el rAF
    viewRef.current = view;
    if (reduced) { draw(ctx, st, MODES[view] || MODES.dashboard, 1.7, st.w, st.h); }
    else { raf = requestAnimationFrame(tick); }

    const onVis = () => {
      if (document.hidden) { running = false; cancelAnimationFrame(raf); }
      else if (!running && !reduced) { running = true; raf = requestAnimationFrame(tick); }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      running = false; cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [view, intensity, disabled[view]]);

  // ref espejo para leer la vista dentro del bucle
  const viewRef = useRef(view);
  viewRef.current = view;

  return <canvas ref={ref} className="view-ambient" aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// Capa estática prerenderizada (anillos, estantería, rejilla): se dibuja una
// vez por tamaño y cada frame solo se pinta encima el elemento animado.
// ---------------------------------------------------------------------------
function staticLayer(st, w, h, build) {
  if (!st.static) {
    const off = document.createElement('canvas');
    off.width = Math.floor(w * st.dpr); off.height = Math.floor(h * st.dpr);
    const o = off.getContext('2d');
    o.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    build(o, w, h);
    st.static = off;
  }
  return st.static;
}

function draw(ctx, st, mode, t, w, h) {
  const tint = mode.tint;
  ctx.clearRect(0, 0, w, h);
  if (st._disabled) { ctx.globalAlpha = 1; return; }
  const op = (mode.op || 1) * (st._intensity ?? 1);
  ctx.globalAlpha = Math.max(0, Math.min(1, op));
  ({ scanlines, radar, wave, matrix, shelf, grid, orbit, flow, seal })[mode.fx](ctx, st, mode, t, w, h);
  ctx.globalAlpha = 1;
}

// ── Terminal: scanlines CRT + banda que recorre la pantalla ────────────────
function scanlines(ctx, st, mode, t, w, h) {
  const off = staticLayer(st, w, h, (o) => {
    o.fillStyle = 'rgba(177,44,255,.05)';
    for (let y = 0; y < h; y += 4) o.fillRect(0, y, w, 1);
  });
  ctx.drawImage(off, 0, 0, w, h);
  const bandY = ((t * 60) % (h + 180)) - 90;
  const g = ctx.createLinearGradient(0, bandY - 90, 0, bandY + 90);
  g.addColorStop(0, 'rgba(177,44,255,0)');
  g.addColorStop(.5, 'rgba(177,44,255,.14)');
  g.addColorStop(1, 'rgba(177,44,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, bandY - 90, w, 180);
}

// ── Targets: radar — anillos estáticos + barrido giratorio + blips ─────────
function radar(ctx, st, mode, t, w, h) {
  const cx = w - w * .22, cy = h * .30, R = Math.min(w, h) * .34;
  const off = staticLayer(st, w, h, (o) => {
    o.strokeStyle = 'rgba(8,185,255,.16)'; o.lineWidth = 1;
    for (let r = R; r > 30; r -= R / 4) { o.beginPath(); o.arc(cx, cy, r, 0, 7); o.stroke(); }
    o.beginPath(); o.moveTo(cx - R, cy); o.lineTo(cx + R, cy); o.moveTo(cx, cy - R); o.lineTo(cx, cy + R); o.stroke();
  });
  ctx.drawImage(off, 0, 0, w, h);
  const a = (t * .7) % (Math.PI * 2);
  const g = ctx.createConicGradient ? ctx.createConicGradient(a, cx, cy) : null;
  if (g) {
    g.addColorStop(0, 'rgba(8,185,255,.28)'); g.addColorStop(.10, 'rgba(8,185,255,0)'); g.addColorStop(1, 'rgba(8,185,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a, a + Math.PI * 2); ctx.fill();
  }
  // blips que laten cuando el barrido pasa cerca de su ángulo
  [[.9, .35], [2.4, .55], [4.4, .25]].forEach(([ang, rr]) => {
    const d = Math.abs(((a - ang) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2));
    const near = Math.max(0, 1 - d / 1.2);
    if (near < .05) return;
    ctx.fillStyle = `rgba(8,220,255,${.5 * near})`;
    ctx.beginPath(); ctx.arc(cx + Math.cos(ang) * R * rr, cy + Math.sin(ang) * R * rr, 2.6 + near * 1.6, 0, 7); ctx.fill();
  });
}

// ── Assistant/Chat/Revocación: ondas superiores (A/B usa doble tinte) ──────
function wave(ctx, st, mode, t, w, h) {
  const cols = mode.dual ? [mode.tint, mode.dual, '#08b9ff'] : [mode.tint, '#b12cff', '#08b9ff'];
  cols.forEach((c, i) => {
    ctx.beginPath();
    for (let x = 0; x <= w; x += 9) {
      const y = h * .78 + Math.sin(x * .011 + t * (1.1 + i * .35) + i * 2.1) * (16 + i * 9)
        + Math.sin(x * .004 - t * .8) * 9;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = c + '55'; ctx.lineWidth = 1.4; ctx.stroke();
  });
}

// ── Pipeline/Cheatsheet: lluvia estilo matriz, tenue ───────────────────────
function matrix(ctx, st, mode, t, w, h) {
  if (!st.init) {
    const cols = [];
    for (let x = 10; x < w; x += 22) cols.push({ x, y: Math.random() * h, v: 60 + Math.random() * 130 });
    st.init = { cols, chars: '01ｱｲｳｴｶｷｽﾓﾝ#$%'.split('') };
  }
  const { cols, chars } = st.init;
  ctx.font = '12px "Cascadia Code", Consolas, monospace';
  cols.forEach(c => {
    const y0 = ((c.y + t * c.v) % (h + 260)) - 130;
    for (let k = 0; k < 10; k++) {
      const yy = y0 - k * 13; if (yy < -14 || yy > h) continue;
      ctx.fillStyle = k === 0 ? mode.tint + '66' : mode.tint + (k < 3 ? '22' : '11');
      ctx.fillText(chars[(c.x + k + Math.floor(t * 2)) % chars.length], c.x, yy);
    }
  });
}

// ── Bóveda: estantería — baldas con lomos de libros + barrido de luz ───────
function shelf(ctx, st, mode, t, w, h) {
  const off = staticLayer(st, w, h, (o) => {
    const shelfH = 74;
    for (let sy = h - 40; sy > 90; sy -= shelfH) {
      o.fillStyle = 'rgba(122,162,255,.10)';
      o.fillRect(30, sy, w - 60, 2);
      let x = 44; let seed = sy;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      while (x < w - 60) {
        const bw = 9 + rnd() * 16, bh = 34 + rnd() * 30;
        o.fillStyle = `rgba(122,162,255,${.05 + rnd() * .09})`;
        o.fillRect(x, sy - bh, bw, bh - 2);
        x += bw + 2 + rnd() * 5;
      }
    }
  });
  ctx.drawImage(off, 0, 0, w, h);
  // luz que recorre las baldas como una lámpara pasando
  const lx = ((t * 40) % (w + 300)) - 150;
  const g = ctx.createLinearGradient(lx - 150, 0, lx + 150, 0);
  g.addColorStop(0, 'rgba(122,162,255,0)'); g.addColorStop(.5, 'rgba(122,162,255,.10)'); g.addColorStop(1, 'rgba(122,162,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

// ── Panel/OPPLAN/Compuertas: rejilla con pulso lento ───────────────────────
function grid(ctx, st, mode, t, w, h) {
  const off = staticLayer(st, w, h, (o) => {
    o.strokeStyle = mode.tint + '14'; o.lineWidth = 1;
    for (let x = 0; x < w; x += 46) { o.beginPath(); o.moveTo(x, 0); o.lineTo(x, h); o.stroke(); }
    for (let y = 0; y < h; y += 46) { o.beginPath(); o.moveTo(0, y); o.lineTo(w, y); o.stroke(); }
  });
  ctx.drawImage(off, 0, 0, w, h);
  const p = .5 + .5 * Math.sin(t * .9);
  ctx.fillStyle = mode.tint + '0d';
  ctx.beginPath(); ctx.arc(w * .82, h * .18, 90 + p * 26, 0, 7); ctx.fill();
}

// ── Trabajos: órbitas ámbar — puntos girando en anillos concéntricos ───────
function orbit(ctx, st, mode, t, w, h) {
  const cx = w * .84, cy = h * .2;
  ctx.strokeStyle = 'rgba(243,199,95,.10)';
  [36, 72, 110].forEach(r => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke(); });
  [36, 72, 110].forEach((r, i) => {
    const a = t * (.5 - i * .14) + i * 2;
    ctx.fillStyle = 'rgba(243,199,95,.5)';
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2.4, 0, 7); ctx.fill();
  });
}

// ── Reportes: líneas de texto que ascienden como páginas pasando ───────────
function flow(ctx, st, mode, t, w, h) {
  if (!st.init) {
    const lines = [];
    for (let i = 0; i < 16; i++) lines.push({ x: 40 + Math.random() * (w * .5), y: Math.random() * h, v: 14 + Math.random() * 22, wd: 60 + Math.random() * 160 });
    st.init = { lines };
  }
  st.init.lines.forEach(l => {
    const y = h - ((l.y + t * l.v) % (h + 40));
    ctx.fillStyle = 'rgba(255,139,74,.10)';
    ctx.fillRect(l.x, y, l.wd, 1.5);
    ctx.fillStyle = 'rgba(255,139,74,.05)';
    ctx.fillRect(l.x + 8, y + 7, l.wd * .7, 1);
  });
}

// ── Cumplimiento: sello — anillos dashed girando lento ────────────────────
function seal(ctx, st, mode, t, w, h) {
  const cx = w * .18, cy = h * .8;
  [[54, .8, 8], [84, -.5, 14], [116, .3, 20]].forEach(([r, sp, dash], i) => {
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(t * sp);
    ctx.strokeStyle = `rgba(88,166,255,${.22 - i * .05})`; ctx.lineWidth = 1.2;
    ctx.setLineDash([dash, 9]);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
    ctx.restore();
  });
  ctx.setLineDash([]);
}
