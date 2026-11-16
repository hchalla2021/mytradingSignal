'use client';

import { memo, useCallback, useEffect, useState } from 'react';
import {
  Activity, AlertTriangle, BarChart3, Bell, Bot, Brain, ChevronDown, ChevronUp, Cpu, Lock, Play,
  Power, Settings, ShieldAlert, TrendingDown, TrendingUp, Wifi, WifiOff, Zap,
} from 'lucide-react';
import { API_CONFIG } from '@/lib/api-config';
import { getOrCreateVisitorId } from '@/lib/visitor-id';
import type { MarketData } from '@/hooks/useMarketSocket';

const SYMBOLS = ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const;
type Sym = (typeof SYMBOLS)[number];
type Action = 'BUY_CE' | 'BUY_PE' | 'HOLD' | 'EXIT' | 'WAIT' | 'NO_TRADE';
type Tab = 'live' | 'analysis' | 'alerts' | 'trades' | 'performance' | 'settings';

interface Check { name: string; passed: boolean; detail: string }
interface Plan {
  tradingsymbol: string; entry: number; stop_loss: number; trailing_sl: number; target1: number; target2: number;
  risk_reward: number; risk_rupees: number; lot_size: number; lots: number; expiry: string;
  quote: { iv?: number | null; delta?: number | null; spread_pct?: number | null; trade_age_s?: number | null };
}
interface Signal {
  action: Action; strength: string; conviction: number; score: number; reasoning: string; risks?: string[];
  source: string; plan?: Plan | null; risk?: { approved: boolean; checks: Check[] } | null;
  execution?: { status: string; detail: string }; timestamp: string;
}
interface Trend { trend: string; supertrend: string | null }
interface IndexCycle {
  spot: Spot; signal: Signal; errors: string[];
  analysis: { timeframes: Record<string, Trend | null>; rsi_5m: number | null; atr_5m: number | null;
    regime: string | null; sparkline: number[] };
  quant: { score: number; bias: string; factors: { points: number; factor: string }[]; flags: string[] };
  options: { pcr?: number | null; atm_iv?: number | null; expiry?: string; max_call_oi_strike?: number;
    max_put_oi_strike?: number } | null;
  futures: { vwap?: number | null; order_imbalance?: number | null; volume_ratio?: number | null } | null;
}
interface Spot { price: number | null; change?: number | null; change_pct?: number | null; fresh: boolean; age_s: number | null }
interface Snapshot {
  generated_at: string;
  config: Record<string, string | number | boolean> & { live_execution_allowed?: boolean };
  runtime: { engine_enabled: boolean; auto_paper_trading: boolean; kill_switch: boolean;
    live_execution_allowed: boolean; live_trading_enabled: boolean };
  session: { phase: string; reason: string; market_open: boolean; trading_day: boolean };
  health: { healthy: boolean; ai_state: string; ai_last_error: string | null; last_cycle_at: string | null;
    next_run_at: string | null; cycle_running: boolean; last_error: string | null };
  spots: Record<Sym, Spot>;
  cycle: { at: string; trigger: string; ai_state: string; model: string | null; summary: string;
    market_alert: { tone: string; title: string; detail: string }; indices: Record<Sym, IndexCycle> } | null;
  alerts: { id: number; created_at: string; level: string; symbol: string | null; message: string }[];
  decisions: { id: number; created_at: string; symbol: string; action: Action; strength: string; score: number;
    approved: number; reasoning: string; contract: string | null }[];
  live_trades: LiveTrade[];
  live_performance: { trades: number; pnl: number; wins: number;
    today: { trades: number; realized: number; wins: number; losses: number } };
  ai_usage: { today: Usage; month: Usage; recent?: {
    created_at: string; model: string; status: string; error: string | null;
  }[] };
}
interface LiveTrade {
  id: number; symbol: Sym; exchange: string; tradingsymbol: string; option_type: string; status: string;
  quantity: number; entry: number; entry_price: number | null; stop_loss: number; trailing_sl: number;
  target1: number; target2: number; last_price: number | null; pnl: number | null;
  exit_price: number | null; exit_reason: string | null; created_at: string; opened_at: string | null;
  closed_at: string | null; risk_rupees: number;
}
interface Usage { calls: number; total_tokens: number; cost_usd: number; failures: number }

const ACTION_STYLE: Record<Action, { label: string; text: string; ring: string; bg: string; dot: string }> = {
  BUY_CE: { label: 'BUY CE', text: 'text-emerald-400', ring: 'border-emerald-500/40', bg: 'bg-emerald-500/10', dot: 'bg-emerald-400' },
  BUY_PE: { label: 'BUY PE', text: 'text-rose-400', ring: 'border-rose-500/40', bg: 'bg-rose-500/10', dot: 'bg-rose-400' },
  HOLD: { label: 'HOLD', text: 'text-sky-300', ring: 'border-sky-500/30', bg: 'bg-sky-500/10', dot: 'bg-sky-300' },
  EXIT: { label: 'EXIT', text: 'text-rose-300', ring: 'border-rose-500/40', bg: 'bg-rose-500/10', dot: 'bg-rose-300' },
  WAIT: { label: 'WAIT', text: 'text-amber-300', ring: 'border-amber-500/30', bg: 'bg-amber-500/10', dot: 'bg-amber-300' },
  NO_TRADE: { label: 'NO TRADE', text: 'text-slate-400', ring: 'border-slate-600/40', bg: 'bg-slate-700/20', dot: 'bg-slate-500' },
};

