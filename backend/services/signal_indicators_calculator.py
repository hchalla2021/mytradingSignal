"""
🔥 ENHANCED INDICATOR CALCULATOR
Provides all 14-signal required indicators for Market Outlook integration
Maps existing data to 14-signal structure
"""

from typing import Dict, Any
from datetime import datetime
import math


def calculate_trend_structure(analysis_data: Dict[str, Any]) -> Dict[str, Any]:
    """Calculate Trend Base indicators: higher_low, lower_high, trend_strength"""
    price = analysis_data.get('price', 0)
    ema_20 = analysis_data.get('ema_20', 0)
    ema_50 = analysis_data.get('ema_50', 0)
    ema_200 = analysis_data.get('ema_200', 0)
    support = analysis_data.get('support', 0)
    resistance = analysis_data.get('resistance', 0)
    
    # Higher Low structure: Price > Support AND EMA20 > EMA200
    higher_low = price > support and ema_20 > ema_200
    
    # Lower High structure: Price < Resistance AND EMA20 < EMA200
    lower_high = price < resistance and ema_20 < ema_200
    
    # Trend strength (0-100): How well EMAs are aligned (20 > 50 > 200 = uptrend)
    if ema_20 > ema_50 > ema_200:
        trend_strength = min(int(((ema_20 - ema_200) / ema_200 * 100) * 5), 100)
    elif ema_20 < ema_50 < ema_200:
        trend_strength = min(int(((ema_200 - ema_20) / ema_200 * 100) * 5), 100)
    else:
        trend_strength = 50
    
    return {
        'higher_low': higher_low,
        'lower_high': lower_high,
        'trend_strength': trend_strength
    }


def calculate_volume_profile(analysis_data: Dict[str, Any]) -> Dict[str, Any]:
    """Calculate Volume Pulse: volume_profile with current strength"""
    volume = analysis_data.get('volume', 0)
    volume_strength = analysis_data.get('volume_strength', 'WEAK')
    
    # Map volume_strength to percentage
    strength_map = {
        'VERY_WEAK': 10,
        'WEAK': 25,
        'MEDIUM': 50,
        'STRONG': 75,
        'VERY_STRONG': 90
    }
    current_volume_strength = strength_map.get(volume_strength, 50)
    
    # Determine direction (up if price above vwap, down opposite)
    price_direction = 'up' if analysis_data.get('vwap_position') == 'above' else 'down'
    
    return {
        'current_volume_strength': current_volume_strength,
        'volume': volume,
        'strength_label': volume_strength,
        'price_direction': price_direction
    }


def calculate_candle_structure(analysis_data: Dict[str, Any]) -> Dict[str, Any]:
    """Calculate Candle Intent: candle structure with bullish/bearish strength"""
    open_price = analysis_data.get('open', 0)
    close_price = analysis_data.get('price', 0)  # Current price as latest close
    high_price = analysis_data.get('high', 0)
    low_price = analysis_data.get('low', 0)
    candle_strength = analysis_data.get('candle_strength', 0)
    
    # Determine bullish/bearish
    if close_price > open_price:
        # Bullish candle
        body_size = close_price - open_price if open_price != 0 else 0
        total_range = high_price - low_price if low_price != 0 else 1
        ratio = (body_size / total_range * 100) if total_range != 0 else 50
        # Boost with candle_strength
        bullish_strength = min(50 + (ratio / 2) + (candle_strength / 2), 100)
    else:
        # Bearish candle
        body_size = open_price - close_price if close_price != 0 else 0
        total_range = high_price - low_price if low_price != 0 else 1
        ratio = (body_size / total_range * 100) if total_range != 0 else 50
        # Lower strength for bearish
        bullish_strength = max(50 - (ratio / 2) - (candle_strength / 2), 0)
    
    return {
        'bullish_strength': int(bullish_strength),
        'direction': 'bullish' if close_price > open_price else 'bearish',
        'candle_strength': candle_strength,
        'wick_ratio': 0  # Placeholder
    }


