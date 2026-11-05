'use client';

import { memo, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { API_CONFIG } from '@/lib/api-config';
import { notifyAppAccessExpired } from '@/lib/app-access-events';
import { getOrCreateVisitorId } from '@/lib/visitor-id';
import { AQTE_RECONNECT_GRACE_MS, aqteConnectionDrop, aqteControllerCurrent, aqteErrorText, aqtePollLoop, isAqteLiveState,
  type AQTELiveState } from '@/lib/aqte-display';

export type AutomationState = AQTELiveState;
type Command = 'on' | 'off' | 'reset';
const UNTRUSTED_ORIGIN = 'Untrusted live-control origin';

function originRejected(): string {
  const domain = process.env.NEXT_PUBLIC_PRODUCTION_DOMAIN;
  const site = domain ? `https://${domain}` : 'the production site';
  return `Production rejects Auto Trade switching from ${window.location.origin}. Use ${site}, or add this origin to production CORS_ORIGINS.`;
}

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
      if (response.status === 401) notifyAppAccessExpired();
      const detail = value && typeof value === 'object' && 'detail' in value ? value.detail : null;
      if (response.status === 403 && detail === UNTRUSTED_ORIGIN) throw new Error(originRejected());
      throw new Error(typeof detail === 'string' ? detail : 'Switch request failed. Check server status before retrying.');
    }
    const state = automationState(value);
    // Older backends lack automation_wanted; fall back to automation_on there.
    const wanted = state.automation_wanted ?? state.automation_on;
    if ((command === 'on' && !wanted) || (command === 'off' && (wanted || state.automation_on))) {
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

function AQTEAutomationSwitch({ onStatus, feed, feedError = null }: {
  onStatus?: (status: AutomationState | null) => void;
  /** Status from the page's single live-status poll ('pending' until its first answer). When given, the switch does not poll. */
  feed?: AutomationState | null | 'pending';
  /** Why the shared poll failed when `feed` is null. */
  feedError?: string | null;
} = {}) {
  const [ownStatus, setStatus] = useState<AutomationState | null>(null);
  const [commandError, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<'on' | 'reset' | null>(null);
  const [ownUnknown, setUnknown] = useState(false);
  const [savedOk, setSaved] = useState(false);
  const [failedAt, setFailedAt] = useState<number | null>(null);
  const changing = useRef(false);
  const revision = useRef(0);
  const shared = feed !== undefined;

  useEffect(() => {
    if (shared) return;
    let lastOk = 0;
    let active = true;
    const poll = async () => {
      if (changing.current) return;
      const version = revision.current;
      try {
        const value = await request();
        lastOk = Date.now();
        if (active && !changing.current && version === revision.current) {
          setStatus(value);
          setUnknown(false);
          setError(null);
          onStatus?.(value);
        }
      } catch (cause) {
        // A brief browser-side drop keeps the state the backend confirmed moments ago.
        if (aqteConnectionDrop(cause) && Date.now() - lastOk < AQTE_RECONNECT_GRACE_MS) return;
        if (active && !changing.current && version === revision.current) {
          setUnknown(true);
          setSaved(false);
          onStatus?.(null);
          setError(aqteErrorText(cause, 'Automation status unavailable'));
        }
      }
    };
    const stopPolling = aqtePollLoop(poll);
    return () => { active = false; stopPolling(); };
  }, [onStatus, shared]);

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
      setFailedAt(null);
      setSaved(true);
    } catch (cause) {
      setUnknown(true);
      setFailedAt(Date.now() / 1000);
      // In shared mode the page's poll owns the live status; only this switch's outcome is unknown.
      if (!shared) onStatus?.(null);
      setError(cause instanceof Error ? cause.message : 'Switch outcome unknown. Check Kite and server status.');
    } finally {
      changing.current = false;
      setBusy(false);
    }
  };
  // Shared mode shows the newest backend answer: a poll started before a command can resolve after it.
  const feedStatus = feed && feed !== 'pending' ? feed : null;
  const status = !shared ? ownStatus :
    feedStatus && (!ownStatus || feedStatus.generated_at >= ownStatus.generated_at) ? feedStatus : ownStatus;
  // A failed command stays unknown until a status generated after it (with 1 s clock-skew margin) arrives.
  const commandUnknown = failedAt != null && (!feedStatus || feedStatus.generated_at <= failedAt + 1);
  const unknown = !shared ? ownUnknown : feed === null || !!feedStatus?.connection_error || commandUnknown;
  const feedFault = feedStatus?.connection_error ?? (feed === null ? feedError ?? 'Automation status unavailable; verify in Kite before assuming ON or OFF.' : null);
  const error = !shared || commandUnknown ? commandError : feedFault === UNTRUSTED_ORIGIN ? originRejected() : feedFault;
  const saved = savedOk && !unknown;
  const known = !unknown && !!status;
  const on = known && (status.automation_wanted ?? status.automation_on) === true && !status.killed;
  const waiting = on && !status.automation_on;
  const canStart = !unknown && !!status?.ready && status.enabled && !status.killed;
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
      {API_CONFIG.sharedProduction && (
        <p className="text-right text-xs text-amber-200">Shared production · REAL ORDERS</p>
      )}
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
          status.killed ? (status.flatten_pending ? 'Emergency stop latched · Closing AQTE positions only · manual trades untouched' :
            !status.ready ? 'Emergency stop latched · Controller unavailable; reset blocked' :
              status.active ? 'Emergency stop latched · Trade reconciliation pending; inspect Kite' :
                status.flatten_pending !== false ? 'Emergency stop latched · Square-off status unverified; inspect Kite' :
                  'Emergency stop latched · Owner reset required before ON') :
            `${saved ? 'Saved automatically' : 'Backend confirmed'} · ${on ? 'ON' : 'OFF'}`}
      </p>
      <p id="aqte-automation-help" className="sr-only">
        {unknown ? 'Status unknown. Use this control to request OFF; verify acknowledgement.' :
          on ? 'Auto trade stays ON until you switch it OFF. OFF blocks new entries; protective exits continue.' :
            'Default OFF. Confirm ON any time; it arms itself during weekday entry hours. Backend live enablement is required.'}
      </p>
      {waiting && (
        <p role="status" className="text-right text-xs text-amber-200">
          ON · {status.automation_waiting || 'Waiting to arm for the market session'}
        </p>
      )}
      {known && !status.killed && !on && (!status.ready || !status.enabled) && (
        <p role="status" className="text-right text-xs text-amber-200">
          {!status.ready ? 'ON locked · Live controller is not ready' : 'ON locked · AQTE_LIVE_ENABLED is false'}
        </p>
      )}
      {confirming === 'on' && (
        <div role="group" aria-label="Confirm automated real trading" onKeyDown={cancelOnEscape}
          className="aqx-auto-confirm">
          <p className="aqx-auto-confirm-lead">Start automated real-money orders? ON stays saved until you switch OFF, even when the market is closed. Weekday one-lot BUY CE/BUY PE entries run 09:15–15:15 IST after safety checks. No qualifying signal means no trade.</p>
          <details className="aqx-auto-confirm-details">
            <summary>Review execution safeguards</summary>
            <p>AQTE manages only its own tagged orders. It never closes, cancels or modifies your manual Kite trades; if you already hold its chosen contract, it uses a different strike or waits.</p>
            <p className={status?.unvalidated_rules ? 'text-rose-200' : 'text-slate-300'}>
              {status?.unvalidated_rules
                ? 'Server allows unvalidated rule entries: fully aligned setups can place real one-lot orders.'
                  : 'Strict validation mode: the quality gate blocks every entry, so ON scans without placing orders.'}
            </p>
          </details>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || !canStart} onClick={() => void act('on')} className="aqx-auto-confirm-on">Confirm ON · real money</button>
            <button type="button" onClick={() => setConfirming(null)} className="aqx-auto-confirm-cancel">Cancel · stay OFF</button>
          </div>
        </div>
      )}
      {confirming === 'reset' && (
        <div role="group" aria-label="Confirm emergency reset" onKeyDown={cancelOnEscape}
          className="space-y-2 rounded-lg border border-amber-400/40 bg-slate-950 p-3 text-xs">
          <p className="leading-relaxed text-amber-100">Verify in Kite that AQTE positions and AQTE orders are clear before resetting; your manual trades are never touched. Reset only clears the emergency latch and keeps automation OFF. ON requires separate confirmation and backend live enablement; entries require weekday entry hours: 09:15–15:15 IST.</p>
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

// The section re-renders every second for its clock; the switch only needs to re-render when its feed changes.
export default memo(AQTEAutomationSwitch);
