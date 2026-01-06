# 🔧 Digital Ocean Token Refresh Setup Guide

## Problem
Zerodha tokens expire daily (around 7:30 AM IST), but Digital Ocean deployment has no automatic refresh mechanism.

## Solution Options

### Option 1: Cron Job (Recommended for VPS)

#### Step 1: SSH into your Digital Ocean droplet
```bash
ssh root@your-droplet-ip
cd /path/to/mytradingSignal
```

#### Step 2: Run the setup script
```bash
chmod +x setup_token_cron.sh
./setup_token_cron.sh
```

#### Step 3: Verify cron job
```bash
crontab -l
# Should show: 15 2 * * * /path/to/mytradingSignal/refresh_token_cron.sh
```

#### Step 4: Test the cron script manually
```bash
./refresh_token_cron.sh
tail -f logs/token_refresh.log
```

---

### Option 2: Systemd Timer (Advanced)

Create `/etc/systemd/system/token-refresh.service`:
```ini
[Unit]
Description=Zerodha Token Refresh Service
After=network.target

[Service]
Type=oneshot
User=root
WorkingDirectory=/path/to/mytradingSignal
ExecStart=/path/to/mytradingSignal/.venv/bin/python /path/to/mytradingSignal/auto_token_refresh.py
StandardOutput=append:/path/to/mytradingSignal/logs/token_refresh.log
StandardError=append:/path/to/mytradingSignal/logs/token_refresh.log
```

Create `/etc/systemd/system/token-refresh.timer`:
```ini
[Unit]
Description=Daily Zerodha Token Refresh Timer
Requires=token-refresh.service

[Timer]
OnCalendar=02:15:00
Persistent=true

[Install]
WantedBy=timers.target
```

Enable and start:
```bash
sudo systemctl enable token-refresh.timer
sudo systemctl start token-refresh.timer
sudo systemctl status token-refresh.timer
```

---

### Option 3: Docker with Cron

Add to your `docker-compose.yml`:

```yaml
services:
  token-refresher:
    image: alpine:latest
    container_name: token-refresher
    volumes:
      - ./:/app
      - ./logs:/app/logs
    environment:
      - TZ=Asia/Kolkata
    command: >
      sh -c "
      apk add --no-cache python3 py3-pip &&
      pip3 install kiteconnect python-dotenv &&
      echo '15 2 * * * cd /app && python3 auto_token_refresh.py >> /app/logs/token_refresh.log 2>&1' > /etc/crontabs/root &&
      crond -f
      "
    restart: unless-stopped
```

Then:
```bash
docker-compose up -d token-refresher
docker logs -f token-refresher
```

---

### Option 4: External Monitoring Service (Premium)

Use services like:
- **UptimeRobot** (free) - ping health endpoint, trigger webhook on failure
- **Cronitor** (paid) - dedicated cron job monitoring
- **Zapier/n8n** - workflow automation

Example webhook endpoint you can add to backend:
```python
@app.post("/api/admin/refresh-token")
async def admin_refresh_token(api_secret: str = Header(...)):
    """Admin endpoint to trigger token refresh"""
    if api_secret != settings.admin_api_secret:
        raise HTTPException(401, "Unauthorized")
    
    # Trigger token refresh logic
    success = await refresh_token()
    return {"status": "success" if success else "failed"}
```

---

## Quick Fix for Today (Manual)

### SSH into Digital Ocean and run:
```bash
ssh root@your-droplet-ip
cd /path/to/mytradingSignal
source .venv/bin/activate  # or source venv/bin/activate
python manual_token_refresh.py
```

### Or use Docker exec:
```bash
docker exec -it trading-backend python manual_token_refresh.py
```

---

## Environment Setup (Important!)

Your `backend/.env` should have:
```bash
ZERODHA_API_KEY=your_key
ZERODHA_API_SECRET=your_secret
ZERODHA_ACCESS_TOKEN=will_be_auto_updated

# Optional: Store request token for auto-refresh
ZERODHA_REQUEST_TOKEN=store_after_first_manual_login
```

---

## Verification

### Check if token refresh is working:
```bash
# View logs
tail -f logs/token_refresh.log

# Check cron jobs
crontab -l

# Test manual refresh
python auto_token_refresh.py

# Check backend health
curl http://localhost:8000/api/system/health | jq
```

---

## Troubleshooting

### Issue: Cron not running
```bash
# Check cron service
sudo systemctl status cron

# Check cron logs
grep CRON /var/log/syslog
```

### Issue: Permission denied
```bash
chmod +x refresh_token_cron.sh
chmod +x auto_token_refresh.py
```

### Issue: Python not found in cron
```bash
# Use full path in cron script
which python3
# Update refresh_token_cron.sh with full path
```

---

## Best Practice

1. **Initial Setup** (Do Once):
   ```bash
   python manual_token_refresh.py
   # Store the request_token in .env for future auto-refresh
   ```

2. **Set up automation** (Choose one):
   - Cron job (simplest)
   - Systemd timer (robust)
   - Docker cron (containerized)

3. **Monitor**:
   - Set up alerts for token refresh failures
   - Check logs daily initially
   - Use health endpoint monitoring

---

## Emergency Contact

If automated refresh fails:
1. SSH into server
2. Run `python manual_token_refresh.py`
3. Restart backend: `docker restart trading-backend` or `systemctl restart trading-backend`

---

## Next Steps

1. ✅ Set up ONE of the automation options above
2. ✅ Test it manually first
3. ✅ Monitor logs for 2-3 days
4. ✅ Set up alerting (optional but recommended)

**Remember**: Zerodha tokens are valid for 24 hours. The system MUST refresh them daily!
