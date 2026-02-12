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
from services.feed_watchdog import feed_watchdog
from services.auth_state_machine import auth_state_manager
from services.market_session_controller import market_session
from config.market_session import get_market_session
from config.nse_holidays import is_holiday, get_holiday_name

settings = get_settings()

# Load market session configuration (from environment, not hardcoded)
market_config = get_market_session()

# Indian timezone
IST = pytz.timezone(market_config.TIMEZONE)

# Market hours (IST) - Loaded from configuration
PRE_OPEN_START = market_config.PRE_OPEN_START
PRE_OPEN_END = market_config.PRE_OPEN_END
MARKET_OPEN = market_config.MARKET_OPEN
MARKET_CLOSE = market_config.MARKET_CLOSE


def get_market_status() -> str:
    """Get current market status with detailed phases.
    
    Returns:
        - PRE_OPEN: Pre-open session (9:00-9:07 AM) - auction matching
        - FREEZE: Price discovery freeze (9:07-9:15 AM) - no new ticks
        - LIVE: Live market trading (9:15 AM - 3:30 PM)
        - CLOSED: Market closed (after 3:30 PM, weekends, holidays)
    
    Note: During FREEZE period, cached data continues showing but no new updates.
    """
    now = datetime.now(IST)
    current_time = now.time()
    
    # Check if weekend (Saturday=5, Sunday=6)
    if now.weekday() in market_config.WEEKEND_DAYS:
        return "CLOSED"
    
    # Check if holiday (using centralized configuration)
    date_str = now.strftime("%Y-%m-%d")
    if is_holiday(date_str):
        return "CLOSED"
    
    # Check market phases
    # 🔥 FIX: Use <= for PRE_OPEN_END to handle exactly 9:15:00
    if PRE_OPEN_START <= current_time < PRE_OPEN_END:
        return "PRE_OPEN"
    
    # 🔥 NEW: FREEZE phase (9:07-9:15 AM) - order matching in progress
    # During this time, no new ticks are broadcast, cached data shows
    if PRE_OPEN_END <= current_time < MARKET_OPEN:
        return "FREEZE"
    
    # 🔥 FIX: Market is LIVE from exactly 9:15:00 onwards
    if MARKET_OPEN <= current_time <= MARKET_CLOSE:
        return "LIVE"
    
    return "CLOSED"


