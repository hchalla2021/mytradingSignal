"""
🏢 INSTITUTIONAL FLOW TRACKER
Advanced tracking of institutional order patterns, positioning, and market impact.

Features:
- Order cluster identification
- Institutional positioning tracking
- Market impact analysis
- Liquidity hunting detection
- Breakout probability scoring
- Support/resistance identification
- Risk level assessment
"""

import asyncio
import threading
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple
from collections import deque
import pytz
import math
from dataclasses import dataclass

from config.market_session import get_market_session

market_config = get_market_session()
IST = pytz.timezone(market_config.TIMEZONE)


@dataclass
class OrderCluster:
    """Represents a cluster of orders at similar price levels."""
    center_price: float
    price_range: Tuple[float, float]  # (low, high)
    total_volume: float
    order_count: int
    time_window: Tuple[datetime, datetime]  # (start, end)
    intensity: float  # 0-1, how concentrated
    direction: str  # BUY, SELL, MIXED
    impact_score: float  # Estimated market impact


@dataclass
class InstitutionalPosition:
    """Tracks estimated institutional positioning."""
    symbol: str
    timestamp: datetime
    accumulated_buy_volume: float
    accumulated_sell_volume: float
    net_position: float  # Positive = net long, negative = net short
    position_confidence: float
    accumulation_zones: List[float]  # Price levels where buying concentrated
    distribution_zones: List[float]  # Price levels where selling concentrated
    estimated_participants: int


@dataclass
class BreakoutScenario:
    """Breakout probability analysis."""
    direction: str  # UP, DOWN
    probability: float  # 0-1
    key_level: float
    volume_required: float
    expected_move: float
    time_frame: str  # 5min, 15min, etc.
    risk_reward_ratio: float


