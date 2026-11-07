'use client';

import { useEffect, useRef, useState } from 'react';
import { API_CONFIG } from '@/lib/api-config';
import { getOrCreateVisitorId } from '@/lib/visitor-id';
import { isAqteActivityEvent, type AQTEActivityEvent } from '@/lib/aqte-display';

type StreamStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';
const CURSOR_KEY = 'aqte-live-event-cursor';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

export function useAqteEventStream() {
  const [events, setEvents] = useState<AQTEActivityEvent[]>([]);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const cursor = useRef(0);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 1000;
    try {
      const savedCursor = Number(sessionStorage.getItem(CURSOR_KEY));
      if (Number.isSafeInteger(savedCursor) && savedCursor > 0) cursor.current = savedCursor;
    } catch {
      cursor.current = 0;
    }

    const acceptEvents = (incoming: AQTEActivityEvent[]) => {
      if (!incoming.length) return;
      setEvents(previous => {
        const byId = new Map(previous.map(event => [event.id, event]));
        incoming.forEach(event => byId.set(event.id, event));
        const ordered = Array.from(byId.values()).sort((a, b) => a.id - b.id).slice(-100);
        const latest = ordered[ordered.length - 1];
        if (latest && latest.id > cursor.current) {
          cursor.current = latest.id;
          try {
            sessionStorage.setItem(CURSOR_KEY, String(latest.id));
          } catch {
            // The in-memory cursor still supports reconnects while this page remains open.
          }
        }
        return ordered.reverse();
      });
    };

    const connect = () => {
      if (!active) return;
      setStatus(cursor.current ? 'reconnecting' : 'connecting');
      try {
        const url = new URL(API_CONFIG.wsUrl);
        url.protocol = url.protocol === 'https:' ? 'wss:' : url.protocol === 'http:' ? 'ws:' : url.protocol;
        url.pathname = '/api/aqte/events';
        url.search = '';
        url.searchParams.set('device_id', getOrCreateVisitorId());
        url.searchParams.set('after', String(cursor.current));
        socket = new WebSocket(url.toString());
      } catch {
        setStatus('reconnecting');
        reconnectTimer = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        return;
      }

      socket.onopen = () => {
        reconnectDelay = 1000;
        if (active) setStatus('connected');
      };
      socket.onmessage = message => {
        if (typeof message.data !== 'string') return;
        let payload: unknown;
        try {
          payload = JSON.parse(message.data);
        } catch {
          return;
        }
        if (!isRecord(payload)) return;
        if (payload.type === 'event' && isAqteActivityEvent(payload.event)) {
          acceptEvents([payload.event]);
        } else if (payload.type === 'history' && Array.isArray(payload.events)) {
          acceptEvents(payload.events.filter(isAqteActivityEvent));
        }
      };
      socket.onclose = closeEvent => {
        socket = null;
        if (!active) return;
        if (closeEvent.code === 4401 || closeEvent.code === 4403) {
          setStatus('offline');
          reconnectTimer = setTimeout(connect, 30000);
          return;
        }
        setStatus('reconnecting');
        reconnectTimer = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      };
      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  return { events, status };
}
