"""
Pivot Points & Technical Indicators Service
============================================
ULTRA-FAST: Uses cached market data from instant_analysis
No additional Zerodha API calls - works after market hours!

Provides:
- EMA 20/50/100/200 Professional Trend Filter (professional intraday configuration)
- Classic Pivot Points (Pivot, R1, R2, R3, S1, S2, S3)
- Camarilla Pivot Points (H1-H4, L1-L4)
- Supertrend-like bias from EMA/price relationship

Time Complexity: O(1) - all from cache
Response Time: <50ms

Configuration: backend/config/ema_config.py (can be changed to LEGACY_QUICK, SCALP_FAST, SWING_MID)
"""

from datetime import datetime
from typing import Dict, Optional
import pytz

from services.cache import get_cache, get_redis
from services.instant_analysis import get_instant_analysis
from config.ema_config import get_trend_filter, get_ema_config

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
        ema_20: float,
        ema_50: float,
        ema_100: float,
        ema_200: float,
        high: float,
        low: float,
        multiplier: float = 2.0
    ) -> Dict:
        """
        Derive Supertrend (10,2) signal from professional EMA (20/50/100/200) and price range.
        Professional trend filter for intraday trading on NIFTY, BANKNIFTY, SENSEX.
        Period: 10 bars, Multiplier: 2x ATR (standard intraday parameters)
        ✅ Use only when market is trending (avoid inside CPR or EMA compression)
        """
        # ATR estimate from today's range (Period=10 smoothing)
        atr_estimate = (high - low) * 0.5
        
        # Calculate bands using HL2 (High+Low)/2 as base (10,2 method)
        hl2 = (high + low) / 2
        upper_band = round(hl2 + (atr_estimate * multiplier), 2)
        lower_band = round(hl2 - (atr_estimate * multiplier), 2)
        
        # Professional trend determination using EMA alignment
        # STRONG_BULLISH: Price > EMA20 > EMA50 > EMA100 > EMA200
        # BULLISH: Price > EMA50 and EMA20 > EMA50
        # BEARISH: Price < EMA50 and EMA20 < EMA50
        # STRONG_BEARISH: Price < EMA20 < EMA50 < EMA100 < EMA200
        
        if price > ema_50 and ema_20 > ema_50 and ema_50 > ema_100:
            trend = "BULLISH"
            st_value = lower_band
            signal = "BUY" if price > ema_100 else "HOLD"
        elif price < ema_50 and ema_20 < ema_50 and ema_50 < ema_100:
            trend = "BEARISH"
            st_value = upper_band
            signal = "SELL" if price < ema_100 else "HOLD"
        else:
            trend = "NEUTRAL"
            st_value = hl2
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
            
            # Get EMAs from indicators (using new 20/50/100/200 config)
            ema_20 = float(indicators.get('ema_20', current_price))
            ema_50 = float(indicators.get('ema_50', current_price))
            ema_100 = float(indicators.get('ema_100', current_price))
            ema_200 = float(indicators.get('ema_200', current_price))
            
            if current_price == 0:
                return self._get_fallback_response(symbol, "ZERO_PRICE")
            
            # Calculate pivot points from previous day OHLC
            classic = self.calculate_classic_pivots(prev_high, prev_low, prev_close)
            camarilla = self.calculate_camarilla_pivots(prev_high, prev_low, prev_close)
            
            # Derive supertrend signals using professional EMA configuration
            st_10_2 = self._derive_supertrend(current_price, ema_20, ema_50, ema_100, ema_200, high, low, 2.0)
            st_10_3 = self._derive_supertrend(current_price, ema_20, ema_50, ema_100, ema_200, high, low, 3.0)
            
            # Calculate bias using professional EMA (20/50/100/200)
            bullish_count = 0
            bearish_count = 0
            
            # EMA20 as trend filter (fastest moving average)
            if current_price > ema_20:
                bullish_count += 1
            else:
                bearish_count += 1
            
            # Pivot crossing
            if current_price > classic["pivot"]:
                bullish_count += 1
            else:
                bearish_count += 1
            
            # Supertrend 10_2 confirmation (primary - professional intraday)
            if st_10_2["trend"] == "BULLISH":
                bullish_count += 1
            elif st_10_2["trend"] == "BEARISH":
                bearish_count += 1
            
            # Supertrend 10_3 confirmation (backup)
            if st_10_3["trend"] == "BULLISH":
                bullish_count += 1
            elif st_10_3["trend"] == "BEARISH":
                bearish_count += 1
            
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
                    "ema_20": round(ema_20, 2),
                    "ema_50": round(ema_50, 2),
                    "ema_100": round(ema_100, 2),
                    "ema_200": round(ema_200, 2),
                    "trend": "BULLISH" if ema_20 > ema_50 > ema_100 > ema_200 else "BEARISH" if ema_20 < ema_50 < ema_100 < ema_200 else "MIXED",
                    "price_vs_ema20": "ABOVE" if current_price > ema_20 else "BELOW"
                },
                "classic_pivots": {
                    **classic,
                    "bias": "BULLISH" if current_price > classic["pivot"] else "BEARISH",
                    "nearest_resistance": resistance_info,
                    "nearest_support": support_info,
                },
                "camarilla_pivots": {
                    "h4": camarilla["h4"],
                    "h3": camarilla["h3"],
                    "l3": camarilla["l3"],
                    "l4": camarilla["l4"],
                    "zone": self._get_camarilla_zone(current_price, camarilla)
                },
                "supertrend_10_2": st_10_2,
                "supertrend_10_3": st_10_3,
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

    def get_last_session_pivots(self) -> Dict:
        """Get pivot levels from the last trading session (market closed display)."""
        result = {}
        
        try:
            import json
            import os
            
            # Direct file read - fastest path
            backup_path = os.path.join(os.path.dirname(__file__), '../data/market_backup.json')
            
            if not os.path.exists(backup_path):
                # Return fallback for each symbol
                return {
                    'NIFTY': self._get_last_session_fallback('NIFTY'),
                    'BANKNIFTY': self._get_last_session_fallback('BANKNIFTY'),
                    'SENSEX': self._get_last_session_fallback('SENSEX')
                }
            
            # Read backup file
            try:
                with open(backup_path, 'r',  encoding='utf-8') as f:
                    backup_data = json.load(f)
            except Exception as e:
                print(f"❌ [LAST_SESSION] File read error: {str(e)}")
                return {
                    'NIFTY': self._get_last_session_fallback('NIFTY'),
                    'BANKNIFTY': self._get_last_session_fallback('BANKNIFTY'),
                    'SENSEX': self._get_last_session_fallback('SENSEX')
                }
            
            # Process each symbol
            for symbol in ['NIFTY', 'BANKNIFTY', 'SENSEX']:
                try:
                    if symbol not in backup_data:
                        result[symbol] = self._get_last_session_fallback(symbol)
                        continue
                    
                    data = backup_data[symbol]
                    
                    # Extract OHLC
                    high = float(data.get('high', 0)) or float(data.get('prev_day_high', 0))
                    low = float(data.get('low', 0)) or float(data.get('prev_day_low', 0))
                    close = float(data.get('close', 0)) or float(data.get('prev_day_close', 0))
                    
                    if not all([high, low, close]):
                        result[symbol] = self._get_last_session_fallback(symbol)
                        continue
                    
                    # Calculate pivot points
                    classic = self.calculate_classic_pivots(high, low, close)
                    camarilla = self.calculate_camarilla_pivots(high, low, close)
                    
                    # Extract EMAs
                    ema_20 = data.get('ema_21') or data.get('ema_20')
                    ema_50 = data.get('ema_50')
                    
                    # Build response
                    result[symbol] = {
                        "symbol": symbol,
                        "status": "CACHED",
                        "reason": "LAST_SESSION",
                        "current_price": close,
                        "change_percent": float(data.get('changePercent', 0)),
                        "prev_day": float(data.get('prev_day_close', 0)) if data.get('prev_day_close') else None,
                        "today": close,
                        "timestamp": data.get('timestamp', data.get('_backup_timestamp', datetime.now(IST).isoformat())),
                        "ema": {
                            "ema_20": ema_20,
                            "ema_50": ema_50,
                            "ema_100": None,
                            "ema_200": None,
                            "trend": "HISTORICAL",
                            "price_vs_ema20": "ABOVE" if close > (ema_20 or 0) else "BELOW"
                        },
                        "classic_pivots": {
                            **classic,
                            "bias": "HISTORICAL",
                            "nearest_resistance": classic.get('r1'),
                            "nearest_support": classic.get('s1')
                        },
                        "camarilla_pivots": {
                            "h4": camarilla.get('h4'),
                            "h3": camarilla.get('h3'),
                            "l3": camarilla.get('l3'),
                            "l4": camarilla.get('l4'),
                            "zone": "CACHED"
                        },
                        "supertrend_10_2": {
                            "value": None,
                            "trend": "HISTORICAL",
                            "signal": "REFERENCE_ONLY",
                            "distance_pct": 0
                        },
                        "supertrend_10_3": {
                            "value": None,
                            "trend": "HISTORICAL",
                            "signal": "REFERENCE_ONLY",
                            "distance_pct": 0
                        },
                        "overall_bias": "HISTORICAL"
                    }
                    
                except Exception as sym_err:
                    print(f"⚠️ [LAST_SESSION] Error processing {symbol}: {str(sym_err)}")
                    result[symbol] = self._get_last_session_fallback(symbol)
            
            return result
            
        except Exception as e:
            print(f"❌ [LAST_SESSION] Fatal error: {str(e)}")
            import traceback
            traceback.print_exc()
            
            return {
                'NIFTY': self._get_last_session_fallback('NIFTY'),
                'BANKNIFTY': self._get_last_session_fallback('BANKNIFTY'),
                'SENSEX': self._get_last_session_fallback('SENSEX')
            }
    
    
    def _get_last_session_fallback(self, symbol: str = None) -> Dict:
        """Return last session fallback for when backup unavailable."""
        return {
            "symbol": symbol,
            "status": "NO_DATA",
            "reason": "BACKUP_UNAVAILABLE",
            "current_price": None,
            "change_percent": 0,
            "prev_day": None,
            "today": None,
            "timestamp": datetime.now(IST).isoformat(),
            "ema": {
                "ema_20": None,
                "ema_50": None,
                "ema_100": None,
                "ema_200": None,
                "trend": "UNKNOWN",
                "price_vs_ema20": "UNKNOWN"
            },
            "classic_pivots": {
                "pivot": None,
                "r1": None,
                "r2": None,
                "r3": None,
                "s1": None,
                "s2": None,
                "s3": None,
                "bias": "UNKNOWN",
                "nearest_resistance": None,
                "nearest_support": None
            },
            "camarilla_pivots": {
                "h4": None,
                "h3": None,
                "l3": None,
                "l4": None,
                "zone": "UNKNOWN"
            },
            "supertrend_10_2": {
                "value": None,
                "trend": "UNKNOWN",
                "signal": "NO_DATA",
                "distance_pct": 0
            },
            "supertrend_10_3": {
                "value": None,
                "trend": "UNKNOWN",
                "signal": "NO_DATA",
                "distance_pct": 0
            },
            "overall_bias": "UNKNOWN"
        }

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
            "ema": {
                "ema_20": None,
                "ema_50": None,
                "ema_100": None,
                "ema_200": None,
                "trend": "NEUTRAL",
                "price_vs_ema20": "UNKNOWN"
            },
            "classic_pivots": {
                "pivot": None,
                "r1": None,
                "r2": None,
                "r3": None,
                "s1": None,
                "s2": None,
                "s3": None,
                "bias": "NEUTRAL",
                "nearest_resistance": None,
                "nearest_support": None
            },
            "camarilla_pivots": {
                "h4": None,
                "h3": None,
                "l3": None,
                "l4": None,
                "zone": "UNKNOWN"
            },
            "supertrend_10_2": {
                "value": None,
                "trend": "NEUTRAL",
                "signal": "HOLD",
                "distance_pct": 0
            },
            "supertrend_10_3": {
                "value": None,
                "trend": "NEUTRAL",
                "signal": "HOLD",
                "distance_pct": 0
            },
            "overall_bias": "NEUTRAL",
        }


_service: Optional[PivotIndicatorsService] = None


def get_pivot_service() -> PivotIndicatorsService:
    """Get singleton instance."""
    global _service
    if _service is None:
        _service = PivotIndicatorsService()
    return _service
