"""
Diagnostic endpoint for troubleshooting market data flow
Helps identify if Zerodha connection is working and data is flowing
"""

from fastapi import APIRouter
from services.cache import CacheService
from services.auth_state_machine import auth_state_manager
from config import get_settings
import json
from datetime import datetime
import pandas as pd

router = APIRouter(prefix="/api/diagnostics", tags=["Diagnostics"])

# Global cache instance (will be injected by main.py)
_cache: CacheService | None = None

def set_cache_instance(cache: CacheService):
    """Inject cache instance for diagnostics"""
    global _cache
    _cache = cache

@router.get("/market-data-status")
async def market_data_status():
    """Check if market data is flowing and what the current values are"""
    if not _cache:
        return {
            "status": "error",
            "message": "Cache not initialized",
            "timestamp": None
        }
    
    try:
        nifty = await _cache.get("market:NIFTY")
        banknifty = await _cache.get("market:BANKNIFTY")
        sensex = await _cache.get("market:SENSEX")
        
        return {
            "status": "ok",
            "auth": {
                "is_authenticated": auth_state_manager.is_authenticated,
                "state": str(auth_state_manager.current_state),
                "has_token": bool(get_settings().zerodha_access_token),
            },
            "market_data": {
                "NIFTY": nifty,
                "BANKNIFTY": banknifty,
                "SENSEX": sensex,
            },
            "has_data": {
                "NIFTY": nifty is not None,
                "BANKNIFTY": banknifty is not None,
                "SENSEX": sensex is not None,
            }
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
            "timestamp": None
        }

@router.get("/zerodha-connection")
async def zerodha_connection_status():
    """Check Zerodha connection status"""
    settings = get_settings()
    
    return {
        "zerodha_configured": {
            "api_key_set": bool(settings.zerodha_api_key),
            "api_secret_set": bool(settings.zerodha_api_secret),
            "access_token_set": bool(settings.zerodha_access_token),
        },
        "auth_status": {
            "is_authenticated": auth_state_manager.is_authenticated,
            "state": str(auth_state_manager.current_state),
        },
        "message": "Use /api/diagnostics/market-data-status for current market data" if auth_state_manager.is_authenticated else "Zerodha authentication required for live data. Using mock data feed."
    }

