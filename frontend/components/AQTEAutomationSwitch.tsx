'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { API_CONFIG } from '@/lib/api-config';
import { getOrCreateVisitorId } from '@/lib/visitor-id';
import { aqteControllerCurrent, isAqteLiveState, type AQTELiveState } from '@/lib/aqte-display';

export type AutomationState = AQTELiveState;
type Command = 'on' | 'off' | 'reset';

function automationState(value: unknown): AutomationState {
  if (!isAqteLiveState(value)) {
    throw new Error('Automation status unavailable; check the Real Trade controller and Kite.');
  }
  const age = Date.now() / 1000 - value.generated_at;
  if (age < -1 || age > 10) throw new Error('Automation status is stale. Do not assume ON or OFF; verify in Kite.');
  return value;
}

async function request(command?: Command): Promise<AutomationState> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), command === undefined ? 8000 : 15000);
  const path = command === undefined ? 'status' : command === 'on' ? 'start' : command === 'off' ? 'automation' : 'reset';
  try {
    const response = await fetch(API_CONFIG.endpoint(`/api/aqte/live/${path}`), {
      method: command === undefined ? 'GET' : 'POST',
      credentials: 'include', cache: 'no-store', signal: controller.signal,
      headers: {
        'Content-Type': 'application/json', 'X-Device-Id': getOrCreateVisitorId(),
        'X-AQTE-Intent': 'manual-live-control',
      },
      body: command === undefined ? undefined : JSON.stringify(command === 'reset'
        ? { confirmation: 'RESET EMERGENCY STOP' }
        : { enabled: command === 'on', confirmation: command === 'on' ? 'START AUTOMATED REAL TRADING' : 'STOP NEW ENTRIES' }),
    });
    const value: unknown = await response.json();
    if (!response.ok) {
      const detail = value && typeof value === 'object' && 'detail' in value ? value.detail : null;
      throw new Error(typeof detail === 'string' ? detail : 'Switch request failed. Check server status before retrying.');
    }
    const state = automationState(value);
    if ((command === 'on' || command === 'off') && state.automation_on !== (command === 'on')) {
      throw new Error('Backend did not confirm the requested automation state. Verify status before retrying.');
    }
    if (command === 'reset' && (state.killed || state.automation_on || state.armed ||
        state.flatten_pending !== false || state.active !== null || !state.ready)) {
      throw new Error('Backend did not confirm an emergency reset to OFF. Verify Kite and controller status before retrying.');
    }
    return state;
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
  const [confirming, setConfirming] = useState<'on' | 'reset' | null>(null);
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

  const act = async (command: Command) => {
    if (changing.current) return;
    changing.current = true;
    revision.current++;
    setBusy(true);
    setSaved(false);
    setError(null);
    setConfirming(null);
    try {
      const value = await request(command);
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
  const known = !unknown && !!status;
  const on = !unknown && status?.automation_on === true && !status.killed;
  const canStart = !unknown && !!status?.ready && status.enabled && status.paper_validated && !status.killed;
  const canReset = known && aqteControllerCurrent(status) && status.killed &&
    status.flatten_pending === false && status.active === null;
  const label = busy ? 'Saving…' : !known ? unknown ? 'UNKNOWN' : 'Checking…' : status.killed ? 'STOPPED' : on ? 'ON' : 'OFF';
  const cancelOnEscape = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    setConfirming(null);
  };
  return (
    <div className="aqte-automation-control">
      <button
        type="button" role={known ? 'switch' : undefined} aria-checked={known ? on : undefined}
        aria-label={`AQTE automated real trading${known ? '' : ' · status unavailable'}`}
        aria-describedby="aqte-automation-help"
        aria-busy={busy}
        disabled={busy || (!on && !canStart) || (known && status.killed)}
        onClick={() => { if (on) void act('off'); else if (canStart) setConfirming('on'); }}
        className={`aqte-auto-switch ${known && status.killed ? 'aqte-auto-switch-stopped' : !known ? 'aqte-auto-switch-unknown' : on ? 'aqte-auto-switch-on' : 'aqte-auto-switch-off'}`}
      >
        <span className="aqte-auto-switch-label">Auto Trade {label}</span>
        <span className="aqte-auto-switch-track" aria-hidden="true"><span className="aqte-auto-switch-thumb" /></span>
      </button>
      {unknown && <button type="button" className="aqte-auto-request-off" aria-label="Stop AQTE new entries"
        disabled={busy} onClick={() => void act('off')}>Request OFF · verify acknowledgement</button>}
      {known && status.killed && (
        <button type="button" className="aqte-auto-reset" disabled={busy || !canReset}
          onClick={() => { if (canReset) setConfirming('reset'); }}>Reset emergency stop</button>
      )}
      <p role="status" className={`${!busy && !(known && status.killed) ? 'sr-only' : 'text-right text-sm'} ${unknown || !status ? 'text-amber-200' : status.killed ? 'text-rose-200' : on ? 'text-emerald-200' : 'text-amber-200'}`}>
        {busy ? 'Saving to backend…' : unknown || !status ? 'UNKNOWN · Verifying backend state · Do not assume OFF' :
          status.killed ? (status.flatten_pending ? 'Emergency stop latched · Closing all Kite positions' :
            !status.ready ? 'Emergency stop latched · Controller unavailable; reset blocked' :
              status.active ? 'Emergency stop latched · Trade reconciliation pending; inspect Kite' :
                status.flatten_pending !== false ? 'Emergency stop latched · Square-off status unverified; inspect Kite' :
                  'Emergency stop latched · Owner reset required before ON') :
            `${saved ? 'Saved automatically' : 'Backend confirmed'} · ${on ? 'ON' : 'OFF'}`}
      </p>
      <p id="aqte-automation-help" className="sr-only">
        {unknown ? 'Status unknown. Use this control to request OFF; verify acknowledgement.' :
          on ? 'Automatic real entries enabled. OFF blocks new entries; protective exits continue.' :
            'Default OFF. Confirm ON to run preflight and arm today. Backend approval is required.'}
      </p>
      {known && !status.killed && !on && (!status.ready || !status.enabled || !status.paper_validated) && (
        <p role="status" className="text-right text-xs text-amber-200">
          {!status.ready ? 'ON locked · Live controller is not ready' : 'ON locked · Backend live-trading approval is required'}
        </p>
      )}
      {confirming === 'on' && (
        <div role="group" aria-label="Confirm automated real trading" onKeyDown={cancelOnEscape}
          className="space-y-2 rounded-lg border border-amber-400/40 bg-slate-950 p-3 text-xs">
          <p className="leading-relaxed text-amber-100">Start automated real-money orders? ON checks Kite and static IP, arms today and scans for qualifying one-lot BUY CE/BUY PE entries using your saved settings. New entries stop at 3:15 PM IST. No qualifying signal means no trade.</p>
          <p className={`leading-relaxed ${status?.unvalidated_rules ? 'text-rose-200' : 'text-slate-300'}`}>
            {status?.unvalidated_rules
              ? 'Server allows unvalidated rule entries: fully aligned setups can place real one-lot orders.'
              : 'Strict validation mode: the quality gate blocks every entry, so ON scans without placing orders.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || !canStart} onClick={() => void act('on')} className="min-h-[44px] rounded-lg border border-amber-400/40 px-3 text-amber-200 disabled:opacity-40">Confirm ON · real money</button>
            <button type="button" onClick={() => setConfirming(null)} className="min-h-[44px] rounded-lg border border-slate-600 px-3 text-slate-300">Cancel · stay OFF</button>
          </div>
        </div>
      )}
      {confirming === 'reset' && (
        <div role="group" aria-label="Confirm emergency reset" onKeyDown={cancelOnEscape}
          className="space-y-2 rounded-lg border border-amber-400/40 bg-slate-950 p-3 text-xs">
          <p className="leading-relaxed text-amber-100">Verify in Kite that positions and working orders are clear before resetting. Reset only clears the emergency latch and keeps automation OFF. ON requires separate confirmation, backend approval and weekday entry hours: 09:15–15:15 IST.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setConfirming(null)} className="min-h-[44px] rounded-lg border border-slate-600 px-3 text-slate-300">Cancel reset</button>
            <button type="button" disabled={busy || !canReset} onClick={() => { if (canReset) void act('reset'); }}
              className="min-h-[44px] rounded-lg border border-amber-400/40 px-3 text-amber-200 disabled:opacity-40">Confirm reset · keep OFF</button>
          </div>
          {!canReset && <p role="alert">Reset unavailable. Wait for emergency square-off and a fresh controller status; verify in Kite.</p>}
        </div>
      )}
      {error && <p role="alert" className="break-words text-right text-xs text-rose-300">{error}</p>}
    </div>
  );
}
