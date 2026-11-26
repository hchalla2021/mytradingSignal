'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity, BarChart3, ChevronRight, CircleDot, Database, Globe2, Gavel, Layers3,
  Newspaper, ShieldCheck, Star, TrendingUp, type LucideIcon,
} from 'lucide-react';
import { getOrCreateVisitorId } from '@/lib/visitor-id';
import styles from './OpeningEdgeSection.module.css';

type Cue = {
  status: 'LIVE' | 'RECENT' | 'LAST' | 'STALE' | 'FROZEN' | 'UNAVAILABLE';
  value: number | string | null;
  change_percent: number | null;
  detail: string;
  kind?: 'opening_gap';
};
type Snapshot = {
  zerodha_session: boolean;
  feed_enabled: boolean;
  feed_status: string;
  feed_error: string | null;
  context: Record<string, Cue>;
  snapshot_error: string | null;
};

const fmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fxFmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const display = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? fmt.format(value) : '—';

type Country = 'us' | 'gb' | 'de' | 'fr' | 'jp' | 'hk' | 'cn' | 'au' | 'in';
type ContextRow = [string, string, LucideIcon, string, Country?];
const contextGroups: { name: string; icon: Country | 'globe' | 'news'; preview?: string; rows: ContextRow[] }[] = [
  { name: 'USA', icon: 'us', preview: 'us500', rows: [
    ['us500', 'US 500', BarChart3, 'Waiting for Zerodha global data.', 'us'],
    ['us100', 'US 100', BarChart3, 'Waiting for Zerodha global data.', 'us'],
    ['uscomposite', 'US Composite', BarChart3, 'Waiting for Zerodha global data.', 'us'],
    ['us30', 'US 30', BarChart3, 'Waiting for Zerodha global data.', 'us'],
    ['us10yr', 'US 10-year yield', Activity, 'Waiting for Zerodha global data.', 'us'],
    ['us_vix', 'VIX (US daily close)', ShieldCheck, 'Waiting for the prior daily close.', 'us'],
  ] },
  { name: 'Europe', icon: 'globe', preview: 'uk100', rows: [
    ['uk100', 'UK 100', BarChart3, 'Waiting for Zerodha global data.', 'gb'],
    ['germany40', 'Germany 40', BarChart3, 'Waiting for Zerodha global data.', 'de'],
    ['france40', 'France 40', BarChart3, 'Waiting for Zerodha global data.', 'fr'],
  ] },
  { name: 'Asia Pacific', icon: 'globe', preview: 'japan225', rows: [
    ['japan225', 'Japan 225', TrendingUp, 'Waiting for Zerodha global data.', 'jp'],
    ['hangseng', 'Hang Seng', TrendingUp, 'Waiting for Zerodha global data.', 'hk'],
    ['shanghai', 'Shanghai China', TrendingUp, 'Waiting for Zerodha global data.', 'cn'],
    ['aus200', 'Australia 200', TrendingUp, 'Waiting for Zerodha global data.', 'au'],
  ] },
  { name: 'India & Pre-Open', icon: 'in', preview: 'gift', rows: [
    ['gift', 'GIFT NIFTY', Globe2, 'Waiting for Zerodha NSEIX data.'],
    ['india_vix', 'India VIX', ShieldCheck, 'Waiting for Zerodha India VIX data.'],
    ['gold', 'MCX Gold future', Star, 'Waiting for Zerodha MCX data.'],
    ['usdinr', 'USD/INR future', CircleDot, 'Waiting for Zerodha currency data.'],
    ['nifty_future', 'NIFTY Futures', Layers3, 'Waiting for Zerodha futures data.'],
    ['bank_future', 'BANK NIFTY Futures', Layers3, 'Waiting for Zerodha futures data.'],
    ['auction_gap', 'Pre-open gap (NIFTY)', Gavel, 'Waiting for complete pre-open data.'],
    ['breadth', 'Breadth (10-stock proxy)', BarChart3, 'Waiting for the selected stock basket.'],
    ['heavyweights', 'Stocks (equal-weight)', Star, 'Waiting for the selected stock basket.'],
    ['pcr', 'NIFTY OI PCR (5 strikes)', Database, 'Waiting for NIFTY options data.'],
    ['iv', 'NIFTY ATM IV (estimate)', Activity, 'Waiting for a two-sided ATM option market.'],
  ] },
  { name: 'News', icon: 'news', rows: [
    ['news', 'News tone (India sample)', Newspaper, 'Waiting for the configured news sample.'],
  ] },
];
const percentCues = new Set(['auction_gap', 'heavyweights', 'iv']);
const signedValueCues = new Set(['auction_gap', 'heavyweights']);
const changeClass = (value: number | null | undefined) =>
  typeof value !== 'number' || !Number.isFinite(value) || value === 0
    ? styles.muted : value > 0 ? styles.positive : styles.negative;

