'use client';

import React, { memo, useMemo, useState } from 'react';
import { useExpiryExplosion, type ExpiryIndex, type ExpiryAction, type ExpiryPhase } from '@/hooks/useExpiryExplosion';
import SectionTitle from '@/components/SectionTitle';

// ── Helpers ──────────────────────────────────────────────────────────────────

const ACTION_CONFIG: Record<ExpiryAction, { label: string; color: string; bg: string; border: string; glow: string; icon: string }> = {
  STRONG_BUY:  { label: 'STRONG BUY',  color: 'text-emerald-300', bg: 'bg-emerald-500/20', border: 'border-emerald-400/60', glow: 'shadow-emerald-500/30', icon: '🟢' },
  BUY:         { label: 'BUY',         color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-400/40', glow: 'shadow-emerald-500/15', icon: '🟢' },
  NEUTRAL:     { label: 'NEUTRAL',     color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-400/40',   glow: 'shadow-amber-500/15',   icon: '🟡' },
  SELL:        { label: 'SELL',        color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-400/40',     glow: 'shadow-red-500/15',     icon: '🔴' },
  STRONG_SELL: { label: 'STRONG SELL', color: 'text-red-300',     bg: 'bg-red-500/20',     border: 'border-red-400/60',     glow: 'shadow-red-500/30',     icon: '🔴' },
};

const PHASE_CONFIG: Record<ExpiryPhase, { label: string; color: string; bg: string; intensity: string }> = {
  PRE_EXPIRY:     { label: 'Pre-Expiry',       color: 'text-slate-400',    bg: 'bg-slate-500/10',   intensity: 'LOW' },
  DAY_BEFORE:     { label: 'Day Before',        color: 'text-blue-400',     bg: 'bg-blue-500/10',    intensity: 'LOW' },
  EXPIRY_MORNING: { label: 'Expiry Morning',    color: 'text-cyan-400',     bg: 'bg-cyan-500/10',    intensity: 'MEDIUM' },
  GAMMA_ZONE:     { label: 'GAMMA ZONE',        color: 'text-amber-300',    bg: 'bg-amber-500/15',   intensity: 'HIGH' },
  EXPLOSION_ZONE: { label: 'EXPLOSION ZONE',    color: 'text-orange-300',   bg: 'bg-orange-500/20',  intensity: 'EXTREME' },
  FINAL_MINUTES:  { label: 'FINAL MINUTES',     color: 'text-red-300',      bg: 'bg-red-500/20',     intensity: 'MAX' },
  EXPIRED:        { label: 'Expired',            color: 'text-slate-500',    bg: 'bg-slate-500/5',    intensity: 'NONE' },
};

const SIGNAL_NAMES: Record<string, { label: string; icon: string }> = {
  gamma_exposure:     { label: 'Gamma Exposure',      icon: '⚡' },
  oi_concentration:   { label: 'OI Concentration',    icon: '🎯' },
  volume_surge:       { label: 'Volume Surge',        icon: '📊' },
  pcr_extreme:        { label: 'PCR Extreme',         icon: '📈' },
  delta_acceleration: { label: 'Delta Acceleration',  icon: '🚀' },
  iv_behavior:        { label: 'IV Behavior',         icon: '📉' },
  theta_decay:        { label: 'Theta Decay',         icon: '⏳' },
};

function formatNumber(n: number | undefined | null): string {
  if (n == null) return '—';
  if (Math.abs(n) >= 10_000_000) return (n / 10_000_000).toFixed(2) + ' Cr';
  if (Math.abs(n) >= 100_000) return (n / 100_000).toFixed(2) + ' L';
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toFixed(0);
}

function formatPrice(n: number | undefined | null): string {
  if (n == null || n === 0) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

// ── Signal Bar ──────────────────────────────────────────────────────────────

const SignalBar = memo<{ name: string; score: number; signal: string; label: string; weight: number; highlight?: boolean }>(
  ({ name, score, signal, label, weight, highlight }) => {
    const signalInfo = SIGNAL_NAMES[name] || { label: name, icon: '•' };
    const pct = Math.min(100, Math.abs(score) * 100);
    const isBull = score > 0;
    const barColor = score > 0.3 ? 'bg-emerald-500' : score > 0 ? 'bg-emerald-500/70' : score < -0.3 ? 'bg-red-500' : score < 0 ? 'bg-red-500/70' : 'bg-slate-500';
    const signalColor = signal === 'BULL' ? 'text-emerald-400' : signal === 'BEAR' ? 'text-red-400' : 'text-amber-400';

    return (
      <div className="py-1.5 border-b border-slate-700/30 last:border-b-0">
        <div className="flex items-center justify-between mb-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs">{signalInfo.icon}</span>
            <span className="text-[10px] sm:text-xs font-semibold text-slate-300 truncate">{signalInfo.label}</span>
            <span className="text-[9px] text-slate-500">({(weight * 100).toFixed(0)}%)</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`text-[10px] font-bold ${signalColor}`}>{signal}</span>
            <span className={`text-[10px] font-mono ${isBull ? 'text-emerald-400' : score < 0 ? 'text-red-400' : 'text-slate-400'}`}>
              {score > 0 ? '+' : ''}{score.toFixed(2)}
            </span>
          </div>
        </div>
        <div className="relative h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
          <div
            className={`absolute top-0 ${isBull ? 'left-1/2' : 'right-1/2'} h-full ${barColor} rounded-full`}
            style={{ width: `${pct / 2}%` }}
          />
          <div className="absolute top-0 left-1/2 w-px h-full bg-slate-500/60" />
        </div>
        <p className={`text-[9px] mt-0.5 truncate ${highlight && Math.abs(score) >= 0.3 ? (score > 0 ? 'text-emerald-300 bg-emerald-500/15 ring-1 ring-emerald-400/60 px-1.5 py-0.5 rounded font-bold shadow-sm shadow-emerald-500/25' : 'text-red-300 bg-red-500/15 ring-1 ring-red-400/60 px-1.5 py-0.5 rounded font-bold shadow-sm shadow-red-500/25') : 'text-slate-500'}`}>{label}</p>
      </div>
    );
  }
);
SignalBar.displayName = 'SignalBar';

// ── Expiry Card (one per index) ─────────────────────────────────────────────

const ExpiryCard = memo<{ data: ExpiryIndex | null; name: string }>(({ data, name }) => {
  const [showGammaExposure, setShowGammaExposure] = useState(false);
  if (!data) {
    return (
      <div className="rounded-2xl border border-slate-700/50 bg-gradient-to-br from-slate-800/60 to-slate-900/60 p-4">
        <div className="h-5 w-32 bg-slate-700/60 rounded mb-3" />
        <div className="h-12 w-full bg-slate-700/40 rounded-xl mb-3" />
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-3 bg-slate-700/30 rounded" />)}
        </div>
      </div>
    );
  }

  const actionCfg = ACTION_CONFIG[data.action] || ACTION_CONFIG.NEUTRAL;
  const phaseCfg = PHASE_CONFIG[data.expiryPhase] || PHASE_CONFIG.PRE_EXPIRY;
  const strike = data.strikeRecommendation;
  const breakout = data.breakoutLevels;
  const isLive = data.dataSource === 'LIVE';

  // ── Top-5 Trade Signal Highlights (field-level only) ──
  const isActivePhase = data.expiryPhase === 'GAMMA_ZONE' || data.expiryPhase === 'EXPLOSION_ZONE' || data.expiryPhase === 'FINAL_MINUTES';
  const isStrongAction = (data.action === 'STRONG_BUY' || data.action === 'STRONG_SELL') && data.confidence >= 60;
  const hlBull = 'ring-1 ring-emerald-400/70 bg-emerald-500/15 shadow-sm shadow-emerald-500/30 px-1.5 py-0.5 rounded';
  const hlBear = 'ring-1 ring-red-400/70 bg-red-500/15 shadow-sm shadow-red-500/30 px-1.5 py-0.5 rounded';
  const dirHl = data.direction === 'BULLISH' ? hlBull : data.direction === 'BEARISH' ? hlBear : '';

  // Determine card border glow based on action
  const cardBorder =
    data.action === 'STRONG_BUY' ? 'border-emerald-400/50 shadow-lg shadow-emerald-500/20' :
    data.action === 'BUY' ? 'border-emerald-500/30' :
    data.action === 'STRONG_SELL' ? 'border-red-400/50 shadow-lg shadow-red-500/20' :
    data.action === 'SELL' ? 'border-red-500/30' :
    'border-slate-600/40';

  // Confidence bar gradient
  const confColor = data.confidence >= 70 ? 'from-emerald-500 to-emerald-400' : data.confidence >= 40 ? 'from-amber-500 to-amber-400' : 'from-red-500 to-red-400';

  return (
    <div className={`rounded-2xl border ${cardBorder} bg-gradient-to-br from-slate-800/70 via-slate-900/70 to-slate-800/50 backdrop-blur-sm p-3 sm:p-4`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm sm:text-base font-bold text-white">{name}</h3>
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${isLive ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-600/30 text-slate-400 border border-slate-500/20'}`}>
            {isLive ? '● LIVE' : '○ CLOSED'}
          </span>
        </div>
        <span className={`text-lg font-mono font-bold px-2 py-0.5 rounded-lg border border-emerald-400/60 ${data.metrics.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          ₹{formatPrice(data.metrics.price)}
        </span>
      </div>

      {/* Action Badge + Confidence */}
      <div className={`rounded-xl ${actionCfg.bg} border ${actionCfg.border} p-2.5 mb-3 ${actionCfg.glow}`}>
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <span className="text-base">{actionCfg.icon}</span>
            <span className={`text-sm sm:text-base font-extrabold ${actionCfg.color} tracking-tight ${isStrongAction ? dirHl : ''}`}>
              {actionCfg.label}
            </span>
          </div>
          <span className={`text-xs font-mono font-bold ${actionCfg.color} ${isStrongAction ? dirHl : ''}`}>
            {data.confidence}%
          </span>
        </div>
        {/* Confidence bar */}
        <div className="h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
          <div
            className={`h-full bg-gradient-to-r ${confColor} rounded-full`}
            style={{ width: `${data.confidence}%` }}
          />
        </div>
      </div>

      {/* Expiry Phase + Dynamic Label */}
      <div className={`flex flex-col rounded-lg ${phaseCfg.bg} border border-slate-700/30 px-2.5 py-1.5 mb-3 gap-1`}>
        {/* Expiry Label: Weekly/Monthly + day */}
        <div className="flex items-center justify-between">
          <span className={`text-[9px] font-semibold tracking-wide ${data.isExpiryDay ? 'text-orange-300' : 'text-slate-400'}`}>
            {data.expiryLabel || (data.isExpiryDay ? '⚡ Expiry Today' : 'Weekly Expiry')}
            {data.isMonthlyExpiry && <span className="ml-1 text-[8px] px-1 py-0.5 bg-purple-500/20 text-purple-300 rounded border border-purple-400/30">MONTHLY</span>}
          </span>
          {data.expiryDate && (
            <span className="text-[9px] font-mono text-slate-500">{data.expiryDate}</span>
          )}
        </div>
        {/* Phase + Countdown */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs">⏰</span>
            <span className={`text-[10px] sm:text-xs font-bold ${phaseCfg.color} ${isActivePhase ? dirHl : ''}`}>
              {phaseCfg.label}
            </span>
            {phaseCfg.intensity === 'EXTREME' || phaseCfg.intensity === 'MAX' ? (
              <span className="text-[9px] px-1.5 py-0.5 bg-red-500/20 text-red-300 rounded-full font-bold border border-red-400/30">
                {phaseCfg.intensity}
              </span>
            ) : phaseCfg.intensity === 'HIGH' ? (
              <span className="text-[9px] px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded-full font-bold border border-amber-400/30">
                {phaseCfg.intensity}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-slate-400">Expiry in</span>
            <span className={`text-xs font-mono font-bold ${data.hoursToExpiry <= 4 ? 'text-red-400' : 'text-cyan-400'}`}>
              {data.hoursToExpiry <= 1 ? `${Math.round(data.hoursToExpiry * 60)}m` : `${data.hoursToExpiry.toFixed(1)}h`}
            </span>
          </div>
        </div>
      </div>

      {/* Strike Recommendation — Buyer Perspective Only */}
      {strike && strike.atmStrike > 0 && (
        <div className="rounded-lg bg-slate-800/60 border border-slate-600/30 p-2.5 mb-3">
          {/* Buyer Warning — Don't buy near/at expiry */}
          {strike.buyWarning && (
            <div className={`rounded-lg p-2 mb-2 border text-[10px] font-bold flex items-center gap-1.5 ${
              !strike.buyable
                ? 'bg-red-500/15 border-red-400/40 text-red-300'
                : 'bg-amber-500/10 border-amber-400/30 text-amber-300'
            }`}>
              <span>{!strike.buyable ? '⛔' : '⚠️'}</span>
              <span>{strike.buyWarning}</span>
            </div>
          )}
          {/* Best Trade Highlight — only show when buyable */}
          {strike.buyable !== false && (
          <div className={`rounded-lg p-2.5 mb-2.5 border ${data.direction === 'BULLISH' ? 'bg-emerald-500/10 border-emerald-400/40' : data.direction === 'BEARISH' ? 'bg-red-500/10 border-red-400/40' : 'bg-amber-500/10 border-amber-400/40'}`}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-xs">🎯</span>
              <span className="text-[10px] sm:text-xs font-bold text-white">Best Trade</span>
              <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-bold ${strike.optionType === 'CE' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30' : 'bg-red-500/20 text-red-300 border border-red-400/30'}`}>
                {strike.optionType}
              </span>
              {/* Premium source badge */}
              <span className={`text-[7px] px-1 py-0.5 rounded font-bold ml-auto ${strike.premiumSource === 'LIVE' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30' : 'bg-slate-600/30 text-slate-400 border border-slate-500/20'}`}>
                {strike.premiumSource === 'LIVE' ? '🟢 LIVE' : '⚡ EST'}
              </span>
            </div>
            {/* Full option name for verification */}
            {strike.fullOptionName && (
              <div className="mb-1.5 px-2 py-1 bg-slate-700/40 rounded border border-slate-600/20">
                <span className="text-[10px] sm:text-xs font-mono font-bold text-cyan-300 tracking-wide">
                  {strike.fullOptionName}
                </span>
                {strike.tradingSymbol && (
                  <span className="text-[8px] text-slate-500 ml-2 font-mono">({strike.tradingSymbol})</span>
                )}
              </div>
            )}
            {/* Trade expiry info */}
            {strike.tradeExpiry && (
              <div className={`flex items-center gap-1.5 mb-1.5 text-[9px] ${strike.isNextExpiry ? 'text-cyan-300' : 'text-slate-400'}`}>
                <span>📅</span>
                <span className="font-semibold">Expiry: {strike.tradeExpiry}</span>
                {strike.isNextExpiry && (
                  <span className="px-1 py-0.5 bg-cyan-500/15 text-cyan-300 rounded border border-cyan-400/30 text-[8px] font-bold">NEXT WEEK</span>
                )}
              </div>
            )}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-slate-400">Strike</span>
                <span className={`text-sm font-mono font-extrabold ${data.direction === 'BULLISH' ? 'text-emerald-400' : data.direction === 'BEARISH' ? 'text-red-400' : 'text-cyan-400'}`}>
                  {strike.entryStrike} {strike.optionType}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-slate-400">{strike.premiumSource === 'LIVE' ? 'Premium (Live)' : 'Est. Premium'}</span>
                <span className="text-xs font-mono font-bold text-purple-400">{strike.estimatedPremium}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-slate-400">Potential</span>
                <span className="text-xs font-bold text-amber-300">{strike.potential}</span>
              </div>
              <div className="pt-1.5 border-t border-slate-700/30 space-y-0.5">
                <p className="text-[9px] text-emerald-400/90">📈 {strike.targetLabel}</p>
                <p className="text-[9px] text-red-400/80">🛡️ {strike.stoplossLabel}</p>
              </div>
            </div>
          </div>
          )}

          {/* Strike Ladder — only show when buyable */}
          {strike.buyable !== false && strike.strikeLadder && strike.strikeLadder.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-xs">📊</span>
                <span className="text-[10px] sm:text-xs font-bold text-white">Strike Ladder ({strike.optionType})</span>
                <span className="text-[8px] text-slate-500 ml-auto">{strike.premiumSource === 'LIVE' ? '🟢 Live premiums' : 'ATR-based estimates'}</span>
              </div>
              <div className="overflow-hidden rounded-lg border border-slate-700/30">
                {/* Header */}
                <div className="grid grid-cols-4 gap-0 bg-slate-700/30 px-2 py-1">
                  <span className="text-[8px] font-bold text-slate-400">STRIKE</span>
                  <span className="text-[8px] font-bold text-slate-400 text-center">PREMIUM</span>
                  <span className="text-[8px] font-bold text-slate-400 text-center">POTENTIAL</span>
                  <span className="text-[8px] font-bold text-slate-400 text-right">STATUS</span>
                </div>
                {/* Rows */}
                {strike.strikeLadder.map((row, idx) => {
                  const isBest = row.status.includes('BEST');
                  const isLivePrem = row.premiumSource === 'LIVE';
                  const rowBg = isBest
                    ? (data.direction === 'BULLISH' ? 'bg-emerald-500/15' : data.direction === 'BEARISH' ? 'bg-red-500/15' : 'bg-amber-500/15')
                    : (idx % 2 === 0 ? 'bg-slate-800/30' : 'bg-slate-800/10');
                  return (
                    <div key={row.strike} className={`grid grid-cols-4 gap-0 px-2 py-1 ${rowBg} ${isBest ? 'ring-1 ring-inset ring-cyan-400/40' : ''}`}>
                      <span className={`text-[10px] font-mono font-bold ${isBest ? 'text-cyan-300' : 'text-slate-300'}`}>
                        {row.strike}
                      </span>
                      <span className={`text-[10px] font-mono text-center ${isLivePrem ? 'text-emerald-400' : 'text-purple-400'}`}>
                        {row.premiumLabel}
                        {isLivePrem && <span className="text-[7px] ml-0.5 text-emerald-500">●</span>}
                      </span>
                      <span className={`text-[10px] font-bold text-center ${row.potential2ATR >= 5 ? 'text-amber-300' : row.potential2ATR >= 2 ? 'text-amber-400' : 'text-slate-400'}`}>
                        {row.potential2ATR}x
                      </span>
                      <span className={`text-[9px] text-right ${isBest ? 'text-cyan-300 font-bold' : 'text-slate-500'}`}>
                        {row.status}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-[8px] text-slate-500 mt-1">★ = Best value (near ATM, good premium). {strike.premiumSource === 'LIVE' ? '🟢 Live premiums from Zerodha.' : 'Premiums estimated from ATR & time.'}</p>
            </div>
          )}
        </div>
      )}

      {/* Breakout Levels */}
      {breakout && breakout.support > 0 && (
        <div className="rounded-lg bg-slate-800/40 border border-slate-700/20 p-2.5 mb-3">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-xs">📐</span>
            <span className="text-[10px] sm:text-xs font-bold text-white">Breakout Levels</span>
          </div>
          {/* Visual price position bar */}
          <div className="relative h-6 bg-gradient-to-r from-red-900/30 via-slate-800/50 to-emerald-900/30 rounded-lg mb-2 overflow-hidden border border-slate-600/20">
            <div
              className="absolute top-0 h-full w-1 bg-cyan-400 shadow-lg shadow-cyan-400/50"
              style={{ left: `${Math.min(100, Math.max(0, breakout.pricePosition))}%` }}
            />
            <div className="absolute left-1 top-1/2 -translate-y-1/2 text-[8px] text-red-400 font-mono">
              S: {formatPrice(breakout.support)}
            </div>
            <div className="absolute right-1 top-1/2 -translate-y-1/2 text-[8px] text-emerald-400 font-mono">
              R: {formatPrice(breakout.resistance)}
            </div>
          </div>
          <div className="flex justify-between text-[9px]">
            <span className="text-slate-500">ATR: <span className="text-slate-300 font-mono">{breakout.atr.toFixed(1)}</span></span>
            <span className="text-slate-500">Range: <span className="text-slate-300 font-mono">{breakout.rangeWidth.toFixed(1)}</span></span>
            <span className="text-slate-500">Pos: <span className="text-cyan-400 font-mono">{breakout.pricePosition.toFixed(0)}%</span></span>
          </div>
        </div>
      )}

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        <div className="rounded-lg bg-slate-800/40 border border-slate-700/20 p-1.5 text-center">
          <span className="text-[9px] text-slate-500 block">PCR</span>
          <span className={`text-xs font-bold font-mono ${data.metrics.pcr && data.metrics.pcr > 1.2 ? 'text-emerald-400' : data.metrics.pcr && data.metrics.pcr < 0.8 ? 'text-red-400' : 'text-amber-400'}`}>
            {data.metrics.pcr ? data.metrics.pcr.toFixed(2) : '—'}
          </span>
        </div>
        <div className="rounded-lg bg-slate-800/40 border border-slate-700/20 p-1.5 text-center">
          <span className="text-[9px] text-slate-500 block">Call OI</span>
          <span className="text-xs font-bold font-mono text-red-400">{formatNumber(data.metrics.callOI)}</span>
        </div>
        <div className="rounded-lg bg-slate-800/40 border border-slate-700/20 p-1.5 text-center">
          <span className="text-[9px] text-slate-500 block">Put OI</span>
          <span className="text-xs font-bold font-mono text-emerald-400">{formatNumber(data.metrics.putOI)}</span>
        </div>
        <div className="rounded-lg bg-slate-800/40 border border-slate-700/20 p-1.5 text-center">
          <span className="text-[9px] text-slate-500 block">Total OI</span>
          <span className="text-xs font-bold font-mono text-cyan-400">{formatNumber(data.metrics.oi)}</span>
        </div>
        <div className="rounded-lg bg-slate-800/40 border border-slate-700/20 p-1.5 text-center">
          <span className="text-[9px] text-slate-500 block">Volume</span>
          <span className="text-xs font-bold font-mono text-purple-400">{formatNumber(data.metrics.volume)}</span>
        </div>
        <div className="rounded-lg bg-slate-800/40 border border-slate-700/20 p-1.5 text-center">
          <span className="text-[9px] text-slate-500 block">Change</span>
          <span className={`text-xs font-bold font-mono ${data.metrics.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {data.metrics.changePct >= 0 ? '+' : ''}{data.metrics.changePct.toFixed(2)}%
          </span>
        </div>
      </div>

      {/* Gamma Exposure (25%) and signal engine — collapsed by default */}
      <div className="rounded-lg bg-slate-800/30 border border-slate-700/20 p-2.5">
        <button
          type="button"
          onClick={() => setShowGammaExposure(v => !v)}
          className="w-full flex items-center gap-1.5"
        >
          <span className="text-xs">⚡</span>
          <span className="text-[10px] sm:text-xs font-bold text-white">Gamma Exposure (25%)</span>
          <span className="text-[9px] text-slate-500 ml-auto font-mono">
            Score: <span className={data.rawScore > 0 ? 'text-emerald-400' : data.rawScore < 0 ? 'text-red-400' : 'text-amber-400'}>
              {data.rawScore > 0 ? '+' : ''}{data.rawScore.toFixed(3)}
            </span>
          </span>
          <span className="text-[10px] text-slate-500">{showGammaExposure ? 'Hide' : 'Show'}</span>
        </button>

        {showGammaExposure && (
          <>
            <div className="mt-2">
              {Object.entries(data.signals).map(([key, sig]) => (
                <SignalBar
                  key={key}
                  name={key}
                  score={sig.score}
                  signal={sig.signal}
                  label={sig.label}
                  weight={sig.weight}
                  highlight={key === 'gamma_exposure' || key === 'volume_surge'}
                />
              ))}
            </div>

            {data.signals.gamma_exposure.extra && (
              <div className="mt-2 rounded-lg bg-gradient-to-br from-purple-900/20 to-slate-800/30 border border-purple-500/20 p-2">
                <div className="flex items-center gap-1 mb-1">
                  <span className="text-[10px]">⚡</span>
                  <span className="text-[9px] font-bold text-purple-300">Gamma Detail</span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[9px]">
                  <span className="text-slate-500">OI Imbalance</span>
                  <span className="text-slate-300 font-mono text-right">
                    {((data.signals.gamma_exposure.extra as Record<string, number>).netOIImbalance * 100)?.toFixed(1) ?? '—'}%
                  </span>
                  <span className="text-slate-500">OI Velocity</span>
                  <span className="text-slate-300 font-mono text-right">
                    {(data.signals.gamma_exposure.extra as Record<string, number>).oiVelocity?.toFixed(1) ?? '—'}%
                  </span>
                  <span className="text-slate-500">Time Multiplier</span>
                  <span className={`font-mono text-right ${((data.signals.gamma_exposure.extra as Record<string, number>).timeMultiplier ?? 1) >= 2 ? 'text-red-400 font-bold' : 'text-slate-300'}`}>
                    {(data.signals.gamma_exposure.extra as Record<string, number>).timeMultiplier?.toFixed(1) ?? '—'}x
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Expiry Day Badge */}
      {data.isExpiryDay && (
        <div className="mt-2 text-center">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-orange-600/20 to-red-600/20 border border-orange-400/30 rounded-full">
            <span className="text-xs">💥</span>
            <span className="text-[10px] font-extrabold text-orange-300 tracking-wider">EXPIRY DAY ACTIVE</span>
            <span className="text-xs">💥</span>
          </span>
        </div>
      )}
    </div>
  );
});
ExpiryCard.displayName = 'ExpiryCard';

// ── Main Component ──────────────────────────────────────────────────────────

const ExpiryExplosionZone = memo(() => {
  const { expiryData, isConnected } = useExpiryExplosion();

  // Any index on expiry day?
  const anyExpiry = useMemo(() => {
    for (const sym of ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const) {
      if (expiryData[sym]?.isExpiryDay) return true;
    }
    return false;
  }, [expiryData]);

  // Fixed section styling — no dynamic color swaps that cause flashing
  const sectionBorder = 'border-purple-500/30';
  const sectionBg = 'from-purple-950/20 via-dark-card/50 to-dark-elevated/40';
  const sectionGlow = 'shadow-md';

  return (
    <div className={`mt-6 sm:mt-6 border-2 ${sectionBorder} rounded-2xl p-3 sm:p-4 bg-gradient-to-br ${sectionBg} backdrop-blur-sm ${sectionGlow}`}>
      <div className="flex flex-col gap-1 mb-3 sm:mb-4">
        <SectionTitle
          title="Expiry Explosion Zone"
          subtitle="Weekly: NIFTY(Tue) • BANKNIFTY(Wed) • SENSEX(Thu) | Monthly: Last Tue | Holiday-Aware"
          accentColor="purple"
          badge={
            <span className="relative inline-flex items-center px-2 py-0.5 text-[9px] font-bold bg-gradient-to-r from-purple-600/80 to-pink-600/80 rounded-md shadow-lg border border-purple-400/30 whitespace-nowrap leading-none">
              <span className="relative z-10 inline-flex items-center gap-0.5">
                <span>💥</span>
                <span className="bg-gradient-to-r from-white via-purple-100 to-white bg-clip-text text-transparent font-extrabold">EXPIRY ENGINE</span>
              </span>
            </span>
          }
          rightContent={
            <div className="flex items-center gap-2">
              {anyExpiry && (
                <span className="text-[9px] px-2 py-0.5 bg-gradient-to-r from-orange-500/20 to-red-500/20 text-orange-300 rounded-full font-bold border border-orange-400/30">
                  ⚡ EXPIRY DAY
                </span>
              )}
              <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 shadow-sm shadow-emerald-500' : 'bg-red-500'}`} />
            </div>
          }
        />
      </div>

      {/* Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3 sm:gap-4">
        <ExpiryCard data={expiryData.NIFTY} name="NIFTY 50" />
        <ExpiryCard data={expiryData.BANKNIFTY} name="BANK NIFTY" />
        <ExpiryCard data={expiryData.SENSEX} name="SENSEX" />
      </div>

      {/* Bottom Legend */}
      <div className="mt-3 pt-2 border-t border-slate-700/30">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[9px] text-slate-500">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> Strong Buy
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500/60" /> Buy
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500" /> Neutral
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500/60" /> Sell
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500" /> Strong Sell
          </span>
          <span className="text-slate-600">|</span>
          <span>⚡ Gamma • 🎯 OI • 📊 Vol • 📈 PCR • 🚀 Delta • 📉 IV • ⏳ Theta</span>
        </div>
      </div>
    </div>
  );
});
ExpiryExplosionZone.displayName = 'ExpiryExplosionZone';

export default ExpiryExplosionZone;
