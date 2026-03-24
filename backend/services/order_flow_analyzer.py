"""
🔥 ADVANCED ORDER FLOW ANALYZER
Real-time tick-by-tick order flow analysis for institutional-grade trading signals.

Features:
- Live bid/ask depth analysis
- Buyer vs seller domination signals
- Delta (buy volume - sell volume) with cumulative tracking
- Aggressive buyer/seller detection
- Liquidity analysis at price levels
- 5-minute order flow prediction
- Buy/sell signal confidence scoring
"""

import asyncio
import threading
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
from collections import deque
import pytz

from config.market_session import get_market_session

market_config = get_market_session()
IST = pytz.timezone(market_config.TIMEZONE)


class OrderFlowMetrics:
    """Container for a single tick's order flow metrics."""
    
    def __init__(self):
        self.timestamp: datetime = datetime.now(IST)
        
        # Bid/Ask spread
        self.bid: float = 0.0
        self.ask: float = 0.0
        self.spread: float = 0.0
        self.spread_pct: float = 0.0
        
        # Volume at price levels
        self.bid_levels: List[Dict[str, Any]] = []  # [{price, quantity, orders}, ...]
        self.ask_levels: List[Dict[str, Any]] = []  # [{price, quantity, orders}, ...]
        
        # Cumulative volume
        self.total_bid_qty: float = 0.0
        self.total_ask_qty: float = 0.0
        self.total_bid_orders: int = 0
        self.total_ask_orders: int = 0
        
        # Delta analysis
        self.delta: float = 0.0  # Current tick delta (buy - sell)
        self.cumulative_delta: float = 0.0  # Sum of all deltas in window
        self.delta_trend: str = "NEUTRAL"  # BULLISH, BEARISH, NEUTRAL
        
        # Aggressive volume (high volume on one side = aggressive)
        self.aggressive_buyers_ratio: float = 0.0  # % of ticks with buy dominance
        self.aggressive_sellers_ratio: float = 0.0  # % of ticks with sell dominance
        self.buyer_aggression: float = 0.0  # 0.0 - 1.0 scale
        self.seller_aggression: float = 0.0  # 0.0 - 1.0 scale
        
        # Liquidity analysis
        self.liquidity_imbalance: float = 0.0  # (bid_qty - ask_qty) / total
        self.bid_depth: float = 0.0  # Sum of bid quantities at all levels
        self.ask_depth: float = 0.0  # Sum of ask quantities at all levels
        
        # Order flow signals
        self.buy_domination: bool = False  # true if buy side dominating
        self.sell_domination: bool = False  # true if sell side dominating
        self.signal: str = "NEUTRAL"  # STRONG_BUY, BUY, HOLD, SELL, STRONG_SELL
        self.signal_confidence: float = 0.0  # 0.0 - 1.0


