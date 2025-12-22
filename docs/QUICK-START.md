# 🚀 QUICK START GUIDE - MyTradingSignal

## ✅ SIMPLE 3-STEP STARTUP

### **1. START SERVERS**
Open PowerShell in project folder and run:
```powershell
.\START-SERVERS.ps1
```
**Wait 10-15 seconds** for both windows to open (Backend + Frontend)

---

### **2. LOGIN TO ZERODHA**
1. Browser will auto-open to: **http://localhost:3000**
2. Click **"Login to Zerodha"** button
3. Enter Zerodha credentials
4. **Wait 10-15 seconds** for authentication
5. You'll be redirected to dashboard automatically

**⚠️ IMPORTANT:** If you see "Connection timeout":
- Check backend window is open and shows: `INFO: Uvicorn running on http://0.0.0.0:8001`
- If not, close all windows and run `.\START-SERVERS.ps1` again

---

### **3. VERIFY LIVE DATA**
After login, you should see:
- ✅ NIFTY, BANKNIFTY, SENSEX prices updating
- ✅ Green "Authenticated" status
- ✅ Live option chain data

**During market hours (9:15 AM - 3:30 PM IST):** Real-time data  
**Outside market hours:** Last traded prices

---

## 🔧 TROUBLESHOOTING

### ❌ "Connection timeout. Backend not responding"

**Solution 1: Restart servers**
```powershell
# Kill all processes
Get-Process python,node -ErrorAction SilentlyContinue | Stop-Process -Force

# Wait 3 seconds
Start-Sleep -Seconds 3

# Restart
.\START-SERVERS.ps1
```

**Solution 2: Manual backend start**
```powershell
cd backend
..\. venv\Scripts\uvicorn.exe app:app --host 0.0.0.0 --port 8001 --reload
```
Keep this window open!

---

### ❌ "Token expired or invalid"

**Solution:** Just login again
1. Click "Login to Zerodha" button
2. Complete authentication
3. Token will auto-save to `config\.env`

Zerodha tokens expire every day, so you'll need to login once per day.

---

### ❌ Frontend not loading

**Check if port 3000 is free:**
```powershell
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
```

**If blocked, kill it:**
```powershell
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
```

**Then restart:**
```powershell
cd frontend
npm run dev
```

---

### ❌ Backend shows numpy errors

**Fix:**
```powershell
cd "D:\Trainings\GitHub projects\GitClonedProject\mytradingSignal"
.venv\Scripts\pip.exe install --force-reinstall numpy scipy
```

---

## 📋 QUICK COMMANDS

### Check if servers are running:
```powershell
# Backend health
Invoke-RestMethod http://localhost:8001/health

# Auth status
Invoke-RestMethod http://localhost:8001/api/auth/status
```

### Stop all servers:
```powershell
Get-Process python,node -ErrorAction SilentlyContinue | Stop-Process -Force
```

### Get login URL manually:
```powershell
(Invoke-RestMethod http://localhost:8001/api/auth/login-url).login_url
```

---

## 🎯 SUCCESS CHECKLIST

Before reporting issues, verify:

- [ ] **Backend running:** See `INFO: Uvicorn running` in backend window
- [ ] **Frontend running:** See `✓ Ready` in frontend window
- [ ] **Backend healthy:** `http://localhost:8001/health` returns `healthy`
- [ ] **Frontend loads:** `http://localhost:3000` opens in browser
- [ ] **No port conflicts:** Ports 8001 and 3000 are free

---

## 💡 PRO TIPS

1. **Keep PowerShell windows open** while using the app
2. **Bookmark** `http://localhost:3000` for quick access
3. **Use Chrome/Firefox** (not VS Code browser) for best experience
4. **Login expires daily** - just click "Login to Zerodha" again
5. **Market data is live** only during 9:15 AM - 3:30 PM IST

---

## 🆘 STILL HAVING ISSUES?

**Complete Reset:**
```powershell
# 1. Kill everything
Get-Process python,node -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. Wait
Start-Sleep -Seconds 5

# 3. Clear any stuck ports
Get-NetTCPConnection -LocalPort 8001,3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }

# 4. Fresh start
.\START-SERVERS.ps1
```

**Check logs:**
- Backend window: Look for RED errors
- Frontend window: Look for compilation errors
- Browser console: Press F12, check for network errors

**Common errors:**
- `EADDRINUSE`: Port already in use (kill processes above)
- `numpy` errors: Reinstall numpy (see above)
- `timeout`: Backend not responding (check backend window)
- `404`: Wrong API URL (should be localhost:8001)

---

**Last Updated:** December 22, 2025
