'use client';

import { memo, useRef, useState } from 'react';
import { API_CONFIG } from '@/lib/api-config';
import { getOrCreateVisitorId } from '@/lib/visitor-id';
import { notifyAppAccessExpired } from '@/lib/app-access-events';
import { aqteControllerCurrent, aqteErrorText, isAqteLiveState, type AQTELiveState, type AQTESymbol } from '@/lib/aqte-display';

const metric = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '--';
const shown = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? String(value) :
  typeof value === 'string' ? value : '--';

const phases = [
  { start: 540, end: 547, time: '09:00–09:07', title: 'Capture the open setup' },
  { start: 547, end: 555, time: '09:07–09:15', title: 'Lock snapshot · verify feed' },
  { start: 555, end: Infinity, time: '09:15+', title: 'Live open · risk-gated entries' },
];

function istMinute(now: number) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(now * 1000));
  const hour = Number(parts.find(part => part.type === 'hour')?.value);
  const minute = Number(parts.find(part => part.type === 'minute')?.value);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : -1;
}

function AQTEMorningEngine({ status, symbol, onStatus, now = Date.now() / 1000 }: {
  status: AQTELiveState | null; symbol: AQTESymbol; onStatus: (value: AQTELiveState) => void; now?: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changing = useRef(false);
  const current = aqteControllerCurrent(status, now);
  const morning = current ? status?.morning : null;
  const signal = morning?.signals[symbol];
  const fresh = !!signal && now - signal.at >= 0 && now - signal.at <= 3;
  const minute = istMinute(now);
  const gateReason = !morning ? 'Morning status unavailable; no approval state is assumed.' :
    morning.block ?? (status?.style_checks?.[symbol]?.morning ?? signal?.reasons?.[0] ?? 'Waiting for fresh opening evidence.');
  const entryState = !morning ? 'STATUS CHECK' : morning.error ? 'RECORDING CHECK' :
    morning.block ? 'WAITING · LIVE CHECKS' :
      !morning.enabled ? 'APPROVAL REQUIRED' : !status?.automation_on ? 'AUTOMATION REQUIRED' :
        status.style_checks?.[symbol]?.morning ? 'RISK CHECK' :
          fresh && signal?.decision !== 'WAIT' ? 'SETUP QUALIFIED' : 'WAITING FOR SETUP';
  const act = async (enabled: boolean) => {
    if (changing.current) return;
    changing.current = true;
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(API_CONFIG.endpoint('/api/aqte/live/morning'), {
        method: 'POST', credentials: 'include', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Device-Id': getOrCreateVisitorId(),
          'X-AQTE-Intent': 'manual-live-control' },
        body: JSON.stringify({ enabled, confirmation: enabled ? 'ENABLE MORNING REAL TRADING' : 'STOP MORNING ENTRIES' }),
      });
      const value: unknown = await response.json();
      if (!response.ok) {
        if (response.status === 401) notifyAppAccessExpired();
        const detail = value && typeof value === 'object' && 'detail' in value ? value.detail : null;
        throw new Error(typeof detail === 'string' ? detail : 'Morning approval failed; verify status before retrying.');
      }
      if (!isAqteLiveState(value) || !aqteControllerCurrent(value) || value.morning?.enabled !== enabled) {
        throw new Error('Morning approval was not confirmed. Refresh status; do not assume it changed.');
      }
      onStatus(value);
      setConfirming(false);
    } catch (cause) {
      setError(aqteErrorText(cause, 'Morning approval unavailable'));
    } finally {
      clearTimeout(timeout);
      changing.current = false;
      setBusy(false);
    }
  };
  return <section className="aqx-morning-board" aria-label="Independent Morning Trade Engine">
    <div className="flex flex-wrap justify-between gap-3">
      <div className="aqx-morning-heading">
        <span className="aqx-morning-kicker">AQTE · OPENING PLAYBOOK</span>
        <h3>Morning Edge</h3>
      </div>
      <button type="button" className={`aqx-morning-toggle ${morning?.enabled ? 'is-enabled' : ''}`} disabled={busy || !morning || (!morning.enabled && (!morning.storage_configured || !!morning.error))}
        onClick={() => morning?.enabled ? void act(false) : setConfirming(true)}>
        {busy ? 'Saving…' : !morning ? 'Status unavailable' : morning.enabled ? 'Stop morning entries' : 'Enable morning'}
      </button>
    </div>
    <ol className="aqx-morning-timeline" aria-label="Morning session timeline">
      {phases.map(phase => {
        const active = minute >= phase.start && minute < phase.end;
        const complete = minute >= phase.end;
        return <li key={phase.start} className={active ? 'is-active' : complete ? 'is-complete' : ''} aria-current={active ? 'step' : undefined}>
          <span className="aqx-morning-time">{phase.time} IST</span>
          <strong>{phase.title}</strong>
        </li>;
      })}
    </ol>
    <p className="aqx-morning-summary">From 09:15 · Compare fresh CE/PE spread, volume and OI; route only the best eligible contract through risk checks.</p>
    {confirming && <div role="alert" className="space-y-2 text-amber-200">
      <p>Approve Morning Edge real one-lot entries? Auto Trade, preflight, risk and broker checks still apply. Trades and profits are not guaranteed.</p>
      <button type="button" className="aqx-morning-confirm" disabled={busy || !morning?.storage_configured || !!morning.error} onClick={() => void act(true)}>Confirm morning approval</button>
      <button type="button" className="aqx-morning-cancel" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
    </div>}
    {error && <p role="alert" className="text-red-300">{error}</p>}
    <div className="aqx-morning-state" role="status" aria-live="polite">
      <span>Entry status</span><strong>{entryState}</strong>
    </div>
    {morning && <details className="aqx-morning-diagnostics">
      <summary>Feed &amp; data diagnostics</summary>
      <p>{morning.storage_backend === 'sqlite-wal' ? 'SQLite WAL' : 'PostgreSQL'} · {morning.error || (morning.last_commit ? 'Recording active' : 'Awaiting first commit')}
        {' · '}Queue {morning.queue_size}/{morning.queue_capacity}</p>
      {morning.captured_ticks && <p>Observed packets — Spot {morning.captured_ticks.spot ?? 0} · Futures {morning.captured_ticks.future ?? 0} · Options {morning.captured_ticks.option ?? 0}</p>}
      <p>Opening rules are deterministic and not paper-validated; no profit is guaranteed.</p>
      <p>Existing position cards show broker-observed P&amp;L, stop and target. Protection continues after 10:30 and after morning approval is switched OFF.</p>
    </details>}
    <details className="aqx-morning-reason">
      <summary>Why this status?</summary>
      <p>{gateReason}</p>
    </details>
    <details className="aqx-morning-signal">
      <summary>{symbol} · Signal details</summary>
      {fresh && signal ? <>
      <p>{signal.reasons.join(' · ')}</p>
      <ul>{signal.rules.map(rule => <li key={rule.id}>{rule.passed ? 'Confirmed' : 'Waiting'}: {rule.label} — {rule.reason}</li>)}</ul>
      {signal.evidence && <dl className="grid grid-cols-2 gap-2 text-xs">
        <dt>Move / ATR / path efficiency</dt><dd>{metric(signal.evidence.move)} / {metric(signal.evidence.atr)} / {metric(signal.evidence.efficiency)}</dd>
        <dt>Observed VWAP / depth imbalance</dt><dd>{metric(signal.evidence.observed_tick_vwap)} / {metric(typeof signal.evidence.imbalance === 'number' ? signal.evidence.imbalance * 100 : null)}%</dd>
        <dt>Option bid / ask / volume / OI</dt><dd>{(() => {
          const option = signal.evidence?.option as Record<string, unknown> | undefined;
          return option ? `${shown(option.bid)} / ${shown(option.ask)} / ${shown(option.volume)} / ${shown(option.oi)}` : 'Unavailable';
        })()}</dd>
        {(() => {
          const flow = signal.evidence?.order_flow as Record<string, unknown> | undefined;
          if (!flow) return null;
          return <><dt>Futures order-flow sample</dt><dd>{flow.fresh === true ? 'Fresh' : `Stale (${shown(flow.age_seconds)}s)`} · Spread {shown(flow.mean_spread)} · Estimated buy/sell/unclassified
            {` ${shown(flow.estimated_buy_aggressor_volume)} / ${shown(flow.estimated_sell_aggressor_volume)} / ${shown(flow.unclassified_volume)}`}</dd>
            <dt>Best futures bid / ask · 5-level imbalance</dt><dd>{shown(flow.best_bid)} / {shown(flow.best_ask)} · {metric(
              typeof flow.five_level_depth_imbalance === 'number' ? flow.five_level_depth_imbalance * 100 : null)}%
              {' · '}{Array.isArray(flow.depth_zones) ? flow.depth_zones.filter(zone => zone.side === 'ask').length : 0} large ask / {
              Array.isArray(flow.depth_zones) ? flow.depth_zones.filter(zone => zone.side === 'bid').length : 0} bid zones</dd>
            <dt>OI / minute change / cumulative volume</dt><dd>{shown(flow.oi)} / {shown(flow.oi_change_this_minute)} / {shown(flow.cumulative_volume)}
              {flow.aggressor_side_is_estimated ? ' · aggressor side estimated' : ''}</dd></>;
        })()}
      </dl>}
      </> : <p>{signal?.reasons?.join(' · ') || 'Waiting for fresh opening evidence.'}</p>}
    </details>
  </section>;
}

export default memo(AQTEMorningEngine);
