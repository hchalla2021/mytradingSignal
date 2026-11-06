'use client';

import { memo, type ReactNode } from 'react';
import { AQTE_SETUP_LABELS, aqteCanExit, aqteControllerCurrent, aqteEffectiveSignal, aqteEvidenceWait, aqteIndexHold, aqteIstDay, aqteLabel,
  aqteLiveMetrics, aqteOverview, aqtePrice, aqteRuleEvidence, aqteSigned, aqteTrailStart,
  type AQTELiveState, type AQTEExitRequest, type AQTESignal, type AQTESymbol, type AQTEEntrySource,
  type AQTERuleEvidence } from '@/lib/aqte-display';

const timeFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const clock = (seconds: number | null | undefined) =>
  seconds && Number.isFinite(seconds) ? timeFormatter.format(new Date(seconds * 1000)) : '--';
const toneOf = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? 'aqx-flat' : value > 0 ? 'aqx-up' : value < 0 ? 'aqx-down' : 'aqx-flat';
const titleCase = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();
const rupees = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '--' : `${value > 0 ? '+' : value < 0 ? '−' : ''}₹${aqtePrice(Math.abs(value))}`;
const lots = (units: number, lotSize: number | undefined) => {
  if (!units || !lotSize) return '1 lot max';
  const count = units / lotSize;
  return `${Number.isInteger(count) ? count : aqtePrice(count)} ${count === 1 ? 'lot' : 'lots'}`;
};

const stamp = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
const elapsed = (seconds: number | null) => {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '--';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
};
const EXIT_REASONS: Record<string, string> = {
  TARGET: 'Target hit', STOP_CROSSED: 'Stop hit', STOP_TRIGGERED: 'Stop hit', SESSION_EXIT: 'Session exit 15:25',
  DAILY_LOSS: 'Daily loss cap', EMERGENCY_STOP: 'Emergency stop', MANUAL_EXIT: 'Manual exit', FILL_BELOW_STOP: 'Fill below stop',
};
// A broker SL that fills on its own leaves no exit reason; the trailing flag tells which stop it was.
const exitLabel = (reason: string | null | undefined, trailed: boolean) => {
  const label = reason ? EXIT_REASONS[reason] ?? titleCase(reason.replaceAll('_', ' ')) : 'Stop hit';
  return trailed && label === 'Stop hit' ? 'Trailing SL hit' : label;
};
type StepState = 'done' | 'current' | 'scan' | 'warn' | 'fail' | 'skip' | 'plan';
type LifeStep = { label: string; detail: string; note: string; state: StepState };
const step = (label: string, state: StepState, detail: string, note = ''): LifeStep => ({ label, detail, note, state });

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

