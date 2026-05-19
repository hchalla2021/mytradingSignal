'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { API_CONFIG } from '@/lib/api-config';

type ImpactTier = 'high' | 'medium' | 'low' | 'volatility';

interface RadarNewsItem {
  id: string;
  title: string;
  description: string;
  source: string;
  published: string;
  signal: string;
  score: number;
  confidence: number;
  sectors: string[];
  reason: string;
  link: string;
  impact_tier?: ImpactTier;
}

interface GlobalNewsSnapshot {
  items: RadarNewsItem[];
  heat_score: number;
  overall_signal: string;
  bullish_count: number;
  bearish_count: number;
  neutral_count: number;
  high_impact_count?: number;
  medium_impact_count?: number;
  volatility_count?: number;
  total: number;
  last_updated: string;
}

const EMPTY_SNAPSHOT: GlobalNewsSnapshot = {
  items: [],
  heat_score: 50,
  overall_signal: 'NEUTRAL',
  bullish_count: 0,
  bearish_count: 0,
  neutral_count: 0,
  high_impact_count: 0,
  medium_impact_count: 0,
  volatility_count: 0,
  total: 0,
  last_updated: new Date().toISOString(),
};

const VOLATILITY_SIGNALS = new Set(['HIGH_VOLATILITY', 'MARKET_CRASH', 'RISK_OFF']);

const resolveTier = (item: RadarNewsItem): ImpactTier => {
  if (item.impact_tier) return item.impact_tier;
  if (VOLATILITY_SIGNALS.has(item.signal)) return 'volatility';
  const extremity = Math.abs(item.score - 50);
  if (extremity >= 24) return 'high';
  if (extremity >= 12) return 'medium';
  return 'low';
};

const resolveGlobalNewsWsUrl = (): string | null => {
  const base = API_CONFIG.wsUrl;
  if (!base) return null;
  if (base.endsWith('/ws/market')) return `${base}/ws/global-news`;
  if (base.endsWith('/ws')) return `${base}/global-news`;
  return `${base}/ws/global-news`;
};

const SignalDot = ({ signal }: { signal: string }) => {
  const tone = signal.includes('BULL') ? 'bg-emerald-400' : signal.includes('BEAR') || signal.includes('CRASH') ? 'bg-red-400' : signal.includes('VOLATILITY') || signal.includes('RISK') ? 'bg-orange-400' : 'bg-slate-400';
  return <span className={`inline-block h-2 w-2 rounded-full ${tone}`} />;
};

