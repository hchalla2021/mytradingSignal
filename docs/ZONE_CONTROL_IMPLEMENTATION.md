# Zone Control & Breakdown Risk System

## 🎯 Overview
High-performance support/resistance zone detection with breakdown prediction and bounce probability analysis.

---

## 🚀 Features

### Backend (Python)
- **Ultra-fast zone detection**: O(n log n) time complexity using vectorized NumPy operations
- **Smart zone clustering**: Groups nearby swing points into meaningful S/R zones
- **Volume-weighted strength**: Zones ranked by volume concentration
- **Breakdown risk scoring**: Predicts probability of price breaking through support (0-100%)
- **Bounce probability**: Calculates likelihood of price bouncing from support (0-100%)
- **Multi-touch validation**: Stronger zones = more price tests = higher reliability

### Frontend (React/Next.js)
- **Premium light green border**: Unique emerald-themed design
- **Bold typography**: All values prominently displayed with font-black
- **Real-time updates**: 5-second refresh interval
- **Gradient backgrounds**: Eye-catching emerald glow effects
- **Responsive grid**: Adapts to all screen sizes
- **Color-coded signals**: BUY_ZONE (green), SELL_ZONE (red), NEUTRAL (amber)

---

## 📊 Algorithm Details

### Zone Detection Process

1. **Swing Point Identification** (O(n))
   ```python
   # Vectorized detection of swing highs/lows
   is_swing_high = high[i] == max(high[i-5:i+6])
   is_swing_low = low[i] == min(low[i-5:i+6])
   ```

2. **Zone Clustering** (O(n log n))
   ```python
   # Group nearby levels within 0.5% tolerance
   if abs(price - cluster_avg) / cluster_avg * 100 <= 0.5:
       cluster.append(price)
   ```

3. **Strength Scoring** (0-100 points)
   - Touch count: 40 points max (more touches = stronger)
   - Volume strength: 30 points max (higher volume = stronger)
   - Proximity: 30 points max (closer to price = more relevant)

4. **Risk Calculation**
   - **Breakdown Risk**: Distance to support + support weakness + downtrend momentum
   - **Bounce Probability**: Support strength + proximity + resistance room

---

## 🔧 Technical Implementation

### Backend Service
**File**: `backend/services/zone_control_service.py`

```python
class ZoneControlEngine:
    """
    High-Performance Zone Analyzer
    - Lookback: 100 candles
    - Zone tolerance: 0.5%
    - Min touches: 2
    - Max zones tracked: 5 per side
    """
```

**Key Methods**:
- `analyze()`: Main entry point (target: <8ms)
- `_find_swing_points()`: Vectorized swing detection
- `_create_zones()`: Clustering algorithm
- `_calculate_breakdown_risk()`: Risk scoring
- `_calculate_bounce_probability()`: Bounce prediction

### API Endpoints
**File**: `backend/routers/advanced_analysis.py`

```
GET /api/advanced/zone-control/{symbol}
- Returns: Zone data, risk metrics, signals

GET /api/advanced/zone-control/all
- Returns: All 3 indices in parallel
```

**Response Structure**:
```json
{
  "symbol": "NIFTY",
  "current_price": 23500.50,
  "zones": {
    "support": [
      {
        "level": 23450.25,
        "touches": 3,
        "volume_strength": 1.8,
        "distance_pct": -0.21,
        "strength": 85,
        "active": true
      }
    ],
    "resistance": [...]
  },
  "nearest_zones": {
    "support": {
      "level": 23450.25,
      "distance_pct": -0.21,
      "strength": 85,
      "touches": 3
    },
    "resistance": {...}
  },
  "risk_metrics": {
    "breakdown_risk": 35,
    "bounce_probability": 75,
    "zone_strength": "STRONG"
  },
  "signal": "BUY_ZONE",
  "confidence": 75,
  "recommendation": "Strong buy zone at ₹23450.25...",
  "timestamp": "2025-12-29T..."
}
```

### Frontend Component
**File**: `frontend/components/ZoneControlCard.tsx`

