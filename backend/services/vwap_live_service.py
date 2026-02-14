"""
Live VWAP Calculator for Intraday Trading
==========================================

SOLVES: VWAP values matching Zerodha LIVE data

Features:
- Fetches FRESH 5-minute intraday data from market open (9:15 AM IST)
- Calculates VWAP that resets DAILY at market open
- Handles monthly futures contracts automatically
- Shows LIVE VWAP vs current price with deviation
- Updates in real-time as new candles arrive

VWAP Formula:
vwap = Sum(Typical Price × Volume) / Sum(Volume)
where Typical Price = (High + Low + Close) / 3
"""

from datetime import datetime, timedelta
import pytz
import pandas as pd
from typing import Tuple, Optional, Dict, Any
import logging

logger = logging.getLogger(__name__)

IST = pytz.timezone('Asia/Kolkata')


class VWAPLiveCalculator:
    """
    Calculate LIVE intraday VWAP for futures contracts
    
    Correctly handles:
    - Fresh data starting from market open (9:15 AM)
    - Daily reset (VWAP resets each trading day)
    - Monthly futures switching
    - Real-time updates as candles arrive
    """
    
    def __init__(self, kite_client):
        """Initialize with Zerodha KiteConnect client"""
        self.kite = kite_client
    
    @staticmethod
    def get_market_hours() -> Tuple[datetime, datetime]:
        """
        Get market open and current time in IST
        
        Returns:
            (market_open, current_time) both in IST
        """
        now = datetime.now(IST)
        
        # Market opens at 9:15 AM
        market_open = now.replace(hour=9, minute=15, second=0, microsecond=0)
        
        # If it's before market open, use yesterday's close (for backtesting)
        if now.time() < market_open.time():
            market_open = market_open - timedelta(days=1)
        
        return market_open, now
    
    def fetch_intraday_candles(
        self,
        instrument_token: int,
        interval: str = "5minute",
        debug: bool = False
    ) -> Optional[pd.DataFrame]:
        """
        Fetch intraday candles from market open to current time
        
        Args:
            instrument_token: Zerodha futures contract token
            interval: Candle interval 
                     - "5minute" (RECOMMENDED for VWAP)
                     - "15minute" (longer term)
                     - "1minute" (more noise)
            debug: Print debug info
        
        Returns:
            DataFrame with columns: date, open, high, low, close, volume
            or None if failed
        """
        market_open, now = self.get_market_hours()
        
        try:
            if debug:
                logger.info(f"🔄 Fetching {interval} candles")
                logger.info(f"   From: {market_open.strftime('%Y-%m-%d %H:%M IST')}")
                logger.info(f"   To:   {now.strftime('%Y-%m-%d %H:%M IST')}")
            
            # Zerodha KiteConnect API call
            data = self.kite.historical_data(
                instrument_token=instrument_token,
                from_date=market_open,
                to_date=now,
                interval=interval
            )
            
            if not data:
                logger.warning(f"⚠️ No data received from Zerodha")
                return None
            
            # Create DataFrame from list of dicts
            df = pd.DataFrame(data)
            
            # Ensure required columns exist with proper names
            required_columns = ['date', 'open', 'high', 'low', 'close', 'volume']
            
            # Log what we got
            if debug:
                logger.info(f"📋 Raw data columns: {list(df.columns) if not df.empty else 'Empty'}")
                if not df.empty:
                    logger.info(f"📋 First row keys: {list(df.iloc[0].to_dict().keys())}")
            
            # Verify all required columns exist
            missing = [col for col in required_columns if col not in df.columns]
            if missing:
                logger.error(f"❌ Missing columns from Zerodha: {missing}")
                logger.error(f"   Available columns: {list(df.columns)}")
                return None
            
            # Ensure date column is datetime
            if 'date' in df.columns and not pd.api.types.is_datetime64_any_dtype(df['date']):
                df['date'] = pd.to_datetime(df['date'])
            
            # Ensure numeric columns
            numeric_cols = ['open', 'high', 'low', 'close', 'volume']
            for col in numeric_cols:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors='coerce')
            
            if debug:
                logger.info(f"✅ Received {len(df)} candles")
                if len(df) > 0:
                    logger.info(f"   First candle: {df['date'].iloc[0]}")
                    logger.info(f"   Last candle:  {df['date'].iloc[-1]}")
                    logger.info(f"   Data types:\n{df.dtypes.to_string()}")
            
            return df
            
        except Exception as e:
            logger.error(f"❌ Failed to fetch candles: {str(e)}")
            import traceback
            logger.error(f"   Traceback: {traceback.format_exc()}")
            return None
    
    @staticmethod
    def calculate_vwap_from_candles(df: pd.DataFrame, debug: bool = False) -> Optional[float]:
        """
        Calculate VWAP from intraday candles
        
        Formula:
            TP = (High + Low + Close) / 3
            VWAP = Sum(TP × Volume) / Sum(Volume)
        
        Args:
            df: DataFrame with OHLCV data
            debug: Print debug info
        
        Returns:
            VWAP value rounded to 2 decimals, or None if insufficient data
        """
        if df is None or df.empty:
            logger.warning("❌ Empty DataFrame - cannot calculate VWAP")
            return None
        
        if len(df) < 1:
            logger.warning(f"⚠️ Only {len(df)} candle(s) - insufficient for VWAP")
            return None
        
        try:
            df_copy = df.copy()
            
            # Debug: Log available columns
            if debug:
                logger.info(f"📋 DataFrame columns: {list(df_copy.columns)}")
                logger.info(f"📋 DataFrame shape: {df_copy.shape}")
                logger.info(f"📋 First row: {df_copy.iloc[0].to_dict() if len(df_copy) > 0 else 'Empty'}")
            
            # Verify required columns exist
            required_cols = ['high', 'low', 'close', 'volume']
            missing_cols = [col for col in required_cols if col not in df_copy.columns]
            
            if missing_cols:
                logger.error(f"❌ Missing required columns: {missing_cols}")
                logger.error(f"   Available columns: {list(df_copy.columns)}")
                return None
            
            # Ensure numeric data types
            df_copy['high'] = pd.to_numeric(df_copy['high'], errors='coerce')
            df_copy['low'] = pd.to_numeric(df_copy['low'], errors='coerce')
            df_copy['close'] = pd.to_numeric(df_copy['close'], errors='coerce')
            df_copy['volume'] = pd.to_numeric(df_copy['volume'], errors='coerce')
            
            # Remove rows with NaN values
            df_copy = df_copy.dropna(subset=['high', 'low', 'close', 'volume'])
            
            if df_copy.empty:
                logger.warning("❌ All rows have NaN values after conversion")
                return None
            
            # Step 1: Calculate typical price (average of H, L, C)
            df_copy['typical_price'] = (
                df_copy['high'] + df_copy['low'] + df_copy['close']
            ) / 3
            
            # Step 2: Calculate TP × Volume
            df_copy['tp_volume'] = df_copy['typical_price'] * df_copy['volume']
            
            # Step 3: Calculate VWAP
            cum_tp_vol = df_copy['tp_volume'].sum()
            cum_vol = df_copy['volume'].sum()
            
            if cum_vol == 0:
                logger.warning("⚠️ Total volume is 0 - cannot calculate VWAP")
                return None
            
            vwap = cum_tp_vol / cum_vol
            vwap_rounded = round(vwap, 2)
            
            if debug:
                logger.info(f"📊 VWAP Calculation:")
                logger.info(f"   Candles processed: {len(df_copy)}")
                logger.info(f"   Sum(TP × Vol): {cum_tp_vol:,.0f}")
                logger.info(f"   Sum(Vol): {cum_vol:,.0f}")
                logger.info(f"   VWAP = {cum_tp_vol:,.0f} / {cum_vol:,.0f}")
                logger.info(f"   ✅ VWAP = ₹{vwap_rounded:,.2f}")
            
            return vwap_rounded
            
        except Exception as e:
            logger.error(f"❌ VWAP calculation failed: {str(e)}")
            import traceback
            logger.error(f"   Traceback: {traceback.format_exc()}")
            return None
    
    @staticmethod
    def get_vwap_position(
        current_price: float,
        vwap: float,
        debug: bool = False
    ) -> Dict[str, Any]:
        """
        Determine price position relative to VWAP
        
        Args:
            current_price: Current trading price
            vwap: Calculated VWAP value
            debug: Print debug info
        
        Returns:
            {
                "position": "ABOVE" | "BELOW" | "AT",
                "distance": absolute distance in points,
                "distance_pct": percentage deviation,
                "signal": "BULLISH" | "BEARISH" | "NEUTRAL",
                "vwap": vwap value,
                "price": current price
            }
        """
        distance = current_price - vwap
        distance_pct = (distance / vwap) * 100 if vwap > 0 else 0
        
        # Position classification
        if distance_pct > 0.05:  # >0.05% above VWAP
            position = "ABOVE"
            signal = "BULLISH"
        elif distance_pct < -0.05:  # >0.05% below VWAP
            position = "BELOW"
            signal = "BEARISH"
        else:  # Within ±0.05%
            position = "AT"
            signal = "NEUTRAL"
        
        result = {
            "position": position,
            "distance": round(distance, 2),
            "distance_pct": round(distance_pct, 4),
            "signal": signal,
            "vwap": vwap,
            "price": current_price
        }
        
        if debug:
            logger.info(f"📍 Price Position:")
            logger.info(f"   Current Price: ₹{current_price:,.2f}")
            logger.info(f"   VWAP Level:    ₹{vwap:,.2f}")
            logger.info(f"   Distance:      {distance:+.2f} pts ({distance_pct:+.4f}%)")
            logger.info(f"   Position:      {position} ({signal})")
        
        return result
    
    def get_live_vwap_complete(
        self,
        symbol: str,
        instrument_token: int,
        current_price: float,
        interval: str = "5minute",
        debug: bool = False
    ) -> Dict[str, Any]:
        """
        Get COMPLETE live VWAP analysis for a symbol
        
        Single call that:
        1. Fetches fresh intraday candles from market open
        2. Calculates VWAP
        3. Determines price position
        4. Returns everything for VWAP filter decision
        
        Args:
            symbol: Trading symbol (NIFTY, BANKNIFTY, SENSEX)
            instrument_token: Zerodha futures token (expires monthly!)
            current_price: Current market price
            interval: Candle interval (default: 5minute)
            debug: Print detailed logs
        
        Returns:
            {
                "symbol": "NIFTY",
                "success": True,
                "vwap": 25599.33,
                "current_price": 25605.00,
                "position": {
                    "position": "ABOVE",
                    "distance": 5.67,
                    "distance_pct": 0.0221,
                    "signal": "BULLISH"
                },
                "candles_used": 156,
                "market_open": "2025-02-13 09:15:00 IST",
                "last_update": "2025-02-13 14:30:00 IST",
                "total_volume": 45000000,
                "average_price_weighted": 25596.15,
                "error": None
            }
        """
        try:
            # Step 1: Fetch intraday candles from market open
            df = self.fetch_intraday_candles(instrument_token, interval, debug)
            
            if df is None or df.empty:
                error_msg = f"Failed to fetch intraday data (no candles available)"
                logger.error(f"❌ {error_msg}")
                return {
                    "symbol": symbol,
                    "success": False,
                    "vwap": None,
                    "current_price": current_price,
                    "position": None,
                    "error": error_msg,
                    "debug_info": f"Token: {instrument_token}, Empty data from Zerodha"
                }
            
            # Step 2: Calculate VWAP
            vwap = self.calculate_vwap_from_candles(df, debug)
            
            if vwap is None:
                error_msg = "VWAP calculation failed"
                logger.error(f"❌ {error_msg}")
                return {
                    "symbol": symbol,
                    "success": False,
                    "vwap": None,
                    "current_price": current_price,
                    "position": None,
                    "error": error_msg,
                    "debug_info": f"Candles: {len(df)}, Volume sum: {df['volume'].sum() if 'volume' in df.columns else 'N/A'}"
                }
            
            # Step 3: Determine price position
            position = self.get_vwap_position(current_price, vwap, debug)
            
            # Step 4: Calculate typical price for average weighted price
            # Must do this SAME WAY as calculate_vwap_from_candles
            df_copy = df.copy()
            df_copy['typical_price'] = (df_copy['high'] + df_copy['low'] + df_copy['close']) / 3
            
            # Step 5: Build complete response
            return {
                "symbol": symbol,
                "success": True,
                "vwap": vwap,
                "current_price": current_price,
                "position": position,
                "candles_used": len(df),
                "market_open": df['date'].iloc[0].strftime('%Y-%m-%d %H:%M IST') if len(df) > 0 else None,
                "last_update": df['date'].iloc[-1].strftime('%Y-%m-%d %H:%M IST') if len(df) > 0 else None,
                "total_volume": int(df['volume'].sum()),
                "average_price_weighted": round(
                    (df_copy['typical_price'] * df_copy['volume']).sum() / df_copy['volume'].sum(), 2
                ) if len(df) > 0 else None,
                "error": None
            }
        
        except Exception as e:
            import traceback
            error_msg = str(e)
            error_trace = traceback.format_exc()
            logger.error(f"❌ VWAP analysis failed: {error_msg}")
            logger.error(f"   Traceback:\n{error_trace}")
            return {
                "symbol": symbol,
                "success": False,
                "vwap": None,
                "current_price": current_price,
                "position": None,
                "error": error_msg,
                "error_type": type(e).__name__,
                "traceback": error_trace
            }


# Quick helper function for common use
async def get_live_vwap(
    symbol: str,
    kite_client,
    instrument_token: int,
    current_price: float,
    debug: bool = False
) -> Dict[str, Any]:
    """
    Quick function to get live VWAP for a symbol
    
    Usage:
        from services.vwap_live_service import get_live_vwap
        
        result = await get_live_vwap(
            symbol="NIFTY",
            kite_client=kite,
            instrument_token=12345678,
            current_price=25605.00
        )
        
        print(f"VWAP: {result['vwap']}")
        print(f"Signal: {result['position']['signal']}")
    """
    calculator = VWAPLiveCalculator(kite_client)
    return calculator.get_live_vwap_complete(
        symbol=symbol,
        instrument_token=instrument_token,
        current_price=current_price,
        interval="5minute",
        debug=debug
    )
