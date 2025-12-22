# Zerodha Authentication Guide

## 🔑 Important: Access Token Expiry

**Zerodha access tokens are valid for ONLY 1 DAY!**

You must re-authenticate **daily** to fetch live market data.

## ✅ How to Authenticate

### Step 1: Start Your Application
```bash
# Start backend (Terminal 1)
cd backend
python app.py

# Start frontend (Terminal 2)  
cd frontend
npm run dev
```

### Step 2: Login Through App
1. Open [http://localhost:3000](http://localhost:3000)
2. Click **"Login to Zerodha"** button
3. Enter your Zerodha credentials (user ID, password, PIN)
4. Authorize the app when prompted
5. You'll be redirected back - **live data will start flowing!**

### Step 3: Verify Connection
- ✅ Green "LIVE" indicator at top (market hours only)
- ✅ Spot prices updating every second
- ✅ Option chain showing real LTP values
- ✅ No "Token Expired" error message

## 🔴 Troubleshooting

### Issue: "Token Expired" Error
**Cause**: Access token is older than 24 hours

**Solution**:
1. Click "Login to Zerodha" button again
2. Complete authentication flow
3. Token will be refreshed automatically

### Issue: Same Data Every Time / Not Live
**Cause**: Token expired OR market is closed

**Check**:
```bash
# Run diagnostic test
cd backend
python test_zerodha_connection.py
```

**If test fails with "Incorrect api_key or access_token"**:
- Token has expired
- Login again through the app

**If market status shows "OFFLINE"**:
- Market is closed (9:15 AM - 3:30 PM IST, Mon-Fri)
- App will show last traded prices
- This is normal behavior

### Issue: Can't See Login Button
**Solution**:
1. Open browser console (F12)
2. Clear localStorage: `localStorage.clear()`
3. Hard refresh: Ctrl + Shift + R
4. Try login again

## 📊 Market Hours

**NSE Trading Hours**: 9:15 AM - 3:30 PM IST (Mon-Fri)

During market hours:
- ✅ Live data every 1 second
- ✅ Real-time spot prices
- ✅ Live option chain
- ✅ Fresh signals

Outside market hours:
- 📴 Market status shows "OFFLINE"
- 📊 Last traded prices displayed
- ⚠️ Signals not generated (requires live data)

## 🔄 Daily Workflow

1. **Morning (before 9:15 AM)**:
   - Login to app (fresh token)
   - Verify connection before market opens
   
2. **During market (9:15 AM - 3:30 PM)**:
   - Live data flows automatically
   - No action needed
   
3. **Next day**:
   - Login again (token expired overnight)
   - Repeat step 1

## 🛡️ Security Notes

- Never share your access token
- Never commit `.env` file to git
- Tokens auto-expire after 24 hours for security
- Each login generates a new token

## ⚡ Quick Commands

```bash
# Test connection
python backend/test_zerodha_connection.py

# Check if backend running
curl http://localhost:8001/api/auth/status

# Restart backend (if needed)
# Ctrl+C to stop, then:
python backend/app.py

# Restart frontend (if needed)
# Ctrl+C to stop, then:
cd frontend && npm run dev
```

## 💡 Pro Tips

1. **Bookmark the app** for quick daily access
2. **Login in the morning** before market opens (avoid rush)
3. **Keep backend running** all day (don't restart)
4. **Check token status** if data stops updating

## 📞 Support

If authentication still fails after trying above:
1. Check `.env` file has correct credentials
2. Verify Zerodha account is active
3. Check if API key is enabled in Zerodha console
4. Try generating new API credentials

---

**Remember**: One login per day = Full day of live data! 🚀
