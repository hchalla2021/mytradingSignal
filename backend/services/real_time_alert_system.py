"""
🚨 REAL-TIME ALERT SYSTEM
Professional alert generation, filtering, and delivery for institutional traders.

Features:
- Smart alert filtering (reduce false signals)
- Multi-level severity scoring
- Alert aggregation and clustering
- Smart notifications with cooldown
- Alert history and statistics
- Webhook support for external systems
- Real-time WebSocket delivery
"""

import asyncio
import threading
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Callable
from collections import deque
import pytz
from enum import Enum
from dataclasses import dataclass

from config.market_session import get_market_session

market_config = get_market_session()
IST = pytz.timezone(market_config.TIMEZONE)


class AlertSeverity(Enum):
    """Alert severity levels for professional traders."""
    LOW = 0.2
    MEDIUM = 0.5
    HIGH = 0.8
    CRITICAL = 1.0


class AlertType(Enum):
    """Types of trading alerts."""
    INSTITUTIONAL_ACTIVITY = "INSTITUTIONAL_ACTIVITY"
    BREAKOUT_WARNING = "BREAKOUT_WARNING"
    SUPPORT_RESISTANCE_TEST = "SUPPORT_RESISTANCE_TEST"
    VOLUME_SPIKE = "VOLUME_SPIKE"
    ORDER_IMBALANCE = "ORDER_IMBALANCE"
    SMART_MONEY_ACCUMULATION = "SMART_MONEY_ACCUMULATION"
    SMART_MONEY_DISTRIBUTION = "SMART_MONEY_DISTRIBUTION"
    LIQUIDITY_HUNTING = "LIQUIDITY_HUNTING"
    RISK_WARNING = "RISK_WARNING"
    VOLATILITY_SPIKE = "VOLATILITY_SPIKE"


