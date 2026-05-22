'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import LiveStatus from '@/components/LiveStatus';
import Header from '@/components/Header';
import SystemStatusBanner from '@/components/SystemStatusBanner';
import { useMarketSocket } from '@/hooks/useMarketSocket';
import { useAnalysis } from '@/hooks/useAnalysis';
import { useAIAnalysis } from '@/hooks/useAIAnalysis';
import { API_CONFIG } from '@/lib/api-config';
import { getOrCreateVisitorId } from '@/lib/visitor-id';

// Dynamic imports for components that use live data - prevents SSR issues
const IndexCard = dynamic(() => import('@/components/IndexCard'), { 
  ssr: false,
  loading: () => (
    <div className="bg-dark-surface/60 rounded-xl p-6 animate-pulse border border-emerald-500/20">
      <div className="h-6 bg-gray-700 rounded mb-4"></div>
      <div className="h-4 bg-gray-700 rounded mb-2"></div>
      <div className="h-4 bg-gray-700 rounded w-3/4"></div>
    </div>
  )
});

const TopAISignalBar = dynamic(() => import('@/components/TopAISignalBar'), { ssr: false });
const MarketPulseStrip = dynamic(() => import('@/components/MarketPulseStrip'), { ssr: false });
const FIIDIIFlowStrip = dynamic(() => import('@/components/FIIDIIFlowStrip'), { ssr: false });
const VolumePulseCard = dynamic(() => import('@/components/VolumePulseCard'), { ssr: false });
const TrendBaseCard = dynamic(() => import('@/components/TrendBaseCard'), { ssr: false });
const SectionTitle = dynamic(() => import('@/components/SectionTitle'), { ssr: false });
const TradeSupportResistance = dynamic(() => import('@/components/TradeSupportResistance'), { ssr: false });
const TradeZonesTerminal = dynamic(() => import('@/components/TradeZonesTerminal'), { ssr: false });
const InstitutionalMarketView = dynamic(() => import('@/components/InstitutionalMarketView'), { ssr: false });
const InstitutionalCompass = dynamic(() => import('@/components/InstitutionalCompass'), {
  ssr: false,
  loading: () => (
    <div className="rounded-3xl border border-slate-700/50 bg-slate-800/50 p-5 animate-pulse">
      <div className="h-5 w-64 bg-slate-700 rounded mb-4" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[0, 1, 2].map(i => (
          <div key={i} className="rounded-2xl bg-slate-700/30 h-64" />
        ))}
      </div>
    </div>
  )
});

const LiquidityIntelligence = dynamic(() => import('@/components/LiquidityIntelligence'), {
  ssr: false,
  loading: () => (
    <div className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5 animate-pulse">
      <div className="h-4 w-56 bg-slate-700 rounded mb-3" />
      <div className="flex flex-col lg:flex-row gap-4">
        {[0, 1, 2].map(i => (
          <div key={i} className="flex-1 rounded-xl bg-slate-700/25 h-80" />
        ))}
      </div>
    </div>
  )
});

const MarketIntelligenceObservatory = dynamic(() => import('@/components/MarketIntelligenceObservatory'), {
  ssr: false,
  loading: () => (
    <div className="mt-6 border-2 border-violet-500/25 rounded-2xl p-4 bg-gradient-to-br from-violet-950/20 via-slate-900/40 to-slate-900/40 animate-pulse">
      <div className="h-5 w-72 bg-slate-700 rounded mb-4" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {[0,1,2,3,4,5,6,7].map(i => (
          <div key={i} className="h-20 bg-slate-700/30 rounded-xl" />
        ))}
      </div>
    </div>
  ),
});

const GlobalRiskPanel = dynamic(() => import('@/components/GlobalRiskPanel'), {
  ssr: false,
  loading: () => (
    <div className="mt-6 border-2 border-emerald-500/25 rounded-2xl p-4 bg-gradient-to-br from-emerald-950/20 via-slate-900/40 to-slate-900/40 animate-pulse">
      <div className="h-5 w-56 bg-slate-700 rounded mb-4" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {[0,1,2,3].map(i => (
          <div key={i} className="h-20 bg-slate-700/30 rounded-xl" />
        ))}
      </div>
    </div>
  ),
});

const CRTBTSTCard = dynamic<{ symbol: string; name: string; data?: unknown }>(() => import('@/components/CRTBTSTCard'), {
  ssr: false,
  loading: () => (
    <div className="rounded-2xl border border-orange-500/30 bg-slate-800/40 p-4 animate-pulse">
      <div className="h-5 w-32 bg-slate-700 rounded mb-3" />
      <div className="h-20 bg-slate-700/30 rounded-xl mb-2" />
      <div className="grid grid-cols-2 gap-1.5">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="h-14 bg-slate-700/25 rounded-lg" />
        ))}
      </div>
    </div>
  )
});

