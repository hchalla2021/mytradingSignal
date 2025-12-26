# 🔐 Zerodha Authentication Setup Guide

## ✅ Quick Setup (3 Steps)

### Step 1: Configure Redirect URL in Zerodha App
1. Go to https://developers.kite.trade/apps
2. Click on your app
3. Set **Redirect URL** to:
   ```
   http://127.0.0.1:8000/api/auth/callback
   ```
4. Save changes

### Step 2: Get Login URL
Open in browser:
```
http://127.0.0.1:8000/api/auth/login-url
```

This will show you:
- ✅ Login URL to click
- ✅ API Key being used  
- ✅ Redirect URL configured
- ✅ Setup instructions

### Step 3: Login & Authorize
1. Click the login URL from Step 2
2. Enter your Zerodha credentials
3. Click "Authorize"
4. **You will be redirected back automatically** to `http://127.0.0.1:8000/api/auth/callback`
5. Backend will:
   - ✅ Exchange request_token for access_token
   - ✅ Save token to .env file
   - ✅ Reconnect market feed
   - ✅ Redirect you to frontend with success message

## 🔍 Verify Authentication

### Check Health Status
```
http://127.0.0.1:8000/api/analysis/health
```

Expected response when authenticated:
```json
{
  "status": "healthy",
  "zerodha_api": "connected",
  "access_token": "configured",
  "last_test": "2025-12-26T...",
  "test_symbol": "NIFTY",
  "test_price": 23500.50
}
```

## 🛠️ Configuration Files

### backend/.env
```env
# Must match exactly what's in Zerodha app settings
REDIRECT_URL=http://127.0.0.1:8000/api/auth/callback

# Your Zerodha credentials
ZERODHA_API_KEY=your_api_key
ZERODHA_API_SECRET=your_api_secret
ZERODHA_ACCESS_TOKEN=auto_filled_after_login
```

### backend/config.py
```python
redirect_url: str = "http://127.0.0.1:8000/api/auth/callback"
```

## 🔄 How It Works

```
1. User clicks login URL
   ↓
2. Zerodha login page opens
   ↓
3. User enters credentials & authorizes
   ↓
4. Zerodha redirects to: http://127.0.0.1:8000/api/auth/callback?request_token=XXX
   ↓
5. Backend /api/auth/callback endpoint:
   - Receives request_token
   - Calls kite.generate_session()
   - Gets access_token
   - Saves to .env
   - Updates settings
   - Reconnects market feed
   - Redirects to frontend
   ↓
6. Frontend shows success message
```

## ⚠️ Common Issues

### Issue 1: "Incorrect redirect_url"
**Solution:** Make sure redirect URL in Zerodha app matches exactly:
```
http://127.0.0.1:8000/api/auth/callback
```
NOT `http://localhost:8000` or any other variation.

### Issue 2: "Invalid access_token"
**Solution:** Tokens expire daily. Just login again:
```
http://127.0.0.1:8000/api/auth/login-url
```

### Issue 3: "Not redirecting back"
**Solution:** Check backend terminal logs. You should see:
```
🔐 ZERODHA CALLBACK RECEIVED
   Request Token: W5zC9F0UY50RFzAzlW5F...
   Status: None
   Action: login
```

If you don't see this, the redirect URL is wrong in Zerodha app settings.

### Issue 4: Frontend not on port 3000
**Solution:** Update redirect in auth.py line 67:
```python
return RedirectResponse(url=f"http://localhost:YOUR_PORT/login?status=success&user_id={user_id}")
```

## 🚀 Production Setup

For production (deployment), update:

1. **backend/.env**
   ```env
   REDIRECT_URL=https://yourdomain.com/api/auth/callback
   ```

2. **backend/routers/auth.py**
   ```python
   # Line 67, 45, 77 - Update all frontend redirect URLs
   return RedirectResponse(url=f"https://yourdomain.com/login?status=success&user_id={user_id}")
   ```

3. **Zerodha App Settings**
   - Set redirect URL to: `https://yourdomain.com/api/auth/callback`

## 📝 Environment Variables

```env
# Required for authentication
ZERODHA_API_KEY=your_api_key_here
ZERODHA_API_SECRET=your_secret_here
REDIRECT_URL=http://127.0.0.1:8000/api/auth/callback

# Auto-filled after successful login
ZERODHA_ACCESS_TOKEN=will_be_saved_automatically
```

## ✅ Testing Checklist

- [ ] Redirect URL set in Zerodha app: `http://127.0.0.1:8000/api/auth/callback`
- [ ] Backend running on port 8000
- [ ] Frontend running on port 3000
- [ ] Visit `/api/auth/login-url` to get login link
- [ ] Click login link and authorize
- [ ] See success redirect to frontend
- [ ] Check backend logs for "AUTHENTICATION COMPLETE"
- [ ] Verify `/api/analysis/health` shows "connected"
- [ ] Open frontend and see live market data

## 🎯 Quick Test Command

```powershell
# Get login URL
Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/auth/login-url" | ConvertFrom-Json

# Check health after login
Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/analysis/health" | ConvertFrom-Json
```
