# 🔐 Zerodha Token Management Guide

## Overview
Zerodha access tokens are required for live market data and have a **24-hour validity period**. This guide explains how tokens work, why they expire, and how to keep your system running smoothly.

---

## 📅 Token Lifecycle

### Token Validity
- **Lifespan**: 24 hours from generation
- **Expiry**: Midnight (00:00 IST)
- **Renewal**: Requires manual OAuth login (Zerodha security policy)

### Why Manual Renewal?
Zerodha requires browser-based OAuth login for security. This **cannot be automated** because:
1. User must approve each login via Zerodha's authentication portal
2. Two-factor authentication (PIN/OTP) required
3. API secrets should never be exposed in automated flows

---

## ⚠️ Common Issue: "Reconnecting, Reconnecting" at 9 AM

### What Happens:
1. **Previous Day**: You logged in and got a fresh token
2. **Midnight (00:00 AM)**: Token expires (24-hour limit)
3. **8:50 AM**: System validates token → **EXPIRED**
4. **8:55 AM**: System tries to connect WebSocket → **FAILS**
5. **9:00 AM**: Market opens, system keeps reconnecting → **Infinite loop**

### Root Cause:
Your system is trying to connect with an expired token from yesterday.

---

## ✅ Solutions

### Option 1: Login via UI (Recommended)
**Before 8:50 AM on market days:**
1. Open your trading app UI
2. Click the **LOGIN** button
3. Complete Zerodha authentication
4. System will auto-reconnect with fresh token

**Best Practice**: Login between 8:00-8:45 AM on weekdays.

---

### Option 2: Manual Token Script
**Run token generation script:**
```bash
cd backend
python quick_token_fix.py
```

**Or:**
```bash
python get_token.py
```

**Steps:**
1. Script opens browser with Zerodha login page
2. Login with your credentials
3. Copy the `request_token` from callback URL
4. Paste into script
5. Token saved to `.env` file
6. System auto-reconnects

---

### Option 3: Scheduled Task (Advanced)
**Set up a daily reminder:**

**Windows Task Scheduler:**
```powershell
# Create a task that runs at 8:30 AM weekdays
# Opens your trading app UI
# Or runs: python quick_token_fix.py
```

**Linux Cron Job:**
```bash
# Add to crontab: Reminder at 8:30 AM weekdays
30 8 * * 1-5 /usr/local/bin/notify-send "Trading App" "Please login to refresh token"
```

---

## 🚀 Automatic System Behavior

### 8:50 AM - Token Validation
- System checks if token is valid
- If **EXPIRED**: 
  - ❌ Stops connection attempts
  - 📢 Shows clear error message
  - ⏸️ Waits for you to login
  - 🔴 No infinite reconnection loop

### 8:55 AM - Market Feed Start
- Only starts if token is **VALID**
- If token expired: Shows "LOGIN REQUIRED" message

### 9:00 AM - Market Open
- With valid token: ✅ Live data flows smoothly
- Without valid token: ⏸️ System waits for login (no reconnection spam)

---

## 📊 Token Status Monitoring

### Backend Logs
Watch for these messages:
```
🟢 UNIFIED AUTH: VALID (age: 5.2h)          ← Token is fresh
🟠 UNIFIED AUTH: EXPIRED (age: 25.3h)       ← Token needs refresh
🔴 TOKEN EXPIRED - LOGIN REQUIRED           ← Action needed
```

### Frontend Notifications
You'll receive alerts:
- **8:00 AM**: Warning if token is >18 hours old
- **On Expiry**: "Your token has expired. Please login."
- **At Market Open**: "LOGIN REQUIRED" if token invalid

### API Endpoint
Check token status programmatically:
```bash
curl http://localhost:8000/api/auth/token-status
```

Response:
```json
{
  "status": "valid",
  "is_authenticated": true,
  "token_age_hours": 5.2,
  "expires_at": "2025-01-18T00:00:00+05:30"
}
```

---

## 🔍 Troubleshooting

