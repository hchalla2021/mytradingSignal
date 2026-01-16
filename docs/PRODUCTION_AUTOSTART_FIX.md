# 🚨 PRODUCTION AUTO-START FIX - CRITICAL

## 🎯 PROBLEM: Backend Not Auto-Starting on Digital Ocean

**Issue:** Every time the server reboots, you have to manually start the backend.

**Root Cause:** Docker containers don't automatically restart on boot without proper configuration.

---

## ✅ SOLUTION: Complete Auto-Start Setup

### **Option 1: Docker Compose Auto-Start (RECOMMENDED)**

This is the **BEST** solution for Docker deployments.

```bash
# SSH into your Digital Ocean droplet
ssh root@your_droplet_ip

# Navigate to project directory
cd /opt/mytradingsignal  # or wherever your project is

# Run the auto-start configuration script
chmod +x scripts/enable-docker-autostart.sh
sudo bash scripts/enable-docker-autostart.sh
```

**What this does:**
- ✅ Enables Docker to start on boot
- ✅ Creates systemd service for docker-compose
- ✅ Configures containers to restart automatically
- ✅ Starts containers immediately
- ✅ Survives server reboots

**Test it:**
```bash
# Reboot server
sudo reboot

# After reboot, SSH back in and check:
docker ps

# You should see all containers running!
```

---

### **Option 2: Systemd Service (Alternative)**

If you're NOT using Docker, use this method:

```bash
# SSH into Digital Ocean
ssh root@your_droplet_ip

# Navigate to project
cd /opt/mytradingsignal

# Run the production service setup
chmod +x scripts/setup-production-service.sh
sudo bash scripts/setup-production-service.sh
```

**What this does:**
- ✅ Creates systemd service for FastAPI
- ✅ Enables auto-start on boot
- ✅ Auto-restarts on crash
- ✅ Logs to `/var/log/trading-backend.log`

**Useful commands:**
```bash
# Check status
sudo systemctl status trading-backend

# View live logs
sudo journalctl -u trading-backend -f

# Restart manually
sudo systemctl restart trading-backend

# Stop service
sudo systemctl stop trading-backend
```

---

## 🔍 CURRENT SETUP VERIFICATION

### **Check if Docker auto-start is enabled:**
```bash
systemctl is-enabled docker
# Should show: enabled

systemctl is-enabled trading-docker
# Should show: enabled
```

### **Check if containers are set to restart:**
```bash
docker inspect trading-backend --format='{{.HostConfig.RestartPolicy.Name}}'
# Should show: unless-stopped

docker inspect trading-frontend --format='{{.HostConfig.RestartPolicy.Name}}'
# Should show: unless-stopped
```

### **Check container status:**
```bash
docker ps

# You should see:
# - trading-backend (running)
# - trading-frontend (running)
# - trading-redis (running)
```

---

## 🎯 QUICK DEPLOY FOR 9AM MARKET START

**Do this NOW before market opens:**

```bash
# 1. SSH into your server
ssh root@your_droplet_ip

# 2. Navigate to project
cd /opt/mytradingsignal

# 3. Update environment for production
nano backend/.env

# Make sure these are set (PRODUCTION SETTINGS):
# REDIRECT_URL=https://mydailytradesignals.com/api/auth/callback
# FRONTEND_URL=https://mydailytradesignals.com
# CORS_ORIGINS=https://mydailytradesignals.com
# ENABLE_SCHEDULER=true

# Save and exit (Ctrl+X, Y, Enter)

# 4. Apply auto-start fix
chmod +x scripts/enable-docker-autostart.sh
sudo bash scripts/enable-docker-autostart.sh

# 5. Verify containers are running
docker ps

# 6. Check backend logs
docker logs -f trading-backend

# You should see:
# ⏰ Market Hours Scheduler STARTED
# Auto-start: 08:50 AM IST
# Auto-stop:  03:35 PM IST
```

---

## ⏰ WHAT HAPPENS AT MARKET OPEN

**Timeline:**

| Time (IST) | Event | Status |
|------------|-------|--------|
| **8:50 AM** | 🚀 Scheduler auto-starts WebSocket | Backend starts connecting |
| **9:00 AM** | 📊 Pre-open begins | Data starts flowing |
| **9:15 AM** | 📈 Live trading begins | Real-time data updates |
| **3:30 PM** | 🛑 Market closes | Shows last traded prices |
| **3:35 PM** | ⏸️ Scheduler auto-stops | WebSocket disconnects |

**No manual intervention needed!** ✅

---

## 🔧 DOCKER COMPOSE PRODUCTION SETTINGS

Your `docker-compose.prod.yml` already has correct settings:

```yaml
services:
  backend:
    restart: unless-stopped  # ✅ Auto-restarts
    # ... other settings

  frontend:
    restart: unless-stopped  # ✅ Auto-restarts
    # ... other settings

  redis:
    restart: unless-stopped  # ✅ Auto-restarts
    # ... other settings
```

