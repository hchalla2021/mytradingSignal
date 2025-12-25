# 🚀 GitHub → Digital Ocean Deployment Guide

## **Step 1: Push Code to GitHub**

### **From Your Local Machine (Windows):**

```powershell
# Initialize git (if not already done)
cd d:\Trainings\Trading\MyDailyTradingSignals
git init

# Create .gitignore
@"
# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
venv/
env/
.venv/

# Node
node_modules/
.next/
out/
build/
dist/

# Environment
.env
.env.local
*.log

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Redis
*.rdb
"@ | Out-File -FilePath .gitignore -Encoding utf8

# Add all files
git add .

# Commit
git commit -m "Initial deployment"

# Add remote (replace with your GitHub repo)
git remote add origin https://github.com/YOUR_USERNAME/MyDailyTradingSignals.git

# Push to GitHub
git push -u origin main
```

---

## **Step 2: SSH to Digital Ocean Droplet**

```bash
ssh root@YOUR_DROPLET_IP
```

---

## **Step 3: Install Prerequisites on Droplet**

```bash
# Update system
apt update && apt upgrade -y

# Install Docker (Recommended)
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
systemctl enable docker
systemctl start docker

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
docker-compose --version

# OR Install manually (Python + Node + Redis)
# apt install python3 python3-pip python3-venv nodejs npm redis-server git -y
```

---

## **Step 4: Clone Repository from GitHub**

```bash
# Clone your repo
cd ~
git clone https://github.com/YOUR_USERNAME/MyDailyTradingSignals.git
cd MyDailyTradingSignals
```

---

## **Step 5: Configure Environment**

```bash
# Create backend .env file
cat > backend/.env << 'EOF'
ZERODHA_API_KEY=g5tyrnn1mlckrb6f
ZERODHA_API_SECRET=6cusjkixpyv7pii7c2rtei61ewcoxj3l
ZERODHA_ACCESS_TOKEN=
REDIRECT_URL=http://YOUR_DROPLET_IP:8000/api/auth/callback
JWT_SECRET=mydailytradingsignals-secret-key-2024
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
HOST=0.0.0.0
PORT=8000
DEBUG=True
REDIS_URL=redis://redis:6379
EOF

# Update REDIRECT_URL with actual IP
DROPLET_IP=$(curl -s ifconfig.me)
sed -i "s/YOUR_DROPLET_IP/$DROPLET_IP/g" backend/.env

# Create frontend .env.local
cat > frontend/.env.local << EOF
NEXT_PUBLIC_WS_URL=ws://$DROPLET_IP:8000/ws/market
NEXT_PUBLIC_API_URL=http://$DROPLET_IP:8000
EOF
```

---

## **Step 6: Start Servers**

### **Option A: Using Docker Compose (Recommended)**

```bash
# Update docker-compose for production
cd ~/MyDailyTradingSignals

# Start all services (Backend + Frontend + Redis)
docker-compose up -d --build

# Check status
docker-compose ps

# View logs
docker-compose logs -f

# That's it! Everything is running!
```

### **Option B: Manual Start (Without Docker)**

#### **Install Dependencies:**
```bash
cd ~/MyDailyTradingSignals

# Backend
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
deactivate

# Frontend
cd ../frontend
npm install
npm run build
```

#### **Start Redis:**
```bash
# Start Redis
systemctl start redis-server
systemctl enable redis-server
redis-cli ping  # Should return PONG
```

#### **Start Backend:**
```bash
cd ~/MyDailyTradingSignals/backend

# Using nohup (runs in background)
nohup python3 main.py > backend.log 2>&1 &

# OR using screen (can detach/attach)
screen -S backend
python3 main.py
# Press Ctrl+A then D to detach

# Check if running
ps aux | grep python
curl http://localhost:8000/api/health
```

#### **Start Frontend:**
```bash
cd ~/MyDailyTradingSignals/frontend

# Development mode
nohup npm run dev > frontend.log 2>&1 &

# OR Production mode (recommended)
nohup npm start > frontend.log 2>&1 &

# OR using screen
screen -S frontend
npm run dev
# Press Ctrl+A then D to detach

# Check if running
ps aux | grep node
curl http://localhost:3000
```

---

## **Step 7: Configure Firewall**

```bash
# Allow necessary ports
ufw allow 22/tcp     # SSH
ufw allow 80/tcp     # HTTP
ufw allow 443/tcp    # HTTPS
ufw allow 3000/tcp   # Frontend
ufw allow 8000/tcp   # Backend
ufw --force enable

# Check firewall status
ufw status
```

---

## **Step 8: Verify Deployment**

```bash
# Get your droplet IP
DROPLET_IP=$(curl -s ifconfig.me)
echo "Frontend: http://$DROPLET_IP:3000"
echo "Backend: http://$DROPLET_IP:8000"

# Check services
docker-compose ps  # If using Docker
# OR
ps aux | grep -E 'python|node'  # If manual

# Test endpoints
curl http://localhost:8000/api/health
curl http://localhost:3000
```

---

## **📋 Complete Command Sequence (Copy-Paste)**

