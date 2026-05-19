'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { MarketTick } from '@/hooks/useMarketSocket';

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

const deriveSignal = (tick: MarketTick | null | undefined, oiDeltaPct: number): SignalView | null => {
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

  if (pct > 0.05) {
    tone = 'bull';
    signalArrow = '▲';
    if (abs >= 1) { signalLabel = 'STRONG BUY'; trendLabel = 'Strong Bullish'; aiTrend = 'Trend Continuation ↑'; }
    else if (abs >= 0.4) { signalLabel = 'BUY'; trendLabel = 'Bullish'; aiTrend = 'Bullish Drift'; }
    else { signalLabel = 'BUY ZONE'; trendLabel = 'Mild Bullish'; aiTrend = 'Accumulation'; }
  } else if (pct < -0.05) {
    tone = 'bear';
    signalArrow = '▼';
    if (abs >= 1) { signalLabel = 'STRONG SELL'; trendLabel = 'Strong Bearish'; aiTrend = 'Distribution ↓'; }
    else if (abs >= 0.4) { signalLabel = 'SELL'; trendLabel = 'Bearish'; aiTrend = 'Bearish Drift'; }
    else { signalLabel = 'SELL ZONE'; trendLabel = 'Mild Bearish'; aiTrend = 'Light Selling'; }
  } else {
    aiTrend = 'Awaiting Breakout';
  }

  const confidence = Math.max(40, Math.min(95, Math.round(45 + abs * 28 + Math.min(range, 2) * 6 + Math.min(Math.abs(oiDeltaPct), 3) * 3)));

  let volLabel: SignalView['volLabel'] = 'LOW';
  if (range >= 1.2) volLabel = 'HIGH';
  else if (range >= 0.5) volLabel = 'MEDIUM';

  const liquidity = (tick.volume || 0) * (tick.price || 0);
  const liquidityStrength = Math.max(5, Math.min(100, Math.round(Math.log10(Math.max(1, liquidity)) * 10)));

  const pcr = tick.pcr || 0;
  let smartMoney: SignalView['smartMoney'] = { label: 'BALANCED', tone: 'neutral' };
  if (pcr >= 1.3) smartMoney = { label: 'ACCUMULATING', tone: 'bull' };
  else if (pcr >= 1.05) smartMoney = { label: 'BUYING', tone: 'bull' };
  else if (pcr > 0 && pcr <= 0.7) smartMoney = { label: 'DISTRIBUTING', tone: 'bear' };
  else if (pcr > 0 && pcr <= 0.9) smartMoney = { label: 'CAUTIOUS', tone: 'bear' };

  let institutional: SignalView['institutional'] = { label: 'NEUTRAL', tone: 'neutral' };
  if (oiDeltaPct > 0.3 && pct > 0) institutional = { label: 'LONG BUILD', tone: 'bull' };
  else if (oiDeltaPct > 0.3 && pct < 0) institutional = { label: 'SHORT BUILD', tone: 'bear' };
  else if (oiDeltaPct < -0.3 && pct > 0) institutional = { label: 'SHORT COVER', tone: 'bull' };
  else if (oiDeltaPct < -0.3 && pct < 0) institutional = { label: 'LONG UNWIND', tone: 'bear' };

  const momentum = Math.max(-100, Math.min(100, Math.round(pct * 50 + (rangePos - 50) * 0.8 + oiDeltaPct * 10)));

  let buyPressure: number;
  if (pcr > 0) buyPressure = Math.max(5, Math.min(95, Math.round(40 + (pcr - 1) * 30 + (rangePos - 50) * 0.4 + Math.sign(pct) * 8)));
  else buyPressure = Math.max(5, Math.min(95, Math.round(50 + (rangePos - 50) * 0.5 + Math.sign(pct) * 10)));

  const edgeDistance = Math.min(rangePos, 100 - rangePos);
  const breakoutProb = Math.max(5, Math.min(95, Math.round(20 + range * 15 + Math.max(0, 25 - edgeDistance) * 1.5)));

  let reversalProb = Math.max(5, Math.min(95, Math.round(25 + (abs > 1 ? abs * 8 : 0) + edgeDistance * 0.2)));
  if ((pct > 0 && pcr > 0 && pcr < 0.8) || (pct < 0 && pcr >= 1.3)) reversalProb = Math.min(95, reversalProb + 20);

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
  return (
    <div>
      {(leftLabel || rightLabel) && (
        <div className="flex items-center justify-between text-[11px] font-bold text-slate-400">
          <span>{leftLabel}</span>
          <span className={t.text}>{rightLabel}</span>
        </div>
      )}
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800/70">
        <div className={`h-full rounded-full bg-gradient-to-r ${t.bar} transition-all duration-300`} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
};

const TwoSidedBar = ({ value }: { value: number }) => {
  const buy = Math.max(2, Math.min(98, value));
  return (
    <div className="flex h-2 overflow-hidden rounded-full border border-slate-700/60 bg-slate-900">
      <div className="h-full bg-gradient-to-r from-rose-500/80 to-rose-400/60 transition-all duration-300" style={{ width: `${100 - buy}%` }} />
      <div className="h-full bg-gradient-to-r from-emerald-400/60 to-emerald-500/80 transition-all duration-300" style={{ width: `${buy}%` }} />
    </div>
  );
};

const Metric = ({ label, value, tone = 'slate', hot }: { label: string; value: React.ReactNode; tone?: 'slate' | 'bull' | 'bear' | 'neutral' | 'info'; hot?: boolean }) => {
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
  return (
    <div className={`rounded-md border bg-slate-900/40 px-2 py-1.5 transition-all ${hot ? ringMap[tone] : 'border-slate-700/30'}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-0.5 truncate font-mono text-[13px] font-black leading-tight lg:text-sm ${colorMap[tone]}`}>{value}</p>
    </div>
  );
};

const SignalCard = React.memo(function SignalCard({ name, tick }: { name: string; tick: MarketTick | null | undefined }) {
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

  const sig = useMemo(() => deriveSignal(tick, oiDeltaPct), [tick, oiDeltaPct]);

  if (!sig || !tick) {
    return (
      <div className="rounded-xl border border-slate-700/40 bg-slate-950/60 px-3 py-4 text-center">
        <p className="text-[10px] font-bold tracking-wider text-slate-400">{name}</p>
        <p className="mt-2 text-[10px] font-semibold text-slate-500">Awaiting live tick…</p>
      </div>
    );
  }

  const t = TONE[sig.tone];
  const pct = tick.changePercent ?? 0;
  const flashCls = flash === 'up' ? 'ring-1 ring-emerald-300/50' : flash === 'down' ? 'ring-1 ring-rose-300/50' : '';

  return (
    <div className={`relative rounded-xl border bg-gradient-to-br ${t.ring} ${t.bg} p-3 backdrop-blur-sm transition-all duration-200 ${flashCls}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-black tracking-wider text-slate-200 lg:text-base">{name}</p>
          <p className="font-mono text-2xl font-black leading-tight text-slate-100 lg:text-3xl">{fmtPrice(tick.price)}</p>
          <p className={`text-xs font-bold lg:text-sm ${t.text}`}>
            {tick.change >= 0 ? '+' : ''}{tick.change.toFixed(2)} · {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-black lg:text-sm ${t.chip} ${sig.signalLabel.startsWith('STRONG') ? 'ring-1 ring-white/50' : ''}`}>
            <span aria-hidden>{sig.signalArrow}</span>
            <span>{sig.signalLabel}</span>
          </span>
          <span className={`rounded border px-1.5 py-0.5 text-[11px] font-bold ${VOL_STYLES[sig.volLabel]} ${sig.volLabel === 'HIGH' ? 'ring-1 ring-rose-300/50' : ''}`}>
            VOL · {sig.volLabel} {sig.volExpansion.toFixed(2)}%
          </span>
        </div>
      </div>

      <div className={`mt-3 rounded-md p-1 transition-all ${sig.confidence >= 70 ? `ring-1 ${sig.tone === 'bull' ? 'ring-emerald-300/50' : sig.tone === 'bear' ? 'ring-rose-300/50' : 'ring-amber-300/50'}` : ''}`}>
        <Bar value={sig.confidence} tone={sig.tone} leftLabel="AI CONFIDENCE" rightLabel={`${sig.confidence}%`} />
      </div>

      <div className={`mt-2 rounded-md p-1 transition-all ${sig.buyPressure >= 75 || sig.buyPressure <= 25 ? `ring-1 ${sig.buyPressure >= 75 ? 'ring-emerald-300/50' : 'ring-rose-300/50'}` : ''}`}>
        <div className="flex items-center justify-between text-[11px] font-bold">
          <span className="text-rose-300">SELL {100 - sig.buyPressure}%</span>
          <span className="text-slate-400">PRESSURE</span>
          <span className="text-emerald-300">BUY {sig.buyPressure}%</span>
        </div>
        <div className="mt-1"><TwoSidedBar value={sig.buyPressure} /></div>
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-1.5">
        <Metric label="Volume" value={fmtCompact(tick.volume)} tone="info" />
        <Metric label="Liquidity" value={`₹${fmtCompact(sig.liquidity)}`} tone="info" />
        <Metric label="OI" value={fmtCompact(tick.oi)} tone="info" />
        <Metric
          label="ΔOI %"
          value={`${oiDeltaPct >= 0 ? '+' : ''}${oiDeltaPct.toFixed(2)}%`}
          tone={Math.abs(oiDeltaPct) < 0.2 ? 'slate' : oiDeltaPct > 0 ? 'bull' : 'bear'}
          hot={Math.abs(oiDeltaPct) >= 0.5}
        />
        <Metric
          label="Momentum"
          value={`${sig.momentum >= 0 ? '+' : ''}${sig.momentum}`}
          tone={sig.momentum > 10 ? 'bull' : sig.momentum < -10 ? 'bear' : 'neutral'}
          hot={Math.abs(sig.momentum) >= 40}
        />
        <Metric label="Range Pos" value={`${Math.round(sig.rangePos)}%`} tone="slate" hot={sig.rangePos <= 15 || sig.rangePos >= 85} />
        <Metric label="Smart Money" value={sig.smartMoney.label} tone={sig.smartMoney.tone} hot={sig.smartMoney.label === 'ACCUMULATING' || sig.smartMoney.label === 'DISTRIBUTING'} />
        <Metric label="Inst. Flow" value={sig.institutional.label} tone={sig.institutional.tone} hot={sig.institutional.tone !== 'neutral'} />
        <Metric label="AI Trend" value={sig.aiTrend} tone={sig.tone} hot={sig.aiTrend.includes('Continuation') || sig.aiTrend.includes('Distribution')} />
      </div>

      <div className="mt-3 space-y-1.5">
        <div className={`rounded-md p-1 transition-all ${sig.liquidityStrength >= 90 ? 'ring-1 ring-emerald-300/50' : ''}`}>
          <Bar value={sig.liquidityStrength} tone="bull" leftLabel="LIQUIDITY STRENGTH" rightLabel={`${sig.liquidityStrength}%`} />
        </div>
        <div className={`rounded-md p-1 transition-all ${sig.breakoutProb >= 65 ? 'ring-1 ring-emerald-300/50' : ''}`}>
          <Bar value={sig.breakoutProb} tone="bull" leftLabel="BREAKOUT PROB" rightLabel={`${sig.breakoutProb}%`} />
        </div>
        <div className={`rounded-md p-1 transition-all ${sig.reversalProb >= 65 ? 'ring-1 ring-rose-300/50' : ''}`}>
          <Bar value={sig.reversalProb} tone="bear" leftLabel="REVERSAL PROB" rightLabel={`${sig.reversalProb}%`} />
        </div>
      </div>
    </div>
  );
});

const TopAISignalBar = ({ marketData, isConnected }: TopAISignalBarProps) => {
  return (
    <section
      aria-label="AI Signal Deck"
      className="mb-3 rounded-xl border border-cyan-400/15 bg-gradient-to-br from-slate-950 via-slate-900/80 to-cyan-950/10 px-3 py-3 sm:px-4"
    >
      <div className="mb-2.5 flex items-center justify-between px-0.5">
        <div className="flex items-center gap-3">
          <span className="text-lg font-black tracking-[0.22em] text-cyan-300 lg:text-2xl">AI SIGNAL DECK</span>
          <span className="hidden text-sm font-semibold text-slate-400 sm:inline">· Institutional-grade observation · &lt; 3s read</span>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-900/80 px-2.5 py-1 text-[11px] font-bold text-slate-300">
          <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
          {isConnected ? 'LIVE' : 'SYNC'}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {INDICES.map(({ key, name }) => (
          <SignalCard key={key} name={name} tick={marketData[key]} />
        ))}
      </div>
    </section>
  );
};

export default React.memo(TopAISignalBar);
