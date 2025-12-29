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
from config import get_settings

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
            # Wait 3 seconds before next update
            await asyncio.sleep(3)
            
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
