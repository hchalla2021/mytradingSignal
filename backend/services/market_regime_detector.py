"""Market Regime Detector - Identifies market conditions and regimes.

Detects trending vs ranging, momentum regimes, volatility regimes, and liquidity conditions.

Performance targets: <12ms per detection, real-time regime analysis
"""

import logging
from dataclasses import dataclass, field
from collections import deque
from threading import RLock
from typing import Dict, Optional, List
from datetime import datetime
import statistics

logger = logging.getLogger(__name__)


@dataclass
class MarketRegime:
    """Market regime classification"""
    regime_type: str  # TRENDING, RANGING, VOLATILE, CALM, BREAKOUT
    sub_regime: str  # STRONG_UPTREND, WEAK_UPTREND, CONSOLIDATION, BREAKDOWN, etc.
    strength: float  # 0-1
    probability: float  # 0-1
    transition_risk: float  # 0-1
    expected_volatility: str  # LOW, MEDIUM, HIGH, EXTREME
    optimal_strategy: str  # TREND_FOLLOWING, MEAN_REVERSION, SCALPING, etc.
    confidence: float  # 0-1
    timestamp: datetime = field(default_factory=datetime.now)


@dataclass
class MomentumRegime:
    """Momentum analysis"""
    direction: str  # BULLISH, BEARISH, NEUTRAL
    strength: float  # 0-100
    acceleration: str  # ACCELERATING, SUSTAINING, DECELERATING
    fatigue_level: float  # 0-100
    reversal_probability: float  # 0-1
    next_target: float
    timestamp: datetime = field(default_factory=datetime.now)


@dataclass
class LiquidityRegime:
    """Liquidity analysis"""
    liquidity_level: str  # HIGH, MEDIUM, LOW, CRITICAL
    bid_ask_spread: float
    volume_profile: str  # NORMAL, THICK, THIN
    slippage_risk: float  # 0-1
    execution_difficulty: str  # EASY, MODERATE, DIFFICULT
    timestamp: datetime = field(default_factory=datetime.now)


