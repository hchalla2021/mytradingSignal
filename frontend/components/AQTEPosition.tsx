'use client';

import { memo } from 'react';

export type PositionMetrics = {
  quantity: number; quote_at: number | null; stale: boolean;
  ltp: number | null; bid: number | null; points: number | null;
  gross_pnl: number | null; net_pnl: number | null; return_pct: number | null;
  peak_points: number | null; stop_points: number | null;
};

type Props = {
  compact?: boolean;
  brokerReadOnly?: boolean;
  empty?: false;
  mode: 'paper' | 'real';
  contract: string;
  state: string;
  entry: number | null;
  entryAt: number | null;
  limit: number | null;
  initialStop: number | null;
  stop: number | null;
  target: number | null;
  peak: number | null;
  trailing: boolean;
  trailStartR?: number;
  stopConfirmed?: boolean;
  pendingStop?: number;
  metrics?: PositionMetrics;
  unavailable: boolean;
};
type EmptyProps = Pick<Props, 'mode' | 'contract' | 'unavailable' | 'compact'> & { empty: true };

const numberFormatter = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const timeFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const format = (value: number | null | undefined, signed = false) =>
  value == null || !Number.isFinite(value) ? '--' :
    `${signed && value > 0 ? '+' : ''}${numberFormatter.format(value)}`;
const tone = (value: number | null | undefined) => value == null ? 'text-slate-400' :
  value > 0 ? 'text-emerald-300' : value < 0 ? 'text-rose-300' : 'text-slate-200';
const clock = (at: number) => timeFormatter.format(new Date(at * 1000));

