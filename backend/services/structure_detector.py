"""
🏗️ STRUCTURE DETECTOR SERVICE
Advanced market structure pattern recognition and analysis.

Features:
- Fractal detection (higher highs/lows, lower highs/lows)
- Supply/demand zone identification
- Market structure breaks
- Confluence point detection
- Chart pattern recognition
- Price level clustering
- Trend confirmations
"""

import asyncio
import threading
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple
from collections import deque
import pytz
from dataclasses import dataclass, field
import statistics

from config.market_session import get_market_session

market_config = get_market_session()
IST = pytz.timezone(market_config.TIMEZONE)


@dataclass
class StructureLevel:
    """A significant price level in market structure."""
    price: float
    level_type: str  # SUPPORT, RESISTANCE, PIVOT
    strength: float  # 0-1, how many times tested
    test_count: int  # Number of times price tested this level
    last_tested: datetime
    price_rejection: float  # How far price bounced from level


@dataclass
class SupplyDemandZone:
    """Institutional supply/demand zone."""
    zone_type: str  # SUPPLY or DEMAND
    high: float
    low: float
    mid: float  # Midpoint of zone
    width: float  # Price range of zone
    strength: float  # 0-1
    breakouts_from_zone: int  # How many times broken out
    volume_in_zone: float  # Volume traded in this zone
    first_formed: datetime
    last_tested: datetime
    confluence_count: int  # How many other signals at this level


@dataclass
class MarketStructureReport:
    """Complete market structure analysis."""
    symbol: str
    timestamp: datetime
    primary_trend: str  # UPTREND, DOWNTREND, NEUTRAL
    secondary_trend: str  # Short-term direction
    structure_strength: float  # 0-1
    support_levels: List[StructureLevel]
    resistance_levels: List[StructureLevel]
    key_price_levels: List[float]
    supply_zones: List[SupplyDemandZone]
    demand_zones: List[SupplyDemandZone]
    fractals_bullish: int  # Count of bullish fractals
    fractals_bearish: int  # Count of bearish fractals
    structure_breaks: List[Dict[str, Any]]
    confluence_points: List[Dict[str, Any]]
    immediate_support: Optional[float]
    immediate_resistance: Optional[float]
    next_support: Optional[float]
    next_resistance: Optional[float]


