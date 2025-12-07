# Render Deployment Fix Guide

## Issues Fixed

### 1. **Frontend Not Loading**
- **Problem**: The start command wasn't properly binding to Render's dynamic port
- **Solution**: Updated `startCommand` to use `npm start -- -p $PORT -H 0.0.0.0`

### 2. **Build Command Optimization**
- **Problem**: Using `npm install` can cause inconsistent builds
- **Solution**: Changed to `npm ci` for clean, reproducible installs

### 3. **Environment Variables**
- Removed unnecessary `PORT` and `HOSTNAME` env vars (handled by start command)
- Kept `NEXT_PUBLIC_API_URL` for API communication

## Changes Made

### 1. `render.yaml`
```yaml
# Frontend Service - FIXED
- type: web
  name: options-trading-frontend
  env: node
  region: singapore
  buildCommand: "cd frontend && npm ci && npm run build"
  startCommand: "cd frontend && npm start -- -p $PORT -H 0.0.0.0"
  envVars:
    - key: NODE_ENV
      value: production
    - key: NEXT_PUBLIC_API_URL
      value: https://options-trading-backend.onrender.com
```

**Key Changes:**
- `buildCommand`: Uses `npm ci` instead of `npm install`
- `startCommand`: Explicitly binds to Render's `$PORT` and `0.0.0.0` hostname
- Removed redundant environment variables

### 2. `frontend/next.config.js`
No changes needed - kept original rewrites configuration for API proxying.

## Deployment Steps

### Step 1: Commit Changes
```bash
git add render.yaml frontend/next.config.js
git commit -m "Fix: Render frontend deployment configuration"
git push origin main
```

### Step 2: Trigger Render Deployment
1. Go to your Render dashboard
2. Navigate to the `options-trading-frontend` service
3. Click **"Manual Deploy"** → **"Clear build cache & deploy"**

### Step 3: Monitor Deployment
Watch the build logs for:
- ✅ `cd frontend && npm ci && npm run build` completing
- ✅ Next.js build succeeding
- ✅ Server starting with `npm start -- -p $PORT -H 0.0.0.0`
- ✅ Health checks passing

### Step 4: Verify Frontend
1. Open your frontend URL: `https://options-trading-frontend.onrender.com`
2. Check browser console for errors
3. Verify API calls reach backend

## Common Issues & Solutions

### Issue: "Port already in use"
**Solution**: The start command now properly uses Render's `$PORT` variable

### Issue: "Cannot find module" errors
**Solution**: `npm ci` ensures clean install from `package-lock.json`

### Issue: "Connection refused" when calling API
**Solution**: 
- Verify backend is running: `https://options-trading-backend.onrender.com`
- Check `NEXT_PUBLIC_API_URL` environment variable in Render dashboard
- Ensure CORS is configured in backend

### Issue: Build succeeds but site won't load
**Checklist**:
1. ✅ Start command includes `-H 0.0.0.0` (listens on all interfaces)
2. ✅ Start command includes `-p $PORT` (uses Render's port)
3. ✅ `NODE_ENV=production` is set
4. ✅ Health check path is `/` (default)

## Testing Locally

Test the production build locally before deploying:

```bash
cd frontend
npm ci
npm run build
PORT=3000 npm start -- -p $PORT -H 0.0.0.0
```

Visit `http://localhost:3000` to verify.

## Render-Specific Configuration

### Why `npm start -- -p $PORT -H 0.0.0.0`?
- `npm start` runs Next.js production server
- `-- -p $PORT` passes Render's dynamic port to Next.js
- `-H 0.0.0.0` binds to all network interfaces (required for Render)

### Why `npm ci` instead of `npm install`?
- `npm ci` is faster and more reliable for CI/CD
- Installs exact versions from `package-lock.json`
- Removes `node_modules` before installing (clean slate)

## Next Steps After Deployment

1. **Set up custom domain** (if needed)
2. **Configure environment variables** for production API keys
3. **Enable auto-deploy** from GitHub
4. **Set up monitoring** with Render's built-in tools

## Troubleshooting Commands

If deployment fails, check logs:
```bash
# View build logs
render logs --service options-trading-frontend --type build

# View runtime logs
render logs --service options-trading-frontend --type service
```

## Support
- Render Docs: https://render.com/docs
- Next.js Deployment: https://nextjs.org/docs/deployment
