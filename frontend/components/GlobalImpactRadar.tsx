'use client';

/**
 * GlobalImpactRadar — Production-grade global market intelligence panel.
 *
 * Architecture decisions:
 *  - CountdownDisplay is a fully isolated memo component — only that element
 *    re-renders every second. The parent tree is NOT touched by the timer.
 *  - All classification sets (BULLISH_SET etc.) are module-level frozen sets for
 *    O(1) lookup with zero per-call allocations.
 *  - computeCounts() is a single O(n) pass replacing 4 separate filter passes.
 *  - FILTER_KEYS is an explicit ordered constant array (Object.keys ordering is
 *    engine-specific and must not be relied upon in production).
 *  - HEAT_SEGS is a module-level tuple — no Array.from() allocation per render.
 *  - cardBorderColor returns a plain string (hover unused after per-card toggle removal).
 *  - useGlobalNews exposes lastFetched (epoch ms) — CountdownDisplay derives its
 *    own countdown from that, keeping the hook state minimal.
 */

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  memo,
} from 'react';
import { API_CONFIG } from '@/lib/api-config';

// ─────────────────────────────────────────────────────────────────────────────
// § 1 — Types
// ─────────────────────────────────────────────────────────────────────────────

type SignalKey =
  | 'STRONG_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'STRONG_BEARISH'
  | 'HIGH_VOLATILITY' | 'MARKET_CRASH' | 'SECTOR_RALLY' | 'RISK_OFF' | 'NO_IMPACT';

type FilterKey  = 'ALL' | 'BULLISH' | 'BEARISH' | 'RISK_OFF' | 'VOLATILE';
type ImpactTier = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

interface SignalMeta { label: string; hex: string }
interface TierConfig { label: string; icon: string; textColor: string; bg: string; border: string }
interface TierGroup  { tier: ImpactTier; items: NewsItem[] }

interface NewsItem {
  id: string; title: string; description: string; link: string;
  published: string; source: string; signal: SignalKey;
  score: number; confidence: number; sectors: string[]; reason: string;
}

interface Snapshot {
  items: NewsItem[]; heat_score: number; overall_signal: SignalKey;
  bullish_count: number; bearish_count: number; neutral_count: number;
  total: number; last_updated: string;
  signal_meta: Record<SignalKey, { label: string; color: string; icon: string }>;
}

