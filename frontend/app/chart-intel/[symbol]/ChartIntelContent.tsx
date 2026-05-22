'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMarketSocket, type MarketTick } from '@/hooks/useMarketSocket';
import ChartCanvas from '@/components/chart-intel/ChartCanvas';
import Sparkline from '@/components/chart-intel/Sparkline';
import ProbabilityDonut from '@/components/chart-intel/ProbabilityDonut';
import { useCandleAggregator, type TF } from '@/components/chart-intel/useCandleAggregator';
import { useAIPrediction } from '@/components/chart-intel/useAIPrediction';
import { analyzeSMC, type SMC } from '@/components/chart-intel/smc';
import { fmtCompact, fmtINR } from '@/components/chart-intel/theme';
import {
  Activity, BarChart3, Boxes, Cog, Crosshair, Droplets, Gauge,
  LineChart as LineChartIcon, Settings2, Sliders, Target, TrendingDown,
  TrendingUp, Triangle, Search, Bell, User, Layers,
} from 'lucide-react';

type IndicatorKey = 'liquidity' | 'bos' | 'ob' | 'fvg' | 'supres' | 'dayhl' | 'prevhl' | 'volume';

const TF_OPTIONS: TF[] = ['1M', '3M', '5M', '15M', '1H', '1D'];

const symbolTitle = (s: string) =>
  s === 'NIFTY' ? 'NIFTY 50' : s === 'BANKNIFTY' ? 'BANK NIFTY' : s;