const NewsCard = ({ item }: { item: RadarNewsItem }) => {
  const tier = resolveTier(item);
  const tierStyle = tier === 'high'
    ? 'border-red-500/50 bg-red-950/20'
    : tier === 'medium'
      ? 'border-amber-500/50 bg-amber-950/20'
      : 'border-orange-500/50 bg-orange-950/20';

  return (
    <article className={`rounded-xl border p-3 ${tierStyle}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SignalDot signal={item.signal} />
          <span className="text-[10px] font-bold tracking-wide text-slate-200">{item.signal.replace(/_/g, ' ')}</span>
        </div>
        <span className="rounded-full border border-slate-600/70 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
          {item.confidence}%
        </span>
      </div>
      <h4 className="line-clamp-2 text-sm font-bold text-slate-100">{item.title}</h4>
      {item.description ? <p className="mt-1 line-clamp-2 text-xs text-slate-300">{item.description}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
        <span>{item.source}</span>
        <span>Score {item.score}</span>
      </div>
      {item.link ? (
        <a
          href={item.link}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-[11px] font-semibold text-cyan-300 hover:text-cyan-200"
        >
          Read source
        </a>
      ) : null}
    </article>
  );
};

const GlobalImpactRadar = () => {
  const [snapshot, setSnapshot] = useState<GlobalNewsSnapshot>(EMPTY_SNAPSHOT);
  const [connected, setConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [activePanel, setActivePanel] = useState<'ALL' | 'VOLATILITY' | 'HIGH' | 'MEDIUM'>('ALL');
  const [compactMode, setCompactMode] = useState(false);
  const [showNews, setShowNews] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadInitial = async () => {
      try {
        const endpoint = API_CONFIG.endpoint('/api/global-news');
        const response = await fetch(endpoint, { cache: 'no-store' });
        if (!response.ok) return;
        const payload = await response.json();
        if (mounted && payload?.data) {
          setSnapshot(payload.data as GlobalNewsSnapshot);
        }
      } catch {
        // Keep graceful empty state
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    loadInitial();

    const pollId = window.setInterval(loadInitial, 15000);

    const wsUrl = resolveGlobalNewsWsUrl();
    if (!wsUrl) return () => { mounted = false; };

    const ws = new WebSocket(wsUrl);
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!mounted || data?.type === 'ping') return;
        if (data?.items) setSnapshot(data as GlobalNewsSnapshot);
      } catch {
        // ignore malformed packets
      }
    };

    return () => {
      mounted = false;
      window.clearInterval(pollId);
      ws.close();
    };
  }, []);

  useEffect(() => {
    const onSlash = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      if (isInput) return;
      if (e.key === '/') {
        e.preventDefault();
        const el = document.getElementById('global-impact-radar-search') as HTMLInputElement | null;
        el?.focus();
      }
    };
    window.addEventListener('keydown', onSlash);
    return () => window.removeEventListener('keydown', onSlash);
  }, []);

  const categorized = useMemo(() => {
    const actionable = snapshot.items.filter((item) => {
      const tier = resolveTier(item);
      return tier === 'high' || tier === 'medium' || tier === 'volatility';
    });

    const q = query.trim().toLowerCase();
    const filtered = !q
      ? actionable
      : actionable.filter((item) => {
          const hay = `${item.title} ${item.description} ${item.source} ${item.signal} ${item.reason}`.toLowerCase();
          return hay.includes(q);
        });

    return {
      volatility: filtered.filter((i) => resolveTier(i) === 'volatility'),
      high: filtered.filter((i) => resolveTier(i) === 'high'),
      medium: filtered.filter((i) => resolveTier(i) === 'medium'),
      all: filtered,
    };
  }, [snapshot.items, query]);

  const renderSkeleton = (count: number) => (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={`skeleton-${i}`} className="animate-pulse rounded-xl border border-slate-700/70 bg-slate-800/50 p-3">
          <div className="mb-2 h-3 w-1/3 rounded bg-slate-700" />
          <div className="mb-1 h-4 w-11/12 rounded bg-slate-700" />
          <div className="h-3 w-2/3 rounded bg-slate-700" />
        </div>
      ))}
    </div>
  );

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border-2 border-cyan-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950/20">
      <header className="border-b border-cyan-500/20 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-black tracking-wide text-cyan-200 sm:text-lg">Global Impact Radar</h3>
            <p className="text-xs text-slate-400">High-impact and medium-impact financial news with volatility watch</p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-slate-600 bg-slate-900/80 px-3 py-1 text-[11px]">
            <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
            <span className="font-semibold text-slate-300">{connected ? 'LIVE' : 'SYNC'}</span>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-12">
          <div className="md:col-span-6">
            <input
              id="global-impact-radar-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search impact news, source, or signal... (/ focus)"
              className="w-full rounded-lg border border-slate-600 bg-slate-900/80 px-3 py-2 text-xs text-slate-100 outline-none ring-cyan-400/30 placeholder:text-slate-500 focus:ring-2"
              aria-label="Search impact news"
            />
          </div>
          <div className="md:col-span-4 flex flex-wrap gap-1">
            {(['ALL', 'VOLATILITY', 'HIGH', 'MEDIUM'] as const).map((panel) => (
              <button
                key={panel}
                onClick={() => setActivePanel(panel)}
                className={`rounded-md border px-2 py-1 text-[10px] font-bold tracking-wide transition-colors ${
                  activePanel === panel
                    ? 'border-cyan-400/70 bg-cyan-900/40 text-cyan-200'
                    : 'border-slate-600 bg-slate-900/70 text-slate-300 hover:border-slate-500'
                }`}
              >
                {panel}
              </button>
            ))}
          </div>
          <div className="md:col-span-2 flex items-center justify-start gap-1 md:justify-end">
            <button
              onClick={() => setShowNews((v) => !v)}
              className="rounded-md border border-cyan-500/40 bg-cyan-900/30 px-2 py-1 text-[10px] font-bold tracking-wide text-cyan-200 hover:border-cyan-400/70"
            >
              {showNews ? 'Hide News' : 'Show News'}
            </button>
            <button
              onClick={() => setCompactMode((v) => !v)}
              className="rounded-md border border-slate-600 bg-slate-900/70 px-2 py-1 text-[10px] font-semibold text-slate-300 hover:border-slate-500"
            >
              {compactMode ? 'Comfort View' : 'Compact View'}
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
          <div className="rounded-lg border border-red-500/30 bg-red-950/20 p-2">
            <p className="text-[10px] text-red-200/80">Volatility</p>
            <p className="text-sm font-black text-red-200">{categorized.volatility.length}</p>
          </div>
          <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 p-2">
            <p className="text-[10px] text-rose-200/80">High Impact</p>
            <p className="text-sm font-black text-rose-200">{categorized.high.length}</p>
          </div>
          <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-2">
            <p className="text-[10px] text-amber-200/80">Medium Impact</p>
            <p className="text-sm font-black text-amber-200">{categorized.medium.length}</p>
          </div>
          <div className="rounded-lg border border-blue-500/30 bg-blue-950/20 p-2">
            <p className="text-[10px] text-blue-200/80">Heat Score</p>
            <p className="text-sm font-black text-blue-200">{snapshot.heat_score}</p>
          </div>
          <div className="rounded-lg border border-cyan-500/30 bg-cyan-950/20 p-2">
            <p className="text-[10px] text-cyan-200/80">Overall</p>
            <p className="text-sm font-black text-cyan-200">{snapshot.overall_signal.replace(/_/g, ' ')}</p>
          </div>
        </div>
      </header>

      {showNews ? (
      <div className={`grid grid-cols-1 gap-3 p-4 ${compactMode ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} lg:p-5`}>
        {(activePanel === 'ALL' || activePanel === 'VOLATILITY') && <div className="rounded-xl border border-red-500/30 bg-slate-900/60 p-3">
          <h4 className="mb-2 text-xs font-black tracking-wide text-red-300">VOLATILITY WATCH</h4>
          <div className={compactMode ? 'space-y-1.5' : 'space-y-2'}>
            {isLoading ? renderSkeleton(3) : null}
            {categorized.volatility.slice(0, 6).map((item) => <NewsCard key={item.id} item={item} />)}
            {!isLoading && categorized.volatility.length === 0 ? <p className="text-xs text-slate-500">No volatility spikes right now.</p> : null}
          </div>
        </div>}

        {(activePanel === 'ALL' || activePanel === 'HIGH') && <div className="rounded-xl border border-rose-500/30 bg-slate-900/60 p-3">
          <h4 className="mb-2 text-xs font-black tracking-wide text-rose-300">HIGH IMPACT</h4>
          <div className={compactMode ? 'space-y-1.5' : 'space-y-2'}>
            {isLoading ? renderSkeleton(4) : null}
            {categorized.high.slice(0, 8).map((item) => <NewsCard key={item.id} item={item} />)}
            {!isLoading && categorized.high.length === 0 ? <p className="text-xs text-slate-500">No high-impact headlines currently.</p> : null}
          </div>
        </div>}

        {(activePanel === 'ALL' || activePanel === 'MEDIUM') && <div className="rounded-xl border border-amber-500/30 bg-slate-900/60 p-3">
          <h4 className="mb-2 text-xs font-black tracking-wide text-amber-300">MEDIUM IMPACT</h4>
          <div className={compactMode ? 'space-y-1.5' : 'space-y-2'}>
            {isLoading ? renderSkeleton(4) : null}
            {categorized.medium.slice(0, 8).map((item) => <NewsCard key={item.id} item={item} />)}
            {!isLoading && categorized.medium.length === 0 ? <p className="text-xs text-slate-500">No medium-impact headlines currently.</p> : null}
          </div>
        </div>}
      </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowNews(true)}
          className="flex w-full items-center justify-center gap-2 px-4 py-3 text-[11px] font-bold tracking-wide text-cyan-200 hover:bg-cyan-900/20"
        >
          <span>▼</span>
          <span>Show News — {categorized.all.length} actionable ({categorized.volatility.length} volatility · {categorized.high.length} high · {categorized.medium.length} medium)</span>
        </button>
      )}

      <footer className="border-t border-cyan-500/20 px-4 py-2 text-[11px] text-slate-400 sm:px-5">
        Actionable feed: {categorized.all.length} items | Updated {new Date(snapshot.last_updated).toLocaleTimeString()}
      </footer>
    </section>
  );
};

export default GlobalImpactRadar;
