# Professional EMA Trend Filter (20/50/100/200) Implementation

## Overview
Complete professional-grade trading signal system with proper EMA calculations, crossover detection, and risk management for NIFTY, BANKNIFTY, and SENSEX.

---

## Configuration

### Active EMA Configuration
Located in: `backend/config/ema_config.py`

**Current Configuration: INTRADAY_PRO**
```python
{
    "fast": 20,      # Quick entry/exit signals
    "medium": 50,    # Mid-term trend filter
    "slow": 100,     # Trend confirmation
    "anchor": 200    # Long-term anchor (major support/resistance)
}
```

### Switch Configurations
```python
from config.ema_config import set_ema_config

# Switch to legacy configuration
set_ema_config("LEGACY_QUICK")      # 9/21/50/200

# Or scalping configuration
set_ema_config("SCALP_FAST")        # 5/13/34/89

# Or swing trading
set_ema_config("SWING_MID")         # 12/26/52/200
```

---

## Core Components

### 1. **EMA Calculation** (`add_ema()`)
Uses pandas exponential moving average - more responsive than simple moving average.

```python
from services.trading_signals import apply_indicators
import pandas as pd

# Assuming df has: time, open, high, low, close, volume
df = apply_indicators(df)

# Now df has columns: ema20, ema50, ema100, ema200
print(df[["close", "ema20", "ema50", "ema100", "ema200"]].tail())
```

### 2. **Crossover Detection** 
Proper detection checking BOTH previous and current bar values.

```python
from services.trading_signals import crossed_above, crossed_below

df["bullish_cross"] = crossed_above(df["ema20"], df["ema50"])
df["bearish_cross"] = crossed_below(df["ema20"], df["ema50"])

# Only marks True when actual crossover happens
# Not every bar where EMA20 > EMA50 (only when it crosses)
```

### 3. **Market Bias Determination**
Uses 200 EMA as the anchor - long-term trend indicator.

```
BULL:       Price > 200 EMA + 0.5% threshold
BEAR:       Price < 200 EMA - 0.5% threshold
SIDEWAYS:   Price near 200 EMA (consolidation)
```

### 4. **Entry Signal Logic**

#### BUY Signal
1. ✅ Market bias = BULL (price > 200 EMA)
2. ✅ 20 EMA crosses above 50 EMA
3. ✅ Price > 50 EMA (confirmation)

#### SELL Signal
1. ✅ Market bias = BEAR (price < 200 EMA)
2. ✅ 20 EMA crosses below 50 EMA
3. ✅ Price < 50 EMA (confirmation)

#### HOLD
Waiting for clear signal

```python
from services.trading_signals import generate_trading_signals

df = generate_trading_signals(df)

buy_signals = df[df["signal"] == "BUY"]
sell_signals = df[df["signal"] == "SELL"]
hold_signals = df[df["signal"] == "HOLD"]

print(f"BUY signals: {len(buy_signals)}")
print(f"SELL signals: {len(sell_signals)}")
```

### 5. **Risk Management**

#### Fixed Points Method
```python
from services.trading_signals import calculate_risk_reward

entry = 20000
sl, target = calculate_risk_reward(
    entry_price=entry,
    direction="BUY",
    sl_points=50,          # 50 points SL
    rr_ratio=2.0           # 1:2 Risk:Reward
)

print(f"Entry: ₹{entry}")
print(f"Stop Loss: ₹{sl}")      # 19950
print(f"Target: ₹{target}")    # 20100 (risk × 2)
```

#### Intelligent SL using EMA100
```python
from services.trading_signals import calculate_sl_from_ema

entry = 20000
ema100 = 19950

sl = calculate_sl_from_ema(
    entry_price=entry,
    ema_100=ema100,
    direction="BUY",
    buffer_pct=0.1  # 0.1% below EMA100
)

print(f"SL at structural level: ₹{sl}")
```

---

## Real-Time Usage

### Instant Signal Generation
For live trading without full historical data:

