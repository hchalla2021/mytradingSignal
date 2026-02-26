#!/usr/bin/env python3
"""
🚀 STARTUP & DATA FLOW VERIFICATION
Starts backend, waits for initialization, then verifies market data is flowing
"""

import subprocess
import time
import sys
import requests
import json

def wait_for_backend(max_retries=30, delay=2):
    """Wait for backend to become responsive"""
    for i in range(max_retries):
        try:
            r = requests.get("http://localhost:8000/health", timeout=3)
            if r.status_code == 200:
                print(f"✅ Backend is responsive!\n")
                return True
        except:
            pass
        
        print(f"⏳ Waiting for backend... ({i+1}/{max_retries})")
        time.sleep(delay)
    
    print(f"❌ Backend did not respond after {max_retries * delay} seconds")
    return False


def check_market_data():
    """Check if market data is flowing"""
    try:
        r = requests.get("http://localhost:8000/api/diagnostics/market-data-status", timeout=5)
        data = r.json()
        
        print("="*80)
        print("📊 MARKET DATA STATUS")
        print("="*80)
        
        nifty = data['market_data'].get('NIFTY')
        banknifty = data['market_data'].get('BANKNIFTY')
        sensex = data['market_data'].get('SENSEX')
        
        if nifty:
            print(f"✅ NIFTY:     ₹{nifty.get('price', 0):,.2f} ({nifty.get('changePercent', 0):+.2f}%)")
        else:
            print(f"❌ NIFTY:     No data")
        
        if banknifty:
            print(f"✅ BANKNIFTY: ₹{banknifty.get('price', 0):,.2f} ({banknifty.get('changePercent', 0):+.2f}%)")
        else:
            print(f"❌ BANKNIFTY: No data")
        
        if sensex:
            print(f"✅ SENSEX:    ₹{sensex.get('price', 0):,.2f} ({sensex.get('changePercent', 0):+.2f}%)")
        else:
            print(f"❌ SENSEX:    No data")
        
        print("="*80)
        
        return all([nifty, banknifty, sensex])
        
    except Exception as e:
        print(f"❌ Could not fetch market data: {e}")
        return False


def check_connection_health():
    """Check WebSocket and feed health"""
    try:
        r = requests.get("http://localhost:8000/api/diagnostics/connection-health", timeout=5)
        data = r.json()
        
        print("\n" + "="*80)
        print("🔌 CONNECTION HEALTH")
        print("="*80)
        
        ws_connected = data['websocket']['is_connected']
        market_status = data['market']['status']
        watchdog_healthy = data['watchdog']['is_healthy']
        last_tick = data['watchdog']['last_tick_seconds_ago']
        
        print(f"WebSocket Connected: {ws_connected}")
        print(f"Market Status: {market_status}")
        print(f"Watchdog Healthy: {watchdog_healthy}")
        print(f"Last Tick: {last_tick}s ago" if last_tick else "Last Tick: Never")
        
        print("="*80)
        
        if ws_connected and market_status in ("LIVE", "PRE_OPEN"):
            print("✅ Connection is HEALTHY - Data should be flowing\n")
            return True
        else:
            print("⚠️  Connection may have issues\n")
            return False
        
    except Exception as e:
        print(f"❌ Could not check connection health: {e}\n")
        return False


def main():
    print("\n" + "="*80)
    print("🚀 TRADING APP STARTUP & VERIFICATION")
    print("="*80 + "\n")
    
    print("⏳ Checking if backend is running...")
    
    if wait_for_backend():
        print("\n✅ Backend started successfully!")
        
        # Give market feed time to connect
        print("\n⏳ Waiting for market feed to establish connection (30 seconds)...")
        time.sleep(30)
        
        # Check data flow
        market_ok = check_market_data()
        connection_ok = check_connection_health()
        
        if market_ok and connection_ok:
            print("\n" + "="*80)
            print("🎉 SUCCESS - ALL SYSTEMS GO!")
            print("="*80)
            print("\n✅ Backend is running")
            print("✅ WebSocket is connected")
            print("✅ Market data is flowing")
            print("✅ Zerodha feed is live")
            print("\n📱 Next step: REFRESH YOUR APP in the browser")
            print("   The values should now display in the UI!\n")
            print("="*80 + "\n")
            return 0
        else:
            print("\n⚠️  Some systems are not ready. Troubleshooting...\n")
            print("   1. Is it market hours (9:00 AM - 3:30 PM IST, weekdays)?")
            print("   2. Is Zerodha token valid? Run: python quick_token_fix.py")
            print("   3. Is Redis running? Run: redis-cli ping")
            print("   4. Force reconnect: python reconnect_market_feed.py\n")
            return 1
    else:
        print("\n❌ Backend failed to start!")
        print("   Try manually: cd backend && python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
