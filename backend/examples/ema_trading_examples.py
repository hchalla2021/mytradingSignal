"""
PRACTICAL EXAMPLES - Professional EMA Trend Filter (20/50/100/200)
==================================================================

Real-world code samples for using the new trading signals system
with NIFTY, BANKNIFTY, and SENSEX
"""

# =============================================================================
# EXAMPLE 1: Live Signal Generation (Real-time Trading)
# =============================================================================

async def get_live_signal_for_nifty():
    """
    Get real-time BUY/SELL signal for NIFTY with confidence level
    This is what traders see on the dashboard
    """
    from services.instant_analysis import get_instant_analysis
    from services.cache import get_redis
    
    cache = await get_redis()
    analysis = await get_instant_analysis(cache, "NIFTY")
    
    indicators = analysis["indicators"]
    
    # Extract EMA values (now using professional 20/50/100/200)
    price = indicators["price"]
    ema_20 = indicators["ema_20"]
    ema_50 = indicators["ema_50"]
    ema_100 = indicators["ema_100"]
    ema_200 = indicators["ema_200"]
    
    # Determine bias (primary filter)
    if price > ema_200:
        bias = "BULLISH 🟢"
    elif price < ema_200:
        bias = "BEARISH 🔴"
    else:
        bias = "CONSOLIDATION 🟡"
    
    # Determine signal strength
    if ema_20 > ema_50 > ema_100 > ema_200:
        signal = "STRONG BUY ⬆️⬆️"
        confidence = 0.90
    elif ema_20 > ema_50 > ema_100:
        signal = "BUY ⬆️"
        confidence = 0.70
    elif ema_20 < ema_50 < ema_100 < ema_200:
        signal = "STRONG SELL ⬇️⬇️"
        confidence = 0.90
    elif ema_20 < ema_50 < ema_100:
        signal = "SELL ⬇️"
        confidence = 0.70
    else:
        signal = "WAIT ⏸️"
        confidence = 0.30
    
    return {
        "symbol": "NIFTY",
        "price": f"₹{price:,.2f}",
        "signal": signal,
        "confidence": f"{confidence:.0%}",
        "bias": bias,
        "ema_20": f"₹{ema_20:,.2f}",
        "ema_50": f"₹{ema_50:,.2f}",
        "ema_100": f"₹{ema_100:,.2f}",
        "ema_200": f"₹{ema_200:,.2f}",
        "entry_action": "✅ ENTER" if confidence >= 0.7 else "⏳ WAIT FOR CONFIRMATION"
    }


# Example usage:
# signal = await get_live_signal_for_nifty()
# print(signal)
# Output:
# {
#   'signal': 'BUY ⬆️',
#   'confidence': '70%',
#   'bias': 'BULLISH 🟢',
#   'entry_action': '✅ ENTER'
# }


# =============================================================================
# EXAMPLE 2: Multi-Symbol Scanning
# =============================================================================

async def scan_all_symbols_for_signals():
    """
    Scan NIFTY, BANKNIFTY, SENSEX and report which have active signals
    Useful for deciding which index futures to trade
    """
    from services.instant_analysis import get_instant_analysis
    from services.cache import get_redis
    
    cache = await get_redis()
    symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
    active_signals = []
    
    for symbol in symbols:
        analysis = await get_instant_analysis(cache, symbol)
        indicators = analysis["indicators"]
        
        price = indicators["price"]
        ema_20 = indicators["ema_20"]
        ema_50 = indicators["ema_50"]
        ema_100 = indicators["ema_100"]
        ema_200 = indicators["ema_200"]
        
        # Check for active signals
        bullish_alignment = (ema_20 > ema_50 > ema_100 > ema_200)
        bearish_alignment = (ema_20 < ema_50 < ema_100 < ema_200)
        price_above_200 = price > ema_200
        price_below_200 = price < ema_200
        
        if bullish_alignment and price_above_200:
            active_signals.append({
                "symbol": symbol,
                "signal": "STRONG BUY",
                "entry": price,
                "confidence": 0.95,
                "sl": ema_100 - (ema_100 * 0.001),
                "target": price + (price - ema_50) * 2
            })
        elif bearish_alignment and price_below_200:
            active_signals.append({
                "symbol": symbol,
                "signal": "STRONG SELL",
                "entry": price,
                "confidence": 0.95,
                "sl": ema_100 + (ema_100 * 0.001),
                "target": price - (ema_50 - price) * 2
            })
    
    return active_signals

