import type { MarketTick } from '@/hooks/useMarketSocket';
import type { BuyerIntel } from '@/lib/buyerIntelligence';

export type ParticipantKey = 'FII' | 'DII' | 'CLIENT' | 'PRO';
export type FlowAction = 'LONG_BUILDUP' | 'SHORT_BUILDUP' | 'SHORT_COVERING' | 'LONG_UNWIND' | 'NEUTRAL';

export interface ParticipantPulse {
  key: ParticipantKey;
  score: number; // -100..100
  action: FlowAction;
  confidence: number; // 0..100
  entering: boolean;
  exiting: boolean;
  unusual: boolean;
  delta: number;
}

export interface ParticipantRealtimeSnapshot {
  symbol: string;
  updatedAt: number;
  participants: Record<ParticipantKey, ParticipantPulse>;
  heavyActivity: boolean;
  alerts: string[];
}

export interface ParticipantAggregateSnapshot {
  updatedAt: number;
  participants: Record<ParticipantKey, ParticipantPulse>;
  heavyActivity: boolean;
  alerts: string[];
}

interface SymbolState {
  lastSig: string;
  lastOi: number;
  lastVol: number;
  volEma: number;
  prevScores: Record<ParticipantKey, number>;
  deltaRing: Record<ParticipantKey, number[]>;
}

const STATE = new Map<string, SymbolState>();
const DELTA_RING_MAX = 60;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function signed100From01(v: number): number {
  return clamp((v - 50) * 2, -100, 100);
}

function ensure(symbol: string): SymbolState {
  const cur = STATE.get(symbol);
  if (cur) return cur;
  const init: SymbolState = {
    lastSig: '',
    lastOi: 0,
    lastVol: 0,
    volEma: 0,
    prevScores: { FII: 0, DII: 0, CLIENT: 0, PRO: 0 },
    deltaRing: { FII: [], DII: [], CLIENT: [], PRO: [] },
  };
  STATE.set(symbol, init);
  return init;
}

function pushDelta(arr: number[], v: number): void {
  arr.push(v);
  if (arr.length > DELTA_RING_MAX) arr.shift();
}

function zLike(arr: number[], v: number): number {
  if (arr.length < 8) return 0;
  const n = arr.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += arr[i];
  mean /= n;
  let varSum = 0;
  for (let i = 0; i < n; i++) {
    const d = arr[i] - mean;
    varSum += d * d;
  }
  const sd = Math.sqrt(varSum / n) || 1;
  return Math.abs((v - mean) / sd);
}

function classify(score: number, oiBuildup: number): FlowAction {
  if (score >= 20 && oiBuildup >= 15) return 'LONG_BUILDUP';
  if (score <= -20 && oiBuildup <= -15) return 'SHORT_BUILDUP';
  if (score >= 15 && oiBuildup <= -10) return 'SHORT_COVERING';
  if (score <= -15 && oiBuildup >= 10) return 'LONG_UNWIND';
  return 'NEUTRAL';
}

function pulse(
  key: ParticipantKey,
  score: number,
  prev: number,
  oiBuildup: number,
  z: number,
): ParticipantPulse {
  const entering = Math.abs(score) >= 35 && Math.abs(prev) < 20;
  const exiting = Math.abs(score) < 15 && Math.abs(prev) >= 30;
  const delta = score - prev;
  const unusual = z >= 2.0 || Math.abs(delta) >= 30;

  let conf = 35 + Math.abs(score) * 0.45;
  if (unusual) conf += 15;
  if (entering || exiting) conf += 10;

  return {
    key,
    score: Math.round(clamp(score, -100, 100)),
    action: classify(score, oiBuildup),
    confidence: Math.round(clamp(conf, 0, 100)),
    entering,
    exiting,
    unusual,
    delta: Math.round(delta),
  };
}

