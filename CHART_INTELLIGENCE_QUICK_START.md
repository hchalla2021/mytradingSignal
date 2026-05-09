# ⚡ REAL-TIME CHART INTELLIGENCE QUICK START

Get real-time chart intelligence with support/resistance, order blocks, FVG, and more in **5 minutes**.

## 🚀 Step 1: Backend Setup

### Add to `backend/main.py`

Find the section where routers are imported and add:

```python
# ════════════════════════════════════════════════════════════════
# Chart Intelligence Router
# ════════════════════════════════════════════════════════════════
from routers.chart_intelligence_advanced_router import router as chart_intel_router

# Include the router
app.include_router(chart_intel_router, prefix="/api", tags=["Chart Intelligence"])
```

### Verify Backend Startup

```bash
cd backend
python main:app --reload --host 0.0.0.0 --port 8000
```

Expected output:
```
✓ Chart Intelligence Advanced Engine initialized
✓ Endpoints registered: /api/chart/advanced/{symbol}, /ws/chart/{symbol}
✓ Server started on http://0.0.0.0:8000
```

## 💻 Step 2: Frontend Integration

### Option A: Use Pre-built Panel Component

```tsx
// pages/dashboard.tsx
'use client';

import { ChartIntelligencePanel } from '@/components/AdvancedChartIntelligencePanel';

export default function Dashboard() {
  return (
    <div className="space-y-8 p-8 bg-slate-950 min-h-screen">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-slate-100">
          Real-Time Chart Intelligence
        </h1>
        <p className="text-slate-400 mt-2">
          Support/Resistance • Order Blocks • FVG • BOS • Liquidity
        </p>
      </div>

      {/* 3-column layout for indices */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <ChartIntelligencePanel symbol="NIFTY" showDetails={true} />
        <ChartIntelligencePanel symbol="BANKNIFTY" showDetails={true} />
        <ChartIntelligencePanel symbol="SENSEX" showDetails={true} />
      </div>
    </div>
  );
}
```

### Option B: Custom Component with Hook

```tsx
// components/MyChartView.tsx
'use client';

import { useAdvancedChartIntelligence } from '@/hooks/useAdvancedChartIntelligence';

export function MyChartView() {
  const intel = useAdvancedChartIntelligence('NIFTY', true);

  return (
    <div className="p-6 bg-slate-900 rounded-lg">
      {/* Price Display */}
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-slate-100">
          ₹{intel.data?.current_price.toFixed(2)}
        </h2>
        <p className="text-slate-400 text-sm">
          Day High: ₹{intel.data?.day_high.toFixed(2)} | 
          Day Low: ₹{intel.data?.day_low.toFixed(2)}
        </p>
      </div>

      {/* Support Zones */}
      <div className="mb-6">
        <h3 className="font-bold text-slate-200 mb-3">Support Zones</h3>
        <div className="space-y-2">
          {intel.data?.support_zones.map((zone) => (
            <div key={zone.price} className="p-3 bg-slate-800 rounded flex justify-between">
              <span className="text-slate-300">₹{zone.price.toFixed(2)}</span>
              <span className="text-sm">
                <span className={`px-2 py-1 rounded text-xs ${
                  zone.quality === 'PREMIUM' ? 'bg-emerald-500/20 text-emerald-400' : ''
                }`}>
                  {zone.quality}
                </span>
                <span className="ml-2 text-slate-400">{zone.touch_count} touches</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Order Blocks */}
      <div>
        <h3 className="font-bold text-slate-200 mb-3">Order Blocks</h3>
        <div className="space-y-2">
          {intel.data?.order_blocks.map((ob, idx) => (
            <div key={idx} className="p-3 bg-slate-800 rounded">
              <div className="flex justify-between items-center">
                <span className={`text-sm font-bold ${
                  ob.type === 'BULLISH' ? 'text-emerald-400' : 'text-red-400'
                }`}>
                  {ob.type}
                </span>
                <span className="text-slate-400 text-sm">
                  ₹{ob.price_low.toFixed(2)} - ₹{ob.price_high.toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Refresh Button */}
      <button
        onClick={() => intel.refresh()}
        disabled={intel.loading}
        className="mt-6 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded text-white disabled:opacity-50"
      >
        {intel.loading ? 'Refreshing...' : 'Refresh'}
      </button>
    </div>
  );
}
```

