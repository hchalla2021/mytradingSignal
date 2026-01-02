# 🚀 Production Deployment Checklist

**Date:** January 2, 2026  
**Status:** ⚠️ **READY AFTER FIXES APPLIED**

---

## ✅ **CRITICAL FIXES APPLIED**

### **1. Security Fixes** 🔒
- ✅ Removed exposed Zerodha API credentials from `.env`
- ✅ Removed weak JWT secret (placeholder added)
- ✅ Set `DEBUG=False` for production mode
- ✅ Fixed `.gitignore` to keep `.env.example` files
- ✅ Commented out debug `console.log` statements in frontend

---

## 🔥 **BEFORE DEPLOYMENT - MUST DO:**

### **1. Backend Configuration (backend/.env):**

```bash
# Edit your .env file on production server
cd backend
nano .env
```

**Required Changes:**

```env
# Add YOUR Zerodha credentials
ZERODHA_API_KEY=your_actual_api_key_here
ZERODHA_API_SECRET=your_actual_secret_here
ZERODHA_ACCESS_TOKEN=  # Will be filled after first login

# Generate SECURE JWT secret (run this command):
# openssl rand -hex 32
JWT_SECRET=YOUR_GENERATED_64_CHAR_RANDOM_STRING

# Set your production URLs
REDIRECT_URL=https://api.yourdomain.com/api/auth/callback
FRONTEND_URL=https://yourdomain.com

# Production settings
DEBUG=False
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

### **2. Update Zerodha App Settings:**
1. Go to: https://developers.kite.trade/apps
2. Update redirect URL to: `https://api.yourdomain.com/api/auth/callback`
3. Save changes

### **3. Frontend Environment (Vercel/Netlify Dashboard):**

Add these in deployment platform:

```env
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
NEXT_PUBLIC_WS_URL=wss://api.yourdomain.com/ws/market
NEXT_PUBLIC_MARKET_SYMBOLS=NIFTY,BANKNIFTY,SENSEX
NEXT_PUBLIC_ENABLE_AI_ANALYSIS=false
```

---

## 📋 **PRODUCTION READINESS CHECKLIST**

### **Security** 🔒
- [x] ✅ No hardcoded credentials in code
- [x] ✅ `.env` files in `.gitignore`
- [x] ✅ `.env.example` templates provided
- [x] ⚠️ **JWT_SECRET placeholder** - MUST change before deploy
- [x] ⚠️ **API credentials placeholder** - MUST add before deploy
- [x] ✅ `DEBUG=False` in production
- [ ] ⚠️ CORS restricted to your domain (currently set to `*`)

### **Code Quality** ✨
- [x] ✅ No syntax errors
- [x] ✅ No test/dummy files
- [x] ✅ No unused imports
- [x] ✅ Debug logs commented out in frontend
- [x] ✅ All services properly configured
- [x] ✅ Error handling in place

### **Configuration** ⚙️
- [x] ✅ All config from environment variables
- [x] ✅ Backend `.env.example` template complete
- [x] ✅ Frontend `.env.local.example` template complete
- [x] ✅ Market timing configured (IST timezone)
- [x] ✅ Token auto-reload working
- [x] ✅ Futures tokens auto-update feature enabled

### **API & Authentication** 🔐
- [x] ✅ Zerodha OAuth flow complete
- [x] ✅ Token refresh mechanism working
- [x] ✅ JWT authentication configured
- [ ] ⚠️ Must add YOUR Zerodha credentials
- [ ] ⚠️ Must generate secure JWT secret
- [ ] ⚠️ Must update Zerodha redirect URL

### **Performance** ⚡
- [x] ✅ Redis caching configured
- [x] ✅ WebSocket optimized
- [x] ✅ Rate limiting in place
- [x] ✅ Efficient data structures
- [x] ✅ Background task scheduling

