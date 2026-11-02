'use client';

import { memo, type ReactNode } from 'react';
import { aqteCanExit, aqteControllerCurrent, aqteLabel, aqteLiveMetrics, aqteOverview, aqtePrice, aqteSigned, isAqteRuleChecks,
  type AQTELiveState, type AQTEExitRequest, type AQTESignal, type AQTESymbol, type AQTEStyle,
  type AQTERuleEvidence } from '@/lib/aqte-display';

const timeFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const clock = (seconds: number | null | undefined) =>
  seconds && Number.isFinite(seconds) ? timeFormatter.format(new Date(seconds * 1000)) : '--';
const toneOf = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? 'aqx-flat' : value > 0 ? 'aqx-up' : value < 0 ? 'aqx-down' : 'aqx-flat';
const titleCase = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();

type Tone = 'up' | 'down' | 'wait' | 'flat';
type Intelligence = NonNullable<AQTESignal['intelligence']>;
type Observation = Intelligence['live'];
type EngineRow = {
  id: string; label: string; value: string; note?: string;
  tone?: Tone; unavailable?: boolean;
  summary?: { label: string; value: string };
  gate?: AQTERuleEvidence['checks'][number];
};
const quantity = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '--' : value.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const signedQuantity = (value: number) => `${value > 0 ? '+' : ''}${quantity(value)}`;
const oiPercent = (value: number) => `${value > 0 ? '+' : ''}${value.toLocaleString('en-IN', {
  minimumFractionDigits: 2, maximumFractionDigits: 6,
})}%`;

