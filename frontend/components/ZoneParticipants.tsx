'use client';

/**
 * Zone Participant Intelligence — Live OI + Volume Edition
 */

import React, { memo, useMemo, useState } from 'react';
import type { MarketTick } from '@/hooks/useMarketSocket';
import {
  type SymbolChartData,
  type ZoneParticipants as ZP,
  type StrikeOI,
} from '@/hooks/useChartIntelligence';

// ── Formatting helpers ───────────────────────────────────────────────────────

function fmtVol(n: number): string {
  if (!n || n <= 0) return '—';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1_000_000)     return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000)         return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toFixed(0);
}

function fmtPrice(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function distLabel(price: number, spot: number): { txt: string; above: boolean; pct: number } {
  const pts = price - spot;
  const pct = spot > 0 ? Math.abs(pts / spot) * 100 : 0;
  const above = pts >= 0;
  const ptsFmt = Math.abs(pts) < 10 ? Math.abs(pts).toFixed(1) : Math.round(Math.abs(pts)).toLocaleString('en-IN');
  return { txt: `${above ? 'UP' : 'DN'} ${ptsFmt} pts . ${pct.toFixed(2)}%`, above, pct };
}

type Rotation = 'CE_TO_PE' | 'PE_TO_CE' | 'BUILDING' | 'UNWINDING' | 'STABLE';

const ROTATION_CFG: Record<Rotation, { label: string; color: string; bg: string; icon: string }> = {
  PE_TO_CE:  { label: 'PE-CE Rotate', color: 'text-emerald-300', bg: 'bg-emerald-500/20 border-emerald-500/40', icon: 'UP' },
  CE_TO_PE:  { label: 'CE-PE Rotate', color: 'text-red-300',     bg: 'bg-red-500/20 border-red-500/40',         icon: 'DN' },
  BUILDING:  { label: 'OI Building',  color: 'text-amber-300',   bg: 'bg-amber-500/15 border-amber-500/30',      icon: '+' },
  UNWINDING: { label: 'OI Unwind',    color: 'text-slate-400',   bg: 'bg-slate-600/20 border-slate-600/30',      icon: '-' },
  STABLE:    { label: 'Stable OI',    color: 'text-slate-500',   bg: 'bg-slate-700/15 border-slate-700/25',      icon: '=' },
};

interface ZoneEntry {
  id: string;
  label: string;
  sublabel: string;
  priceLabel: string;
  midPrice: number;
  distTxt: string;
  above: boolean;
  distPct: number;
  bull_vol: number;
  bear_vol: number;
  total_vol: number;
  candle_touch_count: number;
  vol_defender: 'BULLS' | 'BEARS' | 'BALANCED';
  bull_pct: number;
  strike: number;
  ce_oi: number;
  pe_oi: number;
  ce_oi_chg: number;
  pe_oi_chg: number;
  ce_vol: number;
  pe_vol: number;
  rotation: Rotation;
  oi_defender: 'CALLS' | 'PUTS' | 'BALANCED';
  oi_interpretation: string;
  quality: 'PREMIUM' | 'STANDARD' | 'WEAK' | 'N/A';
  active: boolean;
  zoneType: string;
}

function collectZones(data: SymbolChartData, spot: number): ZoneEntry[] {
  const zones: ZoneEntry[] = [];
  let idx = 0;

  function vp(z: Partial<ZP>) {
    return {
      bull_vol:           z.bull_vol    ?? 0,
      bear_vol:           z.bear_vol    ?? 0,
      total_vol:          z.total_vol   ?? 0,
      candle_touch_count: z.touch_count ?? 0,
      vol_defender:       (z.defender   ?? 'BALANCED') as 'BULLS' | 'BEARS' | 'BALANCED',
      bull_pct:           z.bull_pct    ?? 50,
    };
  }

  function si(z: Partial<StrikeOI>) {
    return {
      strike:            z.strike ?? 0,
      ce_oi:             z.ce_oi  ?? 0,
      pe_oi:             z.pe_oi  ?? 0,
      ce_oi_chg:         z.ce_oi_chg ?? 0,
      pe_oi_chg:         z.pe_oi_chg ?? 0,
      ce_vol:            z.ce_vol ?? 0,
      pe_vol:            z.pe_vol ?? 0,
      rotation:          (z.rotation ?? 'STABLE') as Rotation,
      oi_defender:       (z.oi_defender ?? 'BALANCED') as 'CALLS' | 'PUTS' | 'BALANCED',
      oi_interpretation: z.oi_interpretation ?? '',
    };
  }

  for (const fvg of [...(data.fvg3m ?? []), ...(data.fvg5m ?? [])]) {
    const mid = (fvg.top + fvg.bottom) / 2;
    const { txt, above, pct } = distLabel(mid, spot);
    zones.push({
      id: `fvg-${idx++}`,
      label: fvg.type === 'bullish' ? 'FVG Bull Imbalance' : 'FVG Bear Imbalance',
      sublabel: `${fvg.quality ?? 'STANDARD'} . ${fvg.candles_ago ?? '?'} bars ago${fvg.filled ? ' . FILLED' : ''}`,
      priceLabel: `${fmtPrice(fvg.bottom)} to ${fmtPrice(fvg.top)}`,
      midPrice: mid, distTxt: txt, above, distPct: pct,
      ...vp(fvg), ...si(fvg as Partial<StrikeOI>),
      quality: fvg.quality ?? 'STANDARD', active: !fvg.filled, zoneType: 'fvg',
    });
  }

  for (const ob of [...(data.ob3m ?? []), ...(data.ob5m ?? [])]) {
    const mid = (ob.top + ob.bottom) / 2;
    const { txt, above, pct } = distLabel(mid, spot);
    zones.push({
      id: `ob-${idx++}`,
      label: ob.type === 'bullish' ? 'Order Block Demand' : 'Order Block Supply',
      sublabel: `${ob.quality ?? 'STANDARD'} . ${ob.candles_ago ?? '?'} bars ago${ob.mitigated ? ' . MITIGATED' : ''}`,
      priceLabel: `${fmtPrice(ob.bottom)} to ${fmtPrice(ob.top)}`,
      midPrice: mid, distTxt: txt, above, distPct: pct,
      ...vp(ob), ...si(ob as Partial<StrikeOI>),
      quality: ob.quality ?? 'STANDARD', active: !ob.mitigated, zoneType: 'ob',
    });
  }

  for (const lq of [...(data.liquidity3m ?? []), ...(data.liquidity5m ?? [])]) {
    const { txt, above, pct } = distLabel(lq.level, spot);
    zones.push({
      id: `liq-${idx++}`,
      label: lq.type === 'sell_side' ? 'Sell-Side Liquidity SSL' : 'Buy-Side Liquidity BSL',
      sublabel: `${lq.quality ?? 'STANDARD'} . ${lq.touchCount} touches${lq.swept ? ' . SWEPT' : ''}`,
      priceLabel: fmtPrice(lq.level),
      midPrice: lq.level, distTxt: txt, above, distPct: pct,
      ...vp(lq), ...si(lq as Partial<StrikeOI>),
      quality: lq.quality ?? 'STANDARD', active: !lq.swept, zoneType: 'liquidity',
    });
  }

  const levelKeys = [
    { key: 'pdh', label: 'Prev Day High PDH', type: 'pdh' },
    { key: 'pdl', label: 'Prev Day Low PDL',  type: 'pdl' },
    { key: 'cdh', label: 'Curr Day High CDH', type: 'cdh' },
    { key: 'cdl', label: 'Curr Day Low CDL',  type: 'cdl' },
  ] as const;
  for (const { key, label, type } of levelKeys) {
    const lv = data.levels[key];
    if (!lv || lv <= 0) continue;
    const { txt, above, pct } = distLabel(lv, spot);
    const p = (data.levels as Record<string, unknown>)[`${key}_participants`] as Partial<ZP> | undefined;
    const s = (data.levels as Record<string, unknown>)[`${key}_strike_oi`] as Partial<StrikeOI> | undefined;
    zones.push({
      id: `${type}-${idx++}`,
      label,
      sublabel: type.startsWith('p') ? 'Daily reference level' : "Today's extreme",
      priceLabel: fmtPrice(lv),
      midPrice: lv, distTxt: txt, above, distPct: pct,
      ...vp(p ?? {}), ...si(s ?? {}),
      quality: 'N/A', active: true, zoneType: type,
    });
  }

  const srP = data.levels.sr_participants;
  for (const lv of data.levels.support ?? []) {
    const { txt, above, pct } = distLabel(lv, spot);
    const matched = srP?.support?.find(s => Math.abs(s.price - lv) < 2);
    zones.push({
      id: `sup-${idx++}`,
      label: 'Support Zone',
      sublabel: 'Swing low cluster — buy orders here',
      priceLabel: fmtPrice(lv),
      midPrice: lv, distTxt: txt, above, distPct: pct,
      ...vp(matched ?? {}), ...si(matched as Partial<StrikeOI> ?? {}),
      quality: 'N/A', active: true, zoneType: 'support',
    });
  }
  for (const lv of data.levels.resistance ?? []) {
    const { txt, above, pct } = distLabel(lv, spot);
    const matched = srP?.resistance?.find(r => Math.abs(r.price - lv) < 2);
    zones.push({
      id: `res-${idx++}`,
      label: 'Resistance Zone',
      sublabel: 'Swing high cluster — sell orders here',
      priceLabel: fmtPrice(lv),
      midPrice: lv, distTxt: txt, above, distPct: pct,
      ...vp(matched ?? {}), ...si(matched as Partial<StrikeOI> ?? {}),
      quality: 'N/A', active: true, zoneType: 'resistance',
    });
  }

  const seen = new Set<string>();
  const deduped: ZoneEntry[] = [];
  for (const z of zones) {
    const key = `${z.zoneType}-${Math.round(z.midPrice)}`;
    if (!seen.has(key)) { seen.add(key); deduped.push(z); }
  }
  return deduped.sort((a, b) => Math.abs(a.midPrice - spot) - Math.abs(b.midPrice - spot));
}

const ZONE_STYLE: Record<string, { dot: string; tag: string }> = {
  fvg:        { dot: '#38b2a6', tag: 'bg-teal-500/15 text-teal-300 border-teal-500/30' },
  ob:         { dot: '#c29a50', tag: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  liquidity:  { dot: '#9068c8', tag: 'bg-purple-500/15 text-purple-300 border-purple-500/30' },
  pdh:        { dot: '#b8983e', tag: 'bg-yellow-600/15 text-yellow-300 border-yellow-600/30' },
  pdl:        { dot: '#b06848', tag: 'bg-orange-600/15 text-orange-300 border-orange-600/30' },
  cdh:        { dot: '#3aa8bc', tag: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' },
  cdl:        { dot: '#5278b8', tag: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  support:    { dot: '#4e9a62', tag: 'bg-emerald-600/15 text-emerald-300 border-emerald-600/30' },
  resistance: { dot: '#a84858', tag: 'bg-red-600/15 text-red-300 border-red-600/30' },
};

const OIChangePill = memo(({ chg }: { chg: number }) => {
  if (!chg) return null;
  const isUp = chg > 0;
  return (
    <span className={`text-[8px] font-mono font-bold tabular-nums ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
      {isUp ? 'UP' : 'DN'}{fmtVol(Math.abs(chg))}
    </span>
  );
});
OIChangePill.displayName = 'OIChangePill';

const ZoneRow = memo(({ z, showOI }: { z: ZoneEntry; showOI: boolean }) => {
  const style = ZONE_STYLE[z.zoneType] ?? ZONE_STYLE.support;
  const bearPct = 100 - z.bull_pct;
  const hasVol  = z.total_vol > 0;
  const hasOI   = z.ce_oi > 0 || z.pe_oi > 0;
  const rotCfg  = ROTATION_CFG[z.rotation] ?? ROTATION_CFG.STABLE;
  const totalOI = z.ce_oi + z.pe_oi;
  const cePct   = totalOI > 0 ? Math.round(z.ce_oi / totalOI * 100) : 50;
  const pePct   = 100 - cePct;
  const oiDefColor = z.oi_defender === 'CALLS' ? 'text-red-400' : z.oi_defender === 'PUTS' ? 'text-emerald-400' : 'text-slate-400';
  const volDefColor = z.vol_defender === 'BULLS' ? 'text-emerald-400' : z.vol_defender === 'BEARS' ? 'text-red-400' : 'text-slate-400';
  const distColor = z.above ? 'text-red-400/60' : 'text-emerald-400/60';

  return (
    <div className={`relative rounded-lg border transition-all duration-200 ${z.active ? 'bg-slate-800/50 border-slate-700/50 hover:border-slate-600/70' : 'bg-slate-900/30 border-slate-800/30 opacity-45'}`}>
      <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-lg" style={{ background: style.dot }} />
      <div className="pl-3 pr-3 pt-2 pb-2">

        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 flex-wrap">
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border ${style.tag}`}>{z.label}</span>
              {z.quality !== 'N/A' && (
                <span className={`text-[8px] font-bold px-1 py-0.5 rounded border ${z.quality === 'PREMIUM' ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' : z.quality === 'STANDARD' ? 'bg-slate-600/20 text-slate-400 border-slate-600/30' : 'bg-slate-700/15 text-slate-500 border-slate-700/25'}`}>{z.quality}</span>
              )}
              {!z.active && <span className="text-[8px] text-slate-500 border border-slate-700/25 px-1 py-0.5 rounded">DONE</span>}
              {z.rotation !== 'STABLE' && (
                <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded border ${rotCfg.bg} ${rotCfg.color}`}>{rotCfg.icon} {rotCfg.label}</span>
              )}
            </div>
            <div className="text-[9px] text-slate-500 mt-0.5">{z.sublabel}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[11px] font-mono font-semibold text-slate-200 tabular-nums leading-tight">{z.priceLabel}</div>
            <div className={`text-[9px] font-mono tabular-nums ${distColor}`}>{z.distTxt}</div>
            {z.strike > 0 && <div className="text-[8px] text-slate-600 tabular-nums">Strike {fmtPrice(z.strike)}</div>}
          </div>
        </div>

        {showOI && hasOI && (
          <div className="mb-2 rounded-md bg-slate-900/60 border border-slate-700/30 px-2 py-1.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[8px] font-bold text-slate-400 tracking-wider">LIVE OPTION OI</span>
              <span className={`text-[8px] font-bold ${oiDefColor}`}>{z.oi_defender === 'CALLS' ? 'CALL WRITERS DEFEND' : z.oi_defender === 'PUTS' ? 'PUT WRITERS DEFEND' : 'BALANCED'}</span>
            </div>
            <div className="flex items-center gap-0 h-4 rounded-sm overflow-hidden mb-1">
              <div className="h-full bg-red-500/65 flex items-center justify-start pl-1 transition-all duration-700" style={{ width: `${cePct}%` }}>
                {cePct > 20 && <span className="text-[8px] font-bold text-red-100 whitespace-nowrap">CE {cePct}%</span>}
              </div>
              <div className="h-full bg-emerald-500/65 flex items-center justify-end pr-1 transition-all duration-700" style={{ width: `${pePct}%` }}>
                {pePct > 20 && <span className="text-[8px] font-bold text-emerald-100 whitespace-nowrap">{pePct}% PE</span>}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1 text-[9px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500/80 shrink-0" />
                  <span className="text-slate-400">CE OI</span>
                  <span className="font-mono font-semibold text-red-300 tabular-nums">{fmtVol(z.ce_oi)}</span>
                  <OIChangePill chg={z.ce_oi_chg} />
                </span>
                <span className="flex items-center gap-1 text-[9px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/80 shrink-0" />
                  <span className="text-slate-400">PE OI</span>
                  <span className="font-mono font-semibold text-emerald-300 tabular-nums">{fmtVol(z.pe_oi)}</span>
                  <OIChangePill chg={z.pe_oi_chg} />
                </span>
              </div>
              {(z.ce_vol > 0 || z.pe_vol > 0) && (
                <span className="text-[8px] text-slate-500 tabular-nums font-mono">Vol CE {fmtVol(z.ce_vol)} / PE {fmtVol(z.pe_vol)}</span>
              )}
            </div>
            {z.oi_interpretation && (
              <div className={`text-[8px] mt-1 leading-tight font-medium ${rotCfg.color}`}>{z.oi_interpretation}</div>
            )}
          </div>
        )}

        {hasVol && (
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[8px] text-slate-500 tracking-wider">CANDLE VOLUME AT ZONE</span>
              <span className={`text-[8px] font-bold ${volDefColor}`}>{z.vol_defender === 'BULLS' ? 'BUYERS' : z.vol_defender === 'BEARS' ? 'SELLERS' : 'EVEN'}</span>
            </div>
            <div className="flex items-center gap-0 h-3 rounded-sm overflow-hidden mb-1">
              <div className="h-full bg-emerald-500/55 transition-all duration-500" style={{ width: `${z.bull_pct}%` }} />
              <div className="h-full bg-red-500/55 transition-all duration-500" style={{ width: `${bearPct}%` }} />
            </div>
            <div className="flex items-center gap-3 text-[9px]">
              <span className="flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-emerald-500/70" />
                <span className="text-slate-500">Buy</span>
                <span className="font-mono font-semibold text-emerald-400/80 tabular-nums">{fmtVol(z.bull_vol)}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-red-500/70" />
                <span className="text-slate-500">Sell</span>
                <span className="font-mono font-semibold text-red-400/80 tabular-nums">{fmtVol(z.bear_vol)}</span>
              </span>
              <span className="text-slate-600">{z.candle_touch_count} candles</span>
            </div>
          </div>
        )}

        {!hasVol && !hasOI && (
          <div className="text-[8px] text-slate-600">Waiting for live data...</div>
        )}
      </div>
    </div>
  );
});
ZoneRow.displayName = 'ZoneRow';

const LiveHeader = memo(({ tick, symbol }: { tick: MarketTick | null | undefined; symbol: string }) => {
  if (!tick) return null;
  const oiChg = (tick as unknown as Record<string, number>).oi_change ?? 0;
  const oiChgColor = oiChg > 0 ? 'text-emerald-400' : oiChg < 0 ? 'text-red-400' : 'text-slate-400';
  const pcr = tick.pcr ?? 0;
  const pcrColor = pcr > 1.2 ? 'text-emerald-400' : pcr < 0.8 ? 'text-red-400' : 'text-amber-400';
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 bg-slate-900/50 border-b border-slate-700/30">
      <span className="text-[9px] font-bold text-slate-300 tracking-widest">{symbol} LIVE</span>
      <span className="flex items-center gap-1 text-[9px]">
        <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse shrink-0" />
        <span className="text-slate-400">LTP</span>
        <span className="font-mono font-bold text-slate-200 tabular-nums">{fmtPrice(tick.price)}</span>
      </span>
      <span className="flex items-center gap-1 text-[9px]">
        <span className="text-slate-500">Vol</span>
        <span className="font-mono font-semibold text-blue-300 tabular-nums">{fmtVol(tick.volume)}</span>
      </span>
      <span className="flex items-center gap-1 text-[9px]">
        <span className="text-slate-500">OI</span>
        <span className="font-mono font-semibold text-slate-300 tabular-nums">{fmtVol(tick.oi)}</span>
        {oiChg !== 0 && <span className={`font-mono font-bold tabular-nums text-[8px] ${oiChgColor}`}>{oiChg > 0 ? 'UP' : 'DN'}{Math.abs(oiChg).toFixed(2)}%</span>}
      </span>
      {(tick.callOI > 0 || tick.putOI > 0) && (
        <span className="flex items-center gap-1 text-[9px]">
          <span className="text-red-400/70">CE</span>
          <span className="font-mono font-semibold text-red-300 tabular-nums">{fmtVol(tick.callOI)}</span>
          <span className="text-slate-600">|</span>
          <span className="text-emerald-400/70">PE</span>
          <span className="font-mono font-semibold text-emerald-300 tabular-nums">{fmtVol(tick.putOI)}</span>
        </span>
      )}
      {pcr > 0 && (
        <span className="flex items-center gap-1 text-[9px]">
          <span className="text-slate-500">PCR</span>
          <span className={`font-mono font-bold tabular-nums ${pcrColor}`}>{pcr.toFixed(2)}</span>
        </span>
      )}
      <span className={`ml-auto text-[8px] font-mono font-bold ${tick.status === 'LIVE' ? 'text-emerald-400' : tick.status === 'PRE_OPEN' ? 'text-amber-400' : 'text-slate-500'}`}>
        {tick.status === 'LIVE' ? 'LIVE' : tick.status === 'PRE_OPEN' ? 'PRE-OPEN' : 'CLOSED'}
      </span>
    </div>
  );
});
LiveHeader.displayName = 'LiveHeader';

interface ZoneParticipantsProps {
  data: SymbolChartData | null;
  liveSpot?: number;
  liveMarket?: MarketTick | null;
  symbol?: string;
}

export const ZoneParticipants = memo(({ data, liveSpot, liveMarket, symbol = '' }: ZoneParticipantsProps) => {
  const [showOI, setShowOI] = useState(true);
  const [showSupplyResistance, setShowSupplyResistance] = useState(false);
  const [showDemandSupport, setShowDemandSupport] = useState(false);
  const spot = liveSpot && liveSpot > 0 ? liveSpot : data?.spot ?? 0;

  const zones = useMemo(() => {
    if (!data || spot <= 0) return [];
    return collectZones(data, spot);
  }, [data, spot]);

  if (!data || zones.length === 0) {
    return <div className="text-[11px] text-slate-500 text-center py-4">Waiting for zone data...</div>;
  }

  const aboveZones = zones.filter(z => z.above);
  const belowZones = zones.filter(z => !z.above);
  const activeZones = zones.filter(z => z.active).length;
  const bullDominated = zones.filter(z => z.active && (z.vol_defender === 'BULLS' || z.oi_defender === 'PUTS')).length;
  const bearDominated = zones.filter(z => z.active && (z.vol_defender === 'BEARS' || z.oi_defender === 'CALLS')).length;
  const bullRotations = zones.filter(z => z.active && z.rotation === 'PE_TO_CE').length;
  const bearRotations = zones.filter(z => z.active && z.rotation === 'CE_TO_PE').length;
  const overallRotation = bullRotations > bearRotations ? 'PE-CE BULL SHIFT' : bearRotations > bullRotations ? 'CE-PE BEAR SHIFT' : null;

  return (
    <div className="rounded-xl bg-dark-card/40 border border-slate-700/30 overflow-hidden">
      <LiveHeader tick={liveMarket} symbol={symbol || data.symbol} />

      <div className="px-3 py-2 border-b border-slate-700/25 bg-slate-800/15">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="w-[3px] h-5 rounded-full bg-gradient-to-b from-emerald-400 to-red-400 shrink-0" />
            <div>
              <div className="text-[12px] font-bold text-white tracking-tight">Zone Participant Intelligence</div>
              <div className="text-[8px] text-slate-500 mt-0.5">Candle volume + Live CE/PE OI at every structural zone</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {overallRotation && (
              <span className={`text-[8px] font-bold px-2 py-1 rounded border animate-pulse ${overallRotation.includes('BULL') ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-red-500/20 border-red-500/40 text-red-300'}`}>
                {overallRotation}
              </span>
            )}
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 font-bold text-[8px]">BUL {bullDominated}</span>
            <span className="px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/25 text-red-300 font-bold text-[8px]">BER {bearDominated}</span>
            <span className="text-[8px] text-slate-500">{activeZones} active</span>
            <button
              onClick={() => setShowOI(v => !v)}
              className={`text-[8px] px-1.5 py-0.5 rounded border font-bold transition-colors ${showOI ? 'bg-blue-500/15 border-blue-500/30 text-blue-300' : 'bg-slate-700/20 border-slate-600/25 text-slate-500'}`}
            >
              {showOI ? 'OI ON' : 'OI OFF'}
            </button>
          </div>
        </div>
      </div>

      <div className="p-2.5 space-y-2.5">
        {aboveZones.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="h-px flex-1 bg-red-500/15" />
              <span className="text-[8px] font-bold text-red-400/60 whitespace-nowrap tracking-wider">SUPPLY / RESISTANCE ({aboveZones.length})</span>
              <button
                onClick={() => setShowSupplyResistance(v => !v)}
                className="text-[8px] px-1.5 py-0.5 rounded border font-bold transition-colors bg-red-500/10 border-red-500/25 text-red-300 hover:bg-red-500/15"
                title={showSupplyResistance ? 'Hide supply/resistance' : 'Show supply/resistance'}
              >
                {showSupplyResistance ? 'HIDE' : 'SHOW'}
              </button>
              <div className="h-px flex-1 bg-red-500/15" />
            </div>
            {showSupplyResistance && (
              <div className="space-y-2">{aboveZones.slice(0, 7).map(z => <ZoneRow key={z.id} z={z} showOI={showOI} />)}</div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-violet-500/25" />
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-violet-500/10 border border-violet-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse shrink-0" />
            <span className="text-[9px] font-mono font-bold text-violet-300 tabular-nums">SPOT {fmtPrice(spot)}</span>
          </div>
          <div className="h-px flex-1 bg-violet-500/25" />
        </div>

        {belowZones.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="h-px flex-1 bg-emerald-500/15" />
              <span className="text-[8px] font-bold text-emerald-400/60 whitespace-nowrap tracking-wider">DEMAND / SUPPORT ({belowZones.length})</span>
              <button
                onClick={() => setShowDemandSupport(v => !v)}
                className="text-[8px] px-1.5 py-0.5 rounded border font-bold transition-colors bg-emerald-500/10 border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/15"
                title={showDemandSupport ? 'Hide demand/support' : 'Show demand/support'}
              >
                {showDemandSupport ? 'HIDE' : 'SHOW'}
              </button>
              <div className="h-px flex-1 bg-emerald-500/15" />
            </div>
            {showDemandSupport && (
              <div className="space-y-2">{belowZones.slice(0, 7).map(z => <ZoneRow key={z.id} z={z} showOI={showOI} />)}</div>
            )}
          </div>
        )}

        <div className="pt-1 border-t border-slate-700/15">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[7.5px] text-slate-600">
            <span>Bull vol = buyers defending zone</span>
            <span>Bear vol = sellers defending zone</span>
            <span>CE OI = call writers resistance</span>
            <span>PE OI = put writers support</span>
            <span className="text-emerald-500/60">PE-CE = bullish shift</span>
            <span className="text-red-500/60">CE-PE = bearish shift</span>
            <span>OI up = new positions fresh</span>
            <span>OI dn = closing positions weak</span>
          </div>
        </div>
      </div>
    </div>
  );
});
ZoneParticipants.displayName = 'ZoneParticipants';

export default ZoneParticipants;