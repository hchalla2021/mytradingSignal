'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, BarChart3, Bot, Coins, Crosshair, Layers3, Pencil,
  Settings, ShieldCheck, Sparkles, TrendingUp, Zap,
} from 'lucide-react';
import { API_CONFIG } from '@/lib/api-config';
import { getOrCreateVisitorId } from '@/lib/visitor-id';
import type { MarketData } from '@/hooks/useMarketSocket';
import QuantumEdgeMiniChart from './QuantumEdgeMiniChart';

const SYMBOLS = ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const;
type SymbolName = (typeof SYMBOLS)[number];
type Signal = {
  decision: string; side?: 'CE' | 'PE'; reason?: string; setup_key?: string;
  institutional?: {
    decision_id: string; permission: 'ALLOW' | 'NO_TRADE'; mode: 'shadow' | 'live_gate';
    score: number; vetoes: string[];
  };
  readiness?: {
    spot_fresh: boolean; futures_fresh: boolean;
    completed_minutes: number; completed_minutes_required: number;
    contiguous_completed_minutes?: number;
    opening_minutes: number; opening_minutes_required: number;
    prior_day_levels: boolean; strategy_count?: number; qualified_setup_count?: number;
  };
  alternate_strike?: boolean;
  status?: string;
  strategy_name?: string;
  contract?: { trading_symbol?: string; lot_size?: number };
  entry?: { maximum?: number; stop?: number; target?: number; quantity?: number; reward_risk?: number };
  risk?: number; metrics?: Record<string, number | null>;
  advisory?: {
    available: boolean; engine_count: number; aligned: number; opposed: number;
    supporting: string[]; conflicting: string[]; reason?: string;
    advanced?: { smc_verdict?: string; smc_confidence?: number | null; smc_available: boolean;
      order_flow_available: boolean };
  };
  price_action?: {
    structure: 'BULLISH' | 'BEARISH' | 'INSIDE_RANGE';
    displacement: 'BULLISH' | 'BEARISH' | null;
    fvg: { side: 'BULLISH' | 'BEARISH'; low: number; high: number } | null;
  } | null;
};
type IndexConfig = { enabled: boolean; lots: number; risk_per_lot: number };
type LiveTrade = {
  id: string; symbol: SymbolName; state: string; contract: { trading_symbol: string; lot_size?: number };
  stop: number; target: number; filled: number; quantity: number; entry_price: number;
  entry_at?: number; ltp?: number | null; unrealized?: number | null;
  trailing_active?: boolean; initial_stop?: number;
  trailing_mode?: 'SMART_ATR_STRUCTURE';
  trailing_status?: 'WAITING_FOR_1R' | 'BREAKEVEN' | 'R_MULTIPLE_FALLBACK'
    | 'SMART_ATR_STRUCTURE' | 'SMART_TRAIL_CROSSED';
  futures_invalidation?: { level: number; reference: number; buffer: number; basis: string };
  futures_invalidation_status?: 'MONITORING' | 'FUTURES_FEED_UNAVAILABLE' | 'MARKET_DATA_UNAVAILABLE' | 'TRIGGERED';
  execution_context?: { confidence?: number | null };
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
    ml?: { mode: string; ready: boolean; model_id: string | null; error: string | null; eligible_sides: string[] };
    last_result: Record<string, { confidence?: number; reason?: string; state?: string; setup_key?: string;
      ml?: { state: string; score?: number | null } }>;
  };
};

const displayName = (symbol: SymbolName) => symbol === 'BANKNIFTY' ? 'BANK NIFTY' : symbol;
const decimal = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (value: number | null | undefined) =>
  value != null && Number.isFinite(value) ? `₹${decimal.format(value)}` : '—';
function number(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return '—';
  return digits === 2 ? decimal.format(value) : value.toLocaleString('en-IN', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}

function pnlTone(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || Math.round(Math.abs(value) * 100) === 0) return 'qe-pnl-flat';
  return value > 0 ? 'qe-pnl-profit' : 'qe-pnl-loss';
}

