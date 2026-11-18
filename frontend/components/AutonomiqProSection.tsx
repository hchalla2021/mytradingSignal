'use client';

import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  Activity, AlertTriangle, BarChart3, Bell, Bot, Brain, Building2, CalendarDays,
  ChevronRight, ChevronUp, Clock3, Cpu, Info, Lock, Play, Power, Settings, ShieldAlert, Star,
  Target, TrendingDown, TrendingUp, Wifi, WifiOff, Zap,
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
  quant_action?: Action; ai_action?: Action | null;
  approval_status?: 'PENDING_AI' | 'AI_DECLINED' | 'PENDING_RISK' | 'RISK_BLOCKED' | 'APPROVED' | 'DATA_UNAVAILABLE' | 'POSITION_MANAGEMENT' | 'WAIT';
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
  last_scheduled?: { at: string; ai_state: string;
    signals: Partial<Record<Sym, Pick<Signal, 'action' | 'reasoning' | 'execution' | 'timestamp'>>> } | null;
  alerts: { id: number; created_at: string; level: string; symbol: string | null; message: string }[];
  decisions: { id: number; created_at: string; symbol: string; action: Action; strength: string; score: number;
    approved: number; reasoning: string; contract: string | null; execution?: Signal['execution'] | null }[];
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
  closed_at: string | null; risk_rupees: number; error?: string | null;
  risk_model?: string | null;
  entry_filled?: number; exit_filled?: number; last_quote_at?: string | null; last_broker_sync?: string | null;
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

