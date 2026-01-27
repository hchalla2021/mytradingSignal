# 📊 EMA Trading Signals - Quick Reference Card

## Quick Signal Generation

```python
from services.trading_signals import get_instant_trade_signal

signal = get_instant_trade_signal(
    price=20100,
    ema_20=20080,
    ema_50=20050,
    ema_100=20000,
    ema_200=19950,
    symbol="NIFTY"
)

if signal:
    print(f"Signal: {signal.signal}")          # BUY or SELL
    print(f"Entry: ₹{signal.entry_price}")
    print(f"SL: ₹{signal.stop_loss}")
    print(f"Target: ₹{signal.target}")
    print(f"Confidence: {signal.confidence:.0%}")
```

---

## Signal Types & Meanings

```
🟢 STRONG_BUY (90% confidence)
   EMA20 > EMA50 > EMA100 > EMA200
   Strategy: Aggressive entries allowed

🟢 BUY (70% confidence)
   EMA20 > EMA50, Price > 200 EMA
   Strategy: Normal entries

🟡 HOLD (30% confidence)
   EMAs mixed or consolidating
   Strategy: Wait for clarity

🔴 SELL (70% confidence)
   EMA20 < EMA50, Price < 200 EMA
   Strategy: Normal shorts

🔴 STRONG_SELL (90% confidence)
   EMA20 < EMA50 < EMA100 < EMA200
   Strategy: Aggressive shorts
```

---

## EMA Interpretation

### What Each EMA Means

| EMA | Meaning | Use |
|-----|---------|-----|
| **20** | Fast, current trend | Entry signals |
| **50** | Medium, intermediate trend | Confirmation |
| **100** | Slow, trend strength | Filter |
| **200** | Anchor, long-term bias | Main bias |

### EMA Price Position

```
Price > 200 EMA  → BULLISH 🚀 (use for BUYs)
Price < 200 EMA  → BEARISH 📉 (use for SELLs)
Price ≈ 200 EMA  → NEUTRAL ⏳ (wait for clarity)
```

### EMA Alignment

```
Perfect Bullish:  20 > 50 > 100 > 200  (90% confidence)
Good Bullish:     20 > 50 > 100        (70% confidence)
Weak Bullish:     20 > 50              (50% confidence)

Perfect Bearish:  20 < 50 < 100 < 200  (90% confidence)
Good Bearish:     20 < 50 < 100        (70% confidence)
Weak Bearish:     20 < 50              (50% confidence)
```

---

## Risk Management

### Calculate SL & Target

```python
from services.trading_signals import calculate_risk_reward

# Simple method: Fixed points
sl, target = calculate_risk_reward(
    entry_price=20000,
    direction="BUY",
    sl_points=50,          # 50 points SL
    rr_ratio=2.0           # 1:2 ratio
)
# Result: SL=19950, Target=20100

# Using market structure
sl = ema_100 - (ema_100 * 0.001)  # Slightly below EMA100
```

### Position Sizing

```python
risk_per_trade = 1000  # ₹1000 max loss
sl_points = 50
lot_size = 75  # For NIFTY

quantity = risk_per_trade / (sl_points * lot_size)
# quantity = 1000 / (50 * 75) = 0.27 contracts
```

### Symbol Parameters

```
NIFTY:
  Typical SL: 10-15 points
  Typical RR: 1:2.5
  Lot size: 75
  Example: Entry 20000, SL 19950, Target 20100

BANKNIFTY:
  Typical SL: 15-25 points
  Typical RR: 1:2
  Lot size: 40
  Example: Entry 47500, SL 47450, Target 47650

SENSEX:
  Typical SL: 20-40 points
  Typical RR: 1:2.5
  Lot size: 1
  Example: Entry 78000, SL 77950, Target 78100
```

---

## Trading Rules

### ✅ Entry Rules (DO THIS)

1. **Check Bias First**
   - BULL: Price > EMA200 ✓
   - BEAR: Price < EMA200 ✓

2. **Wait for Crossover**
   - EMA20 crosses above EMA50 = BUY ✓
   - EMA20 crosses below EMA50 = SELL ✓

3. **Confirm with Price**
   - For BUY: Price > EMA50 ✓
   - For SELL: Price < EMA50 ✓

4. **Check Confidence**
   - Confidence ≥ 70% = Enter ✓
   - Confidence < 70% = Wait ✓

### ❌ What NOT to Do

- ❌ Enter without checking EMA200 bias
- ❌ Enter on every price bar (wait for crossover)
- ❌ Ignore SL and Target
- ❌ Hold losing position "hoping" for recovery
- ❌ Trade low confidence signals
- ❌ Break the rules because "it feels right"

---

## Live Dashboard Interpretation

```
NIFTY: 20,100.50

📊 Analysis:
  Price: ₹20,100.50
  EMA20: ₹20,080.25
  EMA50: ₹20,050.75
  EMA100: ₹20,000.00
  EMA200: ₹19,950.00

🎯 Signal: BUY ✅
🔐 Confidence: 75%
🔔 Bias: BULLISH 🟢
📈 Trend: UPTREND

💰 Trade Setup:
  Entry: ₹20,100 (BUY)
  Stop Loss: ₹20,050 (13 points)
  Target: ₹20,200 (100 points)
  Risk:Reward: 1:3.8 ✅

Reasons:
  ✓ EMA20 (20080) > EMA50 (20050) - Uptrend
  ✓ Price (20100) > EMA50 - In trend
  ✓ Market above EMA200 (19950) - Bullish bias
  ✓ All EMAs aligned - Strong signal
```

---

## Common Scenarios

