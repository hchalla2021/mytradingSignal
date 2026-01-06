# ========================================
# QUICK DEPLOYMENT TO DIGITAL OCEAN
# Step-by-step guide
# ========================================

## 📋 PREREQUISITES

1. **Digital Ocean Droplet Created**
   - Ubuntu 22.04 LTS
   - 2GB RAM minimum ($12/month)
   - SSH access configured

2. **Domain Name (Optional but Recommended)**
   - Point A record to droplet IP
   - Example: trading.yourdomain.com

3. **Zerodha API Credentials**
   - API Key
   - API Secret
   - Access Token (generate daily)

---

## 🚀 DEPLOYMENT STEPS

### Step 1: SSH into Your Droplet
```bash
ssh root@your_droplet_ip
```

### Step 2: Install Dependencies
```bash
# Update system
apt update && apt upgrade -y

# Install Python 3.11
apt install python3.11 python3.11-venv python3-pip -y

# Install Git
apt install git -y

# Install Nginx (for reverse proxy)
apt install nginx -y
```

### Step 3: Clone Your Repository
```bash
# Create app directory
mkdir -p /opt/mytradingsignal
cd /opt/mytradingsignal

# Clone repository
git clone https://github.com/yourusername/mytradingSignal.git .

# Or upload your local code
# scp -r ./* root@your_droplet_ip:/opt/mytradingsignal/
```

### Step 4: Setup Environment Variables
```bash
# Copy environment template
cp .env.production.example backend/.env

# Edit environment file
nano backend/.env
```

**Fill in these values:**
```bash
ZERODHA_API_KEY=your_api_key_here
ZERODHA_API_SECRET=your_api_secret_here
ZERODHA_ACCESS_TOKEN=will_be_generated_daily

REDIRECT_URL=https://yourdomain.com/api/auth/callback
FRONTEND_URL=https://yourdomain.com
NEXT_PUBLIC_API_URL=https://yourdomain.com
NEXT_PUBLIC_WS_URL=wss://yourdomain.com/ws/market

JWT_SECRET=generate_with_openssl_rand_hex_32
CORS_ORIGINS=https://yourdomain.com

REDIS_URL=redis://localhost:6379
```

Save and exit (Ctrl+X, Y, Enter)

### Step 5: Install Python Dependencies
```bash
cd /opt/mytradingsignal
python3.11 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r backend/requirements.txt
```

### Step 6: Install Redis
```bash
apt install redis-server -y
systemctl enable redis-server
systemctl start redis-server

# Test Redis
redis-cli ping  # Should return: PONG
```

### Step 7: Setup Backend Service (AUTO-START!)
```bash
# Make script executable
chmod +x scripts/setup-production-service.sh

# Run setup script
bash scripts/setup-production-service.sh
```

**This script will:**
- ✅ Create systemd service
- ✅ Enable auto-start on boot
- ✅ Setup automatic restart on crash
- ✅ Configure logging
- ✅ Start backend immediately

### Step 8: Configure Nginx Reverse Proxy
```bash
# Create Nginx config
nano /etc/nginx/sites-available/trading
```

**Paste this configuration:**
```nginx
server {
    listen 80;
    server_name yourdomain.com;  # Change this!

    # Frontend (if deploying frontend separately)
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

    # WebSocket (CRITICAL FOR LIVE DATA!)
    location /ws {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;  # 24 hours
        proxy_send_timeout 86400;
    }

    # Health check
    location /health {
        proxy_pass http://localhost:8000/health;
    }
}
```

Save and exit, then:
```bash
# Enable site
ln -s /etc/nginx/sites-available/trading /etc/nginx/sites-enabled/

# Test configuration
nginx -t

# Restart Nginx
systemctl restart nginx
```

### Step 9: Setup SSL Certificate (HTTPS)
```bash
# Install Certbot
apt install certbot python3-certbot-nginx -y

# Get SSL certificate
certbot --nginx -d yourdomain.com

# Test auto-renewal
certbot renew --dry-run
```

### Step 10: Setup Daily Token Refresh
```bash
# Create token refresh script wrapper
cat > /opt/mytradingsignal/refresh_token.sh << 'EOF'
#!/bin/bash
cd /opt/mytradingsignal
source .venv/bin/activate
python3 quick_token_fix.py >> /var/log/token-refresh.log 2>&1
EOF

chmod +x /opt/mytradingsignal/refresh_token.sh

# Add cron job (runs at 8:30 AM IST = 3:00 AM UTC)
crontab -e
```

**Add this line:**
```bash
0 3 * * * /opt/mytradingsignal/refresh_token.sh
```

---

## ✅ VERIFICATION

### Check Backend Status
```bash
sudo systemctl status trading-backend
```

Should show: **Active (running)**

### Check Live Logs
```bash
# View scheduler logs
sudo journalctl -u trading-backend -f

# Should show:
# ⏰ Market Hours Scheduler STARTED
# Auto-start: 08:50 AM IST
# Auto-stop:  03:35 PM IST
```

