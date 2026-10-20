'use client';

import { memo } from 'react';
import { compactVolume } from '@/lib/order-flow';
import type { OrderFlowState } from '@/hooks/useOrderFlow';

const COLORS = { BUY: '#00d39b', SELL: '#ff4d5e', WAIT: '#ffcf4a' } as const;

/** Single-line order-flow status for a chart heading: action, plan, flow stats and paper replay. */
function OrderFlowReadout({ state, intraday, label = 'Order flow' }: { state: OrderFlowState; intraday: boolean; label?: string }) {
  if (!intraday) return <span className="text-slate-400">{label}: intraday intervals only</span>;
  const snapshot = state.snapshot;
  if (!snapshot) return <span className="text-slate-400">{label}: {state.error ?? 'connecting...'}</span>;
  if (!snapshot.available) return <span className="text-slate-400" title={`${snapshot.reason ?? ''}\nBuy / Sell Order Flow labels on the chart are inferred from candle range, wicks and volume (estimate, not tick data).`}>{label}: candle-estimated (no tick flow recorded yet)</span>;
  const { guidance, summary, replay } = snapshot;
  const plan = guidance.action !== 'WAIT' && guidance.entry !== undefined
    ? ` @ ${(guidance.fill ?? guidance.entry).toFixed(1)} · SL ${(guidance.stopNow ?? guidance.stop)?.toFixed(1)} · T1 ${guidance.t1?.toFixed(1)} · T2 ${guidance.t2?.toFixed(1)} · score ${guidance.confidence}`
    : '';
  const title = [
    ...guidance.reasons,
    `Trade side estimated with ${snapshot.method || 'quote/tick rule'} on Zerodha full-mode snapshots (~1/s); not exchange aggressor flags.`,
    `Coverage ${(summary.coverage * 100).toFixed(0)}% of last bar volume classified; the rest is unattributed.`,
    'Score is a rule score (0-100), not a probability. Paper replay only: no orders are placed.',
  ].join('\n');
  return <span title={title} style={{ fontVariantNumeric: 'tabular-nums' }}>
    {label}{' '}
    <b style={{ color: COLORS[guidance.action] }}>{guidance.action}</b>{plan}
    {guidance.reasons[0] ? ` · ${guidance.reasons[0]}` : ''}
    {' · '}Δ <span style={{ color: summary.delta >= 0 ? COLORS.BUY : COLORS.SELL }}>{summary.delta >= 0 ? '+' : ''}{compactVolume(summary.delta)}</span>
    {' · '}CVD {compactVolume(summary.cvd)}
    {summary.book !== null ? ` · Book ${summary.book.toFixed(2)}x` : ''}
    {replay && replay.trades > 0 ? ` · Paper ${replay.trades} trades, win ${Math.round((replay.winRate ?? 0) * 100)}%, net ${replay.lotSize ? `₹${Math.round(replay.net).toLocaleString('en-IN')}` : `${replay.net} pts`} after fees` : ''}
    <span className="text-slate-500"> · est. side{state.live ? ' · live' : ''}</span>
  </span>;
}

export default memo(OrderFlowReadout);
