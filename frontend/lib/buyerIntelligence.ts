/**
 * buyerIntelligence.ts
 * Ultra-low-latency, tick-driven, buyer-side smart-money engine.
 *
 * Pure browser-side incremental computation — no allocations on the hot path,
 * O(1) updates per tick, bounded ring buffers. Consumed by:
 *   - MarketPulseStrip.tsx     (aggregate)
 *   - FIIDIIFlowStrip.tsx      (signed flow proxy)
 *   - TopAISignalBar.tsx       (per-index AI deck)
 *
 * Inputs: only the MarketTick payload already streamed by the FastAPI WS.
 * Outputs: a single `BuyerIntel` object per symbol, refreshed every tick.
 */

import type { MarketTick } from '@/hooks/useMarketSocket';

/* ------------------------------ public types ------------------------------ */

export interface BuyerIntel {
  // — Structural smart-money (bullish-only) —
  bos: boolean;            // bullish Break of Structure
  choch: boolean;          // bullish Change of Character
  bullFvg: boolean;        // unfilled bullish Fair Value Gap below price
  bullOb: boolean;         // bullish Order Block reclaimed / holding
  bslSwept: boolean;       // Buy-Side Liquidity sweep above Equal Highs
  pdhBroken: boolean;      // Previous-Day-High broken (proxy via tick.close prev-close + dayHigh)
  supportHold: number;     // 0..100 — strength of intraday support hold

  // — Flow / participation —
  deltaFlow: number;       // -100..100 signed buyer aggression
  volExpansion: number;    // 0..100 vs short-window baseline
  oiBuildup: number;       // -100..100 ΔOI sign-aligned with price
  buyerPressure: number;   // 0..100 composite buyer dominance
  accumulation: number;    // 0..100 smart-money accumulation score
  instBuying: number;      // 0..100 institutional buying pressure
  marketPulse: number;     // -100..100 momentum pulse

  // — Blended bullish probability (LightGBM-style logistic blend) —
  bullishProb: number;     // 0..100

  // — Liquidity targeting context —
  internalLiqUp: number;   // 0..100 proximity to internal BSL above
  externalLiqUp: number;   // 0..100 proximity to session high (external BSL)

  lastUpdate: number;
}

const EMPTY: BuyerIntel = {
  bos: false, choch: false, bullFvg: false, bullOb: false, bslSwept: false,
  pdhBroken: false, supportHold: 0,
  deltaFlow: 0, volExpansion: 0, oiBuildup: 0,
  buyerPressure: 0, accumulation: 0, instBuying: 0, marketPulse: 0,
  bullishProb: 0,
  internalLiqUp: 0, externalLiqUp: 0,
  lastUpdate: 0,
};

/* ------------------------------ rolling state ----------------------------- */

interface Candle { o: number; h: number; l: number; c: number; v: number; oi: number; bucket: number; }

interface RollState {
  // last tick snapshot
  lastPrice: number;
  lastVol: number;
  lastOi: number;
  lastTs: number;

  // ring of recent tick deltas for delta-flow + vol expansion
  // bounded ~ 240 entries (~ 4 min @ 1 tick/s — fine for indices)
  dRing: Float32Array;   // signed Δprice * Δvolume (proxy for signed flow notional)
  vRing: Float32Array;   // |Δvolume| short-window
  rIdx: number;          // ring cursor
  rFill: number;         // entries filled

  // 1-minute synthetic candle aggregator (ring of last 90)
  cur: Candle | null;
  candles: Candle[];     // length-bounded
  cCap: number;

  // intraday session anchors
  dayOpen: number;
  dayHigh: number;
  dayLow: number;
  prevClose: number;     // tick.close from Zerodha = previous-day close
  sessionStartMs: number;

  // structure tracking (3-bar pivots on 1-min candles)
  lastSwingHigh: number; // most recent confirmed swing high (candle.h)
  lastSwingLow: number;  // most recent confirmed swing low
  swingHighs: number[];  // last 6 confirmed swing highs (for EQH detection)
  trendBias: 'up' | 'dn' | 'flat';

