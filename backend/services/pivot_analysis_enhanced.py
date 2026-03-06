"""
Enhanced Pivot Analysis Service
================================
Provides:
- Market Status (5-level classification: Strong Bullish → Strong Bearish)
- Pivot Confidence Score (0-100%)
- 5-Minute Prediction (Up/Down/Sideways with confidence)
- Structured pivot analysis for professional trading

All calculations based on:
1. Pivot position relative to price
2. EMA alignment and trend strength
3. Volume activity and momentum
4. Recent price movement direction
"""

from typing import Dict, Optional, List
from datetime import datetime
from dataclasses import dataclass
import pytz

# Type definitions
@dataclass
class PivotAnalysis:
    """Complete pivot analysis result"""
    symbol: str
    current_price: float
    
    # Pivot levels
    classic_pivots: Dict[str, float]  # P, R1-R3, S1-S3
    camarilla_pivots: Dict[str, float]  # H1-H4, L1-L4
    
    # Market status (derived from all factors)
    market_status: str  # "STRONG_BULLISH" | "BULLISH" | "NEUTRAL" | "BEARISH" | "STRONG_BEARISH"
    
    # Pivot analysis confidence (0-100)
    pivot_confidence: int
    pivot_confidence_reasons: List[str]
    
    # Nearest levels
    nearest_resistance: Optional[Dict[str, float]]  # {"name": "R1", "value": ..., "distance": ...}
    nearest_support: Optional[Dict[str, float]]
    
    # 5-minute prediction
    prediction_direction: str  # "UP" | "DOWN" | "SIDEWAYS"
    prediction_confidence: int  # 0-100
    prediction_reasons: List[str]
    
    # Timestamp
    timestamp: str
    status: str  # "LIVE" | "CACHED" | "OFFLINE"


