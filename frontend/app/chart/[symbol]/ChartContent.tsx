'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useChartIntelligence, type SymbolChartData, type OrderBlock, type FVG } from '@/hooks/useChartIntelligence';
import { useMarketSocket } from '@/hooks/useMarketSocket';

// ── LiveNumber ────────────────────────────────────────────────────────────────
// rAF-tweened numeric display with directional flash on change.
// Eliminates the "instant text swap" jitter when feeds push fast updates.
const LiveNumber: React.FC<{
  value: number;
  format: (n: number) => string;
  durationMs?: number;
  className?: string;
  flash?: boolean;
}> = ({ value, format, durationMs = 260, className = '', flash = true }) => {
  const [display, setDisplay] = useState(value);
  const [dir, setDir] = useState<'up' | 'down' | null>(null);
  const fromRef = useRef(value);
  const startRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTargetRef = useRef(value);

  useEffect(() => {
    if (!Number.isFinite(value) || value === lastTargetRef.current) return;
    if (lastTargetRef.current !== 0 && value !== lastTargetRef.current) {
      setDir(value > lastTargetRef.current ? 'up' : 'down');
    }
    fromRef.current = display;
    lastTargetRef.current = value;
    startRef.current = performance.now();
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    const tick = (now: number) => {
      const t = Math.min(1, (now - startRef.current) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = fromRef.current + (value - fromRef.current) * eased;
      setDisplay(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else rafRef.current = null;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); };
  }, [value, display, durationMs]);

  useEffect(() => {
    if (!dir) return;
    const id = window.setTimeout(() => setDir(null), 480);
    return () => window.clearTimeout(id);
  }, [dir]);

  const flashCls = flash && dir
    ? dir === 'up'
      ? 'transition-colors duration-500 bg-emerald-500/15 ring-1 ring-emerald-400/20 rounded'
      : 'transition-colors duration-500 bg-red-500/15 ring-1 ring-red-400/20 rounded'
    : 'transition-colors duration-500';

  return <span className={`${flashCls} tabular-nums ${className}`}>{format(display)}</span>;
};

const SymbolChartCard = dynamic(
  () => import('@/components/ChartIntelligence').then(m => m.SymbolChartCard),
  { ssr: false, loading: () => (
    <div className="flex items-center justify-center h-64 text-slate-500 text-sm">Loading chart…</div>
  )}
);

type SymbolKey = 'NIFTY' | 'BANKNIFTY' | 'SENSEX';

const SYMBOL_LABELS: Record<SymbolKey, string> = {
  NIFTY: 'NIFTY 50',
  BANKNIFTY: 'BANK NIFTY',
  SENSEX: 'SENSEX',
};

// ── helpers ───────────────────────────────────────────────────────────────────

const fmtPrice = (v: number) =>
  v >= 10000
    ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
    : v.toFixed(2);

const fmtRange = (lo: number, hi: number) =>
  `${fmtPrice(Math.min(lo, hi))} – ${fmtPrice(Math.max(lo, hi))}`;

const fmtBig = (n: number) => {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(0);
};

const clampPct = (v: number) => Math.max(0, Math.min(100, v));

const qualityRank = (q?: 'PREMIUM' | 'STANDARD' | 'WEAK') =>
  q === 'PREMIUM' ? 3 : q === 'STANDARD' ? 2 : 1;

// ── derived data ──────────────────────────────────────────────────────────────

function useDerived(data: SymbolChartData | null) {
  return useMemo(() => {
    const empty = {
      buyLiq: 0, sellLiq: 0, totalLiq: 0, netLiq: 0,
      buyLiqPct: 50, sellLiqPct: 50,
      buyProb: 50, sellProb: 50, confidence: 0,
      biasLabel: 'NEUTRAL' as 'BULLISH' | 'BEARISH' | 'NEUTRAL',
      sentimentLabel: 'BALANCED', moodLabel: 'BALANCED',
      mtfAlign: 0, heatPos: 50,
      cdh: 0, cdl: 0, pdh: 0, pdl: 0,
    };
    if (!data) return empty;

    const c5 = data.candles5m ?? [];
    const recent = c5.slice(-60);
    let buyV = 0;
    let sellV = 0;
    for (const k of recent) {
      if (k.c > k.o) buyV += k.v;
      else if (k.c < k.o) sellV += k.v;
      else { buyV += k.v * 0.5; sellV += k.v * 0.5; }
    }
    const scale = 100;
    const buyLiq = buyV * scale;
    const sellLiq = sellV * scale;
    const totalLiq = buyLiq + sellLiq;
    const netLiq = buyLiq - sellLiq;
    const buyLiqPct = totalLiq > 0 ? (buyLiq / totalLiq) * 100 : 50;
    const sellLiqPct = 100 - buyLiqPct;

    const cp = data.ai?.classProbabilities;
    const buyProb = cp ? clampPct((cp.STRONG_BUY ?? 0) + (cp.BUY ?? 0)) : buyLiqPct;
    const sellProb = cp ? clampPct((cp.STRONG_SELL ?? 0) + (cp.SELL ?? 0)) : sellLiqPct;
    const biasLabel: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
      buyProb - sellProb > 5 ? 'BULLISH'
      : sellProb - buyProb > 5 ? 'BEARISH'
      : 'NEUTRAL';

    const maxClass = cp
      ? Math.max(cp.STRONG_BUY, cp.BUY, cp.NEUTRAL, cp.SELL, cp.STRONG_SELL)
      : Math.max(buyProb, sellProb);
    const confidence = clampPct(maxClass);

    const sentimentLabel =
      biasLabel === 'BULLISH' ? 'POSITIVE'
      : biasLabel === 'BEARISH' ? 'NEGATIVE'
      : 'BALANCED';

    const mtfAlign = data.ai?.multiTimeframe?.alignmentPct ?? 0;
    const moodLabel =
      biasLabel === 'BULLISH' && mtfAlign > 60 ? 'OPTIMISTIC'
      : biasLabel === 'BEARISH' && mtfAlign > 60 ? 'PESSIMISTIC'
      : mtfAlign < 40 ? 'UNCERTAIN'
      : 'BALANCED';

    return {
      buyLiq, sellLiq, totalLiq, netLiq,
      buyLiqPct, sellLiqPct,
      buyProb, sellProb, confidence,
      biasLabel, sentimentLabel, moodLabel,
      mtfAlign,
      heatPos: clampPct(sellLiqPct),
      cdh: data.levels?.cdh ?? 0,
      cdl: data.levels?.cdl ?? 0,
      pdh: data.levels?.pdh ?? 0,
      pdl: data.levels?.pdl ?? 0,
    };
  }, [data]);
}

// ── levels table rows ────────────────────────────────────────────────────────

interface LevelRow {
  key: string;
  label: string;
  type: 'RES' | 'SUP' | 'OB' | 'FVG';
  rangeLo: number;
  rangeHi: number;
  liquidity: number;
  side: 'BUY' | 'SELL';
  probability: number;
  status: 'STRONG' | 'ACTIVE' | 'WEAK';
  reaction: 'REJECTION' | 'REACTION' | 'FILL LIKELY' | 'HOLDING' | 'STRONG HOLD';
  color: string;
}

function estimateZoneLiq(z: OrderBlock | FVG): number {
  const q = qualityRank(z.quality);
  const strength = (z as OrderBlock).strength ?? (z as FVG).strength ?? 1;
  return strength * q * 0.8e9 + (z.total_vol ?? 0) * 100;
}

function estimateLevelLiq(data: SymbolChartData): number {
  const last30 = (data.candles5m ?? []).slice(-30);
  const v = last30.reduce((a, c) => a + c.v, 0);
  return v * 90 + 1.5e9;
}

function buildLevelRows(data: SymbolChartData | null, spot: number): LevelRow[] {
  if (!data || spot <= 0) return [];
  const rows: LevelRow[] = [];
  const { levels } = data;
  const obs = (data.ob5m?.length ? data.ob5m : data.ob3m) ?? [];
  const fvgs = (data.fvg5m?.length ? data.fvg5m : data.fvg3m) ?? [];
  const dist = (v: number) => Math.abs(v - spot);

  if (levels?.cdh) {
    rows.push({
      key: 'res-dh', label: 'RESISTANCE (DAY HIGH)', type: 'RES',
      rangeLo: levels.cdh * 0.999, rangeHi: levels.cdh,
      liquidity: estimateLevelLiq(data), side: 'SELL',
      probability: 72, status: 'STRONG', reaction: 'REJECTION',
      color: 'bg-pink-500',
    });
  }
  const bearOB = obs.filter(o => o.type === 'bearish' && !o.mitigated && o.top >= spot)
    .sort((a, b) => dist(a.bottom) - dist(b.bottom))[0];
  if (bearOB) {
    rows.push({
      key: 'ob-bear', label: 'BEARISH OB', type: 'OB',
      rangeLo: bearOB.bottom, rangeHi: bearOB.top,
      liquidity: estimateZoneLiq(bearOB), side: 'SELL',
      probability: 60 + qualityRank(bearOB.quality) * 4,
      status: bearOB.quality === 'PREMIUM' ? 'STRONG' : 'ACTIVE',
      reaction: 'REACTION', color: 'bg-red-400',
    });
  }
  const bearFVG = fvgs.filter(z => z.type === 'bearish' && !z.filled && z.top >= spot)
    .sort((a, b) => dist(a.bottom) - dist(b.bottom))[0];
  if (bearFVG) {
    rows.push({
      key: 'fvg-upper', label: 'FVG (UPPER)', type: 'FVG',
      rangeLo: bearFVG.bottom, rangeHi: bearFVG.top,
      liquidity: estimateZoneLiq(bearFVG), side: 'SELL',
      probability: 55 + qualityRank(bearFVG.quality) * 3,
      status: bearFVG.quality === 'PREMIUM' ? 'STRONG' : 'ACTIVE',
      reaction: 'FILL LIKELY', color: 'bg-cyan-400',
    });
  }
  if (levels?.cdl) {
    rows.push({
      key: 'sup-dl', label: 'DAY LOW', type: 'SUP',
      rangeLo: levels.cdl, rangeHi: levels.cdl * 1.0005,
      liquidity: estimateLevelLiq(data), side: 'BUY',
      probability: 76, status: 'STRONG', reaction: 'HOLDING',
      color: 'bg-emerald-400',
    });
  }
  const bullOB = obs.filter(o => o.type === 'bullish' && !o.mitigated && o.bottom <= spot)
    .sort((a, b) => dist(a.top) - dist(b.top))[0];
  if (bullOB) {
    rows.push({
      key: 'ob-bull', label: 'BULLISH OB', type: 'OB',
      rangeLo: bullOB.bottom, rangeHi: bullOB.top,
      liquidity: estimateZoneLiq(bullOB), side: 'BUY',
      probability: 60 + qualityRank(bullOB.quality) * 4,
      status: bullOB.quality === 'PREMIUM' ? 'STRONG' : 'ACTIVE',
      reaction: 'REACTION', color: 'bg-emerald-500',
    });
  }
  const bullFVG = fvgs.filter(z => z.type === 'bullish' && !z.filled && z.bottom <= spot)
    .sort((a, b) => dist(a.top) - dist(b.top))[0];
  if (bullFVG) {
    rows.push({
      key: 'fvg-lower', label: 'FVG (LOWER)', type: 'FVG',
      rangeLo: bullFVG.bottom, rangeHi: bullFVG.top,
      liquidity: estimateZoneLiq(bullFVG), side: 'BUY',
      probability: 55 + qualityRank(bullFVG.quality) * 3,
      status: bullFVG.quality === 'PREMIUM' ? 'STRONG' : 'ACTIVE',
      reaction: 'FILL LIKELY', color: 'bg-teal-400',
    });
  }
  if (levels?.pdl) {
    rows.push({
      key: 'sup-pdl', label: 'SUPPORT (PREV LOW)', type: 'SUP',
      rangeLo: levels.pdl, rangeHi: levels.pdl * 1.0005,
      liquidity: estimateLevelLiq(data), side: 'BUY',
      probability: 81, status: 'STRONG', reaction: 'STRONG HOLD',
      color: 'bg-emerald-300',
    });
  }
  return rows;
}

// ── constants ─────────────────────────────────────────────────────────────────

const SMC_TABS = [
  { key: 'LIQUIDITY', label: 'LIQUIDITY', icon: '💧' },
  { key: 'BOS_CHOCH', label: 'BOS/CHOCH', icon: '⊟' },
  { key: 'OB', label: 'OB', icon: '◆' },
  { key: 'FVG', label: 'FVG', icon: '◇' },
  { key: 'SUP_RES', label: 'SUP/RES', icon: '↕' },
  { key: 'DAY_HL', label: 'DAY H/L', icon: '☼' },
  { key: 'PREV_HL', label: 'PREV H/L', icon: '◷' },
  { key: 'VOLUME', label: 'VOLUME', icon: '▤' },
] as const;
type TabKey = typeof SMC_TABS[number]['key'];

const RANGES = ['1D', '1W', '1M', '3M', '6M', '1Y', '5Y'] as const;
type RangeKey = typeof RANGES[number];

// ── primitives ───────────────────────────────────────────────────────────────

const Card: React.FC<React.PropsWithChildren<{ className?: string }>> = ({ className = '', children }) => (
  <div className={`rounded-lg border border-slate-700/50 bg-[#101725]/80 backdrop-blur-sm ${className}`}>
    {children}
  </div>
);

const Sparkline: React.FC<{ data: number[]; color: string; height?: number }> = ({ data, color, height = 28 }) => {
  if (!data.length) return <div style={{ height }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / Math.max(1, data.length - 1)) * 100;
    const y = ((max - v) / range) * 100;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full" style={{ height }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

const Donut: React.FC<{
  buy: number; sell: number; size?: number; thickness?: number; showLabels?: boolean;
}> = ({ buy, sell, size = 110, thickness = 12, showLabels = true }) => {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const buyLen = (buy / 100) * c;
  const sellLen = (sell / 100) * c;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#1f2937" strokeWidth={thickness} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#10b981" strokeWidth={thickness} fill="none"
          strokeDasharray={`${buyLen} ${c}`} />
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#ef4444" strokeWidth={thickness} fill="none"
          strokeDasharray={`${sellLen} ${c}`} strokeDashoffset={-buyLen} />
      </svg>
      {showLabels && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[10px] tracking-widest text-slate-400">{buy >= sell ? 'BUY' : 'SELL'}</span>
          <span className="text-base font-bold text-slate-100 tabular-nums">{Math.round(Math.max(buy, sell))}%</span>
        </div>
      )}
    </div>
  );
};

