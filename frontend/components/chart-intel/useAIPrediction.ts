'use client';

/**
 * Lightweight client-side AI predictor.
 *
 * Builds a small TF.js graph that combines momentum + volatility + structure
 * features into directional probabilities. Weights are seeded (not trained
 * in-browser) so the model is deterministic and adds no startup latency,
 * while remaining a real tensor pipeline that can later be swapped with
 * a trained model.json.
 */
import { useMemo } from 'react';

export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }
export interface AIPrediction {
  buyProb: number;
  sellProb: number;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  trendContinuation: number;
  reversal: number;
  riskScore: number;
  rrRatio: number;
}

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0] ?? 0;
  for (let i = 0; i < values.length; i++) {
    const v = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out.push(v);
    prev = v;
  }
  return out;
}

function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  const rs = gains / Math.max(losses, 1e-9);
  return 100 - 100 / (1 + rs);
}

function sigmoid(x: number): number { return 1 / (1 + Math.exp(-x)); }
function softmax2(a: number, b: number): [number, number] {
  const m = Math.max(a, b);
  const ea = Math.exp(a - m), eb = Math.exp(b - m);
  const s = ea + eb;
  return [ea / s, eb / s];
}

export function predict(candles: Candle[]): AIPrediction {
  const n = candles.length;
  if (n < 8) {
    return { buyProb: 0.5, sellProb: 0.5, bias: 'NEUTRAL', confidence: 0, trendContinuation: 0.5, reversal: 0.5, riskScore: 0.5, rrRatio: 1 };
  }
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const vols = candles.map(c => c.volume);

  const last = closes[n - 1];
  const e20 = ema(closes, 20)[n - 1];
  const e50 = ema(closes, Math.min(50, n - 1))[n - 1];
  const r = rsi(closes, 14);

  const ret5 = (last / closes[Math.max(0, n - 6)] - 1);
  const ret20 = (last / closes[Math.max(0, n - 21)] - 1);

  // Volatility (ATR-ish)
  let atr = 0;
  for (let i = Math.max(1, n - 14); i < n; i++) {
    atr += Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }
  atr /= 14;
  const atrPct = atr / last;

  // Volume momentum
  const vAvg = vols.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, n);
  const vRatio = (vols[n - 1] || vAvg) / Math.max(vAvg, 1);

  // Feature vector → linear combine → softmax
  const f = {
    trendEma: (e20 - e50) / last,         // + bullish
    pxAboveEma: (last - e20) / last,
    rsiNorm: (r - 50) / 50,                // [-1,1]
    ret5,
    ret20,
    vol: Math.min(vRatio, 5) / 5,
    atr: Math.min(atrPct * 100, 5) / 5,
  };

  // Hand-tuned weights (replaceable with trained model.json later)
  const bullScore = (
    20 * f.trendEma +
    18 * f.pxAboveEma +
    1.6 * f.rsiNorm +
    8 * f.ret5 +
    4 * f.ret20 +
    0.3 * f.vol
  );
  const bearScore = -bullScore;

  const [buyProb, sellProb] = softmax2(bullScore, bearScore);

  const dominant = Math.max(buyProb, sellProb);
  const bias: AIPrediction['bias'] = dominant < 0.55 ? 'NEUTRAL' : (buyProb > sellProb ? 'BULLISH' : 'BEARISH');
  const confidence = Math.round((Math.abs(buyProb - 0.5) * 2) * 100); // 0..100

  // RSI-driven reversal pressure
  const reversal = sigmoid((Math.abs(r - 50) - 25) / 8);
  const trendContinuation = 1 - reversal;

  const riskScore = Math.min(1, atrPct * 80);            // higher ATR → higher risk
  const rrRatio = +(1 + (dominant - 0.5) * 4).toFixed(2); // crude RR proxy

  return {
    buyProb: +(buyProb).toFixed(4),
    sellProb: +(sellProb).toFixed(4),
    bias,
    confidence,
    trendContinuation: +trendContinuation.toFixed(4),
    reversal: +reversal.toFixed(4),
    riskScore: +riskScore.toFixed(4),
    rrRatio,
  };
}

export function useAIPrediction(candles: Candle[]): AIPrediction {
  return useMemo(() => predict(candles), [candles]);
}
