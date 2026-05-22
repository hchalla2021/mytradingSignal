'use client';

/**
 * Light Smart-Money-Concepts detector run client-side.
 * Detects: swing highs/lows, BOS/CHOCH, Order Blocks, Fair Value Gaps,
 * Buy/Sell side liquidity pools.
 */
import type { Candle } from './useAIPrediction';

export interface Swing { i: number; price: number; type: 'H' | 'L' }
export interface Structure { i: number; price: number; kind: 'BOS' | 'CHOCH'; dir: 'UP' | 'DOWN' }
export interface Zone {
  startTime: number; endTime: number;
  top: number; bottom: number;
  kind: 'BULL_OB' | 'BEAR_OB' | 'FVG_UP' | 'FVG_DOWN';
  liquidity?: number; // in candle-volume units
}
export interface LiquidityPool { price: number; side: 'BSL' | 'SSL'; strength: number }

export interface SMC {
  swings: Swing[];
  structures: Structure[];
  zones: Zone[];
  pools: LiquidityPool[];
  bsl: number;       // total buy-side liquidity strength (sum volumes near highs)
  ssl: number;       // total sell-side liquidity strength
  dayHigh: number; dayLow: number;
  prevDayHigh: number; prevDayLow: number;
  resistance: number; support: number;
}

function findSwings(c: Candle[], lookback = 2): Swing[] {
  const out: Swing[] = [];
  for (let i = lookback; i < c.length - lookback; i++) {
    let isH = true, isL = true;
    for (let k = 1; k <= lookback; k++) {
      if (c[i].high <= c[i - k].high || c[i].high <= c[i + k].high) isH = false;
      if (c[i].low  >= c[i - k].low  || c[i].low  >= c[i + k].low)  isL = false;
    }
    if (isH) out.push({ i, price: c[i].high, type: 'H' });
    if (isL) out.push({ i, price: c[i].low,  type: 'L' });
  }
  return out;
}

export function analyzeSMC(c: Candle[]): SMC {
  const empty: SMC = {
    swings: [], structures: [], zones: [], pools: [],
    bsl: 0, ssl: 0,
    dayHigh: 0, dayLow: 0, prevDayHigh: 0, prevDayLow: 0,
    resistance: 0, support: 0,
  };
  if (c.length < 10) return empty;

  const swings = findSwings(c, 2);

  // Structures: detect BOS/CHOCH from last 8 swings
  const structures: Structure[] = [];
  let lastHi: Swing | null = null, lastLo: Swing | null = null;
  let trend: 'UP' | 'DOWN' | null = null;
  for (const s of swings) {
    if (s.type === 'H') {
      if (lastHi && s.price > lastHi.price) {
        structures.push({ i: s.i, price: s.price, kind: trend === 'DOWN' ? 'CHOCH' : 'BOS', dir: 'UP' });
        trend = 'UP';
      }
      lastHi = s;
    } else {
      if (lastLo && s.price < lastLo.price) {
        structures.push({ i: s.i, price: s.price, kind: trend === 'UP' ? 'CHOCH' : 'BOS', dir: 'DOWN' });
        trend = 'DOWN';
      }
      lastLo = s;
    }
  }

  // FVGs (3-candle imbalance)
  const zones: Zone[] = [];
  for (let i = 2; i < c.length; i++) {
    const a = c[i - 2], b = c[i - 1], d = c[i];
    if (a.high < d.low) {
      zones.push({
        startTime: b.time, endTime: d.time + 60,
        top: d.low, bottom: a.high, kind: 'FVG_UP',
        liquidity: b.volume,
      });
    } else if (a.low > d.high) {
      zones.push({
        startTime: b.time, endTime: d.time + 60,
        top: a.low, bottom: d.high, kind: 'FVG_DOWN',
        liquidity: b.volume,
      });
    }
  }

  // Order blocks: last opposite candle before strong impulse
  for (let i = 3; i < c.length - 1; i++) {
    const body = Math.abs(c[i].close - c[i].open);
    const prevBody = Math.abs(c[i - 1].close - c[i - 1].open);
    if (body > prevBody * 2.0) {
      const impulseUp = c[i].close > c[i].open;
      // walk back to find opposite candle
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        const oppositeUp = c[j].close > c[j].open;
        if (impulseUp && !oppositeUp) {
          zones.push({
            startTime: c[j].time, endTime: c[Math.min(c.length - 1, i + 6)].time,
            top: Math.max(c[j].open, c[j].close, c[j].high),
            bottom: Math.min(c[j].open, c[j].close, c[j].low),
            kind: 'BULL_OB', liquidity: c[j].volume + c[i].volume,
          });
          break;
        }
        if (!impulseUp && oppositeUp) {
          zones.push({
            startTime: c[j].time, endTime: c[Math.min(c.length - 1, i + 6)].time,
            top: Math.max(c[j].open, c[j].close, c[j].high),
            bottom: Math.min(c[j].open, c[j].close, c[j].low),
            kind: 'BEAR_OB', liquidity: c[j].volume + c[i].volume,
          });
          break;
        }
      }
    }
  }

  // Liquidity pools: cluster swing highs (BSL) / lows (SSL).
  // ICT semantics: BSL = resting buy-stops ABOVE current price (sweep targets
  // overhead). SSL = resting sell-stops BELOW current price. So we filter swing
  // points by their position relative to spot, not just by H/L type.
  const spot = c[c.length - 1].close;
  const tol = spot * 0.0015; // 0.15% bucket
  const pools: LiquidityPool[] = [];
  const cluster = (arr: Swing[], side: 'BSL' | 'SSL') => {
    const sorted = arr.slice().sort((a, b) => a.price - b.price);
    let i = 0;
    while (i < sorted.length) {
      let j = i; let sum = 0; const base = sorted[i].price;
      while (j < sorted.length && sorted[j].price - base <= tol) {
        sum += c[sorted[j].i].volume + 1;
        j++;
      }
      pools.push({ price: (sorted[i].price + sorted[j - 1].price) / 2, side, strength: sum });
      i = j;
    }
  };
  // Only swing highs ABOVE spot are untouched BSL; only swing lows BELOW spot are SSL.
  cluster(swings.filter(s => s.type === 'H' && s.price > spot), 'BSL');
  cluster(swings.filter(s => s.type === 'L' && s.price < spot), 'SSL');

  const bsl = pools.filter(p => p.side === 'BSL').reduce((a, p) => a + p.strength, 0);
  const ssl = pools.filter(p => p.side === 'SSL').reduce((a, p) => a + p.strength, 0);

  // Day / prev-day H/L from candle timestamps
  const nowSec = c[c.length - 1].time;
  const dayStart = nowSec - (nowSec % 86400);
  const prevDayStart = dayStart - 86400;
  let dH = -Infinity, dL = Infinity, pH = -Infinity, pL = Infinity;
  for (const k of c) {
    if (k.time >= dayStart)            { dH = Math.max(dH, k.high); dL = Math.min(dL, k.low); }
    else if (k.time >= prevDayStart)   { pH = Math.max(pH, k.high); pL = Math.min(pL, k.low); }
  }
  if (!isFinite(dH)) { dH = Math.max(...c.map(x => x.high)); dL = Math.min(...c.map(x => x.low)); }
  if (!isFinite(pH)) { pH = dH; pL = dL; }

  return {
    swings,
    structures: structures.slice(-6),
    zones: zones.slice(-12),
    pools: pools.sort((a, b) => b.strength - a.strength).slice(0, 6),
    bsl, ssl,
    dayHigh: dH, dayLow: dL, prevDayHigh: pH, prevDayLow: pL,
    resistance: dH, support: dL,
  };
}
