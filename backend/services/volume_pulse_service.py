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
    """Ultra-lightweight result container with PRO volume analysis"""
    __slots__ = ('symbol', 'green_vol', 'red_vol', 'ratio', 'pulse_score', 
                 'signal', 'confidence', 'trend', 'timestamp',
                 # 🔥 NEW: Professional "Effort vs Result" metrics
                 'participation', 'aggression', 'exhaustion',
                 'volume_quality', 'interpretation')
    
    symbol: str
    green_vol: int
    red_vol: int
    ratio: float  # green/red ratio
    pulse_score: int  # 0-100
    signal: str  # BUY, SELL, NEUTRAL
    confidence: int  # 0-100
    trend: str  # BULLISH, BEARISH, NEUTRAL
    timestamp: str
    
    # 🔥 PRO METRICS - "EFFORT vs RESULT"
    participation: int  # 0-100: Volume involvement vs average
    aggression: int  # 0-100: Price movement efficiency (Result/Effort)
    exhaustion: int  # 0-100: Climax volume detection
    volume_quality: str  # ABSORPTION, COMPRESSION, FAKE_BREAKOUT, EXHAUSTION, HEALTHY
    interpretation: str  # Human-readable insight


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
            
            # 🔥 NEW: PROFESSIONAL "EFFORT vs RESULT" ANALYSIS
            participation = self._calculate_participation(recent)
            aggression = self._calculate_aggression(recent)
            exhaustion = self._calculate_exhaustion(recent)
            volume_quality, interpretation = self._determine_volume_quality(
                participation, aggression, exhaustion, recent
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
                timestamp=datetime.now().isoformat(),
                # 🔥 NEW: Professional metrics
                participation=participation,
                aggression=aggression,
                exhaustion=exhaustion,
                volume_quality=volume_quality,
                interpretation=interpretation
            )
            
        except Exception as e:
            # Error in volume pulse analysis
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
        
        SIMPLIFIED FORMULA:
        - 70% weight on green/red volume ratio
        - 30% weight on recent momentum
        """
        score = 0
        
        # 1. Base score from volume percentage (70 points max)
        # If 70% green volume → score = 70
        # If 50% green volume → score = 35
        # If 30% green volume → score = 21
        score += int(green_pct * 0.7)  # Direct scaling
        
        # 2. Recent momentum bonus (30 points max)
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
                
                # Momentum bonus/penalty
                momentum_diff = recent_green_pct - green_pct
                if momentum_diff > 10:
                    score += 30  # Strong positive momentum
                elif momentum_diff > 5:
                    score += 20  # Moderate positive momentum
                elif momentum_diff > 0:
                    score += 10  # Slight positive momentum
                elif momentum_diff < -10:
                    score -= 10  # Negative momentum (selling pressure increasing)
        
        # Clamp to 0-100 range
        return min(max(score, 0), 100)
    
    # ═══════════════════════════════════════════════════════════════
    # 🔥 PROFESSIONAL "EFFORT vs RESULT" ANALYSIS
    # ═══════════════════════════════════════════════════════════════
    
    def _calculate_participation(self, recent_df: pd.DataFrame) -> int:
        """
        PARTICIPATION: Volume involvement vs average (0-100)
        High = Heavy trading activity
        Low = Disinterest
        """
        if len(recent_df) < 10:
            return 50
        
        current_vol = recent_df['volume'].iloc[-1]
        avg_vol = recent_df['volume'].mean()
        
        if avg_vol == 0:
            return 50
        
        # Ratio of current to average
        ratio = current_vol / avg_vol
        
        # Scale to 0-100
        if ratio >= 2.0:
            return 100  # Extreme participation
        elif ratio >= 1.5:
            return 80   # High participation
        elif ratio >= 1.0:
            return 60   # Normal participation
        elif ratio >= 0.7:
            return 40   # Below average
        else:
            return 20   # Very low participation
    
    def _calculate_aggression(self, recent_df: pd.DataFrame) -> int:
        """
        AGGRESSION: Price movement efficiency (0-100)
        Formula: (Price Change / Volume) * scaling
        
        High aggression = Big price move on small volume (efficient)
        Low aggression = Small price move on big volume (absorption)
        """
        if len(recent_df) < 2:
            return 50
        
        # Get last candle
        last_candle = recent_df.iloc[-1]
        open_price = last_candle['open']
        close_price = last_candle['close']
        volume = last_candle['volume']
        
        if volume == 0 or open_price == 0:
            return 50
        
        # Price change percentage
        price_change_pct = abs((close_price - open_price) / open_price * 100)
        
        # Volume as percentage of average
        avg_vol = recent_df['volume'].mean()
        vol_ratio = volume / avg_vol if avg_vol > 0 else 1.0
        
        # Aggression = Price efficiency (more price move per unit of volume)
        # If price moves 2% on 1x volume → aggression = high
        # If price moves 0.5% on 3x volume → aggression = low (absorption)
        
        aggression_ratio = price_change_pct / vol_ratio
        
        # Scale to 0-100
        if aggression_ratio >= 1.5:
            return 100  # Extreme efficiency (breakout/breakdown)
        elif aggression_ratio >= 1.0:
            return 80   # High efficiency
        elif aggression_ratio >= 0.5:
            return 60   # Normal
        elif aggression_ratio >= 0.25:
            return 40   # Low efficiency (absorption zone)
        else:
            return 20   # Very low (heavy absorption)
    
    def _calculate_exhaustion(self, recent_df: pd.DataFrame) -> int:
        """
        EXHAUSTION: Climax volume detection (0-100)
        Formula: Volume spike + Diminishing returns
        
        High exhaustion = Volume climax with slowing momentum
        Low exhaustion = Steady participation
        """
        if len(recent_df) < 10:
            return 0
        
        # Get recent volume trend
        vol_arr = recent_df['volume'].values
        close_arr = recent_df['close'].values
        
        current_vol = vol_arr[-1]
        avg_vol = np.mean(vol_arr[:-1])  # Exclude current
        
        # Volume spike detection
        vol_spike = (current_vol / avg_vol) if avg_vol > 0 else 1.0
        
        # Price momentum (last 3 candles)
        if len(close_arr) >= 4:
            price_change_recent = abs(close_arr[-1] - close_arr[-4])
            price_change_before = abs(close_arr[-4] - close_arr[-7]) if len(close_arr) >= 7 else price_change_recent
            
            # If volume increasing but price momentum decreasing → exhaustion
            momentum_ratio = price_change_recent / price_change_before if price_change_before > 0 else 1.0
        else:
            momentum_ratio = 1.0
        
        # Exhaustion score
        exhaustion = 0
        
        # Massive volume spike (>2x avg)
        if vol_spike >= 2.5:
            exhaustion += 40
        elif vol_spike >= 2.0:
            exhaustion += 30
        elif vol_spike >= 1.5:
            exhaustion += 20
        
        # Diminishing momentum
        if momentum_ratio < 0.7 and vol_spike > 1.5:
            exhaustion += 40  # High volume but slowing momentum = climax
        elif momentum_ratio < 0.85:
            exhaustion += 20
        
        # Wide-range candle at extreme volume (blow-off)
        if len(recent_df) >= 2:
            last_range = abs(recent_df['high'].iloc[-1] - recent_df['low'].iloc[-1])
            avg_range = np.mean(np.abs(recent_df['high'].values[:-1] - recent_df['low'].values[:-1]))
            
            if last_range > avg_range * 1.5 and vol_spike > 1.8:
                exhaustion += 20  # Blow-off top/bottom pattern
        
        return min(exhaustion, 100)
    
    def _determine_volume_quality(
        self, 
        participation: int, 
        aggression: int, 
        exhaustion: int,
        recent_df: pd.DataFrame
    ) -> Tuple[str, str]:
        """
        Classify volume quality and provide interpretation
        
        Returns: (volume_quality, interpretation)
        """
        # Get last candle range
        last_candle = recent_df.iloc[-1]
        candle_range_pct = abs((last_candle['high'] - last_candle['low']) / last_candle['open'] * 100)
        
        # === ABSORPTION: High volume + flat/small candle ===
        if participation >= 70 and aggression <= 40 and candle_range_pct < 0.8:
            return (
                "ABSORPTION",
                "🛡️ High volume but small price move - Institutions absorbing supply/demand"
            )
        
        # === COMPRESSION: Rising volume + shrinking range ===
        if len(recent_df) >= 5:
            last_3_vol = recent_df['volume'].iloc[-3:].mean()
            prev_3_vol = recent_df['volume'].iloc[-6:-3].mean() if len(recent_df) >= 6 else last_3_vol
            last_3_range = np.mean(np.abs(recent_df['high'].iloc[-3:].values - recent_df['low'].iloc[-3:].values))
            prev_3_range = np.mean(np.abs(recent_df['high'].iloc[-6:-3].values - recent_df['low'].iloc[-6:-3].values)) if len(recent_df) >= 6 else last_3_range
            
            if last_3_vol > prev_3_vol * 1.2 and last_3_range < prev_3_range * 0.85:
                return (
                    "COMPRESSION",
                    "⚡ Volume rising while range shrinks - Breakout imminent"
                )
        
        # === FAKE BREAKOUT: Low volume breakout ===
        if participation <= 40 and aggression >= 70:
            return (
                "FAKE_BREAKOUT",
                "⚠️ Price moving but volume weak - Likely false breakout"
            )
        
        # === EXHAUSTION: Climax volume ===
        if exhaustion >= 70:
            return (
                "EXHAUSTION",
                "🔥 Volume climax detected - Potential reversal/pause ahead"
            )
        
        # === SELLER EXHAUSTION (at support) ===
        # Red volume spike with high exhaustion
        close_arr = recent_df['close'].values
        open_arr = recent_df['open'].values
        is_red = close_arr[-1] < open_arr[-1]
        
        if is_red and exhaustion >= 60 and participation >= 70:
            return (
                "SELLER_EXHAUSTION",
                "📊 Heavy red volume at support - Sellers may be exhausted"
            )
        
        # === HEALTHY: Balanced volume and price ===
        if participation >= 50 and aggression >= 50 and exhaustion <= 50:
            return (
                "HEALTHY",
                "✅ Balanced volume and price action - Trend continuation likely"
            )
        
        # === DEFAULT ===
        return (
            "NEUTRAL",
            "➡️ Mixed signals - Wait for clearer volume pattern"
        )
    
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
        
        REVISED THRESHOLDS for better signal generation:
        - BUY: pulse_score >= 55 (was 63)
        - SELL: pulse_score <= 45 (was 37)
        """
        confidence = 0
        
        # === STRONG BUY CONDITIONS ===
        if pulse_score >= 70 and ratio > 1.4:
            signal = "BUY"
            confidence = min(pulse_score, 95)
        
        # === MODERATE BUY (LOWERED THRESHOLD) ===
        elif pulse_score >= 55 and ratio > 1.1:  # Was 63 and 1.2
            signal = "BUY"
            confidence = pulse_score
        
        # === STRONG SELL CONDITIONS ===
        elif pulse_score <= 30 and ratio < 0.7:
            signal = "SELL"
            confidence = min(100 - pulse_score, 95)
        
        # === MODERATE SELL (ADJUSTED THRESHOLD) ===
        elif pulse_score <= 45 and ratio < 0.9:  # Was 37 and 0.83
            signal = "SELL"
            confidence = 100 - pulse_score
        
        # === NEUTRAL (Narrower band now) ===
        else:
            signal = "NEUTRAL"
            confidence = max(0, 50 - abs(50 - pulse_score))
        
        return signal, confidence
    
    def _classify_trend(self, pulse_score: int, ratio: float) -> str:
        """Classify overall trend - ADJUSTED for better trend detection"""
        if pulse_score >= 58 and ratio > 1.15:  # Was 65 and 1.3
            return "BULLISH"
        elif pulse_score <= 42 and ratio < 0.87:  # Was 35 and 0.77
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
            timestamp=datetime.now().isoformat(),
            # 🔥 NEW: Default professional metrics
            participation=50,
            aggression=50,
            exhaustion=0,
            volume_quality="NEUTRAL",
            interpretation=f"⚠️ {reason}"
        )
    
    def to_dict(self, result: VolumePulseResult) -> Dict:
        """Convert result to API-friendly dictionary with PRO metrics"""
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
            # 🔥 NEW: Professional "Effort vs Result" metrics
            "pro_metrics": {
                "participation": result.participation,
                "aggression": result.aggression,
                "exhaustion": result.exhaustion,
                "volume_quality": result.volume_quality,
                "interpretation": result.interpretation
            },
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
        # 🔥 FIX: Increased lookback from 20 to 100 for better volume aggregation
        _engine_instance = VolumePulseEngine(lookback_period=100, signal_threshold=63)
    return _engine_instance


async def analyze_volume_pulse(symbol: str, df: pd.DataFrame) -> Dict:
    """
    Main entry point for API
    Ultra-fast async wrapper
    """
    engine = get_volume_pulse_engine()
    result = await asyncio.to_thread(engine.analyze, symbol, df)
    return engine.to_dict(result)
