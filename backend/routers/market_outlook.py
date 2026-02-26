from fastapi import APIRouter, HTTPException
from typing import Dict, Any, Optional
import asyncio
from datetime import datetime
from services.instant_analysis import get_instant_analysis
from services.cache import get_cache, get_redis
from services.signal_indicators_calculator import enhance_analysis_with_14_signals
from services.live_market_indices_integration import (
    LiveMarketIndicesAnalyzer,
    MarketStatus
)

router = APIRouter(prefix="/api/analysis", tags=["market-outlook"])

class MarketOutlookCalculator:
    """Calculate unified market outlook from 14 integrated signals"""

    @staticmethod
    async def calculate_outlet(symbol: str, indicators: Dict[str, Any]) -> Dict[str, Any]:
        """Calculate comprehensive market outlook with all 14 signals"""

        signals = {}
        bullish_count = 0
        bearish_count = 0
        neutral_count = 0
        total_confidence = 0

        # 1. TREND BASE (Higher-Low Structure)
        trend_base_signal = 'NEUTRAL'
        trend_base_conf = 50
        if indicators.get('higher_low') == True:
            trend_base_signal = 'BUY'
            trend_base_conf = min(indicators.get('trend_strength', 50) + 20, 95)
            bullish_count += 1
        elif indicators.get('lower_high') == True:
            trend_base_signal = 'SELL'
            trend_base_conf = min(indicators.get('trend_strength', 50) + 20, 95)
            bearish_count += 1
        else:
            neutral_count += 1

        signals['trend_base'] = {
            'name': 'Trend Base (Structure)',
            'confidence': trend_base_conf,
            'signal': trend_base_signal,
            'status': f"Trend Strength: {indicators.get('trend_strength', 50)}%"
        }
        total_confidence += trend_base_conf

        # 2. VOLUME PULSE (Candle Volume)
        volume_pulse_signal = 'NEUTRAL'
        volume_pulse_conf = 50
        volume_profile = indicators.get('volume_profile', {})
        if volume_profile.get('current_volume_strength', 0) > 70:
            volume_pulse_signal = 'BUY' if indicators.get('price_direction', 'up') == 'up' else 'SELL'
            volume_pulse_conf = 75
            if volume_pulse_signal == 'BUY':
                bullish_count += 1
            else:
                bearish_count += 1
        else:
            neutral_count += 1

        signals['volume_pulse'] = {
            'name': 'Volume Pulse',
            'confidence': volume_pulse_conf,
            'signal': volume_pulse_signal,
            'status': f"Vol Strength: {volume_profile.get('current_volume_strength', 0)}%"
        }
        total_confidence += volume_pulse_conf

        # 3. CANDLE INTENT (Candle Structure)
        candle_intent_signal = 'NEUTRAL'
        candle_intent_conf = 50
        candle_structure = indicators.get('candle_structure', {})
        intent_strength = candle_structure.get('bullish_strength', 50)
        if intent_strength > 65:
            candle_intent_signal = 'BUY'
            candle_intent_conf = min(intent_strength, 90)
            bullish_count += 1
        elif intent_strength < 35:
            candle_intent_signal = 'SELL'
            candle_intent_conf = min(abs(35 - intent_strength) + 50, 90)
            bearish_count += 1
        else:
            neutral_count += 1

        signals['candle_intent'] = {
            'name': 'Candle Intent',
            'confidence': candle_intent_conf,
            'signal': candle_intent_signal,
            'status': f"Intent Score: {intent_strength}%"
        }
        total_confidence += candle_intent_conf

        # 4. PIVOT POINTS
        pivot_signal = 'NEUTRAL'
        pivot_conf = 50
        pivot_data = indicators.get('pivot_points', {})
        current_price = indicators.get('price', 0)
        r3 = pivot_data.get('r3', 0)
        s3 = pivot_data.get('s3', 0)
        
        if current_price > r3:
            pivot_signal = 'BUY'
            pivot_conf = 80
            bullish_count += 1
        elif current_price < s3:
            pivot_signal = 'SELL'
            pivot_conf = 80
            bearish_count += 1
        else:
            neutral_count += 1

        signals['pivot_points'] = {
            'name': 'Pivot Points',
            'confidence': pivot_conf,
            'signal': pivot_signal,
            'status': f"Price vs Pivots: R3={r3:.2f}, S3={s3:.2f}"
        }
        total_confidence += pivot_conf

        # 5. OPENING RANGE BREAKOUT (ORB)
        orb_signal = 'NEUTRAL'
        orb_conf = 50
        orb_data = indicators.get('orb', {})
        if orb_data.get('breakout_detected', False):
            orb_signal = 'BUY' if orb_data.get('breakout_direction', 'up') == 'up' else 'SELL'
            orb_conf = 85
            if orb_signal == 'BUY':
                bullish_count += 1
            else:
                bearish_count += 1
        else:
            neutral_count += 1

        signals['opening_range_breakout'] = {
            'name': 'ORB',
            'confidence': orb_conf,
            'signal': orb_signal,
            'status': f"Breakout: {orb_data.get('breakout_detected', False)}"
        }
        total_confidence += orb_conf

        # 6. SUPERTREND (10,2)
        supertrend_signal = 'NEUTRAL'
        supertrend_conf = 50
        supertrend_data = indicators.get('supertrend', {})
        if supertrend_data.get('trend', 'neutral').lower() == 'uptrend':
            supertrend_signal = 'BUY'
            supertrend_conf = min(80 + (supertrend_data.get('trend_strength', 0) * 5), 98)
            bullish_count += 1
        elif supertrend_data.get('trend', 'neutral').lower() == 'downtrend':
            supertrend_signal = 'SELL'
            supertrend_conf = min(80 + (supertrend_data.get('trend_strength', 0) * 5), 98)
            bearish_count += 1
        else:
            neutral_count += 1

        signals['supertrend'] = {
            'name': 'SuperTrend (10,2)',
            'confidence': supertrend_conf,
            'signal': supertrend_signal,
            'status': f"Trend: {supertrend_data.get('trend', 'NEUTRAL')}"
        }
        total_confidence += supertrend_conf

        # 7. PARABOLIC SAR
        sar_signal = 'NEUTRAL'
        sar_conf = 50
        sar_data = indicators.get('parabolic_sar', {})
        if sar_data.get('signal', 'neutral') == 'buy':
            sar_signal = 'BUY'
            sar_conf = 70
            bullish_count += 1
        elif sar_data.get('signal', 'neutral') == 'sell':
            sar_signal = 'SELL'
            sar_conf = 70
            bearish_count += 1
        else:
            neutral_count += 1

        signals['parabolic_sar'] = {
            'name': 'Parabolic SAR',
            'confidence': sar_conf,
            'signal': sar_signal,
            'status': f"SAR Signal: {sar_data.get('signal', 'NEUTRAL')}"
        }
        total_confidence += sar_conf

        # 8. RSI 60/40 MOMENTUM
        rsi_signal = 'NEUTRAL'
        rsi_conf = 50
        rsi_5m = indicators.get('rsi_5m', 50)
        rsi_15m = indicators.get('rsi_15m', 50)
        rsi_avg = (rsi_5m + rsi_15m) / 2

        if rsi_avg > 60:
            rsi_signal = 'BUY'
            rsi_conf = min((rsi_avg - 50) * 2, 95)
            bullish_count += 1
        elif rsi_avg < 40:
            rsi_signal = 'SELL'
            rsi_conf = min((50 - rsi_avg) * 2, 95)
            bearish_count += 1
        else:
            neutral_count += 1

        signals['rsi_60_40'] = {
            'name': 'RSI 60/40',
            'confidence': rsi_conf,
            'signal': rsi_signal,
            'status': f"RSI 5m: {rsi_5m}%, 15m: {rsi_15m}%"
        }
        total_confidence += rsi_conf

        # 9. CAMARILLA R3/S3
        camarilla_signal = 'NEUTRAL'
        camarilla_conf = 50
        camarilla_data = indicators.get('camarilla', {})
        camarilla_r3 = camarilla_data.get('r3', 0)
        camarilla_s3 = camarilla_data.get('s3', 0)
        
        if current_price > camarilla_r3:
            camarilla_signal = 'BUY'
            camarilla_conf = 75
            bullish_count += 1
        elif current_price < camarilla_s3:
            camarilla_signal = 'SELL'
            camarilla_conf = 75
            bearish_count += 1
        else:
            neutral_count += 1

        signals['camarilla'] = {
            'name': 'Camarilla (R3/S3)',
            'confidence': camarilla_conf,
            'signal': camarilla_signal,
            'status': f"CPR Zone: R3={camarilla_r3:.2f}, S3={camarilla_s3:.2f}"
        }
        total_confidence += camarilla_conf

        # 10. VWMA 20 (Entry Filter)
        vwma_signal = 'NEUTRAL'
        vwma_conf = 50
        vwma_data = indicators.get('vwma_20', {})
        vwma_value = vwma_data.get('value', current_price)
        
        if current_price > vwma_value * 1.002:  # 0.2% above VWMA
            vwma_signal = 'BUY'
            vwma_conf = 65
            bullish_count += 1
        elif current_price < vwma_value * 0.998:  # 0.2% below VWMA
            vwma_signal = 'SELL'
            vwma_conf = 65
            bearish_count += 1
        else:
            neutral_count += 1

        signals['vwma_20'] = {
            'name': 'VWMA 20',
            'confidence': vwma_conf,
            'signal': vwma_signal,
            'status': f"VWMA Entry Filter Active"
        }
        total_confidence += vwma_conf

        # 11. HIGH VOLUME CANDLE SCANNER
        hvcs_signal = 'NEUTRAL'
        hvcs_conf = 50
        hvcs_data = indicators.get('high_volume_scanner', {})
        if hvcs_data.get('high_volume_detected', False):
            hvcs_signal = 'BUY' if hvcs_data.get('volume_direction', 'up') == 'up' else 'SELL'
            hvcs_conf = 80
            if hvcs_signal == 'BUY':
                bullish_count += 1
            else:
                bearish_count += 1
        else:
            neutral_count += 1

        signals['high_volume_scanner'] = {
            'name': 'High Volume Scanner',
            'confidence': hvcs_conf,
            'signal': hvcs_signal,
            'status': f"Volume Anomaly: {hvcs_data.get('volume_index', 0)}%"
        }
        total_confidence += hvcs_conf

        # 12. SMART MONEY FLOW (Order Structure Intelligence)
        smf_signal = 'NEUTRAL'
        smf_conf = 50
        smf_data = indicators.get('smart_money_flow', {})
        if smf_data.get('accumulation_detected', False):
            smf_signal = 'BUY'
            smf_conf = 85
            bullish_count += 1
        elif smf_data.get('distribution_detected', False):
            smf_signal = 'SELL'
            smf_conf = 85
            bearish_count += 1
        else:
            neutral_count += 1

        signals['smart_money_flow'] = {
            'name': 'Smart Money Flow',
            'confidence': smf_conf,
            'signal': smf_signal,
            'status': f"Order Structure: {smf_data.get('structure_type', 'NEUTRAL')}"
        }
        total_confidence += smf_conf

        # 13. TRADE ZONES (Buy/Sell Signals)
        tz_signal = 'NEUTRAL'
        tz_conf = 50
        tz_data = indicators.get('trade_zones', {})
        if tz_data.get('in_buy_zone', False):
            tz_signal = 'BUY'
            tz_conf = 80
            bullish_count += 1
        elif tz_data.get('in_sell_zone', False):
            tz_signal = 'SELL'
            tz_conf = 80
            bearish_count += 1
        else:
            neutral_count += 1

        signals['trade_zones'] = {
            'name': 'Trade Zones',
            'confidence': tz_conf,
            'signal': tz_signal,
            'status': f"Zone Status: {tz_data.get('zone_type', 'NEUTRAL')}"
        }
        total_confidence += tz_conf

        # 14. OI MOMENTUM SIGNALS
        oi_signal = 'NEUTRAL'
        oi_conf = 50
        oi_data = indicators.get('oi_momentum', {})
        if oi_data.get('momentum_type', 'neutral') == 'bullish':
            oi_signal = 'BUY'
            oi_conf = min(70 + (oi_data.get('momentum_strength', 0) * 3), 95)
            bullish_count += 1
        elif oi_data.get('momentum_type', 'neutral') == 'bearish':
            oi_signal = 'SELL'
            oi_conf = min(70 + (oi_data.get('momentum_strength', 0) * 3), 95)
            bearish_count += 1
        else:
            neutral_count += 1

        signals['oi_momentum'] = {
            'name': 'OI Momentum',
            'confidence': oi_conf,
            'signal': oi_signal,
            'status': f"Momentum: {oi_data.get('momentum_type', 'NEUTRAL')}"
        }
        total_confidence += oi_conf

        # Calculate trend percentage
        total_signals = bullish_count + bearish_count + neutral_count
        if total_signals > 0:
            trend_percentage = ((bullish_count - bearish_count) / total_signals) * 100
        else:
            trend_percentage = 0

        # Calculate overall signal
        overall_confidence = int(total_confidence / 14)
        
        if bullish_count > bearish_count + 3:
            overall_signal = 'STRONG_BUY' if overall_confidence > 70 else 'BUY'
        elif bearish_count > bullish_count + 3:
            overall_signal = 'STRONG_SELL' if overall_confidence > 70 else 'SELL'
        else:
            overall_signal = 'NEUTRAL'

        return {
            'timestamp': datetime.now().isoformat(),
            'symbol': symbol,
            'overall_signal': overall_signal,
            'overall_confidence': overall_confidence,
            'bullish_signals': bullish_count,
            'bearish_signals': bearish_count,
            'neutral_signals': neutral_count,
            'trend_percentage': round(trend_percentage, 1),
            'signals': {
                'trend_base': signals['trend_base'],
                'volume_pulse': signals['volume_pulse'],
                'candle_intent': signals['candle_intent'],
                'pivot_points': signals['pivot_points'],
                'orb': signals['opening_range_breakout'],
                'supertrend': signals['supertrend'],
                'parabolic_sar': signals['parabolic_sar'],
                'rsi_60_40': signals['rsi_60_40'],
                'camarilla': signals['camarilla'],
                'vwma_20': signals['vwma_20'],
                'high_volume_scanner': signals['high_volume_scanner'],
                'smart_money_flow': signals['smart_money_flow'],
                'trade_zones': signals['trade_zones'],
                'oi_momentum': signals['oi_momentum'],
            }
        }