function engineChecks(info: Intelligence | null | undefined, market: Observation | null, style: AQTEEntrySource | undefined,
  evidence: AQTERuleEvidence | null): EngineRow[] {
  if (style === 'morning') return (evidence?.checks ?? []).map(check => ({
    id: check.id, label: check.label, value: check.reason, unavailable: check.passed === null,
    summary: { label: check.label, value: check.passed ? 'Confirmed' : 'Waiting' }, gate: check,
  }));
  const compactLabels = {
    supertrend: 'SuperTrend', ema: style === 'swing' ? 'EMA stack' : 'EMA 9/20',
    vwap: 'VWAP', rsi: 'RSI', imbalance: 'Book imbalance', oi_change: 'OI change (1m)', volume: 'Volume',
  };
  if (!info) return Object.entries(compactLabels).map(([id, label]) => ({
    id, label, value: 'Current evidence unavailable', unavailable: true, summary: { label, value: 'WAITING' },
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
  const shown = new Set(rows.map(row => row.id));
  // Setup-specific gates (pullback, sweep, stretch, ...) have no generic indicator row; show each with its measured value.
  const setupRows: EngineRow[] = (evidence?.checks ?? []).filter(check => !shown.has(check.id))
    .map(check => ({ id: check.id, label: check.label, value: setupValue(check.id, info) }));
  return [...rows, ...setupRows].map(row => {
    const gate = evidence?.checks.find(check => check.id === row.id);
    return { ...row, gate, summary: row.id === 'ema' && row.summary ? {
      ...row.summary, value: !gate ? 'Unverified' : gate.passed === true ? 'Aligned' : gate.passed === false ? 'Not aligned' : 'No bias',
    } : row.summary };
  });
}

const stack = (ema: Record<string, number>, periods: readonly string[]) => {
  const values = periods.map(n => ema[n]);
  const rising = values.every((value, i) => i === 0 || values[i - 1] > value);
  const falling = values.every((value, i) => i === 0 || values[i - 1] < value);
  return rising ? 'Bullish stack' : falling ? 'Bearish stack' : 'Mixed (no stack)';
};

function setupValue(id: string, info: Intelligence): string {
  const atrs = (distance: number) => info.atr > 0 ? `${aqtePrice(Math.abs(distance) / info.atr)} ATR` : 'ATR unavailable';
  const live = info.live?.price;
  switch (id) {
    case 'pullback': return `${atrs(info.close - info.ema['20'])} from EMA20 ${aqtePrice(info.ema['20'])}`;
    case 'resume': return `Close ${aqtePrice(info.close)} vs EMA9 ${aqtePrice(info.ema['9'])}`;
    case 'sweep': return info.sweep === 1 ? 'Swept prior low, closed back inside' :
      info.sweep === -1 ? 'Swept prior high, closed back inside' : 'No sweep this candle';
    case 'trend_filter': return `EMA 9-200: ${stack(info.ema, ['9', '20', '50', '100', '200'])}`;
    case 'range': return `EMA 9/20/50/200: ${stack(info.ema, ['9', '20', '50', '200'])}`;
    case 'stretch': return info.vwap == null ? 'VWAP unavailable' :
      `${atrs(info.close - info.vwap)} ${info.close < info.vwap ? 'below' : 'above'} VWAP ${aqtePrice(info.vwap)}`;
    case 'confirm': case 'turn': return live == null ? 'Live price unavailable' :
      `Live ${aqtePrice(live)} vs close ${aqtePrice(info.close)} (${aqteSigned(live - info.close)})`;
    default: return 'See requirement';
  }
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

type TerminalProps = {
  symbol: AQTESymbol; signal?: AQTESignal; unavailable: boolean; liveStatus?: AQTELiveState | null;
  onExit?: (request: AQTEExitRequest) => void; now?: number;
  /** Hidden index tab: keep the last render (and open details) instead of re-rendering on every tick. */
  paused?: boolean;
};

function AQTETerminal({ symbol, signal, unavailable, liveStatus, onExit, now = Date.now() / 1000 }: TerminalProps) {
  const { info } = aqteOverview(signal, 'real', unavailable, now);
  const currentStatus = aqteControllerCurrent(liveStatus, now);
  const style = currentStatus ? liveStatus?.styles?.[symbol] : undefined;
  const switches = currentStatus ? liveStatus?.swing_setups?.[symbol] : undefined;
  const plan = style ? aqteEffectiveSignal(signal, style, switches) ?? undefined : undefined;
  const observation = info?.live;
  const market = observation && [observation.at, observation.received].every(at => now - at >= -1 && now - at <= 5)
    ? observation : null;
  // Swing follows the controller's enabled-setup swap so the card shows the setup that would actually trade.
  const morningCurrent = style === 'morning' && signal?.morning &&
    now - signal.morning.at >= 0 && now - signal.morning.at <= 3 && !unavailable;
  const evidence = style && (morningCurrent || (info && market)) ? aqteRuleEvidence(signal, style, switches) : null;
  const direction = evidence?.side === 'CE' ? 'BULLISH' : evidence?.side === 'PE' ? 'BEARISH' : 'WAITING';
  const live = liveStatus?.active?.symbol === symbol ? liveStatus.active : null;
  const metrics = live ? aqteLiveMetrics(liveStatus, now) : null;
  const filled = !!live && live.filled > 0;
  const confirmed = currentStatus && !liveStatus?.error && !live?.error && !!live?.protection_confirmed;
  const trailing = !!live?.trailing_active && confirmed;
  const trailR = aqteTrailStart(liveStatus, symbol);
  const points = metrics?.points ?? null;
  const span = live ? points != null && points < 0 ? live.entry_price - live.initial_stop : live.target - live.entry_price : 0;
  const progress = points != null && span > 0 ? Math.min(1, Math.abs(points) / span) : 0;
  const targetHit = metrics?.bid != null && !!live && metrics.bid >= live.target;
  const checks = engineChecks(info, market, style ?? undefined, evidence);
  const score = evidence && plan?.decision !== 'WAIT' && plan?.confidence != null && Number.isFinite(plan.confidence) &&
    plan.confidence >= 0 && plan.confidence <= 100 ? plan.confidence : null;
  const ruleTally = evidence ? {
    passed: evidence.checks.filter(check => check.passed === true).length,
    total: evidence.checks.length,
    unavailable: evidence.checks.filter(check => check.passed === null).length,
  } : null;
  const waiting = style === 'morning' || info ? null : aqteEvidenceWait(signal, unavailable);
  const evidenceUnavailable = style === 'morning' ? morningCurrent ? null : 'Fresh morning evidence is unavailable.' : !info ? signal && signal.feed_ready === undefined ?
    'Backend freshness unavailable; update the backend before trusting these values.' :
    waiting?.detail ?? 'Waiting for current backend evidence: fresh spot/futures and completed candles.' :
    !market ? 'Live depth/OI unavailable; current tick evidence is required for entry checks.' : null;
  const unavailableLabel = !evidenceUnavailable ? null :
    evidenceUnavailable.startsWith('Feed recovery') ? 'FEED RECOVERY' :
      evidenceUnavailable.startsWith('Warming up') ? 'WARMING UP' :
        evidenceUnavailable.startsWith('Opening range') ? 'OPENING RANGE' :
          evidenceUnavailable.startsWith('Market closed') || evidenceUnavailable.startsWith('Outside regular market session') ?
          'MARKET CLOSED' : 'WAITING FOR DATA';
  const alignment = style === 'morning' ? 'Independent morning' : waiting ? waiting.label :
    style === null ? 'No entry style selected in Controls' : !style ? 'Entry style unavailable' : !market ? 'Live depth/OI unavailable' :
    `${style === 'scalp' ? 'Quick scalp' : 'Swing'}${evidence?.setup ? ` · ${AQTE_SETUP_LABELS[evidence.setup]}` : ''}${evidence ? evidence.side ?
      ` · ${evidence.side} · ${evidence.checks.filter(check => check.passed === true).length}/${evidence.checks.length} aligned` :
      ' · WAIT' : ' · Unverified'}`;
  const alignmentTone: Tone = style === 'morning' ? !morningCurrent || !evidence ? 'flat' :
    !evidence.side ? 'wait' : evidence.side === 'CE' ? 'up' : 'down' : !info || !market || !style || !evidence ? 'flat' :
    !evidence.side || plan?.decision === 'WAIT' ? 'wait' : evidence.side === 'CE' ? 'up' : 'down';
  const exitReason = live?.exit_requested;
  const remaining = live ? Math.max(0, live.filled - (live.exited ?? 0)) : 0;
  const canExit = !!live && !!onExit && aqteCanExit(liveStatus) && !exitReason;
  const automation = currentStatus && liveStatus?.automation_on && !liveStatus.killed;
  const requestExit = (action: AQTEExitRequest['action']) => {
    if (canExit && live) onExit?.({ tradeId: live.id, contract: live.contract.trading_symbol, quantity: remaining, action });
  };
  // Mirrors the canExit gate so a disabled exit always says why.
  const exitBlock = canExit ? null : !live ? 'No open trade' : exitReason ? 'Exit requested' :
    liveStatus?.killed || liveStatus?.flatten_pending ? 'Emergency stop active' :
    !currentStatus ? 'Status unverified' : live.filled <= (live.exited ?? 0) ? 'Awaiting fill' : 'Unavailable';
  const controlTone = canExit ? 'ready' : exitReason ? 'pending' : live ? 'locked' : 'idle';
  const controlLabel = canExit ? 'Exit ready' : exitReason ? 'Exit pending' : live ? exitBlock : 'Standby · no open trade';
  const automationWaiting = currentStatus && !automation && liveStatus?.automation_wanted && !liveStatus.killed;
  // A disabled or capped index never enters today even once Auto Trade arms, so it outranks the arming wait.
  const indexBlock = currentStatus && (automation || automationWaiting) ? liveStatus?.entry_blocks?.[symbol] : null;
  const indexHold = aqteIndexHold(indexBlock);
  const sessionClosed = !!(automation || automationWaiting) && liveStatus?.entry_window === false;
  const lastTrade = !live && currentStatus ? [...(liveStatus?.trades ?? [])].reverse()
    .find(trade => trade.symbol === symbol && aqteIstDay(trade.exit_at) === aqteIstDay(now)) : undefined;
  let steps: LifeStep[];
  let lifeMode: 'live' | 'closed' | 'idle';
  let lifeLabel: string;
  let lifeClock = '';
  if (live) {
    lifeMode = 'live';
    const started = stamp(live.signal_at) ?? stamp(live.entry_at);
    const broken = !currentStatus || !!(live.error || liveStatus?.error);
    const risk = live.entry_price - live.initial_stop;
    const armAt = filled && risk > 0 ? live.entry_price + risk * trailR : null;
    const trailPending = live.modify?.order_type === 'SL';
    const locked = (live.stop - live.entry_price) * live.filled;
    steps = [
      step('Signal', 'done', started ? clock(started) : 'Received', 'Setup locked'),
      live.entry_id ? step('Order Placed', 'done', clock(stamp(live.entry_ack_at) ?? stamp(live.entry_at)), 'Broker ack')
        : step('Order Placed', broken ? 'fail' : 'current', broken ? 'Unconfirmed' : 'Sending…', broken ? 'Check Kite' : `Limit ₹${aqtePrice(live.limit)}`),
      filled ? step('Entry Filled', 'done', clock(stamp(live.fill_at)), `₹${aqtePrice(live.entry_price)} · ${live.filled} qty`)
        : step('Entry Filled', live.entry_id && !exitReason ? 'current' : 'plan', live.entry_id ? 'Awaiting fill' : 'Pending',
          `Limit ₹${aqtePrice(live.limit)}`),
      confirmed ? step('SL Protected', 'done', `₹${aqtePrice(live.initial_stop)}`, stamp(live.protect_at) ? clock(stamp(live.protect_at)) : 'Broker-confirmed')
        : !filled ? step('SL Protected', 'plan', `₹${aqtePrice(live.initial_stop)}`, 'Placed on fill')
          : broken ? step('SL Protected', 'fail', 'Unverified', 'Check Kite')
            : step('SL Protected', exitReason ? 'warn' : 'current', live.protect_id ? 'Confirming' : 'Placing SL', `₹${aqtePrice(live.stop)}`),
      trailing ? step('Trailing Active', 'done', `₹${aqtePrice(live.stop)}`, locked > 0 ? `${rupees(locked)} locked` : clock(stamp(live.trail_at)))
        : trailPending && !exitReason ? step('Trailing Active', 'current', `→ ₹${aqtePrice(live.modify?.trigger_price)}`, 'Awaiting broker')
          : exitReason ? step('Trailing Active', 'skip', 'Not reached', `+${trailR}R arm`)
            : confirmed && armAt ? step('Trailing Active', 'current', `Arms ₹${aqtePrice(armAt)}`,
              live.peak > 0 ? `Peak ₹${aqtePrice(live.peak)}` : `+${trailR}R`)
              : step('Trailing Active', 'plan', `+${trailR}R`, 'After SL'),
      exitReason ? step('Exit', 'warn', exitLabel(exitReason, trailing),
        stamp(live.exit_request_at) ? `Sent ${clock(stamp(live.exit_request_at))}` : 'Awaiting fill')
        : step('Exit', 'plan', `Target ₹${aqtePrice(live.target)}`, 'SL · 15:25 auto'),
    ];
    lifeLabel = exitReason ? 'Exiting' : broken ? 'Check Kite' : filled ? 'Live' : 'Entering';
    lifeClock = started ? `${elapsed(now - started)} in trade` : '';
  } else if (lastTrade) {
    lifeMode = 'closed';
    const trailed = lastTrade.trailing_active === true;
    const started = stamp(lastTrade.signal_at) ?? stamp(lastTrade.entry_at);
    const reason = typeof lastTrade.exit_reason === 'string' ? lastTrade.exit_reason : lastTrade.exit_requested;
    const tradeFilled = (lastTrade.filled ?? 0) > 0;
    steps = [
      step('Signal', 'done', started ? clock(started) : 'Received', 'Setup locked'),
      step('Order Placed', 'done', clock(stamp(lastTrade.entry_ack_at) ?? stamp(lastTrade.entry_at)), 'Broker ack'),
      tradeFilled ? step('Entry Filled', 'done', clock(stamp(lastTrade.fill_at)), `₹${aqtePrice(lastTrade.entry_price)}`)
        : step('Entry Filled', 'skip', 'Not filled'),
      lastTrade.protection_confirmed === true ? step('SL Protected', 'done', `₹${aqtePrice(lastTrade.initial_stop)}`, stamp(lastTrade.protect_at) ? clock(stamp(lastTrade.protect_at)) : 'Broker-confirmed')
        : step('SL Protected', 'skip', 'Not confirmed'),
      trailed ? step('Trailing Active', 'done', `₹${aqtePrice(lastTrade.stop)}`, clock(stamp(lastTrade.trail_at)))
        : step('Trailing Active', 'skip', 'Not reached'),
      lastTrade.exit_unverified ? step('Exit', 'fail', 'Unverified', 'Check Kite')
        : step('Exit', 'done', exitLabel(reason, trailed),
          `${clock(lastTrade.exit_at)}${lastTrade.exit_price != null ? ` · ₹${aqtePrice(lastTrade.exit_price)}` : ''}`),
    ];
    lifeLabel = lastTrade.exit_unverified ? 'Check Kite' : 'Completed';
    lifeClock = started ? `Held ${elapsed(lastTrade.exit_at - started)}` : '';
  } else {
    lifeMode = 'idle';
    const passed = evidence ? evidence.checks.filter(check => check.passed === true).length : 0;
    const setup = !!evidence?.side && !!plan?.decision && plan.decision !== 'WAIT';
    steps = [
      !currentStatus ? step('Signal', 'warn', 'Unverified', 'Status stale')
        : liveStatus?.killed ? step('Signal', 'fail', 'Blocked', 'Emergency stop')
          : indexHold ? step('Signal', 'warn', indexHold === 'Limit reached' ? 'Limit hit' : 'Index off',
            indexHold === 'Limit reached' ? 'Resets next day' : 'Enable in Controls')
          : sessionClosed ? step('Signal', 'plan', 'Entries closed', '09:15 to 15:15 IST')
          : automation ? step('Signal', 'scan', setup ? `${evidence?.side} setup` : 'Scanning',
            evidence ? `${passed}/${evidence.checks.length} aligned` : 'Live feed')
            : automationWaiting ? step('Signal', 'warn', 'Arming', 'Preflight')
              : step('Signal', 'plan', 'Auto OFF', 'Entries blocked'),
      step('Order Placed', 'plan', 'Auto BUY', '1 lot'),
      step('Entry Filled', 'plan', 'On fill', 'Broker ack'),
      step('SL Protected', 'plan', 'Broker SL', 'Placed on fill'),
      step('Trailing Active', 'plan', 'R-trail', 'Ratchets up'),
      step('Exit', 'plan', 'Target · SL', '15:25 auto'),
    ];
    lifeLabel = !currentStatus ? 'Unverified' : liveStatus?.killed ? 'Blocked'
      : indexHold ? indexHold === 'Limit reached' ? 'Limit hit' : 'Index off' : sessionClosed ? 'Entries closed'
        : automation ? 'Scanning' : automationWaiting ? 'Arming' : 'Standby';
  }
  const lifeDone = steps.filter(item => item.state === 'done').length;
  const lifeTone = steps.some(item => item.state === 'fail') ? 'fail' : steps.some(item => item.state === 'warn') ? 'warn'
    : steps[0].state === 'scan' ? 'scan' : lifeMode;
  const status = !currentStatus ? live ? 'POSITION UNVERIFIED' : 'STATUS UNAVAILABLE' :
    !live ? 'WAITING FOR SIGNAL' : exitReason ? 'EXIT REQUESTED' :
      live.error || liveStatus?.error ? 'CHECK KITE' : filled ? 'LIVE TRADE' : 'ORDER PENDING';
  const ring = 2 * Math.PI * 52;
  const note = liveStatus?.entry_note?.startsWith(`${symbol}:`) ? liveStatus.entry_note.slice(symbol.length + 1).trim() : null;
  const readinessReasons = plan?.reasons ?? (signal?.decision === 'WAIT' ? signal.reasons : undefined);
  const waitingReason = !currentStatus ? 'Live controller status unavailable; entry state unverified' :
    liveStatus?.error ? liveStatus.error :
    liveStatus?.killed ? 'Emergency stop latched; new entries blocked' :
    !automation && !automationWaiting ? 'Auto Trade OFF; new entries blocked' :
    indexHold ? [indexBlock, indexHold === 'Disabled in Controls' ? `tick "Enable ${aqteLabel(symbol)} entries" in Daily Trade Control` : null,
      automationWaiting ? liveStatus?.automation_waiting : null].filter(Boolean).join(' · ') :
    sessionClosed ? liveStatus?.automation_waiting || 'New entries permitted only from 09:15 to 15:15 IST' :
    automationWaiting ? liveStatus?.automation_waiting || 'Waiting for daily preflight and arming' :
    unavailable ? 'Current signal data unavailable; do not assume an entry is ready' :
    liveStatus?.entry_blocks?.[symbol] ? liveStatus.entry_blocks[symbol] :
    readinessReasons?.length ? `${plan && style === 'scalp' ? 'Quick scalp · ' : plan && style === 'swing' ? 'Swing · ' : ''}${readinessReasons.join(' · ')}` :
      'Waiting for a qualifying CE/PE setup and live quality, risk and broker checks';
  // Candle warm-up only means something while the feed is live; after the close it would read as a stuck 0/N.
  const warmup = !unavailable && signal?.feed_ready !== false ? signal?.warmup : undefined;
  const opening = !unavailable && signal?.feed_ready !== false ? signal?.opening : undefined;
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
        {!live && currentStatus && liveStatus?.entry_scan?.blocks[symbol] && (
          <p className="aqx-footnote" aria-label="Last entry scan">
            Last scan {clock(liveStatus.entry_scan.at)} IST
            {' · '}{liveStatus.entry_scan.styles[symbol] === 'scalp' ? 'Scalp' : liveStatus.entry_scan.styles[symbol] === 'swing' ? 'Swing' :
              liveStatus.entry_scan.styles[symbol] === null ? 'No entry style selected' : 'Style unavailable'}
            {' · '}{liveStatus.entry_scan.blocks[symbol]}
          </p>
        )}
        <div className="aqx-hero-grid">
          <dl className="aqx-price-list" aria-label="Trade prices">
            <Row label="Entry" tone="aqx-white">{filled ? `₹${aqtePrice(live.entry_price)}` : live ? `Limit ₹${aqtePrice(live.limit)}` : '--'}</Row>
            <Row label="LTP" tone={toneOf(points)} extra={points != null && points !== 0 ? <span aria-hidden="true"> {points > 0 ? '↗' : '↘'}</span> : null}>
              {metrics?.ltp != null ? `₹${aqtePrice(metrics.ltp)}` : '--'}
            </Row>
            <Row label="Stop Loss (SL)" tone={live ? 'aqx-down' : ''} extra={live ? <small>Initial level</small> : null}>
              {live ? `₹${aqtePrice(live.initial_stop)}` : '--'}
            </Row>
            <Row label="Trailing SL (TSL)" tone={live ? 'aqx-cyan' : ''} extra={live ? <small>{confirmed ? 'Broker-confirmed SL' : 'Protection unverified'}</small> : null}>
              {trailing ? <><span aria-hidden="true">🔒 </span>₹{aqtePrice(live.stop)}</> :
                live?.trailing_active ? `Last ₹${aqtePrice(live.stop)}` : live ? `From +${trailR}R` : '--'}
            </Row>
          </dl>
          <div className="aqx-ring-box">
            <div className="aqx-ring" aria-label="Open profit and loss">
              <svg viewBox="0 0 120 120" aria-hidden="true">
                <circle cx="60" cy="60" r="52" className="aqx-ring-track" />
                <circle cx="60" cy="60" r="52" className={`aqx-ring-value ${points != null && points < 0 ? 'aqx-ring-loss' : ''}`}
                  strokeDasharray={ring} strokeDashoffset={ring * (1 - progress)} />
              </svg>
              <div className="aqx-ring-text">
                <span>Open P&amp;L</span>
                <strong className={toneOf(points)}>{points != null ? `${aqteSigned(points)} pts` : '--'}</strong>
                <em className={toneOf(metrics?.net_pnl)}>{rupees(metrics?.net_pnl)}</em>
                <b className={toneOf(metrics?.return_pct)}>{metrics?.return_pct != null ? `${aqteSigned(metrics.return_pct)}%` : '--'}</b>
              </div>
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
              <p className="aqx-position-line"><span>{lots(filled ? remaining : 0, live?.contract.lot_size)}</span><span>Qty: {filled ? remaining : '--'}</span></p>
              <p className="aqx-footnote">Peak bid: {live && live.peak > 0 ? `₹${aqtePrice(live.peak)}` : '--'}</p>
            </section>
          </div>
        </div>
        <p className="aqx-footnote">P&amp;L uses executable sell bid and estimated fees; return % is before fees.</p>
        {live?.modify?.order_type === 'SL' && <p role="status" className="aqx-warning">Trailing request ₹{aqtePrice(live.modify.trigger_price)} awaits broker confirmation. Last confirmed SL: ₹{aqtePrice(live.stop)}.</p>}
        {live && !confirmed && <p role="status" className="aqx-warning">{exitReason ? 'Exit requested, not yet filled. Verify execution in Kite.' : 'Broker protection is unverified. Inspect Kite; do not assume the planned stop is active.'}</p>}
        {filled && !metrics && <p role="status" className="aqx-warning">Current quote/P&amp;L unavailable. Last-known trade levels are retained; verify in Kite.</p>}
        {!live && liveStatus?.active && <p role="status" className="aqx-warning">AQTE is managing {aqteLabel(liveStatus.active.symbol)} in its own index tab.</p>}
        <section className="aqx-controls" aria-label="Trade controls" data-state={controlTone}>
          <header className="aqx-controls-head">
            <h5>Trade Controls</h5>
            <span className="aqx-controls-state"><span aria-hidden="true" />{controlLabel}</span>
          </header>
          <div className="aqx-actions">
            <div className="aqx-action aqx-action-partial" role="group" aria-label="Partial booking" aria-describedby={`${prefix}-booking-note`}>
              <span aria-hidden="true">◔</span>
              <span>
                <strong>Partial Book</strong>
                <span className="aqx-partial-chips">
                  {[25, 50, 75].map(percent => (
                    <button key={percent} type="button" disabled aria-label={`Book ${percent}% (unavailable for one lot)`}>{percent}%</button>
                  ))}
                </span>
                <small>Not in 1-lot pilot</small>
              </span>
            </div>
            <button type="button" className="aqx-action aqx-action-book-all" disabled={!canExit} onClick={() => requestExit('book')}
              title={exitBlock ?? 'Book the full remaining quantity of the selected AQTE trade'}>
              <span aria-hidden="true">₹</span>
              <span><strong>Book All</strong><small>{exitBlock ?? 'Selected AQTE trade'}</small></span>
            </button>
            <div className={`aqx-action aqx-action-trail ${trailing ? 'aqx-action-on' : live ? 'aqx-action-armed' : ''}`} aria-label="Trailing stop status">
              <span aria-hidden="true">🔒</span>
              <span><strong>Trail &amp; Hold</strong><small>{trailing ? 'Broker-confirmed' : live ? `Auto at +${trailR}R` : 'Auto after entry'}</small></span>
            </div>
            <button type="button" className="aqx-action aqx-action-exit" disabled={!canExit} onClick={() => requestExit('exit')}
              title={exitBlock ?? 'Exit the selected AQTE trade (confirmation required)'}>
              <span aria-hidden="true">⏻</span>
              <span><strong>{exitReason ? 'Exit Requested' : 'Exit Now'}</strong><small>{exitBlock ?? 'Selected trade only'}</small></span>
            </button>
          </div>
          <p id={`${prefix}-booking-note`} className="aqx-footnote">25%/50%/75% booking needs multiple whole lots and is unavailable in this one-lot pilot. Book All and Exit Now unlock once an AQTE trade is filled. Trail &amp; Hold shows automatic status, not a manual order.</p>
          <div className="aqx-lifecycle" data-mode={lifeMode} data-tone={lifeTone}>
            <div className="aqx-life-head">
              <span className="aqx-life-title"><span aria-hidden="true">⟳</span>Trade Lifecycle</span>
              <span className="aqx-life-pill"><span aria-hidden="true" />{lifeLabel}</span>
              <span className="aqx-life-stats">
                {lifeMode === 'closed' && lastTrade && <>
                  <span className="aqx-life-contract">{lastTrade.contract?.trading_symbol ?? `${aqteLabel(symbol)} last trade`}</span>
                  <b className={toneOf(lastTrade.net_pnl)}>{rupees(lastTrade.net_pnl)}</b>
                </>}
                {lifeMode === 'live' && metrics?.net_pnl != null && <b className={toneOf(metrics.net_pnl)}>{rupees(metrics.net_pnl)}</b>}
                {lifeClock && <span>{lifeClock}</span>}
                <span aria-label={`${lifeDone} of ${steps.length} stages complete`}>{lifeDone}/{steps.length}</span>
              </span>
              <span className="aqx-life-meter" aria-hidden="true"><span style={{ width: `${(lifeDone / steps.length) * 100}%` }} /></span>
            </div>
            <ol className="aqx-timeline" aria-label="Trade lifecycle">
              {steps.map(({ label, detail, note, state }, index) => (
                <li key={label} className={`aqx-step-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
                  <span aria-hidden="true" className="aqx-step-dot">
                    {state === 'done' ? '✓' : state === 'fail' ? '!' : state === 'skip' ? '–' : index === steps.length - 1 ? '⚑' : index + 1}
                  </span>
                  <strong>{label}</strong>
                  <small>{detail}</small>
                  {note && <em>{note}</em>}
                </li>
              ))}
            </ol>
          </div>
        </section>
      </article>
      <aside className="aqx-aside" id={`${prefix}-risk`}>
        <section className="aqx-card aqx-engine" aria-label="Rule-Based Trade Engine">
          <h4 className="aqx-panel-title"><span className="aqx-badge-ai" aria-hidden="true">R</span>Rule-Based Trade Engine</h4>
          <p className={`aqx-evidence-summary aqx-${alignmentTone} ${style === 'morning' ? 'aqx-evidence-summary-morning' :
            unavailableLabel ? 'aqx-evidence-summary-wait' : ''}`}
            aria-label="Rule alignment"
            title={evidenceUnavailable ?? (plan?.decision === 'WAIT' && plan.reasons?.length
              ? `${alignment} · ${plan.reasons.join('; ')}` : `${alignment} · ${morningCurrent ? direction : style === 'morning' ? 'WAITING' : alignment}`)}>
            {unavailableLabel && style !== 'morning' ? <>
              <span>Evidence status</span><strong className="aqx-evidence-wait">{unavailableLabel}</strong>
            </> : <span>{alignment}</span>}
            {style === 'morning' && <strong className="aqx-morning-direction">{morningCurrent ? direction : 'WAITING'}</strong>}
          </p>
          <ul className="aqx-check-list aqx-check-compact" aria-label="Key trading indicators">
            {checks.filter(check => check.summary).map(check => <EngineCheck key={check.id} check={check} compact />)}
            <li data-rule="score" data-status={evidence ? 'CONTEXT' : 'UNAVAILABLE'}
              title={score != null ? 'Strategy rule score; not a win probability.' :
                ruleTally ? `${ruleTally.passed} of ${ruleTally.total} entry checks confirmed` +
                  (ruleTally.unavailable ? `; ${ruleTally.unavailable} check${ruleTally.unavailable === 1 ? '' : 's'} unavailable` : '') +
                  '. This is a gate tally, not a probability or trade approval.' :
                  'Current rule-check evidence is unavailable.'}>
              <Check tone="flat" />
              <span className="aqx-check-label">{score != null ? 'Rule score:' : 'Checks passing:'}</span>
              <strong className="aqx-pill">{score != null ? `${aqtePrice(score)} / 100` :
                ruleTally ? `${ruleTally.passed}/${ruleTally.total}` +
                  (ruleTally.unavailable ? ` · ${ruleTally.unavailable} N/A` : '') :
                  evidenceUnavailable ? 'WAITING' : '--'}</strong></li>
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
            <li><Check tone={confirmed ? 'up' : 'flat'} /><span>Broker SL order</span><b>{!live ? 'After entry' : confirmed ? `₹${aqtePrice(live.stop)}` : 'Unverified'}</b></li>
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

export function aqteTerminalPropsEqual(prev: TerminalProps, next: TerminalProps) {
  if (prev.paused && next.paused) return true;
  const keys = Object.keys(next) as Array<keyof TerminalProps>;
  return keys.length === Object.keys(prev).length && keys.every(key => Object.is(prev[key], next[key]));
}

export default memo(AQTETerminal, aqteTerminalPropsEqual);
