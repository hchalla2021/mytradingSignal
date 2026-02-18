"""
Analysis Router - DIRECT Zerodha API Analysis
PERMANENT SOLUTION - Works independently without WebSocket
Direct REST API access to Zerodha

🔥 IMPROVED: Smart caching (no cache during 9:15-3:30 IST trading hours)
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict
import asyncio
from datetime import datetime
from pytz import timezone

from services.zerodha_direct_analysis import get_zerodha_analysis
from services.instant_analysis import get_instant_analysis, get_all_instant_analysis
from services.cache import get_redis, get_cache
from services.websocket_manager import manager
from services.oi_momentum_service import oi_momentum_service
from config import get_settings

settings = get_settings()

router = APIRouter(prefix="/api/analysis", tags=["analysis"])
settings = get_settings()

# Symbol mapping from settings
SYMBOL_MAPPING = {
    "NIFTY": {"token": settings.nifty_token, "name": "NIFTY 50"},
    "BANKNIFTY": {"token": settings.banknifty_token, "name": "NIFTY BANK"},
    "SENSEX": {"token": settings.sensex_token, "name": "BSE SENSEX"},
}


@router.get("/analyze/all")
async def analyze_all_symbols():
    """
    Analysis for all symbols - USES LIVE WEBSOCKET DATA
    Prioritizes cache-based instant analysis (from WebSocket feed)
    Falls back to Direct API if cache unavailable
    """
    try:
        # PRIORITY: Use cache-based instant analysis (from WebSocket feed)
        cache = await get_redis()
        results = await get_all_instant_analysis(cache)
        
        # Add symbol names
        for symbol in results:
            if symbol in SYMBOL_MAPPING:
                results[symbol]['symbol_name'] = SYMBOL_MAPPING[symbol]['name']
        
        # Check if we got valid data
        has_valid_data = any(
            result.get('indicators', {}).get('price', 0) > 0 
            for result in results.values()
        )
        
        if has_valid_data:
            print(f"\n{'='*60}")
            print(f"✅ INSTANT Analysis using LIVE WebSocket data")
            print(f"📊 Results summary:")
            for symbol, data in results.items():
                price = data.get('indicators', {}).get('price', 0)
                signal = data.get('signal', 'WAIT')
                confidence = data.get('confidence', 0)
                print(f"   {symbol}: Price=₹{price:,.2f}, Signal={signal}, Confidence={confidence:.0%}")
            print(f"{'='*60}\n")
            return results
        
        # If cache has no data, try Direct API
        print(f"⚠️ Cache has no data, trying Direct Zerodha API...")
        zerodha = get_zerodha_analysis()
        results = zerodha.analyze_all()
        
        print(f"\n{'='*60}")
        print(f"✅ Direct Zerodha API analysis completed")
        print(f"📊 Results summary:")
        for symbol, data in results.items():
            print(f"   {symbol}: Signal={data.get('signal')}, Confidence={data.get('confidence')}, Price={data.get('indicators', {}).get('price')}")
        print(f"{'='*60}\n")
        
        return results
        
    except Exception as e:
        print(f"❌ Analysis failed: {e}")
        import traceback
        traceback.print_exc()
        return {}


@router.get("/analyze/{symbol}")
async def analyze_symbol(symbol: str):
    """
    Analysis for single symbol - USES LIVE WEBSOCKET DATA
    Prioritizes cache-based instant analysis (from WebSocket feed)
    
    🔥 IMPROVEMENT: Smart caching during trading hours
    - 9:15-3:30 IST (Mon-Fri): NO CACHE - fresh analysis every 5s request
    - Outside hours: 60s cache for efficiency
    """
    symbol = symbol.upper()
    
    try:
        # Trading hours detection (9:15 AM - 3:30 PM IST, Mon-Fri)
        ist = timezone('Asia/Kolkata')
        current_time = datetime.now(ist)
        is_weekday = current_time.weekday() < 5  # Mon=0, Fri=4
        current_hm = current_time.time()
        trading_start = datetime.strptime("09:15", "%H:%M").time()
        trading_end = datetime.strptime("15:30", "%H:%M").time()
        is_trading = is_weekday and (trading_start <= current_hm <= trading_end)
        
        # Smart caching strategy
        cache = await get_redis()
        cache_svc = get_cache()
        cache_key = f"analysis:orb:{symbol}"
        
        # During trading hours: NO CACHE for live analysis
        # Outside trading hours: 60s cache for efficiency
        if is_trading:
            print(f"[ANALYSIS-ORB] 🔥 Trading hours (9:15-3:30) - NO CACHE for live updates")
        else:
            cached_result = await cache_svc.get(cache_key)
            if cached_result:
                print(f"[ANALYSIS-ORB] ⚡ Cache hit for {symbol} (60s cache outside trading hours)")
                if symbol in SYMBOL_MAPPING:
                    cached_result['symbol_name'] = SYMBOL_MAPPING[symbol]['name']
                return cached_result
        
        # PRIORITY: Use cache-based instant analysis
        result = await get_instant_analysis(cache, symbol)
        
        if symbol in SYMBOL_MAPPING:
            result['symbol_name'] = SYMBOL_MAPPING[symbol]['name']
        
        # Check if we got valid data
        price = result.get('indicators', {}).get('price', 0)
        
        if price > 0:
            print(f"✅ INSTANT Analysis for {symbol}: Price=₹{price:,.2f}, Signal={result.get('signal')}")
            
            # Smart cache strategy
            if not is_trading:
                await cache_svc.set(cache_key, result, expire=60)
                print(f"[ANALYSIS-ORB] 💾 Non-trading hours - Cached for 60s")
            
            return result
        
        # If cache has no data, try Direct API
        print(f"⚠️ No cache data for {symbol}, trying Direct API...")
        zerodha = get_zerodha_analysis()
        result = zerodha.analyze_symbol(symbol)
        
        return result
        
    except Exception as e:
        print(f"❌ Analysis error for {symbol}: {e}")
        return {
            "signal": "ERROR",
            "confidence": 0.0,
            "error": str(e),
            "symbol": symbol
        }


@router.get("/health")
async def analysis_health():
    """Check analysis service health and Zerodha API connection"""
    try:
        zerodha = get_zerodha_analysis()
        
        # Test connection with NIFTY quote
        test_quote = zerodha.get_live_quote("NIFTY")
        
        if test_quote:
            return {
                "status": "healthy",
                "zerodha_api": "connected",
                "access_token": "configured",
                "last_test": test_quote.get('timestamp'),
                "test_symbol": "NIFTY",
                "test_price": test_quote.get('price'),
            }
        else:
            return {
                "status": "degraded",
                "zerodha_api": "disconnected",
                "access_token": "missing or invalid",
                "message": "Using fallback mode",
            }
            
    except Exception as e:
        return {
            "status": "error",
            "zerodha_api": "error",
            "error": str(e),
        }


# Cache for OI Momentum (avoid excessive API calls)
_oi_momentum_cache = {}
_OI_CACHE_TTL = 60  # 1 minute cache

@router.get("/oi-momentum/all")
async def get_oi_momentum_all():
    """
    Get OI Momentum signals for all symbols (NIFTY, BANKNIFTY, SENSEX)
    Uses CACHED CANDLES from WebSocket feed - NO API CALLS!
    Pure data-driven buy/sell signals based on Liquidity Grab, Volume, OI, Price Structure
    """
    global _oi_momentum_cache
    
    # Check cache
    now = datetime.now()
    if 'data' in _oi_momentum_cache:
        cache_age = (now - _oi_momentum_cache['timestamp']).total_seconds()
        if cache_age < _OI_CACHE_TTL:
            return _oi_momentum_cache['data']
    
    try:
        cache = await get_redis()
        results = {}
        
        import pandas as pd
        import json
        
        for symbol in ["NIFTY", "BANKNIFTY", "SENSEX"]:
            try:
                # Get cached candles from WebSocket feed (NO API calls!)
                candle_key = f"analysis_candles:{symbol}"
                candles_json = await cache.lrange(candle_key, 0, 199)
                
                if not candles_json or len(candles_json) < 20:
                    results[symbol] = {
                        "signal_5m": "NO_SIGNAL",
                        "signal_15m": "NO_SIGNAL",
                        "final_signal": "NO_SIGNAL",
                        "confidence": 0,
                        "reasons": ["Waiting for live market data - accumulating candles for analysis"],
                        "metrics": {},
                        "symbol_name": SYMBOL_MAPPING[symbol]["name"]
                    }
                    continue
                
                # Parse cached candles (newest first)
                candles = []
                for candle_json in reversed(candles_json):
                    try:
                        candles.append(json.loads(candle_json))
                    except:
                        continue
                
                # Build 5-minute DataFrame
                df_5m = pd.DataFrame(candles)
                
                # Build 15-minute DataFrame (aggregate every 3 candles)
                df_15m_data = []
                for i in range(0, len(candles) - 2, 3):
                    chunk = candles[i:i+3]
                    if len(chunk) == 3:
                        df_15m_data.append({
                            'open': chunk[0]['open'],
                            'high': max(c['high'] for c in chunk),
                            'low': min(c['low'] for c in chunk),
                            'close': chunk[-1]['close'],
                            'volume': sum(c.get('volume', 0) for c in chunk),
                            'oi': chunk[-1].get('oi', 0)
                        })
                df_15m = pd.DataFrame(df_15m_data)
                
                # Get current values from latest candle
                current_price = df_5m.iloc[-1]['close'] if len(df_5m) > 0 else 0
                current_oi = df_5m.iloc[-1].get('oi') if len(df_5m) > 0 else None
                current_volume = df_5m.iloc[-1]['volume'] if len(df_5m) > 0 else None
                
                # Analyze OI Momentum
                signal_data = oi_momentum_service.analyze_signal(
                    symbol=symbol,
                    df_5min=df_5m,
                    df_15min=df_15m,
                    current_price=current_price,
                    current_oi=current_oi,
                    current_volume=current_volume
                )
                
                results[symbol] = {
                    **signal_data,
                    "symbol_name": SYMBOL_MAPPING[symbol]["name"],
                    "current_price": current_price
                }
                
                print(f"✅ OI Momentum [{symbol}]: {signal_data['final_signal']} ({signal_data['confidence']}%) - FROM CACHE")
                
            except Exception as e:
                print(f"❌ OI Momentum error for {symbol}: {e}")
                import traceback
                traceback.print_exc()
                results[symbol] = {
                    "signal_5m": "ERROR",
                    "signal_15m": "ERROR",
                    "final_signal": "ERROR",
                    "confidence": 0,
                    "reasons": [f"Calculation error: {str(e)[:100]}"],
                    "metrics": {},
                    "symbol_name": SYMBOL_MAPPING.get(symbol, {}).get("name", symbol)
                }
        
        # Cache the results
        _oi_momentum_cache['data'] = results
        _oi_momentum_cache['timestamp'] = datetime.now()
        
        return results
        
    except Exception as e:
        print(f"❌ OI Momentum service error: {e}")
        import traceback
        traceback.print_exc()
        return {"error": str(e)}


@router.get("/oi-momentum/{symbol}")
async def get_oi_momentum_symbol(symbol: str):
    """
    Get OI Momentum signal for a specific symbol
    LIVE VERSION: Uses LATEST market tick + cached candles for 5m/15m analysis
    
    Logic:
    - 5m Entry Timing: Analyze 5-minute candles for breakouts, liquidity grabs
    - 15m Trend Direction: Analyze 15-minute candles for trend confirmation
    = Final Signal: Only take 5m signals aligned with 15m trend
    """
    symbol = symbol.upper()
    
    if symbol not in SYMBOL_MAPPING:
        return {"error": f"Unknown symbol: {symbol}"}
    
    try:
        cache = await get_redis()
        
        # 🔥 SMART CACHING: Don't cache during 9:15-3:30 IST trading hours
        # Outside trading hours: cache for 60 seconds
        from services.market_feed import get_market_status
        market_status = get_market_status()
        is_trading = market_status == "LIVE"
        cache_ttl = 0 if is_trading else 60  # 0 = no cache during trading hours
        cache_key = f"oi_momentum_live:{symbol}"
        
        # Try to use cached result if not in trading hours
        if cache_ttl > 0:
            try:
                cached_result = await cache.get(cache_key)
                if cached_result:
                    import json
                    return json.loads(cached_result)
            except:
                pass  # Fall through to fresh calculation
        
        import pandas as pd
        import json
        
        # 🔥 PRIORITY 1: Try to get LATEST market tick first
        market_data = await cache.get_market_data(symbol)
        has_live_data = market_data and market_data.get('price', 0) > 0
        
        # If no live market data, try to get last cached analysis
        if not has_live_data:
            cached_oi_result = await cache.get(f"oi_momentum_result:{symbol}")
            if cached_oi_result and isinstance(cached_oi_result, dict):
                # Return last known analysis (market is closed but we have recent data)
                print(f"⏱️ OI Momentum [{symbol}]: Using cached result (market closed)")
                return cached_oi_result
            
            # If still no data, try to get last market data (even if stale)
            last_market = await cache.get(f"last_market_data:{symbol}")
            if not last_market or last_market.get('price', 0) <= 0:
                return {
                    "signal_5m": "NO_SIGNAL",
                    "signal_15m": "NO_SIGNAL",
                    "final_signal": "NO_SIGNAL",
                    "confidence": 0,
                    "reasons": ["No market data available - market closed or no live feed"],
                    "metrics": {},
                    "symbol_name": SYMBOL_MAPPING[symbol]["name"],
                    "current_price": 0,
                    "timestamp": datetime.now().isoformat()
                }
            market_data = last_market
        
        # Extract market data (live or last known)
        current_price = float(market_data.get('price', 0))
        current_oi = market_data.get('oi', None)
        current_volume = market_data.get('volume', None)
        
        # 🔥 SECOND: Get cached candles for historical analysis
        candle_key = f"analysis_candles:{symbol}"
        candles_json = await cache.lrange(candle_key, 0, 199)
        
        if not candles_json or len(candles_json) < 20:
            # Return cached result if available, even with fewer candles
            cached_oi_result = await cache.get(f"oi_momentum_result:{symbol}")
            if cached_oi_result and isinstance(cached_oi_result, dict):
                return cached_oi_result
            
            return {
                "signal_5m": "NO_SIGNAL",
                "signal_15m": "NO_SIGNAL",
                "final_signal": "NO_SIGNAL",
                "confidence": 0,
                "reasons": ["Accumulating candles - need minimum 20 candles for analysis"],
                "metrics": {},
                "symbol_name": SYMBOL_MAPPING[symbol]["name"],
                "current_price": current_price,
                "timestamp": datetime.now().isoformat()
            }
        
        # Parse cached candles (newest first in Redis list)
        candles = []
        for candle_json in reversed(candles_json):
            try:
                c = json.loads(candle_json)
                candles.append(c)
            except:
                continue
        
        # 🔥 CRITICAL: Add LATEST TICK as newest candle (updates ongoing candle with live price)
        if len(candles) > 0 and has_live_data:
            latest_candle = candles[-1].copy()  # Last candle in chronological order
            # Update with latest market data to reflect CURRENT price, not stale close
            latest_candle['close'] = current_price
            latest_candle['high'] = max(latest_candle.get('high', current_price), current_price)
            latest_candle['low'] = min(latest_candle.get('low', current_price), current_price)
            if current_volume:
                latest_candle['volume'] = current_volume
            if current_oi:
                latest_candle['oi'] = current_oi
            # Replace the last candle with updated version
            candles[-1] = latest_candle
        
        # Build 5-minute DataFrame (1-minute candles, kept as-is)
        df_5m = pd.DataFrame(candles)
        
        # Build 15-minute DataFrame properly (aggregate every 3 consecutive candles)
        # This is CRITICAL for correct 15m trend analysis
        df_15m_data = []
        i = 0
        while i < len(candles) - 2:
            chunk = candles[i:i+3]
            if len(chunk) == 3:
                df_15m_data.append({
                    'open': chunk[0].get('open', chunk[0].get('close', 0)),
                    'high': max(c.get('high', 0) for c in chunk),
                    'low': min(c.get('low', float('inf')) for c in chunk if c.get('low', float('inf')) != float('inf')),
                    'close': chunk[-1].get('close', 0),
                    'volume': sum(c.get('volume', 0) for c in chunk),
                    'oi': chunk[-1].get('oi', 0),
                    'timestamp': chunk[-1].get('timestamp', '')
                })
            i += 3
        
        df_15m = pd.DataFrame(df_15m_data)
        
        if len(df_5m) < 20 or len(df_15m) < 5:
            # Return cached result if available
            cached_oi_result = await cache.get(f"oi_momentum_result:{symbol}")
            if cached_oi_result and isinstance(cached_oi_result, dict):
                return cached_oi_result
            
            return {
                "signal_5m": "NO_SIGNAL",
                "signal_15m": "NO_SIGNAL",
                "final_signal": "NO_SIGNAL",
                "confidence": 0,
                "reasons": [f"Insufficient candles: 5m={len(df_5m)}, 15m={len(df_15m)}"],
                "metrics": {},
                "symbol_name": SYMBOL_MAPPING[symbol]["name"],
                "current_price": current_price,
                "timestamp": datetime.now().isoformat()
            }
        
        # 🔥 ANALYZE: Use service with LIVE price + historical candles
        signal_data = oi_momentum_service.analyze_signal(
            symbol=symbol,
            df_5min=df_5m,
            df_15min=df_15m,
            current_price=current_price,
            current_oi=current_oi,
            current_volume=current_volume
        )
        
        print(f"✅ OI Momentum [{symbol}]: {signal_data['final_signal']} ({signal_data['confidence']}%) @ ₹{current_price}")
        print(f"   5m Signal: {signal_data['signal_5m']} | 15m Trend: {signal_data['signal_15m']}")
        print(f"   Candles: 5m={len(df_5m)}, 15m={len(df_15m)}")
        
        result = {
            **signal_data,
            "symbol_name": SYMBOL_MAPPING[symbol]["name"],
            "current_price": current_price,
            "timestamp": datetime.now().isoformat()
        }
        
        # Cache the result for live trading (smart TTL) and post-market display
        # During trading: cache for smart TTL (no cache means always fresh)
        # Outside trading: cache for 60 seconds + 24h backup
        if cache_ttl > 0:
            # Outside trading hours - cache for efficiency
            try:
                import json
                await cache.set(cache_key, json.dumps(result), expire=cache_ttl)
            except:
                pass  # Non-critical: if cache write fails, just continue
        
        # Also cache for 24 hours as backup for post-market display
        await cache.set(f"oi_momentum_result:{symbol}", result, ex=86400)
        
        return result
        
    except Exception as e:
        print(f"❌ OI Momentum error for {symbol}: {e}")
        import traceback
        traceback.print_exc()
        return {
            "signal_5m": "ERROR",
            "signal_15m": "ERROR",
            "final_signal": "ERROR",
            "confidence": 0,
            "reasons": [f"Calculation error: {str(e)[:100]}"],
            "metrics": {},
            "symbol_name": SYMBOL_MAPPING.get(symbol, {}).get("name", symbol),
            "timestamp": datetime.now().isoformat()
        }




@router.get("/rsi-momentum/{symbol}")
async def get_rsi_momentum(symbol: str):
    """
    Get live RSI 60/40 Momentum analysis for a symbol
    
    🔥 IMPROVEMENT: Smart caching during trading hours
    - 9:15-3:30 IST (Mon-Fri): NO CACHE - fresh analysis every 5s request
    - Outside hours: 60s cache for efficiency
    """
    symbol = symbol.upper()
    
    try:
        # Trading hours detection (9:15 AM - 3:30 PM IST, Mon-Fri)
        from datetime import datetime
        from pytz import timezone
        ist = timezone('Asia/Kolkata')
        current_time = datetime.now(ist)
        is_weekday = current_time.weekday() < 5  # Mon=0, Fri=4
        current_hm = current_time.time()
        trading_start = datetime.strptime("09:15", "%H:%M").time()
        trading_end = datetime.strptime("15:30", "%H:%M").time()
        is_trading = is_weekday and (trading_start <= current_hm <= trading_end)
        
        # Smart caching strategy
        cache = await get_redis()
        cache_svc = get_cache()
        cache_key = f"rsi_momentum:{symbol}"
        
        # During trading hours: NO CACHE for live analysis
        # Outside trading hours: 60s cache for efficiency
        if is_trading:
            print(f"[RSI-MOMENTUM] 🔥 Trading hours (9:15-3:30) - NO CACHE for live updates")
        else:
            cached_result = await cache_svc.get(cache_key)
            if cached_result:
                print(f"[RSI-MOMENTUM] ⚡ Cache hit for {symbol} (60s cache outside trading hours)")
                return cached_result
        
        # Get market data from cache
        market_data = await cache.get_market_data(symbol)
        if not market_data or market_data.get('price', 0) <= 0:
            result = {
                "symbol": symbol,
                "rsi_5m": 50,
                "rsi_15m": 50,
                "rsi_5m_signal": "NEUTRAL",
                "rsi_15m_signal": "NEUTRAL",
                "rsi_momentum_status": "WAIT",
                "rsi_momentum_confidence": 0,
                "volume_ma_ratio": 1.0,
                "price_momentum": "FLAT",
                "last_update": datetime.now().isoformat(),
                "error": "No market data available"
            }
            return result
        
        # Get indicators from cache (should have RSI data)
        analysis_key = f"analysis:{symbol}"
        cached_analysis = await cache.get(analysis_key)
        
        if cached_analysis and isinstance(cached_analysis, dict):
            indicators = cached_analysis.get("indicators", {})
            
            # Extract RSI values - may be single RSI or separate 5m/15m
            rsi_5m = float(indicators.get("rsi_5m") or indicators.get("rsi", 50))
            rsi_15m = float(indicators.get("rsi_15m") or indicators.get("rsi", 50))
            
            # Determine RSI signals
            def get_rsi_signal(rsi_value):
                if rsi_value < 30:
                    return "OVERSOLD"
                elif rsi_value < 40:
                    return "WEAK"
                elif rsi_value < 60:
                    return "NEUTRAL"
                elif rsi_value < 70:
                    return "STRONG"
                else:
                    return "OVERBOUGHT"
            
            rsi_5m_signal = get_rsi_signal(rsi_5m)
            rsi_15m_signal = get_rsi_signal(rsi_15m)
            
            # Calculate confidence based on RSI alignment and strength
            confidence = 50
            
            # Both oversold = High confidence BUY
            if rsi_5m < 30 and rsi_15m < 40:
                confidence = 85
                status = "STRONG_BUY"
            # Both overbought = High confidence SELL
            elif rsi_5m > 70 and rsi_15m > 60:
                confidence = 85
                status = "STRONG_SELL"
            # 5m oversold
            elif rsi_5m < 40 and rsi_15m < 50:
                confidence = 75
                status = "BUY"
            # 5m overbought
            elif rsi_5m > 60 and rsi_15m > 50:
                confidence = 75
                status = "SELL"
            # Divergence or mixed signals
            elif abs(rsi_5m - rsi_15m) > 15:
                confidence = 45
                status = "WATCH"
            else:
                confidence = 50
                status = "NEUTRAL"
            
            # Get volume and momentum data
            volume_ma_ratio = float(indicators.get("volume_ratio", 1.0))
            price_momentum = "FLAT"
            
            price_change = float(indicators.get("change", 0))
            if price_change > 0.5:
                price_momentum = "UP"
            elif price_change < -0.5:
                price_momentum = "DOWN"
            
            return {
                "symbol": symbol,
                "rsi_5m": round(rsi_5m, 2),
                "rsi_15m": round(rsi_15m, 2),
                "rsi_5m_signal": rsi_5m_signal,
                "rsi_15m_signal": rsi_15m_signal,
                "rsi_momentum_status": status,
                "rsi_momentum_confidence": int(confidence),
                "volume_ma_ratio": round(volume_ma_ratio, 2),
                "price_momentum": price_momentum,
                "last_update": indicators.get("timestamp", datetime.now().isoformat()),
                "current_price": market_data.get("price", 0)
            }
            
            # Smart cache strategy
            if not is_trading:
                await cache_svc.set(cache_key, result, expire=60)
                print(f"[RSI-MOMENTUM] 📦 Non-trading hours - Cached for 60s")
            
            return result
        
        # Fallback if no cached analysis
        return {
            "symbol": symbol,
            "rsi_5m": 50,
            "rsi_15m": 50,
            "rsi_5m_signal": "NEUTRAL",
            "rsi_15m_signal": "NEUTRAL",
            "rsi_momentum_status": "WAIT",
            "rsi_momentum_confidence": 0,
            "volume_ma_ratio": 1.0,
            "price_momentum": "FLAT",
            "last_update": datetime.now().isoformat(),
            "current_price": market_data.get("price", 0)
        }
        
    except Exception as e:
        print(f"❌ RSI Momentum error for {symbol}: {e}")
        import traceback
        traceback.print_exc()
        return {
            "symbol": symbol,
            "rsi_5m": 50,
            "rsi_15m": 50,
            "rsi_5m_signal": "NEUTRAL",
            "rsi_15m_signal": "NEUTRAL",
            "rsi_momentum_status": "ERROR",
            "rsi_momentum_confidence": 0,
            "volume_ma_ratio": 1.0,
            "price_momentum": "FLAT",
            "last_update": datetime.now().isoformat(),
            "error": str(e)
        }


@router.get("/smart-money/{symbol}")
async def get_smart_money_flow(symbol: str):
    """
    Get Smart Money Flow • Order Structure Intelligence
    
    Returns:
    - Order Flow (Buy/Sell volume ratio)
    - Institutional Positioning (Smart money signals)
    - Fair Value Gaps, Order Blocks, Market Imbalances
    
    Uses LIVE market tick + order flow analysis
    """
    symbol = symbol.upper()
    
    if symbol not in SYMBOL_MAPPING:
        return {"error": f"Unknown symbol: {symbol}"}
    
    try:
        cache = await get_redis()
        
        # 🔥 SMART CACHING: Don't cache during 9:15-3:30 IST trading hours
        # Outside trading hours: cache for 60 seconds
        from services.market_feed import get_market_status
        market_status = get_market_status()
        is_trading = market_status == "LIVE"
        cache_ttl = 0 if is_trading else 60  # 0 = no cache during trading hours
        cache_key = f"smart_money:{symbol}"
        
        # Try to use cached result if not in trading hours
        if cache_ttl > 0:
            try:
                cached_result = await cache.get(cache_key)
                if cached_result:
                    import json
                    return json.loads(cached_result)
            except:
                pass  # Fall through to fresh calculation
        
        # 🔥 Get LATEST market data (live tick)
        market_data = await cache.get_market_data(symbol)
        if not market_data or market_data.get('price', 0) <= 0:
            return {
                "symbol": symbol,
                "smart_money_signal": "NO_DATA",
                "smart_money_confidence": 0,
                "order_flow_strength": 50,
                "volume_imbalance": 0,
                "fair_value_gap_bullish": False,
                "fair_value_gap_bearish": False,
                "order_block_bullish": None,
                "order_block_bearish": None,
                "market_imbalance": "NEUTRAL",
                "current_price": 0,
                "timestamp": datetime.now().isoformat(),
                "reason": "No market data - market closed or no live feed"
            }
        
        # Extract live data
        current_price = float(market_data.get('price', 0))
        current_volume = market_data.get('volume', 0)
        current_oi = market_data.get('oi', None)
        
        # Extract smart money indicators from analysis
        analysis_key = f"analysis:{symbol}"
        cached_analysis = await cache.get(analysis_key)
        
        smart_money_signal = "NEUTRAL"
        smart_money_confidence = 50
        order_flow_strength = 50
        volume_imbalance = 0
        fair_value_gap_bullish = False
        fair_value_gap_bearish = False
        order_block_bullish = None
        order_block_bearish = None
        market_imbalance = "NEUTRAL"
        
        if cached_analysis and isinstance(cached_analysis, dict):
            indicators = cached_analysis.get("indicators", {})
            
            # Extract smart money signal
            smart_money_signal = indicators.get("smart_money_signal", "NEUTRAL")
            smart_money_confidence = int((float(indicators.get("smart_money_confidence", 0.5)) * 100))
            
            # Extract order flow data
            buy_volume_ratio = float(indicators.get("buy_volume_ratio", 50))
            order_flow_strength = int(buy_volume_ratio)
            
            # Extract volume imbalance
            volume_imbalance = int(indicators.get("volume_imbalance", 0))
            
            # Extract Fair Value Gaps (FVG)
            fair_value_gap_bullish = bool(indicators.get("fvg_bullish", False))
            fair_value_gap_bearish = bool(indicators.get("fvg_bearish", False))
            
            # Extract Order Blocks
            order_block_bullish = indicators.get("order_block_bullish", None)
            order_block_bearish = indicators.get("order_block_bearish", None)
            
            # Extract Market Imbalances (Order Imbalance)
            if volume_imbalance > 10:
                market_imbalance = "STRONG_BUY"
            elif volume_imbalance > 5:
                market_imbalance = "ACCUMULATION"
            elif volume_imbalance < -10:
                market_imbalance = "STRONG_SELL"
            elif volume_imbalance < -5:
                market_imbalance = "DISTRIBUTION"
            else:
                market_imbalance = "NEUTRAL"
            
            print(f"✅ Smart Money [{symbol}]: {smart_money_signal} ({smart_money_confidence}%) @ ₹{current_price}")
            print(f"   Order Flow: {order_flow_strength}% | Volume Imbalance: {volume_imbalance}")
            print(f"   FVG: Bullish={fair_value_gap_bullish}, Bearish={fair_value_gap_bearish}")
            print(f"   Order Blocks: Bull={order_block_bullish}, Bear={order_block_bearish}")
        
        result = {
            "symbol": symbol,
            "symbol_name": SYMBOL_MAPPING[symbol]["name"],
            "smart_money_signal": smart_money_signal,
            "smart_money_confidence": smart_money_confidence,
            "order_flow_strength": order_flow_strength,
            "buy_volume_ratio": order_flow_strength,
            "sell_volume_ratio": 100 - order_flow_strength,
            "volume_imbalance": volume_imbalance,
            "fair_value_gap_bullish": fair_value_gap_bullish,
            "fair_value_gap_bearish": fair_value_gap_bearish,
            "order_block_bullish": order_block_bullish,
            "order_block_bearish": order_block_bearish,
            "market_imbalance": market_imbalance,
            "current_price": current_price,
            "current_volume": current_volume,
            "current_oi": current_oi,
            "timestamp": datetime.now().isoformat()
        }
        
        # Cache result outside trading hours
        if cache_ttl > 0:
            try:
                import json
                await cache.set(cache_key, json.dumps(result), expire=cache_ttl)
            except:
                pass  # Non-critical: if cache write fails, just continue
        
        return result
        
    except Exception as e:
        print(f"❌ Smart Money error for {symbol}: {e}")
        import traceback
        traceback.print_exc()
        return {
            "symbol": symbol,
            "smart_money_signal": "ERROR",
            "smart_money_confidence": 0,
            "order_flow_strength": 50,
            "volume_imbalance": 0,
            "fair_value_gap_bullish": False,
            "fair_value_gap_bearish": False,
            "order_block_bullish": None,
            "order_block_bearish": None,
            "market_imbalance": "NEUTRAL",
            "current_price": 0,
            "timestamp": datetime.now().isoformat(),
            "error": str(e)
        }


@router.get("/candle-quality/{symbol}")
async def get_candle_quality(symbol: str):
    """
    Get High Volume Candle Scanner Analysis
    
    Returns:
    - Candle Quality Signal (STRONG_BUY/BUY/SELL/STRONG_SELL/NEUTRAL)
    - Body Strength Analysis
    - Very Good Volume Detection
    - Fake Spike Detection
    - Conviction Moves
    
    Uses LIVE market tick + candle anatomy analysis
    """
    symbol = symbol.upper()
    
    if symbol not in SYMBOL_MAPPING:
        return {"error": f"Unknown symbol: {symbol}"}
    
    try:
        cache = await get_redis()
        
        # 🔥 SMART CACHING: Don't cache during 9:15-3:30 IST trading hours
        # Outside trading hours: cache for 60 seconds
        from services.market_feed import get_market_status
        market_status = get_market_status()
        is_trading = market_status == "LIVE"
        cache_ttl = 0 if is_trading else 60  # 0 = no cache during trading hours
        cache_key = f"candle_quality:{symbol}"
        
        # Try to use cached result if not in trading hours
        if cache_ttl > 0:
            try:
                cached_result = await cache.get(cache_key)
                if cached_result:
                    import json
                    return json.loads(cached_result)
            except:
                pass  # Fall through to fresh calculation
        
        # 🔥 Get LATEST market data (live tick)
        market_data = await cache.get_market_data(symbol)
        if not market_data or market_data.get('price', 0) <= 0:
            return {
                "symbol": symbol,
                "candle_quality_signal": "NO_DATA",
                "candle_quality_confidence": 0,
                "candle_direction": "UNKNOWN",
                "candle_strength": 0,
                "body_percent": 0,
                "volume_above_threshold": False,
                "fake_spike_detected": False,
                "conviction_move": False,
                "momentum_score": 50,
                "current_price": 0,
                "current_volume": 0,
                "timestamp": datetime.now().isoformat(),
                "reason": "No market data - market closed or no live feed"
            }
        
        # Extract live data
        current_price = float(market_data.get('price', 0))
        current_volume = market_data.get('volume', 0)
        open_price = float(market_data.get('open', current_price))
        high_price = float(market_data.get('high', current_price))
        low_price = float(market_data.get('low', current_price))
        
        # Get analysis data for momentum and volume baseline
        analysis_key = f"analysis:{symbol}"
        cached_analysis = await cache.get(analysis_key)
        
        # Default values
        candle_quality_signal = "NEUTRAL"
        candle_quality_confidence = 0.3
        candle_direction = "UNKNOWN"
        candle_strength = 0  # As percentage
        body_percent = 0
        volume_above_threshold = False
        fake_spike_detected = False
        conviction_move = False
        momentum_score = 50
        
        if cached_analysis and isinstance(cached_analysis, dict):
            indicators = cached_analysis.get("indicators", {})
            
            # Extract candle quality data
            candle_quality_signal = indicators.get("candle_quality_signal", "NEUTRAL")
            candle_quality_confidence = float(indicators.get("candle_quality_confidence", 0.3))
            candle_direction = indicators.get("candle_direction", "UNKNOWN")
            candle_strength = float(indicators.get("candle_strength", 0)) * 100  # Convert to percentage
            
            # Calculate body percent
            candle_range = high_price - low_price
            candle_body = abs(current_price - open_price)
            body_percent = (candle_body / candle_range * 100) if candle_range > 0 else 0
            
            # Extract volume status
            volume_above_threshold = bool(indicators.get("volume_above_threshold", False))
            
            # Detect fake spike: High volume spike but weak body
            volume_ratio = float(indicators.get("volume_ratio", 1.0))
            fake_spike_detected = volume_ratio > 2.5 and body_percent < 40
            
            # Detect conviction move: High volume + strong body
            conviction_move = volume_above_threshold and body_percent > 60
            
            # Get momentum score
            momentum_score = int(indicators.get("momentum", 50))
            
            print(f"🕯️ Candle Quality [{symbol}]: {candle_quality_signal} ({candle_quality_confidence:.0%})")
            print(f"   Direction: {candle_direction} | Body: {body_percent:.1f}% | Volume Threshold: {volume_above_threshold}")
            print(f"   Fake Spike: {fake_spike_detected} | Conviction: {conviction_move} | Momentum: {momentum_score}")
        
        result = {
            "symbol": symbol,
            "symbol_name": SYMBOL_MAPPING[symbol]["name"],
            "candle_quality_signal": candle_quality_signal,
            "candle_quality_confidence": int(candle_quality_confidence * 100) if candle_quality_confidence < 1 else int(candle_quality_confidence),
            "candle_direction": candle_direction,
            "candle_strength": round(candle_strength, 2),
            "body_percent": round(body_percent, 2),
            "volume_above_threshold": volume_above_threshold,
            "fake_spike_detected": fake_spike_detected,
            "conviction_move": conviction_move,
            "momentum_score": momentum_score,
            "current_price": current_price,
            "current_volume": current_volume,
            "open_price": open_price,
            "high_price": high_price,
            "low_price": low_price,
            "timestamp": datetime.now().isoformat()
        }
        
        # Cache result outside trading hours
        if cache_ttl > 0:
            try:
                import json
                await cache.set(cache_key, json.dumps(result), expire=cache_ttl)
            except:
                pass  # Non-critical: if cache write fails, just continue
        
        return result
        
    except Exception as e:
        print(f"❌ Candle Quality error for {symbol}: {e}")
        import traceback
        traceback.print_exc()
        return {
            "symbol": symbol,
            "candle_quality_signal": "ERROR",
            "candle_quality_confidence": 0,
            "candle_direction": "UNKNOWN",
            "candle_strength": 0,
            "body_percent": 0,
            "volume_above_threshold": False,
            "fake_spike_detected": False,
            "conviction_move": False,
            "momentum_score": 50,
            "current_price": 0,
            "current_volume": 0,
            "timestamp": datetime.now().isoformat(),
            "error": str(e)
        }


@router.websocket("/ws/analysis")
async def websocket_analysis_endpoint(websocket: WebSocket):
    """WebSocket for INSTANT analysis updates every 3 seconds"""
    await manager.connect(websocket)
    
    try:
        cache = await get_redis()
        
        # Send immediate first update
        analyses = await get_all_instant_analysis(cache)
        
        # Add symbol names
        for symbol in analyses:
            if symbol in SYMBOL_MAPPING:
                analyses[symbol]['symbol_name'] = SYMBOL_MAPPING[symbol]['name']
        
        await manager.send_personal_message(
            {
                "type": "analysis_update",
                "data": analyses,
                "timestamp": datetime.now().isoformat(),
            },
            websocket
        )
        
        while True:
            # Wait before next update
            await asyncio.sleep(settings.analysis_update_interval)
            
            # Get instant analysis for all symbols
            analyses = await get_all_instant_analysis(cache)
            
            # Add symbol names
            for symbol in analyses:
                if symbol in SYMBOL_MAPPING:
                    analyses[symbol]['symbol_name'] = SYMBOL_MAPPING[symbol]['name']
            
            # Send to client
            await manager.send_personal_message(
                {
                    "type": "analysis_update",
                    "data": analyses,
                    "timestamp": datetime.now().isoformat(),
                },
                websocket
            )
            
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        print(f"WebSocket error: {e}")
        manager.disconnect(websocket)
