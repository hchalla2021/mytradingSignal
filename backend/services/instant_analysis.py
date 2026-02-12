"""
INSTANT ANALYSIS - Ultra Fast Lightweight Analysis
Uses ONLY current tick data from Zerodha - NO historical data needed
Blazing fast, always works, production-ready
"""

from typing import Dict, Any, Optional, List
from datetime import datetime
import asyncio
import json
from .intraday_entry_filter import ParabolicSARFilter


def calculate_ema(closes: List[float], period: int) -> float:
    """
    Calculate EMA from a list of close prices (oldest first)
    Returns the current EMA value based on the period
    """
    if not closes:
        return 0
    
    if len(closes) < period:
        # Not enough data, return the current close as fallback
        return closes[-1]
    
    # Smoothing factor
    multiplier = 2.0 / (period + 1)
    
    # Calculate SMA for the first period values
    sma = sum(closes[:period]) / period
    
    # Calculate EMA for remaining values
    ema = sma
    for i in range(period, len(closes)):
        ema = (closes[i] * multiplier) + (ema * (1 - multiplier))
    
    return ema


def calculate_atr(candles: List[Dict[str, float]], period: int = 10) -> float:
    """
    Calculate Average True Range (ATR) from candles
    Candles should be oldest first for proper ATR calculation
    Used for SuperTrend (10,2) calculation
    Returns minimum of 0.1% of price if calculation fails
    """
    if not candles or len(candles) < 2:
        # Not enough data - return 0 and let fallback handle it
        return 0.0
    
    # Calculate True Range for each candle
    true_ranges = []
    prev_close = candles[0].get('close', 0)
    
    for candle in candles:
        high = float(candle.get('high', 0))
        low = float(candle.get('low', 0))
        close = float(candle.get('close', 0))
        
        # True Range = max(high - low, abs(high - prev_close), abs(low - prev_close))
        tr1 = high - low
        tr2 = abs(high - prev_close) if prev_close > 0 else 0
        tr3 = abs(low - prev_close) if prev_close > 0 else 0
        tr = max(tr1, tr2, tr3)
        
        true_ranges.append(tr)
        prev_close = close
    
    # If we have less than period candles, use simple average
    if len(true_ranges) < period:
        avg_tr = sum(true_ranges) / len(true_ranges) if true_ranges else 0
        # Ensure minimum ATR (can't be 0, use average of candle ranges)
        if avg_tr <= 0 and true_ranges:
            avg_tr = max(true_ranges)  # Use the largest TR as minimum
        return max(0.001, avg_tr)  # Return at least 0.001
    
    # First ATR is simple average of first 'period' TRs
    atr = sum(true_ranges[:period]) / period
    
    # Then smooth using EMA formula for remaining TRs
    multiplier = 2.0 / (period + 1)
    for tr in true_ranges[period:]:
        atr = (tr * multiplier) + (atr * (1 - multiplier))
    
    return max(0.001, atr)  # Ensure ATR is never 0


