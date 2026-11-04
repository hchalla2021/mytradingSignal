'use client';

import { memo, useMemo, useState, type ReactNode } from 'react';
import { aqteBlockLabel, aqteControllerCurrent, aqteDaySummary, aqteEffectiveSignal, aqteEngineView, aqteIndexHold, aqteLabel, aqteLiveMetrics,
  aqteOpportunitySymbol, aqteOverview, aqtePrice, aqteRanking, aqteSameJson, aqteSigned, aqteTrailStart,
  type AQTEEngine, type AQTEEngineEvent, type AQTEEnginePolicy, type AQTEEngineStatus,
  type AQTELiveState, type AQTEOrchestration, type AQTESignal, type AQTESymbol } from '@/lib/aqte-display';

// Stable placeholders keep all 12 cards in place before the first evaluation arrives.
const ENGINE_NAMES = ['Momentum', 'Breakout', 'Trend Following', 'Liquidity Sweep', 'Order Flow', 'Scalping',
  'Mean Reversion', 'Volatility Breakout', 'Options Intelligence', 'Multi-Timeframe', 'Statistical Arbitrage', 'ML Prediction'];
const PLACEHOLDER_ENGINES: Array<AQTEEngine | null> = ENGINE_NAMES.map(() => null);
const SHORT_NAMES = ['Momentum', 'Breakout', 'Trend', 'Liquidity', 'Order Flow', 'Scalping',
  'Mean Rev', 'Volatility', 'Options', 'MTF', 'Stat Arb', 'ML'];
const ENGINE_ICONS = [
  'M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2m-1-4 9-9c2-2 5-2 5-2s0 3-2 5l-9 9-3-3zm6-3h.01',
  'M4 20v-5M9 20v-9M14 20V7M19 20V3',
  'M3 17l6-6 4 4 8-8M15 7h6v6',
  'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  'M5 20V9M10 20V4M15 20v-8M20 20v-5',
  'M13 2 4 14h7l-1 8 9-12h-7l1-8z',
  'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  'M2 12h4l3-8 4 16 3-8h6',
  'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  'M12 2 2 7l10 5 10-5-10-5zM2 12l10 5 10-5M2 17l10 5 10-5',
  'M12 3v18M5 7h14M5 7l-3 6a3 3 0 0 0 6 0L5 7zm14 0-3 6a3 3 0 0 0 6 0l-3-6zM8 21h8',
  'M7 7h10v10H7zM10 2v5M14 2v5M10 17v5M14 17v5M2 10h5M2 14h5M17 10h5M17 14h5',
];
const STATUS_LABEL: Record<AQTEEngineStatus, string> = {
  SATISFIED: 'Satisfied', PARTIAL: 'Partial', MONITORING: 'Monitoring', NOT_SATISFIED: 'Not satisfied',
};
const STATUS_ICON: Record<AQTEEngineStatus, string> = { SATISFIED: '✓', PARTIAL: '◐', MONITORING: '◎', NOT_SATISFIED: '✕' };
const FILTERS = ['ALL', 'SATISFIED', 'PARTIAL', 'MONITORING', 'NOT_SATISFIED'] as const;
type Filter = typeof FILTERS[number];
const CHART_TABS = [['chart', 'Price Chart'], ['signals', 'Engine Signals'], ['levels', 'Levels'],
  ['flow', 'Order Flow'], ['options', 'Options'], ['mtf', 'Multi-TF']] as const;
type ChartTab = typeof CHART_TABS[number][0];
const clock = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
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
  events: AQTEEngineEvent[];
  policy: AQTEEnginePolicy | null;
  unavailable: boolean;
  now?: number;
  chart?: ReactNode;
  onViewAll?: () => void;
};

