# 🚀 Production Deployment Guide - Digital Ocean

## ✅ Pre-Deployment Checklist

### Code Cleanup (COMPLETED)
- ✅ Removed test/debug files (check_sensex.py, fix_sensex_token.py)
- ✅ Removed debug print statements (instant_analysis.py)
- ✅ Removed console.log statements from frontend (useAnalysis.ts, useMarketSocket.ts)
- ✅ Verified debug=False in config.py
- ✅ All hardcoded URLs use environment variables with fallbacks

### Production-Ready Features
- ✅ Auto-futures token updater (runs on startup, checks monthly expiry)
- ✅ Redis caching (5s TTL for market data, 30s for PCR)
- ✅ WebSocket reconnection logic
- ✅ Token watcher for .env changes
- ✅ CORS configuration via environment
- ✅ JWT authentication with refresh tokens
- ✅ Error handling without sensitive data exposure

---

## 📋 Required Environment Variables

### Backend (.env)
```bash
# ==================== ZERODHA API ====================
ZERODHA_API_KEY=your_api_key_here
ZERODHA_API_SECRET=your_api_secret_here
ZERODHA_ACCESS_TOKEN=your_access_token_here

# ==================== OAUTH & REDIRECT ====================
REDIRECT_URL=https://yourdomain.com/api/auth/callback
FRONTEND_URL=https://yourdomain.com

# ==================== REDIS ====================
REDIS_URL=redis://localhost:6379
REDIS_DB=0
# REDIS_PASSWORD=your_redis_password  # If using password

# ==================== JWT ====================
JWT_SECRET=generate_strong_secret_here_use_openssl_rand_base64_32
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7

# ==================== SERVER ====================
HOST=0.0.0.0
PORT=8000
DEBUG=false
CORS_ORIGINS=https://yourdomain.com

# ==================== FUTURES TOKENS (Auto-updated) ====================
NIFTY_FUT_TOKEN=12683010
BANKNIFTY_FUT_TOKEN=12674050
SENSEX_FUT_TOKEN=292786437

# ==================== INSTRUMENT TOKENS ====================
NIFTY_TOKEN=256265
BANKNIFTY_TOKEN=260105
SENSEX_TOKEN=265
FINNIFTY_TOKEN=257801
MIDCPNIFTY_TOKEN=288009
```

### Frontend (.env.local)
```bash
NEXT_PUBLIC_API_URL=https://yourdomain.com
NEXT_PUBLIC_WS_URL=wss://yourdomain.com/ws/market
```

---

## 🌐 Digital Ocean Setup

### 1. Create Droplet
```bash
# Recommended: Ubuntu 22.04 LTS
# Size: Basic Plan - 2GB RAM / 2 vCPUs ($18/month)
# Region: Choose closest to Mumbai (for Zerodha API latency)
```

### 2. SSH into Server
```bash
ssh root@your_droplet_ip
```

### 3. Install Dependencies
```bash
# Update system
apt update && apt upgrade -y

# Install Python 3.11+
apt install -y python3.11 python3.11-venv python3-pip

# Install Node.js 18+ (for frontend)
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# Install Redis
apt install -y redis-server
systemctl enable redis-server
systemctl start redis-server

# Install Nginx
apt install -y nginx
systemctl enable nginx

# Install Certbot (for SSL)
apt install -y certbot python3-certbot-nginx

# Install Git
apt install -y git
```

### 4. Clone Repository
```bash
cd /opt
git clone https://github.com/yourusername/mytradingSignal.git
cd mytradingSignal
```

---

## 🔧 Backend Setup

### 1. Create Virtual Environment
```bash
cd /opt/mytradingSignal/backend
python3.11 -m venv venv
source venv/bin/activate
```

### 2. Install Python Packages
```bash
pip install --upgrade pip
pip install -r requirements.txt
```

### 3. Create .env File
```bash
nano .env
# Paste environment variables from above
# Save: Ctrl+X, Y, Enter
```

