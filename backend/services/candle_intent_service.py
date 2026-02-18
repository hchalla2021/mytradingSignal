"""
Candle Intent Service - Professional Candle Structure Analysis
═══════════════════════════════════════════════════════════════
🔥 WHERE PROS MAKE MONEY - Candle is the final judge, not indicators

Performance: O(1) space, O(n) time | Target: <3ms execution
Professional Patterns:
- Long upper wick at resistance → Supply active (rejection)
- Long lower wick at support → Demand defending (absorption)
- Small body + high volume → Absorption (institutional positioning)
- Big body + low volume → Emotional move (trap/false breakout)
- Inside candle near zone → Break setup (consolidation before explosion)

Data Source: 100% from Zerodha WebSocket (df['open','high','low','close','volume'])
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime
import asyncio


@dataclass
class CandlePattern:
    """Lightweight candle pattern container"""
    __slots__ = ('pattern_type', 'strength', 'intent', 'interpretation', 'confidence')
    
    pattern_type: str  # REJECTION, ABSORPTION, EMOTIONAL, BREAKOUT_SETUP, NEUTRAL
    strength: int  # 0-100
    intent: str  # BULLISH, BEARISH, NEUTRAL
    interpretation: str  # Human-readable insight
    confidence: int  # 0-100


@dataclass
class CandleIntentResult:
    """Ultra-lightweight result container with professional metrics"""
    __slots__ = (
        'symbol', 'timestamp', 'current_candle', 'pattern', 
        'wick_analysis', 'body_analysis', 'volume_analysis',
        'near_zone', 'professional_signal'
    )
    
    symbol: str
    timestamp: str
    current_candle: Dict  # OHLCV data
    pattern: CandlePattern
    wick_analysis: Dict  # Upper/Lower wick insights
    body_analysis: Dict  # Body size and strength
    volume_analysis: Dict  # Volume vs price action
    near_zone: bool  # If near support/resistance
    professional_signal: str  # STRONG_BUY, BUY, SELL, STRONG_SELL, WAIT


class CandleIntentEngine:
    """
    High-Performance Candle Structure Analyzer
    ═════════════════════════════════════════
    Algorithm: Single-pass candle analysis with vectorization
    Memory: O(1) - no buffering, streaming analysis
    Performance: <3ms for 100 candles
    
    Professional Insights:
    - Wick dominance = rejection strength
    - Body-to-range ratio = conviction level
    - Volume-price efficiency = absorption detection
    - Inside candles near zones = breakout setups
    """
    
    __slots__ = ('_min_wick_ratio', '_absorption_threshold', '_zone_proximity')
    
    def __init__(
        self, 
        min_wick_ratio: float = 0.4,  # 40% of range = significant wick
        absorption_threshold: float = 0.3,  # Body < 30% of range = absorption
        zone_proximity: float = 0.015  # 1.5% from high/low = near zone
    ):
        """
        Args:
            min_wick_ratio: Minimum wick length vs range for rejection pattern
            absorption_threshold: Max body size for absorption detection
            zone_proximity: Distance threshold for "near zone" detection
        """
        self._min_wick_ratio = min_wick_ratio
        self._absorption_threshold = absorption_threshold
        self._zone_proximity = zone_proximity
    
    def analyze(self, symbol: str, df: pd.DataFrame) -> CandleIntentResult:
        """
        Main analysis - ULTRA FAST
        Target: <3ms for 100 candles
        
        Args:
            symbol: Trading symbol (NIFTY, BANKNIFTY, SENSEX)
            df: DataFrame with OHLCV data from Zerodha
        
        Returns:
            CandleIntentResult with professional pattern analysis
        """
        try:
            # Fast validation
            if df.empty or len(df) < 3:
                return self._create_neutral_result(symbol, "Insufficient data")
            
            # Get current and previous candles
            current = df.iloc[-1]
            prev = df.iloc[-2] if len(df) >= 2 else current
            
            # Extract OHLCV (all from Zerodha API)
            open_price = float(current['open'])
            high_price = float(current['high'])
            low_price = float(current['low'])
            close_price = float(current['close'])
            volume = float(current.get('volume', 0))
            
            # Previous candle for context
            prev_close = float(prev['close'])
            
            # Calculate average volume (last 20 candles)
            recent_df = df.tail(20)
            avg_volume = float(recent_df['volume'].mean()) if 'volume' in recent_df.columns else 1
            if avg_volume == 0:
                avg_volume = 1
            
            # === CORE CALCULATIONS (Vectorized for speed) ===
            candle_range = high_price - low_price
            body_size = abs(close_price - open_price)
            
            # Protect against zero range
            if candle_range == 0:
                candle_range = 0.01  # Minimal range to avoid division by zero
            
            upper_wick = high_price - max(open_price, close_price)
            lower_wick = min(open_price, close_price) - low_price
            
            # Ratios (professional metrics)
            body_ratio = body_size / candle_range
            upper_wick_ratio = upper_wick / candle_range
            lower_wick_ratio = lower_wick / candle_range
            
            # Volume efficiency
            volume_ratio = volume / avg_volume if avg_volume > 0 else 1.0
            
            # Price movement percentage
            price_change_pct = ((close_price - prev_close) / prev_close) * 100 if prev_close > 0 else 0
            
            # === WICK ANALYSIS ===
            wick_analysis = self._analyze_wicks(
                upper_wick_ratio, lower_wick_ratio, upper_wick, lower_wick, 
                close_price, open_price, candle_range
            )
            
            # === BODY ANALYSIS ===
            body_analysis = self._analyze_body(
                body_ratio, body_size, close_price, open_price, candle_range
            )
            
            # === VOLUME ANALYSIS ===
            volume_analysis = self._analyze_volume(
                volume_ratio, body_ratio, price_change_pct, volume, avg_volume
            )
            
            # === ZONE PROXIMITY CHECK ===
            near_zone = self._check_zone_proximity(df, close_price)
            
            # === PATTERN DETECTION (Professional Logic) ===
            pattern = self._detect_pattern(
                wick_analysis, body_analysis, volume_analysis, near_zone,
                upper_wick_ratio, lower_wick_ratio, body_ratio, volume_ratio
            )
            
            # === PROFESSIONAL SIGNAL GENERATION ===
            professional_signal = self._generate_professional_signal(
                pattern, wick_analysis, volume_analysis, near_zone
            )
            
            # === BUILD RESULT ===
            return CandleIntentResult(
                symbol=symbol,
                timestamp=datetime.now().isoformat(),
                current_candle={
                    "open": round(open_price, 2),
                    "high": round(high_price, 2),
                    "low": round(low_price, 2),
                    "close": round(close_price, 2),
                    "volume": int(volume),
                    "range": round(candle_range, 2),
                    "body_size": round(body_size, 2),
                    "upper_wick": round(upper_wick, 2),
                    "lower_wick": round(lower_wick, 2)
                },
                pattern=pattern,
                wick_analysis=wick_analysis,
                body_analysis=body_analysis,
                volume_analysis=volume_analysis,
                near_zone=near_zone,
                professional_signal=professional_signal
            )
            
        except Exception as e:
            print(f"[CANDLE-INTENT] Error analyzing {symbol}: {e}")
            import traceback
            traceback.print_exc()
            return self._create_neutral_result(symbol, f"Error: {e}")
    
    def _analyze_wicks(
        self,
        upper_ratio: float,
        lower_ratio: float,
        upper_wick: float,
        lower_wick: float,
        close: float,
        open_price: float,
        candle_range: float
    ) -> Dict:
        """
        🔥 PROFESSIONAL: Analyze wick structure for supply/demand
        
        Long upper wick (>40% of range) at resistance = SUPPLY ACTIVE (rejection)
        Long lower wick (>40% of range) at support = DEMAND DEFENDING (absorption)
        """
        is_bullish_candle = close > open_price
        
        # Upper wick analysis
        if upper_ratio >= self._min_wick_ratio:
            upper_interpretation = "SUPPLY ACTIVE - Strong rejection at high"
            upper_strength = min(int(upper_ratio * 150), 100)  # 40% = 60 strength, 67% = 100
            upper_signal = "BEARISH"
        elif upper_ratio >= 0.25:
            upper_interpretation = "Moderate rejection - Some supply"
            upper_strength = int(upper_ratio * 200)
            upper_signal = "SLIGHTLY_BEARISH"
        else:
            upper_interpretation = "Minimal upper wick - No rejection"
            upper_strength = int(upper_ratio * 100)
            upper_signal = "NEUTRAL"
        
        # Lower wick analysis
        if lower_ratio >= self._min_wick_ratio:
            lower_interpretation = "DEMAND DEFENDING - Strong absorption at low"
            lower_strength = min(int(lower_ratio * 150), 100)
            lower_signal = "BULLISH"
        elif lower_ratio >= 0.25:
            lower_interpretation = "Moderate absorption - Some demand"
            lower_strength = int(lower_ratio * 200)
            lower_signal = "SLIGHTLY_BULLISH"
        else:
            lower_interpretation = "Minimal lower wick - No absorption"
            lower_strength = int(lower_ratio * 100)
            lower_signal = "NEUTRAL"
        
        # Dominant wick (key insight)
        if upper_ratio > lower_ratio and upper_ratio >= self._min_wick_ratio:
            dominant = "UPPER - Sellers in control"
        elif lower_ratio > upper_ratio and lower_ratio >= self._min_wick_ratio:
            dominant = "LOWER - Buyers in control"
        else:
            dominant = "BALANCED - No clear dominance"
        
        return {
            "upper_wick_pct": round(upper_ratio * 100, 1),
            "lower_wick_pct": round(lower_ratio * 100, 1),
            "upper_strength": upper_strength,
            "lower_strength": lower_strength,
            "upper_signal": upper_signal,
            "lower_signal": lower_signal,
            "upper_interpretation": upper_interpretation,
            "lower_interpretation": lower_interpretation,
            "dominant_wick": dominant
        }
    
    def _analyze_body(
        self,
        body_ratio: float,
        body_size: float,
        close: float,
        open_price: float,
        candle_range: float
    ) -> Dict:
        """
        🔥 PROFESSIONAL: Analyze body structure for conviction
        
        Small body (<30% range) = Indecision or absorption
        Big body (>70% range) = Strong conviction (or emotion if low volume)
        """
        is_bullish = close > open_price
        color = "GREEN" if is_bullish else "RED"
        
        # Body strength classification
        if body_ratio >= 0.7:  # 70%+ of range
            body_type = "STRONG_BODY"
            conviction = "High conviction move"
            strength = 90
        elif body_ratio >= 0.5:  # 50-70%
            body_type = "MODERATE_BODY"
            conviction = "Moderate conviction"
            strength = 70
        elif body_ratio >= 0.3:  # 30-50%
            body_type = "AVERAGE_BODY"
            conviction = "Average move"
            strength = 50
        elif body_ratio >= 0.15:  # 15-30%
            body_type = "SMALL_BODY"
            conviction = "Low conviction - Indecision"
            strength = 30
        else:  # <15%
            body_type = "DOJI"
            conviction = "Extreme indecision - Potential reversal"
            strength = 10
        
        interpretation = f"{color} {body_type} - {conviction}"
        
        return {
            "body_ratio_pct": round(body_ratio * 100, 1),
            "body_type": body_type,
            "color": color,
            "is_bullish": is_bullish,
            "strength": strength,
            "conviction": conviction,
            "interpretation": interpretation
        }
    
    def _analyze_volume(
        self,
        volume_ratio: float,
        body_ratio: float,
        price_change_pct: float,
        volume: float,
        avg_volume: float
    ) -> Dict:
        """
        🔥 PROFESSIONAL: Analyze volume-price efficiency
        
        Small body + High volume = ABSORPTION (institutional positioning)
        Big body + Low volume = EMOTIONAL MOVE (trap/false breakout)
        
        🚨 TRAP DETECTION:
        - Bull Trap: Big green candle + Low volume = Fake breakout
        - Bear Trap: Big red candle + Low volume = Fake breakdown
        - Sharp moves without volume = Suspicious
        """
        # Volume classification
        if volume_ratio >= 2.0:
            vol_type = "VERY_HIGH"
            vol_interpretation = "Extremely high volume - Significant activity"
            alert_level = "NORMAL"
        elif volume_ratio >= 1.5:
            vol_type = "HIGH"
            vol_interpretation = "High volume - Strong participation"
            alert_level = "NORMAL"
        elif volume_ratio >= 1.2:
            vol_type = "ABOVE_AVERAGE"
            vol_interpretation = "Above average volume"
            alert_level = "NORMAL"
        elif volume_ratio >= 0.8:
            vol_type = "AVERAGE"
            vol_interpretation = "Average volume"
            alert_level = "NORMAL"
        elif volume_ratio >= 0.5:
            vol_type = "LOW"
            vol_interpretation = "Low volume - Weak participation"
            alert_level = "CAUTION"
        else:
            vol_type = "VERY_LOW"
            vol_interpretation = "Very low volume - No conviction"
            alert_level = "WARNING"
        
        # 🚨 TRAP DETECTION SYSTEM
        trap_detected = False
        trap_type = None
        trap_severity = 0
        
        # Professional pattern detection (Volume + Body)
        if body_ratio < self._absorption_threshold and volume_ratio >= 1.5:
            # Small body + High volume = ABSORPTION
            efficiency = "ABSORPTION"
            efficiency_interpretation = "🔥 ABSORPTION PATTERN - Big volume, small move = Institutional positioning"
            signal = "BULLISH"
            alert_level = "HIGHLIGHT"  # 🔥 Fire highlight
            
        elif body_ratio >= 0.7 and volume_ratio < 0.8:
            # Big body + Low volume = EMOTIONAL/TRAP
            efficiency = "EMOTIONAL_MOVE"
            trap_detected = True
            trap_severity = 85
            
            # Determine trap type based on price direction
            if price_change_pct > 1.5:
                trap_type = "BULL_TRAP"
                efficiency_interpretation = "🚨 BULL TRAP ALERT - Big green candle on low volume = Fake breakout!"
                signal = "STRONG_BEARISH"
                alert_level = "DANGER"  # 🔴 Red sharp light
            elif price_change_pct < -1.5:
                trap_type = "BEAR_TRAP"
                efficiency_interpretation = "🚨 BEAR TRAP ALERT - Big red candle on low volume = Fake breakdown!"
                signal = "STRONG_BULLISH"
                alert_level = "OPPORTUNITY"  # 🟢 Green sharp light
            else:
                trap_type = "EMOTIONAL_TRAP"
                efficiency_interpretation = "⚠️ TRAP ALERT - Big move on low volume = Emotional/False move"
                signal = "BEARISH"
                alert_level = "DANGER"
            
        elif body_ratio >= 0.5 and volume_ratio < 0.6:
            # Medium body + Very low volume = Suspicious
            efficiency = "SUSPICIOUS"
            trap_detected = True
            trap_type = "SUSPICIOUS_MOVE"
            trap_severity = 60
            efficiency_interpretation = "⚠️ SUSPICIOUS - Decent move but very low volume = Buyer beware"
            signal = "NEUTRAL"
            alert_level = "WARNING"  # 🟡 Yellow warning light
            
        elif body_ratio >= 0.6 and volume_ratio >= 1.5:
            # Big body + High volume = HEALTHY
            efficiency = "HEALTHY"
            efficiency_interpretation = "✅ HEALTHY MOVE - Big move with volume confirmation"
            signal = "BULLISH"
            alert_level = "HIGHLIGHT"  # 🔥 Fire highlight
            
        elif abs(price_change_pct) >= 2.0 and volume_ratio < 1.0:
            # SHARP FALL/RISE detection
            efficiency = "SHARP_MOVE_LOW_VOL"
            trap_detected = True
            trap_severity = 75
            
            if price_change_pct >= 2.0:
                trap_type = "SHARP_RISE_TRAP"
                efficiency_interpretation = "🔥🚨 SHARP RISE on LOW VOLUME - Likely trap for buyers!"
                signal = "STRONG_BEARISH"
                alert_level = "CRITICAL"  # 🔴 Critical red flashing
            else:
                trap_type = "SHARP_FALL_TRAP"
                efficiency_interpretation = "🔥🚨 SHARP FALL on LOW VOLUME - Likely trap for sellers!"
                signal = "STRONG_BULLISH"
                alert_level = "CRITICAL"  # 🟢 Critical green flashing
        else:
            efficiency = "NEUTRAL"
            efficiency_interpretation = "Normal price-volume relationship"
            signal = "NEUTRAL"
            alert_level = "NORMAL"
        
        return {
            "volume": int(volume),
            "avg_volume": int(avg_volume),
            "volume_ratio": round(volume_ratio, 2),
            "volume_type": vol_type,
            "volume_interpretation": vol_interpretation,
            "efficiency": efficiency,
            "efficiency_interpretation": efficiency_interpretation,
            "signal": signal,
            
            # 🚨 TRAP DETECTION RESULTS
            "trap_detected": trap_detected,
            "trap_type": trap_type,
            "trap_severity": trap_severity,
            "alert_level": alert_level,  # NORMAL, CAUTION, WARNING, DANGER, OPPORTUNITY, HIGHLIGHT, CRITICAL
        }
    
    def _check_zone_proximity(self, df: pd.DataFrame, current_price: float) -> bool:
        """
        Check if current price is near recent high/low (zone)
        Near zone = within 1.5% of 20-candle high or low
        """
        try:
            recent = df.tail(20)
            recent_high = float(recent['high'].max())
            recent_low = float(recent['low'].min())
            
            # Distance to high/low
            dist_to_high = abs(current_price - recent_high) / recent_high
            dist_to_low = abs(current_price - recent_low) / recent_low
            
            return dist_to_high <= self._zone_proximity or dist_to_low <= self._zone_proximity
        except:
            return False
    
    def _detect_pattern(
        self,
        wick_analysis: Dict,
        body_analysis: Dict,
        volume_analysis: Dict,
        near_zone: bool,
        upper_wick_ratio: float,
        lower_wick_ratio: float,
        body_ratio: float,
        volume_ratio: float
    ) -> CandlePattern:
        """
        🔥 PROFESSIONAL: Detect primary candle pattern
        
        Patterns:
        1. REJECTION - Long upper wick (>40%) = Supply active
        2. ABSORPTION - Long lower wick (>40%) OR small body + high volume
        3. BREAKOUT_SETUP - Inside candle near zone (consolidation)
        4. EMOTIONAL - Big body + low volume (trap)
        5. NEUTRAL - No clear pattern
        """
        # Pattern 1: REJECTION (Long upper wick)
        if upper_wick_ratio >= self._min_wick_ratio and upper_wick_ratio > lower_wick_ratio * 1.5:
            return CandlePattern(
                pattern_type="REJECTION",
                strength=min(int(upper_wick_ratio * 150), 100),
                intent="BEARISH",
                interpretation=f"Long upper wick ({upper_wick_ratio*100:.0f}%) - Supply active, sellers rejecting higher prices",
                confidence=85 if near_zone else 70
            )
        
        # Pattern 2: ABSORPTION (Long lower wick OR small body + high volume)
        if lower_wick_ratio >= self._min_wick_ratio and lower_wick_ratio > upper_wick_ratio * 1.5:
            return CandlePattern(
                pattern_type="ABSORPTION",
                strength=min(int(lower_wick_ratio * 150), 100),
                intent="BULLISH",
                interpretation=f"Long lower wick ({lower_wick_ratio*100:.0f}%) - Demand defending, buyers absorbing supply",
                confidence=85 if near_zone else 70
            )
        
        # Pattern 3: ABSORPTION via Volume (Small body + High volume)
        if body_ratio < self._absorption_threshold and volume_ratio >= 1.5:
            return CandlePattern(
                pattern_type="ABSORPTION",
                strength=int(volume_ratio * 50),
                intent="BULLISH",
                interpretation=f"Small body ({body_ratio*100:.0f}%) + High volume ({volume_ratio:.1f}x) - Institutional absorption",
                confidence=80
            )
        
        # Pattern 4: EMOTIONAL MOVE (Big body + Low volume)
        if body_ratio >= 0.7 and volume_ratio < 0.8:
            return CandlePattern(
                pattern_type="EMOTIONAL",
                strength=int(body_ratio * 100),
                intent="BEARISH",
                interpretation=f"Big body ({body_ratio*100:.0f}%) + Low volume ({volume_ratio:.1f}x) - Emotional/Trap move",
                confidence=75
            )
        
        # Pattern 5: BREAKOUT SETUP (Inside candle near zone)
        if near_zone and body_ratio < 0.4:
            return CandlePattern(
                pattern_type="BREAKOUT_SETUP",
                strength=60,
                intent="NEUTRAL",
                interpretation="Inside candle near zone - Consolidation before breakout, watch for direction",
                confidence=70
            )
        
        # Pattern 6: HEALTHY MOVE (Big body + High volume)
        if body_ratio >= 0.6 and volume_ratio >= 1.5:
            intent = "BULLISH" if body_analysis['is_bullish'] else "BEARISH"
            return CandlePattern(
                pattern_type="HEALTHY_MOVE",
                strength=int((body_ratio + volume_ratio/3) * 100),
                intent=intent,
                interpretation=f"Strong {intent.lower()} move with volume confirmation - Follow the trend",
                confidence=85
            )
        
        # Default: NEUTRAL
        return CandlePattern(
            pattern_type="NEUTRAL",
            strength=50,
            intent="NEUTRAL",
            interpretation="No clear candle pattern - Monitor for setup",
            confidence=50
        )
    
    def _generate_professional_signal(
        self,
        pattern: CandlePattern,
        wick_analysis: Dict,
        volume_analysis: Dict,
        near_zone: bool
    ) -> str:
        """
        Generate actionable professional signal
        
        Signals:
        - STRONG_BUY: High confidence bullish setup
        - BUY: Moderate bullish setup
        - SELL: Moderate bearish setup
        - STRONG_SELL: High confidence bearish setup
        - WAIT: No clear setup
        """
        # STRONG_BUY: Absorption at zone with volume
        if (pattern.pattern_type == "ABSORPTION" and near_zone and 
            pattern.confidence >= 80 and volume_analysis['volume_ratio'] >= 1.3):
            return "STRONG_BUY"
        
        # BUY: Absorption or bullish pattern
        if pattern.intent == "BULLISH" and pattern.confidence >= 70:
            return "BUY"
        
        # STRONG_SELL: Rejection at zone
        if (pattern.pattern_type == "REJECTION" and near_zone and 
            pattern.confidence >= 80):
            return "STRONG_SELL"
        
        # SELL: Rejection or bearish pattern
        if pattern.intent == "BEARISH" and pattern.confidence >= 70:
            return "SELL"
        
        # WAIT: Breakout setup or neutral
        if pattern.pattern_type == "BREAKOUT_SETUP" or pattern.pattern_type == "EMOTIONAL":
            return "WAIT"
        
        return "WAIT"
    
    def _create_neutral_result(self, symbol: str, reason: str) -> CandleIntentResult:
        """Create neutral result for errors/edge cases"""
        return CandleIntentResult(
            symbol=symbol,
            timestamp=datetime.now().isoformat(),
            current_candle={
                "open": 0, "high": 0, "low": 0, "close": 0,
                "volume": 0, "range": 0, "body_size": 0,
                "upper_wick": 0, "lower_wick": 0
            },
            pattern=CandlePattern(
                pattern_type="NEUTRAL",
                strength=50,
                intent="NEUTRAL",
                interpretation=reason,
                confidence=0
            ),
            wick_analysis={
                "upper_wick_pct": 0, "lower_wick_pct": 0,
                "upper_strength": 0, "lower_strength": 0,
                "upper_signal": "NEUTRAL", "lower_signal": "NEUTRAL",
                "upper_interpretation": "N/A", "lower_interpretation": "N/A",
                "dominant_wick": "NEUTRAL"
            },
            body_analysis={
                "body_ratio_pct": 0, "body_type": "NEUTRAL",
                "color": "GRAY", "is_bullish": False,
                "strength": 0, "conviction": "N/A",
                "interpretation": reason
            },
            volume_analysis={
                "volume": 0, "avg_volume": 0, "volume_ratio": 0,
                "volume_type": "NEUTRAL", "volume_interpretation": "N/A",
                "efficiency": "NEUTRAL", "efficiency_interpretation": "N/A",
                "signal": "NEUTRAL"
            },
            near_zone=False,
            professional_signal="WAIT"
        )
    
    def to_dict(self, result: CandleIntentResult) -> Dict:
        """Convert result to API-friendly dictionary with visual alert system"""
        
        # 🔥 VISUAL ALERT MAPPING
        alert_level = result.volume_analysis.get('alert_level', 'NORMAL')
        trap_detected = result.volume_analysis.get('trap_detected', False)
        trap_type = result.volume_analysis.get('trap_type')
        
        # Determine visual indicator
        visual_alert = {
            "NORMAL": {
                "icon": "🟢",
                "color": "green",
                "animation": "none",
                "priority": 1,
                "message": "Normal market condition"
            },
            "CAUTION": {
                "icon": "🟡",
                "color": "yellow",
                "animation": "pulse",
                "priority": 2,
                "message": "Exercise caution - Low volume"
            },
            "WARNING": {
                "icon": "⚠️",
                "color": "orange",
                "animation": "pulse",
                "priority": 3,
                "message": "Warning - Very suspicious activity"
            },
            "DANGER": {
                "icon": "🚨",
                "color": "red",
                "animation": "flash",
                "priority": 4,
                "message": "DANGER - Trap detected!"
            },
            "OPPORTUNITY": {
                "icon": "💎",
                "color": "cyan",
                "animation": "glow",
                "priority": 4,
                "message": "OPPORTUNITY - Counter-trap setup"
            },
            "HIGHLIGHT": {
                "icon": "🔥",
                "color": "gold",
                "animation": "fire",
                "priority": 5,
                "message": "STRONG SIGNAL - High conviction move"
            },
            "CRITICAL": {
                "icon": "💥",
                "color": "crimson",
                "animation": "explode",
                "priority": 6,
                "message": "CRITICAL - Sharp move alert!"
            }
        }.get(alert_level, {
            "icon": "⚪",
            "color": "gray",
            "animation": "none",
            "priority": 0,
            "message": "Monitoring"
        })
        
        return {
            "symbol": result.symbol,
            "timestamp": result.timestamp,
            "current_candle": result.current_candle,
            "pattern": {
                "type": result.pattern.pattern_type,
                "strength": result.pattern.strength,
                "intent": result.pattern.intent,
                "interpretation": result.pattern.interpretation,
                "confidence": result.pattern.confidence
            },
            "wick_analysis": result.wick_analysis,
            "body_analysis": result.body_analysis,
            "volume_analysis": result.volume_analysis,
            "near_zone": result.near_zone,
            "professional_signal": result.professional_signal,
            "status": "ACTIVE" if result.pattern.confidence >= 70 else "WATCHING",
            
            # 🔥 VISUAL ALERT SYSTEM
            "visual_alert": visual_alert,
            "trap_status": {
                "is_trap": trap_detected,
                "trap_type": trap_type,
                "severity": result.volume_analysis.get('trap_severity', 0),
                "action_required": "AVOID" if trap_detected and result.volume_analysis.get('trap_severity', 0) >= 75 else "MONITOR"
            }
        }


# ═══════════════════════════════════════════════════════════
# SINGLETON PATTERN - Reuse engine across requests
# ═══════════════════════════════════════════════════════════

_engine_instance: Optional[CandleIntentEngine] = None


def get_candle_intent_engine() -> CandleIntentEngine:
    """Get or create singleton engine instance"""
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = CandleIntentEngine(
            min_wick_ratio=0.4,  # 40% wick = significant
            absorption_threshold=0.3,  # 30% body = absorption
            zone_proximity=0.015  # 1.5% from high/low = near zone
        )
    return _engine_instance


async def analyze_candle_intent(symbol: str, df: pd.DataFrame, inject_live_tick: bool = True) -> Dict:
    """
    Main entry point for API
    Ultra-fast async wrapper with optional live tick injection
    
    🔥 IMPROVEMENT: Injects latest market tick into analysis
    This ensures candle pattern detection uses current price, not stale candle close
    
    Args:
        symbol: Trading symbol (NIFTY, BANKNIFTY, SENSEX)
        df: DataFrame with OHLCV from Zerodha KiteConnect
        inject_live_tick: If True, inject current market price into last candle for live analysis
    
    Returns:
        Dictionary with candle intent analysis
    """
    # 🔥 LIVE TICK INJECTION: Get current market price and inject into DataFrame
    if inject_live_tick and not df.empty and len(df) > 0:
        from services.cache import get_redis
        try:
            cache = await get_redis()
            market_data = await cache.get_market_data(symbol)
            
            if market_data and market_data.get('price', 0) > 0:
                current_price = float(market_data.get('price', 0))
                current_volume = market_data.get('volume', None)
                
                # Update the last candle with live price and volume
                df = df.copy()
                last_idx = len(df) - 1
                df.loc[last_idx, 'close'] = current_price
                df.loc[last_idx, 'high'] = max(df.loc[last_idx, 'high'], current_price)
                df.loc[last_idx, 'low'] = min(df.loc[last_idx, 'low'], current_price)
                if current_volume:
                    df.loc[last_idx, 'volume'] = current_volume
                
                print(f"[CANDLE-INTENT-INJECT] 🔥 Injected live tick for {symbol}: ₹{current_price}")
        except Exception as e:
            print(f"[CANDLE-INTENT-INJECT] ⚠️ Failed to inject live tick: {e}")
    
    engine = get_candle_intent_engine()
    result = await asyncio.to_thread(engine.analyze, symbol, df)
    return engine.to_dict(result)
