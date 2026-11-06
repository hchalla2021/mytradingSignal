'use client';

import { useEffect, useRef, useState } from 'react';
import { API_CONFIG } from '@/lib/api-config';
import { getOrCreateVisitorId } from '@/lib/visitor-id';
import { notifyAppAccessExpired } from '@/lib/app-access-events';
import { aqteErrorText, aqteIstDay, aqteLiveMetrics, aqtePollLoop, aqteSigned,
  type AQTELiveState } from '@/lib/aqte-display';

type Execution = {
  id: string; at: number; trading_symbol: string; side: string; quantity: number; filled: number;
  net_pnl: number | null; return_pct: number | null; status_name: string; status_reason: string | null;
  strategy_name: string; entry_engine: string; reason: string; supporting_engines: string[];
  entry_id: string | null; exit_at: number | null;
};
type History = { rows: Execution[]; total: number; offset: number; limit: number; generated_at: number };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nullableNumber = (value: unknown) => value === null || finite(value);
const nullableText = (value: unknown) => value === null || typeof value === 'string';
const count = (value: unknown): value is number => finite(value) && Number.isInteger(value) && value >= 0;
export const isExecutionHistory = (value: unknown): value is History =>
  object(value) && finite(value.generated_at) && count(value.total) && count(value.offset) &&
  count(value.limit) && value.limit > 0 && Array.isArray(value.rows) && value.rows.length <= value.limit &&
  value.rows.every((row: unknown) => object(row) && finite(row.at) && row.at > 0 &&
    ['id', 'trading_symbol', 'side', 'status_name', 'strategy_name', 'entry_engine', 'reason']
      .every(key => typeof row[key] === 'string' && row[key] !== '') &&
    count(row.quantity) && count(row.filled) && row.filled <= row.quantity &&
    nullableNumber(row.net_pnl) && nullableNumber(row.return_pct) && nullableNumber(row.exit_at) &&
    nullableText(row.entry_id) && nullableText(row.status_reason) && Array.isArray(row.supporting_engines) &&
    row.supporting_engines.every(name => typeof name === 'string'));

const date = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'short', day: '2-digit' });
const clock = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit',
  second: '2-digit', hourCycle: 'h23' });
const headers = () => ({ 'X-Device-Id': getOrCreateVisitorId(), 'X-AQTE-Intent': 'manual-live-control' });
const tone = (value: number | null) => value == null || value === 0 ? '' : value > 0 ? 'aqx-buy' : 'aqx-sell';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function responseError(response: Response, fallback: string): Promise<never> {
  if (response.status === 401) notifyAppAccessExpired();
  const body: unknown = await response.json();
  throw new Error(object(body) && typeof body.detail === 'string' ? body.detail : fallback);
}

