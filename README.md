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

## Automated Paper Trading (Observatory chart only)

Open **Market Intelligence Observatory - Entry / exit chart - Automated Paper Trading**.
The Advanced Chart tab and its existing overlays/settings remain unchanged.
Only that chart's selected index, selected intraday timeframe and completed candles
create paper signals. Other dashboard sections, external predictions and historical
browsing never generate paper entries. Keep the live chart mounted for new signals;
the backend continues monitoring accepted trades when the browser is closed.

Independent strategy books compare price/EMA crosses and bounces (9/20/50/100/200),
all EMA-pair crosses, daily CPR/traditional/Camarilla level reactions, previous-day
high/low, 20-bar structure breakouts, candle patterns with EMA trend, and the
chart's confirmed setup. Indicator calculations and level-reaction rules reuse the
existing chart helpers. Hidden chart indicators are still evaluated; indicator
warm-up and missing previous-day data limit which strategies are available.
The full closed-candle setup, EMA values, level reactions, volume availability,
VWAP, candle patterns and market structure are saved with each entry.
Cash-index volume/VWAP are explicitly unavailable when absent; futures prices
and volume are **not** substituted into the Observatory's cash-index chart.

### Paper execution assumptions

- No broker/order API is called. Prices represent **one synthetic index unit**,
  not an executable futures/options contract; P&L excludes fees/taxes.
- Each index/timeframe/strategy has one independent open book. Books can overlap;
  their summed points are not a deployable portfolio return.
- Entries fill on the first fresh index tick **after** the chart signal reaches
  the server, never retrospectively at the signal candle's close. The signal
  close, observed trigger tick and simulated fill are recorded separately.
- Market entries/exits have 0.5-point adverse slippage. The default stop is
  exactly **10 points from the entry fill**, and the comparison target is
  **20 points (2R)**, independently of the chart's suggested structural stop.
  Targets fill at their resting limit, with no favourable gap improvement;
  stop-market fills use the observed crossing quote plus slippage, so losses
  can exceed 10 points. Unobserved intratick paths are never invented.
- Opposite signals in the same strategy book close and reverse on the next
  quote. Duplicate candle/strategy/direction messages are idempotent across
  refreshes and backend restarts; same-direction signals cannot stack positions.
- Signals expire after the next chart interval. Freshness checks reject stale,
  future, out-of-order and invalid quotes. Exchange timestamps are preferred,
  with receipt timestamps explicitly identified when exchange time is absent.
- Weekday cash session: 09:15-15:30 IST. Square-off requires an observed quote;
  with no quote after the cutoff, trades stay open and reports explicitly await
  exit quotes. A later-day quote records `SESSION_CLOSE_DELAYED`, never a
  fabricated prior-day fill or target hit.

The ledger records winners **and losers**, entry/exit timestamps, prices, points,
P&L, target achievement, exit reasons, maximum favourable/adverse excursion with
timestamps, one-time near-target/near-stop events (within 2 points), reversals,
and targets reached after an earlier exit in the same session. A non-target exit
within 2 points of target is also marked as a missed target.

Day reports include totals, wins/losses, stops, targets, reversals, net points and
best/worst strategies. Reports are automatically persisted after market close
and revised when delayed exits arrive. Historical rankings group by strategy
or observed indicator combination **and index/timeframe**, showing sample size,
win rate, expectancy and realized average-win/average-loss risk/reward.
Rankings are descriptive/in-sample, sorted by expectancy then win rate; the UI
defaults to at least five closed trades. Small/correlated samples are not proof
of future performance.

SQLite storage: `backend/data/paper_trading/paper_trading.sqlite3` (WAL, no automatic record
deletion). Back up this database using SQLite's backup API and retain the backend
data volume across deployments. Production Compose mounts the dedicated
`paper-trading-data` named volume; do not remove it when recreating containers.
A crash can lose ticks still in the in-memory
ingest queue; already committed signals/trades/events survive restarts.
Processing failures are logged and exposed in paper-engine health; do not trust
results while feed/engine errors are shown.

API: `POST /api/paper-trading/signals` (chart-only frame),
`GET /api/paper-trading/history?day=YYYY-MM-DD&limit=100&offset=0`,
`GET /api/paper-trading/events?trade_id=...`, `GET /api/paper-trading/report?day=YYYY-MM-DD`.
The tab exports a consistent complete day JSON ledger/report including all trade
events, and paginates without deleting older trades.

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