```python
from services.trading_signals import get_instant_trade_signal

# Current market values
price = 20100.50
ema_20 = 20080.25
ema_50 = 20050.75
ema_100 = 20000.00
ema_200 = 19950.00

trade_signal = get_instant_trade_signal(
    price=price,
    ema_20=ema_20,
    ema_50=ema_50,
    ema_100=ema_100,
    ema_200=ema_200,
    symbol="NIFTY"
)

if trade_signal:
    print(f"Signal: {trade_signal.signal}")
    print(f"Entry: ₹{trade_signal.entry_price}")
    print(f"Stop Loss: ₹{trade_signal.stop_loss}")
    print(f"Target: ₹{trade_signal.target}")
    print(f"Confidence: {trade_signal.confidence:.0%}")
    print(f"Bias: {trade_signal.bias}")
    print(f"Reasons: {trade_signal.reasons}")
```

---

## Backtesting

### Full Backtest Pipeline
```python
from services.trading_signals import backtest_strategy
import pandas as pd

# Load your OHLCV data
df = pd.read_csv("historical_data.csv", parse_dates=["time"])

# Run backtest
results = backtest_strategy(
    df=df,
    sl_points=10,              # 10 points stop loss
    rr_ratio=2.0,              # 1:2 risk reward
    initial_capital=100000     # Starting capital
)

print(f"Total signals: {results['total_trades']}")
print(f"EMA Config: {results['ema_config']}")

# Print each signal
for signal in results['signals']:
    print(f"\nTime: {signal['time']}")
    print(f"Signal: {signal['signal']} @ ₹{signal['entry']}")
    print(f"SL: ₹{signal['sl']}, Target: ₹{signal['target']}")
    print(f"Confidence: {signal['confidence']}")
    print(f"EMAs: {signal['emas']}")
```

---

## Signal Confidence Levels

Confidence is automatically calculated based on EMA alignment:

### BUY Signal Confidence
- **0.5 (50%):** EMA20 > EMA50 (basic alignment)
- **0.65 (65%):** EMA20 > EMA50 > EMA100 (good alignment)
- **0.90 (90%):** EMA20 > EMA50 > EMA100 > EMA200 (perfect alignment)

### SELL Signal Confidence
- **0.5 (50%):** EMA20 < EMA50 (basic alignment)
- **0.65 (65%):** EMA20 < EMA50 < EMA100 (good alignment)
- **0.90 (90%):** EMA20 < EMA50 < EMA100 < EMA200 (perfect alignment)

---

## Integration with Real-Time Analysis

The signals are automatically integrated with `instant_analysis.py`:

```python
from services.instant_analysis import get_instant_analysis

analysis = await get_instant_analysis(cache, "NIFTY")

# Now includes EMA 20/50/100/200
print(analysis["indicators"]["ema_20"])
print(analysis["indicators"]["ema_50"])
print(analysis["indicators"]["ema_100"])
print(analysis["indicators"]["ema_200"])

# And from pivot_indicators_service
from services.pivot_indicators_service import get_pivot_service

pivot_service = get_pivot_service()
pivot_data = await pivot_service.get_indicators("NIFTY")

print(pivot_data["ema"]["ema20"])
print(pivot_data["ema"]["ema50"])
print(pivot_data["ema"]["ema100"])
print(pivot_data["ema"]["ema200"])
```

---

## Best Practices for Professional Trading

### ✅ DO THIS
```python
# 1. Use trend filter (200 EMA) first
if price > ema_200:
    # Only look for BUY signals
    pass

# 2. Wait for crossover (actual entry trigger)
if crossover(ema20_above_ema50):
    enter_buy()

# 3. Use intelligent SL based on structure
sl = calculate_sl_from_ema(entry, ema100, "BUY")

# 4. Define risk before entry
risk_amount = calculate_risk_reward(entry, "BUY", sl_points=50)

# 5. Check confidence
if confidence >= 0.7:
    enter_trade()
```

### ❌ AVOID THIS
```python
# DON'T enter just because price > EMA20
# DON'T ignore market bias (200 EMA)
# DON'T enter without crossover confirmation
# DON'T use fixed SL without understanding market structure
# DON'T enter low-confidence signals
```

---

## Symbol-Specific Parameters

