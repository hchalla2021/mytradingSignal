# 📈 MyDailyTradingSignals

Real-time trading dashboard for NIFTY, BANKNIFTY, and SENSEX with Zerodha Kite API integration.

**Strategy Workspace** groups MarketEdge Intelligence, Trend Base (Higher-Low Structure),
Expiry Explosion Zone, and CRT-Based BTST Strategies into four section tabs. The selector uses
two columns on phones/iPads and four on desktop, consistent sans-serif typography, readable
12px minimum small text, and 48px minimum touch targets. All panels remain mounted for live
updates and state preservation. Trend Base and BTST include independent index tabs.

**Market Analysis** combines Advanced SMC & Market Structure, Greeks Overview, Today's Market
Regime, Volume Pulse, ICT Bias, and Institutional Compass into six section tabs. Only one section
is visible; all stay mounted to preserve live updates and nested index selections. The selector
uses two columns on phones, three on tablets, and six on wide desktops, with keyboard navigation
and 48px minimum touch targets. Volume Pulse now also has NIFTY / BANKNIFTY / SENSEX index tabs.

**Smart AI & Institutional Flow** combines Smart AI Algo, Big Player Radar, FII/DII Flow,
and Official Cash Flow into one workspace. A shared NIFTY / BANKNIFTY / SENSEX selector
controls the three index-specific views. Official Cash Flow is market-wide with its reporting
date, so the index selector is hidden there. Feature tabs use a two-by-two phone layout and
a single row on tablets/desktops, with 44px touch targets and consistent sans-serif typography.
Algo cards remain mounted, preserving unsaved lots and parameters; a single flow provider
keeps chart snapshots updating even when the Algo view is selected. Per-index flow figures
are estimates, not official transactions; allocated fallback values are labeled accordingly.

**Live Market Indices** uses compact NIFTY, BANKNIFTY, and SENSEX tabs, with NIFTY selected
by default and one full-width card visible at a time on mobile and desktop. All three cards
continue receiving live updates while hidden. Use Left/Right arrows or Home/End to switch
tabs with the keyboard. Equal-width, touch-friendly tabs use an emerald selected state and
underline; exchange badges appear on tablet/desktop and collapse on phones to keep labels aligned.
**AI Signal Deck** uses the same tabs with its own independent selection, defaulting to NIFTY.
Hidden signal cards stay mounted and continue receiving ticks, preserving analysis and animation state.
**Advanced SMC & Market Structure** and **Greeks Overview** share the same responsive index tabs.
Each defaults independently to NIFTY; hidden cards keep their state and live updates. Missing SMC
data shows a building-structure message for the selected index instead of hiding its tab.
**Strike Intelligence** also uses these tabs for its detailed per-index strike cards, keeping the
cross-index terminal overview above them. Its selection is independent and hidden cards retain live data.

The standalone **Market Liquidity** dashboard section and its dedicated browser stream/polling
hook have been removed. Other liquidity views and the backend liquidity service remain available;
the Observatory still consumes that service.
The main dashboard also omits **Candle Intelligence Engine** and **Smart Money / Order Logic**.
The candle engine remains available in the trade-status module; shared order-flow hooks and
backend services are preserved for other consumers.

The Advanced Chart synchronizes visible pane ranges only when they differ and resizes canvases
only when their actual dimensions change. Unchanged live OHLCV frames skip redundant candle writes;
indicator tail updates start at the engine's first changed bar to avoid repeatedly resetting plotted data.

### Futures Chart

Chart views adapt to phones and tablets (including touch-screen iPad landscape).
Manual drawing controls and their sidebar tab are removed from Advanced Chart, preserving
the full plot width. Chart panning, zooming, crosshair, indicators, CPR and paper-level overlays remain available.
Indicator/setup controls overlay the plot instead of pushing it down. History, paper overlays,
futures contract settings and detailed readouts use expandable menus without remounting charts.
Timeframes scroll horizontally; controls retain 44px touch targets, and mobile selects use 16px
text to avoid iOS input zoom. **Full chart** expands either view to the browser viewport without
requiring the native Fullscreen API (works on iOS); Exit full chart or Escape restores the dashboard.
The page scroll lock is restored on exit/unmount. Charts resize with viewport/orientation changes;
desktop drawing rails remain available. Pan/zoom and data/strategy calculations are unchanged.

