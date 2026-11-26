'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, Bot, Check, CheckCircle2, CircleDollarSign, Crosshair, Infinity as InfinityIcon,
  ShieldCheck, Sparkles, Target, TrendingUp, Wifi, Zap,
} from 'lucide-react';
import { API_CONFIG } from '@/lib/api-config';
import { getOrCreateVisitorId } from '@/lib/visitor-id';
import type { MarketData } from '@/hooks/useMarketSocket';
import styles from './LiquidityHunterProSection.module.css';

const SYMBOLS = ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const;
type SymbolName = typeof SYMBOLS[number];
type Trade = {
  id: string; symbol: SymbolName; state: string; entry_price: number; quantity: number;
  filled: number; stop: number; initial_stop?: number; target: number; ltp?: number | null;
  unrealized?: number | null; net_pnl?: number; contract: { trading_symbol: string; lot_size?: number };
  execution_context?: { confidence?: number | null };
};
type Signal = {
  decision?: string; side?: 'CE' | 'PE'; reason?: string; setup_key?: string; status?: string;
  strategy_name?: string; confidence?: number; entry?: {
    maximum?: number; stop?: number; target?: number; quantity?: number; reward_risk?: number;
  };
  risk?: number; contract?: { trading_symbol?: string; lot_size?: number };
  readiness?: {
    spot_fresh?: boolean; futures_fresh?: boolean; completed_minutes?: number;
    completed_minutes_required?: number; qualified_setup_count?: number;
  };
  advisory?: { supporting?: string[] };
};
type Snapshot = {
  generated_at: number; ready: boolean; enabled: boolean; signals: Record<SymbolName, Signal>;
  active: Trade | null; positions: Trade[]; trades: Trade[]; daily_trades: number;
  daily_pnl: number; daily_loss_limit: number; zerodha_connected: boolean;
  zerodha_authenticated: boolean; market_feed_connected: boolean;
  market_phase: string; market_detail?: string; error?: string | null;
  indices: Record<SymbolName, { enabled: boolean; lots: number; risk_per_lot: number }>;
  ai: {
    enabled: boolean; model: string; daily_calls: number; last_error?: string | null;
    last_result: Record<SymbolName, { confidence?: number; reason?: string; state?: string; setup_key?: string }>;
  };
};

const money = (value: number | null | undefined) =>
  value != null && Number.isFinite(value)
    ? value.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
    : '--';
