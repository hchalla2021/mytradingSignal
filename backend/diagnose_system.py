#!/usr/bin/env python3
"""
OI Momentum Signals - Complete System Diagnostic
Identifies why signals show ₹0.00 and NO_SIGNAL
Checks every layer of the data flow pipeline
"""

import asyncio
import sys
import json
from pathlib import Path
from datetime import datetime
import pytz

sys.path.insert(0, str(Path(__file__).parent))

from services.cache import CacheService
from services.auth_state_machine import auth_state_manager
from config import get_settings
from services.market_feed import get_market_status, is_market_open

IST = pytz.timezone('Asia/Kolkata')

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    RESET = '\033[0m'
    BOLD = '\033[1m'

async def diagnose_system():
    """Complete diagnostic of OI Momentum system"""
    
    print(f"\n{Colors.BOLD}{Colors.CYAN}")
    print("╔" + "═"*78 + "╗")
    print("║" + " "*15 + "🔧 OI MOMENTUM SIGNALS - COMPLETE SYSTEM DIAGNOSTIC" + " "*10 + "║")
    print("╚" + "═"*78 + "╝")
    print(Colors.RESET)
    
    now = datetime.now(IST)
    print(f"\n⏰ Diagnostic Time: {now.strftime('%Y-%m-%d %H:%M:%S IST')}")
    
    cache = CacheService()
    await cache.connect()
    
    try:
        symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
        
        # ═══════════════════════════════════════════════════════════════════════════
        # CHECK 1: MARKET STATUS
        # ═══════════════════════════════════════════════════════════════════════════
        print(f"\n{Colors.CYAN}{Colors.BOLD}1️⃣  MARKET STATUS{Colors.RESET}")
        print("─" * 80)
        
        market_status = get_market_status()
        is_open = is_market_open()
        
        print(f"Current Time: {now.strftime('%H:%M:%S')}")
        print(f"Market Status: {market_status}")
        print(f"Is Market Open: {Colors.GREEN if is_open else Colors.RED}{is_open}{Colors.RESET}")
        
        if market_status == "CLOSED":
            print(f"\n{Colors.YELLOW}⚠️ MARKET IS CLOSED!{Colors.RESET}")
            print(f"   Market hours: 9:15 AM - 3:30 PM IST")
            print(f"   Current time: {now.strftime('%I:%M %p')}")
            print(f"   → Signals only update during market hours")
        elif market_status == "LIVE":
            print(f"{Colors.GREEN}✅ Market LIVE - Should have data{Colors.RESET}")
        
        # ═══════════════════════════════════════════════════════════════════════════
        # CHECK 2: AUTHENTICATION
        # ═══════════════════════════════════════════════════════════════════════════
        print(f"\n{Colors.CYAN}{Colors.BOLD}2️⃣  AUTHENTICATION STATUS{Colors.RESET}")
        print("─" * 80)
        
        auth_ok = auth_state_manager.is_authenticated
        has_token = bool(get_settings().zerodha_access_token)
        
        print(f"Authenticated: {Colors.GREEN if auth_ok else Colors.RED}{'✅ YES' if auth_ok else '❌ NO'}{Colors.RESET}")
        print(f"Has Token: {Colors.GREEN if has_token else Colors.RED}{'✅ YES' if has_token else '❌ NO'}{Colors.RESET}")
        print(f"Auth State: {auth_state_manager.current_state}")
        
        if not auth_ok:
            print(f"\n{Colors.RED}❌ NOT AUTHENTICATED!{Colors.RESET}")
            print("   Without authentication, no live data will flow")
            print("   → Solution: Click LOGIN button in UI or run: python quick_token_fix.py")
        
        # ═══════════════════════════════════════════════════════════════════════════
        # CHECK 3: REDIS CACHE CONNECTION
        # ═══════════════════════════════════════════════════════════════════════════
        print(f"\n{Colors.CYAN}{Colors.BOLD}3️⃣  REDIS CACHE CONNECTION{Colors.RESET}")
        print("─" * 80)
        
        try:
            # Try a simple get/set
            test_key = "diagnostic_test"
            await cache.set(test_key, "test_value", ttl=10)
            test_value = await cache.get(test_key)
            
            if test_value == "test_value":
                print(f"{Colors.GREEN}✅ Redis connected and working{Colors.RESET}")
                # Clean up
                await cache.delete(test_key)
            else:
                print(f"{Colors.RED}❌ Redis responding but data corrupted{Colors.RESET}")
        except Exception as e:
            print(f"{Colors.RED}❌ Redis connection failed: {e}{Colors.RESET}")
        
        # ═══════════════════════════════════════════════════════════════════════════
        # CHECK 4: MARKET DATA IN CACHE
        # ═══════════════════════════════════════════════════════════════════════════
        print(f"\n{Colors.CYAN}{Colors.BOLD}4️⃣  MARKET DATA IN CACHE{Colors.RESET}")
        print("─" * 80)
        
        market_data_found = 0
        for symbol in symbols:
            try:
                # Check raw cache key
                raw_data = await cache.get(f"market:{symbol}")
                market_data = await cache.get_market_data(symbol)
                
                if market_data and market_data.get("price"):
                    market_data_found += 1
                    price = market_data.get("price")
                    timestamp = market_data.get("timestamp", "N/A")
                    
                    print(f"\n{Colors.GREEN}✅ {symbol}{Colors.RESET}")
                    print(f"   Price: ₹{price:,.2f}")
                    print(f"   Timestamp: {timestamp}")
                else:
                    print(f"\n{Colors.RED}❌ {symbol}{Colors.RESET}")
                    print(f"   No market data in cache")
                    print(f"   Raw cache key exists: {bool(raw_data)}")
                    if raw_data:
                        print(f"   Raw data: {raw_data[:100]}...")
            except Exception as e:
                print(f"\n{Colors.RED}❌ {symbol}{Colors.RESET}")
                print(f"   Error: {e}")
        
        print(f"\n{Colors.BOLD}Summary: {market_data_found}/{len(symbols)} symbols have market data{Colors.RESET}")
        
        if market_data_found == 0:
            print(f"\n{Colors.RED}🚨 CRITICAL: NO MARKET DATA IN CACHE!{Colors.RESET}")
            print(f"   This explains why prices show ₹0.00")
            print(f"   Possible causes:")
            print(f"   1. WebSocket not connected")
            print(f"   2. Zerodha token expired")
            print(f"   3. Market is closed (data not being fetched)")
            print(f"   4. Feed crashed or disconnected")
        
        # ═══════════════════════════════════════════════════════════════════════════
        # CHECK 5: CANDLE DATA IN CACHE
        # ═══════════════════════════════════════════════════════════════════════════
        print(f"\n{Colors.CYAN}{Colors.BOLD}5️⃣  CANDLE DATA IN CACHE (For OI Momentum Analysis){Colors.RESET}")
        print("─" * 80)
        
        candles_found = 0
        for symbol in symbols:
            try:
                candle_key = f"analysis_candles:{symbol}"
                candles_json = await cache.lrange(candle_key, 0, 199)
                count = len(candles_json) if candles_json else 0
                
                if count >= 20:
                    candles_found += 1
                    status = f"{Colors.GREEN}✅ READY{Colors.RESET}"
                elif count > 0:
                    status = f"{Colors.YELLOW}⚠️ LOADING{Colors.RESET}"
                else:
                    status = f"{Colors.RED}❌ NO DATA{Colors.RESET}"
                
                print(f"\n{symbol}: {status} ({count} candles)")
                
                if candles_json:
                    try:
                        last = json.loads(candles_json[0])
                        print(f"   Last: {last.get('timestamp')} @ ₹{last.get('close'):.2f}")
                    except:
                        print(f"   Last: (unparseable)")
            except Exception as e:
                print(f"\n{symbol}: {Colors.RED}❌ ERROR{Colors.RESET}")
                print(f"   {e}")
        
        print(f"\n{Colors.BOLD}Summary: {candles_found}/{len(symbols)} symbols have sufficient candles{Colors.RESET}")
        
        if candles_found == 0:
            print(f"\n{Colors.YELLOW}⚠️  NO CANDLES = NO SIGNALS{Colors.RESET}")
            print(f"   OI Momentum needs 20+ candles to analyze")
            if market_data_found > 0:
                print(f"   But market data exists, so candles should accumulate soon")
            else:
                print(f"   And no market data either, so nothing to accumulate")
        
        # ═══════════════════════════════════════════════════════════════════════════
        # CHECK 6: BACKUP FILES
        # ═══════════════════════════════════════════════════════════════════════════
        print(f"\n{Colors.CYAN}{Colors.BOLD}6️⃣  HISTORICAL CANDLE BACKUPS{Colors.RESET}")
        print("─" * 80)
        
        try:
            from services.candle_backup_service import CandleBackupService
            
            backups = CandleBackupService.list_backup_files()
            if backups:
                print(f"{Colors.GREEN}✅ Found {len(backups)} backup files:{Colors.RESET}")
                for backup in backups[:3]:
                    print(f"   • {backup['file']}: {backup['symbol']} ({backup['candle_count']} candles)")
            else:
                print(f"{Colors.YELLOW}⚠️  No backup files found{Colors.RESET}")
                print(f"   Backups created at 3:35 PM each day")
                print(f"   First backup will be available tomorrow")
        except Exception as e:
            print(f"{Colors.YELLOW}⚠️  Could not check backups: {e}{Colors.RESET}")
        
        # ═══════════════════════════════════════════════════════════════════════════
        # CHECK 7: SUMMARY & RECOMMENDATIONS
        # ═══════════════════════════════════════════════════════════════════════════
        print(f"\n{Colors.CYAN}{Colors.BOLD}7️⃣  DIAGNOSIS & RECOMMENDATIONS{Colors.RESET}")
        print("─" * 80)
        
        issues = []
        if not auth_ok:
            issues.append("❌ NOT AUTHENTICATED")
        if market_data_found == 0:
            issues.append("❌ NO MARKET DATA IN CACHE")
        if candles_found == 0:
            issues.append("⚠️ NO CANDLES (may be normal if market just opened)")
        if market_status == "CLOSED":
            issues.append("ℹ️ MARKET CLOSED (data won't update until 9:15 AM)")
        
        if not issues:
            print(f"{Colors.GREEN}✅ ALL SYSTEMS OPERATIONAL!{Colors.RESET}")
            print(f"   • Market data: Flowing")
            print(f"   • Candles: Loaded")
            print(f"   • Signals: Should be active")
        else:
            print(f"{Colors.BOLD}Issues Found:{Colors.RESET}")
            for issue in issues:
                print(f"   {issue}")
            
            print(f"\n{Colors.BOLD}Recommended Actions:{Colors.RESET}")
            
            if "NOT AUTHENTICATED" in issues:
                print(f"   1. {Colors.RED}FIRST: Click LOGIN in UI or run: python quick_token_fix.py{Colors.RESET}")
            
            if "NO MARKET DATA" in issues:
                if "CLOSED" in issues:
                    print(f"   → Market closed, will resume at 9:15 AM")
                else:
                    print(f"   2. Check WebSocket connection (backend logs)")
                    print(f"      Run: python watch_oi_momentum.py")
                    print(f"      Or: curl http://localhost:8000/api/diagnostics/oi-momentum-debug")
            
            if "NO CANDLES" in issues and "CLOSED" not in issues:
                print(f"   3. Wait 5-10 minutes for candles to accumulate")
                print(f"      Or: Signals will appear once 20+ candles arrive")
        
        # ═══════════════════════════════════════════════════════════════════════════
        # CHECK 8: RAW DEBUG INFO
        # ═══════════════════════════════════════════════════════════════════════════
        print(f"\n{Colors.CYAN}{Colors.BOLD}8️⃣  RAW DEBUG INFO{Colors.RESET}")
        print("─" * 80)
        
        print(f"\nZerodha Configuration:")
        print(f"  API Key set: {bool(get_settings().zerodha_api_key)}")
        print(f"  API Secret set: {bool(get_settings().zerodha_api_secret)}")
        print(f"  Access Token set: {bool(get_settings().zerodha_access_token)}")
        if get_settings().zerodha_access_token:
            token_preview = get_settings().zerodha_access_token[:20] + "..."
            print(f"  Access Token: {token_preview}")
        
        print(f"\nRedis Configuration:")
        print(f"  URL: {get_settings().redis_url}")
        
        print(f"\nCache Keys Present:")
        for symbol in symbols:
            market_key = f"market:{symbol}"
            candle_key = f"analysis_candles:{symbol}"
            
            market_exists = await cache.exists(market_key)
            candle_exists = await cache.exists(candle_key)
            
            print(f"  {symbol}:")
            print(f"    - {market_key}: {Colors.GREEN if market_exists else Colors.RED}{market_exists}{Colors.RESET}")
            print(f"    - {candle_key}: {Colors.GREEN if candle_exists else Colors.RED}{candle_exists}{Colors.RESET}")
        
        # ═══════════════════════════════════════════════════════════════════════════
        # FINAL STATUS
        # ═══════════════════════════════════════════════════════════════════════════
        print(f"\n{Colors.BOLD}{'='*80}{Colors.RESET}")
        
        if auth_ok and market_data_found > 0 and candles_found > 0:
            print(f"{Colors.GREEN}{Colors.BOLD}✅ SYSTEM HEALTHY - SIGNALS SHOULD BE ACTIVE{Colors.RESET}")
        elif auth_ok and market_data_found > 0:
            print(f"{Colors.YELLOW}{Colors.BOLD}⚠️ SYSTEM PARTIAL - WAITING FOR CANDLES{Colors.RESET}")
        elif auth_ok:
            print(f"{Colors.YELLOW}{Colors.BOLD}⚠️ SYSTEM DEGRADED - CHECK WEBSOCKET{Colors.RESET}")
        else:
            print(f"{Colors.RED}{Colors.BOLD}❌ SYSTEM OFFLINE - MUST AUTHENTICATE{Colors.RESET}")
        
        print(f"{Colors.BOLD}{'='*80}{Colors.RESET}\n")
        
    except Exception as e:
        print(f"\n{Colors.RED}❌ DIAGNOSTIC ERROR: {e}{Colors.RESET}")
        import traceback
        traceback.print_exc()
    
    finally:
        await cache.disconnect()


async def main():
    try:
        await diagnose_system()
    except Exception as e:
        print(f"{Colors.RED}Fatal error: {e}{Colors.RESET}")


if __name__ == "__main__":
    asyncio.run(main())
