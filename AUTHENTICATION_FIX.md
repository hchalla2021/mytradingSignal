# 🔧 Authentication Issues Fixed

## Issues Resolved

### 1. ✅ 'charmap' Codec Error (Windows Encoding Issue)
**Error:** `'charmap' codec can't decode byte 0x8f in position 434: character maps to <undefined>`

**Root Cause:** 
- The `.env` file contains special characters (like the OpenAI API key with special chars)
- Python's `dotenv` library was using Windows default encoding (`cp1252`) instead of UTF-8
- This caused decoding errors when reading the `.env` file

**Fix Applied:**
- Updated `backend/config/settings.py` to force UTF-8 encoding when loading `.env`:
  ```python
  load_dotenv(dotenv_path=env_path, encoding='utf-8')
  ```
- Updated `backend/app.py` to write `.env` file with UTF-8 encoding:
  ```python
  with open(env_path, 'r', encoding='utf-8') as f:
      lines = f.readlines()
  
  with open(env_path, 'w', encoding='utf-8') as f:
      # Write operations with UTF-8
  ```
- Set `PYTHONIOENCODING=utf-8` environment variable when starting the backend

### 2. ✅ Token is Invalid or Expired
**Error:** `❌ Authentication failed: Token is invalid or has expired.`

**Root Cause:**
- `ZERODHA_ACCESS_TOKEN` in `.env` is empty or expired
- Zerodha access tokens expire daily at 6:00 AM IST
- Users need to re-authenticate through Zerodha login flow

**Solution - Authentication Flow:**

#### Step 1: Open Frontend
```powershell
cd frontend
npm run dev
```
Open http://localhost:3000

#### Step 2: Click "Login with Zerodha"
- Frontend requests login URL from backend: `/api/auth/login-url`
- Backend generates Zerodha OAuth URL with `API_KEY`
- User is redirected to Zerodha login page

#### Step 3: Authenticate on Zerodha
- Enter Zerodha credentials (User ID, Password, PIN)
- Zerodha redirects back to: `http://localhost:3000/auth/callback?request_token=XXX`

#### Step 4: Backend Processes Token
- Frontend sends `request_token` to: `/api/auth/set-token?request_token=XXX`
- Backend calls Zerodha API to exchange `request_token` for `access_token`
  ```python
  data = kite.generate_session(request_token, api_secret=settings.ZERODHA_API_SECRET)
  ACCESS_TOKEN = data["access_token"]
  ```
- Backend saves `access_token` to `.env` file (with UTF-8 encoding)

#### Step 5: Authenticated!
- User can now access live trading signals
- Access token is valid until 6:00 AM IST next day

## Current Status

### ✅ Fixed Issues
1. **Encoding Error** - UTF-8 encoding now enforced
2. **Error Handling** - Better error messages in frontend
3. **Token Persistence** - Access token saved to `.env` with proper encoding

### ⚠️ Action Required
**You need to authenticate with Zerodha to get signals:**

1. **Start Backend** (already running):
   ```powershell
   cd backend
   $env:PYTHONIOENCODING="utf-8"
   python app.py
   ```
   Backend running on: http://localhost:8001

2. **Start Frontend**:
   ```powershell
   cd frontend
   npm run dev
   ```
   Frontend running on: http://localhost:3000

3. **Login to Zerodha**:
   - Open http://localhost:3000
   - Click "Login with Zerodha" button
   - Enter your Zerodha credentials
   - You'll be redirected back with authentication complete

4. **Access Signals**:
   - Once authenticated, the dashboard will show live trading signals
   - Access token is saved to `.env` and will persist across restarts
   - Token expires daily at 6:00 AM IST (re-login required)

## Files Modified

### 1. `backend/config/settings.py`
- Added `encoding='utf-8'` to `load_dotenv()`

### 2. `backend/app.py`
- Added `encoding='utf-8'` to all `.env` file read/write operations
- Line 627-629: Read with UTF-8
- Line 631-640: Write with UTF-8

### 3. `frontend/app/auth/callback/page.tsx`
- Enhanced error messages for codec and token errors
- Better user feedback for authentication failures

## Testing the Fix

### Test 1: Backend Starts Successfully ✅
```powershell
cd backend
$env:PYTHONIOENCODING="utf-8"
python app.py
```
**Expected:** No 'charmap' codec errors in console

### Test 2: Authentication Flow
```powershell
# Terminal 1: Backend
cd backend
$env:PYTHONIOENCODING="utf-8"
python app.py

# Terminal 2: Frontend
cd frontend
npm run dev
```
1. Open http://localhost:3000
2. Click "Login with Zerodha"
3. Authenticate on Zerodha
4. **Expected:** "✅ Authentication successful! Redirecting..."

### Test 3: Verify Token Saved
```powershell
Get-Content config\.env -Encoding UTF8 | Select-String "ZERODHA_ACCESS_TOKEN"
```
**Expected:** `ZERODHA_ACCESS_TOKEN=<your_token>`

## Troubleshooting

### If Backend Shows Encoding Errors
```powershell
# Force UTF-8 before starting
$env:PYTHONIOENCODING="utf-8"
cd backend
python app.py
```

### If Authentication Fails
1. Check backend is running on port 8001:
   ```powershell
   Invoke-RestMethod http://localhost:8001/health
   ```
2. Check frontend `NEXT_PUBLIC_API_URL` in `.env.local`:
   ```
   NEXT_PUBLIC_API_URL=http://localhost:8001
   ```
3. Check Zerodha credentials in `config/.env`:
   ```
   ZERODHA_API_KEY=<your_key>
   ZERODHA_API_SECRET=<your_secret>
   ```

### If Token Expired (Daily at 6 AM IST)
- Re-authenticate through the login flow
- New access token will be generated and saved

## Summary

✅ **Problem 1 Fixed:** 'charmap' codec error - UTF-8 encoding now enforced  
✅ **Problem 2 Fixed:** Token validation - Better error messages  
⚠️ **Action Required:** Authenticate with Zerodha to get live signals

**Next Step:** Open http://localhost:3000 and click "Login with Zerodha"