/** countdown removed — CountdownDisplay owns its own tick state */
interface FetchState {
  data: Snapshot | null; loading: boolean; error: string | null;
  stale: boolean; lastFetched: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 2 — Module-level constants  (zero per-render allocation)
// ─────────────────────────────────────────────────────────────────────────────

const POLL_MS        = 5 * 60 * 1000;
const STALE_AFTER_MS = 12 * 60 * 1000;
const MAX_RETRIES    = 3;
const RETRY_BASE_MS  = 2000;

/** Explicit ordered array — never rely on Object.keys() ordering in production */
const TIER_ORDER:   ImpactTier[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const FILTER_KEYS:  FilterKey[]  = ['ALL', 'BULLISH', 'BEARISH', 'RISK_OFF', 'VOLATILE'];
/** Pre-defined tuple — avoids Array.from({ length: 5 }) on every HeatMeter render */
const HEAT_SEGS = [0, 1, 2, 3, 4] as const;

const SIG: Record<SignalKey, SignalMeta> = {
  STRONG_BULLISH:  { label: 'Strong Bullish',  hex: '#10b981' },
  BULLISH:         { label: 'Bullish',          hex: '#34d399' },
  SECTOR_RALLY:    { label: 'Sector Rally',     hex: '#06b6d4' },
  NEUTRAL:         { label: 'Neutral',          hex: '#f59e0b' },
  NO_IMPACT:       { label: 'No Impact',        hex: '#64748b' },
  HIGH_VOLATILITY: { label: 'High Volatility',  hex: '#a78bfa' },
  RISK_OFF:        { label: 'Risk-Off',         hex: '#fb923c' },
  BEARISH:         { label: 'Bearish',          hex: '#f87171' },
  STRONG_BEARISH:  { label: 'Strong Bearish',   hex: '#ef4444' },
  MARKET_CRASH:    { label: 'Crash Alert',      hex: '#dc2626' },
};

const ICONS: Record<SignalKey, string> = {
  STRONG_BULLISH: '🚀', BULLISH: '📈', SECTOR_RALLY: '🏆',
  NEUTRAL: '◆', NO_IMPACT: '📰', HIGH_VOLATILITY: '⚡',
  RISK_OFF: '🛡', BEARISH: '📉', STRONG_BEARISH: '🔻', MARKET_CRASH: '💥',
};

const TIER_CFG: Record<ImpactTier, TierConfig> = {
  CRITICAL: { label: 'Critical Impact', icon: '💥', textColor: '#fca5a5', bg: 'rgba(220,38,38,0.10)',    border: 'rgba(220,38,38,0.28)'   },
  HIGH:     { label: 'High Impact',     icon: '🔴', textColor: '#fdba74', bg: 'rgba(251,146,60,0.10)',  border: 'rgba(251,146,60,0.28)'  },
  MEDIUM:   { label: 'Medium Impact',   icon: '🟡', textColor: '#fde68a', bg: 'rgba(245,158,11,0.10)',  border: 'rgba(245,158,11,0.25)'  },
  LOW:      { label: 'Low / Info',      icon: '⚪', textColor: '#94a3b8', bg: 'rgba(100,116,139,0.07)', border: 'rgba(100,116,139,0.20)' },
};

const FILTER_META: Record<FilterKey, { label: string; color: string; bg: string; border: string }> = {
  ALL:      { label: 'All',      color: '#93c5fd', bg: 'rgba(59,130,246,0.12)',   border: 'rgba(59,130,246,0.30)'   },
  BULLISH:  { label: '📈 Bull',  color: '#6ee7b7', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.30)'  },
  BEARISH:  { label: '📉 Bear',  color: '#fca5a5', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.30)'   },
  RISK_OFF: { label: '🛡 Risk',  color: '#fdba74', bg: 'rgba(251,146,60,0.12)',  border: 'rgba(251,146,60,0.30)'  },
  VOLATILE: { label: '⚡ Vol',   color: '#c4b5fd', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.30)' },
};

// Pre-computed Sets — O(1) lookup, no per-call array allocations
const BULLISH_SET     = new Set<SignalKey>(['STRONG_BULLISH', 'BULLISH', 'SECTOR_RALLY']);
const BEARISH_SET     = new Set<SignalKey>(['STRONG_BEARISH', 'BEARISH', 'MARKET_CRASH']);
const RISK_OFF_SET    = new Set<SignalKey>(['RISK_OFF', 'STRONG_BEARISH', 'MARKET_CRASH']);
const VOLATILE_SET    = new Set<SignalKey>(['HIGH_VOLATILITY', 'MARKET_CRASH']);
const TIER_HIGH_SET   = new Set<SignalKey>(['STRONG_BULLISH', 'STRONG_BEARISH', 'HIGH_VOLATILITY', 'RISK_OFF']);
const TIER_MEDIUM_SET = new Set<SignalKey>(['BULLISH', 'BEARISH', 'SECTOR_RALLY']);

function getGlobalNewsWsUrl(): string {
  const baseWs = API_CONFIG.wsUrl.replace(/\/ws\/market\/?$/, '');
  return `${baseWs}/ws/global-news`;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 3 — Pure helpers  (no side-effects, no allocations in hot paths)
// ─────────────────────────────────────────────────────────────────────────────

const getMeta = (s: SignalKey): SignalMeta => SIG[s] ?? SIG.NO_IMPACT;

/** Returns a single border color string — hover property removed (no per-card toggle) */
function cardBorderColor(s: SignalKey): string {
  if (BULLISH_SET.has(s))  return 'rgba(16,185,129,0.22)';
  if (BEARISH_SET.has(s))  return 'rgba(239,68,68,0.22)';
  if (VOLATILE_SET.has(s)) return 'rgba(167,139,250,0.22)';
  if (RISK_OFF_SET.has(s)) return 'rgba(251,146,60,0.22)';
  return 'rgba(71,85,105,0.30)';
}

function heatStyle(n: number) {
  if (n >= 80) return { label: 'EXTREME',  tc: '#fca5a5', bg: 'rgba(220,38,38,0.12)',  bd: 'rgba(220,38,38,0.30)',  f: '#b91c1c', t: '#ef4444' };
  if (n >= 65) return { label: 'HIGH',     tc: '#fdba74', bg: 'rgba(251,146,60,0.12)', bd: 'rgba(251,146,60,0.30)', f: '#c2410c', t: '#fb923c' };
  if (n >= 45) return { label: 'MODERATE', tc: '#fde68a', bg: 'rgba(245,158,11,0.12)', bd: 'rgba(245,158,11,0.30)', f: '#b45309', t: '#f59e0b' };
  return              { label: 'CALM',     tc: '#6ee7b7', bg: 'rgba(16,185,129,0.12)', bd: 'rgba(16,185,129,0.30)', f: '#065f46', t: '#10b981' };
}

function sectionBg(sig: SignalKey): string {
  if (sig === 'STRONG_BULLISH') return 'from-emerald-950/50 via-[#050810]/80 to-[#050810]/90';
  if (sig === 'BULLISH')        return 'from-emerald-950/25 via-[#050810]/80 to-[#050810]/90';
  if (sig === 'MARKET_CRASH' || sig === 'STRONG_BEARISH') return 'from-red-950/50 via-[#050810]/80 to-[#050810]/90';
  if (sig === 'BEARISH')        return 'from-red-950/25 via-[#050810]/80 to-[#050810]/90';
  return 'from-[#080c18]/90 via-[#060910]/90 to-[#060910]/90';
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function fmtAge(pub: string): string {
  if (!pub) return '';
  try {
    const m = Math.max(0, Math.floor((Date.now() - new Date(pub).getTime()) / 60_000));
    if (m < 1)  return 'just now';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  } catch { return ''; }
}

function applyFilter(items: NewsItem[], f: FilterKey): NewsItem[] {
  if (f === 'BULLISH')  return items.filter(i => BULLISH_SET.has(i.signal));
  if (f === 'BEARISH')  return items.filter(i => BEARISH_SET.has(i.signal));
  if (f === 'RISK_OFF') return items.filter(i => RISK_OFF_SET.has(i.signal));
  if (f === 'VOLATILE') return items.filter(i => VOLATILE_SET.has(i.signal));
  return items;
}

function tierOf(item: NewsItem): ImpactTier {
  if (item.signal === 'MARKET_CRASH' || item.score >= 85)    return 'CRITICAL';
  if (TIER_HIGH_SET.has(item.signal)   || item.score >= 65)  return 'HIGH';
  if (TIER_MEDIUM_SET.has(item.signal) || item.score >= 40)  return 'MEDIUM';
  return 'LOW';
}

function groupAndSort(items: NewsItem[]): TierGroup[] {
  const b: Record<ImpactTier, NewsItem[]> = { CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [] };
  for (const item of items) b[tierOf(item)].push(item);
  const out: TierGroup[] = [];
  for (const tier of TIER_ORDER) {
    if (!b[tier].length) continue;
    b[tier].sort((a, x) => x.score - a.score);
    out.push({ tier, items: b[tier] });
  }
  return out;
}

/** Single O(n) pass — replaces 4 separate filter passes */
function computeCounts(items: NewsItem[]): Record<FilterKey, number> {
  const c: Record<FilterKey, number> = { ALL: items.length, BULLISH: 0, BEARISH: 0, RISK_OFF: 0, VOLATILE: 0 };
  for (const i of items) {
    if (BULLISH_SET.has(i.signal))  c.BULLISH++;
    if (BEARISH_SET.has(i.signal))  c.BEARISH++;
    if (RISK_OFF_SET.has(i.signal)) c.RISK_OFF++;
    if (VOLATILE_SET.has(i.signal)) c.VOLATILE++;
  }
  return c;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 4 — Data hook  (countdown intentionally removed — owned by CountdownDisplay)
// ─────────────────────────────────────────────────────────────────────────────

function useGlobalNews() {
  const [state, setState] = useState<FetchState>({
    data: null, loading: true, error: null, stale: false, lastFetched: 0,
  });
  const abortRef = useRef<AbortController | null>(null);
  const pollRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRef    = useRef<WebSocket | null>(null);
  const wsLive   = useRef(false);   // true while WebSocket connection is open

  /** Shared snapshot applier for both WS push and REST paths */
  const applySnap = useCallback((snap: Snapshot) => {
    setState({ data: snap, loading: false, error: null, stale: false, lastFetched: Date.now() });
  }, []);

  // ── REST fetch  (initial load + WS fallback) ─────────────────────────────
  const doFetch = useCallback(async (manual = false) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState(s => ({ ...s, loading: !s.data || manual, error: null }));
    let attempt = 0;
    while (attempt <= MAX_RETRIES) {
      try {
        const res = await fetch(API_CONFIG.endpoint('/api/global-news'), {
          signal: ctrl.signal, cache: 'no-store',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!json?.data || !Array.isArray(json.data.items)) throw new Error('Unexpected payload structure');
        applySnap(json.data as Snapshot);
        if (json.data.total === 0 && !manual) {
          setTimeout(() => { if (!ctrl.signal.aborted) doFetch(); }, 15_000);
        }
        return;
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') return;
        attempt++;
        if (attempt > MAX_RETRIES) {
          setState(s => ({
            ...s, loading: false, stale: !!s.data,
            error: s.data ? null : 'Unable to reach news service.',
          }));
          return;
        }
        await new Promise(r => setTimeout(r, RETRY_BASE_MS * 2 ** (attempt - 1)));
      }
    }
  }, [applySnap]);

  // ── WebSocket — receives a push snapshot on every backend RSS refresh ────
  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    function connect() {
      if (unmounted || typeof WebSocket === 'undefined') return;
      try {
        const ws = new WebSocket(getGlobalNewsWsUrl());
        wsRef.current = ws;

        ws.onopen = () => {
          wsLive.current = true;
          if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
        };

        ws.onmessage = ({ data }) => {
          try {
            const p = JSON.parse(data as string) as Record<string, unknown>;
            if (p?.type === 'ping') return;   // keepalive frame — ignore
            if (p && Array.isArray(p.items)) applySnap(p as unknown as Snapshot);
          } catch { /* ignore malformed frames */ }
        };

        ws.onclose = ws.onerror = () => {
          wsLive.current = false;
          wsRef.current = null;
          if (!unmounted) retryTimer = setTimeout(connect, 5_000);
          doFetch(); // immediate REST fetch while WS reconnects
        };
      } catch { /* WS unavailable — REST-only mode */ }
    }

    connect();

    return () => {
      unmounted = true;
      wsLive.current = false;
      if (retryTimer) clearTimeout(retryTimer);
      const ws = wsRef.current;
      wsRef.current = null;
      try { ws?.close(); } catch { /* ignore */ }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── REST safety-net poll (only when WS is not live) ──────────────────────
  useEffect(() => {
    if (!state.lastFetched) return;
    if (wsLive.current) return;  // WS is pushing — no need for REST poll
    pollRef.current = setTimeout(() => {
      if (document.visibilityState === 'visible') { doFetch(); return; }
      const resume = () => {
        if (document.visibilityState === 'visible') {
          document.removeEventListener('visibilitychange', resume);
          doFetch();
        }
      };
      document.addEventListener('visibilitychange', resume, { once: true });
    }, POLL_MS);
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.lastFetched]);

  // ── Stale detection ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!state.lastFetched || !state.data) return;
    const id = setTimeout(() => setState(s => ({ ...s, stale: true })), STALE_AFTER_MS);
    return () => clearTimeout(id);
  }, [state.lastFetched, state.data]);

  // ── Initial REST load (WS takes a moment to handshake) ───────────────────
  useEffect(() => {
    doFetch();
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
      abortRef.current?.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, refetch: useCallback(() => doFetch(true), [doFetch]) };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 5 — Sub-components
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CountdownDisplay — isolated memo component.
 * Owns its own 1-second interval.  Only this element re-renders on each tick.
 * The entire GlobalImpactRadar tree is NOT touched by the countdown timer.
 */
const CountdownDisplay = memo(function CountdownDisplay({ lastFetched }: { lastFetched: number }) {
  const calcCd = useCallback(() => {
    if (!lastFetched) return Math.floor(POLL_MS / 1000);
    return Math.max(0, Math.floor(POLL_MS / 1000) - Math.floor((Date.now() - lastFetched) / 1000));
  }, [lastFetched]);

  const [cd, setCd] = useState(calcCd);

  useEffect(() => {
    setCd(calcCd());
    const tick = setInterval(() => setCd(calcCd()), 1000);
    return () => clearInterval(tick);
  }, [calcCd]);

  return (
    <span className="text-[9.5px] font-mono text-slate-500 tabular-nums leading-none">
      {Math.floor(cd / 60)}:{String(cd % 60).padStart(2, '0')}
    </span>
  );
});

// — Signal badge ——————————————————————————————————————————————————————————————
const SignalBadge = memo(function SignalBadge({ signal }: { signal: SignalKey }) {
  const { label, hex } = getMeta(signal);
  return (
    <span
      className="inline-flex items-center gap-[5px] px-2 py-[3px] rounded-[5px] text-[10px] font-black tracking-wide whitespace-nowrap border leading-none shrink-0"
      style={{ color: hex, borderColor: `${hex}28`, backgroundColor: `${hex}0e` }}
    >
      <span className="text-[11px] leading-none">{ICONS[signal] ?? '◆'}</span>
      {label}
    </span>
  );
});

// — Score ring ————————————————————————————————————————————————————————————————
const ScoreRing = memo(function ScoreRing({ score, hex }: { score: number; hex: string }) {
  return (
    <span
      className="inline-flex items-center justify-center w-[26px] h-[26px] rounded-full text-[9px] font-black tabular-nums border shrink-0"
      style={{ color: hex, borderColor: `${hex}35`, backgroundColor: `${hex}0e` }}
      title={`Impact score: ${score}/100`}
    >
      {score}
    </span>
  );
});

// — Confidence bar ————————————————————————————————————————————————————————————
const ConfBar = memo(function ConfBar({ pct, hex }: { pct: number; hex: string }) {
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-[3px] rounded-full bg-slate-800/80 overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: hex, transition: 'width 0.7s cubic-bezier(0.4,0,0.2,1)' }}
        />
      </div>
      <span className="text-[9.5px] font-bold tabular-nums shrink-0 leading-none" style={{ color: hex }}>
        {pct}%
      </span>
    </div>
  );
});

// — Sector chips ——————————————————————————————————————————————————————————————
const Sectors = memo(function Sectors({ sectors }: { sectors: string[] }) {
  if (!sectors.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {sectors.slice(0, 4).map(s => (
        <span key={s} className="inline-flex px-[6px] py-[2px] rounded-[4px] text-[9px] font-semibold border border-slate-700/35 bg-slate-800/50 text-slate-400 leading-none">
          {s}
        </span>
      ))}
    </div>
  );
});

// — News card —————————————————————————————————————————————————————————————————
const NewsCard = memo(function NewsCard({ item }: { item: NewsItem }) {
  const { hex } = getMeta(item.signal);
  const border  = cardBorderColor(item.signal);

  return (
    <article
      className="relative flex flex-col rounded-xl border overflow-hidden bg-[#0b0f1a] hover:bg-[#0d1220] transition-colors duration-150"
      style={{ borderColor: border, boxShadow: `0 2px 12px 0 ${hex}07` }}
    >
      {/* Left accent strip */}
      <div
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: `linear-gradient(180deg, ${hex}d0 0%, ${hex}20 100%)` }}
      />

      {/* Card header */}
      <div className="pl-3.5 pr-3 pt-2.5 pb-2 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <SignalBadge signal={item.signal} />
          <div className="flex items-center gap-1.5 shrink-0 mt-[1px]">
            <ScoreRing score={item.score} hex={hex} />
            <span className="text-[9px] text-slate-600 tabular-nums leading-none">
              {fmtAge(item.published)}
            </span>
          </div>
        </div>
        <p className="text-[11.5px] sm:text-[12px] font-semibold text-slate-200 leading-snug">
          {item.title}
        </p>
      </div>

      {/* Card body — always visible */}
      <div className="pl-3.5 pr-3 pb-3 flex flex-col gap-2.5 border-t border-slate-800/50 pt-2.5">
        <p className="text-[10.5px] text-slate-400 leading-relaxed">
          <span className="mr-1 text-[9px]">🇮🇳</span>
          {item.reason}
        </p>
        <ConfBar pct={item.confidence} hex={hex} />
        <Sectors sectors={item.sectors} />
        {item.description && (
          <p className="text-[10px] text-slate-600 leading-relaxed pt-2 border-t border-slate-800/40">
            {item.description}
          </p>
        )}
        <div className="flex items-center justify-between pt-1 border-t border-slate-800/40">
          <span className="text-[9px] text-slate-600 font-medium uppercase tracking-wider leading-none">
            {item.source}
          </span>
          {item.link && (
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[9px] font-semibold text-blue-500/70 hover:text-blue-400 transition-colors leading-none"
            >
              Read more →
            </a>
          )}
        </div>
      </div>
    </article>
  );
});

// — Heat meter ————————————————————————————————————————————————————————————————
const HeatMeter = memo(function HeatMeter({ score }: { score: number }) {
  const h   = heatStyle(score);
  const pct = Math.min(100, score);
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded-xl bg-[#0c1020]/80 border border-slate-800/50">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">Market Heat</span>
        <span
          className="text-[10px] font-black px-2 py-[3px] rounded-[5px] border tabular-nums leading-none"
          style={{ color: h.tc, backgroundColor: h.bg, borderColor: h.bd }}
        >
          {score} · {h.label}
        </span>
      </div>
      <div className="flex gap-[3px]">
        {HEAT_SEGS.map(i => {
          const filled = pct >= ((i + 1) / 5) * 100 - 19;
          return (
            <div
              key={i}
              className="flex-1 h-[5px] rounded-sm transition-colors duration-500"
              style={{
                background: filled ? `linear-gradient(90deg, ${h.f}, ${h.t})` : 'rgba(51,65,85,0.4)',
                opacity: filled ? 0.45 + i * 0.13 : 1,
              }}
            />
          );
        })}
      </div>
    </div>
  );
});

// — Sentiment bar —————————————————————————————————————————————————————————————
const SentimentBar = memo(function SentimentBar({
  bullish, bearish, neutral,
}: { bullish: number; bearish: number; neutral: number }) {
  const total = bullish + bearish + neutral || 1;
  const bPct  = Math.round((bullish / total) * 100);
  const rPct  = Math.round((bearish / total) * 100);
  const nPct  = Math.max(0, 100 - bPct - rPct);
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded-xl bg-[#0c1020]/80 border border-slate-800/50 flex-1 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">Sentiment</span>
        <div className="flex items-center gap-2.5 text-[9px] font-black">
          <span className="text-emerald-400">▲{bullish}</span>
          <span className="text-amber-500">◆{neutral}</span>
          <span className="text-red-400">▼{bearish}</span>
        </div>
      </div>
      <div className="flex h-[5px] rounded-full overflow-hidden gap-[1px]">
        {bPct > 0 && <div style={{ width: `${bPct}%` }} className="bg-gradient-to-r from-emerald-700 to-emerald-500 rounded-l-full" />}
        {nPct > 0 && <div style={{ width: `${nPct}%` }} className="bg-gradient-to-r from-amber-700 to-amber-500" />}
        <div className="flex-1 bg-gradient-to-r from-red-600 to-red-400 rounded-r-full min-w-[2px]" />
      </div>
      <div className="flex justify-between text-[9px] text-slate-600 tabular-nums">
        <span>{bPct}% Bull</span><span>{rPct}% Bear</span>
      </div>
    </div>
  );
});

// — Impact tier header ————————————————————————————————————————————————————————
const TierHeader = memo(function TierHeader({
  tier, count, collapsed, onToggle,
}: { tier: ImpactTier; count: number; collapsed: boolean; onToggle: () => void }) {
  const c = TIER_CFG[tier];
  return (
    <button
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="w-full flex items-center gap-2.5 py-2 focus-visible:outline-none"
    >
      <div className="flex-1 h-px" style={{ backgroundColor: c.border }} />
      <span
        className="inline-flex items-center gap-1.5 px-3 py-[5px] rounded-full border text-[10px] font-black tracking-wide whitespace-nowrap select-none leading-none"
        style={{ color: c.textColor, backgroundColor: c.bg, borderColor: c.border }}
      >
        <span>{c.icon}</span>
        <span>{c.label}</span>
        <span
          className="px-1.5 py-[2px] rounded-[4px] text-[9px] font-black tabular-nums ml-0.5"
          style={{ backgroundColor: 'rgba(0,0,0,0.28)', color: c.textColor }}
        >
          {count}
        </span>
        <span className="ml-1 text-[11px]" style={{ color: c.textColor }}>
          {collapsed ? '▸' : '▾'}
        </span>
      </span>
      <div className="flex-1 h-px" style={{ backgroundColor: c.border }} />
    </button>
  );
});

// — Loading skeleton ——————————————————————————————————————————————————————————
const Skeleton = memo(function Skeleton() {
  return (
    <div className="mt-6 rounded-2xl border-2 border-blue-500/10 bg-[#060911] overflow-hidden animate-pulse">
      <div className="h-[2px] bg-slate-800/80" />
      <div className="p-3 sm:p-4 lg:p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-start gap-3">
            <div className="w-[3px] h-10 bg-slate-800 rounded-full mt-0.5" />
            <div>
              <div className="h-[18px] w-48 sm:w-56 bg-slate-800 rounded mb-2" />
              <div className="h-[11px] w-64 sm:w-80 bg-slate-800/60 rounded" />
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <div className="h-7 w-16 rounded-lg bg-slate-800/70" />
            <div className="h-7 w-20 rounded-lg bg-slate-800/70" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="h-14 rounded-xl bg-slate-800/50" />
          <div className="h-14 rounded-xl bg-slate-800/50" />
        </div>
        <div className="flex gap-1.5 mb-4">
          {[56, 72, 72, 72, 64].map((w, i) => (
            <div key={i} className="h-8 rounded-lg bg-slate-800/50 shrink-0" style={{ width: w }} />
          ))}
        </div>
        <div className="h-9 rounded-xl bg-slate-800/40 mb-3" />
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// § 6 — Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function GlobalImpactRadar() {
  const { state, refetch }        = useGlobalNews();
  const [filter, setFilter]       = useState<FilterKey>('ALL');
  const [showNews, setShowNews]   = useState(false);
  const [collapsed, setCollapsed] = useState<Set<ImpactTier>>(new Set());

  const { data, loading, error, stale, lastFetched } = state;

  const visible = useMemo(() => applyFilter(data?.items ?? [], filter), [data?.items, filter]);
  const grouped = useMemo(() => groupAndSort(visible), [visible]);
  const counts  = useMemo(() => computeCounts(data?.items ?? []), [data?.items]);
  const overview = useMemo(() => {
    const items = visible;
    const total = items.length;
    const topItems = items.slice(0, 4);
    const sourceCounts = new Map<string, number>();
    const sectorCounts = new Map<string, number>();
    let confidenceSum = 0;

    for (const item of items) {
      sourceCounts.set(item.source, (sourceCounts.get(item.source) ?? 0) + 1);
      confidenceSum += item.confidence;
      for (const sector of item.sectors) {
        sectorCounts.set(sector, (sectorCounts.get(sector) ?? 0) + 1);
      }
    }

    let dominantSource = '—';
    let dominantSourceCount = -1;
    sourceCounts.forEach((count, key) => {
      if (count > dominantSourceCount) {
        dominantSource = key;
        dominantSourceCount = count;
      }
    });

    let dominantSector = '—';
    let dominantSectorCount = -1;
    sectorCounts.forEach((count, key) => {
      if (count > dominantSectorCount) {
        dominantSector = key;
        dominantSectorCount = count;
      }
    });

    return {
      topItems,
      sourceSpread: sourceCounts.size,
      sectorSpread: sectorCounts.size,
      dominantSource,
      dominantSector,
      averageConfidence: total > 0 ? Math.round(confidenceSum / total) : 0,
      total,
    };
  }, [visible]);

  const toggleTier = useCallback((t: ImpactTier) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    }),
  []);

  const overallMeta = useMemo(() => getMeta(data?.overall_signal ?? 'NEUTRAL'), [data?.overall_signal]);
  const bg          = useMemo(() => sectionBg(data?.overall_signal ?? 'NEUTRAL'), [data?.overall_signal]);
  const sig: SignalKey = data?.overall_signal ?? 'NEUTRAL';
  if (loading && !data) return <Skeleton />;

  return (
    <section
      aria-label="Global Impact Radar"
      className={`mt-6 rounded-2xl border-2 border-blue-500/[0.18] bg-gradient-to-br ${bg} backdrop-blur-sm overflow-hidden`}
      style={{ boxShadow: '0 4px 40px 0 rgba(0,0,0,0.45), 0 1px 0 0 rgba(255,255,255,0.03) inset' }}
    >
      {/* ── Top accent line ───────────────────────────────────────────── */}
      <div
        className="h-[2px] w-full shrink-0"
        style={{ background: `linear-gradient(90deg, transparent 0%, ${overallMeta.hex}b0 20%, ${overallMeta.hex}b0 80%, transparent 100%)` }}
      />

      <div className="p-3 sm:p-4 xl:p-5">

        {/* ── Header ────────────────────────────────────────────────────── */}
        <header className="flex items-start justify-between gap-3 mb-4 min-w-0">
          <div className="flex items-start gap-2.5 min-w-0 flex-1">
            <span
              className="w-[3px] h-10 rounded-full shrink-0 mt-0.5"
              style={{ background: `linear-gradient(180deg, ${overallMeta.hex} 0%, ${overallMeta.hex}28 100%)` }}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-[14px] sm:text-[16px] lg:text-[18px] font-extrabold text-white tracking-tight leading-tight whitespace-nowrap">
                  🌐 Global Impact Radar
                </h2>
                <span
                  className="hidden sm:inline-flex items-center gap-1 px-2 py-[3px] rounded-[5px] border text-[9.5px] font-black tracking-wide leading-none"
                  style={{ color: overallMeta.hex, borderColor: `${overallMeta.hex}30`, backgroundColor: `${overallMeta.hex}0e` }}
                >
                  {ICONS[sig]} {overallMeta.label}
                </span>
                {stale && (
                  <span className="text-[8.5px] px-1.5 py-[3px] rounded border border-amber-500/30 bg-amber-500/[0.07] text-amber-400 font-bold leading-none">
                    ⚠ STALE
                  </span>
                )}
              </div>
              <p className="text-[9.5px] text-slate-600 font-medium mt-[5px] tracking-wide leading-tight hidden sm:block">
                Real-time global events · India impact analysis · Algorithmic classification
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Countdown — isolated memo, only this element re-renders every second */}
            <div className="flex items-center gap-1.5 px-2.5 py-[6px] rounded-lg bg-[#0c1020]/80 border border-slate-800/50">
              <span className="w-[6px] h-[6px] rounded-full bg-blue-500 animate-pulse shrink-0" />
              <CountdownDisplay lastFetched={lastFetched} />
            </div>
            <button
              onClick={refetch}
              disabled={loading}
              aria-label="Refresh news"
              className="flex items-center gap-1 px-2.5 py-[6px] rounded-lg bg-[#0c1020]/80 border border-slate-800/50 text-[9.5px] font-bold text-slate-500 hover:text-slate-200 hover:border-slate-700/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150 select-none leading-none"
            >
              <span className={`text-[12px] leading-none ${loading ? 'animate-spin' : ''}`}>↻</span>
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </header>

        {/* ── Metrics row ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-2 mb-3.5 md:grid-cols-2 xl:grid-cols-4 xl:gap-2.5">
          <div className="min-w-0">
            <HeatMeter score={data?.heat_score ?? 50} />
          </div>
          <div className="min-w-0">
            <SentimentBar
              bullish={data?.bullish_count ?? 0}
              bearish={data?.bearish_count ?? 0}
              neutral={data?.neutral_count ?? 0}
            />
          </div>
          <div className="rounded-xl border border-slate-800/55 bg-slate-950/50 px-3 py-2.5 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Coverage</span>
              <span className="text-[9px] font-black uppercase tracking-[0.08em] text-cyan-300">{overview.total} events</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
              <div className="rounded-lg border border-slate-700/45 bg-slate-900/50 px-2.5 py-2">
                <div className="text-slate-500">Sources</div>
                <div className="mt-0.5 text-slate-100 font-black">{overview.sourceSpread}</div>
              </div>
              <div className="rounded-lg border border-slate-700/45 bg-slate-900/50 px-2.5 py-2">
                <div className="text-slate-500">Sectors</div>
                <div className="mt-0.5 text-slate-100 font-black">{overview.sectorSpread}</div>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-slate-800/55 bg-slate-950/50 px-3 py-2.5 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Signal mix</span>
              <span className="text-[9px] font-black uppercase tracking-[0.08em] text-slate-300">Avg {overview.averageConfidence}%</span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className="inline-flex items-center gap-1 px-2 py-[4px] rounded-[6px] border text-[9px] font-black leading-none"
                style={{ color: overallMeta.hex, borderColor: `${overallMeta.hex}30`, backgroundColor: `${overallMeta.hex}0d` }}
              >
                {ICONS[sig]} {overallMeta.label}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-[4px] rounded-[6px] border border-slate-700/55 bg-slate-900/55 text-[9px] font-black text-slate-300 leading-none">
                {overview.dominantSource}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-[4px] rounded-[6px] border border-slate-700/55 bg-slate-900/55 text-[9px] font-black text-slate-300 leading-none">
                {overview.dominantSector}
              </span>
            </div>
          </div>
        </div>

        {/* ── Filter tabs — horizontal scroll on mobile ─────────────────── */}
        <div
          className="flex gap-1.5 mb-3 pb-2.5 border-b border-slate-800/50 overflow-x-auto"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {FILTER_KEYS.map(f => {
            const fm       = FILTER_META[f];
            const isActive = filter === f;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className="inline-flex items-center gap-1.5 px-3 py-[6px] rounded-lg border text-[10px] sm:text-[10.5px] font-bold whitespace-nowrap shrink-0 transition-colors duration-150 leading-none"
                style={isActive
                  ? { color: fm.color, backgroundColor: fm.bg, borderColor: fm.border }
                  : { color: '#64748b', backgroundColor: 'transparent', borderColor: 'rgba(71,85,105,0.45)' }}
              >
                {fm.label}
                <span
                  className="px-[5px] py-[2px] rounded text-[9px] font-black tabular-nums"
                  style={isActive
                    ? { color: fm.color, backgroundColor: 'rgba(0,0,0,0.25)' }
                    : { color: '#475569', backgroundColor: 'rgba(71,85,105,0.25)' }}
                >
                  {counts[f]}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Master Show / Hide toggle ─────────────────────────────────── */}
        <button
          onClick={() => setShowNews(v => !v)}
          aria-expanded={showNews}
          aria-controls="gir-news-region"
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border text-[10.5px] font-bold transition-colors duration-150 mb-3 select-none"
          style={showNews
            ? { color: overallMeta.hex, borderColor: `${overallMeta.hex}35`, backgroundColor: `${overallMeta.hex}0d` }
            : { color: '#94a3b8', borderColor: 'rgba(71,85,105,0.45)', backgroundColor: 'rgba(15,23,42,0.40)' }}
        >
          {showNews ? '▴ Hide News' : '▾ Show News'}
          <span
            className="px-2 py-[2px] rounded-[4px] text-[9px] font-black tabular-nums ml-1"
            style={showNews
              ? { color: overallMeta.hex, backgroundColor: `${overallMeta.hex}15` }
              : { color: '#64748b', backgroundColor: 'rgba(71,85,105,0.20)' }}
          >
            {visible.length} event{visible.length !== 1 ? 's' : ''}
          </span>
        </button>

        {/* ── News region ───────────────────────────────────────────────── */}
        {showNews && (
          <div
            id="gir-news-region"
            role="region"
            aria-label="News events"
            className="max-h-[70vh] overflow-y-auto pr-1"
          >

            {overview.topItems.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5 mb-3.5">
                {overview.topItems.map((item) => {
                  const meta = getMeta(item.signal);
                  return (
                    <article
                      key={item.id}
                      className="rounded-xl border border-slate-800/55 bg-slate-950/55 px-3 py-2.5 min-w-0"
                      style={{ boxShadow: `0 0 0 1px ${meta.hex}14 inset` }}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span
                          className="inline-flex items-center gap-1 px-2 py-[4px] rounded-[6px] border text-[9px] font-black leading-none"
                          style={{ color: meta.hex, borderColor: `${meta.hex}2a`, backgroundColor: `${meta.hex}0c` }}
                        >
                          {ICONS[item.signal]} {meta.label}
                        </span>
                        <span className="text-[9px] font-mono text-slate-500 tabular-nums">{item.score}</span>
                      </div>
                      <div className="text-[11px] sm:text-[12px] font-semibold text-slate-100 leading-snug truncate">
                        {truncateText(item.title, 70)}
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-[9px] font-mono text-slate-500 tabular-nums">
                        <span className="truncate">{item.source}</span>
                        <span>{item.confidence}% conf</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {/* Error */}
            {error && !data && (
              <div role="alert" className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                <span className="text-3xl opacity-50">📡</span>
                <p className="text-[12px] text-slate-400 font-semibold">{error}</p>
                <p className="text-[10.5px] text-slate-600 max-w-[280px] leading-relaxed">
                  News service may be warming up. Retrying automatically.
                </p>
                <button
                  onClick={refetch}
                  className="mt-1 px-4 py-2 rounded-lg text-[10.5px] font-bold border border-blue-500/25 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                >
                  Retry now
                </button>
              </div>
            )}

            {/* Service warming up — 0 items, no error */}
            {!error && data && data.total === 0 && (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                <span className="text-3xl opacity-40 animate-pulse">📡</span>
                <p className="text-[12px] text-slate-400 font-semibold">Service warming up…</p>
                <p className="text-[10.5px] text-slate-600 max-w-[280px] leading-relaxed">
                  Fetching live news from RSS feeds. Auto-retrying in 15 seconds.
                </p>
                <button
                  onClick={refetch}
                  className="mt-1 px-4 py-2 rounded-lg text-[10.5px] font-bold border border-blue-500/25 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                >
                  Fetch now
                </button>
              </div>
            )}

            {/* Empty filter — items exist but none match the active filter */}
            {!error && data && data.total > 0 && visible.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
                <span className="text-2xl opacity-40">🔍</span>
                <p className="text-[12px] text-slate-500 font-medium">No events match this filter.</p>
                <button
                  onClick={() => setFilter('ALL')}
                  className="text-[10.5px] text-blue-500 hover:text-blue-400 font-bold transition-colors"
                >
                  View all events →
                </button>
              </div>
            )}

            {/* Tiered groups */}
            {grouped.length > 0 && (
              <div className="flex flex-col">
                {grouped.map(({ tier, items: ti }) => (
                  <div key={tier}>
                    <TierHeader
                      tier={tier}
                      count={ti.length}
                      collapsed={collapsed.has(tier)}
                      onToggle={() => toggleTier(tier)}
                    />
                    {!collapsed.has(tier) && (
                      <div className="flex flex-col gap-2.5 mb-2.5">
                        {ti.map(item => <NewsCard key={item.id} item={item} />)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Footer ────────────────────────────────────────────────────── */}
        {data && (
          <footer className="mt-3.5 pt-3 border-t border-slate-800/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1.5">
            <p className="text-[8.5px] text-slate-700 leading-relaxed">
              Reuters · Economic Times · LiveMint · CNBC · Yahoo Finance · Business Standard · Financial Times
            </p>
            <p className="text-[8.5px] text-slate-700 whitespace-nowrap shrink-0">
              Algorithmic only · Not financial advice
            </p>
          </footer>
        )}
      </div>
    </section>
  );
}
