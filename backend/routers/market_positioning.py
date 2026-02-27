"""
Market Positioning Intelligence Router
Isolated, self-contained endpoint delivering:
  - OI-based positioning (Long Buildup / Short Covering / Short Buildup / Long Unwinding)
  - Confidence score (0-100)
  - Direction signal (STRONG_BUY / BUY / SELL / STRONG_SELL / NEUTRAL)
  - 5-minute predictive alert based on recent trend trajectories

All config from environment. Zero impact on other routers.
"""

from fastapi import APIRouter
from datetime import datetime
from services.cache import get_cache, _SHARED_CACHE
from services.market_feed import get_market_status
import json
import time
import os

router = APIRouter(prefix="/api/market-positioning", tags=["market-positioning"])

# ─── Rolling history (in-process, per-symbol) ────────────────────────────────
# Stores last N data points to build 5-min predictive trend
_HISTORY: dict[str, list[dict]] = {"NIFTY": [], "BANKNIFTY": [], "SENSEX": []}
_MAX_HISTORY = int(os.getenv("POSITIONING_HISTORY_POINTS", "30"))  # ~5 mins @ 10s intervals
_SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"]

# ─── Signal thresholds (configurable via env) ────────────────────────────────
_STRONG_THRESHOLD  = float(os.getenv("POSITIONING_STRONG_THRESHOLD",  "70"))  # confidence >= this → STRONG
_BUY_THRESHOLD     = float(os.getenv("POSITIONING_BUY_THRESHOLD",     "55"))  # confidence >= this → BUY/SELL
_OI_CHANGE_MIN_PCT = float(os.getenv("POSITIONING_OI_CHANGE_MIN_PCT", "0.05")) # OI change threshold %
_VOL_CHANGE_MIN_PCT= float(os.getenv("POSITIONING_VOL_CHANGE_MIN_PCT","0.03")) # Vol change threshold %


