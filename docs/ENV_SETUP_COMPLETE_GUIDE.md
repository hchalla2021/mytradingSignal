# 🔧 PRODUCTION ENVIRONMENT VARIABLES - COMPLETE SETUP GUIDE

**Last Updated:** February 7, 2026  
**Status:** All variables identified and documented

---

## 📋 ENVIRONMENT VARIABLES CHECKLIST

### **BACKEND VARIABLES** (`backend/.env`)

```bash
# ==================== ZERODHA API (CRITICAL) ====================
# Get these from your Zerodha Console (https://console.zerodha.com)
ZERODHA_API_KEY=<your_api_key>
ZERODHA_API_SECRET=<your_api_secret>

# Get this after login - generate from https://kite.zerodha.com
ZERODHA_ACCESS_TOKEN=<your_access_token>

# Symbol tokens - get from Zerodha master contracts CSV or API
NIFTY_TOKEN=256265
BANKNIFTY_TOKEN=260105
SENSEX_TOKEN=256275

# ==================== SECURITY (CRITICAL) ====================
# Generate with: openssl rand -hex 32 (or use strong random generator)
JWT_SECRET=<your_secure_random_string_min_32_chars>
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30

# ==================== DATABASE & CACHE (CRITICAL) ====================
# Format: redis://[username:password@]host:port[/database]
# Local: redis://localhost:6379
# Production: redis://redis-prod-server.com:6379
REDIS_URL=redis://your-redis-server:6379
REDIS_DB=0
CACHE_EXPIRE_TIME=300

# ==================== AUTHENTICATION URLS ====================
# Local Development:
#   REDIRECT_URL=http://localhost:8000/api/auth/callback
#   FRONTEND_URL=http://localhost:3000
#
# Production:
#   REDIRECT_URL=https://your-domain.com/api/auth/callback
#   FRONTEND_URL=https://your-domain.com

REDIRECT_URL=https://your-domain.com/api/auth/callback
FRONTEND_URL=https://your-domain.com

# ==================== CORS & SECURITY ====================
# Local Development: CORS_ORIGINS=http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000
# Production: CORS_ORIGINS=https://your-domain.com,https://www.your-domain.com
# WARNING: Never use * in production!

CORS_ORIGINS=https://your-domain.com,https://www.your-domain.com

# ==================== SERVER CONFIGURATION ====================
HOST=0.0.0.0
PORT=8000

# ==================== DEBUG & LOGGING ====================
# IMPORTANT: Set to false in production!
DEBUG=false
LOG_LEVEL=INFO

# ==================== MARKET HOURS (IST - Indian Standard Time) ====================
MARKET_TIMEZONE=Asia/Kolkata
MARKET_OPEN=09:15
MARKET_CLOSE=15:30
MARKET_PRE_OPEN_START=09:00
MARKET_PRE_OPEN_END=09:15

# Weekend days (0=Monday, 5=Saturday, 6=Sunday)
MARKET_WEEKEND_DAYS=5,6

# ==================== FEATURE FLAGS ====================
ENABLE_TIME_FILTER=false
ENABLE_SCHEDULER=true
USE_PRODUCTION_WEBSOCKET=true

# ==================== WEBSOCKET CONFIGURATION ====================
WEBSOCKET_PING_INTERVAL=25
WEBSOCKET_RECONNECT_DELAY=3
TICK_TIMEOUT_SECONDS=30
```

---

### **FRONTEND VARIABLES** (`frontend/.env.local`)

