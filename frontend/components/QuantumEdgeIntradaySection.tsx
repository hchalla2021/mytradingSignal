'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, BarChart3, Bot, Layers3, Pencil,
  ShieldCheck, Sparkles, Zap,
} from 'lucide-react';
import { API_CONFIG } from '@/lib/api-config';
import { getOrCreateVisitorId } from '@/lib/visitor-id';
import type { MarketData } from '@/hooks/useMarketSocket';

const SYMBOLS = ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const;
type SymbolName = (typeof SYMBOLS)[number];
type Signal = {
  decision: string; side?: 'CE' | 'PE'; reason?: string; setup_key?: string;
  status?: string;
  contract?: { trading_symbol?: string; lot_size?: number };
  entry?: { maximum?: number; stop?: number; target?: number; quantity?: number; reward_risk?: number };
  risk?: number; metrics?: Record<string, number | null>;
};
type IndexConfig = { enabled: boolean; lots: number; risk_per_lot: number };
type LiveTrade = {
  id: string; symbol: SymbolName; state: string; contract: { trading_symbol: string; lot_size?: number };
  stop: number; target: number; filled: number; quantity: number; entry_price: number;
  entry_at?: number; ltp?: number | null; unrealized?: number | null;
  trailing_active?: boolean; initial_stop?: number;
};
type Snapshot = {
  generated_at: number; ready: boolean; enabled: boolean; armed: boolean; entry_window: boolean;
  indices: Record<SymbolName, IndexConfig>; signals: Record<SymbolName, Signal>;
  active: LiveTrade | null; positions: LiveTrade[]; trades: LiveTrade[];
  daily_trades: number; daily_pnl: number; daily_loss_limit: number; max_trades: number;
  zerodha_connected: boolean; error: string | null;
  zerodha_state: string; market_phase: string; market_detail: string;
  ai: {
    enabled: boolean; model: string; busy: boolean; daily_calls: number;
    daily_cost_usd: number; processed: number; last_error: string | null;
    last_result: Record<string, { confidence?: number; reason?: string; state?: string; setup_key?: string }>;
  };
};

const displayName = (symbol: SymbolName) => symbol === 'BANKNIFTY' ? 'BANK NIFTY' : symbol;
const money = (value: number | null | undefined) =>
  Number.isFinite(value) ? `₹${Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}` : '—';
const number = (value: number | null | undefined, digits = 2) =>
  Number.isFinite(value) ? Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  }) : '—';

