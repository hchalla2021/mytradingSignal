# Quick Start Guide - MyDailyTradingSignals

## One-Command Startup 🚀

```powershell
./auto_start_system.ps1
```

That's it! The script will:
- ✅ Start backend with auto-restart
- ✅ Start frontend with hot-reload
- ✅ Install missing dependencies
- ✅ Validate configuration
- ✅ Open browser automatically
- ✅ Show health status

---

## First Time Setup

### 1. Configure Zerodha Credentials

Edit `backend/.env`:
```bash
ZERODHA_API_KEY=your_api_key_here
ZERODHA_API_SECRET=your_api_secret_here
```

### 2. Get Access Token

**Option A - Quick Fix (Recommended):**
```powershell
python quick_token_fix.py
```

**Option B - Manual:**
```powershell
python backend/get_token.py
```

### 3. Start System

```powershell
./auto_start_system.ps1
```

---

## Daily Usage

### Morning Routine (Before 9:00 AM)

1. **Check Token Status**
   - Open UI: http://localhost:3000
   - If LOGIN button shows → Click it
   - If user badge shows → You're good! ✅

2. **Start System**
   ```powershell
   ./auto_start_system.ps1
   ```

3. **Wait for Market Open**
   - 9:00 AM - Pre-open starts (yellow badge)
   - 9:15 AM - Live trading begins (green badge)

### During Market Hours (9:15 AM - 3:30 PM)

- Data updates automatically every 0.5 seconds
- Technical analysis updates in real-time
- No manual intervention needed

### Token Expires? (Usually 5-7:30 AM next day)

**You'll see:**
- LOGIN button appears in header
- "Token expired" message

**Solution:**
1. Click LOGIN button
2. Enter Zerodha credentials + 2FA
3. Done! System reconnects automatically (no restart needed)

---

## Common Commands

### Start Backend Only
```powershell
./auto_start_backend.ps1
```

### Start Frontend Only
```powershell
cd frontend
npm run dev
```

### Check Token Status
```powershell
python -c "from services.unified_auth_service import unified_auth; import asyncio; asyncio.run(unified_auth.validate_token(force=True)); print(unified_auth.get_status_info())"
```

### View Backend Logs
Already visible in the terminal where backend runs

---

## Troubleshooting

### ❌ "Login button keeps appearing"
```typescript
// Open browser console (F12)
localStorage.clear()
location.reload()
```

### ❌ "Data not updating"
1. Check backend terminal for errors
2. Verify token: Click LOGIN button
3. Restart backend: Close terminal, run `./auto_start_backend.ps1`

### ❌ "Token expired" error
```powershell
python quick_token_fix.py
```

### ❌ Backend won't start
```powershell
# Reinstall dependencies
cd backend
pip install -r requirements.txt

# Check Python version (needs 3.10+)
python --version
```

---

## URLs

- **Frontend:** http://localhost:3000
- **Backend:** http://127.0.0.1:8000
- **API Docs:** http://127.0.0.1:8000/docs
- **Health Check:** http://127.0.0.1:8000/health

---

## Market Timing (IST)

- **9:00 AM** - Pre-open session (order matching)
- **9:15 AM** - Live trading begins ← Data transitions smoothly ✅
- **3:30 PM** - Market closes
- **After 3:30 PM** - Shows last traded prices

---

## What's Fixed? ✅

1. ✅ **Data Freezing at 9:15 AM** - Now transitions smoothly
2. ✅ **Manual Backend Start** - Auto-start script included
3. ✅ **Token Expiry Issues** - Validated every 30 seconds
4. ✅ **Login Button Flickering** - State management fixed
5. ✅ **Centralized Auth** - Single source of truth
6. ✅ **Auto-Reconnection** - No restart needed after token refresh

---

## Support

Issues? Check:
1. [FIXES_APPLIED.md](./FIXES_APPLIED.md) - Detailed technical documentation
2. Backend terminal logs - Real-time status messages
3. Browser console (F12) - Frontend errors

---

**Happy Trading! 📈🚀**
