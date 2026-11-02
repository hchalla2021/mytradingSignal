'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { API_CONFIG } from '@/lib/api-config';
import { notifyAppAccessExpired } from '@/lib/app-access-events';
import { getOrCreateVisitorId } from '@/lib/visitor-id';
import { AQTE_RECONNECT_GRACE_MS, aqteCanExit, aqteConnectionDrop, aqteErrorText, aqtePollLoop, isAqteLiveState,
  type AQTELiveState, type AQTEExitRequest } from '@/lib/aqte-display';

const headers = () => ({
  'Content-Type': 'application/json',
  'X-Device-Id': getOrCreateVisitorId(),
  'X-AQTE-Intent': 'manual-live-control',
});

async function request(path: 'status' | 'exit', body?: object, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(API_CONFIG.endpoint(`/api/aqte/live/${path}`), {
    method: body === undefined ? 'GET' : 'POST',
    headers: headers(), credentials: 'include', cache: 'no-store', signal,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    // This is the page's only live-status poll, so it owns the sign-in prompt for an expired session.
    if (response.status === 401) notifyAppAccessExpired();
    const detail = payload && typeof payload === 'object' && 'detail' in payload ? payload.detail : null;
    throw new Error(typeof detail === 'string' ? detail : `Live operation failed (${response.status}); inspect Kite before retrying`);
  }
  return payload;
}

function liveState(value: unknown): AQTELiveState {
  if (!isAqteLiveState(value)) throw new Error('Invalid live-controller response; inspect Kite');
  const age = Date.now() / 1000 - value.generated_at;
  if (age < -1 || age > 10) throw new Error('Live-controller response is stale; inspect Kite');
  return value;
}

function AQTELiveController({ onStatus, exitRequest = null }: {
  onStatus?: (status: AQTELiveState | null, error?: string) => void;
  exitRequest?: AQTEExitRequest | null;
}) {
  const [status, setStatus] = useState<AQTELiveState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [confirm, setConfirm] = useState<AQTEExitRequest | null>(null);
  const [seenExit, setSeenExit] = useState(exitRequest);
  const latest = useRef<AQTELiveState | null>(null);
  const revision = useRef(0);
  const acting = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  if (exitRequest !== seenExit) {
    setSeenExit(exitRequest);
    if (exitRequest) setConfirm(exitRequest);
  }

  useEffect(() => {
    const element = dialog.current;
    if (!confirm || !element) return;
    const opener = document.activeElement;
    element.showModal();
    cancelButton.current?.focus();
    return () => {
      element.close();
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [confirm]);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    let lastOk = 0;
    const poll = async () => {
      const started = revision.current;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 8000);
      try {
        const value = liveState(await request('status', undefined, controller.signal));
        lastOk = Date.now();
        if (active && started === revision.current && !acting.current) {
          latest.current = value;
          setStatus(value);
          setConnected(true);
          onStatus?.(value);
        }
      } catch (cause) {
        if (aqteConnectionDrop(cause) && Date.now() - lastOk < AQTE_RECONNECT_GRACE_MS) return;
        if (active && started === revision.current && !acting.current) {
          const message = aqteErrorText(cause, 'Live status unavailable; inspect Kite');
          setConnected(false);
          onStatus?.(latest.current ? { ...latest.current, connection_error: message } : null, message);
        }
      } finally {
        clearTimeout(timeout);
      }
    };
    const stopPolling = aqtePollLoop(poll);
    return () => { active = false; stopPolling(); controller?.abort(); };
  }, [onStatus]);

  const exitTrade = async (tradeId: string) => {
    if (acting.current) return;
    acting.current = true;
    revision.current += 1;
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const value = await request('exit', {
        trade_id: tradeId, confirmation: 'CLOSE SELECTED AQTE TRADE',
      }, controller.signal);
      const state = liveState(value);
      latest.current = state;
      setStatus(state);
      onStatus?.(state);
      setConnected(true);
    } catch (cause) {
      const message = controller.signal.aborted ? 'Live action timed out; outcome unknown. Check Kite before retrying.' :
        cause instanceof Error ? cause.message : 'Live action failed. Check Kite before retrying.';
      setError(message);
      setConnected(false);
      onStatus?.(latest.current ? { ...latest.current, connection_error: message } : null, message);
    } finally {
      clearTimeout(timeout);
      acting.current = false;
      setBusy(false);
    }
  };
  const canConfirmExit = !!confirm && connected && aqteCanExit(status) &&
    status?.active?.id === confirm.tradeId && !status.active.exit_requested;
  const button = 'min-h-[44px] rounded-lg border px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300';
  return (
    <>
      {confirm && (
        <dialog ref={dialog} role="alertdialog" aria-modal="true" aria-labelledby="aqte-confirm-title"
          aria-describedby="aqte-confirm-description" onCancel={() => setConfirm(null)}
          onKeyDown={event => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            setConfirm(null);
          }}
          className="aqx-modal space-y-3 rounded-xl border border-rose-400/60 bg-[#12070d] p-4 text-xs leading-relaxed text-rose-100 shadow-2xl">
          <h4 id="aqte-confirm-title" className="text-sm font-bold text-rose-50">{confirm.action === 'book' ? 'Book all' : 'Exit'} · Selected AQTE trade?</h4>
          <p id="aqte-confirm-description">Close the remaining {confirm.quantity} units of {confirm.contract}? Only this trade&apos;s existing protective order is converted to a marketable limit. Other Kite positions and orders are untouched. New automatic entries will pause. This requests an exit, not a guaranteed fill; a stale quote retains the broker stop.</p>
          <div className="flex flex-wrap gap-2">
            <button ref={cancelButton} type="button" className={`${button} border-slate-500/50 text-slate-200`} onClick={() => setConfirm(null)}>Cancel</button>
            <button type="button" className={`${button} border-rose-400/60 bg-rose-500/20 text-rose-50`}
              disabled={busy || !canConfirmExit} onClick={() => {
              if (!canConfirmExit) return;
              setConfirm(null);
              void exitTrade(confirm.tradeId);
            }}>Confirm selected trade exit</button>
          </div>
          {!canConfirmExit && <p role="alert">Selected trade changed, is already exiting, or status is unavailable. Cancel and refresh; verify in Kite.</p>}
        </dialog>
      )}
      {error && (
        <p role="alert" className="break-words rounded-lg border border-rose-400/30 bg-rose-400/10 p-3 text-xs leading-relaxed text-rose-200">
          {error}
        </p>
      )}
    </>
  );
}

export default memo(AQTELiveController);
