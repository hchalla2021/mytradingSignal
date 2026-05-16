"""Global Impact Analyzer - FII/DII tracking and global market impact analysis.

Analyzes institutional flows, currency impacts, and global market effects on Indian markets.

Performance targets: <15ms per analysis, real-time flow tracking
"""

import asyncio
import logging
from dataclasses import dataclass, field
from collections import deque
from threading import RLock
from typing import Dict, List, Optional
from datetime import datetime
import statistics

logger = logging.getLogger(__name__)


@dataclass
class InstitutionalFlow:
    """Institutional flow analysis"""
    symbol: str
    flow_type: str  # FII, DII, HNI, RETAIL
    direction: str  # BUYING, SELLING, NEUTRAL
    volume: int
    value: float
    net_flow: float
    intensity: float  # 0-100
    timestamp: datetime = field(default_factory=datetime.now)


@dataclass
class CurrencyImpact:
    """Currency and global market impact"""
    currency_pair: str
    direction: str  # STRENGTHENING, WEAKENING
    impact_on_indices: List[str]
    expected_effect: str  # POSITIVE, NEGATIVE, NEUTRAL
    severity: float  # 0-1
    timestamp: datetime = field(default_factory=datetime.now)


@dataclass
class GlobalMarketImpact:
    """Global market impact on Indian markets"""
    source_index: str  # S&P500, DAX, NIKKEI, etc.
    direction: str  # UP, DOWN
    magnitude: float  # 0-100
    time_to_open: int  # minutes to market open
    expected_impact: str  # BULLISH, BEARISH, NEUTRAL
    confidence: float  # 0-1
    affected_sectors: List[str]
    timestamp: datetime = field(default_factory=datetime.now)


@dataclass
class VolatilitySpillover:
    """Volatility spillover from global markets"""
    source_market: str
    volatility_level: float
    impact_indices: List[str]
    expected_volatility_change: float
    correlation_strength: float
    timestamp: datetime = field(default_factory=datetime.now)


