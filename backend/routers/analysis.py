"""
Analysis Router - DIRECT Zerodha API Analysis
PERMANENT SOLUTION - Works independently without WebSocket
Direct REST API access to Zerodha
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict
import asyncio
from datetime import datetime

from services.zerodha_direct_analysis import get_zerodha_analysis
from services.instant_analysis import get_instant_analysis, get_all_instant_analysis
from services.cache import get_redis
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
    """
    symbol = symbol.upper()
    
    try:
        # PRIORITY: Use cache-based instant analysis
        cache = await get_redis()
        result = await get_instant_analysis(cache, symbol)
        
        if symbol in SYMBOL_MAPPING:
            result['symbol_name'] = SYMBOL_MAPPING[symbol]['name']
        
        # Check if we got valid data
        price = result.get('indicators', {}).get('price', 0)
        
        if price > 0:
            print(f"✅ INSTANT Analysis for {symbol}: Price=₹{price:,.2f}, Signal={result.get('signal')}")
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
                
                if not candles_json or len(candles_json) < 30:
                    results[symbol] = {
                        "signal_5m": "NO_SIGNAL",
                        "signal_15m": "NO_SIGNAL",
                        "final_signal": "NO_SIGNAL",
                        "confidence": 0,
                        "reasons": ["Insufficient live market data - waiting for WebSocket feed"],
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
    Uses CACHED CANDLES from WebSocket feed - NO API CALLS!
    """
    symbol = symbol.upper()
    
    if symbol not in SYMBOL_MAPPING:
        return {"error": f"Unknown symbol: {symbol}"}
    
    try:
        cache = await get_redis()
        
        import pandas as pd
        import json
        
        # Get cached candles from WebSocket feed (NO API calls!)
        candle_key = f"analysis_candles:{symbol}"
        candles_json = await cache.lrange(candle_key, 0, 199)
        
        if not candles_json or len(candles_json) < 30:
            return {
                "signal_5m": "NO_SIGNAL",
                "signal_15m": "NO_SIGNAL",
                "final_signal": "NO_SIGNAL",
                "confidence": 0,
                "reasons": ["Insufficient live market data - waiting for WebSocket feed"],
                "metrics": {},
                "symbol_name": SYMBOL_MAPPING[symbol]["name"],
                "timestamp": datetime.now().isoformat()
            }
        
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
        
        print(f"✅ OI Momentum [{symbol}]: {signal_data['final_signal']} ({signal_data['confidence']}%) - FROM CACHE")
        
        return {
            **signal_data,
            "symbol_name": SYMBOL_MAPPING[symbol]["name"],
            "current_price": current_price,
            "timestamp": datetime.now().isoformat()
        }
        
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
