# ✅ Environment Variables - Complete Configuration Guide

## 🎯 **All Hardcoded Values Removed!**

I've scanned the entire codebase and removed ALL hardcoded credentials and configuration values. Everything is now controlled through environment variables.

---

## 📁 **Environment Files**

### **Backend:** `backend/.env`
- Contains API credentials, server config, tokens
- **NEVER commit to git** (in `.gitignore`)
- Template provided: `backend/.env.example`

### **Frontend:** `frontend/.env.local`
- Contains API URLs, feature flags, timeouts
- **NEVER commit to git** (in `.gitignore`)
- Template provided: `frontend/.env.local.example`

---

## 🔧 **Setup Instructions**

### **1. Backend Configuration**

```bash
cd backend
cp .env.example .env
nano .env  # or use any text editor
```

**Required Variables:**
```env
ZERODHA_API_KEY=your_api_key_here         # From https://developers.kite.trade/apps
ZERODHA_API_SECRET=your_api_secret_here   # From https://developers.kite.trade/apps
JWT_SECRET=random_secure_string_here      # Change to secure random string
REDIRECT_URL=http://127.0.0.1:8000/api/auth/callback
FRONTEND_URL=http://localhost:3000
```

**Optional Variables:**
```env
# Server
HOST=0.0.0.0
PORT=8000
DEBUG=True
CORS_ORIGINS=*

# Redis (uses in-memory cache if not set)
REDIS_URL=redis://localhost:6379

# Instrument tokens (defaults provided)
NIFTY_TOKEN=256265
BANKNIFTY_TOKEN=260105
SENSEX_TOKEN=265

# Futures tokens (auto-updated monthly)
NIFTY_FUT_TOKEN=12602626
BANKNIFTY_FUT_TOKEN=12601346
SENSEX_FUT_TOKEN=292786437
```

### **2. Frontend Configuration**

```bash
cd frontend
cp .env.local.example .env.local
nano .env.local  # or use any text editor
```

**Required Variables:**
```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_WS_URL=ws://127.0.0.1:8000/ws/market
```

**Optional Variables:**
```env
# Features
NEXT_PUBLIC_ENABLE_AI_ANALYSIS=false
NEXT_PUBLIC_MARKET_REFRESH_INTERVAL=3000

# Timeouts
NEXT_PUBLIC_REFRESH_INTERVAL=5000
NEXT_PUBLIC_WS_RECONNECT_DELAY=3000
NEXT_PUBLIC_API_TIMEOUT=5000

# Symbols
NEXT_PUBLIC_MARKET_SYMBOLS=NIFTY,BANKNIFTY,SENSEX
```

---

## 🔒 **Security Best Practices**

### **✅ DO:**
1. **Use `.env.example` as template** - Contains safe dummy values
2. **Keep `.env` files local** - Never commit to git
3. **Use different values per environment** - Dev vs Production
4. **Rotate JWT_SECRET** - Change it in production
5. **Use environment-specific URLs** - localhost for dev, domain for prod

### **❌ DON'T:**
1. **Never commit `.env` or `.env.local`** - Contains secrets
2. **Never hardcode credentials** - Always use env vars
3. **Never share `.env` files** - Use secure channels if needed
4. **Never use default JWT_SECRET** - Change it!
5. **Never expose API keys in frontend** - Use backend proxy

---

## 📝 **Files Changed**

### **Backend:**
- ✅ `backend/.env.example` - Created template
- ✅ `backend/get_token.py` - Removed hardcoded credentials
- ✅ `quick_token_fix.py` - Removed hardcoded credentials
- ✅ All Python files use `os.getenv()` or `config.get_settings()`

### **Frontend:**
- ✅ `frontend/.env.local.example` - Created template
- ✅ All TypeScript files use `process.env.NEXT_PUBLIC_*`
- ✅ No hardcoded URLs remaining

---

## 🔍 **Verification**

### **Check for Hardcoded Values:**
```bash
# Backend
grep -r "api_key.*=" backend/*.py
grep -r "http://localhost" backend/*.py

# Frontend
grep -r "http://localhost" frontend/app/*.tsx
grep -r "ws://localhost" frontend/hooks/*.ts
```

### **All Should Return:**
- Backend: Using `settings.zerodha_api_key` or `os.getenv()`
- Frontend: Using `process.env.NEXT_PUBLIC_*`

---