function Icon({ path }: { path: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>;
}

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

type BoardProps = {
  symbol: AQTESymbol; engines: Array<AQTEEngine | null>; orchestration: AQTEOrchestration | null; online: boolean;
  filter: Filter; setFilter: (filter: Filter) => void; open: number | null; setOpen: (id: number | null) => void;
};
// Polls replace the snapshot object every 2 s; identical engine data must not repaint 12 cards.
const sameBoard = (a: BoardProps, b: BoardProps) => a.symbol === b.symbol && a.online === b.online &&
  a.filter === b.filter && a.open === b.open && a.setFilter === b.setFilter && a.setOpen === b.setOpen &&
  aqteSameJson(a.engines, b.engines) && aqteSameJson(a.orchestration, b.orchestration);

/** Short card text for an engine with no evaluated rules; the full backend reason stays in the tooltip. */
function idleLabel(reason: string | null | undefined) {
  return !reason ? 'Awaiting live data' : /outside regular market session/i.test(reason) ? 'Market closed'
    : /warming up|opening range/i.test(reason) ? 'Warming up'
      : /stale|no ticks|waiting for fresh/i.test(reason) ? 'Feed stale'
        : /shadow model/i.test(reason) ? 'Shadow model off' : 'Awaiting live data';
}

const EngineBoard = memo(function EngineBoard({ symbol, engines, orchestration, online, filter, setFilter, open, setOpen }: BoardProps) {
  const counts = Object.fromEntries(FILTERS.map(key => [key, orchestration == null ? null : key === 'ALL' ? engines.length :
    orchestration[key.toLowerCase() as 'satisfied' | 'partial' | 'monitoring' | 'not_satisfied']])) as Record<Filter, number | null>;
  const detail = open == null ? null : engines[open - 1];
  const running = engines.filter(engine => engine && engine.total > 0 && engine.status !== 'MONITORING').length;
  const idle = online && !running ? engines[0]?.reason ?? null : null;
  return (
    <div className="aqx-card aqx-deck-main" id="aqte-dash-engines">
      <header className="aqx-deck-head">
        <h3 className="aqx-deck-title">AQTE Strategy Engines (12)
          <span> · {aqteLabel(symbol)} · {online ? running ? `${running}/12 engines evaluated from shared data` : 'All engines monitoring' : 'Engines offline'}</span>
          {idle && <span className="aqx-deck-idle"> · {idle}</span>}
          <span className={sideTone(orchestration?.consensus)}>{orchestration?.consensus
            ? ` · Consensus ${orchestration.consensus} ${orchestration.consensus_pct ?? '--'}%` : ''}</span>
        </h3>
        <div role="group" aria-label="Filter engines" className="aqx-deck-filters">
          {FILTERS.map(key => (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}
              className={`aqx-deck-filter aqx-st-${key.toLowerCase()}`}>
              {`${key === 'ALL' ? 'All' : STATUS_LABEL[key]} (${counts[key] ?? '--'})`}
            </button>
          ))}
        </div>
      </header>
      <p className="aqx-footnote">Scalp/swing rules control entry. Engines rank or veto; ML is shadow-only.</p>
      <div className="aqx-deck-grid">
        {engines.map((engine, index) => {
          const id = index + 1;
          const status = engine?.status ?? 'MONITORING';
          const dim = filter !== 'ALL' && (!engine || engine.status !== filter);
          return (
            <button key={id} type="button" aria-expanded={open === id} aria-controls="aqte-engine-rules"
              aria-label={`${ENGINE_NAMES[index]}: ${engine ? STATUS_LABEL[status] : 'unavailable'}`}
              title={engine?.reason ?? undefined}
              disabled={!engine} onClick={() => setOpen(open === id ? null : id)}
              className={`aqx-eng-card aqx-st-${status.toLowerCase()}${dim ? ' aqx-eng-dim' : ''}`}>
              <span className="aqx-eng-num">{String(id).padStart(2, '0')}</span>
              <span className="aqx-eng-icon"><Icon path={ENGINE_ICONS[index]} /></span>
              <span className="aqx-eng-name">{engine?.name ?? ENGINE_NAMES[index]}</span>
              <span className="aqx-eng-badge"><span aria-hidden="true">{engine ? STATUS_ICON[status] : ''}</span> {engine ? STATUS_LABEL[status] : '--'}</span>
              <span className="aqx-eng-meta">
                <span>{!engine ? '-- Rules' : engine.total ? <>{`${engine.passed} / ${engine.total}`}<span className="aqx-eng-rules-word"> Rules</span></> : idleLabel(engine.reason)}
                  {engine?.side ? <b className={sideTone(engine.side)}> · {engine.side}</b> : engine?.authority === 'SHADOW' && engine.total ? ' · Shadow' : ''}</span>
                <span>{engine?.score != null ? `${Math.round(engine.score)}%` : '--'}</span>
              </span>
              <span aria-hidden="true" className="aqx-eng-bar"><i style={{ transform: `scaleX(${(engine?.score ?? 0) / 100})` }} /></span>
            </button>
          );
        })}
      </div>
      <div id="aqte-engine-rules" className="aqx-eng-rules" hidden={!detail}>
        {detail && <>
          <p className="aqx-eng-rules-head"><b>{String(detail.id).padStart(2, '0')} {detail.name}</b>
            <span>{detail.authority === 'SHADOW' ? 'Shadow only · no order authority' : detail.authority === 'ENTRY' ? 'Shared with live entry rules' : 'Advisory · ranks and vetoes'}</span></p>
          {detail.reason && <p className="aqx-eng-reason">{detail.reason}</p>}
          <RuleList rules={detail.rules} />
        </>}
      </div>
    </div>
  );
}, sameBoard);

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
  const execution = !liveStatus ? 'Controller status unavailable' :
    liveStatus.killed ? 'Emergency stop latched' :
      controllerBlock ? controllerBlock :
      active ? 'One managed position already open' :
      held ? 'No index can trade today · every index is disabled or at its trade limit in Controls' :
      arming ? liveStatus.automation_waiting || 'Auto Trade ON · waiting to arm for the market session' :
      sessionClosed ? 'New entries permitted only from 09:15 to 15:15 IST' :
      !actionable ? block || effective?.reasons[0] || 'Waiting for live rule evaluation' :
        block ? block :
          vetoed ? `Engine veto · WAIT (${opposed} oppose ${side}, ${aligned} aligned)` :
          !liveStatus.automation_on || !liveStatus.armed ? 'Auto Trade is not ON and armed' :
            'Eligible · central controller places the IOC entry';
  const autoState = !liveStatus ? ['UNKNOWN', 'aqx-exec-wait'] : liveStatus.killed ? ['STOPPED', 'aqx-exec-stop'] :
    controllerBlock ? ['BLOCKED', 'aqx-exec-off'] : active ? ['IN TRADE', 'aqx-exec-live'] : executing ? ['READY', 'aqx-exec-ready'] :
      !liveStatus.automation_on && !arming ? ['OFF', 'aqx-exec-off'] : held ? ['BLOCKED', 'aqx-exec-off'] : ['WAITING', 'aqx-exec-wait'];
  const score = actionable && effective.confidence != null && Number.isFinite(effective.confidence)
    ? Math.max(0, Math.min(100, effective.confidence)) : null;
  // Same order the controller scans; rows carry a short block label and the full reason as a tooltip.
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
    const state = hold ?? (unavailable || !signal ? 'No data' : gate ? aqteBlockLabel(gate)
      : gate === null ? first ? 'Top pick' : 'Clear' : 'Unverified');
    return { symbol, side: ready ? signal.decision.slice(-2) as 'CE' | 'PE' : null, confidence,
      state: first && gate ? `Top · ${state}` : state, reason: gate || undefined, top: first };
  });
  return { top, style, effective, actionable, side, topView, aligned, opposed, alignedNames, entry, contract, strike,
    block, active, vetoed, lot, executing, execution, autoState, score, ladder };
}