const MarketRegimeIntelligence = dynamic(() => import('@/components/MarketRegimeIntelligence'), {
  ssr: false,
  loading: () => (
    <div className="rounded-2xl border border-blue-500/30 bg-slate-800/30 p-5 animate-pulse">
      <div className="h-5 w-64 bg-slate-700 rounded mb-4" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[0, 1, 2].map(i => (
          <div key={i} className="rounded-2xl bg-slate-700/30 h-80" />
        ))}
      </div>
    </div>
  )
});

const TradingIntelligenceEngine = dynamic(() => import('@/components/TradingIntelligenceEngine'), {
  ssr: false,
  loading: () => (
    <div className="rounded-2xl border border-slate-800/60 bg-[#0b1220]/40 p-5 animate-pulse">
      <div className="h-6 w-56 bg-slate-700 rounded mb-4" />
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map(i => (
          <div key={i} className="rounded-xl bg-slate-700/30 h-32" />
        ))}
      </div>
    </div>
  )
});

const ChartIntelligence = dynamic(() => import('@/components/ChartIntelligence'), {
  ssr: false,
  loading: () => (
    <div className="rounded-2xl border border-emerald-500/25 bg-slate-800/30 p-5 animate-pulse">
      <div className="h-5 w-72 bg-slate-700 rounded mb-4" />
      <div className="h-80 bg-slate-700/30 rounded-2xl" />
    </div>
  )
});

const ExpiryExplosionZone = dynamic(() => import('@/components/ExpiryExplosionZone'), {
  ssr: false,
  loading: () => (
    <div className="rounded-2xl border border-purple-500/30 bg-slate-800/30 p-5 animate-pulse">
      <div className="h-5 w-64 bg-slate-700 rounded mb-4" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[0, 1, 2].map(i => (
          <div key={i} className="rounded-2xl bg-slate-700/30 h-80" />
        ))}
      </div>
    </div>
  )
});

const MarketEdgeIntelligence = dynamic(() => import('@/components/MarketEdgeIntelligence'), {
  ssr: false,
  loading: () => (
    <div className="rounded-2xl border border-teal-500/30 bg-slate-800/30 p-5 animate-pulse">
      <div className="h-5 w-64 bg-slate-700 rounded mb-4" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[0, 1, 2].map(i => (
          <div key={i} className="rounded-2xl bg-slate-700/30 h-80" />
        ))}
      </div>
    </div>
  )
});

const CandleIntelligenceEngine = dynamic(() => import('@/components/CandleIntelligenceEngine'), {
  ssr: false,
  loading: () => (
    <div className="rounded-2xl border border-orange-500/30 bg-slate-800/30 p-5 animate-pulse">
      <div className="h-5 w-64 bg-slate-700 rounded mb-4" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[0, 1, 2].map(i => (
          <div key={i} className="rounded-2xl bg-slate-700/30 h-80" />
        ))}
      </div>
    </div>
  )
});

const GlobalImpactRadar = dynamic(() => import('@/components/GlobalImpactRadar'), {
  ssr: false,
  loading: () => (
    <div className="mt-6 border-2 border-blue-500/25 rounded-2xl p-4 bg-gradient-to-br from-blue-950/20 via-slate-900/40 to-slate-900/40 animate-pulse">
      <div className="h-5 w-56 bg-slate-700 rounded mb-4" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {[0,1,2,3,4,5,6,7].map(i => (
          <div key={i} className="h-28 bg-slate-700/30 rounded-xl" />
        ))}
      </div>
    </div>
  ),
});

const ICTIntelligence = dynamic(() => import('@/components/ICTIntelligence'), {
  ssr: false,
  loading: () => (
    <div className="rounded-2xl border border-amber-500/30 bg-slate-800/30 p-5 animate-pulse">
      <div className="h-4 w-56 bg-slate-700 rounded mb-3" />
      <div className="flex flex-col lg:flex-row gap-4">
        {[0, 1, 2].map(i => (
          <div key={i} className="flex-1 rounded-xl bg-slate-700/25 h-80" />
        ))}
      </div>
    </div>
  )
});


