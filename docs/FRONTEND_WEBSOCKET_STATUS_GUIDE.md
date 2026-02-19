# 🎨 Frontend Implementation Guide - WebSocket Status Display

## Overview

The backend now sends **enhanced status messages** to help users understand what's happening when the connection is unstable. This guide shows how to implement the UI components to display these messages clearly.

---

## 📡 New WebSocket Message Types

### 1. `connection_status` (Sent when client connects)

**When:** Immediately after WebSocket handshake  
**Purpose:** Tell UI what mode we're in and why

```json
{
  "type": "connection_status",
  "mode": "WebSocket",              // or "REST API Polling"
  "quality": "EXCELLENT",            // or "DEGRADED", "POOR"
  "message": "✓ Connected and receiving live data",
  "market_status": "LIVE",           // or "PRE_OPEN", "FREEZE", "CLOSED"
  "auth_required": false,
  "timestamp": "2024-02-19T09:15:00+05:30"
}
```

**Possible values:**

| mode | quality | message | When? |
|------|---------|---------|-------|
| WebSocket | EXCELLENT | Connected and receiving live data | Normal operation |
| WebSocket | DEGRADED | Connected but low tick frequency | Bad network |
| WebSocket | POOR | Reconnecting to market feed... | Network drop |
| REST API Polling | - | Using REST API (WebSocket unavailable) | Token expired |
| - | - | Please login to enable live data | Not authenticated |

---

### 2. `heartbeat` (Every 30 seconds)

**When:** Every 30 seconds during market hours  
**Purpose:** Keep connection alive AND send health metrics

```json
{
  "type": "heartbeat",
  "timestamp": "2024-02-19T09:15:30+05:30",
  "connections": 3,                  // Total clients connected
  "marketStatus": "LIVE",
  "connectionHealth": {
    "state": "connected",            // "connected", "stale", "disconnected"
    "is_healthy": true,
    "is_stale": false,
    "connection_quality": 98.5,       // 0-100 percentage
    "using_rest_fallback": false,
    "last_tick_seconds_ago": 0.8
  }
}
```

---

### 3. `status` (When feed mode changes)

**When:** Feed switches from WebSocket → REST or vice versa  
**Purpose:** Alert user of mode change

```json
{
  "type": "status",
  "status": "LIVE",
  "message": "📡 Using REST API (WebSocket temporarily unavailable)"
}
```

---

## 🎯 Frontend Implementation Examples

### React Hook: useWebSocketStatus

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';

interface ConnectionStatus {
  mode: 'WebSocket' | 'REST API Polling';
  quality: 'EXCELLENT' | 'DEGRADED' | 'POOR' | 'UNKNOWN';
  message: string;
  isHealthy: boolean;
  requiresLogin: boolean;
}

export function useWebSocketStatus() {
  const [status, setStatus] = useState<ConnectionStatus>({
    mode: 'WebSocket',
    quality: 'UNKNOWN',
    message: 'Connecting...',
    isHealthy: false,
    requiresLogin: false,
  });

  const wsRef = useRef<WebSocket | null>(null);

  const handleConnectionStatus = useCallback((data: any) => {
    const isHealthy =
      data.quality === 'EXCELLENT' ||
      (data.quality === 'DEGRADED' && !data.message.includes('Reconnecting'));

    setStatus({
      mode: data.mode || 'WebSocket',
      quality: data.quality || 'UNKNOWN',
      message: data.message,
      isHealthy,
      requiresLogin: data.auth_required || false,
    });
  }, []);

  const handleHeartbeat = useCallback((data: any) => {
    const health = data.connectionHealth;

    // Update status based on heartbeat health metrics
    let quality: ConnectionStatus['quality'] = 'EXCELLENT';
    if (health.connection_quality < 50) {
      quality = 'POOR';
    } else if (health.connection_quality < 80) {
      quality = 'DEGRADED';
    }

    setStatus((prev) => ({
      ...prev,
      quality,
      isHealthy: health.is_healthy,
      mode: health.using_rest_fallback ? 'REST API Polling' : 'WebSocket',
    }));
  }, []);

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8000/ws/market');

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'connection_status') {
          handleConnectionStatus(data);
        } else if (data.type === 'heartbeat') {
          handleHeartbeat(data);
        }
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    };

    ws.onerror = () => {
      setStatus({
        mode: 'WebSocket',
        quality: 'POOR',
        message: '❌ Connection error - retrying...',
        isHealthy: false,
        requiresLogin: false,
      });
    };

    wsRef.current = ws;

    return () => {
      ws.close();
    };
  }, [handleConnectionStatus, handleHeartbeat]);

  return status;
}
```

---

### Component: ConnectionStatusIndicator

```typescript
import React from 'react';
import { useWebSocketStatus } from './useWebSocketStatus';

