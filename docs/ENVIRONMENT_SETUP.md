# 🔧 Environment Setup - Complete Guide

## ✅ All Hardcoded Values Removed!

**Status:** All credentials, API keys, URLs, and configuration values have been moved to environment files.

---

## 📁 Quick Start

### **1. Backend Setup** (Required)

```powershell
cd backend
cp .env.example .env
notepad .env  # Or use VS Code
```

**Minimum Required:**
```env
ZERODHA_API_KEY=your_api_key_here
ZERODHA_API_SECRET=your_api_secret_here
REDIRECT_URL=http://127.0.0.1:8000/api/auth/callback
FRONTEND_URL=http://localhost:3000
JWT_SECRET=change_me_to_random_string
```

### **2. Frontend Setup** (Required)

```powershell
cd frontend
cp .env.local.example .env.local
notepad .env.local  # Or use VS Code
```

**Minimum Required:**
```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_WS_URL=ws://127.0.0.1:8000/ws/market
```

### **3. Get Zerodha Credentials**

1. Go to https://developers.kite.trade/apps
2. Create new app or use existing
3. Add redirect URL: `http://127.0.0.1:8000/api/auth/callback`
4. Copy API Key and API Secret to `backend/.env`

### **4. Start Services**

```powershell
# Option 1: Quick start script
.\quick_start.ps1

# Option 2: Manual start
# Terminal 1 - Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Terminal 2 - Frontend
cd frontend
npm install
npm run dev
```

### **5. Generate Token**

```powershell
python quick_token_fix.py
# Or visit: http://localhost:8000/api/auth/login
```

✅ **Done! Access dashboard at http://localhost:3000**

---

## 📝 Environment Variables Reference

### **Backend Variables**

#### **🔒 Authentication (Required)**
```env
ZERODHA_API_KEY=           # From https://developers.kite.trade/apps
ZERODHA_API_SECRET=        # From https://developers.kite.trade/apps
ZERODHA_ACCESS_TOKEN=      # Auto-updated after login
JWT_SECRET=                # Change to secure random string (32+ chars)
```

#### **🌐 URLs (Required)**
```env
REDIRECT_URL=http://127.0.0.1:8000/api/auth/callback
FRONTEND_URL=http://localhost:3000
```

#### **🖥️ Server (Optional - has defaults)**
```env
HOST=0.0.0.0               # Default: 0.0.0.0
PORT=8000                  # Default: 8000
DEBUG=false                # Default: false
CORS_ORIGINS=*             # Default: * (for dev)
```

#### **📊 Redis (Optional - uses in-memory if not set)**
```env
REDIS_URL=redis://localhost:6379
REDIS_DB=0
REDIS_PASSWORD=
```

#### **🤖 AI Features (Optional)**
```env
OPENAI_API_KEY=            # For AI analysis
OPENAI_MODEL=gpt-4o-mini   # Default: gpt-4o-mini
OPENAI_TEMPERATURE=0.2     # Default: 0.2
```

#### **📰 News Detection (Optional)**
```env
NEWS_API_KEY=              # From https://newsapi.org
NEWS_API_LOOKBACK_HOURS=24 # Default: 24
```

#### **📱 Notifications (Optional)**
```env
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
ALERT_PHONE_NUMBERS=

SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
ALERT_EMAIL_TO=
```

#### **📈 Instrument Tokens (Pre-configured)**
```env
NIFTY_TOKEN=256265         # Rarely changes
BANKNIFTY_TOKEN=260105
SENSEX_TOKEN=265

# Update monthly before expiry!
NIFTY_FUT_TOKEN=12683010
BANKNIFTY_FUT_TOKEN=12674050
SENSEX_FUT_TOKEN=292786437
```

---

### **Frontend Variables**

#### **🌐 API URLs (Required)**
```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_WS_URL=ws://127.0.0.1:8000/ws/market
```