function tradeReturn(trade: LiveTrade | null | undefined) {
  return trade?.unrealized != null && trade.entry_price > 0 && trade.quantity > 0
    ? trade.unrealized * 100 / (trade.entry_price * trade.quantity) : null;
}

function returnLabel(value: number | null) {
  return value != null && Number.isFinite(value) ? `${pnlTone(value) === 'qe-pnl-profit' ? '+' : ''}${number(value)}%` : '—';
}

function priceActionLabel(evidence: Signal['price_action']) {
  if (!evidence) return null;
  const { structure, displacement, fvg } = evidence;
  return [
    structure === 'INSIDE_RANGE' ? 'Inside 5-bar range' : `${structure === 'BULLISH' ? 'Upside' : 'Downside'} 5-bar break`,
    ...(displacement ? [`${displacement === 'BULLISH' ? 'Bullish' : 'Bearish'} displacement`] : []),
    fvg ? `${fvg.side === 'BULLISH' ? 'Bullish' : 'Bearish'} FVG ${number(fvg.low)}–${number(fvg.high)}` : 'No open FVG detected',
  ].join(' · ');
}

function readinessLabel(readiness: Signal['readiness']) {
  if (!readiness) return null;
  const parts = [
    `Spot ${readiness.spot_fresh ? 'fresh' : 'not fresh'}`,
    `futures ${readiness.futures_fresh ? 'fresh' : 'not fresh'}`,
    `${readiness.contiguous_completed_minutes ?? readiness.completed_minutes}/${readiness.completed_minutes_required} contiguous 1m`,
    `${readiness.opening_minutes}/${readiness.opening_minutes_required} opening`,
    `prior-day ${readiness.prior_day_levels ? 'available' : 'unavailable'}`,
  ];
  return `Data: ${parts.join(' · ')}`;
}