export function ConnectionStatusIndicator() {
  const status = useWebSocketStatus();

  // Color coding based on quality
  const colorMap = {
    EXCELLENT: 'bg-green-500',
    DEGRADED: 'bg-yellow-500',
    POOR: 'bg-red-500',
    UNKNOWN: 'bg-gray-500',
  };

  const iconMap = {
    EXCELLENT: '✓',
    DEGRADED: '⚠️',
    POOR: '❌',
    UNKNOWN: '⏳',
  };

  const bgColor = colorMap[status.quality] || 'bg-gray-500';
  const icon = iconMap[status.quality] || '?';

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-800">
      {/* Status Indicator LED */}
      <div className={`w-2 h-2 rounded-full ${bgColor} animate-pulse`} />

      {/* Connection Mode Badge */}
      <span className="text-xs font-mono text-neutral-400">
        {status.mode === 'REST API Polling' ? '📡 REST' : '🔗 WebSocket'}
      </span>

      {/* Status Icon and Message */}
      <span className="text-xs text-neutral-300 flex-1">{icon} {status.message}</span>

      {/* Quality Score */}
      {status.quality !== 'UNKNOWN' && (
        <span className="text-xs text-neutral-500 ml-2">
          {status.quality[0]}
        </span>
      )}

      {/* Login Prompt */}
      {status.requiresLogin && (
        <button className="text-xs px-2 py-1 ml-2 bg-blue-600 hover:bg-blue-700 rounded text-white">
          🔑 Login
        </button>
      )}
    </div>
  );
}
```

---

### Component: ConnectionQualityBadge

Shows detailed health metrics (for debugging/monitoring):

```typescript
export function ConnectionQualityBadge() {
  const [health, setHealth] = useState<any>(null);

  // Listen to heartbeat messages to get detailed health
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8000/ws/market');

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'heartbeat' && data.connectionHealth) {
        setHealth(data.connectionHealth);
      }
    };

    return () => ws.close();
  }, []);

  if (!health) return null;

  return (
    <div className="text-xs text-neutral-400 space-y-1 p-2 bg-neutral-950 rounded border border-neutral-800 font-mono">
      <div>State: <span className="text-white">{health.state}</span></div>
      <div>Quality: <span className="text-white">{health.connection_quality}%</span></div>
      <div>Last tick: <span className="text-white">{health.last_tick_seconds_ago}s ago</span></div>
      {health.using_rest_fallback && (
        <div className="text-yellow-500">⚠️ REST API Fallback Active</div>
      )}
    </div>
  );
}
```

---

### Component: ReconnectingOverlay

Show when connection is poor/reconnecting:

```typescript
export function ReconnectingOverlay() {
  const status = useWebSocketStatus();

  if (status.quality !== 'POOR' && !status.message.includes('Reconnecting')) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-neutral-900 border border-red-500 rounded-lg p-6 max-w-md">
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-3 h-3 bg-red-500 rounded-full animate-pulse"
          />
          <h2 className="text-lg font-semibold text-white">
            Reconnecting to market feed...
          </h2>
        </div>

        <p className="text-neutral-400 mb-4">
          {status.message}
        </p>

        {status.message.includes('token') && (
          <button className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white font-semibold">
            🔑 Refresh Token
          </button>
        )}

        <p className="text-xs text-neutral-500 mt-4">
          Connection will resume automatically. No action needed.
        </p>
      </div>
    </div>
  );
}
```

---

### Integration in Dashboard

```typescript
export function TradingDashboard() {
  return (
    <div className="h-screen bg-neutral-950">
      {/* Header with connection status */}
      <header className="bg-neutral-900 border-b border-neutral-800 p-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">My Daily Trading Signals</h1>
        
        {/* Connection indicator - top right */}
        <ConnectionStatusIndicator />
      </header>

      {/* Main content */}
      <main className="p-6">
        {/* Your trading cards, charts, etc. */}
      </main>

      {/* Show reconnecting overlay when disconnected */}
      <ReconnectingOverlay />
    </div>
  );
}
```

---

## 🎨 CSS Classes for Status Styling

```css
/* Connection status colors */
.connection-excellent {
  @apply text-green-400;
}