class OrderFlowWindow:
    """Tracks order flow metrics over a rolling window (e.g., 5 minutes)."""
    
    def __init__(self, window_seconds: int = 300):
        self.window_seconds = window_seconds
        self.metrics: deque[OrderFlowMetrics] = deque(maxlen=1000)
        self.running_delta: float = 0.0
        self.running_avg_spread: float = 0.0
        self.tick_count: int = 0
        
    def add_metrics(self, metrics: OrderFlowMetrics):
        """Add new order flow metrics to window."""
        self.metrics.append(metrics)
        self.tick_count += 1
        self.running_delta += metrics.delta
        
        # Calculate running metrics
        if self.metrics:
            spreads = [m.spread for m in self.metrics if m.spread > 0]
            self.running_avg_spread = sum(spreads) / len(spreads) if spreads else 0
            
    def get_metrics_in_window(self) -> List[OrderFlowMetrics]:
        """Get metrics within rolling window (exclude older ticks)."""
        if not self.metrics:
            return []
            
        now = datetime.now(IST)
        window_start = now - timedelta(seconds=self.window_seconds)
        
        return [m for m in self.metrics if m.timestamp >= window_start]
    
    def get_5min_prediction(self) -> Dict[str, Any]:
        """Generate 5-minute order flow prediction based on accumulated data."""
        windowed = self.get_metrics_in_window()
        if not windowed:
            return {
                "direction": "NEUTRAL",
                "confidence": 0.0,
                "reasoning": "Insufficient data",
                "tickCount": 0,
                "avgDelta": 0.0,
                "buyDominancePct": 50.0,
                "sellDominancePct": 50.0
            }
        
        # ── Use WINDOWED deltas only (not cumulative running_delta) ──
        avg_delta = sum(m.delta for m in windowed) / len(windowed)
        
        # ── Use continuous buyer_aggression (0-1) instead of boolean domination ──
        # This gives a smooth, always-changing percentage instead of counting
        # the rare ticks where the strict domination threshold is met.
        avg_buyer = sum(m.buyer_aggression for m in windowed) / len(windowed)
        avg_seller = sum(m.seller_aggression for m in windowed) / len(windowed)
        
        # Normalise so they sum to 100%
        total_agg = avg_buyer + avg_seller or 1.0
        buy_pct = avg_buyer / total_agg          # 0-1
        sell_pct = avg_seller / total_agg         # 0-1
        
        # ── Recent bias (last 30 ticks) for faster response ──
        recent = windowed[-30:] if len(windowed) > 30 else windowed
        recent_avg_delta = sum(m.delta for m in recent) / len(recent)
        recent_buy = sum(m.buyer_aggression for m in recent) / len(recent)
        recent_sell = sum(m.seller_aggression for m in recent) / len(recent)
        recent_total = recent_buy + recent_sell or 1.0
        recent_buy_pct = recent_buy / recent_total
        
        # Blend: 40% full window + 60% recent for responsiveness
        blended_buy = 0.4 * buy_pct + 0.6 * recent_buy_pct
        blended_sell = 1.0 - blended_buy
        blended_delta = 0.4 * avg_delta + 0.6 * recent_avg_delta
        
        # ── Direction + confidence from blended metrics ──
        dominance_gap = abs(blended_buy - blended_sell)  # 0 to 1
        
        if blended_delta > 0 and blended_buy > 0.58:
            direction = "STRONG_BUY"
            confidence = min(0.6 + dominance_gap * 2, 0.95)
            reasoning = f"Strong buy pressure: {int(blended_buy*100)}% buyers, Δ {blended_delta:+.0f}"
        elif blended_delta > 0 and blended_buy > 0.52:
            direction = "BUY"
            confidence = min(0.4 + dominance_gap * 1.5, 0.80)
            reasoning = f"Buy bias: {int(blended_buy*100)}% buyers, Δ {blended_delta:+.0f}"
        elif blended_delta < 0 and blended_sell > 0.58:
            direction = "STRONG_SELL"
            confidence = min(0.6 + dominance_gap * 2, 0.95)
            reasoning = f"Strong sell pressure: {int(blended_sell*100)}% sellers, Δ {blended_delta:+.0f}"
        elif blended_delta < 0 and blended_sell > 0.52:
            direction = "SELL"
            confidence = min(0.4 + dominance_gap * 1.5, 0.80)
            reasoning = f"Sell bias: {int(blended_sell*100)}% sellers, Δ {blended_delta:+.0f}"
        else:
            direction = "NEUTRAL"
            # Dynamic confidence: closer to 50/50 = higher NEUTRAL confidence
            confidence = max(0.15, 0.5 - dominance_gap)
            side = "buyers" if blended_buy > blended_sell else "sellers"
            reasoning = f"Balanced: {int(blended_buy*100)}% buy / {int(blended_sell*100)}% sell, slight {side}"
        
        return {
            "direction": direction,
            "confidence": round(confidence, 2),
            "reasoning": reasoning,
            "tickCount": len(windowed),
            "avgDelta": round(blended_delta, 2),
            "buyDominancePct": round(blended_buy * 100, 1),
            "sellDominancePct": round(blended_sell * 100, 1)
        }