class GlobalImpactAnalyzer:
    """Analyzes global market impacts and institutional flows.
    
    Features:
    - FII/DII flow tracking
    - Currency impact analysis
    - Global market correlation
    - Volatility spillover detection
    - Institutional positioning
    - Cross-border flow analysis
    - Risk sentiment analysis
    """

    def __init__(self):
        self.logger = logger
        self.lock = RLock()
        
        # Flow tracking
        self.fii_flow_history: deque = deque(maxlen=100)
        self.dii_flow_history: deque = deque(maxlen=100)
        self.currency_history: deque = deque(maxlen=100)
        
        # Cache
        self.flow_cache: Dict[str, InstitutionalFlow] = {}
        self.currency_cache: Dict[str, CurrencyImpact] = {}
        self.global_cache: Dict[str, GlobalMarketImpact] = {}
        
        # Configuration
        self.fii_threshold = 100  # Million INR
        self.dii_threshold = 50
        self.volatility_threshold = 1.5  # VIX points

    async def analyze_institutional_flow(self, symbol: str, data: Dict) -> Optional[Dict]:
        """Analyze institutional flow patterns."""
        try:
            with self.lock:
                # Analyze FII flow
                fii_flow = self._analyze_fii_flow(data)
                if fii_flow:
                    self.flow_cache['FII'] = fii_flow
                    self.fii_flow_history.append(fii_flow)
                
                # Analyze DII flow
                dii_flow = self._analyze_dii_flow(data)
                if dii_flow:
                    self.flow_cache['DII'] = dii_flow
                    self.dii_flow_history.append(dii_flow)
                
                # Detect accumulation patterns
                accumulation = self._detect_accumulation_patterns()
                
                # Detect distribution patterns
                distribution = self._detect_distribution_patterns()
                
                return {
                    'fii_flow': fii_flow,
                    'dii_flow': dii_flow,
                    'accumulation_pattern': accumulation,
                    'distribution_pattern': distribution,
                    'net_institutional_bias': self._calculate_net_bias(),
                    'timestamp': datetime.now().isoformat()
                }
        except Exception as e:
            self.logger.error(f"Error analyzing flow: {str(e)}")
            return None

    async def analyze_global_impact(self, global_data: Dict) -> Optional[GlobalMarketImpact]:
        """Analyze global market impacts on Indian markets."""
        try:
            with self.lock:
                # Analyze S&P 500 impact
                sp500_direction = global_data.get('sp500_direction', 'NEUTRAL')
                sp500_magnitude = global_data.get('sp500_change', 0)
                
                # Analyze DAX impact
                dax_direction = global_data.get('dax_direction', 'NEUTRAL')
                dax_magnitude = global_data.get('dax_change', 0)
                
                # Calculate expected impact
                expected_direction = self._determine_expected_direction(sp500_direction, dax_direction)
                expected_impact = "BULLISH" if expected_direction == "UP" else "BEARISH"
                magnitude = max(abs(sp500_magnitude), abs(dax_magnitude))
                
                # Affected sectors
                affected = self._identify_affected_sectors(expected_impact)
                
                global_impact = GlobalMarketImpact(
                    source_index="S&P500/DAX",
                    direction=expected_direction,
                    magnitude=magnitude,
                    time_to_open=global_data.get('time_to_open', 60),
                    expected_impact=expected_impact,
                    confidence=self._calculate_confidence(sp500_magnitude, dax_magnitude),
                    affected_sectors=affected
                )
                
                self.global_cache['current'] = global_impact
                return global_impact
        except Exception as e:
            self.logger.error(f"Error analyzing global impact: {str(e)}")
            return None

    async def analyze_currency_impact(self, currency_data: Dict) -> Optional[CurrencyImpact]:
        """Analyze currency impact on markets."""
        try:
            with self.lock:
                # USDINR analysis
                usdinr_change = currency_data.get('usdinr_change', 0)
                usdinr_direction = "STRENGTHENING" if usdinr_change > 0 else "WEAKENING"
                
                # Impact on indices
                impact_on_indices = ["NIFTY", "BANKNIFTY", "SENSEX"]
                
                # Expected effect
                expected_effect = "NEGATIVE" if usdinr_change > 0 else "POSITIVE"
                
                currency_impact = CurrencyImpact(
                    currency_pair="USDINR",
                    direction=usdinr_direction,
                    impact_on_indices=impact_on_indices,
                    expected_effect=expected_effect,
                    severity=min(1.0, abs(usdinr_change) / 2.0)
                )
                
                self.currency_cache['USDINR'] = currency_impact
                self.currency_history.append(currency_impact)
                return currency_impact
        except Exception as e:
            self.logger.error(f"Error analyzing currency impact: {str(e)}")
            return None

    async def analyze_volatility_spillover(self, vix_data: Dict) -> Optional[VolatilitySpillover]:
        """Analyze volatility spillover from global markets."""
        try:
            with self.lock:
                # VIX analysis
                vix_level = vix_data.get('vix_level', 20)
                vix_change = vix_data.get('vix_change', 0)
                
                # Volatility classification
                if vix_level > 30:
                    volatility_level = "HIGH"
                    expected_change = 2.0
                elif vix_level > 20:
                    volatility_level = "MEDIUM"
                    expected_change = 1.0
                else:
                    volatility_level = "LOW"
                    expected_change = 0.5
                
                # Impact indices
                impact_indices = ["NIFTY", "BANKNIFTY", "SENSEX"]
                
                spillover = VolatilitySpillover(
                    source_market="VIX",
                    volatility_level=vix_level,
                    impact_indices=impact_indices,
                    expected_volatility_change=expected_change,
                    correlation_strength=self._calculate_correlation_to_vix()
                )
                
                return spillover
        except Exception as e:
            self.logger.error(f"Error analyzing volatility spillover: {str(e)}")
            return None

    def _analyze_fii_flow(self, data: Dict) -> Optional[InstitutionalFlow]:
        """Analyze FII flow."""
        fii_net = data.get('fii_net_flow', 0)
        fii_buy = data.get('fii_buy_value', 0)
        fii_sell = data.get('fii_sell_value', 0)
        
        if fii_buy + fii_sell == 0:
            return None
        
        direction = "BUYING" if fii_net > 0 else "SELLING"
        intensity = min(100, abs(fii_net) / self.fii_threshold * 100)
        
        return InstitutionalFlow(
            symbol="NIFTY",
            flow_type="FII",
            direction=direction,
            volume=int(abs(fii_net)),
            value=float(abs(fii_net)),
            net_flow=float(fii_net),
            intensity=intensity
        )

    def _analyze_dii_flow(self, data: Dict) -> Optional[InstitutionalFlow]:
        """Analyze DII flow."""
        dii_net = data.get('dii_net_flow', 0)
        dii_buy = data.get('dii_buy_value', 0)
        dii_sell = data.get('dii_sell_value', 0)
        
        if dii_buy + dii_sell == 0:
            return None
        
        direction = "BUYING" if dii_net > 0 else "SELLING"
        intensity = min(100, abs(dii_net) / self.dii_threshold * 100)
        
        return InstitutionalFlow(
            symbol="NIFTY",
            flow_type="DII",
            direction=direction,
            volume=int(abs(dii_net)),
            value=float(abs(dii_net)),
            net_flow=float(dii_net),
            intensity=intensity
        )

    def _detect_accumulation_patterns(self) -> bool:
        """Detect if institution is accumulating."""
        if len(self.fii_flow_history) < 5:
            return False
        
        recent_fii = list(self.fii_flow_history)[-5:]
        buying_count = sum(1 for f in recent_fii if f.direction == "BUYING")
        
        return buying_count >= 4

    def _detect_distribution_patterns(self) -> bool:
        """Detect if institution is distributing."""
        if len(self.fii_flow_history) < 5:
            return False
        
        recent_fii = list(self.fii_flow_history)[-5:]
        selling_count = sum(1 for f in recent_fii if f.direction == "SELLING")
        
        return selling_count >= 4

    def _calculate_net_bias(self) -> str:
        """Calculate net institutional bias."""
        if not self.fii_flow_history:
            return "NEUTRAL"
        
        recent_fii = list(self.fii_flow_history)[-10:]
        fii_bullish = sum(1 for f in recent_fii if f.direction == "BUYING")
        
        if fii_bullish >= 7:
            return "STRONGLY_BULLISH"
        elif fii_bullish >= 5:
            return "BULLISH"
        elif fii_bullish >= 3:
            return "NEUTRAL"
        else:
            return "BEARISH"

    def _determine_expected_direction(self, sp500_dir: str, dax_dir: str) -> str:
        """Determine expected market direction from global markets."""
        if sp500_dir == "UP" and dax_dir == "UP":
            return "UP"
        elif sp500_dir == "DOWN" and dax_dir == "DOWN":
            return "DOWN"
        else:
            return "MIXED"

    def _identify_affected_sectors(self, impact: str) -> List[str]:
        """Identify affected sectors."""
        if impact == "BULLISH":
            return ["IT", "PHARMA", "AUTO", "FINANCIALS"]
        else:
            return ["METALS", "ENERGY", "FMCG"]

    def _calculate_confidence(self, sp500_mag: float, dax_mag: float) -> float:
        """Calculate confidence in global impact."""
        avg_magnitude = (abs(sp500_mag) + abs(dax_mag)) / 2
        return min(1.0, avg_magnitude / 2.0)

    def _calculate_correlation_to_vix(self) -> float:
        """Calculate correlation strength to VIX."""
        return 0.65  # Average correlation


# Global instance
global_impact_analyzer = GlobalImpactAnalyzer()
