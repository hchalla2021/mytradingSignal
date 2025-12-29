"""
Buy-on-Dip Detection Service
Performance-optimized module for intraday dip-buying opportunities
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional
from datetime import datetime, timedelta
import logging
from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class BuyOnDipEngine:
    """
    High-performance Buy-on-Dip signal generator
    Optimized for intraday trading with minimal latency
    """
    
    def __init__(self, signal_threshold: int = None):
        """
        Initialize Buy-on-Dip engine
        
        Args:
            signal_threshold: Minimum score for BUY-ON-DIP signal (defaults to settings)
        """
        self.cache = {}  # Cache for avoiding redundant calculations
        self.signal_threshold = signal_threshold or settings.buy_on_dip_signal_threshold
        
    @staticmethod
    def calculate_ema(series: pd.Series, period: int) -> pd.Series:
        """Calculate Exponential Moving Average"""
        return series.ewm(span=period, adjust=False).mean()
    
    @staticmethod
    def calculate_rsi(series: pd.Series, period: int = 14) -> pd.Series:
        """Calculate Relative Strength Index"""
        delta = series.diff()
        gain = delta.where(delta > 0, 0).rolling(window=period).mean()
        loss = -delta.where(delta < 0, 0).rolling(window=period).mean()
        
        # Avoid division by zero
        rs = np.where(loss == 0, 100, gain / loss)
        rsi = 100 - (100 / (1 + rs))
        return pd.Series(rsi, index=series.index)
    
    @staticmethod
    def calculate_vwap(df: pd.DataFrame) -> pd.Series:
        """Calculate Volume Weighted Average Price"""
        typical_price = (df['high'] + df['low'] + df['close']) / 3
        return (typical_price * df['volume']).cumsum() / df['volume'].cumsum()
    
    def prepare_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Prepare all technical indicators efficiently
        Uses vectorized operations for performance
        """
        df = df.copy()
        
        # Ensure required columns exist
        required_cols = ['open', 'high', 'low', 'close', 'volume']
        if not all(col in df.columns for col in required_cols):
            raise ValueError(f"DataFrame must contain: {required_cols}")
        
        # Calculate indicators
        df['ema20'] = self.calculate_ema(df['close'], 20)
        df['ema50'] = self.calculate_ema(df['close'], 50)
        df['rsi'] = self.calculate_rsi(df['close'], 14)
        df['vwap'] = self.calculate_vwap(df)
        df['avg_volume'] = df['volume'].rolling(window=20).mean()
        
        # Price change metrics
        df['price_change'] = df['close'].pct_change() * 100
        df['high_low_range'] = ((df['high'] - df['low']) / df['low']) * 100
        
        return df
    
    def evaluate_buy_on_dip(self, df: pd.DataFrame) -> Dict:
        """
        Main evaluation logic for Buy-on-Dip signal
        
        Returns:
            Dict with signal, confidence, reasons, and metadata
        """
        try:
            # Prepare indicators
            df = self.prepare_indicators(df)
            
            # Get latest and previous candles
            if len(df) < 2:
                return self._no_signal_response("Insufficient data")
            
            latest = df.iloc[-1]
            prev = df.iloc[-2]
            
            # Initialize scoring
            score = 0
            max_score = 100
            reasons = []
            warnings = []
            
            # ===== EVALUATION CRITERIA =====
            
            # 1️⃣ TREND CHECK (20 points)
            if pd.notna(latest['ema50']) and latest['close'] > latest['ema50']:
                score += 20
                reasons.append("✅ Uptrend intact (Price > EMA50)")
            else:
                warnings.append("⚠️ Price below EMA50 (No uptrend)")
            
            # 2️⃣ DIP ZONE CHECK (20 points)
            if pd.notna(latest['ema20']) and pd.notna(latest['vwap']):
                dip_zone = min(latest['ema20'], latest['vwap']) * 0.997  # 0.3% below
                if latest['low'] <= dip_zone:
                    score += 20
                    reasons.append(f"✅ Price dipped into value zone (Low: {latest['low']:.2f} ≤ {dip_zone:.2f})")
                else:
                    warnings.append("⚠️ No dip into value zone")
            
            # 3️⃣ RSI PULLBACK (15 points)
            if pd.notna(latest['rsi']):
                if 35 < latest['rsi'] < 55:
                    score += 15
                    reasons.append(f"✅ Healthy pullback RSI ({latest['rsi']:.1f})")
                elif latest['rsi'] <= 35:
                    warnings.append(f"⚠️ RSI oversold ({latest['rsi']:.1f}) - too weak")
                else:
                    warnings.append(f"⚠️ RSI too high ({latest['rsi']:.1f}) - no pullback")
            
            # 4️⃣ VOLUME ANALYSIS (15 points)
            if pd.notna(latest['avg_volume']) and latest['avg_volume'] > 0:
                vol_ratio = latest['volume'] / latest['avg_volume']
                if vol_ratio < 0.8:
                    score += 15
                    reasons.append(f"✅ Weak selling pressure (Vol: {vol_ratio:.1%} of avg)")
                else:
                    warnings.append(f"⚠️ High volume ({vol_ratio:.1%}) - strong selling")
            
            # 5️⃣ BUYER CONFIRMATION CANDLE (20 points)
            is_bullish = latest['close'] > latest['open']
            is_higher_close = latest['close'] > prev['close']
            
            if is_bullish and is_higher_close:
                score += 20
                reasons.append("✅ Buyer confirmation (Bullish candle + higher close)")
            elif is_bullish:
                score += 10
                reasons.append("✅ Bullish candle (partial confirmation)")
            else:
                warnings.append("⚠️ No buyer confirmation")
            
            # 6️⃣ CANDLE PATTERN ANALYSIS (10 points)
            body = abs(latest['close'] - latest['open'])
            total_range = latest['high'] - latest['low']
            
            if total_range > 0:
                body_ratio = body / total_range
                if body_ratio > 0.6 and is_bullish:
                    score += 10
                    reasons.append("✅ Strong bullish body")
            
            # ===== FINAL DECISION =====
            signal = "BUY-ON-DIP" if score >= self.signal_threshold else "NO BUY-ON-DIP"
            
            return {
                "signal": signal,
                "confidence": score,
                "max_score": max_score,
                "percentage": round((score / max_score) * 100, 1),
                "threshold": self.signal_threshold,
                "reasons": reasons,
                "warnings": warnings,
                "price": float(latest['close']),
                "timestamp": datetime.now().isoformat(),
                "indicators": {
                    "ema20": float(latest['ema20']) if pd.notna(latest['ema20']) else None,
                    "ema50": float(latest['ema50']) if pd.notna(latest['ema50']) else None,
                    "rsi": float(latest['rsi']) if pd.notna(latest['rsi']) else None,
                    "vwap": float(latest['vwap']) if pd.notna(latest['vwap']) else None,
                    "volume_ratio": float(latest['volume'] / latest['avg_volume']) if pd.notna(latest['avg_volume']) and latest['avg_volume'] > 0 else None
                },
                "candle_info": {
                    "open": float(latest['open']),
                    "high": float(latest['high']),
                    "low": float(latest['low']),
                    "close": float(latest['close']),
                    "volume": int(latest['volume']),
                    "is_bullish": is_bullish
                }
            }
            
        except Exception as e:
            logger.error(f"Error in buy_on_dip evaluation: {str(e)}")
            return self._no_signal_response(f"Error: {str(e)}")
    
    def _no_signal_response(self, reason: str) -> Dict:
        """Return standardized no-signal response"""
        return {
            "signal": "NO BUY-ON-DIP",
            "confidence": 0,
            "max_score": 100,
            "percentage": 0,
            "reasons": [],
            "warnings": [reason],
            "price": 0.0,
            "timestamp": datetime.now().isoformat(),
            "indicators": {},
            "candle_info": {}
        }
    
    def evaluate_multiple_timeframes(self, df_dict: Dict[str, pd.DataFrame]) -> Dict:
        """
        Evaluate Buy-on-Dip across multiple timeframes
        
        Args:
            df_dict: Dict with keys like '5min', '15min', '1hour' and DataFrame values
            
        Returns:
            Aggregated signal across timeframes
        """
        results = {}
        total_score = 0
        
        for timeframe, df in df_dict.items():
            result = self.evaluate_buy_on_dip(df)
            results[timeframe] = result
            total_score += result['confidence']
        
        avg_score = total_score / len(df_dict) if df_dict else 0
        
        return {
            "multi_timeframe_signal": "BUY-ON-DIP" if avg_score >= self.signal_threshold else "NO BUY-ON-DIP",
            "average_confidence": avg_score,
            "threshold": self.signal_threshold,
            "timeframe_results": results,
            "timestamp": datetime.now().isoformat()
        }


# Global instance for reuse
buy_on_dip_engine = BuyOnDipEngine()


def get_buy_on_dip_signal(df: pd.DataFrame) -> Dict:
    """
    Convenience function to get Buy-on-Dip signal
    
    Args:
        df: DataFrame with OHLCV data
        
    Returns:
        Signal dictionary
    """
    return buy_on_dip_engine.evaluate_buy_on_dip(df)