const flagNames: Record<Country, string> = {
  us: 'United States', gb: 'United Kingdom', de: 'Germany', fr: 'France', jp: 'Japan',
  hk: 'Hong Kong', cn: 'China', au: 'Australia', in: 'India',
};
const flagArt: Record<Country, React.ReactNode> = {
  us: <><rect width="30" height="20" fill="#fff" /><path d="M0 1.5h30M0 4.5h30M0 7.5h30M0 10.5h30M0 13.5h30M0 16.5h30M0 19.5h30" stroke="#b22234" strokeWidth="1.5" /><rect width="13" height="10" fill="#3c3b6e" /></>,
  gb: <><rect width="30" height="20" fill="#012169" /><path d="M0 0l30 20M30 0L0 20" stroke="#fff" strokeWidth="4" /><path d="M0 0l30 20M30 0L0 20" stroke="#c8102e" strokeWidth="1.7" /><path d="M15 0v20M0 10h30" stroke="#fff" strokeWidth="6" /><path d="M15 0v20M0 10h30" stroke="#c8102e" strokeWidth="3" /></>,
  de: <><rect width="30" height="20" fill="#ffce00" /><path d="M0 0h30v7H0z" fill="#111" /><path d="M0 7h30v6H0z" fill="#d00" /></>,
  fr: <><rect width="30" height="20" fill="#fff" /><path d="M0 0h10v20H0z" fill="#002395" /><path d="M20 0h10v20H20z" fill="#ed2939" /></>,
  jp: <><rect width="30" height="20" fill="#fff" /><circle cx="15" cy="10" r="5.5" fill="#bc002d" /></>,
  hk: <><rect width="30" height="20" fill="#de2910" /><circle cx="15" cy="10" r="5" fill="#fff" /></>,
  cn: <><rect width="30" height="20" fill="#de2910" /><path d="M6 2l1.2 3.2h3.4L8 7.2l1 3.2L6 8.5l-3 1.9 1-3.2-2.6-2h3.4z" fill="#ffde00" /></>,
  au: <><rect width="30" height="20" fill="#012169" /><path d="M0 0l13 9M13 0L0 9" stroke="#fff" strokeWidth="2" /><path d="M6.5 0v9M0 4.5h13" stroke="#fff" strokeWidth="3" /></>,
  in: <><rect width="30" height="20" fill="#fff" /><path d="M0 0h30v6.7H0z" fill="#ff9933" /><path d="M0 13.3h30V20H0z" fill="#138808" /><circle cx="15" cy="10" r="2.2" fill="none" stroke="#000080" strokeWidth=".7" /></>,
};

function CountryFlag({ country }: { country: Country }) {
  return <svg className={styles.countryFlag} viewBox="0 0 30 20" role="img" aria-label={flagNames[country]}>{flagArt[country]}</svg>;
}

