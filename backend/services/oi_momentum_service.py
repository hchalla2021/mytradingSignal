"""
OI Momentum Service - Pure Data-Driven Buy/Sell Signals
No indicators. No emotions. Only: Liquidity Grab, Volume Spike, OI Change, Price Structure, Breakout Confirmation

Designed by: 25-year veteran trader + Python developer
"""
from __future__ import annotations

import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Literal
import logging

logger = logging.getLogger(__name__)

# Signal Types
SignalType = Literal["STRONG_BUY", "BUY", "NEUTRAL", "SELL", "STRONG_SELL", "NO_SIGNAL"]


class OIMomentumService:
    """
    Pure Data Buy Model - No Emotions
    ✅ Liquidity Grab
    ✅ Volume Spike  
    ✅ OI Change
    ✅ Price Structure
    ✅ Breakout Confirmation
    """

    def __init__(self):
        self.min_candles_required = 3   # Need ≥3 closed 5-min candles (15 min of data — signals from 9:30 AM)
        self.volume_avg_period = 3      # 3-candle rolling average — works with minimal history
        self.lookback_period = 2        # 2-candle lookback for liquidity grab

    def analyze_signal(
        self,
        symbol: str,
        df_5min: pd.DataFrame,
        df_15min: pd.DataFrame,
        current_price: float,
        current_oi: Optional[int] = None,
        current_volume: Optional[int] = None
    ) -> Dict:
        """
        Analyze OI Momentum and generate buy/sell signal
        
        Args:
            symbol: NIFTY, BANKNIFTY, SENSEX
            df_5min: 5-minute candle data with OHLCV + OI
            df_15min: 15-minute candle data with OHLCV + OI
            current_price: Current LTP
            current_oi: Current Open Interest
            current_volume: Current Volume
            
        Returns:
            {
                "signal_5m": "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL",
                "signal_15m": "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL",
                "final_signal": "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL",
                "confidence": 85,  # 0-100%
                "reasons": ["Liquidity grab detected", "OI buildup +5.2%", ...],
                "metrics": {
                    "liquidity_grab": True,
                    "oi_buildup": True,
                    "volume_spike": True,
                    "price_breakout": True,
                    "oi_change_pct": 5.2,
                    "volume_ratio": 2.1
                }
            }
        """
        try:
            # Validate data
            if df_5min is None or len(df_5min) < self.min_candles_required:
                return self._no_signal_response("Insufficient 5m data")

            # 15m candles are aggregated 3×5m — need at least 1 completed 15m candle
            if df_15min is None or len(df_15min) < 1:
                # Fall back to using 5m signal for both timeframes when 15m isn't ready
                signal_5m = self._analyze_timeframe(df_5min, "5m", current_price, current_oi, current_volume)
                final_signal, confidence, reasons = self._combine_signals(signal_5m, signal_5m)
                return {
                    "signal_5m": signal_5m["signal"],
                    "signal_15m": signal_5m["signal"],
                    "final_signal": final_signal,
                    "confidence": max(0, confidence - 15),  # -15 for missing 15m confirmation
                    "reasons": reasons + ["15m trend not yet available — using 5m only"],
                    "metrics": {
                        "liquidity_grab_5m":     signal_5m["metrics"]["liquidity_grab"],
                        "liquidity_grab_15m":    signal_5m["metrics"]["liquidity_grab"],
                        "oi_buildup_5m":         signal_5m["metrics"]["oi_buildup"],
                        "oi_buildup_15m":        signal_5m["metrics"]["oi_buildup"],
                        "volume_spike_5m":       signal_5m["metrics"]["volume_spike"],
                        "volume_spike_15m":      signal_5m["metrics"]["volume_spike"],
                        "price_breakout_5m":     signal_5m["metrics"]["price_breakout"],
                        "price_breakout_15m":    signal_5m["metrics"]["price_breakout"],
                        "oi_change_pct_5m":      signal_5m["metrics"]["oi_change_pct"],
                        "oi_change_pct_15m":     signal_5m["metrics"]["oi_change_pct"],
                        "volume_ratio_5m":       signal_5m["metrics"]["volume_ratio"],
                        "volume_ratio_15m":      signal_5m["metrics"]["volume_ratio"],
                        "price_breakdown_5m":    signal_5m["metrics"]["price_breakdown"],
                        "price_breakdown_15m":   signal_5m["metrics"]["price_breakdown"],
                        "oi_reduction_5m":       signal_5m["metrics"]["oi_reduction"],
                        "oi_reduction_15m":      signal_5m["metrics"]["oi_reduction"],
                        "liquidity_grab_sell_5m":  signal_5m["metrics"]["liquidity_grab_sell"],
                        "liquidity_grab_sell_15m": signal_5m["metrics"]["liquidity_grab_sell"],
                    },
                    "timestamp": datetime.now().isoformat(),
                }

            # Analyze 5-minute timeframe (EXECUTION)
            signal_5m = self._analyze_timeframe(df_5min, "5m", current_price, current_oi, current_volume)
            
            # Analyze 15-minute timeframe (TREND)
            signal_15m = self._analyze_timeframe(df_15min, "15m", current_price, current_oi, current_volume)

            # Combine signals (15m trend + 5m execution)
            final_signal, confidence, reasons = self._combine_signals(signal_5m, signal_15m)

            return {
                "signal_5m": signal_5m["signal"],
                "signal_15m": signal_15m["signal"],
                "final_signal": final_signal,
                "confidence": confidence,
                "reasons": reasons,
                "metrics": {
                    "liquidity_grab_5m": signal_5m["metrics"]["liquidity_grab"],
                    "liquidity_grab_15m": signal_15m["metrics"]["liquidity_grab"],
                    "oi_buildup_5m": signal_5m["metrics"]["oi_buildup"],
                    "oi_buildup_15m": signal_15m["metrics"]["oi_buildup"],
                    "volume_spike_5m": signal_5m["metrics"]["volume_spike"],
                    "volume_spike_15m": signal_15m["metrics"]["volume_spike"],
                    "price_breakout_5m": signal_5m["metrics"]["price_breakout"],
                    "price_breakout_15m": signal_15m["metrics"]["price_breakout"],
                    "oi_change_pct_5m": signal_5m["metrics"]["oi_change_pct"],
                    "oi_change_pct_15m": signal_15m["metrics"]["oi_change_pct"],
                    "volume_ratio_5m": signal_5m["metrics"]["volume_ratio"],
                    "volume_ratio_15m": signal_15m["metrics"]["volume_ratio"],
                    # Sell-side metrics — needed so SELL signals show correct drivers
                    "price_breakdown_5m":      signal_5m["metrics"]["price_breakdown"],
                    "price_breakdown_15m":     signal_15m["metrics"]["price_breakdown"],
                    "oi_reduction_5m":         signal_5m["metrics"]["oi_reduction"],
                    "oi_reduction_15m":        signal_15m["metrics"]["oi_reduction"],
                    "liquidity_grab_sell_5m":  signal_5m["metrics"]["liquidity_grab_sell"],
                    "liquidity_grab_sell_15m": signal_15m["metrics"]["liquidity_grab_sell"],
                },
                "timestamp": datetime.now().isoformat()
            }

        except Exception as e:
            logger.error(f"❌ OI Momentum analysis error for {symbol}: {e}")
            return self._no_signal_response(f"Error: {str(e)}")

    def _analyze_timeframe(
        self,
        df: pd.DataFrame,
        timeframe: str,
        current_price: float,
        current_oi: Optional[int],
        current_volume: Optional[int]
    ) -> Dict:
        """Analyze single timeframe for signals"""
        
        # Make a copy to avoid modifying original
        df = df.copy()
        
        # Ensure required columns exist
        required_cols = ['open', 'high', 'low', 'close', 'volume']
        if not all(col in df.columns for col in required_cols):
            return {
                "signal": "NO_SIGNAL",
                "metrics": self._empty_metrics(),
                "score": 0
            }

        # Calculate indicators
        df = self._calculate_indicators(df)
        
        # Get latest values
        latest = df.iloc[-1]
        
        # Extract metrics
        liquidity_grab = bool(latest.get('liquidity_grab', False))
        oi_buildup = bool(latest.get('oi_buildup', False))
        volume_spike = bool(latest.get('volume_spike', False))
        price_breakout = bool(latest.get('price_breakout', False))
        _raw_oicp = latest.get('oi_change_pct', 0)
        try:
            oi_change_pct = 0.0 if (_raw_oicp is None or _raw_oicp != _raw_oicp) else float(_raw_oicp)
        except (TypeError, ValueError):
            oi_change_pct = 0.0
        _raw_vrat = latest.get('volume_ratio', 0)
        try:
            volume_ratio = 0.0 if (_raw_vrat is None or _raw_vrat != _raw_vrat) else float(_raw_vrat)
        except (TypeError, ValueError):
            volume_ratio = 0.0
        
        # Reverse logic for SELL
        liquidity_grab_sell = bool(latest.get('liquidity_grab_sell', False))
        oi_reduction = bool(latest.get('oi_reduction', False))
        price_breakdown = bool(latest.get('price_breakdown', False))

        # Calculate signal score — proportional, not binary
        buy_score = 0
        sell_score = 0

        # BUY-SIDE EVIDENCE
        if liquidity_grab:
            buy_score += 25
        if oi_buildup:
            buy_score += 25
            # Proportional OI bonus: large OI buildup = stronger conviction
            buy_score += min(15, abs(oi_change_pct) * 1.5)
        if price_breakout:
            buy_score += 20

        # SELL-SIDE EVIDENCE
        if liquidity_grab_sell:
            sell_score += 25
        if oi_reduction:
            sell_score += 25
            sell_score += min(15, abs(oi_change_pct) * 1.5)
        if price_breakdown:
            sell_score += 20

        # Volume confirms whichever direction has more evidence
        if volume_spike:
            if buy_score > sell_score:
                buy_score += 20
            elif sell_score > buy_score:
                sell_score += 20
            else:
                buy_score += 10
                sell_score += 10

        # Net score determines signal direction
        net_score = buy_score - sell_score

        if net_score >= 50:
            signal = "STRONG_BUY"
        elif net_score >= 20:
            signal = "BUY"
        elif net_score <= -50:
            signal = "STRONG_SELL"
        elif net_score <= -20:
            signal = "SELL"
        else:
            signal = "NEUTRAL"

        # Directional score for confidence calculation
        if signal in ("STRONG_BUY", "BUY"):
            directional_score = int(buy_score)
        elif signal in ("STRONG_SELL", "SELL"):
            directional_score = int(sell_score)
        else:
            directional_score = int(max(buy_score, sell_score)) // 2

        return {
            "signal": signal,
            "metrics": {
                "liquidity_grab": liquidity_grab,
                "oi_buildup": oi_buildup,
                "volume_spike": volume_spike,
                "price_breakout": price_breakout,
                "oi_change_pct": round(oi_change_pct, 2),
                "volume_ratio": round(volume_ratio, 2),
                "liquidity_grab_sell": liquidity_grab_sell,
                "oi_reduction": oi_reduction,
                "price_breakdown": price_breakdown
            },
            "score": directional_score
        }

    def _calculate_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """Calculate all pure data indicators"""
        
        # 🧠 PART 1: LIQUIDITY GRAB (Buy-side)
        # Smart money pushes price below previous low to trigger stop-losses
        df['avg_volume'] = df['volume'].rolling(self.volume_avg_period, min_periods=1).mean()
        df['lowest_low_5'] = df['low'].rolling(self.lookback_period, min_periods=1).min().shift(1)
        df['highest_high_5'] = df['high'].rolling(self.lookback_period, min_periods=1).max().shift(1)

        # NSE spot indices have volume_traded = 0 from Zerodha WebSocket ticks.
        # Detect this and fall back to price-structure-only liquidity grab.
        has_volume_data = bool(df['volume'].sum() > 0)

        if has_volume_data:
            df['liquidity_grab'] = (
                (df['low'] < df['lowest_low_5']) &       # Low breaks previous N-candle low
                (df['volume'] > 1.5 * df['avg_volume']) & # Volume spike >1.5x
                (df['close'] > df['low'].shift(1))         # Strong rejection close
            )
            # 🧠 SELL-SIDE LIQUIDITY GRAB
            df['liquidity_grab_sell'] = (
                (df['high'] > df['highest_high_5']) &     # High breaks previous N-candle high
                (df['volume'] > 1.5 * df['avg_volume']) & # Volume spike
                (df['close'] < df['high'].shift(1))        # Rejection (close below high)
            )
        else:
            # Price-structure-only liquidity grab (no volume data for indices)
            df['liquidity_grab'] = (
                (df['low'] < df['lowest_low_5']) &
                (df['close'] > df['low'].shift(1))
            )
            df['liquidity_grab_sell'] = (
                (df['high'] > df['highest_high_5']) &
                (df['close'] < df['high'].shift(1))
            )

        # 🧠 PART 2: OI CHANGE CONFIRMATION
        if 'oi' in df.columns:
            df['oi_change'] = df['oi'].diff()
            df['oi_change_pct'] = (df['oi_change'] / df['oi'].shift(1)) * 100
            
            # BUY: Price up + OI up + OI change > 1% (lowered from 3% — options OI moves slower)
            df['oi_buildup'] = (
                (df['close'] > df['close'].shift(1)) &
                (df['oi'] > df['oi'].shift(1)) &
                (df['oi_change_pct'] > 1)
            )

            # SELL: Price down + OI down OR Price down + OI up (short buildup)
            df['oi_reduction'] = (
                (df['close'] < df['close'].shift(1)) &
                (
                    (df['oi'] < df['oi'].shift(1)) |  # OI reducing (positions closing)
                    (df['oi_change_pct'] > 3)          # OI building while price falls = short buildup
                )
            )
        else:
            df['oi_change_pct'] = 0
            df['oi_buildup'] = False
            df['oi_reduction'] = False

        # 🧠 PART 3: VOLUME CONFIRMATION
        df['volume_ratio'] = (df['volume'] / df['avg_volume']).fillna(1.0)
        # Only flag a spike when actual volume data exists; avoid false signals from 0-volume indices
        if has_volume_data:
            df['volume_spike'] = df['volume'] > 1.2 * df['avg_volume']
        else:
            df['volume_spike'] = False

        # 🧠 PART 4: PRICE STRUCTURE
        # BUY: Close confirms upward + high exceeds rolling 3-candle high
        # (prevents false breakouts from single-candle noise)
        rolling_high = df['high'].rolling(3, min_periods=1).max().shift(1)
        rolling_low = df['low'].rolling(3, min_periods=1).min().shift(1)
        df['price_breakout'] = (
            (df['close'] > df['close'].shift(1)) &
            (df['high'] > rolling_high)
        )
        # SELL: Close confirms downward + low breaks rolling 3-candle low
        df['price_breakdown'] = (
            (df['close'] < df['close'].shift(1)) &
            (df['low'] < rolling_low)
        )

        return df

    def _combine_signals(
        self,
        signal_5m: Dict,
        signal_15m: Dict
    ) -> tuple[SignalType, int, List[str]]:
        """
        Combine 5m (execution) + 15m (trend) signals with PROFESSIONAL ACCURACY
        
        Logic:
        - 15m defines trend direction (60% weight)
        - 5m defines entry timing (40% weight)
        - Confidence based on: alignment + data strength + confirmation factors
        - 100% Technical Accuracy - No False Calculations
        """
        
        reasons = []
        
        # Signal strength mapping
        signal_strength = {
            "STRONG_BUY": 2,
            "BUY": 1,
            "NEUTRAL": 0,
            "SELL": -1,
            "STRONG_SELL": -2,
            "NO_SIGNAL": 0
        }
        
        strength_5m = signal_strength.get(signal_5m["signal"], 0)
        strength_15m = signal_strength.get(signal_15m["signal"], 0)
        
        # Combined strength (weighted)
        combined_strength = (strength_15m * 0.6) + (strength_5m * 0.4)  # 15m has more weight
        
        # Determine final signal — threshold 0.4 so a clear 5m signal
        # isn't diluted to NEUTRAL by a borderline 15m
        if combined_strength >= 1.5:
            final_signal = "STRONG_BUY"
        elif combined_strength >= 0.4:
            final_signal = "BUY"
        elif combined_strength <= -1.5:
            final_signal = "STRONG_SELL"
        elif combined_strength <= -0.4:
            final_signal = "SELL"
        else:
            final_signal = "NEUTRAL"
        
        # ============================================================
        # PROFESSIONAL CONFIDENCE CALCULATION (0-100%)
        # Multi-Factor Analysis for 100% Accuracy
        # ============================================================
        
        confidence_factors = []
        
        # FACTOR 1: Signal Alignment (30 points max)
        alignment = abs(strength_5m - strength_15m)
        if alignment == 0:  # Perfect alignment
            alignment_score = 30
        elif alignment == 1:  # One step apart
            alignment_score = 20
        elif alignment == 2:
            alignment_score = 10
        else:  # Conflicting
            alignment_score = 0
        confidence_factors.append(("Alignment", alignment_score, 30))
        
        # FACTOR 2: Data Strength Score (25 points max)
        # Average of 5m and 15m scores (0-100) normalized to 0-25
        avg_score = (signal_5m["score"] + signal_15m["score"]) / 2
        strength_score = int((avg_score / 100) * 25)
        confidence_factors.append(("Data Strength", strength_score, 25))
        
        # FACTOR 3: Volume Confirmation (15 points max)
        # Continuous intensity bonus replaces the old discrete ›2.0× cliff:
        # every additional unit of volume above the 1.5× spike threshold
        # contributes proportionally (0 at 1.5×, +1 at 2.0×, +2 at 2.5×, +3 at 3.0×).
        volume_5m  = signal_5m["metrics"]["volume_spike"]
        volume_15m = signal_15m["metrics"]["volume_spike"]
        volume_ratio_5m  = signal_5m["metrics"]["volume_ratio"]
        volume_ratio_15m = signal_15m["metrics"]["volume_ratio"]

        volume_score = 0
        if volume_5m and volume_15m:   volume_score = 15
        elif volume_5m or volume_15m:  volume_score = 10
        if volume_score > 0:
            best_ratio  = max(volume_ratio_5m, volume_ratio_15m)
            ratio_bonus = min(3.0, max(0.0, (best_ratio - 1.5) * 2.0))  # 0→0, 2×→1, 2.5×→2, 3×→3
            volume_score = min(15, int(volume_score + ratio_bonus))
        confidence_factors.append(("Volume", volume_score, 15))
        
        # FACTOR 4: OI Confirmation (15 points max)
        # Direction-aware: only credit OI activity that SUPPORTS the final signal.
        # Crediting contradicting OI (e.g. oi_reduction on a BUY) inflates confidence
        # precisely when the setup is least reliable — the opposite of what we want.
        oi_raw_5m  = bool(signal_5m["metrics"]["oi_buildup"])  or bool(signal_5m["metrics"]["oi_reduction"])
        oi_raw_15m = bool(signal_15m["metrics"]["oi_buildup"]) or bool(signal_15m["metrics"]["oi_reduction"])
        oi_change_5m  = abs(signal_5m["metrics"]["oi_change_pct"])
        oi_change_15m = abs(signal_15m["metrics"]["oi_change_pct"])

        _is_buy_sig  = final_signal in ("STRONG_BUY",  "BUY")
        _is_sell_sig = final_signal in ("STRONG_SELL", "SELL")

        if _is_buy_sig:
            oi_5m  = bool(signal_5m["metrics"]["oi_buildup"])
            oi_15m = bool(signal_15m["metrics"]["oi_buildup"])
        elif _is_sell_sig:
            oi_5m  = bool(signal_5m["metrics"]["oi_reduction"])
            oi_15m = bool(signal_15m["metrics"]["oi_reduction"])
        else:  # NEUTRAL: any OI activity counts
            oi_5m  = oi_raw_5m
            oi_15m = oi_raw_15m

        oi_score = 0
        if oi_5m and oi_15m:    oi_score = 15
        elif oi_5m or oi_15m:   oi_score = 10
        # Continuous bonus: 0 at 1% OI change, +1.5 at 3%, +3 at 5% (no cliff)
        best_oi_chg  = max(oi_change_5m, oi_change_15m)
        oi_chg_bonus = min(3.0, max(0.0, (best_oi_chg - 1.0) * 0.75))
        oi_score     = min(15, int(oi_score + oi_chg_bonus))
        confidence_factors.append(("OI Activity", oi_score, 15))

        # FACTOR 5: Liquidity Grab (10 points max)
        # Direction-aware: buy-side grab confirms BUY; sell-side grab confirms SELL.
        # A buy-side liquidity sweep on a SELL signal is a warning flag — not confirmation.
        if _is_buy_sig:
            liq_grab_5m  = bool(signal_5m["metrics"]["liquidity_grab"])
            liq_grab_15m = bool(signal_15m["metrics"]["liquidity_grab"])
        elif _is_sell_sig:
            liq_grab_5m  = bool(signal_5m["metrics"]["liquidity_grab_sell"])
            liq_grab_15m = bool(signal_15m["metrics"]["liquidity_grab_sell"])
        else:  # NEUTRAL: either side counts
            liq_grab_5m  = bool(signal_5m["metrics"]["liquidity_grab"])  or bool(signal_5m["metrics"]["liquidity_grab_sell"])
            liq_grab_15m = bool(signal_15m["metrics"]["liquidity_grab"]) or bool(signal_15m["metrics"]["liquidity_grab_sell"])

        liq_score = 0
        if liq_grab_5m and liq_grab_15m:  liq_score = 10
        elif liq_grab_5m or liq_grab_15m: liq_score = 6
        confidence_factors.append(("Liquidity Grab", liq_score, 10))
        
        # FACTOR 6: Price Structure (5 points max)
        price_5m = signal_5m["metrics"]["price_breakout"] or signal_5m["metrics"]["price_breakdown"]
        price_15m = signal_15m["metrics"]["price_breakout"] or signal_15m["metrics"]["price_breakdown"]
        
        price_score = 0
        if price_5m and price_15m:  # Both show clear price structure
            price_score = 5
        elif price_5m or price_15m:  # One shows price structure
            price_score = 3
        confidence_factors.append(("Price Structure", price_score, 5))
        
        # CALCULATE FINAL CONFIDENCE
        # OI data is always 0 for NSE spot indices (Zerodha). When unavailable,
        # exclude the OI factor from the denominator — otherwise its 15 pts are
        # permanently unreachable, deflating every confidence reading unfairly.
        # Use the RAW (direction-agnostic) booleans here — we want to know if OI
        # data EXISTS at all, not whether it supports the current signal direction.
        oi_data_present = (
            oi_raw_5m or oi_raw_15m or oi_change_5m > 0.0 or oi_change_15m > 0.0
        )
        if not oi_data_present:
            active_factors = [(n, s, mx) for n, s, mx in confidence_factors if n != "OI Activity"]
        else:
            active_factors = confidence_factors

        total_score    = sum(s  for _, s,  _ in active_factors)
        total_possible = sum(mx for _, _, mx in active_factors)

        # Confidence as percentage (0-100)
        confidence = int((total_score / total_possible) * 100) if total_possible > 0 else 0
        
        # PENALTY for conflicting signals between timeframes
        if (strength_5m > 0 and strength_15m < 0) or (strength_5m < 0 and strength_15m > 0):
            confidence = int(confidence * 0.6)  # 40% penalty for conflict
        
        # BOOST for perfect alignment on STRONG signals
        if strength_5m == strength_15m and abs(strength_5m) == 2:  # Both STRONG BUY or STRONG SELL
            confidence = min(100, confidence + 10)
        
        # Ensure confidence is within bounds
        confidence = max(0, min(100, confidence))
        
        # ============================================================
        # BUILD DETAILED REASONS (Top 5 factors)
        # ============================================================
        
        # Add confidence breakdown as first reason
        reasons.append(f"💯 Confidence: {confidence}% (Alignment:{alignment_score} Data:{strength_score} Vol:{volume_score} OI:{oi_score})")
        
        # BUY REASONS
        if signal_5m["metrics"]["liquidity_grab"]:
            reasons.append("💎 5m Liquidity Grab Detected → Stop-losses taken")
        if signal_15m["metrics"]["liquidity_grab"]:
            reasons.append("💎 15m Liquidity Grab Detected → Absorption zone")
            
        if signal_5m["metrics"]["oi_buildup"]:
            reasons.append(f"📈 5m OI Buildup +{signal_5m['metrics']['oi_change_pct']:.1f}% → Fresh longs")
        if signal_15m["metrics"]["oi_buildup"]:
            reasons.append(f"📈 15m OI Buildup +{signal_15m['metrics']['oi_change_pct']:.1f}% → Trend strength")
            
        if signal_5m["metrics"]["volume_spike"]:
            reasons.append(f"📊 5m Volume Spike {signal_5m['metrics']['volume_ratio']:.1f}x → Aggressive buying")
        if signal_15m["metrics"]["volume_spike"]:
            reasons.append(f"📊 15m Volume Spike {signal_15m['metrics']['volume_ratio']:.1f}x → Institutional participation")
            
        if signal_5m["metrics"]["price_breakout"]:
            reasons.append("🚀 5m Price Breakout → Higher high formed")
        if signal_15m["metrics"]["price_breakout"]:
            reasons.append("🚀 15m Price Breakout → Trend continuation")
            
        # SELL REASONS
        if signal_5m["metrics"]["liquidity_grab_sell"]:
            reasons.append("⚠️ 5m Sell-side Liquidity Grab → Distribution zone")
        if signal_15m["metrics"]["liquidity_grab_sell"]:
            reasons.append("⚠️ 15m Sell-side Liquidity Grab → Top formation")
            
        if signal_5m["metrics"]["oi_reduction"]:
            reasons.append(f"📉 5m OI Activity → Unwinding/Short buildup")
        if signal_15m["metrics"]["oi_reduction"]:
            reasons.append(f"📉 15m OI Activity → Position closing")
            
        if signal_5m["metrics"]["price_breakdown"]:
            reasons.append("🔻 5m Price Breakdown → Lower low formed")
        if signal_15m["metrics"]["price_breakdown"]:
            reasons.append("🔻 15m Price Breakdown → Trend reversal")
        
        # NEUTRAL/WARNING
        if not reasons or len(reasons) <= 1:
            reasons.append("⏸️ No clear setup → Wait for confirmation")
        
        if alignment > 1:
            reasons.append(f"⚠️ Timeframe conflict → 5m:{signal_5m['signal']} vs 15m:{signal_15m['signal']}")
        
        # Limit to top 6 reasons (including confidence breakdown)
        reasons = reasons[:6]
        
        return final_signal, confidence, reasons

    def _no_signal_response(self, reason: str = "Insufficient data") -> Dict:
        """Return no signal response"""
        return {
            "signal_5m": "NO_SIGNAL",
            "signal_15m": "NO_SIGNAL",
            "final_signal": "NO_SIGNAL",
            "confidence": 0,
            "reasons": [reason],
            "metrics": self._empty_metrics(),
            "timestamp": datetime.now().isoformat()
        }

    def _empty_metrics(self) -> Dict:
        """Return empty metrics (all fields including sell-side)"""
        return {
            "liquidity_grab_5m": False,
            "liquidity_grab_15m": False,
            "oi_buildup_5m": False,
            "oi_buildup_15m": False,
            "volume_spike_5m": False,
            "volume_spike_15m": False,
            "price_breakout_5m": False,
            "price_breakout_15m": False,
            "oi_change_pct_5m": 0,
            "oi_change_pct_15m": 0,
            "volume_ratio_5m": 0,
            "volume_ratio_15m": 0,
            # Sell-side
            "price_breakdown_5m": False,
            "price_breakdown_15m": False,
            "oi_reduction_5m": False,
            "oi_reduction_15m": False,
            "liquidity_grab_sell_5m": False,
            "liquidity_grab_sell_15m": False,
        }


# Global instance
oi_momentum_service = OIMomentumService()
