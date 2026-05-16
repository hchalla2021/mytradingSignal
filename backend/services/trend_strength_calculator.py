"""
💪 TREND STRENGTH & BREAKOUT PREDICTOR
Advanced trend momentum analysis and breakout probability engine.

Features:
- Trend strength calculation (velocity, acceleration, momentum)
- Momentum scoring (RSI, MACD, momentum oscillator)
- Volatility analysis
- Breakout probability prediction
- Entry/exit signal generation
- Risk/reward ratio calculation
"""

import asyncio
import threading
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple
from collections import deque
import pytz
from dataclasses import dataclass, field
import math

from config.market_session import get_market_session

market_config = get_market_session()
IST = pytz.timezone(market_config.TIMEZONE)


@dataclass
class TrendMomentum:
    """Trend momentum metrics."""
    trend_velocity: float  # Rate of price change per bar
    trend_acceleration: float  # Change in velocity
    momentum_score: float  # 0-100, composite momentum
    rsi: float  # Relative Strength Index (0-100)
    macd_histogram: float  # MACD momentum
    atr: float  # Average True Range (volatility)
    avg_true_range_pct: float  # ATR as % of price
    momentum_direction: str  # UP, DOWN, NEUTRAL
    momentum_strength: float  # 0-1


@dataclass
class BreakoutSignal:
    """Breakout prediction signal."""
    signal_type: str  # BULLISH_BREAKOUT, BEARISH_BREAKOUT, NEUTRAL
    confidence: float  # 0-1
    probability: float  # 0-1, probability of successful breakout
    entry_price: float
    target_price: float
    stop_loss_price: float
    risk_reward_ratio: float
    time_to_breakout: Optional[int]  # Estimated bars until breakout
    volume_confirmation: float  # 0-1
    confluence_strength: float  # How many signals align
    timestamp: datetime