### Issue: "Token expired" but I just logged in
**Cause**: Old token cached  
**Fix**: 
```bash
# Clear settings cache
rm -rf backend/__pycache__
# Restart backend
```

---

### Issue: Login works but connection still fails
**Possible Causes**:
1. **Network issue**: Check internet connectivity
2. **Zerodha API down**: Visit [status.zerodha.com](https://status.zerodha.com)
3. **Wrong API key**: Verify `ZERODHA_API_KEY` in `.env`

**Debug Steps**:
```bash
cd backend
python test_production_websocket.py
```

---

### Issue: No "LOGIN" button in UI
**Where to find it**:
- Top-right corner of dashboard
- Or: Settings → Authentication
- Or: Click "Token Expired" notification

---

### Issue: Token keeps expiring immediately
**Cause**: System clock wrong  
**Fix**:
```bash
# Linux/Mac
sudo ntpdate -s time.nist.gov

# Windows
w32tm /resync
```

---

## 📝 Best Practices

### Daily Routine (Weekdays)
1. **8:00-8:45 AM**: Login via UI (takes 30 seconds)
2. **8:50 AM**: System validates token automatically
3. **8:55 AM**: Market feed connects automatically
4. **9:00 AM**: Live data flows smoothly ✅

### Weekly Maintenance
- Monday: Verify token after weekend
- Check logs for any token errors
- Test login flow once per week

### Production Deployment
```bash
# Set environment variables
export ZERODHA_API_KEY="your_api_key"
export ZERODHA_API_SECRET="your_api_secret"
export ENABLE_SCHEDULER="true"  # Enable auto market timing

# Run backend
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000
```

---

## 🛠️ Technical Details

### Token Storage
- Location: `backend/.env` file
- Variable: `ZERODHA_ACCESS_TOKEN`
- Format: 32-character alphanumeric string
- Security: Never commit `.env` to git

### Token Watcher
- Watches `.env` file for changes
- Auto-reloads token when updated
- Triggers WebSocket reconnection
- No restart needed for token refresh

### Scheduler Integration
```python
# Scheduler runs these checks:
# 8:50 AM: Validate token (prevent futile connections)
# 8:55 AM: Start market feed (if token valid)
# 9:15 AM: Verify live data flowing
# 3:35 PM: Stop market feed (after close)
```

---

## 📚 Related Documentation
- [Authentication System](./AUTH_SYSTEM_COMPLETE.md)
- [Market Hours Scheduler](./AUTO_MARKET_TIMING_EXPLAINED.md)
- [Backend Setup](./ARCHITECTURE_DIAGRAM.md)
- [Troubleshooting Guide](./COMPLETE_PRODUCTION_READINESS_AUDIT.md)

---

## 🆘 Quick Reference

| Time | Action | If Token Expired |
|------|--------|------------------|
| 8:00 AM | System wakes up | Nothing happens yet |
| 8:50 AM | Token validation | ⚠️ Shows "LOGIN REQUIRED" |
| 8:55 AM | WebSocket connect | ⏸️ Waits for login (no reconnection loop) |
| 9:00 AM | Market opens | 🔴 No data without token |
| After Login | Automatic | ✅ Connects immediately |

---

## 💡 Pro Tips

1. **Morning Coffee Routine**: Login while making coffee (8:15 AM)
2. **Weekend Check**: Verify token on Monday mornings
3. **Backup Plan**: Keep `quick_token_fix.py` handy
4. **Monitoring**: Watch backend logs during first connection
5. **Mobile Setup**: Configure mobile notifications for token expiry

---

## 🎯 Summary

**Key Takeaway**: Zerodha tokens expire daily. Login before market opens (8:00-8:45 AM) for smooth operation.

**No More Issues**:
- ❌ No more "reconnecting, reconnecting" loops
- ✅ Clear error messages when token expires  
- 📢 Proactive notifications to login
- ⏸️ System waits gracefully instead of spamming connections

**Your Action**: Just login via UI before 8:50 AM on market days. That's it! 🎉
