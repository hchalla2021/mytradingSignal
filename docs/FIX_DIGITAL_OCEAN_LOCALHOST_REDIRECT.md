# 🔧 Fix: Digital Ocean Redirecting to Localhost

## ❌ Problem
When clicking "Login" in Digital Ocean production, it redirects to:
```
http://127.0.0.1:8000/api/auth/callback
```

Instead of:
```
https://mydailytradesignals.com/api/auth/callback
```

---

## 🔍 Root Cause

The backend's **auto-detection is failing** in Digital Ocean because the hostname doesn't match any production indicators, so it defaults to "local" environment and uses `LOCAL_REDIRECT_URL` instead of `PRODUCTION_REDIRECT_URL`.

---

## ✅ Solution (Choose ONE)

### **Option 1: Force Production Mode (Recommended)**

**On Digital Ocean server, edit `/var/www/mytradingSignal/backend/.env`:**

```bash
# SSH into Digital Ocean
ssh root@your-droplet-ip

# Edit backend .env
cd /var/www/mytradingSignal/backend
nano .env
```

**Change this line:**
```bash
ENVIRONMENT=auto
```

**To:**
```bash
ENVIRONMENT=production
```

**Restart backend:**
```bash
pm2 restart trading-backend
# or
systemctl restart trading-backend
```

---

### **Option 2: Set Digital Ocean Environment Variable**

**On Digital Ocean server:**

```bash
# Add to systemd service or PM2 config
export DIGITAL_OCEAN=true

# Then restart backend
pm2 restart trading-backend
```

---

### **Option 3: Update Hostname Detection**

The code now checks for additional production indicators:
- ✅ Hostname contains "mydailytrade"
- ✅ Hostname starts with "mydaily"
- ✅ `/var/www/mytradingSignal` path exists
- ✅ `DIGITAL_OCEAN` environment variable set
- ✅ `/root` directory exists (root user in VPS)
- ✅ `PM2_HOME` environment variable

**Just restart backend to apply updated detection:**
```bash
pm2 restart trading-backend
```

---

## 📋 Verification Steps

### **1. Check Environment Detection**

**On Digital Ocean:**
```bash
cd /var/www/mytradingSignal/backend
python3 -c "
from config import Settings, detect_environment
env = detect_environment()
print(f'Detected environment: {env}')
s = Settings()
print(f'Redirect URL: {s.redirect_url}')
print(f'Frontend URL: {s.frontend_url}')
"
```

**Expected Output:**
```
🌍 Environment detected: PRODUCTION
   → Redirect URL: https://mydailytradesignals.com/api/auth/callback
   → Frontend URL: https://mydailytradesignals.com
Detected environment: production
Redirect URL: https://mydailytradesignals.com/api/auth/callback
Frontend URL: https://mydailytradesignals.com
```

**❌ Wrong Output (if still broken):**
```
🌍 Environment detected: LOCAL
   → Redirect URL: http://127.0.0.1:8000/api/auth/callback
   → Frontend URL: http://localhost:3000
```

---

### **2. Check Backend Logs**

```bash
pm2 logs trading-backend
```

**Look for startup message:**
```
🌍 Environment detected: PRODUCTION
   → Redirect URL: https://mydailytradesignals.com/api/auth/callback
   → Frontend URL: https://mydailytradesignals.com
```

---

### **3. Test Login Flow**

1. Go to: https://mydailytradesignals.com
2. Click "Login with Zerodha"
3. Check the URL it redirects to

**✅ Expected:**
```
https://kite.zerodha.com/connect/login?v=3&api_key=YOUR_API_KEY
```

**After login, should redirect to:**
```
https://mydailytradesignals.com/api/auth/callback?request_token=...
```

**❌ Wrong (if broken):**
```
http://127.0.0.1:8000/api/auth/callback?request_token=...
```

---

## 🚀 Quick Fix Script (Run on Digital Ocean)

**Create and run this script on your Digital Ocean server:**

```bash
#!/bin/bash
# fix_environment.sh

echo "🔧 Fixing environment detection..."

# Navigate to backend
cd /var/www/mytradingSignal/backend

# Backup current .env
cp .env .env.backup.$(date +%Y%m%d_%H%M%S)

# Force production environment
sed -i 's/^ENVIRONMENT=.*/ENVIRONMENT=production/' .env

# Verify
echo ""
echo "📋 Current environment setting:"
grep "^ENVIRONMENT=" .env

echo ""
echo "🔄 Restarting backend..."
pm2 restart trading-backend

echo ""
echo "✅ Done! Check logs:"
echo "pm2 logs trading-backend"
```

**Make it executable and run:**
```bash
chmod +x fix_environment.sh
./fix_environment.sh
```

---

## 📝 Updated Backend .env Structure

**Your `/var/www/mytradingSignal/backend/.env` should have:**

```bash
# ==============================================================================
# MyTradingSignal Backend - PRODUCTION Environment
# ==============================================================================

# ==================== ZERODHA API ====================
ZERODHA_API_KEY=your_actual_api_key
ZERODHA_API_SECRET=your_actual_api_secret
ZERODHA_ACCESS_TOKEN=your_actual_token

# ==================== OAUTH & REDIRECT ====================
# LOCAL URLs (for local development)
LOCAL_REDIRECT_URL=http://127.0.0.1:8000/api/auth/callback
LOCAL_FRONTEND_URL=http://localhost:3000

# PRODUCTION URLs (for Digital Ocean)
PRODUCTION_REDIRECT_URL=https://mydailytradesignals.com/api/auth/callback
PRODUCTION_FRONTEND_URL=https://mydailytradesignals.com

# ⚠️ FORCE PRODUCTION MODE (set explicitly)
ENVIRONMENT=production

# Legacy (will be overridden by ENVIRONMENT setting)
REDIRECT_URL=https://mydailytradesignals.com/api/auth/callback
FRONTEND_URL=https://mydailytradesignals.com

# ==================== JWT ====================
JWT_SECRET=your-secret-key-change-in-production

# ==================== SERVER ====================
HOST=0.0.0.0
PORT=8000
DEBUG=False
CORS_ORIGINS=https://mydailytradesignals.com

# ==================== MARKET HOURS SCHEDULER ====================
ENABLE_SCHEDULER=true

# ==================== REDIS ====================
REDIS_URL=redis://localhost:6379

# ... rest of your config ...
```

---

## 🔍 Common Issues

### **Issue 1: Still showing localhost after fix**

**Solution:**
```bash
# Clear backend cache
cd /var/www/mytradingSignal/backend
rm -rf __pycache__
rm -rf **/__pycache__

# Restart
pm2 restart trading-backend --update-env
```

### **Issue 2: Zerodha "Invalid redirect_uri" error**

**Solution:**
Go to https://developers.kite.trade/apps/YOUR_APP_ID and verify:

**Redirect URL should be:**
```
https://mydailytradesignals.com/api/auth/callback
```

**NOT:**
```
http://127.0.0.1:8000/api/auth/callback
```

---

## 🎯 Summary

The issue is that **auto-detection failed in Digital Ocean**, so the backend used local URLs instead of production URLs.

**Fix:** Set `ENVIRONMENT=production` explicitly in your Digital Ocean `.env` file.

**After fix, restart backend and verify the redirect URL is correct.**

---

**Last Updated:** January 12, 2026  
**Status:** FIX READY ✅
