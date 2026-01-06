# 🚀 Production Deployment Guide

## ✅ Pre-Deployment Checklist Completed

### Cleanup Status
- ✅ Test files removed (`test_orchestration.py`, `check_market_status.py`)
- ✅ No hardcoded credentials in code
- ✅ All sensitive data in `.env` files
- ✅ `.gitignore` properly configured
- ✅ No test/mock data files
- ✅ Code is production-ready

---

## 📋 Before Deployment Configuration

### 1. Backend Environment Configuration

**File**: `backend/.env`

```bash
# ==================== ZERODHA API ====================
ZERODHA_API_KEY=your_actual_api_key_here
ZERODHA_API_SECRET=your_actual_api_secret_here
ZERODHA_ACCESS_TOKEN=   # Generated daily via manual_token_refresh.py

# ==================== OAUTH & REDIRECT ====================
# CRITICAL: Update these to your production domain
REDIRECT_URL=https://yourdomain.com/api/auth/callback
FRONTEND_URL=https://yourdomain.com

# ==================== JWT ====================
# Generate strong secret: openssl rand -hex 32
JWT_SECRET=your_super_secure_random_string_here_32_chars_min
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7

# ==================== SERVER ====================
HOST=0.0.0.0
PORT=8000
DEBUG=false   # ⚠️ IMPORTANT: Set to false in production

# ==================== CORS ====================
# CRITICAL: Set to your actual frontend domain(s)
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# ==================== REDIS ====================
# For production, use managed Redis (Redis Cloud, AWS ElastiCache, etc.)
REDIS_URL=redis://your-redis-host:6379
REDIS_DB=0
REDIS_PASSWORD=your_redis_password_if_any

# ==================== FUTURES TOKENS ====================
# ⚠️ UPDATE MONTHLY before futures expiry (last Thursday)
# Run: python backend/scripts/find_futures_tokens.py
NIFTY_FUT_TOKEN=12683010
BANKNIFTY_FUT_TOKEN=12674050
SENSEX_FUT_TOKEN=292786437

# ==================== OPTIONAL: AI ANALYSIS ====================
OPENAI_API_KEY=your_openai_api_key_for_ai_analysis  # Optional
NEWS_API_KEY=your_newsapi_key_for_news_detection    # Optional
```

### 2. Frontend Environment Configuration

**File**: `frontend/.env.local` (or `.env.production`)

```bash
# CRITICAL: Update to your production backend URL
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
NEXT_PUBLIC_WS_URL=wss://api.yourdomain.com/ws/market

# Symbols to track
NEXT_PUBLIC_MARKET_SYMBOLS=NIFTY,BANKNIFTY,SENSEX
```

### 3. Zerodha Developer Console Configuration

**URL**: https://developers.kite.trade/apps

1. **Login** to Zerodha Developer Console
2. **Select your app**
3. **Add Redirect URL**:
   ```
   https://yourdomain.com/api/auth/callback
   ```
4. **Verify app status**: Active
5. **Note your API Key** and **API Secret**

---

## 🔐 Security Hardening

### 1. Generate Strong JWT Secret
```bash
# On Linux/Mac
openssl rand -hex 32

# On Windows (PowerShell)
[System.Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
```

### 2. Environment Files Protection
```bash
# Ensure .env files are in .gitignore
echo "backend/.env" >> .gitignore
echo "frontend/.env.local" >> .gitignore
echo "frontend/.env.production" >> .gitignore
```

### 3. CORS Configuration
- **Development**: `CORS_ORIGINS=*` (OK)
- **Production**: `CORS_ORIGINS=https://yourdomain.com` (STRICT)

### 4. Debug Mode
- **Development**: `DEBUG=true`
- **Production**: `DEBUG=false` ⚠️

---

## 🚢 Deployment Methods

### Method 1: Docker Compose (Recommended)

```bash
# 1. Build images
docker-compose build

# 2. Start services
docker-compose up -d

# 3. Check logs
docker-compose logs -f

# 4. Stop services
docker-compose down
```

### Method 2: VPS (DigitalOcean, AWS, etc.)

#### Backend Deployment

```bash
# 1. Install dependencies
cd backend
python -m pip install -r requirements.txt

# 2. Generate access token (do this DAILY)
python manual_token_refresh.py

# 3. Start with Gunicorn (production)
gunicorn main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000

# Or use systemd service (recommended)
sudo systemctl start mytradingsignal-backend
```

#### Frontend Deployment

```bash
# 1. Install dependencies
cd frontend
npm install

# 2. Build for production
npm run build

# 3. Start production server
npm run start

# Or use PM2 (recommended)
pm2 start npm --name "mytradingsignal-frontend" -- start
```

### Method 3: Managed Platforms

#### Backend: Railway, Render, Fly.io
- Deploy Python app with `uvicorn main:app`
- Set all environment variables in platform dashboard
- Ensure persistent storage for `access_token.json`

#### Frontend: Vercel, Netlify
- Connect GitHub repository
- Set build command: `npm run build`
- Set environment variables in platform dashboard

---

## 🔄 Daily Token Refresh (REQUIRED!)

**Zerodha access tokens expire daily.** You MUST set up automatic refresh.

### ⚠️ CRITICAL: Set Up Automation FIRST!

**After deployment, immediately run ONE of these automation setups:**

### Option 1: Automated Cron (Linux/Mac/Digital Ocean) ✅ RECOMMENDED
```bash
# SSH into your server
ssh root@your-droplet-ip
cd /path/to/mytradingSignal

# Run automated setup
chmod +x setup_token_cron.sh
./setup_token_cron.sh

# Verify
crontab -l
tail -f logs/token_refresh.log
```