@router.get("/oi-momentum-debug")
async def oi_momentum_debug():
    """
    Comprehensive OI Momentum diagnostic - Shows:
    1. Last market values for all symbols
    2. OI Momentum signal status
    3. Candle data availability
    4. Any errors or issues
    """
    if not _cache:
        return {
            "status": "error",
            "message": "Cache not initialized"
        }
    
    try:
        symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
        results = {
            "timestamp": datetime.now().isoformat(),
            "auth_status": {
                "authenticated": auth_state_manager.is_authenticated,
                "state": str(auth_state_manager.current_state)
            },
            "market_data": {},
            "candle_data": {},
            "oi_momentum_signals": {},
            "debug_info": []
        }
        
        # 1. Get latest market data from cache
        for symbol in symbols:
            try:
                market_data = await _cache.get_market_data(symbol)
                
                if market_data:
                    results["market_data"][symbol] = {
                        "price": market_data.get("price"),
                        "change": market_data.get("change"),
                        "changePercent": market_data.get("changePercent"),
                        "volume": market_data.get("volume"),
                        "oi": market_data.get("oi"),
                        "status": market_data.get("status"),
                        "timestamp": market_data.get("timestamp"),
                        "trend": market_data.get("trend"),
                        "data_available": True
                    }
                else:
                    results["market_data"][symbol] = {
                        "data_available": False,
                        "message": "No market data in cache"
                    }
                    results["debug_info"].append(f"⚠️ {symbol}: No market data found in cache")
            except Exception as e:
                results["market_data"][symbol] = {
                    "data_available": False,
                    "error": str(e)
                }
                results["debug_info"].append(f"❌ {symbol}: Market data fetch error: {e}")
        
        # 2. Get candle data status
        for symbol in symbols:
            try:
                candle_key = f"analysis_candles:{symbol}"
                candles_json = await _cache.lrange(candle_key, 0, 199)
                
                candle_count = len(candles_json) if candles_json else 0
                
                results["candle_data"][symbol] = {
                    "candle_count": candle_count,
                    "has_data": candle_count > 0,
                    "minimum_required": 20,
                    "sufficient": candle_count >= 20,
                    "message": f"✅ {candle_count} candles available" if candle_count >= 20 
                          else f"⚠️ Only {candle_count} candles (need 20)" if candle_count > 0
                          else "❌ No candles in cache"
                }
                
                if candle_count > 0:
                    # Show last candle details
                    try:
                        last_candle = json.loads(candles_json[0])
                        results["candle_data"][symbol]["last_candle"] = {
                            "timestamp": last_candle.get("timestamp"),
                            "close": last_candle.get("close"),
                            "volume": last_candle.get("volume"),
                            "oi": last_candle.get("oi")
                        }
                    except:
                        pass
                
                if candle_count < 20:
                    results["debug_info"].append(
                        f"⚠️ {symbol}: Only {candle_count} candles (OI Momentum needs 20). "
                        f"Will work once {20 - candle_count} more candles arrive"
                    )
            except Exception as e:
                results["candle_data"][symbol] = {
                    "error": str(e),
                    "has_data": False
                }
                results["debug_info"].append(f"❌ {symbol}: Candle fetch error: {e}")
        
        # 3. Get OI Momentum signals
        try:
            from services.oi_momentum_service import OIMomentumService
            from routers.analysis import oi_momentum_service
            
            for symbol in symbols:
                try:
                    # Get candles from cache
                    candle_key = f"analysis_candles:{symbol}"
                    candles_json = await _cache.lrange(candle_key, 0, 199)
                    
                    if not candles_json or len(candles_json) < 20:
                        results["oi_momentum_signals"][symbol] = {
                            "signal": "NO_SIGNAL",
                            "reason": f"Insufficient candles ({len(candles_json) if candles_json else 0}/20)",
                            "ready": False
                        }
                        continue
                    
                    # Parse candles
                    candles = []
                    for candle_json in reversed(candles_json):
                        try:
                            candles.append(json.loads(candle_json))
                        except:
                            continue
                    
                    if len(candles) < 20:
                        results["oi_momentum_signals"][symbol] = {
                            "signal": "NO_SIGNAL",
                            "reason": f"Could not parse candles ({len(candles)}/20)",
                            "ready": False
                        }
                        continue
                    
                    # Build dataframes
                    df_5m = pd.DataFrame(candles)
                    
                    # Build 15-minute DataFrame
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
                    
                    # Get current values
                    current_price = df_5m.iloc[-1]['close'] if len(df_5m) > 0 else 0
                    current_oi = df_5m.iloc[-1].get('oi') if len(df_5m) > 0 else None
                    current_volume = df_5m.iloc[-1]['volume'] if len(df_5m) > 0 else None
                    
                    # Analyze
                    signal_data = oi_momentum_service.analyze_signal(
                        symbol=symbol,
                        df_5min=df_5m,
                        df_15min=df_15m,
                        current_price=current_price,
                        current_oi=current_oi,
                        current_volume=current_volume
                    )
                    
                    results["oi_momentum_signals"][symbol] = {
                        "signal_5m": signal_data.get("signal_5m"),
                        "signal_15m": signal_data.get("signal_15m"),
                        "final_signal": signal_data.get("final_signal"),
                        "confidence": signal_data.get("confidence"),
                        "ready": True,
                        "current_price": current_price,
                        "top_reasons": signal_data.get("reasons", [])[:3],
                        "metrics": signal_data.get("metrics", {})
                    }
                    
                except Exception as e:
                    results["oi_momentum_signals"][symbol] = {
                        "signal": "ERROR",
                        "error": str(e),
                        "ready": False
                    }
                    results["debug_info"].append(f"❌ {symbol}: OI Momentum analysis error: {e}")
        except Exception as e:
            results["debug_info"].append(f"❌ OI Momentum service error: {e}")
        
        # Summary
        results["summary"] = {
            "total_symbols": len(symbols),
            "symbols_with_market_data": sum(1 for s in symbols if s in results["market_data"] and results["market_data"][s].get("data_available")),
            "symbols_with_candles": sum(1 for s in symbols if s in results["candle_data"] and results["candle_data"][s].get("sufficient")),
            "symbols_with_signals": sum(1 for s in symbols if s in results["oi_momentum_signals"] and results["oi_momentum_signals"][s].get("ready")),
            "overall_status": "✅ ALL SYSTEMS GO" if (
                sum(1 for s in symbols if s in results["market_data"] and results["market_data"][s].get("data_available")) == len(symbols) and
                sum(1 for s in symbols if s in results["oi_momentum_signals"] and results["oi_momentum_signals"][s].get("ready")) == len(symbols)
            ) else "⚠️ PARTIAL DATA" if sum(1 for s in symbols if s in results["market_data"] and results["market_data"][s].get("data_available")) > 0
            else "❌ NO DATA"
        }
        
        return results
    
    except Exception as e:
        import traceback
        return {
            "status": "error",
            "message": str(e),
            "traceback": traceback.format_exc()
        }
