# 🚀 PERMANENT FIX GUIDE - MyTradingSignal

## ✅ HOW TO START THE APPLICATION (EVERY TIME)

### **Simple 3-Step Process:**

1. **Open PowerShell in the project root:**
   ```powershell
   cd "D:\Trainings\GitHub projects\GitClonedProject\mytradingSignal"
   ```

2. **Run the startup script:**
   ```powershell
   .\START-SERVERS.ps1
   ```

3. **Wait for both servers to start** (takes 10-15 seconds)
   - Backend window will open first
   - Frontend window will open second
   - Browser will open automatically to http://localhost:3000

---

## 🔐 ZERODHA LOGIN FIX

### **Problem:** "Connection timeout. Backend not responding"

### **Solution:**

1. **Ensure both servers are running** (you should see 2 PowerShell windows)

2. **Check backend is healthy:**
   ```powershell
   Invoke-RestMethod http://localhost:8001/health
   ```
   Should return: `status: healthy`

3. **Get fresh login URL:**
   ```powershell
   (Invoke-RestMethod http://localhost:8001/api/auth/login-url).login_url
   ```

4. **Open the login URL in your browser** - NOT in VS Code

5. **After Zerodha login:**
   - You'll be redirected to: `http://localhost:3000/auth/callback?request_token=...`
   - The app will automatically save your token
   - You'll be redirected to the main dashboard
   - Live data will start flowing!

---

## 🔧 TROUBLESHOOTING

### **Backend won't start:**
```powershell
# Fix numpy issues
cd "D:\Trainings\GitHub projects\GitClonedProject\mytradingSignal"
.venv\Scripts\pip.exe install --force-reinstall numpy scipy
```

### **Frontend won't start:**
```powershell
# Clear node modules and reinstall
cd frontend
Remove-Item node_modules -Recurse -Force
npm install
```

### **Port already in use:**
```powershell
# Kill processes on ports 8001 and 3000
Get-Process python,node -ErrorAction SilentlyContinue | Stop-Process -Force
```

### **Token expired:**
```powershell
# Delete old token and login again
Invoke-RestMethod -Uri "http://localhost:8001/api/auth/status"
# If shows "token_invalid", just click "Login to Zerodha" button again
```

---

## 📋 VERIFICATION CHECKLIST

Before using the app, verify:

- [ ] **Backend running:** http://localhost:8001/health returns `healthy`
- [ ] **Frontend running:** http://localhost:3000 loads in browser
- [ ] **Zerodha authenticated:** Click "Login to Zerodha" and complete login
- [ ] **Live data flowing:** NIFTY/BANKNIFTY prices update in real-time

---

## ⚡ QUICK COMMANDS

### Start Everything:
```powershell
.\START-SERVERS.ps1
```

### Stop Everything:
```powershell
Get-Process python,node -ErrorAction SilentlyContinue | Stop-Process -Force
```

### Check Status:
```powershell
# Backend health
Invoke-RestMethod http://localhost:8001/health

# Auth status
Invoke-RestMethod http://localhost:8001/api/auth/status

# Get NIFTY data
Invoke-RestMethod http://localhost:8001/api/signals/NIFTY
```

---

## 🎯 KEY POINTS

1. **Always use START-SERVERS.ps1** - It handles everything automatically
2. **Keep both PowerShell windows open** while using the app
3. **Zerodha tokens expire daily** - You'll need to login again each day
4. **Market hours:** 9:15 AM - 3:30 PM IST (Mon-Fri)
5. **Outside market hours:** You'll see last traded prices

---

## 📱 MOBILE ACCESS (SAME WIFI)

Find your PC's IP address:
```powershell
(Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -like "192.168.*"}).IPAddress
```

Then on your phone, open: `http://YOUR_IP:3000`
Example: `http://192.168.1.100:3000`

---

## 🆘 NEED HELP?

If nothing works:

1. **Complete reset:**
   ```powershell
   # Kill all processes
   Get-Process python,node -ErrorAction SilentlyContinue | Stop-Process -Force
   
   # Wait 5 seconds
   Start-Sleep -Seconds 5
   
   # Start fresh
   .\START-SERVERS.ps1
   ```

2. **Check logs:**
   - Backend window shows Python/FastAPI logs
   - Frontend window shows Next.js logs
   - Look for RED error messages

3. **Verify .env file:**
   ```powershell
   Get-Content config\.env
   ```
   Should contain your Zerodha API key and secret

---

## ✅ SUCCESS INDICATORS

You know it's working when:
- ✅ Backend window shows: `INFO: Uvicorn running on http://0.0.0.0:8001`
- ✅ Frontend window shows: `✓ Ready in X.Xs`
- ✅ Browser opens automatically to http://localhost:3000
- ✅ Dashboard shows "Login to Zerodha" button (or live data if logged in)

---

**Last Updated:** December 22, 2025
