# iPhone Login Error - Troubleshooting Guide

## Problem
"Failed to get login URL. Please check backend is running." on iPhone

---

## Root Cause Analysis

### Most Common Causes:
1. **Backend not configured with ZERODHA_API_KEY**
2. **CORS blocking requests from your domain**
3. **Wrong API URL in frontend environment**
4. **Network/firewall blocking connection**

---

## Fix #1: Verify Backend Configuration

### Check Health Endpoint
Open in browser: `https://your-backend-url.onrender.com/health`

**Expected Response:**
```json
{
  "status": "healthy",
  "config": {
    "zerodha_api_key_configured": true,  ← MUST BE TRUE
    "zerodha_api_secret_configured": true,  ← MUST BE TRUE
    "redirect_url": "https://yourdomain.com/auth/callback"
  }
}
```

**If `zerodha_api_key_configured: false`:**
→ Go to Render Dashboard → Your Service → Environment
→ Add `ZERODHA_API_KEY` and `ZERODHA_API_SECRET`
→ Click "Save Changes" (will auto-redeploy)

---

## Fix #2: Update Frontend API URL

### For Vercel Deployment

**Go to**: Vercel Dashboard → Your Project → Settings → Environment Variables

**Check/Add:**
```
NEXT_PUBLIC_API_URL=https://your-backend.onrender.com
```

**Important**: NO trailing slash!

### For Local Testing
Update `frontend/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## Fix #3: Enable CORS for Your Domain

Backend already configured to accept all origins (`allow_origins=["*"]`).

If still facing issues, check browser console:
- iPhone: Settings → Safari → Advanced → Web Inspector
- Look for "CORS" or "Access-Control-Allow-Origin" errors

---

## Fix #4: Test Backend Directly

### Test 1: Health Check
```bash
curl https://your-backend.onrender.com/health
```

### Test 2: Login URL Endpoint
```bash
curl https://your-backend.onrender.com/api/auth/login-url
```

**Expected Response:**
```json
{
  "login_url": "https://kite.zerodha.com/connect/login?api_key=xxx&v=3",
  "mobile_login_url": "kite://...",
  "api_key": "your_api_key"
}
```

**If you see error:**
- Check Render logs
- Verify environment variables are set

---

## Fix #5: Check Network Tab (iPhone)

### Enable Safari Web Inspector on iPhone:
1. Settings → Safari → Advanced → Enable "Web Inspector"
2. Connect iPhone to Mac
3. Open Safari on Mac → Develop → [Your iPhone] → Your Site
4. Check Network tab for `/api/auth/login-url` request

**Look for:**
- Status Code (should be 200)
- Response data
- Error messages

---

## Production Deployment Checklist

### Backend (Render)
- [ ] Service deployed and running
- [ ] `ZERODHA_API_KEY` environment variable set
- [ ] `ZERODHA_API_SECRET` environment variable set
- [ ] `REDIRECT_URL` set to your domain: `https://yourdomain.com/auth/callback`
- [ ] Health check returns `zerodha_api_key_configured: true`
- [ ] Can access `/docs` endpoint

### Frontend (Vercel)
- [ ] Project deployed successfully
- [ ] `NEXT_PUBLIC_API_URL` points to backend (Render URL)
- [ ] No trailing slash in API URL
- [ ] Domain connected and working
- [ ] Can access homepage

### Zerodha Kite Connect App
- [ ] App created at https://developers.kite.trade
- [ ] Redirect URL registered: `https://yourdomain.com/auth/callback`
- [ ] API credentials copied to Render environment

---

## Quick Test Script

### Test from iPhone Safari Console:
```javascript
// Open Safari → your site → Enable Inspector
fetch('https://your-backend.onrender.com/api/auth/login-url')
  .then(res => res.json())
  .then(data => console.log('Success:', data))
  .catch(err => console.error('Error:', err));
```

**Success**: Should print `login_url`, `api_key`, etc.
**Error**: Check error message for clues

