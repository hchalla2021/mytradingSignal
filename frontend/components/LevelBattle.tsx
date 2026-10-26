'use client';

import { memo } from 'react';
import type { LevelBattleState } from '@/hooks/useLevelBattle';
import { battleHeadline, type LevelBattle } from '@/lib/level-battle';
import { compactVolume } from '@/lib/order-flow';
import styles from './LevelBattle.module.css';

const fmt = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 2 });

function Row({ battle }: { battle: LevelBattle }) {
  const tone = battle.up >= 65 ? styles.up : battle.down >= 65 ? styles.down : styles.neutral;
  const total = battle.buy + battle.sell;
  const buyShare = total > 0 ? Math.round((battle.buy / total) * 100) : 50;
  const where = battle.state === 'AT' ? 'Price is AT this level now'
    : `${fmt(Math.abs(battle.distance))} pts ${battle.distance >= 0 ? 'below price' : 'above price'}`;
  return <details className={`${styles.row} ${tone} ${battle.state === 'AT' ? styles.at : ''}`}>
    <summary className={styles.head}>
      <span className={styles.name}>{battle.state === 'AT' ? '⚡ ' : ''}{battle.label}<small>{fmt(battle.price)} · {battle.role.toLowerCase()} · {where}</small></span>
      <span className={styles.call}>{battleHeadline(battle)}</span>
      <span className={styles.split} title="Estimated chance price moves up vs down from this level">
        <b className={styles.pos}>↑ {battle.up}%</b><i aria-hidden="true"><em style={{ width: `${battle.up}%` }} /></i><b className={styles.neg}>↓ {battle.down}%</b>
      </span>
      <span className={styles.flow}>
        {battle.flowAvailable ? <>Buyers <b className={styles.pos}>{compactVolume(battle.buy)}</b> · Sellers <b className={styles.neg}>{compactVolume(battle.sell)}</b>
          <i className={styles.bar} aria-hidden="true"><em style={{ width: `${buyShare}%` }} /></i></> : 'No recorded buyers/sellers at this level yet'}
        {battle.bookBid != null && <> · Book bids {compactVolume(battle.bookBid)} / asks {compactVolume(battle.bookAsk ?? 0)}</>}
      </span>
      <span className={styles.room}>
        {battle.above ? <>↑ {battle.above.label} <b className={styles.pos}>+{fmt(battle.above.points)}</b></> : '↑ no level above'}
        {' · '}
        {battle.below ? <>↓ {battle.below.label} <b className={styles.neg}>−{fmt(battle.below.points)}</b></> : '↓ no level below'}
      </span>
    </summary>
    <ul className={styles.factors}>
      {battle.factors.map(factor => <li key={factor.text}>
        <b className={factor.points > 0 ? styles.pos : factor.points < 0 ? styles.neg : ''}>{factor.points > 0 ? `+${factor.points}` : factor.points || '·'}</b>
        <span>{factor.text}</span></li>)}
      <li><b>·</b><span>Tests today: {battle.tests.length ? battle.tests.map(test => test.result === 'LIVE' ? 'testing now' : test.result.toLowerCase()).join(', ') : 'none'}</span></li>
    </ul>
  </details>;
}

/**
 * Who is winning at the nearest levels: buyers vs sellers traded in each level's zone, REJECT / BREAK split and
 * points to the next level. Positive factor points favour the level holding.
 */
const LevelBattlePanel = memo(function LevelBattlePanel({ state }: { state: LevelBattleState }) {
  const testing = state.active.filter(battle => battle.state === 'AT');
  const near = state.active.filter(battle => battle.state === 'NEAR');
  return <section className={`${styles.panel} ${testing.length ? styles.live : ''}`} aria-label="Level battle">
    <header className={styles.header}>
      <span className={styles.title}>LEVEL BATTLE · break or reject?</span>
      <span className={styles.status} role="status" aria-live="polite">
        {testing.length ? `⚡ Testing ${testing.map(battle => battle.label).join(', ')}`
          : near.length ? `Approaching ${near.map(battle => battle.label).join(', ')} — get ready, wait for the test`
            : state.active.length ? 'Between levels — NEUTRAL, wait for price to reach a level' : 'Levels loading…'}
      </span>
    </header>
    {state.active.map(battle => <Row key={battle.id} battle={battle} />)}
    <p className={styles.note}>
      Buyers / sellers = near-month futures volume recorded inside the level&apos;s zone today (aggressor side estimated from Kite ticks)
      {state.mapped ? '' : ' — not available for this contract, price behaviour only'}. ↑/↓ % is an estimate from that volume, the last
      15–30 min delta, earlier tests, confluence, trend and resting orders — not a certainty. Click a level for the reasons.
    </p>
  </section>;
});

export default LevelBattlePanel;
