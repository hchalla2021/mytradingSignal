# 🚀 QUICK DEPLOYMENT REFERENCE - LIVE DATA ONLY

## ⚡ 5-Minute Quick Start

### 1. Set Digital Ocean Env Variables
```
ZERODHA_API_KEY=your_value
ZERODHA_API_SECRET=your_value
ZERODHA_ACCESS_TOKEN=your_value
JWT_SECRET=generate_32_chars
REDIRECT_URL=https://your-domain/api/auth/callback
FRONTEND_URL=https://your-domain
ENABLE_SCHEDULER=true
REDIS_URL=redis://default:password@host:6379/0
```

### 2. Update Futures Tokens
```bash
cd backend
python scripts/find_futures_tokens.py
# Update: NIFTY_FUT_TOKEN, BANKNIFTY_FUT_TOKEN, SENSEX_FUT_TOKEN
```

### 3. Deploy
```bash
git add -A && git commit -m "Live deployment" && git push origin main
```

### 4. Test (During Market Hours 9:15-15:30 IST)
```bash
curl https://your-domain/api/market/current/NIFTY
# Should show real price from Zerodha
```

---

## 🔑 What Changed?

| Before | After |
|--------|-------|
| MockMarketFeedService active | ❌ Removed completely |
| Fallback to cached data | ❌ Removed - returns empty |
| Synthetic test candles | ❌ Removed - real data only |
| Dummy fallback prices | ❌ Removed - live only |

---

## 📊 Data Flow (LIVE ONLY)

```
Zerodha → FastAPI → Redis → WebSocket → UI
9:15-15:30 IST     (Live)    (Cache)   (Live)
```

---

## 🧪 Quick Tests

```bash
# 1. Market Status
curl https://your-domain/api/health/market-status

# 2. Live Price (market hours only)
curl https://your-domain/api/market/current/NIFTY

# 3. WebSocket (in browser console, market hours)
ws = new WebSocket('wss://your-domain/ws/market');
ws.onmessage = e => console.log(JSON.parse(e.data));
```

---

## ⏰ Market Hours Schedule

```
9:00 - 9:15 AM:    PRE_OPEN (auction matching)
9:15 - 3:30 PM:    LIVE (normal trading)
3:30 PM+:          CLOSED (shows last session data)
Weekends/Holidays: CLOSED (no data)
```

---

## 🆘 Common Issues

| Issue | Solution |
|-------|----------|
| No data appearing | Check if 9:15-15:30 IST weekday |
| Auth failed | Renew Zerodha token, update env var |
| API 401 error | Check API_KEY & API_SECRET match |
| Redis error | Verify REDIS_URL in Digital Ocean |
| Build failed | Run `npm install && npm run build` in frontend |

---

## 📚 Full Docs

- **Detailed Guide**: [LIVE_DATA_DEPLOYMENT.md](LIVE_DATA_DEPLOYMENT.md)
- **Architecture**: [DEPLOYMENT_SUMMARY.md](DEPLOYMENT_SUMMARY.md)
- **API Reference**: Swagger at `/docs` after deployment

---

## ✨ You're Set!

✅ All mock data removed
✅ Live Zerodha only
✅ Ready for Digital Ocean
✅ Production safe

**Just set env vars and deploy!**

---

Generated: Feb 2026 | Live Data Only Version | No Test Data in Production
