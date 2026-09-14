import React from 'react';

// ============================================================================
// HoloAvatar.jsx — «Electra»: busto femenino holográfico (SVG puro, sin assets)
// state: IDLE | LISTENING | THINKING | SPEAKING — cambia color y animación.
// ============================================================================

const COLORS = {
  IDLE: '#08d8ff',
  LISTENING: '#ff4dd2',
  THINKING: '#e3b341',
  SPEAKING: '#3fb950',
};

export default function HoloAvatar({ state = 'IDLE', size = 56 }) {
  const color = COLORS[state] || COLORS.IDLE;
  const active = state !== 'IDLE';
  const gid = `hg-${state}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={{ filter: `drop-shadow(0 0 10px ${color})` }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.95" />
          <stop offset="100%" stopColor={color} stopOpacity="0.25" />
        </linearGradient>
        <clipPath id={`${gid}-clip`}>
          <rect x="8" y="4" width="48" height="56" rx="4" />
        </clipPath>
      </defs>
      <circle cx="32" cy="32" r="29" fill="none" stroke={color} strokeWidth="1" opacity="0.8">
        {active && <animate attributeName="r" values="29;30.5;29" dur="1.6s" repeatCount="indefinite" />}
      </circle>
      <circle cx="32" cy="32" r="25.5" fill="none" stroke={color} strokeWidth="0.5" opacity="0.4"
        strokeDasharray="4 3">
        <animateTransform attributeName="transform" type="rotate" from="0 32 32" to="360 32 32" dur="14s" repeatCount="indefinite" />
      </circle>
      <g clipPath={`url(#${gid}-clip)`}>
        {/* busto: cabeza + cuello + hombros */}
        <circle cx="32" cy="22" r="9" fill="none" stroke={`url(#${gid})`} strokeWidth="1.6" />
        <path d="M27 29 Q27 34 24 36 L20 44 Q32 49 44 44 L40 36 Q37 34 37 29" fill="none" stroke={`url(#${gid})`} strokeWidth="1.6" />
        {/* cabello holográfico */}
        <path d="M23 20 Q24 10 32 10 Q40 10 41 20 Q41 28 39 32" fill="none" stroke={color} strokeWidth="1" opacity="0.7" />
        {/* ojos */}
        <circle cx="28.5" cy="21.5" r="1.1" fill={color}>
          {state === 'SPEAKING' && <animate attributeName="opacity" values="1;0.3;1" dur="0.5s" repeatCount="indefinite" />}
        </circle>
        <circle cx="35.5" cy="21.5" r="1.1" fill={color}>
          {state === 'SPEAKING' && <animate attributeName="opacity" values="1;0.3;1" dur="0.5s" repeatCount="indefinite" />}
        </circle>
        {/* collar de datos */}
        <path d="M26 40 Q32 43 38 40" fill="none" stroke={color} strokeWidth="1" opacity="0.8" />
        {/* scanlines */}
        {[14, 22, 30, 38, 46].map((y) => (
          <line key={y} x1="8" y1={y} x2="56" y2={y} stroke={color} strokeWidth="0.4" opacity="0.35" />
        ))}
        {/* barrido */}
        <rect x="8" y="4" width="48" height="7" fill={color} opacity="0.18">
          <animate attributeName="y" values="4;53;4" dur={state === 'THINKING' ? '1.2s' : '4s'} repeatCount="indefinite" />
        </rect>
      </g>
      {state === 'LISTENING' && (
        <g stroke={color} strokeWidth="1.4">
          <line x1="12" y1="32" x2="16" y2="32"><animate attributeName="y1" values="32;26;32" dur="0.7s" repeatCount="indefinite" /><animate attributeName="y2" values="32;38;32" dur="0.7s" repeatCount="indefinite" /></line>
          <line x1="48" y1="32" x2="52" y2="32"><animate attributeName="y1" values="32;38;32" dur="0.7s" repeatCount="indefinite" /><animate attributeName="y2" values="32;26;32" dur="0.7s" repeatCount="indefinite" /></line>
        </g>
      )}
    </svg>
  );
}
