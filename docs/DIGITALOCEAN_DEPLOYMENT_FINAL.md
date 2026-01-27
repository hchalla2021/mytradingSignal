# 🚀 DIGITALOCEAN DEPLOYMENT GUIDE - FINAL VERSION

## ✅ PRE-DEPLOYMENT CHECKLIST

### **1. Frontend Configuration**

**Create `frontend/.env.production`:**
```bash
# ==============================================================================
# PRODUCTION CONFIGURATION - UPDATE WITH YOUR DOMAIN
# ==============================================================================

# ⚠️ REQUIRED: Update these URLs with your actual DigitalOcean domain
NEXT_PUBLIC_API_URL=https://api.mydailytrade.com
NEXT_PUBLIC_WS_URL=wss://api.mydailytrade.com/ws/market

# Environment
NEXT_PUBLIC_ENVIRONMENT=production
NEXT_PUBLIC_RODDUCTION_DOMAIN=mydailytrade.com

# API Settings
NEXT_PUBLIC_API_TIMEOUT=8000
NEXT_PUBLIC_MARKET_SYMBOLS=NIFTY,BANKNIFTY,SENSEX

# Feature Flags (Disabled in production)
NEXT_PUBLIC_ENABLE_DEBUG=false
NEXT_PUBLIC_ENABLE_LOGS=false
```

### **2. Backend Configuration**

**Update `backend/.env`:**
```bash
# ==============================================================================
# PRODUCTION CONFIGURATION - UPDATE WITH YOUR DOMAIN
# ==============================================================================

# ==================== ZERODHA API ====================
ZERODHA_API_KEY=your_actual_api_key
ZERODHA_API_SECRET=your_actual_secret
ZERODHA_ACCESS_TOKEN=will_be_auto_updated_daily

# ==================== OAUTH & REDIRECT ====================
# ⚠️ CRITICAL: Update with your production domain
REDIRECT_URL=https://api.mydailytrade.com/api/auth/callback
FRONTEND_URL=https://mydailytrade.com

# ==================== JWT ====================
JWT_SECRET=your_super_secure_random_string_here

# ==================== SERVER ====================
HOST=0.0.0.0
PORT=8000
DEBUG=False  # ⚠️ IMPORTANT: False in production

# ==================== CORS ====================
# ⚠️ CRITICAL: Set to your actual frontend domain
CORS_ORIGINS=https://mydailytrade.com,https://www.mydailytrade.com

# ==================== REDIS ====================
REDIS_URL=redis://localhost:6379
# Or use managed Redis:
# REDIS_URL=redis://your-redis-host:6379

# ==================== INSTRUMENT TOKENS ====================
# (Keep existing values)
NIFTY_TOKEN=256265
BANKNIFTY_TOKEN=260105
SENSEX_TOKEN=265

# ==================== FUTURES TOKENS ====================
# Update monthly before expiry
NIFTY_FUT_TOKEN=12602626
BANKNIFTY_FUT_TOKEN=12601346
SENSEX_FUT_TOKEN=292786437
```

### **3. Scripts Configuration**

**Create `backend/scripts/.env`:**
```bash
# For production scripts
API_BASE_URL=https://api.mydailytrade.com
```

### **4. Zerodha Developer Console**

**Update redirect URL at https://developers.kite.trade:**
```
Old: http://127.0.0.1:8000/api/auth/callback
New: https://api.mydailytrade.com/api/auth/callback
```

---

## 📦 DEPLOYMENT STEPS

### **Step 1: SSH into DigitalOcean**
```bash
ssh root@your-droplet-ip
cd /var/www/mytradingSignal
```

### **Step 2: Update Code**
```bash
# Pull latest code
git pull origin main

# Install dependencies
cd backend
pip install -r requirements.txt

cd ../frontend
npm install
```

### **Step 3: Update Environment Files**

**Frontend:**
```bash
cd /var/www/mytradingSignal/frontend

# Create .env.production
nano .env.production

# Copy from .env.production.template and update URLs
# Save: Ctrl+X, Y, Enter
```