def _classify_positioning(price_up: bool | None, vol_up: bool | None, oi_up: bool | None) -> dict:
    """
    Professional OI × Volume × Price positioning matrix.

    Each case returns a `clarity` field used by _calc_confidence:
      STRONG  — all 3 indicators agree          (high conviction)
      WEAK    — price + OI agree, volume absent  (quiet / cautious)
      MIXED   — volume disagrees with direction  (conflicting flows)
      NONE    — no directional signal

    Classic 4 cases (all 3 agree):
      P↑ V↑ OI↑  → Long Buildup     STRONG_BUY
      P↑ V↓ OI↓  → Short Covering   BUY
      P↓ V↑ OI↑  → Short Buildup    STRONG_SELL
      P↓ V↓ OI↓  → Long Unwinding   SELL

    Mixed 4 cases (2 of 3 agree):
      P↑ V↑ OI↓  → Unconfirmed Rally    BUY   (bull + vol, OI fading)
      P↑ V↓ OI↑  → Quiet Accumulation  BUY   (price + OI, low vol)
      P↓ V↑ OI↓  → Bear Exhaustion     SELL  (NOT fresh shorts — panic exit)
      P↓ V↓ OI↑  → Weak Short Buildup  SELL  (shorts creeping in on thin vol)
    """
    if price_up is None:
        return {
            "type": "NEUTRAL", "clarity": "NONE",
            "label": "No Clear Signal", "signal": "NEUTRAL",
            "trend": "—", "description": "Market near equilibrium — no directional bias"
        }

    # ── The classic 4: all 3 indicators agree ───────────────────────────────
    if price_up and vol_up and oi_up:
        return {
            "type": "LONG_BUILDUP", "clarity": "STRONG",
            "label": "Long Buildup", "signal": "STRONG_BUY",
            "trend": "Strong Up",
            "description": "All 3 signals aligned — fresh longs entering aggressively"
        }
    if not price_up and vol_up and oi_up:
        return {
            "type": "SHORT_BUILDUP", "clarity": "STRONG",
            "label": "Short Buildup", "signal": "STRONG_SELL",
            "trend": "Strong Down",
            "description": "All 3 signals aligned — fresh shorts entering aggressively"
        }
    if price_up and not vol_up and not oi_up:
        return {
            "type": "SHORT_COVERING", "clarity": "STRONG",
            "label": "Short Covering", "signal": "BUY",
            "trend": "Weak Up",
            "description": "Trapped shorts exiting — rally may fade without fresh longs"
        }
    if not price_up and not vol_up and not oi_up:
        return {
            "type": "LONG_UNWINDING", "clarity": "STRONG",
            "label": "Long Unwinding", "signal": "SELL",
            "trend": "Weak Down",
            "description": "Longs quietly exiting — bearish but no aggressive selling yet"
        }

    # ── Mixed 4: 2 of 3 agree ────────────────────────────────────────────────
    if price_up and vol_up and not oi_up:
        # Price + volume up but positions NOT building = speculative/retail driven
        return {
            "type": "MIXED_BULLISH", "clarity": "MIXED",
            "label": "Unconfirmed Rally", "signal": "BUY",
            "trend": "Up",
            "description": "Price + volume bullish but positions not building — watch for confirmation"
        }
    if price_up and not vol_up and oi_up:
        # Price + OI up quietly = institutional accumulation on low volume
        return {
            "type": "LONG_BUILDUP", "clarity": "WEAK",
            "label": "Quiet Accumulation", "signal": "BUY",
            "trend": "Up",
            "description": "Price + OI rising on below-avg volume — cautious institutional buying"
        }
    if not price_up and vol_up and not oi_up:
        # CRITICAL FIX: P↓ V↑ OI↓ is NOT fresh shorts — it is panic long exit / bear exhaustion
        # High volume on a fall with OI FALLING = trapped longs dumping, not new shorts entering
        # This is a potential bottoming signal, not continuation
        return {
            "type": "MIXED_BEARISH", "clarity": "MIXED",
            "label": "Bear Exhaustion", "signal": "SELL",
            "trend": "Down",
            "description": "Heavy volume selling, positions falling — trapped longs dumping, watch for reversal"
        }
    if not price_up and not vol_up and oi_up:
        # Price + OI falling with low volume = bears creeping in quietly
        return {
            "type": "SHORT_BUILDUP", "clarity": "WEAK",
            "label": "Weak Short Buildup", "signal": "SELL",
            "trend": "Down",
            "description": "Shorts slowly building on below-avg volume — low conviction, may fail"
        }

    return {
        "type": "NEUTRAL", "clarity": "NONE",
        "label": "Neutral", "signal": "NEUTRAL",
        "trend": "—", "description": "No clear positioning signal"
    }


