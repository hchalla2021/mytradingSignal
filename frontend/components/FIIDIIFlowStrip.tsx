'use client';

import React, { useMemo } from 'react';
import type { MarketTick } from '@/hooks/useMarketSocket';
import {
  useFIIDIIFlow,
  FIIDIIRow,
  FIIDIIHistoryPoint,
} from '@/hooks/useFIIDIIFlow';
import { aggregateIntel, updateBuyerIntel } from '@/lib/buyerIntelligence';
import { aggregateParticipantFlowRealtime, updateParticipantFlowRealtime } from '@/lib/participantFlowRealtime';
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

const toneOf = (netCr: number, eps = 250): Tone =>
  netCr > eps ? 'bull' : netCr < -eps ? 'bear' : 'neutral';

const labelOf = (netCr: number, eps = 250): string =>
  netCr > eps ? 'INFLOW' : netCr < -eps ? 'OUTFLOW' : 'NEUTRAL';

const signed = (v: number): string => `${v >= 0 ? '+' : '−'}₹${fmtCr(Math.abs(v))}`;
const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

const sideFromScore = (score: number): 'BUY' | 'SELL' | 'NEUTRAL' =>
  score > 10 ? 'BUY' : score < -10 ? 'SELL' : 'NEUTRAL';

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

const FIIDIIFlowStrip = ({ isConnected, marketData }: FIIDIIFlowStripProps) => {
  const { data, isLoading, error, refresh } = useFIIDIIFlow();

  const liveProxy = useMemo<LiveProxy>(() => {
    const serverRt = data?.realtime;
    const serverMs = serverRt?.generatedAt ? Date.parse(serverRt.generatedAt) : NaN;
    if (serverRt?.aggregate && Number.isFinite(serverMs)) {
      const tickAgeSec = Math.max(0, Math.floor((Date.now() - serverMs) / 1000));
      const quality: LiveProxy['quality'] =
        tickAgeSec <= LIVE_TICK_MEDIUM_AGE_SEC ? 'high' :
        tickAgeSec <= LIVE_TICK_MAX_AGE_SEC ? 'medium' : 'low';
      const active = tickAgeSec <= LIVE_TICK_MAX_AGE_SEC;
      return {
        active,
        hasTicks: true,
        tickAgeSec,
        quality,
        fiiScore: Number(serverRt.aggregate.fiiScore || 0),
        diiScore: Number(serverRt.aggregate.diiScore || 0),
        aggScore: Number(serverRt.aggregate.aggregateScore || 0),
        confidence: Number(serverRt.aggregate.confidence || 0),
        note: serverRt.aggregate.note || 'Live inferred from backend FII/DII AI engine.',
      };
    }

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
  }, [marketData, isConnected, data?.realtime]);

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
    const rawOfficialIn = view ? Math.max(0, view.fii.buy + view.dii.buy) : 0;
    const rawOfficialOut = view ? Math.max(0, view.fii.sell + view.dii.sell) : 0;
    const hasOnlyNetOfficial = !!view && rawOfficialIn === 0 && rawOfficialOut === 0 && Math.abs(view.netCr) > 0;

    // Moneycontrol can publish only net (buy/sell split missing). Build a symmetric
    // synthetic split so both inflow and outflow stay non-zero and net stays exact.
    const syntheticNet = view?.netCr ?? 0;
    const syntheticGross = Math.abs(syntheticNet) * 2;
    const syntheticIn = (syntheticGross + syntheticNet) / 2;
    const syntheticOut = (syntheticGross - syntheticNet) / 2;

    const fallbackOfficialIn = view
      ? (hasOnlyNetOfficial ? Math.max(0, syntheticIn) : rawOfficialIn)
      : 0;
    const fallbackOfficialOut = view
      ? (hasOnlyNetOfficial ? Math.max(0, syntheticOut) : rawOfficialOut)
      : 0;
    const fallbackOfficialNet = view ? view.netCr : 0;
    const fallbackInPerIndex = fallbackOfficialIn / symbols.length;
    const fallbackOutPerIndex = fallbackOfficialOut / symbols.length;
    const fallbackNetPerIndex = fallbackOfficialNet / symbols.length;
    const liveIndexBySymbol = new Map(
      symbols
        .map((k) => indexFlow[k])
        .filter((r): r is IndexMoneyFlow => !!r)
        .map((r) => [r.symbol, r]),
    );

    const indexRows = symbols.map((sym) => {
      const live = liveIndexBySymbol.get(sym);
      const shouldUseOfficialFallback =
        !!view && (!live || (!liveProxy.active && live.grossFlowCr <= 0.01));

      if (shouldUseOfficialFallback) {
        const fallbackIn = Number(fallbackInPerIndex.toFixed(2));
        const fallbackOut = Number(fallbackOutPerIndex.toFixed(2));
        const fallbackNet = Number(fallbackNetPerIndex.toFixed(2));
        return {
          name: sym,
          kind: 'index' as const,
          inflowCr: fallbackIn,
          outflowCr: fallbackOut,
          netCr: fallbackNet,
          totalCr: Number((fallbackIn + fallbackOut).toFixed(2)),
          bias: view ? (fallbackNet > 0 ? 'BUYERS' : fallbackNet < 0 ? 'SELLERS' : 'BALANCED') : 'WAITING',
          source: view ? 'official' : 'live',
        };
      }

      if (!live) {
        return {
          name: sym,
          kind: 'index' as const,
          inflowCr: 0,
          outflowCr: 0,
          netCr: 0,
          totalCr: 0,
          bias: 'WAITING',
          source: 'live',
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
        source: 'live',
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
  }, [indexFlow, participantRealtime, liveProxy.fiiScore, liveProxy.diiScore, liveProxy.active, view]);

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

  if (error && !view) {
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

  return (
    <section
      aria-label="FII DII Flow"
      className="mb-3 rounded-xl border border-violet-400/15 bg-gradient-to-br from-slate-950 via-slate-900/80 to-violet-950/10 px-3 py-3 sm:px-4"
    >
      {false && viewSafe && <div />}
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
                    <div className="flex items-center gap-1">
                      {row.source === 'official' && (
                        <span className="rounded border border-cyan-300/35 bg-cyan-500/10 px-1.5 py-0.5 text-[8px] font-black text-cyan-100">OFFICIAL</span>
                      )}
                      <span className={`rounded border px-1.5 py-0.5 text-[9px] font-black ${biasCls}`}>{row.bias}</span>
                    </div>
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
            {!liveProxy.active && viewSafe && (
              <span className="rounded border border-cyan-300/35 bg-cyan-500/10 px-1.5 py-0.5 text-cyan-100">
                LIVE TICKS DOWN · SHOWING OFFICIAL SNAPSHOT DISTRIBUTION
              </span>
            )}
          </div>
          <p className="hidden" aria-hidden="true">
            Index cards use live tick-derived flow when available and automatically apply weighted fallback allocation from participant totals when index feed depth is low.
          </p>
        </div>
      )}
      {false && participantRealtime && <div />}
    </section>
  );
};

export default React.memo(FIIDIIFlowStrip);
