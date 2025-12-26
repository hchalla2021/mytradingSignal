# 🚀 Complete Environment Configuration Guide

## Overview
All hardcoded values have been removed and centralized into environment variables. This makes the application fully portable across any hosting platform.

---

## 🔧 Backend Setup

### 1. Copy Environment Template
```bash
cd backend
cp .env.example .env
```

### 2. Configure Required Variables

#### Zerodha API (Required)
```bash
ZERODHA_API_KEY=your_api_key_here
ZERODHA_API_SECRET=your_secret_here
ZERODHA_ACCESS_TOKEN=will_be_auto_filled_after_login
```

#### URLs (Critical - Change for Production)
```bash
# Local development (default):
REDIRECT_URL=http://127.0.0.1:8000/api/auth/callback
FRONTEND_URL=http://localhost:3000

# Production example:
# REDIRECT_URL=https://api.yourdomain.com/api/auth/callback
# FRONTEND_URL=https://yourdomain.com
```

**⚠️ IMPORTANT:** Add your `REDIRECT_URL` to Zerodha app settings at https://developers.kite.trade/apps

#### JWT Secret (Change in Production)
```bash
JWT_SECRET=generate_a_strong_random_string_here
```

#### OpenAI (Optional - for AI analysis)
```bash
OPENAI_API_KEY=sk-your_key_here
```

### 3. Configure Optional Services

#### Redis
```bash
# Local:
REDIS_URL=redis://localhost:6379

# Cloud (Redis Labs, AWS ElastiCache, etc.):
# REDIS_URL=redis://username:password@host:port/db
```

#### Notifications (Optional)
```bash
# SMS via Twilio:
TWILIO_ACCOUNT_SID=your_sid
TWILIO_AUTH_TOKEN=your_token
TWILIO_PHONE_NUMBER=+1234567890
ALERT_PHONE_NUMBERS=+1234567890,+0987654321

# Email:
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASSWORD=your_app_password
ALERT_EMAIL_TO=alerts@example.com
```

---

## 🎨 Frontend Setup

### 1. Copy Environment Template
```bash
cd frontend
cp .env.local.example .env.local
```

### 2. Configure URLs

#### Local Development (default):
```bash
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws/market
```

#### Production:
```bash
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
NEXT_PUBLIC_WS_URL=wss://api.yourdomain.com/ws/market
```

---

## 🌐 Hosting Platform Examples

### Vercel (Frontend)
1. Add environment variables in Vercel dashboard
2. Use production URLs for backend API
3. Enable WebSocket support

### Railway / Render (Backend)
1. Add all backend environment variables
2. Set `HOST=0.0.0.0` (already default)
3. Set `PORT` to your platform's requirement
4. Set `REDIRECT_URL` and `FRONTEND_URL` to production domains

### DigitalOcean App Platform
1. Create app with both frontend and backend
2. Configure environment variables per service
3. Enable internal networking if needed

### AWS / Google Cloud
1. Use Elastic Beanstalk / App Engine
2. Configure environment variables
3. Set up load balancer for WebSocket support

---

## 🔐 Security Checklist

- [ ] Changed `JWT_SECRET` to a strong random string
- [ ] Never commit `.env` or `.env.local` files
- [ ] Use HTTPS in production (`https://` and `wss://`)
- [ ] Add `REDIRECT_URL` to Zerodha app settings
- [ ] Restrict `CORS_ORIGINS` in production (not `*`)
- [ ] Enable Redis authentication if exposed
- [ ] Rotate API keys regularly

---

## 🧪 Testing Configuration

### Verify Backend
```bash
cd backend
python -c "from config import get_settings; s = get_settings(); print(f'Frontend URL: {s.frontend_url}'); print(f'Redirect URL: {s.redirect_url}'); print(f'AI Enabled: {bool(s.openai_api_key)}')"
```

### Verify Frontend
```bash
cd frontend
npm run dev
# Check console for WebSocket connection URL
```

---

## 📊 All Configurable Parameters

### Backend (86 variables total)
- API credentials (Zerodha, OpenAI, Twilio, etc.)
- All URLs and redirect paths
- All timeouts and intervals
- Cache TTLs
- Rate limits
- Instrument tokens
- Server settings

### Frontend (8 variables total)
- Backend API URL
- WebSocket URL
- Feature flags
- Refresh intervals
- Analytics IDs

---

## 🚦 Start Servers

### Development
```bash
# Backend
cd backend
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000

# Frontend
cd frontend
npm run dev
```

### Production
```bash
# Backend
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4

# Frontend
cd frontend
npm run build
npm start
```

---

## 📝 Migration Notes

All hardcoded values removed:
- ❌ No more `localhost:8000` in code
- ❌ No more `localhost:3000` in code  
- ❌ No more hardcoded timeouts
- ❌ No more inline API keys
- ✅ Everything configurable via environment
- ✅ Works on any hosting platform
- ✅ Production-ready

---

## 🆘 Troubleshooting

### "Connection refused" errors
- Check `NEXT_PUBLIC_API_URL` matches backend URL
- Check `NEXT_PUBLIC_WS_URL` matches backend WebSocket URL
- Verify firewall allows connections

### "Invalid redirect_uri" from Zerodha
- Ensure `REDIRECT_URL` in backend `.env` matches exactly what's in Zerodha app settings
- Include the `/api/auth/callback` path
- Use `http://` for local, `https://` for production

### AI analysis not working
- Check `OPENAI_API_KEY` is set
- Verify API key is valid
- Check logs for API errors

---

## 📚 See Also
- `.env.example` - Complete backend config template
- `.env.local.example` - Complete frontend config template
- `config.py` - All backend configuration options
- Zerodha API docs: https://kite.trade/docs/connect/v3/
