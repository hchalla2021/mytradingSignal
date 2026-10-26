'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { useOrderFlow } from '@/hooks/useOrderFlow';
import { isCashSession, type ChartSymbol } from '@/lib/chart-workspace';
import {
  DEFAULT_DELTA_CONFIG, DELTA_INTERVALS, deltaStrength, sanitizeDeltaConfig,
  type DeltaState, type DeltaStrengthConfig,
} from '@/lib/delta-strength';
import { compactVolume } from '@/lib/order-flow';
import type { ProDecision } from '@/lib/pro-confluence';
import styles from './DeltaStrength.module.css';

const CONFIG_KEY = 'deltaStrengthConfig_v1';
// Delta alone is pressure, never an order: BUY / SELL text comes only from the pro confirmation gate.
const VIEW: Record<DeltaState, { label: string; tone: string }> = {
  BUYERS: { label: 'Buyer pressure', tone: styles.wait },
  SELLERS: { label: 'Seller pressure', tone: styles.wait },
  SIDEWAYS: { label: 'Sideways', tone: styles.wait },
  UNAVAILABLE: { label: 'Delta unavailable', tone: styles.na },
};

type Feed = 'live' | 'delayed' | 'stale' | 'session' | 'closed' | 'waiting';
const FEED_TEXT: Record<Feed, string> = {
  live: 'Live', delayed: 'Delayed', stale: 'Stale', session: 'Last session', closed: 'Market closed', waiting: 'Connecting',
};

