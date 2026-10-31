'use client';

import { useEffect, useState } from 'react';
import { API_CONFIG } from '@/lib/api-config';
import { getOrCreateVisitorId } from '@/lib/visitor-id';
import AQTEPosition from '@/components/AQTEPosition';

type Position = {
  symbol: string; trading_symbol: string; exchange: string; product: string;
  quantity: number; entry: number; ltp: number | null; quote_at: number | null;
  points: number | null; return_pct: number | null; gross_pnl: number | null;
  stops: Array<{ order_id: string; quantity: number; trigger: number; status: string }>;
  exit_orders: Array<{ order_id: string; quantity: number; price: number; status: string }>;
};
type Snapshot = { generated_at: number; positions: Position[]; read_only: true; paused?: boolean; reason?: string };
const formatter = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const value = (n: number | null) => n == null ? '--' : formatter.format(n);

export default function AQTEBrokerPositions({ selectedSymbol }: { selectedSymbol: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | null = null;
    const poll = async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 15000);
      try {
        const response = await fetch(API_CONFIG.endpoint('/api/aqte/live/broker-positions'), {
          cache: 'no-store', credentials: 'include', signal: controller.signal,
          headers: { 'X-Device-Id': getOrCreateVisitorId(), 'X-AQTE-Intent': 'manual-live-control' },
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : 'Zerodha positions unavailable');
        if (payload.read_only !== true || !Array.isArray(payload.positions) ||
            typeof payload.generated_at !== 'number' || Date.now() / 1000 - payload.generated_at > 10) {
          throw new Error('Zerodha position response is invalid or stale');
        }
        if (payload.paused === true && (typeof payload.reason !== 'string' || !payload.reason)) {
          throw new Error('Zerodha pause reason is unavailable');
        }
        if (active) { setSnapshot(payload); setError(null); }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Zerodha positions unavailable; check Kite');
      } finally {
        clearTimeout(timeout);
        if (active) timer = setTimeout(poll, 2000);
      }
    };
    void poll();
    return () => { active = false; controller?.abort(); clearTimeout(timer); };
  }, []);
  const positions = snapshot?.positions.filter(p => p.symbol === selectedSymbol) ?? [];
  const indexLabel = selectedSymbol === 'BANKNIFTY' ? 'BANK NIFTY' : selectedSymbol;
  return (
    <div className="aqte-broker-panel my-3 min-w-0 space-y-3 rounded-xl border border-slate-600/60 bg-slate-950/60 p-3">
      <div className="flex flex-wrap justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-100">Zerodha positions · {indexLabel}</h3>
        <span className="text-xs text-cyan-200" title="Manual trades are not managed or exited by AQTE. Manage stops and exits in Kite.">Read-only · Manage in Kite</span>
      </div>
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
      {snapshot?.paused && !error && <p role="status" className="text-xs text-slate-300" title={snapshot.reason}>Broker readout paused · Positions unverified</p>}
      {!snapshot && !error && <p className="text-xs text-slate-400">Loading actual broker positions…</p>}
      {snapshot && !snapshot.paused && !positions.length && !error && <p className="text-xs text-slate-400">No open Zerodha derivative position for this index. Check other index tabs.</p>}
      {positions.map(p => {
        const current = !error && p.ltp != null;
        const stop = !error && p.stops.length === 1 ? p.stops[0].trigger : null;
        return (
          <article key={`${p.exchange}:${p.trading_symbol}:${p.product}`} className="min-w-0 space-y-2 rounded-lg border border-slate-700 p-3">
            <p className="break-all text-xs font-semibold text-cyan-100">{p.trading_symbol} · {p.product} · {p.quantity > 0 ? 'LONG' : 'SHORT'}</p>
            {(!current || error) && <p className="text-xs text-amber-200">Quote or broker status unavailable/stale · Check Kite</p>}
            <AQTEPosition compact mode="real" brokerReadOnly contract={p.trading_symbol}
              state={p.quantity > 0 ? 'KITE_LONG_READ_ONLY' : 'KITE_SHORT_READ_ONLY'}
              entry={p.entry} entryAt={null} limit={null} initialStop={null}
              stop={stop} target={null} peak={null} trailing={false}
              stopConfirmed={stop != null} unavailable={!!error}
              metrics={{ quantity: p.quantity, quote_at: p.quote_at, stale: !current,
                ltp: p.ltp, bid: null, points: p.points, return_pct: p.return_pct,
                gross_pnl: p.gross_pnl, net_pnl: null, peak_points: null, stop_points: null }} />
            <div className="rounded-lg border border-amber-400/30 p-2.5 text-xs text-amber-100">
              <p className="font-semibold">Existing broker stop orders{error ? ' · Last known, unverified' : ''}</p>
              {p.stops.length ? p.stops.map(stop => (
                <p key={stop.order_id} className="mt-1 break-words">Trigger {value(stop.trigger)} · Quantity {stop.quantity}/{Math.abs(p.quantity)} · {stop.status} · #{stop.order_id}{stop.quantity < Math.abs(p.quantity) ? ' · Partial quantity only' : ''}</p>
              )) : <p className="mt-1">No working broker SL found. A GTT or external stop is not verified here.</p>}
              <p className="mt-2">Initial SL / trailing history: unavailable for manually placed trades. A current trigger alone does not prove trailing is active.</p>
            </div>
            {!!p.exit_orders.length && <details className="text-xs text-slate-400">
              <summary className="cursor-pointer py-2">Other working exit orders</summary>
              {p.exit_orders.map(order => <p key={order.order_id}>#{order.order_id} · {order.status} · {order.quantity} @ {value(order.price)}</p>)}
            </details>}
            <p className="text-[10px] text-slate-400">Gross P&amp;L uses LTP, excludes fees and is not an executable bid/ask fill estimate. Stop orders can be partial or unfilled; verify in Kite.</p>
          </article>
        );
      })}
      {!positions.length && (
        <AQTEPosition compact mode="real" contract={indexLabel} empty unavailable={!!error || !snapshot || !!snapshot.paused} />
      )}
    </div>
  );
}
