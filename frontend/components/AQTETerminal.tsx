'use client';

import { memo, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { aqteLabel, aqteOverview, aqtePrice, aqteSigned, type AQTEMode, type AQTESignal, type AQTESymbol } from '@/lib/aqte-display';
import type { MarketTick } from '@/hooks/useMarketSocket';
import type { LiveState } from '@/components/AQTELivePanel';

const Chart = dynamic(() => import('@/components/AQTEChart'), {
  ssr: false, loading: () => <div className="aqte-terminal-card aqte-chart-loading">Loading price chart…</div>,
});

function Icon({ kind, tone = 'blue' }: { kind: 'brain' | 'signal' | 'entry' | 'shield' | 'trail' | 'target' | 'chart' | 'logic'; tone?: string }) {
  const paths = {
    brain: 'M9 18V6a3 3 0 0 0-5 2 4 4 0 0 0 0 8 3 3 0 0 0 5 2Zm6 0V6a3 3 0 0 1 5 2 4 4 0 0 1 0 8 3 3 0 0 1-5 2ZM6 10l3 2m9-2-3 2',
    signal: 'M15 5a8 8 0 1 0 4 4M12 8a4 4 0 1 0 4 4m-4 0 8-8m-5 0h5v5',
    entry: 'm3 7 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4',
    shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-3 9 2 2 4-4',
    trail: 'M12 3v18m-5-5 5 5 5-5M4 8l4-4 4 4m4 0h4',
    target: 'M20 12a8 8 0 1 1-8-8m4 8a4 4 0 1 1-4-4m0 4 9-9m-5 0h5v5',
    chart: 'M4 20V9m5 11V5m5 15V11m5 9V3',
    logic: 'M9 18h6m-5 3h4m-5-6a6 6 0 1 1 6 0v3H9v-3Z',
  };
  return <span aria-hidden="true" className={`aqte-terminal-icon aqte-icon-${tone}`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[kind]} /></svg></span>;
}

function CardTitle({ icon, children, tone }: { icon: Parameters<typeof Icon>[0]['kind']; children: ReactNode; tone?: string }) {
  return <h4 className="aqte-card-title"><Icon kind={icon} tone={tone} />{children}</h4>;
}
function Readout({ label, value, tone = '' }: { label: string; value: ReactNode; tone?: string }) {
  return <div className="aqte-data-row"><dt>{label}</dt><dd className={tone}>{value}</dd></div>;
}

function AQTETerminal({ symbol, mode, signal, unavailable, active, tick, controls, execution, liveStatus }: {
  symbol: AQTESymbol; mode: AQTEMode; signal?: AQTESignal; unavailable: boolean;
  active: boolean; tick: MarketTick | null; controls?: ReactNode; execution: ReactNode;
  liveStatus?: LiveState | null;
}) {
  // Once opened, the chart stays mounted so returning to this tab is instant.
  const [chartOpened, setChartOpened] = useState(active);
  if (active && !chartOpened) setChartOpened(true);
  const view = aqteOverview(signal, mode, unavailable);
  const { entry, info, position } = view;
  const real = mode === 'real';
  const live = real && liveStatus?.active?.symbol === symbol ? liveStatus.active : null;
  const liveCurrent = !!live && !liveStatus?.error && !live.error && live.metrics && !live.metrics.stale;
  const contract = live?.contract.trading_symbol ?? view.contract;
  const entryPrice = real ? live && live.filled > 0 ? live.entry_price : null : entry?.maximum;
  const stop = real ? live?.protection_confirmed ? live.stop : null : view.stop;
  const trailing = real ? !!live?.trailing_active && !!live.protection_confirmed : view.trailing;
  const target = real ? live?.target : view.target;
  const prefix = `aqte-terminal-${symbol}`;
  const safeReasons = unavailable ? ['Waiting for current backend evidence'] :
    real ? ['Real entries require daily arming and explicit automation ON.', 'Execution prices and broker stops are shown below; paper plans are excluded.'] :
      signal?.reasons.length ? signal.reasons : ['Waiting for a confirmed setup'];
  return (
    <div className="aqte-terminal">
      <div className="aqte-terminal-main">
        <div className="aqte-overview-grid" id={`${prefix}-overview`}>
          <div className="aqte-terminal-card aqte-overview-tile">
            <CardTitle icon="brain">Market View</CardTitle>
            <strong className={`aqte-hero-value ${view.direction === 'BULLISH' ? 'aqte-up' : view.direction === 'BEARISH' ? 'aqte-down' : 'aqte-muted'}`}>{view.direction === 'WAITING' ? '--' : view.direction}</strong>
            <p className="aqte-muted">{info ? info.structure.replaceAll('_', ' ') : 'No live intelligence'}</p>
          </div>
          <div className="aqte-terminal-card aqte-overview-tile">
            <CardTitle icon="signal" tone="red">Trade Signal</CardTitle>
            <strong className={`aqte-hero-value ${live?.filled || view.decision !== 'WAIT' ? 'aqte-up' : 'aqte-muted'}`}>{live?.filled ? 'LONG OPEN' : view.decision === 'WAIT' ? '--' : view.decision}</strong>
            {contract && <p className="aqte-contract">{contract}</p>}
            {view.confidence != null && <div className="aqte-confidence"><span>Rule score</span><strong>{view.confidence}/100</strong></div>}
          </div>
          <div className="aqte-terminal-card aqte-overview-tile">
            <CardTitle icon="entry" tone="cyan">Entry Price</CardTitle>
            <strong className="aqte-hero-value">{aqtePrice(entryPrice)}</strong>
            <p className="aqte-muted">{real ? live && live.filled > 0 ? 'Broker average' : 'Awaiting fill' : 'Suggested range'}</p>
            {live ? <p>LTP: {aqtePrice(liveCurrent ? live.metrics.ltp : null)}</p> :
              entry && <p>{aqtePrice(entry.low)} – {aqtePrice(entry.high)}</p>}
          </div>
          <div className="aqte-terminal-card aqte-overview-tile">
            <CardTitle icon="shield" tone="red">Stop Loss</CardTitle>
            <strong className="aqte-hero-value aqte-down">{aqtePrice(stop)}</strong>
            <p className="aqte-muted">{real ? live?.protection_confirmed ? 'Broker-confirmed SL' : 'Protection not confirmed' : position ? 'Current paper SL' : 'Planned initial stop'}</p>
            {entry && <p className="aqte-down">{aqteSigned(entry.stop - entry.maximum)} pts</p>}
          </div>
          <div className="aqte-terminal-card aqte-overview-tile">
            <CardTitle icon="trail" tone="purple">Trailing Stop Loss</CardTitle>
            <strong className={`aqte-hero-value ${trailing ? 'aqte-up' : 'aqte-muted'}`}>{trailing ? 'ACTIVE' : '--'}</strong>
            {live || position ? <p className={trailing ? 'aqte-up' : 'aqte-muted'}>{real ? `Starts at +${live?.trail_start_r ?? 1}R` : 'Starts at +1R'}</p> : null}
            {trailing && <p>Current TSL: {aqtePrice(stop)}</p>}
          </div>
          <div className="aqte-terminal-card aqte-overview-tile">
            <CardTitle icon="target" tone="gold">Targets</CardTitle>
            <strong className="aqte-hero-value aqte-up">{aqtePrice(target)}</strong>
            <dl className="aqte-target-list">
              <Readout label="Net R / R" value={entry ? `${entry.reward_risk} : 1` : '--'} />
            </dl>
          </div>
        </div>
        <div className="aqte-market-grid" id={`${prefix}-market`}>
          {chartOpened ? <Chart symbol={symbol} tick={tick} /> : <div className="aqte-terminal-card aqte-chart-loading">Chart opens with this index tab.</div>}
          <section className="aqte-terminal-card aqte-flow-card" aria-label="Order book and market intelligence">
            <h4 className="aqte-small-title">Order Book <span className="aqte-muted">· Selected option</span></h4>
            <div className="aqte-depth-table" role="table" aria-label="Option depth availability">
              <div role="row"><span role="columnheader">Qty</span><span role="columnheader">Bid</span><span role="columnheader">Ask</span><span role="columnheader">Qty</span></div>
              <div role="row"><span role="cell">--</span><span role="cell" className="aqte-up">--</span><span role="cell" className="aqte-down">--</span><span role="cell">--</span></div>
            </div>
            <p className="aqte-muted aqte-depth-note">Option depth is not exposed by the current AQTE dashboard API. No synthetic book.</p>
            <dl className="aqte-flow-values">
              <Readout label="Option LTP" value={real ? live ? aqtePrice(liveCurrent ? live.metrics.ltp : null) : 'See position' : aqtePrice(view.ltp)} tone="aqte-up" />
              <Readout label="Order imbalance" value={info?.imbalance != null ? aqteSigned(info.imbalance * 100) + '%' : '--'} />
              <Readout label="Volume expansion" value={info ? `${aqtePrice(info.volume_ratio)}×` : '--'} />
              <Readout label="RSI" value={aqtePrice(info?.rsi)} />
              <Readout label="ATR" value={aqtePrice(info?.atr)} />
              <Readout label="VWAP" value={aqtePrice(info?.vwap)} tone="aqte-gold" />
            </dl>
            <p className="aqte-card-footer">Indicators above use futures, not option ticks.</p>
          </section>
          <aside className="aqte-terminal-card aqte-control-card" id={`${prefix}-risk`}>
            <CardTitle icon="shield" tone="blue">Auto Trading Control</CardTitle>
            <div className="aqte-mode-banner">{real ? 'LIVE · SAFETY GATED' : 'PAPER · NO REAL ORDERS'}</div>
            {controls}
            <dl>
              <Readout label="Entry type" value="Long options only" tone="aqte-up" />
              <Readout label="Real position size" value="1 lot max" />
              <Readout label="New entries" value={real ? 'Daily arm + ON required' : 'Backend paper engine'} />
              <Readout label="Protective exits" value={real ? 'Continue while OFF' : 'Paper simulation'} tone="aqte-cyan" />
            </dl>
            <p className="aqte-control-note">{real ? 'Daily limits do not force trades. Emergency stop and broker acknowledgements remain in the execution panel below.' : 'The header switch controls real trading separately. Paper mode never sends real entry orders.'}</p>
          </aside>
        </div>
        <details className="aqte-terminal-card" id={`${prefix}-research`}>
        <summary className="min-h-[44px] cursor-pointer py-3 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Analysis, trade setup, strategy &amp; expected profit</summary>
        <div className="aqte-research-grid" id={`${prefix}-analysis`}>
          <section className="aqte-terminal-card">
            <CardTitle icon="brain" tone="cyan">Analysis</CardTitle>
            <ul className="aqte-analysis-list">{safeReasons.map((reason, i) => <li key={`${i}:${reason}`}><span aria-hidden="true" className="aqte-cyan">●</span>{reason}</li>)}</ul>
            <p className="aqte-card-footer">Explainable rules · Not a calibrated win probability</p>
          </section>
          <section className="aqte-terminal-card">
            <CardTitle icon="signal" tone="red">Trade Setup</CardTitle>
            <p className="aqte-contract">{view.contract ?? 'No approved entry plan'}</p>
            <dl>
              <Readout label="Signal" value={view.decision} tone={entry ? 'aqte-up' : ''} />
              <Readout label="Maximum buy" value={aqtePrice(entry?.maximum)} />
              <Readout label="Entry range" value={entry ? `${aqtePrice(entry.low)} – ${aqtePrice(entry.high)}` : '--'} />
              <Readout label="Stop loss" value={aqtePrice(entry?.stop)} tone="aqte-down" />
              <Readout label="Target" value={aqtePrice(entry?.target)} tone="aqte-up" />
              <Readout label="Reward / risk" value={entry?.reward_risk ?? '--'} />
            </dl>
          </section>
          <section className="aqte-terminal-card">
            <CardTitle icon="logic" tone="gold">Strategy Logic</CardTitle>
            <dl>
              <Readout label="Strategy" value={!real && !unavailable && signal?.strategy ? signal.strategy.replaceAll('_', ' ') : 'Awaiting setup'} tone="aqte-cyan" />
              <Readout label="Regime" value={view.direction} />
              <Readout label="Structure" value={info?.structure.replaceAll('_', ' ') ?? '--'} />
              <Readout label="EMA 9" value={aqtePrice(info?.ema['9'])} tone="aqte-cyan" />
              <Readout label="EMA 20" value={aqtePrice(info?.ema['20'])} tone="aqte-gold" />
              <Readout label="EMA 50" value={aqtePrice(info?.ema['50'])} />
              <Readout label="Model" value="Unvalidated rule baseline" />
            </dl>
          </section>
          <section className="aqte-terminal-card">
            <CardTitle icon="chart" tone="cyan">Expected Profit <span className="aqte-muted">· Illustration</span></CardTitle>
            <dl>
              <Readout label="Planned move" value={entry ? `${aqteSigned(entry.target - entry.maximum)} pts` : '--'} tone="aqte-up" />
              <Readout label="Planned return" value={entry ? `${aqteSigned((entry.target - entry.maximum) / entry.maximum * 100)}%` : '--'} tone="aqte-up" />
              <Readout label="Quantity" value={entry?.quantity ?? '--'} />
              <Readout label="Gross at target" value={view.expected == null ? '--' : `INR ${aqtePrice(view.expected)}`} tone="aqte-up" />
            </dl>
            <p className="aqte-control-note">Illustration only, before fees and slippage. Target execution and profits are not guaranteed. No extra targets or scalp returns are invented.</p>
          </section>
        </div>
        </details>
        {!real && <section id={`${prefix}-execution`} className="aqte-execution-dock" aria-label={`${aqteLabel(symbol)} execution workspace`}>
          <h4 className="aqte-dock-title"><Icon kind="entry" tone="blue" />Positions &amp; P&amp;L <span>{real ? 'REAL · BROKER STATE' : 'PAPER · SIMULATION'}</span></h4>
          {execution}
        </section>}
      </div>
    </div>
  );
}

export default memo(AQTETerminal);
