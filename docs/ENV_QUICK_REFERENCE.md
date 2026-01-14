# 🔧 Environment Configuration - Quick Reference

## 📝 Current Setup: Simple Direct URLs

No auto-detection. All URLs come directly from `.env` files.

---

## 🏠 LOCAL TESTING (Current)

### **Backend: `backend/.env`**
```bash
REDIRECT_URL=http://127.0.0.1:8000/api/auth/callback
FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=https://mydailytradesignals.com,http://localhost:3000,http://127.0.0.1:3000
ENABLE_SCHEDULER=false
```

### **Frontend: `frontend/.env.local`**
```bash
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_WS_URL=ws://127.0.0.1:8000/ws/market
```

---

## 🚀 PRODUCTION DEPLOYMENT

### **Backend: `/var/www/mytradingSignal/backend/.env`**
```bash
REDIRECT_URL=https://mydailytradesignals.com/api/auth/callback
FRONTEND_URL=https://mydailytradesignals.com
CORS_ORIGINS=https://mydailytradesignals.com
ENABLE_SCHEDULER=true
```

### **Frontend: `/var/www/mytradingSignal/frontend/.env.local`**
```bash
NEXT_PUBLIC_API_URL=https://mydailytradesignals.com
NEXT_PUBLIC_WS_URL=wss://mydailytradesignals.com/ws/market
```

---

## 🔄 Switching Environments

### **From Local → Production**

**1. Update backend/.env:**
```bash
REDIRECT_URL=https://mydailytradesignals.com/api/auth/callback
FRONTEND_URL=https://mydailytradesignals.com
CORS_ORIGINS=https://mydailytradesignals.com
ENABLE_SCHEDULER=true
```

**2. Update frontend/.env.local:**
```bash
NEXT_PUBLIC_API_URL=https://mydailytradesignals.com
NEXT_PUBLIC_WS_URL=wss://mydailytradesignals.com/ws/market
```

**3. Rebuild & restart:**
```bash
cd frontend
npm run build
pm2 restart all
```

---

### **From Production → Local**

**1. Update backend/.env:**
```bash
REDIRECT_URL=http://127.0.0.1:8000/api/auth/callback
FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=https://mydailytradesignals.com,http://localhost:3000,http://127.0.0.1:3000
ENABLE_SCHEDULER=false
```

**2. Update frontend/.env.local:**
```bash
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_WS_URL=ws://127.0.0.1:8000/ws/market
```

**3. Restart:**
```bash
# Backend auto-reloads
# Frontend: stop and restart dev server
```

---

## ✅ Current Status

**Local Testing Mode:**
- Backend: `http://0.0.0.0:8000` → connects to `http://localhost:3000`
- Frontend: `http://localhost:3000` → connects to `http://127.0.0.1:8000`
- Scheduler: Disabled (data available anytime)
- CORS: Allows localhost

**Access:** http://localhost:3000

---

**Last Updated:** January 12, 2026
