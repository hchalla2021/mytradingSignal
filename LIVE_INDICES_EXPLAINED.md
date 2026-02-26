# 📊 LIVE MARKET INDICES - COMPLETE LIST
**What's Integrated in Your Trading System**

---

## 5 LIVE MARKET INDICES

### 1️⃣ **PCR (Put-Call Ratio)**
```
What it is:   Ratio of Put options vs Call options trading volume
Measures:     Market sentiment (bullish vs bearish)
Range:        0.70 (very bullish) to 1.40+ (bearish)
Meaning:
  • < 0.70:   VERY BULLISH (traders are buying aggressively)
  • 0.70-0.85: BULLISH (good buying pressure)
  • 0.85-1.15: NEUTRAL (balanced market)
  • 1.15-1.40: BEARISH (selling pressure)
  • > 1.40:   VERY BEARISH (extreme selling, contrarian buy)

Your System Uses: Adjusts score by ±15 points
```

### 2️⃣ **OI Momentum (Open Interest Momentum)**
```
What it is:   Change in open interest (number of options contracts)
Measures:     Whether traders are building or unwinding positions
Meaning:
  • Increasing OI: New positions are being OPENED = momentum continues
  • Flat OI:       Positions steady = trend may consolidate
  • Decreasing OI: Positions closing = move may reverse

Your System Uses: Adjusts score by ±10 points based on direction
```

### 3️⃣ **Market Breadth (A/D Ratio - Advance/Decline)**
```
What it is:   Ratio of advancing stocks vs declining stocks
Calculates:   (# of stocks going UP) / (# of stocks going DOWN)
Measures:     Quality & participation of the move
Range:        0.5 (all declining) to 2.0+ (all advancing)
Meaning:
  • > 1.5:    STRONG BULLISH (most stocks rising, good breadth)
  • 1.0-1.5:  BULLISH (good participation)
  • 0.8-1.0:  NEUTRAL (even participation)
  • < 0.8:    BEARISH (fewer stocks rising, weak breadth)

Your System Uses: Adjusts score by ±8 points based on breadth quality
```

### 4️⃣ **Volatility Index (VIX / Daily Range)**
```
What it is:   Expected volatility / Historical price range
Measures:     How big moves are expected to be today
Range:        20-80+ (index points)
Meaning:
  • < 20:     VERY LOW (beware! big move coming)
  • 20-30:    LOW (normal, good for trading)
  • 30-40:    HIGH (larger moves expected, use wider stops)
  • > 40:     VERY HIGH (extreme volatility, reduce size)

Your System Uses: No adjustment if NORMAL, scaled adjustments if HIGH/LOW
```

### 5️⃣ **Market Status (Trading Hours)**
```
What it is:   Current state of the NSE/BSE markets
Measures:     When trading is open vs closed
States:
  • PRE_OPEN:     09:00-09:15 AM (opening auction)
  • MARKET_OPEN:  09:15 AM - 3:30 PM (regular trading)
  • AFTER_HOURS:  Post close (no new signals valid)
  • CLOSED:       Next day after close

Your System Uses: WAIT if market closed, signals valid only during MARKET_OPEN
```

---

## 📈 HOW THEY WORK TOGETHER

### Example 1: STRONG BUY Signal
```
Scenario:
  14-Signals:        70% confidence BULLISH
  + PCR:             0.80 → BULLISH (+15)
  + OI Momentum:     Increasing → BULLISH (+10)
  + Market Breadth:  1.8 ratio → STRONG BULLISH (+8)
  + Volatility:      30 (normal) → No adjustment
  + Market Status:   MARKET_OPEN → Signals valid

Calculation:  70 + 15 + 10 + 8 + 0 = 103 (capped at 100)
Decision:     STRONG_BUY (100% confidence, LOW RISK)
Action:       BUY NOW - Maximum position size
```

