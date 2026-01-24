"""
OI Baseline Setter - Auto Market Open Script
Runs at 9:15 AM IST to capture opening OI as baseline
"""
import asyncio
import aiohttp
from datetime import datetime
import pytz

IST = pytz.timezone('Asia/Kolkata')
API_BASE_URL = "http://localhost:8000"


async def set_baseline():
    """Set OI baseline for all symbols"""
    print("=" * 60)
    print("🕒 OI Baseline Setter")
    print(f"⏰ Time: {datetime.now(IST).strftime('%Y-%m-%d %H:%M:%S IST')}")
    print("=" * 60)
    
    async with aiohttp.ClientSession() as session:
        try:
            # Set baseline for all symbols
            async with session.post(f"{API_BASE_URL}/api/oi/baseline/all") as response:
                if response.status == 200:
                    result = await response.json()
                    print("\n✅ Baseline Set Successfully!")
                    print(f"   NIFTY:     {result['results']['NIFTY']}")
                    print(f"   BANKNIFTY: {result['results']['BANKNIFTY']}")
                    print(f"   SENSEX:    {result['results']['SENSEX']}")
                else:
                    print(f"❌ Failed: HTTP {response.status}")
                    print(await response.text())
        
        except aiohttp.ClientConnectorError:
            print("❌ Error: Cannot connect to backend")
            print("   Make sure backend is running at http://localhost:8000")
        
        except Exception as e:
            print(f"❌ Error: {e}")
    
    print("\n" + "=" * 60)
    print("💡 Baseline will be used for OI change calculations today")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(set_baseline())
