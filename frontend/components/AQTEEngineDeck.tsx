'use client';

import { memo, useState } from 'react';
import { aqteEffectiveSignal, aqteEngineView, aqteLabel, aqtePrice, aqteRanking,
  type AQTEEngine, type AQTEEngineEvent, type AQTEEnginePolicy, type AQTEEngineStatus,
  type AQTELiveState, type AQTESignal, type AQTESymbol } from '@/lib/aqte-display';

// Stable placeholders keep all 12 cards in place before the first evaluation arrives.
const ENGINE_NAMES = ['Momentum', 'Breakout', 'Trend Following', 'Liquidity Sweep', 'Order Flow', 'Scalping',
  'Mean Reversion', 'Volatility Breakout', 'Options Intelligence', 'Multi-Timeframe', 'Statistical Arbitrage', 'ML Prediction'];
const STATUS_LABEL: Record<AQTEEngineStatus, string> = {
  SATISFIED: 'Satisfied', PARTIAL: 'Partial', MONITORING: 'Monitoring', NOT_SATISFIED: 'Not satisfied',
};
const FILTERS = ['ALL', 'SATISFIED', 'PARTIAL', 'MONITORING', 'NOT_SATISFIED'] as const;
type Filter = typeof FILTERS[number];
const clock = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const fixed = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value) ? '--' : value.toFixed(digits);
const sideTone = (side: 'CE' | 'PE' | null | undefined) => side === 'CE' ? 'aqx-buy' : side === 'PE' ? 'aqx-sell' : 'aqx-wait';
type Check = { label: string; state: 'pass' | 'fail' | 'wait'; value: string };

type Props = {
  symbol: AQTESymbol;
  data?: Partial<Record<AQTESymbol, AQTESignal>>;
  liveStatus: AQTELiveState | null;
  events: AQTEEngineEvent[];
  policy: AQTEEnginePolicy | null;
  unavailable: boolean;
};

