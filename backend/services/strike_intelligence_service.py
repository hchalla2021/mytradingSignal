"""
🎯 Strike Intelligence Engine
==============================
Per-strike option chain analysis for NIFTY/BANKNIFTY/SENSEX.
Computes ATM ± 5 strikes with PE/CE volume, OI, price action,
liquidity scoring → STRONG_BUY / BUY / NEUTRAL / SELL / STRONG_SELL.

DATA SOURCE: Zerodha instruments cache + quote API (via PCRService pattern).
             Reads spot price from CacheService ("market:{SYMBOL}").
             Zero impact on other services — fully isolated.

PERSISTENCE: Stores last snapshot to disk so data survives market close.
             On restart / closed market, serves cached data.

CADENCE:     Live market  → every 5s
             Closed       → every 60s (serve cached)

ISOLATION: Own ConnectionManager, own asyncio task, own singleton.
"""

import asyncio
import json
import logging
import math
import time as time_mod
from datetime import datetime, time, date
from typing import Dict, Any, Optional, List, Set
from pathlib import Path

from fastapi import WebSocket
import pytz

from services.cache import CacheService, _SHARED_CACHE
from services.global_indices_service import get_global_indices_service
from config import get_settings

logger = logging.getLogger(__name__)
IST = pytz.timezone("Asia/Kolkata")
settings = get_settings()

SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"]

# Strike step sizes per index
STRIKE_STEP: Dict[str, int] = {
    "NIFTY": 50,
    "BANKNIFTY": 100,
    "SENSEX": 100,
}

NUM_STRIKES_EACH_SIDE = 5  # ATM ± 5

# Persistent file
PERSISTENT_FILE = Path(__file__).parent.parent / "data" / "strike_intelligence_state.json"


# ── Isolated WebSocket manager ───────────────────────────────────────────────

class StrikeIntelConnectionManager:
    """Completely isolated WebSocket manager for Strike Intelligence."""

    def __init__(self):
        self._connections: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        async with self._lock:
            self._connections.add(ws)

    async def disconnect(self, ws: WebSocket):
        async with self._lock:
            self._connections.discard(ws)

    async def broadcast(self, data: Dict[str, Any]):
        if not self._connections:
            return
        msg = json.dumps(data, default=str)
        dead: Set[WebSocket] = set()
        async with self._lock:
            clients = list(self._connections)
        for ws in clients:
            try:
                await asyncio.wait_for(ws.send_text(msg), timeout=3.0)
            except Exception:
                dead.add(ws)
        if dead:
            async with self._lock:
                self._connections -= dead

    async def send_personal(self, ws: WebSocket, data: Dict[str, Any]):
        try:
            await asyncio.wait_for(
                ws.send_text(json.dumps(data, default=str)), timeout=3.0
            )
        except Exception:
            await self.disconnect(ws)


strike_intel_manager = StrikeIntelConnectionManager()


# ── Helpers ──────────────────────────────────────────────────────────────────

def _safe_float(v, default: float = 0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (ValueError, TypeError):
        return default


def _safe_int(v, default: int = 0) -> int:
    try:
        return int(v) if v is not None else default
    except (ValueError, TypeError):
        return default


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _chunked(items: List[str], size: int) -> List[List[str]]:
    return [items[i:i + size] for i in range(0, len(items), size)]


def _get_atm_strike(spot: float, step: int) -> int:
    """Round spot price to nearest strike (standard half-up, not banker's rounding)."""
    return int(spot / step + 0.5) * step


def _approx_delta(spot: float, strike: float) -> float:
    """
    Synthetic CE delta using a logistic approximation of Black-Scholes N(d1).
    ATM (spot==strike) → 0.5  |  deep ITM → ~0.95  |  deep OTM → ~0.05
    Uses a 5% normalised moneyness as a proxy for one standard deviation.
    """
    if spot <= 0 or strike <= 0:
        return 0.5
    m = (spot - strike) / (spot * 0.05)   # normalised moneyness
    return 1.0 / (1.0 + math.exp(-m * 1.6))


# ── Black-Scholes Implied Volatility & Greeks ────────────────────────────────
# Risk-free rate: RBI repo rate approximation for Indian markets.
_INDIA_RFR = 0.065
_SQRT_2PI  = math.sqrt(2.0 * math.pi)
_SQRT_2    = math.sqrt(2.0)


def _norm_pdf(x: float) -> float:
    """Standard normal PDF φ(x)."""
    return math.exp(-0.5 * x * x) / _SQRT_2PI


def _norm_cdf(x: float) -> float:
    """Standard normal CDF Φ(x) via complementary error function (numerically stable)."""
    return 0.5 * math.erfc(-x / _SQRT_2)


def _bs_price(S: float, K: float, T: float, r: float, sigma: float, opt_type: str) -> float:
    """Black-Scholes analytical option price.  opt_type: 'CE' (call) or 'PE' (put)."""
    if T <= 1e-9 or sigma <= 1e-9:
        return max(0.0, S - K) if opt_type == "CE" else max(0.0, K - S)
    sqrt_T = math.sqrt(T)
    d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrt_T)
    d2 = d1 - sigma * sqrt_T
    if opt_type == "CE":
        return S * _norm_cdf(d1) - K * math.exp(-r * T) * _norm_cdf(d2)
    return K * math.exp(-r * T) * _norm_cdf(-d2) - S * _norm_cdf(-d1)


def _bs_vega_raw(S: float, K: float, T: float, r: float, sigma: float) -> float:
    """Raw vega ∂Price/∂σ — used by Newton-Raphson IV solver; equals S·φ(d1)·√T."""
    if T <= 1e-9 or sigma <= 1e-9 or S <= 0:
        return 0.0
    sqrt_T = math.sqrt(T)
    d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrt_T)
    return S * _norm_pdf(d1) * sqrt_T


def _implied_vol(
    market_price: float,
    S: float,
    K: float,
    T: float,
    r: float,
    opt_type: str,
    *,
    max_iter: int = 50,
    tol: float = 0.005,
) -> Optional[float]:
    """
    Newton-Raphson Implied Volatility solver.

    Returns annualised IV as decimal (e.g. 0.145 = 14.5%), or None on failure.
    Handles near-zero premiums, expiry-day options, and extreme moneyness robustly.

    Convergence criterion: |BS_price - market_price| < tol (₹0.005 default).
    """
    if market_price < 0.5 or S <= 0 or K <= 0 or T < 1e-6:
        return None
    intrinsic = max(0.0, S - K) if opt_type == "CE" else max(0.0, K - S)
    if market_price < intrinsic:
        return None   # price below intrinsic = data/arbitrage error
    # Brenner-Subrahmanyam approximation as starting point: σ ≈ √(2π/T) × (price/S)
    try:
        sigma = _clamp(math.sqrt(2.0 * math.pi / T) * (market_price / S), 0.01, 4.0)
    except Exception:
        sigma = 0.20
    for _ in range(max_iter):
        try:
            diff = _bs_price(S, K, T, r, sigma, opt_type) - market_price
            if abs(diff) < tol:
                break
            vega = _bs_vega_raw(S, K, T, r, sigma)
            if vega < 1e-8:
                break
            sigma = _clamp(sigma - diff / vega, 0.005, 5.0)
        except (ValueError, ZeroDivisionError, OverflowError):
            return None
    if sigma < 0.005 or sigma > 4.99:
        return None
    # Validate final convergence (ensure BS price within ₹2 of market)
    try:
        if abs(_bs_price(S, K, T, r, sigma, opt_type) - market_price) > 2.0:
            return None
    except Exception:
        return None
    return round(sigma, 4)


def _option_greeks(
    S: float,
    K: float,
    T: float,
    r: float,
    sigma: float,
    opt_type: str,
) -> Dict[str, Optional[float]]:
    """
    Analytical Black-Scholes Greeks.
      delta : 0→1 for CE, -1→0 for PE  (directional exposure per ₹1 spot move)
      gamma : ∂delta/∂S per ₹1 spot move — same formula for CE and PE
      theta : ₹ time decay per calendar day  (negative = premium erodes daily)
      vega  : ₹ price change per +1% annualised IV  (always positive)
    """
    null_g: Dict[str, Optional[float]] = {"delta": None, "gamma": None, "theta": None, "vega": None}
    if T <= 1e-9 or sigma <= 1e-9 or S <= 0 or K <= 0:
        return null_g
    try:
        sqrt_T = math.sqrt(T)
        d1     = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrt_T)
        d2     = d1 - sigma * sqrt_T
        pdf_d1 = _norm_pdf(d1)
        exp_rT = math.exp(-r * T)
        delta  = _norm_cdf(d1) if opt_type == "CE" else _norm_cdf(d1) - 1.0
        gamma  = pdf_d1 / (S * sigma * sqrt_T)
        base_t = -(S * pdf_d1 * sigma) / (2.0 * sqrt_T)
        theta  = (base_t - r * K * exp_rT * _norm_cdf(d2))  / 365.0 if opt_type == "CE" \
            else (base_t + r * K * exp_rT * _norm_cdf(-d2)) / 365.0
        vega   = S * pdf_d1 * sqrt_T / 100.0   # per 1% IV move
        return {
            "delta": round(delta, 3),
            "gamma": round(gamma, 5),
            "theta": round(theta, 2),
            "vega":  round(vega,  2),
        }
    except (ValueError, ZeroDivisionError, OverflowError):
        return null_g


def _dte_from_expiry(expiry_str: str) -> float:
    """
    Calendar days to expiry from a date string (e.g. '2025-01-30').
    Returns 0.0 on expiry day; defaults to 7 DTE if string cannot be parsed.
    """
    try:
        expiry_date = datetime.strptime(str(expiry_str)[:10], "%Y-%m-%d").date()
        today = datetime.now(IST).date()
        return max(0.0, float((expiry_date - today).days))
    except Exception:
        return 7.0   # safe fallback: assume ~1 week


