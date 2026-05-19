/** Chart-Intel design tokens (matches the institutional dark/neon mock). */
export const CI = {
  bg: '#050816',
  bg2: '#0a1024',
  panel: 'rgba(10,18,36,0.72)',
  panelStrong: 'rgba(10,18,36,0.92)',
  border: 'rgba(56,189,248,0.12)',
  borderStrong: 'rgba(56,189,248,0.28)',
  grid: 'rgba(99,102,241,0.07)',

  bull: '#10e0a3',
  bullGlow: 'rgba(16,224,163,0.45)',
  bear: '#ff4d6d',
  bearGlow: 'rgba(255,77,109,0.45)',
  cyan: '#22d3ee',
  cyanSoft: 'rgba(34,211,238,0.18)',
  fvg: 'rgba(139,92,246,0.18)',     // purple translucent
  fvgEdge: 'rgba(139,92,246,0.45)',
  ob: 'rgba(245,158,11,0.16)',      // gold translucent
  obEdge: 'rgba(245,158,11,0.5)',
  resistance: '#e879f9',            // magenta
  support: '#2dd4bf',                // turquoise
  sweep: '#a855f7',
  predict: '#22d3ee',
  neutral: '#94a3b8',
};

export const fmtINR = (n: number, d = 2) =>
  n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });

export const fmtCompact = (n: number) => {
  if (!isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e7) return (n / 1e7).toFixed(2) + 'Cr';
  if (abs >= 1e5) return (n / 1e5).toFixed(2) + 'L';
  if (abs >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(2);
};
