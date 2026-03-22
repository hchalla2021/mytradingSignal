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
                "reasoning": "Insufficient data"
            }
        
        # Calculate prediction metrics from window
        avg_delta = self.running_delta / len(windowed) if windowed else 0
        buy_signals = sum(1 for m in windowed if m.buy_domination)
        sell_signals = sum(1 for m in windowed if m.sell_domination)
        
        buy_ratio = buy_signals / len(windowed) if windowed else 0
        sell_ratio = sell_signals / len(windowed) if windowed else 0
        
        # Determine direction and confidence
        if avg_delta > 0 and buy_ratio > 0.6:
            direction = "STRONG_BUY"
            confidence = min(buy_ratio, 1.0)
            reasoning = f"Positive delta + {int(buy_ratio*100)}% buy dominance"
        elif avg_delta > 0 and buy_ratio > 0.55:
            direction = "BUY"
            confidence = buy_ratio * 0.7
            reasoning = "Mild positive delta"
        elif avg_delta < 0 and sell_ratio > 0.6:
            direction = "STRONG_SELL"
            confidence = min(sell_ratio, 1.0)
            reasoning = f"Negative delta + {int(sell_ratio*100)}% sell dominance"
        elif avg_delta < 0 and sell_ratio > 0.55:
            direction = "SELL"
            confidence = sell_ratio * 0.7
            reasoning = "Mild negative delta"
        else:
            direction = "NEUTRAL"
            confidence = 0.3
            reasoning = "Mixed signals"
        
        return {
            "direction": direction,
            "confidence": round(confidence, 2),
            "reasoning": reasoning,
            "tick_count": len(windowed),
            "avg_delta": round(avg_delta, 2),
            "buy_dominance_pct": round(buy_ratio * 100, 1),
            "sell_dominance_pct": round(sell_ratio * 100, 1)
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
        
        # Initialize windows for each symbol
        for symbol in ["NIFTY", "BANKNIFTY", "SENSEX"]:
            self.windows[symbol] = OrderFlowWindow(window_seconds=300)  # 5-minute window
            self.current_metrics[symbol] = OrderFlowMetrics()
        
        print("✅ OrderFlowAnalyzer initialized")

    async def process_zerodha_tick(self, tick: Dict[str, Any], symbol: str) -> OrderFlowMetrics:
        """
        Process a Zerodha KiteTicker tick and generate order flow metrics.
        
        Expects tick to contain:
            - last_price
            - bid, ask (top bid/ask prices)
            - depth {buy: [{price, quantity, orders}, ...], sell: [...]}
            - volume_traded (total volume at current price)
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
            
            # Process bid levels (buy side)
            metrics.bid_levels = [
                {
                    'price': level.get('price', 0),
                    'quantity': level.get('quantity', 0),
                    'orders': level.get('orders', 0)
                }
                for level in buy_levels[:5]  # Top 5 levels
            ]
            
            # Process ask levels (sell side)
            metrics.ask_levels = [
                {
                    'price': level.get('price', 0),
                    'quantity': level.get('quantity', 0),
                    'orders': level.get('orders', 0)
                }
                for level in sell_levels[:5]  # Top 5 levels
            ]
            
            # Calculate cumulative quantities
            metrics.total_bid_qty = sum(level['quantity'] for level in metrics.bid_levels)
            metrics.total_ask_qty = sum(level['quantity'] for level in metrics.ask_levels)
            metrics.total_bid_orders = sum(level['orders'] for level in metrics.bid_levels)
            metrics.total_ask_orders = sum(level['orders'] for level in metrics.ask_levels)
            
            # Calculate delta
            metrics.delta = metrics.total_bid_qty - metrics.total_ask_qty
            
            # Calculate aggression ratios
            total_qty = metrics.total_bid_qty + metrics.total_ask_qty
            if total_qty > 0:
                metrics.buyer_aggression = metrics.total_bid_qty / total_qty
                metrics.seller_aggression = metrics.total_ask_qty / total_qty
            
            # Liquidity imbalance
            if total_qty > 0:
                metrics.liquidity_imbalance = (metrics.total_bid_qty - metrics.total_ask_qty) / total_qty
            
            # Bid/ask depth
            metrics.bid_depth = metrics.total_bid_qty
            metrics.ask_depth = metrics.total_ask_qty
            
            # Determine domination signals
            if metrics.delta > 0:
                metrics.buy_domination = True
                metrics.sell_domination = False
                metrics.delta_trend = "BULLISH"
            elif metrics.delta < 0:
                metrics.buy_domination = False
                metrics.sell_domination = True
                metrics.delta_trend = "BEARISH"
            else:
                metrics.delta_trend = "NEUTRAL"
            
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
    
    def _generate_signal(self, metrics: OrderFlowMetrics, symbol: str, tick: Dict) -> OrderFlowMetrics:
        """Generate buy/sell signal based on order flow analysis."""
        
        try:
            # Get historical context
            recent_history = list(self.symbol_history[symbol])[-20:] if symbol in self.symbol_history else []
            
            # Signal generation logic
            if metrics.buyer_aggression > 0.65 and metrics.delta > 0:
                if recent_history and all(m.delta >= 0 for m in recent_history[-5:]):
                    metrics.signal = "STRONG_BUY"
                    metrics.signal_confidence = min(metrics.buyer_aggression, 1.0)
                else:
                    metrics.signal = "BUY"
                    metrics.signal_confidence = metrics.buyer_aggression * 0.7
                    
            elif metrics.seller_aggression > 0.65 and metrics.delta < 0:
                if recent_history and all(m.delta <= 0 for m in recent_history[-5:]):
                    metrics.signal = "STRONG_SELL"
                    metrics.signal_confidence = min(metrics.seller_aggression, 1.0)
                else:
                    metrics.signal = "SELL"
                    metrics.signal_confidence = metrics.seller_aggression * 0.7
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