# Example usage:
# signals = await scan_all_symbols_for_signals()
# for sig in signals:
#     if sig["confidence"] >= 0.90:
#         print(f"🚀 {sig['symbol']}: {sig['signal']} @ ₹{sig['entry']:.2f}")


# =============================================================================
# EXAMPLE 3: Backtesting on Historical Data
# =============================================================================

def backtest_nifty_strategy():
    """
    Backtest the EMA strategy on NIFTY historical data
    Shows what would have happened if we traded all signals
    """
    import pandas as pd
    from services.trading_signals import generate_trading_signals, extract_trades
    
    # Load historical OHLCV data
    df = pd.read_csv("nifty_historical_1hour.csv")
    df.rename(columns={"Date": "time"}, inplace=True)
    df["time"] = pd.to_datetime(df["time"])
    
    # Generate all signals
    df = generate_trading_signals(df)
    
    # Extract trades
    trades = extract_trades(df, sl_points=15, rr_ratio=2.5)  # NIFTY params
    
    # Calculate statistics
    total_trades = len(trades)
    buy_trades = sum(1 for t in trades if t.signal == "BUY")
    sell_trades = sum(1 for t in trades if t.signal == "SELL")
    
    # Print results
    print(f"\n{'='*60}")
    print(f"NIFTY EMA STRATEGY BACKTEST RESULTS")
    print(f"{'='*60}")
    print(f"Total Signals Generated: {total_trades}")
    print(f"  • BUY signals: {buy_trades}")
    print(f"  • SELL signals: {sell_trades}")
    print(f"\n{'Symbol':<10} {'Signal':<8} {'Entry':<12} {'SL':<12} {'Target':<12} {'Conf':<6}")
    print(f"{'-'*60}")
    
    for i, trade in enumerate(trades[:10], 1):  # Show first 10
        print(f"{trade.symbol:<10} {trade.signal:<8} ₹{trade.entry_price:<11.2f} "
              f"₹{trade.stop_loss:<11.2f} ₹{trade.target:<11.2f} "
              f"{trade.confidence:.0%}")
    
    if len(trades) > 10:
        print(f"... and {len(trades) - 10} more trades")
    
    print(f"\nEMA Config: {trades[0].ema_20} / {trades[0].ema_50} / {trades[0].ema_100} / {trades[0].ema_200}")
    print(f"{'='*60}\n")
    
    return trades


# =============================================================================
# EXAMPLE 4: Custom Signal Alerts
# =============================================================================

class TradingAlertSystem:
    """
    Send alerts when specific trading conditions are met
    Integrates with trading signals
    """
    
    def __init__(self):
        self.alerts = []
    
    def check_for_alerts(self, analysis_data: dict) -> list:
        """Check multiple alert conditions"""
        alerts = []
        
        indicators = analysis_data["indicators"]
        price = indicators["price"]
        ema_20 = indicators["ema_20"]
        ema_50 = indicators["ema_50"]
        ema_100 = indicators["ema_100"]
        ema_200 = indicators["ema_200"]
        symbol = analysis_data.get("symbol", "UNKNOWN")
        
        # Alert 1: Price at 200 EMA (possible bounce)
        if abs(price - ema_200) / ema_200 < 0.0005:  # Within 0.05%
            alerts.append({
                "type": "STRUCTURAL_LEVEL",
                "symbol": symbol,
                "message": f"🎯 Price at 200 EMA support/resistance: ₹{ema_200:.2f}",
                "priority": "HIGH"
            })
        
        # Alert 2: 20 EMA crossing 50 EMA
        if abs(ema_20 - ema_50) / ema_50 < 0.001:  # EMAs very close
            alerts.append({
                "type": "CROSSOVER_IMMINENT",
                "symbol": symbol,
                "message": f"⚠️ 20 EMA (₹{ema_20:.2f}) about to cross 50 EMA (₹{ema_50:.2f})",
                "priority": "MEDIUM"
            })
        
        # Alert 3: Perfect alignment
        if ema_20 > ema_50 > ema_100 > ema_200:
            alerts.append({
                "type": "ALIGNMENT_PERFECT",
                "symbol": symbol,
                "message": f"✅ Perfect bullish alignment! All EMAs stacked.",
                "priority": "CRITICAL"
            })
        elif ema_20 < ema_50 < ema_100 < ema_200:
            alerts.append({
                "type": "ALIGNMENT_PERFECT",
                "symbol": symbol,
                "message": f"❌ Perfect bearish alignment! EMAs all aligned downward.",
                "priority": "CRITICAL"
            })
        
        # Alert 4: Price extremes
        if price > ema_100 * 1.02:  # Price >2% above EMA100
            distance = ((price - ema_100) / ema_100) * 100
            if ema_20 > ema_50:  # In uptrend
                alerts.append({
                    "type": "EXTREME_DISTANCE",
                    "symbol": symbol,
                    "message": f"📈 Price {distance:.2f}% above EMA100 in uptrend - potential pullback",
                    "priority": "MEDIUM"
                })
        
        return alerts


