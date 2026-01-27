"""
Test script to verify backend WebSocket data flow
Run this to test if:
1. Backend can fetch market data
2. Analysis is being generated
3. Data is properly formatted
"""

import asyncio
import json
from services.cache import CacheService
from services.market_feed import MarketFeedService
from services.websocket_manager import ConnectionManager
from services.instant_analysis import get_instant_analysis
from config import get_settings

async def test_backend_flow():
    """Test the entire backend data flow"""
    print("\n" + "="*80)
    print("🧪 TESTING BACKEND MARKET DATA FLOW")
    print("="*80 + "\n")
    
    settings = get_settings()
    cache = CacheService()
    await cache.connect()
    
    try:
        # 1. Test cache data retrieval
        print("1️⃣ Testing cache data retrieval...")
        all_data = await cache.get_all_market_data()
        print(f"   📊 Cache has {len(all_data)} symbols")
        for symbol, data in all_data.items():
            if data:
                print(f"      {symbol}: Price=₹{data.get('price', 0)}, Analysis={'✅ YES' if data.get('analysis') else '❌ NO'}")
            else:
                print(f"      {symbol}: ❌ No data")
        
        # 2. Test instant analysis generation
        print("\n2️⃣ Testing instant analysis generation...")
        analysis = await get_instant_analysis(cache, "NIFTY")
        if analysis:
            print(f"   ✅ NIFTY Analysis generated")
            print(f"      Signal: {analysis.get('signal')}")
            print(f"      Confidence: {analysis.get('confidence')}")
            print(f"      Has indicators: {'✅' if analysis.get('indicators') else '❌'}")
        else:
            print(f"   ❌ NIFTY Analysis is None")
        
        # 3. Verify all symbols
        print("\n3️⃣ Verifying all symbols...")
        symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
        for symbol in symbols:
            data = await cache.get_market_data(symbol)
            if data:
                print(f"   {symbol}:")
                print(f"      Price: ₹{data.get('price', 0)}")
                print(f"      Status: {data.get('status', 'UNKNOWN')}")
                print(f"      Analysis Present: {'✅ YES' if data.get('analysis') else '❌ NO'}")
                if data.get('analysis'):
                    print(f"      Analysis Signal: {data['analysis'].get('signal')}")
            else:
                print(f"   {symbol}: ❌ NO DATA IN CACHE")
        
        # 4. Check API connectivity
        print("\n4️⃣ Checking Zerodha API connectivity...")
        if settings.zerodha_access_token:
            print(f"   ✅ Access token is set")
        else:
            print(f"   ❌ Access token is NOT set")
        
        if settings.zerodha_api_key:
            print(f"   ✅ API key is set")
        else:
            print(f"   ❌ API key is NOT set")
        
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await cache.disconnect()
    
    print("\n" + "="*80)
    print("✅ TEST COMPLETE")
    print("="*80 + "\n")

if __name__ == "__main__":
    asyncio.run(test_backend_flow())
