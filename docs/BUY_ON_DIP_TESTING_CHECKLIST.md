# Buy-on-Dip Module - Testing & Deployment Checklist

## 📋 Pre-Deployment Testing

### ✅ Backend Tests

- [ ] **Unit Tests Pass**
  ```powershell
  cd backend
  python test_buy_on_dip.py
  ```
  Expected: All tests pass, no errors

- [ ] **Service Imports Correctly**
  ```powershell
  python -c "from services.buy_on_dip_service import BuyOnDipEngine; print('✅ OK')"
  ```

- [ ] **Router Imports Correctly**
  ```powershell
  python -c "from routers.buy_on_dip import router; print('✅ OK')"
  ```

- [ ] **Backend Starts Without Errors**
  ```powershell
  uvicorn main:app --reload
  ```
  Check logs for: "MyDailyTradingSignals Backend Started"

- [ ] **Health Endpoint Responds**
  ```powershell
  curl http://localhost:8000/api/buy-on-dip/health
  ```
  Expected: `{"status": "healthy", ...}`

### ✅ API Endpoint Tests

- [ ] **Single Signal Endpoint**
  ```powershell
  curl http://localhost:8000/api/buy-on-dip/signal/NIFTY
  ```
  Expected: JSON with signal, confidence, reasons, etc.

- [ ] **All Signals Endpoint**
  ```powershell
  curl http://localhost:8000/api/buy-on-dip/signals/all
  ```
  Expected: JSON with NIFTY, BANKNIFTY, SENSEX signals

- [ ] **Multi-Timeframe Endpoint**
  ```powershell
  curl http://localhost:8000/api/buy-on-dip/signal/NIFTY/multi-timeframe
  ```
  Expected: Aggregated signal across timeframes

### ✅ WebSocket Tests

- [ ] **WebSocket Connects**
  Use browser console or WebSocket client
  ```javascript
  const ws = new WebSocket('ws://localhost:8000/api/buy-on-dip/ws');
  ws.onopen = () => console.log('✅ Connected');
  ws.onmessage = (e) => console.log(JSON.parse(e.data));
  ```

- [ ] **Initial Data Received**
  Check for message with `type: "initial"`

- [ ] **Updates Received (60s)**
  Wait 60 seconds, check for message with `type: "update"`

- [ ] **Auto-Reconnect Works**
  Close connection, verify it reconnects

### ✅ Frontend Tests

- [ ] **Frontend Builds Without Errors**
  ```powershell
  cd frontend
  npm run build
  ```

- [ ] **Hook Imports Correctly**
  Check no TypeScript errors in `useBuyOnDip.ts`

- [ ] **Component Renders**
  Check no errors in `BuyOnDipCard.tsx`

- [ ] **Page Integrates Correctly**
  Check `app/page.tsx` has no syntax errors

- [ ] **UI Displays Correctly**
  - Navigate to http://localhost:3000
  - Scroll to "Buy-on-Dip Detection" section
  - Verify cards render for all 3 indices

- [ ] **Status Updates Work**
  - Check if status changes from "OFF" to "ACTIVE" when conditions met
  - Verify confidence bar animates
  - Check pulsing animation on active signals

- [ ] **WebSocket Connection Status**
  - Check connection indicator (green dot = connected)
  - Verify "Monitoring" badge appears

### ✅ Data Validation

- [ ] **Indicators Calculate Correctly**
  - EMA20, EMA50 values reasonable
  - RSI between 0-100
  - VWAP close to current price
  - Volume ratio makes sense

- [ ] **Scoring Logic Works**
  - Score between 0-100
  - Threshold at 70 triggers BUY-ON-DIP
  - Reasons match criteria met

- [ ] **Error Handling**
  - Invalid symbol returns error
  - Network failure handled gracefully
  - Missing data doesn't crash system

---

## 🚀 Deployment Checklist

### Environment Setup

- [ ] **Backend Environment Variables**
  ```env
  ZERODHA_API_KEY=your_api_key
  ZERODHA_API_SECRET=your_api_secret
  ZERODHA_ACCESS_TOKEN=your_access_token
  ```

- [ ] **Frontend Environment Variables**
  ```env
  NEXT_PUBLIC_WS_URL=wss://your-domain.com
  ```

- [ ] **Production Configuration**
  - [ ] Debug mode disabled
  - [ ] CORS origins restricted
  - [ ] Rate limiting enabled
  - [ ] Logging configured

### Infrastructure

- [ ] **Backend Deployed**
  - [ ] Server running
  - [ ] Port 8000 accessible
  - [ ] SSL/TLS enabled (HTTPS)
  - [ ] Health checks passing

- [ ] **Frontend Deployed**
  - [ ] Build successful
  - [ ] Static files served
  - [ ] CDN configured (if applicable)

- [ ] **WebSocket Configuration**
  - [ ] WSS (secure WebSocket) enabled
  - [ ] Proxy/load balancer configured
  - [ ] Connection pooling set up

### Monitoring

- [ ] **Error Tracking**
  - [ ] Sentry/error monitoring enabled
  - [ ] Alerts configured
  - [ ] Log aggregation set up