Switching index/contract or interval fits a recent candle group in both charts, with balanced
left/right padding and width-aware spacing for phones, tablets and desktops instead of leaving
half the plot empty. Sparse new sessions are centred too. Hidden charts defer this until they have a visible size. Resizing preserves
centring only while the view is still centred; manual panning and live ticks do not continually
reset the view. Explicit Advanced Chart history/range controls keep their selected range.

The Advanced Chart / Futures Chart / Automated Paper Trading workspace is the first dashboard
section, below the shared header and system/connection status banners. **Live Market Indices**
is the second section, immediately below the chart workspace. Its institutional snapshot
continues to come from the institutional-flow workspace, regardless of visual section order.

The Advanced Chart, Futures Chart, Futures Advanced Chart, and Automated Paper Trading view
selectors use matching section-title typography, emerald active styling, and at least 52px
touch targets. Phones show a two-column grid; tablets and desktops show four aligned,
equal-width tabs. All working tabs remain available.

The cash-index Advanced Chart omits the unsupported 1-minute option. Working chart controls
still disable temporarily when loading or when their action is not currently available,
including futures contract selection and the footprint view before order flow is recorded.

All three charts use the same near-month futures delta box for the selected index.
The measured delta remains labelled estimated and is shown as **Buyer / Seller pressure** only.
The box shows 🟢 BUY / 🔴 SELL only on the candle where the PRO gate (below) confirms an entry,
🔵 HOLD while that trade is open, and 🟡 WAIT otherwise; stale, disconnected, archived, future-dated,
off-session or failed feeds always show WAIT. Production
cash-chart WebSocket reconnects use the configured/same-origin server, never localhost fallbacks.

### PRO confirmation gate (the only source of BUY / SELL)

Advanced Chart, Futures Chart and Futures Advanced Chart all show one shared **PRO GATE** panel
(`frontend/lib/pro-confluence.ts`, `frontend/hooks/useProConfluence.ts`). It evaluates **closed 5m
near-month futures candles** with recorded order flow and gives BUY or SELL only when **every** check passes:

| Check | BUY (SELL is the mirror) |
|---|---|
| History / window | ≥ 50 closed candles; signal candle closes 09:30–15:00 IST |
| Trend | EMA 9 > 21 > 50, close above session VWAP |
| Higher timeframes | 15m and 60m: none against, at least one with |
| Candle | Green, closes in the upper half of its range |
| Delta / CVD | Recorded delta ≥ +15% of volume (≥ 60% coverage), CVD rising over 3 candles |
| Open interest | Not short build-up (passes when OI is not reported) |
| Stretch / stop | ≤ 1.5 ATR from EMA 21; engine stop 0.3–2 ATR away |
| Room | Nearest resistance / PDH at least 1.5R away |
| Score / flip | Confluence score ≥ 70 with gap ≥ 35; previous candle did not lean the other way |

Each check is listed with ✔ / ✘ and its live value, so the reason for every WAIT is visible.
Plan: entry = signal close (replay enters next candle open), SL = engine stop, T1 = 1.5R (book half,
SL to breakeven), T2 = 3R, exit by 15:15 IST, 3-candle cool-down after a stop. Today's signals are
replayed without look-ahead and drawn as `✔ BUY/SELL` and `EXIT` labels plus SL/T1/T2 lines on all three
charts (shifted by the recorded basis onto the cash Advanced Chart); the panel shows today's W/L and points.
The older VWAP, rejection-engine, recorded-OF, candle-flow and server-guidance BUY/SELL labels are no
longer drawn; the Futures Advanced "Score engine" shows bias only. Delta aggressor side is estimated
from Kite ticks, and bars without a recording fail the delta check by design.
**No system wins every trade** — the gate filters weak and counter-trend entries; always use the stop-loss.

### Level battle (break or reject?)

All three charts also show a **LEVEL BATTLE** panel and a chart overlay (`frontend/lib/level-battle.ts`,
`frontend/lib/level-battle-primitive.ts`, `frontend/hooks/useLevelBattle.ts`, `frontend/components/LevelBattle.tsx`).
Levels come from each chart's own candles: EMA 9/20/21/50/100/200, session VWAP (futures charts), and from
the previous session Camarilla R1–R4/S1–S4, CPR TC/P/BC, pivot R1/R2/S1/S2 and PDH/PDL. Lines closer than
two zones merge into one confluence zone.

- **Zone** = 0.25 × ATR(14) of 5m near-month futures; a level is **AT** inside the zone, **NEAR** within 1.2 ATR.
  The nearest support and resistance are always shown (max 4 levels).
