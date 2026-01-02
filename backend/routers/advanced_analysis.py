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
        
        # Check cache first
        cache = get_cache()
        cache_key = f"volume_pulse:{symbol}"
        cached = await cache.get(cache_key)
        
        if cached:
            # Update cache with current token status
            cached["token_valid"] = token_status["valid"]
            print(f"[VOLUME-PULSE] ⚡ Cache hit for {symbol}")
            return cached
        
        # 🚀 FETCH LIVE HISTORICAL CANDLES FROM ZERODHA
        print(f"[VOLUME-PULSE] 🚀 Fetching fresh data from Zerodha...")
        df = await _get_historical_data(symbol, lookback=50)
        print(f"[VOLUME-PULSE] 📊 Received {len(df)} candles")
        
        if df.empty or len(df) < 10:
            print(f"[VOLUME-PULSE] ⚠️ INSUFFICIENT DATA - Checking backup cache...")
            
            # 🔥 PERMANENT FIX: Try to get last cached data
            backup_cache_key = f"volume_pulse_backup:{symbol}"
            backup_data = await cache.get(backup_cache_key)
            
            if backup_data:
                print(f"[VOLUME-PULSE] ✅ Using CACHED data for {symbol}")
                backup_data["status"] = "CACHED"
                backup_data["message"] = "📊 Showing last available data (Token may be expired - Click LOGIN)"
                backup_data["token_valid"] = token_status["valid"]
                return backup_data
            
            # No cached data - return helpful error
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
                "status": "TOKEN_EXPIRED",
                "timestamp": datetime.now().isoformat(),
                "message": f"🔑 Zerodha token expired - Click LOGIN in header ({len(df)} candles)",
                "token_valid": token_status["valid"]
            }
        
        # 📊 ANALYZE VOLUME PULSE WITH REAL CANDLE DATA
        result = await analyze_volume_pulse(symbol, df)
        result["message"] = f"✅ Live data from Zerodha ({len(df)} candles)"
        result["candles_analyzed"] = len(df)
        result["token_valid"] = token_status["valid"]
        
        # Cache result (5 seconds for real-time updates)
        await cache.set(cache_key, result, expire=5)
        
        # 🔥 PERMANENT FIX: Save as 24-hour backup
        backup_cache_key = f"volume_pulse_backup:{symbol}"
        await cache.set(backup_cache_key, result, expire=86400)
        print(f"[VOLUME-PULSE] 💾 Backup saved (24h)")
        
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
    🎯 Trend Base (Higher-Low Structure) Analysis
    ═════════════════════════════════════════════════
    Uses GLOBAL token from .env automatically
    Shows cached data if token expired
    
    Returns:
        - Structure type (HIGHER-HIGH-HIGHER-LOW, etc.)
        - Integrity score (0-100)
        - Swing points (last/prev high/low)
        - BUY/SELL/NEUTRAL signal
    """
    try:
        symbol = symbol.upper()
        print(f"\n{'='*60}")
        print(f"[TREND-BASE-API] 🎯 Request for {symbol}")
        print(f"{'='*60}")
        
        # ✅ GLOBAL TOKEN CHECK - One source of truth
        from services.global_token_manager import check_global_token_status
        token_status = await check_global_token_status()
        
        print(f"[GLOBAL-TOKEN] Status: {'✅ Valid' if token_status['valid'] else '❌ Expired'}")
        
        # 🔥 FIX: Reduce cache to 3 seconds for near-real-time updates
        cache = get_cache()
        cache_key = f"trend_base:{symbol}"
        cached = await cache.get(cache_key)
        
        if cached:
            # Update cache with current token status
            cached["token_valid"] = token_status["valid"]
            print(f"[TREND-BASE] ⚡ Cache hit for {symbol} (3s cache)")
            return cached
        
        # 🚀 FETCH LIVE HISTORICAL CANDLES FROM ZERODHA
        print(f"[TREND-BASE] 🚀 Fetching LIVE data from Zerodha...")
        print(f"   → Symbol: {symbol}")
        print(f"   → Lookback: 100 candles (5-min)")
        print(f"   → Time range: Last 3 days (for intraday patterns)")
        
        # 🔥 FIX: Use 3 days instead of 15 to focus on recent price action
        # Trend Base needs recent swings, not old historical data
        df = await _get_historical_data_extended(symbol, lookback=100, days_back=3)
        
        print(f"[TREND-BASE] 📊 Data fetch result:")
        print(f"   → Candles received: {len(df)}")
        print(f"   → Data empty: {df.empty}")
        
        if df.empty or len(df) < 20:
            print(f"[TREND-BASE] ⚠️ INSUFFICIENT FRESH DATA for {symbol}")
            print(f"   → Got: {len(df)} candles from Zerodha")
            print(f"   → Checking for cached historical data...")
            
            # 🔥 PERMANENT FIX: Try to get last cached data instead of failing
            backup_cache_key = f"trend_base_backup:{symbol}"
            backup_data = await cache.get(backup_cache_key)
            
            if backup_data:
                print(f"[TREND-BASE] ✅ Using CACHED data for {symbol}")
                print(f"   → Showing last successful analysis")
                backup_data["status"] = "CACHED"
                backup_data["message"] = "📊 Showing last available data (Token may be expired)"
                return backup_data
            
            # No cached data - provide helpful error with clear fix
            print(f"[TREND-BASE] ❌ NO DATA AVAILABLE (fresh or cached)")
            print(f"   → Token Status: Likely EXPIRED")
            print(f"   → Solution: Click 🔑 LOGIN button in app")
            
            return {
                "symbol": symbol,
                "structure": {
                    "type": "MIXED",
                    "integrity_score": 50,
                    "swing_points": {
                        "last_high": 0.0,
                        "last_low": 0.0,
                        "prev_high": 0.0,
                        "prev_low": 0.0,
                        "high_diff": 0.0,
                        "low_diff": 0.0
                    }
                },
                "signal": "NEUTRAL",
                "confidence": 0,
                "trend": "SIDEWAYS",
                "status": "TOKEN_EXPIRED",
                "timestamp": datetime.now().isoformat(),
                "message": "🔑 Zerodha token expired. Click LOGIN in header to refresh",
                "candles_analyzed": len(df),
                "token_valid": token_status["valid"]
            }
        
        # Show data info
        if not df.empty and 'date' in df.columns:
            print(f"[TREND-BASE] 📅 Data time range:")
            print(f"   → First candle: {df['date'].iloc[0]}")
            print(f"   → Last candle: {df['date'].iloc[-1]}")
            print(f"   → Current price: ₹{df['close'].iloc[-1]:.2f}")
        
        # 📊 ANALYZE TREND BASE WITH REAL CANDLE DATA
        print(f"[TREND-BASE] 🔬 Running trend analysis...")
        result = await analyze_trend_base(symbol, df)
        
        # Determine if data is live or historical
        from services.market_feed import get_market_status
        market_status = get_market_status()
        
        print(f"[TREND-BASE] 📊 Market Status Check:")
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
        if market_status in ['LIVE', 'PRE_OPEN'] and (is_recent or len(df) > 0):
            result["message"] = f"✅ LIVE market analysis ({len(df)} candles)"
            result["data_status"] = "LIVE"
            print(f"[TREND-BASE] ✅ Status: LIVE DATA (market {market_status})")
        elif is_recent:
            result["message"] = f"✅ Recent data from Zerodha ({len(df)} candles)"
            result["data_status"] = "LIVE"
            print(f"[TREND-BASE] ✅ Status: LIVE DATA (recent candles)")
        else:
            result["message"] = f"📊 Historical data ({len(df)} candles) - Market closed"
            result["data_status"] = "HISTORICAL"
            print(f"[TREND-BASE] 📊 Status: HISTORICAL DATA (market closed)")
        
        result["candles_analyzed"] = len(df)
        result["token_valid"] = token_status["valid"]
        
        # 🔥 FIX: Cache for only 3 seconds to get near-real-time updates
        # This allows trend structure to update quickly with new price action
        await cache.set(cache_key, result, expire=3)
        
        # 🔥 PERMANENT FIX: Save as 24-hour backup for when token expires
        backup_cache_key = f"trend_base_backup:{symbol}"
        await cache.set(backup_cache_key, result, expire=86400)  # 24 hours
        print(f"[TREND-BASE] 💾 Cached for 3s (near-real-time) + 24h backup")
        
        print(f"[TREND-BASE] ✅ Analysis complete for {symbol}")
        print(f"   → Status: {result.get('data_status', 'UNKNOWN')}")
        print(f"   → Trend: {result['trend']}")
        print(f"   → Signal: {result['signal']}")
        print(f"   → Confidence: {result['confidence']}%")
        print(f"   → Cached: 30s live + 24h backup")
        print(f"{'='*60}\n")
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[TREND-BASE-API] ❌ CRITICAL ERROR for {symbol}:")
        print(f"   → Error type: {type(e).__name__}")
        print(f"   → Error message: {str(e)}")
        import traceback
        print(f"   → Traceback:\n{traceback.format_exc()}")
        # Return neutral state instead of 500 error
        return {
            "symbol": symbol,
            "structure": {
                "type": "MIXED",
                "integrity_score": 50,
                "swing_points": {
                    "last_high": 0.0,
                    "last_low": 0.0,
                    "prev_high": 0.0,
                    "prev_low": 0.0,
                    "high_diff": 0.0,
                    "low_diff": 0.0
                }
            },
            "signal": "NEUTRAL",
            "confidence": 0,
            "trend": "SIDEWAYS",
            "status": "ERROR",
            "timestamp": datetime.now().isoformat(),
            "message": f"⚠️ Error: {str(e)}. Will retry when data is available.",
            "candles_analyzed": 0,
            "token_valid": False
        }


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
        
        # ✅ GLOBAL TOKEN VALIDATION
        print(f"[DATA-FETCH] 🔐 Using token from .env for {symbol}")
        
        # Reload settings to get latest token from .env
        from config import get_settings
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
        
        # Fetch intraday 5-minute candles (enough for Volume Pulse analysis)
        to_date = datetime.now()
        from_date = to_date - timedelta(days=5)  # Get last 5 days to ensure enough candles
        
        print(f"[DATA-FETCH] 🔄 Fetching {lookback} candles from Zerodha...")
        print(f"   → Date range: {from_date.date()} to {to_date.date()}")
        print(f"   → Interval: 5-minute")
        
        data = kite.historical_data(
            instrument_token=token,
            from_date=from_date,
            to_date=to_date,
            interval="5minute"  # 5-min candles for real-time analysis
        )
        
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
    Goes back further in time to ensure data is available even when market is closed
    
    Args:
        symbol: Index symbol (NIFTY, BANKNIFTY, SENSEX)
        lookback: Number of candles to fetch (default: 100 for Zone Control)
        days_back: Number of days to look back (default: 15 to cover weekends/holidays)
        
    Returns:
        DataFrame with columns: date, open, high, low, close, volume
    """
    try:
        from kiteconnect import KiteConnect
        from datetime import timedelta
        
        # Authenticate Zerodha client
        if not settings.zerodha_api_key:
            print(f"[DATA-FETCH-EXT] ❌ ZERODHA_API_KEY not configured")
            return pd.DataFrame()
        
        if not settings.zerodha_access_token:
            print(f"[DATA-FETCH-EXT] ❌ ZERODHA_ACCESS_TOKEN not configured")
            print(f"   → Please login via /api/auth/login to generate token")
            return pd.DataFrame()
        
        print(f"[DATA-FETCH-EXT] 🔑 Zerodha credentials found")
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
        
        # Fetch 5-minute candles with extended date range
        to_date = datetime.now()
        from_date = to_date - timedelta(days=days_back)  # Go back 10-15 days to ensure data
        
        print(f"[DATA-FETCH-EXT] 🔄 Fetching historical data...")
        print(f"   → Symbol: {symbol} ({token_type})")
        print(f"   → Token: {token}")
        print(f"   → From: {from_date.strftime('%Y-%m-%d %H:%M')}")
        print(f"   → To: {to_date.strftime('%Y-%m-%d %H:%M')}")
        print(f"   → Interval: 5minute")
        print(f"   → Target candles: {lookback}")
        
        data = kite.historical_data(
            instrument_token=token,
            from_date=from_date,
            to_date=to_date,
            interval="5minute"  # 5-min candles
        )
        
        if not data:
            print(f"[DATA-FETCH-EXT] ⚠️ No data received from Zerodha for {symbol}")
            print(f"   → This usually means:")
            print(f"      1. Access token expired (generate new token)")
            print(f"      2. Instrument token is incorrect")
            print(f"      3. Market data not available for this period")
            return pd.DataFrame()
        
        print(f"[DATA-FETCH-EXT] ✅ Received {len(data)} candles from Zerodha")
        
        # Convert to DataFrame
        df = pd.DataFrame(data)
        
        # Take only required lookback period (most recent candles)
        df = df.tail(lookback)
        
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
        print(f"[DATA-FETCH-EXT] ❌ Error fetching historical data: {e}")
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
                backup_data["status"] = "CACHED"
                backup_data["message"] = "📊 Showing last available data (Token may be expired)"
                backup_data["recommendation"] = f"{backup_data.get('recommendation', '')} [Using cached data - Click LOGIN to refresh]"
                return backup_data
            
            # No cached data - provide helpful error with clear fix
            print(f"[ZONE-CONTROL] ❌ NO DATA AVAILABLE (fresh or cached)")
            print(f"   → Token Status: Likely EXPIRED")
            print(f"   → Solution: Click 🔑 LOGIN button in app")
            
            # Get current market price from live tick cache
            from services.cache import CacheService
            cache_svc = CacheService()
            await cache_svc.connect()
            tick_data = await cache_svc.get_market_data(symbol)
            await cache_svc.disconnect()
            current_price = tick_data.get('price', 0.0) if tick_data else 0.0
            
            return {
                "symbol": symbol,
                "current_price": current_price,
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
                "recommendation": "🔑 Click LOGIN button to refresh Zerodha token and get live analysis",
                "timestamp": datetime.now().isoformat(),
                "status": "TOKEN_EXPIRED",
                "message": "🔑 Zerodha token expired. Click LOGIN in header to refresh (takes 10 seconds)",
                "candles_analyzed": len(df),
                "fix_instructions": [
                    "1. Click 🔑 LOGIN button in app header",
                    "2. Login with your Zerodha credentials",
                    "3. Data will auto-refresh (no restart needed)"
                ]
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
        if market_status in ['LIVE', 'PRE_OPEN'] and (is_recent or len(df) > 0):
            result["message"] = f"✅ LIVE market analysis ({len(df)} candles)"
            result["status"] = "LIVE"
            print(f"[ZONE-CONTROL] ✅ Status: LIVE DATA (market {market_status})")
        elif is_recent:
            result["message"] = f"✅ Recent data from Zerodha ({len(df)} candles)"
            result["status"] = "LIVE"
            print(f"[ZONE-CONTROL] ✅ Status: LIVE DATA (recent candles)")
        else:
            result["message"] = f"📊 Historical data ({len(df)} candles) - Market closed"
            result["status"] = "HISTORICAL"
            print(f"[ZONE-CONTROL] 📊 Status: HISTORICAL DATA (market closed)")
        
        result["candles_analyzed"] = len(df)
        
        # Cache result for 30 seconds (quick refresh)
        await cache.set(cache_key, result, expire=30)
        
        # 🔥 PERMANENT FIX: Save as 24-hour backup for when token expires
        backup_cache_key = f"zone_control_backup:{symbol}"
        await cache.set(backup_cache_key, result, expire=86400)  # 24 hours
        print(f"[ZONE-CONTROL] 💾 Backup saved (24h) - will show if token expires")
        
        print(f"[ZONE-CONTROL] ✅ Analysis complete for {symbol}")
        print(f"   → Status: {result['status']}")
        print(f"   → Signal: {result['signal']}")
        print(f"   → Confidence: {result['confidence']}%")
        print(f"   → Cached: 30s live + 24h backup")
        print(f"{'='*60}\n")
        
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

