"""
🔥 LIVE MARKET INDICES INTEGRATION
Combines 14-Signal Market Outlook with Live Market Indices
Creates comprehensive trading decisions based on market status & confidence levels

Integration Points:
1. Market Breadth (Advance/Decline ratio)
2. PCR Ratio (Put-Call Ratio - sentiment)
3. OI Momentum (Options Open Interest)
4. Volatility Index (VIX-like)
5. Sector Performance
6. Market Status (Open/Closed/Pre-Open)
"""

from typing import Dict, Any, List
from datetime import datetime
from enum import Enum


class MarketStatus(Enum):
    """Market session status"""
    PRE_OPEN = "PRE_OPEN"
    MARKET_OPEN = "MARKET_OPEN"
    MARKET_CLOSED = "MARKET_CLOSED"
    AFTER_HOURS = "AFTER_HOURS"


class TradingDecision(Enum):
    """Trading action recommendation"""
    STRONG_BUY = "STRONG_BUY"
    BUY = "BUY"
    HOLD = "HOLD"
    SELL = "SELL"
    STRONG_SELL = "STRONG_SELL"
    WAIT = "WAIT"


class LiveMarketIndicesAnalyzer:
    """
    Analyzes live market indices and combines with 14-signal outlook
    Creates actionable trading decisions based on multiple factors
    """

    @staticmethod
    def analyze_pcr_sentiment(pcr: float) -> Dict[str, Any]:
        """
        Put-Call Ratio sentiment analysis
        PCR < 0.6 = Bearish (more calls = bullish)
        PCR 0.6-1.4 = Neutral
        PCR > 1.4 = Bullish (more puts = downside protection/bearish)
        """
        if pcr < 0.6:
            sentiment = "VERY_BULLISH"
            strength = min((0.6 - pcr) * 100, 100)
        elif pcr < 1.0:
            sentiment = "BULLISH"
            strength = (1.0 - pcr) * 50
        elif pcr <= 1.4:
            sentiment = "NEUTRAL"
            strength = 50
        elif pcr < 2.0:
            sentiment = "BEARISH"
            strength = (pcr - 1.4) * 50
        else:
            sentiment = "VERY_BEARISH"
            strength = min((pcr - 1.4) * 100, 100)

        return {
            'pcr_value': round(pcr, 2),
            'sentiment': sentiment,
            'strength': int(strength),
            'interpretation': f"PCR {pcr:.2f} indicates {sentiment} market sentiment",
            'action': 'BUY_BIAS' if pcr < 1.0 else 'NEUTRAL' if pcr <= 1.4 else 'SELL_BIAS'
        }

    @staticmethod
    def analyze_oi_momentum(oi_change: float, price_change: float) -> Dict[str, Any]:
        """
        OI Momentum Analysis
        OI Increase + Price Up = Bullish continuation
        OI Increase + Price Down = Bearish setup
        OI Decrease + Price Down = Bullish reversal
        OI Decrease + Price Up = Bearish reversal
        """
        oi_direction = 'INCREASE' if oi_change > 0 else 'DECREASE'
        price_direction = 'UP' if price_change > 0 else 'DOWN'

        # Determine momentum type and strength
        if oi_change > 1000 and price_change > 0:
            momentum = 'STRONG_BULLISH'
            strength = min((oi_change / 1000) * 20, 100)
        elif oi_change > 500 and price_change > 0:
            momentum = 'BULLISH'
            strength = min((oi_change / 1000) * 15, 100)
        elif oi_change > 1000 and price_change < 0:
            momentum = 'BEARISH_SETUP'
            strength = min((oi_change / 1000) * 20, 100)
        elif oi_change < -1000 and price_change < 0:
            momentum = 'BULLISH_REVERSAL'
            strength = min(abs(oi_change / 1000) * 20, 100)
        elif oi_change < -1000 and price_change > 0:
            momentum = 'BEARISH_REVERSAL'
            strength = min(abs(oi_change / 1000) * 20, 100)
        else:
            momentum = 'NEUTRAL'
            strength = 50

        return {
            'oi_change': int(oi_change),
            'price_change': round(price_change, 2),
            'oi_direction': oi_direction,
            'price_direction': price_direction,
            'momentum': momentum,
            'strength': int(strength),
            'interpretation': f"OI {oi_direction} with {price_direction} price = {momentum}"
        }

    @staticmethod
    def analyze_market_breadth(advance_count: int, decline_count: int, 
                               unchanged_count: int) -> Dict[str, Any]:
        """
        Market Breadth Analysis
        Advance/Decline ratio shows market participation
        A/D > 2:1 = Strong bullish
        A/D 1:1 = Neutral
        A/D < 1:2 = Strong bearish
        """
        total = advance_count + decline_count + unchanged_count

        if total == 0:
            advance_percent = decline_percent = unchanged_percent = 0
            ad_ratio = 1.0
            breadth_signal = 'INSUFFICIENT_DATA'
            strength = 0
        else:
            advance_percent = (advance_count / total) * 100
            decline_percent = (decline_count / total) * 100
            unchanged_percent = (unchanged_count / total) * 100
            ad_ratio = advance_count / decline_count if decline_count > 0 else advance_count

            if ad_ratio > 2.0:
                breadth_signal = 'STRONG_BULLISH'
                strength = min((ad_ratio - 1) * 25, 100)
            elif ad_ratio > 1.0:
                breadth_signal = 'BULLISH'
                strength = (ad_ratio - 1) * 50
            elif ad_ratio >= 0.5:
                breadth_signal = 'NEUTRAL'
                strength = 50
            elif ad_ratio > 0.2:
                breadth_signal = 'BEARISH'
                strength = (1 / ad_ratio - 1) * 30
            else:
                breadth_signal = 'STRONG_BEARISH'
                strength = min((1 / ad_ratio - 1) * 40, 100)

        return {
            'advance_count': advance_count,
            'decline_count': decline_count,
            'unchanged_count': unchanged_count,
            'advance_percent': round(advance_percent, 1),
            'decline_percent': round(decline_percent, 1),
            'unchanged_percent': round(unchanged_percent, 1),
            'ad_ratio': round(ad_ratio, 2),
            'breadth_signal': breadth_signal,
            'strength': int(strength),
            'interpretation': f"A/D Ratio {ad_ratio:.2f} indicates {breadth_signal} market participation"
        }

    @staticmethod
    def analyze_volatility(current_price: float, high: float, low: float,
                          prev_day_high: float, prev_day_low: float) -> Dict[str, Any]:
        """
        Volatility Analysis
        Measures price range relative to previous day
        High volatility = Risk increase but opportunity
        Low volatility = Range-bound consolidation
        """
        if prev_day_high == 0 or prev_day_low == 0:
            today_range = high - low if high > 0 and low > 0 else 0
            prev_range = 1
        else:
            today_range = high - low
            prev_range = prev_day_high - prev_day_low

        volatility_ratio = today_range / prev_range if prev_range > 0 else 1.0
        volatility_index = min(volatility_ratio * 50, 100)

        if volatility_ratio > 1.5:
            volatility_level = 'VERY_HIGH'
            action = 'CAUTION_OPTIONS_ACTIVITY'
        elif volatility_ratio > 1.1:
            volatility_level = 'HIGH'
            action = 'MONITOR_CLOSELY'
        elif volatility_ratio >= 0.9:
            volatility_level = 'NORMAL'
            action = 'STANDARD_TRADING'
        elif volatility_ratio > 0.7:
            volatility_level = 'LOW'
            action = 'WATCH_FOR_BREAKOUT'
        else:
            volatility_level = 'VERY_LOW'
            action = 'CONSOLIDATION_EXPECTED'

        return {
            'today_range': round(today_range, 2),
            'prev_range': round(prev_range, 2),
            'volatility_ratio': round(volatility_ratio, 2),
            'volatility_index': int(volatility_index),
            'volatility_level': volatility_level,
            'action': action,
            'interpretation': f"Volatility {volatility_level} ({volatility_index}%) - {action}"
        }

    @staticmethod
    def calculate_market_status(hour: int, minute: int, day_of_week: int) -> MarketStatus:
        """
        Determine current market status
        IST: 9:15 AM - 3:30 PM = Market Open (Mon-Fri)
        """
        is_weekday = day_of_week < 5  # 0-4 = Mon-Fri

        if not is_weekday:
            return MarketStatus.MARKET_CLOSED

        time_minutes = hour * 60 + minute
        market_open = 9 * 60 + 15  # 9:15 AM
        market_close = 15 * 60 + 30  # 3:30 PM
        after_hours_close = 20 * 60  # 8:00 PM

        if time_minutes < market_open:
            return MarketStatus.PRE_OPEN
        elif time_minutes <= market_close:
            return MarketStatus.MARKET_OPEN
        elif time_minutes <= after_hours_close:
            return MarketStatus.AFTER_HOURS
        else:
            return MarketStatus.MARKET_CLOSED

    @staticmethod
    def combine_signals_with_indices(
            outlook_signal: str,
            outlook_confidence: int,
            bullish_count: int,
            bearish_count: int,
            pcr: float,
            oi_change: float,
            advance_count: int = 0,
            decline_count: int = 0,
            volatility_index: int = 50,
            market_status: MarketStatus = MarketStatus.MARKET_OPEN
    ) -> Dict[str, Any]:
        """
        MASTER FUNCTION: Combines all market data for trading decision
        
        Parameters:
        - outlook_signal: From 14-signal analysis (STRONG_BUY, BUY, NEUTRAL, SELL, STRONG_SELL)
        - outlook_confidence: 0-100% confidence from 14 signals
        - bullish_count: Number of bullish signals
        - bearish_count: Number of bearish signals
        - pcr: Put-Call ratio (< 1.0 bullish, > 1.4 bearish)
        - oi_change: Change in open interest (+bullish, -bearish)
        - advance_count: Advancing stocks
        - decline_count: Declining stocks
        - volatility_index: 0-100% volatility
        - market_status: Current market session
        
        Returns: Complete trading decision with confidence levels
        """
        
        # Safe value handling
        if outlook_signal is None:
            outlook_signal = 'NEUTRAL'
        if outlook_confidence is None:
            outlook_confidence = 50
        if pcr is None:
            pcr = 1.0
        if oi_change is None:
            oi_change = 0
        if volatility_index is None:
            volatility_index = 50

        # Calculate base trading decision from 14-signals
        if 'STRONG_BUY' in outlook_signal:
            base_decision = TradingDecision.STRONG_BUY
            base_score = min(outlook_confidence + 20, 100)
        elif 'BUY' in outlook_signal:
            base_decision = TradingDecision.BUY
            base_score = outlook_confidence
        elif 'STRONG_SELL' in outlook_signal:
            base_decision = TradingDecision.STRONG_SELL
            base_score = min(outlook_confidence + 20, 100)
        elif 'SELL' in outlook_signal:
            base_decision = TradingDecision.SELL
            base_score = outlook_confidence
        else:
            base_decision = TradingDecision.HOLD
            base_score = 50

        # Analyze market indices
        pcr_analysis = LiveMarketIndicesAnalyzer.analyze_pcr_sentiment(pcr)
        breadth = LiveMarketIndicesAnalyzer.analyze_market_breadth(advance_count, decline_count, 0)

        # PCR adjustment: bullish PCR boosts BUY, bearish PCR boosts SELL
        pcr_score = pcr_analysis['strength']
        if pcr_analysis['action'] == 'BUY_BIAS':
            pcr_adjustment = pcr_score * 0.3  # Up to +30 points
        elif pcr_analysis['action'] == 'SELL_BIAS':
            pcr_adjustment = -pcr_score * 0.3  # Down to -30 points
        else:
            pcr_adjustment = 0

        # OI momentum adjustment
        oi_adjusted_score = pcr_score + (oi_change / 100 if oi_change else 0)
        if oi_change > 500 and base_decision in [TradingDecision.BUY, TradingDecision.STRONG_BUY]:
            oi_adjustment = min(oi_change / 1000 * 10, 20)
        elif oi_change < -500 and base_decision in [TradingDecision.SELL, TradingDecision.STRONG_SELL]:
            oi_adjustment = min(abs(oi_change) / 1000 * 10, 20)
        else:
            oi_adjustment = 0

        # Volatility adjustment: High volatility reduces confidence, low increases it
        if volatility_index > 75:
            volatility_adjustment = -15  # Reduce confidence for high volatility
            volatility_caution = "⚠️ HIGH VOLATILITY - Exercise caution"
        elif volatility_index < 30:
            volatility_adjustment = 10  # Increase confidence for low volatility (trending)
            volatility_caution = "✅ LOW VOLATILITY - Trending market"
        else:
            volatility_adjustment = 0
            volatility_caution = "NORMAL volatility"

        # Market breadth strength
        breadth_score = breadth['strength']
        if breadth['breadth_signal'].endswith('BULLISH'):
            breadth_adjustment = breadth_score * 0.2
        elif breadth['breadth_signal'].endswith('BEARISH'):
            breadth_adjustment = -breadth_score * 0.2
        else:
            breadth_adjustment = 0

        # Calculate final confidence score
        final_score = max(0, min(100,
            base_score +
            (pcr_adjustment * 0.3) +
            (oi_adjustment * 0.3) +
            (volatility_adjustment * 0.2) +
            (breadth_adjustment * 0.2)
        ))

        # Determine final trading decision based on combined score and signals
        signal_agreement = bullish_count - bearish_count
        signal_agreement_percent = (signal_agreement / 14) * 100 if bullish_count + bearish_count > 0 else 0

        if final_score > 75 and signal_agreement_percent > 20:
            final_decision = TradingDecision.STRONG_BUY
            action_description = "STRONG BULLISH BIAS - Multiple confluences"
        elif final_score > 65 and signal_agreement_percent > 10:
            final_decision = TradingDecision.BUY
            action_description = "BULLISH BIAS - Good trading opportunity"
        elif final_score > 55 and signal_agreement_percent > 0:
            final_decision = TradingDecision.HOLD
            action_description = "HOLD LONG - Wait for confirmation"
        elif final_score < 25 and signal_agreement_percent < -20:
            final_decision = TradingDecision.STRONG_SELL
            action_description = "STRONG BEARISH BIAS - Multiple confluences"
        elif final_score < 35 and signal_agreement_percent < -10:
            final_decision = TradingDecision.SELL
            action_description = "BEARISH BIAS - Exit preparation"
        elif final_score < 45 and signal_agreement_percent < 0:
            final_decision = TradingDecision.HOLD
            action_description = "HOLD SHORT - Wait for confirmation"
        else:
            if market_status != MarketStatus.MARKET_OPEN:
                final_decision = TradingDecision.WAIT
                action_description = "MARKET CLOSED - Wait for market open"
            else:
                final_decision = TradingDecision.HOLD
                action_description = "NEUTRAL - Insufficient conviction"

        # Build trading recommendation
        recommendation = {
            'timestamp': datetime.now().isoformat(),
            'market_status': market_status.value,
            
            # Base signal information
            '14_signal_analysis': {
                'overall_signal': outlook_signal,
                'overall_confidence': outlook_confidence,
                'bullish_signals': bullish_count,
                'bearish_signals': bearish_count,
                'signal_agreement_percent': round(signal_agreement_percent, 1),
            },
            
            # Market indices analysis
            'market_indices': {
                'pcr': pcr_analysis,
                'oi_momentum': f"OI Change: {oi_change}, Impact: {'Bullish' if oi_change > 0 else 'Bearish'}",
                'market_breadth': breadth,
                'volatility': volatility_caution,
            },
            
            # Score components (transparency)
            'score_components': {
                'base_score': round(base_score, 1),
                'pcr_adjustment': round(pcr_adjustment, 1),
                'oi_adjustment': round(oi_adjustment, 1),
                'volatility_adjustment': round(volatility_adjustment, 1),
                'breadth_adjustment': round(breadth_adjustment, 1),
                'final_score': round(final_score, 1),
            },
            
            # Final trading decision
            'trading_decision': {
                'action': final_decision.value,
                'confidence': int(final_score),
                'description': action_description,
                'risk_level': 'HIGH' if volatility_index > 75 else 'MEDIUM' if volatility_index > 40 else 'LOW',
            },
            
            # Actionable recommendations
            'trader_actions': {
                'entry_setup': get_entry_action(final_decision, final_score),
                'position_management': get_position_action(final_decision, signal_agreement_percent),
                'risk_management': get_risk_action(volatility_index, final_score),
                'time_frame_preference': get_timeframe_recommendation(final_score),
            },
            
            # Monitoring parameters
            'monitor': {
                'key_levels_to_watch': f"Support/Resistance based on PCR {pcr:.2f}",
                'confirmation_signals': get_confirmation_signals(final_decision),
                'exit_trigger': get_exit_trigger(final_decision, volatility_index),
                'next_check_minutes': 5 if market_status == MarketStatus.MARKET_OPEN else 30,
            }
        }

        return recommendation