- [ ] **Performance Monitoring**
  - [ ] API latency tracked
  - [ ] WebSocket connection count monitored
  - [ ] Memory/CPU usage tracked

- [ ] **Business Metrics**
  - [ ] Signal generation rate tracked
  - [ ] Active signals count monitored
  - [ ] User engagement tracked

### Security

- [ ] **Authentication**
  - [ ] JWT authentication enabled
  - [ ] Token expiration configured
  - [ ] Refresh token mechanism working

- [ ] **Rate Limiting**
  - [ ] API rate limits set
  - [ ] WebSocket connection limits enforced

- [ ] **Data Protection**
  - [ ] Sensitive data encrypted
  - [ ] API keys secure
  - [ ] HTTPS enforced

---

## 🧪 Testing Scenarios

### Scenario 1: Bullish Dip (Should Trigger)

**Market Conditions:**
- Price in uptrend (> EMA50)
- Price dips to EMA20/VWAP
- RSI 35-55 (pullback)
- Low volume
- Bullish recovery candle

**Expected Result:**
- ✅ Signal: BUY-ON-DIP
- ✅ Confidence: ≥70%
- ✅ Green card, pulsing animation
- ✅ Reasons list populated

### Scenario 2: No Dip (Should NOT Trigger)

**Market Conditions:**
- Price in uptrend
- No pullback to support
- RSI > 60 (overbought)
- Normal volume

**Expected Result:**
- ⚪ Signal: NO BUY-ON-DIP
- ⚪ Confidence: <70%
- ⚪ Gray card, static
- ⚪ Warnings displayed

### Scenario 3: Bearish Market (Should NOT Trigger)

**Market Conditions:**
- Price below EMA50 (downtrend)
- Falling prices
- RSI < 30 (oversold)
- High selling volume

**Expected Result:**
- ⚪ Signal: NO BUY-ON-DIP
- ⚪ Confidence: <50%
- ⚪ Multiple warnings
- ⚪ No uptrend warning

### Scenario 4: Market Closed (Should Handle)

**Market Conditions:**
- Outside trading hours (3:30 PM - 9:15 AM IST)
- No new data

**Expected Result:**
- ⚪ Last known signal displayed
- ⚪ Timestamp shows last update
- ⚪ No errors in logs

---

## 📊 Performance Benchmarks

### Backend Targets

| Metric | Target | Acceptable | Alert If |
|--------|--------|------------|----------|
| Signal Calculation | < 50ms | < 100ms | > 200ms |
| API Response Time | < 100ms | < 250ms | > 500ms |
| Memory Usage | < 100MB | < 200MB | > 500MB |
| CPU Usage | < 10% | < 25% | > 50% |
| WebSocket Latency | < 50ms | < 100ms | > 200ms |

### Frontend Targets

| Metric | Target | Acceptable | Alert If |
|--------|--------|------------|----------|
| Component Render | < 16ms | < 32ms | > 50ms |
| WebSocket Connect | < 500ms | < 1000ms | > 2000ms |
| Memory per Tab | < 50MB | < 100MB | > 200MB |
| FPS | 60 FPS | 30 FPS | < 15 FPS |

---

## 🐛 Known Issues & Workarounds

### Issue 1: WebSocket Disconnects

**Symptoms**: Connection drops after a few minutes

**Workaround**: 
- Implemented auto-reconnection with exponential backoff
- Max 5 reconnection attempts

### Issue 2: Stale Data During Market Closed

**Symptoms**: Old signals displayed when market closed

**Workaround**:
- Display timestamp on each signal
- Show market status (LIVE/OFFLINE)

### Issue 3: RSI Calculation on Insufficient Data

**Symptoms**: RSI returns NaN for small datasets

**Workaround**:
- Require minimum 50 candles for calculation
- Return "Insufficient data" warning if not met

---

## 📞 Support Resources

### Documentation
- Quick Start: `docs/BUY_ON_DIP_QUICKSTART.md`
- Full System: `docs/BUY_ON_DIP_SYSTEM.md`
- Architecture: `docs/BUY_ON_DIP_ARCHITECTURE_DIAGRAM.md`
- Implementation: `docs/BUY_ON_DIP_IMPLEMENTATION_SUMMARY.md`

### Tools
- Test Script: `backend/test_buy_on_dip.py`
- Start Script: `scripts/buy_on_dip_start.ps1`

### API Documentation
- OpenAPI Docs: http://localhost:8000/docs
- Health Check: http://localhost:8000/api/buy-on-dip/health

---

## ✅ Final Sign-Off

Before marking this module as production-ready, ensure:

- [ ] All tests pass (unit, integration, E2E)
- [ ] Documentation complete and reviewed
- [ ] Performance benchmarks met
- [ ] Security audit passed
- [ ] Error monitoring configured
- [ ] Backup & recovery tested
- [ ] Team trained on troubleshooting
- [ ] Rollback plan documented

---

**Reviewer**: ________________  
**Date**: ________________  
**Status**: ☐ Approved ☐ Needs Review ☐ Rejected  

---

**Last Updated**: December 27, 2025  
**Version**: 1.0.0