### **Monitoring** 📊
- [x] ✅ Health check endpoint (`/health`)
- [x] ✅ Market status endpoint (`/api/market-status`)
- [x] ✅ Token status endpoint (`/api/token-status`)
- [x] ✅ Readiness probe (`/health/ready`)
- [x] ✅ Comprehensive logging

### **Documentation** 📚
- [x] ✅ README with setup instructions
- [x] ✅ Environment setup guide
- [x] ✅ API documentation
- [x] ✅ Deployment guides
- [x] ✅ Troubleshooting guides

---

## 🚀 **DEPLOYMENT STEPS**

### **Option 1: Digital Ocean (Backend) + Vercel (Frontend)**

#### **Backend on Digital Ocean:**

```bash
# 1. SSH into server
ssh root@your-server-ip

# 2. Clone repository
git clone https://github.com/yourusername/mytradingSignal.git
cd mytradingSignal/backend

# 3. Create virtual environment
python3 -m venv venv
source venv/bin/activate

# 4. Install dependencies
pip install -r requirements.txt

# 5. Configure environment
cp .env.example .env
nano .env
# Add your Zerodha credentials, JWT secret, production URLs

# 6. Test locally
uvicorn main:app --host 0.0.0.0 --port 8000

# 7. Set up systemd service
sudo nano /etc/systemd/system/trading-backend.service
```

**systemd service file:**
```ini
[Unit]
Description=Trading Signals Backend
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/mytradingSignal/backend
Environment="PATH=/root/mytradingSignal/backend/venv/bin"
ExecStart=/root/mytradingSignal/backend/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
# 8. Start service
sudo systemctl daemon-reload
sudo systemctl enable trading-backend
sudo systemctl start trading-backend
sudo systemctl status trading-backend

# 9. Set up Nginx reverse proxy
sudo nano /etc/nginx/sites-available/trading-api
```

**Nginx config:**
```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
# Enable site and SSL
sudo ln -s /etc/nginx/sites-available/trading-api /etc/nginx/sites-enabled/
sudo certbot --nginx -d api.yourdomain.com
sudo systemctl reload nginx
```

#### **Frontend on Vercel:**

```bash
# 1. Push to GitHub
git push origin main

# 2. Import to Vercel
# - Go to vercel.com
# - Import from GitHub
# - Select mytradingSignal repository

# 3. Configure environment variables in Vercel dashboard:
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
NEXT_PUBLIC_WS_URL=wss://api.yourdomain.com/ws/market
NEXT_PUBLIC_MARKET_SYMBOLS=NIFTY,BANKNIFTY,SENSEX
NEXT_PUBLIC_ENABLE_AI_ANALYSIS=false

# 4. Deploy
# Vercel will auto-deploy on every git push
```

---

### **Option 2: Docker Deployment**

```bash
# 1. Build and start services
docker-compose up -d

# 2. Check logs
docker-compose logs -f

# 3. Access services
# Backend: http://localhost:8000
# Frontend: http://localhost:3000
```

---

## 🔍 **POST-DEPLOYMENT VERIFICATION**

### **1. Health Checks:**
```bash
# Backend health
curl https://api.yourdomain.com/health

# Market status
curl https://api.yourdomain.com/api/market-status

# Token status
curl https://api.yourdomain.com/api/token-status
```

**Expected responses:**
```json
// /health
{"status": "healthy", "timestamp": "...", "service": "MyDailyTradingSignals API"}

// /api/market-status
{"status": "CLOSED", "time": "...", "isTrading": false}

// /api/token-status
{"has_access_token": true, "token_age_seconds": ...}
```

### **2. Frontend Checks:**
- [ ] Dashboard loads without errors
- [ ] WebSocket connection establishes
- [ ] Market status shows correctly
- [ ] No console errors in browser DevTools

### **3. Authentication Flow:**
1. Visit: https://yourdomain.com
2. Should see login button if token expired
3. Click login → Redirects to Zerodha
4. After Zerodha login → Redirects back to dashboard
5. Token saved automatically
6. Backend reconnects without restart
7. Live data starts flowing