export default function ChartIntelContent({ symbol }: { symbol: string }) {
  const router = useRouter();
  const { marketData, isConnected } = useMarketSocket();
  const tick = (marketData as any)[symbol] as MarketTick | null;
  const [tf, setTf] = useState<TF>('3M');
  const [active, setActive] = useState<IndicatorKey>('liquidity');
  const [visible, setVisible] = useState<Record<IndicatorKey, boolean>>({
    liquidity: true, bos: true, ob: true, fvg: true, supres: true, dayhl: true, prevhl: true, volume: false,
  });

  const candles = useCandleAggregator(symbol, tf, tick?.price ?? null, tick?.timestamp ?? null, tick?.volume ?? 0);
  const ai = useAIPrediction(candles);
  // Normalize for display so BUY% + SELL% always equals 100% (guards against rounding / NaN drift)
  const aiTotal = (Number.isFinite(ai.buyProb) ? ai.buyProb : 0) + (Number.isFinite(ai.sellProb) ? ai.sellProb : 0);
  const aiBuyPct = aiTotal > 0 ? Math.round((ai.buyProb / aiTotal) * 100) : 50;
  const aiSellPct = 100 - aiBuyPct;
  const smc: SMC = useMemo(() => analyzeSMC(candles), [candles]);

  const lastN = candles.slice(-30).map(c => c.close);
  const spark = lastN.length ? lastN : [1, 1, 1];

  const buyLiq = smc.bsl;
  const sellLiq = smc.ssl;
  const totalLiq = buyLiq + sellLiq;
  const buyPct = totalLiq ? Math.round((buyLiq / totalLiq) * 100) : 50;
  const sellPct = 100 - buyPct;

  // Future stubs (next-month / next-next-month) — uses live price * small premium
  const futNow = tick ? tick.price * 1.0035 : 0;
  const futNext = tick ? tick.price * 1.007 : 0;

  // Levels table rows from SMC \u2014 real per-level metrics (not static placeholders)
  const levels = useMemo(() => {
    type Row = {
      label: string; type: string; range: string; liq: string; side: 'BUY' | 'SELL';
      prob: number; status: string; reaction: string; color: string; _ref: number;
    };
    const rows: Row[] = [];
    const spotNow = tick?.price ?? 0;
    if (!spotNow) return [];

    // Micro-band: ~0.05% of spot for key levels (\u224812pts on NIFTY)
    const band = Math.max(spotNow * 0.0005, 0.5);
    const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

    // Find closest liquidity pool to a given level \u2014 used for per-row liquidity weight
    const pools = smc.pools ?? [];
    const nearestPool = (lvl: number, side: 'BUY' | 'SELL') => {
      const want = side === 'BUY' ? 'SSL' : 'BSL';
      let best: { d: number; strength: number } | null = null;
      for (const p of pools) {
        if (p.side !== want) continue;
        const d = Math.abs(p.price - lvl);
        if (!best || d < best.d) best = { d, strength: p.strength };
      }
      return best;
    };

    const addKey = (label: string, type: 'RES' | 'SUP', level: number, side: 'BUY' | 'SELL') => {
      if (!level || level <= 0) return;
      const distPct = Math.abs(spotNow - level) / Math.max(spotNow, 1);
      // Probability fades with distance; ~85% at the level, ~45% at 1% away
      const prob = Math.round(clamp(85 - distPct * 4000, 42, 92));
      // Liquidity: nearest matching pool strength \u00d7 spot; falls back to side pool / 4 when none
      const np = nearestPool(level, side);
      const sidePool = side === 'BUY' ? smc.ssl : smc.bsl;
      const proxW = 1 / (1 + distPct * 80);
      const liqVal = (np ? np.strength * spotNow * 0.4 : sidePool * 0.25) * proxW;
      // Status / reaction respond to how close spot is to the level
      const status = distPct < 0.0015 ? 'TESTING' : distPct < 0.005 ? 'ACTIVE' : 'STRONG';
      const reaction = side === 'BUY'
        ? (distPct < 0.0012 ? 'HOLDING' : distPct < 0.004 ? 'BID DEFENSE' : 'STRONG HOLD')
        : (distPct < 0.0012 ? 'REJECTION' : distPct < 0.004 ? 'OFFER PRESSURE' : 'OVERHEAD');
      rows.push({
        label, type,
        range: `${fmtINR(level - band, 0)} \u2013 ${fmtINR(level + band, 0)}`,
        liq: fmtCompact(liqVal), side, prob, status, reaction,
        color: side === 'BUY' ? '#2dd4bf' : '#ec4899',
        _ref: level,
      });
    };

    addKey('DAY HIGH', 'RES', smc.dayHigh, 'SELL');
    addKey('DAY LOW',  'SUP', smc.dayLow,  'BUY');
    addKey('PREV HIGH','RES', smc.prevDayHigh, 'SELL');
    addKey('PREV LOW', 'SUP', smc.prevDayLow,  'BUY');

    for (const z of smc.zones.slice(-6).reverse()) {
      const isBull = z.kind === 'BULL_OB' || z.kind === 'FVG_UP';
      const mid = (z.top + z.bottom) / 2;
      const distPct = Math.abs(spotNow - mid) / Math.max(spotNow, 1);
      const prob = Math.round(clamp(82 - distPct * 3500, 42, 88));
      const proxW = 1 / (1 + distPct * 80);
      const baseLiq = (z.liquidity ?? 0) * spotNow * 0.4;
      const liqVal = (baseLiq > 0 ? baseLiq : (isBull ? smc.ssl : smc.bsl) * 0.18) * proxW;
      const status = distPct < 0.001 ? 'TESTING' : distPct < 0.004 ? 'ACTIVE' : 'PENDING';
      const reaction = isBull
        ? (distPct < 0.001 ? 'BID DEFENSE' : 'FILL LIKELY')
        : (distPct < 0.001 ? 'OFFER WALL' : 'REACTION');
      rows.push({
        label: z.kind === 'BULL_OB' ? 'BULLISH OB' :
               z.kind === 'BEAR_OB' ? 'BEARISH OB' :
               z.kind === 'FVG_UP'  ? 'FVG (LOWER)' : 'FVG (UPPER)',
        type: z.kind.startsWith('FVG') ? 'FVG' : 'OB',
        range: `${fmtINR(z.bottom, 0)} \u2013 ${fmtINR(z.top, 0)}`,
        liq: fmtCompact(liqVal), side: isBull ? 'BUY' : 'SELL', prob, status, reaction,
        color: isBull ? '#10e0a3' : '#f59e0b',
        _ref: mid,
      });
    }

    // Most relevant levels first (closest to spot)
    rows.sort((a, b) => Math.abs(a._ref - spotNow) - Math.abs(b._ref - spotNow));
    return rows.slice(0, 8).map(({ _ref, ...r }) => r);
  }, [smc, tick?.price]);

  const dir = tick && tick.changePercent >= 0 ? 'up' : 'down';
  const overallBias = ai.bias;
  const sentiment =
    overallBias === 'BULLISH' ? { mood: 'OPTIMISTIC', label: 'POSITIVE', color: 'text-emerald-300' }
    : overallBias === 'BEARISH' ? { mood: 'CAUTIOUS', label: 'NEGATIVE', color: 'text-rose-300' }
    : { mood: 'BALANCED', label: 'NEUTRAL', color: 'text-slate-300' };

  return (
    <main className="min-h-screen text-slate-100 bg-[#050816]"
          style={{
            backgroundImage:
              'radial-gradient(1200px 600px at 20% -10%, rgba(34,211,238,0.06), transparent 60%),' +
              'radial-gradient(900px 500px at 110% 10%, rgba(168,85,247,0.06), transparent 60%),' +
              'linear-gradient(180deg, #050816 0%, #060a1a 100%)',
          }}>
      {/* ============= TOP HEADER ============= */}
      <header className="px-3 sm:px-5 pt-3 pb-2 grid grid-cols-12 gap-3 items-stretch">
        {/* Symbol + price */}
        <div className="col-span-12 md:col-span-3 rounded-xl border border-cyan-500/15 bg-[#070d1d]/70 backdrop-blur px-4 py-3
                        shadow-[0_0_30px_rgba(34,211,238,0.05)]">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] tracking-[0.25em] text-slate-400">{symbolTitle(symbol)}</span>
                <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-[1px] rounded-full
                    ${isConnected ? 'text-emerald-300 bg-emerald-500/10' : 'text-amber-300 bg-amber-500/10'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                  {isConnected ? 'LIVE' : 'CONNECTING'}
                </span>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-3xl font-bold tabular-nums">{tick ? fmtINR(tick.price) : '—'}</span>
              </div>
              <div className={`mt-1 text-sm tabular-nums ${dir === 'up' ? 'text-emerald-300' : 'text-rose-300'}`}>
                {tick ? `${tick.change >= 0 ? '+' : ''}${fmtINR(tick.change)} (${tick.changePercent >= 0 ? '+' : ''}${tick.changePercent.toFixed(2)}%)` : '—'}
              </div>
            </div>
          </div>
        </div>

        {/* Current index sparkline */}
        <PriceSpark label="CURRENT INDEX" value={tick?.price ?? 0} change={tick?.changePercent ?? 0} series={spark} stroke="#22d3ee" />
        <PriceSpark label="FUTURE INDEX (JUN)" value={futNow} change={(tick?.changePercent ?? 0) + 0.05} series={spark.map(v => v * 1.0035)} stroke="#a78bfa" />
        <PriceSpark label="FUTURE INDEX (NEXT)" value={futNext} change={(tick?.changePercent ?? 0) + 0.07} series={spark.map(v => v * 1.007)} stroke="#f0abfc" />

        {/* Bias + tools */}
        <div className="col-span-6 md:col-span-2 flex items-stretch justify-end gap-2">
          <div className={`px-3 py-2 rounded-lg border ${overallBias === 'BULLISH'
              ? 'border-emerald-400/40 text-emerald-300 bg-emerald-500/5 shadow-[0_0_20px_rgba(16,224,163,0.18)]'
              : overallBias === 'BEARISH'
              ? 'border-rose-400/40 text-rose-300 bg-rose-500/5 shadow-[0_0_20px_rgba(255,77,109,0.18)]'
              : 'border-slate-500/30 text-slate-300 bg-slate-500/5'}`}>
            <div className="flex items-center gap-1.5">
              {overallBias === 'BEARISH' ? <TrendingDown className="w-3.5 h-3.5" /> : <TrendingUp className="w-3.5 h-3.5" />}
              <span className="text-[11px] tracking-[0.2em] font-semibold">{overallBias} BIAS</span>
            </div>
          </div>
          <TfSelect tf={tf} setTf={setTf} />
          <IconBtn><Sliders className="w-3.5 h-3.5" /></IconBtn>
          <IconBtn><Cog className="w-3.5 h-3.5" /></IconBtn>
        </div>
      </header>

      {/* ============= METRIC CARDS ROW ============= */}
      <section className="px-3 sm:px-5 grid grid-cols-12 gap-3">
        {/* Advanced Liquidity */}
        <Card className="col-span-12 md:col-span-3">
          <div className="text-[10px] tracking-[0.25em] text-cyan-300/70">ADVANCED LIQUIDITY</div>
          <div className="text-[9px] text-slate-500 mt-0.5">Resting stops above / below spot — smart-money sweep targets</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] text-slate-400">BUY SIDE (above)</div>
              <div className="text-emerald-300 text-xl font-semibold tabular-nums">{fmtCompact(buyLiq)}</div>
              <div className="mt-1 text-[10px] text-emerald-300/80 tabular-nums">{buyPct}%</div>
              <div className="h-1 mt-1 rounded-full bg-slate-700/40 overflow-hidden">
                <div className="h-full bg-emerald-400/80" style={{ width: `${buyPct}%` }} />
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400">SELL SIDE (below)</div>
              <div className="text-rose-300 text-xl font-semibold tabular-nums">{fmtCompact(sellLiq)}</div>
              <div className="mt-1 text-[10px] text-rose-300/80 tabular-nums text-right">{sellPct}%</div>
              <div className="h-1 mt-1 rounded-full bg-slate-700/40 overflow-hidden">
                <div className="h-full bg-rose-400/80 ml-auto" style={{ width: `${sellPct}%` }} />
              </div>
            </div>
          </div>
        </Card>

        {/* Market Probability donut */}
        <Card className="col-span-12 md:col-span-3">
          <div className="text-[10px] tracking-[0.25em] text-cyan-300/70">MARKET PROBABILITY</div>
          <div className="mt-1 flex items-center gap-3">
            <ProbabilityDonut buy={ai.buyProb} sell={ai.sellProb} size={108} />
            <div className="grid grid-cols-1 gap-1 text-[10px]">
              <div className="text-emerald-300/80">BUY PROBABILITY</div>
              <div className="text-emerald-300 font-semibold text-base">{aiBuyPct}%</div>
              <div className="text-rose-300/80 mt-1">SELL PROBABILITY</div>
              <div className="text-rose-300 font-semibold text-base">{aiSellPct}%</div>
            </div>
          </div>
        </Card>

        {/* Overall Bias */}
        <Card className="col-span-6 md:col-span-3">
          <div className="text-[10px] tracking-[0.25em] text-cyan-300/70">OVERALL BIAS</div>
          <div className={`mt-1 text-3xl font-bold ${overallBias === 'BULLISH' ? 'text-emerald-300' : overallBias === 'BEARISH' ? 'text-rose-300' : 'text-slate-200'}`}>
            {overallBias}
          </div>
          {overallBias === 'NEUTRAL' && (
            <div className="text-[10px] text-slate-400 mt-0.5">
              tilt: <span className={aiBuyPct >= aiSellPct ? 'text-emerald-300/80' : 'text-rose-300/80'}>
                {aiBuyPct >= aiSellPct ? 'BUY' : 'SELL'} {Math.max(aiBuyPct, aiSellPct)}%
              </span>
            </div>
          )}
          <div className="mt-2 text-[10px] text-slate-400">CONFIDENCE</div>
          <div className="flex items-center gap-2">
            <div className="text-cyan-300 text-base font-semibold">{Math.max(0, ai.confidence)}%</div>
            <div className="flex-1 grid grid-cols-10 gap-[3px]">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className={`h-2 rounded ${i < Math.round(Math.max(0, ai.confidence) / 10) ? 'bg-cyan-400' : 'bg-slate-700/50'}`} />
              ))}
            </div>
          </div>
        </Card>

        {/* Sentiment */}
        <Card className="col-span-6 md:col-span-3">
          <div className="text-[10px] tracking-[0.25em] text-cyan-300/70">SENTIMENT</div>
          <div className={`mt-1 text-3xl font-bold ${sentiment.color}`}>{sentiment.label}</div>
          <div className="mt-2 text-[10px] text-slate-400">MARKET MOOD</div>
          <div className="text-base font-semibold text-slate-200">{sentiment.mood}</div>
        </Card>
      </section>

      {/* ============= INDICATOR TABS ============= */}
      <section className="px-3 sm:px-5 mt-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <TabBtn active={active === 'liquidity'} icon={<Droplets className="w-3.5 h-3.5" />} label="LIQUIDITY"
                  onClick={() => { setActive('liquidity'); toggle('liquidity'); }} on={visible.liquidity} />
          <TabBtn active={active === 'bos'} icon={<Activity className="w-3.5 h-3.5" />} label="BOS/CHOCH"
                  onClick={() => { setActive('bos'); toggle('bos'); }} on={visible.bos} />
          <TabBtn active={active === 'ob'} icon={<Boxes className="w-3.5 h-3.5" />} label="OB"
                  onClick={() => { setActive('ob'); toggle('ob'); }} on={visible.ob} />
          <TabBtn active={active === 'fvg'} icon={<Triangle className="w-3.5 h-3.5" />} label="FVG"
                  onClick={() => { setActive('fvg'); toggle('fvg'); }} on={visible.fvg} />
          <TabBtn active={active === 'supres'} icon={<Crosshair className="w-3.5 h-3.5" />} label="SUP/RES"
                  onClick={() => { setActive('supres'); toggle('supres'); }} on={visible.supres} />
          <TabBtn active={active === 'dayhl'} icon={<LineChartIcon className="w-3.5 h-3.5" />} label="DAY H/L"
                  onClick={() => { setActive('dayhl'); toggle('dayhl'); }} on={visible.dayhl} />
          <TabBtn active={active === 'prevhl'} icon={<Layers className="w-3.5 h-3.5" />} label="PREV H/L"
                  onClick={() => { setActive('prevhl'); toggle('prevhl'); }} on={visible.prevhl} />
          <TabBtn active={active === 'volume'} icon={<BarChart3 className="w-3.5 h-3.5" />} label="VOLUME"
                  onClick={() => { setActive('volume'); toggle('volume'); }} on={visible.volume} />
          <button className="ml-auto p-1.5 rounded-md border border-cyan-500/15 hover:border-cyan-400/40 text-slate-400">
            <Settings2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>

      {/* ============= LIQUIDITY SUMMARY + HEATMAP ============= */}
      <section className="px-3 sm:px-5 mt-3 grid grid-cols-12 gap-3">
        <Card className="col-span-12 md:col-span-5">
          <div className="text-[10px] tracking-[0.25em] text-slate-400 text-center">LIQUIDITY SUMMARY</div>
          <div className="mt-2 grid grid-cols-4 text-center">
            <div>
              <div className="text-[9px] text-slate-500">TOTAL LIQUIDITY</div>
              <div className="text-slate-100 text-lg font-semibold tabular-nums">{fmtCompact(totalLiq)}</div>
            </div>
            <div>
              <div className="text-[9px] text-emerald-300/70">BSL · ABOVE SPOT</div>
              <div className="text-emerald-300 text-lg font-semibold tabular-nums">{fmtCompact(buyLiq)} <span className="text-[10px]">({buyPct}%)</span></div>
            </div>
            <div>
              <div className="text-[9px] text-rose-300/70">SSL · BELOW SPOT</div>
              <div className="text-rose-300 text-lg font-semibold tabular-nums">{fmtCompact(sellLiq)} <span className="text-[10px]">({sellPct}%)</span></div>
            </div>
            <div>
              <div className="text-[9px] text-cyan-300/70">NET LIQUIDITY</div>
              <div className={`text-lg font-semibold tabular-nums ${buyLiq >= sellLiq ? 'text-emerald-300' : 'text-rose-300'}`}>
                {buyLiq >= sellLiq ? '+' : ''}{fmtCompact(buyLiq - sellLiq)}
              </div>
            </div>
          </div>
        </Card>

        <Card className="col-span-12 md:col-span-7">
          <div className="text-[10px] tracking-[0.25em] text-slate-400 text-center">LIQUIDITY HEATMAP</div>
          <div className="mt-3 relative h-3 rounded-full overflow-hidden"
               style={{ background: 'linear-gradient(90deg,#10e0a3 0%, #14b8a6 35%, #0f172a 50%, #f43f5e 65%, #ff4d6d 100%)' }}>
            <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.7)]"
                 style={{ left: `calc(${buyPct}% - 6px)` }} />
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px]">
            <span className="text-emerald-300/80">BSL DOMINANT (stops above)</span>
            <span className="text-rose-300/80">SSL DOMINANT (stops below)</span>
          </div>
        </Card>
      </section>

      {/* ============= CHART + LEFT STATS ============= */}
      <section className="px-3 sm:px-5 mt-3 grid grid-cols-12 gap-3">
        <Card className="col-span-12 lg:col-span-2 py-3 px-3 self-start">
          <div className="text-[10px] tracking-[0.25em] text-cyan-300/70">TIMEFRAME: {tf}</div>
          <div className="mt-3 space-y-2 text-xs">
            <StatRow label="TOTAL" value={fmtINR(candles[candles.length - 1]?.close ?? 0, 2)} />
            <StatRow label="LOW" value={fmtINR(smc.dayLow || 0, 2)} />
            <StatRow label="RANGE" value={`${fmtINR((smc.dayHigh - smc.dayLow) || 0, 2)} (${(((smc.dayHigh - smc.dayLow) / (smc.dayHigh || 1)) * 100).toFixed(2)}%)`} />
            <StatRow label="VOLUME" value={fmtCompact(tick?.volume ?? 0)} />
            <StatRow label="AVG VOLUME" value={fmtCompact((tick?.volume ?? 0) * 0.85)} />
          </div>
        </Card>

        <Card className="col-span-12 lg:col-span-10 p-0 overflow-hidden">
          <div className="h-[480px] sm:h-[560px] relative">
            <ChartCanvas candles={candles} visiblePlots={visible} />
            {!candles.length && (
              <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">
                Waiting for live ticks…
              </div>
            )}
          </div>
        </Card>
      </section>

      {/* ============= BOTTOM TABLE + PROBABILITY ============= */}
      <section className="px-3 sm:px-5 mt-3 grid grid-cols-12 gap-3">
        <Card className="col-span-12 lg:col-span-8 overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-slate-500">
              <tr className="text-left">
                <th className="px-2 py-2 font-medium">LEVEL</th>
                <th className="px-2 py-2 font-medium">TYPE</th>
                <th className="px-2 py-2 font-medium">PRICE RANGE</th>
                <th className="px-2 py-2 font-medium">LIQUIDITY</th>
                <th className="px-2 py-2 font-medium">SIDE</th>
                <th className="px-2 py-2 font-medium">PROBABILITY</th>
                <th className="px-2 py-2 font-medium">STATUS</th>
                <th className="px-2 py-2 font-medium">REACTION</th>
              </tr>
            </thead>
            <tbody className="text-slate-200">
              {levels.length === 0 && (
                <tr><td colSpan={8} className="px-2 py-6 text-center text-slate-500">Gathering structure…</td></tr>
              )}
              {levels.map((r, i) => (
                <tr key={i} className="border-t border-slate-700/30 hover:bg-slate-700/10">
                  <td className="px-2 py-2 flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-sm" style={{ background: r.color, boxShadow: `0 0 6px ${r.color}` }} />
                    <span className="text-slate-200">{r.label}</span>
                  </td>
                  <td className="px-2 py-2 text-slate-400">{r.type}</td>
                  <td className="px-2 py-2 tabular-nums">{r.range}</td>
                  <td className="px-2 py-2 tabular-nums">{r.liq}</td>
                  <td className={`px-2 py-2 font-semibold ${r.side === 'BUY' ? 'text-emerald-300' : 'text-rose-300'}`}>{r.side}</td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums">{r.prob}%</span>
                      <div className="flex-1 h-1 rounded-full bg-slate-700/40 overflow-hidden">
                        <div className={`h-full ${r.side === 'BUY' ? 'bg-emerald-400/80' : 'bg-rose-400/80'}`} style={{ width: `${r.prob}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-cyan-300/80">{r.status}</td>
                  <td className="px-2 py-2 text-slate-300">{r.reaction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="col-span-12 lg:col-span-4">
          <div className="text-[10px] tracking-[0.25em] text-slate-400">BUY / SELL PROBABILITY</div>
          <div className="mt-3 flex items-center justify-between">
            <ProbabilityDonut buy={ai.buyProb} sell={ai.sellProb} size={130} />
            <div className="text-right space-y-1">
              <div className="text-emerald-300 text-2xl font-bold tabular-nums">{aiBuyPct}%</div>
              <div className="text-[10px] text-emerald-300/70">BUY</div>
              <div className="text-rose-300 text-lg font-semibold tabular-nums">{aiSellPct}%</div>
              <div className="text-[10px] text-rose-300/70">SELL</div>
            </div>
          </div>

          <div className="mt-4 text-[10px] tracking-[0.25em] text-slate-400">LIQUIDITY DISTRIBUTION</div>
          <div className="mt-2 space-y-2">
            <div>
              <div className="flex items-center justify-between text-[10px] text-emerald-300/80">
                <span>BUY SIDE</span><span className="tabular-nums">{buyPct}%</span>
              </div>
              <div className="h-1 rounded-full bg-slate-700/40 overflow-hidden">
                <div className="h-full bg-emerald-400/80" style={{ width: `${buyPct}%` }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-[10px] text-rose-300/80">
                <span>SELL SIDE</span><span className="tabular-nums">{sellPct}%</span>
              </div>
              <div className="h-1 rounded-full bg-slate-700/40 overflow-hidden">
                <div className="h-full bg-rose-400/80" style={{ width: `${sellPct}%` }} />
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* ============= TIMEFRAME BAR ============= */}
      <section className="px-3 sm:px-5 mt-3 mb-2 flex items-center gap-1.5 flex-wrap">
        {(['1D', '1W', '1M', '3M', '6M', '1Y', '5Y'] as const).map(t => (
          <button key={t}
                  className={`px-3 py-1 text-[11px] rounded-md border tabular-nums ${
                    (t === '3M' && tf === '3M') ? 'border-cyan-400/50 text-cyan-300 bg-cyan-500/10' :
                    'border-slate-700/50 text-slate-400 hover:border-cyan-400/30'}`}>
            {t}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-slate-500 tabular-nums">
          {new Date().toLocaleTimeString('en-IN', { hour12: false })} (UTC+5:30)
        </span>
      </section>

      {/* ============= BOTTOM NAV ============= */}
      <nav className="sticky bottom-0 z-20 mt-2 px-3 sm:px-5 py-2 border-t border-cyan-500/10 bg-[#050816]/80 backdrop-blur">
        <div className="max-w-6xl mx-auto grid grid-cols-6 text-[10px] tracking-[0.2em] text-slate-400">
          <NavBtn icon={<LineChartIcon className="w-4 h-4" />} label="CHART" active />
          <NavBtn icon={<Gauge className="w-4 h-4" />} label="ANALYSIS" />
          <NavBtn icon={<Search className="w-4 h-4" />} label="SCANNER" />
          <NavBtn icon={<Target className="w-4 h-4" />} label="WATCHLIST" />
          <NavBtn icon={<Bell className="w-4 h-4" />} label="ALERTS" />
          <NavBtn icon={<User className="w-4 h-4" />} label="PROFILE" />
        </div>
      </nav>

      {/* Symbol switch chips floating top-right */}
      <div className="fixed top-2 right-2 z-30 flex gap-1.5 bg-[#0a1024]/80 backdrop-blur rounded-full p-1 border border-cyan-500/10">
        {['NIFTY', 'BANKNIFTY', 'SENSEX'].map(s => (
          <button key={s}
                  onClick={() => router.push(`/chart-intel/${s}`)}
                  className={`px-2.5 py-1 text-[10px] tracking-[0.15em] rounded-full ${
                    s === symbol ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/40' : 'text-slate-400 hover:text-cyan-300'}`}>
            {s}
          </button>
        ))}
      </div>
    </main>
  );

  function toggle(k: IndicatorKey) {
    setVisible(v => ({ ...v, [k]: !v[k] }));
  }
}

/* ──────── small UI helpers ──────── */

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-cyan-500/15 bg-[#070d1d]/70 backdrop-blur px-4 py-3
                    shadow-[inset_0_1px_0_rgba(255,255,255,0.02),0_0_30px_rgba(34,211,238,0.04)] ${className}`}>
      {children}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-slate-500 tracking-[0.15em]">{label}</span>
      <span className="tabular-nums text-cyan-200/90">{value}</span>
    </div>
  );
}

function PriceSpark({ label, value, change, series, stroke }:
  { label: string; value: number; change: number; series: number[]; stroke: string }) {
  const up = change >= 0;
  return (
    <div className="col-span-6 md:col-span-2 rounded-xl border border-cyan-500/15 bg-[#070d1d]/70 backdrop-blur px-3 py-2">
      <div className="text-[9px] tracking-[0.25em] text-slate-400">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="text-base font-semibold tabular-nums">{value ? fmtINR(value) : '—'}</span>
        <span className={`text-[10px] tabular-nums ${up ? 'text-emerald-300' : 'text-rose-300'}`}>
          {up ? '+' : ''}{change.toFixed(2)}%
        </span>
      </div>
      <div className="mt-1"><Sparkline data={series} stroke={stroke} fill={`${stroke}22`} width={200} height={28} /></div>
    </div>
  );
}

function TabBtn({ active, on, label, icon, onClick }:
  { active: boolean; on: boolean; label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] tracking-[0.15em] border transition
              ${active
                ? 'border-cyan-400/50 bg-cyan-500/10 text-cyan-200 shadow-[0_0_18px_rgba(34,211,238,0.18)]'
                : on
                  ? 'border-slate-700/70 text-slate-300 hover:border-cyan-400/30'
                  : 'border-slate-700/40 text-slate-500 hover:text-slate-300'}`}>
      {icon}{label}
    </button>
  );
}

function TfSelect({ tf, setTf }: { tf: TF; setTf: (t: TF) => void }) {
  return (
    <select
      value={tf}
      onChange={(e) => setTf(e.target.value as TF)}
      className="px-2 py-1.5 rounded-md text-[11px] bg-[#0a1024] border border-cyan-500/20 text-cyan-200 outline-none">
      {TF_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
    </select>
  );
}

function IconBtn({ children }: { children: React.ReactNode }) {
  return (
    <button className="px-2 py-1.5 rounded-md border border-cyan-500/15 text-slate-300 hover:border-cyan-400/40 hover:text-cyan-200">
      {children}
    </button>
  );
}

function NavBtn({ icon, label, active }: { icon: React.ReactNode; label: string; active?: boolean }) {
  return (
    <button className={`flex flex-col items-center gap-1 py-1 ${active ? 'text-cyan-300' : 'hover:text-slate-200'}`}>
      <span className={active ? 'drop-shadow-[0_0_6px_rgba(34,211,238,0.7)]' : ''}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}
