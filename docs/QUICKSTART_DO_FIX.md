# 🚨 QUICK FIX: Digital Ocean Token Issue

## Your Problem
- ✅ Local: Works, asks for login
- ❌ Digital Ocean: Shows "Feed disconnected", "Auth" issue, "Market Closed"
- ❌ Token expires daily but no auto-refresh set up

## Immediate Solution (5 minutes)

### Step 1: SSH into Digital Ocean
```bash
ssh root@your-droplet-ip
cd /var/www/mytradingSignal  # or wherever your app is
```

### Step 2: Quick Token Refresh
```bash
# Activate virtual environment
source .venv/bin/activate  # or: source venv/bin/activate

# Run token refresh
python manual_token_refresh.py
```

**Follow prompts**:
1. Open the login URL in browser
2. Login to Zerodha
3. Copy the `request_token` from redirect URL
4. Paste it back in terminal

### Step 3: Restart Backend

#### If using Docker:
```bash
docker restart trading-backend
```

#### If using systemd:
```bash
sudo systemctl restart trading-backend
```

#### If using PM2:
```bash
pm2 restart trading-backend
```

### Step 4: Verify
```bash
curl http://localhost:8000/api/system/health | jq
```

Should show:
- `"state": "AUTHENTICATED"`
- `"feed_state": "CONNECTED"`

---

## Permanent Fix (10 minutes)

### Option A: Cron Job (Simplest)

1. **Download setup files** (from your repo):
   ```bash
   # Files should be in your repo now:
   # - setup_token_cron.sh
   # - auto_token_refresh.py
   # - refresh_token_cron.sh (will be created)
   ```

2. **Run setup**:
   ```bash
   chmod +x setup_token_cron.sh
   ./setup_token_cron.sh
   ```

3. **Verify**:
   ```bash
   crontab -l
   # Should show: 15 2 * * * /path/to/refresh_token_cron.sh
   ```

4. **Test manually**:
   ```bash
   ./refresh_token_cron.sh
   tail -f logs/token_refresh.log
   ```

---

### Option B: Docker Cron (If using Docker)

1. **Update `docker-compose.yml`** on Digital Ocean:

```yaml
services:
  # ... existing services ...

  token-refresher:
    image: python:3.11-slim
    container_name: token-refresher
    volumes:
      - ./:/app
      - ./logs:/app/logs
    working_dir: /app
    environment:
      - TZ=Asia/Kolkata
    command: >
      bash -c "
      apt-get update && apt-get install -y cron &&
      pip install kiteconnect python-dotenv &&
      echo '15 2 * * * cd /app && python auto_token_refresh.py >> /app/logs/token_refresh.log 2>&1' > /etc/cron.d/token-refresh &&
      chmod 0644 /etc/cron.d/token-refresh &&
      crontab /etc/cron.d/token-refresh &&
      cron -f
      "
    restart: unless-stopped
```

2. **Restart Docker**:
```bash
docker-compose up -d
docker logs -f token-refresher
```

---

## Why This Happens

### Zerodha Token Lifecycle:
- Token **expires daily** around 7:30 AM IST
- Token is valid for exactly **24 hours** from generation
- **Must be manually regenerated** each day (Zerodha limitation)

### What Was Missing:
- ✅ Local: You manually refresh when needed
- ❌ Digital Ocean: No automation = token expires = app stops working

### What We Fixed:
- ✅ Added cron job to refresh at 7:45 AM IST daily
- ✅ Backend auto-detects new token (no manual restart)
- ✅ Logging for monitoring

---

## Monitoring

### Check logs daily (first week):
```bash
tail -f logs/token_refresh.log
```

### Check health endpoint:
```bash
curl http://your-domain.com/api/system/health
```

### Set up alerts (optional):
- UptimeRobot to ping health endpoint
- Email alert if endpoint returns error
- Telegram/Slack webhook on failure

---

## Common Issues

### Issue: "Request token invalid"
**Cause**: Token used after 5 minutes
**Fix**: Generate new token immediately after login

### Issue: "Cron not running"
**Check**:
```bash
sudo systemctl status cron
grep CRON /var/log/syslog
```

### Issue: "Token refresh failed"
**Check**:
```bash
tail -f logs/token_refresh.log
# Look for error messages
```

**Manual override**:
```bash
python manual_token_refresh.py
```

---

## Testing

### Test the full flow:
```bash
# 1. Run refresh
python auto_token_refresh.py

# 2. Check logs
cat logs/token_refresh.log

# 3. Verify backend
curl http://localhost:8000/api/system/health | jq .auth

# 4. Check frontend
curl http://localhost:3000  # Should load
```

---

## Summary

✅ **Immediate**: Run `manual_token_refresh.py` on Digital Ocean
✅ **Permanent**: Set up cron job with `setup_token_cron.sh`
✅ **Monitor**: Check logs daily for first week
✅ **Relax**: System auto-refreshes daily at 7:45 AM IST

**Time to fix**: 15 minutes total
**Time saved**: Hours of manual work daily

---

## Need Help?

1. Check logs: `tail -f logs/token_refresh.log`
2. Check health: `curl localhost:8000/api/system/health`
3. Manual refresh: `python manual_token_refresh.py`
4. Restart backend: `docker restart trading-backend`

Your system should now work 24/7 with automatic token refresh! 🎉