### **4. During Market Hours (9:00-15:30 IST):**
- [ ] Status changes to "PRE_OPEN" at 9:00 AM
- [ ] Status changes to "LIVE" at 9:15 AM
- [ ] Prices update every second
- [ ] WebSocket stays connected
- [ ] All indices showing data (NIFTY, BANKNIFTY, SENSEX)

---

## ⚠️ **KNOWN LIMITATIONS**

### **Token Expiry:**
- Zerodha tokens expire daily at 3:30 AM IST
- **Manual action required:** Login once per day
- Use `quick_token_fix.py` or browser login
- Takes ~30 seconds
- Backend auto-reconnects without restart

### **Rate Limits:**
- Zerodha API: 3 requests/second (handled automatically)
- PCR data: Staggered fetching to avoid limits
- Retry mechanism with exponential backoff

### **Market Hours:**
- Pre-open: 9:00-9:15 AM IST (data flows)
- Live: 9:15 AM-3:30 PM IST
- After hours: Shows last traded prices
- Weekends/holidays: Market CLOSED status

---

## 🆘 **TROUBLESHOOTING**

### **"No data showing on dashboard"**
```bash
# Check backend logs
sudo journalctl -u trading-backend -f

# Check token status
curl https://api.yourdomain.com/api/token-status

# If token expired, regenerate:
# Visit: https://api.yourdomain.com/api/auth/login
```

### **"WebSocket disconnected"**
- Check CORS settings in backend `.env`
- Verify `wss://` URL (not `ws://`) in production
- Check Nginx WebSocket proxy configuration
- Ensure firewall allows WebSocket connections

### **"403 Forbidden from Zerodha"**
- Token expired → Regenerate via login
- API credentials incorrect → Check `.env`
- Redirect URL mismatch → Update Zerodha app settings

---

## 📊 **PRODUCTION MONITORING**

### **Backend Logs:**
```bash
# Systemd service logs
sudo journalctl -u trading-backend -f --since today

# Application logs
tail -f /var/log/trading-backend.log
```

### **Key Metrics to Monitor:**
- [ ] CPU usage (should be <30% normally)
- [ ] Memory usage (should be <500MB)
- [ ] WebSocket connections count
- [ ] API response times
- [ ] Error rates
- [ ] Token refresh frequency

### **Alerts to Set Up:**
- Backend service down
- High error rate (>5%)
- Token expired for >1 hour
- WebSocket disconnections
- No market data updates during trading hours

---

## ✅ **FINAL CHECKLIST BEFORE GO-LIVE**

### **Must Complete:**
- [ ] ⚠️ **CRITICAL:** Add YOUR Zerodha API key & secret to `.env`
- [ ] ⚠️ **CRITICAL:** Generate and set secure JWT_SECRET (32+ chars)
- [ ] ⚠️ **CRITICAL:** Update Zerodha redirect URL to production domain
- [ ] Set `DEBUG=False` in `.env` ✅ (Already done)
- [ ] Configure production CORS_ORIGINS
- [ ] Set up SSL/HTTPS certificates
- [ ] Configure frontend environment variables
- [ ] Test authentication flow
- [ ] Test during market hours
- [ ] Set up monitoring/alerts
- [ ] Backup `.env` file securely (offline)

### **Recommended:**
- [ ] Set up Redis for better performance
- [ ] Configure email/SMS alerts (optional)
- [ ] Set up automated backups
- [ ] Document runbook for team
- [ ] Load testing
- [ ] Set up error tracking (Sentry)

---

## 🎉 **YOU'RE READY TO DEPLOY!**

After completing the checklist above, your application is production-ready.

**Support:**
- Documentation: `docs/` folder
- Quick Reference: `docs/QUICK_REFERENCE.md`
- Troubleshooting: `docs/AUTO_MARKET_TIMING_EXPLAINED.md`

**Good luck with your deployment!** 🚀
