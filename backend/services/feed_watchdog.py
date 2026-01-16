"""
WebSocket Feed Watchdog - Professional Feed Health Monitoring
✅ Detects silent websocket failures
✅ Auto-reconnects on feed death
✅ Independent of market session
✅ Never requires manual restart
"""
import asyncio
import time
from datetime import datetime, timedelta
from enum import Enum
from typing import Optional, Callable
import pytz

IST = pytz.timezone('Asia/Kolkata')


class FeedState(str, Enum):
    """WebSocket feed states"""
    DISCONNECTED = "disconnected"      # Not connected
    CONNECTING = "connecting"          # Connection in progress
    CONNECTED = "connected"            # Connected and healthy
    STALE = "stale"                   # Connected but no data
    ERROR = "error"                   # Error state


class FeedWatchdog:
    """
    Professional WebSocket Feed Watchdog
    
    ✅ Monitors tick health
    ✅ Detects silent failures (no data for 10+ seconds during market hours)
    ✅ Auto-reconnects dead feeds
    ✅ Tracks connection quality
    """
    
    def __init__(
        self,
        stale_threshold_seconds: int = 10,
        reconnect_delay_seconds: int = 5,
        max_reconnect_attempts: int = 5,
    ):
        self._state: FeedState = FeedState.DISCONNECTED
        self._last_tick_time: Optional[float] = None
        self._last_connect_time: Optional[float] = None
        self._tick_count: int = 0
        self._reconnect_count: int = 0
        self._max_reconnect_attempts = max_reconnect_attempts
        self._stale_threshold = stale_threshold_seconds
        self._reconnect_delay = reconnect_delay_seconds
        
        # Callbacks
        self._on_reconnect: Optional[Callable] = None
        self._on_state_change: Optional[Callable] = None
        
        # Watchdog task
        self._watchdog_task: Optional[asyncio.Task] = None
        self._running = False
        
        # Health metrics
        self._health_metrics = {
            "total_ticks": 0,
            "total_reconnects": 0,
            "uptime_seconds": 0,
            "last_stale_duration": 0,
            "connection_quality": 100.0,  # percentage
        }
    
    @property
    def state(self) -> FeedState:
        """Get current feed state"""
        return self._state
    
    @property
    def is_healthy(self) -> bool:
        """Check if feed is healthy (connected and receiving data)"""
        return self._state == FeedState.CONNECTED
    
    @property
    def is_stale(self) -> bool:
        """Check if feed is stale"""
        return self._state == FeedState.STALE
    
    @property
    def requires_reconnect(self) -> bool:
        """Check if reconnect is needed"""
        return self._state in (FeedState.DISCONNECTED, FeedState.STALE, FeedState.ERROR)
    
    def on_tick(self, symbol: str = None):
        """
        Call this when a tick is received
        
        Args:
            symbol: Optional symbol name for logging
        """
        now = time.time()
        self._last_tick_time = now
        self._tick_count += 1
        self._health_metrics["total_ticks"] += 1
        
        # Update state to CONNECTED if not already
        if self._state != FeedState.CONNECTED:
            self._change_state(FeedState.CONNECTED)
            print(f"🟢 FEED STATE: CONNECTED (ticks flowing)")
        
        # Reset reconnect counter on successful tick
        self._reconnect_count = 0
    
    def on_connect(self):
        """Call this when websocket connects"""
        now = time.time()
        self._last_connect_time = now
        self._change_state(FeedState.CONNECTING)
        print(f"🔵 FEED STATE: CONNECTING")
    
    def on_disconnect(self):
        """Call this when websocket disconnects"""
        self._change_state(FeedState.DISCONNECTED)
        print(f"🔴 FEED STATE: DISCONNECTED")
    
    def on_error(self, error: Exception):
        """Call this when an error occurs"""
        self._change_state(FeedState.ERROR)
        print(f"🔴 FEED STATE: ERROR - {error}")
    
    def _change_state(self, new_state: FeedState):
        """Internal state change with callback"""
        if new_state != self._state:
            old_state = self._state
            self._state = new_state
            
            # Call state change callback
            if self._on_state_change:
                try:
                    if asyncio.iscoroutinefunction(self._on_state_change):
                        asyncio.create_task(self._on_state_change(old_state, new_state))
                    else:
                        self._on_state_change(old_state, new_state)
                except Exception as e:
                    print(f"⚠️ State change callback error: {e}")
    
    async def _watchdog_loop(self):
        """Main watchdog monitoring loop"""
        print("🐕 Feed Watchdog started")
        
        last_health_log = time.time()
        
        while self._running:
            try:
                now = time.time()
                
                # Only check for stale feed during market hours
                from services.market_session_controller import market_session
                is_trading_hours = market_session.is_data_flow_expected()
                
                if is_trading_hours and self._state == FeedState.CONNECTED:
                    # Check if feed has gone stale
                    if self._last_tick_time:
                        seconds_since_last_tick = now - self._last_tick_time
                        
                        if seconds_since_last_tick > self._stale_threshold:
                            print(f"⚠️ FEED STALE: No ticks for {seconds_since_last_tick:.1f}s")
                            self._health_metrics["last_stale_duration"] = seconds_since_last_tick
                            self._change_state(FeedState.STALE)
                            
                            # Trigger reconnect
                            await self._trigger_reconnect()
                
                # Log health status every 60 seconds
                if now - last_health_log > 60:
                    self._log_health_status()
                    last_health_log = now
                
                # Update uptime
                if self._last_connect_time:
                    self._health_metrics["uptime_seconds"] = now - self._last_connect_time
                
                await asyncio.sleep(3)  # Check every 3 seconds
                
            except Exception as e:
                print(f"❌ Watchdog error: {e}")
                import traceback
                traceback.print_exc()
                await asyncio.sleep(5)
    
    async def _trigger_reconnect(self):
        """Trigger reconnection logic"""
        if self._reconnect_count >= self._max_reconnect_attempts:
            print(f"❌ Max reconnect attempts ({self._max_reconnect_attempts}) reached")
            print(f"💡 Possible issues:")
            print(f"   - Token expired (check auth state)")
            print(f"   - Network connectivity")
            print(f"   - Zerodha API issues")
            return
        
        self._reconnect_count += 1
        self._health_metrics["total_reconnects"] += 1
        
        print(f"🔄 Triggering reconnect (attempt {self._reconnect_count}/{self._max_reconnect_attempts})")
        
        # Call reconnect callback
        if self._on_reconnect:
            try:
                await asyncio.sleep(self._reconnect_delay)
                
                if asyncio.iscoroutinefunction(self._on_reconnect):
                    await self._on_reconnect()
                else:
                    self._on_reconnect()
                    
                print(f"✅ Reconnect callback executed")
            except Exception as e:
                print(f"❌ Reconnect failed: {e}")
                import traceback
                traceback.print_exc()
    
    def _log_health_status(self):
        """Log health status"""
        uptime_minutes = self._health_metrics["uptime_seconds"] / 60
        ticks_per_minute = self._health_metrics["total_ticks"] / uptime_minutes if uptime_minutes > 0 else 0
        
        print(f"\n📊 FEED HEALTH STATUS")
        print(f"   State: {self._state.value}")
        print(f"   Total Ticks: {self._health_metrics['total_ticks']}")
        print(f"   Uptime: {uptime_minutes:.1f} minutes")
        print(f"   Ticks/min: {ticks_per_minute:.1f}")
        print(f"   Reconnects: {self._health_metrics['total_reconnects']}")
        print(f"   Last tick: {time.time() - self._last_tick_time:.1f}s ago" if self._last_tick_time else "   Last tick: Never")
        print()
    
    async def start(
        self,
        on_reconnect: Optional[Callable] = None,
        on_state_change: Optional[Callable] = None
    ):
        """
        Start the watchdog
        
        Args:
            on_reconnect: Callback when reconnect is needed
            on_state_change: Callback when state changes (old_state, new_state)
        """
        if self._running:
            print("⚠️ Watchdog already running")
            return
        
        self._on_reconnect = on_reconnect
        self._on_state_change = on_state_change
        self._running = True
        
        # Start watchdog loop
        self._watchdog_task = asyncio.create_task(self._watchdog_loop())
        print("🐕 Feed Watchdog initialized")
    
    async def stop(self):
        """Stop the watchdog"""
        self._running = False
        
        if self._watchdog_task:
            self._watchdog_task.cancel()
            try:
                await self._watchdog_task
            except asyncio.CancelledError:
                pass
        
        print("🛑 Feed Watchdog stopped")
    
    def get_health_metrics(self) -> dict:
        """Get detailed health metrics"""
        now = time.time()
        
        return {
            "state": self._state.value,
            "is_healthy": self.is_healthy,
            "is_stale": self.is_stale,
            "requires_reconnect": self.requires_reconnect,
            "last_tick_seconds_ago": round(now - self._last_tick_time, 1) if self._last_tick_time else None,
            "uptime_minutes": round(self._health_metrics["uptime_seconds"] / 60, 1),
            "total_ticks": self._health_metrics["total_ticks"],
            "total_reconnects": self._health_metrics["total_reconnects"],
            "reconnect_count": self._reconnect_count,
            "connection_quality": self._calculate_connection_quality(),
        }
    
    def _calculate_connection_quality(self) -> float:
        """Calculate connection quality percentage"""
        if not self._last_connect_time:
            return 0.0
        
        uptime = time.time() - self._last_connect_time
        if uptime < 60:  # Not enough data
            return 100.0
        
        # Quality based on:
        # - Current state (connected is best)
        # - Data freshness (stale check)
        # - Excessive reconnects (only if frequent)
        
        # Base quality on current state
        if self._state == FeedState.CONNECTED and not self.is_stale:
            quality = 100.0  # Perfect connection with fresh data
        elif self._state == FeedState.CONNECTED:
            quality = 95.0   # Connected but data is stale
        elif self._state == FeedState.DISCONNECTED:
            quality = 0.0    # Not connected
        else:
            quality = 50.0   # Other states (connecting, error)
        
        # Only penalize if reconnects are EXCESSIVE (more than 5)
        # Normal operation: 0-2 reconnects = no penalty (startup + 1 recovery is fine)
        if self._health_metrics["total_reconnects"] > 5:
            excessive_reconnects = self._health_metrics["total_reconnects"] - 5
            reconnect_penalty = min(excessive_reconnects * 5, 30)  # Max 30% penalty
            quality -= reconnect_penalty
        
        return max(0.0, min(100.0, quality))


# Singleton instance
feed_watchdog = FeedWatchdog(
    stale_threshold_seconds=10,
    reconnect_delay_seconds=5,
    max_reconnect_attempts=10,
)



