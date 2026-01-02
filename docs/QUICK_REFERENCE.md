# 🚀 Quick Reference - Environment Setup

## ⚡ 30-Second Setup

```powershell
# 1. Backend .env
cd backend
cp .env.example .env
notepad .env
# Add: ZERODHA_API_KEY, ZERODHA_API_SECRET, JWT_SECRET

# 2. Frontend .env.local
cd ../frontend
cp .env.local.example .env.local
# Defaults work! No changes needed for local dev

# 3. Start
.\quick_start.ps1

# 4. Generate Token
python quick_token_fix.py
```

✅ **Done! Dashboard at http://localhost:3000**

---

## 📝 Required Environment Variables

### **Backend (.env)** - 4 variables REQUIRED:
```env
ZERODHA_API_KEY=your_key_here
ZERODHA_API_SECRET=your_secret_here
JWT_SECRET=random_32_char_string
REDIRECT_URL=http://127.0.0.1:8000/api/auth/callback
```

### **Frontend (.env.local)** - Uses defaults, no changes needed:
```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_WS_URL=ws://127.0.0.1:8000/ws/market
```

---

## 🔑 Get Zerodha Credentials

1. Go to: https://developers.kite.trade/apps
2. Create app (or use existing)
3. Set redirect: `http://127.0.0.1:8000/api/auth/callback`
4. Copy API Key & Secret

---

## 🔒 Generate Secure JWT Secret

```powershell
# PowerShell
[System.Convert]::ToBase64String([System.Guid]::NewGuid().ToByteArray() * 2)

# Or use online: https://generate-secret.vercel.app/32
```

---

## 🐛 Common Issues

### ❌ "ModuleNotFoundError: No module named 'dotenv'"
```powershell
pip install python-dotenv
```

### ❌ "ZERODHA_API_KEY not found"
```powershell
# Check .env exists
cd backend
if (!(Test-Path .env)) { cp .env.example .env }
notepad .env
```

### ❌ "Frontend can't connect"
```powershell
# Check backend is running
curl http://127.0.0.1:8000/api/health

# Check .env.local exists (optional but recommended)
cd frontend
if (!(Test-Path .env.local)) { cp .env.local.example .env.local }
```

### ❌ "403 Forbidden" or "TokenException"
```powershell
# Token expired - regenerate
python quick_token_fix.py
# Or visit: http://localhost:8000/api/auth/login
```

---

## 📚 Full Documentation

- [Complete Setup Guide](../ENVIRONMENT_SETUP.md) - Step-by-step
- [Environment Variables Reference](ENVIRONMENT_VARIABLES_COMPLETE.md) - All variables explained
- [Cleanup Summary](HARDCODED_VALUES_CLEANUP_COMPLETE.md) - What changed
- [Token Auto-Refresh](QUICKSTART_AUTO_TOKEN.md) - Token handling

---

## ✅ Verification

### Check Setup:
```powershell
# Backend .env exists
Test-Path backend\.env

# Frontend .env.local exists (optional)
Test-Path frontend\.env.local

# Backend can load config
cd backend
python -c "from config import get_settings; s = get_settings(); print('✅ Config loaded')"

# No hardcoded credentials
Select-String -Path "backend\*.py" -Pattern "api_key.*=.*[\"'][a-z0-9]{10,}"
# Should return: No matches
```

---

## 🚀 Production Deployment

### Backend on Digital Ocean:
```env
# backend/.env (on server)
REDIRECT_URL=https://api.yourdomain.com/api/auth/callback
FRONTEND_URL=https://yourdomain.com
JWT_SECRET=your_64_char_secure_random_string
DEBUG=false
CORS_ORIGINS=https://yourdomain.com
```

### Frontend on Vercel:
Add in Vercel dashboard:
```env
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
NEXT_PUBLIC_WS_URL=wss://api.yourdomain.com/ws/market
```

**Don't forget:** Update Zerodha redirect URL to production domain!

---

## 💡 Tips

1. **JWT_SECRET** - Must be 32+ chars, random
2. **Token Expiry** - Regenerate daily at 3 AM IST
3. **Auto-Reconnect** - Works without backend restart
4. **Redis** - Optional but improves performance
5. **AI Features** - Disabled by default (save API costs)

---

## 🆘 Need Help?

1. Check [ENVIRONMENT_SETUP.md](../ENVIRONMENT_SETUP.md)
2. Review `.env.example` files (have inline docs)
3. Search [docs/](.) folder
4. Open GitHub issue

---

**✅ All hardcoded values removed! Configuration is 100% environment-based.**
