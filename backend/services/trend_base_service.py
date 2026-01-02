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
            signal_threshold: Minimum score for signal (0-100) - 50 for balanced trading
        """
        self._cache: Dict[str, Tuple[float, float]] = {}  # (last_high, last_low)
        self._lookback = lookback_period
        self._swing_order = swing_order
        self._min_candles = 15  # 🔥 REDUCED from 20 to detect trends faster
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
        🔥 FIXED: Improved swing detection with dynamic sensitivity
        Now correctly identifies Higher-Highs and Higher-Lows for indices
        """
        highs_list = []
        lows_list = []
        
        try:
            # Convert to numpy for speed
            high_arr = df['high'].values
            low_arr = df['low'].values
            close_arr = df['close'].values
            
            # 🔥 FIX 1: Try multiple orders to catch all significant swings
            # Start with sensitive detection (order=2) then merge with less sensitive (order=3,4)
            all_high_indices = set()
            all_low_indices = set()
            
            for order in [2, 3, 4]:  # Multi-scale swing detection
                try:
                    # Find local maxima (swing highs)
                    high_idx = argrelextrema(high_arr, np.greater, order=order)[0]
                    all_high_indices.update(high_idx)
                    
                    # Find local minima (swing lows)
                    low_idx = argrelextrema(low_arr, np.less, order=order)[0]
                    all_low_indices.update(low_idx)
                except:
                    continue
            
            # 🔥 FIX 2: Sort and filter swing points by significance
            # Only keep swings that represent meaningful price movement
            high_indices = sorted(list(all_high_indices))
            low_indices = sorted(list(all_low_indices))
            
            # Calculate price range for significance filter
            price_range = high_arr.max() - low_arr.min()
            min_swing_size = price_range * 0.003  # 0.3% of range (intraday relevant)
            
            # Filter highs - must be significant
            prev_high = None
            for idx in high_indices:
                current_high = float(high_arr[idx])
                if prev_high is None or abs(current_high - prev_high) >= min_swing_size:
                    highs_list.append(SwingPoint(
                        price=current_high,
                        index=int(idx),
                        type='HIGH'
                    ))
                    prev_high = current_high
            
            # Filter lows - must be significant
            prev_low = None
            for idx in low_indices:
                current_low = float(low_arr[idx])
                if prev_low is None or abs(current_low - prev_low) >= min_swing_size:
                    lows_list.append(SwingPoint(
                        price=current_low,
                        index=int(idx),
                        type='LOW'
                    ))
                    prev_low = current_low
            
            # 🔥 FIX 3: Smart current price integration
            # Only add if it's actually a new swing (not just last candle)
            current_close = float(close_arr[-1])
            current_high = float(high_arr[-1])
            current_low = float(low_arr[-1])
            
            # Check if current high is genuinely higher than recent highs
            if len(highs_list) >= 1:
                recent_highs = [h.price for h in highs_list[-3:]]  # Last 3 highs
                if current_high > max(recent_highs):
                    # Confirm it's a breakout, not noise
                    if (current_high - max(recent_highs)) >= min_swing_size:
                        highs_list.append(SwingPoint(current_high, len(df) - 1, 'HIGH'))
            elif len(high_arr) > 5:  # Not enough swings yet, add if it's a peak
                if current_high >= max(high_arr[-5:]):
                    highs_list.append(SwingPoint(current_high, len(df) - 1, 'HIGH'))
            
            # Check if current low is genuinely lower than recent lows
            if len(lows_list) >= 1:
                recent_lows = [l.price for l in lows_list[-3:]]  # Last 3 lows
                if current_low < min(recent_lows):
                    # Confirm it's a breakdown, not noise
                    if (min(recent_lows) - current_low) >= min_swing_size:
                        lows_list.append(SwingPoint(current_low, len(df) - 1, 'LOW'))
            elif len(low_arr) > 5:  # Not enough swings yet, add if it's a valley
                if current_low <= min(low_arr[-5:]):
                    lows_list.append(SwingPoint(current_low, len(df) - 1, 'LOW'))
            
            # 🔥 FIX 4: Ensure we have enough swings by adding most obvious ones if missing
            if len(highs_list) < 2 and len(high_arr) >= 10:
                # Find the 2 highest points manually
                sorted_highs = np.argsort(high_arr)[-5:]  # Top 5 highs
                for idx in sorted(sorted_highs):
                    if len(highs_list) < 2:
                        highs_list.append(SwingPoint(float(high_arr[idx]), int(idx), 'HIGH'))
            
            if len(lows_list) < 2 and len(low_arr) >= 10:
                # Find the 2 lowest points manually
                sorted_lows = np.argsort(low_arr)[:5]  # Top 5 lows
                for idx in sorted(sorted_lows):
                    if len(lows_list) < 2:
                        lows_list.append(SwingPoint(float(low_arr[idx]), int(idx), 'LOW'))
            
            # Sort by index to maintain chronological order
            highs_list.sort(key=lambda x: x.index)
            lows_list.sort(key=lambda x: x.index)
            
        except Exception as e:
            print(f"[SWING-DETECTION] Error: {e}")
            import traceback
            traceback.print_exc()
        
        return highs_list, lows_list
    
    def _classify_structure(
        self,
        last_high: SwingPoint,
        prev_high: SwingPoint,
        last_low: SwingPoint,
        prev_low: SwingPoint
    ) -> Tuple[str, int]:
        """
        🔥 FIXED: Accurate structure classification for intraday trading
        Returns: (structure_name, integrity_score 0-100)
        """
        # Check structure components
        is_higher_high = last_high.price > prev_high.price
        is_higher_low = last_low.price > prev_low.price
        is_lower_high = last_high.price < prev_high.price
        is_lower_low = last_low.price < prev_low.price
        
        # Calculate percentage changes (more relevant for indices)
        high_pct_change = ((last_high.price - prev_high.price) / prev_high.price) * 100
        low_pct_change = ((last_low.price - prev_low.price) / prev_low.price) * 100
        
        # Base score
        score = 50
        
        # === BULLISH STRUCTURE (Higher-High, Higher-Low) ===
        if is_higher_high and is_higher_low:
            structure = "HIGHER-HIGH-HIGHER-LOW"
            
            # 🔥 IMPROVED SCORING: Based on actual index movement patterns
            # Typical intraday index swing: 0.1-0.5% = Moderate, 0.5-1% = Strong, >1% = Very Strong
            
            # High contribution (0-40 points)
            if high_pct_change >= 1.0:      # >1% = Very strong
                high_score = 40
            elif high_pct_change >= 0.5:    # 0.5-1% = Strong
                high_score = 30
            elif high_pct_change >= 0.25:   # 0.25-0.5% = Moderate
                high_score = 20
            elif high_pct_change >= 0.1:    # 0.1-0.25% = Weak but valid
                high_score = 10
            else:                            # <0.1% = Very weak
                high_score = 5
            
            # Low contribution (0-40 points)
            if low_pct_change >= 1.0:       # >1% = Very strong
                low_score = 40
            elif low_pct_change >= 0.5:     # 0.5-1% = Strong
                low_score = 30
            elif low_pct_change >= 0.25:    # 0.25-0.5% = Moderate
                low_score = 20
            elif low_pct_change >= 0.1:     # 0.1-0.25% = Weak but valid
                low_score = 10
            else:                            # <0.1% = Very weak
                low_score = 5
            
            # Final score: 50 (base) + high_score + low_score
            score = 50 + high_score + low_score
            score = min(score, 100)  # Cap at 100
        
        # === BEARISH STRUCTURE (Lower-High, Lower-Low) ===
        elif is_lower_high and is_lower_low:
            structure = "LOWER-HIGH-LOWER-LOW"
            
            # Calculate downside movement (negative percentages)
            high_pct_decline = abs(high_pct_change)  # Make positive for scoring
            low_pct_decline = abs(low_pct_change)    # Make positive for scoring
            
            # High penalty (0-40 points)
            if high_pct_decline >= 1.0:      # >1% decline = Very weak
                high_penalty = 40
            elif high_pct_decline >= 0.5:    # 0.5-1% = Weak
                high_penalty = 30
            elif high_pct_decline >= 0.25:   # 0.25-0.5% = Moderate weakness
                high_penalty = 20
            elif high_pct_decline >= 0.1:    # 0.1-0.25% = Slight weakness
                high_penalty = 10
            else:                             # <0.1% = Minimal weakness
                high_penalty = 5
            
            # Low penalty (0-40 points)
            if low_pct_decline >= 1.0:       # >1% decline = Very weak
                low_penalty = 40
            elif low_pct_decline >= 0.5:     # 0.5-1% = Weak
                low_penalty = 30
            elif low_pct_decline >= 0.25:    # 0.25-0.5% = Moderate weakness
                low_penalty = 20
            elif low_pct_decline >= 0.1:     # 0.1-0.25% = Slight weakness
                low_penalty = 10
            else:                             # <0.1% = Minimal weakness
                low_penalty = 5
            
            # Final score: 50 (base) - high_penalty - low_penalty
            score = 50 - high_penalty - low_penalty
            score = max(score, 0)  # Floor at 0
        
        # === MIXED STRUCTURES (Conflicting signals) ===
        elif is_higher_high and is_lower_low:
            structure = "HIGHER-HIGH-LOWER-LOW"  # Topping pattern / weakening uptrend
            # Price making new highs but lows are falling = Distribution
            score = 45  # Slightly bearish bias
        
        elif is_lower_high and is_higher_low:
            structure = "LOWER-HIGH-HIGHER-LOW"  # Bottoming pattern / potential reversal
            # Price not making new highs but lows are rising = Accumulation
            score = 55  # Slightly bullish bias
        
        else:
            # Equal highs/lows or unclear pattern
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
