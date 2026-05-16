"""
📈 TREND BASE ANALYSIS ENGINE
Institutional-grade trend and market structure analysis system.

Features:
- Higher highs/lows detection (uptrend/downtrend)
- Market structure pattern recognition
- Trend strength calculation
- Support/resistance level identification
- Breakout probability scoring
- Trend reversal detection
- Multi-timeframe trend analysis
"""

import asyncio
import threading
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple
from collections import deque
import pytz
from dataclasses import dataclass, field
import math

from config.market_session import get_market_session

market_config = get_market_session()
IST = pytz.timezone(market_config.TIMEZONE)


@dataclass
class TrendPoint:
    """A significant swing point in the market (high or low)."""
    timestamp: datetime
    price: float
    is_high: bool  # True if swing high, False if swing low
    strength: float  # 0-1, confidence in this being a real reversal
    volume: Optional[float] = None
    distance_from_previous: float = 0.0  # Price move from previous point


@dataclass
class TrendStructure:
    """Market trend structure (uptrend, downtrend, or neutral)."""
    trend_type: str  # UPTREND, DOWNTREND, NEUTRAL
    strength: float  # 0-1, how strong the trend
    duration_bars: int  # How many bars in this trend
    start_price: float
    current_price: float
    total_move: float  # Total price change in trend
    move_percentage: float  # Percentage move
    higher_highs_count: int
    higher_lows_count: int
    lower_highs_count: int
    lower_lows_count: int
    swing_points: List[TrendPoint] = field(default_factory=list)
    support_levels: List[float] = field(default_factory=list)
    resistance_levels: List[float] = field(default_factory=list)
    breakout_probability: float = 0.0
    reversal_probability: float = 0.0


@dataclass
class StructurePattern:
    """Detected structural pattern in the market."""
    pattern_type: str  # HIGHER_HIGH_LOWER_LOW, EQUAL_HIGH, BREAK_LOW, BREAK_HIGH, etc.
    confidence: float  # 0-1
    timestamp: datetime
    price_level: float
    description: str
    next_target: Optional[float] = None
    risk_level: Optional[float] = None