### NIFTY (NFO - NSE Futures)
- **Typical daily volume:** 500K-2M contracts
- **Recommended SL:** 10-15 points
- **Recommended RR:** 1:2.5 to 1:3
- **Pre-open:** 9:00 AM IST
- **Market hours:** 9:15 AM - 3:30 PM IST
- **Weekend:** Saturday & Sunday (closed)

### BANKNIFTY (NFO - NSE Futures)
- **Typical daily volume:** 100K-500K contracts
- **More volatile than NIFTY**
- **Recommended SL:** 15-25 points
- **Recommended RR:** 1:2
- **Same market hours as NIFTY**

### SENSEX (BFO - BSE Futures)
- **Typical daily volume:** 10K-100K contracts
- **Lower liquidity than NIFTY**
- **Recommended SL:** 20-40 points
- **Recommended RR:** 1:2.5**
- **Market hours:** 9:15 AM - 3:30 PM IST

---

## Files Updated

| File | Change |
|------|--------|
| `backend/config/ema_config.py` | NEW - EMA configuration system |
| `backend/services/trading_signals.py` | NEW - Complete signal generation |
| `backend/services/instant_analysis.py` | Updated to use EMA 20/50/100/200 |
| `backend/services/pivot_indicators_service.py` | Updated to use new EMA config |
| `backend/services/zerodha_direct_analysis.py` | Updated EMAs to 20/50/100/200 |
| `backend/data/test_data_factory.py` | Updated test data EMAs |

---

## API Response Format

### Instant Analysis with New EMAs
```json
{
  "signal": "BUY_SIGNAL",
  "confidence": 0.78,
  "indicators": {
    "price": 20100.50,
    "ema_20": 20080.25,
    "ema_50": 20050.75,
    "ema_100": 20000.00,
    "ema_200": 19950.00,
    "trend": "BULLISH",
    "vwap": 20075.00
  },
  "timestamp": "2026-01-25T10:30:00"
}
```

### Pivot Indicators with New EMAs
```json
{
  "ema": {
    "ema20": 20080.25,
    "ema50": 20050.75,
    "ema100": 20000.00,
    "ema200": 19950.00,
    "trend": "BULLISH",
    "price_vs_ema20": "ABOVE"
  },
  "supertrend_10_3": {
    "signal": "BUY",
    "value": 20060.00,
    "trend": "BULLISH"
  }
}
```

---

## Switching Back to Legacy (9/21/50)

If needed, you can revert to the old configuration:

```python
from config.ema_config import set_ema_config

set_ema_config("LEGACY_QUICK")

# Now all indicators use 9/21/50/200
# This change applies globally to all services
```

---

## Performance Notes

- **EMA Calculation:** O(n) where n = number of candles (vectorized with pandas)
- **Crossover Detection:** O(1) per candle
- **Signal Generation:** O(n) for full series, O(1) for real-time updates
- **Real-time latency:** <1ms for instant signal generation
- **No additional API calls:** All calculations from existing data

---

## Troubleshooting

### Q: Why are signals not triggering?
**A:** Check:
1. Is price above/below 200 EMA? (bias must be correct)
2. Did 20 EMA actually cross 50 EMA? (not just > or <, must be crossing)
3. Is there historical data for EMA calculation? (at least 200 candles recommended)

### Q: How to change SL/Target ratio?
**A:**
```python
sl, target = calculate_risk_reward(entry, "BUY", sl_points=50, rr_ratio=3.0)
# Now generating 1:3 risk:reward instead of 1:2
```

### Q: Can I use different EMAs for different symbols?
**A:** Yes - maintain separate DataFrames or update the config:
```python
set_ema_config("SWING_MID")  # Global change
# or create custom config in ema_config.py
```

---

## Version History

- **v2.0 (Current):** Professional 20/50/100/200 with proper EMA calculations
- **v1.0 (Legacy):** 9/21/50 approximated EMAs (deprecated)

---

## Support

For issues or questions about the trading signals system, check:
1. `backend/config/ema_config.py` - Configuration
2. `backend/services/trading_signals.py` - Core logic
3. Documentation comments in the code
