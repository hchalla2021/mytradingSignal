"""
INTRADAY ENTRY FILTER SYSTEM
============================
5-Minute VWMA-20 Entry Filter + 15-Minute Momentum Entry
Best for Indian Index Trading (NIFTY, BANKNIFTY, SENSEX)

Entry Rules:
==============
VWMA-20 Entry (5m - BEST):
  ✅ Price stays above VWMA-20
  ✅ Price crossed above VWMA-20 (fresh dip)
  ✅ Volume spike on crossover
  
Momentum Entry (15m):
  ✅ 15m momentum strong (RSI > 55 for buy)
  ✅ EMA alignment correct
  ✅ Volume confirmation

Exit Rules:
===========
  ❌ Price closes below VWMA-20 (5m)
  ❌ Stop loss hit
  ❌ Target reached

Production: Use with live 5m + 15m candles only
"""

from typing import Dict, Any, Optional, Tuple, List
from datetime import datetime
import logging
import warnings

logger = logging.getLogger(__name__)


class VWMAEntryFilter:
    """
    5-Minute VWMA-20 Entry Filter
    ==============================
    
    The VWMA-20 is the BEST entry filter for intraday trading because:
    1. Volume-weighted = Ignores noise
    2. 20-period on 5m = 100 minutes of history (perfect balance)
    3. Detects institutional buying/selling
    4. Clean entries with high win rate
    """
    
    @staticmethod
    def analyze_vwma_entry(
        current_price: float,
        vwma_20: float,
        prev_price: float,
        prev_vwma_20: float,
        volume: int,
        avg_volume: int,
        ema_20: float = None,
        ema_50: float = None,
    ) -> Dict[str, Any]:
        """
        Analyze VWMA-20 entry signal (5m candle)
        
        Args:
            current_price: Current 5m close price
            vwma_20: Current VWMA-20 value
            prev_price: Previous 5m close
            prev_vwma_20: Previous VWMA-20 value
            volume: Current candle volume
            avg_volume: Average volume (50 candles)
            ema_20: EMA-20 (optional, for confirmation)
            ema_50: EMA-50 (optional, for trend)
        
        Returns:
            Dictionary with entry signal and details
        """
        
        # 1. PRICE POSITION vs VWMA-20
        price_above_vwma = current_price > vwma_20
        prev_above_vwma = prev_price > prev_vwma_20
        
        # 2. CROSSOVER DETECTION
        bullish_cross = (not prev_above_vwma) and price_above_vwma
        bearish_cross = prev_above_vwma and (not price_above_vwma)
        
        # 3. VOLUME ANALYSIS
        volume_ratio = volume / avg_volume if avg_volume > 0 else 1.0
        volume_strong = volume_ratio > 1.2  # 20% above average = strong
        volume_extreme = volume_ratio > 1.5  # 50% above average = extreme
        
        # 4. POSITION IN RANGE
        distance_from_vwma = abs(current_price - vwma_20)
        distance_pct = (distance_from_vwma / vwma_20) * 100 if vwma_20 > 0 else 0
        
        # Close to VWMA (within 0.3%) = high probability entry
        vwma_close = distance_pct < 0.3
        
        # 5. SIGNAL GENERATION
        signal = None
        signal_type = None
        confidence = 0.0
        reasons = []
        
        # ==========================================
        # PRIMARY ENTRY: VWMA-20 BULLISH
        # ==========================================
        if price_above_vwma:
            
            # A) FRESH CROSS ABOVE (Best)
            if bullish_cross and volume_strong:
                signal = "BUY"
                signal_type = "VWMA_FRESH_CROSS_BULLISH"
                confidence = 75  # High confidence entry
                reasons.append("✅ Price crossed ABOVE VWMA-20 with strong volume")
                
                if volume_extreme:
                    confidence = 85
                    reasons.append("🔥 EXTREME volume breakout - premium entry")
            
            # B) DIP TO VWMA (Good - Price briefly touches and bounces)
            elif vwma_close and volume_strong:
                signal = "BUY"
                signal_type = "VWMA_DIP_BOUNCE"
                confidence = 70  # Good confidence
                reasons.append("📍 Price dipped to VWMA-20 and recovered with volume")
            
            # C) HOLDING ABOVE VWMA (Valid - Already in position)
            elif price_above_vwma and distance_pct < 1.5:
                signal = "BUY_CONTINUATION"
                signal_type = "HOLDING_ABOVE_VWMA"
                confidence = 60  # Moderate confidence
                reasons.append("📈 Price holding above VWMA-20 - continuation zone")
        
        # ==========================================
        # PRIMARY SIGNAL: VWMA-20 BEARISH
        # ==========================================
        else:  # Price below VWMA-20
            
            # A) FRESH BREAKDOWN (Best)
            if bearish_cross and volume_strong:
                signal = "SELL"
                signal_type = "VWMA_FRESH_CROSS_BEARISH"
                confidence = 75
                reasons.append("✅ Price crossed BELOW VWMA-20 with strong volume")
                
                if volume_extreme:
                    confidence = 85
                    reasons.append("🔥 EXTREME volume breakdown - premium short")
            
            # B) HOLDING BELOW VWMA (Weak market)
            elif not price_above_vwma and distance_pct < 1.5:
                signal = "HOLD"
                signal_type = "HOLDING_BELOW_VWMA"
                confidence = 40
                reasons.append("📉 Price below VWMA-20 - avoid buying")
        
        # ==========================================
        # CONFIDENCE ADJUSTMENTS (Based on EMA alignment)
        # ==========================================
        
        if ema_20 and ema_50:
            ema_20_above_50 = ema_20 > ema_50
            
            if signal in ["BUY", "BUY_CONTINUATION"] and ema_20_above_50:
                confidence += 10  # EMA confirms uptrend
                reasons.append("📊 EMA-20 above EMA-50 confirms uptrend")
            
            elif signal in ["SELL"] and not ema_20_above_50:
                confidence += 10  # EMA confirms downtrend
                reasons.append("📊 EMA-20 below EMA-50 confirms downtrend")
            
            elif signal in ["BUY", "BUY_CONTINUATION"] and not ema_20_above_50:
                confidence -= 15  # Conflicting signals
                reasons.append("⚠️ EMA-20 below EMA-50 - conflicting signals")
            
            elif signal == "SELL" and ema_20_above_50:
                confidence -= 15  # Conflicting signals
                reasons.append("⚠️ EMA-20 above EMA-50 - conflicting downtrend signal")
        
        # Cap confidence at 95
        confidence = min(confidence, 95)
        confidence = max(confidence, 0)
        
        return {
            "signal": signal,
            "signal_type": signal_type,
            "confidence": round(confidence, 1),
            "reasons": reasons,
            "vwma_data": {
                "current_price": round(current_price, 2),
                "vwma_20": round(vwma_20, 2),
                "distance_to_vwma": round(distance_from_vwma, 2),
                "distance_pct": round(distance_pct, 3),
                "above_vwma": price_above_vwma,
                "bullish_cross": bullish_cross,
                "bearish_cross": bearish_cross,
            },
            "volume_data": {
                "current_volume": volume,
                "average_volume": avg_volume,
                "volume_ratio": round(volume_ratio, 2),
                "volume_strong": volume_strong,
                "volume_extreme": volume_extreme,
            }
        }


class MomentumEntryFilter:
    """
    15-Minute Momentum Entry Filter
    ================================
    
    Secondary confirmation for 5m VWMA entries
    Ensures we're trading with momentum, not against it
    
    Rules:
    - Bullish: RSI > 55 (momentum up)
    - Bearish: RSI < 45 (momentum down)
    - Volume: Above average for confirmation
    """
    
    @staticmethod
    def analyze_15m_momentum(
        rsi_15m: float,
        ema_20_15m: float,
        ema_50_15m: float,
        volume_15m: int,
        avg_volume_15m: int,
        price_15m: float,
        vwma_20_15m: float = None,
    ) -> Dict[str, Any]:
        """
        Analyze 15m momentum for confirmation
        
        Args:
            rsi_15m: RSI on 15m candle (0-100)
            ema_20_15m: EMA-20 on 15m
            ema_50_15m: EMA-50 on 15m
            volume_15m: 15m volume
            avg_volume_15m: Average 15m volume
            price_15m: 15m close price
            vwma_20_15m: VWMA-20 on 15m (optional)
        
        Returns:
            Dictionary with momentum analysis
        """
        
        # 1. RSI ANALYSIS (Main momentum indicator)
        rsi_strong_bullish = rsi_15m > 60  # Very strong
        rsi_bullish = rsi_15m > 55  # Strong uptrend
        rsi_mild_bullish = rsi_15m > 50  # Early uptrend
        rsi_neutral = 45 <= rsi_15m <= 55
        rsi_mild_bearish = rsi_15m < 50
        rsi_bearish = rsi_15m < 45  # Strong downtrend
        rsi_strong_bearish = rsi_15m < 40  # Very strong
        
        # 2. EMA ALIGNMENT (Trend confirmation)
        ema_bullish = ema_20_15m > ema_50_15m
        ema_proper_spacing = (ema_20_15m - ema_50_15m) / ema_50_15m > 0.005 if ema_50_15m > 0 else ema_bullish
        
        # 3. VOLUME CONFIRMATION
        volume_ratio = volume_15m / avg_volume_15m if avg_volume_15m > 0 else 1.0
        volume_confirmed = volume_ratio > 1.0
        
        # 4. SIGNAL GENERATION
        momentum_signal = None
        momentum_rating = None
        confidence = 0.0
        reasons = []
        
        # ==========================================
        # BULLISH MOMENTUM (for 5m BUY confirmation)
        # ==========================================
        if rsi_strong_bullish:
            momentum_signal = "STRONG_BULLISH"
            momentum_rating = "⭐⭐⭐ EXCELLENT"
            confidence = 90
            reasons.append("🔥 RSI > 60: STRONG bullish momentum")
            
            if ema_bullish:
                confidence += 5
                reasons.append("📊 EMA confirms uptrend")
        
        elif rsi_bullish:
            momentum_signal = "BULLISH"
            momentum_rating = "⭐⭐ GOOD"
            confidence = 75
            reasons.append("✅ RSI > 55: Bullish momentum confirmed")
            
            if ema_bullish and ema_proper_spacing:
                confidence += 10
                reasons.append("📊 EMA alignment strong")
        
        elif rsi_mild_bullish:
            momentum_signal = "MILD_BULLISH"
            momentum_rating = "⭐ FAIR"
            confidence = 60
            reasons.append("👍 RSI > 50: Early uptrend")
        
        # ==========================================
        # NEUTRAL MOMENTUM
        # ==========================================
        elif rsi_neutral:
            momentum_signal = "NEUTRAL"
            momentum_rating = "⚠️ CAUTION"
            confidence = 40
            reasons.append("🟡 RSI between 45-55: Indecision zone")
        
        # ==========================================
        # BEARISH MOMENTUM (for 5m SELL confirmation)
        # ==========================================
        elif rsi_strong_bearish:
            momentum_signal = "STRONG_BEARISH"
            momentum_rating = "⭐⭐⭐ EXCELLENT"
            confidence = 90
            reasons.append("🔥 RSI < 40: STRONG bearish momentum")
        
        elif rsi_bearish:
            momentum_signal = "BEARISH"
            momentum_rating = "⭐⭐ GOOD"
            confidence = 75
            reasons.append("✅ RSI < 45: Bearish momentum confirmed")
        
        # Volume confirmation boost
        if volume_confirmed and momentum_signal not in ["NEUTRAL"]:
            confidence += 5
            reasons.append("📈 Volume confirms momentum")
        
        # Cap confidence
        confidence = min(confidence, 95)
        confidence = max(confidence, 10)
        
        return {
            "momentum_signal": momentum_signal,
            "momentum_rating": momentum_rating,
            "confidence": round(confidence, 1),
            "reasons": reasons,
            "rsi_data": {
                "rsi": round(rsi_15m, 1),
                "rsi_level": "OVERBOUGHT (>70)" if rsi_15m > 70 else
                            "STRONG_BUY (60-70)" if rsi_15m > 60 else
                            "BULLISH (55-60)" if rsi_15m > 55 else
                            "MILD_BULLISH (50-55)" if rsi_15m > 50 else
                            "NEUTRAL (45-55)" if rsi_15m >= 45 else
                            "MILD_BEARISH (40-45)" if rsi_15m > 40 else
                            "BEARISH (<40)",
            },
            "ema_data": {
                "ema_20": round(ema_20_15m, 2),
                "ema_50": round(ema_50_15m, 2),
                "bullish_alignment": ema_bullish,
                "proper_spacing": ema_proper_spacing,
            },
            "volume_data": {
                "current_volume": volume_15m,
                "average_volume": avg_volume_15m,
                "volume_ratio": round(volume_ratio, 2),
                "confirmed": volume_confirmed,
            }
        }


class EMA200TouchEntryFilter:
    """
    EMA-200 Touch Entry Filter - Intraday Support/Resistance
    ==========================================================
    
    BEST TIMEFRAME: 15m ✅✅ Very Strong
    ├─ Clean touch detection (5m too noisy)
    ├─ Strong support/resistance levels
    ├─ High probability bounce/breakdown
    ├─ Institutional level detection
    └─ Perfect entry confirmation
    
    Touch Types:
    ├─ FIRST_TOUCH: Initial contact with EMA200
    ├─ SECOND_TOUCH: Retest after bounce
    ├─ DIP_TO_EMA: Deep pullback to EMA200
    ├─ BOUNCE_FROM_EMA: Strong bounce off EMA200
    └─ SUPPORT/RESISTANCE_BREAK: Breakdown through EMA200
    
    Entry Logic:
    ├─ BULLISH: Price touches EMA200 from above + bounces = BUY (70% conf)
    ├─ BULLISH: Price dips to EMA200, holds above = BUY (65% conf)
    ├─ BEARISH: Price touches EMA200 from below + breaks = SELL (70% conf)
    └─ BEARISH: Price rallies to EMA200, rejection = SELL (65% conf)
    """
    
    @staticmethod
    def detect_ema200_touch(
        current_price: float,
        ema_200: float,
        prev_price: float = None,
        prev_ema_200: float = None,
        volume: int = 0,
        avg_volume: int = 0,
        ema_20: float = 0,
        ema_50: float = 0,
        rsi: float = 50,
        timeframe: str = "15m",
    ) -> Dict[str, Any]:
        """
        Detect EMA-200 touch and classify entry type with confidence
        
        Args:
            current_price: Current close price
            ema_200: Current EMA-200 value
            prev_price: Previous close price
            prev_ema_200: Previous EMA-200
            volume: Current volume
            avg_volume: Average volume
            ema_20: EMA-20 (for alignment)
            ema_50: EMA-50 (for alignment)
            rsi: RSI (for momentum at touch)
            timeframe: "5m" (reference), "15m" (BEST), "30m" (trend)
        
        Returns:
            Dictionary with touch detection and entry signal
        """
        
        prev_price = prev_price or current_price
        prev_ema_200 = prev_ema_200 or ema_200
        
        # 1. PRICE POSITION vs EMA-200
        price_above_ema200 = current_price > ema_200
        prev_above_ema200 = prev_price > prev_ema_200
        
        # 2. DISTANCE FROM EMA-200
        distance_from_ema200 = abs(current_price - ema_200)
        distance_pct = (distance_from_ema200 / ema_200 * 100) if ema_200 > 0 else 0
        
        # Touch threshold: within 0.5% of EMA-200 = touching
        touching = distance_pct <= 0.5
        close_to_ema = distance_pct <= 1.0
        
        # 3. CROSSOVER DETECTION
        bullish_cross = (not prev_above_ema200) and price_above_ema200  # Breaks above
        bearish_cross = prev_above_ema200 and (not price_above_ema200)  # Breaks below
        
        # 4. TOUCH TYPE CLASSIFICATION
        touch_type = None
        entry_signal = None
        confidence = 0.0
        reasons = []
        
        # ==========================================
        # BULLISH SCENARIOS (Price touching from above/bouncing)
        # ==========================================
        if price_above_ema200:
            
            # A) FIRST TOUCH - BOUNCE (BEST SETUP)
            if touching and not prev_above_ema200:
                touch_type = "FIRST_TOUCH_BOUNCE"
                entry_signal = "BUY"
                confidence = 75
                reasons.append("🎯 First touch to EMA-200 from above (dip to support)")
                
                # Momentum at touch
                if rsi > 45:
                    confidence += 10
                    reasons.append("✅ RSI > 45: Buyers present at EMA-200")
                elif rsi < 30:
                    confidence -= 15
                    reasons.append("⚠️ RSI < 30: Oversold, weak bounce expected")
            
            # B) HOLDING ABOVE EMA-200
            elif price_above_ema200 and close_to_ema and volume > avg_volume:
                touch_type = "HOLDING_ABOVE_WITH_VOLUME"
                entry_signal = "BUY_CONTINUATION"
                confidence = 65
                reasons.append("📈 Price holding above EMA-200 with volume")
            
            # C) STRONG BREAKOUT ABOVE
            elif bullish_cross and volume > avg_volume * 1.2:
                touch_type = "BREAKOUT_ABOVE_EMA200"
                entry_signal = "BUY"
                confidence = 70
                reasons.append("🚀 Price broke above EMA-200 with strong volume")
        
        # ==========================================
        # BEARISH SCENARIOS (Price touching from below/breaking down)
        # ==========================================
        else:  # Price below EMA-200
            
            # A) FIRST TOUCH - REJECTION (BEST SHORT SETUP)
            if touching and prev_above_ema200:
                touch_type = "FIRST_TOUCH_REJECTION"
                entry_signal = "SELL"
                confidence = 75
                reasons.append("🎯 First touch to EMA-200 from below (rejection at resistance)")
                
                # Momentum at touch
                if rsi < 55:
                    confidence += 10
                    reasons.append("✅ RSI < 55: Sellers defending EMA-200")
                elif rsi > 70:
                    confidence -= 15
                    reasons.append("⚠️ RSI > 70: Overbought, weak rejection")
            
            # B) HOLDING BELOW EMA-200
            elif not price_above_ema200 and close_to_ema and volume > avg_volume:
                touch_type = "HOLDING_BELOW_WITH_VOLUME"
                entry_signal = "SELL_CONTINUATION"
                confidence = 65
                reasons.append("📉 Price holding below EMA-200 with volume")
            
            # C) STRONG BREAKDOWN BELOW
            elif bearish_cross and volume > avg_volume * 1.2:
                touch_type = "BREAKDOWN_BELOW_EMA200"
                entry_signal = "SELL"
                confidence = 70
                reasons.append("🔴 Price broke below EMA-200 with strong volume")
        
        # 5. EMA ALIGNMENT BOOST (Better if other EMAs aligned)
        if ema_20 > 0 and ema_50 > 0:
            if entry_signal in ["BUY", "BUY_CONTINUATION"]:
                # Check if EMA20 > EMA50 (bullish)
                if ema_20 > ema_50 and ema_20 > ema_200:
                    confidence += 10
                    reasons.append("📊 EMA-20 > EMA-50 > EMA-200: Bullish alignment")
                elif ema_20 < ema_50:
                    confidence -= 10
                    reasons.append("⚠️ EMA-20 < EMA-50: Conflicting trend")
            
            elif entry_signal in ["SELL", "SELL_CONTINUATION"]:
                # Check if EMA20 < EMA50 (bearish)
                if ema_20 < ema_50 and ema_20 < ema_200:
                    confidence += 10
                    reasons.append("📊 EMA-20 < EMA-50 < EMA-200: Bearish alignment")
                elif ema_20 > ema_50:
                    confidence -= 10
                    reasons.append("⚠️ EMA-20 > EMA-50: Conflicting trend")
        
        # 6. TIMEFRAME-SPECIFIC MULTIPLIER
        # 15m is BEST for EMA-200 touches
        timeframe_multiplier = {
            "5m": 0.85,      # Too noisy, -15% discount
            "15m": 1.0,      # BEST - base confidence
            "30m": 1.15,     # +15% boost (stronger signal)
        }.get(timeframe, 1.0)
        
        adjusted_confidence = min(confidence * timeframe_multiplier, 95)
        adjusted_confidence = max(adjusted_confidence, 15)
        
        # 7. TIMEFRAME LABEL
        timeframe_label = {
            "5m": "🔹 Reference (Too noisy)",
            "15m": "🟢 BEST (Very Strong) ✅✅",
            "30m": "⭐ Trend Reference",
        }.get(timeframe, timeframe)
        
        return {
            "timeframe": timeframe,
            "timeframe_label": timeframe_label,
            "touch_detected": touching,
            "touch_type": touch_type,
            "entry_signal": entry_signal,
            "confidence": round(adjusted_confidence, 1),
            "reasons": reasons,
            "ema200_data": {
                "current_price": round(current_price, 2),
                "ema_200": round(ema_200, 2),
                "distance": round(distance_from_ema200, 2),
                "distance_pct": round(distance_pct, 3),
                "above_ema200": price_above_ema200,
                "touching": touching,
                "close_to_ema": close_to_ema,
            },
            "momentum_at_touch": {
                "rsi": round(rsi, 1),
                "rsi_zone": "OVERBOUGHT (>70)" if rsi > 70 else
                           "STRONG_BUY (60-70)" if rsi > 60 else
                           "BULLISH (50-60)" if rsi > 50 else
                           "NEUTRAL (40-50)" if rsi >= 40 else
                           "BEARISH (<40)",
            },
            "ema_alignment": {
                "ema_20": round(ema_20, 2) if ema_20 > 0 else None,
                "ema_50": round(ema_50, 2) if ema_50 > 0 else None,
                "ema_200": round(ema_200, 2),
                "bullish_structure": ema_20 > ema_50 > ema_200 if ema_20 > 0 and ema_50 > 0 else None,
                "bearish_structure": ema_20 < ema_50 < ema_200 if ema_20 > 0 and ema_50 > 0 else None,
            },
            "multiplier": {
                "base_confidence": round(confidence, 1),
                "timeframe_multiplier": timeframe_multiplier,
                "final_confidence": round(adjusted_confidence, 1),
            }
        }