.connection-degraded {
  @apply text-yellow-400;
}

.connection-poor {
  @apply text-red-400;
}

/* Pulse animation for indicator */
.indicator-pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

/* Reconnecting spinner */
.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid #4b5563;
  border-radius: 50%;
  border-top: 2px solid #fff;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
```

---

## 🔔 Toast Notifications

Show important status changes as toasts:

```typescript
function showConnectionToast(message: string, type: 'error' | 'warning' | 'success' | 'info') {
  // Using react-hot-toast or similar library
  toast.custom((t) => (
    <div className={`px-4 py-3 rounded-lg text-white space-x-2 flex items-center
      ${type === 'error' && 'bg-red-600'}
      ${type === 'warning' && 'bg-yellow-600'}
      ${type === 'success' && 'bg-green-600'}
      ${type === 'info' && 'bg-blue-600'}
    `}>
      <span>{getIcon(type)}</span>
      <span>{message}</span>
    </div>
  ));
}

// Usage
useEffect(() => {
  if (status.quality === 'POOR') {
    showConnectionToast('Reconnecting to market feed...', 'warning');
  } else if (status.quality === 'EXCELLENT') {
    showConnectionToast('Connected to live market data', 'success');
  }
}, [status.quality]);
```

---

## 📱 Mobile Responsive

Make status indicators mobile-friendly:

```typescript
// Hide detailed metrics on mobile
export function ConnectionStatusIndicator() {
  return (
    <div className="flex items-center gap-2">
      {/* Always show */}
      <div className={`w-2 h-2 rounded-full ${bgColor}`} />

      {/* Hide on mobile */}
      <span className="text-xs hidden sm:inline text-neutral-400">
        {status.mode}
      </span>

      {/* Mobile: show only icon */}
      <span className="sm:hidden text-lg">{icon}</span>
    </div>
  );
}
```

---

## ✅ Checklist

Implement these features:

- [ ] Display `connection_status` on initial WebSocket connect
- [ ] Update status from `heartbeat` messages every 30 seconds
- [ ] Show indicator LED (green/yellow/red) based on quality
- [ ] Show modal/overlay when reconnecting (quality = POOR)
- [ ] Display "📡 REST API" badge when using fallback mode
- [ ] Show "🔐 Login" button when `auth_required = true`
- [ ] Pulse animation on status indicator
- [ ] Toast notifications for major status changes
- [ ] Hide detailed metrics on mobile
- [ ] Test 9:00-9:15 AM transition doesn't show spurious "reconnecting" messages

---

## 🧪 Testing the Implementation

### Test 1: Initial Connection
```
✓ Client connects
✓ Receives connection_status message
✓ Displays "WebSocket" or "REST API Polling" mode
✓ Shows appropriate icon/color
```

### Test 2: Normal Operation
```
✓ Heartbeat received every 30 seconds
✓ Quality stays EXCELLENT (green)
✓ Shows latest tick time (< 1s ago)
```

### Test 3: Network Interruption
```
✓ Pull network cable
✓ After 10s, quality changes to POOR (red)
✓ Message shows "Reconnecting..."
✓ Overlay appears
✓ No "Reconnecting" message spam
```

### Test 4: Pre-open Transition (9:07-9:15 AM)
```
✓ At 9:07 AM: quality may show DEGRADED (yellow) due to low ticks
✓ Message: "Connected but low tick frequency"
✓ At 9:15 AM: quality improves to EXCELLENT (green)
✓ No reconnecting overlay appears
```

---

**Version:** 1.0  
**Last Updated:** February 19, 2026  
**Status:** Production Ready
