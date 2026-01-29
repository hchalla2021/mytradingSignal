"""
Integration: IntraDayEntry + InstantAnalysis
=============================================

Extends the InstantSignal analysis with intraday entry logic
Adds VWMA-20/15m momentum to the existing analysis output

Usage:
    from services.intraday_integration import enhance_analysis_with_intraday
    
    analysis = InstantSignal.analyze_tick(tick_data)
    enhanced = enhance_analysis_with_intraday(analysis, tick_data)
    # Now includes: vwma_5m_entry, momentum_15m, intraday_signal
"""

from typing import Dict, Any, Optional
from services.intraday_entry_filter import (
    IntraDayEntrySystem,
    VWMAEntryFilter,
    MomentumEntryFilter,
)


class IntraDayAnalysisEnhancer:
    """
    Enhance existing instant analysis with intraday entry logic
    """
    
    @staticmethod
    def enhance_with_intraday(
        base_analysis: Dict[str, Any],
        tick_data: Dict[str, Any],
        force_momentum: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Add intraday entry signals to existing analysis
        
        Args:
            base_analysis: Output from InstantSignal.analyze_tick()
            tick_data: Original tick data used for analysis
            force_momentum: Optional pre-calculated 15m momentum data
                           (if not provided, generates from RSI)
        
        Returns:
            Enhanced analysis with intraday signals
        """
        
        if not base_analysis or base_analysis.get("signal") == "WAIT":
            # Don't enhance error/invalid analysis
            return base_analysis
        
        # Extract 5m data from existing analysis
        indicators = base_analysis.get("indicators", {})
        price = indicators.get("price", 0)
        vwma_20 = indicators.get("vwma_20", price)
        ema_20 = indicators.get("ema_20", price)
        ema_50 = indicators.get("ema_50", price)
        volume = indicators.get("volume", 0)
        
        # Generate 15m momentum data (from RSI if not provided)
        momentum_data = force_momentum or _generate_momentum_from_indicators(indicators)
        
        # Generate intraday signal
        intraday_result = IntraDayEntrySystem.generate_intraday_signal(
            # 5m data
            price_5m=price,
            vwma_20_5m=vwma_20,
            ema_20_5m=ema_20,
            ema_50_5m=ema_50,
            volume_5m=volume,
            avg_volume_5m=volume,  # Use current volume as baseline
            
            # 15m momentum
            rsi_15m=momentum_data.get("rsi"),
            ema_20_15m=momentum_data.get("ema_20"),
            ema_50_15m=momentum_data.get("ema_50"),
            volume_15m=momentum_data.get("volume"),
            avg_volume_15m=momentum_data.get("avg_volume"),
            
            # Risk management
            atr_5m=_estimate_atr(indicators),
            symbol=base_analysis.get("symbol", "UNKNOWN"),
        )
        
        # Add to analysis
        base_analysis["intraday"] = {
            "enabled": True,
            "signal": intraday_result["signal"],
            "confidence": intraday_result["confidence"],
            "ready_to_trade": intraday_result["ready_to_trade"],
            "entry_price": intraday_result["entry_price"],
            "stop_loss": intraday_result["stop_loss"],
            "target": intraday_result["target"],
            "risk_pct": intraday_result["risk_pct"],
            "message": intraday_result["trading_message"],
            
            # Component breakdown
            "vwma_5m_entry": {
                "signal": intraday_result["vwma_5m"]["signal"],
                "confidence": intraday_result["vwma_5m"]["confidence"],
                "type": intraday_result["vwma_5m"]["signal_type"],
              "distance_pct": intraday_result["vwma_5m"]["vwma_data"]["distance_pct"],
            },
            
            "momentum_15m": {
                "signal": intraday_result["momentum_15m"]["momentum_signal"] if intraday_result["momentum_15m"] else None,
                "rating": intraday_result["momentum_15m"]["momentum_rating"] if intraday_result["momentum_15m"] else None,
                "rsi": intraday_result["momentum_15m"]["rsi_data"]["rsi"] if intraday_result["momentum_15m"] else None,
            },
            
            "reasons": intraday_result["reasons"],
        }
        
        return base_analysis
    
    @staticmethod
    def create_vwma_entry_card(analysis: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Create a card component for VWMA Entry Filter display
        
        Returns data formatted for frontend card component
        """
        
        if "intraday" not in analysis or not analysis["intraday"]["enabled"]:
            return None
        
        intraday = analysis["intraday"]
        
        # Color coding
        signal_color = {
            "BUY": "green",
            "SELL": "red",
            "BUY_CONTINUATION": "blue",
            "HOLD": "yellow",
            None: "gray",
        }.get(intraday["signal"], "gray")
        
        return {
            "title": "📊 VWMA-20 Entry Filter (5m)",
            "subtitle": "Best Intraday Entry System",
            "signal": intraday["signal"],
            "signal_color": signal_color,
            "confidence": intraday["confidence"],
            "ready_to_trade": intraday["ready_to_trade"],
            "message": intraday["message"],
            
            # Values
            "entry_price": intraday["entry_price"],
            "stop_loss": intraday["stop_loss"],
            "target": intraday["target"],
            "risk_pct": intraday["risk_pct"],
            
            # Breakdown
            "vwma_entry": {
                "label": "5m VWMA-20",
                "signal": intraday["vwma_5m_entry"]["signal"],
                "confidence": intraday["vwma_5m_entry"]["confidence"],
                "distance_pct": intraday["vwma_5m_entry"]["distance_pct"],
                "type": intraday["vwma_5m_entry"]["type"],
            },
            
            "momentum": {
                "label": "15m Momentum",
                "signal": intraday["momentum_15m"]["signal"],
                "rating": intraday["momentum_15m"]["rating"],
                "rsi": intraday["momentum_15m"]["rsi"],
            },
            
            "reasons": intraday["reasons"],
        }


def _generate_momentum_from_indicators(indicators: Dict[str, Any]) -> Dict[str, Any]:
    """
    Generate 15m momentum data from available indicators
    
    This is an approximation using RSI and EMA data
    For production, you'd want real 15m candle data
    """
    
    rsi = indicators.get("rsi", 50)
    ema_20 = indicators.get("ema_20", 0)
    ema_50 = indicators.get("ema_50", 0)
    volume = indicators.get("volume", 0)
    
    return {
        "rsi": rsi,  # Use existing RSI (scaled for momentum)
        "ema_20": ema_20,
        "ema_50": ema_50,
        "volume": volume,
        "avg_volume": volume,  # Baseline
    }


def _estimate_atr(indicators: Dict[str, Any]) -> float:
    """
    Estimate ATR from available data
    
    ATR = (High - Low) over a period
    We approximate using day's range
    
    For production, calculate real ATR from candles
    """
    
    high = indicators.get("high", 0)
    low = indicators.get("low", 0)
    close = indicators.get("price", 0)
    
    if high > 0 and low > 0:
        # Simple range estimate
        range_points = high - low
        atr = range_points * 0.5  # Take 50% of range as ATR estimate
        return max(atr, 5)  # Minimum 5 points
    
    # Fallback: 0.3% of price
    return close * 0.003 if close > 0 else 10


# ============================================
# EXPORTS
# ============================================

__all__ = [
    "IntraDayAnalysisEnhancer",
    "enhance_with_intraday",
]


def enhance_with_intraday(
    base_analysis: Dict[str, Any],
    tick_data: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Convenience function to enhance analysis
    
    Usage:
        analysis = InstantSignal.analyze_tick(tick_data)
        enhanced = enhance_with_intraday(analysis, tick_data)
    """
    return IntraDayAnalysisEnhancer.enhance_with_intraday(base_analysis, tick_data)
