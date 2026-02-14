# 🚀 Digital Ocean Deployment Checklist

## Pre-Deployment Setup

### ✅ 1. Environment Configuration
- [ ] `backend/.env` exists with correct Zerodha API credentials
- [ ] `ENABLE_SCHEDULER=true` is set (enables automatic 9 AM connection)
- [ ] `REDIS_URL=redis://redis:6379` uses Docker container name
- [ ] `frontend/.env.local` has correct production domain
- [ ] Production URLs use HTTPS: `https://mydailytradesignals.com`
- [ ] WebSocket URL uses WSS: `wss://mydailytradesignals.com/ws/market`

### ✅ 2. Zerodha API Settings
- [ ] Zerodha API key and secret are correct
- [ ] Redirect URL registered in Zerodha console: `https://mydailytradesignals.com/api/auth/callback`
- [ ] API is enabled for WebSocket streaming

### ✅ 3. DNS & SSL Configuration
- [ ] Domain points to Digital Ocean droplet IP
- [ ] SSL certificate installed (Let's Encrypt or other)
- [ ] Port 443 (HTTPS) and 80 (HTTP redirect) open
- [ ] Port 8000 proxied through Nginx/Caddy (not directly exposed)

---

## Deployment Steps

### 1. SSH to Digital Ocean Droplet
```bash
ssh root@your-droplet-ip
```

### 2. Clone Repository (First Time)
```bash
cd /root
git clone https://github.com/your-username/mytradingSignal.git
cd mytradingSignal

# Create backend/.env file
cat > backend/.env << 'EOF'
# Zerodha API
ZERODHA_API_KEY=your_api_key_here
ZERODHA_API_SECRET=your_api_secret_here
ZERODHA_ACCESS_TOKEN=will_be_generated_on_login

# Production URLs
REDIRECT_URL=https://mydailytradesignals.com/api/auth/callback
FRONTEND_URL=https://mydailytradesignals.com
CORS_ORIGINS=https://mydailytradesignals.com

# JWT Secret (change this!)
JWT_SECRET=your-secret-key-change-this-in-production

# Server
HOST=0.0.0.0
PORT=8000
DEBUG=False

# Redis (use container name)
REDIS_URL=redis://redis:6379

# Enable automatic market timing
ENABLE_SCHEDULER=true

# Instrument Tokens
NIFTY_TOKEN=256265
BANKNIFTY_TOKEN=260105
SENSEX_TOKEN=265
FINNIFTY_TOKEN=257801
MIDCPNIFTY_TOKEN=288009

# Futures Tokens
NIFTY_FUT_TOKEN=12602626
BANKNIFTY_FUT_TOKEN=12601346
SENSEX_FUT_TOKEN=292786437
EOF

# Create frontend/.env.local file
cat > frontend/.env.local << 'EOF'
# Environment
NEXT_PUBLIC_PRODUCTION_DOMAIN=mydailytradesignals.com
NEXT_PUBLIC_ENVIRONMENT=production

# Production URLs
NEXT_PUBLIC_API_URL=https://mydailytradesignals.com
NEXT_PUBLIC_WS_URL=wss://mydailytradesignals.com/ws/market

# Market Configuration
NEXT_PUBLIC_MARKET_SYMBOLS=NIFTY,BANKNIFTY,SENSEX

# Performance
NEXT_PUBLIC_REFRESH_INTERVAL=3000
NEXT_PUBLIC_ADVANCED_REFRESH_INTERVAL=3000
NEXT_PUBLIC_MARKET_REFRESH_INTERVAL=3000
NEXT_PUBLIC_WS_RECONNECT_DELAY=3000
NEXT_PUBLIC_WS_PING_INTERVAL=25000
NEXT_PUBLIC_API_TIMEOUT=5000
NEXT_PUBLIC_DATA_FRESHNESS_MS=60000

# Features
NEXT_PUBLIC_ENABLE_AI_ANALYSIS=false

# Node
NODE_OPTIONS=--max-old-space-size=2048
EOF

# IMPORTANT: Edit these files and add your actual credentials
nano backend/.env  # Update ZERODHA_API_KEY, ZERODHA_API_SECRET, JWT_SECRET
```

### 3. Deploy with Script
```bash
# Make script executable (first time only)
chmod +x deploy_digitalocean.sh

# Run deployment
./deploy_digitalocean.sh
```

This will:
- Pull latest code
- Use existing backend/.env and frontend/.env.local
- Rebuild Docker containers
- Start all services
- Test backend health

### 4. Verify Deployment
```bash
# Check running containers
docker-compose -f docker-compose.prod.yml ps

# Should see 3 containers:
# - trading-backend (healthy)
# - trading-frontend (healthy)
# - trading-redis (healthy)

# Check backend logs
docker-compose -f docker-compose.prod.yml logs backend | tail -50

# Check for:
# ✅ "⏰ Market Scheduler: ACTIVE"
# ✅ "🟢 UNIFIED AUTH: VALID" or "🔴 LOGIN REQUIRED"
# ✅ "🚀 Backend READY"
```

---

## 🔐 CRITICAL: Daily Token Management

### **Zerodha tokens expire every 24 hours at midnight!**

With our new token authentication system:

#### **8:50 AM - Automatic Token Check**
- System validates token before market opens
- If expired → Shows clear error, stops reconnection attempts
- If valid → Proceeds to connect at 8:55 AM

#### **What You Must Do: Login Before 8:50 AM**

**Method 1: Via Web UI** ⭐ RECOMMENDED
```
1. Between 8:00-8:45 AM weekdays, visit:
   https://mydailytradesignals.com

2. Click LOGIN button

3. Complete Zerodha authentication

4. System auto-reconnects within seconds ✅
```

**Method 2: SSH to Server**
```bash
# SSH to droplet
ssh root@your-droplet-ip

# Navigate to backend
cd /root/mytradingSignal/backend

# Run token script
python quick_token_fix.py

# Follow prompts:
# 1. Opens Zerodha login URL
# 2. Login via browser
# 3. Copy request_token from callback URL
# 4. Paste into script
# 5. Token saved to .env file

# Check if token updated
docker-compose -f ../docker-compose.prod.yml logs backend | tail -20

# Look for:
# "🔄 NEW TOKEN DETECTED! Instant reconnection starting..."
# "✅ Token update complete! Services reconnecting..."
```

---

## 🔍 Monitoring & Troubleshooting

### Check System Status
```bash
# View all logs
docker-compose -f docker-compose.prod.yml logs -f

# Backend only
docker-compose -f docker-compose.prod.yml logs -f backend

# Frontend only
docker-compose -f docker-compose.prod.yml logs -f frontend

# Last 50 lines
docker-compose -f docker-compose.prod.yml logs --tail=50
```

### Token Status Messages

**✅ Good (Token Valid)**
```
🟢 UNIFIED AUTH: VALID (age: 5.2h)
✅ Token VALID and ACTIVE
✅ Feed started successfully!
📈 Received 3 ticks (NIFTY, BANKNIFTY, SENSEX)
```

**⚠️ Warning (Token Old)**
```
🟠 Token is 19.5h old - please login before market opens
```

**🔴 Error (Token Expired)**
```
🔴 UNIFIED AUTH: EXPIRED (age: 25.3h)
🔴 TOKEN EXPIRED - CANNOT CONNECT
📋 TO FIX THIS ISSUE:
   1. Open your trading app UI
   2. Click the LOGIN button
   3. Complete Zerodha authentication
```

### Common Issues

#### Issue 1: "reconnecting, reconnecting" at 9 AM
**Old behavior** (before fix) ❌  
**New behavior** (after fix) ✅
```
# Now shows:
⏸️ Market open but TOKEN EXPIRED
   Please LOGIN via UI to enable live data
```
- System no longer spams reconnection attempts
- Clear error message
- Waits for you to login

---

#### Issue 2: Backend not starting
```bash
# Check Docker logs
docker-compose -f docker-compose.prod.yml logs backend

# Common causes:
# - Redis not ready: Wait 30 seconds and check again
# - Port 8000 in use: sudo lsof -i :8000
# - Invalid .env: Check ZERODHA_API_KEY and ZERODHA_API_SECRET
```

---

#### Issue 3: Frontend shows "Connecting..."
```bash
# Check backend is running
curl http://localhost:8000/health

# Should return:
# {"status":"healthy","timestamp":"..."}

# Check WebSocket is accessible
curl -I http://localhost:8000/ws/market

# Should return 101 Switching Protocols or 403 Forbidden (normal for curl)

# Test from browser console:
const ws = new WebSocket('wss://mydailytradesignals.com/ws/market');
ws.onopen = () => console.log('✅ WebSocket connected');
ws.onerror = (e) => console.error('❌ WebSocket error', e);
```

---

#### Issue 4: Data not updating after login
```bash
# Restart backend container to reload token
docker-compose -f docker-compose.prod.yml restart backend

# Wait 30 seconds
sleep 30

# Check logs
docker-compose -f docker-compose.prod.yml logs backend | tail -30

# Should see:
# "🔄 NEW TOKEN DETECTED! Instant reconnection starting..."
# "✅ Feed started successfully!"
```

---

## 🔄 Updating Production

### Deploy Latest Code
```bash
# SSH to droplet
ssh root@your-droplet-ip

# Run deployment script
cd /root/mytradingSignal
./deploy_digitalocean.sh
```

### Manual Update Steps (if script fails)
```bash
# Pull latest
git pull origin main

# Rebuild containers
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.prod.yml up -d

# Verify
docker-compose -f docker-compose.prod.yml ps
docker-compose -f docker-compose.prod.yml logs backend | tail -50
```

---

## 📊 Performance Optimization

### Check Resource Usage
```bash
# Container resource usage
docker stats

# Should see:
# trading-backend: <500MB RAM, <50% CPU
# trading-frontend: <300MB RAM, <20% CPU
# trading-redis: <100MB RAM, <10% CPU
```

### Optimize if Needed
```bash
# Clear Docker cache
docker system prune -a --volumes

# Restart all services
docker-compose -f docker-compose.prod.yml restart
```

---

## 🛡️ Security Best Practices

### 1. Secure .env Files
```bash
# Ensure .env files are not publicly accessible  
chmod 600 backend/.env
chmod 600 frontend/.env.local

# Never commit .env with secrets to git
# .gitignore should contain:
# .env
# .env.local
# */.env
# */.env.local
```

### 2. Firewall Rules
```bash
# Allow only necessary ports
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP (redirect to HTTPS)
ufw allow 443/tcp   # HTTPS
ufw enable

# Block direct access to backend port
ufw deny 8000/tcp
```

### 3. Regular Updates
```bash
# Update system packages weekly
apt update && apt upgrade -y

# Update Docker images monthly
docker-compose -f docker-compose.prod.yml pull
docker-compose -f docker-compose.prod.yml up -d
```

---

## 📅 Daily Routine (Weekdays)

### Morning (Before Market Opens)
```
8:00 AM - Wake up, have coffee ☕
8:15 AM - Login to https://mydailytradesignals.com
8:20 AM - Complete Zerodha authentication (takes 30 seconds)
8:50 AM - System validates token automatically ✅
8:55 AM - Market feed connects automatically
9:00 AM - Live data flowing smoothly! 🎉
```

### During Market Hours
- Monitor dashboard for live data
- Check logs periodically if issues arise

### After Market Closes
- System auto-stops at 3:35 PM
- No action needed

---

## 🆘 Emergency Procedures

### Complete System Restart
```bash
# Stop everything
docker-compose -f docker-compose.prod.yml down

# Clear all data (CAUTION: loses cache)
docker-compose -f docker-compose.prod.yml down -v

# Rebuild and start
docker-compose -f docker-compose.prod.yml up -d --build

# Check status
docker-compose -f docker-compose.prod.yml ps
docker-compose -f docker-compose.prod.yml logs | tail -100
```

### Rollback to Previous Version
```bash
# Check git history
git log --oneline -5

# Rollback to previous commit
git checkout <commit-hash>

# Rebuild
docker-compose -f docker-compose.prod.yml up -d --build

# Or rollback one commit
git reset --hard HEAD~1
```

---

## 📚 Related Documentation

- [Token Management Guide](./docs/TOKEN_MANAGEMENT.md) - Detailed token lifecycle
- [Token Authentication Fix Summary](./TOKEN_AUTH_FIX_SUMMARY.md) - Recent improvements
- [Architecture Diagram](./docs/ARCHITECTURE_DIAGRAM.md) - System overview

---

## ✅ Final Checklist

Before going live:
- [ ] All environment variables set correctly
- [ ] Docker containers running and healthy
- [ ] Backend accessible at https://yourdomain.com/health
- [ ] Frontend loads at https://yourdomain.com
- [ ] WebSocket connects (check browser console)
- [ ] LOGIN button works
- [ ] Test token authentication flow (login before 8:50 AM)
- [ ] Verify market data appears at 9:00 AM
- [ ] Set daily reminder to login between 8:00-8:45 AM

---

## 🎯 Success Criteria

**Your deployment is successful when:**
1. ✅ Website loads at https://mydailytradesignals.com
2. ✅ You can login via Zerodha OAuth
3. ✅ After login (before 9 AM), logs show "Token VALID"
4. ✅ At 9:00 AM, live market data appears automatically
5. ✅ No "reconnecting, reconnecting" loops
6. ✅ Clear error message if token expires
7. ✅ System reconnects within seconds after login

---

## 💡 Pro Tips

1. **Set Phone Reminder**: 8:15 AM daily - "Login to trading app"
2. **Bookmark Login Page**: Quick access from phone
3. **Keep SSH Access**: For emergency manual token updates
4. **Monitor First Week**: Watch logs during market open to ensure smooth operation
5. **Weekend Check**: Login Monday morning after weekend (token may expire)

---

**Remember**: With the new authentication fixes, the system will gracefully wait for your login instead of spamming reconnection attempts. Just login between 8:00-8:45 AM and you're good to go! 🚀
