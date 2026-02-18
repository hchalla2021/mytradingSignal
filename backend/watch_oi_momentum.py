#!/usr/bin/env python3
"""
OI Momentum - Live Monitor (Watch Mode)
Shows real-time updates as candles accumulate and signals generate
Run this during market hours to watch the flow of data
"""

import asyncio
import sys
import json
from pathlib import Path
from datetime import datetime
import time

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from services.cache import CacheService
from config import get_settings
import pandas as pd

# Colors
class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    RESET = '\033[0m'
    BOLD = '\033[1m'
    CLEAR = '\033[2J\033[H'  # Clear screen


async def watch_oi_momentum():
    """
    Watch OI Momentum signals in real-time
    """
    cache = CacheService()
    await cache.connect()
    
    symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
    from services.oi_momentum_service import OIMomentumService
    from routers.analysis import oi_momentum_service
    
    iteration = 0
    
    try:
        while True:
            iteration += 1
            
            # Clear screen
            print(Colors.CLEAR)
            
            print(f"{Colors.BOLD}{Colors.CYAN}")
            print("╔" + "═"*78 + "╗")
            print("║" + " "*20 + "🔍 OI MOMENTUM LIVE MONITOR" + " "*31 + "║")
            print("╚" + "═"*78 + "╝")
            print(Colors.RESET)
            
            print(f"\n📊 Check #{iteration} - {datetime.now().strftime('%H:%M:%S IST')}\n")
            
            for symbol in symbols:
                try:
                    # Get market data
                    market_data = await cache.get_market_data(symbol)
                    price = market_data.get("price", 0) if market_data else 0
                    change = market_data.get("change", 0) if market_data else 0
                    change_pct = market_data.get("changePercent", 0) if market_data else 0
                    
                    # Get candles
                    candle_key = f"analysis_candles:{symbol}"
                    candles_json = await cache.lrange(candle_key, 0, 199)
                    candle_count = len(candles_json) if candles_json else 0
                    
                    # Display bar
                    bar_length = 20
                    filled = int((candle_count / 20) * bar_length) if candle_count < 20 else bar_length
                    bar = "█" * filled + "░" * (bar_length - filled)
                    
                    # Color for trend
                    price_color = Colors.GREEN if change > 0 else Colors.RED if change < 0 else Colors.YELLOW
                    trend_emoji = "📈" if change > 0 else "📉" if change < 0 else "➡️"
                    
                    # Status
                    if candle_count < 20:
                        status = f"{Colors.YELLOW}⏳ LOADING{Colors.RESET} {bar} {candle_count}/20"
                        signal = "WAITING"
                    else:
                        # Get signal
                        try:
                            candles = []
                            for candle_json in reversed(candles_json):
                                try:
                                    candles.append(json.loads(candle_json))
                                except:
                                    continue
                            
                            if len(candles) >= 20:
                                df_5m = pd.DataFrame(candles)
                                df_15m_data = []
                                for i in range(0, len(candles) - 2, 3):
                                    chunk = candles[i:i+3]
                                    if len(chunk) == 3:
                                        df_15m_data.append({
                                            'open': chunk[0]['open'],
                                            'high': max(c['high'] for c in chunk),
                                            'low': min(c['low'] for c in chunk),
                                            'close': chunk[-1]['close'],
                                            'volume': sum(c.get('volume', 0) for c in chunk),
                                            'oi': chunk[-1].get('oi', 0)
                                        })
                                df_15m = pd.DataFrame(df_15m_data)
                                
                                current_price = df_5m.iloc[-1]['close'] if len(df_5m) > 0 else 0
                                current_oi = df_5m.iloc[-1].get('oi') if len(df_5m) > 0 else None
                                current_volume = df_5m.iloc[-1]['volume'] if len(df_5m) > 0 else None
                                
                                signal_data = oi_momentum_service.analyze_signal(
                                    symbol=symbol,
                                    df_5min=df_5m,
                                    df_15min=df_15m,
                                    current_price=current_price,
                                    current_oi=current_oi,
                                    current_volume=current_volume
                                )
                                
                                sig = signal_data.get("final_signal", "UNKNOWN")
                                conf = signal_data.get("confidence", 0)
                                
                                if sig == "STRONG_BUY":
                                    signal = f"{Colors.GREEN}🚀 STRONG BUY {conf}%{Colors.RESET}"
                                elif sig == "BUY":
                                    signal = f"{Colors.GREEN}📈 BUY {conf}%{Colors.RESET}"
                                elif sig == "STRONG_SELL":
                                    signal = f"{Colors.RED}🔻 STRONG SELL {conf}%{Colors.RESET}"
                                elif sig == "SELL":
                                    signal = f"{Colors.RED}📉 SELL {conf}%{Colors.RESET}"
                                elif sig == "NEUTRAL":
                                    signal = f"{Colors.YELLOW}⏸️  NEUTRAL {conf}%{Colors.RESET}"
                                else:
                                    signal = f"{Colors.CYAN}❓ {sig} {conf}%{Colors.RESET}"
                                
                                status = f"{Colors.GREEN}✅ READY{Colors.RESET} {bar} {candle_count} candles"
                            else:
                                signal = "ERROR: Parse failed"
                                status = f"{Colors.YELLOW}⏳ LOADING{Colors.RESET} {bar} {candle_count}/20"
                        except Exception as e:
                            signal = "ERROR"
                            status = f"{Colors.YELLOW}⏳ LOADING{Colors.RESET} {bar} {candle_count}/20"
                    
                    # Print symbol row
                    print(f"┌─ {Colors.BOLD}{symbol}{Colors.RESET}")
                    print(f"├─ Price: {price_color}₹{price:,.2f}{Colors.RESET} {trend_emoji} {change_pct:+.2f}%")
                    print(f"├─ Status: {status}")
                    print(f"└─ Signal: {signal}\n")
                
                except Exception as e:
                    print(f"❌ {symbol}: {e}\n")
            
            # Instructions
            print(f"{Colors.CYAN}Press Ctrl+C to stop, refreshing every 5 seconds...{Colors.RESET}")
            
            # Wait
            await asyncio.sleep(5)
    
    except KeyboardInterrupt:
        print(f"\n{Colors.YELLOW}Stopped by user{Colors.RESET}")
    except Exception as e:
        print(f"{Colors.RED}Error: {e}{Colors.RESET}")
        import traceback
        traceback.print_exc()
    finally:
        await cache.disconnect()


async def main():
    """Run the monitor"""
    try:
        await watch_oi_momentum()
    except Exception as e:
        print(f"{Colors.RED}Fatal error: {e}{Colors.RESET}")


if __name__ == "__main__":
    asyncio.run(main())