class RSI6040MomentumFilter:
    """
    RSI 60/40 Momentum Filter - Timeframe Specific
    ===============================================
    
    BEST TIMEFRAME USAGE:
    ├─ 5m: Safe Intraday (BEST) ✅ Accurate, Fast signals
    ├─ 15m: Momentum Trade (STRONG) ⭐ Strong confirmation
    └─ 30m: Trend Filter (Reference)
    
    RSI Zones:
    ├─ RSI > 60: STRONG BULLISH (overbought but strong)
    ├─ RSI > 50: BULLISH (mild momentum)
    ├─ 40-50: NEUTRAL (indecision)
    ├─ RSI < 40: STRONG BEARISH (oversold but strong)
    └─ RSI < 50: BEARISH (mild momentum)
    """
    
    @staticmethod
    def analyze_rsi_momentum(
        rsi: float,
        timeframe: str = "5m",  # "5m", "15m", or "30m"
        price: float = 0,
        ema_20: float = 0,
        ema_50: float = 0,
        volume: int = 0,
        avg_volume: int = 0,
    ) -> Dict[str, Any]:
        """
        Analyze RSI 60/40 momentum with timeframe-specific confidence
        
        Args:
            rsi: RSI value (0-100)
            timeframe: "5m" (BEST), "15m" (STRONG), or "30m" (reference)
            price: Current price
            ema_20: EMA-20 value
            ema_50: EMA-50 value
            volume: Current volume
            avg_volume: Average volume
        
        Returns:
            Dictionary with RSI momentum analysis and confidence
        """
        
        # 1. RSI ZONE CLASSIFICATION
        rsi_above_60 = rsi > 60         # Strong bullish (overbought)
        rsi_above_50 = rsi > 50         # Bullish
        rsi_neutral_zone = 40 <= rsi <= 50  # Indecision
        rsi_below_40 = rsi < 40         # Strong bearish (oversold)
        rsi_below_50 = rsi < 50         # Bearish
        
        # 2. EMA CONFIRMATION
        ema_bullish = ema_20 > ema_50 if ema_20 > 0 and ema_50 > 0 else None
        price_above_ema20 = price > ema_20 if price > 0 and ema_20 > 0 else None
        
        # 3. VOLUME CONFIRMATION
        volume_ratio = volume / avg_volume if avg_volume > 0 else 1.0
        volume_strong = volume_ratio > 1.1
        
        # 4. BASE CONFIDENCE BY RSI ZONE
        base_confidence = 0.0
        signal = None
        signal_strength = None
        reasons = []
        
        if rsi_above_60:
            signal = "STRONG_BULLISH"
            signal_strength = "🔥 PREMIUM"
            base_confidence = 85
            reasons.append(f"🔥 RSI {rsi:.1f} > 60: STRONG BULLISH momentum")
        elif rsi_above_50:
            signal = "BULLISH"
            signal_strength = "✅ GOOD"
            base_confidence = 70
            reasons.append(f"✅ RSI {rsi:.1f} > 50: Bullish momentum")
        elif rsi_neutral_zone:
            signal = "NEUTRAL"
            signal_strength = "🟡 CAUTION"
            base_confidence = 35
            reasons.append(f"🟡 RSI {rsi:.1f} (40-50): Indecision zone")
        elif rsi_below_40:
            signal = "STRONG_BEARISH"
            signal_strength = "🔥 PREMIUM"
            base_confidence = 85
            reasons.append(f"🔥 RSI {rsi:.1f} < 40: STRONG BEARISH momentum")
        else:  # rsi_below_50
            signal = "BEARISH"
            signal_strength = "✅ GOOD"
            base_confidence = 70
            reasons.append(f"✅ RSI {rsi:.1f} < 50: Bearish momentum")
        
        # 5. TIMEFRAME-SPECIFIC CONFIDENCE ADJUSTMENTS
        # Different timeframes have different accuracy/reliability
        timeframe_multiplier = {
            "5m": 1.0,      # Base confidence (BEST for intraday)
            "15m": 1.1,     # +10% boost (STRONG confirmation)
            "30m": 0.85,    # -15% discount (reference only)
        }.get(timeframe, 1.0)
        
        adjusted_confidence = base_confidence * timeframe_multiplier
        
        # 6. EMA ALIGNMENT BOOST
        if signal in ["BULLISH", "STRONG_BULLISH"]:
            if ema_bullish:
                adjusted_confidence += 10
                reasons.append("📊 EMA-20 > EMA-50: Uptrend confirmed")
            elif price_above_ema20:
                adjusted_confidence += 5
                reasons.append("📈 Price > EMA-20: Uptrend structure")
        
        elif signal in ["BEARISH", "STRONG_BEARISH"]:
            if ema_bullish is False:  # explicitly False, not None
                adjusted_confidence += 10
                reasons.append("📊 EMA-20 < EMA-50: Downtrend confirmed")
            elif price_above_ema20 is False:
                adjusted_confidence += 5
                reasons.append("📉 Price < EMA-20: Downtrend structure")
        
        # 7. VOLUME CONFIRMATION BOOST
        if volume_strong and signal not in ["NEUTRAL"]:
            adjusted_confidence += 8
            reasons.append("📊 Volume confirms signal")
        
        # 8. FINAL CONFIDENCE CAP & FLOOR
        final_confidence = min(adjusted_confidence, 95)
        final_confidence = max(final_confidence, 15)
        
        # 9. TIMEFRAME LABEL
        timeframe_label = {
            "5m": "🟢 Safe Intraday (BEST)",
            "15m": "⭐ Momentum Trade (STRONG)",
            "30m": "📊 Trend Reference",
        }.get(timeframe, timeframe)
        
        return {
            "timeframe": timeframe,
            "timeframe_label": timeframe_label,
            "signal": signal,
            "signal_strength": signal_strength,
            "confidence": round(final_confidence, 1),
            "reasons": reasons,
            "rsi_data": {
                "rsi": round(rsi, 1),
                "zone": "OVERBOUGHT (>70)" if rsi > 70 else
                       "STRONG_BUY (60-70)" if rsi > 60 else
                       "BULLISH (50-60)" if rsi > 50 else
                       "NEUTRAL (40-50)" if rsi >= 40 else
                       "STRONG_SELL (<40)",
                "threshold_60": rsi_above_60,
                "threshold_40": rsi_below_40,
            },
            "ema_alignment": {
                "ema_20": round(ema_20, 2) if ema_20 > 0 else None,
                "ema_50": round(ema_50, 2) if ema_50 > 0 else None,
                "bullish_alignment": ema_bullish,
                "price_above_ema20": price_above_ema20,
            },
            "volume_data": {
                "volume_ratio": round(volume_ratio, 2),
                "strong": volume_strong,
            },
            "multiplier": {
                "base_confidence": round(base_confidence, 1),
                "timeframe_multiplier": timeframe_multiplier,
                "adjusted_before_ema": round(base_confidence * timeframe_multiplier, 1),
                "final_confidence": round(final_confidence, 1),
            }
        }
    
    @staticmethod
    def compare_timeframes(
        rsi_5m: float,
        rsi_15m: float,
        price: float = 0,
        ema_20_5m: float = 0,
        ema_50_5m: float = 0,
        ema_20_15m: float = 0,
        ema_50_15m: float = 0,
        volume_5m: int = 0,
        avg_volume_5m: int = 0,
        volume_15m: int = 0,
        avg_volume_15m: int = 0,
    ) -> Dict[str, Any]:
        """
        Compare RSI momentum across 5m (BEST) and 15m (STRONG) timeframes
        
        Returns:
        - Which timeframe is more reliable
        - Combined confidence for trading
        - Alignment status
        """
        
        # Analyze both timeframes
        analysis_5m = RSI6040MomentumFilter.analyze_rsi_momentum(
            rsi=rsi_5m,
            timeframe="5m",
            price=price,
            ema_20=ema_20_5m,
            ema_50=ema_50_5m,
            volume=volume_5m,
            avg_volume=avg_volume_5m,
        )
        
        analysis_15m = RSI6040MomentumFilter.analyze_rsi_momentum(
            rsi=rsi_15m,
            timeframe="15m",
            price=price,
            ema_20=ema_20_15m,
            ema_50=ema_50_15m,
            volume=volume_15m,
            avg_volume=avg_volume_15m,
        )
        
        # 1. ALIGNMENT CHECK
        aligned_bullish = (analysis_5m["signal"] in ["BULLISH", "STRONG_BULLISH"] and
                          analysis_15m["signal"] in ["BULLISH", "STRONG_BULLISH"])
        
        aligned_bearish = (analysis_5m["signal"] in ["BEARISH", "STRONG_BEARISH"] and
                          analysis_15m["signal"] in ["BEARISH", "STRONG_BEARISH"])
        
        aligned = aligned_bullish or aligned_bearish
        
        # 2. WHICH TIMEFRAME LEADS?
        if analysis_5m["confidence"] > analysis_15m["confidence"]:
            leading_timeframe = "5m (FAST ENTRY)"
            leading_confidence = analysis_5m["confidence"]
        elif analysis_15m["confidence"] > analysis_5m["confidence"]:
            leading_timeframe = "15m (STRONG ENTRY)"
            leading_confidence = analysis_15m["confidence"]
        else:
            leading_timeframe = "EQUAL"
            leading_confidence = analysis_5m["confidence"]
        
        # 3. COMBINED CONFIDENCE (weighted average)
        # 5m = 60% weight (faster, more entries), 15m = 40% weight (confirmation)
        combined_confidence = (analysis_5m["confidence"] * 0.6) + (analysis_15m["confidence"] * 0.4)
        combined_confidence = round(combined_confidence, 1)
        
        # 4. TRADING RECOMMENDATION
        if aligned and combined_confidence >= 70:
            recommendation = "✅ STRONG ALIGNED - TRADE"
            trade_quality = "PREMIUM"
        elif aligned and combined_confidence >= 55:
            recommendation = "👍 ALIGNED - GOOD TO TRADE"
            trade_quality = "GOOD"
        elif not aligned and combined_confidence >= 75:
            recommendation = "⚠️ TIMING MISALIGNED - CAUTION"
            trade_quality = "FAIR"
        elif combined_confidence >= 60:
            recommendation = "🟡 PARTIAL ALIGNMENT - WAIT"
            trade_quality = "WEAK"
        else:
            recommendation = "❌ NOT ALIGNED - SKIP"
            trade_quality = "NO TRADE"
        
        return {
            "comparison": {
                "5m": {
                    "signal": analysis_5m["signal"],
                    "confidence": analysis_5m["confidence"],
                    "strength": analysis_5m["signal_strength"],
                    "rsi": analysis_5m["rsi_data"]["rsi"],
                },
                "15m": {
                    "signal": analysis_15m["signal"],
                    "confidence": analysis_15m["confidence"],
                    "strength": analysis_15m["signal_strength"],
                    "rsi": analysis_15m["rsi_data"]["rsi"],
                },
            },
            "alignment": {
                "aligned": aligned,
                "bullish_aligned": aligned_bullish,
                "bearish_aligned": aligned_bearish,
            },
            "combined_analysis": {
                "leading_timeframe": leading_timeframe,
                "leading_confidence": leading_confidence,
                "combined_confidence": combined_confidence,
                "recommendation": recommendation,
                "trade_quality": trade_quality,
            },
            "details": {
                "analysis_5m": analysis_5m,
                "analysis_15m": analysis_15m,
            }
        }