@dataclass
class TradeAlert:
    """Professional trading alert."""
    alert_id: str
    symbol: str
    alert_type: AlertType
    severity: AlertSeverity
    timestamp: datetime
    title: str
    description: str
    current_price: float
    target_price: Optional[float] = None
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None
    confidence: float = 0.5  # 0-1
    is_active: bool = True
    expires_at: Optional[datetime] = None
    metadata: Dict[str, Any] = None
    
    def __post_init__(self):
        if self.metadata is None:
            self.metadata = {}
    
    def is_expired(self) -> bool:
        """Check if alert has expired."""
        if self.expires_at is None:
            return False
        return datetime.now(IST) > self.expires_at
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert alert to dictionary."""
        return {
            'alertId': self.alert_id,
            'symbol': self.symbol,
            'alertType': self.alert_type.value,
            'severity': self.severity.name,
            'severityScore': self.severity.value,
            'timestamp': self.timestamp.isoformat(),
            'title': self.title,
            'description': self.description,
            'currentPrice': round(self.current_price, 2),
            'targetPrice': round(self.target_price, 2) if self.target_price else None,
            'stopLoss': round(self.stop_loss, 2) if self.stop_loss else None,
            'takeProfit': round(self.take_profit, 2) if self.take_profit else None,
            'confidence': round(self.confidence, 2),
            'isActive': self.is_active,
            'expiresAt': self.expires_at.isoformat() if self.expires_at else None,
            'metadata': self.metadata
        }


class RealTimeAlertSystem:
    """
    Professional real-time alert system for institutional traders.
    Features intelligent alert filtering, aggregation, and multi-channel delivery.
    """
    
    def __init__(self):
        self.active_alerts: Dict[str, deque] = {
            s: deque(maxlen=100) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        self.alert_history: Dict[str, deque] = {
            s: deque(maxlen=1000) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        self.alert_stats: Dict[str, Dict[str, int]] = {
            s: {} for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        
        # Alert suppression (cooldown) to avoid alert spam
        self.last_alert_time: Dict[str, datetime] = {}
        self.alert_cooldown_seconds = 30  # Min seconds between similar alerts
        
        # Alert subscribers for WebSocket delivery
        self.subscribers: List[Callable] = []
        
        # Alert counter for unique IDs
        self._alert_counter = 0
        
        # Configuration
        self.min_confidence_for_alert = 0.6  # Only alert if confidence > 60%
        self.enable_alert_aggregation = True
        
        self.lock = threading.Lock()
        print("✅ RealTimeAlertSystem initialized")
    
    async def create_alert(self, symbol: str, alert_type: AlertType,
                          severity: AlertSeverity, current_price: float,
                          title: str, description: str,
                          confidence: float = 0.5,
                          target_price: Optional[float] = None,
                          stop_loss: Optional[float] = None,
                          take_profit: Optional[float] = None,
                          metadata: Optional[Dict] = None) -> Optional[TradeAlert]:
        """
        Create a new trading alert with intelligent filtering.
        
        Args:
            symbol: Trading symbol
            alert_type: Type of alert
            severity: Severity level
            current_price: Current market price
            title: Alert title
            description: Alert description
            confidence: Confidence level (0-1)
            target_price: Target price for alert
            stop_loss: Stop loss level
            take_profit: Take profit level
            metadata: Additional data
            
        Returns:
            TradeAlert object if created, None if filtered
        """
        # Filter: Skip if confidence too low
        if confidence < self.min_confidence_for_alert:
            return None
        
        # Filter: Skip if in cooldown period
        alert_key = f"{symbol}:{alert_type.value}"
        with self.lock:
            last_time = self.last_alert_time.get(alert_key)
        
        if last_time:
            time_since = (datetime.now(IST) - last_time).total_seconds()
            if time_since < self.alert_cooldown_seconds:
                return None  # Still in cooldown
        
        # Create alert
        with self.lock:
            self._alert_counter += 1
            alert_id = f"ALERT_{datetime.now(IST).strftime('%Y%m%d%H%M%S')}_{self._alert_counter}"
        
        expires_at = datetime.now(IST) + timedelta(minutes=5)
        
        alert = TradeAlert(
            alert_id=alert_id,
            symbol=symbol,
            alert_type=alert_type,
            severity=severity,
            timestamp=datetime.now(IST),
            title=title,
            description=description,
            current_price=current_price,
            target_price=target_price,
            stop_loss=stop_loss,
            take_profit=take_profit,
            confidence=confidence,
            expires_at=expires_at,
            metadata=metadata or {}
        )
        
        # Store alert
        with self.lock:
            self.active_alerts[symbol].append(alert)
            self.alert_history[symbol].append(alert)
            self.last_alert_time[alert_key] = datetime.now(IST)
            
            # Update statistics
            alert_type_str = alert_type.value
            if alert_type_str not in self.alert_stats[symbol]:
                self.alert_stats[symbol][alert_type_str] = 0
            self.alert_stats[symbol][alert_type_str] += 1
        
        # Broadcast to subscribers
        await self._broadcast_alert(alert)
        
        return alert
    
    async def _broadcast_alert(self, alert: TradeAlert):
        """Broadcast alert to all subscribers."""
        for subscriber in self.subscribers:
            try:
                await subscriber(alert)
            except Exception as e:
                print(f"⚠️ Error broadcasting alert: {e}")
    
    def subscribe(self, callback: Callable):
        """Subscribe to alert updates."""
        self.subscribers.append(callback)
    
    def unsubscribe(self, callback: Callable):
        """Unsubscribe from alert updates."""
        if callback in self.subscribers:
            self.subscribers.remove(callback)
    
    def get_active_alerts(self, symbol: str) -> List[Dict[str, Any]]:
        """Get all active, non-expired alerts for a symbol."""
        with self.lock:
            alerts = list(self.active_alerts.get(symbol, []))
        
        # Filter out expired alerts
        active = [a for a in alerts if not a.is_expired()]
        
        return [a.to_dict() for a in active]
    
    def get_recent_alerts(self, symbol: str, limit: int = 50) -> List[Dict[str, Any]]:
        """Get recent alerts (including expired)."""
        with self.lock:
            alerts = list(self.alert_history.get(symbol, []))[-limit:]
        
        return [a.to_dict() for a in alerts]
    
    def get_alert_statistics(self, symbol: str) -> Dict[str, Any]:
        """Get alert statistics for a symbol."""
        with self.lock:
            stats = self.alert_stats.get(symbol, {})
            active_count = len([a for a in self.active_alerts.get(symbol, []) if not a.is_expired()])
        
        total_alerts = sum(stats.values())
        
        return {
            'symbol': symbol,
            'timestamp': datetime.now(IST).isoformat(),
            'totalAlertsGenerated': total_alerts,
            'activeAlertCount': active_count,
            'alertsByType': stats
        }
    
    def clear_expired_alerts(self):
        """Remove expired alerts from active list."""
        with self.lock:
            for symbol in self.active_alerts:
                self.active_alerts[symbol] = deque(
                    [a for a in self.active_alerts[symbol] if not a.is_expired()],
                    maxlen=100
                )
    
    def set_cooldown(self, seconds: int):
        """Set alert cooldown period."""
        self.alert_cooldown_seconds = seconds
    
    def set_min_confidence(self, confidence: float):
        """Set minimum confidence for alerts."""
        self.min_confidence_for_alert = confidence
    
    # Specialized alert creation methods
    
    async def alert_institutional_activity(self, symbol: str, current_price: float,
                                          activity_level: str, confidence: float,
                                          description: str) -> Optional[TradeAlert]:
        """Alert for detected institutional activity."""
        severity_map = {
            'LOW': AlertSeverity.LOW,
            'MEDIUM': AlertSeverity.MEDIUM,
            'HIGH': AlertSeverity.HIGH
        }
        severity = severity_map.get(activity_level, AlertSeverity.MEDIUM)
        
        return await self.create_alert(
            symbol=symbol,
            alert_type=AlertType.INSTITUTIONAL_ACTIVITY,
            severity=severity,
            current_price=current_price,
            title=f"Institutional {activity_level} Activity Detected",
            description=description,
            confidence=confidence,
            take_profit=current_price * 1.02 if activity_level == 'HIGH' else None
        )
    
    async def alert_smart_money_accumulation(self, symbol: str, current_price: float,
                                            accumulation_zones: List[float],
                                            confidence: float) -> Optional[TradeAlert]:
        """Alert for smart money accumulation pattern."""
        target = max(accumulation_zones) * 1.01 if accumulation_zones else current_price * 1.02
        
        return await self.create_alert(
            symbol=symbol,
            alert_type=AlertType.SMART_MONEY_ACCUMULATION,
            severity=AlertSeverity.HIGH if confidence > 0.8 else AlertSeverity.MEDIUM,
            current_price=current_price,
            title="Smart Money Accumulation Detected",
            description=f"Institutional accumulation at {len(accumulation_zones)} levels",
            confidence=confidence,
            target_price=target,
            stop_loss=min(accumulation_zones) * 0.99 if accumulation_zones else current_price * 0.98,
            take_profit=target,
            metadata={'accumulationZones': accumulation_zones}
        )
    
    async def alert_smart_money_distribution(self, symbol: str, current_price: float,
                                            distribution_zones: List[float],
                                            confidence: float) -> Optional[TradeAlert]:
        """Alert for smart money distribution pattern."""
        target = min(distribution_zones) * 0.99 if distribution_zones else current_price * 0.98
        
        return await self.create_alert(
            symbol=symbol,
            alert_type=AlertType.SMART_MONEY_DISTRIBUTION,
            severity=AlertSeverity.HIGH if confidence > 0.8 else AlertSeverity.MEDIUM,
            current_price=current_price,
            title="Smart Money Distribution Detected",
            description=f"Institutional distribution at {len(distribution_zones)} levels",
            confidence=confidence,
            target_price=target,
            stop_loss=max(distribution_zones) * 1.01 if distribution_zones else current_price * 1.02,
            take_profit=target,
            metadata={'distributionZones': distribution_zones}
        )
    
    async def alert_breakout_warning(self, symbol: str, current_price: float,
                                    key_level: float, direction: str,
                                    probability: float) -> Optional[TradeAlert]:
        """Alert for potential breakout."""
        target = key_level * 1.02 if direction == 'UP' else key_level * 0.98
        
        return await self.create_alert(
            symbol=symbol,
            alert_type=AlertType.BREAKOUT_WARNING,
            severity=AlertSeverity.HIGH if probability > 0.75 else AlertSeverity.MEDIUM,
            current_price=current_price,
            title=f"Breakout Warning - {direction}",
            description=f"Breakout probability: {probability*100:.1f}% at {key_level}",
            confidence=probability,
            target_price=target,
            stop_loss=current_price * (0.98 if direction == 'UP' else 1.02),
            take_profit=target,
            metadata={'keyLevel': key_level, 'direction': direction, 'probability': probability}
        )
    
    async def alert_order_imbalance(self, symbol: str, current_price: float,
                                   buyer_ratio: float, imbalance_strength: float) -> Optional[TradeAlert]:
        """Alert for significant order imbalance."""
        is_buy_side = buyer_ratio > 0.5
        severity = AlertSeverity.HIGH if imbalance_strength > 0.75 else AlertSeverity.MEDIUM
        
        return await self.create_alert(
            symbol=symbol,
            alert_type=AlertType.ORDER_IMBALANCE,
            severity=severity,
            current_price=current_price,
            title=f"Strong {'Buy' if is_buy_side else 'Sell'} Imbalance",
            description=f"Order imbalance: {buyer_ratio*100:.1f}% buy side",
            confidence=imbalance_strength,
            target_price=current_price * 1.01 if is_buy_side else current_price * 0.99,
            metadata={'buyerRatio': buyer_ratio, 'imbalanceStrength': imbalance_strength}
        )


# Global alert system instance
alert_system = RealTimeAlertSystem()