class TrendStrengthCalculator:
    """
    Calculate trend strength using multiple momentum indicators.
    Provides momentum scores and trend direction.
    """
    
    def __init__(self, lookback_period: int = 14):
        self.lookback_period = lookback_period
        
        # Price history
        self.price_history: Dict[str, deque] = {
            s: deque(maxlen=500) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        self.high_history: Dict[str, deque] = {
            s: deque(maxlen=500) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        self.low_history: Dict[str, deque] = {
            s: deque(maxlen=500) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        self.close_history: Dict[str, deque] = {
            s: deque(maxlen=500) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        self.volume_history: Dict[str, deque] = {
            s: deque(maxlen=500) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        
        # Momentum metrics
        self.momentum_metrics: Dict[str, TrendMomentum] = {}
        self.momentum_history: Dict[str, deque] = {
            s: deque(maxlen=100) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        
        self.lock = threading.Lock()
        print("✅ TrendStrengthCalculator initialized")
    
    async def calculate_momentum(self, tick: Dict[str, Any], 
                                symbol: str) -> TrendMomentum:
        """
        Calculate comprehensive trend momentum metrics.
        
        Args:
            tick: Price tick data
            symbol: Trading symbol
            
        Returns:
            TrendMomentum object with all metrics
        """
        try:
            # Update histories
            with self.lock:
                self.price_history[symbol].append(tick.get('last_price', 0))
                self.close_history[symbol].append(tick.get('close', 0))
                self.high_history[symbol].append(tick.get('high', 0))
                self.low_history[symbol].append(tick.get('low', 0))
                self.volume_history[symbol].append(tick.get('volume_traded', 0))
            
            # Calculate individual metrics
            velocity = await self._calculate_velocity(symbol)
            acceleration = await self._calculate_acceleration(symbol)
            rsi = await self._calculate_rsi(symbol)
            macd_hist = await self._calculate_macd(symbol)
            atr, atr_pct = await self._calculate_atr(symbol)
            
            # Composite momentum score
            momentum_score = await self._calculate_composite_momentum(
                rsi, macd_hist, velocity, acceleration
            )
            
            # Determine direction
            if momentum_score > 60:
                direction = "UP"
            elif momentum_score < 40:
                direction = "DOWN"
            else:
                direction = "NEUTRAL"
            
            # Momentum strength
            momentum_strength = (abs(momentum_score - 50) / 50)
            
            momentum = TrendMomentum(
                trend_velocity=velocity,
                trend_acceleration=acceleration,
                momentum_score=momentum_score,
                rsi=rsi,
                macd_histogram=macd_hist,
                atr=atr,
                avg_true_range_pct=atr_pct,
                momentum_direction=direction,
                momentum_strength=momentum_strength
            )
            
            with self.lock:
                self.momentum_metrics[symbol] = momentum
                self.momentum_history[symbol].append(momentum)
            
            return momentum
            
        except Exception as e:
            print(f"❌ Error calculating momentum for {symbol}: {e}")
            return self._create_neutral_momentum()
    
    async def _calculate_velocity(self, symbol: str) -> float:
        """
        Calculate velocity: rate of price change per bar.
        Positive = upward movement, Negative = downward movement.
        """
        with self.lock:
            prices = list(self.price_history.get(symbol, []))
        
        if len(prices) < 2:
            return 0.0
        
        recent = prices[-min(self.lookback_period, len(prices)):]
        if len(recent) < 2:
            return 0.0
        
        price_changes = [recent[i] - recent[i-1] for i in range(1, len(recent))]
        avg_velocity = sum(price_changes) / len(price_changes) if price_changes else 0.0
        
        return avg_velocity
    
    async def _calculate_acceleration(self, symbol: str) -> float:
        """
        Calculate acceleration: change in velocity.
        Positive = increasing momentum, Negative = decreasing momentum.
        """
        with self.lock:
            prices = list(self.price_history.get(symbol, []))
        
        if len(prices) < 5:
            return 0.0
        
        recent = prices[-min(self.lookback_period, len(prices)):]
        
        # Calculate velocities for different periods
        if len(recent) >= 5:
            first_half_velocity = (recent[len(recent)//2] - recent[0]) / (len(recent)//2)
            second_half_velocity = (recent[-1] - recent[len(recent)//2]) / (len(recent) - len(recent)//2)
            acceleration = second_half_velocity - first_half_velocity
        else:
            acceleration = 0.0
        
        return acceleration
    
    async def _calculate_rsi(self, symbol: str, period: int = 14) -> float:
        """
        Calculate Relative Strength Index (0-100).
        > 70 = overbought, < 30 = oversold
        """
        with self.lock:
            closes = list(self.close_history.get(symbol, []))
        
        if len(closes) < period:
            return 50.0
        
        recent = closes[-period:]
        
        gains = []
        losses = []
        
        for i in range(1, len(recent)):
            change = recent[i] - recent[i-1]
            if change > 0:
                gains.append(change)
                losses.append(0)
            else:
                gains.append(0)
                losses.append(abs(change))
        
        avg_gain = sum(gains) / len(gains) if gains else 0
        avg_loss = sum(losses) / len(losses) if losses else 0
        
        if avg_loss == 0:
            rsi = 100.0 if avg_gain > 0 else 50.0
        else:
            rs = avg_gain / avg_loss
            rsi = 100 - (100 / (1 + rs))
        
        return max(0, min(100, rsi))
    
    async def _calculate_macd(self, symbol: str) -> float:
        """
        Calculate MACD histogram (momentum indicator).
        Positive = bullish momentum, Negative = bearish momentum.
        """
        with self.lock:
            closes = list(self.close_history.get(symbol, []))
        
        if len(closes) < 26:
            return 0.0
        
        # EMA 12 and EMA 26
        ema_12 = self._calculate_ema(closes, 12)
        ema_26 = self._calculate_ema(closes, 26)
        
        macd_line = ema_12 - ema_26
        
        # Signal line (EMA of MACD)
        # For simplicity, use SMA of recent MACD values
        recent_macd = macd_line
        
        # MACD histogram = MACD - Signal
        histogram = macd_line  # Simplified
        
        return histogram
    
    def _calculate_ema(self, values: List[float], period: int) -> float:
        """Calculate Exponential Moving Average."""
        if not values or len(values) < period:
            return 0.0
        
        multiplier = 2 / (period + 1)
        ema = sum(values[:period]) / period  # SMA for first value
        
        for value in values[period:]:
            ema = (value - ema) * multiplier + ema
        
        return ema
    
    async def _calculate_atr(self, symbol: str, period: int = 14) -> Tuple[float, float]:
        """
        Calculate Average True Range (volatility measure).
        Higher ATR = higher volatility.
        """
        with self.lock:
            highs = list(self.high_history.get(symbol, []))
            lows = list(self.low_history.get(symbol, []))
            closes = list(self.close_history.get(symbol, []))
        
        if len(highs) < period:
            return 0.0, 0.0
        
        recent_highs = highs[-period:]
        recent_lows = lows[-period:]
        recent_closes = closes[-period:]
        
        true_ranges = []
        
        for i in range(1, len(recent_highs)):
            tr1 = recent_highs[i] - recent_lows[i]
            tr2 = abs(recent_highs[i] - recent_closes[i-1])
            tr3 = abs(recent_lows[i] - recent_closes[i-1])
            tr = max(tr1, tr2, tr3)
            true_ranges.append(tr)
        
        atr = sum(true_ranges) / len(true_ranges) if true_ranges else 0
        current_price = closes[-1] if closes else 1
        atr_pct = (atr / current_price * 100) if current_price > 0 else 0
        
        return atr, atr_pct
    
    async def _calculate_composite_momentum(self, rsi: float, macd: float,
                                          velocity: float, 
                                          acceleration: float) -> float:
        """
        Calculate composite momentum score (0-100).
        Combines RSI, MACD, velocity, and acceleration.
        """
        # RSI contribution (0-100)
        rsi_score = rsi
        
        # MACD contribution (-50 to 50 converted to 0-100)
        macd_score = max(0, min(100, (macd * 10) + 50))
        
        # Velocity contribution (normalized)
        velocity_score = max(0, min(100, 50 + velocity * 100))
        
        # Acceleration contribution
        accel_score = max(0, min(100, 50 + acceleration * 100))
        
        # Weighted average
        composite = (rsi_score * 0.4 + macd_score * 0.3 + 
                    velocity_score * 0.2 + accel_score * 0.1)
        
        return max(0, min(100, composite))
    
    def get_momentum(self, symbol: str) -> Dict[str, Any]:
        """Get current momentum metrics as JSON."""
        with self.lock:
            momentum = self.momentum_metrics.get(symbol)
        
        if not momentum:
            return {}
        
        return {
            'trendVelocity': round(momentum.trend_velocity, 4),
            'trendAcceleration': round(momentum.trend_acceleration, 4),
            'momentumScore': round(momentum.momentum_score, 2),
            'rsi': round(momentum.rsi, 2),
            'macdHistogram': round(momentum.macd_histogram, 4),
            'atr': round(momentum.atr, 2),
            'atrPercentage': round(momentum.avg_true_range_pct, 2),
            'momentumDirection': momentum.momentum_direction,
            'momentumStrength': round(momentum.momentum_strength, 2)
        }
    
    def _create_neutral_momentum(self) -> TrendMomentum:
        """Create neutral momentum object."""
        return TrendMomentum(
            trend_velocity=0.0,
            trend_acceleration=0.0,
            momentum_score=50.0,
            rsi=50.0,
            macd_histogram=0.0,
            atr=0.0,
            avg_true_range_pct=0.0,
            momentum_direction="NEUTRAL",
            momentum_strength=0.0
        )


class BreakoutPredictor:
    """
    Predict probability and timing of breakouts.
    Uses support/resistance, momentum, and volume confluence.
    """
    
    def __init__(self):
        self.signals: Dict[str, deque] = {
            s: deque(maxlen=100) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        self.lock = threading.Lock()
        print("✅ BreakoutPredictor initialized")
    
    async def predict_breakout(self, symbol: str, current_price: float,
                              resistance: Optional[float],
                              support: Optional[float],
                              momentum: TrendMomentum,
                              recent_volume: float,
                              avg_volume: float) -> BreakoutSignal:
        """
        Predict breakout probability and generate trading signal.
        """
        try:
            # Distance to nearest resistance/support
            if resistance:
                dist_to_resistance = resistance - current_price
                resistance_proximity = dist_to_resistance / current_price
            else:
                dist_to_resistance = 0
                resistance_proximity = 1.0
            
            if support:
                dist_to_support = current_price - support
                support_proximity = dist_to_support / current_price
            else:
                dist_to_support = 0
                support_proximity = 1.0
            
            # Volume confirmation
            volume_ratio = recent_volume / avg_volume if avg_volume > 0 else 1.0
            volume_confirmation = min(volume_ratio / 2, 1.0)
            
            # Momentum confluence
            momentum_confluence = momentum.momentum_strength
            
            # Determine breakout direction
            if (momentum.momentum_direction == "UP" and 
                resistance_proximity < 0.01 and  # Very close to resistance
                momentum.momentum_score > 60):
                
                signal_type = "BULLISH_BREAKOUT"
                confidence = min(0.5 + volume_confirmation * 0.3 + momentum_confluence * 0.2, 1.0)
                probability = confidence
                
                target_price = resistance * 1.02 if resistance else current_price * 1.02
                entry_price = current_price
                stop_loss_price = support * 0.98 if support else current_price * 0.98
                
            elif (momentum.momentum_direction == "DOWN" and 
                  support_proximity < 0.01 and  # Very close to support
                  momentum.momentum_score < 40):
                
                signal_type = "BEARISH_BREAKOUT"
                confidence = min(0.5 + volume_confirmation * 0.3 + momentum_confluence * 0.2, 1.0)
                probability = confidence
                
                target_price = support * 0.98 if support else current_price * 0.98
                entry_price = current_price
                stop_loss_price = resistance * 1.02 if resistance else current_price * 1.02
                
            else:
                signal_type = "NEUTRAL"
                confidence = 0.3
                probability = 0.3
                target_price = current_price
                entry_price = current_price
                stop_loss_price = current_price
            
            # Risk/reward ratio
            if signal_type == "BULLISH_BREAKOUT":
                profit = target_price - entry_price
                loss = entry_price - stop_loss_price
            elif signal_type == "BEARISH_BREAKOUT":
                profit = entry_price - target_price
                loss = stop_loss_price - entry_price
            else:
                profit = 1
                loss = 1
            
            risk_reward = profit / loss if loss > 0 else 0
            
            signal = BreakoutSignal(
                signal_type=signal_type,
                confidence=confidence,
                probability=probability,
                entry_price=entry_price,
                target_price=target_price,
                stop_loss_price=stop_loss_price,
                risk_reward_ratio=risk_reward,
                time_to_breakout=None,
                volume_confirmation=volume_confirmation,
                confluence_strength=momentum_confluence,
                timestamp=datetime.now(IST)
            )
            
            with self.lock:
                self.signals[symbol].append(signal)
            
            return signal
            
        except Exception as e:
            print(f"❌ Error predicting breakout for {symbol}: {e}")
            return self._create_neutral_signal(symbol, current_price)
    
    def get_breakout_signal(self, symbol: str) -> Dict[str, Any]:
        """Get latest breakout signal as JSON."""
        with self.lock:
            signals = list(self.signals.get(symbol, []))
        
        if not signals:
            return {}
        
        signal = signals[-1]
        
        return {
            'signalType': signal.signal_type,
            'confidence': round(signal.confidence, 2),
            'probability': round(signal.probability, 2),
            'entryPrice': round(signal.entry_price, 2),
            'targetPrice': round(signal.target_price, 2),
            'stopLossPrice': round(signal.stop_loss_price, 2),
            'riskRewardRatio': round(signal.risk_reward_ratio, 2),
            'volumeConfirmation': round(signal.volume_confirmation, 2),
            'confluenceStrength': round(signal.confluence_strength, 2),
            'timestamp': signal.timestamp.isoformat()
        }
    
    def _create_neutral_signal(self, symbol: str, price: float) -> BreakoutSignal:
        """Create neutral signal."""
        return BreakoutSignal(
            signal_type="NEUTRAL",
            confidence=0.0,
            probability=0.0,
            entry_price=price,
            target_price=price,
            stop_loss_price=price,
            risk_reward_ratio=0.0,
            time_to_breakout=None,
            volume_confirmation=0.0,
            confluence_strength=0.0,
            timestamp=datetime.now(IST)
        )


# Global instances
trend_strength_calculator = TrendStrengthCalculator()
breakout_predictor = BreakoutPredictor()
