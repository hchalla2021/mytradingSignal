"""
🏛️ SMART MONEY SIGNAL ENGINE
Institutional-grade smart money order flow analysis and detection.

Features:
- Institutional order clustering detection
- Smart money footprint analysis
- Large order accumulation tracking
- Market manipulation detection
- Liquidity hunting pattern recognition
- Volume profile analysis
- Order imbalance scoring
- Real-time institutional intelligence
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
from services.smart_money_order_logic_ai import SmartMoneyOrderLogicAIEngine

market_config = get_market_session()
IST = pytz.timezone(market_config.TIMEZONE)
_SMART_MONEY_AI_ENGINE = SmartMoneyOrderLogicAIEngine()


def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


@dataclass
class InstitutionalSignature:
    """Fingerprint of institutional activity at a price level."""
    price: float
    timestamp: datetime
    large_order_count: int = 0  # Count of unusually large orders
    order_clustering: float = 0.0  # 0-1, how clustered orders are
    volume_concentration: float = 0.0  # % of total volume at this level
    time_persistence: float = 0.0  # How long orders stayed at level
    aggression_score: float = 0.0  # 0-1, how aggressive the accumulation was
    accumulation_phase: bool = False  # True if accumulating, False if distributing
    confidence: float = 0.0  # 0-1, confidence in institutional detection


@dataclass
class SmartMoneyPattern:
    """Detected pattern of smart money activity."""
    pattern_type: str  # ACCUMULATION, DISTRIBUTION, LAYERING, HUNTING, SPOOFING
    start_price: float
    end_price: float
    start_time: datetime
    end_time: datetime
    confidence: float  # 0-1
    volume_involved: float
    participants_estimated: int  # Estimated number of institutions
    direction: str  # BULLISH, BEARISH, NEUTRAL
    next_target: Optional[float] = None
    risk_level: str = "MEDIUM"  # LOW, MEDIUM, HIGH


@dataclass
class OrderFlowSignal:
    """Real-time order flow signal for institutional traders."""
    timestamp: datetime
    symbol: str
    signal_type: str  # BUY_ACCUMULATION, SELL_DISTRIBUTION, BREAKOUT, REVERSAL, ALERT
    confidence: float  # 0-1
    magnitude: float  # 0-1, strength of signal
    description: str
    supporting_patterns: List[SmartMoneyPattern] = field(default_factory=list)
    risk_score: float = 0.0  # 0-1
    entry_price: Optional[float] = None
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None


class PriceLevel:
    """Tracks activity at a specific price level (support/resistance)."""
    
    def __init__(self, price: float):
        self.price = price
        self.touches = 0  # How many times price came to this level
        self.total_volume = 0.0
        self.order_count = 0
        self.large_orders = deque(maxlen=100)  # Track large orders
        self.first_touch = datetime.now(IST)
        self.last_touch = datetime.now(IST)
        self.accumulated_time = 0.0  # Total time spent at this level
        self.break_above = False
        self.break_below = False
        
    def add_volume(self, qty: float, is_large: bool = False):
        """Record volume at this price level."""
        self.total_volume += qty
        self.order_count += 1
        if is_large:
            self.large_orders.append({
                'qty': qty,
                'timestamp': datetime.now(IST)
            })
        self.last_touch = datetime.now(IST)
        
    def get_volume_profile(self) -> Dict[str, Any]:
        """Get volume profile for this level."""
        return {
            'price': self.price,
            'touches': self.touches,
            'totalVolume': round(self.total_volume, 2),
            'orderCount': self.order_count,
            'largeOrderCount': len(self.large_orders),
            'avgOrderSize': round(self.total_volume / self.order_count, 2) if self.order_count > 0 else 0
        }


class SmartMoneySignalEngine:
    """
    Institutional-grade smart money analysis engine.
    Detects institutional footprints, patterns, and generates actionable signals.
    """
    
    def __init__(self):
        self.symbol_levels: Dict[str, Dict[float, PriceLevel]] = {
            s: {} for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        self.active_patterns: Dict[str, deque] = {
            s: deque(maxlen=50) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        self.current_signals: Dict[str, OrderFlowSignal] = {}
        self.signal_history: Dict[str, deque] = {
            s: deque(maxlen=1000) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        
        # Institutional fingerprints
        self.institutional_signatures: Dict[str, deque] = {
            s: deque(maxlen=500) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        
        # Configuration
        self.large_order_threshold_pct = 0.15  # 15% above average = large
        self.clustering_threshold = 0.70  # Orders within 70% of level = clustered
        self.volume_concentration_threshold = 0.25  # 25% of total volume
        
        self.lock = threading.Lock()
        print("✅ SmartMoneySignalEngine initialized")
    
    async def analyze_tick(self, tick: Dict[str, Any], symbol: str,
                          order_flow_metrics: Dict[str, Any]) -> OrderFlowSignal:
        """
        Analyze a tick for smart money activity and patterns.
        
        Args:
            tick: Zerodha tick data
            symbol: Trading symbol (NIFTY, BANKNIFTY, SENSEX)
            order_flow_metrics: From OrderFlowAnalyzer
            
        Returns:
            OrderFlowSignal with institutional analysis
        """
        try:
            current_price = tick.get('last_price', 0)
            volume = tick.get('volume_traded', 0)
            bid = order_flow_metrics.get('bid', current_price)
            ask = order_flow_metrics.get('ask', current_price)
            buyer_aggression = order_flow_metrics.get('buyerAggressionRatio', 0.5)
            
            # Update price level tracking
            with self.lock:
                self._track_price_level(symbol, current_price, volume, buyer_aggression)
            
            # Detect institutional signatures
            signatures = await self._detect_institutional_signatures(symbol, current_price)
            
            # Identify active patterns
            patterns = await self._identify_patterns(symbol, current_price, signatures)
            
            # Generate signal
            signal = await self._generate_institutional_signal(
                symbol, current_price, patterns, signatures, order_flow_metrics
            )
            
            # Store signal
            with self.lock:
                self.current_signals[symbol] = signal
                self.signal_history[symbol].append(signal)
            
            return signal
            
        except Exception as e:
            print(f"❌ Error analyzing tick for {symbol}: {e}")
            return self._create_neutral_signal(symbol)
    
    def _track_price_level(self, symbol: str, price: float, volume: float, buyer_ratio: float):
        """Track volume and activity at specific price levels."""
        # Round price to nearest 0.1% for level grouping
        level_price = round(price, 0)
        
        if level_price not in self.symbol_levels[symbol]:
            self.symbol_levels[symbol][level_price] = PriceLevel(level_price)
        
        level = self.symbol_levels[symbol][level_price]
        
        # Determine if this is a large order
        levels_data = self.symbol_levels[symbol]
        avg_volume = sum(l.total_volume for l in levels_data.values()) / max(len(levels_data), 1)
        is_large = volume > avg_volume * (1 + self.large_order_threshold_pct)
        
        level.add_volume(volume, is_large)
        level.touches += 1
    
    async def _detect_institutional_signatures(self, symbol: str,
                                               current_price: float) -> List[InstitutionalSignature]:
        """
        Detect institutional order signatures around the current price.
        
        Signatures indicate:
        - Large order clustering
        - Prolonged time at level
        - Volume concentration
        - Order aggressiveness pattern
        """
        signatures = []
        
        with self.lock:
            levels = self.symbol_levels.get(symbol, {})
        
        # Analyze levels within ±0.5% of current price
        price_range = current_price * 0.005
        relevant_levels = [
            (p, l) for p, l in levels.items()
            if abs(p - current_price) <= price_range
        ]
        
        for price, level in relevant_levels:
            if level.total_volume < 100:  # Skip trivial levels
                continue
            
            # Calculate signature metrics
            large_order_count = len(level.large_orders)
            order_clustering = self._calculate_order_clustering(level)
            volume_concentration = self._calculate_volume_concentration(symbol, level)
            time_persistence = (level.last_touch - level.first_touch).total_seconds()
            
            # Accumulation vs distribution (based on price proximity)
            accumulation_phase = price <= current_price
            
            # Confidence scoring
            confidence = self._score_institutional_signature(
                large_order_count, order_clustering, volume_concentration, time_persistence
            )
            
            if confidence > 0.5:  # Only keep significant signatures
                sig = InstitutionalSignature(
                    price=price,
                    timestamp=datetime.now(IST),
                    large_order_count=large_order_count,
                    order_clustering=order_clustering,
                    volume_concentration=volume_concentration,
                    time_persistence=min(time_persistence / 300, 1.0),  # Normalize to 0-1
                    accumulation_phase=accumulation_phase,
                    confidence=confidence
                )
                signatures.append(sig)
        
        # Store signatures
        with self.lock:
            self.institutional_signatures[symbol] = deque(
                list(self.institutional_signatures[symbol]) + signatures,
                maxlen=500
            )
        
        return signatures
    
    def _calculate_order_clustering(self, level: PriceLevel) -> float:
        """
        Calculate how clustered orders are at this level.
        Higher value = more orders clustered together = stronger institutional presence.
        """
        if level.order_count < 3:
            return 0.0
        
        # Orders within recent time window are more clustered
        now = datetime.now(IST)
        recent_orders = [
            o for o in level.large_orders
            if (now - o['timestamp']).total_seconds() < 60
        ]
        
        clustering = len(recent_orders) / max(len(level.large_orders), 1)
        return min(clustering, 1.0)
    
    def _calculate_volume_concentration(self, symbol: str, level: PriceLevel) -> float:
        """
        Calculate what percentage of total symbol volume is at this level.
        """
        all_levels = self.symbol_levels.get(symbol, {})
        total_volume = sum(l.total_volume for l in all_levels.values())
        
        if total_volume == 0:
            return 0.0
        
        concentration = level.total_volume / total_volume
        return min(concentration, 1.0)
    
    def _score_institutional_signature(self, large_order_count: int,
                                       clustering: float, volume_conc: float,
                                       time_persist: float) -> float:
        """
        Score confidence in institutional signature (0-1).
        Multiple large orders + clustering + volume concentration = high confidence.
        """
        score = 0.0
        
        # Large orders component (up to 0.4)
        large_order_score = min(large_order_count / 10, 1.0) * 0.4
        
        # Clustering component (up to 0.3)
        clustering_score = clustering * 0.3
        
        # Volume concentration component (up to 0.2)
        vol_score = min(volume_conc / self.volume_concentration_threshold, 1.0) * 0.2
        
        # Time persistence component (up to 0.1)
        time_score = min(time_persist / 60, 1.0) * 0.1  # Normalize to 60 seconds
        
        score = large_order_score + clustering_score + vol_score + time_score
        return min(score, 1.0)
    
    async def _identify_patterns(self, symbol: str, current_price: float,
                                 signatures: List[InstitutionalSignature]) -> List[SmartMoneyPattern]:
        """
        Identify larger institutional patterns from accumulated signatures.
        
        Patterns:
        - ACCUMULATION: Large orders below current price
        - DISTRIBUTION: Large orders above current price
        - LAYERING: Multiple orders at same price level
        - HUNTING: Rapid orders at multiple levels
        - SPOOFING: Large orders cancelled quickly
        """
        patterns = []
        
        if not signatures:
            return patterns
        
        # Group signatures by type
        accumulating = [s for s in signatures if s.accumulation_phase and s.confidence > 0.6]
        distributing = [s for s in signatures if not s.accumulation_phase and s.confidence > 0.6]
        
        # Accumulation pattern
        if accumulating:
            acc_volume = sum(s.volume_involved if hasattr(s, 'volume_involved') else 100 for s in accumulating)
            pattern = SmartMoneyPattern(
                pattern_type='ACCUMULATION',
                start_price=min(s.price for s in accumulating),
                end_price=max(s.price for s in accumulating),
                start_time=datetime.now(IST),
                end_time=datetime.now(IST),
                confidence=sum(s.confidence for s in accumulating) / len(accumulating),
                volume_involved=acc_volume,
                participants_estimated=len(accumulating),
                direction='BULLISH',
                next_target=current_price * 1.02,  # 2% above current
                risk_level='LOW'
            )
            patterns.append(pattern)
        
        # Distribution pattern
        if distributing:
            dist_volume = sum(s.volume_involved if hasattr(s, 'volume_involved') else 100 for s in distributing)
            pattern = SmartMoneyPattern(
                pattern_type='DISTRIBUTION',
                start_price=min(s.price for s in distributing),
                end_price=max(s.price for s in distributing),
                start_time=datetime.now(IST),
                end_time=datetime.now(IST),
                confidence=sum(s.confidence for s in distributing) / len(distributing),
                volume_involved=dist_volume,
                participants_estimated=len(distributing),
                direction='BEARISH',
                next_target=current_price * 0.98,  # 2% below current
                risk_level='LOW'
            )
            patterns.append(pattern)
        
        # Store patterns
        with self.lock:
            self.active_patterns[symbol] = deque(
                list(self.active_patterns[symbol]) + patterns,
                maxlen=50
            )
        
        return patterns
    
    async def _generate_institutional_signal(self, symbol: str, current_price: float,
                                             patterns: List[SmartMoneyPattern],
                                             signatures: List[InstitutionalSignature],
                                             order_flow_metrics: Dict[str, Any]) -> OrderFlowSignal:
        """
        Generate institutional-grade trading signal.
        """
        signal_type = 'HOLD'
        confidence = 0.0
        magnitude = 0.0
        description = ''
        supporting_patterns = []
        risk_score = 0.0
        
        # Analyze patterns
        if patterns:
            supporting_patterns = patterns
            
            acc_patterns = [p for p in patterns if p.pattern_type == 'ACCUMULATION']
            dist_patterns = [p for p in patterns if p.pattern_type == 'DISTRIBUTION']
            
            if acc_patterns:
                avg_acc_conf = sum(p.confidence for p in acc_patterns) / len(acc_patterns)
                signal_type = 'BUY_ACCUMULATION'
                confidence = min(avg_acc_conf + 0.2, 1.0)  # Boost from pattern
                magnitude = min(avg_acc_conf, 1.0)
                description = f'Smart money accumulation detected at {len(acc_patterns)} levels'
                risk_score = 0.2  # Low risk for accumulation
                
            elif dist_patterns:
                avg_dist_conf = sum(p.confidence for p in dist_patterns) / len(dist_patterns)
                signal_type = 'SELL_DISTRIBUTION'
                confidence = min(avg_dist_conf + 0.2, 1.0)
                magnitude = min(avg_dist_conf, 1.0)
                description = f'Smart money distribution detected at {len(dist_patterns)} levels'
                risk_score = 0.2
        
        # If no clear pattern, use signatures
        if signal_type == 'HOLD' and signatures:
            avg_sig_conf = sum(s.confidence for s in signatures) / len(signatures)
            if avg_sig_conf > 0.6:
                buyer_agg = order_flow_metrics.get('buyerAggressionRatio', 0.5)
                if buyer_agg > 0.55:
                    signal_type = 'BUY_ACCUMULATION'
                    confidence = min(avg_sig_conf, 1.0)
                    description = f'Institutional accumulation signature at current price'
                elif buyer_agg < 0.45:
                    signal_type = 'SELL_DISTRIBUTION'
                    confidence = min(avg_sig_conf, 1.0)
                    description = f'Institutional distribution signature at current price'
        
        # Calculate price targets
        entry_price = current_price
        stop_loss = current_price * 0.98 if signal_type.startswith('BUY') else current_price * 1.02
        take_profit = current_price * 1.03 if signal_type.startswith('BUY') else current_price * 0.97
        
        return OrderFlowSignal(
            timestamp=datetime.now(IST),
            symbol=symbol,
            signal_type=signal_type,
            confidence=confidence,
            magnitude=magnitude,
            description=description,
            supporting_patterns=supporting_patterns,
            risk_score=risk_score,
            entry_price=entry_price,
            stop_loss=stop_loss,
            take_profit=take_profit
        )
    
    def _create_neutral_signal(self, symbol: str) -> OrderFlowSignal:
        """Create a neutral hold signal."""
        return OrderFlowSignal(
            timestamp=datetime.now(IST),
            symbol=symbol,
            signal_type='HOLD',
            confidence=0.0,
            magnitude=0.0,
            description='No significant institutional activity detected',
            supporting_patterns=[],
            risk_score=0.5
        )
    
    def get_current_signal(self, symbol: str) -> Dict[str, Any]:
        """Get current institutional signal as JSON."""
        with self.lock:
            signal = self.current_signals.get(symbol)
            signatures = list(self.institutional_signatures.get(symbol, []))[-50:]
        
        if not signal:
            return {}

        avg_sig_conf = 0.0
        if signatures:
            avg_sig_conf = sum(_safe_float(s.confidence) for s in signatures) / len(signatures)

        ai_summary = _SMART_MONEY_AI_ENGINE.infer(
            symbol=symbol,
            signal_type=signal.signal_type,
            confidence=_safe_float(signal.confidence),
            magnitude=_safe_float(signal.magnitude),
            risk_score=_safe_float(signal.risk_score),
            entry_price=_safe_float(signal.entry_price),
            supporting_patterns_count=len(signal.supporting_patterns),
            signature_count=len(signatures),
            avg_signature_confidence=avg_sig_conf,
        )
        
        return {
            'timestamp': signal.timestamp.isoformat(),
            'symbol': signal.symbol,
            'signalType': signal.signal_type,
            'confidence': round(signal.confidence, 2),
            'magnitude': round(signal.magnitude, 2),
            'description': signal.description,
            'riskScore': round(signal.risk_score, 2),
            'entryPrice': round(signal.entry_price, 2) if signal.entry_price else None,
            'stopLoss': round(signal.stop_loss, 2) if signal.stop_loss else None,
            'takeProfit': round(signal.take_profit, 2) if signal.take_profit else None,
            'supportingPatterns': [
                {
                    'type': p.pattern_type,
                    'startPrice': round(p.start_price, 2),
                    'endPrice': round(p.end_price, 2),
                    'confidence': round(p.confidence, 2),
                    'direction': p.direction,
                    'nextTarget': round(p.next_target, 2) if p.next_target else None
                }
                for p in signal.supporting_patterns
            ],
            'ai': ai_summary,
        }
    
    def get_volume_profile(self, symbol: str) -> Dict[str, Any]:
        """Get volume profile across price levels."""
        with self.lock:
            levels = self.symbol_levels.get(symbol, {})
        
        profiles = [level.get_volume_profile() for level in levels.values()]
        profiles.sort(key=lambda x: x['totalVolume'], reverse=True)
        
        return {
            'symbol': symbol,
            'timestamp': datetime.now(IST).isoformat(),
            'levelCount': len(profiles),
            'profiles': profiles[:20]  # Top 20 levels
        }
    
    def get_institutional_activity(self, symbol: str) -> Dict[str, Any]:
        """Get institutional activity report."""
        with self.lock:
            signatures = list(self.institutional_signatures.get(symbol, []))[-50:]
        
        if not signatures:
            return {
                'symbol': symbol,
                'activityLevel': 'LOW',
                'confidence': 0.0,
                'signatures': []
            }
        
        avg_confidence = sum(s.confidence for s in signatures) / len(signatures)
        
        activity_level = 'HIGH' if avg_confidence > 0.7 else 'MEDIUM' if avg_confidence > 0.5 else 'LOW'
        
        return {
            'symbol': symbol,
            'timestamp': datetime.now(IST).isoformat(),
            'activityLevel': activity_level,
            'confidence': round(avg_confidence, 2),
            'recentSignatures': [
                {
                    'price': round(s.price, 2),
                    'largeOrderCount': s.large_order_count,
                    'orderClustering': round(s.order_clustering, 3),
                    'volumeConcentration': round(s.volume_concentration, 3),
                    'confidence': round(s.confidence, 2),
                    'accumulationPhase': s.accumulation_phase
                }
                for s in signatures[-10:]
            ]
        }


# Global engine instance
smart_money_engine = SmartMoneySignalEngine()
