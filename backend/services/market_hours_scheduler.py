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
        
        while self.is_running:
            try:
                now = datetime.now(IST)
                current_time = now.time()
                
                # Determine if market feed should be running
                should_run = self._is_market_time(now)
                is_currently_running = self.market_feed.is_connected if hasattr(self.market_feed, 'is_connected') else False
                
                # State change detection
                if should_run and not is_currently_running and last_feed_state != 'running':
                    # Market hours - START feed
                    print(f"\n⏰ [{now.strftime('%I:%M:%S %p')}] MARKET HOURS DETECTED")
                    print("🚀 AUTO-STARTING Market Feed...")
                    
                    # Check if it's pre-open or live
                    if self.AUTO_START_TIME <= current_time < self.MARKET_OPEN:
                        print("   📊 Phase: PRE-OPEN (9:00 - 9:15 AM)")
                    elif self.MARKET_OPEN <= current_time < self.MARKET_CLOSE:
                        print("   📈 Phase: LIVE TRADING (9:15 AM - 3:30 PM)")
                    
                    # Start the feed
                    await self._ensure_feed_running()
                    last_feed_state = 'running'
                    
                elif not should_run and is_currently_running and last_feed_state != 'stopped':
                    # Outside market hours - STOP feed
                    print(f"\n⏰ [{now.strftime('%I:%M:%S %p')}] MARKET CLOSED")
                    print("🛑 AUTO-STOPPING Market Feed...")
                    
                    await self._ensure_feed_stopped()
                    last_feed_state = 'stopped'
                    
                # Periodic status (every 15 minutes during market hours)
                if now.minute % 15 == 0 and now.second < 60:
                    if should_run:
                        phase = self._get_market_phase(current_time)
                        print(f"✅ [{now.strftime('%I:%M %p')}] Market Feed Active - {phase}")
                    
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
            
    async def _ensure_feed_running(self):
        """Ensure market feed is running"""
        try:
            # Check if already connected
            if hasattr(self.market_feed, 'ticker') and self.market_feed.ticker and self.market_feed.is_connected:
                print("   ℹ️  Market feed already running")
                return
                
            # Start the feed
            if hasattr(self.market_feed, 'start'):
                # If feed has start method, call it
                await self.market_feed.start()
            elif hasattr(self.market_feed, 'connect'):
                # Or if it has connect method
                await self.market_feed.connect()
                
            print("   ✅ Market feed started successfully!")
            
        except Exception as e:
            print(f"   ⚠️  Failed to start feed: {e}")
            print("   🔄 Will retry on next check (in 60 seconds)")
            
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
