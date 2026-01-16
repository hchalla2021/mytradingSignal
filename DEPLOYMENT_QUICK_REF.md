# ⚡ QUICK DEPLOYMENT REFERENCE

## 🔄 Switch Local ↔ Production

### For Local Development:
```bash
# backend/.env
REDIRECT_URL=http://localhost:8000/api/auth/callback
FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000,http://localhost:3001

# frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws/market
```

### For Production:
```bash
# backend/.env (on server)
REDIRECT_URL=https://mydailytradesignals.com/api/auth/callback
FRONTEND_URL=https://mydailytradesignals.com
CORS_ORIGINS=https://mydailytradesignals.com

# frontend/.env.local (on server)
NEXT_PUBLIC_API_URL=https://mydailytradesignals.com
NEXT_PUBLIC_WS_URL=wss://mydailytradesignals.com/ws/market
```

## 🚀 One-Command Deploy (Digital Ocean)

```bash
cd /root/mytradingSignal && \
git pull origin main && \
cp backend/.env.production backend/.env && \
cp frontend/.env.production frontend/.env.local && \
docker-compose -f docker-compose.prod.yml down && \
docker rmi trading-frontend trading-backend 2>/dev/null || true && \
rm -rf frontend/.next && \
docker-compose -f docker-compose.prod.yml build --no-cache && \
docker-compose -f docker-compose.prod.yml up -d && \
docker-compose -f docker-compose.prod.yml ps
```

## 🧪 Quick Tests

```bash
# Backend health
curl http://localhost:8000/health

# API endpoint
curl http://localhost:8000/api/advanced/volume-pulse/NIFTY

# View logs
docker-compose -f docker-compose.prod.yml logs -f --tail=50
```

## 🧹 Clear Browser Cache

- **Chrome/Edge**: `Ctrl+Shift+Delete` → Clear cache
- **Firefox**: `Ctrl+Shift+Delete` → Cache
- **Safari**: `Cmd+Option+E`
- **Mobile**: Settings → Clear browser data
- **Best**: Use Incognito/Private mode

## ✅ Success Check

1. Open https://mydailytradesignals.com
2. See all 5 sections with live data:
   - 📊 Volume Pulse
   - 📈 Trend Base
   - 🔮 Early Warning
   - 🕯️ Candle Intent
   - 🎯 Zone Control
3. Test on mobile and desktop
4. No "Data unavailable" errors

## 🔧 Quick Fixes

**Issue**: Old cache showing
```bash
# Server
rm -rf frontend/.next
docker-compose -f docker-compose.prod.yml build --no-cache frontend

# Browser
Use Incognito mode
```

**Issue**: API not connecting
```bash
# Check backend logs
docker logs trading-backend --tail=50

# Restart backend
docker-compose -f docker-compose.prod.yml restart backend
```

**Issue**: Wrong URLs in code
```bash
# This should NOT happen anymore!
# All URLs come from .env files only
# Check: .env files are correct
cat backend/.env | grep URL
cat frontend/.env.local | grep NEXT_PUBLIC
```

## 📁 Files You Edit

**ONLY edit these 2 files for config:**
1. `backend/.env` - Backend URLs, Zerodha credentials
2. `frontend/.env.local` - Frontend URLs, WebSocket

**NEVER edit these (code files):**
- ❌ Don't edit `.ts` or `.tsx` files for URLs
- ❌ Don't edit Docker configs for URLs
- ❌ Don't commit `.env` files to git

## 🎯 Remember

✅ **DO**:
- Keep localhost and production configs in .env files
- Comment/uncomment sections to switch environments
- Use provided .env.production templates
- Clear caches after deployment
- Test on Incognito mode first

❌ **DON'T**:
- Hardcode URLs in code
- Commit .env files to git
- Skip cache clearing step
- Deploy without testing backend health

---

**Need help?** See [CLEAN_CONFIG_GUIDE.md](./CLEAN_CONFIG_GUIDE.md) for full details.