- **Buyers / Sellers** = recorded futures volume traded inside the zone today and in the last 30 minutes,
  plus resting bids/asks from the 5-level book when the level is close. The cash chart maps levels to futures via the recorded basis.
- **Factors** (positive = level holds): zone and recent buy/sell imbalance, last 3 candles' delta push,
  approach speed, earlier rejects/breaks today, repeated tests, confluence, EMA 21 vs 50 trend and book ratio.
- **Call:** hold ≥ 65% → **REJECT**, ≤ 35% → **BREAK**, otherwise **NEUTRAL**; shown as ↑% / ↓% with points
  to the next level above and below. The zone flashes while price is testing it.

These are estimates from sampled, aggressor-estimated ticks — wait for the candle to close at the level and always use the stop-loss.

The Observatory's **Futures Chart** tab is separate from the cash-index chart and paper trading.
Use the responsive NIFTY / BANKNIFTY / SENSEX index tabs (not an index dropdown),
then select an expiry year and contract. The tabs share the dashboard's emerald active style,
equal-width touch targets and Arrow/Home/End keyboard navigation. Switching index resets the
expiry selection to its nearest listed contract while retaining the interval.
Contracts come from
Zerodha's NFO/BFO instrument master using actual exchange expiry dates, not estimated month-end dates.
October/November/December 2026 and 2027 expiries appear only if currently listed by Zerodha;
future candles and unavailable contracts are never invented. The nearest listed expiry is the default.

Near-month intraday candles use the existing same-contract order-flow WebSocket (about one update
per second when ticks change). Only contiguous, gap-free recordings from the candle's opening minute
can supply live OHLCV; partial startup/gap recordings never replace official historical candles.
The status distinguishes LIVE from HISTORY; stale/disconnected, off-session, daily and other-expiry
views do not claim to be live. Official history reconciles every 20 seconds after each request.
Recorded ticks are sampled, not an exchange trade-by-trade feed.
The chart plots EMA 9/20, session VWAP and traded volume from the **same selected contract**.
EMA 9/20 use the existing SMA-seeded incremental engine and need 9/20 candles respectively.
RVOL 20 is current candle volume divided by the average volume of the previous 20 candles,
excluding the current bar. Intraday windows reset each IST session; daily windows span days.
No ratio is shown before a full baseline or when baseline volume is zero. Forming RVOL is provisional.
Volume bars at RVOL >= 2 are highlighted; green/red represents candle direction, not aggressor delta.
True volume-at-price footprint and buyer/seller delta are explicitly unavailable: Zerodha historical
OHLCV does not contain the trade-level aggressor data required to reconstruct them accurately.
No candle-color or synthetic bid/ask estimates are presented as real footprint/delta.
Unchanged history does not reset chart data; candle-tail revisions/appends use series updates,
while historical corrections, contract switches, and interval changes rebuild the series.
The futures endpoint skips unused daily-pivot context, making one broker history request per
uncached page rather than two. Recently viewed contract/interval snapshots are retained in a
bounded browser memory cache and shown immediately on return while refreshing; their original
refresh timestamps are preserved so cached snapshots cannot masquerade as fresh data.
Contract lists are cached for one hour within the IST date; Refresh / retry forces revalidation.
The default NIFTY five-minute contract/history and futures bundle warm in the background shortly
after the chart workspace mounts, instead of waiting for the Futures tab click. Warm data renders
on the first frame. After first opening, the futures view remains mounted across workspace tab
switches to preserve expiry/interval/zoom; its polling and stream pause while hidden.
After the selected futures chart loads, the nearest contracts for the other indices are warmed
sequentially at the selected interval. Switching to a warm chart displays its snapshot immediately;
foreground loads share any in-flight preload, and a fresh snapshot is not fetched twice.
Warm-up failures are logged and remain retryable; snapshots never cross contract/index/interval keys.
VWAP uses cumulative HLC3 times volume divided by cumulative volume, resetting each IST date.
It is unavailable on daily charts or without volume.
The latest history window is 14 days intraday or one year daily, limited by the contract's available history.
Changing expiry never stitches contracts or mixes futures volume with cash-index prices.
This tab does not generate paper orders.