---

## Common Error Messages & Solutions

### Error: "Network Error"
**Cause**: Cannot reach backend
**Fix**: 
- Check backend is running on Render
- Verify `NEXT_PUBLIC_API_URL` in Vercel
- Check firewall/VPN blocking connection

### Error: "CORS policy"
**Cause**: Backend not accepting requests from your domain
**Fix**: Backend already allows all origins - check browser console for actual error

### Error: "500 Internal Server Error"
**Cause**: Backend configuration issue
**Fix**:
- Check Render logs for errors
- Verify `ZERODHA_API_KEY` is set
- Test `/health` endpoint

### Error: "Incorrect api_key or access_token"
**Cause**: Invalid Zerodha credentials
**Fix**:
- Verify API key in Zerodha Kite Connect dashboard
- Check credentials match exactly (no extra spaces)
- Regenerate API secret if needed

---

## Step-by-Step Production Deployment

### 1. Deploy Backend First
```bash
# On Render
1. Create Web Service
2. Set environment variables
3. Wait for deployment
4. Test: https://your-backend.onrender.com/health
```

### 2. Deploy Frontend Second
```bash
# On Vercel
1. Import project
2. Set NEXT_PUBLIC_API_URL to backend URL
3. Deploy
4. Test: https://your-frontend.vercel.app
```

### 3. Connect Domain
```bash
# On GoDaddy
1. Add DNS records (A record for root, CNAME for www)
2. Wait 24-48 hours for propagation
3. Test: https://yourdomain.com
```

### 4. Update Configuration
```bash
# On Render (Backend)
REDIRECT_URL=https://yourdomain.com/auth/callback

# On Vercel (Frontend) - if using custom domain
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
# OR keep Render URL
NEXT_PUBLIC_API_URL=https://your-backend.onrender.com
```

### 5. Register Redirect URL
```bash
# On Zerodha Kite Connect
1. Go to https://developers.kite.trade
2. Your App → Redirect URLs
3. Add: https://yourdomain.com/auth/callback
4. Save
```

---

## Debug Mode

### Enable Detailed Logging

**Frontend (`page.tsx` already has detailed logs):**
- Open browser console
- Look for `[LOGIN]` prefixed messages
- Check API URL, response data, errors

**Backend (check Render logs):**
- Look for `[AUTH]` prefixed messages
- Check if API key is loaded
- Verify redirect URL

---

## Still Not Working?

### Last Resort Checklist:
1. ✅ Backend health check returns `healthy`
2. ✅ Can access `/docs` endpoint on backend
3. ✅ Frontend can load (not just login issue)
4. ✅ Environment variables set on BOTH Render and Vercel
5. ✅ No typos in API URLs (common mistake!)
6. ✅ Waited for DNS propagation (if using custom domain)
7. ✅ Tested on different network (not just iPhone)
8. ✅ Cleared browser cache
9. ✅ Tried incognito/private mode
10. ✅ Checked Render and Vercel logs for errors

### Get Support:
- Render Logs: Dashboard → Service → Logs
- Vercel Logs: Dashboard → Project → Deployments → View Logs
- Browser Console: F12 → Console tab

---

## Success Indicators

### Backend Working:
```bash
✅ /health returns "healthy"
✅ /api/auth/login-url returns login URL
✅ No errors in Render logs
✅ Can access /docs (FastAPI Swagger UI)
```

### Frontend Working:
```bash
✅ Homepage loads
✅ Can see market data (even if not logged in)
✅ Login button visible
✅ No console errors
```

### Integration Working:
```bash
✅ Click login → redirects to Zerodha
✅ After Zerodha login → redirects back to your site
✅ Can see live market data
✅ No "Failed to get login URL" error
```

---

## Contact

If all else fails, share:
1. Backend health check response
2. Frontend console logs (screenshot)
3. Render backend logs (last 50 lines)
4. Exact error message

Good luck! 🚀