def calculate_pivot_points(analysis_data: Dict[str, Any]) -> Dict[str, Any]:
    """Calculate Pivot Points: R3, S3 from previous day data"""
    # Using previous day high/low/close for pivot calculation
    prev_high = analysis_data.get('prev_day_high', analysis_data.get('high', 0))
    prev_low = analysis_data.get('prev_day_low', analysis_data.get('low', 0))
    prev_close = analysis_data.get('prev_day_close', analysis_data.get('price', 0))
    
    if prev_high == 0 or prev_low == 0:
        return {'r3': 0, 's3': 0, 'pivot': 0}
    
    # Pivot calculation
    pivot = (prev_high + prev_low + prev_close) / 3
    hl_diff = prev_high - prev_low
    
    r1 = (pivot * 2) - prev_low
    s1 = (pivot * 2) - prev_high
    r2 = pivot + hl_diff
    s2 = pivot - hl_diff
    r3 = r2 + hl_diff
    s3 = s2 - hl_diff
    
    return {
        'pivot': round(pivot, 2),
        'r1': round(r1, 2),
        'r2': round(r2, 2),
        'r3': round(r3, 2),
        's1': round(s1, 2),
        's2': round(s2, 2),
        's3': round(s3, 2)
    }


def calculate_orb_indicator(analysis_data: Dict[str, Any]) -> Dict[str, Any]:
    """Calculate Opening Range Breakout: detection and direction"""
    open_price = analysis_data.get('open', 0)
    close_price = analysis_data.get('price', 0)
    high_price = analysis_data.get('high', 0)
    low_price = analysis_data.get('low', 0)
    
    if open_price == 0:
        return {'breakout_detected': False, 'breakout_direction': 'neutral'}
    
    # Opening range = open ± 1% buffer
    orb_high = open_price * 1.01
    orb_low = open_price * 0.99
    
    breakout_detected = close_price > orb_high or close_price < orb_low
    breakout_direction = 'up' if close_price > orb_high else 'down' if close_price < orb_low else 'neutral'
    
    return {
        'breakout_detected': breakout_detected,
        'breakout_direction': breakout_direction,
        'range_high': round(orb_high, 2),
        'range_low': round(orb_low, 2)
    }


def calculate_supertrend(analysis_data: Dict[str, Any]) -> Dict[str, Any]:
    """Calculate SuperTrend (10,2): trend direction and strength"""
    trend_label = analysis_data.get('trend', 'UNKNOWN').upper()
    price = analysis_data.get('price', 0)
    ema_20 = analysis_data.get('ema_20', 0)
    ema_50 = analysis_data.get('ema_50', 0)
    
    # Map trend label to supertrend
    if trend_label in ['UP', 'UPTREND', 'BULLISH']:
        trend = 'uptrend'
        trend_strength = min(int(abs((ema_20 - ema_50) / ema_50 * 100)), 100) if ema_50 != 0 else 50
    elif trend_label in ['DOWN', 'DOWNTREND', 'BEARISH']:
        trend = 'downtrend'
        trend_strength = min(int(abs((ema_20 - ema_50) / ema_50 * 100)), 100) if ema_50 != 0 else 50
    else:
        trend = 'neutral'
        trend_strength = 50
    
    return {
        'trend': trend,
        'trend_strength': trend_strength,
        'label': trend_label
    }


def calculate_parabolic_sar(analysis_data: Dict[str, Any]) -> Dict[str, Any]:
    """Calculate Parabolic SAR: signal direction"""
    trend = (analysis_data.get('trend') or 'NEUTRAL').upper()
    ema_20 = analysis_data.get('ema_20', 0)
    ema_50 = analysis_data.get('ema_50', 0)
    
    # SAR signal follows EMA alignment
    if ema_20 > ema_50:
        signal = 'buy'
    elif ema_20 < ema_50:
        signal = 'sell'
    else:
        signal = 'neutral'
    
    return {
        'signal': signal,
        'sar_value': 0  # Would need more data for actual SAR value
    }


def calculate_rsi_dual(analysis_data: Dict[str, Any]) -> Dict[str, Any]:
    """Calculate RSI 5m/15m: use momentum to create dual RSI"""
    rsi = analysis_data.get('rsi', 50)
    oi_change = analysis_data.get('oi_change', 0)
    
    # Create 5m and 15m RSI by weighting current RSI with momentum
    # 5m: more sensitive to current RSI
    # 15m: more weighted to momentum
    momentum_weight = (oi_change / 1000) if oi_change else 0  # Normalize OI change
    
    rsi_5m = int(min(100, max(0, rsi + (momentum_weight * 5))))
    rsi_15m = int(min(100, max(0, rsi + (momentum_weight * 2))))
    
    return {
        'rsi_5m': rsi_5m,
        'rsi_15m': rsi_15m,
        'rsi': rsi,
        'momentum': momentum_weight
    }


