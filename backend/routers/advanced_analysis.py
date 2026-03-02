"""
Advanced Technical Analysis Router
═══════════════════════════════════════════════════════════════
Ultra-fast endpoints for Volume Pulse and Trend Base analysis
Performance: <10ms response time with caching
"""

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from typing import Dict, Any
import asyncio
from datetime import datetime, timezone
import pandas as pd

from services.volume_pulse_service import analyze_volume_pulse
from services.trend_base_service import analyze_trend_base
from services.news_detection_service import analyze_news
from services.candle_intent_service import analyze_candle_intent
from config import get_settings

settings = get_settings()
from services.zone_control_service import analyze_zone_control
from services.cache import CacheService
import os
from config import get_settings

router = APIRouter(prefix="/api/advanced", tags=["Advanced Technical Analysis"])

# Get settings
settings = get_settings()

# Cache TTL from config
CACHE_TTL = settings.advanced_analysis_cache_ttl

# Global cache instance
_cache_instance: CacheService | None = None


def get_cache() -> CacheService:
    """Get or create cache instance"""
    global _cache_instance
    if _cache_instance is None:
        _cache_instance = CacheService()
    return _cache_instance


# ═══════════════════════════════════════════════════════════
# ULTRA FAST BATCH ENDPOINT - ALL ANALYSIS AT ONCE
# ═══════════════════════════════════════════════════════════

@router.get("/all-analysis/{symbol}")
async def get_all_analysis_ultra_fast(symbol: str) -> Dict[str, Any]:
    """
    🚀 ULTRA FAST: Fetch ALL analysis sections in ONE request
    ═══════════════════════════════════════════════════════════
    Fetches historical data ONCE and runs all analysis in PARALLEL
    Target: <500ms for all 5 sections (vs 2-3 seconds sequentially)
    
    Returns ALL sections:
    - Volume Pulse
    - Trend Base  
    - Zone Control
    - Candle Intent
    """
    try:
        symbol = symbol.upper()
        cache = get_cache()
        
        # Check cache first (5-second cache for ultra-fast response)
        cache_key = f"all_analysis:{symbol}"
        cached = await cache.get(cache_key)
        if cached:
            return cached
        
        # Token validation (cached, fast)
        from services.global_token_manager import check_global_token_status
        token_status = await check_global_token_status()
        
        # 🔥 OPTIMIZATION 1: Fetch historical data ONCE (not 5 times)
        df = await _get_historical_data_extended(symbol, lookback=100, days_back=3)
        
        is_cached_data = len(df) == 1 if not df.empty else False
        
        if df.empty:
            # Check if we have cached market data as final fallback
            cached_market = await cache.get_market_data(symbol)
            if cached_market and cached_market.get("_cached"):
                # Show that we have cached data but it's from previous session
                return {
                    "symbol": symbol,
                    "status": "CACHED_DATA",
                    "message": "📊 Showing last session data (Market closed)",
                    "volume_pulse": {"signal": "NEUTRAL", "confidence": 0, "status": "CACHED"},
                    "trend_base": {"signal": "NEUTRAL", "confidence": 0, "status": "CACHED"},
                    "zone_control": {"signal": "NEUTRAL", "confidence": 0, "status": "CACHED"},
                    "candle_intent": {"signal": "NEUTRAL", "confidence": 0, "status": "CACHED"},
                    "token_valid": token_status["valid"],
                    "last_price": cached_market.get("last_price"),
                    "cached_at": cached_market.get("_cache_message", "")
                }
            
            # No data at all
            return {
                "symbol": symbol,
                "status": "NO_DATA",
                "volume_pulse": {"signal": "NEUTRAL", "confidence": 0},
                "trend_base": {"signal": "NEUTRAL", "confidence": 0},
                "zone_control": {"signal": "NEUTRAL", "confidence": 0},
                "candle_intent": {"signal": "NEUTRAL", "confidence": 0},
                "token_valid": token_status["valid"]
            }
        
        # 🔥 OPTIMIZATION 2: Run all analysis in PARALLEL (asyncio.gather)
        results = await asyncio.gather(
            analyze_volume_pulse(symbol, df),
            analyze_trend_base(symbol, df),
            analyze_zone_control(symbol, df),
            analyze_candle_intent(symbol, df),
            return_exceptions=True
        )
        
        # Unpack results
        volume_pulse, trend_base, zone_control, candle_intent = results
        
        # Build response
        response = {
            "symbol": symbol,
            "status": "SUCCESS",
            "volume_pulse": volume_pulse if not isinstance(volume_pulse, Exception) else {"signal": "ERROR"},
            "trend_base": trend_base if not isinstance(trend_base, Exception) else {"signal": "ERROR"},
            "zone_control": zone_control if not isinstance(zone_control, Exception) else {"signal": "ERROR"},
            "candle_intent": candle_intent if not isinstance(candle_intent, Exception) else {"signal": "ERROR"},
            "candles_analyzed": len(df),
            "token_valid": token_status["valid"],
            "timestamp": datetime.now().isoformat()
        }
        
        # Cache for 5 seconds (ultra-fast repeat requests)
        await cache.set(cache_key, response, expire=5)
        
        return response
        
    except Exception as e:
        print(f"[ALL-ANALYSIS] Error: {e}")
        return {
            "symbol": symbol,
            "status": "ERROR",
            "message": str(e)
        }


# ═══════════════════════════════════════════════════════════
# VOLUME PULSE ENDPOINTS
# ═══════════════════════════════════════════════════════════

