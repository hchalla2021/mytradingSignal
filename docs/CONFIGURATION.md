# ⚙️ Configuration Guide

## Environment Files Structure

Your application uses **standard environment files**:

```
mytradingSignal/
├── backend/
│   └── .env                    ← Backend configuration
├── frontend/
│   └── .env.local              ← Frontend configuration
```

**NO separate `.env.digitalocean` files needed!**

---

## 🔧 Backend Configuration

**File:** `backend/.env`

```bash
# ==============================================================================
# MyTradingSignal Backend Configuration
# ==============================================================================

# ==================== ZERODHA API ====================
ZERODHA_API_KEY=your_api_key_here
ZERODHA_API_SECRET=your_api_secret_here
ZERODHA_ACCESS_TOKEN=will_be_generated_on_login

# ==================== PRODUCTION URLs ====================
# Local development: Use http://localhost:3000
# Production: Use your domain
REDIRECT_URL=https://mydailytradesignals.com/api/auth/callback
FRONTEND_URL=https://mydailytradesignals.com
CORS_ORIGINS=https://mydailytradesignals.com

# ==================== JWT ====================
# CHANGE THIS IN PRODUCTION!
JWT_SECRET=your-super-secret-jwt-key-change-this

# ==================== SERVER ====================
HOST=0.0.0.0
PORT=8000
DEBUG=False

# ==================== REDIS ====================
# Local: redis://localhost:6379
# Docker: redis://redis:6379 (use container name)
REDIS_URL=redis://redis:6379

# ==================== MARKET HOURS SCHEDULER ====================
# CRITICAL: Set to true for automatic 9 AM market connection
ENABLE_SCHEDULER=true

# ==================== INSTRUMENT TOKENS ====================
NIFTY_TOKEN=256265
BANKNIFTY_TOKEN=260105
SENSEX_TOKEN=265
FINNIFTY_TOKEN=257801
MIDCPNIFTY_TOKEN=288009

# ==================== FUTURES TOKENS ====================
# Update these monthly when contracts expire
NIFTY_FUT_TOKEN=12602626
BANKNIFTY_FUT_TOKEN=12601346
SENSEX_FUT_TOKEN=292786437
```

---

## 🎨 Frontend Configuration

**File:** `frontend/.env.local`

```bash
# ==============================================================================
# MyTradingSignal Frontend Configuration
# ==============================================================================

# ==================== ENVIRONMENT DETECTION ====================
NEXT_PUBLIC_PRODUCTION_DOMAIN=mydailytradesignals.com
NEXT_PUBLIC_ENVIRONMENT=production

# ==================== API URLs ====================
# Local: http://localhost:8000
# Production: https://yourdomain.com
NEXT_PUBLIC_API_URL=https://mydailytradesignals.com

# ==================== WEBSOCKET URL ====================
# Local: ws://localhost:8000/ws/market
# Production: wss://yourdomain.com/ws/market
NEXT_PUBLIC_WS_URL=wss://mydailytradesignals.com/ws/market

# ==================== MARKET CONFIGURATION ====================
NEXT_PUBLIC_MARKET_SYMBOLS=NIFTY,BANKNIFTY,SENSEX

# ==================== PERFORMANCE SETTINGS ====================
NEXT_PUBLIC_REFRESH_INTERVAL=3000
NEXT_PUBLIC_ADVANCED_REFRESH_INTERVAL=3000
NEXT_PUBLIC_MARKET_REFRESH_INTERVAL=3000
NEXT_PUBLIC_WS_RECONNECT_DELAY=3000
NEXT_PUBLIC_WS_PING_INTERVAL=25000
NEXT_PUBLIC_API_TIMEOUT=5000
NEXT_PUBLIC_DATA_FRESHNESS_MS=60000

# ==================== FEATURES ====================
NEXT_PUBLIC_ENABLE_AI_ANALYSIS=false

# ==================== NODE SETTINGS ====================
NODE_OPTIONS=--max-old-space-size=2048
```

---

## 🏠 Local Development Setup

### 1. Create Backend `.env`
```bash
cd backend
cp .env .env.backup  # Backup if exists

# Create new .env file
cat > .env << 'EOF'
# Zerodha API
ZERODHA_API_KEY=your_key_here
ZERODHA_API_SECRET=your_secret_here
ZERODHA_ACCESS_TOKEN=will_be_generated

# Local URLs
REDIRECT_URL=http://localhost:3000/api/auth/callback
FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000,http://localhost:3003

# JWT
JWT_SECRET=dev-secret-key

# Server
HOST=0.0.0.0
PORT=8000
DEBUG=True

# Redis (local)
REDIS_URL=redis://localhost:6379

# Scheduler (optional in dev)
ENABLE_SCHEDULER=false

# Tokens
NIFTY_TOKEN=256265
BANKNIFTY_TOKEN=260105
SENSEX_TOKEN=265
NIFTY_FUT_TOKEN=12602626
BANKNIFTY_FUT_TOKEN=12601346
SENSEX_FUT_TOKEN=292786437
EOF
```

### 2. Create Frontend `.env.local`
```bash
cd frontend
cp .env.local .env.local.backup  # Backup if exists

# Create new .env.local file
cat > .env.local << 'EOF'
# Environment
NEXT_PUBLIC_PRODUCTION_DOMAIN=localhost
NEXT_PUBLIC_ENVIRONMENT=development

# Local API
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws/market

# Market Config
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
```

