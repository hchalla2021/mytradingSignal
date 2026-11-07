'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertCircle, Bell, Bot, CheckCircle2, Loader2, LockKeyhole, Play, Save, ShieldCheck, TrendingUp, Zap } from 'lucide-react';

type Quote = {
  price?: number | null;
  change?: number | null;
  change_percent?: number | null;
  at?: number | null;
};

type Trade = {
  symbol?: string;
  trading_symbol?: string;
  side?: string;
  state?: string;
  entry_price?: number;
  last_price?: number;
  stop_loss?: number;
  trailing_stop?: number;
  targets?: number[];
  pnl?: number;
};

type EngineStatus = {
  ready?: boolean;
  live_enabled?: boolean;
  armed?: boolean;
  phase?: string;
  block_reasons?: string[];
  feed?: { connected?: boolean; last_tick_at?: number | null; instruments?: string[] };
  indices?: Record<string, Quote>;
  signal?: { decision?: string; confidence?: number | null; reason?: string };
  active_trade?: Trade | null;
  model?: { status?: string; validated?: boolean; name?: string };
  strategy_states?: Record<string, { status?: string; reason?: string }>;
  intelligence?: { gap_percent?: number | null; opening_bias?: string; prediction?: string; regime?: string };
  performance?: { trades?: number; win_rate?: number | null; pnl?: number | null; status?: string };
  pipeline_metrics?: {
    events_received_per_sec?: number | null;
    events_processed_per_sec?: number | null;
    queue_depth?: number | null;
    dropped_events?: number | null;
    p95_processing_ms?: number | null;
    ml_inference_ms?: number | null;
    signal_latency_ms?: number | null;
    order_ack_latency_ms?: number | null;
    slippage?: number | null;
  };
  blocking_reasons?: string[];
  error?: string | null;
};

type RiskConfig = {
  per_trade_loss_cap_inr: number | null;
  daily_loss_limit_inr: number | null;
  max_trades_per_day: number | null;
  max_lots: number;
  min_model_confidence: number;
};

type EngineEvent = {
  at: number;
  type: string;
  severity: string;
  instrument?: string | null;
  message: string;
};

const API_BASE = (process.env.NEXT_PUBLIC_MORNINGEDGE_API_URL ||
  (process.env.NODE_ENV === 'development' ? 'http://localhost:8010' : '')).replace(/\/+$/, '');
const API_ROOT = API_BASE ? `${API_BASE}/api/v1` : '';
const WS_ROOT = API_BASE
  ? API_BASE.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
  : '';

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function adaptStatus(value: Record<string, unknown>): EngineStatus {
  const session = isObject(value.session) ? value.session : {};
  const source = isObject(value.instruments) ? value.instruments : {};
  const indices: Record<string, Quote> = {};
  const now = Date.now() / 1000;
  for (const symbol of ['NIFTY', 'BANKNIFTY', 'SENSEX']) {
    const snapshot = source[symbol];
    if (!isObject(snapshot)) continue;
    const rawAt = snapshot.timestamp;
    const at = typeof rawAt === 'string' ? Date.parse(rawAt) / 1000
      : typeof rawAt === 'number' ? rawAt : null;
    indices[symbol] = {
      price: typeof snapshot.price === 'number' ? snapshot.price : null,
      at: at != null && Number.isFinite(at) ? at : null,
    };
  }
  const blocking = Array.isArray(value.block_reasons)
    ? value.block_reasons.filter((reason): reason is string => typeof reason === 'string') : [];
  const feedLive = ['NIFTY', 'BANKNIFTY', 'SENSEX'].every(symbol => {
    const at = indices[symbol]?.at;
    return typeof at === 'number' && now - at >= -1 && now - at <= 5;
  });
  const modelBlocked = blocking.some(reason => reason.toLowerCase().includes('model'));
  const rawMetrics = isObject(value.metrics) ? value.metrics : {};
  const metric = (key: string) => typeof rawMetrics[key] === 'number' ? rawMetrics[key] as number : null;
  const sessionTime = typeof session.local_time === 'string' ? session.local_time : null;
  const phase = blocking.some(reason => reason.includes('market session'))
    ? 'OUTSIDE SESSION' : sessionTime ? 'SESSION' : 'NOT READY';
  return {
    ready: value.readiness === 'READY',
    live_enabled: value.live_approved === true,
    armed: value.armed === true,
    phase,
    block_reasons: blocking,
    feed: {
      connected: feedLive,
      last_tick_at: Math.max(...Object.values(indices).map(quote => quote.at ?? 0)) || null,
      instruments: Object.keys(indices),
    },
    indices,
    model: { status: modelBlocked ? 'NOT VALIDATED' : 'NOT REPORTED', validated: !modelBlocked },
    pipeline_metrics: {
      queue_depth: metric('queue_depth'),
      dropped_events: metric('rejected_ticks'),
      p95_processing_ms: metric('stage_latency_ms_p95'),
    },
    blocking_reasons: blocking,
  };
}