**VWAP-only entry/exit calculation (reference):** a closed candle must cross its session VWAP or bounce/reject
VWAP as support/resistance, close in the trade direction and directional half of its range,
and have volume at least the average of the
previous five same-session bars. No EMA/RSI/Supertrend confirmations are calculated for this strategy.
Support bounces start above the prior VWAP, wick through both prior and current VWAP, and close
back above both; resistance rejections use the symmetric below-to-above wick and close below both.
Stops use the latest three-bar swing plus one actual contract tick; targets are 1R and 2R.
Only one setup is tracked at a time, with no new setup whose candle closes at/after 15:10 IST.
Its BUY/SELL, T1 and EXIT labels are no longer drawn on the chart; chart labels come only from the PRO gate.
These are hypothetical closed-OHLC replay levels, not executed trades: entry uses the next completed
bar's open, T1 books half, and the remaining stop moves to breakeven starting the following bar.
Stop takes priority when stop and target both occur in one candle; adverse stop gaps use the worse open.
The position exits at session close (or the last observed candle if session-end data is missing).
Fees and slippage are excluded. Polling delays both entries and exits; no guaranteed performance is implied.
Current guidance is disabled on daily intervals, failed/stale refreshes, delayed candles, or outside
the weekday IST trading session; historical labels remain explicitly replay-only.

APIs: `GET /api/chart-intelligence/futures/contracts?symbol=NIFTY` and
`GET /api/chart-intelligence/futures/history?symbol=NIFTY&token=<listed-token>&interval=5`.
The history API also accepts `before=YYYY-MM-DD` for earlier pages.
A valid Zerodha session and applicable exchange/historical-data permissions are required.
Failures are shown explicitly; refresh and last-candle timestamps distinguish stale candles from fresh requests.

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

## Automated Paper Trading (Chart strategies + confirmed recorded order flow)

Open **Market Intelligence Observatory - Entry / exit chart - Automated Paper Trading**.
The Advanced Chart tab and its existing overlays/settings remain unchanged.
The existing cash-index indicator books use only that chart's selected index, selected intraday
timeframe and completed candles. Other dashboard sections, external predictions and historical
browsing never generate paper entries. Keep the live chart mounted for new signals;
the backend continues monitoring accepted trades when the browser is closed.

### Recorded order flow: confirm, then trade

A separate durable futures paper book observes the **same recorded OF BUY/SELL signals** displayed
on Advanced and Futures charts. It does not read chart pixels or count the same signal twice.
Candle-inferred big-player labels are excluded. The backend monitors NIFTY, BANKNIFTY and SENSEX
near-month futures at five-minute resolution, even when no chart/paper tab or browser is open.
The backend/feed must remain running and connected. Existing indicator strategies are unchanged.

- Newly observed signals enter `WATCHING`, not a trade. Old historical replay fills are never imported;
  a signal must be first seen within 30 seconds of its candle closing, on a fresh recorded feed.
- Confidence must be at least 60. Wait for the **next full five-minute candle** to close with complete
  recording, directional price movement beyond the signal close, and same-direction recorded delta.
  Stop/T1 touches (including recovered touches), opposing OF signals, and contract changes reject the setup.
- A successful confirmation becomes `ARMED`. Entry requires a subsequent fresh **same-token exchange
  tick**, within 15 seconds; no historical close or confirmation-time tick is used as a fill.
  Price must still hold the signal level, risk must remain within 1.25x the original structural risk,
  and at least 1.5R must remain to the original T2. No chasing/rebasing of targets to make a trade fit.
- One active OF setup/trade per index. No new entry at/after 15:10 IST. Original structural stop/T2
  are monitored from received futures ticks; first observed quote from 15:25 squares off.
  An unquoted old contract remains open/awaiting exit quotes, never closed using a new expiry or cash price.
- Market fills include adverse max(0.5, tick size) points; targets use the resting target price.
  Gaps over 30 seconds are recorded; unobserved intra-gap stop/target paths are unknown.
  Results are **futures points per unit, excluding fees**, not rupee or cash-index P&L.

The paper tab has a separate OF ledger and counts for `WATCHING`, `ARMED`, `OPEN`, `CLOSED`,
`REJECTED` and `EXPIRED`, with independently paginated history, per-setup decisions/events,
immutable original signal and confirmation evidence, and day-report JSON export. Futures totals
are deliberately not combined with the cash-index strategy rankings. This is a conservative,
deterministic paper experiment, not a profitability guarantee or live broker execution.

