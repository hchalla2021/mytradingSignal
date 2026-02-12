"""
Mock Market Feed Service
Provides realistic simulated market data when live Zerodha connection is not available.
Used for testing, demos, and development.
"""

import asyncio
import random
from datetime import datetime
from typing import Dict, Any, Optional
import pytz

from data.test_data_factory import TestDataFactory
from services.cache import CacheService
from services.websocket_manager import ConnectionManager

IST = pytz.timezone('Asia/Kolkata')

SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"]


def is_market_open() -> bool:
    """Check if market is currently open (intraday)."""
    import pytz
    from datetime import time
    now = datetime.now(pytz.timezone('Asia/Kolkata'))
    market_open = time(9, 15)
    market_close = time(15, 30)
    return market_open <= now.time() <= market_close and now.weekday() < 5


def get_market_status() -> str:
    """Get current market status."""
    import pytz
    from datetime import time
    now = datetime.now(pytz.timezone('Asia/Kolkata'))
    
    # Market is closed on weekends
    if now.weekday() >= 5:
        return "CLOSED"
    
    current_time = now.time()
    
    # PRE_OPEN: 9:00 - 9:15 AM
    if time(9, 0) <= current_time < time(9, 15):
        return "PRE_OPEN"
    
    # FREEZE: 9:07 - 9:15 AM (price discovery, no ticks broadcast)
    if time(9, 7) <= current_time < time(9, 15):
        return "FREEZE"
    
    # LIVE: 9:15 AM - 3:30 PM
    if time(9, 15) <= current_time <= time(15, 30):
        return "LIVE"
    
    # CLOSED: After 3:30 PM
    return "CLOSED"


