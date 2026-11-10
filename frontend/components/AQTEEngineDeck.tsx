'use client';

import { memo, useMemo, useState, type ReactNode } from 'react';
import AQTEExecutionHistory from '@/components/AQTEExecutionHistory';
import { aqteBlockLabel, aqteControllerCurrent, aqteEffectiveSignal, aqteEngineView, aqteIndexHold, aqteLabel, aqteLiveMetrics,
  aqteOpportunitySymbol, aqteOverview, aqtePrice, aqteRanking, aqteServerNow, aqteSigned, aqteTrailStart,
  type AQTEEngine, type AQTEEnginePolicy, type AQTEEngineStatus,
  type AQTELiveState, type AQTESignal, type AQTESymbol } from '@/lib/aqte-display';

// Stable placeholders keep all 12 engine rows in place before the first evaluation arrives.
const ENGINE_NAMES = ['Momentum', 'Breakout', 'Trend Following', 'Liquidity Sweep', 'Order Flow', 'Scalping',
  'Mean Reversion', 'Volatility Breakout', 'Options Intelligence', 'Multi-Timeframe', 'Statistical Arbitrage', 'ML Prediction'];
const PLACEHOLDER_ENGINES: Array<AQTEEngine | null> = ENGINE_NAMES.map(() => null);
const SHORT_NAMES = ['Momentum', 'Breakout', 'Trend', 'Liquidity', 'Order Flow', 'Scalping',
  'Mean Rev', 'Volatility', 'Options', 'MTF', 'Stat Arb', 'ML'];
const STATUS_LABEL: Record<AQTEEngineStatus, string> = {
  SATISFIED: 'Satisfied', PARTIAL: 'Partial', MONITORING: 'Monitoring', NOT_SATISFIED: 'Not satisfied',
};
const CHART_TABS = [['chart', 'Price Chart'], ['signals', 'Engine Signals'], ['levels', 'Levels'],
  ['flow', 'Order Flow'], ['options', 'Options'], ['mtf', 'Multi-TF']] as const;
type ChartTab = typeof CHART_TABS[number][0];
const fixed = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value) ? '--' : value.toFixed(digits);
const percent = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '--' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
const move = (from: number | null | undefined, to: number | null | undefined) =>
  from != null && to != null && from > 0 && Number.isFinite(to) ? (to - from) / from * 100 : null;
const rupees = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '--' : `₹${aqtePrice(value)}`;
const signedRupees = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '--' : `${value > 0 ? '+' : value < 0 ? '−' : ''}₹${aqtePrice(Math.abs(value))}`;
const quantity = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '--' : value.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const sideTone = (side: 'CE' | 'PE' | null | undefined) => side === 'CE' ? 'aqx-buy' : side === 'PE' ? 'aqx-sell' : 'aqx-wait';
const valueTone = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) || value === 0 ? '' : value > 0 ? 'aqx-buy' : 'aqx-sell';
type Check = { label: string; state: 'pass' | 'fail' | 'wait'; value: string; detail?: string };
type Fact = [string, string, string?];

type Props = {
  symbol: AQTESymbol;
  data?: Partial<Record<AQTESymbol, AQTESignal>>;
  liveStatus: AQTELiveState | null;
  policy: AQTEEnginePolicy | null;
  unavailable: boolean;
  now?: number;
  chart?: ReactNode;
};

function RuleList({ rules }: { rules: AQTEEngine['rules'] }) {
  return (
    <ul className="aqx-rule-list">
      {rules.map(rule => (
        <li key={rule.id} className={rule.passed === true ? 'aqx-pass' : rule.passed === false ? 'aqx-fail' : 'aqx-pending'}>
          <span aria-hidden="true">{rule.passed === true ? '✓' : rule.passed === false ? '✕' : '…'}</span>
          <span>{rule.label}<small>{rule.requirement}</small></span>
          <b>{rule.value ?? (rule.passed == null ? 'No data' : '--')}</b>
        </li>
      ))}
    </ul>
  );
}