class MarketRegimeDetector:
    """Detects and classifies market regimes.
    
    Features:
    - Trending vs ranging detection
    - Momentum regime analysis
    - Volatility regime classification
    - Liquidity condition assessment
    - Regime transitions detection
    - Optimal strategy recommendation
    """

    def __init__(self):
        self.logger = logger
        self.lock = RLock()
        
        # Price history
        self.price_history: Dict[str, deque] = {}
        self.volume_history: Dict[str, deque] = {}
        self.high_low_history: Dict[str, deque] = {}
        
        # Cache
        self.regime_cache: Dict[str, MarketRegime] = {}
        self.momentum_cache: Dict[str, MomentumRegime] = {}
        self.liquidity_cache: Dict[str, LiquidityRegime] = {}
        
        # Configuration
        self.lookback_short = 20
        self.lookback_medium = 50
        self.lookback_long = 100

    async def detect_regime(self, symbol: str, data: Dict) -> Optional[MarketRegime]:
        """Detect current market regime."""
        try:
            with self.lock:
                # Update history
                price = float(data.get('ltp', 0))
                volume = int(data.get('volume', 0))
                high = float(data.get('high', 0))
                low = float(data.get('low', 0))
                
                if symbol not in self.price_history:
                    self.price_history[symbol] = deque(maxlen=self.lookback_long)
                    self.volume_history[symbol] = deque(maxlen=self.lookback_long)
                    self.high_low_history[symbol] = deque(maxlen=self.lookback_long)
                
                self.price_history[symbol].append(price)
                self.volume_history[symbol].append(volume)
                self.high_low_history[symbol].append((high, low))
                
                if len(self.price_history[symbol]) < 10:
                    return None
                
                # Detect regime type
                regime_type = self._detect_regime_type(symbol)
                
                # Detect sub-regime
                sub_regime = self._detect_sub_regime(symbol, regime_type)
                
                # Calculate metrics
                strength = self._calculate_regime_strength(symbol, regime_type)
                probability = self._calculate_probability(symbol, regime_type)
                transition_risk = self._calculate_transition_risk(symbol)
                expected_vol = self._estimate_volatility(symbol)
                optimal_strategy = self._recommend_strategy(regime_type, sub_regime)
                
                regime = MarketRegime(
                    regime_type=regime_type,
                    sub_regime=sub_regime,
                    strength=strength,
                    probability=probability,
                    transition_risk=transition_risk,
                    expected_volatility=expected_vol,
                    optimal_strategy=optimal_strategy,
                    confidence=probability
                )
                
                self.regime_cache[symbol] = regime
                return regime
        except Exception as e:
            self.logger.error(f"Error detecting regime for {symbol}: {str(e)}")
            return None

    async def analyze_momentum(self, symbol: str) -> Optional[MomentumRegime]:
        """Analyze momentum regime."""
        try:
            with self.lock:
                if symbol not in self.price_history or len(self.price_history[symbol]) < 14:
                    return None
                
                prices = list(self.price_history[symbol])
                
                # Calculate momentum
                recent_momentum = self._calculate_momentum(prices[-14:])
                direction = "BULLISH" if recent_momentum > 0 else "BEARISH"
                strength = abs(recent_momentum)
                
                # Calculate acceleration
                acceleration = self._detect_momentum_acceleration(prices)
                
                # Calculate fatigue
                fatigue = self._calculate_momentum_fatigue(prices)
                
                # Calculate reversal probability
                reversal_prob = fatigue / 100.0
                
                # Next target
                next_target = self._calculate_next_target(prices, direction)
                
                momentum = MomentumRegime(
                    direction=direction,
                    strength=strength,
                    acceleration=acceleration,
                    fatigue_level=fatigue,
                    reversal_probability=reversal_prob,
                    next_target=next_target
                )
                
                self.momentum_cache[symbol] = momentum
                return momentum
        except Exception as e:
            self.logger.error(f"Error analyzing momentum for {symbol}: {str(e)}")
            return None

    async def assess_liquidity(self, symbol: str, data: Dict) -> Optional[LiquidityRegime]:
        """Assess liquidity conditions."""
        try:
            with self.lock:
                bid_ask_spread = abs(float(data.get('ask', 0)) - float(data.get('bid', 0)))
                bid_volume = int(data.get('bid_volume', 0))
                ask_volume = int(data.get('ask_volume', 0))
                total_volume = bid_volume + ask_volume
                
                # Liquidity level
                if bid_ask_spread < 1 and total_volume > 1000000:
                    liquidity_level = "HIGH"
                    slippage_risk = 0.1
                elif bid_ask_spread < 2 and total_volume > 500000:
                    liquidity_level = "MEDIUM"
                    slippage_risk = 0.3
                else:
                    liquidity_level = "LOW"
                    slippage_risk = 0.7
                
                # Volume profile
                avg_volume = statistics.mean(list(self.volume_history[symbol])) if symbol in self.volume_history else 0
                current_vol = int(data.get('volume', 0))
                
                if current_vol > avg_volume * 1.5:
                    volume_profile = "THICK"
                elif current_vol < avg_volume * 0.5:
                    volume_profile = "THIN"
                else:
                    volume_profile = "NORMAL"
                
                liquidity = LiquidityRegime(
                    liquidity_level=liquidity_level,
                    bid_ask_spread=bid_ask_spread,
                    volume_profile=volume_profile,
                    slippage_risk=slippage_risk,
                    execution_difficulty="EASY" if liquidity_level == "HIGH" else "DIFFICULT"
                )
                
                self.liquidity_cache[symbol] = liquidity
                return liquidity
        except Exception as e:
            self.logger.error(f"Error assessing liquidity for {symbol}: {str(e)}")
            return None

    def _detect_regime_type(self, symbol: str) -> str:
        """Detect main regime type."""
        if symbol not in self.price_history or len(self.price_history[symbol]) < 20:
            return "RANGING"
        
        prices = list(self.price_history[symbol])
        
        # Calculate trend strength
        recent = prices[-20:]
        old = prices[-40:-20] if len(prices) >= 40 else prices[:20]
        
        recent_trend = (recent[-1] - recent[0]) / recent[0]
        old_trend = (old[-1] - old[0]) / old[0]
        
        # Calculate volatility
        volatility = statistics.stdev(prices[-20:]) if len(prices) >= 20 else 0
        
        if abs(recent_trend) > 0.02:
            return "TRENDING"
        elif volatility > 50:
            return "VOLATILE"
        else:
            return "RANGING"

    def _detect_sub_regime(self, symbol: str, regime_type: str) -> str:
        """Detect sub-regime classification."""
        if regime_type == "TRENDING":
            momentum = self.momentum_cache.get(symbol)
            if momentum:
                if momentum.direction == "BULLISH":
                    return "STRONG_UPTREND" if momentum.strength > 75 else "WEAK_UPTREND"
                else:
                    return "STRONG_DOWNTREND" if momentum.strength > 75 else "WEAK_DOWNTREND"
        elif regime_type == "RANGING":
            return "CONSOLIDATION"
        elif regime_type == "VOLATILE":
            return "HIGH_VOLATILITY"
        
        return "NEUTRAL"

    def _calculate_regime_strength(self, symbol: str, regime_type: str) -> float:
        """Calculate regime strength."""
        if regime_type == "TRENDING":
            momentum = self.momentum_cache.get(symbol)
            return momentum.strength / 100 if momentum else 0.5
        return 0.5

    def _calculate_probability(self, symbol: str, regime_type: str) -> float:
        """Calculate probability of regime continuation."""
        if regime_type == "TRENDING":
            return 0.75
        elif regime_type == "RANGING":
            return 0.70
        else:
            return 0.60

    def _calculate_transition_risk(self, symbol: str) -> float:
        """Calculate risk of regime transition."""
        momentum = self.momentum_cache.get(symbol)
        if momentum and momentum.fatigue_level > 80:
            return 0.8
        return 0.3

    def _estimate_volatility(self, symbol: str) -> str:
        """Estimate expected volatility."""
        if symbol in self.price_history and len(self.price_history[symbol]) >= 20:
            volatility = statistics.stdev(list(self.price_history[symbol])[-20:])
            if volatility > 100:
                return "EXTREME"
            elif volatility > 50:
                return "HIGH"
            elif volatility > 20:
                return "MEDIUM"
        return "LOW"

    def _recommend_strategy(self, regime_type: str, sub_regime: str) -> str:
        """Recommend optimal trading strategy."""
        if regime_type == "TRENDING":
            return "TREND_FOLLOWING"
        elif regime_type == "RANGING":
            return "MEAN_REVERSION"
        elif regime_type == "VOLATILE":
            return "SCALPING"
        return "NEUTRAL"

    def _calculate_momentum(self, prices: List[float]) -> float:
        """Calculate momentum."""
        if len(prices) < 2:
            return 0.0
        return ((prices[-1] - prices[0]) / prices[0]) * 100

    def _detect_momentum_acceleration(self, prices: List[float]) -> str:
        """Detect momentum acceleration."""
        if len(prices) < 30:
            return "SUSTAINING"
        
        recent_momentum = abs(self._calculate_momentum(prices[-14:]))
        older_momentum = abs(self._calculate_momentum(prices[-30:-16]))
        
        if recent_momentum > older_momentum * 1.1:
            return "ACCELERATING"
        elif recent_momentum < older_momentum * 0.9:
            return "DECELERATING"
        else:
            return "SUSTAINING"

    def _calculate_momentum_fatigue(self, prices: List[float]) -> float:
        """Calculate momentum fatigue."""
        if len(prices) < 20:
            return 0.0
        
        recent = prices[-20:]
        ups = sum(1 for i in range(1, len(recent)) if recent[i] > recent[i-1])
        fatigue = (ups / len(recent)) * 100
        
        return min(100, fatigue)

    def _calculate_next_target(self, prices: List[float], direction: str) -> float:
        """Calculate next price target."""
        recent_high = max(prices[-20:]) if len(prices) >= 20 else prices[-1]
        recent_low = min(prices[-20:]) if len(prices) >= 20 else prices[-1]
        current = prices[-1]
        
        range_val = recent_high - recent_low
        
        if direction == "BULLISH":
            return current + range_val * 0.5
        else:
            return current - range_val * 0.5


# Global instance
market_regime_detector = MarketRegimeDetector()