export function updateParticipantFlowRealtime(
  symbol: string,
  tick: MarketTick | null | undefined,
  intel: BuyerIntel | null | undefined,
): ParticipantRealtimeSnapshot | null {
  if (!tick || !intel) return null;

  const s = ensure(symbol);
  const sig = `${tick.timestamp}|${tick.price}|${tick.volume}|${tick.oi}|${tick.pcr}`;
  if (s.lastSig === sig) {
    return null;
  }

  const dOiRaw = s.lastOi > 0 ? tick.oi - s.lastOi : 0;
  const dVolRaw = s.lastVol > 0 ? Math.max(0, tick.volume - s.lastVol) : 0;
  s.volEma = s.volEma <= 0 ? dVolRaw : (0.88 * s.volEma + 0.12 * dVolRaw);

  const oiImpulse = clamp(s.lastOi > 0 ? (dOiRaw / Math.max(1, s.lastOi)) * 15000 : 0, -100, 100);
  const volImpulse = clamp(s.volEma > 0 ? (dVolRaw / Math.max(1, s.volEma)) * 40 : 0, -100, 100);
  const pcrTilt = clamp(((tick.pcr || 1) - 1) * 120, -80, 80);
  const trendTilt = tick.trend === 'bullish' ? 18 : tick.trend === 'bearish' ? -18 : 0;

  const accSigned = signed100From01(intel.accumulation);
  const supportSigned = signed100From01(intel.supportHold);

  const fiiScore = clamp(
    0.34 * intel.deltaFlow +
      0.30 * intel.oiBuildup +
      0.16 * oiImpulse +
      0.10 * trendTilt +
      0.10 * (-pcrTilt),
    -100,
    100,
  );

  const diiScore = clamp(
    0.30 * accSigned +
      0.24 * supportSigned +
      0.18 * pcrTilt +
      0.18 * intel.buyerPressure -
      0.10 * fiiScore,
    -100,
    100,
  );

  const clientScore = clamp(
    -0.44 * fiiScore -
      0.18 * diiScore -
      0.12 * trendTilt +
      0.16 * volImpulse +
      0.10 * (-intel.marketPulse),
    -100,
    100,
  );

  const proScore = clamp(
    0.28 * intel.marketPulse +
      0.22 * oiImpulse +
      0.20 * intel.volExpansion +
      0.15 * intel.deltaFlow +
      0.15 * (Math.abs(intel.instBuying) > 0 ? intel.instBuying - 50 : 0),
    -100,
    100,
  );

  const raw: Record<ParticipantKey, number> = {
    FII: fiiScore,
    DII: diiScore,
    CLIENT: clientScore,
    PRO: proScore,
  };

  const participants = {} as Record<ParticipantKey, ParticipantPulse>;
  const alerts: string[] = [];

  (Object.keys(raw) as ParticipantKey[]).forEach((k) => {
    const prev = s.prevScores[k];
    const delta = raw[k] - prev;
    pushDelta(s.deltaRing[k], delta);
    const z = zLike(s.deltaRing[k], delta);
    const p = pulse(k, raw[k], prev, intel.oiBuildup, z);
    participants[k] = p;

    if (p.unusual) alerts.push(`${k} unusual ${p.action.replace('_', ' ').toLowerCase()}`);
    if (p.entering) alerts.push(`${k} entering aggressively`);
    if (p.exiting) alerts.push(`${k} reducing positions`);

    s.prevScores[k] = raw[k];
  });

  const heavyActivity = (Object.values(participants).filter((p) => p.unusual).length >= 2)
    || Object.values(participants).some((p) => Math.abs(p.score) >= 70);

  s.lastSig = sig;
  s.lastOi = tick.oi;
  s.lastVol = tick.volume;

  return {
    symbol,
    updatedAt: Date.now(),
    participants,
    heavyActivity,
    alerts: alerts.slice(0, 6),
  };
}

export function aggregateParticipantFlowRealtime(
  snaps: Array<ParticipantRealtimeSnapshot | null>,
): ParticipantAggregateSnapshot | null {
  const valid = snaps.filter((s): s is ParticipantRealtimeSnapshot => !!s);
  if (!valid.length) return null;

  const weightFor = (symbol: string): number => {
    if (symbol === 'NIFTY') return 0.45;
    if (symbol === 'BANKNIFTY') return 0.40;
    return 0.15;
  };

  const totals: Record<ParticipantKey, number> = { FII: 0, DII: 0, CLIENT: 0, PRO: 0 };
  const conf: Record<ParticipantKey, number> = { FII: 0, DII: 0, CLIENT: 0, PRO: 0 };
  const deltas: Record<ParticipantKey, number> = { FII: 0, DII: 0, CLIENT: 0, PRO: 0 };
  const weights: Record<ParticipantKey, number> = { FII: 0, DII: 0, CLIENT: 0, PRO: 0 };
  const unusualCount: Record<ParticipantKey, number> = { FII: 0, DII: 0, CLIENT: 0, PRO: 0 };

  const alertSet = new Set<string>();
  let heavy = false;
  let updatedAt = 0;

  valid.forEach((snap) => {
    const w = weightFor(snap.symbol);
    updatedAt = Math.max(updatedAt, snap.updatedAt);
    heavy = heavy || snap.heavyActivity;
    snap.alerts.forEach((a) => alertSet.add(a));

    (Object.keys(snap.participants) as ParticipantKey[]).forEach((k) => {
      const p = snap.participants[k];
      totals[k] += p.score * w;
      conf[k] += p.confidence * w;
      deltas[k] += p.delta * w;
      weights[k] += w;
      if (p.unusual) unusualCount[k] += 1;
    });
  });

  const participants = {} as Record<ParticipantKey, ParticipantPulse>;
  (Object.keys(totals) as ParticipantKey[]).forEach((k) => {
    const w = Math.max(1e-9, weights[k]);
    const score = totals[k] / w;
    const delta = deltas[k] / w;
    const c = conf[k] / w;
    const unusual = unusualCount[k] >= 2;
    const entering = Math.abs(score) >= 35 && Math.abs(delta) >= 20;
    const exiting = Math.abs(score) < 15 && Math.abs(delta) >= 20;

    participants[k] = {
      key: k,
      score: Math.round(clamp(score, -100, 100)),
      action: classify(score, score),
      confidence: Math.round(clamp(c + (unusual ? 8 : 0), 0, 100)),
      entering,
      exiting,
      unusual,
      delta: Math.round(delta),
    };
  });

  return {
    updatedAt,
    participants,
    heavyActivity: heavy || Object.values(participants).some((p) => p.unusual),
    alerts: Array.from(alertSet).slice(0, 8),
  };
}
