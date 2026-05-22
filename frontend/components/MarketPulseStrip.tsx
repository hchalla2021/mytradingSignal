'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { MarketTick } from '@/hooks/useMarketSocket';
import { updateBuyerIntel, aggregateIntel } from '@/lib/buyerIntelligence';

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

    // Incremental buyer-side intel per index (O(1) per tick) then aggregate.
    const intels = KEYS
      .map((k) => updateBuyerIntel(k, marketData[k]))
      .filter((i) => i.lastUpdate > 0);
    const agg = aggregateIntel(intels);

    const totalVolume = ticks.reduce((s, t) => s + (t.volume || 0), 0);
    const totalOI = ticks.reduce((s, t) => s + (t.oi || 0), 0);
    const totalLiquidity = ticks.reduce((s, t) => s + (t.volume || 0) * (t.price || 0), 0);
    const avgPct = ticks.reduce((s, t) => s + (t.changePercent || 0), 0) / ticks.length;
    const avgPcr = ticks.reduce((s, t) => s + (t.pcr || 0), 0) / Math.max(1, ticks.filter((t) => t.pcr).length);

    // — Pulse: signed market momentum from buyer-intel —
    const pulseTone: 'bull' | 'bear' | 'neutral' =
      agg.marketPulse > 15 ? 'bull' : agg.marketPulse < -15 ? 'bear' : 'neutral';
    const pulseLabel =
      agg.marketPulse >= 50 ? 'STRONG ↑'
      : agg.marketPulse >= 15 ? 'WARM ↑'
      : agg.marketPulse <= -50 ? 'STRONG ↓'
      : agg.marketPulse <= -15 ? 'COOL ↓'
      : 'FLAT';

    // — Volatility: real volume-expansion vs short-window baseline —
    const volTone: 'bull' | 'bear' | 'neutral' =
      agg.volExpansion >= 70 ? 'bear' : agg.volExpansion >= 40 ? 'neutral' : 'bull';
    const volLabel = agg.volExpansion >= 70 ? 'EXPANDING' : agg.volExpansion >= 40 ? 'MODERATE' : 'COMPRESSED';

    // — Inst. Flow: composite institutional buying pressure —
    // Indices send oi=0 (no OI feed). Fall back to price-direction + buyer pressure when oiBuildup is flat.
    const noOiFeed = agg.oiBuildup === 0;
    const inst: { label: string; tone: 'bull' | 'bear' | 'neutral' } =
      agg.instBuying >= 60 ? { label: 'STRONG INFLOW', tone: 'bull' }
      : agg.instBuying >= 35 ? { label: 'INFLOW', tone: 'bull' }
      : agg.oiBuildup < -20 ? { label: 'OUTFLOW', tone: 'bear' }
      : noOiFeed && avgPct >= 0.15 && agg.buyerPressure >= 55 ? { label: 'INFLOW', tone: 'bull' }
      : noOiFeed && avgPct <= -0.15 && agg.buyerPressure <= 45 ? { label: 'OUTFLOW', tone: 'bear' }
      : { label: 'NEUTRAL', tone: 'neutral' };

    // — AI Direction: bullish probability from logistic blend, with avgPct tiebreaker in the dead zone —
    const direction: { label: string; tone: 'bull' | 'bear' | 'neutral' } =
      agg.bullishProb >= 70 ? { label: 'RISK ON', tone: 'bull' }
      : agg.bullishProb >= 55 ? { label: 'BULL TILT', tone: 'bull' }
      : agg.bullishProb <= 30 ? { label: 'RISK OFF', tone: 'bear' }
      : agg.bullishProb <= 45 ? { label: 'BEAR TILT', tone: 'bear' }
      : avgPct >= 0.15 ? { label: 'BULL TILT', tone: 'bull' }
      : avgPct <= -0.15 ? { label: 'BEAR TILT', tone: 'bear' }
      : { label: 'MIXED', tone: 'neutral' };

    // — Smart Money: accumulation score —
    const smartMoney: { label: string; tone: 'bull' | 'bear' | 'neutral' } =
      agg.accumulation >= 70 ? { label: 'ACCUMULATING', tone: 'bull' }
      : agg.accumulation >= 50 ? { label: 'BUYING', tone: 'bull' }
      : agg.accumulation >= 30 ? { label: 'CAUTIOUS', tone: 'neutral' }
      : { label: 'DISTRIBUTING', tone: 'bear' };

    return {
      totalVolume, totalOI, totalLiquidity,
      avgPct, avgPcr, agg,
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
          sub={`${m.agg.marketPulse >= 0 ? '+' : ''}${m.agg.marketPulse} idx`}
          numeric={m.agg.marketPulse}
          tone={m.pulseTone}
          pulse
          hot={Math.abs(m.agg.marketPulse) >= 50}
        />
        <Tile label="Liquidity" value={fmtCompact(m.totalLiquidity)} sub="₹ notional" numeric={m.totalLiquidity} tone="info" />
        <Tile label="Volume"    value={fmtCompact(m.totalVolume)}    sub="aggregate" numeric={m.totalVolume} tone="info" />
        <Tile label="Total OI"  value={fmtCompact(m.totalOI)}        sub="open positions" numeric={m.totalOI} tone="info" />
        <Tile
          label="Volatility"
          value={m.volLabel}
          sub={`${m.agg.volExpansion}% expansion`}
          numeric={m.agg.volExpansion}
          tone={m.volTone}
          hot={m.agg.volExpansion >= 70}
        />
        <Tile
          label="Inst. Flow"
          value={m.inst.label}
          sub={`Buying ${m.agg.instBuying}% · ΔOI ${m.agg.oiBuildup === 0 ? 'N/A' : (m.agg.oiBuildup >= 0 ? '+' : '') + m.agg.oiBuildup}`}
          numeric={m.agg.instBuying}
          tone={m.inst.tone}
          pulse={m.inst.tone !== 'neutral'}
          hot={m.agg.instBuying >= 60}
        />
        <Tile
          label="AI Direction"
          value={m.direction.label}
          sub={`Bullish ${m.agg.bullishProb}%`}
          numeric={m.agg.bullishProb}
          tone={m.direction.tone}
          pulse
          hot={m.agg.bullishProb >= 70 || m.agg.bullishProb <= 30}
        />
        <Tile
          label="Smart Money"
          value={m.smartMoney.label}
          sub={`Accum ${m.agg.accumulation}% · δ ${m.agg.deltaFlow >= 0 ? '+' : ''}${m.agg.deltaFlow}`}
          numeric={m.agg.accumulation}
          tone={m.smartMoney.tone}
          hot={m.agg.accumulation >= 70 || m.agg.accumulation <= 25}
        />
      </div>
    </section>
  );
};

export default React.memo(MarketPulseStrip);