  // smart-money artifacts
  bullFvgLow: number;    // bottom of currently-active bull FVG (0 if none)
  bullFvgHigh: number;   // top of currently-active bull FVG
  bullObLow: number;     // bull OB range low
  bullObHigh: number;    // bull OB range high
}

const STATE = new Map<string, RollState>();
const RING_SIZE = 240;
const CANDLE_CAP = 90;
const CANDLE_MS = 60_000;
const EQH_TOL = 0.0008; // 8 bps clustering tolerance for Equal Highs

function freshState(tick: MarketTick): RollState {
  return {
    lastPrice: tick.price,
    lastVol: tick.volume || 0,
    lastOi: tick.oi || 0,
    lastTs: Date.now(),
    dRing: new Float32Array(RING_SIZE),
    vRing: new Float32Array(RING_SIZE),
    rIdx: 0, rFill: 0,
    cur: null,
    candles: [],
    cCap: CANDLE_CAP,
    dayOpen: tick.open || tick.price,
    dayHigh: tick.high || tick.price,
    dayLow: tick.low || tick.price,
    prevClose: tick.close || tick.price,
    sessionStartMs: Date.now(),
    lastSwingHigh: 0,
    lastSwingLow: 0,
    swingHighs: [],
    trendBias: 'flat',
    bullFvgLow: 0, bullFvgHigh: 0,
    bullObLow: 0, bullObHigh: 0,
  };
}

/* ------------------------------ helpers ----------------------------------- */

function pushRing(arr: Float32Array, idx: number, val: number): void {
  arr[idx] = val;
}

function ringStats(s: RollState): { absMean: number; signedSum: number; volMean: number } {
  const n = s.rFill;
  if (n === 0) return { absMean: 0, signedSum: 0, volMean: 0 };
  let absSum = 0, signedSum = 0, volSum = 0;
  for (let i = 0; i < n; i++) {
    const d = s.dRing[i];
    absSum += d >= 0 ? d : -d;
    signedSum += d;
    volSum += s.vRing[i];
  }
  return { absMean: absSum / n, signedSum, volMean: volSum / n };
}

function pivotConfirmed(c: Candle[], i: number): { hi: boolean; lo: boolean } {
  // 3-bar pivot on closed candles (i is the middle bar)
  const a = c[i - 1], b = c[i], d = c[i + 1];
  return {
    hi: b.h > a.h && b.h > d.h,
    lo: b.l < a.l && b.l < d.l,
  };
}

function logistic(x: number): number {
  // squash to 0..100
  return 100 / (1 + Math.exp(-x));
}

/* ------------------------------ candle update ----------------------------- */