async function api(path: 'status' | 'approval' | 'index' | 'exit',
  body?: unknown, signal?: AbortSignal): Promise<Snapshot> {
  const response = await fetch(API_CONFIG.endpoint(`/api/quantumedge/${path}`), {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include',
    cache: 'no-store',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': getOrCreateVisitorId(),
      'X-AQTE-Intent': 'manual-live-control',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || `QuantumEdge request failed (${response.status})`);
  return payload as Snapshot;
}

function Switch({ checked, onChange, disabled, label }: {
  checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; label: string;
}) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label}
    disabled={disabled} onClick={() => onChange(!checked)}
    className={`relative h-7 w-12 shrink-0 rounded-full border transition ${
      checked ? 'border-emerald-400 bg-emerald-500' : 'border-slate-600 bg-slate-800'
    } disabled:cursor-not-allowed disabled:opacity-50`}>
    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
      checked ? 'left-6' : 'left-0.5'
    }`} />
  </button>;
}

export default function QuantumEdgeIntradaySection({
  marketData,
}: { marketData?: MarketData; isConnected?: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [editing, setEditing] = useState<SymbolName | null>(null);
  const [draft, setDraft] = useState<IndexConfig | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mutating = useRef(false);

  const load = useCallback(async () => {
    if (request.current || mutating.current) return;
    const controller = new AbortController();
    const started = generation.current;
    request.current = controller;
    try {
      const next = await api('status', undefined, controller.signal);
      if (!controller.signal.aborted && started === generation.current) {
        setSnapshot(next);
        setError(null);
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : 'QuantumEdge unavailable');
      }
    } finally {
      if (request.current === controller) request.current = null;
    }
  }, []);

  useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), 3000);
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(timer); request.current?.abort(); };
  }, [load]);

  const apply = useCallback(async (path: 'approval' | 'index' | 'exit', body: unknown) => {
    generation.current += 1;
    mutating.current = true;
    request.current?.abort();
    request.current = null;
    setBusy(true);
    setError(null);
    try {
      setSnapshot(await api(path, body));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'QuantumEdge update failed');
      return false;
    } finally {
      mutating.current = false;
      setBusy(false);
    }
    return true;
  }, []);

  const startEditing = useCallback(async (symbol: SymbolName, config: IndexConfig) => {
    if (snapshot?.enabled) {
      if (!window.confirm('Master Trade must be OFF before lots or risk can be saved. Turn it OFF now?')) return;
      const stopped = await apply('approval', { enabled: false });
      if (!stopped) return;
    }
    setDraft({ ...config });
    setEditing(symbol);
  }, [apply, snapshot?.enabled]);

  const saveConfig = useCallback(async (symbol: SymbolName, config: IndexConfig) => {
    if (!draft || !snapshot) return;
    const saved = await apply('index', {
      symbol, enabled: config.enabled, lots: draft.lots, risk_per_lot: draft.risk_per_lot,
    });
    if (saved) {
      setEditing(null);
      setDraft(null);
    }
  }, [apply, draft, snapshot]);

  const stale = !snapshot || Date.now() / 1000 - snapshot.generated_at > 10;
  const active = snapshot?.active ?? null;
  const opportunities = useMemo(() => SYMBOLS.map(symbol => {
    const signal = snapshot?.signals[symbol];
    const recorded = snapshot?.ai.last_result[symbol];
    const ai = signal?.setup_key && recorded?.setup_key === signal.setup_key ? recorded : undefined;
    return {
      symbol,
      signal,
      ai,
      side: signal?.side ?? null,
      premium: signal?.entry?.maximum ?? null,
      confidence: ai?.confidence ?? null,
      reason: signal?.reason ?? 'Awaiting market data',
      status: signal?.decision === 'BUY CE' || signal?.decision === 'BUY PE'
        ? signal.status ?? (ai?.state === 'APPROVED' ? 'READY' : ai?.state === 'REJECTED' ? 'REJECTED' : 'VALIDATING')
        : signal?.status ?? (snapshot?.market_phase === 'NORMAL' ? 'WAITING' : snapshot?.market_phase === 'PRE_OPEN'
          ? 'PRE-OPEN' : snapshot?.market_phase === 'AUCTION_FREEZE' ? 'AUCTION'
            : snapshot?.market_phase === 'CLOSING_AUCTION' ? 'MANAGE'
              : snapshot?.market_phase === 'POST_MARKET' ? 'POST-MARKET' : 'CLOSED'),
    };
  }), [snapshot]);

  const pnl = active?.unrealized ?? null;
  const pnlPct = pnl != null && active?.entry_price && active.quantity
    ? pnl * 100 / (active.entry_price * active.quantity)
    : null;

  return <section aria-label="QuantumEdge IntraDay Algo" className="qe-shell">
    <header className="qe-topbar">
      <div className="qe-brand">
        <BarChart3 aria-hidden="true" />
        <strong>QuantumEdge <span>IntraDay</span></strong>
        <i />
        <div className="qe-title">
          <h2><span className="sr-only">QuantumEdge IntraDay Algo — Intraday Algo | CE / PE</span>INTRADAY ALGO | CE / PE</h2>
          <p>AI + ML Powered • NIFTY • BANK NIFTY • SENSEX</p>
        </div>
      </div>
      <div className="qe-top-controls">
        <span className="qe-live-chip"><i /> AUTO {snapshot?.enabled ? 'LIVE' : 'OFF'}</span>
        <div className="qe-master">
          <b>MASTER TRADE</b>
          <Switch checked={snapshot?.enabled ?? false} disabled={busy || !snapshot || stale}
            label="QuantumEdge master auto live" onChange={enabled => void apply('approval', { enabled })} />
          <strong>{snapshot?.enabled ? 'ON' : 'OFF'}</strong>
        </div>
        <span className={`qe-broker ${snapshot?.zerodha_connected ? 'qe-connected' : ''}`}>
          <Zap /> <span><small>Zerodha</small><b>{snapshot?.zerodha_connected ? 'Connected' : 'Reconnect required'}</b></span>
        </span>
        <span className="qe-status" title={snapshot?.market_detail ?? ''}>
          <i className={snapshot?.market_phase === 'NORMAL' ? '' : 'qe-session-muted'} />
          Market <b>{snapshot?.market_phase === 'NORMAL' ? 'OPEN'
            : snapshot?.market_phase === 'PRE_OPEN' ? 'PRE-OPEN'
              : snapshot?.market_phase === 'AUCTION_FREEZE' ? 'AUCTION'
                : snapshot?.market_phase === 'CLOSING_AUCTION' ? 'CLOSE AUCTION'
                  : snapshot?.market_phase === 'POST_MARKET' ? 'POST-MARKET' : 'CLOSED'}</b>
        </span>
        <span className="qe-clock">{new Date(clock).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })} IST</span>
        <button type="button" className="qe-gear" aria-label="QuantumEdge settings"
          onClick={() => document.getElementById('qe-index-controls')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>⚙</button>
      </div>
    </header>

    <div id="qe-index-controls" className="qe-index-grid">
      {SYMBOLS.map(symbol => {
        const config = snapshot?.indices[symbol];
        const tick = marketData?.[symbol];
        const signal = snapshot?.signals[symbol];
        const up = Number(tick?.change ?? 0) >= 0;
        const waiting = signal?.decision !== 'BUY CE' && signal?.decision !== 'BUY PE';
        return <article key={symbol} className="qe-index-card">
          <div className="qe-index-heading">
            <div><BarChart3 /><strong>{displayName(symbol)}</strong></div>
            <label>Enabled <Switch checked={config?.enabled ?? false}
              disabled={busy || !snapshot || snapshot.enabled}
              label={`${displayName(symbol)} independent engine`}
              onChange={enabled => config && void apply('index', {
                symbol, enabled, lots: config.lots, risk_per_lot: config.risk_per_lot,
              })} /></label>
          </div>
          <div className="qe-price-line">
            <b>{number(tick?.price)}</b>
            <span className={up ? 'qe-up' : 'qe-down'}>{up ? '▲' : '▼'} {number(tick?.change)} ({number(tick?.changePercent)}%)</span>
            <em>{waiting ? 'WAITING' : signal?.side}</em>
          </div>
          <div className="qe-config-row">
            <label htmlFor={`qe-lots-${symbol}`}>Lots</label>
            <input id={`qe-lots-${symbol}`} type="number" min={1} max={5}
              value={editing === symbol ? draft?.lots ?? 1 : config?.lots ?? 1}
              disabled={busy || editing !== symbol} aria-label={`${displayName(symbol)} lots`}
              onChange={event => editing === symbol && setDraft(current => ({
                ...(current ?? config ?? { enabled: true, lots: 1, risk_per_lot: 500 }),
                lots: Number(event.target.value),
              }))} />
            <label htmlFor={`qe-risk-${symbol}`}>Risk / lot (₹)</label>
            <input id={`qe-risk-${symbol}`} type="number" min={100} max={10000} step={100}
              value={editing === symbol ? draft?.risk_per_lot ?? 500 : config?.risk_per_lot ?? 500}
              disabled={busy || editing !== symbol} aria-label={`${displayName(symbol)} risk per lot`}
              onChange={event => editing === symbol && setDraft(current => ({
                ...(current ?? config ?? { enabled: true, lots: 1, risk_per_lot: 500 }),
                risk_per_lot: Number(event.target.value),
              }))} />
            {editing === symbol ? <button type="button" className="qe-save-config" disabled={busy ||
                !draft || !Number.isInteger(draft.lots) || draft.lots < 1 || draft.lots > 5 ||
                !Number.isInteger(draft.risk_per_lot) || draft.risk_per_lot < 100 ||
                draft.risk_per_lot > 10000}
              onClick={() => config && void saveConfig(symbol, config)}>
              Save
            </button> : <button type="button" className="qe-edit-config" disabled={busy || !config}
              aria-label={`Edit ${displayName(symbol)} lots and risk`}
              onClick={() => config && void startEditing(symbol, config)}>
              <Pencil />
            </button>}
          </div>
        </article>;
      })}
    </div>

    <div className="qe-main-grid">
      <section className="qe-panel qe-active" aria-label="QuantumEdge active trade">
        <div className="qe-panel-head">
          <h3><i /> ACTIVE TRADE</h3>
          <span>{active ? `${active.state.replaceAll('_', ' ')} · ${activeSymbolLabel(active)}` : 'WAITING FOR QUALIFIED SIGNAL'}</span>
        </div>
        <div className="qe-trade-identity">
          <strong className={active?.contract.trading_symbol.endsWith('PE') ? 'qe-pe' : ''}>
            {active ? active.symbol + ' ' + (active.contract.trading_symbol.endsWith('PE') ? 'PE' : 'CE') : 'NO POSITION'}
          </strong>
          <b>{active?.contract.trading_symbol ?? 'QuantumEdge is monitoring completed-candle signals'}</b>
          <span className="qe-buy">{active ? 'BUY' : 'AUTO'}</span>
          <span className="qe-confidence">AI <b>✓ {active ? number(snapshot?.ai.last_result[active.symbol]?.confidence, 0) : 0}%</b></span>
          <small>{active?.entry_at ? `Opened ${new Date(active.entry_at * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })}` : 'Signal-triggered AI only'}</small>
        </div>
        <div className="qe-level-grid">
          {[
            ['Entry', money(active?.entry_price)],
            ['Stop Loss', money(active?.stop)],
            ['Trailing SL', money(active?.trailing_active ? active.stop : active?.initial_stop ?? active?.stop)],
            ['Target', money(active?.target)],
          ].map(([name, value], index) => <div key={name} className={`qe-level qe-level-${index}`}>
            <small>{name}</small><b>{value}</b>
          </div>)}
          <div className="qe-level qe-pnl"><small>P&L</small><b>{pnl == null ? '—' : money(pnl)}</b><span>{pnlPct == null ? 'Awaiting broker mark' : `${pnlPct >= 0 ? '+' : ''}${number(pnlPct)}%`}</span></div>
        </div>
        <div className="qe-risk-track">
          <div className="qe-track-fill"><span>{active ? money(active.entry_price) : 'ENTRY'}</span></div>
          <div className="qe-track-labels"><span>{money(active?.stop)}<small>(SL)</small></span><span>{money(active?.target)}<small>(Target)</small></span></div>
        </div>
        <button type="button" className="qe-square-off" disabled={!active || busy || stale}
          onClick={() => active && window.confirm(`Square off QuantumEdge trade ${active.contract.trading_symbol}?`)
            && void apply('exit', { trade_id: active.id })}>
          ■ &nbsp; SQUARE OFF
        </button>
      </section>

      <section className="qe-panel qe-opportunities" aria-label="QuantumEdge live opportunities">
        <div className="qe-panel-head"><h3><Zap /> LIVE OPPORTUNITIES (AUTO)</h3></div>
        <table className="qe-opp-table">
          <thead><tr><th>Index</th><th>Signal</th><th>Premium</th><th>Confidence</th><th>Status</th></tr></thead>
          <tbody>{opportunities.map(item => <tr key={item.symbol}>
            <td><i /> {displayName(item.symbol)}</td>
            <td><span className={item.side === 'PE' ? 'qe-side-pe' : item.side === 'CE' ? 'qe-side-ce' : 'qe-side-wait'}>{item.side ?? '—'}</span></td>
            <td>{money(item.premium)}</td>
            <td className="qe-confidence-cell"><span>{item.confidence == null ? '—' : `${number(item.confidence, 0)}%`}</span><i><b style={{ width: `${item.confidence ?? 0}%` }} /></i></td>
            <td><em title={item.reason}
              className={['LIVE', 'LIVE_POSITION', 'READY'].includes(item.status)
                ? 'qe-state-live' : item.status === 'REJECTED' ? 'qe-state-reject' : 'qe-state-wait'}>{item.status}</em></td>
          </tr>)}</tbody>
        </table>
      </section>
    </div>

    <section className="qe-positions" aria-label="QuantumEdge positions">
      <div className="qe-positions-head"><h3><Layers3 /> <i /> POSITIONS (LIVE)</h3><span>Total P&L: <b>{money(snapshot?.daily_pnl)}</b> <em>(+0.00%)</em></span></div>
      <table>
        <thead><tr><th>#</th><th>Index</th><th>Contract</th><th>Lots</th><th>Entry (₹)</th><th>LTP (₹)</th><th>SL (₹)</th><th>Trailing SL (₹)</th><th>Target (₹)</th><th>P&L (₹)</th><th>P&L (%)</th><th>Status</th></tr></thead>
        <tbody>{snapshot?.positions.length ? snapshot.positions.map((trade, index) => <tr key={trade.id}>
          <td>{index + 1}</td><td>{trade.symbol}</td><td>{trade.contract.trading_symbol}</td><td>{trade.contract.lot_size ? number(trade.quantity / trade.contract.lot_size, 0) : '—'}</td>
          <td>{money(trade.entry_price)}</td><td>{money(trade.ltp)}</td><td>{money(trade.initial_stop ?? trade.stop)}</td><td>{money(trade.stop)}</td><td>{money(trade.target)}</td><td>{money(trade.unrealized)}</td><td>{trade.unrealized != null && trade.entry_price && trade.quantity ? `${number(trade.unrealized * 100 / (trade.entry_price * trade.quantity))}%` : '—'}</td><td><span>• LIVE</span></td>
        </tr>) : <tr className="qe-empty-row"><td colSpan={12}>No QuantumEdge-owned live positions.</td></tr>}</tbody>
      </table>
    </section>

    <footer className="qe-footer">
      <span className="qe-engine-chip"><Sparkles /> Engine <b>{snapshot?.enabled ? 'ON' : 'OFF'}</b></span>
      <span><Layers3 /> Independent parallel signal engines (NIFTY / BANK NIFTY / SENSEX)</span>
      <span><Bot /> AI validation on qualified signals ({snapshot?.ai.model ?? 'model from env'})</span>
      <span><ShieldCheck /> Risk guards, SL, trailing SL, target, position & exposure control</span>
      <span title={snapshot?.market_detail ?? ''}><Sparkles /> {snapshot?.market_detail ?? 'Market session status unavailable'}</span>
    </footer>
    {(error || snapshot?.error || snapshot?.ai.last_error) && <p role="alert" className="qe-error">
      <AlertTriangle /> {error || snapshot?.error || snapshot?.ai.last_error}
    </p>}
  </section>;
}

function activeSymbolLabel(trade: LiveTrade) {
  return trade.contract.trading_symbol.endsWith('PE') ? 'PUT POSITION' : 'CALL POSITION';
}
