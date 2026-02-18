#!/usr/bin/env python3
"""
OI Momentum Signals - Live Status & Debugging Tool
Shows real-time status of:
1. WebSocket connection
2. Market data (last values)
3. Candle data availability
4. OI Momentum signals
5. Any errors or issues

Run this to see what's happening in your system!
"""

import asyncio
import sys
import json
from pathlib import Path
from datetime import datetime

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from services.cache import CacheService
from services.auth_state_machine import auth_state_manager
from config import get_settings
import pandas as pd

# Colors for terminal output
class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    RESET = '\033[0m'
    BOLD = '\033[1m'


async def check_oi_momentum_status():
    """
    Check and display OI Momentum status
    """
    print(f"\n{Colors.BOLD}{'='*80}{Colors.RESET}")
    print(f"{Colors.BOLD}🔍 OI MOMENTUM SIGNALS - LIVE STATUS CHECK{Colors.RESET}")
    print(f"{Colors.BOLD}{'='*80}{Colors.RESET}\n")
    
    # Initialize cache
    cache = CacheService()
    await cache.connect()
    
    try:
        symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
        
        # 1. Check Authentication
        print(f"{Colors.CYAN}1️⃣  AUTHENTICATION STATUS{Colors.RESET}")
        print(f"   Authenticated: {Colors.GREEN if auth_state_manager.is_authenticated else Colors.RED}"
              f"{'✅ YES' if auth_state_manager.is_authenticated else '❌ NO'}{Colors.RESET}")
        print(f"   State: {auth_state_manager.current_state}")
        print(f"   Has Token: {Colors.GREEN if get_settings().zerodha_access_token else Colors.RED}"
              f"{'✅ YES' if get_settings().zerodha_access_token else '❌ NO'}{Colors.RESET}\n")
        
        # 2. Check Market Data
        print(f"{Colors.CYAN}2️⃣  LAST MARKET VALUES{Colors.RESET}")
        market_data_ok = 0
        for symbol in symbols:
            try:
                market_data = await cache.get_market_data(symbol)
                if market_data and market_data.get("price"):
                    market_data_ok += 1
                    price = market_data.get("price", 0)
                    change = market_data.get("change", 0)
                    change_pct = market_data.get("changePercent", 0)
                    status = market_data.get("status", "UNKNOWN")
                    timestamp = market_data.get("timestamp", "N/A")
                    
                    trend_emoji = "📈" if change > 0 else "📉" if change < 0 else "➡️"
                    color = Colors.GREEN if change > 0 else Colors.RED if change < 0 else Colors.YELLOW
                    
                    print(f"\n   {symbol}")
                    print(f"   Price: ₹{price:,.2f}")
                    print(f"   Change: {color}{trend_emoji} {change:+.2f} ({change_pct:+.2f}%){Colors.RESET}")
                    print(f"   Status: {status}")
                    print(f"   Time: {timestamp}")
                else:
                    print(f"\n   {symbol}")
                    print(f"   {Colors.RED}❌ NO DATA IN CACHE{Colors.RESET}")
            except Exception as e:
                print(f"\n   {symbol}")
                print(f"   {Colors.RED}❌ ERROR: {e}{Colors.RESET}")
        
        print(f"\n   {Colors.BOLD}Summary: {market_data_ok}/{len(symbols)} symbols have live data{Colors.RESET}\n")
        
        # 3. Check Candle Data
        print(f"{Colors.CYAN}3️⃣  CANDLE DATA AVAILABILITY{Colors.RESET}")
        candles_ok = 0
        for symbol in symbols:
            try:
                candle_key = f"analysis_candles:{symbol}"
                candles_json = await cache.lrange(candle_key, 0, 199)
                count = len(candles_json) if candles_json else 0
                
                if count >= 20:
                    candles_ok += 1
                    status_text = f"{Colors.GREEN}✅ READY{Colors.RESET}"
                    detail = f"({count} candles, {count - 20} extra)"
                elif count > 0:
                    status_text = f"{Colors.YELLOW}⚠️ LOADING{Colors.RESET}"
                    detail = f"({count}/20 candles, need {20 - count} more)"
                else:
                    status_text = f"{Colors.RED}❌ NO DATA{Colors.RESET}"
                    detail = "(0 candles)"
                
                print(f"\n   {symbol}: {status_text} {detail}")
                
                # Show last candle timestamp
                if candles_json:
                    try:
                        last_candle = json.loads(candles_json[0])
                        last_time = last_candle.get("timestamp", "N/A")
                        last_close = last_candle.get("close", 0)
                        print(f"   Last: {last_time} @ ₹{last_close:.2f}")
                    except:
                        pass
            except Exception as e:
                print(f"\n   {symbol}")
                print(f"   {Colors.RED}❌ ERROR: {e}{Colors.RESET}")
        
        print(f"\n   {Colors.BOLD}Summary: {candles_ok}/{len(symbols)} symbols have sufficient candles{Colors.RESET}\n")
        
        # 4. Check OI Momentum Signals
        print(f"{Colors.CYAN}4️⃣  OI MOMENTUM SIGNALS{Colors.RESET}")
        signals_ok = 0
        
        try:
            from services.oi_momentum_service import OIMomentumService
            from routers.analysis import oi_momentum_service
            
            for symbol in symbols:
                try:
                    # Get candles
                    candle_key = f"analysis_candles:{symbol}"
                    candles_json = await cache.lrange(candle_key, 0, 199)
                    
                    if not candles_json or len(candles_json) < 20:
                        print(f"\n   {symbol}")
                        print(f"   {Colors.YELLOW}⚠️ NO_SIGNAL{Colors.RESET} - Insufficient candles ({len(candles_json) if candles_json else 0}/20)")
                        continue
                    
                    # Parse candles
                    candles = []
                    for candle_json in reversed(candles_json):
                        try:
                            candles.append(json.loads(candle_json))
                        except:
                            continue
                    
                    if len(candles) < 20:
                        print(f"\n   {symbol}")
                        print(f"   {Colors.YELLOW}⚠️ NO_SIGNAL{Colors.RESET} - Parsing error")
                        continue
                    
                    # Build dataframes
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
                    
                    # Get current values
                    current_price = df_5m.iloc[-1]['close'] if len(df_5m) > 0 else 0
                    current_oi = df_5m.iloc[-1].get('oi') if len(df_5m) > 0 else None
                    current_volume = df_5m.iloc[-1]['volume'] if len(df_5m) > 0 else None
                    
                    # Analyze
                    signal_data = oi_momentum_service.analyze_signal(
                        symbol=symbol,
                        df_5min=df_5m,
                        df_15min=df_15m,
                        current_price=current_price,
                        current_oi=current_oi,
                        current_volume=current_volume
                    )
                    
                    signal = signal_data.get("final_signal", "UNKNOWN")
                    confidence = signal_data.get("confidence", 0)
                    signals_ok += 1
                    
                    # Color code by signal
                    if signal == "STRONG_BUY":
                        signal_color = Colors.GREEN
                        signal_icon = "🚀"
                    elif signal == "BUY":
                        signal_color = Colors.GREEN
                        signal_icon = "📈"
                    elif signal == "STRONG_SELL":
                        signal_color = Colors.RED
                        signal_icon = "🔻"
                    elif signal == "SELL":
                        signal_color = Colors.RED
                        signal_icon = "📉"
                    elif signal == "NEUTRAL":
                        signal_color = Colors.YELLOW
                        signal_icon = "⏸️"
                    else:
                        signal_color = Colors.CYAN
                        signal_icon = "⚠️"
                    
                    print(f"\n   {symbol}")
                    print(f"   Signal: {signal_color}{signal_icon} {signal}{Colors.RESET}")
                    print(f"   5m Entry: {signal_data.get('signal_5m', 'N/A')}")
                    print(f"   15m Trend: {signal_data.get('signal_15m', 'N/A')}")
                    print(f"   Confidence: {confidence}%")
                    print(f"   Price: ₹{current_price:.2f}")
                    
                    # Top 2 reasons
                    reasons = signal_data.get("reasons", [])
                    if reasons and len(reasons) > 1:
                        print(f"   Top Reason: {reasons[1]}")
                    
                except Exception as e:
                    print(f"\n   {symbol}")
                    print(f"   {Colors.RED}❌ ERROR{Colors.RESET}: {str(e)[:100]}")
        
        except Exception as e:
            print(f"   {Colors.RED}❌ OI Momentum Service Error: {e}{Colors.RESET}")
        
        print(f"\n   {Colors.BOLD}Summary: {signals_ok}/{len(symbols)} symbols have active signals{Colors.RESET}\n")
        
        # Overall Status
        print(f"{Colors.CYAN}5️⃣  OVERALL SYSTEM STATUS{Colors.RESET}")
        
        if market_data_ok == len(symbols) and candles_ok == len(symbols) and signals_ok == len(symbols):
            print(f"   {Colors.GREEN}{Colors.BOLD}✅ ALL SYSTEMS GO!{Colors.RESET}")
            print(f"   - Market data: {Colors.GREEN}Live{Colors.RESET}")
            print(f"   - Candles: {Colors.GREEN}Loaded{Colors.RESET}")
            print(f"   - Signals: {Colors.GREEN}Active{Colors.RESET}")
        elif market_data_ok > 0 or candles_ok > 0:
            print(f"   {Colors.YELLOW}{Colors.BOLD}⚠️ PARTIAL DATA{Colors.RESET}")
            if market_data_ok > 0:
                print(f"   - Market data: {Colors.GREEN}Flowing ({market_data_ok}/{len(symbols)}){Colors.RESET}")
            if candles_ok > 0:
                print(f"   - Candles: {Colors.YELLOW}Loading ({candles_ok}/{len(symbols)}){Colors.RESET}")
            if signals_ok > 0:
                print(f"   - Signals: {Colors.YELLOW}Loading ({signals_ok}/{len(symbols)}){Colors.RESET}")
            print(f"\n   {Colors.YELLOW}ℹ️  Signals will be active once candles accumulate (20+ required){Colors.RESET}")
        else:
            print(f"   {Colors.RED}{Colors.BOLD}❌ NO DATA AVAILABLE{Colors.RESET}")
            print(f"   - Check WebSocket connection")
            print(f"   - Verify Zerodha token is valid")
            print(f"   - Ensure market is open (9:15 AM - 3:30 PM IST)")
        
        print(f"\n{Colors.BOLD}{'='*80}{Colors.RESET}\n")
        
    except Exception as e:
        print(f"{Colors.RED}❌ ERROR: {e}{Colors.RESET}")
        import traceback
        traceback.print_exc()
    
    finally:
        await cache.disconnect()


async def main():
    """Run the status check"""
    try:
        await check_oi_momentum_status()
    except KeyboardInterrupt:
        print(f"\n{Colors.YELLOW}Stopped by user{Colors.RESET}")
    except Exception as e:
        print(f"{Colors.RED}Fatal error: {e}{Colors.RESET}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
