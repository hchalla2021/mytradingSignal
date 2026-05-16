"""Market Compass Engine - Multi-market correlation and cross-market analysis.

Core engine for analyzing correlations between multiple indices (NIFTY, BANKNIFTY,
SENSEX, global markets) and detecting market structure patterns across different timeframes.

Performance targets: <20ms per update, 400+ symbols supported
"""

import asyncio
import logging
from dataclasses import dataclass, field
from collections import deque
from threading import RLock
from typing import Dict, List, Optional, Tuple
from datetime import datetime, timedelta
import statistics

logger = logging.getLogger(__name__)


@dataclass
class MarketSnapshot:
    """Point-in-time snapshot of a symbol's data"""
    timestamp: datetime
    symbol: str
    price: float
    high: float
    low: float
    volume: int
    bid: float
    ask: float
    bid_volume: int
    ask_volume: int


@dataclass
class CorrelationData:
    """Correlation analysis between two symbols"""
    symbol1: str
    symbol2: str
    correlation_coefficient: float  # -1 to 1
    strength: str  # STRONG_POSITIVE, WEAK_POSITIVE, NEUTRAL, WEAK_NEGATIVE, STRONG_NEGATIVE
    lookback_bars: int
    timestamp: datetime = field(default_factory=datetime.now)


@dataclass
class MarketStructure:
    """Market structure analysis for a symbol"""
    symbol: str
    trend_type: str  # UPTREND, DOWNTREND, RANGING, CONSOLIDATION
    volatility_regime: str  # LOW, MEDIUM, HIGH, EXTREME
    momentum_direction: str  # BULLISH, BEARISH, NEUTRAL
    momentum_strength: float  # 0-100
    structure_strength: float  # 0-1
    higher_timeframe_bias: str  # BULLISH, BEARISH, NEUTRAL
    support_levels: List[float]
    resistance_levels: List[float]
    timestamp: datetime = field(default_factory=datetime.now)


@dataclass
class CrossMarketSignal:
    """Cross-market signal detection"""
    primary_symbol: str
    correlated_symbols: List[str]
    signal_type: str  # BREAKOUT, BREAKDOWN, REVERSAL, CONSOLIDATION_BREAK
    confidence: float  # 0-1
    expected_direction: str  # BULLISH, BEARISH
    magnitude: float  # 0-100
    affected_symbols: List[str]
    timestamp: datetime = field(default_factory=datetime.now)


