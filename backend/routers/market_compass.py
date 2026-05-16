"""Market Compass API Router - REST and WebSocket endpoints for market intelligence.

Provides real-time market analysis, sentiment, risk metrics, and institutional flows.
"""

from fastapi import APIRouter, WebSocket, Query, Path, HTTPException
from fastapi.responses import JSONResponse
from typing import Dict, List, Optional
from datetime import datetime
import asyncio
import json
import logging

from services.market_compass_engine import market_compass_engine
from services.global_impact_analyzer import global_impact_analyzer
from services.market_regime_detector import market_regime_detector
from services.sentiment_risk_scorer import sentiment_risk_scorer

logger = logging.getLogger(__name__)

# Create routers
router = APIRouter(prefix="/market-compass", tags=["Market Compass"])
ws_router = APIRouter()


class MarketCompassConnectionManager:
    """Manages WebSocket connections for Market Compass."""

    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}
        self.subscribed_symbols: Dict[WebSocket, List[str]] = {}

    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        if client_id not in self.active_connections:
            self.active_connections[client_id] = []
        self.active_connections[client_id].append(websocket)
        self.subscribed_symbols[websocket] = []

    async def disconnect(self, websocket: WebSocket, client_id: str):
        if client_id in self.active_connections:
            self.active_connections[client_id].remove(websocket)
        if websocket in self.subscribed_symbols:
            del self.subscribed_symbols[websocket]

    async def subscribe(self, websocket: WebSocket, symbols: List[str]):
        self.subscribed_symbols[websocket] = symbols

    async def broadcast(self, data: Dict):
        for connections in self.active_connections.values():
            for connection in connections:
                try:
                    if 'symbol' in data and data['symbol'] in self.subscribed_symbols.get(connection, []):
                        await connection.send_json(data)
                except Exception as e:
                    logger.error(f"Error broadcasting: {str(e)}")


manager = MarketCompassConnectionManager()


# ============================================================================
# REST ENDPOINTS
# ============================================================================

@router.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "operational",
        "service": "Market Compass",
        "timestamp": datetime.now().isoformat(),
        "capabilities": [
            "Multi-market correlation analysis",
            "Global impact tracking",
            "Market regime detection",
            "Institutional flow tracking",
            "Sentiment and risk scoring",
            "Smart money positioning",
            "Real-time WebSocket streaming"
        ]
    }