### Test WebSocket Connection
```bash
# Install wscat for testing
npm install -g wscat

# Test WebSocket
wscat -c ws://localhost:8000/ws/market

# Should connect and receive heartbeat messages
```

### Check Market Feed at 9:00 AM
At 8:50 AM IST, watch logs:
```bash
sudo journalctl -u trading-backend -f
```

You should see:
```
⏰ [08:50:00 AM] MARKET HOURS DETECTED
🚀 AUTO-STARTING Market Feed...
   📊 Phase: PRE-OPEN (9:00 - 9:15 AM)
   ✅ Market feed started successfully!
```

---

## 🎯 HOW AUTO-START WORKS

### Automatic Schedule
| Time (IST)  | Action | Status |
|-------------|--------|--------|
| 8:50 AM     | 🚀 Auto-start backend | WebSocket connects |
| 9:00 AM     | 📊 Pre-open starts | Data starts flowing |
| 9:15 AM     | 📈 Live trading | Full market data |
| 3:30 PM     | 🛑 Market closes | Last traded data shown |
| 3:35 PM     | ⏸️ Auto-stop | Backend stays running, feed disconnects |

### What Happens Automatically
1. **8:50 AM:** Scheduler starts market feed
2. **9:00 AM:** Zerodha WebSocket connects, pre-open data flows
3. **9:15 AM:** Live trading data starts
4. **3:30 PM:** Market closes, shows last traded data
5. **3:35 PM:** Feed disconnects, backend stays ready for next day

### No Manual Restart Needed! ✅
- Backend runs 24/7
- Market feed auto-starts at 8:50 AM
- Auto-stops at 3:35 PM
- Survives server reboots
- Auto-restarts if crashes

---

## 🔍 TROUBLESHOOTING

### Issue: Backend Not Starting
```bash
# Check logs
sudo journalctl -u trading-backend -xe

# Check if port 8000 is in use
sudo lsof -i :8000

# Restart service
sudo systemctl restart trading-backend
```

### Issue: WebSocket Not Connecting
```bash
# Check Nginx logs
sudo tail -f /var/log/nginx/error.log

# Test WebSocket directly (bypass Nginx)
wscat -c ws://localhost:8000/ws/market

# Check firewall
sudo ufw status
sudo ufw allow 80
sudo ufw allow 443
```

### Issue: No Data at Market Open
```bash
# Check if scheduler is active
sudo journalctl -u trading-backend | grep "Scheduler"

# Check if token is valid
cat /opt/mytradingsignal/backend/.env | grep ZERODHA_ACCESS_TOKEN

# Manually refresh token
cd /opt/mytradingsignal
source .venv/bin/activate
python3 quick_token_fix.py
```

### Issue: Service Keeps Restarting
```bash
# Check error logs
sudo tail -f /var/log/trading-backend-error.log

# Common causes:
# 1. Invalid API credentials in .env
# 2. Missing dependencies (reinstall requirements.txt)
# 3. Port 8000 already in use
```

---

## 📊 MONITORING

### View Live Logs
```bash
# Backend logs
sudo journalctl -u trading-backend -f

# Only show scheduler activity
sudo journalctl -u trading-backend -f | grep "⏰"

# Only show errors
sudo tail -f /var/log/trading-backend-error.log
```

### Check Service Health
```bash
# Service status
sudo systemctl status trading-backend

# Health endpoint
curl http://localhost:8000/health

# WebSocket connection count
curl http://localhost:8000/health | jq .connections
```

---

## 🎉 SUCCESS CRITERIA

✅ **Backend auto-starts on server boot**
✅ **Market feed auto-starts at 8:50 AM IST**
✅ **Pre-open data flows at 9:00 AM**
✅ **Live data flows at 9:15 AM**
✅ **Auto-stops at 3:35 PM**
✅ **WebSocket stays connected during market hours**
✅ **No manual restart needed!**

---

## 📞 USEFUL COMMANDS CHEAT SHEET

```bash
# Service Management
sudo systemctl start trading-backend      # Start
sudo systemctl stop trading-backend       # Stop
sudo systemctl restart trading-backend    # Restart
sudo systemctl status trading-backend     # Status
sudo systemctl enable trading-backend     # Enable auto-start
sudo systemctl disable trading-backend    # Disable auto-start

# Logs
sudo journalctl -u trading-backend -f     # Live logs
sudo journalctl -u trading-backend -n 100 # Last 100 lines
sudo tail -f /var/log/trading-backend.log # App logs

# Update Code
cd /opt/mytradingsignal
git pull
sudo systemctl restart trading-backend

# Refresh Token Manually
cd /opt/mytradingsignal
source .venv/bin/activate
python3 quick_token_fix.py

# Test WebSocket
wscat -c ws://localhost:8000/ws/market
```

---

**🎯 DEPLOYMENT TIME:** 20-30 minutes  
**🔄 DOWNTIME:** 0 minutes (backend runs 24/7)  
**🚀 MAINTENANCE:** Minimal (automatic token refresh, auto-start/stop)

**Your backend is now production-ready with zero manual intervention!** 🎉