function Facts({ rows, label }: { rows: Fact[]; label: string }) {
  return (
    <dl className="aqx-facts" aria-label={label}>
      {rows.map(([name, value, color]) => <div key={name}><dt>{name}</dt><dd className={color ?? ''}>{value}</dd></div>)}
    </dl>
  );
}

type Opportunity = ReturnType<typeof opportunityOf>;
/** Top opportunity and execution state; recomputed only when the snapshot, controller status or policy changes. */
function opportunityOf(data: Props['data'], reportedStatus: AQTELiveState | null, policy: AQTEEnginePolicy | null,
  unavailable: boolean, now: number) {
  const liveStatus = aqteControllerCurrent(reportedStatus, now) ? reportedStatus : null;
  // Mirrors automated_entry: controller ranking (or the same local ranking before it reports), first unblocked index.
  const ranked = unavailable ? [] : liveStatus?.ranking ?? aqteRanking(data, liveStatus?.styles, liveStatus?.swing_setups);
  const top = unavailable ? null : aqteOpportunitySymbol(ranked, liveStatus?.entry_blocks);
  const topSignal = top ? data?.[top] : undefined;
  const style = top && liveStatus?.styles?.[top] !== undefined ? liveStatus.styles[top] : 'scalp';
  const effective = aqteEffectiveSignal(topSignal, style, top ? liveStatus?.swing_setups?.[top] : undefined);
  const actionable = !!effective && effective.decision !== 'WAIT' && !!effective.entry;
  const side = actionable ? effective.decision.slice(-2) as 'CE' | 'PE' : null;
  const topView = aqteEngineView(topSignal);
  const aligned = side && topView ? side === 'CE' ? topView.orchestration.ce : topView.orchestration.pe : null;
  const opposed = side && topView ? side === 'CE' ? topView.orchestration.pe : topView.orchestration.ce : null;
  const alignedNames = side && topView ? topView.engines.filter(engine => engine.status === 'SATISFIED' && engine.side === side)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 3).map(engine => SHORT_NAMES[engine.id - 1] ?? engine.name) : [];
  const plan = top ? liveStatus?.entry_plans?.[top] ?? null : null;
  // Show the levels the controller would actually send; the raw rule levels only before the controller reports.
  const entry = !actionable ? null : plan ? { ...effective.entry!, ...plan } :
    liveStatus?.entry_plans ? null : effective.entry;
  const contract = actionable ? effective.contract : null;
  const strike = typeof contract?.strike === 'number' && Number.isFinite(contract.strike) ? contract.strike : null;
  const active = reportedStatus?.active ?? null;
  const controllerBlock = liveStatus?.error || (liveStatus?.flatten_pending ? 'Emergency square-off pending' : null);
  const sessionClosed = liveStatus?.entry_window === false;
  const block = controllerBlock || (sessionClosed ? 'New entries permitted only from 09:15 to 15:15 IST'
    : top ? liveStatus?.entry_blocks?.[top] : undefined);
  const vetoMin = policy?.veto_min ?? 2;
  const vetoed = policy?.veto !== false && opposed != null && aligned != null && opposed >= vetoMin && opposed > aligned;
  const lot = contract?.lot_size;
  const executing = actionable && !vetoed && !!liveStatus && liveStatus.automation_on && liveStatus.armed &&
    !liveStatus.killed && !controllerBlock && !sessionClosed && !active && block === null;
  // Standing ON that has not armed yet (outside the window, IP or preflight failure) is waiting, not OFF.
  const arming = !!liveStatus && !liveStatus.killed && !liveStatus.automation_on && liveStatus.automation_wanted === true;
  // Every index disabled or at its trade cap in Controls: nothing can enter today, whatever the market does.
  const held = !!liveStatus && ranked.length > 0 && ranked.every(symbol => aqteIndexHold(liveStatus.entry_blocks?.[symbol]));
  const autoState = !liveStatus ? ['UNKNOWN', 'aqx-exec-wait'] : liveStatus.killed ? ['STOPPED', 'aqx-exec-stop'] :
    controllerBlock ? ['BLOCKED', 'aqx-exec-off'] : active ? ['IN TRADE', 'aqx-exec-live'] : executing ? ['READY', 'aqx-exec-ready'] :
      !liveStatus.automation_on && !arming ? ['OFF', 'aqx-exec-off'] : held ? ['BLOCKED', 'aqx-exec-off'] :
        arming ? ['NOT ARMED', 'aqx-exec-wait'] : ['WAITING', 'aqx-exec-wait'];
  const score = actionable && effective.confidence != null && Number.isFinite(effective.confidence)
    ? Math.max(0, Math.min(100, effective.confidence)) : null;
  // Same order the controller scans; each row explains only that index's wait.
  const ladder = (ranked.length ? ranked : (['NIFTY', 'BANKNIFTY', 'SENSEX'] as AQTESymbol[])).map(symbol => {
    const signal = unavailable ? null : aqteEffectiveSignal(data?.[symbol], liveStatus?.styles?.[symbol],
      liveStatus?.swing_setups?.[symbol]);
    const ready = !!signal && signal.decision !== 'WAIT' && !!signal.entry;
    const confidence = ready && signal.confidence != null && Number.isFinite(signal.confidence)
      ? Math.max(0, Math.min(100, signal.confidence)) : null;
    const gate = liveStatus?.entry_blocks?.[symbol];
    const hold = aqteIndexHold(gate);
    const first = symbol === top;
    // Controls holds apply with or without market data; every other state needs a live evaluation first.
    const state = hold ?? (unavailable || !signal ? 'No data' : gate ? aqteBlockLabel(gate, ready)
      : !ready ? 'Waiting for signal' : gate === null ? first ? 'Top pick' : 'Clear' : 'Unverified');
    const reason = !hold && (unavailable || !signal) ? undefined
      : gate || (!ready ? signal?.reasons[0] : undefined);
    return { symbol, side: ready ? signal.decision.slice(-2) as 'CE' | 'PE' : null, confidence,
      state: first && gate ? `Top · ${state}` : state, reason, top: first };
  });
  return { top, style, effective, actionable, side, topView, aligned, opposed, alignedNames, entry, contract, strike,
    block, active, vetoed, lot, executing, autoState, score, ladder };
}

