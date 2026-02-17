# 🚀 DIGITAL OCEAN DEPLOYMENT CHECKLIST

## Phase 1: Pre-Deployment Preparation

### Zerodha Credentials
- [ ] Login to Kite.zerodha.com with your trading account
- [ ] Navigate to Settings → Preferences
- [ ] Copy `API Key` value
- [ ] Copy `API Secret` value
- [ ] Generate fresh access token
- [ ] Copy the `Access Token` value

### Environment Variable Preparation
Prepare these values (keep them secure):
```
ZERODHA_API_KEY = [Copied from step above]
ZERODHA_API_SECRET = [Copied from step above]
ZERODHA_ACCESS_TOKEN = [Copied from step above]
JWT_SECRET = [Generate 32 random characters]
REDIRECT_URL = https://your-domain.com/api/auth/callback
FRONTEND_URL = https://your-domain.com
ENABLE_SCHEDULER = true
REDIS_URL = redis://default:password@redis-host:6379/0
```

### Code Updates
- [ ] Run: `git add -A && git status` - verify correct files changed
- [ ] Run: `python verify-live-data.py` - confirm live-only deployment
- [ ] Run: `backend/scripts/find_futures_tokens.py` - get current month tokens
- [ ] Update `.env.production` with futures tokens
- [ ] Commit: `git commit -m "Live data only deployment - ready for Digital Ocean"`

---

## Phase 2: Digital Ocean Setup

### Create/Update App
- [ ] Go to Digital Ocean App Platform dashboard
- [ ] Create new app OR select existing app
- [ ] Connect GitHub repository to auto-deploy

### Configure Environment Variables
In Digital Ocean App > Settings > Environment:

**SERVICE: backend**
```
ZERODHA_API_KEY = [your_key]
ZERODHA_API_SECRET = [your_secret]
ZERODHA_ACCESS_TOKEN = [your_token]
JWT_SECRET = [your_32_char_secret]
REDIRECT_URL = https://your-domain.com/api/auth/callback
FRONTEND_URL = https://your-domain.com
ENABLE_SCHEDULER = true
REDIS_URL = [your_redis_connection_string]
DEBUG = false
SERVER_HOST = 0.0.0.0
SERVER_PORT = 8000
```

**SERVICE: frontend**
```
NEXT_PUBLIC_API_URL = https://your-domain.com/api
NEXT_PUBLIC_WS_URL = wss://your-domain.com/ws
```

### Database & Cache Setup
- [ ] Create managed Redis cluster in Digital Ocean
- [ ] Get connection string: `redis://default:password@host:port/db`
- [ ] Update `REDIS_URL` in backend environment variables
- [ ] Test connection: `redis-cli -u [REDIS_URL] ping` (should return PONG)

### SSL/HTTPS
- [ ] Add custom domain
- [ ] Enable auto-renew SSL certificate
- [ ] Wait for DNS propagation (5-30 minutes)

---

## Phase 3: Deployment

### Deploy to Production
```bash
# Option 1: Push to GitHub (auto-deploys)
git push origin main

# Option 2: Manual deploy via Digital Ocean CLI
doctl apps create-deployment [app-id]
```

### Monitor Deployment
- [ ] Go to Digital Ocean App > Deployments
- [ ] Watch build progress
- [ ] Check for errors in logs
- [ ] Wait for "Completed" status

### Verify App is Running
- [ ] Check backend health: `curl https://your-domain.com/api/health`
- [ ] Check frontend loads: `https://your-domain.com`
- [ ] API should respond with JSON status

---

## Phase 4: Post-Deployment Testing

### Test 1: Market Status Check
```bash
curl https://your-domain.com/api/health/market-status
```
Expected response (during market hours 9:15-15:30 IST):
```json
{"status": "LIVE", "message": "Market is open"}
```

### Test 2: Live Price Feed
```bash
curl https://your-domain.com/api/market/current/NIFTY
```
Expected: Real NIFTY price from Zerodha (NOT dummy values)

### Test 3: WebSocket Live Stream
Open browser console and run:
```javascript
ws = new WebSocket('wss://your-domain.com/ws/market');
ws.onmessage = (e) => {
  const data = JSON.parse(e.data);
  console.log('Live tick:', data);
};
```
Expected: Real-time price updates every few seconds (during market hours)