class StructureDetector:
    """
    Advanced market structure detector using institutional-grade analysis.
    Identifies support/resistance, supply/demand zones, and structure patterns.
    """
    
    def __init__(self, zone_width_pct: float = 0.5, min_touches: int = 2):
        self.zone_width_pct = zone_width_pct  # Zone width as % of price
        self.min_touches = min_touches  # Minimum touches to confirm level
        
        # Price data
        self.price_data: Dict[str, deque] = {
            s: deque(maxlen=1000) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        self.high_data: Dict[str, deque] = {
            s: deque(maxlen=1000) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        self.low_data: Dict[str, deque] = {
            s: deque(maxlen=1000) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        self.volume_data: Dict[str, deque] = {
            s: deque(maxlen=1000) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        
        # Structure levels
        self.support_levels: Dict[str, List[StructureLevel]] = {
            s: [] for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        self.resistance_levels: Dict[str, List[StructureLevel]] = {
            s: [] for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        
        # Zones
        self.supply_zones: Dict[str, List[SupplyDemandZone]] = {
            s: [] for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        self.demand_zones: Dict[str, List[SupplyDemandZone]] = {
            s: [] for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        
        # Structure reports
        self.current_reports: Dict[str, MarketStructureReport] = {}
        
        self.lock = threading.Lock()
        print("✅ StructureDetector initialized")
    
    async def update_market_structure(self, tick: Dict[str, Any], 
                                      symbol: str) -> MarketStructureReport:
        """
        Update market structure analysis with new tick.
        
        Args:
            tick: Price tick data
            symbol: Trading symbol
            
        Returns:
            Updated MarketStructureReport
        """
        try:
            # Update histories
            with self.lock:
                self.price_data[symbol].append(tick.get('last_price', 0))
                self.high_data[symbol].append(tick.get('high', 0))
                self.low_data[symbol].append(tick.get('low', 0))
                self.volume_data[symbol].append(tick.get('volume_traded', 0))
            
            # Detect structure levels
            await self._identify_structure_levels(symbol)
            
            # Identify supply/demand zones
            await self._identify_zones(symbol)
            
            # Analyze fractals
            bullish_fractals, bearish_fractals = await self._analyze_fractals(symbol)
            
            # Find confluence points
            confluence_points = await self._find_confluence_points(symbol)
            
            # Detect structure breaks
            structure_breaks = await self._detect_structure_breaks(symbol)
            
            # Generate report
            report = await self._generate_structure_report(
                symbol, bullish_fractals, bearish_fractals,
                confluence_points, structure_breaks
            )
            
            with self.lock:
                self.current_reports[symbol] = report
            
            return report
            
        except Exception as e:
            print(f"❌ Error updating structure for {symbol}: {e}")
            return self._create_empty_report(symbol)
    
    async def _identify_structure_levels(self, symbol: str):
        """
        Identify support and resistance levels from price history.
        Uses pivot points, local extremes, and clustering.
        """
        with self.lock:
            prices = list(self.price_data.get(symbol, []))
            highs = list(self.high_data.get(symbol, []))
            lows = list(self.low_data.get(symbol, []))
        
        if len(prices) < 10:
            return
        
        recent_prices = prices[-100:]
        recent_highs = highs[-100:]
        recent_lows = lows[-100:]
        
        # Find local extremes
        local_highs = []
        local_lows = []
        
        for i in range(1, len(recent_highs) - 1):
            # Local high
            if recent_highs[i] > recent_highs[i-1] and recent_highs[i] > recent_highs[i+1]:
                local_highs.append((recent_highs[i], i))
            
            # Local low
            if recent_lows[i] < recent_lows[i-1] and recent_lows[i] < recent_lows[i+1]:
                local_lows.append((recent_lows[i], i))
        
        # Cluster similar prices to find significant levels
        resistance_candidates = [h[0] for h in local_highs]
        support_candidates = [l[0] for l in local_lows]
        
        # Remove duplicates using clustering
        resistance_levels = self._cluster_price_levels(resistance_candidates)
        support_levels = self._cluster_price_levels(support_candidates)
        
        # Create structure level objects
        with self.lock:
            self.resistance_levels[symbol] = [
                StructureLevel(
                    price=level,
                    level_type="RESISTANCE",
                    strength=0.5,
                    test_count=1,
                    last_tested=datetime.now(IST),
                    price_rejection=0.0
                )
                for level in resistance_levels
            ]
            
            self.support_levels[symbol] = [
                StructureLevel(
                    price=level,
                    level_type="SUPPORT",
                    strength=0.5,
                    test_count=1,
                    last_tested=datetime.now(IST),
                    price_rejection=0.0
                )
                for level in support_levels
            ]
    
    def _cluster_price_levels(self, prices: List[float], cluster_threshold: float = 0.1) -> List[float]:
        """
        Cluster similar prices together.
        Returns list of cluster centers.
        """
        if not prices:
            return []
        
        prices_sorted = sorted(set(prices))
        clusters = []
        current_cluster = [prices_sorted[0]]
        
        for price in prices_sorted[1:]:
            # If close to last price in cluster, add to cluster
            if price - current_cluster[-1] <= (current_cluster[-1] * cluster_threshold / 100):
                current_cluster.append(price)
            else:
                # Start new cluster
                clusters.append(statistics.mean(current_cluster))
                current_cluster = [price]
        
        # Add last cluster
        if current_cluster:
            clusters.append(statistics.mean(current_cluster))
        
        return clusters
    
    async def _identify_zones(self, symbol: str):
        """
        Identify supply and demand zones.
        Supply zones: Area where price rejected downward (resistance)
        Demand zones: Area where price rejected upward (support)
        """
        with self.lock:
            prices = list(self.price_data.get(symbol, []))
            volumes = list(self.volume_data.get(symbol, []))
            highs = list(self.high_data.get(symbol, []))
            lows = list(self.low_data.get(symbol, []))
        
        if len(prices) < 50:
            return
        
        # Analyze last 100 bars for zones
        recent_prices = prices[-100:]
        recent_highs = highs[-100:]
        recent_lows = lows[-100:]
        recent_volumes = volumes[-100:]
        
        supply_zones = []
        demand_zones = []
        
        # Find supply zones (high volume rejections at top)
        for i in range(5, len(recent_highs) - 5):
            if recent_highs[i] > recent_highs[i-5:i] and recent_highs[i] > recent_highs[i:i+5]:
                # Found a peak, check if volume sold off after
                volume_at_peak = sum(recent_volumes[max(0, i-2):i+3])
                volume_after = sum(recent_volumes[i+3:min(len(recent_volumes), i+8)])
                
                if volume_after > volume_at_peak:  # Volume selling after peak
                    zone_high = recent_highs[i] * 1.002
                    zone_low = recent_highs[i] * (1 - self.zone_width_pct / 100)
                    
                    supply_zones.append(SupplyDemandZone(
                        zone_type="SUPPLY",
                        high=zone_high,
                        low=zone_low,
                        mid=(zone_high + zone_low) / 2,
                        width=zone_high - zone_low,
                        strength=0.7,
                        breakouts_from_zone=0,
                        volume_in_zone=volume_at_peak,
                        first_formed=datetime.now(IST),
                        last_tested=datetime.now(IST),
                        confluence_count=1
                    ))
        
        # Find demand zones (low volume buying at bottom)
        for i in range(5, len(recent_lows) - 5):
            if recent_lows[i] < recent_lows[i-5:i] and recent_lows[i] < recent_lows[i:i+5]:
                # Found a bottom, check if volume bought after
                volume_at_bottom = sum(recent_volumes[max(0, i-2):i+3])
                volume_after = sum(recent_volumes[i+3:min(len(recent_volumes), i+8)])
                
                if volume_after > volume_at_bottom:  # Volume buying after bottom
                    zone_low = recent_lows[i] * 0.998
                    zone_high = recent_lows[i] * (1 + self.zone_width_pct / 100)
                    
                    demand_zones.append(SupplyDemandZone(
                        zone_type="DEMAND",
                        high=zone_high,
                        low=zone_low,
                        mid=(zone_high + zone_low) / 2,
                        width=zone_high - zone_low,
                        strength=0.7,
                        breakouts_from_zone=0,
                        volume_in_zone=volume_at_bottom,
                        first_formed=datetime.now(IST),
                        last_tested=datetime.now(IST),
                        confluence_count=1
                    ))
        
        with self.lock:
            self.supply_zones[symbol] = supply_zones[-10:]  # Keep last 10
            self.demand_zones[symbol] = demand_zones[-10:]
    
    async def _analyze_fractals(self, symbol: str) -> Tuple[int, int]:
        """
        Analyze fractals (5-bar pattern).
        Bullish fractal: Low with 2 lows higher on each side
        Bearish fractal: High with 2 highs lower on each side
        """
        with self.lock:
            lows = list(self.low_data.get(symbol, []))
            highs = list(self.high_data.get(symbol, []))
        
        if len(lows) < 5 or len(highs) < 5:
            return 0, 0
        
        bullish_count = 0
        bearish_count = 0
        
        # Check last 50 bars
        for i in range(2, len(lows) - 2):
            # Bullish fractal
            if (lows[i] < lows[i-2] and lows[i] < lows[i-1] and
                lows[i] < lows[i+1] and lows[i] < lows[i+2]):
                bullish_count += 1
            
            # Bearish fractal
            if (highs[i] > highs[i-2] and highs[i] > highs[i-1] and
                highs[i] > highs[i+1] and highs[i] > highs[i+2]):
                bearish_count += 1
        
        return bullish_count, bearish_count
    
    async def _find_confluence_points(self, symbol: str) -> List[Dict[str, Any]]:
        """
        Find confluence points where multiple signals align.
        Multiple confluence = stronger level.
        """
        confluence_points = []
        
        with self.lock:
            supports = self.support_levels.get(symbol, [])
            resistances = self.resistance_levels.get(symbol, [])
            supply = self.supply_zones.get(symbol, [])
            demand = self.demand_zones.get(symbol, [])
        
        # Find price levels where multiple signals align
        for support in supports:
            confluence_count = 1
            confluence_sources = ["Support Level"]
            
            # Check if within supply zone
            for s_zone in supply:
                if s_zone.low <= support.price <= s_zone.high:
                    confluence_count += 1
                    confluence_sources.append("Supply Zone")
            
            if confluence_count > 1:
                confluence_points.append({
                    'price': round(support.price, 2),
                    'type': 'CONFLUENCE_SUPPORT',
                    'confluenceCount': confluence_count,
                    'sources': confluence_sources,
                    'strength': min(confluence_count / 3, 1.0)
                })
        
        return confluence_points
    
    async def _detect_structure_breaks(self, symbol: str) -> List[Dict[str, Any]]:
        """
        Detect when price breaks market structure.
        """
        breaks = []
        
        with self.lock:
            prices = list(self.price_data.get(symbol, []))
            supports = self.support_levels.get(symbol, [])
            resistances = self.resistance_levels.get(symbol, [])
        
        if len(prices) < 2:
            return breaks
        
        current_price = prices[-1]
        previous_price = prices[-2]
        
        # Check for break above resistance
        for resistance in resistances:
            if previous_price <= resistance.price and current_price > resistance.price:
                breaks.append({
                    'breakType': 'BREAK_ABOVE_RESISTANCE',
                    'level': round(resistance.price, 2),
                    'currentPrice': round(current_price, 2),
                    'strength': round(resistance.strength, 2),
                    'timestamp': datetime.now(IST).isoformat()
                })
        
        # Check for break below support
        for support in supports:
            if previous_price >= support.price and current_price < support.price:
                breaks.append({
                    'breakType': 'BREAK_BELOW_SUPPORT',
                    'level': round(support.price, 2),
                    'currentPrice': round(current_price, 2),
                    'strength': round(support.strength, 2),
                    'timestamp': datetime.now(IST).isoformat()
                })
        
        return breaks
    
    async def _generate_structure_report(self, symbol: str,
                                        bullish_fractals: int,
                                        bearish_fractals: int,
                                        confluence_points: List[Dict[str, Any]],
                                        structure_breaks: List[Dict[str, Any]]) -> MarketStructureReport:
        """
        Generate comprehensive market structure report.
        """
        with self.lock:
            prices = list(self.price_data.get(symbol, []))
            supports = self.support_levels.get(symbol, [])
            resistances = self.resistance_levels.get(symbol, [])
            supply_zones = self.supply_zones.get(symbol, [])
            demand_zones = self.demand_zones.get(symbol, [])
        
        if not prices:
            return self._create_empty_report(symbol)
        
        current_price = prices[-1]
        
        # Sort levels
        supports_sorted = sorted(supports, key=lambda x: x.price, reverse=True)
        resistances_sorted = sorted(resistances, key=lambda x: x.price)
        
        # Immediate support/resistance
        immediate_support = next((s.price for s in supports_sorted if s.price < current_price), None)
        immediate_resistance = next((r.price for r in resistances_sorted if r.price > current_price), None)
        next_support = supports_sorted[1].price if len(supports_sorted) > 1 else None
        next_resistance = resistances_sorted[1].price if len(resistances_sorted) > 1 else None
        
        # Determine primary trend
        if bullish_fractals > bearish_fractals:
            primary_trend = "UPTREND"
        elif bearish_fractals > bullish_fractals:
            primary_trend = "DOWNTREND"
        else:
            primary_trend = "NEUTRAL"
        
        # Calculate structure strength
        structure_strength = (len(supports) + len(resistances)) / 10
        structure_strength = min(structure_strength, 1.0)
        
        return MarketStructureReport(
            symbol=symbol,
            timestamp=datetime.now(IST),
            primary_trend=primary_trend,
            secondary_trend="NEUTRAL",
            structure_strength=structure_strength,
            support_levels=supports_sorted[:5],
            resistance_levels=resistances_sorted[:5],
            key_price_levels=[s.price for s in supports_sorted[:3]] + 
                             [r.price for r in resistances_sorted[:3]],
            supply_zones=supply_zones,
            demand_zones=demand_zones,
            fractals_bullish=bullish_fractals,
            fractals_bearish=bearish_fractals,
            structure_breaks=structure_breaks,
            confluence_points=confluence_points,
            immediate_support=immediate_support,
            immediate_resistance=immediate_resistance,
            next_support=next_support,
            next_resistance=next_resistance
        )
    
    def _create_empty_report(self, symbol: str) -> MarketStructureReport:
        """Create empty structure report."""
        return MarketStructureReport(
            symbol=symbol,
            timestamp=datetime.now(IST),
            primary_trend="NEUTRAL",
            secondary_trend="NEUTRAL",
            structure_strength=0.0,
            support_levels=[],
            resistance_levels=[],
            key_price_levels=[],
            supply_zones=[],
            demand_zones=[],
            fractals_bullish=0,
            fractals_bearish=0,
            structure_breaks=[],
            confluence_points=[],
            immediate_support=None,
            immediate_resistance=None,
            next_support=None,
            next_resistance=None
        )
    
    def get_structure_report(self, symbol: str) -> Dict[str, Any]:
        """Get current structure report as JSON."""
        with self.lock:
            report = self.current_reports.get(symbol)
        
        if not report:
            return {}
        
        return {
            'symbol': report.symbol,
            'timestamp': report.timestamp.isoformat(),
            'primaryTrend': report.primary_trend,
            'secondaryTrend': report.secondary_trend,
            'structureStrength': round(report.structure_strength, 2),
            'supportLevels': [
                {
                    'price': round(s.price, 2),
                    'strength': round(s.strength, 2),
                    'testCount': s.test_count
                }
                for s in report.support_levels
            ],
            'resistanceLevels': [
                {
                    'price': round(r.price, 2),
                    'strength': round(r.strength, 2),
                    'testCount': r.test_count
                }
                for r in report.resistance_levels
            ],
            'keyPriceLevels': [round(p, 2) for p in report.key_price_levels],
            'supplyZones': [
                {
                    'high': round(z.high, 2),
                    'low': round(z.low, 2),
                    'mid': round(z.mid, 2),
                    'strength': round(z.strength, 2),
                    'confluenceCount': z.confluence_count
                }
                for z in report.supply_zones
            ],
            'demandZones': [
                {
                    'high': round(z.high, 2),
                    'low': round(z.low, 2),
                    'mid': round(z.mid, 2),
                    'strength': round(z.strength, 2),
                    'confluenceCount': z.confluence_count
                }
                for z in report.demand_zones
            ],
            'fractalsBullish': report.fractals_bullish,
            'fractalsBearish': report.fractals_bearish,
            'structureBreaks': report.structure_breaks,
            'confluencePoints': report.confluence_points,
            'immediateSupport': round(report.immediate_support, 2) if report.immediate_support else None,
            'immediateResistance': round(report.immediate_resistance, 2) if report.immediate_resistance else None,
            'nextSupport': round(report.next_support, 2) if report.next_support else None,
            'nextResistance': round(report.next_resistance, 2) if report.next_resistance else None
        }


# Global detector instance
structure_detector = StructureDetector()