const RING = 2 * Math.PI * 30;
const OpportunityPanel = memo(function OpportunityPanel({ opp, maxLots }: { opp: Opportunity; maxLots: number | null }) {
  const { top, side, actionable, alignedNames, aligned, opposed, vetoed, contract, strike, style, score, entry, autoState, executing, ladder } = opp;
  return (
    <aside className="aqx-card aqx-opp" aria-label="Top opportunity" id="aqte-dash-opportunity">
      <h3 className="aqx-panel-head"><span aria-hidden="true" className="aqx-crown">♛</span>Current Opportunity <span>(Top Ranked)</span></h3>
      <div className="aqx-opp-hero" data-side={side ?? 'WAIT'}>
        <div className="min-w-0">
          <p className="aqx-opp-name">{top ? `${aqteLabel(top)}${strike != null ? ` ${strike.toLocaleString('en-IN')}` : ''}${side ? ` ${side}` : ''}` : '--'}</p>
          <p className="aqx-opp-tags">
            <b className={`aqx-side-chip ${side ? side === 'CE' ? 'aqx-chip-ce' : 'aqx-chip-pe' : 'aqx-chip-wait'}`}>{actionable ? 'BUY' : 'WAIT'}</b>
            <span>{alignedNames.length ? alignedNames.join(' + ') : actionable ? 'Rule engine' : 'Waiting for signal'}</span>
          </p>
          {aligned != null && opposed != null && (
            <p className={`aqx-opp-consensus ${vetoed ? 'aqx-sell' : 'aqx-buy'}`}>
              {`${aligned} aligned · ${opposed} opposed${vetoed ? ' · Veto · WAIT' : ''}`}
            </p>
          )}
          <p className="aqx-opp-contract">{contract?.trading_symbol ?? (top ? `${aqteLabel(top)} · ${style === 'morning' ? 'Morning' : style === 'scalp' ? 'Scalp' : 'Swing'}` : '--')}</p>
        </div>
        <div className="aqx-opp-ring" aria-label={`Rule score ${score != null ? `${Math.round(score)}%` : 'unavailable'}`}>
          <svg viewBox="0 0 72 72" aria-hidden="true">
            <circle cx="36" cy="36" r="30" className="aqx-ring-track" />
            <circle cx="36" cy="36" r="30" className="aqx-ring-value" strokeDasharray={RING} strokeDashoffset={RING * (1 - (score ?? 0) / 100)} />
          </svg>
          <span><small>Score</small><b>{score != null ? `${Math.round(score)}%` : '--'}</b></span>
        </div>
      </div>
      <section className="aqx-opp-rank" aria-label="Index ranking">
        <p className="aqx-opp-rank-head"><span>Index Ranking</span><small>Controller scan order</small></p>
        <ol>
          {ladder.map(({ symbol: name, side: rowSide, confidence, state, reason, top: first }, index) => (
            <li key={name} className={first ? 'aqx-rank-top' : ''} data-side={rowSide ?? 'WAIT'}
              title={reason}>
              <span className="aqx-rank-no" aria-hidden="true">{first ? '♛' : index + 1}</span>
              <span className="aqx-rank-body">
                <span className="aqx-rank-line">
                  <b>{aqteLabel(name)}</b>
                  <small data-hold={reason && aqteIndexHold(reason) ? 'true' : undefined}>{state}</small>
                </span>
                <span className="aqx-rank-bar" aria-hidden="true"><i style={{ width: `${confidence ?? 0}%` }} /></span>
              </span>
              <span className={`aqx-side-chip ${rowSide ? rowSide === 'CE' ? 'aqx-chip-ce' : 'aqx-chip-pe' : 'aqx-chip-wait'}`}>{rowSide ?? 'WAIT'}</span>
              <span className="aqx-rank-pct">{confidence != null ? `${Math.round(confidence)}%` : '--'}</span>
            </li>
          ))}
        </ol>
      </section>
      <dl className="aqx-opp-grid">
        <div><dt>Entry ≤</dt><dd>{rupees(entry?.maximum)}</dd></div>
        <div><dt>Target</dt><dd className={entry ? 'aqx-buy' : ''}>{rupees(entry?.target)}<small>{entry ? percent(move(entry.maximum, entry.target)) : ''}</small></dd></div>
        <div><dt>Stop Loss</dt><dd className={entry ? 'aqx-sell' : ''}>{rupees(entry?.stop)}<small>{entry ? percent(move(entry.maximum, entry.stop)) : ''}</small></dd></div>
        <div><dt>Lot</dt><dd>{maxLots ?? '--'}</dd></div>
        <div><dt>R:R</dt><dd>{entry ? `1 : ${fixed(entry.reward_risk, 1)}` : '--'}</dd></div>
      </dl>
      <div className={`aqx-exec ${autoState[1]}`} role="status">
        <p><span aria-hidden="true">⚡</span>Auto Execution: <b>{autoState[0]}</b><span aria-hidden="true" className="aqx-exec-mark">{executing ? '✓' : ''}</span></p>
      </div>
    </aside>
  );
});