### Test 4: Analysis Endpoints
```bash
curl https://your-domain.com/api/advanced-analysis/instant-signal/NIFTY
```
During market hours: Returns live analysis
Outside hours: Returns empty (intentional - no fallback to dummy data)

### Test 5: Frontend Integration
- [ ] Open https://your-domain.com
- [ ] Check if prices update in real-time (market hours only)
- [ ] Verify no static/dummy values showing up
- [ ] Test OAuth login with Zerodha
- [ ] Confirm analysis cards update with live data

---

## Phase 5: Monitoring & Maintenance

### Daily Monitoring (during market hours)
- [ ] Backend logs: Check for auth failures or API errors
- [ ] Frontend: Monitor for WebSocket disconnections
- [ ] Performance: Watch CPU/Memory usage
- [ ] Cache: Monitor Redis hit/miss rates

### Weekly Tasks
- [ ] Review error logs for patterns
- [ ] Check WebSocket connection stability
- [ ] Monitor API rate limits (Zerodha has 3 requests/second)

### Monthly Tasks (1st of every month)
```bash
# Update futures tokens
python backend/scripts/find_futures_tokens.py
# Update NIFTY_FUT_TOKEN, BANKNIFTY_FUT_TOKEN, SENSEX_FUT_TOKEN
# Push changes: git commit && git push
```

### As-Needed Troubleshooting

**Issue: "No data" appearing in UI**
- [ ] Check if it's 9:15-15:30 IST on a weekday
- [ ] Verify Zerodha market is open
- [ ] Check backend logs: `doctl apps logs [app-id] --component backend`

**Issue: API returns 401 Unauthorized**
- [ ] Zerodha access token expired (expires daily)
- [ ] Login to Kite.zerodha.com, generate fresh token
- [ ] Update ZERODHA_ACCESS_TOKEN in Digital Ocean settings

**Issue: WebSocket not connecting**
- [ ] Check frontend environment variables
- [ ] Verify NEXT_PUBLIC_WS_URL is correct (note: `wss://` for secure)
- [ ] Check firewall allows WebSocket on port 8000

**Issue: Building fails**
- [ ] Check Node.js version (>=16 required)
- [ ] Try: `cd frontend && npm cache clean --force && npm install`
- [ ] Check for syntax errors: `npm run build` locally first

---

## Phase 6: Performance Optimization

### Redis Caching (Optional but Recommended)
```bash
# Monitor cache performance
redis-cli -u [REDIS_URL] INFO stats

# Clear if needed
redis-cli -u [REDIS_URL] FLUSHALL
```

### API Rate Limiting
- Default: 3 requests/second per Zerodha API key
- If exceeded: Exponential backoff (auto-handled)
- Monitor: Check backend logs for rate limit messages

### WebSocket Optimization
- Connection pool size: Auto-managed
- Ping interval: 25 seconds (built-in)
- Timeout: 60 seconds (built-in)

---

## ✅ Success Criteria

Your deployment is **SUCCESSFUL** when:

✅ Backend health check returns 200 OK
✅ Live prices display during market hours (9:15-15:30 IST weekdays)
✅ NO dummy/fallback values showing (would show empty if data unavailable)
✅ WebSocket connects and receives real-time updates
✅ OAuth login works and stores authentication
✅ Analysis cards update with live data
✅ No errors in backend logs related to mock/test data

---

## 📞 Emergency Contacts

**If stuck during deployment:**
1. Check logs: `doctl apps logs [app-id]`
2. Review VERIFICATION_REPORT.md in repo
3. Verify all environment variables are set
4. Confirm market is open (9:15-15:30 IST)
5. Renew Zerodha access token if necessary

---

## 📋 Final Checklist
- [ ] All environment variables verified
- [ ] SSL certificate active
- [ ] Redis connection tested
- [ ] Backend responding
- [ ] Frontend loading
- [ ] WebSocket connected
- [ ] Live prices displaying
- [ ] No dummy data in UI
- [ ] Analysis working
- [ ] Logs clean of errors

**Ready for Production! 🎉**

---

Date: Feb 2026
Version: Live Data Only - Digital Ocean Ready
Verified: ✅ All production safety checks passed
