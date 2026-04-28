# DigitalOcean Deployment Guide

## Status
✅ **Build Complete**: TypeScript strict mode fixed, clean production build ready
- Commit: `abe90d1` - Fix missing bias variable in useOverallMarketOutlook
- All 50+ TypeScript errors resolved
- Frontend build: Success with no type errors
- Backend: Python FastAPI ready

## Prerequisites
- DigitalOcean account with SSH access to server
- SSH key configured locally
- Git credentials available on server

## One-Time Server Setup (if not already done)

### 1. Connect to DigitalOcean server
```bash
ssh root@<YOUR_DIGITALOCEAN_IP>
```

### 2. Install Node.js and npm (if needed)
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version
npm --version
```

### 3. Install PM2 globally
```bash
sudo npm install -g pm2
pm2 startup
sudo env PATH=$PATH:/usr/bin /usr/local/lib/node_modules/pm2/bin/pm2 startup systemd -u root --hp /root
```

### 4. Install Python and dependencies
```bash
sudo apt-get update
sudo apt-get install -y python3 python3-pip python3-venv
python3 --version
pip3 --version
```

### 5. Install Redis (optional, if not using managed Redis)
```bash
sudo apt-get install -y redis-server
sudo systemctl start redis-server
redis-cli ping  # Should return PONG
```

---

## Deployment Steps

### Step 1: Clone/Update Repository
```bash
cd /root/mytradingSignal  # or your chosen directory
git clone https://github.com/hchalla2021/mytradingSignal.git .
# OR if already cloned:
git pull origin main
```

### Step 2: Setup Backend
```bash
cd /root/mytradingSignal/backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Create .env file with your credentials
cat > .env << 'EOF'
ZERODHA_API_KEY=your_key_here
ZERODHA_API_SECRET=your_secret_here
REDIS_URL=redis://localhost:6379/0
JWT_SECRET=your_jwt_secret_here
DEBUG=false
EOF
```

### Step 3: Setup Frontend
```bash
cd /root/mytradingSignal/frontend

# Install dependencies
npm install

# Build production bundle
npm run build

# Verify build output exists
ls -la .next/
```

### Step 4: Configure PM2 Ecosystem File
Create `/root/mytradingSignal/ecosystem.config.js`:
```javascript
module.exports = {
  apps: [
    {
      name: 'trading-backend',
      script: '/root/mytradingSignal/backend/venv/bin/uvicorn',
      args: 'main:app --host 0.0.0.0 --port 8000',
      cwd: '/root/mytradingSignal/backend',
      instances: 1,
      exec_mode: 'cluster',
      watch: false,
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'trading-frontend',
      script: 'npm',
      args: 'start',
      cwd: '/root/mytradingSignal/frontend',
      instances: 1,
      exec_mode: 'cluster',
      watch: false,
      env: {
        NODE_ENV: 'production',
        NEXT_PUBLIC_WS_URL: 'wss://your-domain.com/ws/market'
      }
    }
  ]
};
```

### Step 5: Start Services with PM2
```bash
cd /root/mytradingSignal

# Start all services
pm2 start ecosystem.config.js

# Verify services are running
pm2 list

# View logs
pm2 logs

# Save PM2 processes to auto-restart on reboot
pm2 save
```

### Step 6: Setup Nginx Reverse Proxy (Recommended)
```bash
sudo apt-get install -y nginx

# Create nginx config
sudo tee /etc/nginx/sites-available/trading-signals > /dev/null << 'EOF'
upstream frontend {
    server 127.0.0.1:3000;
}

upstream backend {
    server 127.0.0.1:8000;
}

server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 100M;

    location / {
        proxy_pass http://frontend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://backend/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws/ {
        proxy_pass http://backend/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/trading-signals /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Step 7: Setup SSL Certificate (Optional but Recommended)
```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

## Daily Operations

### Start Services
```bash
pm2 start all
```

### Stop Services
```bash
pm2 stop all
```

### Restart Services
```bash
pm2 restart all
```

### Monitor Services
```bash
pm2 monit
```

### View Logs
```bash
# Backend logs
pm2 logs trading-backend

# Frontend logs
pm2 logs trading-frontend

# Combined logs
pm2 logs
```

### Update Code and Restart
```bash
cd /root/mytradingSignal
git pull origin main
cd frontend && npm run build
pm2 restart all
```

---

## Troubleshooting

### Services Not Starting
```bash
# Check PM2 error logs
pm2 logs

# Check system resources
free -h
df -h
top

# Restart PM2 daemon
pm2 kill
pm2 start ecosystem.config.js
```

### Frontend Not Loading
```bash
# Check Nginx is running
sudo systemctl status nginx

# Check Nginx logs
sudo tail -f /var/log/nginx/error.log

# Verify frontend is running
curl http://localhost:3000
```

### Backend Connection Issues
```bash
# Check backend is running
curl http://localhost:8000/api/health

# Check port is open
netstat -tuln | grep 8000

# Check Redis connection
redis-cli ping
```

### Memory Issues
```bash
# Check memory usage
free -h

# Increase PM2 memory limit
pm2 set pm2-auto-pull true
pm2 save

# Or manually restart with memory limit
pm2 restart all --max-memory-restart 500M
```

---

## Security Checklist

- [ ] SSH key-based authentication enabled (no password login)
- [ ] Firewall configured (ufw):
  ```bash
  sudo ufw enable
  sudo ufw allow 22/tcp
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  ```
- [ ] SSL certificate installed and auto-renewing
- [ ] Environment variables properly configured
- [ ] Database credentials not hardcoded
- [ ] PM2 processes monitored and logging enabled
- [ ] Regular backups configured

---

## Monitoring

### Setup PM2 Monitoring
```bash
pm2 install pm2-auto-pull
pm2 monitor  # (optional - requires PM2 Plus account)
```

### Manual Health Check
```bash
curl http://your-domain.com/api/health
curl ws://your-domain.com/ws/market
```

---

## Rollback Procedure (if needed)

```bash
cd /root/mytradingSignal
git log --oneline  # View commits
git revert <commit-hash>  # Revert to previous commit
git push origin main
pm2 restart all
```

---

## Support

- **Backend**: FastAPI at `http://your-domain.com/api/`
- **Frontend**: Next.js at `http://your-domain.com/`
- **WebSocket**: `wss://your-domain.com/ws/market`

---

**Last Updated**: 2024
**Build Status**: ✅ Production Ready
