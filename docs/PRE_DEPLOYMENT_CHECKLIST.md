# 🚀 Pre-Deployment Checklist - Digital Ocean

## Before You Deploy

### ✅ Code Cleanup (COMPLETED)
- [x] Removed redundant test scripts (check_sensex.py, fix_sensex_token.py)
- [x] Removed debug print statements from backend
- [x] Removed console.log statements from frontend
- [x] Verified debug=False in production config
- [x] No syntax errors in modified files
- [x] Kept utility scripts needed for manual override

### 🔐 Security (ACTION REQUIRED)
- [ ] Generate strong JWT secret: `openssl rand -base64 32`
- [ ] Update JWT_SECRET in backend/.env
- [ ] Change CORS_ORIGINS from "*" to your domain
- [ ] Never commit .env files to git
- [ ] Use strong passwords for Redis (optional but recommended)
- [ ] Setup SSH key authentication (disable password login)

### 🌐 Domain & DNS (ACTION REQUIRED)
- [ ] Register domain or use existing
- [ ] Point A record to Digital Ocean droplet IP
- [ ] Wait for DNS propagation (15-60 minutes)

### 🔧 Zerodha Configuration (ACTION REQUIRED)
- [ ] Go to https://developers.kite.trade/apps
- [ ] Update Redirect URL: `https://yourdomain.com/api/auth/callback`
- [ ] Copy API Key and Secret to backend/.env
- [ ] Test login flow after deployment

### 📋 Environment Variables (ACTION REQUIRED)

#### Backend .env (Create on server)
```bash
# ZERODHA API
ZERODHA_API_KEY=your_api_key_here
ZERODHA_API_SECRET=your_api_secret_here
ZERODHA_ACCESS_TOKEN=  # Leave empty, will be set after first login

# OAUTH
REDIRECT_URL=https://yourdomain.com/api/auth/callback
FRONTEND_URL=https://yourdomain.com

# REDIS
REDIS_URL=redis://localhost:6379
REDIS_DB=0

# JWT (GENERATE NEW SECRET!)
JWT_SECRET=CHANGE_THIS_TO_STRONG_SECRET
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7

# SERVER
HOST=0.0.0.0
PORT=8000
DEBUG=false
CORS_ORIGINS=https://yourdomain.com

# FUTURES TOKENS (Auto-updated by system)
NIFTY_FUT_TOKEN=12683010
BANKNIFTY_FUT_TOKEN=12674050
SENSEX_FUT_TOKEN=292786437

# SPOT TOKENS (Static, don't change)
NIFTY_TOKEN=256265
BANKNIFTY_TOKEN=260105
SENSEX_TOKEN=265
FINNIFTY_TOKEN=257801
MIDCPNIFTY_TOKEN=288009
```

#### Frontend .env.local (Create on server)
```bash
NEXT_PUBLIC_API_URL=https://yourdomain.com
NEXT_PUBLIC_WS_URL=wss://yourdomain.com/ws/market
```

### 🖥️ Digital Ocean Droplet (ACTION REQUIRED)
- [ ] Create Ubuntu 22.04 LTS droplet
- [ ] Size: Basic Plan - 2GB RAM / 2 vCPUs ($18/month)
- [ ] Region: Choose closest to Mumbai (low latency to Zerodha)
- [ ] Add SSH key for secure access
- [ ] Note droplet IP address

### 📦 Dependencies (Will be installed during deployment)
- Python 3.11+
- Node.js 18+
- Redis Server
- Nginx
- Certbot (SSL)
- Git

### 🚀 Deployment Steps
1. **SSH into server**
   ```bash
   ssh root@your_droplet_ip
   ```

2. **Follow PRODUCTION_DEPLOYMENT.md**
   - Install system dependencies
   - Clone repository
   - Setup backend (Python venv, packages, .env, systemd)
   - Setup frontend (npm install, build, systemd)
   - Configure nginx reverse proxy
   - Setup SSL certificate with certbot
   - Start all services

3. **Test deployment**
   ```bash
   # Check services
   systemctl status trading-backend
   systemctl status trading-frontend
   systemctl status nginx
   systemctl status redis-server
   
   # Check logs
   journalctl -u trading-backend -f
   journalctl -u trading-frontend -f
   
   # Test health endpoint
   curl https://yourdomain.com/health
   ```

4. **First login**
   - Go to https://yourdomain.com
   - Click "Login with Zerodha"
   - Authorize app
   - Should redirect back with success

### 🛡️ Post-Deployment Security (ACTION REQUIRED)
- [ ] Enable firewall: `ufw enable`
- [ ] Allow only ports 22, 80, 443
- [ ] Disable root SSH password login
- [ ] Setup automatic security updates
- [ ] Monitor logs for suspicious activity
- [ ] Backup .env files securely
- [ ] Setup log rotation
- [ ] Enable Redis persistence (optional)

