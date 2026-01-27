"""
Market Session Configuration
Centralized market timing management - no hardcoded hours in code
All times in IST (Indian Standard Time)
"""

from datetime import time
from typing import Dict, Any
import os

class MarketSession:
    """Configuration for market trading sessions"""
    
    def __init__(self):
        # Load from environment or use defaults
        self.PRE_OPEN_START = self._parse_time(os.getenv("MARKET_PRE_OPEN_START", "09:00"))
        self.PRE_OPEN_END = self._parse_time(os.getenv("MARKET_PRE_OPEN_END", "09:15"))
        self.MARKET_OPEN = self._parse_time(os.getenv("MARKET_OPEN", "09:15"))
        self.MARKET_CLOSE = self._parse_time(os.getenv("MARKET_CLOSE", "15:30"))
        
        # Weekend days (0=Monday, 5=Saturday, 6=Sunday)
        weekend_str = os.getenv("MARKET_WEEKEND_DAYS", "5,6")
        self.WEEKEND_DAYS = set(int(x.strip()) for x in weekend_str.split(","))
        
        # Timezone
        self.TIMEZONE = os.getenv("MARKET_TIMEZONE", "Asia/Kolkata")
    
    @staticmethod
    def _parse_time(time_str: str) -> time:
        """Parse time string HH:MM to time object"""
        hour, minute = map(int, time_str.split(":"))
        return time(hour, minute)
    
    def get_config(self) -> Dict[str, Any]:
        """Get market session configuration as dict"""
        return {
            "pre_open_start": self.PRE_OPEN_START,
            "pre_open_end": self.PRE_OPEN_END,
            "market_open": self.MARKET_OPEN,
            "market_close": self.MARKET_CLOSE,
            "weekend_days": self.WEEKEND_DAYS,
            "timezone": self.TIMEZONE,
        }
    
    def __repr__(self) -> str:
        return (
            f"MarketSession(\n"
            f"  PRE_OPEN: {self.PRE_OPEN_START.strftime('%H:%M')}-{self.PRE_OPEN_END.strftime('%H:%M')},\n"
            f"  MARKET: {self.MARKET_OPEN.strftime('%H:%M')}-{self.MARKET_CLOSE.strftime('%H:%M')},\n"
            f"  TIMEZONE: {self.TIMEZONE}\n"
            f")"
        )


# Global instance
market_session_config = MarketSession()

def get_market_session() -> MarketSession:
    """Get market session configuration"""
    return market_session_config