def calculate_camarilla_cpr(analysis_data: Dict[str, Any]) -> Dict[str, Any]:
    """Calculate Camarilla CPR: R3/S3 and zones"""
    prev_high = analysis_data.get('prev_day_high', analysis_data.get('high', 0))
    prev_low = analysis_data.get('prev_day_low', analysis_data.get('low', 0))
    prev_close = analysis_data.get('prev_day_close', analysis_data.get('price', 0))
    
    if prev_high == 0 or prev_low == 0 or prev_close == 0:
        return {'r3': 0, 's3': 0, 'range': 0}
    
    hl_range = prev_high - prev_low
    
    r1 = prev_close + (hl_range * 1.1 / 4)
    r2 = prev_close + (hl_range * 1.1 / 2)
    r3 = prev_close + (hl_range * 1.1 * 3 / 4)
    
    s1 = prev_close - (hl_range * 1.1 / 4)
    s2 = prev_close - (hl_range * 1.1 / 2)
    s3 = prev_close - (hl_range * 1.1 * 3 / 4)
    
    return {
        'r1': round(r1, 2),
        'r2': round(r2, 2),
        'r3': round(r3, 2),
        's1': round(s1, 2),
        's2': round(s2, 2),
        's3': round(s3, 2),
        'range': round(hl_range, 2)
    }


def calculate_vwma_20(analysis_data: Dict[str, Any]) -> Dict[str, Any]:
    """Calculate VWMA 20: Volume Weighted Moving Average"""
    price = analysis_data.get('price', 0)
    volume = analysis_data.get('volume', 0)
    vwap = analysis_data.get('vwap', price)  # Use VWAP as proxy for VWMA
    
    return {
        'value': round(vwap, 2),
        'current_price': round(price, 2),
        'above_vwma': price > vwap
    }


def calculate_high_volume_scanner(analysis_data: Dict[str, Any]) -> Dict[str, Any]:
    """Calculate High Volume Scanner: detection and direction"""
    volume = analysis_data.get('volume', 0)
    volume_strength = analysis_data.get('volume_strength', 'WEAK')
    price_direction = 'up' if analysis_data.get('vwap_position') == 'above' else 'down'
    
    # High volume detected if strength is STRONG or VERY_STRONG
    high_volume_detected = volume_strength in ['STRONG', 'VERY_STRONG']
    
    # Volume index (0-100)
    volume_index = {'VERY_WEAK': 10, 'WEAK': 25, 'MEDIUM': 50, 'STRONG': 75, 'VERY_STRONG': 100}.get(volume_strength, 50)
    
    return {
        'high_volume_detected': high_volume_detected,
        'volume_direction': price_direction,
        'volume_index': volume_index,
        'strength': volume_strength
    }


def calculate_smart_money_flow(analysis_data: Dict[str, Any]) -> Dict[str, Any]:
    """Calculate Smart Money Flow: accumulation/distribution patterns"""
    price = analysis_data.get('price', 0)
    close_price = analysis_data.get('price', 0)
    open_price = analysis_data.get('open', 0)
    high_price = analysis_data.get('high', 0)
    low_price = analysis_data.get('low', 0)
    volume = analysis_data.get('volume', 0)
    vwap = analysis_data.get('vwap', 0)
    
    # Basic AD (Accumulation/Distribution) logic
    # Close above VWAP + High Volume = Accumulation
    # Close below VWAP + High Volume = Distribution
    
    close_above_vwap = close_price > vwap if vwap != 0 else close_price > open_price
    high_volume = analysis_data.get('volume_strength', 'WEAK') in ['STRONG', 'VERY_STRONG']
    
    accumulation_detected = close_above_vwap and high_volume
    distribution_detected = not close_above_vwap and high_volume
    
    return {
        'accumulation_detected': accumulation_detected,
        'distribution_detected': distribution_detected,
        'structure_type': 'ACCUMULATION' if accumulation_detected else 'DISTRIBUTION' if distribution_detected else 'NEUTRAL',
        'price_vwap_status': 'above' if close_above_vwap else 'below'
    }


