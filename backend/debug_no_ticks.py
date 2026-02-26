#!/usr/bin/env python3
"""
🔍 NO TICKS RECEIVED - DEBUGGING SCRIPT
Diagnoses exactly why ticks aren't flowing from Zerodha
"""

import sys
import asyncio
from datetime import datetime
import pytz

IST = pytz.timezone('Asia/Kolkata')

async def main():
    print("\n" + "="*80)
    print("🔍 ZERODHA TICKS DEBUGGING")
    print("="*80 + "\n")
    
    # Check 1: Is it market hours?
    now = datetime.now(IST)
    current_time = now.time()
    print(f"⏰ Current IST Time: {now.strftime('%Y-%m-%d %H:%M:%S')}\n")
    
    from datetime import time
    PRE_OPEN_START = time(9, 0)
    PRE_OPEN_END = time(9, 15)
    MARKET_OPEN = time(9, 15)
    MARKET_CLOSE = time(15, 30)
    
    is_market_hours = PRE_OPEN_START <= current_time <= MARKET_CLOSE
    is_weekday = now.weekday() < 5  # Monday=0, Friday=4
    
    print(f"📊 Market Hours Check:")
    print(f"   Is Weekday (Mon-Fri): {is_weekday}")
    print(f"   Time in Market Hours (9:00 AM - 3:30 PM): {is_market_hours}")
    
    if not is_weekday:
        print(f"   ❌ TODAY IS WEEKEND - Market closed! Come back Monday\n")
    elif not is_market_hours:
        print(f"   ❌ MARKET CLOSED - Ticks only available 9:00 AM - 3:30 PM IST\n")
    else:
        print(f"   ✅ Market is OPEN - Ticks should be flowing\n")
    
    # Check 2: Backend running?
    print(f"🖥️  Backend Status Check:")
    try:
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get("http://localhost:8000/health", timeout=aiohttp.ClientTimeout(total=5)) as resp:
                if resp.status == 200:
                    print(f"   ✅ Backend responsive on localhost:8000\n")
                else:
                    print(f"   ❌ Backend returned HTTP {resp.status}\n")
    except Exception as e:
        print(f"   ❌ Backend NOT accessible: {e}")
        print(f"      Start backendwith: cd backend && python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000\n")
        return
    
    # Check 3: Connection Health
    print(f"📡 Connection Health:")
    try:
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get("http://localhost:8000/api/diagnostics/connection-health", timeout=aiohttp.ClientTimeout(total=5)) as resp:
                if resp.status == 200:
                    health = await resp.json()
                    
                    ws_connected = health['websocket']['is_connected']
                    watchdog_healthy = health['watchdog']['is_healthy']
                    last_tick = health['watchdog']['last_tick_seconds_ago']
                    market_status = health['market']['status']
                    authenticated = health['auth']['authenticated']
                    
                    print(f"   WebSocket Connected: {ws_connected}")
                    print(f"   Market Status: {market_status}")
                    print(f"   Watchdog Healthy: {watchdog_healthy}")
                    print(f"   Last Tick: {last_tick}s ago (None = never)")
                    print(f"   Authenticated: {authenticated}\n")
                    
                    # Diagnose based on health
                    issues = []
                    
                    if not authenticated:
                        issues.append("❌ NOT AUTHENTICATED - Token needs refresh")
                    
                    if not ws_connected and is_market_hours:
                        issues.append("❌ WebSocket NOT CONNECTED - Should be connected during market hours")
                    
                    if last_tick is None or (isinstance(last_tick, (int, float)) and last_tick > 30):
                        if is_market_hours:
                            issues.append(f"❌ NO TICKS RECEIVED - Last tick {last_tick}s ago (should be < 5s)")
                    
                    if not watchdog_healthy and is_market_hours:
                        issues.append("❌ Feed is STALE - Not receiving live ticks")
                    
                    if issues:
                        print("⚠️  ISSUES DETECTED:\n")
                        for issue in issues:
                            print(f"   {issue}")
                        print()
    except Exception as e:
        print(f"   ⚠️  Could not get health status: {e}\n")
    
    # Check 4: Market Data in Cache
    print(f"💾 Market Data in Cache:")
    try:
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get("http://localhost:8000/api/diagnostics/market-data-status", timeout=aiohttp.ClientTimeout(total=5)) as resp:
                if resp.status == 200:
                    market_data = await resp.json()
                    
                    nifty = market_data['market_data']['NIFTY']
                    banknifty = market_data['market_data']['BANKNIFTY']
                    sensex = market_data['market_data']['SENSEX']
                    
                    print(f"   NIFTY:     {nifty.get('price', '₹0.00')} {nifty.get('timestamp', 'N/A')[:19] if nifty.get('timestamp') else 'N/A'}")
                    print(f"   BANKNIFTY: {banknifty.get('price', '₹0.00')} {banknifty.get('timestamp', 'N/A')[:19] if banknifty.get('timestamp') else 'N/A'}")
                    print(f"   SENSEX:    {sensex.get('price', '₹0.00')} {sensex.get('timestamp', 'N/A')[:19] if sensex.get('timestamp') else 'N/A'}\n")
                    
                    if all(v.get('price', 0) == 0 or v.get('price') is None for v in [nifty, banknifty, sensex]):
                        print("   ⚠️  All prices are ₹0.00 - No ticks have been received yet\n")
    except Exception as e:
        print(f"   ❌ Error checking market data: {e}\n")
    
    # Check 5: Authentication Status
    print(f"🔐 Authentication Status:")
    try:
        from config import get_settings
        from services.auth_state_machine import auth_state_manager
        
        settings = get_settings()
        auth_state_manager.force_recheck()
        
        print(f"   Auth State: {auth_state_manager.current_state}")
        print(f"   Is Authenticated: {auth_state_manager.is_authenticated}")
        print(f"   Requires Login: {auth_state_manager.requires_login}")
        
        if auth_state_manager.requires_login:
            print(f"   ⚠️  REQUIRES LOGIN - Token needs to be refreshed!\n")
            print(f"   FIX: cd backend && python quick_token_fix.py\n")
        elif not auth_state_manager.is_authenticated:
            print(f"   ⚠️  NOT AUTHENTICATED - Check token validity\n")
        else:
            print(f"   ✅ Authentication OK\n")
    except Exception as e:
        print(f"   Error checking auth: {e}\n")
    
    # Check 6: Zerodha Configuration
    print(f"⚙️  Zerodha Configuration:")
    try:
        from config import get_settings
        settings = get_settings()
        
        print(f"   API Key Set: {bool(settings.zerodha_api_key)}")
        print(f"   Access Token Set: {bool(settings.zerodha_access_token)}")
        print(f"   NIFTY Token: {settings.nifty_token}")
        print(f"   BANKNIFTY Token: {settings.banknifty_token}")
        print(f"   SENSEX Token: {settings.sensex_token}\n")
        
        if not settings.zerodha_api_key or not settings.zerodha_access_token:
            print(f"   ❌ Missing Zerodha credentials!\n")
    except Exception as e:
        print(f"   Error: {e}\n")
    
    # FINAL RECOMMENDATIONS
    print("="*80)
    print("🔧 QUICK FIX RECOMMENDATIONS")
    print("="*80 + "\n")
    
    if not is_market_hours:
        print("   1. ⏰ WAIT FOR MARKET HOURS (9:00 AM - 3:30 PM IST weekdays)")
        print("      Ticks are ONLY available during market hours\n")
    
    print("   2. 🔐 REFRESH ZERODHA TOKEN")
    print("      run: cd backend && python quick_token_fix.py\n")
    
    print("   3. 🔄 FORCE RECONNECT")
    print("      run: cd backend && python reconnect_market_feed.py\n")
    
    print("   4. 📊 MONITOR LIVE DATA")
    print("      run: cd backend && python watch_oi_momentum.py\n")
    
    print("   5. 🐛 FULL DIAGNOSIS")
    print("      run: cd backend && python diagnose_system.py\n")


if __name__ == "__main__":
    asyncio.run(main())