function AQTEEngineDeck({ symbol, data, liveStatus, policy, unavailable,
  now = aqteServerNow(), chart }: Props) {
  const [tab, setTab] = useState<ChartTab>('chart');
  const [analyticsExpanded, setAnalyticsExpanded] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const signal = data?.[symbol];
  // The deck re-renders with the 1 s clock and every market tick; validation reruns only when the snapshot changes.
  const view = useMemo(() => unavailable ? null : aqteEngineView(signal), [signal, unavailable]);
  const engines = view?.engines ?? PLACEHOLDER_ENGINES;
  const market = view?.market ?? null;
  const opp = useMemo(() => opportunityOf(data, liveStatus, policy, unavailable, now), [data, liveStatus, policy, unavailable, now]);
  const { style, effective, actionable, topView, aligned, opposed, entry, contract, block, active, vetoed, lot, executing } = opp;

  // Trade management and P&L come only from the broker-reconciled controller position.
  const current = aqteControllerCurrent(liveStatus, now);
  const metrics = aqteLiveMetrics(liveStatus, now);
  const filled = !!active && active.filled > 0;
  const confirmed = !!active?.protection_confirmed && !active.error && !liveStatus?.error && current;
  const trailing = !!active?.trailing_active && confirmed;
  const plan = !active ? entry : null;
  // The controller stores entry_price = 0 until the broker fill, so a pending entry measures risk from its limit.
  const base = active ? filled ? active.entry_price : active.limit : plan?.maximum ?? null;
  const initialStop = active?.initial_stop ?? plan?.stop ?? null;
  const risk = base != null && initialStop != null ? base - initialStop : null;
  const hasLevels = !!(active || plan);
  const trailStart = aqteTrailStart(liveStatus, active?.symbol ?? opp.top);
  const management: Array<[string, ReactNode, string?]> = [
    ['Initial Stop Loss', hasLevels ? <>{rupees(initialStop)} <small>({percent(move(base, initialStop))})</small></> : '--', hasLevels ? 'aqx-sell' : ''],
    ['Trailing Stop Loss', active ? <>{rupees(active.stop)} <small>{trailing ? '(Active)' : confirmed ? '(Confirmed SL)' : '(Unverified)'}</small>
      <span role="img" aria-label={trailing ? 'Trailing active' : 'Trailing not active'} className={`aqx-toggle ${trailing ? 'aqx-toggle-on' : ''}`} /></> :
      plan ? `Arms after fill` : '--', trailing ? 'aqx-buy' : ''],
    ['SL Trail Mode', 'Peak bid − 1R (broker SL modify)'],
    ['Trail Distance', risk != null && risk > 0 ? `₹${aqtePrice(risk)} · from +${fixed(trailStart, 1)}R` : '--'],
    ['Profit Booking', hasLevels ? 'Full exit at target · 1 lot' : '--'],
    ['Target', hasLevels ? <>{rupees(active?.target ?? plan?.target)} <small>({percent(move(base, active?.target ?? plan?.target))})</small></> : '--', hasLevels ? 'aqx-buy' : ''],
  ];

  const checks: Check[] = [
    { label: 'Rule Setup', state: actionable ? 'pass' : 'wait',
      value: actionable ? `${effective?.decision} · ${style === 'morning' ? 'Morning' : style === 'scalp' ? 'Scalp' : 'Swing'}` : 'WAIT' },
    { label: 'Signal Aggregation', state: aligned == null ? 'wait' : vetoed ? 'fail' : 'pass',
      value: aligned == null ? '--' : `${aligned} aligned · ${opposed} opposed` },
    { label: 'Conflict Check', state: !topView ? 'wait' : topView.orchestration.conflict ? vetoed ? 'fail' : 'wait' : 'pass',
      value: !topView ? '--' : topView.orchestration.conflict ? vetoed ? 'Veto · WAIT' : 'Majority holds' : 'No conflict' },
    { label: 'Risk Validation', state: block === undefined ? 'wait' : block ? 'fail' : 'pass',
      value: block === undefined ? '--' : block ? 'Blocked' : 'Passed', detail: block || undefined },
    // An open managed trade is the normal capacity-used state, not a failure.
    { label: 'Position & Exposure', state: !current ? 'wait' : active ? 'wait' : 'pass',
      value: !current ? '--' : active ? '1 / 1 open' : 'Within limits' },
    { label: 'Quantity Control', state: current ? 'pass' : 'wait',
      value: current && liveStatus ? `${liveStatus.limits.max_lots} lot${liveStatus.limits.max_lots === 1 ? '' : 's'} (enforced)${lot ? ` · ${lot} qty` : ''}` : '--' },
    { label: 'Trailing Stop', state: trailing ? 'pass' : active && !confirmed ? 'fail' : 'wait',
      value: !current ? '--' : !active ? 'Arms after fill' : trailing ? `Active (₹${aqtePrice(active.stop)})` :
        confirmed ? `Arms at +${fixed(trailStart, 1)}R` : 'SL unconfirmed' },
    { label: 'Profit Booking', state: current ? 'pass' : 'wait', value: current ? 'Target exit (1 lot)' : '--' },
  ];
  const sent = !current ? ['Controller status unverified', 'aqx-exec-off'] : active?.entry_id ? ['Sent to Live Execution (Zerodha)', 'aqx-exec-ready'] :
    executing ? ['Next entry routes to Zerodha (IOC)', 'aqx-exec-ready'] : ['Not sent · awaiting a risk-cleared setup', 'aqx-exec-off'];

  const { info } = aqteOverview(signal, 'real', unavailable, now);
  const live = info?.live && [info.live.at, info.live.received].every(at => now - at >= -1 && now - at <= 5) ? info.live : null;
  const depth = live ? live.buy_depth + live.sell_depth : 0;
  const levels: Fact[] = [
    ['Spot', aqtePrice(info ? signal?.spot : null)],
    ['VWAP', aqtePrice(info?.vwap)],
    ['SuperTrend', info ? `${info.supertrend === 'BULLISH' ? 'Bull' : 'Bear'} ${aqtePrice(info.supertrend_price)}` : '--',
      info?.supertrend === 'BULLISH' ? 'aqx-buy' : info ? 'aqx-sell' : ''],
    ['EMA 9 / 20', info ? `${aqtePrice(info.ema['9'])} / ${aqtePrice(info.ema['20'])}` : '--'],
    ['EMA 50', aqtePrice(info?.ema['50'])],
    ['20-candle high', aqtePrice(info?.breakout_high)],
    ['20-candle low', aqtePrice(info?.breakout_low)],
    ['CPR', info?.cpr ? `${aqtePrice(info.cpr.bottom)} – ${aqtePrice(info.cpr.top)}` : '--'],
    ['ATR (14)', aqtePrice(info?.atr)],
    ['Option entry ≤', aqtePrice(entry?.maximum)],
    ['Option target', aqtePrice(entry?.target), 'aqx-buy'],
    ['Option stop', aqtePrice(entry?.stop), 'aqx-sell'],
  ];
  const flow: Fact[] = [
    ['Book imbalance', live && info?.imbalance != null ? `${aqteSigned(info.imbalance * 100)}%` : '--', valueTone(live ? info?.imbalance : null)],
    ['Buy depth', live ? `${quantity(live.buy_depth)} (${depth ? fixed(live.buy_depth / depth * 100, 1) : '--'}%)` : '--', 'aqx-buy'],
    ['Sell depth', live ? `${quantity(live.sell_depth)} (${depth ? fixed(live.sell_depth / depth * 100, 1) : '--'}%)` : '--', 'aqx-sell'],
    ['Futures OI', live?.oi != null ? quantity(live.oi) : '--'],
    ['OI change (1m)', live?.oi_change != null ? `${live.oi_change > 0 ? '+' : ''}${quantity(live.oi_change)}${live.oi_change_pct != null ? ` (${percent(live.oi_change_pct)})` : ''}` : '--',
      valueTone(live?.oi_change)],
    ['Relative volume', info?.volume_ratio != null ? `${fixed(info.volume_ratio)}×` : '--'],
    ['RSI (14)', aqtePrice(info?.rsi)],
    ['Structure', info ? info.structure.replaceAll('_', ' ').toLowerCase() : '--'],
  ];
  const evidenceNote = unavailable ? 'AQTE data unavailable' : !info ? 'Live evidence appears with a fresh market feed' :
    !live ? 'Live depth/OI unavailable' : null;
  const engineRules = (id: number) => {
    const engine = engines[id - 1];
    return engine?.rules.length ? <RuleList rules={engine.rules} /> :
      <p className="aqx-tab-note">{engine?.reason ?? (unavailable ? 'Engine data unavailable' : 'Waiting for live evaluation')}</p>;
  };
  return (
    <section className="aqx-deck" aria-label="AQTE strategy engines">
      <OpportunityPanel opp={opp} maxLots={liveStatus?.limits.max_lots ?? null} />
      <button type="button" className="aqx-details-toggle" aria-expanded={detailsExpanded}
        onClick={() => setDetailsExpanded(expanded => !expanded)}>
        {detailsExpanded ? 'Hide strategy details' : 'More strategy details'}
      </button>
      <div className={`aqx-cc-trade ${detailsExpanded ? '' : 'aqx-details-hidden'}`}>
        <section className="aqx-card aqx-panel" aria-label="Enterprise trade management">
          <h3 className="aqx-panel-head"><span aria-hidden="true" className="aqx-shield">⛨</span>Enterprise Trade Management
            {plan && <small className="aqx-plan-tag">Plan</small>}</h3>
          <dl className="aqx-mgmt">
            {management.map(([label, value, color]) => <div key={label}><dt>{label}</dt><dd className={color ?? ''}>{value}</dd></div>)}
          </dl>
        </section>
        <section className="aqx-card aqx-panel" aria-label="Live P&L current trade">
          <h3 className="aqx-panel-head"><span aria-hidden="true" className="aqx-bars">▮</span>Live P&amp;L <span>(Current Trade)</span></h3>
          <div className={`aqx-pnl-hero ${metrics?.net_pnl != null && metrics.net_pnl < 0 ? 'aqx-pnl-loss' : ''}`}>
            <div><small>Unrealized P&amp;L (est. net)</small><b className={valueTone(metrics?.net_pnl)}>{signedRupees(metrics?.net_pnl)}</b></div>
            <div className="aqx-pnl-side"><b className={valueTone(metrics?.return_pct)}>{percent(metrics?.return_pct)}</b>
              <small className={valueTone(metrics?.points)}>{metrics?.points != null ? `${aqteSigned(metrics.points)} Points` : active ? 'Quote unverified' : 'No open trade'}</small></div>
          </div>
          <dl className="aqx-pnl-grid">
            <div><dt>Entry</dt><dd>{active ? rupees(filled ? active.entry_price : active.limit) : '--'}</dd></div>
            <div><dt>LTP</dt><dd>{rupees(metrics?.ltp)}</dd></div>
            <div><dt>Points</dt><dd className={valueTone(metrics?.points)}>{aqteSigned(metrics?.points)}</dd></div>
            <div><dt>P&amp;L %</dt><dd className={valueTone(metrics?.return_pct)}>{percent(metrics?.return_pct)}</dd></div>
          </dl>
        </section>
      </div>

      <div className={`aqx-cc-risk ${detailsExpanded ? '' : 'aqx-details-hidden'}`}>
        <section className="aqx-card aqx-panel" aria-label="Orchestration and risk" id="aqte-dash-risk">
          <h3 className="aqx-panel-head"><span aria-hidden="true" className="aqx-net">⌬</span>Orchestration &amp; Risk</h3>
          <ul className="aqx-orch">
            {checks.map(check => (
              <li key={check.label} title={check.detail} className={`aqx-${check.state === 'pass' ? 'pass' : check.state === 'fail' ? 'fail' : 'pending'}`}>
                <span aria-hidden="true">{check.state === 'pass' ? '✓' : check.state === 'fail' ? '✕' : '…'}</span>
                <span>{check.label}</span><b>{check.value}</b>
              </li>
            ))}
          </ul>
          <p className={`aqx-sent ${sent[1]}`}><span aria-hidden="true">→</span>{sent[0]}</p>
        </section>
        <AQTEExecutionHistory liveStatus={liveStatus} now={now} />
      </div>

      <div className={`aqx-card aqx-cc-chart ${detailsExpanded ? '' : 'aqx-details-hidden'}`} id="aqte-dash-analytics">
        <div className="aqx-chart-head">
          <h3 className="aqx-panel-head">Analytics</h3>
          <button type="button" className="aqx-chart-toggle" aria-expanded={analyticsExpanded}
            aria-controls="aqte-analytics-content" onClick={() => setAnalyticsExpanded(expanded => !expanded)}>
            {analyticsExpanded ? 'Collapse analytics' : 'Expand analytics'}
          </button>
        </div>
        {analyticsExpanded && <div id="aqte-analytics-content">
          <div role="tablist" aria-label="Analytics view" className="aqx-ctabs">
            {CHART_TABS.map(([key, label], index) => (
              <button key={key} type="button" role="tab" id={`aqte-ctab-${key}`} aria-selected={tab === key}
                aria-controls={`aqte-cpanel-${key}`} tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)}
                onKeyDown={event => {
                  let next: number;
                  if (event.key === 'ArrowRight') next = (index + 1) % CHART_TABS.length;
                  else if (event.key === 'ArrowLeft') next = (index + CHART_TABS.length - 1) % CHART_TABS.length;
                  else if (event.key === 'Home') next = 0;
                  else if (event.key === 'End') next = CHART_TABS.length - 1;
                  else return;
                  event.preventDefault();
                  setTab(CHART_TABS[next][0]);
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
                }}
                className="aqx-ctab aqx-viewonly min-h-[44px] min-w-0">{label}</button>
            ))}
          </div>
          <div id="aqte-cpanel-chart" role="tabpanel" aria-labelledby="aqte-ctab-chart" hidden={tab !== 'chart'} className="aqx-cpanel aqx-chart">
            {chart}
          </div>
          {tab !== 'chart' && (
            <div id={`aqte-cpanel-${tab}`} role="tabpanel" aria-labelledby={`aqte-ctab-${tab}`} className="aqx-cpanel aqx-cpanel-scroll">
              {tab === 'signals' && (
                <table className="aqx-mini-table">
                  <thead><tr><th>#</th><th>Engine</th><th>Status</th><th>Side</th><th>Rules</th><th>Score</th></tr></thead>
                  <tbody>{engines.map((engine, index) => (
                    <tr key={index}>
                      <td>{String(index + 1).padStart(2, '0')}</td><td>{engine?.name ?? ENGINE_NAMES[index]}</td>
                      <td className={`aqx-st-${(engine?.status ?? 'monitoring').toLowerCase()} aqx-st-text`}>{engine ? STATUS_LABEL[engine.status] : '--'}</td>
                      <td className={sideTone(engine?.side)}>{engine?.side ?? '—'}</td>
                      <td>{engine ? `${engine.passed}/${engine.total}` : '--'}</td>
                      <td>{engine?.score != null ? `${Math.round(engine.score)}%` : '--'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
              {tab === 'levels' && <Facts rows={levels} label="Levels" />}
              {tab === 'flow' && <Facts rows={flow} label="Order flow" />}
              {tab === 'options' && <>
                <Facts label="Options context" rows={[['PCR (subscribed strikes)', fixed(market?.pcr)], ['India VIX', market?.vix != null ? `${fixed(market.vix)} (${percent(market.vix_change_pct)})` : '--'],
                  ['Contract', contract?.trading_symbol ?? '--'], ['Lot size', lot ? String(lot) : '--']]} />
                {engineRules(9)}
              </>}
              {tab === 'mtf' && engineRules(10)}
              {(tab === 'levels' || tab === 'flow') && evidenceNote && <p className="aqx-tab-note">{evidenceNote}</p>}
            </div>
          )}
        </div>}
      </div>

    </section>
  );
}

export default memo(AQTEEngineDeck);