const signedMoney = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '--' : `${value >= 0 ? '+' : ''}₹${money(value)}`;
const points = (value: number | null | undefined) =>
  value != null && Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${money(value)}` : '--';

async function request<T>(path: 'status' | 'approval' | 'limits', body?: object): Promise<T> {
  const response = await fetch(API_CONFIG.endpoint(`/api/quantumedge/${path}`), {
    method: body ? 'POST' : 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': getOrCreateVisitorId(),
      'X-AQTE-Intent': 'manual-live-control',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.detail === 'string' ? payload.detail : 'Liquidity Hunter status unavailable.');
  }
  return payload as T;
}

function StatusPill({ checked, children }: { checked: boolean; children: React.ReactNode }) {
  return <span className={`${styles.statusPill} ${checked ? styles.statusPillOn : ''}`}>
    {checked ? <Check aria-hidden="true" /> : <span className={styles.statusDot} />}{children}
  </span>;
}

export default function LiquidityHunterProSection({ marketData, isConnected }: {
  marketData?: MarketData; isConnected?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingLimit, setSavingLimit] = useState<'risk' | 'daily' | null>(null);
  const [riskInput, setRiskInput] = useState('');
  const [dailyLimitInput, setDailyLimitInput] = useState('');
  const [riskEditing, setRiskEditing] = useState(false);
  const [dailyEditing, setDailyEditing] = useState(false);
  const [limitNotice, setLimitNotice] = useState('');
  const [clock, setClock] = useState(Date.now());
  const [selectedSymbol, setSelectedSymbol] = useState<SymbolName>('NIFTY');

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await request<Snapshot>('status'));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Liquidity Hunter status unavailable.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const poll = window.setInterval(() => void refresh(), 3000);
    const tick = window.setInterval(() => setClock(Date.now()), 1000);
    return () => { window.clearInterval(poll); window.clearInterval(tick); };
  }, [refresh]);

  const activeSymbol = snapshot?.active?.symbol;
  useEffect(() => {
    if (activeSymbol) setSelectedSymbol(activeSymbol);
  }, [activeSymbol]);

  const persistedRiskLimit = snapshot?.indices[selectedSymbol]?.risk_per_lot;
  const persistedDailyLimit = snapshot?.daily_loss_limit;
  useEffect(() => {
    if (!riskEditing) {
      setRiskInput(persistedRiskLimit == null ? '' : String(persistedRiskLimit));
    }
  }, [persistedRiskLimit, riskEditing]);

  useEffect(() => {
    if (!dailyEditing) {
      setDailyLimitInput(persistedDailyLimit == null ? '' : String(persistedDailyLimit));
    }
  }, [dailyEditing, persistedDailyLimit]);

  const toggle = useCallback(async () => {
    if (!snapshot || busy) return;
    setBusy(true);
    setError('');
    try {
      const next = await request<Snapshot>('approval', { enabled: !snapshot.enabled });
      if (next.enabled !== !snapshot.enabled) throw new Error('Live trade state was not confirmed.');
      setSnapshot(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to change LIVE TRADE state.');
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [busy, refresh, snapshot]);

  const saveLimit = useCallback(async (kind: 'risk' | 'daily') => {
    if (!snapshot || savingLimit) return;
    const riskValue = Number(kind === 'risk'
      ? riskInput : snapshot.indices[selectedSymbol]?.risk_per_lot);
    const dailyValue = Number(kind === 'daily' ? dailyLimitInput : snapshot.daily_loss_limit);
    if (![riskValue, dailyValue].every(value =>
      Number.isFinite(value) && value > 0 && value <= 10_000_000)) {
      setLimitNotice('Enter an amount greater than 0 and up to ₹1,00,00,000.');
      return;
    }
    setSavingLimit(kind);
    setLimitNotice('');
    try {
      const next = await request<Snapshot>('limits', {
        symbol: selectedSymbol,
        risk_per_lot: riskValue,
        daily_loss_limit: dailyValue,
      });
      if (kind === 'risk' && next.indices[selectedSymbol]?.risk_per_lot !== riskValue) {
        throw new Error('Risk per trade was not confirmed by the backend.');
      }
      if (kind === 'daily' && next.daily_loss_limit !== dailyValue) {
        throw new Error('Daily loss limit was not confirmed by the backend.');
      }
      setSnapshot(next);
      if (kind === 'risk') {
        setRiskInput(String(next.indices[selectedSymbol].risk_per_lot));
        setRiskEditing(false);
      } else {
        setDailyLimitInput(String(next.daily_loss_limit));
        setDailyEditing(false);
      }
      setLimitNotice('Saved');
    } catch (reason) {
      setLimitNotice(reason instanceof Error ? reason.message : 'Limit was not saved.');
    } finally {
      setSavingLimit(null);
    }
  }, [dailyLimitInput, riskInput, savingLimit, selectedSymbol, snapshot]);

  const selected = useMemo(() => ({
    symbol: selectedSymbol,
    signal: snapshot?.signals[selectedSymbol],
    ai: snapshot?.ai.last_result[selectedSymbol],
  }), [selectedSymbol, snapshot]);

  const active = snapshot?.active ?? null;
  const trade = active?.symbol === selected.symbol ? active : null;
  const signal = selected.signal;
  const selectedTick = marketData?.[selected.symbol];
  const entry = trade?.entry_price ?? signal?.entry?.maximum ?? null;
  const ltp = trade?.ltp ?? null;
  const quantity = trade?.quantity ?? signal?.entry?.quantity ?? 0;
  const profit = trade?.unrealized ?? (entry != null && ltp != null ? (ltp - entry) * quantity : null);
  const profitPoints = entry != null && ltp != null ? ltp - entry : null;
  const profitPercent = entry != null && ltp != null && entry > 0 ? (ltp - entry) / entry * 100 : null;
  const risk = trade && Number.isFinite(entry) && entry != null ? Math.max(0, (entry - trade.stop) * trade.quantity) : signal?.risk ?? null;
  const reward = trade && Number.isFinite(entry) && entry != null ? Math.max(0, (trade.target - entry) * trade.quantity) : null;
  const zerodhaAuthenticated = snapshot
    ? snapshot.zerodha_authenticated ?? snapshot.zerodha_connected
    : false;
  const connected = zerodhaAuthenticated && !!isConnected;
  const aiEnabled = !!snapshot?.enabled;
  const time = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(clock);
  const supporting = signal?.advisory?.supporting ?? [];
  const status = trade?.state ?? (aiEnabled ? signal?.status ?? 'SCANNING' : 'RULES MONITORING');

  return <section aria-label="Liquidity Hunter Pro autonomous trading terminal" className={styles.shell}>
    <header className={styles.header}>
      <div className={styles.brand}>
        <InfinityIcon aria-hidden="true" /><div><h2>Liquidity Hunter Pro</h2><p>AI Algo Trading Engine</p></div>
      </div>
      <nav className={styles.navigation} aria-label="Liquidity Hunter sections">
        <span className={styles.navActive}><Activity />Live Trading</span>
        <span>Strategy</span><span>Risk &amp; Lots</span><span>Logs</span><span>Settings</span>
      </nav>
      <div className={styles.headerMeta}>
        <StatusPill checked={connected}>Zerodha {connected ? 'Connected' : 'Offline'}</StatusPill>
        <StatusPill checked={aiEnabled}><Bot />AI {aiEnabled ? 'Online' : 'Off'}</StatusPill>
        <div className={styles.liveControl}>
          <span>LIVE TRADE</span>
          <button type="button" role="switch" aria-checked={aiEnabled}
            aria-label="Liquidity Hunter live trade" disabled={busy || !snapshot}
            className={`${styles.toggle} ${aiEnabled ? styles.toggleOn : ''}`} onClick={() => void toggle()}>
            <i />
          </button>
          <b>{busy ? '...' : aiEnabled ? 'ON' : 'OFF'}</b>
        </div>
      </div>
    </header>

    {error && <div role="alert" className={styles.error}>{error}</div>}

    <div className={styles.summaryGrid}>
      <section className={styles.engineCard}>
        <h3><Bot />Strategy Engine</h3>
        <StatusPill checked={true}>Advanced SMC</StatusPill>
        <ul>
          {['Order Block (OB)', 'Liquidity Sweep (LS)', 'Liquidity Run (LR)', 'Advanced FVG (A-FVG)'].map(label =>
            <li key={label}><CheckCircle2 />{label}</li>)}
        </ul>
      </section>
      <Metric icon={<TrendingUp />} label="Today's P&L" value={signedMoney(snapshot?.daily_pnl)} note="Realized today" />
      <Metric icon={<CircleDollarSign />} label="Realized P&L" value={signedMoney(snapshot?.daily_pnl)} note={`${snapshot?.daily_trades ?? 0} trades`} />
      <Metric icon={<Activity />} label="Unrealized P&L" value={signedMoney(active?.unrealized)} note={active ? `${active.symbol} live` : 'No open position'} />
      <Metric icon={<Target />} label="Win Rate" value={snapshot?.trades.length ? `${Math.round(snapshot.trades.filter(item => Number(item.net_pnl ?? 0) > 0).length / snapshot.trades.length * 100)}%` : '--'}
        note={snapshot?.trades.length ? `${snapshot.trades.length} session trades` : 'Awaiting completed trades'} />
    </div>

    <div className={styles.workspace}>
      <div className={styles.mainColumn}>
        <article className={styles.tradeCard}>
          <div className={styles.tradeHeader}>
            <div className={styles.signalTitle}>
              <span className={styles.signalBull}>♟</span>
              <div><small><Zap />{trade ? 'LIVE TRADE · EXECUTED' : aiEnabled ? 'SIGNAL STRENGTH' : 'RULES MONITORING'}</small>
                <h3>{selected.symbol} <em>{trade ? `BUY ${signal?.side ?? 'ENTRY'}` : signal?.side ? `BUY ${signal.side} READY` : 'WAITING'}</em></h3>
              </div>
            </div>
            <span className={styles.stateBadge}>{status.replaceAll('_', ' ')}</span>
          </div>

          <div className={styles.executionGrid}>
            <Value label="Entry price" value={entry == null ? '--' : `₹${money(entry)}`} />
            <Value label="Live LTP" value={ltp == null ? '--' : `₹${money(ltp)}`} />
            <Value label="Smart stop loss" value={trade ? `₹${money(trade.stop)}` : '--'} tone="danger" />
            <Value label="Trailing stop" value={trade ? `₹${money(trade.initial_stop ?? trade.stop)}` : '--'} tone="amber" />
            <Value label="Target" value={trade ? `₹${money(trade.target)}` : signal?.entry?.target ? `₹${money(signal.entry.target)}` : '--'} />
          </div>

          <div className={styles.confirmationRow}>
            {['OB Detected', 'Liquidity Sweep', 'A-FVG Confirmed', 'Structure Valid'].map((label, index) =>
              <span key={label} className={supporting[index] || trade ? styles.confirmed : ''}>
                <CheckCircle2 />{label}
              </span>)}
            <span><Sparkles />AI Score: {snapshot?.ai.last_result[selected.symbol]?.confidence ?? '--'}/100</span>
          </div>

          <div className={styles.pnlGrid}>
            <Mini label="Lots" value={trade?.quantity && trade.contract.lot_size
              ? String(Math.round(trade.quantity / trade.contract.lot_size))
              : String(snapshot?.indices[selected.symbol]?.lots ?? '--')} />
            <Mini label="Risk / Trade" value={risk == null ? '--' : `₹${money(risk)}`} />
            <Mini label="Current P&L" value={signedMoney(profit)} positive />
            <Mini label="Profit (Points)" value={points(profitPoints)} positive />
            <Mini label="Profit (%)" value={profitPercent == null ? '--' : `${profitPercent >= 0 ? '+' : ''}${money(profitPercent)}%`} positive />
            <div className={styles.trailingState}><ShieldCheck /><span>{trade ? 'Trailing protection active' : 'No position to protect'}</span></div>
          </div>
        </article>

        <div className={styles.indexGrid}>
          {SYMBOLS.map(symbol => {
            const tick = marketData?.[symbol];
            const item = snapshot?.signals[symbol];
            const enabled = snapshot?.indices[symbol]?.enabled;
            return <button type="button" key={symbol} className={`${styles.indexCard} ${selected.symbol === symbol ? styles.indexSelected : ''}`}
              onClick={() => setSelectedSymbol(symbol)}>
              <span><Activity /><b>{symbol === 'BANKNIFTY' ? 'BANK NIFTY' : symbol}</b></span>
              <strong>{money(tick?.price)}</strong>
              <small className={(tick?.change ?? 0) >= 0 ? styles.positive : styles.negative}>
                {points(tick?.change)} ({money(tick?.changePercent)}%)
              </small>
              <div><span className={enabled ? styles.enabled : styles.disabled}>{enabled ? 'ENABLED' : 'DISABLED'}</span>
                <em>{item?.status ?? 'WAITING'}</em></div>
            </button>;
          })}
        </div>

        <article className={styles.bookCard}>
          <div><h3><Crosshair />Open Positions ({snapshot?.positions.length ?? 0})</h3>
            <span className={styles.realData}>REAL JOURNAL DATA</span></div>
          <div className={styles.tableWrap}>
            <table><thead><tr><th>Instrument</th><th>Side</th><th>Qty</th><th>Entry</th><th>LTP</th><th>SL</th><th>P&amp;L</th><th>Status</th></tr></thead>
              <tbody>{snapshot?.positions.length ? snapshot.positions.map(position =>
                <tr key={position.id}><td>{position.contract.trading_symbol}</td><td>BUY</td><td>{position.quantity}</td>
                  <td>{money(position.entry_price)}</td><td>{money(position.ltp)}</td><td>{money(position.stop)}</td>
                  <td className={(position.unrealized ?? 0) >= 0 ? styles.positive : styles.negative}>{signedMoney(position.unrealized)}</td>
                  <td><span className={styles.livePosition}>LIVE · PROTECTED</span></td></tr>)
                : <tr><td colSpan={8} className={styles.emptyRow}>No owned open positions. Rules and AI data remain visible.</td></tr>}
              </tbody>
            </table>
          </div>
        </article>
      </div>

      <aside className={styles.sideColumn}>
        <section className={styles.sideCard}>
          <h3><ShieldCheck />Risk &amp; Position Sizing</h3>
          <dl>
            <div className={styles.limitRow}>
              <dt>Risk per trade</dt>
              <dd className={styles.limitControl}>
                <span>₹</span><input aria-label={`${selected.symbol} risk per trade`}
                  inputMode="decimal" value={riskInput}
                  onFocus={() => setRiskEditing(true)} onChange={event => {
                    setRiskInput(event.target.value); setLimitNotice('');
                  }} />
                <button type="button" disabled={!snapshot || savingLimit !== null}
                  onClick={() => void saveLimit('risk')}>
                  {savingLimit === 'risk' ? '...' : 'Save'}
                </button>
              </dd>
            </div>
            <div><dt>Capital at risk</dt><dd>₹{money(risk)}</dd></div>
            <div><dt>Potential reward</dt><dd>₹{money(reward)}</dd></div>
            <div><dt>Lot quantity</dt><dd>{quantity || '--'}</dd></div>
            <div><dt>Underlying LTP</dt><dd>{selectedTick == null ? '--' : money(selectedTick.price)}</dd></div>
            <div className={styles.limitRow}>
              <dt>Daily loss limit</dt>
              <dd className={styles.limitControl}>
                <span>₹</span><input aria-label="Daily loss limit" inputMode="decimal"
                  value={dailyLimitInput}
                  onFocus={() => setDailyEditing(true)} onChange={event => {
                    setDailyLimitInput(event.target.value); setLimitNotice('');
                  }} />
                <button type="button" disabled={!snapshot || savingLimit !== null}
                  onClick={() => void saveLimit('daily')}>
                  {savingLimit === 'daily' ? '...' : 'Save'}
                </button>
              </dd>
            </div>
          </dl>
          {limitNotice && <p role="status" className={styles.limitNotice}>{limitNotice}</p>}
        </section>
        <section className={styles.sideCard}>
          <h3><Wifi />Strategy status</h3>
          <StatusPill checked={connected}>Zerodha market feed</StatusPill>
          <StatusPill checked={!!snapshot?.ready}>Execution journal</StatusPill>
          <StatusPill checked={aiEnabled}>Claude AI review</StatusPill>
          <StatusPill checked={!!signal}>Rule snapshot</StatusPill>
          <p>{signal?.reason ?? snapshot?.error ?? 'Waiting for a qualified completed-candle setup.'}</p>
        </section>
        <section className={styles.sideCard}>
          <h3><Target />Execution control</h3>
          <div className={styles.controlState}><span className={aiEnabled ? styles.liveDot : styles.offDot} />
            <b>{aiEnabled ? 'LIVE TRADE ON' : 'LIVE TRADE OFF'}</b></div>
          <p>Rules and market data continue while OFF. AI calls and new entries start only after this switch is ON.</p>
          <dl><div><dt>Market</dt><dd>{snapshot?.market_phase ?? 'UNKNOWN'}</dd></div>
            <div><dt>AI calls today</dt><dd>{snapshot?.ai.daily_calls ?? '--'}</dd></div>
            <div><dt>Clock</dt><dd>{time} IST</dd></div></dl>
        </section>
      </aside>
    </div>
  </section>;
}

function Metric({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note: string }) {
  return <article className={styles.metric}><span>{icon}</span><div><small>{label}</small><b>{value}</b><em>{note}</em></div></article>;
}

function Value({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'amber' }) {
  return <div className={`${styles.value} ${tone ? styles[tone] : ''}`}><small>{label}</small><b>{value}</b></div>;
}

function Mini({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return <div className={styles.mini}><small>{label}</small><b className={positive ? styles.positive : ''}>{value}</b></div>;
}
