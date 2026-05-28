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
import { aggregateIntel, updateBuyerIntel } from '@/lib/buyerIntelligence';
import { aggregateParticipantFlowRealtime, updateParticipantFlowRealtime, type ParticipantKey, type ParticipantPulse } from '@/lib/participantFlowRealtime';
import { updateIndexMoneyFlow, type IndexMoneyFlow } from '@/lib/indexMoneyFlowRealtime';

type IndexKey = 'NIFTY' | 'BANKNIFTY' | 'SENSEX';

interface FIIDIIFlowStripProps {
  // Reused for live inferred institutional pressure from websocket ticks.
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
const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
const signedPct = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`;

const sideFromScore = (score: number): 'BUY' | 'SELL' | 'NEUTRAL' =>
  score > 10 ? 'BUY' : score < -10 ? 'SELL' : 'NEUTRAL';

const liveLabel = (score: number): string =>
  score > 15 ? 'BUY PRESSURE' : score < -15 ? 'SELL PRESSURE' : 'BALANCED';

const participantLabel = (k: ParticipantKey): string => {
  if (k === 'FII') return 'FII / FPI';
  if (k === 'DII') return 'DII';
  if (k === 'CLIENT') return 'CLIENT';
  return 'PRO';
};

const actionLabel = (a: ParticipantPulse['action']): string => {
  if (a === 'LONG_BUILDUP') return 'Long Buildup';
  if (a === 'SHORT_BUILDUP') return 'Short Buildup';
  if (a === 'SHORT_COVERING') return 'Short Covering';
  if (a === 'LONG_UNWIND') return 'Long Unwind';
  return 'Neutral';
};

const toSigned100 = (z: number): number => clamp((z - 50) * 2, -100, 100);

interface LiveProxy {
  active: boolean;
  hasTicks: boolean;
  tickAgeSec: number;
  quality: 'high' | 'medium' | 'low';
  fiiScore: number;
  diiScore: number;
  aggScore: number;
  confidence: number;
  note: string;
}

const LIVE_TICK_MAX_AGE_SEC = 30;
const LIVE_TICK_MEDIUM_AGE_SEC = 10;

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
  tone, hint, strengthPct, cum5dCr, dayChangeCr, streakDays, streakTrend, spark, liveNote,
  primaryValueLabel, primaryValueText, secondaryValueText,
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
  liveNote?: string;
  primaryValueLabel?: string;
  primaryValueText?: string;
  secondaryValueText?: string;
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
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            {primaryValueLabel ?? 'OFFICIAL'}
          </p>
          <p className={`font-mono text-lg font-black leading-tight lg:text-xl tabular-nums ${valueColor}`}>
            {primaryValueText ?? signed(amountCr)}
          </p>
        </div>
        {spark && spark.length > 1 && <Sparkline points={spark} stroke={t.stroke} />}
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800/70">
        <div className={`h-full rounded-full bg-gradient-to-r ${t.bar}`} style={{ width: `${Math.max(4, Math.min(100, strengthPct))}%` }} />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] font-semibold text-slate-500">
        <span>{hint}</span>
        {(buyCr > 0 || sellCr > 0) && (
          <span className="font-mono text-slate-400">B {fmtCr(buyCr)} · S {fmtCr(sellCr)}</span>
        )}
      </div>
      {liveNote && (
        <p className="mt-1 text-[9px] font-semibold tracking-wide text-cyan-300/90">
          {liveNote}
        </p>
      )}
      {secondaryValueText && (
        <p className="mt-0.5 text-[9px] font-semibold text-slate-500">
          {secondaryValueText}
        </p>
      )}
      {((grossCr !== undefined && grossCr > 0) || dayChangeCr !== undefined || cum5dCr !== undefined || (streakDays && streakDays > 0)) && (
        <div className="mt-1 flex items-center justify-between gap-2 text-[9px] font-mono text-slate-500 flex-wrap">
          {grossCr !== undefined && grossCr > 0 && (
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
  dominanceSide, dominanceShare, spark, liveProxy,
  secondaryValueText,
}: {
  netCr: number;
  regime: FIIDIIRegime | null;
  absorptionPct?: number;
  netCum5dCr?: number;
  grossTurnoverCr?: number;
  dominanceSide?: 'FII' | 'DII' | 'NONE';
  dominanceShare?: number;
  spark?: number[];
  liveProxy?: LiveProxy;
  secondaryValueText?: string;
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
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">LIVE FLOW</p>
          <p className={`font-mono text-lg font-black leading-tight lg:text-xl tabular-nums ${valueColor}`}>
            {liveProxy?.active ? `${signedPct(liveProxy.aggScore)}` : signed(netCr)}
          </p>
        </div>
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
      {liveProxy?.active && (
        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
          <span className="rounded border border-cyan-400/30 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-bold text-cyan-200">
            LIVE ORDER FLOW
          </span>
          <span className="text-[9px] font-mono text-cyan-300">
            FII proxy {signedPct(liveProxy.fiiScore)}
          </span>
          <span className="text-[9px] font-mono text-emerald-300">
            DII proxy {signedPct(liveProxy.diiScore)}
          </span>
          <span className="text-[9px] font-mono text-slate-400">
            conf {liveProxy.confidence}%
          </span>
        </div>
      )}
      <p className="mt-1 text-[10px] font-semibold text-slate-500">{regime?.note ?? 'FII + DII combined'}</p>
      {secondaryValueText && (
        <p className="mt-0.5 text-[9px] font-semibold text-slate-500">{secondaryValueText}</p>
      )}
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
        {grossTurnoverCr !== undefined && grossTurnoverCr > 0 && (
          <span title="Total institutional turnover (FII + DII gross)">
            TURNOVER <span className="text-slate-300">₹{fmtCr(grossTurnoverCr)}</span>
          </span>
        )}
      </div>
    </div>
  );
};

const FIIDIIFlowStrip = ({ isConnected, marketData }: FIIDIIFlowStripProps) => {
  const { data, isLoading, error, refresh, secsSinceFetch } = useFIIDIIFlow();

  const liveProxy = useMemo<LiveProxy>(() => {
    const nifty = marketData?.NIFTY ?? null;
    const bank = marketData?.BANKNIFTY ?? null;
    const sensex = marketData?.SENSEX ?? null;

    const ticks = [nifty, bank, sensex].filter((t): t is MarketTick => !!t && !!t.price);
    if (!ticks.length) {
      return {
        active: false,
        hasTicks: false,
        tickAgeSec: 9999,
        quality: 'low',
        fiiScore: 0,
        diiScore: 0,
        aggScore: 0,
        confidence: 0,
        note: 'Waiting for market ticks',
      };
    }

    const intelByKey = {
      NIFTY: nifty ? updateBuyerIntel('NIFTY', nifty) : null,
      BANKNIFTY: bank ? updateBuyerIntel('BANKNIFTY', bank) : null,
      SENSEX: sensex ? updateBuyerIntel('SENSEX', sensex) : null,
    };
    const intelAll = Object.values(intelByKey).filter(
      (v): v is NonNullable<typeof v> => v !== null,
    );
    const agg = aggregateIntel(intelAll);

    const n = intelByKey.NIFTY ?? agg;
    const b = intelByKey.BANKNIFTY ?? agg;

    // FII proxy leans on index-futures style flow (NIFTY/BANKNIFTY + OI alignment).
    const fiiScore = clamp(
      0.34 * n.deltaFlow +
      0.24 * b.deltaFlow +
      0.22 * n.oiBuildup +
      0.15 * b.oiBuildup +
      0.05 * agg.marketPulse,
      -100,
      100,
    );

    // DII proxy leans on accumulation/absorption style behavior across cash indices.
    const diiScore = clamp(
      0.40 * toSigned100(agg.accumulation) +
      0.28 * toSigned100(agg.supportHold) +
      0.18 * toSigned100(agg.buyerPressure) -
      0.14 * fiiScore,
      -100,
      100,
    );

    const nowMs = Date.now();
    const tickTimes = ticks
      .map((t) => Date.parse(t.timestamp || ''))
      .filter((x) => Number.isFinite(x)) as number[];
    const lastTickMs = tickTimes.length ? Math.max(...tickTimes) : nowMs;
    const tickAgeSec = Math.max(0, Math.floor((nowMs - lastTickMs) / 1000));
    const quality: LiveProxy['quality'] =
      tickAgeSec <= LIVE_TICK_MEDIUM_AGE_SEC ? 'high' :
      tickAgeSec <= LIVE_TICK_MAX_AGE_SEC ? 'medium' : 'low';
    const active = isConnected && tickAgeSec <= LIVE_TICK_MAX_AGE_SEC;

    return {
      active,
      hasTicks: true,
      tickAgeSec,
      quality,
      fiiScore: Math.round(fiiScore),
      diiScore: Math.round(diiScore),
      aggScore: Math.round(agg.marketPulse),
      confidence: Math.round(clamp((agg.bullishProb + agg.instBuying) / 2, 10, 95)),
      note: active
        ? 'Live inferred from order-flow, OI momentum, and buyer pressure.'
        : 'Live proxy paused - waiting for fresh market ticks.',
    };
  }, [marketData, isConnected]);

  const participantRealtime = useMemo(() => {
    const snapshots = (['NIFTY', 'BANKNIFTY', 'SENSEX'] as const).map((sym) => {
      const tick = marketData?.[sym] ?? null;
      const intel = tick ? updateBuyerIntel(sym, tick) : null;
      return updateParticipantFlowRealtime(sym, tick, intel);
    });
    return aggregateParticipantFlowRealtime(snapshots);
  }, [marketData]);

  const indexFlow = useMemo(() => {
    return {
      NIFTY: updateIndexMoneyFlow('NIFTY', marketData?.NIFTY ?? null),
      BANKNIFTY: updateIndexMoneyFlow('BANKNIFTY', marketData?.BANKNIFTY ?? null),
      SENSEX: updateIndexMoneyFlow('SENSEX', marketData?.SENSEX ?? null),
    } as Record<IndexKey, IndexMoneyFlow | null>;
  }, [marketData]);

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

  const segregated = useMemo(() => {
    const symbols: IndexKey[] = ['NIFTY', 'BANKNIFTY', 'SENSEX'];
    const liveIndexBySymbol = new Map(
      symbols
        .map((k) => indexFlow[k])
        .filter((r): r is IndexMoneyFlow => !!r)
        .map((r) => [r.symbol, r]),
    );

    const indexRows = symbols.map((sym) => {
      const live = liveIndexBySymbol.get(sym);
      if (!live) {
        return {
          name: sym,
          kind: 'index' as const,
          inflowCr: 0,
          outflowCr: 0,
          netCr: 0,
          totalCr: 0,
          bias: 'WAITING',
        };
      }
      return {
        name: live.symbol,
        kind: 'index' as const,
        inflowCr: Number(live.inflowCr.toFixed(2)),
        outflowCr: Number(live.outflowCr.toFixed(2)),
        netCr: Number(live.netFlowCr.toFixed(2)),
        totalCr: Number(live.grossFlowCr.toFixed(2)),
        bias: live.flowBias,
      };
    });

    const indexTotalIn = indexRows.reduce((a, r) => a + r.inflowCr, 0);
    const indexTotalOut = indexRows.reduce((a, r) => a + r.outflowCr, 0);
    const indexTotalNet = indexTotalIn - indexTotalOut;
    const indexTotalGross = indexTotalIn + indexTotalOut;
    const liveRowCount = indexRows.filter((r) => r.totalCr > 0).length;
    const coverage = liveRowCount / symbols.length;

    const fiiScore = participantRealtime?.participants.FII.score ?? liveProxy.fiiScore;
    const diiScore = participantRealtime?.participants.DII.score ?? liveProxy.diiScore;
    const participantTotalNet = Number((indexTotalGross * ((fiiScore + diiScore) / 200)).toFixed(2));

    return {
      rows: indexRows,
      indexRows,
      participantRows: [],
      coverage,
      indexTotalIn,
      indexTotalOut,
      indexTotalNet,
      indexTotalGross,
      participantTotalIn: Number((indexTotalGross * 0.5).toFixed(2)),
      participantTotalOut: Number((indexTotalGross * 0.5).toFixed(2)),
      participantTotalNet,
      participantTotalGross: indexTotalGross,
      totalIn: indexTotalIn,
      totalOut: indexTotalOut,
      totalNet: indexTotalNet,
      totalGross: indexTotalGross,
    };
  }, [indexFlow, participantRealtime, liveProxy.fiiScore, liveProxy.diiScore]);

  const indexQuickCalls = useMemo(() => {
    if (!segregated) return [] as Array<{
      symbol: string;
      fiiSide: 'BUY' | 'SELL' | 'NEUTRAL';
      diiSide: 'BUY' | 'SELL' | 'NEUTRAL';
      fiiCr: number;
      diiCr: number;
    }>;

    const fiiScore = participantRealtime?.participants.FII.score ?? liveProxy.fiiScore;
    const diiScore = participantRealtime?.participants.DII.score ?? liveProxy.diiScore;

    return segregated.indexRows
      .map((r) => {
        const indexSigned = r.netCr > 0 ? 100 : r.netCr < 0 ? -100 : 0;
        const fiiLocal = clamp(0.65 * fiiScore + 0.35 * indexSigned, -100, 100);
        const diiLocal = clamp(0.65 * diiScore + 0.35 * indexSigned, -100, 100);
        const fiiMag = clamp(Math.abs(fiiLocal) / 100, 0.18, 0.95);
        const diiMag = clamp(Math.abs(diiLocal) / 100, 0.18, 0.95);
        return {
          symbol: r.name,
          fiiSide: sideFromScore(fiiLocal),
          diiSide: sideFromScore(diiLocal),
          fiiCr: Number((r.totalCr * fiiMag).toFixed(0)),
          diiCr: Number((r.totalCr * diiMag).toFixed(0)),
        };
      });
  }, [segregated, participantRealtime, liveProxy.fiiScore, liveProxy.diiScore]);

  if (isLoading && !view && !segregated) {
    return (
      <section className="mb-3 rounded-xl border border-slate-700/40 bg-slate-950/60 px-3 py-2 text-xs font-semibold text-slate-400">
        FII / DII Flow · loading institutional flow data…
      </section>
    );
  }

  if (error && !view && !segregated) {
    return (
      <section className="mb-3 rounded-xl border border-rose-400/30 bg-slate-950/60 px-3 py-2 text-xs font-semibold text-rose-300 flex items-center justify-between gap-2">
        <span>FII / DII Flow · fetch failed: {error}</span>
        <button
          onClick={refresh}
          className="rounded-md border border-rose-300/40 px-2 py-0.5 text-[11px] font-bold text-rose-200 hover:bg-rose-500/10"
        >
          Retry
        </button>
      </section>
    );
  }

  const viewSafe = view;

  const liveOfficialFii = liveProxy.active && viewSafe ? `Official FII snapshot ${signed(viewSafe.fii.amount)}` : undefined;
  const liveOfficialDii = liveProxy.active && viewSafe ? `Official DII snapshot ${signed(viewSafe.dii.amount)}` : undefined;
  const liveOfficialNet = liveProxy.active && viewSafe ? `Official daily net ${signed(viewSafe.netCr)}` : undefined;

  const fetchedDate = new Date(viewSafe?.fetchedAt ?? '');
  const fetchedLabel = isNaN(fetchedDate.getTime())
    ? '—'
    : fetchedDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

  // Live freshness UX: “AS OF HH:MM · +Ns ago · next in Xs”, color-coded by staleness.
  const ageSec = Math.max(0, secsSinceFetch ?? 0);
  const recPollSec = data?.recommendedPollSec ?? 300;
  const nextInSec = Math.max(0, recPollSec - ageSec);
  const ageText = ageSec < 60 ? `${ageSec}s ago` : ageSec < 3600 ? `${Math.floor(ageSec / 60)}m ago` : `${Math.floor(ageSec / 3600)}h ago`;
  const nextText = nextInSec < 60 ? `${nextInSec}s` : `${Math.floor(nextInSec / 60)}m`;
  const staleness = data?.staleness ?? (ageSec <= recPollSec ? 'fresh' : ageSec <= recPollSec * 2 ? 'recent' : 'stale');
  const stalenessCls =
    staleness === 'fresh'  ? 'border-emerald-400/40 text-emerald-200 bg-emerald-500/10'
    : staleness === 'recent' ? 'border-amber-400/40 text-amber-200 bg-amber-500/10'
    : 'border-slate-600 text-slate-400 bg-slate-900/80';

  return (
    <section
      aria-label="FII DII Flow"
      className="mb-3 rounded-xl border border-violet-400/15 bg-gradient-to-br from-slate-950 via-slate-900/80 to-violet-950/10 px-3 py-3 sm:px-4"
    >
      {viewSafe && (
      <div className="hidden" aria-hidden="true">
      <div className="mb-2.5 flex items-center justify-between px-0.5 flex-wrap gap-1">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-[14px] sm:text-[18px] lg:text-[22px] font-extrabold tracking-tight text-violet-300">LIVE INSTITUTIONAL FLOW</span>
          <span className="hidden text-sm font-semibold text-slate-400 sm:inline truncate">
            · live proxy + official snapshot · {viewSafe.tradeDate}
          </span>
          {liveProxy.active && (
            <span className="hidden text-xs font-semibold text-cyan-300/90 lg:inline truncate">
              · live proxy {liveProxy.tickAgeSec}s tick age · {liveProxy.note}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wider tabular-nums ${stalenessCls}`}
            title={`${data?.source ?? 'MC'} — fetched ${fetchedLabel} IST · ${ageText} · next refresh in ${nextText}`}
          >
            {(data?.source ?? 'MC')} · AS OF {fetchedLabel} · {ageText} · next {nextText}
          </span>
          <button
            onClick={refresh}
            title="Force refresh"
            className="rounded-full border border-slate-600 bg-slate-900/80 px-2 py-0.5 text-[10px] font-bold text-slate-300 hover:bg-slate-800"
          >
            ↻
          </button>
          <span
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${isConnected ? 'border-sky-400/40 bg-sky-500/10 text-sky-200' : 'border-slate-600 bg-slate-900/80 text-slate-300'}`}
            title="Official daily cash-flow snapshot source"
          >
            <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-sky-400' : 'bg-slate-500'}`} />
            OFFICIAL SNAPSHOT
          </span>
          {liveProxy.active && (
            <span
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${
                liveProxy.quality === 'high'
                  ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
                  : liveProxy.quality === 'medium'
                    ? 'border-amber-400/40 bg-amber-500/10 text-amber-200'
                    : 'border-slate-600 bg-slate-900/80 text-slate-300'
              }`}
              title="Live inferred stream quality from websocket tick freshness"
            >
              LIVE {liveProxy.tickAgeSec}s
            </span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <FlowTile
          label="FII / FPI LIVE"
          flowLabel={liveProxy.active ? liveLabel(liveProxy.fiiScore) : viewSafe.fii.label}
          amountCr={viewSafe.fii.amount}
          buyCr={viewSafe.fii.buy}
          sellCr={viewSafe.fii.sell}
          grossCr={viewSafe.fii.gross}
          buySellRatio={viewSafe.fii.ratio}
          tone={liveProxy.active ? toneOf(liveProxy.fiiScore, 20) : viewSafe.fii.tone}
          strengthPct={viewSafe.fii.strength}
          hint="Foreign — live inferred pressure"
          liveNote={liveProxy.active ? `LIVE proxy ${liveLabel(liveProxy.fiiScore)} (${signedPct(liveProxy.fiiScore)})` : undefined}
          primaryValueLabel={liveProxy.active ? 'LIVE SCORE' : 'OFFICIAL NET'}
          primaryValueText={liveProxy.active ? signedPct(liveProxy.fiiScore) : signed(viewSafe.fii.amount)}
          secondaryValueText={liveOfficialFii}
          cum5dCr={viewSafe.fii.cum5d}
          dayChangeCr={viewSafe.fii.dod}
          streakDays={viewSafe.fii.streak}
          streakTrend={viewSafe.fii.streakTrend}
          spark={viewSafe.fii.spark}
        />
        <FlowTile
          label="DII LIVE"
          flowLabel={liveProxy.active ? liveLabel(liveProxy.diiScore) : viewSafe.dii.label}
          amountCr={viewSafe.dii.amount}
          buyCr={viewSafe.dii.buy}
          sellCr={viewSafe.dii.sell}
          grossCr={viewSafe.dii.gross}
          buySellRatio={viewSafe.dii.ratio}
          tone={liveProxy.active ? toneOf(liveProxy.diiScore, 20) : viewSafe.dii.tone}
          strengthPct={viewSafe.dii.strength}
          hint="Domestic — live inferred pressure"
          liveNote={liveProxy.active ? `LIVE proxy ${liveLabel(liveProxy.diiScore)} (${signedPct(liveProxy.diiScore)})` : undefined}
          primaryValueLabel={liveProxy.active ? 'LIVE SCORE' : 'OFFICIAL NET'}
          primaryValueText={liveProxy.active ? signedPct(liveProxy.diiScore) : signed(viewSafe.dii.amount)}
          secondaryValueText={liveOfficialDii}
          cum5dCr={viewSafe.dii.cum5d}
          dayChangeCr={viewSafe.dii.dod}
          streakDays={viewSafe.dii.streak}
          streakTrend={viewSafe.dii.streakTrend}
          spark={viewSafe.dii.spark}
        />
        <NetTile
          netCr={viewSafe.netCr}
          regime={viewSafe.regime}
          absorptionPct={viewSafe.absorption}
          netCum5dCr={viewSafe.netCum5d}
          grossTurnoverCr={viewSafe.grossTurnover}
          dominanceSide={viewSafe.dominanceSide}
          dominanceShare={viewSafe.dominanceShare}
          spark={viewSafe.netSpark}
          liveProxy={liveProxy}
          secondaryValueText={liveOfficialNet}
        />
      </div>
      </div>
      )}
      {segregated && (
        <div className="mt-2 rounded-xl border border-emerald-400/25 bg-gradient-to-br from-emerald-500/10 via-slate-950/80 to-cyan-500/10 px-3 py-3 shadow-[0_0_0_1px_rgba(16,185,129,0.08),0_16px_34px_-22px_rgba(16,185,129,0.5)]">
          <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[14px] sm:text-[18px] lg:text-[22px] font-extrabold tracking-tight text-emerald-100">FII/DII FLOW</span>
            <span className="rounded-full border border-slate-600/70 bg-slate-900/75 px-2 py-1 text-[10px] font-bold text-slate-300">
              INSTITUTIONAL FLOW MATRIX · NIFTY · BANKNIFTY · SENSEX
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-3">
            {indexQuickCalls.map((c) => {
              const row = segregated.indexRows.find((r) => r.name === c.symbol);
              if (!row) return null;
              const netCls = row.netCr > 0 ? 'text-emerald-300' : row.netCr < 0 ? 'text-rose-300' : 'text-amber-300';
              const biasCls =
                row.bias === 'BUYERS'
                  ? 'text-emerald-200 border-emerald-400/35 bg-emerald-500/10'
                  : row.bias === 'SELLERS'
                    ? 'text-rose-200 border-rose-400/35 bg-rose-500/10'
                    : row.bias === 'WAITING'
                      ? 'text-slate-300 border-slate-500/40 bg-slate-800/50'
                      : 'text-amber-200 border-amber-400/35 bg-amber-500/10';
              const fiiCls = c.fiiSide === 'BUY' ? 'text-emerald-300' : c.fiiSide === 'SELL' ? 'text-rose-300' : 'text-amber-300';
              const diiCls = c.diiSide === 'BUY' ? 'text-emerald-300' : c.diiSide === 'SELL' ? 'text-rose-300' : 'text-amber-300';
              const indexAccent =
                c.symbol === 'NIFTY'
                  ? 'border-cyan-400/30 shadow-cyan-500/20'
                  : c.symbol === 'BANKNIFTY'
                    ? 'border-fuchsia-400/30 shadow-fuchsia-500/20'
                    : 'border-amber-400/30 shadow-amber-500/20';
              return (
                <div key={c.symbol} className={`rounded-lg border bg-slate-950/80 p-2.5 shadow-lg ${indexAccent}`}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-base font-black tracking-wide text-slate-100 lg:text-lg">{c.symbol}</span>
                    <span className={`rounded border px-1.5 py-0.5 text-[9px] font-black ${biasCls}`}>{row.bias}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono lg:text-[11px]">
                    <div className="rounded border border-emerald-400/20 bg-emerald-500/10 px-2 py-1.5">
                      <div className="text-slate-300">INFLOW</div>
                      <div className="text-emerald-300 font-black text-sm lg:text-base">+₹{fmtCr(row.inflowCr)}</div>
                    </div>
                    <div className="rounded border border-rose-400/20 bg-rose-500/10 px-2 py-1.5">
                      <div className="text-slate-300">OUTFLOW</div>
                      <div className="text-rose-300 font-black text-sm lg:text-base">-₹{fmtCr(row.outflowCr)}</div>
                    </div>
                    <div className="rounded border border-slate-700/70 bg-slate-900/80 px-2 py-1.5">
                      <div className="text-slate-300">NET</div>
                      <div className={`font-black text-sm lg:text-base ${netCls}`}>{signed(row.netCr)}</div>
                    </div>
                    <div className="rounded border border-slate-700/70 bg-slate-900/80 px-2 py-1.5">
                      <div className="text-slate-300">TOTAL</div>
                      <div className="text-slate-100 font-black text-sm lg:text-base">₹{fmtCr(row.totalCr)}</div>
                    </div>
                  </div>
                  <div className="mt-2 rounded border border-violet-400/25 bg-violet-500/10 px-2 py-1.5 text-[10px] font-semibold lg:text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className={fiiCls}>FII - {c.fiiSide}</span>
                      <span className="font-mono text-slate-100">₹{fmtCr(c.fiiCr)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <span className={diiCls}>DII - {c.diiSide}</span>
                      <span className="font-mono text-slate-100">₹{fmtCr(c.diiCr)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10px] font-mono lg:grid-cols-4 lg:text-[11px]">
            <div className="rounded border border-emerald-400/30 bg-emerald-500/10 px-2 py-1.5 text-emerald-100">TOTAL IN: +₹{fmtCr(segregated.indexTotalIn)}</div>
            <div className="rounded border border-rose-400/30 bg-rose-500/10 px-2 py-1.5 text-rose-100">TOTAL OUT: -₹{fmtCr(segregated.indexTotalOut)}</div>
            <div className={`rounded border px-2 py-1.5 ${segregated.indexTotalNet >= 0 ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100' : 'border-rose-400/30 bg-rose-500/10 text-rose-100'}`}>
              TOTAL NET: {signed(segregated.indexTotalNet)}
            </div>
            <div className="rounded border border-slate-600/80 bg-slate-900/80 px-2 py-1.5 text-slate-100">TOTAL FLOW: ₹{fmtCr(segregated.indexTotalGross)}</div>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[9px] lg:text-[10px]">
            <span className="rounded border border-cyan-400/20 bg-cyan-500/10 px-1.5 py-0.5 text-cyan-100">
              INDEX COVERAGE {(segregated.coverage * 100).toFixed(0)}%
            </span>
            <span className="rounded border border-slate-600/70 bg-slate-900/80 px-1.5 py-0.5 text-slate-300">
              PARTICIPANT TOTAL NET {signed(segregated.participantTotalNet)}
            </span>
            <span className="rounded border border-slate-600/70 bg-slate-900/80 px-1.5 py-0.5 text-slate-300">
              PARTICIPANT FLOW ₹{fmtCr(segregated.participantTotalGross)}
            </span>
          </div>
          <p className="hidden" aria-hidden="true">
            Index cards use live tick-derived flow when available and automatically apply weighted fallback allocation from participant totals when index feed depth is low.
          </p>
        </div>
      )}
      {participantRealtime && (
        <div className="mt-2 rounded-lg border border-violet-400/20 bg-violet-500/5 px-2.5 py-2">
          <div className="mb-1.5 flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[10px] font-black tracking-wider text-violet-200">REAL-TIME PARTICIPANT ENGINE</span>
            <span className={`text-[9px] font-semibold ${participantRealtime.heavyActivity ? 'text-rose-300' : 'text-slate-400'}`}>
              {participantRealtime.heavyActivity ? 'HEAVY POSITION SHIFT DETECTED' : 'Monitoring participant positioning'}
            </span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5">
            {(Object.keys(participantRealtime.participants) as ParticipantKey[]).map((k) => {
              const p = participantRealtime.participants[k];
              const tone = p.score > 12 ? 'text-emerald-300 border-emerald-400/30 bg-emerald-500/8' : p.score < -12 ? 'text-rose-300 border-rose-400/30 bg-rose-500/8' : 'text-amber-300 border-amber-400/30 bg-amber-500/8';
              return (
                <div key={k} className={`rounded-md border px-2 py-1.5 ${tone}`}>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[9px] font-bold tracking-wide uppercase">{participantLabel(k)}</span>
                    <span className="text-[9px] font-mono">{signedPct(p.score)}</span>
                  </div>
                  <div className="mt-1 text-[10px] font-semibold">{actionLabel(p.action)}</div>
                  <div className="mt-1 flex items-center justify-between text-[8px] text-slate-300/90">
                    <span>conf {p.confidence}%</span>
                    <span>{p.entering ? 'ENTER' : p.exiting ? 'EXIT' : p.unusual ? 'SPIKE' : 'LIVE'}</span>
                  </div>
                </div>
              );
            })}
          </div>
          {participantRealtime.alerts.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {participantRealtime.alerts.slice(0, 4).map((a, i) => (
                <span key={`${a}-${i}`} className="rounded border border-violet-300/25 bg-slate-900/60 px-1.5 py-0.5 text-[9px] font-semibold text-violet-100">
                  {a}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {false && liveProxy.active && (
        <div className="mt-2 rounded-lg border border-cyan-400/15 bg-cyan-500/5 px-2.5 py-1.5 text-[10px] font-semibold text-cyan-100/90">
          Live deep-check engine: websocket ticks to incremental buyer-intel to FII/DII inferred pressure.
          Official daily net is now secondary reference only.
        </div>
      )}
    </section>
  );
};

export default React.memo(FIIDIIFlowStrip);