const signedQty = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${compactVolume(Math.abs(value))}`;

/**
 * One compact Live Delta Strength box for the selected index's near-month future: delta value + BUY / SELL / WAIT.
 * Recomputed on every order-flow update; memoized so ticks never re-render the chart around it.
 */
const DeltaStrengthBox = memo(function DeltaStrengthBox({ symbol, active, decision }: {
  symbol: ChartSymbol; active: boolean; decision: ProDecision;
}) {
  const [config, setConfig] = useState<DeltaStrengthConfig>(DEFAULT_DELTA_CONFIG);
  useEffect(() => {
    try { setConfig(sanitizeDeltaConfig(JSON.parse(localStorage.getItem(CONFIG_KEY) ?? 'null'))); } catch { /* defaults */ }
  }, []);
  const update = (patch: Partial<DeltaStrengthConfig>) => setConfig(current => {
    const next = sanitizeDeltaConfig({ ...current, ...patch });
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  });

  const flow = useOrderFlow(symbol, config.interval, null, active, true);
  const snapshot = flow.snapshot?.available ? flow.snapshot : null;
  const feed = useFeed(snapshot?.lastTick ?? null, flow.live, snapshot?.latestRecorded ?? false, flow.snapshot !== null || flow.error !== null);
  const canSignal = active && !flow.error && (feed === 'live' || feed === 'delayed') && flow.live;
  // Last shown state per index/config drives hysteresis; re-evaluating with it is idempotent.
  const previous = useRef<{ key: string; state: DeltaState | null }>({ key: '', state: null });
  const key = `${symbol}:${JSON.stringify(config)}`;
  if (previous.current.key !== key) previous.current = { key, state: null };
  const result = deltaStrength(snapshot?.bars ?? [], config, canSignal ? previous.current.state : null);
  previous.current.state = canSignal ? result.state : null;

  const pressure = !canSignal && result.state !== 'UNAVAILABLE'
    ? { label: flow.error ? 'Feed error' : !flow.live ? 'Disconnected' : FEED_TEXT[feed], tone: styles.na }
    : VIEW[result.state];
  const entry = canSignal && decision.stage === 'ENTRY';
  const view = {
    ...pressure,
    action: entry ? (decision.action === 'BUY' ? '🟢 BUY' : '🔴 SELL') : decision.stage === 'HOLD' ? `🔵 ${decision.headline}` : '🟡 WAIT',
    tone: entry ? (decision.action === 'BUY' ? styles.buy : styles.sell) : pressure.tone,
  };
  const reason = flow.error ?? (snapshot ? canSignal ? result.reason : 'Recorded delta is shown for reference only; fresh live data is required for BUY / SELL.'
    : (feed === 'waiting' ? 'Connecting to the order-flow stream…'
    : 'No order flow recorded yet — it is recorded from live Kite ticks during market hours (09:15–15:30 IST).'));
  const detail = [
    `${symbol} futures (near-month) · ${config.interval}m candles × ${config.window} rolling window`,
    `${view.action} — Pro gate: ${decision.reason}`,
    `Delta: ${view.label} — ${reason}`,
    result.delta !== null ? `Delta (est.): ${signedQty(result.delta)} · ${result.deltaPct?.toFixed(1)}% of classified volume` : null,
    result.strength !== null ? `Weighted strength: ${result.strength.toFixed(1)}% (call at ±${config.threshold}%)` : null,
    result.cvd !== null ? `Session CVD (est.): ${signedQty(result.cvd)}` : null,
    `Feed: ${FEED_TEXT[feed]}. Delta = aggressive buy − sell volume; aggressor side ESTIMATED (Lee-Ready) — Kite publishes no trade-level side.`,
  ].filter(Boolean).join('\n');

  return <div className={`${styles.box} ${view.tone}`} role="status" aria-live="polite" aria-label={detail} title={detail}>
    <span className={styles.head}>Δ FUT Delta <em>est.</em><i className={styles[feed]} aria-hidden="true" /></span>
    <b className={styles.value}>{result.delta === null ? '—' : signedQty(result.delta)}</b>
    <span className={styles.action}>{view.action}</span>
    <span className={styles.label}>{view.label}{result.strength !== null && ` ${result.strength > 0 ? '+' : ''}${result.strength.toFixed(0)}%`}</span>
    <details className={styles.settings} onClick={event => event.stopPropagation()}>
      <summary aria-label="Delta settings" title="Delta settings">⚙</summary>
      <div className={styles.menu}>
        <label>Candle
          <select value={config.interval} onChange={event => update({ interval: Number(event.target.value) as DeltaStrengthConfig['interval'] })}>
            {DELTA_INTERVALS.map(item => <option key={item} value={item}>{item}m</option>)}
          </select></label>
        <label>Rolling window (candles)
          <input type="number" min={2} max={30} value={config.window} onChange={event => update({ window: Number(event.target.value) })} /></label>
        <label>Strength threshold %
          <input type="number" min={2} max={60} value={config.threshold} onChange={event => update({ threshold: Number(event.target.value) })} /></label>
        <label>Min coverage %
          <input type="number" min={0} max={100} step={5} value={Math.round(config.minCoverage * 100)}
            onChange={event => update({ minCoverage: Number(event.target.value) / 100 })} /></label>
        <label>Min volume × typical
          <input type="number" min={0} max={3} step={0.1} value={config.minVolumeRatio} onChange={event => update({ minVolumeRatio: Number(event.target.value) })} /></label>
        <label>Hold call down to × threshold
          <input type="number" min={0.2} max={1} step={0.05} value={config.hysteresis} onChange={event => update({ hysteresis: Number(event.target.value) })} /></label>
        <button type="button" onClick={() => update(DEFAULT_DELTA_CONFIG)}>Reset</button>
        <p>These settings tune the buyer / seller pressure reading only. BUY / SELL is shown only when the pro gate confirms every
          check (trend, VWAP, 15m &amp; 60m, candle, 5m delta &amp; CVD, OI, risk, room) on a closed 5m candle; otherwise WAIT.
          Unclassified volume is never assigned a side.</p>
      </div>
    </details>
  </div>;
});

export default DeltaStrengthBox;

/** Feed state with its own 1s clock (only this box re-renders). */
function useFeed(lastTick: number | null, live: boolean, latestRecorded: boolean, loaded: boolean): Feed {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!loaded) return 'waiting';
  if (latestRecorded) return 'session';
  if (!isCashSession(now)) return 'closed';
  const age = lastTick === null ? Infinity : now / 1000 - lastTick;
  if (!Number.isFinite(age) || age < 0) return 'stale';
  if (live && age <= 3) return 'live';
  return age <= 20 ? 'delayed' : 'stale';
}
