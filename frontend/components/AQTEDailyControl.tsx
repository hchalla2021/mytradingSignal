'use client';

import { useEffect, useRef, useState } from 'react';
import { API_CONFIG } from '@/lib/api-config';
import { getOrCreateVisitorId } from '@/lib/visitor-id';

const SYMBOLS = ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const;
type SymbolName = typeof SYMBOLS[number];
type Config = {
  enabled: boolean; max_trades: number; min_confidence: number; stop_percent: number;
  target_rr: number; trail_start_r: number; daily_loss: number;
};
type Row = {
  config: Config; executed: number; reserved: number; remaining: number;
  status: string; reason: string; direction: string;
  opportunity: { decision: string; confidence: number | null; contract: { trading_symbol: string } | null;
    entry: { maximum: number; stop: number; target: number } | null; reasons: string[] };
};
type Snapshot = {
  data: Record<SymbolName, Row>; editable: boolean; limits_editable: boolean; long_only: true;
  account: { max_trades: number; executed: number; reserved: number; remaining: number };
};
const label = (symbol: string) => symbol === 'BANKNIFTY' ? 'BANK NIFTY' : symbol;
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
      Number.isInteger(config.max_trades) && config.max_trades >= 1 && config.max_trades <= 10 &&
      (['min_confidence', 'stop_percent', 'target_rr', 'trail_start_r', 'daily_loss'] as const)
        .every(key => typeof config[key] === 'number' && Number.isFinite(config[key])) &&
      count(row.executed) && count(row.reserved) && count(row.remaining) &&
      typeof row.status === 'string' && typeof row.reason === 'string' && typeof row.direction === 'string' &&
      opportunity && typeof opportunity.decision === 'string' &&
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
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | null = null;
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
        if (active && !saving.current && generation.current === version) { lastSnapshot = result; setSnapshot(result); setError(null); }
      } catch (cause) {
        if (active && !saving.current && generation.current === version) setError(cause instanceof Error ? cause.message : 'Daily controls unavailable');
      } finally {
        clearTimeout(timeout);
        if (active) timer = setTimeout(poll, 2000);
      }
    };
    void poll();
    return () => { active = false; mounted.current = false; clearTimeout(timer); controller?.abort(); saveController.current?.abort(); };
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
          <p className="text-amber-200">{error ? 'STATUS UNAVAILABLE' : row.status} · {row.reason}</p>
          <p className="text-slate-300">Direction {row.direction} · Best candidate {row.opportunity.decision} · Rule score {row.opportunity.confidence ?? '--'}/100</p>
          <p className="text-slate-400">Account remaining {snapshot?.account.remaining} · Reserved entries {row.reserved}. Index limits cannot bypass the account cap.</p>
          <label className="flex min-h-[44px] items-center gap-2 text-slate-200">
            <input type="checkbox" checked={config.enabled} disabled={disabled} onChange={e => change({ enabled: e.target.checked })} />
            Enable {label(symbol)} entries after arming and ON
          </label>
          <div className="grid grid-cols-2 gap-3">
            {([
              ['Minimum rule score', 'min_confidence', 90, 100, 1],
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
          <button type="button" disabled={disabled || !!error} onClick={() => void save(symbol, false)} className="min-h-[44px] w-full rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-3 font-semibold text-cyan-100 disabled:opacity-40">{busy ? 'Saving…' : `Save ${label(symbol)} controls`}</button>
          {drafts[symbol] && <p className="text-amber-200">Unsaved draft. Counts and limits above reflect saved settings.</p>}
          {!snapshot?.editable && <p className="text-amber-200">Turn automation OFF to edit enable/risk settings. Trade limits above remain editable. Existing position protection is unchanged.</p>}
          {row.opportunity.contract && <details className="text-slate-400">
            <summary className="cursor-pointer py-2">Candidate entry &amp; justification</summary>
            <p className="break-all">{row.opportunity.contract.trading_symbol}</p>
            <p>Signal entry {row.opportunity.entry?.maximum} · Signal SL {row.opportunity.entry?.stop} · Signal target {row.opportunity.entry?.target}</p>
            <p>{row.opportunity.reasons.join(' · ')}</p>
          </details>}
        </>}
        <p className="text-[11px] text-slate-400">Rule score is not a win probability. Unvalidated or incomplete evidence means WAIT. Defaults cannot meet 90 with the current rule baseline; no guaranteed profits.</p>
      </div>
      </details>
    </section>
  );
}