def _compute_signal(
    ce_oi: int, pe_oi: int, ce_volume: int, pe_volume: int,
    ce_price: float, pe_price: float, ce_change: float, pe_change: float,
    spot: float, strike: int,
    ce_oi_change: int = 0, pe_oi_change: int = 0,
    dte: float = 0.0,
) -> Dict[str, Any]:
    """
    Compute buy/sell signal for a single strike from CE & PE data.

    Scoring factors:
      1. Volume imbalance     (±30) — Which side has more volume
      2. OI positioning       (±15) — OI buildup direction (writers vs holders)
      3. Price momentum       (±30) — Premium % change (most real-time indicator)
      4. Liquidity depth      (±10) — Total flow as market depth proxy
      5. Moneyness bias       (±10) — ITM premium is more actionable

    Advanced factors:
      6. BSL/SSL zone         (±12) — OI concentration above/below spot = institutional walls
      7. BOS structure        (±10) — CE/PE price divergence at ATM = breakout confirmation
      8. Delta-weighted vol   (±8)  — Moneyness-adjusted volume pressure
      9. Trap detection       (−15) — High volume but price moves against = absorption trap
     10. OI Change interp     (±20) — Long Buildup / Short Buildup / SC / LU interpretation
         11. Advanced price action(±12) — Impulse continuation vs exhaustion/noise filter

    CE score > 0 → calls active/rising → bullish for underlying
    PE score > 0 → puts active/rising → bearish for underlying
    """
    total_oi  = ce_oi  + pe_oi
    total_vol = ce_volume + pe_volume

    # ── CE Score ─────────────────────────────────────────────────────────

    ce_score = 0.0

    # 1. Volume dominance (±30)
    if total_vol > 0:
        ce_score += (ce_volume / total_vol - 0.5) * 2.0 * 30

    # 2. OI positioning (±15) — high CE OI = heavy writing = resistance = bearish for CE
    if total_oi > 0:
        ce_score += (0.5 - ce_oi / total_oi) * 2.0 * 15

    # 3. Price momentum (±30)
    # Use a floor for premium denominator to avoid extreme ratios on near-zero premiums.
    if ce_price > 0:
        ce_momentum_base = max(ce_price, 20.0)
        ce_score += _clamp((ce_change / ce_momentum_base) * 100 * 5, -30, 30)

    # 4. Liquidity depth (±10)
    if total_vol > 100:
        liq = min(math.log10(max(total_vol, 1)) / 6.0, 1.0)
        ce_score += liq * 10 if ce_volume > pe_volume else -liq * 10

    # 5. Moneyness (±10)
    if spot > 0:
        m = (spot - strike) / spot * 100
        ce_score += min(m * 2, 10) if m > 0 else max(m * 1.5, -10)

    # ── PE Score ─────────────────────────────────────────────────────────

    pe_score = 0.0

    # 1. Volume dominance (±30)
    if total_vol > 0:
        pe_score += (pe_volume / total_vol - 0.5) * 2.0 * 30

    # 2. OI positioning (±15) — high PE OI = bearish positioning = bullish PE signal
    if total_oi > 0:
        pe_score += (pe_oi / total_oi - 0.5) * 2.0 * 15

    # 3. Price momentum (±30)
    if pe_price > 0:
        pe_momentum_base = max(pe_price, 20.0)
        pe_score += _clamp((pe_change / pe_momentum_base) * 100 * 5, -30, 30)

    # 4. Liquidity depth (±10)
    if total_vol > 100:
        liq = min(math.log10(max(total_vol, 1)) / 6.0, 1.0)
        pe_score += liq * 10 if pe_volume > ce_volume else -liq * 10

    # 5. Moneyness (±10)
    if spot > 0:
        m = (strike - spot) / spot * 100
        pe_score += min(m * 2, 10) if m > 0 else max(m * 1.5, -10)

    # ═══════════════════════════════════════════════════════════════════════
    #  ADVANCED FACTOR 6: BSL / SSL Liquidity Zone
    # ═══════════════════════════════════════════════════════════════════════
    # BSL (Buy-Side Liquidity) = Stops sitting above spot → large CE OI above ATM
    #   → call writers defending that ceiling → resistance → headwind for CE buyers
    # SSL (Sell-Side Liquidity) = Stops sitting below spot → large PE OI below ATM
    #   → put writers defending that floor → support → tailwind for CE holders
    #
    # Only applies when strike is within 2% of spot (high-relevance zone)
    # ───────────────────────────────────────────────────────────────────────
    liq_type_ce: Optional[str] = None
    liq_type_pe: Optional[str] = None

    if spot > 0 and total_oi > 10_000:
        dist_ratio = (strike - spot) / spot          # + = above spot, – = below
        oi_weight  = min(math.log10(max(total_oi, 1)) / 7.0, 1.0)

        if 0.0 <= dist_ratio < 0.02:                 # Strike at/just above spot → BSL zone
            ce_dominance = (ce_oi - pe_oi) / (total_oi + 1)
            if ce_dominance > 0:                     # Call wall above = resistance
                liq_type_ce = "BSL"
                liq_type_pe = "BSL"
                ce_score -= ce_dominance * oi_weight * 12   # resistance headwind for CE
                pe_score += ce_dominance * oi_weight * 8    # ceiling confirmed = put support

        elif -0.02 < dist_ratio < 0.0:               # Strike just below spot → SSL zone
            pe_dominance = (pe_oi - ce_oi) / (total_oi + 1)
            if pe_dominance > 0:                     # Put wall below = support
                liq_type_ce = "SSL"
                liq_type_pe = "SSL"
                pe_score -= pe_dominance * oi_weight * 12   # floor being defended = bearish for PE
                ce_score += pe_dominance * oi_weight * 8    # support confirmed = tailwind for CE

    # ═══════════════════════════════════════════════════════════════════════
    #  ADVANCED FACTOR 7: BOS (Break of Structure)
    # ═══════════════════════════════════════════════════════════════════════
    # BOS UP:   CE price surging + PE price falling at near-ATM strike
    #           = market momentum confirms bullish structural break
    # BOS DOWN: PE price surging + CE price falling at near-ATM strike
    #           = market momentum confirms bearish structural break
    #
    # Proximity-weighted: strongest at ATM, fades for far OTM/ITM strikes
    # ───────────────────────────────────────────────────────────────────────
    bos_signal: Optional[str] = None

    if ce_price > 0 and pe_price > 0 and spot > 0:
        # Low premiums can make percentage change unstable; use sensible floors.
        ce_bos_base = max(ce_price, 20.0)
        pe_bos_base = max(pe_price, 20.0)
        ce_pct = (ce_change / ce_bos_base) * 100
        pe_pct = (pe_change / pe_bos_base) * 100
        # Proximity to ATM: 1.0 at ATM, 0 at 3% away
        atm_prox = max(0.0, 1.0 - abs(spot - strike) / (spot * 0.03))

        divergence = ce_pct - pe_pct               # CE rising / PE falling = bullish BOS
        bos_boost  = _clamp(divergence * atm_prox * 0.7, -10, 10)
        ce_score  += bos_boost
        pe_score  -= bos_boost                     # inverted for PE

        if divergence > 3.0 and atm_prox > 0.25:
            bos_signal = "UP"
        elif divergence < -3.0 and atm_prox > 0.25:
            bos_signal = "DOWN"

    # ═══════════════════════════════════════════════════════════════════════
    #  ADVANCED FACTOR 8: Delta-Weighted Volume
    # ═══════════════════════════════════════════════════════════════════════
    # Synthetic delta scales volume impact by option moneyness:
    #   ITM option volume = bigger real market exposure (delta ≈ 0.8–0.95)
    #   OTM option volume = smaller exposure (delta ≈ 0.05–0.3)
    # Delta-adjusted CE vol dominating → stronger bullish signal than raw vol alone
    # ───────────────────────────────────────────────────────────────────────
    ce_delta = _approx_delta(spot, float(strike))
    pe_delta = 1.0 - ce_delta                      # put delta complement

    if total_vol > 0:
        ce_dv = ce_delta * ce_volume / (total_vol + 1)   # 0–1 range
        pe_dv = pe_delta * pe_volume / (total_vol + 1)
        delta_push = (ce_dv - pe_dv) * 16               # ±8 max
        ce_score  += delta_push
        pe_score  -= delta_push

    # ═══════════════════════════════════════════════════════════════════════
    #  ADVANCED FACTOR 9: Trap Detection
    # ═══════════════════════════════════════════════════════════════════════
    # A trap (absorption) occurs when:
    #   — One side dominates volume (many retail buyers piling in)
    #   — BUT that side's option price is flat or falling
    #   → Institutions are absorbing retail orders = price won't move their way
    #   → Strong negative signal for the "trapped" side
    #
    # Examples:
    #   CE Trap: CE volume > 60% of total BUT ce_change <= 0 → calls being sold into buyers
    #   PE Trap: PE volume > 60% of total BUT pe_change <= 0 → puts being sold into buyers
    # ───────────────────────────────────────────────────────────────────────
    trap_ce = False
    trap_pe = False

    if total_vol > 5_000:
        ce_vol_dom = ce_volume / (total_vol + 1)
        pe_vol_dom = pe_volume / (total_vol + 1)

        # Ignore ultra-low premiums in trap logic to reduce expiry-day false traps.
        if ce_price >= 5.0 and ce_vol_dom > 0.60:
            ce_pct_chg_ratio = ce_change / ce_price
            if ce_pct_chg_ratio < -0.02:             # Vol up but price falling = CE trap
                trap_ce = True
                ce_score -= 15

        if pe_price >= 5.0 and pe_vol_dom > 0.60:
            pe_pct_chg_ratio = pe_change / pe_price
            if pe_pct_chg_ratio < -0.02:             # Vol up but price falling = PE trap
                trap_pe = True
                pe_score -= 15

    # ═══════════════════════════════════════════════════════════════════════
    #  ADVANCED FACTOR 10: OI Change Interpretation (Long/Short Buildup, Covering)
    # ═══════════════════════════════════════════════════════════════════════
    # Pro traders read the OI change quadrant every 5 minutes:
    #
    #  Quadrant              OI Δ   Price Δ   Meaning               CE/PE Impact
    #  ─────────────────────────────────────────────────────────────────────────
    #  Long Buildup   (LB)   + OI   + Price   Fresh longs entering   CE: +bullish / PE: +bearish
    #  Short Buildup  (SB)   + OI   − Price   Fresh shorts entering  CE: −bearish / PE: −bullish
    #  Short Covering (SC)   − OI   + Price   Shorts exiting (mild)  CE: +(mild)   / PE: +(mild)
    #  Long Unwinding (LU)   − OI   − Price   Longs exiting (mild)   CE: −(mild)   / PE: −(mild)
    #
    # Magnitude scales with OI change size; capped at ±20.
    # Minimum threshold (≥200 contracts) prevents expiry-day micro-noise.
    # ───────────────────────────────────────────────────────────────────────
    _OI_MIN_CHANGE = 50    # minimum absolute OI Δ to trigger scoring

    oiInterp_ce: Optional[str] = None
    oiInterp_pe: Optional[str] = None

    # CE OI change interpretation
    if ce_oi > 500 and abs(ce_oi_change) >= _OI_MIN_CHANGE:
        chg_ratio = ce_oi_change / ce_oi      # + = buildup, − = unwinding
        magnitude = min(abs(chg_ratio) * 200, 20.0)
        if ce_oi_change > 0:
            if ce_change >= 0:
                ce_score += magnitude          # Long Buildup: fresh call buyers → bullish
                oiInterp_ce = "LB"
            else:
                ce_score -= magnitude          # Short Buildup: call writers → bearish
                oiInterp_ce = "SB"
        else:
            half = magnitude * 0.5
            if ce_change > 0:
                ce_score += half               # Short Covering: shorts exit → mild bullish
                oiInterp_ce = "SC"
            else:
                ce_score -= half               # Long Unwinding: longs exit → mild bearish
                oiInterp_ce = "LU"

    # PE OI change interpretation
    if pe_oi > 500 and abs(pe_oi_change) >= _OI_MIN_CHANGE:
        chg_ratio = pe_oi_change / pe_oi
        magnitude = min(abs(chg_ratio) * 200, 20.0)
        if pe_oi_change > 0:
            if pe_change >= 0:
                pe_score += magnitude          # Long Buildup: fresh put buyers → bearish underlying
                oiInterp_pe = "LB"
            else:
                pe_score -= magnitude          # Short Buildup: put writers → bullish underlying
                oiInterp_pe = "SB"
        else:
            half = magnitude * 0.5
            if pe_change > 0:
                pe_score += half               # Short Covering in puts
                oiInterp_pe = "SC"
            else:
                pe_score -= half               # Long Unwinding in puts
                oiInterp_pe = "LU"

    # ═══════════════════════════════════════════════════════════════════════
    #  ADVANCED FACTOR 11: Premium Impulse Continuation vs Exhaustion
    # ═══════════════════════════════════════════════════════════════════════
    # Distinguishes directional continuation from noisy volatility expansion.
    #
    # 1) Continuation edge:
    #    - CE relative move up while PE relative move down (or vice versa)
    #    - Strong near ATM where directional information quality is highest
    #
    # 2) No-edge filter:
    #    - Both CE and PE expanding in same direction at similar intensity
    #    - Usually volatility expansion/churn, so reduce both scores
    #
    # 3) OTM exhaustion filter:
    #    - Deep OTM + very low premium + one-sided jump often mean-reverts
    #    - Penalize those spikes to avoid fragile breakout chasing
    # ───────────────────────────────────────────────────────────────────────
    pa_state_ce: Optional[str] = None
    pa_state_pe: Optional[str] = None

    if ce_price > 0 and pe_price > 0 and spot > 0:
        ce_rel_move = ce_change / max(ce_price, 20.0)
        pe_rel_move = pe_change / max(pe_price, 20.0)
        rel_divergence = ce_rel_move - pe_rel_move
        near_atm_weight = max(0.15, 1.0 - abs(strike - spot) / (spot * 0.02))
        same_direction = ce_rel_move * pe_rel_move > 0

        if rel_divergence > 0.045 and not same_direction:
            impulse_boost = _clamp(rel_divergence * near_atm_weight * 140.0, 0.0, 12.0)
            ce_score += impulse_boost
            pe_score -= impulse_boost * 0.8
            pa_state_ce = "IMPULSE_CONTINUATION"
            pa_state_pe = "OPPOSITE_WEAKNESS"
        elif rel_divergence < -0.045 and not same_direction:
            impulse_boost = _clamp(abs(rel_divergence) * near_atm_weight * 140.0, 0.0, 12.0)
            pe_score += impulse_boost
            ce_score -= impulse_boost * 0.8
            pa_state_pe = "IMPULSE_CONTINUATION"
            pa_state_ce = "OPPOSITE_WEAKNESS"
        elif same_direction and abs(ce_rel_move) > 0.03 and abs(pe_rel_move) > 0.03:
            noise_penalty = _clamp((abs(ce_rel_move) + abs(pe_rel_move)) * 40.0, 0.0, 6.0)
            ce_score -= noise_penalty
            pe_score -= noise_penalty
            pa_state_ce = "VOL_EXPANSION_NO_EDGE"
            pa_state_pe = "VOL_EXPANSION_NO_EDGE"

        dist_pct = abs(strike - spot) / spot * 100.0
        if dist_pct > 1.5:
            if ce_price < 15.0 and ce_rel_move > 0.10:
                ce_score -= 4.0
                pa_state_ce = "OTM_EXHAUSTION"
            if pe_price < 15.0 and pe_rel_move > 0.10:
                pe_score -= 4.0
                pa_state_pe = "OTM_EXHAUSTION"

    # ── Score → Signal conversion ─────────────────────────────────────────

    def _score_to_signal(score: float) -> str:
        if   score >=  46: return "STRONG_BUY"
        elif score >=  18: return "BUY"
        elif score <= -46: return "STRONG_SELL"
        elif score <= -18: return "SELL"
        return "NEUTRAL"

    def _score_to_pct(score: float) -> Dict[str, float]:
        clamped = _clamp(score, -110, 110)
        abs_s   = abs(clamped)
        if clamped >= 0:
            buy_pct  = 50.0 + abs_s * 0.40
            sell_pct = 50.0 - abs_s * 0.32
        else:
            sell_pct = 50.0 + abs_s * 0.40
            buy_pct  = 50.0 - abs_s * 0.32
        neutral_pct = max(0.0, 10.0 - abs_s * 0.09)
        total = buy_pct + sell_pct + neutral_pct
        # Integer percentages — avoids decimal bleed like "3.2%N" in the UI
        b = int(round(buy_pct     / total * 100))
        s = int(round(sell_pct    / total * 100))
        n = int(round(neutral_pct / total * 100))
        # Correct any ±1 rounding error so they always sum to 100
        diff = 100 - b - s - n
        b += diff  # absorb rounding error into the dominant (buy/sell) bucket
        return {"buyPct": b, "sellPct": s, "neutralPct": n}

    # ═══════════════════════════════════════════════════════════════════════
    #  IMPLIED VOLATILITY & GREEKS (Black-Scholes analytical)
    # ═══════════════════════════════════════════════════════════════════════
    # T = time fraction in years; floor at 1 calendar day to prevent T→0 instability.
    T = max(dte, 1.0) / 365.0
    S = float(spot)
    K = float(strike)

    # Implied Volatility via Newton-Raphson solver
    ce_iv: Optional[float] = _implied_vol(ce_price, S, K, T, _INDIA_RFR, "CE") if ce_price >= 0.5 else None
    pe_iv: Optional[float] = _implied_vol(pe_price, S, K, T, _INDIA_RFR, "PE") if pe_price >= 0.5 else None

    # Greeks — use BS analytical delta when IV solved, else fall back to synthetic delta
    if ce_iv is not None:
        ce_g = _option_greeks(S, K, T, _INDIA_RFR, ce_iv, "CE")
    else:
        ce_g = {"delta": round(ce_delta, 3), "gamma": None, "theta": None, "vega": None}

    if pe_iv is not None:
        pe_g = _option_greeks(S, K, T, _INDIA_RFR, pe_iv, "PE")
    else:
        pe_g = {"delta": round(pe_delta, 3), "gamma": None, "theta": None, "vega": None}

    return {
        "ce": {
            "signal":    _score_to_signal(ce_score),
            "score":     round(ce_score, 1),
            "breakdown": _score_to_pct(ce_score),
            "oi":        ce_oi,
            "oiChange":  ce_oi_change,
            "volume":    ce_volume,
            "price":     round(ce_price, 2),
            "change":    round(ce_change, 2),
            "signals": {
                "liq":      liq_type_ce,
                "bos":      bos_signal,
                "advPriceAction": pa_state_ce,
                "delta":    ce_g["delta"],
                "trap":     trap_ce,
                "oiInterp": oiInterp_ce,
                "iv":       ce_iv,
                "gamma":    ce_g["gamma"],
                "theta":    ce_g["theta"],
                "vega":     ce_g["vega"],
            },
        },
        "pe": {
            "signal":    _score_to_signal(pe_score),
            "score":     round(pe_score, 1),
            "breakdown": _score_to_pct(pe_score),
            "oi":        pe_oi,
            "oiChange":  pe_oi_change,
            "volume":    pe_volume,
            "price":     round(pe_price, 2),
            "change":    round(pe_change, 2),
            "signals": {
                "liq":      liq_type_pe,
                "bos":      bos_signal,
                "advPriceAction": pa_state_pe,
                "delta":    pe_g["delta"],
                "trap":     trap_pe,
                "oiInterp": oiInterp_pe,
                "iv":       pe_iv,
                "gamma":    pe_g["gamma"],
                "theta":    pe_g["theta"],
                "vega":     pe_g["vega"],
            },
        },
    }


