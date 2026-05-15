'use client';

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useGlobalIndicesSocket } from '@/hooks/useGlobalIndicesSocket';

const GLOBAL_RISK_ITEMS = [
  { key: 'DJI', alias: 'DOW', label: 'Dow' },
  { key: 'IXIC', alias: 'NASDAQ', label: 'Nasdaq' },
  { key: 'SPX', alias: 'SPX', label: 'S&P' },
  { key: 'DAX', alias: 'DAX', label: 'DAX' },
  { key: 'FTSE', alias: 'FTSE', label: 'LSE FTSE 100' },
  { key: 'FTMC', alias: 'FTMC', label: 'LSE FTSE 250' },
  { key: 'NIKKEI', alias: 'NIKKEI', label: 'Nikkei' },
] as const;

const INDEX_WEIGHT: Record<string, number> = {
  SPX: 1.25,
  IXIC: 1.15,
  DJI: 1.1,
  DAX: 0.95,
  FTSE: 0.9,
  FTMC: 0.8,
  NIKKEI: 0.9,
};

const REGION_LABELS: Record<string, string> = {
  US: 'US Pulse',
  EU: 'Europe Pulse',
  UK: 'UK Pulse',
  APAC: 'APAC Pulse',
};

const REGION_ORDER = ['US', 'EU', 'UK', 'APAC'] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatSignedPct(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function riskTone(score: number): {
  label: string;
  text: string;
  border: string;
  bg: string;
} {
  if (score >= 72) {
    return {
      label: 'RISK-OFF',
      text: 'text-rose-300',
      border: 'border-rose-500/35',
      bg: 'bg-rose-500/10',
    };
  }
  if (score >= 54) {
    return {
      label: 'CAUTIOUS',
      text: 'text-orange-300',
      border: 'border-orange-500/35',
      bg: 'bg-orange-500/10',
    };
  }
  return {
    label: 'BALANCED',
    text: 'text-emerald-300',
    border: 'border-emerald-500/35',
    bg: 'bg-emerald-500/10',
  };
}

function regimeLabel(score: number): string {
  if (score >= 72) return 'High volatility / risk-off';
  if (score >= 54) return 'Two-way tape / defensive';
  if (score >= 38) return 'Mixed risk / rotational';
  return 'Stable risk-on / supportive';
}

function strengthLabel(score: number): string {
  if (score >= 70) return 'Strong';
  if (score >= 52) return 'Moderate';
  return 'Muted';
}

const GlobalRiskPanel = memo(function GlobalRiskPanel() {
  const { data: globalIndices, isConnected: globalConnected } = useGlobalIndicesSocket();
  const [globalNowMs, setGlobalNowMs] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => setGlobalNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const getGlobalIndexTick = useCallback((key: string, alias?: string) => {
    const byKey = globalIndices[key];
    if (byKey) return byKey;
    if (alias) return globalIndices[alias];
    return undefined;
  }, [globalIndices]);

  const globalRiskSnapshots = useMemo(() => {
    return GLOBAL_RISK_ITEMS.map((item) => {
      const g = getGlobalIndexTick(item.key, item.alias);
      const hasData = !!g && g.status !== 'UNAVAILABLE' && Number.isFinite(g?.changePct);
      const tsMs = Date.parse(g?.timestamp || '');
      const ageSec = Number.isFinite(tsMs) ? Math.max(0, (globalNowMs - tsMs) / 1000) : Number.POSITIVE_INFINITY;
      const liveQuality = g?.liveQuality ?? 'UNAVAILABLE';

      let freshness: 'LIVE' | 'STALE' | 'UNAVAILABLE' = 'UNAVAILABLE';
      if (hasData) {
        const realtime = g?.status === 'LIVE' && liveQuality === 'REALTIME' && ageSec <= 20;
        freshness = realtime ? 'LIVE' : 'STALE';
      }

      return {
        item,
        tick: g,
        hasData,
        pct: hasData ? (g?.changePct ?? 0) : 0,
        freshness,
        liveQuality,
        ageSec,
      };
    });
  }, [getGlobalIndexTick, globalNowMs]);

  const globalRiskOverview = useMemo(() => {
    const active = globalRiskSnapshots.filter((s) => s.hasData);
    const changes = active.map((s) => s.pct);

    const netChange = changes.reduce((a, b) => a + b, 0);
    const upCount = changes.filter((c) => c > 0.03).length;
    const downCount = changes.filter((c) => c < -0.03).length;
    const flatCount = changes.length - upCount - downCount;
    const liveCount = globalRiskSnapshots.filter((s) => s.freshness === 'LIVE').length;
    const staleCount = globalRiskSnapshots.filter((s) => s.freshness === 'STALE').length;
    const total = globalRiskSnapshots.length;
    const latestAgeSec = active.length ? Math.min(...active.map((s) => s.ageSec)) : Number.POSITIVE_INFINITY;

    let weightedScore = 0;
    let totalWeight = 0;
    let weightedAbs = 0;
    let upWeight = 0;
    let downWeight = 0;

    for (const s of globalRiskSnapshots) {
      if (!s.hasData || !s.tick) continue;
      const baseWeight = INDEX_WEIGHT[s.item.key] ?? 1;
      const freshnessWeight = s.freshness === 'LIVE' ? 1 : s.freshness === 'STALE' ? 0.45 : 0;
      const agePenalty = Number.isFinite(s.ageSec) ? Math.max(0.55, 1 - Math.min(120, s.ageSec) / 220) : 0.55;
      const weight = baseWeight * freshnessWeight * agePenalty;
      if (weight <= 0) continue;

      const boundedPct = Math.max(-3, Math.min(3, s.pct));
      weightedScore += boundedPct * weight;
      weightedAbs += Math.abs(boundedPct) * weight;
      totalWeight += weight;
    }

    const avgVolatility = totalWeight > 0 ? weightedAbs / totalWeight : 0;
    const dynamicThreshold = Math.max(0.05, Math.min(0.2, 0.055 + avgVolatility * 0.22));

    for (const s of globalRiskSnapshots) {
      if (!s.hasData || !s.tick) continue;
      const baseWeight = INDEX_WEIGHT[s.item.key] ?? 1;
      const freshnessWeight = s.freshness === 'LIVE' ? 1 : s.freshness === 'STALE' ? 0.45 : 0;
      const agePenalty = Number.isFinite(s.ageSec) ? Math.max(0.55, 1 - Math.min(120, s.ageSec) / 220) : 0.55;
      const weight = baseWeight * freshnessWeight * agePenalty;
      if (weight <= 0) continue;

      if (s.pct > dynamicThreshold) upWeight += weight;
      else if (s.pct < -dynamicThreshold) downWeight += weight;
    }

    const directionalStrength = totalWeight > 0 ? Math.abs(weightedScore) / totalWeight : 0;
    const breadthDen = upWeight + downWeight;
    const breadthEdge = breadthDen > 0 ? Math.abs(upWeight - downWeight) / breadthDen : 0;
    const coverage = total > 0 ? active.length / total : 0;
    const freshnessCoverage = total > 0 ? liveCount / total : 0;
    const dispersion = active.length > 1
      ? active.reduce((sum, item) => sum + Math.abs(item.pct - netChange / active.length), 0) / active.length
      : 0;

    const rawRisk =
      34 * (1 - clamp(Math.abs(weightedScore) / 3.2, 0, 1)) +
      30 * clamp(dispersion / 1.8, 0, 1) +
      20 * (1 - coverage) +
      16 * (1 - freshnessCoverage);
    const riskScore = Math.round(clamp(rawRisk, 0, 100));
    const tone = riskTone(riskScore);

    let status: 'TREND UP' | 'TREND DOWN' | 'NEUTRAL' = 'NEUTRAL';
    if (!changes.length) {
      status = 'NEUTRAL';
    } else if (liveCount === 0 && Math.abs(weightedScore) < 0.24) {
      status = 'NEUTRAL';
    } else if (directionalStrength < 0.085 && breadthEdge < 0.2) {
      status = 'NEUTRAL';
    } else if (weightedScore > 0 && upWeight >= downWeight * 0.9) {
      status = 'TREND UP';
    } else if (weightedScore < 0 && downWeight >= upWeight * 0.9) {
      status = 'TREND DOWN';
    }

    const regionSummary = REGION_ORDER.map((region) => {
      const regionItems = globalRiskSnapshots.filter((s) => s.item.key && s.item && s.tick && s.item && s.item.label && s.item.key && s.item.alias && s.item);
      const regionTicks = regionItems.filter((s) => s.tick?.region === region);
      const regionActive = regionTicks.filter((s) => s.hasData);
      const regionChange = regionActive.reduce((sum, s) => sum + s.pct, 0);
      const regionLive = regionTicks.filter((s) => s.freshness === 'LIVE').length;
      const regionCoverage = regionTicks.length > 0 ? regionActive.length / regionTicks.length : 0;
      const regionDirection = regionChange > 0.03 ? 'UP' : regionChange < -0.03 ? 'DOWN' : 'FLAT';
      const regionTone = regionDirection === 'UP'
        ? 'text-emerald-300 border-emerald-500/25 bg-emerald-500/8'
        : regionDirection === 'DOWN'
        ? 'text-rose-300 border-rose-500/25 bg-rose-500/8'
        : 'text-amber-300 border-amber-500/25 bg-amber-500/8';
      return {
        region,
        label: REGION_LABELS[region],
        change: regionChange,
        live: regionLive,
        coverage: regionCoverage,
        tone: regionTone,
        direction: regionDirection,
      };
    });

    return {
      status,
      tone,
      riskScore,
      regime: regimeLabel(riskScore),
      strength: strengthLabel(riskScore),
      netChange,
      upCount,
      downCount,
      flatCount,
      liveCount,
      staleCount,
      total,
      activeTotal: changes.length,
      latestAgeSec,
      hasData: changes.length > 0,
      coverage,
      freshnessCoverage,
      breadthEdge,
      dispersion,
      regionSummary,
    };
  }, [globalRiskSnapshots]);

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-slate-600/45 bg-gradient-to-b from-slate-900/90 via-slate-950/80 to-slate-950/95 shadow-[0_16px_50px_rgba(0,0,0,0.28)]">
      <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-cyan-400/80 to-transparent" />

      <div className="px-3.5 sm:px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div className="flex items-start gap-2.5 min-w-0 flex-1">
            <span className="w-[3px] h-9 rounded-full bg-gradient-to-b from-cyan-300 to-cyan-600/30 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[14px] sm:text-[16px] lg:text-[18px] font-extrabold text-white tracking-tight leading-tight whitespace-nowrap">
                  Global Risk
                </h3>
                <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[9px] sm:text-[10px] font-mono font-bold tracking-[0.08em] uppercase ${
                  globalConnected && globalRiskOverview.liveCount > 0
                    ? 'text-emerald-300 border-emerald-500/35 bg-emerald-500/10'
                    : 'text-amber-300 border-amber-500/35 bg-amber-500/10'
                }`}>
                  {globalConnected && globalRiskOverview.liveCount > 0 ? 'LIVE' : 'SNAPSHOT'}
                </span>
                <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[9px] sm:text-[10px] font-black tracking-[0.08em] uppercase ${globalRiskOverview.tone.border} ${globalRiskOverview.tone.bg} ${globalRiskOverview.tone.text}`}>
                  {globalRiskOverview.tone.label}
                </span>
              </div>
              <p className="text-[9.5px] sm:text-[10px] text-slate-500 font-medium mt-[2px] tracking-wide leading-tight hidden sm:block">
                Cross-market risk pulse, breadth, freshness, regional pressure and institutional regime scan
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-700/60 bg-slate-900/70 px-2.5 py-1 text-[9px] sm:text-[10px] font-bold text-slate-300 hover:text-white hover:border-slate-500/70 transition-colors"
            >
              <span>{expanded ? '▾' : '▸'}</span>
              <span>{expanded ? 'Collapse' : 'Expand'}</span>
            </button>
            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[9px] sm:text-[10px] font-black tracking-[0.08em] uppercase ${globalRiskOverview.tone.border} ${globalRiskOverview.tone.bg} ${globalRiskOverview.tone.text}`}>
              {globalRiskOverview.status}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-3">
          <div className="col-span-2 lg:col-span-1 rounded-xl border border-slate-700/45 bg-slate-900/55 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Risk score</span>
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] ${globalRiskOverview.tone.border} ${globalRiskOverview.tone.bg} ${globalRiskOverview.tone.text}`}>
                {globalRiskOverview.strength}
              </span>
            </div>
            <div className="flex items-end gap-2">
              <div className="text-3xl font-black tabular-nums text-white leading-none">
                {globalRiskOverview.riskScore}
              </div>
              <div className="pb-1 text-[10px] text-slate-500 font-medium leading-tight">
                / 100 market stress
              </div>
            </div>
            <div className="mt-2 h-2 rounded-full bg-slate-800/80 overflow-hidden">
              <div
                className={`h-full rounded-full ${globalRiskOverview.tone.bg}`}
                style={{ width: `${globalRiskOverview.riskScore}%`, backgroundImage: 'linear-gradient(90deg, rgba(56,189,248,0.95), rgba(16,185,129,0.9), rgba(245,158,11,0.9), rgba(239,68,68,0.95))' }}
              />
            </div>
            <div className="mt-2 text-[10px] text-slate-400 leading-snug">
              {globalRiskOverview.regime}
            </div>
          </div>

          <div className="col-span-2 lg:col-span-1 rounded-xl border border-slate-700/45 bg-slate-900/55 p-3">
            <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2">Market breadth</div>
            <div className="grid grid-cols-3 gap-2 text-[10px] font-mono">
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/8 px-2 py-2 text-center">
                <div className="text-emerald-300 font-black text-sm">{globalRiskOverview.upCount}</div>
                <div className="text-slate-500 mt-0.5">UP</div>
              </div>
              <div className="rounded-lg border border-rose-500/20 bg-rose-500/8 px-2 py-2 text-center">
                <div className="text-rose-300 font-black text-sm">{globalRiskOverview.downCount}</div>
                <div className="text-slate-500 mt-0.5">DOWN</div>
              </div>
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/8 px-2 py-2 text-center">
                <div className="text-amber-300 font-black text-sm">{globalRiskOverview.flatCount}</div>
                <div className="text-slate-500 mt-0.5">FLAT</div>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-400">
              <div className="rounded-lg border border-slate-700/45 bg-slate-950/45 px-2 py-1.5">LIVE {globalRiskOverview.liveCount}/{globalRiskOverview.total}</div>
              <div className="rounded-lg border border-slate-700/45 bg-slate-950/45 px-2 py-1.5">STALE {globalRiskOverview.staleCount}/{globalRiskOverview.total}</div>
            </div>
          </div>

          <div className="col-span-2 lg:col-span-1 rounded-xl border border-slate-700/45 bg-slate-900/55 p-3">
            <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2">Risk mechanics</div>
            <div className="space-y-2 text-[10px] text-slate-400">
              <div className="flex items-center justify-between gap-2">
                <span>Breadth edge</span>
                <span className="font-mono text-slate-200">{Math.round(globalRiskOverview.breadthEdge * 100)}%</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>Dispersion</span>
                <span className="font-mono text-slate-200">{globalRiskOverview.dispersion.toFixed(2)}%</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>Coverage</span>
                <span className="font-mono text-slate-200">{Math.round(globalRiskOverview.coverage * 100)}%</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>Freshness</span>
                <span className="font-mono text-slate-200">{Math.round(globalRiskOverview.freshnessCoverage * 100)}%</span>
              </div>
            </div>
          </div>

          <div className="col-span-2 lg:col-span-1 rounded-xl border border-slate-700/45 bg-slate-900/55 p-3">
            <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2">Latency / freshness</div>
            <div className="flex items-end justify-between gap-2 mb-2">
              <div className="text-2xl font-black text-cyan-300 tabular-nums leading-none">
                {Number.isFinite(globalRiskOverview.latestAgeSec) ? `${Math.round(globalRiskOverview.latestAgeSec)}s` : '--'}
              </div>
              <div className="text-right text-[10px] text-slate-500 leading-tight">
                latest quote age
              </div>
            </div>
            <div className="rounded-lg border border-slate-700/45 bg-slate-950/45 px-2.5 py-2 text-[10px] text-slate-400 leading-snug">
              {globalRiskOverview.strength} regime confidence with {globalRiskOverview.activeTotal}/{globalRiskOverview.total} active symbols online.
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700/45 bg-slate-950/40 px-3 py-2 mb-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] sm:text-[10px] font-mono text-slate-300">
            <span className="text-emerald-300">UP {globalRiskOverview.upCount}/{globalRiskOverview.activeTotal || globalRiskOverview.total}</span>
            <span className="text-rose-300">DOWN {globalRiskOverview.downCount}/{globalRiskOverview.activeTotal || globalRiskOverview.total}</span>
            <span className="text-amber-300">FLAT {globalRiskOverview.flatCount}/{globalRiskOverview.activeTotal || globalRiskOverview.total}</span>
            <span className="text-cyan-300">LIVE {globalRiskOverview.liveCount}/{globalRiskOverview.total}</span>
            <span className="text-orange-300">STALE {globalRiskOverview.staleCount}/{globalRiskOverview.total}</span>
            <span className="ml-auto font-black tabular-nums text-cyan-300">NET {formatSignedPct(globalRiskOverview.netChange)}</span>
            <span className="font-black tabular-nums text-slate-400">AGE {Number.isFinite(globalRiskOverview.latestAgeSec) ? `${Math.round(globalRiskOverview.latestAgeSec)}s` : '--'}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5 mb-3">
          {globalRiskOverview.regionSummary.map((region) => (
            <div key={region.region} className="rounded-xl border border-slate-700/45 bg-slate-900/55 px-3 py-2.5 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-[9px] uppercase tracking-[0.12em] font-semibold text-slate-400 truncate">{region.label}</span>
                <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[8px] font-black leading-none ${region.tone}`}>
                  {region.direction}
                </span>
              </div>
              <div className={`text-[14px] sm:text-[15px] font-mono font-black tabular-nums leading-none ${region.change >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                {formatSignedPct(region.change)}
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-[8px] font-mono text-slate-500 tabular-nums">
                <span>LIVE {region.live}</span>
                <span>coverage {Math.round(region.coverage * 100)}%</span>
              </div>
            </div>
          ))}
        </div>

        {expanded && (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-2 sm:gap-2.5">
            {globalRiskSnapshots.map(({ item, hasData, pct, freshness, liveQuality, ageSec }) => {
          const isUp = hasData ? pct >= 0 : false;
          const tone = !hasData
            ? 'text-slate-300 border-slate-500/30 bg-slate-700/20'
            : freshness === 'STALE'
            ? 'text-amber-300 border-amber-500/25 bg-amber-500/8'
            : isUp
            ? 'text-emerald-300 border-emerald-500/25 bg-emerald-500/8'
            : 'text-rose-300 border-rose-500/25 bg-rose-500/8';
          const label = !hasData
            ? 'N/A'
            : liveQuality === 'CLOSED'
            ? 'CLOSED'
            : liveQuality === 'DELAYED'
            ? 'DELAYED'
            : freshness === 'STALE'
            ? 'STALE'
            : isUp
            ? 'UP'
            : 'DOWN';
          return (
            <div
              key={item.key}
              className="rounded-lg border border-slate-700/45 bg-slate-900/55 px-2.5 sm:px-3 py-2 min-w-0"
            >
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="text-[9px] sm:text-[10px] uppercase tracking-[0.1em] font-semibold text-slate-400 truncate">{item.label}</span>
                <span className={`inline-flex items-center rounded border px-1 py-0.5 text-[8px] font-bold leading-none ${tone}`}>
                  {label}
                </span>
              </div>
              <div className={`text-[13px] sm:text-[15px] font-mono font-black tabular-nums leading-none ${hasData ? (isUp ? 'text-emerald-300' : 'text-rose-300') : 'text-slate-400'}`}>
                {hasData ? `${isUp ? '+' : ''}${pct.toFixed(2)}%` : '--'}
              </div>
              <div className="mt-1 text-[8px] font-mono text-slate-500 tabular-nums">
                {Number.isFinite(ageSec) ? `${Math.round(ageSec)}s ago` : 'no feed'}
              </div>
            </div>
          );
        })}
        </div>
        )}
      </div>
    </section>
  );
});

export default GlobalRiskPanel;