**Backend:**
```bash
cd /var/www/mytradingSignal/backend

# Update .env
nano .env

# Update:
# - REDIRECT_URL=https://api.mydailytrade.com/api/auth/callback
# - FRONTEND_URL=https://mydailytrade.com
# - CORS_ORIGINS=https://mydailytrade.com
# - DEBUG=False
# Save: Ctrl+X, Y, Enter
```

**Scripts:**
```bash
cd /var/www/mytradingSignal/backend/scripts

# Create .env
nano .env

# Add:
# API_BASE_URL=https://api.mydailytrade.com
# Save: Ctrl+X, Y, Enter
```

### **Step 4: Build Frontend**
```bash
cd /var/www/mytradingSignal/frontend

# Build for production
npm run build

# Verify build completed
ls -la .next/
```

### **Step 5: Setup Token Auto-Refresh**
```bash
cd /var/www/mytradingSignal

# Run setup (if not already done)
chmod +x setup_token_cron.sh
./setup_token_cron.sh

# Verify cron job
crontab -l | grep token
# Should show: 15 2 * * * /var/www/mytradingSignal/refresh_token_cron.sh
```

### **Step 6: Start Services**

**Using PM2 (Recommended):**
```bash
# Install PM2 if not already installed
npm install -g pm2

# Start backend
cd /var/www/mytradingSignal/backend
pm2 start "uvicorn main:app --host 0.0.0.0 --port 8000" --name trading-backend

# Start frontend
cd /var/www/mytradingSignal/frontend
pm2 start npm --name trading-frontend -- start

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

**Using Docker (Alternative):**
```bash
cd /var/www/mytradingSignal
docker-compose up -d --build
```

**Using systemd (Alternative):**
```bash
# Start services
sudo systemctl start trading-backend
sudo systemctl start trading-frontend

# Enable on boot
sudo systemctl enable trading-backend
sudo systemctl enable trading-frontend
```

### **Step 7: Generate Initial Token**
```bash
cd /var/www/mytradingSignal
python3 manual_token_refresh.py

# Follow prompts:
# 1. Open URL in browser
# 2. Login to Zerodha
# 3. Copy request_token from redirect URL
# 4. Paste into terminal
```

### **Step 8: Verify Services**

**Backend Health:**
```bash
curl http://localhost:8000/api/system/health | jq
```

**Expected output:**
```json
{
  "priority_status": "SYSTEM_READY",
  "auth": {
    "state": "AUTHENTICATED",
    "is_valid": true
  },
  "feed": {
    "state": "CONNECTED",
    "is_healthy": true
  },
  "market": {
    "phase": "CLOSED",
    "is_trading_hours": false
  }
}
```

**Frontend:**
```bash
curl http://localhost:3000 | head -20
# Should show HTML
```

**PM2 Status:**
```bash
pm2 list
pm2 logs trading-backend --lines 50
pm2 logs trading-frontend --lines 50
```

---

## 🔍 VERIFICATION CHECKLIST

### **After Deployment:**

- [ ] Backend responds: `curl https://api.mydailytrade.com/health`
- [ ] Frontend loads: `https://mydailytrade.com`
- [ ] Login button works (opens Zerodha)
- [ ] WebSocket shows "Connected" status
- [ ] Token auto-refresh cron job exists: `crontab -l`
- [ ] Logs directory created: `ls -la logs/`
- [ ] Services auto-start on reboot

### **During Market Hours (9:00 AM - 3:30 PM IST):**

- [ ] 9:00 AM: Status shows "🟡 PRE-OPEN"
- [ ] 9:07 AM: Status shows "🟡 AUCTION_FREEZE"
- [ ] 9:15 AM: Status changes to "🟢 LIVE" (automatically!)
- [ ] Live data flows to all components
- [ ] No manual restart needed

### **Authentication:**

- [ ] Login button opens Zerodha popup/page
- [ ] After login, redirects back to your app
- [ ] Status changes from "Login Required" to "Connected"
- [ ] User name shows in header
- [ ] No errors in browser console (F12)

---

## 🐛 TROUBLESHOOTING

### **Issue: "Login Required" persists**

