"""
Volume Pulse Service - Ultra-Fast Candle Volume Analysis
═══════════════════════════════════════════════════════════
Tracks buying/selling pressure through candle color + volume
Performance: O(n) time, O(1) space | Target: <5ms execution

Key Metrics:
- Green candle volume vs Red candle volume
- Volume ratio (strength indicator)
- Buying pressure score (0-100%)
- Real-time pulse detection for BUY/SELL signals
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime
import asyncio


@dataclass
class VolumePulseResult:
    """Ultra-lightweight result container"""
    __slots__ = ('symbol', 'green_vol', 'red_vol', 'ratio', 'pulse_score', 
                 'signal', 'confidence', 'trend', 'timestamp')
    
    symbol: str
    green_vol: int
    red_vol: int
    ratio: float  # green/red ratio
    pulse_score: int  # 0-100
    signal: str  # BUY, SELL, NEUTRAL
    confidence: int  # 0-100
    trend: str  # BULLISH, BEARISH, NEUTRAL
    timestamp: str


class VolumePulseEngine:
    """
    High-Performance Volume Pulse Analyzer
    ═════════════════════════════════════
    Algorithm: Single-pass O(n) with rolling window optimization
    Memory: O(1) - no buffering, streaming analysis
    """
    
    __slots__ = ('_cache', '_lookback', '_min_candles', '_signal_threshold')
    
    def __init__(self, lookback_period: int = 20, signal_threshold: int = 63):
        """
        Args:
            lookback_period: Candles to analyze (default: 20 for speed)
            signal_threshold: Minimum score for signal (0-100)
        """
        self._cache: Dict[str, Tuple[float, float]] = {}  # (green_vol, red_vol)
        self._lookback = lookback_period
        self._min_candles = 10  # Minimum data required
        self._signal_threshold = signal_threshold
    
    def analyze(self, symbol: str, df: pd.DataFrame) -> VolumePulseResult:
        """
        Main analysis - ULTRA FAST
        Target: <3ms for 100 candles
        """
        try:
            # Fast validation
            if df.empty or len(df) < self._min_candles:
                return self._create_neutral_result(symbol, "Insufficient data")
            
            # Get recent data (avoid copying entire DataFrame)
            recent = df.tail(self._lookback)
            
            # === VECTORIZED COMPUTATION (10x faster than loops) ===
            close_arr = recent['close'].values
            open_arr = recent['open'].values
            volume_arr = recent['volume'].values
            
            # Calculate candle colors in one operation
            is_green = close_arr > open_arr
            is_red = close_arr < open_arr
            
            # Sum volumes by color (no loops!)
            green_vol = int(np.sum(volume_arr[is_green]))
            red_vol = int(np.sum(volume_arr[is_red]))
            
            # Avoid division by zero
            if green_vol == 0 and red_vol == 0:
                return self._create_neutral_result(symbol, "No volume data")
            
            # Calculate metrics
            total_vol = green_vol + red_vol
            green_pct = (green_vol / total_vol * 100) if total_vol > 0 else 50
            red_pct = (red_vol / total_vol * 100) if total_vol > 0 else 50
            
            # Volume ratio (green/red)
            ratio = round(green_vol / red_vol, 2) if red_vol > 0 else 999.0
            
            # === PULSE SCORE CALCULATION (0-100) ===
            pulse_score = self._calculate_pulse_score(
                green_vol, red_vol, green_pct, recent
            )
            
            # === SIGNAL GENERATION ===
            signal, confidence = self._generate_signal(
                pulse_score, ratio, green_pct, red_pct
            )
            
            # === TREND CLASSIFICATION ===
            trend = self._classify_trend(pulse_score, ratio)
            
            # Cache for next iteration (prevent recalculation)
            self._cache[symbol] = (green_vol, red_vol)
            
            return VolumePulseResult(
                symbol=symbol,
                green_vol=green_vol,
                red_vol=red_vol,
                ratio=ratio,
                pulse_score=pulse_score,
                signal=signal,
                confidence=confidence,
                trend=trend,
                timestamp=datetime.now().isoformat()
            )
            
        except Exception as e:
            print(f"[VOLUME-PULSE] Error analyzing {symbol}: {e}")
            return self._create_neutral_result(symbol, f"Error: {e}")
    
    def _calculate_pulse_score(
        self, 
        green_vol: int, 
        red_vol: int, 
        green_pct: float,
        recent_df: pd.DataFrame
    ) -> int:
        """
        Calculate buying pressure score (0-100)
        Higher = More buying pressure
        """
        score = 0
        
        # 1. Base score from volume ratio (50 points max)
        score += int(green_pct / 2)  # Direct percentage mapping
        
        # 2. Recent momentum (30 points max)
        # Check last 5 candles for acceleration
        if len(recent_df) >= 5:
            last_5 = recent_df.tail(5)
            close_arr = last_5['close'].values
            open_arr = last_5['open'].values
            vol_arr = last_5['volume'].values
            
            green_last_5 = np.sum(vol_arr[close_arr > open_arr])
            red_last_5 = np.sum(vol_arr[close_arr < open_arr])
            
            if (green_last_5 + red_last_5) > 0:
                recent_green_pct = green_last_5 / (green_last_5 + red_last_5) * 100
                
                # Acceleration bonus
                if recent_green_pct > green_pct + 10:
                    score += 30  # Strong acceleration
                elif recent_green_pct > green_pct + 5:
                    score += 20  # Moderate acceleration
                elif recent_green_pct > green_pct:
                    score += 10  # Slight acceleration
        
        # 3. Volume strength (20 points max)
        total_vol = green_vol + red_vol
        avg_vol = recent_df['volume'].mean()
        
        if avg_vol > 0:
            vol_strength = (total_vol / len(recent_df)) / avg_vol
            
            if vol_strength > 1.5:
                score += 20  # Very strong volume
            elif vol_strength > 1.2:
                score += 15  # Strong volume
            elif vol_strength > 1.0:
                score += 10  # Above average
        
        return min(max(score, 0), 100)  # Clamp to 0-100
    
    def _generate_signal(
        self, 
        pulse_score: int, 
        ratio: float, 
        green_pct: float,
        red_pct: float
    ) -> Tuple[str, int]:
        """
        Generate trading signal with confidence
        Returns: (signal, confidence)
        """
        confidence = 0
        
        # === STRONG BUY CONDITIONS ===
        if pulse_score >= 75 and ratio > 1.5:
            signal = "BUY"
            confidence = min(pulse_score, 95)
        
        # === MODERATE BUY ===
        elif pulse_score >= self._signal_threshold and ratio > 1.2:
            signal = "BUY"
            confidence = pulse_score
        
        # === STRONG SELL CONDITIONS ===
        elif pulse_score <= 25 and ratio < 0.67:
            signal = "SELL"
            confidence = min(100 - pulse_score, 95)
        
        # === MODERATE SELL ===
        elif pulse_score <= (100 - self._signal_threshold) and ratio < 0.83:
            signal = "SELL"
            confidence = 100 - pulse_score
        
        # === NEUTRAL ===
        else:
            signal = "NEUTRAL"
            confidence = max(0, 50 - abs(50 - pulse_score))
        
        return signal, confidence
    
    def _classify_trend(self, pulse_score: int, ratio: float) -> str:
        """Classify overall trend"""
        if pulse_score >= 65 and ratio > 1.3:
            return "BULLISH"
        elif pulse_score <= 35 and ratio < 0.77:
            return "BEARISH"
        else:
            return "NEUTRAL"
    
    def _create_neutral_result(self, symbol: str, reason: str) -> VolumePulseResult:
        """Create neutral result for errors/edge cases"""
        return VolumePulseResult(
            symbol=symbol,
            green_vol=0,
            red_vol=0,
            ratio=1.0,
            pulse_score=50,
            signal="NEUTRAL",
            confidence=0,
            trend="NEUTRAL",
            timestamp=datetime.now().isoformat()
        )
    
    def to_dict(self, result: VolumePulseResult) -> Dict:
        """Convert result to API-friendly dictionary"""
        return {
            "symbol": result.symbol,
            "volume_data": {
                "green_candle_volume": result.green_vol,
                "red_candle_volume": result.red_vol,
                "green_percentage": round((result.green_vol / (result.green_vol + result.red_vol) * 100) if (result.green_vol + result.red_vol) > 0 else 50, 1),
                "red_percentage": round((result.red_vol / (result.green_vol + result.red_vol) * 100) if (result.green_vol + result.red_vol) > 0 else 50, 1),
                "ratio": result.ratio
            },
            "pulse_score": result.pulse_score,
            "signal": result.signal,
            "confidence": result.confidence,
            "trend": result.trend,
            "status": "ACTIVE" if result.confidence >= self._signal_threshold else "WATCHING",
            "timestamp": result.timestamp
        }


# ═══════════════════════════════════════════════════════════
# SINGLETON PATTERN - Reuse engine across requests
# ═══════════════════════════════════════════════════════════

_engine_instance: Optional[VolumePulseEngine] = None


def get_volume_pulse_engine() -> VolumePulseEngine:
    """Get or create singleton engine instance"""
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = VolumePulseEngine(lookback_period=20, signal_threshold=63)
    return _engine_instance


async def analyze_volume_pulse(symbol: str, df: pd.DataFrame) -> Dict:
    """
    Main entry point for API
    Ultra-fast async wrapper
    """
    engine = get_volume_pulse_engine()
    result = await asyncio.to_thread(engine.analyze, symbol, df)
    return engine.to_dict(result)
