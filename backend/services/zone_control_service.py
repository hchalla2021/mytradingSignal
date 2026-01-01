"""
Zone Control & Breakdown Risk Service - Ultra-Fast S/R Analysis
═══════════════════════════════════════════════════════════════
Advanced support/resistance zone detection with breakdown prediction
Performance: O(n log n) time, O(k) space | Target: <8ms execution

Key Features:
- Dynamic zone detection with volume-weighted strength
- Multi-touch validation for zone reliability
- Breakdown probability scoring (0-100%)
- Price distance to critical zones
- Real-time bounce/break prediction
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime
import asyncio


@dataclass
class Zone:
    """Lightweight support/resistance zone container"""
    __slots__ = ('level', 'touches', 'volume_strength', 'zone_type', 
                 'distance_pct', 'strength_score', 'is_active')
    
    level: float  # Price level
    touches: int  # Number of times price tested this zone
    volume_strength: float  # Volume concentration at this level
    zone_type: str  # SUPPORT or RESISTANCE
    distance_pct: float  # Distance from current price (%)
    strength_score: int  # 0-100 strength rating
    is_active: bool  # Is zone currently valid


@dataclass
class ZoneControlResult:
    """Result container for zone analysis"""
    __slots__ = ('symbol', 'current_price', 'support_zones', 'resistance_zones',
                 'nearest_support', 'nearest_resistance', 'breakdown_risk',
                 'bounce_probability', 'zone_strength', 'signal', 'confidence',
                 'recommendation', 'timestamp')
    
    symbol: str
    current_price: float
    support_zones: List[Zone]
    resistance_zones: List[Zone]
    nearest_support: Optional[Zone]
    nearest_resistance: Optional[Zone]
    breakdown_risk: int  # 0-100 (higher = more likely to break down)
    bounce_probability: int  # 0-100 (higher = more likely to bounce)
    zone_strength: str  # STRONG, MODERATE, WEAK
    signal: str  # BUY_ZONE, SELL_ZONE, NEUTRAL
    confidence: int  # 0-100
    recommendation: str
    timestamp: str


class ZoneControlEngine:
    """
    Ultra-Fast Support/Resistance Zone Analyzer
    ══════════════════════════════════════════════
    Algorithm: 
    1. Identify swing highs/lows using vectorized operations
    2. Cluster nearby levels into zones (O(n log n))
    3. Calculate volume-weighted strength scores
    4. Compute breakdown/bounce probabilities
    
    Memory: O(k) where k = number of zones (typically 3-5)
    """
    
    __slots__ = ('_zone_tolerance', '_min_touches', '_lookback', '_max_zones')
    
    def __init__(self, zone_tolerance: float = 0.5, min_touches: int = 2, 
                 lookback: int = 100, max_zones: int = 5):
        """
        Args:
            zone_tolerance: Price tolerance for zone clustering (%)
            min_touches: Minimum touches to qualify as zone
            lookback: Candles to analyze for zone detection
            max_zones: Maximum support/resistance zones to track
        """
        self._zone_tolerance = zone_tolerance
        self._min_touches = min_touches
        self._lookback = lookback
        self._max_zones = max_zones
    
    def analyze(self, symbol: str, df: pd.DataFrame) -> ZoneControlResult:
        """
        Main analysis - ULTRA FAST
        Target: <8ms for 100 candles
        """
        try:
            # Fast validation
            if df.empty or len(df) < 20:
                return self._create_neutral_result(symbol, 0.0, "Insufficient data")
            
            # Get recent data
            recent = df.tail(self._lookback)
            current_price = float(recent['close'].iloc[-1])
            
            # === STEP 1: IDENTIFY SWING POINTS (VECTORIZED) ===
            swing_highs, swing_lows = self._find_swing_points(recent)
            
            if len(swing_highs) < 2 or len(swing_lows) < 2:
                return self._create_neutral_result(symbol, current_price, "Insufficient swings")
            
            # === STEP 2: CLUSTER INTO ZONES ===
            resistance_zones = self._create_zones(
                swing_highs, recent, current_price, 'RESISTANCE'
            )
            support_zones = self._create_zones(
                swing_lows, recent, current_price, 'SUPPORT'
            )
            
            # === STEP 3: FIND NEAREST ZONES ===
            nearest_support = self._find_nearest_zone(support_zones, current_price, 'below')
            nearest_resistance = self._find_nearest_zone(resistance_zones, current_price, 'above')
            
            # === STEP 4: CALCULATE BREAKDOWN/BOUNCE PROBABILITIES ===
            breakdown_risk = self._calculate_breakdown_risk(
                current_price, nearest_support, support_zones, recent
            )
            
            bounce_probability = self._calculate_bounce_probability(
                current_price, nearest_support, nearest_resistance, recent
            )
            
            # === STEP 5: ASSESS ZONE STRENGTH ===
            zone_strength = self._assess_zone_strength(support_zones, resistance_zones)
            
            # === STEP 6: GENERATE TRADING SIGNAL ===
            signal, confidence, recommendation = self._generate_signal(
                current_price, nearest_support, nearest_resistance,
                breakdown_risk, bounce_probability, zone_strength
            )
            
            return ZoneControlResult(
                symbol=symbol,
                current_price=current_price,
                support_zones=support_zones[:self._max_zones],
                resistance_zones=resistance_zones[:self._max_zones],
                nearest_support=nearest_support,
                nearest_resistance=nearest_resistance,
                breakdown_risk=breakdown_risk,
                bounce_probability=bounce_probability,
                zone_strength=zone_strength,
                signal=signal,
                confidence=confidence,
                recommendation=recommendation,
                timestamp=datetime.now().isoformat()
            )
            
        except Exception as e:
            # Error analyzing zone control
            return self._create_neutral_result(symbol, 0.0, f"Error: {e}")
    
    def _find_swing_points(self, df: pd.DataFrame) -> Tuple[List[float], List[float]]:
        """
        Identify swing highs and lows using vectorized operations
        O(n) complexity
        """
        high_arr = df['high'].values
        low_arr = df['low'].values
        volume_arr = df['volume'].values
        
        swing_highs = []
        swing_lows = []
        
        window = 5  # Look 5 candles ahead/behind for swing confirmation
        
        for i in range(window, len(df) - window):
            # Swing High: highest point in window
            if high_arr[i] == np.max(high_arr[i-window:i+window+1]):
                swing_highs.append((high_arr[i], volume_arr[i], i))
            
            # Swing Low: lowest point in window
            if low_arr[i] == np.min(low_arr[i-window:i+window+1]):
                swing_lows.append((low_arr[i], volume_arr[i], i))
        
        # Return just price levels with volume weights
        return (
            [(price, vol) for price, vol, _ in swing_highs],
            [(price, vol) for price, vol, _ in swing_lows]
        )
    
    def _create_zones(self, swing_points: List[Tuple[float, float]], 
                      df: pd.DataFrame, current_price: float, 
                      zone_type: str) -> List[Zone]:
        """
        Cluster swing points into support/resistance zones
        O(n log n) for sorting + clustering
        """
        if not swing_points:
            return []
        
        # Sort by price level
        sorted_swings = sorted(swing_points, key=lambda x: x[0])
        
        zones = []
        current_cluster = [sorted_swings[0]]
        
        # Cluster nearby levels
        for i in range(1, len(sorted_swings)):
            price, vol = sorted_swings[i]
            cluster_avg = np.mean([p for p, v in current_cluster])
            
            # Check if within tolerance
            price_diff_pct = abs(price - cluster_avg) / cluster_avg * 100
            
            if price_diff_pct <= self._zone_tolerance:
                current_cluster.append((price, vol))
            else:
                # Finalize current cluster as zone
                if len(current_cluster) >= self._min_touches:
                    zone = self._finalize_zone(
                        current_cluster, current_price, zone_type, df
                    )
                    zones.append(zone)
                
                # Start new cluster
                current_cluster = [(price, vol)]
        
        # Finalize last cluster
        if len(current_cluster) >= self._min_touches:
            zone = self._finalize_zone(current_cluster, current_price, zone_type, df)
            zones.append(zone)
        
        # Sort by distance from current price
        zones.sort(key=lambda z: abs(z.distance_pct))
        
        return zones
    
    def _finalize_zone(self, cluster: List[Tuple[float, float]], 
                       current_price: float, zone_type: str,
                       df: pd.DataFrame) -> Zone:
        """Convert cluster into Zone object with strength metrics"""
        prices = [p for p, v in cluster]
        volumes = [v for p, v in cluster]
        
        # Zone level = volume-weighted average
        total_vol = sum(volumes)
        level = sum(p * v for p, v in cluster) / total_vol if total_vol > 0 else np.mean(prices)
        
        # Calculate metrics
        touches = len(cluster)
        volume_strength = total_vol / df['volume'].mean() if len(df) > 0 else 1.0
        distance_pct = (level - current_price) / current_price * 100
        
        # Strength score (0-100)
        strength_score = self._calculate_zone_strength_score(
            touches, volume_strength, abs(distance_pct)
        )
        
        # Is zone still active (not too far away)
        is_active = abs(distance_pct) < 10.0  # Within 10% of price
        
        return Zone(
            level=round(level, 2),
            touches=touches,
            volume_strength=round(volume_strength, 2),
            zone_type=zone_type,
            distance_pct=round(distance_pct, 2),
            strength_score=strength_score,
            is_active=is_active
        )
    
    def _calculate_zone_strength_score(self, touches: int, 
                                       volume_strength: float,
                                       distance_pct: float) -> int:
        """
        Calculate zone strength (0-100)
        Higher = Stronger zone
        """
        score = 0
        
        # 1. Touch count (40 points max)
        score += min(touches * 10, 40)
        
        # 2. Volume strength (30 points max)
        if volume_strength > 2.0:
            score += 30
        elif volume_strength > 1.5:
            score += 25
        elif volume_strength > 1.0:
            score += 15
        
        # 3. Proximity to current price (30 points max)
        if distance_pct < 1.0:
            score += 30  # Very close - critical zone
        elif distance_pct < 2.0:
            score += 25
        elif distance_pct < 5.0:
            score += 15
        
        return min(score, 100)
    
    def _find_nearest_zone(self, zones: List[Zone], current_price: float, 
                           direction: str) -> Optional[Zone]:
        """Find nearest support (below) or resistance (above) zone"""
        if not zones:
            return None
        
        if direction == 'below':
            # Find nearest support below current price
            below_zones = [z for z in zones if z.level < current_price and z.is_active]
            return min(below_zones, key=lambda z: abs(z.distance_pct)) if below_zones else None
        else:
            # Find nearest resistance above current price
            above_zones = [z for z in zones if z.level > current_price and z.is_active]
            return min(above_zones, key=lambda z: abs(z.distance_pct)) if above_zones else None
    
    def _calculate_breakdown_risk(self, current_price: float, 
                                  nearest_support: Optional[Zone],
                                  all_supports: List[Zone],
                                  df: pd.DataFrame) -> int:
        """
        Calculate probability of breaking down through support (0-100)
        Higher = More likely to break down
        """
        if not nearest_support:
            return 50  # No support = neutral
        
        risk = 0
        
        # 1. Distance to support (closer = higher risk)
        distance = abs(nearest_support.distance_pct)
        if distance < 0.5:
            risk += 40  # Very close - high risk
        elif distance < 1.0:
            risk += 30
        elif distance < 2.0:
            risk += 20
        
        # 2. Support strength (weaker = higher risk)
        if nearest_support.strength_score < 30:
            risk += 30  # Weak support
        elif nearest_support.strength_score < 50:
            risk += 20
        elif nearest_support.strength_score < 70:
            risk += 10
        
        # 3. Recent momentum (selling pressure increases risk)
        last_10 = df.tail(10)
        close_arr = last_10['close'].values
        
        if len(close_arr) >= 10:
            momentum = (close_arr[-1] - close_arr[0]) / close_arr[0] * 100
            if momentum < -2.0:
                risk += 30  # Strong downtrend
            elif momentum < -1.0:
                risk += 20
            elif momentum < 0:
                risk += 10
        
        return min(risk, 95)  # Cap at 95
    
    def _calculate_bounce_probability(self, current_price: float,
                                      nearest_support: Optional[Zone],
                                      nearest_resistance: Optional[Zone],
                                      df: pd.DataFrame) -> int:
        """
        Calculate probability of bouncing from support (0-100)
        Higher = More likely to bounce up
        """
        if not nearest_support:
            return 50  # No support = neutral
        
        probability = 0
        
        # 1. Support strength (stronger = higher bounce chance)
        if nearest_support.strength_score > 70:
            probability += 40  # Strong support
        elif nearest_support.strength_score > 50:
            probability += 30
        elif nearest_support.strength_score > 30:
            probability += 20
        
        # 2. Distance to support (at support = higher bounce chance)
        distance = abs(nearest_support.distance_pct)
        if distance < 0.3:
            probability += 35  # Right at support
        elif distance < 0.7:
            probability += 25
        elif distance < 1.5:
            probability += 15
        
        # 3. Distance to resistance (more room = better)
        if nearest_resistance:
            resistance_room = abs(nearest_resistance.distance_pct)
            if resistance_room > 5.0:
                probability += 25  # Lots of room to move up
            elif resistance_room > 3.0:
                probability += 15
        
        return min(probability, 95)  # Cap at 95
    
    def _assess_zone_strength(self, support_zones: List[Zone], 
                             resistance_zones: List[Zone]) -> str:
        """Assess overall zone quality"""
        all_zones = support_zones + resistance_zones
        
        if not all_zones:
            return "WEAK"
        
        avg_strength = np.mean([z.strength_score for z in all_zones])
        
        if avg_strength > 70:
            return "STRONG"
        elif avg_strength > 40:
            return "MODERATE"
        else:
            return "WEAK"
    
    def _generate_signal(self, current_price: float,
                        nearest_support: Optional[Zone],
                        nearest_resistance: Optional[Zone],
                        breakdown_risk: int,
                        bounce_probability: int,
                        zone_strength: str) -> Tuple[str, int, str]:
        """
        Generate trading signal with confidence and recommendation
        Returns: (signal, confidence, recommendation)
        """
        signal = "NEUTRAL"
        confidence = 0
        recommendation = "Wait for clearer signal"
        
        # === BUY ZONE CONDITIONS ===
        # Price near strong support with high bounce probability
        if nearest_support and abs(nearest_support.distance_pct) < 1.0:
            if bounce_probability > 70 and breakdown_risk < 30:
                signal = "BUY_ZONE"
                confidence = bounce_probability
                recommendation = f"Strong buy zone at ₹{nearest_support.level:.2f} - High bounce probability"
            
            elif bounce_probability > 50 and zone_strength == "STRONG":
                signal = "BUY_ZONE"
                confidence = bounce_probability - 10
                recommendation = f"Moderate buy zone at ₹{nearest_support.level:.2f} - Watch for confirmation"
            else:
                # Still near support but conditions not strong enough
                confidence = max(30, bounce_probability - 20)
                recommendation = f"Approaching support at ₹{nearest_support.level:.2f} - Watch closely"
        
        # === SELL ZONE CONDITIONS ===
        # Price near resistance or breakdown imminent
        elif nearest_resistance and abs(nearest_resistance.distance_pct) < 1.0:
            if nearest_resistance.strength_score > 60:
                signal = "SELL_ZONE"
                confidence = nearest_resistance.strength_score
                recommendation = f"Resistance zone at ₹{nearest_resistance.level:.2f} - Consider profit booking"
            else:
                # Near resistance but not strong enough
                confidence = max(30, nearest_resistance.strength_score - 10)
                recommendation = f"Approaching resistance at ₹{nearest_resistance.level:.2f} - Watch for rejection"
        
        # High breakdown risk
        elif breakdown_risk > 70:
            signal = "SELL_ZONE"
            confidence = breakdown_risk
            recommendation = f"High breakdown risk ({breakdown_risk}%) - Exit longs"
        
        # === NEUTRAL CONDITIONS ===
        else:
            # Calculate confidence based on zone positioning
            # Higher confidence when balanced or good setup forming
            confidence = max(0, 50 - abs(50 - bounce_probability))
            
            # Boost confidence if zones are clearly defined
            if nearest_support and nearest_resistance:
                if zone_strength == "STRONG":
                    confidence = min(75, confidence + 25)
                elif zone_strength == "MODERATE":
                    confidence = min(60, confidence + 15)
            
            if nearest_support:
                recommendation = f"Price between zones - Next support at ₹{nearest_support.level:.2f}"
            elif nearest_resistance:
                recommendation = f"Price between zones - Next resistance at ₹{nearest_resistance.level:.2f}"
        return signal, confidence, recommendation
    
    def _create_neutral_result(self, symbol: str, price: float, 
                              reason: str) -> ZoneControlResult:
        """Create neutral result for errors/edge cases"""
        return ZoneControlResult(
            symbol=symbol,
            current_price=price,
            support_zones=[],
            resistance_zones=[],
            nearest_support=None,
            nearest_resistance=None,
            breakdown_risk=50,
            bounce_probability=50,
            zone_strength="WEAK",
            signal="NEUTRAL",
            confidence=0,
            recommendation=f"Unable to analyze: {reason}",
            timestamp=datetime.now().isoformat()
        )
    
    def to_dict(self, result: ZoneControlResult) -> Dict:
        """Convert result to API-friendly dictionary with proper type conversion"""
        def convert_value(v):
            """Convert numpy types to native Python types for JSON serialization"""
            if hasattr(v, 'item'):  # numpy scalar
                return v.item()
            elif isinstance(v, (np.integer, np.floating)):
                return float(v)
            elif isinstance(v, (np.bool_, bool)):
                return bool(v)
            return v
        
        return {
            "symbol": result.symbol,
            "current_price": float(result.current_price),
            "zones": {
                "support": [
                    {
                        "level": float(z.level),
                        "touches": int(z.touches),
                        "volume_strength": float(z.volume_strength),
                        "distance_pct": float(z.distance_pct),
                        "strength": float(z.strength_score),
                        "active": bool(z.is_active)
                    }
                    for z in result.support_zones
                ],
                "resistance": [
                    {
                        "level": float(z.level),
                        "touches": int(z.touches),
                        "volume_strength": float(z.volume_strength),
                        "distance_pct": float(z.distance_pct),
                        "strength": float(z.strength_score),
                        "active": bool(z.is_active)
                    }
                    for z in result.resistance_zones
                ]
            },
            "nearest_zones": {
                "support": {
                    "level": float(result.nearest_support.level) if result.nearest_support else None,
                    "distance_pct": float(result.nearest_support.distance_pct) if result.nearest_support else None,
                    "strength": float(result.nearest_support.strength_score) if result.nearest_support else 0.0,
                    "touches": int(result.nearest_support.touches) if result.nearest_support else 0
                },
                "resistance": {
                    "level": float(result.nearest_resistance.level) if result.nearest_resistance else None,
                    "distance_pct": float(result.nearest_resistance.distance_pct) if result.nearest_resistance else None,
                    "strength": float(result.nearest_resistance.strength_score) if result.nearest_resistance else 0.0,
                    "touches": int(result.nearest_resistance.touches) if result.nearest_resistance else 0
                }
            },
            "risk_metrics": {
                "breakdown_risk": int(result.breakdown_risk),
                "bounce_probability": int(result.bounce_probability),
                "zone_strength": str(result.zone_strength)
            },
            "signal": str(result.signal),
            "confidence": int(result.confidence),
            "recommendation": str(result.recommendation),
            "timestamp": str(result.timestamp)
        }


# ═══════════════════════════════════════════════════════════
# SINGLETON PATTERN
# ═══════════════════════════════════════════════════════════

_engine_instance: Optional[ZoneControlEngine] = None


def get_zone_control_engine() -> ZoneControlEngine:
    """Get or create singleton engine instance"""
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = ZoneControlEngine(
            zone_tolerance=0.5,  # 0.5% tolerance for zone clustering
            min_touches=2,       # Minimum 2 touches to qualify as zone
            lookback=100,        # Analyze last 100 candles
            max_zones=5          # Track top 5 zones each side
        )
    return _engine_instance


async def analyze_zone_control(symbol: str, df: pd.DataFrame) -> Dict:
    """
    Main entry point for API
    Ultra-fast async wrapper
    """
    engine = get_zone_control_engine()
    result = await asyncio.to_thread(engine.analyze, symbol, df)
    return engine.to_dict(result)