const TABS: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: 'live', label: 'Live Trading', icon: Activity },
  { id: 'analysis', label: 'Analysis', icon: Brain },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'trades', label: 'Trades', icon: BarChart3 },
  { id: 'performance', label: 'Performance', icon: Zap },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const inr = (v: number | null | undefined, digits = 2) =>
  v == null || !Number.isFinite(v) ? '—' : `₹${v.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const num = (v: number | null | undefined, digits = 2) =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const clock = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : '—';

function quoteIsFresh(quoteAt: number, snap: Snapshot | null, current: boolean, elapsedMs: number): boolean {
  const maxAge = snap?.config.max_option_quote_age_seconds;
  if (!snap || !current || !snap.session.market_open || typeof maxAge !== 'number' ||
      !Number.isFinite(maxAge) || maxAge <= 0 || !Number.isFinite(quoteAt)) return false;
  const age = Date.parse(snap.generated_at) + elapsedMs - quoteAt;
  return Number.isFinite(age) && age >= -3000 && age <= maxAge * 1000;
}

async function ownerPost(path: string, body?: unknown) {
  const res = await fetch(API_CONFIG.endpoint(path), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': getOrCreateVisitorId(),
      'X-Autonomiq-Intent': 'operator-control',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(res.status === 401 ? 'Owner sign-in required' : detail.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

function Sparkline({ points, up }: { points: number[]; up: boolean }) {
  if (points.length < 2) return <div className="h-10 w-full rounded bg-slate-800/40" />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points.map((p, i) => `${(i / (points.length - 1)) * 100},${36 - ((p - min) / span) * 32}`).join(' ');
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-10 w-full">
      <polyline points={d} fill="none" strokeWidth="1.6" vectorEffect="non-scaling-stroke"
        className={up ? 'stroke-emerald-400' : 'stroke-rose-400'} />
    </svg>
  );
}

function StatusPill({ icon: Icon, label, value, tone }: { icon: typeof Activity; label: string; value: string; tone: 'good' | 'warn' | 'bad' | 'muted' }) {
  const color = { good: 'text-emerald-400', warn: 'text-amber-300', bad: 'text-rose-400', muted: 'text-slate-400' }[tone];
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl border border-[#3b667b] bg-[#091722] px-3 py-2">
      <Icon className={`h-4 w-4 shrink-0 ${color}`} />
      <div className="min-w-0">
        <div className="break-words text-[12px] uppercase tracking-wide text-slate-400">{label}</div>
        <div className={`break-words text-[14px] font-bold ${color}`}>{value}</div>
      </div>
    </div>
  );
}

function Toggle({ on, onClick, disabled, label }: { on: boolean; onClick?: () => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick}
      className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? 'bg-emerald-500' : 'bg-slate-600'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}

function IndexTile({ sym, spot, live, cycle }: { sym: Sym; spot?: Spot; live?: { price: number; change: number; changePercent: number } | null; cycle?: IndexCycle }) {
  const price = live?.price || spot?.price || null;
  const changePct = live?.changePercent ?? spot?.change_pct ?? null;
  const change = live?.change ?? spot?.change ?? null;
  const up = (changePct ?? 0) >= 0;
  return (
    <div className="rounded-xl border border-[#3b667b] bg-[#091722] p-3 sm:p-4">
      <div className="flex items-center justify-between">
        <span className="text-[14px] font-bold tracking-wider text-slate-300">{sym}</span>
        <span className={`h-2 w-2 rounded-full ${spot?.fresh ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} title={spot?.fresh ? 'Live' : 'Stale'} />
      </div>
      <div className="mt-1 text-[20px] font-bold tabular-nums text-white sm:text-[24px]">{num(price)}</div>
      <div className={`text-[14px] font-semibold tabular-nums ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
        {change != null ? `${up ? '+' : ''}${num(change)}` : '—'} ({changePct != null ? `${up ? '+' : ''}${num(changePct)}%` : '—'})
      </div>
      <div className="mt-2"><Sparkline points={cycle?.analysis.sparkline ?? []} up={up} /></div>
    </div>
  );
}

function SignalCard({ sym, cycle, snap, current, elapsedMs, trade }: {
  sym: Sym; cycle?: IndexCycle; snap: Snapshot | null; current: boolean; elapsedMs: number; trade?: LiveTrade;
}) {
  const [open, setOpen] = useState(false);
  const signal = cycle?.signal;
  const isBuy = signal?.action === 'BUY_CE' || signal?.action === 'BUY_PE';
  const quoteAge = signal?.plan?.quote.trade_age_s;
  const signalAt = signal ? Date.parse(signal.timestamp) : NaN;
  const quoteAt = typeof quoteAge === 'number' && Number.isFinite(quoteAge) ? signalAt - quoteAge * 1000 : NaN;
  const spot = snap?.spots[sym];
  const maxSpotAge = snap?.config.max_data_age_seconds;
  const spotAgeMs = typeof spot?.age_s === 'number' ? spot.age_s * 1000 + elapsedMs : NaN;
  const spotCurrent = !!spot?.fresh && typeof maxSpotAge === 'number' && Number.isFinite(maxSpotAge) &&
    maxSpotAge > 0 && Number.isFinite(spotAgeMs) && spotAgeMs >= -3000 && spotAgeMs <= maxSpotAge * 1000;
  const proposal = isBuy && snap?.session.phase === 'ACTIVE' && snap.config.enabled === true && snap.runtime.engine_enabled &&
    !snap.runtime.kill_switch && spotCurrent && quoteIsFresh(quoteAt, snap, current, elapsedMs)
    ? signal?.plan : null;
  const action: Action = isBuy && !proposal ? 'WAIT' : signal?.action ?? 'NO_TRADE';
  const style = ACTION_STYLE[action];
  const bars = signal?.strength === 'High' ? 3 : signal?.strength === 'Medium' ? 2 : 1;
  const entry = trade?.entry_price ?? trade?.entry ?? proposal?.entry ?? null;
  const stop = trade?.trailing_sl ?? proposal?.stop_loss ?? null;
  const target1 = trade?.target1 ?? proposal?.target1 ?? null;
  const target2 = trade?.target2 ?? proposal?.target2 ?? null;
  const livePrice = trade?.status === 'CLOSED' ? trade.exit_price : trade?.last_price;
  const livePoints = livePrice != null && entry != null ? livePrice - entry : null;
  const livePercent = livePoints != null && entry ? livePoints * 100 / entry : null;
  const trailPoints = trade && entry != null ? trade.trailing_sl - entry : null;
  const trailPercent = trailPoints != null && entry ? trailPoints * 100 / entry : null;
  const failedChecks = signal?.risk?.checks.filter((check) => !check.passed) ?? [];
  const quantThreshold = num(typeof snap?.config.min_signal_score === 'number' ? snap.config.min_signal_score : null, 0);
  const execution = signal?.execution;

  return (
    <div aria-label={`${sym} trade card`} className={`flex min-w-0 flex-col rounded-2xl border ${style.ring} bg-slate-900/70 p-4`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[14px] font-bold tracking-wider text-slate-300">{sym}</div>
          <div className={`mt-1 inline-flex items-center gap-2 rounded-lg ${style.bg} px-2.5 py-1 text-[16px] font-extrabold ${style.text}`}>
            <span className={`h-2 w-2 rounded-full ${style.dot}`} />{style.label}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[12px] uppercase tracking-wide text-slate-400">Signal strength</div>
          <div className="mt-1 flex justify-end gap-0.5">
            {[1, 2, 3].map((i) => (
              <span key={i} className={`h-3 w-1.5 rounded-sm ${i <= bars && signal ? style.dot : 'bg-slate-700'}`} />
            ))}
          </div>
          <div className={`mt-0.5 text-[12px] font-semibold ${style.text}`}>{signal?.strength ?? '—'}</div>
        </div>
      </div>

      <div className="mt-3 min-h-[2.25rem] text-[14px] text-slate-300">
        {trade ? (
          <>
            <div className="font-bold text-emerald-300">AUTONOMIQ LIVE · {trade.status.replace(/_/g, ' ')}</div>
            <div className="break-all font-semibold text-white">{trade.tradingsymbol}</div>
          </>
        ) : proposal ? (
          <>
            <div className={`font-bold ${execution?.status === 'ENTRY_PENDING' ? 'text-emerald-300' : 'text-amber-300'}`}>
              {execution?.status === 'ENTRY_PENDING' ? 'LIVE LIMIT SUBMITTED · FILL NOT CONFIRMED' :
                snap?.runtime.live_execution_allowed && snap.runtime.live_trading_enabled
                  ? `LIVE ENTRY · ${execution?.status ?? 'CHECKING'}`
                  : 'ANALYSIS ONLY · NO LIVE ORDER'}
            </div>
            <div className="break-all font-semibold text-white">{proposal.tradingsymbol}</div>
          </>
        ) : (
          <div>{isBuy ? 'Previous signal expired or unavailable; waiting for fresh data.' :
            cycle ? 'No valid entry right now.' : 'Waiting for the first analysis.'}</div>
        )}
      </div>

      <dl aria-label={`${sym} trade prices`} className="mt-2 grid grid-cols-2 gap-2 text-[14px]">
        {([
          ['Entry (Premium)', inr(entry), 'text-white'],
          ['Stop Loss', inr(trade?.stop_loss ?? stop), 'text-rose-400'],
          ['Trailing SL', inr(trade?.trailing_sl ?? null), 'text-amber-300'],
          ['Target (T1 / T2)', `${inr(target1)} / ${inr(target2)}`, 'text-emerald-400'],
        ] as const).map(([label, value, color]) => (
          <div key={label} className="min-w-0 rounded-lg bg-[#0b1c28] px-2.5 py-2">
            <dt className="text-[12px] uppercase tracking-wide text-slate-300">{label}</dt>
            <dd className={`mt-0.5 break-words font-bold tabular-nums ${color}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[14px]">
        <div className="min-w-0 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2">
          <div className="text-[12px] text-slate-300">Live P&L (pts / %)</div>
          <div className={`mt-0.5 font-bold ${livePoints != null && livePoints >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
            {trade ? `${num(livePoints)} / ${num(livePercent)}% · ${inr(livePoints != null ? livePoints * trade.quantity : null)}` : '—'}
          </div>
        </div>
        <div className="min-w-0 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-2">
          <div className="text-[12px] text-slate-300">Trailing profit / loss (pts / %)</div>
          <div className={`mt-0.5 font-bold ${trailPoints == null ? 'text-slate-400' : trailPoints >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
            {trade ? `${num(trailPoints)} / ${num(trailPercent)}%` : '—'}
          </div>
        </div>
      </div>
      <div className="mt-2 text-[12px] leading-relaxed text-slate-400">
        {trade ? `Broker-reconciled AUTONOMIQ position · estimated net P&L ${inr(trade.pnl)}.` :
          execution?.detail || (proposal ? 'Prices are indicative; no live order has been placed.' :
            'No AUTONOMIQ live position is open.')}
      </div>

      <p className="mt-3 text-[14px] leading-relaxed text-slate-300">{signal?.reasoning ?? '—'}</p>
      {cycle && <div className="mt-2 text-[12px] text-slate-400">
        {`Quant ${num(cycle.quant.score, 0)} · entry needs ≥ +${quantThreshold} CE / ≤ -${quantThreshold} PE and AI agreement.`}
      </div>}
      {failedChecks.length > 0 && <ul aria-label={`${sym} entry blockers`} className="mt-2 space-y-1 break-words text-[12px] text-amber-300">
        {failedChecks.map((check) => <li key={check.name}>{check.name}: {check.detail || 'Not passed'}</li>)}
      </ul>}
      <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-[12px] text-slate-400">
        <span>{clock(signal?.timestamp)} IST</span>
        <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex min-h-[44px] items-center gap-1 text-[14px] font-semibold text-sky-400 hover:text-sky-300">
          View Details {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>
      {open && cycle && (
        <div className="mt-3 space-y-2 border-t border-slate-700/50 pt-3 text-[14px] text-slate-300">
          <div className="grid grid-cols-3 gap-1.5">
            {(['5m', '15m', '60m'] as const).map((tf) => {
              const t = cycle.analysis.timeframes[tf];
              return (
                <div key={tf} className="rounded bg-[#0b1c28] px-2 py-1">
                  <div className="text-slate-400">{tf}</div>
                  <div className={t?.trend === 'UP' ? 'text-emerald-400' : t?.trend === 'DOWN' ? 'text-rose-400' : 'text-slate-300'}>{t?.trend ?? '—'}</div>
                </div>
              );
            })}
          </div>
          <div>Quant score <b className="text-white">{num(cycle.quant.score, 0)}</b> · RSI {num(cycle.analysis.rsi_5m, 1)} · ATR {num(cycle.analysis.atr_5m, 1)} · PCR {num(cycle.options?.pcr ?? null)} · IV {num(cycle.options?.atm_iv ?? null, 1)}%</div>
          {proposal && <div>Δ {num(proposal.quote.delta ?? null)} · spread {num(proposal.quote.spread_pct ?? null)}% · estimated risk {inr(proposal.risk_rupees, 0)} ({proposal.lots}×{proposal.lot_size})</div>}
          {signal?.risks?.map((r) => <div key={r} className="text-amber-300">⚠ {r}</div>)}
          {cycle.errors.length > 0 && <div className="text-slate-400">Data issues: {cycle.errors.join(', ')}</div>}
        </div>
      )}
    </div>
  );
}

function LiveTradeTable({ trades, production }: { trades: LiveTrade[]; production: boolean }) {
  if (!production) {
    return <div className="rounded-xl border border-[#3b667b] bg-[#091722] p-4 text-[14px] text-slate-300">
      Live execution history is available only in the production deployment.
    </div>;
  }
  if (trades.length === 0) {
    return <div className="rounded-xl border border-[#3b667b] bg-[#091722] p-4 text-[14px] text-slate-300">
      No AUTONOMIQ live orders have been recorded.
    </div>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-[#3b667b] bg-[#091722]">
      <table className="w-full min-w-[760px] text-left text-[13px]">
        <thead className="bg-slate-800/60 text-slate-300">
          <tr>{['Time', 'Index / Contract', 'State', 'Qty', 'Entry', 'Stop / Trail', 'Last / Exit', 'Est. P&L'].map((h) =>
            <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {trades.map((trade) => (
            <tr key={trade.id} className="text-slate-200">
              <td className="px-3 py-2">{clock(trade.opened_at ?? trade.created_at)}</td>
              <td className="px-3 py-2">{trade.symbol}<div className="text-slate-400">{trade.tradingsymbol}</div></td>
              <td className="px-3 py-2">{trade.status.replace(/_/g, ' ')}</td>
              <td className="px-3 py-2">{trade.quantity}</td>
              <td className="px-3 py-2">{inr(trade.entry_price ?? trade.entry)}</td>
              <td className="px-3 py-2">{inr(trade.stop_loss)} / {inr(trade.trailing_sl)}</td>
              <td className="px-3 py-2">{inr(trade.last_price ?? trade.exit_price)}</td>
              <td className={`px-3 py-2 font-semibold ${(trade.pnl ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                {inr(trade.pnl)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AutonomiqProSection({ marketData, isConnected = false }: { marketData?: MarketData; isConnected?: boolean }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('live');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [displayNow, setDisplayNow] = useState(() => Date.now());
  const [responseDelay, setResponseDelay] = useState(0);
  const [showAllDecisions, setShowAllDecisions] = useState(false);
  const [showAllAlerts, setShowAllAlerts] = useState(false);

  const load = useCallback(async () => {
    const requestedAt = Date.now();
    try {
      const res = await fetch(API_CONFIG.endpoint('/api/autonomiq-pro/snapshot'), { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status === 503 ? 'AUTONOMIQ PRO engine offline' : `HTTP ${res.status}`);
      setSnap(await res.json());
      const now = Date.now();
      setReceivedAt(now);
      setDisplayNow(now);
      setResponseDelay(now >= requestedAt ? now - requestedAt : Infinity);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unavailable');
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => {
      setDisplayNow(Date.now());
      void load();
    }, 5000);
    return () => clearInterval(id);
  }, [load]);

  const act = async (path: string, body?: unknown, done?: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await ownerPost(path, body);
      if (done) setNotice(done);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const cycle = snap?.cycle;
  const runtime = snap?.runtime;
  const liveAvailable = runtime?.live_execution_allowed === true;
  const liveEnabled = runtime?.live_trading_enabled === true;
  const aiState = snap?.health.ai_state ?? 'OFFLINE';
  const lastAICall = snap?.ai_usage.recent?.[0];
  const alertTone = cycle?.market_alert.tone ?? 'CAUTION';
  const alertStyle = alertTone === 'BULLISH' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
    : alertTone === 'BEARISH' ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
      : 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  const AlertIcon = alertTone === 'BULLISH' ? TrendingUp : alertTone === 'BEARISH' ? TrendingDown : AlertTriangle;
  const alertTitle = cycle?.market_alert.title || 'Awaiting analysis';
  const alertDetail = cycle?.market_alert.detail || 'AUTONOMIQ PRO analyses the market every few minutes during market hours.';

  const sinceReceived = receivedAt == null ? Infinity : displayNow - receivedAt;
  const elapsedMs = sinceReceived + responseDelay;
  const snapshotCurrent = !!snap && !error && snap.health.healthy && receivedAt != null &&
    sinceReceived >= 0 && elapsedMs <= 15000;
  const alerts = (snap?.alerts ?? []).flatMap((alert) => {
    if (!/\bpaper\b/i.test(alert.message)) return [alert];
    if (/^KILL SWITCH engaged/i.test(alert.message)) {
      return [{ ...alert, message: 'KILL SWITCH engaged — entries blocked' }];
    }
    return [];
  });

  return (
    <section aria-label="AUTONOMIQ PRO Autonomous AI Trading System" className="mb-6 overflow-hidden rounded-xl border border-[#184052] bg-[#020a12] text-slate-100 shadow-[0_14px_36px_rgba(0,0,0,.48)]">
      {/* Header */}
      <header className="flex flex-col gap-3 border-b border-[#203847] bg-[#030b12] px-4 py-3 sm:px-5 sm:py-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 text-center xl:pl-14 xl:text-left">
          <h2 className="text-[18px] font-extrabold leading-tight tracking-tight text-white sm:text-[22px] xl:text-[24px]">
            <span className="relative inline-block">
              <span className="absolute right-full top-1/2 mr-2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg border border-emerald-400/50 bg-emerald-400/10 xl:h-12 xl:w-12 xl:rounded-xl">
                <Bot className="h-5 w-5 text-[#28f20b] xl:h-8 xl:w-8" />
              </span>
              AUTONOMIQ PRO
            </span>
          </h2>
          <p className="mt-1 text-[12px] leading-5 text-slate-300 sm:text-[13px]">Autonomous AI Algorithmic Trading System</p>
        </div>
        <div className="flex items-center justify-center gap-1 sm:gap-2 xl:justify-end">
          <span role="status" aria-label={liveAvailable ? `Live trading ${liveEnabled ? 'on' : 'off'}` : 'Live orders production only'}
            title={liveAvailable ? 'Owner-controlled production live execution' : 'Real orders are disabled in local/dev'}
            className={`inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full border px-2 py-2 text-center text-[11px] font-bold leading-4 sm:gap-1.5 sm:px-3 sm:text-[12px] ${liveAvailable ? liveEnabled ? 'border-rose-500/50 bg-rose-500/10 text-rose-300' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'}`}>
            <Lock className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />
            <span className="sm:hidden">{liveAvailable ? liveEnabled ? 'LIVE ON' : 'LIVE OFF' : 'LIVE ORDERS'}</span>
            <span className="hidden sm:inline">{liveAvailable ? liveEnabled ? 'LIVE TRADING ON' : 'LIVE TRADING OFF' : 'LIVE ORDERS'}</span>
          </span>
          <button type="button" aria-label="Refresh now, no AI" disabled={busy || !snap} onClick={() => act('/api/autonomiq-pro/analyze', undefined, 'Quant refresh started — no AI tokens used')}
            title="Re-runs indicator and quant analysis on live data now. This refresh never uses AI tokens; scheduled Claude Fable analysis runs every 5 minutes while within budget."
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full border border-emerald-500 bg-emerald-950/60 px-2 py-2 text-center text-[11px] font-bold leading-5 text-emerald-200 hover:bg-emerald-900/70 disabled:opacity-50 sm:gap-1.5 sm:px-4 sm:text-[14px]">
            <Play className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />
            <span className="sm:hidden">Refresh · no AI</span>
            <span className="hidden sm:inline">Refresh now · no AI</span>
          </button>
        </div>
      </header>

      <section aria-label="AUTONOMIQ market alert"
        title={`${alertTitle} — ${alertDetail}`}
        className={`mx-2 my-2 flex min-w-0 items-center gap-2 rounded-xl border border-l-4 bg-gradient-to-r from-[#0b1720] to-[#07121b] px-2 py-2 shadow-[0_8px_24px_rgba(0,0,0,.24)] sm:mx-5 sm:my-3 sm:gap-3 sm:rounded-2xl sm:px-4 ${alertStyle}`}>
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-current/25 bg-black/20 sm:h-8 sm:w-8">
          <AlertIcon className="h-4 w-4" />
        </div>
        <div className="no-scrollbar flex min-w-0 flex-1 touch-pan-x items-center gap-1.5 overflow-x-auto overscroll-x-contain whitespace-nowrap text-[13px] sm:gap-3 sm:text-[14px]">
          <span className="shrink-0 text-[10px] font-extrabold uppercase tracking-[0.16em] opacity-80 sm:text-[11px]">
            <span className="hidden sm:inline">AUTONOMIQ · MARKET ALERT</span>
            <span className="sm:hidden">ALERT</span>
          </span>
          <span className="shrink-0 rounded-full border border-current/30 bg-black/20 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide sm:px-2">
            {alertTone.replace(/_/g, ' ')}
          </span>
          <span className="shrink-0 font-extrabold tracking-tight sm:text-[14px]">{alertTitle}</span>
          <span aria-hidden="true" className="shrink-0 opacity-50">—</span>
          <span className="pr-1 opacity-90">{alertDetail}</span>
        </div>
      </section>

      {/* Tabs */}
      <nav className="flex gap-1 overflow-x-auto border-b border-[#203847] bg-[#05101a] px-3 sm:px-5" aria-label="AUTONOMIQ PRO tabs">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" onClick={() => setTab(id)}
            className={`flex min-h-[44px] shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[14px] font-semibold transition ${tab === id ? 'border-emerald-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </nav>

      <div className="space-y-4 p-3 sm:p-5">
        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[14px] text-rose-300">
            <WifiOff className="h-4 w-4" /> {error} — other trading sections are unaffected.
          </div>
        )}
        {notice && <div className="rounded-xl border border-slate-600/50 bg-slate-800/60 px-3 py-2 text-[14px] text-slate-200">{notice}</div>}
        {/* Status bar */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <StatusPill icon={isConnected ? Wifi : WifiOff} label="Zerodha" value={isConnected ? 'Connected' : 'Disconnected'} tone={isConnected ? 'good' : 'bad'} />
          <StatusPill icon={Cpu} label="AI Engine" value={aiState.replace(/_/g, ' ')} tone={aiState === 'ACTIVE' ? 'good' : aiState === 'DISABLED' || aiState === 'NOT_CONFIGURED' ? 'muted' : 'warn'} />
          <StatusPill icon={Brain} label="AI Analysis"
            value={runtime?.engine_enabled && aiState === 'ACTIVE' ? 'ON' : runtime?.engine_enabled ? aiState.replace(/_/g, ' ') : 'OFF'}
            tone={runtime?.engine_enabled && aiState === 'ACTIVE' ? 'good' : runtime?.engine_enabled ? 'warn' : 'muted'} />
          <StatusPill icon={Lock} label="Live Trade"
            value={!runtime?.live_execution_allowed ? 'PRODUCTION ONLY' : runtime.live_trading_enabled ? 'ON' : 'OFF'}
            tone={!runtime?.live_execution_allowed ? 'good' : runtime.live_trading_enabled ? 'warn' : 'muted'} />
          <StatusPill icon={ShieldAlert} label="Kill Switch" value={runtime?.kill_switch ? 'ENGAGED' : 'Ready'} tone={runtime?.kill_switch ? 'bad' : 'good'} />
          <StatusPill icon={Activity} label="Session" value={(snap?.session.phase ?? '—').replace(/_/g, ' ')} tone={snap?.session.phase === 'ACTIVE' ? 'good' : 'muted'} />
        </div>

        {tab === 'live' && (
          <>
            <div aria-label="AI execution diagnostics" className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 break-words text-[12px] text-slate-300">
              <span>Last AI request: {lastAICall ? `${clock(lastAICall.created_at)} IST · ${lastAICall.model} · ${lastAICall.status}` : 'No recorded request'}</span>
              <span>Next slot: {clock(snap?.health.next_run_at)} IST</span>
              {(snap?.health.ai_last_error || snap?.health.last_error) && <span className="text-amber-300">
                Analysis error: {snap.health.ai_last_error || snap.health.last_error}
              </span>}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {SYMBOLS.map((s) => (
                <IndexTile key={s} sym={s} spot={snap?.spots[s]} live={marketData?.[s] ?? null} cycle={cycle?.indices[s]} />
              ))}
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              {SYMBOLS.map((s) => (
                <SignalCard key={s} sym={s} cycle={cycle?.indices[s]}
                  snap={snap} current={snapshotCurrent} elapsedMs={elapsedMs}
                  trade={snap?.live_trades?.find((item) => item.symbol === s && !['CLOSED', 'UNFILLED', 'REJECTED'].includes(item.status))} />
              ))}
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:grid-rows-[auto_auto_auto_1fr_auto] lg:gap-y-0">
              <div className="min-w-0 rounded-xl border border-[#3b667b] bg-[#091722] p-4 lg:row-span-5 lg:grid lg:grid-rows-[subgrid]">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-[16px] font-bold text-white"><Brain className="h-4 w-4 text-lime-300" /> AI Market Analysis</h3>
                  <span className="text-[12px] text-slate-400">{cycle ? `${cycle.trigger} · ${clock(cycle.at)}` : '—'}</span>
                </div>
                <div>
                  <p tabIndex={0} aria-label="Market analysis summary, scroll horizontally for full text"
                    className="overflow-x-auto whitespace-nowrap text-[13px] leading-5 text-slate-300">{cycle?.summary || 'No analysis yet.'}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[14px] xl:grid-cols-5">
                    <Meta label="Model" value={cycle?.model ?? 'Quant only'} />
                    <Meta label="Latest AI cycle" value={(cycle?.ai_state ?? '—').replace(/_/g, ' ')} />
                    <Meta label="Next AI slot" value={clock(snap?.health.next_run_at)} />
                    <Meta label="AI cost today" value={`$${num(snap?.ai_usage.today.cost_usd ?? 0, 3)}`} />
                    <Meta label="Live P&L · gross" value="—" tone="text-slate-400" />
                  </div>
                </div>
                <h4 className="mb-1 mt-4 text-[12px] font-bold uppercase tracking-wide text-slate-400">Recent AI decisions</h4>
                <div role="region" aria-label="Recent AI decisions, scroll horizontally for full details" tabIndex={0} className="min-w-0 overflow-x-auto">
                  <ul className="w-max min-w-full divide-y divide-slate-800">
                    {(snap?.decisions ?? []).slice(0, showAllDecisions ? undefined : 5).map((d) => (
                      <ActivityRow key={d.id} at={d.created_at} symbol={d.symbol}
                        action={ACTION_STYLE[d.action]?.label ?? d.action}
                        actionTone={ACTION_STYLE[d.action]?.text ?? 'text-slate-300'} detail={d.reasoning} />
                    ))}
                    {!snap?.decisions.length && <li className="py-2 text-[14px] text-slate-400">No decisions yet.</li>}
                  </ul>
                </div>
                {(snap?.decisions.length ?? 0) > 5 && (
                  <button type="button" aria-label={`${showAllDecisions ? 'Show fewer' : 'View details for'} recent decisions`}
                    aria-expanded={showAllDecisions} onClick={() => setShowAllDecisions(!showAllDecisions)}
                    className="mt-2 min-h-[44px] justify-self-start text-[14px] font-semibold text-emerald-300 hover:text-emerald-200">
                    {showAllDecisions ? 'Show less' : 'View Details'}
                  </button>
                )}
              </div>
              <AlertList alerts={alerts} expanded={showAllAlerts}
                onToggle={() => setShowAllAlerts(!showAllAlerts)} />
            </div>
          </>
        )}

        {tab === 'analysis' && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {SYMBOLS.map((s) => {
              const c = cycle?.indices[s];
              return (
                <div key={s} className="rounded-xl border border-[#3b667b] bg-[#091722] p-4 text-[14px] text-slate-300">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-bold text-white">{s}</span>
                    <span className={c?.quant.score && c.quant.score > 0 ? 'text-emerald-400' : 'text-rose-400'}>Score {num(c?.quant.score ?? null, 0)}</span>
                  </div>
                  <div className="mb-2 grid grid-cols-2 gap-1.5">
                    <Meta label="Regime" value={c?.analysis.regime ?? '—'} />
                    <Meta label="Bias" value={c?.quant.bias ?? '—'} />
                    <Meta label="Fut VWAP" value={num(c?.futures?.vwap ?? null)} />
                    <Meta label="Order imbalance" value={num(c?.futures?.order_imbalance ?? null)} />
                    <Meta label="Max Call OI" value={num(c?.options?.max_call_oi_strike ?? null, 0)} />
                    <Meta label="Max Put OI" value={num(c?.options?.max_put_oi_strike ?? null, 0)} />
                  </div>
                  <ul className="space-y-1">
                    {(c?.quant.factors ?? []).map((f) => (
                      <li key={f.factor} className="flex justify-between gap-2">
                        <span className="min-w-0 break-words">{f.factor}</span>
                        <span className={f.points >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{f.points > 0 ? '+' : ''}{f.points}</span>
                      </li>
                    ))}
                    {(c?.quant.flags ?? []).map((f) => <li key={f} className="text-amber-300">⚠ {f}</li>)}
                  </ul>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'alerts' && <AlertList alerts={alerts} />}

        {tab === 'trades' && (
          <LiveTradeTable trades={snap?.live_trades ?? []} production={liveAvailable} />
        )}

        {tab === 'performance' && snap && (
          <div className="space-y-3">
            {liveAvailable ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Metric label="Closed live trades" value={String(snap.live_performance.trades)} />
                <Metric label="Estimated net realized P&L" value={inr(snap.live_performance.pnl)} />
                <Metric label="Today · realized P&L" value={inr(snap.live_performance.today.realized)} />
              </div>
            ) : (
              <div className="rounded-xl border border-[#3b667b] bg-[#091722] p-4 text-[14px] text-slate-300">
                Real trading performance is available only from the production executor.
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Metric label="AI cost (today)" value={`$${num(snap.ai_usage.today.cost_usd, 3)}`} />
              <Metric label="AI cost (month)" value={`$${num(snap.ai_usage.month.cost_usd, 2)} / $${snap.config.monthly_budget_usd}`} />
              <Metric label="AI calls today" value={`${snap.ai_usage.today.calls} (${snap.ai_usage.today.failures} failed)`} />
            </div>
          </div>
        )}

        {tab === 'settings' && snap && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-[#3b667b] bg-[#091722] p-4">
              <h3 className="text-[16px] font-bold text-white">Controls (owner only)</h3>
              <ControlRow label="Analysis engine" hint="Runs Claude Fable analysis from 09:00–15:20 IST every 5 minutes, subject to AI budget and availability">
                <Toggle label="Engine enabled" on={snap.runtime.engine_enabled} disabled={busy}
                  onClick={() => act('/api/autonomiq-pro/control', { engine_enabled: !snap.runtime.engine_enabled })} />
              </ControlRow>
              <ControlRow label="Live trading" hint={liveAvailable
                ? 'Owner-only production order control; turn ON with one confirmation. OFF immediately blocks new entries while AUTONOMIQ continues managing its own positions.'
                : 'Real orders are hard-disabled in local/dev; production deployment only.'}>
                <Toggle label="Live trading" on={liveEnabled} disabled={busy || !liveAvailable}
                  onClick={() => {
                    if (liveEnabled) {
                      void act('/api/autonomiq-pro/control', { live_trading_enabled: false },
                        'Live entries disabled; open AUTONOMIQ positions remain managed');
                      return;
                    }
                    if (!window.confirm('Enable REAL Zerodha orders for AUTONOMIQ PRO in production?')) return;
                    void act('/api/autonomiq-pro/control', {
                      live_trading_enabled: true, confirm_live: 'ENABLE_AUTONOMIQ_LIVE_TRADING',
                    }, 'Live trading enabled after broker and AI preflight');
                  }} />
              </ControlRow>
              <button type="button" disabled={busy}
                onClick={() => {
                  const engage = !snap.runtime.kill_switch;
                  if (engage && !window.confirm('Engage AUTONOMIQ kill switch? New entries will stop and its owned positions will be exited.')) return;
                  act('/api/autonomiq-pro/control', { kill_switch: engage }, engage ? 'AUTONOMIQ kill switch engaged' : 'Kill switch released');
                }}
                className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[14px] font-bold ${snap.runtime.kill_switch ? 'bg-slate-700 text-white' : 'bg-rose-600 text-white hover:bg-rose-500'} disabled:opacity-50`}>
                <Power className="h-4 w-4" /> {snap.runtime.kill_switch ? 'Release kill switch' : 'KILL SWITCH'}
              </button>
            </div>
            <div className="rounded-xl border border-[#3b667b] bg-[#091722] p-4">
              <h3 className="mb-2 text-[16px] font-bold text-white">Configuration (backend/.env)</h3>
              <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-[14px] sm:grid-cols-2">
                {Object.entries(snap.config).filter(([k]) => !k.includes('paper') && k !== 'live_trading').map(([k, v]) => (
                  <div key={k} className="flex min-w-0 justify-between gap-2 border-b border-slate-800 py-1">
                    <dt className="min-w-0 break-words text-slate-400">{k.replace(/_/g, ' ')}</dt>
                    <dd className="min-w-0 break-words text-right font-semibold text-slate-200">{String(v)}</dd>
                  </div>
                ))}
              </dl>
              {snap.health.ai_last_error && <p className="mt-2 text-[14px] text-amber-300">Last AI error: {snap.health.ai_last_error}</p>}
            </div>
          </div>
        )}

        <p className="text-center text-[12px] text-slate-400">
          Local/dev never places real orders. Production entries require owner authorization, fresh broker quotes,
          AI/quant agreement, and independent risk checks; broker order fills are not guaranteed.
        </p>
      </div>
    </section>
  );
}

function Meta({ label, value, tone = 'text-slate-200' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-[#0b1c28] px-2 py-1.5">
      <div className="break-words text-[12px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`break-words text-[14px] font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function Metric({ label, value, good }: { label: string; value: string; good?: boolean }) {
  const tone = good === undefined ? 'text-white' : good ? 'text-emerald-400' : 'text-rose-400';
  return (
    <div className="rounded-xl border border-[#3b667b] bg-[#091722] p-4">
      <div className="text-[12px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-[18px] font-bold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function ControlRow({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[14px] font-semibold text-slate-200">{label}</div>
        <div className="text-[12px] text-slate-400">{hint}</div>
      </div>
      {children}
    </div>
  );
}

function AlertList({ alerts, expanded = false, onToggle }: {
  alerts: Snapshot['alerts']; expanded?: boolean; onToggle?: () => void;
}) {
  const tone: Record<string, string> = { success: 'text-emerald-400', warning: 'text-amber-300', error: 'text-rose-400', info: 'text-sky-400' };
  return (
    <div className={`min-w-0 rounded-xl border border-[#3b667b] bg-[#091722] p-4 ${onToggle ? 'lg:row-span-5 lg:grid lg:grid-rows-[subgrid]' : ''}`}>
      <h3 className="mb-2 flex items-center gap-2 text-[16px] font-bold text-white"><Bell className="h-4 w-4 text-amber-300" /> Live Alerts</h3>
      {onToggle && <div className="hidden lg:block" aria-hidden="true" />}
      {onToggle && <h4 className="mb-1 mt-4 text-[12px] font-bold uppercase tracking-wide text-slate-400">Recent alerts</h4>}
      <div role="region" aria-label="Recent alerts, scroll horizontally for full details" tabIndex={0} className="min-w-0 overflow-x-auto">
        <ul className="w-max min-w-full divide-y divide-slate-800">
          {(onToggle && !expanded ? alerts.slice(0, 5) : alerts).map((a) => {
            const prefix = a.symbol ? `${a.symbol} – ` : '';
            const signal = prefix && a.message.startsWith(prefix)
              ? /^(BUY CE|BUY PE|WAIT|NO TRADE) \(([^)]*)\): (.*)$/.exec(a.message.slice(prefix.length))
              : null;
            const signalStyle = signal ? Object.values(ACTION_STYLE).find((style) => style.label === signal[1]) : undefined;
            return (
              <ActivityRow key={a.id} at={a.created_at} symbol={a.symbol ?? '—'}
                action={signal ? signal[1] : '—'} actionTone={signalStyle?.text ?? tone[a.level] ?? 'text-slate-400'}
                detail={signal ? `(${signal[2]}) ${signal[3]}` : a.message} />
            );
          })}
          {!alerts.length && <li className="text-[14px] text-slate-400">No alerts yet.</li>}
        </ul>
      </div>
      {onToggle && alerts.length > 5 && (
        <button type="button" aria-label={`${expanded ? 'Show fewer' : 'View details for'} live alerts`}
          aria-expanded={expanded} onClick={onToggle}
          className="mt-2 min-h-[44px] justify-self-start text-[14px] font-semibold text-emerald-300 hover:text-emerald-200">
          {expanded ? 'Show less' : 'View Details'}
        </button>
      )}
    </div>
  );
}

function ActivityRow({ at, symbol, action, actionTone, detail }: {
  at: string; symbol: string; action: string; actionTone: string; detail: string;
}) {
  return (
    <li className="grid grid-cols-[4.25rem_6rem_5.25rem_max-content] items-center gap-x-2 whitespace-nowrap py-2 text-[13px] leading-5">
      <span className="tabular-nums text-slate-400">{clock(at)}</span>
      <span className="font-semibold text-slate-300">{symbol}</span>
      <span className={`font-bold ${actionTone}`}>{action}</span>
      <span className="text-slate-300">{detail}</span>
    </li>
  );
}

export default memo(AutonomiqProSection);
