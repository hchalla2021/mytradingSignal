"""
Trend Base Service - Ultra-Fast Higher-Low Structure Detection
═══════════════════════════════════════════════════════════════
Swing point detection with optimized peak/valley algorithm
Performance: O(n) time, O(1) space | Target: <5ms execution

Key Metrics:
- Higher-High / Higher-Low structure
- Swing point identification
- Trend structure integrity (0-100%)
- Real-time BUY/SELL signals based on structure breaks
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime
import asyncio
from scipy.signal import argrelextrema


@dataclass
class SwingPoint:
    """Lightweight swing point container"""
    __slots__ = ('price', 'index', 'type')
    price: float
    index: int
    type: str  # 'HIGH' or 'LOW'


@dataclass
class TrendBaseResult:
    """Ultra-lightweight result container"""
    __slots__ = ('symbol', 'structure', 'integrity_score', 'signal', 'confidence',
                 'last_high', 'last_low', 'prev_high', 'prev_low', 'trend', 'timestamp')
    
    symbol: str
    structure: str  # HIGHER-HIGH-HIGHER-LOW, LOWER-HIGH-LOWER-LOW, MIXED
    integrity_score: int  # 0-100
    signal: str  # BUY, SELL, NEUTRAL
    confidence: int  # 0-100
    last_high: float
    last_low: float
    prev_high: float
    prev_low: float
    trend: str  # UPTREND, DOWNTREND, SIDEWAYS
    timestamp: str


class TrendBaseEngine:
    """
    High-Performance Swing Structure Analyzer
    ═════════════════════════════════════════
    Algorithm: Optimized peak/valley detection with vectorization
    Memory: O(1) - minimal buffering, streaming analysis
    """
    
    __slots__ = ('_cache', '_lookback', '_swing_order', '_min_candles', '_signal_threshold')
    
    def __init__(self, lookback_period: int = 50, swing_order: int = 3, signal_threshold: int = 50):
        """
        Args:
            lookback_period: Candles to analyze (default: 50)
            swing_order: Swing detection sensitivity (3 = medium)
            signal_threshold: Minimum score for signal (0-100) - lowered to 50 for better responsiveness
        """
        self._cache: Dict[str, Tuple[float, float]] = {}  # (last_high, last_low)
        self._lookback = lookback_period
        self._swing_order = swing_order
        self._min_candles = 20
        self._signal_threshold = signal_threshold
    
    def analyze(self, symbol: str, df: pd.DataFrame) -> TrendBaseResult:
        """
        Main analysis - ULTRA FAST
        Target: <5ms for 100 candles
        """
        try:
            # Fast validation
            if df.empty or len(df) < self._min_candles:
                return self._create_neutral_result(symbol, "Insufficient data")
            
            # Get recent data
            recent = df.tail(self._lookback)
            
            # === SWING POINT DETECTION (Vectorized) ===
            highs, lows = self._detect_swing_points(recent)
            
            if len(highs) < 2 or len(lows) < 2:
                return self._create_neutral_result(symbol, "Not enough swing points")
            
            # Get last 2 swing highs and lows
            last_high = highs[-1]
            prev_high = highs[-2]
            last_low = lows[-1]
            prev_low = lows[-2]
            
            # === STRUCTURE CLASSIFICATION ===
            structure, integrity_score = self._classify_structure(
                last_high, prev_high, last_low, prev_low
            )
            
            # === SIGNAL GENERATION ===
            signal, confidence = self._generate_signal(
                structure, integrity_score, recent, last_low
            )
            
            # === TREND CLASSIFICATION ===
            trend = self._classify_trend(structure, integrity_score)
            
            # Cache for next iteration
            self._cache[symbol] = (last_high.price, last_low.price)
            
            return TrendBaseResult(
                symbol=symbol,
                structure=structure,
                integrity_score=integrity_score,
                signal=signal,
                confidence=confidence,
                last_high=last_high.price,
                last_low=last_low.price,
                prev_high=prev_high.price,
                prev_low=prev_low.price,
                trend=trend,
                timestamp=datetime.now().isoformat()
            )
            
        except Exception as e:
            print(f"[TREND-BASE] Error analyzing {symbol}: {e}")
            return self._create_neutral_result(symbol, f"Error: {e}")
    
    def _detect_swing_points(self, df: pd.DataFrame) -> Tuple[List[SwingPoint], List[SwingPoint]]:
        """
        Detect swing highs and lows using optimized algorithm
        Uses scipy's argrelextrema for O(n) performance
        """
        highs_list = []
        lows_list = []
        
        try:
            # Convert to numpy for speed
            high_arr = df['high'].values
            low_arr = df['low'].values
            
            # Find local maxima (swing highs)
            high_indices = argrelextrema(high_arr, np.greater, order=self._swing_order)[0]
            for idx in high_indices:
                highs_list.append(SwingPoint(
                    price=float(high_arr[idx]),
                    index=int(idx),
                    type='HIGH'
                ))
            
            # Find local minima (swing lows)
            low_indices = argrelextrema(low_arr, np.less, order=self._swing_order)[0]
            for idx in low_indices:
                lows_list.append(SwingPoint(
                    price=float(low_arr[idx]),
                    index=int(idx),
                    type='LOW'
                ))
            
            # Add current price as potential swing point
            current_high = float(df.iloc[-1]['high'])
            current_low = float(df.iloc[-1]['low'])
            
            if not highs_list or current_high > highs_list[-1].price:
                highs_list.append(SwingPoint(current_high, len(df) - 1, 'HIGH'))
            
            if not lows_list or current_low < lows_list[-1].price:
                lows_list.append(SwingPoint(current_low, len(df) - 1, 'LOW'))
            
        except Exception as e:
            print(f"[SWING-DETECTION] Error: {e}")
        
        return highs_list, lows_list
    
    def _classify_structure(
        self,
        last_high: SwingPoint,
        prev_high: SwingPoint,
        last_low: SwingPoint,
        prev_low: SwingPoint
    ) -> Tuple[str, int]:
        """
        Classify trend structure and calculate integrity score
        Returns: (structure_name, integrity_score)
        """
        # Check structure
        is_higher_high = last_high.price > prev_high.price
        is_higher_low = last_low.price > prev_low.price
        is_lower_high = last_high.price < prev_high.price
        is_lower_low = last_low.price < prev_low.price
        
        # Calculate score (0-100)
        score = 50  # Base score
        
        # === BULLISH STRUCTURE (Higher-High, Higher-Low) ===
        if is_higher_high and is_higher_low:
            structure = "HIGHER-HIGH-HIGHER-LOW"
            
            # Calculate strength (OPTIMIZED FOR INTRADAY TRADING!)
            # Using higher multiplier (×100 instead of ×10) for intraday sensitivity
            high_gain = (last_high.price - prev_high.price) / prev_high.price * 100
            low_gain = (last_low.price - prev_low.price) / prev_low.price * 100
            
            # For intraday: 0.1% gain = 10 points, 0.2% = 20 points, etc.
            high_contribution = min(high_gain * 100, 35)  # Max 35 points from highs
            low_contribution = min(low_gain * 100, 35)    # Max 35 points from lows
            
            score = 50 + int(high_contribution) + int(low_contribution)
            score = min(score, 100)
        
        # === BEARISH STRUCTURE (Lower-High, Lower-Low) ===
        elif is_lower_high and is_lower_low:
            structure = "LOWER-HIGH-LOWER-LOW"
            
            # Calculate weakness (OPTIMIZED FOR INTRADAY TRADING!)
            # Using higher multiplier (×100 instead of ×10) for intraday sensitivity
            high_loss = (prev_high.price - last_high.price) / prev_high.price * 100
            low_loss = (prev_low.price - last_low.price) / prev_low.price * 100
            
            # For intraday: 0.1% loss = -10 points, 0.2% = -20 points, etc.
            high_penalty = min(high_loss * 100, 35)  # Max 35 points penalty
            low_penalty = min(low_loss * 100, 35)    # Max 35 points penalty
            
            score = 50 - int(high_penalty) - int(low_penalty)
            score = max(score, 0)
        
        # === MIXED STRUCTURE ===
        elif is_higher_high and is_lower_low:
            structure = "HIGHER-HIGH-LOWER-LOW"  # Topping pattern
            score = 40
        
        elif is_lower_high and is_higher_low:
            structure = "LOWER-HIGH-HIGHER-LOW"  # Bottoming pattern
            score = 60
        
        else:
            structure = "MIXED"
            score = 50
        
        return structure, score
    
    def _generate_signal(
        self,
        structure: str,
        integrity_score: int,
        recent_df: pd.DataFrame,
        last_low: SwingPoint
    ) -> Tuple[str, int]:
        """
        Generate trading signal based on structure
        Returns: (signal, confidence)
        """
        current_price = float(recent_df.iloc[-1]['close'])
        confidence = 0
        
        # === STRONG BUY (Higher-Low structure + near support) ===
        if structure == "HIGHER-HIGH-HIGHER-LOW" and integrity_score >= 65:
            # Check if price is near the higher-low
            distance_to_low = ((current_price - last_low.price) / last_low.price) * 100
            
            if distance_to_low < 2:  # Within 2% of higher-low
                signal = "BUY"
                confidence = min(integrity_score + 10, 95)
            elif distance_to_low < 5:
                signal = "BUY"
                confidence = integrity_score
            else:
                signal = "BUY"
                confidence = max(integrity_score - 10, 55)
        
        # === MODERATE BUY (Lower threshold for better detection) ===
        elif structure == "HIGHER-HIGH-HIGHER-LOW" and integrity_score >= self._signal_threshold:
            signal = "BUY"
            confidence = integrity_score
        
        # === STRONG SELL (Lower-Low structure breakdown) ===
        elif structure == "LOWER-HIGH-LOWER-LOW" and integrity_score <= 25:
            signal = "SELL"
            confidence = min(100 - integrity_score, 95)
        
        # === MODERATE SELL ===
        elif structure == "LOWER-HIGH-LOWER-LOW" and integrity_score <= (100 - self._signal_threshold):
            signal = "SELL"
            confidence = 100 - integrity_score
        
        # === NEUTRAL ===
        else:
            signal = "NEUTRAL"
            confidence = max(0, 50 - abs(50 - integrity_score))
        
        return signal, confidence
    
    def _classify_trend(self, structure: str, integrity_score: int) -> str:
        """Classify overall trend - More responsive thresholds for real trading"""
        # If clear bullish structure detected (even with moderate integrity), it's UPTREND
        if "HIGHER-HIGH-HIGHER-LOW" in structure and integrity_score >= 52:
            return "UPTREND"
        # If clear bearish structure detected
        elif "LOWER-HIGH-LOWER-LOW" in structure and integrity_score <= 48:
            return "DOWNTREND"
        # Mixed signals or weak structure
        else:
            return "SIDEWAYS"
    
    def _create_neutral_result(self, symbol: str, reason: str) -> TrendBaseResult:
        """Create neutral result for errors/edge cases"""
        return TrendBaseResult(
            symbol=symbol,
            structure="MIXED",
            integrity_score=50,
            signal="NEUTRAL",
            confidence=0,
            last_high=0.0,
            last_low=0.0,
            prev_high=0.0,
            prev_low=0.0,
            trend="SIDEWAYS",
            timestamp=datetime.now().isoformat()
        )
    
    def to_dict(self, result: TrendBaseResult) -> Dict:
        """Convert result to API-friendly dictionary"""
        return {
            "symbol": result.symbol,
            "structure": {
                "type": result.structure,
                "integrity_score": result.integrity_score,
                "swing_points": {
                    "last_high": round(result.last_high, 2),
                    "last_low": round(result.last_low, 2),
                    "prev_high": round(result.prev_high, 2),
                    "prev_low": round(result.prev_low, 2),
                    "high_diff": round(result.last_high - result.prev_high, 2),
                    "low_diff": round(result.last_low - result.prev_low, 2)
                }
            },
            "signal": result.signal,
            "confidence": result.confidence,
            "trend": result.trend,
            "status": "ACTIVE" if result.confidence >= self._signal_threshold else "WATCHING",
            "timestamp": result.timestamp
        }


# ═══════════════════════════════════════════════════════════
# SINGLETON PATTERN - Reuse engine across requests
# ═══════════════════════════════════════════════════════════

_engine_instance: Optional[TrendBaseEngine] = None


def get_trend_base_engine() -> TrendBaseEngine:
    """Get or create singleton engine instance with optimized thresholds"""
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = TrendBaseEngine(lookback_period=50, swing_order=3, signal_threshold=50)
    return _engine_instance


async def analyze_trend_base(symbol: str, df: pd.DataFrame) -> Dict:
    """
    Main entry point for API
    Ultra-fast async wrapper
    """
    engine = get_trend_base_engine()
    result = await asyncio.to_thread(engine.analyze, symbol, df)
    return engine.to_dict(result)