def _calc_confidence(
    pos: dict,
    price_chg_abs: float,    # |daily changePercent| — magnitude of day's move
    vol_up: bool,            # is volume above rolling avg (confirms signal)?
    vol_dev_abs: float,      # |% deviation of current vol from rolling avg|
    tick_consistency: float, # 0.0–1.0  (fraction of recent ticks in signal direction)
) -> int:
    """
    Professional confidence model — 4 independent factors:

      1. Signal clarity   — did all 3 inputs (P/V/OI) agree? STRONG > WEAK > MIXED
      2. Price magnitude  — how far has price moved from prev close today?
                           Indian indices: <0.2% negligible, 0.5% moderate, >1% strong
      3. Volume pressure  — is volume building (confirms) or fading (reduces conviction)?
      4. Tick consistency — are recent price ticks moving monotonically with the signal?

    Hard ceiling at 92 — no market signal is ever 100% certain (professional humility).
    Hard floor  at 20 — even weak signals show some directional information.
    """
    # ── Factor 1: Signal clarity base ────────────────────────────────────────
    # STRONG  = all 3 indicators agree     (high conviction, institutions aligned)
    # WEAK    = price + OI agree, vol low  (quiet accumulation / distribution)
    # MIXED   = volume contradicts trend   (conflicting participant groups)
    clarity_base = {
        "STRONG": 62,
        "WEAK":   44,
        "MIXED":  40,
        "NONE":   18,
    }.get(pos.get("clarity", "NONE"), 18)

    # Type premium: strong conviction types get a small premium over moderate types
    type_adj = {
        "LONG_BUILDUP":   +7,   # fresh longs = premium signal
        "SHORT_BUILDUP":  +7,   # fresh shorts = premium signal
        "SHORT_COVERING":  0,   # moderate — shorts just exiting
        "LONG_UNWINDING":  0,   # moderate — longs just exiting
        "MIXED_BULLISH":  -6,   # conflicting flows = reduce
        "MIXED_BEARISH":  -6,   # conflicting flows = reduce
        "NEUTRAL":       -15,   # no signal
    }.get(pos.get("type", "NEUTRAL"), 0)

    # ── Factor 2: Price magnitude ─────────────────────────────────────────────
    # Indian indices daily range context: 0.3-1.5% is the normal band
    # Scale: 0.1% → +1.2,  0.5% → +6,  1.0% → +12,  1.5%+ → capped +15
    price_bonus = min(15, price_chg_abs * 12)

    # ── Factor 3: Volume confirmation ────────────────────────────────────────
    # Volume building WITH the signal = conviction.  Volume fading = doubt.
    if vol_up:
        # Building: +5 base + extra for how much above avg (capped at +10)
        vol_bonus = min(10, 5 + vol_dev_abs * 0.8)
    else:
        # Fading: small penalty proportional to how far below avg (max -8)
        vol_bonus = max(-8, -(vol_dev_abs * 0.5))

    # ── Factor 4: Tick consistency ────────────────────────────────────────────
    # 100% consistent ticks = institutions pushing price directionally → +10
    # 50% random ticks = choppy → +0
    tick_bonus = min(10, tick_consistency * 12)

    raw = clarity_base + type_adj + price_bonus + vol_bonus + tick_bonus
    return max(20, min(92, int(raw)))


