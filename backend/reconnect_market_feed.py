#!/usr/bin/env python3
"""
🔥 EMERGENCY MARKET FEED RECONNECT
Fixes: "Reconnecting to market feed..." stuck on PRE_OPEN status
Forces immediate WebSocket reconnection and data refresh
"""

import asyncio
import aiohttp
import sys
from datetime import datetime


async def force_reconnect(backend_url: str = "http://localhost:8000"):
    """Force reconnect to market feed"""
    
    print("\n" + "="*80)
    print("🔥 FORCING MARKET FEED RECONNECTION")
    print("="*80)
    print(f"Backend URL: {backend_url}")
    print(f"Time: {datetime.now().strftime('%H:%M:%S %Z')}\n")
    
    try:
        # Create async HTTP client
        async with aiohttp.ClientSession() as session:
            # First, check connection health
            print("📊 Checking current connection health...")
            try:
                async with session.get(f"{backend_url}/api/diagnostics/connection-health", timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status == 200:
                        health = await resp.json()
                        print(f"\n📊 Current Status:")
                        print(f"   WebSocket Connected: {health['websocket']['is_connected']}")
                        print(f"   Market Status: {health['market']['status']}")
                        print(f"   Watchdog State: {health['watchdog']['state']}")
                        print(f"   Last Tick Age: {health['watchdog']['last_tick_seconds_ago']}s")
                        print(f"   Recommendation: {health['recommendation']}\n")
            except Exception as e:
                print(f"⚠️  Could not get health status: {e}\n")
            
            # Now trigger force reconnect
            print("🔄 Triggering force reconnect endpoint...")
            async with session.post(f"{backend_url}/api/diagnostics/force-reconnect", timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status == 200:
                    result = await resp.json()
                    
                    print("\n✅ FORCE RECONNECT SUCCESSFUL\n")
                    print("Actions performed:")
                    for action in result.get("actions", []):
                        print(f"   {action}")
                    
                    print(f"\nNext Step: {result.get('next_step')}\n")
                    
                    print("Market Feed Status:")
                    market_status = result.get("market_status", {})
                    print(f"   Is Connected: {market_status.get('is_connected')}")
                    print(f"   Using REST Fallback: {market_status.get('using_rest_fallback')}")
                    print(f"   Has WebSocket: {market_status.get('has_kws')}")
                    print(f"   Is Running: {market_status.get('running')}")
                    
                    print("\n" + "="*80)
                    print("🎉 Reconnection Complete! Check dashboard in 5 seconds.")
                    print("="*80 + "\n")
                    
                    return True
                else:
                    error = await resp.text()
                    print(f"\n❌ Force reconnect failed (HTTP {resp.status}):")
                    print(error)
                    return False
    
    except aiohttp.ClientConnectorError as e:
        print(f"\n❌ FAILED TO CONNECT TO BACKEND")
        print(f"   Error: {e}")
        print(f"   Backend URL: {backend_url}")
        print(f"\n💡 SOLUTIONS:")
        print(f"   1. Make sure backend is running:")
        print(f"      cd backend && python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000")
        print(f"   2. Check if backend is on different host/port")
        print(f"\n")
        return False
    
    except aiohttp.ClientError as e:
        print(f"\n❌ Connection error: {e}\n")
        return False
    
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}\n")
        import traceback
        traceback.print_exc()
        return False


def main():
    """Main entry point"""
    
    # Parse arguments
    backend_url = "http://localhost:8000"
    
    if len(sys.argv) > 1:
        backend_url = sys.argv[1]
    
    # Run async function
    success = asyncio.run(force_reconnect(backend_url))
    
    # Exit with proper code
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