@router.get("/market-outlook/{symbol}")
async def get_market_outlook(symbol: str):
    """
    Get comprehensive market outlook with all 14 integrated signals
    
    Returns:
    - Overall signal (STRONG_BUY, BUY, NEUTRAL, SELL, STRONG_SELL)
    - Overall confidence percentage
    - Individual signal confidence and status for all 14 signals
    - Signal distribution (bullish, bearish, neutral count)
    - Trend percentage
    """
    try:
        # Get cache service
        cache_svc = get_cache()
        
        # Get latest analysis data
        analysis = await get_instant_analysis(cache_svc, symbol)
        
        if not analysis or 'indicators' not in analysis:
            raise HTTPException(status_code=404, detail=f"No analysis data for {symbol}")

        # 🔥 ENHANCE indicators with 14-signal calculations
        indicators = enhance_analysis_with_14_signals(analysis)

        # Calculate market outlook
        outlook = await MarketOutlookCalculator.calculate_outlet(symbol, indicators)

        # Cache for quick subsequent reads
        cache = await get_redis()
        await cache.set(
            f"market_outlook:{symbol}",
            outlook,
            expire=60  # 60 second cache
        )

        return outlook

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Market outlook calculation error: {str(e)}")


@router.get("/market-outlook/all")
async def get_all_symbols_market_outlook():
    """Get market outlook for NIFTY, BANKNIFTY, SENSEX"""
    symbols = ['NIFTY', 'BANKNIFTY', 'SENSEX']
    results = {}
    
    for symbol in symbols:
        try:
            results[symbol] = await get_market_outlook(symbol)
        except Exception as e:
            results[symbol] = {'error': str(e)}
    
    return results


