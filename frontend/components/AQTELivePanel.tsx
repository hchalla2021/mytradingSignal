'use client';

import { useEffect, useState } from 'react';
import { API_CONFIG } from '@/lib/api-config';
import { getOrCreateVisitorId } from '@/lib/visitor-id';
import AQTEPosition, { type PositionMetrics } from '@/components/AQTEPosition';
import AQTEBrokerPositions from '@/components/AQTEBrokerPositions';

export type LiveState = {
  enabled: boolean;
  paper_validated: boolean;
  expected_ip: string;
  ready: boolean;
  armed: boolean;
  automation_on: boolean;
  killed: boolean;
  error: string | null;
  preflight: { ip: string; at: number; account: string } | null;
  limits: { risk_per_trade: number; daily_loss: number; max_trades: number; max_losses: number; max_lots: number };
  active: {
    symbol: string; state: string; filled: number; entry_price: number;
    stop: number; target: number; error: string | null;
    initial_stop: number; peak: number; trailing_active?: boolean; trail_start_r?: number;
    fill_at?: number; entry_at: number; limit: number; protection_confirmed?: boolean; metrics: PositionMetrics;
    modify?: { order_type: string; trigger_price: number };
    entry_id: string | null; protect_id: string | null;
    contract: { trading_symbol: string };
  } | null;
  trades: Array<{ symbol: string; net_pnl: number; exit_at: number }>;
};
const money = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const headers = () => ({
  'Content-Type': 'application/json',
  'X-Device-Id': getOrCreateVisitorId(),
  'X-AQTE-Intent': 'manual-live-control',
});

