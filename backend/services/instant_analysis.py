"""
INSTANT ANALYSIS - Ultra Fast Lightweight Analysis
Uses ONLY current tick data from Zerodha - NO historical data needed
Blazing fast, always works, production-ready
"""

from typing import Dict, Any, Optional
from datetime import datetime
import asyncio


class InstantSignal:
    """Lightning-fast signal generator using only current tick"""
    
    @staticmethod
    def analyze_tick(tick_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        INSTANT analysis from single tick - ULTRA FAST
        Returns signal in milliseconds
        """
        try:
            price = tick_data.get('price', 0)
            change_percent = tick_data.get('changePercent', 0)
            volume = tick_data.get('volume', 0)
            high = tick_data.get('high', price)
            low = tick_data.get('low', price)
            open_price = tick_data.get('open', price)
            pcr = tick_data.get('pcr', 0)
            oi = tick_data.get('oi', 0)
            trend = tick_data.get('trend', 'neutral')
            
            # Quick signal logic - INSTANT
            signal = "WAIT"
            confidence = 0.0
            reasons = []
            
            # Price momentum check
            if change_percent > 0.5:
                signal = "BUY_SIGNAL"
                confidence = min(abs(change_percent) / 2, 1.0)
                reasons.append(f"Strong upward momentum: +{change_percent:.2f}%")
            elif change_percent < -0.5:
                signal = "SELL_SIGNAL"
                confidence = min(abs(change_percent) / 2, 1.0)
                reasons.append(f"Strong downward momentum: {change_percent:.2f}%")
            
            # Volume confirmation
            if volume > 1000000:
                confidence = min(confidence + 0.2, 1.0)
                reasons.append("High volume confirmation")
            
            # Price position
            price_range = high - low
            if price_range > 0:
                position = (price - low) / price_range
                if signal == "BUY_SIGNAL" and position > 0.6:
                    reasons.append("Price near day high - strong buyer interest")
                elif signal == "SELL_SIGNAL" and position < 0.4:
                    reasons.append("Price near day low - strong seller pressure")
            
            # PCR analysis
            if pcr > 0:
                if pcr > 1.2 and signal == "BUY_SIGNAL":
                    confidence = min(confidence + 0.15, 1.0)
                    reasons.append(f"PCR bullish: {pcr:.2f} (more puts)")
                elif pcr < 0.8 and signal == "SELL_SIGNAL":
                    confidence = min(confidence + 0.15, 1.0)
                    reasons.append(f"PCR bearish: {pcr:.2f} (more calls)")
            
            # Trend alignment
            if trend == "bullish" and signal == "BUY_SIGNAL":
                confidence = min(confidence + 0.1, 1.0)
                reasons.append("Aligned with bullish trend")
            elif trend == "bearish" and signal == "SELL_SIGNAL":
                confidence = min(confidence + 0.1, 1.0)
                reasons.append("Aligned with bearish trend")
            
            # Calculate entry/targets - simple
            if signal == "BUY_SIGNAL":
                entry = price
                stop_loss = price * 0.995  # 0.5% stop
                target = price * 1.01      # 1% target (1:2 R:R)
            elif signal == "SELL_SIGNAL":
                entry = price
                stop_loss = price * 1.005
                target = price * 0.99
            else:
                entry = stop_loss = target = None
            
            return {
                "signal": signal,
                "confidence": round(confidence, 2),
                "reasons": reasons,
                "warnings": [],
                "entry_price": entry,
                "stop_loss": stop_loss,
                "target": target,
                "indicators": {
                    "price": price,
                    "change_percent": change_percent,
                    "trend": trend,
                    "volume": volume,
                    "high": high,
                    "low": low,
                    "open": open_price,
                    "pcr": pcr,
                    "oi": oi,
                    "volume_strength": "STRONG" if volume > 1000000 else "MODERATE",
                    "vwap_position": "ABOVE" if change_percent > 0 else "BELOW",
                    "rsi": None,  # RSI requires historical data - not available in instant mode
                    "support_level": low,
                    "resistance_level": high,
                    "prev_day_close": tick_data.get('close', price),
                },
                "timestamp": datetime.now().isoformat(),
                "symbol": tick_data.get('symbol', 'UNKNOWN'),
                "symbol_name": tick_data.get('symbol', 'UNKNOWN'),
            }
            
        except Exception as e:
            print(f"⚠️ Instant analysis error: {e}")
            return {
                "signal": "WAIT",
                "confidence": 0.0,
                "reasons": [],
                "warnings": ["Analysis unavailable"],
                "entry_price": None,
                "stop_loss": None,
                "target": None,
                "indicators": {
                    "price": 0,
                    "change_percent": 0,
                    "trend": "UNKNOWN",
                    "volume": 0,
                },
                "timestamp": datetime.now().isoformat(),
                "symbol": "ERROR",
                "symbol_name": "ERROR",
            }


async def get_instant_analysis(cache_service, symbol: str) -> Dict[str, Any]:
    """
    Get INSTANT analysis for a symbol - BLAZING FAST
    Uses only current tick data - no historical data needed
    Works even when market is closed using last traded data
    """
    try:
        # Get current tick from cache (will be last traded data if market is closed)
        tick_data = await cache_service.get_market_data(symbol)
        
        if not tick_data:
            return {
                "signal": "WAIT",
                "confidence": 0.0,
                "reasons": ["Waiting for market data..."],
                "warnings": ["No data available - check Zerodha connection"],
                "entry_price": None,
                "stop_loss": None,
                "target": None,
                "indicators": {
                    "price": 0,
                    "change_percent": 0,
                    "trend": "UNKNOWN",
                    "volume": 0,
                },
                "timestamp": datetime.now().isoformat(),
                "symbol": symbol,
                "symbol_name": symbol,
            }
        
        # Instant analysis
        result = InstantSignal.analyze_tick(tick_data)
        result['symbol'] = symbol
        
        # Add market status info
        market_status = tick_data.get('status', 'UNKNOWN')
        if market_status == 'OFFLINE':
            result['warnings'] = result.get('warnings', []) + [
                "⏸️ Last traded data"
            ]
        
        return result
        
    except Exception as e:
        print(f"❌ Instant analysis failed for {symbol}: {e}")
        return {
            "signal": "ERROR",
            "confidence": 0.0,
            "reasons": [],
            "warnings": [str(e)],
            "entry_price": None,
            "stop_loss": None,
            "target": None,
            "indicators": {},
            "timestamp": datetime.now().isoformat(),
            "symbol": symbol,
            "symbol_name": symbol,
        }


async def get_all_instant_analysis(cache_service) -> Dict[str, Dict[str, Any]]:
    """Get instant analysis for all symbols - ULTRA FAST"""
    symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
    
    # Parallel analysis for maximum speed
    tasks = [get_instant_analysis(cache_service, symbol) for symbol in symbols]
    results = await asyncio.gather(*tasks)
    
    return {symbol: result for symbol, result in zip(symbols, results)}
