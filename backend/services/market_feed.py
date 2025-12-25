"""Zerodha KiteTicker market feed service."""
import asyncio
import threading
from datetime import datetime, time
from typing import Dict, Any, Optional
from queue import Queue
from kiteconnect import KiteTicker
import pytz

from config import get_settings
from services.cache import CacheService
from services.websocket_manager import ConnectionManager
from services.pcr_service import get_pcr_service

settings = get_settings()

# Indian timezone
IST = pytz.timezone('Asia/Kolkata')

# Market hours (IST)
MARKET_OPEN = time(9, 15)   # 9:15 AM
MARKET_CLOSE = time(15, 30) # 3:30 PM

# NSE Holidays 2025 (add more as needed)
NSE_HOLIDAYS_2025 = {
    "2025-01-26",  # Republic Day
    "2025-02-26",  # Maha Shivaratri
    "2025-03-14",  # Holi
    "2025-03-31",  # Id-Ul-Fitr
    "2025-04-10",  # Shri Mahavir Jayanti
    "2025-04-14",  # Dr. Ambedkar Jayanti
    "2025-04-18",  # Good Friday
    "2025-05-01",  # Maharashtra Day
    "2025-06-07",  # Bakri Id
    "2025-08-15",  # Independence Day
    "2025-08-27",  # Ganesh Chaturthi
    "2025-10-02",  # Mahatma Gandhi Jayanti
    "2025-10-21",  # Diwali Laxmi Pujan
    "2025-10-22",  # Diwali Balipratipada
    "2025-11-05",  # Gurunanak Jayanti
    "2025-12-25",  # Christmas
}


def is_market_open() -> bool:
    """Check if Indian stock market is currently open."""
    now = datetime.now(IST)
    
    # Check if weekend (Saturday=5, Sunday=6)
    if now.weekday() >= 5:
        return False
    
    # Check if holiday
    date_str = now.strftime("%Y-%m-%d")
    if date_str in NSE_HOLIDAYS_2025:
        return False
    
    # Check if within market hours
    current_time = now.time()
    if MARKET_OPEN <= current_time <= MARKET_CLOSE:
        return True
    
    return False


def get_market_status() -> str:
    """Get current market status: LIVE or OFFLINE."""
    return "LIVE" if is_market_open() else "OFFLINE"


# Instrument token to symbol mapping
TOKEN_SYMBOL_MAP = {
    settings.nifty_token: "NIFTY",
    settings.banknifty_token: "BANKNIFTY", 
    settings.sensex_token: "SENSEX"
}

# Previous close prices (fallback values - actual values come from tick data)
PREV_CLOSE = {
    "NIFTY": 24150.0,
    "BANKNIFTY": 52000.0,
    "SENSEX": 79800.0
}