function engineChecks(info: Intelligence | null | undefined, market: Observation | null, style: AQTEStyle | undefined,
  evidence: AQTERuleEvidence | null): EngineRow[] {
  const compactLabels = {
    supertrend: 'SuperTrend', ema: style === 'swing' ? 'EMA stack' : 'EMA 9/20',
    vwap: 'VWAP', rsi: 'RSI', imbalance: 'Book imbalance', oi_change: 'OI change (1m)', volume: 'Volume',
  };
  if (!info) return Object.entries(compactLabels).map(([id, label]) => ({
    id, label, value: 'Current evidence unavailable', unavailable: true, summary: { label, value: '--' },
  }));
  const imbalance = market ? info.imbalance : null;
  const totalDepth = market ? market.buy_depth + market.sell_depth : 0;
  const share = market && totalDepth > 0 ? market.buy_depth / totalDepth * 100 : null;
  const periods = style === 'swing' ? ['9', '20', '50', '100', '200'] : ['9', '20'];
  const vwapSide = info.vwap == null ? 'Unavailable' : info.close > info.vwap ? 'Above' : info.close < info.vwap ? 'Below' : 'At';
  const oiChange = !market ? 'Live depth/OI unavailable' : market.oi == null ? 'Not supplied by Kite' :
    market.oi_change == null ? 'Waiting for a completed-minute OI reference' :
      `${signedQuantity(market.oi_change)} (${market.oi_change_pct == null ? 'zero reference; no percentage' : oiPercent(market.oi_change_pct)})`;
  const compactOi = market?.oi == null ? 'Unavailable' : market.oi_change == null ? 'Baseline pending' :
    market.oi_change_pct == null ? signedQuantity(market.oi_change) : oiPercent(market.oi_change_pct);
  const rows: EngineRow[] = [
    { id: 'supertrend', label: 'SuperTrend (14, 3)', value: `${titleCase(info.supertrend)} · ${aqtePrice(info.supertrend_price)}`,
      tone: info.supertrend === 'BULLISH' ? 'up' : info.supertrend === 'BEARISH' ? 'down' : 'wait',
      summary: { label: compactLabels.supertrend, value: titleCase(info.supertrend) } },
    { id: 'structure', label: 'Structure (20 candles)', value: titleCase(info.structure.replaceAll('_', ' ')) },
    { id: 'ema', label: `EMA ${periods.join(' / ')}`, value: periods.map(n => `${n}: ${aqtePrice(info.ema[n])}`).join(' · '),
      summary: { label: compactLabels.ema, value: 'Unverified' } },
    { id: 'vwap', label: 'VWAP (session)', value: info.vwap == null ? 'Unavailable (no session volume)' :
      `${vwapSide} ${aqtePrice(info.vwap)}`,
      tone: vwapSide === 'Above' ? 'up' : vwapSide === 'Below' ? 'down' : vwapSide === 'At' ? 'wait' : 'flat',
      summary: { label: compactLabels.vwap, value: vwapSide } },
    { id: 'rsi', label: 'RSI (14)', value: aqtePrice(info.rsi), summary: { label: compactLabels.rsi, value: aqtePrice(info.rsi) } },
    { id: 'imbalance', label: 'Book imbalance (top 5)', value: imbalance == null ? 'Live depth unavailable' :
      `${imbalance > 0 ? 'Buy-side' : imbalance < 0 ? 'Sell-side' : 'Balanced'} ${aqteSigned(imbalance * 100)}%`,
      tone: imbalance == null ? 'flat' : imbalance > 0 ? 'up' : imbalance < 0 ? 'down' : 'wait',
      summary: { label: compactLabels.imbalance, value: imbalance == null ? 'Unavailable' :
        `${imbalance > 0 ? 'Buy' : imbalance < 0 ? 'Sell' : 'Balanced'} ${aqteSigned(imbalance * 100)}%` } },
    { id: 'buy_depth', label: 'Buyer depth share', value: share == null ? '--' : `${aqtePrice(share)}% · ${quantity(market?.buy_depth)}` },
    { id: 'sell_depth', label: 'Seller depth share', value: share == null ? '--' : `${aqtePrice(100 - share)}% · ${quantity(market?.sell_depth)}` },
    { id: 'oi', label: 'Futures OI (Kite)', value: !market ? 'Live depth/OI unavailable' :
      market.oi == null ? 'Not supplied by Kite' : quantity(market.oi) },
    { id: 'oi_change', label: 'OI change', value: oiChange,
      summary: { label: compactLabels.oi_change, value: compactOi },
      note: market?.oi_reference_at != null ? `vs completed-minute OI ${quantity(market.oi_reference)} at ${clock(market.oi_reference_at)} IST` : undefined },
    { id: 'volume', label: 'Relative volume (20)', value: info.volume_ratio == null ? 'Unavailable (no volume baseline)' : `${aqtePrice(info.volume_ratio)}×`,
      summary: { label: compactLabels.volume, value: info.volume_ratio == null ? 'Unavailable' : `${aqtePrice(info.volume_ratio)}×` },
      note: info.volume != null && info.average_volume != null ? `Closed minute ${quantity(info.volume)} / prior average ${aqtePrice(info.average_volume)}` : undefined },
    { id: 'breakout', label: '20-candle breakout', value: info.breakout === 1 ? 'Above prior high' : info.breakout === -1 ? 'Below prior low' : 'No breakout',
      note: info.breakout_high != null && info.breakout_low != null ? `Prior high ${aqtePrice(info.breakout_high)} · low ${aqtePrice(info.breakout_low)}` : undefined },
    { id: 'extension', label: 'ATR (14) / EMA20 gap', value: `${aqtePrice(info.atr)} / ${info.atr > 0 ?
      `${aqtePrice(Math.abs(info.close - info.ema['20']) / info.atr)} ATR` : 'Unavailable'}` },
  ];
  if (style === 'swing') rows.push({ id: 'cpr', label: 'Previous-day spot CPR', value: info.cpr ?
    `${aqtePrice(info.cpr.bottom)} - ${aqtePrice(info.cpr.top)} (spot context)` : 'Unavailable' });
  return rows.map(row => {
    const gate = evidence?.checks.find(check => check.id === row.id);
    return { ...row, gate, summary: row.id === 'ema' && row.summary ? {
      ...row.summary, value: !gate ? 'Unverified' : gate.passed === true ? 'Aligned' : gate.passed === false ? 'Not aligned' : 'No bias',
    } : row.summary };
  });
}

