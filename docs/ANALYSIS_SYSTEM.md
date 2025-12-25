# 📊 Intraday Analysis System - Technical Documentation

## Overview

World-class intraday technical analysis engine for NIFTY, BANKNIFTY, and SENSEX with strict signal generation criteria.

## Features

### 🎯 Technical Indicators Implemented

1. **Price Action & VWAP**
   - Real-time VWAP calculation
   - Position detection (Above/Below/At VWAP)
   - Deviation threshold monitoring

2. **EMA Trend Filter**
   - EMA 9, 21, 50 calculation
   - Trend direction identification (Uptrend/Downtrend/Sideways)
   - Multi-timeframe alignment

3. **Support & Resistance**
   - Dynamic S&R calculation
   - Previous day levels (High, Low, Close)
   - Proximity-based validation

4. **Volume Confirmation**
   - Volume SMA comparison
   - Strength classification (Strong/Moderate/Weak)
   - Multiplier-based filtering

5. **Momentum Indicators**
   - RSI (14-period)
   - Candle strength analysis
   - Overbought/Oversold detection

6. **Time Filter**
   - Avoid opening chop zone (first 15 min)
   - Avoid closing chop zone (last 15 min)
   - Market hours validation

7. **Options Data**
   - Put-Call Ratio (PCR)
   - Open Interest change monitoring

8. **Final Signal Engine**
   - Strict multi-parameter validation
   - Confidence scoring (0-100%)
   - Entry/Stop-loss/Target calculation

## Architecture

### Backend Structure

```
backend/
├── services/
│   ├── analysis_service.py    # Core analysis engine
│   └── pcr_service.py         # Options data service
└── routers/
    └── analysis.py            # API endpoints & WebSocket
```

### Frontend Structure

```
frontend/
├── types/
│   └── analysis.ts            # TypeScript definitions
├── hooks/
│   └── useAnalysis.ts         # WebSocket hook
└── components/
    ├── AnalysisCard.tsx       # Main card component
    └── indicators/
        ├── SignalBadge.tsx    # Signal display
        ├── TechnicalIndicator.tsx
        └── SupportResistance.tsx
```

## Signal Generation Logic

### BUY Signal Criteria (ALL must be true)

```python
✓ Volume Strength = STRONG_VOLUME
✓ Price Position = ABOVE_VWAP
✓ Trend = UPTREND (EMA 9 > 21 > 50)
✓ Price > EMA 9
✓ RSI < 70 (not overbought)
✓ Price > Support Level
✓ Time = Good (not in chop zones)
```

### SELL Signal Criteria (ALL must be true)

```python
✓ Volume Strength = STRONG_VOLUME
✓ Price Position = BELOW_VWAP
✓ Trend = DOWNTREND (EMA 9 < 21 < 50)
✓ Price < EMA 9
✓ RSI > 30 (not oversold)
✓ Price < Resistance Level
✓ Time = Good (not in chop zones)
```

### Signal Types

- **STRONG_BUY**: All criteria + Candle Strength > 70%
- **BUY_SIGNAL**: All criteria met
- **STRONG_SELL**: All criteria + Candle Strength > 70%
- **SELL_SIGNAL**: All criteria met
- **NO_TRADE**: Volume weak or time filter failed
- **WAIT**: Partial criteria match

## API Endpoints

### REST API

```
GET /api/analysis/config              # Get configuration
POST /api/analysis/config             # Update configuration
GET /api/analysis/analyze/{symbol}    # Get analysis for symbol
GET /api/analysis/analyze/all         # Get all analyses
GET /api/analysis/signals/history/{symbol}  # Signal history
```

### WebSocket

```
WS /api/analysis/ws/analysis          # Real-time updates (10s interval)
```

**Message Format:**
```json
{
  "type": "analysis_update",
  "data": {
    "NIFTY": { /* AnalysisSignal */ },
    "BANKNIFTY": { /* AnalysisSignal */ },
    "SENSEX": { /* AnalysisSignal */ }
  },
  "timestamp": "2024-01-01T10:30:00"
}
```

## Configuration

### Backend Config (AnalysisConfig)