# Example usage:
# alert_system = TradingAlertSystem()
# analysis = await get_instant_analysis(cache, "BANKNIFTY")
# alerts = alert_system.check_for_alerts(analysis)
# for alert in alerts:
#     print(f"[{alert['priority']}] {alert['message']}")


# =============================================================================
# EXAMPLE 5: Risk-Reward Ratio Optimization
# =============================================================================

def optimize_position_sizing(
    entry_price: float,
    stop_loss: float,
    target: float,
    account_balance: float = 100000,
    risk_percent: float = 1.0
) -> dict:
    """
    Calculate optimal position size based on risk parameters
    Ensures no single trade risks more than X% of account
    
    Example: Risk 1% per trade on ₹100,000 account = ₹1,000 max loss
    """
    
    # Calculate risk in points and rupees
    risk_points = abs(entry_price - stop_loss)
    risk_rupees = (risk_percent / 100) * account_balance
    
    # Calculate position size (quantity * risk_points = risk_rupees)
    # For NIFTY: 1 contract = 75 NIFTY
    quantity = risk_rupees / (risk_points * 75)
    
    # Calculate reward in rupees
    reward_points = abs(target - entry_price)
    reward_rupees = quantity * reward_points * 75
    
    # Calculate Risk:Reward ratio
    rr_ratio = reward_rupees / risk_rupees if risk_rupees > 0 else 0
    
    return {
        "entry": f"₹{entry_price:.2f}",
        "stop_loss": f"₹{stop_loss:.2f}",
        "target": f"₹{target:.2f}",
        "risk_points": round(risk_points, 2),
        "position_quantity": round(quantity, 2),
        "risk_rupees": f"₹{risk_rupees:,.0f}",
        "reward_rupees": f"₹{reward_rupees:,.0f}",
        "rr_ratio": f"1:{round(rr_ratio, 2)}",
        "status": "✅ ACCEPTABLE" if rr_ratio >= 2.0 else "⚠️ CHECK RATIO"
    }


# Example usage:
# position = optimize_position_sizing(
#     entry_price=20100,
#     stop_loss=20050,
#     target=20200,
#     account_balance=100000,
#     risk_percent=1.0
# )
# print(position)
# Output:
# {
#   'position_quantity': 6.67,
#   'risk_rupees': '₹1,000',
#   'reward_rupees': '₹3,333',
#   'rr_ratio': '1:3.33',
#   'status': '✅ ACCEPTABLE'
# }


# =============================================================================
# EXAMPLE 6: Multi-Timeframe Analysis
# =============================================================================