### Example 2: MIXED/WAIT Signal
```
Scenario:
  14-Signals:        50% confidence (no clear direction)
  + PCR:             1.20 → BEARISH (-10)
  + OI Momentum:     Decreasing → BEARISH (-10)
  + Market Breadth:  0.8 ratio → BEARISH (-8)
  + Volatility:      45 (high) → No adjustment
  + Market Status:   MARKET_OPEN → Signals valid

Calculation:  50 - 10 - 10 - 8 + 0 = 22
Decision:     WAIT (22% confidence, HIGH RISK)
Action:       DO NOT TRADE - Stay on sidelines
```

### Example 3: When Market Closes
```
Scenario:
  14-Signals:        70% confidence BULLISH
  + All Indices:     Irrelevant (market closed)
  + Market Status:   AFTER_HOURS → Signals NOT valid

Decision:     WAIT (regardless of signals)
Action:       HOLD existing positions, prepare for next open
Reason:       No live market data, cannot trust signals
```

---

## 🎯 LIVE INDICES AT A GLANCE

| Index | Purpose | Impact | Range |
|-------|---------|--------|-------|
| **PCR** | Market sentiment | ±15 points | 0.70 - 1.40 |
| **OI Momentum** | Position momentum | ±10 points | Increasing/Decreasing |
| **Market Breadth** | Participation quality | ±8 points | 0.5 - 2.0 ratio |
| **Volatility** | Expected move size | Scaling | 20 - 80+ |
| **Market Status** | Trading validity | Critical gate | Open/Closed |

---

## 💡 WHERE TO FIND THEM IN RESPONSE

Your trading decision API response includes them in section 3:

```json
{
  "market_indices": {
    "pcr": {
      "pcr_value": 0.85,
      "sentiment": "BULLISH",
      "action": "BUY"
    },
    "oi_momentum": "OI Change: +2500, Impact: Bullish",
    "market_breadth": {
      "ad_ratio": 1.45,
      "breadth_signal": "BULLISH"
    },
    "volatility": "NORMAL volatility",
    "market_status": "MARKET_OPEN"
  }
}
```

---

## 🔄 DATA SOURCE: WHERE THESE COME FROM

```
Live Market Indices are sourced from:

1. PCR & OI:           Zerodha Kite API (Options data)
2. Market Breadth:     NSE Advance/Decline counts
3. Volatility:         Calculated from price range
4. Market Status:      IST timezone (current time)
```

---

## 📊 REAL-TIME EXAMPLE (TESTED)

**Current Response from System**:
```
Tested: 2026-02-20 17:53 IST (Market Closed)

PCR:              1.0 (NEUTRAL - no options data available)
OI Momentum:      0 change (market closed)
Market Breadth:   1.0 A/D ratio (equal advances/declines)
Volatility:       NORMAL (no spikes)
Market Status:    AFTER_HOURS ⏸️

Result: WAIT (50% confidence - market closed, wait for open)
```

**When Market is Open** (during 9:15 AM - 3:30 PM IST):
```
PCR:              0.82 (BULLISH - more calls than puts)
OI Momentum:      +2500 (BULLISH - positions building)
Market Breadth:   1.45 (BULLISH - 145 advancing for every 100 declining)
Volatility:       28% (NORMAL - standard moves expected)
Market Status:    MARKET_OPEN ✅

Result: BUY (75% confidence - good buy signal with supporting indices)
```

---

## ✅ SUMMARY

**What is "Live Market Indices"?**

It's a collection of 5 real-time market measurements that tell traders:
1. **What sentiment** the market has (PCR)
2. **If positions are building** (OI Momentum)
3. **If everyone agrees** with the move (Market Breadth)
4. **How risky is the move** (Volatility)
5. **Can we trade right now** (Market Status)

**Your 14-Signals tells you WHAT to do.**  
**Live Market Indices tell you WHY you should and HOW CONFIDENT to be.**

Together = **Complete Trading Decision** ✅
