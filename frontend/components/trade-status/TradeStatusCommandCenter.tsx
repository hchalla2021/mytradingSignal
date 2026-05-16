'use client';

import { useMemo, useState } from 'react';
import { useTradeStatusEngine } from '@/hooks/useTradeStatusEngine';
import type { TradeSymbol } from '@/types/trade-status';

type SignalTone = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

interface Props {
  activeSymbol: TradeSymbol;
}

function toneFromSignal(signal?: string): SignalTone {
  const v = (signal || 'NEUTRAL').toUpperCase();
  if (v.includes('BUY') || v.includes('BULL')) return 'BULLISH';
  if (v.includes('SELL') || v.includes('BEAR')) return 'BEARISH';
  return 'NEUTRAL';
}

function toneClass(tone: SignalTone): string {
  if (tone === 'BULLISH') return 'text-emerald-300';
  if (tone === 'BEARISH') return 'text-rose-300';
  return 'text-amber-300';
}

function badgeClass(tone: SignalTone): string {
  if (tone === 'BULLISH') return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200';
  if (tone === 'BEARISH') return 'border-rose-500/40 bg-rose-500/15 text-rose-200';
  return 'border-amber-500/40 bg-amber-500/15 text-amber-200';
}

function fmtSignal(signal?: string): string {
  if (!signal) return 'NEUTRAL';
  return signal.replace(/_/g, ' ');
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export default function TradeStatusCommandCenter({ activeSymbol }: Props): JSX.Element {
  const [density, setDensity] = useState<'compact' | 'expanded'>('compact');
  const [horizon, setHorizon] = useState<'intraday' | 'swing'>('intraday');
  const { data, loading, error, alerts } = useTradeStatusEngine({ symbol: activeSymbol, refreshIntervalMs: 2500 });

  const activeSnapshot = data?.symbols?.[activeSymbol];

  const engineState = useMemo(() => {
    const vix = data?.global.vix.value ?? 0;
    const fear = data?.global.vix.fear_score ?? 0;
    const bull = data?.global.breadth.bullish_count ?? 0;
    const bear = data?.global.breadth.bearish_count ?? 0;
    const neutral = data?.global.breadth.neutral_count ?? 0;
    const avgConfidence = data?.global.breadth.avg_confidence ?? 0;

    const breadthBias = bull - bear;
    const flowImbalance = (activeSnapshot?.buy_pressure ?? 50) - (activeSnapshot?.sell_pressure ?? 50);
    const regimeStrength = clamp(activeSnapshot?.regime_score ?? 0, 0, 100);
    const executionReadiness = clamp(Math.round((avgConfidence * (100 - fear)) / 100), 0, 100);

    const marketTone: SignalTone =
      breadthBias > 0 && flowImbalance >= 0 ? 'BULLISH' : breadthBias < 0 && flowImbalance < 0 ? 'BEARISH' : 'NEUTRAL';

    const stateLabel =
      marketTone === 'BULLISH'
        ? 'Risk-On Expansion'
        : marketTone === 'BEARISH'
          ? 'Risk-Off Distribution'
          : 'Balanced Two-Way Tape';

    return {
      vix,
      fear,
      bull,
      bear,
      neutral,
      avgConfidence,
      breadthBias,
      flowImbalance,
      regimeStrength,
      executionReadiness,
      marketTone,
      stateLabel,
    };
  }, [data, activeSnapshot]);

  const dynamicInsights = useMemo(() => {
    const insights: string[] = [];
    if (engineState.vix >= 22) insights.push('Volatility shock risk elevated. Favor strict risk caps and fast exits.');
    if (engineState.executionReadiness >= 65) insights.push('Execution readiness is high. Aggressive setups can be prioritized.');
    if (engineState.executionReadiness < 40) insights.push('Execution quality is low. Use selective entries and reduced size.');
    if (engineState.breadthBias > 0) insights.push('Market breadth is supportive. Momentum continuation setups are favored.');
    if (engineState.breadthBias < 0) insights.push('Breadth is defensive. Reversal traps and failed breakouts are likely.');
    if (engineState.flowImbalance > 0) insights.push('Buy-side pressure dominates current flow. Pullback-long structures improve.');
    if (engineState.flowImbalance < 0) insights.push('Sell-side pressure dominates current flow. Breakdown continuation risk remains.');
    return insights.slice(0, 4);
  }, [engineState]);

  const vixTone: SignalTone = (data?.global.vix.value || 0) >= 20 ? 'BEARISH' : (data?.global.vix.value || 0) >= 15 ? 'NEUTRAL' : 'BULLISH';
  const stateTone = toneClass(engineState.marketTone);

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-cyan-500/35 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4 sm:p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-cyan-300">Aegis Trade Status</p>
            <h2 className="text-xl font-semibold text-slate-100">Unified Institutional Market Status</h2>
            <p className="text-xs text-slate-400">Single product view for dynamic market condition, risk, execution quality, and trade posture.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Kpi label="VIX" value={data?.global.vix.value?.toFixed(2) || '--'} tone={toneClass(vixTone)} />
            <Kpi
              label="Market State"
              value={engineState.stateLabel}
              tone={stateTone}
            />
            <Kpi
              label="Execution"
              value={`${engineState.executionReadiness}`}
              tone="text-cyan-200"
            />
            <Kpi label="Status" value={loading ? 'SYNCING' : data?.meta.market_phase || 'LIVE'} tone={loading ? 'text-amber-300' : 'text-emerald-300'} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SelectPill
            label="Density"
            value={density}
            onChange={(value) => setDensity(value as 'compact' | 'expanded')}
            options={['compact', 'expanded']}
          />
          <SelectPill
            label="Horizon"
            value={horizon}
            onChange={(value) => setHorizon(value as 'intraday' | 'swing')}
            options={['intraday', 'swing']}
          />
          <div className="rounded-md border border-slate-700/80 bg-slate-900/80 px-2 py-1 text-[11px] text-slate-300">
            Breadth: BULL {engineState.bull} | BEAR {engineState.bear} | N {engineState.neutral}
          </div>
          <div className="rounded-md border border-slate-700/80 bg-slate-900/80 px-2 py-1 text-[11px] text-slate-300">
            Focus Lens: {fmtSignal(activeSnapshot?.regime || 'NEUTRAL')} | {fmtSignal(activeSnapshot?.signal || 'NEUTRAL')}
          </div>
        </div>
      </div>

      <div className={`grid grid-cols-1 gap-3 ${density === 'compact' ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
        <StatusTile
          title="Volatility Environment"
          value={`${engineState.vix.toFixed(2)} / 100`}
          subtitle={`${data?.global.vix.volatility_level || 'UNKNOWN'} volatility regime`}
          pct={engineState.vix}
          tone={vixTone}
        />
        <StatusTile
          title="Breadth Bias"
          value={`${engineState.breadthBias > 0 ? '+' : ''}${engineState.breadthBias}`}
          subtitle="Bull minus Bear participation"
          pct={clamp(50 + engineState.breadthBias * 15, 0, 100)}
          tone={engineState.breadthBias > 0 ? 'BULLISH' : engineState.breadthBias < 0 ? 'BEARISH' : 'NEUTRAL'}
        />
        <StatusTile
          title="Flow Imbalance"
          value={`${engineState.flowImbalance > 0 ? '+' : ''}${engineState.flowImbalance}%`}
          subtitle="Buy pressure minus sell pressure"
          pct={clamp(50 + engineState.flowImbalance, 0, 100)}
          tone={engineState.flowImbalance > 0 ? 'BULLISH' : engineState.flowImbalance < 0 ? 'BEARISH' : 'NEUTRAL'}
        />
        <StatusTile
          title="Regime Strength"
          value={`${engineState.regimeStrength}`}
          subtitle={fmtSignal(activeSnapshot?.regime || 'NEUTRAL')}
          pct={engineState.regimeStrength}
          tone={toneFromSignal(activeSnapshot?.regime)}
        />
        <StatusTile
          title="Execution Readiness"
          value={`${engineState.executionReadiness}`}
          subtitle={`${horizon.toUpperCase()} profile quality`}
          pct={engineState.executionReadiness}
          tone={engineState.executionReadiness >= 60 ? 'BULLISH' : engineState.executionReadiness < 40 ? 'BEARISH' : 'NEUTRAL'}
        />
        <StatusTile
          title="Risk Posture"
          value={activeSnapshot?.risk || 'MEDIUM'}
          subtitle={`Fear score ${engineState.fear}`}
          pct={engineState.fear}
          tone={engineState.fear >= 70 ? 'BEARISH' : engineState.fear <= 35 ? 'BULLISH' : 'NEUTRAL'}
        />
      </div>

      <div className="rounded-2xl border border-slate-700/60 bg-slate-950/75 p-3 sm:p-4">
        <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">Trade Status Zones</p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <ZoneCard
            label="Trend Continuation"
            status={engineState.executionReadiness >= 60 && engineState.breadthBias >= 0 ? 'ACTIVE' : 'CAUTION'}
            description="Momentum continuation quality and breakout viability."
            tone={engineState.executionReadiness >= 60 && engineState.breadthBias >= 0 ? 'BULLISH' : 'NEUTRAL'}
          />
          <ZoneCard
            label="Mean Reversion"
            status={engineState.vix < 16 && Math.abs(engineState.breadthBias) <= 1 ? 'ACTIVE' : 'LIMITED'}
            description="Range fade probability under balanced participation."
            tone={engineState.vix < 16 && Math.abs(engineState.breadthBias) <= 1 ? 'BULLISH' : 'NEUTRAL'}
          />
          <ZoneCard
            label="Volatility Shock"
            status={engineState.vix >= 22 ? 'ACTIVE' : 'STANDBY'}
            description="Shock-protection mode for rapid directional dislocations."
            tone={engineState.vix >= 22 ? 'BEARISH' : 'NEUTRAL'}
          />
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2">
          <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-amber-300">Realtime Alerts</p>
          <div className="flex flex-col gap-1">
            {alerts.slice(0, 3).map((alert) => (
              <div key={alert.id} className="rounded border border-amber-500/20 bg-slate-950/50 px-2 py-1 text-xs text-amber-100">
                <span className="font-semibold">{alert.symbol}</span> {alert.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {dynamicInsights.length > 0 && (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-2">
          <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-indigo-300">AI Context Feed</p>
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {dynamicInsights.map((insight) => (
              <div key={insight} className="rounded border border-indigo-500/20 bg-slate-950/50 px-2 py-1 text-xs text-indigo-100">
                {insight}
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          Engine degraded: {error}
        </div>
      )}
    </section>
  );
}

interface KpiProps {
  label: string;
  value: string;
  tone: string;
}

interface SelectPillProps {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}

interface StatusTileProps {
  title: string;
  value: string;
  subtitle: string;
  pct: number;
  tone: SignalTone;
}

interface ZoneCardProps {
  label: string;
  status: string;
  description: string;
  tone: SignalTone;
}

function Kpi({ label, value, tone }: KpiProps): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-700/70 bg-slate-900/70 px-3 py-2">
      <p className="text-[9px] uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className={`truncate text-sm font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

function StatusTile({ title, value, subtitle, pct, tone }: StatusTileProps): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-700/70 bg-slate-900/70 p-3">
      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{title}</p>
      <p className={`mt-1 text-lg font-semibold ${toneClass(tone)}`}>{value}</p>
      <p className="text-xs text-slate-400">{subtitle}</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full ${
            tone === 'BULLISH' ? 'bg-emerald-400' : tone === 'BEARISH' ? 'bg-rose-400' : 'bg-amber-400'
          }`}
          style={{ width: `${clamp(pct, 0, 100)}%` }}
        />
      </div>
    </div>
  );
}

function ZoneCard({ label, status, description, tone }: ZoneCardProps): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-700/70 bg-slate-900/70 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-200">{label}</p>
        <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${badgeClass(tone)}`}>{status}</span>
      </div>
      <p className="mt-1 text-xs text-slate-400">{description}</p>
    </div>
  );
}

function SelectPill({ label, value, options, onChange }: SelectPillProps): JSX.Element {
  return (
    <label className="flex items-center gap-2 rounded-md border border-slate-700/80 bg-slate-900/80 px-2 py-1 text-[11px] text-slate-300">
      <span className="uppercase tracking-[0.12em] text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bg-transparent text-[11px] font-semibold text-slate-100 outline-none"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option.toUpperCase()}
          </option>
        ))}
      </select>
    </label>
  );
}
