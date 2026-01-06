# 🚀 PRODUCTION DEPLOYMENT CHECKLIST

## ✅ PRE-DEPLOYMENT CHECKLIST

### 1. CODE CLEANUP ✅
- [x] Removed test code blocks (market_session_controller.py, feed_watchdog.py)
- [x] No syntax errors found
- [x] No hardcoded credentials (all using environment variables)
- [x] Localhost URLs use fallbacks (will use .env in production)

### 2. ENVIRONMENT CONFIGURATION ⚠️  
- [ ] Copy `.env.production.example` to `.env`
- [ ] Set `ZERODHA_API_KEY` and `ZERODHA_API_SECRET`
- [ ] Set `REDIRECT_URL` (must match Zerodha app redirect URL)
- [ ] Set `FRONTEND_URL` (your domain)
- [ ] Set `NEXT_PUBLIC_API_URL` (your API domain)
- [ ] Set `NEXT_PUBLIC_WS_URL` (your WebSocket URL with wss://)
- [ ] Generate `JWT_SECRET` with: `openssl rand -hex 32`
- [ ] Set `CORS_ORIGINS` (your domain)
- [ ] Optional: Set `NEWS_API_KEY` for news detection

### 3. ZERODHA APP CONFIGURATION ⚠️
- [ ] Login to [Zerodha Developers Console](https://developers.kite.trade/)
- [ ] Update Redirect URL to match `REDIRECT_URL` in .env
- [ ] Ensure app status is "Active"
- [ ] Test login flow with production URL

### 4. DOCKER DEPLOYMENT READY ✅
- [x] docker-compose.yml uses environment variables
- [x] Redis persistence enabled
- [x] Health checks configured
- [x] Auto-restart enabled

### 5. SECURITY CHECKLIST ⚠️
- [ ] JWT_SECRET is strong (32+ chars random)
- [ ] CORS_ORIGINS restricted to your domain
- [ ] No .env file committed to git (check .gitignore)
- [ ] SSL/TLS certificates configured (use Let's Encrypt)
- [ ] Firewall rules configured (ports 80, 443 only)

---

## 🌐 DIGITAL OCEAN DEPLOYMENT

### Step 1: Create Droplet
```bash
# Recommended specs for production:
# - Droplet: Basic Droplet
# - Size: $12/month (2 GB RAM, 1 vCPU, 50 GB SSD)
# - OS: Ubuntu 22.04 LTS
# - Location: Bangalore/Mumbai (lowest latency for Indian markets)
```

### Step 2: Initial Server Setup
```bash
# SSH into your droplet
ssh root@your_droplet_ip

# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
apt install docker-compose -y

# Create app directory
mkdir -p /opt/mytradingsignal
cd /opt/mytradingsignal
```

### Step 3: Deploy Application
```bash
# Clone your repository
git clone https://github.com/yourusername/mytradingSignal.git .

# Copy production environment file
cp .env.production.example .env

# Edit environment variables
nano .env
# (Set all required values from checklist above)

# Build and start containers
docker-compose up -d --build

# Check logs
docker-compose logs -f
```

### Step 4: Configure Nginx Reverse Proxy
```bash
# Install Nginx
apt install nginx -y

# Create Nginx config
nano /etc/nginx/sites-available/trading
```

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    # Frontend
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket
    location /ws {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }
}
```

```bash
# Enable site
ln -s /etc/nginx/sites-available/trading /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

### Step 5: Setup SSL with Let's Encrypt
```bash
# Install Certbot
apt install certbot python3-certbot-nginx -y

# Get SSL certificate
certbot --nginx -d yourdomain.com

# Test auto-renewal
certbot renew --dry-run
```

### Step 6: Setup Token Auto-Refresh (IMPORTANT)
```bash
# Copy token refresh script
cp quick_token_fix.py /opt/mytradingsignal/

# Create cron job for daily token refresh
crontab -e

# Add this line (runs at 8:30 AM IST daily, before market opens):
30 3 * * * cd /opt/mytradingsignal && /usr/bin/python3 quick_token_fix.py >> /var/log/token_refresh.log 2>&1
```

---

## 📊 POST-DEPLOYMENT VERIFICATION

### 1. Health Checks
```bash
# Check all containers running
docker-compose ps

# Check backend health
curl http://localhost:8000/health

# Check frontend
curl http://localhost:3000

# Check Redis
docker exec trading-redis redis-cli ping
```

### 2. WebSocket Connection
```bash
# Test WebSocket from another terminal
wscat -c ws://localhost:8000/ws/market
```

### 3. Test Authentication Flow
- Visit: https://yourdomain.com
- Click "Login with Zerodha"
- Complete authentication
- Verify live data appears

### 4. Monitor Logs
```bash
# Backend logs
docker-compose logs -f backend

# Frontend logs
docker-compose logs -f frontend

# All logs
docker-compose logs -f
```

---

## 🔧 TROUBLESHOOTING

### Issue: WebSocket 403 Forbidden
**Solution:** Token expired. Run token refresh:
```bash
cd /opt/mytradingsignal
python3 quick_token_fix.py
```

### Issue: CORS Errors
**Solution:** Check `CORS_ORIGINS` in .env matches your domain

### Issue: No Market Data
**Causes:**
1. Market closed (check time: 9:15 AM - 3:30 PM IST)
2. Token expired (run quick_token_fix.py)
3. Zerodha API rate limit (wait 1 minute)

### Issue: Container Won't Start
```bash
# Check logs
docker-compose logs backend

# Restart containers
docker-compose down
docker-compose up -d
```

---

## 📈 PERFORMANCE MONITORING

### Setup Monitoring (Optional)
```bash
# Install monitoring tools
docker run -d --name=cadvisor \
  -p 8080:8080 \
  -v /:/rootfs:ro \
  -v /var/run:/var/run:ro \
  -v /sys:/sys:ro \
  -v /var/lib/docker/:/var/lib/docker:ro \
  google/cadvisor:latest
```

### Monitor Resources
```bash
# Container stats
docker stats

# Disk usage
df -h

# Memory usage
free -h
```

---

## 🔄 UPDATES & MAINTENANCE

### Update Application
```bash
cd /opt/mytradingsignal
git pull
docker-compose down
docker-compose up -d --build
```

### Backup Redis Data
```bash
# Backup
docker exec trading-redis redis-cli BGSAVE
docker cp trading-redis:/data/dump.rdb ./backup-$(date +%Y%m%d).rdb

# Restore
docker cp backup-20260106.rdb trading-redis:/data/dump.rdb
docker-compose restart redis
```

### View Application Logs
```bash
# Last 100 lines
docker-compose logs --tail=100

# Follow live logs
docker-compose logs -f

# Specific service
docker-compose logs -f backend
```

---

## ⚠️ IMPORTANT NOTES

### Daily Token Refresh
Zerodha access tokens expire **every 24 hours**. You MUST:
1. Setup cron job for automatic refresh (recommended)
2. OR manually run `quick_token_fix.py` daily before market opens

### Market Hours
- **Pre-open:** 9:00 AM - 9:15 AM IST
- **Live Trading:** 9:15 AM - 3:30 PM IST
- **After-hours:** Shows last traded data

### Rate Limits
- **Zerodha API:** 3 requests/second
- **WebSocket:** Real-time (no limit)
- **PCR Data:** Cached for 2 hours

---

## 📞 SUPPORT

### Debug Mode
If issues persist, enable debug logging:
```bash
# In docker-compose.yml, add:
environment:
  - LOG_LEVEL=DEBUG

# Restart
docker-compose restart
```

### Check System Status
```bash
# All services
systemctl status nginx
systemctl status docker

# Application
docker-compose ps
docker-compose logs --tail=50
```

---

## ✅ PRODUCTION READY STATUS

**Current Status:** 🟢 PRODUCTION READY

**Completed:**
- ✅ All syntax errors fixed
- ✅ Environment variables configured
- ✅ Docker setup ready
- ✅ Test code removed
- ✅ Security measures in place
- ✅ Deployment scripts ready

**Action Required:**
- ⚠️ Set production environment variables in `.env`
- ⚠️ Configure Zerodha redirect URL
- ⚠️ Deploy to Digital Ocean
- ⚠️ Setup SSL certificates
- ⚠️ Configure daily token refresh

**Estimated Deployment Time:** 30-45 minutes

---

**Last Updated:** January 6, 2026
**Version:** 1.0.0 Production Ready
