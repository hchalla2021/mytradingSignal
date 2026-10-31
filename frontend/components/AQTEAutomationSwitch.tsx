'use client';

import { useEffect, useRef, useState } from 'react';
import { API_CONFIG } from '@/lib/api-config';
import { getOrCreateVisitorId } from '@/lib/visitor-id';

export type AutomationState = {
  automation_on: boolean; armed: boolean; enabled: boolean;
  paper_validated: boolean; ready: boolean; killed: boolean;
};

function automationState(value: unknown): AutomationState {
  if (!value || typeof value !== 'object' ||
      !['automation_on', 'armed', 'enabled', 'paper_validated', 'ready', 'killed'].every(
        key => key in value && typeof Reflect.get(value, key) === 'boolean')) {
    throw new Error('Automation status unavailable; check the Real Trade controller and Kite.');
  }
  return value as AutomationState;
}

async function request(enabled?: boolean): Promise<AutomationState> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(API_CONFIG.endpoint(
      enabled === undefined ? '/api/aqte/live/status' : '/api/aqte/live/automation'
    ), {
      method: enabled === undefined ? 'GET' : 'POST',
      credentials: 'include', cache: 'no-store', signal: controller.signal,
      headers: {
        'Content-Type': 'application/json', 'X-Device-Id': getOrCreateVisitorId(),
        'X-AQTE-Intent': 'manual-live-control',
      },
      body: enabled === undefined ? undefined : JSON.stringify({
        enabled, confirmation: enabled ? 'START AUTOMATED REAL TRADING' : 'STOP NEW ENTRIES',
      }),
    });
    const value: unknown = await response.json();
    if (!response.ok) {
      const detail = value && typeof value === 'object' && 'detail' in value ? value.detail : null;
      throw new Error(typeof detail === 'string' ? detail : 'Switch request failed. Check server status before retrying.');
    }
    return automationState(value);
  } finally {
    clearTimeout(timeout);
  }
}

