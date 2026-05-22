'use client';

import React, { useMemo } from 'react';
import type { MarketTick } from '@/hooks/useMarketSocket';
import {
  useFIIDIIFlow,
  FIIDIIBias,
  FIIDIIRegime,
  FIIDIIRow,
  FIIDIIHistoryPoint,
} from '@/hooks/useFIIDIIFlow';

type IndexKey = 'NIFTY' | 'BANKNIFTY' | 'SENSEX';

interface FIIDIIFlowStripProps {
  // kept for API compatibility with page.tsx; real numbers come from NSE via the hook
  marketData?: Partial<Record<IndexKey, MarketTick | null | undefined>>;
  isConnected: boolean;
}

const fmtCr = (v: number): string => {
  const abs = Math.abs(v);
  if (abs >= 1000) return `${(v / 1000).toFixed(2)}K Cr`;
  return `${v.toFixed(0)} Cr`;
};

type Tone = 'bull' | 'bear' | 'neutral';

const TONE_MAP: Record<Tone, { border: string; text: string; bar: string; arrow: string; stroke: string }> = {
  bull:    { border: 'border-emerald-400/20', text: 'text-emerald-300', bar: 'from-emerald-400/80 to-emerald-500/80', arrow: '▲', stroke: '#34d399' },
  bear:    { border: 'border-rose-400/20',    text: 'text-rose-300',    bar: 'from-rose-400/80 to-rose-500/80',       arrow: '▼', stroke: '#fb7185' },
  neutral: { border: 'border-amber-400/15',   text: 'text-amber-300',   bar: 'from-amber-400/80 to-amber-500/80',     arrow: '◆', stroke: '#fbbf24' },
};

const BIAS_STYLE: Record<FIIDIIBias, { color: string; bg: string }> = {
  'bullish-domestic': { color: 'text-emerald-200', bg: 'bg-emerald-500/10 border-emerald-400/30' },
  'bullish-foreign':  { color: 'text-cyan-200',    bg: 'bg-cyan-500/10 border-cyan-400/30' },
  'bullish':          { color: 'text-emerald-200', bg: 'bg-emerald-500/10 border-emerald-400/30' },
  'bearish':          { color: 'text-rose-200',    bg: 'bg-rose-500/10 border-rose-400/30' },
  'neutral':          { color: 'text-amber-200',   bg: 'bg-amber-500/10 border-amber-400/30' },
};

const toneOf = (netCr: number, eps = 250): Tone =>
  netCr > eps ? 'bull' : netCr < -eps ? 'bear' : 'neutral';

const labelOf = (netCr: number, eps = 250): string =>
  netCr > eps ? 'INFLOW' : netCr < -eps ? 'OUTFLOW' : 'NEUTRAL';

const signed = (v: number): string => `${v >= 0 ? '+' : '−'}₹${fmtCr(Math.abs(v))}`;

const Sparkline = ({
  points, stroke, width = 84, height = 22,
}: { points: number[]; stroke: string; width?: number; height?: number; }) => {
  if (!points.length) return null;
  const min = Math.min(...points, 0);
  const max = Math.max(...points, 0);
  const range = max - min || 1;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const zeroY = height - ((0 - min) / range) * height;
  const path = points
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * height;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} className="overflow-visible">
      <line x1={0} x2={width} y1={zeroY} y2={zeroY} stroke="#475569" strokeDasharray="2 2" strokeWidth={0.5} />
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