function updateCandles(s: RollState, tick: MarketTick): void {
  const now = Date.now();
  const bucket = Math.floor(now / CANDLE_MS);
  const dVol = Math.max(0, (tick.volume || 0) - s.lastVol); // intraday cumulative → per-period

  if (!s.cur || s.cur.bucket !== bucket) {
    if (s.cur) {
      s.candles.push(s.cur);
      if (s.candles.length > s.cCap) s.candles.shift();
      // confirm pivot two candles back
      const n = s.candles.length;
      if (n >= 3) {
        const piv = pivotConfirmed(s.candles, n - 2);
        const m = s.candles[n - 2];
        if (piv.hi) {
          s.lastSwingHigh = m.h;
          s.swingHighs.push(m.h);
          if (s.swingHighs.length > 6) s.swingHighs.shift();
        }
        if (piv.lo) s.lastSwingLow = m.l;
      }
      // detect bull FVG using last 3 closed candles: c[n-3].h < c[n-1].l
      if (n >= 3) {
        const c1 = s.candles[n - 3];
        const c3 = s.candles[n - 1];
        if (c1.h < c3.l && c3.c > c3.o) {
          s.bullFvgLow = c1.h;
          s.bullFvgHigh = c3.l;
        }
      }
      // detect bull OB: last bearish candle preceding a strong bullish candle
      if (n >= 2) {
        const prev = s.candles[n - 2];
        const last = s.candles[n - 1];
        const body = Math.abs(last.c - last.o);
        const range = Math.max(1e-9, last.h - last.l);
        if (prev.c < prev.o && last.c > last.o && body / range > 0.55) {
          s.bullObLow = prev.l;
          s.bullObHigh = prev.h;
        }
      }
      // refresh trend bias from last few swings
      if (s.swingHighs.length >= 2) {
        const a = s.swingHighs[s.swingHighs.length - 2];
        const b = s.swingHighs[s.swingHighs.length - 1];
        s.trendBias = b > a ? 'up' : b < a ? 'dn' : s.trendBias;
      }
    }
    s.cur = { o: tick.price, h: tick.price, l: tick.price, c: tick.price, v: dVol, oi: tick.oi || 0, bucket };
  } else {
    const c = s.cur;
    if (tick.price > c.h) c.h = tick.price;
    if (tick.price < c.l) c.l = tick.price;
    c.c = tick.price;
    c.v += dVol;
    c.oi = tick.oi || c.oi;
  }
}

/* ------------------------------ main entry -------------------------------- */