export default function Home() {
  type UserAnalyticsSummary = {
    totals: {
      logged_in_users: number;
      login_events: number;
      app_users: number;
      active_users: number;
      visit_events: number;
    };
    users: Array<{
      id: string;
      display_name: string;
      source: string;
      is_active: boolean;
      login_count: number;
      visit_count: number;
      last_seen_at: string;
    }>;
    generated_at: string;
  };

  // 🔥 Force fresh mount on page load - fixes desktop browser caching
  const [currentYear, setCurrentYear] = useState(() => 
    typeof window !== 'undefined' ? new Date().getFullYear() : 2026
  );
  const [isClient, setIsClient] = useState(false);
  const [userAnalytics, setUserAnalytics] = useState<UserAnalyticsSummary | null>(null);
  
  // Mark when we're on the client
  useEffect(() => {
    setIsClient(true);
  }, []);
  
  // Use standard WebSocket hook
  const {
    marketData,
    connectionStatus,
    isConnected
  } = useMarketSocket();
  const { alertData } = useAIAnalysis();
  const [serverOutlook, setServerOutlook] = useState<Record<string, any> | null>(null);


  // 🔥 Clear browser cache on mount (desktop browsers cache aggressively)
  useEffect(() => {
    // Force service worker to update
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        registrations.forEach(reg => reg.update());
      });
    }
  }, []);

  // Check for auth callback success - guarded for SSR
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    // Set current year on client
    setCurrentYear(new Date().getFullYear());
    
    const params = new URLSearchParams(window.location.search);
    const authStatus = params.get('auth');
    
    if (authStatus === 'success') {
      // Clean URL and reload after 2 seconds
      window.history.replaceState({}, '', '/');
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } else if (authStatus === 'error') {
      // Clean URL
      window.history.replaceState({}, '', '/');
    }
  }, []);

  // ✅ FETCH: Use REST API hook instead of WebSocket analysis (more reliable)
  const { analyses: apiAnalyses } = useAnalysis({
    autoConnect: true,
    pollingInterval: 2000 // Poll every 2 seconds for fresh data
  });

  // ✅ INSTANT: Combine API analysis with WebSocket data (live data only — no fabricated fallbacks)
  const analyses = useMemo(() => {
    if (apiAnalyses) return apiAnalyses;

    const niftyAnalysis = marketData.NIFTY?.analysis ?? null;
    const bankniftyAnalysis = marketData.BANKNIFTY?.analysis ?? null;
    const sensexAnalysis = marketData.SENSEX?.analysis ?? null;

    if (!niftyAnalysis && !bankniftyAnalysis && !sensexAnalysis) return null;

    return {
      NIFTY: niftyAnalysis,
      BANKNIFTY: bankniftyAnalysis,
      SENSEX: sensexAnalysis,
    };
  }, [apiAnalyses, marketData.NIFTY?.analysis, marketData.BANKNIFTY?.analysis, marketData.SENSEX?.analysis]);

  const fetchServerOutlook = useCallback(async () => {
    try {
      const res = await fetch(API_CONFIG.endpoint('/api/analysis/market-outlook-all'), { cache: 'no-store' });
      if (!res.ok) return;
      const next = await res.json();
      if (next?.NIFTY && next?.BANKNIFTY && next?.SENSEX) {
        setServerOutlook(next);
      }
    } catch {
      // Keep last good snapshot for UI stability.
    }
  }, []);

  useEffect(() => {
    fetchServerOutlook();
    const interval = setInterval(fetchServerOutlook, 3000);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchServerOutlook();
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchServerOutlook]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const visitorId = getOrCreateVisitorId();

    const registerVisit = async () => {
      try {
        await fetch(API_CONFIG.endpoint('/api/analytics/visit'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visitor_id: visitorId }),
          keepalive: true,
        });
      } catch {
        // Analytics is best-effort only.
      }
    };

    const fetchAnalytics = async () => {
      try {
        const res = await fetch(API_CONFIG.endpoint('/api/analytics/summary?limit=6'), {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const payload: UserAnalyticsSummary = await res.json();
        setUserAnalytics(payload);
      } catch {
        // Keep existing analytics data.
      }
    };

    registerVisit();
    fetchAnalytics();

    const timer = setInterval(fetchAnalytics, 10000);
    return () => clearInterval(timer);
  }, []);

  // Server-driven outlook with live tick micro-adjustment for immediacy.
  const aggregatedMarketSignal = useMemo(() => {
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
    const normalizeSignal = (value: unknown) => {
      const s = String(value || 'NEUTRAL').toUpperCase();
      if (s === 'STRONG_BUY' || s === 'BUY' || s === 'NEUTRAL' || s === 'SELL' || s === 'STRONG_SELL') return s;
      return 'NEUTRAL';
    };

    const one = (symbol: 'NIFTY' | 'BANKNIFTY' | 'SENSEX') => {
      const outlook = serverOutlook?.[symbol] || {};
      const tick = marketData[symbol];

      let buyPercent = clamp(Number(outlook.buy_signals ?? 50), 0, 100);
      let sellPercent = clamp(Number(outlook.sell_signals ?? 50), 0, 100);
      const sum = buyPercent + sellPercent;
      if (sum > 0) {
        buyPercent = Math.round((buyPercent / sum) * 100);
        sellPercent = 100 - buyPercent;
      } else {
        buyPercent = 50;
        sellPercent = 50;
      }

      const tickChangePct = Number(tick?.changePercent || 0);
      const impulse = clamp(Math.round(Math.abs(tickChangePct) * 22), 0, 18);
      if (tickChangePct >= 0.25) {
        buyPercent = clamp(buyPercent + impulse, 0, 100);
        sellPercent = 100 - buyPercent;
      } else if (tickChangePct <= -0.25) {
        sellPercent = clamp(sellPercent + impulse, 0, 100);
        buyPercent = 100 - sellPercent;
      }

      let signal = normalizeSignal(outlook.signal);
      if (tickChangePct <= -0.35 && (signal === 'STRONG_BUY' || signal === 'BUY')) signal = 'NEUTRAL';
      if (tickChangePct >= 0.35 && (signal === 'STRONG_SELL' || signal === 'SELL')) signal = 'NEUTRAL';

      const predSignal = normalizeSignal(outlook.prediction_5m_signal);
      const pred5mConf = clamp(Math.round(Number(outlook.prediction_5m_confidence ?? 50)), 1, 99);
      const predFromOF = Number(outlook.order_flow_buy_pct);
      let pred5mBuyPct = Number.isFinite(predFromOF)
        ? clamp(Math.round(predFromOF), 0, 100)
        : predSignal === 'STRONG_BUY'
        ? 78
        : predSignal === 'BUY'
        ? 64
        : predSignal === 'STRONG_SELL'
        ? 22
        : predSignal === 'SELL'
        ? 36
        : 50;

      if (tickChangePct >= 0.2) pred5mBuyPct = clamp(pred5mBuyPct + Math.round(impulse * 0.5), 0, 100);
      if (tickChangePct <= -0.2) pred5mBuyPct = clamp(pred5mBuyPct - Math.round(impulse * 0.5), 0, 100);

      const pred5mDir =
        pred5mBuyPct >= 58
          ? 'UP'
          : pred5mBuyPct <= 42
          ? 'DOWN'
          : String(outlook.prediction_5m_direction || 'FLAT').toUpperCase() === 'UP' || String(outlook.prediction_5m_direction || 'FLAT').toUpperCase() === 'DOWN'
          ? String(outlook.prediction_5m_direction || 'FLAT').toUpperCase()
          : 'FLAT';

      const sectionCount = Number(outlook.section_count || outlook.total_signals || 12) || 12;
      const totalConfidence = clamp(
        Math.round(Number(outlook.confidence ?? 50) * 0.65 + pred5mConf * 0.35),
        1,
        99
      );

      return { buyPercent, sellPercent, totalConfidence, signal, sectionCount, pred5mConf, pred5mBuyPct, pred5mDir };
    };

    return {
      NIFTY: one('NIFTY'),
      BANKNIFTY: one('BANKNIFTY'),
      SENSEX: one('SENSEX'),
    };
  }, [serverOutlook, marketData]);

  // Determine market status from actual data, with client-side IST fallback
  // so the UI never shows "MARKET CLOSED" when the Indian market is actually open
  const marketStatus = useMemo(() => {
    const dataStatus = marketData.NIFTY?.status || marketData.BANKNIFTY?.status || marketData.SENSEX?.status;

    // If we have a status from backend tick data, trust it (it uses server IST clock)
    if (dataStatus && dataStatus !== 'DEMO') {
      return dataStatus as 'LIVE' | 'OFFLINE' | 'CLOSED' | 'PRE_OPEN' | 'FREEZE';
    }

    // Fallback: compute market phase client-side using IST
    // This prevents showing "MARKET CLOSED" when backend ticks haven't arrived yet
    try {
      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const day = nowIST.getDay(); // 0=Sun, 6=Sat
      const h = nowIST.getHours();
      const m = nowIST.getMinutes();
      const mins = h * 60 + m; // minutes since midnight IST

      if (day === 0 || day === 6) return 'CLOSED';       // weekends
      if (mins >= 540 && mins < 555) return 'PRE_OPEN';  // 9:00-9:15
      if (mins >= 555 && mins <= 930) return 'LIVE';      // 9:15-15:30
    } catch {
      // toLocaleString may fail in exotic envs; ignore
    }

    return 'OFFLINE';
  }, [marketData.NIFTY?.status, marketData.BANKNIFTY?.status, marketData.SENSEX?.status]);

  // Derive a display-ready connection status.
  // Upgrades to LIVE when WS is connected AND live tick data is flowing.
  // Downgrades alarming RECONNECTING to calmer messages outside trading hours.
  const hasLiveData = !!(marketData.NIFTY?.price || marketData.BANKNIFTY?.price || marketData.SENSEX?.price);

  const displayStatus = useMemo(() => {
    // WS connected + live tick data + market LIVE → show "Live market data ⚡"
    if (connectionStatus === 'connected' && hasLiveData && marketStatus === 'LIVE') {
      return 'LIVE' as const;
    }

    // WS connected but no live data yet, or market not LIVE → CONNECTED (teal)
    if (connectionStatus === 'connected') return 'CONNECTED' as const;

    // Market closed / offline → calm "Waiting for market to open"
    if (marketStatus === 'CLOSED' || marketStatus === 'OFFLINE') {
      if (connectionStatus === 'RECONNECTING' || connectionStatus === 'connecting' || connectionStatus === 'disconnected') {
        return 'WAITING' as const;
      }
    }

    // Pre-market or freeze → gentle "Connecting…" instead of alarming RECONNECTING
    if (marketStatus === 'PRE_OPEN' || marketStatus === 'FREEZE') {
      if (connectionStatus === 'RECONNECTING') {
        return 'CONNECTING' as const;
      }
    }

    // During LIVE with no data yet, convert RECONNECTING → CONNECTING (less alarming)
    if (marketStatus === 'LIVE' && !hasLiveData && connectionStatus === 'RECONNECTING') {
      return 'CONNECTING' as const;
    }

    // Pass through actual status
    return connectionStatus;
  }, [connectionStatus, marketStatus, hasLiveData]);

  // Show loading until client is mounted to prevent hydration errors
  if (!isClient) {
    return (
      <main className="min-h-screen bg-dark-bg flex items-center justify-center">
        <div className="text-center">
          {/* Simple Professional Spinner */}
          <div className="relative w-16 h-16 mx-auto mb-4">
            <div className="absolute inset-0 border-4 border-emerald-500/20 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-transparent border-t-emerald-500 rounded-full animate-spin"></div>
          </div>
          
          {/* Brand Name */}
          <h2 className="text-lg font-semibold text-white">MyDailyTradingSignals</h2>
        </div>
      </main>
    );
  }

  return (
    <main suppressHydrationWarning className="min-h-screen">
      {/* Header */}
      <Header isConnected={isConnected} marketStatus={marketStatus} />

      {/* 🔥 NEW: Professional System Status Banner */}
      <SystemStatusBanner />

      {/* Connection Status Bar */}
      <div className="w-full px-2 sm:px-4 lg:px-8 xl:px-12 py-3 lg:py-4">
        {/* Use same status component for both mobile and desktop */}
        <LiveStatus status={displayStatus} isConnected={isConnected} />
      </div>

      {/* Main Dashboard - Full Width */}
      <div className="w-full px-2 sm:px-4 lg:px-8 xl:px-12 py-3 lg:py-5">
        {/* 📊 MARKET PULSE STRIP — institutional bird's-eye KPIs */}
        <MarketPulseStrip marketData={marketData} isConnected={isConnected} />

        {/* 💸 FII / DII FLOW — live tick-derived intraday proxy */}
        <FIIDIIFlowStrip marketData={marketData} isConnected={isConnected} />

        {/* 🧠 AI SIGNAL DECK — institutional-grade per-index status cards */}
        <TopAISignalBar marketData={marketData} isConnected={isConnected} />

        {/* Live Market Indices - With Border */}
        <div className="border-2 border-emerald-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-emerald-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-emerald-500/10">
          {/* Section Header */}
          <div className="flex flex-col gap-3 mb-3 sm:mb-4">
            <SectionTitle
              title="Live Market Indices"
              accentColor="emerald"
              badge={
                <span className="relative inline-flex items-center px-2 sm:px-2.5 py-0.5 sm:py-1 text-[9px] sm:text-[10px] font-bold bg-gradient-to-r from-accent via-accent-secondary to-accent rounded-md shadow-lg animate-pulse-slow border border-accent/30 whitespace-nowrap leading-none align-middle">
                  <span className="relative z-10 inline-flex items-center gap-0.5">
                    <span>🤖</span>
                    <span className="bg-gradient-to-r from-white via-cyan-100 to-white bg-clip-text text-transparent font-extrabold">AI POWERED</span>
                    <span>✨</span>
                  </span>
                  <span className="absolute inset-0 bg-gradient-to-r from-accent via-accent-secondary to-accent blur-xl opacity-40 rounded-md"></span>
                </span>
              }
            />

            {/* Trading Parameters - Premium Section */}
            <div className="p-1.5 sm:p-3 bg-gradient-to-r from-slate-800/40 via-slate-900/40 to-slate-800/40 rounded-lg sm:rounded-xl border border-slate-700/50 shadow-lg">
              <div className="flex flex-wrap items-center gap-1 sm:gap-2">
                {/* Trade Time Label */}
                <span className="text-amber-400 font-bold text-[10px] sm:text-sm whitespace-nowrap flex items-center gap-0.5">
                  <span>⏰</span>
                  <span className="hidden sm:inline">Trade Time:</span>
                </span>
                
                {/* Trade Times */}
                <div className="flex items-center gap-0.5 sm:gap-1.5 px-1.5 sm:px-3 py-0.5 sm:py-1.5 bg-gradient-to-r from-amber-500/20 to-amber-600/20 border border-amber-500/40 rounded-md sm:rounded-lg shadow-md">
                  <span className="text-amber-300 font-bold text-[10px] sm:text-sm">🥇</span>
                  <span className="text-amber-100 font-bold text-[10px] sm:text-sm whitespace-nowrap">9:20-10:45</span>
                </div>
                <div className="flex items-center gap-0.5 sm:gap-1.5 px-1.5 sm:px-3 py-0.5 sm:py-1.5 bg-gradient-to-r from-emerald-500/20 to-emerald-600/20 border border-emerald-500/40 rounded-md sm:rounded-lg shadow-md">
                  <span className="text-emerald-300 font-bold text-[10px] sm:text-sm">🥈</span>
                  <span className="text-emerald-100 font-bold text-[10px] sm:text-sm whitespace-nowrap">10:45-11:30</span>
                </div>
                <div className="flex items-center gap-0.5 sm:gap-1.5 px-1.5 sm:px-3 py-0.5 sm:py-1.5 bg-gradient-to-r from-blue-500/20 to-blue-600/20 border border-blue-500/40 rounded-md sm:rounded-lg shadow-md">
                  <span className="text-blue-300 font-bold text-[10px] sm:text-sm">⚠️</span>
                  <span className="text-blue-100 font-bold text-[10px] sm:text-sm whitespace-nowrap">1:45-2:45</span>
                </div>

                {/* Separator - Desktop Only */}
                <div className="hidden sm:block w-px h-8 bg-gradient-to-b from-transparent via-slate-600 to-transparent mx-1"></div>

                {/* Timeframes - Compact for Mobile */}
                <div className="flex items-center gap-0.5 sm:gap-2 whitespace-nowrap">
                  <span className="text-purple-400 font-bold text-[10px] sm:text-sm">📊</span>
                  <div className="px-1.5 sm:px-3 py-0.5 sm:py-1.5 bg-gradient-to-r from-purple-500/20 to-purple-600/20 border border-purple-500/40 rounded-md sm:rounded-lg shadow-md">
                    <span className="text-purple-100 font-bold text-[10px] sm:text-sm">15m</span>
                  </div>
                  <span className="text-pink-400 font-bold text-[10px] sm:text-sm">🎯</span>
                  <div className="px-1.5 sm:px-3 py-0.5 sm:py-1.5 bg-gradient-to-r from-pink-500/20 to-pink-600/20 border border-pink-500/40 rounded-md sm:rounded-lg shadow-md">
                    <span className="text-pink-100 font-bold text-[10px] sm:text-sm">5m</span>
                  </div>
                </div>
              </div>
            </div>

            <p className="text-dark-tertiary text-[10px] sm:text-xs ml-4 sm:ml-5 font-medium tracking-wide">Real-time NSE & BSE Index Data with GPT-4 Intelligence</p>
          </div>
        
          {/* Index Cards Grid - Full Width Responsive */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-3">
          <IndexCard
            symbol="NIFTY"
            name="NIFTY 50"
            data={marketData.NIFTY}
            isConnected={isConnected}
            aiAlertData={alertData.NIFTY}
          />
          <IndexCard
            symbol="BANKNIFTY"
            name="BANK NIFTY"
            data={marketData.BANKNIFTY}
            isConnected={isConnected}
            aiAlertData={alertData.BANKNIFTY}
          />
          <IndexCard
            symbol="SENSEX"
            name="SENSEX"
            data={marketData.SENSEX}
            isConnected={isConnected}
            aiAlertData={alertData.SENSEX}
          />
        </div>
        </div>

        {/* 🌐 GLOBAL IMPACT RADAR */}
        <GlobalImpactRadar />

        {/* 🌐 GLOBAL RISK */}
        <GlobalRiskPanel />

        {/* P11a: 🔭 MARKET INTELLIGENCE OBSERVATORY */}
        <MarketIntelligenceObservatory />

        {/* P11b: 📈 REAL-TIME CHART INTELLIGENCE — SMC, FVG, S/R, PDH/PDL, CDH/CDL */}
        <ChartIntelligence />

        {/* ⚡ GREEKS OVERVIEW — Real-time Greeks analysis and buy/sell signals */}
        <TradingIntelligenceEngine marketData={marketData} />

        {/* P0: 📊 TODAY'S MARKET REGIME — Trending vs Sideways */}
        <MarketRegimeIntelligence marketData={marketData} />

        {/* P1: ⚡ PURE LIQUIDITY INTELLIGENCE */}
        <LiquidityIntelligence />

        {/* P12: 📈 MARKETEDGE INTELLIGENCE */}
        <MarketEdgeIntelligence />

        {/* P13: 🕯️ CANDLE INTELLIGENCE ENGINE */}
        <CandleIntelligenceEngine />

        {/* P4: Smart Money • Order Logic */}
        <div className="mt-6 sm:mt-6 border-2 border-purple-600/40 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-purple-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-purple-600/15">
          {/* Section Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
            <SectionTitle
              title="Smart Money • Order Logic"
              accentColor="purple"
            />
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            <InstitutionalMarketView symbol="NIFTY" />
            <InstitutionalMarketView symbol="BANKNIFTY" />
            <InstitutionalMarketView symbol="SENSEX" />
          </div>
        </div>

        {/* P2: Trend Base Section */}
        <div className="mt-6 sm:mt-6">
          <div className="flex flex-col gap-1 mb-3 sm:mb-4">
            <SectionTitle
              title="Trend Base (Higher-Low Structure)"
              subtitle="Live swing structure · 8-factor analysis · 5-min prediction"
              accentColor="green"
            />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            <TrendBaseCard symbol="NIFTY" name="NIFTY 50" />
            <TrendBaseCard symbol="BANKNIFTY" name="BANK NIFTY" />
            <TrendBaseCard symbol="SENSEX" name="SENSEX" />
          </div>
        </div>

        {/* P2b: Volume Pulse Section — dynamic glow based on NIFTY volume signal */}
        {(() => {
          const niftySig = aggregatedMarketSignal.NIFTY.signal;
          const vpSectionClass =
            niftySig === 'STRONG_BUY'  ? 'vp-section-strong-buy' :
            niftySig === 'BUY'         ? 'vp-section-buy' :
            niftySig === 'STRONG_SELL' ? 'vp-section-strong-sell' :
            niftySig === 'SELL'        ? 'vp-section-sell' : '';
          return (
            <div className={`mt-6 sm:mt-6 border-2 border-emerald-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-emerald-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-emerald-500/10 ${vpSectionClass}`}>
              <div className="flex flex-col gap-3 mb-3 sm:mb-4">
                <SectionTitle
                  title="Volume Pulse (Candle Volume)"
                  accentColor="emerald"
                />
              </div>

              {/* Volume Pulse Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
                <VolumePulseCard symbol="NIFTY" name="NIFTY 50" />
                <VolumePulseCard symbol="BANKNIFTY" name="BANK NIFTY" />
                <VolumePulseCard symbol="SENSEX" name="SENSEX" />
              </div>
            </div>
          );
        })()}

        {/* P3: 🏦 ICT SMART MONEY INTELLIGENCE */}
        <ICTIntelligence />

        {/* P5: 🧭 INSTITUTIONAL MARKET COMPASS */}
        <InstitutionalCompass />

        {/* P7: 🎯 TRADE ZONES – Buy/Sell Signals (Multi-factor, dual timeframe) */}
        {(() => {
          // Dynamic section highlighting based on dominant signal
          const tzSignal = aggregatedMarketSignal.NIFTY.signal;
          const tzSectionGlow = 
            tzSignal === 'STRONG_BUY' ? 'tz-section-strong-buy' :
            tzSignal === 'BUY' ? 'tz-section-buy' :
            tzSignal === 'STRONG_SELL' ? 'tz-section-strong-sell' :
            tzSignal === 'SELL' ? 'tz-section-sell' : '';
          const tzBorderColor = 
            tzSignal === 'STRONG_BUY' || tzSignal === 'BUY' ? 'border-emerald-500/60' :
            tzSignal === 'STRONG_SELL' || tzSignal === 'SELL' ? 'border-red-500/60' :
            'border-emerald-600/40';
          const tzBg = 
            tzSignal === 'STRONG_BUY' || tzSignal === 'BUY' ? 'from-emerald-950/30 via-dark-card/50 to-dark-elevated/40' :
            tzSignal === 'STRONG_SELL' || tzSignal === 'SELL' ? 'from-red-950/30 via-dark-card/50 to-dark-elevated/40' :
            'from-emerald-950/20 via-dark-card/50 to-dark-elevated/40';
          return (
        <div className={`mt-6 sm:mt-6 border ${tzBorderColor} rounded-2xl p-3 sm:p-4 bg-gradient-to-br ${tzBg} backdrop-blur-sm shadow-md ${tzSectionGlow}`}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
            <SectionTitle
              title="Trade Zones • Buy/Sell Signals"
              accentColor="emerald"
            />
          </div>

          <TradeZonesTerminal />
          
          <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            <TradeSupportResistance 
              symbol="NIFTY" 
              symbolName="NIFTY 50" 
              data={marketData.NIFTY} 
              analysis={analyses?.NIFTY}
              marketStatus={marketStatus}
            />
            <TradeSupportResistance 
              symbol="BANKNIFTY" 
              symbolName="BANK NIFTY" 
              data={marketData.BANKNIFTY} 
              analysis={analyses?.BANKNIFTY}
              marketStatus={marketStatus}
            />
            <TradeSupportResistance 
              symbol="SENSEX" 
              symbolName="SENSEX" 
              data={marketData.SENSEX} 
              analysis={analyses?.SENSEX}
              marketStatus={marketStatus}
            />
          </div>
        </div>
          );
        })()}

        {/* P10: 💥 EXPIRY EXPLOSION ZONE */}
        <ExpiryExplosionZone />

        {/* P11: 🕯️ CRT-BASED BTST STRATEGIES */}
        <div className="mt-6 sm:mt-6 border-2 border-orange-500/35 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-orange-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-orange-500/10">
          <div className="flex flex-col gap-1 mb-3 sm:mb-4">
            <SectionTitle
              title="CRT-Based BTST Strategies"
              subtitle="Candle Range Theory • 8-Factor Scoring • PDH/PDL Sweep Detection • AMD Pattern • Evening BTST Signals"
              accentColor="amber"
              badge={
                <span className="relative inline-flex items-center px-2 py-0.5 text-[9px] font-bold bg-gradient-to-r from-orange-600/80 to-amber-600/80 rounded-md shadow-lg border border-orange-400/30 whitespace-nowrap leading-none">
                  <span className="relative z-10 inline-flex items-center gap-0.5">
                    <span>🕯️</span>
                    <span className="bg-gradient-to-r from-white via-amber-100 to-white bg-clip-text text-transparent font-extrabold">BTST ENGINE</span>
                  </span>
                </span>
              }
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            <CRTBTSTCard symbol="NIFTY" name="NIFTY 50" data={marketData.NIFTY} />
            <CRTBTSTCard symbol="BANKNIFTY" name="BANK NIFTY" data={marketData.BANKNIFTY} />
            <CRTBTSTCard symbol="SENSEX" name="SENSEX" data={marketData.SENSEX} />
          </div>
        </div>

      </div>

      {/* Analysis Info Banner */}
      <div className="w-full px-2 sm:px-4 lg:px-8 xl:px-12 py-2">
        <div className="mt-4 p-4 bg-black/40 border-2 border-green-500/40 rounded-xl shadow-lg shadow-green-500/20">
          <div className="flex items-start gap-4">
            <div className="text-3xl flex-shrink-0">📊</div>
            <div className="flex-1">
              <h3 className="text-[17px] sm:text-[19px] lg:text-[22px] font-bold text-slate-50 tracking-[-0.01em] mb-2 flex items-center gap-2.5">
                LIVE Market Data Analysis
                <span className={`text-xs px-2.5 py-1 rounded-full font-extrabold shadow-md ${
                  marketStatus === 'LIVE' 
                    ? 'bg-cyan-900/60 text-cyan-300 border-2 border-cyan-500/60 shadow-cyan-500/40 animate-pulse' 
                    : 'bg-red-900/60 text-red-300 border-2 border-red-500/60 shadow-red-500/40'
                }`}>
                  {marketStatus === 'LIVE' ? '● LIVE' : marketStatus === 'PRE_OPEN' ? '● Pre-Open' : marketStatus === 'FREEZE' ? '● Freeze' : '● Market Closed'}
                </span>
              </h3>
              <p className="text-xs text-gray-300 leading-relaxed mb-2.5">
                Real-time analysis using <strong className="text-cyan-400 font-bold">LIVE market data from Zerodha KiteTicker</strong>. 
                All technical indicators are calculated on actual price movements, volume, and order flow.
              </p>
              <p className="text-xs text-gray-300 leading-relaxed">
                <strong className="text-cyan-400 font-bold">Data Source:</strong> Direct integration with Zerodha Kite API - NO dummy or simulated data. 
                All prices are actual traded values from NSE/BSE exchanges.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-dark-border/40 mt-auto py-4 sm:py-5 bg-gradient-to-r from-dark-surface/50 to-dark-card/50 backdrop-blur-sm">
        <div className="w-full px-2 sm:px-4 lg:px-8 xl:px-12 text-dark-muted text-xs sm:text-sm font-medium">
          <div className="flex items-center justify-between">
            <span suppressHydrationWarning className="tracking-wide">MyDailyTradingSignals © {currentYear}</span>
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 bg-bullish rounded-full animate-pulse shadow-md shadow-bullish" />
              <span className="hidden sm:inline">Built for</span> Harikrishna Challa
            </span>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] sm:text-xs">
            <span className="px-2 py-1 rounded-md border border-cyan-500/40 bg-cyan-900/20 text-cyan-300 font-semibold">
              Logins: {userAnalytics?.totals.logged_in_users ?? 0}
            </span>
            <span className="px-2 py-1 rounded-md border border-emerald-500/40 bg-emerald-900/20 text-emerald-300 font-semibold">
              App Users: {userAnalytics?.totals.app_users ?? 0}
            </span>
            <span className="px-2 py-1 rounded-md border border-amber-500/40 bg-amber-900/20 text-amber-300 font-semibold">
              Active Now: {userAnalytics?.totals.active_users ?? 0}
            </span>
            {(userAnalytics?.users ?? []).map((u) => (
              <span
                key={u.id}
                className={`px-2 py-1 rounded-md border font-medium ${
                  u.is_active
                    ? 'border-green-500/50 bg-green-900/20 text-green-300'
                    : 'border-slate-500/40 bg-slate-800/40 text-slate-300'
                }`}
                title={`visits:${u.visit_count} logins:${u.login_count}`}
              >
                {u.display_name}
              </span>
            ))}
          </div>
        </div>
      </footer>
    </main>
  );
}