def is_market_open() -> bool:
    """Check if market phase is active (includes PRE_OPEN and FREEZE).
    
    Returns True during:
    - PRE_OPEN (9:00-9:07 AM) - auction matching phase
    - FREEZE (9:07-9:15 AM) - price discovery (ticks received but not broadcast)
    - LIVE (9:15-15:30) - normal trading
    
    Returns False during:
    - CLOSED (after 3:30 PM, weekends, holidays)
    
    This ensures we maintain WebSocket connection and receive ticks,
    but control when they're broadcast to frontend.
    """
    status = get_market_status()
    return status in ("PRE_OPEN", "FREEZE", "LIVE")


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
        self._is_connected: bool = False  # Track connection state
        self.last_prices: Dict[str, float] = {}
        self.last_oi: Dict[str, int] = {}  # Track last OI for change calculation
        self.last_update_time: Dict[str, float] = {}  # Track last update time per symbol
        self._tick_queue: Queue = Queue()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._consecutive_403_errors: int = 0  # Track repeated 403 errors
        self._last_connection_attempt: Optional[datetime] = None  # Track last retry
        self._retry_delay: int = 5  # Start with 5 seconds, exponential backoff
        self._using_rest_fallback: bool = False  # Flag for REST API fallback mode
    
    @property
    def is_connected(self) -> bool:
        """Check if WebSocket is connected and receiving data.
        
        Returns True only if:
        1. KiteTicker instance exists
        2. Running flag is True
        3. Not using REST fallback
        4. Has received at least one tick in the last 60 seconds
        """
        if not self.kws or not self.running or self._using_rest_fallback:
            return False
        
        # Check if we've received recent data
        if not self.last_update_time:
            return False
        
        import time
        current_time = time.time()
        most_recent_update = max(self.last_update_time.values()) if self.last_update_time else 0
        
        # Consider connected if we got data in the last 60 seconds
        return (current_time - most_recent_update) < 60
    
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
        
        # 🔥 CRITICAL: Extract previous day OHLC for pivot calculations
        # Zerodha provides these as separate top-level fields in the quote
        prev_day_high = tick.get("prev_day_high", None)
        prev_day_low = tick.get("prev_day_low", None)
        prev_day_close = tick.get("ohlc", {}).get("close", prev_close)  # Use ohlc close as prev close
        
        # Fallback to current day high/low if prev_day values not available
        # (This happens during market hours as Zerodha updates the fields)
        if prev_day_high is None:
            prev_day_high = tick.get("ohlc", {}).get("high", ltp)
        if prev_day_low is None:
            prev_day_low = tick.get("ohlc", {}).get("low", ltp)
        
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
            "status": get_market_status(),  # PRE_OPEN, LIVE, or CLOSED
            # 🔥 Previous day data for pivot calculations
            "prev_day_high": round(prev_day_high, 2) if prev_day_high else None,
            "prev_day_low": round(prev_day_low, 2) if prev_day_low else None,
            "prev_day_close": round(prev_day_close, 2) if prev_day_close else None
        }
    
    def _on_ticks(self, ws, ticks):
        """Callback when ticks are received (runs in KiteTicker thread)."""
        for tick in ticks:
            try:
                data = self._normalize_tick(tick)
                symbol = data["symbol"]
                
                # 🔥 CRITICAL: Notify watchdog of tick received
                feed_watchdog.on_tick(symbol)
                
                # 🟢 Mark auth as successful (token is working)
                auth_state_manager.mark_api_success()
                
                # Log first tick received for each symbol
                if symbol not in self.last_prices:
                    print(f"🟢 First tick received for {symbol}: Price={data['price']}, Change={data['changePercent']}%")
                
                # 🔥 CRITICAL FIX: Process ALL ticks during market hours
                # REMOVE rate limiting to ensure smooth 9:15 AM PRE_OPEN → LIVE transition
                # We need to update:
                # - PCR data (changes every few seconds)
                # - OI data (changes frequently)
                # - Volume data (changes every second)
                # - Market status (transitions at 9:15 AM, 3:30 PM) - CRITICAL!
                # - Timestamp (keeps data fresh)
                market_status = get_market_status()
                is_market_phase = market_status in ("PRE_OPEN", "FREEZE", "LIVE")
                
                # ⚡ INTELLIGENT RATE LIMITING: Allow bursts during critical transitions
                import time
                current_time = time.time()
                last_update = self.last_update_time.get(symbol, 0)
                time_since_last_update = current_time - last_update
                
                # Detect status changes (PRE_OPEN → FREEZE → LIVE transition)
                last_status = getattr(self, f'_last_status_{symbol}', None)
                status_changed = last_status != market_status
                if status_changed:
                    setattr(self, f'_last_status_{symbol}', market_status)
                    print(f"🔄 MARKET STATUS CHANGE: {symbol} {last_status} → {market_status}")
                
                # Process tick if:
                # 1. Market phase is open AND
                # 2. (Price changed OR 0.5 second elapsed OR status changed)
                # Using 0.5s instead of 1s for smoother transitions
                price_changed = self.last_prices.get(symbol) != data["price"]
                should_update = is_market_phase and (price_changed or time_since_last_update >= 0.5 or status_changed)
                
                if should_update:
                    self.last_prices[symbol] = data["price"]
                    self.last_update_time[symbol] = current_time
                    
                    # 🔥 NEW: Only broadcast if NOT in FREEZE period (9:07-9:15 AM)
                    # During FREEZE, update cache but don't broadcast to avoid confusing UI
                    if market_status != "FREEZE":
                        # Put tick in queue for async processing
                        self._tick_queue.put(data)
                    else:
                        # During FREEZE: Update cache silently, no UI broadcast
                        # This keeps cache fresh for when LIVE resumes
                        asyncio.create_task(self.cache.set_market_data(symbol, data))
                    
            except Exception as e:
                print(f"❌ Error processing tick: {e}")
                import traceback
                traceback.print_exc()
    
    async def _update_and_broadcast(self, data: Dict[str, Any]):
        """Update cache and broadcast to WebSocket clients."""
        symbol = data["symbol"]
        
        # 🔥 CRITICAL FIX: ALWAYS recalculate market status for EVERY broadcast
        # This prevents freezing at 9:15 AM PRE_OPEN → LIVE transition
        # Status MUST be fresh, never cached
        current_status = get_market_status()
        old_status = data.get("status", "UNKNOWN")
        data["status"] = current_status
        
        # 🔔 Alert on status change
        if old_status != current_status:
            print(f"\n{'='*80}")
            print(f"🔔 MARKET STATUS TRANSITION: {symbol}")
            print(f"   {old_status} → {current_status}")
            print(f"   Time: {datetime.now(IST).strftime('%H:%M:%S')}")
            print(f"{'='*80}\n")
        
        # Log broadcasts periodically (not every tick to reduce noise)
        # print(f"[BROADCAST] {symbol}: ₹{data['price']} ({data['changePercent']:+.2f}%) [{data['status']}]")
        
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
            
            # Debug PCR updates (reduced logging)
            # if data["pcr"] > 0:
            #     print(f"[PCR] {symbol}: PCR={data['pcr']:.2f}")
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
            from services.instant_analysis import InstantSignal, calculate_emas_from_cache, calculate_sar_from_cache, calculate_market_structure_from_cache
            
            # 🔥 CRITICAL: Calculate EMAs from cached candles before analysis
            data = await calculate_emas_from_cache(self.cache, data["symbol"], data)
            
            # 🔥 CRITICAL: Calculate real Parabolic SAR from cached candles
            data = await calculate_sar_from_cache(self.cache, data["symbol"], data)
            
            # 🔥 CRITICAL: Calculate market structure from cached candles
            market_structure = await calculate_market_structure_from_cache(self.cache, data["symbol"], data)
            data.update(market_structure)  # Merge market structure data into tick_data
            
            analysis_result = InstantSignal.analyze_tick(data)
            if analysis_result:
                data["analysis"] = analysis_result
                # Log only occasionally to reduce spam
                import time
                if int(time.time()) % 5 == 0:  # Log every 5 seconds for this symbol
                    print(f"✅ Analysis generated for {symbol}: signal={analysis_result.get('signal')}, confidence={analysis_result.get('confidence'):.0f}%")
            else:
                print(f"⚠️ Analysis returned None for {symbol}")
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
            from kiteconnect.exceptions import TokenException
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
                    
                    # 📡 BROADCAST when in REST fallback mode
                    if self._using_rest_fallback:
                        await self.ws_manager.broadcast({
                            "type": "tick",
                            "data": data
                        })
                    
                    print(f"✅ {symbol_name}: ₹{ltp:,.2f} ({change_percent:+.2f}%) - Last traded data cached")
            
            print(f"✅ All last traded data cached and ready for display")
            return True
            
        except TokenException as e:
            print("\n" + "="*80)
            print("🔴 ZERODHA TOKEN ERROR - ACCESS TOKEN HAS EXPIRED!")
            print("="*80)
            print(f"Error: {e}")
            print("\n💡 SOLUTION:")
            print("   1. Zerodha access tokens expire DAILY (every 24 hours)")
            print("   2. Generate a new token using one of these methods:\n")
            print("   METHOD A - Quick Token Fix Script:")
            print("      python quick_token_fix.py")
            print("\n   METHOD B - Manual Token Generation:")
            print("      Step 1: Open in browser:")
            print(f"              https://kite.zerodha.com/connect/login?api_key={settings.zerodha_api_key}")
            print("      Step 2: Login with your Zerodha credentials")
            print("      Step 3: Copy request_token from redirect URL")
            print("      Step 4: Run: python backend/get_token.py")
            print("      Step 5: Paste request_token and press Enter")
            print("\n   3. Token will be auto-saved to backend/.env")
            print("   4. Backend will auto-reconnect when token file changes")
            print("\n🔄 Waiting for new token... (watching .env file)")
            print("="*80 + "\n")
            return False
            
        except Exception as e:
            error_msg = str(e)
            print(f"❌ Failed to fetch last traded data: {error_msg}")
            
            # Provide context-specific error messages
            if "403" in error_msg or "Forbidden" in error_msg:
                print("⚠️  ACCESS DENIED - Likely token expiration issue")
            elif "connection" in error_msg.lower():
                print("⚠️  CONNECTION ERROR - Check internet connection")
            elif "timeout" in error_msg.lower():
                print("⚠️  TIMEOUT - Zerodha API may be slow or unavailable")
            
            import traceback
            traceback.print_exc()
            return False
    
    def _on_connect(self, ws, response):
        """Callback when connected to Zerodha."""
        print("✅ Connected to Zerodha KiteTicker")
        print(f"📊 Connection response: {response}")
        
        # 🔥 Set connection flag
        self._is_connected = True
        self._using_rest_fallback = False
        
        # 🔥 Notify watchdog of connection
        feed_watchdog.on_connect()
        
        # 🟢 Mark auth as successful
        auth_state_manager.mark_api_success()
        
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
        
        # 🔥 Clear connection flag
        self._is_connected = False
        
        # 🔥 Notify watchdog of disconnection
        feed_watchdog.on_disconnect()
    
    def _on_error(self, ws, code, reason):
        """Callback on error."""
        error_msg = f"{code} - {reason}"
        
        # 🔥 Track 403 errors to prevent spam
        is_403_error = code == 1006 or "403" in str(reason) or "Forbidden" in str(reason)
        
        if is_403_error:
            self._consecutive_403_errors += 1
            
            # Only print detailed error on FIRST occurrence
            if self._consecutive_403_errors == 1:
                print(f"\n❌ Zerodha WebSocket error: {error_msg}")
                print("\n" + "="*80)
                print("🔴 ZERODHA ACCESS TOKEN ERROR (403 Forbidden)")
                print("="*80)
                print("❌ Token has expired or is invalid")
                print("\n💡 QUICK FIX:")
                print("   1. Click LOGIN button in the UI")
                print("   2. Or run: python quick_token_fix.py")
                print("\n🔄 Switching to REST API fallback mode...")
                print("   (No more WebSocket retry attempts until token refresh)")
                print("="*80 + "\n")
                
                # Notify watchdog and auth manager
                feed_watchdog.on_error(Exception(error_msg))
                auth_state_manager.mark_api_failure(Exception(error_msg))
            
            # After 3 failures, stop the websocket and enable REST fallback
            if self._consecutive_403_errors >= 3:
                print("🛑 Stopping WebSocket retries (3 consecutive 403 errors)")
                print("📡 Using REST API polling for market data until token refresh")
                self._using_rest_fallback = True
                
                # Disconnect WebSocket to stop error spam
                if self.kws:
                    try:
                        self.kws.close()
                    except:
                        pass
        else:
            # Non-403 errors - log normally
            print(f"⚠️  Zerodha error (code {code}): {reason}")
            print("   → Will attempt reconnection...")
            feed_watchdog.on_error(Exception(error_msg))
            
            # Reset 403 counter if we get different error
            self._consecutive_403_errors = 0
    
    def _on_reconnect(self, ws, attempts_count):
        """Callback on reconnect attempt."""
        print(f"🔄 Reconnecting... Attempt {attempts_count}")
    
    def _on_noreconnect(self, ws):
        """Callback when reconnect fails."""
        print("❌ Reconnect failed")
    
    async def _validate_token_before_connect(self) -> bool:
        """Pre-flight check: Validate token using REST API before attempting WebSocket.
        
        This prevents 403 errors from reaching KiteTicker by testing the token first.
        Returns True if token is valid, False otherwise.
        """
        try:
            from kiteconnect import KiteConnect
            from kiteconnect.exceptions import TokenException
            
            print("🔍 Pre-flight token validation...")
            kite = KiteConnect(api_key=settings.zerodha_api_key)
            kite.set_access_token(settings.zerodha_access_token)
            
            # Simple profile check - if this works, token is valid
            profile = kite.profile()
            print(f"✅ Token validated - User: {profile.get('user_name', 'Unknown')}")
            print(f"   Email: {profile.get('email', 'Unknown')}")
            
            # Reset error counters on successful validation
            self._consecutive_403_errors = 0
            self._retry_delay = 5
            self._using_rest_fallback = False
            
            return True
            
        except TokenException as e:
            print(f"❌ Token validation FAILED: {e}")
            print("🔴 Token is expired or invalid - skipping WebSocket connection")
            auth_state_manager.mark_api_failure(e)
            return False
        except Exception as e:
            print(f"⚠️ Token validation error: {e}")
            return False
    
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
    
    async def _attempt_reconnect(self):
        """Attempt to reconnect with exponential backoff and token validation."""
        try:
            # Check if we should wait before retrying (exponential backoff)
            if self._last_connection_attempt:
                time_since_last = (datetime.now(IST) - self._last_connection_attempt).total_seconds()
                if time_since_last < self._retry_delay:
                    print(f"⏳ Waiting {self._retry_delay - int(time_since_last)}s before next retry...")
                    return
            
            self._last_connection_attempt = datetime.now(IST)
            
            print("\n" + "="*80)
            print("🔄 AUTO-RECONNECTING TO ZERODHA")
            print("="*80)
            
            # Stop current connection
            if self.kws:
                print("🛑 Closing old connection...")
                try:
                    self.kws.close()
                except Exception as e:
                    print(f"⚠️ Error closing websocket: {e}")
                
                await asyncio.sleep(2)
            
            # Reload settings (in case token was updated)
            from config import get_settings
            get_settings.cache_clear()
            fresh_settings = get_settings()
            
            # 🔥 Validate token BEFORE attempting WebSocket connection
            token_valid = await self._validate_token_before_connect()
            
            if not token_valid:
                print("🔴 Token validation failed - cannot reconnect")
                print("📡 Continuing with REST API fallback mode")
                self._using_rest_fallback = True
                
                # Increase retry delay exponentially: 5s → 15s → 30s → 60s (max)
                self._retry_delay = min(self._retry_delay * 2, 60)
                print(f"⏳ Next retry in {self._retry_delay} seconds")
                print("="*80 + "\n")
                return
            
            # Re-initialize KiteTicker with validated token
            print("🔧 Re-initializing KiteTicker with fresh token...")
            self.kws = KiteTicker(
                fresh_settings.zerodha_api_key,
                fresh_settings.zerodha_access_token
            )
            
            # Assign callbacks
            self.kws.on_ticks = self._on_ticks
            self.kws.on_connect = self._on_connect
            self.kws.on_close = self._on_close
            self.kws.on_error = self._on_error
            self.kws.on_reconnect = self._on_reconnect
            self.kws.on_noreconnect = self._on_noreconnect
            
            # Connect
            print("🔗 Reconnecting to Zerodha KiteTicker...")
            self.kws.connect(threaded=True)
            print("✅ AUTO-RECONNECT COMPLETE")
            print("="*80 + "\n")
            
            # Reset retry delay on successful connection attempt
            self._retry_delay = 5
            
        except Exception as e:
            print(f"❌ Auto-reconnect failed: {e}")
            auth_state_manager.mark_api_failure(e)
            self._using_rest_fallback = True
            
            # Increase retry delay
            self._retry_delay = min(self._retry_delay * 2, 60)
            print(f"⏳ Next retry in {self._retry_delay} seconds")
            print("="*80 + "\n")
    
    async def start(self):
        """Start the market feed service."""
        from kiteconnect.exceptions import TokenException
        self.running = True
        self._loop = asyncio.get_event_loop()
        
        # Check if we have valid credentials
        if not settings.zerodha_api_key or not settings.zerodha_access_token:
            print("❌ Zerodha credentials not configured")
            print("⚠️ Set ZERODHA_API_KEY and ZERODHA_ACCESS_TOKEN in .env file")
            auth_state_manager.force_reauth()
            return
        
        # 🔥 Start feed watchdog with auto-reconnect
        async def handle_reconnect():
            """Watchdog callback for auto-reconnect"""
            print("🐕 Watchdog triggered reconnection")
            
            # Check auth state first
            if auth_state_manager.requires_login:
                print("🔴 Cannot reconnect - Login required")
                return
            
            # Attempt reconnect
            await self._attempt_reconnect()
        
        await feed_watchdog.start(on_reconnect=handle_reconnect)
        
        # 🔥 Monitor auth state changes - auto-reconnect when user logs in
        last_auth_state = auth_state_manager.requires_login
        last_token_check_time = datetime.now(IST)
        
        # ASYNC: Fetch last traded data in background (don't block startup)
        print("🔄 Starting background data fetch (non-blocking)...")
        asyncio.create_task(self._fetch_and_cache_last_data_safe())
        
        try:
            # � FIX: Skip expensive REST API validation at startup (causes 9 AM connection delay)
            # Instead, trust token file age heuristic from auth_state_manager
            # REST fallback will activate ONLY if actual WebSocket connection fails with 403
            print("⚡ Skipping pre-flight token validation (trusting auth state manager)")
            print("   → Will auto-fallback to REST API ONLY if WebSocket fails with 403")
            
            # Proceed directly to WebSocket connection attempt
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
            last_rest_poll_time = datetime.now(IST)
            
            while self.running:
                current_time = datetime.now(IST)
                
                # � Detect token refresh - check if auth state changed from "requires_login" to "authenticated"
                current_auth_state = auth_state_manager.requires_login
                if last_auth_state and not current_auth_state:
                    print("\n" + "="*80)
                    print("🔐 AUTH STATE CHANGE DETECTED: User logged in!")
                    print("="*80)
                    print("🔄 Token has been refreshed - attempting WebSocket reconnection...")
                    
                    # Attempt to reconnect with new token
                    await self._attempt_reconnect()
                
                last_auth_state = current_auth_state
                
                # 📡 REST API FALLBACK: If WebSocket is down, poll REST API every 2 seconds
                # This keeps UI updated smoothly during connection issues
                if self._using_rest_fallback and is_market_open():
                    if (current_time - last_rest_poll_time).total_seconds() >= 2:
                        # Fetch market data via REST API
                        success = await self._fetch_and_cache_last_data()
                        
                        if success:
                            # 🔥 FIX: Send WebSocket status message to frontend
                            # This tells frontend we're in REST mode but still getting data
                            await self.ws_manager.broadcast({
                                "type": "status",
                                "status": "LIVE",
                                "message": "📡 Using REST API (WebSocket temporarily unavailable)"
                            })
                            
                            # Only print every 10th fetch to reduce log spam
                            if int((current_time - last_rest_poll_time).total_seconds()) % 20 == 0:
                                print("📡 REST API fallback: Market data fetched and broadcast")
                        
                        last_rest_poll_time = current_time
                
                # Refresh last traded data every 5 minutes (keeps data fresh even after market)
                if (current_time - last_refresh_time).total_seconds() > 300:  # 5 minutes
                    if not self._using_rest_fallback:  # Skip if already polling with REST
                        print("🔄 Refreshing last market data...")
                        await self._fetch_and_cache_last_data()
                    last_refresh_time = current_time
                
                # Process any pending ticks from the queue (only when WebSocket is active)
                while not self._tick_queue.empty():
                    try:
                        data = self._tick_queue.get_nowait()
                        await self._update_and_broadcast(data)
                    except Exception as e:
                        print(f"❌ Error broadcasting tick: {e}")
                
                await asyncio.sleep(0.1)  # Small sleep to prevent busy loop
                
        except TokenException as e:
            print("\n" + "="*80)
            print("🔴 ZERODHA TOKEN EXCEPTION")
            print("="*80)
            print(f"Error: {e}")
            print("\n💡 Your Zerodha access token has EXPIRED or is INVALID")
            print("   Tokens expire daily and must be regenerated.\n")
            print("🔧 QUICK FIX:")
            print("   1. Run: python quick_token_fix.py")
            print("   2. OR open: https://kite.zerodha.com/connect/login?api_key=" + settings.zerodha_api_key)
            print("   3. Login and copy request_token")
            print("   4. Run: python backend/get_token.py")
            print("\n🔄 Backend will automatically reconnect when token is updated")
            print("="*80 + "\n")
            
            # Don't retry immediately for token errors - wait for manual fix
            await asyncio.sleep(60)  # Wait 1 minute before checking again
            
        except Exception as e:
            from kiteconnect.exceptions import TokenException
            error_msg = str(e)
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
        print("\n" + "="*80)
        print("🔄 NEW TOKEN DETECTED - AUTO RECONNECTION STARTING")
        print("="*80)
        print(f"📝 New Token: {new_access_token[:20]}...")
        
        # Stop current connection gracefully
        print("🛑 Stopping current connection...")
        if self.kws:
            try:
                self.kws.close()
            except Exception as e:
                print(f"⚠️ Error closing old connection: {e}")
        
        self.running = False
        await asyncio.sleep(1)  # Quick cleanup (reduced from 3s)
        
        # Reload settings from .env file (clear cache)
        print("📂 Reloading settings from .env file...")
        from functools import lru_cache
        from config import get_settings
        
        # Clear the cache to force reload
        get_settings.cache_clear()
        
        # Get fresh settings
        fresh_settings = get_settings()
        print(f"✅ Settings reloaded. New token: {fresh_settings.zerodha_access_token[:20]}...")
        
        # Update module-level settings
        global settings
        settings = fresh_settings
        
        # Start new connection
        print("🚀 Starting new connection with fresh token...")
        self.running = True
        asyncio.create_task(self.start())
        
        print("✅ AUTO-RECONNECTION COMPLETE!")
        print("📡 Live data should start flowing within seconds...")
        print("="*80 + "\n")