function Check({ tone }: { tone: Tone }) {
  return <span aria-hidden="true" className={`aqx-check aqx-check-${tone}`}>{tone === 'up' ? '✓' : tone === 'down' || tone === 'wait' ? '!' : '•'}</span>;
}

function EngineCheck({ check, compact = false }: { check: EngineRow; compact?: boolean }) {
  const display = compact ? check.summary : check;
  if (!display) return null;
  const status = check.unavailable ? 'UNAVAILABLE' : !check.gate ? 'CONTEXT' :
    check.gate.passed === true ? 'PASS' : check.gate.passed === false ? 'FAIL' : 'UNAVAILABLE';
  const tone: Tone = status === 'PASS' ? 'up' : status === 'FAIL' ? 'wait' : 'flat';
  const valueTone = check.unavailable ? 'flat' : check.tone ?? tone;
  return <li data-rule={check.id} data-status={status}
    title={[check.value, check.gate?.requirement, check.note].filter(Boolean).join(' · ')}>
    <Check tone={tone} /><span className="aqx-check-label">{display.label}:</span>
    {compact ? <span className="sr-only">{status === 'FAIL' ? 'Not aligned' : status === 'CONTEXT' ? 'Context' :
      status === 'PASS' ? 'Aligned' : 'Unverified'}.</span> :
      <span className={`aqx-evidence-state aqx-${tone}`}>{status === 'FAIL' ? 'WAIT' : status === 'CONTEXT' ? 'INFO' : status === 'UNAVAILABLE' ? 'N/A' : status}</span>}
    <strong className={`${compact ? 'aqx-compact-value' : 'aqx-evidence-value'} aqx-${valueTone}`}>{display.value}</strong>
    {!compact && check.note && <small className="aqx-evidence-note">{check.note}</small>}
  </li>;
}

function Row({ label, children, tone = '', extra }: { label: string; children: ReactNode; tone?: string; extra?: ReactNode }) {
  return (
    <div className="aqx-price-row">
      <dt>{label}</dt>
      <dd className={tone}>{children}{extra}</dd>
    </div>
  );
}