async function request(path: string, body?: object, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(API_CONFIG.endpoint(`/api/aqte/live/${path}`), {
    method: body === undefined ? 'GET' : 'POST',
    headers: headers(), credentials: 'include', cache: 'no-store', signal,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && 'detail' in payload ? payload.detail : null;
    throw new Error(typeof detail === 'string' ? detail : `Live operation failed (${response.status}); inspect Kite before retrying`);
  }
  return payload;
}

function liveState(value: unknown): LiveState {
  if (!value || typeof value !== 'object' || !('enabled' in value) ||
      typeof value.enabled !== 'boolean' || !('limits' in value) || !value.limits ||
      !('armed' in value) || typeof value.armed !== 'boolean') {
    throw new Error('Invalid live-controller response');
  }
  return value as LiveState;
}

export default function AQTELivePanel({ selectedSymbol, onStatus }: {
  selectedSymbol?: 'NIFTY' | 'BANKNIFTY' | 'SENSEX';
  onStatus?: (status: LiveState | null) => void;
}) {
  const [status, setStatus] = useState<LiveState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | null = null;
    const poll = async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 8000);
      try {
        const value = liveState(await request('status', undefined, controller.signal));
        if (active) {
          setStatus(value);
          setConnected(true);
          setError(null);
          onStatus?.(value);
        }
      } catch (cause) {
        if (active) {
          setConnected(false);
          setError(cause instanceof Error ? cause.message : 'Live status unavailable; inspect Kite');
          onStatus?.(null);
        }
      } finally {
        clearTimeout(timeout);
        if (active) timer = setTimeout(poll, 2000);
      }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); controller?.abort(); };
  }, [onStatus]);

  const act = async (path: string, body: object) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const value = await request(path, body);
      const state = liveState(value);
      setStatus(state);
      onStatus?.(state);
      setConnected(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Live action failed. Check Kite before retrying.');
      onStatus?.(null);
    } finally {
      setBusy(false);
    }
  };
  const blocked = !connected || !status?.ready || !status.enabled || !status.paper_validated || status.killed;
  const selectedPosition = status?.active && (!selectedSymbol || status.active.symbol === selectedSymbol) ? status.active : null;
  const button = 'min-h-[44px] rounded-lg border px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300';
  return (
    <div className="mb-4 min-w-0 space-y-3 rounded-xl border border-amber-400/30 bg-amber-400/5 p-2.5 sm:p-4">
      <div aria-label="Live trading controls" className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-amber-100">Real trading · Daily arming &amp; automation</h3>
        <span className={`mt-2 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${
          connected && status?.killed ? 'border-rose-400/40 bg-rose-400/10 text-rose-200' :
            connected && status?.automation_on ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200' :
              'border-amber-400/40 bg-amber-400/10 text-amber-200'
        }`}>
          {!connected ? 'STATUS UNAVAILABLE' : status?.killed ? 'EMERGENCY STOP' : status?.automation_on ? 'AUTOMATION ON' : status?.armed ? 'ARMED · AUTOMATION OFF' : 'LIVE LOCKED'}
        </span>
        </div>
        <button type="button" className={`${button} ml-auto w-full border-rose-400/50 bg-rose-500/10 text-rose-100 shadow-sm transition-colors hover:bg-rose-500/20 sm:w-auto`} disabled={busy || !status?.ready} onClick={() => void act('stop', {})}>Emergency stop &amp; request exit</button>
      </div>
      <p className="text-xs leading-relaxed text-rose-200">AQTE auto trades only. For a temporary pause, use AUTO REAL TRADING OFF. Emergency Stop blocks entries and requests exit of AQTE-managed positions; it does not exit manual Kite trades.</p>
      <details className="rounded-lg border border-amber-400/20 px-3 text-xs text-slate-400">
      <summary className="cursor-pointer py-2 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Setup, limits &amp; safety details</summary>
      <div className="space-y-3 pb-3">
      <p>Switching tabs never places orders. After daily arming, use the header ON/OFF switch to authorize automatic real entries.</p>
      {status && (
        <div className="grid gap-2 text-xs text-slate-300 sm:grid-cols-3">
          <p className="min-w-0 rounded-lg border border-slate-600/60 bg-slate-950/60 p-3">Configured static IP <strong className="mt-1 block break-words text-slate-100 tabular-nums">{status.expected_ip}</strong></p>
          <p className="min-w-0 rounded-lg border border-slate-600/60 bg-slate-950/60 p-3">Risk / trade <strong className="mt-1 block break-words text-slate-100 tabular-nums">INR {money(status.limits.risk_per_trade)} · {status.limits.max_lots} lot max</strong></p>
          <p className="min-w-0 rounded-lg border border-slate-600/60 bg-slate-950/60 p-3">Daily limits <strong className="mt-1 block break-words text-slate-100 tabular-nums">INR {money(status.limits.daily_loss)} · {status.limits.max_trades} trades · {status.limits.max_losses} losses</strong></p>
        </div>
      )}
      {(!status?.enabled || !status?.paper_validated) && (
        <p className="text-xs leading-relaxed text-amber-200">
          Real trading is not enabled until AQTE_LIVE_ENABLED and AQTE_LIVE_PAPER_VALIDATED are approved in backend settings.
          An IP whitelist alone is not validation. No real orders have been authorized by this view.
        </p>
      )}
      {status?.preflight && (
        <p className="text-xs text-cyan-200">Last preflight: {status.preflight.ip} · Account {status.preflight.account} · {new Date(status.preflight.at * 1000).toLocaleTimeString()} (not continuous IP verification)</p>
      )}
      <div aria-label="Live setup controls" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button type="button" className={`${button} border-cyan-400/30 text-cyan-200`} disabled={busy || blocked || !!status?.active} onClick={() => void act('preflight', {})}>Check static IP &amp; Kite</button>
        <button type="button" className={`${button} border-amber-400/30 text-amber-200`} disabled={busy || blocked || !status?.preflight || status.armed || !!status.active} onClick={() => void act('arm', { confirmation: 'ARM REAL TRADING' })}>Arm real trading today</button>
      </div>
      <p>Emergency exit is a request, not a fill guarantee. Broker stop-limit orders can remain unfilled after gaps. Keep Kite open; use its order book if a protection or reconciliation alert appears.</p>
      <p>Trailing starts at the saved R threshold captured for each entry (default +1R), follows the highest fresh bid by the initial risk distance and never moves down. It updates the same broker stop; pending changes are not shown as confirmed. Protective exits and trailing continue while automation is OFF.</p>
      </div>
      </details>
      {(error || status?.error || status?.active?.error) && (
        <p role="alert" className="break-words rounded-lg border border-rose-400/30 bg-rose-400/10 p-3 text-xs leading-relaxed text-rose-200">
          {error || status?.error || status?.active?.error}
        </p>
      )}
      {selectedPosition ? (
        <div>
          <AQTEPosition compact mode="real" contract={selectedPosition.contract.trading_symbol}
            state={selectedPosition.state} entry={selectedPosition.filled > 0 ? selectedPosition.entry_price : null}
            entryAt={selectedPosition.fill_at ?? null} limit={selectedPosition.limit}
            initialStop={selectedPosition.initial_stop} stop={selectedPosition.stop} target={selectedPosition.target}
            peak={selectedPosition.peak} trailing={!!selectedPosition.trailing_active}
            trailStartR={selectedPosition.trail_start_r ?? 1}
            stopConfirmed={!!selectedPosition.protection_confirmed}
            pendingStop={selectedPosition.modify?.order_type === 'SL' ? selectedPosition.modify.trigger_price : undefined}
            metrics={selectedPosition.metrics} unavailable={!connected || !!status?.error || !!selectedPosition.error} />
          <details className="mt-2 text-[11px] text-slate-400">
            <summary className="cursor-pointer py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Broker order references</summary>
            <p className="break-all pb-2">Entry order {selectedPosition.entry_id ?? 'Reconciling'} · Protective order {selectedPosition.protect_id ?? 'Not yet acknowledged'}</p>
          </details>
        </div>
      ) : (
        <div>
          <p className="text-xs text-slate-400">{status?.active
            ? `An active ${status.active.symbol} live position is managed in its own index tab. Protective management continues; emergency stop remains account-wide.`
            : 'No AQTE-managed trade · Checking actual Zerodha positions below'}</p>
          <AQTEBrokerPositions selectedSymbol={selectedSymbol ?? 'NIFTY'} />
        </div>
      )}
      {!!status?.trades.length && <p className="text-xs text-slate-400">Last closed live trade: {status.trades[status.trades.length - 1].symbol} · Net estimate INR {money(status.trades[status.trades.length - 1].net_pnl)} (estimated costs, not broker contract-note charges)</p>}
    </div>
  );
}
