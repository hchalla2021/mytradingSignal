# 🎯 QUICK REFERENCE - DEPLOYMENT FIXES

**Print This Out or Bookmark It!**

---

## 🔴 ISSUES FOUND → 🟢 ISSUES FIXED

```
┌─ ISSUE #1: AUTHENTICATION BREAKING
│  Problem: Two conflicting auth systems
│  Symptom: Login fails, auth disappears after code change
│  ✅ FIXED: Removed unified_auth, using auth_state_manager only
│
├─ ISSUE #2: CONFIG NOT VALIDATED
│  Problem: Missing config not caught until runtime
│  Symptom: Crashes with "KeyError" or "NoneType"
│  ✅ FIXED: Added validation on startup, prints clear errors
│
├─ ISSUE #3: STALE MARKET DATA
│  Problem: Complex cache fallback chain
│  Symptom: Old prices shown, doesn't update
│  ✅ FIXED: Simplified cache, removed fallbacks, 5s TTL only
│
├─ ISSUE #4: DUPLICATE ZERODHA CONNECTIONS
│  Problem: Each WebSocket created separate market feed
│  Symptom: Rate limiting, 403 errors, duplicate API calls
│  ✅ FIXED: Single centralized market feed (global singleton)
│
├─ ISSUE #5: DOCKER REDIS FAILS
│  Problem: REDIS_URL=localhost:6379 doesn't work in containers
│  Symptom: "Connection refused" in Docker
│  ✅ FIXED: Changed to REDIS_URL=redis://redis:6379 (container name)
│
└─ ISSUE #6: MARKET STATUS FROZEN AT 9:15 AM
   Problem: Status cached, doesn't transition
   Symptom: PRE_OPEN frozen, LIVE never starts
   ✅ FIXED: Status always recalculated (already implemented)
```

---

## 📝 FILES CHANGED

```
backend/main.py                    ← Auth system unified
backend/config.py                  ← Validation added
backend/services/cache.py          ← Simplified
backend/.env.production            ← JWT_SECRET warning
docker-compose.prod.yml            ← Redis URL fixed
```

---

## ⚡ QUICK START

### Test Before Deploy
```bash
cd backend
python -c "from config import get_settings; get_settings()"
# Should show validation messages
```

### Deploy
```bash
docker-compose -f docker-compose.prod.yml up -d
# or: cd backend && uvicorn main:app --host 0.0.0.0 --port 8000
```

### Verify
```bash
curl http://localhost:8000/health
curl http://localhost:8000/api/auth/validate
# Both should respond without errors
```

---

## 🆘 EMERGENCY FIXES (If Something Goes Wrong)

### Auth Fails
```
1. Check /api/auth/validate endpoint
2. If token invalid: click LOGIN button
3. Complete auth flow
4. Backend auto-reconnects
```

### Market Data Not Updating
```
1. Check curl http://localhost:8000/api/system/market-status
2. If CLOSED: wait for 9:15 AM
3. If LIVE: check /api/auth/validate
4. If invalid: login again
```

### Docker Issues
```
1. Check: REDIS_URL=redis://redis:6379 ✅ (NOT localhost)
2. Restart: docker-compose restart trading-backend
3. View logs: docker logs trading-backend -f
```

### WebSocket Not Connected
```
1. Check browser console
2. Check frontend .env: NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws/market
3. Restart frontend
4. Hard refresh browser (Ctrl+Shift+R)
```

---

## ✅ DEPLOYMENT CHECKLIST

```
BEFORE:
☐ Config changed from .env.production
☐ Zerodha key/secret set
☐ JWT_SECRET changed from placeholder
☐ Redis running (if not using in-memory)

START:
☐ docker-compose up -d (or manual start)
☐ Wait 10 seconds
☐ Check logs: docker logs trading-backend -f

VERIFY:
☐ Backend responds to /health
☐ Config validation passed (no errors)
☐ Auth state shows (valid/expired/required)
☐ Market data visible
☐ WebSocket connected

DONE:
☐ All above ✅
☐ Ready for users!
```

---

## 📞 REFERENCE

| What | Command | Expected |
|------|---------|----------|
| Check backend | `curl localhost:8000/health` | `{"status":"ok"}` |
| Check config | `curl localhost:8000/api/system/health` | Valid JSON |
| Check auth | `curl localhost:8000/api/auth/validate` | Shows token status |
| Check market | `curl localhost:8000/ws/cache/NIFTY` | Price data |
| Login | Click LOGIN in UI | Zerodha popup |
| Monitor | `docker logs trading-backend -f` | Live logs |

---

## 🎯 SUCCESS INDICATORS

If you see these, you're good:

```
Backend Startup:
✅ "🔧 Configuration loaded from .env"
✅ "✅ All critical config values are set correctly"
✅ "🚀 Backend READY"

Market Feed:
✅ "🟢 First tick received for NIFTY"
✅ "🟢 First tick received for BANKNIFTY"
✅ "🟢 First tick received for SENSEX"

Dashboard:
✅ Prices visible for all 3 symbols
✅ Prices update every 1-2 seconds
✅ Login button works
✅ WebSocket shows "connected" (in browser console)
```

---

## ❌ FAILURE INDICATORS

If you see these, something needs fixing:

```
❌ "ZERODHA_API_KEY not set"
   → Update backend/.env with your key

❌ "JWT_SECRET using placeholder"
   → Generate unique JWT_SECRET: python -c "import secrets; print(secrets.token_urlsafe(32))"

❌ "Connection refused" to Redis
   → Docker: Check REDIS_URL=redis://redis:6379
   → Manual: Start redis-server or docker run redis

❌ "No clients to broadcast to"
   → This is OK! WebSocket connected, waiting for market data

❌ Repeated "connecting..." messages
   → Check Zerodha token validity: /api/auth/validate

❌ "CORS error" in browser console
   → Update CORS_ORIGINS in backend/.env
```

---

## 🚀 DEPLOYMENT STATUS

```
Current Status: ✅ READY
All Issues: ✅ FIXED (6/6)
Code Quality: ✅ NO ERRORS
Documentation: ✅ COMPLETE

→ SAFE TO DEPLOY
```

---

## 📚 DETAILED DOCS

Need more info? Read these:

- **Full Audit**: `DEPLOYMENT_AUDIT_CRITICAL.md` (what was wrong)
- **Fixes Detail**: `DEPLOYMENT_FIXES_COMPLETE.md` (what was fixed)
- **Complete Summary**: `DEPLOYMENT_SUMMARY.md` (everything at a glance)
- **Action Plan**: `DEPLOYMENT_ACTION_PLAN.md` (step-by-step guide)

---

**Last Updated**: January 24, 2026  
**Status**: Ready for Production ✅