### 📊 Monitoring Setup (RECOMMENDED)
- [ ] Setup log monitoring (journalctl)
- [ ] Monitor Redis memory usage
- [ ] Setup alerts for service failures
- [ ] Monitor SSL certificate expiry (auto-renewed)
- [ ] Track API rate limits
- [ ] Monitor WebSocket connections

### 🔧 Maintenance Tasks
- **Daily:** Check service status, review logs
- **Weekly:** Review Redis cache performance, check disk space
- **Monthly:** Update futures tokens (auto-handled), security updates
- **Quarterly:** Review and rotate JWT secrets, update dependencies

### 📞 Emergency Contacts
- Zerodha Support: support@zerodha.com
- Digital Ocean Support: cloud.digitalocean.com/support
- GitHub Issues: your-repo/issues

---

## Quick Commands Reference

### Service Management
```bash
# Restart services
systemctl restart trading-backend
systemctl restart trading-frontend
systemctl restart nginx

# View logs
journalctl -u trading-backend -f
journalctl -u trading-frontend -f

# Check status
systemctl status trading-backend
systemctl status trading-frontend
```

### Nginx
```bash
# Test config
nginx -t

# Reload
systemctl reload nginx

# SSL renewal
certbot renew
```

### Redis
```bash
# Test connection
redis-cli ping

# Check memory
redis-cli info memory

# Flush cache (use with caution!)
redis-cli flushall
```

### Git Updates
```bash
cd /opt/mytradingSignal
git pull origin main

# Restart services after update
systemctl restart trading-backend
systemctl restart trading-frontend
```

---

## 🎯 Success Criteria

Your deployment is successful when:
- ✅ Backend runs without errors: `systemctl status trading-backend`
- ✅ Frontend loads: https://yourdomain.com
- ✅ Health check responds: https://yourdomain.com/health
- ✅ WebSocket connects (check browser console Network tab)
- ✅ Login with Zerodha works
- ✅ Market data updates in real-time
- ✅ All signals show (Instant, PCR, Volume Pulse, Trend Base, Zone Control)
- ✅ SSL certificate is valid (green padlock)
- ✅ No console errors in browser
- ✅ Backend logs show no errors

---

## 📖 Documentation
- [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md) - Complete deployment guide
- [CLEANUP_SUMMARY.md](CLEANUP_SUMMARY.md) - Cleanup details
- [README.md](README.md) - Project overview
- [docs/STRUCTURE.md](docs/STRUCTURE.md) - Architecture

---

## 🚨 Common Issues & Solutions

### Backend fails to start
```bash
# Check Python version
python3.11 --version

# Check .env exists
ls -la /opt/mytradingSignal/backend/.env

# Check Redis running
systemctl status redis-server
```

### Frontend 502 Bad Gateway
```bash
# Rebuild frontend
cd /opt/mytradingSignal/frontend
npm run build
systemctl restart trading-frontend
```

### WebSocket not connecting
```bash
# Check nginx WebSocket config
nginx -t

# Check backend logs
journalctl -u trading-backend -f | grep -i websocket
```

### SSL certificate issues
```bash
# Force renewal
certbot renew --force-renewal
systemctl reload nginx
```

---

## ⏱️ Estimated Timeline

1. **Preparation** (30 mins)
   - Generate secrets
   - Prepare .env files
   - Setup domain DNS

2. **Server Setup** (15 mins)
   - Create droplet
   - SSH access
   - Install dependencies

3. **Backend Deployment** (10 mins)
   - Clone repo
   - Setup Python env
   - Create systemd service

4. **Frontend Deployment** (10 mins)
   - Install packages
   - Build production
   - Create systemd service

5. **Nginx & SSL** (15 mins)
   - Configure reverse proxy
   - Setup SSL certificate
   - Test HTTPS

6. **Testing & Verification** (10 mins)
   - Service status checks
   - Login flow test
   - WebSocket test
   - Market data test

**Total Time: ~1.5 hours**

---

## 🎉 Ready to Deploy?

1. ✅ Review this checklist
2. ✅ Prepare .env files with real values
3. ✅ Update Zerodha redirect URL
4. ✅ Create Digital Ocean droplet
5. 📖 Open [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md)
6. 🚀 Follow step-by-step guide

**You got this! 💪**

Questions? Check:
- [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md) - Detailed guide
- [CLEANUP_SUMMARY.md](CLEANUP_SUMMARY.md) - What was changed
- GitHub Issues - Community support

Happy Trading! 🚀📈