const RING = 2 * Math.PI * 30;
const OpportunityPanel = memo(function OpportunityPanel({ opp, maxLots }: { opp: Opportunity; maxLots: number | null }) {
  const { top, side, actionable, alignedNames, aligned, opposed, vetoed, contract, strike, style, score, entry, autoState, executing, execution, ladder } = opp;
  return (
    <aside className="aqx-card aqx-opp" aria-label="Top opportunity" id="aqte-dash-opportunity">
      <h3 className="aqx-panel-head"><span aria-hidden="true" className="aqx-crown">♛</span>Current Opportunity <span>(Top Ranked)</span></h3>
      <div className="aqx-opp-hero" data-side={side ?? 'WAIT'}>
        <div className="min-w-0">
          <p className="aqx-opp-name">{top ? `${aqteLabel(top)}${strike != null ? ` ${strike.toLocaleString('en-IN')}` : ''}${side ? ` ${side}` : ''}` : '--'}</p>
          <p className="aqx-opp-tags">
            <b className={`aqx-side-chip ${side ? side === 'CE' ? 'aqx-chip-ce' : 'aqx-chip-pe' : 'aqx-chip-wait'}`}>{actionable ? 'BUY' : 'WAIT'}</b>
            <span>{alignedNames.length ? alignedNames.join(' + ') : actionable ? 'Rule engine' : 'No actionable setup'}</span>
          </p>
          {aligned != null && opposed != null && (
            <p className={`aqx-opp-consensus ${vetoed ? 'aqx-sell' : 'aqx-buy'}`}>
              {`${aligned} aligned · ${opposed} opposed${vetoed ? ' · Veto · WAIT' : ''}`}
            </p>
          )}
          <p className="aqx-opp-contract">{contract?.trading_symbol ?? (top ? `${aqteLabel(top)} · ${style === 'scalp' ? 'Scalp' : 'Swing'}` : '--')}</p>
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
            <li key={name} className={first ? 'aqx-rank-top' : ''} data-side={rowSide ?? 'WAIT'} title={reason}>
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
        <small>{execution}</small>
      </div>
    </aside>
  );
});

