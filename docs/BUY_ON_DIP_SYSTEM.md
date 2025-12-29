# Buy-on-Dip Detection Module - Complete Documentation

## Overview

The **Buy-on-Dip Detection Module** is an intelligent, performance-optimized system that identifies high-probability dip-buying opportunities in real-time. It analyzes NIFTY, BANKNIFTY, and SENSEX indices using multiple technical indicators and provides clear, actionable signals.

---

## Architecture

### Backend Components

#### 1. Service Layer: `services/buy_on_dip_service.py`
- **Class**: `BuyOnDipEngine`
- **Purpose**: Core logic for signal calculation
- **Features**:
  - Technical indicator calculations (EMA, RSI, VWAP)
  - Scoring system (0-100 points)
  - Multi-timeframe support
  - Performance optimized with caching

#### 2. API Layer: `routers/buy_on_dip.py`
- **Endpoints**:
  - `GET /api/buy-on-dip/signal/{symbol}` - Single symbol signal
  - `GET /api/buy-on-dip/signal/{symbol}/multi-timeframe` - Multi-TF signal
  - `GET /api/buy-on-dip/signals/all` - All indices at once
  - `WebSocket /api/buy-on-dip/ws` - Real-time updates
  - `GET /api/buy-on-dip/health` - Health check

### Frontend Components

#### 1. Hook: `hooks/useBuyOnDip.ts`
- WebSocket connection management
- Auto-reconnection with exponential backoff
- State management for all signals
- Helper methods (isActive, getConfidence, etc.)

#### 2. Component: `components/BuyOnDipCard.tsx`
- **BuyOnDipCard** - Full-featured card with all details
- **BuyOnDipBadge** - Compact inline badge
- Visual states:
  - Active (green, pulsing)
  - Inactive (gray, static)
  - Error (red)

---

## Signal Evaluation Logic

### Scoring System (100 points max)

1. **Trend Check (20 points)**
   - Condition: Price > EMA50
   - Logic: Confirms uptrend is intact
   
2. **Dip Zone (20 points)**
   - Condition: Low ≤ min(EMA20, VWAP) × 0.997
   - Logic: Price dipped into value zone (0.3% below)
   
3. **RSI Pullback (15 points)**
   - Condition: 35 < RSI < 55
   - Logic: Healthy pullback, not oversold
   
4. **Volume Analysis (15 points)**
   - Condition: Volume < 80% of 20-period average
   - Logic: Weak selling pressure
   
5. **Buyer Confirmation (20 points)**
   - Condition: Bullish candle + Higher close
   - Logic: Buyers stepping in
   
6. **Candle Pattern (10 points)**
   - Condition: Body > 60% of total range
   - Logic: Strong bullish body

### Signal Threshold

- **BUY-ON-DIP**: Score ≥ 70 points
- **NO BUY-ON-DIP**: Score < 70 points

---

## API Usage Examples

### 1. Get Signal for NIFTY

```bash
curl -X GET "http://localhost:8000/api/buy-on-dip/signal/NIFTY" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**
```json
{
  "signal": "BUY-ON-DIP",
  "confidence": 75,
  "max_score": 100,
  "percentage": 75.0,
  "reasons": [
    "✅ Uptrend intact (Price > EMA50)",
    "✅ Price dipped into value zone",
    "✅ Healthy pullback RSI (42.5)",
    "✅ Weak selling pressure (Vol: 65% of avg)",
    "✅ Buyer confirmation (Bullish candle + higher close)"
  ],
  "warnings": [],
  "price": 21850.50,
  "timestamp": "2025-12-27T10:30:45.123456",
  "symbol": "NIFTY",
  "interval": "5minute",
  "indicators": {
    "ema20": 21900.25,
    "ema50": 21800.75,
    "rsi": 42.5,
    "vwap": 21875.30,
    "volume_ratio": 0.65
  },
  "candle_info": {
    "open": 21840.00,
    "high": 21860.00,
    "low": 21830.00,
    "close": 21850.50,
    "volume": 12500000,
    "is_bullish": true
  }
}
```

### 2. Get All Signals

```bash
curl -X GET "http://localhost:8000/api/buy-on-dip/signals/all" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 3. WebSocket Connection

```javascript
const ws = new WebSocket('ws://localhost:8000/api/buy-on-dip/ws');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Buy-on-Dip Update:', data);
};
```

---

## Frontend Usage

### Using the Hook

```typescript
import { useBuyOnDip } from '@/hooks/useBuyOnDip';

function MyComponent() {
  const { 
    signals, 
    isConnected, 
    getSignal, 
    isActive,
    getConfidence 
  } = useBuyOnDip();
  
  const niftySignal = getSignal('NIFTY');
  const isNiftyActive = isActive('NIFTY');
  const confidence = getConfidence('NIFTY');
  
  return (
    <div>
      {isNiftyActive && (
        <div>🟢 NIFTY Buy-on-Dip Active ({confidence}%)</div>
      )}
    </div>
  );
}
```