class VWAPIntradayFilter:
    """
    Volume-Weighted Average Price (VWAP) Intraday Entry Filter
    ===========================================================
    
    ⚠️ IMPORTANT: VWAP is a LAGGING (Historical) Indicator, NOT a FUTURE indicator
    • Uses past price × volume data (institutional level)
    • Best for FUTURES (BANKNIFTY, NIFTY-FUT), NOT indices
    • Do NOT use on SENSEX or NIFTY (indices) - use only on liquid futures
    
    BEST TIMEFRAME for VWAP Entry:
    🔥 Intraday 5-MINUTE ONLY
    
    Timeframe    Use                          Status
    ────────     ──────                       ──────
    5m           PRIMARY (Entry/Exit)         ✅ BEST - EXECUTE HERE
    15m          Confirmation ONLY            ⚠️ Optional - For validation only
    1m/3m        ❌ TOO NOISY - Skip
    1h+          ❌ TOO SLOW - Use for bias only
    
    ✅ 5-Minute execution is MANDATORY - 15m for confirmation ONLY
    
    Why VWAP on 5m (FUTURES only):
    • 5m = Perfect balance of noise reduction + quick signals
    • Futures = Liquid, tight spreads, high volume
    • Institutional price level = Clean entries with 2:1 RR typical
    """
    
    @staticmethod
    def is_futures_symbol(symbol: str) -> bool:
        """Check if symbol is a futures contract.
        
        FUTURES (✅ USE VWAP):
        - BANKNIFTY (Bank Nifty Futures)
        - NIFTY (Nifty 50 Futures) 
        - SENSEX (Sensex Futures)
        - Any symbol ending in -FUT, -FUT50
        
        INDICES (❌ SKIP VWAP):
        - NIFTY (Nifty 50 Index - rare, usually futures)
        - SENSEX (Sensex Index - rare, usually futures)
        - Any index symbol
        
        Note: When used with get_live_vwap_5m_signal(), NIFTY/BANKNIFTY/SENSEX 
              are treated as FUTURES since they have futures tokens configured.
        
        Returns:
            bool: True if futures, False otherwise
        """
        symbol_upper = symbol.upper() if symbol else ""
        
        # Trading symbols that could be futures
        # When using explicit NIFTY, BANKNIFTY, SENSEX with futures tokens = FUTURES
        trading_futures = ["NIFTY", "BANKNIFTY", "SENSEX", "NIFTYIT", "FINNIFTY", "MIDCPNIFTY"]
        
        # Check if it's a known trading futures symbol
        if symbol_upper in trading_futures:
            return True
        
        # Check if has explicit futures suffix
        if "-FUT" in symbol_upper or "-FUTSTK" in symbol_upper or "-FUT50" in symbol_upper:
            return True
        
        return False
    
    @staticmethod
    def validate_for_vwap(symbol: str) -> Tuple[bool, str]:
        """Validate if symbol should use VWAP filter.
        
        Returns:
            (is_valid, reason_message)
        """
        if not VWAPIntradayFilter.is_futures_symbol(symbol):
            return False, f"❌ {symbol} is INDEX - VWAP only for FUTURES (BANKNIFTY, NIFTY-FUT, etc)"
        
        return True, f"✅ {symbol} is FUTURES - VWAP filter ENABLED"
    
    @staticmethod
    def analyze_vwap_direction(
        current_price: float,
        vwap_5m: float,
        prev_price: float,
        prev_vwap_5m: float,
        ema_20: float,
        ema_50: float,
        volume: float,
        avg_volume: float,
        rsi: float = None,
        symbol: str = None,
        enforce_futures_only: bool = True,
    ) -> Dict[str, Any]:
        """
        Analyze VWAP direction bias on 5m (BEST) timeframe
        
        ⚠️ IMPORTANT: This uses 5m ONLY (not 15m)
        
        Args:
            current_price: 5m close price
            vwap_5m: 5m VWAP value
            prev_price: Previous 5m close
            prev_vwap_5m: Previous 5m VWAP
            ema_20: EMA-20 (5m)
            ema_50: EMA-50 (5m)
            volume: Current volume (5m)
            avg_volume: Average volume (5m)
            rsi: RSI (optional, 5m)
            symbol: Symbol (used to validate it's a FUTURES contract, not index)
            enforce_futures_only: If True, skip INDEX symbols (NIFTY, SENSEX, etc)
        
        Returns:
          signal: BUY, SELL, or HOLD (5m execution only)
          direction: BULLISH, BEARISH, or NEUTRAL
          signal_strength: Confidence 0-95%
          timeframe_label: 5m (BEST) for PRIMARY execution
        """
        
        # ⚠️ VALIDATION: Check if this is a FUTURES symbol (not index)
        if symbol and enforce_futures_only:
            is_futures, validation_msg = VWAPIntradayFilter.validate_for_vwap(symbol)
            if not is_futures:
                warnings.warn(validation_msg, UserWarning)
                # Return HOLD for indices - VWAP not recommended here
                return {
                    "signal": "HOLD",
                    "direction": "NEUTRAL",
                    "signal_type": "VWAP_SKIPPED_INDEX",
                    "timeframe_label": "❌ INDEX - VWAP not applicable",
                    "confidence": 0,
                    "vwap_data": {
                        "current_price": current_price,
                        "vwap_5m": vwap_5m,
                        "distance_pct": 0,
                        "above_vwap": current_price > vwap_5m,
                        "volume_ratio": 0,
                    },
                    "ema_alignment": {
                        "bullish_structure": False,
                        "bearish_structure": False,
                        "ema_20": ema_20,
                        "ema_50": ema_50,
                    },
                    "reasons": [f"❌ {symbol} is an INDEX - VWAP filter is for FUTURES only", validation_msg],
                    "multiplier": {
                        "base_confidence": 0,
                        "timeframe_multiplier": 1.0,
                        "adjusted_before_ema": 0,
                    },
                }
        
        distance_pct = ((current_price - vwap_5m) / vwap_5m) * 100 if vwap_5m else 0
        was_below = prev_price < prev_vwap_5m if prev_vwap_5m else False
        now_above = current_price > vwap_5m
        
        # Volume confirmation
        volume_ratio = volume / avg_volume if avg_volume > 0 else 1.0
        has_volume = volume_ratio >= 1.1
        
        # EMA alignment check
        ema_bullish = ema_20 > ema_50
        ema_bearish = ema_20 < ema_50
        
        signal = "HOLD"
        direction = "NEUTRAL"
        base_confidence = 40
        reasons = []
        signal_type = "VWAP_HOLD"
        
        # ✅ FRESH CROSS above (strongest)
        if was_below and now_above and has_volume:
            signal = "BUY"
            direction = "BULLISH"
            base_confidence = 85
            signal_type = "VWAP_BULLISH_CROSS"
            reasons.append("🟢 Price crossed ABOVE VWAP-5m (institutional level)")
            reasons.append(f"  Distance: +{distance_pct:.3f}% above VWAP")
            if has_volume:
                reasons.append(f"  Volume Ratio: {volume_ratio:.2f}x (strong entry)")
            if ema_bullish:
                reasons.append("  EMA-20 > EMA-50: Uptrend confirmed")
        
        # ✅ HOLDING ABOVE (bullish bias)
        elif now_above and distance_pct > 0.05 and not was_below:
            signal = "BUY_CONTINUATION"
            direction = "BULLISH"
            base_confidence = 75
            signal_type = "VWAP_HOLDING_ABOVE"
            reasons.append("📈 Price holding ABOVE VWAP-5m (bullish bias)")
            reasons.append(f"  Distance: +{distance_pct:.3f}% (safe zone)")
            if ema_bullish:
                reasons.append("  EMA-20 > EMA-50: Uptrend intact")
        
        # ❌ FRESH CROSS below (strongest bearish)
        elif not was_below and current_price < vwap_5m and has_volume:
            signal = "SELL"
            direction = "BEARISH"
            base_confidence = 85
            signal_type = "VWAP_BEARISH_CROSS"
            reasons.append("🔴 Price crossed BELOW VWAP-5m (institutional level)")
            reasons.append(f"  Distance: {distance_pct:.3f}% below VWAP")
            if has_volume:
                reasons.append(f"  Volume Ratio: {volume_ratio:.2f}x (strong exit)")
            if ema_bearish:
                reasons.append("  EMA-20 < EMA-50: Downtrend confirmed")
        
        # ❌ HOLDING BELOW (bearish bias)
        elif current_price < vwap_5m and distance_pct < -0.05 and was_below:
            signal = "SELL_CONTINUATION"
            direction = "BEARISH"
            base_confidence = 75
            signal_type = "VWAP_HOLDING_BELOW"
            reasons.append("📉 Price holding BELOW VWAP-5m (bearish bias)")
            reasons.append(f"  Distance: {distance_pct:.3f}% (risk zone)")
            if ema_bearish:
                reasons.append("  EMA-20 < EMA-50: Downtrend intact")
        
        # Neutral - too close to VWAP
        elif abs(distance_pct) <= 0.05:
            signal = "HOLD"
            direction = "NEUTRAL"
            base_confidence = 30
            signal_type = "VWAP_AT_LEVEL"
            reasons.append("🟡 Price AT VWAP-5m (indecision zone)")
            reasons.append("  Too close to institutional level - wait for breakout")
        
        return {
            "signal": signal,
            "direction": direction,
            "signal_type": signal_type,
            "timeframe_label": "🟢 5m (BEST) ✅ for Direction",
            "confidence": base_confidence,
            "vwap_data": {
                "current_price": current_price,
                "vwap_5m": vwap_5m,
                "distance_pct": distance_pct,
                "above_vwap": now_above,
                "volume_ratio": volume_ratio,
            },
            "ema_alignment": {
                "bullish_structure": ema_bullish,
                "bearish_structure": ema_bearish,
                "ema_20": ema_20,
                "ema_50": ema_50,
            },
            "reasons": reasons,
            "multiplier": {
                "base_confidence": base_confidence,
                "timeframe_multiplier": 1.0,  # 5m = 1.0 (BEST)
                "adjusted_before_ema": base_confidence,
            },
        }
    
    @staticmethod
    def confirm_vwap_15m(
        current_price: float,
        vwap_15m: float,
        ema_20_15m: float,
        ema_50_15m: float,
        volume_15m: float,
        avg_volume_15m: float,
        rsi_15m: float = None,
        symbol: str = None,
    ) -> Dict[str, Any]:
        """
        Confirm VWAP direction on 15m (CONFIRMATION ONLY - NOT FOR ENTRY/EXIT)
        
        ⚠️ IMPORTANT: 15m is for CONFIRMATION/VALIDATION ONLY
        - DO NOT use 15m for actual trade entry/exit decisions
        - 5m is the PRIMARY timeframe for execution
        - 15m is OPTIONAL validation to see if trend is strong
        - If 5m signal conflicts with 15m, DO NOT force entry
        
        Returns:
          confirmation_signal: CONFIRM, NEUTRAL, or REJECT
          reliability: HIGH, MEDIUM, or LOW
          signal_strength: Confidence 0-95% (validation only, not for trading)
          timeframe_label: 15m (Confirmation only)
        """
        
        distance_pct = ((current_price - vwap_15m) / vwap_15m) * 100 if vwap_15m else 0
        volume_ratio = volume_15m / avg_volume_15m if avg_volume_15m > 0 else 1.0
        
        # EMA alignment on 15m
        ema_bullish = ema_20_15m > ema_50_15m
        ema_bearish = ema_20_15m < ema_50_15m
        
        # RSI confirmation
        rsi_strong_buy = rsi_15m > 60 if rsi_15m else False
        rsi_strong_sell = rsi_15m < 40 if rsi_15m else False
        
        confirmation_signal = "NEUTRAL"
        reliability = "MEDIUM"
        base_confidence = 50
        reasons = []
        
        # ✅ STRONG BULLISH CONFIRMATION
        if current_price > vwap_15m and ema_bullish and volume_ratio >= 1.05:
            confirmation_signal = "CONFIRM"
            reliability = "HIGH"
            base_confidence = 90
            reasons.append("✅ 15m CONFIRMS: Price > VWAP-15m")
            reasons.append("  EMA-20 > EMA-50: Uptrend structure")
            if rsi_strong_buy:
                reasons.append(f"  RSI {rsi_15m:.0f} > 60: STRONG buyers")
            if volume_ratio > 1.2:
                reasons.append(f"  Volume {volume_ratio:.2f}x: Strong confirmation")
        
        # ❌ STRONG BEARISH CONFIRMATION  
        elif current_price < vwap_15m and ema_bearish and volume_ratio >= 1.05:
            confirmation_signal = "REJECT"
            reliability = "HIGH"
            base_confidence = 85
            reasons.append("❌ 15m REJECTS: Price < VWAP-15m")
            reasons.append("  EMA-20 < EMA-50: Downtrend structure")
            if rsi_strong_sell:
                reasons.append(f"  RSI {rsi_15m:.0f} < 40: STRONG sellers")
            if volume_ratio > 1.2:
                reasons.append(f"  Volume {volume_ratio:.2f}x: Strong rejection")
        
        # ⚠️ NEUTRAL CONFIRMATION
        else:
            confirmation_signal = "NEUTRAL"
            reliability = "MEDIUM"
            base_confidence = 50
            reasons.append("🟡 15m NEUTRAL: Weak confirmation")
            if abs(distance_pct) <= 0.1:
                reasons.append("  Price near VWAP-15m: Indecision")
            if not (ema_bullish or ema_bearish):
                reasons.append("  EMAs flat: No clear trend")
        
        return {
            "confirmation_signal": confirmation_signal,
            "reliability": reliability,
            "timeframe_label": "⭐ 15m for Strong Confirmation",
            "confidence": base_confidence,
            "vwap_data": {
                "current_price": current_price,
                "vwap_15m": vwap_15m,
                "distance_pct": distance_pct,
                "above_vwap": current_price > vwap_15m,
                "volume_ratio": volume_ratio,
            },
            "ema_alignment": {
                "bullish_structure": ema_bullish,
                "bearish_structure": ema_bearish,
                "ema_20": ema_20_15m,
                "ema_50": ema_50_15m,
            },
            "rsi_analysis": {
                "rsi": rsi_15m,
                "strong_buy": rsi_strong_buy,
                "strong_sell": rsi_strong_sell,
            },
            "reasons": reasons,
            "multiplier": {
                "base_confidence": base_confidence,
                "timeframe_multiplier": 1.15,  # 15m = 1.15 (strong confirmation boost)
                "adjusted_before_ema": int(base_confidence * 1.15),
            },
        }
    
    @staticmethod
    @staticmethod
    def get_live_vwap_5m_signal_with_auto_token(
        symbol: str,
        kite_client,
        current_price: float,
        ema_20: float = None,
        ema_50: float = None,
        debug: bool = False,
    ) -> Dict[str, Any]:
        """
        Get LIVE 5-minute VWAP signal with AUTOMATIC contract token lookup
        
        ✅ AUTO-SWITCHES to current month contract (never expires!)
        ✅ No need to pass instrument_token - automatically fetched
        ✅ RECOMMENDED: Use this instead of get_live_vwap_5m_signal()
        
        Args:
            symbol: Trading symbol (NIFTY, BANKNIFTY, SENSEX)
            kite_client: Zerodha KiteConnect instance
            current_price: Current market price
            ema_20: Optional EMA-20
            ema_50: Optional EMA-50
            debug: Print debug info
        
        Returns:
            {
                "symbol": "NIFTY",
                "success": True,
                "signal": "BUY" | "SELL" | "HOLD",
                "direction": "BULLISH" | "BEARISH" | "NEUTRAL",
                "confidence": 0-95,
                "vwap": 25599.33,
                "current_price": 25605.00,
                "position": "ABOVE" | "BELOW" | "AT",
                "distance_pct": 0.0221,
                "contract_token": 15150594,  # ← Shows which token was used
                "contract_name": "NIFTY26FEBFUT",  # ← Shows contract name
                ...
            }
        """
        from services.contract_manager import ContractManager
        
        try:
            # Get current month's contract token automatically
            manager = ContractManager(kite_client)
            instrument_token = manager.get_current_contract_token(symbol, debug=debug)
            
            # If ContractManager fails (e.g., for SENSEX), fall back to config
            if not instrument_token:
                if debug:
                    logger = logging.getLogger(__name__)
                    logger.warning(f"⚠️  [AUTO-TOKEN] {symbol}: ContractManager failed, using config fallback")
                
                # Fallback to config tokens
                from config import get_settings
                settings = get_settings()
                token_map = {
                    "NIFTY": settings.nifty_fut_token,
                    "BANKNIFTY": settings.banknifty_fut_token,
                    "SENSEX": settings.sensex_fut_token,
                }
                instrument_token = token_map.get(symbol)
                
                if not instrument_token:
                    return {
                        "symbol": symbol,
                        "success": False,
                        "error": f"Failed to get contract token for {symbol} (both ContractManager and config)",
                        "signal": "HOLD",
                        "direction": "NEUTRAL",
                        "confidence": 0,
                        "vwap": None,
                        "current_price": current_price,
                    }
            
            logger = logging.getLogger(__name__)
            if debug:
                logger.info(f"\n✅ [AUTO-TOKEN] {symbol}: Using token {instrument_token} from ContractManager")
            
            # Call the regular method with the fetched token
            result = VWAPIntradayFilter.get_live_vwap_5m_signal(
                symbol=symbol,
                kite_client=kite_client,
                instrument_token=instrument_token,
                current_price=current_price,
                ema_20=ema_20,
                ema_50=ema_50,
                debug=debug
            )
            
            # Add contract info to result
            contracts = manager.get_all_contracts(symbol, debug=False)
            if 'near' in contracts:
                result['contract_token'] = contracts['near']['token']
                result['contract_name'] = contracts['near']['name']
                result['contract_expiry'] = contracts['near']['expiry']
            
            return result
        
        except Exception as e:
            import traceback
            logger = logging.getLogger(__name__)
            logger.error(f"\n❌ [AUTO-TOKEN] {symbol}: Error: {str(e)}")
            logger.error(traceback.format_exc())
            return {
                "symbol": symbol,
                "success": False,
                "error": str(e),
                "error_type": type(e).__name__,
                "signal": "HOLD",
                "direction": "NEUTRAL",
                "confidence": 0,
                "vwap": None,
                "current_price": current_price,
            }
    
    def get_live_vwap_5m_signal(
        symbol: str,
        kite_client,
        instrument_token: int,
        current_price: float,
        ema_20: float = None,
        ema_50: float = None,
        debug: bool = False,
    ) -> Dict[str, Any]:
        """
        Get LIVE 5-minute VWAP signal for futures (NIFTY, BANKNIFTY, SENSEX futures)
        
        ✅ SOLVES: Shows actual LIVE VWAP from Zerodha (not stale/wrong values)
        
        Fetches FRESH 5-minute candles from market open and calculates accurate VWAP
        
        Args:
            symbol: Trading symbol (NIFTY, BANKNIFTY, SENSEX) - FUTURES ONLY
            kite_client: Zerodha KiteConnect instance with access token
            instrument_token: Futures contract token (expires monthly!)
            current_price: Current market price (LIVE)
            ema_20: Optional EMA-20 for confirmation
            ema_50: Optional EMA-50 for trend
            debug: Print debug info
        
        Returns:
            {
                "symbol": "NIFTY",
                "success": True,
                "signal": "BUY" | "SELL" | "HOLD",
                "direction": "BULLISH" | "BEARISH" | "NEUTRAL",
                "confidence": 0-95,
                "vwap": 25599.33,                 # LIVE VWAP
                "current_price": 25605.00,       # LIVE price
                "position": "ABOVE" | "BELOW" | "AT",
                "distance_pct": 0.0221,          # Distance from VWAP in %
                "timeframe_label": "🟢 5m (BEST) ✅",
                "candles_used": 156,             # Real 5m candles from 9:15 AM
                "last_update": "2025-02-13 14:30:00 IST",
                "reasons": [...]
            }
        """
        try:
            from services.vwap_live_service import VWAPLiveCalculator
            
            # Validate it's a futures symbol
            is_futures, validation_msg = VWAPIntradayFilter.validate_for_vwap(symbol)
            if not is_futures:
                return {
                    "symbol": symbol,
                    "success": False,
                    "error": validation_msg,
                    "signal": "HOLD",
                    "direction": "NEUTRAL",
                    "confidence": 0,
                    "vwap": None,
                    "current_price": current_price,
            }
            
            # Get LIVE VWAP using the live service
            if debug:
                print(f"\n🔄 [VWAP-5M-LIVE] {symbol}: Fetching LIVE 5m VWAP...")
            
            calculator = VWAPLiveCalculator(kite_client)
            vwap_result = calculator.get_live_vwap_complete(
                symbol=symbol,
                instrument_token=instrument_token,
                current_price=current_price,
                interval="5minute",
                debug=debug
            )
            
            if not vwap_result['success']:
                return {
                    "symbol": symbol,
                    "success": False,
                    "error": vwap_result.get('error', 'Failed to calculate VWAP'),
                    "signal": "HOLD",
                    "direction": "NEUTRAL",
                    "confidence": 0,
                    "vwap": None,
                    "current_price": current_price,
                }
            
            # Extract VWAP and position data
            vwap_5m = vwap_result['vwap']
            position_data = vwap_result['position']
            distance_pct = position_data['distance_pct']
            position = position_data['position']
            live_signal = position_data['signal']
            
            # Determine trading signal based on VWAP position
            signal = "HOLD"
            direction = "NEUTRAL"
            base_confidence = 30
            reasons = []
            
            # BULLISH: Price ABOVE VWAP
            if live_signal == "BULLISH" and distance_pct > 0.05:
                signal = "BUY"
                direction = "BULLISH"
                base_confidence = 80
                reasons.append(f"🟢 LIVE 5m VWAP Entry Ready!")
                reasons.append(f"   Price ₹{current_price:,.2f} > VWAP ₹{vwap_5m:,.2f}")
                reasons.append(f"   Distance: +{distance_pct:.4f}% (institutional level)")
                if ema_20 and ema_50 and ema_20 > ema_50:
                    base_confidence += 10
                    reasons.append(f"   EMA-20 > EMA-50: Uptrend confirmed")
            
            # BEARISH: Price BELOW VWAP
            elif live_signal == "BEARISH" and distance_pct < -0.05:
                signal = "SELL"
                direction = "BEARISH"
                base_confidence = 80
                reasons.append(f"🔴 LIVE 5m VWAP Exit Ready!")
                reasons.append(f"   Price ₹{current_price:,.2f} < VWAP ₹{vwap_5m:,.2f}")
                reasons.append(f"   Distance: {distance_pct:.4f}% (below institutional level)")
                if ema_20 and ema_50 and ema_20 < ema_50:
                    base_confidence += 10
                    reasons.append(f"   EMA-20 < EMA-50: Downtrend confirmed")
            
            # NEUTRAL: Price AT VWAP
            else:
                signal = "HOLD"
                direction = "NEUTRAL"
                base_confidence = 30
                reasons.append(f"🟡 Price AT VWAP (Equilibrium)")
                reasons.append(f"   Price ₹{current_price:,.2f} ≈ VWAP ₹{vwap_5m:,.2f}")
                reasons.append(f"   Distance: {distance_pct:.4f}% (indecision zone)")
                reasons.append(f"   ➜ Wait for directional break")
            
            # Final confidence (max 95%)
            confidence = min(95, base_confidence)
            
            return {
                "symbol": symbol,
                "success": True,
                "signal": signal,
                "direction": direction,
                "confidence": confidence,
                "vwap": vwap_5m,  # LIVE VWAP value
                "current_price": current_price,
                "position": position,
                "distance_pct": distance_pct,
                "timeframe_label": "🟢 5m (BEST) ✅ for Entry/Exit",
                "candles_used": vwap_result['candles_used'],
                "last_update": vwap_result['last_update'],
                "market_open": vwap_result['market_open'],
                "total_volume": vwap_result['total_volume'],
                "reasons": reasons,
                "vwap_data": vwap_result,
                "execution_notes": [
                    f"✅ LIVE data from Zerodha (not stale)",
                    f"✅ Fresh 5m candles from market open",
                    f"✅ {vwap_result['candles_used']} candles = accurate VWAP",
                    f"✅ Volume: {vwap_result['total_volume']:,}",
                    f"✅ Last candle: {vwap_result['last_update']}",
                ]
            }
        
        except ImportError:
            return {
                "symbol": symbol,
                "success": False,
                "error": "VWAPLiveCalculator not available - ensure vwap_live_service.py is installed",
                "signal": "HOLD",
                "direction": "NEUTRAL",
                "confidence": 0,
                "vwap": None,
                "current_price": current_price,
            }
        except Exception as e:
            logger.error(f"Error in get_live_vwap_5m_signal: {str(e)}")
            return {
                "symbol": symbol,
                "success": False,
                "error": str(e),
                "signal": "HOLD",
                "direction": "NEUTRAL",
                "confidence": 0,
                "vwap": None,
                "current_price": current_price,
            }

    @staticmethod
    def combine_vwap_signals(
        direction_5m: Dict[str, Any],
        confirmation_15m: Dict[str, Any],
        use_5m_only: bool = False,
    ) -> Dict[str, Any]:
        """
        Combine 5m (ENTRY) + 15m (TREND) signals
        
        ⚠️ IMPORTANT: VWAP is LAGGING indicator (NOT FUTURE)
        • Uses PAST price × volume data
        • 5m = READY TO BUY signal (actual entry point)
        • 15m = TREND STRENGTH (is trend strong enough to trust 5m?)
        
        Two Execution Modes:
        
        MODE 1: 5m ONLY (Aggressive - Fastest entries)
        ─────────────────
        • Use 5m signal DIRECTLY for entry/exit
        • 15m ignored
        • Fastest trades but more noise
        • use_5m_only=True
        
        MODE 2: 5m + 15m Confirmation (Conservative - Higher accuracy)
        ──────────────────────────────
        • 5m signal = "Ready to Buy" timing
        • 15m signal = Trend confirmation (is it safe to enter?)
        • Only trade if BOTH aligned
        • use_5m_only=False (default)
        
        Returns:
            5m_signal: "BUY/SELL/HOLD" - READY TO BUY NOW (timing)
            15m_signal: "BULLISH/BEARISH/NEUTRAL" - Trend strength
            final_signal: Combined recommendation
            trade_timing: When to execute (based on 5m)
            trend_quality: How strong is the trend (based on 15m)
        """
        
        # Extract 5m and 15m data
        signal_5m = direction_5m.get("signal", "HOLD")
        confidence_5m = direction_5m.get("confidence", 0)
        direction_5m_val = direction_5m.get("direction", "NEUTRAL")
        
        confirmation_15m_val = confirmation_15m.get("confirmation_signal", "NEUTRAL")
        confidence_15m = confirmation_15m.get("confidence", 0)
        
        reasons = []
        
        # ═══════════════════════════════════════════
        # MODE 1: Use 5m ONLY (Aggressive)
        # ═══════════════════════════════════════════
        if use_5m_only:
            final_signal = signal_5m
            final_direction = direction_5m_val
            ready_to_trade = signal_5m in ["BUY", "SELL"] and confidence_5m >= 55
            
            reasons.append("🔥 5M ONLY MODE (Aggressive)")
            reasons.append(f"   Entry Signal: {signal_5m} @ {confidence_5m}%")
            reasons.append(f"   ➜ {signal_5m} NOW - Primary timeframe entry")
            reasons.append("")
            reasons.append(f"   15m Trend (Optional): {confirmation_15m_val}")
            if confirmation_15m_val != "NEUTRAL":
                reasons.append(f"   ➜ Trend is {confirmation_15m_val} (extra confidence)")
            
            return {
                "execution_mode": "5M_ONLY",
                "signal": final_signal,
                "direction": final_direction,
                "trade_timing": f"✅ READY NOW (5m entry)",
                "trend_quality": f"Optional: {confirmation_15m_val}",
                "confidence": confidence_5m,
                "ready_to_trade": ready_to_trade,
                "trading_action": f"🎯 {signal_5m} - 5m signal ready" if ready_to_trade else "⏳ WAIT - Confidence too low",
                "reasons": reasons,
                "vwap_5m": direction_5m,
                "vwap_15m": confirmation_15m,
            }
        
        # ═══════════════════════════════════════════
        # MODE 2: 5m + 15m Confirmation (Conservative)
        # ═══════════════════════════════════════════
        
        # Check alignment between 5m entry signal and 15m trend
        is_bullish_signal_5m = signal_5m in ["BUY", "BUY_CONTINUATION"]
        is_bearish_signal_5m = signal_5m in ["SELL", "SELL_CONTINUATION"]
        
        is_bullish_trend_15m = confirmation_15m_val == "CONFIRM"
        is_bearish_trend_15m = confirmation_15m_val == "REJECT"
        is_neutral_trend_15m = confirmation_15m_val == "NEUTRAL"
        
        # Determine alignment
        bullish_aligned = is_bullish_signal_5m and is_bullish_trend_15m
        bearish_aligned = is_bearish_signal_5m and is_bearish_trend_15m
        signals_aligned = bullish_aligned or bearish_aligned
        
        # ✅ PRIMARY ENTRY: Both 5m and 15m ALIGNED
        if signals_aligned and confidence_5m >= 60 and confidence_15m >= 50:
            if bullish_aligned:
                final_signal = "BUY"
                final_direction = "BULLISH"
                trade_timing = "✅ READY TO BUY NOW"
                trend_quality = "🟢 STRONG BULLISH TREND (15m confirms)"
                confidence = min(95, confidence_5m + 10)
                reasons.append("═══════════════════════════════════")
                reasons.append("🟢 PREMIUM ENTRY: 5m + 15m ALIGNED")
                reasons.append("═══════════════════════════════════")
                reasons.append(f"")
                reasons.append(f"5-MINUTE (ENTRY TIMING):")
                reasons.append(f"  Signal: {signal_5m}")
                reasons.append(f"  Confidence: {confidence_5m}%")
                reasons.append(f"  Meaning: ✅ Price ready to BUY")
                reasons.append(f"")
                reasons.append(f"15-MINUTE (TREND STRENGTH):")
                reasons.append(f"  Trend: {confirmation_15m_val}")
                reasons.append(f"  Confidence: {confidence_15m}%")
                reasons.append(f"  Meaning: 🟢 STRONG uptrend - SAFE to enter")
                reasons.append(f"")
                reasons.append(f"🎯 Decision: BUY NOW")
                reasons.append(f"   • 5m entry signal ready (timing is RIGHT)")
                reasons.append(f"   • 15m trend is strong (trend is RIGHT)")
                reasons.append(f"   • Combined confidence: {confidence}%")
            else:  # bearish_aligned
                final_signal = "SELL"
                final_direction = "BEARISH"
                trade_timing = "✅ READY TO SELL NOW"
                trend_quality = "🔴 STRONG BEARISH TREND (15m confirms)"
                confidence = min(95, confidence_5m + 10)
                reasons.append("═══════════════════════════════════")
                reasons.append("🔴 PREMIUM EXIT: 5m + 15m ALIGNED")
                reasons.append("═══════════════════════════════════")
                reasons.append(f"")
                reasons.append(f"5-MINUTE (EXIT TIMING):")
                reasons.append(f"  Signal: {signal_5m}")
                reasons.append(f"  Confidence: {confidence_5m}%")
                reasons.append(f"  Meaning: ✅ Price ready to SELL")
                reasons.append(f"")
                reasons.append(f"15-MINUTE (TREND STRENGTH):")
                reasons.append(f"  Trend: {confirmation_15m_val}")
                reasons.append(f"  Confidence: {confidence_15m}%")
                reasons.append(f"  Meaning: 🔴 STRONG downtrend - SAFE to exit")
                reasons.append(f"")
                reasons.append(f"🎯 Decision: SELL NOW")
                reasons.append(f"   • 5m exit signal ready (timing is RIGHT)")
                reasons.append(f"   • 15m trend is strong (trend is RIGHT)")
                reasons.append(f"   • Combined confidence: {confidence}%")
            
            ready_to_trade = True
        
        # ⚠️ CONDITIONAL ENTRY: 5m ready but weak 15m trend
        elif (is_bullish_signal_5m or is_bearish_signal_5m) and is_neutral_trend_15m:
            if is_bullish_signal_5m:
                final_signal = "BUY"
                final_direction = "BULLISH"
                trade_timing = "⚠️ READY (with caution)"
                trend_quality = "🟡 NEUTRAL TREND - Watch carefully"
                confidence = confidence_5m - 15  # Reduce confidence
                reasons.append("═══════════════════════════════════")
                reasons.append("🟡 CONDITIONAL: 5m ready, 15m unclear")
                reasons.append("═══════════════════════════════════")
                reasons.append(f"")
                reasons.append(f"5-MINUTE (ENTRY TIMING):")
                reasons.append(f"  Signal: {signal_5m}")
                reasons.append(f"  Confidence: {confidence_5m}%")
                reasons.append(f"  Meaning: ✅ Ready to BUY")
                reasons.append(f"")
                reasons.append(f"15-MINUTE (TREND STRENGTH):")
                reasons.append(f"  Trend: NEUTRAL")
                reasons.append(f"  Meaning: ⚠️ No clear trend confirmation")
                reasons.append(f"")
                reasons.append(f"⚠️ Decision: BUY (with caution)")
                reasons.append(f"   • 5m timing is ready ✅")
                reasons.append(f"   • But 15m trend is weak ⚠️")
                reasons.append(f"   • Use smaller position size")
                reasons.append(f"   • Adjusted confidence: {confidence}%")
            else:  # is_bearish_signal_5m
                final_signal = "SELL"
                final_direction = "BEARISH"
                trade_timing = "⚠️ READY (with caution)"
                trend_quality = "🟡 NEUTRAL TREND - Watch carefully"
                confidence = confidence_5m - 15
                reasons.append("═══════════════════════════════════")
                reasons.append("🟡 CONDITIONAL: 5m ready, 15m unclear")
                reasons.append("═══════════════════════════════════")
                reasons.append(f"")
                reasons.append(f"5-MINUTE (EXIT TIMING):")
                reasons.append(f"  Signal: {signal_5m}")
                reasons.append(f"  Confidence: {confidence_5m}%")
                reasons.append(f"  Meaning: ✅ Ready to SELL")
                reasons.append(f"")
                reasons.append(f"15-MINUTE (TREND STRENGTH):")
                reasons.append(f"  Trend: NEUTRAL")
                reasons.append(f"  Meaning: ⚠️ No clear trend conviction")
                reasons.append(f"")
                reasons.append(f"⚠️ Decision: SELL (with caution)")
                reasons.append(f"   • 5m timing is ready ✅")
                reasons.append(f"   • But 15m trend is unclear ⚠️")
                reasons.append(f"   • Use smaller position size")
                reasons.append(f"   • Adjusted confidence: {confidence}%")
            
            ready_to_trade = confidence >= 55
        
        # ❌ CONFLICTING: 5m wants to buy but 15m is bearish
        elif is_bullish_signal_5m and is_bearish_trend_15m:
            final_signal = "HOLD"
            final_direction = "CONFLICTED"
            trade_timing = "❌ SKIP THIS SIGNAL"
            trend_quality = "🔴 BEARISH TREND conflicts with 5m"
            confidence = 0
            ready_to_trade = False
            
            reasons.append("═══════════════════════════════════")
            reasons.append("❌ CONFLICT: 5m vs 15m OPPOSITE")
            reasons.append("═══════════════════════════════════")
            reasons.append(f"")
            reasons.append(f"5-MINUTE (ENTRY TIMING):")
            reasons.append(f"  Signal: {signal_5m} @ {confidence_5m}%")
            reasons.append(f"  Says: ✅ Ready to BUY")
            reasons.append(f"")
            reasons.append(f"15-MINUTE (TREND STRENGTH):")
            reasons.append(f"  Trend: BEARISH (REJECT)")
            reasons.append(f"  Says: 🔴 Strong downtrend - DON'T buy!")
            reasons.append(f"")
            reasons.append(f"❌ Decision: HOLD/SKIP")
            reasons.append(f"   • Trend is DOWN but signal is UP")
            reasons.append(f"   • Trust the 15m trend over 5m noise")
            reasons.append(f"   • WAIT for both to align")
        
        # ❌ CONFLICTING: 5m wants to sell but 15m is bullish
        elif is_bearish_signal_5m and is_bullish_trend_15m:
            final_signal = "HOLD"
            final_direction = "CONFLICTED"
            trade_timing = "❌ SKIP THIS SIGNAL"
            trend_quality = "🟢 BULLISH TREND conflicts with 5m"
            confidence = 0
            ready_to_trade = False
            
            reasons.append("═══════════════════════════════════")
            reasons.append("❌ CONFLICT: 5m vs 15m OPPOSITE")
            reasons.append("═══════════════════════════════════")
            reasons.append(f"")
            reasons.append(f"5-MINUTE (EXIT TIMING):")
            reasons.append(f"  Signal: {signal_5m} @ {confidence_5m}%")
            reasons.append(f"  Says: ✅ Ready to SELL")
            reasons.append(f"")
            reasons.append(f"15-MINUTE (TREND STRENGTH):")
            reasons.append(f"  Trend: BULLISH (CONFIRM)")
            reasons.append(f"  Says: 🟢 Strong uptrend - DON'T sell!")
            reasons.append(f"")
            reasons.append(f"❌ Decision: HOLD/SKIP")
            reasons.append(f"   • Trend is UP but signal is DOWN")
            reasons.append(f"   • Trust the 15m trend over 5m noise")
            reasons.append(f"   • WAIT for both to align")
        
        # 🟡 NEUTRAL: 5m has no signal yet
        else:
            final_signal = "HOLD"
            final_direction = "NEUTRAL"
            trade_timing = "⏳ WAITING"
            trend_quality = "🟡 Trend is unclear"
            confidence = 0
            ready_to_trade = False
            
            reasons.append("═══════════════════════════════════")
            reasons.append("⏳ WAITING FOR SIGNALS")
            reasons.append("═══════════════════════════════════")
            reasons.append(f"")
            reasons.append(f"5-MINUTE (ENTRY TIMING):")
            reasons.append(f"  Status: {signal_5m}")
            reasons.append(f"  Confidence: {confidence_5m}%")
            reasons.append(f"  Meaning: Price is at VWAP (indecision)")
            reasons.append(f"")
            reasons.append(f"15-MINUTE (TREND STRENGTH):")
            reasons.append(f"  Trend: {confirmation_15m_val}")
            reasons.append(f"  Confidence: {confidence_15m}%")
            reasons.append(f"")
            reasons.append(f"⏳ Decision: HOLD - WAIT FOR BREAKOUT")
            reasons.append(f"   • 5m: Price too close to VWAP, need clear break")
            reasons.append(f"   • 15m: No clear trend direction")
            reasons.append(f"   • WAIT for better setup")
        
        return {
            "execution_mode": "5M_PRIMARY_15M_CONFIRMATION",
            "signal": final_signal,
            "direction": final_direction,
            "confidence": round(confidence, 1),
            "trade_timing": trade_timing,
            "trend_quality": trend_quality,
            "ready_to_trade": ready_to_trade,
            "trading_action": f"{'✅ ' if ready_to_trade else '⏳ '}{final_signal} - {trade_timing}",
            "reasons": reasons,
            "vwap_5m": direction_5m,
            "vwap_15m": confirmation_15m,
            "alignment": {
                "signals_aligned": signals_aligned,
                "5m_bullish": is_bullish_signal_5m,
                "15m_bullish": is_bullish_trend_15m,
                "5m_bearish": is_bearish_signal_5m,
                "15m_bearish": is_bearish_trend_15m,
            }
        }



