'use client';

import { memo, useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { API_CONFIG } from '@/lib/api-config';
import AQTELiveController from '@/components/AQTELiveController';
import AQTEAutomationSwitch from '@/components/AQTEAutomationSwitch';
import type { MarketData, MarketTick } from '@/hooks/useMarketSocket';
import AQTEDailyControl from '@/components/AQTEDailyControl';
import AQTETerminal from '@/components/AQTETerminal';
import AQTEBrokerPositions from '@/components/AQTEBrokerPositions';
import AQTEEngineDeck from '@/components/AQTEEngineDeck';
import AQTEMorningEngine from '@/components/AQTEMorningEngine';
import { AQTE_RECONNECT_GRACE_MS, aqteCanExit, aqteConnectionDrop, aqteDaySummary, aqteEngineView, aqteErrorText, aqteFeedCurrent, aqteLiveMetrics,
  aqtePollLoop, isAqteEngineEvent, isAqteIntelligence, isAqteRuleChecks,
  type AQTEEngineEvent, type AQTEEnginePolicy, type AQTELiveState, type AQTEExitRequest, type AQTESignal } from '@/lib/aqte-display';
import { prefetchChartHistory } from '@/hooks/useChartHistory';

const Chart = dynamic(() => import('@/components/AQTEChart'), {
  ssr: false, loading: () => <div className="aqte-terminal-card aqte-chart-loading">Loading price chart…</div>,
});
const SYMBOLS = ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const;
const LABELS = { NIFTY: 'NIFTY', BANKNIFTY: 'BANK NIFTY', SENSEX: 'SENSEX' };
const INDEX_STYLES = {
  NIFTY: { border: 'border-cyan-400/30', bar: 'bg-cyan-400', text: 'text-cyan-300' },
  BANKNIFTY: { border: 'border-indigo-400/30', bar: 'bg-indigo-400', text: 'text-indigo-300' },
  SENSEX: { border: 'border-violet-400/30', bar: 'bg-violet-400', text: 'text-violet-300' },
};
type SymbolName = typeof SYMBOLS[number];
type Snapshot = {
  mode: 'ANALYSIS_ONLY';
  generated_at: number;
  data: Record<SymbolName, AQTESignal>;
  risk: { realized_pnl: number; trades: number; max_trades: number; killed: boolean };
  subscription_error: string | null;
  fault: string | null;
  recording: boolean;
  engine_events?: unknown;
  engine_policy?: AQTEEnginePolicy | null;
};

const number = (value: number) => value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '--' : `${value > 0 ? '+' : ''}${number(value)}`;
const money = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '--' : `${value > 0 ? '+' : value < 0 ? '−' : ''}₹${number(Math.abs(value))}`;
const tone = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) || value === 0 ? 'aqx-flat' : value > 0 ? 'aqx-up' : 'aqx-down';
const exitClock = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
const headClock = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const headDate = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
type Quote = { signal?: AQTESignal; streaming: boolean; tick: MarketTick | null; price: number | null };
type Panel = 'active' | 'today' | 'positions' | 'performance' | 'controls';
const ICONS = {
  trades: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  performance: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 10h.1a2 2 0 1 1 0 4z',
};
const CONTEXT_ICONS = ['M3 17l6-6 4 4 8-8', 'M2 12h4l3-8 4 16 3-8h6', 'M12 2.7c-3 4-6 7-6 11a6 6 0 0 0 12 0c0-4-3-7-6-11z',
  'M12 3v18M3 12h18', 'M13 2 4 14h7l-1 8 9-12h-7l1-8z'];
const BAND_TONE: Record<string, string> = { Low: 'aqx-up', Moderate: 'aqx-wait', High: 'aqx-down' };
const contextTone = (kind: 'regime' | 'volatility' | 'liquidity', value: string | null | undefined) =>
  !value ? 'aqx-flat' : kind === 'regime' ? /bull/i.test(value) ? 'aqx-up' : /bear/i.test(value) ? 'aqx-down' : 'aqx-wait' :
    kind === 'volatility' ? BAND_TONE[value] ?? 'aqx-cyan' :
      value === 'High' ? 'aqx-up' : value === 'Low' ? 'aqx-down' : value === 'Moderate' ? 'aqx-wait' : 'aqx-cyan';
