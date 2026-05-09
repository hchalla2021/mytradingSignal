# Real-Time Chart Intelligence: POI Implementation Guide

## Overview

This guide explains how to integrate the **Real-Time Point of Interest (POI) Analysis Engine** into your trading dashboard. The system detects genuine institutional positioning levels using real market data — NO synthetic data.

## What is POI (Point of Interest)?

Points of Interest are genuine price levels where institutional traders have accumulated positions. Unlike arbitrary support/resistance lines, POIs are derived from actual market microstructure:

### POI Types

1. **VOLUME_CLUSTER** 📊
   - Price levels with concentrated trading volume
   - Multiple candles trading in a tight price range
   - Indicates zone of institutional absorption/distribution

2. **MULTIPLE_TOUCH** 🔄
   - Support/resistance levels tested 2+ times
   - Each test adds institutional memory
   - 3+ touches = PREMIUM quality (strong POI)

3. **INDUCEMENT** ═
   - Equal highs or equal lows
   - Institutional trap/fake-out levels
   - Goal: Trap retail traders before powerful move
   - Volume confirmation increases quality

4. **VOLUME_IMBALANCE** ⚡
   - Single candle with abnormally high volume
   - Indicates aggressive institutional entry/exit
   - Aggressive move at specific price level

### Quality Grades

- **PREMIUM** ⭐⭐⭐: 3+ touches, confirmed by volume, high confluence
- **STANDARD** ⭐⭐: 2 touches or moderate volume confirmation
- **WEAK** ⭐: Single event, low institutional strength

### Heat Levels

Visualization intensity (1-5) based on institutional strength:
- **Heat 1** (Slate): Weak POI, minimal institutional activity
- **Heat 2-3** (Amber): Moderate, worth monitoring
- **Heat 4-5** (Red): Premium POI, strong institutional presence

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ZERODHA KITE API                         │
│                  Real-Time Market Data                       │
└──────────────────────────┬──────────────────────────────────┘
                           │ OHLCV Candles + Volume
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Backend: POI Analyzer Engine                    │
│  (services/poi_analyzer.py)                                 │
│                                                              │
│  • Volume Profile Analysis                                  │
│  • Multiple Touch Detection                                 │
│  • Inducement Enhancement                                  │
│  • Volume Imbalance Detection                              │
│  • Confluence Scoring                                       │
│  • Heat Level Calculation                                   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│        FastAPI Endpoint: /api/advanced/poi/{symbol}         │
│  (routers/advanced_analysis.py)                            │
│                                                              │
│  • Caching: 3s (LIVE), 30s (closed)                        │
│  • Response: POI levels + metadata                         │
│  • Performance: <20ms cached, <100ms live                 │
└──────────────────────────┬──────────────────────────────────┘
                           │
          ┌────────────────┴────────────────┐
          │                                 │
          ▼                                 ▼
┌──────────────────────┐        ┌──────────────────────┐
│ useChartPOI Hook     │        │ useChartPOIMulti     │
│ (Single Symbol)      │        │ (Multi-Symbol)       │
│                      │        │                      │
│ • Real-time price    │        │ • Parallel fetch     │
│ • Staleness detect   │        │ • All 3 indices      │
│ • Batched updates    │        │ • 200ms batch        │
│ • 200ms debounce     │        │                      │
└──────────────────────┘        └──────────────────────┘
          │                                 │
          └────────────────┬────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Frontend Components                             │
│                                                              │
│  • POILegend.tsx: Display POI data                         │
│  • ChartIntelligence.tsx: Render POI zones on canvas      │
│  • Real-time proximity warnings                            │
│  • Heat-mapped visualization                               │
└─────────────────────────────────────────────────────────────┘
```

## Backend Implementation

### 1. POI Analyzer (`services/poi_analyzer.py`)

The core analysis engine using four parallel algorithms:

```python
from services.poi_analyzer import POIAnalyzer

analyzer = POIAnalyzer()

