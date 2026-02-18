# MyDailyTradingSignals - DigitalOcean Production Deployment Guide

## 🚀 Quick Start (5 minutes)

### Prerequisites
- DigitalOcean Account (https://digitalocean.com)
- Zerodha API Credentials (API Key, Secret, Access Token)
- Domain name (recommended) or use DigitalOcean's default domain

---

## 📋 PART 1: Prepare DigitalOcean Environment

### Step 1: Create a Droplet
```bash
# Specifications
- Image: Ubuntu 22.04 LTS
- Plan: Standard > $6/month (2GB RAM, 1 vCPU)
- Add: 50GB SSD
- Region: Bangalore (for low latency to Zerodha)
- Authentication: SSH Key (recommended)
```

### Step 2: Create App Platform
Alternative to Droplet (easier deployment):
```bash
# Create New App
- Source: GitHub Connect
- Repository: Your GitHub project
- Build Command: npm run build
- Run Command: npm start
```

---

## 🔐 Step 3: Configure Environment Variables

### Backend (.env)
```bash
# === ZERODHA API - LIVE DATA ONLY ===
ZERODHA_API_KEY=your_live_api_key
ZERODHA_API_SECRET=your_live_api_secret
ZERODHA_ACCESS_TOKEN=your_live_access_token  # Update daily at 9:10 AM

# === REDIS CACHE ===
REDIS_URL=redis://127.0.0.1:6379
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

# === DATABASE (if using PostgreSQL) ===
DATABASE_URL=postgresql://user:password@host:5432/trading_signals
DB_HOST=localhost
DB_PORT=5432
DB_NAME=trading_signals
DB_USER=postgres
DB_PASSWORD=secure_password

# === SERVER ===
PORT=8000
PYTHONUNBUFFERED=1
ENVIRONMENT=production

# === JWT ===
JWT_SECRET=your_super_secure_jwt_secret_key_min_32_chars

# === MARKET HOURS (IST) ===
MARKET_OPEN=09:15
MARKET_CLOSE=15:30
MARKET_TIMEZONE=Asia/Kolkata

# === FEATURES ===
ENABLE_WEBSOCKET=true
ENABLE_SMART_CACHE=true
ENABLE_BACKUP_CACHE=true
```

### Frontend (.env.local)
```bash
# === API & WEBSOCKET ===
NEXT_PUBLIC_API_URL=https://your-domain.com/api
NEXT_PUBLIC_WS_URL=wss://your-domain.com/ws

# === MARKET SYMBOLS ===
NEXT_PUBLIC_MARKET_SYMBOLS=NIFTY,BANKNIFTY,SENSEX

# === DISPLAY ===
NEXT_PUBLIC_REFRESH_INTERVAL=5000  # 5 seconds
NEXT_PUBLIC_SHOW_DEBUG=false       # Disable debug logs in production
```

---

## 📦 PART 2: Deploy Backend (Python FastAPI)

### Step 1: SSH into Droplet
```bash
ssh root@your_droplet_ip
```

### Step 2: Install Prerequisites
```bash
# System updates
apt update && apt upgrade -y

# Python & pip
apt install -y python3.11 python3.11-venv pip3 git

# Redis - for caching
apt install -y redis-server

# Supervisor - for process management
apt install -y supervisor

# Nginx - reverse proxy
apt install -y nginx

# Start Redis
systemctl start redis-server
systemctl enable redis-server
```

### Step 3: Clone & Setup Backend
```bash
cd /var/www
git clone https://github.com/yourname/mytradingSignal.git
cd mytradingSignal/backend

# Create virtual environment
python3.11 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Verify installation
python -m pytest tests/  # if you have tests
```

### Step 4: Configure Supervisor (Process Manager)
Create `/etc/supervisor/conf.d/trading-backend.conf`:

```ini
[program:trading-backend]
directory=/var/www/mytradingSignal/backend
command=/var/www/mytradingSignal/backend/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --workers 4 --reload-delay 10
user=www-data
autostart=true
autorestart=true
stderr_logfile=/var/log/trading-backend.err.log
stdout_logfile=/var/log/trading-backend.out.log
environment=PATH="/var/www/mytradingSignal/backend/venv/bin",HOME="/var/www/mytradingSignal"
```

### Step 5: Configure Nginx (Reverse Proxy)
Create `/etc/nginx/sites-available/trading-signals`:

```nginx
upstream trading_backend {
    server 127.0.0.1:8000;
}

server {
    listen 80;
    server_name your-domain.com;

    # Redirect HTTP → HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL Certificate (use Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # API Proxy
    location /api/ {
        proxy_pass http://trading_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_redirect off;
    }

    # WebSocket Proxy
    location /ws/ {
        proxy_pass http://trading_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Health Check
    location /health {
        proxy_pass http://trading_backend;
    }
}
```

### Step 6: Enable & Start Services
```bash
# Enable Nginx site
ln -s /etc/nginx/sites-available/trading-signals /etc/nginx/sites-enabled/
nginx -t  # Test config
systemctl reload nginx

# Start Supervisor
systemctl start supervisor
systemctl enable supervisor
supervisorctl update  # Load new config
supervisorctl status  # Verify running

# Verify logs
tail -f /var/log/trading-backend.out.log
```

---

## 🎨 PART 3: Deploy Frontend (Next.js)

### Step 1: Clone & Setup Frontend
```bash
cd /var/www/mytradingSignal/frontend

# Install dependencies
npm install

# Build for production
npm run build

# Verify build
ls -la .next/
```

### Step 2: Configure PM2 (Node Process Manager)
```bash
# Install PM2 globally
npm install -g pm2

# Create PM2 ecosystem config
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'trading-frontend',
    script: 'node_modules/next/dist/bin/next',
    args: 'start --port 3000',
    cwd: '/var/www/mytradingSignal/frontend',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      NEXT_PUBLIC_API_URL: 'https://your-domain.com/api',
      NEXT_PUBLIC_WS_URL: 'wss://your-domain.com/ws',
      NEXT_PUBLIC_MARKET_SYMBOLS: 'NIFTY,BANKNIFTY,SENSEX'
    },
    error_file: '/var/log/next-err.log',
    out_file: '/var/log/next-out.log',
    log_file: '/var/log/next-combined.log',
    merge_logs: true,
  }]
};
EOF

# Start with PM2
pm2 start ecosystem.config.js

# Make PM2 startup persistent
pm2 startup
pm2 save
```

### Step 3: Update Nginx for Frontend
Add this to your Nginx config:

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # ... SSL config from above ...

    # Frontend (Next.js)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Static assets - cache for 1 year
    location /_next/static/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_cache_valid 200 1y;
        add_header Cache-Control "immutable";
    }
}
```

---

## 🔒 PART 4: SSL Certificate (Let's Encrypt)

```bash
# Install Certbot
apt install -y certbot python3-certbot-nginx