const opportunityLabels: Record<string, string> = {
  WAIT_SIGNAL: 'NO ENTRY', REJECTED: 'AI REJECTED', AI_UNAVAILABLE: 'AI REVIEW UNAVAILABLE',
};

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
  const hasOpenPosition = Boolean(snapshot?.positions.length);

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
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => { clearInterval(timer); request.current?.abort(); };
  }, [load]);

  useEffect(() => {
    const poll = setInterval(() => void load(), hasOpenPosition ? 1000 : 3000);
    return () => clearInterval(poll);
  }, [hasOpenPosition, load]);

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
  const marketStatusClass = snapshot?.market_phase === 'NORMAL' ? 'qe-market-open'
    : ['PRE_OPEN', 'AUCTION_FREEZE', 'CLOSING_AUCTION', 'POST_MARKET'].includes(snapshot?.market_phase ?? '')
      ? 'qe-market-transition' : 'qe-market-closed';
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
      reason: signal?.reason === 'ValueError' ? 'Claude returned an invalid decision'
        : signal?.reason ?? 'Awaiting market data',
      status: signal?.decision === 'BUY CE' || signal?.decision === 'BUY PE'
        ? signal.status === 'REJECTED' && signal.reason === 'ValueError' ? 'AI_UNAVAILABLE'
          : signal.status === 'READY' ? 'AI_APPROVED'
          : signal.status ?? (ai?.state === 'APPROVED' ? 'AI_APPROVED'
            : ai?.state === 'REJECTED' || ai?.state === 'AI_UNAVAILABLE' ? ai.state : 'VALIDATING')
        : signal?.status ?? (snapshot?.market_phase === 'NORMAL' ? 'WAITING' : snapshot?.market_phase === 'PRE_OPEN'
          ? 'PRE-OPEN' : snapshot?.market_phase === 'AUCTION_FREEZE' ? 'AUCTION'
            : snapshot?.market_phase === 'CLOSING_AUCTION' ? 'MANAGE'
              : snapshot?.market_phase === 'POST_MARKET' ? 'POST-MARKET' : 'CLOSED'),
    };
  }), [snapshot]);
  const pending = opportunities.find(item => item.side && item.status === 'ENTRY_BLOCKED')
    ?? opportunities.find(item => item.side && item.status === 'AI_APPROVED');
  const activeConfidence = active?.execution_context?.confidence;
  const ltp = active?.ltp;
  const ltpPosition = active && ltp != null && Number.isFinite(ltp)
    && Number.isFinite(active.stop) && Number.isFinite(active.target) && active.target > active.stop
    ? Math.max(0, Math.min(100, (ltp - active.stop) / (active.target - active.stop) * 100))
    : null;
  const activeLevels = useMemo(() => {
    const pnl = active?.unrealized;
    return <div className="qe-level-grid">
      {[
        ['Entry', 'entry', money(active?.entry_price)],
        ['LTP', 'ltp', money(active?.ltp)],
        ['Stop Loss', 'stop', money(active?.stop)],
        ['Trailing SL', 'trail', money(active?.trailing_active ? active.stop : active?.initial_stop ?? active?.stop)],
        ['Target', 'target', money(active?.target)],
      ].map(([label, key, value]) => <div key={key} className={`qe-level qe-level-${key}`}>
        <small>{label}</small><b title={value}>{value}</b>
        {key === 'trail' && active?.trailing_mode === 'SMART_ATR_STRUCTURE' && <span className="qe-level-note">
          {active.trailing_status === 'WAITING_FOR_1R' ? 'Arms after +1R'
            : active.trailing_status === 'BREAKEVEN' ? 'Estimated breakeven locked'
              : active.trailing_status === 'R_MULTIPLE_FALLBACK' ? 'R-trail fallback · waiting for candles'
                : active.trailing_status === 'SMART_TRAIL_CROSSED' ? 'Crossed · exiting through existing order'
                  : 'ATR + confirmed option swing'}
        </span>}
      </div>)}
      <div className={`qe-level qe-pnl ${pnlTone(pnl)}`}>
        <small>P&L</small><b title={money(pnl)}>{money(pnl)}</b>
        <span>{pnl == null ? active ? 'Awaiting mark' : 'No position' : returnLabel(tradeReturn(active))}</span>
      </div>
      {active?.futures_invalidation && <div className="qe-level qe-level-invalidation">
        <small>Futures Invalidation</small>
        <b title={number(active.futures_invalidation.level)}>{number(active.futures_invalidation.level)}</b>
        <span>{active.futures_invalidation_status === 'FUTURES_FEED_UNAVAILABLE'
          || active.futures_invalidation_status === 'MARKET_DATA_UNAVAILABLE'
          ? 'Data unavailable · option hard stop active'
          : active.futures_invalidation_status === 'TRIGGERED'
            ? 'Triggered · exit via existing order'
            : `${active.futures_invalidation.basis.replace('_', ' ')} · confirmed 1m close`}</span>
      </div>}
    </div>;
  }, [active]);
  const positions = snapshot?.positions;
  const openPnl = useMemo(() => positions?.reduce<number | null>((total, trade) => {
    const mark = trade.unrealized;
    return total != null && mark != null && Number.isFinite(mark) ? total + mark : null;
  }, 0) ?? null, [positions]);
  const realizedPnl = snapshot?.daily_pnl;
  const positionRows = useMemo(() => positions?.length ? positions.map((trade, index) => {
    const tone = pnlTone(trade.unrealized);
    return <tr key={trade.id}>
      <td><span className="qe-position-value">{index + 1}</span></td>
      <td><span className="qe-position-value">{trade.symbol}</span></td>
      <td><span className="qe-position-value" title={trade.contract.trading_symbol}>{trade.contract.trading_symbol}</span></td>
      <td><span className="qe-position-value">{trade.contract.lot_size ? number(trade.quantity / trade.contract.lot_size, 0) : '—'}</span></td>
      <td><span className="qe-position-value">{money(trade.entry_price)}</span></td>
      <td className="qe-position-ltp"><span className="qe-position-value">{money(trade.ltp)}</span></td>
      <td className="qe-position-stop"><span className="qe-position-value">{money(trade.initial_stop ?? trade.stop)}</span></td>
      <td className="qe-position-trail"><span className="qe-position-value">{money(trade.stop)}</span></td>
      <td className="qe-position-target"><span className="qe-position-value">{money(trade.target)}</span></td>
      <td className={tone}><span className="qe-position-value">{money(trade.unrealized)}</span></td>
      <td className={tone}><span className="qe-position-value">{returnLabel(tradeReturn(trade))}</span></td>
      <td className="qe-position-status">
        <button type="button" className="qe-position-value qe-position-exit" disabled={busy || stale}
          aria-label={`Square off ${trade.contract.trading_symbol}`}
          onClick={() => window.confirm(`Square off QuantumEdge trade ${trade.contract.trading_symbol}?`)
            && void apply('exit', { trade_id: trade.id })}>• LIVE · SQUARE OFF</button>
      </td>
    </tr>;
  }) : <tr className="qe-empty-row"><td colSpan={12}>
    <span className="qe-empty-icon"><Layers3 aria-hidden="true" /></span>
    <span>No open algo positions</span>
    <small>QuantumEdge positions will appear here after a confirmed fill.</small>
  </td></tr>, [positions, busy, stale, apply]);

  return <section aria-label="QuantumEdge IntraDay Algo" className="qe-shell">
    <header className="qe-topbar">
      <div className="qe-brand">
        <span className="qe-brand-icon" aria-hidden="true">
          <BarChart3 className="qe-brand-bars" />
          <TrendingUp className="qe-brand-trend" />
        </span>
        <div className="qe-brand-copy">
          <h2 className="qe-brand-title">QuantumEdge <span>Intraday</span></h2>
          <p>Python Rules • Price Action • AI Analysis • NIFTY • BANK NIFTY • SENSEX</p>
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
          <i className={marketStatusClass} />
          <span className="qe-status-copy"><span>Market</span><b className={marketStatusClass}>{snapshot?.market_phase === 'NORMAL' ? 'OPEN'
            : snapshot?.market_phase === 'PRE_OPEN' ? 'PRE-OPEN'
              : snapshot?.market_phase === 'AUCTION_FREEZE' ? 'AUCTION'
                : snapshot?.market_phase === 'CLOSING_AUCTION' ? 'CLOSE AUCTION'
                  : snapshot?.market_phase === 'POST_MARKET' ? 'POST-MARKET' : 'CLOSED'}</b></span>
        </span>
        <span className="qe-clock">{new Date(clock).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })} IST</span>
        <button type="button" className="qe-gear" aria-label="QuantumEdge settings"
          onClick={() => document.getElementById('qe-index-controls')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
          <Settings aria-hidden="true" />
        </button>
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
        <div className="qe-active-heading">
          <div className="qe-opp-heading qe-active-title">
            <span className="qe-opp-icon"><Activity aria-hidden="true" /></span>
            <div>
              <h3>ACTIVE <span>TRADE</span></h3>
              <p>Live position and risk overview</p>
            </div>
          </div>
          <div className="qe-active-actions">
            <span className="qe-active-state">{active ? `${active.state.replaceAll('_', ' ')} · ${activeSymbolLabel(active)}`
              : pending ? `${displayName(pending.symbol)} · ${pending.status === 'ENTRY_BLOCKED' ? 'ENTRY BLOCKED' : 'AI APPROVED · NO ORDER YET'}`
              : 'WAITING FOR QUALIFIED SIGNAL'}</span>
            <button type="button" className="qe-square-off" disabled={!active || busy || stale}
              onClick={() => active && window.confirm(`Square off QuantumEdge trade ${active.contract.trading_symbol}?`)
                && void apply('exit', { trade_id: active.id })}>
              ■ &nbsp; SQUARE OFF
            </button>
          </div>
        </div>
        <div className="qe-trade-identity">
          <strong className={active?.contract.trading_symbol.endsWith('PE') ? 'qe-pe' : ''}>
            {active ? active.symbol + ' ' + (active.contract.trading_symbol.endsWith('PE') ? 'PE' : 'CE') : 'NO POSITION'}
          </strong>
          <b>{active?.contract.trading_symbol ?? (pending?.status === 'ENTRY_BLOCKED' ? pending.reason
            : pending ? 'Awaiting execution checks' : 'QuantumEdge is monitoring completed-candle signals')}</b>
          <span className="qe-buy">{active ? 'BUY' : 'AUTO'}</span>
          <span className="qe-confidence">AI <b>{activeConfidence == null ? '—' : `${number(activeConfidence, 0)}%`}</b></span>
          <small>{active?.entry_at ? `Opened ${new Date(active.entry_at * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })}` : 'Signal-triggered AI only'}</small>
        </div>
        {activeLevels}
        <div className="qe-risk-track">
          <div className="qe-track-caption"><span>LTP {money(ltp)}</span></div>
          <div className={`qe-track-fill${ltpPosition == null ? '' : ' qe-track-marked'}`} aria-hidden="true">
            {ltpPosition != null && <i className="qe-track-marker" style={{ left: `${ltpPosition}%` }} />}
          </div>
          <div className="qe-track-labels"><span>{money(active?.stop)}<small>(SL)</small></span><span>{money(active?.target)}<small>(Target)</small></span></div>
        </div>
        <QuantumEdgeMiniChart marketData={marketData} />
      </section>

      <section className="qe-panel qe-opportunities" aria-label="QuantumEdge live opportunities">
        <header className="qe-opp-header">
          <div className="qe-opp-header-title">
            <span className="qe-opp-header-icon"><Zap aria-hidden="true" /></span>
            <div>
              <h3>LIVE OPPORTUNITIES <span>(AUTO)</span></h3>
              <p>Market-scanned setups <b>•</b> Multi-factor engine</p>
            </div>
          </div>
          <svg className="qe-opp-header-spark" viewBox="0 0 320 92" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="qeOppSparkFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#62de70" stopOpacity=".34" />
                <stop offset="1" stopColor="#62de70" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M0 72 C48 68 58 64 94 63 C132 62 146 48 184 52 C220 56 248 32 282 24 C300 20 312 12 320 8 L320 92 L0 92 Z"
              fill="url(#qeOppSparkFill)" />
            <path d="M0 72 C48 68 58 64 94 63 C132 62 146 48 184 52 C220 56 248 32 282 24 C300 20 312 12 320 8"
              fill="none" stroke="#72c98a" strokeWidth="2" />
          </svg>
          <span className="qe-opp-live"><i /> LIVE</span>
        </header>
        <table className="qe-opp-table" role="table" aria-label="Index opportunities">
          <thead role="rowgroup"><tr role="row">{[
            { label: 'Index', Icon: BarChart3 }, { label: 'Signal', Icon: Crosshair },
            { label: 'Premium', Icon: Coins }, { label: 'Confidence', Icon: BarChart3 },
            { label: 'Status', Icon: Activity },
          ].map(({ label, Icon }) =>
            <th key={label} role="columnheader" scope="col"><span><Icon aria-hidden="true" />{label}</span></th>)}</tr></thead>
          <tbody role="rowgroup">{opportunities.map(item => {
            return <tr key={item.symbol} role="row">
            <th scope="row" role="rowheader">
              <span className="qe-opp-symbol">{displayName(item.symbol)}</span>
              {item.status === 'WAIT_MASTER' && <small className="qe-opp-index-slash">•</small>}
            </th>
            <td role="cell"><span className="qe-opp-mobile-label" aria-hidden="true">Signal</span><span className={item.side === 'PE' ? 'qe-side-pe' : item.side === 'CE' ? 'qe-side-ce' : 'qe-side-wait'}>{item.side ?? '—'}</span></td>
            <td role="cell"><span className="qe-opp-mobile-label" aria-hidden="true">Premium</span><span className="qe-opp-premium" title={money(item.premium)}>{money(item.premium)}</span></td>
            <td role="cell" className="qe-confidence-cell"><span className="qe-opp-mobile-label" aria-hidden="true">Confidence</span><span>{item.confidence == null ? '—' : `${number(item.confidence, 0)}%`}</span><i aria-hidden="true"><b style={{ width: `${item.confidence ?? 0}%` }} /></i></td>
            <td role="cell" className="qe-opp-status"><div className="qe-opp-badge"><em title={item.reason}
              className={['LIVE', 'LIVE_POSITION'].includes(item.status)
                ? 'qe-state-live' : ['REJECTED', 'AI_UNAVAILABLE', 'ML_BLOCKED', 'ENTRY_BLOCKED'].includes(item.status) ? 'qe-state-reject' : 'qe-state-wait'}>{opportunityLabels[item.status] ?? item.status.replaceAll('_', ' ')}</em></div>
              <div className="qe-opp-details" tabIndex={0} role="region" aria-label={`${displayName(item.symbol)} status details`}>
              {!stale && item.signal?.strategy_name && (
                <small className="qe-wait-reason qe-wait-reason-primary">{item.signal.strategy_name}</small>
              )}
              {!stale && item.signal?.price_action && (
                <small className="qe-wait-reason"><span aria-hidden="true">ⓘ</span> {priceActionLabel(item.signal.price_action)}</small>
              )}
              {item.signal?.readiness && (
                <small className="qe-wait-reason">{readinessLabel(item.signal.readiness)}</small>
              )}
              {['WAIT_SIGNAL', 'REJECTED', 'AI_UNAVAILABLE', 'ML_BLOCKED', 'ENTRY_BLOCKED'].includes(item.status) && (
                <small className="qe-wait-reason">{item.reason}</small>
              )}
              </div>
            </td>
          </tr>;
          })}</tbody>
        </table>
      </section>
    </div>

    <section className="qe-positions" aria-label="QuantumEdge positions">
      <div className="qe-positions-head">
        <div className="qe-positions-title">
          <span className="qe-positions-icon"><Layers3 aria-hidden="true" /></span>
          <div>
            <h3>ALGO POSITIONS <span>(LIVE)</span></h3>
            <p>Up to one position per index · three maximum</p>
          </div>
        </div>
        <dl className="qe-positions-summary" aria-label="QuantumEdge position summary">
          <div className="qe-summary-card qe-summary-realized">
            <dt>Realized P&L</dt>
            <dd className={pnlTone(realizedPnl)}>{money(realizedPnl)}</dd>
          </div>
          <div className="qe-summary-card qe-summary-open">
            <dt>Open P&L</dt>
            <dd className={pnlTone(openPnl)}>{money(openPnl)}</dd>
          </div>
          <div className="qe-summary-card qe-summary-count">
            <dt>Open positions</dt>
            <dd>{number(positions?.length, 0)}</dd>
          </div>
        </dl>
      </div>
      <div className="qe-positions-scroll" role="region" aria-label="Live position table" tabIndex={0}>
        <table className={positions?.length ? 'qe-positions-populated' : undefined}>
          <thead><tr>{['#', 'Index', 'Contract', 'Lots', 'Entry (₹)', 'LTP (₹)', 'SL (₹)', 'Trailing SL (₹)', 'Target (₹)', 'P&L (₹)', 'P&L (%)', 'Status / Exit'].map(label =>
            <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{positionRows}</tbody>
        </table>
      </div>
    </section>

    <footer className="qe-footer">
      <span className="qe-engine-chip"><Sparkles /> Engine <b>{snapshot?.enabled ? 'ON' : 'OFF'}</b></span>
      <span><Layers3 /> Independent parallel signal engines (NIFTY / BANK NIFTY / SENSEX)</span>
      <span><Bot /> AI validation on qualified signals ({snapshot?.ai.model ?? 'model from env'})</span>
      {snapshot?.ai.ml && <span>LightGBM: {snapshot.ai.ml.mode === 'off' ? 'OFF'
        : snapshot.ai.ml.ready ? snapshot.ai.ml.mode.toUpperCase() : 'UNAVAILABLE'}</span>}
      <span><ShieldCheck /> Risk guards, SL, trailing SL, target, position & exposure control</span>
      <span title={snapshot?.market_detail ?? ''}><Sparkles /> {snapshot?.market_detail ?? 'Market session status unavailable'}</span>
    </footer>
    {(error || snapshot?.error || snapshot?.ai.ml?.error || snapshot?.ai.last_error) && <p role="alert" className="qe-error">
      <AlertTriangle /> {error || snapshot?.error || snapshot?.ai.ml?.error || snapshot?.ai.last_error}
    </p>}
  </section>;
}

function activeSymbolLabel(trade: LiveTrade) {
  return trade.contract.trading_symbol.endsWith('PE') ? 'PUT POSITION' : 'CALL POSITION';
}