def get_entry_action(decision: TradingDecision, confidence: float) -> str:
    """Get entry action based on decision and confidence"""
    if decision == TradingDecision.STRONG_BUY:
        return "Aggressive BUY - Use market/limit orders at market support levels"
    elif decision == TradingDecision.BUY:
        return "Conservative BUY - Use limit orders 2-3 pts above support"
    elif decision == TradingDecision.SELL:
        return "Conservative SELL - Use limit orders 2-3 pts below resistance"
    elif decision == TradingDecision.STRONG_SELL:
        return "Aggressive SELL - Use market/limit orders at resistance levels"
    else:
        return "HOLD - Wait for clearer signal or market setup"


def get_position_action(decision: TradingDecision, signal_agreement: float) -> str:
    """Get position management action"""
    if signal_agreement > 30:
        return "Add to winning position - signals strongly aligned"
    elif signal_agreement > 10:
        return "Hold position - maintain exposure"
    elif signal_agreement > -10:
        return "Reduce position size - mixed signals"
    else:
        return "Exit position early - strong divergence signals exit"


def get_risk_action(volatility: int, confidence: float) -> str:
    """Get risk management action"""
    if volatility > 75:
        return "❌ Reduce position size - High volatility = use tight stops (1% risk max)"
    elif confidence < 40:
        return "🟡 Use protective positions - Low confidence = wider stops required"
    else:
        return "✅ Normal risk management - Standard position sizing acceptable"


