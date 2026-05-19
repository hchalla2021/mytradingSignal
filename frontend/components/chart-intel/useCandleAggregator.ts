'use client';

/**
 * Aggregates live ticks (price stream) into rolling OHLC candles for the
 * selected timeframe. Persists a rolling window in sessionStorage so a
 * reload or symbol switch doesn't blank the chart.
 */
import { useEffect, useRef, useState } from 'react';
import type { Candle } from './useAIPrediction';

export type TF = '1M' | '3M' | '5M' | '15M' | '1H' | '1D';

const TF_SECONDS: Record<TF, number> = {
  '1M': 60, '3M': 180, '5M': 300, '15M': 900, '1H': 3600, '1D': 86400,
};

const MAX_CANDLES = 240;

function bucketStart(tsMs: number, sec: number): number {
  return Math.floor(tsMs / 1000 / sec) * sec;
}

interface State { candles: Candle[]; lastPrice: number }

export function useCandleAggregator(
  symbol: string,
  tf: TF,
  livePrice: number | null,
  liveTs: string | null,
  liveVolume: number,
): Candle[] {
  const [candles, setCandles] = useState<Candle[]>([]);
  const lastVolRef = useRef<number>(0);
  const cacheKey = `ci-candles-${symbol}-${tf}`;

  // Hydrate from sessionStorage (client only)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (raw) {
        const parsed: State = JSON.parse(raw);
        if (Array.isArray(parsed.candles)) setCandles(parsed.candles);
      } else {
        // Seed synthetic warm-up around current price so chart isn't blank.
        if (livePrice && livePrice > 0) {
          const now = Math.floor(Date.now() / 1000);
          const sec = TF_SECONDS[tf];
          const seed: Candle[] = [];
          let px = livePrice * 0.985;
          for (let i = 80; i > 0; i--) {
            const drift = (Math.random() - 0.5) * livePrice * 0.0015;
            const o = px;
            const c = Math.max(1, px + drift);
            const h = Math.max(o, c) + Math.random() * livePrice * 0.0008;
            const l = Math.min(o, c) - Math.random() * livePrice * 0.0008;
            seed.push({ time: now - i * sec, open: o, high: h, low: l, close: c, volume: Math.random() * 1000 });
            px = c;
          }
          setCandles(seed);
        }
      }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  // Ingest live tick
  useEffect(() => {
    if (!livePrice || livePrice <= 0) return;
    const ts = liveTs ? Date.parse(liveTs) : Date.now();
    if (!isFinite(ts)) return;
    const sec = TF_SECONDS[tf];
    const bStart = bucketStart(ts, sec);
    const vDelta = Math.max(0, (liveVolume || 0) - lastVolRef.current);
    lastVolRef.current = liveVolume || 0;

    setCandles(prev => {
      const out = prev.slice();
      const last = out[out.length - 1];
      if (!last || last.time < bStart) {
        out.push({
          time: bStart,
          open: livePrice,
          high: livePrice,
          low: livePrice,
          close: livePrice,
          volume: vDelta,
        });
        while (out.length > MAX_CANDLES) out.shift();
      } else {
        last.high = Math.max(last.high, livePrice);
        last.low = Math.min(last.low, livePrice);
        last.close = livePrice;
        last.volume += vDelta;
      }
      try {
        if (typeof window !== 'undefined') {
          sessionStorage.setItem(cacheKey, JSON.stringify({ candles: out, lastPrice: livePrice }));
        }
      } catch { /* ignore quota */ }
      return out;
    });
  }, [livePrice, liveTs, liveVolume, tf, cacheKey]);

  return candles;
}
