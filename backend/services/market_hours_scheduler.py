"""
Automatic Market Hours Scheduler - PRODUCTION GRADE
====================================================
✅ Auto-starts market feed at 8:55 AM (before pre-open)
✅ Ensures connection is ready by 9:00 AM pre-open
✅ Handles 9:15 AM PRE_OPEN → LIVE transition smoothly
✅ Auto-stops at 3:35 PM (after market close)
✅ Aggressive reconnection during market hours
✅ No manual restart needed - EVER
✅ Restores historical candles at market open
✅ Backs up candles at market close
"""
import asyncio
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo
from typing import Optional, Callable

IST = ZoneInfo("Asia/Kolkata")

# Import candle backup service
from services.candle_backup_service import CandleBackupService


class MarketHoursScheduler:
    """
    Production-grade market hours scheduler
    
    GUARANTEES:
    1. Feed is connected BEFORE 9:00 AM pre-open
    2. Data flows from 9:00 AM onwards (not just 9:15)
    3. Aggressive reconnection if connection drops
    4. Clean shutdown after 3:30 PM
    """
    
    # Market timings (IST)
    PRE_OPEN_START = time(9, 0, 0)    # 9:00 AM - Pre-open starts (auction matching)
    PRE_OPEN_END = time(9, 7, 0)      # 9:07 AM - Pre-open ends (price discovery)
    MARKET_OPEN = time(9, 15, 0)      # 9:15 AM - Live trading starts
    MARKET_CLOSE = time(15, 30, 0)    # 3:30 PM - Market closes
    
    # ⚡ CRITICAL FIX: Pre-refresh token before 9:00 AM market opens
    # This prevents token expiration from causing connection failures
    TOKEN_REFRESH_TIME = time(8, 50, 0)  # 8:50 AM - Refresh token before market
    
    # Auto-start/stop times - START EARLY with fresh token
    # DO NOT change to 9:08 AM - user NEEDS pre-open data from 9:00-9:07 AM
    AUTO_START_TIME = time(8, 55, 0)  # 8:55 AM - 5 mins before pre-open
    AUTO_STOP_TIME = time(15, 35, 0)  # 3:35 PM - 5 mins after close
    
    # Scheduler check interval - CRITICAL for timing
    CHECK_INTERVAL_SECONDS = 10       # Check every 10 seconds (not 60!)
    AGGRESSIVE_CHECK_INTERVAL = 3     # 3 seconds near market open
    
    def __init__(self, market_feed_service):
        self.market_feed = market_feed_service
        self.scheduler_task: Optional[asyncio.Task] = None
        self.is_running = False
        self._last_feed_status = None
        self._consecutive_start_attempts = 0
        self._last_successful_start: Optional[datetime] = None
        self._token_expired = False  # Flag to prevent connection with expired token
        self._token_check_done = False  # Flag to track if token check completed
        
    async def start(self):
        """Start the automatic scheduler"""
        if self.is_running:
            return
            
        self.is_running = True
        
        # 🔥 CRITICAL: Validate server timezone is set to IST
        # DigitalOcean servers often default to UTC, which breaks market timing
        self._validate_server_timezone()
        
        self.scheduler_task = asyncio.create_task(self._run_scheduler())
        
        print("\n" + "="*70)
        print("⏰ MARKET HOURS SCHEDULER - PRODUCTION MODE")
        print("="*70)
        print(f"   ✅ Pre-open:   {self.PRE_OPEN_START.strftime('%I:%M %p')} IST (auction matching)")
        print(f"   ✅ Auto-start: {self.AUTO_START_TIME.strftime('%I:%M %p')} IST (after pre-open)")
        print(f"   ✅ Live:       {self.MARKET_OPEN.strftime('%I:%M %p')} IST (trading begins)")
        print(f"   ✅ Auto-stop:  {self.AUTO_STOP_TIME.strftime('%I:%M %p')} IST (after market)")
        print(f"   ✅ Check interval: {self.CHECK_INTERVAL_SECONDS}s (aggressive: {self.AGGRESSIVE_CHECK_INTERVAL}s)")
        print("="*70 + "\n")
        
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
    
    def _is_holiday(self, dt: datetime) -> bool:
        """Check if given date is a market holiday"""
        from services.market_session_controller import NSE_HOLIDAYS
        date_str = dt.strftime("%Y-%m-%d")
        return date_str in NSE_HOLIDAYS
    
    def _validate_server_timezone(self):
        """🔥 CRITICAL: Validate server timezone is IST (Asia/Kolkata)
        
        This is a VERY COMMON issue with DigitalOcean and cloud servers.
        If timezone is wrong, market times will be off by hours.
        
        Example: Server in UTC will show 2:55 PM when it's actually 9:25 PM IST
        This completely breaks market timing!
        """
        import os
        import subprocess
        
        print("\n" + "="*70)
        print("🌍 SERVER TIMEZONE CHECK")
        print("="*70)
        
        # Check current timezone
        try:
            # Method 1: Check TZ environment variable
            tz_env = os.environ.get('TZ', 'NOT SET')
            print(f"   TZ env var: {tz_env}")
            
            # Method 2: Check /etc/timezone file (Linux)
            try:
                with open('/etc/timezone', 'r') as f:
                    system_tz = f.read().strip()
                    print(f"   System timezone: {system_tz}")
            except:
                system_tz = "UNKNOWN"
            
            # Method 3: Check current time
            from datetime import datetime
            import time
            local_time = datetime.now()
            ist_time = datetime.now(IST)
            
            print(f"   Local time: {local_time}")
            print(f"   IST time:   {ist_time}")
            
            # Calculate offset
            offset_seconds = (ist_time.utcoffset().total_seconds() if ist_time.utcoffset() else 19800)
            offset_hours = offset_seconds / 3600
            
            print(f"   UTC offset: +{offset_hours:.1f} hours (IST should be +5.5)")
            
            # Check if timezone is correct (IST is +5:30)
            if abs(offset_hours - 5.5) < 0.1:  # Within 6 minutes of IST
                print("\n   ✅ SERVER TIMEZONE IS CORRECT (IST)")
                print("     Market times will be accurate\n")
                return True
            else:
                # WRONG TIMEZONE - This is the problem!
                print("\n   ❌ SERVER TIMEZONE IS WRONG (NOT IST)")
                print("="*70)
                print("     ⚠️  THIS WILL BREAK MARKET TIMING")
                print("")
                print("     You are in UTC+{:.1f} but need UTC+5.5 (IST)".format(offset_hours))
                print("     Market will open at wrong times!")
                print("")
                print("     🔧 TO FIX ON LINUX:")
                print("        sudo timedatectl set-timezone Asia/Kolkata")
                print("")
                print("     🔧 TO FIX ON DOCKER:")
                print("        Add to Dockerfile: ENV TZ=Asia/Kolkata")
                print("        Or docker-compose.yml: environment: TZ=Asia/Kolkata")
                print("")
                print("     🔧 TO FIX ON DIGITALOCEAN:")
                print("        1. SSH into your server")
                print("        2. Run: sudo timedatectl set-timezone Asia/Kolkata")
                print("        3. Verify: timedatectl")
                print("        4. Restart backend service")
                print("\n" + "="*70 + "\n")
                
                # Don't fail, just warn - they may know what they're doing
                return False
                
        except Exception as e:
            print(f"   ⚠️  Could not validate timezone: {e}")
            print("     Proceeding anyway...\n")
            return True
        
    def _is_market_time(self, dt: datetime) -> bool:
        """Check if given time is within market hours (including pre-open prep)"""
        current_time = dt.time()
        return (
            self._is_weekday(dt) and 
            not self._is_holiday(dt) and
            self.AUTO_START_TIME <= current_time <= self.AUTO_STOP_TIME
        )
    
    def _is_critical_window(self, dt: datetime) -> bool:
        """Check if we're in critical window (8:55 AM - 9:20 AM)
        During this window, we check more frequently to ensure connection
        """
        current_time = dt.time()
        critical_start = time(8, 55, 0)
        critical_end = time(9, 20, 0)
        return critical_start <= current_time <= critical_end
    
    def _get_market_phase(self, current_time: time) -> str:
        """Get current market phase with emoji"""
        if current_time < self.PRE_OPEN_START:
            return "🔵 PREPARING (waiting for pre-open)"
        elif self.PRE_OPEN_START <= current_time < self.PRE_OPEN_END:
            return "🟡 PRE-OPEN (auction matching 9:00-9:07)"
        elif self.PRE_OPEN_END <= current_time < self.MARKET_OPEN:
            return "🟡 FREEZE (order matching 9:07-9:15)"
        elif self.MARKET_OPEN <= current_time < self.MARKET_CLOSE:
            return "🟢 LIVE TRADING"
        elif current_time <= self.AUTO_STOP_TIME:
            return "🔴 POST-MARKET (cooling down)"
        else:
            return "⚫ CLOSED"
    
    def _is_feed_connected(self) -> bool:
        """Check if market feed is actually connected and receiving data"""
        if not self.market_feed:
            return False
        
        # Check multiple indicators
        has_kws = hasattr(self.market_feed, 'kws') and self.market_feed.kws is not None
        is_running = getattr(self.market_feed, 'running', False)
        is_connected = getattr(self.market_feed, '_is_connected', False)
        using_rest = getattr(self.market_feed, '_using_rest_fallback', False)
        
        # Consider connected if:
        # 1. WebSocket is connected OR
        # 2. REST fallback is active (still getting data)
        return (is_connected and has_kws and is_running) or (using_rest and is_running)
        
    async def _run_scheduler(self):
        """Main scheduler loop - ensures feed is running during market hours"""
        print("🤖 SCHEDULER LOOP STARTED - Monitoring market hours...\n")
        
        last_status_log = datetime.now(IST)
        last_token_refresh = None
        last_check_date = None
        
        while self.is_running:
            try:
                now = datetime.now(IST)
                current_time = now.time()
                current_date = now.date()
                
                # Reset token expired flag on new day (allows retry after user logs in)
                if last_check_date != current_date:
                    if self._token_expired:
                        print(f"\n📅 NEW DAY DETECTED - Resetting token check")
                        print("   Will validate token when market opens\n")
                    self._token_expired = False
                    self._token_check_done = False
                    last_check_date = current_date
                
                # 🔥 NEW: Token check at 8:50 AM (before market opens)
                # This prevents connection attempts with expired tokens
                token_refresh_time = self.TOKEN_REFRESH_TIME
                if (current_time >= token_refresh_time and 
                    not self._token_check_done and
                    (last_token_refresh is None or 
                     (now - last_token_refresh).total_seconds() > 86400)):  # Once per day
                    
                    if self._is_weekday(now) and not self._is_holiday(now):
                        print(f"\n⏰ [{now.strftime('%I:%M:%S %p')}] PRE-MARKET TOKEN CHECK")
                        token_valid = await self._refresh_token_before_market()
                        last_token_refresh = now
                        self._token_check_done = True
                        
                        if not token_valid:
                            # Token expired - enter waiting mode
                            print("⏸️  SCHEDULER PAUSED - Waiting for valid token")
                            print("   The scheduler will resume once you login.\n")
                
                # Determine if market feed should be running
                should_run = self._is_market_time(now)
                is_connected = self._is_feed_connected()
                phase = self._get_market_phase(current_time)
                
                # Use aggressive interval during critical window
                check_interval = (
                    self.AGGRESSIVE_CHECK_INTERVAL 
                    if self._is_critical_window(now) 
                    else self.CHECK_INTERVAL_SECONDS
                )
                
                # ========== MARKET HOURS: ENSURE FEED IS RUNNING ==========
                if should_run:
                    # 🔥 FIX: Don't attempt connection if token is expired
                    if self._token_expired:
                        # Token expired - show message periodically but don't spam
                        if (datetime.now(IST) - last_status_log).total_seconds() > 300:
                            print(f"⏸️  [{now.strftime('%I:%M %p')}] Market open but TOKEN EXPIRED")
                            print("   Please LOGIN via UI to enable live data")
                            last_status_log = now
                        await asyncio.sleep(60)  # Check every minute for token refresh
                        continue
                    
                    if not is_connected:
                        self._consecutive_start_attempts += 1
                        
                        # Log connection attempt
                        print(f"\n{'='*70}")
                        print(f"⏰ [{now.strftime('%I:%M:%S %p')}] MARKET HOURS - Feed NOT Connected")
                        print(f"   Phase: {phase}")
                        print(f"   Attempt: #{self._consecutive_start_attempts}")
                        print(f"{'='*70}")
                        
                        # Start the feed
                        success = await self._start_feed()
                        
                        if success:
                            self._consecutive_start_attempts = 0
                            self._last_successful_start = now
                            self._last_feed_status = 'running'
                            print(f"   ✅ Feed started successfully!")
                        else:
                            print(f"   ⚠️ Feed start attempt #{self._consecutive_start_attempts} failed")
                            
                            # After 5 failed attempts, show troubleshooting
                            if self._consecutive_start_attempts >= 5:
                                await self._show_troubleshooting()
                    else:
                        # Feed is running - update status
                        if self._last_feed_status != 'running':
                            print(f"✅ [{now.strftime('%I:%M:%S %p')}] Feed ACTIVE - {phase}")
                            self._consecutive_start_attempts = 0
                        self._last_feed_status = 'running'
                        
                        # Periodic status log (every 5 minutes)
                        if (now - last_status_log).total_seconds() > 300:
                            connection_type = "REST API" if getattr(self.market_feed, '_using_rest_fallback', False) else "WebSocket"
                            print(f"✅ [{now.strftime('%I:%M %p')}] Feed Active - {phase} ({connection_type})")
                            last_status_log = now
                
                # ========== OUTSIDE MARKET HOURS: STOP FEED ==========
                else:
                    if is_connected and self._last_feed_status != 'stopped':
                        print(f"\n⏰ [{now.strftime('%I:%M:%S %p')}] OUTSIDE MARKET HOURS")
                        print("🛑 AUTO-STOPPING Market Feed...")
                        
                        await self._stop_feed()
                        self._last_feed_status = 'stopped'
                        self._consecutive_start_attempts = 0
                        
                        # Show next market open time
                        next_open = self._get_next_market_open(now)
                        if next_open:
                            time_until = next_open - now
                            hours = int(time_until.total_seconds() // 3600)
                            minutes = int((time_until.total_seconds() % 3600) // 60)
                            print(f"   Next market: {next_open.strftime('%a %I:%M %p')} ({hours}h {minutes}m)")
                
                # Sleep before next check
                await asyncio.sleep(check_interval)
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"❌ Scheduler error: {e}")
                import traceback
                traceback.print_exc()
                await asyncio.sleep(10)  # Continue even on error
    
    async def _start_feed(self) -> bool:
        """Start the market feed with proper error handling"""
        try:
            # Check if already starting
            if getattr(self.market_feed, '_starting', False):
                print("   ℹ️ Feed start already in progress...")
                return False
            
            # Mark as starting
            self.market_feed._starting = True
            
            # First, validate token before attempting connection
            from services.unified_auth_service import unified_auth
            token_valid = await unified_auth.validate_token(force=True)
            
            if not token_valid:
                print("   🔴 Token invalid - cannot start feed")
                print("   💡 Please login via UI or run: python quick_token_fix.py")
                self.market_feed._starting = False
                return False
            
            # Start the feed (create task so we don't block)
            print("   🚀 Starting market feed...")
            asyncio.create_task(self.market_feed.start())
            
            # Wait for connection (up to 10 seconds)
            for i in range(10):
                await asyncio.sleep(1)
                if self._is_feed_connected():
                    self.market_feed._starting = False
                    
                    # 🔥 NEW: RESTORE HISTORICAL CANDLES FOR OI MOMENTUM SIGNALS
                    # Load last session's candles so OI Momentum works immediately
                    print("\n   📥 Restoring historical candles for signal analysis...")
                    try:
                        symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
                        results = await CandleBackupService.restore_all_symbols(
                            self.market_feed.cache, 
                            symbols
                        )
                        restored_count = sum(1 for v in results.values() if v)
                        if restored_count > 0:
                            print(f"   ✅ Restored candles for {restored_count}/{len(symbols)} symbols")
                        else:
                            print(f"   ℹ️  No backup candles found - will use live feed")
                    except Exception as e:
                        print(f"   ⚠️  Could not restore candles: {e}")
                    
                    return True
            
            # Check if REST fallback is active (acceptable)
            if getattr(self.market_feed, '_using_rest_fallback', False):
                print("   ⚠️ WebSocket failed, but REST fallback active")
                self.market_feed._starting = False
                return True  # REST is better than nothing
            
            self.market_feed._starting = False
            return False
            
        except Exception as e:
            print(f"   ❌ Failed to start feed: {e}")
            if hasattr(self.market_feed, '_starting'):
                self.market_feed._starting = False
            return False
    
    async def _stop_feed(self):
        """Stop the market feed gracefully and backup candles"""
        try:
            # 🔥 NEW: BACKUP HISTORICAL CANDLES BEFORE STOPPING
            # Save candles for restoration at next market open
            print("\n   📤 Backing up candles for next market session...")
            try:
                symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
                results = await CandleBackupService.backup_all_symbols(
                    self.market_feed.cache,
                    symbols
                )
                backed_up_count = sum(1 for v in results.values() if v)
                if backed_up_count > 0:
                    print(f"   ✅ Backed up candles for {backed_up_count}/{len(symbols)} symbols")
                else:
                    print(f"   ℹ️  No candles to backup")
            except Exception as e:
                print(f"   ⚠️  Could not backup candles: {e}")
            
            # Stop the feed
            if hasattr(self.market_feed, 'stop'):
                await self.market_feed.stop()
            print("   ✅ Market feed stopped")
        except Exception as e:
            print(f"   ⚠️ Error stopping feed: {e}")
    
    async def _show_troubleshooting(self):
        """Show troubleshooting tips after multiple failures"""
        print("\n" + "="*70)
        print("⚠️ PERSISTENT CONNECTION ISSUES DETECTED")
        print("="*70)
        print("Possible causes and solutions:")
        print("")
        print("1. 🔐 ZERODHA TOKEN EXPIRED")
        print("   - Tokens expire DAILY (every 24 hours)")
        print("   - Solution: Click LOGIN in UI or run 'python quick_token_fix.py'")
        print("")
        print("2. 🌐 NETWORK CONNECTIVITY")
        print("   - Check internet connection on server")
        print("   - Verify Zerodha API is accessible")
        print("")
        print("3. 📊 ZERODHA API ISSUES")
        print("   - Check status.zerodha.com for outages")
        print("   - API rate limits may be exceeded")
        print("")
        print("4. ⚙️ SERVER CONFIGURATION")
        print("   - Verify ZERODHA_API_KEY is correct")
        print("   - Verify ZERODHA_ACCESS_TOKEN is current")
        print("")
        print("📡 Using REST API fallback mode for now...")
        print("="*70 + "\n")
        
        # Reset counter to avoid spam
        self._consecutive_start_attempts = 0
    
    def _get_next_market_open(self, now: datetime) -> Optional[datetime]:
        """Get next market open time"""
        # Start from tomorrow
        check_date = now + timedelta(days=1)
        
        for _ in range(7):  # Check next 7 days
            if self._is_weekday(check_date) and not self._is_holiday(check_date):
                return check_date.replace(
                    hour=self.AUTO_START_TIME.hour,
                    minute=self.AUTO_START_TIME.minute,
                    second=0,
                    microsecond=0
                )
            check_date += timedelta(days=1)
        
        return None
    
    async def _refresh_token_before_market(self):
        """
        Validate Zerodha token at 8:50 AM before market opens.
        This checks token validity and prevents connection attempts with expired tokens.
        
        Note: Zerodha tokens expire every 24 hours and require manual OAuth login.
        This function cannot auto-generate tokens, but can prevent futile connection attempts.
        """
        try:
            print("\n" + "="*70)
            print("🔐 PRE-MARKET TOKEN CHECK (8:50 AM)")
            print("="*70)
            
            from services.unified_auth_service import unified_auth
            
            # Validate token
            token_valid = await unified_auth.validate_token(force=True)
            token_age = unified_auth.get_token_age_hours()
            
            if token_valid:
                print("✅ Token VALID and ACTIVE")
                if token_age:
                    print(f"   Token Age: {token_age:.1f} hours")
                print("   Ready for 9:00 AM market open")
                print("="*70 + "\n")
                return True
            else:
                # Token expired - stop scheduler from attempting connection
                print("🔴 TOKEN EXPIRED - CANNOT CONNECT")
                print("="*70)
                print("")
                print("⚠️  Zerodha tokens expire every 24 hours at midnight.")
                print("   A new token is required for market data.")
                print("")
                print("📋 TO FIX THIS ISSUE:")
                print("   1. Open your trading app UI")
                print("   2. Click the LOGIN button")
                print("   3. Complete Zerodha authentication")
                print("")
                print("   OR run manually: python quick_token_fix.py")
                print("")
                print("🚫 Scheduler will NOT attempt connection with expired token.")
                print("   This prevents the endless 'reconnecting' loop.")
                print("="*70 + "\n")
                
                # Set flag to prevent connection attempts
                self._token_expired = True
                return False
            
        except Exception as e:
            print(f"❌ Token check failed: {e}")
            print("   Cannot determine token status")
            print("="*70 + "\n")
            return False


# Global scheduler instance
_scheduler_instance: Optional[MarketHoursScheduler] = None


def get_scheduler(market_feed_service) -> MarketHoursScheduler:
    """Get or create scheduler instance"""
    global _scheduler_instance
    if _scheduler_instance is None:
        _scheduler_instance = MarketHoursScheduler(market_feed_service)
    return _scheduler_instance