def _overall_signal_from_score(score: float) -> str:
    if score >= 30:
        return "STRONG_BUY"
    if score >= 12:
        return "BUY"
    if score <= -30:
        return "STRONG_SELL"
    if score <= -12:
        return "SELL"
    return "NEUTRAL"


def _compute_world_market_impact(
    world_snapshot: Optional[Dict[str, Dict[str, Any]]],
    symbol: str,
) -> Dict[str, Any]:
    """
    Convert global index moves into a signed strike-intelligence overlay.

    Returns:
      influenceScore: -100..+100 (normalized risk-on / risk-off)
      impactPts:      -20..+20  (added to final strike score)
      bias:           BULLISH / BEARISH / NEUTRAL
      status:         LIVE / PARTIAL / UNAVAILABLE
    """
    if not world_snapshot:
        return {
            "status": "UNAVAILABLE",
            "bias": "NEUTRAL",
            "influenceScore": 0,
            "impactPts": 0.0,
            "liveCount": 0,
            "staleCount": 0,
            "totalCount": 0,
            "components": [],
            "summary": "Global indices unavailable",
        }

    # Weights reflect broad risk sensitivity for Indian index direction.
    component_weights: Dict[str, float] = {
        "DJI": 0.22,
        "SPX": 0.24,
        "IXIC": 0.18,
        "DAX": 0.14,
        "FTSE": 0.10,
        "NIKKEI": 0.12,
    }
    symbol_multiplier: Dict[str, float] = {
        "NIFTY": 1.00,
        "BANKNIFTY": 0.90,
        "SENSEX": 0.80,
    }
    sym_mult = symbol_multiplier.get(symbol, 1.0)

    weighted_sum = 0.0
    weight_total = 0.0
    live_count = 0
    stale_count = 0
    components: List[Dict[str, Any]] = []

    for key, weight in component_weights.items():
        item = world_snapshot.get(key) if isinstance(world_snapshot, dict) else None
        if not isinstance(item, dict):
            continue
        status = str(item.get("status") or "UNAVAILABLE").upper()
        change_pct = _safe_float(item.get("changePct"))
        if status == "LIVE":
            live_count += 1
        elif status == "STALE":
            stale_count += 1
        else:
            continue

        # Normalize each index move to -1..+1 over a 2% band.
        norm = _clamp(change_pct / 2.0, -1.0, 1.0)
        weighted_sum += norm * weight
        weight_total += weight
        components.append({
            "symbol": key,
            "changePct": round(change_pct, 2),
            "status": status,
        })

    if weight_total <= 0:
        return {
            "status": "UNAVAILABLE",
            "bias": "NEUTRAL",
            "influenceScore": 0,
            "impactPts": 0.0,
            "liveCount": live_count,
            "staleCount": stale_count,
            "totalCount": len(component_weights),
            "components": components,
            "summary": "Global indices unavailable",
        }

    influence_score = _clamp((weighted_sum / weight_total) * 100.0, -100.0, 100.0)
    impact_pts = round(_clamp(influence_score * 0.22 * sym_mult, -20.0, 20.0), 1)

    if influence_score >= 8:
        bias = "BULLISH"
    elif influence_score <= -8:
        bias = "BEARISH"
    else:
        bias = "NEUTRAL"

    status = "LIVE" if live_count >= 4 else "PARTIAL" if (live_count + stale_count) >= 3 else "UNAVAILABLE"
    summary = (
        f"World {bias.lower()} ({influence_score:+.0f}) · "
        f"{live_count} live/{len(component_weights)}"
    )

    return {
        "status": status,
        "bias": bias,
        "influenceScore": int(round(influence_score)),
        "impactPts": impact_pts,
        "liveCount": live_count,
        "staleCount": stale_count,
        "totalCount": len(component_weights),
        "components": components,
        "summary": summary,
    }


