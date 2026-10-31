'use client';

import { useEffect, useRef, useState } from 'react';
import { API_CONFIG } from '@/lib/api-config';
import { getOrCreateVisitorId } from '@/lib/visitor-id';

export type AutomationState = {
  automation_on: boolean; armed: boolean; enabled: boolean;
  paper_validated: boolean; ready: boolean; killed: boolean; flatten_pending?: boolean;
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
      enabled === undefined ? '/api/aqte/live/status' : enabled ? '/api/aqte/live/start' : '/api/aqte/live/automation'
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
  const canStart = !unknown && !!status?.ready && status.enabled && status.paper_validated && !status.killed;
  return (
    <div className="aqte-automation-control ml-auto flex w-full min-w-0 max-w-full flex-col items-end gap-2 sm:w-auto sm:max-w-sm">
      <div role="group" aria-label="AQTE automation ON and OFF" className={`aqte-auto-segments ${on ? 'aqte-auto-running' : !unknown && status?.killed ? 'aqte-auto-killed' : 'aqte-auto-paused'}`}>
      <button
        type="button" role="switch" aria-checked={on}
        aria-label="AQTE automated real trading"
        aria-describedby="aqte-automation-help"
        disabled={busy || !canStart || on}
        onClick={() => setConfirming(true)}
        className={`aqte-auto-choice inline-flex min-h-[48px] w-full min-w-0 flex-wrap items-center justify-center gap-2 rounded-xl border-2 px-3 py-2 text-xs font-bold tracking-wide transition-colors disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 ${
          status?.killed && !unknown ? 'border-rose-400/80 bg-rose-500/20 text-rose-100' :
            on ? 'border-emerald-400/80 bg-emerald-500/20 text-emerald-100' : 'border-amber-400/70 bg-amber-400/15 text-amber-100'
        }`}
      >
        <span className="aqte-auto-choice-title"><span aria-hidden="true">▶</span> ON</span>
        <span className="sr-only">Auto Trading</span>
      </button>
      <button type="button" aria-label="Stop AQTE new entries" aria-pressed={!unknown && !!status && !status.automation_on}
        disabled={busy || !status && !unknown}
        onClick={() => void toggle(false)}
        className={`aqte-auto-choice aqte-auto-off ${!unknown && status && !on ? 'aqte-auto-selected-off' : ''}`}>
        <span className="aqte-auto-choice-title"><span aria-hidden="true">■</span> OFF</span>
        <span className="sr-only">Pause entries</span>
      </button>
      </div>
      <p role="status" className={`${!busy && (unknown || !status) ? 'sr-only' : 'text-right text-[10px]'} ${unknown || !status ? 'text-amber-200' : status.killed ? 'text-rose-200' : on ? 'text-emerald-200' : 'text-amber-200'}`}>
        {busy ? 'Saving to backend…' : unknown || !status ? 'UNKNOWN · Verifying backend state · Do not assume OFF' :
          status.killed ? (status.flatten_pending ? 'Emergency stop latched · Closing all Kite positions' : 'Emergency stop latched · Reset below to enable ON') :
            `${saved ? 'Saved automatically' : 'Backend confirmed'} · ${on ? 'ON' : 'OFF'}`}
      </p>
      <p id="aqte-automation-help" className="sr-only">
        {unknown ? 'Status unknown. Use this control to request OFF; verify acknowledgement.' :
          on ? 'Automatic real entries enabled. OFF blocks new entries; protective exits continue.' :
            'Default OFF. Confirm ON to run preflight and arm today. Backend approval is required.'}
      </p>
      {confirming && (
        <div className="space-y-2 rounded-lg border border-amber-400/40 bg-slate-950 p-3 text-xs">
          <p className="leading-relaxed text-amber-100">Start automated real-money orders? ON checks Kite and static IP, arms today and scans for qualifying one-lot BUY CE/BUY PE entries using your saved settings. New entries stop at 3:15 PM IST. No qualifying signal means no trade.</p>
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
