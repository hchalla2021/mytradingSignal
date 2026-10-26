'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Candle } from '@/hooks/useChartIntelligence';
import { useOrderFlow } from '@/hooks/useOrderFlow';
import { candleTime, isCashSession, type ChartSymbol } from '@/lib/chart-workspace';
import { mergeFuturesLiveCandles } from '@/lib/futures-live-candles';
import { freshness, istDay, type FreshnessState, type TerminalBar } from '@/lib/futures-terminal';
import type { OrderFlowSnapshot } from '@/lib/order-flow';
import {
  PRO_INTERVAL, buildProContext, proDecision, proReplay, type ProDecision, type ProReplay, type ProTrade,
} from '@/lib/pro-confluence';
import {
  loadCandles, loadContracts, readCachedCandles, readCachedContracts, type CandleState, type FuturesContract,
} from '@/components/FuturesChart';

export interface ProState {
  symbol: ChartSymbol;
  contract: FuturesContract | undefined;
  replay: ProReplay | null;
  decision: ProDecision;
  open: ProTrade | null;
  fresh: FreshnessState;
  /** Near-month 5m order flow (carries the futures − spot basis used to place labels on the cash chart). */
  snapshot: OrderFlowSnapshot | null;
  /** Near-month 5m futures candles (history + live), shared with the level-battle reading. */
  bars: TerminalBar[];
  lastPrice: number | null;
  error: string | null;
}

const EMPTY: Candle[] = [];

/** 5m close time, capped at the 15:30 IST session end. */
const barClose = (time: number) => Math.min(time + PRO_INTERVAL * 60, istDay(time) * 86_400 - 19_800 + 930 * 60);

/**
 * The single confirmation gate every chart shows: near-month future, 5m candles (20s history refresh + live recorded
 * bars) and 5m order flow. Recomputed only when a candle closes or its closed data changes, never per tick.
 */
export function useProConfluence(symbol: ChartSymbol, active: boolean): ProState {
  const [contracts, setContracts] = useState<{ symbol: ChartSymbol; items: FuturesContract[]; error: string | null }>(
    () => ({ symbol, items: readCachedContracts(symbol)?.value ?? [], error: null }));
  const [data, setData] = useState<CandleState>({ key: '', candles: [], error: null, updated: null });
  const [, setTick] = useState(0);

  const items = contracts.symbol === symbol ? contracts.items : readCachedContracts(symbol)?.value ?? [];
  const contract = items[0];
  const token = contract?.token;
  const key = `${symbol}:${token ?? ''}:${PRO_INTERVAL}`;
  const history = data.key === key ? data : token !== undefined ? readCachedCandles(symbol, token, PRO_INTERVAL)?.value : undefined;
  const flow = useOrderFlow(symbol, PRO_INTERVAL, token, active && token !== undefined, false);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick(value => value + 1), 5000);
    return () => clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    loadContracts(symbol).then(list => {
      if (!cancelled) setContracts({ symbol, items: list, error: null });
    }).catch((error: unknown) => {
      if (!cancelled) setContracts({ symbol, items: [], error: error instanceof Error ? error.message : 'Unable to load futures contracts.' });
    });
    return () => { cancelled = true; };
  }, [symbol, active]);

  useEffect(() => {
    if (!active || token === undefined) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const saved = readCachedCandles(symbol, token, PRO_INTERVAL);
    if (saved) setData(saved.value);
    const load = async () => {
      try {
        const next = await loadCandles(symbol, token, PRO_INTERVAL);
        if (!cancelled) setData(next);
      } catch (error) {
        if (!cancelled) setData(previous => ({ ...(previous.key === key ? previous : { key, candles: [], updated: null }),
          error: error instanceof Error ? error.message : 'Unable to load futures candles.' }));
      } finally {
        if (!cancelled) timer = setTimeout(() => void load(), 20_000);
      }
    };
    if (saved?.fresh) timer = setTimeout(() => void load(), Math.max(0, 20_000 - (Date.now() - (saved.value.updated ?? 0))));
    else void load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [symbol, token, key, active]);

  const nowMs = Date.now();
  const snapshot = flow.snapshot?.available && flow.snapshot.token === token ? flow.snapshot : null;
  const historyCandles = history?.candles ?? EMPTY;
  const candles = useMemo(() => mergeFuturesLiveCandles(historyCandles, flow.snapshot, symbol, token, PRO_INTERVAL, flow.live, Date.now(), history?.updated ?? 0),
    [historyCandles, flow.snapshot, symbol, token, flow.live, history?.updated]);
  const flowBars = snapshot?.bars;
  const bars = useMemo<TerminalBar[]>(() => {
    const oi = new Map((flowBars ?? []).map(bar => [bar.t, bar.oi] as const));
    return candles.map(candle => {
      const time = candleTime(candle);
      return { time, o: candle.o, h: candle.h, l: candle.l, c: candle.c, v: candle.v, oi: candle.oi ?? oi.get(time) ?? null };
    });
  }, [candles, flowBars]);
  let closed = bars.length;
  while (closed > 0 && barClose(bars[closed - 1].time) > nowMs / 1000) closed--;

  // The replay is heavy (engine per candle): rebuild it only when the closed candles or their recorded flow change.
  const lastClosed = bars[closed - 1];
  const closedFlow = lastClosed ? snapshot?.bars.find(bar => bar.t === lastClosed.time) : undefined;
  const signature = lastClosed ? [key, closed, lastClosed.time, lastClosed.o, lastClosed.h, lastClosed.l, lastClosed.c, lastClosed.v,
    bars[0].time, closedFlow?.d, closedFlow?.coverage, snapshot?.bars.length ?? 0, snapshot?.events.length ?? 0].join('|') : '';
  const cache = useRef<{ signature: string; replay: ProReplay | null }>({ signature: '', replay: null });
  if (cache.current.signature !== signature) {
    cache.current = {
      signature,
      replay: lastClosed ? proReplay(buildProContext(bars, snapshot?.bars ?? [], snapshot?.events ?? [], contract?.tickSize ?? 0.05), closed) : null,
    };
  }
  const replay = cache.current.replay;
  const fresh = freshness({
    nowMs, lastTick: snapshot?.lastTick ?? null, historyUpdated: history?.updated ?? null,
    streamLive: flow.live, inSession: isCashSession(nowMs),
  }).state;

  return {
    symbol, contract, replay, decision: proDecision(replay, fresh), fresh, snapshot, bars,
    open: replay?.trades.find(trade => trade.status === 'open') ?? null,
    lastPrice: bars[bars.length - 1]?.c ?? null,
    error: (contracts.symbol === symbol ? contracts.error : null) ?? (data.key === key ? data.error : null) ?? flow.error,
  };
}
