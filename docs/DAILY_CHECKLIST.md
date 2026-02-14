# 📅 DAILY CHECKLIST - Market Days (Mon-Fri)

## ☀️ Morning Routine (Before Market Opens)

### ⏰ 8:00 - 8:45 AM: LOGIN TO REFRESH TOKEN

```
┌──────────────────────────────────────────────┐
│  CRITICAL: Login EVERY weekday before 8:50 AM │
│  Zerodha tokens expire daily (24h validity)   │
└──────────────────────────────────────────────┘

1. Open browser: https://mydailytradesignals.com
2. Click: LOGIN button (top right)
3. Complete Zerodha OAuth (takes 30 seconds)
4. Done! ✅
```

---

## 🤖 What Happens Automatically

### 8:50 AM - Token Validation
```
✅ Token Valid   → System proceeds to connect
🔴 Token Expired → Shows "LOGIN REQUIRED" 
                   (NO reconnection spam!) ✅
```

### 8:55 AM - Market Feed Start
```
Only connects if token is valid
Ready for market open
```

### 9:00 AM - Market Opens
```
✅ Live data flows automatically
📊 NIFTY, BANKNIFTY, SENSEX streaming
🎉 All signals active
```

### 3:35 PM - Market Closes
```
System auto-stops (no action needed)
```

---

## 🆘 If You Forget to Login

### Old System (Before Fix) ❌
```
9:00 AM: "reconnecting, reconnecting..."
         Infinite loop, no data
         Confusing error messages
```

### New System (With Fix) ✅
```
8:50 AM: "🔴 TOKEN EXPIRED - CANNOT CONNECT"
         Clear message: "Please LOGIN via UI"
         System waits gracefully
         
After Login: Auto-connects within seconds
             Live data flows immediately
```

---

## 📱 Quick Actions

### Check System Status
```bash
ssh root@your-droplet-ip
cd /root/mytradingSignal
docker-compose -f docker-compose.prod.yml logs backend | tail -30
```

### Manual Token Update (Emergency)
```bash
ssh root@your-droplet-ip
cd /root/mytradingSignal/backend
python quick_token_fix.py
# Follow prompts to login via browser
```

---

## ✅ Success Indicators

### You're Good When You See:
```
🟢 UNIFIED AUTH: VALID (age: 2.5h)
✅ Token VALID and ACTIVE
⏰ Market Scheduler: ACTIVE
✅ Feed started successfully!
📈 Received 3 ticks (total: 156)
```

### Action Needed When You See:
```
🔴 UNIFIED AUTH: EXPIRED (age: 25.3h)
🔴 TOKEN EXPIRED - CANNOT CONNECT
📋 TO FIX: Login via UI
```

---

## 🔥 REMEMBER

```
╔═══════════════════════════════════════════════════════╗
║  LOGIN BETWEEN 8:00-8:45 AM ON WEEKDAYS              ║
║  Takes 30 seconds • Prevents all connection issues   ║
╚═══════════════════════════════════════════════════════╝
```

---

## 📞 Emergency Contacts

- **Full Guide**: `DIGITAL_OCEAN_DEPLOYMENT_CHECKLIST.md`
- **Token Details**: `docs/TOKEN_MANAGEMENT.md`
- **Fix Summary**: `TOKEN_AUTH_FIX_SUMMARY.md`

---

## 💡 Pro Tip

**Set phone alarm for 8:15 AM on weekdays**
```
Title: "Trading App - Login"
Notes: https://mydailytradesignals.com
       Click LOGIN → 30 seconds → Done!
```

---

**Last Updated**: After Token Authentication Fix (Feb 2026)
**Status**: No more "reconnecting" loops! 🎉