function quoteIsFresh(quoteAt: number, snap: Snapshot | null, current: boolean, elapsedMs: number,
  maxAgeSeconds = Infinity): boolean {
  const maxAge = snap?.config.max_option_quote_age_seconds;
  if (!snap || !current || !snap.session.market_open || typeof maxAge !== 'number' ||
      !Number.isFinite(maxAge) || maxAge <= 0 || !Number.isFinite(quoteAt)) return false;
  const age = Date.parse(snap.generated_at) + elapsedMs - quoteAt;
  return Number.isFinite(age) && age >= -3000 && age <= Math.min(maxAge, maxAgeSeconds) * 1000;
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
    <div aria-label={`${label} status`} className="autonomiq-status-tile flex min-w-0 items-center gap-2">
      <Icon aria-hidden="true" className={`h-5 w-5 shrink-0 ${color}`} />
      <div className="min-w-0">
        <div className="autonomiq-status-label break-words">{label}</div>
        <div className={`autonomiq-status-value break-words font-bold ${color}`}>{value}</div>
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
    <div aria-label={`${sym} market prices`} className="autonomiq-spot-tile min-w-0">
      <div className="autonomiq-spot-heading">
        <span className="autonomiq-spot-symbol"><Activity aria-hidden="true" /><span>{sym}</span></span>
        <span aria-label={`${sym} ${spot?.fresh ? 'live' : 'stale'} spot feed`}
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${spot?.fresh ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} title={spot?.fresh ? 'Live' : 'Stale'} />
      </div>
      <div className="autonomiq-spot-price font-bold tabular-nums text-white">{num(price)}</div>
      <div className={`autonomiq-spot-change font-semibold tabular-nums ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
        {up ? <TrendingUp aria-hidden="true" className="h-4 w-4 shrink-0" /> : <TrendingDown aria-hidden="true" className="h-4 w-4 shrink-0" />}
        <span>
        {change != null ? `${up ? '+' : ''}${num(change)}` : '—'} ({changePct != null ? `${up ? '+' : ''}${num(changePct)}%` : '—'})
        </span>
      </div>
      <div className="autonomiq-spot-sparkline"><Sparkline points={cycle?.analysis.sparkline ?? []} up={up} /></div>
    </div>
  );
}

function EntryGates({ sym, signal, snap, hasPosition = false }: {
  sym: Sym; signal?: Signal; snap: Snapshot | null; hasPosition?: boolean;
}) {
  const quantBuy = signal?.quant_action === 'BUY_CE' || signal?.quant_action === 'BUY_PE';
  const aiBuy = signal?.ai_action === 'BUY_CE' || signal?.ai_action === 'BUY_PE';
  const aiAgrees = quantBuy && aiBuy && signal?.quant_action === signal?.ai_action;
  const aiDeclined = !!signal?.ai_action && signal.ai_action !== 'NO_TRADE' &&
    (signal.ai_action === 'WAIT' || signal.ai_action === 'HOLD');
  const riskReached = aiAgrees;
  const approvalStatus = signal?.approval_status
    ?? (signal?.ai_action == null && quantBuy ? 'PENDING_AI'
      : signal?.ai_action === 'WAIT' && quantBuy ? 'AI_DECLINED'
        : signal?.risk ? signal.risk.approved ? 'APPROVED' : 'RISK_BLOCKED'
          : undefined);
  const approvalLabel = approvalStatus === 'PENDING_AI' ? 'WAIT · AI REVIEW'
    : approvalStatus === 'AI_DECLINED' ? 'WAIT · AI DECLINED'
      : approvalStatus === 'PENDING_RISK' ? 'WAIT · RISK CHECK'
        : approvalStatus === 'RISK_BLOCKED' ? 'BLOCKED · RISK'
          : approvalStatus === 'APPROVED' ? 'APPROVED'
            : approvalStatus === 'DATA_UNAVAILABLE' ? 'WAIT · DATA'
              : approvalStatus === 'POSITION_MANAGEMENT' ? 'POSITION CONTROL'
                : null;
  const quantLabel = signal?.source === 'validation' ? 'DATA UNAVAILABLE'
    : signal?.quant_action ? `${quantBuy ? 'PASSED · ' : ''}${ACTION_STYLE[signal.quant_action].label}` : 'NOT RECORDED';
  const aiLabel = signal?.ai_action == null
    ? signal?.ai_action === null ? 'NOT REQUESTED' : 'NOT RECORDED'
    : `${ACTION_STYLE[signal.ai_action].label}${aiBuy ? aiAgrees ? ' · AGREES' : ' · DOES NOT AGREE' : ''}`;
  const scheduled = snap?.cycle?.trigger === 'MANUAL' ? snap.last_scheduled : null;
  const prior = scheduled?.signals[sym];

  return <div aria-label={`${sym} entry gates`} className="autonomiq-gates my-3 rounded-lg border border-slate-700/70 bg-black/15 p-2.5 text-[12px]">
    <div className="mb-2 font-semibold text-slate-300">{hasPosition
      ? 'New-entry checks · separate from your open broker position'
      : 'Entry approval · score alone does not submit an order'}</div>
    <dl className="grid grid-cols-2 gap-2">
      {([
        ['Quant', quantLabel, quantBuy && signal?.source !== 'validation'],
        ['AI', aiLabel, aiAgrees],
        ['Risk', signal?.risk ? signal.risk.approved ? 'PASSED' : 'BLOCKED'
          : riskReached ? 'EVALUATING' : 'NOT REACHED', !!signal?.risk?.approved],
        ['Broker', (signal?.execution?.status ?? 'NOT_REQUESTED').replace(/_/g, ' '), false],
      ] as const).map(([label, value, passed]) => <div key={label}>
        <dt className="text-slate-400">{label}</dt>
        <dd className={`break-words font-semibold ${passed ? 'text-emerald-300' : 'text-amber-300'}`}>{value}</dd>
      </div>)}
    </dl>
    {approvalLabel && <p className="mt-2 break-words font-semibold text-amber-200">
      {`Approval state: ${approvalLabel}`}
    </p>}
    {signal?.source !== 'validation' && signal?.ai_action === null && quantBuy && <p className="mt-2 text-amber-200">
      {`No AI adjudication in this 5-minute slot. Next eligible AI: ${clock(snap?.health.next_run_at)} IST. Refresh rechecks only the live quant setup.`}
    </p>}
    {aiDeclined && quantBuy && <p className="mt-2 text-amber-200">
      AI declined this direction. Quant passed, but risk and broker submission are intentionally not reached.
    </p>}
    {prior && <div className="autonomiq-scheduled mt-2 border-t border-slate-700 pt-2 text-slate-300">
      <CalendarDays aria-hidden="true" className="autonomiq-accent-icon" />
      <div className="min-w-0">
        <p className="font-semibold">{`Last scheduled result · ${clock(scheduled?.at)} IST: ${ACTION_STYLE[prior.action].label}${prior.execution && prior.execution.status !== 'NOT_REQUESTED' ? ` · ${prior.execution.status.replace(/_/g, ' ')}` : ''}`}</p>
        <p className="mt-1 break-words">{prior.reasoning}{prior.execution?.detail ? ` · ${prior.execution.detail}` : ''}</p>
        <p className="autonomiq-caption mt-1 text-slate-400">Historical result only; not approval for this refreshed data.</p>
      </div>
    </div>}
  </div>;
}

function SignalCard({ sym, cycle, snap, current, elapsedMs, trade }: {
  sym: Sym; cycle?: IndexCycle; snap: Snapshot | null; current: boolean; elapsedMs: number; trade?: LiveTrade;
}) {
  const [open, setOpen] = useState(false);
  const signal = cycle?.signal;
  const dataUnavailable = signal?.action === 'NO_TRADE' && signal.source === 'validation';
  const strengthAvailable = !!signal && !['validation', 'risk-management'].includes(signal.source);
  const strength = dataUnavailable ? 'Unavailable' : strengthAvailable ? signal?.strength : '—';
  const positionQuantity = trade
    ? Math.max(0, (trade.entry_filled ?? 0) - (trade.exit_filled ?? 0))
    : 0;
  const hasPosition = positionQuantity > 0;
  const isBuy = signal?.action === 'BUY_CE' || signal?.action === 'BUY_PE';
  const execution = signal?.execution;
  const entryBlocked = signal?.risk?.approved === false ||
    (execution != null && ['BLOCKED', 'BROKER_ERROR', 'REJECTED', 'ENTRY_UNKNOWN', 'DUPLICATE'].includes(execution.status));
  const quoteAge = signal?.plan?.quote.trade_age_s;
  const signalAt = signal ? Date.parse(signal.timestamp) : NaN;
  const quoteAt = typeof quoteAge === 'number' && Number.isFinite(quoteAge) ? signalAt - quoteAge * 1000 : NaN;
  const spot = snap?.spots[sym];
  const maxSpotAge = snap?.config.max_data_age_seconds;
  const spotAgeMs = typeof spot?.age_s === 'number' ? spot.age_s * 1000 + elapsedMs : NaN;
  const spotCurrent = !!spot?.fresh && typeof maxSpotAge === 'number' && Number.isFinite(maxSpotAge) &&
    maxSpotAge > 0 && Number.isFinite(spotAgeMs) && spotAgeMs >= -3000 && spotAgeMs <= maxSpotAge * 1000;
  const proposal = isBuy && !entryBlocked && snap?.session.phase === 'ACTIVE' && snap.config.enabled === true && snap.runtime.engine_enabled &&
    !snap.runtime.kill_switch && spotCurrent && quoteIsFresh(quoteAt, snap, current, elapsedMs)
    ? signal?.plan : null;
  const action: Action = trade
    ? trade.status.startsWith('EXIT') ? 'EXIT' : trade.status === 'OPEN' ? 'HOLD' : 'WAIT'
    : isBuy || signal?.action === 'HOLD' || signal?.action === 'EXIT' ? 'WAIT' : signal?.action ?? 'NO_TRADE';
  const style = ACTION_STYLE[action];
  const statusLabel = trade
    ? trade.status === 'OPEN' ? `OPEN ${trade.option_type}` : trade.status.replace(/_/g, ' ')
    : dataUnavailable ? 'DATA UNAVAILABLE'
      : signal?.action === 'WAIT' && signal.ai_action === null &&
        (signal.quant_action === 'BUY_CE' || signal.quant_action === 'BUY_PE')
        ? 'WAIT · AWAITING AI' : style.label;
  const bars = !strengthAvailable ? 0 : signal?.strength === 'High' ? 3 : signal?.strength === 'Medium' ? 2 : 1;
  const entry = hasPosition ? trade?.entry_price ?? null : null;
  const stop = hasPosition && trade ? trade.stop_loss : null;
  const trailing = hasPosition && trade ? trade.trailing_sl : null;
  const target1 = hasPosition && trade ? trade.target1 : null;
  const target2 = hasPosition && trade ? trade.target2 : null;
  const tradeQuoteFresh = !!trade && trade.status !== 'RECONCILIATION_REQUIRED' &&
    quoteIsFresh(Date.parse(trade.last_quote_at ?? ''), snap, current, elapsedMs, 5);
  const livePrice = hasPosition && tradeQuoteFresh ? trade?.last_price : null;
  const livePoints = livePrice != null && entry != null ? livePrice - entry : null;
  const livePercent = livePoints != null && entry ? livePoints * 100 / entry : null;
  const trailPoints = trailing != null && entry != null ? trailing - entry : null;
  const trailPercent = trailPoints != null && entry ? trailPoints * 100 / entry : null;
  const failedChecks = signal?.risk?.checks.filter((check) => !check.passed) ?? [];
  const quantThreshold = num(typeof snap?.config.min_signal_score === 'number' ? snap.config.min_signal_score : null, 0);

  return (
    <div aria-label={`${sym} trade card`} className="autonomiq-card flex min-w-0 flex-col">
      <div className="autonomiq-card-heading">
        <div className="autonomiq-card-identity">
          {sym === 'NIFTY' ? <TrendingUp aria-hidden="true" className="autonomiq-index-icon" />
            : sym === 'BANKNIFTY' ? <BarChart3 aria-hidden="true" className="autonomiq-index-icon" />
              : <Building2 aria-hidden="true" className="autonomiq-index-icon" />}
          <h3>{sym}</h3>
        </div>
        <div className="autonomiq-strength text-right">
          <div className="autonomiq-strength-label">Signal strength</div>
          <div aria-hidden="true" className="autonomiq-strength-bars">
            {[1, 2, 3].map((i) => (
              <span key={i} className={i <= bars && signal ? 'autonomiq-strength-active' : ''} />
            ))}
          </div>
          <div className={`autonomiq-strength-value ${style.text}`}>{strength}</div>
        </div>
      </div>

      <div className="autonomiq-status-row">
        <div role="status" aria-label={`${sym} trade status`} className={`autonomiq-action-badge ${style.bg} ${style.text}`}>
          <span aria-hidden="true" className={`h-3 w-3 shrink-0 rounded-full ${style.dot}`} />{statusLabel}
        </div>
        <div className="autonomiq-status-copy text-[14px] text-slate-300">
          {trade ? (
            <>
              <div className={`font-bold ${trade.status === 'OPEN' ? 'text-emerald-300' : 'text-amber-300'}`}>
                {hasPosition ? 'AUTONOMIQ LIVE' : 'AUTONOMIQ ORDER'} · {trade.status.replace(/_/g, ' ')}
              </div>
              <div className="break-all font-semibold text-white">{trade.tradingsymbol}</div>
              {hasPosition && <div aria-label={`${sym} live broker state`} className="mt-1 text-[12px] text-slate-300">
                {`Last broker state: ${trade.status.replace(/_/g, ' ')}${trade.status === 'OPEN' ? ' · protective stop acknowledged' : ''} · checked ${clock(trade.last_broker_sync)} IST`}
              </div>}
              {!hasPosition && <div>Entry pending or uncertain; protection starts after a confirmed fill.</div>}
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
            <div><span className="font-bold">Status: </span>{isBuy && entryBlocked ? 'ENTRY NOT CONFIRMED · check execution details below.' :
              isBuy ? 'Previous signal expired or unavailable; waiting for fresh data.' :
              dataUnavailable ? 'Analysis data unavailable; entry and stop prices cannot be calculated.' :
              cycle ? 'No valid entry right now.' : 'Waiting for the first analysis.'}</div>
          )}
        </div>
      </div>

      {hasPosition && <div aria-label={`${sym} live option quote`} className="mt-2 text-[14px] font-semibold tabular-nums text-sky-300">
        Live option bid: {inr(livePrice)}
        {tradeQuoteFresh && snap && <span className="ml-2 text-[12px] font-normal text-slate-400">
          {`quote ${num(Math.max(0, (Date.parse(snap.generated_at) + elapsedMs - Date.parse(trade?.last_quote_at ?? '')) / 1000), 1)}s old`}
        </span>}
      </div>}
      <dl aria-label={`${sym} trade prices`} className="autonomiq-price-grid grid grid-cols-2 text-[14px]">
        {([
          ['Entry (Premium)', inr(entry), 'text-white', 'entry'],
          ['Stop Loss', inr(stop), 'text-rose-400', 'stop'],
          ['Trailing SL', inr(trailing), 'text-amber-300', 'trailing'],
          ['Target (T1 / T2)', `${inr(target1)} / ${inr(target2)}`, 'text-emerald-400', 'target'],
        ] as const).map(([label, value, color, level]) => (
          <div key={label} data-level={level} className="autonomiq-price-tile min-w-0">
            <dt className="text-[12px] uppercase tracking-wide text-slate-300">{label}</dt>
            <dd className={`mt-0.5 break-words font-bold tabular-nums ${color}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="autonomiq-pnl-grid grid grid-cols-2 text-[14px]">
        <div className="autonomiq-pnl-tile autonomiq-live-pnl">
          <TrendingUp aria-hidden="true" className="autonomiq-accent-icon" />
          <div className="min-w-0">
            <div className="text-[12px] text-slate-300">Live P&L (pts / %)</div>
            <div className={`autonomiq-pnl-value mt-0.5 break-words font-bold tabular-nums ${livePoints != null && livePoints >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
              {livePoints != null ? `${num(livePoints)} / ${num(livePercent)}% · ${inr(livePoints * positionQuantity)}` : '—'}
            </div>
          </div>
        </div>
        <div className="autonomiq-pnl-tile autonomiq-trailing-pnl">
          <Target aria-hidden="true" className="autonomiq-accent-icon" />
          <div className="min-w-0">
            <div className="text-[12px] text-slate-300"
              title="Indicative P&L at the stop trigger, before charges and slippage. Not guaranteed exit proceeds.">
              Trailing profit / loss (pts / %)
            </div>
            <div className={`autonomiq-pnl-value mt-0.5 break-words font-bold tabular-nums ${trailPoints == null ? 'text-slate-400' : trailPoints >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
              {trailPoints != null ? `${num(trailPoints)} / ${num(trailPercent)}%` : '—'}
            </div>
          </div>
        </div>
      </div>
      <div className="autonomiq-position-note text-[12px] leading-relaxed text-slate-300">
        <Info aria-hidden="true" className="h-4 w-4 shrink-0 text-cyan-300" />
        <span>{trade ? hasPosition ? `Broker-reconciled AUTONOMIQ position · estimated net P&L ${inr(tradeQuoteFresh ? trade.pnl : null)}.`
          : trade.status === 'ENTRY_PENDING' ? 'Broker entry order acknowledged; no filled position confirmed.'
            : 'Local execution intent recorded; no broker order or fill confirmed.' :
          execution?.detail || (proposal ? 'No broker-confirmed fill; live trade prices remain hidden.' :
            'No AUTONOMIQ live position is open.')}</span>
      </div>
      {trade?.error && <p role="status" className="mt-2 break-words text-[12px] text-amber-300">{trade.error}</p>}
      {hasPosition && <p className="mt-2 text-[12px] text-slate-400">
        {trade?.risk_model === 'HYBRID_V1'
          ? 'Fixed fill · candle-structure stop · measured option ATR trail. Stops never loosen; trigger P&L is not guaranteed.'
          : 'Entry is your fixed fill price. Trailing tightens only after profit/ATR rules pass and the broker acknowledges; it never loosens.'}
      </p>}
      {hasPosition && !tradeQuoteFresh && <p role="status" className="mt-2 text-[12px] text-amber-300">
        {trade?.status === 'RECONCILIATION_REQUIRED'
          ? 'Broker quantity needs reconciliation; live valuations are hidden and no broker orders will be changed.'
          : 'Position quote stale or unavailable; live P&L is hidden. Existing broker protection is unchanged.'}
      </p>}

      <EntryGates sym={sym} signal={signal} snap={snap} hasPosition={hasPosition} />
      <p className="autonomiq-reason text-[14px] leading-relaxed text-slate-300">
        <Star aria-hidden="true" className="h-5 w-5 shrink-0 fill-amber-300 text-amber-300" />
        <span>{!hasPosition && signal?.source === 'risk-management'
          ? 'No filled AUTONOMIQ position. Waiting for fresh entry analysis.'
          : signal?.reasoning ?? '—'}</span>
      </p>
      {dataUnavailable && cycle?.errors.length ? <ul aria-label={`${sym} data blockers`} className="mt-2 text-[12px] text-amber-300">
        {cycle.errors.map((error) => <li key={error}>{error}</li>)}
      </ul> : null}
      {cycle && !dataUnavailable && <div className="mt-2 text-[12px] text-slate-400">
        {`Quant ${num(cycle.quant.score, 0)} · entry needs ≥ +${quantThreshold} CE / ≤ -${quantThreshold} PE and AI agreement.`}
      </div>}
      {failedChecks.length > 0 && <ul aria-label={`${sym} entry blockers`} className="mt-2 space-y-1 break-words text-[12px] text-amber-300">
        {failedChecks.map((check) => <li key={check.name}>{check.name}: {check.detail || 'Not passed'}</li>)}
      </ul>}
      <div className="autonomiq-card-footer mt-auto">
        <span className="autonomiq-card-time"><Clock3 aria-hidden="true" className="h-5 w-5 text-cyan-300" />{clock(signal?.timestamp)} IST</span>
        <button type="button" aria-expanded={open} aria-controls={open ? `autonomiq-${sym}-details` : undefined}
          onClick={() => setOpen((v) => !v)} className="autonomiq-details-button">
          View Details {open ? <ChevronUp aria-hidden="true" className="h-4 w-4" /> : <ChevronRight aria-hidden="true" className="h-4 w-4" />}
        </button>
      </div>
      {open && cycle && (
        <div id={`autonomiq-${sym}-details`} className="mt-3 space-y-2 border-t border-slate-700/50 pt-3 text-[14px] text-slate-300">
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
          <ul aria-label={`${sym} quant rule contributions`} className="space-y-1 break-words">
            {cycle.quant.factors.map((factor) => <li key={factor.factor}>
              <span className={factor.points > 0 ? 'text-emerald-300' : factor.points < 0 ? 'text-rose-300' : 'text-slate-400'}>
                {`${factor.points > 0 ? '+' : ''}${num(factor.points, 0)}`}
              </span>{' '}{factor.factor}
            </li>)}
          </ul>
          {cycle.quant.flags.map((flag) => <div key={flag} className="text-amber-300">{flag}</div>)}
          {proposal && <div>Δ {num(proposal.quote.delta ?? null)} · spread {num(proposal.quote.spread_pct ?? null)}% · estimated risk {inr(proposal.risk_rupees, 0)} ({proposal.lots}×{proposal.lot_size})</div>}
          {signal?.risks?.map((r) => <div key={r} className="text-amber-300">⚠ {r}</div>)}
          {cycle.errors.length > 0 && <div className="text-slate-400">Data issues: {cycle.errors.join(', ')}</div>}
        </div>
      )}
    </div>
  );
}

function LiveTradeTable({ trades, liveAvailable, snap }: { trades: LiveTrade[]; liveAvailable: boolean; snap: Snapshot | null }) {
  if (!liveAvailable) {
    return <div className="rounded-xl border border-[#3b667b] bg-[#091722] p-4 text-[14px] text-slate-300">
      Live execution history is unavailable while execution is disabled for this deployment.
    </div>;
  }
  if (trades.length === 0) {
    return <div className="rounded-xl border border-[#3b667b] bg-[#091722] p-4 text-[14px] text-slate-300">
      <p>No AUTONOMIQ live orders have been recorded.</p>
      <p className="mt-2">Automatic entry requires an AI/quant BUY CE or BUY PE plus all risk checks.
        A bullish market alert or Live Trading ON alone does not submit an order.</p>
      <div aria-label="Latest order entry decisions" className="mt-3 space-y-2">
        {SYMBOLS.map((symbol) => {
          const signal = snap?.cycle?.indices[symbol]?.signal;
          const failed = signal?.risk?.checks.filter((check) => !check.passed) ?? [];
          const detail = signal?.execution?.detail ||
            failed.map((check) => `${check.name}: ${check.detail || 'Not passed'}`).join('; ') ||
            signal?.reasoning || 'Waiting for the first analysis.';
          return <div key={symbol} className="rounded-lg border border-slate-700/50 p-2.5">
            <div className="flex flex-wrap gap-x-3 gap-y-1 font-semibold">
              <span>{symbol}</span>
              <span className="text-amber-300">{signal ? ACTION_STYLE[signal.action].label : 'WAITING FOR ANALYSIS'}</span>
              {signal?.execution && <span>{signal.execution.status.replace(/_/g, ' ')}</span>}
              <span className="text-slate-400">{clock(signal?.timestamp)} IST</span>
            </div>
            <p className="mt-1 break-words">{detail}</p>
          </div>;
        })}
      </div>
      {snap?.cycle?.trigger === 'MANUAL' && <p className="mt-3 text-amber-300">
        Manual refresh rechecks quant now. A quant-passed setup can obtain one Claude confirmation in the current unused 5-minute slot; a used slot waits for the next eligible cycle.
      </p>}
      <p className="mt-2 text-slate-400">Next scheduled analysis: {clock(snap?.health.next_run_at)} IST.
        After an entry fill, AUTONOMIQ submits broker-side SL protection and manages trailing updates.</p>
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
              <td className="px-3 py-2">{trade.status.replace(/_/g, ' ')}
                {trade.error && <div className="max-w-sm break-words text-amber-300">{trade.error}</div>}
              </td>
              <td className="px-3 py-2">{trade.quantity}</td>
              <td className="px-3 py-2">{inr(trade.entry_price ?? trade.entry)}</td>
              <td className="px-3 py-2">{inr(trade.stop_loss)} / {inr(trade.trailing_sl)}</td>
              <td className="px-3 py-2">{inr(trade.status === 'CLOSED' ? trade.exit_price : trade.last_price ?? trade.exit_price)}</td>
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
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    const requestedAt = Date.now();
    try {
      const res = await fetch(API_CONFIG.endpoint('/api/autonomiq-pro/snapshot'), {
        cache: 'no-store', signal: controller.signal,
      });
      if (!res.ok) throw new Error(res.status === 503 ? 'AUTONOMIQ PRO engine offline' : `HTTP ${res.status}`);
      const snapshot: Snapshot = await res.json();
      if (request.current !== controller) return;
      setSnap(snapshot);
      const now = Date.now();
      setReceivedAt(now);
      setDisplayNow(now);
      setResponseDelay(now >= requestedAt ? now - requestedAt : Infinity);
      setError(null);
    } catch (e) {
      if (request.current === controller) {
        setError(controller.signal.aborted ? 'Live snapshot request timed out; retrying'
          : e instanceof Error ? e.message : 'Unavailable');
      }
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) request.current = null;
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => {
      setDisplayNow(Date.now());
      void load();
    }, 1000);
    return () => {
      clearInterval(id);
      request.current?.abort();
      request.current = null;
    };
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
  const positions = (snap?.live_trades ?? []).filter((trade) =>
    !['CLOSED', 'UNFILLED', 'REJECTED'].includes(trade.status) &&
    (trade.entry_filled ?? 0) > (trade.exit_filled ?? 0));
  const runtime = snap?.runtime;
  const liveAvailable = runtime?.live_execution_allowed === true;
  const liveEnabled = runtime?.live_trading_enabled === true;
  const deploymentMode = typeof snap?.config.deployment_mode === 'string' ? snap.config.deployment_mode : 'local';
  const localLive = liveAvailable && deploymentMode === 'local';
  const aiState = snap?.health.ai_state ?? 'OFFLINE';
  const analysisAIState = aiState === 'ACTIVE' ? cycle?.ai_state ?? aiState : aiState;
  const analysisOn = !!runtime?.engine_enabled && analysisAIState === 'ACTIVE';
  const lastAICall = snap?.ai_usage.recent?.[0];
  const preOpen = snap?.session.phase === 'PRE_MARKET';
  const alertTone = preOpen ? 'CAUTION' : (cycle?.market_alert.tone ?? 'CAUTION');
  const alertStyle = alertTone === 'BULLISH' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
    : alertTone === 'BEARISH' ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
      : 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  const AlertIcon = alertTone === 'BULLISH' ? TrendingUp : alertTone === 'BEARISH' ? TrendingDown : AlertTriangle;
  const alertTitle = preOpen ? 'Waiting for live market'
    : (cycle?.market_alert.title || 'Awaiting analysis');
  const alertDetail = preOpen ? 'Pre-open data is not trade analysis. Analysis starts at 09:20 IST.'
    : (cycle?.market_alert.detail || 'AUTONOMIQ PRO analyses the market every few minutes during market hours.');

  const sinceReceived = receivedAt == null ? Infinity : displayNow - receivedAt;
  const elapsedMs = sinceReceived + responseDelay;
  const snapshotCurrent = !!snap && !error && snap.health.healthy && receivedAt != null &&
    sinceReceived >= 0 && elapsedMs <= 15000;
  const liveGross = positions.length > 0 ? positions.reduce<number | null>((total, trade) => {
    if (total == null || trade.status === 'RECONCILIATION_REQUIRED' ||
        trade.entry_price == null || trade.entry_price <= 0 || trade.last_price == null ||
        !quoteIsFresh(Date.parse(trade.last_quote_at ?? ''), snap, snapshotCurrent, elapsedMs, 5)) return null;
    return total + (trade.last_price - trade.entry_price) * ((trade.entry_filled ?? 0) - (trade.exit_filled ?? 0));
  }, 0) : null;
  const alerts = (snap?.alerts ?? []).flatMap((alert) => {
    if (!/\bpaper\b/i.test(alert.message)) return [alert];
    if (/^KILL SWITCH engaged/i.test(alert.message)) {
      return [{ ...alert, message: 'KILL SWITCH engaged — entries blocked' }];
    }
    return [];
  });
  const visibleDecisions = (snap?.decisions ?? []).slice(0, showAllDecisions ? undefined : 5);
  const insightsLayout: CSSProperties & { '--autonomiq-history-rows': number } = {
    '--autonomiq-history-rows': Math.max(1, visibleDecisions.length, showAllAlerts ? alerts.length : Math.min(alerts.length, 5)),
  };

  return (
    <section aria-label="AUTONOMIQ PRO Autonomous AI Trading System" className="autonomiq-shell mb-6 overflow-hidden text-slate-100">
      {/* Header */}
      <header className="autonomiq-header">
        <div className="autonomiq-brand">
          <span className="autonomiq-brand-icon"><Bot aria-hidden="true" /></span>
          <div className="min-w-0">
            <h2>AUTONOMIQ PRO</h2>
            <p>Autonomous AI Algorithmic Trading System</p>
          </div>
        </div>
        <div className="autonomiq-header-actions">
          <span role="status" aria-label={liveAvailable ? `Live trading ${liveEnabled ? 'on' : 'off'}` : 'Live orders disabled by configuration'}
            title={liveAvailable ? `Owner-controlled ${deploymentMode} live execution` : 'Local live execution requires AUTONOMIQ_PRO_ALLOW_LOCAL_LIVE=true'}
            className={`autonomiq-live-badge inline-flex items-center justify-center gap-1.5 rounded-full border text-center font-bold ${liveAvailable ? liveEnabled ? 'border-rose-500/50 bg-rose-500/10 text-rose-300' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'}`}>
            <Lock className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />
            <span className="sm:hidden">{liveAvailable ? liveEnabled ? 'LIVE ON' : 'LIVE OFF' : 'LIVE ORDERS'}</span>
            <span className="hidden sm:inline">{liveAvailable ? liveEnabled ? 'LIVE TRADING ON' : 'LIVE TRADING OFF' : 'LIVE ORDERS'}</span>
          </span>
          <button type="button" aria-label="Refresh and AI check" disabled={busy || !snap} onClick={() => act('/api/autonomiq-pro/analyze', undefined, 'Quant refresh started — AI check only if a quant setup passed')}
            title="Re-runs live quant analysis now. If a quant setup passes and this 5-minute slot is unused, Claude Fable adjudicates it once; otherwise the next eligible slot handles it."
            className="autonomiq-refresh-button inline-flex items-center justify-center gap-2 rounded-full border border-emerald-500 text-center font-bold text-emerald-100 disabled:opacity-50">
            <Play className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />
            <span className="sm:hidden">Refresh · AI check</span>
            <span className="hidden sm:inline">Refresh now · AI check</span>
          </button>
        </div>
      </header>

      <section aria-label="AUTONOMIQ market alert"
        title={`${alertTitle} — ${alertDetail}`}
        className={`autonomiq-market-alert flex min-w-0 items-start border border-l-4 ${alertStyle}`}>
        <div className="autonomiq-alert-icon grid shrink-0 place-items-center rounded-xl border border-current/25 bg-black/20">
          <AlertIcon aria-hidden="true" className="h-5 w-5" />
        </div>
        <div className="autonomiq-market-alert-copy">
          <span className="autonomiq-alert-eyebrow font-extrabold uppercase">
            <span className="hidden sm:inline">AUTONOMIQ · MARKET ALERT</span>
            <span className="sm:hidden">ALERT</span>
          </span>
          <span className="autonomiq-alert-tone rounded-full border border-current/30 bg-black/20 font-extrabold uppercase">
            {alertTone.replace(/_/g, ' ')}
          </span>
          <span className="autonomiq-alert-title font-extrabold">{alertTitle}</span>
          <span aria-hidden="true" className="opacity-50">—</span>
          <span className="autonomiq-alert-detail">{alertDetail}</span>
        </div>
      </section>

      {/* Tabs */}
      <nav className="autonomiq-tabs" aria-label="AUTONOMIQ PRO tabs">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}
            className={`flex min-w-0 items-center justify-center border-b-2 font-semibold ${tab === id ? 'border-emerald-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            <Icon aria-hidden="true" className="h-4 w-4 shrink-0" /><span>{label}</span>
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
        <div aria-label="AUTONOMIQ system status" className="autonomiq-status-grid grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <StatusPill icon={isConnected ? Wifi : WifiOff} label="Zerodha" value={isConnected ? 'Connected' : 'Disconnected'} tone={isConnected ? 'good' : 'bad'} />
          <StatusPill icon={Cpu} label="AI Engine" value={aiState.replace(/_/g, ' ')} tone={aiState === 'ACTIVE' ? 'good' : aiState === 'DISABLED' || aiState === 'NOT_CONFIGURED' ? 'muted' : 'warn'} />
          <StatusPill icon={Brain} label="AI Analysis"
            value={analysisOn ? 'ON' : runtime?.engine_enabled ? analysisAIState.replace(/_/g, ' ') : 'OFF'}
            tone={analysisOn ? 'good' : runtime?.engine_enabled ? 'warn' : 'muted'} />
          <StatusPill icon={Lock} label="Live Trade"
            value={!liveAvailable ? 'DISABLED' : liveEnabled ? 'ON' : 'OFF'}
            tone={liveEnabled ? 'warn' : 'muted'} />
          <StatusPill icon={ShieldAlert} label="Kill Switch" value={runtime?.kill_switch ? 'ENGAGED' : 'Ready'} tone={runtime?.kill_switch ? 'bad' : 'good'} />
          <StatusPill icon={Activity} label="Session" value={(snap?.session.phase ?? '—').replace(/_/g, ' ')} tone={snap?.session.phase === 'ACTIVE' ? 'good' : 'muted'} />
        </div>

        {tab === 'live' && (
          <>
            {cycle && cycle.ai_state !== 'ACTIVE' && (
              <div role="status" aria-label="AI analysis blocker"
                className="autonomiq-cycle-blocker min-w-0 break-words border border-amber-500/30 text-[13px] text-amber-200">
                <div className="font-semibold">{`Latest cycle ${clock(cycle.at)} IST: ${cycle.ai_state.replace(/_/g, ' ')} — quant-only results, no new AI confirmation.`}</div>
                {cycle.ai_state.includes('BUDGET') && <div className="mt-1">
                  {`AI spend: $${num(snap?.ai_usage.today.cost_usd, 4)} / $${num(typeof snap?.config.daily_budget_usd === 'number' ? snap.config.daily_budget_usd : null, 2)} daily; $${num(snap?.ai_usage.month.cost_usd, 4)} / $${num(typeof snap?.config.monthly_budget_usd === 'number' ? snap.config.monthly_budget_usd : null, 2)} monthly. Remaining budget must also cover the estimated next request.`}
                </div>}
                {cycle.ai_state === 'OUTPUT_TOKEN_LIMIT' && <div className="mt-1">
                  AI response reached the configured output-token limit; the incomplete decision was rejected.
                </div>}
              </div>
            )}
            <div aria-label="AI execution diagnostics" className="autonomiq-diagnostics flex min-w-0 flex-wrap break-words text-slate-300">
              <span>Last AI request: {lastAICall ? `${clock(lastAICall.created_at)} IST · ${lastAICall.model} · ${lastAICall.status}` : 'No recorded request'}</span>
              <span>Next slot: {clock(snap?.health.next_run_at)} IST</span>
              {(snap?.health.ai_last_error || snap?.health.last_error) && <span className="text-amber-300">
                Analysis error: {snap.health.ai_last_error || snap.health.last_error}
              </span>}
            </div>
            <div className="autonomiq-spot-grid grid min-w-0 grid-cols-1 gap-5 md:grid-cols-3">
              {SYMBOLS.map((s) => (
                <IndexTile key={s} sym={s} spot={snap?.spots[s]} live={marketData?.[s] ?? null} cycle={cycle?.indices[s]} />
              ))}
            </div>
            <div className="autonomiq-signal-grid grid grid-cols-1 gap-5 lg:grid-cols-3">
              {SYMBOLS.map((s) => (
                <SignalCard key={s} sym={s} cycle={cycle?.indices[s]}
                  snap={snap} current={snapshotCurrent} elapsedMs={elapsedMs}
                  trade={snap?.live_trades?.find((item) => item.symbol === s && !['CLOSED', 'UNFILLED', 'REJECTED'].includes(item.status))} />
              ))}
            </div>
            <div className="autonomiq-insights-grid grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-2" style={insightsLayout}>
              <section aria-label="AI Market Analysis" className="autonomiq-panel min-w-0">
                <div className="autonomiq-panel-header">
                  <h3>
                    <span className="autonomiq-panel-icon"><Brain aria-hidden="true" /></span>
                    <span>AI Market Analysis</span>
                  </h3>
                  <span className="autonomiq-analysis-time">
                    <Clock3 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                    {cycle ? `${cycle.trigger} · ${clock(cycle.at)}` : '—'}
                  </span>
                </div>
                <details className="autonomiq-analysis-overview">
                  <summary className="autonomiq-overview-toggle">
                    <span>Analysis overview &amp; AI metrics</span>
                    <ChevronRight aria-hidden="true" className="autonomiq-overview-chevron h-4 w-4" />
                  </summary>
                  <div className="autonomiq-overview-body">
                    <p className="autonomiq-analysis-note">
                      Recorded analysis, not current holdings. Live cards show current broker state; closed trades no longer contribute to live P&amp;L.
                    </p>
                    <p aria-label="Market analysis summary" className="autonomiq-analysis-summary">{cycle?.summary || 'No analysis yet.'}</p>
                    <div className="autonomiq-meta-grid">
                      <Meta label="Model" value={cycle?.model ?? 'Quant only'} />
                      <Meta label="Latest AI cycle" value={(cycle?.ai_state ?? '—').replace(/_/g, ' ')} />
                      <Meta label="Next AI slot" value={clock(snap?.health.next_run_at)} />
                      <Meta label="AI cost today" value={`$${num(snap?.ai_usage.today.cost_usd ?? 0, 3)}`} />
                      <Meta label="Live P&L · gross" value={inr(liveGross)}
                        tone={liveGross == null ? 'text-slate-400' : liveGross >= 0 ? 'text-emerald-300' : 'text-rose-300'} />
                    </div>
                  </div>
                </details>
                <h4 className="autonomiq-list-title">Recent AI decisions</h4>
                <div role="region" aria-label="Recent AI decisions" tabIndex={0} className="autonomiq-activity-region">
                  <ul className="autonomiq-activity-list">
                    {visibleDecisions.map((d) => {
                      const entry = d.action === 'BUY_CE' || d.action === 'BUY_PE';
                      return <ActivityRow key={d.id} at={d.created_at} symbol={d.symbol}
                        action={`${ACTION_STYLE[d.action]?.label ?? d.action}${entry && d.execution ? ` · ${d.execution.status.replace(/_/g, ' ')}` : ''}`}
                        actionTone={entry && d.execution ? 'text-amber-300' : ACTION_STYLE[d.action]?.text ?? 'text-slate-300'}
                        detail={entry && d.execution?.detail ? `${d.reasoning} · ${d.execution.detail}` : d.reasoning} />;
                    })}
                    {!snap?.decisions.length && <li className="autonomiq-empty-state">No decisions yet.</li>}
                  </ul>
                </div>
                <div className="autonomiq-panel-footer">
                  {(snap?.decisions.length ?? 0) > 5 && (
                    <button type="button" aria-label={`${showAllDecisions ? 'Show fewer' : 'View details for'} recent decisions`}
                      aria-expanded={showAllDecisions} onClick={() => setShowAllDecisions(!showAllDecisions)}
                      className="autonomiq-details-button">
                      {showAllDecisions ? 'Show less' : 'View Details'}
                      {showAllDecisions ? <ChevronUp aria-hidden="true" className="h-4 w-4" /> : <ChevronRight aria-hidden="true" className="h-4 w-4" />}
                    </button>
                  )}
                </div>
              </section>
              <AlertList alerts={alerts} expanded={showAllAlerts}
                onToggle={() => setShowAllAlerts(!showAllAlerts)} />
            </div>
          </>
        )}

        {tab === 'analysis' && (
          <>
          <div aria-label="Analysis refresh cadence" className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 break-words text-[13px] text-slate-300">
            <span>Rules refresh every 5 minutes, not on every tick. Point weights are fixed; measurements and rule states are recalculated.</span>
            <span>Green quant scores are not entry approval. AI agreement, risk validation and broker checks are separate gates.</span>
            <span>{`Next cycle: ${clock(snap?.health.next_run_at)} IST`}</span>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {SYMBOLS.map((s) => {
              const c = cycle?.indices[s];
              return (
                <div key={s} aria-label={`${s} analysis rules`} className="min-w-0 rounded-xl border border-[#3b667b] bg-[#091722] p-4 text-[14px] text-slate-300">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-bold text-white">{s}</span>
                    <span className={c?.quant.score && c.quant.score > 0 ? 'text-emerald-400' : 'text-rose-400'}>Score {num(c?.quant.score ?? null, 0)}</span>
                  </div>
                  <EntryGates sym={s} signal={c?.signal} snap={snap} />
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
                  <div className="mt-3 border-t border-slate-700/50 pt-2 text-[12px] text-slate-400">
                    {`Last computed: ${clock(c?.signal.timestamp)} IST`}
                  </div>
                </div>
              );
            })}
          </div>
          </>
        )}

        {tab === 'alerts' && <AlertList alerts={alerts} />}

        {tab === 'trades' && (
          <LiveTradeTable trades={snap?.live_trades ?? []} liveAvailable={liveAvailable} snap={snap} />
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
                Real trading performance is unavailable while execution is disabled for this deployment.
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
              {localLive && <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[13px] text-amber-200">
                Local live execution is configured. This computer can place REAL Zerodha orders after you turn ON.
                Disable production entries first; run only one live executor per account. Your local outbound IP must be permitted by Zerodha.
              </p>}
              <ControlRow label="Analysis engine" hint="Runs Claude Fable analysis from 09:00–15:20 IST every 5 minutes, subject to AI budget and availability">
                <Toggle label="Engine enabled" on={snap.runtime.engine_enabled} disabled={busy}
                  onClick={() => act('/api/autonomiq-pro/control', { engine_enabled: !snap.runtime.engine_enabled })} />
              </ControlRow>
              <ControlRow label="Live trading" hint={liveAvailable
                ? `Owner-only ${deploymentMode} order control; turn ON with one confirmation. OFF immediately blocks new entries while AUTONOMIQ continues managing its own positions.`
                : 'Local live orders require AUTONOMIQ_PRO_ALLOW_LOCAL_LIVE=true in backend/.env. Owner confirmation and broker preflight are still required.'}>
                <Toggle label="Live trading" on={liveEnabled} disabled={busy || !liveAvailable}
                  onClick={() => {
                    if (liveEnabled) {
                      void act('/api/autonomiq-pro/control', { live_trading_enabled: false },
                        'Live entries disabled; open AUTONOMIQ positions remain managed');
                      return;
                    }
                    if (!window.confirm(`Enable REAL Zerodha orders for AUTONOMIQ PRO in ${deploymentMode}? Run only one live executor per account; disable entries on the other deployment first.`)) return;
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
          Real orders require production mode or an explicit local-live opt-in, owner authorization, fresh broker quotes,
          AI/quant agreement, and independent risk checks. Run only one live executor per account; broker fills are not guaranteed.
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
    <section aria-label="Live Alerts" className="autonomiq-panel min-w-0">
      <div className="autonomiq-panel-header">
        <h3><span className="autonomiq-panel-icon"><Bell aria-hidden="true" /></span><span>Live Alerts</span></h3>
      </div>
      {onToggle && <div className="autonomiq-alerts-overview-space" aria-hidden="true" />}
      {onToggle && <h4 className="autonomiq-list-title">Recent alerts</h4>}
      <div role="region" aria-label="Recent alerts" tabIndex={0} className="autonomiq-activity-region">
        <ul className="autonomiq-activity-list">
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
          {!alerts.length && <li className="autonomiq-empty-state">No alerts yet.</li>}
        </ul>
      </div>
      {onToggle && (
        <div className="autonomiq-panel-footer">
          {alerts.length > 5 && (
            <button type="button" aria-label={`${expanded ? 'Show fewer' : 'View details for'} live alerts`}
              aria-expanded={expanded} onClick={onToggle} className="autonomiq-details-button">
              {expanded ? 'Show less' : 'View Details'}
              {expanded ? <ChevronUp aria-hidden="true" className="h-4 w-4" /> : <ChevronRight aria-hidden="true" className="h-4 w-4" />}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function ActivityRow({ at, symbol, action, actionTone, detail }: {
  at: string; symbol: string; action: string; actionTone: string; detail: string;
}) {
  return (
    <li className="autonomiq-activity-row">
      <span className="tabular-nums text-slate-400">{clock(at)}</span>
      <span className="font-semibold text-slate-300">{symbol}</span>
      <span className={`font-bold ${actionTone}`}>{action}</span>
      <span className="autonomiq-activity-detail text-slate-300">{detail}</span>
    </li>
  );
}

export default memo(AutonomiqProSection);
