# 🚀 How to Launch Your Trading Signals App

## Quick Start (2 Steps)

### Step 1: Start Backend
Double-click `run-backend.bat` OR open terminal and run:
```
cd backend
..\.venv\Scripts\python.exe app.py
```
Wait for: `Uvicorn running on http://0.0.0.0:8001`

### Step 2: Start Frontend  
Double-click `run-frontend.bat` OR open terminal and run:
```
cd frontend
npm run dev
```
Wait for: `Local: http://localhost:3000`

### Step 3: Open Browser
Go to: **http://localhost:3000**

---

## 📌 Zerodha Authentication Fix

### Why Authentication Fails:
- Zerodha access tokens expire **DAILY**
- You must re-login every day to get live data
- Market must be **OPEN** (Mon-Fri, 9:15 AM - 3:30 PM IST) for live data

### How to Fix:
1. Open http://localhost:3000 in your browser
2. Click **"Login to Zerodha"** button
3. Complete Zerodha login
4. You'll be redirected back automatically
5. Token will be saved to `.env` file
6. Live data will start flowing

### If Login Still Fails:
Check backend terminal for errors. The most common issue is:
- **Path error**: Fixed! Backend now saves token to correct `.env` location
- **Encoding error**: Fixed! Using UTF-8 encoding
- **Port busy**: Use `start-all.ps1` script instead

---

## 🔍 Troubleshooting

### Backend won't start / Port 8001 busy
```powershell
Get-Process -Name python | Stop-Process -Force
```
Then restart backend.

### Frontend won't start / Port 3000 busy
```powershell
Get-Process -Name node | Stop-Process -Force
```
Then restart frontend.

### Market Closed - No Live Data
**This is normal!** Market is closed on:
- Weekends (Saturday/Sunday)
- Before 9:15 AM and after 3:30 PM IST
- Public holidays

The app shows demo/mock data when market is closed.

### Token Still Invalid After Login
1. Check backend terminal for error messages during login
2. Make sure you completed the full Zerodha login flow
3. Check that `.env` file was updated with new `ZERODHA_ACCESS_TOKEN`
4. Restart backend after successful login

---

## 📝 Manual Commands

### Stop All Servers
```powershell
Get-Process -Name python,node | Stop-Process -Force
```

### Check Server Status
```powershell
# Backend
Invoke-RestMethod http://localhost:8001/health

# Frontend
Invoke-WebRequest http://localhost:3000 -UseBasicParsing
```

### Check Authentication Status
```powershell
Invoke-RestMethod http://localhost:8001/api/auth/status
```

### Get Live Data Test
```powershell
Invoke-RestMethod http://localhost:8001/api/signals/NIFTY
```

---

## ✅ What I Fixed

1. **Auth Token Path**: Backend now saves token to correct `.env` location
2. **Encoding**: Using UTF-8 to avoid charmap errors on Windows
3. **Batch Files**: Created `run-backend.bat` and `run-frontend.bat` for easy startup
4. **Market Closed Handling**: App shows demo data when market is closed

---

## 🎯 Next Steps

1. **Run both servers** using the batch files or manual commands above
2. **Open http://localhost:3000** in your browser
3. **Click "Login to Zerodha"** to authenticate
4. **Wait for market hours** (Mon-Fri 9:15 AM - 3:30 PM IST) to see live data

---

## 🔄 Daily Workflow

**Every day before market opens:**
1. Start backend (`run-backend.bat`)
2. Start frontend (`run-frontend.bat`)
3. Login to Zerodha (token expires daily)
4. Monitor live signals during market hours

**After market closes:**
- Servers can keep running (shows last traded prices)
- Or stop them using: `Get-Process -Name python,node | Stop-Process -Force`
