"""
🔥 PRODUCTION MARKET FEED SERVICE
Integrates with ZerodhaWebSocketManager for bulletproof trading
"""

import asyncio
import threading
from datetime import datetime
from typing import Dict, Any, Optional
from queue import Queue
import pytz

from config import get_settings
from services.cache import CacheService
from services.websocket_manager import ConnectionManager
from services.zerodha_websocket_manager import ZerodhaWebSocketManager
from services.auth_state_machine import auth_state_manager
from config.market_session import get_market_session

settings = get_settings()
market_config = get_market_session()
IST = pytz.timezone(market_config.TIMEZONE)

# Instrument token to symbol mapping
TOKEN_SYMBOL_MAP = {
    settings.nifty_token: "NIFTY",
    settings.banknifty_token: "BANKNIFTY", 
    settings.sensex_token: "SENSEX"
}

class ProductionMarketFeedService:
    """Production-grade market feed service using ZerodhaWebSocketManager."""
    
    def __init__(self, cache: CacheService, ws_manager: ConnectionManager):
        self.cache = cache
        self.ws_manager = ws_manager
        self.zws_manager: Optional[ZerodhaWebSocketManager] = None
        self.running = False
        self.current_status = "OFFLINE"
        self.current_message = ""
        
        # Market data storage
        self.market_data: Dict[str, Dict] = {}
        
        # Async queues for processing
        self.tick_queue = Queue()
        self.processor_thread: Optional[threading.Thread] = None
        
        print("🚀 ProductionMarketFeedService initialized")

    async def start(self):
        """Start the production market feed service"""
        if self.running:
            print("⚠️ Market feed already running")
            return
            
        print("🔥 Starting Production Market Feed Service...")
        
        # Check authentication
        if not auth_state_manager.is_authenticated:
            print("❌ Not authenticated with Zerodha")
            await self._notify_status("ERROR", "Zerodha authentication required")
            return
            
        self.running = True
        
        try:
            # Initialize Zerodha WebSocket Manager
            instruments = [settings.nifty_token, settings.banknifty_token, settings.sensex_token]
            
            self.zws_manager = ZerodhaWebSocketManager(
                api_key=settings.zerodha_api_key,
                access_token=auth_state_manager.access_token,
                instruments=instruments
            )
            
            # Set callbacks
            self.zws_manager.set_callbacks(
                on_tick=self._on_tick,
                on_status=self._on_status_change
            )
            
            # Start tick processor thread
            self.processor_thread = threading.Thread(target=self._process_ticks, daemon=True)
            self.processor_thread.start()
            
            # Send initial snapshot
            await self._send_snapshot()
            
            # Start WebSocket in background thread (non-blocking)
            ws_thread = threading.Thread(target=self._start_websocket, daemon=True)
            ws_thread.start()
            
            print("✅ Production Market Feed Service started")
            
        except Exception as e:
            print(f"❌ Failed to start market feed: {e}")
            await self._notify_status("ERROR", f"Failed to start: {e}")
            self.running = False

    def _start_websocket(self):
        """Start WebSocket in separate thread"""
        try:
            if self.zws_manager:
                self.zws_manager.connect()  # This will auto-wait for market timing
        except Exception as e:
            print(f"❌ WebSocket connection failed: {e}")

    def _on_tick(self, ticks):
        """Handle incoming ticks from Zerodha WebSocket"""
        for tick in ticks:
            self.tick_queue.put(tick)

    def _on_status_change(self, status: str, message: str):
        """Handle WebSocket status changes"""
        self.current_status = status
        self.current_message = message
        
        # Create status message for frontend
        asyncio.create_task(self._notify_status(status, message))

    async def _notify_status(self, status: str, message: str):
        """Notify connected clients about status changes"""
        status_data = {
            "type": "status",
            "status": status,
            "message": message,
            "timestamp": datetime.now(IST).isoformat(),
        }
        await self.ws_manager.broadcast(status_data)

    def _process_ticks(self):
        """Process ticks in background thread"""
        while self.running:
            try:
                if not self.tick_queue.empty():
                    tick = self.tick_queue.get(timeout=1)
                    self._transform_and_broadcast_tick(tick)
            except:
                continue  # Keep processing

    def _transform_and_broadcast_tick(self, tick):
        """Transform Zerodha tick and broadcast to clients"""
        try:
            token = tick.get('instrument_token', 0)
            symbol = TOKEN_SYMBOL_MAP.get(token)
            
            if not symbol:
                return
                
            # Transform tick to our format
            transformed_tick = {
                "symbol": symbol,
                "price": tick.get('last_price', 0),
                "change": tick.get('change', 0),
                "changePercent": 0,  # Calculate below
                "high": tick.get('ohlc', {}).get('high', 0),
                "low": tick.get('ohlc', {}).get('low', 0),
                "open": tick.get('ohlc', {}).get('open', 0),
                "close": tick.get('ohlc', {}).get('close', 0),
                "volume": tick.get('volume_traded', 0),
                "oi": tick.get('oi', 0),
                "timestamp": datetime.now(IST).isoformat(),
                "status": self._get_market_status(),
            }
            
            # Calculate change percentage
            if transformed_tick["close"] > 0:
                transformed_tick["changePercent"] = (
                    transformed_tick["change"] / transformed_tick["close"]
                ) * 100
            
            # Update market data storage
            self.market_data[symbol] = transformed_tick
            
            # Broadcast to WebSocket clients
            message = {
                "type": "tick",
                "data": transformed_tick
            }
            asyncio.create_task(self.ws_manager.broadcast(message))
            
            # Cache the data
            asyncio.create_task(self._cache_tick(symbol, transformed_tick))
            
        except Exception as e:
            print(f"❌ Error processing tick: {e}")

    async def _cache_tick(self, symbol: str, tick_data: Dict):
        """Cache tick data for quick access"""
        try:
            await self.cache.set(f"tick:{symbol}", tick_data, expiry=300)  # 5 min expiry
        except Exception as e:
            print(f"⚠️ Cache error: {e}")

    async def _send_snapshot(self):
        """Send initial snapshot to new connections"""
        try:
            # Get cached data or send empty snapshot
            snapshot = {}
            for symbol in ["NIFTY", "BANKNIFTY", "SENSEX"]:
                cached_data = await self.cache.get(f"tick:{symbol}")
                if cached_data:
                    snapshot[symbol] = cached_data
                    
            if snapshot:
                message = {
                    "type": "snapshot",
                    "data": snapshot
                }
                await self.ws_manager.broadcast(message)
                print(f"📊 Sent snapshot with {len(snapshot)} symbols")
                
        except Exception as e:
            print(f"⚠️ Error sending snapshot: {e}")

    def _get_market_status(self) -> str:
        """Get current market status"""
        now = datetime.now(IST)
        current_time = now.time()
        
        # Weekend check
        if now.weekday() >= 5:
            return "CLOSED"
            
        # Market timing
        if market_config.PRE_OPEN_START <= current_time < market_config.PRE_OPEN_END:
            return "PRE_OPEN"
        elif market_config.MARKET_OPEN <= current_time <= market_config.MARKET_CLOSE:
            return "LIVE"
        else:
            return "CLOSED"

    async def stop(self):
        """Stop the market feed service"""
        print("🛑 Stopping Production Market Feed Service...")
        
        self.running = False
        
        # Stop WebSocket manager
        if self.zws_manager:
            self.zws_manager.disconnect()
            
        # Wait for processor thread to finish
        if self.processor_thread and self.processor_thread.is_alive():
            self.processor_thread.join(timeout=2)
            
        await self._notify_status("OFFLINE", "Market feed stopped")
        print("✅ Market feed stopped")

    async def force_reconnect(self):
        """Force WebSocket reconnection"""
        if self.zws_manager:
            self.zws_manager.force_reconnect()
            await self._notify_status("RECONNECTING", "Forcing reconnection...")

    def get_status(self) -> Dict:
        """Get current service status"""
        ws_status = self.zws_manager.get_status() if self.zws_manager else {}
        
        return {
            "service_running": self.running,
            "current_status": self.current_status,
            "current_message": self.current_message,
            "market_status": self._get_market_status(),
            "websocket_status": ws_status,
            "symbols_tracked": len(self.market_data),
            "authenticated": auth_state_manager.is_authenticated,
        }

    async def get_market_data(self) -> Dict:
        """Get current market data"""
        return self.market_data.copy()