"""
Decision Engine - Final Output Builder
Combines AI + Risk + Alerts into UI-ready format
"""
from typing import Dict, List, Any
from datetime import datetime


class DecisionEngine:
    """Build final trading decision output for UI."""
    
    def __init__(self):
        self.signal_strength_threshold = int(os.getenv("SIGNAL_STRENGTH_THRESHOLD", "80"))
        
    def build_ui_response(
        self,
        features: Dict[str, Any],
        ai_analysis: Dict[str, Any],
        alerts: List[Dict[str, Any]],
        risk_score: int
    ) -> Dict[str, Any]:
        """
        Build comprehensive UI response.
        Target: < 10ms
        """
        
        # Extract key metrics
        symbol = features.get('symbol', 'UNKNOWN')
        price = features.get('price', 0)
        change_pct = features.get('change_pct', 0)
        
        # AI insights
        market_state = ai_analysis.get('market_state', 'Neutral')
        bullish_prob = ai_analysis.get('bullish_probability', 50)
        bearish_prob = ai_analysis.get('bearish_probability', 50)
        confidence = ai_analysis.get('confidence', 50)
        trade_bias = ai_analysis.get('trade_bias', 'Neutral')
        
        # Check for popup alerts
        has_popup = any(alert.get('popup', False) for alert in alerts)
        critical_alerts = [a for a in alerts if a.get('level') == 'CRITICAL']
        
        # Determine signal strength
        signal_strength = self._calculate_signal_strength(
            confidence, risk_score, bullish_prob, bearish_prob
        )
        
        # Build action recommendation
        action = self._build_action(
            trade_bias, signal_strength, risk_score, critical_alerts
        )
        
        # Build response
        response = {
            # Market Overview
            "symbol": symbol,
            "price": round(price, 2),
            "change_pct": round(change_pct, 2),
            "timestamp": datetime.now().isoformat(),
            
            # AI Analysis
            "ai_analysis": {
                "market_state": market_state,
                "state_emoji": self._get_state_emoji(market_state),
                "bullish_probability": round(bullish_prob, 1),
                "bearish_probability": round(bearish_prob, 1),
                "next_move": ai_analysis.get('next_move_1_3min', 'Monitoring...'),
                "confidence": round(confidence, 0),
                "reasoning": ai_analysis.get('reasoning', ''),
                "key_drivers": ai_analysis.get('key_drivers', []),
                "expected_range": ai_analysis.get('expected_range', {}),
            },
            
            # Risk Assessment
            "risk": {
                "score": risk_score,
                "level": ai_analysis.get('risk_level', 'Medium'),
                "level_color": self._get_risk_color(risk_score),
            },
            
            # Trading Signal
            "signal": {
                "bias": trade_bias,
                "strength": signal_strength,
                "strength_label": self._get_strength_label(signal_strength),
                "should_trade": signal_strength >= self.signal_strength_threshold,
                "action": action,
            },
            
            # Alerts
            "alerts": {
                "total": len(alerts),
                "critical": len(critical_alerts),
                "has_popup": has_popup,
                "items": alerts[:5],  # Top 5 alerts
            },
            
            # Features Summary
            "features_summary": {
                "volume_spike": features.get('volume_spike_pct', 0),
                "oi_change": features.get('oi_change_pct', 0),
                "pcr": features.get('pcr', 1.0),
                "vix": features.get('india_vix', 15),
                "vwap_distance": features.get('vwap_distance_pct', 0),
            },
            
            # Metadata
            "meta": {
                "model": ai_analysis.get('model', 'unknown'),
                "tokens_used": ai_analysis.get('tokens_used', 0),
                "latency_ms": 0,  # Will be calculated by caller
            }
        }
        
        return response
    
    def _calculate_signal_strength(
        self,
        confidence: float,
        risk_score: int,
        bullish_prob: float,
        bearish_prob: float
    ) -> int:
        """
        Calculate overall signal strength (0-100).
        Higher = Stronger signal
        """
        # Base strength from confidence
        strength = confidence
        
        # Reduce strength based on risk
        risk_penalty = (risk_score / 100) * 30
        strength -= risk_penalty
        
        # Boost for strong directional bias
        prob_diff = abs(bullish_prob - bearish_prob)
        if prob_diff > 20:
            strength += 10
        elif prob_diff > 30:
            strength += 20
        
        return min(max(int(strength), 0), 100)
    
    def _build_action(
        self,
        trade_bias: str,
        signal_strength: int,
        risk_score: int,
        critical_alerts: List[Dict]
    ) -> str:
        """Build actionable recommendation."""
        
        # Critical alerts override everything
        if critical_alerts:
            return "⚠️ Wait for market stability"
        
        # High risk = no trade
        if risk_score > 70:
            return "🚫 Risk too high - Stay out"
        
        # Low signal strength = wait
        if signal_strength < 60:
            return "⏸️ Signal unclear - Wait"
        
        # Strong signal = action
        if signal_strength >= 80:
            if trade_bias == "Long":
                return "🟢 Strong BUY signal"
            elif trade_bias == "Short":
                return "🔴 Strong SELL signal"
            else:
                return "⏸️ Wait for clarity"
        
        # Moderate signal
        if trade_bias == "Long":
            return "🟡 Consider LONG (cautious)"
        elif trade_bias == "Short":
            return "🟡 Consider SHORT (cautious)"
        else:
            return "⏸️ No clear direction"
    
    def _get_state_emoji(self, market_state: str) -> str:
        """Get emoji for market state."""
        emoji_map = {
            "Bullish": "🚀",
            "Mild_Bullish": "📈",
            "Neutral": "➡️",
            "Mild_Bearish": "📉",
            "Bearish": "⬇️"
        }
        return emoji_map.get(market_state, "❓")
    
    def _get_risk_color(self, risk_score: int) -> str:
        """Get color code for risk level."""
        if risk_score >= 70:
            return "red"
        elif risk_score >= 50:
            return "orange"
        elif risk_score >= 30:
            return "yellow"
        else:
            return "green"
    
    def _get_strength_label(self, strength: int) -> str:
        """Get label for signal strength."""
        if strength >= 80:
            return "VERY STRONG"
        elif strength >= 60:
            return "STRONG"
        elif strength >= 40:
            return "MODERATE"
        else:
            return "WEAK"


import os  # Add this import at the top