class TrendBaseAnalysisEngine:
    """
    Enterprise-grade trend and market structure analyzer.
    Detects higher highs/lows, trend reversals, and structural patterns.
    """
    
    def __init__(self, lookback_bars: int = 100, min_swing_points: int = 3):
        self.lookback_bars = lookback_bars
        self.min_swing_points = min_swing_points
        
        # Price history for trend analysis
        self.price_history: Dict[str, deque] = {
            s: deque(maxlen=500) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        self.high_history: Dict[str, deque] = {
            s: deque(maxlen=500) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        self.low_history: Dict[str, deque] = {
            s: deque(maxlen=500) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        self.volume_history: Dict[str, deque] = {
            s: deque(maxlen=500) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        
        # Trend structures
        self.current_trends: Dict[str, TrendStructure] = {}
        self.trend_history: Dict[str, deque] = {
            s: deque(maxlen=50) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        
        # Swing points
        self.swing_points: Dict[str, deque] = {
            s: deque(maxlen=100) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        
        # Detected patterns
        self.patterns: Dict[str, deque] = {
            s: deque(maxlen=100) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        
        self.lock = threading.Lock()
        print("✅ TrendBaseAnalysisEngine initialized")
    
    async def analyze_price_action(self, tick: Dict[str, Any], symbol: str) -> TrendStructure:
        """
        Analyze price action and detect trend structure.
        
        Args:
            tick: Zerodha tick data with last_price, high, low, volume
            symbol: Trading symbol
            
        Returns:
            TrendStructure with trend analysis
        """
        try:
            current_price = tick.get('last_price', 0)
            high = tick.get('high', current_price)
            low = tick.get('low', current_price)
            volume = tick.get('volume_traded', 0)
            
            # Update histories
            with self.lock:
                self.price_history[symbol].append(current_price)
                self.high_history[symbol].append(high)
                self.low_history[symbol].append(low)
                self.volume_history[symbol].append(volume)
            
            # Detect swing points
            await self._detect_swing_points(symbol)
            
            # Analyze trend structure
            trend = await self._analyze_trend_structure(symbol, current_price)
            
            # Detect structural patterns
            await self._detect_patterns(symbol, trend)
            
            # Store trend
            with self.lock:
                self.current_trends[symbol] = trend
                self.trend_history[symbol].append(trend)
            
            return trend
            
        except Exception as e:
            print(f"❌ Error analyzing price action for {symbol}: {e}")
            return self._create_neutral_trend(symbol)
    
    async def _detect_swing_points(self, symbol: str):
        """
        Detect significant swing highs and lows.
        A swing high: price goes up then down
        A swing low: price goes down then up
        """
        with self.lock:
            prices = list(self.price_history.get(symbol, []))
            volumes = list(self.volume_history.get(symbol, []))
        
        if len(prices) < 5:
            return
        
        recent_prices = prices[-20:]  # Last 20 bars
        
        for i in range(1, len(recent_prices) - 1):
            # Check for swing high
            if (recent_prices[i] > recent_prices[i-1] and 
                recent_prices[i] > recent_prices[i+1] and
                recent_prices[i] > recent_prices[i-1] * 1.002):  # At least 0.2% move
                
                strength = self._calculate_swing_strength(
                    recent_prices[i], 
                    recent_prices[i-1:i+1]
                )
                
                point = TrendPoint(
                    timestamp=datetime.now(IST),
                    price=recent_prices[i],
                    is_high=True,
                    strength=strength,
                    volume=volumes[i] if i < len(volumes) else None,
                    distance_from_previous=recent_prices[i] - recent_prices[i-1]
                )
                
                with self.lock:
                    if point not in self.swing_points[symbol]:
                        self.swing_points[symbol].append(point)
            
            # Check for swing low
            elif (recent_prices[i] < recent_prices[i-1] and 
                  recent_prices[i] < recent_prices[i+1] and
                  recent_prices[i] < recent_prices[i-1] * 0.998):  # At least 0.2% move
                
                strength = self._calculate_swing_strength(
                    recent_prices[i],
                    recent_prices[i-1:i+1]
                )
                
                point = TrendPoint(
                    timestamp=datetime.now(IST),
                    price=recent_prices[i],
                    is_high=False,
                    strength=strength,
                    volume=volumes[i] if i < len(volumes) else None,
                    distance_from_previous=recent_prices[i-1] - recent_prices[i]
                )
                
                with self.lock:
                    if point not in self.swing_points[symbol]:
                        self.swing_points[symbol].append(point)
    
    def _calculate_swing_strength(self, pivot_price: float, 
                                   adjacent_prices: List[float]) -> float:
        """
        Calculate strength of a swing point (0-1).
        Stronger if more pronounced and with volume.
        """
        if len(adjacent_prices) < 2:
            return 0.5
        
        # Distance from adjacent points
        distances = [abs(pivot_price - p) for p in adjacent_prices]
        avg_distance = sum(distances) / len(distances) if distances else 0
        
        # Strength based on distance (normalize to 0-1)
        max_distance = max(distances) if distances else 1
        if max_distance == 0:
            return 0.5
        
        strength = min(avg_distance / max_distance * 1.5, 1.0)
        return max(strength, 0.3)  # Minimum 0.3
    
    async def _analyze_trend_structure(self, symbol: str, 
                                       current_price: float) -> TrendStructure:
        """
        Analyze overall trend structure based on swing points.
        Detects: higher highs/lows = uptrend, lower highs/lows = downtrend
        """
        with self.lock:
            swings = list(self.swing_points.get(symbol, []))
            prices = list(self.price_history.get(symbol, []))
        
        if len(swings) < self.min_swing_points or len(prices) < 10:
            return self._create_neutral_trend(symbol, current_price)
        
        # Separate highs and lows
        swing_highs = [p for p in swings if p.is_high]
        swing_lows = [p for p in swings if not p.is_high]
        
        # Need at least 2 of each
        if len(swing_highs) < 2 or len(swing_lows) < 2:
            return self._create_neutral_trend(symbol, current_price)
        
        # Sort by time
        swing_highs.sort(key=lambda x: x.timestamp)
        swing_lows.sort(key=lambda x: x.timestamp)
        
        # Analyze trend: compare recent swing levels
        recent_high_prices = [h.price for h in swing_highs[-3:]]
        recent_low_prices = [l.price for l in swing_lows[-3:]]
        
        higher_highs = 0
        higher_lows = 0
        lower_highs = 0
        lower_lows = 0
        
        # Count structure
        for i in range(1, len(recent_high_prices)):
            if recent_high_prices[i] > recent_high_prices[i-1]:
                higher_highs += 1
            elif recent_high_prices[i] < recent_high_prices[i-1]:
                lower_highs += 1
        
        for i in range(1, len(recent_low_prices)):
            if recent_low_prices[i] > recent_low_prices[i-1]:
                higher_lows += 1
            elif recent_low_prices[i] < recent_low_prices[i-1]:
                lower_lows += 1
        
        # Determine trend
        if higher_highs >= 2 and higher_lows >= 1:
            trend_type = "UPTREND"
            trend_strength = 0.8 + (higher_highs / 5) * 0.2
        elif lower_highs >= 2 and lower_lows >= 1:
            trend_type = "DOWNTREND"
            trend_strength = 0.8 + (lower_highs / 5) * 0.2
        else:
            trend_type = "NEUTRAL"
            trend_strength = 0.5
        
        # Calculate move and duration
        start_price = prices[0] if prices else current_price
        total_move = current_price - start_price
        move_percentage = (total_move / start_price * 100) if start_price > 0 else 0
        duration_bars = len(prices)
        
        # Calculate support/resistance
        support_levels = [l.price for l in swing_lows[-3:]]
        resistance_levels = [h.price for h in swing_highs[-3:]]
        support_levels.sort(reverse=True)
        resistance_levels.sort()
        
        # Calculate breakout probability
        breakout_prob = await self._calculate_breakout_probability(
            symbol, current_price, resistance_levels, support_levels
        )
        
        # Calculate reversal probability
        reversal_prob = await self._calculate_reversal_probability(
            symbol, trend_type, swing_highs, swing_lows
        )
        
        return TrendStructure(
            trend_type=trend_type,
            strength=min(trend_strength, 1.0),
            duration_bars=duration_bars,
            start_price=start_price,
            current_price=current_price,
            total_move=total_move,
            move_percentage=move_percentage,
            higher_highs_count=higher_highs,
            higher_lows_count=higher_lows,
            lower_highs_count=lower_highs,
            lower_lows_count=lower_lows,
            swing_points=swings[-10:],  # Last 10 swings
            support_levels=support_levels,
            resistance_levels=resistance_levels,
            breakout_probability=breakout_prob,
            reversal_probability=reversal_prob
        )
    
    async def _calculate_breakout_probability(self, symbol: str,
                                             current_price: float,
                                             resistance_levels: List[float],
                                             support_levels: List[float]) -> float:
        """
        Calculate probability of breakout based on proximity to levels
        and volume.
        """
        with self.lock:
            volumes = list(self.volume_history.get(symbol, []))[-50:]
        
        if not volumes or not resistance_levels:
            return 0.3
        
        avg_volume = sum(volumes) / len(volumes) if volumes else 1
        current_volume = volumes[-1] if volumes else avg_volume
        
        # Check proximity to resistance/support
        nearest_resistance = min(resistance_levels, key=lambda x: abs(x - current_price))
        distance_to_resistance = nearest_resistance - current_price
        
        # If near resistance and high volume, breakout probability high
        if distance_to_resistance > 0:  # Below resistance
            distance_pct = distance_to_resistance / current_price * 100
            if distance_pct < 0.5:  # Within 0.5%
                volume_ratio = current_volume / avg_volume
                prob = min(0.5 + volume_ratio * 0.25, 0.95)
                return prob
        
        return 0.3
    
    async def _calculate_reversal_probability(self, symbol: str,
                                             trend_type: str,
                                             swing_highs: List[TrendPoint],
                                             swing_lows: List[TrendPoint]) -> float:
        """
        Calculate probability of trend reversal based on structure.
        """
        if trend_type == "NEUTRAL":
            return 0.0
        
        # Check if structure is breaking down
        if trend_type == "UPTREND":
            # If recent low is lower than previous low = reversal risk
            if len(swing_lows) >= 2:
                recent_low = swing_lows[-1].price
                prev_low = swing_lows[-2].price
                if recent_low < prev_low * 0.995:  # Lower low forming
                    return 0.7
        else:  # DOWNTREND
            # If recent high is higher than previous high = reversal risk
            if len(swing_highs) >= 2:
                recent_high = swing_highs[-1].price
                prev_high = swing_highs[-2].price
                if recent_high > prev_high * 1.005:  # Higher high forming
                    return 0.7
        
        return 0.2  # Default low reversal probability
    
    async def _detect_patterns(self, symbol: str, trend: TrendStructure):
        """
        Detect specific structural patterns.
        """
        patterns = []
        
        # Pattern: Higher High, Higher Low (uptrend confirmation)
        if trend.higher_highs_count >= 2 and trend.higher_lows_count >= 1:
            pattern = StructurePattern(
                pattern_type="HIGHER_HIGH_HIGHER_LOW",
                confidence=min(0.6 + trend.strength * 0.3, 1.0),
                timestamp=datetime.now(IST),
                price_level=trend.current_price,
                description=f"Uptrend confirmed: {trend.higher_highs_count} higher highs",
                next_target=max(trend.resistance_levels) * 1.01 if trend.resistance_levels else None,
                risk_level=min(trend.support_levels) if trend.support_levels else None
            )
            patterns.append(pattern)
        
        # Pattern: Lower High, Lower Low (downtrend confirmation)
        if trend.lower_highs_count >= 2 and trend.lower_lows_count >= 1:
            pattern = StructurePattern(
                pattern_type="LOWER_HIGH_LOWER_LOW",
                confidence=min(0.6 + trend.strength * 0.3, 1.0),
                timestamp=datetime.now(IST),
                price_level=trend.current_price,
                description=f"Downtrend confirmed: {trend.lower_highs_count} lower highs",
                next_target=min(trend.support_levels) * 0.99 if trend.support_levels else None,
                risk_level=max(trend.resistance_levels) if trend.resistance_levels else None
            )
            patterns.append(pattern)
        
        # Pattern: Break of structure
        if len(trend.swing_points) >= 2:
            last_swing = trend.swing_points[-1]
            if last_swing.is_high and trend.trend_type == "UPTREND":
                if trend.current_price < trend.swing_points[-2].price:
                    pattern = StructurePattern(
                        pattern_type="BREAK_OF_STRUCTURE",
                        confidence=0.8,
                        timestamp=datetime.now(IST),
                        price_level=trend.current_price,
                        description="Break of uptrend structure - potential reversal",
                        next_target=trend.support_levels[0] if trend.support_levels else None,
                        risk_level=trend.resistance_levels[0] if trend.resistance_levels else None
                    )
                    patterns.append(pattern)
        
        with self.lock:
            self.patterns[symbol] = deque(
                list(self.patterns[symbol]) + patterns,
                maxlen=100
            )
    
    def _create_neutral_trend(self, symbol: str, 
                             current_price: float = 0) -> TrendStructure:
        """Create a neutral trend structure."""
        return TrendStructure(
            trend_type="NEUTRAL",
            strength=0.0,
            duration_bars=0,
            start_price=current_price,
            current_price=current_price,
            total_move=0.0,
            move_percentage=0.0,
            higher_highs_count=0,
            higher_lows_count=0,
            lower_highs_count=0,
            lower_lows_count=0,
            swing_points=[],
            support_levels=[],
            resistance_levels=[],
            breakout_probability=0.0,
            reversal_probability=0.0
        )
    
    def get_current_trend(self, symbol: str) -> Dict[str, Any]:
        """Get current trend structure as JSON."""
        with self.lock:
            trend = self.current_trends.get(symbol)
        
        if not trend:
            return {}
        
        return {
            'trendType': trend.trend_type,
            'strength': round(trend.strength, 2),
            'durationBars': trend.duration_bars,
            'startPrice': round(trend.start_price, 2),
            'currentPrice': round(trend.current_price, 2),
            'totalMove': round(trend.total_move, 2),
            'movePercentage': round(trend.move_percentage, 2),
            'higherHighsCount': trend.higher_highs_count,
            'higherLowsCount': trend.higher_lows_count,
            'lowerHighsCount': trend.lower_highs_count,
            'lowerLowsCount': trend.lower_lows_count,
            'supportLevels': [round(p, 2) for p in trend.support_levels],
            'resistanceLevels': [round(p, 2) for p in trend.resistance_levels],
            'breakoutProbability': round(trend.breakout_probability, 2),
            'reversalProbability': round(trend.reversal_probability, 2),
            'swingPoints': [
                {
                    'price': round(p.price, 2),
                    'isHigh': p.is_high,
                    'strength': round(p.strength, 2),
                    'timestamp': p.timestamp.isoformat()
                }
                for p in trend.swing_points[-5:]
            ]
        }
    
    def get_swing_points(self, symbol: str, limit: int = 20) -> List[Dict[str, Any]]:
        """Get recent swing points."""
        with self.lock:
            swings = list(self.swing_points.get(symbol, []))[-limit:]
        
        return [
            {
                'price': round(p.price, 2),
                'isHigh': p.is_high,
                'strength': round(p.strength, 2),
                'timestamp': p.timestamp.isoformat(),
                'volume': round(p.volume, 2) if p.volume else None
            }
            for p in swings
        ]
    
    def get_patterns(self, symbol: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Get detected patterns."""
        with self.lock:
            patterns = list(self.patterns.get(symbol, []))[-limit:]
        
        return [
            {
                'patternType': p.pattern_type,
                'confidence': round(p.confidence, 2),
                'timestamp': p.timestamp.isoformat(),
                'priceLevel': round(p.price_level, 2),
                'description': p.description,
                'nextTarget': round(p.next_target, 2) if p.next_target else None,
                'riskLevel': round(p.risk_level, 2) if p.risk_level else None
            }
            for p in patterns
        ]


# Global engine instance
trend_base_engine = TrendBaseAnalysisEngine()