## 🧪 Step 3: Test the System

### Test REST API

```bash
# Get chart intelligence for NIFTY
curl http://localhost:8000/api/chart/advanced/NIFTY | jq

# Get summary for all symbols
curl http://localhost:8000/api/chart/advanced/summary | jq

# Force refresh (bypass cache)
curl http://localhost:8000/api/chart/advanced/NIFTY?force_refresh=true | jq
```

### Test WebSocket

```bash
# Install wscat
npm install -g wscat

# Connect to WebSocket
wscat -c ws://localhost:8000/ws/chart/NIFTY

# You should see real-time updates every 3 seconds
```

### Test Browser Console

```javascript
// Open browser console (F12) and run:

const ws = new WebSocket('ws://localhost:8000/ws/chart/NIFTY');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
};

// You should see chart intelligence data flowing in real-time
```

## 📊 Step 4: Understand the Output

### Response Structure

```json
{
  "symbol": "NIFTY",
  "status": "SUCCESS",
  "market_status": "LIVE",
  "current_price": 50150.50,
  "timestamp": "2025-05-09T10:30:45Z",
  
  // Daily Levels (updated real-time)
  "day_high": 50300.00,
  "day_low": 49950.00,
  "prev_day_high": 50200.00,
  "prev_day_low": 49800.00,
  "prev_day_close": 50050.00,
  
  // Support & Resistance Zones
  "support_zones": [
    {
      "price": 49850.50,
      "type": "SUPPORT",
      "strength": 0.85,        // 0-1 scale
      "heat_level": 5,         // 1-5 (Slate to Red)
      "quality": "PREMIUM",    // PREMIUM / STANDARD / WEAK
      "touch_count": 4,        // How many times tested
      "confluence_factors": ["SWING_POINT", "VOLUME_CLUSTER"]
    }
  ],
  "resistance_zones": [...],
  
  // Order Blocks (Supply/Demand Zones)
  "order_blocks": [
    {
      "price_high": 50200.00,
      "price_low": 49950.00,
      "type": "BULLISH",       // Institution was buying here
      "strength": 0.92,
      "quality": "PREMIUM",
      "touched": false,        // Has price tested this zone?
      "mitigated": false       // Has it been broken?
    }
  ],
  
  // Fair Value Gaps (Imbalance Zones)
  "fair_value_gaps": [
    {
      "price_high": 50150.00,
      "price_low": 50050.00,
      "type": "BULLISH",       // Gap was created by upward move
      "size_pct": 0.002,       // 0.2% gap size
      "filled": false,         // Still unfilled?
      "fill_ratio": 0.15,      // 15% filled so far
      "quality": "PREMIUM"
    }
  ],
  
  // Break of Structure (Trend Signal)
  "breaks_of_structure": [
    {
      "timestamp": "2025-05-09T10:25:00Z",
      "price_level": 50300.00,
      "direction": "UP",           // Breaking higher
      "strength": 0.87,
      "volume_confirmation": 1.8   // 1.8x average volume
    }
  ],
  
  // Hidden Stops (Liquidity Pools)
  "buy_side_liquidity": [
    {
      "price": 49800.00,
      "type": "BUY_SIDE",      // Where traders hide BUY stops
      "strength": 0.78,
      "swept": false           // Has this level been swept?
    }
  ],
  "sell_side_liquidity": [...],
  
  // Metadata
  "analysis_confidence": 92.5,  // 0-100 (how reliable is analysis)
  "candles_analyzed": 120,       // Number of candles used
  "cache_hit": false,            // Was this from cache?
  "cache_age_seconds": 0
}
```

### What Each Zone Means for Trading

