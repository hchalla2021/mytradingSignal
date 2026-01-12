# 🚀 Quick Start - Environment Setup

## ✅ Current Setup (Simplified)

```
✅ backend/.env          → Configured (auto-detection enabled)
✅ frontend/.env.local   → Configured (auto-detection enabled)
📦 archive/env_backups/  → Old files backed up safely
```

---

## 🎯 Run Commands

### **Local Development**
```bash
# Terminal 1 - Backend
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Terminal 2 - Frontend
cd frontend
npm run dev -- -p 3000
```

### **Production (Digital Ocean)**
```bash
# Backend (systemd service)
sudo systemctl restart trading-backend

# Frontend (PM2)
pm2 restart trading-frontend
```

---

## 🔧 How Auto-Detection Works

### Backend (`backend/.env`)
- `ENVIRONMENT=auto` → Detects based on request URL
- Local: Uses `http://127.0.0.1:8000`
- Production: Uses `https://mydailytradesignals.com`

### Frontend (`frontend/.env.local`)
- `NEXT_PUBLIC_ENVIRONMENT=auto` → Detects based on `window.location.hostname`
- Local: Uses `localhost` URLs
- Production: Uses production URLs

---

## 📋 Required Environment Variables

### Backend (`.env`)
```bash
ZERODHA_API_KEY=g5tyrnn1mlckrb6f
ZERODHA_API_SECRET=6cusjkixpyv7pii7c2rtei61ewcoxj3l
ZERODHA_ACCESS_TOKEN=<your_token>

# Auto-detection (leave as-is)
ENVIRONMENT=auto
LOCAL_REDIRECT_URL=http://127.0.0.1:8000/api/auth/callback
PRODUCTION_REDIRECT_URL=https://mydailytradesignals.com/api/auth/callback
```

### Frontend (`.env.local`)
```bash
# Local URLs
NEXT_PUBLIC_LOCAL_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_LOCAL_WS_URL=ws://127.0.0.1:8000/ws/market

# Production URLs
NEXT_PUBLIC_PRODUCTION_API_URL=https://mydailytradesignals.com
NEXT_PUBLIC_PRODUCTION_WS_URL=wss://mydailytradesignals.com/ws/market

# Auto-detection (leave as-is)
NEXT_PUBLIC_ENVIRONMENT=auto
```

---

## ✅ Testing

### 1. Verify Backend Environment
```bash
cd backend
python -c "from config import settings; print(f'ENV: {settings.ENVIRONMENT}'); print(f'API KEY: {settings.ZERODHA_API_KEY[:10]}...')"
```

**Expected Output:**
```
ENV: auto
API KEY: g5tyrnn1ml...
```

### 2. Verify Frontend Environment
```bash
cd frontend
npm run dev
```

**Check browser console:**
```
Environment detected: local
API URL: http://127.0.0.1:8000
```

---

## 🐛 Troubleshooting

### Issue: "Module not found" errors
```bash
cd backend
pip install -r requirements.txt

cd frontend
npm install
```

### Issue: "CORS error"
**Check backend `.env`:**
```bash
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,https://mydailytradesignals.com
```

### Issue: "Token expired"
**Generate new token:**
```bash
cd backend
python get_token.py
# Copy new token to .env → ZERODHA_ACCESS_TOKEN=<new_token>
```

---

## 🎉 Success Indicators

✅ Backend running: `http://127.0.0.1:8000/docs`  
✅ Frontend running: `http://localhost:3000`  
✅ WebSocket connected: Green status in UI  
✅ Live data flowing: Market indices updating  

---

## 📝 Production Deployment Checklist

- [ ] Copy `backend/.env` to server (no changes needed!)
- [ ] Update `ZERODHA_ACCESS_TOKEN` with production token
- [ ] Set `ENABLE_SCHEDULER=true` in backend `.env`
- [ ] Copy `frontend/.env.local` to server
- [ ] Run `npm run build` in frontend
- [ ] Restart backend service
- [ ] Restart frontend PM2 process
- [ ] Verify `https://mydailytradesignals.com` loads
- [ ] Check SSL certificate (wss:// for WebSocket)

---

## 🗂️ File Locations

```
mytradingSignal/
├── backend/.env                          ← Single backend config
├── frontend/.env.local                   ← Single frontend config
├── archive/env_backups/                  ← Old files (safe to delete)
│   ├── .env.example.backup
│   ├── .env.production.backup
│   ├── .env.local.example.backup
│   └── .env.production.local.backup
├── ENV_SETUP.md                          ← Detailed documentation
└── QUICK_START_ENV.md                    ← This file
```

---

**Questions?** Check `ENV_SETUP.md` for detailed explanations.