# Get certificate
certbot certonly --nginx -d your-domain.com

# Auto-renewal setup (already included with Certbot)
systemctl enable certbot.timer
systemctl start certbot.timer

# Check renewal
certbot renew --dry-run
```

---

## 📊 PART 5: Monitoring & Logs

### Start Logs
```bash
# Backend logs
tail -f /var/log/trading-backend.out.log
tail -f /var/log/trading-backend.err.log

# Frontend logs
tail -f /var/log/next-out.log

# Nginx logs
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log

# Redis logs
redis-cli INFO stats
```

### Health Checks
```bash
# Backend health
curl https://your-domain.com/api/health

# Frontend status
curl https://your-domain.com/

# WebSocket
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
  https://your-domain.com/ws/market
```

---

## 🚨 PART 6: Daily Maintenance (9:00 AM IST)

### Token Refresh (IMPORTANT - Every Day!)
The Zerodha access token expires daily. Update it each morning:

```bash
# SSH into server
ssh root@your_droplet_ip

# Update .env with new token
nano backend/.env

# Change this line:
# ZERODHA_ACCESS_TOKEN=new_token_from_zerodha_app

# Restart backend
supervisorctl restart trading-backend

# Verify logs
tail -f /var/log/trading-backend.out.log
```

Or automate with a cron job:
```bash
# Create token refresh script
cat > /var/www/mytradingSignal/refresh_token.sh << 'EOF'
#!/bin/bash
# This script needs manual intervention - Zerodha API requires manual token generation
# Run this before market open (09:00 AM IST)
cd /var/www/mytradingSignal/backend