def get_timeframe_recommendation(confidence: float) -> str:
    """Get timeframe preference"""
    if confidence > 75:
        return "INTRADAY (15m-1h) - High confidence allows scalping/swing trades"
    elif confidence > 60:
        return "SHORT TERM (1-4h) - Good setup for short-term trades"
    else:
        return "SWING (4h+) - Lower confidence = longer holding period needed"


def get_confirmation_signals(decision: TradingDecision) -> List[str]:
    """Get signals that confirm the decision"""
    bullish_signals = [
        "Price breaks above resistance",
        "Volume increases on up move",
        "RSI crosses above 60",
        "VWAP remains below price"
    ]
    bearish_signals = [
        "Price breaks below support",
        "Volume increases on down move",
        "RSI crosses below 40",
        "VWAP remains above price"
    ]
    neutral_signals = ["Price consolidates in range", "Volume decreases"]

    if 'BUY' in decision.value:
        return bullish_signals[:2]
    elif 'SELL' in decision.value:
        return bearish_signals[:2]
    else:
        return neutral_signals


def get_exit_trigger(decision: TradingDecision, volatility: int) -> str:
    """Get exit trigger based on decision"""
    base_trigger = {
        TradingDecision.STRONG_BUY: "When signal weakens to BUY or HOLD",
        TradingDecision.BUY: "When signal drops to HOLD or SELL",
        TradingDecision.SELL: "When signal improves to HOLD or BUY",
        TradingDecision.STRONG_SELL: "When signal weakens to SELL or HOLD",
        TradingDecision.HOLD: "Based on reversal candle / 1% loss",
        TradingDecision.WAIT: "When clear signal emerges",
    }
    
    # Add volatility-adjusted stop loss
    if volatility > 75:
        return base_trigger.get(decision, "Manual review") + " (tight stop - 0.5-1%)"
    else:
        return base_trigger.get(decision, "Manual review")
