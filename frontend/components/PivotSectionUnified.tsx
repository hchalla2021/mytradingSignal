'use client';

import React, { memo, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Clock, RefreshCw } from 'lucide-react';
import { API_CONFIG } from '@/lib/api-config';

// ============================================================================
// TYPES
// ============================================================================
interface PivotData {
  symbol: string;
  status: 'LIVE' | 'CACHED' | 'OFFLINE' | 'CLOSED';
  current_price: number | null;
  change_percent?: number;
  timestamp: string;
  ema: { ema_20?: number | null; ema_50?: number | null; ema_100?: number | null; ema_200?: number | null; trend: string; price_vs_ema20?: string };
  classic_pivots: {
    pivot: number | null; r1: number | null; r2: number | null; r3: number | null;
    s1: number | null; s2: number | null; s3: number | null;
    bias: string;
  };
  camarilla_pivots: {
    h4: number | null; h3: number | null; l3: number | null; l4: number | null;
    zone: string;
  };
  supertrend_10_2: { value: number | null; trend: string; signal: string; distance_pct: number };
  supertrend_10_3: { value: number | null; trend: string; signal: string; distance_pct: number };
  overall_bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

interface SymbolConfig {
  symbol: string;
  name: string;
  shortName: string;
}

type MarketStatus = 'LIVE' | 'PRE_OPEN' | 'FREEZE' | 'CLOSED' | 'OFFLINE' | string;

const SYMBOLS: SymbolConfig[] = [
  { symbol: 'NIFTY', name: 'NIFTY 50', shortName: 'NIFTY' },
  { symbol: 'BANKNIFTY', name: 'BANK NIFTY', shortName: 'BNIFTY' },
  { symbol: 'SENSEX', name: 'SENSEX', shortName: 'SENSEX' },
];

// ============================================================================
// CACHE
// ============================================================================
const CACHE_KEY = 'pivot_unified_data_v2';

function getCachedData(): Record<string, PivotData> | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && Object.keys(parsed).length > 0) return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function setCachedData(data: Record<string, PivotData>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

// ============================================================================
// MARKET HOURS CHECK (IST)
// ============================================================================
function isIndianMarketOpen(): boolean {
  try {
    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const day = nowIST.getDay();
    if (day === 0 || day === 6) return false;
    const mins = nowIST.getHours() * 60 + nowIST.getMinutes();
    return mins >= 555 && mins <= 930; // 9:15 AM - 3:30 PM IST
  } catch {
    return false;
  }
}

// ============================================================================
// HELPERS
// ============================================================================
const fmt = (n: number | null | undefined): string => {
  if (n === null || n === undefined) return '\u2014';
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

const fmtCompact = (n: number | null | undefined): string => {
  if (n === null || n === undefined) return '\u2014';
  return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
};

// ============================================================================
// PIVOT CONFIDENCE CALCULATION
// ============================================================================
function calculatePivotConfidence(
  price: number,
  bias: string,
  isPriceUp: boolean,
  st: { trend: string; distance_pct: number },
  pivotVal: number | null,
  camH4: number | null,
  status: string,
  symbol: string
): number {
  let confidence = 55;
  const isBullish = bias === 'BULLISH';
  const isBearish = bias === 'BEARISH';

  if ((isPriceUp && isBullish) || (!isPriceUp && isBearish)) {
    confidence = Math.round(confidence * 1.14);
  } else if (bias === 'NEUTRAL') {
    confidence = Math.round(confidence * 1.05);
  }

  const stAligns = (st.trend === 'BULLISH' && isPriceUp) || (st.trend === 'BEARISH' && !isPriceUp);
  if (stAligns) confidence = Math.round(confidence * 1.10);

  const stDistance = Math.abs(st.distance_pct || 0);
  if (stDistance > 2) confidence = Math.round(confidence * 1.10);
  else if (stDistance < 0.5) confidence = Math.round(confidence * 0.93);

  const pivotThreshold = symbol === 'BANKNIFTY' ? 0.025 : 0.02;
  const isNearCamarilla = camH4 && price && Math.abs(price - camH4) / camH4 < 0.01;
  const isNearPivot = pivotVal && price && Math.abs(price - pivotVal) / pivotVal < pivotThreshold;

  if (isNearCamarilla) confidence = Math.round(confidence * 0.87);
  else if (isNearPivot) confidence = Math.round(confidence * 0.94);

  if (status === 'LIVE') confidence = Math.round(confidence * 1.05);
  else if (status === 'CACHED') confidence = Math.round(confidence * 0.94);

  return Math.min(90, Math.max(35, confidence));
}

// ============================================================================
// PRICE POSITION — stable structure, no full JSX block swapping
// ============================================================================
interface PricePosition {
  zone: string;
  zoneLabel: string;
  zoneColor: string;
  nearestSupport: { label: string; value: number } | null;
  nearestResistance: { label: string; value: number } | null;
}

function getPricePosition(price: number | null, pivots: PivotData['classic_pivots']): PricePosition {
  const fallback: PricePosition = {
    zone: 'UNKNOWN', zoneLabel: '\u2014', zoneColor: 'text-slate-400',
    nearestSupport: null, nearestResistance: null,
  };
  if (!price || !pivots.pivot) return fallback;

  const levels = [
    { label: 'S3', value: pivots.s3 ?? 0 },
    { label: 'S2', value: pivots.s2 ?? 0 },
    { label: 'S1', value: pivots.s1 ?? 0 },
    { label: 'P', value: pivots.pivot ?? 0 },
    { label: 'R1', value: pivots.r1 ?? 0 },
    { label: 'R2', value: pivots.r2 ?? 0 },
    { label: 'R3', value: pivots.r3 ?? 0 },
  ];

  let nearestSup: { label: string; value: number } | null = null;
  let nearestRes: { label: string; value: number } | null = null;
  for (const l of levels) {
    if (l.value <= price) nearestSup = l;
  }
  for (let i = levels.length - 1; i >= 0; i--) {
    if (levels[i].value >= price) nearestRes = levels[i];
  }

  if (price > (pivots.r3 ?? Infinity))
    return { zone: 'ABOVE_R3', zoneLabel: 'Above R3 \u2014 Breakout', zoneColor: 'text-emerald-400', nearestSupport: nearestSup, nearestResistance: null };
  if (price > (pivots.r2 ?? Infinity))
    return { zone: 'R2_R3', zoneLabel: 'Between R2\u2013R3', zoneColor: 'text-emerald-300', nearestSupport: nearestSup, nearestResistance: nearestRes };
  if (price > (pivots.r1 ?? Infinity))
    return { zone: 'R1_R2', zoneLabel: 'Between R1\u2013R2', zoneColor: 'text-teal-300', nearestSupport: nearestSup, nearestResistance: nearestRes };
  if (price > (pivots.pivot ?? Infinity))
    return { zone: 'P_R1', zoneLabel: 'Above Pivot', zoneColor: 'text-cyan-300', nearestSupport: nearestSup, nearestResistance: nearestRes };
  if (price > (pivots.s1 ?? -Infinity))
    return { zone: 'S1_P', zoneLabel: 'Below Pivot', zoneColor: 'text-amber-300', nearestSupport: nearestSup, nearestResistance: nearestRes };
  if (price > (pivots.s2 ?? -Infinity))
    return { zone: 'S2_S1', zoneLabel: 'Between S2\u2013S1', zoneColor: 'text-orange-300', nearestSupport: nearestSup, nearestResistance: nearestRes };
  if (price > (pivots.s3 ?? -Infinity))
    return { zone: 'S3_S2', zoneLabel: 'Between S3\u2013S2', zoneColor: 'text-red-300', nearestSupport: nearestSup, nearestResistance: nearestRes };
  return { zone: 'BELOW_S3', zoneLabel: 'Below S3 \u2014 Breakdown', zoneColor: 'text-red-400', nearestSupport: null, nearestResistance: nearestRes };
}

// ============================================================================
// SINGLE SYMBOL PIVOT CARD
// ============================================================================
const SymbolPivotCard = memo<{ data: PivotData; config: SymbolConfig; isLiveMarket: boolean }>(
  ({ data, config, isLiveMarket }) => {
    const price = data.current_price ?? 0;
    const pivots = data.classic_pivots;
    const cam = data.camarilla_pivots;
    const st = data.supertrend_10_3?.value != null ? data.supertrend_10_3 : data.supertrend_10_2;
    const bias = data.overall_bias;
    const priceChange = data.change_percent ?? 0;
    const isPriceUp = priceChange >= 0;
    const isBullish = bias === 'BULLISH';
    const isBearish = bias === 'BEARISH';

    const position = useMemo(() => getPricePosition(price, pivots), [price, pivots]);

    const pivotConfidence = useMemo(() =>
      calculatePivotConfidence(price, bias, isPriceUp, st, pivots.pivot, cam.h4, data.status, config.symbol),
      [price, bias, isPriceUp, st, pivots.pivot, cam.h4, data.status, config.symbol]
    );

    const prediction = useMemo(() => {
      const stAligns = (isBullish && st.trend === 'BULLISH') || (isBearish && st.trend === 'BEARISH');
      const stOpposes = (isBullish && st.trend === 'BEARISH') || (isBearish && st.trend === 'BULLISH');
      const stDist = Math.abs(st.distance_pct || 0);

      let conf = pivotConfidence;
      if (stOpposes) conf = Math.round(conf * 0.85);
      else if (stAligns && stDist > 1) conf = Math.round(conf * 1.08);
      else if (stAligns) conf = Math.round(conf * 1.04);
      if (!isLiveMarket) conf = Math.round(Math.max(30, conf * 0.88));
      conf = Math.min(95, Math.max(30, conf));

      const dir = isBullish ? 'LONG' : isBearish ? 'SHORT' : 'FLAT';
      return { conf, dir, stAligns, stOpposes, stDist };
    }, [pivotConfidence, isBullish, isBearish, st, isLiveMarket]);

    const pivotLevels = useMemo(() => [
      { label: 'R3', value: pivots.r3, type: 'resistance' as const },
      { label: 'R2', value: pivots.r2, type: 'resistance' as const },
      { label: 'R1', value: pivots.r1, type: 'resistance' as const },
      { label: 'P', value: pivots.pivot, type: 'pivot' as const },
      { label: 'S1', value: pivots.s1, type: 'support' as const },
      { label: 'S2', value: pivots.s2, type: 'support' as const },
      { label: 'S3', value: pivots.s3, type: 'support' as const },
    ], [pivots]);

    const biasColor = isBullish ? 'text-emerald-400' : isBearish ? 'text-red-400' : 'text-amber-400';
    const biasLabel = isBullish ? 'BULLISH' : isBearish ? 'BEARISH' : 'NEUTRAL';
    const biasIcon = isBullish ? '\u25B2' : isBearish ? '\u25BC' : '\u25CF';
    const predColor = prediction.dir === 'LONG' ? 'text-emerald-400' : prediction.dir === 'SHORT' ? 'text-red-400' : 'text-amber-400';

    return (
      <div className="rounded-xl border border-slate-700/60 bg-[#0b1120]/80 overflow-hidden">
        {/* HEADER */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-800/40 border-b border-slate-700/40">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-white">{config.name}</span>
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${biasColor} ${isBullish ? 'bg-emerald-500/15' : isBearish ? 'bg-red-500/15' : 'bg-amber-500/15'}`}>
              {biasIcon} {biasLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isLiveMarket && data.status === 'LIVE' ? (
              <span className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                LIVE
              </span>
            ) : (
              <span className="text-[10px] font-bold text-slate-500">
                {data.status === 'CACHED' ? 'LAST SESSION' : 'CLOSED'}
              </span>
            )}
          </div>
        </div>

        {/* PRICE + ZONE */}
        <div className="px-4 py-3 border-b border-slate-700/30">
          <div className="flex items-baseline justify-between">
            <div>
              <span className={`text-xl font-black tabular-nums ${isPriceUp ? 'text-emerald-400' : 'text-red-400'}`}>
                ₹{fmt(price)}
              </span>
              <span className={`ml-2 text-xs font-bold ${isPriceUp ? 'text-emerald-400' : 'text-red-400'}`}>
                {isPriceUp ? '\u25B2' : '\u25BC'} {Math.abs(priceChange).toFixed(2)}%
              </span>
            </div>
          </div>
          <div className={`mt-1.5 text-[11px] font-semibold ${position.zoneColor}`}>
            {position.zoneLabel}
          </div>
        </div>

        {/* PIVOT LEVELS */}
        <div className="px-4 py-3 border-b border-slate-700/30">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Classic Pivots</div>
          <div className="space-y-0">
            {pivotLevels.map(level => {
              const isCurrentZone = price > 0 && level.value !== null && (
                (position.nearestResistance?.label === level.label) ||
                (position.nearestSupport?.label === level.label)
              );
              const isPivotLevel = level.type === 'pivot';
              const labelColor = level.type === 'resistance' ? 'text-red-400' : level.type === 'support' ? 'text-emerald-400' : 'text-amber-300';

              return (
                <div
                  key={level.label}
                  className={`flex items-center justify-between py-1 px-2 rounded text-xs ${
                    isPivotLevel ? 'bg-amber-500/10 border border-amber-500/20 my-0.5' :
                    isCurrentZone ? 'bg-slate-700/30' : ''
                  }`}
                >
                  <span className={`font-bold w-8 ${labelColor}`}>{level.label}</span>
                  <span className="font-mono text-slate-300 tabular-nums">{fmt(level.value)}</span>
                  {isCurrentZone && (
                    <span className="text-[9px] text-amber-400 font-bold ml-1">
                      {position.nearestResistance?.label === level.label ? '\u2190 NEXT R' : '\u2190 NEXT S'}
                    </span>
                  )}
                  {!isCurrentZone && <span className="w-12" />}
                </div>
              );
            })}
          </div>
        </div>

        {/* CAMARILLA LEVELS */}
        <div className="px-4 py-3 border-b border-slate-700/30">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Camarilla</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-red-400/80 font-semibold">H4</span>
              <span className="font-mono text-slate-400 tabular-nums">{fmtCompact(cam.h4)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-red-400/60 font-semibold">H3</span>
              <span className="font-mono text-slate-400 tabular-nums">{fmtCompact(cam.h3)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-emerald-400/60 font-semibold">L3</span>
              <span className="font-mono text-slate-400 tabular-nums">{fmtCompact(cam.l3)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-emerald-400/80 font-semibold">L4</span>
              <span className="font-mono text-slate-400 tabular-nums">{fmtCompact(cam.l4)}</span>
            </div>
          </div>
          {cam.zone && (
            <div className={`mt-2 text-[10px] font-semibold text-center py-1 rounded ${
              cam.zone.includes('BUY') ? 'text-emerald-400 bg-emerald-500/10' :
              cam.zone.includes('SELL') ? 'text-red-400 bg-red-500/10' :
              'text-slate-400 bg-slate-700/20'
            }`}>
              {cam.zone.replace(/_/g, ' ')}
            </div>
          )}
        </div>

        {/* CONFIDENCE */}
        <div className="px-4 py-3 border-b border-slate-700/30">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Pivot Confidence</span>
            <span className="text-sm font-black text-teal-300 tabular-nums">{pivotConfidence}%</span>
          </div>
          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-teal-500 rounded-full" style={{ width: `${pivotConfidence}%` }} />
          </div>
        </div>

        {/* 5-MIN PREDICTION */}
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">5-Min Prediction</span>
            <span className={`text-xs font-black ${predColor}`}>
              {prediction.dir === 'LONG' ? '\u25B2' : prediction.dir === 'SHORT' ? '\u25BC' : '\u2500'} {prediction.dir}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-slate-400">Confidence</span>
            <span className={`font-bold tabular-nums ${predColor}`}>{prediction.conf}%</span>
          </div>

          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden mb-3">
            <div
              className={`h-full rounded-full ${
                prediction.dir === 'LONG' ? 'bg-emerald-500' : prediction.dir === 'SHORT' ? 'bg-red-500' : 'bg-amber-500'
              }`}
              style={{ width: `${prediction.conf}%` }}
            />
          </div>

          {/* Alignment indicators */}
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="flex justify-between bg-slate-800/40 rounded px-2 py-1">
              <span className="text-slate-500">SuperTrend</span>
              <span className={`font-bold ${prediction.stAligns ? 'text-emerald-400' : prediction.stOpposes ? 'text-red-400' : 'text-amber-400'}`}>
                {prediction.stAligns ? 'Aligned' : prediction.stOpposes ? 'Diverges' : 'Neutral'}
              </span>
            </div>
            <div className="flex justify-between bg-slate-800/40 rounded px-2 py-1">
              <span className="text-slate-500">ST Distance</span>
              <span className="font-bold text-slate-300 tabular-nums">{prediction.stDist.toFixed(2)}%</span>
            </div>
          </div>

          {/* Nearest levels summary */}
          {(position.nearestSupport || position.nearestResistance) && (
            <div className="grid grid-cols-2 gap-2 text-[10px] mt-2">
              {position.nearestSupport && (
                <div className="flex justify-between bg-emerald-500/5 border border-emerald-500/15 rounded px-2 py-1">
                  <span className="text-emerald-400/70">Support</span>
                  <span className="font-bold text-emerald-400 tabular-nums">{position.nearestSupport.label} {fmtCompact(position.nearestSupport.value)}</span>
                </div>
              )}
              {position.nearestResistance && (
                <div className="flex justify-between bg-red-500/5 border border-red-500/15 rounded px-2 py-1">
                  <span className="text-red-400/70">Resistance</span>
                  <span className="font-bold text-red-400 tabular-nums">{position.nearestResistance.label} {fmtCompact(position.nearestResistance.value)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
);

SymbolPivotCard.displayName = 'SymbolPivotCard';

// ============================================================================
// MAIN COMPONENT
// ============================================================================
const PivotSectionUnified = memo<{ updates?: number; analyses?: Record<string, any> | null; marketStatus?: MarketStatus }>((props) => {
  const { analyses, marketStatus = 'LIVE' } = props;
  const [allData, setAllData] = useState<Record<string, PivotData>>(() => getCachedData() || {});
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const isFetchingRef = useRef(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasFetchedRef = useRef(false);
  // Locked pivot levels — once valid R3-S3 arrive they never get overwritten with zeros
  const lockedPivotsRef = useRef<Record<string, PivotData['classic_pivots']>>({});
  const lockedCamRef = useRef<Record<string, PivotData['camarilla_pivots']>>({});

  const isLiveMarket = useMemo(() => {
    if (marketStatus === 'LIVE') return true;
    if (marketStatus === 'CLOSED' || marketStatus === 'OFFLINE') return false;
    return isIndianMarketOpen();
  }, [marketStatus]);

  const fetchAllData = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    try {
      const liveUrl = API_CONFIG.endpoint('/api/advanced/pivot-indicators');
      const liveResp = await fetch(liveUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
      });

      if (!liveResp.ok) throw new Error(`API returned ${liveResp.status}`);

      const liveData = await liveResp.json();
      const validData: Record<string, PivotData> = {};

      for (const symbol of ['NIFTY', 'BANKNIFTY', 'SENSEX']) {
        const d = liveData?.[symbol];
        if (d && (d.current_price || d.classic_pivots?.pivot)) {
          const entry: PivotData = { ...d, timestamp: new Date().toISOString() };

          // Lock pivot levels: once valid, never replace with zeros
          const cp = entry.classic_pivots;
          const hasPivots = cp && cp.pivot > 0 && cp.r1 > 0 && cp.s1 > 0;
          if (hasPivots) {
            lockedPivotsRef.current[symbol] = { ...cp };
          } else if (lockedPivotsRef.current[symbol]) {
            entry.classic_pivots = { ...lockedPivotsRef.current[symbol], bias: cp?.bias || 'NEUTRAL' };
          }

          const cam = entry.camarilla_pivots;
          const hasCam = cam && cam.h4 > 0 && cam.l4 > 0;
          if (hasCam) {
            lockedCamRef.current[symbol] = { ...cam };
          } else if (lockedCamRef.current[symbol]) {
            entry.camarilla_pivots = { ...lockedCamRef.current[symbol], zone: cam?.zone || '' };
          }

          validData[symbol] = entry;
        }
      }

      if (Object.keys(validData).length >= 2) {
        setAllData(validData);
        setCachedData(validData);
        setLastUpdate(new Date().toLocaleTimeString('en-IN'));
        setError(null);
        setLoading(false);
        hasFetchedRef.current = true;
      } else {
        throw new Error('Insufficient pivot data');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Pivot] Error:', msg);
      setError(msg);
      setLoading(false);
    } finally {
      isFetchingRef.current = false;
    }
  }, []);

  // Seed from parent analyses (fast path) — only used BEFORE the dedicated API responds.
  // Once hasFetchedRef is true, the dedicated pivot API is the sole data source
  // to prevent two competing sources from causing flicker.
  useEffect(() => {
    if (!analyses || hasFetchedRef.current) return;
    const built: Record<string, PivotData> = {};
    for (const sym of ['NIFTY', 'BANKNIFTY', 'SENSEX']) {
      const symData = analyses[sym];
      if (!symData) continue;
      const ind = symData.indicators || {};
      const price = ind.price || 0;
      const isBull = (symData.signal || '').includes('BUY');
      const isBear = (symData.signal || '').includes('SELL');
      const pp = ind.pivot_points || {};

      const cpivot = pp.pivot || ind.cpr_pivot || 0;
      const cr1 = pp.r1 || ind.pivot_r1 || 0;
      // Skip this symbol if pivot data is empty — don't overwrite with zeros
      if (cpivot <= 0 && cr1 <= 0) continue;

      built[sym] = {
        symbol: sym,
        status: symData.status || 'LIVE',
        current_price: price,
        change_percent: ind.change_percent || 0,
        timestamp: new Date().toISOString(),
        ema: {
          ema_20: ind.ema_20 || null,
          ema_50: ind.ema_50 || null,
          ema_100: ind.ema_100 || null,
          ema_200: ind.ema_200 || null,
          trend: ind.trend || 'NEUTRAL',
          price_vs_ema20: price > (ind.ema_20 || 0) ? 'ABOVE' : 'BELOW',
        },
        classic_pivots: {
          pivot: cpivot,
          r1: cr1,
          r2: pp.r2 || ind.pivot_r2 || 0,
          r3: pp.r3 || ind.pivot_r3 || 0,
          s1: pp.s1 || ind.pivot_s1 || 0,
          s2: pp.s2 || ind.pivot_s2 || 0,
          s3: pp.s3 || ind.pivot_s3 || 0,
          bias: isBull ? 'BULLISH' : isBear ? 'BEARISH' : 'NEUTRAL',
        },
        camarilla_pivots: {
          h4: ind.camarilla_h4 || 0,
          h3: ind.camarilla_h3 || 0,
          l3: ind.camarilla_l3 || 0,
          l4: ind.camarilla_l4 || 0,
          zone: ind.camarilla_zone || (isBull ? 'BULLISH_ZONE' : isBear ? 'BEARISH_ZONE' : 'NEUTRAL'),
        },
        supertrend_10_2: {
          value: ind.supertrend_10_2_value || null,
          trend: ind.supertrend_10_2_trend || (isBull ? 'BULLISH' : isBear ? 'BEARISH' : 'NEUTRAL'),
          signal: ind.supertrend_10_2_signal || (isBull ? 'BUY' : isBear ? 'SELL' : 'NEUTRAL'),
          distance_pct: ind.supertrend_10_2_distance_pct || 0,
        },
        supertrend_10_3: {
          value: null,
          trend: 'NEUTRAL',
          signal: 'NEUTRAL',
          distance_pct: 0,
        },
        overall_bias: isBull ? 'BULLISH' : isBear ? 'BEARISH' : 'NEUTRAL',
      };
    }
    if (Object.keys(built).length > 0) {
      setAllData(prev => ({ ...prev, ...built }));
      setLoading(false);
    }
  }, [analyses]);

  // Fetch strategy: poll during market hours, fetch once when closed
  useEffect(() => {
    fetchAllData();

    if (isLiveMarket) {
      intervalRef.current = setInterval(fetchAllData, 5000);
    } else if (!hasFetchedRef.current) {
      const timeout = setTimeout(fetchAllData, 2000);
      return () => clearTimeout(timeout);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetchAllData, isLiveMarket]);

  const hasData = Object.keys(allData).length > 0;

  if (loading && !hasData) {
    return (
      <div className="bg-[#0b1120]/80 border border-slate-700/50 rounded-xl p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-48 bg-slate-800/30 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="bg-[#0b1120]/80 border border-slate-700/50 rounded-xl p-6 text-center">
        {error ? (
          <>
            <p className="text-red-400 font-bold mb-1">Connection Error</p>
            <p className="text-slate-400 text-sm">{error}</p>
          </>
        ) : (
          <>
            <Clock className="w-8 h-8 mx-auto mb-2 text-slate-500" />
            <p className="text-slate-400 text-sm">Loading market data...</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Status Bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800/30 border border-slate-700/40 rounded-lg">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${
            isLiveMarket && Object.values(allData).some(d => d?.status === 'LIVE')
              ? 'bg-emerald-400'
              : 'bg-slate-500'
          }`} />
          <span className="text-xs font-semibold text-slate-400">
            {isLiveMarket ? 'LIVE MARKET' : 'MARKET CLOSED \u2014 Last Session Data'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdate && <span className="text-[10px] text-slate-600">{lastUpdate}</span>}
        </div>
      </div>

      {/* Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {SYMBOLS.map(config => {
          const data = allData[config.symbol];
          if (!data || (!data.current_price && !data.classic_pivots?.pivot)) {
            return (
              <div key={config.symbol} className="rounded-xl p-4 bg-slate-800/20 border border-slate-700/40 text-center">
                <p className="text-slate-500 text-sm">{config.name}</p>
                <p className="text-slate-600 text-xs mt-1">No data</p>
              </div>
            );
          }
          return <SymbolPivotCard key={config.symbol} data={data} config={config} isLiveMarket={isLiveMarket} />;
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-4 pt-1 text-[9px] text-slate-600">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 bg-emerald-500/40 rounded" /> Support (S1–S3)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 bg-amber-500/40 rounded" /> Pivot
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 bg-red-500/40 rounded" /> Resistance (R1–R3)
        </span>
      </div>
    </div>
  );
});

PivotSectionUnified.displayName = 'PivotSectionUnified';

export default PivotSectionUnified;