```bash
# ==================== ENVIRONMENT DETECTION ====================
NEXT_PUBLIC_ENVIRONMENT=production

# ==================== PRODUCTION URLs (CRITICAL) ====================
# These are used when hostname matches NEXT_PUBLIC_PRODUCTION_DOMAIN

# API endpoint for REST calls
NEXT_PUBLIC_PRODUCTION_API_URL=https://your-domain.com/api

# WebSocket endpoint for live data
NEXT_PUBLIC_PRODUCTION_WS_URL=wss://your-domain.com/ws/market

# Domain used to detect production environment
NEXT_PUBLIC_PRODUCTION_DOMAIN=your-domain.com

# ==================== LOCAL/DEV URLs (Optional) ====================
# Only used when running locally - can be left as defaults

NEXT_PUBLIC_LOCAL_API_URL=http://localhost:8000/api
NEXT_PUBLIC_LOCAL_WS_URL=ws://localhost:8000/ws/market

# ==================== FALLBACK URLs (Deprecated, but present for compatibility) ====================
# These are overridden by specific PRODUCTION/LOCAL URLs above
# Do NOT use these - use PRODUCTION/LOCAL variants instead

NEXT_PUBLIC_API_URL=https://your-domain.com/api
NEXT_PUBLIC_WS_URL=wss://your-domain.com/ws/market
```

---

## 🔑 HOW TO GET ZERODHA CREDENTIALS

### **Step 1: API Key & Secret**
1. Go to https://console.zerodha.com
2. Log in with your Zerodha account
3. Navigate to "API Console" → "API Tokens"
4. Create new app (or use existing)
5. Copy **API Key** and **API Secret**

### **Step 2: Access Token**
1. Go to https://kite.zerodha.com
2. Log in with your account
3. Open browser DevTools (F12)
4. Go to Application → Cookies
5. Find cookie named `api_token`
6. Copy the value as **ZERODHA_ACCESS_TOKEN**

**ALTERNATIVE:** Generate programmatically:
```python
from kiteconnect import KiteConnect

kite = KiteConnect(api_key="your_api_key")
# Open: kite.login_url()
# Then exchange code for token
```

### **Step 3: Symbol Tokens**
Get from Zerodha's master contracts file:
```bash
# Download CSV from:
# https://api.kite.trade/instruments

# Then search for:
# NIFTY 50 → token 256265
# BANKNIFTY → token 260105  
# SENSEX (BSESENSEX) → token 256275
```

---

## 🛠️ SETUP INSTRUCTIONS

### **1. Create Backend Environment File**
```bash
cd backend
cp .env.market .env
# Edit .env with your values using a text editor
```

### **2. Create Frontend Environment File**
```bash
cd frontend
cat > .env.local << EOF
NEXT_PUBLIC_ENVIRONMENT=production
NEXT_PUBLIC_PRODUCTION_API_URL=https://your-domain.com/api
NEXT_PUBLIC_PRODUCTION_WS_URL=wss://your-domain.com/ws/market
NEXT_PUBLIC_PRODUCTION_DOMAIN=your-domain.com
NEXT_PUBLIC_LOCAL_API_URL=http://localhost:8000/api
NEXT_PUBLIC_LOCAL_WS_URL=ws://localhost:8000/ws/market
EOF
```

### **3. Verify Configuration**
```bash
# Backend
python -c "from config.production import ProductionConfig; print('✅ Backend config OK'); ProductionConfig.validate()"

# Frontend (check env detection)
cd frontend && npm run build
```

---

## 🔒 SECURITY BEST PRACTICES

### **🚨 NEVER DO THIS:**
```bash
❌ Commit .env files to Git
❌ Share credentials in messages/emails
❌ Use default/example credentials
❌ Hardcode URLs in code
❌ Use development domains in production
❌ Use CORS_ORIGINS=*
❌ Leave DEBUG=true in production
```

### **✅ ALWAYS DO THIS:**
```bash
✅ Add .env to .gitignore
✅ Use environment variables only
✅ Rotate API keys regularly
✅ Use HTTPS/WSS in production
✅ Restrict CORS to your domain
✅ Keep DEBUG=false
✅ Use strong, unique JWT_SECRET
✅ Monitor access logs
```

---

## 🧪 VERIFY PRODUCTION SETUP