### **From Local Machine:**
```powershell
# Push to GitHub
cd d:\Trainings\Trading\MyDailyTradingSignals
git init
git add .
git commit -m "Deploy to Digital Ocean"
git remote add origin https://github.com/YOUR_USERNAME/MyDailyTradingSignals.git
git push -u origin main
```

### **On Digital Ocean Droplet:**
```bash
# Install & Setup (run once)
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Clone repo
cd ~
git clone https://github.com/YOUR_USERNAME/MyDailyTradingSignals.git
cd MyDailyTradingSignals

# Setup environment
DROPLET_IP=$(curl -s ifconfig.me)
cat > backend/.env << EOF
ZERODHA_API_KEY=g5tyrnn1mlckrb6f
ZERODHA_API_SECRET=6cusjkixpyv7pii7c2rtei61ewcoxj3l
ZERODHA_ACCESS_TOKEN=
REDIRECT_URL=http://$DROPLET_IP:8000/api/auth/callback
JWT_SECRET=mydailytradingsignals-secret-key-2024
REDIS_URL=redis://redis:6379
HOST=0.0.0.0
PORT=8000
EOF

cat > frontend/.env.local << EOF
NEXT_PUBLIC_WS_URL=ws://$DROPLET_IP:8000/ws/market
NEXT_PUBLIC_API_URL=http://$DROPLET_IP:8000
EOF

# Start everything
docker-compose up -d --build

# Configure firewall
ufw allow 22,80,443,3000,8000/tcp
ufw --force enable

# Show URLs
echo "✅ Deployment Complete!"
echo "🌐 Frontend: http://$DROPLET_IP:3000"
echo "🔧 Backend: http://$DROPLET_IP:8000"
```

---

## **🔄 Update/Redeploy (After Code Changes)**

### **From Local Machine:**
```powershell
git add .
git commit -m "Update code"
git push
```

### **On Digital Ocean:**
```bash
cd ~/MyDailyTradingSignals
git pull
docker-compose down
docker-compose up -d --build
```

---

## **📊 Management Commands**

### **View Logs:**
```bash
# Docker logs
docker-compose logs -f
docker-compose logs backend
docker-compose logs frontend

# Manual logs
tail -f ~/MyDailyTradingSignals/backend/backend.log
tail -f ~/MyDailyTradingSignals/frontend/frontend.log
```

### **Stop Services:**
```bash
# Docker
docker-compose down

# Manual
pkill -f "python3 main.py"
pkill -f "npm run dev"
```

### **Restart Services:**
```bash
# Docker
docker-compose restart

# Manual
cd ~/MyDailyTradingSignals/backend
nohup python3 main.py > backend.log 2>&1 &

cd ~/MyDailyTradingSignals/frontend
nohup npm run dev > frontend.log 2>&1 &
```

### **Check Status:**
```bash
# Docker
docker-compose ps

# Manual
ps aux | grep -E 'python|node'
netstat -tulpn | grep -E '3000|8000'
```

### **Screen Sessions (if using screen):**
```bash
# List sessions
screen -ls

# Attach to session
screen -r backend
screen -r frontend

# Detach: Ctrl+A then D

# Kill session
screen -X -S backend quit
```

---

## **🔒 Production Hardening (Optional)**

```bash
# Setup systemd services for auto-restart
cat > /etc/systemd/system/trading-backend.service << 'EOF'
[Unit]
Description=Trading Backend
After=network.target redis.service

[Service]
Type=simple
User=root
WorkingDirectory=/root/MyDailyTradingSignals/backend
ExecStart=/usr/bin/python3 main.py
Restart=always

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/trading-frontend.service << 'EOF'
[Unit]
Description=Trading Frontend
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
EOF

# Enable and start
systemctl daemon-reload
systemctl enable trading-backend trading-frontend
systemctl start trading-backend trading-frontend
systemctl status trading-backend trading-frontend
```

---

## **🆘 Troubleshooting**

### **Port already in use:**
```bash
# Find and kill process
lsof -ti:3000 | xargs kill -9
lsof -ti:8000 | xargs kill -9

# OR
fuser -k 3000/tcp
fuser -k 8000/tcp
```

### **Git pull conflicts:**
```bash
git stash
git pull
git stash pop
```

### **Docker issues:**
```bash
docker-compose down -v
docker system prune -a
docker-compose up -d --build
```

### **Can't access from browser:**
- Check firewall: `ufw status`
- Check services: `docker-compose ps`
- Check logs: `docker-compose logs -f`
- Verify IP: `curl ifconfig.me`

---

## **✅ Quick Reference**

| Step | Command |
|------|---------|
| **Push to GitHub** | `git add . && git commit -m "deploy" && git push` |
| **SSH to Droplet** | `ssh root@YOUR_DROPLET_IP` |
| **Clone Repo** | `git clone YOUR_REPO_URL && cd MyDailyTradingSignals` |
| **Start Services** | `docker-compose up -d --build` |
| **Check Status** | `docker-compose ps` |
| **View Logs** | `docker-compose logs -f` |
| **Update Code** | `git pull && docker-compose up -d --build` |
| **Stop Services** | `docker-compose down` |

---

**🎯 That's it! Your app is now live on Digital Ocean!**
