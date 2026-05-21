'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { MarketTick } from '@/hooks/useMarketSocket';
import { updateBuyerIntel, type BuyerIntel } from '@/lib/buyerIntelligence';

type IndexKey = 'NIFTY' | 'BANKNIFTY' | 'SENSEX';

interface TopAISignalBarProps {
  marketData: Partial<Record<IndexKey, MarketTick | null | undefined>>;
  isConnected: boolean;
}

const INDICES: { key: IndexKey; name: string }[] = [
  { key: 'NIFTY', name: 'NIFTY 50' },
  { key: 'BANKNIFTY', name: 'BANK NIFTY' },
  { key: 'SENSEX', name: 'SENSEX' },
];

// Smoothly animate displayed numeric values between ticks using rAF (ease-out cubic).
function useTween(target: number, durationMs = 600): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const toRef = useRef(target);
  const startRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isFinite(target)) return;
    if (toRef.current === target) return;
    fromRef.current = display;
    toRef.current = target;
    startRef.current = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startRef.current) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(fromRef.current + (toRef.current - fromRef.current) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else rafRef.current = null;
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);
  return display;
}

// Flash on value change — returns a class + direction for inline ▲/▼ arrows.
function useFlash(value: number): { cls: string; dir: 'up' | 'down' | 'flat' } {
  const prevRef = useRef(value);
  const [cls, setCls] = useState('');
  const [dir, setDir] = useState<'up' | 'down' | 'flat'>('flat');
  useEffect(() => {
    if (prevRef.current === value) return;
    const d = value - prevRef.current;
    prevRef.current = value;
    const nextDir: 'up' | 'down' | 'flat' = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
    setDir(nextDir);
    setCls(nextDir === 'up' ? 'flash-up' : 'flash-down');
    const t = setTimeout(() => setCls(''), 480);
    return () => clearTimeout(t);
  }, [value]);
  return { cls, dir };
}