def _build_prediction(history: list[dict], current: dict) -> dict:
    """
    Professional 5-minute prediction engine.

    4-layer market microstructure model (as top quant traders use):

      Layer 1 — Daily bias       : changePercent from prev close (trend anchor)
      Layer 2 — Tick consistency : fraction of recent ticks moving same direction
                                   (institutional flow fingerprint)
      Layer 3 — Volume pressure  : current volume vs rolling mean (accumulation/distribution)
      Layer 4 — Momentum state   : is the daily move accelerating or decelerating?

    Starts from 2 history points (~5-10 seconds after first data arrives).
    Prediction can CONTRADICT current positioning (e.g. reversal warning when
    ticks go against the daily trend) — this is the key professsional insight.
    """
    # Fires from 2nd data point onward — no more "Need more data" stall
    if len(history) < 2:
        return {
            "signal":         "NEUTRAL",
            "label":          "Collecting data…",
            "confidence":     0,
            "trend":          "—",
            "reason":         "Awaiting second data point…",
            "price_velocity": 0.0,
            "vol_velocity":   0.0,
            "tick_flow_pct":  0.0,
        }

    # ── Layer 1: Daily bias ──────────────────────────────────────────────────
    # Most reliable signal for indices — daily changePercent vs prev close.
    latest_chg = history[-1].get("change_pct", 0)

    # ── Layer 2: Tick consistency (microstructure) ───────────────────────────
    # Last 6 points ≈ 30 seconds of data at 5s poll.  Counts how many
    # consecutive ticks travelled the same direction as the daily trend.
    window   = history[-min(len(history), 6):]
    prices   = [p["price"]           for p in window]
    vols     = [p["volume"]          for p in window]
    chg_pcts = [p.get("change_pct", 0) for p in window]

    up_ticks   = sum(1 for i in range(1, len(prices)) if prices[i] > prices[i - 1])
    dn_ticks   = sum(1 for i in range(1, len(prices)) if prices[i] < prices[i - 1])
    total_moves = max(len(prices) - 1, 1)
    tick_bias   = (up_ticks - dn_ticks) / total_moves   # range: -1.0 → +1.0

    # ── Layer 3: Volume pressure ──────────────────────────────────────────────
    # Is current volume above the rolling average?  (Accumulation = bullish)
    vol_mean    = sum(vols[:-1]) / max(len(vols) - 1, 1)
    vol_building = vols[-1] > vol_mean * 1.003   # 0.3% above mean

    # ── Layer 4: Momentum acceleration ───────────────────────────────────────
    # Is the daily change_pct growing or shrinking across this window?
    chg_acceleration = chg_pcts[-1] - chg_pcts[0]   # +ve = accelerating up

    # ── Pre-compute ₹ pts window move (used in both routing + reason string) ──
    price_pts = prices[-1] - prices[0]   # e.g. −12.5 or +8.3 pts

    # ── Combine layers into a directional view ────────────────────────────────
    # Rule: microstructure (recent ticks + price_pts) overrides daily bias when
    # they clearly contradict it.  Threshold lowered 0.30 → 0.15 so that
    # "Ticks ↑ 20% bullish + price up" on a down day → bounce, not SELL.
    BIAS_THRESHOLD = 0.10  # Same as _analyse_symbol for consistency

    if latest_chg > BIAS_THRESHOLD:
        # ---- UP DAY ----
        if tick_bias >= 0.0 and chg_acceleration >= 0.0:
            # Ticks agree + accelerating → continuation bullish
            price_acc, oi_acc = True, True
            momentum = "continuation — buyers still in control"
        elif tick_bias < -0.15 or (price_pts < 0 and tick_bias < 0):
            # Ticks AND price both turning lower despite up day → reversal warning
            price_acc, oi_acc = False, True
            momentum = "⚠ reversal risk — tick flow turning bearish"
        else:
            # Up day, mild ticks → pause / consolidation before next leg
            price_acc, oi_acc = True, False
            momentum = "consolidating — steady up bias"

    elif latest_chg < -BIAS_THRESHOLD:
        # ---- DOWN DAY ----
        if tick_bias <= 0.0 and chg_acceleration <= 0.0:
            # Ticks agree + accelerating down → continuation bearish
            price_acc, oi_acc = False, True
            momentum = "continuation — sellers in control"
        elif tick_bias > 0.15 or (price_pts > 0 and tick_bias > 0):
            # Microstructure override: ticks AND/OR price moving up despite down day
            # → shorts covering / bullish bounce.  Never show SELL with all-green pills.
            price_acc, oi_acc = True, False
            momentum = "⚠ bounce attempt — shorts covering temporarily"
        else:
            # Ticks flat/negative on down day → slow exit
            price_acc, oi_acc = False, False
            momentum = "weakening — slow unwinding"

    else:
        # ---- FLAT / NEAR-ZERO DAY ----
        if tick_bias > 0.30:
            price_acc, oi_acc = True, False
            momentum = "intraday bid — watching breakout"
        elif tick_bias < -0.30:
            price_acc, oi_acc = False, False
            momentum = "intraday offer — watching breakdown"
        else:
            price_acc = None   # genuinely directionless
            oi_acc    = False
            momentum  = "range-bound — no clear bias"

    pos = _classify_positioning(price_acc, vol_building, oi_acc)

    # ── Confidence: weighted by signal strengths ──────────────────────────────
    base_conf = {
        "LONG_BUILDUP":   72,
        "SHORT_BUILDUP":  72,
        "SHORT_COVERING": 55,
        "LONG_UNWINDING": 55,
        "MIXED_BULLISH":  50,
        "MIXED_BEARISH":  50,
        "NEUTRAL":        35,
    }.get(pos["type"], 35)

    chg_bonus         = min(25, abs(latest_chg) * 10)     # bigger daily move  → more confident
    consistency_bonus = min(20, abs(tick_bias)  * 20)      # tighter tick flow  → more confident
    vol_bonus         = 8  if vol_building else 0

    conf = min(95, int(base_conf + chg_bonus + consistency_bonus + vol_bonus))

    # ── Human-readable reason ─────────────────────────────────────────────────
    tick_dir   = "↑" if tick_bias > 0.15 else ("↓" if tick_bias < -0.15 else "→")
    vol_label  = "building" if vol_building else "fading"
    vol_pct    = (vols[-1] / vol_mean - 1) * 100 if vol_mean > 0 else 0.0
    # price_pts already computed above (used for routing logic too)
    tick_flow  = abs(tick_bias) * 100     # 0–100%: how directional recent ticks are

    reason = (
        f"Price {'+' if price_pts >= 0 else ''}{price_pts:.1f} pts | "
        f"Ticks {tick_dir} {tick_flow:.0f}% "
        f"{'bullish' if tick_bias > 0 else 'bearish' if tick_bias < 0 else 'mixed'} | "
        f"Vol {vol_label} | "
        f"{momentum}"
    )

    return {
        "signal":          pos["signal"],
        "label":           pos["label"],
        "confidence":      conf,
        "trend":           pos["trend"],
        "reason":          reason,
        # ── Velocity pills (3 distinct types — each with its own format) ──
        # P  : ₹ pts across sampled window (NOT %, displayed as "±X.X pts")
        "price_velocity":  round(price_pts, 2),
        # V  : % vs session rolling avg. ≈0 when QUOTE_VOLUMES static — FE overrides with liveTick EMA
        "vol_velocity":    round(vol_pct, 4),
        # Flow: signed tick-flow −100 to +100 (% of recent ticks in signal direction)
        "tick_flow_pct":   round(tick_bias * 100, 1),
    }