### Option 2: Windows Task Scheduler (Windows Servers)
```powershell
# Run as Administrator
cd C:\path\to\mytradingSignal
.\setup_token_task.ps1

# Verify
Get-ScheduledTask -TaskName "ZerodhaTokenRefresh"
Get-Content logs\token_refresh.log -Tail 50
```

### Option 3: Docker Cron (Docker Deployments)
Add to your `docker-compose.yml`:
```yaml
  token-refresher:
    image: python:3.11-slim
    volumes:
      - ./:/app
    working_dir: /app
    environment:
      - TZ=Asia/Kolkata
    command: >
      bash -c "
      pip install kiteconnect python-dotenv &&
      echo '15 2 * * * python /app/auto_token_refresh.py >> /app/logs/token_refresh.log 2>&1' | crontab - &&
      cron -f
      "
    restart: unless-stopped
```

### Option 4: Manual Refresh (Emergency Only)
```bash
python manual_token_refresh.py
# Then restart backend
```

### Why Automation is REQUIRED:
- ❌ Without automation: App breaks every day at 7:30 AM IST
- ✅ With automation: App runs 24/7 without intervention
- ⚡ Backend auto-detects new token (no restart needed!)

---

## 📊 Post-Deployment Verification

### 1. Backend Health Check
```bash
curl https://api.yourdomain.com/api/system/health | jq
```

**Expected Response**:
```json
{
  "priority_status": "SYSTEM_READY",
  "priority_message": "✅ All systems operational",
  "market": {
    "phase": "LIVE",
    "is_trading_hours": true
  },
  "auth": {
    "state": "AUTHENTICATED",
    "is_valid": true
  },
  "feed": {
    "state": "CONNECTED",
    "is_healthy": true
  }
}
```

### 2. Frontend Check
- Open `https://yourdomain.com`
- Check browser console for errors
- Verify WebSocket connection (F12 → Network → WS)
- Test login flow
- Verify data displays correctly

### 3. WebSocket Connection Test
```javascript
// In browser console
const ws = new WebSocket('wss://api.yourdomain.com/ws/market');
ws.onopen = () => console.log('✅ WebSocket Connected');
ws.onmessage = (e) => console.log('📊 Data:', JSON.parse(e.data));
```

---

## 🔧 Token Refresh Files (Production Ready)

These files are **required** for production operations:

### Automated Refresh (NEW! ✨)
1. **`auto_token_refresh.py`** - Automated token refresh (for cron/scheduler)
2. **`setup_token_cron.sh`** - Linux/Mac cron setup script
3. **`setup_token_task.ps1`** - Windows Task Scheduler setup
4. **`refresh_token_cron.sh`** - Cron job script (created by setup)

### Manual Refresh (Backup)
1. **`manual_token_refresh.py`** - Manual token generation
2. **`quick_token_fix.py`** - Quick token fix when needed
3. **`backend/get_token.py`** - Alternative token generation

### Monthly Maintenance
1. **`backend/scripts/find_futures_tokens.py`** - Monthly futures token update

---

## ⚠️ Monthly Maintenance

### Update Futures Tokens (Last Thursday of Each Month)

```bash
cd backend/scripts
python find_futures_tokens.py
```

**Update `.env` with new tokens:**
```bash
NIFTY_FUT_TOKEN=<new_token>
BANKNIFTY_FUT_TOKEN=<new_token>
SENSEX_FUT_TOKEN=<new_token>
```

---

## 📝 Monitoring & Logging

### Backend Logs
```bash
# Docker
docker-compose logs -f backend

# Systemd
sudo journalctl -u mytradingsignal-backend -f

# Manual
tail -f backend.log
```

### Frontend Logs
```bash
# PM2
pm2 logs mytradingsignal-frontend

# Vercel/Netlify
Check platform dashboard
```

---

## 🚨 Troubleshooting

### Issue: "Token Expired" Error
**Solution**: Run `python manual_token_refresh.py` daily

### Issue: WebSocket 403 Forbidden
**Solution**: 
1. Check `ZERODHA_ACCESS_TOKEN` in `.env`
2. Regenerate token
3. Restart backend

### Issue: CORS Error
**Solution**:
1. Update `CORS_ORIGINS` in `backend/.env`
2. Add frontend domain to whitelist
3. Restart backend

### Issue: "Market Closed" No Data
**Solution**: This is normal. System shows last session data with "📊 LAST SESSION" badge

---

## ✅ Production Ready Status

- ✅ No test files
- ✅ No hardcoded credentials
- ✅ Environment variables configured
- ✅ Console logs retained (useful for debugging)
- ✅ Backend structured logging
- ✅ Operational utilities available
- ✅ Docker support ready
- ✅ Security hardening complete

---

## 📞 Support & Documentation

- **Full Docs**: `/docs` folder
- **API Docs**: `https://api.yourdomain.com/docs` (Swagger UI)
- **Architecture**: `docs/ARCHITECTURE_DIAGRAM.md`
- *✅ Deploy to your chosen platform
2. ✅ Generate first access token: `python manual_token_refresh.py`
3. ✅ **CRITICAL**: Set up automation IMMEDIATELY:
   - Linux/Mac: `./setup_token_cron.sh`
   - Windows: `.\setup_token_task.ps1`
   - Docker: Add token-refresher service to docker-compose.yml
4. ✅ Test thoroughly (including overnight test)
5. ✅ Monitor logs for 2-3 days: `tail -f logs/token_refresh.log`
6. ✅ Set up health monitoring (UptimeRobot, Cronitor, etc.)

**⚠️ WARNING**: Without token automation, your app will stop working within 24 hours!

Your trading signals platform is now production-ready! 🚀

**Next Steps**:
1. Generate first access token
2. Deploy to your chosen platform
3. Test thoroughly
4. Set up daily token refresh automation
5. Monitor logs for any issues