# Input: Real candle data + current price
candles = [
    {'t': '2026-05-09T10:00:00Z', 'o': 79000, 'h': 79100, 'l': 78900, 'c': 79050, 'v': 250000},
    # ... more candles ...
]
current_price = 79120.50

# Output: Genuine POI levels
pois = analyzer.analyze(candles, current_price)

# Each POI contains:
# - level: Price level
# - poi_type: 'VOLUME_CLUSTER' | 'MULTIPLE_TOUCH' | 'INDUCEMENT' | 'VOLUME_IMBALANCE'
# - touches: How many times touched
# - volume_score: 0-1 normalized volume intensity
# - quality: 'PREMIUM' | 'STANDARD' | 'WEAK'
# - institutional_strength: 0-1 strength score
# - heat_level: 1-5 visual intensity
# - confluence_factors: What makes this POI strong
```

### 2. API Endpoint (`routers/advanced_analysis.py`)

The `/api/advanced/poi/{symbol}` endpoint provides real-time POI data:

```python
@router.get("/poi/{symbol}")
async def get_points_of_interest(symbol: str) -> Dict[str, Any]:
    """
    Returns:
    {
      "symbol": "NIFTY",
      "status": "SUCCESS",
      "current_price": 79120.50,
      "pois": [
        {
          "level": 79000.0,
          "type": "VOLUME_CLUSTER",
          "touches": 4,
          "volume_score": 0.75,
          "quality": "PREMIUM",
          "age_candles": 8,
          "distance_pct": 0.152,
          "institutional_strength": 0.82,
          "heat_level": 5,
          "confluence_factors": ["volume", "multiple_touch"]
        },
        # ... more POIs ...
      ],
      "poi_count": 6,
      "top_pois": [...],
      "closest_poi": {...},
      "analysis_confidence": 95.2
    }
    """
```

**Caching Strategy:**
- **LIVE market (9:15-15:30 IST)**: 3-second cache
- **Pre/post-market**: 30-second cache
- **Backup cache**: 24 hours for data availability

**Performance:**
- Cached requests: <20ms
- Live analysis: <100ms
- Data freshness: Updates every 3s during trading hours

## Frontend Implementation

### 1. Hook: `useChartPOI` (Single Symbol)

```typescript
import { useChartPOI } from '@/hooks/useChartPOI';

function ChartPage({ symbol }: { symbol: string }) {
  const poi = useChartPOI(symbol, true); // true = enabled

  return (
    <div>
      {poi.loading && <p>Loading POI...</p>}
      {poi.error && <p>Error: {poi.error}</p>}
      
      {poi.data && (
        <>
          <p>POI Count: {poi.data.poi_count}</p>
          <p>Closest POI: ₹{poi.data.closest_poi?.level}</p>
          {poi.getProximityWarning(0.003) && (
            <div className="alert">{poi.getProximityWarning()}</div>
          )}
        </>
      )}
    </div>
  );
}
```

### 2. Hook: `useChartPOIMulti` (All 3 Indices)

```typescript
import { useChartPOIMulti } from '@/hooks/useChartPOI';

function DashboardPage() {
  const multiPOI = useChartPOIMulti(['NIFTY', 'BANKNIFTY', 'SENSEX']);

  return (
    <div className="grid grid-cols-3 gap-4">
      {['NIFTY', 'BANKNIFTY', 'SENSEX'].map(symbol => (
        <div key={symbol}>
          <h3>{symbol}</h3>
          <p>POIs: {multiPOI.data[symbol]?.poi_count || 0}</p>
        </div>
      ))}
    </div>
  );
}
```

### 3. Component: `POILegend`

Display POI data with real-time updates and proximity warnings:

```typescript
import { POILegend } from '@/components/POILegend';

