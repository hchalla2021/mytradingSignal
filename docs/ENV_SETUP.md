# Environment Configuration - Simplified Setup

## 📁 Environment Files Structure

We've simplified to **2 environment files only**:

```
mytradingSignal/
├── backend/
│   └── .env                    # Backend config (local + production)
└── frontend/
    └── .env.local              # Frontend config (auto-detects environment)
```

## 🚀 Why Simplified?

**Before:** Multiple confusing files (`.env.example`, `.env.production`, `.env.local.example`, `.env.production.local`)  
**After:** Just 2 files with auto-detection - works everywhere!

---

## ⚙️ Backend Configuration (`backend/.env`)

The backend `.env` file has **auto-detection** built-in:

```bash
# Environment auto-detection
ENVIRONMENT=auto  # Options: auto | local | production
```

### How it works:
- **Local Development:** Detects `localhost` or `127.0.0.1` → uses LOCAL_REDIRECT_URL
- **Production:** Detects domain → uses PRODUCTION_REDIRECT_URL
- **Manual Override:** Set `ENVIRONMENT=local` or `ENVIRONMENT=production`

### Required Variables:
```bash
# Zerodha API
ZERODHA_API_KEY=your_key
ZERODHA_API_SECRET=your_secret
ZERODHA_ACCESS_TOKEN=your_token

# JWT
JWT_SECRET=your-secret-key

# Redis
REDIS_URL=redis://localhost:6379

# Instrument tokens (update monthly for futures)
NIFTY_TOKEN=256265
BANKNIFTY_TOKEN=260105
SENSEX_TOKEN=265
```

---

## 🌐 Frontend Configuration (`frontend/.env.local`)

The frontend also has **auto-detection**:

```bash
# Environment auto-detection
NEXT_PUBLIC_ENVIRONMENT=auto  # Options: auto | local | production
```

### How it works:
- **Detects `localhost`** → Uses `NEXT_PUBLIC_LOCAL_API_URL`
- **Detects domain** → Uses `NEXT_PUBLIC_PRODUCTION_API_URL`

### Required Variables:
```bash
# Local URLs
NEXT_PUBLIC_LOCAL_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_LOCAL_WS_URL=ws://127.0.0.1:8000/ws/market

# Production URLs
NEXT_PUBLIC_PRODUCTION_API_URL=https://mydailytradesignals.com
NEXT_PUBLIC_PRODUCTION_WS_URL=wss://mydailytradesignals.com/ws/market
```

---

## 📦 Deployment

### Local Development
1. Use existing `.env` files
2. Run: `cd backend && uvicorn main:app --reload`
3. Run: `cd frontend && npm run dev`

### Production (Digital Ocean)
1. Copy `backend/.env` to server (no changes needed!)
2. Copy `frontend/.env.local` to server as `.env.production.local` (optional)
3. Auto-detection handles the rest

---

## 🗂️ Archived Files

Old environment files are backed up in:
```
archive/env_backups/
├── .env.example.backup
├── .env.production.backup
├── .env.local.example.backup
└── .env.production.local.backup
```

**Safe to delete** after confirming everything works.

---

## ✅ Verification

### Backend Test:
```bash
cd backend
python -c "from config import settings; print(f'Environment: {settings.ENVIRONMENT}')"
```

### Frontend Test:
```bash
cd frontend
npm run dev
# Check browser console for: "Environment detected: local" or "production"
```

---

## 🔧 Troubleshooting

### Issue: "Wrong environment detected"
**Solution:** Set explicit environment:
- Backend: `ENVIRONMENT=production` in `.env`
- Frontend: `NEXT_PUBLIC_ENVIRONMENT=production` in `.env.local`

### Issue: "CORS error in production"
**Solution:** Check `CORS_ORIGINS` in backend `.env`:
```bash
CORS_ORIGINS=https://mydailytradesignals.com
```

### Issue: "WebSocket connection failed"
**Solution:** Ensure production uses `wss://` (not `ws://`)

---

## 📝 Summary

✅ **One file per service** - No confusion  
✅ **Auto-detection** - Works everywhere  
✅ **Production-ready** - No manual changes needed  
✅ **Backed up** - Old files safely archived  

**Need help?** Check `archive/env_backups/` for original configurations.
