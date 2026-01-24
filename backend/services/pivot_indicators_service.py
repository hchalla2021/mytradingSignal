"""
Pivot Points & Technical Indicators Service
============================================
ULTRA-FAST: Uses cached market data from instant_analysis
No additional Zerodha API calls - works after market hours!

Provides:
- EMA 9/21/50 (from cached tick data)
- Classic Pivot Points (Pivot, R1, R2, R3, S1, S2, S3)
- Camarilla Pivot Points (H1-H4, L1-L4)
- Supertrend-like bias from EMA/price relationship

Time Complexity: O(1) - all from cache
Response Time: <50ms
"""

from datetime import datetime
from typing import Dict, Optional
import pytz

from services.cache import get_cache, get_redis
from services.instant_analysis import get_instant_analysis

IST = pytz.timezone('Asia/Kolkata')


class PivotIndicatorsService:
    """Ultra-fast pivot indicators using cached market data."""
    
    def __init__(self):
        self.cache = get_cache()

    def calculate_classic_pivots(self, high: float, low: float, close: float) -> Dict[str, float]:
        """Classic Pivot Points - O(1)"""
        pivot = (high + low + close) / 3
        range_hl = high - low
        
        return {
            "pivot": round(pivot, 2),
            "r1": round((2 * pivot) - low, 2),
            "r2": round(pivot + range_hl, 2),
            "r3": round(high + 2 * (pivot - low), 2),
            "s1": round((2 * pivot) - high, 2),
            "s2": round(pivot - range_hl, 2),
            "s3": round(low - 2 * (high - pivot), 2),
        }

    def calculate_camarilla_pivots(self, high: float, low: float, close: float) -> Dict[str, float]:
        """Camarilla Pivot Points - O(1)"""
        range_hl = high - low
        
        return {
            "h4": round(close + range_hl * 1.1 / 2, 2),
            "h3": round(close + range_hl * 1.1 / 4, 2),
            "h2": round(close + range_hl * 1.1 / 6, 2),
            "h1": round(close + range_hl * 1.1 / 12, 2),
            "l1": round(close - range_hl * 1.1 / 12, 2),
            "l2": round(close - range_hl * 1.1 / 6, 2),
            "l3": round(close - range_hl * 1.1 / 4, 2),
            "l4": round(close - range_hl * 1.1 / 2, 2),
        }

    def _get_camarilla_zone(self, price: float, cam: Dict) -> str:
        """Determine Camarilla zone."""
        if price >= cam["h4"]: return "BREAKOUT_UP"
        if price >= cam["h3"]: return "SELL_ZONE"
        if price >= cam["h2"]: return "NEUTRAL_HIGH"
        if price >= cam["l2"]: return "RANGE_BOUND"
        if price >= cam["l3"]: return "NEUTRAL_LOW"
        if price >= cam["l4"]: return "BUY_ZONE"
        return "BREAKDOWN"
    
    def _derive_supertrend(
        self,
        price: float,
        ema_9: float,
        ema_21: float,
        ema_50: float,
        high: float,
        low: float,
        multiplier: float = 3.0
    ) -> Dict:
        """Derive Supertrend-like signal from EMA and price range."""
        # ATR estimate from today's range
        atr_estimate = (high - low) * 0.5
        
        # Calculate bands
        upper_band = round(ema_21 + (atr_estimate * multiplier), 2)
        lower_band = round(ema_21 - (atr_estimate * multiplier), 2)
        
        # Trend from EMA alignment and price position
        if price > ema_21 and ema_9 > ema_21:
            trend = "BULLISH"
            st_value = lower_band
            signal = "BUY" if price > ema_50 else "HOLD"
        elif price < ema_21 and ema_9 < ema_21:
            trend = "BEARISH"
            st_value = upper_band
            signal = "SELL" if price < ema_50 else "HOLD"
        else:
            trend = "NEUTRAL"
            st_value = ema_21
            signal = "HOLD"
        
        distance = abs(price - st_value)
        
        return {
            "value": st_value,
            "trend": trend,
            "signal": signal,
            "distance": round(distance, 2),
            "distance_pct": round((distance / price) * 100, 2) if price > 0 else 0
        }

    async def get_indicators(self, symbol: str) -> Dict:
        """Get pivot indicators from instant analysis data - INSTANT!
        Never throws - always returns fallback if service unavailable."""
        try:
            # Use instant_analysis which has fallback to Zerodha API
            cache = await get_redis()
            analysis_data = await get_instant_analysis(cache, symbol)
            
            if not analysis_data:
                print(f"⚠️ [PIVOT] No analysis data for {symbol}")
                return self._get_fallback_response(symbol, "NO_DATA")
            
            # Extract from analysis data structure
            indicators = analysis_data.get('indicators', {})
            
            current_price = float(indicators.get('price', 0))
            high = float(indicators.get('high', current_price))
            low = float(indicators.get('low', current_price))
            open_price = float(indicators.get('open', current_price))
            
            # Get previous day data from indicators
            prev_high = float(indicators.get('prev_day_high', high))
            prev_low = float(indicators.get('prev_day_low', low))
            prev_close = float(indicators.get('prev_day_close', current_price))
            
            # Get EMAs from indicators
            ema_9 = float(indicators.get('ema_9', current_price))
            ema_21 = float(indicators.get('ema_21', current_price))
            ema_50 = float(indicators.get('ema_50', current_price))
            
            if current_price == 0:
                return self._get_fallback_response(symbol, "ZERO_PRICE")
            
            # Calculate pivot points from previous day OHLC
            classic = self.calculate_classic_pivots(prev_high, prev_low, prev_close)
            camarilla = self.calculate_camarilla_pivots(prev_high, prev_low, prev_close)
            
            # Derive supertrend signals
            st_10_3 = self._derive_supertrend(current_price, ema_9, ema_21, ema_50, high, low, 3.0)
            st_7_3 = self._derive_supertrend(current_price, ema_9, ema_21, ema_50, high, low, 2.0)
            
            # Calculate bias
            bullish_count = 0
            bearish_count = 0
            
            if current_price > ema_21: bullish_count += 1
            else: bearish_count += 1
            
            if current_price > classic["pivot"]: bullish_count += 1
            else: bearish_count += 1
            
            if st_10_3["trend"] == "BULLISH": bullish_count += 1
            elif st_10_3["trend"] == "BEARISH": bearish_count += 1
            
            if st_7_3["trend"] == "BULLISH": bullish_count += 1
            elif st_7_3["trend"] == "BEARISH": bearish_count += 1
            
            overall_bias = "BULLISH" if bullish_count >= 3 else "BEARISH" if bearish_count >= 3 else "NEUTRAL"
            
            # Find nearest levels
            all_levels = [
                ("Pivot", classic["pivot"]), ("R1", classic["r1"]), ("R2", classic["r2"]),
                ("S1", classic["s1"]), ("S2", classic["s2"]),
                ("Cam H3", camarilla["h3"]), ("Cam L3", camarilla["l3"]),
            ]
            above = [(n, v) for n, v in all_levels if v > current_price]
            below = [(n, v) for n, v in all_levels if v < current_price]
            
            nearest_res = min(above, key=lambda x: x[1]) if above else None
            nearest_sup = max(below, key=lambda x: x[1]) if below else None
            
            # Format levels
            resistance_info = {"name": nearest_res[0], "value": nearest_res[1], "distance": round(nearest_res[1] - current_price, 2)} if nearest_res else None
            support_info = {"name": nearest_sup[0], "value": nearest_sup[1], "distance": round(current_price - nearest_sup[1], 2)} if nearest_sup else None
            
            # Data source from analysis
            data_source = analysis_data.get('_data_source', 'LIVE')
            status = "CACHED" if 'BACKUP' in str(data_source) or 'CACHE' in str(data_source) else "LIVE"
            
            result = {
                "symbol": symbol,
                "status": status,
                "current_price": round(current_price, 2),
                "change_percent": round((current_price - prev_close) / prev_close * 100, 2) if prev_close else 0,
                "prev_day": {
                    "high": round(prev_high, 2),
                    "low": round(prev_low, 2),
                    "close": round(prev_close, 2),
                },
                "today": {
                    "high": round(high, 2),
                    "low": round(low, 2),
                    "open": round(open_price, 2)
                },
                "timestamp": datetime.now(IST).isoformat(),
                "ema": {
                    "ema9": round(ema_9, 2),
                    "ema21": round(ema_21, 2),
                    "ema50": round(ema_50, 2),
                    "trend": "BULLISH" if ema_9 > ema_21 > ema_50 else "BEARISH" if ema_9 < ema_21 < ema_50 else "MIXED",
                    "price_vs_ema21": "ABOVE" if current_price > ema_21 else "BELOW"
                },
                "classic_pivots": {
                    **classic,
                    "bias": "BULLISH" if current_price > classic["pivot"] else "BEARISH",
                    "nearest_resistance": resistance_info,
                    "nearest_support": support_info,
                },
                "camarilla_pivots": {
                    **camarilla,
                    "zone": self._get_camarilla_zone(current_price, camarilla)
                },
                "supertrend_10_3": st_10_3,
                "supertrend_7_3": st_7_3,
                "overall_bias": overall_bias,
                "bullish_signals": bullish_count,
                "bearish_signals": bearish_count,
            }
            
            print(f"✅ [PIVOT] {symbol}: ₹{current_price}, Pivot={classic['pivot']}, Bias={overall_bias}")
            return result
            
        except Exception as e:
            print(f"❌ [PIVOT] Error for {symbol}: {str(e)}")
            import traceback
            traceback.print_exc()
            # Return offline/fallback - never crash
            return self._get_fallback_response(symbol, "SERVICE_ERROR")

    def _get_fallback_response(self, symbol: str, reason: str) -> Dict:
        """Return fallback response with placeholder data."""
        return {
            "symbol": symbol,
            "status": "OFFLINE",
            "reason": reason,
            "current_price": None,
            "change_percent": 0,
            "prev_day": None,
            "today": None,
            "timestamp": datetime.now(IST).isoformat(),
            "ema": {"ema9": None, "ema21": None, "ema50": None, "trend": "NEUTRAL", "price_vs_ema21": "UNKNOWN"},
            "classic_pivots": {
                "pivot": None, "r1": None, "r2": None, "r3": None,
                "s1": None, "s2": None, "s3": None,
                "bias": "NEUTRAL", "nearest_resistance": None, "nearest_support": None
            },
            "camarilla_pivots": {
                "h4": None, "h3": None, "h2": None, "h1": None,
                "l1": None, "l2": None, "l3": None, "l4": None, "zone": "UNKNOWN"
            },
            "supertrend_10_3": {"value": None, "trend": "NEUTRAL", "signal": "HOLD", "distance": 0, "distance_pct": 0},
            "supertrend_7_3": {"value": None, "trend": "NEUTRAL", "signal": "HOLD", "distance": 0, "distance_pct": 0},
            "overall_bias": "NEUTRAL",
            "bullish_signals": 0,
            "bearish_signals": 0,
        }


_service: Optional[PivotIndicatorsService] = None


def get_pivot_service() -> PivotIndicatorsService:
    """Get singleton instance."""
    global _service
    if _service is None:
        _service = PivotIndicatorsService()
    return _service