function AQTEEngineDeck({ symbol, data, liveStatus, events, policy, unavailable }: Props) {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [open, setOpen] = useState<number | null>(null);
  const view = unavailable ? null : aqteEngineView(data?.[symbol]);
  const engines: Array<AQTEEngine | null> = view?.engines ?? ENGINE_NAMES.map(() => null);
  const orchestration = view?.orchestration ?? null;
  const market = view?.market ?? null;
  const counts = Object.fromEntries(FILTERS.map(key => [key, orchestration == null ? null : key === 'ALL' ? 12 :
    orchestration[key.toLowerCase() as 'satisfied' | 'partial' | 'monitoring' | 'not_satisfied']])) as Record<Filter, number | null>;
  const detail = open == null ? null : engines[open - 1];

  // Top opportunity follows the live controller's ranking; until it reports, rank locally the same way.
  const top = unavailable ? null : (liveStatus?.ranking ?? aqteRanking(data, liveStatus?.styles))[0] ?? null;
  const topSignal = top ? data?.[top] : undefined;
  const style = top ? liveStatus?.styles?.[top] ?? 'scalp' : 'scalp';
  const effective = aqteEffectiveSignal(topSignal, style);
  const actionable = !!effective && effective.decision !== 'WAIT' && !!effective.entry;
  const side = actionable ? effective.decision.slice(-2) as 'CE' | 'PE' : null;
  const topView = aqteEngineView(topSignal);
  const aligned = side && topView ? side === 'CE' ? topView.orchestration.ce : topView.orchestration.pe : null;
  const opposed = side && topView ? side === 'CE' ? topView.orchestration.pe : topView.orchestration.ce : null;
  const entry = actionable ? effective.entry : null;
  const block = top ? liveStatus?.entry_blocks?.[top] : undefined;
  const active = liveStatus?.active ?? null;
  const vetoMin = policy?.veto_min ?? 2;
  const vetoed = policy?.veto !== false && opposed != null && aligned != null && opposed >= vetoMin && opposed > aligned;
  const lot = effective?.contract && 'lot_size' in effective.contract ? effective.contract.lot_size : undefined;
  const executing = actionable && !!liveStatus && liveStatus.automation_on && liveStatus.armed && !liveStatus.killed && !active && block === null;
  const execution = !liveStatus ? 'Controller status unavailable' :
    liveStatus.killed ? 'Emergency stop latched' :
      !actionable ? effective?.reasons[0] ?? 'Waiting for live rule evaluation' :
        block ? block :
          !liveStatus.automation_on || !liveStatus.armed ? 'Auto Trade is not ON and armed' :
            active ? 'One managed position already open' : 'Eligible · central controller places the IOC entry';
  const checks: Check[] = [
    { label: 'Rule setup', state: actionable ? 'pass' : 'wait',
      value: actionable ? `${effective.decision} · ${style === 'scalp' ? 'Scalp' : 'Swing'}` : 'WAIT' },
    { label: 'Engine consensus', state: aligned == null ? 'wait' : vetoed ? 'fail' : 'pass',
      value: aligned == null ? '--' : `${aligned} aligned · ${opposed} opposed` },
    { label: 'Conflict resolution', state: !topView ? 'wait' : topView.orchestration.conflict ? vetoed ? 'fail' : 'wait' : 'pass',
      value: !topView ? '--' : topView.orchestration.conflict ? vetoed ? 'Veto · WAIT' : 'Majority holds' : 'No conflict' },
    { label: 'Risk validation', state: block === undefined ? 'wait' : block ? 'fail' : 'pass',
      value: block === undefined ? '--' : block ? 'Blocked' : 'All gates clear' },
    { label: 'Position limit', state: !liveStatus ? 'wait' : active ? 'fail' : 'pass',
      value: !liveStatus ? '--' : `${active ? 1 : 0} / 1 open` },
    { label: 'Quantity', state: liveStatus ? 'pass' : 'wait',
      value: liveStatus ? `${liveStatus.limits.max_lots} lot max${lot ? ` · ${lot} qty` : ''}` : '--' },
    { label: 'Stop-loss', state: !active ? liveStatus ? 'pass' : 'wait' : active.protection_confirmed ? 'pass' : 'fail',
      value: !active ? liveStatus ? 'Broker SL after fill' : '--' : active.protection_confirmed ? `Confirmed ${aqtePrice(active.stop)}` : 'Unconfirmed' },
    { label: 'Trailing stop', state: active?.trailing_active ? 'pass' : 'wait',
      value: !liveStatus ? '--' : !active ? 'Arms after fill' : active.trailing_active ? `Trailing ${aqtePrice(active.stop)}` : `Arms at ${fixed(active.trail_start_r, 1)}R` },
  ];
  const shown = events.slice(0, 5);

  return (
    <section className="aqx-card aqx-deck" aria-label="AQTE strategy engines">
      <div className="aqx-deck-main">
        <header className="aqx-deck-head">
          <h3 className="aqx-deck-title">Strategy Engines <span>· {aqteLabel(symbol)}</span></h3>
          <div role="group" aria-label="Filter engines" className="aqx-deck-filters">
            {FILTERS.map(key => (
              <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}
                className={`aqx-deck-filter aqx-st-${key.toLowerCase()}`}>
                {key === 'ALL' ? 'All' : STATUS_LABEL[key]} <b>{counts[key] ?? '--'}</b>
              </button>
            ))}
          </div>
        </header>
        <dl className="aqx-deck-context" aria-label="Market context">
          <div><dt>Regime</dt><dd className={market?.regime?.includes('Bullish') ? 'aqx-buy' : market?.regime?.includes('Bearish') ? 'aqx-sell' : ''}>{market?.regime ?? '--'}</dd></div>
          <div><dt>Volatility</dt><dd>{market?.volatility ?? '--'}<small>{market?.vix != null ? ` VIX ${fixed(market.vix)}${market.vix_change_pct != null ? ` (${market.vix_change_pct > 0 ? '+' : ''}${fixed(market.vix_change_pct)}%)` : ''}` : ''}</small></dd></div>
          <div><dt>Liquidity</dt><dd>{market?.liquidity ?? '--'}</dd></div>
          <div><dt>PCR</dt><dd>{fixed(market?.pcr)}</dd></div>
          <div><dt>Consensus</dt><dd className={sideTone(orchestration?.consensus)}>{orchestration?.consensus
            ? `${orchestration.consensus} ${orchestration.consensus_pct ?? '--'}%` : orchestration?.evaluated ? 'None' : '--'}</dd></div>
        </dl>
        <div className="aqx-deck-grid">
          {engines.map((engine, index) => {
            const id = index + 1;
            const status = engine?.status ?? 'MONITORING';
            const dim = filter !== 'ALL' && (!engine || engine.status !== filter);
            return (
              <button key={id} type="button" aria-expanded={open === id} aria-controls="aqte-engine-rules"
                aria-label={`${ENGINE_NAMES[index]}: ${engine ? STATUS_LABEL[status] : 'unavailable'}`}
                disabled={!engine} onClick={() => setOpen(open === id ? null : id)}
                className={`aqx-eng-card aqx-st-${status.toLowerCase()}${dim ? ' aqx-eng-dim' : ''}`}>
                <span className="aqx-eng-top"><span className="aqx-eng-num">{String(id).padStart(2, '0')}</span>
                  <span className="aqx-eng-name">{engine?.name ?? ENGINE_NAMES[index]}</span></span>
                <span className="aqx-eng-badge">{engine ? STATUS_LABEL[status] : '--'}</span>
                <span className="aqx-eng-meta">
                  <span className={sideTone(engine?.side)}>{engine?.side ?? (engine?.authority === 'SHADOW' ? 'Shadow' : '—')}</span>
                  <span>{engine ? `${engine.passed}/${engine.total}` : '--'}</span>
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
            <ul>
              {detail.rules.map(rule => (
                <li key={rule.id} className={rule.passed === true ? 'aqx-pass' : rule.passed === false ? 'aqx-fail' : 'aqx-pending'}>
                  <span aria-hidden="true">{rule.passed === true ? '✓' : rule.passed === false ? '✕' : '…'}</span>
                  <span>{rule.label}<small>{rule.requirement}</small></span>
                  <b>{rule.value ?? (rule.passed == null ? 'No data' : '--')}</b>
                </li>
              ))}
            </ul>
          </>}
        </div>
        <ol className="aqx-ticker" aria-label="Engine events">
          {shown.length ? shown.map(event => (
            <li key={`${event.at}:${event.symbol}:${event.engine}`}>
              <time>{clock.format(new Date(event.at * 1000))}</time>
              <span>{aqteLabel(event.symbol)}</span>
              <span>{`#${String(event.engine).padStart(2, '0')} ${event.name}`}</span>
              <b className={`aqx-st-${event.status.toLowerCase()}`}>{STATUS_LABEL[event.status]}</b>
              {event.side && <span className={sideTone(event.side)}>{event.side}</span>}
            </li>
          )) : <li className="aqx-ticker-empty">{unavailable ? 'Engine events unavailable' : 'No engine status changes yet today'}</li>}
        </ol>
      </div>
      <aside className="aqx-opp" aria-label="Top opportunity">
        <h3 className="aqx-deck-title">Top Opportunity</h3>
        <p className="aqx-opp-head">
          <span>{top ? aqteLabel(top) : '--'}</span>
          <b className={sideTone(side)}>{actionable ? effective.decision : 'WAIT'}</b>
        </p>
        <p className="aqx-opp-contract">{actionable ? effective.contract?.trading_symbol ?? '--' : 'No actionable setup'}</p>
        <dl className="aqx-opp-grid">
          <div><dt>Entry ≤</dt><dd>{aqtePrice(entry?.maximum)}</dd></div>
          <div><dt>Target</dt><dd className="aqx-buy">{aqtePrice(entry?.target)}</dd></div>
          <div><dt>Stop</dt><dd className="aqx-sell">{aqtePrice(entry?.stop)}</dd></div>
          <div><dt>R:R</dt><dd>{entry ? `1:${fixed(entry.reward_risk, 1)}` : '--'}</dd></div>
          <div><dt>Score</dt><dd>{actionable && effective.confidence != null ? `${Math.round(effective.confidence)}%` : '--'}</dd></div>
          <div><dt>Engines</dt><dd className={vetoed ? 'aqx-sell' : aligned ? 'aqx-buy' : ''}>{aligned != null ? `${aligned} / ${topView?.orchestration.evaluated ?? '--'}` : '--'}</dd></div>
        </dl>
        <p className={`aqx-opp-exec ${executing ? 'aqx-pass' : 'aqx-pending'}`} role="status">
          <span aria-hidden="true">{executing ? '●' : '○'}</span>{execution}
        </p>
        <h4 className="aqx-opp-sub">Orchestration &amp; Risk</h4>
        <ul className="aqx-orch">
          {checks.map(check => (
            <li key={check.label} className={`aqx-${check.state === 'pass' ? 'pass' : check.state === 'fail' ? 'fail' : 'pending'}`}>
              <span aria-hidden="true">{check.state === 'pass' ? '✓' : check.state === 'fail' ? '✕' : '…'}</span>
              <span>{check.label}</span><b>{check.value}</b>
            </li>
          ))}
        </ul>
        <p className="aqx-footnote">Engines rank and can veto; only validated Scalp/Swing rules place orders via the single live controller. ML is shadow-only.</p>
      </aside>
    </section>
  );
}

export default memo(AQTEEngineDeck);
