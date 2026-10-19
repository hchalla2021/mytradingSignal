'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_CONFIG } from '@/lib/api-config';
import type { PaperFrame } from '@/lib/chart-paper-trading';

export function usePaperSignalRecorder(frame: PaperFrame | null) {
  const [error, setError] = useState<string | null>(null);
  const sent = useRef(new Set<string>());
  const latestFrame = useRef(frame);
  latestFrame.current = frame;
  const key = frame && frame.signals.length
    ? `${frame.symbol}:${frame.timeframe}:${frame.candle_at}:${frame.signals.map(s => `${s.strategy}:${s.side}`).sort().join('|')}` : null;
  useEffect(() => {
    const payload = latestFrame.current;
    if (!key || !payload || sent.current.has(key)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const send = async () => {
      try {
        const response = await fetch(API_CONFIG.endpoint('/api/paper-trading/signals'), {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload), signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Chart signal recording failed (${response.status}): ${await response.text()}`);
        sent.current.add(key);
        if (sent.current.size > 500) sent.current.delete(sent.current.values().next().value!);
        setError(null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'Chart signal recording failed');
        timer = setTimeout(send, 5000);
      }
    };
    void send();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [key]);
  return error;
}

interface Summary {
  total_trades: number; closed: number; open: number; wins: number; losses: number;
  stop_hits: number; target_hits: number; reversals: number; missed_targets: number;
  net_points: number; pnl: number; win_rate: number | null; expectancy: number | null;
  realized_risk_reward: number | null; planned_risk_reward: number;
  best_strategy?: Ranking | null; worst_strategy?: Ranking | null;
}
interface Ranking extends Summary { name: string }
interface Trade {
  id: string; day: string; symbol: string; timeframe: number; strategy: string; side: string;
  signal_price: number; signal_at: string; received_at: string; trigger_price: number;
  entry_at: string; entry_price: number; stop: number; target: number;
  exit_at: string | null; exit_price: number | null; exit_reason: string | null;
  target_achieved: boolean; missed_target: boolean; target_after_exit?: boolean;
  points: number | null; pnl: number | null; mfe: number; mae: number; mfe_at: string; mae_at: string;
  data_gaps: number;
  unrealized_points: number; rationale: string[]; tags: string[]; setup: Record<string, unknown>;
}
interface History {
  day: string; policy: Record<string, string | number>; summary: Summary; report_status: string;
  trades: Trade[]; total: number; dates: string[];
  rankings: { strategies: Ranking[]; combinations: Ranking[]; note: string };
  health: { running: boolean; error: string | null; last_received: string | null; queued_ticks: number };
  signals: Record<string, number>;
  quotes: Record<string, { at: string; price: number }>;
}
interface TradeEvent { at: string; kind: string; payload: Record<string, unknown> }
const number = (value: number | null | undefined) => value == null ? '--' : value.toFixed(2);
const time = (value: string | null) => value ? new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }) : '--';

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(API_CONFIG.endpoint(path), { cache: 'no-store', credentials: 'include', signal });
  if (!response.ok) throw new Error(`Paper trading request failed (${response.status})`);
  return response.json();
}

function TradeDetails({ trade }: { trade: Trade }) {
  const [events, setEvents] = useState<TradeEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    getJson<TradeEvent[]>(`/api/paper-trading/events?trade_id=${encodeURIComponent(trade.id)}`, controller.signal)
      .then(value => { setEvents(value); setError(null); })
      .catch(cause => { if (!controller.signal.aborted) setError(String(cause)); });
    return () => controller.abort();
  }, [trade.id, trade.exit_at, trade.target_after_exit]);
  return <div className="space-y-2 rounded-lg bg-slate-950 p-3">
    <p>{trade.rationale.join(' | ')}</p>
    <p>Indicators: {trade.tags.join(' + ')}</p>
    <p>Signal close {number(trade.signal_price)} at {time(trade.signal_at)}; received {time(trade.received_at)};
      actual entry trigger tick {number(trade.trigger_price)}. MFE {number(trade.mfe)} at {time(trade.mfe_at)};
      MAE {number(trade.mae)} at {time(trade.mae_at)}.</p>
    <p>Target achieved: {trade.target_achieved ? 'Yes' : 'No'} | Missed target: {trade.missed_target ? 'Yes' : 'No'}
      {trade.target_after_exit ? ' (reached after exit)' : ''} | Quote gaps over 30s: {trade.data_gaps}</p>
    {error && <p role="alert" className="text-red-400">{error}</p>}
    {events.map((event, index) => <p key={index}>{time(event.at)} IST | {event.kind} | {JSON.stringify(event.payload)}</p>)}
    <details><summary className="cursor-pointer">Full immutable chart setup rationale</summary>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap">{JSON.stringify(trade.setup, null, 2)}</pre>
    </details>
  </div>;
}

export default function ChartPaperTrading({ recorderError }: { recorderError: string | null }) {
  const [day, setDay] = useState('');
  const [offset, setOffset] = useState(0);
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [rankingType, setRankingType] = useState<'strategies' | 'combinations'>('strategies');
  const [rankBy, setRankBy] = useState<'expectancy' | 'win_rate' | 'realized_risk_reward'>('expectancy');
  const [minSamples, setMinSamples] = useState(5);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const params = new URLSearchParams({ limit: '100', offset: String(offset) });
        if (day) params.set('day', day);
        const result = await getJson<History>(`/api/paper-trading/history?${params}`, controller.signal);
        setHistory(result); setError(null); setUpdated(new Date());
      } catch (cause) {
        if (!controller.signal.aborted) setError(String(cause));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(load, 3000);
      }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [day, offset, refreshKey]);
  const download = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (day) params.set('day', day);
      const result = await getJson<History & { events: TradeEvent[] }>(`/api/paper-trading/report?${params}`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `paper-trading-${result.day}.json`; anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) { setError(String(cause)); }
  }, [day]);
  const summary = history?.summary;
  const activeTrade = history?.trades.find(trade => trade.id === selected);
  const rankings = history?.rankings[rankingType].filter(row => row.closed >= minSamples)
    .sort((a, b) => (b[rankBy] ?? -Infinity) - (a[rankBy] ?? -Infinity));
  return <div className="space-y-4 rounded-xl border border-amber-400/30 bg-slate-900 p-4 text-xs text-slate-300">
    <div className="flex flex-wrap items-center gap-3">
      <h3 className="font-bold text-amber-300">Automated Paper Trading - SIMULATED ONLY</h3>
      <label>Session (IST) <input aria-label="Paper trading session" type="date" value={day}
        onChange={event => { setDay(event.target.value); setOffset(0); setSelected(null); setHistory(null); }}
        className="rounded bg-slate-800 p-2" /></label>
      <button onClick={() => { setDay(''); setOffset(0); setHistory(null); }}>Today</button>
      <button onClick={() => setRefreshKey(key => key + 1)}>Refresh</button>
      <button onClick={() => void download()}>Export day report (JSON)</button>
      <span>Updated {updated?.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }) ?? '--'} IST</span>
    </div>
    <p>Only this live Observatory chart creates signals, using its selected index and intraday timeframe.
      Keep the chart open for new signals; existing paper trades continue on the backend.
      Hidden indicators are still evaluated. Historical browsing and daily/weekly/monthly charts do not create entries.</p>
    <p>Independent strategy books | 10-point stop | 20-point target (2R) | 0.5-point adverse slippage per market fill |
      one synthetic index unit | fees excluded | no real orders. Entry uses the first fresh tick after signal receipt,
      not a backdated candle price. Gaps can lose more than 10 points.</p>
    <p>Cash-index volume/VWAP can be unavailable. Futures prices/volume are never mixed into this cash chart.
      Unverified inputs are recorded as missing, not invented. Baseline strategies remain measurable without volume.</p>
    {(error || recorderError || history?.health.error) && <p role="alert" className="rounded border border-red-500 p-3 text-red-300">
      {error || recorderError || history?.health.error} Results may be stale or incomplete.
    </p>}
    {!history ? <p role="status">Loading paper history...</p> : <>
      <p>Engine: {history.health.running ? 'running' : 'STOPPED'} | queued ticks {history.health.queued_ticks} |
        report {history.report_status} | last tick {time(history.health.last_received)} IST</p>
      <p>Quote times: {Object.entries(history.quotes).map(([symbol, quote]) => `${symbol}: ${time(quote.at)} IST`).join(' | ') || 'Waiting for live quotes'}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {summary && Object.entries({
          Trades: summary.total_trades, Open: summary.open, Wins: summary.wins, Losses: summary.losses,
          'Stop hits': summary.stop_hits, 'Target hits': summary.target_hits,
          'Reversal exits': summary.reversals, 'Missed targets': summary.missed_targets,
          'Net points': number(summary.net_points), 'P&L (1 unit, before fees)': number(summary.pnl),
          'Win rate %': number(summary.win_rate), 'Expectancy (points)': number(summary.expectancy),
        }).map(([label, value]) => <div key={label} className="rounded bg-slate-800 p-3"><p>{label}</p><strong className="text-base text-white">{value}</strong></div>)}
      </div>
      <p>Best today: {summary?.best_strategy?.name ?? '--'} | Worst today: {summary?.worst_strategy?.name ?? '--'}</p>
      <p>Recorded signal outcomes: {Object.entries(history.signals).map(([key, count]) => `${key}: ${count}`).join(' | ') || 'None yet'}</p>
      <p>Recorded sessions: {history.dates.map(date => <button className="mr-2 underline" key={date}
        onClick={() => { setDay(date); setOffset(0); setHistory(null); }}>{date}</button>)}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <caption className="py-2 text-left font-bold">Day-wise paper ledger - all books (overlapping exposure)</caption>
          <thead><tr>{['Index / TF', 'Strategy', 'Side', 'Entry IST / fill', 'Stop / target', 'Exit IST / fill', 'Points / P&L', 'MFE / MAE', 'Exit reason / target'].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead>
          <tbody>{history.trades.map(trade => <tr key={trade.id} className="border-t border-slate-700">
            <td className="p-2">{trade.symbol} / {trade.timeframe}m</td>
            <td className="p-2"><button className="text-amber-300 underline" onClick={() => setSelected(trade.id)}>{trade.strategy}</button></td>
            <td className="p-2">{trade.side}</td><td className="p-2">{time(trade.entry_at)} / {number(trade.entry_price)}</td>
            <td className="p-2">{number(trade.stop)} / {number(trade.target)}</td>
            <td className="p-2">{time(trade.exit_at)} / {number(trade.exit_price)}</td>
            <td className="p-2">{trade.exit_at ? `${number(trade.points)} / ${number(trade.pnl)}` : `${number(trade.unrealized_points)} unrealized (last quote)`}</td>
            <td className="p-2">{number(trade.mfe)} / {number(trade.mae)}</td>
            <td className="p-2">{trade.exit_reason ?? 'OPEN'} / {trade.target_achieved ? 'HIT' : trade.missed_target ? 'MISSED' : 'Not hit'}</td>
          </tr>)}</tbody>
        </table>
        {!history.total && <p className="p-4">No paper trades for this session. Waiting for a fresh completed-candle strategy signal from the live chart.</p>}
      </div>
      <div className="flex gap-3"><button disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 100))}>Previous 100</button>
        <span>{history.total ? offset + 1 : 0}-{Math.min(offset + 100, history.total)} of {history.total}</span>
        <button disabled={offset + 100 >= history.total} onClick={() => setOffset(value => value + 100)}>Next 100</button></div>
      {activeTrade && <TradeDetails trade={activeTrade} />}
      <h4 className="font-bold text-amber-300">Historical strategy effectiveness (closed trades, all recorded days)</h4>
      <div className="flex flex-wrap gap-3">
        <select aria-label="Ranking group" value={rankingType} onChange={event => setRankingType(event.target.value === 'strategies' ? 'strategies' : 'combinations')} className="bg-slate-800 p-2">
          <option value="strategies">Strategies</option><option value="combinations">Observed indicator combinations</option>
        </select>
        <label>Minimum closed trades <input aria-label="Minimum ranking sample" type="number" min={1} value={minSamples}
          onChange={event => setMinSamples(Math.max(1, Number(event.target.value) || 1))} className="w-16 bg-slate-800 p-2" /></label>
        <select aria-label="Rank strategies by" value={rankBy} onChange={event => {
          const value = event.target.value;
          if (value === 'expectancy' || value === 'win_rate' || value === 'realized_risk_reward') setRankBy(value);
        }} className="bg-slate-800 p-2">
          <option value="expectancy">Expectancy</option><option value="win_rate">Win rate</option><option value="realized_risk_reward">Realized risk/reward</option>
        </select>
      </div>
      <p>{history.rankings.note} Default ranking is expectancy, then win rate. Set minimum samples to 1 to inspect early results.</p>
      <div className="max-h-96 overflow-auto"><table className="w-full text-left">
        <thead><tr>{['Strategy / combination', 'Closed', 'Win %', 'Expectancy pts', 'Realized R/R', 'Net pts'].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead>
        <tbody>{rankings?.map(row => <tr className="border-t border-slate-700" key={row.name}>
          <td className="p-2">{row.name}</td><td className="p-2">{row.closed}</td><td className="p-2">{number(row.win_rate)}</td>
          <td className="p-2">{number(row.expectancy)}</td><td className="p-2">{number(row.realized_risk_reward)}</td><td className="p-2">{number(row.net_points)}</td>
        </tr>)}</tbody>
      </table></div>
      {!rankings?.length && <p>No strategies yet meet the selected minimum closed-trade sample.</p>}
      <details><summary className="cursor-pointer">Full execution assumptions</summary>
        {Object.entries(history.policy).map(([key, value]) => <p key={key}>{key}: {value}</p>)}
      </details>
    </>}
  </div>;
}