class IntraDayEntrySystem:
    """
    Complete Intraday Entry System
    =============================
    
    Combines:
    1. 5m VWMA-20 Entry Filter (PRIMARY)
    2. 15m Momentum Entry Filter (CONFIRMATION)
    3. RSI 60/40 Momentum Filter (TIMEFRAME-SPECIFIC)
    4. Risk Management (SL/Target calculation)
    
    This is the BEST system for Indian intraday trading
    """
    
    @staticmethod
    def generate_intraday_signal(
        # 5-Minute Data (PRIMARY)
        price_5m: float,
        vwma_20_5m: float,
        ema_20_5m: float,
        ema_50_5m: float,
        volume_5m: int,
        avg_volume_5m: int,
        prev_price_5m: float = None,
        prev_vwma_20_5m: float = None,
        
        # 15-Minute Data (CONFIRMATION)
        rsi_15m: float = None,
        ema_20_15m: float = None,
        ema_50_15m: float = None,
        volume_15m: int = None,
        avg_volume_15m: int = None,
        
        # Risk Management
        atr_5m: float = None,  # For SL calculation
        symbol: str = "UNKNOWN",
    ) -> Dict[str, Any]:
        """
        Generate complete intraday entry signal
        
        Returns signal only if:
        1. 5m VWMA-20 entry is good
        2. 15m momentum confirms (optional if not available)
        """
        
        # Step 1: Analyze 5m VWMA Entry
        vwma_entry = VWMAEntryFilter.analyze_vwma_entry(
            current_price=price_5m,
            vwma_20=vwma_20_5m,
            prev_price=prev_price_5m or price_5m,
            prev_vwma_20=prev_vwma_20_5m or vwma_20_5m,
            volume=volume_5m,
            avg_volume=avg_volume_5m,
            ema_20=ema_20_5m,
            ema_50=ema_50_5m,
        )
        
        # Step 2: Analyze 15m Momentum (if available)
        momentum_analysis = None
        if rsi_15m is not None:
            momentum_analysis = MomentumEntryFilter.analyze_15m_momentum(
                rsi_15m=rsi_15m,
                ema_20_15m=ema_20_15m or 0,
                ema_50_15m=ema_50_15m or 0,
                volume_15m=volume_15m or 0,
                avg_volume_15m=avg_volume_15m or 1,
                price_15m=price_5m,
            )
        
        # Step 3: Combine signals
        final_signal = vwma_entry["signal"]
        final_confidence = vwma_entry["confidence"]
        final_reasons = vwma_entry["reasons"].copy()
        
        if momentum_analysis:
            # Boost confidence if 15m momentum confirms
            if vwma_entry["signal"] == "BUY" and momentum_analysis["momentum_signal"] in ["BULLISH", "STRONG_BULLISH"]:
                final_confidence = min(95, final_confidence + 10)
                final_reasons.append(f"🚀 15m Momentum CONFIRMS: {momentum_analysis['momentum_rating']}")
            
            elif vwma_entry["signal"] == "SELL" and momentum_analysis["momentum_signal"] in ["BEARISH", "STRONG_BEARISH"]:
                final_confidence = min(95, final_confidence + 10)
                final_reasons.append(f"🚀 15m Momentum CONFIRMS: {momentum_analysis['momentum_rating']}")
            
            # Reduce confidence if conflict
            elif vwma_entry["signal"] in ["BUY", "BUY_CONTINUATION"] and momentum_analysis["momentum_signal"] in ["BEARISH"]:
                final_confidence = max(30, final_confidence - 20)
                final_reasons.append(f"⚠️ 15m Momentum CONFLICTS: {momentum_analysis['momentum_rating']}")
        
        # Step 4: Calculate Risk Management
        sl = None
        target = None
        risk_pct = None
        
        if final_signal in ["BUY", "SELL"] and atr_5m:
            # Standard: SL = ATR away from entry
            if final_signal == "BUY":
                sl = round(price_5m - (atr_5m * 1.5), 2)  # 1.5 × ATR below = good SL
                target = round(price_5m + (atr_5m * 3.0), 2)  # 3 × ATR above = good target (2:1 RR)
                risk_pct = round(((price_5m - sl) / price_5m) * 100, 3)
            else:  # SELL
                sl = round(price_5m + (atr_5m * 1.5), 2)
                target = round(price_5m - (atr_5m * 3.0), 2)
                risk_pct = round(((sl - price_5m) / price_5m) * 100, 3)
        
        return {
            "symbol": symbol,
            "timestamp": datetime.now().isoformat(),
            
            # Main Signal
            "signal": final_signal,
            "confidence": round(final_confidence, 1),
            "reasons": final_reasons,
            
            # Entry Details
            "entry_price": round(price_5m, 2),
            "stop_loss": sl,
            "target": target,
            "risk_pct": risk_pct,
            
            # Component Analysis
            "vwma_5m": vwma_entry,
            "momentum_15m": momentum_analysis,
            
            # Ready to trade?
            "ready_to_trade": final_signal in ["BUY", "SELL"] and final_confidence >= 60,
            "trading_message": _format_trading_message(final_signal, final_confidence, final_reasons),
        }
    
    @staticmethod
    def backtest_intraday_logic(
        candles_5m: List[Dict[str, Any]],
        candles_15m: List[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Backtest the intraday entry system
        
        Args:
            candles_5m: List of 5m candle dicts with OHLCV + VWMA/EMA
            candles_15m: List of 15m candle dicts with RSI/EMA
        
        Returns:
            Backtest results
        """
        if not candles_5m:
            return {"error": "No 5m candles provided"}
        
        signals_generated = 0
        winning_trades = 0
        losing_trades = 0
        
        for i, candle_5m in enumerate(candles_5m):
            # Get 15m candle if available
            candle_15m = None
            if candles_15m and i < len(candles_15m):
                candle_15m = candles_15m[i]
            
            # Generate signal
            signal_result = IntraDayEntrySystem.generate_intraday_signal(
                price_5m=candle_5m.get("close", 0),
                vwma_20_5m=candle_5m.get("vwma_20", 0),
                ema_20_5m=candle_5m.get("ema_20", 0),
                ema_50_5m=candle_5m.get("ema_50", 0),
                volume_5m=candle_5m.get("volume", 0),
                avg_volume_5m=candle_5m.get("avg_volume", 1),
                prev_price_5m=candles_5m[i-1].get("close") if i > 0 else candle_5m.get("close"),
                prev_vwma_20_5m=candles_5m[i-1].get("vwma_20") if i > 0 else candle_5m.get("vwma_20"),
                rsi_15m=candle_15m.get("rsi") if candle_15m else None,
                ema_20_15m=candle_15m.get("ema_20") if candle_15m else None,
                ema_50_15m=candle_15m.get("ema_50") if candle_15m else None,
                volume_15m=candle_15m.get("volume") if candle_15m else None,
                avg_volume_15m=candle_15m.get("avg_volume") if candle_15m else None,
                atr_5m=candle_5m.get("atr", 10),
                symbol=candle_5m.get("symbol", "UNKNOWN"),
            )
            
            if signal_result["signal"] in ["BUY", "SELL"]:
                signals_generated += 1
        
        return {
            "total_candles_5m": len(candles_5m),
            "signals_generated": signals_generated,
            "signal_frequency": f"{round((signals_generated / len(candles_5m)) * 100, 2)}%" if candles_5m else "0%",
            "message": f"Strategy generates {signals_generated} signals from {len(candles_5m)} candles",
        }


class EMATrafficLightFilter:
    """
    EMA 20/50/100/200 + Smoothline (EMA-9) Traffic Light System
    ============================================================
    
    ENHANCED with 200 EMA anchor + Smoothline-9 for fast entry confirmation
    
    BEST TIMEFRAME for EMA Traffic Light:
    🔥 Intraday (India)
    
    Trading Style   Timeframe    Quality        Parameter
    ─────────────   ─────────    ──────────────  ──────────
    Fast Entry     5m           ⚠️ Entry timing  Smoothline-9 (EMA-9)
    Entry Signal   5m           ⚠️ Entry timing  EMA-20
    EMA Trend      15m (BEST)   ✅✅ Confirm    EMA-20/50/100
    Anchor Support 15m+ (200)   🔒 Long-term    EMA-200
    
    ✅ Smoothline-9 (EMA-9): Fast entry confirmation (close-based)
    ✅ 5-Minute: Entry signal (when to BUY/SELL at EMA-20)
    ✅ 15-Minute: Trend strength (Bullish/Bearish/Neutral)
    🔒 200 EMA: Market bias anchor (above=bullish, below=bearish)
    
    Why EMA Traffic Light Works:
    • GREEN (BUY): EMA-20 > EMA-50 > EMA-100 with Price > EMA-200 (Perfect bullish)
                   + Smoothline-9 above EMA-20 (entry confirmation)
    • YELLOW (CAUTION): Mixed alignment OR conflicting with 200 EMA anchor
    • RED (SELL): EMA-20 < EMA-50 < EMA-100 with Price < EMA-200 (Perfect bearish)
                  + Smoothline-9 below EMA-20 (entry confirmation)
    
    Smoothline Config: Length=9, Source=CLOSE, Type=EMA (smoothed)
    Entry Signal (5m): Use when price crosses EMA-20 + Smoothline-9 confirmation
    Trend Filter (15m): Check if aligned with direction
    Anchor (200): Confirms overall market bias (long-term direction)
    """
    
    @staticmethod
    def analyze_ema_traffic(
        ema_20: float,
        ema_50: float,
        ema_100: float,
        ema_200: float,
        smoothline_9: float,              # ✅ NEW: Smoothlined EMA-9 (Close-based)
        current_price: float,
        volume: float = None,
        avg_volume: float = None,
        timeframe: str = "15m",
    ) -> Dict[str, Any]:
        """
        Analyze EMA alignment as traffic light signal with 200 EMA anchor + Smoothline-9
        
        Parameters:
        -----------
        ema_20, ema_50, ema_100, ema_200: Main trend EMAs
        smoothline_9: Smoothed EMA-9 (Length=9, Source=CLOSE, Type=EMA)
        current_price: Current close price
        volume, avg_volume: For confirmation
        timeframe: 5m/15m/30m
        
        Smoothline Logic:
        - Fast entry confirmation line (Length=9)
        - Based on close prices only
        - Price above Smoothline-9 = Bullish entry zone
        - Price below Smoothline-9 = Bearish exit zone
        
        Returns:
          signal: GREEN|YELLOW|RED
          trend: BULLISH|CAUTION|BEARISH
          confidence: 0-95%
          traffic_light: Visual indicator
        """
        
        # 1. SHORT-TERM EMA ALIGNMENT (20/50/100 for entry timing)
        bullish_cross_20_50 = ema_20 > ema_50
        bullish_cross_50_100 = ema_50 > ema_100
        bullish_cross_20_100 = ema_20 > ema_100
        
        bearish_cross_20_50 = ema_20 < ema_50
        bearish_cross_50_100 = ema_50 < ema_100
        bearish_cross_20_100 = ema_20 < ema_100
        
        # 1B. SMOOTHLINE-9 CHECKS (fast entry confirmation)
        price_above_smoothline9 = current_price > smoothline_9
        ema20_above_smoothline9 = ema_20 > smoothline_9
        smoothline9_above_ema50 = smoothline_9 > ema_50
        
        # Smoothline-9 bullish alignment (fast confirmation)
        smoothline_bullish = price_above_smoothline9 and ema20_above_smoothline9
        smoothline_bearish = (current_price < smoothline_9) and (ema_20 < smoothline_9)
        
        # 2. 200 EMA ANCHOR CHECK (long-term market bias)
        bullish_cross_100_200 = ema_100 > ema_200
        bearish_cross_100_200 = ema_100 < ema_200
        price_above_200 = current_price > ema_200
        price_below_200 = current_price < ema_200
        
        # 3. PERFECT ALIGNMENT (all 5 conditions aligned)
        perfect_bullish = (bullish_cross_20_50 and bullish_cross_50_100 and 
                          bullish_cross_100_200 and price_above_200)
        perfect_bearish = (bearish_cross_20_50 and bearish_cross_50_100 and 
                          bearish_cross_100_200 and price_below_200)
        
        # 4. STRONG ALIGNMENT (4/5 conditions aligned)
        strong_bullish = ((bullish_cross_20_50 and bullish_cross_50_100 and bullish_cross_100_200) or
                         (bullish_cross_20_50 and bullish_cross_50_100 and price_above_200) or
                         (bullish_cross_50_100 and bullish_cross_100_200 and price_above_200))
        
        strong_bearish = ((bearish_cross_20_50 and bearish_cross_50_100 and bearish_cross_100_200) or
                         (bearish_cross_20_50 and bearish_cross_50_100 and price_below_200) or
                         (bearish_cross_50_100 and bearish_cross_100_200 and price_below_200))
        
        # 5. PARTIAL ALIGNMENT (2/3 of 20/50/100 aligned)
        two_thirds_bullish = (bullish_cross_20_50 and bullish_cross_50_100) or \
                            (bullish_cross_20_50 and bullish_cross_20_100) or \
                            (bullish_cross_50_100 and bullish_cross_20_100)
        
        two_thirds_bearish = (bearish_cross_20_50 and bearish_cross_50_100) or \
                            (bearish_cross_20_50 and bearish_cross_20_100) or \
                            (bearish_cross_50_100 and bearish_cross_20_100)
        
        # 6. DETERMINE SIGNAL WITH 200 EMA ANCHOR
        signal = "YELLOW"
        trend = "CAUTION"
        traffic_light = "🟡"
        base_confidence = 40
        reasons = []
        light_quality = "Ambiguous"
        
        # ✅ GREEN - Perfect bullish alignment (ALL 5: 20>50>100>200 + Price>200) + Smoothline-9 confirmation
        if perfect_bullish and smoothline_bullish:
            signal = "GREEN"
            trend = "BULLISH"
            traffic_light = "🟢"
            base_confidence = 95
            light_quality = "PERFECT ALIGN (5/5) + SMOOTHLINE ✅"
            reasons.append("[GREEN] PERFECT BULLISH: EMA-20 > 50 > 100 > 200 + Price > 200 ✅✅✅")
            reasons.append(f"  SHORT-TERM (20/50/100): +{(ema_20-ema_50):.2f} pts → {(ema_50-ema_100):.2f} pts")
            reasons.append(f"  ANCHOR (200 EMA): {(ema_100-ema_200):.2f} pts above 200 (strong uptrend)")
            reasons.append(f"  FAST ENTRY (Smoothline-9): BULLISH CONFIRMATION - Price > Smoothline + EMA-20 > Smoothline")
            reasons.append(f"  PRICE: Above all EMAs + Smoothline-9 (highest entry quality)")
            reasons.append("  ACTION: INSTITUTIONAL BUY SIGNAL - Best entry quality with speed confirmation")
        
        # ✅ GREEN - Perfect bullish alignment with strong smoothline (slightly lower confidence if smoothline weak)
        elif perfect_bullish and not smoothline_bearish:
            signal = "GREEN"
            trend = "BULLISH"
            traffic_light = "🟢"
            base_confidence = 95
            light_quality = "PERFECT ALIGN (5/5)" 
            reasons.append("[GREEN] PERFECT BULLISH: EMA-20 > 50 > 100 > 200 + Price > 200 ✅✅✅")
            reasons.append(f"  SHORT-TERM (20/50/100): +{(ema_20-ema_50):.2f} pts → {(ema_50-ema_100):.2f} pts")
            reasons.append(f"  ANCHOR (200 EMA): {(ema_100-ema_200):.2f} pts above 200 (strong uptrend)")
            reasons.append(f"  PRICE: Above all EMAs (bullish bias confirmed)")
            if not smoothline_bullish:
                reasons.append(f"  NOTE: Smoothline-9 not yet aligned - monitor for faster entry")
                base_confidence = 90
                light_quality = "PERFECT ALIGN (5/5) - Awaiting Smoothline"
            reasons.append("  ACTION: INSTITUTIONAL BUY SIGNAL - Best entry quality")
        
        # 🟢 GREEN - Strong bullish (4/5 conditions aligned) + strong smoothline confirmation
        elif strong_bullish and not bearish_cross_20_50 and not bearish_cross_50_100 and smoothline_bullish:
            signal = "GREEN"
            trend = "BULLISH"
            traffic_light = "🟢"
            base_confidence = 88
            light_quality = "STRONG ALIGN (4/5) + SMOOTHLINE ✅"
            reasons.append("[GREEN] STRONG BULLISH: 4/5 conditions + Smoothline-9 confirmation")
            if bullish_cross_20_50 and bullish_cross_50_100 and bullish_cross_100_200:
                reasons.append("  • EMA-20 > EMA-50 > EMA-100 > EMA-200: Perfect short-term")
                if price_above_200:
                    reasons.append(f"  • Price > EMA-200: Confirmed bullish bias")
                else:
                    reasons.append(f"  • Price near 200: Watch for pullback")
            elif bullish_cross_20_50 and bullish_cross_50_100 and price_above_200:
                reasons.append("  • EMA-20 > EMA-50 > EMA-100: Good short-term alignment")
                reasons.append(f"  • Price > EMA-200: Bullish bias held")
            else:
                reasons.append("  • EMA-100 > EMA-200 with price bullish: Steady uptrend")
            reasons.append(f"  • Smoothline-9: Fast entry signal confirmed")
            reasons.append("  ACTION: STRONG ENTRY - Smoothline confirmation ready")
        
        # 🟢 GREEN - Strong bullish (4/5 conditions aligned) without smoothline confirmation
        elif strong_bullish and not bearish_cross_20_50 and not bearish_cross_50_100:
            signal = "GREEN"
            trend = "BULLISH"
            traffic_light = "🟢"
            base_confidence = 85
            light_quality = "STRONG ALIGN (4/5)"
            reasons.append("[GREEN] STRONG BULLISH: 4/5 conditions aligned")
            if bullish_cross_20_50 and bullish_cross_50_100 and bullish_cross_100_200:
                reasons.append("  • EMA-20 > EMA-50 > EMA-100 > EMA-200: Perfect short-term")
                if price_above_200:
                    reasons.append(f"  • Price > EMA-200: Confirmed bullish bias")
                else:
                    reasons.append(f"  • Price near 200: Watch for pullback")
            elif bullish_cross_20_50 and bullish_cross_50_100 and price_above_200:
                reasons.append("  • EMA-20 > EMA-50 > EMA-100: Good short-term alignment")
                reasons.append(f"  • Price > EMA-200: Bullish bias held")
            else:
                reasons.append("  • EMA-100 > EMA-200 with price bullish: Steady uptrend")
            if not smoothline_bullish:
                reasons.append(f"  • Smoothline-9: Not yet aligned - wait for confirmation")
            reasons.append("  ACTION: GOOD ENTRY - Confirmation signal ready")
        
        # 🔴 RED - Perfect bearish alignment (ALL 5: 20<50<100<200 + Price<200) + Smoothline-9 confirmation
        elif perfect_bearish and smoothline_bearish:
            signal = "RED"
            trend = "BEARISH"
            traffic_light = "🔴"
            base_confidence = 95
            light_quality = "PERFECT ALIGN (5/5) + SMOOTHLINE ✅"
            reasons.append("[RED] PERFECT BEARISH: EMA-20 < 50 < 100 < 200 + Price < 200 ✅✅✅")
            reasons.append(f"  SHORT-TERM (20/50/100): {(ema_20-ema_50):.2f} pts → {(ema_50-ema_100):.2f} pts")
            reasons.append(f"  ANCHOR (200 EMA): {(ema_100-ema_200):.2f} pts below 200 (strong downtrend)")
            reasons.append(f"  FAST EXIT (Smoothline-9): BEARISH CONFIRMATION - Price < Smoothline + EMA-20 < Smoothline")
            reasons.append(f"  PRICE: Below all EMAs + Smoothline-9 (highest exit quality)")
            reasons.append("  ACTION: INSTITUTIONAL SELL SIGNAL - Best exit quality with speed confirmation")
        
        # 🔴 RED - Perfect bearish alignment with strong smoothline (slightly lower confidence if smoothline weak)
        elif perfect_bearish and not smoothline_bullish:
            signal = "RED"
            trend = "BEARISH"
            traffic_light = "🔴"
            base_confidence = 95
            light_quality = "PERFECT ALIGN (5/5)"
            reasons.append("[RED] PERFECT BEARISH: EMA-20 < 50 < 100 < 200 + Price < 200 ✅✅✅")
            reasons.append(f"  SHORT-TERM (20/50/100): {(ema_20-ema_50):.2f} pts → {(ema_50-ema_100):.2f} pts")
            reasons.append(f"  ANCHOR (200 EMA): {(ema_100-ema_200):.2f} pts below 200 (strong downtrend)")
            reasons.append(f"  PRICE: Below all EMAs (bearish bias confirmed)")
            if not smoothline_bearish:
                reasons.append(f"  NOTE: Smoothline-9 not yet aligned - monitor for faster exit")
                base_confidence = 90
                light_quality = "PERFECT ALIGN (5/5) - Awaiting Smoothline"
            reasons.append("  ACTION: INSTITUTIONAL SELL SIGNAL - Best exit quality")
        
        # 🔴 RED - Strong bearish (4/5 conditions aligned) + strong smoothline confirmation
        elif strong_bearish and not bullish_cross_20_50 and not bullish_cross_50_100 and smoothline_bearish:
            signal = "RED"
            trend = "BEARISH"
            traffic_light = "🔴"
            base_confidence = 88
            light_quality = "STRONG ALIGN (4/5) + SMOOTHLINE ✅"
            reasons.append("[RED] STRONG BEARISH: 4/5 conditions + Smoothline-9 confirmation")
            if bearish_cross_20_50 and bearish_cross_50_100 and bearish_cross_100_200:
                reasons.append("  • EMA-20 < EMA-50 < EMA-100 < EMA-200: Perfect short-term")
                if price_below_200:
                    reasons.append(f"  • Price < EMA-200: Confirmed bearish bias")
                else:
                    reasons.append(f"  • Price near 200: Watch for bounce")
            elif bearish_cross_20_50 and bearish_cross_50_100 and price_below_200:
                reasons.append("  • EMA-20 < EMA-50 < EMA-100: Good short-term alignment")
                reasons.append(f"  • Price < EMA-200: Bearish bias held")
            else:
                reasons.append("  • EMA-100 < EMA-200 with price bearish: Steady downtrend")
            reasons.append(f"  • Smoothline-9: Fast exit signal confirmed")
            reasons.append("  ACTION: STRONG EXIT - Smoothline confirmation ready")
        
        # 🔴 RED - Strong bearish (4/5 conditions aligned) without smoothline confirmation
        elif strong_bearish and not bullish_cross_20_50 and not bullish_cross_50_100:
            signal = "RED"
            trend = "BEARISH"
            traffic_light = "🔴"
            base_confidence = 85
            light_quality = "STRONG ALIGN (4/5)"
            reasons.append("[RED] STRONG BEARISH: 4/5 conditions aligned")
            if bearish_cross_20_50 and bearish_cross_50_100 and bearish_cross_100_200:
                reasons.append("  • EMA-20 < EMA-50 < EMA-100 < EMA-200: Perfect short-term")
                if price_below_200:
                    reasons.append(f"  • Price < EMA-200: Confirmed bearish bias")
                else:
                    reasons.append(f"  • Price near 200: Watch for bounce")
            elif bearish_cross_20_50 and bearish_cross_50_100 and price_below_200:
                reasons.append("  • EMA-20 < EMA-50 < EMA-100: Good short-term alignment")
                reasons.append(f"  • Price < EMA-200: Bearish bias held")
            else:
                reasons.append("  • EMA-100 < EMA-200 with price bearish: Steady downtrend")
            if not smoothline_bearish:
                reasons.append(f"  • Smoothline-9: Not yet aligned - wait for confirmation")
            reasons.append("  ACTION: GOOD EXIT - Confirmation signal ready")
        
        # 🟡 YELLOW - Partial bullish but unclear with 200 (2/3 short-term, ambiguous long-term)
        elif two_thirds_bullish and not (bearish_cross_20_50 or bearish_cross_50_100):
            if bearish_cross_100_200 or price_below_200:
                signal = "YELLOW"
                trend = "CAUTION"
                traffic_light = "🟡"
                base_confidence = 45
                light_quality = "WEAKENING UPTREND"
                reasons.append("[YELLOW] SHORT-TERM BULLISH but LONG-TERM BEARISH (Caution)")
                reasons.append("  • EMA-20/50/100: Bullish alignment (2/3)")
                reasons.append(f"  • EMA-200: Below or price below 200 (weakening)")
                reasons.append("  ACTION: Trade with CAUTION - Trend fade risk")
            else:
                signal = "GREEN"
                trend = "BULLISH"
                traffic_light = "🟢"
                base_confidence = 75
                light_quality = "PARTIAL BULLISH"
                reasons.append("[GREEN] PARTIAL BULLISH: 2/3 short-term + 200 support")
                reasons.append("  • EMA-20/50/100: Good bullish alignment")
                reasons.append(f"  • Price > EMA-200: Bullish bias confirmed")
                reasons.append("  ACTION: MODERATE ENTRY - Wait for tighter alignment")
        
        # 🟡 YELLOW - Partial bearish but unclear with 200 (2/3 short-term, ambiguous long-term)
        elif two_thirds_bearish and not (bullish_cross_20_50 or bullish_cross_50_100):
            if bullish_cross_100_200 or price_above_200:
                signal = "YELLOW"
                trend = "CAUTION"
                traffic_light = "🟡"
                base_confidence = 45
                light_quality = "WEAKENING DOWNTREND"
                reasons.append("[YELLOW] SHORT-TERM BEARISH but LONG-TERM BULLISH (Caution)")
                reasons.append("  • EMA-20/50/100: Bearish alignment (2/3)")
                reasons.append(f"  • EMA-200: Above or price above 200 (weakening)")
                reasons.append("  ACTION: Trade with CAUTION - Trend fade risk")
            else:
                signal = "RED"
                trend = "BEARISH"
                traffic_light = "🔴"
                base_confidence = 75
                light_quality = "PARTIAL BEARISH"
                reasons.append("[RED] PARTIAL BEARISH: 2/3 short-term + 200 resistance")
                reasons.append("  • EMA-20/50/100: Good bearish alignment")
                reasons.append(f"  • Price < EMA-200: Bearish bias confirmed")
                reasons.append("  ACTION: MODERATE EXIT - Wait for tighter alignment")
        
        # 🟡 YELLOW - Mixed signals (conflicting EMAs or convergence)
        else:
            signal = "YELLOW"
            trend = "CAUTION"
            traffic_light = "🟡"
            base_confidence = 35
            light_quality = "MIXED/FLAT"
            reasons.append("[YELLOW] MIXED EMA ALIGNMENT (Caution)")
            
            if (bullish_cross_20_50 and bearish_cross_50_100) or (bearish_cross_20_50 and bullish_cross_50_100):
                reasons.append("  • Short-term EMAs conflicting (20 vs 50/100)")
                light_quality = "CONFLICT"
            elif ema_20 == ema_50 or ema_50 == ema_100 or ema_100 == ema_200:
                reasons.append("  • EMAs converging - trend change imminent")
                light_quality = "CONVERGENCE"
            else:
                reasons.append("  • Insufficient alignment for clear signal")
                light_quality = "UNCLEAR"
            
            # Add 200 context even in YELLOW
            if bullish_cross_100_200:
                reasons.append("  • EMA-200 anchor: Uptrend (bullish long-term)")
            elif bearish_cross_100_200:
                reasons.append("  • EMA-200 anchor: Downtrend (bearish long-term)")
            else:
                reasons.append("  • EMA-200 anchor: Flat (no clear direction)")
        
        # 7. PRICE POSITION ANALYSIS (with 200 EMA)
        price_above_20 = current_price > ema_20
        price_above_50 = current_price > ema_50
        price_above_100 = current_price > ema_100
        
        ema_structure = ""
        if price_above_20 and price_above_50 and price_above_100:
            if price_above_200:
                ema_structure = "Price above all EMAs (strong bullish)"
            else:
                ema_structure = "Price above short-term (20/50/100) but below EMA-200 (weakening)"
        elif price_above_100 and price_above_50 and not price_above_20:
            ema_structure = "Price below EMA-20 (pullback to major support)"
        elif not price_above_20 and not price_above_50 and not price_above_100:
            if price_below_200:
                ema_structure = "Price below all EMAs (strong bearish)"
            else:
                ema_structure = "Price below short-term (20/50/100) but above EMA-200 (weakening)"
        elif not price_above_100 and not price_above_50 and price_above_20:
            ema_structure = "Price above EMA-20 (bounce attempt from support)"
        else:
            ema_structure = "Price between EMAs (consolidation zone)"
        
        reasons.append(f"  Price vs EMAs: {ema_structure}")
        
        # Timeframe multiplier
        multiplier = 1.0
        timeframe_label = "15m (BEST) Very clean"
        
        if timeframe == "5m":
            multiplier = 0.85  # Less reliable on 5m
            timeframe_label = "5m (CAUTION) Needs confirmation"
            base_confidence = int(base_confidence * 0.85)
        elif timeframe == "15m":
            multiplier = 1.0   # BEST timeframe
            timeframe_label = "15m (BEST) Crystal clear"
        elif timeframe == "30m":
            multiplier = 1.15  # Even clearer but slower
            timeframe_label = "30m (STRONGER) Trend confirmation"
            base_confidence = int(base_confidence * 1.15)
        
        return {
            "signal": signal,  # GREEN|YELLOW|RED
            "trend": trend,    # BULLISH|CAUTION|BEARISH
            "traffic_light": traffic_light,  # 🟢|🟡|🔴
            "light_quality": light_quality,  # Quality of signal
            "confidence": min(95, base_confidence),  # Cap at 95%
            "timeframe_label": timeframe_label,
            "ema_data": {
                "ema_20": ema_20,
                "ema_50": ema_50,
                "ema_100": ema_100,
                "ema_200": ema_200,
                "smoothline_9": smoothline_9,
                "current_price": current_price,
                "price_position": ema_structure,
            },
            "ema_alignment": {
                "perfect_bullish": perfect_bullish,
                "perfect_bearish": perfect_bearish,
                "strong_bullish": strong_bullish,
                "strong_bearish": strong_bearish,
                "two_thirds_bullish": two_thirds_bullish,
                "two_thirds_bearish": two_thirds_bearish,
                # Short-term checks (5m entry timing)
                "ema_20_above_50": bullish_cross_20_50,
                "ema_50_above_100": bullish_cross_50_100,
                "ema_20_above_100": bullish_cross_20_100,
                # Long-term anchor (15m+ trend)
                "ema_100_above_200": bullish_cross_100_200,
                # Smoothline-9 fast entry confirmation (EMA-9, Source=CLOSE, Length=9)
                "smoothline_9": smoothline_9,
                "price_above_smoothline9": price_above_smoothline9,
                "ema20_above_smoothline9": ema20_above_smoothline9,
                "smoothline_bullish": smoothline_bullish,
                "smoothline_bearish": smoothline_bearish,
                # Price confirmation
                "price_above_200": price_above_200,
                "price_above_all_emas": price_above_20 and price_above_50 and price_above_100,
                "price_below_all_emas": not price_above_20 and not price_above_50 and not price_above_100,
            },
            "reasons": reasons,
            "multiplier": {
                "base_confidence": base_confidence,
                "timeframe_multiplier": multiplier,
            },
        }
    
    @staticmethod
    def combine_with_price_action(
        traffic_light: Dict[str, Any],
        current_price: float,
        prev_price: float,
        volume: float = None,
        avg_volume: float = None,
    ) -> Dict[str, Any]:
        """
        Combine traffic light + price action for entry signal
        
        Entry Logic (5m):
        - GREEN at EMA-20 = FRESH BUY (with volume)
        - GREEN above all EMAs = CONTINUATION BUY
        
        Exit Logic (5m):
        - RED at EMA-20 = BREAKDOWN SELL (with volume)
        - RED below all EMAs = CONTINUATION SELL
        
        Trend Filter (15m):
        - Confirm price respects 200 EMA anchor
        - Check EMA-20/50/100 alignment strength
        """
        
        signal = "HOLD"
        entry_quality = "NONE"
        confidence = traffic_light["confidence"]
        reasons = list(traffic_light["reasons"])
        
        trend = traffic_light["trend"]
        traffic = traffic_light["signal"]
        ema_20 = traffic_light["ema_data"]["ema_20"]
        ema_50 = traffic_light["ema_data"]["ema_50"]
        ema_100 = traffic_light["ema_data"]["ema_100"]
        ema_200 = traffic_light["ema_data"]["ema_200"]
        
        # Volume confirmation
        volume_ratio = 1.0
        if volume and avg_volume:
            volume_ratio = volume / avg_volume
            has_volume = volume_ratio >= 1.1
        else:
            has_volume = False
        
        # Price movement
        price_moved_up = current_price > prev_price
        price_moved_down = current_price < prev_price
        
        # ✅ GREEN LIGHT ENTRIES (Bullish Signal)
        if traffic == "GREEN":
            # 5M ENTRY: At EMA-20 support - Fresh dip entry point
            if abs(current_price - ema_20) <= (ema_50 * 0.002):  # Within 0.2%
                if price_moved_up and has_volume:
                    signal = "BUY_FRESH"
                    entry_quality = "EXCELLENT"
                    confidence = min(95, confidence + 10)
                    reasons.append("  [5M ENTRY] Price bounced from EMA-20 (support) with volume ✅")
                    reasons.append(f"     Entry at: ₹{current_price:.2f} (strong reversal setup)")
                else:
                    signal = "BUY_SETUP"
                    entry_quality = "GOOD"
                    confidence = min(95, confidence + 5)
                    reasons.append("  [5M SETUP] Price at EMA-20 support (wait for breakout confirmation)")
                    reasons.append(f"     Support level: ₹{ema_20:.2f}")
            
            # CONTINUATION: Price above all EMAs (holding uptrend)
            elif traffic_light["ema_alignment"]["price_above_all_emas"]:
                signal = "BUY_CONTINUATION"
                entry_quality = "GOOD"
                confidence = min(95, confidence + 5)
                reasons.append("  [15M TREND] Price above all EMAs (uptrend holding)")
                reasons.append(f"     Price > EMA-200: {current_price:.2f} > {ema_200:.2f} (bullish anchor)")
                reasons.append("     ACTION: Hold long positions, add on pullbacks")
            
            # GREEN but price not at support/trend
            else:
                signal = "BUY"
                entry_quality = "FAIR"
                reasons.append("  [15M TREND] Green light confirmed (trend is bullish)")
                if traffic_light["ema_alignment"]["price_above_200"]:
                    reasons.append("  [ANCHOR] Price > EMA-200 (bullish long-term bias)")
                reasons.append("  [5M WAIT] Wait for price to reach EMA-20 for better entry")
        
        # 🔴 RED LIGHT EXITS (Bearish Signal)
        elif traffic == "RED":
            # 5M EXIT: At EMA-20 resistance - Fresh breakdown exit point
            if abs(current_price - ema_20) <= (ema_50 * 0.002):
                if price_moved_down and has_volume:
                    signal = "SELL_BREAKDOWN"
                    entry_quality = "EXCELLENT"
                    confidence = min(95, confidence + 10)
                    reasons.append("  [5M EXIT] Price broke below EMA-20 (resistance) with volume ✅")
                    reasons.append(f"     Exit at: ₹{current_price:.2f} (strong reversal setup)")
                else:
                    signal = "SELL_SETUP"
                    entry_quality = "GOOD"
                    confidence = min(95, confidence + 5)
                    reasons.append("  [5M SETUP] Price at EMA-20 resistance (wait for breakdown confirmation)")
                    reasons.append(f"     Resistance level: ₹{ema_20:.2f}")
            
            # CONTINUATION: Price below all EMAs (holding downtrend)
            elif traffic_light["ema_alignment"]["price_below_all_emas"]:
                signal = "SELL_CONTINUATION"
                entry_quality = "GOOD"
                confidence = min(95, confidence + 5)
                reasons.append("  [15M TREND] Price below all EMAs (downtrend holding)")
                reasons.append(f"     Price < EMA-200: {current_price:.2f} < {ema_200:.2f} (bearish anchor)")
                reasons.append("     ACTION: Hold short positions, add on bounces")
            
            # RED but price not at resistance/trend
            else:
                signal = "SELL"
                entry_quality = "FAIR"
                reasons.append("  [15M TREND] Red light confirmed (trend is bearish)")
                if not traffic_light["ema_alignment"]["price_above_200"]:
                    reasons.append("  [ANCHOR] Price < EMA-200 (bearish long-term bias)")
                reasons.append("  [5M WAIT] Wait for price to reach EMA-20 for better exit")
        
        # 🟡 YELLOW LIGHT - CAUTION (ambiguous/mixed signals)
        else:
            signal = "HOLD"
            entry_quality = "SKIP"
            confidence = max(20, confidence - 15)  # Reduce confidence
            reasons.append("  [CAUTION] YELLOW light (ambiguous alignment)")
            reasons.append("  NO ENTRY - Wait for GREEN or RED confirmation")
            reasons.append(f"  EMA-200 anchor: {'Bullish' if traffic_light['ema_alignment']['ema_100_above_200'] else 'Bearish'}")
        
        return {
            "signal": signal,
            "traffic_status": traffic,
            "entry_quality": entry_quality,
            "confidence": confidence,
            "volume_ratio": volume_ratio if has_volume else 0,
            "price_action": {
                "moved_up": price_moved_up,
                "moved_down": price_moved_down,
                "at_ema_20": abs(current_price - ema_20) <= (ema_50 * 0.002),
                "at_ema_200": abs(current_price - ema_200) <= (ema_200 * 0.005),
            },
            "support_resistance": {
                "immediate_support": ema_20,
                "trend_line": ema_50,
                "major_support": ema_100,
                "anchor_level": ema_200,
            },
            "reasons": reasons,
        }


class CaramillaPivotFilter:
    """
    Camarilla Pivot Points with CPR Zones (15m Analysis + 5m Execution)
    ====================================================================
    
    Uses Camarilla formulas to identify:
    - H3/L3 as strong resistance/support (CPR Range)
    - H4/L4 as extreme levels
    - R3/S3 as breakout confirmation zones
    
    Strategy:
    - 15m: Calculate Camarilla levels from daily/session high/low/close
    - 5m: Execute entries when price touches/breaks these levels
    - Alignment: Confirms entry quality based on price action
    
    Best for: Index trading (NIFTY, BANKNIFTY) with institutional levels
    """
    
    @staticmethod
    def calculate_camarilla_levels(
        high: float,
        low: float,
        close: float,
    ) -> Dict[str, float]:
        """
        Calculate Camarilla Pivot levels
        
        Formula:
        H = High, L = Low, C = Close
        H4 = C + 1.1 * (H - L)
        H3 = C + 0.55 * (H - L)
        H2 = C + 0.275 * (H - L)
        H1 = C + 0.1375 * (H - L)
        P = (H + L + C) / 3
        L1 = C - 0.1375 * (H - L)
        L2 = C - 0.275 * (H - L)
        L3 = C - 0.55 * (H - L)
        L4 = C - 1.1 * (H - L)
        """
        hl_range = high - low
        
        # Resistance levels
        h4 = close + 1.1 * hl_range
        h3 = close + 0.55 * hl_range
        h2 = close + 0.275 * hl_range
        h1 = close + 0.1375 * hl_range
        
        # Pivot
        pivot = (high + low + close) / 3
        
        # Support levels
        l1 = close - 0.1375 * hl_range
        l2 = close - 0.275 * hl_range
        l3 = close - 0.55 * hl_range
        l4 = close - 1.1 * hl_range
        
        return {
            "h4": round(h4, 2),
            "h3": round(h3, 2),
            "h2": round(h2, 2),
            "h1": round(h1, 2),
            "pivot": round(pivot, 2),
            "l1": round(l1, 2),
            "l2": round(l2, 2),
            "l3": round(l3, 2),
            "l4": round(l4, 2),
            "cpr_high": round(h3, 2),
            "cpr_low": round(l3, 2),
        }
    
    @staticmethod
    def analyze_camarilla_breakout(
        current_price: float,
        prev_price: float,
        levels: Dict[str, float],
        volume: int = None,
        avg_volume: int = None,
        timeframe: str = "5m",
    ) -> Dict[str, Any]:
        """
        Analyze Camarilla breakout/support signals (5m execution)
        
        Args:
            current_price: Current 5m price
            prev_price: Previous 5m price
            levels: Camarilla levels (from 15m)
            volume: Current candle volume
            avg_volume: Average volume
            timeframe: Analysis timeframe (5m, 15m, etc)
        
        Returns:
            Dictionary with entry signal and confidence
        """
        
        signal = None
        reason = None
        confidence = 0.0
        breakout_type = None
        level_touched = None
        
        # Volume analysis
        volume_ratio = 1.0
        if volume and avg_volume and avg_volume > 0:
            volume_ratio = volume / avg_volume
        
        volume_strong = volume_ratio > 1.2
        
        # Price direction
        price_up = current_price > prev_price
        price_down = current_price < prev_price
        
        # Define tolerance for "at level" (1% proximity = realistic for trading)
        tolerance_pct = 0.01
        tolerance_points = current_price * tolerance_pct  # 1% of current price
        
        # Find closest level to current price
        all_levels = {
            "h4": levels["h4"],
            "h3": levels["h3"],
            "h2": levels["h2"],
            "h1": levels["h1"],
            "pivot": levels["pivot"],
            "l1": levels["l1"],
            "l2": levels["l2"],
            "l3": levels["l3"],
            "l4": levels["l4"],
        }
        
        # Find which level is closest
        closest_level = min(all_levels.items(), key=lambda x: abs(x[1] - current_price))
        closest_name, closest_value = closest_level
        distance_to_closest = abs(closest_value - current_price)
        is_at_level = distance_to_closest <= tolerance_points
        
        # Only process if price is actually at a level (within tolerance)
        if not is_at_level:
            signal = "HOLD"
            breakout_type = "NO_LEVEL"
            level_touched = None
            confidence = 0
            reason = f"Price not at key Camarilla levels (closest: {closest_name}={closest_value})"
        
        # ====== RESISTANCE LEVELS ======
        elif closest_name == "h4" and price_up and prev_price <= levels["h4"]:
            signal = "SELL_BREAKOUT"
            breakout_type = "H4_BREAKOUT_UP"
            level_touched = "H4"
            confidence = 65 if volume_strong else 55
            reason = f"Price broke above H4 ({levels['h4']}) - Extreme resistance breakout"
        
        elif closest_name == "h3":
            signal = "SELL_RESISTANCE"
            breakout_type = "H3_TOUCH_STRONG"
            level_touched = "H3"
            confidence = 75 if volume_strong else 65
            reason = f"Price at H3 ({levels['h3']}) - Strong resistance (CPR range)"
        
        elif closest_name == "h2":
            signal = "SELL_WEAK"
            breakout_type = "H2_TOUCH_WEAK"
            level_touched = "H2"
            confidence = 45
            reason = f"Price at H2 ({levels['h2']}) - Weak resistance"
        
        elif closest_name == "h1":
            signal = "SELL_WEAK"
            breakout_type = "H1_TOUCH_VERY_WEAK"
            level_touched = "H1"
            confidence = 30
            reason = f"Price at H1 ({levels['h1']}) - Very weak resistance (noise)"
        
        # ====== SUPPORT LEVELS ======
        elif closest_name == "l4" and price_down and prev_price >= levels["l4"]:
            signal = "BUY_SUPPORT"
            breakout_type = "L4_TOUCH_EXTREME"
            level_touched = "L4"
            confidence = 65 if volume_strong else 55
            reason = f"Price touched L4 ({levels['l4']}) - Extreme support (bounce expected)"
        
        elif closest_name == "l3":
            signal = "BUY_SUPPORT"
            breakout_type = "L3_TOUCH_STRONG"
            level_touched = "L3"
            confidence = 85 if volume_strong else 75
            reason = f"Price at L3 ({levels['l3']}) - Strong support (CPR range - BEST entry)"
        
        elif closest_name == "l2":
            signal = "BUY_SUPPORT"
            breakout_type = "L2_TOUCH_WEAKNESS"
            level_touched = "L2"
            confidence = 55
            reason = f"Price at L2 ({levels['l2']}) - Intermediate support"
        
        elif closest_name == "l1":
            signal = "BUY_SUPPORT"
            breakout_type = "L1_TOUCH_WEAK"
            level_touched = "L1"
            confidence = 40
            reason = f"Price at L1 ({levels['l1']}) - Weak support"
        
        # ====== PIVOT AREA ======
        elif closest_name == "pivot":
            signal = "NEUTRAL"
            breakout_type = "PIVOT_NEUTRAL"
            level_touched = "PIVOT"
            confidence = 35
            reason = f"Price at PIVOT ({levels['pivot']}) - Neutral zone (wait for breakout)"
        
        # Apply timeframe multiplier
        multiplier = 1.0 if timeframe == "5m" else 1.1 if timeframe == "15m" else 0.85
        final_confidence = min(95, confidence * multiplier)
        
        return {
            "signal": signal,
            "level_touched": level_touched,
            "breakout_type": breakout_type,
            "base_confidence": confidence,
            "timeframe_multiplier": multiplier,
            "final_confidence": final_confidence,
            "volume_ratio": volume_ratio,
            "volume_strong": volume_strong,
            "reason": reason,
            "levels": levels,
        }
    
    @staticmethod
    def combine_camarilla_with_5m_execution(
        camarilla_result: Dict[str, Any],
        five_m_price: float,
        five_m_prev_price: float,
        five_m_volume: int = None,
        five_m_avg_volume: int = None,
    ) -> Dict[str, Any]:
        """
        Enhance Camarilla signal with 5m price action
        
        5m execution:
        - Confirms level touch with 5m candlestick
        - Validates volume during touch
        - Generates entry timing
        """
        
        signal = camarilla_result["signal"]
        confidence = camarilla_result["final_confidence"]
        reasons = [camarilla_result["reason"]]
        entry_quality = "NONE"
        execution_signal = signal
        
        # 5m volume boost
        vol_ratio = 1.0
        if five_m_volume and five_m_avg_volume and five_m_avg_volume > 0:
            vol_ratio = five_m_volume / five_m_avg_volume
        
        # 5m direction
        price_bounced = five_m_price > five_m_prev_price
        price_broke = five_m_price < five_m_prev_price
        
        # Premium entries: Level + Volume + 5m Direction
        if signal == "BUY_SUPPORT":
            if price_bounced and vol_ratio >= 1.2:
                execution_signal = "BUY_ENTRY_PREMIUM"
                entry_quality = "EXCELLENT"
                confidence = min(95, confidence + 15)
                reasons.append("  Premium: 5m bounce with strong volume")
            elif price_bounced:
                execution_signal = "BUY_ENTRY"
                entry_quality = "GOOD"
                confidence = min(95, confidence + 5)
                reasons.append("  Entry: 5m bounce confirmed")
            else:
                execution_signal = "BUY_SETUP"
                entry_quality = "WAIT"
                reasons.append("  Setup: At support, waiting for 5m bounce")
        
        elif signal == "SELL_RESISTANCE":
            if price_broke and vol_ratio >= 1.2:
                execution_signal = "SELL_ENTRY_PREMIUM"
                entry_quality = "EXCELLENT"
                confidence = min(95, confidence + 15)
                reasons.append("  Premium: 5m breakdown with strong volume")
            elif price_broke:
                execution_signal = "SELL_ENTRY"
                entry_quality = "GOOD"
                confidence = min(95, confidence + 5)
                reasons.append("  Entry: 5m breakdown confirmed")
            else:
                execution_signal = "SELL_SETUP"
                entry_quality = "WAIT"
                reasons.append("  Setup: At resistance, waiting for 5m breakdown")
        
        return {
            "signal": execution_signal,
            "base_signal": signal,
            "entry_quality": entry_quality,
            "confidence": confidence,
            "volume_ratio": vol_ratio,
            "price_action": {
                "bounced": price_bounced,
                "broke": price_broke,
            },
            "reasons": reasons,
            "camarilla_levels": camarilla_result["levels"],
        }



    """
    SuperTrend (10,2) - Trend Following Indicator (15m Analysis + 5m Execution)
    ===========================================================================
    
    SuperTrend uses ATR (Average True Range) to identify trend reversals
    
    Formula:
    - ATR (10 periods) = Average of True Range over 10 candles
    - HL Avg = (High + Low) / 2
    - Upper Band = HL Avg + (2 × ATR)
    - Lower Band = HL Avg - (2 × ATR)
    
    Signal Generation:
    - BUY: Price breaks above lower band (trend reversal upward)
    - SELL: Price breaks below upper band (trend reversal downward)
    - HOLD: Price between bands (consolidation)
    
    Strategy:
    - 15m: Calculate SuperTrend bands and current trend
    - 5m: Execute when 5m price touches/breaks bands
    - Best for: Trending markets (NIFTY, BANKNIFTY 11:30-14:00 IST)
    """
    
    @staticmethod
    def calculate_atr(
        highs: list,
        lows: list,
        closes: list,
        period: int = 10,
    ) -> float:
        """
        Calculate Average True Range (ATR)
        
        True Range = max(High - Low, |High - Close_prev|, |Low - Close_prev|)
        ATR = Average of True Range over period
        """
        if len(highs) < period or len(lows) < period or len(closes) < period:
            return 0.0
        
        true_ranges = []
        for i in range(len(highs) - period + 1, len(highs)):
            high = highs[i]
            low = lows[i]
            prev_close = closes[i - 1] if i > 0 else closes[i]
            
            tr1 = high - low
            tr2 = abs(high - prev_close)
            tr3 = abs(low - prev_close)
            
            tr = max(tr1, tr2, tr3)
            true_ranges.append(tr)
        
        if not true_ranges:
            return 0.0
        
        return sum(true_ranges[-period:]) / period
    
    @staticmethod
    def analyze_supertrend(
        current_high: float,
        current_low: float,
        current_close: float,
        prev_close: float,
        atr_value: float,
        multiplier: float = 2.0,
        current_trend: str = "BULLISH",  # Previous trend ("BULLISH" or "BEARISH")
        volume: int = None,
        avg_volume: int = None,
        timeframe: str = "5m",
    ) -> Dict[str, Any]:
        """
        Analyze SuperTrend signal (15m trend analysis + 5m execution)
        
        Args:
            current_high: Current candle high
            current_low: Current candle low
            current_close: Current candle close
            prev_close: Previous candle close
            atr_value: ATR(10) value
            multiplier: ATR multiplier (default 2.0)
            current_trend: Previous trend state
            volume: Current candle volume
            avg_volume: Average volume
            timeframe: Analysis timeframe (5m or 15m)
        
        Returns:
            Dictionary with SuperTrend signal and confidence
        """
        
        hl_avg = (current_high + current_low) / 2
        
        # Upper and Lower bands
        upper_band = hl_avg + (multiplier * atr_value)
        lower_band = hl_avg - (multiplier * atr_value)
        
        # Price position relative to bands
        price_above_upper = current_close > upper_band
        price_below_lower = current_close < lower_band
        price_between = (current_close >= lower_band) and (current_close <= upper_band)
        
        # Volume analysis
        volume_ratio = 1.0
        if volume and avg_volume and avg_volume > 0:
            volume_ratio = volume / avg_volume
        
        volume_strong = volume_ratio > 1.2
        volume_extreme = volume_ratio > 1.5
        
        signal = None
        trend = current_trend
        confidence = 0.0
        breakout_type = None
        reason = None
        
        # ====== TREND ANALYSIS ======
        
        # BULLISH REVERSAL: Price breaks above lower band
        if current_trend == "BEARISH" and price_above_upper:
            signal = "BUY_SUPERTREND"
            trend = "BULLISH"
            breakout_type = "TREND_REVERSAL_BULLISH"
            confidence = 85 if volume_strong else 75
            reason = f"SuperTrend BULLISH reversal: Price broke above upper band ({upper_band:.2f})"
        
        # BEARISH REVERSAL: Price breaks below lower band
        elif current_trend == "BULLISH" and price_below_lower:
            signal = "SELL_SUPERTREND"
            trend = "BEARISH"
            breakout_type = "TREND_REVERSAL_BEARISH"
            confidence = 85 if volume_strong else 75
            reason = f"SuperTrend BEARISH reversal: Price broke below lower band ({lower_band:.2f})"
        
        # CONTINUATION: Price stays in trend
        elif current_trend == "BULLISH" and not price_below_lower:
            # Price above lower band = bullish continuation
            if price_above_upper or price_between:
                signal = "HOLD_BULLISH"
                breakout_type = "BULLISH_CONTINUATION"
                confidence = 65 if volume_strong else 55
                reason = f"SuperTrend BULLISH intact: Price above lower band ({lower_band:.2f})"
        
        elif current_trend == "BEARISH" and not price_above_upper:
            # Price below upper band = bearish continuation
            if price_below_lower or price_between:
                signal = "HOLD_BEARISH"
                breakout_type = "BEARISH_CONTINUATION"
                confidence = 65 if volume_strong else 55
                reason = f"SuperTrend BEARISH intact: Price below upper band ({upper_band:.2f})"
        
        # CONSOLIDATION: Price between bands (no clear signal)
        else:
            signal = "NEUTRAL"
            breakout_type = "CONSOLIDATION"
            confidence = 35
            reason = f"SuperTrend CONSOLIDATION: Price between bands ({lower_band:.2f} - {upper_band:.2f})"
        
        # Apply timeframe multiplier
        multiplier = 1.0 if timeframe == "5m" else 1.1 if timeframe == "15m" else 0.85
        final_confidence = min(95, confidence * multiplier)
        
        return {
            "signal": signal,
            "trend": trend,
            "breakout_type": breakout_type,
            "upper_band": upper_band,
            "lower_band": lower_band,
            "hl_avg": hl_avg,
            "atr": atr_value,
            "base_confidence": confidence,
            "timeframe_multiplier": multiplier,
            "final_confidence": final_confidence,
            "volume_ratio": volume_ratio,
            "volume_strong": volume_strong,
            "reason": reason,
        }
    
    @staticmethod
    def combine_supertrend_with_5m_execution(
        supertrend_result: Dict[str, Any],
        five_m_close: float,
        five_m_prev_close: float,
        five_m_high: float = None,
        five_m_low: float = None,
        five_m_volume: int = None,
        five_m_avg_volume: int = None,
    ) -> Dict[str, Any]:
        """
        Enhance SuperTrend signal with 5m price action
        
        5m execution:
        - Confirms trend reversal with 5m candle
        - Validates volume spike during breakout
        - Generates entry timing
        """
        
        signal = supertrend_result["signal"]
        confidence = supertrend_result["final_confidence"]
        reasons = [supertrend_result["reason"]]
        entry_quality = "NONE"
        execution_signal = signal
        
        # 5m volume boost
        vol_ratio = 1.0
        if five_m_volume and five_m_avg_volume and five_m_avg_volume > 0:
            vol_ratio = five_m_volume / five_m_avg_volume
        
        # 5m direction
        price_moved_up = five_m_close > five_m_prev_close
        price_moved_down = five_m_close < five_m_prev_close
        
        # Premium entries: Trend reversal + Volume + 5m Direction
        if signal == "BUY_SUPERTREND":
            if price_moved_up and vol_ratio >= 1.3:
                execution_signal = "BUY_ENTRY_PREMIUM"
                entry_quality = "EXCELLENT"
                confidence = min(95, confidence + 12)
                reasons.append("  Premium: 5m breakup candle with extreme volume")
                reasons.append(f"  5m Volume: {vol_ratio:.2f}x average")
            elif price_moved_up and vol_ratio >= 1.1:
                execution_signal = "BUY_ENTRY"
                entry_quality = "GOOD"
                confidence = min(95, confidence + 5)
                reasons.append("  Entry: 5m close above SuperTrend upper band")
            else:
                execution_signal = "BUY_SETUP"
                entry_quality = "WAIT"
                reasons.append("  Setup: SuperTrend bullish, waiting for 5m breakout")
        
        elif signal == "SELL_SUPERTREND":
            if price_moved_down and vol_ratio >= 1.3:
                execution_signal = "SELL_ENTRY_PREMIUM"
                entry_quality = "EXCELLENT"
                confidence = min(95, confidence + 12)
                reasons.append("  Premium: 5m breakdown candle with extreme volume")
                reasons.append(f"  5m Volume: {vol_ratio:.2f}x average")
            elif price_moved_down and vol_ratio >= 1.1:
                execution_signal = "SELL_ENTRY"
                entry_quality = "GOOD"
                confidence = min(95, confidence + 5)
                reasons.append("  Entry: 5m close below SuperTrend lower band")
            else:
                execution_signal = "SELL_SETUP"
                entry_quality = "WAIT"
                reasons.append("  Setup: SuperTrend bearish, waiting for 5m breakdown")
        
        elif signal == "HOLD_BULLISH":
            execution_signal = "HOLD_BULLISH"
            entry_quality = "HOLD"
            reasons.append("  Action: Trend intact, hold long position")
        
        elif signal == "HOLD_BEARISH":
            execution_signal = "HOLD_BEARISH"
            entry_quality = "HOLD"
            reasons.append("  Action: Trend intact, hold short position")
        
        return {
            "signal": execution_signal,
            "base_signal": signal,
            "trend": supertrend_result["trend"],
            "entry_quality": entry_quality,
            "confidence": confidence,
            "volume_ratio": vol_ratio,
            "price_action": {
                "moved_up": price_moved_up,
                "moved_down": price_moved_down,
            },
            "bands": {
                "upper": supertrend_result["upper_band"],
                "lower": supertrend_result["lower_band"],
            },
            "reasons": reasons,
        }



    """
    Camarilla Pivot Points with CPR Zones (15m Analysis + 5m Execution)
    ====================================================================
    
    Uses Camarilla formulas to identify:
    - H3/L3 as strong resistance/support (CPR Range)
    - H4/L4 as extreme levels
    - R3/S3 as breakout confirmation zones
    
    Strategy:
    - 15m: Calculate Camarilla levels from daily/session high/low/close
    - 5m: Execute entries when price touches/breaks these levels
    - Alignment: Confirms entry quality based on price action
    
    Best for: Index trading (NIFTY, BANKNIFTY) with institutional levels
    """
    
    @staticmethod
    def calculate_camarilla_levels(
        high: float,
        low: float,
        close: float,
    ) -> Dict[str, float]:
        """
        Calculate Camarilla Pivot levels
        
        Formula:
        H = High, L = Low, C = Close
        H4 = C + 1.1 * (H - L)
        H3 = C + 0.55 * (H - L)
        H2 = C + 0.275 * (H - L)
        H1 = C + 0.1375 * (H - L)
        P = (H + L + C) / 3
        L1 = C - 0.1375 * (H - L)
        L2 = C - 0.275 * (H - L)
        L3 = C - 0.55 * (H - L)
        L4 = C - 1.1 * (H - L)
        """
        hl_range = high - low
        
        # Resistance levels
        h4 = close + 1.1 * hl_range
        h3 = close + 0.55 * hl_range
        h2 = close + 0.275 * hl_range
        h1 = close + 0.1375 * hl_range
        
        # Pivot
        pivot = (high + low + close) / 3
        
        # Support levels
        l1 = close - 0.1375 * hl_range
        l2 = close - 0.275 * hl_range
        l3 = close - 0.55 * hl_range
        l4 = close - 1.1 * hl_range
        
        return {
            "h4": round(h4, 2),
            "h3": round(h3, 2),
            "h2": round(h2, 2),
            "h1": round(h1, 2),
            "pivot": round(pivot, 2),
            "l1": round(l1, 2),
            "l2": round(l2, 2),
            "l3": round(l3, 2),
            "l4": round(l4, 2),
            "cpr_high": round(h3, 2),
            "cpr_low": round(l3, 2),
        }
    
    @staticmethod
    def analyze_camarilla_breakout(
        current_price: float,
        prev_price: float,
        levels: Dict[str, float],
        volume: int = None,
        avg_volume: int = None,
        timeframe: str = "5m",
    ) -> Dict[str, Any]:
        """
        Analyze Camarilla breakout/support signals (5m execution)
        
        Args:
            current_price: Current 5m price
            prev_price: Previous 5m price
            levels: Camarilla levels (from 15m)
            volume: Current candle volume
            avg_volume: Average volume
            timeframe: Analysis timeframe (5m, 15m, etc)
        
        Returns:
            Dictionary with entry signal and confidence
        """
        
        signal = None
        reason = None
        confidence = 0.0
        breakout_type = None
        level_touched = None
        
        # Volume analysis
        volume_ratio = 1.0
        if volume and avg_volume and avg_volume > 0:
            volume_ratio = volume / avg_volume
        
        volume_strong = volume_ratio > 1.2
        
        # Price direction
        price_up = current_price > prev_price
        price_down = current_price < prev_price
        
        # Define tolerance for "at level" (1% proximity = realistic for trading)
        tolerance_pct = 0.01
        tolerance_points = current_price * tolerance_pct  # 1% of current price
        
        # Find closest level to current price
        all_levels = {
            "h4": levels["h4"],
            "h3": levels["h3"],
            "h2": levels["h2"],
            "h1": levels["h1"],
            "pivot": levels["pivot"],
            "l1": levels["l1"],
            "l2": levels["l2"],
            "l3": levels["l3"],
            "l4": levels["l4"],
        }
        
        # Find which level is closest
        closest_level = min(all_levels.items(), key=lambda x: abs(x[1] - current_price))
        closest_name, closest_value = closest_level
        distance_to_closest = abs(closest_value - current_price)
        is_at_level = distance_to_closest <= tolerance_points
        
        # Only process if price is actually at a level (within tolerance)
        if not is_at_level:
            signal = "HOLD"
            breakout_type = "NO_LEVEL"
            level_touched = None
            confidence = 0
            reason = f"Price not at key Camarilla levels (closest: {closest_name}={closest_value})"
        
        # ====== RESISTANCE LEVELS ======
        elif closest_name == "h4" and price_up and prev_price <= levels["h4"]:
            signal = "SELL_BREAKOUT"
            breakout_type = "H4_BREAKOUT_UP"
            level_touched = "H4"
            confidence = 65 if volume_strong else 55
            reason = f"Price broke above H4 ({levels['h4']}) - Extreme resistance breakout"
        
        elif closest_name == "h3":
            signal = "SELL_RESISTANCE"
            breakout_type = "H3_TOUCH_STRONG"
            level_touched = "H3"
            confidence = 75 if volume_strong else 65
            reason = f"Price at H3 ({levels['h3']}) - Strong resistance (CPR range)"
        
        elif closest_name == "h2":
            signal = "SELL_WEAK"
            breakout_type = "H2_TOUCH_WEAK"
            level_touched = "H2"
            confidence = 45
            reason = f"Price at H2 ({levels['h2']}) - Weak resistance"
        
        elif closest_name == "h1":
            signal = "SELL_WEAK"
            breakout_type = "H1_TOUCH_VERY_WEAK"
            level_touched = "H1"
            confidence = 30
            reason = f"Price at H1 ({levels['h1']}) - Very weak resistance (noise)"
        
        # ====== SUPPORT LEVELS ======
        elif closest_name == "l4" and price_down and prev_price >= levels["l4"]:
            signal = "BUY_SUPPORT"
            breakout_type = "L4_TOUCH_EXTREME"
            level_touched = "L4"
            confidence = 65 if volume_strong else 55
            reason = f"Price touched L4 ({levels['l4']}) - Extreme support (bounce expected)"
        
        elif closest_name == "l3":
            signal = "BUY_SUPPORT"
            breakout_type = "L3_TOUCH_STRONG"
            level_touched = "L3"
            confidence = 85 if volume_strong else 75
            reason = f"Price at L3 ({levels['l3']}) - Strong support (CPR range - BEST entry)"
        
        elif closest_name == "l2":
            signal = "BUY_SUPPORT"
            breakout_type = "L2_TOUCH_WEAKNESS"
            level_touched = "L2"
            confidence = 55
            reason = f"Price at L2 ({levels['l2']}) - Intermediate support"
        
        elif closest_name == "l1":
            signal = "BUY_SUPPORT"
            breakout_type = "L1_TOUCH_WEAK"
            level_touched = "L1"
            confidence = 40
            reason = f"Price at L1 ({levels['l1']}) - Weak support"
        
        # ====== PIVOT AREA ======
        elif closest_name == "pivot":
            signal = "NEUTRAL"
            breakout_type = "PIVOT_NEUTRAL"
            level_touched = "PIVOT"
            confidence = 35
            reason = f"Price at PIVOT ({levels['pivot']}) - Neutral zone (wait for breakout)"
        
        # Apply timeframe multiplier
        multiplier = 1.0 if timeframe == "5m" else 1.1 if timeframe == "15m" else 0.85
        final_confidence = min(95, confidence * multiplier)
        
        return {
            "signal": signal,
            "level_touched": level_touched,
            "breakout_type": breakout_type,
            "base_confidence": confidence,
            "timeframe_multiplier": multiplier,
            "final_confidence": final_confidence,
            "volume_ratio": volume_ratio,
            "volume_strong": volume_strong,
            "reason": reason,
            "levels": levels,
        }
    
    @staticmethod
    def combine_camarilla_with_5m_execution(
        camarilla_result: Dict[str, Any],
        five_m_price: float,
        five_m_prev_price: float,
        five_m_volume: int = None,
        five_m_avg_volume: int = None,
    ) -> Dict[str, Any]:
        """
        Enhance Camarilla signal with 5m price action
        
        5m execution:
        - Confirms level touch with 5m candlestick
        - Validates volume during touch
        - Generates entry timing
        """
        
        signal = camarilla_result["signal"]
        confidence = camarilla_result["final_confidence"]
        reasons = [camarilla_result["reason"]]
        entry_quality = "NONE"
        execution_signal = signal
        
        # 5m volume boost
        vol_ratio = 1.0
        if five_m_volume and five_m_avg_volume and five_m_avg_volume > 0:
            vol_ratio = five_m_volume / five_m_avg_volume
        
        # 5m direction
        price_bounced = five_m_price > five_m_prev_price
        price_broke = five_m_price < five_m_prev_price
        
        # Premium entries: Level + Volume + 5m Direction
        if signal == "BUY_SUPPORT":
            if price_bounced and vol_ratio >= 1.2:
                execution_signal = "BUY_ENTRY_PREMIUM"
                entry_quality = "EXCELLENT"
                confidence = min(95, confidence + 15)
                reasons.append("  Premium: 5m bounce with strong volume")
            elif price_bounced:
                execution_signal = "BUY_ENTRY"
                entry_quality = "GOOD"
                confidence = min(95, confidence + 5)
                reasons.append("  Entry: 5m bounce confirmed")
            else:
                execution_signal = "BUY_SETUP"
                entry_quality = "WAIT"
                reasons.append("  Setup: At support, waiting for 5m bounce")
        
        elif signal == "SELL_RESISTANCE":
            if price_broke and vol_ratio >= 1.2:
                execution_signal = "SELL_ENTRY_PREMIUM"
                entry_quality = "EXCELLENT"
                confidence = min(95, confidence + 15)
                reasons.append("  Premium: 5m breakdown with strong volume")
            elif price_broke:
                execution_signal = "SELL_ENTRY"
                entry_quality = "GOOD"
                confidence = min(95, confidence + 5)
                reasons.append("  Entry: 5m breakdown confirmed")
            else:
                execution_signal = "SELL_SETUP"
                entry_quality = "WAIT"
                reasons.append("  Setup: At resistance, waiting for 5m breakdown")
        
        return {
            "signal": execution_signal,
            "base_signal": signal,
            "entry_quality": entry_quality,
            "confidence": confidence,
            "volume_ratio": vol_ratio,
            "price_action": {
                "bounced": price_bounced,
                "broke": price_broke,
            },
            "reasons": reasons,
            "camarilla_levels": camarilla_result["levels"],
        }


class SuperTrendFilter:
    """
    SuperTrend (10,2) - Trend Following Indicator (15m Analysis + 5m Execution)
    ===========================================================================
    
    SuperTrend uses ATR (Average True Range) to identify trend reversals
    
    Formula:
    - ATR (10 periods) = Average of True Range over 10 candles
    - HL Avg = (High + Low) / 2
    - Upper Band = HL Avg + (2 × ATR)
    - Lower Band = HL Avg - (2 × ATR)
    
    Signal Generation:
    - BUY: Price breaks above lower band (trend reversal upward)
    - SELL: Price breaks below upper band (trend reversal downward)
    - HOLD: Price between bands (consolidation)
    
    Strategy:
    - 15m: Calculate SuperTrend bands and current trend
    - 5m: Execute when 5m price touches/breaks bands
    - Best for: Trending markets (NIFTY, BANKNIFTY 11:30-14:00 IST)
    """
    
    @staticmethod
    def calculate_atr(
        highs: list,
        lows: list,
        closes: list,
        period: int = 10,
    ) -> float:
        """
        Calculate Average True Range (ATR)
        
        True Range = max(High - Low, |High - Close_prev|, |Low - Close_prev|)
        ATR = Average of True Range over period
        """
        if len(highs) < period or len(lows) < period or len(closes) < period:
            return 0.0
        
        true_ranges = []
        for i in range(len(highs) - period + 1, len(highs)):
            high = highs[i]
            low = lows[i]
            prev_close = closes[i - 1] if i > 0 else closes[i]
            
            tr1 = high - low
            tr2 = abs(high - prev_close)
            tr3 = abs(low - prev_close)
            
            tr = max(tr1, tr2, tr3)
            true_ranges.append(tr)
        
        if not true_ranges:
            return 0.0
        
        return sum(true_ranges[-period:]) / period
    
    @staticmethod
    def analyze_supertrend(
        current_high: float,
        current_low: float,
        current_close: float,
        prev_close: float,
        atr_value: float,
        multiplier: float = 2.0,
        current_trend: str = "BULLISH",  # Previous trend ("BULLISH" or "BEARISH")
        volume: int = None,
        avg_volume: int = None,
        timeframe: str = "5m",
    ) -> Dict[str, Any]:
        """
        Analyze SuperTrend signal (15m trend analysis + 5m execution)
        
        Args:
            current_high: Current candle high
            current_low: Current candle low
            current_close: Current candle close
            prev_close: Previous candle close
            atr_value: ATR(10) value
            multiplier: ATR multiplier (default 2.0)
            current_trend: Previous trend state
            volume: Current candle volume
            avg_volume: Average volume
            timeframe: Analysis timeframe (5m or 15m)
        
        Returns:
            Dictionary with SuperTrend signal and confidence
        """
        
        hl_avg = (current_high + current_low) / 2
        
        # Upper and Lower bands
        upper_band = hl_avg + (multiplier * atr_value)
        lower_band = hl_avg - (multiplier * atr_value)
        
        # Price position relative to bands
        price_above_upper = current_close > upper_band
        price_below_lower = current_close < lower_band
        price_between = (current_close >= lower_band) and (current_close <= upper_band)
        
        # Volume analysis
        volume_ratio = 1.0
        if volume and avg_volume and avg_volume > 0:
            volume_ratio = volume / avg_volume
        
        volume_strong = volume_ratio > 1.2
        volume_extreme = volume_ratio > 1.5
        
        signal = None
        trend = current_trend
        confidence = 0.0
        breakout_type = None
        reason = None
        
        # ====== TREND ANALYSIS ======
        
        # BULLISH REVERSAL: Price breaks above lower band
        if current_trend == "BEARISH" and price_above_upper:
            signal = "BUY_SUPERTREND"
            trend = "BULLISH"
            breakout_type = "TREND_REVERSAL_BULLISH"
            confidence = 85 if volume_strong else 75
            reason = f"SuperTrend BULLISH reversal: Price broke above upper band ({upper_band:.2f})"
        
        # BEARISH REVERSAL: Price breaks below lower band
        elif current_trend == "BULLISH" and price_below_lower:
            signal = "SELL_SUPERTREND"
            trend = "BEARISH"
            breakout_type = "TREND_REVERSAL_BEARISH"
            confidence = 85 if volume_strong else 75
            reason = f"SuperTrend BEARISH reversal: Price broke below lower band ({lower_band:.2f})"
        
        # CONTINUATION: Price stays in trend
        elif current_trend == "BULLISH" and not price_below_lower:
            # Price above lower band = bullish continuation
            if price_above_upper or price_between:
                signal = "HOLD_BULLISH"
                breakout_type = "BULLISH_CONTINUATION"
                confidence = 65 if volume_strong else 55
                reason = f"SuperTrend BULLISH intact: Price above lower band ({lower_band:.2f})"
        
        elif current_trend == "BEARISH" and not price_above_upper:
            # Price below upper band = bearish continuation
            if price_below_lower or price_between:
                signal = "HOLD_BEARISH"
                breakout_type = "BEARISH_CONTINUATION"
                confidence = 65 if volume_strong else 55
                reason = f"SuperTrend BEARISH intact: Price below upper band ({upper_band:.2f})"
        
        # CONSOLIDATION: Price between bands (no clear signal)
        else:
            signal = "NEUTRAL"
            breakout_type = "CONSOLIDATION"
            confidence = 35
            reason = f"SuperTrend CONSOLIDATION: Price between bands ({lower_band:.2f} - {upper_band:.2f})"
        
        # Apply timeframe multiplier
        multiplier = 1.0 if timeframe == "5m" else 1.1 if timeframe == "15m" else 0.85
        final_confidence = min(95, confidence * multiplier)
        
        return {
            "signal": signal,
            "trend": trend,
            "breakout_type": breakout_type,
            "upper_band": upper_band,
            "lower_band": lower_band,
            "hl_avg": hl_avg,
            "atr": atr_value,
            "base_confidence": confidence,
            "timeframe_multiplier": multiplier,
            "final_confidence": final_confidence,
            "volume_ratio": volume_ratio,
            "volume_strong": volume_strong,
            "reason": reason,
        }
    
    @staticmethod
    def combine_supertrend_with_5m_execution(
        supertrend_result: Dict[str, Any],
        five_m_close: float,
        five_m_prev_close: float,
        five_m_high: float = None,
        five_m_low: float = None,
        five_m_volume: int = None,
        five_m_avg_volume: int = None,
    ) -> Dict[str, Any]:
        """
        Enhance SuperTrend signal with 5m price action
        
        5m execution:
        - Confirms trend reversal with 5m candle
        - Validates volume spike during breakout
        - Generates entry timing
        """
        
        signal = supertrend_result["signal"]
        confidence = supertrend_result["final_confidence"]
        reasons = [supertrend_result["reason"]]
        entry_quality = "NONE"
        execution_signal = signal
        
        # 5m volume boost
        vol_ratio = 1.0
        if five_m_volume and five_m_avg_volume and five_m_avg_volume > 0:
            vol_ratio = five_m_volume / five_m_avg_volume
        
        # 5m direction
        price_moved_up = five_m_close > five_m_prev_close
        price_moved_down = five_m_close < five_m_prev_close
        
        # Premium entries: Trend reversal + Volume + 5m Direction
        if signal == "BUY_SUPERTREND":
            if price_moved_up and vol_ratio >= 1.3:
                execution_signal = "BUY_ENTRY_PREMIUM"
                entry_quality = "EXCELLENT"
                confidence = min(95, confidence + 12)
                reasons.append("  Premium: 5m breakup candle with extreme volume")
                reasons.append(f"  5m Volume: {vol_ratio:.2f}x average")
            elif price_moved_up and vol_ratio >= 1.1:
                execution_signal = "BUY_ENTRY"
                entry_quality = "GOOD"
                confidence = min(95, confidence + 5)
                reasons.append("  Entry: 5m close above SuperTrend upper band")
            else:
                execution_signal = "BUY_SETUP"
                entry_quality = "WAIT"
                reasons.append("  Setup: SuperTrend bullish, waiting for 5m breakout")
        
        elif signal == "SELL_SUPERTREND":
            if price_moved_down and vol_ratio >= 1.3:
                execution_signal = "SELL_ENTRY_PREMIUM"
                entry_quality = "EXCELLENT"
                confidence = min(95, confidence + 12)
                reasons.append("  Premium: 5m breakdown candle with extreme volume")
                reasons.append(f"  5m Volume: {vol_ratio:.2f}x average")
            elif price_moved_down and vol_ratio >= 1.1:
                execution_signal = "SELL_ENTRY"
                entry_quality = "GOOD"
                confidence = min(95, confidence + 5)
                reasons.append("  Entry: 5m close below SuperTrend lower band")
            else:
                execution_signal = "SELL_SETUP"
                entry_quality = "WAIT"
                reasons.append("  Setup: SuperTrend bearish, waiting for 5m breakdown")
        
        elif signal == "HOLD_BULLISH":
            execution_signal = "HOLD_BULLISH"
            entry_quality = "HOLD"
            reasons.append("  Action: Trend intact, hold long position")
        
        elif signal == "HOLD_BEARISH":
            execution_signal = "HOLD_BEARISH"
            entry_quality = "HOLD"
            reasons.append("  Action: Trend intact, hold short position")
        
        return {
            "signal": execution_signal,
            "base_signal": signal,
            "trend": supertrend_result["trend"],
            "entry_quality": entry_quality,
            "confidence": confidence,
            "volume_ratio": vol_ratio,
            "price_action": {
                "moved_up": price_moved_up,
                "moved_down": price_moved_down,
            },
            "bands": {
                "upper": supertrend_result["upper_band"],
                "lower": supertrend_result["lower_band"],
            },
            "reasons": reasons,
        }


class ParabolicSARFilter:
    """
    Parabolic SAR (Stop And Reverse) - Trend Following with Dynamic Stops (15m Analysis + 5m Execution)
    ================================================================================================
    
    Parabolic SAR identifies trend reversals and provides dynamic stop-loss levels
    
    Formula:
    - SAR (Stop And Reverse) = SAR_prev + AF × (EP - SAR_prev)
    - AF (Acceleration Factor) = starts at 0.02, increases by 0.02 each new extreme, max 0.20
    - EP (Extreme Point) = highest high (uptrend) or lowest low (downtrend)
    
    Signal Generation:
    - BUY: Price crosses above SAR (bullish reversal)
    - SELL: Price crosses below SAR (bearish reversal)
    - HOLD: Price stays in trend direction (continuations)
    
    Strategy:
    - 15m: Calculate SAR levels and trend continuity
    - 5m: Execute when 5m price confirms SAR reversal + volume
    - Best for: Trending markets (NIFTY, BANKNIFTY 11:30-14:00 IST)
    - Price continuity: 15m SAR very smooth, gives clean trends
    """
    
    @staticmethod
    def calculate_sar(
        highs: list,
        lows: list,
        closes: list,
        af_start: float = 0.02,
        af_increment: float = 0.02,
        af_max: float = 0.20,
    ) -> Dict[str, Any]:
        """
        Calculate Parabolic SAR values
        
        Args:
            highs: List of high prices (must have at least 2 values)
            lows: List of low prices
            closes: List of close prices
            af_start: Initial Acceleration Factor
            af_increment: AF increment per new extreme
            af_max: Maximum AF value
        
        Returns:
            Dictionary with SAR values, trend, and extreme points
        """
        
        if len(highs) < 2 or len(lows) < 2 or len(closes) < 2:
            return {
                "sar": 0.0,
                "ep": 0.0,
                "af": af_start,
                "trend": "UNKNOWN",
                "reversal": False,
            }
        
        # Initialize SAR calculation
        sar_list = []
        af_list = []
        ep_list = []
        trend_list = []
        reversal_detected = False
        
        # Determine initial trend from first two candles
        if closes[-2] <= closes[-1]:
            trend = "UPTREND"
            sar = min(lows[-2], lows[-1])
            ep = max(highs[-2], highs[-1])
        else:
            trend = "DOWNTREND"
            sar = max(highs[-2], highs[-1])
            ep = min(lows[-2], lows[-1])
        
        af = af_start
        
        # Calculate SAR for each candle (simplified - using last 5 for quick calc)
        lookback = min(5, len(closes))
        
        for i in range(max(0, len(closes) - lookback), len(closes)):
            high = highs[i]
            low = lows[i]
            close = closes[i]
            
            # Update SAR
            sar = sar + af * (ep - sar)
            
            # Check for trend reversal
            if trend == "UPTREND":
                # SAR should be below price in uptrend
                if close < sar:
                    trend = "DOWNTREND"
                    reversal_detected = True
                    sar = ep
                    ep = low
                    af = af_start
                else:
                    # Update extreme point and AF
                    if high > ep:
                        ep = high
                        af = min(af + af_increment, af_max)
                    # SAR never goes above prior two lows
                    if i >= 1:
                        sar = min(sar, lows[i-1])
                    if i >= 2:
                        sar = min(sar, lows[i-2])
            
            else:  # DOWNTREND
                # SAR should be above price in downtrend
                if close > sar:
                    trend = "UPTREND"
                    reversal_detected = True
                    sar = ep
                    ep = high
                    af = af_start
                else:
                    # Update extreme point and AF
                    if low < ep:
                        ep = low
                        af = min(af + af_increment, af_max)
                    # SAR never goes below prior two highs
                    if i >= 1:
                        sar = max(sar, highs[i-1])
                    if i >= 2:
                        sar = max(sar, highs[i-2])
            
            sar_list.append(sar)
            af_list.append(af)
            ep_list.append(ep)
            trend_list.append(trend)
        
        current_sar = sar_list[-1] if sar_list else sar
        current_af = af_list[-1] if af_list else af
        current_ep = ep_list[-1] if ep_list else ep
        current_trend = trend_list[-1] if trend_list else trend
        
        return {
            "sar": current_sar,
            "ep": current_ep,
            "af": current_af,
            "trend": current_trend,
            "reversal": reversal_detected,
            "sar_history": sar_list,
            "trend_history": trend_list,
        }
    
    @staticmethod
    def analyze_psar(
        current_high: float,
        current_low: float,
        current_close: float,
        prev_close: float,
        sar_data: Dict[str, Any],
        volume: int = None,
        avg_volume: int = None,
        timeframe: str = "5m",
    ) -> Dict[str, Any]:
        """
        Analyze Parabolic SAR signal (15m analysis + 5m execution)
        
        Args:
            current_high: Current candle high
            current_low: Current candle low
            current_close: Current candle close
            prev_close: Previous candle close
            sar_data: SAR calculation data from calculate_sar()
            volume: Current candle volume
            avg_volume: Average volume
            timeframe: Analysis timeframe (5m or 15m)
        
        Returns:
            Dictionary with PSAR signal and confidence
        """
        
        sar = sar_data.get("sar", 0.0)
        trend = sar_data.get("trend", "UNKNOWN")
        reversal = sar_data.get("reversal", False)
        
        # Price position relative to SAR
        price_above_sar = current_close > sar
        price_below_sar = current_close < sar
        
        # Volume analysis
        volume_ratio = 1.0
        if volume and avg_volume and avg_volume > 0:
            volume_ratio = volume / avg_volume
        
        volume_strong = volume_ratio > 1.2
        volume_extreme = volume_ratio > 1.5
        
        signal = None
        confidence = 0.0
        reason = None
        
        # ====== REVERSAL SIGNALS ======
        
        # BULLISH REVERSAL: Trend just reversed to UPTREND (from DOWNTREND)
        # After reversal, trend is already UPTREND, so check trend==UPTREND and reversal=True
        if trend == "UPTREND" and price_above_sar and reversal:
            signal = "BUY_PSAR"
            confidence = 85 if volume_strong else 75
            reason = f"Parabolic SAR BULLISH reversal: Price crossed above SAR ({sar:.2f})"
        
        # BEARISH REVERSAL: Trend just reversed to DOWNTREND (from UPTREND)
        # After reversal, trend is already DOWNTREND, so check trend==DOWNTREND and reversal=True
        elif trend == "DOWNTREND" and price_below_sar and reversal:
            signal = "SELL_PSAR"
            confidence = 85 if volume_strong else 75
            reason = f"Parabolic SAR BEARISH reversal: Price crossed below SAR ({sar:.2f})"
        
        # CONTINUATION: Price stays in trend direction (no reversal)
        elif trend == "UPTREND" and price_above_sar and not reversal:
            signal = "HOLD_BULLISH"
            confidence = 70 if volume_strong else 60
            reason = f"Parabolic SAR BULLISH trend: Price above SAR ({sar:.2f})"
        
        elif trend == "DOWNTREND" and price_below_sar and not reversal:
            signal = "HOLD_BEARISH"
            confidence = 70 if volume_strong else 60
            reason = f"Parabolic SAR BEARISH trend: Price below SAR ({sar:.2f})"
        
        # NO SIGNAL: Undefined state
        else:
            signal = "NEUTRAL"
            confidence = 35
            reason = f"Parabolic SAR NEUTRAL: Trend={trend}, Price vs SAR unclear"
        
        # Apply timeframe multiplier
        multiplier = 1.0 if timeframe == "5m" else 1.1 if timeframe == "15m" else 0.85
        final_confidence = min(95, confidence * multiplier)
        
        return {
            "signal": signal,
            "trend": trend,
            "reversal": reversal,
            "sar": sar,
            "af": sar_data.get("af", 0.02),
            "ep": sar_data.get("ep", 0.0),
            "base_confidence": confidence,
            "timeframe_multiplier": multiplier,
            "final_confidence": final_confidence,
            "volume_ratio": volume_ratio,
            "volume_strong": volume_strong,
            "reason": reason,
        }
    
    @staticmethod
    def combine_psar_with_5m_execution(
        psar_result: Dict[str, Any],
        five_m_close: float,
        five_m_prev_close: float,
        five_m_high: float = None,
        five_m_low: float = None,
        five_m_volume: int = None,
        five_m_avg_volume: int = None,
    ) -> Dict[str, Any]:
        """
        Enhance Parabolic SAR signal with 5m price action
        
        5m execution:
        - Confirms trend reversal with 5m candle
        - Validates volume spike during SAR crossover
        - Generates entry timing
        """
        
        signal = psar_result["signal"]
        confidence = psar_result["final_confidence"]
        reasons = [psar_result["reason"]]
        entry_quality = "NONE"
        execution_signal = signal
        
        # 5m volume boost
        vol_ratio = 1.0
        if five_m_volume and five_m_avg_volume and five_m_avg_volume > 0:
            vol_ratio = five_m_volume / five_m_avg_volume
        
        # 5m direction
        price_moved_up = five_m_close > five_m_prev_close
        price_moved_down = five_m_close < five_m_prev_close
        
        # Premium entries: SAR Reversal + Volume + 5m Direction
        if signal == "BUY_PSAR":
            if price_moved_up and vol_ratio >= 1.3:
                execution_signal = "BUY_ENTRY_PREMIUM"
                entry_quality = "EXCELLENT"
                confidence = min(95, confidence + 12)
                reasons.append("  Premium: 5m breakup from SAR with extreme volume")
                reasons.append(f"  5m Volume: {vol_ratio:.2f}x average")
            elif price_moved_up and vol_ratio >= 1.1:
                execution_signal = "BUY_ENTRY"
                entry_quality = "GOOD"
                confidence = min(95, confidence + 5)
                reasons.append("  Entry: 5m close above Parabolic SAR level")
            else:
                execution_signal = "BUY_SETUP"
                entry_quality = "WAIT"
                reasons.append("  Setup: SAR bullish, waiting for 5m confirmation")
        
        elif signal == "SELL_PSAR":
            if price_moved_down and vol_ratio >= 1.3:
                execution_signal = "SELL_ENTRY_PREMIUM"
                entry_quality = "EXCELLENT"
                confidence = min(95, confidence + 12)
                reasons.append("  Premium: 5m breakdown from SAR with extreme volume")
                reasons.append(f"  5m Volume: {vol_ratio:.2f}x average")
            elif price_moved_down and vol_ratio >= 1.1:
                execution_signal = "SELL_ENTRY"
                entry_quality = "GOOD"
                confidence = min(95, confidence + 5)
                reasons.append("  Entry: 5m close below Parabolic SAR level")
            else:
                execution_signal = "SELL_SETUP"
                entry_quality = "WAIT"
                reasons.append("  Setup: SAR bearish, waiting for 5m confirmation")
        
        # Continuations: Hold the trend
        elif signal in ["HOLD_BULLISH", "HOLD_BEARISH"]:
            execution_signal = signal
            entry_quality = "HOLD"
            reasons.append(f"  Trend: SAR {psar_result['trend']} intact, hold position")
        
        else:
            execution_signal = "NEUTRAL"
            entry_quality = "NONE"
            confidence = 35
            reasons.append("  No clear SAR signal, wait for trend clarity")
        
        return {
            "signal": execution_signal,
            "base_signal": signal,
            "trend": psar_result["trend"],
            "entry_quality": entry_quality,
            "confidence": confidence,
            "volume_ratio": vol_ratio,
            "sar_level": psar_result["sar"],
            "stop_loss": psar_result["sar"],  # SAR acts as stop-loss
            "price_action": {
                "moved_up": price_moved_up,
                "moved_down": price_moved_down,
            },
            "reasons": reasons,
        }


class ClassicPivotFilter:
    """
    Classic Pivot Points (S3/R3 Zones) - Support/Resistance Levels (15m Analysis + 5m Execution)
    ===========================================================================================
    
    Classic Pivots calculate key support/resistance levels from previous day's data
    
    Formula:
    - Pivot Point (P) = (High + Low + Close) / 3
    - Resistance 1 (R1) = (2 × P) - Low
    - Support 1 (S1) = (2 × P) - High
    - Resistance 2 (R2) = P + (High - Low)
    - Support 2 (S2) = P - (High - Low)
    - Resistance 3 (R3) = P + 2×(High - Low)
    - Support 3 (S3) = P - 2×(High - Low)
    
    Signal Generation:
    - BUY: Price touches S3 (extreme support) → bounce expected
    - SELL: Price touches R3 (extreme resistance) → rejection expected
    - BUY_SUPPORT: Price at S1/S2 support zones
    - SELL_RESISTANCE: Price at R1/R2 resistance zones
    
    Strategy:
    - 15m: Calculate pivot levels and zone proximity
    - 5m: Execute when 5m price approaches/touches zone + volume
    - Best for: Mean-reversion in range-bound markets (11:30-13:30 IST)
    - Zone reading: Clean reactions at classic pivot points
    """
    
    @staticmethod
    def calculate_classic_pivots(
        prev_high: float,
        prev_low: float,
        prev_close: float,
    ) -> Dict[str, Any]:
        """
        Calculate classic pivot points
        
        Args:
            prev_high: Previous period high
            prev_low: Previous period low
            prev_close: Previous period close
        
        Returns:
            Dictionary with all pivot levels
        """
        
        p = (prev_high + prev_low + prev_close) / 3
        r1 = (2 * p) - prev_low
        s1 = (2 * p) - prev_high
        r2 = p + (prev_high - prev_low)
        s2 = p - (prev_high - prev_low)
        r3 = p + 2 * (prev_high - prev_low)
        s3 = p - 2 * (prev_high - prev_low)
        
        return {
            "pivot": p,
            "r1": r1,
            "r2": r2,
            "r3": r3,
            "s1": s1,
            "s2": s2,
            "s3": s3,
            "range": prev_high - prev_low,
        }
    
    @staticmethod
    def find_closest_level(
        price: float,
        levels: Dict[str, float],
        tolerance: float = 0.01,  # 1% tolerance
    ) -> tuple:
        """
        Find which pivot level is closest to price
        
        Returns: (level_name, level_value, distance_pct, is_at_level)
        """
        
        level_names = ["r3", "r2", "r1", "pivot", "s1", "s2", "s3"]
        closest_name = None
        closest_distance = float('inf')
        closest_value = None
        
        for name in level_names:
            if name in levels:
                level_val = levels[name]
                distance = abs(price - level_val)
                distance_pct = (distance / price) * 100
                
                if distance_pct < closest_distance:
                    closest_distance = distance_pct
                    closest_name = name
                    closest_value = level_val
        
        # Check if price is AT the level (within tolerance)
        is_at_level = closest_distance <= tolerance
        
        return closest_name, closest_value, closest_distance, is_at_level
    
    @staticmethod
    def analyze_classic_pivot(
        current_high: float,
        current_low: float,
        current_close: float,
        prev_close: float,
        levels: Dict[str, float],
        volume: int = None,
        avg_volume: int = None,
        timeframe: str = "5m",
    ) -> Dict[str, Any]:
        """
        Analyze classic pivot signal (15m level detection + 5m execution)
        
        Args:
            current_high: Current candle high
            current_low: Current candle low
            current_close: Current candle close
            prev_close: Previous candle close
            levels: Classic pivot levels from calculate_classic_pivots()
            volume: Current candle volume
            avg_volume: Average volume
            timeframe: Analysis timeframe (5m or 15m)
        
        Returns:
            Dictionary with pivot signal and confidence
        """
        
        closest_name, closest_value, distance_pct, is_at_level = ClassicPivotFilter.find_closest_level(
            current_close, levels, tolerance=0.01
        )
        
        # Volume analysis
        volume_ratio = 1.0
        if volume and avg_volume and avg_volume > 0:
            volume_ratio = volume / avg_volume
        
        volume_strong = volume_ratio > 1.2
        volume_extreme = volume_ratio > 1.5
        
        signal = None
        confidence = 0.0
        level_touched = None
        reason = None
        
        # ====== EXTREME ZONES (S3/R3 - Bounce/Rejection Expected) ======
        
        # STRONG SUPPORT: Price at S3 (extreme support)
        if is_at_level and closest_name == "s3":
            signal = "BUY_SUPPORT"
            level_touched = "S3"
            confidence = 90 if volume_extreme else 80
            reason = f"Price at S3 ({closest_value:.2f}) - Extreme support (bounce expected)"
        
        # STRONG RESISTANCE: Price at R3 (extreme resistance)
        elif is_at_level and closest_name == "r3":
            signal = "SELL_RESISTANCE"
            level_touched = "R3"
            confidence = 90 if volume_extreme else 80
            reason = f"Price at R3 ({closest_value:.2f}) - Extreme resistance (rejection expected)"
        
        # ====== SECONDARY ZONES (S2/R2 - Mean Reversion) ======
        
        elif is_at_level and closest_name == "s2":
            signal = "BUY_SUPPORT"
            level_touched = "S2"
            confidence = 75 if volume_strong else 65
            reason = f"Price at S2 ({closest_value:.2f}) - Secondary support (mean reversion zone)"
        
        elif is_at_level and closest_name == "r2":
            signal = "SELL_RESISTANCE"
            level_touched = "R2"
            confidence = 75 if volume_strong else 65
            reason = f"Price at R2 ({closest_value:.2f}) - Secondary resistance (mean reversion zone)"
        
        # ====== PRIMARY ZONES (S1/R1) ======
        
        elif is_at_level and closest_name == "s1":
            signal = "BUY_SUPPORT"
            level_touched = "S1"
            confidence = 60 if volume_strong else 50
            reason = f"Price at S1 ({closest_value:.2f}) - Primary support (weak)"
        
        elif is_at_level and closest_name == "r1":
            signal = "SELL_RESISTANCE"
            level_touched = "R1"
            confidence = 60 if volume_strong else 50
            reason = f"Price at R1 ({closest_value:.2f}) - Primary resistance (weak)"
        
        # ====== PIVOT NEUTRAL ZONE ======
        
        elif is_at_level and closest_name == "pivot":
            signal = "NEUTRAL"
            level_touched = "PIVOT"
            confidence = 35
            reason = f"Price at PIVOT ({closest_value:.2f}) - Neutral zone (wait for breakout)"
        
        # ====== NO LEVEL (Between zones) ======
        
        else:
            signal = "NEUTRAL"
            level_touched = closest_name.upper() if closest_name else "NONE"
            confidence = 35
            reason = f"Price between levels (closest: {closest_name}={closest_value:.2f})"
        
        # Apply timeframe multiplier
        multiplier = 1.0 if timeframe == "5m" else 1.1 if timeframe == "15m" else 0.85
        final_confidence = min(95, confidence * multiplier)
        
        return {
            "signal": signal,
            "level_touched": level_touched,
            "closest_level": closest_name,
            "closest_value": closest_value,
            "distance_pct": distance_pct,
            "base_confidence": confidence,
            "timeframe_multiplier": multiplier,
            "final_confidence": final_confidence,
            "volume_ratio": volume_ratio,
            "volume_strong": volume_strong,
            "is_at_level": is_at_level,
            "reason": reason,
            "levels": levels,
        }
    
    @staticmethod
    def combine_pivot_with_5m_execution(
        pivot_result: Dict[str, Any],
        five_m_high: float,
        five_m_low: float,
        five_m_close: float,
        five_m_prev_close: float,
        five_m_volume: int = None,
        five_m_avg_volume: int = None,
    ) -> Dict[str, Any]:
        """
        Enhance classic pivot signal with 5m price action
        
        5m execution:
        - Confirms level touch with 5m candle structure
        - Validates volume during entry
        - Generates entry timing
        """
        
        signal = pivot_result["signal"]
        confidence = pivot_result["final_confidence"]
        reasons = [pivot_result["reason"]]
        entry_quality = "NONE"
        execution_signal = signal
        level_touched = pivot_result["level_touched"]
        
        # 5m volume boost
        vol_ratio = 1.0
        if five_m_volume and five_m_avg_volume and five_m_avg_volume > 0:
            vol_ratio = five_m_volume / five_m_avg_volume
        
        # 5m direction
        price_moved_up = five_m_close > five_m_prev_close
        price_moved_down = five_m_close < five_m_prev_close
        price_bounced_up = five_m_low < pivot_result["closest_value"] and five_m_close > five_m_prev_close
        price_bounced_down = five_m_high > pivot_result["closest_value"] and five_m_close < five_m_prev_close
        
        # Premium entries: Level Touch + Volume + 5m Direction
        if signal == "BUY_SUPPORT":
            if price_bounced_up and vol_ratio >= 1.3:
                execution_signal = "BUY_ENTRY_PREMIUM"
                entry_quality = "EXCELLENT"
                confidence = min(95, confidence + 15)
                reasons.append(f"  Premium: 5m bounce from {level_touched} with extreme volume")
                reasons.append(f"  5m Volume: {vol_ratio:.2f}x average")
            elif price_bounced_up and vol_ratio >= 1.1:
                execution_signal = "BUY_ENTRY"
                entry_quality = "GOOD"
                confidence = min(95, confidence + 5)
                reasons.append(f"  Entry: 5m bounce from {level_touched}")
            else:
                execution_signal = "BUY_SETUP"
                entry_quality = "WAIT"
                reasons.append(f"  Setup: {level_touched} support, waiting for 5m bounce")
        
        elif signal == "SELL_RESISTANCE":
            if price_bounced_down and vol_ratio >= 1.3:
                execution_signal = "SELL_ENTRY_PREMIUM"
                entry_quality = "EXCELLENT"
                confidence = min(95, confidence + 15)
                reasons.append(f"  Premium: 5m rejection from {level_touched} with extreme volume")
                reasons.append(f"  5m Volume: {vol_ratio:.2f}x average")
            elif price_bounced_down and vol_ratio >= 1.1:
                execution_signal = "SELL_ENTRY"
                entry_quality = "GOOD"
                confidence = min(95, confidence + 5)
                reasons.append(f"  Entry: 5m rejection from {level_touched}")
            else:
                execution_signal = "SELL_SETUP"
                entry_quality = "WAIT"
                reasons.append(f"  Setup: {level_touched} resistance, waiting for 5m rejection")
        
        else:
            execution_signal = "NEUTRAL"
            entry_quality = "NONE"
            confidence = 35
            reasons.append("  No clear pivot signal, wait for level touch")
        
        return {
            "signal": execution_signal,
            "base_signal": signal,
            "level_touched": level_touched,
            "entry_quality": entry_quality,
            "confidence": confidence,
            "volume_ratio": vol_ratio,
            "support_level": pivot_result["closest_value"] if signal == "BUY_SUPPORT" else None,
            "resistance_level": pivot_result["closest_value"] if signal == "SELL_RESISTANCE" else None,
            "price_action": {
                "moved_up": price_moved_up,
                "moved_down": price_moved_down,
                "bounced_up": price_bounced_up,
                "bounced_down": price_bounced_down,
            },
            "reasons": reasons,
        }


def _format_trading_message(signal: str, confidence: float, reasons: List[str]) -> str:
    """Format a clean trading message for UI display"""
    if signal not in ["BUY", "SELL"]:
        return f"WAIT - No clear entry signal"
    
    emoji = "BUY" if signal == "BUY" else "SELL"
    conf_emoji = "STRONG" if confidence >= 80 else "GOOD" if confidence >= 65 else "OK"
    
    return f"{emoji} at {conf_emoji} {confidence}% confidence"
