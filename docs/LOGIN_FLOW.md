# 🔐 Automatic Zerodha Login Flow

## ✨ Features
- **One-Click Login** - No manual token generation needed
- **Auto-Save** - Token automatically saved to `.env` file
- **24-Hour Validity** - Token lasts until market close
- **Auto-Reconnect** - Backend reconnects instantly after authentication
- **Smart UI** - Login button appears only when disconnected

## 🚀 How It Works

### User Journey
1. **Start Backend & Frontend**
   ```bash
   # Terminal 1 - Backend
   cd backend
   python main.py
   
   # Terminal 2 - Frontend  
   cd frontend
   npm run dev
   ```

2. **Click Login Button**
   - Visit `http://localhost:3000`
   - Click **"🔑 LOGIN"** button in header (appears when offline)
   - OR visit `http://localhost:3000/login` directly

3. **Authenticate with Zerodha**
   - Redirected to Zerodha Kite login page
   - Enter your Zerodha credentials
   - Click authorize

4. **Automatic Token Handling**
   - ✅ `request_token` captured automatically
   - ✅ `access_token` generated automatically
   - ✅ Token saved to `backend/.env`
   - ✅ Backend reconnects with new token
   - ✅ Live market data starts streaming!

5. **Dashboard**
   - Redirected back to dashboard
   - Status changes to **"LIVE"**
   - Real-time data flows from Zerodha

## 🔄 OAuth Flow (Technical)

```
User → Frontend Login Page
    ↓
Frontend → Backend /api/auth/login
    ↓
Backend → Zerodha OAuth URL
    ↓
User Authenticates → Zerodha
    ↓
Zerodha → Backend /api/auth/callback?request_token=XXX
    ↓
Backend → Generate access_token from request_token
    ↓
Backend → Save to .env file
    ↓
Backend → Reconnect KiteTicker with new token
    ↓
Backend → Return success to Frontend
    ↓
Frontend → Redirect to Dashboard (/)
```

## 📝 Environment Variables

The backend automatically updates `backend/.env`:

```env
ZERODHA_API_KEY=your_api_key
ZERODHA_API_SECRET=your_api_secret
ZERODHA_ACCESS_TOKEN=auto_generated_token  # ← Updated automatically
```

## ⏰ Token Expiry

- **Zerodha tokens expire daily** (at market close)
- **Solution**: Simply click the login button again next day
- **No manual intervention needed!**

## 🎯 Benefits vs Manual Token Generation

| Feature | Manual | Automatic (This App) |
|---------|--------|---------------------|
| Token Generation | Copy-paste request_token, run script | One button click |
| Token Saving | Manual edit `.env` file | Auto-saved |
| Backend Restart | Manual restart required | Auto-reconnects |
| User Experience | Technical, error-prone | Seamless, one-click |
| Daily Renewal | Repeat manual steps | Just click login |

## 🔒 Security

- ✅ OAuth 2.0 standard flow
- ✅ Tokens never exposed in URLs (only in secure callbacks)
- ✅ Credentials stored securely in `.env` (gitignored)
- ✅ No passwords stored anywhere

## 🐛 Troubleshooting

### Login Button Not Showing
- Status must be "OFFLINE" or disconnected
- Check if backend is running

### "403 Forbidden" Error
- Token expired (older than 24 hours)
- Click login button again

### Redirect Not Working
- Ensure backend is running on `http://localhost:8000`
- Check `REDIRECT_URL` in `backend/.env` matches:
  ```
  REDIRECT_URL=http://localhost:8000/api/auth/callback
  ```

### Backend Not Reconnecting
- Check backend logs for errors
- Manually restart if needed: `python main.py`

## 📱 Demo Mode

If you don't have Zerodha credentials, the app works in **DEMO mode**:
- Click "Continue with Demo Data" on login page
- Shows simulated market data
- Perfect for testing UI/UX

---

**Made with ❤️ for traders who hate manual token generation!**
