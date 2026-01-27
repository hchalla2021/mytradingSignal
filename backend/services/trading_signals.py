"""
Professional Trading Signals Engine
====================================
Real-time EMA-based signal generation with risk management
Supports: NIFTY, BANKNIFTY, SENSEX

Uses proper exponential moving average (EMA) calculations with:
- EMA 20/50/100/200 Professional Trend Filter
- Crossover detection for entry signals
- Risk/Reward management
- Multi-timeframe analysis capability

Production-ready for intraday trading
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Tuple
from datetime import datetime
from dataclasses import dataclass

from config.ema_config import get_trend_filter, get_ema_config


@dataclass
class TradeSignal:
    """Professional trade signal data structure"""
    timestamp: datetime
    symbol: str
    signal: str           # BUY, SELL, HOLD
    entry_price: float
    stop_loss: float
    target: float
    bias: str            # BULL, BEAR, SIDEWAYS
    confidence: float    # 0.0 - 1.0
    ema_20: float
    ema_50: float
    ema_100: float
    ema_200: float
    reasons: List[str]


# ============================================
# 1) EMA CALCULATION - Professional
# ============================================

def add_ema(df: pd.DataFrame, period: int, col: str = "close") -> pd.Series:
    """
    Calculate Exponential Moving Average (EMA)
    
    More responsive than SMA - gives more weight to recent prices
    Formula: EMA = Price × (2/(Period+1)) + EMA_prev × (1 - 2/(Period+1))
    
    Args:
        df: OHLCV DataFrame with OHLC data
        period: EMA period (20, 50, 100, 200)
        col: Column to calculate EMA on (default: close)
    
    Returns:
        pd.Series with EMA values
    """
    return df[col].ewm(span=period, adjust=False).mean()


def add_vwma(df: pd.DataFrame, period: int, col: str = "close") -> pd.Series:
    """
    Calculate Volume Weighted Moving Average (VWMA)
    
    Uses volume as weight - gives more importance to high-volume closes
    Formula: VWMA = SUM(Close × Volume) / SUM(Volume)
    
    Args:
        df: OHLCV DataFrame with OHLC and volume data
        period: VWMA period (default: 20 for intraday)
        col: Column to calculate VWMA on (default: close)
    
    Returns:
        pd.Series with VWMA values
    """
    if 'volume' not in df.columns or df['volume'].sum() == 0:
        # Fallback to SMA if volume not available
        return df[col].rolling(window=period).mean()
    
    typical_price_vol = df[col] * df['volume']
    vwma = typical_price_vol.rolling(window=period).sum() / df['volume'].rolling(window=period).sum()
    return vwma


def apply_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """
    Apply all indicators to the dataframe
    
    Calculates:
    - EMA 20 (fast, entry signal)
    - EMA 50 (medium-term trend)
    - EMA 100 (trend confirmation)
    - EMA 200 (anchor/bias)
    - VWMA 20 (volume-weighted short-term trend)
    
    Args:
        df: OHLCV DataFrame
    
    Returns:
        DataFrame with all EMAs and VWMA added
    """
    df = df.copy()
    
    # Get configured EMA periods (can be switched between configs)
    config = get_ema_config()
    
    df["ema20"] = add_ema(df, config["ema_20"], "close")
    df["ema50"] = add_ema(df, config["ema_50"], "close")
    df["ema100"] = add_ema(df, config["ema_100"], "close")
    df["ema200"] = add_ema(df, config["ema_200"], "close")
    df["vwma20"] = add_vwma(df, 20, "close")
    
    return df


# ============================================
# 2) CROSSOVER DETECTION - Precise
# ============================================

def crossed_above(series_fast: pd.Series, series_slow: pd.Series) -> pd.Series:
    """
    Detect when fast series crosses above slow series
    
    Looks at previous bar: fast <= slow
    Current bar: fast > slow
    This ensures we catch the exact crossing point
    
    Args:
        series_fast: Faster moving average/price series
        series_slow: Slower moving average series
    
    Returns:
        Boolean series marking crossover points
    """
    return (series_fast.shift(1) <= series_slow.shift(1)) & (series_fast > series_slow)


def crossed_below(series_fast: pd.Series, series_slow: pd.Series) -> pd.Series:
    """
    Detect when fast series crosses below slow series
    
    Args:
        series_fast: Faster moving average/price series
        series_slow: Slower moving average series
    
    Returns:
        Boolean series marking crossover points
    """
    return (series_fast.shift(1) >= series_slow.shift(1)) & (series_fast < series_slow)


# ============================================
# 3) TREND FILTER - 200 EMA Anchor
# ============================================

def determine_market_bias(row: pd.Series) -> str:
    """
    Determine overall market bias using 200 EMA (anchor)
    
    Rules:
    - BULL: Price above 200 EMA (bullish bias)
    - BEAR: Price below 200 EMA (bearish bias)
    - SIDEWAYS: Price at/near 200 EMA (consolidation)
    
    200 EMA represents long-term trend and support/resistance
    
    Args:
        row: DataFrame row with price and EMA200
    
    Returns:
        Bias string: BULL, BEAR, or SIDEWAYS
    """
    price = row["close"]
    ema200 = row["ema200"]
    
    # Keep 0.5% threshold for "near" the EMA
    threshold = ema200 * 0.005
    
    if price > ema200 + threshold:
        return "BULL"
    elif price < ema200 - threshold:
        return "BEAR"
    else:
        return "SIDEWAYS"


# ============================================
# 4) ENTRY SIGNAL LOGIC - Professional Rules
# ============================================

def generate_entry_signal(row: pd.Series) -> str:
    """
    Professional entry signal generation
    
    BUY Conditions:
    1. Market bias is BULL (price > 200 EMA)
    2. 20 EMA crosses above 50 EMA (uptrend starting)
    3. Optional: Price above 50 EMA confirms strength
    
    SELL Conditions:
    1. Market bias is BEAR (price < 200 EMA)
    2. 20 EMA crosses below 50 EMA (downtrend starting)
    3. Optional: Price below 50 EMA confirms weakness
    
    HOLD: Waiting for clear signal
    
    Args:
        row: DataFrame row with EMAs and crossover signals
    
    Returns:
        Signal: BUY, SELL, or HOLD
    """
    bias = row.get("bias", "SIDEWAYS")
    buy_cross = row.get("buy_cross", False)
    sell_cross = row.get("sell_cross", False)
    price = row.get("close", 0)
    ema50 = row.get("ema50", 0)
    
    # BULLISH ENTRY
    if bias == "BULL" and buy_cross:
        # Extra confirmation: price should be above 50 EMA
        if price >= ema50:
            return "BUY"
    
    # BEARISH ENTRY
    if bias == "BEAR" and sell_cross:
        # Extra confirmation: price should be below 50 EMA
        if price <= ema50:
            return "SELL"
    
    return "HOLD"


# ============================================
# 5) RISK MANAGEMENT - Professional SL/Target
# ============================================

def calculate_risk_reward(
    entry_price: float,
    direction: str,
    sl_points: float,
    rr_ratio: float = 2.0
) -> Tuple[float, float]:
    """
    Calculate Stop Loss and Target using Risk/Reward ratio
    
    Professional approach:
    - Define SL points (how much we're willing to lose)
    - Target is calculated as SL × Risk:Reward ratio
    
    Example:
    - Entry: 20000
    - SL: 50 points = 19950 (for BUY)
    - Target with 1:2 RR: 20100 (50×2 away from entry)
    
    Args:
        entry_price: Entry price
        direction: "BUY" or "SELL"
        sl_points: How many points for stop loss
        rr_ratio: Risk:Reward ratio (default 1:2)
    
    Returns:
        Tuple: (stop_loss, target)
    """
    if direction == "BUY":
        stop_loss = entry_price - sl_points
        target = entry_price + (sl_points * rr_ratio)
    elif direction == "SELL":
        stop_loss = entry_price + sl_points
        target = entry_price - (sl_points * rr_ratio)
    else:
        raise ValueError(f"Invalid direction: {direction}")
    
    return round(stop_loss, 2), round(target, 2)


def calculate_sl_from_ema(
    entry_price: float,
    ema_100: float,
    direction: str,
    buffer_pct: float = 0.1
) -> float:
    """
    Intelligent SL calculation using EMA100 (structural support/resistance)
    
    Better than fixed points - uses market structure
    
    Args:
        entry_price: Entry price
        ema_100: EMA 100 level (structural level)
        direction: "BUY" or "SELL"
        buffer_pct: Extra buffer away from EMA (default 0.1% = 1 point on 1000)
    
    Returns:
        Stop loss price
    """
    buffer = ema_100 * (buffer_pct / 100)
    
    if direction == "BUY":
        # For BUY, SL should be below EMA100
        sl = ema_100 - buffer
    else:
        # For SELL, SL should be above EMA100
        sl = ema_100 + buffer
    
    return round(sl, 2)


# ============================================
# 6) FULL SIGNAL GENERATION PIPELINE
# ============================================

def generate_trading_signals(df: pd.DataFrame) -> pd.DataFrame:
    """
    Generate complete trading signals for a symbol
    
    Pipeline:
    1. Calculate EMAs (20, 50, 100, 200)
    2. Detect crossovers
    3. Determine market bias
    4. Generate entry signals
    5. Add risk management info
    
    Args:
        df: OHLCV DataFrame with columns: time, open, high, low, close, volume
    
    Returns:
        DataFrame with all signal columns added
    """
    df = apply_indicators(df)
    
    # Crossover detection
    df["buy_cross"] = crossed_above(df["ema20"], df["ema50"])
    df["sell_cross"] = crossed_below(df["ema20"], df["ema50"])
    
    # Market bias (using 200 EMA anchor)
    df["bias"] = df.apply(determine_market_bias, axis=1)
    
    # Entry signals
    df["signal"] = df.apply(generate_entry_signal, axis=1)
    
    # Calculate confidence based on EMA alignment
    def calculate_signal_confidence(row):
        """Higher confidence when EMAs are well-aligned"""
        if row["signal"] == "HOLD":
            return 0.0
        
        # Count how many EMAs are correctly aligned
        if row["signal"] == "BUY":
            # For BUY: EMA20 > EMA50 > EMA100 (ideally > EMA200)
            alignment = 0
            if row["ema20"] > row["ema50"]:
                alignment += 1
            if row["ema50"] > row["ema100"]:
                alignment += 1
            if row["ema100"] > row["ema200"]:
                alignment += 1
            confidence = 0.5 + (alignment * 0.15)  # 0.5 to 0.95
        else:  # SELL
            # For SELL: EMA20 < EMA50 < EMA100 (ideally < EMA200)
            alignment = 0
            if row["ema20"] < row["ema50"]:
                alignment += 1
            if row["ema50"] < row["ema100"]:
                alignment += 1
            if row["ema100"] < row["ema200"]:
                alignment += 1
            confidence = 0.5 + (alignment * 0.15)
        
        return min(confidence, 0.95)
    
    df["confidence"] = df.apply(calculate_signal_confidence, axis=1)
    
    return df


# ============================================
# 7) TRADE TRACKING & ANALYSIS
# ============================================

def extract_trades(df: pd.DataFrame, sl_points: float = 10, rr_ratio: float = 2.0) -> List[TradeSignal]:
    """
    Extract individual trade signals from dataframe
    
    Scans through df looking for BUY/SELL signals and creates trade records
    
    Args:
        df: DataFrame with signals (from generate_trading_signals)
        sl_points: How many points for stop loss
        rr_ratio: Risk:Reward ratio for targets
    
    Returns:
        List of TradeSignal objects
    """
    trades = []
    
    for idx, row in df.iterrows():
        if row["signal"] in ["BUY", "SELL"]:
            entry_price = float(row["close"])
            direction = row["signal"]
            
            # Calculate SL and Target
            sl, target = calculate_risk_reward(entry_price, direction, sl_points, rr_ratio)
            
            # Create trade signal
            trade = TradeSignal(
                timestamp=row.get("time", datetime.now()) if "time" in df.columns else datetime.now(),
                symbol=row.get("symbol", "UNKNOWN"),
                signal=direction,
                entry_price=round(entry_price, 2),
                stop_loss=sl,
                target=target,
                bias=row.get("bias", "UNKNOWN"),
                confidence=float(row.get("confidence", 0)),
                ema_20=round(float(row.get("ema20", 0)), 2),
                ema_50=round(float(row.get("ema50", 0)), 2),
                ema_100=round(float(row.get("ema100", 0)), 2),
                ema_200=round(float(row.get("ema200", 0)), 2),
                reasons=[
                    f"EMA20 {'crossed above' if direction == 'BUY' else 'crossed below'} EMA50",
                    f"{direction} bias confirmed ({row.get('bias', 'UNKNOWN')})",
                    f"Price at ₹{entry_price:.2f}",
                    f"Confidence: {float(row.get('confidence', 0)):.0%}"
                ]
            )
            trades.append(trade)
    
    return trades


def backtest_strategy(
    df: pd.DataFrame,
    sl_points: float = 10,
    rr_ratio: float = 2.0,
    initial_capital: float = 100000
) -> Dict:
    """
    Backtest the trading strategy
    
    Args:
        df: OHLCV DataFrame
        sl_points: Stop loss in points
        rr_ratio: Risk:Reward ratio
        initial_capital: Starting capital
    
    Returns:
        Performance metrics dictionary
    """
    df = generate_trading_signals(df)
    trades = extract_trades(df, sl_points, rr_ratio)
    
    if not trades:
        return {
            "total_trades": 0,
            "winning_trades": 0,
            "losing_trades": 0,
            "win_rate": 0,
            "pnl": 0,
            "roi": 0,
            "message": "No trades generated"
        }
    
    # Simplified backtest (you'd need actual exit logic for production)
    total_risk = len(trades) * sl_points
    total_reward = len(trades) * (sl_points * rr_ratio)
    
    return {
        "total_trades": len(trades),
        "signals": [
            {
                "time": trade.timestamp,
                "signal": trade.signal,
                "entry": trade.entry_price,
                "sl": trade.stop_loss,
                "target": trade.target,
                "bias": trade.bias,
                "confidence": f"{trade.confidence:.0%}",
                "emas": f"20:{trade.ema_20}, 50:{trade.ema_50}, 100:{trade.ema_100}, 200:{trade.ema_200}"
            }
            for trade in trades
        ],
        "ema_config": get_ema_config()
    }


# ============================================
# 8) INSTANT SIGNAL FOR LIVE TRADING
# ============================================

def get_instant_trade_signal(
    price: float,
    ema_20: float,
    ema_50: float,
    ema_100: float,
    ema_200: float,
    symbol: str = "UNKNOWN"
) -> Optional[TradeSignal]:
    """
    Generate instant trade signal from current market values
    
    For real-time trading when you don't have full historical data
    Uses current candle info to generate signal immediately
    
    Args:
        price: Current price
        ema_20, ema_50, ema_100, ema_200: Current EMA values
        symbol: Symbol name
    
    Returns:
        TradeSignal object or None if no signal
    """
    # Determine bias
    threshold = ema_200 * 0.005
    if price > ema_200 + threshold:
        bias = "BULL"
    elif price < ema_200 - threshold:
        bias = "BEAR"
    else:
        bias = "SIDEWAYS"
    
    # Determine signal
    signal = "HOLD"
    confidence = 0.0
    sl_points = 10  # Default
    
    if bias == "BULL" and price > ema_50 and ema_20 > ema_50:
        signal = "BUY"
        # Calculate confidence
        if ema_50 > ema_100 > ema_200:
            confidence = 0.9  # Perfect alignment
        elif ema_50 > ema_100:
            confidence = 0.7
        else:
            confidence = 0.5
    
    elif bias == "BEAR" and price < ema_50 and ema_20 < ema_50:
        signal = "SELL"
        # Calculate confidence
        if ema_50 < ema_100 < ema_200:
            confidence = 0.9
        elif ema_50 < ema_100:
            confidence = 0.7
        else:
            confidence = 0.5
    
    if signal == "HOLD":
        return None
    
    sl, target = calculate_risk_reward(price, signal, sl_points, rr_ratio=2.0)
    
    return TradeSignal(
        timestamp=datetime.now(),
        symbol=symbol,
        signal=signal,
        entry_price=round(price, 2),
        stop_loss=sl,
        target=target,
        bias=bias,
        confidence=confidence,
        ema_20=round(ema_20, 2),
        ema_50=round(ema_50, 2),
        ema_100=round(ema_100, 2),
        ema_200=round(ema_200, 2),
        reasons=[
            f"EMA20 (₹{ema_20:.2f}) position relative to EMA50 (₹{ema_50:.2f})",
            f"Price (₹{price:.2f}) vs EMA200 anchor (₹{ema_200:.2f})",
            f"Market bias: {bias}",
            f"Confidence: {confidence:.0%}"
        ]
    )