**`unless-stopped` means:**
- ✅ Restart on crash
- ✅ Restart on Docker restart
- ✅ Restart on server reboot
- ❌ Only stops when manually stopped

---

## 🚨 TROUBLESHOOTING

### **Problem: Containers still not starting on boot**

```bash
# Check if Docker is enabled
systemctl is-enabled docker

# If not, enable it:
sudo systemctl enable docker

# Check if trading-docker service exists
systemctl status trading-docker

# If not found, run setup again:
sudo bash scripts/enable-docker-autostart.sh
```

### **Problem: Backend starts but no data at 9 AM**

```bash
# Check backend logs
docker logs -f trading-backend

# Look for:
# ⏰ Market Hours Scheduler STARTED
# If not present, check ENABLE_SCHEDULER in .env

# Verify environment variables
docker exec trading-backend env | grep ENABLE_SCHEDULER
# Should show: ENABLE_SCHEDULER=true
```

### **Problem: Token expired error**

```bash
# The backend needs a valid Zerodha token
# Generate one manually:

# Method 1: Use script (on server)
cd /opt/mytradingsignal/backend
source /opt/mytradingsignal/.venv/bin/activate
python3 generate_token_manual.py

# Method 2: Login via browser
# Visit: https://mydailytradesignals.com/api/auth/login
# Complete Zerodha login
# Token will be saved automatically

# Method 3: Add to cron for daily auto-refresh
# (Token expires daily at 3:30 AM)
crontab -e
# Add:
0 3 * * * cd /opt/mytradingsignal/backend && /opt/mytradingsignal/.venv/bin/python3 generate_token_manual.py
```

### **Problem: Port already in use**

```bash
# Check what's using port 8000
sudo lsof -i :8000

# Kill the process
sudo kill -9 <PID>

# Restart containers
docker-compose -f docker-compose.prod.yml restart
```

---

## ✅ FINAL VERIFICATION CHECKLIST

Before market opens at 9 AM, verify:

- [ ] Docker is enabled: `systemctl is-enabled docker` → **enabled**
- [ ] trading-docker service exists: `systemctl status trading-docker` → **active**
- [ ] Containers are running: `docker ps` → **3 containers UP**
- [ ] Backend restart policy: `docker inspect trading-backend` → **unless-stopped**
- [ ] Scheduler enabled: Check `.env` → **ENABLE_SCHEDULER=true**
- [ ] Production URLs set: Check `.env` → **mydailytradesignals.com**
- [ ] Valid Zerodha token: Check logs → **No 403 errors**
- [ ] Backend logs showing scheduler: `docker logs trading-backend` → **⏰ Scheduler STARTED**

---

## 🎯 ONE-COMMAND QUICK FIX

**Run this single command to fix everything:**

```bash
ssh root@your_droplet_ip << 'ENDSSH'
cd /opt/mytradingsignal
git pull
chmod +x scripts/enable-docker-autostart.sh
sudo bash scripts/enable-docker-autostart.sh
docker logs -f trading-backend | head -n 50
ENDSSH
```

---

## 📞 USEFUL COMMANDS CHEAT SHEET

```bash
# Container Management
docker ps                                    # List running containers
docker ps -a                                 # List all containers
docker-compose -f docker-compose.prod.yml up -d    # Start containers
docker-compose -f docker-compose.prod.yml down     # Stop containers
docker-compose -f docker-compose.prod.yml restart  # Restart all

# Logs
docker logs -f trading-backend               # Backend logs (live)
docker logs -f trading-frontend              # Frontend logs (live)
docker logs --tail 100 trading-backend       # Last 100 lines

# Service Management
sudo systemctl status trading-docker         # Check auto-start service
sudo systemctl restart trading-docker        # Restart service
sudo systemctl enable trading-docker         # Enable auto-start
sudo systemctl disable trading-docker        # Disable auto-start

# Docker Service
sudo systemctl status docker                 # Check Docker status
sudo systemctl enable docker                 # Enable Docker auto-start
sudo systemctl start docker                  # Start Docker

# Reboot Test
sudo reboot                                  # Reboot server
# After reboot:
docker ps                                    # Should show containers running!
```

---

## 🎉 SUCCESS CRITERIA

After applying the fix, your system should:

✅ **Backend auto-starts on server boot**
✅ **Containers restart automatically if they crash**
✅ **Market data starts flowing at 8:50 AM IST**
✅ **No manual intervention needed**
✅ **Survives server reboots**
✅ **Logs show scheduler activity**

---

## 🚀 YOU'RE READY FOR 9 AM!

Once you run the auto-start script:
1. ✅ Your backend will start automatically on boot
2. ✅ Market scheduler will activate at 8:50 AM
3. ✅ Data will flow at 9:00 AM
4. ✅ No manual start needed

**Deploy this fix NOW and you're good for tomorrow's market!** 🎯
