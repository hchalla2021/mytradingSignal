# 🚀 Quick Start Guide - Intraday Analysis System

## What Was Built?

3 beautiful analysis cards below the indices showing:
- **Real-time signals** (BUY/SELL/WAIT)
- **10 technical indicators** (VWAP, EMA, S&R, Volume, RSI, etc.)
- **Confidence scores** (0-100%)
- **Entry/Stop-loss/Target prices**
- **Expandable sections** with detailed metrics

## Starting the Application

### Option 1: Using Scripts (Easiest)

**Windows:**
```powershell
.\scripts\start.ps1
```

**Linux/Mac:**
```bash
./scripts/start.sh
```

### Option 2: Manual Start

**Terminal 1 - Backend:**
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm install
npm run dev
```

## Accessing the System

1. **Open Browser**: http://localhost:3000
2. **View Indices**: Top section shows NIFTY, BANKNIFTY, SENSEX
3. **View Analysis**: Scroll down to see 3 analysis cards
4. **Expand Sections**: Click + icons to view detailed indicators
5. **Watch Updates**: Signals update every 10 seconds

## Understanding the UI

### Signal Colors

🚀 **Green** = BUY signals (Strong Buy / Buy Signal)
🔻 **Red** = SELL signals (Strong Sell / Sell Signal)
⏸️ **Amber** = WAIT (conditions not fully met)
⛔ **Gray** = NO TRADE (volume weak or time filter)

### Card Sections

1. **Header**: Symbol name, price, signal badge
2. **Quick Stats**: Trend direction, volume strength
3. **📈 Price Action & VWAP**: VWAP levels and position
4. **📊 EMA Trend Filter**: EMA 9/21/50 values
5. **🎯 Support & Resistance**: Visual S&R levels
6. **⚡ Momentum & Volume**: RSI, candle strength
7. **📊 Options Data**: PCR, OI change (when available)
8. **Trade Levels**: Entry, stop-loss, target prices

### How Signals Work

**BUY Signal Requires ALL:**
- ✓ Strong volume (> 1.5x average)
- ✓ Price above VWAP
- ✓ Uptrend (EMA alignment)
- ✓ RSI < 70 (not overbought)
- ✓ Price above support
- ✓ Good trading time

**SELL Signal Requires ALL:**
- ✓ Strong volume (> 1.5x average)
- ✓ Price below VWAP
- ✓ Downtrend (EMA alignment)
- ✓ RSI > 30 (not oversold)
- ✓ Price below resistance
- ✓ Good trading time

## Features Overview

### ✅ Live Updates
- WebSocket connection for real-time data
- Updates every 10 seconds
- Auto-reconnect on disconnect
- Connection status indicator

### ✅ Strict Signals
- Only high-probability setups
- Minimum 75% confidence required
- All parameters must align
- Risk-reward ratio 1:2 minimum

### ✅ Complete Context
- All indicators in one view
- Expandable for details
- Reasons for each signal
- Warnings when conditions not met

### ✅ Beautiful UI
- Modern dark theme
- Smooth animations
- Responsive design
- Color-coded indicators

## Customization

### Backend Configuration

Edit `backend/services/analysis_service.py`:

```python
config = AnalysisConfig(
    ema_fast=9,              # Change EMA periods
    ema_medium=21,
    ema_slow=50,
    volume_strength_multiplier=1.5,  # Volume threshold
    rsi_overbought=70,       # RSI levels
    rsi_oversold=30,
    avoid_first_minutes=15,  # Time filters
    avoid_last_minutes=15,
    min_confidence_score=0.75  # Signal threshold
)
```

### Frontend Environment

Edit `frontend/.env.local`:

```bash
NEXT_PUBLIC_WS_URL=ws://localhost:8000
```

## API Endpoints

### Check Analysis Configuration
```bash
curl http://localhost:8000/api/analysis/config
```

### Get Analysis for NIFTY
```bash
curl http://localhost:8000/api/analysis/analyze/NIFTY
```

### Get All Analyses
```bash
curl http://localhost:8000/api/analysis/analyze/all
```

## Troubleshooting

### No signals showing?
1. Check backend is running (http://localhost:8000/docs)
2. Check WebSocket connection (green indicator)
3. Verify market hours (9:15 AM - 3:30 PM)
4. Ensure volume is strong

### WebSocket not connecting?
1. Check `NEXT_PUBLIC_WS_URL` in frontend/.env.local
2. Verify backend is running
3. Check browser console for errors
4. Try refreshing the page

### Indicators showing zero?
1. Using mock data initially (normal)
2. Integrate real Zerodha API for production
3. Check data format (OHLCV required)

## Next Steps

### For Testing
1. ✅ View the 3 analysis cards
2. ✅ Expand different sections
3. ✅ Watch signals update
4. ✅ Test responsive design (resize browser)

### For Production
1. Integrate real Zerodha Kite API
2. Add authentication
3. Store signals in database
4. Add backtesting
5. Implement alerts
6. Deploy to server

## Important Notes

⚠️ **Currently Using Mock Data**
- The system generates simulated market data
- Replace with real Zerodha API calls in production
- See `backend/routers/analysis.py` - `get_market_data()` function

⚠️ **Risk Disclosure**
- This is an educational tool
- Not financial advice
- Always use stop losses
- Never risk more than 1-2% per trade
- Validate signals with your own analysis

## Support & Documentation

- **Full Documentation**: `docs/ANALYSIS_SYSTEM.md`
- **Implementation Details**: `docs/ANALYSIS_IMPLEMENTATION.md`
- **Architecture**: See project README.md

## Success Checklist

- [ ] Backend running (http://localhost:8000)
- [ ] Frontend running (http://localhost:3000)
- [ ] See 3 index cards at top
- [ ] See 3 analysis cards below
- [ ] WebSocket shows "Analysis Live" (green)
- [ ] Can expand/collapse sections
- [ ] Signals show with confidence %
- [ ] Updates every 10 seconds

---

**Everything working? You're ready to trade (with real data)! 🚀**

Built with ❤️ for Harikrishna Challa