class InstitutionalFlowTracker:
    """
    Real-time tracker of institutional order flows, positioning, and market structure.
    Designed for detecting smart money activity at scale.
    """
    
    def __init__(self):
        self.clusters: Dict[str, deque] = {
            s: deque(maxlen=100) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        self.positions: Dict[str, InstitutionalPosition] = {}
        self.support_resistance: Dict[str, Dict[str, List[float]]] = {
            s: {'support': [], 'resistance': []}
            for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        self.price_history: Dict[str, deque] = {
            s: deque(maxlen=1000) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        self.volume_history: Dict[str, deque] = {
            s: deque(maxlen=1000) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        self.market_structure: Dict[str, Dict[str, Any]] = {
            s: self._create_empty_structure() for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        
        self.lock = threading.Lock()
        print("✅ InstitutionalFlowTracker initialized")
    
    def _create_empty_structure(self) -> Dict[str, Any]:
        """Create empty market structure."""
        return {
            'trend': 'NEUTRAL',
            'structure_strength': 0.0,
            'higher_highs': 0,
            'higher_lows': 0,
            'lower_highs': 0,
            'lower_lows': 0,
            'breakout_probability': 0.0
        }
    
    async def track_order_flow(self, tick: Dict[str, Any], symbol: str,
                               order_metrics: Dict[str, Any]) -> OrderCluster:
        """
        Track order flows and create clusters.
        
        Args:
            tick: Zerodha tick data
            symbol: Trading symbol
            order_metrics: Order flow metrics from analyzer
            
        Returns:
            Identified order cluster
        """
        try:
            current_price = tick.get('last_price', 0)
            bid_qty = order_metrics.get('totalBidQty', 0)
            ask_qty = order_metrics.get('totalAskQty', 0)
            buyer_agg = order_metrics.get('buyerAggressionRatio', 0.5)
            
            # Update histories
            with self.lock:
                self.price_history[symbol].append(current_price)
                self.volume_history[symbol].append(bid_qty + ask_qty)
            
            # Identify order cluster
            cluster = await self._identify_cluster(
                symbol, current_price, bid_qty, ask_qty, buyer_agg
            )
            
            # Update support/resistance
            await self._update_support_resistance(symbol, current_price)
            
            # Update market structure
            await self._update_market_structure(symbol)
            
            # Update institutional positioning
            await self._update_positioning(symbol, cluster)
            
            return cluster
            
        except Exception as e:
            print(f"❌ Error tracking order flow for {symbol}: {e}")
            return self._create_empty_cluster(symbol)
    
    async def _identify_cluster(self, symbol: str, current_price: float,
                                bid_qty: float, ask_qty: float,
                                buyer_agg: float) -> OrderCluster:
        """
        Identify if current tick is part of an order cluster.
        A cluster is defined as multiple large orders within a price range.
        """
        direction = 'BUY' if buyer_agg > 0.55 else 'SELL' if buyer_agg < 0.45 else 'MIXED'
        
        # Estimate intensity based on volume concentration
        total_qty = bid_qty + ask_qty
        intensity = min(abs(buyer_agg - 0.5) * 2, 1.0)  # Max 1.0 at extreme imbalance
        
        # Create cluster
        cluster = OrderCluster(
            center_price=current_price,
            price_range=(current_price * 0.995, current_price * 1.005),  # ±0.5%
            total_volume=total_qty,
            order_count=int(total_qty / 100) if total_qty > 0 else 0,  # Estimate
            time_window=(datetime.now(IST), datetime.now(IST)),
            intensity=intensity,
            direction=direction,
            impact_score=await self._calculate_impact_score(symbol, total_qty)
        )
        
        # Store cluster
        with self.lock:
            self.clusters[symbol].append(cluster)
        
        return cluster
    
    async def _calculate_impact_score(self, symbol: str, volume: float) -> float:
        """
        Calculate estimated market impact of this order.
        Higher impact = larger order relative to average.
        """
        with self.lock:
            history = list(self.volume_history.get(symbol, []))
        
        if not history or len(history) < 10:
            return 0.5
        
        avg_volume = sum(history[-10:]) / 10
        
        if avg_volume == 0:
            return 0.5
        
        impact = min(volume / avg_volume, 3.0) / 3.0  # Normalize to 0-1
        return impact
    
    async def _update_support_resistance(self, symbol: str, current_price: float):
        """
        Update support and resistance levels based on price action and volume.
        """
        with self.lock:
            history = list(self.price_history.get(symbol, []))[-100:]
        
        if not history:
            return
        
        # Find support (local lows with volume)
        support_levels = []
        resistance_levels = []
        
        # Identify extremes
        highs = [price for i, price in enumerate(history)
                 if i > 0 and i < len(history) - 1
                 and price >= history[i-1] and price >= history[i+1]]
        
        lows = [price for i, price in enumerate(history)
                if i > 0 and i < len(history) - 1
                and price <= history[i-1] and price <= history[i+1]]
        
        if lows:
            support_levels = sorted(set(lows))[-3:]  # Last 3 unique support levels
        
        if highs:
            resistance_levels = sorted(set(highs), reverse=True)[-3:]
        
        with self.lock:
            self.support_resistance[symbol] = {
                'support': support_levels,
                'resistance': resistance_levels
            }
    
    async def _update_market_structure(self, symbol: str):
        """
        Analyze market structure: higher highs, higher lows, etc.
        Determines trend direction and structure strength.
        """
        with self.lock:
            history = list(self.price_history.get(symbol, []))[-100:]
        
        if len(history) < 10:
            return
        
        # Split into two halves
        mid = len(history) // 2
        first_half = history[:mid]
        second_half = history[mid:]
        
        first_high = max(first_half) if first_half else 0
        first_low = min(first_half) if first_half else 0
        second_high = max(second_half) if second_half else 0
        second_low = min(second_half) if second_half else 0
        
        # Count higher highs / lows
        higher_highs = 1 if second_high > first_high else 0
        higher_lows = 1 if second_low > first_low else 0
        lower_highs = 1 if second_high < first_high else 0
        lower_lows = 1 if second_low < first_low else 0
        
        # Determine trend
        if higher_highs and higher_lows:
            trend = 'UPTREND'
            strength = 0.8
        elif lower_highs and lower_lows:
            trend = 'DOWNTREND'
            strength = 0.8
        else:
            trend = 'NEUTRAL'
            strength = 0.4
        
        # Calculate breakout probability
        current_price = history[-1] if history else 0
        breakout_prob = await self._calculate_breakout_probability(
            symbol, current_price, second_high, second_low
        )
        
        with self.lock:
            self.market_structure[symbol] = {
                'trend': trend,
                'structure_strength': strength,
                'higher_highs': higher_highs,
                'higher_lows': higher_lows,
                'lower_highs': lower_highs,
                'lower_lows': lower_lows,
                'breakout_probability': breakout_prob
            }
    
    async def _calculate_breakout_probability(self, symbol: str,
                                             current_price: float,
                                             recent_high: float,
                                             recent_low: float) -> float:
        """
        Calculate probability of breakout based on volatility and positioning.
        """
        with self.lock:
            volumes = list(self.volume_history.get(symbol, []))[-50:]
        
        if not volumes:
            return 0.5
        
        avg_volume = sum(volumes) / len(volumes)
        current_volume = volumes[-1] if volumes else avg_volume
        
        # Higher volume near extremes = higher breakout probability
        if current_price >= recent_high * 0.99:  # Near high
            prob = min(current_volume / avg_volume * 0.5, 0.9)
        elif current_price <= recent_low * 1.01:  # Near low
            prob = min(current_volume / avg_volume * 0.5, 0.9)
        else:
            prob = 0.3
        
        return prob
    
    async def _update_positioning(self, symbol: str, cluster: OrderCluster):
        """
        Update estimated institutional positioning based on order clusters.
        """
        with self.lock:
            clusters = list(self.clusters.get(symbol, []))[-50:]
        
        if not clusters:
            return
        
        # Aggregate buy/sell volume
        buy_volume = sum(c.total_volume for c in clusters if c.direction == 'BUY')
        sell_volume = sum(c.total_volume for c in clusters if c.direction == 'SELL')
        
        net_position = buy_volume - sell_volume
        total_volume = buy_volume + sell_volume
        
        confidence = min(abs(net_position) / max(total_volume, 1) * 2, 1.0)
        
        # Identify accumulation vs distribution zones
        buy_clusters = [c for c in clusters if c.direction == 'BUY']
        sell_clusters = [c for c in clusters if c.direction == 'SELL']
        
        acc_zones = [c.center_price for c in buy_clusters[-5:]]
        dist_zones = [c.center_price for c in sell_clusters[-5:]]
        
        estimated_participants = max(len(clusters) // 5, 1)
        
        with self.lock:
            self.positions[symbol] = InstitutionalPosition(
                symbol=symbol,
                timestamp=datetime.now(IST),
                accumulated_buy_volume=buy_volume,
                accumulated_sell_volume=sell_volume,
                net_position=net_position,
                position_confidence=confidence,
                accumulation_zones=acc_zones,
                distribution_zones=dist_zones,
                estimated_participants=estimated_participants
            )
    
    def get_current_clusters(self, symbol: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Get recent order clusters."""
        with self.lock:
            clusters = list(self.clusters.get(symbol, []))[-limit:]
        
        return [
            {
                'centerPrice': round(c.center_price, 2),
                'priceRange': [round(c.price_range[0], 2), round(c.price_range[1], 2)],
                'totalVolume': round(c.total_volume, 2),
                'orderCount': c.order_count,
                'intensity': round(c.intensity, 3),
                'direction': c.direction,
                'impactScore': round(c.impact_score, 2),
                'timestamp': c.time_window[0].isoformat()
            }
            for c in clusters
        ]
    
    def get_market_structure(self, symbol: str) -> Dict[str, Any]:
        """Get market structure analysis."""
        with self.lock:
            structure = self.market_structure.get(symbol, {})
            support_res = self.support_resistance.get(symbol, {})
        
        return {
            'symbol': symbol,
            'timestamp': datetime.now(IST).isoformat(),
            'trend': structure.get('trend', 'NEUTRAL'),
            'structureStrength': round(structure.get('structure_strength', 0.0), 2),
            'breakoutProbability': round(structure.get('breakout_probability', 0.0), 2),
            'supportLevels': [round(p, 2) for p in support_res.get('support', [])],
            'resistanceLevels': [round(p, 2) for p in support_res.get('resistance', [])]
        }
    
    def get_institutional_positioning(self, symbol: str) -> Dict[str, Any]:
        """Get estimated institutional positioning."""
        with self.lock:
            position = self.positions.get(symbol)
        
        if not position:
            return {}
        
        return {
            'symbol': position.symbol,
            'timestamp': position.timestamp.isoformat(),
            'accumulatedBuyVolume': round(position.accumulated_buy_volume, 2),
            'accumulatedSellVolume': round(position.accumulated_sell_volume, 2),
            'netPosition': round(position.net_position, 2),
            'positionConfidence': round(position.position_confidence, 2),
            'accumulationZones': [round(p, 2) for p in position.accumulation_zones],
            'distributionZones': [round(p, 2) for p in position.distribution_zones],
            'estimatedParticipants': position.estimated_participants
        }
    
    def _create_empty_cluster(self, symbol: str) -> OrderCluster:
        """Create empty cluster."""
        return OrderCluster(
            center_price=0,
            price_range=(0, 0),
            total_volume=0,
            order_count=0,
            time_window=(datetime.now(IST), datetime.now(IST)),
            intensity=0,
            direction='MIXED',
            impact_score=0
        )


# Global tracker instance
institutional_flow_tracker = InstitutionalFlowTracker()
