'use client';

import type { ReactNode } from 'react';
import styles from './MarketAnalysisTabs.module.css';

export default function MarketAnalysisTabs({ section }: { section: ReactNode }) {
  return (
    <section className={styles.workspace} aria-label="Market analysis workspace" data-layout="analysis">
      <header className={styles.header}>
        <h2>Market Analysis</h2>
        <p>Live market regime and directional context.</p>
      </header>
      <div className={styles.tabs} role="tablist" aria-label="Market analysis section">
        <button
          type="button"
          id="market-analysis-tab-regime"
          role="tab"
          aria-selected="true"
          aria-controls="market-analysis-panel-regime"
          tabIndex={0}
        >
          Today&apos;s Market Regime
        </button>
      </div>
      <div
        id="market-analysis-panel-regime"
        role="tabpanel"
        aria-labelledby="market-analysis-tab-regime"
        tabIndex={0}
        className={styles.panel}
      >
        {section}
      </div>
    </section>
  );
}