class MockMarketFeedService:
    """
    Service to provide realistic mock market data for development/testing.
    
    Features:
    - Generates realistic price movements
    - Respects market hours
    - Provides complete OHLCV data with analysis
    - Updates every 500ms to simulate live data
    """
    
    def __init__(self, cache: CacheService, ws_manager: ConnectionManager):
        self.cache = cache
        self.ws_manager = ws_manager
        self.running = False
        self._task: Optional[asyncio.Task] = None
        self._last_prices: Dict[str, float] = {}
        self._last_time: Dict[str, float] = {}
        self._price_trends: Dict[str, float] = {}  # Direction of price movement
        
        # Initialize with base prices
        for symbol in SYMBOLS:
            base = TestDataFactory.BASE_PRICES.get(symbol, 20000.0)
            self._last_prices[symbol] = base
            self._price_trends[symbol] = random.choice([-1, 1])  # Random initial direction
    
    async def start(self):
        """Start the mock market data feed."""
        if self.running:
            return
        
        self.running = True
        print("🎭 Mock Market Data Feed Started")
        print("   Generating realistic simulated market data...")
        print("   [DEV] This is NOT live Zerodha data - set up authentication for live data")
        
        self._task = asyncio.create_task(self._feed_loop())
        
        return self
    
    async def stop(self):
        """Stop the mock market data feed."""
        self.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        print("🛑 Mock Market Data Feed Stopped")
    
    async def _feed_loop(self):
        """Main loop that generates and broadcasts mock data."""
        update_count = 0
        
        try:
            while self.running:
                # Only broadcast during market hours
                if is_market_open():
                    for symbol in SYMBOLS:
                        try:
                            # Generate updated tick
                            tick = self._generate_updated_tick(symbol)
                            
                            # Broadcast to connected clients
                            await self.ws_manager.broadcast({
                                "type": "tick",
                                "data": tick
                            })
                            
                            # Save to cache
                            await self.cache.set(f"market:{symbol}", tick)
                            
                        except Exception as e:
                            print(f"❌ Error generating mock data for {symbol}: {e}")
                    
                    update_count += 1
                    
                    # Log periodically
                    if update_count % 10 == 0:  # Every 5 seconds (10 updates × 500ms)
                        market_status = get_market_status()
                        prices = {s: self._last_prices[s] for s in SYMBOLS}
                        print(f"📊 Mock Data: {prices} [{market_status}]")
                
                # Update every 500ms (faster to simulate real market)
                await asyncio.sleep(0.5)
                
        except asyncio.CancelledError:
            print("🛑 Mock feed loop cancelled")
        except Exception as e:
            print(f"❌ Mock feed loop error: {e}")
            self.running = False
    
    def _generate_updated_tick(self, symbol: str) -> Dict[str, Any]:
        """
        Generate a realistic updated tick from the last one.
        
        This simulates:
        - Small price movements (+/- 0.01-0.05% per tick)
        - Trend reversals every 50-100 ticks
        - Realistic OHLC updates
        - Volume variations
        """
        current_price = self._last_prices.get(symbol, TestDataFactory.BASE_PRICES[symbol])
        base_price = TestDataFactory.BASE_PRICES[symbol]
        
        # 🔥 REALISTIC PRICE MOVEMENT
        # Small random walk with occasional trend changes
        movement_percent = random.uniform(-0.03, 0.03)  # 0.03% per tick = small realistic movement
        price_change = current_price * (movement_percent / 100)
        new_price = current_price + price_change
        
        # Occasional trend reversals (every ~25 ticks = 12.5 seconds)
        if random.random() < 0.04:  # 4% chance per tick = ~100 ticks between reversals
            self._price_trends[symbol] = -self._price_trends[symbol]
        
        # Gentle trend influence
        trend_influence = self._price_trends[symbol] * 0.01  # Very small directional influence
        new_price += trend_influence
        
        # Keep price within realistic bounds (±2% from base)
        min_price = base_price * 0.98
        max_price = base_price * 1.02
        new_price = max(min_price, min(max_price, new_price))
        
        # Previous close (from base)
        prev_close = TestDataFactory.BASE_PRICES[symbol]
        change = round(new_price - prev_close, 2)
        change_percent = round((change / prev_close * 100) if prev_close else 0, 2)
        
        # Update OHLC (high/low expand as price moves)
        open_price = current_price
        high_price = max(current_price, new_price) * (1 + random.uniform(0, 0.002))
        low_price = min(current_price, new_price) * (1 - random.uniform(0, 0.002))
        
        # Volume with realistic variations
        vol_min, vol_max = TestDataFactory.VOLUME_RANGES.get(symbol, (100000, 500000))
        base_volume = (vol_min + vol_max) / 2
        volume = int(base_volume * random.uniform(0.7, 1.3))
        
        # OI variations
        oi_min, oi_max = TestDataFactory.OI_RANGES.get(symbol, (1000000, 10000000))
        oi = random.randint(oi_min, oi_max)
        call_oi = int(oi * random.uniform(0.4, 0.6))
        put_oi = oi - call_oi
        pcr = round(put_oi / call_oi, 2) if call_oi > 0 else 1.0
        
        # Determine trend
        if change_percent > 0.1:
            trend = "bullish"
        elif change_percent < -0.1:
            trend = "bearish"
        else:
            trend = "neutral"
        
        # Update cached price
        self._last_prices[symbol] = round(new_price, 2)
        
        return {
            "symbol": symbol,
            "price": round(new_price, 2),
            "change": change,
            "changePercent": change_percent,
            "high": round(high_price, 2),
            "low": round(low_price, 2),
            "open": round(open_price, 2),
            "close": round(prev_close, 2),  # Previous close
            "volume": volume,
            "oi": oi,
            "pcr": pcr,
            "callOI": call_oi,
            "putOI": put_oi,
            "trend": trend,
            "timestamp": datetime.now(IST).isoformat(),
            "status": get_market_status(),  # Market status based on current time
            "analysis": {
                "mock_data": True,
                "note": "This is simulated data. Connect Zerodha for live data."
            }
        }
    
    @property
    def is_connected(self) -> bool:
        """Mock feed is always 'connected' while running."""
        return self.running
