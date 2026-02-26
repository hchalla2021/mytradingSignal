"""
🚀 OI Momentum Live Broadcaster
Pushes OI momentum signals to all connected WebSocket clients
Runs async alongside market feed, updates every 5 seconds during market hours
"""

import asyncio
from typing import Optional
from datetime import datetime
import json
import logging

logger = logging.getLogger(__name__)


class OIMomentumBroadcaster:
    """Broadcast live OI momentum signals to connected WebSocket clients"""
    
    def __init__(self, websocket_manager, oi_momentum_service, cache_service):
        self.manager = websocket_manager
        self.oi_service = oi_momentum_service
        self.cache = cache_service
        self.running = False
        self.broadcast_interval = 5  # Update every 5 seconds during trading hours

    async def start(self):
        """Start broadcasting OI momentum updates"""
        self.running = True
        asyncio.create_task(self._broadcast_loop())
        logger.info("🚀 OI Momentum Broadcaster started")

    async def stop(self):
        """Stop broadcasting"""
        self.running = False
        logger.info("🛑 OI Momentum Broadcaster stopped")

    async def _broadcast_loop(self):
        """Main broadcast loop - runs every 5 seconds during trading hours"""
        while self.running:
            try:
                # Check if trading hours (9:15 AM - 3:30 PM IST, Mon-Fri)
                from services.market_feed import get_market_status
                market_status = get_market_status()
                
                is_trading = market_status == "LIVE"
                
                if not is_trading:
                    # Wait 30 seconds before checking again if not trading
                    await asyncio.sleep(30)
                    continue
                
                # Broadcast for each symbol
                symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
                
                for symbol in symbols:
                    try:
                        await self._broadcast_symbol_signal(symbol)
                    except Exception as e:
                        logger.debug(f"OI broadcast error for {symbol}: {e}")
                
                # Wait before next broadcast
                await asyncio.sleep(self.broadcast_interval)
                
            except Exception as e:
                logger.error(f"OI Momentum broadcast loop error: {e}")
                await asyncio.sleep(5)

    async def _broadcast_symbol_signal(self, symbol: str):
        """Calculate and broadcast OI momentum signal for a symbol"""
        try:
            import pandas as pd
            from services.market_feed import SYMBOL_MAPPING
            
            # Get latest market data
            market_data = await self.cache.get_market_data(symbol)
            if not market_data or market_data.get('price', 0) <= 0:
                return  # No market data available
            
            current_price = float(market_data.get('price', 0))
            current_oi = market_data.get('oi')
            current_volume = market_data.get('volume')
            
            # Get cached candles
            candle_key = f"analysis_candles:{symbol}"
            candles_json = await self.cache.lrange(candle_key, 0, 199)
            
            if not candles_json or len(candles_json) < 20:
                return  # Need minimum candles
            
            # Parse candles
            candles = []
            for candle_json in reversed(candles_json):
                try:
                    candles.append(json.loads(candle_json))
                except:
                    continue
            
            # Build 5m and 15m DataFrames
            df_5m = pd.DataFrame(candles)
            
            df_15m_data = []
            for i in range(0, len(candles) - 2, 3):
                chunk = candles[i:i+3]
                if len(chunk) == 3:
                    df_15m_data.append({
                        'open': chunk[0].get('open', chunk[0].get('close', 0)),
                        'high': max(c.get('high', 0) for c in chunk),
                        'low': min(c.get('low', float('inf')) for c in chunk if c.get('low', float('inf')) != float('inf')),
                        'close': chunk[-1].get('close', 0),
                        'volume': sum(c.get('volume', 0) for c in chunk),
                        'oi': chunk[-1].get('oi', 0),
                    })
            df_15m = pd.DataFrame(df_15m_data)
            
            if len(df_5m) < 20 or len(df_15m) < 5:
                return
            
            # Analyze OI momentum
            signal_data = self.oi_service.analyze_signal(
                symbol=symbol,
                df_5min=df_5m,
                df_15min=df_15m,
                current_price=current_price,
                current_oi=current_oi,
                current_volume=current_volume
            )
            
            # Broadcast to all connected clients
            await self.manager.broadcast({
                "type": "oi_momentum_update",
                "symbol": symbol,
                "data": {
                    **signal_data,
                    "symbol_name": SYMBOL_MAPPING.get(symbol, {}).get("name", symbol),
                    "current_price": current_price,
                    "timestamp": datetime.now().isoformat(),
                    "is_live": True  # Tell frontend this is from live WebSocket
                }
            })
            
            logger.debug(f"📡 OI Momentum broadcast [{symbol}]: {signal_data['final_signal']} ({signal_data['confidence']}%)")
            
        except Exception as e:
            logger.debug(f"OI broadcast calculation error for {symbol}: {e}")


# Global broadcaster instance
_broadcaster: Optional[OIMomentumBroadcaster] = None


def get_oi_momentum_broadcaster():
    """Get or create the global OI momentum broadcaster"""
    global _broadcaster
    if _broadcaster is None:
        from services.websocket_manager import manager
        from services.oi_momentum_service import OIMomentumService
        from services.cache import CacheService
        
        cache = CacheService()
        oi_service = OIMomentumService()
        _broadcaster = OIMomentumBroadcaster(manager, oi_service, cache)
    
    return _broadcaster


async def start_oi_momentum_broadcaster():
    """Start the OI momentum broadcaster"""
    broadcaster = get_oi_momentum_broadcaster()
    await broadcaster.start()


async def stop_oi_momentum_broadcaster():
    """Stop the OI momentum broadcaster"""
    if _broadcaster:
        await _broadcaster.stop()