### Using the Card Component

```typescript
import { BuyOnDipCard } from '@/components/BuyOnDipCard';

<BuyOnDipCard
  symbol="NIFTY"
  signal={getSignal('NIFTY')}
/>
```

### Using the Badge Component

```typescript
import { BuyOnDipBadge } from '@/components/BuyOnDipCard';

<BuyOnDipBadge
  symbol="BANKNIFTY"
  signal={getSignal('BANKNIFTY')}
  className="inline-flex"
/>
```

---

## Configuration

### Backend Environment Variables

```env
ZERODHA_API_KEY=your_api_key
ZERODHA_ACCESS_TOKEN=your_access_token
```

### Instrument Tokens

Default tokens in `routers/buy_on_dip.py`:
```python
INSTRUMENT_TOKENS = {
    "NIFTY": 256265,
    "BANKNIFTY": 260105,
    "SENSEX": 265,
    "FINNIFTY": 257801,
    "MIDCPNIFTY": 288009
}
```

### Update Frequency

WebSocket broadcasts every **60 seconds** (configurable in router).

---

## Performance Optimizations

### Backend

1. **Vectorized Operations**: Uses pandas/numpy for fast calculations
2. **Caching**: Avoids redundant computations
3. **Efficient Data Structures**: Minimal memory footprint
4. **Async I/O**: Non-blocking WebSocket handling

### Frontend

1. **WebSocket**: Real-time updates without polling
2. **React Memoization**: Optimized re-renders
3. **Efficient State Management**: Minimal component updates
4. **Auto-reconnection**: Handles connection drops gracefully

---

## Customization

### Adjusting Scoring Weights

Edit `services/buy_on_dip_service.py`:

```python
# Trend Check
if latest['close'] > latest['ema50']:
    score += 25  # Increase from 20
    reasons.append("✅ Strong uptrend")
```

### Changing Signal Threshold

```python
# Lower threshold for more signals
signal = "BUY-ON-DIP" if score >= 60 else "NO BUY-ON-DIP"
```

### Adding New Indicators

```python
def calculate_macd(df):
    # Your MACD logic
    pass

# In prepare_indicators()
df['macd'] = self.calculate_macd(df)
```

---

## Testing

### Backend Unit Tests

```python
import pytest
from services.buy_on_dip_service import BuyOnDipEngine
import pandas as pd

def test_buy_on_dip_signal():
    engine = BuyOnDipEngine()
    
    # Create test data
    df = pd.DataFrame({
        'open': [100, 101, 102],
        'high': [102, 103, 104],
        'low': [99, 100, 101],
        'close': [101, 102, 103],
        'volume': [1000, 1200, 1100]
    })
    
    result = engine.evaluate_buy_on_dip(df)
    
    assert result['signal'] in ['BUY-ON-DIP', 'NO BUY-ON-DIP']
    assert 0 <= result['confidence'] <= 100
```

### Frontend Testing

```typescript
import { renderHook } from '@testing-library/react-hooks';
import { useBuyOnDip } from '@/hooks/useBuyOnDip';

test('useBuyOnDip connects to WebSocket', () => {
  const { result } = renderHook(() => useBuyOnDip());
  
  expect(result.current.isConnected).toBeDefined();
  expect(result.current.signals).toBeDefined();
});
```

---

## Deployment Checklist

- [ ] Set Zerodha API credentials in environment variables
- [ ] Update WebSocket URL in frontend `.env.local`
- [ ] Test signal generation with live data
- [ ] Verify WebSocket connection stability
- [ ] Monitor performance metrics
- [ ] Set up error logging/monitoring

---

## Troubleshooting

### No Signals Appearing

1. Check Zerodha API credentials
2. Verify access token is valid
3. Ensure market is open
4. Check backend logs for errors

### WebSocket Disconnects

1. Check network connectivity
2. Verify WebSocket URL is correct
3. Check firewall/proxy settings
4. Review backend logs for connection errors

### Incorrect Signals

1. Verify historical data quality
2. Check indicator calculations
3. Review scoring logic
4. Validate timeframe configuration

---

## Future Enhancements

1. **Multi-Timeframe Confluence**: Combine 5min, 15min, 1hour signals
2. **AI Confidence Score**: ML model for probability estimation
3. **Alert System**: Email/SMS notifications for active signals
4. **Options Strategy**: Suggest option strikes for dip-buying
5. **Backtesting**: Historical performance analysis
6. **Custom Parameters**: User-defined thresholds and weights

---

## Support

For issues or questions:
- Email: support@mydailytradingsignals.com
- GitHub: [mytradingSignal](https://github.com/yourusername/mytradingSignal)
- Documentation: `/docs/BUY_ON_DIP_SYSTEM.md`

---

**Last Updated**: December 27, 2025
**Version**: 1.0.0
**Status**: ✅ Production Ready
