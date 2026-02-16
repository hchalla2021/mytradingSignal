#!/usr/bin/env python3
"""Quick test of Volume Pulse API endpoint"""
import sys
import asyncio
import requests

# Test the endpoint
def test_endpoint():
    url = "http://localhost:8000/api/advanced/volume-pulse/NIFTY"
    print(f"Testing: {url}")
    
    try:
        response = requests.get(url, timeout=10)
        print(f"\nHTTP Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"\n✅ Response received:")
            print(f"   Symbol: {data.get('symbol')}")
            print(f"   Signal: {data.get('signal')}")
            print(f"   Pulse Score: {data.get('pulse_score')}%")
            print(f"   Confidence: {data.get('confidence')}%")
            print(f"   Status: {data.get('status')}")
            print(f"   Trend: {data.get('trend')}")
            
            if 'volume_data' in data:
                vd = data['volume_data']
                print(f"\n📊 Volume Data:")
                print(f"   Green Candles: {vd.get('green_candle_volume'):,.0f} ({vd.get('green_percentage'):.1f}%)")
                print(f"   Red Candles: {vd.get('red_candle_volume'):,.0f} ({vd.get('red_percentage'):.1f}%)")
                print(f"   Ratio: {vd.get('ratio'):.2f}")
            else:
                print(f"\n❌ NO volume_data in response!")
                
            print(f"\n📦 Full Response Keys: {list(data.keys())}")
        else:
            print(f"❌ Error: {response.text}")
            
    except requests.exceptions.ConnectionError:
        print("❌ Connection Error: Backend is not running or not accessible at localhost:8000")
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    test_endpoint()
