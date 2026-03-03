'use client';

/**
 * India VIX Badge — compact, responsive, animated.
 * Fits inline in any header bar on mobile + desktop.
 */

import React, { useEffect, useRef, useState } from 'react';

interface IndiaVIXBadgeProps {
  value: number | null;
  changePercent: number;
  volatilityLevel: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME' | 'UNKNOWN';
  marketFearScore: number;
  loading?: boolean;
}

/* Animate a number from prev → next over ~400ms */
function useAnimatedNumber(target: number) {
  const [display, setDisplay] = useState(target);
  const raf = useRef<number>(0);
  const prev = useRef(target);

  useEffect(() => {
    const from = prev.current;
    const to = target;
    if (from === to) return;
    const start = performance.now();
    const duration = 400;
    const step = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * ease);
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    prev.current = to;
    return () => cancelAnimationFrame(raf.current);
  }, [target]);

  return display;
}

const palette = {
  LOW:     { accent: '#34d399', glow: 'rgba(52,211,153,0.25)', bg: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.30)', label: 'LOW' },
  NORMAL:  { accent: '#fbbf24', glow: 'rgba(251,191,36,0.20)', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.30)', label: 'NORMAL' },
  HIGH:    { accent: '#fb923c', glow: 'rgba(249,115,22,0.25)', bg: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.35)', label: 'HIGH' },
  EXTREME: { accent: '#f87171', glow: 'rgba(248,113,113,0.30)', bg: 'rgba(239,68,68,0.14)', border: 'rgba(239,68,68,0.40)', label: 'EXTREME' },
  UNKNOWN: { accent: '#9ca3af', glow: 'rgba(156,163,175,0.15)', bg: 'rgba(107,114,128,0.08)', border: 'rgba(107,114,128,0.20)', label: '---' },
} as const;

const IndiaVIXBadge = React.memo(
  ({ value, changePercent, volatilityLevel, marketFearScore, loading = false }: IndiaVIXBadgeProps) => {
    const hasData     = value !== null && value !== undefined && value > 0;
    const numValue    = hasData ? value : 0;
    const animValue   = useAnimatedNumber(numValue);
    const animChange  = useAnimatedNumber(changePercent ?? 0);
    const animFear    = useAnimatedNumber(marketFearScore ?? 0);
    const isUp        = (changePercent ?? 0) > 0;
    const p           = (!hasData || loading) ? palette.UNKNOWN : (palette[volatilityLevel] ?? palette.UNKNOWN);
    const [flash, setFlash] = useState(false);

    useEffect(() => {
      if (!hasData) return;
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 600);
      return () => clearTimeout(t);
    }, [value, hasData]);

    /* Loading skeleton */
    if (loading) {
      return (
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-white/[0.08] bg-white/[0.03] animate-pulse shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-600" />
          <span className="text-[10px] font-bold text-gray-500 tracking-wide whitespace-nowrap">VIX --</span>
        </div>
      );
    }

    /* No data state */
    if (!hasData) {
      return (
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-white/[0.08] bg-white/[0.03] shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-600" />
          <span className="text-[10px] font-bold text-gray-500 tracking-wide whitespace-nowrap">VIX —</span>
        </div>
      );
    }

    return (
      <div
        className="inline-flex items-center rounded-lg shrink-0 transition-shadow duration-300 whitespace-nowrap"
        style={{
          background: p.bg,
          border: `1px solid ${p.border}`,
          boxShadow: flash ? `0 0 14px 2px ${p.glow}` : 'none',
          padding: '4px 8px',
          gap: '6px',
        }}
      >
        {/* Pulsing dot */}
        <span
          className="w-[6px] h-[6px] rounded-full shrink-0 animate-pulse"
          style={{ backgroundColor: p.accent, boxShadow: `0 0 4px 1px ${p.glow}` }}
        />

        {/* VIX value */}
        <span
          className="text-[11px] sm:text-xs font-extrabold tabular-nums leading-none"
          style={{ color: p.accent }}
        >
          VIX&nbsp;{animValue.toFixed(2)}
        </span>

        {/* Separator */}
        <span className="w-px h-3 bg-white/10" />

        {/* Change % with arrow — VIX UP = bearish (▼ red), VIX DOWN = bullish (▲ green) */}
        <span
          className="text-[10px] sm:text-[11px] font-bold tabular-nums leading-none"
          style={{ color: isUp ? '#f87171' : '#34d399' }}
        >
          {isUp ? '▼' : '▲'}&nbsp;{Math.abs(animChange).toFixed(2)}%
        </span>

        {/* Level pill */}
        <span
          className="text-[8px] sm:text-[9px] font-black leading-none rounded tracking-wider uppercase"
          style={{
            color: p.accent,
            padding: '2px 5px',
            backgroundColor: `${p.accent}18`,
            border: `1px solid ${p.accent}35`,
          }}
        >
          {p.label}
        </span>

        {/* Fear micro-bar — only on wider screens */}
        <div className="hidden md:flex items-center" style={{ gap: '4px' }}>
          <div className="w-8 h-[3px] rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{
                width: `${Math.min(animFear, 100)}%`,
                background: `linear-gradient(90deg, ${p.accent}80, ${p.accent})`,
              }}
            />
          </div>
          <span className="text-[8px] font-bold tabular-nums leading-none" style={{ color: `${p.accent}bb` }}>
            {Math.round(animFear)}
          </span>
        </div>
      </div>
    );
  }
);

IndiaVIXBadge.displayName = 'IndiaVIXBadge';

export default IndiaVIXBadge;