def _pct_change(current: float, previous: float) -> float:
    if previous == 0:
        return 0.0
    return ((current - previous) / abs(previous)) * 100


def _analyse_symbol(symbol: str, data: dict) -> dict:
    """Core analysis for one symbol given live cache data."""
    now_ts = time.time()
    hist   = _HISTORY.setdefault(symbol, [])

    price      = float(data.get("price",  0))
    volume     = float(data.get("volume", 0))
    oi         = float(data.get("oi",     0))
    change_pct = float(data.get("changePercent", 0))  # Daily % from prev close

    # Append to rolling history (include change_pct for prediction use)
    hist.append({"price": price, "volume": volume, "oi": oi,
                 "change_pct": change_pct, "ts": now_ts})
    if len(hist) > _MAX_HISTORY:
        hist.pop(0)

    if len(hist) < 2 or price == 0:
        return {
            "symbol":       symbol,
            "price":        price,
            "change_pct":   change_pct,
            "volume":       volume,
            "oi":           oi,
            "positioning":  _classify_positioning(None, None, None),
            "confidence":   0,
            "signal":       "NEUTRAL",
            "changes":      {"price": 0, "volume": 0, "oi": 0},
            "prediction":   {"signal": "NEUTRAL", "label": "Collecting data…", "confidence": 0, "reason": ""},
            "timestamp":    datetime.now().isoformat(),
        }

    prev = hist[-2]

    # ── Price direction: use daily changePercent (robust for index instruments) ──
    # Tick-to-tick delta between 5s polls is micro-noise (<0.005%) and always kills
    # the threshold check. Daily changePercent is always a meaningful, non-zero signal.
    PRICE_DIR_THRESHOLD = 0.10  # indices must be ≥0.10% from prev close to show direction
    if change_pct > PRICE_DIR_THRESHOLD:
        price_up = True
    elif change_pct < -PRICE_DIR_THRESHOLD:
        price_up = False
    else:
        price_up = None  # Genuinely flat for the day (rare, near open price)
    pr_chg = change_pct  # Use daily % for confidence magnitude calc

    # ── Volume direction: compare current vs rolling average ──
    # QUOTE_VOLUMES is near-static tick-to-tick; rolling average reveals true buildup
    vol_history = [p["volume"] for p in hist[:-1]]
    vol_avg = sum(vol_history) / len(vol_history) if vol_history else volume
    vol_up  = volume > vol_avg * 1.005  # 0.5% above rolling average → volume building
    vol_chg = _pct_change(volume, vol_avg)

    # ── OI direction ──
    # NSE spot indices (NIFTY/BANKNIFTY/SENSEX): Zerodha sends oi=0 always.
    # For futures tokens: real OI is available → use tick-to-tick change.
    # For indices: synthesise from price-tick consistency (monotone movement
    # across the last 3 samples = fresh positions being built).
    oi_chg = _pct_change(oi, prev["oi"])
    if oi > 0:
        # Real OI data (futures subscription)
        oi_up = oi_chg >= _OI_CHANGE_MIN_PCT
    else:
        # Synthetic OI proxy for index spot instruments
        recent_prices = [p["price"] for p in hist[-3:]]
        if len(recent_prices) >= 3:
            # Monotone rise with bullish bias OR monotone fall with bearish bias
            # = new positions being directionally built
            monotone_up   = all(a <= b for a, b in zip(recent_prices, recent_prices[1:]))
            monotone_down = all(a >= b for a, b in zip(recent_prices, recent_prices[1:]))
            if price_up is True and monotone_up:
                oi_up = True
            elif price_up is False and monotone_down:
                oi_up = True
            else:
                oi_up = False  # Choppy / reversing
        else:
            oi_up = False

    # ── Tick consistency (0.0–1.0) ──────────────────────────────────────────
    # Fraction of recent ticks moving monotonically in the signal direction.
    # Used by confidence model — high consistency = institutions driving the move.
    _win = hist[-min(len(hist), 6):]
    _up  = sum(1 for i in range(1, len(_win)) if _win[i]["price"] > _win[i - 1]["price"])
    _dn  = sum(1 for i in range(1, len(_win)) if _win[i]["price"] < _win[i - 1]["price"])
    _tot = max(len(_win) - 1, 1)
    tick_consistency = abs(_up - _dn) / _tot   # 0.0 = perfectly choppy, 1.0 = perfectly monotone

    positioning = _classify_positioning(price_up, vol_up, oi_up)

    # ── Dynamic description with live metric values ──────────────────────────
    # Overwrite the generic template with actual numbers so the trader sees real data.
    if positioning["type"] != "NEUTRAL":
        positioning = dict(positioning)   # shallow copy — never mutate the template
        direction_arrow = "↑" if pr_chg  > 0 else "↓"
        vol_arrow       = "↑" if vol_chg > 0 else "↓"
        tick_pct        = int(tick_consistency * 100)
        positioning["description"] = (
            f"{positioning['description']} — "
            f"Price {direction_arrow}{abs(pr_chg):.2f}% | "
            f"Vol {vol_arrow}{abs(vol_chg):.1f}% vs avg | "
            f"{tick_pct}% tick flow"
        )

    confidence = _calc_confidence(positioning, abs(pr_chg), vol_up, abs(vol_chg), tick_consistency)
    prediction = _build_prediction(hist, data)

    # ── Tick-to-tick ₹ price velocity (for the P/V/OI matrix badge) ──────────
    # Daily changePercent is already shown in the card header — the matrix badge
    # should show HOW FAST price is moving right now (points per 5s poll).
    price_tick = round(price - prev["price"], 2)   # e.g. +3.50 or -2.80 pts

    # ── Tick flow % (directional ticks as OI proxy when oi=0) ────────────────
    tick_flow = round(tick_consistency * 100, 1)   # 0–100 %, 100 = all ticks same dir

    return {
        "symbol":      symbol,
        "price":       price,
        "change_pct":  change_pct,
        "volume":      volume,
        "oi":          oi,
        "positioning": positioning,
        "confidence":  confidence,
        "signal":      positioning["signal"],
        "changes": {
            "price":      round(pr_chg,  4),  # daily % (same as header — kept for compat)
            "price_tick": price_tick,          # ₹ tick-to-tick velocity (pts per 5s)
            "volume":     round(vol_chg, 4),   # % above/below session rolling avg
            "oi":         round(oi_chg,  4),   # tick-to-tick % of total F&O OI
            "tick_flow":  tick_flow,            # % of recent ticks in signal direction
        },
        "prediction":  prediction,
        "timestamp":   datetime.now().isoformat(),
        "market_status": get_market_status(),
    }