@router.get("/trading-decision/{symbol}")
async def get_trading_decision_with_indices(symbol: str):
    """
    🔥 TRADING DECISION ENDPOINT
    Combines 14-Signal Market Outlook with Live Market Indices
    
    Returns complete trading recommendation based on:
    1. 14-Signal confidence analysis
    2. PCR Sentiment (Put-Call Ratio)
    3. OI Momentum (Open Interest changes)
    4. Market Breadth (Advance/Decline)
    5. Volatility Index
    6. Market Status (Open/Closed/Pre-Open)
    
    Perfect for traders to make quick decisions
    """
    try:
        symbol = symbol.upper()
        
        # Get 14-signal market outlook
        outlook = await get_market_outlook(symbol)
        
        if not outlook or 'error' in outlook:
            raise HTTPException(status_code=404, detail=f"No analysis data for {symbol}")
        
        # Extract analysis data for indices integration
        cache_svc = get_cache()
        analysis = await get_instant_analysis(cache_svc, symbol)
        if not analysis:
            raise HTTPException(status_code=500, detail="Could not fetch analysis data")
        
        indicators = analysis.get('indicators', {})
        
        # Get market indices data
        pcr = indicators.get('pcr', 1.0)
        oi_change = indicators.get('oi_change', 0)
        price = indicators.get('price', 0)
        prev_price = indicators.get('prev_day_close', price)
        price_change = price - prev_price if prev_price > 0 else 0
        high = indicators.get('high', 0)
        low = indicators.get('low', 0)
        prev_high = indicators.get('prev_day_high', 0)
        prev_low = indicators.get('prev_day_low', 0)
        
        # Estimate advance/decline based on momentum
        # In production, this would come from live API data
        signal_bullish = outlook.get('bullish_signals', 0)
        signal_bearish = outlook.get('bearish_signals', 0)
        estimated_advance = max(10, signal_bullish * 5)
        estimated_decline = max(10, signal_bearish * 5)
        
        # Get current market status
        now = datetime.now()
        market_status = LiveMarketIndicesAnalyzer.calculate_market_status(
            now.hour, now.minute, now.weekday()
        )
        
        # Calculate volatility index
        if prev_high > 0 and prev_low > 0 and high > 0 and low > 0:
            volatility_analyzer = LiveMarketIndicesAnalyzer.analyze_volatility(
                price, high, low, prev_high, prev_low
            )
            volatility_index = volatility_analyzer.get('volatility_index', 50)
        else:
            volatility_index = 50
        
        # Combine all signals with indices for trading decision
        trading_recommendation = LiveMarketIndicesAnalyzer.combine_signals_with_indices(
            outlook_signal=outlook.get('overall_signal', 'NEUTRAL'),
            outlook_confidence=outlook.get('overall_confidence', 50),
            bullish_count=outlook.get('bullish_signals', 0),
            bearish_count=outlook.get('bearish_signals', 0),
            pcr=pcr,
            oi_change=oi_change,
            advance_count=estimated_advance,
            decline_count=estimated_decline,
            volatility_index=volatility_index,
            market_status=market_status
        )
        
        # Cache result
        cache = await get_redis()
        await cache.set(
            f"trading_decision:{symbol}",
            trading_recommendation,
            expire=60  # 60 second cache
        )
        
        return trading_recommendation
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Trading decision error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Trading decision error: {str(e)}")


@router.get("/trading-decision/all")
async def get_all_trading_decisions():
    """Get trading decisions with indices for all 3 symbols"""
    symbols = ['NIFTY', 'BANKNIFTY', 'SENSEX']
    results = {}
    
    for symbol in symbols:
        try:
            results[symbol] = await get_trading_decision_with_indices(symbol)
        except Exception as e:
            results[symbol] = {'error': str(e), 'symbol': symbol}
    
    return results