function AQTEPosition(input: Props | EmptyProps) {
  const empty = input.empty === true;
  const props: Props = input.empty ? {
    mode: input.mode, contract: input.contract, unavailable: input.unavailable, compact: input.compact,
    state: 'WAITING_FOR_ENTRY', entry: null, entryAt: null, limit: null,
    initialStop: null, stop: null, target: null, peak: null, trailing: false,
  } : input;
  const { metrics, unavailable } = props;
  const entered = props.entry != null && props.entry > 0;
  const current = !unavailable && metrics && !metrics.stale;
  const points = current ? metrics.points : null;
  const pnl = current ? props.brokerReadOnly ? metrics.gross_pnl : metrics.net_pnl : null;
  const cells = [
    { label: 'Buy entry price', value: entered ? format(props.entry) : '--', color: 'text-cyan-100', box: 'border-cyan-400/30 bg-cyan-400/5' },
    { label: 'Running option LTP', value: current ? format(metrics.ltp) : '--', color: 'text-sky-100', box: 'border-sky-400/30 bg-sky-400/5' },
    { label: 'Initial stop loss', value: props.brokerReadOnly ? 'Not available' : format(props.initialStop), color: 'text-rose-300', box: 'border-rose-400/30 bg-rose-400/5' },
    { label: props.brokerReadOnly ? 'Current broker SL' : props.mode === 'real' ? props.stopConfirmed ? 'Broker-confirmed SL' : 'Planned SL (unconfirmed)' : 'Current paper SL', value: props.brokerReadOnly && props.stop == null ? 'See stop orders below' : format(props.stop), color: 'text-amber-200', box: 'border-amber-400/30 bg-amber-400/5' },
    { label: 'Target price', value: props.brokerReadOnly ? 'Not available' : format(props.target), color: 'text-emerald-300', box: 'border-emerald-400/30 bg-emerald-400/5' },
    { label: 'Best observed gain', value: props.brokerReadOnly ? 'Not available' : `${format(metrics?.peak_points, true)} pts`, color: 'text-violet-200', box: 'border-violet-400/30 bg-violet-400/5' },
  ];
  const content = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700/60 px-3 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-300">{props.mode === 'paper' ? 'Paper position' : 'Real position'} · {props.state.replaceAll('_', ' ')}</p>
          <p className="mt-1 break-all text-xs font-semibold text-slate-100">{props.contract}</p>
        </div>
        <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold ${!current ? 'border-amber-400/30 text-amber-200' : 'border-cyan-400/30 text-cyan-200'}`}>
          {unavailable ? 'STATUS NOT CURRENT' : empty ? 'WAITING FOR ENTRY' : metrics?.stale ? 'STALE QUOTE' : !metrics ? 'QUOTE UNAVAILABLE' : 'FRESH QUOTE'}
        </span>
      </div>
      <dl aria-label="Position prices" className="grid grid-cols-2 gap-2 p-3 tabular-nums sm:grid-cols-3 xl:grid-cols-6">
        {cells.map((cell, index) => (
          <div key={cell.label} className={`aqte-metric min-w-0 rounded-lg border px-3 py-2.5 ${cell.box}`}>
            <dt className="text-[11px] font-medium leading-relaxed text-slate-300">{cell.label}</dt>
            <dd className={`mt-1 break-words text-base font-semibold ${cell.color}`}>{cell.value}</dd>
            {index === 3 && <p className="mt-1 text-[10px] text-amber-200">{props.brokerReadOnly ? 'Trailing SL · Not managed' : empty ? 'Trailing SL · Waiting' : props.trailing ? 'Trailing SL · Active' : `Trailing SL · Starts at +${props.trailStartR ?? 1}R`}</p>}
          </div>
        ))}
      </dl>
      <div aria-label="Live profit and change" className="grid grid-cols-2 gap-2 px-3 pb-3">
        <div className={`order-2 min-w-0 rounded-lg border p-3 ${points == null ? 'border-slate-600/70 bg-slate-800/35' : points >= 0 ? 'border-emerald-400/30 bg-emerald-400/5' : 'border-rose-400/30 bg-rose-400/5'}`}>
          <p className="text-[10px] uppercase tracking-wider text-slate-400">Points gained</p>
          <p className={`mt-1 break-words text-lg font-bold tabular-nums sm:text-xl ${tone(points)}`}>{format(points, true)} <span className="text-[10px] font-medium text-slate-400">pts</span></p>
          <p className="mt-1 text-[10px] text-slate-400">{format(current ? metrics.return_pct : null, true)}% from entry</p>
        </div>
        <div className={`order-1 min-w-0 rounded-lg border p-3 ${pnl == null ? 'border-slate-600/70 bg-slate-800/35' : pnl >= 0 ? 'border-emerald-400/30 bg-emerald-400/5' : 'border-rose-400/30 bg-rose-400/5'}`}>
          <p className="text-[10px] uppercase tracking-wider text-slate-400">{props.brokerReadOnly ? 'Open P&L · gross LTP' : 'Open P&L · est. net'}</p>
          <p className={`mt-1 break-words text-lg font-bold tabular-nums sm:text-xl ${tone(pnl)}`}><span className="text-[10px] font-medium">INR </span>{format(pnl, true)}</p>
          <p className="mt-1 text-[10px] text-slate-400">{props.brokerReadOnly ? 'Fees excluded · Not a fill guarantee' : `Gross INR ${format(current ? metrics.gross_pnl : null, true)}`}</p>
        </div>
      </div>
      <div className="space-y-2 border-t border-slate-700/50 p-3 text-[11px] leading-relaxed text-slate-400">
        <div className="grid grid-cols-2 gap-2">
          <div className="aqte-metric min-w-0 rounded-lg border bg-slate-950/50 px-3 py-2">
            <p className="text-slate-300">Entry time{props.mode === 'real' ? ' (observed)' : ''}</p>
            <p className="mt-1 break-words font-medium text-slate-100 tabular-nums">{entered ? props.entryAt ? `${clock(props.entryAt)} IST` : 'Time unavailable' : 'Awaiting fill'}</p>
          </div>
          <div className="aqte-metric min-w-0 rounded-lg border bg-slate-950/50 px-3 py-2">
            <p className="text-slate-300">Open quantity</p>
            <p className="mt-1 font-medium text-slate-100 tabular-nums">{metrics?.quantity ?? '--'}</p>
          </div>
        </div>
        {!empty && !entered && <p className="text-cyan-200">Limit pending @ {format(props.limit)} · No filled-entry P&amp;L</p>}
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-2.5 py-2">
          <p className="font-semibold text-amber-200">Trailing stop loss · {props.brokerReadOnly ? 'NOT MANAGED BY AQTE' : empty ? 'WAITING FOR ENTRY' : props.trailing ? 'ACTIVE' : `WAITING FOR +${props.trailStartR ?? 1}R`}</p>
          <dl aria-label="Trailing stop metrics" className="mt-2 grid grid-cols-2 gap-2 tabular-nums">
            <div className="aqte-metric min-w-0 rounded-md border bg-slate-950/50 px-2 py-2">
              <dt className="text-slate-300">Peak bid</dt>
              <dd className="mt-1 break-words font-semibold text-amber-100">{format(props.peak != null && props.peak > 0 ? props.peak : null)}</dd>
            </div>
            <div className="aqte-metric min-w-0 rounded-md border bg-slate-950/50 px-2 py-2">
              <dt className="text-slate-300">Stop vs entry</dt>
              <dd className="mt-1 break-words font-semibold text-amber-100">{format(metrics?.stop_points, true)} pts</dd>
            </div>
          </dl>
          {props.pendingStop != null && <p className="mt-1 text-amber-200">Requested SL {format(props.pendingStop)} · Awaiting broker confirmation</p>}
        </div>
        <details className="rounded-lg border border-slate-700/60 px-3">
          <summary className="cursor-pointer py-2 font-medium text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Price &amp; calculation details</summary>
          <div className="space-y-2 pb-3">
            {empty && <p className="text-cyan-200">Waiting for entry. Prices, stops, points and profit will populate automatically after a qualifying trade. No position values are simulated.</p>}
            <p>Sell bid {format(current ? metrics.bid : null)}{metrics?.quote_at ? ` · Quote ${clock(metrics.quote_at)} IST` : ''}</p>
            <p className="text-[10px] text-slate-500">{props.brokerReadOnly ? 'Manual Kite trade: entry is the broker average; points, percentage and gross P&L use fresh option LTP. Initial stop, target and peak since entry are unknown. No broker orders are changed.' : 'Points and open P&L use the fresh sell bid with sufficient depth, not index points. Net includes estimated entry/exit charges; fills and stop profits are not guaranteed.'}</p>
          </div>
        </details>
      </div>
    </>
  );
  const compactCells = [
    ['Entry', entered ? format(props.entry) : '--', 'aqte-cyan'],
    ['LTP', current ? format(metrics.ltp) : '--', ''],
    ['Qty', metrics?.quantity ?? '--', ''],
    ['Points', format(points, true), tone(points)],
    [props.brokerReadOnly ? 'Gross P&L · INR' : 'Est. net P&L · INR', format(pnl, true), tone(pnl)],
    ['Return %', format(current ? metrics.return_pct : null, true), tone(points)],
    ['Initial SL', props.brokerReadOnly ? 'Unknown' : format(props.initialStop), 'aqte-down'],
    [props.brokerReadOnly ? 'Broker SL' : props.mode === 'real' ? props.stopConfirmed ? 'Confirmed SL' : 'Planned SL' : 'Current SL', format(props.stop), 'aqte-down'],
    ['Trailing SL', props.brokerReadOnly ? 'Not managed' : props.trailing ? format(props.stop) : 'Waiting', 'aqte-cyan'],
    ['Target', props.brokerReadOnly ? 'Unknown' : format(props.target), 'aqte-up'],
    ['Peak gain · pts', props.brokerReadOnly ? 'Unknown' : format(metrics?.peak_points, true), 'aqte-up'],
    ['Entry · IST', entered ? props.entryAt ? clock(props.entryAt) : 'Unknown' : 'Awaiting fill', ''],
  ];
  return (
    <div aria-label={`${props.mode === 'paper' ? 'Paper' : 'Real'} position ${props.contract}`} className={`${props.compact ? 'aqte-compact-position' : ''} mt-3 min-w-0 overflow-hidden rounded-xl border border-cyan-400/25 bg-gradient-to-br from-slate-900 to-slate-950 shadow-inner`}>
      {props.compact ? <>
        <div className="aqte-position-heading"><strong>{props.contract}</strong><span>{props.state.replaceAll('_', ' ')}</span><span>{unavailable ? 'STATUS NOT CURRENT' : empty ? 'WAITING FOR ENTRY' : !current ? 'QUOTE UNAVAILABLE' : 'FRESH QUOTE'}</span></div>
        <dl className="aqte-position-table" aria-label="Compact position summary">{compactCells.map(([label, value, color]) => (
          <div key={label} className="aqte-position-cell"><dt>{label}</dt><dd className={String(color)}>{value}</dd></div>
        ))}</dl>
        {props.pendingStop != null && <p className="px-3 py-1 text-[11px] text-amber-200">Requested SL {format(props.pendingStop)} · Awaiting broker confirmation</p>}
        <details className="px-3"><summary className="cursor-pointer py-2 text-[10px] text-slate-400">Full position, protection &amp; calculation details</summary>{content}</details>
      </> : content}
    </div>
  );
}

export default memo(AQTEPosition);