function NavIcon({ path }: { path: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>;
}

type CardView = { price: number | null; change: number | null; pct: number | null; note: string | null; tag: string | null };
const finiteOrNull = (value: number | null | undefined) => value != null && Number.isFinite(value) ? value : null;
/**
 * What an index card shows. Only a fresh LIVE tick streams; a backend CLOSED tick is the official
 * session close and is shown tagged "Closed". Stale, demo or disconnected LIVE ticks are never shown.
 */
function indexCardView(quote: Quote, tick: MarketTick | null | undefined, unavailable: boolean, marketHours: boolean): CardView {
  if (quote.streaming && quote.tick) {
    const change = finiteOrNull(quote.tick.change), pct = finiteOrNull(quote.tick.changePercent);
    return { price: quote.tick.price, change, pct, note: change == null || pct == null ? 'LIVE FEED' : null, tag: null };
  }
  if (!marketHours && tick?.status === 'CLOSED' && Number.isFinite(tick.price) && tick.price > 0) {
    const change = finiteOrNull(tick.change), pct = finiteOrNull(tick.changePercent);
    return { price: tick.price, change, pct, note: change == null || pct == null ? 'LAST CLOSE' : null, tag: 'Closed' };
  }
  if (quote.price != null) return { price: quote.price, change: null, pct: null, note: unavailable ? 'LAST SNAPSHOT' : 'AQTE SNAPSHOT', tag: null };
  return { price: null, change: null, pct: null, tag: null,
    note: unavailable ? 'AQTE OFFLINE' : marketHours ? 'WAITING FOR LIVE FEED' : 'MARKET CLOSED' };
}

const IndexCard = memo(function IndexCard({ symbol, index, selected, price, change, pct, note, tag, spark, onSelect }: CardView & {
  symbol: SymbolName; index: number; selected: boolean; spark: string | null; onSelect: (symbol: SymbolName) => void;
}) {
  const direction = change == null || change === 0 ? 'aqx-flat' : change > 0 ? 'aqx-up' : 'aqx-down';
  return (
    <button type="button" role="tab" id={`aqte-index-tab-${symbol}`}
      aria-selected={selected} aria-controls={`aqte-index-panel-${symbol}`} tabIndex={selected ? 0 : -1}
      onClick={() => onSelect(symbol)}
      onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % SYMBOLS.length
          : event.key === 'ArrowLeft' ? (index + SYMBOLS.length - 1) % SYMBOLS.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? SYMBOLS.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault();
        onSelect(SYMBOLS[next]);
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      }}
      className={`aqte-rich-tab aqte-tab-${symbol} aqx-index-card min-h-[48px] min-w-0 ${selected ? INDEX_STYLES[symbol].text : ''}`}>
      <span className="aqx-index-name">{LABELS[symbol]}{tag && <small className="aqx-index-tag">{tag}</small>}</span>
      <span className="aqx-index-price">{price != null ? number(price) : 'No live quote'}</span>
      <span className={`aqx-index-change ${direction}`}>
        {change != null && pct != null ? `${change > 0 ? '+' : ''}${number(change)} (${pct > 0 ? '+' : ''}${number(pct)}%)` : note}
      </span>
      {spark && <svg aria-hidden="true" className={`aqx-spark ${change != null && change < 0 ? 'aqx-spark-down' : ''}`} viewBox="0 0 100 32" preserveAspectRatio="none"><path d={spark} /></svg>}
    </button>
  );
});

const CONTEXT_SOURCES = [
  'EMA 9/20/50/200 stack with Supertrend on live futures bars',
  'India VIX band (live, fresh ticks only)',
  'Worst bid-ask spread of the subscribed ATM options',
  'Put/Call open-interest ratio of AQTE-subscribed strikes',
  'India VIX level and change (live, fresh ticks only)',
];
const fixed2 = (value: number | null) => value != null ? value.toFixed(2) : '--';
const MarketContext = memo(function MarketContext({ regime, volatility, liquidity, pcr, vix, vixChange, live }: {
  regime: string | null; volatility: string | null; liquidity: string | null;
  pcr: number | null; vix: number | null; vixChange: number | null; live: boolean;
}) {
  const tiles = [
    ['Market Regime', regime ?? '--', contextTone('regime', regime), null],
    ['Volatility', volatility ?? '--', contextTone('volatility', volatility), null],
    ['Liquidity', liquidity ?? '--', contextTone('liquidity', liquidity), null],
    ['PCR', fixed2(pcr), 'aqx-white', null],
    ['India VIX', fixed2(vix), 'aqx-white', vix != null ? vixChange : null],
  ] as const;
  return (
    <dl className="aqx-context" aria-label="Market context">
      {tiles.map(([label, value, color, extra], index) => (
        <div key={label} className="aqx-context-tile"
          title={`${CONTEXT_SOURCES[index]}${live ? '' : ' · shows -- until AQTE has live data'}`}>
          <span aria-hidden="true" className={`aqx-context-icon ${color}`}><NavIcon path={CONTEXT_ICONS[index]} /></span>
          <dt>{label}</dt>
          <dd className={color}>{value}{extra != null && <small className={tone(extra)}>{` (${extra > 0 ? '+' : ''}${extra.toFixed(2)}%)`}</small>}</dd>
        </div>
      ))}
    </dl>
  );
});