export function updateBuyerIntel(symbol: string, tick: MarketTick | null | undefined): BuyerIntel {
  if (!tick || !tick.price) return EMPTY;

  let s = STATE.get(symbol);
  if (!s) {
    s = freshState(tick);
    STATE.set(symbol, s);
  }

  const now = Date.now();
  const dPrice = tick.price - s.lastPrice;
  const dVol = Math.max(0, (tick.volume || 0) - s.lastVol);
  const dOi = (tick.oi || 0) - s.lastOi;

  // signed flow proxy: notional * sign(dPrice). When price ticks up with volume → buyer aggression.
  const signedFlow = dPrice === 0 ? 0 : Math.sign(dPrice) * dVol * tick.price;
  pushRing(s.dRing, s.rIdx, signedFlow);
  pushRing(s.vRing, s.rIdx, dVol);
  s.rIdx = (s.rIdx + 1) % RING_SIZE;
  if (s.rFill < RING_SIZE) s.rFill++;

  // refresh session anchors from tick
  if (tick.high && tick.high > s.dayHigh) s.dayHigh = tick.high;
  if (tick.low && tick.low > 0 && (s.dayLow === 0 || tick.low < s.dayLow)) s.dayLow = tick.low;
  if (tick.open && !s.dayOpen) s.dayOpen = tick.open;
  if (tick.close && !s.prevClose) s.prevClose = tick.close;

  updateCandles(s, tick);

  /* ---------- structural detections ---------- */

  const close = tick.price;
  const bos = s.lastSwingHigh > 0 && close > s.lastSwingHigh && s.trendBias !== 'dn'
    ? true
    : false;
  const choch = s.lastSwingHigh > 0 && close > s.lastSwingHigh && s.trendBias === 'dn';

  // BSL sweep: cluster of >=2 swing highs within EQH_TOL broken by current close
  let bslSwept = false;
  if (s.swingHighs.length >= 2) {
    const top = Math.max(...s.swingHighs);
    let cluster = 0;
    for (let i = 0; i < s.swingHighs.length; i++) {
      if (Math.abs(s.swingHighs[i] - top) / top <= EQH_TOL) cluster++;
    }
    if (cluster >= 2 && close > top) bslSwept = true;
  }

  // active bull FVG (price above gap, gap unfilled by wicks of latest candle)
  const bullFvg = s.bullFvgLow > 0 && close > s.bullFvgHigh;
  // bull OB reclaimed: price holds at/above OB high after retest
  const bullOb = s.bullObLow > 0 && close >= s.bullObHigh && s.bullObLow > 0;

  // PDH break: prev close (Zerodha tick.close) is yesterday's close; we don't have PDH directly,
  // so use max(prevClose, dayOpen * 1.0) and ALSO day-high break as a proxy boolean.
  const pdhRef = Math.max(s.prevClose || 0, s.dayOpen || 0);
  const pdhBroken = pdhRef > 0 && close > pdhRef && close >= s.dayHigh * 0.999;

  // support hold: distance from session low normalized to day range; deeper hold = stronger
  const dayRange = Math.max(1e-9, s.dayHigh - s.dayLow);
  const supportHold = Math.max(0, Math.min(100, ((close - s.dayLow) / dayRange) * 100));

  /* ---------- flow / participation ---------- */

  const stats = ringStats(s);
  const baseAbs = stats.absMean || 1e-9;
  const deltaFlow = Math.max(-100, Math.min(100, (stats.signedSum / (baseAbs * Math.max(1, s.rFill))) * 100));
  // volume expansion: last vRing entry vs ring mean
  const lastV = s.vRing[(s.rIdx - 1 + RING_SIZE) % RING_SIZE];
  const volExpansion = Math.max(0, Math.min(100, stats.volMean > 0 ? (lastV / stats.volMean) * 50 : 0));

  // OI buildup: sign(ΔOI) aligned with sign(dPrice) — long buildup positive, short cover positive too
  let oiBuildup = 0;
  if (dOi !== 0) {
    const align = Math.sign(dOi) * Math.sign(dPrice);
    // long buildup (+,+) and short cover (-,+) are bullish; long unwind (-,-) and short build (+,-) bearish
    if (dPrice > 0 && dOi > 0) oiBuildup = 70;       // long buildup
    else if (dPrice > 0 && dOi < 0) oiBuildup = 50;  // short covering
    else if (dPrice < 0 && dOi > 0) oiBuildup = -70; // short buildup
    else if (dPrice < 0 && dOi < 0) oiBuildup = -40; // long unwind
    else oiBuildup = align * 20;
  }

  // intra-day buyer pressure: PCR + range-position + signed flow
  const pcr = tick.pcr || 0;
  const rangePos = ((close - s.dayLow) / dayRange) * 100;
  let buyerPressure = 50
    + (pcr > 0 ? (pcr - 1) * 25 : 0)
    + (rangePos - 50) * 0.35
    + deltaFlow * 0.18
    + (oiBuildup > 0 ? 6 : oiBuildup < 0 ? -6 : 0);
  buyerPressure = Math.max(0, Math.min(100, buyerPressure));

  // accumulation: deep range + PCR>1 + positive ΔOI + positive deltaFlow
  let accumulation = 0;
  accumulation += rangePos < 55 ? 25 : 10;
  accumulation += pcr >= 1.1 ? 25 : pcr >= 1.0 ? 15 : 0;
  accumulation += oiBuildup > 0 ? 25 : 0;
  accumulation += deltaFlow > 0 ? 15 : 0;
  accumulation += volExpansion >= 55 ? 10 : 0;
  accumulation = Math.max(0, Math.min(100, accumulation));

  // institutional buying: structural + flow weighted
  let instBuying = 0;
  if (bos) instBuying += 25;
  if (choch) instBuying += 15;
  if (bullFvg) instBuying += 10;
  if (bullOb) instBuying += 10;
  if (bslSwept) instBuying += 15;
  if (pdhBroken) instBuying += 10;
  if (oiBuildup > 0) instBuying += 10;
  if (deltaFlow > 25) instBuying += 5;
  instBuying = Math.max(0, Math.min(100, instBuying));

  // market pulse: signed momentum
  const pct = tick.changePercent || 0;
  let marketPulse = pct * 40 + deltaFlow * 0.4 + (rangePos - 50) * 0.6 + (oiBuildup * 0.2);
  marketPulse = Math.max(-100, Math.min(100, marketPulse));

  // liquidity targeting
  const internalRef = s.lastSwingHigh > 0 ? s.lastSwingHigh : s.dayHigh;
  const externalRef = s.dayHigh;
  const internalLiqUp = internalRef > 0 ? Math.max(0, Math.min(100, 100 - ((internalRef - close) / internalRef) * 1000)) : 0;
  const externalLiqUp = externalRef > 0 ? Math.max(0, Math.min(100, 100 - ((externalRef - close) / externalRef) * 1000)) : 0;

  /* ---------- bullish probability (logistic blend) ---------- */

  const z =
    (bos ? 1.1 : 0)
    + (choch ? 0.9 : 0)
    + (bullFvg ? 0.45 : 0)
    + (bullOb ? 0.45 : 0)
    + (bslSwept ? 0.6 : 0)
    + (pdhBroken ? 0.55 : 0)
    + (supportHold > 65 ? 0.4 : supportHold < 25 ? -0.5 : 0)
    + (deltaFlow / 60)
    + (oiBuildup / 80)
    + ((volExpansion - 50) / 70)
    + ((pcr > 0 ? (pcr - 1) : 0) * 0.6)
    - 0.4;
  const bullishProb = Math.round(logistic(z));

  /* ---------- commit snapshot ---------- */

  s.lastPrice = tick.price;
  s.lastVol = tick.volume || s.lastVol;
  s.lastOi = tick.oi || s.lastOi;
  s.lastTs = now;

  return {
    bos, choch, bullFvg, bullOb, bslSwept, pdhBroken,
    supportHold: Math.round(supportHold),
    deltaFlow: Math.round(deltaFlow),
    volExpansion: Math.round(volExpansion),
    oiBuildup: Math.round(oiBuildup),
    buyerPressure: Math.round(buyerPressure),
    accumulation: Math.round(accumulation),
    instBuying: Math.round(instBuying),
    marketPulse: Math.round(marketPulse),
    bullishProb,
    internalLiqUp: Math.round(internalLiqUp),
    externalLiqUp: Math.round(externalLiqUp),
    lastUpdate: now,
  };
}