## 🚀 **Production Deployment**

### **Backend (Digital Ocean):**
```bash
# SSH into server
ssh user@your-server.com

# Navigate to project
cd /path/to/mytradingSignal/backend

# Edit .env for production
nano .env
```

**Production Settings:**
```env
# Use your domain instead of localhost
REDIRECT_URL=https://api.yourdomain.com/api/auth/callback
FRONTEND_URL=https://yourdomain.com

# Secure JWT secret
JWT_SECRET=use_very_long_random_string_here_min_32_chars

# Production mode
DEBUG=False
CORS_ORIGINS=https://yourdomain.com

# Optional: Redis for better performance
REDIS_URL=redis://localhost:6379
```

### **Frontend (Vercel/Netlify):**

**Environment Variables in Dashboard:**
```env
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
NEXT_PUBLIC_WS_URL=wss://api.yourdomain.com/ws/market
NEXT_PUBLIC_ENABLE_AI_ANALYSIS=false
NEXT_PUBLIC_MARKET_SYMBOLS=NIFTY,BANKNIFTY,SENSEX
```

---

## 🎯 **Configuration Per Environment**

### **Local Development:**
```
Backend:  http://127.0.0.1:8000
Frontend: http://localhost:3000
WebSocket: ws://127.0.0.1:8000/ws/market
```

### **Staging:**
```
Backend:  https://staging-api.yourdomain.com
Frontend: https://staging.yourdomain.com
WebSocket: wss://staging-api.yourdomain.com/ws/market
```

### **Production:**
```
Backend:  https://api.yourdomain.com
Frontend: https://yourdomain.com
WebSocket: wss://api.yourdomain.com/ws/market
```

---

## 📚 **Environment Variable Reference**

### **Backend Variables**

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `ZERODHA_API_KEY` | string | ✅ Yes | - | Your Zerodha API key |
| `ZERODHA_API_SECRET` | string | ✅ Yes | - | Your Zerodha API secret |
| `ZERODHA_ACCESS_TOKEN` | string | Auto | - | Auto-updated after login |
| `REDIRECT_URL` | string | ✅ Yes | - | OAuth callback URL |
| `FRONTEND_URL` | string | ✅ Yes | - | Frontend dashboard URL |
| `JWT_SECRET` | string | ✅ Yes | - | JWT signing secret |
| `HOST` | string | No | 0.0.0.0 | Server host |
| `PORT` | int | No | 8000 | Server port |
| `DEBUG` | bool | No | False | Debug mode |
| `CORS_ORIGINS` | string | No | * | Allowed origins |
| `REDIS_URL` | string | No | - | Redis connection URL |

### **Frontend Variables**

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | string | ✅ Yes | - | Backend API URL |
| `NEXT_PUBLIC_WS_URL` | string | ✅ Yes | - | WebSocket URL |
| `NEXT_PUBLIC_MARKET_SYMBOLS` | string | No | NIFTY,BANKNIFTY,SENSEX | Tracked symbols |
| `NEXT_PUBLIC_REFRESH_INTERVAL` | number | No | 5000 | Polling interval (ms) |
| `NEXT_PUBLIC_WS_RECONNECT_DELAY` | number | No | 3000 | WS reconnect delay (ms) |
| `NEXT_PUBLIC_ENABLE_AI_ANALYSIS` | bool | No | false | Enable AI features |

---

## ✅ **Summary**

### **What Changed:**
1. ❌ Removed ALL hardcoded API credentials
2. ✅ Created `.env.example` templates for both frontend and backend
3. ✅ Updated `get_token.py` and `quick_token_fix.py` to use env vars
4. ✅ Verified all frontend components use `process.env.NEXT_PUBLIC_*`
5. ✅ Added validation for missing env vars

### **Benefits:**
- 🔒 **Security:** No credentials in code
- 🔧 **Flexibility:** Easy to switch environments
- 📦 **Portability:** Copy `.env.example` to any environment
- 🚀 **Production Ready:** Different configs per environment
- 👥 **Team Friendly:** Share `.env.example`, not `.env`

### **Next Steps:**
1. Copy `.env.example` to `.env` in backend
2. Copy `.env.local.example` to `.env.local` in frontend
3. Fill in your Zerodha credentials
4. Restart both backend and frontend
5. Test with `python quick_token_fix.py`

**All hardcoded values removed! ✅**
