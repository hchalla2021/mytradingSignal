# 🚀 Simple Production Deployment - No Auto-Detection

## ✅ Changes Made
- ❌ Removed all auto-detection logic
- ✅ Direct URLs from .env files only
- ✅ Simple configuration

---

## 📁 Environment Files

### **Backend: `backend/.env`**
```bash
# Zerodha API
ZERODHA_API_KEY=your_key
ZERODHA_API_SECRET=your_secret
ZERODHA_ACCESS_TOKEN=your_token

# Production URLs
REDIRECT_URL=https://mydailytradesignals.com/api/auth/callback
FRONTEND_URL=https://mydailytradesignals.com

# Server
HOST=0.0.0.0
PORT=8000
DEBUG=False
CORS_ORIGINS=https://mydailytradesignals.com

# Scheduler
ENABLE_SCHEDULER=true

# Redis
REDIS_URL=redis://localhost:6379
```

### **Frontend: `frontend/.env.local`**
```bash
# Backend URLs
NEXT_PUBLIC_API_URL=https://mydailytradesignals.com
NEXT_PUBLIC_WS_URL=wss://mydailytradesignals.com/ws/market

# Features
NEXT_PUBLIC_ENABLE_AI_ANALYSIS=false
NEXT_PUBLIC_MARKET_REFRESH_INTERVAL=3000
```

---

## 🚀 Deploy to Digital Ocean

### **1. Copy Files**
```bash
# SSH into server
ssh root@your-droplet-ip

# Update code
cd /var/www/mytradingSignal
git pull origin main
```

### **2. Update Backend .env**
```bash
cd /var/www/mytradingSignal/backend
nano .env
```

**Make sure these values are correct:**
```bash
REDIRECT_URL=https://mydailytradesignals.com/api/auth/callback
FRONTEND_URL=https://mydailytradesignals.com
CORS_ORIGINS=https://mydailytradesignals.com
ENABLE_SCHEDULER=true
```

### **3. Update Frontend .env.local**
```bash
cd /var/www/mytradingSignal/frontend
nano .env.local
```

**Make sure these values are correct:**
```bash
NEXT_PUBLIC_API_URL=https://mydailytradesignals.com
NEXT_PUBLIC_WS_URL=wss://mydailytradesignals.com/ws/market
```

### **4. Rebuild Frontend**
```bash
cd /var/www/mytradingSignal/frontend
npm install
npm run build
```

### **5. Restart Services**
```bash
pm2 restart all
pm2 save
```

### **6. Verify**
```bash
# Check backend config
cd /var/www/mytradingSignal/backend
python3 -c "from config import Settings; s = Settings(); print('Redirect:', s.redirect_url)"

# Should show: Redirect: https://mydailytradesignals.com/api/auth/callback
```

---

## ✅ Test Mobile Login

1. Open mobile browser
2. Go to: https://mydailytradesignals.com
3. Click "Login with Zerodha"
4. Should redirect to: `https://kite.zerodha.com/connect/login`
5. After login, should return to: `https://mydailytradesignals.com`

**❌ Should NOT see: `localhost` or `127.0.0.1`**

---

## 📝 For Local Testing

If you want to test locally, change URLs in your local `.env` files:

**Backend .env:**
```bash
REDIRECT_URL=http://127.0.0.1:8000/api/auth/callback
FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
ENABLE_SCHEDULER=false
```

**Frontend .env.local:**
```bash
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_WS_URL=ws://127.0.0.1:8000/ws/market
```

---

**Last Updated:** January 12, 2026
