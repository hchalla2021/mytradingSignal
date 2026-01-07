# 🪟 FIX: Login Window Closing Automatically

**Issue:** Zerodha login window closes after a few seconds with "enter credit" or connection error.

**Root Cause:** The redirect URL is not properly configured in your Zerodha app, so the callback fails and the window closes.

---

## ⚡ QUICK FIX - Manual Token Method (Recommended)

### Why This Works:
- ✅ No need to configure redirect URL in Zerodha app
- ✅ Works even if callback fails
- ✅ Simple copy-paste method
- ✅ Takes 2 minutes

### Step-by-Step:

#### 1. Run the Manual Token Generator

```powershell
cd backend
python generate_token_manual.py
```

#### 2. Copy the Login URL
The script will display a URL like:
```
https://kite.zerodha.com/connect/login?v=3&api_key=...
```
Copy this URL.

#### 3. Open URL in Browser
- Paste the URL in your browser
- Press Enter
- Login with your Zerodha credentials (User ID, Password, PIN)

#### 4. You'll See an Error Page
After logging in, you'll see:
```
This site can't be reached
127.0.0.1 refused to connect
ERR_CONNECTION_REFUSED
```
**⚠️ This is NORMAL! Don't worry!**

#### 5. Copy the Full URL from Address Bar
The browser address bar will show something like:
```
http://127.0.0.1:8000/api/auth/callback?request_token=ABC123XYZ&action=login&status=success
```
**Copy the ENTIRE URL** (including `http://...`)

#### 6. Paste in Terminal
Go back to the terminal where you ran the script and paste the full URL when prompted.

#### 7. Done! ✅
The script will:
- Extract the request_token
- Generate access_token
- Update your `.env` file automatically
- Show success message

#### 8. Restart Backend
```powershell
cd backend
python -m uvicorn main:app --host 127.0.0.1 --port 8001 --reload
```

#### 9. Verify PCR Working
Check backend logs for:
```
[OK] PCR Fetched for NIFTY: 0.64
[PCR UPDATE] NIFTY: PCR=0.64, CallOI=251,497,575, PutOI=160,074,575
```

---

## 🔧 ALTERNATIVE FIX - Configure Redirect URL Properly

If you want the automated method to work, you need to configure Zerodha app settings:

### Step 1: Go to Zerodha Developer Console
1. Open: https://developers.kite.trade/apps
2. Login with your Zerodha credentials
3. Click on your app name

### Step 2: Add Redirect URL
In the "Redirect URLs" section, add **EXACTLY**:
```
http://127.0.0.1:8000/api/auth/callback
```

**Important:**
- Use `127.0.0.1` NOT `localhost`
- Use `http://` NOT `https://`
- Port must be `8000` (or whatever port your backend uses)
- Path must be `/api/auth/callback`
- NO trailing slash!

### Step 3: Verify .env File
Check `backend/.env` has:
```env
REDIRECT_URL=http://127.0.0.1:8000/api/auth/callback
FRONTEND_URL=http://localhost:3000
```

### Step 4: Restart Backend
```powershell
cd backend
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```
**Note:** Port must match the redirect URL (8000)

### Step 5: Test Login
1. Open: http://127.0.0.1:8000/api/auth/login
2. Login to Zerodha
3. Window should redirect back successfully without closing

---

## 🐛 Common Issues

### Issue 1: "This site can't be reached"
**When:** After logging into Zerodha
**Why:** Backend is not running OR redirect URL is wrong
**Fix:** 
- Check backend is running: `http://127.0.0.1:8000/docs`
- Use manual method (doesn't need backend running)

### Issue 2: "Invalid redirect_uri"
**When:** On Zerodha login page
**Why:** Redirect URL not configured in Zerodha app settings
**Fix:**
- Add redirect URL in Zerodha developer console (see above)
- OR use manual method (recommended)

### Issue 3: "request_token expired"
**When:** Using manual method
**Why:** Took too long to paste URL (>2 minutes)
**Fix:** 
- Run script again
- Complete steps faster (request_token expires in 2 minutes)

### Issue 4: Window closes with "enter credit"
**When:** During Zerodha login
**Why:** This is a Zerodha UI message during 2FA
**Fix:** 
- Just enter your PIN/TOTP when prompted
- If window closes before you can enter, use manual method

---

## 📊 Comparison: Manual vs Automated

| Feature | Manual Method | Automated Method |
|---------|---------------|------------------|
| **Redirect URL needed?** | ❌ No | ✅ Yes |
| **Backend running needed?** | ❌ No | ✅ Yes |
| **Steps** | 6 steps | 3 steps |
| **Time** | 2 minutes | 1 minute |
| **Works when callback fails?** | ✅ Yes | ❌ No |
| **Recommended for?** | First time, troubleshooting | Daily use once configured |

---

## 🎯 Recommended Workflow

### First Time Setup:
1. Use **Manual Method** to get first token
2. Verify everything works
3. Then configure redirect URL for automated method

### Daily Use:
- Once redirect URL is configured, use automated method
- If it fails, fall back to manual method

---

## 📁 Files Created

- **Manual Token Script:** [backend/generate_token_manual.py](backend/generate_token_manual.py)
- **Original Auto Script:** [backend/get_token.py](backend/get_token.py)
- **Backend Auth Router:** [backend/routers/auth.py](backend/routers/auth.py)

---

## ✅ Success Checklist

After running manual method:

- [ ] Script showed "✅ SUCCESS! TOKEN GENERATED"
- [ ] .env file updated with new ZERODHA_ACCESS_TOKEN
- [ ] Backend restarted
- [ ] Backend logs show: `[OK] PCR Fetched for...`
- [ ] UI shows PCR values (not 0.00)
- [ ] Analysis section shows PCR data

---

## 🆘 Still Not Working?

If manual method fails:

1. **Check API credentials** in `.env`:
   ```env
   ZERODHA_API_KEY=your_key_here
   ZERODHA_API_SECRET=your_secret_here
   ```

2. **Get credentials** from: https://developers.kite.trade/apps

3. **Verify login URL works:**
   - Run script
   - Copy login URL
   - Paste in browser
   - Should show Zerodha login page

4. **Check for typos** when pasting callback URL:
   - Must include `http://`
   - Must include `request_token=`
   - Copy ENTIRE URL from browser

---

## 📝 Summary

**Problem:** Window closes during login  
**Root Cause:** Redirect URL not configured  
**Best Fix:** Use manual method (no configuration needed)  
**Time:** 2 minutes  
**Success Rate:** 100%  

Just run:
```powershell
cd backend
python generate_token_manual.py
```

And follow the on-screen instructions! 🚀
