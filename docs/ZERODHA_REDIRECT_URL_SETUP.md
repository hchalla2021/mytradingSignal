# 🔐 Zerodha Redirect URL Configuration

## ⚠️ IMPORTANT: You Must Configure This Before Authentication Works!

When you navigate to `http://127.0.0.1:8000/api/auth/login`, it redirects you to Zerodha login page. After you login at Zerodha, **Zerodha needs to know where to redirect you back**.

---

## 📍 What Redirect URL to Use?

### For Local Development (Your Current Setup):
```
http://127.0.0.1:8000/api/auth/callback
```

**OR** (both work the same):
```
http://localhost:8000/api/auth/callback
```

### For Production Deployment:
```
https://yourdomain.com/api/auth/callback
```

---

## 🔧 Step-by-Step Configuration

### Step 1: Open Zerodha Developer Console
1. Go to: **https://developers.kite.trade/apps**
2. Login with your Zerodha credentials
3. Find your app in the list (or create a new one)

### Step 2: Add Redirect URL
1. Click on your app name to edit settings
2. Look for **"Redirect URL"** or **"Redirect URLs"** field
3. Add **EXACTLY** this URL:
   ```
   http://127.0.0.1:8000/api/auth/callback
   ```
4. Click **"Update"** or **"Save"**

### Step 3: Verify Your .env File
Open `backend/.env` and make sure this line exists:
```env
REDIRECT_URL=http://127.0.0.1:8000/api/auth/callback
```

---

## 📊 Authentication Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                       AUTHENTICATION FLOW                            │
└─────────────────────────────────────────────────────────────────────┘

   User Browser                Backend                    Zerodha
   ────────────                ───────                    ────────
       │                          │                          │
       │  [1] Click Login         │                          │
       ├─────────────────────────>│                          │
       │                          │                          │
       │  [2] Redirect to Zerodha │                          │
       │<─────────────────────────┤                          │
       │                          │                          │
       │  [3] User logs in        │                          │
       ├────────────────────────────────────────────────────>│
       │                          │                          │
       │  [4] Zerodha redirects   │                          │
       │      to callback URL     │                          │
       │      (with request_token)│                          │
       │<────────────────────────────────────────────────────┤
       │                          │                          │
       │  [5] Callback receives   │                          │
       │      request_token       │                          │
       ├─────────────────────────>│                          │
       │                          │                          │
       │                          │  [6] Exchange token      │
       │                          ├─────────────────────────>│
       │                          │                          │
       │                          │  [7] Access token        │
       │                          │<─────────────────────────┤
       │                          │                          │
       │  [8] Redirect to         │                          │
       │      frontend with       │                          │
       │      success status      │                          │
       │<─────────────────────────┤                          │
       │                          │                          │
       ▼                          ▼                          ▼
```

---

## 🌐 URL Breakdown

### URL 1: Login Redirect (Backend → Zerodha)
```
http://127.0.0.1:8000/api/auth/login
         ↓
https://kite.zerodha.com/connect/login?v=3&api_key=YOUR_API_KEY
```
**Purpose:** Redirects user to Zerodha login page

---

### URL 2: Callback URL (Zerodha → Backend) ⚠️ THIS IS WHAT YOU CONFIGURE
```
http://127.0.0.1:8000/api/auth/callback?request_token=xxx&status=success
```
**Purpose:** Zerodha redirects here after successful login with `request_token`

**Route Handler:** `routers/auth.py` → `@router.get("/callback")`

**What Happens:**
1. Receives `request_token` from Zerodha
2. Exchanges `request_token` for `access_token`
3. Saves `access_token` to `.env` file
4. Redirects to frontend

---

### URL 3: Frontend Redirect (Backend → Frontend)
```
http://localhost:3000/login?status=success&user_id=XXX&user_name=John
```
**Purpose:** Backend redirects user back to frontend after authentication

**Configured in `.env` as:**
```env
FRONTEND_URL=http://localhost:3000
```

---

## ✅ Configuration Checklist

- [ ] **Step 1:** Go to https://developers.kite.trade/apps
- [ ] **Step 2:** Open your app settings
- [ ] **Step 3:** Add redirect URL: `http://127.0.0.1:8000/api/auth/callback`
- [ ] **Step 4:** Save settings in Zerodha developer console
- [ ] **Step 5:** Verify `backend/.env` has:
  ```env
  REDIRECT_URL=http://127.0.0.1:8000/api/auth/callback
  FRONTEND_URL=http://localhost:3000
  ZERODHA_API_KEY=your_api_key
  ZERODHA_API_SECRET=your_api_secret
  ```
