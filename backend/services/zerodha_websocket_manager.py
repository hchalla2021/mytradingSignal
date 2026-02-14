"""
🔥 PRODUCTION-GRADE ZERODHA WEBSOCKET MANAGER
Handles all real Zerodha trading issues:
- Silent connections (connected but no ticks)
- 9:15 AM market open glitches
- Auto-recovery and watchdog timers
- Proper market timing awareness
"""

import time
import threading
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Callable
from kiteconnect import KiteTicker
import json

logger = logging.getLogger(__name__)

class ZerodhaWebSocketManager:
    def __init__(self, api_key: str, access_token: str, instruments: List[int]):
        self.api_key = api_key
        self.access_token = access_token
        self.instruments = instruments
        
        # State tracking
        self.kws: Optional[KiteTicker] = None
        self.is_connected = False
        self.last_tick_time: Optional[float] = None
        self.tick_count = 0
        self.failed_attempts = 0
        self.max_retries = 5
        
        # Market timing
        self.market_start_time = "09:14:50"  # Start WS 10 seconds before market open
        self.market_open_time = "09:15:00"
        self.market_close_time = "15:30:00"
        
        # Callbacks
        self.on_tick_callback: Optional[Callable] = None
        self.on_status_callback: Optional[Callable] = None
        
        # Watchdog thread
        self.watchdog_thread: Optional[threading.Thread] = None
        self.stop_watchdog = False
        
        # Recovery settings
        self.tick_timeout = 30  # seconds - if no tick for 30s, reconnect
        self.reconnect_delay = 2  # seconds between reconnect attempts
        
        logger.info("🚀 ZerodhaWebSocketManager initialized")

    def set_callbacks(self, on_tick: Callable = None, on_status: Callable = None):
        """Set callback functions for ticks and status updates"""
        self.on_tick_callback = on_tick
        self.on_status_callback = on_status

    def _notify_status(self, status: str, message: str = ""):
        """Notify frontend about status changes"""
        if self.on_status_callback:
            self.on_status_callback(status, message)
        logger.info(f"📡 Status: {status} - {message}")

    def _is_market_time(self) -> bool:
        """Check if current time is within market hours"""
        now = datetime.now()
        current_time = now.strftime("%H:%M:%S")
        
        # Market is open Monday to Friday, 9:15 AM to 3:30 PM
        if now.weekday() >= 5:  # Saturday = 5, Sunday = 6
            return False
            
        return self.market_start_time <= current_time <= self.market_close_time

    def _should_start_websocket(self) -> bool:
        """Check if it's time to start WebSocket (9:14:50 AM)"""
        current_time = datetime.now().strftime("%H:%M:%S")
        return current_time >= self.market_start_time

    def _is_market_open(self) -> bool:
        """Check if market is actually open (9:15 AM+)"""
        current_time = datetime.now().strftime("%H:%M:%S")
        return current_time >= self.market_open_time

    def _on_connect(self, ws, response):
        """Called when WebSocket connects"""
        self.is_connected = True
        self.failed_attempts = 0
        self._notify_status("CONNECTED", "WebSocket connected, subscribing instruments...")
        
        # 🔥 KEY FIX: Wait 1 second then subscribe (Zerodha requirement)
        threading.Timer(1.0, self._subscribe_instruments).start()

    def _subscribe_instruments(self):
        """Subscribe to instruments after connection is stable"""
        try:
            if self.kws and self.is_connected:
                logger.info(f"📊 Subscribing to {len(self.instruments)} instruments")
                self.kws.subscribe(self.instruments)
                self.kws.set_mode(self.kws.MODE_FULL, self.instruments)
                self._notify_status("SUBSCRIBED", f"Subscribed to {len(self.instruments)} instruments")
        except Exception as e:
            logger.error(f"❌ Subscription failed: {e}")
            self._notify_status("ERROR", f"Subscription failed: {e}")

    def _on_ticks(self, ws, ticks):
        """Called when ticks are received"""
        self.last_tick_time = time.time()
        self.tick_count += len(ticks)
        
        # Update status to LIVE after first tick
        if self.tick_count <= len(ticks):  # First batch of ticks
            self._notify_status("LIVE", f"Receiving live market data ({self.tick_count} ticks)")
        
        # Process ticks via callback
        if self.on_tick_callback:
            self.on_tick_callback(ticks)
            
        logger.debug(f"📈 Received {len(ticks)} ticks (total: {self.tick_count})")

    def _on_disconnect(self, ws, code, reason):
        """Called when WebSocket disconnects"""
        self.is_connected = False
        logger.warning(f"🔌 Disconnected: {code} - {reason}")
        self._notify_status("DISCONNECTED", f"Disconnected: {reason}")
        
        # Auto-reconnect if during market hours
        if self._is_market_time():
            self._schedule_reconnect()

    def _on_error(self, ws, code, reason):
        """Called when WebSocket has an error"""
        logger.error(f"❌ WebSocket error: {code} - {reason}")
        
        # Check for token expiry errors
        reason_str = str(reason).lower()
        is_token_error = any(keyword in reason_str for keyword in [
            'token', 'authentication', 'unauthorized', 'invalid_token', 'session'
        ])
        
        if is_token_error:
            logger.error("🔴 TOKEN AUTHENTICATION ERROR DETECTED")
            logger.error("   Zerodha token has expired (24-hour validity)")
            logger.error("   Please login via UI or run: python quick_token_fix.py")
            self._notify_status("TOKEN_EXPIRED", "Token expired - Login required")
            # Stop trying to reconnect with expired token
            self.failed_attempts = self.max_retries
        else:
            self._notify_status("ERROR", f"WebSocket error: {reason}")
            self.failed_attempts += 1

    def _schedule_reconnect(self):
        """Schedule a reconnection attempt"""
        if self.failed_attempts >= self.max_retries:
            logger.error(f"💀 Max retries ({self.max_retries}) exceeded, giving up")
            logger.error("")
            logger.error("🔴 POSSIBLE CAUSES:")
            logger.error("   1. Zerodha token expired (tokens last 24 hours)")
            logger.error("   2. Network connectivity issues")
            logger.error("   3. Zerodha API is down")
            logger.error("")
            logger.error("📋 TO FIX:")
            logger.error("   - If token expired: Login via UI")
            logger.error("   - If network issue: Check internet connection")
            logger.error("   - If API down: Wait for Zerodha to resolve")
            logger.error("")
            self._notify_status("FAILED", "Connection failed - Check token and network")
            return

        delay = self.reconnect_delay * (self.failed_attempts + 1)  # Exponential backoff
        logger.info(f"🔄 Scheduling reconnect in {delay} seconds (attempt {self.failed_attempts + 1})")
        self._notify_status("RECONNECTING", f"Reconnecting in {delay}s...")
        
        threading.Timer(delay, self._reconnect).start()

    def _reconnect(self):
        """Attempt to reconnect"""
        logger.info("🔄 Attempting to reconnect...")
        self.disconnect()
        time.sleep(1)
        self.connect()

    def _tick_watchdog(self):
        """Monitor for tick timeouts and force reconnection"""
        logger.info("🐕 Starting tick watchdog")
        
        while not self.stop_watchdog:
            time.sleep(10)  # Check every 10 seconds
            
            if self.stop_watchdog:
                break
                
            # Only monitor during market hours
            if not self._is_market_time():
                continue
                
            # Only monitor if we're connected and market is open
            if not (self.is_connected and self._is_market_open()):
                continue
                
            # Check for tick timeout
            if self.last_tick_time:
                timeout = time.time() - self.last_tick_time
                if timeout > self.tick_timeout:
                    logger.warning(f"⚠️ No ticks for {timeout:.1f}s, forcing reconnect")
                    self._notify_status("STALE", f"No ticks for {timeout:.1f}s, reconnecting...")
                    self._reconnect()
            else:
                # No ticks received yet but market is open for > 30 seconds
                if self._is_market_open():
                    market_open_time = datetime.now().replace(hour=9, minute=15, second=0, microsecond=0)
                    time_since_open = (datetime.now() - market_open_time).total_seconds()
                    
                    if time_since_open > 30 and self.is_connected:
                        logger.warning("⚠️ Market open but no ticks received, forcing reconnect")
                        self._notify_status("NO_TICKS", "Market open but no data, reconnecting...")
                        self._reconnect()

        logger.info("🐕 Tick watchdog stopped")

    def wait_for_market_start(self):
        """Wait until it's time to start WebSocket"""
        while not self._should_start_websocket():
            current_time = datetime.now().strftime("%H:%M:%S")
            logger.info(f"⏰ Waiting for market start time ({self.market_start_time}), current: {current_time}")
            self._notify_status("WAITING", f"Waiting for market start ({self.market_start_time})")
            time.sleep(10)
        
        logger.info(f"🟢 Market start time reached, initializing WebSocket")

    def connect(self):
        """Connect to Zerodha WebSocket"""
        try:
            # Wait for proper market timing
            if not self._should_start_websocket():
                self.wait_for_market_start()
            
            logger.info("🔗 Connecting to Zerodha WebSocket...")
            self._notify_status("CONNECTING", "Connecting to Zerodha KiteTicker...")
            
            # Initialize KiteTicker
            self.kws = KiteTicker(self.api_key, self.access_token)
            
            # Set callbacks
            self.kws.on_connect = self._on_connect
            self.kws.on_ticks = self._on_ticks
            self.kws.on_disconnect = self._on_disconnect
            self.kws.on_error = self._on_error
            
            # Start watchdog thread
            if not self.watchdog_thread or not self.watchdog_thread.is_alive():
                self.stop_watchdog = False
                self.watchdog_thread = threading.Thread(target=self._tick_watchdog, daemon=True)
                self.watchdog_thread.start()
            
            # Connect (blocking)
            self.kws.connect()
            
        except Exception as e:
            logger.error(f"❌ Connection failed: {e}")
            self._notify_status("ERROR", f"Connection failed: {e}")
            self.failed_attempts += 1
            
            if self.failed_attempts < self.max_retries:
                self._schedule_reconnect()

    def disconnect(self):
        """Disconnect from WebSocket"""
        logger.info("🔌 Disconnecting WebSocket...")
        
        # Stop watchdog
        self.stop_watchdog = True
        
        # Close WebSocket
        if self.kws:
            try:
                self.kws.close()
            except:
                pass
            self.kws = None
            
        self.is_connected = False
        self._notify_status("DISCONNECTED", "WebSocket disconnected")

    def get_status(self) -> Dict:
        """Get current WebSocket status"""
        return {
            "is_connected": self.is_connected,
            "last_tick_time": self.last_tick_time,
            "tick_count": self.tick_count,
            "failed_attempts": self.failed_attempts,
            "market_time": self._is_market_time(),
            "market_open": self._is_market_open(),
        }

    def force_reconnect(self):
        """Force an immediate reconnection"""
        logger.info("🔄 Force reconnecting WebSocket...")
        self._reconnect()

# Usage example:
"""
# Initialize manager
ws_manager = ZerodhaWebSocketManager(
    api_key="your_api_key",
    access_token="your_access_token", 
    instruments=[408065, 260105]  # NIFTY, BANKNIFTY tokens
)

# Set callbacks
def on_tick(ticks):
    for tick in ticks:
        print(f"📊 {tick['instrument_token']}: ₹{tick['last_price']}")

def on_status(status, message):
    print(f"📡 {status}: {message}")

ws_manager.set_callbacks(on_tick, on_status)

# Start connection
ws_manager.connect()  # Will auto-wait for 9:14:50 AM
"""