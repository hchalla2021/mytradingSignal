"""
Automatic Market Hours Scheduler
Starts/stops market feed based on IST market timings
Handles: Pre-open (9:00 AM), Live (9:15 AM), Close (3:30 PM)
"""
import asyncio
from datetime import datetime, time
from zoneinfo import ZoneInfo
from typing import Optional

IST = ZoneInfo("Asia/Kolkata")

class MarketHoursScheduler:
    """Automatically start/stop market feed based on market hours"""
    
    # Market timings (IST)
    PRE_OPEN_START = time(9, 0, 0)   # 9:00 AM - Pre-open starts
    MARKET_OPEN = time(9, 15, 0)      # 9:15 AM - Live trading starts
    MARKET_CLOSE = time(15, 30, 0)    # 3:30 PM - Market closes
    
    # Auto-start/stop times
    AUTO_START_TIME = time(8, 50, 0)  # 8:50 AM - Start 10 mins before pre-open
    AUTO_STOP_TIME = time(15, 35, 0)   # 3:35 PM - Stop 5 mins after close
    
    def __init__(self, market_feed_service):
        self.market_feed = market_feed_service
        self.scheduler_task: Optional[asyncio.Task] = None
        self.is_running = False
        
    async def start(self):
        """Start the automatic scheduler"""
        if self.is_running:
            return
            
        self.is_running = True
        self.scheduler_task = asyncio.create_task(self._run_scheduler())
        print("⏰ Market Hours Scheduler STARTED")
        print(f"   Auto-start: {self.AUTO_START_TIME.strftime('%I:%M %p')} IST")
        print(f"   Auto-stop:  {self.AUTO_STOP_TIME.strftime('%I:%M %p')} IST")
        
    async def stop(self):
        """Stop the scheduler"""
        self.is_running = False
        if self.scheduler_task:
            self.scheduler_task.cancel()
            try:
                await self.scheduler_task
            except asyncio.CancelledError:
                pass
        print("⏰ Market Hours Scheduler STOPPED")
        
    def _is_weekday(self, dt: datetime) -> bool:
        """Check if given datetime is a weekday (Mon-Fri)"""
        return dt.weekday() < 5  # 0=Monday, 4=Friday
        
    def _is_market_time(self, dt: datetime) -> bool:
        """Check if given time is within market hours"""
        current_time = dt.time()
        return (
            self._is_weekday(dt) and 
            self.AUTO_START_TIME <= current_time <= self.AUTO_STOP_TIME
        )
        
    async def _run_scheduler(self):
        """Main scheduler loop - checks every minute"""
        print("\n" + "="*70)
        print("🕐 AUTOMATIC MARKET HOURS SCHEDULER ACTIVE")
        print("="*70)
        
        last_feed_state = None  # Track if feed is running
        consecutive_failures = 0  # Track failed connection attempts
        
        while self.is_running:
            try:
                now = datetime.now(IST)
                current_time = now.time()
                
                # Determine if market feed should be running
                should_run = self._is_market_time(now)
                
                # 🔥 FIX: Better connection detection
                is_currently_running = (
                    hasattr(self.market_feed, 'is_connected') and 
                    self.market_feed.is_connected and
                    hasattr(self.market_feed, 'kws') and 
                    self.market_feed.kws is not None
                )
                
                # Check if using REST fallback
                using_rest_fallback = getattr(self.market_feed, '_using_rest_fallback', False)
                
                # State change detection OR health check during market hours
                if should_run:
                    if not is_currently_running:
                        # 🔥 FIX: CONTINUOUSLY retry during market hours
                        if last_feed_state != 'starting':
                            print(f"\n⏰ [{now.strftime('%I:%M:%S %p')}] MARKET HOURS - Feed NOT Connected")
                            print(f"   Connection Status: {'REST Fallback' if using_rest_fallback else 'Disconnected'}")
                            print("🔄 AUTO-STARTING Market Feed...")
                            
                            # Check if it's pre-open or live
                            if self.AUTO_START_TIME <= current_time < self.MARKET_OPEN:
                                print("   📊 Phase: PRE-OPEN (9:00 - 9:15 AM)")
                            elif self.MARKET_OPEN <= current_time < self.MARKET_CLOSE:
                                print("   📈 Phase: LIVE TRADING (9:15 AM - 3:30 PM)")
                            
                            # Start the feed
                            success = await self._ensure_feed_running()
                            if success:
                                consecutive_failures = 0
                                last_feed_state = 'running'
                                print("   ✅ Feed started successfully")
                            else:
                                consecutive_failures += 1
                                last_feed_state = 'starting'
                                print(f"   ⚠️ Feed start failed (attempt {consecutive_failures})")
                                
                                # Show helpful message after multiple failures
                                if consecutive_failures >= 3:
                                    print("\n" + "="*70)
                                    print("⚠️ PERSISTENT CONNECTION ISSUES")
                                    print("="*70)
                                    print("Possible causes:")
                                    print("1. Zerodha token expired (tokens expire daily)")
                                    print("2. Internet connectivity issues")
                                    print("3. Zerodha API downtime")
                                    print("\n💡 Solution: Click LOGIN in UI or run:")
                                    print("   python quick_token_fix.py")
                                    print("="*70 + "\n")
                    else:
                        # Feed is running - update state
                        if last_feed_state != 'running':
                            print(f"✅ [{now.strftime('%I:%M:%S %p')}] Market Feed ACTIVE")
                            consecutive_failures = 0
                        last_feed_state = 'running'
                        
                        # Periodic status (every 15 minutes during market hours)
                        if now.minute % 15 == 0 and now.second < 60:
                            phase = self._get_market_phase(current_time)
                            connection_type = "WebSocket" if not using_rest_fallback else "REST API Polling"
                            print(f"✅ [{now.strftime('%I:%M %p')}] Feed Active - {phase} ({connection_type})")
                else:
                    # Outside market hours
                    if is_currently_running and last_feed_state != 'stopped':
                        # Outside market hours - STOP feed
                        print(f"\n⏰ [{now.strftime('%I:%M:%S %p')}] MARKET CLOSED")
                        print("🛑 AUTO-STOPPING Market Feed...")
                        
                        await self._ensure_feed_stopped()
                        last_feed_state = 'stopped'
                        consecutive_failures = 0
                    
                # Sleep for 60 seconds before next check
                await asyncio.sleep(60)
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"❌ Scheduler error: {e}")
                await asyncio.sleep(60)  # Continue even on error
                
    def _get_market_phase(self, current_time: time) -> str:
        """Get current market phase"""
        if current_time < self.MARKET_OPEN:
            return "PRE-OPEN"
        elif current_time < self.MARKET_CLOSE:
            return "LIVE TRADING"
        else:
            return "AFTER HOURS"
            
    async def _ensure_feed_running(self) -> bool:
        """Ensure market feed is running
        
        Returns:
            True if feed is running or successfully started
            False if start failed
        """
        try:
            # 🔥 FIX: Better connection check
            is_connected = (
                hasattr(self.market_feed, 'is_connected') and 
                self.market_feed.is_connected and
                hasattr(self.market_feed, 'kws') and 
                self.market_feed.kws is not None and
                not getattr(self.market_feed, '_using_rest_fallback', False)
            )
            
            if is_connected:
                print("   ℹ️  Market feed already running (WebSocket connected)")
                return True
            
            # Check if REST fallback is active
            using_rest_fallback = getattr(self.market_feed, '_using_rest_fallback', False)
            if using_rest_fallback:
                print("   ℹ️  REST API fallback mode active")
                print("   🔄 Attempting to restore WebSocket connection...")
                
                # Try to restore WebSocket
                if hasattr(self.market_feed, '_attempt_reconnect'):
                    await self.market_feed._attempt_reconnect()
                    # Check if reconnect succeeded
                    await asyncio.sleep(2)  # Give it time to connect
                    if self.market_feed.is_connected:
                        print("   ✅ WebSocket restored!")
                        return True
                    else:
                        print("   ⚠️  WebSocket restore failed, continuing with REST fallback")
                        return False  # Still using REST, not ideal
            
            # Start the feed
            print("   🚀 Starting market feed...")
            if hasattr(self.market_feed, 'start'):
                # If feed has start method, call it (non-blocking)
                asyncio.create_task(self.market_feed.start())
                # Give it a moment to initialize
                await asyncio.sleep(3)
            elif hasattr(self.market_feed, 'connect'):
                # Or if it has connect method
                await self.market_feed.connect()
                
            # Verify connection established
            await asyncio.sleep(2)
            is_now_connected = (
                hasattr(self.market_feed, 'is_connected') and 
                self.market_feed.is_connected
            )
            
            if is_now_connected:
                print("   ✅ Market feed started successfully!")
                return True
            else:
                # Check if REST fallback is now active (better than nothing)
                using_rest_fallback = getattr(self.market_feed, '_using_rest_fallback', False)
                if using_rest_fallback:
                    print("   ⚠️  WebSocket failed, but REST fallback is active")
                    return False  # Not ideal, but data is flowing
                else:
                    print("   ⚠️  Feed did not connect - will retry")
                    return False
            
        except Exception as e:
            print(f"   ❌ Failed to start feed: {e}")
            import traceback
            traceback.print_exc()
            print("   🔄 Will retry on next check (in 60 seconds)")
            return False
            
    async def _ensure_feed_stopped(self):
        """Ensure market feed is stopped"""
        try:
            if hasattr(self.market_feed, 'stop'):
                await self.market_feed.stop()
            elif hasattr(self.market_feed, 'disconnect'):
                await self.market_feed.disconnect()
                
            print("   ✅ Market feed stopped successfully!")
            
        except Exception as e:
            print(f"   ⚠️  Failed to stop feed: {e}")


# Global scheduler instance
_scheduler_instance: Optional[MarketHoursScheduler] = None


def get_scheduler(market_feed_service) -> MarketHoursScheduler:
    """Get or create scheduler instance"""
    global _scheduler_instance
    if _scheduler_instance is None:
        _scheduler_instance = MarketHoursScheduler(market_feed_service)
    return _scheduler_instance
