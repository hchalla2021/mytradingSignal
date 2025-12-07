# Production Deployment Guide - GoDaddy Domain + Vercel/Render

## Overview
This guide will help you deploy your Trading Signals app with:
- **Frontend**: Vercel (automatic deployment from GitHub)
- **Backend**: Render (Python/FastAPI server)
- **Domain**: Your GoDaddy domain

---

## Step 1: Backend Deployment on Render

### 1.1 Create Account
1. Go to https://render.com and sign up
2. Connect your GitHub repository

### 1.2 Create New Web Service
1. Click "New +" → "Web Service"
2. Connect your GitHub repo
3. Configure:
   - **Name**: `trading-signals-backend`
   - **Root Directory**: Leave empty (or `backend`)
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `cd backend && python app.py`
   - **Instance Type**: Free (or paid for better performance)

### 1.3 Set Environment Variables on Render
Go to Environment tab and add:

```
ZERODHA_API_KEY=your_actual_api_key
ZERODHA_API_SECRET=your_actual_api_secret
REDIRECT_URL=https://yourdomain.com/auth/callback
PORT=8000
HOST=0.0.0.0
```

**Important**: Replace `yourdomain.com` with your actual GoDaddy domain!

### 1.4 Deploy
Click "Create Web Service" - Render will deploy your backend automatically.
Note the URL: `https://trading-signals-backend.onrender.com`

---

## Step 2: Frontend Deployment on Vercel

### 2.1 Create Account
1. Go to https://vercel.com and sign up
2. Import your GitHub repository

### 2.2 Configure Project
1. Click "Import Project"
2. Select your repo
3. Configure:
   - **Framework Preset**: Next.js
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build`
   - **Output Directory**: `.next`

### 2.3 Set Environment Variables on Vercel
Go to Settings → Environment Variables:

```
NEXT_PUBLIC_API_URL=https://trading-signals-backend.onrender.com
NODE_ENV=production
```

### 2.4 Deploy
Click "Deploy" - Vercel will build and deploy your frontend.
You'll get a URL like: `https://your-project.vercel.app`

---

## Step 3: Connect GoDaddy Domain

### 3.1 For Frontend (Vercel)

**In Vercel Dashboard:**
1. Go to your project → Settings → Domains
2. Add your domain: `yourdomain.com`
3. Add www subdomain: `www.yourdomain.com`

**In GoDaddy DNS Settings:**
1. Go to GoDaddy → My Products → Domain → DNS Settings
2. Add these records:

```
Type    Name    Value                          TTL
A       @       76.76.21.21                   600
CNAME   www     cname.vercel-dns.com          600
```

### 3.2 For Backend Subdomain (Optional)

**Create API subdomain: `api.yourdomain.com`**

**In Render Dashboard:**
1. Go to your backend service → Settings
2. Add custom domain: `api.yourdomain.com`
3. Note the CNAME value provided

**In GoDaddy DNS:**
```
Type    Name    Value                                   TTL
CNAME   api     your-service.onrender.com               600
```

---

## Step 4: Update Configuration

### 4.1 Update Backend Environment on Render
```
REDIRECT_URL=https://yourdomain.com/auth/callback
```

### 4.2 Update Frontend Environment on Vercel
If using custom API subdomain:
```
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
```

Otherwise use Render URL:
```
NEXT_PUBLIC_API_URL=https://trading-signals-backend.onrender.com
```

### 4.3 Redeploy Both Services
- Render: Will auto-redeploy on env changes
- Vercel: Go to Deployments → Redeploy

---

## Step 5: Testing

### 5.1 Test Backend
Open: `https://api.yourdomain.com/api/market/status`
Should return JSON with market status

### 5.2 Test Frontend
1. Open: `https://yourdomain.com`
2. Click "Login to Zerodha"
3. Should redirect to Zerodha login
4. After login, should redirect back and show data

---

## Common Issues & Fixes

### Issue 1: "Failed to get login URL"
**Cause**: Backend not configured or CORS issue
**Fix**:
1. Check backend is running: `https://api.yourdomain.com/docs`
2. Verify `ZERODHA_API_KEY` is set in Render environment
3. Check backend logs on Render dashboard

### Issue 2: CORS Error on iPhone
**Cause**: CORS not allowing your domain
**Fix**: Backend already configured to allow all origins (`allow_origins=["*"]`)

### Issue 3: Login Redirect Not Working
**Cause**: Wrong `REDIRECT_URL`
**Fix**: Ensure `REDIRECT_URL` matches exactly:
- Format: `https://yourdomain.com/auth/callback`
- Must be registered in Zerodha app settings

### Issue 4: Domain Not Resolving
**Cause**: DNS propagation delay
**Fix**: Wait 24-48 hours for DNS to propagate globally
- Check: https://dnschecker.org

---

## Environment Variables Checklist

### Backend (Render)
- ✅ `ZERODHA_API_KEY`
- ✅ `ZERODHA_API_SECRET`
- ✅ `REDIRECT_URL` (with your domain)
- ✅ `PORT=8000`
- ✅ `HOST=0.0.0.0`

### Frontend (Vercel)
- ✅ `NEXT_PUBLIC_API_URL` (your backend URL)
- ✅ `NODE_ENV=production`

---

## DNS Records Summary

```
# Main domain
A       @       76.76.21.21                    (Vercel)
CNAME   www     cname.vercel-dns.com           (Vercel)

# API subdomain (optional)
CNAME   api     your-backend.onrender.com      (Render)
```

---

## Monitoring & Logs

### Backend Logs (Render)
- Dashboard → Your Service → Logs
- Watch for errors, API calls, login attempts

### Frontend Logs (Vercel)
- Dashboard → Your Project → Deployments → View Function Logs
- Check for build errors, runtime errors

### Browser Console
- iPhone: Settings → Safari → Advanced → Web Inspector
- Check for network errors, CORS issues

---

## SSL/HTTPS
Both Vercel and Render automatically provide free SSL certificates.
Your domain will be secured with HTTPS automatically.

---

## Support

If you encounter issues:

1. **Check Logs**: Render backend logs + Vercel deployment logs
2. **Test Backend**: Visit `/docs` endpoint to test API
3. **Verify DNS**: Use dnschecker.org to confirm propagation
4. **Check Env Vars**: Ensure all required variables are set

**Backend Health Check**: `https://api.yourdomain.com/api/market/status`
**API Documentation**: `https://api.yourdomain.com/docs`

---

## Next Steps After Deployment

1. ✅ Register `REDIRECT_URL` in Zerodha Kite Connect app settings
2. ✅ Test login flow on mobile and desktop
3. ✅ Monitor logs for any errors
4. ✅ Set up Twilio for SMS alerts (optional)
5. ✅ Add custom domain to professional account (remove Vercel/Render branding)

---

Your app is now live at: **https://yourdomain.com** 🚀
