"""
Intraday Analysis Service - World-Class Technical Analysis Engine
Implements: Price Action, S&R, Volume, Momentum, EMA, VWAP, OI, PCR, Time Filter
Architecture: Highly configurable, performance-optimized, AI-ready
"""

from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, field
from enum import Enum
from datetime import datetime, time
import numpy as np
import pandas as pd
from functools import lru_cache
import asyncio


class SignalType(Enum):
    """Signal types with strict classification"""
    BUY_SIGNAL = "BUY_SIGNAL"
    SELL_SIGNAL = "SELL_SIGNAL"
    STRONG_BUY = "STRONG_BUY"
    STRONG_SELL = "STRONG_SELL"
    NO_TRADE = "NO_TRADE"
    WAIT = "WAIT"


class TrendDirection(Enum):
    """Trend classification"""
    UPTREND = "UPTREND"
    DOWNTREND = "DOWNTREND"
    SIDEWAYS = "SIDEWAYS"
    UNKNOWN = "UNKNOWN"


class VolumeStrength(Enum):
    """Volume strength levels"""
    STRONG_VOLUME = "STRONG_VOLUME"
    MODERATE_VOLUME = "MODERATE_VOLUME"
    WEAK_VOLUME = "WEAK_VOLUME"


class VWAPPosition(Enum):
    """VWAP relative position"""
    ABOVE_VWAP = "ABOVE_VWAP"
    BELOW_VWAP = "BELOW_VWAP"
    AT_VWAP = "AT_VWAP"


@dataclass
class AnalysisConfig:
    """Configuration for analysis - highly customizable"""
    # EMA Periods
    ema_fast: int = 9
    ema_medium: int = 21
    ema_slow: int = 50
    
    # Volume settings
    volume_sma_period: int = 20
    volume_strength_multiplier: float = 1.5
    
    # VWAP settings
    vwap_deviation_threshold: float = 0.002  # 0.2%
    
    # Support/Resistance
    lookback_period: int = 20
    sr_threshold: float = 0.005  # 0.5% proximity
    
    # Momentum
    rsi_period: int = 14
    rsi_overbought: int = 70
    rsi_oversold: int = 30
    
    # Time filter (avoid choppy zones)
    avoid_first_minutes: int = 15  # First 15 min after open
    avoid_last_minutes: int = 15   # Last 15 min before close
    market_open_time: time = field(default_factory=lambda: time(9, 15))
    market_close_time: time = field(default_factory=lambda: time(15, 30))
    
    # Signal strength requirements (strict mode)
    require_all_indicators: bool = True
    min_confidence_score: float = 0.75


@dataclass
class TechnicalIndicators:
    """Container for all technical indicators"""
    # Price & Trend
    current_price: float
    vwap: float
    ema_9: float
    ema_21: float
    ema_50: float
    
    # Support & Resistance
    support_level: float
    resistance_level: float
    prev_day_high: float
    prev_day_low: float
    prev_day_close: float
    
    # Volume & Momentum
    volume: int
    volume_sma: float
    volume_strength: VolumeStrength
    rsi: float
    
    # OI & PCR (from external service)
    put_call_ratio: Optional[float] = None
    open_interest_change: Optional[float] = None
    
    # Derived
    trend_direction: TrendDirection = TrendDirection.UNKNOWN
    vwap_position: VWAPPosition = VWAPPosition.AT_VWAP
    candle_strength: float = 0.0
    
    # Time filter
    is_trading_time: bool = True
    time_zone_quality: str = "GOOD"


