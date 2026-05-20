'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { MarketTick } from '@/hooks/useMarketSocket';

type IndexKey = 'NIFTY' | 'BANKNIFTY' | 'SENSEX';

interface MarketPulseStripProps {
  marketData: Partial<Record<IndexKey, MarketTick | null | undefined>>;
  isConnected: boolean;
}

const KEYS: IndexKey[] = ['NIFTY', 'BANKNIFTY', 'SENSEX'];

const fmtCompact = (v: number): string => {
  if (!isFinite(v) || v === 0) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e7) return `${(v / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${(v / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)} K`;
  return v.toFixed(0);
};

// Flash a value when it changes — pure-CSS pulse on the wrapper.
function useFlash(value: string | number): { cls: string; dir: 'up' | 'down' | 'flat' } {
  const prevRef = useRef<string | number>(value);
  const [cls, setCls] = useState('');
  const [dir, setDir] = useState<'up' | 'down' | 'flat'>('flat');

  useEffect(() => {
    if (prevRef.current === value) return;
    const prev = prevRef.current;
    prevRef.current = value;

    let nextDir: 'up' | 'down' | 'flat' = 'flat';
    if (typeof value === 'number' && typeof prev === 'number') {
      nextDir = value > prev ? 'up' : value < prev ? 'down' : 'flat';
    } else {
      nextDir = 'flat';
    }
    setDir(nextDir);
    setCls(nextDir === 'up' ? 'flash-up' : nextDir === 'down' ? 'flash-down' : 'flash-neutral');
    const t = setTimeout(() => setCls(''), 520);
    return () => clearTimeout(t);
  }, [value]);

  return { cls, dir };
}