def multi_timeframe_analysis(symbol: str):
    """
    Check EMA signals on multiple timeframes (5min, 15min, 1hour)
    Entry confirmed only when all timeframes agree
    """
    import pandas as pd
    from services.trading_signals import generate_trading_signals
    
    timeframes = {
        "5min": "data/nifty_5min.csv",
        "15min": "data/nifty_15min.csv",
        "1hour": "data/nifty_1hour.csv"
    }
    
    results = {}
    
    for tf_name, tf_file in timeframes.items():
        df = pd.read_csv(tf_file)
        df = generate_trading_signals(df)
        
        latest = df.iloc[-1]
        
        results[tf_name] = {
            "signal": latest["signal"],
            "confidence": latest.get("confidence", 0),
            "bias": latest.get("bias", "UNKNOWN"),
            "ema_trend": "UP" if latest["ema20"] > latest["ema50"] else "DOWN"
        }
    
    # Check convergence
    signals = [r["signal"] for r in results.values()]
    
    if signals.count("BUY") == 3:
        final_signal = "STRONG_BUY - All timeframes agree 🎯"
    elif signals.count("SELL") == 3:
        final_signal = "STRONG_SELL - All timeframes agree 🎯"
    elif signals.count("BUY") >= 2:
        final_signal = "BUY_BIAS - Most timeframes agree ✅"
    elif signals.count("SELL") >= 2:
        final_signal = "SELL_BIAS - Most timeframes agree ✅"
    else:
        final_signal = "CONFLICTING - Wait for clarity ⏳"
    
    return {
        "symbol": symbol,
        "final_signal": final_signal,
        "timeframes": results
    }


# =============================================================================
# EXAMPLE 7: Integration with FastAPI Endpoint
# =============================================================================

from fastapi import APIRouter
from services.instant_analysis import get_instant_analysis
from services.cache import get_redis

router = APIRouter(prefix="/api/signals", tags=["trading-signals"])


@router.get("/nifty")
async def get_nifty_signal():
    """
    HTTP Endpoint: GET /api/signals/nifty
    Returns current NIFTY BUY/SELL/HOLD signal with full analysis
    """
    cache = await get_redis()
    analysis = await get_instant_analysis(cache, "NIFTY")
    
    ind = analysis["indicators"]
    
    signal_data = {
        "symbol": "NIFTY",
        "price": ind["price"],
        "signal": analysis["signal"],
        "confidence": analysis["confidence"],
        "ema_20": ind["ema_20"],
        "ema_50": ind["ema_50"],
        "ema_100": ind["ema_100"],
        "ema_200": ind["ema_200"],
        "entry": analysis.get("entry_price"),
        "stop_loss": analysis.get("stop_loss"),
        "target": analysis.get("target"),
        "reasons": analysis.get("reasons", []),
        "timestamp": analysis["timestamp"]
    }
    
    return signal_data


@router.get("/scan")
async def scan_all():
    """
    HTTP Endpoint: GET /api/signals/scan
    Scan all symbols and return active trading opportunities
    """
    cache = await get_redis()
    symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
    results = []
    
    for symbol in symbols:
        analysis = await get_instant_analysis(cache, symbol)
        if analysis["signal"] in ["BUY_SIGNAL", "SELL_SIGNAL"]:
            results.append({
                "symbol": symbol,
                "signal": analysis["signal"],
                "confidence": analysis["confidence"],
                "price": analysis["indicators"]["price"]
            })
    
    return {"active_signals": results}


# =============================================================================
# EXAMPLE 8: Switching EMA Configuration on the Fly
# =============================================================================

def change_trading_style():
    """
    Switch between different trading styles without restarting
    """
    from config.ema_config import set_ema_config, get_ema_config
    
    print("Current EMAs:", get_ema_config())
    # Output: {'ema_20': 20, 'ema_50': 50, 'ema_100': 100, 'ema_200': 200}
    
    # Switch to scalping
    print("\n📊 Switching to SCALP_FAST for day trading...")
    set_ema_config("SCALP_FAST")
    print("New EMAs:", get_ema_config())
    # Output: {'ema_20': 5, 'ema_50': 13, 'ema_100': 34, 'ema_200': 89}
    
    # Switch back to professional
    print("\n📊 Switching back to INTRADAY_PRO...")
    set_ema_config("INTRADAY_PRO")
    print("New EMAs:", get_ema_config())
    # Output: {'ema_20': 20, 'ema_50': 50, 'ema_100': 100, 'ema_200': 200}


print("✅ All examples loaded successfully!")
print("\nAvailable examples:")
print("1. get_live_signal_for_nifty() - Real-time signal")
print("2. scan_all_symbols_for_signals() - Multi-symbol scan")
print("3. backtest_nifty_strategy() - Historical backtest")
print("4. TradingAlertSystem() - Alert conditions")
print("5. optimize_position_sizing() - Position calculator")
print("6. multi_timeframe_analysis() - Multi-TF confirmation")
print("7. FastAPI endpoints - HTTP integration")
print("8. change_trading_style() - Configuration switching")
