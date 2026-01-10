# 🚀 Deploy to Digital Ocean - Quick Guide

## ⚡ Quick Commands (Copy & Run)

### 1️⃣ SSH to Your Server
```bash
ssh root@<your-droplet-ip>
```

### 2️⃣ Update Production .env File
```bash
cd /var/www/mytradingSignal/backend
nano .env
```

**Paste this entire configuration:**
```bash
# ==============================================================================
# PRODUCTION CONFIGURATION - Digital Ocean
# ==============================================================================

# ==================== ZERODHA API ====================
ZERODHA_API_KEY=g5tyrnn1mlckrb6f
ZERODHA_API_SECRET=6cusjkixpyv7pii7c2rtei61ewcoxj3l
ZERODHA_ACCESS_TOKEN=X3tugDOpdu31vmdeA4FHJXUW7ea19eO8

# ==================== OAUTH & REDIRECT ====================
PRODUCTION_REDIRECT_URL=https://mydailytradesignals.com/api/auth/callback
PRODUCTION_FRONTEND_URL=https://mydailytradesignals.com

# ==================== ENVIRONMENT ====================
ENVIRONMENT=production
ENABLE_SCHEDULER=true

# ==================== SERVER ====================
HOST=0.0.0.0
PORT=8000
DEBUG=False
CORS_ORIGINS=https://mydailytradesignals.com

# ==================== JWT ====================
JWT_SECRET=mydailytradingsignals-secret-key-2024

# ==================== REDIS ====================
REDIS_URL=redis://localhost:6379

# ==================== INSTRUMENT TOKENS ====================
NIFTY_TOKEN=256265
BANKNIFTY_TOKEN=260105
SENSEX_TOKEN=265
FINNIFTY_TOKEN=257801
MIDCPNIFTY_TOKEN=288009

# ==================== FUTURES TOKENS ====================
NIFTY_FUT_TOKEN=12602626
BANKNIFTY_FUT_TOKEN=12601346
SENSEX_FUT_TOKEN=292786437
```

**Save:** Ctrl+O, Enter, Ctrl+X

### 3️⃣ Restart Backend
```bash
pm2 restart mytrading-backend
```

### 4️⃣ Verify Fix Applied
```bash
# Check logs (should see "Environment detected: PRODUCTION")
pm2 logs mytrading-backend --lines 20

# Should NOT see TokenException during market closed hours
pm2 logs mytrading-backend --err --lines 10
```

---

## ✅ What This Fixes

| Issue | Fix |
|-------|-----|
| ❌ Environment shows "LOCAL" | ✅ Forces PRODUCTION mode |
| ❌ TokenException when market closed | ✅ Enables scheduler (no API calls outside 9:00-3:30) |
| ❌ Analysis sections empty | ✅ Proper token + scheduler = data flows correctly |
| ❌ Daily token expiry | ✅ Login at https://mydailytradesignals.com to refresh |

---

## 🔄 Daily Token Refresh

**Option A: Via Browser (Easiest)**
1. Open https://mydailytradesignals.com
2. Click **🔑 LOGIN**
3. Authenticate with Zerodha
4. Token auto-saves, backend reconnects

**Option B: Via SSH**
```bash
ssh root@<your-droplet-ip>
cd /var/www/mytradingSignal/backend
python generate_token_manual.py
# Copy new token and update .env file
pm2 restart mytrading-backend
```

---

## 📊 Check Everything Works

```bash
# Backend health
curl http://localhost:8000/health

# Check analysis endpoint
curl http://localhost:8000/api/analysis/analyze/NIFTY

# Service status
pm2 status

# Live logs
pm2 logs mytrading-backend --lines 50
```

---

## 🆘 Still Having Issues?

### Issue: Analysis sections still empty
```bash
# Check token is set
grep ZERODHA_ACCESS_TOKEN /var/www/mytradingSignal/backend/.env

# Check scheduler is enabled
grep ENABLE_SCHEDULER /var/www/mytradingSignal/backend/.env

# Restart backend
pm2 restart mytrading-backend
```

### Issue: TokenException during market hours
```bash
# Token expired - refresh it
# Visit https://mydailytradesignals.com and login
# OR update token manually in .env
```

---

## 📝 Production Checklist

- [ ] ENVIRONMENT=production in .env
- [ ] ENABLE_SCHEDULER=true in .env
- [ ] Valid ZERODHA_ACCESS_TOKEN (refresh daily)
- [ ] PM2 process running
- [ ] No TokenException errors during market closed
- [ ] Analysis sections showing data
- [ ] WebSocket connected

**Status**: Ready for deployment ✅