function ChartPage() {
  const poi = useChartPOI('NIFTY');
  const currentPrice = marketData.NIFTY?.price ?? 0;

  return (
    <div className="space-y-4">
      <POILegend 
        poiData={poi.data}
        currentPrice={currentPrice}
        loading={poi.loading}
        error={poi.error}
      />
      {/* Chart rendering below */}
    </div>
  );
}
```

### 4. Chart Rendering Integration

In `ChartIntelligence.tsx`, add POI rendering:

```typescript
const renderPOI = useCallback((poi: POILevel, yAxisMap: (price: number) => number) => {
  const y = yAxisMap(poi.level);
  
  // Heat color mapping
  const heatColor = ['#1e293b', '#334155', '#d97706', '#f97316', '#dc2626'][poi.heat_level - 1];
  
  // Draw horizontal POI line
  ctx.strokeStyle = heatColor;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]); // dashed line
  ctx.beginPath();
  ctx.moveTo(chartLeft, y);
  ctx.lineTo(chartRight, y);
  ctx.stroke();
  ctx.setLineDash([]);
  
  // Draw POI label on right axis
  const label = `₹${poi.level.toFixed(1)} (${poi.poi_type})`;
  // ... text rendering code ...
}, []);

// In render loop:
if (poiRef.current && poiRef.current.length > 0) {
  const yAxisMap = (price: number) => {
    // map price to canvas Y coordinate
  };
  
  for (const poi of poiRef.current) {
    renderPOI(poi, yAxisMap);
  }
}
```

## Real Data Examples

### Example 1: Volume Cluster POI

```
Scenario: Price level 79,000
─────────────────────────────
Candles 5-9:     Multiple candles close to 79,000 ± ₹10
Total volume:    1,250,000 shares accumulated
Touches:         4 times in the range
Quality:         PREMIUM (4 touches + high volume)
Heat Level:      5 (red) — strong institutional level
Interpretation:  Institutions bought/sold heavily at 79,000
                 Price will likely respect this zone
```

### Example 2: Inducement Pattern

```
Scenario: Equal highs at 79,100
────────────────────────────────
First high:      Candle 3: reaches 79,100
Second high:     Candle 8: reaches 79,102 (within 0.12%)
Third high:      Candle 15: reaches 79,098 (within 0.12%)
Volume at level: High volume confirming institutions are there
Quality:         PREMIUM (3 equal highs)
Interpretation:  Retail traders think resistance broken
                 But institutions used it to trap shorts
                 Powerful move likely follows the break
```

### Example 3: Volume Imbalance

```
Scenario: Large volume on single candle
─────────────────────────────────────────
Average candle vol:  300,000
Candle 12 volume:    1,200,000 (4× average)
Price level:         78,950 (mid of the candle)
Quality:             STANDARD (single event)
Heat Level:          4 (orange)
Interpretation:      Institutional trader aggressively bought/sold
                     This price level will attract more institutional interest
```

## Integration Steps

### Step 1: Verify Backend Dependencies

```bash
cd backend
# poi_analyzer.py should be in services/
ls -la services/poi_analyzer.py
```

### Step 2: Test POI Endpoint

```bash
# During market hours
curl "http://localhost:8000/api/advanced/poi/NIFTY"

# Response should include:
# - poi_count: number > 0
# - pois: array of POI objects
# - closest_poi: nearest POI
# - analysis_confidence: 75-100%
```

### Step 3: Add to Frontend Component

In your chart component:

```typescript
import { useChartPOI } from '@/hooks/useChartPOI';
import { POILegend } from '@/components/POILegend';

export function ChartComponent({ symbol }: { symbol: string }) {
  const poi = useChartPOI(symbol);
  const { marketData } = useMarketSocket();
  
  return (
    <div className="flex gap-4">
      <div className="flex-1">
        {/* Your chart here */}
        <SymbolChartCard {...props} />
      </div>
      <div className="w-64 space-y-4">
        <POILegend 
          poiData={poi.data}
          currentPrice={marketData[symbol]?.price ?? 0}
          loading={poi.loading}
          error={poi.error}
        />
      </div>
    </div>
  );
}
```

### Step 4: Render POI on Canvas

In `ChartIntelligence.tsx` canvas render loop:

```typescript
// Add to CandleChart props
interface CandleChartProps {
  // ... existing props ...
  pois?: POILevel[];
}

