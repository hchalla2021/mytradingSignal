# 🚀 Digital Ocean CLI Deployment Commands

## **Quick Deploy (One Command)**

### **From Windows:**
```powershell
.\deploy-to-do.ps1 YOUR_DROPLET_IP
```

### **From Linux/Mac:**
```bash
chmod +x deploy-to-do.sh
./deploy-to-do.sh YOUR_DROPLET_IP
```

---

## **Manual CLI Deployment**

### **1. Create Droplet via CLI**
```bash
# Install doctl (Digital Ocean CLI)
# Windows: scoop install doctl
# Mac: brew install doctl
# Linux: snap install doctl

# Authenticate
doctl auth init

# Create Docker droplet
doctl compute droplet create trading-app \
  --image docker-20-04 \
  --size s-1vcpu-1gb \
  --region nyc1 \
  --ssh-keys YOUR_SSH_KEY_ID

# Get droplet IP
doctl compute droplet list
```

### **2. Deploy Code**
```bash
# Set your droplet IP
DROPLET_IP=YOUR_DROPLET_IP

# Copy files to droplet
scp -r . root@$DROPLET_IP:~/MyDailyTradingSignals

# SSH and start
ssh root@$DROPLET_IP
```

### **3. On Droplet - Start Services**
```bash
cd ~/MyDailyTradingSignals

# Option A: Using Docker (Recommended)
docker-compose up -d --build

# Option B: Manual start
# Backend
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
nohup python main.py > backend.log 2>&1 &

# Frontend
cd ../frontend
npm install
nohup npm run dev > frontend.log 2>&1 &
```

---

## **Single Command Deploy (Copy-Paste)**

```bash
# Replace with your IP
DROPLET_IP=YOUR_IP_HERE

# Deploy everything
ssh root@$DROPLET_IP "apt update && curl -fsSL https://get.docker.com | sh && curl -L https://github.com/docker/compose/releases/latest/download/docker-compose-\$(uname -s)-\$(uname -m) -o /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose" && \
scp -r . root@$DROPLET_IP:~/app && \
ssh root@$DROPLET_IP "cd ~/app && docker-compose up -d --build && docker-compose ps"
```

---

## **Management Commands**

### **Start/Stop Services**
```bash
# Start
ssh root@$DROPLET_IP "cd ~/MyDailyTradingSignals && docker-compose up -d"

# Stop
ssh root@$DROPLET_IP "cd ~/MyDailyTradingSignals && docker-compose down"

# Restart
ssh root@$DROPLET_IP "cd ~/MyDailyTradingSignals && docker-compose restart"

# View logs
ssh root@$DROPLET_IP "cd ~/MyDailyTradingSignals && docker-compose logs -f"
```

### **Update Code**
```bash
# Copy new code
scp -r . root@$DROPLET_IP:~/MyDailyTradingSignals

# Rebuild and restart
ssh root@$DROPLET_IP "cd ~/MyDailyTradingSignals && docker-compose up -d --build"
```

### **Check Status**
```bash
ssh root@$DROPLET_IP "cd ~/MyDailyTradingSignals && docker-compose ps"
```

---

## **One-Liner Commands**

### **Deploy from GitHub**
```bash
ssh root@$DROPLET_IP "git clone https://github.com/YOUR_USERNAME/MyDailyTradingSignals.git && cd MyDailyTradingSignals && docker-compose up -d"
```

### **Update from Git**
```bash
ssh root@$DROPLET_IP "cd ~/MyDailyTradingSignals && git pull && docker-compose up -d --build"
```

### **View Live Logs**
```bash
ssh root@$DROPLET_IP "cd ~/MyDailyTradingSignals && docker-compose logs -f --tail=100"
```

### **Get Service URLs**
```bash
DROPLET_IP=$(doctl compute droplet list --format PublicIPv4 --no-header)
echo "Frontend: http://$DROPLET_IP:3000"
echo "Backend: http://$DROPLET_IP:8000"
```

---

## **Advanced: Automated Deploy Script**

Create `~/.bashrc` alias:
```bash
echo 'alias deploy-trading="cd ~/MyDailyTradingSignals && git pull && docker-compose up -d --build"' >> ~/.bashrc
```

Then just run:
```bash
ssh root@$DROPLET_IP deploy-trading
```

---

## **Environment Setup (First Time)**

```bash
# SSH to droplet
ssh root@$DROPLET_IP

# Create .env file
cat > ~/MyDailyTradingSignals/backend/.env << EOF
ZERODHA_API_KEY=your_key
ZERODHA_API_SECRET=your_secret
ZERODHA_ACCESS_TOKEN=
REDIRECT_URL=http://$(curl -s ifconfig.me):8000/api/auth/callback
JWT_SECRET=$(openssl rand -hex 32)
REDIS_URL=redis://redis:6379
HOST=0.0.0.0
PORT=8000
EOF

# Start services
cd ~/MyDailyTradingSignals
docker-compose up -d
```

---

## **Firewall Setup**

```bash
ssh root@$DROPLET_IP << 'EOF'
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3000/tcp
ufw allow 8000/tcp
ufw --force enable
ufw status
EOF
```

---

## **Quick Reference**

| Action | Command |
|--------|---------|
| Deploy | `./deploy-to-do.sh $IP` |
| Start | `ssh root@$IP "cd ~/app && docker-compose up -d"` |
| Stop | `ssh root@$IP "cd ~/app && docker-compose down"` |
| Logs | `ssh root@$IP "cd ~/app && docker-compose logs -f"` |
| Status | `ssh root@$IP "cd ~/app && docker-compose ps"` |
| Update | `scp -r . root@$IP:~/app && ssh root@$IP "cd ~/app && docker-compose up -d --build"` |

---

**🎯 Fastest Deploy:**
```bash
# One command from your local machine:
.\deploy-to-do.ps1 YOUR_DROPLET_IP
```
