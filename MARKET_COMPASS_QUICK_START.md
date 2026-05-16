# Market Compass Module - Quick Start Guide

## ⚡ 30-Second Quick Start

### 1. Start Backend
```bash
cd backend
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 2. Start Frontend
```bash
cd frontend
npm run dev
```

### 3. Access Dashboard
Navigate to: `http://localhost:3000`

**Available immediately**:
- ✅ Health check: http://localhost:8000/api/market-compass/health
- ✅ REST endpoints for all analyses
- ✅ WebSocket real-time streaming

---

## 💡 Component Usage Examples

### Basic Dashboard Implementation

```tsx
'use client';

import MarketCompassDashboard from '@/components/MarketCompassDashboard';
import CorrelationHeatmap from '@/components/CorrelationHeatmap';
import GlobalImpactRadar from '@/components/GlobalImpactRadar';
import MarketRegimeMonitor from '@/components/MarketRegimeMonitor';
import RiskSentimentDisplay from '@/components/RiskSentimentDisplay';

export default function MarketIntelligencePage() {
  return (
    <div className="space-y-6 p-6">
      {/* Primary Symbol Analysis */}
      <MarketCompassDashboard symbol="NIFTY" refreshInterval={3000} />

      {/* Global Market View */}
      <GlobalImpactRadar refreshInterval={5000} />

      {/* Multi-Market Correlations */}
      <CorrelationHeatmap symbol="NIFTY" refreshInterval={5000} />

      {/* Regime & Momentum */}
      <MarketRegimeMonitor symbol="NIFTY" refreshInterval={3000} />

      {/* Risk Assessment */}
      <RiskSentimentDisplay symbol="NIFTY" refreshInterval={3000} />
    </div>
  );
}
```

### Using with Custom Symbols

```tsx
import MarketCompassDashboard from '@/components/MarketCompassDashboard';

export default function BankNiftyAnalysis() {
  return (
    <div className="space-y-6">
      <MarketCompassDashboard 
        symbol="BANKNIFTY" 
        refreshInterval={2000}  // Faster updates for options
      />
    </div>
  );
}
```

---

## 🔌 REST API Quick Reference

### Check Service Health
```bash
curl http://localhost:8000/api/market-compass/health

# Response
{
  "status": "operational",
  "service": "Market Compass",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Get Correlations for NIFTY
```bash
curl "http://localhost:8000/api/market-compass/correlation/NIFTY"

# Response
{
  "primary_symbol": "NIFTY",
  "correlations": [
    {
      "symbol1": "NIFTY",
      "symbol2": "BANKNIFTY",
      "correlation": 0.85,
      "strength": "STRONG"
    }
  ],
  "count": 3
}
```

### Get Market Regime
```bash
curl "http://localhost:8000/api/market-compass/market-regime/NIFTY"

# Response
{
  "symbol": "NIFTY",
  "regime": {
    "type": "TRENDING",
    "strength": 0.85,
    "optimal_strategy": "TREND_FOLLOWING"
  }
}
```

### Get Risk Assessment
```bash
curl "http://localhost:8000/api/market-compass/risk-score/NIFTY"

# Response
{
  "symbol": "NIFTY",
  "overall_risk": 42.5,
  "risk_rating": "MEDIUM",
  "hedge_recommendations": [
    "Consider reducing leverage",
    "Use wider stops"
  ]
}
```

### Get Sentiment Analysis
```bash
curl "http://localhost:8000/api/market-compass/sentiment/NIFTY"

# Response
{
  "symbol": "NIFTY",
  "overall_sentiment": "BULLISH",
  "sentiment_score": 65.5,
  "bullish_score": 75.5
}
```

### Get Comprehensive Dashboard
```bash
curl "http://localhost:8000/api/market-compass/dashboard/NIFTY"

# Response - All metrics in one response
{
  "symbol": "NIFTY",
  "structure": {...},
  "regime": {...},
  "sentiment": {...},
  "risk": {...}
}
```

---

## 🔌 WebSocket Quick Reference

### Python Example
```python
import asyncio
import json
import websockets

