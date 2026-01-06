# 🚀 DIGITAL OCEAN QUICK DEPLOYMENT - 5 MINUTES

## ⚡ SUPER FAST SETUP (Copy-Paste Commands)

### 1. SSH into Digital Ocean
```bash
ssh root@your_droplet_ip
```

### 2. One-Command Install Everything
```bash
curl -fsSL https://raw.githubusercontent.com/yourusername/mytradingSignal/main/scripts/quick-deploy.sh | bash
```

**OR Manual Setup:**

```bash
# Update & install dependencies
apt update && apt install -y python3.11 python3.11-venv git nginx redis-server

# Clone repo
git clone https://github.com/yourusername/mytradingSignal.git /opt/mytradingsignal
cd /opt/mytradingsignal

# Setup environment
cp .env.production.example backend/.env
nano backend/.env  # Fill ZERODHA credentials

# Install Python packages
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

# Create systemd service (AUTO-START!)
bash scripts/setup-production-service.sh

# Done! Backend running with auto-schedule
```

---

## ⏰ AUTOMATIC SCHEDULE (No Manual Intervention!)

| Time    | Action | What Happens |
|---------|--------|--------------|
| 8:50 AM | 🚀 Auto-start | WebSocket connects to Zerodha |
| 9:00 AM | 📊 Pre-open | Data starts flowing |
| 9:15 AM | 📈 Live | Full market data streaming |
| 3:30 PM | 🛑 Market close | Last traded data shown |
| 3:35 PM | ⏸️ Auto-stop | Feed disconnects, backend stays running |

**✅ NO RESTART NEEDED - EVER!**

---

## 🔍 QUICK CHECKS

### Check if Backend is Running
```bash
sudo systemctl status trading-backend
```
**Should show:** `Active (running)`

### Watch Live Logs
```bash
sudo journalctl -u trading-backend -f
```
**Should show:**
```
⏰ Market Hours Scheduler STARTED
Auto-start: 08:50 AM IST
Auto-stop:  03:35 PM IST
```

### Test WebSocket
```bash
# Install wscat
npm install -g wscat

# Test connection
wscat -c ws://localhost:8000/ws/market
```
**Should connect and show heartbeat messages**

---

## 🔧 USEFUL COMMANDS

```bash
# Restart backend
sudo systemctl restart trading-backend

# View logs (last 100 lines)
sudo journalctl -u trading-backend -n 100

# View error logs
sudo tail -f /var/log/trading-backend-error.log

# Check if running
sudo systemctl is-active trading-backend

# Stop backend
sudo systemctl stop trading-backend

# Start backend
sudo systemctl start trading-backend
```

---

## 🆘 TROUBLESHOOTING

### Backend Won't Start
```bash
# Check logs
sudo journalctl -u trading-backend -xe

# Check if port busy
sudo lsof -i :8000

# Check Python path
which python3.11

# Reinstall dependencies
cd /opt/mytradingsignal
source .venv/bin/activate
pip install -r backend/requirements.txt --force-reinstall
```

### No Data at Market Open
```bash
# Check scheduler logs
sudo journalctl -u trading-backend | grep "Scheduler"

# Check token
cat /opt/mytradingsignal/backend/.env | grep ZERODHA_ACCESS_TOKEN

# Refresh token manually
cd /opt/mytradingsignal
source .venv/bin/activate
python3 quick_token_fix.py

# Restart backend
sudo systemctl restart trading-backend
```

### WebSocket Not Working
```bash
# Test direct connection (bypass Nginx)
wscat -c ws://localhost:8000/ws/market

# If works: Issue is Nginx config
# If fails: Issue is backend

# Check Nginx config
sudo nginx -t
sudo systemctl restart nginx

# Check firewall
sudo ufw status
sudo ufw allow 80
sudo ufw allow 443
```

---

## 📊 WHAT YOU GET

✅ **Auto-start at 8:50 AM IST** - No manual intervention  
✅ **Auto-stop at 3:35 PM IST** - Saves resources  
✅ **Runs 24/7** - Backend always ready  
✅ **Survives reboots** - systemd auto-start  
✅ **Auto-restart on crash** - Never goes down  
✅ **WebSocket auto-connect** - At market open  
✅ **Production-ready** - No Docker needed  

---

## 🎯 VERIFICATION CHECKLIST

After deployment, verify these:

- [ ] `sudo systemctl status trading-backend` shows "Active (running)"
- [ ] `sudo journalctl -u trading-backend | grep "Scheduler"` shows scheduler active
- [ ] `wscat -c ws://localhost:8000/ws/market` connects successfully
- [ ] At 8:50 AM IST, logs show "AUTO-STARTING Market Feed"
- [ ] At 9:00 AM IST, data starts flowing in dashboard
- [ ] Backend stays running after server reboot

---

## 📖 Full Documentation

- **Complete Guide:** [docs/DIGITAL_OCEAN_AUTO_START_GUIDE.md](../docs/DIGITAL_OCEAN_AUTO_START_GUIDE.md)
- **Production Deployment:** [PRODUCTION_DEPLOYMENT_GUIDE.md](../PRODUCTION_DEPLOYMENT_GUIDE.md)
- **Market Scheduler Code:** [backend/services/market_hours_scheduler.py](../backend/services/market_hours_scheduler.py)

---

**⏱️ Setup Time:** 5-10 minutes  
**🔄 Maintenance:** Zero (fully automatic)  
**🚀 Result:** Production-ready trading signals with zero manual intervention!

---

**🎉 Your problem is SOLVED! No more manual restarts needed!**