function adaptConfig(value: Record<string, unknown>): RiskConfig {
  const risk = isObject(value.risk) ? value.risk : {};
  return {
    per_trade_loss_cap_inr: typeof risk.per_trade_loss_cap_inr === 'number' ? risk.per_trade_loss_cap_inr : null,
    daily_loss_limit_inr: typeof risk.daily_loss_cap_inr === 'number' ? risk.daily_loss_cap_inr : null,
    max_trades_per_day: typeof risk.max_trades_per_day === 'number' ? risk.max_trades_per_day : null,
    max_lots: typeof risk.max_lots === 'number' ? risk.max_lots : 1,
    min_model_confidence: typeof risk.min_model_confidence_pct === 'number' ? risk.min_model_confidence_pct : 20,
  };
}

function money(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—';
}

function formatTime(value?: number | null) {
  if (!value || !Number.isFinite(value)) return 'No tick received';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(value * 1000));
}

function getToken() {
  return typeof window === 'undefined' ? '' : sessionStorage.getItem('morningedge_operator_token') || '';
}

export default function MorningEdgeSection() {
  const [token, setToken] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [config, setConfig] = useState<RiskConfig>({
    per_trade_loss_cap_inr: null, daily_loss_limit_inr: null,
    max_trades_per_day: null, max_lots: 1, min_model_confidence: 20,
  });
  const [events, setEvents] = useState<EngineEvent[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => setToken(getToken()), []);

  const request = useCallback(async (path: string, method = 'GET', body?: unknown) => {
    if (!API_ROOT || !token) throw new Error('Set the independent MorningEdge API URL and operator token.');
    const response = await fetch(`${API_ROOT}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      cache: 'no-store',
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = isObject(payload) && typeof payload.detail === 'string' ? payload.detail : `MorningEdge API failed (${response.status})`;
      throw new Error(detail);
    }
    return payload;
  }, [token]);

  const refresh = useCallback(async () => {
    if (!token || !API_ROOT) return;
    try {
      const [rawStatus, rawConfig] = await Promise.all([request('/status'), request('/config')]);
      if (!isObject(rawStatus) || !isObject(rawConfig)) throw new Error('Invalid MorningEdge status response.');
      setStatus(adaptStatus(rawStatus));
      setConfig(adaptConfig(rawConfig));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'MorningEdge status unavailable.');
      setStatus(null);
    }
  }, [request, token]);

  useEffect(() => {
    if (!token || !API_ROOT) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh();
      if (active) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [refresh, token]);

  useEffect(() => {
    if (!token || !WS_ROOT) return;
    let active = true;
    let socket: WebSocket | null = null;
    void request('/events/token', 'POST').then(payload => {
      if (!active || !isObject(payload) || typeof payload.token !== 'string') return;
      socket = new WebSocket(`${WS_ROOT}/api/v1/events?token=${encodeURIComponent(payload.token)}`);
      socketRef.current = socket;
      socket.onmessage = message => {
        try {
          const event: unknown = JSON.parse(message.data);
          if (!isObject(event) || typeof event.message !== 'string') return;
          setEvents(previous => [event as EngineEvent, ...previous].slice(0, 40));
        } catch {
          setError('Received an invalid MorningEdge event.');
        }
      };
      socket.onerror = () => setError('MorningEdge event stream disconnected.');
    }).catch(reason => setError(reason instanceof Error ? reason.message : 'MorningEdge event stream unavailable.'));
    return () => {
      active = false;
      socket?.close();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [request, token]);

  const saveConfig = async () => {
    setBusy(true);
    setSaved(false);
    try {
      const result = await request('/config', 'PUT', {
        per_trade_loss_cap_inr: config.per_trade_loss_cap_inr,
        daily_loss_cap_inr: config.daily_loss_limit_inr,
        max_trades_per_day: config.max_trades_per_day,
        max_lots: config.max_lots,
        min_model_confidence_pct: config.min_model_confidence,
      });
      if (!isObject(result)) throw new Error('Invalid risk configuration response.');
      setConfig(adaptConfig(result));
      setSaved(true);
      setError('');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save MorningEdge risk settings.');
    } finally { setBusy(false); }
  };

  const action = async (path: string, body?: unknown) => {
    setBusy(true);
    try {
      await request(path, 'POST', body);
      await refresh();
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'MorningEdge action failed.');
    } finally { setBusy(false); }
  };

  const indices = useMemo(() => ['NIFTY', 'BANKNIFTY', 'SENSEX'], []);
  const activeTrade = status?.active_trade;
  const signals = status?.signal;
  const readyReasons = status?.blocking_reasons ?? [];
  const configLocked = !!status?.armed || !!status?.live_enabled || status?.phase === 'LIVE';

  return (
    <section className="morningedge-shell" aria-label="MorningEdge AI Algo">
      <header className="morningedge-header">
        <div className="morningedge-brand">
          <span className="morningedge-logo"><TrendingUp size={25} /></span>
          <div><h2>MorningEdge AI Algo</h2><p>Autonomous Morning Trading System <b>MEAI</b></p></div>
        </div>
        <div className="morningedge-header-status">
          <span className={`me-pill ${status?.feed?.connected ? 'is-live' : ''}`}>
            <i />{status?.feed?.connected ? 'Zerodha Connected' : 'Zerodha Offline'}
          </span>
          <span className={`me-pill ${status?.live_enabled ? 'is-live' : ''}`}>
            <i />Algo {status?.live_enabled ? 'Running' : 'OFF'}
          </span>
          <span className="morningedge-phase">{status?.phase ?? 'NOT READY'}</span>
          <Bell size={18} /><Activity size={18} />
        </div>
      </header>

      {!token ? (
        <form className="morningedge-token" onSubmit={event => {
          event.preventDefault();
          const value = tokenInput.trim();
          if (!value) return;
          sessionStorage.setItem('morningedge_operator_token', value);
          setToken(value);
          setTokenInput('');
        }}>
          <LockKeyhole size={17} />
          <span>Connect with the independent MorningEdge operator token.</span>
          <input type="password" autoComplete="off" value={tokenInput} onChange={event => setTokenInput(event.target.value)}
            placeholder="MorningEdge operator token" aria-label="MorningEdge operator token" />
          <button type="submit">Connect</button>
        </form>
      ) : null}
      {!API_ROOT && <p className="morningedge-warning">MorningEdge API URL is not configured. Set NEXT_PUBLIC_MORNINGEDGE_API_URL to the separate service endpoint.</p>}

      <div className="morningedge-market-cards">
        {indices.map((symbol) => {
          const quote = status?.indices?.[symbol];
          return <article className="morningedge-market-card" key={symbol}>
            <div className="me-card-label">{symbol === 'BANKNIFTY' ? 'BANK NIFTY' : symbol === 'NIFTY' ? 'NIFTY 50' : 'SENSEX'}
              <span className={quote?.at && Date.now() / 1000 - quote.at < 5 ? 'fresh' : ''} />
            </div>
            <strong>{money(quote?.price)}</strong>
            <small>{quote?.change != null ? `${quote.change >= 0 ? '▲ +' : '▼ '}${money(quote.change)} pts` : 'Waiting for real ticks'}
              {quote?.change_percent != null ? ` · ${quote.change_percent >= 0 ? '+' : ''}${quote.change_percent.toFixed(2)}%` : ''}
            </small>
          </article>;
        })}
        <article className="morningedge-market-card morningedge-signal-card">
          <div className="me-card-label"><Bot size={17} /> Morning AI Signal</div>
          <strong>{signals?.decision ?? 'WAIT'}</strong>
          <small>{signals?.confidence != null ? `Model confidence ${signals.confidence.toFixed(1)}%` : status?.model?.status ?? 'Validated model unavailable'}</small>
        </article>
      </div>

      <div className="morningedge-main-grid">
        <article className="morningedge-panel morningedge-setup">
          <div className="me-panel-heading"><h3><Zap size={18} /> Morning Trade Setup</h3>
            <span className={status?.ready ? 'me-ready' : 'me-blocked'}>{status?.ready ? 'READY' : 'PREPARATION REQUIRED'}</span>
          </div>
          <p className="morningedge-reason">{signals?.reason ?? readyReasons[0] ?? 'Waiting for fresh pre-open and regular-session data.'}</p>
          <div className="morningedge-levels">
            {[
              ['Entry', activeTrade?.entry_price],
              ['Stop Loss', activeTrade?.stop_loss],
              ['Trailing SL', activeTrade?.trailing_stop],
              ['Last Price', activeTrade?.last_price],
            ].map(([label, value]) => <div className="morningedge-level" key={label as string}>
              <small>{label}</small><b>{money(value)}</b>
            </div>)}
          </div>
          {activeTrade && <div className="morningedge-active-trade">
            <b>{activeTrade.trading_symbol ?? activeTrade.symbol} · {activeTrade.state ?? 'ORDER UPDATE'}</b>
            <span>Actual P&amp;L {money(activeTrade.pnl)} · Targets {activeTrade.targets?.map(money).join(' / ') ?? '—'}</span>
          </div>}
          <div className="morningedge-actions">
            <button type="button" disabled={busy || !token} onClick={() => void action('/preflight')}>
              {busy ? <Loader2 className="me-spin" size={16} /> : <ShieldCheck size={16} />} Readiness Check
            </button>
            <button type="button" disabled={busy || !status?.ready || status.armed} onClick={() => void action('/arm')}>
              <Play size={16} /> Arm Session
            </button>
            <button type="button" className="me-live-button" disabled>
              <Zap size={16} /> Live Execution Unavailable
            </button>
          </div>
          <p className="morningedge-gate-note">
            Analysis begins at 09:00 IST. New live entries are blocked before 09:15 and after 10:30 IST.
            No order is placed until all independent feed, model, preflight, session and risk gates pass.
          </p>
        </article>

        <article className="morningedge-panel morningedge-rules">
          <div className="me-panel-heading"><h3>Morning Intelligence</h3><span>{status?.model?.validated ? 'MODEL VALIDATED' : 'MODEL NOT VALIDATED'}</span></div>
          <div className="morningedge-intel">
            {[
              ['Opening Bias', status?.intelligence?.opening_bias],
              ['Model Prediction', status?.intelligence?.prediction],
              ['Market Regime', status?.intelligence?.regime],
              ['Gap', status?.intelligence?.gap_percent != null ? `${status.intelligence.gap_percent.toFixed(2)}%` : null],
            ].map(([name, value]) => <div key={name as string}><small>{name}</small><b>{value ?? 'Unavailable'}</b></div>)}
          </div>
          <h4>Strategy Workers</h4>
          <ul className="morningedge-worker-list">
            {['Gap and Go', 'Gap Reversal', 'Opening Range Breakout', 'VWAP Breakout', 'VWAP Reversal',
              'EMA Momentum', 'Futures Momentum', 'Options Momentum', 'False Breakout Detection']
              .map(worker => {
                const state = status?.strategy_states?.[worker];
                return <li key={worker}><span />{worker}
                  <small>{state?.status ?? 'Not reported'}{state?.reason ? ` · ${state.reason}` : ''}</small>
                </li>;
              })}
          </ul>
        </article>
      </div>

      <div className="morningedge-bottom-grid">
        <article className="morningedge-panel">
          <div className="me-panel-heading"><h3>Live Risk Controls</h3><span>Saved before session</span></div>
          <div className="morningedge-config-grid">
            <label>Per-trade loss cap (INR)<input type="number" min="1" disabled={configLocked} value={config.per_trade_loss_cap_inr ?? ''}
              onChange={event => setConfig({ ...config, per_trade_loss_cap_inr: event.target.value ? Number(event.target.value) : null })} /></label>
            <label>Daily loss limit (INR)<input type="number" min="1" disabled={configLocked} value={config.daily_loss_limit_inr ?? ''}
              onChange={event => setConfig({ ...config, daily_loss_limit_inr: event.target.value ? Number(event.target.value) : null })} /></label>
            <label>Maximum trades/day<input type="number" min="1" disabled={configLocked} value={config.max_trades_per_day ?? ''}
              onChange={event => setConfig({ ...config, max_trades_per_day: event.target.value ? Number(event.target.value) : null })} /></label>
            <label>Maximum lots<select disabled={configLocked} value={config.max_lots} onChange={event => setConfig({ ...config, max_lots: Number(event.target.value) })}>
              {[1, 2, 3, 4, 5].map(lots => <option value={lots} key={lots}>{lots} lot{lots > 1 ? 's' : ''}</option>)}
            </select></label>
            <label>Minimum model confidence<select disabled={configLocked} value={config.min_model_confidence}
              onChange={event => setConfig({ ...config, min_model_confidence: Number(event.target.value) })}>
              {[20, 25, 30, 40, 50, 60, 70].map(value => <option value={value} key={value}>{value}%</option>)}
            </select></label>
            <button type="button" disabled={busy || !token || configLocked} onClick={() => void saveConfig()}>
              <Save size={16} /> {saved ? 'Saved' : 'Save Risk Settings'}
            </button>
          </div>
          <p className="morningedge-gate-note">Initial lot cap is 1. Increasing it requires saving a new cap before the next session. Loss limits are mandatory before arming.</p>
        </article>
        <article className="morningedge-panel morningedge-performance">
          <div className="me-panel-heading"><h3>Session Performance</h3><span>{status?.performance?.status ?? 'NO SESSION DATA'}</span></div>
          <div className="morningedge-stats">
            <div><small>Trades</small><b>{status?.performance?.trades ?? '—'}</b></div>
            <div><small>Win Rate</small><b>{status?.performance?.win_rate != null ? `${status.performance.win_rate.toFixed(1)}%` : '—'}</b></div>
            <div><small>Realized P&amp;L</small><b>{money(status?.performance?.pnl)}</b></div>
            <div><small>Last Tick</small><b>{formatTime(status?.feed?.last_tick_at)}</b></div>
          </div>
        </article>
      </div>

      <article className="morningedge-panel">
        <div className="me-panel-heading"><h3>Pipeline Performance</h3><span>Measured runtime values only</span></div>
        <div className="morningedge-pipeline-stats">
          {[
            ['Events received/s', status?.pipeline_metrics?.events_received_per_sec],
            ['Events processed/s', status?.pipeline_metrics?.events_processed_per_sec],
            ['Queue depth', status?.pipeline_metrics?.queue_depth],
            ['Dropped events', status?.pipeline_metrics?.dropped_events],
            ['P95 processing', status?.pipeline_metrics?.p95_processing_ms, ' ms'],
            ['ML inference', status?.pipeline_metrics?.ml_inference_ms, ' ms'],
            ['Signal latency', status?.pipeline_metrics?.signal_latency_ms, ' ms'],
            ['Order acknowledgement', status?.pipeline_metrics?.order_ack_latency_ms, ' ms'],
            ['Slippage', status?.pipeline_metrics?.slippage],
          ].map(([label, value, suffix]) => <div key={label as string}><small>{label}</small>
            <b>{typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}${suffix ?? ''}` : '—'}</b>
          </div>)}
        </div>
      </article>

      <article className="morningedge-panel morningedge-events">
        <div className="me-panel-heading"><h3><Activity size={18} /> Live Engine Events</h3><span>{socketRef.current?.readyState === WebSocket.OPEN ? 'STREAM CONNECTED' : 'STREAM OFFLINE'}</span></div>
        {error && <p className="morningedge-warning"><AlertCircle size={16} />{error}</p>}
        <div className="morningedge-event-list">
          {events.length ? events.map((event, index) => <div className="morningedge-event" key={`${event.at}-${event.type}-${index}`}>
            <time>{formatTime(event.at)}</time>
            <span className={`me-event-dot ${event.severity === 'error' ? 'error' : event.severity === 'warning' ? 'warning' : 'success'}`} />
            <b>{event.instrument ?? event.type}</b><span>{event.message}</span>
          </div>) : <div className="morningedge-empty"><CheckCircle2 size={16} /> No engine events received from MorningEdge yet.</div>}
        </div>
      </article>

      {status?.blocking_reasons?.length ? <div className="morningedge-blockers">
        {status.blocking_reasons.map((reason, index) => <p key={`${index}-${reason}`}><AlertCircle size={15} />{reason}</p>)}
      </div> : null}
    </section>
  );
}
