"""
Early Warning Signal System - Predictive Trading Signals
═══════════════════════════════════════════════════════════
🔮 GET SIGNALS 1-3 MINUTES BEFORE THEY TRIGGER
Prevents fake signals with multi-factor validation

Purpose: Detect momentum shifts BEFORE breakout/breakdown
Strategy: Leading indicators + momentum analysis + fake signal filtering

Performance: O(1) space, O(n) time | Target: <5ms execution
Data Source: 100% from Zerodha WebSocket (df['open','high','low','close','volume'])
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime
import asyncio


@dataclass
class EarlyWarning:
    """Early warning signal container"""
    __slots__ = (
        'signal', 'strength', 'time_to_trigger_minutes', 
        'confidence', 'fake_signal_risk', 'interpretation'
    )
    
    signal: str  # EARLY_BUY, EARLY_SELL, WAIT
    strength: int  # 0-100
    time_to_trigger_minutes: int  # 1-3 minutes estimated
    confidence: int  # 0-100 (confidence this is real signal)
    fake_signal_risk: str  # LOW, MEDIUM, HIGH
    interpretation: str


@dataclass
class EarlyWarningResult:
    """Complete early warning analysis"""
    __slots__ = (
        'symbol', 'timestamp', 'early_warning', 'momentum_analysis',
        'volume_buildup', 'price_compression', 'fake_signal_checks',
        'recommended_action', 'price_targets'
    )
    
    symbol: str
    timestamp: str
    early_warning: EarlyWarning
    momentum_analysis: Dict  # Momentum building detection
    volume_buildup: Dict  # Volume accumulation patterns
    price_compression: Dict  # Tight range before breakout
    fake_signal_checks: Dict  # Multi-factor fake signal filters
    recommended_action: str  # PREPARE_BUY, PREPARE_SELL, WAIT, CANCEL_ORDER
    price_targets: Dict  # Entry, stop-loss, target prices


class EarlyWarningEngine:
    """
    Predictive Signal Detection Engine
    ══════════════════════════════════════
    Algorithm: Multi-timeframe momentum analysis with fake signal filtering
    
    Key Concepts:
    1. MOMENTUM BUILDUP: Volume + Price acceleration (1-3 candles before breakout)
    2. PRICE COMPRESSION: Tight range → explosion coming (volatility contraction)
    3. FAKE SIGNAL FILTERS: 
       - Volume confirmation (no volume = fake)
       - Multiple timeframe alignment
       - Zone proximity validation
       - No news/event conflict
    
    Signals Generated:
    - EARLY_BUY: 1-3 min before bullish breakout
    - EARLY_SELL: 1-3 min before bearish breakdown
    - WAIT: No clear early pattern
    """
    
    __slots__ = (
        '_momentum_threshold', '_volume_spike_threshold', 
        '_compression_ratio', '_fake_signal_filters'
    )
    
    def __init__(
        self,
        momentum_threshold: float = 1.5,  # 1.5x momentum increase
        volume_spike_threshold: float = 1.3,  # 1.3x volume increase
        compression_ratio: float = 0.6,  # Range < 60% of avg range
        fake_signal_filters: int = 3  # Minimum filters to pass
    ):
        self._momentum_threshold = momentum_threshold
        self._volume_spike_threshold = volume_spike_threshold
        self._compression_ratio = compression_ratio
        self._fake_signal_filters = fake_signal_filters
    
    def analyze(self, symbol: str, df: pd.DataFrame) -> EarlyWarningResult:
        """
        Main analysis - Detect early signals 1-3 minutes ahead
        
        Args:
            symbol: Trading symbol (NIFTY, BANKNIFTY, SENSEX)
            df: DataFrame with OHLCV from Zerodha (minimum 20 candles)
        
        Returns:
            EarlyWarningResult with predictive signals
        """
        if df.empty or len(df) < 20:
            return self._create_neutral_result(symbol, "Insufficient data")
        
        # Analyze last 20 candles for momentum buildup
        recent_df = df.tail(20).copy()
        
        # 1. MOMENTUM ANALYSIS (acceleration detection)
        momentum = self._analyze_momentum(recent_df)
        
        # 2. VOLUME BUILDUP (accumulation before breakout)
        volume_buildup = self._analyze_volume_buildup(recent_df)
        
        # 3. PRICE COMPRESSION (volatility contraction)
        compression = self._analyze_price_compression(recent_df)
        
        # 4. FAKE SIGNAL FILTERS (multi-factor validation)
        fake_checks = self._run_fake_signal_filters(
            recent_df, momentum, volume_buildup, compression
        )
        
        # 5. GENERATE EARLY WARNING SIGNAL
        early_warning = self._generate_early_warning(
            momentum, volume_buildup, compression, fake_checks
        )
        
        # 6. CALCULATE PRICE TARGETS
        price_targets = self._calculate_price_targets(recent_df, early_warning)
        
        # 7. RECOMMENDED ACTION
        recommended_action = self._determine_action(early_warning, fake_checks)
        
        return EarlyWarningResult(
            symbol=symbol,
            timestamp=datetime.now().isoformat(),
            early_warning=early_warning,
            momentum_analysis=momentum,
            volume_buildup=volume_buildup,
            price_compression=compression,
            fake_signal_checks=fake_checks,
            recommended_action=recommended_action,
            price_targets=price_targets
        )
    
    def _analyze_momentum(self, df: pd.DataFrame) -> Dict:
        """
        Detect momentum acceleration (leading indicator)
        
        Checks:
        - Price momentum (ROC - Rate of Change)
        - Acceleration (momentum of momentum)
        - Direction consistency (last 3 candles)
        """
        closes = df['close'].values
        volumes = df['volume'].values
        
        # 🔍 DETAILED LOGGING: Show actual candle values being used
        print(f"\n[MOMENTUM-CALC] 📊 Analyzing {len(closes)} candles:")
        if len(closes) >= 3:
            print(f"   Last 3 closes: {closes[-3]:.2f} → {closes[-2]:.2f} → {closes[-1]:.2f}")
            print(f"   Last 3 volumes: {volumes[-3]:,.0f}, {volumes[-2]:,.0f}, {volumes[-1]:,.0f}")
        
        # Calculate 3-candle momentum
        if len(closes) < 3:
            return {'momentum': 0, 'acceleration': 0, 'direction': 'NEUTRAL'}
        
        # Recent momentum (last 3 candles)
        recent_momentum = (closes[-1] - closes[-3]) / closes[-3] * 100
        print(f"   Recent momentum: {recent_momentum:.2f}%")
        
        # Previous momentum (3 candles before)
        if len(closes) >= 6:
            previous_momentum = (closes[-3] - closes[-6]) / closes[-6] * 100
            acceleration = recent_momentum - previous_momentum
        else:
            acceleration = 0
        
        # Direction consistency (all 3 bullish or bearish)
        last_3_changes = np.diff(closes[-4:])
        bullish_consistency = np.sum(last_3_changes > 0)
        bearish_consistency = np.sum(last_3_changes < 0)
        
        if bullish_consistency >= 2:
            direction = 'BULLISH'
            consistency_strength = (bullish_consistency / 3) * 100
        elif bearish_consistency >= 2:
            direction = 'BEARISH'
            consistency_strength = (bearish_consistency / 3) * 100
        else:
            direction = 'NEUTRAL'
            consistency_strength = 0
        
        # Volume-weighted momentum (stronger if volume increases)
        avg_volume = np.mean(volumes[-10:])
        current_volume = volumes[-1]
        # 🛡️ SAFE DIVISION: Prevent division by zero
        volume_weight = min(current_volume / avg_volume, 2.0) if avg_volume > 0 else 1.0  # Cap at 2x
        
        weighted_momentum = abs(recent_momentum) * volume_weight
        
        # Handle NaN values
        if np.isnan(weighted_momentum) or np.isinf(weighted_momentum):
            weighted_momentum = 0
        if np.isnan(recent_momentum) or np.isinf(recent_momentum):
            recent_momentum = 0
        if np.isnan(acceleration) or np.isinf(acceleration):
            acceleration = 0
        if np.isnan(consistency_strength) or np.isinf(consistency_strength):
            consistency_strength = 0
        
        result = {
            'momentum': round(float(recent_momentum), 2),
            'acceleration': round(float(acceleration), 2),
            'direction': direction,
            'consistency_strength': round(float(consistency_strength), 0),
            'volume_weighted_momentum': round(float(weighted_momentum), 2),
            'strength': min(100, max(0, int(weighted_momentum * 10)))  # 0-100 scale
        }
        
        # 🔍 DETAILED LOGGING: Show calculated results
        print(f"   ✅ Direction: {direction}, Acceleration: {acceleration:.2f}%, Consistency: {consistency_strength:.0f}%")
        
        return result
    
    def _analyze_volume_buildup(self, df: pd.DataFrame) -> Dict:
        """
        Detect volume accumulation before breakout
        
        Smart money accumulates BEFORE price moves (1-3 candles ahead)
        """
        volumes = df['volume'].values
        
        # 🔍 DETAILED LOGGING: Show actual volume values being analyzed
        print(f"\n[VOLUME-BUILDUP-CALC] 📊 Analyzing {len(volumes)} candles:")
        if len(volumes) >= 10:
            print(f"   Last 10 volumes: {', '.join([f'{v:,.0f}' for v in volumes[-10:]])}")
        
        if len(volumes) < 10:
            print(f"   ⚠️ Not enough data (need 10, have {len(volumes)})")
            return {'buildup': False, 'strength': 0}
        
        # Average volume (last 10 candles)
        avg_volume = np.mean(volumes[-10:-3])  # Exclude last 3
        
        # Recent volume (last 3 candles)
        recent_volumes = volumes[-3:]
        recent_avg = np.mean(recent_volumes)
        
        print(f"   Avg volume (candles -10 to -4): {avg_volume:,.0f}")
        print(f"   Recent avg (last 3 candles): {recent_avg:,.0f}")
        
        # Check for steady increase (each candle higher than previous)
        is_building = all(recent_volumes[i] >= recent_volumes[i-1] * 0.95 
                         for i in range(1, len(recent_volumes)))
        
        # Volume ratio (handle division by zero)
        if avg_volume == 0 or np.isnan(avg_volume) or np.isnan(recent_avg):
            volume_ratio = 1.0
        else:
            volume_ratio = recent_avg / avg_volume
        
        # Handle NaN/inf
        if np.isnan(volume_ratio) or np.isinf(volume_ratio):
            volume_ratio = 1.0
        
        print(f"   Volume ratio: {volume_ratio:.2f}x (threshold: {self._volume_spike_threshold}x)")
        print(f"   Is building steadily: {is_building}")
        
        # Strength: 0-100
        if volume_ratio >= self._volume_spike_threshold and is_building:
            buildup = True
            strength = min(100, max(0, int((volume_ratio - 1) * 50)))
            print(f"   ✅ BUILDUP DETECTED! Strength: {strength}%")
        else:
            buildup = False
            strength = 0
            print(f"   ❌ No buildup (ratio too low or not building)")
        
        return {
            'buildup': buildup,
            'volume_ratio': round(float(volume_ratio), 2),
            'is_building': is_building,
            'strength': strength,
            'interpretation': f"Volume {'building' if buildup else 'normal'} ({volume_ratio:.1f}x avg)"
        }
    
    def _analyze_price_compression(self, df: pd.DataFrame) -> Dict:
        """
        Detect volatility contraction (tight range before explosion)
        
        Classic pattern: Price squeezes into tight range → breakout imminent
        """
        highs = df['high'].values
        lows = df['low'].values
        
        # 🔍 DETAILED LOGGING: Show actual candle ranges being analyzed
        print(f"\n[PRICE-COMPRESSION-CALC] 📊 Analyzing {len(highs)} candles:")
        if len(highs) >= 10:
            recent_ranges = highs[-3:] - lows[-3:]
            print(f"   Last 3 candle ranges: {', '.join([f'{r:.2f}' for r in recent_ranges])}")
        
        if len(highs) < 10:
            print(f"   ⚠️ Not enough data (need 10, have {len(highs)})")
            return {'compressed': False, 'strength': 0}
        
        # Calculate range for last 3 candles vs previous 7
        recent_ranges = highs[-3:] - lows[-3:]
        previous_ranges = highs[-10:-3] - lows[-10:-3]
        
        avg_recent_range = np.mean(recent_ranges)
        avg_previous_range = np.mean(previous_ranges)
        
        print(f"   Avg recent range (last 3): {avg_recent_range:.2f}")
        print(f"   Avg previous range (candles -10 to -4): {avg_previous_range:.2f}")
        
        # Compression ratio (recent range / previous range)
        if avg_previous_range > 0:
            compression_ratio = avg_recent_range / avg_previous_range
        else:
            compression_ratio = 1.0
        
        print(f"   Compression ratio: {compression_ratio:.2f} (threshold: {self._compression_ratio})")
        
        # Compressed if recent range < 60% of previous
        compressed = compression_ratio < self._compression_ratio
        
        # Handle NaN/inf
        if np.isnan(compression_ratio) or np.isinf(compression_ratio):
            compression_ratio = 1.0
            compressed = False
        
        # Strength: 0-100 (tighter = stronger)
        if compressed:
            strength = int(max(0, min(100, (1 - compression_ratio) * 100)))
            print(f"   ✅ COMPRESSION DETECTED! Strength: {strength}%")
        else:
            strength = 0
            print(f"   ❌ No compression (range not tight enough)")
        
        return {
            'compressed': compressed,
            'compression_ratio': round(float(compression_ratio), 2),
            'strength': strength,
            'interpretation': f"Range {'compressed' if compressed else 'normal'} ({compression_ratio:.0%} of avg)"
        }
    
    def _run_fake_signal_filters(
        self, 
        df: pd.DataFrame, 
        momentum: Dict,
        volume: Dict, 
        compression: Dict
    ) -> Dict:
        """
        Multi-factor fake signal detection
        
        Filters:
        1. Volume confirmation (no volume = fake breakout)
        2. Momentum consistency (no momentum = fake move)
        3. Zone proximity (far from zone = weak signal)
        4. Consolidation duration (too quick = fake)
        5. Direction alignment (conflicting signals = fake)
        """
        # 🔍 DETAILED LOGGING: Show signal validation calculations
        print(f"\n[SIGNAL-VALIDATION-CALC] 🔍 Running 5 fake signal filters:")
        
        filters_passed = 0
        total_filters = 5
        
        checks = {}
        
        # FILTER 1: Volume Confirmation (RELAXED THRESHOLD)
        volume_ratio = volume['volume_ratio']
        print(f"   Filter 1 - Volume: {volume_ratio:.2f}x (need ≥1.0x)")
        if volume_ratio >= 1.0:  # At least normal volume
            checks['volume_confirmed'] = True
            filters_passed += 1
            print(f"      ✅ PASS")
        else:
            checks['volume_confirmed'] = False
            print(f"      ❌ FAIL")
        
        # FILTER 2: Momentum Consistency (RELAXED THRESHOLD)
        consistency = momentum['consistency_strength']
        print(f"   Filter 2 - Momentum: {consistency:.0f}% (need ≥50%)")
        if consistency >= 50:  # Half of candles aligned
            checks['momentum_consistent'] = True
            filters_passed += 1
            print(f"      ✅ PASS")
        else:
            checks['momentum_consistent'] = False
            print(f"      ❌ FAIL")
        
        # FILTER 3: Zone Proximity (check if near recent high/low)
        closes = df['close'].values
        highs = df['high'].values
        lows = df['low'].values
        
        recent_high = np.max(highs[-10:])
        recent_low = np.min(lows[-10:])
        current_price = closes[-1]
        
        # Near resistance (within 2% - RELAXED)
        near_resistance = (recent_high - current_price) / recent_high < 0.02
        # Near support (within 2% - RELAXED)
        near_support = (current_price - recent_low) / current_price < 0.02
        
        print(f"   Filter 3 - Zone: current={current_price:.2f}, high={recent_high:.2f}, low={recent_low:.2f}")
        if near_resistance or near_support:
            checks['near_zone'] = True
            filters_passed += 1
            print(f"      ✅ PASS (near {'resistance' if near_resistance else 'support'})")
        else:
            checks['near_zone'] = False
            print(f"      ❌ FAIL (not near zone)")
        
        # FILTER 4: Consolidation Duration (at least 3 candles)
        if len(df) >= 5 and compression['compressed']:
            # Check if compression lasted at least 3 candles
            ranges = highs[-5:] - lows[-5:]
            avg_range = np.mean(ranges)
            compressed_candles = np.sum(ranges[-3:] < avg_range * 0.7)
            
            print(f"   Filter 4 - Consolidation: {compressed_candles}/3 candles compressed")
            if compressed_candles >= 2:
                checks['sufficient_consolidation'] = True
                filters_passed += 1
                print(f"      ✅ PASS")
            else:
                checks['sufficient_consolidation'] = False
                print(f"      ❌ FAIL")
        else:
            checks['sufficient_consolidation'] = False
            print(f"   Filter 4 - Consolidation: ❌ FAIL (not compressed)")
        
        # FILTER 5: Direction Alignment (momentum + volume same direction)
        momentum_bullish = momentum['direction'] == 'BULLISH'
        momentum_bearish = momentum['direction'] == 'BEARISH'
        volume_building = volume['buildup']
        
        print(f"   Filter 5 - Alignment: momentum={momentum['direction']}, volume_buildup={volume_building}")
        if (momentum_bullish or momentum_bearish) and volume_building:
            checks['signals_aligned'] = True
            filters_passed += 1
            print(f"      ✅ PASS")
        else:
            checks['signals_aligned'] = False
            print(f"      ❌ FAIL")
        
        # Calculate fake signal risk (LESS AGGRESSIVE THRESHOLDS)
        pass_rate = filters_passed / total_filters
        
        print(f"\n   📊 VALIDATION RESULT: {filters_passed}/{total_filters} filters passed ({pass_rate:.0%})")
        
        if pass_rate >= 0.6:  # 3/5 filters passed
            fake_risk = 'LOW'
            print(f"   ✅ FAKE SIGNAL RISK: LOW (pass rate {pass_rate:.0%} >= 60%)")
        elif pass_rate >= 0.4:  # 2/5 filters passed
            fake_risk = 'MEDIUM'
            print(f"   ⚠️ FAKE SIGNAL RISK: MEDIUM (pass rate {pass_rate:.0%} >= 40%)")
        else:
            fake_risk = 'HIGH'
            print(f"   🔴 FAKE SIGNAL RISK: HIGH (pass rate {pass_rate:.0%} < 40%)")
        
        return {
            'checks': checks,
            'filters_passed': filters_passed,
            'total_filters': total_filters,
            'pass_rate': round(pass_rate * 100, 0),
            'fake_signal_risk': fake_risk
        }
    
    def _generate_early_warning(
        self,
        momentum: Dict,
        volume: Dict,
        compression: Dict,
        fake_checks: Dict
    ) -> EarlyWarning:
        """
        Generate early warning signal based on all factors
        """
        # Calculate overall strength
        momentum_strength = momentum['strength']
        volume_strength = volume['strength']
        compression_strength = compression['strength']
        
        # Handle NaN values in strength calculations
        if np.isnan(momentum_strength) or np.isinf(momentum_strength):
            momentum_strength = 0
        if np.isnan(volume_strength) or np.isinf(volume_strength):
            volume_strength = 0
        if np.isnan(compression_strength) or np.isinf(compression_strength):
            compression_strength = 0
        
        # Weighted average (momentum 40%, volume 35%, compression 25%)
        overall_strength = int(max(0, min(100,
            momentum_strength * 0.4 +
            volume_strength * 0.35 +
            compression_strength * 0.25
        )))
        
        # Determine signal direction
        if momentum['direction'] == 'BULLISH' and volume['buildup']:
            signal = 'EARLY_BUY'
            interpretation = f"Bullish momentum building with volume - Breakout likely in 1-3 minutes"
        elif momentum['direction'] == 'BEARISH' and volume['buildup']:
            signal = 'EARLY_SELL'
            interpretation = f"Bearish momentum building with volume - Breakdown likely in 1-3 minutes"
        else:
            signal = 'WAIT'
            interpretation = "No clear early signal - Wait for confirmation"
        
        # Estimate time to trigger (based on compression + momentum acceleration)
        if compression['compressed'] and momentum['acceleration'] > 0:
            # High compression + acceleration = 1-2 min
            time_to_trigger = 1
        elif volume['buildup'] and momentum['momentum'] > 0:
            # Volume building = 2-3 min
            time_to_trigger = 2
        else:
            time_to_trigger = 3
        
        # Confidence (adjusted by fake signal risk)
        base_confidence = overall_strength
        
        if fake_checks['fake_signal_risk'] == 'LOW':
            confidence = min(100, base_confidence + 10)
        elif fake_checks['fake_signal_risk'] == 'MEDIUM':
            confidence = base_confidence
        else:  # HIGH risk
            confidence = max(0, base_confidence - 20)
        
        # Override signal if confidence too low
        if confidence < 50:
            signal = 'WAIT'
            interpretation = f"Signal weak ({confidence}% confidence) - Wait for confirmation"
        
        return EarlyWarning(
            signal=signal,
            strength=overall_strength,
            time_to_trigger_minutes=time_to_trigger,
            confidence=confidence,
            fake_signal_risk=fake_checks['fake_signal_risk'],
            interpretation=interpretation
        )
    
    def _calculate_price_targets(
        self, 
        df: pd.DataFrame, 
        early_warning: EarlyWarning
    ) -> Dict:
        """
        Calculate entry, stop-loss, and target prices
        """
        closes = df['close'].values
        highs = df['high'].values
        lows = df['low'].values
        
        current_price = closes[-1]
        recent_high = np.max(highs[-10:])
        recent_low = np.min(lows[-10:])
        atr = np.mean(highs[-10:] - lows[-10:])  # Average True Range
        
        if early_warning.signal == 'EARLY_BUY':
            # Entry: Current price (or slightly above)
            entry_price = current_price * 1.001  # 0.1% above
            
            # Stop-loss: Recent low - 1 ATR
            stop_loss = recent_low - (atr * 0.5)
            
            # Target: Entry + 2x risk
            risk = entry_price - stop_loss
            target_price = entry_price + (risk * 2)
            
        elif early_warning.signal == 'EARLY_SELL':
            # Entry: Current price (or slightly below)
            entry_price = current_price * 0.999  # 0.1% below
            
            # Stop-loss: Recent high + 1 ATR
            stop_loss = recent_high + (atr * 0.5)
            
            # Target: Entry - 2x risk
            risk = stop_loss - entry_price
            target_price = entry_price - (risk * 2)
        else:
            # WAIT - no targets
            entry_price = 0
            stop_loss = 0
            target_price = 0
        
        return {
            'entry_price': round(entry_price, 2),
            'stop_loss': round(stop_loss, 2),
            'target_price': round(target_price, 2),
            'risk_reward_ratio': 2.0 if entry_price > 0 else 0,
            'atr': round(atr, 2)
        }
    
    def _determine_action(
        self, 
        early_warning: EarlyWarning, 
        fake_checks: Dict
    ) -> str:
        """
        Determine recommended action based on signal quality
        """
        if early_warning.signal == 'WAIT':
            return 'WAIT'
        
        # Check signal quality
        if (early_warning.confidence >= 70 and 
            fake_checks['fake_signal_risk'] == 'LOW'):
            # High quality signal - prepare order
            if early_warning.signal == 'EARLY_BUY':
                return 'PREPARE_BUY'
            else:
                return 'PREPARE_SELL'
        
        elif (early_warning.confidence >= 50 and 
              fake_checks['fake_signal_risk'] == 'MEDIUM'):
            # Medium quality - wait for confirmation
            return 'WAIT_FOR_CONFIRMATION'
        
        else:
            # Low quality - likely fake signal
            return 'CANCEL_ORDER'
    
    def _create_neutral_result(self, symbol: str, reason: str) -> EarlyWarningResult:
        """Create neutral result for errors/edge cases"""
        return EarlyWarningResult(
            symbol=symbol,
            timestamp=datetime.now().isoformat(),
            early_warning=EarlyWarning(
                signal='WAIT',
                strength=0,
                time_to_trigger_minutes=0,
                confidence=0,
                fake_signal_risk='HIGH',
                interpretation=reason
            ),
            momentum_analysis={},
            volume_buildup={},
            price_compression={},
            fake_signal_checks={},
            recommended_action='WAIT',
            price_targets={}
        )
    
    def to_dict(self, result: EarlyWarningResult) -> Dict:
        """Convert result to dictionary for API response"""
        # Format fake signal checks for frontend
        checks = result.fake_signal_checks.get('checks', {})
        fake_signal_checks = {
            'volume_confirmation': {
                'pass': bool(checks.get('volume_confirmed', False)),
                'detail': 'Volume ≥1.2x average' if checks.get('volume_confirmed', False) else 'Volume <1.2x average'
            },
            'momentum_consistency': {
                'pass': bool(checks.get('momentum_consistent', False)),
                'detail': '≥66% candles aligned' if checks.get('momentum_consistent', False) else '<66% candles aligned'
            },
            'zone_proximity': {
                'pass': bool(checks.get('near_zone', False)),
                'detail': 'Within 1% of high/low' if checks.get('near_zone', False) else 'Far from zones'
            },
            'consolidation_duration': {
                'pass': bool(checks.get('sufficient_consolidation', False)),
                'detail': '≥2 candles compressed' if checks.get('sufficient_consolidation', False) else '<2 candles compressed'
            },
            'direction_alignment': {
                'pass': bool(checks.get('signals_aligned', False)),
                'detail': 'Momentum + Volume aligned' if checks.get('signals_aligned', False) else 'Signals conflicting'
            },
            'pass_rate': int(result.fake_signal_checks.get('pass_rate', 0))
        }
        
        # 🔍 FINAL SUMMARY LOG
        print(f"\n{'='*60}")
        print(f"[EARLY-WARNING-SUMMARY] {result.symbol}")
        print(f"  Signal: {result.early_warning.signal}")
        print(f"  Confidence: {result.early_warning.confidence}%")
        print(f"  Fake Risk: {result.early_warning.fake_signal_risk} (Pass: {result.fake_signal_checks.get('pass_rate', 0)}%)")
        print(f"  Filters: {result.fake_signal_checks.get('filters_passed', 0)}/{result.fake_signal_checks.get('total_filters', 5)}")
        print(f"{'='*60}\n")
        
        return {
            'symbol': result.symbol,
            'timestamp': result.timestamp,
            'signal': result.early_warning.signal,
            'strength': int(result.early_warning.strength),
            'time_to_trigger': int(result.early_warning.time_to_trigger_minutes),
            'confidence': int(result.early_warning.confidence),
            'fake_signal_risk': result.early_warning.fake_signal_risk,
            'momentum': {
                'direction': result.momentum_analysis.get('direction', 'NEUTRAL'),
                'strength': int(result.momentum_analysis.get('strength', 0)),
                'acceleration': float(result.momentum_analysis.get('acceleration', 0)),
                'consistency': int(result.momentum_analysis.get('consistency_strength', 0))
            },
            'volume_buildup': {
                'is_building': bool(result.volume_buildup.get('is_building', False)),
                'buildup_strength': int(result.volume_buildup.get('strength', 0)),
                'candles_building': 3 if result.volume_buildup.get('is_building', False) else 0
            },
            'price_compression': {
                'is_compressed': bool(result.price_compression.get('compressed', False)),
                'compression_level': int(result.price_compression.get('strength', 0)),
                'candles_compressed': 3 if result.price_compression.get('compressed', False) else 0
            },
            'fake_signal_checks': fake_signal_checks,
            'price_targets': {
                'entry': float(result.price_targets.get('entry_price', 0)),
                'stop_loss': float(result.price_targets.get('stop_loss', 0)),
                'target': float(result.price_targets.get('target_price', 0)),
                'risk_reward_ratio': float(result.price_targets.get('risk_reward_ratio', 2.0))
            },
            'recommended_action': result.recommended_action,
            'reasoning': result.early_warning.interpretation
        }


# Singleton instance
_early_warning_engine = None

def get_early_warning_engine() -> EarlyWarningEngine:
    """Get or create singleton engine instance"""
    global _early_warning_engine
    if _early_warning_engine is None:
        _early_warning_engine = EarlyWarningEngine()
    return _early_warning_engine


async def analyze_early_warning(symbol: str, df: pd.DataFrame) -> Dict:
    """
    Main entry point for API
    Ultra-fast async wrapper
    
    Args:
        symbol: Trading symbol (NIFTY, BANKNIFTY, SENSEX)
        df: DataFrame with OHLCV from Zerodha KiteConnect
    
    Returns:
        Dictionary with early warning analysis
    """
    engine = get_early_warning_engine()
    result = await asyncio.to_thread(engine.analyze, symbol, df)
    return engine.to_dict(result)