**Solution:**
```bash
# Check backend logs
pm2 logs trading-backend

# Verify token in .env
cat backend/.env | grep ZERODHA_ACCESS_TOKEN

# Regenerate token
python3 manual_token_refresh.py

# Restart backend
pm2 restart trading-backend
```

### **Issue: "Feed Disconnected"**

**Solution:**
```bash
# Check if outside market hours (expected behavior)
# If during market hours:

# Check WebSocket connection
pm2 logs trading-backend | grep WebSocket

# Verify auth state
curl http://localhost:8000/api/system/health/auth | jq

# Restart if needed
pm2 restart trading-backend
```

### **Issue: "CORS Error" in browser**

**Solution:**
```bash
# Update backend/.env
nano backend/.env

# Add your frontend domain to CORS_ORIGINS:
CORS_ORIGINS=https://mydailytrade.com,https://www.mydailytrade.com

# Restart
pm2 restart trading-backend
```

### **Issue: Token refresh fails**

**Solution:**
```bash
# Check cron logs
tail -f logs/token_refresh.log

# Test manual refresh
./refresh_token_cron.sh

# If fails, regenerate manually
python3 manual_token_refresh.py
```

### **Issue: Services don't start on reboot**

**Solution:**
```bash
# PM2:
pm2 startup
pm2 save

# systemd:
sudo systemctl enable trading-backend
sudo systemctl enable trading-frontend

# Docker:
# Ensure docker-compose.yml has "restart: unless-stopped"
```

---

## 📊 MONITORING

### **Health Checks:**
```bash
# Backend
curl https://api.mydailytrade.com/api/system/health

# Frontend
curl https://mydailytrade.com

# WebSocket (from browser console)
const ws = new WebSocket('wss://api.mydailytrade.com/ws/market');
ws.onopen = () => console.log('Connected');
```

### **Logs:**
```bash
# PM2
pm2 logs trading-backend --lines 100
pm2 logs trading-frontend --lines 100

# Token refresh
tail -f logs/token_refresh.log

# Nginx (if used)
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

### **System Resources:**
```bash
# PM2 monitoring
pm2 monit

# System resources
htop

# Disk space
df -h

# Memory
free -h
```

---

## 🔄 MAINTENANCE

### **Daily:**
- ✅ Token auto-refreshes at 7:45 AM IST (automated)
- ✅ No action needed

### **Monthly (Last Thursday):**
```bash
# Update futures tokens
cd /var/www/mytradingSignal/backend/scripts
python find_futures_tokens.py

# Update .env with new tokens
nano ../env

# Restart backend
pm2 restart trading-backend
```

### **Code Updates:**
```bash
cd /var/www/mytradingSignal
git pull origin main

# Backend
cd backend
pip install -r requirements.txt
pm2 restart trading-backend

# Frontend
cd ../frontend
npm install
npm run build
pm2 restart trading-frontend
```

---

## ✅ SUCCESS INDICATORS

**Your deployment is successful when:**

1. ✅ Frontend loads at `https://mydailytrade.com`
2. ✅ Login button works and redirects properly
3. ✅ After login, status shows "Connected"
4. ✅ At 9:00 AM, status changes to "PRE-OPEN" automatically
5. ✅ At 9:15 AM, status changes to "LIVE" automatically
6. ✅ All index cards show live prices
7. ✅ WebSocket quality shows "70%+" or higher
8. ✅ Token auto-refreshes daily (check logs)
9. ✅ No errors in PM2 logs or browser console
10. ✅ Services restart automatically after reboot

---

## 🎉 DEPLOYMENT COMPLETE!

Your trading signals platform is now live on DigitalOcean!

**Next Steps:**
1. Monitor logs for first 24 hours
2. Verify token auto-refresh tomorrow at 7:45 AM
3. Test authentication flow from different devices
4. Set up monitoring (UptimeRobot, Cronitor, etc.)
5. Share with users and enjoy! 📈

---

**Need Help?**
- Check logs: `pm2 logs`
- Test health: `curl localhost:8000/api/system/health`
- Verify cron: `crontab -l`
- Review audit: `AUDIT_REPORT.md`
