# 🚨 QUICK FIX: "0/8 signals" on Digital Ocean Production

## TL;DR - Run These Commands on Your Server

```bash
# SSH into your Digital Ocean droplet
ssh root@your-digitalocean-ip

# Run diagnostic
curl -s http://localhost:8000/api/advanced/all-analysis/NIFTY | jq

# If timeout or no response:
docker logs trading-backend --tail 100

# If "401 Unauthorized" or token expired:
docker exec -it trading-backend python get_token.py

# Restart backend
docker-compose -f docker-compose.prod.yml restart backend

# Check if working
curl http://localhost:8000/api/health | jq
```

---

## Common Causes & Fixes

### 1. **Backend Container Not Running**
```bash
# Check status
docker ps | grep backend

# If not running, start it
docker-compose -f docker-compose.prod.yml up -d backend

# View logs
docker logs trading-backend --tail 50
```

---

### 2. **Zerodha Token Expired** (Most Common!)
Tokens expire daily at market close (3:30 PM IST).

**Quick Fix:**
```bash
# Generate new token
docker exec -it trading-backend python get_token.py

# Follow instructions, paste request token, confirm

# Restart backend
docker-compose -f docker-compose.prod.yml restart backend
```

**Auto-renewal setup:**
Add to crontab to auto-generate at 9 AM daily:
```bash
crontab -e

# Add this line
0 9 * * * cd /root/mytradingSignal && docker exec trading-backend python generate_token_manual.py >> /var/log/token_renewal.log 2>&1
```

---

### 3. **Redis Not Caching Data**
WebSocket feed might not be saving market data.

```bash
# Check if Redis has data
docker exec trading-redis redis-cli KEYS "*"

# Should show: market_data:NIFTY, market_data:BANKNIFTY, etc.

# If empty, check WebSocket logs
docker logs trading-backend | grep -i "websocket\|tick"

# Restart backend to reconnect WebSocket
docker-compose -f docker-compose.prod.yml restart backend
```

---

### 4. **CORS Blocking Frontend**
Frontend can't call backend APIs due to CORS.

**Check backend `.env`:**
```bash
nano /root/mytradingSignal/backend/.env
```

**Must have:**
```env
CORS_ORIGINS=https://mydailytradesignals.com,https://www.mydailytradesignals.com
FRONTEND_URL=https://mydailytradesignals.com
```

**Restart after changes:**
```bash
docker-compose -f docker-compose.prod.yml restart backend
```

---

### 5. **Frontend Using Wrong API URL**
```bash
# Check frontend environment
docker exec trading-frontend env | grep NEXT_PUBLIC

# Should show:
# NEXT_PUBLIC_API_URL=https://mydailytradesignals.com
```

**If wrong, fix `.env.local`:**
```bash
nano /root/mytradingSignal/frontend/.env.local
```

Add:
```env
NEXT_PUBLIC_API_URL=https://mydailytradesignals.com
NEXT_PUBLIC_ENVIRONMENT=production
```

**Rebuild frontend:**
```bash
docker-compose -f docker-compose.prod.yml up -d --build frontend
```

---

### 6. **API Endpoint Slow (Timeout)**
Aggregated endpoint takes >5 seconds to respond.

**Test response time:**
```bash
time curl http://localhost:8000/api/advanced/all-analysis/NIFTY
```

**If > 10 seconds:**
- Check if historical data fetch is slow
- Verify Zerodha API key quota not exceeded
- Check Redis performance

**Quick fix - increase cache TTL:**
Edit `backend/.env`:
```env
ADVANCED_ANALYSIS_CACHE_TTL=10  # Cache for 10 seconds
```

---

## Browser-Side Check

Open **https://mydailytradesignals.com** → Press **F12** (DevTools)

### **Console Tab** - Look for:
```
[OUTLOOK-NIFTY] Starting fetch...
[OUTLOOK-NIFTY] Fetch complete: {tech: '✓', allAdvanced: '✓', market: '✓'}
[OUTLOOK-NIFTY] Calculated confidence: 75%
```

**If you see errors:**
- `Failed to fetch` → Backend not responding or CORS issue
- `Timeout` → API too slow (see Fix #6 above)
- `401 Unauthorized` → Token expired (see Fix #2)

### **Network Tab** - Filter by Fetch/XHR:
Look for these requests:
- `/api/advanced/all-analysis/NIFTY` → Should be **200 OK**
- `/api/analysis/analyze/NIFTY` → Should be **200 OK**
- `/ws/cache/NIFTY` → Should be **200 OK**

**If status is:**
- `Failed` → Backend not responding
- `CORS error` → Fix CORS_ORIGINS
- `401/403` → Token expired
- `500` → Backend error (check logs)

---

## Expected Behavior After Fix

**In UI:**
```
Overall Market Outlook

NIFTY 50
HIGH CONFIDENCE
BUY SIGNAL
78%
✅ BUY OPPORTUNITY • Safe Zone • 78% Confidence
🏆 MASTER TRADE READY • 8/10 Rules
📊 7/8 signals  ← Should show 6-8 signals (not 0)
```

**In browser console:**
```
[OUTLOOK-NIFTY] ✅ NIFTY data received: 78%
[OUTLOOK-BANKNIFTY] ✅ BANKNIFTY data received: 82%
[OUTLOOK-SENSEX] ✅ SENSEX data received: 71%
```

---

## Still Not Working?

### Capture Logs:
```bash
# Backend logs
docker logs trading-backend --tail 500 > /tmp/backend.log

# Test API manually
curl -v http://localhost:8000/api/advanced/all-analysis/NIFTY > /tmp/api_test.json 2>&1

# Check Redis
docker exec trading-redis redis-cli KEYS "*" > /tmp/redis_keys.txt

# Download logs to your local machine
scp root@your-ip:/tmp/*.{log,json,txt} .
```

### Nuclear Option (Full Restart):
```bash
# Stop everything
docker-compose -f docker-compose.prod.yml down

# Clear old data
docker system prune -f

# Regenerate token
cd backend
python get_token.py

# Start everything
cd ..
docker-compose -f docker-compose.prod.yml up -d --build

# Wait 30 seconds, then test
sleep 30
curl http://localhost:8000/api/health | jq
```

---

## Monitoring Health (Ongoing)

**Add to crontab:**
```bash
crontab -e
```

**Add these lines:**
```cron
# Check backend health every 5 minutes
*/5 * * * * curl -sf http://localhost:8000/api/health | jq -e '.status == "healthy"' || echo "Backend unhealthy!" | mail -s "ALERT: Backend Down" your@email.com

# Auto-restart if backend crashes
*/10 * * * * docker ps | grep -q trading-backend || docker-compose -f /root/mytradingSignal/docker-compose.prod.yml up -d backend

# Renew token at 9 AM daily (market open)
0 9 * * * cd /root/mytradingSignal && docker exec trading-backend python generate_token_manual.py >> /var/log/token_renewal.log 2>&1
```

---

## 📞 Support Checklist

Before asking for help, provide:
1. ✅ Output of `docker ps -a`
2. ✅ Output of `docker logs trading-backend --tail 100`
3. ✅ Output of `curl http://localhost:8000/api/health`
4. ✅ Screenshot of browser DevTools Console
5. ✅ Screenshot of browser DevTools Network tab

This helps diagnose the exact issue quickly.

---

**Most common fix**: Regenerate Zerodha token daily! 🔑
