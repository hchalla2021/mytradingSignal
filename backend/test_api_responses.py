#!/usr/bin/env python3
"""
OI Momentum - Frontend Data Flow Diagnostic
Tests what the frontend API endpoints are returning
Simulates browser requests to see actual response data
"""

import asyncio
import sys
import json
from pathlib import Path
from datetime import datetime
import pytz

sys.path.insert(0, str(Path(__file__).parent))

from services.cache import CacheService
from fastapi import HTTPException

IST = pytz.timezone('Asia/Kolkata')

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    RESET = '\033[0m'
    BOLD = '\033[1m'

async def test_api_responses():
    """Test actual API responses"""
    
    print(f"\n{Colors.BOLD}{Colors.CYAN}")
    print("╔" + "═"*78 + "╗")
    print("║" + " "*10 + "🌐 OI MOMENTUM - TESTING API RESPONSES & DATA FLOW" + " "*17 + "║")
    print("╚" + "═"*78 + "╝")
    print(Colors.RESET)
    
    cache = CacheService()
    await cache.connect()
    
    try:
        symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
        
        # ═══════════════════════════════════════════════════════════════════════════
        # TEST 1: /api/market/snapshot
        # ═══════════════════════════════════════════════════════════════════════════
        print(f"\n{Colors.CYAN}{Colors.BOLD}1️⃣  TEST: GET /api/market/snapshot{Colors.RESET}")
        print("─" * 80)
        print("(This is what the frontend gets on WebSocket SNAPSHOT)")
        
        try:
            all_market_data = await cache.get_all_market_data()
            
            print(f"\nRaw response keys: {list(all_market_data.keys())}")
            
            for symbol in symbols:
                if symbol in all_market_data:
                    data = all_market_data[symbol]
                    if data:
                        price = data.get("price", 0)
                        change = data.get("change", 0)
                        timestamp = data.get("timestamp", "N/A")
                        
                        if price > 0:
                            print(f"\n{Colors.GREEN}✅ {symbol}{Colors.RESET}")
                            print(f"   Price: ₹{price:,.2f}")
                            print(f"   Change: {change:+.2f}")
                            print(f"   Timestamp: {timestamp}")
                        else:
                            print(f"\n{Colors.RED}❌ {symbol}{Colors.RESET}")
                            print(f"   Price: ₹{price} (BAD!)")
                            print(f"   Data: {data}")
                    else:
                        print(f"\n{Colors.RED}❌ {symbol}{Colors.RESET}")
                        print(f"   Data is NULL")
                else:
                    print(f"\n{Colors.RED}❌ {symbol}{Colors.RESET}")
                    print(f"   NOT in response")
        except Exception as e:
            print(f"{Colors.RED}❌ Error: {e}{Colors.RESET}")
        
        # ═══════════════════════════════════════════════════════════════════════════
        # TEST 2: /api/oi-momentum/all
        # ═══════════════════════════════════════════════════════════════════════════
        print(f"\n{Colors.CYAN}{Colors.BOLD}2️⃣  TEST: GET /api/oi-momentum/all{Colors.RESET}")
        print("─" * 80)
        print("(This is what OIMomentumCard fetches)")
        
        try:
            import pandas as pd
            from services.oi_momentum_service import OIMomentumService
            
            oi_momentum_service = OIMomentumService()
            
            results = {}
            
            for symbol in symbols:
                try:
                    # Get cached candles from WebSocket feed
                    candle_key = f"analysis_candles:{symbol}"
                    candles_json = await cache.lrange(candle_key, 0, 199)
                    
                    if not candles_json or len(candles_json) < 20:
                        results[symbol] = {
                            "signal_5m": "NO_SIGNAL",
                            "signal_15m": "NO_SIGNAL",
                            "final_signal": "NO_SIGNAL",
                            "confidence": 0,
                            "reasons": ["Waiting for live market data - accumulating candles for analysis"],
                            "metrics": {},
                            "symbol_name": symbol,
                            "current_price": 0
                        }
                        continue
                    
                    # Parse candles
                    candles = []
                    for candle_json in reversed(candles_json):
                        try:
                            candles.append(json.loads(candle_json))
                        except:
                            continue
                    
                    # Build DataFrames
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
                    
                    results[symbol] = {
                        **signal_data,
                        "symbol_name": symbol,
                        "current_price": current_price
                    }
                
                except Exception as e:
                    print(f"Error analyzing {symbol}: {e}")
                    results[symbol] = {
                        "final_signal": "ERROR",
                        "confidence": 0,
                        "current_price": 0,
                        "error": str(e)
                    }
            
            # Print results
            for symbol, data in results.items():
                if data.get("final_signal") == "NO_SIGNAL":
                    print(f"\n{Colors.YELLOW}{symbol}: {Colors.YELLOW}⚠️ NO_SIGNAL{Colors.RESET}")
                    print(f"   Reason: {data.get('reasons', ['Unknown'])[0]}")
                elif data.get("final_signal") == "ERROR":
                    print(f"\n{Colors.RED}{symbol}: {Colors.RED}❌ ERROR{Colors.RESET}")
                    print(f"   Error: {data.get('error')}")
                else:
                    sig = data.get("final_signal", "UNKNOWN")
                    conf = data.get("confidence", 0)
                    price = data.get("current_price", 0)
                    
                    sig_color = (Colors.GREEN if sig in ["BUY", "STRONG_BUY"] 
                               else Colors.RED if sig in ["SELL", "STRONG_SELL"] 
                               else Colors.YELLOW)
                    
                    print(f"\n{sig_color}{symbol}: {sig} {conf}%{Colors.RESET}")
                    print(f"   Price: ₹{price:,.2f}")
                    print(f"   5m: {data.get('signal_5m')}")
                    print(f"   15m: {data.get('signal_15m')}")
        
        except Exception as e:
            print(f"{Colors.RED}❌ Error: {e}{Colors.RESET}")
            import traceback
            traceback.print_exc()
        
        # ═══════════════════════════════════════════════════════════════════════════
        # TEST 3: /api/diagnostics/market-data-status
        # ═══════════════════════════════════════════════════════════════════════════
        print(f"\n{Colors.CYAN}{Colors.BOLD}3️⃣  TEST: GET /api/diagnostics/market-data-status{Colors.RESET}")
        print("─" * 80)
        
        for symbol in symbols:
            try:
                market_data = await cache.get_market_data(symbol)
                
                if market_data:
                    print(f"\n{Colors.GREEN}✅ {symbol}{Colors.RESET}")
                    print(f"   Keys in data: {list(market_data.keys())}")
                    if market_data.get("price"):
                        print(f"   Price: ₹{market_data.get('price'):,.2f} ✓")
                    else:
                        print(f"   Price: {Colors.RED}{market_data.get('price')}{Colors.RESET} (EMPTY!)")
                else:
                    print(f"\n{Colors.RED}❌ {symbol}{Colors.RESET}")
                    print(f"   No data returned (None)")
            except Exception as e:
                print(f"\n{Colors.RED}❌ {symbol}{Colors.RESET}")
                print(f"   Error: {e}")
        
        # ═══════════════════════════════════════════════════════════════════════════
        # TEST 4: What the frontend sees for pricing
        # ═══════════════════════════════════════════════════════════════════════════
        print(f"\n{Colors.CYAN}{Colors.BOLD}4️⃣  TESTING: Frontend Price Rendering{Colors.RESET}")
        print("─" * 80)
        print("(OIMomentumCard shows: ₹{data.current_price || '0.00'})")
        
        for symbol in symbols:
            try:
                # Simulate what OIMomentumCard does
                market_data = await cache.get_market_data(symbol)
                
                # This is from OIMomentumCard component fetching
                current_price = None
                
                if market_data:
                    # Try various keys it might look for
                    current_price = (market_data.get("current_price") or 
                                   market_data.get("price") or 
                                   0)
                
                if isinstance(current_price, (int, float)) and current_price > 0:
                    print(f"{Colors.GREEN}✅ {symbol}: ₹{current_price:,.2f}{Colors.RESET}")
                else:
                    print(f"{Colors.RED}❌ {symbol}: ₹{current_price or 0:.2f} (WILL SHOW ₹0.00){Colors.RESET}")
                    if not market_data:
                        print(f"   → No market_data in cache")
                    elif not market_data.get("price"):
                        print(f"   → market_data exists but 'price' field is missing/empty")
                        print(f"   → Available fields: {list(market_data.keys())}")
            
            except Exception as e:
                print(f"{Colors.RED}❌ {symbol}: Error - {e}{Colors.RESET}")
        
        # ═══════════════════════════════════════════════════════════════════════════
        # SUMMARY
        # ═══════════════════════════════════════════════════════════════════════════
        print(f"\n{Colors.BOLD}{'='*80}{Colors.RESET}")
        print(f"{Colors.BOLD}FINDINGS:{Colors.RESET}")
        
        print(f"\nIf you see ₹0.00 prices, it means:")
        print(f"  1. {Colors.RED}NO market data in cache{Colors.RESET}")
        print(f"  2. Available market_data key exists but empty")
        print(f"  3. WebSocket not feeding data")
        print(f"  4. Backend feed is disconnected")
        
        print(f"\nIf you see 'Waiting for live market data...':")
        print(f"  1. Market data might exist but candles < 20")
        print(f"  2. This is normal at market open")
        print(f"  3. Wait 10+ minutes or use backup candles")
        
        print(f"\n{Colors.BOLD}{'='*80}\n{Colors.RESET}")
    
    finally:
        await cache.disconnect()


async def main():
    try:
        await test_api_responses()
    except Exception as e:
        print(f"{Colors.RED}Fatal error: {e}{Colors.RESET}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
