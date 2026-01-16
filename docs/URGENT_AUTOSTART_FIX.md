# 🚨 URGENT: Fix Backend Auto-Start on Digital Ocean

## Problem
Backend doesn't auto-start on server reboot. You have to manually start it every time.

## Solution (ONE COMMAND)

### SSH into your Digital Ocean server and run:

```bash
cd /opt/mytradingsignal  # or wherever your project is
chmod +x quick_production_fix.sh
sudo bash quick_production_fix.sh
```

**That's it!** This will:
- ✅ Enable Docker to start on boot
- ✅ Create systemd service for auto-starting containers
- ✅ Start all containers immediately
- ✅ Configure automatic restart on crash
- ✅ Enable market scheduler (8:50 AM auto-start)

---

## What to Expect

### Before Market Opens (9:00 AM IST)

**8:50 AM IST:** Backend automatically starts WebSocket connection
**9:00 AM IST:** Pre-open data starts flowing
**9:15 AM IST:** Live trading data begins

### No Manual Action Required! ✅

---

## Verify It Works

```bash
# Check containers are running
docker ps

# You should see:
# - trading-backend
# - trading-frontend  
# - trading-redis

# Check backend logs
docker logs -f trading-backend

# Look for:
# ⏰ Market Hours Scheduler STARTED
# Auto-start: 08:50 AM IST
```

---

## Test Auto-Start

```bash
# Reboot the server
sudo reboot

# SSH back in after reboot
ssh root@your_server_ip

# Check if containers auto-started
docker ps

# ✅ All containers should be running!
```

---

## Still Having Issues?

### Manual Check:
```bash
# Is Docker enabled?
systemctl is-enabled docker
# Should show: enabled

# Is trading service enabled?
systemctl is-enabled trading-docker
# Should show: enabled

# Are containers running?
docker ps
# Should show 3 containers
```

### Force Restart:
```bash
sudo systemctl restart trading-docker
docker ps
```

---

## Deploy Before Market Opens

**Recommended:** Run the fix script TODAY before 9 AM tomorrow!

```bash
# Connect to server
ssh root@your_droplet_ip

# Navigate to project
cd /opt/mytradingsignal

# Run fix
sudo bash quick_production_fix.sh

# Done! ✅
```

---

## Read Full Documentation

For detailed explanation, see: [PRODUCTION_AUTOSTART_FIX.md](PRODUCTION_AUTOSTART_FIX.md)

---

**Time to deploy:** 2-3 minutes  
**Risk:** Low (just enables auto-start)  
**Downtime:** ~10 seconds while containers restart  

🎯 **Deploy this NOW and never manually start your backend again!**