def _compute_best_strike_recommendation(
    rows: List[Dict[str, Any]],
    spot: float,
    atm: int,
    direction: Optional[str],  # "BULLISH" or "BEARISH" from overall intelligence
) -> Optional[Dict[str, Any]]:
    """
    AI Strike Recommender: analyzes all 11 strikes, ranks by tradability,
    returns the **single best strike** to trade with direction prediction + confidence.

    Scoring factors (out of 100):
      1. Signal quality (0–30): STRONG_BUY/SELL=30, BUY/SELL=20, NEUTRAL=5
      2. Conviction pass % (0–25): % of pre-trade checklist items passing
      3. Greeks strength (0–20): (Delta magnitude + Gamma) for directional moves
      4. Volume+OI confirmation (0–15): Participation depth
      5. Velocity heat (0–10): EXTREME=10, HOT=8, WARM=4, COLD=0

    Returns:
      {
        "strike": 50000,
        "label": "ATM",
        "side": "CE" | "PE",
        "direction": "UP" | "DOWN",
        "score": 89.5,
        "confidence": 82,
        "reason": "STRONG_BUY CE at ATM with 92% conviction, delta 0.68, gamma spike",
        "greeksSummary": "Δ0.68 | Γ spike | Θ-15 | σ18%"
      }
    Returns None if no viable strike found.
    """
    if not rows or spot <= 0:
        return None

    best: Optional[Dict[str, Any]] = None
    best_score = -1.0

    for row in rows:
        strike_val = _safe_int(row.get("strike"))
        label = str(row.get("label", ""))
        is_atm = bool(row.get("isATM"))

        for side_key in ["ce", "pe"]:
            side = row.get(side_key, {})
            if not isinstance(side, dict):
                continue

            signal = side.get("signal", "NEUTRAL")
            signals_dict = side.get("signals", {})
            breakdown = side.get("breakdown", {})
            velocity = side.get("velocity", "COLD")
            oi = _safe_int(side.get("oi"))
            volume = _safe_int(side.get("volume"))
            oiChange = _safe_int(side.get("oiChange", 0))

            # ── Score 1: Signal quality (0–30) ────────────────────────────────────
            if signal in ("STRONG_BUY", "STRONG_SELL"):
                signal_score = 30
            elif signal in ("BUY", "SELL"):
                signal_score = 20
            else:
                signal_score = 5

            # ── Score 2: Conviction pass % (0–25) ───────────────────────────────
            # Count checklist items: buyPct/sellPct, volume, OI, oiChange
            isBuy = signal in ("BUY", "STRONG_BUY")
            isSell = signal in ("SELL", "STRONG_SELL")
            checklist_pass = 0
            checklist_total = 4

            # Determine minimum thresholds (rough, can refine per symbol)
            min_buy_pct = 62
            min_volume = 50_000
            min_oi = 50_000
            min_oi_change = 500

            if isBuy and breakdown.get("buyPct", 0) >= min_buy_pct:
                checklist_pass += 1
            elif isSell and breakdown.get("sellPct", 0) >= min_buy_pct:
                checklist_pass += 1
            if volume >= min_volume:
                checklist_pass += 1
            if oi >= min_oi:
                checklist_pass += 1
            if abs(oiChange) >= min_oi_change:
                checklist_pass += 1

            conviction_pct = (checklist_pass / checklist_total) * 100.0 if checklist_total > 0 else 0.0
            conviction_score = min(conviction_pct / 4.0, 25)  # 100% pass → 25 points

            # ── Score 3: Greeks strength (0–20) ──────────────────────────────────
            delta = _safe_float(signals_dict.get("delta"))
            gamma = _safe_float(signals_dict.get("gamma"))
            greeks_score = 0.0
            if delta is not None:
                greeks_score += min(abs(delta) * 20, 12)  # delta 0.6+ → max 12 pts
            if gamma is not None:
                greeks_score += min(gamma * 5000, 8)      # gamma 0.0016+ → max 8 pts
            greeks_score = min(greeks_score, 20)

            # ── Score 4: Volume + OI confirmation (0–15) ──────────────────────────
            vol_norm = min(volume / max(min_volume, 1), 1.0)
            oi_norm = min(oi / max(min_oi, 1), 1.0)
            confirmation_score = (vol_norm * 0.6 + oi_norm * 0.4) * 15

            # ── Score 5: Velocity heat (0–10) ────────────────────────────────────
            velocity_map = {"EXTREME": 10, "HOT": 8, "WARM": 4, "COLD": 0}
            velocity_score = float(velocity_map.get(velocity, 0))

            # ── Total score (0–100) ──────────────────────────────────────────────
            total_score = signal_score + conviction_score + greeks_score + confirmation_score + velocity_score

            # ── ATM proximity boost — easier entry/exit ──────────────────────────
            if is_atm:
                total_score *= 1.08  # +8% for ATM
            elif abs(strike_val - int(spot)) <= 50:  # Within 1 strike
                total_score *= 1.03

            # Only consider strong signals (score > 50) or very high conviction
            if total_score > best_score and (signal_score >= 20 or conviction_score >= 15):
                best_score = total_score
                iv = _safe_float(signals_dict.get("iv"))
                theta = _safe_float(signals_dict.get("theta"))
                oiInterp = signals_dict.get("oiInterp")

                # Determine direction: CE = UP, PE = DOWN
                pred_direction = "UP" if side_key == "ce" else "DOWN"

                # Build Greeks summary for display
                delta_str = f"{delta:.2f}" if delta is not None else "—"
                gamma_str = f"spk" if gamma is not None and gamma > 0.001 else ""
                theta_str = f"{theta:.0f}" if theta is not None else "—"
                iv_str = f"{(iv * 100):.0f}%" if iv is not None else "—"
                greeks_summary = f"Δ{delta_str}" + (f" | Γ{gamma_str}" if gamma_str else "") + f" | Θ{theta_str} | σ{iv_str}"

                # Reason string
                reason_parts = [signal.replace("_", " ")]
                if side_key == "ce":
                    reason_parts.append("CE at")
                else:
                    reason_parts.append("PE at")
                reason_parts.append(label)
                if conviction_pct >= 75:
                    reason_parts.append(f"({int(conviction_pct)}% conviction)")
                if velocity in ("EXTREME", "HOT"):
                    reason_parts.append(f"({velocity} heat)")
                if oiInterp:
                    reason_parts.append(f"({oiInterp} signal)")

                # Confidence: blend signal quality, conviction, and velocity
                confidence = int(round(
                    (signal_score / 30.0) * 0.4 +
                    (conviction_pct / 100.0) * 0.4 +
                    (velocity_score / 10.0) * 0.2
                ) * 100)

                best = {
                    "strike": strike_val,
                    "label": label,
                    "side": "CE" if side_key == "ce" else "PE",
                    "direction": pred_direction,
                    "score": round(best_score, 1),
                    "confidence": confidence,
                    "reason": " ".join(reason_parts),
                    "greeksSummary": greeks_summary,
                }

    return best


def _compute_max_pain(rows: List[Dict[str, Any]]) -> Optional[int]:
    """
    Max Pain = strike where the total intrinsic value of all in-the-money options
    is minimised.  Option writers (institutions) are net short; they are least
    hurt — and retail buyers most hurt — at this price.
    O(N²) over ATM±5 = 11 strikes: negligible cost.
    """
    test_strikes = [_safe_int(r.get("strike")) for r in rows if _safe_int(r.get("strike")) > 0]
    if len(test_strikes) < 3:
        return None
    best: Optional[int] = None
    min_val = float("inf")
    for T in test_strikes:
        val = 0
        for row in rows:
            K   = _safe_int(row.get("strike"))
            c_oi = _safe_int((row.get("ce") or {}).get("oi"))
            p_oi = _safe_int((row.get("pe") or {}).get("oi"))
            if T > K: val += c_oi * (T - K)   # ITM call at expiry T
            if K > T: val += p_oi * (K - T)   # ITM put  at expiry T
        if val < min_val:
            min_val = val
            best = T
    return best


def _compute_price_move_predictions(
    rows: List[Dict[str, Any]],
    spot: float,
    final_score: float = 0.0,
    overall_signal: str = "NEUTRAL",
) -> Dict[str, Any]:
    """
    High-conviction trade target engine.

    Only surfaces options with conviction >= 65 that are ALIGNED with the current
    market direction (BULL = buy CE, BEAR = buy PE).  Returns at most two signals.

    Signal semantics (critical):
      CE STRONG_BUY / BUY  = call buyers active  = CE price rising  = market BULLISH
      PE STRONG_BUY / BUY  = put  buyers active  = PE price rising  = market BEARISH
      PE STRONG_SELL / SELL = put WRITING (put sellers) = market BULLISH (opposite!)

    So for BOTH directions we look for STRONG_BUY / BUY on the chosen side.
    """
    result: Dict[str, Any] = {
        "primary": None,
        "secondary": None,
        "marketBias": overall_signal,
        "score": round(final_score, 1),
    }

    # Direction gate
    is_bull = final_score > 15      # market bullish  → buy CE (calls)
    is_bear = final_score < -15     # market bearish  → buy PE (puts)
    if not is_bull and not is_bear:
        return result               # no clear direction → no trade setup

    # Expected additional spot move (score-based)
    score_abs = abs(final_score)
    if score_abs >= 65:
        expected_spot_pct = 0.007
    elif score_abs >= 45:
        expected_spot_pct = 0.005
    elif score_abs >= 30:
        expected_spot_pct = 0.0035
    else:
        expected_spot_pct = 0.0025
    expected_spot_move = spot * expected_spot_pct

    # Candidate scoring
    candidates: List[Dict[str, Any]] = []

    for row in rows:
        strike_val = _safe_int(row.get("strike"))
        if strike_val <= 0:
            continue
        is_atm = bool(row.get("isATM"))

        # Choose the side aligned with market direction
        # BULL: buy CE  (call options profit when market rises)
        # BEAR: buy PE  (put  options profit when market falls)
        side_key   = "ce" if is_bull else "pe"
        side_label = "CE" if is_bull else "PE"
        side = row.get(side_key, {}) or {}

        price  = _safe_float(side.get("price"))
        if price < 1.5:           # too cheap / illiquid
            continue

        sig       = side.get("signal", "NEUTRAL")
        score     = _safe_float(side.get("score", 0))
        volume    = _safe_int(side.get("volume"))
        oi        = _safe_int(side.get("oi"))
        sigs      = side.get("signals") or {}
        delta     = abs(_safe_float(sigs.get("delta", 0)))
        bos       = sigs.get("bos")
        trap      = bool(sigs.get("trap", False))
        oi_interp = sigs.get("oiInterp", "")

        # Delta gate: 0.12 – 0.82
        if delta < 0.12 or delta > 0.82:
            continue

        # Signal alignment:
        #   We want the OPTION being bought so its price goes UP and we profit.
        #   STRONG_BUY / BUY on either CE or PE = active option buying = price rising.
        #   For CE: CE BUY = call buying = market bullish.
        #   For PE: PE BUY = put  buying = market bearish.
        #   (PE SELL/STRONG_SELL = put WRITING = PE price falling = market bullish — wrong direction!)
        if sig == "STRONG_BUY":
            base_pts = 40
        elif sig == "BUY":
            base_pts = 26
        else:
            continue          # not being actively bought → skip

        # Score magnitude bonus (0-20)
        score_pts = min(abs(score) / 100.0 * 20.0, 20.0)

        # Volume participation bonus (log-scale, 0-12)
        vol_pts = min(math.log10(max(volume, 10)) / 7.0 * 12.0, 12.0) if volume > 0 else 0.0

        # BOS confirmation bonus:
        # bos_signal is strike-level: "UP"=CE surging+PE falling, "DOWN"=PE surging+CE falling
        # BULL: BOS "UP" (market bullish breakout)   = good for buying CE
        # BEAR: BOS "DOWN" (market bearish breakout) = good for buying PE
        bos_pts = 0.0
        if is_bull and bos == "UP":
            bos_pts = 10.0
        elif is_bear and bos == "DOWN":
            bos_pts = 10.0

        # Delta quality bonus (sweet-spot 0.35-0.60 = near ATM)
        delta_pts = max(10.0 - abs(delta - 0.475) * 22.0, 0.0)

        # OI interpretation bonus
        # oiInterp abbreviated values: "LB"=Long Buildup, "SC"=Short Cover,
        #   "SB"=Short Buildup, "LU"=Long Unwinding
        # BULL/CE: CE "LB" (call longs adding) or "SC" (call-short exits) = bullish  ✓
        # BEAR/PE: PE "LB" (put  longs adding) or "SC" (put-short  exits) = bearish  ✓
        oi_pts = 6.0 if oi_interp in ("LB", "SC") else 0.0

        # ATM bonus
        atm_pts = 5.0 if is_atm else 0.0

        # Trap penalty
        trap_penalty = -18.0 if trap else 0.0

        conviction = int(round(_clamp(
            base_pts + score_pts + vol_pts + bos_pts + delta_pts + oi_pts + atm_pts + trap_penalty,
            0.0, 98.0,
        )))

        # Reason tags
        reasons: List[str] = []
        if sig == "STRONG_BUY":
            reasons.append("STRONG signal")
        if bos_pts > 0:
            reasons.append("BOS confirmed")
        if oi_pts > 0:
            reasons.append("OI buildup")
        if is_atm:
            reasons.append("ATM strike")
        if trap:
            reasons.append("\u26a0 trap risk")

        # Target / stop / upside
        target_price = round(price + delta * expected_spot_move, 1)
        stop_loss    = round(price * 0.72, 1)
        upside_pct   = round((target_price - price) / price * 100.0, 1) if price > 0 else 0.0

        candidates.append({
            "strike":     strike_val,
            "side":       side_label,
            "entry":      round(price, 2),
            "target":     target_price,
            "stopLoss":   stop_loss,
            "upsidePct":  upside_pct,
            "conviction": conviction,
            "signal":     sig,
            "delta":      round(delta, 3),
            "volume":     volume,
            "oi":         oi,
            "direction":  "UP",
            "isATM":      is_atm,
            "bos":        bos,
            "reasons":    reasons,
        })

    # Filter >= 65 % conviction, sort best-first
    candidates.sort(key=lambda x: x["conviction"], reverse=True)
    high_conv = [c for c in candidates if c["conviction"] >= 65]

    if high_conv:
        result["primary"] = high_conv[0]
    if len(high_conv) > 1:
        for c in high_conv[1:]:
            if c["strike"] != high_conv[0]["strike"]:
                result["secondary"] = c
                break

    return result