class MarketFeedService:
    """Service to handle Zerodha KiteTicker market data feed."""
    
    def __init__(self, cache: CacheService, ws_manager: ConnectionManager):
        self.cache = cache
        self.ws_manager = ws_manager
        self.kws: Optional[KiteTicker] = None
        self.running = False
        self.last_prices: Dict[str, float] = {}
        self._tick_queue: Queue = Queue()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
    
    def _normalize_tick(self, tick: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize Zerodha tick data to our format."""
        token = tick.get("instrument_token")
        symbol = TOKEN_SYMBOL_MAP.get(token, "UNKNOWN")
        ltp = tick.get("last_price", 0)
        # Use ohlc.close from tick data (actual previous day close) instead of hardcoded values
        prev_close = tick.get("ohlc", {}).get("close") or PREV_CLOSE.get(symbol, ltp)
        change = ltp - prev_close
        change_percent = (change / prev_close * 100) if prev_close else 0
        # Debug logging for BANKNIFTY
        if symbol == "BANKNIFTY":
            print(f"[BANKNIFTY DEBUG] token={token}, ltp={ltp}, prev_close={prev_close}, change={change}, change_percent={change_percent}")
            print(f"[BANKNIFTY DEBUG] tick: {tick}")
        # Determine trend
        if change > 0:
            trend = "bullish"
        elif change < 0:
            trend = "bearish"
        else:
            trend = "neutral"
        return {
            "symbol": symbol,
            "price": round(ltp, 2),
            "change": round(change, 2),
            "changePercent": round(change_percent, 2),
            "high": round(tick.get("ohlc", {}).get("high", ltp), 2),
            "low": round(tick.get("ohlc", {}).get("low", ltp), 2),
            "open": round(tick.get("ohlc", {}).get("open", ltp), 2),
            "close": round(tick.get("ohlc", {}).get("close", prev_close), 2),
            "volume": tick.get("volume_traded", 0),
            "oi": tick.get("oi", 0),
            "pcr": 0.0,      # Will be updated by PCR service
            "callOI": 0,     # Will be updated by PCR service
            "putOI": 0,      # Will be updated by PCR service
            "trend": trend,
            "timestamp": datetime.now(IST).isoformat(),
            "status": get_market_status()
        }
    
    def _on_ticks(self, ws, ticks):
        """Callback when ticks are received (runs in KiteTicker thread)."""
        for tick in ticks:
            try:
                data = self._normalize_tick(tick)
                symbol = data["symbol"]
                
                # Only process if price changed
                if self.last_prices.get(symbol) != data["price"]:
                    self.last_prices[symbol] = data["price"]
                    # Put tick in queue for async processing
                    self._tick_queue.put(data)
                    
            except Exception as e:
                print(f"❌ Error processing tick: {e}")
    
    async def _update_and_broadcast(self, data: Dict[str, Any]):
        """Update cache and broadcast to WebSocket clients."""
        # Fetch PCR data
        try:
            pcr_service = get_pcr_service()
            pcr_data = await pcr_service.get_pcr_data(data["symbol"])
            data["pcr"] = pcr_data.get("pcr", 0.0)
            data["callOI"] = pcr_data.get("callOI", 0)
            data["putOI"] = pcr_data.get("putOI", 0)
            data["oi"] = pcr_data.get("oi", data.get("oi", 0))
        except Exception as e:
            print(f"⚠️ PCR fetch failed for {data['symbol']}: {e}")
        
        await self.cache.set_market_data(data["symbol"], data)
        await self.ws_manager.broadcast({
            "type": "tick",
            "data": data
        })
    
    def _on_connect(self, ws, response):
        """Callback when connected to Zerodha."""
        print("✅ Connected to Zerodha KiteTicker")
        # Fetch real previous close prices using KiteConnect
        try:
            from kiteconnect import KiteConnect
            kite = KiteConnect(api_key=settings.zerodha_api_key)
            kite.set_access_token(settings.zerodha_access_token)
            tokens = list(TOKEN_SYMBOL_MAP.keys())
            # Map tokens to tradingsymbols for quote API
            token_to_symbol = TOKEN_SYMBOL_MAP
            # Zerodha quote API expects tradingsymbols with exchange, but for indices, use index names
            index_symbols = {
                settings.nifty_token: "NSE:NIFTY 50",
                settings.banknifty_token: "NSE:BANKNIFTY",
                settings.sensex_token: "BSE:SENSEX"
            }
            quotes = kite.quote(list(index_symbols.values()))
            # Update PREV_CLOSE with real values
            for token, symbol in token_to_symbol.items():
                idx_symbol = index_symbols.get(token)
                if idx_symbol and idx_symbol in quotes:
                    close_val = quotes[idx_symbol]['ohlc']['close']
                    PREV_CLOSE[symbol] = close_val
            print(f"🔄 Updated PREV_CLOSE: {PREV_CLOSE}")
        except Exception as e:
            print(f"⚠️ Failed to fetch real previous close: {e}")
        # Subscribe to instrument tokens
        tokens = list(TOKEN_SYMBOL_MAP.keys())
        ws.subscribe(tokens)
        ws.set_mode(ws.MODE_FULL, tokens)
        print(f"📊 Subscribed to: {list(TOKEN_SYMBOL_MAP.values())}")
    
    def _on_close(self, ws, code, reason):
        """Callback when connection is closed."""
        print(f"🔌 Zerodha connection closed: {code} - {reason}")
    
    def _on_error(self, ws, code, reason):
        """Callback on error."""
        print(f"❌ Zerodha error: {code} - {reason}")
    
    def _on_reconnect(self, ws, attempts_count):
        """Callback on reconnect attempt."""
        print(f"🔄 Reconnecting... Attempt {attempts_count}")
    
    def _on_noreconnect(self, ws):
        """Callback when reconnect fails."""
        print("❌ Reconnect failed")
    
    async def start(self):
        """Start the market feed service."""
        self.running = True
        self._loop = asyncio.get_event_loop()
        
        # Check if we have valid credentials
        if not settings.zerodha_api_key or not settings.zerodha_access_token:
            print("⚠️ Zerodha credentials not configured")
            print("📝 Starting in DEMO mode with simulated data")
            await self._run_demo_mode()
            return
        
        try:
            # Initialize KiteTicker
            self.kws = KiteTicker(
                settings.zerodha_api_key,
                settings.zerodha_access_token
            )
            
            # Assign callbacks
            self.kws.on_ticks = self._on_ticks
            self.kws.on_connect = self._on_connect
            self.kws.on_close = self._on_close
            self.kws.on_error = self._on_error
            self.kws.on_reconnect = self._on_reconnect
            self.kws.on_noreconnect = self._on_noreconnect
            
            # Connect (blocking call in thread)
            print("🔗 Connecting to Zerodha KiteTicker...")
            self.kws.connect(threaded=True)
            
            # Process tick queue in async loop
            while self.running:
                # Process any pending ticks from the queue
                while not self._tick_queue.empty():
                    try:
                        data = self._tick_queue.get_nowait()
                        await self._update_and_broadcast(data)
                    except Exception as e:
                        print(f"❌ Error broadcasting tick: {e}")
                
                await asyncio.sleep(0.1)  # Small sleep to prevent busy loop
                
        except Exception as e:
            print(f"❌ Market feed error: {e}")
            print("⚠️ Live data unavailable - showing last cached data")
            # Don't run demo mode - just wait and retry connection
            await self._wait_and_retry()
    
    async def _run_demo_mode(self):
        """Run in demo mode with simulated market data."""
        import random
        
        print("🎮 Demo mode active - Simulating market data")
        
        # Base prices and demo PCR
        prices = {
            "NIFTY": 24150.50,
            "BANKNIFTY": 52340.75,
            "SENSEX": 79850.25
        }
        demo_pcr = {
            "NIFTY": {"pcr": 0.95, "callOI": 12500000, "putOI": 11875000},
            "BANKNIFTY": {"pcr": 1.15, "callOI": 8500000, "putOI": 9775000},
            "SENSEX": {"pcr": 0.88, "callOI": 450000, "putOI": 396000},
        }
        
        while self.running:
            for symbol, base_price in prices.items():
                # Simulate price movement
                change_pct = random.uniform(-0.1, 0.1)
                prices[symbol] = base_price * (1 + change_pct / 100)
                
                prev_close = PREV_CLOSE.get(symbol, base_price)
                change = prices[symbol] - prev_close
                change_percent = (change / prev_close * 100)
                
                trend = "bullish" if change > 0 else "bearish" if change < 0 else "neutral"
                
                # Simulate PCR variation
                pcr_base = demo_pcr[symbol]
                pcr_var = random.uniform(-0.05, 0.05)
                
                data = {
                    "symbol": symbol,
                    "price": round(prices[symbol], 2),
                    "change": round(change, 2),
                    "changePercent": round(change_percent, 2),
                    "high": round(prices[symbol] * 1.005, 2),
                    "low": round(prices[symbol] * 0.995, 2),
                    "open": round(prev_close, 2),
                    "close": round(prev_close, 2),
                    "volume": random.randint(1000000, 5000000),
                    "oi": pcr_base["callOI"] + pcr_base["putOI"],
                    "pcr": round(pcr_base["pcr"] + pcr_var, 2),
                    "callOI": pcr_base["callOI"],
                    "putOI": pcr_base["putOI"],
                    "trend": trend,
                    "timestamp": datetime.now(IST).isoformat(),
                    "status": "DEMO"
                }
                
                await self.cache.set_market_data(symbol, data)
                await self.ws_manager.broadcast({
                    "type": "tick",
                    "data": data
                })
            
            await asyncio.sleep(1)  # Update every second
    
    async def _wait_and_retry(self):
        """Wait and retry connection instead of showing demo data."""
        retry_interval = 30  # seconds
        while self.running:
            print(f"🔄 Retrying Zerodha connection in {retry_interval} seconds...")
            await asyncio.sleep(retry_interval)
            try:
                await self.start()
                break
            except Exception as e:
                print(f"❌ Retry failed: {e}")
    
    async def stop(self):
        """Stop the market feed service."""
        self.running = False
        if self.kws:
            self.kws.close()
        print("🛑 Market feed stopped")
    
    async def reconnect_with_new_token(self, new_access_token: str):
        """Reconnect to Zerodha with new access token."""
        print(f"🔄 Reconnecting with new token: {new_access_token[:20]}...")
        
        # Stop current connection
        if self.kws:
            self.kws.close()
            self.running = False
            await asyncio.sleep(2)  # Wait for cleanup
        
        # Update settings
        settings.zerodha_access_token = new_access_token
        
        # Start new connection
        self.running = True
        asyncio.create_task(self.start())
        print("✅ Reconnection initiated with new token")