class MarketCompassEngine:
    """Multi-market correlation and cross-market pattern engine.
    
    Features:
    - Real-time correlation analysis between symbols
    - Cross-market structure synchronization
    - Volatility spillover detection
    - Global impact analysis
    - Momentum correlation detection
    - Multi-timeframe market analysis
    """

    def __init__(self):
        self.logger = logger
        self.lock = RLock()
        
        # Market data buffers
        self.market_data: Dict[str, deque] = {}
        self.correlation_cache: Dict[str, CorrelationData] = {}
        self.structure_cache: Dict[str, MarketStructure] = {}
        
        # Configuration
        self.lookback_bars = 100
        self.correlation_threshold = 0.6
        self.volatility_lookback = 20
        self.momentum_lookback = 14
        
        # Global symbols
        self.primary_symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
        self.secondary_symbols = ["INDIAVIX", "USDINR"]
        self.all_symbols = self.primary_symbols + self.secondary_symbols

    async def process_market_tick(self, symbol: str, tick: Dict) -> Optional[Dict]:
        """Process incoming market tick and return correlation insights."""
        try:
            with self.lock:
                # Update market data buffer
                snapshot = MarketSnapshot(
                    timestamp=datetime.now(),
                    symbol=symbol,
                    price=float(tick.get('ltp', 0)),
                    high=float(tick.get('high', 0)),
                    low=float(tick.get('low', 0)),
                    volume=int(tick.get('volume', 0)),
                    bid=float(tick.get('bid', 0)),
                    ask=float(tick.get('ask', 0)),
                    bid_volume=int(tick.get('bid_volume', 0)),
                    ask_volume=int(tick.get('ask_volume', 0))
                )
                
                if symbol not in self.market_data:
                    self.market_data[symbol] = deque(maxlen=self.lookback_bars)
                
                self.market_data[symbol].append(snapshot)
                
                # Analyze structure
                structure = self._analyze_market_structure(symbol)
                if structure:
                    self.structure_cache[symbol] = structure
                
                # Detect correlations
                correlations = await self._detect_correlations(symbol)
                
                # Detect cross-market signals
                cross_signals = self._detect_cross_market_signals(symbol)
                
                return {
                    'symbol': symbol,
                    'structure': structure,
                    'correlations': correlations,
                    'cross_signals': cross_signals,
                    'timestamp': datetime.now().isoformat()
                }
        except Exception as e:
            self.logger.error(f"Error processing tick for {symbol}: {str(e)}")
            return None

    async def _detect_correlations(self, primary_symbol: str) -> List[CorrelationData]:
        """Detect correlations between symbols."""
        if primary_symbol not in self.market_data:
            return []
        
        correlations = []
        primary_data = list(self.market_data[primary_symbol])
        
        if len(primary_data) < self.lookback_bars // 2:
            return correlations
        
        primary_prices = [s.price for s in primary_data[-self.lookback_bars:]]
        
        for symbol in self.all_symbols:
            if symbol == primary_symbol or symbol not in self.market_data:
                continue
            
            secondary_data = list(self.market_data[symbol])
            if len(secondary_data) < self.lookback_bars // 2:
                continue
            
            secondary_prices = [s.price for s in secondary_data[-self.lookback_bars:]]
            
            # Calculate correlation coefficient
            corr = self._calculate_correlation(primary_prices, secondary_prices)
            
            if abs(corr) > 0.3:  # Only significant correlations
                strength = self._classify_correlation_strength(corr)
                
                corr_data = CorrelationData(
                    symbol1=primary_symbol,
                    symbol2=symbol,
                    correlation_coefficient=corr,
                    strength=strength,
                    lookback_bars=self.lookback_bars
                )
                
                cache_key = f"{primary_symbol}-{symbol}"
                self.correlation_cache[cache_key] = corr_data
                correlations.append(corr_data)
        
        return correlations

    def _analyze_market_structure(self, symbol: str) -> Optional[MarketStructure]:
        """Analyze market structure for a symbol."""
        if symbol not in self.market_data:
            return None
        
        data = list(self.market_data[symbol])
        if len(data) < 10:
            return None
        
        prices = [s.price for s in data]
        highs = [s.high for s in data]
        lows = [s.low for s in data]
        
        # Trend detection
        trend_type = self._detect_trend(prices)
        
        # Volatility regime
        volatility = self._calculate_volatility(prices[-self.volatility_lookback:])
        volatility_regime = self._classify_volatility(volatility)
        
        # Momentum
        momentum_direction, momentum_strength = self._analyze_momentum(prices)
        
        # Support/Resistance
        support, resistance = self._identify_support_resistance(lows, highs)
        
        # Higher timeframe bias
        htf_bias = self._determine_htf_bias(prices)
        
        return MarketStructure(
            symbol=symbol,
            trend_type=trend_type,
            volatility_regime=volatility_regime,
            momentum_direction=momentum_direction,
            momentum_strength=momentum_strength,
            structure_strength=self._calculate_structure_strength(trend_type),
            higher_timeframe_bias=htf_bias,
            support_levels=support,
            resistance_levels=resistance
        )

    def _detect_cross_market_signals(self, symbol: str) -> List[CrossMarketSignal]:
        """Detect signals affecting multiple markets."""
        signals = []
        
        if symbol not in self.structure_cache:
            return signals
        
        primary_structure = self.structure_cache[symbol]
        
        # Find correlated symbols
        correlated = []
        for cache_key, corr_data in self.correlation_cache.items():
            if cache_key.startswith(symbol) and abs(corr_data.correlation_coefficient) > self.correlation_threshold:
                other_symbol = cache_key.split('-')[1] if cache_key.endswith(symbol) else cache_key.split('-')[0]
                if other_symbol in self.structure_cache:
                    correlated.append(other_symbol)
        
        # Generate signal if significant move detected
        if correlated:
            affected = [symbol] + correlated
            signal = CrossMarketSignal(
                primary_symbol=symbol,
                correlated_symbols=correlated,
                signal_type=self._determine_signal_type(primary_structure),
                confidence=min(1.0, len(correlated) / len(self.all_symbols)),
                expected_direction=primary_structure.momentum_direction,
                magnitude=primary_structure.momentum_strength,
                affected_symbols=affected
            )
            signals.append(signal)
        
        return signals

    def _calculate_correlation(self, series1: List[float], series2: List[float]) -> float:
        """Calculate Pearson correlation coefficient."""
        if len(series1) != len(series2) or len(series1) < 2:
            return 0.0
        
        try:
            mean1 = statistics.mean(series1)
            mean2 = statistics.mean(series2)
            
            numerator = sum((series1[i] - mean1) * (series2[i] - mean2) for i in range(len(series1)))
            
            std1 = statistics.stdev(series1) if len(series1) > 1 else 0
            std2 = statistics.stdev(series2) if len(series2) > 1 else 0
            
            if std1 == 0 or std2 == 0:
                return 0.0
            
            correlation = numerator / (std1 * std2 * len(series1))
            return max(-1.0, min(1.0, correlation))
        except Exception:
            return 0.0

    def _classify_correlation_strength(self, correlation: float) -> str:
        """Classify correlation strength."""
        abs_corr = abs(correlation)
        
        if abs_corr > 0.8:
            return "STRONG_POSITIVE" if correlation > 0 else "STRONG_NEGATIVE"
        elif abs_corr > 0.6:
            return "MODERATE_POSITIVE" if correlation > 0 else "MODERATE_NEGATIVE"
        elif abs_corr > 0.3:
            return "WEAK_POSITIVE" if correlation > 0 else "WEAK_NEGATIVE"
        else:
            return "NEUTRAL"

    def _detect_trend(self, prices: List[float]) -> str:
        """Detect trend type."""
        if len(prices) < 10:
            return "RANGING"
        
        recent = prices[-10:]
        older = prices[-20:-10] if len(prices) >= 20 else prices[:10]
        
        recent_avg = statistics.mean(recent)
        older_avg = statistics.mean(older)
        
        if recent_avg > older_avg * 1.01:
            return "UPTREND"
        elif recent_avg < older_avg * 0.99:
            return "DOWNTREND"
        else:
            return "RANGING"

    def _calculate_volatility(self, prices: List[float]) -> float:
        """Calculate volatility (standard deviation)."""
        if len(prices) < 2:
            return 0.0
        try:
            return statistics.stdev(prices)
        except:
            return 0.0

    def _classify_volatility(self, volatility: float) -> str:
        """Classify volatility regime."""
        if volatility < 20:
            return "LOW"
        elif volatility < 50:
            return "MEDIUM"
        elif volatility < 100:
            return "HIGH"
        else:
            return "EXTREME"

    def _analyze_momentum(self, prices: List[float]) -> Tuple[str, float]:
        """Analyze momentum direction and strength."""
        if len(prices) < self.momentum_lookback:
            return "NEUTRAL", 0.0
        
        recent = prices[-self.momentum_lookback:]
        trend = 0
        
        for i in range(1, len(recent)):
            if recent[i] > recent[i-1]:
                trend += 1
            elif recent[i] < recent[i-1]:
                trend -= 1
        
        strength = abs(trend) / self.momentum_lookback * 100
        
        if trend > 0:
            return "BULLISH", strength
        elif trend < 0:
            return "BEARISH", strength
        else:
            return "NEUTRAL", 0.0

    def _identify_support_resistance(self, lows: List[float], highs: List[float]) -> Tuple[List[float], List[float]]:
        """Identify support and resistance levels."""
        support = [min(lows[-20:]) if len(lows) >= 20 else min(lows)]
        resistance = [max(highs[-20:]) if len(highs) >= 20 else max(highs)]
        
        return support, resistance

    def _determine_htf_bias(self, prices: List[float]) -> str:
        """Determine higher timeframe bias."""
        if len(prices) < 50:
            return "NEUTRAL"
        
        old_price = prices[0]
        new_price = prices[-1]
        
        if new_price > old_price * 1.02:
            return "BULLISH"
        elif new_price < old_price * 0.98:
            return "BEARISH"
        else:
            return "NEUTRAL"

    def _calculate_structure_strength(self, trend_type: str) -> float:
        """Calculate structure strength."""
        strength_map = {
            "UPTREND": 0.8,
            "DOWNTREND": 0.8,
            "RANGING": 0.3,
            "CONSOLIDATION": 0.4
        }
        return strength_map.get(trend_type, 0.5)

    def _determine_signal_type(self, structure: MarketStructure) -> str:
        """Determine cross-market signal type."""
        if structure.trend_type in ["UPTREND", "DOWNTREND"]:
            if structure.momentum_strength > 75:
                return "BREAKOUT" if structure.trend_type == "UPTREND" else "BREAKDOWN"
        return "CONSOLIDATION_BREAK"


# Global instance
market_compass_engine = MarketCompassEngine()