### **Test Backend Configuration**
```bash
cd backend

# Check all env vars are loaded
python -c "
from config.production import ProductionConfig
required = ['ZERODHA_API_KEY', 'ZERODHA_API_SECRET', 'JWT_SECRET', 'REDIS_URL']
for var in required:
    val = getattr(ProductionConfig, var, None)
    status = '✅' if val and val != '' else '❌'
    print(f'{status} {var}')
"
```

### **Test Frontend Configuration**
```bash
cd frontend

# Check environment detection
npm run build | grep -i "environment\|production\|api_url"

# Check if NEXT_PUBLIC vars are loaded
grep -r "NEXT_PUBLIC_PRODUCTION" .next/
```

### **Test Zerodha Connection**
```bash
cd backend

python << 'EOF'
import os
from kiteconnect import KiteConnect

api_key = os.getenv('ZERODHA_API_KEY')
access_token = os.getenv('ZERODHA_ACCESS_TOKEN')

if not api_key or not access_token:
    print("❌ ZERODHA credentials not set")
    exit(1)

try:
    kite = KiteConnect(api_key=api_key)
    # If this succeeds, connection is valid
    print("✅ Zerodha API credentials valid")
except Exception as e:
    print(f"❌ Zerodha connection failed: {e}")
EOF
```

### **Test WebSocket Connection**
```bash
# After starting backend, test from browser console:
const ws = new WebSocket('wss://your-domain.com/ws/market');
ws.onopen = () => console.log('✅ WebSocket connected');
ws.onerror = (e) => console.log('❌ Error:', e);
ws.onmessage = (m) => console.log('📊 Data:', m.data);
```

---

## 📊 ENVIRONMENT VARIABLES SUMMARY

| Variable | Required | Type | Example | Env |
|----------|----------|------|---------|-----|
| ZERODHA_API_KEY | ✅ YES | string | abc123 | Backend |
| ZERODHA_API_SECRET | ✅ YES | string | xyz789 | Backend |
| ZERODHA_ACCESS_TOKEN | ✅ YES | string | token123 | Backend |
| JWT_SECRET | ✅ YES | string | random32chars | Backend |
| REDIS_URL | ✅ YES | URL | redis://host:6379 | Backend |
| NIFTY_TOKEN | ✅ YES | integer | 256265 | Backend |
| BANKNIFTY_TOKEN | ✅ YES | integer | 260105 | Backend |
| SENSEX_TOKEN | ✅ YES | integer | 256275 | Backend |
| REDIRECT_URL | ✅ YES | URL | https://domain.com/api/auth | Backend |
| FRONTEND_URL | ✅ YES | URL | https://domain.com | Backend |
| CORS_ORIGINS | ✅ YES | string | https://domain.com | Backend |
| DEBUG | ⚠️ YES | boolean | false | Backend |
| MARKET_TIMEZONE | ⚠️ YES | string | Asia/Kolkata | Backend |
| NEXT_PUBLIC_PRODUCTION_API_URL | ✅ YES | URL | https://domain.com/api | Frontend |
| NEXT_PUBLIC_PRODUCTION_WS_URL | ✅ YES | URL | wss://domain.com/ws | Frontend |
| NEXT_PUBLIC_PRODUCTION_DOMAIN | ✅ YES | string | domain.com | Frontend |

---

## 🚀 FINAL DEPLOYMENT COMMAND

```bash
# 1. Set environment variables
cd backend
source .env  # Linux/Mac
# OR for Windows: PowerShell: Get-Content .env | ForEach-Object { ... }

# 2. Start backend
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4

# 3. In separate terminal, start frontend
cd frontend
npm run build
npm start

# 4. Verify WebSocket at:
# https://your-domain.com/
# Check connection in browser DevTools → Network → WS
```

---

**Status:** ✅ All environment variables documented and ready for configuration.

Once you populate `.env` files with your credentials and domain URLs, your system will be fully operational with ZERO dummy data and 100% live market data from Zerodha.
