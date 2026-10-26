'use client';

import { memo } from 'react';
import type { ProState } from '@/hooks/useProConfluence';
import { clock } from '@/lib/pro-confluence';
import styles from './ProSignal.module.css';

const num = (value: number | undefined) => value === undefined ? '—' : value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The pre-trade checklist every chart shows. BUY / SELL only when every check passes on a closed 5m futures candle
 * with a live feed; otherwise WAIT with exactly which checks are missing.
 */
const ProSignalPanel = memo(function ProSignalPanel({ pro, open: expanded = false }: { pro: ProState; open?: boolean }) {
  const { decision, replay, open, contract } = pro;
  const verdict = replay?.verdict ?? null;
  const stats = replay?.stats;
  const tone = decision.stage === 'ENTRY' ? (decision.action === 'BUY' ? styles.buy : styles.sell) : decision.stage === 'HOLD' ? styles.hold : styles.wait;
  const share = verdict ? Math.round((verdict.passed / verdict.total) * 100) : 0;
  const plan = open ?? null;
  const description = `${contract?.tradingSymbol ?? pro.symbol} futures · 5m closed candles`;

  return <details className={`${styles.panel} ${tone}`} open={expanded} aria-label="Pro confirmation gate">
    <summary className={styles.summary} title="Click to see every check">
      <span className={styles.title}>PRO GATE · {description}</span>
      <span className={styles.action} role="status" aria-live="polite">{decision.headline}</span>
      {verdict && <span className={styles.count}>{verdict.passed}/{verdict.total} checks
        <span className={styles.meter} aria-hidden="true"><i style={{ width: `${share}%` }} /></span></span>}
      <span className={styles.reason}>{decision.reason}{pro.error ? ` · ${pro.error}` : ''}</span>
      {stats && <span className={styles.record} title="Today's confirmed signals replayed on closed candles: half booked at T1 (stop to breakeven), rest at T2 or 15:15.">
        Today {stats.signals} signal{stats.signals === 1 ? '' : 's'} · {stats.wins}W {stats.losses}L ·{' '}
        <b className={stats.points >= 0 ? styles.pos : styles.neg}>{stats.points >= 0 ? '+' : ''}{stats.points.toFixed(1)} pts</b></span>}
    </summary>
    <div className={styles.body}>
      {verdict && <ul className={styles.checks} aria-label={`Checks for ${verdict.side ?? 'no side'} on the ${clock(verdict.time)} candle`}>
        {verdict.checks.map(check => <li key={check.id} className={check.pass ? styles.ok : styles.ko} title={check.detail}>
          <b>{check.pass ? '✔' : '✘'}</b><span>{check.label} — {check.detail}</span></li>)}
      </ul>}
      {plan && <div className={styles.plan}>
        <span><small>{plan.side} {plan.entryTime === null ? 'at next open ≈' : 'entry'}</small>{num(plan.entry)}</span>
        <span className={styles.neg}><small>SL</small>{num(plan.t1Hit ? plan.entry : plan.stop)}{plan.t1Hit ? ' (breakeven)' : ''}</span>
        <span className={styles.pos}><small>T1</small>{num(plan.t1)}{plan.t1Hit ? ' ✔' : ''}</span>
        <span className={styles.pos}><small>T2</small>{num(plan.t2)}</span>
      </div>}
      <p className={styles.note}>
        BUY / SELL appears only when ALL checks pass on a closed 5m near-month futures candle with a live feed — trend (EMA stack, VWAP,
        15m &amp; 60m), candle, recorded order-flow delta and CVD, open interest, stretch, stop size, room to target, confluence score and
        no sudden flip. Prices are futures prices. Delta side is estimated from Kite ticks. This filters weak and opposite signals; it
        cannot guarantee a win — always place the stop-loss.
      </p>
    </div>
  </details>;
});

export default ProSignalPanel;
