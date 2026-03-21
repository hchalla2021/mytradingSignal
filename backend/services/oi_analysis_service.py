"""
Advanced OI Analysis Service — Multi-Factor Institutional Flow Intelligence

8-Factor scoring engine:
  1. OI Trend (price-OI divergence/convergence)
  2. Volume-Weighted OI Momentum
  3. Liquidity Sweep Detection
  4. Institutional Accumulation/Distribution
  5. Multi-Timeframe OI Alignment (5m + 15m)
  6. OI Velocity & Acceleration
  7. Price Structure Confirmation
  8. Smart Money Trap Detection

Signals: STRONG_BUY | BUY | NEUTRAL | SELL | STRONG_SELL
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from datetime import datetime
from typing import Dict, List, Optional, Literal
import logging

logger = logging.getLogger(__name__)

SignalType = Literal["STRONG_BUY", "BUY", "NEUTRAL", "SELL", "STRONG_SELL", "NO_SIGNAL"]


class AdvancedOIAnalysisService:

    def __init__(self):
        self.min_candles = 3

    # ─── PUBLIC API ──────────────────────────────────────────────────

    def analyze(
        self,
        symbol: str,
        df_5m: pd.DataFrame,
        df_15m: pd.DataFrame,
        current_price: float,
        current_oi: Optional[int] = None,
        current_volume: Optional[int] = None,
    ) -> Dict:
        try:
            if df_5m is None or len(df_5m) < self.min_candles:
                return self._no_signal("Insufficient 5m data")

            has_15m = df_15m is not None and len(df_15m) >= 1

            # ── Per-timeframe factor scores ──────────────────────────
            f5 = self._score_timeframe(df_5m, "5m", current_price, current_oi, current_volume)
            f15 = self._score_timeframe(df_15m, "15m", current_price, current_oi, current_volume) if has_15m else None

            # ── Aggregate (15m weighted 55%, 5m 45%) ─────────────────
            if f15:
                agg_buy  = f5["buy_score"] * 0.45 + f15["buy_score"] * 0.55
                agg_sell = f5["sell_score"] * 0.45 + f15["sell_score"] * 0.55
            else:
                agg_buy  = f5["buy_score"]
                agg_sell = f5["sell_score"]

            net = agg_buy - agg_sell

            if net >= 55:
                signal = "STRONG_BUY"
            elif net >= 22:
                signal = "BUY"
            elif net <= -55:
                signal = "STRONG_SELL"
            elif net <= -22:
                signal = "SELL"
            else:
                signal = "NEUTRAL"

            # ── Confidence ───────────────────────────────────────────
            confidence = self._calc_confidence(f5, f15, signal)

            # ── 5-min prediction ─────────────────────────────────────
            pred = self._predict_5m(f5, f15, signal, confidence)

            # ── Reasons ──────────────────────────────────────────────
            reasons = self._build_reasons(f5, f15, signal, confidence)

            # ── Factors (flat for frontend) ──────────────────────────
            factors = self._build_factors(f5, f15)

            # ── Timeframe alignment status ────────────────────────
            s5_str = self._signal_strength(f5["signal"])
            s15_str = self._signal_strength(f15["signal"]) if f15 else s5_str
            is_conflicting = (s5_str > 0 and s15_str < 0) or (s5_str < 0 and s15_str > 0)
            if f15 and f5["signal"] == f15["signal"]:
                alignment = "ALIGNED"
            elif not f15:
                alignment = "ALIGNED"
            elif is_conflicting:
                alignment = "CONFLICTING"
            else:
                alignment = "PARTIAL"

            # ── Trader summary ────────────────────────────────────────
            summary = self._build_trader_summary(signal, confidence, f5, f15, alignment)

            return {
                "signal": signal,
                "confidence": confidence,
                "prediction_5m": pred,
                "factors": factors,
                "reasons": reasons,
                "signal_5m": f5["signal"],
                "signal_15m": f15["signal"] if f15 else f5["signal"],
                "is_conflicting": is_conflicting,
                "alignment": alignment,
                "trader_summary": summary,
                "timestamp": datetime.now().isoformat(),
            }

        except Exception as e:
            logger.error(f"Advanced OI analysis error [{symbol}]: {e}")
            return self._no_signal(f"Error: {str(e)[:80]}")

    # ─── TIMEFRAME SCORING ───────────────────────────────────────────

    def _score_timeframe(
        self, df: pd.DataFrame, tf: str,
        price: float, oi: Optional[int], volume: Optional[int],
    ) -> Dict:
        df = df.copy()
        req = ["open", "high", "low", "close", "volume"]
        if not all(c in df.columns for c in req):
            return self._empty_tf_score(tf)

        n = len(df)
        has_vol = bool(df["volume"].sum() > 0)
        has_oi = "oi" in df.columns and df["oi"].sum() > 0

        buy = 0.0
        sell = 0.0
        detail: Dict = {}

        # ── F1: OI Trend (convergence / divergence) ──────────────────
        oi_change_pct = 0.0
        if has_oi and n >= 2:
            prev_oi = float(df["oi"].iloc[-2]) if df["oi"].iloc[-2] > 0 else 0
            curr_oi = float(df["oi"].iloc[-1])
            if prev_oi > 0:
                oi_change_pct = ((curr_oi - prev_oi) / prev_oi) * 100

            price_up = df["close"].iloc[-1] > df["close"].iloc[-2]
            oi_up = curr_oi > prev_oi

            # Price up + OI up = long buildup (bullish)
            # Price down + OI up = short buildup (bearish)
            # Price up + OI down = short covering (weak bullish)
            # Price down + OI down = long unwinding (weak bearish)
            if price_up and oi_up:
                buy += 20 + min(10, abs(oi_change_pct) * 2)
                detail["oi_trend"] = "LONG_BUILDUP"
            elif not price_up and oi_up:
                sell += 20 + min(10, abs(oi_change_pct) * 2)
                detail["oi_trend"] = "SHORT_BUILDUP"
            elif price_up and not oi_up:
                buy += 8
                detail["oi_trend"] = "SHORT_COVERING"
            else:
                sell += 8
                detail["oi_trend"] = "LONG_UNWINDING"
        else:
            detail["oi_trend"] = "NO_DATA"

        detail["oi_change_pct"] = round(oi_change_pct, 2)

        # ── F2: Volume-Weighted OI Momentum ──────────────────────────
        avg_vol = df["volume"].rolling(3, min_periods=1).mean()
        vol_ratio = float(df["volume"].iloc[-1] / avg_vol.iloc[-1]) if has_vol and avg_vol.iloc[-1] > 0 else 1.0
        detail["volume_ratio"] = round(vol_ratio, 2)
        detail["volume_spike"] = vol_ratio > 1.3

        if has_vol and vol_ratio > 1.3:
            price_dir = df["close"].iloc[-1] - df["close"].iloc[-2] if n >= 2 else 0
            vol_pts = min(18, 10 + (vol_ratio - 1.3) * 8)
            if price_dir > 0:
                buy += vol_pts
            elif price_dir < 0:
                sell += vol_pts
            else:
                buy += vol_pts * 0.3
                sell += vol_pts * 0.3

        # ── F3: Liquidity Sweep Detection ────────────────────────────
        if n >= 3:
            lowest_2 = df["low"].iloc[-3:-1].min()
            highest_2 = df["high"].iloc[-3:-1].max()
            curr_low = df["low"].iloc[-1]
            curr_high = df["high"].iloc[-1]
            curr_close = df["close"].iloc[-1]
            prev_low = df["low"].iloc[-2]
            prev_high = df["high"].iloc[-2]

            # Buy-side sweep: pierced below support then closed above
            liq_buy = curr_low < lowest_2 and curr_close > prev_low
            # Sell-side sweep: pierced above resistance then closed below
            liq_sell = curr_high > highest_2 and curr_close < prev_high

            detail["liquidity_sweep_buy"] = bool(liq_buy)
            detail["liquidity_sweep_sell"] = bool(liq_sell)

            if liq_buy:
                buy += 15
            if liq_sell:
                sell += 15
        else:
            detail["liquidity_sweep_buy"] = False
            detail["liquidity_sweep_sell"] = False

        # ── F4: Institutional Accumulation / Distribution ────────────
        if n >= 4:
            recent = df.iloc[-4:]
            body_sizes = abs(recent["close"] - recent["open"])
            ranges = recent["high"] - recent["low"]
            avg_body = body_sizes.mean()
            avg_range = ranges.mean()

            # Accumulation: small bodies, volume rising, price stable
            body_ratio = float(avg_body / avg_range) if avg_range > 0 else 0.5
            vol_trend = float(df["volume"].iloc[-1] / df["volume"].iloc[-3]) if has_vol and df["volume"].iloc[-3] > 0 else 1.0

            if body_ratio < 0.35 and vol_trend > 1.2:
                # Tight range + rising volume = accumulation/distribution
                if df["close"].iloc[-1] >= df["close"].iloc[-4]:
                    buy += 12
                    detail["institutional_flow"] = "ACCUMULATION"
                else:
                    sell += 12
                    detail["institutional_flow"] = "DISTRIBUTION"
            elif body_ratio > 0.7 and vol_trend > 1.3:
                # Wide bodies + volume = conviction move
                if df["close"].iloc[-1] > df["open"].iloc[-1]:
                    buy += 10
                    detail["institutional_flow"] = "AGGRESSIVE_BUYING"
                else:
                    sell += 10
                    detail["institutional_flow"] = "AGGRESSIVE_SELLING"
            else:
                detail["institutional_flow"] = "NEUTRAL"
        else:
            detail["institutional_flow"] = "NO_DATA"

        # ── F5: OI Velocity & Acceleration ───────────────────────────
        if has_oi and n >= 3:
            oi_vals = df["oi"].iloc[-3:].values.astype(float)
            if oi_vals[0] > 0 and oi_vals[1] > 0:
                vel_1 = (oi_vals[1] - oi_vals[0]) / oi_vals[0]
                vel_2 = (oi_vals[2] - oi_vals[1]) / oi_vals[1] if oi_vals[1] > 0 else 0
                accel = vel_2 - vel_1
                detail["oi_velocity"] = round(vel_2 * 100, 2)
                detail["oi_acceleration"] = round(accel * 100, 2)

                price_dir = df["close"].iloc[-1] - df["close"].iloc[-2]
                if accel > 0.005 and price_dir > 0:
                    buy += 10
                elif accel > 0.005 and price_dir < 0:
                    sell += 10
                elif accel < -0.005:
                    # Decelerating OI: momentum fading
                    if price_dir > 0:
                        sell += 5  # Weakening longs
                    else:
                        buy += 5   # Weakening shorts
            else:
                detail["oi_velocity"] = 0.0
                detail["oi_acceleration"] = 0.0
        else:
            detail["oi_velocity"] = 0.0
            detail["oi_acceleration"] = 0.0

        # ── F6: Price Structure Confirmation ─────────────────────────
        if n >= 3:
            rolling_high = df["high"].rolling(3, min_periods=1).max().shift(1)
            rolling_low = df["low"].rolling(3, min_periods=1).min().shift(1)

            breakout = bool(
                df["close"].iloc[-1] > df["close"].iloc[-2]
                and df["high"].iloc[-1] > rolling_high.iloc[-1]
            )
            breakdown = bool(
                df["close"].iloc[-1] < df["close"].iloc[-2]
                and df["low"].iloc[-1] < rolling_low.iloc[-1]
            )
            detail["price_breakout"] = breakout
            detail["price_breakdown"] = breakdown

            if breakout:
                buy += 12
            if breakdown:
                sell += 12
        else:
            detail["price_breakout"] = False
            detail["price_breakdown"] = False

        # ── F7: Smart Money Trap Detection ───────────────────────────
        detail["trap_detected"] = False
        detail["trap_type"] = "NONE"
        if n >= 3:
            c = df.iloc[-1]
            p = df.iloc[-2]
            body = abs(c["close"] - c["open"])
            rng = c["high"] - c["low"]
            upper_wick = c["high"] - max(c["close"], c["open"])
            lower_wick = min(c["close"], c["open"]) - c["low"]

            if rng > 0:
                # Bull trap: large upper wick after breakout
                if upper_wick > body * 2 and c["high"] > p["high"] and c["close"] < c["open"]:
                    sell += 10
                    detail["trap_detected"] = True
                    detail["trap_type"] = "BULL_TRAP"
                # Bear trap: large lower wick after breakdown
                elif lower_wick > body * 2 and c["low"] < p["low"] and c["close"] > c["open"]:
                    buy += 10
                    detail["trap_detected"] = True
                    detail["trap_type"] = "BEAR_TRAP"

        # ── F8: Candle Body Conviction ───────────────────────────────
        if n >= 1:
            last = df.iloc[-1]
            body_pct = abs(last["close"] - last["open"]) / (last["high"] - last["low"]) * 100 if (last["high"] - last["low"]) > 0 else 0
            if body_pct > 65:
                if last["close"] > last["open"]:
                    buy += 8
                else:
                    sell += 8

        # ── Determine tf signal ──────────────────────────────────────
        net = buy - sell
        if net >= 45:
            sig = "STRONG_BUY"
        elif net >= 18:
            sig = "BUY"
        elif net <= -45:
            sig = "STRONG_SELL"
        elif net <= -18:
            sig = "SELL"
        else:
            sig = "NEUTRAL"

        return {
            "signal": sig,
            "buy_score": round(buy, 1),
            "sell_score": round(sell, 1),
            "detail": detail,
        }

    # ─── CONFIDENCE ──────────────────────────────────────────────────

    def _calc_confidence(self, f5: Dict, f15: Optional[Dict], signal: str) -> int:
        pts = 0
        max_pts = 0

        s5 = self._signal_strength(f5["signal"])
        s15 = self._signal_strength(f15["signal"]) if f15 else s5

        # 1. Alignment (0-30)
        max_pts += 30
        diff = abs(s5 - s15)
        if diff == 0:
            pts += 30
        elif diff == 1:
            pts += 20
        elif diff == 2:
            pts += 10

        # 2. Data score strength (0-25)
        max_pts += 25
        dominant = max(f5["buy_score"], f5["sell_score"])
        if f15:
            dominant = max(dominant, f15["buy_score"], f15["sell_score"])
        pts += min(25, int(dominant * 0.3))

        # 3. Volume confirmation (0-15)
        max_pts += 15
        v5 = f5["detail"].get("volume_spike", False)
        v15 = f15["detail"].get("volume_spike", False) if f15 else False
        if v5 and v15:
            pts += 15
        elif v5 or v15:
            pts += 9

        # 4. OI confirmation (0-15)
        oi_present = abs(f5["detail"].get("oi_change_pct", 0)) > 0
        if f15:
            oi_present = oi_present or abs(f15["detail"].get("oi_change_pct", 0)) > 0

        if oi_present:
            max_pts += 15
            trend5 = f5["detail"].get("oi_trend", "")
            trend15 = f15["detail"].get("oi_trend", "") if f15 else ""
            is_buy = signal in ("STRONG_BUY", "BUY")
            is_sell = signal in ("STRONG_SELL", "SELL")

            supporting_5 = (is_buy and trend5 == "LONG_BUILDUP") or (is_sell and trend5 == "SHORT_BUILDUP")
            supporting_15 = (is_buy and trend15 == "LONG_BUILDUP") or (is_sell and trend15 == "SHORT_BUILDUP")

            if supporting_5 and supporting_15:
                pts += 15
            elif supporting_5 or supporting_15:
                pts += 9

        # 5. Trap bonus (0-5)
        max_pts += 5
        trap5 = f5["detail"].get("trap_detected", False)
        trap15 = f15["detail"].get("trap_detected", False) if f15 else False
        if trap5 or trap15:
            pts += 5

        # 6. Institutional flow (0-10)
        max_pts += 10
        flow5 = f5["detail"].get("institutional_flow", "")
        flow15 = f15["detail"].get("institutional_flow", "") if f15 else ""
        is_buy = signal in ("STRONG_BUY", "BUY")
        bullish_flows = ("ACCUMULATION", "AGGRESSIVE_BUYING")
        bearish_flows = ("DISTRIBUTION", "AGGRESSIVE_SELLING")
        supporting = (is_buy and (flow5 in bullish_flows or flow15 in bullish_flows)) or \
                     (not is_buy and (flow5 in bearish_flows or flow15 in bearish_flows))
        if supporting:
            pts += 10
        elif flow5 != "NEUTRAL" or flow15 != "NEUTRAL":
            pts += 4

        conf = int((pts / max_pts) * 100) if max_pts > 0 else 50

        # Conflict penalty — softer: traders still need actionable confidence
        is_conflicting = (s5 > 0 and s15 < 0) or (s5 < 0 and s15 > 0)
        if is_conflicting:
            conf = max(30, int(conf * 0.75))

        # Strong alignment boost
        if s5 == s15 and abs(s5) == 2:
            conf = min(98, conf + 10)

        # Ensure minimum meaningful confidence when data exists
        has_data = abs(f5["buy_score"]) + abs(f5["sell_score"]) > 5
        if has_data:
            conf = max(25, conf)

        return max(5, min(98, conf))

    # ─── 5-MIN PREDICTION ────────────────────────────────────────────

    def _predict_5m(self, f5: Dict, f15: Optional[Dict], signal: str, confidence: int) -> Dict:
        s5 = self._signal_strength(f5["signal"])
        s15 = self._signal_strength(f15["signal"]) if f15 else s5
        combo = s15 * 0.55 + s5 * 0.45

        direction = "UP" if combo > 0.2 else "DOWN" if combo < -0.2 else "FLAT"
        aligned = s5 != 0 and s15 != 0 and (s5 > 0) == (s15 > 0)

        pts = 0
        # Signal agreement (0-35)
        if aligned and abs(combo) >= 1.5:
            pts += 35
        elif aligned:
            pts += 20
        elif s5 != 0 and s15 != 0:
            pts -= 10

        # Volume (0-18)
        if f5["detail"].get("volume_spike") and (f15 and f15["detail"].get("volume_spike")):
            pts += 18
        elif f5["detail"].get("volume_spike") or (f15 and f15["detail"].get("volume_spike")):
            pts += 9

        # OI velocity (0-12)
        vel = f5["detail"].get("oi_velocity", 0)
        if abs(vel) > 1:
            pts += min(12, int(abs(vel) * 3))

        # Price structure (0-10)
        if f5["detail"].get("price_breakout") or f5["detail"].get("price_breakdown"):
            pts += 10

        # Trap bonus
        if f5["detail"].get("trap_detected"):
            pts += 8

        prob = max(25, min(95, 42 + int(pts * 0.6)))

        context_map = {
            "UP": "Bullish momentum building" if aligned else "Upward bias, mixed signals",
            "DOWN": "Bearish pressure increasing" if aligned else "Downward bias, conflicting",
            "FLAT": "Range-bound, wait for breakout",
        }

        return {
            "direction": direction,
            "probability": prob,
            "context": context_map[direction],
        }

    # ─── TRADER SUMMARY ──────────────────────────────────────────────

    def _build_trader_summary(self, signal: str, confidence: int, f5: Dict, f15: Optional[Dict], alignment: str) -> str:
        d5 = f5["detail"]
        d15 = f15["detail"] if f15 else {}
        oi_t5 = d5.get("oi_trend", "NO_DATA")
        oi_t15 = d15.get("oi_trend", oi_t5)

        trend_map = {
            "LONG_BUILDUP": "fresh longs building",
            "SHORT_BUILDUP": "sellers adding positions",
            "SHORT_COVERING": "shorts exiting (bullish)",
            "LONG_UNWINDING": "longs exiting (bearish)",
        }

        if alignment == "CONFLICTING":
            t5_desc = trend_map.get(oi_t5, "mixed")
            t15_desc = trend_map.get(oi_t15, "mixed")
            return f"Timeframe conflict: 5m {t5_desc}, 15m {t15_desc}. Wait for alignment or trade the 15m bias."
        elif signal in ("STRONG_BUY", "BUY"):
            if oi_t15 == "LONG_BUILDUP":
                return f"Bullish: Fresh long positions building on both timeframes. Confidence {confidence}%."
            elif oi_t15 == "SHORT_COVERING":
                return f"Mildly bullish: Shorts covering. Momentum may fade - trail stops tight."
            return f"Bullish bias with {confidence}% conviction. Monitor OI buildup for confirmation."
        elif signal in ("STRONG_SELL", "SELL"):
            if oi_t15 == "SHORT_BUILDUP":
                return f"Bearish: Fresh short positions building. Sellers in control. Conf {confidence}%."
            elif oi_t15 == "LONG_UNWINDING":
                return f"Bearish: Longs unwinding - expect continued downside pressure."
            return f"Bearish bias with {confidence}% conviction. Watch for short covering bounce."
        else:
            vel = d5.get("oi_velocity", 0)
            if abs(vel) > 1:
                return f"Neutral but OI velocity is {vel:+.1f}% - direction may emerge soon."
            return "No clear institutional bias. Choppy conditions - wait for OI trend to develop."

    # ─── REASONS ─────────────────────────────────────────────────────

    def _build_reasons(self, f5: Dict, f15: Optional[Dict], signal: str, conf: int) -> List[str]:
        reasons = [f"Confidence: {conf}%"]
        d5 = f5["detail"]
        d15 = f15["detail"] if f15 else {}

        oi_t5 = d5.get("oi_trend", "")
        oi_t15 = d15.get("oi_trend", "")
        oi_labels = {
            "LONG_BUILDUP": "Long Buildup (Price Up + OI Up)",
            "SHORT_BUILDUP": "Short Buildup (Price Down + OI Up)",
            "SHORT_COVERING": "Short Covering (Price Up + OI Down)",
            "LONG_UNWINDING": "Long Unwinding (Price Down + OI Down)",
        }
        if oi_t5 in oi_labels:
            reasons.append(f"5m {oi_labels[oi_t5]}")
        if oi_t15 in oi_labels:
            reasons.append(f"15m {oi_labels[oi_t15]}")

        if d5.get("volume_spike"):
            reasons.append(f"5m Volume Spike {d5.get('volume_ratio', 0):.1f}x")
        if d15.get("volume_spike"):
            reasons.append(f"15m Volume Spike {d15.get('volume_ratio', 0):.1f}x")

        if d5.get("liquidity_sweep_buy"):
            reasons.append("5m Buy-side Liquidity Sweep")
        if d5.get("liquidity_sweep_sell"):
            reasons.append("5m Sell-side Liquidity Sweep")

        flow5 = d5.get("institutional_flow", "")
        if flow5 not in ("NEUTRAL", "NO_DATA", ""):
            reasons.append(f"5m Institutional {flow5.replace('_', ' ').title()}")

        if d5.get("trap_detected"):
            reasons.append(f"Trap: {d5.get('trap_type', 'UNKNOWN').replace('_', ' ').title()}")

        if d5.get("price_breakout"):
            reasons.append("Price Breakout Confirmed")
        elif d5.get("price_breakdown"):
            reasons.append("Price Breakdown Confirmed")

        return reasons[:7]

    # ─── FACTORS (flat dict for frontend) ────────────────────────────

    def _build_factors(self, f5: Dict, f15: Optional[Dict]) -> Dict:
        d5 = f5["detail"]
        d15 = f15["detail"] if f15 else {}
        return {
            "oi_trend_5m": d5.get("oi_trend", "NO_DATA"),
            "oi_trend_15m": d15.get("oi_trend", d5.get("oi_trend", "NO_DATA")),
            "oi_change_pct_5m": d5.get("oi_change_pct", 0),
            "oi_change_pct_15m": d15.get("oi_change_pct", 0),
            "volume_ratio_5m": d5.get("volume_ratio", 0),
            "volume_ratio_15m": d15.get("volume_ratio", 0),
            "volume_spike_5m": d5.get("volume_spike", False),
            "volume_spike_15m": d15.get("volume_spike", False),
            "liquidity_sweep_buy_5m": d5.get("liquidity_sweep_buy", False),
            "liquidity_sweep_sell_5m": d5.get("liquidity_sweep_sell", False),
            "liquidity_sweep_buy_15m": d15.get("liquidity_sweep_buy", False),
            "liquidity_sweep_sell_15m": d15.get("liquidity_sweep_sell", False),
            "institutional_flow_5m": d5.get("institutional_flow", "NO_DATA"),
            "institutional_flow_15m": d15.get("institutional_flow", d5.get("institutional_flow", "NO_DATA")),
            "oi_velocity_5m": d5.get("oi_velocity", 0),
            "oi_acceleration_5m": d5.get("oi_acceleration", 0),
            "price_breakout_5m": d5.get("price_breakout", False),
            "price_breakdown_5m": d5.get("price_breakdown", False),
            "price_breakout_15m": d15.get("price_breakout", False),
            "price_breakdown_15m": d15.get("price_breakdown", False),
            "trap_detected": d5.get("trap_detected", False) or d15.get("trap_detected", False),
            "trap_type": d5.get("trap_type", d15.get("trap_type", "NONE")),
        }

    # ─── HELPERS ─────────────────────────────────────────────────────

    @staticmethod
    def _signal_strength(sig: str) -> int:
        return {"STRONG_BUY": 2, "BUY": 1, "NEUTRAL": 0, "SELL": -1, "STRONG_SELL": -2}.get(sig, 0)

    def _empty_tf_score(self, tf: str) -> Dict:
        return {
            "signal": "NO_SIGNAL",
            "buy_score": 0,
            "sell_score": 0,
            "detail": {
                "oi_trend": "NO_DATA", "oi_change_pct": 0, "volume_ratio": 0, "volume_spike": False,
                "liquidity_sweep_buy": False, "liquidity_sweep_sell": False,
                "institutional_flow": "NO_DATA", "oi_velocity": 0, "oi_acceleration": 0,
                "price_breakout": False, "price_breakdown": False,
                "trap_detected": False, "trap_type": "NONE",
            },
        }

    def _no_signal(self, reason: str) -> Dict:
        empty_factors = self._build_factors(self._empty_tf_score("5m"), self._empty_tf_score("15m"))
        return {
            "signal": "NO_SIGNAL",
            "confidence": 0,
            "prediction_5m": {"direction": "FLAT", "probability": 50, "context": reason},
            "factors": empty_factors,
            "reasons": [reason],
            "signal_5m": "NO_SIGNAL",
            "signal_15m": "NO_SIGNAL",
            "is_conflicting": False,
            "alignment": "NONE",
            "trader_summary": reason,
            "timestamp": datetime.now().isoformat(),
        }

    def empty_factors(self) -> Dict:
        return self._build_factors(self._empty_tf_score("5m"), self._empty_tf_score("15m"))


# Singleton
oi_analysis_service = AdvancedOIAnalysisService()
