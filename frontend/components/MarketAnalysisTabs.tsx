'use client';

import { useState, type ReactNode } from 'react';
import styles from './MarketAnalysisTabs.module.css';

const SECTIONS = [
  { id: 'smc', label: 'SMC & Structure' },
  { id: 'greeks', label: 'Greeks Overview' },
  { id: 'regime', label: "Today's Market Regime" },
  { id: 'volume', label: 'Volume Pulse' },
  { id: 'ict', label: 'ICT Bias' },
  { id: 'compass', label: 'Institutional Compass' },
] as const;

type SectionId = typeof SECTIONS[number]['id'];

const STRATEGIES = [
  { id: 'edge', label: 'MarketEdge Intelligence' },
  { id: 'trend', label: 'Trend Base (Higher-Low Structure)' },
  { id: 'expiry', label: 'Expiry Explosion Zone' },
  { id: 'btst', label: 'CRT-Based BTST Strategies' },
] as const;
type StrategyId = typeof STRATEGIES[number]['id'];
type Props =
  | { variant?: 'analysis'; sections: Record<SectionId, ReactNode> }
  | { variant: 'strategy'; sections: Record<StrategyId, ReactNode> };

export default function MarketAnalysisTabs(props: Props) {
  const strategy = props.variant === 'strategy';
  const items = strategy ? STRATEGIES : SECTIONS;
  const prefix = strategy ? 'market-strategy' : 'market-analysis';
  const title = strategy ? 'Strategy Workspace' : 'Market Analysis';
  const sections: Partial<Record<SectionId | StrategyId, ReactNode>> = props.sections;
  const [activeSection, setActiveSection] = useState<SectionId | StrategyId>(strategy ? 'edge' : 'smc');

  return (
    <section className={styles.workspace} aria-label={strategy ? 'Market strategy workspace' : 'Market analysis workspace'}
      data-layout={strategy ? 'strategy' : 'analysis'}>
      <header className={styles.header}>
        <h2>{title}</h2>
        <p>{strategy ? 'Market edge, trend structure, expiry setups and BTST strategies in one workspace.'
          : 'Structure, Greeks, regime, volume and institutional context in one workspace.'}</p>
      </header>
      <div className={styles.tabs} role="tablist" aria-label={strategy ? 'Market strategy section' : 'Market analysis section'}>
        {items.map((section, index) => (
          <button
            key={section.id}
            type="button"
            id={`${prefix}-tab-${section.id}`}
            role="tab"
            aria-selected={activeSection === section.id}
            aria-controls={`${prefix}-panel-${section.id}`}
            tabIndex={activeSection === section.id ? 0 : -1}
            onClick={() => setActiveSection(section.id)}
            onKeyDown={event => {
              let next: number;
              switch (event.key) {
                case 'ArrowRight': next = (index + 1) % items.length; break;
                case 'ArrowLeft': next = (index + items.length - 1) % items.length; break;
                case 'Home': next = 0; break;
                case 'End': next = items.length - 1; break;
                default: return;
              }
              event.preventDefault();
              setActiveSection(items[next].id);
              document.getElementById(`${prefix}-tab-${items[next].id}`)?.focus();
            }}
          >{section.label}</button>
        ))}
      </div>
      {/* Preserve live subscriptions and nested index selections when switching sections. */}
      {items.map(section => (
        <div
          key={section.id}
          id={`${prefix}-panel-${section.id}`}
          role="tabpanel"
          aria-labelledby={`${prefix}-tab-${section.id}`}
          hidden={activeSection !== section.id}
          tabIndex={0}
          className={styles.panel}
        >
          {sections[section.id]}
        </div>
      ))}
    </section>
  );
}
