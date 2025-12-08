# 🚀 Trading Signals App - Complete Setup Guide

## ✅ SYSTEM STATUS

### Backend Status
- **Running**: ✅ Successfully on port 8001
- **Health**: ✅ All endpoints responding (200 OK)
- **Data**: ✅ Live market data fetching from Zerodha
- **CORS**: ✅ Configured for all origins
- **Network**: ✅ Accessible on `0.0.0.0` (desktop + mobile)

### Frontend Status
- **Running**: ✅ On port 3000
- **Environment**: ✅ Configured to use `http://localhost:8001`
- **API Connection**: ✅ Successfully connecting to backend

---

## 📋 QUICK START

### Option 1: Use Startup Scripts (RECOMMENDED)

```powershell
# Start everything at once
.\start-all.ps1

# OR start individually:
.\start-backend.ps1   # Terminal 1
.\start-frontend.ps1  # Terminal 2
```

### Option 2: Manual Start

**Terminal 1 - Backend:**
```powershell
cd backend
python -m uvicorn app:app --host 0.0.0.0 --port 8001 --reload
```

**Terminal 2 - Frontend:**
```powershell
cd frontend
npm run dev
```

---

## 🌐 ACCESS URLS

### Desktop Access
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8001
- **API Docs**: http://localhost:8001/docs
- **Health Check**: http://localhost:8001/health

### Mobile Access (Same WiFi)
- **Frontend**: http://192.168.1.13:3000
- **Backend**: http://192.168.1.13:8001

> Replace `192.168.1.13` with your actual local IP address

---

## 🔧 CONFIGURATION FILES

### Backend Environment
- Location: `backend/config/settings.py`
- Port: 8001
- Host: 0.0.0.0 (allows mobile access)
- CORS: Enabled for all origins

### Frontend Environment
- File: `frontend/.env.local`
- Current: `NEXT_PUBLIC_API_URL=http://localhost:8001`

For mobile testing, update to:
```env
NEXT_PUBLIC_API_URL=http://192.168.1.13:8001
```

---

## ✨ KEY FEATURES WORKING

1. **Live Market Data**
   - NIFTY, BANKNIFTY, SENSEX real-time updates
   - PCR calculations
   - Market direction analysis
   - OI (Open Interest) tracking

2. **Trading Signals**
   - 90%+ confidence buyer signals
   - Greeks calculations (Delta, Gamma, Theta, Vega)
   - Strike price analysis
   - Real-time refresh every 1 second

3. **Market Analysis**
   - Weighted market bias (5 parameters)
   - Probability calculations
   - Component scores breakdown
   - Direction percentage indicators

---

## 🛠️ TROUBLESHOOTING

### Backend Not Accessible

**Check if running:**
```powershell
netstat -ano | Select-String ":8001"
```

**Test connectivity:**
```powershell
Invoke-WebRequest -Uri "http://localhost:8001/health" -UseBasicParsing
```

**Kill process on port 8001:**
```powershell
$proc = Get-NetTCPConnection -LocalPort 8001 -ErrorAction SilentlyContinue
if ($proc) {
    Stop-Process -Id $proc.OwningProcess -Force
}
```

### Frontend Can't Reach Backend

1. **Check `.env.local` file exists**:
   ```powershell
   Get-Content frontend/.env.local
   ```

2. **Verify URL is correct**:
   - Desktop: `http://localhost:8001`
   - Mobile: `http://192.168.1.13:8001`

3. **Restart frontend** after changing `.env.local`:
   ```powershell
   # Ctrl+C in frontend terminal, then:
   cd frontend
   npm run dev
   ```

### Port Already In Use

**Backend (8001):**
```powershell
$proc = Get-NetTCPConnection -LocalPort 8001 -ErrorAction SilentlyContinue
Stop-Process -Id $proc.OwningProcess -Force
```

**Frontend (3000):**
```powershell
$proc = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
Stop-Process -Id $proc.OwningProcess -Force
```

---

## 📱 MOBILE SETUP

### 1. Find Your PC's Local IP
```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like "192.168.*" } | Select-Object IPAddress
```

### 2. Update Frontend Environment
Edit `frontend/.env.local`:
```env
NEXT_PUBLIC_API_URL=http://YOUR_IP:8001
```

### 3. Ensure Firewall Allows
- Windows Firewall → Allow port 8001 and 3000
- OR disable firewall temporarily for private networks

### 4. Access from Mobile
- Frontend: `http://YOUR_IP:3000`
- Make sure mobile and PC are on same WiFi

---

## 🔐 SECURITY NOTES

### Development Mode (Current)
- ✅ CORS allows all origins
- ✅ Backend binds to 0.0.0.0
- ⚠️ No authentication required (for dev only)

### Production Considerations
1. **CORS**: Restrict to specific domains
2. **HTTPS**: Use SSL certificates
3. **Authentication**: Implement Zerodha OAuth
4. **Rate Limiting**: Prevent API abuse
5. **Environment Variables**: Use secure .env files

---

## 📊 API ENDPOINTS

### Market Status
```
GET /api/market/status
```
Returns: Market open/closed, current time, trading hours

### Live Signals
```
GET /api/signals/{symbol}
```
Params: `NIFTY`, `BANKNIFTY`, `SENSEX`

### Option Chain
```
GET /api/instruments/{symbol}
```
Full option chain with Greeks and analysis

### Health Check
```
GET /health
GET /api/health
```

---

## 💡 PRO TIPS

1. **Auto-refresh is ON by default** (1-second updates)
2. **Market closed**: App shows last traded prices
3. **Signals**: Only 90%+ confidence signals displayed
4. **Mobile**: Works perfectly on iPhone/Android (same WiFi)
5. **Live data**: Fetched from Zerodha Kite API

---

## 🐛 COMMON ISSUES & FIXES

| Issue | Solution |
|-------|----------|
| "Cannot reach backend" | Restart backend, check port 8001 |
| Empty signals | Normal - signals rare (90%+ threshold) |
| Mobile not connecting | Verify IP address in `.env.local` |
| CORS error | Already fixed - backend allows all origins |
| Port in use | Kill process: `Stop-Process -Id $pid -Force` |

---

## 📞 SUPPORT COMMANDS

```powershell
# Check Python version
python --version

# Check Node version
node --version

# Check backend dependencies
cd backend
pip list | Select-String "fastapi|uvicorn|scipy"

# Check frontend dependencies
cd frontend
npm list --depth=0

# View backend logs
# (Check terminal where backend is running)

# View frontend logs
# (Check terminal where frontend is running)
```

---

## 🎯 NEXT STEPS

1. **Test on Desktop**: http://localhost:3000
2. **Test on Mobile**: http://192.168.1.13:3000
3. **Zerodha Login**: Click "Login to Zerodha" button
4. **Watch Live Signals**: Auto-refreshes every second
5. **Test SMS Alerts**: Click "Test Alert" button

---

## ✅ VERIFIED WORKING

- [x] Backend running on port 8001
- [x] Frontend running on port 3000
- [x] API connectivity established
- [x] Live market data fetching
- [x] CORS configured correctly
- [x] Mobile access ready (same WiFi)
- [x] Real-time updates (1-second refresh)
- [x] Market status detection
- [x] Signal generation (90%+ threshold)
- [x] Greeks calculations
- [x] PCR analysis
- [x] OI tracking
- [x] Probability calculations

---

**Last Updated**: December 8, 2025  
**Status**: ✅ FULLY OPERATIONAL

For questions or issues, check the troubleshooting section above.
