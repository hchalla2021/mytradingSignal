#!/usr/bin/env python3
"""Test smart money endpoint after fix"""
import asyncio
import aiohttp
from datetime import datetime

async def test_smart_money():
    """Test smart money endpoint"""
    print(f"\n{'='*70}")
    print(f"🧪 TESTING SMART MONEY ENDPOINT FIX")
    print(f"{'='*70}\n")
    
    symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
    api_url = "http://localhost:8000"
    
    async with aiohttp.ClientSession() as session:
        # Test 1: Check if analysis endpoint works first
        print("📊 TEST 1: Checking /api/analysis/analyze/all endpoint...")
        try:
            async with session.get(f"{api_url}/api/analysis/analyze/all", timeout=10) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    print(f"   ✅ Status: {resp.status}")
                    for symbol, analysis in data.items():
                        indicators = analysis.get('indicators', {})
                        signal = analysis.get('signal', 'WAIT')
                        confidence = analysis.get('confidence', 0)
                        price = indicators.get('price', 0)
                        buy_ratio = indicators.get('buy_volume_ratio', 50)
                        vol_imbalance = indicators.get('volume_imbalance', 0)
                        print(f"   {symbol}:")
                        print(f"      → Signal: {signal}, Confidence: {confidence:.0%}")
                        print(f"      → Price: ₹{price:,.2f}")
                        print(f"      → Buy Ratio: {buy_ratio}%")
                        print(f"      → Volume Imbalance: {vol_imbalance}")
                else:
                    print(f"   ❌ Status: {resp.status}")
        except Exception as e:
            print(f"   ❌ Error: {e}")
        
        # Test 2: Check smart-money endpoint
        print(f"\n📊 TEST 2: Checking /api/analysis/smart-money/{{symbol}} endpoint...")
        for symbol in symbols:
            try:
                async with session.get(f"{api_url}/api/analysis/smart-money/{symbol}", timeout=10) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        signal = data.get('smart_money_signal', 'UNKNOWN')
                        confidence = data.get('smart_money_confidence', 0)
                        buy_flow = data.get('order_flow_strength', 0)
                        vol_imb = data.get('volume_imbalance', 0)
                        price = data.get('current_price', 0)
                        
                        print(f"   {symbol}:")
                        print(f"      → Signal: {signal}, Confidence: {confidence}%")
                        print(f"      → Price: ₹{price:,.2f}")
                        print(f"      → Buy Flow: {buy_flow}%")
                        print(f"      → Volume Imbalance: {vol_imb}")
                        
                        # Check if it's still returning defaults
                        if signal == 'NEUTRAL' and confidence == 50 and buy_flow == 50:
                            print(f"      ⚠️  WARNING: Still returning default values!")
                    else:
                        print(f"   {symbol}: ❌ Status {resp.status}")
            except Exception as e:
                print(f"   {symbol}: ❌ Error: {e}")
        
        print(f"\n{'='*70}")
        print(f"Test completed at {datetime.now().strftime('%H:%M:%S')}")
        print(f"{'='*70}\n")

if __name__ == "__main__":
    asyncio.run(test_smart_money())
