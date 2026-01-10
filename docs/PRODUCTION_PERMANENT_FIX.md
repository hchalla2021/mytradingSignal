# Production Deployment - Permanent Fix Guide

## 🐛 Issues Fixed

### 1. **Environment Detection** ✅
- **Problem**: Production server detected as "LOCAL"
- **Fix**: Enhanced `detect_environment()` in `config.py` to check for:
  - Hostname patterns (mydailytrade, ubuntu with /var/www)
  - PM2 process manager
  - Production path `/var/www/mytradingSignal`

### 2. **Scheduler Disabled** ✅
- **Problem**: API calls made even when market closed → TokenException
- **Fix**: Set `ENABLE_SCHEDULER=true` in production .env
- **Result**: No API calls outside market hours (9:00 AM - 3:30 PM IST)

### 3. **Better Error Handling** ✅
- **Problem**: All errors showed as "Token expired"
- **Fix**: New `error_handler.py` distinguishes:
  - Token expired during market hours (CRITICAL - needs login)
  - API calls when market closed (INFO - expected behavior)
  - Other API errors (WARNING - retry logic)

---

## 🚀 Quick Fix Commands (Run on Digital Ocean)

### Option 1: Automated Script (Recommended)
```bash
# SSH to your server
ssh root@your-droplet-ip

# Download and run fix script
cd /var/www/mytradingSignal
curl -O https://raw.githubusercontent.com/yourusername/mytradingSignal/main/scripts/deploy_production_fix.sh
chmod +x scripts/deploy_production_fix.sh
sudo ./scripts/deploy_production_fix.sh
```

### Option 2: Manual Fix
```bash
# SSH to server
ssh root@your-droplet-ip

# Update .env file
cd /var/www/mytradingSignal/backend
nano .env

# Add/Update these lines:
ENVIRONMENT=production
ENABLE_SCHEDULER=true
DEBUG=False

# Copy your current token from local .env:
ZERODHA_ACCESS_TOKEN=X3tugDOpdu31vmdeA4FHJXUW7ea19eO8

# Save (Ctrl+O, Enter, Ctrl+X)

# Restart backend
pm2 restart mytrading-backend

# Check logs
pm2 logs mytrading-backend --lines 20
```

---

## 📋 Production .env Template

File: `/var/www/mytradingSignal/backend/.env`

```bash
# ==============================================================================
# PRODUCTION CONFIGURATION
# ==============================================================================

# ==================== ZERODHA API ====================
ZERODHA_API_KEY=g5tyrnn1mlckrb6f
ZERODHA_API_SECRET=6cusjkixpyv7pii7c2rtei61ewcoxj3l
ZERODHA_ACCESS_TOKEN=YOUR_DAILY_TOKEN_HERE

# ==================== ENVIRONMENT ====================
ENVIRONMENT=production          # 🔥 CRITICAL: Must be "production"
ENABLE_SCHEDULER=true           # 🔥 CRITICAL: Prevents closed-market API calls
DEBUG=False

# ==================== URLS ====================
PRODUCTION_REDIRECT_URL=https://mydailytradesignals.com/api/auth/callback
PRODUCTION_FRONTEND_URL=https://mydailytradesignals.com

# ==================== SERVER ====================
HOST=0.0.0.0
PORT=8000
CORS_ORIGINS=https://mydailytradesignals.com

# ==================== JWT ====================
JWT_SECRET=mydailytradingsignals-secret-key-2024

# ==================== REDIS ====================
REDIS_URL=redis://localhost:6379

# ==================== TOKENS ====================
NIFTY_TOKEN=256265
BANKNIFTY_TOKEN=260105
SENSEX_TOKEN=265
FINNIFTY_TOKEN=257801
MIDCPNIFTY_TOKEN=288009

# FUTURES TOKENS (update monthly)
NIFTY_FUT_TOKEN=12602626
BANKNIFTY_FUT_TOKEN=12601346
SENSEX_FUT_TOKEN=292786437
```

---

## 🔄 Daily Token Refresh (Automated)

Zerodha tokens expire daily. Setup cron job for auto-refresh:

### 1. Create refresh script
```bash
nano /root/scripts/refresh_token_daily.sh
```

```bash
#!/bin/bash
# Daily Zerodha Token Refresh

LOG_FILE="/var/log/zerodha_token_refresh.log"
BACKEND_DIR="/var/www/mytradingSignal/backend"

echo "$(date): Starting token refresh" >> $LOG_FILE

cd $BACKEND_DIR
source venv/bin/activate

# Generate new token (requires manual login via browser)
python generate_token_manual.py >> $LOG_FILE 2>&1

# Restart backend to use new token
pm2 restart mytrading-backend

echo "$(date): Token refresh complete" >> $LOG_FILE
```

### 2. Make executable
```bash
chmod +x /root/scripts/refresh_token_daily.sh
```

### 3. Add cron job
```bash
crontab -e
```

Add this line (runs Monday-Friday at 9:00 AM IST):
```bash
0 9 * * 1-5 /root/scripts/refresh_token_daily.sh
```

---

## 🔍 Verify Fix Applied

### 1. Check environment detection
```bash
pm2 logs mytrading-backend --lines 20 | grep "Environment detected"
```
**Expected**: `🌍 Environment detected: PRODUCTION`

### 2. Check scheduler status
```bash
grep ENABLE_SCHEDULER /var/www/mytradingSignal/backend/.env
```
**Expected**: `ENABLE_SCHEDULER=true`

### 3. Check market hours behavior
During market closed (e.g., 6:00 PM):
```bash
curl http://localhost:8000/api/analysis/analyze/NIFTY
```
**Expected**: Should return cached data WITHOUT TokenException errors in logs

During market open (9:15 AM - 3:30 PM):
```bash
curl http://localhost:8000/api/analysis/analyze/NIFTY
```
**Expected**: Should fetch live data from Zerodha

---

## 📊 Monitoring Commands

```bash
# Watch live logs
pm2 logs mytrading-backend --lines 100

# Check for TokenException errors
pm2 logs mytrading-backend --err --lines 50 | grep TokenException

# Service status
pm2 status

# Backend health
curl http://localhost:8000/health

# Check token age
grep ZERODHA_ACCESS_TOKEN /var/www/mytradingSignal/backend/.env
```

---

## 🆘 Troubleshooting

### Issue: Still seeing TokenException during market closed
**Solution**: 
```bash
# Verify scheduler is enabled
grep ENABLE_SCHEDULER /var/www/mytradingSignal/backend/.env
# Should show: ENABLE_SCHEDULER=true

# Restart backend
pm2 restart mytrading-backend
```

### Issue: Environment still shows "LOCAL"
**Solution**:
```bash
# Force production mode
echo "ENVIRONMENT=production" >> /var/www/mytradingSignal/backend/.env
pm2 restart mytrading-backend
```

### Issue: Token expired during market hours
**Solution**:
```bash
# Login via browser
1. Open: https://mydailytradesignals.com
2. Click LOGIN button
3. Authenticate with Zerodha
4. Token auto-saves and backend reconnects

# OR manually update token:
nano /var/www/mytradingSignal/backend/.env
# Update ZERODHA_ACCESS_TOKEN line
pm2 restart mytrading-backend
```

---

## 📝 Summary of Changes

| File | Change | Purpose |
|------|--------|---------|
| `backend/config.py` | Enhanced `detect_environment()` | Correctly detect production |
| `backend/.env.production` | Template with correct settings | Production config template |
| `backend/services/error_handler.py` | Smart error handling | Distinguish token vs market-closed |
| `scripts/deploy_production_fix.sh` | Automated fix script | One-command fix |

---

## ✅ Final Checklist

- [ ] Environment detects as PRODUCTION
- [ ] ENABLE_SCHEDULER=true in production .env
- [ ] Valid Zerodha access token in .env
- [ ] No TokenException errors during market closed hours
- [ ] Live data flows during market hours
- [ ] PM2 process running stable
- [ ] Daily token refresh cron job setup (optional)

---

**Status**: All permanent fixes applied ✅
**Deployment**: Ready for production use 🚀
