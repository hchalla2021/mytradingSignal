'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { IndexTabList, type IndexSymbol } from '@/components/IndexTabs';
import type { InstitutionalFlowView } from '@/components/FIIDIIFlowStrip';
import type { MarketTick } from '@/hooks/useMarketSocket';
import type { FIIDIISnapshot } from '@/hooks/useFIIDIIFlow';
import styles from './InstitutionalWorkspace.module.css';

const SmartAIAlgoSection = dynamic(() => import('@/components/SmartAIAlgoSection'), {
  ssr: false,
  loading: () => <p className="p-4 text-sm text-slate-400" role="status">Loading Smart AI Algo…</p>,
});
const FIIDIIFlowStrip = dynamic(() => import('@/components/FIIDIIFlowStrip'), {
  ssr: false,
  loading: () => <p className="p-4 text-sm text-slate-400" role="status">Loading institutional flow…</p>,
});

const FEATURES = [
  { id: 'algo', label: 'Smart AI Algo' },
  { id: 'radar', label: 'Big Player Radar' },
  { id: 'flow', label: 'FII/DII Flow' },
  { id: 'official', label: 'Official Cash Flow' },
] as const;
type Feature = typeof FEATURES[number]['id'];

interface InstitutionalWorkspaceProps {
  marketData: Record<IndexSymbol, MarketTick | null>;
  isConnected: boolean;
  onSnapshot: (snapshot: FIIDIISnapshot | null) => void;
}

export default function InstitutionalWorkspace({ marketData, isConnected, onSnapshot }: InstitutionalWorkspaceProps) {
  const [symbol, setSymbol] = useState<IndexSymbol>('NIFTY');
  const [feature, setFeature] = useState<Feature>('algo');
  const flowView: InstitutionalFlowView = feature === 'algo' ? 'flow' : feature;

  return (
    <section className={styles.workspace} aria-label="Smart AI and institutional intelligence">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>MARKET INTELLIGENCE</p>
          <h2>Smart AI &amp; Institutional Flow</h2>
          <p className={styles.description}>One workspace for algo signals, large-player activity and institutional flows.</p>
        </div>
        <span className={styles.scope}>{feature === 'official' ? 'Market-wide cash activity' : `${symbol} workspace`}</span>
      </header>
      <div hidden={feature === 'official'}>
        <IndexTabList
          idPrefix="institutional-index"
          label="Institutional workspace index"
          activeSymbol={symbol}
          onSelect={setSymbol}
          panelId="institutional-index-content"
        />
      </div>
      <div id="institutional-index-content" role={feature === 'official' ? undefined : 'tabpanel'}
        aria-labelledby={feature === 'official' ? undefined : `institutional-index-tab-${symbol}`} tabIndex={0}>
        <div className={styles.features} role="tablist" aria-label="Institutional intelligence view">
          {FEATURES.map((item, index) => (
            <button
              key={item.id} type="button" role="tab"
              id={`institutional-feature-${item.id}`}
              aria-selected={feature === item.id}
              aria-controls={`institutional-content-${item.id}`}
              tabIndex={feature === item.id ? 0 : -1}
              onClick={() => setFeature(item.id)}
              onKeyDown={event => {
                let next: number;
                switch (event.key) {
                  case 'ArrowRight': next = (index + 1) % FEATURES.length; break;
                  case 'ArrowLeft': next = (index + FEATURES.length - 1) % FEATURES.length; break;
                  case 'Home': next = 0; break;
                  case 'End': next = FEATURES.length - 1; break;
                  default: return;
                }
                event.preventDefault();
                setFeature(FEATURES[next].id);
                document.getElementById(`institutional-feature-${FEATURES[next].id}`)?.focus();
              }}
            >{item.label}</button>
          ))}
        </div>
        <div id="institutional-content-algo" role="tabpanel" aria-labelledby="institutional-feature-algo"
          hidden={feature !== 'algo'} tabIndex={0} className={styles.content}>
          <SmartAIAlgoSection selectedSymbol={symbol} />
        </div>
        {/* One mounted flow provider keeps snapshots and chart context alive across all feature tabs. */}
        <div className={styles.content} hidden={feature === 'algo'}
          id={`institutional-content-${flowView}`} role="tabpanel"
          aria-labelledby={`institutional-feature-${flowView}`} tabIndex={0}>
          <p className={styles.description}>
            {flowView === 'official' ? 'Reported market-wide cash flow · date shown is the reporting date.'
              : `${symbol} · ${flowView === 'radar' ? 'Detected large prints; not participant identification.' : 'Inferred pressure, not official per-index transactions.'}`}
          </p>
          <FIIDIIFlowStrip marketData={marketData} isConnected={isConnected} onSnapshot={onSnapshot}
            selectedSymbol={symbol} activeView={flowView} />
        </div>
          {FEATURES.filter(item => item.id !== 'algo' && item.id !== flowView).map(item => (
            <div key={item.id} id={`institutional-content-${item.id}`} role="tabpanel"
              aria-labelledby={`institutional-feature-${item.id}`} hidden />
          ))}
      </div>
    </section>
  );
}
