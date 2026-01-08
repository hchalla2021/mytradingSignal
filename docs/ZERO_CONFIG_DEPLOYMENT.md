# 🚀 ZERO-CONFIG DEPLOYMENT GUIDE

## ✅ Solution Summary

Your application now **automatically detects** whether it's running locally or in production.  
**NO manual .env changes needed** for deployment!

## 🎯 How It Works

### Backend Auto-Detection
- Detects environment based on hostname
- Automatically uses correct URLs:
  - **Local**: `http://127.0.0.1:8000` ← When running on your computer
  - **Production**: `https://mydailytradesignals.com` ← When deployed to Digital Ocean

### Frontend Auto-Detection  
- Detects environment based on `window.location.hostname`
- Automatically connects to correct backend:
  - **Local**: `ws://127.0.0.1:8000/ws/market`
  - **Production**: `wss://mydailytradesignals.com/ws/market`

---

## 📋 ONE-TIME SETUP (Already Done)

### Backend `.env` File
```env
# Both URLs configured - auto-selected based on environment
LOCAL_REDIRECT_URL=http://127.0.0.1:8000/api/auth/callback
LOCAL_FRONTEND_URL=http://localhost:3000

PRODUCTION_REDIRECT_URL=https://mydailytradesignals.com/api/auth/callback
PRODUCTION_FRONTEND_URL=https://mydailytradesignals.com

ENVIRONMENT=auto  # Auto-detects environment
```

### Frontend `.env.local` File
```env
# Both URLs configured - auto-selected based on hostname
NEXT_PUBLIC_LOCAL_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_LOCAL_WS_URL=ws://127.0.0.1:8000/ws/market

NEXT_PUBLIC_PRODUCTION_API_URL=https://mydailytradesignals.com
NEXT_PUBLIC_PRODUCTION_WS_URL=wss://mydailytradesignals.com/ws/market

NEXT_PUBLIC_ENVIRONMENT=auto  # Auto-detects environment
```

---

## 🏗️ LOCAL DEVELOPMENT (Your Computer)

### Start Backend
```powershell
cd backend
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

### Start Frontend
```powershell
cd frontend
npm run dev
```

### Verify
- Open: http://localhost:3000
- Backend console shows: `🌍 Environment detected: LOCAL`
- Frontend console shows: `📡 WebSocket connecting to: ws://127.0.0.1:8000/ws/market (Local Development)`

---

## 🚀 DIGITAL OCEAN DEPLOYMENT

### Method 1: Git Push (Recommended)

```bash
# 1. Commit your changes
git add .
git commit -m "Deploy with auto-environment detection"

# 2. Push to your repo
git push origin main

# 3. SSH to Digital Ocean droplet
ssh root@your-droplet-ip

# 4. Pull latest code
cd /var/www/mytradingSignal
git pull origin main

# 5. Restart services
systemctl restart mytrading-backend
systemctl restart mytrading-frontend

# Done! Environment is auto-detected as PRODUCTION
```

### Method 2: Fresh Deployment (Clean Start)

```bash
# SSH to Digital Ocean
ssh root@your-droplet-ip

# Remove old deployment
rm -rf /var/www/mytradingSignal

# Clone fresh
cd /var/www
git clone https://github.com/YOUR_USERNAME/mytradingSignal.git

# Backend setup
cd mytradingSignal/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Copy .env from backup or create new
cp /root/backup/.env .env
# OR create manually with production token

# Frontend setup
cd ../frontend
npm install
npm run build

# Start services
systemctl restart mytrading-backend
systemctl restart mytrading-frontend
```

---

## 🔍 Verification

### Check Backend Environment
```bash
# SSH to server
ssh root@your-droplet-ip

# Check backend logs
journalctl -u mytrading-backend -n 50

# Should see: "🌍 Environment detected: PRODUCTION"
# Should see: "→ Redirect URL: https://mydailytradesignals.com/api/auth/callback"
```

### Check Frontend Environment
- Open: https://mydailytradesignals.com
- Press F12 (Developer Console)
- Look for: `📡 WebSocket connecting to: wss://mydailytradesignals.com/ws/market (Production)`

---

## 🛠️ Systemd Service Files