const fmtPrice = (v: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(v);

const fmtCompact = (v: number): string => {
  if (!isFinite(v) || v === 0) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e7) return `${(v / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${(v / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
};

type Snapshot = { price: number; oi: number; volume: number; at: number };

interface SignalView {
  tone: 'bull' | 'bear' | 'neutral';
  signalLabel: string;
  signalArrow: '▲' | '▼' | '◆';
  confidence: number;
  trendLabel: string;
  volExpansion: number;
  volLabel: 'LOW' | 'MEDIUM' | 'HIGH';
  liquidity: number;
  liquidityStrength: number;
  smartMoney: { label: string; tone: 'bull' | 'bear' | 'neutral' };
  momentum: number;
  institutional: { label: string; tone: 'bull' | 'bear' | 'neutral' };
  buyPressure: number;
  breakoutProb: number;
  reversalProb: number;
  rangePos: number;
  aiTrend: string;
}

const deriveSignal = (tick: MarketTick | null | undefined, _oiDeltaPct: number, intel: BuyerIntel): SignalView | null => {
  if (!tick || !tick.price) return null;

  const pct = tick.changePercent ?? 0;
  const abs = Math.abs(pct);
  const range = tick.high && tick.low && tick.low > 0 ? ((tick.high - tick.low) / tick.low) * 100 : 0;
  const rangePos = tick.high && tick.low && tick.high > tick.low ? ((tick.price - tick.low) / (tick.high - tick.low)) * 100 : 50;

  let tone: SignalView['tone'] = 'neutral';
  let signalLabel = 'NEUTRAL';
  let signalArrow: SignalView['signalArrow'] = '◆';
  let trendLabel = 'Sideways';
  let aiTrend = 'Range Bound';

  // Tone & label now driven primarily by the bullish probability from the intel engine,
  // with price-action as a tiebreaker — this honours smart-money structure (BOS / CHoCH / FVG / OB / BSL).
  const bp = intel.bullishProb;
  if (bp >= 70 || (bp >= 60 && pct > 0)) {
    tone = 'bull'; signalArrow = '▲';
    if (bp >= 82 || abs >= 1) { signalLabel = 'STRONG BUY'; trendLabel = 'Strong Bullish'; aiTrend = 'Trend Continuation ↑'; }
    else if (bp >= 70) { signalLabel = 'BUY'; trendLabel = 'Bullish'; aiTrend = 'Bullish Drift'; }
    else { signalLabel = 'BUY ZONE'; trendLabel = 'Mild Bullish'; aiTrend = 'Accumulation'; }
  } else if (bp <= 30 || (bp <= 40 && pct < 0)) {
    tone = 'bear'; signalArrow = '▼';
    if (bp <= 18 || abs >= 1) { signalLabel = 'STRONG SELL'; trendLabel = 'Strong Bearish'; aiTrend = 'Distribution ↓'; }
    else if (bp <= 30) { signalLabel = 'SELL'; trendLabel = 'Bearish'; aiTrend = 'Bearish Drift'; }
    else { signalLabel = 'SELL ZONE'; trendLabel = 'Mild Bearish'; aiTrend = 'Light Selling'; }
  } else {
    aiTrend = intel.accumulation >= 55 ? 'Quiet Accumulation' : 'Awaiting Breakout';
  }

  // Confidence: blend of bullish prob (or its inverse for bearish), structural events and OI buildup.
  const directional = tone === 'bear' ? 100 - bp : bp;
  const structuralBoost =
    (intel.bos ? 6 : 0) + (intel.choch ? 6 : 0) + (intel.bullFvg ? 3 : 0)
    + (intel.bullOb ? 3 : 0) + (intel.bslSwept ? 5 : 0) + (intel.pdhBroken ? 4 : 0);
  const confidence = Math.max(40, Math.min(95, Math.round(directional * 0.7 + structuralBoost + Math.min(range, 2) * 4)));

  let volLabel: SignalView['volLabel'] = 'LOW';
  if (intel.volExpansion >= 70 || range >= 1.2) volLabel = 'HIGH';
  else if (intel.volExpansion >= 40 || range >= 0.5) volLabel = 'MEDIUM';

  const liquidity = (tick.volume || 0) * (tick.price || 0);
  const liquidityStrength = Math.max(5, Math.min(100, Math.round(Math.log10(Math.max(1, liquidity)) * 10)));

  // Smart money: drive from accumulation score, not raw PCR.
  let smartMoney: SignalView['smartMoney'] = { label: 'BALANCED', tone: 'neutral' };
  if (intel.accumulation >= 70) smartMoney = { label: 'ACCUMULATING', tone: 'bull' };
  else if (intel.accumulation >= 50) smartMoney = { label: 'BUYING', tone: 'bull' };
  else if (intel.accumulation <= 25) smartMoney = { label: 'DISTRIBUTING', tone: 'bear' };
  else if (intel.accumulation <= 40) smartMoney = { label: 'CAUTIOUS', tone: 'bear' };

  // Institutional flow from OI buildup sign + ΔOI%.
  let institutional: SignalView['institutional'] = { label: 'NEUTRAL', tone: 'neutral' };
  if (intel.oiBuildup >= 50) institutional = { label: 'LONG BUILD', tone: 'bull' };
  else if (intel.oiBuildup >= 25) institutional = { label: 'SHORT COVER', tone: 'bull' };
  else if (intel.oiBuildup <= -50) institutional = { label: 'SHORT BUILD', tone: 'bear' };
  else if (intel.oiBuildup <= -25) institutional = { label: 'LONG UNWIND', tone: 'bear' };

  // Momentum: signed pulse from the engine, not just pct.
  const momentum = intel.marketPulse;

  // Buyer pressure: real composite from engine.
  const buyPressure = intel.buyerPressure;

  // Breakout prob: closer to internal/external BSL with positive flow lifts probability.
  const edgeDistance = Math.min(rangePos, 100 - rangePos);
  let breakoutProb = Math.round(
    20
    + Math.min(range, 2) * 12
    + Math.max(0, 25 - edgeDistance) * 1.2
    + (intel.bslSwept ? 18 : 0)
    + (intel.pdhBroken ? 12 : 0)
    + Math.max(0, intel.volExpansion - 50) * 0.4
    + Math.max(0, intel.deltaFlow) * 0.15
  );
  breakoutProb = Math.max(5, Math.min(95, breakoutProb));

  let reversalProb = Math.round(
    25
    + (abs > 1 ? abs * 6 : 0)
    + edgeDistance * 0.2
    + (intel.oiBuildup < 0 && pct > 0 ? 18 : 0)   // shorts building into strength
    + (intel.oiBuildup > 0 && pct < 0 ? 14 : 0)   // longs adding into weakness
    + (intel.supportHold < 25 ? 10 : 0)
  );
  reversalProb = Math.max(5, Math.min(95, reversalProb));

  return {
    tone, signalLabel, signalArrow, confidence, trendLabel,
    volExpansion: range, volLabel, liquidity, liquidityStrength,
    smartMoney, momentum, institutional, buyPressure,
    breakoutProb, reversalProb, rangePos, aiTrend,
  };
};

const TONE: Record<SignalView['tone'], { ring: string; bg: string; text: string; chip: string; bar: string }> = {
  bull: {
    ring: 'border-emerald-400/20',
    bg: 'from-emerald-950/30 via-slate-900/60 to-slate-950',
    text: 'text-emerald-300',
    chip: 'bg-emerald-500/15 text-emerald-200 border-emerald-400/30',
    bar: 'from-emerald-400/80 to-emerald-500/80',
  },
  bear: {
    ring: 'border-rose-400/20',
    bg: 'from-rose-950/30 via-slate-900/60 to-slate-950',
    text: 'text-rose-300',
    chip: 'bg-rose-500/15 text-rose-200 border-rose-400/30',
    bar: 'from-rose-400/80 to-rose-500/80',
  },
  neutral: {
    ring: 'border-amber-400/15',
    bg: 'from-amber-950/20 via-slate-900/60 to-slate-950',
    text: 'text-amber-300',
    chip: 'bg-amber-500/15 text-amber-200 border-amber-400/30',
    bar: 'from-amber-400/80 to-amber-500/80',
  },
};

const VOL_STYLES: Record<SignalView['volLabel'], string> = {
  LOW: 'text-emerald-300 border-emerald-400/25 bg-emerald-500/10',
  MEDIUM: 'text-amber-300 border-amber-400/25 bg-amber-500/10',
  HIGH: 'text-rose-300 border-rose-400/25 bg-rose-500/10',
};

const Bar = ({ value, tone, leftLabel, rightLabel }: { value: number; tone: SignalView['tone']; leftLabel?: string; rightLabel?: string }) => {
  const t = TONE[tone];
  const anim = useTween(value, 600);
  return (
    <div>
      {(leftLabel || rightLabel) && (
        <div className="flex items-center justify-between text-[11px] font-bold text-slate-400">
          <span>{leftLabel}</span>
          <span className={`${t.text} tabular-nums`}>{rightLabel}</span>
        </div>
      )}
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800/70">
        <div className={`h-full rounded-full bg-gradient-to-r ${t.bar}`} style={{ width: `${Math.max(2, Math.min(100, anim))}%` }} />
      </div>
    </div>
  );
};

const TwoSidedBar = ({ value }: { value: number }) => {
  const anim = useTween(value, 600);
  const buy = Math.max(2, Math.min(98, anim));
  return (
    <div className="flex h-2 overflow-hidden rounded-full border border-slate-700/60 bg-slate-900">
      <div className="h-full bg-gradient-to-r from-rose-500/80 to-rose-400/60" style={{ width: `${100 - buy}%` }} />
      <div className="h-full bg-gradient-to-r from-emerald-400/60 to-emerald-500/80" style={{ width: `${buy}%` }} />
    </div>
  );
};

const Metric = ({ label, value, tone = 'slate', hot, numeric }: { label: string; value: React.ReactNode; tone?: 'slate' | 'bull' | 'bear' | 'neutral' | 'info'; hot?: boolean; numeric?: number }) => {
  const colorMap = {
    slate: 'text-slate-200',
    bull: 'text-emerald-300',
    bear: 'text-rose-300',
    neutral: 'text-amber-300',
    info: 'text-cyan-300',
  };
  const ringMap = {
    slate: 'ring-1 ring-slate-200/40 border-slate-300/40',
    bull: 'ring-1 ring-emerald-300/50 border-emerald-300/40',
    bear: 'ring-1 ring-rose-300/50 border-rose-300/40',
    neutral: 'ring-1 ring-amber-200/50 border-amber-200/40',
    info: 'ring-1 ring-cyan-200/50 border-cyan-200/40',
  };
  const flash = useFlash(numeric ?? 0);
  return (
    <div className={`rounded-md border bg-slate-900/40 px-2 py-1.5 transition-all duration-150 ${hot ? ringMap[tone] : 'border-slate-700/30'} ${numeric !== undefined ? flash.cls : ''}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-0.5 truncate font-mono text-[13px] font-black leading-tight lg:text-sm tabular-nums ${colorMap[tone]}`}>{value}</p>
    </div>
  );
};

const SignalCard = React.memo(function SignalCard({ name, indexKey, tick }: { name: string; indexKey: IndexKey; tick: MarketTick | null | undefined }) {
  const prevRef = useRef<Snapshot | null>(null);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  const oiDeltaPct = useMemo(() => {
    if (!tick || !tick.oi) return 0;
    const prev = prevRef.current;
    if (!prev || !prev.oi) return 0;
    return ((tick.oi - prev.oi) / prev.oi) * 100;
  }, [tick]);

  useEffect(() => {
    if (!tick || !tick.price) return undefined;
    const prev = prevRef.current;
    if (!prev) {
      prevRef.current = { price: tick.price, oi: tick.oi, volume: tick.volume, at: Date.now() };
      return undefined;
    }
    if (tick.price > prev.price) setFlash('up');
    else if (tick.price < prev.price) setFlash('down');
    const id = setTimeout(() => setFlash(null), 350);
    if (Date.now() - prev.at > 30_000) {
      prevRef.current = { price: tick.price, oi: tick.oi, volume: tick.volume, at: Date.now() };
    }
    return () => clearTimeout(id);
  }, [tick]);

  // Per-tick incremental buyer-side intel (BOS / CHoCH / FVG / OB / BSL / ΔOI / delta-flow / accumulation / bullishProb).
  const intel = useMemo(() => updateBuyerIntel(indexKey, tick), [indexKey, tick]);
  const sig = useMemo(() => deriveSignal(tick, oiDeltaPct, intel), [tick, oiDeltaPct, intel]);

  const pct = tick?.changePercent ?? 0;

  // Tween displayed numerics so they glide between ticks instead of snapping.
  // Hooks must be called unconditionally — fall back to 0 when tick/sig are absent.
  const animPrice = useTween(tick?.price ?? 0, 500);
  const animChange = useTween(tick?.change ?? 0, 500);
  const animPct = useTween(pct, 500);
  const animConfidence = useTween(sig?.confidence ?? 0, 600);
  const animBuyPressure = useTween(sig?.buyPressure ?? 0, 600);
  const animLiqStr = useTween(sig?.liquidityStrength ?? 0, 600);
  const animBreakout = useTween(sig?.breakoutProb ?? 0, 600);
  const animReversal = useTween(sig?.reversalProb ?? 0, 600);
  const animMomentum = useTween(sig?.momentum ?? 0, 600);
  const animOiDelta = useTween(oiDeltaPct, 600);
  const animRangePos = useTween(sig?.rangePos ?? 0, 600);
  const animVolExp = useTween(sig?.volExpansion ?? 0, 600);
  const animVolume = useTween(tick?.volume || 0, 600);
  const animOi = useTween(tick?.oi || 0, 600);
  const animLiquidity = useTween(sig?.liquidity ?? 0, 600);

  if (!sig || !tick) {
    return (
      <div className="rounded-xl border border-slate-700/40 bg-slate-950/60 px-3 py-4 text-center">
        <p className="text-[10px] font-bold tracking-wider text-slate-400">{name}</p>
        <p className="mt-2 text-[10px] font-semibold text-slate-500">Awaiting live tick…</p>
      </div>
    );
  }

  const t = TONE[sig.tone];
  const flashCls = flash === 'up' ? 'ring-1 ring-emerald-300/50' : flash === 'down' ? 'ring-1 ring-rose-300/50' : '';

  return (
    <div className={`relative rounded-xl border bg-gradient-to-br ${t.ring} ${t.bg} p-3 backdrop-blur-sm transition-all duration-200 ${flashCls}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-black tracking-wider text-slate-200 lg:text-base">{name}</p>
          <p className="font-mono text-2xl font-black leading-tight text-slate-100 lg:text-3xl tabular-nums">{fmtPrice(animPrice)}</p>
          <p className={`text-xs font-bold lg:text-sm tabular-nums ${t.text}`}>
            {animChange >= 0 ? '+' : ''}{animChange.toFixed(2)} · {animPct >= 0 ? '+' : ''}{animPct.toFixed(2)}%
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-black lg:text-sm ${t.chip} ${sig.signalLabel.startsWith('STRONG') ? 'ring-1 ring-white/50' : ''}`}>
            <span aria-hidden>{sig.signalArrow}</span>
            <span>{sig.signalLabel}</span>
          </span>
          <span className={`rounded border px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${VOL_STYLES[sig.volLabel]} ${sig.volLabel === 'HIGH' ? 'ring-1 ring-rose-300/50' : ''}`}>
            VOL · {sig.volLabel} {animVolExp.toFixed(2)}%
          </span>
        </div>
      </div>

      <div className={`mt-3 rounded-md p-1 transition-all ${sig.confidence >= 70 ? `ring-1 ${sig.tone === 'bull' ? 'ring-emerald-300/50' : sig.tone === 'bear' ? 'ring-rose-300/50' : 'ring-amber-300/50'}` : ''}`}>
        <Bar value={animConfidence} tone={sig.tone} leftLabel="AI CONFIDENCE" rightLabel={`${animConfidence.toFixed(0)}%`} />
      </div>

      <div className={`mt-2 rounded-md p-1 transition-all ${sig.buyPressure >= 75 || sig.buyPressure <= 25 ? `ring-1 ${sig.buyPressure >= 75 ? 'ring-emerald-300/50' : 'ring-rose-300/50'}` : ''}`}>
        <div className="flex items-center justify-between text-[11px] font-bold tabular-nums">
          <span className="text-rose-300">SELL {(100 - animBuyPressure).toFixed(0)}%</span>
          <span className="text-slate-400">PRESSURE</span>
          <span className="text-emerald-300">BUY {animBuyPressure.toFixed(0)}%</span>
        </div>
        <div className="mt-1"><TwoSidedBar value={animBuyPressure} /></div>
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-1.5">
        <Metric label="Volume" value={fmtCompact(animVolume)} tone="info" numeric={animVolume} />
        <Metric label="Liquidity" value={`₹${fmtCompact(animLiquidity)}`} tone="info" numeric={animLiquidity} />
        <Metric label="OI" value={fmtCompact(animOi)} tone="info" numeric={animOi} />
        <Metric
          label="ΔOI %"
          value={`${animOiDelta >= 0 ? '+' : ''}${animOiDelta.toFixed(2)}%`}
          tone={Math.abs(animOiDelta) < 0.2 ? 'slate' : animOiDelta > 0 ? 'bull' : 'bear'}
          hot={Math.abs(animOiDelta) >= 0.5}
          numeric={animOiDelta}
        />
        <Metric
          label="Momentum"
          value={`${animMomentum >= 0 ? '+' : ''}${animMomentum.toFixed(0)}`}
          tone={animMomentum > 10 ? 'bull' : animMomentum < -10 ? 'bear' : 'neutral'}
          hot={Math.abs(animMomentum) >= 40}
          numeric={animMomentum}
        />
        <Metric label="Range Pos" value={`${animRangePos.toFixed(0)}%`} tone="slate" hot={animRangePos <= 15 || animRangePos >= 85} numeric={animRangePos} />
        <Metric label="Smart Money" value={sig.smartMoney.label} tone={sig.smartMoney.tone} hot={sig.smartMoney.label === 'ACCUMULATING' || sig.smartMoney.label === 'DISTRIBUTING'} />
        <Metric label="Inst. Flow" value={sig.institutional.label} tone={sig.institutional.tone} hot={sig.institutional.tone !== 'neutral'} />
        <Metric label="AI Trend" value={sig.aiTrend} tone={sig.tone} hot={sig.aiTrend.includes('Continuation') || sig.aiTrend.includes('Distribution')} />
      </div>

      <div className="mt-3 space-y-1.5">
        {/* Smart-money structural events — incremental, tick-driven (BOS / CHoCH / FVG / OB / BSL / PDH) */}
        <div className="flex flex-wrap items-center gap-1">
          {intel.bos && <span className="rounded border border-emerald-400/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">BOS ↑</span>}
          {intel.choch && <span className="rounded border border-emerald-400/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">CHoCH ↑</span>}
          {intel.bullFvg && <span className="rounded border border-cyan-400/40 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300">BULL FVG</span>}
          {intel.bullOb && <span className="rounded border border-cyan-400/40 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300">BULL OB</span>}
          {intel.bslSwept && <span className="rounded border border-amber-400/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">BSL SWEPT</span>}
          {intel.pdhBroken && <span className="rounded border border-emerald-400/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">PDH BREAK</span>}
          {intel.supportHold >= 70 && <span className="rounded border border-emerald-400/30 bg-emerald-500/5 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300/90">SUPPORT HELD {intel.supportHold}%</span>}
          {!intel.bos && !intel.choch && !intel.bullFvg && !intel.bullOb && !intel.bslSwept && !intel.pdhBroken && intel.supportHold < 70 && (
            <span className="rounded border border-slate-700/60 bg-slate-900/60 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">NO STRUCTURE</span>
          )}
          <span className="ml-auto rounded border border-cyan-400/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-black text-cyan-200 tabular-nums">
            BULLISH {intel.bullishProb}%
          </span>
        </div>
        <div className={`rounded-md p-1 transition-all ${sig.liquidityStrength >= 90 ? 'ring-1 ring-emerald-300/50' : ''}`}>
          <Bar value={animLiqStr} tone="bull" leftLabel="LIQUIDITY STRENGTH" rightLabel={`${animLiqStr.toFixed(0)}%`} />
        </div>
        <div className={`rounded-md p-1 transition-all ${sig.breakoutProb >= 65 ? 'ring-1 ring-emerald-300/50' : ''}`}>
          <Bar value={animBreakout} tone="bull" leftLabel="BREAKOUT PROB" rightLabel={`${animBreakout.toFixed(0)}%`} />
        </div>
        <div className={`rounded-md p-1 transition-all ${sig.reversalProb >= 65 ? 'ring-1 ring-rose-300/50' : ''}`}>
          <Bar value={animReversal} tone="bear" leftLabel="REVERSAL PROB" rightLabel={`${animReversal.toFixed(0)}%`} />
        </div>
      </div>
    </div>
  );
});

const TopAISignalBar = ({ marketData, isConnected }: TopAISignalBarProps) => {
  // Track latest tick arrival across all symbols for the freshness badge.
  const lastTickMsRef = useRef<number>(Date.now());
  const sigRef = useRef<string>('');
  useEffect(() => {
    const sig = INDICES
      .map(({ key }) => {
        const t = marketData[key];
        return t ? `${t.price}|${t.volume}|${t.oi}` : '-';
      })
      .join('#');
    if (sig !== sigRef.current) {
      sigRef.current = sig;
      lastTickMsRef.current = Date.now();
    }
  }, [marketData]);

  // 1s heartbeat keeps the "ago" label and tween cadence visible.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const agoSec = Math.max(0, Math.round((Date.now() - lastTickMsRef.current) / 1000));
  const agoLabel = agoSec < 2 ? 'NOW' : agoSec < 60 ? `${agoSec}s ago` : `${Math.round(agoSec / 60)}m ago`;
  const freshness = agoSec < 3 ? 'text-emerald-300' : agoSec < 15 ? 'text-amber-300' : 'text-rose-300';

  return (
    <section
      aria-label="AI Signal Deck"
      className="mb-3 rounded-xl border border-cyan-400/15 bg-gradient-to-br from-slate-950 via-slate-900/80 to-cyan-950/10 px-3 py-3 sm:px-4"
    >
      <style jsx>{`
        :global(.flash-up)   { box-shadow: inset 0 0 0 1px rgba(52, 211, 153, 0.55), 0 0 10px rgba(52, 211, 153, 0.22); }
        :global(.flash-down) { box-shadow: inset 0 0 0 1px rgba(244, 114, 128, 0.55), 0 0 10px rgba(244, 114, 128, 0.22); }
      `}</style>
      <div className="mb-2.5 flex items-center justify-between px-0.5 flex-wrap gap-1">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-lg font-black tracking-[0.22em] text-cyan-300 lg:text-2xl">AI SIGNAL DECK</span>
          <span className="hidden text-sm font-semibold text-slate-400 sm:inline truncate">· Institutional-grade observation · &lt; 3s read</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold tracking-widest tabular-nums ${freshness}`}>{agoLabel}</span>
          <span className="flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-900/80 px-2.5 py-1 text-[11px] font-bold text-slate-300">
            <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
            {isConnected ? 'LIVE' : 'SYNC'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {INDICES.map(({ key, name }) => (
          <SignalCard key={key} name={name} indexKey={key} tick={marketData[key]} />
        ))}
      </div>
    </section>
  );
};

export default React.memo(TopAISignalBar);