| Zone | Meaning | Use |
|------|---------|-----|
| **Support** | Price bounced here before | Buy near these levels |
| **Resistance** | Price rejected here before | Sell near these levels |
| **Order Block** | Institution accumulated/distributed here | Expect support/rejection |
| **FVG** | Imbalance that must be filled | Price likely returns to fill it |
| **BOS** | Structure broken, trend confirmed | Enter in direction of break |
| **Liquidity** | Where hidden stops are | Watch for sweeps and reversals |

## 🎯 Step 5: Integrate with Your Chart

### Canvas Rendering Example

```javascript
// If using a canvas-based chart:

function drawChartIntelligence(ctx, intel, priceToY, canvasWidth) {
  const data = intel.data;
  if (!data) return;

  // Draw support zones (green)
  data.support_zones.forEach((zone) => {
    const y = priceToY(zone.price);
    const alpha = zone.heat_level / 5;  // 1-5 scale to 0.2-1.0
    ctx.strokeStyle = `rgba(34, 197, 94, ${alpha})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvasWidth, y);
    ctx.stroke();
    
    // Draw label
    ctx.fillStyle = `rgba(34, 197, 94, ${alpha})`;
    ctx.font = '12px Arial';
    ctx.fillText(`S: ₹${zone.price.toFixed(2)}`, 10, y - 5);
  });

  // Draw order blocks (shaded areas)
  data.order_blocks.forEach((ob) => {
    const y_high = priceToY(ob.price_high);
    const y_low = priceToY(ob.price_low);
    const fillColor = ob.type === 'BULLISH'
      ? 'rgba(34, 197, 94, 0.1)'  // Green for bullish
      : 'rgba(239, 68, 68, 0.1)'; // Red for bearish
    
    ctx.fillStyle = fillColor;
    ctx.fillRect(0, y_low, canvasWidth, y_high - y_low);
  });

  // Draw Fair Value Gaps
  data.fair_value_gaps.forEach((fvg) => {
    const y_high = priceToY(fvg.price_high);
    const y_low = priceToY(fvg.price_low);
    ctx.strokeStyle = fvg.type === 'BULLISH' ? '#3b82f6' : '#f472b6';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(0, y_low, canvasWidth, y_high - y_low);
    ctx.setLineDash([]);
  });
}

// In your animation loop:
function drawChart() {
  const intel = useAdvancedChartIntelligence('NIFTY');
  drawChartIntelligence(ctx, intel, priceToY, canvasWidth);
}
```

## ✅ Verification

```bash
# 1. Backend running?
curl http://localhost:8000/api/chart/health

# 2. Getting real data?
curl http://localhost:8000/api/chart/advanced/NIFTY | jq '.candles_analyzed'
# Should be >= 20

# 3. WebSocket working?
wscat -c ws://localhost:8000/ws/chart/NIFTY
# Should receive messages every 3 seconds

# 4. Frontend rendering?
# Open browser console, should see no errors
# Component should show data flowing in real-time
```

## 🐛 Troubleshooting

### "No market data available"
```bash
# Check if candles are in cache
redis-cli GET "analysis_candles:NIFTY"

# If empty, try during market hours or force refresh
curl http://localhost:8000/api/chart/advanced/NIFTY?force_refresh=true
```

### "WebSocket won't connect"
```bash
# Check WebSocket URL in frontend/lib/env-detection.ts
console.log('WS URL:', getEnvironmentConfig().WS_URL)

# Should be: ws://localhost:8000 (or your server URL)
```

### "Getting stale data"
```javascript
// Check if data is fresh
console.log('Age:', intel.data?.cache_age_seconds);
console.log('Is stale:', intel.isStale);
console.log('Connected:', intel.isConnected);

// Force refresh
intel.refresh();
```

## 📈 Next Steps

1. ✅ System running and data flowing
2. 📊 Customize component styling
3. 🔔 Add alert notifications for zone proximity
4. 📱 Add responsive mobile layout
5. 🚀 Deploy to production

---

**Status**: Ready to trade! ✅

For detailed information, see: `REAL_TIME_CHART_INTELLIGENCE_GUIDE.md`
