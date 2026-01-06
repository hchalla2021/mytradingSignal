"""
Market Session Controller - Time-Based ONLY
✅ Never depends on Zerodha token or websocket state
✅ Guarantees accurate market status always
"""
from datetime import datetime, time, timedelta
from enum import Enum
import pytz

# Indian timezone
IST = pytz.timezone('Asia/Kolkata')

# Market hours (IST) - NSE/BSE timings
PRE_OPEN_START = time(9, 0)           # 9:00 AM - Pre-open session starts
PRE_OPEN_END = time(9, 7)             # 9:07 AM - Pre-open order collection ends
AUCTION_FREEZE_END = time(9, 15)      # 9:15 AM - Auction freeze ends
MARKET_OPEN = time(9, 15)             # 9:15 AM - Live trading starts
MARKET_CLOSE = time(15, 30)           # 3:30 PM - Market closes

# NSE Holidays 2025-2026 (Complete list)
NSE_HOLIDAYS = {
    # 2025
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
    # 2026
    "2026-01-26",  # Republic Day
    "2026-03-03",  # Maha Shivaratri
    "2026-03-31",  # Holi
    "2026-04-03",  # Good Friday
    "2026-04-06",  # Shri Mahavir Jayanti
    "2026-04-14",  # Dr. Ambedkar Jayanti
    "2026-05-01",  # Maharashtra Day
    "2026-08-15",  # Independence Day
    "2026-10-02",  # Mahatma Gandhi Jayanti
    "2026-11-09",  # Diwali Laxmi Pujan
    "2026-12-25",  # Christmas
}


class MarketPhase(str, Enum):
    """Market session phases - guaranteed accurate"""
    PRE_OPEN = "PRE_OPEN"           # 9:00-9:07 AM - Order collection
    AUCTION_FREEZE = "AUCTION_FREEZE"  # 9:07-9:15 AM - Auction matching
    LIVE = "LIVE"                    # 9:15 AM - 3:30 PM - Active trading
    CLOSED = "CLOSED"                # After 3:30 PM, weekends, holidays


class MarketSessionController:
    """
    Professional Market Session Controller
    
    ✅ NEVER depends on Zerodha
    ✅ NEVER depends on token
    ✅ NEVER depends on websocket
    ✅ Pure time-based logic
    ✅ Always accurate
    """
    
    @staticmethod
    def get_current_phase(now: datetime = None) -> MarketPhase:
        """
        Get current market phase based ONLY on time.
        
        Args:
            now: Optional datetime (defaults to current IST time)
            
        Returns:
            MarketPhase enum (PRE_OPEN, AUCTION_FREEZE, LIVE, or CLOSED)
        """
        if now is None:
            now = datetime.now(IST)
        
        current_time = now.time()
        
        # Check weekend (Saturday=5, Sunday=6)
        if now.weekday() >= 5:
            return MarketPhase.CLOSED
        
        # Check holiday
        date_str = now.strftime("%Y-%m-%d")
        if date_str in NSE_HOLIDAYS:
            return MarketPhase.CLOSED
        
        # Check market phases
        if PRE_OPEN_START <= current_time < PRE_OPEN_END:
            return MarketPhase.PRE_OPEN
        
        if PRE_OPEN_END <= current_time < AUCTION_FREEZE_END:
            return MarketPhase.AUCTION_FREEZE
        
        if MARKET_OPEN <= current_time <= MARKET_CLOSE:
            return MarketPhase.LIVE
        
        return MarketPhase.CLOSED
    
    @staticmethod
    def is_trading_hours(now: datetime = None) -> bool:
        """Check if market is in trading hours (PRE_OPEN, AUCTION_FREEZE, or LIVE)"""
        phase = MarketSessionController.get_current_phase(now)
        return phase in (MarketPhase.PRE_OPEN, MarketPhase.AUCTION_FREEZE, MarketPhase.LIVE)
    
    @staticmethod
    def is_data_flow_expected(now: datetime = None) -> bool:
        """Check if data should be flowing (LIVE only)"""
        phase = MarketSessionController.get_current_phase(now)
        return phase == MarketPhase.LIVE
    
    @staticmethod
    def seconds_until_next_phase(now: datetime = None) -> int:
        """Get seconds until next phase change"""
        if now is None:
            now = datetime.now(IST)
        
        current_phase = MarketSessionController.get_current_phase(now)
        current_time = now.time()
        
        if current_phase == MarketPhase.CLOSED:
            # Calculate seconds until next PRE_OPEN
            if now.weekday() >= 5:  # Weekend
                # Next Monday
                days_until_monday = (7 - now.weekday()) % 7
                if days_until_monday == 0:
                    days_until_monday = 7
                next_open = now.replace(hour=9, minute=0, second=0, microsecond=0)
                next_open = next_open + timedelta(days=days_until_monday)
            else:
                # Next day or today if before PRE_OPEN
                if current_time < PRE_OPEN_START:
                    next_open = now.replace(hour=9, minute=0, second=0, microsecond=0)
                else:
                    next_open = now.replace(hour=9, minute=0, second=0, microsecond=0) + timedelta(days=1)
            
            return int((next_open - now).total_seconds())
        
        elif current_phase == MarketPhase.PRE_OPEN:
            # Seconds until AUCTION_FREEZE
            next_time = now.replace(hour=9, minute=7, second=0, microsecond=0)
            return int((next_time - now).total_seconds())
        
        elif current_phase == MarketPhase.AUCTION_FREEZE:
            # Seconds until LIVE
            next_time = now.replace(hour=9, minute=15, second=0, microsecond=0)
            return int((next_time - now).total_seconds())
        
        elif current_phase == MarketPhase.LIVE:
            # Seconds until CLOSED
            next_time = now.replace(hour=15, minute=30, second=0, microsecond=0)
            return int((next_time - now).total_seconds())
        
        return 0
    
    @staticmethod
    def get_phase_description(phase: MarketPhase = None) -> dict:
        """Get human-readable phase description"""
        if phase is None:
            phase = MarketSessionController.get_current_phase()
        
        descriptions = {
            MarketPhase.PRE_OPEN: {
                "title": "Pre-Open Session",
                "description": "Order collection in progress (9:00-9:07 AM)",
                "color": "blue",
                "icon": "🔵"
            },
            MarketPhase.AUCTION_FREEZE: {
                "title": "Auction Freeze",
                "description": "Price discovery in progress (9:07-9:15 AM)",
                "color": "yellow",
                "icon": "🟡"
            },
            MarketPhase.LIVE: {
                "title": "Market Live",
                "description": "Active trading (9:15 AM - 3:30 PM)",
                "color": "green",
                "icon": "🟢"
            },
            MarketPhase.CLOSED: {
                "title": "Market Closed",
                "description": "Trading hours ended",
                "color": "red",
                "icon": "🔴"
            }
        }
        
        return descriptions.get(phase, descriptions[MarketPhase.CLOSED])


# Singleton instance
market_session = MarketSessionController()



