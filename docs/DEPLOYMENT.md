# 🚀 Digital Ocean Deployment Guide

## Quick Start (Local)

### **Windows:**
```bash
start.bat
```

### **Linux/Mac:**
```bash
chmod +x start.sh
./start.sh
```

### **Docker (All Platforms):**
```bash
docker-compose up -d
```

---

## 📦 Digital Ocean Deployment

### **Option 1: Docker Droplet (Recommended)**

1. **Create Droplet:**
   - Go to Digital Ocean → Create Droplet
   - Choose: **Docker on Ubuntu 22.04**
   - Size: **Basic ($6/month)** or higher
   - Add SSH key
   - Create Droplet

2. **SSH into Droplet:**
   ```bash
   ssh root@YOUR_DROPLET_IP
   ```

3. **Clone Repository:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/MyDailyTradingSignals.git
   cd MyDailyTradingSignals
   ```

4. **Set Environment Variables:**
   ```bash
   nano backend/.env
   ```
   
   Add:
   ```env
   ZERODHA_API_KEY=your_key
   ZERODHA_API_SECRET=your_secret
   ZERODHA_ACCESS_TOKEN=
   REDIRECT_URL=http://YOUR_DROPLET_IP:8000/api/auth/callback
   JWT_SECRET=your-jwt-secret-key
   REDIS_URL=redis://redis:6379
   HOST=0.0.0.0
   PORT=8000
   ```

5. **Update Frontend API URLs:**
   ```bash
   nano frontend/.env.local
   ```
   
   Add:
   ```env
   NEXT_PUBLIC_WS_URL=ws://YOUR_DROPLET_IP:8000/ws/market
   NEXT_PUBLIC_API_URL=http://YOUR_DROPLET_IP:8000
   ```

6. **Update Backend CORS:**
   Edit `backend/main.py` - add your droplet IP to allowed origins

7. **Start Services:**
   ```bash
   docker-compose up -d
   ```

8. **Check Status:**
   ```bash
   docker-compose ps
   docker-compose logs -f
   ```

9. **Access App:**
   - Frontend: `http://YOUR_DROPLET_IP:3000`
   - Backend: `http://YOUR_DROPLET_IP:8000`

---

### **Option 2: App Platform (Easiest)**

1. **Push to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/MyDailyTradingSignals.git
   git push -u origin main
   ```

2. **Create App:**
   - Go to Digital Ocean → App Platform
   - Connect GitHub repository
   - Configure components:

   **Backend:**
   - Type: Web Service
   - Source: `backend/`
   - Build Command: `pip install -r requirements.txt`
   - Run Command: `python main.py`
   - Port: 8000
   - Environment Variables: Add all from `.env`

   **Frontend:**
   - Type: Web Service
   - Source: `frontend/`
   - Build Command: `npm install && npm run build`
   - Run Command: `npm start`
   - Port: 3000
   - Environment Variables: Add NEXT_PUBLIC_* vars

   **Redis:**
   - Type: Database
   - Engine: Redis

3. **Deploy:**
   - Click "Create Resources"
   - Wait for deployment (~5 min)
   - Get URLs and update REDIRECT_URL

---

### **Option 3: Manual Setup (VPS)**

1. **Create Ubuntu Droplet**

2. **Install Dependencies:**
   ```bash
   # Update system
   apt update && apt upgrade -y
   
   # Install Python
   apt install python3 python3-pip python3-venv -y
   
   # Install Node.js
   curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
   apt install nodejs -y
   
   # Install Redis
   apt install redis-server -y
   systemctl enable redis-server
   systemctl start redis-server
   
   # Install Nginx
   apt install nginx -y
   systemctl enable nginx
   systemctl start nginx
   ```

3. **Clone and Setup:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/MyDailyTradingSignals.git
   cd MyDailyTradingSignals
   ```

4. **Create Systemd Services:**

   **Backend Service:**
   ```bash
   nano /etc/systemd/system/trading-backend.service
   ```
   
   ```ini
   [Unit]
   Description=Trading Signals Backend
   After=network.target redis-server.service
   
   [Service]
   Type=simple
   User=root
   WorkingDirectory=/root/MyDailyTradingSignals/backend
   ExecStart=/root/MyDailyTradingSignals/backend/venv/bin/python main.py
   Restart=always
   
   [Install]
   WantedBy=multi-user.target
   ```

   **Frontend Service:**
   ```bash
   nano /etc/systemd/system/trading-frontend.service
   ```
   
   ```ini
   [Unit]
   Description=Trading Signals Frontend
   After=network.target
   
   [Service]
   Type=simple
   User=root
   WorkingDirectory=/root/MyDailyTradingSignals/frontend
   ExecStart=/usr/bin/npm start
   Restart=always
   Environment="NODE_ENV=production"
   
   [Install]
   WantedBy=multi-user.target
   ```

5. **Enable and Start Services:**
   ```bash
   systemctl daemon-reload
   systemctl enable trading-backend trading-frontend
   systemctl start trading-backend trading-frontend
   systemctl status trading-backend trading-frontend
   ```

6. **Configure Nginx:**
   ```bash
   nano /etc/nginx/sites-available/trading
   ```
   
   ```nginx
   server {
       listen 80;
       server_name YOUR_DOMAIN_OR_IP;
   
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
       location /api/ {
           proxy_pass http://localhost:8000/api/;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }
   
       # WebSocket
       location /ws/ {
           proxy_pass http://localhost:8000/ws/;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
       }
   }
   ```
   
   ```bash
   ln -s /etc/nginx/sites-available/trading /etc/nginx/sites-enabled/
   nginx -t
   systemctl restart nginx
   ```

---

## 🔒 Production Checklist

- [ ] Update `JWT_SECRET` to strong random value
- [ ] Set `DEBUG=False` in backend
- [ ] Use environment variables for all secrets
- [ ] Enable firewall: `ufw allow 22,80,443,3000,8000/tcp`
- [ ] Setup SSL with Let's Encrypt (certbot)
- [ ] Configure domain name
- [ ] Update REDIRECT_URL in Zerodha app settings
- [ ] Setup monitoring (PM2 or Supervisor)
- [ ] Configure log rotation
- [ ] Setup automated backups
- [ ] Add health check endpoints

---

## 🔧 Useful Commands

```bash
# Check logs
docker-compose logs -f
journalctl -u trading-backend -f
journalctl -u trading-frontend -f

# Restart services
docker-compose restart
systemctl restart trading-backend trading-frontend

# Stop all
docker-compose down
systemctl stop trading-backend trading-frontend

# Update code
git pull
docker-compose up -d --build
```

---

## 💰 Cost Estimate (Digital Ocean)

| Option | Monthly Cost | Best For |
|--------|--------------|----------|
| Basic Droplet (1GB) | $6 | Development/Testing |
| Docker Droplet (2GB) | $12 | Production (Small) |
| App Platform | $12-20 | Managed, Auto-scale |
| Production Setup | $24+ | High Traffic |

---

## 🆘 Troubleshooting

**Port already in use:**
```bash
lsof -ti:3000 | xargs kill -9
lsof -ti:8000 | xargs kill -9
```

**Docker issues:**
```bash
docker-compose down -v
docker-compose up --build
```

**Logs not showing:**
```bash
docker-compose logs --tail=100
```

---

**Need SSL/HTTPS? Add Cloudflare or Certbot after deployment!**