#### **📊 Market Configuration (Optional)**
```env
NEXT_PUBLIC_MARKET_SYMBOLS=NIFTY,BANKNIFTY,SENSEX
NEXT_PUBLIC_ENABLE_AI_ANALYSIS=false
NEXT_PUBLIC_MARKET_REFRESH_INTERVAL=3000
```

#### **⏱️ Timeouts (Optional)**
```env
NEXT_PUBLIC_REFRESH_INTERVAL=5000          # API polling (ms)
NEXT_PUBLIC_ADVANCED_REFRESH_INTERVAL=10000
NEXT_PUBLIC_WS_RECONNECT_DELAY=3000        # WebSocket reconnect
NEXT_PUBLIC_WS_PING_INTERVAL=25000
NEXT_PUBLIC_API_TIMEOUT=5000
NEXT_PUBLIC_DATA_FRESHNESS_MS=60000
```

#### **🔗 API Endpoints (Optional - customize if needed)**
```env
NEXT_PUBLIC_ZONE_CONTROL_ENDPOINT=/api/advanced/zone-control
NEXT_PUBLIC_VOLUME_PULSE_ENDPOINT=/api/advanced/volume-pulse
NEXT_PUBLIC_TREND_BASE_ENDPOINT=/api/advanced/trend-base
```

---

## 🚀 Production Deployment

### **Backend on Digital Ocean**

1. **SSH into server:**
```bash
ssh root@your-server-ip
```

2. **Clone and setup:**
```bash
git clone https://github.com/yourusername/mytradingSignal.git
cd mytradingSignal/backend
cp .env.example .env
nano .env
```

3. **Production settings:**
```env
# Use your domain
REDIRECT_URL=https://api.yourdomain.com/api/auth/callback
FRONTEND_URL=https://yourdomain.com

# Secure JWT (generate with: openssl rand -hex 32)
JWT_SECRET=your_64_char_random_string_here

# Production mode
DEBUG=false
CORS_ORIGINS=https://yourdomain.com

# Optional Redis for performance
REDIS_URL=redis://localhost:6379
```

4. **Update Zerodha redirect URL:**
- Go to https://developers.kite.trade/apps
- Change redirect URL to: `https://api.yourdomain.com/api/auth/callback`

5. **Start with systemd or PM2:**
```bash
# Option 1: systemd
sudo systemctl start trading-backend

# Option 2: PM2
pm2 start "uvicorn main:app --host 0.0.0.0 --port 8000" --name trading-backend
```

---

### **Frontend on Vercel/Netlify**

1. **Push to GitHub**
2. **Connect to Vercel/Netlify**
3. **Add environment variables in dashboard:**

```env
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
NEXT_PUBLIC_WS_URL=wss://api.yourdomain.com/ws/market
NEXT_PUBLIC_MARKET_SYMBOLS=NIFTY,BANKNIFTY,SENSEX
NEXT_PUBLIC_ENABLE_AI_ANALYSIS=false
```

4. **Deploy!**

---

## 🔒 Security Best Practices

### ✅ **DO:**
1. ✅ Use `.env.example` as template (safe to commit)
2. ✅ Keep `.env` and `.env.local` local (in `.gitignore`)
3. ✅ Generate strong JWT_SECRET (32+ chars)
4. ✅ Use different secrets per environment
5. ✅ Rotate credentials regularly
6. ✅ Use HTTPS in production

### ❌ **DON'T:**
1. ❌ Never commit `.env` or `.env.local`
2. ❌ Never share credentials in code
3. ❌ Never use default JWT_SECRET
4. ❌ Never expose API keys in frontend
5. ❌ Never hardcode values in source code

---

## 🔍 Verification

### **Check Environment Files:**
```powershell
# Backend
cd backend
if (Test-Path .env) { Write-Host "✅ Backend .env exists" } else { Write-Host "❌ Backend .env missing" }

# Frontend
cd ../frontend
if (Test-Path .env.local) { Write-Host "✅ Frontend .env.local exists" } else { Write-Host "❌ Frontend .env.local missing" }
```