const Tile = ({
  label,
  value,
  sub,
  numeric,
  tone,
  pulse,
  hot,
}: {
  label: string;
  value: string;
  sub?: string;
  numeric?: number;          // optional numeric for direction detection
  tone: 'bull' | 'bear' | 'neutral' | 'info';
  pulse?: boolean;
  hot?: boolean;
}) => {
  const toneMap = {
    bull: { border: 'border-emerald-400/20', text: 'text-emerald-300', ring: 'ring-1 ring-emerald-300/50 border-emerald-300/40', bg: 'bg-emerald-300' },
    bear: { border: 'border-rose-400/20',    text: 'text-rose-300',    ring: 'ring-1 ring-rose-300/50 border-rose-300/40',     bg: 'bg-rose-300' },
    neutral: { border: 'border-amber-400/15', text: 'text-amber-300',  ring: 'ring-1 ring-amber-200/50 border-amber-200/40',   bg: 'bg-amber-300' },
    info: { border: 'border-cyan-400/15',     text: 'text-cyan-300',   ring: 'ring-1 ring-cyan-200/50 border-cyan-200/40',     bg: 'bg-cyan-300' },
  }[tone];
  const flash = useFlash(numeric ?? value);

  return (
    <div className={`relative rounded-lg border bg-slate-950/50 px-3 py-2 transition-all duration-150 ${hot ? toneMap.ring : toneMap.border} ${flash.cls}`}>
      {(pulse || hot) && (
        <span className={`absolute right-2 top-2 h-2 w-2 rounded-full ${toneMap.bg} animate-pulse`} />
      )}
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1 font-mono text-lg font-black leading-tight ${toneMap.text} lg:text-xl tabular-nums truncate`}>
        {value}
        {flash.dir !== 'flat' && (
          <span className={`ml-1 text-[10px] font-bold align-middle ${flash.dir === 'up' ? 'text-emerald-400' : 'text-rose-400'}`}>
            {flash.dir === 'up' ? '▲' : '▼'}
          </span>
        )}
      </p>
      {sub && <p className="mt-0.5 text-[11px] font-semibold text-slate-400 tabular-nums truncate">{sub}</p>}
    </div>
  );
};

const MarketPulseStrip = ({ marketData, isConnected }: MarketPulseStripProps) => {
  const m = useMemo(() => {
    const ticks = KEYS.map((k) => marketData[k]).filter((t): t is MarketTick => !!t && !!t.price);
    if (!ticks.length) return null;

    const totalVolume = ticks.reduce((s, t) => s + (t.volume || 0), 0);
    const totalOI = ticks.reduce((s, t) => s + (t.oi || 0), 0);
    const totalLiquidity = ticks.reduce((s, t) => s + (t.volume || 0) * (t.price || 0), 0);

    const avgPct = ticks.reduce((s, t) => s + (t.changePercent || 0), 0) / ticks.length;
    const avgVol = ticks.reduce((s, t) => {
      const r = t.high && t.low && t.low > 0 ? ((t.high - t.low) / t.low) * 100 : 0;
      return s + r;
    }, 0) / ticks.length;
    const avgPcr = ticks.reduce((s, t) => s + (t.pcr || 0), 0) / Math.max(1, ticks.filter((t) => t.pcr).length);

    const bullCount = ticks.filter((t) => t.changePercent > 0.05).length;
    const bearCount = ticks.filter((t) => t.changePercent < -0.05).length;

    let direction: { label: string; tone: 'bull' | 'bear' | 'neutral' } = { label: 'MIXED', tone: 'neutral' };
    if (bullCount === ticks.length) direction = { label: 'RISK ON', tone: 'bull' };
    else if (bearCount === ticks.length) direction = { label: 'RISK OFF', tone: 'bear' };
    else if (bullCount > bearCount) direction = { label: 'BULL TILT', tone: 'bull' };
    else if (bearCount > bullCount) direction = { label: 'BEAR TILT', tone: 'bear' };

    let smartMoney: { label: string; tone: 'bull' | 'bear' | 'neutral' } = { label: 'BALANCED', tone: 'neutral' };
    if (avgPcr >= 1.2) smartMoney = { label: 'ACCUMULATING', tone: 'bull' };
    else if (avgPcr >= 1.0) smartMoney = { label: 'BUYING', tone: 'bull' };
    else if (avgPcr > 0 && avgPcr < 0.7) smartMoney = { label: 'DISTRIBUTING', tone: 'bear' };
    else if (avgPcr > 0 && avgPcr < 0.9) smartMoney = { label: 'CAUTIOUS', tone: 'bear' };

    const inst =
      avgPcr >= 1.1 && avgPct > 0 ? { label: 'INFLOW', tone: 'bull' as const }
      : avgPcr <= 0.8 && avgPct < 0 ? { label: 'OUTFLOW', tone: 'bear' as const }
      : { label: 'NEUTRAL', tone: 'neutral' as const };

    const volTone: 'bull' | 'bear' | 'neutral' = avgVol >= 1.2 ? 'bear' : avgVol >= 0.5 ? 'neutral' : 'bull';
    const volLabel = avgVol >= 1.2 ? 'EXPANDING' : avgVol >= 0.5 ? 'MODERATE' : 'COMPRESSED';

    const pulseLabel = avgPct >= 0.5 ? 'STRONG ↑' : avgPct >= 0.1 ? 'WARM ↑' : avgPct <= -0.5 ? 'STRONG ↓' : avgPct <= -0.1 ? 'COOL ↓' : 'FLAT';
    const pulseTone: 'bull' | 'bear' | 'neutral' = avgPct > 0.1 ? 'bull' : avgPct < -0.1 ? 'bear' : 'neutral';

    return {
      totalVolume, totalOI, totalLiquidity,
      avgPct, avgVol, avgPcr,
      direction, smartMoney, inst,
      volTone, volLabel, pulseLabel, pulseTone,
      lastTickMs: Date.now(),
    };
  }, [marketData]);

  // Heartbeat clock — re-renders once a second so the "ago" label stays live
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!m) {
    return (
      <section className="mb-2 rounded-xl border border-slate-700/40 bg-slate-950/60 px-3 py-2 text-[10px] font-semibold text-slate-400">
        Market Pulse · awaiting live feed…
      </section>
    );
  }

  const agoSec = Math.max(0, Math.round((Date.now() - m.lastTickMs) / 1000));
  const agoLabel = agoSec < 2 ? 'NOW' : agoSec < 60 ? `${agoSec}s ago` : `${Math.round(agoSec / 60)}m ago`;
  const freshness =
    agoSec < 3  ? 'text-emerald-300'
    : agoSec < 15 ? 'text-amber-300'
    : 'text-rose-300';

  return (
    <section
      aria-label="Market Pulse Strip"
      className="mb-3 rounded-xl border border-cyan-400/15 bg-gradient-to-br from-slate-950 via-slate-900/80 to-cyan-950/10 px-3 py-3 sm:px-4"
    >
      {/* tiny inline keyframes for value-flash effect */}
      <style jsx>{`
        :global(.flash-up)      { box-shadow: inset 0 0 0 1px rgba(52, 211, 153, 0.55), 0 0 12px rgba(52, 211, 153, 0.25); }
        :global(.flash-down)    { box-shadow: inset 0 0 0 1px rgba(244, 114, 128, 0.55), 0 0 12px rgba(244, 114, 128, 0.25); }
        :global(.flash-neutral) { box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.40); }
      `}</style>

      <div className="mb-2.5 flex items-center justify-between px-0.5 flex-wrap gap-1">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-lg font-black tracking-[0.22em] text-cyan-300 lg:text-2xl">MARKET PULSE</span>
          <span className="hidden text-sm font-semibold text-slate-400 sm:inline truncate">· Institutional bird&apos;s-eye view</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold tracking-widest tabular-nums ${freshness}`}>
            {agoLabel}
          </span>
          <span className="flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-900/80 px-2.5 py-1 text-[11px] font-bold text-slate-300">
            <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
            {isConnected ? 'LIVE' : 'SYNC'}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <Tile
          label="Pulse"
          value={m.pulseLabel}
          sub={`${m.avgPct >= 0 ? '+' : ''}${m.avgPct.toFixed(2)}%`}
          numeric={m.avgPct}
          tone={m.pulseTone}
          pulse
          hot={Math.abs(m.avgPct) >= 0.4}
        />
        <Tile label="Liquidity" value={fmtCompact(m.totalLiquidity)} sub="₹ notional" numeric={m.totalLiquidity} tone="info" />
        <Tile label="Volume"    value={fmtCompact(m.totalVolume)}    sub="aggregate" numeric={m.totalVolume} tone="info" />
        <Tile label="Total OI"  value={fmtCompact(m.totalOI)}        sub="open positions" numeric={m.totalOI} tone="info" />
        <Tile
          label="Volatility"
          value={m.volLabel}
          sub={`${m.avgVol.toFixed(2)}% range`}
          numeric={m.avgVol}
          tone={m.volTone}
          hot={m.avgVol >= 1.2}
        />
        <Tile
          label="Inst. Flow"
          value={m.inst.label}
          sub={`PCR ${m.avgPcr ? m.avgPcr.toFixed(2) : '—'}`}
          numeric={m.avgPcr}
          tone={m.inst.tone}
          pulse={m.inst.tone !== 'neutral'}
          hot={m.inst.tone !== 'neutral'}
        />
        <Tile
          label="AI Direction"
          value={m.direction.label}
          sub={`${m.avgPct >= 0 ? '+' : ''}${m.avgPct.toFixed(2)}% avg`}
          numeric={m.avgPct}
          tone={m.direction.tone}
          pulse
          hot={m.direction.label === 'RISK ON' || m.direction.label === 'RISK OFF'}
        />
        <Tile
          label="Smart Money"
          value={m.smartMoney.label}
          sub={`PCR ${m.avgPcr ? m.avgPcr.toFixed(2) : '—'}`}
          numeric={m.avgPcr}
          tone={m.smartMoney.tone}
          hot={m.smartMoney.label === 'ACCUMULATING' || m.smartMoney.label === 'DISTRIBUTING'}
        />
      </div>
    </section>
  );
};

export default React.memo(MarketPulseStrip);