export default function AQTEAutomationSwitch({ onStatus }: {
  onStatus?: (status: AutomationState | null) => void;
} = {}) {
  const [status, setStatus] = useState<AutomationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [saved, setSaved] = useState(false);
  const changing = useRef(false);
  const revision = useRef(0);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!changing.current) {
        const version = revision.current;
        try {
          const value = await request();
          if (active && !changing.current && version === revision.current) {
            setStatus(value);
            setUnknown(false);
            setError(null);
            onStatus?.(value);
          }
        } catch (cause) {
          if (active && !changing.current && version === revision.current) {
            setUnknown(true);
            setSaved(false);
            onStatus?.(null);
            setError(cause instanceof Error ? cause.message : 'Automation status unavailable');
          }
        }
      }
      if (active) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [onStatus]);

  const toggle = async (enabled: boolean) => {
    if (changing.current) return;
    changing.current = true;
    revision.current++;
    setBusy(true);
    setSaved(false);
    setError(null);
    setConfirming(false);
    try {
      const value = await request(enabled);
      setStatus(value);
      onStatus?.(value);
      setUnknown(false);
      setSaved(true);
    } catch (cause) {
      setUnknown(true);
      onStatus?.(null);
      setError(cause instanceof Error ? cause.message : 'Switch outcome unknown. Check Kite and server status.');
    } finally {
      changing.current = false;
      setBusy(false);
    }
  };
  const on = !unknown && status?.automation_on === true && !status.killed;
  const canStart = !unknown && !!status?.ready && status.enabled && status.paper_validated && status.armed && !status.killed;
  return (
    <div className="ml-auto flex w-full min-w-0 max-w-full flex-col items-end gap-2 sm:w-auto sm:max-w-sm">
      <button
        type="button" role="switch" aria-checked={on}
        aria-label="AQTE automated real trading"
        aria-describedby="aqte-automation-help"
        disabled={busy || (!on && !unknown && !canStart)}
        onClick={() => {
          if (on || unknown) void toggle(false);
          else setConfirming(true);
        }}
        className={`inline-flex min-h-[48px] w-full min-w-0 flex-wrap items-center justify-center gap-2 rounded-xl border-2 px-3 py-2 text-xs font-bold tracking-wide transition-colors disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 sm:w-auto sm:gap-3 ${
          status?.killed && !unknown ? 'border-rose-400/80 bg-rose-500/20 text-rose-100' :
            on ? 'border-emerald-400/80 bg-emerald-500/20 text-emerald-100' : 'border-amber-400/70 bg-amber-400/15 text-amber-100'
        }`}
      >
        AUTO REAL TRADING
        <span aria-hidden="true" className={`relative h-6 w-11 shrink-0 rounded-full border ${on ? 'border-emerald-400 bg-emerald-500/30' : 'border-slate-600 bg-slate-800'}`}>
          <span className={`absolute left-0 top-0.5 h-[18px] w-[18px] rounded-full transition-transform ${on ? 'translate-x-5 bg-emerald-300' : 'translate-x-0.5 bg-slate-400'}`} />
        </span>
        <span className={`rounded-md border px-2.5 py-1 text-[11px] font-extrabold ${
          !unknown && status?.killed ? 'border-rose-300 bg-rose-600 text-white' :
            on ? 'border-emerald-300 bg-emerald-400 text-slate-950' : 'border-amber-300 bg-amber-300 text-slate-950'
        }`}>{busy ? 'SAVING' : unknown || !status ? 'UNKNOWN · STOP' : status.killed ? 'EMERGENCY STOP' : on ? 'ON' : 'OFF'}</span>
      </button>
      <p role="status" className={`text-right text-[10px] ${unknown || !status ? 'text-amber-200' : status.killed ? 'text-rose-200' : on ? 'text-emerald-200' : 'text-amber-200'}`}>
        {busy ? 'Saving to backend…' : unknown || !status ? 'Verifying backend state · Do not assume OFF' :
          status.killed ? 'Emergency stop latched · New entries blocked' :
            `${saved ? 'Saved automatically' : 'Backend confirmed'} · ${on ? 'ON' : 'OFF'} · Restored on page refresh`}
      </p>
      <div aria-label="AQTE auto trading schedule" className="w-full rounded-lg border border-slate-600/60 bg-slate-950/60 px-3 py-2 text-right text-[11px] leading-relaxed text-slate-300">
        <p className="font-semibold text-slate-100">AQTE auto trading only · 9:15 AM–3:30 PM IST</p>
        <p>New entries until 3:15 PM · Square-off starts 3:25 PM</p>
        <p>ON: buy qualifying CE/PE setups using saved index limits and risk settings.</p>
        <p>OFF: pause new entries; open-position protection continues.</p>
      </div>
      <details className="text-right text-[11px] leading-relaxed text-slate-400" open={unknown || undefined}>
      <summary className="cursor-pointer py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Automation help</summary>
      <p id="aqte-automation-help" className="pb-2">
        {unknown ? 'Status unknown. Use this control to request OFF; verify acknowledgement.' :
          on ? 'Automatic real entries enabled. OFF blocks new entries; protective exits continue.' :
            'Default OFF. Complete preflight and daily arming in Real Trade before ON.'}
        {' '}ON/OFF is saved automatically by the backend, not browser storage. Refresh reads it back without submitting orders. Backend restart, a new session or a safety stop can reset ON to OFF.
        {' '}No qualifying signal means no trade. Paper trading, market data and manual Kite positions are not controlled by this switch. OFF remains available outside market hours; Emergency Stop also requests exit of AQTE-managed positions and requires operator review before rearming.
      </p>
      </details>
      {confirming && (
        <div className="space-y-2 rounded-lg border border-amber-400/40 bg-slate-950 p-3 text-xs">
          <p className="leading-relaxed text-amber-100">Start automated real-money orders? Qualifying signals can place one-lot BUY CE/BUY PE orders without individual approval, using enabled indices and saved trade limits and risk settings. New entries stop at 3:15 PM IST. No qualifying signal means no trade.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || !canStart} onClick={() => void toggle(true)} className="min-h-[44px] rounded-lg border border-amber-400/40 px-3 text-amber-200 disabled:opacity-40">Confirm ON · real money</button>
            <button type="button" onClick={() => setConfirming(false)} className="min-h-[44px] rounded-lg border border-slate-600 px-3 text-slate-300">Keep OFF</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="break-words text-right text-xs text-rose-300">{error}</p>}
    </div>
  );
}