function AQTEEngineDeck({ symbol, data, liveStatus, events, policy, unavailable, now = Date.now() / 1000, chart, onViewAll }: Props) {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [open, setOpen] = useState<number | null>(null);
  const [tab, setTab] = useState<ChartTab>('chart');
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

  const day = aqteDaySummary(liveStatus, now);
  const executions = current ? [
    ...(active ? [{ key: active.id, at: active.fill_at ?? active.entry_at, instrument: active.contract.trading_symbol,
      qty: Math.max(0, active.filled - (active.exited ?? 0)), pnl: metrics?.net_pnl ?? null, pct: metrics?.return_pct ?? null,
      status: filled ? 'Open' : 'Pending' }] : []),
    ...[...day.trades].reverse().map((trade, index) => ({ key: `${trade.exit_at}:${index}`, at: trade.entry_at ?? trade.exit_at,
      instrument: trade.contract?.trading_symbol ?? aqteLabel(trade.symbol), qty: trade.filled ?? null,
      pnl: trade.exit_unverified ? null : trade.net_pnl,
      pct: move(trade.entry_price, trade.exit_price), status: 'Exited' })),
  ].slice(0, 4) : [];

  const checks: Check[] = [
    { label: 'Rule Setup', state: actionable ? 'pass' : 'wait',
      value: actionable ? `${effective?.decision} · ${style === 'scalp' ? 'Scalp' : 'Swing'}` : 'WAIT' },
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
  const shown = events.slice(0, 4);

  return (
    <section className="aqx-deck" aria-label="AQTE strategy engines">
      <OpportunityPanel opp={opp} maxLots={liveStatus?.limits.max_lots ?? null} />
      <div className="aqx-cc-trade">
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

      <div className="aqx-cc-risk">
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
        <section className="aqx-card aqx-panel" aria-label="Recent executions">
          <h3 className="aqx-panel-head"><span aria-hidden="true" className="aqx-net">↻</span>Recent Executions <span>(Live)</span>
            {onViewAll && <button type="button" className="aqx-link aqx-viewonly" onClick={onViewAll}>View All</button>}</h3>
          <table className="aqx-mini-table aqx-exec-table">
            <thead><tr><th>Time</th><th>Instrument</th><th>Side</th><th>Qty</th><th>P&amp;L (₹)</th><th>P&amp;L %</th><th>Status</th></tr></thead>
            <tbody>
              {executions.length ? executions.map(row => (
                <tr key={row.key}>
                  <td>{clock.format(new Date(row.at * 1000))}</td><td className="aqx-ellipsis">{row.instrument}</td>
                  <td><span className="aqx-side-chip aqx-chip-ce">BUY</span></td><td>{quantity(row.qty)}</td>
                  <td className={valueTone(row.pnl)}>{aqteSigned(row.pnl)}</td><td className={valueTone(row.pct)}>{percent(row.pct)}</td>
                  <td><span className={`aqx-status-chip ${row.status === 'Open' ? 'aqx-status-open' : ''}`}>{row.status}</span></td>
                </tr>
              )) : <tr><td colSpan={7} className="aqx-empty-row">{current ? 'No AQTE executions today' : 'Execution history unavailable'}</td></tr>}
            </tbody>
          </table>
        </section>
      </div>

      <EngineBoard symbol={symbol} engines={engines} orchestration={view?.orchestration ?? null} online={!!view}
        filter={filter} setFilter={setFilter} open={open} setOpen={setOpen} />

      <div className="aqx-card aqx-cc-chart" id="aqte-dash-analytics">
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
      </div>

      <section className="aqx-card aqx-events" aria-label="Live engine events" id="aqte-dash-events">
        <h3 className="aqx-panel-head"><span aria-hidden="true" className={`aqx-live-dot${unavailable ? ' aqx-live-dot-off' : ''}`} />Live Engine Events <span>{unavailable ? '(Offline)' : '(Real-time)'}</span></h3>
        <ol className="aqx-ticker" aria-label="Engine events">
          {shown.length ? shown.map(event => (
            <li key={`${event.at}:${event.symbol}:${event.engine}`}>
              <time>{clock.format(new Date(event.at * 1000))}</time>
              <span>{`${aqteLabel(event.symbol)} · Engine ${String(event.engine).padStart(2, '0')} (${event.name})`}</span>
              <b className={`aqx-st-${event.status.toLowerCase()}`}>{STATUS_ICON[event.status]} {STATUS_LABEL[event.status]}</b>
              {event.side && <span className={sideTone(event.side)}>– {event.side}</span>}
            </li>
          )) : <li className="aqx-ticker-empty">{unavailable ? 'Engine events unavailable'
            : 'No engine status changes since AQTE started · changes appear while the market feed is live'}</li>}
        </ol>
      </section>
    </section>
  );
}

export default memo(AQTEEngineDeck);