### 4. Generate JWT Secret
```bash
openssl rand -base64 32
# Copy output to JWT_SECRET in .env
```

### 5. Test Backend
```bash
python main.py
# Should see: ⚡ FastAPI: Starting up (optimized for speed)...
# Press Ctrl+C to stop
```

### 6. Create Systemd Service
```bash
nano /etc/systemd/system/trading-backend.service
```

Paste:
```ini
[Unit]
Description=MyDailyTradingSignals Backend
After=network.target redis-server.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/mytradingSignal/backend
Environment="PATH=/opt/mytradingSignal/backend/venv/bin"
ExecStart=/opt/mytradingSignal/backend/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
systemctl daemon-reload
systemctl enable trading-backend
systemctl start trading-backend
systemctl status trading-backend
```

---

## 🎨 Frontend Setup

### 1. Install Dependencies
```bash
cd /opt/mytradingSignal/frontend
npm install
```

### 2. Create .env.local
```bash
nano .env.local
```

Paste:
```bash
NEXT_PUBLIC_API_URL=https://yourdomain.com
NEXT_PUBLIC_WS_URL=wss://yourdomain.com/ws/market
```

### 3. Build Frontend
```bash
npm run build
```

### 4. Create Systemd Service
```bash
nano /etc/systemd/system/trading-frontend.service
```

Paste:
```ini
[Unit]
Description=MyDailyTradingSignals Frontend
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/mytradingSignal/frontend
Environment="NODE_ENV=production"
Environment="PORT=3000"
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
systemctl daemon-reload
systemctl enable trading-frontend
systemctl start trading-frontend
systemctl status trading-frontend
```

---

## 🔒 Nginx Configuration

### 1. Create Nginx Config
```bash
nano /etc/nginx/sites-available/trading
```

Paste:
```nginx
# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

# HTTPS Server
server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    # SSL certificates (will be added by certbot)
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    
    # SSL settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Frontend (Next.js)
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Backend API
    location /api/ {
        proxy_pass http://localhost:8000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket
    location /ws/ {
        proxy_pass http://localhost:8000/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    # Health check
    location /health {
        proxy_pass http://localhost:8000/health;
        access_log off;
    }
}
```

### 2. Enable Site
```bash
ln -s /etc/nginx/sites-available/trading /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

### 3. Setup SSL Certificate
```bash
certbot --nginx -d yourdomain.com -d www.yourdomain.com
# Follow prompts, select option 2 (redirect HTTP to HTTPS)
```

### 4. Auto-Renewal
```bash
# Test renewal
certbot renew --dry-run

# Cron job is auto-created at /etc/cron.d/certbot
```

---

## 🔐 Zerodha OAuth Setup

### 1. Update Redirect URL in Zerodha Developer Console
- Go to: https://developers.kite.trade/apps
- Select your app
- Set Redirect URL: `https://yourdomain.com/api/auth/callback`
- Save changes

### 2. Update Backend .env
```bash
nano /opt/mytradingSignal/backend/.env
```
Update:
```bash
REDIRECT_URL=https://yourdomain.com/api/auth/callback
FRONTEND_URL=https://yourdomain.com
```

### 3. Restart Backend
```bash
systemctl restart trading-backend
```

---

## 🚀 First-Time Login

### 1. Access Your Domain
```
https://yourdomain.com
```

### 2. Login with Zerodha
- Click "Login with Zerodha"
- Authorize the app
- You'll be redirected back with access token

### 3. Token Auto-Refresh
- Backend automatically checks for token expiry
- Auto-updates futures tokens monthly
- Token watcher detects .env changes

---

## 📊 Monitoring & Logs

### Backend Logs
```bash
journalctl -u trading-backend -f
```

### Frontend Logs
```bash
journalctl -u trading-frontend -f
```

### Nginx Logs
```bash
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

### Redis Status
```bash
redis-cli ping
# Should return: PONG
```

### Service Status
```bash
systemctl status trading-backend
systemctl status trading-frontend
systemctl status nginx
systemctl status redis-server
```

---

## 🔧 Maintenance

### Update Code
```bash
cd /opt/mytradingSignal
git pull origin main