class PivotAnalysisEnhanced:
    """Enhanced pivot analysis with market status and predictions"""
    
    @staticmethod
    def analyze_pivot_profile(
        symbol: str,
        current_price: float,
        classic_pivots: Dict[str, float],
        camarilla_pivots: Dict[str, float],
        ema_20: float,
        ema_50: float,
        ema_100: float,
        ema_200: float,
        prev_close: float,
        current_high: float,
        current_low: float,
        volume: float,
        avg_volume: float,
        supertrend_10_2: Dict,
        supertrend_10_3: Dict,
        status: str = "LIVE"
    ) -> PivotAnalysis:
        """
        Comprehensive pivot analysis with all factors considered.
        Returns structured analysis with market status and predictions.
        """
        
        now = datetime.now(pytz.timezone('Asia/Kolkata')).isoformat()
        
        # ========================================================================
        # 1. MARKET STATUS CLASSIFICATION (5-level)
        # ========================================================================
        market_status, status_score = PivotAnalysisEnhanced._determine_market_status(
            current_price, prev_close, classic_pivots, camarilla_pivots,
            ema_20, ema_50, ema_100, ema_200, supertrend_10_2, supertrend_10_3
        )
        
        # ========================================================================
        # 2. PIVOT CONFIDENCE CALCULATION
        # ========================================================================
        pivot_conf, pivot_reasons = PivotAnalysisEnhanced._calculate_pivot_confidence(
            current_price, classic_pivots, camarilla_pivots,
            ema_20, ema_50, ema_100, ema_200, prev_close,
            supertrend_10_2, supertrend_10_3,
            status
        )
        
        # ========================================================================
        # 3. FIND NEAREST LEVELS
        # ========================================================================
        nearest_res, nearest_sup = PivotAnalysisEnhanced._find_nearest_levels(
            current_price, classic_pivots, camarilla_pivots
        )
        
        # ========================================================================
        # 4. 5-MINUTE PREDICTION
        # ========================================================================
        pred_direction, pred_conf, pred_reasons = PivotAnalysisEnhanced._predict_5m_direction(
            current_price, prev_close, current_high, current_low,
            classic_pivots, camarilla_pivots,
            ema_20, ema_50, volume, avg_volume,
            supertrend_10_2, supertrend_10_3,
            market_status
        )
        
        # ========================================================================
        # Return structured analysis
        # ========================================================================
        return PivotAnalysis(
            symbol=symbol,
            current_price=current_price,
            classic_pivots=classic_pivots,
            camarilla_pivots=camarilla_pivots,
            market_status=market_status,
            pivot_confidence=pivot_conf,
            pivot_confidence_reasons=pivot_reasons,
            nearest_resistance=nearest_res,
            nearest_support=nearest_sup,
            prediction_direction=pred_direction,
            prediction_confidence=pred_conf,
            prediction_reasons=pred_reasons,
            timestamp=now,
            status=status
        )
    
    @staticmethod
    def _determine_market_status(
        price: float, prev_close: float,
        classic: Dict, camarilla: Dict,
        ema_20: float, ema_50: float, ema_100: float, ema_200: float,
        st_10_2: Dict, st_10_3: Dict
    ) -> tuple[str, int]:
        """
        Determine market status (5-level classification).
        Factors:
        - Price vs pivot levels
        - EMA alignment
        - Supertrend confirmation
        - Camarilla zones
        """
        
        # Count bullish and bearish factors
        bullish_signals = 0
        bearish_signals = 0
        
        # 1. Price vs Pivot (strongest factor)
        pivot = classic.get('pivot', price)
        if price > pivot:
            bullish_signals += 2  # Weight: 2
        else:
            bearish_signals += 2
        
        # 2. EMA alignment (professional 20/50/100/200 stack)
        ema_bullish = (
            ema_20 > ema_50 > ema_100 > ema_200 and
            price > ema_20
        )
        ema_bearish = (
            ema_20 < ema_50 < ema_100 < ema_200 and
            price < ema_20
        )
        
        if ema_bullish:
            bullish_signals += 2
        elif ema_bearish:
            bearish_signals += 2
        
        # 3. Supertrend 10-2 (primary - professional intraday)
        st_trend_2 = st_10_2.get('trend', 'NEUTRAL')
        if st_trend_2 == 'BULLISH':
            bullish_signals += 2
        elif st_trend_2 == 'BEARISH':
            bearish_signals += 2
        
        # 4. Supertrend 10-3 (confirmation)
        st_trend_3 = st_10_3.get('trend', 'NEUTRAL')
        if st_trend_3 == 'BULLISH':
            bullish_signals += 1
        elif st_trend_3 == 'BEARISH':
            bearish_signals += 1
        
        # 5. Camarilla zone
        h3 = camarilla.get('h3', price)
        l3 = camarilla.get('l3', price)
        if price > h3:
            bullish_signals += 1  # Above resistance
        elif price < l3:
            bearish_signals += 1  # Below support
        
        # 6. Price movement (recent momentum)
        pct_change = ((price - prev_close) / prev_close * 100) if prev_close else 0
        if pct_change > 0.3:
            bullish_signals += 1
        elif pct_change < -0.3:
            bearish_signals += 1
        
        # Classify based on signal count
        net_score = bullish_signals - bearish_signals
        
        if net_score >= 6:
            return "STRONG_BULLISH", 90
        elif net_score >= 3:
            return "BULLISH", 70
        elif net_score <= -6:
            return "STRONG_BEARISH", 90
        elif net_score <= -3:
            return "BEARISH", 70
        else:
            return "NEUTRAL", 50
    
    @staticmethod
    def _calculate_pivot_confidence(
        price: float,
        classic: Dict, camarilla: Dict,
        ema_20: float, ema_50: float, ema_100: float, ema_200: float,
        prev_close: float,
        st_10_2: Dict, st_10_3: Dict,
        status: str
    ) -> tuple[int, List[str]]:
        """
        Calculate pivot confidence (0-100%).
        Based on:
        - Pivot position relative to price
        - Trend direction alignment
        - Volume activity
        - EMA configuration
        - Status (LIVE vs CACHED)
        """
        
        confidence = 55  # Base confidence
        reasons = []
        
        # 1. Price vs Pivot alignment
        pivot = classic.get('pivot', price)
        if price > pivot:
            confidence += 8
            reasons.append("Price above pivot (bullish structure)")
        else:
            confidence += 5
            reasons.append("Price below pivot (bearish structure)")
        
        # 2. EMA trend alignment
        ema_trend = "ALIGNED"
        if ema_20 > ema_50 > ema_100 > ema_200:
            confidence += 10
            ema_trend = "STRONG_BULLISH"
            reasons.append("EMA stack bullish (20>50>100>200)")
        elif ema_20 < ema_50 < ema_100 < ema_200:
            confidence += 10
            ema_trend = "STRONG_BEARISH"
            reasons.append("EMA stack bearish (20<50<100<200)")
        elif ema_20 > ema_50:
            confidence += 5
            ema_trend = "BULLISH"
            reasons.append("Short-term bullish (EMA20 > EMA50)")
        elif ema_20 < ema_50:
            confidence += 5
            ema_trend = "BEARISH"
            reasons.append("Short-term bearish (EMA20 < EMA50)")
        else:
            confidence += 2
            reasons.append("EMA mixed - consolidation phase")
        
        # 3. Supertrend confirmation
        st_trend = st_10_2.get('trend', 'NEUTRAL')
        if st_trend == 'BULLISH':
            confidence += 8
            reasons.append("Supertrend 10-2 bullish confirmation")
        elif st_trend == 'BEARISH':
            confidence += 8
            reasons.append("Supertrend 10-2 bearish confirmation")
        
        # 4. Distance from supertrend bar
        st_distance_pct = abs(st_10_2.get('distance_pct', 0))
        if st_distance_pct > 2.0:
            confidence += 5
            reasons.append(f"Well separated from Supertrend ({st_distance_pct:.2f}%)")
        elif st_distance_pct < 0.5:
            confidence -= 10
            reasons.append(f"Very close to Supertrend - reversal risk ({st_distance_pct:.2f}%)")
        
        # 5. Camarilla proximity
        h3 = camarilla.get('h3', price)
        l3 = camarilla.get('l3', price)
        dist_to_h3 = abs(price - h3) / h3 * 100
        dist_to_l3 = abs(price - l3) / l3 * 100
        
        if dist_to_h3 < 1:
            confidence -= 5
            reasons.append("Near Camarilla H3 (resistance)")
        elif dist_to_l3 < 1:
            confidence -= 5
            reasons.append("Near Camarilla L3 (support)")
        else:
            confidence += 3
            reasons.append("Good distance from Camarilla extremes")
        
        # 6. Price movement (momentum)
        pct_change = ((price - prev_close) / prev_close * 100) if prev_close else 0
        if abs(pct_change) > 0.5:
            confidence += 5
            reasons.append(f"Strong momentum ({pct_change:+.2f}%)")
        elif abs(pct_change) > 0.2:
            confidence += 3
            reasons.append(f"Moderate momentum ({pct_change:+.2f}%)")
        
        # 7. Data source quality
        if status == 'LIVE':
            confidence += 5
            reasons.append("LIVE market data")
        elif status == 'CACHED':
            confidence -= 3
            reasons.append("Cached data (slight discount)")
        
        # Clamp to 0-100
        confidence = max(10, min(95, confidence))
        
        return confidence, reasons
    
    @staticmethod
    def _find_nearest_levels(
        price: float,
        classic: Dict,
        camarilla: Dict
    ) -> tuple[Optional[Dict], Optional[Dict]]:
        """Find nearest resistance and support levels"""
        
        all_levels = [
            {'name': 'R3', 'value': classic.get('r3'), 'type': 'classic'},
            {'name': 'R2', 'value': classic.get('r2'), 'type': 'classic'},
            {'name': 'R1', 'value': classic.get('r1'), 'type': 'classic'},
            {'name': 'Pivot', 'value': classic.get('pivot'), 'type': 'classic'},
            {'name': 'S1', 'value': classic.get('s1'), 'type': 'classic'},
            {'name': 'S2', 'value': classic.get('s2'), 'type': 'classic'},
            {'name': 'S3', 'value': classic.get('s3'), 'type': 'classic'},
            {'name': 'Cam H3', 'value': camarilla.get('h3'), 'type': 'camarilla'},
            {'name': 'Cam L3', 'value': camarilla.get('l3'), 'type': 'camarilla'},
        ]
        
        # Find nearest resistance (above price)
        resistances = [l for l in all_levels if l['value'] and l['value'] > price]
        nearest_res = None
        if resistances:
            nearest_res = min(resistances, key=lambda x: x['value'])
            nearest_res = {
                'name': nearest_res['name'],
                'value': round(nearest_res['value'], 2),
                'distance': round(nearest_res['value'] - price, 2),
                'distance_pct': round((nearest_res['value'] - price) / price * 100, 3)
            }
        
        # Find nearest support (below price)
        supports = [l for l in all_levels if l['value'] and l['value'] < price]
        nearest_sup = None
        if supports:
            nearest_sup = max(supports, key=lambda x: x['value'])
            nearest_sup = {
                'name': nearest_sup['name'],
                'value': round(nearest_sup['value'], 2),
                'distance': round(price - nearest_sup['value'], 2),
                'distance_pct': round((price - nearest_sup['value']) / price * 100, 3)
            }
        
        return nearest_res, nearest_sup
    
    @staticmethod
    def _predict_5m_direction(
        price: float,
        prev_close: float,
        high: float,
        low: float,
        classic: Dict,
        camarilla: Dict,
        ema_20: float,
        ema_50: float,
        volume: float,
        avg_volume: float,
        st_10_2: Dict,
        st_10_3: Dict,
        market_status: str
    ) -> tuple[str, int, List[str]]:
        """
        Predict 5-minute direction based on:
        - Recent price momentum
        - Volume spikes
        - Trend momentum (supertrend)
        - Proximity to pivot levels
        """
        
        confidence = 50  # Base
        direction_signals = {'UP': 0, 'DOWN': 0, 'SIDEWAYS': 0}
        reasons = []
        
        pivot = classic.get('pivot', price)
        
        # ===================================================================
        # 1. RECENT PRICE MOMENTUM (40% weight)
        # ===================================================================
        momentum_pct = ((price - prev_close) / prev_close * 100) if prev_close else 0
        
        if momentum_pct > 0.3:
            direction_signals['UP'] += 3
            reasons.append(f"Strong upward momentum ({momentum_pct:+.2f}%)")
        elif momentum_pct > 0.1:
            direction_signals['UP'] += 2
            reasons.append(f"Mild upward momentum ({momentum_pct:+.2f}%)")
        elif momentum_pct < -0.3:
            direction_signals['DOWN'] += 3
            reasons.append(f"Strong downward momentum ({momentum_pct:+.2f}%)")
        elif momentum_pct < -0.1:
            direction_signals['DOWN'] += 2
            reasons.append(f"Mild downward momentum ({momentum_pct:+.2f}%)")
        else:
            direction_signals['SIDEWAYS'] += 2
            reasons.append(f"Minimal momentum ({momentum_pct:+.2f}%)")
        
        # ===================================================================
        # 2. VOLUME ACTIVITY (25% weight)
        # ===================================================================
        volume_ratio = volume / avg_volume if avg_volume > 0 else 1.0
        
        if volume_ratio > 1.3:
            # Exceptional volume - direction depends on price movement
            if momentum_pct > 0:
                direction_signals['UP'] += 2
                reasons.append(f"High volume on upside ({volume_ratio:.2f}x)")
            else:
                direction_signals['DOWN'] += 2
                reasons.append(f"High volume on downside ({volume_ratio:.2f}x)")
        elif volume_ratio > 1.0:
            # Above average volume
            if momentum_pct > 0:
                direction_signals['UP'] += 1
                reasons.append(f"Above-average volume on upside")
            else:
                direction_signals['DOWN'] += 1
                reasons.append(f"Above-average volume on downside")
        else:
            # Low volume - caution
            direction_signals['SIDEWAYS'] += 1
            reasons.append(f"Low volume - consolidation likely")
        
        # ===================================================================
        # 3. SUPERTREND MOMENTUM (20% weight)
        # ===================================================================
        st_trend = st_10_2.get('trend', 'NEUTRAL')
        st_signal = st_10_2.get('signal', 'NEUTRAL')
        
        if st_trend == 'BULLISH' and st_signal == 'BUY':
            direction_signals['UP'] += 2
            reasons.append("Supertrend bullish + buy signal")
        elif st_trend == 'BEARISH' and st_signal == 'SELL':
            direction_signals['DOWN'] += 2
            reasons.append("Supertrend bearish + sell signal")
        elif st_trend == 'BULLISH':
            direction_signals['UP'] += 1
            reasons.append("Supertrend bullish trend")
        elif st_trend == 'BEARISH':
            direction_signals['DOWN'] += 1
            reasons.append("Supertrend bearish trend")
        
        # ===================================================================
        # 4. PROXIMITY TO PIVOT LEVELS (15% weight - reversal risk)
        # ===================================================================
        
        # Distance from current pivot
        dist_to_pivot_pct = abs(price - pivot) / pivot * 100
        
        if dist_to_pivot_pct < 0.5:
            # Very close to pivot - expect bounce
            if price > pivot:
                direction_signals['UP'] += 1
                reasons.append("Price near pivot - expect bounce up")
            else:
                direction_signals['DOWN'] += 1
                reasons.append("Price near pivot - expect bounce down")
        
        # Distance from key levels
        h3 = camarilla.get('h3', price + 1000)
        l3 = camarilla.get('l3', price - 1000)
        
        dist_to_h3_pct = (h3 - price) / price * 100 if h3 else 100
        dist_to_l3_pct = (price - l3) / price * 100 if l3 else 100
        
        if dist_to_h3_pct < 1.0:
            # Close to resistance
            direction_signals['DOWN'] += 1
            reasons.append(f"Approaching resistance H3 ({dist_to_h3_pct:.2f}% away)")
        elif dist_to_l3_pct < 1.0:
            # Close to support
            direction_signals['UP'] += 1
            reasons.append(f"Approaching support L3 ({dist_to_l3_pct:.2f}% away)")
        
        # ===================================================================
        # 5. EMA BIAS ALIGNMENT (bonus)
        # ===================================================================
        if ema_20 > ema_50 > price:
            # Strong bullish - price below both EMAs but EMA aligned
            # Slight upward bias as price may follow EMA
            direction_signals['UP'] += 1
            reasons.append("Price below bullish EMA stack - mean reversion likely")
        elif ema_20 < ema_50 < price:
            # Strong bearish - price above both EMAs
            direction_signals['DOWN'] += 1
            reasons.append("Price above bearish EMA stack - pullback likely")
        
        # ===================================================================
        # Determine final direction
        # ===================================================================
        max_signal = max(direction_signals.values())
        
        if max_signal == 0:
            final_direction = 'SIDEWAYS'
            confidence = 35
        else:
            # Find direction with highest signal
            final_direction = [d for d, s in direction_signals.items() if s == max_signal][0]
            
            # Confidence calculation
            confidence = 50 + (max_signal * 8)  # Each signal adds ~8%
            
            # Boost confidence for market status alignment
            if (market_status.startswith('STRONG_BULLISH') and final_direction == 'UP') or \
               (market_status.startswith('STRONG_BEARISH') and final_direction == 'DOWN'):
                confidence = min(95, confidence + 10)
                reasons.append(f"Aligned with market status: {market_status}")
            elif (market_status == 'BULLISH' and final_direction == 'UP') or \
                 (market_status == 'BEARISH' and final_direction == 'DOWN'):
                confidence = min(95, confidence + 5)
                reasons.append(f"Aligned with market status: {market_status}")
            elif market_status == 'NEUTRAL' and final_direction == 'SIDEWAYS':
                confidence = min(90, confidence + 5)
                reasons.append("Market neutral - sideways prediction")
            else:
                confidence = max(30, confidence - 5)
                reasons.append(f"Slight divergence from market status: {market_status}")
        
        confidence = max(25, min(95, confidence))  # Clamp 25-95
        
        return final_direction, confidence, reasons


def get_pivot_analyzer() -> PivotAnalysisEnhanced:
    """Get singleton instance"""
    return PivotAnalysisEnhanced()