// In render function:
if (pois && pois.length > 0) {
  for (const poi of pois) {
    drawPOIZone(ctx, poi, yAxisMap, chartLeft, chartRight);
  }
}
```

## Real-Time Update Flow

```
[LIVE MARKET]
     │
     ▼
[WebSocket tick arrives]
     │
     ├─→ Price updates in 0ms
     │   (liveSpotRef)
     │
     ├─→ BatchWindow 200ms
     │   (debounce state update)
     │
     └─→ State update triggers
         getProximityWarning()
         isNearPOI()
         → Render proximity indicator

[Every 3s]
     │
     ├─→ API: /api/advanced/poi/{symbol}
     │
     └─→ POIAnalyzer processes real data
         → Detects new/updated POIs
         → Updates closest_poi
         → Renders on canvas
```

## Performance Characteristics

| Operation | Time | Notes |
|-----------|------|-------|
| Proximity check | <1ms | Real-time, no API |
| Cached POI fetch | <20ms | Instant response |
| Live POI analysis | <100ms | Full recalculation |
| Price batching | 200ms | Smart debounce |
| API polling | 3s (LIVE) / 30s | Configurable |
| Heat rendering | <10ms | Per-POI calculation |

## Troubleshooting

### POI count is 0

**Cause:** Not enough market data or all POIs are outside view
**Fix:** 
- Ensure 60+ candles are loaded
- Check that current price is within reasonable range
- Verify market data has realistic volume

### POI levels seem random

**Cause:** POI analyzer detecting legitimate but weak confluences
**Fix:**
- Filter to PREMIUM quality only (poi.quality === 'PREMIUM')
- Increase institutional_strength threshold (> 0.65)
- Focus on closest_poi which is always relevant

### Proximity warnings too frequent

**Cause:** Threshold too high (default 0.3%)
**Fix:**
- Use `getProximityWarning(0.005)` for 0.5% threshold
- Only show warnings for PREMIUM POIs

### Performance lag

**Cause:** Rendering too many POIs
**Fix:**
- Limit to top 5-8 POIs: `pois.slice(0, 8)`
- Only draw POIs within 2% of current price
- Batch rendering with requestAnimationFrame

## Advanced Customization

### Adjust POI Sensitivity

In `poi_analyzer.py`:

```python
analyzer.volume_cluster_tolerance = 0.001  # tighter clustering (0.1%)
analyzer.equal_price_tolerance = 0.0008    # stricter inducements
analyzer.min_touches_standard = 3          # raise bar for STANDARD
analyzer.min_touches_premium = 4           # raise bar for PREMIUM
```

### Custom Heat Level Calculation

```python
def _compute_heat_level(self, poi: PointOfInterest) -> int:
    strength = poi.institutional_strength
    recency_bonus = 0 if poi.age_candles > 10 else 0.1
    
    adjusted = min(1.0, strength + recency_bonus)
    
    if adjusted >= 0.80:
        return 5
    # ... custom mapping ...
```

### Filter by Type

```typescript
const volumePOIs = poi.data?.pois.filter(p => p.type === 'VOLUME_CLUSTER');
const inductionPOIs = poi.data?.pois.filter(p => p.type === 'INDUCEMENT');
```

## Data Privacy & Security

✅ All POI analysis uses only:
- Public OHLCV market data
- Volume information
- Price levels

❌ NO personal data, account info, or trade history is analyzed

The system respects Zerodha's API terms and only processes public market data.

## References

- **Smart Money Concepts (SMC)**: Order blocks, fair value gaps, inducements
- **Market Microstructure**: Volume analysis, price clustering, institutional positioning
- **Technical Analysis**: Support/resistance, confluence zones

## Support

For issues or questions:

1. Check the implementation guide above
2. Verify API endpoint responds: `GET /api/advanced/poi/{SYMBOL}`
3. Inspect browser console for errors
4. Check backend logs: `backend/logs/`
5. Test with small dataset first (60 candles minimum)
