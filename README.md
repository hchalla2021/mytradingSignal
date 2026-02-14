# 📈 MyDailyTradingSignals

Real-time trading dashboard for NIFTY, BANKNIFTY, and SENSEX with Zerodha Kite API integration.

---

## 🚀 Quick Start

### Local Development
```powershell
.\start.ps1
```

### Production Deployment
```powershell
# 1. Prepare production configuration
.\prepare_production.ps1

# 2. Deploy to Digital Ocean
git push origin main
# SSH to server and run: ./deploy_digitalocean.sh
```

### Check Production Readiness
```powershell
.\check_production.ps1
```

---

## 📁 Project Structure

```
mytradingSignal/
├── backend/              # Python FastAPI backend
├── frontend/             # Next.js frontend
├── docs/                 # Complete documentation
├── scripts/              # Utility scripts
├── archive/              # Old scripts (archived)
│
├── start.ps1                    # 🚀 Start system
├── deploy_digitalocean.sh       # 🌐 Deploy to production
├── prepare_production.ps1/.sh   # ⚙️ Prepare for deployment
└── check_production.ps1         # ✅ Validate production readiness
```

---

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| [DEPLOYMENT_SUMMARY.md](DEPLOYMENT_SUMMARY.md) | Quick deployment guide |
| [PRODUCTION_READINESS_REPORT.md](PRODUCTION_READINESS_REPORT.md) | Complete audit report |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Environment setup |
| [docs/DIGITAL_OCEAN_DEPLOYMENT_CHECKLIST.md](docs/DIGITAL_OCEAN_DEPLOYMENT_CHECKLIST.md) | Deployment steps |
| [docs/DAILY_CHECKLIST.md](docs/DAILY_CHECKLIST.md) | Daily operations |

---

## ⚙️ Architecture

```
Zerodha WebSocket → Python Backend → Redis Cache → FastAPI WebSocket → Next.js UI
```

**Backend:** FastAPI + KiteTicker + Redis  
**Frontend:** Next.js 14 + TypeScript + TailwindCSS  
**Deployment:** Docker Compose on Digital Ocean

---

## ⚠️ Important: Daily Login Required

Zerodha tokens expire every 24 hours at midnight.

**Login Window:** 8:00 AM - 8:45 AM (before market open)

**What Happens:**
- 8:50 AM: System validates token
- 8:55 AM: Connects to Zerodha (if valid)
- 9:00 AM: Live market data flows automatically

**If You Forget:** Frontend shows "LOGIN REQUIRED" (no reconnection loops)

See [docs/DAILY_CHECKLIST.md](docs/DAILY_CHECKLIST.md) for details.

---

## 🛠️ Environment Configuration

**Backend:** `backend/.env`
```env
ZERODHA_API_KEY=your_key
ZERODHA_API_SECRET=your_secret
ENABLE_SCHEDULER=true
REDIS_URL=redis://localhost:6379
```

**Frontend:** `frontend/.env.local`
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws/market
```

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for complete setup.

---

## 🎯 Features

- ✅ Real-time market data (Zerodha KiteTicker WebSocket)
- ✅ Token expiry handling (no reconnection loops)
- ✅ Market hours scheduler (automatic 9 AM connection)
- ✅ EMA-based trading signals (20/50/100/200 EMA)
- ✅ VWAP 5-minute live data
- ✅ Volume analysis (Futures contracts)
- ✅ Dark theme trader-friendly UI
- ✅ WebSocket live updates
- ✅ Docker production deployment

---

## 🔧 Development Commands

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Docker
```bash
docker-compose up --build
```

---

## 📦 Archive Folder

Old deployment/diagnostic scripts have been moved to `archive/` folder to keep the project clean. These are kept for reference but are not needed for production.

---

## 📞 Support

**Deployment Issues:** See [DEPLOYMENT_SUMMARY.md](DEPLOYMENT_SUMMARY.md)  
**Token Issues:** See [docs/TOKEN_MANAGEMENT.md](docs/TOKEN_MANAGEMENT.md)  
**Configuration:** See [docs/CONFIGURATION.md](docs/CONFIGURATION.md)

---

## 📄 License

See [LICENSE](LICENSE) file for details.

---

**Last Updated:** February 2026  
**Status:** ✅ Production Ready
