import type { Candle } from '@/hooks/useChartIntelligence';
import { candleTime, sessionDate } from './chart-workspace';

export interface ChartPaperTrade {
  id: string;
  symbol: string;
  timeframe: number;
  strategy: string;
  side: 'BUY' | 'SELL';
  entry_at: string;
  entry_price: number;
  stop: number;
  target: number;
  exit_at: string | null;
  exit_price: number | null;
  exit_reason: string | null;
  points: number | null;
  unrealized_points: number;
}

export function selectChartPaperTrade(trades: ChartPaperTrade[], selectedId: string | null) {
  return trades.find(trade => trade.id === selectedId)
    ?? trades.find(trade => !trade.exit_at && trade.strategy === 'Chart confirmed setup')
    ?? trades.find(trade => !trade.exit_at)
    ?? trades[0]
    ?? null;
}

/** Execution timestamps fall within candles, not necessarily on their opening timestamp. */
export function paperEventCandle(candles: Candle[], timestamp: string, timeframe: number) {
  const at = Date.parse(timestamp) / 1000;
  if (!Number.isFinite(at)) return null;
  for (let i = candles.length - 1; i >= 0; i--) {
    const time = candleTime(candles[i]);
    if (time <= at) return sessionDate(time) === sessionDate(at) && at < time + timeframe * 60 ? time : null;
  }
  return null;
}

export function chartPaperLevels(trade: ChartPaperTrade) {
  return [
    { id: 'entry', value: trade.entry_price, text: `${trade.side} ENTRY`, color: trade.side === 'BUY' ? '#00d895' : '#38bdf8', at: trade.entry_at },
    { id: 'target', value: trade.target, text: 'TARGET / EXIT', color: '#00d895', at: trade.entry_at },
    { id: 'stop', value: trade.stop, text: 'STOP LOSS', color: '#ff5065', at: trade.entry_at },
    ...(trade.exit_at && trade.exit_price !== null ? [{
      id: 'exit', value: trade.exit_price,
      text: trade.exit_reason === 'STOP_LOSS' ? 'STOP HIT / EXIT' : `EXIT ${trade.exit_reason ?? ''}`,
      color: trade.exit_reason === 'STOP_LOSS' ? '#ff5065' : '#c084fc', at: trade.exit_at,
    }] : []),
  ];
}