```python
config = AnalysisConfig(
    # EMA periods
    ema_fast=9,
    ema_medium=21,
    ema_slow=50,
    
    # Volume settings
    volume_sma_period=20,
    volume_strength_multiplier=1.5,
    
    # VWAP settings
    vwap_deviation_threshold=0.002,  # 0.2%
    
    # Support/Resistance
    lookback_period=20,
    sr_threshold=0.005,  # 0.5%
    
    # Momentum
    rsi_period=14,
    rsi_overbought=70,
    rsi_oversold=30,
    
    # Time filter
    avoid_first_minutes=15,
    avoid_last_minutes=15,
    
    # Signal requirements
    require_all_indicators=True,
    min_confidence_score=0.75
)
```

## Usage Examples

### Backend Usage

```python
from services.analysis_service import create_analysis_engine
import pandas as pd

# Create engine
engine = create_analysis_engine()

# Analyze
signal = await engine.analyze(
    symbol="NIFTY",
    df=market_data_df,  # pandas DataFrame with OHLCV
    pcr=1.2,
    oi_change=5.5
)

print(signal.signal_type)  # SignalType.BUY_SIGNAL
print(signal.confidence_score)  # 0.85
print(signal.reasons)  # List of reasons
```

### Frontend Usage

```tsx
import { useAnalysis } from '@/hooks/useAnalysis';
import { AnalysisCard } from '@/components/AnalysisCard';

function Dashboard() {
  const { analyses, isConnected } = useAnalysis();
  
  return (
    <div>
      <AnalysisCard 
        analysis={analyses?.NIFTY || null}
        isLoading={!isConnected}
      />
    </div>
  );
}
```

## Performance Optimizations

1. **Caching**: Redis caching for market data (60s TTL)
2. **Parallel Processing**: Concurrent analysis for all symbols
3. **Lazy Calculation**: Indicators calculated on-demand
4. **WebSocket Throttling**: Updates every 10 seconds
5. **React Optimization**: Memo, useMemo, useCallback

## Future Enhancements (AI-Ready)

### Planned Features

1. **Machine Learning Integration**
   ```python
   # AI prediction service (future)
   from services.ai_predictor import predict_signal
   
   ai_prediction = await predict_signal(
       historical_data=df,
       indicators=technical_indicators,
       market_sentiment=sentiment_data
   )
   ```

2. **Backtesting Engine**
   - Historical signal validation
   - Win rate calculation
   - Drawdown analysis
   - Profit factor metrics

3. **Alert System**
   - Email/SMS notifications
   - Telegram bot integration
   - Custom alert conditions

4. **Advanced Analytics**
   - Multi-timeframe analysis
   - Sector correlation
   - Market breadth indicators
   - Options chain analysis

## Risk Disclosure

⚠️ **Important**: This analysis tool is for educational purposes only. Trading involves substantial risk. Always:
- Use proper position sizing
- Set stop losses
- Never risk more than 1-2% per trade
- Validate signals with your own analysis
- Consider consulting a financial advisor

## Development Standards

### Code Quality

- **Type Safety**: Full TypeScript & Python type hints
- **Error Handling**: Comprehensive try-catch blocks
- **Logging**: Structured logging for debugging
- **Testing**: Unit tests for all indicators (TODO)
- **Documentation**: Inline comments & docstrings

### Performance Metrics

- **Backend Response Time**: < 100ms per analysis
- **WebSocket Latency**: < 50ms
- **Frontend Render**: < 16ms (60 FPS)
- **Memory Usage**: < 200MB per analysis engine

## Troubleshooting

### Common Issues

1. **No signals generated**
   - Check if market is open (time filter)
   - Verify volume strength (must be STRONG)
   - Ensure all indicators align

2. **WebSocket disconnects**
   - Check NEXT_PUBLIC_WS_URL environment variable
   - Verify backend is running
   - Check firewall/proxy settings

3. **Incorrect data**
   - Verify market data source
   - Check Redis connection
   - Validate OHLCV data format

## Contributing

When adding new indicators:

1. Add to `TechnicalIndicators` dataclass
2. Implement calculation in `AnalysisEngine`
3. Update signal generation logic
4. Add UI component in frontend
5. Update TypeScript types
6. Write unit tests
7. Update documentation

## License

See LICENSE file in root directory.

---

**Built with ❤️ for traders by developers who trade**
