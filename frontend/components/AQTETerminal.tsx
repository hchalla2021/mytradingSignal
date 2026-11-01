'use client';

import { memo, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { aqteCanExit, aqteControllerCurrent, aqteLabel, aqteLiveMetrics, aqteOverview, aqtePrice, aqteSigned,
  type AQTELiveState, type AQTEExitRequest, type AQTESignal, type AQTESymbol } from '@/lib/aqte-display';
import type { MarketTick } from '@/hooks/useMarketSocket';

const Chart = dynamic(() => import('@/components/AQTEChart'), {
  ssr: false, loading: () => <div className="aqte-terminal-card aqte-chart-loading">Loading price chart…</div>,
});

const timeFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const clock = (seconds: number | null | undefined) =>
  seconds && Number.isFinite(seconds) ? timeFormatter.format(new Date(seconds * 1000)) : '--';
const toneOf = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? 'aqx-flat' : value > 0 ? 'aqx-up' : value < 0 ? 'aqx-down' : 'aqx-flat';
const titleCase = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();

type Tone = 'up' | 'down' | 'flat';
type Intelligence = NonNullable<AQTESignal['intelligence']>;

function engineChecks(info: Intelligence | null | undefined): Array<{ label: string; value: string; tone: Tone }> {
  if (!info) return [];
  const ema9 = info.ema['9'];
  const ema20 = info.ema['20'];
  const imbalance = info.imbalance;
  const depthShare = imbalance != null && Number.isFinite(imbalance) && Math.abs(imbalance) <= 1
    ? (imbalance + 1) * 50 : null;
  return [
    { label: 'Trend', value: `${titleCase(info.supertrend)} · ${titleCase(info.structure.replaceAll('_', ' '))}`,
      tone: info.supertrend === 'BULLISH' ? 'up' : info.supertrend === 'BEARISH' ? 'down' : 'flat' },
    { label: 'EMA 9 / 20', value: ema9 == null || ema20 == null ? '--' : ema9 > ema20 ? 'Bullish (9 > 20)' : ema9 < ema20 ? 'Bearish (9 < 20)' : 'Flat',
      tone: ema9 == null || ema20 == null || ema9 === ema20 ? 'flat' : ema9 > ema20 ? 'up' : 'down' },
    { label: 'VWAP', value: info.vwap == null ? '--' : info.close >= info.vwap ? 'Above' : 'Below',
      tone: info.vwap == null ? 'flat' : info.close >= info.vwap ? 'up' : 'down' },
    { label: 'RSI', value: aqtePrice(info.rsi), tone: info.rsi >= 55 ? 'up' : info.rsi <= 45 ? 'down' : 'flat' },
    { label: 'Order flow', value: imbalance == null ? '--' : imbalance > 0.1 ? `Buyers ${aqteSigned(imbalance * 100)}%` : imbalance < -0.1 ? `Sellers ${aqteSigned(imbalance * 100)}%` : 'Balanced',
      tone: imbalance == null ? 'flat' : imbalance > 0.1 ? 'up' : imbalance < -0.1 ? 'down' : 'flat' },
    { label: 'Buyer depth share', value: depthShare == null ? '--' : `${aqtePrice(depthShare)}%`, tone: depthShare != null && depthShare > 55 ? 'up' : 'flat' },
    { label: 'Seller depth share', value: depthShare == null ? '--' : `${aqtePrice(100 - depthShare)}%`, tone: depthShare != null && depthShare < 45 ? 'down' : 'flat' },
    { label: 'OI change', value: '-- (not provided)', tone: 'flat' },
    { label: 'Volume', value: `${aqtePrice(info.volume_ratio)}×`, tone: info.volume_ratio >= 1.5 ? 'up' : 'flat' },
  ];
}

function Check({ tone }: { tone: Tone }) {
  return <span aria-hidden="true" className={`aqx-check aqx-check-${tone}`}>{tone === 'up' ? '✓' : tone === 'down' ? '!' : '•'}</span>;
}

function Row({ label, children, tone = '', extra }: { label: string; children: ReactNode; tone?: string; extra?: ReactNode }) {
  return (
    <div className="aqx-price-row">
      <dt>{label}</dt>
      <dd className={tone}>{children}{extra}</dd>
    </div>
  );
}

function AQTETerminal({ symbol, signal, unavailable, active, tick, liveStatus, onExit }: {
  symbol: AQTESymbol; signal?: AQTESignal; unavailable: boolean;
  active: boolean; tick: MarketTick | null; liveStatus?: AQTELiveState | null;
  onExit?: (request: AQTEExitRequest) => void;
}) {
  // Once opened, the chart stays mounted so returning to this tab is instant.
  const [chartOpened, setChartOpened] = useState(active);
  if (active && !chartOpened) setChartOpened(true);
  const { info, direction } = aqteOverview(signal, 'real', unavailable);
  const live = liveStatus?.active?.symbol === symbol ? liveStatus.active : null;
  const currentStatus = aqteControllerCurrent(liveStatus);
  const metrics = live ? aqteLiveMetrics(liveStatus) : null;
  const filled = !!live && live.filled > 0;
  const confirmed = currentStatus && !liveStatus?.error && !live?.error && !!live?.protection_confirmed;
  const trailing = !!live?.trailing_active && confirmed;
  const trailR = live?.trail_start_r ?? 1;
  const points = metrics?.points ?? null;
  const span = live ? points != null && points < 0 ? live.entry_price - live.initial_stop : live.target - live.entry_price : 0;
  const progress = points != null && span > 0 ? Math.min(1, Math.abs(points) / span) : 0;
  const targetHit = metrics?.bid != null && !!live && metrics.bid >= live.target;
  const checks = engineChecks(info);
  const score = info && signal?.confidence != null && Number.isFinite(signal.confidence) &&
    signal.confidence >= 0 && signal.confidence <= 100 ? signal.confidence : null;
  const exitReason = live?.exit_requested;
  const remaining = live ? Math.max(0, live.filled - (live.exited ?? 0)) : 0;
  const canExit = !!live && !!onExit && aqteCanExit(liveStatus) && !exitReason;
  const requestExit = (action: AQTEExitRequest['action']) => {
    if (canExit && live) onExit?.({ tradeId: live.id, contract: live.contract.trading_symbol, quantity: remaining, action });
  };
  const steps: Array<[string, string, boolean]> = [
    ['Signal', clock(live?.signal_at), !!live?.signal_at],
    ['Order Placed', live?.entry_id ? live.entry_ack_at ? clock(live.entry_ack_at) : 'Acknowledged' : '--', !!live?.entry_id],
    ['Entry Filled', filled ? clock(live.fill_at) : '--', filled],
    ['SL Protected', confirmed ? `₹${aqtePrice(live.stop)}` : '--', confirmed],
    ['Trailing Active', trailing ? `₹${aqtePrice(live.stop)}` : '--', trailing],
    ['Exit', exitReason ? `Requested · ${exitReason.replaceAll('_', ' ')}` : '(Waiting)', false],
  ];
  const current = exitReason ? steps.length - 1 : steps.findIndex(step => !step[2]);
  const status = !currentStatus ? live ? 'POSITION UNVERIFIED' : 'STATUS UNAVAILABLE' :
    !live ? 'WAITING FOR SIGNAL' : exitReason ? 'EXIT REQUESTED' :
      live.error || liveStatus?.error ? 'CHECK KITE' : filled ? 'LIVE TRADE' : 'ORDER PENDING';
  const ring = 2 * Math.PI * 52;
  const automation = currentStatus && liveStatus?.automation_on && !liveStatus.killed;
  const managing = currentStatus && filled && !!metrics && !liveStatus?.error;
  const prefix = `aqte-terminal-${symbol}`;
  return (
    <div className="aqte-terminal aqx-main">
      <article className="aqx-card aqx-hero" id={`${prefix}-overview`} aria-label={`${aqteLabel(symbol)} live trade`}>
        <div className="aqx-hero-head">
          <div className="min-w-0">
            <p className={`aqx-status ${status === 'LIVE TRADE' ? 'aqx-status-live' : live ? 'aqx-status-pending' : ''}`}>
              <span aria-hidden="true" />{status}
            </p>
            <h4 className="aqx-contract">{live ? live.contract.trading_symbol : `${aqteLabel(symbol)} · ${currentStatus ? 'No AQTE trade' : 'Position status unverified'}`}</h4>
          </div>
          <div className="aqx-chips">
            {live ? <>
              <span className="aqx-chip aqx-chip-buy">BUY</span>
              <span className={`aqx-chip ${automation ? 'aqx-chip-auto' : ''}`}>{!currentStatus ? 'AUTO UNKNOWN' : automation ? 'AUTO ON' : 'ENTRIES OFF'}</span>
            </> : (
              <span className={`aqx-chip ${direction === 'BULLISH' ? 'aqx-chip-buy' : direction === 'BEARISH' ? 'aqx-chip-sell' : ''}`}>
                {direction === 'WAITING' ? 'NO BIAS' : direction}
              </span>
            )}
          </div>
        </div>
        {(live?.error || liveStatus?.error) && (
          <p role="alert" className="aqx-footnote aqx-down">{live?.error || liveStatus?.error}</p>
        )}
        <div className="aqx-hero-grid">
          <dl className="aqx-price-list" aria-label="Trade prices">
            <Row label="Entry" tone="aqx-white">{filled ? `₹${aqtePrice(live.entry_price)}` : live ? `Limit ₹${aqtePrice(live.limit)}` : '--'}</Row>
            <Row label="LTP" tone={toneOf(points)} extra={points != null && points !== 0 ? <span aria-hidden="true"> {points > 0 ? '↗' : '↘'}</span> : null}>
              {metrics?.ltp != null ? `₹${aqtePrice(metrics.ltp)}` : '--'}
            </Row>
            <Row label="Stop Loss (SL)" tone="aqx-down" extra={live ? <small>Initial level</small> : null}>
              {live ? `₹${aqtePrice(live.initial_stop)}` : '--'}
            </Row>
            <Row label="Trailing SL (TSL)" tone="aqx-cyan" extra={live ? <small>{confirmed ? 'Broker-confirmed SL' : 'Protection unverified'}</small> : null}>
              {trailing ? <><span aria-hidden="true">🔒 </span>₹{aqtePrice(live.stop)}</> :
                live?.trailing_active ? `Last ₹${aqtePrice(live.stop)}` : live ? `From +${trailR}R` : '--'}
            </Row>
          </dl>
          <div className="aqx-ring" aria-label="Open profit and loss">
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle cx="60" cy="60" r="52" className="aqx-ring-track" />
              <circle cx="60" cy="60" r="52" className={`aqx-ring-value ${points != null && points < 0 ? 'aqx-ring-loss' : ''}`}
                strokeDasharray={ring} strokeDashoffset={ring * (1 - progress)} />
            </svg>
            <div className="aqx-ring-text">
              <span>Open P&amp;L</span>
              <strong className={toneOf(points)}>{aqteSigned(points)} pts</strong>
              <em className={toneOf(metrics?.net_pnl)}>{metrics?.net_pnl != null ? `₹${aqteSigned(metrics.net_pnl)}` : '--'}</em>
              <b className={toneOf(metrics?.return_pct)}>{metrics?.return_pct != null ? `${aqteSigned(metrics.return_pct)}%` : '--'}</b>
            </div>
          </div>
          <div className="aqx-side-boxes">
            <section className="aqx-mini" aria-label="Targets">
              <h5>Targets</h5>
              <p className="aqx-target"><Check tone={targetHit ? 'up' : 'flat'} /><span>T1</span><strong>{live ? `₹${aqtePrice(live.target)}` : '--'}</strong></p>
              {targetHit && <p className="aqx-hit">Bid reached · not a fill</p>}
              {['T2', 'T3'].map(target => <p key={target} className="aqx-target aqx-flat"><Check tone="flat" /><span>{target}</span><strong title="Staged targets are not configured">--</strong></p>)}
              <p className="aqx-footnote">One full-position target; T2/T3 not configured.</p>
            </section>
            <section className="aqx-mini" aria-label="Position">
              <h5>Position</h5>
              <p className="aqx-position-line"><span>{filled && live.contract.lot_size ? `${aqtePrice(remaining / live.contract.lot_size)} lots` : '1 lot max'}</span><span>Qty: {filled ? remaining : '--'}</span></p>
              <p className="aqx-footnote">Peak bid: {live && live.peak > 0 ? `₹${aqtePrice(live.peak)}` : '--'}</p>
            </section>
          </div>
          <div className="aqx-chart" id={`${prefix}-market`}>
            {chartOpened ? <Chart symbol={symbol} tick={tick} /> : <div className="aqte-terminal-card aqte-chart-loading">Chart opens with this index tab.</div>}
          </div>
        </div>
        <p className="aqx-footnote">P&amp;L uses executable sell bid and estimated fees; return % is before fees. Chart shows the underlying index, not this option.</p>
        {live?.modify?.order_type === 'SL' && <p role="status" className="aqx-warning">Trailing request ₹{aqtePrice(live.modify.trigger_price)} awaits broker confirmation. Last confirmed SL: ₹{aqtePrice(live.stop)}.</p>}
        {live && !confirmed && <p role="status" className="aqx-warning">{exitReason ? 'Exit requested, not yet filled. Verify execution in Kite.' : 'Broker protection is unverified. Inspect Kite; do not assume the planned stop is active.'}</p>}
        {filled && !metrics && <p role="status" className="aqx-warning">Current quote/P&amp;L unavailable. Last-known trade levels are retained; verify in Kite.</p>}
        {!live && liveStatus?.active && <p role="status" className="aqx-warning">AQTE is managing {aqteLabel(liveStatus.active.symbol)} in its own index tab.</p>}
        <div className="aqx-actions">
          {[25, 50, 75].map(percent => (
            <button key={percent} type="button" className="aqx-action aqx-action-book" disabled aria-describedby={`${prefix}-booking-note`}>
              <span><strong>Book {percent}%</strong><small>Unavailable · 1 lot</small></span>
            </button>
          ))}
          <button type="button" className="aqx-action aqx-action-book-all" disabled={!canExit} onClick={() => requestExit('book')}>
            <span><strong>Book All</strong><small>Selected AQTE trade</small></span>
          </button>
          <div className={`aqx-action aqx-action-trail ${trailing ? 'aqx-action-on' : ''}`} aria-label="Trailing stop status">
            <span aria-hidden="true">🔒</span>
            <span><strong>Trail &amp; Hold</strong><small>{trailing ? 'Broker-confirmed' : live ? `Auto at +${trailR}R` : 'Auto after entry'}</small></span>
          </div>
          <button type="button" className="aqx-action aqx-action-exit" disabled={!canExit} onClick={() => requestExit('exit')}>
            <span aria-hidden="true">⏻</span>
            <span><strong>{exitReason ? 'Exit Requested' : 'Exit Now'}</strong><small>Selected trade only</small></span>
          </button>
        </div>
        <p id={`${prefix}-booking-note`} className="aqx-footnote">25%/50%/75% booking needs multiple whole lots and is unavailable in this one-lot pilot. Trail &amp; Hold shows automatic status, not a manual order.</p>
        <ol className="aqx-timeline" aria-label="Trade lifecycle">
          {steps.map(([label, detail, done], index) => (
            <li key={label} className={done ? 'aqx-step-done' : index === current && !!live ? 'aqx-step-current' : ''}>
              <span aria-hidden="true" className="aqx-step-dot">{done ? '✓' : index === steps.length - 1 ? '⚑' : ''}</span>
              <strong>{label}</strong>
              <small>{detail}</small>
            </li>
          ))}
        </ol>
      </article>
      <aside className="aqx-aside" id={`${prefix}-risk`}>
        <section className="aqx-card aqx-engine" aria-label="AI Trade Engine">
          <h4 className="aqx-panel-title"><span className="aqx-badge-ai" aria-hidden="true">AI</span>AI Trade Engine</h4>
          {checks.length ? <ul className="aqx-check-list">
            {checks.map(check => (
              <li key={check.label}><Check tone={check.tone} /><span>{check.label}:</span><strong className={`aqx-${check.tone}`}>{check.value}</strong></li>
            ))}
            <li><Check tone={score != null ? 'up' : 'flat'} /><span>Rule score:</span>
              <strong className="aqx-pill">{score != null ? `${aqtePrice(score)} / 100` : '--'}</strong></li>
          </ul> : <p className="aqx-empty">{unavailable ? 'Waiting for current backend evidence' : 'No live intelligence yet'}</p>}
          <p className="aqx-footnote">Explainable futures rules · Depth shares are not traded buyer/seller volume · Not a win probability</p>
        </section>
        <section className="aqx-card aqx-exit-rules" aria-label="Auto exit rules">
          <h4 className="aqx-panel-title"><span aria-hidden="true" className="aqx-target-icon">◎</span>Auto Exit Rules
            <span className={`aqx-toggle ${managing ? 'aqx-toggle-on' : ''}`}>{!currentStatus ? 'UNKNOWN' : managing ? 'ACTIVE' : live ? 'VERIFY' : 'WAITING'}</span></h4>
          <ul className="aqx-rule-list">
            <li><Check tone={confirmed ? 'up' : 'flat'} /><span>Broker SL order</span><b>{confirmed ? `₹${aqtePrice(live?.stop)}` : 'Unverified'}</b></li>
            <li><Check tone={trailing ? 'up' : 'flat'} /><span>Trailing SL</span><b>+{trailR}R</b></li>
            <li><Check tone={managing ? 'up' : 'flat'} /><span>Target exit</span><b>{live ? `₹${aqtePrice(live.target)}` : 'Bid ≥ T1'}</b></li>
            <li><Check tone={managing ? 'up' : 'flat'} /><span>Session exit</span><b>15:25 IST</b></li>
            <li><Check tone={managing ? 'up' : 'flat'} /><span>Daily loss</span><b>{liveStatus ? `₹${aqtePrice(liveStatus.limits.daily_loss)}` : '--'}</b></li>
            <li><Check tone={confirmed ? 'up' : 'flat'} /><span>Stale quote</span><b>Retain SL</b></li>
          </ul>
          <p className="aqx-footnote">Protective management continues with Auto Trade OFF. Broker fills are not guaranteed.</p>
          <details className="aqx-unavailable-rules">
            <summary>Additional image rules · Not enabled</summary>
            <p>Seller spikes, OI drops, EMA reversals, VWAP breaks and RSI exits are not execution rules in this pilot.</p>
          </details>
        </section>
      </aside>
    </div>
  );
}

export default memo(AQTETerminal);