Independent strategy books compare price/EMA crosses and bounces (9/20/50/100/200),
all EMA-pair crosses, daily CPR/traditional/Camarilla level reactions, previous-day
high/low, 20-bar structure breakouts, candle patterns with EMA trend, and the
chart's confirmed setup. Indicator calculations and level-reaction rules reuse the
existing chart helpers. Hidden chart indicators are still evaluated; indicator
warm-up and missing previous-day data limit which strategies are available.
The full closed-candle setup, EMA values, level reactions, volume availability,
Candles, patterns and market structure are saved with each entry.
VWAP is removed from the cash-index Advanced Chart: no control, overlay, rejection level,
level-confirmation filter, inferred-flow confluence, or new cash-paper VWAP strategy/tag is evaluated.
Saved templates cannot re-enable it. Historical paper records remain unchanged.
Futures VWAP and futures-only guidance remain available.
Cash-index volume is explicitly unavailable when absent; futures prices
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
`GET /api/paper-trading/history?day=YYYY-MM-DD&limit=100&offset=0&flow_offset=0`
(`order_flow` contains the separate confirmed-futures ledger),
`GET /api/paper-trading/events?trade_id=...`, `GET /api/paper-trading/report?day=YYYY-MM-DD`.
The tab exports a consistent complete day JSON ledger/report including all trade
events, and paginates without deleting older trades.

---

## Order Flow (Futures Chart + Advanced Chart)

Drawn directly on the candles (no panels): only **big-player Buy Order Flow / Sell
Order Flow** prints, at most 2 per session. A closed candle qualifies only when all of
these hold (score >= 85):

- a setup: stop-run reversal (sweeps the 10-bar extreme and closes back), absorption
  wick (>= 55% of range) or an aggressive drive candle (body >= 65%, range >= 1.6x avg);
- big participation: volume >= 2.5x the 20-bar average (range >= 2x when volume is absent);
- a major level: PDH/PDL/PDC, day high/low, opening range, VWAP, EMA20/50 or a round
  number (NIFTY 100, BANKNIFTY/SENSEX 500); crash/climax moves into the level add weight;
- recorded tick flow (when available) must not disagree; opposing delta vetoes the print.

Every print is then validated: entry at the close, stop beyond the candle extreme, and it
must reach the minimum points (NIFTY 20, BANKNIFTY 50, SENSEX 60, or 0.8 ATR if larger)
within 10 bars before the stop. Confirmed prints show `+N pts`; the newest unresolved
print is a dashed "confirming" label; failed prints are hidden but still counted in the
"Flow valid X/Y" figure next to the chart, so the hit rate is never overstated.
FII/DII identity is not in any live feed: "big player" means volume and range anomalies
at key levels, which is an estimate, not a guarantee.
Labels never overlap: ENTRY/EXIT labels take priority, and on the futures chart labels
stay above the volume bars. The
heavier overlays (footprint, profile, POC/VAH/VAL, walls, delta strip, SL/T1/T2 plan)
remain available via `OrderFlowPrimitive({ detail: true, ... })`.

- `GET /api/order-flow/snapshot?symbol=NIFTY&interval=5m`
- `GET /api/order-flow/replay?symbol=NIFTY&interval=5m` (paper replay, fees + slippage)
- `WS /ws/order-flow?symbol=NIFTY&interval=5m`

Limits (shown in the UI tooltip): the aggressor side is **estimated** (Lee-Ready on
Kite ~1/s full-mode snapshots), only the near-month contract is recorded, the
footprint exists only from when the backend started recording, confidence is a
rule score rather than a probability, and nothing is ever executed — paper only.
Restart the backend after updating so the order-flow router is loaded.

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
docker compose -f docker-compose.prod.yml config --quiet
docker compose -f docker-compose.prod.yml up -d --build
```

Production images exclude local environment files and keep backend secrets in the runtime
`env_file`/mount. The frontend defaults to same-origin API/WebSocket URLs; configure the production
reverse proxy to forward `/api` and `/ws` to the backend. `NEXT_PUBLIC_*` values, when explicitly
supplied, must be present at frontend build time, not just container startup.
Health checks use Python/Node already installed in the respective images, without requiring curl.
The frontend build creates an empty `public` directory when no static assets exist.
Keep the `paper-trading-data` volume when rebuilding so both paper ledgers survive deployments.
Keep `order-flow-data` too: `ORDER_FLOW_DB_PATH` points the live footprint/delta recording
database into that volume so recordings survive container recreation. Existing deployments
must back up and migrate any old `/app/data/order_flow.sqlite3` recording before switching
to `/app/data/order_flow/order_flow.sqlite3`; the new volume does not import it automatically.
Custom `.next*` build-check directories are excluded from the frontend Docker context.

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