### Scenario 1: Clear BUY Signal
```
Price: 20,100 ↗️
20 EMA: 20,080 (above 50) ↗️
50 EMA: 20,050 (above 100) ↗️
100 EMA: 20,000 (above 200) ↗️
200 EMA: 19,950 (anchor below) 📍

✅ Action: ENTER BUY
Confidence: 90%
Entry: 20,100
SL: 19,950 (at 200 EMA)
Target: 20,300 (200 points up)
```

### Scenario 2: Clear SELL Signal
```
Price: 20,050 ↘️
20 EMA: 20,080 (below 50) ↘️
50 EMA: 20,100 (below 100) ↘️
100 EMA: 20,150 (below 200) ↘️
200 EMA: 20,200 (anchor above) 📍

✅ Action: ENTER SELL
Confidence: 90%
Entry: 20,050
SL: 20,200 (at 200 EMA)
Target: 19,850 (200 points down)
```

### Scenario 3: Mixed Signal - WAIT
```
Price: 20,100 ↔️
20 EMA: 20,100 (near 50, no clear direction)
50 EMA: 20,090
100 EMA: 20,080
200 EMA: 20,000

⏳ Action: WAIT FOR CLARITY
Reason: EMAs not aligned, price at 50 EMA
Next: Wait for clear crossover
Confidence: 30% (too low)
```

### Scenario 4: Reversal Zone
```
Price: 19,950 (exactly at 200 EMA)
20 EMA: 19,960 (slightly above 50)
50 EMA: 19,950
100 EMA: 19,940
200 EMA: 19,950 (support/resistance)

⚠️ Action: PREPARE BUT WAIT
Reason: Price at critical level (200 EMA)
Setup: Waiting for clear direction break
Entry: Wait for crossover above or below 19,950
```

---

## Crossover Events (Most Important)

### Bullish Crossover
```
🔔 EVENT: EMA20 crosses above EMA50

Before Bar:  EMA20 = 20,000  |  EMA50 = 20,010
Current Bar: EMA20 = 20,015  |  EMA50 = 20,010
                   ↗️ CROSSED ↖️

✅ Trigger: If price > EMA50, ENTER BUY
```

### Bearish Crossover
```
🔔 EVENT: EMA20 crosses below EMA50

Before Bar:  EMA20 = 20,000  |  EMA50 = 19,990
Current Bar: EMA20 = 19,970  |  EMA50 = 19,990
                   ↘️ CROSSED ↙️

✅ Trigger: If price < EMA50, ENTER SELL
```

---

## Configuration Change (If Needed)

### Change to Scalping (5/13/34/89)
```python
from config.ema_config import set_ema_config
set_ema_config("SCALP_FAST")
# Use for quick entries/exits (5 minute charts)
```

### Change to Legacy (9/21/50/200)
```python
set_ema_config("LEGACY_QUICK")
# Use if you prefer the old configuration
```

### Change to Swing Trading (12/26/52/200)
```python
set_ema_config("SWING_MID")
# Use for larger position trades
```

---

## Performance Targets

### NIFTY (Monthly)
- Win Rate: 55-60%
- Average Win: ₹5,000-10,000
- Average Loss: ₹2,000-4,000
- Monthly Target: ₹20,000-50,000

### BANKNIFTY (Monthly)
- Win Rate: 50-55%
- Average Win: ₹10,000-20,000
- Average Loss: ₹5,000-8,000
- Monthly Target: ₹30,000-60,000

### SENSEX (Monthly)
- Win Rate: 50-55%
- Average Win: ₹2,000-5,000
- Average Loss: ₹1,000-2,000
- Monthly Target: ₹10,000-20,000

---

## Common Mistakes to Avoid

| ❌ Mistake | ✅ Solution |
|-----------|----------|
| Entering without EMA200 bias check | Always check if price > or < 200 EMA first |
| Trading every small price move | Wait for actual EMA20-EMA50 crossover |
| Ignoring stop loss | Always calculate SL before entry |
| Holding winners too long | Take profit at calculated target |
| Averaging down on losses | Exit at SL, don't add to losing position |
| Mixing multiple timeframes | Pick one timeframe and stick to it |
| Emotion-based trading | Follow the rules, not feelings |
| No position sizing | Risk only 1% per trade |

---

## Quick Checklist Before Each Trade

```
□ Is market open? (9:15 AM - 3:30 PM IST)
□ Is EMA200 showing correct bias? (BUY→Price>200, SELL→Price<200)
□ Did EMA20 cross EMA50? (Actual crossover, not just >/<)
□ Is price confirming? (BUY→Price>50, SELL→Price<50)
□ Is confidence ≥ 70%?
□ Have I calculated SL, Target, Position size?
□ Is risk:reward ≥ 1:2?
□ Have I set alerts for SL and Target?

All YES? → ✅ READY TO ENTER
Any NO? → ⏳ WAIT FOR BETTER SETUP
```

---

## Support Levels and Resistance

```
For BUY Setup:
  Support 1: EMA50
  Support 2: EMA100
  Support 3: EMA200 (Strong)
  Entry: At EMA20 or on crossover

For SELL Setup:
  Resistance 1: EMA50
  Resistance 2: EMA100
  Resistance 3: EMA200 (Strong)
  Entry: At EMA20 or on crossover
```

---

## Log Your Trades

```
📋 Trade Journal Entry:

Date: 25-Jan-2026
Symbol: NIFTY
Signal: BUY
Entry Level: 20,100
Entry Time: 10:30 AM
Exit Level: 20,050 (SL hit) / 20,200 (Target) / 20,080 (Manual)
Exit Time: 11:15 AM
P&L: -50 points = -₹3,750
Reason: Reversal at resistance
Lesson: Wait for price to settle at level before entering
```

---

**Remember:** These signals are guides, not guaranteed profits. Always risk manage properly! 📊✅