async function requestStatus(): Promise<Snapshot> {
  const response = await fetch('/openingedge-api/api/status', {
    method: 'GET', cache: 'no-store', credentials: 'same-origin',
    headers: { 'X-Device-Id': getOrCreateVisitorId() },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { detail?: unknown } | null;
    throw new Error(typeof error?.detail === 'string' ? error.detail : `Global cues unavailable (${response.status}).`);
  }
  return response.json() as Promise<Snapshot>;
}

export default function OpeningEdgeSection() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      setSnapshot(await requestStatus());
      setError('');
    } catch (reason) {
      setSnapshot(null);
      setError(reason instanceof Error ? reason.message : 'Global cues unavailable.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const poll = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(poll);
  }, [refresh]);

  return (
    <section aria-label="Global and Pre-Open Intelligence" className={styles.shell}>
      <div className={styles.globalDashboard}>
        <aside className={styles.context}>
          <h3><Globe2 aria-hidden="true" /> Global &amp; Pre-Open Intelligence</h3>
          <div className={styles.contextList}>{contextGroups.map(group => {
            const preview = group.preview ? snapshot?.context?.[group.preview] : undefined;
            const previewLabel = group.rows.find(row => row[0] === group.preview)?.[1];
            return <details key={group.name} className={styles.contextGroup}>
              <summary className={styles.groupSummary}>
                {group.icon === 'globe' ? <Globe2 className={styles.groupIcon} aria-hidden="true" />
                  : group.icon === 'news' ? <Newspaper className={styles.groupIcon} aria-hidden="true" />
                    : <CountryFlag country={group.icon} />}
                <strong>{group.name}</strong>
                {previewLabel && <span className={styles.groupPreview}>
                  <span className={styles.groupPreviewLabel}>{previewLabel}</span>
                  <b className={`${styles.groupPreviewChange} ${changeClass(preview?.change_percent)}`}>
                    {preview?.change_percent != null && Number.isFinite(preview.change_percent)
                      ? `${preview.change_percent > 0 ? '+' : ''}${display(preview.change_percent)}%` : '—'}
                  </b>
                  <span className={`${styles.contextBadge} ${styles.groupPreviewBadge}`}>{preview?.status || 'UNAVAILABLE'}</span>
                </span>}
                <ChevronRight className={styles.groupChevron} aria-hidden="true" />
              </summary>
              <div className={styles.groupRows}>
                <div className={styles.contextColumns} aria-hidden="true">
                  <span /><span>Market</span><span>Value</span><span>Change</span><span>Status</span>
                </div>
                {group.rows.map(([key, label, Icon, fallback, flag]) => {
                  const cue = snapshot?.context?.[key];
                  const value = typeof cue?.value === 'number'
                    ? Number.isFinite(cue.value)
                      ? `${key === 'usdinr' ? fxFmt.format(cue.value) : display(cue.value)}${percentCues.has(key) ? '%' : ''}`
                      : '—'
                    : cue?.value ?? '—';
                  const rowLabel = key === 'auction_gap' && cue?.kind === 'opening_gap'
                    ? 'Last opening gap (NIFTY)' : label;
                  return <details key={key} className={styles.contextDetails}>
                    <summary className={styles.contextRow}>
                      {flag ? <CountryFlag country={flag} /> : <Icon aria-hidden="true" />}
                      <span className={styles.contextLabel}>{rowLabel}</span>
                      <span className={`${styles.contextValue} ${signedValueCues.has(key) && typeof cue?.value === 'number' ? changeClass(cue.value) : ''}`}>{value}</span>
                      <span className={`${styles.contextChange} ${changeClass(cue?.change_percent)}`}>
                        {cue?.change_percent != null && Number.isFinite(cue.change_percent)
                          ? `${cue.change_percent > 0 ? '+' : ''}${display(cue.change_percent)}%` : '—'}
                      </span>
                      <span className={styles.contextBadge}>{cue?.status || 'UNAVAILABLE'}</span>
                    </summary>
                    {key === 'us_vix' && cue?.value != null && <p className={styles.cueSource}>
                      CBOE via <a href="https://fred.stlouisfed.org/series/VIXCLS" target="_blank" rel="noreferrer">FRED</a> · Copyright 2016 CBOE
                    </p>}
                    {key === 'news' && cue?.value != null && <p className={styles.cueSource}>
                      Source: <a href="https://www.marketaux.com/" target="_blank" rel="noreferrer">Marketaux</a>
                    </p>}
                    <p>{cue?.detail || fallback} Display only; not used for trading.</p>
                  </details>;
                })}
              </div>
            </details>;
          })}</div>
        </aside>
      </div>
      {(error || snapshot?.snapshot_error) && <p role="status" className={styles.alert}>
        {error || snapshot?.snapshot_error}
      </p>}
    </section>
  );
}