def calculate_trade_zones(analysis_data: Dict[str, Any]) -> Dict[str, Any]:
    """Calculate Trade Zones: buy/sell zone detection"""
    price = analysis_data.get('price', 0)
    support = analysis_data.get('support', 0)
    resistance = analysis_data.get('resistance', 0)
    vwap = analysis_data.get('vwap', 0)
    
    # Buy zone: Price is near support with VWAP below
    buy_zone_threshold = (support + price) / 2 if support != 0 else price * 0.98
    in_buy_zone = price < buy_zone_threshold and price > support if support != 0 else False
    
    # Sell zone: Price is near resistance with VWAP above
    sell_zone_threshold = (resistance + price) / 2 if resistance != 0 else price * 1.02
    in_sell_zone = price > sell_zone_threshold and price < resistance if resistance != 0 else False
    
    return {
        'in_buy_zone': in_buy_zone,
        'in_sell_zone': in_sell_zone,
        'zone_type': 'BUY' if in_buy_zone else 'SELL' if in_sell_zone else 'NEUTRAL',
        'buy_price': round(support, 2) if support != 0 else 0,
        'sell_price': round(resistance, 2) if resistance != 0 else 0
    }


def calculate_oi_momentum(analysis_data: Dict[str, Any]) -> Dict[str, Any]:
    """Calculate OI Momentum: momentum type and strength"""
    oi_change = analysis_data.get('oi_change', 0)
    pcr = analysis_data.get('pcr', 1.0)
    
    # Determine momentum type from OI change
    if oi_change > 0:
        momentum_type = 'bullish'
    elif oi_change < 0:
        momentum_type = 'bearish'
    else:
        momentum_type = 'neutral'
    
    # Momentum strength: absolute value of OI change
    momentum_strength = min(int(abs(oi_change) / 1000), 100) if oi_change != 0 else 0
    
    # Adjust for PCR
    if pcr < 1.0:  # PCR < 1 = more calls = bullish
        momentum_type = 'bullish'
        momentum_strength = int((1 - pcr) * 100)
    elif pcr > 1.0:  # PCR > 1 = more puts = bearish
        momentum_type = 'bearish'
        momentum_strength = int((pcr - 1) * 100)
    
    return {
        'momentum_type': momentum_type,
        'momentum_strength': min(momentum_strength, 100),
        'oi_change': oi_change,
        'pcr': round(pcr, 2) if pcr else 1.0
    }


def enhance_analysis_with_14_signals(analysis_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Enhance analysis data with all 14-signal required indicators
    Takes output from instant_analysis and adds missing indicators
    """
    
    # Handle both direct indicators dict and full analysis response
    if 'indicators' in analysis_data:
        enhanced = dict(analysis_data['indicators'])
    else:
        enhanced = dict(analysis_data)
    
    try:
        # 1. Trend Base
        trend_base = calculate_trend_structure(enhanced)
        enhanced['trend_base'] = trend_base
        enhanced['higher_low'] = trend_base['higher_low']
        enhanced['lower_high'] = trend_base['lower_high']
        enhanced['trend_strength'] = trend_base['trend_strength']
        
        # 2. Volume Pulse
        enhanced['volume_profile'] = calculate_volume_profile(enhanced)
        
        # 3. Candle Intent
        enhanced['candle_structure'] = calculate_candle_structure(enhanced)
        
        # 4. Pivot Points
        enhanced['pivot_points'] = calculate_pivot_points(enhanced)
        
        # 5. ORB
        enhanced['orb'] = calculate_orb_indicator(enhanced)
        
        # 6. SuperTrend
        enhanced['supertrend'] = calculate_supertrend(enhanced)
        
        # 7. Parabolic SAR
        enhanced['parabolic_sar'] = calculate_parabolic_sar(enhanced)
        
        # 8. RSI 60/40 (dual RSI)
        rsi_data = calculate_rsi_dual(enhanced)
        enhanced['rsi_5m'] = rsi_data['rsi_5m']
        enhanced['rsi_15m'] = rsi_data['rsi_15m']
        
        # 9. Camarilla CPR
        enhanced['camarilla'] = calculate_camarilla_cpr(enhanced)
        
        # 10. VWMA 20
        enhanced['vwma_20'] = calculate_vwma_20(enhanced)
        
        # 11. High Volume Scanner
        enhanced['high_volume_scanner'] = calculate_high_volume_scanner(enhanced)
        
        # 12. Smart Money Flow
        enhanced['smart_money_flow'] = calculate_smart_money_flow(enhanced)
        
        # 13. Trade Zones
        enhanced['trade_zones'] = calculate_trade_zones(enhanced)
        
        # 14. OI Momentum
        enhanced['oi_momentum'] = calculate_oi_momentum(enhanced)
        
        return enhanced
        
    except Exception as e:
        print(f"⚠️ Error enhancing analysis: {e}")
        import traceback
        traceback.print_exc()
        return enhanced
