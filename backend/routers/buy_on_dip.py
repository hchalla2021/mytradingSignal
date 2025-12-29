"""
Buy-on-Dip API Router
Real-time Buy-on-Dip signals via REST and WebSocket
"""

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from typing import Dict, List, Optional
from datetime import datetime, timedelta
import pandas as pd
import asyncio
import logging

from services.buy_on_dip_service import get_buy_on_dip_signal, buy_on_dip_engine
from kiteconnect import KiteConnect
from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/api/buy-on-dip", tags=["Buy-on-Dip"])


def get_instrument_tokens() -> Dict[str, int]:
    """
    Get instrument tokens from settings
    
    ⚠️ IMPORTANT: Uses FUTURES tokens for volume data!
    Indices (NIFTY, BANKNIFTY) don't have volume, but futures do.
    This gives us real traded volume for accurate dip detection.
    """
    return {
        "NIFTY": settings.nifty_fut_token,      # Use futures for volume data
        "BANKNIFTY": settings.banknifty_fut_token,  # Use futures for volume data
        "SENSEX": settings.sensex_fut_token,    # Use futures for volume data
        "FINNIFTY": settings.finnifty_token,    # No futures token configured yet
        "MIDCPNIFTY": settings.midcpnifty_token # No futures token configured yet
    }


def get_kite_client():
    """Get authenticated Kite client"""
    if not settings.zerodha_api_key or not settings.zerodha_access_token:
        raise HTTPException(status_code=500, detail="Zerodha credentials not configured")
    
    kite = KiteConnect(api_key=settings.zerodha_api_key)
    kite.set_access_token(settings.zerodha_access_token)
    return kite


def fetch_historical_data(
    symbol: str,
    interval: str = None,
    days: int = None
) -> pd.DataFrame:
    """
    Fetch historical candle data from Zerodha
    
    Args:
        symbol: Index symbol (NIFTY, BANKNIFTY, etc.)
        interval: Candle interval
        days: Number of days of history
        
    Returns:
        DataFrame with OHLCV data
        
    Note: Uses FUTURES tokens to get real volume data!
    """
    # Use settings defaults if not provided
    if interval is None:
        interval = settings.buy_on_dip_default_interval
    if days is None:
        days = settings.buy_on_dip_lookback_days
    
    try:
        kite = get_kite_client()
        instrument_tokens = get_instrument_tokens()
        token = instrument_tokens.get(symbol)
        
        if not token:
            raise ValueError(f"Unknown symbol: {symbol}")
        
        logger.info(f"[BUY-ON-DIP] 🔄 Fetching {symbol} data using token {token} (futures for volume)")
        
        to_date = datetime.now()
        from_date = to_date - timedelta(days=days)
        
        data = kite.historical_data(
            instrument_token=token,
            from_date=from_date,
            to_date=to_date,
            interval=interval
        )
        
        df = pd.DataFrame(data)
        
        # Ensure required columns
        if df.empty:
            logger.warning(f"[BUY-ON-DIP] ⚠️ No data received for {symbol}")
            raise ValueError("No data received from Zerodha")
        
        # Log volume stats
        total_volume = df['volume'].sum() if 'volume' in df.columns else 0
        avg_volume = df['volume'].mean() if 'volume' in df.columns else 0
        
        logger.info(f"[BUY-ON-DIP] ✅ Fetched {len(df)} candles for {symbol}")
        logger.info(f"[BUY-ON-DIP] 📊 Volume stats: Total={total_volume:,.0f}, Avg={avg_volume:,.0f}/candle")
        
        return df
        
    except Exception as e:
        logger.error(f"Error fetching data for {symbol}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch data: {str(e)}")


@router.get("/signal/{symbol}")
async def get_signal(
    symbol: str,
    interval: str = None
) -> Dict:
    """
    Get current Buy-on-Dip signal for a symbol
    
    Args:
        symbol: Index symbol (NIFTY, BANKNIFTY, SENSEX, etc.)
        interval: Candle interval (defaults to settings)
        
    Returns:
        Buy-on-Dip signal with confidence and reasons
    """
    try:
        # Use default from settings if not provided
        if interval is None:
            interval = settings.buy_on_dip_default_interval
            
        # Fetch historical data
        df = fetch_historical_data(symbol, interval)
        
        # Get signal
        signal = get_buy_on_dip_signal(df)
        signal['symbol'] = symbol
        signal['interval'] = interval
        
        return signal
        
    except Exception as e:
        logger.error(f"Error getting signal for {symbol}: {str(e)}")
        # Return fallback instead of error
        return {
            "signal": "NO BUY-ON-DIP",
            "confidence": 0,
            "max_score": 0,
            "percentage": 0,
            "reasons": ["Service unavailable - waiting for data"],
            "warnings": [f"Error: {str(e)[:100]}"],
            "price": 0,
            "timestamp": datetime.now().isoformat(),
            "symbol": symbol,
            "interval": interval or settings.buy_on_dip_default_interval,
            "indicators": {},
            "candle_info": {
                "open": 0,
                "high": 0,
                "low": 0,
                "close": 0,
                "volume": 0,
                "is_bullish": False
            },
            "status": "WAITING",
            "error": "Data unavailable"
        }


