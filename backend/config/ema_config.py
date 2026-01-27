"""
EMA Configuration & Trend Filter System
=========================================
Professional technical analysis parameters for intraday trading
Configurable for different symbols and timeframes
"""

from typing import Dict, List, Tuple
from enum import Enum


class EMAPeriods(Enum):
    """Standard EMA period configurations for different trading styles"""
    
    # New Professional Configuration: 20/50/100/200
    INTRADAY_PRO = {
        "fast": 20,      # Quick entry/exit signals
        "medium": 50,    # Mid-term trend filter
        "slow": 100,     # Trend confirmation
        "anchor": 200    # Long-term anchor (rare breakouts)
    }
    
    # Legacy configuration (for reference/rollback)
    LEGACY_QUICK = {
        "fast": 9,
        "medium": 21,
        "slow": 50,
        "anchor": 200
    }
    
    # Aggressive scalping
    SCALP_FAST = {
        "fast": 5,
        "medium": 13,
        "slow": 34,
        "anchor": 89
    }
    
    # Swing trading
    SWING_MID = {
        "fast": 12,
        "medium": 26,
        "slow": 52,
        "anchor": 200
    }


# ============================================
# ACTIVE CONFIGURATION - CHANGE THIS TO ADJUST
# ============================================
ACTIVE_EMA_CONFIG = EMAPeriods.INTRADAY_PRO.value


