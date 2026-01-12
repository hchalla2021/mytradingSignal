# 🚀 Quick Start - Development Environment

## One-Click Startup

### Windows (PowerShell)
```powershell
.\start.ps1
```

This will:
1. ✅ Activate Python virtual environment
2. ✅ Start Backend server (port 8000)
3. ✅ Start Frontend server (port 3000)
4. ✅ Auto-detect environment (local)

---

## Manual Startup

### Backend
```powershell
cd backend
..\venv\Scripts\Activate.ps1  # Activate venv
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend
```powershell
cd frontend
npm run dev -- -p 3000
```

---

## Access URLs

- **Frontend:** http://localhost:3000
- **Backend API Docs:** http://127.0.0.1:8000/docs
- **Backend Health:** http://127.0.0.1:8000/health

---

## Environment Configuration

✅ **Auto-Detection Enabled**

- **Backend:** `backend/.env` (single file)
- **Frontend:** `frontend/.env.local` (single file)

No manual configuration needed! Environment is auto-detected based on hostname.

---

## Troubleshooting

### Port Already in Use

**Backend (8000):**
```powershell
# Find and kill process
netstat -ano | findstr :8000
taskkill /PID <PID> /F
```

**Frontend (3000):**
```powershell
# Find and kill process
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### Module Not Found

**Backend:**
```powershell
cd backend
pip install -r requirements.txt
```

**Frontend:**
```powershell
cd frontend
npm install
```

### Environment Variables Not Loaded

**Verify files exist:**
```powershell
Test-Path backend\.env         # Should be True
Test-Path frontend\.env.local  # Should be True
```

---

## Production Deployment

See `ENV_CONSOLIDATION_COMPLETE.md` for detailed production deployment instructions.

**Quick Deploy:**
1. Copy `.env` files to server (no changes needed!)
2. Update `ZERODHA_ACCESS_TOKEN` if needed
3. Set `ENABLE_SCHEDULER=true` in backend `.env`
4. Restart services

---

## Documentation

- `ENV_SETUP.md` - Detailed environment setup guide
- `QUICK_START_ENV.md` - Quick reference
- `ENV_CONSOLIDATION_COMPLETE.md` - What was changed and why

---

## Status

✅ **Production Ready**  
✅ **Environment Consolidated**  
✅ **Auto-Detection Enabled**  
✅ **All Tests Passing**  

**Last Updated:** January 12, 2026