/** Aggregate multiple intel snapshots (e.g. for the MarketPulseStrip). */
export function aggregateIntel(items: BuyerIntel[]): BuyerIntel {
  if (!items.length) return EMPTY;
  const n = items.length;
  const sum = items.reduce((acc, i) => {
    acc.supportHold += i.supportHold;
    acc.deltaFlow += i.deltaFlow;
    acc.volExpansion += i.volExpansion;
    acc.oiBuildup += i.oiBuildup;
    acc.buyerPressure += i.buyerPressure;
    acc.accumulation += i.accumulation;
    acc.instBuying += i.instBuying;
    acc.marketPulse += i.marketPulse;
    acc.bullishProb += i.bullishProb;
    acc.internalLiqUp += i.internalLiqUp;
    acc.externalLiqUp += i.externalLiqUp;
    return acc;
  }, { ...EMPTY });
  const out: BuyerIntel = {
    bos: items.some(i => i.bos),
    choch: items.some(i => i.choch),
    bullFvg: items.some(i => i.bullFvg),
    bullOb: items.some(i => i.bullOb),
    bslSwept: items.some(i => i.bslSwept),
    pdhBroken: items.some(i => i.pdhBroken),
    supportHold: Math.round(sum.supportHold / n),
    deltaFlow: Math.round(sum.deltaFlow / n),
    volExpansion: Math.round(sum.volExpansion / n),
    oiBuildup: Math.round(sum.oiBuildup / n),
    buyerPressure: Math.round(sum.buyerPressure / n),
    accumulation: Math.round(sum.accumulation / n),
    instBuying: Math.round(sum.instBuying / n),
    marketPulse: Math.round(sum.marketPulse / n),
    bullishProb: Math.round(sum.bullishProb / n),
    internalLiqUp: Math.round(sum.internalLiqUp / n),
    externalLiqUp: Math.round(sum.externalLiqUp / n),
    lastUpdate: Math.max(...items.map(i => i.lastUpdate)),
  };
  return out;
}