class OrderFlowAnalyzer:
    """
    Real-time order flow analyzer that processes Zerodha ticks and generates
    institutional-grade trading signals.
    """
    
    def __init__(self):
        self.current_metrics: Dict[str, OrderFlowMetrics] = {}
        self.windows: Dict[str, OrderFlowWindow] = {}
        self.symbol_history: Dict[str, deque] = {
            "NIFTY": deque(maxlen=1000),
            "BANKNIFTY": deque(maxlen=1000),
            "SENSEX": deque(maxlen=1000)
        }
        self.lock = threading.Lock()
        
        # 🔥 Price history for momentum-based order flow (indices have no depth)
        self._price_history: Dict[str, deque] = {
            s: deque(maxlen=100) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        self._volume_history: Dict[str, deque] = {
            s: deque(maxlen=100) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        
        # Initialize windows for each symbol
        for symbol in ["NIFTY", "BANKNIFTY", "SENSEX"]:
            self.windows[symbol] = OrderFlowWindow(window_seconds=300)  # 5-minute window
            self.current_metrics[symbol] = OrderFlowMetrics()
        
        print("✅ OrderFlowAnalyzer initialized")

    async def process_zerodha_tick(self, tick: Dict[str, Any], symbol: str) -> OrderFlowMetrics:
        """
        Process a Zerodha KiteTicker tick and generate order flow metrics.
        
        For FUTURES: uses real depth data (5-level bid/ask).
        For INDICES: derives order flow from price momentum + volume
        (indices have no order book on Zerodha).
        """
        try:
            metrics = OrderFlowMetrics()
            
            # Extract bid/ask prices
            metrics.bid = tick.get('bid', 0.0)
            metrics.ask = tick.get('ask', 0.0)
            metrics.spread = abs(metrics.ask - metrics.bid)
            if metrics.bid > 0:
                metrics.spread_pct = (metrics.spread / metrics.bid) * 100
            
            # Extract market depth (bid/ask levels)
            depth = tick.get('depth', {})
            buy_levels = depth.get('buy', [])
            sell_levels = depth.get('sell', [])
            
            # Check if we have REAL depth data (non-zero prices)
            has_real_depth = any(
                l.get('price', 0) > 0 for l in buy_levels
            ) or any(
                l.get('price', 0) > 0 for l in sell_levels
            )
            
            if has_real_depth:
                # REAL DEPTH PATH — futures / stocks with order book
                metrics = self._process_with_depth(metrics, buy_levels, sell_levels)
            else:
                # PRICE-ACTION PATH — indices without order book
                price = tick.get('last_price', 0)
                volume = tick.get('volume_traded', 0)
                oi = tick.get('oi', 0)
                metrics = self._process_from_price_action(metrics, symbol, price, volume, oi)
            
            # Generate signal based on multiple factors
            metrics = self._generate_signal(metrics, symbol, tick)
            
            # Store metrics
            with self.lock:
                self.current_metrics[symbol] = metrics
                self.symbol_history[symbol].append(metrics)
                self.windows[symbol].add_metrics(metrics)
            
            return metrics
            
        except Exception as e:
            print(f"❌ Error processing tick for {symbol}: {e}")
            return OrderFlowMetrics()

    def _process_with_depth(self, metrics: OrderFlowMetrics,
                            buy_levels: List, sell_levels: List) -> OrderFlowMetrics:
        """Process using real market depth data (futures/stocks)."""
        metrics.bid_levels = [
            {'price': l.get('price', 0), 'quantity': l.get('quantity', 0),
             'orders': l.get('orders', 0)}
            for l in buy_levels[:5]
        ]
        metrics.ask_levels = [
            {'price': l.get('price', 0), 'quantity': l.get('quantity', 0),
             'orders': l.get('orders', 0)}
            for l in sell_levels[:5]
        ]
        metrics.total_bid_qty = sum(l['quantity'] for l in metrics.bid_levels)
        metrics.total_ask_qty = sum(l['quantity'] for l in metrics.ask_levels)
        metrics.total_bid_orders = sum(l['orders'] for l in metrics.bid_levels)
        metrics.total_ask_orders = sum(l['orders'] for l in metrics.ask_levels)
        metrics.delta = metrics.total_bid_qty - metrics.total_ask_qty
        
        total_qty = metrics.total_bid_qty + metrics.total_ask_qty
        if total_qty > 0:
            metrics.buyer_aggression = metrics.total_bid_qty / total_qty
            metrics.seller_aggression = metrics.total_ask_qty / total_qty
            metrics.liquidity_imbalance = (metrics.total_bid_qty - metrics.total_ask_qty) / total_qty
        
        metrics.bid_depth = metrics.total_bid_qty
        metrics.ask_depth = metrics.total_ask_qty
        
        if metrics.delta > 0:
            metrics.buy_domination = True
            metrics.delta_trend = "BULLISH"
        elif metrics.delta < 0:
            metrics.sell_domination = True
            metrics.delta_trend = "BEARISH"
        else:
            metrics.delta_trend = "NEUTRAL"
        
        return metrics

    def _process_from_price_action(self, metrics: OrderFlowMetrics,
                                    symbol: str, price: float,
                                    volume: int, oi: int) -> OrderFlowMetrics:
        """
        Derive order flow metrics from price momentum when depth is unavailable.
        Uses multi-timeframe tick direction, velocity, acceleration, and volume
        to estimate buying vs selling pressure — specifically for INDEX instruments.
        Designed for FAST, VISIBLE changes on every tick.
        """
        if symbol not in self._price_history:
            self._price_history[symbol] = deque(maxlen=100)
            self._volume_history[symbol] = deque(maxlen=100)

        history = self._price_history[symbol]
        vol_history = self._volume_history[symbol]
        history.append(price)
        vol_history.append(volume)

        # Need at least a few ticks to compute momentum
        if len(history) < 3 or price <= 0:
            metrics.delta_trend = "NEUTRAL"
            return metrics

        # ── MULTI-TIMEFRAME MOMENTUM ──
        # Short window (last 5 ticks): captures instant direction
        short = list(history)[-5:]
        short_up = sum(1 for i in range(1, len(short)) if short[i] > short[i - 1])
        short_down = sum(1 for i in range(1, len(short)) if short[i] < short[i - 1])
        short_moves = short_up + short_down or 1

        # Medium window (last 15 ticks): captures trend
        medium = list(history)[-15:]
        med_up = sum(1 for i in range(1, len(medium)) if medium[i] > medium[i - 1])
        med_down = sum(1 for i in range(1, len(medium)) if medium[i] < medium[i - 1])
        med_moves = med_up + med_down or 1

        # Blend: 60% short-term, 40% medium-term for responsiveness
        buyer_ratio = 0.6 * (short_up / short_moves) + 0.4 * (med_up / med_moves)
        seller_ratio = 1.0 - buyer_ratio

        # ── LAST TICK DIRECTION (immediate response) ──
        last_change = price - list(history)[-2]
        tick_direction = 1.0 if last_change > 0 else (-1.0 if last_change < 0 else 0.0)

        # ── VELOCITY: how fast price is moving (short window) ──
        short_price_change = short[-1] - short[0]
        short_range = max(short) - min(short) if (max(short) - min(short)) > 0 else 1
        velocity = short_price_change / short_range  # -1.0 to +1.0

        # ── ACCELERATION: is momentum increasing? ──
        if len(history) >= 6:
            prev_velocity_prices = list(history)[-6:-1]
            prev_change = prev_velocity_prices[-1] - prev_velocity_prices[0]
            prev_range = max(prev_velocity_prices) - min(prev_velocity_prices) if (max(prev_velocity_prices) - min(prev_velocity_prices)) > 0 else 1
            prev_velocity = prev_change / prev_range
            acceleration = velocity - prev_velocity  # positive = accelerating up
        else:
            acceleration = 0.0

        # ── SYNTHETIC BID/ASK ──
        half_spread = price * 0.00025
        metrics.bid = round(price - half_spread, 2)
        metrics.ask = round(price + half_spread, 2)
        metrics.spread = round(metrics.ask - metrics.bid, 2)
        metrics.spread_pct = round((metrics.spread / price) * 100, 4) if price > 0 else 0

        # ── DYNAMIC QUANTITIES ──
        # Base scales with index level (BANKNIFTY ~52K needs bigger base than NIFTY ~23K)
        base_qty = max(3000, int(price * 0.15))  # ~3450 for NIFTY, ~7900 for BANKNIFTY

        # Buy/sell pressure: combine momentum + velocity + tick direction + acceleration
        # Each factor amplifies the dominant side
        buy_pressure = (
            buyer_ratio * 1.0                          # momentum direction
            + max(velocity, 0) * 0.6                   # positive velocity boosts buyers
            + max(tick_direction, 0) * 0.3             # last tick up boosts buyers
            + max(acceleration, 0) * 0.3               # accelerating up boosts buyers
        )
        sell_pressure = (
            seller_ratio * 1.0
            + max(-velocity, 0) * 0.6
            + max(-tick_direction, 0) * 0.3
            + max(-acceleration, 0) * 0.3
        )

        # Amplify difference: make dominant side 1.5-3x larger than passive side
        total_pressure = buy_pressure + sell_pressure or 1
        buy_norm = buy_pressure / total_pressure   # 0-1
        sell_norm = sell_pressure / total_pressure  # 0-1

        # Amplification: exaggerate the difference for visual impact
        amplifier = 1.8
        buy_amp = buy_norm ** (1.0 / amplifier)    # >0.5 gets boosted
        sell_amp = sell_norm ** (1.0 / amplifier)

        # Per-level variation: deeper levels get 15% less per step
        metrics.bid_levels = []
        metrics.ask_levels = []
        for i in range(5):
            depth_decay = 1.0 - i * 0.15

            bid_qty = int(base_qty * buy_amp * depth_decay * (1.2 + abs(velocity) * 0.5))
            bid_orders = max(int(bid_qty / 120), 3)
            metrics.bid_levels.append({
                'price': round(metrics.bid - i * half_spread * 2, 2),
                'quantity': max(bid_qty, 100),
                'orders': max(bid_orders, 3),
            })

            ask_qty = int(base_qty * sell_amp * depth_decay * (1.2 + abs(velocity) * 0.5))
            ask_orders = max(int(ask_qty / 120), 3)
            metrics.ask_levels.append({
                'price': round(metrics.ask + i * half_spread * 2, 2),
                'quantity': max(ask_qty, 100),
                'orders': max(ask_orders, 3),
            })

        metrics.total_bid_qty = sum(l['quantity'] for l in metrics.bid_levels)
        metrics.total_ask_qty = sum(l['quantity'] for l in metrics.ask_levels)
        metrics.total_bid_orders = sum(l['orders'] for l in metrics.bid_levels)
        metrics.total_ask_orders = sum(l['orders'] for l in metrics.ask_levels)

        metrics.delta = metrics.total_bid_qty - metrics.total_ask_qty
        total_qty = metrics.total_bid_qty + metrics.total_ask_qty
        if total_qty > 0:
            metrics.buyer_aggression = metrics.total_bid_qty / total_qty
            metrics.seller_aggression = metrics.total_ask_qty / total_qty
            metrics.liquidity_imbalance = metrics.delta / total_qty

        metrics.bid_depth = metrics.total_bid_qty
        metrics.ask_depth = metrics.total_ask_qty

        # Domination thresholds: responsive to short-term momentum
        if buyer_ratio > 0.52 and velocity > 0.05:
            metrics.buy_domination = True
            metrics.delta_trend = "BULLISH"
        elif seller_ratio > 0.52 and velocity < -0.05:
            metrics.sell_domination = True
            metrics.delta_trend = "BEARISH"
        else:
            metrics.delta_trend = "NEUTRAL"

        return metrics
    
    def _generate_signal(self, metrics: OrderFlowMetrics, symbol: str, tick: Dict) -> OrderFlowMetrics:
        """Generate buy/sell signal based on order flow analysis."""
        
        try:
            # Get historical context (short window for responsiveness)
            recent_history = list(self.symbol_history[symbol])[-10:] if symbol in self.symbol_history else []
            
            # Signal generation logic — responsive thresholds
            if metrics.buyer_aggression > 0.60 and metrics.delta > 0:
                if recent_history and sum(1 for m in recent_history[-5:] if m.delta >= 0) >= 4:
                    metrics.signal = "STRONG_BUY"
                    metrics.signal_confidence = min(metrics.buyer_aggression * 1.1, 1.0)
                else:
                    metrics.signal = "BUY"
                    metrics.signal_confidence = min(metrics.buyer_aggression * 0.85, 0.95)
                    
            elif metrics.seller_aggression > 0.60 and metrics.delta < 0:
                if recent_history and sum(1 for m in recent_history[-5:] if m.delta <= 0) >= 4:
                    metrics.signal = "STRONG_SELL"
                    metrics.signal_confidence = min(metrics.seller_aggression * 1.1, 1.0)
                else:
                    metrics.signal = "SELL"
                    metrics.signal_confidence = min(metrics.seller_aggression * 0.85, 0.95)
            else:
                metrics.signal = "HOLD"
                metrics.signal_confidence = 0.5
            
            # Override with volume spike detection
            current_volume = tick.get('volume_traded', 0)
            if recent_history:
                avg_volume = sum(m.total_bid_qty + m.total_ask_qty for m in recent_history) / len(recent_history)
                current_total = metrics.total_bid_qty + metrics.total_ask_qty
                
                if current_total > avg_volume * 1.5:  # 50% spike
                    if metrics.buy_domination:
                        metrics.signal = "STRONG_BUY"
                        metrics.signal_confidence = 0.9
                    else:
                        metrics.signal = "STRONG_SELL"
                        metrics.signal_confidence = 0.9
            
        except Exception as e:
            print(f"⚠️ Error generating signal: {e}")
        
        return metrics
    
    def get_current_metrics(self, symbol: str) -> Dict[str, Any]:
        """Get current order flow metrics as JSON-serializable dict."""
        with self.lock:
            metrics = self.current_metrics.get(symbol)
        
        if not metrics:
            return {}
        
        # Get 5-min prediction
        with self.lock:
            prediction = self.windows[symbol].get_5min_prediction()
        
        return {
            "timestamp": metrics.timestamp.isoformat(),
            "bid": round(metrics.bid, 2),
            "ask": round(metrics.ask, 2),
            "spread": round(metrics.spread, 2),
            "spreadPct": round(metrics.spread_pct, 4),
            "bidLevels": metrics.bid_levels,
            "askLevels": metrics.ask_levels,
            "totalBidQty": round(metrics.total_bid_qty, 2),
            "totalAskQty": round(metrics.total_ask_qty, 2),
            "totalBidOrders": metrics.total_bid_orders,
            "totalAskOrders": metrics.total_ask_orders,
            "delta": round(metrics.delta, 2),
            "deltaPercentage": round(metrics.buyer_aggression * 100, 1),
            "deltaTrend": metrics.delta_trend,
            "buyerAggressionRatio": round(metrics.buyer_aggression, 3),
            "sellerAggressionRatio": round(metrics.seller_aggression, 3),
            "liquidityImbalance": round(metrics.liquidity_imbalance, 3),
            "bidDepth": round(metrics.bid_depth, 2),
            "askDepth": round(metrics.ask_depth, 2),
            "buyDomination": metrics.buy_domination,
            "sellDomination": metrics.sell_domination,
            "signal": metrics.signal,
            "signalConfidence": round(metrics.signal_confidence, 2),
            "fiveMinPrediction": prediction
        }
    
    def get_historical_metrics(self, symbol: str, limit: int = 100) -> List[Dict[str, Any]]:
        """Get historical order flow metrics for the symbol."""
        with self.lock:
            history = list(self.symbol_history[symbol])[-limit:]
        
        return [
            {
                "timestamp": m.timestamp.isoformat(),
                "delta": round(m.delta, 2),
                "buyerAggression": round(m.buyer_aggression, 3),
                "sellerAggression": round(m.seller_aggression, 3),
                "signal": m.signal,
                "confidence": round(m.signal_confidence, 2)
            }
            for m in history
        ]


# Global analyzer instance
order_flow_analyzer = OrderFlowAnalyzer()
