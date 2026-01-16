# Deploy with Cache Fix - Complete Guide

## Problem Fixed
- Volume Pulse and Trend Base cards were showing "Data unavailable"
- Root cause: Missing `API_CONFIG` import statements
- Backend was working correctly, frontend couldn't access API configuration

## Changes Made
1. **frontend/components/VolumePulseCard.tsx**: Added `import { API_CONFIG } from '@/lib/api-config'`
2. **frontend/components/TrendBaseCard.tsx**: Added `import { API_CONFIG } from '@/lib/api-config'`

## Deployment Steps for Digital Ocean

### Step 1: Push Changes to Git
```bash
git add .
git commit -m "Fix: Added missing API_CONFIG imports"
git push origin main
```

### Step 2: SSH to Digital Ocean
```bash
ssh root@your-droplet-ip
```

### Step 3: Navigate to Project
```bash
cd /root/mytradingSignal
```

### Step 4: Pull Latest Changes
```bash
git pull origin main
```

### Step 5: Stop All Containers
```bash
docker-compose -f docker-compose.prod.yml down
```

### Step 6: Clear All Caches
```bash
# Remove old Docker images
docker rmi trading-frontend trading-backend 2>/dev/null || true

# Clear frontend build cache
rm -rf frontend/.next
rm -rf frontend/node_modules/.cache

# Clear Docker build cache (optional, takes longer)
docker builder prune -f
```

### Step 7: Rebuild with No Cache
```bash
docker-compose -f docker-compose.prod.yml build --no-cache
```

### Step 8: Start Services
```bash
docker-compose -f docker-compose.prod.yml up -d
```

### Step 9: Verify Deployment
```bash
# Check container status
docker-compose -f docker-compose.prod.yml ps

# View logs
docker-compose -f docker-compose.prod.yml logs -f --tail=50

# Test backend endpoint
curl http://localhost:8000/api/advanced/volume-pulse/NIFTY

# Test frontend
curl http://localhost:3000
```

## Client-Side Cache Clearing

### Desktop Browsers
1. **Chrome/Edge**:
   - Press `Ctrl+Shift+Delete`
   - Select "Cached images and files"
   - Click "Clear data"
   - OR use Incognito mode: `Ctrl+Shift+N`

2. **Firefox**:
   - Press `Ctrl+Shift+Delete`
   - Select "Cache"
   - Click "Clear Now"
   - OR use Private mode: `Ctrl+Shift+P`

3. **Safari**:
   - Press `Cmd+Option+E` (Mac)
   - Or go to Develop > Empty Caches
   - OR use Private mode: `Cmd+Shift+N`

### Mobile Browsers
1. **Chrome (Android)**:
   - Settings > Privacy > Clear browsing data
   - Select "Cached images and files"
   - Tap "Clear data"

2. **Safari (iOS)**:
   - Settings > Safari > Clear History and Website Data

3. **Alternative**: Use Private/Incognito mode on mobile

## Verification Checklist

### ✅ Backend Health
- [ ] Backend container running: `docker ps | grep trading-backend`
- [ ] Backend responds to health check: `curl http://localhost:8000/health`
- [ ] Volume Pulse endpoint returns data: `curl http://localhost:8000/api/advanced/volume-pulse/NIFTY`

### ✅ Frontend Health
- [ ] Frontend container running: `docker ps | grep trading-frontend`
- [ ] Frontend page loads: `curl http://localhost:3000`
- [ ] No 404 errors in logs

### ✅ Browser Testing
- [ ] Desktop Chrome: Volume Pulse shows data
- [ ] Desktop Firefox: Volume Pulse shows data
- [ ] Desktop Safari: Volume Pulse shows data
- [ ] Desktop Edge: Volume Pulse shows data
- [ ] Mobile Chrome: Volume Pulse shows data
- [ ] Mobile Safari: Volume Pulse shows data

### ✅ All Sections Working
- [ ] 📊 Volume Pulse: Shows green/red candle percentages
- [ ] 📈 Trend Base: Shows swing structure
- [ ] 🔮 Early Warning: Shows predictive signals
- [ ] 🕯️ Candle Intent: Shows candle patterns
- [ ] 🎯 Zone Control: Shows support/resistance

## Troubleshooting

### Issue: Still seeing "Data unavailable" after deployment
**Solution**:
1. Clear browser cache (Ctrl+Shift+Delete)
2. Use Incognito/Private mode
3. Check browser console for errors (F12)
4. Verify API_CONFIG import exists: `grep "API_CONFIG" frontend/components/VolumePulseCard.tsx`

### Issue: Container won't start
**Solution**:
```bash
# Check logs
docker-compose -f docker-compose.prod.yml logs backend
docker-compose -f docker-compose.prod.yml logs frontend

# Restart individual service
docker-compose -f docker-compose.prod.yml restart frontend
```

### Issue: Backend returns 404
**Solution**:
```bash
# Check backend routes
docker exec trading-backend curl http://localhost:8000/docs

# Verify token exists
docker exec trading-backend cat /app/access_token.txt

# Restart backend
docker-compose -f docker-compose.prod.yml restart backend
```

### Issue: Frontend shows old code
**Solution**:
```bash
# Nuclear option - remove everything and rebuild
docker-compose -f docker-compose.prod.yml down -v
docker rmi $(docker images -q trading-*)
rm -rf frontend/.next
docker-compose -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.prod.yml up -d
```

## Environment Variables Check

### Backend (.env)
```bash
# Must have production URLs
FRONTEND_URL=https://mydailytradesignals.com
REDIRECT_URL=https://mydailytradesignals.com/auth/callback
CORS_ORIGINS=https://mydailytradesignals.com
```

### Frontend (.env.local or docker-compose.prod.yml)
```bash
# Must point to production backend
NEXT_PUBLIC_API_URL=https://mydailytradesignals.com
NEXT_PUBLIC_WS_URL=wss://mydailytradesignals.com/ws/market
```

## Quick Deploy Command (All-in-One)
```bash
# Run this on Digital Ocean server
cd /root/mytradingSignal && \
git pull origin main && \
docker-compose -f docker-compose.prod.yml down && \
docker rmi trading-frontend trading-backend 2>/dev/null || true && \
rm -rf frontend/.next frontend/node_modules/.cache && \
docker-compose -f docker-compose.prod.yml build --no-cache && \
docker-compose -f docker-compose.prod.yml up -d && \
docker-compose -f docker-compose.prod.yml logs -f --tail=50
```

## Success Indicators
✅ All 5 advanced analysis sections show live data  
✅ Works on any desktop browser (Chrome, Firefox, Safari, Edge)  
✅ Works on mobile devices (iOS Safari, Android Chrome)  
✅ No "Data unavailable" errors  
✅ No cache issues after deployment  
✅ Responsive design works correctly on all screen sizes  

## Support
If issues persist:
1. Check [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) for common fixes
2. View logs: `docker-compose -f docker-compose.prod.yml logs -f`
3. Test backend directly: `curl http://localhost:8000/api/advanced/volume-pulse/NIFTY`
4. Verify frontend build: `docker exec trading-frontend ls -la /app/.next`
