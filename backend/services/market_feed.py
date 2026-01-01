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

# Market hours (IST) - Detailed phases
PRE_OPEN_START = time(9, 0)      # 9:00 AM - Pre-open session starts
PRE_OPEN_END = time(9, 15)       # 9:15 AM - Pre-open session ends
MARKET_OPEN = time(9, 15)        # 9:15 AM - Live trading starts
MARKET_CLOSE = time(15, 30)      # 3:30 PM - Market closes

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


def get_market_status() -> str:
    """Get current market status with detailed phases.
    
    Returns:
        - PRE_OPEN: Pre-open session (9:00-9:15 AM) - auction matching
        - LIVE: Live market trading (9:15 AM - 3:30 PM)
        - CLOSED: Market closed (after 3:30 PM, weekends, holidays)
    
    Note: Data should flow even during PRE_OPEN to show auction prices.
    """
    now = datetime.now(IST)
    current_time = now.time()
    
    # Check if weekend (Saturday=5, Sunday=6)
    if now.weekday() >= 5:
        return "CLOSED"
    
    # Check if holiday
    date_str = now.strftime("%Y-%m-%d")
    if date_str in NSE_HOLIDAYS_2025:
        return "CLOSED"
    
    # Check market phases
    # 🔥 FIX: Use <= for PRE_OPEN_END to handle exactly 9:15:00
    if PRE_OPEN_START <= current_time < PRE_OPEN_END:
        return "PRE_OPEN"
    
    # 🔥 FIX: Market is LIVE from exactly 9:15:00 onwards
    if MARKET_OPEN <= current_time <= MARKET_CLOSE:
        return "LIVE"
    
    return "CLOSED"


def is_market_open() -> bool:
    """Check if market is open (includes PRE_OPEN and LIVE).
    
    Returns True during both pre-open (9:00-9:15) and live trading (9:15-15:30).
    This ensures data continues to flow during auction period.
    """
    status = get_market_status()
    return status in ("PRE_OPEN", "LIVE")


# Instrument token to symbol mapping
TOKEN_SYMBOL_MAP = {
    settings.nifty_token: "NIFTY",
    settings.banknifty_token: "BANKNIFTY", 
    settings.sensex_token: "SENSEX"
}

# Previous close prices - ONLY from live Zerodha tick data
PREV_CLOSE = {}

# Quote volumes - Preserved for indices (since tick volume_traded is 0 for indices)
QUOTE_VOLUMES = {}