def _build_intelligence_summary(
    symbol: str,
    strikes: List[Dict[str, Any]],
    spot: float,
    atm: int,
    *,
    data_source: str = "LIVE",
    option_age_sec: float = 0.0,
    world_snapshot: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Build a trader-facing symbol summary from per-strike signals.
    Includes direction, confidence, regime, key levels, and short rationale notes.
    Confidence is adjusted by feed freshness and data source reliability.
    """
    if not strikes:
        return {
            "symbol": symbol,
            "signal": "NEUTRAL",
            "score": 0.0,
            "confidence": 0,
            "regime": "NO_DATA",
            "agreementPct": 0,
            "bullPressure": 50,
            "bearPressure": 50,
            "trapRiskPct": 0,
            "actionability": "NONE",
            "confidenceReason": "No strike data available",
            "keyLevels": {"support": None, "resistance": None},
            "insights": ["No strike data available"],
        }

    sorted_rows = sorted(strikes, key=lambda r: r.get("strike", 0))
    atm_idx = next((i for i, row in enumerate(sorted_rows) if row.get("isATM")), len(sorted_rows) // 2)

    weighted_net = 0.0
    total_weight = 0.0
    active_nets: List[float] = []
    total_volume = 0
    trap_ce = 0
    trap_pe = 0
    bos_up = 0
    bos_down = 0

    for i, row in enumerate(sorted_rows):
        ce = row.get("ce", {})
        pe = row.get("pe", {})
        dist = abs(i - atm_idx)
        prox_weight = 4.0 if dist == 0 else 3.0 if dist == 1 else 2.0 if dist == 2 else 1.3

        strike_volume = _safe_int(ce.get("volume")) + _safe_int(pe.get("volume"))
        vol_amp = 1.0 + min(math.log10(max(strike_volume, 10)) / 8.0, 1.0)
        weight = prox_weight * vol_amp

        ce_score = _safe_float(ce.get("score"))
        pe_score = _safe_float(pe.get("score"))
        net = ce_score - pe_score

        weighted_net += net * weight
        total_weight += weight
        total_volume += strike_volume

        if abs(net) >= 5:
            active_nets.append(net)

        ce_sigs = ce.get("signals") or {}
        pe_sigs = pe.get("signals") or {}

        if ce_sigs.get("trap"):
            trap_ce += 1
        if pe_sigs.get("trap"):
            trap_pe += 1
        if ce_sigs.get("bos") == "UP":
            bos_up += 1
        elif ce_sigs.get("bos") == "DOWN":
            bos_down += 1

    world_market = _compute_world_market_impact(world_snapshot, symbol)

    base_score = weighted_net / max(total_weight, 1.0)
    bos_overlay = _clamp((bos_up - bos_down) * 3.0, -15.0, 15.0)
    trap_overlay = _clamp((trap_pe - trap_ce) * 2.5, -12.0, 12.0)
    world_overlay = _safe_float(world_market.get("impactPts"))
    final_score = round(_clamp(base_score + bos_overlay + trap_overlay + world_overlay, -100.0, 100.0), 1)

    signal = _overall_signal_from_score(final_score)
    direction = 1 if signal in ("STRONG_BUY", "BUY") else -1 if signal in ("STRONG_SELL", "SELL") else 0

    if active_nets:
        if direction == 0:
            agreement = 0.5
        else:
            aligned = sum(1 for n in active_nets if (1 if n > 0 else -1) == direction)
            agreement = aligned / max(len(active_nets), 1)
    else:
        agreement = 0.5

    liquidity_quality = min(math.log10(max(total_volume, 10)) / 8.0, 1.0)
    score_strength = min(abs(final_score) / 60.0, 1.0)
    trap_ratio = min((trap_ce + trap_pe) / max(len(sorted_rows), 1), 1.0)

    confidence = int(round(_clamp(
        (0.20 + 0.35 * agreement + 0.25 * liquidity_quality + 0.25 * score_strength - 0.20 * trap_ratio) * 100.0,
        5.0,
        99.0,
    )))

    # Confluence with global risk regime improves confidence; conflict reduces it.
    world_dir = 1 if world_market.get("bias") == "BULLISH" else -1 if world_market.get("bias") == "BEARISH" else 0
    world_strength = abs(_safe_float(world_market.get("impactPts")))
    if direction != 0 and world_dir != 0:
        if world_dir == direction:
            confidence = int(round(_clamp(confidence + min(8.0, world_strength * 0.7), 5.0, 99.0)))
        else:
            confidence = int(round(_clamp(confidence - min(12.0, world_strength * 0.9), 5.0, 99.0)))

    freshness_mult = 1.0
    freshness_reason = "Live chain with current confidence model"

    if option_age_sec > 10:
        # Confidence decays when option-chain staleness grows.
        freshness_mult *= _clamp(1.0 - (option_age_sec - 10.0) / 120.0, 0.55, 1.0)
        freshness_reason = f"Chain age {option_age_sec:.1f}s affects confidence"

    if data_source == "CACHED":
        freshness_mult *= 0.78
        freshness_reason = "Cached chain snapshot, reduced confidence"
    elif data_source == "LAST_CLOSE":
        freshness_mult *= 0.62
        freshness_reason = "Last close snapshot, directional confidence reduced"
    elif data_source == "MARKET_CLOSED":
        freshness_mult *= 0.25
        freshness_reason = "Market closed fallback, signals are low conviction"

    confidence = int(round(_clamp(confidence * freshness_mult, 1.0, 99.0)))

    if world_market.get("status") in ("LIVE", "PARTIAL"):
        freshness_reason = f"{freshness_reason} | {world_market.get('summary')}"

    if trap_ratio >= 0.30 and abs(final_score) < 22:
        regime = "TRAP_ZONE"
    elif abs(final_score) >= 28 and agreement >= 0.62:
        regime = "TRENDING"
    elif abs(final_score) <= 10:
        regime = "RANGE"
    else:
        regime = "TRANSITION"

    below_atm = [row for row in sorted_rows if _safe_int(row.get("strike")) <= atm]
    above_atm = [row for row in sorted_rows if _safe_int(row.get("strike")) >= atm]

    support_row = max(
        below_atm,
        key=lambda row: _safe_int((row.get("pe") or {}).get("oi")),
        default=None,
    )
    resistance_row = max(
        above_atm,
        key=lambda row: _safe_int((row.get("ce") or {}).get("oi")),
        default=None,
    )

    support = _safe_int(support_row.get("strike")) if support_row else None
    resistance = _safe_int(resistance_row.get("strike")) if resistance_row else None

    support_gap_pct = None
    resistance_gap_pct = None
    if spot > 0 and support:
        support_gap_pct = round((spot - support) / spot * 100.0, 2)
    if spot > 0 and resistance:
        resistance_gap_pct = round((resistance - spot) / spot * 100.0, 2)

    # Bull/Bear pressure — blend score with actual CE/PE volume and OI participation.
    # Pure score-based formula (×0.8) hits 0% at score=-62.5 which is misleading; instead
    # we blend three signals so extremes never drop below ~5 % in either direction:
    #   60 % score-based  (less aggressive multiplier ×0.40)
    #   25 % CE-vs-PE volume ratio  (CE vol buying = bullish activity)
    #   15 % CE-vs-PE OI ratio  (structural positioning)
    total_ce_vol_s = sum(_safe_int((r.get("ce") or {}).get("volume")) for r in sorted_rows)
    total_pe_vol_s = sum(_safe_int((r.get("pe") or {}).get("volume")) for r in sorted_rows)
    total_vol_s = max(total_ce_vol_s + total_pe_vol_s, 1)
    vol_bull_pct = total_ce_vol_s / total_vol_s * 100  # higher CE vol → more call buying → bullish

    total_ce_oi_s = sum(_safe_int((r.get("ce") or {}).get("oi")) for r in sorted_rows)
    total_pe_oi_s = sum(_safe_int((r.get("pe") or {}).get("oi")) for r in sorted_rows)
    total_oi_s = max(total_ce_oi_s + total_pe_oi_s, 1)
    oi_bull_pct = total_ce_oi_s / total_oi_s * 100  # higher CE OI → less put dominance → mild bull

    score_bull_pct = _clamp(50.0 + final_score * 0.40, 5.0, 95.0)  # never hits extremes

    raw_bull = 0.60 * score_bull_pct + 0.25 * vol_bull_pct + 0.15 * oi_bull_pct
    bull_pressure = int(round(_clamp(raw_bull, 3.0, 97.0)))
    bear_pressure = 100 - bull_pressure

    # PCR (Put-Call OI ratio) — structural sentiment gauge (uses same 11-strike chain)
    total_ce_oi = total_ce_oi_s
    total_pe_oi = total_pe_oi_s
    pcr = round(total_pe_oi / max(total_ce_oi, 1), 2)

    # Max Pain — strike where option buyers collectively lose most at expiry
    max_pain = _compute_max_pain(sorted_rows)
    max_pain_gap_pct: Optional[float] = None
    if max_pain and spot > 0:
        max_pain_gap_pct = round((max_pain - spot) / spot * 100.0, 2)

    if confidence >= 75 and abs(final_score) >= 20 and trap_ratio < 0.25 and data_source == "LIVE":
        actionability = "HIGH"
    elif confidence >= 55 and abs(final_score) >= 14 and data_source in ("LIVE", "CACHED"):
        actionability = "MEDIUM"
    elif confidence >= 35:
        actionability = "LOW"
    else:
        actionability = "NONE"

    insights: List[str] = [
        f"Flow bias: {signal.replace('_', ' ')} ({final_score:+.1f})",
        f"Agreement {int(round(agreement * 100))}% across active strikes",
    ]
    if support and resistance:
        insights.append(f"Key levels S:{support} | R:{resistance}")
    if bos_up > bos_down:
        insights.append("BOS confirms upside continuation")
    elif bos_down > bos_up:
        insights.append("BOS confirms downside continuation")
    if world_market.get("status") in ("LIVE", "PARTIAL"):
        insights.append(str(world_market.get("summary")))
    if trap_ratio >= 0.25:
        insights.append("Elevated trap risk: avoid chasing weak breakouts")

    # Compute AI best strike recommendation
    best_strike = _compute_best_strike_recommendation(
        rows=sorted_rows,
        spot=spot,
        atm=atm,
        direction=signal,
    )

    # Compute lowest price predictions (ITM/OTM with UP/DOWN direction)
    # Compute price predictions (market-direction-aligned, conviction ≥ 65 % only)
    price_predictions = _compute_price_move_predictions(sorted_rows, spot, final_score, signal)

    return {
        "symbol": symbol,
        "signal": signal,
        "score": final_score,
        "confidence": confidence,
        "regime": regime,
        "agreementPct": int(round(agreement * 100)),
        "bullPressure": bull_pressure,
        "bearPressure": bear_pressure,
        "trapRiskPct": int(round(trap_ratio * 100)),
        "actionability": actionability,
        "confidenceReason": freshness_reason,
        "pcr": pcr,
        "maxPain": max_pain,
        "maxPainGapPct": max_pain_gap_pct,
        "worldMarket": world_market,
        "keyLevels": {
            "support": support,
            "resistance": resistance,
            "supportGapPct": support_gap_pct,
            "resistanceGapPct": resistance_gap_pct,
        },
        "bestStrike": best_strike,
        "pricePredictions": price_predictions,
        "insights": insights[:4],
    }


# ── Persistence ──────────────────────────────────────────────────────────────

def _load_persistent() -> Dict[str, Any]:
    try:
        if PERSISTENT_FILE.exists():
            with open(PERSISTENT_FILE, "r") as f:
                return json.load(f)
    except Exception as e:
        logger.debug("Could not load strike intel state: %s", e)
    return {}


def _save_persistent(state: Dict[str, Any]):
    try:
        PERSISTENT_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(PERSISTENT_FILE, "w") as f:
            json.dump(state, f, default=str)
    except Exception as e:
        logger.debug("Could not save strike intel state: %s", e)


# ── Spot/ATM sync helper ─────────────────────────────────────────────────────

def _apply_spot_to_cached_entry(entry: Dict[str, Any], spot: float, symbol: str) -> Dict[str, Any]:
    """
    Given a cached entry (with stale spot/atm/isATM/labels), update it with
    the current real-time spot price. Only modifies spot, atm, isATM, and
    strike labels — Volume/OI values stay from the cached session.
    """
    step = STRIKE_STEP.get(symbol, 50)
    new_atm = _get_atm_strike(spot, step)
    updated = dict(entry)  # shallow copy — don't mutate original
    updated["spot"] = round(spot, 2)
    updated["atm"] = new_atm
    # Re-stamp strike labels and ATM flag
    new_strikes = []
    for row in entry.get("strikes", []):
        r = dict(row)
        s = r["strike"]
        diff = s - new_atm
        r["isATM"] = (s == new_atm)
        if diff == 0:
            r["label"] = "ATM"
        elif diff > 0:
            r["label"] = f"OTM+{diff // step}"
        else:
            r["label"] = f"ITM{diff // step}"
        new_strikes.append(r)
    updated["strikes"] = new_strikes
    return updated


def _is_real_chain_entry(entry: Dict[str, Any]) -> bool:
    """Return True when the snapshot came from a real option-chain fetch, not synthetic fallback."""
    if not isinstance(entry, dict):
        return False
    return bool(entry.get("strikes")) and bool(entry.get("expiry"))


# ── Core Service ─────────────────────────────────────────────────────────────

class StrikeIntelligenceService:
    """
    Fetches per-strike CE/PE data for ATM ± 5 strikes,
    computes buy/sell signals, broadcasts via WebSocket.
    """

    def __init__(self):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._cache = CacheService()
        self._kite = None
        self._kite_initialized = False
        self._last_token: Optional[str] = None
        self._last_snapshot: Dict[str, Any] = {}
        self._instruments_cache: Dict[str, List] = {}
        self._instruments_cache_date: Dict[str, date] = {}
        self._last_save_time: float = 0.0
        self._cadence_live = 0.5        # Broadcast every 0.5s during market hours
        self._cadence_fetch = 1.5       # Full Zerodha quote fetch every 1.5s (was 2s)
        self._cadence_closed = 60.0
        self._heartbeat_interval = 30.0
        self._kite_init_backoff_until: float = 0.0  # Backoff timer for failed init
        # OI change tracking: key = "SYMBOL_STRIKE_CE" / "SYMBOL_STRIKE_PE" → prev OI
        self._prev_oi: Dict[str, int] = {}
        # Full-chain OI snapshot for computing chainTotals OI change (covers ALL strikes)
        self._prev_chain_oi: Dict[str, Dict[str, int]] = {}
        # Price velocity tracking: key = "SYMBOL_STRIKE_CE" / "_PE" → prev LTP
        # Used to detect fast-moving strikes for real-time auto-highlighting.
        self._prev_prices: Dict[str, float] = {}

    def _with_runtime_meta(
        self,
        entry: Dict[str, Any],
        *,
        spot_timestamp: Optional[str] = None,
        option_timestamp: Optional[str] = None,
    ) -> Dict[str, Any]:
        updated = dict(entry)
        option_updated_at = option_timestamp or updated.get("optionChainUpdatedAt") or updated.get("timestamp")
        spot_updated_at = spot_timestamp or updated.get("spotUpdatedAt") or updated.get("timestamp")

        option_age_sec = 0.0
        if option_updated_at:
            try:
                option_age_sec = max(
                    0.0,
                    time_mod.time() - datetime.fromisoformat(option_updated_at).timestamp(),
                )
            except Exception:
                option_age_sec = 0.0

        updated["spotUpdatedAt"] = spot_updated_at
        updated["optionChainUpdatedAt"] = option_updated_at
        updated["optionChainAgeSec"] = round(option_age_sec, 1)
        updated["feedMode"] = "HYBRID_LIVE"
        return updated

    # ── KiteConnect init ─────────────────────────────────────────────────

    def _init_kite(self):
        current_token = settings.zerodha_access_token
        if current_token and current_token != self._last_token:
            self._kite_initialized = False
            self._last_token = current_token
            self._kite_init_backoff_until = 0.0  # New token → reset backoff

        if self._kite_initialized:
            return

        # Backoff: don't retry init if we recently failed
        now = time_mod.time()
        if now < self._kite_init_backoff_until:
            return

        if not settings.zerodha_api_key or not settings.zerodha_access_token:
            self._kite_init_backoff_until = now + 60  # Check again in 60s
            return

        try:
            from kiteconnect import KiteConnect
            self._kite = KiteConnect(api_key=settings.zerodha_api_key)
            self._kite.set_access_token(settings.zerodha_access_token)
            try:
                self._kite.profile()
                self._kite_initialized = True
                self._kite_init_backoff_until = 0.0
                logger.info("Strike Intelligence: KiteConnect initialized")
            except Exception as e:
                logger.warning("Strike Intelligence: Token validation failed: %s", e)
                self._kite = None
                self._kite_initialized = False
                self._kite_init_backoff_until = now + 30  # Retry in 30s
        except Exception as e:
            logger.warning("Strike Intelligence: KiteConnect init error: %s", e)
            self._kite = None
            self._kite_initialized = False
            self._kite_init_backoff_until = now + 30

    def _get_instruments(self, exchange: str) -> List:
        today = datetime.now(IST).date()
        if exchange in self._instruments_cache and exchange in self._instruments_cache_date:
            if self._instruments_cache_date[exchange] == today:
                return self._instruments_cache[exchange]

        if not self._kite:
            return []

        instruments = self._kite.instruments(exchange)
        self._instruments_cache[exchange] = instruments
        self._instruments_cache_date[exchange] = today
        return instruments

    # ── Lifecycle ─────────────────────────────────────────────────────────

    async def start(self):
        if self._running:
            return
        self._running = True
        # Load persistent data
        persisted = _load_persistent()
        if persisted:
            self._last_snapshot = persisted
        self._task = asyncio.create_task(self._run_loop())
        logger.info("StrikeIntelligenceService started")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        # Save final state
        if self._last_snapshot:
            await asyncio.to_thread(_save_persistent, self._last_snapshot)
        logger.info("StrikeIntelligenceService stopped")

    def get_snapshot(self) -> Dict[str, Any]:
        if not self._last_snapshot:
            # Try loading from disk if not yet populated
            persisted = _load_persistent()
            if persisted:
                for sym in persisted:
                    if isinstance(persisted[sym], dict):
                        persisted[sym]["dataSource"] = "LAST_CLOSE" if _is_real_chain_entry(persisted[sym]) else "MARKET_CLOSED"
                self._last_snapshot = persisted
        return self._last_snapshot

    # ── Market phase detection ───────────────────────────────────────────

    def _get_market_phase(self) -> str:
        now = datetime.now(IST)
        wd = now.weekday()
        if wd >= 5:
            return "CLOSED"
        t = now.time()
        if time(9, 15) <= t <= time(15, 30):
            return "LIVE"
        if time(9, 0) <= t < time(9, 15):
            return "PRE_OPEN"
        return "CLOSED"

    def _get_spot_price(self, symbol: str, *, allow_persistent_fallback: bool = True) -> float:
        """Get spot price from cache, with optional persistent fallback for closed-market mode."""
        # Try in-memory cache first — _SHARED_CACHE stores (json_str, expire_at) tuples
        cache_key = f"market:{symbol}"
        raw = _SHARED_CACHE.get(cache_key)
        if raw is not None:
            try:
                value_json, expire_at = raw
                if time_mod.time() < expire_at:
                    data = json.loads(value_json)
                    spot = _safe_float(data.get("price") or data.get("last_price"))
                    if spot > 0:
                        return spot
            except Exception:
                pass

        # During LIVE/PRE_OPEN, do not use persistent fallback to avoid stale ATM drift.
        if not allow_persistent_fallback:
            return 0.0

        # Fallback: persistent market state file
        try:
            from services.persistent_market_state import PersistentMarketState
            state = PersistentMarketState.get_last_known_state(symbol)
            if state:
                persist_ts = _safe_float(state.get("_persist_unix_time"))
                # Guard against very old persisted values even in fallback mode.
                if persist_ts > 0 and (time_mod.time() - persist_ts) > (24 * 3600):
                    return 0.0
                spot = _safe_float(state.get("price") or state.get("last_price"))
                if spot > 0:
                    return spot
        except Exception:
            pass

        # Fallback: read persistent file directly
        try:
            pfile = Path(__file__).parent.parent / "data" / "persistent_market_state.json"
            if pfile.exists():
                with open(pfile, "r") as f:
                    pdata = json.load(f)
                sym_data = pdata.get(symbol, {})
                persist_ts = _safe_float(sym_data.get("_persist_unix_time"))
                if persist_ts > 0 and (time_mod.time() - persist_ts) > (24 * 3600):
                    return 0.0
                spot = _safe_float(sym_data.get("price") or sym_data.get("last_price"))
                if spot > 0:
                    return spot
        except Exception:
            pass

        return 0.0

    # ── Fetch strike data for one symbol ─────────────────────────────────

    def _fetch_strikes_sync(self, symbol: str, spot: float) -> Optional[Dict[str, Any]]:
        """Blocking call — fetch ATM ± 5 strikes plus full-chain nearest-expiry totals."""
        if not self._kite:
            return None

        index_config = {
            "NIFTY": {"name": "NIFTY", "exchange": "NFO"},
            "BANKNIFTY": {"name": "BANKNIFTY", "exchange": "NFO"},
            "SENSEX": {"name": "SENSEX", "exchange": "BFO"},
        }
        config = index_config.get(symbol)
        if not config:
            return None

        step = STRIKE_STEP[symbol]
        atm = _get_atm_strike(spot, step)
        strikes = [atm + i * step for i in range(-NUM_STRIKES_EACH_SIDE, NUM_STRIKES_EACH_SIDE + 1)]

        try:
            instruments = self._get_instruments(config["exchange"])
        except Exception as e:
            logger.debug("Instrument fetch failed for %s: %s", symbol, e)
            return None

        if not instruments:
            return None

        today = datetime.now(IST).date()
        nearest_expiry = None
        for inst in instruments:
            if inst.get("name") != config["name"]:
                continue
            if inst.get("instrument_type") not in ("CE", "PE"):
                continue
            expiry = inst.get("expiry")
            if not expiry or expiry < today:
                continue
            if nearest_expiry is None or expiry < nearest_expiry:
                nearest_expiry = expiry

        if nearest_expiry is None:
            return None

        ce_map: Dict[int, Dict] = {}
        pe_map: Dict[int, Dict] = {}

        for inst in instruments:
            if inst.get("name") != config["name"]:
                continue
            if inst.get("instrument_type") not in ("CE", "PE"):
                continue
            expiry = inst.get("expiry")
            if expiry != nearest_expiry:
                continue
            strike_val = inst.get("strike")
            if inst["instrument_type"] == "CE":
                ce_map[strike_val] = inst
            else:
                pe_map[strike_val] = inst

        # Collect tokens for full nearest-expiry totals.
        all_tokens_map: Dict[str, Dict[str, Any]] = {}
        for strike_val, inst in ce_map.items():
            all_tokens_map[str(inst["instrument_token"])] = {"type": "CE", "strike": strike_val, "inst": inst}
        for strike_val, inst in pe_map.items():
            all_tokens_map[str(inst["instrument_token"])] = {"type": "PE", "strike": strike_val, "inst": inst}

        # Collect tokens
        tokens_map: Dict[str, Dict] = {}  # token_str -> {type, strike, inst}
        for s in strikes:
            if s in ce_map:
                tk = str(ce_map[s]["instrument_token"])
                tokens_map[tk] = {"type": "CE", "strike": s, "inst": ce_map[s]}
            if s in pe_map:
                tk = str(pe_map[s]["instrument_token"])
                tokens_map[tk] = {"type": "PE", "strike": s, "inst": pe_map[s]}

        if not tokens_map:
            return None

        try:
            quotes: Dict[str, Any] = {}
            for batch in _chunked(list(all_tokens_map.keys()), 200):
                quotes.update(self._kite.quote(batch))
        except Exception as e:
            logger.debug("Quote fetch failed for %s: %s", symbol, e)
            return None

        total_ce_volume = 0
        total_pe_volume = 0
        total_ce_oi = 0
        total_pe_oi = 0
        for tk_str, meta in all_tokens_map.items():
            quote = quotes.get(tk_str, {})
            if meta["type"] == "CE":
                total_ce_volume += _safe_int(quote.get("volume"))
                total_ce_oi += _safe_int(quote.get("oi"))
            else:
                total_pe_volume += _safe_int(quote.get("volume"))
                total_pe_oi += _safe_int(quote.get("oi"))

        # Build per-strike data
        strike_data: Dict[int, Dict] = {}
        for s in strikes:
            strike_data[s] = {
                "ce_oi": 0, "pe_oi": 0,
                "ce_volume": 0, "pe_volume": 0,
                "ce_price": 0.0, "pe_price": 0.0,
                "ce_change": 0.0, "pe_change": 0.0,
            }

        for tk_str, meta in tokens_map.items():
            q = quotes.get(tk_str, {})
            s = meta["strike"]
            prefix = "ce" if meta["type"] == "CE" else "pe"
            strike_data[s][f"{prefix}_oi"] = _safe_int(q.get("oi"))
            strike_data[s][f"{prefix}_volume"] = _safe_int(q.get("volume"))
            strike_data[s][f"{prefix}_price"] = _safe_float(q.get("last_price"))
            ohlc = q.get("ohlc", {})
            close_price = _safe_float(ohlc.get("close"))
            ltp = _safe_float(q.get("last_price"))
            strike_data[s][f"{prefix}_change"] = round(ltp - close_price, 2) if close_price > 0 else 0.0

        # Get nearest expiry for display
        expiry_str = ""
        for s in strikes:
            if s in ce_map:
                expiry_str = str(ce_map[s].get("expiry", ""))
                break

        # ── Full-chain OI change (net signed: positive = buildup, negative = unwinding) ──
        prev_chain = self._prev_chain_oi.get(symbol, {})
        prev_ce_oi = prev_chain.get("ce", 0)
        prev_pe_oi = prev_chain.get("pe", 0)
        # First fetch → no reference yet; emit 0 so UI shows dash instead of noise
        total_ce_oi_chg = (total_ce_oi - prev_ce_oi) if prev_chain else 0
        total_pe_oi_chg = (total_pe_oi - prev_pe_oi) if prev_chain else 0
        # Always update the stored snapshot for next cycle
        self._prev_chain_oi[symbol] = {"ce": total_ce_oi, "pe": total_pe_oi}

        return {
            "atm": atm,
            "step": step,
            "spot": round(spot, 2),
            "expiry": str(nearest_expiry or expiry_str),
            "chainTotals": {
                "totalCEVol": total_ce_volume,
                "totalPEVol": total_pe_volume,
                "totalCEOI": total_ce_oi,
                "totalPEOI": total_pe_oi,
                "totalVol": total_ce_volume + total_pe_volume,
                "totalOI": total_ce_oi + total_pe_oi,
                "totalCEOIChg": total_ce_oi_chg,
                "totalPEOIChg": total_pe_oi_chg,
            },
            "strikes": strike_data,
        }

    # ── Compute signals for all strikes ──────────────────────────────────

    def _build_symbol_data(self, symbol: str, raw: Dict[str, Any]) -> Dict[str, Any]:
        """Transform raw strike data into the full signal payload."""
        built_at = datetime.now(IST).isoformat()
        spot = raw["spot"]
        atm = raw["atm"]
        step = raw["step"]
        strikes_raw = raw["strikes"]

        # ── OI change tracking (vs previous 5-second Zerodha fetch) ────────
        # Compute change first, then update stored reference values.
        oi_changes: Dict[int, Dict[str, int]] = {}
        for strike_val, sd in strikes_raw.items():
            ce_key = f"{symbol}_{strike_val}_CE"
            pe_key = f"{symbol}_{strike_val}_PE"
            prev_ce = self._prev_oi.get(ce_key)
            prev_pe = self._prev_oi.get(pe_key)
            oi_changes[strike_val] = {
                "ce": (sd["ce_oi"] - prev_ce) if prev_ce is not None else 0,
                "pe": (sd["pe_oi"] - prev_pe) if prev_pe is not None else 0,
            }
            self._prev_oi[ce_key] = sd["ce_oi"]
            self._prev_oi[pe_key] = sd["pe_oi"]

        strikes_out = []
        dte = _dte_from_expiry(raw.get("expiry", ""))
        for strike_val in sorted(strikes_raw.keys()):
            sd = strikes_raw[strike_val]
            chg = oi_changes.get(strike_val, {"ce": 0, "pe": 0})
            signals = _compute_signal(
                ce_oi=sd["ce_oi"], pe_oi=sd["pe_oi"],
                ce_volume=sd["ce_volume"], pe_volume=sd["pe_volume"],
                ce_price=sd["ce_price"], pe_price=sd["pe_price"],
                ce_change=sd["ce_change"], pe_change=sd["pe_change"],
                spot=spot, strike=strike_val,
                ce_oi_change=chg["ce"], pe_oi_change=chg["pe"],
                dte=dte,
            )

            # ── Price velocity: fast-moving detection ───────────────────────
            # Measures % price change vs the last Zerodha fetch (~1.5s ago).
            # COLD <0.5% · WARM 0.5–2% · HOT 2–5% · EXTREME >5%
            ce_pk = f"{symbol}_{strike_val}_CE"
            pe_pk = f"{symbol}_{strike_val}_PE"
            prev_ce_p = self._prev_prices.get(ce_pk)
            prev_pe_p = self._prev_prices.get(pe_pk)

            def _velocity_level(curr: float, prev: Optional[float]) -> str:
                if prev is None or prev < 0.5:
                    return "COLD"
                pct = abs(curr - prev) / prev * 100.0
                if pct >= 5.0: return "EXTREME"
                if pct >= 2.0: return "HOT"
                if pct >= 0.5: return "WARM"
                return "COLD"

            signals["ce"]["velocity"] = _velocity_level(sd["ce_price"], prev_ce_p)
            signals["pe"]["velocity"] = _velocity_level(sd["pe_price"], prev_pe_p)
            self._prev_prices[ce_pk] = sd["ce_price"]
            self._prev_prices[pe_pk] = sd["pe_price"]

            # Determine strike label
            diff = strike_val - atm
            if diff == 0:
                label = "ATM"
            elif diff > 0:
                label = f"OTM+{diff // step}"
            else:
                label = f"ITM{diff // step}"

            strikes_out.append({
                "strike": strike_val,
                "label": label,
                "isATM": strike_val == atm,
                "ce": signals["ce"],
                "pe": signals["pe"],
            })

        payload = {
            "symbol": symbol,
            "spot": spot,
            "atm": atm,
            "step": step,
            "expiry": raw.get("expiry", ""),
            "strikeCount": len(strikes_out),
            "chainTotals": raw.get("chainTotals"),
            "strikes": strikes_out,
            "intelligence": _build_intelligence_summary(
                symbol,
                strikes_out,
                spot,
                atm,
                data_source="LIVE",
                option_age_sec=0.0,
                world_snapshot=get_global_indices_service().get_snapshot(),
            ),
            "dataSource": "LIVE",
            "timestamp": built_at,
        }
        return self._with_runtime_meta(payload, spot_timestamp=built_at, option_timestamp=built_at)

    # ── Signal recomputation with live spot ──────────────────────────────

    def _recompute_signals_with_spot(self, entry: Dict[str, Any], spot: float, symbol: str) -> Dict[str, Any]:
        """
        Recompute per-strike signals using a fresh spot price every 0.5s.
        OI / volume are taken from the last Zerodha fetch (every 1.5s).

        Price momentum is delta-estimated between Zerodha fetches:
          adj_change = last_change + delta × (current_spot − prev_snapshot_spot)

        This accumulates correctly across 0.5s cycles:
          • After Zerodha fetch: ce_change = true ltp−close (Zerodha baseline)
          • Each 0.5s cycle:     ce_change += delta × spot_tick_delta
          • Next Zerodha fetch:  ce_change reset to new true ltp−close
        Result: the ±30 price-momentum factor now reacts to every spot tick,
        not just the 1.5s Zerodha cadence — no delay in signal changes.
        """
        step      = STRIKE_STEP.get(symbol, 50)
        new_atm   = _get_atm_strike(spot, step)
        dte       = _dte_from_expiry(str(entry.get("expiry", "")))

        # Spot delta since the last 0.5 s recompute (or last Zerodha fetch when first cycle)
        prev_spot   = _safe_float(entry.get("spot", spot))
        spot_delta  = spot - prev_spot   # signed: + = market moved up, − = down

        new_strikes = []
        for row in entry.get("strikes", []):
            strike_val = row["strike"]
            ce = row.get("ce", {})
            pe = row.get("pe", {})

            ce_price  = _safe_float(ce.get("price"))
            pe_price  = _safe_float(pe.get("price"))
            ce_change = _safe_float(ce.get("change"))
            pe_change = _safe_float(pe.get("change"))

            # ── Delta-estimated price adjustment ──────────────────────────
            # When spot moves between Zerodha fetches, estimate option price
            # change via Black-Scholes delta so the ±30 momentum factor stays
            # reactive to live ticks (not just every 1.5 s).
            # Threshold of 0.5 pt avoids noise from micro jitter.
            if abs(spot_delta) >= 0.5:
                sigs_ce = ce.get("signals") or {}
                sigs_pe = pe.get("signals") or {}
                ce_delta_val = _safe_float(sigs_ce.get("delta"))   # e.g. +0.5 for ATM CE
                pe_delta_val = _safe_float(sigs_pe.get("delta"))   # e.g. −0.5 for ATM PE
                if ce_delta_val != 0 and ce_price > 0:
                    ce_change = round(ce_change + ce_delta_val * spot_delta, 2)
                if pe_delta_val != 0 and pe_price > 0:
                    pe_change = round(pe_change + pe_delta_val * spot_delta, 2)
            # ─────────────────────────────────────────────────────────────

            signals = _compute_signal(
                ce_oi=_safe_int(ce.get("oi")),
                pe_oi=_safe_int(pe.get("oi")),
                ce_volume=_safe_int(ce.get("volume")),
                pe_volume=_safe_int(pe.get("volume")),
                ce_price=ce_price,
                pe_price=pe_price,
                ce_change=ce_change,   # delta-adjusted for live spot tick
                pe_change=pe_change,   # delta-adjusted for live spot tick
                spot=spot,
                strike=strike_val,
                # Preserve oiChange from last full Zerodha fetch (not recomputed here)
                ce_oi_change=_safe_int(ce.get("oiChange", 0)),
                pe_oi_change=_safe_int(pe.get("oiChange", 0)),
                dte=dte,
            )
            # Preserve velocity from the last full Zerodha fetch —
            # price doesn't change between 0.5s recompute cycles.
            signals["ce"]["velocity"] = ce.get("velocity", "COLD")
            signals["pe"]["velocity"] = pe.get("velocity", "COLD")

            diff = strike_val - new_atm
            if diff == 0:
                label = "ATM"
            elif diff > 0:
                label = f"OTM+{diff // step}"
            else:
                label = f"ITM{diff // step}"

            new_strikes.append({
                "strike":  strike_val,
                "label":   label,
                "isATM":   strike_val == new_atm,
                "ce":      signals["ce"],
                "pe":      signals["pe"],
            })

        updated            = dict(entry)
        updated["spot"]   = round(spot, 2)
        updated["atm"]    = new_atm
        updated["strikes"] = new_strikes
        prev_data_source = str(entry.get("dataSource") or "LIVE")
        prev_option_age = _safe_float(entry.get("optionChainAgeSec"))
        updated["intelligence"] = _build_intelligence_summary(
            symbol,
            new_strikes,
            round(spot, 2),
            new_atm,
            data_source=prev_data_source,
            option_age_sec=prev_option_age,
            world_snapshot=get_global_indices_service().get_snapshot(),
        )
        return self._with_runtime_meta(
            updated,
            spot_timestamp=datetime.now(IST).isoformat(),
        )

    # ── Background Zerodha fetch (runs as asyncio.Task, never blocks broadcast) ──

    async def _bg_fetch_live(self) -> None:
        """
        Fetch full Zerodha option-chain quotes for all symbols in parallel threads.
        Runs as a fire-and-forget asyncio.Task so the 0.5 s broadcast loop
        is NEVER paused waiting for the Zerodha HTTP round-trip (1-3 s per symbol).
        On success each symbol's snapshot is updated in-place; broadcast picks it up
        in the very next 0.5 s cadence tick.
        """
        async def _fetch_one(symbol: str) -> tuple:
            try:
                spot = self._get_spot_price(symbol, allow_persistent_fallback=False)
                if spot <= 0:
                    return (symbol, None)
                raw = await asyncio.to_thread(self._fetch_strikes_sync, symbol, spot)
                if raw:
                    return (symbol, self._build_symbol_data(symbol, raw))
                elif symbol in self._last_snapshot:
                    entry = _apply_spot_to_cached_entry(
                        self._last_snapshot[symbol], spot, symbol
                    )
                    entry["dataSource"] = "CACHED"
                    return (symbol, entry)
                return (symbol, None)
            except Exception as e:
                logger.debug("Strike intel bg-fetch error for %s: %s", symbol, e)
                return (symbol, None)

        results = await asyncio.gather(
            *[_fetch_one(sym) for sym in SYMBOLS],
            return_exceptions=True,
        )
        for result in results:
            if isinstance(result, Exception):
                continue
            sym, fresh = result
            if fresh is not None:
                self._last_snapshot[sym] = fresh

        now_ts = time_mod.time()
        if now_ts - self._last_save_time > 30 and self._last_snapshot:
            self._last_save_time = now_ts
            await asyncio.to_thread(_save_persistent, dict(self._last_snapshot))

    # ── Main loop ────────────────────────────────────────────────────────

    async def _run_loop(self):
        last_heartbeat = 0.0
        last_fetch_time = 0.0            # Tracks when last bg fetch was STARTED
        _fetch_task: Optional[asyncio.Task] = None  # Background Zerodha fetch task
        _closed_fetch_done = False

        while self._running:
            try:
                phase = self._get_market_phase()
                now_ts = time_mod.time()

                # ── LIVE / PRE_OPEN ───────────────────────────────────────────
                if phase in ("LIVE", "PRE_OPEN"):
                    _closed_fetch_done = False

                    # Fire-and-forget Zerodha fetch every _cadence_fetch seconds.
                    # We only start a new fetch when the previous one has finished
                    # so we never pile up concurrent API calls.
                    fetch_due = (now_ts - last_fetch_time) >= self._cadence_fetch
                    fetch_idle = _fetch_task is None or _fetch_task.done()
                    if fetch_due and fetch_idle:
                        self._init_kite()
                        _fetch_task = asyncio.create_task(self._bg_fetch_live())
                        last_fetch_time = now_ts

                    # Every cadence tick (0.5 s): recompute spot-sensitive signals
                    # and broadcast — completely decoupled from the Zerodha fetch.
                    if self._last_snapshot:
                        ts_now = datetime.now(IST).isoformat()

                        async def _refresh_one(symbol: str) -> tuple:
                            entry = self._last_snapshot.get(symbol)
                            if not isinstance(entry, dict):
                                return (symbol, None)
                            spot = self._get_spot_price(symbol, allow_persistent_fallback=False)
                            if spot > 0:
                                refreshed = await asyncio.to_thread(
                                    self._recompute_signals_with_spot, entry, spot, symbol
                                )
                                refreshed["dataSource"] = "LIVE"
                                refreshed["timestamp"] = ts_now
                                refreshed = self._with_runtime_meta(refreshed, spot_timestamp=ts_now)
                            else:
                                refreshed = self._with_runtime_meta(dict(entry))
                                refreshed["dataSource"] = "CACHED"
                            return (symbol, refreshed)

                        broadcast_data: Dict[str, Any] = {}
                        results = await asyncio.gather(
                            *[_refresh_one(sym) for sym in SYMBOLS if sym in self._last_snapshot],
                            return_exceptions=True,
                        )
                        for result in results:
                            if isinstance(result, Exception):
                                continue
                            sym, entry = result
                            if entry is None:
                                continue
                            self._last_snapshot[sym] = entry
                            broadcast_data[sym] = entry

                        if broadcast_data:
                            await strike_intel_manager.broadcast({
                                "type": "strike_intel_update",
                                "data": broadcast_data,
                            })

                    await asyncio.sleep(self._cadence_live)

                # ── CLOSED ───────────────────────────────────────────────────
                else:
                    # One-time fetch when first entering CLOSED with no snapshot
                    if not self._last_snapshot and not _closed_fetch_done:
                        self._init_kite()

                        async def _fetch_one_closed(symbol: str) -> tuple:
                            try:
                                spot = self._get_spot_price(symbol, allow_persistent_fallback=True)
                                if spot <= 0:
                                    return (symbol, None)
                                raw = await asyncio.to_thread(
                                    self._fetch_strikes_sync, symbol, spot
                                )
                                if raw:
                                    data = self._build_symbol_data(symbol, raw)
                                    data["dataSource"] = "LAST_CLOSE"
                                    return (symbol, data)
                                if symbol in self._last_snapshot and _is_real_chain_entry(self._last_snapshot[symbol]):
                                    entry = dict(self._last_snapshot[symbol])
                                    entry["dataSource"] = "LAST_CLOSE"
                                    return (symbol, entry)
                                return (symbol, None)
                            except Exception as e:
                                logger.debug("Strike intel closed fetch error for %s: %s", symbol, e)
                                return (symbol, None)

                        results = await asyncio.gather(
                            *[_fetch_one_closed(sym) for sym in SYMBOLS],
                            return_exceptions=True,
                        )
                        for result in results:
                            if isinstance(result, Exception):
                                continue
                            sym, entry = result
                            if entry is not None:
                                self._last_snapshot[sym] = entry
                        _closed_fetch_done = True

                    if self._last_snapshot:
                        ts_now = datetime.now(IST).isoformat()
                        for sym in list(self._last_snapshot.keys()):
                            entry = self._last_snapshot[sym]
                            if not isinstance(entry, dict):
                                continue
                            if _is_real_chain_entry(entry):
                                preserved = self._with_runtime_meta(
                                    dict(entry),
                                    spot_timestamp=entry.get("spotUpdatedAt") or entry.get("timestamp"),
                                    option_timestamp=entry.get("optionChainUpdatedAt") or entry.get("timestamp"),
                                )
                                preserved["dataSource"] = "LAST_CLOSE"
                                self._last_snapshot[sym] = preserved
                                continue

                            current_spot = self._get_spot_price(sym, allow_persistent_fallback=True)
                            if current_spot > 0:
                                entry = _apply_spot_to_cached_entry(entry, current_spot, sym)
                            entry["dataSource"] = "MARKET_CLOSED"
                            entry["timestamp"] = ts_now
                            self._last_snapshot[sym] = entry
                        await strike_intel_manager.broadcast({
                            "type": "strike_intel_update",
                            "data": self._last_snapshot,
                        })

                    await asyncio.sleep(self._cadence_closed)

                # Heartbeat (every 30s)
                if now_ts - last_heartbeat > self._heartbeat_interval:
                    last_heartbeat = now_ts
                    await strike_intel_manager.broadcast({
                        "type": "strike_intel_heartbeat",
                        "timestamp": datetime.now(IST).isoformat(),
                    })

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Strike Intelligence loop error: %s", e, exc_info=True)
                await asyncio.sleep(10)


# ── Singleton ────────────────────────────────────────────────────────────────

_service: Optional[StrikeIntelligenceService] = None


def get_strike_intelligence_service() -> StrikeIntelligenceService:
    global _service
    if _service is None:
        _service = StrikeIntelligenceService()
    return _service