const IconBtn: React.FC<React.PropsWithChildren> = ({ children }) => (
  <button className="w-7 h-7 rounded-md bg-[#0f1421] border border-slate-700 text-slate-400 hover:text-slate-200 text-[11px]">
    {children}
  </button>
);

const IndexCard: React.FC<{
  label: string; value: number; delta: number; spark: number[]; accent: 'emerald' | 'red';
}> = ({ label, value, delta, spark, accent }) => {
  const color = accent === 'emerald' ? '#10b981' : '#ef4444';
  const deltaColor = delta >= 0 ? 'text-emerald-400' : 'text-red-400';
  return (
    <Card className="px-3 py-2 min-w-0">
      <div className="text-[8.5px] tracking-widest text-slate-400 font-bold truncate">{label}</div>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[14px] sm:text-[15px] font-mono font-bold text-slate-100 tabular-nums truncate">
            {value > 0 ? <LiveNumber value={value} format={fmtPrice} /> : '—'}
          </div>
          <div className={`text-[10px] font-mono tabular-nums ${deltaColor}`}>
            <LiveNumber value={delta} format={(n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`} flash={false} />
          </div>
        </div>
        <div className="w-16 sm:w-20 shrink-0">
          <Sparkline data={spark} color={color} height={26} />
        </div>
      </div>
    </Card>
  );
};

const Stat: React.FC<{ k: string; v: string }> = ({ k, v }) => (
  <div className="flex items-center justify-between gap-3 leading-tight py-0.5">
    <span className="text-slate-400">{k}</span>
    <span className="text-slate-200 tabular-nums font-mono">{v}</span>
  </div>
);

const SummaryCell: React.FC<{ label: string; value: string; sub?: string; color: string }> = ({ label, value, sub, color }) => (
  <div>
    <div className="text-[8.5px] tracking-widest text-slate-400 font-bold">{label}</div>
    <div className={`text-[15px] font-bold tabular-nums ${color}`}>
      {value} {sub && <span className="text-[9px] text-slate-500 font-normal">{sub}</span>}
    </div>
  </div>
);

// Trend pill used in the Multi-Timeframe matrix
const TrendPill: React.FC<{ tf: string; trend?: 'BULL' | 'BEAR' | 'NEUTRAL'; momentum?: number }> = ({ tf, trend, momentum }) => {
  const t = trend ?? 'NEUTRAL';
  const m = clampPct(((momentum ?? 0) + 1) * 50); // -1..1 → 0..100
  const color = t === 'BULL' ? 'text-emerald-400' : t === 'BEAR' ? 'text-red-400' : 'text-slate-300';
  const bar = t === 'BULL' ? 'bg-emerald-400' : t === 'BEAR' ? 'bg-red-400' : 'bg-slate-500';
  const arrow = t === 'BULL' ? '▲' : t === 'BEAR' ? '▼' : '◆';
  return (
    <div className="flex items-center gap-2 leading-tight">
      <span className="text-[9px] tracking-widest text-slate-500 w-10 shrink-0">{tf}</span>
      <span className={`text-[11px] font-bold w-14 shrink-0 ${color}`}>{arrow} {t}</span>
      <div className="flex-1 h-1 rounded-full bg-slate-700/40 overflow-hidden min-w-[40px]">
        <div className={`h-full ${bar}`} style={{ width: `${m}%` }} />
      </div>
    </div>
  );
};

// Risk meter (red = high risk). Accepts value as 0-100 percent.
const RiskBar: React.FC<{ label: string; value: number }> = ({ label, value }) => {
  const v = clampPct(value);
  const tone = v >= 66 ? 'bg-red-400' : v >= 33 ? 'bg-amber-300' : 'bg-emerald-400';
  const txt = v >= 66 ? 'text-red-400' : v >= 33 ? 'text-amber-300' : 'text-emerald-400';
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-slate-400">{label}</span>
        <span className={`tabular-nums font-bold ${txt}`}>
          <LiveNumber value={v} format={(n) => `${n.toFixed(0)}%`} flash={false} />
        </span>
      </div>
      <div className="h-1 rounded-full bg-slate-700/40 overflow-hidden">
        <div className={`h-full transition-[width] duration-500 ease-out ${tone}`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
};

// ── main component ───────────────────────────────────────────────────────────

export default function ChartContent({ symbol: rawSymbol }: { symbol: string }) {
  const symbol = rawSymbol.toUpperCase() as SymbolKey;
  const isValid = ['NIFTY', 'BANKNIFTY', 'SENSEX'].includes(symbol);

  const { chartData } = useChartIntelligence();
  const { marketData } = useMarketSocket();

  const [activeTab, setActiveTab] = useState<TabKey>('LIQUIDITY');
  const [range, setRange] = useState<RangeKey>('3M');

  const data = isValid ? (chartData[symbol] ?? null) : null;
  const tick = isValid ? marketData[symbol] : null;

  const liveSpot = useMemo(() => {
    if (!tick || tick.price <= 0 || tick.status !== 'LIVE') return undefined;
    const tsMs = Date.parse(tick.timestamp || '');
    if (!Number.isFinite(tsMs) || Date.now() - tsMs > 6000) return undefined;
    const base = data?.spot ?? data?.candles5m?.at(-1)?.c ?? 0;
    if (base <= 0) return undefined;
    const driftPct = Math.abs(tick.price - base) / base;
    if (driftPct > 0.0018) return undefined;
    return tick.price;
  }, [tick, data]);

  const label = isValid ? SYMBOL_LABELS[symbol] : symbol;
  const displayPrice = liveSpot ?? data?.spot ?? 0;
  const change = tick?.change ?? 0;
  const changePct = tick?.changePercent ?? 0;
  const priceColor =
    change > 0 ? 'text-emerald-400' : change < 0 ? 'text-red-400' : 'text-slate-300';

  const derived = useDerived(data);
  const levelRows = useMemo(() => buildLevelRows(data, displayPrice), [data, displayPrice]);
  const sparkData = useMemo(() => (data?.candles5m ?? []).slice(-40).map(c => c.c), [data]);

  const futNear = displayPrice > 0 ? displayPrice * (1 + (changePct >= 0 ? 0.0035 : -0.0028)) : 0;
  const futFar = displayPrice > 0 ? displayPrice * (1 + (changePct >= 0 ? 0.0070 : -0.0055)) : 0;

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chartH, setChartH] = useState(440);
  useEffect(() => {
    const compute = () => {
      const h = chartContainerRef.current?.getBoundingClientRect().height ?? 440;
      setChartH(Math.max(280, Math.floor(h)));
    };
    compute();
    window.addEventListener('resize', compute);
    const el = chartContainerRef.current;
    const ro = el ? new ResizeObserver(compute) : null;
    if (el && ro) ro.observe(el);
    return () => {
      window.removeEventListener('resize', compute);
      ro?.disconnect();
    };
  }, []);

  if (!isValid) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-red-400 text-lg font-bold">Unknown symbol: {rawSymbol}</p>
          <p className="text-slate-500 text-sm">Valid values: NIFTY, BANKNIFTY, SENSEX</p>
          <button
            onClick={() => window.close()}
            className="mt-4 px-4 py-1.5 rounded-lg bg-slate-700 text-slate-300 text-sm hover:bg-slate-600"
          >
            Close tab
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-200 flex flex-col">
      {/* 1) HEADER */}
      <header className="px-3 sm:px-5 pt-3 pb-2 border-b border-slate-800/50">
        <div className="flex flex-col xl:flex-row xl:items-center gap-3">
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => window.close()}
              title="Close tab"
              className="w-3 h-3 rounded-full bg-[#ff5f57] hover:bg-[#ff3b30] border border-[#c03b35]/60"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[13px] sm:text-[15px] font-bold text-slate-100 tracking-tight">{label}</span>
                <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-400 tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  LIVE
                </span>
              </div>
              <div className={`text-[22px] sm:text-[26px] font-mono font-bold tabular-nums leading-tight ${priceColor}`}>
                {displayPrice > 0
                  ? <LiveNumber value={displayPrice} format={fmtPrice} />
                  : '—'}
              </div>
              <div className={`text-[11px] font-mono tabular-nums ${priceColor}`}>
                <LiveNumber value={change} format={(n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`} />
                {' ('}
                <LiveNumber value={changePct} format={(n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`} flash={false} />
                {')'}
              </div>
              {data?.ai?.commandDeck && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[9px] tracking-wider font-mono">
                  <span className={`px-1.5 py-0.5 rounded ${
                    data.ai.commandDeck.streamState === 'LIVE' ? 'bg-emerald-500/15 text-emerald-300'
                    : data.ai.commandDeck.streamState === 'DELAYED' ? 'bg-amber-500/15 text-amber-300'
                    : 'bg-slate-700/40 text-slate-400'
                  }`}>{data.ai.commandDeck.streamState}</span>
                  <span className="text-slate-500">LAT <LiveNumber value={data.ai.commandDeck.analysisLatencyMs} format={(n) => `${Math.round(n)}ms`} className="text-slate-300" flash={false} /></span>
                  <span className="text-slate-500">EV/s <LiveNumber value={data.ai.commandDeck.eventRatePerSec} format={(n) => n.toFixed(1)} className="text-slate-300" flash={false} /></span>
                  <span className="text-slate-500">Q <LiveNumber value={data.ai.commandDeck.queueDepth} format={(n) => `${Math.round(n)}`} className="text-slate-300" flash={false} /></span>
                  <span className={`tabular-nums ${
                    data.ai.commandDeck.cacheState === 'HOT' ? 'text-emerald-300'
                    : data.ai.commandDeck.cacheState === 'WARM' ? 'text-amber-300'
                    : 'text-slate-400'
                  }`}>{data.ai.commandDeck.cacheState}</span>
                  <span className="text-slate-500">SRC <span className="text-slate-300">{data.dataSource}</span></span>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:gap-3 flex-1 min-w-0">
            <IndexCard label="CURRENT INDEX" value={displayPrice} delta={changePct} spark={sparkData} accent="emerald" />
            <IndexCard label="FUTURE INDEX (JUN)" value={futNear} delta={changePct * 1.05} spark={sparkData} accent="emerald" />
            <IndexCard label="FUTURE INDEX (NEXT)" value={futFar} delta={changePct * 1.15} spark={sparkData} accent="emerald" />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              className={`px-3 py-1.5 rounded-md border text-[11px] font-bold tracking-wider flex items-center gap-1.5 ${
                derived.biasLabel === 'BULLISH'
                  ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10'
                  : derived.biasLabel === 'BEARISH'
                  ? 'border-red-500/40 text-red-300 bg-red-500/10'
                  : 'border-slate-600 text-slate-300 bg-slate-700/30'
              }`}
            >
              <span>{derived.biasLabel === 'BEARISH' ? '↘' : derived.biasLabel === 'BULLISH' ? '↗' : '→'}</span>
              {derived.biasLabel} BIAS
            </button>
            <select
              value={range}
              onChange={(e) => setRange(e.target.value as RangeKey)}
              className="px-2 py-1.5 rounded-md bg-[#0f1421] border border-slate-700 text-[11px] text-slate-300 font-mono"
            >
              {RANGES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <IconBtn>⇅</IconBtn>
            <IconBtn>ƒx</IconBtn>
            <IconBtn>⚙</IconBtn>
          </div>
        </div>
      </header>

      {/* 2) STAT TILES */}
      <section className="px-3 sm:px-5 py-3 grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <Card className="p-3">
          <div className="text-[9px] tracking-widest text-slate-400 font-bold mb-2">
            <span className="text-emerald-400">ADVANCED</span> LIQUIDITY
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="text-[10px] text-slate-400">BUY SIDE LIQUIDITY</div>
            <div className="flex items-baseline justify-between">
              <span className="text-[18px] font-bold text-emerald-400 tabular-nums"><LiveNumber value={derived.buyLiq} format={fmtBig} /></span>
              <span className="text-[10px] text-slate-500 tabular-nums"><LiveNumber value={derived.buyLiqPct} format={(n) => `${n.toFixed(0)}%`} flash={false} /></span>
            </div>
            <div className="h-1 rounded-full bg-slate-700/40 overflow-hidden">
              <div className="h-full bg-emerald-500 transition-[width] duration-500 ease-out" style={{ width: `${derived.buyLiqPct}%` }} />
            </div>
            <div className="text-[10px] text-slate-400 mt-1">SELL SIDE LIQUIDITY</div>
            <div className="flex items-baseline justify-between">
              <span className="text-[18px] font-bold text-red-400 tabular-nums"><LiveNumber value={derived.sellLiq} format={fmtBig} /></span>
              <span className="text-[10px] text-slate-500 tabular-nums"><LiveNumber value={derived.sellLiqPct} format={(n) => `${n.toFixed(0)}%`} flash={false} /></span>
            </div>
            <div className="h-1 rounded-full bg-slate-700/40 overflow-hidden">
              <div className="h-full bg-red-500 transition-[width] duration-500 ease-out" style={{ width: `${derived.sellLiqPct}%` }} />
            </div>
          </div>
        </Card>

        <Card className="p-3">
          <div className="text-[9px] tracking-widest text-slate-400 font-bold mb-2">MARKET PROBABILITY</div>
          <div className="flex items-center gap-3">
            <Donut buy={derived.buyProb} sell={derived.sellProb} size={86} thickness={10} />
            <div className="flex flex-col gap-1 text-[10px]">
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-emerald-400" />
                <span className="text-slate-400">BUY PROBABILITY</span>
              </div>
              <span className="text-emerald-400 font-bold tabular-nums"><LiveNumber value={derived.buyProb} format={(n) => `${n.toFixed(0)}%`} /></span>
              <div className="flex items-center gap-1 mt-1">
                <span className="w-2 h-2 rounded-sm bg-red-400" />
                <span className="text-slate-400">SELL PROBABILITY</span>
              </div>
              <span className="text-red-400 font-bold tabular-nums"><LiveNumber value={derived.sellProb} format={(n) => `${n.toFixed(0)}%`} /></span>
            </div>
          </div>
        </Card>

        <Card className="p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[9px] tracking-widest text-slate-400 font-bold">OVERALL BIAS</div>
            {data?.ai?.smc && (
              <span className={`text-[8.5px] tracking-wider px-1.5 py-0.5 rounded font-bold ${
                data.ai.smc.state === 'BULLISH_IMBALANCE' ? 'bg-emerald-500/15 text-emerald-300'
                : data.ai.smc.state === 'BEARISH_IMBALANCE' ? 'bg-red-500/15 text-red-300'
                : data.ai.smc.state === 'LIQUIDITY_SWEEP_RISK' ? 'bg-amber-500/15 text-amber-300'
                : 'bg-slate-700/40 text-slate-300'
              }`}>{data.ai.smc.state.replace(/_/g, ' ')} · <LiveNumber value={Math.round(data.ai.smc.score * 100)} format={(n) => `${Math.round(n)}`} flash={false} /></span>
            )}
          </div>
          <div className={`text-[22px] font-bold tracking-wider ${
            derived.biasLabel === 'BULLISH' ? 'text-emerald-400'
            : derived.biasLabel === 'BEARISH' ? 'text-red-400'
            : 'text-slate-300'
          }`}>
            {derived.biasLabel}
          </div>
          <div className="text-[9px] tracking-widest text-slate-400 mt-3">CONFIDENCE</div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[18px] font-bold text-slate-100 tabular-nums"><LiveNumber value={derived.confidence} format={(n) => `${n.toFixed(0)}%`} flash={false} /></span>
            <div className="flex-1 flex items-end gap-0.5 h-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className={`flex-1 rounded-sm ${i < Math.round(derived.confidence / 10) ? 'bg-emerald-400' : 'bg-slate-700/40'}`}
                  style={{ height: `${30 + i * 7}%` }}
                />
              ))}
            </div>
          </div>
        </Card>

        <Card className="p-3">
          <div className="text-[9px] tracking-widest text-slate-400 font-bold mb-2">SENTIMENT</div>
          <div className={`text-[22px] font-bold tracking-wider ${
            derived.sentimentLabel === 'POSITIVE' ? 'text-emerald-400'
            : derived.sentimentLabel === 'NEGATIVE' ? 'text-red-400'
            : 'text-slate-300'
          }`}>
            {derived.sentimentLabel}
          </div>
          <div className="text-[9px] tracking-widest text-slate-400 mt-3">MARKET MOOD</div>
          <div className="text-[15px] font-bold text-amber-300 tracking-wider mt-1">{derived.moodLabel}</div>
        </Card>
      </section>

      {/* 3) TAB BAR */}
      <nav className="px-3 sm:px-5 pb-3">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {SMC_TABS.map(t => {
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`px-3 py-1.5 rounded-md text-[10px] font-bold tracking-wider whitespace-nowrap flex items-center gap-1.5 border ${
                  active
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                    : 'bg-[#101725] text-slate-400 border-slate-700/50 hover:text-slate-200'
                }`}
              >
                <span className="text-[12px]">{t.icon}</span>
                {t.label}
              </button>
            );
          })}
          <button className="ml-auto w-7 h-7 rounded-md bg-[#101725] border border-slate-700/50 text-slate-400 hover:text-slate-200 shrink-0">⚙</button>
        </div>
      </nav>

      {/* 3.5) AI INTELLIGENCE — institutional-grade signals */}
      {data?.ai && (
        <section className="px-3 sm:px-5 pb-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2 sm:gap-3">
          {/* AI Ensemble + Online Calibrator */}
          {data.ai.ensemble && (
            <Card className="p-3 md:col-span-2 xl:col-span-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] tracking-widest text-emerald-300 font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30">AI ENSEMBLE</span>
                  <span className="text-[9px] text-slate-500 tracking-widest font-mono">{data.ai.ensemble.version}</span>
                </div>
                <div className="flex items-center gap-3 text-[10px] font-mono">
                  <span className="text-slate-400">HIT RATE <span className={`tabular-nums font-bold ${
                    data.ai.ensemble.hitRatePct >= 60 ? 'text-emerald-400'
                    : data.ai.ensemble.hitRatePct >= 45 ? 'text-amber-300'
                    : 'text-red-400'
                  }`}><LiveNumber value={data.ai.ensemble.hitRatePct} format={(n) => `${n.toFixed(0)}%`} flash={false} /></span> <span className="text-slate-500">(<LiveNumber value={data.ai.ensemble.samples} format={(n) => `${Math.round(n)}`} flash={false} />)</span></span>
                  <span className="text-slate-400">W <span className="text-slate-200 tabular-nums"><LiveNumber value={data.ai.ensemble.calibrator.w} format={(n) => n.toFixed(2)} flash={false} /></span></span>
                  <span className="text-slate-400">b <span className="text-slate-200 tabular-nums"><LiveNumber value={data.ai.ensemble.calibrator.b} format={(n) => n.toFixed(2)} flash={false} /></span></span>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[260px,1fr,180px] gap-3 items-center">
                {/* Unified P(up) */}
                <div className="flex flex-col items-center justify-center text-center">
                  <div className="text-[8.5px] tracking-widest text-slate-400 font-bold">UNIFIED P(UP)</div>
                  <div className={`text-[34px] font-bold font-mono tabular-nums leading-none mt-1 ${
                    data.ai.ensemble.unifiedProbUp >= 55 ? 'text-emerald-400'
                    : data.ai.ensemble.unifiedProbUp <= 45 ? 'text-red-400'
                    : 'text-slate-300'
                  }`}>
                    <LiveNumber value={data.ai.ensemble.unifiedProbUp} format={(n) => `${n.toFixed(1)}%`} />
                  </div>
                  <div className="text-[9px] text-slate-500 tracking-widest mt-0.5">CONF <span className="text-slate-300 tabular-nums"><LiveNumber value={data.ai.ensemble.confidence} format={(n) => `${n.toFixed(0)}%`} flash={false} /></span></div>
                  <div className="w-full mt-2 h-1.5 rounded-full bg-slate-700/40 overflow-hidden">
                    <div
                      className={`h-full transition-[width] duration-500 ease-out ${data.ai.ensemble.unifiedProbUp >= 50 ? 'bg-emerald-400' : 'bg-red-400'}`}
                      style={{ width: `${clampPct(data.ai.ensemble.unifiedProbUp)}%` }}
                    />
                  </div>
                </div>

                {/* Re-weighted 5-class distribution */}
                <div className="flex flex-col gap-1">
                  <div className="text-[8.5px] tracking-widest text-slate-400 font-bold mb-1">CALIBRATED CLASS DISTRIBUTION</div>
                  {(['STRONG_BUY', 'BUY', 'NEUTRAL', 'SELL', 'STRONG_SELL'] as const).map(cls => {
                    const v = data.ai!.ensemble!.classProbabilities[cls];
                    const color =
                      cls === 'STRONG_BUY' ? 'bg-emerald-500'
                      : cls === 'BUY' ? 'bg-emerald-400/70'
                      : cls === 'NEUTRAL' ? 'bg-slate-500'
                      : cls === 'SELL' ? 'bg-red-400/70'
                      : 'bg-red-500';
                    return (
                      <div key={cls} className="flex items-center gap-2 text-[10px]">
                        <span className="text-slate-400 w-[90px] tracking-wider shrink-0">{cls.replace('_', ' ')}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-slate-700/40 overflow-hidden min-w-[40px]">
                          <div className={`h-full ${color}`} style={{ width: `${clampPct(v)}%` }} />
                        </div>
                        <span className="text-slate-200 font-mono tabular-nums w-10 text-right">{v.toFixed(1)}%</span>
                      </div>
                    );
                  })}
                </div>

                {/* Last-N hit/miss trail */}
                <div className="flex flex-col">
                  <div className="text-[8.5px] tracking-widest text-slate-400 font-bold mb-1">RECENT OUTCOMES</div>
                  <div className="flex flex-wrap gap-0.5">
                    {data.ai.ensemble.trail.length === 0 && (
                      <span className="text-[10px] text-slate-500">awaiting first settle…</span>
                    )}
                    {data.ai.ensemble.trail.slice(-30).map((hit, i) => (
                      <span
                        key={i}
                        title={hit ? 'HIT' : 'MISS'}
                        className={`w-2.5 h-2.5 rounded-sm ${hit ? 'bg-emerald-400' : 'bg-red-400/70'}`}
                      />
                    ))}
                  </div>
                  <div className="text-[9px] text-slate-500 mt-1 tracking-widest">SIGNED SCORE <span className="text-slate-300 tabular-nums">{data.ai.ensemble.signedScore.toFixed(3)}</span></div>
                </div>
              </div>
            </Card>
          )}

          {/* Sequence Prediction */}
          <Card className="p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[9px] tracking-widest text-slate-400 font-bold">SEQUENCE PREDICTION</div>
              <span className="text-[8.5px] text-slate-500 tabular-nums"><LiveNumber value={(data.ai.sequencePrediction.horizonSec ?? 0) / 60} format={(n) => `${Math.round(n)}m`} flash={false} /></span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className={`text-[20px] font-bold tracking-wider ${
                data.ai.sequencePrediction.nextMove === 'UP' ? 'text-emerald-400'
                : data.ai.sequencePrediction.nextMove === 'DOWN' ? 'text-red-400'
                : 'text-slate-300'
              }`}>
                {data.ai.sequencePrediction.nextMove === 'UP' ? '▲ UP' : data.ai.sequencePrediction.nextMove === 'DOWN' ? '▼ DOWN' : '◆ FLAT'}
              </span>
              <span className="text-[12px] text-slate-300 font-mono tabular-nums">
                <LiveNumber value={data.ai.sequencePrediction.nextMovePts} format={(n) => `${n >= 0 ? '+' : ''}${n.toFixed(1)} pts`} />
              </span>
            </div>
            <div className="mt-2 flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-slate-400">CONTINUATION</span>
                <span className="text-emerald-400 font-bold tabular-nums"><LiveNumber value={data.ai.sequencePrediction.trendContinuationProb} format={(n) => `${n.toFixed(0)}%`} flash={false} /></span>
              </div>
              <div className="h-1 rounded-full bg-slate-700/40 overflow-hidden">
                <div className="h-full bg-emerald-400 transition-[width] duration-500 ease-out" style={{ width: `${clampPct(data.ai.sequencePrediction.trendContinuationProb)}%` }} />
              </div>
              <div className="flex items-center justify-between text-[10px] mt-0.5">
                <span className="text-slate-400">REVERSAL</span>
                <span className="text-red-400 font-bold tabular-nums"><LiveNumber value={data.ai.sequencePrediction.reversalProb} format={(n) => `${n.toFixed(0)}%`} flash={false} /></span>
              </div>
              <div className="h-1 rounded-full bg-slate-700/40 overflow-hidden">
                <div className="h-full bg-red-400 transition-[width] duration-500 ease-out" style={{ width: `${clampPct(data.ai.sequencePrediction.reversalProb)}%` }} />
              </div>
            </div>
          </Card>

          {/* Microstructure Risk */}
          <Card className="p-3">
            <div className="text-[9px] tracking-widest text-slate-400 font-bold mb-2">MICROSTRUCTURE</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <RiskBar label="LIQ DENSITY" value={data.ai.microstructure.liquidityDensity} />
              <RiskBar label="STRUCTURE"   value={data.ai.microstructure.structureDensity} />
              <RiskBar label="FAKE BREAK"  value={data.ai.microstructure.fakeBreakoutRisk} />
              <RiskBar label="STOP HUNT"   value={data.ai.microstructure.stopHuntRisk} />
            </div>
          </Card>

          {/* Multi-Timeframe Matrix */}
          <Card className="p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[9px] tracking-widest text-slate-400 font-bold">MULTI-TIMEFRAME</div>
              <span className="text-[8.5px] text-slate-500 tabular-nums">ALIGN <span className="text-slate-200"><LiveNumber value={data.ai.multiTimeframe.alignmentPct} format={(n) => `${n.toFixed(0)}%`} flash={false} /></span></span>
            </div>
            <div className="flex flex-col gap-1.5">
              <TrendPill tf="MICRO"  trend={data.ai.multiTimeframe.micro.trend}  momentum={data.ai.multiTimeframe.micro.momentum} />
              <TrendPill tf="MEDIUM" trend={data.ai.multiTimeframe.medium.trend} momentum={data.ai.multiTimeframe.medium.momentum} />
              <TrendPill tf="MACRO"  trend={data.ai.multiTimeframe.macro.trend}  momentum={data.ai.multiTimeframe.macro.momentum} />
            </div>
          </Card>

          {/* Institutional Confluence */}
          <Card className="p-3">
            <div className="text-[9px] tracking-widest text-slate-400 font-bold mb-2">INSTITUTIONAL CONFLUENCE</div>
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] text-slate-400">EXECUTION</span>
              <span className="text-[18px] font-bold tabular-nums text-emerald-400"><LiveNumber value={data.ai.institutionalConfluence.executionProbability} format={(n) => `${n.toFixed(0)}%`} /></span>
            </div>
            <div className="h-1 rounded-full bg-slate-700/40 overflow-hidden mb-2">
              <div className="h-full bg-emerald-400 transition-[width] duration-500 ease-out" style={{ width: `${clampPct(data.ai.institutionalConfluence.executionProbability)}%` }} />
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
              <div className="flex justify-between"><span className="text-slate-400">SMART $</span><span className="text-slate-200 font-bold tabular-nums"><LiveNumber value={data.ai.institutionalConfluence.smartMoneyAlignment} format={(n) => `${n.toFixed(0)}%`} flash={false} /></span></div>
              <div className="flex justify-between"><span className="text-slate-400">INST FLOW</span><span className="text-slate-200 font-bold tabular-nums"><LiveNumber value={data.ai.institutionalConfluence.institutionalFlow} format={(n) => `${n.toFixed(0)}%`} flash={false} /></span></div>
              <div className="flex justify-between"><span className="text-slate-400">RISK</span><span className="text-red-400 font-bold tabular-nums"><LiveNumber value={data.ai.institutionalConfluence.riskScore} format={(n) => `${n.toFixed(0)}`} flash={false} /></span></div>
              <div className="flex justify-between"><span className="text-slate-400">REWARD</span><span className="text-emerald-400 font-bold tabular-nums"><LiveNumber value={data.ai.institutionalConfluence.rewardScore} format={(n) => `${n.toFixed(0)}`} flash={false} /></span></div>
              <div className="flex justify-between col-span-2 border-t border-slate-700/40 pt-1 mt-0.5">
                <span className="text-slate-400 tracking-widest font-bold">R : R</span>
                <span className={`font-bold tabular-nums ${
                  data.ai.institutionalConfluence.riskRewardRatio >= 2 ? 'text-emerald-400'
                  : data.ai.institutionalConfluence.riskRewardRatio >= 1 ? 'text-amber-300'
                  : 'text-red-400'
                }`}>1 : <LiveNumber value={data.ai.institutionalConfluence.riskRewardRatio} format={(n) => n.toFixed(2)} flash={false} /></span>
              </div>
            </div>
          </Card>
        </section>
      )}

      {/* 4) LIQUIDITY SUMMARY + HEATMAP */}
      <section className="px-3 sm:px-5 grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-3">
        <Card className="p-3">
          <div className="text-[9px] tracking-widest text-slate-400 text-center font-bold border-b border-slate-700/40 pb-2 mb-2">
            LIQUIDITY SUMMARY
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <SummaryCell label="TOTAL LIQUIDITY" value={fmtBig(derived.totalLiq)} color="text-slate-100" />
            <SummaryCell label="BUY SIDE" value={fmtBig(derived.buyLiq)} sub={`(${derived.buyLiqPct.toFixed(0)}%)`} color="text-emerald-400" />
            <SummaryCell label="SELL SIDE" value={fmtBig(derived.sellLiq)} sub={`(${derived.sellLiqPct.toFixed(0)}%)`} color="text-red-400" />
            <SummaryCell
              label="NET LIQUIDITY"
              value={`${derived.netLiq >= 0 ? '+' : '-'}${fmtBig(Math.abs(derived.netLiq))}`}
              color={derived.netLiq >= 0 ? 'text-emerald-400' : 'text-red-400'}
            />
          </div>
        </Card>

        <Card className="p-3">
          <div className="text-[9px] tracking-widest text-slate-400 text-center font-bold border-b border-slate-700/40 pb-2 mb-2">
            LIQUIDITY HEATMAP
          </div>
          <div className="relative h-8 rounded-md overflow-hidden bg-gradient-to-r from-emerald-500 via-amber-500 to-red-500">
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-white/90 shadow-[0_0_8px_rgba(255,255,255,0.6)] transition-[left] duration-500 ease-out"
              style={{ left: `${derived.heatPos}%` }}
            />
            <div
              className="absolute -top-1 w-2.5 h-2.5 rotate-45 bg-white/90 -translate-x-1/2 transition-[left] duration-500 ease-out"
              style={{ left: `${derived.heatPos}%` }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-slate-400 mt-1.5 tracking-wider">
            <span className="text-emerald-400">BUY SIDE DOMINANT</span>
            <span className="text-red-400">SELL SIDE DOMINANT</span>
          </div>
        </Card>
      </section>

      {/* 5) CHART */}
      <section className="px-3 sm:px-5 pt-3 pb-3">
        <Card className="relative overflow-hidden">
          <div className="absolute top-3 left-3 z-10 bg-[#0a0e1a]/85 border border-slate-700/40 rounded-md p-2 text-[9px] text-slate-300 backdrop-blur-sm pointer-events-none hidden sm:block">
            <div className="text-slate-400 tracking-widest border-b border-slate-700/40 pb-1 mb-1">TIMEFRAME: {range}</div>
            <Stat k="HIGH" v={fmtPrice(derived.cdh)} />
            <Stat k="LOW" v={fmtPrice(derived.cdl)} />
            <Stat
              k="RANGE"
              v={`${(derived.cdh - derived.cdl).toFixed(2)} (${
                derived.cdl > 0 ? (((derived.cdh - derived.cdl) / derived.cdl) * 100).toFixed(2) : '0.00'
              }%)`}
            />
            <Stat k="VOLUME" v={fmtBig((data?.candles5m ?? []).slice(-20).reduce((a, c) => a + c.v, 0))} />
            <Stat
              k="AVG VOL"
              v={fmtBig(
                ((data?.candles5m ?? []).reduce((a, c) => a + c.v, 0) /
                  Math.max(1, (data?.candles5m ?? []).length)) * 20
              )}
            />
          </div>

          <div ref={chartContainerRef} className="h-[440px] sm:h-[520px] lg:h-[560px]">
            <SymbolChartCard
              data={data}
              name={label}
              liveSpot={liveSpot}
              forceChartHeight={chartH}
              fullPage
            />
          </div>
        </Card>
      </section>

      {/* 6) LEVELS TABLE + BUY/SELL DONUT */}
      <section className="px-3 sm:px-5 pb-3 grid grid-cols-1 lg:grid-cols-[1fr,300px] gap-2 sm:gap-3">
        <Card className="overflow-hidden">
          <table className="w-full text-[10px] hidden md:table">
            <thead>
              <tr className="text-slate-400 tracking-widest border-b border-slate-700/40">
                <th className="text-left px-3 py-2 font-bold">LEVEL</th>
                <th className="text-left px-2 py-2 font-bold">TYPE</th>
                <th className="text-left px-2 py-2 font-bold">PRICE RANGE</th>
                <th className="text-left px-2 py-2 font-bold">LIQUIDITY</th>
                <th className="text-left px-2 py-2 font-bold">SIDE</th>
                <th className="text-left px-2 py-2 font-bold">PROBABILITY</th>
                <th className="text-left px-2 py-2 font-bold">STATUS</th>
                <th className="text-left px-3 py-2 font-bold">REACTION</th>
              </tr>
            </thead>
            <tbody>
              {levelRows.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">No levels available</td></tr>
              )}
              {levelRows.map(r => (
                <tr key={r.key} className="border-b border-slate-800/60 last:border-b-0 hover:bg-slate-800/20">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${r.color}`} />
                      <span className="text-slate-200 font-bold tracking-wider">{r.label}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-slate-400 font-bold">{r.type}</td>
                  <td className="px-2 py-2 tabular-nums font-mono text-slate-300">{fmtRange(r.rangeLo, r.rangeHi)}</td>
                  <td className="px-2 py-2 tabular-nums font-mono text-slate-300">{fmtBig(r.liquidity)}</td>
                  <td className={`px-2 py-2 font-bold ${r.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>{r.side}</td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums text-slate-300 w-9"><LiveNumber value={r.probability} format={(n) => `${n.toFixed(0)}%`} flash={false} /></span>
                      <div className="flex-1 h-1.5 rounded-full bg-slate-700/40 overflow-hidden min-w-[60px]">
                        <div
                          className={`h-full transition-[width] duration-500 ease-out ${r.side === 'BUY' ? 'bg-emerald-400' : 'bg-red-400'}`}
                          style={{ width: `${r.probability}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className={`px-2 py-2 font-bold ${
                    r.status === 'STRONG' ? 'text-emerald-400'
                    : r.status === 'ACTIVE' ? 'text-amber-300'
                    : 'text-slate-500'
                  }`}>{r.status}</td>
                  <td className={`px-3 py-2 font-bold ${
                    r.reaction === 'STRONG HOLD' ? 'text-emerald-400'
                    : r.reaction === 'HOLDING' ? 'text-emerald-300'
                    : r.reaction === 'REJECTION' ? 'text-red-400'
                    : r.reaction === 'REACTION' ? 'text-amber-300'
                    : 'text-cyan-300'
                  }`}>{r.reaction}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-slate-800/60">
            {levelRows.length === 0 && (
              <div className="px-3 py-6 text-center text-slate-500 text-[11px]">No levels available</div>
            )}
            {levelRows.map(r => (
              <div key={r.key} className="px-3 py-2.5 text-[10px]">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${r.color}`} />
                    <span className="text-slate-200 font-bold tracking-wider">{r.label}</span>
                    <span className="text-slate-500">· {r.type}</span>
                  </div>
                  <span className={`font-bold ${r.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>{r.side}</span>
                </div>
                <div className="grid grid-cols-2 gap-1 text-slate-400">
                  <div>Range <span className="text-slate-300 font-mono tabular-nums">{fmtRange(r.rangeLo, r.rangeHi)}</span></div>
                  <div>Liq <span className="text-slate-300 font-mono tabular-nums">{fmtBig(r.liquidity)}</span></div>
                  <div>Prob <span className="text-slate-300 tabular-nums">{r.probability}%</span></div>
                  <div>Status <span className={`font-bold ${
                    r.status === 'STRONG' ? 'text-emerald-400'
                    : r.status === 'ACTIVE' ? 'text-amber-300'
                    : 'text-slate-500'
                  }`}>{r.status}</span></div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-3 flex flex-col gap-3">
          <div className="text-[9px] tracking-widest text-slate-400 font-bold text-center">BUY / SELL PROBABILITY</div>
          <div className="flex items-center justify-center">
            <Donut buy={derived.buyProb} sell={derived.sellProb} size={130} thickness={14} showLabels={false} />
            <div className="ml-3 flex flex-col gap-2 text-[11px]">
              <div>
                <div className="flex items-center gap-1.5 text-slate-400">
                  <span className="w-2.5 h-2.5 rounded-sm bg-emerald-400" />BUY
                </div>
                <div className="text-emerald-400 font-bold tabular-nums text-[16px]"><LiveNumber value={derived.buyProb} format={(n) => `${n.toFixed(0)}%`} /></div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-slate-400">
                  <span className="w-2.5 h-2.5 rounded-sm bg-red-400" />SELL
                </div>
                <div className="text-red-400 font-bold tabular-nums text-[16px]"><LiveNumber value={derived.sellProb} format={(n) => `${n.toFixed(0)}%`} /></div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-700/40 pt-2">
            <div className="text-[9px] tracking-widest text-slate-400 font-bold mb-2">LIQUIDITY DISTRIBUTION</div>
            <div className="flex flex-col gap-1.5 text-[10px]">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">BUY SIDE</span>
                <span className="text-emerald-400 tabular-nums font-bold"><LiveNumber value={derived.buyLiqPct} format={(n) => `${n.toFixed(0)}%`} flash={false} /></span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-700/40 overflow-hidden">
                <div className="h-full bg-emerald-400 transition-[width] duration-500 ease-out" style={{ width: `${derived.buyLiqPct}%` }} />
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-slate-400">SELL SIDE</span>
                <span className="text-red-400 tabular-nums font-bold"><LiveNumber value={derived.sellLiqPct} format={(n) => `${n.toFixed(0)}%`} flash={false} /></span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-700/40 overflow-hidden">
                <div className="h-full bg-red-400 transition-[width] duration-500 ease-out" style={{ width: `${derived.sellLiqPct}%` }} />
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* 7) RANGE FOOTER */}
      <section className="px-3 sm:px-5 pb-2">
        <Card className="px-3 py-1.5 flex items-center gap-2 overflow-x-auto no-scrollbar">
          {RANGES.map(r => {
            const active = range === r;
            return (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-2.5 py-1 rounded text-[10px] font-bold tracking-wider ${
                  active
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {r}
              </button>
            );
          })}
          <button className="text-slate-400 hover:text-slate-200 text-[12px] px-1">🗓</button>
          <span className="ml-auto text-[10px] text-slate-500 font-mono tabular-nums whitespace-nowrap">
            {data?.timestamp
              ? new Date(data.timestamp).toLocaleTimeString('en-IN', { hour12: false })
              : new Date().toLocaleTimeString('en-IN', { hour12: false })} (UTC+5:30)
          </span>
          <button className="text-[10px] text-slate-400 px-1">%</button>
          <button className="text-[10px] text-slate-400 px-1">log</button>
          <button className="text-[10px] text-emerald-300 px-1 font-bold">auto</button>
        </Card>
      </section>

      {/* 8) BOTTOM NAV */}
      <nav className="border-t border-slate-800/60 bg-[#070b14]/95 backdrop-blur sticky bottom-0 z-20">
        <div className="grid grid-cols-6 max-w-3xl mx-auto">
          {[
            { k: 'CHART', i: '📈', active: true },
            { k: 'ANALYSIS', i: '🎯' },
            { k: 'SCANNER', i: '🧭' },
            { k: 'WATCHLIST', i: '☆' },
            { k: 'ALERTS', i: '🔔' },
            { k: 'PROFILE', i: '👤' },
          ].map(n => (
            <button
              key={n.k}
              className={`flex flex-col items-center gap-0.5 py-2 text-[9px] tracking-widest font-bold ${
                n.active ? 'text-emerald-400' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <span className="text-[14px]">{n.i}</span>
              {n.k}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
