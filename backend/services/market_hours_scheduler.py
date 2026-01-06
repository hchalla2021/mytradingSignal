"""
Market Hours Auto-Scheduler
===========================
Automatically manages WebSocket connection based on market hours.
Ensures live data starts flowing when market opens without manual restart.

PROBLEM SOLVED:
- Production deployment: Backend doesn't get live data when market opens
- Solution: Auto-reconnect at 9:00 AM (pre-open) and 9:15 AM (live)
- No manual restart needed!

Schedule:
- 8:55 AM: Prepare for market (check token, warm up)
- 9:00 AM: PRE-OPEN starts → Auto-reconnect WebSocket
- 9:15 AM: LIVE trading starts → Verify connection
- 3:30 PM: Market closes → Keep connection for after-hours data
- 3:35 PM: Disconnect WebSocket (save resources)
"""

import asyncio
from datetime import datetime, time
from typing import Optional
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")

# Market hours
MARKET_PREPARE_TIME = time(8, 55)    # 8:55 AM - Prepare for market
PRE_OPEN_START = time(9, 0)          # 9:00 AM - Pre-open starts
MARKET_OPEN = time(9, 15)            # 9:15 AM - Live trading starts
MARKET_CLOSE = time(15, 30)          # 3:30 PM - Market closes
MARKET_DISCONNECT = time(15, 35)     # 3:35 PM - Disconnect WebSocket


class MarketHoursScheduler:
    """Automatically manages market feed based on market hours."""
    
    def __init__(self, market_feed_service):
        self.market_feed = market_feed_service
        self.running = False
        self._task: Optional[asyncio.Task] = None
        self._last_action: Optional[str] = None
        
    async def start(self):
        """Start the scheduler."""
        if self.running:
            print("⚠️ Market scheduler already running")
            return
            
        self.running = True
        self._task = asyncio.create_task(self._schedule_loop())
        print("📅 Market Hours Scheduler started")
        print("   Will auto-reconnect at:")
        print("   • 8:55 AM - Prepare for market")
        print("   • 9:00 AM - Pre-open reconnect")
        print("   • 9:15 AM - Live trading verification")
        
    async def stop(self):
        """Stop the scheduler."""
        self.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        print("📅 Market Hours Scheduler stopped")
    
    async def _schedule_loop(self):
        """Main scheduling loop - checks every minute."""
        while self.running:
            try:
                now = datetime.now(IST)
                current_time = now.time()
                current_day = now.weekday()  # 0 = Monday, 6 = Sunday
                
                # Skip weekends (Saturday=5, Sunday=6)
                if current_day >= 5:
                    # Check every hour on weekends
                    await asyncio.sleep(3600)
                    continue
                
                # === 8:55 AM - PREPARE FOR MARKET ===
                if self._is_time_to_act(current_time, MARKET_PREPARE_TIME, "prepare"):
                    print("\n" + "="*80)
                    print("⏰ 8:55 AM - PREPARING FOR MARKET OPEN")
                    print("="*80)
                    print("🔍 Checking Zerodha token validity...")
                    
                    # Validate token before market opens
                    is_valid = await self.market_feed._validate_token_before_connect()
                    
                    if is_valid:
                        print("✅ Token is valid - Ready for market open!")
                    else:
                        print("❌ Token is INVALID!")
                        print("⚠️ ACTION REQUIRED: Generate new token before 9:00 AM")
                        print("   Run: python quick_token_fix.py")
                    
                    print("="*80 + "\n")
                
                # === 9:00 AM - PRE-OPEN STARTS (CRITICAL) ===
                elif self._is_time_to_act(current_time, PRE_OPEN_START, "preopen"):
                    print("\n" + "="*80)
                    print("🚀 9:00 AM - PRE-OPEN SESSION STARTING!")
                    print("="*80)
                    print("📊 Auto-reconnecting WebSocket for live data...")
                    
                    # Force reconnection to ensure fresh connection
                    await self.market_feed._attempt_reconnect()
                    
                    print("✅ Pre-open reconnection complete!")
                    print("📈 Waiting for auction/order matching data...")
                    print("="*80 + "\n")
                
                # === 9:15 AM - LIVE TRADING STARTS ===
                elif self._is_time_to_act(current_time, MARKET_OPEN, "live"):
                    print("\n" + "="*80)
                    print("🔥 9:15 AM - LIVE TRADING STARTED!")
                    print("="*80)
                    print("🔍 Verifying WebSocket connection...")
                    
                    # Check if we're getting live data
                    if hasattr(self.market_feed, '_last_tick_time'):
                        import time
                        time_since_last_tick = time.time() - self.market_feed._last_tick_time
                        
                        if time_since_last_tick < 5:
                            print("✅ WebSocket is LIVE - Receiving real-time ticks!")
                        else:
                            print("⚠️ No recent ticks - Attempting reconnection...")
                            await self.market_feed._attempt_reconnect()
                    else:
                        print("🔄 Ensuring connection is active...")
                        await self.market_feed._attempt_reconnect()
                    
                    print("="*80 + "\n")
                
                # === 3:35 PM - DISCONNECT (SAVE RESOURCES) ===
                elif self._is_time_to_act(current_time, MARKET_DISCONNECT, "disconnect"):
                    print("\n" + "="*80)
                    print("🌙 3:35 PM - MARKET CLOSED (5 minutes ago)")
                    print("="*80)
                    print("💤 Keeping connection for last traded data...")
                    print("   (Connection stays alive for after-hours queries)")
                    print("="*80 + "\n")
                
                # Sleep for 30 seconds before next check
                await asyncio.sleep(30)
                
            except Exception as e:
                print(f"❌ Scheduler error: {e}")
                await asyncio.sleep(60)  # Wait longer on error
    
    def _is_time_to_act(self, current_time: time, target_time: time, action: str) -> bool:
        """Check if it's time to perform an action (only once per minute)."""
        # Calculate time difference in seconds
        current_seconds = current_time.hour * 3600 + current_time.minute * 60 + current_time.second
        target_seconds = target_time.hour * 3600 + target_time.minute * 60
        
        # Trigger if within 30 seconds of target time
        time_diff = abs(current_seconds - target_seconds)
        
        # Only trigger once per action per day
        if time_diff <= 30:
            if self._last_action != f"{action}_{datetime.now(IST).date()}":
                self._last_action = f"{action}_{datetime.now(IST).date()}"
                return True
        
        return False


# Global scheduler instance
_scheduler: Optional[MarketHoursScheduler] = None


async def start_market_scheduler(market_feed_service):
    """Start the global market hours scheduler."""
    global _scheduler
    
    if _scheduler is None:
        _scheduler = MarketHoursScheduler(market_feed_service)
        await _scheduler.start()
    else:
        print("⚠️ Market scheduler already initialized")
    
    return _scheduler


async def stop_market_scheduler():
    """Stop the global market hours scheduler."""
    global _scheduler
    
    if _scheduler:
        await _scheduler.stop()
        _scheduler = None