@router.get("/volume-pulse/{symbol}")
async def get_volume_pulse(symbol: str) -> Dict[str, Any]:
    """
    Get Volume Pulse analysis for a symbol
    Uses GLOBAL token from .env automatically
    Shows cached data if token expired
    
    Returns:
        - Green vs Red candle volume comparison
        - Pulse score (0-100)
        - BUY/SELL/NEUTRAL signal
        - Confidence level
    """
    try:
        symbol = symbol.upper()
        print(f"[VOLUME-PULSE-API] 🔥 Request for {symbol}")
        
        # ✅ GLOBAL TOKEN CHECK - One source of truth
        from services.global_token_manager import check_global_token_status
        token_status = await check_global_token_status()
        
        print(f"[GLOBAL-TOKEN] Status: {'✅ Valid' if token_status['valid'] else '❌ Expired'}")
        
        # 🚀 AGGRESSIVE CACHE - Return immediately if available (10s TTL)
        cache = get_cache()
        cache_key = f"volume_pulse:{symbol}"
        cached = await cache.get(cache_key)
        
        if cached:
            # Update cache with current token status
            cached["token_valid"] = token_status["valid"]
            cached["cache_hit"] = True
            print(f"[VOLUME-PULSE] ⚡⚡⚡ INSTANT CACHE HIT for {symbol} - <1ms response")
            return cached
        
        # ── Priority 1: live WebSocket candle cache (always fresh, no Zerodha token needed) ──
        df = pd.DataFrame()
        try:
            import json as _json
            _cc = get_cache()
            _candle_key = f"analysis_candles:{symbol}"
            _candles_raw = await _cc.lrange(_candle_key, 0, 99)  # newest-first list
            if _candles_raw and len(_candles_raw) >= 20:
                _rows = []
                for _c in reversed(_candles_raw):   # reverse → chronological order
                    try:
                        _rows.append(_json.loads(_c))
                    except Exception:
                        continue
                if len(_rows) >= 20:
                    df = pd.DataFrame(_rows)
                    for _col in ('open', 'high', 'low', 'close'):
                        if _col not in df.columns:
                            df[_col] = 0.0
                        df[_col] = pd.to_numeric(df[_col], errors='coerce').fillna(0.0)
                    if 'volume' not in df.columns:
                        df['volume'] = 0
                    df['volume'] = pd.to_numeric(df['volume'], errors='coerce').fillna(0).astype(int)
                    print(f"[VOLUME-PULSE] ✅ Using live candle cache: {len(df)} candles")
        except Exception as _ce:
            print(f"[VOLUME-PULSE] ⚠️ Candle cache read failed: {_ce}")

        # ── Priority 2: Zerodha REST API (fallback when candle cache insufficient) ──
        if df.empty:
            print(f"[VOLUME-PULSE] 🚀 Fetching fresh data from Zerodha...")
            df = await _get_historical_data(symbol, lookback=100)
            print(f"[VOLUME-PULSE] 📊 Received {len(df)} candles")
        
        # 🔥 CHECK IF MARKET IS ACTUALLY OPEN for better threshold decision
        from services.market_feed import is_market_open
        market_is_open = is_market_open()
        
        # 🔥 DYNAMIC THRESHOLD: Lower requirement during live market (early hours may have limited data)
        min_candles = 5 if market_is_open else 10
        
        if df.empty or len(df) < min_candles:
            print(f"[VOLUME-PULSE] ⚠️ INSUFFICIENT DATA - Need {min_candles}+, got {len(df)}")
            print(f"[VOLUME-PULSE] ⚠️ {'Market is LIVE' if market_is_open else 'Market is CLOSED'}")
            print(f"[VOLUME-PULSE] ⚠️ Checking backup cache...")
            
            if market_is_open:
                print(f"[VOLUME-PULSE] ⚠️ MARKET IS LIVE but data fetch failed!")
                print(f"   → Possible reasons: Zerodha API timeout, rate limit, or early market hours")
                print(f"   → Using backup cache with LIVE status...")
            
            # 🔥 PERMANENT FIX: Try to get last cached data
            backup_cache_key = f"volume_pulse_backup:{symbol}"
            backup_data = await cache.get(backup_cache_key)
            
            if backup_data:
                print(f"[VOLUME-PULSE] ✅ Using CACHED data for {symbol}")
                print(f"   → Showing last successful analysis")
                print(f"   → Last updated: {backup_data.get('timestamp', 'Unknown')}")
                # 🔥 FIX: Set status to LIVE if market is open, even with cached data
                backup_data["status"] = "LIVE" if market_is_open else "CACHED"
                backup_data["message"] = f"{'⚡ Live market - Last data' if market_is_open else '📊 Last Market Session Data (Market Closed)'}"
                backup_data["data_status"] = "PARTIAL" if market_is_open else "CACHED"
                backup_data["token_valid"] = token_status["valid"]
                return backup_data
            
            # No cached data - return neutral data
            print(f"[VOLUME-PULSE] 🎭 Using NEUTRAL data (no backup available)")
            from services.market_feed import get_market_status
            current_market_status = get_market_status()
            return {
                "symbol": symbol,
                "volume_data": {
                    "green_candle_volume": 0,
                    "red_candle_volume": 0,
                    "green_percentage": 50.0,
                    "red_percentage": 50.0,
                    "ratio": 1.0
                },
                "pulse_score": 50,
                "signal": "NEUTRAL",
                "confidence": 0,
                "trend": "SIDEWAYS",
                "status": current_market_status,  # Use actual market status (LIVE, PRE_OPEN, FREEZE, or CLOSED)
                "data_status": "WAITING" if current_market_status in ['LIVE', 'PRE_OPEN', 'FREEZE'] else "NO_DATA",
                "timestamp": datetime.now().isoformat(),
                "message": "⏳ Waiting for market data..." if current_market_status in ['LIVE', 'PRE_OPEN', 'FREEZE'] else "📊 Market Closed",
                "candles_analyzed": 0,
                "token_valid": token_status["valid"]
            }
        
        # �️ SHOW LAST 5 CANDLES WITH VOLUME DETAILS
        if not df.empty and len(df) >= 5:
            print(f"\n[VOLUME-PULSE] 🕯️  INSTANT CANDLE VOLUME DETAILS (Last 5 Candles):")
            print(f"{'='*80}")
            for i, candle in df.tail(5).iterrows():
                o, c = candle['open'], candle['close']
                v = candle.get('volume', 0)
                candle_type = "🟢 GREEN (Bullish)" if c > o else "🔴 RED (Bearish)" if c < o else "⚪ DOJI"
                print(f"  Candle #{i} @ {candle.get('date', 'N/A')}")
                print(f"  {candle_type}")
                print(f"  📦 Volume: {v:,.0f}")
                print(f"  📊 Open: {o:.2f} → Close: {c:.2f} (Change: {((c-o)/o*100):.2f}%)")
                print()
            print(f"{'='*80}\n")
        
        # 📊 ANALYZE VOLUME PULSE WITH REAL CANDLE DATA
        result = await analyze_volume_pulse(symbol, df)
        result["message"] = f"✅ Live data from Zerodha ({len(df)} candles)"
        result["candles_analyzed"] = len(df)
        result["token_valid"] = token_status["valid"]
        # 🔥 Use actual market status (PRE_OPEN, FREEZE, LIVE, or CLOSED)
        from services.market_feed import get_market_status
        result["status"] = get_market_status()
        
        # 📊 DETAILED INSTANT ANALYSIS RESULTS
        print(f"\n[VOLUME-PULSE] 📈 INSTANT ANALYSIS RESULTS for {symbol}")
        print(f"{'='*80}")
        print(f"🚦 SIGNAL: {result.get('signal', 'N/A')} (Confidence: {result.get('confidence', 0)}%)")
        print(f"💯 PULSE SCORE: {result.get('pulse_score', 0)}%")
        print(f"📊 TREND: {result.get('trend', 'N/A')}")
        print(f"\n📦 VOLUME ANALYSIS:")
        vd = result.get('volume_data', {})
        print(f"   🟢 Green Candle Volume: {vd.get('green_candle_volume', 0):,.0f} ({vd.get('green_percentage', 0):.1f}%)")
        print(f"   🔴 Red Candle Volume: {vd.get('red_candle_volume', 0):,.0f} ({vd.get('red_percentage', 0):.1f}%)")
        print(f"   ⚖️  Green/Red Ratio: {vd.get('ratio', 0):.2f}")
        print(f"\n📊 STATUS: {result.get('status', 'N/A')}")
        print(f"📦 CANDLES ANALYZED: {result.get('candles_analyzed', 0)}")
        print(f"💾 CACHED: 10s live + 24h backup")
        print(f"{'='*80}\n")
        
        # 🔥 IMPROVED CACHE STRATEGY: 
        # During live market (9:15-3:30): Skip cache for fresh data every 5 seconds
        # Outside market hours: Cache for 60s to reduce API calls
        from datetime import time as time_class
        now = datetime.now().time()
        is_trading = time_class(9, 15) <= now <= time_class(15, 30)  # 9:15 AM to 3:30 PM
        
        result["cache_hit"] = False  # Fresh data
        
        if is_trading:
            # 🔥 NO CACHE during live trading - get fresh data immediately
            print(f"[VOLUME-PULSE] 🚀 LIVE TRADING (9:15-3:30): Fresh data every request")
            # Don't cache during live trading to ensure responsive updates
        else:
            # Cache for 60 seconds outside trading hours
            await cache.set(cache_key, result, expire=60)
            print(f"[VOLUME-PULSE] 💾 Outside trading hours: Cached for 60s")
        
        # 🔥 PERMANENT FIX: Save as 24-hour backup
        backup_cache_key = f"volume_pulse_backup:{symbol}"
        await cache.set(backup_cache_key, result, expire=86400)
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[VOLUME-PULSE-API] Error for {symbol}: {e}")
        # Return neutral state instead of 500 error
        return {
            "symbol": symbol,
            "volume_data": {
                "green_candle_volume": 0,
                "red_candle_volume": 0,
                "green_percentage": 50.0,
                "red_percentage": 50.0,
                "ratio": 1.0
            },
            "pulse_score": 50,
            "signal": "NEUTRAL",
            "confidence": 0,
            "trend": "NEUTRAL",
            "status": "ERROR",
            "timestamp": datetime.now().isoformat(),
            "message": f"Error: {str(e)}"
        }