class MarketFeedService:
    """Service to handle Zerodha KiteTicker market data feed."""
    
    def __init__(self, cache: CacheService, ws_manager: ConnectionManager):
        self.cache = cache
        self.ws_manager = ws_manager
        self.kws: Optional[KiteTicker] = None
        self.running = False
        self.last_prices: Dict[str, float] = {}
        self.last_oi: Dict[str, int] = {}  # Track last OI for change calculation
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
        
        # Determine trend
        if change > 0:
            trend = "bullish"
        elif change < 0:
            trend = "bearish"
        else:
            trend = "neutral"
        
        # Get tick volume (usually 0 for indices)
        tick_volume = tick.get("volume_traded", 0)
        
        # 🔥 FIX: For indices, use preserved quote volume if tick volume is 0
        volume = tick_volume
        if tick_volume == 0 and symbol in ["NIFTY", "BANKNIFTY", "SENSEX"]:
            # Use quote volume from cache (set during startup/refresh)
            volume = QUOTE_VOLUMES.get(symbol, 0)
        
        return {
            "symbol": symbol,
            "price": round(ltp, 2),
            "change": round(change, 2),
            "changePercent": round(change_percent, 2),
            "high": round(tick.get("ohlc", {}).get("high", ltp), 2),
            "low": round(tick.get("ohlc", {}).get("low", ltp), 2),
            "open": round(tick.get("ohlc", {}).get("open", ltp), 2),
            "close": round(tick.get("ohlc", {}).get("close", prev_close), 2),
            "volume": volume,  # ✅ Uses quote volume for indices
            "oi": tick.get("oi", 0),
            "pcr": 0.0,      # Will be updated by PCR service
            "callOI": 0,     # Will be updated by PCR service
            "putOI": 0,      # Will be updated by PCR service
            "trend": trend,
            "timestamp": datetime.now(IST).isoformat(),
            "status": get_market_status()  # PRE_OPEN, LIVE, or CLOSED
        }
    
    def _on_ticks(self, ws, ticks):
        """Callback when ticks are received (runs in KiteTicker thread)."""
        for tick in ticks:
            try:
                data = self._normalize_tick(tick)
                symbol = data["symbol"]
                
                # Log first tick received for each symbol
                if symbol not in self.last_prices:
                    print(f"🟢 First tick received for {symbol}: Price={data['price']}, Change={data['changePercent']}%")
                
                # 🔥 FIX: Process ticks during PRE_OPEN even if price hasn't changed
                # During auction period (9:00-9:15), prices may not change often
                # but we need to keep UI updated with market status
                market_status = get_market_status()
                price_changed = self.last_prices.get(symbol) != data["price"]
                is_pre_open = market_status == "PRE_OPEN"
                
                # Process tick if: price changed OR during PRE_OPEN period
                if price_changed or is_pre_open:
                    self.last_prices[symbol] = data["price"]
                    # Put tick in queue for async processing
                    self._tick_queue.put(data)
                    
                    if is_pre_open and not price_changed:
                        print(f"🔔 PRE_OPEN tick: {symbol} @ ₹{data['price']} (auction period)")
                    
            except Exception as e:
                print(f"❌ Error processing tick: {e}")
                import traceback
                traceback.print_exc()
    
    async def _update_and_broadcast(self, data: Dict[str, Any]):
        """Update cache and broadcast to WebSocket clients."""
        symbol = data["symbol"]
        
        # 🔥 FIX: Recalculate market status for every broadcast to ensure real-time updates
        # This prevents stale status from being cached, especially during 9:15 AM transition
        data["status"] = get_market_status()
        
        # ✅ DEBUG: Log every broadcast with current status
        print(f"[BROADCAST] {symbol}: ₹{data['price']} ({data['changePercent']:+.2f}%) [{data['status']}] → {self.ws_manager.connection_count} clients")
        
        # SMART: Fetch PCR with staggered timing to avoid rate limits
        try:
            pcr_service = get_pcr_service()
            
            # Add small delay based on symbol to stagger requests
            import time
            current_second = int(time.time()) % 30
            stagger_map = {"NIFTY": 0, "BANKNIFTY": 10, "SENSEX": 20}
            expected_second = stagger_map.get(symbol, 0)
            
            # Only fetch if it's this symbol's turn (within 5 second window)
            if abs(current_second - expected_second) <= 5 or current_second < 5:
                pcr_data = await pcr_service.get_pcr_data(symbol)
            else:
                # Use cached data if not this symbol's turn
                from services.pcr_service import _PCR_CACHE
                pcr_data = _PCR_CACHE.get(symbol, {})
                if not pcr_data:
                    pcr_data = await pcr_service.get_pcr_data(symbol)
            data["pcr"] = pcr_data.get("pcr", 0.0)
            data["callOI"] = pcr_data.get("callOI", 0)
            data["putOI"] = pcr_data.get("putOI", 0)
            current_oi = pcr_data.get("oi", data.get("oi", 0))
            data["oi"] = current_oi
            
            # Calculate OI Change
            prev_oi = self.last_oi.get(symbol, current_oi)
            oi_change = current_oi - prev_oi
            oi_change_percent = (oi_change / prev_oi * 100) if prev_oi > 0 else 0
            data["oi_change"] = round(oi_change_percent, 2)
            self.last_oi[symbol] = current_oi
            
            # Debug PCR updates
            if data["pcr"] > 0:
                print(f"[PCR UPDATE] {symbol}: PCR={data['pcr']:.2f}, CallOI={data['callOI']:,}, PutOI={data['putOI']:,}, OI Change={data['oi_change']:.2f}%")
            else:
                print(f"[WARN] WARNING: PCR is 0 for {symbol} - likely fetch failed or token expired")
        except Exception as e:
            print(f"[ERROR] PCR fetch FAILED for {symbol}: {type(e).__name__}: {e}")
            data["pcr"] = 0.0
            data["callOI"] = 0
            data["putOI"] = 0
            data["oi_change"] = 0.0
        
        # Store historical candle data for analysis (1-minute candles)
        candle_key = f"analysis_candles:{data['symbol']}"
        candle_data = {
            'timestamp': data['timestamp'],
            'open': data['open'],
            'high': data['high'],
            'low': data['low'],
            'close': data['price'],
            'volume': data['volume']
        }
        
        # Add candle to list (newest first) and keep last 100 candles
        import json
        await self.cache.lpush(candle_key, json.dumps(candle_data))
        await self.cache.ltrim(candle_key, 0, 99)  # Keep 100 candles
        
        # Generate instant analysis for this tick
        try:
            from services.instant_analysis import InstantSignal
            print(f"🔍 Attempting analysis for {data['symbol']} - Price: {data.get('price', 'NO PRICE')}")
            analysis_result = InstantSignal.analyze_tick(data)
            if analysis_result:
                data["analysis"] = analysis_result  # Add analysis to tick data
                print(f"✅ Analysis added for {data['symbol']}: {list(analysis_result.keys())}")
            else:
                print(f"⚠️ Analysis returned None for {data['symbol']}")
                data["analysis"] = None
        except Exception as e:
            print(f"❌ Instant analysis FAILED for {data['symbol']}: {e}")
            import traceback
            traceback.print_exc()
            data["analysis"] = None
        
        # ✅ CRITICAL FIX: Store data WITH analysis to cache (after analysis is added)
        await self.cache.set_market_data(data["symbol"], data)
        
        # Broadcast to WebSocket with analysis included
        await self.ws_manager.broadcast({
            "type": "tick",
            "data": data
        })
    
    async def _fetch_and_cache_last_data(self):
        """Fetch last traded data from Zerodha and cache it - works even when market is closed."""
        try:
            from kiteconnect import KiteConnect
            print("📊 Fetching last traded data from Zerodha...")
            
            kite = KiteConnect(api_key=settings.zerodha_api_key)
            kite.set_access_token(settings.zerodha_access_token)
            
            # Index symbols for quote API (for price)
            index_symbols = {
                settings.nifty_token: "NSE:NIFTY 50",
                settings.banknifty_token: "NSE:NIFTY BANK",
                settings.sensex_token: "BSE:SENSEX"
            }
            
            # Futures instrument tokens for volume data (indices don't have volume, but futures do!)
            futures_tokens = {
                "NIFTY": settings.nifty_fut_token,
                "BANKNIFTY": settings.banknifty_fut_token,
                "SENSEX": settings.sensex_fut_token
            }
            
            # Fetch quotes for spot prices (works even when market is closed)
            quotes = kite.quote(list(index_symbols.values()))
            
            # 🔥 Fetch futures quotes for volume data
            # Need to get trading symbols from instruments first, then fetch quotes
            futures_quotes = {}
            try:
                # Fetch all NFO instruments to get trading symbols
                print("📥 Fetching instruments to find futures trading symbols...")
                nfo_instruments = kite.instruments("NFO")
                bfo_instruments = kite.instruments("BFO") if "SENSEX" in futures_tokens else []
                
                # Map tokens to trading symbols
                token_to_symbol = {}
                for inst in nfo_instruments + bfo_instruments:
                    token_to_symbol[inst['instrument_token']] = {
                        'tradingsymbol': inst['tradingsymbol'],
                        'exchange': inst['exchange']
                    }
                
                # Build quote keys using trading symbols
                quote_keys = []
                for symbol, token in futures_tokens.items():
                    if token and token in token_to_symbol:
                        inst = token_to_symbol[token]
                        quote_key = f"{inst['exchange']}:{inst['tradingsymbol']}"
                        quote_keys.append(quote_key)
                        print(f"🎯 {symbol} futures: {quote_key} (token={token})")
                
                # Fetch quotes
                if quote_keys:
                    futures_quotes = kite.quote(quote_keys)
                    print(f"📊 Fetched futures quotes: {list(futures_quotes.keys())}")
                else:
                    print("⚠️ No valid futures trading symbols found")
                    
            except Exception as e:
                print(f"❌ Error fetching futures quotes: {e}")
                futures_quotes = {}
            
            
            # Process and cache each symbol's data
            for token, symbol_name in TOKEN_SYMBOL_MAP.items():
                idx_symbol = index_symbols.get(token)
                if idx_symbol and idx_symbol in quotes:
                    quote = quotes[idx_symbol]
                    ohlc = quote['ohlc']
                    ltp = quote['last_price']
                    prev_close = ohlc['close']
                    
                    # Calculate change
                    change = ltp - prev_close
                    change_percent = (change / prev_close * 100) if prev_close else 0
                    
                    # Determine trend
                    if change > 0:
                        trend = "bullish"
                    elif change < 0:
                        trend = "bearish"
                    else:
                        trend = "neutral"
                    
                    # 🔥 FIX: Get volume from futures (indices don't have spot volume)
                    volume = 0
                    matched_key = None
                    
                    # CRITICAL: Use exact symbol matching with word boundaries
                    # "NIFTY" should NOT match "BANKNIFTY", "FINNIFTY", etc.
                    # Look for "NFO:NIFTY25" or "BFO:SENSEX26" at the START after exchange prefix
                    for fut_key, fut_quote in futures_quotes.items():
                        # Extract symbol after exchange (NFO: or BFO:)
                        if ':' in fut_key:
                            exchange_symbol = fut_key.split(':', 1)[1]  # e.g., "NIFTY25DECFUT" or "SENSEX26JANFUT"
                            
                            # Exact match: symbol must be at START of trading symbol
                            # Check for both 25 (Dec 2025) and 26 (Jan 2026+) contracts
                            # NIFTY25 matches "NIFTY25DECFUT" but NOT "BANKNIFTY25DECFUT"
                            # SENSEX26 matches "SENSEX26JANFUT"
                            if (exchange_symbol.startswith(f"{symbol_name}25") or 
                                exchange_symbol.startswith(f"{symbol_name}26")) and 'FUT' in exchange_symbol:
                                volume = fut_quote.get('volume', 0)
                                matched_key = fut_key
                                print(f"💹 {symbol_name} futures volume from {fut_key}: {volume:,}")
                                break
                    
                    # Log if no futures contract matched
                    if volume == 0 and symbol_name == "SENSEX":
                        print(f"⚠️ SENSEX futures volume not found - check if BFO:SENSEX26JANFUT is in quotes")
                        print(f"   Configured token: {futures_tokens.get('sensex_fut_token', 'NOT SET')}")
                    
                    if volume == 0 and not matched_key and symbol_name != "SENSEX":
                        print(f"⚠️ No futures contract found for {symbol_name}")
                        print(f"   Expected: {symbol_name}25DECFUT or {symbol_name}26JANFUT")
                    
                    # Store volume in QUOTE_VOLUMES cache for later use
                    QUOTE_VOLUMES[symbol_name] = volume
                    print(f"💾 Stored futures volume for {symbol_name}: {volume:,}")
                    
                    # Create normalized data
                    data = {
                        "symbol": symbol_name,
                        "price": round(ltp, 2),
                        "change": round(change, 2),
                        "changePercent": round(change_percent, 2),
                        "high": round(ohlc['high'], 2),
                        "low": round(ohlc['low'], 2),
                        "open": round(ohlc['open'], 2),
                        "close": round(prev_close, 2),
                        "volume": volume,  # ✅ From futures, not spot!
                        "oi": quote.get('oi', 0),
                        "pcr": 0.0,  # Will be updated by PCR service
                        "callOI": 0,
                        "putOI": 0,
                        "trend": trend,
                        "timestamp": datetime.now(IST).isoformat(),
                        "status": get_market_status()
                    }
                    
                    # Update PREV_CLOSE
                    PREV_CLOSE[symbol_name] = prev_close
                    
                    # Cache the data
                    await self.cache.set_market_data(symbol_name, data)
                    
                    print(f"✅ {symbol_name}: ₹{ltp:,.2f} ({change_percent:+.2f}%) - Last traded data cached")
            
            print(f"✅ All last traded data cached and ready for display")
            return True
            
        except Exception as e:
            print(f"❌ Failed to fetch last traded data: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def _on_connect(self, ws, response):
        """Callback when connected to Zerodha."""
        print("✅ Connected to Zerodha KiteTicker")
        print(f"📊 Connection response: {response}")
        
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
            print(f"📊 Fetching quotes for: {list(index_symbols.values())}")
            quotes = kite.quote(list(index_symbols.values()))
            # Update PREV_CLOSE with real values
            for token, symbol in token_to_symbol.items():
                idx_symbol = index_symbols.get(token)
                if idx_symbol and idx_symbol in quotes:
                    close_val = quotes[idx_symbol]['ohlc']['close']
                    PREV_CLOSE[symbol] = close_val
                    print(f"💹 {symbol} previous close: {close_val}")
            print(f"🔄 Updated PREV_CLOSE: {PREV_CLOSE}")
        except Exception as e:
            print(f"⚠️ Failed to fetch real previous close: {e}")
            
        # Subscribe to instrument tokens
        tokens = list(TOKEN_SYMBOL_MAP.keys())
        print(f"📊 Subscribing to tokens: {tokens}")
        ws.subscribe(tokens)
        ws.set_mode(ws.MODE_FULL, tokens)
        print(f"📊 Subscribed to: {list(TOKEN_SYMBOL_MAP.values())}")
        print("✅ Market feed is now LIVE - Waiting for ticks...")
    
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
    
    async def _fetch_and_cache_last_data_safe(self):
        """Safely fetch data in background without blocking startup."""
        try:
            print("🔄 Fetching last available market data in background...")
            data_cached = await self._fetch_and_cache_last_data()
            
            if data_cached:
                print("✅ Last market data cached successfully")
                print("   → UI will show last traded prices even when market is closed")
            else:
                print("⚠️ Could not fetch last market data")
        except Exception as e:
            print(f"⚠️ Background data fetch failed: {e}")
            print("   → Will continue with live WebSocket data")
    
    async def start(self):
        """Start the market feed service."""
        self.running = True
        self._loop = asyncio.get_event_loop()
        
        # Check if we have valid credentials
        if not settings.zerodha_api_key or not settings.zerodha_access_token:
            print("❌ Zerodha credentials not configured")
            print("⚠️ Set ZERODHA_API_KEY and ZERODHA_ACCESS_TOKEN in .env file")
            return
        
        # ASYNC: Fetch last traded data in background (don't block startup)
        print("🔄 Starting background data fetch (non-blocking)...")
        asyncio.create_task(self._fetch_and_cache_last_data_safe())
        
        try:
            # Initialize KiteTicker
            print("🔧 Initializing KiteTicker...")
            
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
            
            # Connect (non-blocking in thread)
            print("🔗 Connecting to Zerodha KiteTicker...")
            self.kws.connect(threaded=True)
            print("✅ Connection initiated (running in background)")
            
            # Process tick queue in async loop
            last_refresh_time = datetime.now(IST)
            
            while self.running:
                # Refresh last traded data every 5 minutes (keeps data fresh even after market)
                current_time = datetime.now(IST)
                if (current_time - last_refresh_time).total_seconds() > 300:  # 5 minutes
                    print("🔄 Refreshing last market data...")
                    await self._fetch_and_cache_last_data()
                    last_refresh_time = current_time
                
                # Process any pending ticks from the queue
                while not self._tick_queue.empty():
                    try:
                        data = self._tick_queue.get_nowait()
                        await self._update_and_broadcast(data)
                    except Exception as e:
                        print(f"❌ Error broadcasting tick: {e}")
                
                await asyncio.sleep(0.1)  # Small sleep to prevent busy loop
                
        except Exception as e:
            error_msg = str(e)
            print(f"❌ Market feed error: {error_msg}")
            
            # Provide helpful error messages
            if "TokenError" in error_msg or "token" in error_msg.lower():
                print("⚠️ ACCESS TOKEN ERROR - Token may be expired or invalid")
                print("💡 Generate new token: https://kite.trade/connect/login?api_key=YOUR_API_KEY")
            elif "connection" in error_msg.lower():
                print("⚠️ CONNECTION ERROR - Check internet connection")
            elif "market" in error_msg.lower():
                print("⚠️ Market may be closed (9:15 AM - 3:30 PM IST)")
            
            await self._wait_and_retry()
    
    async def _wait_and_retry(self):
        """Wait and retry connection."""
        from config import get_settings
        settings = get_settings()
        retry_interval = settings.market_feed_retry_interval
        print(f"⏰ Will retry connection in {retry_interval} seconds...")
        print("💡 TIP: Make sure market is open (9:15 AM - 3:30 PM IST on trading days)")
        print("💡 TIP: Check your access token is valid (expires daily)")
        await asyncio.sleep(retry_interval)
        
        if self.running:
            print("🔄 Retrying Zerodha connection now...")
            # Restart the connection attempt
            try:
                if self.kws:
                    self.kws.close()
                    self.kws = None
                    await asyncio.sleep(2)
                
                # Re-initialize connection
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
                
                # Connect
                print("🔗 Attempting reconnection to Zerodha KiteTicker...")
                self.kws.connect(threaded=True)
                
                # Process tick queue
                while self.running:
                    while not self._tick_queue.empty():
                        try:
                            data = self._tick_queue.get_nowait()
                            await self._update_and_broadcast(data)
                        except Exception as e:
                            print(f"❌ Error broadcasting tick: {e}")
                    await asyncio.sleep(0.1)
                    
            except Exception as e:
                print(f"❌ Reconnection failed: {e}")
                # Try again
                await self._wait_and_retry()
    
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