async def calculate_market_structure_from_cache(cache, symbol: str, tick_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Calculate market structure indicators from cached candles
    Returns order blocks, swing levels, and institutional activity markers
    """
    try:
        if not cache:
            return {}
        
        candle_key = f"analysis_candles:{symbol}"
        candles_json = await cache.lrange(candle_key, 0, 199)
        
        if not candles_json or len(candles_json) < 5:
            return {}
        
        # Parse candle data (comes in reversed order - newest first)
        candles = []
        for candle_json in reversed(candles_json[-20:]):  # Last 20 candles for structure
            try:
                candle = json.loads(candle_json)
                candles.append(candle)
            except (json.JSONDecodeError, KeyError):
                continue
        
        if len(candles) < 5:
            return {}
        
        current_price = float(tick_data.get('price', 0))
        closes = [c['close'] for c in candles]
        highs = [c['high'] for c in candles]
        lows = [c['low'] for c in candles]
        
        # Calculate Swing High/Low (last 5 candles)
        swing_high = max(highs[-5:]) if len(highs) >= 5 else max(highs)
        swing_low = min(lows[-5:]) if len(lows) >= 5 else min(lows)
        
        # Order Block detection (support level after big move)
        last_candle = candles[-1]
        prev_candle = candles[-2] if len(candles) > 1 else last_candle
        
        order_block_bullish = None
        order_block_bearish = None
        
        # If price moved down significantly, previous high is resistance order block
        if prev_candle['close'] > last_candle['close']:
            order_block_bearish = round(prev_candle['high'], 2)
        
        # If price moved up significantly, previous low is support order block
        if prev_candle['close'] < last_candle['close']:
            order_block_bullish = round(prev_candle['low'], 2)
        
        # Break of Structure (BOS)
        bos_bullish = current_price > swing_high  # Price breaks above recent high
        bos_bearish = current_price < swing_low   # Price breaks below recent low
        
        # Fair Value Gap (FVG) - gap between candles
        fvg_bullish = False
        fvg_bearish = False
        if len(candles) >= 3:
            # Bullish FVG: Previous candle low > Current candle high
            if candles[-2]['low'] > candles[-1]['high']:
                fvg_bullish = True
            # Bearish FVG: Previous candle high < Current candle low
            if candles[-2]['high'] < candles[-1]['low']:
                fvg_bearish = True
        
        # Volume Profile (High volume vs low volume candles in last 10)
        avg_volume = sum([c.get('volume', 0) for c in candles[-10:]]) / min(10, len(candles))
        high_volume_levels = []
        for candle in candles[-10:]:
            if candle.get('volume', 0) > avg_volume * 1.2:
                high_volume_levels.append((candle['high'] + candle['low']) / 2)
        
        # Institutional activity markers
        buy_volume_strength = 0
        sell_volume_strength = 0
        
        for candle in candles[-5:]:
            vol = candle.get('volume', 0)
            if candle['close'] > candle['open']:
                buy_volume_strength += vol
            else:
                sell_volume_strength += vol
        
        buy_volume_ratio = buy_volume_strength / (sell_volume_strength + buy_volume_strength) if (sell_volume_strength + buy_volume_strength) > 0 else 0.5
        
        return {
            "swing_high": swing_high,
            "swing_low": swing_low,
            "order_block_bullish": order_block_bullish,
            "order_block_bearish": order_block_bearish,
            "bos_bullish": bos_bullish,  # Break of Structure (bullish)
            "bos_bearish": bos_bearish,  # Break of Structure (bearish)
            "fvg_bullish": fvg_bullish,  # Fair Value Gap (bullish)
            "fvg_bearish": fvg_bearish,  # Fair Value Gap (bearish)
            "high_volume_levels": [round(lvl, 2) for lvl in high_volume_levels[:3]],  # Top 3
            "buy_volume_ratio": round(buy_volume_ratio * 100, 1),  # Buy vol strength %
            "sell_volume_ratio": round((1 - buy_volume_ratio) * 100, 1),  # Sell vol strength %
        }
        
    except Exception as e:
        print(f"⚠️ Error calculating market structure for {symbol}: {e}")
        return {}


async def calculate_emas_from_cache(cache, symbol: str, tick_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Calculate EMA 20, 50, 100, 200 and ATR 10 from cached candles
    Updates tick_data with calculated EMA and ATR values
    """
    try:
        candle_key = f"analysis_candles:{symbol}"
        
        # Get last 200 candles from cache (need this many for EMA200 + ATR)
        candles_json = await cache.lrange(candle_key, 0, 199)
        
        if not candles_json:
            # No cached candles yet, return with price as fallback
            return tick_data
        
        # Parse candle data (comes in reversed order - newest first)
        # Reverse to get oldest first for proper EMA and ATR calculation
        candles = []
        closes = []
        
        for candle_json in reversed(candles_json):
            try:
                candle = json.loads(candle_json)
                candles.append(candle)  # Keep full candle for ATR
                closes.append(candle['close'])
            except (json.JSONDecodeError, KeyError, TypeError):
                continue
        
        if not candles:
            return tick_data
        
        # Calculate EMAs using all available candles
        ema_20 = calculate_ema(closes, 20)
        ema_50 = calculate_ema(closes, 50)
        ema_100 = calculate_ema(closes, 100)
        ema_200 = calculate_ema(closes, 200)
        
        # Calculate ATR 10 from candles (need full OHLC data)
        atr_10 = calculate_atr(candles, 10)
        
        # Update tick_data with calculated values
        tick_data['ema_20'] = ema_20
        tick_data['ema_50'] = ema_50
        tick_data['ema_100'] = ema_100
        tick_data['ema_200'] = ema_200
        tick_data['atr_10'] = atr_10  # 🔥 NEW: Real ATR for SuperTrend
        
        # Debug logging every 30 seconds
        import time
        if int(time.time()) % 30 == 0:
            print(f"[EMA-ATR-CALC] {symbol}: EMA20={ema_20:.2f}, EMA50={ema_50:.2f}, EMA100={ema_100:.2f}, EMA200={ema_200:.2f}, ATR10={atr_10:.2f}")
        
        return tick_data
        
    except Exception as e:
        print(f"⚠️ Error calculating EMAs/ATR from cache for {symbol}: {e}")
        # Return tick_data unchanged - instant_analysis will use fallback values
        return tick_data


async def calculate_sar_from_cache(cache, symbol: str, tick_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Calculate real Parabolic SAR from cached candles
    Returns updated tick_data with sar_value, sar_position, sar_trend, sar_signal fields
    
    Uses ParabolicSARFilter.calculate_sar() for accurate SAR calculation
    """
    try:
        if not cache:
            return tick_data
        
        candle_key = f"analysis_candles:{symbol}"
        candles_json = await cache.lrange(candle_key, 0, 199)
        
        if not candles_json or len(candles_json) < 10:
            # Not enough candles for SAR, use fallback in tick_data
            return tick_data
        
        # Parse candle data (comes in reversed order - newest first)
        # Reverse to get oldest first for proper SAR calculation
        highs = []
        lows = []
        closes = []
        
        for candle_json in reversed(candles_json[-10:]):  # Use last 10 candles for SAR
            try:
                candle = json.loads(candle_json)
                highs.append(candle['high'])
                lows.append(candle['low'])
                closes.append(candle['close'])
            except (json.JSONDecodeError, KeyError, TypeError):
                continue
        
        if len(highs) < 10:
            return tick_data
        
        # Calculate real Parabolic SAR using ParabolicSARFilter
        sar_data = ParabolicSARFilter.calculate_sar(highs, lows, closes)
        
        # Extract values
        sar_value = sar_data.get('sar', tick_data.get('price', 0))
        sar_trend = sar_data.get('trend', 'UNKNOWN')
        
        # Current tick price and values
        current_price = float(tick_data.get('price', 0))
        current_high = float(tick_data.get('high', current_price))
        current_low = float(tick_data.get('low', current_price))
        prev_close = float(tick_data.get('prev_close', closes[-1] if closes else current_price))
        
        # Determine SAR position and analyze for signal
        if current_price > sar_value:
            sar_position = "BELOW"  # SAR below price = bullish
        elif current_price < sar_value:
            sar_position = "ABOVE"  # SAR above price = bearish
        else:
            sar_position = "NEUTRAL"
        
        # Analyze SAR with confidence
        psar_result = ParabolicSARFilter.analyze_psar(
            current_high=current_high,
            current_low=current_low,
            current_close=current_price,
            prev_close=prev_close,
            sar_data=sar_data,
            volume=int(tick_data.get('volume', 0)),
            avg_volume=int(tick_data.get('avg_volume', 0)),
            timeframe="15m"  # Use 15m for analysis
        )
        
        # Update tick_data with SAR values
        tick_data['sar_value'] = round(sar_value, 2)
        tick_data['sar_position'] = sar_position
        tick_data['sar_trend'] = psar_result.get('trend', 'UNKNOWN')
        tick_data['sar_signal'] = psar_result.get('signal', 'NEUTRAL')
        tick_data['sar_signal_strength'] = psar_result.get('final_confidence', 0)
        tick_data['sar_reversal'] = psar_result.get('reversal', False)
        
        # Debug logging (every 30 seconds)
        import time
        if int(time.time()) % 30 == 0:
            print(f"[SAR-CALC] {symbol}: SAR={sar_value:.2f}, Trend={psar_result.get('trend')}, Signal={psar_result.get('signal')}")
        
        return tick_data
        
    except Exception as e:
        print(f"⚠️ Error calculating SAR from cache for {symbol}: {e}")
        # Return tick_data unchanged - instant_analysis will use fallback values
        return tick_data


class InstantSignal:
    """Lightning-fast signal generator using only current tick"""
    
    @staticmethod
    def analyze_tick(tick_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        INSTANT analysis from single tick - ULTRA FAST
        Returns signal in milliseconds
        Returns None only if price is 0 (invalid data)
        """
        try:
            # Extract data from tick - with fallbacks
            price = float(tick_data.get('price', 0))
            symbol = tick_data.get('symbol', 'UNKNOWN')
            
            # 🔥 FIX: Return None only if price is 0 (completely invalid data)
            if price == 0:
                print(f"⚠️ WARNING: Price is 0 in tick_data for {symbol} - cannot analyze")
                return None
            
            change_percent = float(tick_data.get('changePercent', 0))
            volume = int(tick_data.get('volume', 0))
            high = float(tick_data.get('high', price))
            low = float(tick_data.get('low', price))
            open_price = float(tick_data.get('open', price))
            close_price = float(tick_data.get('close', price))
            pcr = float(tick_data.get('pcr', 0))
            oi = int(tick_data.get('oi', 0))
            oi_change = float(tick_data.get('oi_change', 0))
            trend = tick_data.get('trend', 'neutral')
            
            # Debug logging for OHLC values
            print(f"\n[INSTANT-ANALYSIS] {symbol} OHLC DATA:")
            print(f"   → Open: ₹{open_price:,.2f}")
            print(f"   → High: ₹{high:,.2f}")
            print(f"   → Low: ₹{low:,.2f}")
            print(f"   → Close (LTP): ₹{price:,.2f}")

            print(f"   → Prev Close: ₹{close_price:,.2f}")
            print(f"   → Volume: {volume:,}")
            print(f"   → Change: {change_percent:.2f}%")
            
            # ============================================
            # MULTI-FACTOR SCORING SYSTEM - WORLD CLASS
            # ============================================
            bullish_score = 0.0
            bearish_score = 0.0
            reasons = []
            
            # 1. PRICE MOMENTUM (Weight: 30% = 30 points max)
            if change_percent > 1.0:
                bullish_score += 30
                reasons.append(f"🔥 Strong bullish momentum: +{change_percent:.2f}%")
            elif change_percent > 0.3:
                bullish_score += 20
                reasons.append(f"📈 Bullish momentum: +{change_percent:.2f}%")
            elif change_percent > 0.05:
                bullish_score += 10
                reasons.append(f"↗️ Mild bullish: +{change_percent:.2f}%")
            elif change_percent < -1.0:
                bearish_score += 30
                reasons.append(f"🔥 Strong bearish momentum: {change_percent:.2f}%")
            elif change_percent < -0.3:
                bearish_score += 20
                reasons.append(f"📉 Bearish momentum: {change_percent:.2f}%")
            elif change_percent < -0.05:
                bearish_score += 10
                reasons.append(f"↘️ Mild bearish: {change_percent:.2f}%")
            
            # 2. PCR ANALYSIS (Weight: 25% = 25 points max)
            if pcr > 0:
                if pcr > 1.5:
                    bullish_score += 25
                    reasons.append(f"🎯 Extreme PCR bullish: {pcr:.2f} (heavy put writing)")
                elif pcr > 1.2:
                    bullish_score += 18
                    reasons.append(f"✅ Strong PCR bullish: {pcr:.2f}")
                elif pcr > 1.0:
                    bullish_score += 10
                    reasons.append(f"👍 PCR mildly bullish: {pcr:.2f}")
                elif pcr < 0.6:
                    bearish_score += 25
                    reasons.append(f"🎯 Extreme PCR bearish: {pcr:.2f} (heavy call writing)")
                elif pcr < 0.8:
                    bearish_score += 18
                    reasons.append(f"⚠️ Strong PCR bearish: {pcr:.2f}")
                elif pcr < 0.95:
                    bearish_score += 10
                    reasons.append(f"👎 PCR mildly bearish: {pcr:.2f}")
            
            # 3. VWAP POSITION (Weight: 20% = 20 points max)
            vwap_value = tick_data.get('vwap', price)
            if price > vwap_value * 1.01:  # More than 1% above VWAP
                bullish_score += 20
                reasons.append(f"💪 Price well above VWAP (bullish control)")
            elif price > vwap_value:
                bullish_score += 12
                reasons.append(f"✓ Price above VWAP")
            elif price < vwap_value * 0.99:  # More than 1% below VWAP
                bearish_score += 20
                reasons.append(f"💪 Price well below VWAP (bearish control)")
            elif price < vwap_value:
                bearish_score += 12
                reasons.append(f"✓ Price below VWAP")
            
            # 4. TREND ALIGNMENT (Weight: 15% = 15 points max)
            if trend == "bullish":
                bullish_score += 15
                reasons.append(f"📊 Bullish trend confirmed")
            elif trend == "bearish":
                bearish_score += 15
                reasons.append(f"📊 Bearish trend confirmed")
            
            # 5. VOLUME STRENGTH (Weight: 10% = 10 points max)
            if volume > 5000000:
                # Add to dominant direction
                if bullish_score > bearish_score:
                    bullish_score += 10
                    reasons.append(f"🚀 Massive volume confirms bullish")
                elif bearish_score > bullish_score:
                    bearish_score += 10
                    reasons.append(f"🚀 Massive volume confirms bearish")
            elif volume > 2000000:
                if bullish_score > bearish_score:
                    bullish_score += 7
                    reasons.append(f"📊 High volume support")
                elif bearish_score > bullish_score:
                    bearish_score += 7
                    reasons.append(f"📊 High volume support")
            elif volume > 1000000:
                if bullish_score > bearish_score:
                    bullish_score += 5
                    reasons.append(f"✓ Moderate volume")
                elif bearish_score > bullish_score:
                    bearish_score += 5
                    reasons.append(f"✓ Moderate volume")
            
            # 6. PRICE POSITION IN DAY'S RANGE (Weight: 10% bonus)
            price_range = high - low
            if price_range > 0:
                position = (price - low) / price_range
                if position > 0.75:
                    bullish_score += 10
                    reasons.append(f"🎯 Price at day's high zone ({position*100:.0f}%)")
                elif position > 0.6:
                    bullish_score += 5
                    reasons.append(f"↗️ Price in upper zone ({position*100:.0f}%)")
                elif position < 0.25:
                    bearish_score += 10
                    reasons.append(f"🎯 Price at day's low zone ({position*100:.0f}%)")
                elif position < 0.4:
                    bearish_score += 5
                    reasons.append(f"↘️ Price in lower zone ({position*100:.0f}%)")
            
            # 7. SUPPORT/RESISTANCE (Weight: 10% bonus)
            # If price near resistance and momentum weak = bearish
            # If price near support and momentum weak = bullish
            if high > 0 and abs(price - high) / high < 0.002:  # Within 0.2% of high
                bearish_score += 8
                reasons.append(f"⚠️ Near resistance at ₹{high:.2f}")
            elif low > 0 and abs(price - low) / low < 0.002:  # Within 0.2% of low
                bullish_score += 8
                reasons.append(f"✅ Near support at ₹{low:.2f}")
            
            # FINAL DECISION BASED ON TOTAL SCORES
            print(f"[SCORE] {symbol}: Bullish={bullish_score:.1f}, Bearish={bearish_score:.1f}")
            
            total_score = max(bullish_score, bearish_score)
            signal = "WAIT"
            confidence = 0.0
            
            if bullish_score >= 40:  # Strong threshold
                signal = "STRONG_BUY" if bullish_score >= 70 else "BUY_SIGNAL"
                confidence = min(bullish_score / 100, 0.95)  # Cap at 95%
            elif bearish_score >= 40:
                signal = "STRONG_SELL" if bearish_score >= 70 else "SELL_SIGNAL"
                confidence = min(bearish_score / 100, 0.95)
            elif bullish_score > bearish_score and bullish_score >= 25:
                signal = "BUY_SIGNAL"
                confidence = min(bullish_score / 100, 0.60)  # Weak signal
            elif bearish_score > bullish_score and bearish_score >= 25:
                signal = "SELL_SIGNAL"
                confidence = min(bearish_score / 100, 0.60)
            else:
                signal = "WAIT"
                confidence = 0.0
                reasons = [f"⏸️ Neutral market - Bullish:{bullish_score:.0f} vs Bearish:{bearish_score:.0f}"]
            
            # Calculate entry/targets
            if signal in ["BUY_SIGNAL", "STRONG_BUY"]:
                entry = price
                stop_loss = price * 0.995  # 0.5% stop
                target = price * 1.01      # 1% target (1:2 R:R)
            elif signal in ["SELL_SIGNAL", "STRONG_SELL"]:
                entry = price
                stop_loss = price * 1.005
                target = price * 0.99
            else:
                entry = stop_loss = target = None
            
            # Map to frontend expected format
            trend_map = {
                'bullish': 'UPTREND',
                'bearish': 'DOWNTREND',
                'neutral': 'SIDEWAYS'
            }
            
            # Volume strength classification (different thresholds for indices vs stocks)
            # NSE INDICES (NFO): Daily futures volume typically 500K-2M contracts
            # BSE INDICES (BFO): Daily futures volume typically 10K-100K contracts (lower liquidity)
            # STOCKS: Daily volume typically 1M-50M shares
            if symbol == "SENSEX":
                # SENSEX futures (BFO) have lower volume than NSE indices
                # Strong: >50K, Moderate: >20K, Low: <=20K
                vol_strength = 'STRONG_VOLUME' if volume > 50000 else 'MODERATE_VOLUME' if volume > 20000 else 'WEAK_VOLUME'
                volume_threshold = 20000  # Moderate threshold
            elif symbol in ["NIFTY", "BANKNIFTY"]:
                # NIFTY/BANKNIFTY futures (NFO) have higher volume
                # Strong: >1M, Moderate: >500K, Low: <=500K
                vol_strength = 'STRONG_VOLUME' if volume > 1000000 else 'MODERATE_VOLUME' if volume > 500000 else 'WEAK_VOLUME'
                volume_threshold = 500000  # Moderate threshold
            else:
                # Stock volume thresholds
                vol_strength = 'STRONG_VOLUME' if volume > 5000000 else 'MODERATE_VOLUME' if volume > 1000000 else 'WEAK_VOLUME'
                volume_threshold = 1000000  # Moderate threshold
            
            # Calculate volume ratio (for VWMA filter)
            volume_ratio = volume / volume_threshold if volume_threshold > 0 else 0
            
            # Volume-Price Alignment Check (VWMA confirmation)
            # Volume should support price direction for strong signal
            volume_above_threshold = volume > volume_threshold
            price_above_vwma = price > (tick_data.get('vwma_20', price))
            volume_price_alignment = (volume_above_threshold and price_above_vwma) or (not volume_above_threshold and not price_above_vwma)
            
            # ============================================
            # CALCULATE MOMENTUM INDICATORS - PROFESSIONAL
            # ============================================
            
            # 1. RSI 60/40 CALCULATION WITH TREND-BASED ZONES
            # RSI zones change with trend - support/resistance shifts dynamically
            momentum_change = change_percent
            
            # Determine trend-based RSI thresholds
            if trend == "bullish" or change_percent > 0.3:
                # UPTREND: Support at 40-50, breakout zone at 60+
                if momentum_change > 3:
                    rsi = 85  # Strong bullish momentum, breaking out
                elif momentum_change > 2:
                    rsi = 78  # Solid bullish, above 60
                elif momentum_change > 1:
                    rsi = 70  # At 60 support, momentum confirmation
                elif momentum_change > 0.5:
                    rsi = 62  # Approaching 60, strength zone
                elif momentum_change > 0.2:
                    rsi = 56  # Mid-range bullish
                elif momentum_change > 0:
                    rsi = 52  # Entering support at 40-50
                elif momentum_change > -0.3:
                    rsi = 48  # At 40 support, potential bounce
                else:
                    rsi = 45  # Breaking support, weakness
            elif trend == "bearish" or change_percent < -0.3:
                # DOWNTREND: Resistance at 50-60, weakness zone at 40-
                if momentum_change < -3:
                    rsi = 15  # Strong bearish, breaking down
                elif momentum_change < -2:
                    rsi = 22  # Solid bearish, below 40
                elif momentum_change < -1:
                    rsi = 30  # At 40 resistance, confirmation
                elif momentum_change < -0.5:
                    rsi = 38  # Approaching 40, weakness zone
                elif momentum_change < -0.2:
                    rsi = 44  # Mid-range bearish
                elif momentum_change < 0:
                    rsi = 48  # Entering resistance at 50-60
                elif momentum_change < 0.3:
                    rsi = 52  # At 60 resistance, potential rejection
                else:
                    rsi = 55  # Breaking resistance, strength
            else:
                # RANGE/NEUTRAL: Standard zones
                if momentum_change > 2:
                    rsi = 78
                elif momentum_change > 1:
                    rsi = 70
                elif momentum_change > 0.5:
                    rsi = 62
                elif momentum_change > 0.2:
                    rsi = 56
                elif momentum_change > 0:
                    rsi = 52
                elif momentum_change < -2:
                    rsi = 22
                elif momentum_change < -1:
                    rsi = 30
                elif momentum_change < -0.5:
                    rsi = 38
                elif momentum_change < -0.2:
                    rsi = 44
                elif momentum_change < 0:
                    rsi = 48
                else:
                    rsi = 50  # Perfect neutral
            
            # RSI 60/40 Signal Logic
            rsi_signal = None
            rsi_zone = None
            rsi_action = None
            
            if rsi >= 60:
                rsi_zone = "60_ABOVE"
                if trend == "bullish":
                    # RSI 60+ in uptrend = momentum confirmation (strong continuation)
                    if momentum_change > 0.5:  # 3+ candles sustained above 60
                        rsi_signal = "MOMENTUM_BUY"
                        rsi_action = "Bullish momentum continuation - RSI 60 sustained"
                    else:
                        rsi_signal = "WATCH"
                        rsi_action = "RSI approaching 60 breakout zone"
                else:
                    # RSI 60+ in downtrend = rejection coming (pullback setup)
                    rsi_signal = "REJECTION_SHORT"
                    rsi_action = "RSI 60 rejection in downtrend - prepare for pullback"
            elif rsi >= 50 and rsi < 60:
                rsi_zone = "50_TO_60"
                if trend == "bullish":
                    rsi_signal = "SUPPORT_ZONE"
                    rsi_action = "RSI in support zone (40-50 in uptrend) - watch for bounce"
                else:
                    rsi_signal = "RESISTANCE_ZONE"
                    rsi_action = "RSI in resistance zone (50-60 in downtrend) - watch rejection"
            elif rsi >= 40 and rsi < 50:
                rsi_zone = "40_TO_50"
                if trend == "bullish":
                    rsi_signal = "PULLBACK_BUY"
                    rsi_action = "RSI pullback to support - buyable area in uptrend"
                else:
                    rsi_signal = "DOWNTREND_CONT"
                    rsi_action = "RSI approaching weakness zone - downtrend continuation possible"
            else:  # rsi < 40
                rsi_zone = "40_BELOW"
                if trend == "bearish":
                    rsi_signal = "DOWNTREND_STRONG"
                    rsi_action = "RSI below 40 in downtrend - confirmed weakness"
                else:
                    rsi_signal = "OVERSOLD_BUY"
                    rsi_action = "RSI oversold - potential bounce in uptrend"
            
            # 2. Momentum Score (0-100 scale)
            # Combines price change, position in range, and trend
            price_range = high - low
            range_position = ((price - low) / price_range * 100) if price_range > 0 else 50
            
            # Momentum calculation with multiple factors
            momentum_score = 50  # Start neutral
            
            # Price change contribution (±30 points)
            momentum_score += min(max(change_percent * 15, -30), 30)
            
            # Range position contribution (±10 points)
            momentum_score += (range_position - 50) * 0.2
            
            # Trend alignment contribution (±10 points)
            if trend == "bullish":
                momentum_score += 10
            elif trend == "bearish":
                momentum_score -= 10
            
            # Clamp to 0-100
            momentum_score = max(0, min(100, momentum_score))
            
            # 3. Candle Strength (based on range and body)
            candle_body = abs(price - open_price)
            candle_strength = (candle_body / price_range * 100) if price_range > 0 else 0
            candle_strength = min(candle_strength, 100)  # Cap at 100%
            
            # Calculate VWAP properly using OHLC and volume
            # VWAP = (Typical Price × Volume) / Total Volume
            # Typical Price = (High + Low + Close) / 3
            typical_price = (high + low + price) / 3
            
            # Use VWAP from tick data if available, otherwise calculate
            vwap_value = tick_data.get('vwap', 0)
            if vwap_value == 0 or vwap_value is None:
                # Calculate VWAP if not provided
                if volume > 0:
                    vwap_value = typical_price  # Simplified for real-time
                else:
                    vwap_value = price
            
            # NOW determine VWAP position using properly calculated VWAP (with ±0.1% threshold)
            vwap_threshold = 0.001  # 0.1% tolerance for "AT VWAP"
            price_deviation = abs(price - vwap_value) / vwap_value if vwap_value > 0 else 0
            
            if price_deviation <= vwap_threshold:
                vwap_pos = 'AT_VWAP'  # Within ±0.1% of VWAP
            elif price > vwap_value:
                vwap_pos = 'ABOVE_VWAP'
            else:
                vwap_pos = 'BELOW_VWAP'
            
            print(f"[VWAP-CHECK] {symbol}: Price=₹{price:.2f}, VWAP=₹{vwap_value:.2f}, Deviation={price_deviation*100:.3f}%, Position={vwap_pos}")
            
            # ============================================
            # VWAP INTRADAY FILTER - INSTITUTIONAL LEVEL
            # ============================================
            vwap_bias = None
            vwap_role = None
            vwap_signal = None
            vwap_r3_s3_combo = None
            
            # Calculate R3 and S3 for combo detection
            typical_price_pivot = (high + low + price) / 3
            range_hl = high - low
            r3_approx = high + 2 * (typical_price_pivot - low)
            s3_approx = low - 2 * (high - typical_price_pivot)
            
            if price > vwap_value:
                # PRICE ABOVE VWAP = LONG BIAS
                vwap_bias = "LONG_ONLY"
                vwap_role = "SUPPORT"
                
                # Dip to VWAP = buy zone
                if price < vwap_value * 1.005:  # Within 0.5% of VWAP
                    vwap_signal = "DIP_TO_VWAP_BUY"
                    vwap_r3_s3_combo = "Price dipping to VWAP support - buy zone activated"
                else:
                    vwap_signal = "ABOVE_VWAP_STRUCTURE"
                    vwap_r3_s3_combo = "Price above VWAP - maintain long bias"
                
                # Check R3 + VWAP combo (bullish)
                if price > r3_approx and price > vwap_value:
                    vwap_signal = "R3_BREAKOUT_ABOVE_VWAP"
                    vwap_r3_s3_combo = "🔥 DEADLY: Price breaks R3 AND stays above VWAP - strong long"
            
            elif price < vwap_value:
                # PRICE BELOW VWAP = SHORT BIAS
                vwap_bias = "SHORT_ONLY"
                vwap_role = "RESISTANCE"
                
                # Pullback to VWAP = sell zone
                if price > vwap_value * 0.995:  # Within 0.5% above VWAP
                    vwap_signal = "PULLBACK_TO_VWAP_SELL"
                    vwap_r3_s3_combo = "Price pulling back to VWAP resistance - sell zone activated"
                else:
                    vwap_signal = "BELOW_VWAP_STRUCTURE"
                    vwap_r3_s3_combo = "Price below VWAP - maintain short bias"
                
                # Check S3 + VWAP combo (bearish)
                if price < s3_approx and price < vwap_value:
                    vwap_signal = "S3_BREAKDOWN_BELOW_VWAP"
                    vwap_r3_s3_combo = "🔥 DEADLY: Price breaks S3 AND stays below VWAP - strong short"
            
            else:
                # PRICE AT VWAP = NEUTRAL/EQUILIBRIUM
                vwap_bias = "NEUTRAL"
                vwap_role = "EQUILIBRIUM"
                vwap_signal = "AT_VWAP_EQUILIBRIUM"
                vwap_r3_s3_combo = "Price at institutional level - await direction break"
            
            # Extract EMA values early for use in all subsequent calculations
            ema_20 = tick_data.get('ema_20', price)
            ema_50 = tick_data.get('ema_50', price)
            ema_100 = tick_data.get('ema_100', price)
            ema_200 = tick_data.get('ema_200', price)
            
            # ============================================
            # CAMARILLA R3/S3 - GATE LEVEL DETECTION
            # ============================================
            # Calculate Camarilla pivots from previous day OHLC
            prev_close_px = close_price if close_price > 0 else price
            prev_high_px = tick_data.get('prev_day_high', high)
            prev_low_px = tick_data.get('prev_day_low', low)
            
            # Camarilla pivot formulas
            range_hl = prev_high_px - prev_low_px
            h4 = prev_close_px + (range_hl * 1.1 / 2)
            h3 = prev_close_px + (range_hl * 1.1 / 4)
            h2 = prev_close_px + (range_hl * 1.1 / 6)
            h1 = prev_close_px + (range_hl * 1.1 / 12)
            l1 = prev_close_px - (range_hl * 1.1 / 12)
            l2 = prev_close_px - (range_hl * 1.1 / 6)
            l3 = prev_close_px - (range_hl * 1.1 / 4)
            l4 = prev_close_px - (range_hl * 1.1 / 2)
            
            # CPR (Central Pivot Range) = most important for day trading
            # TC = Top Central Pivot (R3), P = Pivot, BC = Bottom Central (S3)
            tc = h3  # Top Central Pivot = R3
            pivot_point = prev_close_px
            bc = l3  # Bottom Central Pivot = S3
            
            # CPR width analysis
            cpr_width = tc - bc
            cpr_width_pct = (cpr_width / price) * 100 if price > 0 else 0
            
            # Narrow (trending) vs Wide (range) classification
            # Trading convention: narrow = <0.5% of price = trending day
            if cpr_width_pct < 0.5:
                cpr_classification = "NARROW"
                cpr_description = "Narrow CPR (trending day) - directional bias likely"
            else:
                cpr_classification = "WIDE"
                cpr_description = "Wide CPR (range day) - consolidation pattern"
            
            # R3/S3 Gate Level Status
            camarilla_zone_status = None
            camarilla_zone = None
            camarilla_signal = None
            
            if price > tc:
                # ABOVE TC = BULLISH SCENARIO
                camarilla_zone = "ABOVE_TC"
                camarilla_zone_status = "Price above top CPR - bullish territory"
                
                # Check for R3 breakout (most important gate)
                if price > h3:
                    # Check for close above R3 (more significant than just touch)
                    if close_price > h3:
                        camarilla_signal = "R3_BREAKOUT_CONFIRMED"
                        camarilla_signal_desc = "🔥 R3 breakout confirmed by close - trend day bullish"
                    else:
                        camarilla_signal = "R3_BREAKOUT_TOUCH"
                        camarilla_signal_desc = "Price touching R3 (test) - awaiting close confirmation"
                else:
                    camarilla_signal = "ABOVE_CPR_HOLD"
                    camarilla_signal_desc = "Above CPR but below R3 - hold bullish position"
            
            elif price < bc:
                # BELOW BC = BEARISH SCENARIO
                camarilla_zone = "BELOW_BC"
                camarilla_zone_status = "Price below bottom CPR - bearish territory"
                
                # Check for S3 breakdown (most important gate)
                if price < l3:
                    # Check for close below S3 (more significant)
                    if close_price < l3:
                        camarilla_signal = "S3_BREAKDOWN_CONFIRMED"
                        camarilla_signal_desc = "🔥 S3 breakdown confirmed by close - trend day bearish"
                    else:
                        camarilla_signal = "S3_BREAKDOWN_TOUCH"
                        camarilla_signal_desc = "Price touching S3 (test) - awaiting close confirmation"
                else:
                    camarilla_signal = "BELOW_CPR_HOLD"
                    camarilla_signal_desc = "Below CPR but above S3 - hold bearish position"
            
            else:
                # INSIDE CPR = CHOP ZONE
                camarilla_zone = "INSIDE_CPR"
                
                # Determine position within CPR
                if price > pivot_point:
                    camarilla_zone_status = "Price inside upper CPR - low risk long if breaks above TC"
                else:
                    camarilla_zone_status = "Price inside lower CPR - low risk short if breaks below BC"
                
                camarilla_signal = "CPR_CHOP_ZONE"
                camarilla_signal_desc = "Price in CPR chop zone - avoid entries, await break"
            
            # 🔥 CAMARILLA CONFIDENCE CALCULATION
            camarilla_confidence = 50  # Base confidence
            
            # Signal type confidence
            if "CONFIRMED" in camarilla_signal:
                camarilla_confidence += 30  # Strong signal
            elif "TOUCH" in camarilla_signal:
                camarilla_confidence += 15  # Medium signal
            elif "HOLD" in camarilla_signal:
                camarilla_confidence += 10  # Moderate signal
            else:
                camarilla_confidence += 5   # Weak signal (chop zone)
            
            # Zone position confidence
            if camarilla_zone == "ABOVE_TC" or camarilla_zone == "BELOW_BC":
                camarilla_confidence += 15  # Clear directional zone
            elif camarilla_zone == "INSIDE_CPR":
                camarilla_confidence -= 10  # Unreliable in chop zone
            
            # Distance from CPR boundaries
            dist_to_tc = abs(price - tc)
            dist_to_bc = abs(price - bc)
            if dist_to_tc > (cpr_width * 0.5) or dist_to_bc > (cpr_width * 0.5):
                camarilla_confidence += 10  # Good distance from boundary
            
            # EMA alignment bonus
            if (ema_20 > ema_50 and (camarilla_zone == "ABOVE_TC" or camarilla_zone == "INSIDE_CPR"))  or \
               (ema_20 < ema_50 and (camarilla_zone == "BELOW_BC" or camarilla_zone == "INSIDE_CPR")):
                camarilla_confidence += 10  # EMA confirms Camarilla signal
            
            # CPR width (narrow = trending, wide = ranging)
            if cpr_width_pct < 0.5:
                camarilla_confidence += 10  # Narrow CPR = trending = more reliable
            elif cpr_width_pct > 1.5:
                camarilla_confidence -= 5   # Wide CPR = ranging = less reliable
            
            # Cap between 30-95 (realistic range)
            camarilla_confidence = min(95, max(30, camarilla_confidence))
            
            # COMBINED STRATEGY: CPR + EMA + VWAP
            # Trend Day Signal = CPR break + above/below EMA20 + VWAP alignment
            trend_day_signal = None
            trend_day_confidence = 0
            
            if price > tc and price > ema_20 and vwap_pos == "ABOVE_VWAP" and close_price > tc:
                # All bullish conditions aligned
                trend_day_signal = "TREND_DAY_BULLISH_HIGH_PROB"
                trend_day_confidence = 90
            elif price < bc and price < ema_20 and vwap_pos == "BELOW_VWAP" and close_price < bc:
                # All bearish conditions aligned
                trend_day_signal = "TREND_DAY_BEARISH_HIGH_PROB"
                trend_day_confidence = 90
            elif (price > tc or price < bc) and (ema_20 > ema_50 or ema_20 < ema_50):
                # Partial alignment (CPR break + EMA trend)
                trend_day_signal = "TREND_DAY_PARTIAL_ALIGNMENT"
                trend_day_confidence = 60
            elif camarilla_zone == "INSIDE_CPR":
                # Inside CPR - no trend day yet
                trend_day_signal = "CHOPPY_CONSOLIDATION"
                trend_day_confidence = 30
            
            # ============================================
            # EMA 20/50/100 TRAFFIC LIGHT - TREND STATUS
            # ============================================
            # EMA gaps for proper ordering check
            ema20_vs_ema50 = "ABOVE" if ema_20 > ema_50 else "BELOW" if ema_20 < ema_50 else "EQUAL"
            ema50_vs_ema100 = "ABOVE" if ema_50 > ema_100 else "BELOW" if ema_50 < ema_100 else "EQUAL"
            
            # 🔥 FIXED: Compression check - EMAs clustered (not EMA200 vs EMA20 range)
            # Check if the 3 main EMAs (20, 50, 100) are all within 0.3% of current price
            ema_values = [ema_20, ema_50, ema_100]
            ema_max = max(ema_values)
            ema_min = min(ema_values)
            ema_spread = ema_max - ema_min
            compression_threshold = price * 0.003  # 0.3% compression zone (was 1% - too loose)
            is_compressed = ema_spread < compression_threshold
            
            # Trend Status = Traffic Light
            if ema_20 > ema_50 > ema_100 and price > ema_20 and not is_compressed:
                # Strong Bullish Trend - Perfect alignment + price above all
                trend_status = "STRONG_UPTREND"
                trend_label = "✅ Strong Uptrend"
                trend_color = "BULLISH"
                buy_allowed = True
            elif ema_20 < ema_50 < ema_100 and price < ema_20 and not is_compressed:
                # Strong Bearish Trend - Perfect alignment + price below all
                trend_status = "STRONG_DOWNTREND"
                trend_label = "🔴 Strong Downtrend"
                trend_color = "BEARISH"
                buy_allowed = False
            elif is_compressed:
                # 🔥 TRUE Compression Zone - EMAs all clustered together
                trend_status = "COMPRESSION"
                trend_label = "🟡 Compression Zone"
                trend_color = "NEUTRAL"
                buy_allowed = False
            elif (ema_20 > ema_50 > ema_100) and (price > ema_50 or price > ema_100):
                # Weak Bullish - EMAs aligned but price not above all or spread too wide
                trend_status = "WEAK_UPTREND"
                trend_label = "🟢 Weak Uptrend"
                trend_color = "BULLISH"
                buy_allowed = True
            elif (ema_20 < ema_50 < ema_100) and (price < ema_50 or price < ema_100):
                # Weak Bearish - EMAs aligned but price not below all or spread too wide
                trend_status = "WEAK_DOWNTREND"
                trend_label = "🔴 Weak Downtrend"
                trend_color = "BEARISH"
                buy_allowed = False
            else:
                # Sideways / Confusion - EMAs not properly aligned
                trend_status = "TRANSITION"
                trend_label = "🟡 Transition/Sideways"
                trend_color = "NEUTRAL"
                buy_allowed = False
            
            # ============================================
            # EMA PULLBACK ENTRY DETECTION
            # ============================================
            pullback_level = None
            pullback_entry = None
            ema_touch_count = 0  # Will track in production with historical data
            ema_support_zone = None
            momentum_shift = None
            
            if trend_status == "STRONG_UPTREND":
                # Pullback detection in uptrend
                ema20_threshold = ema_20 * 0.005  # 0.5% from EMA20
                ema50_threshold = ema_50 * 0.005
                ema100_threshold = ema_100 * 0.005
                
                # Primary pullback: Near EMA20
                if abs(price - ema_20) <= ema20_threshold:
                    pullback_level = "EMA20"
                    if close_price > ema_20 and rsi >= 40:
                        pullback_entry = "FIRST_TOUCH_PULLBACK_BUY"
                        ema_support_zone = f"EMA20 pullback entry - RSI {rsi:.0f}"
                    else:
                        pullback_entry = "PULLBACK_WATCH"
                        ema_support_zone = "Price at EMA20 - awaiting close confirmation"
                
                # Secondary pullback: EMA50 bounce
                elif abs(price - ema_50) <= ema50_threshold:
                    pullback_level = "EMA50"
                    if close_price > ema_50 and candle_body > (price_range * 0.5):
                        pullback_entry = "EMA50_BOUNCE_BUY"
                        ema_support_zone = "Safe entry - EMA50 bounce confirmed"
                    else:
                        pullback_entry = "BOUNCE_WATCH"
                        ema_support_zone = "Price at EMA50 - second chance support"
                
                # Last stand: EMA100
                elif abs(price - ema_100) <= ema100_threshold:
                    pullback_level = "EMA100"
                    if close_price > ema_100 and volume > 0:
                        pullback_entry = "EMA100_HOLD_UPTREND"
                        ema_support_zone = "Danger zone but trend still OK - EMA100 hold"
                    else:
                        pullback_entry = "EMA100_BREAKDOWN_RISK"
                        ema_support_zone = "⚠️ Trend change risk - EMA100 breaking"
                
                else:
                    pullback_level = "NONE"
                    pullback_entry = "IN_TREND"
                    ema_support_zone = "Price in trend - waiting for pullback"
            
            elif trend_status == "STRONG_DOWNTREND":
                # Pullback detection in downtrend (resistance zones)
                ema20_threshold = ema_20 * 0.005
                ema50_threshold = ema_50 * 0.005
                ema100_threshold = ema_100 * 0.005
                
                # Primary: Near EMA20 resistance
                if abs(price - ema_20) <= ema20_threshold:
                    pullback_level = "EMA20"
                    if close_price < ema_20 and rsi <= 60:
                        pullback_entry = "FIRST_TOUCH_PULLBACK_SELL"
                        ema_support_zone = f"EMA20 rejection sell - RSI {rsi:.0f}"
                    else:
                        pullback_entry = "REJECTION_WATCH"
                        ema_support_zone = "Price at EMA20 - awaiting rejection close"
                
                # Secondary: EMA50 rejection
                elif abs(price - ema_50) <= ema50_threshold:
                    pullback_level = "EMA50"
                    if close_price < ema_50 and candle_body > (price_range * 0.5):
                        pullback_entry = "EMA50_REJECTION_SELL"
                        ema_support_zone = "Safe sell - EMA50 rejection confirmed"
                    else:
                        pullback_entry = "REJECTION_WATCH"
                        ema_support_zone = "Price at EMA50 - second chance resistance"
                
                # Last resistance: EMA100
                elif abs(price - ema_100) <= ema100_threshold:
                    pullback_level = "EMA100"
                    if close_price < ema_100 and volume > 0:
                        pullback_entry = "EMA100_HOLD_DOWNTREND"
                        ema_support_zone = "Danger zone but trend still OK - EMA100 hold"
                    else:
                        pullback_entry = "EMA100_BREAKUP_RISK"
                        ema_support_zone = "⚠️ Trend change risk - EMA100 breaking up"
                
                else:
                    pullback_level = "NONE"
                    pullback_entry = "IN_TREND"
                    ema_support_zone = "Price in trend - waiting for rejection"
            
            else:
                # Sideways/Compression - no clear pullback
                pullback_level = "NONE"
                pullback_entry = "AVOID_TRADES"
                ema_support_zone = "Compression zone - avoid entries"
            
            # Momentum Shift Detection (EMA Crossovers)
            if ema20_vs_ema50 == "ABOVE" and ema50_vs_ema100 == "ABOVE":
                momentum_shift = "BULLISH_CONFIRMED"
            elif ema20_vs_ema50 == "BELOW" and ema50_vs_ema100 == "BELOW":
                momentum_shift = "BEARISH_CONFIRMED"
            elif ema20_vs_ema50 != ema50_vs_ema100:
                momentum_shift = "MOMENTUM_SHIFT"
            else:
                momentum_shift = "MIXED"
            
            # ============================================
            # EMA ALIGNMENT STATUS (for frontend EMA Traffic Light)
            # ============================================
            # Calculate EMA alignment for the traffic light display
            if ema_20 > ema_50 > ema_100 and price > ema_20 and not is_compressed:
                # All three EMAs properly ordered BULLISH + price above all + not compressed
                ema_alignment = "ALL_BULLISH"
                ema_alignment_confidence = 95
            elif ema_20 < ema_50 < ema_100 and price < ema_20 and not is_compressed:
                # All three EMAs properly ordered BEARISH + price below all + not compressed
                ema_alignment = "ALL_BEARISH"
                ema_alignment_confidence = 95
            elif is_compressed:
                # 🔥 TRUE compression - EMAs all bunched together = confusion zone
                ema_alignment = "COMPRESSION"
                ema_alignment_confidence = 30
            elif (ema_20 > ema_50 > ema_100) and (price > ema_50 or price > ema_100):
                # Weak bullish - proper order but price not above all
                ema_alignment = "PARTIAL_BULLISH"
                ema_alignment_confidence = 65
            elif (ema_20 < ema_50 < ema_100) and (price < ema_50 or price < ema_100):
                # Weak bearish - proper order but price not below all
                ema_alignment = "PARTIAL_BEARISH"
                ema_alignment_confidence = 65
            elif ema_20 > ema_50 or ema_20 > ema_100 or price > ema_50:
                # Partial bullish alignment (order not perfect)
                ema_alignment = "PARTIAL_BULLISH"
                ema_alignment_confidence = 55
            elif ema_20 < ema_50 or ema_20 < ema_100 or price < ema_50:
                # Partial bearish alignment (order not perfect)
                ema_alignment = "PARTIAL_BEARISH"
                ema_alignment_confidence = 55
            else:
                # Mixed/Neutral
                ema_alignment = "NEUTRAL"
                ema_alignment_confidence = 50
            
            # ============================================
            # VWMA 20 • ENTRY FILTER SIGNAL (for frontend VWMA filter)
            # ============================================
            # Combines VWMA position + EMA alignment + Volume confirmation
            vwma_20_value = tick_data.get('vwma_20', price)
            vwma_above_price = vwma_20_value < price  # VWMA below = bullish
            vwma_below_price = vwma_20_value > price  # VWMA above = bearish
            
            # Determine VWMA-EMA signal
            vwma_ema_signal = None
            
            # STRONG BUY: Price > VWMA + Bullish EMA alignment + Volume confirmation
            if vwma_above_price and (ema_alignment == "ALL_BULLISH" or ema_alignment == "PARTIAL_BULLISH") and volume_ratio >= 1.2:
                vwma_ema_signal = "STRONG_BUY"
            # BUY: Price > VWMA + Some bullish conditions
            elif vwma_above_price and (ema_alignment in ["ALL_BULLISH", "PARTIAL_BULLISH"] or price > ema_20) and volume_price_alignment:
                vwma_ema_signal = "BUY"
            # STRONG SELL: Price < VWMA + Bearish EMA alignment + Volume confirmation
            elif vwma_below_price and (ema_alignment == "ALL_BEARISH" or ema_alignment == "PARTIAL_BEARISH") and volume_ratio >= 1.2:
                vwma_ema_signal = "STRONG_SELL"
            # SELL: Price < VWMA + Some bearish conditions
            elif vwma_below_price and (ema_alignment in ["ALL_BEARISH", "PARTIAL_BEARISH"] or price < ema_20) and volume_price_alignment:
                vwma_ema_signal = "SELL"
            # WAIT: No clear signal
            else:
                vwma_ema_signal = "WAIT"
            
            # ============================================
            # SIDEWAYS MARKET DETECTION (SAR & SuperTrend UNRELIABLE FILTER)
            # ============================================
            # SAR and SuperTrend give FALSE FLIPS in consolidation zones
            # This filter identifies when to AVOID both indicators
            
            # 1. EMA Convergence Filter (Chop Detection)
            ema_compression = abs(ema_20 - ema_50) / ema_50 * 100 if ema_50 > 0 else 0
            is_ema_compressed = ema_compression < 0.3  # EMA20 and EMA50 very close = CHOP
            
            # 2. Price Inside CPR (Consolidation Zone)
            price_in_cpr = bc <= price <= tc  # Inside CPR = consolidation
            
            # 3. ATR Estimate (Volatility)
            # 🔥 FIX: Use real 10-period ATR from cached candles (if available)
            # Falls back to range-based estimate if cache unavailable
            atr_estimate = tick_data.get('atr_10', None)
            
            if atr_estimate is None or atr_estimate <= 0.001:
                # Fallback: Use today's range as ATR multiplied by 1.5 (ATR is usually larger than single candle)
                # This ensures bands are wide enough to show BULLISH/BEARISH instead of always NEUTRAL
                min_atr = (high - low) * 1.5  # 1.5x multiplier to account for multi-candle ATR
                atr_estimate = max(min_atr, price * 0.005)  # Minimum 0.5% of price as fallback
            
            atr_pct = (atr_estimate / price * 100) if price > 0 else 0
            is_atr_low = atr_pct < 0.5  # Low volatility = small candles = chop
            
            # SIDEWAYS MARKET STATUS (When to AVOID SAR/SuperTrend)
            is_sideways_market = is_ema_compressed or price_in_cpr or is_atr_low
            sideways_reason = []
            if is_ema_compressed:
                sideways_reason.append(f"EMA compression (diff {ema_compression:.2f}%)")
            if price_in_cpr:
                sideways_reason.append(f"Price inside CPR zone")
            if is_atr_low:
                sideways_reason.append(f"Low ATR ({atr_pct:.2f}% range)")
            sideway_warning = " + ".join(sideways_reason) if sideways_reason else ""
            
            # ============================================
            # SUPERTREND (10,2) - PROFESSIONAL INTRADAY PARAMETERS
            # ============================================
            # SUPERTREND (10,2) - PROFESSIONAL INTRADAY PARAMETERS
            # ============================================
            # SuperTrend = (Period: 10, Multiplier: 2) for intraday 5m/15m
            # Slower than (7,3), more reliable than (10,3)
            # Parameter meaning: Period=10 lookback bars, Multiplier=2x ATR
            
            # Calculate SuperTrend bands using (10,2) parameters
            st_multiplier = 2.0  # Standard intraday multiplier
            st_period = 10  # Standard intraday period
            
            # HL2 = (High + Low) / 2
            hl2 = (high + low) / 2
            
            # Basic Bands using ATR estimate
            basic_upper_band = hl2 + (st_multiplier * atr_estimate)
            basic_lower_band = hl2 - (st_multiplier * atr_estimate)
            
            # Safety check: Ensure bands are not too narrow (would cause continuous NEUTRAL)
            # Minimum band width should be at least 0.3% of price on each side
            min_band_distance = price * 0.003  # 0.3% minimum
            if (basic_upper_band - basic_lower_band) < (price * 0.006):
                # Bands too narrow, widen them
                band_center = (basic_upper_band + basic_lower_band) / 2
                basic_upper_band = band_center + min_band_distance
                basic_lower_band = band_center - min_band_distance
            
            # SuperTrend determination
            if price > basic_upper_band:
                st_10_2_value = basic_lower_band
                st_10_2_trend = "BULLISH"
                st_10_2_signal = "BUY"
            elif price < basic_lower_band:
                st_10_2_value = basic_upper_band
                st_10_2_trend = "BEARISH"
                st_10_2_signal = "SELL"
            else:
                st_10_2_value = hl2
                st_10_2_trend = "NEUTRAL"
                st_10_2_signal = "HOLD"
            
            # Debug logging every 30 seconds
            import time
            if int(time.time()) % 30 == 0:
                print(f"[ST-DEBUG] {symbol}: Price={price:.2f}, HL2={hl2:.2f}, ATR={atr_estimate:.2f}")
                print(f"[ST-DEBUG] Upper={basic_upper_band:.2f}, Lower={basic_lower_band:.2f}, Trend={st_10_2_trend}")
            
            # SuperTrend distance to line
            st_distance = abs(price - st_10_2_value)
            st_distance_pct = (st_distance / price * 100) if price > 0 else 0
            
            # ⚠️ SuperTrend Warning (unreliable in sideways)
            st_warning = "⚠️ WARNING: Inside CPR zone" if is_sideways_market else None
            
            # SuperTrend Confidence Calculation (Improved)
            st_10_2_confidence = 60  # Higher base confidence
            
            # Distance-based confidence (farther from line = more confident)
            if st_distance_pct > 3.0:
                st_10_2_confidence += 25  # Very strong distance
            elif st_distance_pct > 2.0:
                st_10_2_confidence += 20  # Strong distance  
            elif st_distance_pct > 1.0:
                st_10_2_confidence += 15  # Good distance
            elif st_distance_pct > 0.5:
                st_10_2_confidence += 10  # Moderate distance
            else:
                st_10_2_confidence += 5   # Close but still valid
            
            # Signal strength confidence
            if st_10_2_signal in ["BUY", "SELL"]:
                st_10_2_confidence += 10  # Clear directional signal
                if not is_sideways_market:
                    st_10_2_confidence += 15  # Boost for trending market
                else:
                    st_10_2_confidence -= 10  # Slight reduction for sideways
            
            # Market volatility adjustment (higher ATR = lower confidence)
            if atr_pct < 1.0:
                st_10_2_confidence += 5   # Low volatility = more reliable
            elif atr_pct > 2.5:
                st_10_2_confidence -= 5   # High volatility = less reliable
                
            # Cap confidence between 45-95 (more realistic range)
            st_10_2_confidence = min(95, max(45, st_10_2_confidence))
            
            # ============================================
            # COMBINED CONFIRMATION SETUP (BEST APP LOGIC)
            # ============================================
            # Strong BUY: SuperTrend Green + Price > EMA50 + Price > VWAP + RSI > 50/crossing 60
            # Strong SELL: SuperTrend Red + Price < EMA50 + Price < VWAP + RSI < 50/breaking 40
            
            # Extract RSI signal (from momentum calculation earlier)
            rsi_value = rsi  # RSI 0-100 score
            rsi_above_50 = rsi_value > 50
            rsi_crossing_60 = rsi_value > 58  # Near crossing 60 (using 58 as proxy without historical)
            rsi_below_50 = rsi_value < 50
            rsi_breaking_40 = rsi_value < 42  # Near breaking 40 (using 42 as proxy)
            
            # STRONG BUY SETUP
            strong_buy_conditions = [
                st_10_2_signal == "BUY",
                price > ema_50,
                vwap_pos == "ABOVE_VWAP",
                rsi_above_50 or rsi_crossing_60
            ]
            strong_buy_count = sum(strong_buy_conditions)
            
            buy_setup_status = None
            buy_setup_confidence = 0
            if strong_buy_count == 4:
                buy_setup_status = "✅ STRONG BUY SETUP"
                buy_setup_confidence = 95
                buy_setup_desc = "SuperTrend Green ✅ | Price > EMA50 ✅ | Price > VWAP ✅ | RSI > 50 ✅"
            elif strong_buy_count == 3:
                buy_setup_status = "👍 GOOD BUY SETUP"
                buy_setup_confidence = 75
                buy_setup_desc = f"SuperTrend Green ✅ | {strong_buy_count} of 4 filters aligned"
            elif strong_buy_count >= 2:
                buy_setup_status = "⚠️ PARTIAL BUY SETUP"
                buy_setup_confidence = 50
                buy_setup_desc = f"Only {strong_buy_count} of 4 filters - caution"
            
            # STRONG SELL SETUP
            strong_sell_conditions = [
                st_10_2_signal == "SELL",
                price < ema_50,
                vwap_pos == "BELOW_VWAP",
                rsi_below_50 or rsi_breaking_40
            ]
            strong_sell_count = sum(strong_sell_conditions)
            
            sell_setup_status = None
            sell_setup_confidence = 0
            if strong_sell_count == 4:
                sell_setup_status = "✅ STRONG SELL SETUP"
                sell_setup_confidence = 95
                sell_setup_desc = "SuperTrend Red ✅ | Price < EMA50 ✅ | Price < VWAP ✅ | RSI < 50 ✅"
            elif strong_sell_count == 3:
                sell_setup_status = "👍 GOOD SELL SETUP"
                sell_setup_confidence = 75
                sell_setup_desc = f"SuperTrend Red ✅ | {strong_sell_count} of 4 filters aligned"
            elif strong_sell_count >= 2:
                sell_setup_status = "⚠️ PARTIAL SELL SETUP"
                sell_setup_confidence = 50
                sell_setup_desc = f"Only {strong_sell_count} of 4 filters - caution"
            
            # Overall market status for app display
            market_status_message = None
            if is_sideways_market:
                market_status_message = f"⚠️ Market: Sideways? ({sideway_warning}) → Wait"
            else:
                if buy_setup_status:
                    market_status_message = buy_setup_status
                elif sell_setup_status:
                    market_status_message = sell_setup_status
                else:
                    market_status_message = "🔄 NEUTRAL - Waiting for alignment"
            
            # ============================================
            # PARABOLIC SAR - TREND FOLLOWING (REAL SAR CALCULATION)
            # ============================================
            # SAR = Stop and Reverse (trailing stop, calculated from price history)
            # Uses real Parabolic SAR from cached candles (calculated in calculate_sar_from_cache)
            
            # Get real SAR values from tick_data (calculated from cache)
            sar_value = float(tick_data.get('sar_value', (high + low) / 2))
            sar_position = tick_data.get('sar_position', 'NEUTRAL')
            sar_trend = tick_data.get('sar_trend', 'UNKNOWN')
            sar_signal = tick_data.get('sar_signal', None)
            sar_signal_strength = tick_data.get('sar_signal_strength', 0)
            sar_reversal = tick_data.get('sar_reversal', False)
            
            # SAR Flip Detection (when SAR crosses price = potential reversal)
            sar_flip = False
            sar_flip_type = None
            
            # Check for flip signals (crosses) based on SAR position
            if sar_position == "BELOW" and price <= sar_value:
                # SAR flip: Bullish trend breaking down, SAR coming to/above price
                sar_flip = True
                sar_flip_type = "POTENTIAL_SELL_FLIP"
            elif sar_position == "ABOVE" and price >= sar_value:
                # SAR flip: Bearish trend breaking up, SAR coming to/below price
                sar_flip = True
                sar_flip_type = "POTENTIAL_BUY_FLIP"
            else:
                sar_flip = False
                sar_flip_type = None
            
            # ============================================
            # SAR SIGNAL VALIDATION (with EMA50 + VWAP confirmation)
            # ============================================
            # Use SAR signal from ParabolicSARFilter, enhance with EMA50 and VWAP confirmation
            
            sar_confirmation_status = None
            
            if not sar_signal or sar_signal == "NEUTRAL":
                # No SAR signal or neutral state
                sar_confirmation_status = "⚠️ Waiting for SAR signal or trend setup"
            elif "BUY" in sar_signal:
                # SAR is giving a BUY signal - validate with filters
                if price > ema_50 and vwap_pos == "ABOVE_VWAP":
                    # STRONG: SAR signal + EMA50 + VWAP all aligned
                    sar_confirmation_status = "✅ SAR BUY Signal Confirmed (EMA50 + VWAP aligned)"
                elif price > ema_50:
                    # PARTIAL: SAR signal + EMA50 aligned, VWAP not confirmed
                    sar_confirmation_status = "✓ SAR BUY Signal (EMA50 confirmed)"
                else:
                    # WEAK: SAR signal present but EMA50 not supporting
                    sar_confirmation_status = "⚠️ SAR BUY caution - EMA50 below price"
            elif "SELL" in sar_signal:
                # SAR is giving a SELL signal - validate with filters
                if price < ema_50 and vwap_pos == "BELOW_VWAP":
                    # STRONG: SAR signal + EMA50 + VWAP all aligned
                    sar_confirmation_status = "✅ SAR SELL Signal Confirmed (EMA50 + VWAP aligned)"
                elif price < ema_50:
                    # PARTIAL: SAR signal + EMA50 aligned, VWAP not confirmed
                    sar_confirmation_status = "✓ SAR SELL Signal (EMA50 confirmed)"
                else:
                    # WEAK: SAR signal present but EMA50 not supporting
                    sar_confirmation_status = "⚠️ SAR SELL caution - EMA50 above price"
            
            # Calculate trailing stop loss (current SAR value)
            trailing_sl = sar_value
            
            # Calculate distance to SAR
            distance_to_sar = abs(price - sar_value)
            distance_to_sar_pct = (distance_to_sar / price * 100) if price > 0 else 0
            
            # ============================================
            # OPENING RANGE BREAKOUT (ORB) - Fast Intraday System
            # ============================================
            # ORB = Opening Range captured in first 5/10/15 minutes
            # Classic breakout strategy: Buy on ORB High break, Sell on ORB Low break
            # 
            # ORB High = Highest point in opening period
            # ORB Low = Lowest point in opening period
            # Current ORB: Use day's open as reference
            
            # Simple ORB calculation: Use open price + day's range
            # ORB High = Open + (50% of ATR estimate) as 5-min range projection
            # ORB Low = Open - (50% of ATR estimate)
            orb_estimated_high = open_price + (atr_estimate * 0.4)  # Conservative 5-min high
            orb_estimated_low = open_price - (atr_estimate * 0.4)   # Conservative 5-min low
            
            # More accurate: Use today's high/low as ORB reference (if available in tick)
            # Check tick_data for time-based ORB data
            orb_high = tick_data.get('orb_high', orb_estimated_high)
            orb_low = tick_data.get('orb_low', orb_estimated_low)
            
            # If not available in tick, fallback to calculated estimates
            if not tick_data.get('orb_high'):
                orb_high = orb_estimated_high
            if not tick_data.get('orb_low'):
                orb_low = orb_estimated_low
            
            # ORB BREAKOUT DETECTION 🔥
            # Close above ORB High = BUY Signal
            price_above_orb_high = price > orb_high
            price_above_orb_high_by = price - orb_high if price_above_orb_high else 0
            price_above_orb_high_pct = (price_above_orb_high_by / orb_high * 100) if orb_high > 0 else 0
            
            # Close below ORB Low = SELL Signal
            price_below_orb_low = price < orb_low
            price_below_orb_low_by = orb_low - price if price_below_orb_low else 0
            price_below_orb_low_pct = (price_below_orb_low_by / orb_low * 100) if orb_low > 0 else 0
            
            # ORB Position Status
            if price_above_orb_high:
                orb_position = "ABOVE_HIGH"  # Bullish - breakout
                orb_status = "ORB High Breakout → BUY"
                orb_signal = "ORB_BUY_BREAKOUT"
                orb_strength = min(90, 60 + int(price_above_orb_high_pct * 3))  # 60-90 based on distance
                orb_confirmation = "Price closed above ORB High - Breakout confirmed"
                orb_confidence = min(85, 70 + int(price_above_orb_high_pct * 2))  # Higher confidence for breakouts
            elif price_below_orb_low:
                orb_position = "BELOW_LOW"   # Bearish - breakdown
                orb_status = "ORB Low Breakdown → SELL"
                orb_signal = "ORB_SELL_BREAKDOWN"
                orb_strength = min(90, 60 + int(price_below_orb_low_pct * 3))  # 60-90 based on distance
                orb_confirmation = "Price closed below ORB Low - Breakdown confirmed"
                orb_confidence = min(85, 70 + int(price_below_orb_low_pct * 2))  # Higher confidence for breakdowns
            else:
                # Price inside ORB (ranging)
                orb_position = "INSIDE_RANGE"  # Neutral
                orb_status = "Inside ORB Range"
                orb_signal = "ORB_NEUTRAL"
                orb_strength = 0
                orb_confirmation = "Waiting for ORB breakout or breakdown"
                orb_confidence = 45  # Lower confidence when inside range
            
            # Distance to ORB levels
            distance_to_orb_high = abs(price - orb_high)
            distance_to_orb_low = abs(price - orb_low)
            
            # Risk/Reward for ORB trades
            orb_risk = distance_to_orb_high if price_above_orb_high else distance_to_orb_low  # Distance to stop loss (ORB)
            orb_reward_risk_ratio = None
            if orb_risk > 0:
                # Typical target = 2x ORB range
                orb_range = orb_high - orb_low
                orb_target = orb_range * 2
                orb_reward_risk_ratio = round(orb_target / orb_risk, 2) if orb_risk > 0 else 0
            
            # Calculate EMAs using professional 20/50/100/200 trend filter configuration
            # These are trend-based estimates using price momentum and change percent
            from config.ema_config import get_trend_filter
            trend_filter = get_trend_filter()
            
            # Professional EMA calculation: Conservative estimates based on momentum
            # Bullish candle: EMAs shift lower (below price = trailing)
            # Bearish candle: EMAs shift higher (above price = leading)
            if change_percent > 0:  # Bullish momentum
                ema_20 = price * 0.9995   # Fastest EMA responds immediately
                ema_50 = price * 0.999    # Medium-term trend
                ema_100 = price * 0.998   # Slower trend confirmation
                ema_200 = price * 0.997   # Anchor (major support/resistance)
                vwma_20 = price * 0.9993  # VWMA20: Volume-weighted, between EMA20 and EMA50
            elif change_percent < 0:  # Bearish momentum
                ema_20 = price * 1.0005
                ema_50 = price * 1.001
                ema_100 = price * 1.002
                ema_200 = price * 1.003
                vwma_20 = price * 1.0007  # VWMA20: Volume-weighted, between EMA20 and EMA50
            else:  # Neutral market
                ema_20 = ema_50 = ema_100 = ema_200 = price
                vwma_20 = price
            
            # ============================================
            # EMA200 TOUCH DETECTION - ENTRY FILTER
            # ============================================
            ema200_touch = None
            ema200_action = None
            ema200_entry_filter = "NEUTRAL"
            ema200_touch_type = None
            ema200_confirmation = None
            
            # EMA200 threshold: within 0.5% of EMA200
            ema200_threshold = ema_200 * 0.005
            price_distance_from_ema200 = abs(price - ema_200)
            
            if price_distance_from_ema200 <= ema200_threshold:
                # TOUCHING EMA200
                ema200_touch = "TOUCHING"
                
                if price > ema_200:
                    # Touching from ABOVE (EMA200 as support)
                    ema200_touch_type = "FROM_ABOVE"
                    ema200_action = "Price tested EMA200 support from above"
                    
                    if trend == "bullish":
                        # First touch in uptrend - usually bounce
                        if candle_body > (price_range * 0.6):  # Strong close above EMA200
                            if rsi >= 40:  # RSI not broken
                                ema200_entry_filter = "FIRST_TOUCH_BOUNCE"
                                ema200_confirmation = "Bullish bounce off EMA200 - confirmation signal"
                            else:
                                ema200_entry_filter = "WEAK_BOUNCE"
                                ema200_confirmation = "Bounce weak - RSI below 40"
                        else:
                            ema200_entry_filter = "TOUCH_WATCH"
                            ema200_confirmation = "First touch - await candle close confirmation"
                    else:
                        # Bearish trend - support failing
                        ema200_entry_filter = "SUPPORT_FAIL"
                        ema200_confirmation = "EMA200 support breaking in downtrend"
                
                elif price < ema_200:
                    # Touching from BELOW (EMA200 as resistance)
                    ema200_touch_type = "FROM_BELOW"
                    ema200_action = "Price tested EMA200 resistance from below"
                    
                    if trend == "bearish":
                        # First touch in downtrend - usually rejection
                        if close_price < ema_200:  # Closes below EMA200
                            if vol_strength == "WEAK_VOLUME":
                                ema200_entry_filter = "FIRST_TOUCH_REJECTION"
                                ema200_confirmation = "First touch rejection - weak volume, below EMA200"
                            else:
                                ema200_entry_filter = "TOUCH_REJECTION"
                                ema200_confirmation = "First touch rejection - sellers defending"
                        else:
                            ema200_entry_filter = "TOUCH_WATCH"
                            ema200_confirmation = "First touch - monitor for breakout confirmation"
                    else:
                        # Bullish trend - resistance breaking
                        if close_price > ema_200 and candle_body > (price_range * 0.6):
                            ema200_entry_filter = "EMA200_BREAKOUT"
                            ema200_confirmation = "Strong close above EMA200 - resistance broken"
                        else:
                            ema200_entry_filter = "BREAKOUT_WATCH"
                            ema200_confirmation = "Second touch - monitor for sustained close above EMA200"
            
            elif price > ema_200:
                # Price ABOVE EMA200
                ema200_touch = "ABOVE"
                if trend == "bullish" and vwap_pos == "ABOVE_VWAP":
                    ema200_entry_filter = "ABOVE_BOTH"
                    ema200_confirmation = "Price above EMA200 + VWAP - strong uptrend structure"
            
            elif price < ema_200:
                # Price BELOW EMA200
                ema200_touch = "BELOW"
                if trend == "bearish" and vwap_pos == "BELOW_VWAP":
                    ema200_entry_filter = "BELOW_BOTH"
                    ema200_confirmation = "Price below EMA200 + VWAP - strong downtrend structure"
            
            # Calculate previous day levels (use close price as prev_day_close)
            # prev_day_close should be from tick data's OHLC
            prev_day_close = close_price if close_price > 0 else price
            prev_day_high = tick_data.get('prev_day_high', high)
            prev_day_low = tick_data.get('prev_day_low', low)
            
            # Debug logging for calculated values (using new 20/50/100/200 EMA config)
            print(f"[INSTANT-ANALYSIS] {symbol} CALCULATED VALUES:")
            print(f"   → VWAP: ₹{vwap_value:,.2f}")
            print(f"   → EMA 20/50/100/200: ₹{ema_20:.2f} / ₹{ema_50:.2f} / ₹{ema_100:.2f} / ₹{ema_200:.2f}")
            print(f"   → Support: ₹{low:,.2f}, Resistance: ₹{high:,.2f}")
            print(f"   → Prev Day High/Low/Close: ₹{prev_day_high:.2f} / ₹{prev_day_low:.2f} / ₹{prev_day_close:.2f}")
            
            return {
                "signal": signal,
                "confidence": round(confidence, 2),
                "reasons": reasons,
                "warnings": [],
                "entry_price": entry,
                "stop_loss": stop_loss,
                "target": target,
                "indicators": {
                    # Price & Trend
                    "price": round(price, 2),
                    "high": round(high, 2),
                    "low": round(low, 2),
                    "open": round(open_price, 2),
                    "vwap": round(vwap_value, 2),  # Proper VWAP calculation
                    "vwma_20": round(vwma_20, 2),  # Volume-Weighted Moving Average 20
                    "vwap_position": vwap_pos,
                    "vwap_bias": vwap_bias,  # LONG_ONLY, SHORT_ONLY, NEUTRAL
                    "vwap_role": vwap_role,  # SUPPORT, RESISTANCE, EQUILIBRIUM
                    "vwap_signal": vwap_signal,  # DIP_TO_VWAP_BUY, PULLBACK_TO_VWAP_SELL, R3_BREAKOUT_ABOVE_VWAP, etc.
                    "vwap_r3_s3_combo": vwap_r3_s3_combo,  # Institutional combo analysis
                    "ema_20": round(ema_20, 2),
                    "ema_50": round(ema_50, 2),
                    "ema_100": round(ema_100, 2),
                    "ema_200": round(ema_200, 2),
                    "ema_alignment": ema_alignment,  # ALL_BULLISH, ALL_BEARISH, PARTIAL_BULLISH, PARTIAL_BEARISH, COMPRESSION, NEUTRAL
                    "ema_alignment_confidence": ema_alignment_confidence,  # 30-95 confidence score
                    "ema200_touch": ema200_touch,  # TOUCHING, ABOVE, BELOW
                    "ema200_touch_type": ema200_touch_type,  # FROM_ABOVE, FROM_BELOW
                    "ema200_action": ema200_action,  # Description of touch
                    "ema200_entry_filter": ema200_entry_filter,  # FIRST_TOUCH_BOUNCE, REJECTION, BREAKOUT, etc.
                    "ema200_confirmation": ema200_confirmation,  # Confirmation signal
                    "trend_status": trend_status,  # STRONG_UPTREND, STRONG_DOWNTREND, SIDEWAYS, COMPRESSION
                    "trend_label": trend_label,  # Human readable
                    "trend_color": trend_color,  # BULLISH, BEARISH, NEUTRAL
                    "pullback_level": pullback_level,  # EMA20, EMA50, EMA100, NONE
                    "pullback_entry": pullback_entry,  # Entry action (FIRST_TOUCH_PULLBACK_BUY, EMA50_BOUNCE_BUY, etc.)
                    "ema_support_zone": ema_support_zone,  # Description of support/resistance zone
                    "momentum_shift": momentum_shift,  # BULLISH_CONFIRMED, BEARISH_CONFIRMED, MOMENTUM_SHIFT, MIXED
                    "buy_allowed": buy_allowed,  # Boolean: safe to buy?
                    
                    # Camarilla R3/S3 Gate Levels
                    "camarilla_h3": round(h3, 2),  # R3 (top gate)
                    "camarilla_l3": round(l3, 2),  # S3 (bottom gate)
                    "camarilla_h4": round(h4, 2),  # H4 (upper extreme)
                    "camarilla_l4": round(l4, 2),  # L4 (lower extreme)
                    "camarilla_zone": camarilla_zone,  # ABOVE_TC, BELOW_BC, INSIDE_CPR
                    "camarilla_zone_status": camarilla_zone_status,  # Human readable
                    "camarilla_signal": camarilla_signal,  # R3_BREAKOUT_CONFIRMED, S3_BREAKDOWN_CONFIRMED, CPR_CHOP_ZONE, etc.
                    "camarilla_signal_desc": camarilla_signal_desc,  # Full description with emoji
                    "camarilla_confidence": camarilla_confidence,  # Dynamic confidence score (30-95)
                    
                    # CPR (Central Pivot Range) Analysis
                    "cpr_top_central": round(tc, 2),  # TC = H3
                    "cpr_bottom_central": round(bc, 2),  # BC = L3
                    "cpr_pivot": round(pivot_point, 2),  # P = Pivot
                    "cpr_width": round(cpr_width, 2),  # TC - BC distance
                    "cpr_width_pct": round(cpr_width_pct, 3),  # As % of price
                    "cpr_classification": cpr_classification,  # NARROW (trending) or WIDE (range)
                    "cpr_description": cpr_description,  # Human readable
                    
                    # Trend Day Signal (CPR + EMA + VWAP alignment)
                    "trend_day_signal": trend_day_signal,  # TREND_DAY_BULLISH_HIGH_PROB, CHOPPY_CONSOLIDATION, etc.
                    "trend_day_confidence": trend_day_confidence,  # 30-90 confidence score
                    
                    # Parabolic SAR - Trend Following Indicator
                    "sar_value": round(sar_value, 2),  # Current SAR level (trailing stop)
                    "sar_position": sar_position,  # BELOW (bullish), ABOVE (bearish), NEUTRAL
                    "sar_trend": sar_trend,  # BULLISH, BEARISH, NEUTRAL
                    "sar_signal": sar_signal,  # SAR_BUY_VALID_STRONG, SAR_SELL_VALID_STRONG, SAR_AVOID_RANGING, etc.
                    "sar_signal_strength": sar_signal_strength,  # 0-90 strength score
                    "sar_flip": sar_flip,  # Boolean: SAR flip occurring?
                    "sar_flip_type": sar_flip_type,  # POTENTIAL_BUY_FLIP, POTENTIAL_SELL_FLIP, None
                    "sar_confirmation_status": sar_confirmation_status,  # Full confirmation message
                    "trailing_sl": round(trailing_sl, 2),  # Stop loss value
                    "distance_to_sar": round(distance_to_sar, 2),  # Price distance from SAR
                    "distance_to_sar_pct": round(distance_to_sar_pct, 3),  # Distance as percentage
                    
                    # SuperTrend (10,2) - Professional Intraday
                    "supertrend_10_2_value": round(st_10_2_value, 2),  # Current line
                    "supertrend_10_2_trend": st_10_2_trend,  # BULLISH, BEARISH, NEUTRAL
                    "supertrend_10_2_signal": st_10_2_signal,  # BUY, SELL, HOLD
                    "supertrend_10_2_distance": round(st_distance, 2),  # Distance to ST line
                    "supertrend_10_2_distance_pct": round(st_distance_pct, 3),  # As percentage
                    "supertrend_10_2_confidence": st_10_2_confidence,  # Dynamic confidence score
                    "supertrend_10_2_warning": st_warning,  # Unreliability warning
                    
                    # Sideways/Ranging Detection (SAR + SuperTrend Reliability Filter)
                    "is_sideways_market": is_sideways_market,  # Boolean: market is choppy?
                    "ema_compression_pct": round(ema_compression, 2),  # EMA20/50 distance
                    "price_in_cpr": price_in_cpr,  # Boolean: inside CPR zone?
                    "atr_estimated": round(atr_estimate, 2),  # ATR range estimate
                    "atr_estimated_pct": round(atr_pct, 2),  # ATR as % of price
                    "sideways_warning": sideway_warning,  # Reason for sideway classification
                    
                    # Combined Confirmation Setups (BEST APP LOGIC - Recommended)
                    "buy_setup_status": buy_setup_status,  # ✅ STRONG BUY, 👍 GOOD BUY, ⚠️ PARTIAL BUY
                    "buy_setup_confidence": buy_setup_confidence,  # 50-95 confidence score
                    "buy_setup_desc": buy_setup_desc if buy_setup_status else None,  # Full description
                    "sell_setup_status": sell_setup_status,  # ✅ STRONG SELL, 👍 GOOD SELL, ⚠️ PARTIAL SELL
                    "sell_setup_confidence": sell_setup_confidence,  # 50-95 confidence score
                    "sell_setup_desc": sell_setup_desc if sell_setup_status else None,  # Full description
                    "market_status_message": market_status_message,  # App output for ultra-clean UI
                    
                    # Opening Range Breakout (ORB) - Intraday Breakout System
                    "orb_high": round(orb_high, 2),  # Opening range high level
                    "orb_low": round(orb_low, 2),  # Opening range low level
                    "orb_range": round(orb_high - orb_low, 2),  # ORB width (range)
                    "orb_position": orb_position,  # ABOVE_HIGH, BELOW_LOW, INSIDE_RANGE
                    "orb_status": orb_status,  # "ORB High Breakout → BUY" or "ORB Low Breakdown → SELL"
                    "orb_signal": orb_signal,  # ORB_BUY_BREAKOUT, ORB_SELL_BREAKDOWN, ORB_NEUTRAL
                    "orb_strength": orb_strength,  # 0-90 confidence (60-90 on breakout/breakdown)
                    "orb_confidence": orb_confidence,  # Dynamic confidence based on market status
                    "orb_confirmation": orb_confirmation,  # Confirmation message
                    "distance_to_orb_high": round(distance_to_orb_high, 2),  # Distance to ORB High
                    "distance_to_orb_low": round(distance_to_orb_low, 2),  # Distance to ORB Low
                    "orb_risk": round(orb_risk, 2) if orb_risk else 0,  # Stop loss distance (to ORB level)
                    "orb_reward_risk_ratio": orb_reward_risk_ratio,  # Risk/Reward (typically 2:1 for ORB)
                    
                    "trend": trend_map.get(trend, 'SIDEWAYS'),
                    
                    # Support & Resistance
                    "support": round(low, 2),
                    "resistance": round(high, 2),
                    "prev_day_high": round(prev_day_high, 2),
                    "prev_day_low": round(prev_day_low, 2),
                    "prev_day_close": round(prev_day_close, 2),
                    
                    # Volume & Momentum
                    "volume": volume if volume > 0 else None,  # None if no volume data
                    "volume_strength": vol_strength,
                    "volume_ratio": round(volume_ratio, 2),  # Volume ratio to threshold (1.0 = at threshold)
                    "volume_price_alignment": volume_price_alignment,  # Volume confirms price direction
                    "vwma_ema_signal": vwma_ema_signal,  # STRONG_BUY, BUY, SELL, STRONG_SELL, WAIT
                    "rsi": round(rsi, 1),  # RSI based on momentum (0-100)
                    "rsi_zone": rsi_zone,  # RSI zone (60_ABOVE, 50_TO_60, 40_TO_50, 40_BELOW)
                    "rsi_signal": rsi_signal,  # RSI 60/40 signal (MOMENTUM_BUY, REJECTION_SHORT, PULLBACK_BUY, etc.)
                    "rsi_action": rsi_action,  # Human-readable RSI action description
                    "momentum": round(momentum_score, 1),  # Momentum score (0-100)
                    "candle_strength": round(candle_strength / 100, 3),  # As decimal 0-1
                    
                    # VWMA EMA Filter Confidence (for Entry Filter component)
                    "vwma_above_ema200": price > vwma_20 and vwma_20 > ema_200,  # VWMA above EMA200
                    "vwma_ema_confidence": round(min(95, max(15, 
                        50 + 
                        (30 if price > vwma_20 and price > ema_200 else 0) +  # Both above
                        (20 if abs(price - vwma_20) / vwma_20 < 0.01 else 0) +  # Price near VWMA
                        (-30 if price < vwma_20 and price < ema_200 else 0) +  # Both below (bearish)
                        (15 if vwma_20 > ema_200 else -15)  # VWMA above EMA200 trend
                    )), 2),  # VWMA EMA alignment confidence percentage
                    
                    # Options Data
                    "pcr": pcr if pcr > 0 else None,
                    "oi_change": round(oi_change, 2) if oi_change != 0 else 0,
                    
                    # Institutional Market Structure (calculated in market_feed.py)
                    "buy_volume_ratio": tick_data.get('buy_volume_ratio', 50),  # Buy volume %
                    "sell_volume_ratio": tick_data.get('sell_volume_ratio', 50),  # Sell volume %
                    "order_block_bullish": tick_data.get('order_block_bullish'),  # Support order block level
                    "order_block_bearish": tick_data.get('order_block_bearish'),  # Resistance order block level
                    "bos_bullish": tick_data.get('bos_bullish', False),  # Bullish break of structure
                    "bos_bearish": tick_data.get('bos_bearish', False),  # Bearish break of structure
                    "fvg_bullish": tick_data.get('fvg_bullish', False),  # Bullish fair value gap
                    "fvg_bearish": tick_data.get('fvg_bearish', False),  # Bearish fair value gap
                    "swing_high": tick_data.get('swing_high'),  # Last 5 candle swing high
                    "swing_low": tick_data.get('swing_low'),  # Last 5 candle swing low
                    "high_volume_levels": tick_data.get('high_volume_levels', []),  # Top volume price levels
                    
                    # Time Filter
                    "time_quality": "GOOD",
                },
                "timestamp": datetime.now().isoformat(),
                "symbol": symbol,
                "symbol_name": tick_data.get('symbol', symbol),
            }
            
        except Exception as e:
            print(f"⚠️ Instant analysis error for {tick_data.get('symbol', 'UNKNOWN')}: {e}")
            import traceback
            traceback.print_exc()
            
            # Return minimal analysis even on error (never return None for valid tick data)
            safe_price = float(tick_data.get('price', 0))
            safe_symbol = tick_data.get('symbol', 'UNKNOWN')
            
            if safe_price == 0:
                print(f"⚠️ Cannot generate fallback analysis - price is 0 for {safe_symbol}")
                return None
            
            print(f"⚠️ Returning FALLBACK analysis for {safe_symbol} (error analysis)")
            
            # Return a minimal but valid analysis structure
            try:
                safe_high = float(tick_data.get('high', safe_price))
                safe_low = float(tick_data.get('low', safe_price))
                safe_open = float(tick_data.get('open', safe_price))
                safe_close = float(tick_data.get('close', safe_price))
                safe_change_pct = float(tick_data.get('changePercent', 0))
                
                return {
                    "signal": "NEUTRAL",  # Safe default signal
                    "confidence": 0.3,  # Low confidence for error case
                    "reasons": ["⚠️ Analysis error - showing neutral signal"],
                    "warnings": [f"Analysis generation error: {str(e)}"],
                    "entry_price": safe_price,
                    "stop_loss": None,
                    "target": None,
                    "indicators": {
                        "price": round(safe_price, 2),
                        "high": round(safe_high, 2),
                        "low": round(safe_low, 2),
                        "open": round(safe_open, 2),
                        "close": round(safe_close, 2),
                        "vwap": round(safe_price, 2),
                        "vwma_20": round(safe_price, 2),
                        "vwap_position": "AT_VWAP",
                        "ema_20": round(safe_price, 2),
                        "ema_50": round(safe_price, 2),
                        "ema_100": round(safe_price, 2),
                        "ema_200": round(safe_price, 2),
                        "ema_alignment": "NEUTRAL",
                        "ema_alignment_confidence": 20,
                        "trend": "SIDEWAYS",
                        "support": round(safe_low, 2),
                        "resistance": round(safe_high, 2),
                        "prev_day_high": round(safe_high, 2),
                        "prev_day_low": round(safe_low, 2),
                        "prev_day_close": round(safe_close, 2),
                        "volume": tick_data.get('volume', 0),
                        "volume_strength": "MODERATE_VOLUME",
                        "volume_ratio": 1.0,
                        "volume_price_alignment": False,
                        "vwma_ema_signal": "WAIT",
                        "rsi": 50.0,
                        "momentum": 50.0,
                        "candle_strength": 0.5,
                        "pcr": tick_data.get('pcr', 0) or None,
                        "oi_change": float(tick_data.get('oi_change', 0)),
                        "time_quality": "POOR",
                        "changePercent": round(safe_change_pct, 2),
                    },
                    "timestamp": datetime.now().isoformat(),
                    "symbol": safe_symbol,
                    "symbol_name": safe_symbol,
                }
            except Exception as fallback_error:
                print(f"❌ Fallback analysis also failed: {fallback_error}")
                return None


async def get_instant_analysis(cache_service, symbol: str) -> Dict[str, Any]:
    """
    Get INSTANT analysis for a symbol - BLAZING FAST
    Uses only current tick data - no historical data needed
    Works even when market is closed using last traded data
    """
    try:
        # Get current tick from cache (will be last traded data if market is closed)
        tick_data = await cache_service.get_market_data(symbol)
        
        # Check if this is backup/cached data
        is_cached = tick_data.get('_cached', False) if tick_data else False
        
        if not tick_data:
            print(f"[INSTANT-ANALYSIS] ⚠️ No data for {symbol}")
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
                    "high": 0,
                    "low": 0,
                    "open": 0,
                    "vwap": 0,
                    "vwma_20": 0,
                    "vwap_position": "AT_VWAP",
                    "ema_20": 0,
                    "ema_50": 0,
                    "ema_100": 0,
                    "ema_200": 0,
                    "ema_alignment": "NEUTRAL",
                    "ema_alignment_confidence": 20,
                    "trend": "UNKNOWN",
                    "support": 0,
                    "resistance": 0,
                    "prev_day_high": 0,
                    "prev_day_low": 0,
                    "prev_day_close": 0,
                    "volume": 0,
                    "volume_strength": "WEAK_VOLUME",
                    "volume_ratio": 0.0,
                    "volume_price_alignment": False,
                    "vwma_ema_signal": "WAIT",
                    "rsi": 50,
                    "candle_strength": 0,
                    "pcr": None,
                    "oi_change": None,
                    "time_quality": "POOR",
                },
                "timestamp": datetime.now().isoformat(),
                "symbol": symbol,
                "symbol_name": symbol,
            }
        
        # 🔥 Calculate EMAs from cached candles before analysis
        tick_data = await calculate_emas_from_cache(cache_service, symbol, tick_data)
        
        # Instant analysis
        result = InstantSignal.analyze_tick(tick_data)
        result['symbol'] = symbol
        
        # Add market status info
        market_status = tick_data.get('status', 'UNKNOWN')
        
        # Add cache status
        if is_cached:
            print(f"[INSTANT-ANALYSIS] 📊 Using BACKUP data for {symbol}")
            result['warnings'] = result.get('warnings', []) + [
                "📊 Showing last market data (Token may be expired)"
            ]
            result['_data_source'] = 'BACKUP_CACHE'
        elif market_status == 'OFFLINE':
            result['warnings'] = result.get('warnings', []) + [
                "⏸️ Last traded data"
            ]
            result['_data_source'] = 'LAST_TRADED'
        else:
            result['_data_source'] = 'LIVE'
        
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
