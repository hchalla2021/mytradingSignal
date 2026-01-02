# 🔐 Generate New Zerodha Access Token

## ✅ Your backend is NOW RUNNING on http://localhost:8000

---

## 🎯 SIMPLE 3-STEP FIX

### Step 1: Open Login URL in Browser
```
http://localhost:8000/api/auth/login
```
**Copy this URL and paste it in your browser** (Chrome, Firefox, Edge, etc.)

### Step 2: Login to Zerodha
You'll be redirected to Zerodha's secure login page:
- Enter your **Zerodha User ID**
- Enter your **Password**
- Enter your **PIN** (2FA)

### Step 3: Automatic Token Save
After successful login:
- Zerodha redirects back to your backend
- Backend **automatically extracts and saves** the new access token to `backend/.env`
- Backend **automatically reconnects** to Zerodha WebSocket
- **Live market data starts flowing immediately!**

---

## ✅ What You'll See

### In Browser:
```
✅ Authentication Successful!
Token saved successfully.
You can close this window and return to your application.
```

### In Backend Terminal:
```
🔐 ZERODHA CALLBACK RECEIVED
📡 Initializing KiteConnect...
🔄 Generating session with request token...
💾 Updating .env file with new access token...
✅ Access token saved to backend/.env
✅ Connected to Zerodha KiteTicker
📊 Subscribing to tokens: [256265, 260105, 265]
📊 Subscribed to: ['NIFTY', 'BANKNIFTY', 'SENSEX']
✅ Market feed is now LIVE - Waiting for ticks...
🟢 First tick received for NIFTY: Price=23765.45
```

---

## ❓ Troubleshooting

### "This site can't be reached"
**Problem:** Backend not running  
**Solution:** Run `uvicorn main:app --host 0.0.0.0 --port 8000` from backend folder

### "Redirect URL mismatch"
**Problem:** Wrong redirect URL in Zerodha app settings  
**Solution:** 
1. Go to https://developers.kite.trade/apps
2. Edit your app
3. Set Redirect URL to: `http://127.0.0.1:8000/api/auth/callback`
4. Save and try again

### "Token expired"
**Problem:** Took too long (>60 seconds)  
**Solution:** Start over - the login URL can be used multiple times

---

## 🔄 How Often Do I Need This?

**Daily!** Zerodha access tokens expire every 24 hours for security. You need to:
- Generate a new token **every morning** before market opens
- Or whenever you see "403 Forbidden" errors

**Pro Tip:** Add this to your morning routine:
1. Open backend
2. Visit http://localhost:8000/api/auth/login
3. Login to Zerodha
4. Done! Live data flows all day.

---

## 📱 Quick Links

| Action | URL |
|--------|-----|
| **Generate Token** | http://localhost:8000/api/auth/login |
| **Check Token Status** | http://localhost:8000/api/auth/validate |
| **Backend Health** | http://localhost:8000/health |
| **Zerodha Developer Portal** | https://developers.kite.trade/apps |

---

## 🚀 Ready?

**👉 CLICK HERE: http://localhost:8000/api/auth/login**

This will open Zerodha login and complete the entire process automatically!