function AQTETerminal({ symbol, signal, unavailable, liveStatus, onExit, now = Date.now() / 1000 }: {
  symbol: AQTESymbol; signal?: AQTESignal; unavailable: boolean; liveStatus?: AQTELiveState | null;
  onExit?: (request: AQTEExitRequest) => void; now?: number;
}) {
  const { info } = aqteOverview(signal, 'real', unavailable, now);
  const currentStatus = aqteControllerCurrent(liveStatus, now);
  const style = currentStatus ? liveStatus?.styles?.[symbol] : undefined;
  const plan = style === 'scalp' ? signal?.scalp : style === 'swing' ? signal : undefined;
  const observation = info?.live;
  const market = observation && [observation.at, observation.received].every(at => now - at >= -1 && now - at <= 5)
    ? observation : null;
  const evidence = info && market && style && isAqteRuleChecks(signal?.rule_checks) ? signal.rule_checks[style] : null;
  const direction = evidence?.side === 'CE' ? 'BULLISH' : evidence?.side === 'PE' ? 'BEARISH' : 'WAITING';
  const live = liveStatus?.active?.symbol === symbol ? liveStatus.active : null;
  const metrics = live ? aqteLiveMetrics(liveStatus, now) : null;
  const filled = !!live && live.filled > 0;
  const confirmed = currentStatus && !liveStatus?.error && !live?.error && !!live?.protection_confirmed;
  const trailing = !!live?.trailing_active && confirmed;
  const trailR = live?.trail_start_r ?? 1;
  const points = metrics?.points ?? null;
  const span = live ? points != null && points < 0 ? live.entry_price - live.initial_stop : live.target - live.entry_price : 0;
  const progress = points != null && span > 0 ? Math.min(1, Math.abs(points) / span) : 0;
  const targetHit = metrics?.bid != null && !!live && metrics.bid >= live.target;
  const checks = engineChecks(info, market, style, evidence);
  const score = evidence && plan?.decision !== 'WAIT' && plan?.confidence != null && Number.isFinite(plan.confidence) &&
    plan.confidence >= 0 && plan.confidence <= 100 ? plan.confidence : null;
  const evidenceUnavailable = !info ? signal && signal.feed_ready === undefined ?
    'Backend freshness unavailable; update the backend before trusting these values.' :
    'Waiting for current backend evidence: fresh spot/futures and completed candles.' :
    !market ? 'Live depth/OI unavailable; current tick evidence is required for entry checks.' : null;
  const alignment = !info ? signal && signal.feed_ready === undefined ? 'Backend freshness unavailable' : 'Current evidence unavailable' :
    !style ? 'Entry style unavailable' : !market ? 'Live depth/OI unavailable' :
    `${style === 'scalp' ? 'Quick scalp' : 'Swing'}${evidence ? evidence.side ?
      ` · ${evidence.side} · ${evidence.checks.filter(check => check.passed === true).length}/${evidence.checks.length} aligned` :
      ' · WAIT' : ' · Unverified'}`;
  const alignmentTone: Tone = !info || !market || !style || !evidence ? 'flat' :
    !evidence.side || plan?.decision === 'WAIT' ? 'wait' : evidence.side === 'CE' ? 'up' : 'down';
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
  const automationWaiting = currentStatus && !automation && liveStatus?.automation_wanted && !liveStatus.killed;
  const note = liveStatus?.entry_note?.startsWith(`${symbol}:`) ? liveStatus.entry_note.slice(symbol.length + 1).trim() : null;
  const readinessReasons = plan?.reasons ?? (signal?.decision === 'WAIT' ? signal.reasons : undefined);
  const waitingReason = !currentStatus ? 'Live controller status unavailable; entry state unverified' :
    liveStatus?.error ? liveStatus.error :
    liveStatus?.killed ? 'Emergency stop latched; new entries blocked' :
    !automation && !automationWaiting ? 'Auto Trade OFF; new entries blocked' :
    automationWaiting ? liveStatus?.automation_waiting || 'Waiting for daily preflight and arming' :
    unavailable ? 'Current signal data unavailable; do not assume an entry is ready' :
    liveStatus?.entry_blocks?.[symbol] ? liveStatus.entry_blocks[symbol] :
    readinessReasons?.length ? `${plan && style === 'scalp' ? 'Quick scalp · ' : plan && style === 'swing' ? 'Swing · ' : ''}${readinessReasons.join(' · ')}` :
      'Waiting for a qualifying CE/PE setup and live quality, risk and broker checks';
  const warmup = !unavailable ? signal?.warmup : undefined;
  const opening = !unavailable ? signal?.opening : undefined;
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
              <span className={`aqx-chip ${automation ? 'aqx-chip-auto' : ''}`}>{!currentStatus ? 'AUTO UNKNOWN' : automation ? 'AUTO ON' : automationWaiting ? 'AUTO WAITING' : 'ENTRIES OFF'}</span>
            </> : (
              <span className={`aqx-chip ${direction === 'BULLISH' ? 'aqx-chip-buy' : direction === 'BEARISH' ? 'aqx-chip-sell' : ''}`}>
                {direction === 'WAITING' ? 'NO CONFIRMED BIAS' : `${evidence?.side} BIAS`}
              </span>
            )}
          </div>
        </div>
        {(live?.error || liveStatus?.error) && (
          <p role="alert" className="aqx-footnote aqx-down">{live?.error || liveStatus?.error}</p>
        )}
        {!live && (
          <p role="status" aria-label="Entry readiness" className="aqx-footnote">
            {waitingReason}
            {warmup && warmup.completed < warmup.required && (
              <span> · Warm-up: {warmup.completed}/{warmup.required} consecutive completed futures candles</span>
            )}
            {warmup && warmup.completed >= warmup.required && opening && opening.completed < opening.required && (
              <span> · Opening range: {opening.completed}/{opening.required} one-minute candles since 09:15 IST</span>
            )}
            {automation && note && <span> · Last entry check: {note}</span>}
          </p>
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
        </div>
        <p className="aqx-footnote">P&amp;L uses executable sell bid and estimated fees; return % is before fees.</p>
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
        <section className="aqx-card aqx-engine" aria-label="Rule-Based Trade Engine">
          <h4 className="aqx-panel-title"><span className="aqx-badge-ai" aria-hidden="true">R</span>Rule-Based Trade Engine</h4>
          <p className={`aqx-evidence-summary aqx-${alignmentTone}`} aria-label="Rule alignment" title={evidenceUnavailable ?? alignment}>
            {alignment}
          </p>
          <ul className="aqx-check-list aqx-check-compact" aria-label="Key trading indicators">
            {checks.filter(check => check.summary).map(check => <EngineCheck key={check.id} check={check} compact />)}
            <li data-rule="score" data-status="CONTEXT"><Check tone="flat" /><span className="aqx-check-label">Rule score:</span>
              <strong className="aqx-pill">{score != null ? `${aqtePrice(score)} / 100` : '--'}</strong></li>
          </ul>
          <details className="aqx-evidence-details" aria-label="Advanced rule details">
            <summary>Advanced details</summary>
            <div className="aqx-evidence-body" role="region" aria-label="Advanced rule evidence" tabIndex={0}>
              {evidenceUnavailable && <p className="aqx-empty">{evidenceUnavailable}</p>}
              {info && <p className="aqx-evidence-source">
                Closed 1m candle {clock(info.at + 60)} IST · close {aqtePrice(info.close)}
                <br />{market ? `Live futures tick ${clock(market.at)} IST · LTP ${aqtePrice(market.price)}` : 'Live depth/OI unavailable'}
              </p>}
              {info && <ul className="aqx-check-list" aria-label="Detailed trading indicators">
                {checks.map(check => <EngineCheck key={check.id} check={check} />)}
              </ul>}
              {evidence && <>
                <h5 className="aqx-evidence-title">Automatic-entry requirements</h5>
                <ul className="aqx-evidence-rules">{evidence.checks.map(check =>
                  <li key={check.id}><strong>{check.label}:</strong> {check.requirement}</li>)}</ul>
              </>}
              <p className="aqx-footnote">Green buy/bullish · Rose sell/bearish · Amber wait · Muted unavailable/context. Icons show entry-check alignment, not a buy or sell instruction.</p>
              <p className="aqx-footnote">Unvalidated futures rules · No ML order decisions · Not a win probability. Alignment and score are not order approval; liquidity, risk and broker gates still apply. Depth shares are queued quantities, not traded buyer/seller volume. Futures OI is context, not validated option-chain OI.</p>
            </div>
          </details>
          <p className="aqx-footnote">Unvalidated rules · Not a win probability.</p>
        </section>
        <section className="aqx-card aqx-exit-rules" aria-label="Auto exit rules">
          <h4 className="aqx-panel-title"><span aria-hidden="true" className="aqx-target-icon">◎</span>Auto Exit Rules
            <span className={`aqx-exit-state ${managing ? 'aqx-exit-state-on' : ''}`}>{!currentStatus ? 'UNKNOWN' : managing ? 'ACTIVE' : live ? 'VERIFY' : 'WAITING'}</span></h4>
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