# Get new token (you need to implement this with your method)
# Then update .env and restart

supervisorctl restart trading-backend
EOF

chmod +x /var/www/mytradingSignal/refresh_token.sh

# Schedule cron (Mon-Fri 09:00 AM IST)
crontab -e
# Add: 0 9 * * 1-5 /var/www/mytradingSignal/refresh_token.sh
```

---

## 🛡️ PART 7: Firewall Setup

```bash
# Enable UFW (uncomplicated firewall)
apt install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw enable

# Verify
ufw status
```

---

## 🔄 PART 8: Backup & Disaster Recovery

```bash
# Backup Redis data (weekly)
# Add to crontab:
# 0 2 * * 0 /var/lib/redis/dump.rdb -> /backups/redis_$(date +\%Y\%m\%d).rdb

# Backup PostgreSQL (weekly)
# pg_dump trading_signals > /backups/db_$(date +\%Y\%m\%d).sql

# Backup config files
tar -czf /backups/config_$(date +\%Y\%m\%d).tar.gz \
  /etc/nginx/sites-available/trading-signals \
  /etc/supervisor/conf.d/trading-backend.conf \
  /var/www/mytradingSignal/backend/.env
```

---

## ✅ Deployment Checklist

- [ ] Zerodha API credentials ready
- [ ] Domain configured with DNS
- [ ] Droplet created and initialized
- [ ] SSH key configured
- [ ] Backend deployed and running
- [ ] Frontend deployed and running
- [ ] SSL certificate installed
- [ ] Health checks passing
- [ ] Logs monitoring setup
- [ ] Daily token refresh automated (or scheduled)
- [ ] Backups configured
- [ ] Firewall rules configured
- [ ] Monitoring/alerting setup
- [ ] Test market data flowing (use restricted hours before 9:15 AM)

---

## 🐛 Troubleshooting

### Backend Not Starting
```bash
supervisorctl status
supervisorctl tail trading-backend
# Check .env file for typos
#Check Redis is running: redis-cli ping
```

### No Market Data
```bash
# Check Zerodha access token is fresh
# Verify token hasn't expired
curl https://your-domain.com/api/health

# Check Redis connection
redis-cli PING  # Should return "PONG"

# Check market status
curl https://your-domain.com/api/analyze/all
```

### WebSocket Connection Failed
```bash
# Check WS proxy in Nginx config
nginx -t
systemctl reload nginx
# Verify 'Upgrade' and 'Connection' headers set correctly
```

### High CPU/Memory Usage
```bash
# Reduce Uvicorn workers
# Edit supervisor config: --workers 2 (was 4)
supervisorctl restart trading-backend

# Check for infinite loops in analysis
tail -f /var/log/trading-backend.err.log
```

---

## 🔗 Resources

- [DigitalOcean Docs](https://docs.digitalocean.com)
- [Nginx Reverse Proxy](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [Let's Encrypt](https://letsencrypt.org)
- [Uvicorn Deployment](https://www.uvicorn.org/deployment/)
- [Next.js Production](https://nextjs.org/docs/going-to-production)

---

**Last Updated:** 2024-02-18
**For:** MyDailyTradingSignals v1.0 (14 Signals • All Sections Integrated)
**With:** Live Data Only • No Test/Dummy Data • DigitalOcean Production Ready