### Backend Service: `/etc/systemd/system/mytrading-backend.service`
```ini
[Unit]
Description=MyDailyTradingSignals Backend
After=network.target redis.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/mytradingSignal/backend
Environment="PATH=/var/www/mytradingSignal/backend/venv/bin"
ExecStart=/var/www/mytradingSignal/backend/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### Frontend Service: `/etc/systemd/system/mytrading-frontend.service`
```ini
[Unit]
Description=MyDailyTradingSignals Frontend
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/mytradingSignal/frontend
Environment="NODE_ENV=production"
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### Enable & Start
```bash
systemctl enable mytrading-backend
systemctl enable mytrading-frontend
systemctl start mytrading-backend
systemctl start mytrading-frontend
```

---

## 🌐 Nginx Configuration

### `/etc/nginx/sites-available/mydailytradesignals.com`
```nginx
# Backend API and WebSocket
server {
    listen 443 ssl http2;
    server_name mydailytradesignals.com;

    ssl_certificate /etc/letsencrypt/live/mydailytradesignals.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mydailytradesignals.com/privkey.pem;

    # API endpoints
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket
    location /ws/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }

    # Frontend
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# HTTP -> HTTPS redirect
server {
    listen 80;
    server_name mydailytradesignals.com;
    return 301 https://$server_name$request_uri;
}
```

### Apply Configuration
```bash
ln -s /etc/nginx/sites-available/mydailytradesignals.com /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

---

## 📱 Mobile & Desktop Support

### Already Configured ✅
- **Responsive Design**: Tailwind CSS breakpoints
- **WebSocket**: Works on all devices
- **HTTPS**: SSL certificate for mobile browser security
- **PWA Ready**: Can be installed as app

### Test on Mobile
1. Open: https://mydailytradesignals.com on phone
2. WebSocket auto-connects to `wss://` (secure)
3. No configuration needed!

---

## 🔧 Troubleshooting

### Issue: "WebSocket connection failed"

**Local Development:**
```powershell
# Check backend running
Test-NetConnection -ComputerName 127.0.0.1 -Port 8000
```

**Production:**
```bash
# Check Nginx WebSocket config
nginx -t

# Check backend running
systemctl status mytrading-backend

# Check WebSocket endpoint
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
  https://mydailytradesignals.com/ws/market
```

### Issue: "Wrong environment detected"

**Force Environment:**
```env
# Backend .env
ENVIRONMENT=production  # or local

# Frontend .env.local
NEXT_PUBLIC_ENVIRONMENT=production  # or local
```

### Issue: "CORS errors on production"

```env
# Backend .env - Update CORS
CORS_ORIGINS=https://mydailytradesignals.com,http://localhost:3000
```

---

## ✅ Deployment Checklist

### Before Deployment
- [ ] Code committed to Git
- [ ] All tests passing locally
- [ ] `.env` files have both LOCAL and PRODUCTION URLs
- [ ] Zerodha access token is current (regenerate if > 24 hours old)

### During Deployment
- [ ] Git pull on server
- [ ] Dependencies installed (`pip install -r requirements.txt`, `npm install`)
- [ ] Services restarted
- [ ] Nginx configuration updated
- [ ] SSL certificate valid

### After Deployment
- [ ] Backend logs show: `Environment detected: PRODUCTION`
- [ ] Frontend connects to: `wss://mydailytradesignals.com/ws/market`
- [ ] PCR values display (within 30 seconds)
- [ ] Test on mobile browser
- [ ] Check WebSocket tab in browser DevTools

---

## 🎉 Summary

### What You Get
✅ **No manual .env changes** - Ever again!  
✅ **Same code** works locally and in production  
✅ **Auto-environment detection** - Smart and reliable  
✅ **One-command deployment** - `git push` and restart services  
✅ **Mobile & Desktop** - Works everywhere  
✅ **WebSocket support** - WSS in production, WS locally  

### Deployment is Now
```bash
# Local -> Production in 3 commands
git push
ssh root@droplet "cd /var/www/mytradingSignal && git pull && systemctl restart mytrading-*"
# Done! 🚀
```

---

## 📞 Support

If issues persist after following this guide:
1. Check backend logs: `journalctl -u mytrading-backend -n 100`
2. Check frontend logs: Browser Console (F12)
3. Verify environment detection: Look for `🌍 Environment detected:` in logs
4. Test locally first, then deploy to production

**The system is now 100% configurable with zero manual changes!** 🎊
