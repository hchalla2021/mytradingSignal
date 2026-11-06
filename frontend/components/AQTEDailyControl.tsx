'use client';

import { useEffect, useRef, useState } from 'react';
import { API_CONFIG } from '@/lib/api-config';
import { getOrCreateVisitorId } from '@/lib/visitor-id';
import { AQTE_RECONNECT_GRACE_MS, AQTE_SETUP_LABELS, AQTE_SWING_SETUPS, aqteConnectionDrop, aqteErrorText, aqtePollLoop,
  isAqteStyleChecks, type AQTEStyle, type AQTEEntrySource, type AQTEStyleChecks, type AQTEStyleSelection, type AQTESwingSetup } from '@/lib/aqte-display';

const SYMBOLS = ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const;
type SymbolName = typeof SYMBOLS[number];
type Config = {
  enabled: boolean; style?: AQTEStyleSelection; max_trades: number; min_confidence: number; stop_percent: number;
  target_rr: number; trail_start_r: number; daily_loss: number; setups?: Record<AQTESwingSetup, boolean>;
};
const SETUP_HINTS: Record<AQTESwingSetup, string> = {
  momentum_breakout: 'Fresh 20-candle breakout with stacked EMAs and volume ≥ 1.5× · 9 checks',
  trend_continuation: 'Pullback within 1 ATR of EMA20 in a stacked trend, resuming past EMA9 · 10 checks',
  liquidity_reversal: 'Wick through the 20-candle extreme, closed back inside and holding · 6 checks',
  mean_reversion: 'Over 2 ATR from VWAP at an RSI extreme in a range, turning back · 6 checks',
};
const validSetups = (value: unknown) => value === undefined || (!!value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === AQTE_SWING_SETUPS.length &&
  AQTE_SWING_SETUPS.every(setup => typeof (value as Record<string, unknown>)[setup] === 'boolean'));
type Row = {
  config: Config; executed: number; reserved: number; remaining: number;
  status: string; reason: string; direction: string;
  opportunity: { decision: string; confidence: number | null; strategy?: string | null;
    style?: AQTEEntrySource | null; style_checks?: AQTEStyleChecks;
    contract: { trading_symbol: string } | null;
    entry: { maximum: number; stop: number; target: number; points?: number } | null; reasons: string[] };
};
type Snapshot = {
  data: Record<SymbolName, Row>; editable: boolean; limits_editable: boolean; long_only: true;
  account: { max_trades: number; executed: number; reserved: number; remaining: number };
};
const label = (symbol: string) => symbol === 'BANKNIFTY' ? 'BANK NIFTY' : symbol;
const allowsStyle = (selection: AQTEStyleSelection | undefined, style: AQTEStyle) => selection === 'both' || selection === style;
const headers = () => ({
  'Content-Type': 'application/json', 'X-Device-Id': getOrCreateVisitorId(),
  'X-AQTE-Intent': 'manual-live-control',
});
function parse(value: unknown): Snapshot {
  if (!value || typeof value !== 'object' || !('data' in value) || !value.data ||
      !('long_only' in value) || value.long_only !== true || !('account' in value)) {
    throw new Error('Invalid daily-control response');
  }
  const result = value as Snapshot;
  const count = (n: number) => Number.isInteger(n) && n >= 0;
  const valid = SYMBOLS.every(symbol => {
    const row = result.data[symbol];
    const config = row?.config;
    const opportunity = row?.opportunity;
    return config && typeof config.enabled === 'boolean' &&
      (config.style === undefined || ['scalp', 'swing', 'both', 'none'].includes(config.style)) && validSetups(config.setups) &&
      Number.isInteger(config.max_trades) && config.max_trades >= 1 && config.max_trades <= 10 &&
      Number.isInteger(config.min_confidence) && config.min_confidence >= 75 && config.min_confidence <= 80 &&
      (['min_confidence', 'stop_percent', 'target_rr', 'trail_start_r', 'daily_loss'] as const)
        .every(key => typeof config[key] === 'number' && Number.isFinite(config[key])) &&
      count(row.executed) && count(row.reserved) && count(row.remaining) &&
      typeof row.status === 'string' && typeof row.reason === 'string' && typeof row.direction === 'string' &&
      opportunity && typeof opportunity.decision === 'string' &&
      (opportunity.style === undefined || opportunity.style === null || opportunity.style === 'scalp' || opportunity.style === 'swing' || opportunity.style === 'morning') &&
      (opportunity.style_checks === undefined || isAqteStyleChecks(opportunity.style_checks)) &&
      (opportunity.confidence === null || Number.isFinite(opportunity.confidence)) &&
      Array.isArray(opportunity.reasons) && opportunity.reasons.every(reason => typeof reason === 'string') &&
      (opportunity.contract === null || typeof opportunity.contract?.trading_symbol === 'string') &&
      (opportunity.entry === null || (['maximum', 'stop', 'target'] as const).every(key => Number.isFinite(opportunity.entry?.[key])));
  });
  if (!valid || !result.account || !count(result.account.max_trades) ||
      !count(result.account.executed) || !count(result.account.reserved) || !count(result.account.remaining) ||
      typeof result.editable !== 'boolean' || typeof result.limits_editable !== 'boolean') {
    throw new Error('Incomplete daily-control response');
  }
  return result;
}