type PerformanceView = {
  tradeCount: number | null; maxTrades: number | null; winRate: number | null; dayPnl: number | null;
  dayReturn: number | null; totalPoints: number | null; drawdown: number | null; openPositions: number | null;
  riskLabel: string; riskNote: string; riskTone: string; riskUsed: number | null; dailyLoss: number | null; riskShare: number | null;
};
// Primitive props only, so the 1 s clock re-renders this strip only when a displayed value changes.
const PerformanceStrip = memo(function PerformanceStrip(view: PerformanceView) {
  const { tradeCount, maxTrades, winRate, dayPnl, dayReturn, totalPoints, drawdown, openPositions } = view;
  return (
    <section className="aqx-card aqx-perfbar-wrap" aria-labelledby="aqte-perf-title" id="aqte-dash-perf">
      <h3 id="aqte-perf-title" className="aqx-perf-title"><NavIcon path={ICONS.performance} />Today&apos;s Performance</h3>
      <dl className="aqx-perfbar" aria-label="Today summary">
        <div><dt>Trades</dt><dd>{tradeCount != null && maxTrades != null ? `${tradeCount} / ${maxTrades}` : '--'}</dd></div>
        <div><dt>Win Rate</dt><dd className={winRate == null ? '' : winRate >= 50 ? 'aqx-up' : 'aqx-down'}>{winRate != null ? `${winRate}%` : '--'}</dd></div>
        <div><dt>Today P&amp;L</dt><dd className={tone(dayPnl)}>{money(dayPnl)}</dd></div>
        <div><dt>Return</dt><dd className={tone(dayReturn)}>{dayReturn != null ? `${signed(dayReturn)}%` : '--'}</dd></div>
        <div><dt>Total Points</dt><dd className={tone(totalPoints)}>{signed(totalPoints)}</dd></div>
        <div><dt>Max Drawdown</dt><dd className={drawdown ? 'aqx-down' : ''}>{drawdown != null ? `${drawdown > 0 ? '−' : ''}₹${number(drawdown)}` : '--'}</dd></div>
        <div className="aqx-perf-risk"><dt>Daily Risk</dt>
          <dd className={view.riskTone}>{view.riskLabel}{view.riskUsed != null && view.dailyLoss != null && <small>₹{number(view.riskUsed)} / ₹{number(view.dailyLoss)}</small>}</dd>
          <span aria-hidden="true" className="aqx-risk-bar"><i style={{ transform: `scaleX(${view.riskShare ?? 0})` }} /></span>
          <p title={view.riskNote}>{view.riskNote}</p>
        </div>
        <div><dt>Open Positions</dt><dd>{openPositions ?? '--'}</dd></div>
      </dl>
      <p className="aqx-footnote">AQTE only · Net uses estimated charges · Return on deployed premium · One managed position maximum</p>
    </section>
  );
});

// Recent live prices per index for the tab sparklines; survives remounts and dedupes by tick time.
const sparks: Record<string, { at: string; values: number[] }> = {};
function recordSpark(symbol: string, at: string, price: number) {
  const entry = sparks[symbol] ?? (sparks[symbol] = { at: '', values: [] });
  if (entry.at === at) return;
  entry.at = at;
  entry.values.push(price);
  if (entry.values.length > 60) entry.values.shift();
}
function sparkPath(symbol: string) {
  const values = sparks[symbol]?.values ?? [];
  if (values.length < 2) return null;
  const low = Math.min(...values);
  const range = Math.max(...values) - low || 1;
  return values.map((value, index) =>
    `${index ? 'L' : 'M'}${(index / (values.length - 1) * 100).toFixed(1)},${(30 - (value - low) / range * 28).toFixed(1)}`).join(' ');
}

function isSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<Snapshot>;
  return data.mode === 'ANALYSIS_ONLY' && typeof data.generated_at === 'number' &&
    !!data.risk && typeof data.risk.realized_pnl === 'number' && !!data.data &&
    SYMBOLS.every(symbol => {
      const signal = data.data?.[symbol];
      const progress = (value: { completed: number; required: number } | undefined) => value === undefined ||
        (value != null && Number.isInteger(value.completed) && Number.isInteger(value.required) &&
          value.required > 0 && value.completed >= 0 && value.completed <= value.required);
      const scalp = signal?.scalp;
      return !!signal && ['WAIT', 'BUY CE', 'BUY PE'].includes(signal.decision) &&
        (signal.feed_ready === undefined || typeof signal.feed_ready === 'boolean') &&
        (signal.intelligence == null || isAqteIntelligence(signal.intelligence)) &&
        (signal.rule_checks == null || isAqteRuleChecks(signal.rule_checks)) &&
        Array.isArray(signal.reasons) && signal.reasons.every(reason => typeof reason === 'string') &&
        progress(signal.warmup) && progress(signal.opening) &&
        (scalp === undefined || (scalp != null && ['WAIT', 'BUY CE', 'BUY PE'].includes(scalp.decision) &&
          Array.isArray(scalp.reasons) && scalp.reasons.every(reason => typeof reason === 'string') &&
          (scalp.entry === null || (['maximum', 'stop', 'target', 'points'] as const)
            .every(key => Number.isFinite(scalp.entry?.[key])))));
    });
}

