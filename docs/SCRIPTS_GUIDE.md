# Setup Scripts Guide

## Available Scripts

### 🔧 Token Management

#### `quick_token_fix.py`
**Purpose:** Quick and easy token regeneration with browser auto-open  
**When to use:** When your token expires (daily at 3:30 AM IST)  
**Usage:**
```bash
python quick_token_fix.py
```
**Features:**
- Auto-opens Zerodha login in browser
- Guides you through the process
- Updates .env file automatically
- Works on Windows, Mac, Linux

---

### 📊 Status & Health

#### `check_market_status.py`
**Purpose:** Check market status and validate token  
**When to use:** Before trading hours to verify everything is ready  
**Usage:**
```bash
python check_market_status.py
```
**Shows:**
- Current market phase (PRE_OPEN, LIVE, CLOSED)
- Token validity status
- Connection test to Zerodha
- NIFTY quote sample

---

### 🚀 Startup Scripts (Windows)

#### `start-clean.ps1`
**Purpose:** Clean startup with port cleanup and cache clearing  
**When to use:** When you need a fresh start or have port conflicts  
**Usage:**
```powershell
.\start-clean.ps1
```
**Features:**
- Kills existing backend/frontend processes
- Frees up ports 8000 and 3000
- Cleans Next.js cache
- Starts both servers in separate windows
- Verifies both servers are running

#### `start-fast.ps1`
**Purpose:** Fast concurrent startup (advanced)  
**When to use:** For quick development iterations  
**Usage:**
```powershell
.\start-fast.ps1
```
**Features:**
- Starts backend and frontend concurrently
- Shows startup progress
- Monitors health endpoints
- Streams logs from both services
- Background job management

---

### 🐳 Docker Deployment

#### `docker-compose.yml`
**Purpose:** Containerized deployment  
**When to use:** Production deployment or isolated testing  
**Usage:**
```bash
docker-compose up -d          # Start services
docker-compose logs -f        # View logs
docker-compose down           # Stop services
```

---

## 🧪 Testing Scripts

#### `test_ws_client.py`
**Purpose:** Test WebSocket connection  
**Usage:**
```bash
python test_ws_client.py
```

#### `test_orchestration.py`
**Purpose:** Test all system components  
**Usage:**
```bash
python test_orchestration.py
```

---

## 📋 Quick Reference

### Common Workflows

#### First Time Setup
```bash
# 1. Install dependencies
cd backend
pip install -r requirements.txt

cd ../frontend
npm install

# 2. Configure environment
# Edit backend/.env with your Zerodha credentials

# 3. Generate token
cd ..
python quick_token_fix.py

# 4. Start servers
.\start-clean.ps1
```

#### Daily Startup (Token Valid)
```powershell
.\start-fast.ps1
```

#### Token Expired (After 24 hours)
```bash
# 1. Generate new token
python quick_token_fix.py

# 2. Backend auto-reconnects (no restart needed!)
# Or manually restart if needed:
.\start-clean.ps1
```

#### Troubleshooting
```bash
# Check if everything is configured correctly
python check_market_status.py

# Test WebSocket connection
python test_ws_client.py

# Test all components
python test_orchestration.py
```

---

## 🗑️ Removed Files (No Longer Needed)

The following files were removed for production readiness:

**Development/Testing (Removed):**
- ❌ `check_market_status.py` - Backend /health endpoint does same
- ❌ `start-clean.ps1` - Windows dev only, use manual startup
- ❌ `start-fast.ps1` - Windows dev only, use manual startup
- ❌ `test_orchestration.py` - Testing only, not production
- ❌ `test_ws_client.py` - Testing only, not production

**Redundant Setup Files (Previously Removed):**
- ❌ `do_setup.sh` - Linux/Digital Ocean setup only
- ❌ `setup_token_cron.sh` - Linux cron job setup only
- ❌ `setup_token_task.ps1` - Overly complex Windows scheduler
- ❌ `auto_token_refresh.py` - Token watcher handles this automatically
- ❌ `manual_token_refresh.py` - `quick_token_fix.py` is better
- ❌ `quick_start.ps1` - Redundant startup script
- ❌ `QUICK_REFERENCE.txt` - Outdated Digital Ocean guide

---

## 💡 Tips

### Token Management
- Tokens expire every 24 hours (at 3:30 AM IST)
- Backend has automatic token watcher - updates without restart
- Use `quick_token_fix.py` for manual token regeneration
- No need for cron jobs or task scheduler on Windows

### Development
- Use `start-fast.ps1` for quick development iterations
- Use `start-clean.ps1` when you encounter port/cache issues
- Backend auto-reloads on code changes (with `--reload` flag)
- Frontend auto-refreshes on code changes

### Production
- Use Docker Compose for production deployment
- Set up proper environment variables
- Configure reverse proxy (nginx) for HTTPS
- Set up monitoring and logging

---

## 📚 Documentation

For detailed documentation, see [`docs/`](../docs/) folder:
- [Token Automation](../docs/TOKEN_AUTOMATION_README.md)
- [Zerodha Auth Setup](../docs/ZERODHA_AUTH_SETUP.md)
- [Quick Start Guide](../docs/QUICKSTART_ANALYSIS.md)
- [Architecture](../docs/VISUAL_ARCHITECTURE.md)

---

**Last Updated:** January 6, 2026