const FlowTile = ({
  label, flowLabel, amountCr, buyCr, sellCr, grossCr, buySellRatio,
  tone, hint, strengthPct, cum5dCr, dayChangeCr, streakDays, streakTrend, spark,
}: {
  label: string;
  flowLabel: string;
  amountCr: number;
  buyCr: number;
  sellCr: number;
  grossCr?: number;
  buySellRatio?: number;
  tone: Tone;
  hint: string;
  strengthPct: number;
  cum5dCr?: number;
  dayChangeCr?: number;
  streakDays?: number;
  streakTrend?: 'accumulating' | 'distributing' | 'flat';
  spark?: number[];
}) => {
  const t = TONE_MAP[tone];
  const valueColor =
    amountCr > 0.5 ? 'text-emerald-300'
    : amountCr < -0.5 ? 'text-rose-300'
    : 'text-amber-300';
  const dodColor = (dayChangeCr ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400';
  const streakColor =
    streakTrend === 'accumulating' ? 'text-emerald-300'
    : streakTrend === 'distributing' ? 'text-rose-300'
    : 'text-slate-400';
  return (
    <div className={`relative rounded-lg border bg-slate-950/50 px-3 py-2 ${t.border}`}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
        <span className={`text-[11px] font-black ${t.text}`}>{t.arrow} {flowLabel}</span>
      </div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <p className={`font-mono text-lg font-black leading-tight lg:text-xl tabular-nums ${valueColor}`}>
          {signed(amountCr)}
        </p>
        {spark && spark.length > 1 && <Sparkline points={spark} stroke={t.stroke} />}
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800/70">
        <div className={`h-full rounded-full bg-gradient-to-r ${t.bar}`} style={{ width: `${Math.max(4, Math.min(100, strengthPct))}%` }} />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] font-semibold text-slate-500">
        <span>{hint}</span>
        <span className="font-mono text-slate-400">B {fmtCr(buyCr)} · S {fmtCr(sellCr)}</span>
      </div>
      {(grossCr !== undefined || dayChangeCr !== undefined || cum5dCr !== undefined || (streakDays && streakDays > 0)) && (
        <div className="mt-1 flex items-center justify-between gap-2 text-[9px] font-mono text-slate-500 flex-wrap">
          {grossCr !== undefined && (
            <span title="Gross turnover (Buy + Sell)">
              GROSS <span className="text-slate-300">₹{fmtCr(grossCr)}</span>
              {buySellRatio !== undefined && buySellRatio > 0 && (
                <span className="ml-1 text-slate-400">· B/S {buySellRatio.toFixed(2)}</span>
              )}
            </span>
          )}
          {dayChangeCr !== undefined && (
            <span title="Day-over-day change in net">
              DoD <span className={dodColor}>{signed(dayChangeCr)}</span>
            </span>
          )}
          {cum5dCr !== undefined && (
            <span title="5-day cumulative net">
              5D <span className={cum5dCr >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{signed(cum5dCr)}</span>
            </span>
          )}
          {streakDays && streakDays > 1 && (
            <span title="Consecutive same-direction trade days" className={streakColor}>
              {streakDays}d {streakTrend === 'accumulating' ? '▲ accum' : streakTrend === 'distributing' ? '▼ distr' : ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

const NetTile = ({
  netCr, regime, absorptionPct, netCum5dCr, grossTurnoverCr,
  dominanceSide, dominanceShare, spark,
}: {
  netCr: number;
  regime: FIIDIIRegime | null;
  absorptionPct?: number;
  netCum5dCr?: number;
  grossTurnoverCr?: number;
  dominanceSide?: 'FII' | 'DII' | 'NONE';
  dominanceShare?: number;
  spark?: number[];
}) => {
  const tone = toneOf(netCr, 100);
  const t = TONE_MAP[tone];
  const valueColor =
    netCr > 0.5 ? 'text-emerald-300'
    : netCr < -0.5 ? 'text-rose-300'
    : 'text-amber-300';
  const flowLabel = netCr > 100 ? 'NET BUY' : netCr < -100 ? 'NET SELL' : 'BALANCED';
  return (
    <div className={`relative rounded-lg border bg-slate-950/50 px-3 py-2 ${t.border}`}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Net Institutional</p>
        <span className={`text-[11px] font-black ${t.text}`}>{t.arrow} {flowLabel}</span>
      </div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <p className={`font-mono text-lg font-black leading-tight lg:text-xl tabular-nums ${valueColor}`}>
          {signed(netCr)}
        </p>
        {spark && spark.length > 1 && <Sparkline points={spark} stroke={t.stroke} />}
      </div>
      {regime && (
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${BIAS_STYLE[regime.bias].bg} ${BIAS_STYLE[regime.bias].color}`}>
            {regime.label.replace('_', ' ')}
          </span>
          <span className="text-[9px] text-slate-500 font-mono">conf {regime.confidence.toFixed(0)}%</span>
          {dominanceSide && dominanceSide !== 'NONE' && dominanceShare !== undefined && (
            <span className="text-[9px] text-slate-400 font-mono">
              · {dominanceSide} leads {(dominanceShare * 100).toFixed(0)}%
            </span>
          )}
        </div>
      )}
      <p className="mt-1 text-[10px] font-semibold text-slate-500">{regime?.note ?? 'FII + DII combined'}</p>
      <div className="mt-1 flex items-center justify-between gap-2 text-[9px] font-mono text-slate-500 flex-wrap">
        {absorptionPct !== undefined && absorptionPct > 0 && (
          <span title="How much of one side's outflow was absorbed by the other">
            ABSORB <span className="text-cyan-300">{absorptionPct.toFixed(0)}%</span>
          </span>
        )}
        {netCum5dCr !== undefined && (
          <span title="5-day cumulative net institutional flow">
            5D NET <span className={netCum5dCr >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{signed(netCum5dCr)}</span>
          </span>
        )}
        {grossTurnoverCr !== undefined && (
          <span title="Total institutional turnover (FII + DII gross)">
            TURNOVER <span className="text-slate-300">₹{fmtCr(grossTurnoverCr)}</span>
          </span>
        )}
      </div>
    </div>
  );
};

const FIIDIIFlowStrip = ({ isConnected }: FIIDIIFlowStripProps) => {
  const { data, isLoading, error, refresh } = useFIIDIIFlow();

  const view = useMemo(() => {
    if (!data || !data.success || !data.fii || !data.dii) return null;
    const fii = data.fii as FIIDIIRow;
    const dii = data.dii as FIIDIIRow;
    const norm = (v: number) => Math.min(100, Math.round((Math.abs(v) / 10000) * 100));
    const history: FIIDIIHistoryPoint[] = data.history ?? [];
    const fiiSpark = history.map((h) => h.fiiNetCr);
    const diiSpark = history.map((h) => h.diiNetCr);
    const netSpark = history.map((h) => h.netCr);
    return {
      fii: {
        amount: fii.netValueCr,
        buy: fii.buyValueCr,
        sell: fii.sellValueCr,
        gross: fii.grossTurnoverCr,
        ratio: fii.buySellRatio,
        label: labelOf(fii.netValueCr),
        tone: toneOf(fii.netValueCr),
        strength: norm(fii.netValueCr),
        cum5d: data.trend?.fiiCum5dCr,
        dod: data.trend?.fiiDayChangeCr,
        streak: data.trend?.fiiStreakDays,
        streakTrend: data.trend?.fiiTrend,
        spark: fiiSpark,
      },
      dii: {
        amount: dii.netValueCr,
        buy: dii.buyValueCr,
        sell: dii.sellValueCr,
        gross: dii.grossTurnoverCr,
        ratio: dii.buySellRatio,
        label: labelOf(dii.netValueCr),
        tone: toneOf(dii.netValueCr),
        strength: norm(dii.netValueCr),
        cum5d: data.trend?.diiCum5dCr,
        dod: data.trend?.diiDayChangeCr,
        streak: data.trend?.diiStreakDays,
        streakTrend: data.trend?.diiTrend,
        spark: diiSpark,
      },
      netCr: data.netInstitutionalCr ?? (fii.netValueCr + dii.netValueCr),
      grossTurnover: data.grossTurnoverCr,
      absorption: data.absorptionPct,
      dominanceSide: data.dominance?.side,
      dominanceShare: data.dominance?.shareOfNet,
      netCum5d: data.trend?.netCum5dCr,
      regime: data.regime,
      tradeDate: data.tradeDate ?? fii.date,
      fetchedAt: data.fetchedAt,
      netSpark,
    };
  }, [data]);

  if (isLoading && !view) {
    return (
      <section className="mb-3 rounded-xl border border-slate-700/40 bg-slate-950/60 px-3 py-2 text-xs font-semibold text-slate-400">
        FII / DII Flow · loading official NSE data…
      </section>
    );
  }

  if (error && !view) {
    return (
      <section className="mb-3 rounded-xl border border-rose-400/30 bg-slate-950/60 px-3 py-2 text-xs font-semibold text-rose-300 flex items-center justify-between gap-2">
        <span>FII / DII Flow · NSE fetch failed: {error}</span>
        <button
          onClick={refresh}
          className="rounded-md border border-rose-300/40 px-2 py-0.5 text-[11px] font-bold text-rose-200 hover:bg-rose-500/10"
        >
          Retry
        </button>
      </section>
    );
  }

  if (!view) return null;

  const fetchedDate = new Date(view.fetchedAt);
  const fetchedLabel = isNaN(fetchedDate.getTime())
    ? '—'
    : fetchedDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <section
      aria-label="FII DII Flow (NSE)"
      className="mb-3 rounded-xl border border-violet-400/15 bg-gradient-to-br from-slate-950 via-slate-900/80 to-violet-950/10 px-3 py-3 sm:px-4"
    >
      <div className="mb-2.5 flex items-center justify-between px-0.5 flex-wrap gap-1">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-lg font-black tracking-[0.22em] text-violet-300 lg:text-2xl">FII / DII FLOW</span>
          <span className="hidden text-sm font-semibold text-slate-400 sm:inline truncate">
            · Official NSE cash-segment · {view.tradeDate}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-slate-700 bg-slate-900/80 px-2 py-0.5 text-[10px] font-bold tracking-wider text-slate-300">
            NSE · {fetchedLabel}
          </span>
          <button
            onClick={refresh}
            title="Force refresh from NSE"
            className="rounded-full border border-slate-600 bg-slate-900/80 px-2 py-0.5 text-[10px] font-bold text-slate-300 hover:bg-slate-800"
          >
            ↻
          </button>
          <span className="flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-900/80 px-2.5 py-1 text-[11px] font-bold text-slate-300">
            <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
            {isConnected ? 'LIVE' : 'SYNC'}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <FlowTile
          label="FII / FPI Flow"
          flowLabel={view.fii.label}
          amountCr={view.fii.amount}
          buyCr={view.fii.buy}
          sellCr={view.fii.sell}
          grossCr={view.fii.gross}
          buySellRatio={view.fii.ratio}
          tone={view.fii.tone}
          strengthPct={view.fii.strength}
          hint="Foreign — official NSE net"
          cum5dCr={view.fii.cum5d}
          dayChangeCr={view.fii.dod}
          streakDays={view.fii.streak}
          streakTrend={view.fii.streakTrend}
          spark={view.fii.spark}
        />
        <FlowTile
          label="DII Flow"
          flowLabel={view.dii.label}
          amountCr={view.dii.amount}
          buyCr={view.dii.buy}
          sellCr={view.dii.sell}
          grossCr={view.dii.gross}
          buySellRatio={view.dii.ratio}
          tone={view.dii.tone}
          strengthPct={view.dii.strength}
          hint="Domestic — official NSE net"
          cum5dCr={view.dii.cum5d}
          dayChangeCr={view.dii.dod}
          streakDays={view.dii.streak}
          streakTrend={view.dii.streakTrend}
          spark={view.dii.spark}
        />
        <NetTile
          netCr={view.netCr}
          regime={view.regime}
          absorptionPct={view.absorption}
          netCum5dCr={view.netCum5d}
          grossTurnoverCr={view.grossTurnover}
          dominanceSide={view.dominanceSide}
          dominanceShare={view.dominanceShare}
          spark={view.netSpark}
        />
      </div>
    </section>
  );
};

export default React.memo(FIIDIIFlowStrip);
