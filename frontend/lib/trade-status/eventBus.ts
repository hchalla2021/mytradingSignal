import type { TradeSymbol } from '@/types/trade-status';

type TradeStatusEventMap = {
  heartbeat: { timestamp: number; connected: boolean };
  symbol_changed: { symbol: TradeSymbol; timestamp: number };
};

type TradeStatusEventName = keyof TradeStatusEventMap;

type TradeStatusHandler<T extends TradeStatusEventName> = (
  payload: TradeStatusEventMap[T]
) => void;

const EVENT_PREFIX = 'trade-status:event:';

function eventName<T extends TradeStatusEventName>(name: T): string {
  return `${EVENT_PREFIX}${name}`;
}

export function publishTradeStatusEvent<T extends TradeStatusEventName>(
  name: T,
  payload: TradeStatusEventMap[T]
): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(eventName(name), { detail: payload }));
}

export function subscribeTradeStatusEvent<T extends TradeStatusEventName>(
  name: T,
  handler: TradeStatusHandler<T>
): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const wrapped = (event: Event) => {
    const customEvent = event as CustomEvent<TradeStatusEventMap[T]>;
    handler(customEvent.detail);
  };

  window.addEventListener(eventName(name), wrapped as EventListener);
  return () => window.removeEventListener(eventName(name), wrapped as EventListener);
}