def _get_data_from_shared_cache(symbol: str) -> dict | None:
    """
    Read market data directly from _SHARED_CACHE, intentionally bypassing TTL.
    The 5-second TTL on market data means during sparse ticks / closed market
    get_market_data() returns None even though the key exists.  We want the
    latest available data regardless of staleness.
    """
    raw = _SHARED_CACHE.get(f"market:{symbol}")
    if raw:
        try:
            value, _expire = raw   # (json_str, expire_timestamp) – ignore expiry
            data = json.loads(value)
            if isinstance(data, dict) and data.get("price", 0) > 0:
                return data
        except Exception:
            pass
    return None


async def _get_symbol_data(symbol: str) -> dict | None:
    """
    Try live cache first (respects TTL); fall back to stale-but-present
    entry from _SHARED_CACHE so the section never shows empty.
    """
    # get_cache() is SYNCHRONOUS — do not await it
    cache = get_cache()
    data = await cache.get_market_data(symbol)
    if data and data.get("price", 0) > 0:
        return data
    # Fallback: stale entry (market closed or sparse ticks)
    return _get_data_from_shared_cache(symbol)


@router.get("")
@router.get("/")
async def get_market_positioning():
    """
    Market Positioning Intelligence — all three symbols.
    Reads from in-memory cache only (zero Zerodha API calls).
    """
    result = {}
    for symbol in _SYMBOLS:
        data = await _get_symbol_data(symbol)
        if data:
            result[symbol] = _analyse_symbol(symbol, data)
        else:
            result[symbol] = {
                "symbol": symbol, "price": 0, "volume": 0, "oi": 0,
                "positioning": _classify_positioning(None, None, None),
                "confidence": 0, "signal": "NEUTRAL",
                "changes": {"price": 0, "volume": 0, "oi": 0},
                "prediction": {"signal": "NEUTRAL", "label": "No data", "confidence": 0, "reason": ""},
                "timestamp": datetime.now().isoformat(),
                "market_status": get_market_status(),
            }
    return result


@router.get("/{symbol}")
async def get_symbol_positioning(symbol: str):
    """Market Positioning Intelligence — single symbol."""
    symbol = symbol.upper()
    if symbol not in _SYMBOLS:
        return {"error": f"Symbol {symbol} not supported"}
    data = await _get_symbol_data(symbol)
    if data:
        return _analyse_symbol(symbol, data)
    return {
        "symbol": symbol, "price": 0, "volume": 0, "oi": 0,
        "positioning": _classify_positioning(None, None, None),
        "confidence": 0, "signal": "NEUTRAL",
        "changes": {"price": 0, "volume": 0, "oi": 0},
        "prediction": {"signal": "NEUTRAL", "label": "No data", "confidence": 0, "reason": ""},
        "timestamp": datetime.now().isoformat(),
        "market_status": get_market_status(),
    }