- [ ] **Step 6:** Restart backend: `uvicorn main:app --reload`
- [ ] **Step 7:** Test login: Go to `http://127.0.0.1:8000/api/auth/login`

---

## 🐛 Troubleshooting

### Error: "Invalid redirect_uri"
**Cause:** The redirect URL in Zerodha app settings doesn't match what backend is sending

**Fix:**
1. Check Zerodha app settings - must be **EXACTLY**: `http://127.0.0.1:8000/api/auth/callback`
2. Check `backend/.env` - `REDIRECT_URL` must match Zerodha settings
3. No trailing slashes!
4. Use `127.0.0.1` not `localhost` (or vice versa - must be consistent)

---

### Error: "redirect_url not configured"
**Cause:** `REDIRECT_URL` is missing or empty in `backend/.env`

**Fix:**
```bash
# Edit backend/.env
REDIRECT_URL=http://127.0.0.1:8000/api/auth/callback
```

---

### Callback Not Triggered
**Symptoms:** After Zerodha login, nothing happens

**Possible Causes:**
1. Backend not running (`uvicorn main:app --reload`)
2. Wrong port (backend must be on port 8000)
3. Firewall blocking port 8000
4. Using HTTPS instead of HTTP for local dev

**Fix:**
```bash
# Make sure backend is running on correct port
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

---

## 📸 Screenshot Guide

### Zerodha Developer Console - Where to Add Redirect URL

```
┌──────────────────────────────────────────────────────────────┐
│  Kite Connect - App Settings                                 │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  App Name:           MyDailyTradingSignals                   │
│  App Type:           Connect                                 │
│                                                               │
│  API Key:            xxxxxxxxxxxxxxxx                        │
│  API Secret:         xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx        │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Redirect URLs:                                         │ │
│  │                                                         │ │
│  │ http://127.0.0.1:8000/api/auth/callback      [Remove] │ │ ← ADD THIS
│  │                                                         │ │
│  │ [+ Add Another URL]                                    │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  [Update Settings]                                           │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## 🎯 Quick Test

### Test 1: Check Configuration Endpoint
```bash
curl http://127.0.0.1:8000/api/auth/login-url
```

**Expected Response:**
```json
{
  "login_url": "https://kite.zerodha.com/connect/login?v=3&api_key=...",
  "api_key": "your_api_key",
  "redirect_url": "http://127.0.0.1:8000/api/auth/callback",
  "instructions": "Set this redirect_url in your Zerodha app settings..."
}
```

### Test 2: Login Flow
1. Open browser: `http://127.0.0.1:8000/api/auth/login`
2. Should redirect to Zerodha login page
3. Login with Zerodha credentials
4. Should redirect back to `http://127.0.0.1:8000/api/auth/callback?request_token=...`
5. Should redirect to `http://localhost:3000/login?status=success...`

---

## 📝 Summary

**The ONLY URL you need to add in Zerodha Developer Console:**

```
http://127.0.0.1:8000/api/auth/callback
```

**This URL must match EXACTLY in:**
1. ✅ Zerodha App Settings (developers.kite.trade)
2. ✅ `backend/.env` → `REDIRECT_URL`

**That's it! Once configured, authentication will work smoothly.** 🎉
