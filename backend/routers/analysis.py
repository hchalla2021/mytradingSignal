"""
Analysis Router - INSTANT Real-time Analysis API
Ultra-fast analysis using direct Zerodha tick data
NO historical data needed - BLAZING FAST
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict
import asyncio
from datetime import datetime

from services.instant_analysis import get_instant_analysis, get_all_instant_analysis
from services.cache import get_redis
from services.websocket_manager import manager

router = APIRouter(prefix="/api/analysis", tags=["analysis"])

# Symbol mapping
SYMBOL_MAPPING = {
    "NIFTY": {"token": 256265, "name": "NIFTY 50"},
    "BANKNIFTY": {"token": 260105, "name": "NIFTY BANK"},
    "SENSEX": {"token": 265, "name": "BSE SENSEX"},
}


@router.get("/analyze/all")
async def analyze_all_symbols():
    """INSTANT analysis for all symbols - ULTRA FAST"""
    try:
        cache = await get_redis()
        results = await get_all_instant_analysis(cache)
        
        # Add symbol names
        for symbol in results:
            if symbol in SYMBOL_MAPPING:
                results[symbol]['symbol_name'] = SYMBOL_MAPPING[symbol]['name']
        
        print(f"✅ Instant analysis completed for {len(results)} symbols")
        return results
        
    except Exception as e:
        print(f"❌ Analysis error: {e}")
        import traceback
        traceback.print_exc()
        
        # Return fallback data
        return {
            "NIFTY": {"signal": "WAIT", "confidence": 0.0, "error": str(e)},
            "BANKNIFTY": {"signal": "WAIT", "confidence": 0.0, "error": str(e)},
            "SENSEX": {"signal": "WAIT", "confidence": 0.0, "error": str(e)},
        }


@router.get("/analyze/{symbol}")
async def analyze_symbol(symbol: str):
    """INSTANT analysis for a single symbol"""
    symbol = symbol.upper()
    
    try:
        cache = await get_redis()
        result = await get_instant_analysis(cache, symbol)
        
        if symbol in SYMBOL_MAPPING:
            result['symbol_name'] = SYMBOL_MAPPING[symbol]['name']
        
        return result
        
    except Exception as e:
        print(f"❌ Analysis error for {symbol}: {e}")
        return {
            "signal": "ERROR",
            "confidence": 0.0,
            "error": str(e),
            "symbol": symbol
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
