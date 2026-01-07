# 🔴 PCR NOT SHOWING - TOKEN EXPIRED FIX

**Issue Date:** January 7, 2026  
**Status:** ❌ Zerodha access token expired  
**Impact:** PCR values showing 0.00 or N/A in UI

---

## Root Cause

Your Zerodha access token has **EXPIRED**. The error in backend:
```
Incorrect `api_key` or `access_token`
```

Zerodha tokens expire **every 24 hours** and need daily refresh.

---

## ⚡ QUICK FIX (5 Minutes)

### Step 1: Generate New Token

```powershell
cd backend
python get_token.py
```

### Step 2: Follow Instructions

1. **Browser opens automatically** → Login to Zerodha
2. **After login**, you'll be redirected to:
   ```
   http://127.0.0.1:8000/api/auth/callback?request_token=ABC123XYZ&action=login
   ```
3. **Copy** the `request_token` value (e.g., `ABC123XYZ`)
4. **Paste** it in the terminal when prompted

### Step 3: Update .env File

The script will show you the new token. Update your [backend/.env](backend/.env):

```env
ZERODHA_ACCESS_TOKEN=your_new_token_here
```

### Step 4: Restart Backend

```powershell
# Stop current backend (Ctrl+C)
# Then restart:
cd backend
python -m uvicorn main:app --host 127.0.0.1 --port 8001 --reload
```

### Step 5: Verify PCR Working

Check backend logs for:
```
[OK] PCR Fetched for NIFTY: 0.64
[OK] PCR Fetched for BANKNIFTY: 0.62
[OK] PCR Fetched for SENSEX: 0.46
```

---

## 🔍 How to Verify PCR is Working

### Method 1: Backend Logs
Look for these messages every 30 seconds:
```
[PCR UPDATE] NIFTY: PCR=0.64, CallOI=251,497,575, PutOI=160,074,575
[PCR UPDATE] BANKNIFTY: PCR=0.62, CallOI=23,529,275, PutOI=14,695,550
[PCR UPDATE] SENSEX: PCR=0.46, CallOI=13,427,200, PutOI=6,180,760
```

### Method 2: UI Check
1. Open http://localhost:3000
2. Check Index Cards - PCR should show values like **0.64**, **0.62**
3. Click any card → Analysis section → "OPTIONS DATA (PCR & OI)"
4. Values should update every 30 seconds

### Method 3: Frontend Console (F12)
Look for these logs:
```
[NIFTY] PCR Update: 0.64 | Call: 251,497,575 | Put: 160,074,575
[BANKNIFTY] PCR Update: 0.62 | Call: 23,529,275 | Put: 14,695,550
```

---

## 🤖 PERMANENT SOLUTION - Auto Token Refresh

To avoid manual token refresh every day, you can set up auto-refresh:

### Option 1: Use Quick Fix Script (Recommended)

```powershell
python quick_token_fix.py
```

This will:
- Fetch TOTP from browser
- Auto-generate token
- Update .env file
- No manual login needed!

### Option 2: Scheduled Task (Windows)

Create a daily task to run at 8:00 AM:

```powershell
# Create scheduled task
$action = New-ScheduledTaskAction -Execute "python" -Argument "quick_token_fix.py" -WorkingDirectory "D:\Trainings\GitHub projects\GitClonedProject\mytradingSignal\backend"
$trigger = New-ScheduledTaskTrigger -Daily -At 8:00AM
Register-ScheduledTask -Action $action -Trigger $trigger -TaskName "ZerodhaTokenRefresh" -Description "Daily Zerodha token refresh"
```

---

## 📊 Understanding PCR Values

When working correctly, you'll see:

| Symbol | Normal Range | Current Expected |
|--------|--------------|------------------|
| **NIFTY** | 0.60-0.70 | ~0.64 (Mild Bearish 🔴) |
| **BANKNIFTY** | 0.58-0.65 | ~0.62 (Mild Bearish 🔴) |
| **SENSEX** | 0.40-0.50 | ~0.46 (Bearish 🔴) |

**PCR Interpretation:**
- **> 1.2** = Bullish (more puts = bullish sentiment)
- **0.8-1.2** = Neutral
- **< 0.8** = Bearish (more calls = bearish sentiment)

---

## ❌ Common Errors & Solutions

### Error: "Too many requests"
**Cause:** API rate limited  
**Solution:** Wait 2-3 minutes, system auto-recovers

### Error: "No cached PCR"
**Cause:** First fetch failed  
**Solution:** Check token, restart backend

### Error: "PCR is 0 for SENSEX"
**Cause:** BFO exchange rate limited  
**Solution:** Normal, will retry in 30s

### Error: "Failed to fetch instruments"
**Cause:** Token expired or rate limited  
**Solution:** Refresh token or wait

---

## 📁 Key Files

- **Token Generator:** [backend/get_token.py](backend/get_token.py)
- **PCR Service:** [backend/services/pcr_service.py](backend/services/pcr_service.py)
- **Market Feed:** [backend/services/market_feed.py](backend/services/market_feed.py)
- **Frontend Hook:** [frontend/hooks/useMarketSocket.ts](frontend/hooks/useMarketSocket.ts)
- **UI Component:** [frontend/components/AnalysisCard.tsx](frontend/components/AnalysisCard.tsx)

---

## 🎯 Summary

1. ✅ **PCR code is working perfectly**
2. ❌ **Token expired** - needs refresh
3. 🔧 **Fix:** Run `python get_token.py`
4. ⏱️ **Time:** 5 minutes
5. 🔄 **Frequency:** Daily (or set up auto-refresh)

---

## Need Help?

If PCR still doesn't show after token refresh:

1. Check backend logs for errors
2. Verify token in .env is correct
3. Ensure backend is running on port 8001
4. Check frontend WebSocket connection (F12 → Network → WS)
5. Try clearing browser cache and reload

**Token valid for:** 24 hours from generation  
**Next refresh needed:** Tomorrow, same time  
**Auto-refresh available:** Yes (use quick_token_fix.py)