function AQTESection({ marketData, isConnected = false }: { marketData?: MarketData; isConnected?: boolean }) {
  const [selectedSymbol, setSelectedSymbol] = useState<SymbolName>('NIFTY');
  const [now, setNow] = useState(Date.now());
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<AQTELiveState | null>(null);
  const [liveChecked, setLiveChecked] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  // One live-status poll (AQTELiveController) feeds the whole section, including the header switch.
  const publishLive = useCallback((next: AQTELiveState | null, failure?: string) => {
    setLiveChecked(true);
    setLiveError(next ? null : failure ?? null);
    // A poll that started before a switch command can resolve after it; never roll back to the older state.
    setLiveStatus(prev => next && prev && !next.connection_error && next.generated_at < prev.generated_at ? prev : next);
  }, []);
  const [panel, setPanel] = useState<Panel>('active');
  const [exitRequest, setExitRequest] = useState<AQTEExitRequest | null>(null);
  // Each index chart mounts on first view and then stays mounted so switching back is instant.
  const [chartsOpened, setChartsOpened] = useState<Record<SymbolName, boolean>>({ NIFTY: false, BANKNIFTY: false, SENSEX: false });
  if (!chartsOpened[selectedSymbol]) setChartsOpened({ ...chartsOpened, [selectedSymbol]: true });

  // Warm the chart bundle and every index's default 5m history so tab switches render from cache.
  useEffect(() => {
    void import('@/components/AQTEChart');
    SYMBOLS.forEach(symbol => void prefetchChartHistory(symbol, 5));
  }, []);

  useEffect(() => {
    let active = true;
    let freshnessTimer: ReturnType<typeof setTimeout>;
    let controller: AbortController | null = null;
    let lastOk = 0;
    const advanceClock = () => {
      if (!active) return;
      setNow(Date.now());
      freshnessTimer = setTimeout(advanceClock, 1000);
    };
    advanceClock();
    const poll = async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 8000);
      try {
        const response = await fetch(API_CONFIG.endpoint('/api/aqte/snapshot'), {
          cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) throw new Error(`AQTE unavailable (${response.status})`);
        const payload: unknown = await response.json();
        if (!isSnapshot(payload)) throw new Error('Invalid AQTE response');
        if (Date.now() / 1000 - payload.generated_at > 10) throw new Error('AQTE response is stale');
        lastOk = Date.now();
        if (active) {
          setSnapshot(payload);
          setError(null);
        }
      } catch (cause) {
        if (aqteConnectionDrop(cause) && Date.now() - lastOk < AQTE_RECONNECT_GRACE_MS) return;
        if (active) setError(aqteErrorText(cause, 'AQTE connection unavailable'));
      } finally {
        clearTimeout(timeout);
      }
    };
    const stopPolling = aqtePollLoop(poll);
    return () => {
      active = false;
      stopPolling();
      clearTimeout(freshnessTimer);
      controller?.abort();
    };
  }, []);

  const unavailable = !!error || !snapshot || !snapshot.recording || !!snapshot.fault;
  const ist = new Date(now + 330 * 60_000);
  const minute = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const marketHours = ist.getUTCDay() >= 1 && ist.getUTCDay() <= 5 && minute >= 555 && minute < 930;
  const snapshotAge = snapshot ? now / 1000 - snapshot.generated_at : Infinity;
  const backendStatusCurrent = !error && snapshotAge >= -1 && snapshotAge <= 10;
  const backendFeedReady = backendStatusCurrent && !!snapshot?.recording && !snapshot.fault &&
    aqteFeedCurrent(snapshot?.data[selectedSymbol], snapshot.generated_at);
  const liveFeed = marketHours && backendFeedReady;
  const feedLabel = !backendStatusCurrent ? 'STATUS UNKNOWN' : liveFeed ? 'LIVE (Zerodha)' : 'FEED OFF';
  const quotes = Object.fromEntries(SYMBOLS.map(symbol => {
    const signal = snapshot?.data[symbol];
    const tick = marketData?.[symbol];
    const tickAt = tick ? Date.parse(tick.timestamp) / 1000 : NaN;
    const age = now / 1000 - tickAt;
    const streaming = isConnected && tick?.status === 'LIVE' &&
      Number.isFinite(tick.price) && tick.price > 0 && age >= -1 && age <= 5 &&
      tickAt >= (snapshot?.generated_at ?? 0) - 5;
    if (streaming) recordSpark(symbol, tick.timestamp, tick.price);
    return [symbol, { signal, streaming, tick: streaming ? tick : null, price: streaming ? tick.price : signal?.spot ?? null }];
  })) as Record<SymbolName, Quote>;

  const { known, trades: todays, realized, openPnl, dayPnl, wins, losses, breakeven, unverified, consecutiveLosses, tradeCount, lossLeft } =
    aqteDaySummary(liveStatus, now / 1000);
  const decided = todays.length - unverified;
  const winRate = decided ? Math.round(wins / decided * 100) : null;
  const active = liveStatus?.active ?? null;
  const risk = !known || !liveStatus || liveStatus.connection_error || liveStatus.error || active?.error
    ? { label: 'Unverified', note: 'Inspect controller / Kite', tone: 'aqx-flat' } :
    liveStatus.killed ? { label: 'Stopped', note: 'Emergency latch', tone: 'aqx-down' } :
      active?.exit_requested ? { label: 'Exiting', note: 'Awaiting broker fill', tone: 'aqx-flat' } :
        active && (!active.protection_confirmed || openPnl == null) ? { label: 'Review', note: 'Quote / stop unverified', tone: 'aqx-down' } :
      lossLeft === 0 ? { label: 'Limit hit', note: 'Daily loss reached', tone: 'aqx-down' } :
        (tradeCount ?? 0) >= liveStatus.limits.max_trades || consecutiveLosses >= liveStatus.limits.max_losses
          ? { label: 'Limit hit', note: 'Entries blocked', tone: 'aqx-down' } :
          !liveStatus.enabled
            ? { label: 'Locked', note: 'Live trading disabled', tone: 'aqx-flat' } :
            liveStatus.automation_wanted && !liveStatus.automation_on
              ? { label: 'Waiting', note: liveStatus.entry_window === false ? 'ON · arms 09:15 IST' : 'ON · arming / preflight', tone: 'aqx-flat' } :
            !liveStatus.armed ? { label: 'Not armed', note: 'Arms when Auto Trade turns ON', tone: 'aqx-flat' } :
            !liveStatus.automation_on ? { label: 'Paused', note: 'Protection continues', tone: 'aqx-flat' } :
              { label: 'Within limits', note: `Loss left ₹${number(lossLeft ?? 0)}`, tone: 'aqx-up' };
  const panels = [
    ['active', `Active Trades (${known ? active ? 1 : 0 : '--'})`],
    ['today', `Today's Trades (${known ? todays.length : '--'})`],
    ['positions', 'Positions'],
    ['performance', 'Performance'],
    ['controls', 'Controls'],
  ] as const;
  const selectedView = unavailable ? null : aqteEngineView(snapshot?.data[selectedSymbol]);
  const market = selectedView?.market ?? null;
  const evaluating = selectedView ? selectedView.engines.filter(engine => engine.total > 0 && engine.status !== 'MONITORING').length : null;
  const events = Array.isArray(snapshot?.engine_events)
    ? (snapshot.engine_events as unknown[]).filter(isAqteEngineEvent) as AQTEEngineEvent[] : [];
  const policy = snapshot?.engine_policy && typeof snapshot.engine_policy.veto === 'boolean' &&
    Number.isInteger(snapshot.engine_policy.veto_min) ? snapshot.engine_policy : null;
  const signalAt = snapshot?.data[selectedSymbol]?.at;
  const tickAge = liveFeed && typeof signalAt === 'number' ? Math.max(0, now - signalAt * 1000) : null;
  const health = unavailable ? ['Offline', 'aqx-down'] : marketHours && !liveFeed ? ['Degraded', 'aqx-wait'] : ['Healthy', 'aqx-up'];
  const dataState = unavailable ? 'Off' : liveFeed ? 'Live' : marketHours ? 'Stale' : 'Market closed';

  // Today's performance strip: realised trades in exit order plus the verified open estimate.
  const ordered = [...todays].sort((a, b) => a.exit_at - b.exit_at);
  const openMetrics = aqteLiveMetrics(liveStatus, now / 1000);
  const openFilled = active ? Math.max(0, active.filled - (active.exited ?? 0)) : 0;
  const closedPoints = ordered.map(trade => trade.entry_price != null && trade.exit_price != null ? trade.exit_price - trade.entry_price : null);
  const totalPoints = known && closedPoints.every(points => points != null) && (!openFilled || openMetrics?.points != null)
    ? closedPoints.reduce<number>((sum, points) => sum + (points ?? 0), 0) + (openFilled ? openMetrics?.points ?? 0 : 0) : null;
  const deployedParts = ordered.map(trade => trade.entry_price != null && trade.filled ? trade.entry_price * trade.filled : null);
  const deployed = known && deployedParts.every(part => part != null)
    ? deployedParts.reduce<number>((sum, part) => sum + (part ?? 0), 0) + (active && active.filled > 0 ? active.entry_price * active.filled : 0) : null;
  const dayReturn = dayPnl != null && deployed ? dayPnl / deployed * 100 : null;
  let equity = 0, peak = 0, drawdown: number | null = unverified ? null : 0;
  for (const trade of ordered) {
    equity += trade.net_pnl;
    peak = Math.max(peak, equity);
    if (drawdown != null) drawdown = Math.max(drawdown, peak - equity);
  }
  if (openPnl != null && drawdown != null) drawdown = Math.max(drawdown, peak - (equity + openPnl));
  let best: number | null = null, worst: number | null = null;
  for (const trade of todays) {
    if (trade.exit_unverified) continue;
    best = best == null ? trade.net_pnl : Math.max(best, trade.net_pnl);
    worst = worst == null ? trade.net_pnl : Math.min(worst, trade.net_pnl);
  }
  const riskUsed = dayPnl != null ? Math.max(0, -dayPnl) : null;
  const riskShare = riskUsed != null && liveStatus && liveStatus.limits.daily_loss > 0
    ? Math.min(1, riskUsed / liveStatus.limits.daily_loss) : null;
  const go = (target: string, book?: Panel) => {
    if (book) setPanel(book);
    if (typeof document !== 'undefined') document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <section aria-labelledby="aqte-title" className="aqte-theme aqte-terminal-shell aqx-shell relative mb-5 w-full min-w-0 max-w-full break-words rounded-xl border border-slate-600/60 bg-[#060d18] shadow-lg shadow-black/15">
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/80 to-transparent" />
      <div className="aqte-shell-header aqx-header flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/60 px-3 py-3 sm:px-4">
        <div className="aqte-heading flex min-w-0 items-center gap-3">
          <div aria-hidden="true" className="aqx-logo flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 20v-5m5 5V10m5 10V6m5 14V3" strokeLinecap="round" />
            </svg>
          </div>
          <div className="min-w-0">
          <h2 id="aqte-title" className="text-sm font-semibold leading-relaxed text-slate-100 sm:text-base">
            <span className="aqx-brand font-bold tracking-widest">AQTE<span aria-hidden="true" className="aqx-infinity"> ∞</span></span>
            <span className="text-slate-400"> — Adaptive Quantitative Trading Engine</span>
            {marketHours && <>{' '}
            <span role="status" aria-label="AQTE view status" className={`aqte-view-status inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold tracking-wider ${
              liveFeed ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200' :
                backendStatusCurrent ? 'border-amber-400/40 bg-amber-400/10 text-amber-200' :
                  'border-slate-400/40 bg-slate-400/10 text-slate-300'
            }`}>
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${
                liveFeed ? 'bg-emerald-300' : backendStatusCurrent ? 'bg-amber-300' : 'bg-slate-300'
              }`} />
              {feedLabel}
            </span></>}
          </h2>
          <p className="aqx-subtitle">12 Strategy Evaluators • Scalp/Swing Entry Rules • Risk-Gated Auto Execution</p>
          </div>
        </div>
        <div className="aqx-head-tools">
          <p className="aqx-clock">
            <b suppressHydrationWarning>{headClock.format(now)}</b> <small><abbr title="Indian Standard Time">IST</abbr></small>
            <span suppressHydrationWarning>{headDate.format(now)}</span>
          </p>
          <AQTEAutomationSwitch feed={liveChecked ? liveStatus : 'pending'} feedError={liveError} onStatus={publishLive} />
          <button type="button" className="aqx-icon-btn aqx-viewonly" aria-label={`Engine events (${events.length})`}
            onClick={() => go('aqte-dash-events')}>
            <NavIcon path="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
            {events.length > 0 && <span className="aqx-icon-count">{events.length > 99 ? '99+' : events.length}</span>}
          </button>
          <button type="button" className="aqx-icon-btn aqx-viewonly" aria-label="AQTE controls"
            onClick={() => go('aqte-dash-book', 'controls')}><NavIcon path={ICONS.settings} /></button>
        </div>
      </div>
      <div className="aqx-body p-2 sm:p-3">
      <h3 id="aqte-real-view" className="sr-only">Real Trade · Auto</h3>
      <div id="aqte-trading-panel" role="region" aria-labelledby="aqte-real-view" tabIndex={0} className="aqx-dash rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-300">
      <div className="aqx-rail">
        <section className="aqx-health" aria-label="System health">
          <p className={`aqx-health-state ${health[1]}`}><span aria-hidden="true" />System {health[0]}</p>
          <p>{evaluating != null ? `${evaluating}/12 engines evaluating` : 'Engines offline'}</p>
          <dl>
            <div><dt>Data</dt><dd className={liveFeed ? 'aqx-up' : 'aqx-flat'}>{dataState}</dd></div>
            <div><dt>Tick age</dt><dd>{tickAge != null ? `${Math.round(tickAge)} ms` : '--'}</dd></div>
          </dl>
        </section>
      </div>
      <div className="aqx-dash-main">
      <div className="aqx-top">
      <div role="tablist" aria-label="AQTE index" className="aqte-rich-tabs aqx-index-tabs">
        {SYMBOLS.map((symbol, index) => (
          <IndexCard key={symbol} symbol={symbol} index={index} selected={selectedSymbol === symbol}
            spark={sparkPath(symbol)} onSelect={setSelectedSymbol}
            {...indexCardView(quotes[symbol], marketData?.[symbol], unavailable, marketHours)} />
        ))}
      </div>
      <MarketContext regime={market?.regime ?? null} volatility={market?.volatility ?? null} liquidity={market?.liquidity ?? null}
        pcr={finiteOrNull(market?.pcr)} vix={finiteOrNull(market?.vix)} vixChange={finiteOrNull(market?.vix_change_pct)}
        live={liveFeed} />
      {(error || snapshot?.fault || snapshot?.subscription_error) && (
        <p role="status" className="aqx-alert break-words rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
          {error || snapshot?.fault || snapshot?.subscription_error}
        </p>
      )}
      </div>
      <PerformanceStrip tradeCount={tradeCount} maxTrades={liveStatus?.limits.max_trades ?? null}
        winRate={winRate} dayPnl={dayPnl} dayReturn={dayReturn}
        totalPoints={totalPoints} drawdown={known ? drawdown : null} openPositions={known ? openFilled > 0 ? 1 : 0 : null}
        riskLabel={risk.label} riskNote={risk.note} riskTone={risk.tone} riskUsed={riskUsed}
        dailyLoss={liveStatus?.limits.daily_loss ?? null} riskShare={riskShare} />
      <AQTEMorningEngine status={liveStatus} symbol={selectedSymbol} onStatus={publishLive} now={now / 1000} />
      <section className="aqx-dash-term" id="aqte-dash-trades" aria-labelledby="aqte-term-title">
        <h3 id="aqte-term-title" className="aqx-term-title">
          <span className="aqx-term-icon" aria-hidden="true"><NavIcon path={ICONS.trades} /></span>
          <span className="aqx-term-name">Live Trade Terminal</span><span className="sr-only"> · </span>
          <span className="aqx-term-symbol">{LABELS[selectedSymbol]}</span>
        </h3>
        {SYMBOLS.map(symbol => (
          <div key={symbol} id={`aqte-index-panel-${symbol}`} role="tabpanel"
            aria-labelledby={`aqte-index-tab-${symbol}`} hidden={selectedSymbol !== symbol}
            tabIndex={selectedSymbol === symbol ? 0 : -1}
            className="rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300">
            <AQTETerminal symbol={symbol} signal={quotes[symbol].signal} unavailable={unavailable}
              liveStatus={liveStatus} now={now / 1000} onExit={setExitRequest} paused={selectedSymbol !== symbol} />
          </div>
        ))}
      </section>
      <AQTEEngineDeck symbol={selectedSymbol} data={snapshot?.data} liveStatus={liveStatus} unavailable={unavailable}
        events={events} policy={policy} now={now / 1000}
        chart={SYMBOLS.map(symbol => (
          <div key={symbol} className="aqx-chart-slot" hidden={selectedSymbol !== symbol}>
            {chartsOpened[symbol] ? <Chart symbol={symbol} tick={quotes[symbol].tick} /> : null}
          </div>
        ))} />
      <section className="aqx-card aqx-book" aria-label="Trades, positions and controls" id="aqte-dash-book">
        <div className="aqx-book-head">
          <div role="tablist" aria-label="AQTE trade book" className="aqx-book-tabs">
            {panels.map(([key, title], index) => (
              <button key={key} type="button" role="tab" id={`aqte-book-tab-${key}`} aria-selected={panel === key}
                aria-controls={`aqte-book-${key}`} tabIndex={panel === key ? 0 : -1}
                onClick={() => setPanel(key)}
                onKeyDown={event => {
                  let next: number;
                  if (event.key === 'ArrowRight') next = (index + 1) % panels.length;
                  else if (event.key === 'ArrowLeft') next = (index + panels.length - 1) % panels.length;
                  else if (event.key === 'Home') next = 0;
                  else if (event.key === 'End') next = panels.length - 1;
                  else return;
                  event.preventDefault();
                  setPanel(panels[next][0]);
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
                }}
                className="aqx-book-tab min-h-[44px] min-w-0">{title}</button>
            ))}
          </div>
          <p className="aqx-risk-chips">
            <span>Risk/trade: {liveStatus ? `₹${number(liveStatus.limits.risk_per_trade)}` : '--'}</span>
            <span>Daily loss limit: {liveStatus ? `₹${number(liveStatus.limits.daily_loss)}` : '--'}</span>
          </p>
        </div>
        <div id="aqte-book-active" role="tabpanel" aria-labelledby="aqte-book-tab-active" hidden={panel !== 'active'} className="aqx-table-wrap">
          <table className="aqx-table">
            <thead><tr><th>#</th><th>Instrument</th><th>Side</th><th>Entry</th><th>LTP</th><th>Initial SL</th><th>Current SL / TSL</th><th>Target</th><th>P&amp;L (Pts)</th><th>Net est. (₹)</th><th>Return %</th><th>Action</th></tr></thead>
            <tbody>
              {active ? (() => {
                const metrics = openMetrics;
                const confirmed = known && !liveStatus?.error && !active.error && !!active.protection_confirmed;
                return (
                  <tr>
                    <td>1</td><td className="aqx-instrument">{active.contract.trading_symbol}</td>
                    <td><span className="aqx-chip aqx-chip-buy">BUY</span></td>
                    <td>{active.filled > 0 ? number(active.entry_price) : `Limit ${number(active.limit)}`}</td>
                    <td>{metrics?.ltp != null ? number(metrics.ltp) : '--'}</td>
                    <td className="aqx-down">{number(active.initial_stop)}</td>
                    <td className="aqx-cyan">{number(active.stop)}<small>{confirmed ? active.trailing_active ? 'Trailing · confirmed' : 'Confirmed SL' : 'Unverified'}</small></td>
                    <td>{number(active.target)}</td>
                    <td className={tone(metrics?.points)}>{signed(metrics?.points)}</td>
                    <td className={tone(metrics?.net_pnl)}>{signed(metrics?.net_pnl)}</td>
                    <td className={tone(metrics?.return_pct)}>{metrics?.return_pct != null ? `${signed(metrics.return_pct)}%` : '--'}</td>
                    <td><button type="button" className="aqx-table-exit" disabled={!aqteCanExit(liveStatus) || !!active.exit_requested}
                      onClick={() => setExitRequest({ tradeId: active.id, contract: active.contract.trading_symbol,
                        quantity: Math.max(0, active.filled - (active.exited ?? 0)), action: 'exit' })}>{active.exit_requested ? 'Exit requested' : 'Exit'}</button></td>
                  </tr>
                );
              })() : <tr><td colSpan={12} className="aqx-empty-row">{known
                ? 'No AQTE trade open · Entries need daily arming, Auto Trade ON and a qualifying signal'
                : 'Live positions are unverified · Check the controller and Kite'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div id="aqte-book-today" role="tabpanel" aria-labelledby="aqte-book-tab-today" hidden={panel !== 'today'} className="aqx-table-wrap">
          <table className="aqx-table">
            <thead><tr><th>#</th><th>Instrument</th><th>Side</th><th>Entry</th><th>Exit</th><th>Exit time</th><th>Reason</th><th>Net P&amp;L (₹)</th></tr></thead>
            <tbody>
              {todays.length ? todays.map((trade, index) => (
                <tr key={`${trade.exit_at}:${index}`}>
                  <td>{index + 1}</td><td className="aqx-instrument">{trade.contract?.trading_symbol ?? LABELS[trade.symbol as SymbolName] ?? trade.symbol}</td>
                  <td><span className="aqx-chip aqx-chip-buy">BUY</span></td>
                  <td>{trade.entry_price != null ? number(trade.entry_price) : '--'}</td>
                  <td>{trade.exit_price != null ? number(trade.exit_price) : trade.exit_unverified ? 'Unverified' : '--'}</td>
                  <td>{exitClock.format(new Date(trade.exit_at * 1000))}</td>
                  <td>{trade.exit_requested ? trade.exit_requested.replaceAll('_', ' ') : 'Broker SL'}</td>
                  {trade.exit_unverified
                    ? <td className="aqx-flat" title="No SELL fill found in Kite; verify the exit there">Unverified</td>
                    : <td className={tone(trade.net_pnl)}>{signed(trade.net_pnl)}</td>}
                </tr>
              )) : <tr><td colSpan={8} className="aqx-empty-row">{known ? 'No closed AQTE trades today' : 'Trade history unavailable'}</td></tr>}
            </tbody>
          </table>
          <p className="aqx-footnote">Net uses estimated charges, not broker contract notes.</p>
        </div>
        <div id="aqte-book-positions" role="tabpanel" aria-labelledby="aqte-book-tab-positions" hidden={panel !== 'positions'}>
          {panel === 'positions' && <AQTEBrokerPositions selectedSymbol={selectedSymbol} />}
        </div>
        <div id="aqte-book-performance" role="tabpanel" aria-labelledby="aqte-book-tab-performance" hidden={panel !== 'performance'}>
          <dl className="aqx-perf">
            {([
              ['Closed trades', known ? String(todays.length) : '--', ''],
              ['Wins / Losses / Flat', known ? `${wins} / ${losses} / ${breakeven}${unverified ? ` · ${unverified} unverified` : ''}` : '--', ''],
              ['Win rate', winRate != null ? `${winRate}%` : '--', winRate == null ? '' : winRate >= 50 ? 'aqx-up' : 'aqx-down'],
              ['Realized net', money(realized), tone(realized)],
              ['Open net', money(openPnl), tone(openPnl)],
              ['Best trade', money(best), tone(best)],
              ['Worst trade', money(worst), tone(worst)],
              ['Loss budget left', lossLeft != null ? `₹${number(lossLeft)}` : '--', ''],
            ] as const).map(([label, value, color]) => (
              <div key={label} className="aqx-perf-cell"><dt>{label}</dt><dd className={color}>{value}</dd></div>
            ))}
          </dl>
          <p className="aqx-footnote">Today only (IST) · Net uses estimated charges · Past results do not predict future trades.</p>
        </div>
        <div id="aqte-book-controls" role="tabpanel" aria-labelledby="aqte-book-tab-controls" hidden={panel !== 'controls'} className="aqx-controls">
          <AQTEDailyControl />
        </div>
      </section>
      <AQTELiveController onStatus={publishLive} exitRequest={exitRequest} />
      </div>
      </div>
      </div>
    </section>
  );
}

export default memo(AQTESection);
