"""
Feature Builder - Extract Trading Intelligence
Ultra-fast feature extraction from market data
"""
from typing import Dict, Any, Optional
from datetime import datetime


class FeatureBuilder:
    """Extract professional trading features from raw market data."""
    
    def __init__(self):
        self.baseline_vix = 15.0  # Normal VIX level
        
    def build_features(self, market_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Build comprehensive trading features from market data.
        Target: < 20ms execution time
        """
        try:
            # Price & Structure
            price = market_data.get('price', 0)
            open_price = market_data.get('open', price)
            prev_close = market_data.get('close', price)
            high = market_data.get('high', price)
            low = market_data.get('low', price)
            vwap = market_data.get('vwap', price)
            
            # Volume & Open Interest
            volume = market_data.get('volume', 0)
            avg_volume = market_data.get('avg_volume', volume) or 1
            oi = market_data.get('oi', 0)
            oi_change = market_data.get('oi_change', 0)
            
            # Options Data
            pcr = market_data.get('pcr', 1.0)
            pcr_change = market_data.get('pcr_change', 0)
            call_oi = market_data.get('callOI', 0)
            put_oi = market_data.get('putOI', 0)
            
            # Market Metrics
            india_vix = market_data.get('vix', 15.0)
            
            # Calculate derived features
            gap_pct = self._safe_percentage(open_price - prev_close, prev_close)
            vwap_distance = round(price - vwap, 2)
            vwap_distance_pct = self._safe_percentage(price - vwap, vwap)
            volume_spike_pct = round((volume / avg_volume) * 100, 2)
            
            # Day range analysis
            day_range = high - low
            price_position = self._safe_percentage(price - low, day_range) if day_range > 0 else 50
            
            # Breakout detection
            near_high = (high - price) / high < 0.01 if high > 0 else False
            near_low = (price - low) / price < 0.01 if price > 0 else False
            
            # OI Analysis
            oi_change_pct = self._safe_percentage(oi_change, oi) if oi > 0 else 0
            oi_intensity = "HIGH" if abs(oi_change_pct) > 5 else "MODERATE" if abs(oi_change_pct) > 2 else "LOW"
            
            # PCR Analysis
            pcr_status = self._analyze_pcr(pcr)
            pcr_shift = "BULLISH" if pcr_change > 0.15 else "BEARISH" if pcr_change < -0.15 else "NEUTRAL"
            
            # VIX Analysis
            vix_spike = india_vix > self.baseline_vix * 1.2
            vix_category = self._categorize_vix(india_vix)
            
            # Trend strength
            trend = market_data.get('trend', 'UNKNOWN')
            change_pct = market_data.get('changePercent', 0)
            
            features = {
                # Core Price Data
                "symbol": market_data.get('symbol', 'UNKNOWN'),
                "price": round(price, 2),
                "open": round(open_price, 2),
                "high": round(high, 2),
                "low": round(low, 2),
                "prev_close": round(prev_close, 2),
                "change_pct": round(change_pct, 2),
                
                # Price Structure
                "gap_pct": gap_pct,
                "vwap": round(vwap, 2),
                "vwap_distance": vwap_distance,
                "vwap_distance_pct": vwap_distance_pct,
                "price_position_in_range": round(price_position, 2),
                "near_high": near_high,
                "near_low": near_low,
                
                # Volume Intelligence
                "volume": volume,
                "avg_volume": avg_volume,
                "volume_spike_pct": volume_spike_pct,
                "volume_status": self._volume_status(volume_spike_pct),
                
                # Open Interest
                "oi": oi,
                "oi_change": oi_change,
                "oi_change_pct": round(oi_change_pct, 2),
                "oi_intensity": oi_intensity,
                
                # Options Intelligence
                "pcr": round(pcr, 2),
                "pcr_change": round(pcr_change, 2),
                "pcr_status": pcr_status,
                "pcr_shift": pcr_shift,
                "call_oi": call_oi,
                "put_oi": put_oi,
                
                # Risk Metrics
                "india_vix": round(india_vix, 2),
                "vix_spike": vix_spike,
                "vix_category": vix_category,
                
                # Trend & Sentiment
                "trend": trend,
                
                # Metadata
                "timestamp": datetime.now().isoformat(),
                "market_time": market_data.get('timestamp', datetime.now().isoformat()),
            }
            
            return features
            
        except Exception as e:
            print(f"❌ Feature extraction error: {e}")
            return self._get_default_features()
    
    def _safe_percentage(self, value: float, base: float) -> float:
        """Calculate percentage safely."""
        if base == 0:
            return 0.0
        return round((value / base) * 100, 2)
    
    def _analyze_pcr(self, pcr: float) -> str:
        """Analyze PCR ratio."""
        if pcr > 1.3:
            return "VERY_BULLISH"
        elif pcr > 1.1:
            return "BULLISH"
        elif pcr < 0.7:
            return "VERY_BEARISH"
        elif pcr < 0.9:
            return "BEARISH"
        else:
            return "NEUTRAL"
    
    def _categorize_vix(self, vix: float) -> str:
        """Categorize VIX level."""
        if vix > 20:
            return "HIGH_FEAR"
        elif vix > 16:
            return "ELEVATED"
        elif vix < 12:
            return "COMPLACENT"
        else:
            return "NORMAL"
    
    def _volume_status(self, spike_pct: float) -> str:
        """Categorize volume activity."""
        if spike_pct > 200:
            return "EXTREME"
        elif spike_pct > 150:
            return "HIGH"
        elif spike_pct > 100:
            return "ABOVE_AVERAGE"
        elif spike_pct < 50:
            return "LOW"
        else:
            return "NORMAL"
    
    def _get_default_features(self) -> Dict[str, Any]:
        """Return default features on error."""
        return {
            "symbol": "UNKNOWN",
            "price": 0,
            "timestamp": datetime.now().isoformat(),
            "error": "Feature extraction failed"
        }