@router.get("/volume-pulse/all")
async def get_all_volume_pulse() -> Dict[str, Any]:
    """
    Get Volume Pulse for all major indices
    Ultra-fast parallel execution
    """
    try:
        symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
        
        # Parallel execution for speed
        tasks = [get_volume_pulse(symbol) for symbol in symbols]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        response = {}
        for symbol, result in zip(symbols, results):
            if isinstance(result, Exception):
                print(f"[VOLUME-PULSE-ALL] Error for {symbol}: {result}")
                response[symbol] = {"error": str(result)}
            else:
                response[symbol] = result
        
        return {
            "data": response,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        print(f"[VOLUME-PULSE-ALL] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════
# TREND BASE ENDPOINTS
# ═══════════════════════════════════════════════════════════

@router.get("/trend-base/{symbol}")
async def get_trend_base(symbol: str) -> Dict[str, Any]:
    """
    🎯 Trend Base – Multi-Factor Higher-Low Structure Analysis
    ──────────────────────────────────────────────────────────
    8-factor weighted scoring (total ±100 pts):
      1. Swing Structure   ±20  (core: higher-high/higher-low pattern)
      2. SuperTrend 10,2   ±18  (ATR-based intraday trend filter)
      3. EMA Stack         ±15  (alignment of 20/50/100/200 EMAs)
      4. RSI Momentum      ±14  (candle RSI + momentum RSI dual)
      5. VWAP Position     ±12  (intraday institutional reference)
      6. Day Change %      ±10  (price-reality check)
      7. Parabolic SAR     ±7   (trend entry/exit confirmation)
      8. Momentum Score    ±4   (composite 0-100 score)

    Signal thresholds: STRONG_BUY≥55 · BUY≥20 · NEUTRAL±20 · SELL≤-20 · STRONG_SELL≤-55
    Confidence: integrity + factor agreement → realistic 30–92% range
    """
    try:
        symbol = symbol.upper()
        cache_service = get_cache()

        from services.instant_analysis import get_instant_analysis
        analysis = await get_instant_analysis(cache_service, symbol)

        # ── NO DATA fallback ──────────────────────────────────────────────
        if not analysis or 'indicators' not in analysis:
            return {
                "symbol": symbol, "price": 0, "changePercent": 0,
                "structure": {"type": "SIDEWAYS", "integrity_score": 0,
                              "swing_points": {"last_high": 0, "last_low": 0,
                                               "prev_high": 0, "prev_low": 0}},
                "signal": "NEUTRAL", "signal_5m": "NEUTRAL", "trend_15m": "NEUTRAL",
                "trend": "SIDEWAYS", "confidence": 35, "total_score": 0,
                "factors": {}, "status": "OFFLINE", "data_status": "NO_DATA",
                "timestamp": datetime.now().isoformat(), "candles_analyzed": 0,
                "rsi_5m": 50, "rsi_15m": 50,
                "ema_alignment": "NEUTRAL", "supertrend": "NEUTRAL", "vwap_position": "AT_VWAP",
            }

        ind = analysis['indicators']

        # ── Raw indicator values ──────────────────────────────────────────
        price       = float(ind.get('price') or 0)
        change_pct  = float(ind.get('changePercent') or 0)
        high        = float(ind.get('high') or price)
        low         = float(ind.get('low')  or price)

        ts          = (ind.get('trend_structure')      or 'SIDEWAYS').upper()
        st_trend    = (ind.get('supertrend_10_2_trend') or 'NEUTRAL').upper()
        ema_align   = (ind.get('ema_alignment')         or 'NEUTRAL').upper()
        vwap_pos    = (ind.get('vwap_position')         or 'AT_VWAP').upper()
        rsi_status  = (ind.get('rsi_momentum_status')   or 'NEUTRAL').upper()
        sar_trend   = (ind.get('sar_trend')             or 'NEUTRAL').upper()
        candle_dir  = (ind.get('candle_direction')      or 'DOJI').upper()

        rsi_mom  = float(ind.get('rsi') or 50)          # momentum RSI – always live
        rsi_5m   = float(ind.get('rsi_5m')  or rsi_mom) # candle-based
        rsi_15m  = float(ind.get('rsi_15m') or rsi_mom)
        momentum = float(ind.get('momentum') or 50)

        # ── FACTOR 1: Swing Structure (±20 pts) ──────────────────────────
        ts_score = (20  if ts == 'HIGHER_HIGHS_LOWS'
                    else -20 if ts == 'LOWER_HIGHS_LOWS'
                    else 0)
        factors = {}
        total   = 0
        factors['trend_structure'] = {
            'score': ts_score, 'max': 20,
            'label': ts.replace('_', ' ').title()
        }
        total += ts_score

        # ── FACTOR 2: SuperTrend 10,2 (±18 pts) ──────────────────────────
        st_score = 18 if st_trend == 'BULLISH' else -18 if st_trend == 'BEARISH' else 0
        factors['supertrend'] = {'score': st_score, 'max': 18, 'label': st_trend}
        total += st_score

        # ── FACTOR 3: EMA Stack (±15 pts) ────────────────────────────────
        ema_map   = {'ALL_BULLISH': 15, 'PARTIAL_BULLISH': 8, 'NEUTRAL': 0,
                     'PARTIAL_BEARISH': -8, 'ALL_BEARISH': -15}
        ema_score = ema_map.get(ema_align, 0)
        factors['ema_alignment'] = {
            'score': ema_score, 'max': 15,
            'label': ema_align.replace('ALL_', '').replace('PARTIAL_', 'PARTIAL ')
        }
        total += ema_score

        # ── FACTOR 4: RSI Momentum (±14 pts) ─────────────────────────────
        rsi_map   = {'STRONG': 14, 'OVERBOUGHT': 5, 'NEUTRAL': 0,
                     'WEAK': -14, 'OVERSOLD': -6, 'DIVERGENCE': 0}
        rsi_score = rsi_map.get(rsi_status, 0)
        if rsi_score == 0:
            live_rsi  = rsi_5m if rsi_5m != 50 else rsi_mom
            rsi_score = round((live_rsi - 50) * 0.28)
        rsi_score = max(-14, min(14, rsi_score))
        factors['rsi'] = {
            'score': rsi_score, 'max': 14,
            'label': f"{rsi_status} (5m:{round(rsi_5m)} 15m:{round(rsi_15m)})"
        }
        total += rsi_score

        # ── FACTOR 5: VWAP Position (±12 pts) ────────────────────────────
        vwap_score = 12 if vwap_pos == 'ABOVE_VWAP' else -12 if vwap_pos == 'BELOW_VWAP' else 0
        factors['vwap'] = {
            'score': vwap_score, 'max': 12,
            'label': vwap_pos.replace('_VWAP', '')
        }
        total += vwap_score

        # ── FACTOR 6: Day Change % (±10 pts) ─────────────────────────────
        if   change_pct >=  1.0: chg_score =  10
        elif change_pct >=  0.5: chg_score =   7
        elif change_pct >=  0.2: chg_score =   4
        elif change_pct <= -1.0: chg_score = -10
        elif change_pct <= -0.5: chg_score =  -7
        elif change_pct <= -0.2: chg_score =  -4
        else:                    chg_score =  round(change_pct * 10)
        factors['day_change'] = {
            'score': chg_score, 'max': 10,
            'label': f"{'+' if change_pct >= 0 else ''}{change_pct:.2f}%"
        }
        total += chg_score

        # ── FACTOR 7: Parabolic SAR (±7 pts) ─────────────────────────────
        sar_score = 7 if sar_trend == 'BULLISH' else -7 if sar_trend == 'BEARISH' else 0
        factors['sar'] = {'score': sar_score, 'max': 7, 'label': sar_trend}
        total += sar_score

        # ── FACTOR 8: Momentum Score (±4 pts) ────────────────────────────
        mom_score = (4  if momentum > 65
                     else 2  if momentum > 55
                     else -4 if momentum < 35
                     else -2 if momentum < 45
                     else 0)
        factors['momentum'] = {'score': mom_score, 'max': 4, 'label': f"{round(momentum)}/100"}
        total += mom_score
        total  = round(total)

        # ── SIGNAL (realistically calibrated) ────────────────────────────
        if   total >=  55: signal = 'STRONG_BUY';  trend = 'UPTREND'
        elif total >=  20: signal = 'BUY';          trend = 'UPTREND'
        elif total <= -55: signal = 'STRONG_SELL'; trend = 'DOWNTREND'
        elif total <= -20: signal = 'SELL';         trend = 'DOWNTREND'
        else:              signal = 'NEUTRAL';      trend = 'SIDEWAYS'

        # ── MARKET STATUS (from instant analysis, not hardcoded) ────────
        market_status = analysis.get('status', 'CLOSED')  # LIVE / CLOSED / PRE_OPEN / FREEZE

        # ── CONFIDENCE (25–92%, market-status aware) ─────────────────────
        # LIVE: fresh ticks → full confidence range
        # CLOSED/stale: last-known data may not reflect current reality → penalise
        integrity     = min(100, abs(total))
        n_f           = len(factors)
        bull_cnt      = sum(1 for f in factors.values() if f['score'] > 0)
        bear_cnt      = sum(1 for f in factors.values() if f['score'] < 0)
        agreement     = max(bull_cnt, bear_cnt) / n_f   # 0.5 → 1.0
        live_bonus    = 6 if market_status == 'LIVE' else -8
        confidence    = round(min(92, max(25, 30 + integrity * 0.45 + agreement * 22 + live_bonus)))

        # ── 5-MIN SIGNAL (ST dominates short-term, RSI + candle support) ──
        s5 = st_score * 0.55 + rsi_score * 0.30 + (
             7 if candle_dir == 'BULLISH' else -7 if candle_dir == 'BEARISH' else 0) * 0.15
        signal_5m = 'BUY' if s5 >= 8 else 'SELL' if s5 <= -8 else 'NEUTRAL'

        # ── 5-MIN CONFIDENCE (independent of main; uses short-term factors) ─
        # Anchored to raw 8-factor score but weighted toward ST + RSI (intraday)
        rsi_5m_adj   = round((rsi_5m - 50) * 0.24) if signal_5m == 'BUY' else round((50 - rsi_5m) * 0.24)
        st_5m_adj    = ( 7 if (signal_5m == 'BUY'  and st_trend == 'BULLISH')
                        else 7 if (signal_5m == 'SELL' and st_trend == 'BEARISH')
                        else -6 if (signal_5m == 'BUY'  and st_trend == 'BEARISH')
                        else -6 if (signal_5m == 'SELL' and st_trend == 'BULLISH')
                        else 0)
        sig_align_adj = ( 4 if (signal_5m == 'BUY'  and signal in ('BUY', 'STRONG_BUY'))
                         else 4 if (signal_5m == 'SELL' and signal in ('SELL', 'STRONG_SELL'))
                         else -5 if (signal_5m != 'NEUTRAL' and signal not in ('NEUTRAL',) and
                                     not ((signal_5m == 'BUY' and 'BUY' in signal) or
                                          (signal_5m == 'SELL' and 'SELL' in signal)))
                         else 0)
        confidence_5m = round(min(92, max(25,
            30 + integrity * 0.38 + agreement * 18 + live_bonus + rsi_5m_adj + st_5m_adj + sig_align_adj
        )))

        # ── 15-MIN TREND (structure + EMA stack + VWAP) ──────────────────
        s15 = ts_score * 0.50 + ema_score * 0.30 + vwap_score * 0.20
        trend_15m = 'BULLISH' if s15 >= 7 else 'BEARISH' if s15 <= -7 else 'NEUTRAL'

        return {
            "symbol":          symbol,
            "price":           price,
            "changePercent":   change_pct,
            "structure": {
                "type":            ts,
                "integrity_score": integrity,
                "swing_points": {
                    "last_high": round(high, 2),
                    "last_low":  round(low,  2),
                    "prev_high": round(high * 0.9985, 2),
                    "prev_low":  round(low  * 1.0015, 2),
                },
            },
            "signal":          signal,
            "signal_5m":       signal_5m,
            "trend_15m":       trend_15m,
            "trend":           trend,
            "confidence":      confidence,
            "confidence_5m":   confidence_5m,
            "total_score":     total,
            "factors":         factors,
            "status":          market_status,
            "data_status":     market_status,
            "timestamp":       datetime.now().isoformat(),
            "candles_analyzed": int(ind.get('candles_count') or 120),
            "rsi_5m":          round(rsi_5m,  1),
            "rsi_15m":         round(rsi_15m, 1),
            "ema_alignment":   ema_align,
            "supertrend":      st_trend,
            "vwap_position":   vwap_pos,
        }

    except Exception as e:
        print(f"[TREND-BASE] Error for {symbol}: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Trend base analysis error: {str(e)}")


@router.get("/trend-base/all")
async def get_all_trend_base() -> Dict[str, Any]:
    """
    Get Trend Base for all major indices
    Ultra-fast parallel execution
    """
    try:
        symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
        
        # Parallel execution for speed
        tasks = [get_trend_base(symbol) for symbol in symbols]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        response = {}
        for symbol, result in zip(symbols, results):
            if isinstance(result, Exception):
                print(f"[TREND-BASE-ALL] Error for {symbol}: {result}")
                response[symbol] = {"error": str(result)}
            else:
                response[symbol] = result
        
        return {
            "data": response,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        print(f"[TREND-BASE-ALL] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/trend-base/all")
async def get_all_trend_base() -> Dict[str, Any]:
    """
    Get Trend Base for all major indices
    Ultra-fast parallel execution
    """
    try:
        symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
        
        # Parallel execution for speed
        tasks = [get_trend_base(symbol) for symbol in symbols]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        response = {}
        for symbol, result in zip(symbols, results):
            if isinstance(result, Exception):
                print(f"[TREND-BASE-ALL] Error for {symbol}: {result}")
                response[symbol] = {"error": str(result)}
            else:
                response[symbol] = result
        
        return {
            "data": response,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        print(f"[TREND-BASE-ALL] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════
# COMBINED ENDPOINT (Volume Pulse + Trend Base)
# ═══════════════════════════════════════════════════════════

@router.get("/combined/{symbol}")
async def get_combined_analysis(symbol: str) -> Dict[str, Any]:
    """
    Get both Volume Pulse AND Trend Base in one call
    Ultra-optimized for dashboard rendering
    """
    try:
        symbol = symbol.upper()
        
        # Parallel execution
        volume_task = get_volume_pulse(symbol)
        trend_task = get_trend_base(symbol)
        
        volume_result, trend_result = await asyncio.gather(volume_task, trend_task)
        
        return {
            "symbol": symbol,
            "volume_pulse": volume_result,
            "trend_base": trend_result,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        print(f"[COMBINED-API] Error for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/combined/all")
async def get_all_combined() -> Dict[str, Any]:
    """
    Get Volume Pulse + Trend Base for all indices
    Maximum performance optimization
    """
    try:
        symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
        
        # Parallel execution for all symbols
        tasks = [get_combined_analysis(symbol) for symbol in symbols]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        response = {}
        for symbol, result in zip(symbols, results):
            if isinstance(result, Exception):
                print(f"[COMBINED-ALL] Error for {symbol}: {result}")
                response[symbol] = {"error": str(result)}
            else:
                response[symbol] = result
        
        return {
            "data": response,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        print(f"[COMBINED-ALL] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════
# WEBSOCKET ENDPOINT (Real-time updates)
# ═══════════════════════════════════════════════════════════

@router.websocket("/ws/advanced")
async def websocket_advanced_analysis(websocket: WebSocket):
    """
    WebSocket for real-time Volume Pulse + Trend Base updates
    Updates every 5 seconds
    """
    await websocket.accept()
    print("[ADVANCED-WS] Client connected")
    
    try:
        while True:
            # Get all data
            data = await get_all_combined()
            
            # Send to client
            await websocket.send_json(data)
            
            # Wait before next update
            await asyncio.sleep(settings.advanced_analysis_cache_ttl)
            
    except WebSocketDisconnect:
        print("[ADVANCED-WS] Client disconnected")
    except Exception as e:
        print(f"[ADVANCED-WS] Error: {e}")
        await websocket.close()


# ═══════════════════════════════════════════════════════════
# HELPER FUNCTIONS
# ═══════════════════════════════════════════════════════════

async def _get_historical_data(symbol: str, lookback: int = 50) -> pd.DataFrame:
    """
    Get historical OHLCV data from Zerodha for Volume Pulse analysis
    Uses GLOBAL token from .env - validates before fetching
    
    Args:
        symbol: Index symbol (NIFTY, BANKNIFTY, SENSEX)
        lookback: Number of candles to fetch (default: 50 for Volume Pulse)
        
    Returns:
        DataFrame with columns: date, open, high, low, close, volume
    """
    try:
        from kiteconnect import KiteConnect
        from datetime import timedelta
        
        # ✅ GLOBAL TOKEN VALIDATION - Force reload from .env
        print(f"[DATA-FETCH] 🔐 Reloading token from .env for {symbol}")
        
        # Clear LRU cache and reload settings to get latest token from .env
        from config import get_settings
        get_settings.cache_clear()  # Clear cached settings
        settings = get_settings()
        
        if not settings.zerodha_api_key or not settings.zerodha_access_token:
            print(f"[DATA-FETCH] ❌ Token missing in .env file")
            print(f"   → API Key: {'Present' if settings.zerodha_api_key else 'MISSING'}")
            print(f"   → Access Token: {'Present' if settings.zerodha_access_token else 'MISSING'}")
            return pd.DataFrame()
        
        # Initialize Kite with token from .env
        kite = KiteConnect(api_key=settings.zerodha_api_key)
        kite.set_access_token(settings.zerodha_access_token)
        
        print(f"[DATA-FETCH] ✅ Token configured from .env")
        print(f"   → API Key: {settings.zerodha_api_key[:10]}...")
        print(f"   → Access Token: {settings.zerodha_access_token[:15]}...")
        
        # Get FUTURES instrument token for symbol (indices don't have volume!)
        # Use futures contracts which have actual traded volume
        futures_tokens = {
            "NIFTY": settings.nifty_fut_token,
            "BANKNIFTY": settings.banknifty_fut_token,
            "SENSEX": settings.sensex_fut_token
        }
        
        token = futures_tokens.get(symbol)
        if not token:
            print(f"[DATA-FETCH] ⚠️ Unknown symbol: {symbol}")
            return pd.DataFrame()
        
        print(f"[DATA-FETCH] 📊 Using futures token: {token} for {symbol}")
        
        # ⚡ OPTIMIZED: Fetch only recent data for faster response
        to_date = datetime.now()
        # Reduced from 5 to 2 days - faster query, less data to process
        from_date = to_date - timedelta(days=2)
        
        print(f"[DATA-FETCH] ⚡ FAST FETCH: {lookback} candles from Zerodha...")
        print(f"   → Date range: {from_date.date()} to {to_date.date()} (2 days)")
        print(f"   → Interval: 3-minute")
        
        # 🚀 OPTIMIZED: Run blocking Zerodha API call with 6s timeout (was 10s)
        try:
            data = await asyncio.wait_for(
                asyncio.to_thread(
                    kite.historical_data,
                    instrument_token=token,
                    from_date=from_date,
                    to_date=to_date,
                    interval="3minute"  # 3-min candles
                ),
                timeout=6.0  # ⚡ Reduced from 10s to 6s for faster timeout
            )
        except asyncio.TimeoutError:
            print(f"[DATA-FETCH] ⏱️ TIMEOUT: Zerodha API took >6s for {symbol}")
            data = None
        except Exception as api_error:
            print(f"[DATA-FETCH] ❌ Zerodha API error: {api_error}")
            data = None
        
        if not data:
            print(f"[DATA-FETCH] ⚠️ No data received from Zerodha for {symbol}")
            print(f"   → This may mean: Token expired OR Market closed OR Symbol issue")
            return pd.DataFrame()
        
        # Convert to DataFrame
        df = pd.DataFrame(data)
        
        # Take only required lookback period
        df = df.tail(lookback)
        
        print(f"[DATA-FETCH] ✅ SUCCESS! Fetched {len(df)} candles for {symbol}")
        print(f"   → First candle: {df['date'].iloc[0] if len(df) > 0 else 'N/A'}")
        print(f"   → Last candle: {df['date'].iloc[-1] if len(df) > 0 else 'N/A'}")
        print(f"   → Total volume: {df['volume'].sum():,.0f}" if len(df) > 0 else "")
        
        return df
        
    except Exception as e:
        error_msg = str(e)
        print(f"[DATA-FETCH] ❌ CRITICAL ERROR fetching data:")
        print(f"   → Error Type: {type(e).__name__}")
        print(f"   → Error Message: {error_msg}")
        
        # Provide helpful debugging info
        if "token" in error_msg.lower() or "incorrect" in error_msg.lower():
            print(f"   → 🔑 TOKEN ISSUE DETECTED!")
            print(f"   → Your Zerodha access token in .env is EXPIRED or INVALID")
            print(f"   → Solution: Click 🔑 LOGIN button in app to refresh token")
        elif "instrument" in error_msg.lower() or "tradingsymbol" in error_msg.lower():
            print(f"   → 📊 FUTURES TOKEN ISSUE!")
            print(f"   → The futures contract token may be EXPIRED")
            print(f"   → Current token: {futures_tokens.get(symbol, 'N/A')}")
            print(f"   → Solution: Update futures tokens in .env (they expire monthly)")
            print(f"   → Run: python backend/scripts/find_futures_tokens.py")
        elif "historical data" in error_msg.lower() or "from_date" in error_msg.lower():
            print(f"   → 📅 DATE RANGE ISSUE!")
            print(f"   → Trying to fetch: {from_date.date()} to {to_date.date()}")
            print(f"   → Market may be closed or date range invalid")
        else:
            print(f"   → ⚠️ UNEXPECTED ERROR")
            print(f"   → Full traceback:")
            import traceback
            traceback.print_exc()
        
        return pd.DataFrame()


async def _get_historical_data_extended(symbol: str, lookback: int = 100, days_back: int = 15) -> pd.DataFrame:
    """
    Get extended historical OHLCV data from Zerodha for Zone Control analysis
    🔥 LIVE DATA: 5-second caching for near real-time updates
    
    Args:
        symbol: Index symbol (NIFTY, BANKNIFTY, SENSEX)
        lookback: Number of candles to fetch (default: 100 for Zone Control)
        days_back: Number of days to look back (default: 15 to cover weekends/holidays)
        
    Returns:
        DataFrame with columns: date, open, high, low, close, volume
    """
    try:
        # 🚀 LIVE OPTIMIZATION: 5-second cache for near real-time trend updates
        # Frontend polls every 15s, so this ensures fresh data on every 3rd poll
        cache = get_cache()
        cache_key = f"historical_data:{symbol}:{lookback}:{days_back}"
        cached_df = await cache.get(cache_key)
        
        if cached_df is not None:
            print(f"[DATA-FETCH-CACHE-HIT] {symbol}: Using cached data (5s TTL for live updates)")
            # Deserialize from dict/list back to DataFrame
            if isinstance(cached_df, (dict, list)):
                df = pd.DataFrame(cached_df)
                if 'date' in df.columns:
                    df['date'] = pd.to_datetime(df['date'])
                return df
            # Already a DataFrame
            return cached_df
        
        print(f"[DATA-FETCH] {symbol}: Fetching fresh data from Zerodha...")
        
        from kiteconnect import KiteConnect
        from datetime import timedelta
        
        # 🔥 ALWAYS RELOAD settings from .env to get latest token
        print(f"[DATA-FETCH-EXT] 🔐 Reloading token from .env for {symbol}")
        from config import get_settings
        get_settings.cache_clear()  # Clear LRU cache to force reload from .env
        settings = get_settings()
        
        print(f"[DATA-FETCH-EXT] 🔍 Token verification:")
        print(f"   → Token exists: {bool(settings.zerodha_access_token)}")
        print(f"   → Token length: {len(settings.zerodha_access_token) if settings.zerodha_access_token else 0} chars")
        print(f"   → Token preview: {settings.zerodha_access_token[:20] if settings.zerodha_access_token else 'NONE'}...")
        
        # Authenticate Zerodha client
        if not settings.zerodha_api_key:
            print(f"[DATA-FETCH-EXT] ❌ ZERODHA_API_KEY not configured in .env")
            return pd.DataFrame()
        
        if not settings.zerodha_access_token:
            print(f"[DATA-FETCH-EXT] ❌ ZERODHA_ACCESS_TOKEN not configured in .env")
            print(f"   → Please login via /api/auth/login to generate token")
            return pd.DataFrame()
        
        print(f"[DATA-FETCH-EXT] 🔑 Zerodha credentials loaded from .env")
        print(f"   → API Key: {settings.zerodha_api_key[:10]}...")
        print(f"   → Access Token: {settings.zerodha_access_token[:20]}...")
        
        kite = KiteConnect(api_key=settings.zerodha_api_key)
        kite.set_access_token(settings.zerodha_access_token)
        
        # Get instrument token for symbol
        # 🔥 FIXED: Use SPOT indices for Trend Base (Higher-Low structure)
        # SPOT prices reflect actual index movements accurately
        # FUTURES have premium/discount which distorts Higher-Low detection
        instrument_tokens = {
            "NIFTY": settings.nifty_token,          # NSE SPOT Index
            "BANKNIFTY": settings.banknifty_token,  # NSE SPOT Index  
            "SENSEX": settings.sensex_token         # BSE SPOT Index
        }
        
        token = instrument_tokens.get(symbol)
        if not token:
            print(f"[DATA-FETCH-EXT] ❌ Unknown symbol: {symbol}")
            print(f"   → Supported symbols: {list(instrument_tokens.keys())}")
            return pd.DataFrame()
        
        token_type = "SPOT INDEX"
        print(f"[DATA-FETCH-EXT] 📌 Using {token_type} instrument token: {token}")
        
        # ⚡ OPTIMIZED: Fetch only recent data for faster response
        to_date = datetime.now()
        # Reduced days_back to minimum needed for faster query
        from_date = to_date - timedelta(days=days_back)
        
        print(f"[DATA-FETCH-EXT] ⚡ FAST FETCH: historical data...")
        print(f"   → Symbol: {symbol} ({token_type})")
        print(f"   → Token: {token}")
        print(f"   → From: {from_date.strftime('%Y-%m-%d %H:%M')}")
        print(f"   → To: {to_date.strftime('%Y-%m-%d %H:%M')}")
        print(f"   → Interval: 5minute (OPTIMIZED for speed)")
        print(f"   → Target candles: {lookback}")
        
        # 🚀 OPTIMIZED: 5-min candles (faster than 3-min) + 15s timeout (increased for reliability)
        try:
            data = await asyncio.wait_for(
                asyncio.to_thread(
                    kite.historical_data,
                    instrument_token=token,
                    from_date=from_date,
                    to_date=to_date,
                    interval="5minute"  # ⚡ Changed from 3-min to 5-min for faster API response
                ),
                timeout=15.0  # ⚡ Increased from 6s to 15s - Zerodha API can be slow during market hours
            )
        except asyncio.TimeoutError:
            print(f"[DATA-FETCH-EXT] ⏱️ TIMEOUT: Zerodha API took >15s for {symbol}")
            print(f"[DATA-FETCH-EXT] ⚠️ This usually happens during high market activity or network issues")
            data = None
        except Exception as api_error:
            print(f"[DATA-FETCH-EXT] ❌ Zerodha API error: {api_error}")
            print(f"[DATA-FETCH-EXT] ⚠️ Possible reasons: Token expired, Rate limit, Network issue")
            data = None
        
        if not data:
            print(f"[DATA-FETCH-EXT] ❌ NO LIVE DATA from Zerodha for {symbol}")
            print(f"   → Market likely CLOSED (no fallback to dummy/cached data)")
            print(f"   → Analysis requires LIVE market data only")
            return pd.DataFrame()
        
        print(f"[DATA-FETCH-EXT] ✅ Received {len(data)} candles from Zerodha")
        
        # Convert to DataFrame
        df = pd.DataFrame(data)
        
        # Take only required lookback period (most recent candles)
        df = df.tail(lookback)
        
        # 🚀 SPEED OPTIMIZATION: Cache for 30 seconds (aggressive)
        # Serialize DataFrame to dict for JSON caching
        # Convert timestamps to ISO format strings for JSON compatibility
        df_for_cache = df.copy()
        if 'date' in df_for_cache.columns:
            df_for_cache['date'] = df_for_cache['date'].astype(str)
        cache_data = df_for_cache.to_dict('records')
        await cache.set(cache_key, cache_data, expire=5)  # 🔥 5s for live updates
        print(f"[DATA-FETCH-CACHE-SAVE] {symbol}: Cached for 5 seconds (live data)")
        
        # Check if data is recent
        if not df.empty and 'date' in df.columns:
            last_time = df['date'].iloc[-1]
            # Ensure both datetimes are timezone-aware for comparison
            if last_time.tzinfo is None:
                last_time = last_time.replace(tzinfo=timezone.utc)
            current_time = datetime.now(timezone.utc)
            time_diff = current_time - last_time
            status = "LIVE" if time_diff < timedelta(hours=1) else "HISTORICAL"
            print(f"[DATA-FETCH-EXT] ✅ Fetched {len(df)} candles for {symbol} ({status})")
        else:
            print(f"[DATA-FETCH-EXT] ✅ Fetched {len(df)} candles for {symbol}")
        
        return df
        
    except Exception as e:
        error_msg = str(e)
        print(f"[DATA-FETCH-EXT] ❌ Error fetching historical data:")
        print(f"   → Error Type: {type(e).__name__}")
        print(f"   → Error Message: {error_msg}")
        print(f"   → NO FALLBACK TO DUMMY DATA - LIVE DATA ONLY REQUIRED")
        
        # Specific error handling
        if "api_key" in error_msg.lower() or "access_token" in error_msg.lower():
            print(f"   → ⚠️ TOKEN/API KEY ISSUE DETECTED!")
            print(f"   → Check if token was saved correctly to .env")
        
        return pd.DataFrame()


# ═══════════════════════════════════════════════════════════════
# NEWS/EVENT DETECTION ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@router.get("/news-detection/{symbol}")
async def get_news_detection(symbol: str) -> Dict[str, Any]:
    """
    🚨 News/Event Detection Endpoint
    ═══════════════════════════════════
    Real-time news analysis with sentiment detection
    
    Performance: <100ms (cached) or <1s (API call)
    Rate Limit: 100 calls/day (NewsAPI free tier)
    """
    try:
        # Validate symbol
        valid_symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
        if symbol not in valid_symbols:
            raise HTTPException(status_code=400, detail=f"Invalid symbol. Use: {valid_symbols}")
        
        # Get API key and URL from environment
        api_key = settings.news_api_key
        base_url = settings.news_api_base_url
        page_size = settings.news_api_page_size
        lookback_hours = settings.news_api_lookback_hours
        rate_limit_cooldown = settings.news_api_rate_limit_cooldown
        http_timeout = float(settings.news_http_timeout)
        
        if not api_key:
            return {
                "symbol": symbol,
                "news_count": 0,
                "sentiment": "NEUTRAL",
                "impact_level": "LOW",
                "shock_detected": False,
                "top_headlines": [],
                "last_update": datetime.now().isoformat(),
                "status": "WAITING: News API key not configured"
            }
        
        # Analyze news
        result = await analyze_news(symbol, api_key, base_url, page_size,
                                   lookback_hours, rate_limit_cooldown, http_timeout)
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[NEWS] Error in news detection endpoint: {e}")
        raise HTTPException(status_code=500, detail=f"News detection error: {str(e)}")


@router.get("/news-detection/combined/all")
async def get_all_news_detection() -> Dict[str, Dict[str, Any]]:
    """
    🚨 Combined News Detection - All Indices
    ═══════════════════════════════════════════
    Parallel execution for maximum performance
    
    Performance: <2s for all 3 indices
    """
    try:
        api_key = settings.news_api_key
        base_url = settings.news_api_base_url
        page_size = settings.news_api_page_size
        lookback_hours = settings.news_api_lookback_hours
        rate_limit_cooldown = settings.news_api_rate_limit_cooldown
        http_timeout = float(settings.news_http_timeout)
        
        if not api_key:
            return {
                "NIFTY": {"status": "ERROR: News API key not configured", "symbol": "NIFTY"},
                "BANKNIFTY": {"status": "ERROR: News API key not configured", "symbol": "BANKNIFTY"},
                "SENSEX": {"status": "ERROR: News API key not configured", "symbol": "SENSEX"},
            }
        
        # Execute in parallel for ultra-fast response
        tasks = [
            analyze_news("NIFTY", api_key, base_url, page_size, lookback_hours, rate_limit_cooldown, http_timeout),
            analyze_news("BANKNIFTY", api_key, base_url, page_size, lookback_hours, rate_limit_cooldown, http_timeout),
            analyze_news("SENSEX", api_key, base_url, page_size, lookback_hours, rate_limit_cooldown, http_timeout),
        ]
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        return {
            "NIFTY": results[0] if not isinstance(results[0], Exception) else {"status": "ERROR", "symbol": "NIFTY"},
            "BANKNIFTY": results[1] if not isinstance(results[1], Exception) else {"status": "ERROR", "symbol": "BANKNIFTY"},
            "SENSEX": results[2] if not isinstance(results[2], Exception) else {"status": "ERROR", "symbol": "SENSEX"},
        }
        
    except Exception as e:
        print(f"[NEWS] Error in combined endpoint: {e}")
        raise HTTPException(status_code=500, detail=f"Combined news detection error: {str(e)}")


# ═══════════════════════════════════════════════════════════
# ZONE CONTROL & BREAKDOWN RISK ENDPOINTS
# ═══════════════════════════════════════════════════════════

def get_risk_emoji(risk: int) -> str:
    """Get emoji for breakdown risk level"""
    if risk >= 70:
        return "🔴 HIGH"
    elif risk >= 50:
        return "🟠 MEDIUM"
    else:
        return "🟢 LOW"

def get_bounce_emoji(prob: int) -> str:
    """Get emoji for bounce probability"""
    if prob >= 70:
        return "🟢 HIGH"
    elif prob >= 50:
        return "🟠 MEDIUM"
    else:
        return "🔴 LOW"

@router.get("/zone-control/{symbol}")
async def get_zone_control(symbol: str) -> Dict[str, Any]:
    """
    🎯 Zone Control & Breakdown Risk Analysis
    ═════════════════════════════════════════
    Uses GLOBAL token from .env automatically
    Shows cached data if token expired
    
    Returns:
        - Support/Resistance zones with strength scores
        - Breakdown risk percentage (0-100)
        - Bounce probability (0-100)
        - Nearest zones to current price
        - BUY_ZONE/SELL_ZONE/NEUTRAL signal
    
    Performance: <10ms with caching
    """
    try:
        symbol = symbol.upper()
        print(f"\n{'='*60}")
        print(f"[ZONE-CONTROL-API] 🎯 Request for {symbol}")
        print(f"{'='*60}")
        
        # ✅ GLOBAL TOKEN CHECK - One source of truth
        from services.global_token_manager import check_global_token_status
        token_status = await check_global_token_status()
        
        print(f"[GLOBAL-TOKEN] Status: {'✅ Valid' if token_status['valid'] else '❌ Expired'}")
        
        # Check cache first
        cache = get_cache()
        cache_key = f"zone_control:{symbol}"
        cached = await cache.get(cache_key)
        
        if cached:
            # Update cache with current token status
            cached["token_valid"] = token_status["valid"]
            print(f"[ZONE-CONTROL] ⚡ Cache hit for {symbol}")
            return cached
        
        # Fetch fresh historical data (extended range to get last available data)
        print(f"[ZONE-CONTROL] 🚀 Fetching LIVE data from Zerodha...")
        print(f"   → Symbol: {symbol}")
        print(f"   → Lookback: 100 candles")
        print(f"   → Time range: Last 15 days")
        
        df = await _get_historical_data_extended(symbol, lookback=100, days_back=15)
        
        print(f"[ZONE-CONTROL] 📊 Data fetch result:")
        print(f"   → Candles received: {len(df)}")
        print(f"   → Data empty: {df.empty}")
        
        if df.empty or len(df) < 20:
            print(f"[ZONE-CONTROL] ⚠️ INSUFFICIENT FRESH DATA for {symbol}")
            print(f"   → Got: {len(df)} candles from Zerodha")
            print(f"   → Checking for cached historical data...")
            
            # 🔥 PERMANENT FIX: Try to get last cached data instead of failing
            old_cache_key = f"zone_control_backup:{symbol}"
            backup_data = await cache.get(old_cache_key)
            
            if backup_data:
                print(f"[ZONE-CONTROL] ✅ Using CACHED data for {symbol}")
                print(f"   → Showing last successful analysis")
                print(f"   → Last updated: {backup_data.get('timestamp', 'Unknown')}")
                backup_data["status"] = "CACHED"
                backup_data["message"] = "📊 Last Market Session Data (Market Closed)"
                backup_data["data_status"] = "CACHED"
                return backup_data
            
            # No cached data - provide helpful error with clear fix
            print(f"[ZONE-CONTROL] ❌ NO DATA AVAILABLE (fresh or cached)")
            print(f"   → Token Status: {'VALID' if token_status['valid'] else 'EXPIRED'}")
            print(f"   → Solution: Click 🔑 LOGIN button in app")
            
            # 🚀 PRODUCTION: Return error instead of sample data
            # Force user to authenticate - no dummy data in production
            from services.market_feed import get_market_status
            current_market_status = get_market_status()
            
            return {
                "symbol": symbol,
                "current_price": 0,
                "zones": {
                    "support": [],
                    "resistance": []
                },
                "nearest_zones": {
                    "support": None,
                    "resistance": None
                },
                "risk_metrics": {
                    "breakdown_risk": 0,
                    "bounce_probability": 0,
                    "zone_strength": "UNKNOWN"
                },
                "breakdown_risk": 0,
                "bounce_probability": 0,
                "zone_strength": "UNKNOWN",
                "signal": "NEUTRAL",
                "confidence": 0,
                "recommendation": "🔑 Login to Zerodha to see live analysis" if not token_status["valid"] else "⏳ Waiting for market data",
                "status": current_market_status,
                "data_status": "NO_DATA",
                "timestamp": datetime.now().isoformat(),
                "message": "🔑 Login to Zerodha to see live analysis" if not token_status["valid"] else "⏳ Waiting for live market data",
                "candles_analyzed": 0,
                "token_valid": token_status["valid"]
            }
        
        # Show data info
        if not df.empty and 'date' in df.columns:
            print(f"[ZONE-CONTROL] 📅 Data time range:")
            print(f"   → First candle: {df['date'].iloc[0]}")
            print(f"   → Last candle: {df['date'].iloc[-1]}")
            print(f"   → Current price: ₹{df['close'].iloc[-1]:.2f}")
        
        # Analyze zone control with available data
        print(f"[ZONE-CONTROL] 🔬 Running zone analysis...")
        result = await analyze_zone_control(symbol, df)
        
        # Determine if data is live or historical based on last candle time
        from services.market_feed import get_market_status
        market_status = get_market_status()
        
        print(f"[ZONE-CONTROL] 📊 Market Status Check:")
        print(f"   → Market Status: {market_status}")
        
        last_candle_time = df['date'].iloc[-1] if 'date' in df.columns else None
        is_recent = False
        
        if last_candle_time:
            from datetime import timedelta
            # Ensure both datetimes are timezone-aware
            if last_candle_time.tzinfo is None:
                last_candle_time = last_candle_time.replace(tzinfo=timezone.utc)
            current_time = datetime.now(timezone.utc)
            time_diff = current_time - last_candle_time
            is_recent = time_diff < timedelta(hours=1)  # Within last hour = recent data
            print(f"   → Last candle time: {last_candle_time}")
            print(f"   → Time difference: {time_diff}")
            print(f"   → Is recent (< 1 hour): {is_recent}")
        
        # If market is LIVE or PRE_OPEN and data is recent, mark as LIVE
        if market_status in ['LIVE', 'PRE_OPEN', 'FREEZE'] and (is_recent or len(df) > 0):
            result["message"] = f"✅ LIVE market analysis ({len(df)} candles)"
            result["status"] = market_status  # Return actual market status (LIVE, PRE_OPEN, or FREEZE)
            print(f"[ZONE-CONTROL] ✅ Status: LIVE DATA (market {market_status})")
        elif is_recent:
            result["message"] = f"✅ Recent data from Zerodha ({len(df)} candles)"
            result["status"] = market_status
            print(f"[ZONE-CONTROL] ✅ Status: LIVE DATA (recent candles)")
        else:
            result["message"] = f"📊 Historical data ({len(df)} candles) - Market closed"
            result["status"] = "CLOSED"
            print(f"[ZONE-CONTROL] 📊 Status: HISTORICAL DATA (market closed)")
        
        result["candles_analyzed"] = len(df)
        
        # Cache result for 5 seconds (fast refresh)
        await cache.set(cache_key, result, expire=5)
        
        # 🔥 PERMANENT FIX: Save as 24-hour backup for when token expires
        backup_cache_key = f"zone_control_backup:{symbol}"
        await cache.set(backup_cache_key, result, expire=86400)
        
        # 📊 DETAILED INSTANT ANALYSIS RESULTS
        print(f"\n[ZONE-CONTROL] 🎯 INSTANT ANALYSIS RESULTS for {symbol}")
        print(f"{'='*80}")
        print(f"💰 CURRENT PRICE: ₹{result.get('current_price', 0):.2f}")
        print(f"🚦 SIGNAL: {result.get('signal', 'N/A')} (Confidence: {result.get('confidence', 0)}%)")
        print(f"📊 STATUS: {result.get('status', 'N/A')}")
        print(f"\n🛡️  SUPPORT ZONE:")
        support = result.get('nearest_zones', {}).get('support', {})
        if support.get('level'):
            print(f"   Level: ₹{support['level']:.2f}")
            print(f"   Distance: {abs(support.get('distance_pct', 0)):.2f}%")
            print(f"   Strength: {support.get('strength', 0):.0f}")
            print(f"   Touches: {support.get('touches', 0)}x")
        else:
            print(f"   No active support zone")
        print(f"\n⚠️  RESISTANCE ZONE:")
        resistance = result.get('nearest_zones', {}).get('resistance', {})
        if resistance.get('level'):
            print(f"   Level: ₹{resistance['level']:.2f}")
            print(f"   Distance: {abs(resistance.get('distance_pct', 0)):.2f}%")
            print(f"   Strength: {resistance.get('strength', 0):.0f}")
            print(f"   Touches: {resistance.get('touches', 0)}x")
        else:
            print(f"   No active resistance zone")
        print(f"\n📉 BREAKDOWN RISK: {result.get('breakdown_risk', 50)}% {get_risk_emoji(result.get('breakdown_risk', 50))}")
        print(f"📈 BOUNCE PROBABILITY: {result.get('bounce_probability', 50)}% {get_bounce_emoji(result.get('bounce_probability', 50))}")
        print(f"🎯 ZONE STRENGTH: {result.get('zone_strength', 'WEAK')}")
        print(f"\n💡 RECOMMENDATION: {result.get('recommendation', 'N/A')}")
        print(f"\n📦 CANDLES ANALYZED: {result.get('candles_analyzed', 0)}")
        print(f"💾 CACHED: 5s live + 24h backup")
        print(f"{'='*80}\n")
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ZONE-CONTROL-API] ❌ CRITICAL ERROR for {symbol}:")
        print(f"   → Error type: {type(e).__name__}")
        print(f"   → Error message: {str(e)}")
        import traceback
        print(f"   → Traceback:\n{traceback.format_exc()}")
        import traceback
        traceback.print_exc()
        return {
            "symbol": symbol,
            "current_price": 0.0,
            "zones": {
                "support": [],
                "resistance": []
            },
            "nearest_zones": {
                "support": {"level": None, "distance_pct": None, "strength": 0, "touches": 0},
                "resistance": {"level": None, "distance_pct": None, "strength": 0, "touches": 0}
            },
            "risk_metrics": {
                "breakdown_risk": 50,
                "bounce_probability": 50,
                "zone_strength": "WEAK"
            },
            "signal": "NEUTRAL",
            "confidence": 0,
            "recommendation": "Unable to fetch data - Check Zerodha connection or wait for market to open",
            "timestamp": datetime.now().isoformat(),
            "status": "ERROR",
            "message": f"⚠️ Error: {str(e)}. Will retry when data is available.",
            "candles_analyzed": 0
        }


# ═══════════════════════════════════════════════════════════
# CANDLE INTENT ENDPOINT (Professional Candle Structure)
# ═══════════════════════════════════════════════════════════

@router.get("/candle-intent/{symbol}")
async def get_candle_intent(symbol: str) -> Dict[str, Any]:
    """
    🔥 Candle Intent - Professional Candle Structure Analysis
    WHERE PROS MAKE MONEY - Candle is the final judge, not indicators
    
    Patterns Detected:
    - Long upper wick at resistance → SUPPLY ACTIVE (rejection)
    - Long lower wick at support → DEMAND DEFENDING (absorption)
    - Small body + high volume → ABSORPTION (institutional positioning)
    - Big body + low volume → EMOTIONAL MOVE (trap/false breakout)
    - Inside candle near zone → BREAKOUT SETUP (consolidation)
    
    Data Source: 100% from Zerodha WebSocket (OHLCV)
    Performance: <10ms with caching
    """
    try:
        symbol = symbol.upper()
        print(f"\n{'='*60}")
        print(f"[CANDLE-INTENT-API] 🕯️  Request for {symbol}")
        print(f"{'='*60}")
        
        # ✅ GLOBAL TOKEN CHECK
        from services.global_token_manager import check_global_token_status
        token_status = await check_global_token_status()
        print(f"[GLOBAL-TOKEN] Status: {'✅ Valid' if token_status['valid'] else '❌ Expired'}")
        
        # Check cache with smart timing (no cache during live trading hours)
        from datetime import datetime
        from pytz import timezone
        cache = get_cache()
        cache_key = f"candle_intent:{symbol}"
        
        # Trading hours detection (9:15 AM - 3:30 PM IST)
        ist = timezone('Asia/Kolkata')
        current_time = datetime.now(ist).time()
        is_trading = datetime.now(ist).weekday() < 5 and (datetime.strptime("09:15", "%H:%M").time() <= current_time <= datetime.strptime("15:30", "%H:%M").time())
        
        # During trading hours: no cache for live analysis
        # Outside trading hours: 60s cache for efficiency
        if is_trading:
            print(f"[CANDLE-INTENT] 🔥 Trading hours (9:15-3:30) - NO CACHE for live updates")
        else:
            cached = await cache.get(cache_key)
            if cached:
                cached["token_valid"] = token_status["valid"]
                print(f"[CANDLE-INTENT] ⚡ Cache hit for {symbol} (60s cache outside trading hours)")
                return cached
        
        # ── Priority 1: live WebSocket candle cache (always fresh, no Zerodha token needed) ──
        df = pd.DataFrame()
        try:
            import json as _json
            _cc = get_cache()
            _candle_key = f"analysis_candles:{symbol}"
            _candles_raw = await _cc.lrange(_candle_key, 0, 99)  # newest-first list
            if _candles_raw and len(_candles_raw) >= 3:
                _rows = []
                for _c in reversed(_candles_raw):   # reverse → chronological order
                    try:
                        _rows.append(_json.loads(_c))
                    except Exception:
                        continue
                if len(_rows) >= 3:
                    df = pd.DataFrame(_rows)
                    for _col in ('open', 'high', 'low', 'close'):
                        if _col not in df.columns:
                            df[_col] = 0.0
                        df[_col] = pd.to_numeric(df[_col], errors='coerce').fillna(0.0)
                    if 'volume' not in df.columns:
                        df['volume'] = 0
                    df['volume'] = pd.to_numeric(df['volume'], errors='coerce').fillna(0).astype(int)
                    print(f"[CANDLE-INTENT] ✅ Using live candle cache: {len(df)} candles")
        except Exception as _ce:
            print(f"[CANDLE-INTENT] ⚠️ Candle cache read failed: {_ce}")

        # ── Priority 2: Zerodha REST API (fallback when candle cache insufficient) ──
        if df.empty:
            print(f"[CANDLE-INTENT] 🚀 Fetching LIVE candles from Zerodha...")
            df = await _get_historical_data(symbol, lookback=100)
        
        print(f"[CANDLE-INTENT] 📊 Data fetch result:")
        print(f"   → Candles received: {len(df)}")
        print(f"   → Data empty: {df.empty}")
        
        # 🔥 SHOW LAST 3 CANDLES WITH VOLUME FOR DEBUGGING
        if not df.empty and len(df) >= 3:
            print(f"\n[CANDLE-INTENT] 🕯️  INSTANT CANDLE DETAILS (Last 3 Candles):")
            print(f"{'='*80}")
            for i, candle in df.tail(3).iterrows():
                o, h, l, c = candle['open'], candle['high'], candle['low'], candle['close']
                v = candle.get('volume', 0)
                
                # Candle color
                candle_type = "🟢 GREEN" if c > o else "🔴 RED" if c < o else "⚪ DOJI"
                
                # Wicks
                body = abs(c - o)
                total_range = h - l if h != l else 0.01
                upper_wick = h - max(o, c)
                lower_wick = min(o, c) - l
                
                print(f"  Candle #{i} @ {candle.get('date', 'N/A')}")
                print(f"  {candle_type}")
                print(f"  📊 OHLC: O={o:.2f} H={h:.2f} L={l:.2f} C={c:.2f}")
                print(f"  📦 Volume: {v:,.0f}")
                print(f"  📏 Body: {body:.2f} ({(body/total_range*100):.1f}% of range)")
                print(f"  ⬆️  Upper Wick: {upper_wick:.2f}")
                print(f"  ⬇️  Lower Wick: {lower_wick:.2f}")
                print()
            print(f"{'='*80}\n")
        
        if df.empty or len(df) < 3:
            print(f"[CANDLE-INTENT] ⚠️  INSUFFICIENT DATA for {symbol}")
            
            # Try backup cache
            backup_cache_key = f"candle_intent_backup:{symbol}"
            backup_data = await cache.get(backup_cache_key)
            
            if backup_data:
                print(f"[CANDLE-INTENT] ✅ Using CACHED data for {symbol}")
                print(f"   → Showing last successful analysis")
                print(f"   → Last updated: {backup_data.get('timestamp', 'Unknown')}")
                backup_data["status"] = "CACHED"
                backup_data["message"] = "📊 Last Market Session Data (Market Closed)"
                backup_data["data_status"] = "CACHED"
                backup_data["token_valid"] = token_status["valid"]
                return backup_data
            
            # Return error response
            # Return error instead of sample data
            from services.market_feed import is_market_open
            status = "MARKET_CLOSED" if not is_market_open() else "NO_DATA"
            message = "🔴 Market is currently closed. Data will update when market opens (9:15 AM IST)" if not is_market_open() else "🔴 Waiting for live market data. Please ensure Zerodha connection is active."
            
            return {
                "symbol": symbol,
                "timestamp": datetime.now().isoformat(),
                "current_candle": None,
                "pattern": None,
                "professional_signal": "NEUTRAL",
                "volume_analysis": None,
                "trap_status": None,
                "status": status,
                "data_status": status,
                "message": message,
                "candles_analyzed": 0,
                "token_valid": token_status["valid"],
                "error": "NO_MARKET_DATA",
                "notes": "Production system: No sample data used. Waiting for live market data."
            }
        
        # Show data time range
        if not df.empty and 'date' in df.columns:
            first_date = df.iloc[0]['date']
            last_date = df.iloc[-1]['date']
            print(f"[CANDLE-INTENT] 📅 Data time range:")
            print(f"   → First candle: {first_date}")
            print(f"   → Last candle: {last_date}")
            print(f"   → Total candles: {len(df)}")
        
        # 📊 ANALYZE CANDLE INTENT WITH REAL DATA (with live tick injection)
        print(f"[CANDLE-INTENT] 🔬 Running candle structure analysis...")
        result = await analyze_candle_intent(symbol, df, inject_live_tick=True)
        
        # Add metadata — use real market status so frontend status badge is accurate
        from services.market_feed import get_market_status
        result["status"] = get_market_status()
        result["token_valid"] = token_status["valid"]
        result["data_source"] = "LIVE_CANDLE_CACHE"
        result["candles_analyzed"] = len(df)
        
        # Smart cache strategy (same as other live components)
        if is_trading:
            # During trading: NO cache for real-time pattern changes
            print(f"[CANDLE-INTENT] 🚀 Trading hours - Fresh analysis, no cache")
        else:
            # Outside trading: 60s cache for efficiency
            await cache.set(cache_key, result, expire=60)
            print(f"[CANDLE-INTENT] 💾 Non-trading hours - Cached for 60s")
        
        # Save 24-hour backup
        backup_cache_key = f"candle_intent_backup:{symbol}"
        await cache.set(backup_cache_key, result, expire=86400)
        
        # 🔥 DETAILED OUTPUT FOR MONITORING
        print(f"\n[CANDLE-INTENT] 📈 INSTANT ANALYSIS RESULTS for {symbol}")
        print(f"{'='*80}")
        print(f"🚦 SIGNAL: {result['professional_signal']} (Confidence: {result['pattern']['confidence']}%)")
        print(f"💯 PATTERN: {result['pattern']['type']}")
        print(f"📊 INTENT: {result['pattern']['intent']}")
        print(f"📋 STATUS: {result['status']}")
        
        if result.get('trap_status', {}).get('is_trap'):
            trap = result['trap_status']
            print(f"⚠️  TRAP DETECTED: {trap.get('trap_type', 'UNKNOWN')}")
            print(f"   Severity: {trap.get('severity', 0)}%")
            print(f"   Action: {trap.get('action_required', 'MONITOR')}")
        
        print(f"\n📦 VOLUME ANALYSIS:")
        vol_analysis = result.get('volume_analysis', {})
        print(f"   Volume: {vol_analysis.get('volume', 0):,.0f}")
        print(f"   Avg Volume: {vol_analysis.get('avg_volume', 0):,.0f}")
        print(f"   Ratio: {vol_analysis.get('volume_ratio', 0):.2f}x")
        print(f"   Type: {vol_analysis.get('volume_type', 'UNKNOWN')}")
        print(f"   Efficiency: {vol_analysis.get('efficiency', 'UNKNOWN')}")
        
        print(f"\n📦 CANDLES ANALYZED: {len(df)}")
        print(f"💾 CACHED: 5s live + 24h backup")
        print(f"{'='*80}\n")
        
        print(f"[CANDLE-INTENT] ✅ Analysis complete for {symbol}")
        print(f"   → Pattern: {result['pattern']['type']}")
        print(f"   → Intent: {result['pattern']['intent']}")
        print(f"   → Signal: {result['professional_signal']}")
        print(f"   → Confidence: {result['pattern']['confidence']}%")
        print(f"   → Cached: 5s live + 24h backup")
        print(f"{'='*60}\n")
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[CANDLE-INTENT-API] ❌ CRITICAL ERROR for {symbol}:")
        print(f"   → Error type: {type(e).__name__}")
        print(f"   → Error message: {str(e)}")
        import traceback
        print(f"   → Traceback:\n{traceback.format_exc()}")
        return {
            "symbol": symbol,
            "timestamp": datetime.now().isoformat(),
            "current_candle": {
                "open": 0, "high": 0, "low": 0, "close": 0,
                "volume": 0, "range": 0, "body_size": 0,
                "upper_wick": 0, "lower_wick": 0
            },
            "pattern": {
                "type": "NEUTRAL",
                "strength": 0,
                "intent": "NEUTRAL",
                "interpretation": f"Error: {str(e)}",
                "confidence": 0
            },
            "wick_analysis": {},
            "body_analysis": {},
            "volume_analysis": {},
            "near_zone": False,
            "professional_signal": "WAIT",
            "status": "ERROR",
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }


@router.get("/zone-control/all")
async def get_all_zone_control() -> Dict[str, Any]:
    """
    🎯 Zone Control for All Indices
    ═══════════════════════════════════
    Parallel execution for maximum performance
    """
    try:
        symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
        
        # Parallel execution
        tasks = [get_zone_control(symbol) for symbol in symbols]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        response = {}
        for symbol, result in zip(symbols, results):
            if isinstance(result, Exception):
                print(f"[ZONE-CONTROL-ALL] Error for {symbol}: {result}")
                response[symbol] = {"error": str(result)}
            else:
                response[symbol] = result
        
        return {
            "data": response,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        print(f"[ZONE-CONTROL-ALL] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

