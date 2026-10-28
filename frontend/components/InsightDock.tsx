'use client';

import { Children, type ReactNode } from 'react';
import styles from './InsightDock.module.css';

/**
 * One-row strip of signal / level cards above a chart, so the chart keeps the full width.
 * Cards share the row on wide screens and become a swipeable carousel when they no longer fit.
 */
export default function InsightDock({ title = 'Signals & levels', lead, children }: { title?: string; lead?: ReactNode; children?: ReactNode }) {
  const items = Children.toArray(children).filter(Boolean);
  if (!items.length && !lead) return null;
  return <div className={styles.stack}>
    {lead && <div className={styles.lead}>{lead}</div>}
    {items.length > 0 && <Dock title={title} items={items} />}
  </div>;
}

function Dock({ title, items }: { title: string; items: ReactNode[] }) {
  return <details className={styles.dock} open>
    <summary className={styles.summary}>
      <span>{title}</span>{items.length > 1 && <small>{items.length} panels · swipe or scroll →</small>}
    </summary>
    <div className={styles.track} data-single={items.length === 1 || undefined} style={{ ['--cards' as string]: items.length }}>
      {items.map((item, index) => <div key={index} className={styles.slot}>{item}</div>)}
    </div>
  </details>;
}