export default function AQTEExecutionHistory({ liveStatus, now = Date.now() / 1000 }: {
  liveStatus: AQTELiveState | null; now?: number;
}) {
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [offset, setOffset] = useState(0);
  const [month, setMonth] = useState(aqteIstDay(now).slice(0, 7));
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const downloadRequest = useRef<AbortController | null>(null);
  const limit = expanded ? 25 : 4;
  const istDay = aqteIstDay(now);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    const poll = async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 15000);
      try {
        const dayFilter = expanded ? '' : `&day=${encodeURIComponent(istDay)}`;
        const response = await fetch(API_CONFIG.endpoint(`/api/aqte/live/executions?limit=${limit}&offset=${offset}${dayFilter}`), {
          cache: 'no-store', credentials: 'include', headers: headers(), signal: controller.signal,
        });
        if (!response.ok) await responseError(response, 'Saved execution history unavailable');
        const body: unknown = await response.json();
        if (!isExecutionHistory(body) || body.offset !== offset || body.limit !== limit) {
          throw new Error('Invalid execution history response');
        }
        if (active) { setHistory(body); setError(null); }
      } catch (cause) {
        if (active) setError(aqteErrorText(cause, 'Saved execution history unavailable'));
      } finally {
        clearTimeout(timeout);
      }
    };
    const stop = aqtePollLoop(poll);
    return () => { active = false; controller?.abort(); downloadRequest.current?.abort(); stop(); };
  }, [expanded, istDay, limit, offset]);

  const download = async () => {
    if (downloading) return;
    if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month)) {
      setDownloadError('Choose a valid Excel month (YYYY-MM)');
      return;
    }
    setDownloading(true);
    setDownloadError(null);
    const controller = new AbortController();
    downloadRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(API_CONFIG.endpoint(`/api/aqte/live/executions/export?month=${encodeURIComponent(month)}`), {
        cache: 'no-store', credentials: 'include', headers: headers(), signal: controller.signal,
      });
      if (!response.ok) await responseError(response, 'Excel download failed');
      if (!response.headers.get('content-type')?.startsWith(XLSX_TYPE)) throw new Error('Server did not return an Excel workbook');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      try {
        link.href = url;
        link.download = `AQTE-Executions-${month}.xlsx`;
        document.body.appendChild(link);
        link.click();
      } finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (cause) {
      setDownloadError(aqteErrorText(cause, 'Excel download failed; saved history has not been deleted'));
    } finally {
      clearTimeout(timeout);
      downloadRequest.current = null;
      setDownloading(false);
    }
  };
  const metrics = aqteLiveMetrics(liveStatus, now);
  const shown = history?.offset === offset && history.limit === limit ? history : null;
  const page = (next: number) => { setOffset(next); setError(null); };
  return (
    <section className={`aqx-card aqx-panel${expanded ? ' aqx-history-expanded' : ''}`} aria-label="Recent executions">
      <h3 className="aqx-panel-head"><span aria-hidden="true" className="aqx-net">&#8635;</span>
        {expanded ? 'Execution History' : "Today's Executions"} <span>(Saved)</span>
        <button type="button" className="aqx-link aqx-viewonly" disabled={downloading} aria-expanded={expanded}
          onClick={() => { setExpanded(!expanded); page(0); }}>{expanded ? 'Show Today' : 'View All'}</button>
      </h3>
      {error && <p role="alert" className="aqx-warning">{error}{shown ? ' - Showing last downloaded history.' : ''}</p>}
      <div className="aqx-history-scroll" role="region" aria-label="Saved execution orders" tabIndex={0}>
        <table className="aqx-mini-table aqx-exec-table">
          <thead><tr><th>Time (IST)</th><th>Instrument</th><th>Side</th><th>Qty</th>
            <th>P&amp;L (&#8377;)</th><th>P&amp;L %</th><th>Status</th><th>Strategy / Entry Reason</th></tr></thead>
          <tbody>
            {shown?.rows.length ? shown.rows.map(row => {
              const open = row.id === liveStatus?.active?.id && row.exit_at === null;
              const pnl = open ? metrics?.net_pnl ?? null : row.net_pnl;
              const pct = open ? metrics?.return_pct ?? null : row.return_pct;
              return <tr key={row.id}>
                <td><time dateTime={new Date(row.at * 1000).toISOString()}>{date.format(row.at * 1000)}
                  <small>{clock.format(row.at * 1000)}</small></time></td>
                <td title={row.entry_id ? `Broker order ${row.entry_id}` : 'Broker order ID not recorded'}>{row.trading_symbol}</td>
                <td><span className="aqx-side-chip aqx-chip-ce">{row.side}</span></td>
                <td title="Broker-filled / requested quantity">{row.filled}{row.filled !== row.quantity ? ` / ${row.quantity}` : ''}</td>
                <td className={tone(pnl)}>{aqteSigned(pnl)}</td>
                <td className={tone(pct)}>{pct == null ? '--' : `${aqteSigned(pct)}%`}</td>
                <td title={row.status_reason ?? 'Last saved broker status'}><span className="aqx-status-chip">{row.status_name}</span></td>
                <td className="aqx-execution-reason">
                  <strong>{row.strategy_name}</strong><small>{row.entry_engine}</small>
                  <details><summary>Entry reason</summary><p>{row.reason}</p>
                    {!!row.supporting_engines.length && <p>Supporting engines (advisory): {row.supporting_engines.join(', ')}</p>}
                  </details>
                </td>
              </tr>;
            }) : <tr><td colSpan={8} className="aqx-empty-row">{error ? 'Saved execution history unavailable'
              : shown ? 'No AQTE executions recorded' : 'Loading saved executions...'}</td></tr>}
          </tbody>
        </table>
      </div>
      {expanded && shown && <div className="aqx-history-tools">
        <button type="button" className="aqx-link aqx-viewonly" disabled={downloading || offset === 0}
          onClick={() => page(Math.max(0, offset - limit))}>Previous</button>
        <span>{shown.total ? offset + 1 : 0}-{offset + shown.rows.length} of {shown.total}</span>
        <button type="button" className="aqx-link aqx-viewonly" disabled={downloading || offset + shown.rows.length >= shown.total}
          onClick={() => page(offset + limit)}>Next</button>
      </div>}
      <div className="aqx-history-tools">
        <label>Excel month (IST) <input aria-label="Excel month (IST)" type="month" value={month} disabled={downloading}
          onChange={event => { setMonth(event.target.value); setDownloadError(null); }} /></label>
        <button type="button" className="aqx-link aqx-viewonly" onClick={download} disabled={downloading || !month}>
          {downloading ? 'Preparing Excel...' : 'Download Excel'}
        </button>
      </div>
      {downloadError && <p role="alert" className="aqx-warning">{downloadError}</p>}
      <p className="aqx-footnote">Recent view shows today&apos;s executions only; View All retains the full journal. Excel uses the selected entry month (IST).
        No monthly deletion. Net P&amp;L uses estimated charges; P&amp;L % excludes fees.
        Open/unverified values may be unavailable.</p>
    </section>
  );
}