// Last good snapshot survives tab-switch remounts so the card renders instantly.
let lastSnapshot: Snapshot | null = null;

export default function AQTEDailyControl() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(lastSnapshot);
  const [symbol, setSymbol] = useState<SymbolName>('NIFTY');
  const [drafts, setDrafts] = useState<Partial<Record<SymbolName, Config>>>({});
  const [limits, setLimits] = useState<Partial<Record<SymbolName, number>>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  const saveController = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    let controller: AbortController | null = null;
    let lastOk = 0;
    const poll = async () => {
      const version = generation.current;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 8000);
      try {
        const response = await fetch(API_CONFIG.endpoint('/api/aqte/live/daily-controls'), {
          headers: headers(), credentials: 'include', cache: 'no-store', signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || 'Daily controls unavailable');
        const result = parse(payload);
        lastOk = Date.now();
        if (active && !saving.current && generation.current === version) { lastSnapshot = result; setSnapshot(result); setError(null); }
      } catch (cause) {
        if (aqteConnectionDrop(cause) && Date.now() - lastOk < AQTE_RECONNECT_GRACE_MS) return;
        if (active && !saving.current && generation.current === version) setError(aqteErrorText(cause, 'Daily controls unavailable'));
      } finally {
        clearTimeout(timeout);
      }
    };
    const stopPolling = aqtePollLoop(poll);
    return () => { active = false; mounted.current = false; stopPolling(); controller?.abort(); saveController.current?.abort(); };
  }, []);
  const row = snapshot?.data[symbol];
  const config = drafts[symbol] ?? row?.config;
  const disabled = busy || !snapshot?.editable;
  const change = (patch: Partial<Config>) => {
    if (config) setDrafts({ ...drafts, [symbol]: { ...config, ...patch } });
    setNotice(null);
  };
  const save = async (target: SymbolName, limitOnly: boolean) => {
    const saved = snapshot?.data[target].config;
    if (!saved || saving.current) return;
    const body = limitOnly ? { symbol: target, max_trades: limits[target] ?? saved.max_trades } :
      { symbol: target, config: { ...(drafts[target] ?? saved), max_trades: saved.max_trades } };
    saving.current = true;
    generation.current++;
    setBusy(true);
    setError(null);
    setNotice(null);
    const controller = new AbortController();
    saveController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(API_CONFIG.endpoint(limitOnly ? '/api/aqte/live/daily-limit' : '/api/aqte/live/daily-controls'), {
        method: 'POST', headers: headers(), credentials: 'include', cache: 'no-store',
        signal: controller.signal, body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Daily controls were not saved');
      const result = parse(payload);
      if (!mounted.current) return;
      lastSnapshot = result;
      setSnapshot(result);
      if (limitOnly) setLimits({ ...limits, [target]: undefined });
      else setDrafts({ ...drafts, [target]: undefined });
      setNotice(`${label(target)} ${limitOnly ? 'daily limit' : 'controls'} saved. This does not arm or start trading.`);
    } catch (cause) {
      if (mounted.current) setError(`${cause instanceof Error ? cause.message : 'Save response unavailable'}. Save outcome may be unknown; verify saved values before starting.`);
    } finally {
      clearTimeout(timeout);
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const input = 'mt-1 min-h-[44px] w-full min-w-0 rounded-lg border border-slate-600 bg-slate-950 px-2 text-xs text-slate-100 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300';
  return (
    <section aria-label="Daily Trade Control" className="aqte-daily-control w-full min-w-0 rounded-xl border border-slate-600/70 bg-slate-950/70 p-2 text-xs">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-1 px-1">
        <h3 className="font-semibold text-cyan-100">Daily trade limit</h3>
        <span className="text-[10px] text-slate-400">Account {snapshot?.account.remaining ?? '--'} / {snapshot?.account.max_trades ?? '--'} left</span>
      </div>
      <div className="space-y-1.5">
        {SYMBOLS.map(index => {
          const current = snapshot?.data[index];
          const value = limits[index] ?? current?.config.max_trades;
          const locked = busy || !!error || !snapshot?.limits_editable;
          const adjust = (amount: number) => {
            if (value !== undefined) setLimits({ ...limits, [index]: Math.max(1, Math.min(10, value + amount)) });
            setNotice(null);
          };
          const small = 'flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-slate-600 bg-slate-900 text-slate-100 disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300';
          return <div key={index} className="aqte-daily-row aqte-metric grid min-w-0 grid-cols-[minmax(0,1fr)_44px_24px_44px_44px] items-center gap-1 rounded-lg border bg-slate-900/40 p-1.5">
            <div className="aqte-daily-label min-w-0">
              <p className="text-[11px] font-semibold text-slate-100">{label(index)}</p>
              <p className="text-[9px] leading-relaxed text-slate-400">Done {error ? '--' : current?.executed ?? '--'} · Left {error ? '--' : current?.remaining ?? '--'}</p>
            </div>
            <button type="button" aria-label={`Decrease ${label(index)} daily trades`} className={small} disabled={locked || value === undefined || value <= 1} onClick={() => adjust(-1)}>−</button>
            <output aria-label={`${label(index)} daily trade limit`} className={`text-center text-sm font-bold tabular-nums ${limits[index] !== undefined ? 'text-amber-200' : 'text-slate-100'}`}>{value ?? '--'}</output>
            <button type="button" aria-label={`Increase ${label(index)} daily trades`} className={small} disabled={locked || value === undefined || value >= 10} onClick={() => adjust(1)}>+</button>
            <button type="button" aria-label={`Save ${label(index)} daily limit`} className={`${small} border-cyan-400/40 text-[10px] font-semibold text-cyan-100`} disabled={locked || limits[index] === undefined} onClick={() => void save(index, true)}>Save</button>
          </div>;
        })}
      </div>
      {notice && <p role="status" className="mt-2 px-1 text-[10px] text-emerald-200">{notice}</p>}
      {error && <p role="alert" className="mt-2 break-words px-1 text-rose-300">{error}</p>}
      <details className="mt-2 px-1">
      <summary className="cursor-pointer py-1 text-[10px] text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Status, enable index &amp; risk settings</summary>
      <div className="mt-3 space-y-3">
        <p className="text-slate-400">Maximum, not a target. Zero trades is valid. Only BUY CE / BUY PE entries; SELL is reserved for closing owned positions.</p>
        <p className="text-slate-400">All indices, Quick scalp, Swing and all swing setups are selected automatically by default; no manual checking is required. Optional opt-outs stay saved. Entries still require Auto Trade ON and approval.</p>
        <p className="text-slate-400">Amber counts are unsaved. Limits can be changed while ON; saved values persist until changed. An already-submitted order cannot be undone. Each trade is still one lot.</p>
        <label className="block text-slate-300">Index
          <select aria-label="Daily control index" value={symbol} disabled={busy} className={input}
            onChange={event => { setSymbol(event.target.value as SymbolName); setNotice(null); }}>
            {SYMBOLS.map(s => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </label>
        {row && config && <>
          <div className="grid grid-cols-3 gap-2 text-slate-300">
            {[['Limit', row.config.max_trades], ['Executed', row.executed], ['Remaining', row.remaining]].map(([name, count]) => (
              <p key={name} className="aqte-metric rounded-lg border p-2">{name}<strong className="mt-1 block text-base text-slate-100">{count}</strong></p>
            ))}
          </div>
          <p className="aqte-daily-statusline text-amber-200" title={row.reason}
            aria-label={`Trade status ${row.status}; ${row.reason}`}>
            {error ? 'STATUS UNAVAILABLE' : row.status} · {row.reason || 'No blocking reason reported'}
          </p>
          <p className="aqte-daily-opportunity text-slate-300"
            title={`Direction ${row.direction}; best candidate ${row.opportunity.decision}; strategy ${row.opportunity.strategy ?? 'not selected'}; score ${row.opportunity.confidence ?? 'unavailable'}`}>
            Direction {row.direction} · Best candidate {row.opportunity.decision} · Strategy {row.opportunity.strategy?.replaceAll('_', ' ') ?? 'not selected'} · Rule score {row.opportunity.confidence ?? '--'}/100
          </p>
          <div className="aqte-daily-style-evaluation space-y-1 text-slate-400" aria-label="Entry style evaluation">
            {(['scalp', 'swing', 'morning'] as const).map(style => {
              const label = style === 'morning' ? 'Independent morning' : style === 'scalp' ? 'Quick scalp' : 'Swing';
              const checks = row.opportunity.style_checks;
              const evaluated = !!checks && Object.prototype.hasOwnProperty.call(checks, style);
              const reason = checks?.[style];
              const recheck = !reason && row.opportunity.style === style;
              const state = !evaluated ? 'NOT EVALUATED' : reason ? 'WAITING' : recheck ? 'BROKER RECHECK' : 'QUALIFIED';
              const detail = reason ?? (recheck ? `${label}: Rules and risk checks passed; selected for broker recheck` : `${label}: ${state}`);
              return <p key={style} className="aqte-daily-style-state" title={detail}
                aria-label={`${label}: ${detail}`}>
                <span>{label}</span><strong>{state}</strong>
              </p>;
            })}
          </div>
          <p className="aqte-daily-account text-slate-400"
            title="Index limits cannot bypass the account cap.">Account remaining {snapshot?.account.remaining} · Reserved entries {row.reserved}. Index limits cannot bypass the account cap.</p>
          <label className="flex min-h-[44px] items-center gap-2 text-slate-200">
            <input type="checkbox" checked={config.enabled} disabled={disabled} onChange={e => change({ enabled: e.target.checked })} />
            Enable {label(symbol)} entries after arming and ON
          </label>
          {config.style !== undefined && <fieldset className="aqte-metric min-w-0 rounded-lg border p-2" aria-label="Entry styles">
            <legend className="px-1 text-slate-300">Entry styles allowed to trade</legend>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {([['scalp', 'Quick scalp', 'Fixed premium-point targets (e.g. NIFTY 10/20/30)'],
                ['swing', 'Swing', 'Rule signal with SL % and target multiple']] as const).map(([style, name, hint]) =>
                <label key={style} className="flex min-h-[44px] min-w-0 items-start gap-2 py-1 text-slate-200">
                  <input type="checkbox" className="mt-0.5 shrink-0" aria-label={`Allow ${name} entries`}
                    checked={allowsStyle(config.style, style)} disabled={disabled}
                    onChange={e => {
                      const other = style === 'scalp' ? 'swing' : 'scalp';
                      change({ style: e.target.checked ? allowsStyle(config.style, other) ? 'both' : style :
                        allowsStyle(config.style, other) ? other : 'none' });
                    }} />
                  <span className="min-w-0">{name}<small className="block break-words text-[10px] leading-snug text-slate-400">{hint}</small></span>
                </label>)}
            </div>
            <p className="mt-1 text-[10px] text-slate-400">Both checked: evaluate each style&apos;s rules and risk, then choose the best qualified entry by aligned engines and rule score. Only one managed trade at a time. Neither checked: no new entries.</p>
          </fieldset>}
          {allowsStyle(config.style, 'scalp') && <p className="text-slate-400">Quick scalp: the rules engine picks the largest point tier the signal strength and futures ATR support, then shrinks it to fit the per-trade risk cap. Stop = target × stop ratio. SL % and target multiple below apply to Swing only; trailing applies to both.</p>}
          {allowsStyle(config.style, 'swing') && config.setups && <fieldset className="aqte-metric min-w-0 rounded-lg border p-2">
            <legend className="px-1 text-slate-300">Swing setups allowed to trade</legend>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {AQTE_SWING_SETUPS.map(setup => <label key={setup} className="flex min-h-[44px] min-w-0 items-start gap-2 py-1 text-slate-200">
                <input type="checkbox" className="mt-0.5 shrink-0" aria-label={`Allow ${AQTE_SETUP_LABELS[setup]} entries`}
                  checked={config.setups?.[setup] ?? false} disabled={disabled}
                  onChange={e => { if (config.setups) change({ setups: { ...config.setups, [setup]: e.target.checked } }); }} />
                <span className="min-w-0">{AQTE_SETUP_LABELS[setup]}
                  <small className="block break-words text-[10px] leading-snug text-slate-400">{SETUP_HINTS[setup]}</small></span>
              </label>)}
            </div>
            <p className="mt-1 text-[10px] text-slate-400">Each setup must pass every one of its own checks. If the top setup is OFF, an ON setup on the same side that passed is traded instead. Price cap, R:R ≥ 1.5, risk and broker gates are identical for all.</p>
          </fieldset>}
          <div className="grid grid-cols-2 gap-3">
            {([
              ['Minimum rule score', 'min_confidence', 75, 80, 1],
              ['Initial SL · premium %', 'stop_percent', 5, 30, 1],
              ['Target · risk multiple', 'target_rr', 2, 5, 0.1],
              ['Trail starts · R', 'trail_start_r', 1, 3, 0.1],
              ['Max index daily loss · INR', 'daily_loss', 1, 2000, 1],
            ] as const).map(([name, key, min, max, step]) => (
              <label key={key} className="text-slate-300">{name}
                <input aria-label={name} type="number" className={input} min={min} max={max} step={step} value={config[key]} disabled={disabled} onChange={e => change({ [key]: Number(e.target.value) })} />
              </label>
            ))}
          </div>
          <p className="text-slate-400">Minimum rule score: 75 by default, adjustable from 75 to 80. The selected minimum applies to both styles, including unvalidated-rule mode; it is not a win probability.</p>
          <button type="button" disabled={disabled || !!error} onClick={() => void save(symbol, false)} className="min-h-[44px] w-full rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-3 font-semibold text-cyan-100 disabled:opacity-40">{busy ? 'Saving…' : `Save ${label(symbol)} controls`}</button>
          {drafts[symbol] && <p className="text-amber-200">Unsaved draft. Counts and limits above reflect saved settings.</p>}
          {!snapshot?.editable && <p className="text-amber-200">Turn automation OFF to edit enable/risk settings. Trade limits above remain editable. Existing position protection is unchanged.</p>}
          {row.opportunity.contract && <details className="text-slate-400">
            <summary className="cursor-pointer py-2">Candidate entry &amp; justification</summary>
            <p className="break-all">{row.opportunity.contract.trading_symbol}</p>
            <p>Signal entry {row.opportunity.entry?.maximum} · Signal SL {row.opportunity.entry?.stop} · Signal target {row.opportunity.entry?.target}{row.opportunity.entry?.points ? ` · +${row.opportunity.entry.points} pts` : ''}</p>
            <p>{row.opportunity.reasons.join(' · ')}</p>
          </details>}
        </>}
        <p className="text-[11px] text-slate-400">Rule score is not a win probability. Unvalidated or incomplete evidence means WAIT. Strict mode blocks unvalidated rules; with AQTE_LIVE_ALLOW_UNVALIDATED_RULES=true, Quick scalp uses its own rule gate and each Swing setup needs every one of its own checks aligned and must be ON. No guaranteed profits.</p>
      </div>
      </details>
    </section>
  );
}