async def market_compass_client():
    uri = "ws://localhost:8000/ws/market-compass"
    
    async with websockets.connect(uri) as websocket:
        # Subscribe to symbols
        subscription = {
            "client_id": "trader_001",
            "symbols": ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        await websocket.send(json.dumps(subscription))
        
        # Receive snapshot
        snapshot = await websocket.recv()
        print(f"Snapshot: {snapshot}")
        
        # Receive real-time updates
        while True:
            message = await websocket.recv()
            data = json.loads(message)
            print(f"Update: {data}")

asyncio.run(market_compass_client())
```

### JavaScript/TypeScript Example
```typescript
class MarketCompassClient {
  private ws: WebSocket | null = null;

  connect(clientId: string, symbols: string[]) {
    this.ws = new WebSocket('ws://localhost:8000/ws/market-compass');
    
    this.ws.onopen = () => {
      const subscription = { client_id: clientId, symbols };
      this.ws?.send(JSON.stringify(subscription));
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('Market Compass Update:', data);
      
      if (data.type === 'snapshot') {
        console.log('Subscribed to:', data.symbols);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  disconnect() {
    this.ws?.close();
  }
}

// Usage
const client = new MarketCompassClient();
client.connect('trader_001', ['NIFTY', 'BANKNIFTY', 'SENSEX']);
```

---

## 📊 Key Metrics Explained

### Correlation Score (-1 to +1)
- **0.8 to 1.0**: Very strong positive (move together)
- **0.6 to 0.8**: Strong positive
- **0.4 to 0.6**: Moderate positive
- **-0.4 to +0.4**: Weak/neutral
- **-0.6 to -0.4**: Moderate negative (move opposite)
- **-1.0 to -0.6**: Strong negative (inverse relationship)

### Risk Rating
- **CRITICAL** (>75): Reduce size, implement hedges, consider avoiding trades
- **HIGH** (50-75): Use tighter stops, reduce position size
- **MEDIUM** (25-50): Standard risk management
- **LOW** (<25): Conditions favorable for normal trading

### Momentum Strength (0-100%)
- **75-100%**: Strong momentum, likely continuation
- **50-75%**: Moderate momentum, average follow-through
- **25-50%**: Weak momentum, prepare for reversal
- **0-25%**: Exhaustion level, reversal expected

### Sentiment Score (-100 to +100)
- **Above +50**: Bullish sentiment, buyers in control
- **Above +70**: Very bullish, potential for FOMO
- **Below -50**: Bearish sentiment, sellers in control
- **Below -70**: Panic selling possible

---

## 🚀 Common Trading Scenarios

### Scenario 1: Confirming Entry Signal
```bash
# Check regime
curl "http://localhost:8000/api/market-compass/market-regime/NIFTY"
# Expected: TRENDING regime with momentum_strength > 70%

# Check sentiment
curl "http://localhost:8000/api/market-compass/sentiment/NIFTY"
# Expected: BULLISH sentiment matching your setup

# Check risk
curl "http://localhost:8000/api/market-compass/risk-score/NIFTY"
# Expected: MEDIUM or LOW risk rating for safe entry
```

### Scenario 2: Finding Correlated Opportunities
```bash
# Check which symbols correlate with NIFTY
curl "http://localhost:8000/api/market-compass/correlation/NIFTY"
# High correlation (>0.7): BANKNIFTY, FINNIFTY
# This confirms sector strength
```

### Scenario 3: Global Market Impact Pre-Opening
```bash
# Check global market impact
curl "http://localhost:8000/api/market-compass/global-impact"
# Expected_Impact: BULLISH or BEARISH
# Time_to_open: Minutes until market open
# This guides your opening bias
```

### Scenario 4: Risk Management Decision
```bash
# Check institutional flow
curl "http://localhost:8000/api/market-compass/institutional-flow/NIFTY"
# FII BUYING + momentum strength > 70% = Strong bullish bias (reduce hedges)
# FII SELLING + momentum strength < 30% = Weak momentum (increase hedges)
```

---

## 🧪 Testing Your Setup

### Quick Test All Endpoints
```bash
#!/bin/bash

echo "Testing Market Compass Endpoints..."

# Health check
echo -n "Health: "
curl -s http://localhost:8000/api/market-compass/health | grep -q "operational" && echo "✅" || echo "❌"

# Correlation
echo -n "Correlation: "
curl -s "http://localhost:8000/api/market-compass/correlation/NIFTY" | grep -q "correlations" && echo "✅" || echo "❌"

# Regime
echo -n "Regime: "
curl -s "http://localhost:8000/api/market-compass/market-regime/NIFTY" | grep -q "regime" && echo "✅" || echo "❌"

# Sentiment
echo -n "Sentiment: "
curl -s "http://localhost:8000/api/market-compass/sentiment/NIFTY" | grep -q "sentiment" && echo "✅" || echo "❌"

# Risk
echo -n "Risk Score: "
curl -s "http://localhost:8000/api/market-compass/risk-score/NIFTY" | grep -q "risk_rating" && echo "✅" || echo "❌"

echo "Setup complete!"
```

---

## 🔧 Troubleshooting

### "Connection Refused" Error
```bash
# Verify backend is running
curl http://localhost:8000/api/market-compass/health

# If fails, restart backend
cd backend
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### No Data in Response
- Issue: Endpoints return empty or 202 status
- Solution: Wait 1-2 minutes for service to accumulate data
- Historical data needs 100+ bars to calculate correlations

### React Component Shows Loading
- Issue: Component stuck in loading state
- Solution: Check browser console for errors, verify API is responding

### WebSocket Connection Fails
- Issue: WebSocket connection refused
- Solution: Ensure backend is running and WebSocket router is registered

---

## 📞 Quick Support

**Health Check**: `curl http://localhost:8000/api/market-compass/health`

**All Services Up**: Response should include "operational" status

**Component Not Showing**: Check browser console (F12) for errors

**Latency Issues**: Monitor `/api/market-compass/health` - should respond <50ms
