"""
OI Change Chart Configuration
All strike ranges, expiry patterns, and display settings
"""
from datetime import datetime, timedelta
from typing import Dict, List
import pytz

IST = pytz.timezone('Asia/Kolkata')


class OIChartConfig:
    """Configuration for OI change charts - all in one place"""
    
    # ==================== SYMBOL SETTINGS ====================
    SYMBOLS: Dict[str, Dict] = {
        "NIFTY": {
            "name": "NIFTY",
            "exchange": "NFO",  # NSE F&O
            "strike_range": 400,  # ±400 points from ATM
            "strike_step": 50,    # 50 point intervals
            "display_name": "NIFTY 50",
            "color_call": "#ef4444",  # Red
            "color_put": "#10b981",   # Green
        },
        "BANKNIFTY": {
            "name": "BANKNIFTY",
            "exchange": "NFO",
            "strike_range": 1000,  # ±1000 points from ATM
            "strike_step": 100,    # 100 point intervals
            "display_name": "BANK NIFTY",
            "color_call": "#dc2626",  # Dark Red
            "color_put": "#059669",   # Dark Green
        },
        "SENSEX": {
            "name": "SENSEX",
            "exchange": "BFO",  # BSE F&O
            "strike_range": 1000,  # ±1000 points from ATM
            "strike_step": 100,   # 100 point intervals
            "display_name": "SENSEX",
            "color_call": "#f87171",  # Light Red
            "color_put": "#34d399",   # Light Green
        }
    }
    
    # ==================== EXPIRY SETTINGS ====================
    @staticmethod
    def get_current_weekly_expiry(symbol: str) -> str:
        """
        Get current weekly expiry for symbol
        NIFTY: Thursday, BANKNIFTY: Wednesday, SENSEX: Friday
        Returns: YYYY-MM-DD format
        """
        now = datetime.now(IST)
        
        # Expiry days (0=Monday, 6=Sunday)
        expiry_days = {
            "NIFTY": 3,      # Thursday
            "BANKNIFTY": 2,  # Wednesday  
            "SENSEX": 4      # Friday
        }
        
        target_day = expiry_days.get(symbol, 3)
        current_day = now.weekday()
        
        # Days until target
        days_ahead = target_day - current_day
        if days_ahead < 0 or (days_ahead == 0 and now.hour >= 15):
            # Already expired or past 3:30 PM on expiry day
            days_ahead += 7
        
        expiry_date = now + timedelta(days=days_ahead)
        return expiry_date.strftime("%Y-%m-%d")
    
    # ==================== PERFORMANCE SETTINGS ====================
    CACHE_TTL: int = 10  # seconds - cache OI data
    UPDATE_INTERVAL: int = 15  # seconds - update frequency
    MAX_STRIKES: int = 25  # Maximum strikes per side (CE/PE)
    
    # ==================== API LIMITS ====================
    BATCH_SIZE: int = 100  # Max tokens per quote() call
    RATE_LIMIT_DELAY: float = 0.3  # seconds between calls
    
    # ==================== DISPLAY SETTINGS ====================
    CHART_HEIGHT: int = 400  # pixels
    SHOW_GRID: bool = True
    ANIMATE: bool = True
    SHOW_LEGEND: bool = True
    
    @classmethod
    def get_strike_range(cls, symbol: str, spot_price: float) -> List[int]:
        """
        Get strike range around spot price
        Returns: List of strikes [ATM-range, ..., ATM, ..., ATM+range]
        """
        config = cls.SYMBOLS.get(symbol)
        if not config:
            return []
        
        strike_range = config["strike_range"]
        strike_step = config["strike_step"]
        
        # Round spot to nearest strike
        atm = round(spot_price / strike_step) * strike_step
        
        # Generate strikes
        strikes = []
        current = atm - strike_range
        while current <= atm + strike_range:
            strikes.append(int(current))
            current += strike_step
        
        return strikes
    
    @classmethod
    def validate_config(cls) -> bool:
        """Validate configuration on startup"""
        required_keys = ["name", "exchange", "strike_range", "strike_step"]
        
        for symbol, config in cls.SYMBOLS.items():
            for key in required_keys:
                if key not in config:
                    print(f"❌ Missing {key} in {symbol} config")
                    return False
        
        print("✅ OI Chart Configuration validated")
        return True


# Validate on import
OIChartConfig.validate_config()