@router.get("/signal/{symbol}/multi-timeframe")
async def get_multi_timeframe_signal(
    symbol: str
) -> Dict:
    """
    Get Buy-on-Dip signal across multiple timeframes
    
    Args:
        symbol: Index symbol
        
    Returns:
        Aggregated signal across 5min, 15min, and 1hour timeframes
    """
    try:
        timeframes = ["5minute", "15minute", "60minute"]
        df_dict = {}
        
        for tf in timeframes:
            df = fetch_historical_data(symbol, tf)
            df_dict[tf] = df
        
        result = buy_on_dip_engine.evaluate_multiple_timeframes(df_dict)
        result['symbol'] = symbol
        
        return result
        
    except Exception as e:
        logger.error(f"Error getting multi-timeframe signal for {symbol}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/signals/all")
async def get_all_signals(
    interval: str = None
) -> Dict[str, Dict]:
    """
    Get Buy-on-Dip signals for all tracked indices
    
    Returns:
        Dictionary with signals for each index
    """
    try:
        # Use default from settings if not provided
        if interval is None:
            interval = settings.buy_on_dip_default_interval
            
        signals = {}
        instrument_tokens = get_instrument_tokens()
        
        for symbol in instrument_tokens.keys():
            try:
                df = fetch_historical_data(symbol, interval)
                signal = get_buy_on_dip_signal(df)
                signal['symbol'] = symbol
                signal['interval'] = interval
                signals[symbol] = signal
            except Exception as e:
                logger.error(f"Error processing {symbol}: {str(e)}")
                signals[symbol] = {
                    "signal": "ERROR",
                    "error": str(e),
                    "symbol": symbol
                }
        
        return signals
        
    except Exception as e:
        logger.error(f"Error getting all signals: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# WebSocket connection manager
class BuyOnDipConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
    
    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"Client connected. Total connections: {len(self.active_connections)}")
    
    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)
        logger.info(f"Client disconnected. Total connections: {len(self.active_connections)}")
    
    async def broadcast(self, message: dict):
        """Broadcast message to all connected clients"""
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"Error broadcasting: {str(e)}")


manager = BuyOnDipConnectionManager()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time Buy-on-Dip signals
    Broadcasts updates based on configured interval
    """
    await manager.connect(websocket)
    
    try:
        # Send initial data
        try:
            signals = {}
            instrument_tokens = get_instrument_tokens()
            
            for symbol in instrument_tokens.keys():
                df = fetch_historical_data(symbol, settings.buy_on_dip_default_interval)
                signal = get_buy_on_dip_signal(df)
                signal['symbol'] = symbol
                signals[symbol] = signal
            
            await websocket.send_json({
                "type": "initial",
                "data": signals,
                "timestamp": datetime.now().isoformat()
            })
        except Exception as e:
            logger.error(f"Error sending initial data: {str(e)}")
        
        # Continuous update loop
        while True:
            try:
                # Wait for configured interval between updates
                await asyncio.sleep(settings.buy_on_dip_update_interval)
                
                # Fetch fresh signals
                signals = {}
                instrument_tokens = get_instrument_tokens()
                
                for symbol in instrument_tokens.keys():
                    try:
                        df = fetch_historical_data(symbol, settings.buy_on_dip_default_interval)
                        signal = get_buy_on_dip_signal(df)
                        signal['symbol'] = symbol
                        signals[symbol] = signal
                    except Exception as e:
                        logger.error(f"Error processing {symbol}: {str(e)}")
                
                # Broadcast to all clients
                await manager.broadcast({
                    "type": "update",
                    "data": signals,
                    "timestamp": datetime.now().isoformat()
                })
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in WebSocket loop: {str(e)}")
                await asyncio.sleep(10)  # Wait before retry
    
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
        manager.disconnect(websocket)


@router.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "buy-on-dip",
        "timestamp": datetime.now().isoformat(),
        "active_connections": len(manager.active_connections)
    }
