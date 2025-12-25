"""
Risk Engine - Spike & Crash Detection
HARD RULES - No AI, Pure Logic
Target: < 10ms execution
"""
from typing import Dict, List, Any
from enum import Enum


class AlertLevel(Enum):
    """Alert severity levels."""
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    INFO = "INFO"


class RiskEngine:
    """Detect market extremes, spikes, and crash risks."""
    
    def __init__(self):
        # Thresholds (configurable)
        self.VOLUME_EXTREME = 300  # %
        self.VOLUME_HIGH = 200
        self.OI_EXTREME = 8  # %
        self.OI_HIGH = 5
        self.VIX_DANGER = 18
        self.VIX_WARNING = 16
        self.GAP_LARGE = 1.0  # %
        self.PCR_SHIFT_STRONG = 0.25
        self.PRICE_MOVE_LARGE = 1.5  # %
        
    def detect_extremes(self, features: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Detect all market extremes and generate alerts.
        Returns list of alert objects.
        """
        alerts = []
        
        # Extract features
        volume_spike = features.get('volume_spike_pct', 0)
        oi_change_pct = features.get('oi_change_pct', 0)
        vix = features.get('india_vix', 15)
        gap_pct = features.get('gap_pct', 0)
        pcr_change = features.get('pcr_change', 0)
        change_pct = features.get('change_pct', 0)
        vwap_distance_pct = features.get('vwap_distance_pct', 0)
        near_high = features.get('near_high', False)
        near_low = features.get('near_low', False)
        
        # 🔴 CRITICAL ALERTS (Level 1 - Immediate Action)
        
        # Crash Risk Detection
        if vix > self.VIX_DANGER and gap_pct < -0.5:
            alerts.append({
                "level": AlertLevel.CRITICAL.value,
                "type": "CRASH_RISK",
                "message": "⚠️ HIGH CRASH PROBABILITY",
                "details": f"VIX: {vix:.1f}, Gap: {gap_pct:.2f}%",
                "action": "AVOID_LONG_POSITIONS",
                "popup": True
            })
        
        # Institutional Activity (Big Money Moving)
        if volume_spike > self.VOLUME_EXTREME and abs(oi_change_pct) > self.OI_EXTREME:
            alerts.append({
                "level": AlertLevel.CRITICAL.value,
                "type": "INSTITUTIONAL_ACTIVITY",
                "message": "🚨 MASSIVE INSTITUTIONAL ACTIVITY",
                "details": f"Volume: {volume_spike:.0f}%, OI: {oi_change_pct:.1f}%",
                "action": "FOLLOW_SMART_MONEY",
                "popup": True
            })
        
        # Extreme Volatility Spike
        if vix > 20 and abs(change_pct) > 2:
            alerts.append({
                "level": AlertLevel.CRITICAL.value,
                "type": "VOLATILITY_SPIKE",
                "message": "⚡ EXTREME VOLATILITY",
                "details": f"VIX: {vix:.1f}, Move: {change_pct:.2f}%",
                "action": "REDUCE_POSITION_SIZE",
                "popup": True
            })
        
        # 🟠 HIGH PRIORITY ALERTS
        
        # Strong Bullish Shift
        if pcr_change > self.PCR_SHIFT_STRONG and oi_change_pct > self.OI_HIGH:
            alerts.append({
                "level": AlertLevel.HIGH.value,
                "type": "BULLISH_SHIFT",
                "message": "📈 STRONG BULLISH SHIFT",
                "details": f"PCR Change: +{pcr_change:.2f}, OI: {oi_change_pct:.1f}%",
                "action": "CONSIDER_LONG",
                "popup": True
            })
        
        # Strong Bearish Shift
        if pcr_change < -self.PCR_SHIFT_STRONG and oi_change_pct < -self.OI_HIGH:
            alerts.append({
                "level": AlertLevel.HIGH.value,
                "type": "BEARISH_SHIFT",
                "message": "📉 STRONG BEARISH SHIFT",
                "details": f"PCR Change: {pcr_change:.2f}, OI: {oi_change_pct:.1f}%",
                "action": "CONSIDER_SHORT",
                "popup": True
            })
        
        # Breakout Detection
        if near_high and volume_spike > self.VOLUME_HIGH:
            alerts.append({
                "level": AlertLevel.HIGH.value,
                "type": "BREAKOUT",
                "message": "🚀 BREAKOUT DETECTED",
                "details": f"Near high with {volume_spike:.0f}% volume",
                "action": "MOMENTUM_LONG",
                "popup": False
            })
        
        # Breakdown Detection
        if near_low and volume_spike > self.VOLUME_HIGH:
            alerts.append({
                "level": AlertLevel.HIGH.value,
                "type": "BREAKDOWN",
                "message": "⬇️ BREAKDOWN DETECTED",
                "details": f"Near low with {volume_spike:.0f}% volume",
                "action": "AVOID_CATCHING_KNIFE",
                "popup": False
            })
        
        # 🟡 MEDIUM PRIORITY ALERTS
        
        # Large Gap
        if abs(gap_pct) > self.GAP_LARGE:
            gap_type = "UP" if gap_pct > 0 else "DOWN"
            alerts.append({
                "level": AlertLevel.MEDIUM.value,
                "type": f"LARGE_GAP_{gap_type}",
                "message": f"📊 Large Gap {gap_type}",
                "details": f"Gap: {gap_pct:.2f}%",
                "action": "WATCH_FOR_FILL",
                "popup": False
            })
        
        # VIX Warning
        if self.VIX_WARNING < vix < self.VIX_DANGER:
            alerts.append({
                "level": AlertLevel.MEDIUM.value,
                "type": "VIX_ELEVATED",
                "message": "⚠️ Elevated Fear",
                "details": f"VIX: {vix:.1f}",
                "action": "INCREASE_CAUTION",
                "popup": False
            })
        
        # Unusual OI Change
        if self.OI_HIGH < abs(oi_change_pct) < self.OI_EXTREME:
            direction = "BUILD" if oi_change_pct > 0 else "UNWIND"
            alerts.append({
                "level": AlertLevel.MEDIUM.value,
                "type": f"OI_{direction}",
                "message": f"📊 OI {direction}",
                "details": f"OI Change: {oi_change_pct:.1f}%",
                "action": "MONITOR_POSITIONS",
                "popup": False
            })
        
        # VWAP Deviation
        if abs(vwap_distance_pct) > 1.5:
            direction = "ABOVE" if vwap_distance_pct > 0 else "BELOW"
            alerts.append({
                "level": AlertLevel.INFO.value,
                "type": f"VWAP_{direction}",
                "message": f"📍 Far from VWAP ({direction})",
                "details": f"Distance: {vwap_distance_pct:.2f}%",
                "action": "EXPECT_REVERSION",
                "popup": False
            })
        
        return alerts
    
    def get_risk_score(self, features: Dict[str, Any]) -> int:
        """
        Calculate overall risk score (0-100).
        Higher = More Risk
        """
        score = 0
        
        # VIX Risk (0-30 points)
        vix = features.get('india_vix', 15)
        if vix > 20:
            score += 30
        elif vix > 16:
            score += 20
        elif vix > 13:
            score += 10
        
        # Volume Risk (0-20 points)
        volume_spike = features.get('volume_spike_pct', 100)
        if volume_spike > 300:
            score += 20
        elif volume_spike > 200:
            score += 15
        elif volume_spike > 150:
            score += 10
        
        # Price Movement Risk (0-25 points)
        change_pct = abs(features.get('change_pct', 0))
        if change_pct > 2:
            score += 25
        elif change_pct > 1.5:
            score += 15
        elif change_pct > 1:
            score += 10
        
        # OI Risk (0-15 points)
        oi_change = abs(features.get('oi_change_pct', 0))
        if oi_change > 8:
            score += 15
        elif oi_change > 5:
            score += 10
        
        # Gap Risk (0-10 points)
        gap_pct = abs(features.get('gap_pct', 0))
        if gap_pct > 1:
            score += 10
        elif gap_pct > 0.5:
            score += 5
        
        return min(score, 100)  # Cap at 100
    
    def should_trade(self, features: Dict[str, Any], threshold: int = 70) -> tuple[bool, str]:
        """
        Determine if market conditions are safe for trading.
        Returns: (should_trade, reason)
        """
        risk_score = self.get_risk_score(features)
        
        if risk_score >= threshold:
            return False, f"High risk (score: {risk_score})"
        
        vix = features.get('india_vix', 15)
        if vix > 20:
            return False, f"VIX too high ({vix:.1f})"
        
        volume_spike = features.get('volume_spike_pct', 100)
        if volume_spike < 30:
            return False, "Volume too low"
        
        return True, "Market conditions acceptable"