# Update backend
cd backend
source venv/bin/activate
pip install -r requirements.txt
systemctl restart trading-backend

# Update frontend
cd ../frontend
npm install
npm run build
systemctl restart trading-frontend
```

### Update Futures Tokens (Auto, but manual if needed)
```bash
cd /opt/mytradingSignal/backend
source venv/bin/activate
python scripts/find_futures_tokens.py
# Copy tokens to .env
systemctl restart trading-backend
```

### Backup .env Files
```bash
cp /opt/mytradingSignal/backend/.env /root/backups/backend-env-$(date +%Y%m%d).bak
cp /opt/mytradingSignal/frontend/.env.local /root/backups/frontend-env-$(date +%Y%m%d).bak
```

---

## 🛡️ Security Checklist

- ✅ Change JWT_SECRET to strong random value
- ✅ Use HTTPS only (SSL certificate installed)
- ✅ Set CORS_ORIGINS to your domain only (not *)
- ✅ Redis password protection (optional but recommended)
- ✅ Firewall: Allow only 80, 443, 22
- ✅ Disable password SSH, use keys only
- ✅ Regular security updates: `apt update && apt upgrade`
- ✅ Never commit .env files to git
- ✅ Use strong Zerodha API credentials
- ✅ Monitor logs for suspicious activity

---

## 🔥 Firewall Setup

```bash
# Enable UFW
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw enable

# Verify
ufw status
```

---

## 📈 Performance Optimization

### Redis Persistence (Optional)
```bash
nano /etc/redis/redis.conf
```
Add:
```
save 900 1
save 300 10
save 60 10000
```

### Nginx Caching (Optional)
Add to nginx config:
```nginx
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=api_cache:10m max_size=100m inactive=60m;
```

### PM2 for Frontend (Alternative to systemd)
```bash
npm install -g pm2
cd /opt/mytradingSignal/frontend
pm2 start npm --name "trading-frontend" -- start
pm2 startup
pm2 save
```

---

## 🆘 Troubleshooting

### Backend Not Starting
```bash
# Check logs
journalctl -u trading-backend -n 50

# Common issues:
# 1. Redis not running: systemctl start redis-server
# 2. Port 8000 in use: lsof -i :8000
# 3. Missing .env: Check /opt/mytradingSignal/backend/.env exists
```

### Frontend 502 Bad Gateway
```bash
# Check frontend status
systemctl status trading-frontend

# Rebuild frontend
cd /opt/mytradingSignal/frontend
npm run build
systemctl restart trading-frontend
```

### WebSocket Not Connecting
```bash
# Check nginx WebSocket config
nginx -t

# Test WebSocket manually
wscat -c wss://yourdomain.com/ws/market
```

### SSL Certificate Issues
```bash
# Renew certificate
certbot renew --force-renewal
systemctl reload nginx
```

### Futures Token Expired
```bash
# Auto-updater should handle this, but manual check:
cd /opt/mytradingSignal/backend
source venv/bin/activate
python scripts/find_futures_tokens.py

# Update .env and restart
nano .env
systemctl restart trading-backend
```

---

## 📞 Support

- GitHub Issues: https://github.com/yourusername/mytradingSignal/issues
- Documentation: [README.md](README.md)
- Project Structure: [docs/STRUCTURE.md](docs/STRUCTURE.md)

---

## 🎉 Deployment Complete!

Your MyDailyTradingSignals app is now live at: **https://yourdomain.com**

Features enabled:
- ✅ Real-time market data (WebSocket)
- ✅ Instant Signal analysis
- ✅ PCR Analysis
- ✅ Volume Pulse
- ✅ Trend Base (fixed for intraday)
- ✅ Zone Control
- ✅ Auto-futures token updates
- ✅ Zerodha OAuth
- ✅ JWT authentication
- ✅ Redis caching
- ✅ SSL encryption

Happy Trading! 🚀📈