---

## 🚀 Production (Digital Ocean) Setup

### 1. SSH to Server
```bash
ssh root@your-droplet-ip
cd /root/mytradingSignal
```

### 2. Create Backend `.env`
```bash
cat > backend/.env << 'EOF'
# Zerodha API (PRODUCTION CREDENTIALS)
ZERODHA_API_KEY=your_production_key
ZERODHA_API_SECRET=your_production_secret
ZERODHA_ACCESS_TOKEN=will_be_generated_on_login

# Production URLs
REDIRECT_URL=https://mydailytradesignals.com/api/auth/callback
FRONTEND_URL=https://mydailytradesignals.com
CORS_ORIGINS=https://mydailytradesignals.com

# JWT (CHANGE THIS!)
JWT_SECRET=your-super-secret-production-key-$(openssl rand -hex 32)

# Server
HOST=0.0.0.0
PORT=8000
DEBUG=False

# Redis (Docker container name)
REDIS_URL=redis://redis:6379

# CRITICAL: Enable for automatic 9 AM connection
ENABLE_SCHEDULER=true

# Tokens
NIFTY_TOKEN=256265
BANKNIFTY_TOKEN=260105
SENSEX_TOKEN=265
NIFTY_FUT_TOKEN=12602626
BANKNIFTY_FUT_TOKEN=12601346
SENSEX_FUT_TOKEN=292786437
EOF

# Secure the file
chmod 600 backend/.env
```

### 3. Create Frontend `.env.local`
```bash
cat > frontend/.env.local << 'EOF'
# Environment
NEXT_PUBLIC_PRODUCTION_DOMAIN=mydailytradesignals.com
NEXT_PUBLIC_ENVIRONMENT=production

# Production URLs
NEXT_PUBLIC_API_URL=https://mydailytradesignals.com
NEXT_PUBLIC_WS_URL=wss://mydailytradesignals.com/ws/market

# Market Config
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

# Secure the file
chmod 600 frontend/.env.local
```

### 4. Deploy
```bash
./deploy_digitalocean.sh
```

---

## 🔒 Security Best Practices

### Never Commit Secrets
Your `.gitignore` already protects:
- `backend/.env`
- `frontend/.env.local`
- `.env`
- `.env.local`

### Secure Files on Server
```bash
# Set restrictive permissions
chmod 600 backend/.env
chmod 600 frontend/.env.local

# Only root can read/write
ls -la backend/.env frontend/.env.local
# Should show: -rw------- (600)
```

### Rotate Secrets Regularly
```bash
# Generate new JWT secret
openssl rand -hex 32

# Update in backend/.env
JWT_SECRET=<new_secret_here>

# Restart backend
docker-compose -f docker-compose.prod.yml restart backend
```

---

## ✅ Validation

### Check Backend Configuration
```bash
cd backend
python -c "from config import get_settings; s=get_settings(); print(f'API Key: {s.zerodha_api_key[:8]}...')"
```

### Check Environment Variables Loaded
```bash
# Backend
docker-compose -f docker-compose.prod.yml exec backend env | grep ZERODHA

# Frontend
docker-compose -f docker-compose.prod.yml exec frontend env | grep NEXT_PUBLIC
```

### Test Configuration
```bash
# Backend health
curl http://localhost:8000/health

# Frontend
curl http://localhost:3000

# WebSocket
wscat -c ws://localhost:8000/ws/market
```

---

## 🆘 Troubleshooting

### Issue: "ZERODHA_API_KEY not set"
```bash
# Check file exists
ls -la backend/.env

# Check content
cat backend/.env | grep ZERODHA_API_KEY

# Verify in container
docker-compose -f docker-compose.prod.yml exec backend env | grep ZERODHA_API_KEY
```

### Issue: Frontend shows wrong API URL
```bash
# Check .env.local
cat frontend/.env.local | grep NEXT_PUBLIC_API_URL

# Rebuild frontend (environment baked into build)
docker-compose -f docker-compose.prod.yml build frontend
docker-compose -f docker-compose.prod.yml up -d frontend
```

### Issue: Token expires daily
**This is normal!** Zerodha tokens expire every 24 hours.

**Solution**: Login between 8:00-8:45 AM on weekdays
- See: [DAILY_CHECKLIST.md](./DAILY_CHECKLIST.md)
- See: [docs/TOKEN_MANAGEMENT.md](./docs/TOKEN_MANAGEMENT.md)

---

## 📚 Related Documentation

- [Digital Ocean Deployment](./DIGITAL_OCEAN_DEPLOYMENT_CHECKLIST.md)
- [Daily Checklist](./DAILY_CHECKLIST.md)
- [Token Management](./docs/TOKEN_MANAGEMENT.md)
- [Token Fix Summary](./TOKEN_AUTH_FIX_SUMMARY.md)

---

## 💡 Quick Reference

**Backend config:** `backend/.env`  
**Frontend config:** `frontend/.env.local`  
**No separate production files needed!**

**Update config → Restart services:**
```bash
docker-compose -f docker-compose.prod.yml restart backend
docker-compose -f docker-compose.prod.yml restart frontend
```

**Last Updated**: Feb 2026 (After token auth fixes)