class TrendFilterSystem:
    """Professional EMA-based trend filter with multiple signals"""
    
    def __init__(self, config: Dict[str, int] = None):
        """Initialize with EMA periods configuration"""
        self.config = config or ACTIVE_EMA_CONFIG
        self.ema_20 = self.config.get("fast", 20)
        self.ema_50 = self.config.get("medium", 50)
        self.ema_100 = self.config.get("slow", 100)
        self.ema_200 = self.config.get("anchor", 200)
        
        # Main EMAs for analysis
        self.main_emas = [self.ema_20, self.ema_50, self.ema_100, self.ema_200]
    
    def get_ema_periods(self) -> Tuple[int, int, int, int]:
        """Get current EMA periods as tuple (fast, medium, slow, anchor)"""
        return (self.ema_20, self.ema_50, self.ema_100, self.ema_200)
    
    def get_ema_periods_dict(self) -> Dict[str, int]:
        """Get current EMA periods as dictionary"""
        return {
            "ema_20": self.ema_20,
            "ema_50": self.ema_50,
            "ema_100": self.ema_100,
            "ema_200": self.ema_200
        }
    
    def get_config_name(self) -> str:
        """Get the name of active configuration"""
        for config in EMAPeriods:
            if config.value == self.config:
                return config.name
        return "CUSTOM"
    
    def determine_trend(self, price: float, ema_20: float, ema_50: float, 
                       ema_100: float, ema_200: float) -> str:
        """
        Determine primary trend using EMA alignment
        ============================================
        BULLISH Signal:
        - Price > EMA20 > EMA50 > EMA100 > EMA200 (Perfect alignment)
        - Price > EMA50 and EMA20 > EMA50 (Strong uptrend)
        - Price > EMA20 (At least breaking fast MA)
        
        BEARISH Signal:
        - Price < EMA20 < EMA50 < EMA100 < EMA200 (Perfect alignment)
        - Price < EMA50 and EMA20 < EMA50 (Strong downtrend)
        - Price < EMA20 (Breaking below fast MA)
        
        NEUTRAL/CONSOLIDATION:
        - Conflicting EMA alignment (e.g., price above EMA20 but below EMA50)
        - EMAs compressed together or tangled
        """
        
        # Perfect bullish alignment
        if (price > ema_20 > ema_50 > ema_100 > ema_200):
            return "STRONG_BULLISH"
        
        # Perfect bearish alignment
        if (price < ema_20 < ema_50 < ema_100 < ema_200):
            return "STRONG_BEARISH"
        
        # Strong bullish (price above key MAs)
        if (price > ema_50 and ema_20 > ema_50 > ema_100):
            return "BULLISH"
        
        # Strong bearish (price below key MAs)
        if (price < ema_50 and ema_20 < ema_50 < ema_100):
            return "BEARISH"
        
        # Weak bullish signals
        if (price > ema_20 and ema_20 > ema_50):
            return "MILD_BULLISH"
        
        # Weak bearish signals
        if (price < ema_20 and ema_20 < ema_50):
            return "MILD_BEARISH"
        
        # Consolidation/Ranging
        return "NEUTRAL"
    
    def get_trend_detail(self, price: float, ema_20: float, ema_50: float,
                        ema_100: float, ema_200: float) -> Dict:
        """
        In-depth trend analysis with directional bias
        Returns: {
            "primary_trend": str,           # STRONG_BULLISH, BULLISH, MILD_BULLISH, NEUTRAL, etc.
            "ema_alignment": int,           # 0-4 (how aligned EMAs are: 4=perfect, 0=random)
            "entry_level": float,           # Best entry (support at EMA20/50)
            "stop_loss_level": float,       # Natural stop (resistance at EMA100)
            "target_level": float,          # Price target
            "signals": List[str],           # Individual signals (bullish, bearish, breakout, etc.)
            "strength": float,              # 0.0-1.0 signal strength
        }
        """
        
        trend = self.determine_trend(price, ema_20, ema_50, ema_100, ema_200)
        ema_list = [ema_20, ema_50, ema_100, ema_200]
        signals = []
        alignment_score = 0
        
        # Price vs EMAs signals
        if price > ema_20:
            signals.append("price_above_ema20")
        else:
            signals.append("price_below_ema20")
        
        if price > ema_50:
            signals.append("price_above_ema50")
        else:
            signals.append("price_below_ema50")
        
        if price > ema_100:
            signals.append("price_above_ema100")
        else:
            signals.append("price_below_ema100")
        
        if price > ema_200:
            signals.append("price_above_ema200_anchor")
        else:
            signals.append("price_below_ema200_anchor")
        
        # EMA alignment signals
        if ema_20 > ema_50:
            signals.append("ema20_above_ema50")
            alignment_score += 1
        else:
            signals.append("ema20_below_ema50")
        
        if ema_50 > ema_100:
            signals.append("ema50_above_ema100")
            alignment_score += 1
        else:
            signals.append("ema50_below_ema100")
        
        if ema_100 > ema_200:
            signals.append("ema100_above_ema200")
            alignment_score += 1
        else:
            signals.append("ema100_below_ema200")
        
        # Dynamic level calculation
        if "BULLISH" in trend:
            # Bullish: Entry at EMA20, Stop at EMA100, Target at resistance
            entry_level = ema_20
            stop_loss_level = ema_100
            target_level = price + (price - ema_50) * 2  # 2x the distance already moved
            strength = 0.7 if trend == "STRONG_BULLISH" else 0.5
        elif "BEARISH" in trend:
            # Bearish: Entry at EMA20, Stop at EMA100, Target at support
            entry_level = ema_20
            stop_loss_level = ema_100
            target_level = price - (ema_50 - price) * 2
            strength = 0.7 if trend == "STRONG_BEARISH" else 0.5
        else:
            # Neutral: Hold at EMA50
            entry_level = ema_50
            stop_loss_level = ema_100
            target_level = (ema_50 + ema_100) / 2
            strength = 0.3
        
        return {
            "primary_trend": trend,
            "ema_alignment": alignment_score,  # 0-3 (how many EMAs are stacked)
            "entry_level": round(entry_level, 2),
            "stop_loss_level": round(stop_loss_level, 2),
            "target_level": round(target_level, 2),
            "signals": signals,
            "strength": round(strength, 2),
            "ema_config": self.get_ema_periods_dict()
        }
    
    def get_super_trend_values(self, price: float, ema_20: float, ema_50: float,
                              ema_100: float, ema_200: float, 
                              multiplier: float = 2.0) -> Dict:
        """
        Calculate Supertrend-like levels using EMAs as base
        More professional than simple band calculation
        """
        
        # Use EMA50 as base (it's the mid-term trend)
        base_ema = ema_50
        
        # Distance between fast and slow for volatility estimate
        volatility_factor = abs(ema_20 - ema_100) * multiplier
        
        # Calculate bands
        upper_band = base_ema + volatility_factor
        lower_band = base_ema - volatility_factor
        
        # Current trend determines which band matters
        trend = self.determine_trend(price, ema_20, ema_50, ema_100, ema_200)
        
        if "BULLISH" in trend:
            signal = "BUY"
            critical_level = lower_band  # Support
            distance_to_stop = price - lower_band
        elif "BEARISH" in trend:
            signal = "SELL"
            critical_level = upper_band  # Resistance
            distance_to_stop = upper_band - price
        else:
            signal = "HOLD"
            critical_level = base_ema
            distance_to_stop = abs(price - base_ema)
        
        return {
            "signal": signal,
            "upper_band": round(upper_band, 2),
            "middle_band": round(base_ema, 2),
            "lower_band": round(lower_band, 2),
            "critical_level": round(critical_level, 2),
            "distance_to_critical": round(distance_to_stop, 2),
            "distance_pct": round((distance_to_stop / price) * 100, 2) if price > 0 else 0
        }
    
    def get_trading_bias(self, price: float, ema_20: float, ema_50: float,
                        ema_100: float, ema_200: float) -> str:
        """Get simple trading bias for quick decisions"""
        trend = self.determine_trend(price, ema_20, ema_50, ema_100, ema_200)
        
        if "STRONG_BULLISH" in trend:
            return "BUY_ONLY"
        elif "BULLISH" in trend:
            return "BIAS_BUY"
        elif "STRONG_BEARISH" in trend:
            return "SELL_ONLY"
        elif "BEARISH" in trend:
            return "BIAS_SELL"
        else:
            return "TWO_WAY"


# ============================================
# SINGLETON INSTANCE FOR GLOBAL USE
# ============================================
_trend_filter: TrendFilterSystem = None


def get_trend_filter() -> TrendFilterSystem:
    """Get or create singleton trend filter instance"""
    global _trend_filter
    if _trend_filter is None:
        _trend_filter = TrendFilterSystem(ACTIVE_EMA_CONFIG)
    return _trend_filter


def get_ema_config() -> Dict[str, int]:
    """Get current EMA configuration"""
    return get_trend_filter().get_ema_periods_dict()


def set_ema_config(config_name: str = "INTRADAY_PRO"):
    """Switch EMA configuration"""
    global _trend_filter
    if config_name == "INTRADAY_PRO":
        new_config = EMAPeriods.INTRADAY_PRO.value
    elif config_name == "LEGACY_QUICK":
        new_config = EMAPeriods.LEGACY_QUICK.value
    elif config_name == "SCALP_FAST":
        new_config = EMAPeriods.SCALP_FAST.value
    elif config_name == "SWING_MID":
        new_config = EMAPeriods.SWING_MID.value
    else:
        raise ValueError(f"Unknown EMA config: {config_name}")
    
    _trend_filter = TrendFilterSystem(new_config)
    print(f"✅ EMA Config changed to: {config_name} => {_trend_filter.get_ema_periods_dict()}")
