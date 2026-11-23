'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity, BarChart3, CalendarDays, Check, ChevronRight, CircleDot, Clock3, Crosshair, Database,
  Globe2, Gavel, Layers3, LockKeyhole, Newspaper, Play, Settings2, ShieldAlert,
  ShieldCheck, Star, Tag, Target, TrendingDown, TrendingUp, Zap,
  type LucideIcon,
} from 'lucide-react';
import { getOrCreateVisitorId } from '@/lib/visitor-id';
import styles from './OpeningEdgeSection.module.css';

const SYMBOLS = ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const;
type SymbolName = typeof SYMBOLS[number];
type Config = { indices: Record<SymbolName, { lots: number; risk: number | null }>; daily_loss: number | null };
type Quote = { price: number | null; change: number | null; change_percent: number | null;
  timestamp: string | null; source_status: 'LIVE' | 'LAST' | 'UNAVAILABLE';
  preopen_complete: boolean; preopen_high: number | null; preopen_low: number | null };
type Review = { state: 'PENDING' | 'APPROVED' | 'REJECTED' | 'UNAVAILABLE'; action: 'BUY_CE' | 'BUY_PE' | 'REJECT' | null;
  confidence: number | null; reason: string };
type Cue = { status: 'LIVE' | 'RECENT' | 'LAST' | 'STALE' | 'FROZEN' | 'UNAVAILABLE'; value: number | string | null;
  change_percent: number | null; detail: string; kind?: 'opening_gap' };
type ActiveTrade = { symbol: SymbolName; contract: { tradingsymbol: string }; state: string; filled: number;
  quantity: number; entry_price: number; stop: number; target: number; ltp?: number; unrealized_pnl?: number };
type Snapshot = { stage: string; feed_enabled: boolean; feed_status: string; feed_error: string | null;
  indices: Record<SymbolName, Quote>; config: Config; reason: string; trade_enabled: boolean;
  automation_on: boolean; execution_status: 'READY' | 'LOCKED'; execution_error: string | null;
  execution_block_reason: string | null; active: ActiveTrade | null;
  reviews: Partial<Record<SymbolName, Review>>; ai_status: 'READY' | 'UNAVAILABLE'; ai_error: string | null;
  context: Record<string, Cue>; snapshot_error: string | null };

const fmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fxFmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const display = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? fmt.format(value) : '—';
const labels: Record<SymbolName, string> = { NIFTY: 'NIFTY 50', BANKNIFTY: 'BANK NIFTY', SENSEX: 'SENSEX' };
const steps = [
  ['09:00 – 09:08', 'PRE-OPEN INTELLIGENCE'],
  ['09:08 – 09:15', 'FREEZE & VALIDATE'],
  ['09:15 – 09:20', 'EXECUTION WINDOW'],
  ['09:20', 'ENTRY LOCK'],
];
type Country = 'us' | 'gb' | 'de' | 'fr' | 'jp' | 'hk' | 'cn' | 'au' | 'in';
type ContextRow = [string, string, LucideIcon, string, Country?];
const contextGroups: { name: string; icon: Country | 'globe' | 'news'; preview?: string; rows: ContextRow[] }[] = [
  { name: 'USA', icon: 'us', preview: 'us500', rows: [
    ['us500', 'US 500', BarChart3, 'Waiting for Zerodha global data.', 'us'],
    ['us100', 'US 100', BarChart3, 'Waiting for Zerodha global data.', 'us'],
    ['uscomposite', 'US Composite', BarChart3, 'Waiting for Zerodha global data.', 'us'],
    ['us30', 'US 30', BarChart3, 'Waiting for Zerodha global data.', 'us'],
    ['us10yr', 'US 10-year yield', Activity, 'Waiting for Zerodha global data.', 'us'],
    ['us_vix', 'VIX (US daily close)', ShieldCheck, 'Set OPENINGEDGE_FRED_API_KEY for the prior daily close.', 'us'],
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
    ['news', 'News tone (India sample)', Newspaper, 'Set OPENINGEDGE_MARKETAUX_API_TOKEN for a small news sample.'],
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
  us: <><rect width="30" height="20" fill="#fff" /><path d="M0 1.5h30M0 4.5h30M0 7.5h30M0 10.5h30M0 13.5h30M0 16.5h30M0 19.5h30" stroke="#b22234" strokeWidth="1.5" /><rect width="13" height="10" fill="#3c3b6e" /><path d="M2 2h1m2 0h1m2 0h1m2 0h1M3 4h1m2 0h1m2 0h1M2 6h1m2 0h1m2 0h1m2 0h1M3 8h1m2 0h1m2 0h1" stroke="#fff" strokeWidth=".7" /></>,
  gb: <><rect width="30" height="20" fill="#012169" /><path d="M0 0l30 20M30 0L0 20" stroke="#fff" strokeWidth="4" /><path d="M0 0l30 20M30 0L0 20" stroke="#c8102e" strokeWidth="1.7" /><path d="M15 0v20M0 10h30" stroke="#fff" strokeWidth="6" /><path d="M15 0v20M0 10h30" stroke="#c8102e" strokeWidth="3" /></>,
  de: <><rect width="30" height="20" fill="#ffce00" /><path d="M0 0h30v7H0z" fill="#111" /><path d="M0 7h30v6H0z" fill="#d00" /></>,
  fr: <><rect width="30" height="20" fill="#fff" /><path d="M0 0h10v20H0z" fill="#002395" /><path d="M20 0h10v20H20z" fill="#ed2939" /></>,
  jp: <><rect width="30" height="20" fill="#fff" /><circle cx="15" cy="10" r="5.5" fill="#bc002d" /></>,
  hk: <><rect width="30" height="20" fill="#de2910" /><path d="M15 3c3 2 3 4 1 6 3-1 5 0 5 3-3 1-5 0-5-2 0 3-2 5-4 4 0-3 1-4 3-4-3 1-5-1-4-3 2 0 4 0 4 3-2-2-2-5 0-7z" fill="#fff" /></>,
  cn: <><rect width="30" height="20" fill="#de2910" /><path d="M6 2l1.2 3.2h3.4L8 7.2l1 3.2L6 8.5l-3 1.9 1-3.2-2.6-2h3.4z" fill="#ffde00" /><circle cx="12" cy="3" r=".7" fill="#ffde00" /><circle cx="14" cy="5.5" r=".7" fill="#ffde00" /><circle cx="14" cy="8" r=".7" fill="#ffde00" /><circle cx="12" cy="10" r=".7" fill="#ffde00" /></>,
  au: <><rect width="30" height="20" fill="#012169" /><path d="M0 0l13 9M13 0L0 9" stroke="#fff" strokeWidth="2" /><path d="M6.5 0v9M0 4.5h13" stroke="#fff" strokeWidth="3" /><path d="M6.5 0v9M0 4.5h13" stroke="#c8102e" strokeWidth="1.4" /><path d="M8 14h2m-1-1v2m11-11h2m-1-1v2m4 5h2m-1-1v2m-7 1h2m-1-1v2m3 5h2m-1-1v2" stroke="#fff" strokeWidth="1" /></>,
  in: <><rect width="30" height="20" fill="#fff" /><path d="M0 0h30v6.7H0z" fill="#ff9933" /><path d="M0 13.3h30V20H0z" fill="#138808" /><circle cx="15" cy="10" r="2.2" fill="none" stroke="#000080" strokeWidth=".7" /><circle cx="15" cy="10" r=".6" fill="#000080" /></>,
};
function CountryFlag({ country }: { country: Country }) {
  return <svg className={styles.countryFlag} viewBox="0 0 30 20" role="img" aria-label={flagNames[country]}>{flagArt[country]}</svg>;
}

async function request<T>(path: string, method = 'GET', body?: object, intent = 'save-configuration'): Promise<T> {
  const response = await fetch(`/openingedge-api/${path}`, {
    method, cache: 'no-store', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': getOrCreateVisitorId(), 'X-OpeningEdge-Intent': intent },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { detail?: unknown } | null;
    throw new Error(typeof error?.detail === 'string' ? error.detail : `Request failed (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

function IndexCard({ symbol, quote, config, review, active, onSave }: {
  symbol: SymbolName; quote?: Quote; config?: { lots: number; risk: number | null };
  review?: Review; active?: ActiveTrade | null;
  onSave: (symbol: SymbolName, lots: string, risk: string) => Promise<void>;
}) {
  const [lots, setLots] = useState('1');
  const [risk, setRisk] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const savedLots = config?.lots;
  const savedRisk = config?.risk;
  useEffect(() => {
    if (savedLots !== undefined) { setLots(String(savedLots)); setRisk(savedRisk == null ? '' : String(savedRisk)); }
  }, [savedLots, savedRisk]);
  const save = async () => {
    setBusy(true);
    try { await onSave(symbol, lots, risk); setMessage('Saved'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Save failed'); }
    finally { setBusy(false); }
  };
  const isDown = quote?.change != null && quote.change < 0;
  const DirectionIcon = isDown ? TrendingDown : TrendingUp;
  return (
    <article className={styles.indexCard}>
      <h3><DirectionIcon aria-hidden="true" className={quote?.change == null ? styles.muted : isDown ? styles.negative : styles.positive} />{labels[symbol]}</h3>
      <div className={styles.indexPrice}>
        <strong>{display(quote?.price)}</strong>
        <span className={quote?.change == null ? styles.muted : isDown ? styles.negative : styles.positive}>
          {quote?.change != null && quote.change > 0 ? '+' : ''}{display(quote?.change)}
          {' '}({quote?.change_percent != null && quote.change_percent > 0 ? '+' : ''}{display(quote?.change_percent)}{quote?.change_percent != null ? '%' : ''})
        </span>
      </div>
      {quote?.timestamp && <p className={styles.quoteSource}>{quote.source_status} · {new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
      }).format(new Date(quote.timestamp))} IST</p>}
      <div className={`${styles.noTrade} ${active?.symbol === symbol ? styles.liveTrade : ''}`}>
        {active?.symbol === symbol ? `LIVE · ${active.state}` : 'NO TRADE'}
      </div>
      <p className={styles.probability}>AI confidence: <strong>{review?.confidence != null ? `${display(review.confidence)}%` : '—'}</strong></p>
      <p className={styles.review}>{review ? `Haiku setup review: ${review.state}${review.action && review.action !== 'REJECT' ? ` · ${review.action.replace('_', ' ')}` : ''}. ${review.reason}` : 'Haiku setup review: WAIT · awaiting a qualified live breakout'}</p>
      <dl className={styles.contractDetails}>
        <div><dt><Crosshair aria-hidden="true" />Contract</dt><dd>—</dd></div>
        <div><dt><CalendarDays aria-hidden="true" />Expiry</dt><dd>—</dd></div>
      </dl>
      <details className={styles.cardSettings}>
        <summary>Pre-open data &amp; risk settings</summary>
        <dl className={styles.preopenDetails}>
          <div><dt>Pre-open high</dt><dd>{display(quote?.preopen_high)}</dd></div>
          <div><dt>Pre-open low</dt><dd>{display(quote?.preopen_low)}</dd></div>
          <div><dt>Coverage</dt><dd>{quote?.preopen_complete ? 'Complete' : 'Incomplete'}</dd></div>
        </dl>
        <div className={styles.inputGrid}>
          <label>Lots<input value={lots} onChange={event => setLots(event.target.value)} inputMode="numeric" /></label>
          <label>Loss / trade (₹)<input value={risk} onChange={event => setRisk(event.target.value)} inputMode="decimal" /></label>
        </div>
        <button type="button" disabled={busy || !config} onClick={() => void save()}>Save {labels[symbol]}</button>
        <span role="status" className={styles.saveMessage}>{message}</span>
      </details>
    </article>
  );
}

export default function OpeningEdgeSection() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [clock, setClock] = useState({ time: '', date: '' });
  const [daily, setDaily] = useState('');
  const [notice, setNotice] = useState('');
  const [tradeNotice, setTradeNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  const changing = useRef(false);
  const refresh = useCallback(async () => {
    const version = revision.current;
    try {
      const value = await request<Snapshot>('api/status');
      if (version === revision.current && !changing.current) { setSnapshot(value); setError(''); }
    } catch (reason) {
      if (version === revision.current && !changing.current) {
        setSnapshot(null); setError(reason instanceof Error ? reason.message : 'Status unavailable.');
      }
    }
  }, []);
  useEffect(() => {
    void refresh();
    const poll = window.setInterval(() => void refresh(), 5000);
    const tick = () => {
      const now = new Date();
      setClock({
        time: new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).format(now),
        date: new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(now),
      });
    };
    tick(); const timer = window.setInterval(tick, 1000);
    return () => { window.clearInterval(poll); window.clearInterval(timer); };
  }, [refresh]);
  useEffect(() => { if (snapshot?.config.daily_loss != null) setDaily(String(snapshot.config.daily_loss)); }, [snapshot?.config.daily_loss]);
  const saveIndex = async (symbol: SymbolName, lots: string, risk: string) => {
    if (!/^[1-9]\d*$/.test(lots) || !risk.trim() || !Number.isFinite(Number(risk)) || Number(risk) <= 0) throw new Error('Enter positive lots and loss.');
    await request(`api/config/${symbol}`, 'PUT', { lots: Number(lots), risk: Number(risk) });
    await refresh();
  };
  const saveDaily = async () => {
    if (!daily.trim() || !Number.isFinite(Number(daily)) || Number(daily) <= 0) { setNotice('Enter a positive daily loss limit.'); return; }
    setBusy(true);
    try { await request('api/daily-limit', 'PUT', { daily_loss: Number(daily) }); setNotice('Saved'); await refresh(); }
    catch (reason) { setNotice(reason instanceof Error ? reason.message : 'Save failed.'); }
    finally { setBusy(false); }
  };
  const toggleTrade = async (enabled: boolean) => {
    if (changing.current) return;
    changing.current = true;
    revision.current++;
    setBusy(true);
    setTradeNotice('');
    try {
      const result = await request<{ automation_on?: unknown }>('api/trade-control', 'PUT', {
        enabled,
        confirmation: enabled ? 'START OPENINGEDGE LIVE TRADING' : 'STOP OPENINGEDGE NEW ENTRIES',
      }, 'manual-live-control');
      if (result.automation_on !== enabled) throw new Error('Backend did not confirm the requested state.');
    } catch (reason) {
      setSnapshot(null);
      setTradeNotice(`${reason instanceof Error ? reason.message : 'Trade control failed.'} Verify backend status and Kite.`);
    } finally {
      revision.current++;
      changing.current = false;
      setBusy(false);
      await refresh();
    }
  };
  const controlKnown = !!snapshot && typeof snapshot.automation_on === 'boolean'
    && (snapshot.execution_status === 'READY' || snapshot.execution_status === 'LOCKED');
  const feedConnected = snapshot?.feed_enabled && snapshot.feed_status === 'connected';
  const feedLabel = !snapshot ? 'Unavailable' : !snapshot.feed_enabled ? 'Off'
    : feedConnected ? 'Connected' : snapshot.feed_status === 'starting' || snapshot.feed_status === 'connecting'
      ? 'Connecting' : 'Reconnect required';
  return (
    <section aria-label="OpeningEdge AI" className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}><BarChart3 aria-hidden="true" /><div className={styles.brandText}>
          <h2>OpeningEdge <em>AI</em></h2>
          <p className={styles.tagline}>Opening Trade Algo for NIFTY | BANK NIFTY | SENSEX</p>
        </div></div>
        <div className={styles.headerControls}>
          <button type="button" className={`${styles.tradeControl} ${controlKnown && snapshot?.automation_on ? styles.tradeControlOn : ''}`}
            role={controlKnown ? 'switch' : undefined} aria-checked={controlKnown ? snapshot?.automation_on : undefined}
            aria-label={`OpeningEdge master trade approval ${controlKnown ? snapshot?.automation_on ? 'ON' : 'OFF' : 'unknown'}`}
            disabled={busy || !controlKnown}
            onClick={() => void toggleTrade(!snapshot?.automation_on)}>
            <span>MASTER TRADE</span><span className={styles.switchTrack}><span /></span>
            <strong>{busy ? '…' : !controlKnown ? '—' : snapshot?.automation_on ? 'ON' : 'OFF'}</strong>
          </button>
          <div className={`${styles.brokerStatus} ${feedConnected ? styles.brokerConnected : ''}`}
            title={snapshot?.feed_error || (feedConnected ? 'Independent Zerodha market feed connected.' : 'Independent Zerodha market feed status.')} role="status">
            <Zap aria-hidden="true" /><span><small>Zerodha</small><strong>{feedLabel}</strong></span>
          </div>
        </div>
        <div className={styles.clock}><strong>{clock.time || '—'}</strong><span>{clock.date || '—'} IST</span></div>
      </header>
      <div className={styles.timeline}>
        {steps.map(([hours, title], index) => {
          const current = snapshot?.stage === title;
          const preopenComplete = index === 0 && snapshot && SYMBOLS.every(symbol => snapshot.indices[symbol]?.preopen_complete);
          const Icon = index === 3 ? LockKeyhole : current && index === 2 ? Play : preopenComplete ? Check : Clock3;
          return <div key={title} className={styles.timelineItem}>
            <div className={`${styles.step} ${current ? styles.stepCurrent : ''} ${preopenComplete ? styles.stepDone : ''}`}>
              <span className={styles.stepIcon}><Icon aria-hidden="true" /></span>
              <div><strong>{hours}</strong><span>{title}</span></div>
            </div>
            {index < steps.length - 1 && <ChevronRight className={styles.chevron} aria-hidden="true" />}
          </div>;
        })}
      </div>
      <div className={styles.dashboard}>
        <div className={styles.main}>
          <div className={styles.indexGrid}>{SYMBOLS.map(symbol => <IndexCard key={symbol} symbol={symbol} quote={snapshot?.indices[symbol]} config={snapshot?.config.indices[symbol]} review={snapshot?.reviews?.[symbol]} active={snapshot?.active} onSave={saveIndex} />)}</div>
          <div className={styles.tradePanel}>
            <div className={styles.tradeHeader}><h3><Crosshair aria-hidden="true" /> ACTIVE TRADE</h3>
              <span><Zap aria-hidden="true" /> {snapshot?.active ? snapshot.active.state : !controlKnown ? 'Trade status unknown' : snapshot?.execution_status === 'LOCKED' ? 'Execution locked' : snapshot?.automation_on ? 'Scanning 09:15–09:20' : 'New entries OFF'}</span></div>
            <div className={styles.tradeBody}>
              <div className={styles.tradeIdentity}>
                <strong>{snapshot?.active ? `${snapshot.active.symbol} · ${snapshot.active.contract.tradingsymbol}` : controlKnown ? 'No active automatic trade' : 'Trade status unknown'}</strong>
                <span>Engine: OpeningEdge AI{snapshot?.active ? ` · ${snapshot.active.filled}/${snapshot.active.quantity} qty` : ''}</span></div>
              <div className={styles.tradeGrid}>
                {([
                  ['BUY PRICE', Tag], ['STOP LOSS', ShieldAlert], ['TRAILING STOP LOSS', TrendingUp], ['PROFIT / TARGET', Target],
                ] as [string, LucideIcon][]).map(([label, Icon], index) => <div key={label} className={`${styles.tradeTile} ${index === 1 ? styles.stopTile : ''}`}>
                  <span><Icon aria-hidden="true" />{label}</span><strong>{snapshot?.active
                    ? display([snapshot.active.entry_price, snapshot.active.stop, snapshot.active.stop, snapshot.active.target][index])
                    : '—'}</strong>
                </div>)}
              </div>
              <div className={styles.tradeFooter}>
                <span>Trade Status: <b>{snapshot?.active?.state || (!controlKnown ? 'UNKNOWN' : snapshot?.execution_status === 'LOCKED' ? 'LOCKED' : snapshot?.automation_on ? 'SCANNING' : 'OFF')}</b></span>
                <span>LTP: <b>{display(snapshot?.active?.ltp)}</b></span>
                <span>P&amp;L: <b>{display(snapshot?.active?.unrealized_pnl)}</b></span></div>
            </div>
          </div>
        </div>
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
                  ? Number.isFinite(cue.value) ? `${key === 'usdinr' ? fxFmt.format(cue.value) : display(cue.value)}${percentCues.has(key) ? '%' : ''}` : '—'
                  : cue?.value ?? '—';
                const rowLabel = key === 'auction_gap' && cue?.kind === 'opening_gap'
                  ? 'Last opening gap (NIFTY)' : label;
                return <details key={key} className={styles.contextDetails}>
                  <summary className={styles.contextRow}>
                    {flag ? <CountryFlag country={flag} /> : <Icon aria-hidden="true" />}
                    <span className={styles.contextLabel}>{rowLabel}</span>
                    <span className={`${styles.contextValue} ${signedValueCues.has(key) && typeof cue?.value === 'number' ? changeClass(cue.value) : ''}`}>{value}</span>
                    <span className={`${styles.contextChange} ${changeClass(cue?.change_percent)}`}>{cue?.change_percent != null && Number.isFinite(cue.change_percent) ? `${cue.change_percent > 0 ? '+' : ''}${display(cue.change_percent)}%` : '—'}</span>
                    <span className={styles.contextBadge}>{cue?.status || 'UNAVAILABLE'}</span>
                  </summary>
                  {key === 'us_vix' && cue?.value != null && <p className={styles.cueSource}>
                    CBOE via <a href="https://fred.stlouisfed.org/series/VIXCLS" target="_blank" rel="noreferrer">FRED</a> · Copyright 2016 CBOE
                  </p>}
                  {key === 'news' && cue?.value != null && <p className={styles.cueSource}>
                    Source: <a href="https://www.marketaux.com/" target="_blank" rel="noreferrer">Marketaux</a>
                  </p>}
                  <p>{cue?.detail || fallback} Display only; not used for trading or AI review.</p>
                </details>;
              })}</div>
            </details>;
          })}</div>
        </aside>
      </div>
      <div className={styles.featureBar}>
        <span><Zap aria-hidden="true" /> Independent feed</span><span><Target aria-hidden="true" /> Pre-open monitoring</span>
        <span><Settings2 aria-hidden="true" /> Saved risk settings</span><span><ShieldCheck aria-hidden="true" /> {snapshot?.execution_status === 'READY' ? 'Tagged Kite execution' : 'Execution locked'}</span>
        <span><BarChart3 aria-hidden="true" /> Real-time quotes when available</span>
      </div>
      <div className={styles.entryLock}><LockKeyhole aria-hidden="true" /> NO NEW ENTRIES AFTER 09:20 AM</div>
      <p role="status" className={styles.alert}><ShieldAlert aria-hidden="true" />
        <span>{tradeNotice || error || (!controlKnown && snapshot ? 'Trade control unavailable; the OpeningEdge service may need an update.' : '') || snapshot?.feed_error || snapshot?.reason || 'Connecting to the independent service.'}
          {snapshot?.ai_error ? ` Haiku: ${snapshot.ai_error}` : ''}
          {snapshot?.snapshot_error ? ` ${snapshot.snapshot_error}` : ''}
          {' '}Request OFF to block new entries and verify acknowledgement. Check any existing position and its protection in Kite.</span>
      </p>
      {!controlKnown && <button type="button" disabled={busy} onClick={() => void toggleTrade(false)}>Request OFF</button>}
      <details className={styles.dailySettings}>
        <summary><Settings2 aria-hidden="true" /> Daily risk settings</summary>
        <div><label>Daily loss limit (₹)<input value={daily} onChange={event => setDaily(event.target.value)} inputMode="decimal" /></label>
          <button type="button" disabled={busy || !snapshot} onClick={() => void saveDaily()}>Save limit</button>
          <span role="status" className={styles.saveMessage}>{notice}</span></div>
      </details>
    </section>
  );
}