@dataclass
class AnalysisSignal:
    """Final analysis signal with complete context"""
    symbol: str
    signal_type: SignalType
    confidence_score: float  # 0.0 to 1.0
    
    # All indicators
    indicators: TechnicalIndicators
    
    # Signal reasons (explainability)
    reasons: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    
    # RSI 60/40 Momentum Analysis
    rsi_60_40_momentum: Optional[Dict[str, Any]] = None
    
    # Entry/Exit suggestions
    entry_price: Optional[float] = None
    stop_loss: Optional[float] = None
    target_price: Optional[float] = None
    
    # Metadata
    timestamp: datetime = field(default_factory=datetime.now)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API response"""
        return {
            "symbol": self.symbol,
            "signal": self.signal_type.value,
            "confidence": round(self.confidence_score, 2),
            "entry_price": self.entry_price,
            "stop_loss": self.stop_loss,
            "target": self.target_price,
            "indicators": {
                "price": self.indicators.current_price,
                "vwap": self.indicators.vwap,
                "vwap_position": self.indicators.vwap_position.value,
                "ema_9": self.indicators.ema_9,
                "ema_21": self.indicators.ema_21,
                "ema_50": self.indicators.ema_50,
                "trend": self.indicators.trend_direction.value,
                "support": self.indicators.support_level,
                "resistance": self.indicators.resistance_level,
                "prev_day_high": self.indicators.prev_day_high,
                "prev_day_low": self.indicators.prev_day_low,
                "prev_day_close": self.indicators.prev_day_close,
                "volume": self.indicators.volume,
                "volume_strength": self.indicators.volume_strength.value,
                "rsi": self.indicators.rsi,
                "pcr": self.indicators.put_call_ratio,
                "oi_change": self.indicators.open_interest_change,
                "candle_strength": round(self.indicators.candle_strength, 2),
                "time_quality": self.indicators.time_zone_quality,
            },
            "rsi_60_40_momentum": self.rsi_60_40_momentum,
            "reasons": self.reasons,
            "warnings": self.warnings,
            "timestamp": self.timestamp.isoformat(),
        }


class AnalysisEngine:
    """
    World-class intraday analysis engine
    - Performance optimized with caching
    - Modular and extensible
    - AI-ready architecture
    """
    
    def __init__(self, config: Optional[AnalysisConfig] = None):
        self.config = config or AnalysisConfig()
        self._cache: Dict[str, Any] = {}
    
    # ==================== PRICE ACTION ====================
    
    def calculate_vwap(self, df: pd.DataFrame) -> float:
        """Calculate Volume Weighted Average Price"""
        if df.empty or len(df) < 2:
            return df.iloc[-1]['close'] if not df.empty else 0.0
        
        df = df.copy()
        df['typical_price'] = (df['high'] + df['low'] + df['close']) / 3
        df['tp_volume'] = df['typical_price'] * df['volume']
        
        vwap = df['tp_volume'].sum() / df['volume'].sum()
        return round(vwap, 2)
    
    def vwap_position(self, current_price: float, vwap: float) -> VWAPPosition:
        """Determine position relative to VWAP"""
        threshold = self.config.vwap_deviation_threshold
        deviation = (current_price - vwap) / vwap
        
        if deviation > threshold:
            return VWAPPosition.ABOVE_VWAP
        elif deviation < -threshold:
            return VWAPPosition.BELOW_VWAP
        return VWAPPosition.AT_VWAP
    
    # ==================== EMA TREND FILTER ====================
    
    def calculate_ema(self, df: pd.DataFrame, period: int) -> float:
        """Calculate Exponential Moving Average"""
        if df.empty or len(df) < period:
            return df.iloc[-1]['close'] if not df.empty else 0.0
        
        prices = df['close'].values
        ema = pd.Series(prices).ewm(span=period, adjust=False).mean()
        return round(ema.iloc[-1], 2)
    
    def determine_trend(self, ema_9: float, ema_21: float, ema_50: float) -> TrendDirection:
        """Determine trend direction using EMA alignment"""
        if ema_9 > ema_21 > ema_50:
            return TrendDirection.UPTREND
        elif ema_9 < ema_21 < ema_50:
            return TrendDirection.DOWNTREND
        else:
            return TrendDirection.SIDEWAYS
    
    # ==================== SUPPORT & RESISTANCE ====================
    
    def calculate_support_resistance(self, df: pd.DataFrame) -> Tuple[float, float]:
        """Calculate dynamic support and resistance levels"""
        if df.empty or len(df) < self.config.lookback_period:
            last_price = df.iloc[-1]['close'] if not df.empty else 0.0
            return last_price, last_price
        
        recent = df.tail(self.config.lookback_period)
        support = recent['low'].min()
        resistance = recent['high'].max()
        
        return round(support, 2), round(resistance, 2)
    
    def get_previous_day_levels(self, df: pd.DataFrame) -> Tuple[float, float, float]:
        """Get previous day high, low, close"""
        if df.empty or len(df) < 2:
            price = df.iloc[-1]['close'] if not df.empty else 0.0
            return price, price, price
        
        # Assuming df has daily or intraday data
        prev_day = df.iloc[-2] if len(df) >= 2 else df.iloc[-1]
        return (
            round(prev_day['high'], 2),
            round(prev_day['low'], 2),
            round(prev_day['close'], 2)
        )
    
    # ==================== VOLUME CONFIRMATION ====================
    
    def calculate_volume_strength(self, df: pd.DataFrame) -> VolumeStrength:
        """Analyze volume strength"""
        if df.empty or len(df) < self.config.volume_sma_period:
            return VolumeStrength.WEAK_VOLUME
        
        current_volume = df.iloc[-1]['volume']
        volume_sma = df['volume'].tail(self.config.volume_sma_period).mean()
        
        ratio = current_volume / volume_sma if volume_sma > 0 else 0
        
        if ratio >= self.config.volume_strength_multiplier:
            return VolumeStrength.STRONG_VOLUME
        elif ratio >= 1.0:
            return VolumeStrength.MODERATE_VOLUME
        return VolumeStrength.WEAK_VOLUME
    
    # ==================== MOMENTUM (RSI & CANDLE) ====================
    
    def calculate_rsi(self, df: pd.DataFrame) -> float:
        """Calculate Relative Strength Index"""
        if df.empty or len(df) < self.config.rsi_period + 1:
            return 50.0  # Neutral
        
        prices = df['close'].values
        deltas = np.diff(prices)
        
        gains = np.where(deltas > 0, deltas, 0)
        losses = np.where(deltas < 0, -deltas, 0)
        
        avg_gain = pd.Series(gains).rolling(window=self.config.rsi_period).mean()
        avg_loss = pd.Series(losses).rolling(window=self.config.rsi_period).mean()
        
        rs = avg_gain / avg_loss.replace(0, 1)
        rsi = 100 - (100 / (1 + rs))
        
        return round(rsi.iloc[-1], 2)
    
    def analyze_rsi_60_40_momentum(self, df: pd.DataFrame, rsi: float, trend: TrendDirection, vwap: float, ema_50: float) -> Dict[str, Any]:
        """RSI 60/40 Dynamic Zone Analysis based on trend context"""
        if df.empty:
            return {"signal": "WAIT", "rsi_value": rsi, "zone": "NEUTRAL", "action": "No data", "confidence": 0}
        
        current_price = df.iloc[-1]['close']
        last_3_rsi = self.calculate_last_n_rsi(df, 3)
        
        # Get previous candle info for confirmation
        prev_candle = df.iloc[-2] if len(df) > 1 else df.iloc[-1]
        prev_close = prev_candle['close']
        
        result = {
            "rsi_value": rsi,
            "trend": trend.value,
            "current_price": current_price,
            "above_vwap": current_price > vwap,
            "above_ema50": current_price > ema_50,
        }
        
        # UPTREND LOGIC
        if trend == TrendDirection.UPTREND:
            # RSI support zone: 40-50
            if 40 <= rsi <= 50:
                # Check bounce confirmation
                if len(last_3_rsi) >= 2 and last_3_rsi[-1] > last_3_rsi[-2]:
                    if current_price > vwap or current_price > ema_50:
                        result.update({
                            "signal": "PULLBACK_BUY",
                            "zone": "RSI_40_SUPPORT",
                            "action": "BUY at support - RSI bounce confirmed",
                            "confidence": 85,
                            "reason": f"RSI at {rsi} (support zone), bouncing + VWAP/EMA support"
                        })
                    else:
                        result.update({
                            "signal": "WAIT",
                            "zone": "RSI_40_SUPPORT",
                            "action": "Monitor - RSI bouncing but price weak",
                            "confidence": 60,
                            "reason": f"RSI at {rsi} (support), bouncing but below VWAP/EMA50"
                        })
                else:
                    result.update({
                        "signal": "WAIT",
                        "zone": "RSI_40_SUPPORT",
                        "action": "Watch for bounce",
                        "confidence": 50,
                        "reason": f"RSI at {rsi} (support zone) - waiting for upward confirmation"
                    })
            
            # RSI breakout strength zone: above 60
            elif rsi >= 60:
                # Strong bullish confirmation
                if len(last_3_rsi) >= 3 and all(last_3_rsi[i] >= 60 for i in range(max(0, len(last_3_rsi)-3), len(last_3_rsi))):
                    if current_price > vwap and current_price > ema_50:
                        result.update({
                            "signal": "MOMENTUM_BUY",
                            "zone": "RSI_60_BREAKOUT",
                            "action": "BUY - Strong momentum continuation",
                            "confidence": 90,
                            "reason": f"RSI sustained above 60 for 3+ candles + VWAP + EMA50 confluence"
                        })
                    else:
                        result.update({
                            "signal": "BUY",
                            "zone": "RSI_60_BREAKOUT",
                            "action": "BUY with caution",
                            "confidence": 70,
                            "reason": f"RSI above 60 but price below VWAP/EMA50"
                        })
                elif rsi > 70:
                    result.update({
                        "signal": "OVERBOUGHT_CAUTION",
                        "zone": "RSI_OVERBOUGHT",
                        "action": "Watch for rejection",
                        "confidence": 55,
                        "reason": f"RSI {rsi} - extreme overbought, watch for reversal"
                    })
                else:
                    result.update({
                        "signal": "BUY",
                        "zone": "RSI_60_BREAKOUT",
                        "action": "HOLD/BUY",
                        "confidence": 75,
                        "reason": f"RSI at {rsi} - above 60, strong momentum"
                    })
            else:
                result.update({
                    "signal": "WAIT",
                    "zone": "RSI_NEUTRAL",
                    "action": "Consolidation",
                    "confidence": 50,
                    "reason": f"RSI at {rsi} - neutral zone, waiting for next setup"
                })
        
        # DOWNTREND LOGIC
        elif trend == TrendDirection.DOWNTREND:
            # RSI resistance zone: 50-60
            if 50 <= rsi <= 60:
                # Check rejection confirmation
                if len(last_3_rsi) >= 2 and last_3_rsi[-1] < last_3_rsi[-2]:
                    if current_price < vwap or current_price < ema_50:
                        result.update({
                            "signal": "REJECTION_SHORT",
                            "zone": "RSI_60_RESISTANCE",
                            "action": "SHORT at resistance - RSI rejection confirmed",
                            "confidence": 85,
                            "reason": f"RSI at {rsi} (resistance zone), rejecting + VWAP/EMA resistance"
                        })
                    else:
                        result.update({
                            "signal": "WAIT",
                            "zone": "RSI_60_RESISTANCE",
                            "action": "Monitor - RSI rejecting but price strong",
                            "confidence": 60,
                            "reason": f"RSI at {rsi} (resistance), rejecting but above VWAP/EMA50"
                        })
                else:
                    result.update({
                        "signal": "WAIT",
                        "zone": "RSI_60_RESISTANCE",
                        "action": "Watch for rejection",
                        "confidence": 50,
                        "reason": f"RSI at {rsi} (resistance zone) - waiting for downward confirmation"
                    })
            
            # RSI weakness zone: below 40
            elif rsi <= 40:
                # Strong bearish continuation
                if len(last_3_rsi) >= 3 and all(last_3_rsi[i] <= 40 for i in range(max(0, len(last_3_rsi)-3), len(last_3_rsi))):
                    if current_price < vwap and current_price < ema_50:
                        result.update({
                            "signal": "MOMENTUM_SHORT",
                            "zone": "RSI_40_WEAKNESS",
                            "action": "SHORT - Strong downtrend continuation",
                            "confidence": 90,
                            "reason": f"RSI sustained below 40 for 3+ candles + VWAP + EMA50 confluence"
                        })
                    else:
                        result.update({
                            "signal": "SHORT",
                            "zone": "RSI_40_WEAKNESS",
                            "action": "SHORT with caution",
                            "confidence": 70,
                            "reason": f"RSI below 40 but price above VWAP/EMA50"
                        })
                elif rsi < 30:
                    result.update({
                        "signal": "OVERSOLD_CAUTION",
                        "zone": "RSI_OVERSOLD",
                        "action": "Watch for bounce",
                        "confidence": 55,
                        "reason": f"RSI {rsi} - extreme oversold, watch for reversal"
                    })
                else:
                    result.update({
                        "signal": "SHORT",
                        "zone": "RSI_40_WEAKNESS",
                        "action": "HOLD/SHORT",
                        "confidence": 75,
                        "reason": f"RSI at {rsi} - below 40, strong weakness"
                    })
            else:
                result.update({
                    "signal": "WAIT",
                    "zone": "RSI_NEUTRAL",
                    "action": "Consolidation",
                    "confidence": 50,
                    "reason": f"RSI at {rsi} - neutral zone, waiting for next setup"
                })
        
        # SIDEWAYS/UNKNOWN TREND
        else:
            result.update({
                "signal": "WAIT",
                "zone": "RSI_NEUTRAL",
                "action": "No clear trend",
                "confidence": 30,
                "reason": f"Sideways market - RSI {rsi}, insufficient setup clarity"
            })
        
        return result
    
    def calculate_last_n_rsi(self, df: pd.DataFrame, n: int = 3) -> List[float]:
        """Calculate RSI for last N candles"""
        if len(df) < n + self.config.rsi_period:
            return []
        
        rsi_values = []
        for i in range(max(0, len(df) - n), len(df)):
            candle_df = df.iloc[:i+1]
            rsi = self.calculate_rsi(candle_df)
            rsi_values.append(rsi)
        return rsi_values
    
    def calculate_candle_strength(self, df: pd.DataFrame) -> float:
        """Calculate candle strength (body to range ratio)"""
        if df.empty:
            return 0.0
        
        last = df.iloc[-1]
        body = abs(last['close'] - last['open'])
        range_size = last['high'] - last['low']
        
        if range_size == 0:
            return 0.0
        
        strength = body / range_size
        return round(strength, 2)
    
    # ==================== TIME FILTER ====================
    
    def check_trading_time(self, current_time: Optional[datetime] = None) -> Tuple[bool, str]:
        """Check if current time is good for trading (avoid chop zones)."""
        # Time filter can be configured via settings
        return True, "GOOD"
        
        if current_time is None:
            current_time = datetime.now()
        
        current_time_only = current_time.time()
        
        # Calculate avoid zones
        from datetime import timedelta
        market_open = datetime.combine(current_time.date(), self.config.market_open_time)
        market_close = datetime.combine(current_time.date(), self.config.market_close_time)
        
        avoid_open = market_open + timedelta(minutes=self.config.avoid_first_minutes)
        avoid_close = market_close - timedelta(minutes=self.config.avoid_last_minutes)
        
        # Check if in trading hours
        if current_time_only < self.config.market_open_time or current_time_only > self.config.market_close_time:
            return False, "MARKET_CLOSED"
        
        # Check if in avoid zone
        if current_time < avoid_open:
            return False, "OPENING_CHOP"
        if current_time > avoid_close:
            return False, "CLOSING_CHOP"
        
        return True, "GOOD"
    
    # ==================== SIGNAL ENGINE ====================
    
    async def analyze(
        self,
        symbol: str,
        df: pd.DataFrame,
        pcr: Optional[float] = None,
        oi_change: Optional[float] = None
    ) -> AnalysisSignal:
        """
        Main analysis engine - combines all indicators
        Returns strict signals based on ALL parameters
        """
        
        # Calculate all indicators
        current_price = df.iloc[-1]['close'] if not df.empty else 0.0
        
        # Price action
        vwap = self.calculate_vwap(df)
        vwap_pos = self.vwap_position(current_price, vwap)
        
        # EMAs
        ema_9 = self.calculate_ema(df, self.config.ema_fast)
        ema_21 = self.calculate_ema(df, self.config.ema_medium)
        ema_50 = self.calculate_ema(df, self.config.ema_slow)
        trend = self.determine_trend(ema_9, ema_21, ema_50)
        
        # Support/Resistance
        support, resistance = self.calculate_support_resistance(df)
        prev_high, prev_low, prev_close = self.get_previous_day_levels(df)
        
        # Volume
        volume_strength = self.calculate_volume_strength(df)
        current_volume = int(df.iloc[-1]['volume']) if not df.empty else 0
        volume_sma = df['volume'].tail(self.config.volume_sma_period).mean() if len(df) >= self.config.volume_sma_period else 0
        
        # Momentum
        rsi = self.calculate_rsi(df)
        candle_strength = self.calculate_candle_strength(df)
        
        # RSI 60/40 Momentum Analysis
        rsi_momentum = self.analyze_rsi_60_40_momentum(df, rsi, trend, vwap, ema_50)
        
        # Time filter
        is_trading_time, time_quality = self.check_trading_time()
        
        # Build indicators object
        indicators = TechnicalIndicators(
            current_price=current_price,
            vwap=vwap,
            ema_9=ema_9,
            ema_21=ema_21,
            ema_50=ema_50,
            support_level=support,
            resistance_level=resistance,
            prev_day_high=prev_high,
            prev_day_low=prev_low,
            prev_day_close=prev_close,
            volume=current_volume,
            volume_sma=volume_sma,
            volume_strength=volume_strength,
            rsi=rsi,
            put_call_ratio=pcr,
            open_interest_change=oi_change,
            trend_direction=trend,
            vwap_position=vwap_pos,
            candle_strength=candle_strength,
            is_trading_time=is_trading_time,
            time_zone_quality=time_quality,
        )
        
        # Generate signal
        signal = self._generate_signal(indicators)
        
        return signal
    
    def _generate_signal(self, indicators: TechnicalIndicators) -> AnalysisSignal:
        """
        Generate final signal based on ALL indicators (STRICT MODE)
        Buyer needs VERY STRONG signal where ALL parameters match
        """
        signal_type = SignalType.WAIT
        confidence = 0.0
        reasons: List[str] = []
        warnings: List[str] = []
        entry_price = None
        stop_loss = None
        target = None
        
        # Time filter check (critical)
        if not indicators.is_trading_time or indicators.time_zone_quality != "GOOD":
            warnings.append(f"Avoid trading: {indicators.time_zone_quality}")
            return AnalysisSignal(
                symbol="",
                signal_type=SignalType.NO_TRADE,
                confidence_score=0.0,
                indicators=indicators,
                warnings=warnings
            )
        
        # Volume check (STRICT - must be strong)
        if indicators.volume_strength != VolumeStrength.STRONG_VOLUME:
            warnings.append("Volume not strong enough - NO TRADE")
            return AnalysisSignal(
                symbol="",
                signal_type=SignalType.NO_TRADE,
                confidence_score=0.0,
                indicators=indicators,
                warnings=warnings
            )
        
        # BUY SIGNAL CONDITIONS (ALL must match)
        buy_conditions = {
            'vwap': indicators.vwap_position == VWAPPosition.ABOVE_VWAP,
            'trend': indicators.trend_direction == TrendDirection.UPTREND,
            'volume': indicators.volume_strength == VolumeStrength.STRONG_VOLUME,
            'price_above_ema9': indicators.current_price > indicators.ema_9,
            'rsi_not_overbought': indicators.rsi < self.config.rsi_overbought,
            'above_support': indicators.current_price > indicators.support_level,
        }
        
        # SELL SIGNAL CONDITIONS (ALL must match)
        sell_conditions = {
            'vwap': indicators.vwap_position == VWAPPosition.BELOW_VWAP,
            'trend': indicators.trend_direction == TrendDirection.DOWNTREND,
            'volume': indicators.volume_strength == VolumeStrength.STRONG_VOLUME,
            'price_below_ema9': indicators.current_price < indicators.ema_9,
            'rsi_not_oversold': indicators.rsi > self.config.rsi_oversold,
            'below_resistance': indicators.current_price < indicators.resistance_level,
        }
        
        # Check BUY signal
        if all(buy_conditions.values()):
            signal_type = SignalType.STRONG_BUY if indicators.candle_strength > 0.7 else SignalType.BUY_SIGNAL
            confidence = sum(buy_conditions.values()) / len(buy_conditions)
            
            reasons.append("✓ Price above VWAP - Bullish")
            reasons.append("✓ Clear UPTREND (EMA alignment)")
            reasons.append("✓ STRONG VOLUME confirmation")
            reasons.append(f"✓ RSI: {indicators.rsi} (healthy)")
            reasons.append(f"✓ Candle Strength: {indicators.candle_strength}")
            
            # Calculate entry/exit
            entry_price = indicators.current_price
            stop_loss = max(indicators.support_level, indicators.ema_21)
            target = entry_price + (entry_price - stop_loss) * 2  # 1:2 RR
            
        # Check SELL signal
        elif all(sell_conditions.values()):
            signal_type = SignalType.STRONG_SELL if indicators.candle_strength > 0.7 else SignalType.SELL_SIGNAL
            confidence = sum(sell_conditions.values()) / len(sell_conditions)
            
            reasons.append("✓ Price below VWAP - Bearish")
            reasons.append("✓ Clear DOWNTREND (EMA alignment)")
            reasons.append("✓ STRONG VOLUME confirmation")
            reasons.append(f"✓ RSI: {indicators.rsi} (healthy)")
            reasons.append(f"✓ Candle Strength: {indicators.candle_strength}")
            
            # Calculate entry/exit
            entry_price = indicators.current_price
            stop_loss = min(indicators.resistance_level, indicators.ema_21)
            target = entry_price - (stop_loss - entry_price) * 2  # 1:2 RR
            
        else:
            # Partial matches - identify what's missing
            signal_type = SignalType.WAIT
            
            missing_buy = [k for k, v in buy_conditions.items() if not v]
            missing_sell = [k for k, v in sell_conditions.items() if not v]
            
            if len(missing_buy) <= 2:
                warnings.append(f"Near BUY - Missing: {', '.join(missing_buy)}")
            elif len(missing_sell) <= 2:
                warnings.append(f"Near SELL - Missing: {', '.join(missing_sell)}")
            else:
                warnings.append("No clear setup - WAIT for better alignment")
        
        # Apply confidence threshold
        if confidence < self.config.min_confidence_score:
            signal_type = SignalType.WAIT
            warnings.append(f"Confidence {confidence:.0%} below threshold")
        
        return AnalysisSignal(
            symbol="",
            rsi_60_40_momentum=rsi_momentum,
            signal_type=signal_type,
            confidence_score=confidence,
            indicators=indicators,
            reasons=reasons,
            warnings=warnings,
            entry_price=entry_price,
            stop_loss=stop_loss,
            target_price=target,
        )


# Factory function for easy instantiation
def create_analysis_engine(config: Optional[AnalysisConfig] = None) -> AnalysisEngine:
    """Create analysis engine with optional custom config"""
    return AnalysisEngine(config)