@router.get("/correlation/{primary_symbol}")
async def get_correlations(
    primary_symbol: str = Path(..., description="Primary symbol (NIFTY, BANKNIFTY, SENSEX)"),
    lookback_bars: int = Query(100, description="Lookback period in bars")
):
    """Get correlation analysis for a symbol with other markets."""
    try:
        if primary_symbol not in market_compass_engine.all_symbols:
            raise HTTPException(status_code=400, detail=f"Invalid symbol: {primary_symbol}")
        
        correlations = []
        
        # Get cached correlations
        for cache_key, corr_data in market_compass_engine.correlation_cache.items():
            if cache_key.startswith(primary_symbol):
                correlations.append({
                    'symbol1': corr_data.symbol1,
                    'symbol2': corr_data.symbol2,
                    'correlation': round(corr_data.correlation_coefficient, 3),
                    'strength': corr_data.strength,
                    'lookback': corr_data.lookback_bars,
                    'timestamp': corr_data.timestamp.isoformat()
                })
        
        return {
            'primary_symbol': primary_symbol,
            'correlations': correlations,
            'count': len(correlations),
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Error getting correlations: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/market-structure/{symbol}")
async def get_market_structure(symbol: str = Path(...)):
    """Get market structure analysis for a symbol."""
    try:
        structure = market_compass_engine.structure_cache.get(symbol)
        
        if not structure:
            return JSONResponse({
                'symbol': symbol,
                'message': 'No structure data available yet',
                'timestamp': datetime.now().isoformat()
            }, status_code=202)
        
        return {
            'symbol': structure.symbol,
            'trend_type': structure.trend_type,
            'volatility_regime': structure.volatility_regime,
            'momentum_direction': structure.momentum_direction,
            'momentum_strength': round(structure.momentum_strength, 2),
            'structure_strength': round(structure.structure_strength, 2),
            'higher_timeframe_bias': structure.higher_timeframe_bias,
            'support_levels': [round(s, 2) for s in structure.support_levels],
            'resistance_levels': [round(r, 2) for r in structure.resistance_levels],
            'timestamp': structure.timestamp.isoformat()
        }
    except Exception as e:
        logger.error(f"Error getting structure: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/global-impact")
async def get_global_impact():
    """Get global market impact analysis."""
    try:
        global_impact = global_impact_analyzer.global_cache.get('current')
        
        if not global_impact:
            return JSONResponse({
                'message': 'No global impact data available',
                'timestamp': datetime.now().isoformat()
            }, status_code=202)
        
        return {
            'source_index': global_impact.source_index,
            'direction': global_impact.direction,
            'magnitude': round(global_impact.magnitude, 2),
            'time_to_open': global_impact.time_to_open,
            'expected_impact': global_impact.expected_impact,
            'confidence': round(global_impact.confidence, 2),
            'affected_sectors': global_impact.affected_sectors,
            'timestamp': global_impact.timestamp.isoformat()
        }
    except Exception as e:
        logger.error(f"Error getting global impact: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/institutional-flow/{symbol}")
async def get_institutional_flow(symbol: str = Path(...)):
    """Get institutional flow analysis."""
    try:
        fii_flow = global_impact_analyzer.flow_cache.get('FII')
        dii_flow = global_impact_analyzer.flow_cache.get('DII')
        
        return {
            'symbol': symbol,
            'fii': {
                'direction': fii_flow.direction if fii_flow else 'UNKNOWN',
                'net_flow': fii_flow.net_flow if fii_flow else 0,
                'intensity': round(fii_flow.intensity, 2) if fii_flow else 0
            } if fii_flow else None,
            'dii': {
                'direction': dii_flow.direction if dii_flow else 'UNKNOWN',
                'net_flow': dii_flow.net_flow if dii_flow else 0,
                'intensity': round(dii_flow.intensity, 2) if dii_flow else 0
            } if dii_flow else None,
            'net_bias': global_impact_analyzer._calculate_net_bias(),
            'accumulation_detected': global_impact_analyzer._detect_accumulation_patterns(),
            'distribution_detected': global_impact_analyzer._detect_distribution_patterns(),
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Error getting flow: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/market-regime/{symbol}")
async def get_market_regime(symbol: str = Path(...)):
    """Get market regime analysis."""
    try:
        regime = market_regime_detector.regime_cache.get(symbol)
        momentum = market_regime_detector.momentum_cache.get(symbol)
        liquidity = market_regime_detector.liquidity_cache.get(symbol)
        
        regime_data = {
            'symbol': symbol,
            'regime': {
                'type': regime.regime_type if regime else 'UNKNOWN',
                'sub_regime': regime.sub_regime if regime else 'UNKNOWN',
                'strength': round(regime.strength, 2) if regime else 0,
                'confidence': round(regime.confidence, 2) if regime else 0,
                'optimal_strategy': regime.optimal_strategy if regime else 'NEUTRAL'
            } if regime else None,
            'momentum': {
                'direction': momentum.direction if momentum else 'NEUTRAL',
                'strength': round(momentum.strength, 2) if momentum else 0,
                'acceleration': momentum.acceleration if momentum else 'SUSTAINING',
                'fatigue': round(momentum.fatigue_level, 2) if momentum else 0
            } if momentum else None,
            'liquidity': {
                'level': liquidity.liquidity_level if liquidity else 'UNKNOWN',
                'bid_ask_spread': round(liquidity.bid_ask_spread, 4) if liquidity else 0,
                'execution_difficulty': liquidity.execution_difficulty if liquidity else 'UNKNOWN'
            } if liquidity else None,
            'timestamp': datetime.now().isoformat()
        }
        
        return regime_data
    except Exception as e:
        logger.error(f"Error getting regime: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sentiment/{symbol}")
async def get_sentiment(symbol: str = Path(...)):
    """Get market sentiment analysis."""
    try:
        sentiment = sentiment_risk_scorer.sentiment_cache.get(symbol)
        
        if not sentiment:
            return JSONResponse({
                'symbol': symbol,
                'message': 'No sentiment data available',
                'timestamp': datetime.now().isoformat()
            }, status_code=202)
        
        return {
            'symbol': symbol,
            'overall_sentiment': sentiment.overall_sentiment,
            'sentiment_score': round(sentiment.sentiment_score, 2),
            'bullish_score': round(sentiment.bullish_score, 2),
            'bearish_score': round(sentiment.bearish_score, 2),
            'retail_sentiment': sentiment.retail_sentiment,
            'institutional_sentiment': sentiment.institutional_sentiment,
            'sentiment_momentum': sentiment.sentiment_momentum,
            'confidence': round(sentiment.confidence, 2),
            'timestamp': sentiment.timestamp.isoformat()
        }
    except Exception as e:
        logger.error(f"Error getting sentiment: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/risk-score/{symbol}")
async def get_risk_score(symbol: str = Path(...)):
    """Get comprehensive risk assessment."""
    try:
        risk = sentiment_risk_scorer.risk_cache.get(symbol)
        
        if not risk:
            return JSONResponse({
                'symbol': symbol,
                'message': 'No risk data available',
                'timestamp': datetime.now().isoformat()
            }, status_code=202)
        
        return {
            'symbol': symbol,
            'overall_risk': round(risk.overall_risk, 2),
            'market_risk': round(risk.market_risk, 2),
            'volatility_risk': round(risk.volatility_risk, 2),
            'correlation_risk': round(risk.correlation_risk, 2),
            'liquidity_risk': round(risk.liquidity_risk, 2),
            'gap_risk': round(risk.gap_risk, 2),
            'concentration_risk': round(risk.concentration_risk, 2),
            'risk_rating': risk.risk_rating,
            'risk_level_change': risk.risk_level_change,
            'primary_risks': risk.primary_risks,
            'hedge_recommendations': risk.hedge_recommendations,
            'timestamp': risk.timestamp.isoformat()
        }
    except Exception as e:
        logger.error(f"Error getting risk score: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/dashboard/{symbol}")
async def get_comprehensive_dashboard(
    symbol: str = Path(...),
    include_correlations: bool = Query(True)
):
    """Get comprehensive market compass dashboard."""
    try:
        # Gather all data
        structure = market_compass_engine.structure_cache.get(symbol)
        regime = market_regime_detector.regime_cache.get(symbol)
        sentiment = sentiment_risk_scorer.sentiment_cache.get(symbol)
        risk = sentiment_risk_scorer.risk_cache.get(symbol)
        
        dashboard = {
            'symbol': symbol,
            'structure': {
                'trend': structure.trend_type if structure else 'UNKNOWN',
                'momentum_direction': structure.momentum_direction if structure else 'NEUTRAL',
                'momentum_strength': round(structure.momentum_strength, 2) if structure else 0
            } if structure else None,
            'regime': {
                'type': regime.regime_type if regime else 'UNKNOWN',
                'strength': round(regime.strength, 2) if regime else 0
            } if regime else None,
            'sentiment': {
                'overall': sentiment.overall_sentiment if sentiment else 'NEUTRAL',
                'score': round(sentiment.sentiment_score, 2) if sentiment else 0
            } if sentiment else None,
            'risk': {
                'rating': risk.risk_rating if risk else 'UNKNOWN',
                'overall': round(risk.overall_risk, 2) if risk else 0
            } if risk else None,
            'timestamp': datetime.now().isoformat()
        }
        
        return dashboard
    except Exception as e:
        logger.error(f"Error getting dashboard: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# WEBSOCKET ENDPOINT
# ============================================================================

@ws_router.websocket("/ws/market-compass")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time market compass data."""
    client_id = None
    try:
        await websocket.accept()
        
        # Wait for subscription message
        message = await websocket.receive_text()
        subscription = json.loads(message)
        
        client_id = subscription.get('client_id', 'unknown')
        symbols = subscription.get('symbols', [])
        
        await manager.connect(websocket, client_id)
        await manager.subscribe(websocket, symbols)
        
        logger.info(f"Client {client_id} subscribed to {symbols}")
        
        # Send initial snapshot
        snapshot = {
            'type': 'snapshot',
            'symbols': symbols,
            'timestamp': datetime.now().isoformat()
        }
        await websocket.send_json(snapshot)
        
        # Keep connection alive
        while True:
            try:
                # Receive keep-alive messages
                message = await asyncio.wait_for(websocket.receive_text(), timeout=30)
                command = json.loads(message)
                
                if command.get('action') == 'subscribe':
                    await manager.subscribe(websocket, command.get('symbols', []))
                elif command.get('action') == 'unsubscribe':
                    pass  # Handle unsubscribe if needed
            except asyncio.TimeoutError:
                # Send keep-alive ping
                try:
                    await websocket.send_json({
                        'type': 'ping',
                        'timestamp': datetime.now().isoformat()
                    })
                except:
                    break
            except Exception as e:
                logger.error(f"Error in WebSocket loop: {str(e)}")
                break
    
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
    finally:
        if client_id:
            await manager.disconnect(websocket, client_id)
            logger.info(f"Client {client_id} disconnected")
