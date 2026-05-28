import type { MarketTick } from '@/hooks/useMarketSocket';

export type IndexKey = 'NIFTY' | 'BANKNIFTY' | 'SENSEX';

export interface IndexMoneyFlow {
  symbol: IndexKey;
  inflowCr: number;
  outflowCr: number;
  netFlowCr: number;
  grossFlowCr: number;
  flowBias: 'BUYERS' | 'SELLERS' | 'BALANCED';
  confidence: number;
  updatedAt: number;
}

interface FlowState {
  lastPrice: number;
  lastVolume: number;
  inflowCr: number;
  outflowCr: number;
  updatedAt: number;
}

const STATE = new Map<IndexKey, FlowState>();
const EPS = 0.05; // Cr threshold to avoid flicker labels

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function ensure(symbol: IndexKey, tick: MarketTick): FlowState {
  const cur = STATE.get(symbol);
  if (cur) return cur;
  const init: FlowState = {
    lastPrice: tick.price,
    lastVolume: tick.volume || 0,
    inflowCr: 0,
    outflowCr: 0,
    updatedAt: Date.now(),
  };
  STATE.set(symbol, init);
  return init;
}

function rupeesToCr(v: number): number {
  return v / 10000000;
}

export function updateIndexMoneyFlow(symbol: IndexKey, tick: MarketTick | null | undefined): IndexMoneyFlow | null {
  if (!tick || !tick.price || !Number.isFinite(tick.price)) return null;

  const s = ensure(symbol, tick);
  const dVol = Math.max(0, (tick.volume || 0) - s.lastVolume);
  const dPrice = tick.price - s.lastPrice;

  // Tick-level traded notional proxy in rupees; converted to Cr.
  const tradedCr = rupeesToCr(dVol * tick.price);

  if (tradedCr > 0) {
    if (dPrice > 0) {
      // Uptick with volume => buyer-led flow proxy.
      s.inflowCr += tradedCr;
    } else if (dPrice < 0) {
      // Downtick with volume => seller-led flow proxy.
      s.outflowCr += tradedCr;
    } else {
      // Flat price prints are split half-half.
      s.inflowCr += tradedCr * 0.5;
      s.outflowCr += tradedCr * 0.5;
    }
  }

  s.lastPrice = tick.price;
  s.lastVolume = tick.volume || s.lastVolume;
  s.updatedAt = Date.now();

  const inflow = s.inflowCr;
  const outflow = s.outflowCr;
  const net = inflow - outflow;
  const gross = inflow + outflow;
  const bias: IndexMoneyFlow['flowBias'] =
    net > EPS ? 'BUYERS' : net < -EPS ? 'SELLERS' : 'BALANCED';

  const confidence = clamp(gross > 0 ? Math.log10(gross + 1) * 28 : 0, 10, 95);

  return {
    symbol,
    inflowCr: Number(inflow.toFixed(2)),
    outflowCr: Number(outflow.toFixed(2)),
    netFlowCr: Number(net.toFixed(2)),
    grossFlowCr: Number(gross.toFixed(2)),
    flowBias: bias,
    confidence: Math.round(confidence),
    updatedAt: s.updatedAt,
  };
}

export function resetIndexMoneyFlow(): void {
  STATE.clear();
}