**Key Features**:
- Light green border: `border-emerald-500/30`
- Hover effects: `hover:border-emerald-400/50`
- Glow shadow: `shadow-emerald-500/10`
- Bold values: `font-black` on all metrics
- Gradient backgrounds for price display
- Color-coded risk indicators
- Auto-refresh every 5 seconds

**Component Structure**:
```tsx
<ZoneControlCard symbol="NIFTY" name="NIFTY 50" />
```

---

## 🎨 Design Highlights

### Visual Identity
- **Border**: 2px emerald with 30% opacity + glow
- **Background**: Gradient from emerald-950 to dark-card
- **Typography**: Ultra-bold (font-black) for all values
- **Icons**: Animated pulse on main icon
- **Color Palette**:
  - Support zones: Emerald/Green
  - Resistance zones: Rose/Red
  - Neutral: Amber/Yellow

### Layout Sections
1. **Header**: Symbol + Signal badge
2. **Current Price**: Large bold display with gradient background
3. **Zone Panels**: Side-by-side support/resistance
4. **Risk Metrics**: Triple display (Breakdown/Bounce/Strength)
5. **Bottom Bar**: Confidence meter + Recommendation

---

## 📈 Performance Metrics

### Backend
- **Time Complexity**: O(n log n) for zone clustering
- **Space Complexity**: O(k) where k = max 10 zones
- **Target Execution**: <8ms for 100 candles
- **Cache TTL**: 5 seconds for real-time updates
- **Parallel Support**: Yes (all 3 indices simultaneously)

### Frontend
- **Bundle Size**: ~8KB (component + styles)
- **Re-render Optimization**: React.memo for props comparison
- **Update Frequency**: 5-second intervals
- **Error Handling**: Graceful fallback UI

---

## 🧪 Testing

### Test Script
**File**: `scripts/test_zone_control.ps1`

Run from project root:
```powershell
.\scripts\test_zone_control.ps1
```

**Output includes**:
- Current price
- Nearest support/resistance levels
- Zone strength scores
- Breakdown risk %
- Bounce probability %
- Trading recommendation

---

## 🔄 Integration

### Dashboard Placement
**File**: `frontend/app/page.tsx`

Position: **After Volume Pulse, Before Trend Base**

```tsx
{/* Volume Pulse Section */}
<div className="mt-6 border-2 border-purple-500/30...">
  <VolumePulseCard />
</div>

{/* Zone Control Section - NEW */}
<div className="mt-6 border-2 border-emerald-400/40...">
  <ZoneControlCard symbol="NIFTY" name="NIFTY 50" />
  <ZoneControlCard symbol="BANKNIFTY" name="BANK NIFTY" />
  <ZoneControlCard symbol="SENSEX" name="SENSEX" />
</div>

{/* Trend Base Section */}
<div className="mt-6 border-2 border-blue-500/30...">
  <TrendBaseCard />
</div>
```

---

## 🎯 Trading Signals

### BUY_ZONE
**Conditions**:
- Price near strong support (distance < 1%)
- High bounce probability (>70%)
- Low breakdown risk (<30%)
- Strong zone strength

**Action**: Consider buying on dips

### SELL_ZONE
**Conditions**:
- Price near resistance (distance < 1%)
- Resistance strength >60%
- OR breakdown risk >70%

**Action**: Book profits, avoid longs

### NEUTRAL
**Conditions**:
- Price between zones
- Moderate risk metrics
- Waiting for clearer setup

**Action**: Stay on sidelines

---

## 📝 Code Quality

### Backend Standards
- Type hints for all functions
- Dataclasses for efficient memory usage
- Singleton pattern for engine reuse
- Async/await for I/O operations
- Comprehensive error handling

### Frontend Standards
- TypeScript for type safety
- React.memo for performance
- Custom hooks for data fetching
- Graceful loading states
- Error boundaries

---

## 🚀 Quick Start