### **Test Configuration:**
```powershell
# Backend - check if env vars load
cd backend
python -c "from config import get_settings; s = get_settings(); print(f'API Key: {s.zerodha_api_key[:10]}...')"

# Frontend - check build
cd ../frontend
npm run build
```

### **Check for Hardcoded Values (Should return nothing):**
```powershell
# Search for potential hardcoded credentials
Select-String -Path "backend/*.py" -Pattern "api_key.*=.*[\"'](?!os\.getenv)" -Exclude "__pycache__"
Select-String -Path "frontend/**/*.tsx" -Pattern "http://localhost|ws://localhost" -Exclude "node_modules"
```

---

## 📊 Environment Comparison

| Setting | Development | Production |
|---------|------------|------------|
| **Backend URL** | http://127.0.0.1:8000 | https://api.yourdomain.com |
| **Frontend URL** | http://localhost:3000 | https://yourdomain.com |
| **WebSocket** | ws://127.0.0.1:8000/ws/market | wss://api.yourdomain.com/ws/market |
| **DEBUG** | true | false |
| **CORS** | * | https://yourdomain.com |
| **JWT_SECRET** | development_secret | secure_random_64_chars |
| **REDIS** | Optional | Recommended |
| **SSL/TLS** | No | Yes (required) |

---

## 🆘 Troubleshooting

### **"No module named 'dotenv'"**
```powershell
cd backend
pip install python-dotenv
```

### **"ZERODHA_API_KEY not found"**
```powershell
# Check if .env exists
cd backend
Get-Content .env | Select-String "ZERODHA_API_KEY"

# If missing, copy from example
cp .env.example .env
# Then edit with your credentials
```

### **Frontend can't connect to backend**
```powershell
# Check frontend .env.local
cd frontend
Get-Content .env.local

# Should have:
# NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
```

### **Token auto-update not working**
```powershell
# Check file watcher logs
cd backend
Select-String -Path "logs/*.log" -Pattern "Token file change detected"

# Manually trigger
python quick_token_fix.py
```

---

## 📚 Related Documentation

- [Zerodha Auth Setup](docs/ZERODHA_AUTH_SETUP.md)
- [Token Auto-Refresh](docs/QUICKSTART_AUTO_TOKEN.md)
- [Production Deployment](docs/PRODUCTION_DEPLOYMENT.md)
- [API Documentation](docs/API.md)

---

## ✅ Checklist

### **Initial Setup:**
- [ ] Copy `backend/.env.example` to `backend/.env`
- [ ] Copy `frontend/.env.local.example` to `frontend/.env.local`
- [ ] Get Zerodha API key & secret from https://developers.kite.trade/apps
- [ ] Update Zerodha redirect URL to match your REDIRECT_URL
- [ ] Generate secure JWT_SECRET (32+ chars)
- [ ] Fill all required variables in both .env files

### **Development:**
- [ ] Backend starts without errors (`uvicorn main:app --reload`)
- [ ] Frontend starts without errors (`npm run dev`)
- [ ] Can generate token via `quick_token_fix.py`
- [ ] Dashboard shows live data at http://localhost:3000
- [ ] WebSocket connection established
- [ ] Token auto-updates without backend restart

### **Production:**
- [ ] Domain configured with SSL/HTTPS
- [ ] Production .env files created on server
- [ ] JWT_SECRET changed to secure random string
- [ ] Zerodha redirect URL updated to production domain
- [ ] CORS_ORIGINS restricted to frontend domain
- [ ] Redis configured for performance
- [ ] Health check endpoint working
- [ ] Logs configured and monitored

---

**🎉 Setup Complete! All configuration is now managed through environment variables.**

For help: Open an issue at https://github.com/yourusername/mytradingSignal/issues
