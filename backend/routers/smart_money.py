"""
🏛️ SMART MONEY ORDER LOGIC API
RESTful and WebSocket endpoints for institutional-grade smart money trading intelligence.

Endpoints:
- GET /api/smart-money/current/{symbol} — Current smart money metrics
- GET /api/smart-money/volume-profile/{symbol} — Volume profile analysis
- GET /api/smart-money/institutional-activity/{symbol} — Institutional activity report
- GET /api/smart-money/market-structure/{symbol} — Market structure analysis
- GET /api/smart-money/positioning/{symbol} — Institutional positioning
- GET /api/smart-money/clusters/{symbol} — Recent order clusters
- GET /api/smart-money/alerts/{symbol} — Active alerts
- GET /api/smart-money/performance — System performance metrics
- WS /ws/smart-money — Real-time smart money updates
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, HTTPException
from fastapi.responses import JSONResponse
import json
import asyncio
from typing import Optional
from datetime import datetime

from services.smart_money_signal_engine import smart_money_engine
from services.institutional_flow_tracker import institutional_flow_tracker
from services.real_time_alert_system import alert_system
from services.order_flow_optimizer import order_flow_optimizer

router = APIRouter(prefix="/api/smart-money", tags=["Smart Money Order Logic"])

# ─────────────────────────────────────────────────────────────────────────────
# REST ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/current/{symbol}")
async def get_current_signal(symbol: str):
    """
    Get current smart money signal and metrics.
    
    Returns:
        - signalType: BUY_ACCUMULATION, SELL_DISTRIBUTION, HOLD
        - confidence: 0-1
        - magnitude: 0-1
        - description: Human-readable analysis
        - entryPrice, stopLoss, takeProfit
        - supportingPatterns: List of detected patterns
    """
    if symbol not in ["NIFTY", "BANKNIFTY", "SENSEX"]:
        raise HTTPException(status_code=400, detail="Invalid symbol")
    
    signal = smart_money_engine.get_current_signal(symbol)
    
    if not signal:
        return {
            "symbol": symbol,
            "signalType": "HOLD",
            "confidence": 0.0,
            "description": "No data available"
        }
    
    return signal


@router.get("/volume-profile/{symbol}")
async def get_volume_profile(symbol: str):
    """
    Get detailed volume profile across price levels.
    
    Shows:
        - Price levels with accumulated volume
        - Order count and clustering
        - Institutional signatures
        - Support/resistance identification
    """
    if symbol not in ["NIFTY", "BANKNIFTY", "SENSEX"]:
        raise HTTPException(status_code=400, detail="Invalid symbol")
    
    profile = smart_money_engine.get_volume_profile(symbol)
    return profile


@router.get("/institutional-activity/{symbol}")
async def get_institutional_activity(symbol: str):
    """
    Get detailed institutional activity report.
    
    Shows:
        - Activity level: LOW, MEDIUM, HIGH
        - Confidence score
        - Recent institutional signatures
        - Volume concentrations
        - Order clustering patterns
    """
    if symbol not in ["NIFTY", "BANKNIFTY", "SENSEX"]:
        raise HTTPException(status_code=400, detail="Invalid symbol")
    
    activity = smart_money_engine.get_institutional_activity(symbol)
    return activity


@router.get("/market-structure/{symbol}")
async def get_market_structure(symbol: str):
    """
    Get market structure analysis from institutional flow tracker.
    
    Shows:
        - Current trend: UPTREND, DOWNTREND, NEUTRAL
        - Structure strength: 0-1
        - Support and resistance levels
        - Higher highs/lows count
        - Breakout probability
    """
    if symbol not in ["NIFTY", "BANKNIFTY", "SENSEX"]:
        raise HTTPException(status_code=400, detail="Invalid symbol")
    
    structure = institutional_flow_tracker.get_market_structure(symbol)
    return structure


@router.get("/positioning/{symbol}")
async def get_institutional_positioning(symbol: str):
    """
    Get estimated institutional positioning.
    
    Shows:
        - Accumulated buy/sell volume
        - Net position: positive = net long, negative = net short
        - Accumulation and distribution zones
        - Estimated number of participants
        - Position confidence
    """
    if symbol not in ["NIFTY", "BANKNIFTY", "SENSEX"]:
        raise HTTPException(status_code=400, detail="Invalid symbol")
    
    positioning = institutional_flow_tracker.get_institutional_positioning(symbol)
    
    if not positioning:
        return {
            "symbol": symbol,
            "message": "No positioning data available"
        }
    
    return positioning


@router.get("/clusters/{symbol}")
async def get_order_clusters(symbol: str, limit: int = Query(10, ge=1, le=50)):
    """
    Get recent order clusters detected at this symbol.
    
    Shows:
        - Center price and range
        - Total volume and order count
        - Cluster intensity and impact score
        - Buy/sell direction
    """
    if symbol not in ["NIFTY", "BANKNIFTY", "SENSEX"]:
        raise HTTPException(status_code=400, detail="Invalid symbol")
    
    clusters = institutional_flow_tracker.get_current_clusters(symbol, limit=limit)
    
    return {
        "symbol": symbol,
        "clusterCount": len(clusters),
        "clusters": clusters
    }


@router.get("/alerts/{symbol}")
async def get_active_alerts(symbol: str):
    """
    Get all active, non-expired alerts for this symbol.
    
    Shows:
        - Alert type: INSTITUTIONAL_ACTIVITY, BREAKOUT_WARNING, etc.
        - Severity: LOW, MEDIUM, HIGH, CRITICAL
        - Title and description
        - Entry price, stop loss, take profit
        - Confidence level
    """
    if symbol not in ["NIFTY", "BANKNIFTY", "SENSEX"]:
        raise HTTPException(status_code=400, detail="Invalid symbol")
    
    alerts = alert_system.get_active_alerts(symbol)
    
    return {
        "symbol": symbol,
        "activeAlertCount": len(alerts),
        "alerts": alerts
    }


@router.get("/recent-alerts/{symbol}")
async def get_recent_alerts(symbol: str, limit: int = Query(50, ge=1, le=200)):
    """
    Get recent alerts (including expired) for historical analysis.
    """
    if symbol not in ["NIFTY", "BANKNIFTY", "SENSEX"]:
        raise HTTPException(status_code=400, detail="Invalid symbol")
    
    alerts = alert_system.get_recent_alerts(symbol, limit=limit)
    
    return {
        "symbol": symbol,
        "recentAlertCount": len(alerts),
        "alerts": alerts
    }


@router.get("/alert-statistics/{symbol}")
async def get_alert_statistics(symbol: str):
    """
    Get alert statistics for this symbol.
    
    Shows:
        - Total alerts generated
        - Active alert count
        - Alerts by type
    """
    if symbol not in ["NIFTY", "BANKNIFTY", "SENSEX"]:
        raise HTTPException(status_code=400, detail="Invalid symbol")
    
    stats = alert_system.get_alert_statistics(symbol)
    return stats


@router.get("/performance")
async def get_system_performance():
    """
    Get overall system performance metrics.
    
    Shows performance for all symbols:
        - Latency metrics (avg, peak, min)
        - Throughput (ticks per second)
        - Cache hit rate
        - Queue depth
    """
    metrics = order_flow_optimizer.get_all_performance_metrics()
    return metrics


@router.get("/performance/{symbol}")
async def get_symbol_performance(symbol: str):
    """Get performance metrics for a specific symbol."""
    if symbol not in ["NIFTY", "BANKNIFTY", "SENSEX"]:
        raise HTTPException(status_code=400, detail="Invalid symbol")
    
    metrics = order_flow_optimizer.get_performance_metrics(symbol)
    return metrics


@router.post("/clear-cache")
async def clear_cache(symbol: Optional[str] = None):
    """Clear analysis cache for optimization."""
    order_flow_optimizer.clear_cache(symbol=symbol)
    
    return {
        "message": "Cache cleared successfully",
        "symbol": symbol or "all"
    }


# ─────────────────────────────────────────────────────────────────────────────
# WEBSOCKET ENDPOINT
# ─────────────────────────────────────────────────────────────────────────────

connected_clients = []


@router.websocket("/ws/smart-money")
async def websocket_smart_money(websocket: WebSocket):
    """
    Real-time WebSocket endpoint for smart money updates.
    
    Client subscribes to symbols and receives:
        1. Initial snapshot of current state
        2. Real-time signal updates
        3. Alert notifications
        4. Cluster updates
        5. Performance metrics
        
    Message Format:
    ```json
    {
        "type": "subscribe|unsubscribe|snapshot|signal|alert|cluster|performance",
        "symbol": "NIFTY|BANKNIFTY|SENSEX",
        "data": {}
    }
    ```
    """
    await websocket.accept()
    connected_clients.append(websocket)
    
    subscriptions = set()  # Symbols this client is subscribed to
    
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            message_type = message.get('type', '')
            symbol = message.get('symbol', '')
            
            # Validate symbol
            if symbol and symbol not in ["NIFTY", "BANKNIFTY", "SENSEX"]:
                await websocket.send_json({
                    "type": "error",
                    "message": "Invalid symbol"
                })
                continue
            
            # Handle subscription
            if message_type == 'subscribe':
                subscriptions.add(symbol)
                
                # Send current snapshot
                signal = smart_money_engine.get_current_signal(symbol)
                alerts = alert_system.get_active_alerts(symbol)
                structure = institutional_flow_tracker.get_market_structure(symbol)
                
                await websocket.send_json({
                    "type": "snapshot",
                    "symbol": symbol,
                    "timestamp": datetime.now().isoformat(),
                    "signal": signal,
                    "alerts": alerts[:5],  # Top 5 alerts
                    "structure": structure
                })
            
            # Handle unsubscription
            elif message_type == 'unsubscribe':
                subscriptions.discard(symbol)
            
            # Handle data request
            elif message_type == 'data':
                data_type = message.get('dataType', '')
                
                if data_type == 'signal':
                    signal = smart_money_engine.get_current_signal(symbol)
                    await websocket.send_json({
                        "type": "signal",
                        "symbol": symbol,
                        "data": signal
                    })
                
                elif data_type == 'volume_profile':
                    profile = smart_money_engine.get_volume_profile(symbol)
                    await websocket.send_json({
                        "type": "volume_profile",
                        "symbol": symbol,
                        "data": profile
                    })
                
                elif data_type == 'positioning':
                    positioning = institutional_flow_tracker.get_institutional_positioning(symbol)
                    await websocket.send_json({
                        "type": "positioning",
                        "symbol": symbol,
                        "data": positioning
                    })
                
                elif data_type == 'performance':
                    perf = order_flow_optimizer.get_performance_metrics(symbol)
                    await websocket.send_json({
                        "type": "performance",
                        "symbol": symbol,
                        "data": perf
                    })
    
    except WebSocketDisconnect:
        connected_clients.remove(websocket)
    except Exception as e:
        print(f"❌ WebSocket error: {e}")
        try:
            await websocket.close()
        except:
            pass
        if websocket in connected_clients:
            connected_clients.remove(websocket)


# ─────────────────────────────────────────────────────────────────────────────
# BROADCAST HELPER
# ─────────────────────────────────────────────────────────────────────────────

async def broadcast_alert(alert):
    """Broadcast an alert to all connected WebSocket clients."""
    for client in connected_clients:
        try:
            await client.send_json({
                "type": "alert",
                "symbol": alert.symbol,
                "data": alert.to_dict()
            })
        except:
            pass


async def broadcast_signal_update(symbol: str, signal: dict):
    """Broadcast a signal update to interested clients."""
    for client in connected_clients:
        try:
            await client.send_json({
                "type": "signal_update",
                "symbol": symbol,
                "data": signal
            })
        except:
            pass


# ─────────────────────────────────────────────────────────────────────────────
# HEALTH CHECK
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "Smart Money Order Logic",
        "version": "1.0.0",
        "timestamp": datetime.now().isoformat()
    }