### 1. Start Backend
```bash
cd backend
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### 2. Test API
```powershell
.\scripts\test_zone_control.ps1
```

### 3. Start Frontend
```bash
cd frontend
npm run dev
```

### 4. View Dashboard
Open: http://localhost:3000

Look for: **"Zone Control & Breakdown Risk"** section with light green border

---

## 🎨 Styling Reference

### Tailwind Classes Used
```css
/* Border */
border-2 border-emerald-500/30
hover:border-emerald-400/50

/* Background */
bg-dark-card
bg-gradient-to-br from-emerald-500/5 to-emerald-500/10

/* Shadow */
shadow-lg shadow-emerald-500/10
hover:shadow-emerald-500/20

/* Typography */
font-black (all values)
text-emerald-400 (headings)
text-white (primary values)

/* Animation */
animate-pulse (icon)
transition-all (hover effects)
```

---

## 📊 Example Output

```
╔════════════════ ZONE CONTROL RESULT ═══════════════╗
║                                                    ║
║  Symbol:         NIFTY                             ║
║  Current Price:  ₹23,487.50                        ║
║                                                    ║
║  Signal:         BUY_ZONE                          ║
║  Confidence:     78%                               ║
║                                                    ║
╠════════════════════════════════════════════════════╣
║  🛡️  NEAREST SUPPORT ZONE                          ║
║     Level:       ₹23,450.25                        ║
║     Distance:    0.16%                             ║
║     Strength:    85/100                            ║
║     Touches:     3x                                ║
║                                                    ║
║  ⚠️  NEAREST RESISTANCE ZONE                       ║
║     Level:       ₹23,650.80                        ║
║     Distance:    0.69%                             ║
║     Strength:    72/100                            ║
║     Touches:     2x                                ║
║                                                    ║
╠════════════════════════════════════════════════════╣
║  📊 RISK METRICS                                   ║
║                                                    ║
║     Breakdown Risk:    25%                         ║
║     Bounce Probability: 78%                        ║
║     Zone Strength:     STRONG                      ║
║                                                    ║
╠════════════════════════════════════════════════════╣
║  💡 RECOMMENDATION                                 ║
║                                                    ║
║  Strong buy zone at ₹23450.25 - High bounce       ║
║  probability with room to move up                 ║
║                                                    ║
╚════════════════════════════════════════════════════╝
```

---

## 🎯 Key Differentiators

### vs Traditional S/R Detection
1. **Volume-weighted zones** (not just price)
2. **Dynamic strength scoring** (multi-factor)
3. **Breakdown prediction** (forward-looking)
4. **Bounce probability** (actionable signals)
5. **Ultra-fast execution** (<8ms)

### vs Other Dashboard Sections
1. **Unique light green border** (emerald theme)
2. **Dual-panel zone display** (support + resistance)
3. **Triple risk metrics** (breakdown/bounce/strength)
4. **Bold typography** (font-black everywhere)
5. **Gradient backgrounds** (premium look)

---

## 📦 Files Created/Modified

### Backend
- ✅ `backend/services/zone_control_service.py` (NEW - 580 lines)
- ✅ `backend/routers/advanced_analysis.py` (MODIFIED - added endpoints)

### Frontend
- ✅ `frontend/components/ZoneControlCard.tsx` (NEW - 280 lines)
- ✅ `frontend/app/page.tsx` (MODIFIED - integrated component)

### Scripts
- ✅ `scripts/test_zone_control.ps1` (NEW - test utility)

### Documentation
- ✅ This file

---

## 🏆 Success Criteria

- ✅ Ultra-fast algorithm (O(n log n))
- ✅ Space-efficient (O(k) where k=10)
- ✅ Unique light green border design
- ✅ Bold values throughout
- ✅ Isolated & reusable component
- ✅ Real-time data updates
- ✅ Positioned after Volume Pulse
- ✅ No errors in compilation
- ✅ Test script included

---

## 📞 Support

For issues or questions:
1. Check backend logs: `python -m uvicorn main:app --reload`
2. Run test script: `.\scripts\test_zone_control.ps1`
3. Verify frontend: Check browser console for errors
4. Review API response: Use Postman/curl for debugging

---

**Created**: December 29, 2025  
**Version**: 1.0.0  
**Status**: ✅ Production Ready
